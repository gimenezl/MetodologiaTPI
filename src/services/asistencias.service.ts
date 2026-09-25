/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@/services/supabase'

export async function registrarAsistencia(datos: {
  estudiante_id: string | null
  fecha?: string
  estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
  docente_id?: string | null
}) {
  const supabase = createClient()
  const { error } = await (supabase
    .from('asistencias')
    .insert(datos as any) as any)
  if (error) throw new Error(error.message)
  return true
}

export async function actualizarAsistencia(
  id: string,
  estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
) {
  const supabase = createClient()
  const { error } = await (supabase
    .from('asistencias')
    .update({ estado } as any)
    .eq('id', id) as any)
  if (error) throw new Error(error.message)
  return true
}

export async function obtenerAsistenciasPorAlumno(estudianteId: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('asistencias')
    .select('*')
    .eq('estudiante_id', estudianteId)
    .order('fecha', { ascending: false }) as any)
  if (error) throw new Error(error.message)
  return data
}

export async function obtenerTodasAsistencias(fecha?: string) {
  const supabase = createClient()
  let query: any = supabase
    .from('asistencias')
    .select(`
      *,
      estudiante:perfiles!asistencias_estudiante_id_fkey(id, nombre, apellido, legajo_nro),
      docente:perfiles!asistencias_docente_id_fkey(id, nombre, apellido)
    `)
    .order('fecha', { ascending: false })

  if (fecha) query = query.eq('fecha', fecha)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

/**
 * Asistencias para la vista de gestión (dirección y docentes), sin leer
 * `perfiles` (EPT-58).
 *
 * Los nombres y legajos se resuelven con `listarEstudiantesParaGestion`, que
 * sigue funcionando cuando la migración B cierre la lectura global de perfiles
 * para los docentes. Las filas son las mismas que antes: RLS de `asistencias`
 * no cambia.
 */
export async function obtenerAsistenciasDeGestion(fecha?: string) {
  const supabase = createClient()
  let query: any = supabase
    .from('asistencias')
    .select('id, fecha, estado, estudiante_id')
    .order('fecha', { ascending: false })

  if (fecha) query = query.eq('fecha', fecha)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as {
    id: string
    fecha: string
    estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
    estudiante_id: string | null
  }[]
}

export async function calcularPorcentajeAsistencia(estudianteId: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await (supabase as any)
    .rpc('calcular_porcentaje_asistencia', { p_estudiante_id: estudianteId })
  if (error) throw new Error(error.message)
  return data as number
}
