export type ActividadConCupo = {
  id: number
  nombre: string
  tipo: string | null
  cupo_maximo: number
  inscriptos: number
  cupo_disponible: number
  porcentaje_ocupacion: number
  nivel: { nombre: string } | null
}

/**
 * Inscripción activa de la vista de gestión. Trae solo `estudiante_id`: el
 * nombre y el legajo se resuelven con la consulta mínima de estudiantes
 * (EPT-58), que un docente conserva cuando pierda la lectura global de perfiles.
 */
export type Inscripcion = {
  id: string
  estudiante_id: string | null
}

export type Estudiante = {
  id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
}

export type Rol = { id: number; nombre: string }

export type PropiedadesVistaCupos = {
  actividades: ActividadConCupo[]
  cargando: boolean
  recargarActividades: () => Promise<void>
}

export const variantePorTipo: Record<string, 'info' | 'success' | 'warning'> = {
  DEPORTE: 'success',
  CURRICULAR: 'info',
  TALLER: 'warning',
}

/**
 * Desde EPT-11 las inscripciones deportivas se hacen por grupo en
 * `/dashboard/deportes`. Las actividades DEPORTE de esta pantalla son
 * históricas: se muestran con sus inscriptos, pero no ofrecen alta, baja ni
 * ajuste de cupo. La base también rechaza cualquier escritura (P5582); ocultar
 * los controles solo evita ofrecer una acción que siempre fallaría.
 */
export function esDeporteLegado(actividad: Pick<ActividadConCupo, 'tipo'>) {
  return actividad.tipo === 'DEPORTE'
}

export const AVISO_DEPORTE_LEGADO =
  'Histórico: las inscripciones deportivas ahora se hacen por grupo en la sección Deportes.'
