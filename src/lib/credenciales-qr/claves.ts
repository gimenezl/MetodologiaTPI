/**
 * Claves de firma de la credencial QR (EPT-64, RF20).
 *
 * La clave vive SOLO en la configuración del servidor. Nunca en la base, en el
 * repositorio, en el bundle del cliente, en pruebas capturadas, en logs ni en
 * mensajes de error. Este módulo no imprime ni devuelve el valor de una clave
 * en ningún camino de error: los mensajes nombran el problema, no el secreto.
 *
 * Configuración (dos variables de servidor, SIN el prefijo NEXT_PUBLIC_):
 *
 *   QR_CREDENCIAL_KID_ACTIVA   identificador de la clave con la que se FIRMAN las
 *                              credenciales nuevas. Ejemplo: `k1`.
 *   QR_CREDENCIAL_CLAVES       lista `kid:clave` separada por comas. La clave es
 *                              base64url (RFC 4648 §5, sin relleno) de al menos
 *                              32 bytes aleatorios. Ejemplo (NO es una clave):
 *                              `k1:<43 o más caracteres base64url>`.
 *
 * Rotación: se agrega la clave nueva a `QR_CREDENCIAL_CLAVES` conservando las
 * viejas, se cambia `QR_CREDENCIAL_KID_ACTIVA` y se despliega. Las credenciales
 * ya emitidas siguen verificándose con la clave con la que se firmaron (su
 * `kid` está en la base); las nuevas usan la activa. Una clave vieja se retira
 * solo cuando ya no queda ninguna credencial ACTIVA con ese `kid`.
 *
 * Falla cerrado: si falta una variable, si una clave es corta, repetida o mal
 * codificada, o si la activa no está en la lista, `cargarClavesQr` lanza
 * `ErrorConfiguracionQr` y ningún código emite ni verifica nada.
 */

/** Identificador de clave: minúsculas y dígitos; sin puntos, que separan el payload. */
export const PATRON_KID = /^[a-z0-9]{1,16}$/

/** Longitud mínima de una clave HMAC-SHA256: el tamaño del bloque de salida. */
export const BYTES_MINIMOS_CLAVE = 32

const MAXIMO_DE_CLAVES = 8

const PATRON_BASE64URL = /^[A-Za-z0-9_-]+$/

/** Error de configuración. El mensaje nunca contiene material de clave. */
export class ErrorConfiguracionQr extends Error {
  constructor(motivo: string) {
    super(`Configuración de la credencial QR inválida: ${motivo}.`)
    this.name = 'ErrorConfiguracionQr'
  }
}

/** Clave solicitada para un `kid` que la configuración no conoce. */
export class ErrorClaveNoDisponible extends Error {
  constructor() {
    super('La clave de firma solicitada no está disponible.')
    this.name = 'ErrorClaveNoDisponible'
  }
}

export type ClavesQr = {
  /** `kid` con el que se firman las credenciales nuevas. */
  readonly kidActivo: string
  /** Todas las claves conocidas, por `kid`. */
  readonly claves: ReadonlyMap<string, Uint8Array>
}

type Entorno = Readonly<Record<string, string | undefined>>

function decodificarClave(texto: string): Uint8Array {
  if (!PATRON_BASE64URL.test(texto)) {
    throw new ErrorConfiguracionQr('una clave no está codificada en base64url')
  }
  const bytes = Buffer.from(texto, 'base64url')
  // Ida y vuelta: rechaza codificaciones no canónicas o con bits sobrantes.
  if (bytes.toString('base64url') !== texto) {
    throw new ErrorConfiguracionQr('una clave no está codificada en base64url canónico')
  }
  if (bytes.length < BYTES_MINIMOS_CLAVE) {
    throw new ErrorConfiguracionQr(`una clave tiene menos de ${BYTES_MINIMOS_CLAVE} bytes`)
  }
  // Una clave de un solo byte repetido no es aleatoria: es un valor de relleno.
  if (bytes.every((byte) => byte === bytes[0])) {
    throw new ErrorConfiguracionQr('una clave es un valor de relleno y no aleatoria')
  }
  return new Uint8Array(bytes)
}

/**
 * Lee y valida la configuración. Se llama en cada operación del servidor (no se
 * memoiza en un módulo) para que una rotación tome efecto con el despliegue y
 * para que las pruebas usen claves efímeras propias.
 */
export function cargarClavesQr(entorno: Entorno = process.env): ClavesQr {
  const kidActivo = entorno.QR_CREDENCIAL_KID_ACTIVA?.trim()
  const lista = entorno.QR_CREDENCIAL_CLAVES?.trim()

  if (!kidActivo) throw new ErrorConfiguracionQr('falta el identificador de la clave activa')
  if (!lista) throw new ErrorConfiguracionQr('faltan las claves de firma')
  if (!PATRON_KID.test(kidActivo)) {
    throw new ErrorConfiguracionQr('el identificador de la clave activa tiene un formato inválido')
  }

  const claves = new Map<string, Uint8Array>()
  for (const par of lista.split(',')) {
    const posicion = par.indexOf(':')
    if (posicion === -1) throw new ErrorConfiguracionQr('una entrada no tiene el formato kid:clave')
    const kid = par.slice(0, posicion).trim()
    const valor = par.slice(posicion + 1).trim()
    if (!PATRON_KID.test(kid)) {
      throw new ErrorConfiguracionQr('un identificador de clave tiene un formato inválido')
    }
    if (claves.has(kid)) throw new ErrorConfiguracionQr('un identificador de clave está repetido')
    claves.set(kid, decodificarClave(valor))
    if (claves.size > MAXIMO_DE_CLAVES) {
      throw new ErrorConfiguracionQr(`hay más de ${MAXIMO_DE_CLAVES} claves`)
    }
  }

  if (!claves.has(kidActivo)) {
    throw new ErrorConfiguracionQr('la clave activa no figura en la lista de claves')
  }

  return { kidActivo, claves }
}

/** La clave de un `kid`, o `ErrorClaveNoDisponible` si la configuración no la tiene. */
export function claveDe(claves: ClavesQr, kid: string): Uint8Array {
  const clave = claves.claves.get(kid)
  if (!clave) throw new ErrorClaveNoDisponible()
  return clave
}
