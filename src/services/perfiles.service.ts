/* eslint-disable @typescript-eslint/no-explicit-any */
import { traducirErrorDeEscrituraDePerfil, traducirErrorDeLectura } from '@/lib/errores'
import { createClient } from '@/services/supabase'

/**
 * Cuánto espera una escritura de perfil, en milisegundos.
 *
 * Con la conexión cortada, una petición del cliente de Supabase puede no
 * resolverse nunca. El límite convierte esa espera infinita en un error de
 * servicio que la pantalla puede explicar.
 */
const LIMITE_DE_ESCRITURA_MS = 15_000

/*
 * Errores (EPT-9): ninguna función de este módulo relanza el mensaje de
 * PostgREST. Las lecturas fallidas se convierten en `CARGA_FALLIDA` y las
 * escrituras en el error de dominio que corresponde a la restricción exacta que
 * se violó. Ver `src/lib/errores.ts`.
 */

export async function obtenerPerfiles(rolId?: number) {
  const supabase = createClient()
  let query: any = supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .order('apellido')
  if (rolId) query = query.eq('rol_id', rolId)
  const { data, error } = await query
  if (error) throw traducirErrorDeLectura(error)
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
  if (error) throw traducirErrorDeLectura(error)
  return { data, count: count ?? 0 }
}

export async function obtenerPerfilPorId(id: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .eq('id', id)
    .single() as any)
  if (error) throw traducirErrorDeLectura(error)
  return data
}

export async function obtenerPerfilPorUserId(userId: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .eq('user_id', userId)
    .single() as any)
  if (error) throw traducirErrorDeLectura(error)
  return data
}

export async function crearPerfil(perfil: Record<string, unknown>) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .insert(perfil as any)
    .select()
    .abortSignal(AbortSignal.timeout(LIMITE_DE_ESCRITURA_MS))
    .single() as any)
  if (error) throw traducirErrorDeEscrituraDePerfil(error)
  return data
}

/**
 * Modifica un perfil y devuelve la fila guardada.
 *
 * `.single()` exige exactamente una fila: si RLS no deja modificar el registro,
 * la sentencia afecta cero filas y PostgREST responde `PGRST116`. Eso se informa
 * como `SIN_CAMBIOS` en lugar de confirmarse un cambio que no ocurrió.
 */
export async function actualizarPerfil(id: string, updates: Record<string, unknown>) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .update(updates as any)
    .eq('id', id)
    .select()
    .abortSignal(AbortSignal.timeout(LIMITE_DE_ESCRITURA_MS))
    .single() as any)
  if (error) throw traducirErrorDeEscrituraDePerfil(error)
  return data
}

export async function buscarPerfiles(query: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('perfiles')
    .select(`*, rol:roles(nombre)`)
    .or(`nombre.ilike.%${query}%,apellido.ilike.%${query}%,dni.ilike.%${query}%,legajo_nro.ilike.%${query}%`)
    .order('apellido') as any)
  if (error) throw traducirErrorDeLectura(error)
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
  if (error) throw traducirErrorDeLectura(error)
  return { data, count: count ?? 0 }
}

/*
 * No existe `eliminarPerfil` (EPT-9).
 *
 * La función anterior hacía `DELETE FROM perfiles`, pero `perfiles` nunca tuvo
 * una política RLS de DELETE: la sentencia afectaba cero filas y devolvía éxito,
 * de modo que la interfaz confirmaba una baja que jamás ocurría. Verificado
 * sobre la base local antes de quitarla.
 *
 * La migración 008 además revoca DELETE y TRUNCATE sobre `perfiles` para los
 * roles de aplicación, así que la negación ya no depende de que exista o falte
 * una política. La baja de un estudiante es lógica y viaja por
 * `inactivarAlumno` en `alumnos.service.ts`, que conserva identidad, legajo e
 * historial completo.
 */
