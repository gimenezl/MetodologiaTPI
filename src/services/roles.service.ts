/* eslint-disable @typescript-eslint/no-explicit-any */
import { traducirErrorDeLectura } from '@/lib/errores'
import { createClient } from '@/services/supabase'

export async function obtenerRoles() {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('roles')
    .select('*')
    .order('nombre') as any)
  // Nunca el mensaje de PostgREST: una lectura fallida es una carga fallida.
  if (error) throw traducirErrorDeLectura(error)
  return data
}
