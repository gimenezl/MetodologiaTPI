import { expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { BUCKET_FINAL, BUCKET_TEMPORAL } from '@/lib/comprobantes-contrato'
import { conciliarCargasComprobante } from '@/services/comprobantes-conciliacion'
import { finalizarCargaComprobante } from '@/services/comprobantes-finalizacion'

/**
 * EPT-109: protocolo de finalización con un Storage y una base SIMULADOS. Lo que
 * prueba es el ORDEN y la decisión de cada paso (qué se borra, qué se descarta y
 * qué NO se toca ante una respuesta incierta). No prueba Storage ni PostgreSQL
 * reales: eso lo hacen `supabase/tests/comprobantes_*.{sql,mjs}`.
 */

const USUARIO = 'a1000000-0000-4000-8000-000000000001'
const CARGA = 'b1000000-0000-4000-8000-000000000002'
const PAGO = 'c1000000-0000-4000-8000-000000000003'
const RUTA_TEMPORAL = `${PAGO}/${CARGA}`
const RUTA_FINAL = `${PAGO}/${CARGA}.png`

type Respuesta = { data?: unknown; error?: { code?: string; message?: string } | null }

interface Plan {
  obtener?: Respuesta | (() => Respuesta)
  confirmar?: Respuesta | (() => Respuesta)
  descartar?: Respuesta
  subidaFinalFalla?: boolean
}

function crearMundo(plan: Plan = {}) {
  const objetos = new Map<string, Uint8Array>()
  const llamadas: string[] = []
  const carga = (estado = 'PREPARADA', extra: Record<string, unknown> = {}) => ({
    estado,
    pago_id: PAGO,
    ruta_temporal: RUTA_TEMPORAL,
    ruta_final: RUTA_FINAL,
    tipo_mime: 'image/png',
    tamano_bytes: 0,
    resultado: { carga_id: CARGA, estado },
    ...extra,
  })
  const clave = (bucket: string, ruta: string) => `${bucket}:${ruta}`

  const admin = {
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      llamadas.push(`rpc:${nombre}:${JSON.stringify(args.p_motivo ?? '')}`)
      const elegir = (r: Respuesta | (() => Respuesta) | undefined, porDefecto: Respuesta) =>
        typeof r === 'function' ? r() : (r ?? porDefecto)
      if (nombre === 'obtener_carga_para_finalizar') return elegir(plan.obtener, { data: carga(), error: null })
      if (nombre === 'confirmar_carga_comprobante') {
        return elegir(plan.confirmar, {
          data: { carga_id: CARGA, estado: 'CONFIRMADA' },
          error: null,
        })
      }
      if (nombre === 'descartar_carga_comprobante') {
        return plan.descartar ?? { data: { estado: 'DESCARTADA' }, error: null }
      }
      return { data: null, error: null }
    },
    storage: {
      from: (bucket: string) => ({
        download: async (ruta: string) => {
          llamadas.push(`descarga:${bucket}`)
          const bytes = objetos.get(clave(bucket, ruta))
          if (!bytes) return { data: null, error: { message: 'Object not found' } }
          return { data: new Blob([bytes as BlobPart]), error: null }
        },
        upload: async (ruta: string, bytes: Uint8Array) => {
          llamadas.push(`subida:${bucket}`)
          if (plan.subidaFinalFalla) return { data: null, error: { message: 'The resource already exists' } }
          if (objetos.has(clave(bucket, ruta))) {
            return { data: null, error: { message: 'The resource already exists' } }
          }
          objetos.set(clave(bucket, ruta), new Uint8Array(bytes))
          return { data: { path: ruta }, error: null }
        },
        remove: async (rutas: string[]) => {
          llamadas.push(`borrado:${bucket}`)
          // Como Storage: devuelve solo los objetos que existían (borrar uno ausente no es un error).
          const quitados = rutas.filter(r => objetos.delete(clave(bucket, r))).map(name => ({ name }))
          return { data: quitados, error: null }
        },
      }),
    },
  }
  return {
    admin: admin as unknown as SupabaseClient,
    objetos,
    llamadas,
    existe: (bucket: string, ruta: string) => objetos.has(clave(bucket, ruta)),
    poner: (bucket: string, ruta: string, bytes: Uint8Array) => objetos.set(clave(bucket, ruta), bytes),
    carga,
  }
}

