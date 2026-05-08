/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@/services/supabase'

export async function obtenerPerfiles(rolId?: number) {
  const supabase = createClient()
  let query: any = supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .order('apellido')
  if (rolId) query = query.eq('rol_id', rolId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

export async function obtenerPerfilesPaginados(page = 1, pageSize = 10, rolId?: number) {
  const supabase = createClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query: any = supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`, { count: 'exact' })
    .order('apellido')
    .range(from, to)
  if (rolId) query = query.eq('rol_id', rolId)
  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { data, count: count ?? 0 }
}

export async function obtenerPerfilPorId(id: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .eq('id', id)
    .single() as any)
  if (error) throw new Error(error.message)
  return data
}

export async function obtenerPerfilPorUserId(userId: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .eq('user_id', userId)
    .single() as any)
  if (error) throw new Error(error.message)
  return data
}

export async function crearPerfil(perfil: Record<string, unknown>) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .insert(perfil as any)
    .select()
    .single() as any)
  if (error) throw new Error(error.message)
  return data
}

export async function actualizarPerfil(id: string, updates: Record<string, unknown>) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .update(updates as any)
    .eq('id', id)
    .select()
    .single() as any)
  if (error) throw new Error(error.message)
  return data
}

export async function buscarPerfiles(query: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .or(`nombre.ilike.%${query}%,apellido.ilike.%${query}%,dni.ilike.%${query}%,legajo_nro.ilike.%${query}%`)
    .order('apellido') as any)
  if (error) throw new Error(error.message)
  return data
}

export async function buscarPerfilesPaginados(query: string, page = 1, pageSize = 10) {
  const supabase = createClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await (supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`, { count: 'exact' })
    .or(`nombre.ilike.%${query}%,apellido.ilike.%${query}%,dni.ilike.%${query}%,legajo_nro.ilike.%${query}%`)
    .order('apellido')
    .range(from, to) as any)
  if (error) throw new Error(error.message)
  return { data, count: count ?? 0 }
}

export async function eliminarPerfil(id: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('perfiles')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}
