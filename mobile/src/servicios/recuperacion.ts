// Recuperación y cambio de contraseña sobre Supabase Auth (EPT-106).
//
// Todo el flujo reutiliza el cliente singleton y los mecanismos del SDK: `resetPasswordForEmail`,
// `exchangeCodeForSession` (PKCE) y `updateUser`. No hay tablas de contraseñas, claves privilegiadas ni
// validación propia de la contraseña anterior. Ningún valor sensible (contraseña, código del enlace, enlace
// completo) se devuelve en un mensaje de error ni se escribe en un registro.
import type { ClienteEPT } from '@/servicios/supabase'

/** Esquema registrado en `app.config.ts`. El destino del correo es exacto: ninguna otra ruta se acepta. */
export const ESQUEMA_APP = 'educarparatransformar'
export const DESTINO_RECUPERACION = `${ESQUEMA_APP}://restablecer`

const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const LONGITUD_MAXIMA_CORREO = 254

export type ResultadoNormalizacion =
  | { tipo: 'ok'; correo: string }
  | { tipo: 'vacio' }
  | { tipo: 'invalido' }

/** Misma normalización que el inicio de sesión: se recortan espacios y se valida una forma razonable. */
export function normalizarCorreo(entrada: string): ResultadoNormalizacion {
  const correo = entrada.trim()
  if (correo.length === 0) return { tipo: 'vacio' }
  if (correo.length > LONGITUD_MAXIMA_CORREO || !PATRON_CORREO.test(correo)) return { tipo: 'invalido' }
  return { tipo: 'ok', correo }
}

interface ErrorDeAuth {
  name?: unknown
  code?: unknown
  status?: unknown
}

function datosDeError(error: unknown): { nombre: string; codigo: string; estado: number | null } {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorDeAuth
  return {
    nombre: typeof e.name === 'string' ? e.name : '',
    codigo: typeof e.code === 'string' ? e.code : '',
    estado: typeof e.status === 'number' ? e.status : null,
  }
}

function esSinConexion(error: unknown): boolean {
  const { nombre, estado } = datosDeError(error)
  return nombre === 'AuthRetryableFetchError' || estado === 0
}

function esLimite(error: unknown): boolean {
  const { codigo, estado } = datosDeError(error)
  return estado === 429 || codigo === 'over_email_send_rate_limit' || codigo === 'over_request_rate_limit'
}

// ---- Solicitud -------------------------------------------------------------------------------------------

export type ResultadoSolicitud =
  | { tipo: 'enviada' }
  | { tipo: 'correo_invalido' }
  | { tipo: 'limite' }
  | { tipo: 'sin_conexion' }
  | { tipo: 'error' }

/**
 * Pide a Auth el correo de recuperación. La respuesta de éxito es la misma exista o no la cuenta: Auth no la
 * distingue y la aplicación tampoco. Nunca crea cuentas (no usa `signUp`).
 */
export async function solicitarRecuperacion(
  cliente: Pick<ClienteEPT['auth'], 'resetPasswordForEmail'>,
  correo: string
): Promise<ResultadoSolicitud> {
  try {
    const { error } = await cliente.resetPasswordForEmail(correo, { redirectTo: DESTINO_RECUPERACION })
    if (!error) return { tipo: 'enviada' }
    if (esSinConexion(error)) return { tipo: 'sin_conexion' }
    if (esLimite(error)) return { tipo: 'limite' }
    const { codigo, estado } = datosDeError(error)
    if (codigo === 'email_address_invalid' || codigo === 'validation_failed' || estado === 422) return { tipo: 'correo_invalido' }
    return { tipo: 'error' }
  } catch (causa) {
    return esSinConexion(causa) ? { tipo: 'sin_conexion' } : { tipo: 'error' }
  }
}

// ---- Enlace ----------------------------------------------------------------------------------------------

export type EnlaceRecuperacion =
  | { tipo: 'codigo'; codigo: string; flowId: string | null }
  /** Auth devolvió un error en el retorno, o el enlace no trae el material del flujo PKCE. */
  | { tipo: 'rechazado'; motivo: 'expirado' | 'invalido' }
  /** Esquema, destino o ruta distintos del único retorno admitido. */
  | { tipo: 'no_admitido' }