async function pngReal(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: '#336699' } }).png().toBuffer()
}

const confirmada = { data: { carga_id: CARGA, estado: 'CONFIRMADA' }, error: null }

test.describe('finalización de una carga', () => {
  test('camino feliz: publica los bytes validados, confirma y retira el temporal', async () => {
    const png = await pngReal()
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length }), error: null }),
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)

    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(r.estado).toBe(200)
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(true)
    expect(Buffer.from(m.objetos.get(`${BUCKET_FINAL}:${RUTA_FINAL}`)!).equals(png)).toBe(true)
    expect(m.existe(BUCKET_TEMPORAL, RUTA_TEMPORAL)).toBe(false)
    // La publicación va ANTES de la confirmación SQL.
    const subida = m.llamadas.indexOf(`subida:${BUCKET_FINAL}`)
    const confirmar = m.llamadas.findIndex(l => l.startsWith('rpc:confirmar_carga_comprobante'))
    expect(subida).toBeGreaterThan(-1)
    expect(confirmar).toBeGreaterThan(subida)
  })

  test('una carga ya confirmada devuelve el mismo resultado sin tocar Storage', async () => {
    const m = crearMundo({ obtener: { data: crearMundo().carga('CONFIRMADA'), error: null } })
    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)
    expect(r.estado).toBe(200)
    expect(m.llamadas.filter(l => !l.startsWith('rpc:obtener'))).toEqual([])
  })

  test('contenido que no es una imagen: se descarta, se retira el temporal y no se publica nada', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>')
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: html.length }), error: null }),
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, html)

    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(r.estado).toBe(422)
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(false)
    expect(m.existe(BUCKET_TEMPORAL, RUTA_TEMPORAL)).toBe(false)
    expect(m.llamadas.some(l => l.startsWith('rpc:descartar_carga_comprobante'))).toBe(true)
    expect(m.llamadas.some(l => l.startsWith('rpc:confirmar_carga_comprobante'))).toBe(false)
  })

  test('el tamaño real debe coincidir con el declarado', async () => {
    const png = await pngReal()
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length + 1 }), error: null }),
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)
    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)
    expect(r.estado).toBe(422)
    expect(r.cuerpo.codigo).toBe('CONTENIDO_NO_COINCIDE')
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(false)
  })

  test('objeto temporal ausente: se pide reintentar y NO se descarta la carga', async () => {
    const m = crearMundo()
    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)
    expect(r.estado).toBe(409)
    expect(r.cuerpo.codigo).toBe('ARCHIVO_NO_SUBIDO')
    expect(m.llamadas.some(l => l.startsWith('rpc:descartar_carga_comprobante'))).toBe(false)
  })

  test('respuesta perdida en la confirmación: resultado incierto y NADA se borra', async () => {
    const png = await pngReal()
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length }), error: null }),
      confirmar: { data: null, error: { message: 'fetch failed' } },
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)

    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(r.estado).toBe(503)
    expect(r.cuerpo.codigo).toBe('RESULTADO_INCIERTO')
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(true)
    expect(m.existe(BUCKET_TEMPORAL, RUTA_TEMPORAL)).toBe(true)
    expect(m.llamadas.some(l => l.startsWith('borrado:'))).toBe(false)
  })

  test('reintento tras un corte entre la publicación y la confirmación', async () => {
    const png = await pngReal()
    let confirmaciones = 0
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length }), error: null }),
      confirmar: () => {
        confirmaciones += 1
        return confirmaciones === 1 ? { data: null, error: { message: 'timeout' } } : confirmada
      },
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)

    expect((await finalizarCargaComprobante(m.admin, USUARIO, CARGA)).estado).toBe(503)
    const segundo = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(segundo.estado).toBe(200)
    expect(confirmaciones).toBe(2)
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(true)
    expect(m.existe(BUCKET_TEMPORAL, RUTA_TEMPORAL)).toBe(false)
  })

  test('descarte de negocio (número duplicado): retira el objeto final huérfano y el temporal', async () => {
    const png = await pngReal()
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length }), error: null }),
      confirmar: {
        data: { carga_id: CARGA, estado: 'DESCARTADA', motivo_descarte: 'OPERACION_DUPLICADA' },
        error: null,
      },
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)

    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(r.estado).toBe(409)
    expect(r.cuerpo.codigo).toBe('OPERACION_DUPLICADA')
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(false)
    expect(m.existe(BUCKET_TEMPORAL, RUTA_TEMPORAL)).toBe(false)
  })

  test('cuenta bloqueada durante la carga: se cierra y se retira lo publicado', async () => {
    const png = await pngReal()
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length }), error: null }),
      confirmar: { data: null, error: { code: '42501', message: 'denegado' } },
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)

    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(r.estado).toBe(403)
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(false)
    expect(m.llamadas).toContain('rpc:descartar_carga_comprobante:"CUENTA_NO_HABILITADA"')
  })

  test('si la carga ya estaba CONFIRMADA, un descarte sin efecto NO autoriza a borrar el objeto final', async () => {
    const png = await pngReal()
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length }), error: null }),
      confirmar: { data: null, error: { code: '42501', message: 'denegado' } },
      // Otra finalización del mismo intento la confirmó entre el 42501 y el descarte: es un no-op.
      descartar: { data: { estado: 'CONFIRMADA' }, error: null },
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)

    await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(true)
    expect(m.llamadas.some(l => l === `borrado:${BUCKET_FINAL}`)).toBe(false)
  })

  test('un objeto final previo con OTRO contenido no se acepta ni se borra', async () => {
    const png = await pngReal()
    const otro = await sharp({ create: { width: 21, height: 21, channels: 3, background: '#000' } }).png().toBuffer()
    const m = crearMundo({
      obtener: () => ({ data: m.carga('PREPARADA', { tamano_bytes: png.length }), error: null }),
    })
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, png)
    m.poner(BUCKET_FINAL, RUTA_FINAL, otro)

    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)

    expect(r.estado).toBe(500)
    expect(r.cuerpo.codigo).toBe('PUBLICACION_INCONSISTENTE')
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(true)
    expect(m.llamadas.some(l => l.startsWith('rpc:confirmar_carga_comprobante'))).toBe(false)
  })

  test('carga ajena o inexistente: 404 sin tocar Storage', async () => {
    const m = crearMundo({ obtener: { data: null, error: { code: 'P6866', message: 'no existe' } } })
    const r = await finalizarCargaComprobante(m.admin, USUARIO, CARGA)
    expect(r.estado).toBe(404)
    expect(m.llamadas.filter(l => !l.startsWith('rpc:obtener'))).toEqual([])
  })
})

