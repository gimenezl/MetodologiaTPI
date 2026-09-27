import type { User } from '@supabase/supabase-js'
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
 *
 * Acceso bloqueado (EPT-59): la barrera primaria es PostgreSQL. Los auxiliares
 * de identidad ignoran a un perfil BLOQUEADO y cada tabla tiene una política
 * RESTRICTIVE, así que un JWT emitido antes del bloqueo solo alcanza lo que ve
 * `anon`. Estas guardas agregan la respuesta explícita: consultan
 * `public.mi_estado_acceso()` —la única consulta que un bloqueado puede hacer
 * sobre sí mismo— y, si el estado es BLOQUEADO, deniegan con 403 y el código
 * `ACCESO_BLOQUEADO`, en lugar de un «sin permiso» genérico.
 */

export type EstadoDenegacion = 401 | 403 | 500

/** Código de dominio que acompaña a una denegación por bloqueo de acceso. */
export type CodigoDenegacion = 'ACCESO_BLOQUEADO'

export type ResultadoAutorizacion =
  | { autorizado: true; userId: string }
  | { autorizado: false; estado: EstadoDenegacion; mensaje: string; codigo?: CodigoDenegacion }

/** Estado de acceso de la sesión, tal como lo informa `public.mi_estado_acceso()`. */
export type EstadoDeAcceso = 'SIN_SESION' | 'SIN_PERFIL' | 'HABILITADO' | 'BLOQUEADO'

const ESTADOS_DE_ACCESO = new Set<EstadoDeAcceso>([
  'SIN_SESION',
  'SIN_PERFIL',
  'HABILITADO',
  'BLOQUEADO',
])

type ClienteDeSesion = Awaited<ReturnType<typeof createServerSupabaseClient>>

type Denegacion = Extract<ResultadoAutorizacion, { autorizado: false }>

const MENSAJE_CURSOS = 'Solo el director puede administrar los cursos.'

export const MENSAJE_ACCESO_BLOQUEADO = 'Tu acceso está bloqueado. Comunicate con Dirección.'

const SIN_SESION: Denegacion = {
  autorizado: false,
  estado: 401,
  mensaje: 'Necesitás iniciar sesión para continuar.',
}

const SIN_VERIFICACION: Denegacion = {
  autorizado: false,
  estado: 500,
  mensaje: 'No pudimos verificar tus permisos. Volvé a intentarlo en unos minutos.',
}

const BLOQUEADO: Denegacion = {
  autorizado: false,
  estado: 403,
  mensaje: MENSAJE_ACCESO_BLOQUEADO,
  codigo: 'ACCESO_BLOQUEADO',
}

/**
 * Estado de acceso de la sesión del cliente recibido.
 *
 * Devuelve `null` si no se pudo resolver: quien llama decide, y las guardas de
 * este módulo fallan cerrado. Recibe el cliente para no abrir una segunda
 * sesión; por eso no se memoiza con `React.cache` (la clave sería el objeto).
 */
export async function consultarEstadoAcceso(
  supabase: ClienteDeSesion
): Promise<EstadoDeAcceso | null> {
  const { data, error } = await supabase.rpc('mi_estado_acceso')
  if (error) {
    console.error('[autorizacion] no se pudo resolver el estado de acceso', { code: error.code })
    return null
  }
  return typeof data === 'string' && ESTADOS_DE_ACCESO.has(data as EstadoDeAcceso)
    ? (data as EstadoDeAcceso)
    : null
}

/** Denegación que corresponde a un estado de acceso, o `null` si no bloquea. */
function denegacionPorAcceso(estado: EstadoDeAcceso | null): Denegacion | null {
  if (estado === null) return SIN_VERIFICACION
  if (estado === 'BLOQUEADO') return BLOQUEADO
  return null
}

type Sesion = { supabase: ClienteDeSesion; user: User }

async function resolverSesion(): Promise<Sesion | Denegacion> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  const user = data?.user
  if (error || !user) return SIN_SESION
  return { supabase, user }
}

function esDenegacion(valor: Sesion | Denegacion): valor is Denegacion {
  return 'autorizado' in valor
}

/** Resuelve el rol en la base y el estado de acceso en paralelo. */
async function rolYAcceso(supabase: ClienteDeSesion) {
  const [rol, acceso] = await Promise.all([
    supabase.rpc('rol_actual'),
    consultarEstadoAcceso(supabase),
  ])
  if (rol.error) {
    console.error('[autorizacion] no se pudo resolver el rol del usuario', {
      code: rol.error.code,
      message: rol.error.message,
    })
  }
  return { rol, acceso }
}

/**
 * Exige una sesión válida cuyo perfil tenga el rol DIRECTOR.
 *
 * Falla cerrado: si el rol no se puede resolver, deniega.
 */
