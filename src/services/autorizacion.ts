import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Autorización del lado del servidor (EPT-17).
 *
 * Este módulo es la segunda de las tres capas de control. Las otras dos son la
 * navegación del dashboard (que oculta lo que el rol no puede usar) y los
 * permisos + RLS de PostgreSQL (que rechazan el acceso directo a la Data API).
 * Ninguna capa reemplaza a las otras.
 *
 * Solo puede ejecutarse en el servidor: `createServerSupabaseClient` importa
 * `next/headers`, por lo que importar este archivo desde un componente cliente
 * rompe la compilación.
 *
 * El rol nunca se toma de datos que el usuario pueda editar. Se resuelve con
 * `public.es_director_actual()`, que deriva el rol de `auth.uid()` contra
 * `perfiles` + `roles` dentro de la base.
 */

export type EstadoDenegacion = 401 | 403 | 500

export type ResultadoAutorizacion =
  | { autorizado: true; userId: string }
  | { autorizado: false; estado: EstadoDenegacion; mensaje: string }

const MENSAJE_CURSOS = 'Solo el director puede administrar los cursos.'

/**
 * Exige una sesión válida cuyo perfil tenga el rol DIRECTOR.
 *
 * Falla cerrado: si el rol no se puede resolver, deniega.
 */
export async function requerirDirector(
  mensajeNoAutorizado = MENSAJE_CURSOS
): Promise<ResultadoAutorizacion> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.auth.getUser()
  const user = data?.user
  if (error || !user) {
    return {
      autorizado: false,
      estado: 401,
      mensaje: 'Necesitás iniciar sesión para continuar.',
    }
  }

  const { data: esDirector, error: errorRol } = await supabase.rpc('es_director_actual')

  if (errorRol) {
    console.error('[autorizacion] no se pudo resolver el rol del usuario', {
      code: errorRol.code,
      message: errorRol.message,
    })
    return {
      autorizado: false,
      estado: 500,
      mensaje: 'No pudimos verificar tus permisos. Volvé a intentarlo en unos minutos.',
    }
  }

  if (esDirector !== true) {
    return {
      autorizado: false,
      estado: 403,
      mensaje: mensajeNoAutorizado,
    }
  }

  return { autorizado: true, userId: user.id }
}