test.describe('conciliación', () => {
  test('retira temporales resueltos y finales huérfanos; marca solo si ambos salieron bien', async () => {
    const m = crearMundo()
    const otra = 'd1000000-0000-4000-8000-000000000004'
    m.poner(BUCKET_TEMPORAL, RUTA_TEMPORAL, new Uint8Array([1]))
    m.poner(BUCKET_FINAL, RUTA_FINAL, new Uint8Array([2]))
    m.poner(BUCKET_TEMPORAL, `${PAGO}/${otra}`, new Uint8Array([3]))
    const admin = {
      rpc: async (nombre: string) => {
        if (nombre === 'cargas_comprobante_a_conciliar') {
          return {
            data: [
              { carga_id: CARGA, estado: 'DESCARTADA', ruta_temporal: RUTA_TEMPORAL, ruta_final_huerfana: RUTA_FINAL },
              { carga_id: otra, estado: 'CONFIRMADA', ruta_temporal: `${PAGO}/${otra}`, ruta_final_huerfana: null },
            ],
            error: null,
          }
        }
        return { data: null, error: null }
      },
      storage: (m.admin as unknown as { storage: unknown }).storage,
    } as unknown as SupabaseClient

    const r = await conciliarCargasComprobante(admin)

    expect(r).toMatchObject({
      examinadas: 2,
      temporalesRetirados: 2,
      finalesHuerfanosRetirados: 1,
      pendientes: 0,
    })
    expect(m.existe(BUCKET_FINAL, RUTA_FINAL)).toBe(false)

    // Repetirla (o re-barrer una carga cerrada hace poco) no cuenta como retirado lo que ya no estaba.
    const otra2 = await conciliarCargasComprobante(admin)
    expect(otra2).toMatchObject({
      examinadas: 2,
      temporalesRetirados: 0,
      finalesHuerfanosRetirados: 0,
      pendientes: 0,
    })
  })
})
