import { traducirErrorDeLectura } from '@/lib/errores'
import { createClient } from '@/services/supabase'

/**
 * Consulta mínima de estudiantes para la gestión (EPT-58, acotada en EPT-66 D).
 *
 * Reemplaza la lectura directa de `perfiles` que hacían las pantallas de la
 * dirección y los docentes. Devuelve solo cuatro datos: identificador, nombre,
 * apellido y legajo. Sin DNI, domicilio, teléfono ni fecha de nacimiento.
 *
 * El conjunto depende del rol, y lo decide PostgreSQL: Dirección recibe a todos
 * los estudiantes; un DOCENTE, únicamente a quienes tienen un vínculo vigente
 * con él (matrícula vigente en un curso donde dicta una materia activa, o
 * inscripción deportiva activa en un grupo activo que dicta). Es la misma regla
 * que acota la lectura y el registro de asistencias.
 *
 * Asistencias del personal usa `/api/asistencias`; esta función sigue siendo la
 * consulta del listado para las pantallas que lo necesitan (Cupos, de Dirección).
 */

export type EstudianteDeGestion = {
  id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
}

export async function listarEstudiantesParaGestion(): Promise<EstudianteDeGestion[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('listar_estudiantes_para_gestion')
  if (error) throw traducirErrorDeLectura(error)
  return ((data ?? []) as EstudianteDeGestion[]).map(({ id, nombre, apellido, legajo_nro }) => ({
    id,
    nombre,
    apellido,
    legajo_nro: legajo_nro ?? null,
  }))
}

/** Índice por identificador para resolver nombres de filas de asistencias o inscripciones. */
export function indexarEstudiantes(estudiantes: EstudianteDeGestion[]) {
  return new Map(estudiantes.map((estudiante) => [estudiante.id, estudiante]))
}

/**
 * Texto que se muestra cuando una fila referencia a alguien que no está en la
 * consulta (por ejemplo, un perfil que ya no es ESTUDIANTE). No se inventa un
 * nombre ni se oculta la fila.
 */
export const ESTUDIANTE_NO_DISPONIBLE = 'Estudiante no disponible'
