import type { ClienteEPT } from '@/servicios/supabase'

/**
 * Token de acceso de la sesión del dispositivo, o `null` si no hay sesión o el almacén no es legible.
 * Una falla del almacén (p. ej. dispositivo bloqueado) se trata como «sin sesión»: nunca se propaga cruda.
 */
export async function obtenerTokenDeAcceso(cliente: Pick<ClienteEPT['auth'], 'getSession'>): Promise<string | null> {
  try {
    const { data, error } = await cliente.getSession()
    if (error) return null
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}
