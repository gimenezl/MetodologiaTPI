/**
 * Inscripciones legadas a talleres y actividades (EPT-66, decisión D1=A).
 *
 * Lógica pura —sin Supabase ni React— para que se pueda probar sin base de
 * datos: la traducción de los errores de las funciones de PostgreSQL a mensajes
 * en español y el contrato de las filas que devuelven.
 *
 * Códigos que emiten las funciones `*_legada` (ver la migración de expansión):
 *   P5505  sin identidad autenticada
 *   42501  rol sin competencia (DOCENTE, PERSONAL, sin perfil o cuenta bloqueada)
 *   P6602  alumno o inscripción no disponible (inexistente, ajena o no estudiante)
 *   P6603  la actividad no existe
 *   P6604  la actividad está inactiva
 *   P6607  la inscripción ya estaba dada de baja
 *   P5582  actividad DEPORTE: se inscribe por grupo (EPT-11)
 *   23505  el alumno ya tiene una inscripción activa en la actividad
 *   23514  cupo completo
 */

export type ErrorRpc = { code?: string | null; message?: string | null } | null | undefined

export type InscripcionLegada = {
  id: string
  estudiante_id: string
  actividad_id: number
  estado: 'ACTIVO' | 'BAJA'
  fecha_inscripcion: string
  fecha_baja: string | null
  actividad: { nombre: string; tipo: string | null; cupo_maximo: number }
}

/** Fila tal como la devuelve `listar_inscripciones_actividades_legadas`. */
export type FilaInscripcionLegada = {
  id: string
  estudiante_id: string
  actividad_id: number
  estado: string
  fecha_inscripcion: string
  fecha_baja: string | null
  actividad_nombre: string
  actividad_tipo: string | null
  cupo_maximo: number
}

const SESION_VENCIDA = 'Tu sesión venció. Volvé a iniciar sesión.'
const SIN_COMPETENCIA = 'Tu rol no puede gestionar inscripciones a actividades.'
const ALUMNO_NO_DISPONIBLE = 'El alumno solicitado no está disponible.'

export function mensajeDeAlta(error: ErrorRpc): string {
  switch (error?.code) {
    case 'P5582':
      return 'Las inscripciones deportivas se hacen por grupo en la sección Deportes.'
    case '23505':
      return 'Este alumno ya está inscripto en esta actividad.'
    case '23514':
      return 'El cupo para esta actividad está completo.'
    case 'P6603':
      return 'La actividad solicitada no existe.'
    case 'P6604':
      return 'La actividad no está disponible para inscribirse.'
    case 'P6602':
      return ALUMNO_NO_DISPONIBLE
    case '42501':
      return SIN_COMPETENCIA
    case 'P5505':
      return SESION_VENCIDA
    default:
      return 'No se pudo inscribir al alumno. Intentá nuevamente.'
  }
}

export function mensajeDeBaja(error: ErrorRpc): string {
  switch (error?.code) {
    case 'P5582':
      return 'Las inscripciones deportivas anteriores son históricas y no se pueden modificar.'
    case 'P6607':
      return 'La inscripción ya estaba dada de baja.'
    case 'P6602':
      return 'La inscripción solicitada no está disponible.'
    case '42501':
      return SIN_COMPETENCIA
    case 'P5505':
      return SESION_VENCIDA
    default:
      return 'No se pudo dar de baja. Intentá nuevamente.'
  }
}

export function mensajeDeLectura(error: ErrorRpc): string {
  switch (error?.code) {
    case 'P6602':
      return ALUMNO_NO_DISPONIBLE
    case '42501':
      return 'Tu rol no puede consultar estas inscripciones.'
    case 'P5505':
      return SESION_VENCIDA
    default:
      return 'No se pudieron cargar las inscripciones. Intentá nuevamente.'
  }
}

/** Convierte una fila de la función de lectura en la forma que usan las pantallas. */
export function inscripcionDesdeFila(fila: FilaInscripcionLegada): InscripcionLegada {
  return {
    id: fila.id,
    estudiante_id: fila.estudiante_id,
    actividad_id: fila.actividad_id,
    estado: fila.estado === 'BAJA' ? 'BAJA' : 'ACTIVO',
    fecha_inscripcion: fila.fecha_inscripcion,
    fecha_baja: fila.fecha_baja,
    actividad: {
      nombre: fila.actividad_nombre,
      tipo: fila.actividad_tipo,
      cupo_maximo: fila.cupo_maximo,
    },
  }
}

/** Fila de `consultar_cupos_actividades_legadas`: solo conteos, ningún alumno. */
export type FilaCupoActividad = { actividad_id: number; inscriptos: number }

/** Ocupación por actividad a partir de las filas agregadas; las ausentes cuentan 0. */
export function ocupacionPorActividad(filas: FilaCupoActividad[] | null | undefined): Map<number, number> {
  const mapa = new Map<number, number>()
  for (const fila of filas ?? []) mapa.set(fila.actividad_id, Number(fila.inscriptos) || 0)
  return mapa
}
