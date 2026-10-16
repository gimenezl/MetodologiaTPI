import { createClient } from '@supabase/supabase-js'

/**
 * Autenticación por `Authorization: Bearer` para clientes que no usan cookies
 * (la aplicación móvil, EPT-109).
 *
 * Decodificar un JWT NO es autenticarlo: acá el token se verifica contra Auth
 * (GoTrue), que comprueba firma, vencimiento y que la sesión siga existiendo.
 * La identidad que devuelve es la única autoridad; nada se toma de
 * `user_metadata` ni de una afirmación del cliente. Que la cuenta esté
 * habilitada, su rol y sus vínculos los revalida la base en cada operación.
 *
 * Solo servidor: no hay `next/headers`, pero el módulo existe para rutas de
 * servidor y no debe importarse desde componentes cliente.
 */

export type ResultadoBearer =
  | { ok: true; userId: string }
  | { ok: false; estado: 401 | 503; mensaje: string }

const TIEMPO_MAXIMO_MS = 5_000
/** Un JWT de Supabase mide cientos de bytes; cualquier cosa enorme no es un token. */
const LARGO_MAXIMO_TOKEN = 4_096
const FORMA_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/u

export function extraerToken(cabecera: string | null): string | null {
  if (!cabecera) return null
  const m = /^Bearer ([^\s]+)$/u.exec(cabecera)
  if (!m || m[1].length > LARGO_MAXIMO_TOKEN || !FORMA_JWT.test(m[1])) return null
  return m[1]
}

export async function autenticarBearer(headers: Headers): Promise<ResultadoBearer> {
  const token = extraerToken(headers.get('authorization'))
  if (!token) {
    return { ok: false, estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return { ok: false, estado: 503, mensaje: 'El servicio no está disponible.' }
  }
  const cliente = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (entrada, inicio) =>
        fetch(entrada, { ...inicio, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) }),
    },
  })
  try {
    const { data, error } = await cliente.auth.getUser(token)
    if (error || !data.user?.id) {
      // 4xx de Auth: el token no es válido. Cualquier otra cosa (red, 5xx) no
      // prueba nada sobre la identidad: no se afirma «no autenticado».
      const estado = (error as { status?: number } | null)?.status
      if (typeof estado === 'number' && estado >= 400 && estado < 500) {
        return { ok: false, estado: 401, mensaje: 'Tu sesión venció. Iniciá sesión de nuevo.' }
      }
      return { ok: false, estado: 503, mensaje: 'No pudimos verificar tu sesión. Reintentá.' }
    }
    return { ok: true, userId: data.user.id }
  } catch {
    return { ok: false, estado: 503, mensaje: 'No pudimos verificar tu sesión. Reintentá.' }
  }
}
