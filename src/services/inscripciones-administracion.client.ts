import type { DominioInscripcion } from '@/lib/validations'
import type {
  CancelacionInscripcion,
  CodigoErrorInscripciones,
  ConfirmacionInscripcion,
} from '@/services/inscripciones-administracion.service'

/**
 * Cliente del navegador para la administración de inscripciones (EPT-62, RF16).
 *
 * Las importaciones de arriba son solo de tipos: se borran al compilar y no
 * arrastran `next/headers` al paquete del navegador.
 *
 * Nunca lanza: devuelve un resultado tipado, con el mensaje ya en español, para
 * que el componente decida cómo mostrarlo. El alumno, el rol y el actor no
 * viajan: la petición solo identifica la inscripción por dominio e id, y quién
 * opera lo deriva el servidor de la sesión.
 */

export type ResultadoRemotoInscripciones<T> =
  | { ok: true; datos: T }
  | {
      ok: false
      /** Estado HTTP, o `0` si la petición no llegó a completarse. */
      estado: number
      mensaje: string
      codigo?: CodigoErrorInscripciones
      campo?: string
    }

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentarlo.'
const MENSAJE_SIN_CONEXION =
  'No pudimos comunicarnos con el servidor. Revisá tu conexión y volvé a intentarlo.'

async function enviar<T>(
  operacion: 'confirmacion' | 'cancelacion',
  dominio: DominioInscripcion,
  id: string,
  extraer: (cuerpo: Record<string, unknown>) => T | null
): Promise<ResultadoRemotoInscripciones<T>> {
  let respuesta: Response
  try {
    respuesta = await fetch(
      `/api/inscripciones/${encodeURIComponent(dominio)}/${encodeURIComponent(id)}/${operacion}`,
      { method: 'POST', cache: 'no-store' }
    )
  } catch {
    return { ok: false, estado: 0, mensaje: MENSAJE_SIN_CONEXION }
  }

  const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>

  if (!respuesta.ok) {
    return {
      ok: false,
      estado: respuesta.status,
      mensaje: typeof cuerpo.error === 'string' ? cuerpo.error : MENSAJE_GENERICO,
      codigo: typeof cuerpo.codigo === 'string' ? (cuerpo.codigo as CodigoErrorInscripciones) : undefined,
      campo: typeof cuerpo.campo === 'string' ? cuerpo.campo : undefined,
    }
  }

  const datos = extraer(cuerpo)
  if (!datos) return { ok: false, estado: respuesta.status, mensaje: MENSAJE_GENERICO }
  return { ok: true, datos }
}

/** Confirma una inscripción o una matrícula. Repetirla es inocuo (`ya_confirmada`). */
export function confirmarInscripcionRemota(dominio: DominioInscripcion, id: string) {
  return enviar<ConfirmacionInscripcion>('confirmacion', dominio, id, (cuerpo) =>
    typeof cuerpo.confirmacion === 'object' && cuerpo.confirmacion !== null
      ? (cuerpo.confirmacion as ConfirmacionInscripcion)
      : null
  )
}

/**
 * Baja lógica administrativa. Para una matrícula el servidor responde 400 con
 * el motivo: no existe cancelación de matrícula, solo el cierre desde Alumnos.
 */
export function cancelarInscripcionAdministrativaRemota(dominio: DominioInscripcion, id: string) {
  return enviar<CancelacionInscripcion>('cancelacion', dominio, id, (cuerpo) =>
    typeof cuerpo.inscripcion === 'object' && cuerpo.inscripcion !== null
      ? (cuerpo.inscripcion as CancelacionInscripcion)
      : null
  )
}
