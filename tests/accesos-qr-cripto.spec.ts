import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { decodeQR } from 'qr/decode.js'
import { encodeQR } from 'qr'
import { cargarClavesQr } from '@/lib/credenciales-qr/claves'
import { construirPayload } from '@/lib/credenciales-qr/payload'
import {
  CATALOGO_ACCESOS,
  codigoDesdeSqlstate,
  cuerpoDeError,
  esResultadoEscaneo,
  MENSAJES_RESULTADO,
  RESULTADOS_ESCANEO,
} from '@/lib/accesos-qr/errores'
import { cuerpoAnulacionSchema, cuerpoRegistroSchema, filtrosAuditoriaSchema } from '@/lib/accesos-qr/esquemas'
import { origenPermitido } from '@/lib/accesos-qr/origen'
import { generarUuid } from '@/lib/accesos-qr/decodificar'
import { formatearMomentoBA, hoyBA } from '@/lib/accesos-qr/tipos'

/**
 * Lógica pura del registro de accesos con QR (EPT-65, RF21), sin base de datos
 * ni navegador: esquemas, origen, catálogo de respuestas, fechas de Buenos Aires
 * y decodificación de la imagen. TODAS las claves son EFÍMERAS.
 */

const claveB64 = () => randomBytes(32).toString('base64url')

function clavesEfimeras() {
  return cargarClavesQr({ QR_CREDENCIAL_KID_ACTIVA: 'k1', QR_CREDENCIAL_CLAVES: `k1:${claveB64()}` })
}

test.describe('esquema del cuerpo de registro: el escaneo viaja solo con el payload', () => {
  const valido = {
    payload: 'EPT1.k1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    intento_id: randomUUID(),
    servicio_id: randomUUID(),
  }

  test('acepta el cuerpo mínimo y el de transporte con sentido', () => {
    expect(cuerpoRegistroSchema.safeParse(valido).success).toBe(true)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, sentido: 'IDA' }).success).toBe(true)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, sentido: 'VUELTA' }).success).toBe(true)
  })

  test('un campo de identidad o de actor se rechaza: jamás puede viajar', () => {
    for (const extra of [
      { actor: randomUUID() },
      { actor_user_id: randomUUID() },
      { p_actor_user_id: randomUUID() },
      { credencial_id: randomUUID() },
      { alumno_id: randomUUID() },
      { legajo: 'LEG-1' },
      { dni: '12345678' },
      { operador: 'x' },
    ]) {
      expect(cuerpoRegistroSchema.safeParse({ ...valido, ...extra }).success, JSON.stringify(Object.keys(extra))).toBe(false)
    }
  })

  test('rechaza payload vacío o enorme, UUID inválidos y sentido desconocido', () => {
    expect(cuerpoRegistroSchema.safeParse({ ...valido, payload: '' }).success).toBe(false)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, payload: 'x'.repeat(513) }).success).toBe(false)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, intento_id: 'no-uuid' }).success).toBe(false)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, servicio_id: 7 }).success).toBe(false)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, sentido: 'ida' }).success).toBe(false)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, payload: 12 }).success).toBe(false)
    expect(cuerpoRegistroSchema.safeParse({ ...valido, intento_id: undefined }).success).toBe(false)
    expect(cuerpoRegistroSchema.safeParse({}).success).toBe(false)
  })

  test('el motivo de anulación mide entre 3 y 200 caracteres sin espacios laterales', () => {
    expect(cuerpoAnulacionSchema.safeParse({ motivo: 'abc' }).success).toBe(true)
    expect(cuerpoAnulacionSchema.safeParse({ motivo: '  abc  ' }).data?.motivo).toBe('abc')
    expect(cuerpoAnulacionSchema.safeParse({ motivo: 'ab' }).success).toBe(false)
    expect(cuerpoAnulacionSchema.safeParse({ motivo: 'x'.repeat(201) }).success).toBe(false)
    expect(cuerpoAnulacionSchema.safeParse({ motivo: 'x'.repeat(200) }).success).toBe(true)
    expect(cuerpoAnulacionSchema.safeParse({ motivo: 'a\u0000b c' }).success).toBe(false)
    expect(cuerpoAnulacionSchema.safeParse({ motivo: 'abc', extra: 1 }).success).toBe(false)
  })

  test('los filtros de la auditoría descartan lo inválido', () => {
    expect(filtrosAuditoriaSchema.safeParse({ dia: '2026-10-05', resultado: 'DENEGADO', pagina: '2' }).data).toEqual({
      dia: '2026-10-05',
      resultado: 'DENEGADO',
      pagina: 2,
    })
    expect(filtrosAuditoriaSchema.safeParse({ dia: '05/10/2026' }).success).toBe(false)
    expect(filtrosAuditoriaSchema.safeParse({ resultado: 'OTRO' }).success).toBe(false)
    expect(filtrosAuditoriaSchema.safeParse({ pagina: '0' }).success).toBe(false)
    expect(filtrosAuditoriaSchema.safeParse({ servicio: 'x' }).success).toBe(false)
  })
})

