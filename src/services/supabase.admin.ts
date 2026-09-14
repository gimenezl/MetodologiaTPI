import { createClient } from '@supabase/supabase-js'

/**
 * Cuánto espera, como máximo, cada petición administrativa, en milisegundos.
 *
 * Sin límite, una petición a Auth o a PostgREST que nunca responde deja la ruta
 * esperando hasta que el navegador se canse. Con límite, el pedido termina en
 * un resultado explícito —incluido «no sabemos si se confirmó»— dentro de un
 * tiempo acotado.
 */
export const LIMITE_POR_PETICION_ADMINISTRATIVA_MS = 4_000

/** `fetch` que aborta cuando se cumple el límite, además de la señal propia. */
function fetchConLimite(limiteMs: number): typeof fetch {
  return (entrada, inicio) => {
    const limite = AbortSignal.timeout(limiteMs)
    const senal = inicio?.signal ? AbortSignal.any([inicio.signal, limite]) : limite
    return fetch(entrada, { ...inicio, signal: senal })
  }
}

/**
 * Cliente de Supabase con privilegios de administrador (service_role).
 * ⚠️ SOLO debe usarse del lado del servidor (Route Handlers / Server Actions).
 * Nunca importar este archivo en componentes cliente: expondría la clave secreta.
 */
export function createAdminClient(
  limitePorPeticionMs: number = LIMITE_POR_PETICION_ADMINISTRATIVA_MS
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Falta configurar SUPABASE_SERVICE_ROLE_KEY (clave service_role de Supabase) en las variables de entorno.'
    )
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchConLimite(limitePorPeticionMs) },
  })
}
