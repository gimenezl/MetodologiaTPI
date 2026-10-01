/**
 * Catálogo de respuestas del registro de accesos con QR (EPT-65, RF21).
 *
 * Dos conjuntos distintos y cerrados:
 *
 *  1. RESULTADOS de un escaneo (`CodigoResultado`): lo que el operador ve cuando
 *     la solicitud se procesó. Todos viajan con estado 200, salvo
 *     `INTENTO_REUTILIZADO` (409).
 *  2. ERRORES de la petición (`CodigoAcceso`): sesión, permisos, límites,
 *     formato, disponibilidad. Cuerpo `{ error, codigo }`.
 *
 * Cada mensaje está en español y es apto para mostrarse tal cual. Nunca incluye
 * SQLSTATE, nombres de tablas, claves, payloads ni el motivo interno de una
 * denegación: eso solo lo ve Dirección en la auditoría.
 */

export type CodigoResultado =
  | 'REGISTRADO'
  | 'YA_REGISTRADO'
  | 'NO_HABILITADO'
  | 'NO_RECONOCIDO'

export const RESULTADOS_ESCANEO: readonly CodigoResultado[] = [
  'REGISTRADO',
  'YA_REGISTRADO',
  'NO_HABILITADO',
  'NO_RECONOCIDO',
]

export function esResultadoEscaneo(valor: unknown): valor is CodigoResultado {
  return typeof valor === 'string' && (RESULTADOS_ESCANEO as readonly string[]).includes(valor)
}

/** Texto genérico por resultado. Una denegación nunca explica el motivo interno. */
export const MENSAJES_RESULTADO: Record<CodigoResultado, string> = {
  REGISTRADO: 'Acceso registrado.',
  YA_REGISTRADO: 'Este acceso ya se registró hoy. No se registra de nuevo.',
  NO_HABILITADO: 'No habilitado para este servicio. Derivá a la persona con Dirección.',
  NO_RECONOCIDO: 'No reconocemos este código QR. Probá de nuevo o derivá a la persona con Dirección.',
}

export type CodigoAcceso =
  | 'NO_AUTENTICADO'
  | 'ACCESO_BLOQUEADO'
  | 'SIN_PERMISO'
  | 'ORIGEN_NO_PERMITIDO'
  | 'CUERPO_INVALIDO'
  | 'CUERPO_DEMASIADO_GRANDE'
  | 'DATOS_INVALIDOS'
  | 'SERVICIO_INVALIDO'
  | 'LIMITE_EXCEDIDO'
  | 'INTENTO_REUTILIZADO'
  | 'MOTIVO_INVALIDO'
  | 'ACCESO_NO_ENCONTRADO'
  | 'ACCESO_NO_ANULABLE'
  | 'ACCESO_YA_ANULADO'
  | 'ACCESO_ANONIMIZADO'
  | 'SERVICIO_NO_DISPONIBLE'
  | 'TIEMPO_AGOTADO'
  | 'ERROR_INTERNO'

export const CATALOGO_ACCESOS: Record<CodigoAcceso, { estado: number; mensaje: string }> = {
  NO_AUTENTICADO: { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' },
  ACCESO_BLOQUEADO: { estado: 403, mensaje: 'Tu acceso está bloqueado. Comunicate con Dirección.' },
  SIN_PERMISO: { estado: 403, mensaje: 'No tenés permisos para realizar esta acción.' },
  ORIGEN_NO_PERMITIDO: { estado: 403, mensaje: 'La solicitud no proviene de esta aplicación.' },
  CUERPO_INVALIDO: { estado: 400, mensaje: 'La solicitud no tiene un formato válido.' },
  CUERPO_DEMASIADO_GRANDE: { estado: 413, mensaje: 'La solicitud es demasiado grande.' },
  DATOS_INVALIDOS: { estado: 422, mensaje: 'Los datos del escaneo no son válidos. Escaneá de nuevo.' },
  SERVICIO_INVALIDO: {
    estado: 422,
    mensaje: 'El servicio o el recorrido elegido no es válido. Elegilo de nuevo.',
  },
  LIMITE_EXCEDIDO: {
    estado: 429,
    mensaje: 'Hiciste demasiados intentos en poco tiempo. Esperá unos minutos antes de volver a escanear.',
  },
  INTENTO_REUTILIZADO: {
    estado: 409,
    mensaje: 'Este intento ya se usó con otros datos. Escaneá el código de nuevo.',
  },
  MOTIVO_INVALIDO: { estado: 422, mensaje: 'El motivo debe tener entre 3 y 200 caracteres.' },
  ACCESO_NO_ENCONTRADO: { estado: 404, mensaje: 'No encontramos el acceso solicitado.' },
  ACCESO_NO_ANULABLE: { estado: 409, mensaje: 'Solo se puede anular un acceso que se haya registrado.' },
  ACCESO_YA_ANULADO: { estado: 409, mensaje: 'Este acceso ya estaba anulado.' },
  ACCESO_ANONIMIZADO: {
    estado: 409,
    mensaje: 'Este acceso ya fue anonimizado por la política de retención y no puede anularse.',
  },
  SERVICIO_NO_DISPONIBLE: {
    estado: 503,
    mensaje: 'El registro de accesos no está disponible en este momento. Volvé a intentarlo en unos minutos.',
  },
  TIEMPO_AGOTADO: {
    estado: 504,
    mensaje:
      'La respuesta tardó demasiado y no sabemos si el acceso se registró. Tocá «Reintentar»: se reutiliza el mismo intento y no se duplica.',
  },
  ERROR_INTERNO: {
    estado: 500,
    mensaje: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.',
  },
}

/** SQLSTATE propios (P565x–P566x) y compartidos del proyecto, traducidos a un código cerrado. */
const CODIGO_POR_SQLSTATE: Record<string, CodigoAcceso> = {
  P5505: 'NO_AUTENTICADO',
  '42501': 'SIN_PERMISO',
  P5651: 'DATOS_INVALIDOS',
  P5652: 'SERVICIO_INVALIDO',
  P5653: 'SERVICIO_INVALIDO',
  P5663: 'ACCESO_NO_ANULABLE',
  P5664: 'MOTIVO_INVALIDO',
  P5665: 'ACCESO_NO_ENCONTRADO',
  P5666: 'ACCESO_ANONIMIZADO',
  P5667: 'ACCESO_YA_ANULADO',
}

export function codigoDesdeSqlstate(sqlstate: string | null | undefined): CodigoAcceso {
  return (sqlstate && CODIGO_POR_SQLSTATE[sqlstate]) || 'ERROR_INTERNO'
}

/** Cuerpo de error de la API: `{ error, codigo }`, sin nada más. */
export type CuerpoError = { error: string; codigo: CodigoAcceso }

export function cuerpoDeError(codigo: CodigoAcceso): CuerpoError {
  return { error: CATALOGO_ACCESOS[codigo].mensaje, codigo }
}