test.describe('origen de la petición (defensa en profundidad)', () => {
  const con = (encabezados: Record<string, string>) => new Headers(encabezados)

  test('el mismo origen se admite', () => {
    expect(origenPermitido(con({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true)
    expect(origenPermitido(con({ origin: 'https://ept.example', 'x-forwarded-host': 'ept.example', host: 'interno:3000' }))).toBe(true)
  })

  test('otro origen, otro puerto, Origin: null o ilegible se rechazan', () => {
    expect(origenPermitido(con({ origin: 'https://evil.example', host: 'localhost:3000' }))).toBe(false)
    expect(origenPermitido(con({ origin: 'http://localhost:3001', host: 'localhost:3000' }))).toBe(false)
    expect(origenPermitido(con({ origin: 'null', host: 'localhost:3000' }))).toBe(false)
    expect(origenPermitido(con({ origin: 'no es una url', host: 'localhost:3000' }))).toBe(false)
    expect(origenPermitido(con({ origin: 'http://localhost:3000' }))).toBe(false)
  })

  test('sin Origin, decide Sec-Fetch-Site; sin ninguno se admite (cliente que no es un navegador)', () => {
    expect(origenPermitido(con({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(origenPermitido(con({ 'sec-fetch-site': 'none' }))).toBe(true)
    expect(origenPermitido(con({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(origenPermitido(con({ 'sec-fetch-site': 'same-site' }))).toBe(false)
    expect(origenPermitido(con({}))).toBe(true)
  })
})

test.describe('catálogo de respuestas: conjunto cerrado y en español', () => {
  test('los cuatro resultados de negocio y nada más', () => {
    expect([...RESULTADOS_ESCANEO].sort()).toEqual(['NO_HABILITADO', 'NO_RECONOCIDO', 'REGISTRADO', 'YA_REGISTRADO'])
    expect(esResultadoEscaneo('REGISTRADO')).toBe(true)
    for (const raro of ['APROBADO', 'OK', 'DENEGADO', 'INTENTO_REUTILIZADO', '', null, undefined, 1]) {
      expect(esResultadoEscaneo(raro), String(raro)).toBe(false)
    }
  })

  test('una denegación nunca explica el motivo interno ni nombra al alumno', () => {
    for (const codigo of ['NO_HABILITADO', 'NO_RECONOCIDO', 'YA_REGISTRADO'] as const) {
      expect(MENSAJES_RESULTADO[codigo]).not.toMatch(
        /revocad|inactiv|bloquead|inscrip|recorrido|credencial|legajo|dni|alumn/i
      )
    }
  })

  test('todo error tiene mensaje en español, sin detalle técnico y estado coherente', () => {
    for (const [codigo, { estado, mensaje }] of Object.entries(CATALOGO_ACCESOS)) {
      expect(estado, codigo).toBeGreaterThanOrEqual(400)
      expect(mensaje, codigo).toMatch(/[a-záéíóúñ]{3,}/i)
      expect(mensaje, codigo).not.toMatch(/P5\d{3}|PGRST|SQLSTATE|supabase|postgres|constraint|violates|stack|service_role|clave|firma|hmac/i)
    }
    expect(CATALOGO_ACCESOS.LIMITE_EXCEDIDO.estado).toBe(429)
    expect(CATALOGO_ACCESOS.NO_AUTENTICADO.estado).toBe(401)
    expect(CATALOGO_ACCESOS.SIN_PERMISO.estado).toBe(403)
    expect(CATALOGO_ACCESOS.INTENTO_REUTILIZADO.estado).toBe(409)
    expect(CATALOGO_ACCESOS.TIEMPO_AGOTADO.estado).toBe(504)
    expect(cuerpoDeError('SIN_PERMISO')).toEqual({ error: CATALOGO_ACCESOS.SIN_PERMISO.mensaje, codigo: 'SIN_PERMISO' })
  })

  test('los SQLSTATE de la base se traducen a un código cerrado; lo desconocido es un error interno', () => {
    expect(codigoDesdeSqlstate('42501')).toBe('SIN_PERMISO')
    expect(codigoDesdeSqlstate('P5505')).toBe('NO_AUTENTICADO')
    expect(codigoDesdeSqlstate('P5651')).toBe('DATOS_INVALIDOS')
    expect(codigoDesdeSqlstate('P5652')).toBe('SERVICIO_INVALIDO')
    expect(codigoDesdeSqlstate('P5653')).toBe('SERVICIO_INVALIDO')
    expect(codigoDesdeSqlstate('P5663')).toBe('ACCESO_NO_ANULABLE')
    expect(codigoDesdeSqlstate('P5664')).toBe('MOTIVO_INVALIDO')
    expect(codigoDesdeSqlstate('P5665')).toBe('ACCESO_NO_ENCONTRADO')
    expect(codigoDesdeSqlstate('P5666')).toBe('ACCESO_ANONIMIZADO')
    expect(codigoDesdeSqlstate('P5667')).toBe('ACCESO_YA_ANULADO')
    expect(codigoDesdeSqlstate('40P01')).toBe('ERROR_INTERNO')
    expect(codigoDesdeSqlstate(null)).toBe('ERROR_INTERNO')
    expect(codigoDesdeSqlstate('XX000')).toBe('ERROR_INTERNO')
  })
})

test.describe('fechas de Buenos Aires', () => {
  test('el día es el de Buenos Aires y no el de UTC', () => {
    // 02:30 UTC del 10/03 son las 23:30 del 09/03 en Buenos Aires (UTC−3).
    expect(hoyBA(new Date('2030-03-10T02:30:00Z'))).toBe('2030-03-09')
    expect(hoyBA(new Date('2030-03-10T03:00:00Z'))).toBe('2030-03-10')
    expect(hoyBA(new Date('2030-12-31T23:59:59Z'))).toBe('2030-12-31')
  })

  test('la hora se formatea en 24 horas, sin espacios especiales', () => {
    expect(formatearMomentoBA('2030-03-10T02:30:05Z')).toEqual({ fecha: '09/03/2030', hora: '23:30:05' })
    expect(formatearMomentoBA('2030-03-10T15:00:00Z').hora).toBe('12:00:00')
    expect(formatearMomentoBA('2030-03-10T03:00:00Z').hora).toBe('00:00:00')
    expect(formatearMomentoBA('2030-03-10T15:00:00Z').hora).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  test('el intento_id es un UUID v4 válido, también sin crypto.randomUUID (contexto no seguro)', () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(generarUuid()).toMatch(v4)
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    const propio = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.crypto), 'randomUUID')
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
      const respaldo = new Set(Array.from({ length: 50 }, () => generarUuid()))
      expect(respaldo.size).toBe(50)
      for (const id of respaldo) expect(id).toMatch(v4)
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original)
      else delete (globalThis.crypto as unknown as Record<string, unknown>).randomUUID
      void propio
    }
  })
})

test.describe('decodificación del QR en el dispositivo', () => {
  test('un payload firmado se recupera íntegro desde su imagen a distintos tamaños', () => {
    const claves = clavesEfimeras()
    const id = randomUUID()
    const payload = construirPayload(id, 'k1', claves)
    for (const escala of [3, 4, 6, 8, 12]) {
      const matriz = encodeQR(payload, 'raw')
      const borde = 4
      const lado = (matriz.length + borde * 2) * escala
      const pixeles = new Uint8ClampedArray(lado * lado * 4).fill(255)
      for (let fila = 0; fila < matriz.length; fila += 1) {
        for (let col = 0; col < matriz.length; col += 1) {
          if (!matriz[fila][col]) continue
          for (let dy = 0; dy < escala; dy += 1) {
            for (let dx = 0; dx < escala; dx += 1) {
              const i = (((fila + borde) * escala + dy) * lado + (col + borde) * escala + dx) * 4
              pixeles[i] = pixeles[i + 1] = pixeles[i + 2] = 0
            }
          }
        }
      }
      expect(decodeQR({ width: lado, height: lado, data: pixeles }), `escala ${escala}`).toBe(payload)
    }
  })

  test('una imagen sin QR no produce texto (no se interpreta como lectura)', () => {
    const lado = 200
    const blanco = new Uint8ClampedArray(lado * lado * 4).fill(255)
    expect(() => decodeQR({ width: lado, height: lado, data: blanco })).toThrow()
  })

  test('el formato GIF de la fotografía conserva la forma del payload', () => {
    const claves = clavesEfimeras()
    const payload = construirPayload(randomUUID(), 'k1', claves)
    const gif = encodeQR(payload, 'gif', { scale: 6, border: 4 })
    expect(Buffer.from(gif).subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/)
  })
})
