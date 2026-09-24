import { createServerSupabaseClient } from '@/services/supabase.server'

export type Hijo = {
  id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
  estado: 'ACTIVO' | 'INACTIVO'
  matricula_id: string | null
  curso_denominacion: string | null
  curso_division: string | null
  nivel_nombre: string | null
  materias: { materia: string; docente: string | null }[]
  deportes: { deporte: string; grupo: string }[]
}

export type CursoDisponible = {
  id: string
  denominacion: string
  division: string
  nivel: { nombre: string } | null
}

const COLUMNAS_HIJO =
  'id, nombre, apellido, legajo_nro, estado, matricula_id, curso_denominacion, curso_division, nivel_nombre'

async function agregarDetalle(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  hijo: Omit<Hijo, 'materias' | 'deportes'>
): Promise<Hijo> {
  const { data, error } = await supabase.rpc('consultar_detalle_hijo', { p_hijo_id: hijo.id })
  if (error) throw error
  const detalle = data as { materias?: Hijo['materias']; deportes?: Hijo['deportes'] } | null
  return { ...hijo, materias: detalle?.materias ?? [], deportes: detalle?.deportes ?? [] }
}

export async function listarHijos(): Promise<Hijo[]> {
  const supabase = await createServerSupabaseClient()
  // La vista security_invoker y RLS de alumnos limitan las filas en PostgreSQL.
  const { data, error } = await supabase.from('alumnos_academicos').select(COLUMNAS_HIJO)
  if (error) throw error
  return Promise.all((data ?? []).map((hijo) => agregarDetalle(supabase, hijo as Omit<Hijo, 'materias' | 'deportes'>)))
}

export async function obtenerHijo(id: string): Promise<Hijo | null> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alumnos_academicos')
    .select(COLUMNAS_HIJO)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? agregarDetalle(supabase, data as Omit<Hijo, 'materias' | 'deportes'>) : null
}

export async function listarCursosDisponibles(): Promise<CursoDisponible[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('cursos')
    .select('id, denominacion, division, nivel:niveles(nombre)')
    .eq('activo', true)
    .order('denominacion')
  if (error) throw error
  return (data ?? []).map((curso) => ({
    id: curso.id as string,
    denominacion: curso.denominacion as string,
    division: curso.division as string,
    nivel: Array.isArray(curso.nivel) ? (curso.nivel[0] ?? null) : curso.nivel,
  })) as CursoDisponible[]
}

export async function matricularHijo(hijoId: string, cursoId: string) {
  const supabase = await createServerSupabaseClient()
  return supabase.rpc('matricular_hijo', { p_hijo_id: hijoId, p_curso_id: cursoId })
}
