/**
 * Catálogo de errores de la credencial QR (EPT-64).
 *
 * Cada mensaje está en español y es apto para mostrarse tal cual. Nunca incluye
 * SQLSTATE, nombres de tablas, restricciones, claves ni payloads: el detalle
 * técnico se queda en el servidor.
 */

export type CodigoCredencial =
  | 'NO_AUTENTICADO'
  | 'ACCESO_BLOQUEADO'
  | 'SIN_PERMISO'
  | 'ALUMNO_NO_ENCONTRADO'
  | 'CREDENCIAL_NO_ENCONTRADA'
  | 'CREDENCIAL_YA_ACTIVA'
  | 'CREDENCIAL_NO_VIGENTE'
  | 'ALUMNO_INACTIVO'
  | 'MOTIVO_INVALIDO'
  | 'IDENTIFICADOR_INVALIDO'
  | 'CUERPO_INVALIDO'
  | 'CUERPO_DEMASIADO_GRANDE'
  | 'SERVICIO_NO_DISPONIBLE'
  | 'ERROR_INTERNO'

export const CATALOGO_CREDENCIALES: Record<CodigoCredencial, { estado: number; mensaje: string }> = {
  NO_AUTENTICADO: { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' },
  ACCESO_BLOQUEADO: { estado: 403, mensaje: 'Tu acceso está bloqueado. Comunicate con Dirección.' },
  SIN_PERMISO: { estado: 403, mensaje: 'No tenés permisos para realizar esta acción.' },
  ALUMNO_NO_ENCONTRADO: { estado: 404, mensaje: 'No encontramos al alumno solicitado.' },
  CREDENCIAL_NO_ENCONTRADA: { estado: 404, mensaje: 'No encontramos la credencial solicitada.' },
  CREDENCIAL_YA_ACTIVA: {
    estado: 409,
    mensaje: 'El alumno ya tiene una credencial activa. Para cambiarla, reponela o revocala.',
  },
  CREDENCIAL_NO_VIGENTE: {
    estado: 409,
    mensaje: 'La credencial ya no está vigente. Actualizá la pantalla para ver su estado actual.',
  },
  ALUMNO_INACTIVO: {
    estado: 409,
    mensaje: 'El alumno está inactivo: no se emite ni se repone su credencial. Reactivá al alumno primero.',
  },
  MOTIVO_INVALIDO: { estado: 422, mensaje: 'El motivo debe tener entre 3 y 200 caracteres.' },
  IDENTIFICADOR_INVALIDO: { estado: 400, mensaje: 'El identificador indicado no es válido.' },
  CUERPO_INVALIDO: { estado: 400, mensaje: 'La solicitud no tiene un formato válido.' },
  CUERPO_DEMASIADO_GRANDE: { estado: 413, mensaje: 'La solicitud es demasiado grande.' },
  SERVICIO_NO_DISPONIBLE: {
    estado: 503,
    mensaje: 'Las credenciales no están disponibles en este momento. Volvé a intentarlo en unos minutos.',
  },
  ERROR_INTERNO: {
    estado: 500,
    mensaje: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.',
  },
}

/** SQLSTATE propios de la migración de la credencial (P562x) y los compartidos del proyecto. */
const CODIGO_POR_SQLSTATE: Record<string, CodigoCredencial> = {
  P5505: 'NO_AUTENTICADO',
  '42501': 'SIN_PERMISO',
  P5620: 'ALUMNO_NO_ENCONTRADO',
  P5621: 'CREDENCIAL_YA_ACTIVA',
  P5622: 'CREDENCIAL_NO_ENCONTRADA',
  P5623: 'CREDENCIAL_NO_VIGENTE',
  P5624: 'MOTIVO_INVALIDO',
  // La base rechazó el `kid` que envió el servidor: es un problema de configuración, no del usuario.
  P5625: 'SERVICIO_NO_DISPONIBLE',
  P5627: 'ALUMNO_INACTIVO',
}

export function codigoDesdeSqlstate(sqlstate: string | null | undefined): CodigoCredencial {
  return (sqlstate && CODIGO_POR_SQLSTATE[sqlstate]) || 'ERROR_INTERNO'
}

/** Cuerpo de error de la API: `{ error, codigo }`, sin nada más. */
export type CuerpoError = { error: string; codigo: CodigoCredencial }

export function cuerpoDeError(codigo: CodigoCredencial): CuerpoError {
  return { error: CATALOGO_CREDENCIALES[codigo].mensaje, codigo }
}
