import { createClient } from '@/services/supabase'

export type CrearUsuarioPayload = {
  email: string
  password: string
  nombre: string
  apellido: string
  dni: string
  rol_id: number
  telefono?: string
  direccion?: string
  legajo_nro?: string
  hijos_ids?: string[]
  tutor_id?: string
}

export async function crearUsuario(payload: CrearUsuarioPayload) {
  const res = await fetch('/api/usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? 'No se pudo crear el usuario')
  }
  return data as { ok: true; user_id: string }
}

export type RelacionFamiliar = { padre_id: string; hijo_id: string }

// Devuelve todos los vínculos padre/tutor <-> hijo (el director ve todos por RLS)
export async function obtenerRelacionesFamiliares(): Promise<RelacionFamiliar[]> {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('padres_hijos')
    .select('padre_id, hijo_id') as unknown as Promise<{ data: RelacionFamiliar[] | null; error: { message: string } | null }>)
  if (error) throw new Error(error.message)
  return data ?? []
}

// Reemplaza el conjunto de hijos de un padre/tutor
export async function setHijosDePadre(padreId: string, hijosIds: string[]) {
  const supabase = createClient()
  await supabase.from('padres_hijos').delete().eq('padre_id', padreId)
  if (hijosIds.length > 0) {
    const { error } = await supabase
      .from('padres_hijos')
      .insert(hijosIds.map((hijoId) => ({ padre_id: padreId, hijo_id: hijoId })))
    if (error) throw new Error(error.message)
  }
}

// Asigna (o quita) el tutor de un alumno
export async function setTutorDeHijo(hijoId: string, tutorId: string | null) {
  const supabase = createClient()
  await supabase.from('padres_hijos').delete().eq('hijo_id', hijoId)
  if (tutorId) {
    const { error } = await supabase
      .from('padres_hijos')
      .insert({ padre_id: tutorId, hijo_id: hijoId })
    if (error) throw new Error(error.message)
  }
}
