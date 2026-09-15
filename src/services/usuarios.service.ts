import {
  ErrorDeDominio,
  errorDesdeRespuesta,
  esCodigoDeError,
  traducirErrorDeLectura,
} from '@/lib/errores'
import { esAusenciaDeLaTablaDeVinculos } from '@/lib/vinculos'
import { createClient } from '@/services/supabase'

export type CrearUsuarioPayload = {
  /**
   * Clave de idempotencia del envío (UUID v4). El formulario la genera una vez
   * y la conserva mientras reintenta el mismo alta: así un reintento después de
   * un resultado incierto nunca duplica la cuenta.
   */
  operacion_id: string
  email: string
  password: string
  nombre: string
  apellido: string
  dni: string
  rol_id: number
  telefono?: string
  direccion?: string
  legajo_nro?: string
}

export type AltaConfirmada = { ok: true; user_id: string; reconciliada: boolean }

/**
 * Genera la clave de idempotencia de un envío: un UUID versión 4.
 *
 * `crypto.randomUUID` solo existe en contextos seguros (HTTPS o localhost). En
 * cualquier otro se arma el mismo formato con `crypto.getRandomValues`, que
 * también es criptográficamente aleatorio.
 */
export function nuevoIdentificadorDeOperacion(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Cuánto espera el navegador la respuesta del alta, en milisegundos.
 *
 * Tiene que ser mayor que el plazo que se toma el servidor para reintentar y
 * reconciliar; si no, el navegador abandonaría un alta que el servidor todavía
 * está confirmando.
 */
export const LIMITE_DEL_ALTA_EN_NAVEGADOR_MS = 60_000

/**
 * Pide el alta de una cuenta con su perfil.
 *
 * Devuelve el alta confirmada o lanza un `ErrorDeDominio`. Nunca lanza el
 * mensaje de otra cosa.
 *
 * Cuando no hay una respuesta de nuestra API que diga qué pasó —la conexión se
 * cortó, se cumplió el límite, respondió un intermediario— el alta pudo haberse
 * confirmado igual. Eso se informa como `ALTA_SIN_CONFIRMAR` y no como un fallo
 * limpio: decir «no se creó» sería afirmar algo que no se sabe.
 */
export async function crearUsuario(payload: CrearUsuarioPayload): Promise<AltaConfirmada> {
  let respuesta: Response
  try {
    respuesta = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LIMITE_DEL_ALTA_EN_NAVEGADOR_MS),
    })
  } catch {
    throw new ErrorDeDominio('ALTA_SIN_CONFIRMAR')
  }

  const cuerpo: unknown = await respuesta.json().catch(() => null)
  const datos = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as Record<
    string,
    unknown
  >

  if (respuesta.ok) {
    if (datos.ok === true && typeof datos.user_id === 'string') {
      return { ok: true, user_id: datos.user_id, reconciliada: datos.reconciliada === true }
    }
    throw new ErrorDeDominio('ALTA_SIN_CONFIRMAR')
  }

  if (esCodigoDeError(datos.codigo)) {
    throw errorDesdeRespuesta(datos, respuesta.status)
  }
  // Una respuesta sin nuestro código de dominio no la escribió la ruta. Un 401
  // o un 403 de un intermediario ocurren antes de cualquier escritura; lo demás
  // no permite saber si el alta llegó a confirmarse.
  if (respuesta.status === 401 || respuesta.status === 403) {
    throw errorDesdeRespuesta(null, respuesta.status)
  }
  throw new ErrorDeDominio('ALTA_SIN_CONFIRMAR')
}

export type RelacionFamiliar = { padre_id: string; hijo_id: string }

/**
 * Mensaje único del vínculo parental, compartido por la lectura y la escritura.
 *
 * `padres_hijos` existe desde la reconciliación 011, pero la escritura completa
 * y su interfaz pertenecen a EPT-13.
 */
export const VINCULO_PARENTAL_NO_DISPONIBLE =
  'Los vínculos entre padres o tutores e hijos todavía no están disponibles.'

/**
 * Devuelve los vínculos padre/tutor ↔ hijo que existan.
 *
 * Degrada a una lista vacía únicamente ante la ausencia exacta de
 * `public.padres_hijos` durante una transición de despliegue (ver
 * `src/lib/vinculos.ts`). La pantalla de usuarios carga roles, perfiles y
 * vínculos juntos, así que una caché todavía desactualizada no debe impedir un
 * alta que no solicita tutor.
 *
 * Cualquier otro error se propaga como error de dominio: un problema de red, de
 * permisos, de configuración o la ausencia de otra tabla tienen que llegar a la
 * interfaz y verse. Devolver una lista vacía ante un fallo real haría creer que
 * no hay vínculos.
 */
export async function obtenerRelacionesFamiliares(): Promise<RelacionFamiliar[]> {
  const supabase = createClient()
  const { data, error, status } = await (supabase
    .from('padres_hijos')
    .select('padre_id, hijo_id') as unknown as Promise<{
      data: RelacionFamiliar[] | null
      error: unknown
      status: number
    }>)

  if (error) {
    if (esAusenciaDeLaTablaDeVinculos(error, status)) return []
    throw traducirErrorDeLectura(error)
  }
  return data ?? []
}

/*
 * No existen `setHijosDePadre` ni `setTutorDeHijo` (EPT-9).
 *
 * Escribían el vínculo después de crear la cuenta de Auth y el perfil, de modo
 * que cualquier falla dejaba un alta parcial. La escritura parental vuelve con
 * EPT-13 cuando exista una operación atómica completa; hasta entonces la
 * interfaz la informa en lugar de intentarla.
 */
