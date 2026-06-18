/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@/services/supabase'

export async function obtenerNoticias(limit = 10) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('noticias')
    .select('*')
    .order('fecha_publicacion', { ascending: false })
    .limit(limit) as any)
  if (error) throw new Error(error.message)
  return data
}

export async function obtenerNoticiasPaginadas(page = 1, pageSize = 9) {
  const supabase = createClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await (supabase
    .from('noticias')
    .select('*', { count: 'exact' })
    .order('fecha_publicacion', { ascending: false })
    .range(from, to) as any)
  if (error) throw new Error(error.message)
  return { data, count: count ?? 0 }
}

export async function obtenerNoticiaPorId(id: number) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('noticias')
    .select('*')
    .eq('id', id)
    .single() as any)
  if (error) throw new Error(error.message)
  return data
}

export async function crearNoticia(noticia: { titulo: string; contenido: string; imagen_url?: string | null }) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('noticias')
    .insert(noticia as any)
    .select()
    .single() as any)
  if (error) throw new Error(error.message)
  return data
}

export async function actualizarNoticia(id: number, updates: Record<string, unknown>) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('noticias')
    .update(updates as any)
    .eq('id', id)
    .select()
    .single() as any)
  if (error) throw new Error(error.message)
  return data
}

export async function eliminarNoticia(id: number) {
  const supabase = createClient()
  const { error } = await (supabase
    .from('noticias')
    .delete()
    .eq('id', id) as any)
  if (error) throw new Error(error.message)
}

export async function obtenerGaleria(categoria?: string) {
  const supabase = createClient()
  let query: any = supabase.from('galeria').select('*').order('id', { ascending: false })
  if (categoria) query = query.eq('categoria', categoria)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

export async function obtenerMenuSemana() {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('menu_escolar')
    .select('*')
    .order('id') as any)
  if (error) throw new Error(error.message)
  return data
}

export async function crearOpinion(nombre: string, comentario: string) {
  const supabase = createClient()
  // Sin .select(): los testimonios nuevos quedan pendientes (aprobado=false) y
  // la política RLS no permitiría leer de vuelta una fila no aprobada al usuario anónimo.
  const { error } = await (supabase
    .from('opiniones')
    .insert({ nombre_usuario: nombre || 'Anónimo', comentario } as any) as any)
  if (error) throw new Error(error.message)
  return true
}

// Público: por RLS el anónimo solo recibe las aprobadas; el director recibe todas.
export async function obtenerOpiniones() {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('opiniones')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(20) as any)
  if (error) throw new Error(error.message)
  return data
}

export async function aprobarOpinion(id: number) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('opiniones')
    .update({ aprobado: true } as any)
    .eq('id', id)
    .select('id') as any)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('No se pudo aprobar el testimonio')
}

export async function eliminarOpinion(id: number) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('opiniones')
    .delete()
    .eq('id', id)
    .select('id') as any)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('No se pudo eliminar el testimonio')
}
