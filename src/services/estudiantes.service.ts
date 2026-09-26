import { traducirErrorDeLectura } from '@/lib/errores'
import { createClient } from '@/services/supabase'

/**
 * Consulta mínima de estudiantes para Asistencias y Cupos (EPT-58).
 *
 * Reemplaza la lectura directa de `perfiles` que hacían esas pantallas para la
 * dirección y los docentes. Devuelve exactamente el mismo conjunto —todos los
 * perfiles ESTUDIANTE— pero solo cuatro datos: identificador, nombre, apellido
 * y legajo. Sin DNI, domicilio, teléfono ni fecha de nacimiento.
 *
 * Es la única forma en que un docente sigue viendo los nombres cuando la
 * migración B le quite la lectura global de perfiles. No filtra por curso: ese
 * recorte requiere un contrato aparte.
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
