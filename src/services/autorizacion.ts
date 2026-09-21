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

/**
 * Exige únicamente una sesión válida (EPT-9).
 *
 * La usa la vista propia del estudiante, donde la autorización por fila la
 * resuelve RLS: las vistas académicas son `security_invoker` y solo devuelven el
 * legajo cuyo `perfil_id` coincide con el `auth.uid()` de la sesión. Un actor sin
 * legajo propio no obtiene un error que delate a otra persona, obtiene cero filas.
 *
 * Falla cerrado: sin usuario resuelto, deniega.
 */
export async function requerirSesion(): Promise<ResultadoAutorizacion> {
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

  return { autorizado: true, userId: user.id }
}

/**
 * Exige una sesión válida cuyo perfil tenga exactamente el rol indicado
 * (EPT-10).
 *
 * El rol se resuelve con `public.rol_actual()`, que lo deriva de `auth.uid()`
 * contra `perfiles` + `roles` dentro de la base. `perfiles.rol_id` no tiene
 * privilegio de UPDATE para ningún rol de aplicación, de modo que la fuente que
 * decide la autorización no es editable por quien se autoriza.
 *
 * Esta comprobación es la segunda capa, no la única: las operaciones de
 * PostgreSQL vuelven a exigir el mismo rol antes de escribir. Una sesión que
 * saltara esta ruta seguiría siendo rechazada por la base.
 *
 * Falla cerrado: si el rol no se puede resolver, deniega.
 */
export async function requerirRol(
  rolEsperado: string,
  mensajeNoAutorizado: string
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

  const { data: rol, error: errorRol } = await supabase.rpc('rol_actual')

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

  // Una cuenta autenticada sin perfil devuelve `null` y queda denegada por la
  // misma vía que un rol equivocado.
  if (rol !== rolEsperado) {
    return { autorizado: false, estado: 403, mensaje: mensajeNoAutorizado }
  }

  return { autorizado: true, userId: user.id }
}

export type ResultadoSesionConRol =
  | { autorizado: true; userId: string; rol: string | null }
  | { autorizado: false; estado: EstadoDenegacion; mensaje: string }

/**
 * Exige una sesión válida y devuelve además el rol resuelto en la base
 * (EPT-10).
 *
 * La usa la pantalla del comedor, que atiende a dos actores con vistas
 * distintas y necesita saber cuál es antes de decidir qué renderizar. No es una
 * frontera de seguridad por sí sola: cada operación y cada lectura vuelven a
 * resolver la autorización en el servidor y en PostgreSQL. `rol` es `null`
 * cuando la cuenta autenticada no tiene perfil.
 *
 * Falla cerrado: si el rol no se puede resolver, deniega.
 */
export async function requerirSesionConRol(): Promise<ResultadoSesionConRol> {
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

  const { data: rol, error: errorRol } = await supabase.rpc('rol_actual')

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

  return { autorizado: true, userId: user.id, rol: typeof rol === 'string' ? rol : null }
}