const PATRON_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?(?:#(.*))?$/u
const PATRON_CODIGO = /^[A-Za-z0-9._~-]{8,512}$/u
// Misma forma que valida el SDK para el identificador de flujo.
const PATRON_FLUJO = /^[A-Za-z0-9_-]{8,64}$/u
// Material del flujo implícito: este módulo solo admite PKCE y no mezcla flujos.
const PARAMETROS_IMPLICITOS = new Set(['access_token', 'refresh_token', 'token_hash', 'token'])

function decodificar(texto: string): string | null {
  try {
    return decodeURIComponent(texto.replace(/\+/gu, ' '))
  } catch {
    return null
  }
}

/** `null` si hay un parámetro mal codificado o repetido (ambiguo). */
function leerParametros(cadena: string | undefined): Map<string, string> | null {
  const resultado = new Map<string, string>()
  if (!cadena) return resultado
  for (const par of cadena.split('&')) {
    if (par === '') continue
    const igual = par.indexOf('=')
    const clave = decodificar(igual === -1 ? par : par.slice(0, igual))
    const valor = decodificar(igual === -1 ? '' : par.slice(igual + 1))
    if (clave === null || valor === null) return null
    if (resultado.has(clave)) return null
    resultado.set(clave, valor)
  }
  return resultado
}

/**
 * Valida el retorno del correo con un destino exacto y lo reduce a lo único que el flujo necesita. Es una
 * función pura: no consulta a Auth. Que el enlace tenga forma válida no autoriza nada; solo
 * `exchangeCodeForSession` lo verifica.
 */
export function interpretarEnlace(url: string | null | undefined): EnlaceRecuperacion {
  if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return { tipo: 'no_admitido' }
  const partes = PATRON_URL.exec(url)
  if (!partes) return { tipo: 'no_admitido' }
  const [, esquema = '', anfitrion = '', ruta = '', consulta, fragmento] = partes
  if (esquema.toLowerCase() !== ESQUEMA_APP) return { tipo: 'no_admitido' }
  const destinoExacto =
    (anfitrion.toLowerCase() === 'restablecer' && (ruta === '' || ruta === '/')) ||
    (anfitrion === '' && ruta.toLowerCase() === '/restablecer')
  if (!destinoExacto) return { tipo: 'no_admitido' }

  const delQuery = leerParametros(consulta)
  const delFragmento = leerParametros(fragmento)
  if (!delQuery || !delFragmento) return { tipo: 'rechazado', motivo: 'invalido' }
  const todos = new Map<string, string>(delQuery)
  for (const [clave, valor] of delFragmento) {
    // Auth informa sus errores en la consulta y en el fragmento con los mismos valores: eso no es ambigüedad.
    // Cualquier otro parámetro repetido, o con valores distintos, sí lo es.
    const informaError = clave === 'error' || clave === 'error_code' || clave === 'error_description'
    if (todos.has(clave) && !(informaError && todos.get(clave) === valor)) return { tipo: 'rechazado', motivo: 'invalido' }
    todos.set(clave, valor)
  }
  for (const clave of todos.keys()) {
    if (PARAMETROS_IMPLICITOS.has(clave)) return { tipo: 'rechazado', motivo: 'invalido' }
  }

  const hayError = todos.has('error') || todos.has('error_code') || todos.has('error_description')
  if (hayError) {
    if (todos.has('code')) return { tipo: 'rechazado', motivo: 'invalido' }
    const detalle = `${todos.get('error_code') ?? ''} ${todos.get('error_description') ?? ''}`.toLowerCase()
    return { tipo: 'rechazado', motivo: /otp_expired|expired|expir/u.test(detalle) ? 'expirado' : 'invalido' }
  }

  const codigo = todos.get('code')
  if (codigo === undefined || !PATRON_CODIGO.test(codigo)) return { tipo: 'rechazado', motivo: 'invalido' }
  const flowId = todos.get('sb_flow_id')
  if (flowId !== undefined && !PATRON_FLUJO.test(flowId)) return { tipo: 'rechazado', motivo: 'invalido' }
  // Los parámetros desconocidos se ignoran: no aportan nada al intercambio.
  return { tipo: 'codigo', codigo, flowId: flowId ?? null }
}

const CLAVES_DE_RETORNO = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'] as const

/**
 * Reconstruye la URL de retorno a partir de los parámetros que el enrutador ya separó, para el caso en que el
 * sistema no entregue la URL cruda. Solo se toman las claves conocidas; un parámetro repetido llega como lista y se
 * conserva repetido para que `interpretarEnlace` lo rechace como ambiguo.
 */
export function urlDesdeParametros(parametros: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const partes: string[] = []
  for (const clave of CLAVES_DE_RETORNO) {
    const valor = parametros[clave]
    if (valor === undefined) continue
    for (const v of Array.isArray(valor) ? valor : [valor]) partes.push(`${clave}=${encodeURIComponent(v)}`)
  }
  return partes.length === 0 ? null : `${DESTINO_RECUPERACION}?${partes.join('&')}`
}

/** Identificador estable del enlace para deduplicar entregas, sin exponer el código en claves visibles. */
export function huellaDeEnlace(enlace: Extract<EnlaceRecuperacion, { tipo: 'codigo' }>): string {
  return `${enlace.flowId ?? ''}:${enlace.codigo}`
}

// ---- Intercambio -----------------------------------------------------------------------------------------

export type ResultadoIntercambio =
  | { tipo: 'ok'; usuarioId: string }
  /** Auth rechazó el código: vencido, ya usado o desconocido. */
  | { tipo: 'enlace_invalido' }
  /** Falta el verificador PKCE de esta instalación: el enlace se pidió en otro dispositivo o se borró el estado. */
  | { tipo: 'sin_verificador' }
  /** El código era válido pero no corresponde a una recuperación de contraseña. */
  | { tipo: 'no_es_recuperacion' }
  | { tipo: 'sin_conexion' }
  | { tipo: 'error' }

export async function intercambiarCodigo(
  cliente: Pick<ClienteEPT['auth'], 'exchangeCodeForSession' | 'signOut'>,
  enlace: Extract<EnlaceRecuperacion, { tipo: 'codigo' }>
): Promise<ResultadoIntercambio> {
  try {
    const { data, error } = await cliente.exchangeCodeForSession(enlace.codigo, enlace.flowId ? { flowId: enlace.flowId } : undefined)
    if (error) {
      const { nombre, codigo, estado } = datosDeError(error)
      if (esSinConexion(error)) return { tipo: 'sin_conexion' }
      if (nombre === 'AuthPKCECodeVerifierMissingError') return { tipo: 'sin_verificador' }
      // Un límite de peticiones (429) no dice que el enlace sea inválido: no se presenta como «ya usado».
      if (estado === 429) return { tipo: 'error' }
      if (estado !== null && estado >= 400 && estado < 500) return { tipo: 'enlace_invalido' }
      if (codigo === 'flow_state_not_found' || codigo === 'flow_state_expired' || codigo === 'bad_code_verifier' || codigo === 'otp_expired') {
        return { tipo: 'enlace_invalido' }
      }
      return { tipo: 'error' }
    }
    const usuarioId = data?.session?.user?.id ?? data?.user?.id
    if (!usuarioId) return { tipo: 'error' }
    if ((data as { redirectType?: string | null }).redirectType !== 'recovery') {
      // Un código válido de otro flujo (por ejemplo un ingreso por enlace) no autoriza cambiar la contraseña.
      try {
        await cliente.signOut({ scope: 'local' })
      } catch {
        // El cierre local es una precaución: su fallo no cambia el resultado.
      }
      return { tipo: 'no_es_recuperacion' }
    }
    return { tipo: 'ok', usuarioId }
  } catch (causa) {
    return esSinConexion(causa) ? { tipo: 'sin_conexion' } : { tipo: 'error' }
  }
}

// ---- Actualización ---------------------------------------------------------------------------------------

export type ResultadoActualizacion =
  | { tipo: 'ok' }
  /** Auth exige confirmar la identidad con un código enviado por correo (`reauthenticate`). */
  | { tipo: 'reautenticar' }
  | { tipo: 'codigo_invalido' }
  | { tipo: 'misma_contrasena' }
  | { tipo: 'debil'; motivos: readonly string[] }
  | { tipo: 'rechazada' }
  | { tipo: 'sesion_expirada' }
  /** La sesión vigente ya no es la del usuario que inició la operación: no se cambia nada. */
  | { tipo: 'usuario_distinto' }
  | { tipo: 'sin_conexion' }
  | { tipo: 'error' }

export interface OpcionesActualizacion {
  /** Usuario al que pertenece esta operación (recuperación verificada o perfil autenticado). */
  usuarioEsperado: string
  /** Código de reautenticación, solo si Auth lo pidió. */
  nonce?: string
}

type AuthActualizar = Pick<ClienteEPT['auth'], 'getUser' | 'updateUser'>

/**
 * Cambia la contraseña del usuario de la sesión vigente. La autoridad es la sesión verificada por Auth, nunca un
 * identificador recibido: se comprueba con `getUser()` que sigue siendo el usuario esperado antes de escribir y
 * se confirma con la respuesta de `updateUser`. La contraseña viaja intacta (sin recortes) y no se conserva.
 */
export async function actualizarContrasena(
  cliente: AuthActualizar,
  contrasena: string,
  { usuarioEsperado, nonce }: OpcionesActualizacion
): Promise<ResultadoActualizacion> {
  try {
    const { data: actual, error: errorUsuario } = await cliente.getUser()
    if (errorUsuario) return clasificarActualizacion(errorUsuario)
    if (!actual?.user) return { tipo: 'sesion_expirada' }
    if (actual.user.id !== usuarioEsperado) return { tipo: 'usuario_distinto' }

    const { data, error } = await cliente.updateUser(nonce ? { password: contrasena, nonce } : { password: contrasena })
    if (error) return clasificarActualizacion(error)
    if (data?.user?.id !== usuarioEsperado) return { tipo: 'usuario_distinto' }
    return { tipo: 'ok' }
  } catch (causa) {
    return esSinConexion(causa) ? { tipo: 'sin_conexion' } : { tipo: 'error' }
  }
}

function clasificarActualizacion(error: unknown): ResultadoActualizacion {
  const { nombre, codigo, estado } = datosDeError(error)
  if (esSinConexion(error)) return { tipo: 'sin_conexion' }
  if (codigo === 'reauthentication_needed') return { tipo: 'reautenticar' }
  if (codigo === 'reauthentication_not_valid' || codigo === 'reauth_nonce_missing') return { tipo: 'codigo_invalido' }
  if (codigo === 'same_password') return { tipo: 'misma_contrasena' }
  if (nombre === 'AuthWeakPasswordError' || codigo === 'weak_password') {
    const motivos = (error as { reasons?: unknown }).reasons
    return { tipo: 'debil', motivos: Array.isArray(motivos) ? motivos.filter((m): m is string => typeof m === 'string') : [] }
  }
  if (
    nombre === 'AuthSessionMissingError' ||
    codigo === 'session_not_found' ||
    codigo === 'session_expired' ||
    codigo === 'user_not_found' ||
    codigo === 'bad_jwt' ||
    codigo === 'no_authorization' ||
    estado === 401 ||
    estado === 403
  ) {
    return { tipo: 'sesion_expirada' }
  }
  if (estado === 422 || estado === 400) return { tipo: 'rechazada' }
  return { tipo: 'error' }
}

export type ResultadoReautenticacion = { tipo: 'enviado' } | { tipo: 'sesion_expirada' } | { tipo: 'limite' } | { tipo: 'sin_conexion' } | { tipo: 'error' }

/** Pide a Auth el código de verificación por correo que exige el cambio cuando la sesión no es reciente. */
export async function pedirCodigoDeVerificacion(cliente: Pick<ClienteEPT['auth'], 'reauthenticate'>): Promise<ResultadoReautenticacion> {
  try {
    const { error } = await cliente.reauthenticate()
    if (!error) return { tipo: 'enviado' }
    if (esSinConexion(error)) return { tipo: 'sin_conexion' }
    if (esLimite(error)) return { tipo: 'limite' }
    const resultado = clasificarActualizacion(error)
    return resultado.tipo === 'sesion_expirada' ? { tipo: 'sesion_expirada' } : { tipo: 'error' }
  } catch (causa) {
    return esSinConexion(causa) ? { tipo: 'sin_conexion' } : { tipo: 'error' }
  }
}

// ---- Mensajes --------------------------------------------------------------------------------------------

const MOTIVOS_DEBIL: Record<string, string> = {
  length: 'tener más caracteres',
  characters: 'combinar letras, números o símbolos',
  pwned: 'no ser una contraseña filtrada en otros sitios',
}

/** Texto en español para un resultado de actualización que no fue exitoso. */
export function mensajeDeActualizacion(resultado: Exclude<ResultadoActualizacion, { tipo: 'ok' }>): string {
  switch (resultado.tipo) {
    case 'reautenticar':
      return 'Por seguridad, confirmá tu identidad con el código que te enviamos por correo.'
    case 'codigo_invalido':
      return 'El código de verificación no es válido o venció. Pedí uno nuevo.'
    case 'misma_contrasena':
      return 'La nueva contraseña debe ser distinta de la actual.'
    case 'debil': {
      const motivos = resultado.motivos.map(m => MOTIVOS_DEBIL[m]).filter((m): m is string => Boolean(m))
      return motivos.length > 0
        ? `La contraseña no cumple los requisitos de seguridad. Debe ${motivos.join(', ')}.`
        : 'La contraseña no cumple los requisitos de seguridad del servicio.'
    }
    case 'rechazada':
      return 'El servicio no aceptó esa contraseña. Probá con otra.'
    case 'sesion_expirada':
      return 'La sesión venció. Volvé a iniciar sesión para continuar.'
    case 'usuario_distinto':
      return 'La sesión cambió mientras completabas el formulario. No se modificó ninguna contraseña.'
    case 'sin_conexion':
      return 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.'
    case 'error':
      return 'No se pudo actualizar la contraseña. Intentá nuevamente.'
  }
}
