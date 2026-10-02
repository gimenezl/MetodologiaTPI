import type { EstadoAsistencia } from '@/lib/asistencias'

export type Estudiante = { id: string; nombre: string; apellido: string; legajo_nro: string | null }

/**
 * La vista de gestión recibe del servidor solo `estudiante_id` y resuelve el
 * nombre con la lista de alumnos que la sesión puede gestionar (un DOCENTE ve
 * únicamente a los alumnos con vínculo vigente; EPT-66 D). La vista del alumno
 * y del padre conserva la lectura de su propio perfil o el de sus hijos.
 */
export type AsistenciaRow = {
  id: string
  fecha: string
  estado: EstadoAsistencia
  estudiante_id: string | null
  estudiante?: Estudiante | null
}

export const estadoBadge: Record<string, { variant: 'success' | 'danger' | 'warning'; label: string }> = {
  PRESENTE: { variant: 'success', label: 'Presente' },
  AUSENTE: { variant: 'danger', label: 'Ausente' },
  JUSTIFICADO: { variant: 'warning', label: 'Justificado' },
}
