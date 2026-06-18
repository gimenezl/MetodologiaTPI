import { createClient } from '@supabase/supabase-js'

/**
 * Cliente de Supabase con privilegios de administrador (service_role).
 * ⚠️ SOLO debe usarse del lado del servidor (Route Handlers / Server Actions).
 * Nunca importar este archivo en componentes cliente: expondría la clave secreta.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Falta configurar SUPABASE_SERVICE_ROLE_KEY (clave service_role de Supabase) en las variables de entorno.'
    )
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
