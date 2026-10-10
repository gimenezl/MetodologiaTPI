import type { ClienteEPT } from '@/servicios/supabase'

/** Token de acceso de la sesión del dispositivo, o `null` si no hay sesión. No se registra ni se persiste aparte. */
export async function obtenerTokenDeAcceso(cliente: Pick<ClienteEPT['auth'], 'getSession'>): Promise<string | null> {
  const { data, error } = await cliente.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}
