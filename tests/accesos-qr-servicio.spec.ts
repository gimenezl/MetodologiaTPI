import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { construirPayload } from '@/lib/credenciales-qr/payload'
import { cargarClavesQr } from '@/lib/credenciales-qr/claves'
import { consumirCupo, registrarEscaneo } from '@/services/accesos-qr.service'

/**
 * Frontera servidor → base del registro de accesos (EPT-65), probada SIN base ni
 * navegador: `fetch` se reemplaza por un espía que registra cada petición saliente.
 *
 * Demuestra, sobre el código real de `accesos-qr.service.ts`:
 *   - la firma se verifica ANTES de cualquier consulta: un payload alterado, mal
 *     formado, de otra versión o de un `kid` desconocido NO llega a
 *     `registrar_acceso_servicio` y solo suma al contador de inválidos;
 *   - con firma válida se invoca la operación privilegiada con el cliente
 *     administrativo: `Authorization` y `apikey` llevan la clave de servicio y NO
 *     hay cookie ni token de usuario;
 *   - el actor es el de la sesión y la credencial es la del payload, nunca otra;
 *   - un error de base, un tiempo agotado, una caída de red o una respuesta fuera
 *     del conjunto cerrado jamás se convierten en una aprobación;
 *   - nada sensible llega a la consola.
 *
 * Las claves son EFÍMERAS y nunca se imprimen.
 */

const URL_BASE = 'http://base-falsa.invalid'
const CLAVE_SERVICIO = `servicio-efimera-${randomBytes(24).toString('hex')}`

type Llamada = { url: string; metodo: string; encabezados: Record<string, string>; cuerpo: unknown }

const ENTORNO_ORIGINAL = { ...process.env }
const fetchOriginal = globalThis.fetch
const errorOriginal = console.error

let llamadas: Llamada[]
let respuestas: Array<() => Response | Promise<Response>>
let consola: string[]
let claveQr: string

function respuestaJson(cuerpo: unknown, estado = 200) {
  return () => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
}

test.beforeEach(() => {
  llamadas = []
  respuestas = []
  consola = []
  claveQr = randomBytes(32).toString('base64url')
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE
  process.env.SUPABASE_SERVICE_ROLE_KEY = CLAVE_SERVICIO
  process.env.QR_CREDENCIAL_KID_ACTIVA = 'k1'
  process.env.QR_CREDENCIAL_CLAVES = `k1:${claveQr}`
  console.error = (...datos: unknown[]) => consola.push(datos.map((d) => JSON.stringify(d)).join(' '))
  globalThis.fetch = (async (entrada: RequestInfo | URL, inicio?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada)
    const encabezados: Record<string, string> = {}
    new Headers(inicio?.headers).forEach((valor, clave) => {
      encabezados[clave.toLowerCase()] = valor
    })
    let cuerpo: unknown = null
    if (typeof inicio?.body === 'string') {
      try {
        cuerpo = JSON.parse(inicio.body)
      } catch {
        cuerpo = inicio.body
      }
    }
    llamadas.push({ url, metodo: inicio?.method ?? 'GET', encabezados, cuerpo })
    const siguiente = respuestas.shift()
    if (!siguiente) throw new Error('petición inesperada hacia la base')
    return siguiente()
  }) as typeof fetch
})

test.afterEach(() => {
  process.env = { ...ENTORNO_ORIGINAL }
  globalThis.fetch = fetchOriginal
  console.error = errorOriginal
})

const ACTOR = randomUUID()
const SERVICIO = randomUUID()
const INTENTO = randomUUID()

function datos(payload: string, extra: Record<string, unknown> = {}) {
  return { userId: ACTOR, payload, intentoId: INTENTO, servicioId: SERVICIO, ...extra }
}

function payloadValido(credencialId = randomUUID()) {
  return { credencialId, payload: construirPayload(credencialId, 'k1', cargarClavesQr()) }
}

function rpcs() {
  return llamadas.map((l) => new URL(l.url).pathname.replace('/rest/v1/rpc/', ''))
}

