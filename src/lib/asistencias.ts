import { z } from 'zod'

/**
 * Asistencias del personal por vínculo vigente (EPT-66, unidad D).
 *
 * Lógica pura —sin Supabase, Next ni React—: el contrato del cuerpo de la API,
 * la validación de la fecha y la traducción de los errores de PostgreSQL a
 * mensajes en español. Lo comparten el servidor, el cliente del navegador y las
 * pruebas.
 *
 * Códigos que emiten las funciones de la base (migración 30):
 *   P5505  sin identidad autenticada
 *   42501  rol sin competencia, cuenta bloqueada o sin perfil
 *   P6610  el alumno no está disponible para este actor (inexistente, no es
 *          estudiante o sin vínculo vigente: una sola respuesta para los tres)
 *   P6611  datos inválidos (alumno, fecha o estado)
 *   P6612  se intentó modificar la identidad de una asistencia
 *
 * Nunca se muestra un mensaje de PostgreSQL, un SQLSTATE ni un nombre de tabla.
 */

export const ESTADOS_ASISTENCIA = ['PRESENTE', 'AUSENTE', 'JUSTIFICADO'] as const
export type EstadoAsistencia = (typeof ESTADOS_ASISTENCIA)[number]

export type ResultadoRegistro = 'CREADA' | 'ACTUALIZADA' | 'SIN_CAMBIOS'

/** Alumno que el personal puede elegir: los cuatro datos mínimos, sin DNI ni domicilio. */
export type EstudianteDeAsistencia = {
  id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
}

/** Una asistencia tal como la muestra la pantalla de gestión. */
export type AsistenciaDeGestion = {
  id: string
  fecha: string
  estado: EstadoAsistencia
  estudiante_id: string | null
}

/** Fila del historial que alimenta el porcentaje de asistencia. */
export type HistorialAsistencia = {
  estudiante_id: string | null
  fecha: string
  estado: EstadoAsistencia
}

export type PanelDeAsistencias = {
  estudiantes: EstudianteDeAsistencia[]
  asistencias: AsistenciaDeGestion[]
  historial: HistorialAsistencia[]
}

export type AsistenciaRegistrada = {
  id: string
  estudiante_id: string
  fecha: string
  estado: EstadoAsistencia
  resultado: ResultadoRegistro
}

/** Fecha calendario `YYYY-MM-DD` que existe de verdad (no admite el 31 de febrero). */
export function esFechaValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(valor)) return false
  const fecha = new Date(`${valor}T00:00:00Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

export const fechaAsistenciaSchema = z
  .string({ message: 'Indicá la fecha de la asistencia' })
  .refine(esFechaValida, 'La fecha no es válida')

/**
 * El cuerpo solo transporta QUÉ alumno, QUÉ día y QUÉ estado. Nunca quién
 * registra: el registrante lo deriva PostgreSQL de `auth.uid()`. `.strict()`
 * rechaza cualquier intento de agregar `docente_id` u otra identidad.
 */
export const registroAsistenciaSchema = z
  .object({
    estudiante_id: z
      .string({ message: 'Seleccioná un alumno' })
      .uuid('Seleccioná un alumno'),
    fecha: fechaAsistenciaSchema,
    estado: z.enum(ESTADOS_ASISTENCIA, { message: 'Elegí un estado de asistencia válido' }),
  })
  .strict()

export type RegistroAsistenciaData = z.infer<typeof registroAsistenciaSchema>

/** Primer problema del cuerpo, sin el detalle interno de Zod. */
export function primerErrorAsistencia(error: z.ZodError): { mensaje: string; campo?: string } {
  const issue = error.issues[0]
  const campo = typeof issue?.path?.[0] === 'string' ? issue.path[0] : undefined
  if (!issue) return { mensaje: 'Datos inválidos' }
  if (issue.code === 'unrecognized_keys') {
    return { mensaje: 'La petición contiene campos no permitidos' }
  }
  if (issue.code === 'invalid_type' && !campo) return { mensaje: 'Datos inválidos' }
  return { mensaje: issue.message, campo }
}

export type CodigoErrorAsistencia =
  | 'NO_AUTENTICADO'
  | 'SIN_PERMISO'
  | 'ALUMNO_NO_DISPONIBLE'
  | 'DATOS_INVALIDOS'
  | 'CONFLICTO'
  | 'ERROR_INESPERADO'

export type ErrorTraducido = {
  estado: 400 | 401 | 403 | 404 | 409 | 500
  codigo: CodigoErrorAsistencia
  mensaje: string
}

export type ErrorRpc = { code?: string | null; message?: string | null } | null | undefined

export const MENSAJE_ALUMNO_NO_DISPONIBLE =
  'El alumno ya no está a tu cargo o no está disponible. Actualizamos la lista.'

/** Traduce el error de una operación de asistencias; el mensaje técnico nunca sale de acá. */
export function traducirErrorDeAsistencia(error: ErrorRpc): ErrorTraducido {
  switch (error?.code) {
    case 'P5505':
      return { estado: 401, codigo: 'NO_AUTENTICADO', mensaje: 'Tu sesión venció. Volvé a iniciar sesión.' }
    case '42501':
      return {
        estado: 403,
        codigo: 'SIN_PERMISO',
        mensaje: 'No tenés permiso para registrar asistencias de este alumno.',
      }
    case 'P6610':
      return { estado: 404, codigo: 'ALUMNO_NO_DISPONIBLE', mensaje: MENSAJE_ALUMNO_NO_DISPONIBLE }
    case 'P6611':
      return { estado: 400, codigo: 'DATOS_INVALIDOS', mensaje: 'Revisá el alumno, la fecha y el estado.' }
    case '40P01':
    case '40001':
    case '55P03':
      return {
        estado: 409,
        codigo: 'CONFLICTO',
        mensaje: 'Otra operación se cruzó con ésta. Volvé a intentarlo.',
      }
    default:
      return {
        estado: 500,
        codigo: 'ERROR_INESPERADO',
        mensaje: 'No pudimos completar la operación. Volvé a intentarlo.',
      }
  }
}

/** Texto que se muestra al registrar o corregir según lo que hizo la base. */
export function mensajeDeRegistro(resultado: ResultadoRegistro): string {
  switch (resultado) {
    case 'CREADA':
      return 'Asistencia registrada'
    case 'ACTUALIZADA':
      return 'Asistencia actualizada'
    default:
      return 'La asistencia ya tenía ese estado'
  }
}
