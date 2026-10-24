import type { ClienteEPT } from '@/servicios/supabase'

/**
 * Token de acceso de la sesión del dispositivo, o `null` si no hay sesión o el almacén no es legible.
 * Una falla del almacén (p. ej. dispositivo bloqueado) se trata como «sin sesión»: nunca se propaga cruda.
 */
export type SesionDelDispositivo = { token: string; usuarioId: string }

/**
 * Token e identidad de la sesión actual, o `null` sin sesión. La identidad sobrevive a la renovación
 * del token: sirve para detectar un cambio de cuenta sin confundirlo con un refresco legítimo.
 */
export async function obtenerSesionDelDispositivo(cliente: Pick<ClienteEPT['auth'], 'getSession'>): Promise<SesionDelDispositivo | null> {
  try {
    const { data, error } = await cliente.getSession()
    if (error || !data.session?.access_token || !data.session.user?.id) return null
    return { token: data.session.access_token, usuarioId: data.session.user.id }
  } catch {
    return null
  }
}

export async function obtenerTokenDeAcceso(cliente: Pick<ClienteEPT['auth'], 'getSession'>): Promise<string | null> {
  try {
    const { data, error } = await cliente.getSession()
    if (error) return null
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}