test.describe('la firma se verifica antes de consultar la base', () => {
  test('un payload alterado, ilegible, de otra versión o de un kid desconocido no llega al registro', async () => {
    const { payload } = payloadValido()
    const partes = payload.split('.')
    const casos: Record<string, string> = {
      'firma alterada': `${partes[0]}.${partes[1]}.${partes[2]}.${partes[3].slice(0, -2)}${partes[3].endsWith('AA') ? 'BB' : 'AA'}`,
      'id alterado': `${partes[0]}.${partes[1]}.${partes[2].slice(0, -1)}${partes[2].endsWith('A') ? 'B' : 'A'}.${partes[3]}`,
      'kid desconocido': `${partes[0]}.zz9.${partes[2]}.${partes[3]}`,
      'otra versión': `EPT2.${partes[1]}.${partes[2]}.${partes[3]}`,
      'basura': 'esto no es un qr',
      'solo el id': partes[2],
      'demasiado largo': 'x'.repeat(300),
      'con salto de línea': `${payload}\n`,
    }
    for (const [nombre, texto] of Object.entries(casos)) {
      llamadas.length = 0
      respuestas = [respuestaJson([{ bloqueado: false, reintentar_en_segundos: 0 }])]
      const resultado = await registrarEscaneo(datos(texto))
      expect(resultado, nombre).toEqual({
        ok: true,
        datos: { codigo: 'NO_RECONOCIDO', mensaje: expect.any(String) },
      })
      // Solo el contador de inválidos: ni credencial, ni registro.
      expect(rpcs(), nombre).toEqual(['registrar_escaneo_invalido'])
      expect(llamadas[0].cuerpo, nombre).toEqual({ p_actor_user_id: ACTOR })
      // El contador tampoco recibe el payload.
      expect(JSON.stringify(llamadas[0]), nombre).not.toContain(partes[3])
    }
  })

  test('si el contador de inválidos falla, la respuesta sigue siendo NO_RECONOCIDO (nunca una aprobación)', async () => {
    respuestas = [respuestaJson({ code: 'XX000', message: 'detalle interno' }, 500)]
    const resultado = await registrarEscaneo(datos('basura'))
    expect(resultado).toMatchObject({ ok: true, datos: { codigo: 'NO_RECONOCIDO' } })
  })

  test('sin configuración de la clave falla cerrado y no consulta nada', async () => {
    const { payload } = payloadValido()
    delete process.env.QR_CREDENCIAL_CLAVES
    const resultado = await registrarEscaneo(datos(payload))
    expect(resultado).toEqual({ ok: false, codigo: 'SERVICIO_NO_DISPONIBLE' })
    expect(llamadas).toHaveLength(0)
  })

  test('una clave inválida falla cerrado sin revelar la causa', async () => {
    process.env.QR_CREDENCIAL_CLAVES = 'k1:corta'
    const resultado = await registrarEscaneo(datos('cualquiera'))
    expect(resultado).toEqual({ ok: false, codigo: 'SERVICIO_NO_DISPONIBLE' })
    expect(llamadas).toHaveLength(0)
    expect(consola.join('\n')).not.toMatch(/corta|QR_CREDENCIAL/)
  })
})