export async function requerirDirector(
  mensajeNoAutorizado = MENSAJE_CURSOS
): Promise<ResultadoAutorizacion> {
  const sesion = await resolverSesion()
  if (esDenegacion(sesion)) return sesion
  const { supabase, user } = sesion

  const [director, acceso] = await Promise.all([
    supabase.rpc('es_director_actual'),
    consultarEstadoAcceso(supabase),
  ])

  const porAcceso = denegacionPorAcceso(acceso)
  if (porAcceso) return porAcceso

  if (director.error) {
    console.error('[autorizacion] no se pudo resolver el rol del usuario', {
      code: director.error.code,
      message: director.error.message,
    })
    return SIN_VERIFICACION
  }

  if (director.data !== true) {
    return {
      autorizado: false,
      estado: 403,
      mensaje: mensajeNoAutorizado,
    }
  }

  return { autorizado: true, userId: user.id }
}

export type ResultadoDirectorConPerfil =
  | { autorizado: true; userId: string; perfilId: string }
  | Denegacion

/**
 * Igual que `requerirDirector`, y además devuelve el `id` del perfil propio
 * (EPT-59).
 *
 * El vínculo de cuentas (D5) llama con `service_role` a funciones que reciben
 * el perfil del Director como argumento. Ese argumento nunca sale del cuerpo
 * de la petición: se lee acá, con el cliente de la sesión verificada, sobre la
 * fila propia que RLS deja ver a un perfil habilitado. La base vuelve a exigir
 * que ese perfil sea el que inició la reserva y que siga siendo DIRECTOR
 * habilitado.
 */
export async function requerirDirectorConPerfil(
  mensajeNoAutorizado = MENSAJE_CURSOS
): Promise<ResultadoDirectorConPerfil> {
  const sesion = await resolverSesion()
  if (esDenegacion(sesion)) return sesion
  const { supabase, user } = sesion

  const [director, acceso, perfil] = await Promise.all([
    supabase.rpc('es_director_actual'),
    consultarEstadoAcceso(supabase),
    supabase.from('perfiles').select('id').eq('user_id', user.id).maybeSingle(),
  ])

  const porAcceso = denegacionPorAcceso(acceso)
  if (porAcceso) return porAcceso

  if (director.error || perfil.error) {
    console.error('[autorizacion] no se pudo resolver el perfil del director', {
      codeRol: director.error?.code ?? null,
      codePerfil: perfil.error?.code ?? null,
    })
    return SIN_VERIFICACION
  }

  const perfilId = (perfil.data as { id?: unknown } | null)?.id
  if (director.data !== true || typeof perfilId !== 'string') {
    return { autorizado: false, estado: 403, mensaje: mensajeNoAutorizado }
  }

  return { autorizado: true, userId: user.id, perfilId }
}

/**
 * Exige únicamente una sesión válida (EPT-9).
 *
 * La usa la vista propia del estudiante, donde la autorización por fila la
 * resuelve RLS: las vistas académicas son `security_invoker` y solo devuelven el
 * legajo cuyo `perfil_id` coincide con el `auth.uid()` de la sesión. Un actor sin
 * legajo propio no obtiene un error que delate a otra persona, obtiene cero filas.
 *
 * Un perfil BLOQUEADO (EPT-59) recibe 403 con `ACCESO_BLOQUEADO`.
 *
 * Falla cerrado: sin usuario resuelto, deniega.
 */
export async function requerirSesion(): Promise<ResultadoAutorizacion> {
  const sesion = await resolverSesion()
  if (esDenegacion(sesion)) return sesion

  const porAcceso = denegacionPorAcceso(await consultarEstadoAcceso(sesion.supabase))
  if (porAcceso) return porAcceso

  return { autorizado: true, userId: sesion.user.id }
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
  const sesion = await resolverSesion()
  if (esDenegacion(sesion)) return sesion

  const { rol, acceso } = await rolYAcceso(sesion.supabase)

  const porAcceso = denegacionPorAcceso(acceso)
  if (porAcceso) return porAcceso
  if (rol.error) return SIN_VERIFICACION

  // Una cuenta autenticada sin perfil devuelve `null` y queda denegada por la
  // misma vía que un rol equivocado.
  if (rol.data !== rolEsperado) {
    return { autorizado: false, estado: 403, mensaje: mensajeNoAutorizado }
  }

  return { autorizado: true, userId: sesion.user.id }
}

export type ResultadoSesionConRol =
  | { autorizado: true; userId: string; rol: string | null }
  | Denegacion

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
 * Un perfil BLOQUEADO (EPT-59) recibe 403 con `ACCESO_BLOQUEADO`.
 *
 * Falla cerrado: si el rol no se puede resolver, deniega.
 */
export async function requerirSesionConRol(): Promise<ResultadoSesionConRol> {
  const sesion = await resolverSesion()
  if (esDenegacion(sesion)) return sesion

  const { rol, acceso } = await rolYAcceso(sesion.supabase)

  const porAcceso = denegacionPorAcceso(acceso)
  if (porAcceso) return porAcceso
  if (rol.error) return SIN_VERIFICACION

  return {
    autorizado: true,
    userId: sesion.user.id,
    rol: typeof rol.data === 'string' ? rol.data : null,
  }
}
