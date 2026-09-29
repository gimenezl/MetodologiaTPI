import { createHmac, timingSafeEqual } from 'node:crypto'
import { claveDe, PATRON_KID, type ClavesQr } from '@/lib/credenciales-qr/claves'

/**
 * Formato y firma del payload del QR (EPT-64, RF20).
 *
 * Verificador PURO: no importa ni conoce la base de datos, Supabase ni Next.js.
 * Que sea puro es una garantía de diseño: la firma se comprueba ANTES de
 * cualquier consulta de estado, y los tests lo prueban con un consultor falso.
 *
 * Formato (texto ASCII, no es una URL):
 *
 *     EPT1.<kid>.<id>.<firma>
 *
 *   EPT1    versión del formato. Una versión desconocida se rechaza.
 *   kid     identificador de la clave de servidor con la que se firmó.
 *   id      identificador aleatorio de la credencial (UUID de 16 bytes) en
 *           base64url sin relleno: 22 caracteres.
 *   firma   HMAC-SHA256 de 32 bytes en base64url sin relleno: 43 caracteres.
 *
 * NO contiene nombre, DNI, legajo, curso, rol ni inscripciones: el payload no
 * revela nada de la persona ni siquiera a quien lo lea sin la clave.
 *
 * Mensaje firmado (inequívoco: los campos van separados por un byte 0x00 que ni
 * el `kid` ni el prefijo pueden contener, y el identificador tiene longitud fija):
 *
 *     "EPT-QR-V1" || 0x00 || kid || 0x00 || id(16 bytes)
 *
 * La firma no cubre datos que el payload no lleve, y el estado de la credencial
 * (vigente, revocada, alumno inactivo) NO forma parte de ella: se consulta al
 * verificar. Por eso el QR es estático y no caduca solo.
 *
 * Primitivas: `node:crypto` (HMAC-SHA256 y `timingSafeEqual`). No se implementa
 * ninguna primitiva a mano.
 */

export const VERSION_PAYLOAD = 'EPT1'

const DOMINIO_DE_FIRMA = 'EPT-QR-V1'
const BYTES_ID = 16
const BYTES_FIRMA = 32
const LARGO_ID = 22 // base64url de 16 bytes, sin relleno
const LARGO_FIRMA = 43 // base64url de 32 bytes, sin relleno
/** Tope de entrada: acota el trabajo antes de mirar el contenido. */
const LARGO_MAXIMO_PAYLOAD = 128

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PATRON_ID_B64 = /^[A-Za-z0-9_-]{22}$/
const PATRON_FIRMA_B64 = /^[A-Za-z0-9_-]{43}$/

/** Por qué se rechazó un payload. Es información INTERNA: la API pública no la distingue. */
export type MotivoRechazoPayload = 'FORMATO' | 'VERSION' | 'KID_DESCONOCIDO' | 'FIRMA'

export type ResultadoVerificacionPayload =
  | { ok: true; id: string; kid: string }
  | { ok: false; motivo: MotivoRechazoPayload }

function uuidABytes(id: string): Buffer {
  if (!PATRON_UUID.test(id)) throw new TypeError('El identificador de la credencial no es un UUID válido.')
  return Buffer.from(id.replaceAll('-', ''), 'hex')
}

function bytesAUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function mensajeFirmado(kid: string, idBytes: Uint8Array): Buffer {
  return Buffer.concat([
    Buffer.from(DOMINIO_DE_FIRMA, 'utf8'),
    Buffer.from([0]),
    Buffer.from(kid, 'utf8'),
    Buffer.from([0]),
    Buffer.from(idBytes),
  ])
}

function firmar(clave: Uint8Array, kid: string, idBytes: Uint8Array): Buffer {
  return createHmac('sha256', clave).update(mensajeFirmado(kid, idBytes)).digest()
}

/** Decodifica base64url rechazando cualquier forma no canónica (relleno, bits sobrantes, alfabeto). */
function decodificarCanonico(texto: string, largoEsperado: number, patron: RegExp): Buffer | null {
  if (!patron.test(texto)) return null
  const bytes = Buffer.from(texto, 'base64url')
  if (bytes.length !== largoEsperado || bytes.toString('base64url') !== texto) return null
  return bytes
}

/**
 * Construye el payload firmado de una credencial con la clave de su `kid`.
 * Lanza `ErrorClaveNoDisponible` si la configuración no conoce ese `kid`.
 */
export function construirPayload(id: string, kid: string, claves: ClavesQr): string {
  if (!PATRON_KID.test(kid)) throw new TypeError('El identificador de clave no es válido.')
  const idBytes = uuidABytes(id)
  const firma = firmar(claveDe(claves, kid), kid, idBytes)
  return [VERSION_PAYLOAD, kid, idBytes.toString('base64url'), firma.toString('base64url')].join('.')
}

/**
 * Verifica formato, versión, `kid` y firma. NO consulta ningún estado.
 *
 * La comparación de la firma es en tiempo constante. Cuando el `kid` es
 * desconocido igualmente se calcula un HMAC con una clave nula del mismo
 * tamaño, para que el tiempo de respuesta no distinga «kid desconocido» de
 * «firma incorrecta».
 */
export function verificarPayload(texto: unknown, claves: ClavesQr): ResultadoVerificacionPayload {
  if (typeof texto !== 'string' || texto.length === 0 || texto.length > LARGO_MAXIMO_PAYLOAD) {
    return { ok: false, motivo: 'FORMATO' }
  }
  // Solo ASCII imprimible: rechaza saltos de línea, NUL y Unicode antes de partir.
  if (!/^[\x21-\x7e]+$/.test(texto)) return { ok: false, motivo: 'FORMATO' }

  const partes = texto.split('.')
  if (partes.length !== 4) return { ok: false, motivo: 'FORMATO' }
  const [version, kid, idTexto, firmaTexto] = partes

  if (version !== VERSION_PAYLOAD) {
    // Un formato reconocible con otra versión se distingue de la basura, solo por dentro.
    return { ok: false, motivo: /^EPT[0-9]+$/.test(version) ? 'VERSION' : 'FORMATO' }
  }
  if (!PATRON_KID.test(kid)) return { ok: false, motivo: 'FORMATO' }

  const idBytes = decodificarCanonico(idTexto, BYTES_ID, PATRON_ID_B64)
  const firmaRecibida = decodificarCanonico(firmaTexto, BYTES_FIRMA, PATRON_FIRMA_B64)
  if (!idBytes || !firmaRecibida) return { ok: false, motivo: 'FORMATO' }

  const claveConocida = claves.claves.get(kid)
  const esperada = firmar(claveConocida ?? new Uint8Array(BYTES_FIRMA), kid, idBytes)
  const coincide = timingSafeEqual(esperada, firmaRecibida)

  if (!claveConocida) return { ok: false, motivo: 'KID_DESCONOCIDO' }
  if (!coincide) return { ok: false, motivo: 'FIRMA' }
  return { ok: true, id: bytesAUuid(idBytes), kid }
}