test.describe('con firma válida se usa el cliente administrativo, sin el token del usuario', () => {
  test('la llamada lleva la clave de servicio, el actor de la sesión y la credencial del payload', async () => {
    const { credencialId, payload } = payloadValido()
    respuestas = [
      respuestaJson([
        { codigo_resultado: 'REGISTRADO', alumno_nombre: 'Ana', alumno_apellido: 'Prueba', alumno_legajo: 'LEG-1', sellado_en: '2026-10-05T15:00:00Z' },
      ]),
    ]
    const resultado = await registrarEscaneo(datos(payload, { sentido: 'IDA' }))

    expect(resultado).toEqual({
      ok: true,
      datos: {
        codigo: 'REGISTRADO',
        mensaje: expect.any(String),
        alumno: { nombre: 'Ana', apellido: 'Prueba', legajo: 'LEG-1' },
        registrado_en: '2026-10-05T15:00:00Z',
      },
    })

    expect(llamadas).toHaveLength(1)
    const llamada = llamadas[0]
    expect(new URL(llamada.url).pathname).toBe('/rest/v1/rpc/registrar_acceso_servicio')
    // El invocador es service_role: la clave de servicio, no un JWT de usuario.
    expect(llamada.encabezados.authorization).toBe(`Bearer ${CLAVE_SERVICIO}`)
    expect(llamada.encabezados.apikey).toBe(CLAVE_SERVICIO)
    expect(llamada.encabezados.cookie).toBeUndefined()
    expect(llamada.cuerpo).toEqual({
      p_actor_user_id: ACTOR,
      p_intento_id: INTENTO,
      p_credencial_id: credencialId,
      // El kid del payload verificado viaja para que la base lo compare con el de la credencial.
      p_clave_kid: 'k1',
      p_servicio_id: SERVICIO,
      p_sentido: 'IDA',
    })
    // El payload (ni su firma) viaja a la base: solo el identificador ya extraído.
    expect(JSON.stringify(llamada)).not.toContain(payload.split('.')[3])
    expect(JSON.stringify(llamada)).not.toContain(claveQr)
  })

  test('el comedor no envía sentido', async () => {
    respuestas = [respuestaJson([{ codigo_resultado: 'YA_REGISTRADO' }])]
    const resultado = await registrarEscaneo(datos(payloadValido().payload))
    expect(resultado).toEqual({ ok: true, datos: { codigo: 'YA_REGISTRADO', mensaje: expect.any(String) } })
    expect(llamadas[0].cuerpo).not.toHaveProperty('p_sentido')
  })

  test('una denegación nunca incluye nombre, apellido ni legajo, aunque la base los enviara', async () => {
    respuestas = [
      respuestaJson([{ codigo_resultado: 'NO_HABILITADO', alumno_nombre: 'Secreto', alumno_apellido: 'Interno', alumno_legajo: 'LEG-X' }]),
    ]
    const resultado = await registrarEscaneo(datos(payloadValido().payload))
    expect(resultado).toEqual({ ok: true, datos: { codigo: 'NO_HABILITADO', mensaje: expect.any(String) } })
    expect(JSON.stringify(resultado)).not.toMatch(/Secreto|Interno|LEG-X/)
  })

  test('INTENTO_REUTILIZADO es un error, no un resultado de negocio', async () => {
    respuestas = [respuestaJson([{ codigo_resultado: 'INTENTO_REUTILIZADO' }])]
    expect(await registrarEscaneo(datos(payloadValido().payload))).toEqual({ ok: false, codigo: 'INTENTO_REUTILIZADO' })
  })
})

test.describe('un fallo nunca se convierte en una aprobación', () => {
  const casosDeError: Array<[string, () => Response | Promise<Response>, string]> = [
    ['sin permiso en la base (42501)', respuestaJson({ code: '42501', message: 'permission denied' }, 403), 'SIN_PERMISO'],
    ['actor sin identidad (P5505)', respuestaJson({ code: 'P5505', message: 'x' }, 400), 'NO_AUTENTICADO'],
    ['servicio inexistente (P5652)', respuestaJson({ code: 'P5652', message: 'x' }, 400), 'SERVICIO_INVALIDO'],
    ['sentido incoherente (P5653)', respuestaJson({ code: 'P5653', message: 'x' }, 400), 'SERVICIO_INVALIDO'],
    ['argumentos inválidos (P5651)', respuestaJson({ code: 'P5651', message: 'x' }, 400), 'DATOS_INVALIDOS'],
    ['deadlock (40P01)', respuestaJson({ code: '40P01', message: 'x' }, 500), 'ERROR_INTERNO'],
    ['error desconocido', respuestaJson({ code: 'XX000', message: 'x' }, 500), 'ERROR_INTERNO'],
  ]
  for (const [nombre, respuesta, esperado] of casosDeError) {
    test(`${nombre} → ${esperado}`, async () => {
      respuestas = [respuesta]
      expect(await registrarEscaneo(datos(payloadValido().payload))).toEqual({ ok: false, codigo: esperado })
    })
  }

  test('un tiempo agotado es TIEMPO_AGOTADO (no sabemos si se registró)', async () => {
    respuestas = [
      () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      },
    ]
    expect(await registrarEscaneo(datos(payloadValido().payload))).toEqual({ ok: false, codigo: 'TIEMPO_AGOTADO' })
  })

  test('una caída de red es SERVICIO_NO_DISPONIBLE', async () => {
    respuestas = [
      () => {
        throw new TypeError('fetch failed')
      },
    ]
    expect(await registrarEscaneo(datos(payloadValido().payload))).toEqual({ ok: false, codigo: 'SERVICIO_NO_DISPONIBLE' })
  })

  test('sin la clave de servicio no hay cliente administrativo: falla cerrado', async () => {
    const { payload } = payloadValido()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await registrarEscaneo(datos(payload))).toEqual({ ok: false, codigo: 'SERVICIO_NO_DISPONIBLE' })
    expect(llamadas).toHaveLength(0)
  })

  for (const [nombre, cuerpo] of [
    ['código fuera del conjunto cerrado', [{ codigo_resultado: 'APROBADO' }]],
    ['código vacío', [{ codigo_resultado: '' }]],
    ['sin filas', []],
    ['sin cuerpo', null],
    ['REGISTRADO sin nombre', [{ codigo_resultado: 'REGISTRADO' }]],
  ] as Array<[string, unknown]>) {
    test(`${nombre} → ERROR_INTERNO, jamás una aprobación`, async () => {
      respuestas = [respuestaJson(cuerpo)]
      expect(await registrarEscaneo(datos(payloadValido().payload))).toEqual({ ok: false, codigo: 'ERROR_INTERNO' })
    })
  }

  test('nada sensible llega a la consola: ni payload, ni firma, ni claves, ni credencial', async () => {
    const { credencialId, payload } = payloadValido()
    respuestas = [respuestaJson({ code: '42501', message: `detalle con ${credencialId} y ${payload}` }, 403)]
    await registrarEscaneo(datos(payload))
    respuestas = [respuestaJson({ code: 'XX000', message: 'fallo' }, 500)]
    await registrarEscaneo(datos('basura'))
    const texto = consola.join('\n')
    expect(texto).not.toContain(payload)
    expect(texto).not.toContain(payload.split('.')[3])
    expect(texto).not.toContain(credencialId)
    expect(texto).not.toContain(claveQr)
    expect(texto).not.toContain(CLAVE_SERVICIO)
  })
})

test.describe('límite de solicitudes', () => {
  test('consume el cupo con el cliente administrativo y el actor de la sesión', async () => {
    respuestas = [respuestaJson([{ permitido: true, reintentar_en_segundos: 0 }])]
    expect(await consumirCupo(ACTOR)).toEqual({ ok: true, datos: { permitido: true, reintentarEnSegundos: 0 } })
    expect(new URL(llamadas[0].url).pathname).toBe('/rest/v1/rpc/consumir_cupo_escaneo')
    expect(llamadas[0].encabezados.authorization).toBe(`Bearer ${CLAVE_SERVICIO}`)
    expect(llamadas[0].cuerpo).toEqual({ p_actor_user_id: ACTOR })
  })

  test('un cupo agotado devuelve el tiempo de espera', async () => {
    respuestas = [respuestaJson([{ permitido: false, reintentar_en_segundos: 873 }])]
    expect(await consumirCupo(ACTOR)).toEqual({ ok: true, datos: { permitido: false, reintentarEnSegundos: 873 } })
  })

  test('un fallo al consumir el cupo NO permite seguir: falla cerrado', async () => {
    respuestas = [respuestaJson({ code: 'XX000', message: 'x' }, 500)]
    expect(await consumirCupo(ACTOR)).toEqual({ ok: false, codigo: 'ERROR_INTERNO' })
    respuestas = [respuestaJson([{}])]
    expect(await consumirCupo(ACTOR)).toEqual({ ok: false, codigo: 'ERROR_INTERNO' })
  })
})
