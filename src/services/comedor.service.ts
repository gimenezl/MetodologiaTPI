import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Acceso a los servicios escolares y a sus inscripciones, ligado a la sesión
 * real de Supabase (EPT-10).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Nunca usa `service_role`. Las lecturas atraviesan la vista
 * `inscripciones_servicios_detalle`, que es `security_invoker` y por lo tanto
 * respeta RLS: el estudiante obtiene solo sus filas y el director todas. Las
 * escrituras atraviesan los envoltorios públicos, que revalidan `auth.uid()` y
 * el rol dentro de PostgreSQL y derivan el alumno de la sesión.
 *
 * Ninguna función de este módulo acepta un alumno, un perfil, un usuario ni un
 * legajo como parámetro, y no existe ninguna operación de borrado.
 */

/** Código estable del servicio de comedor, sembrado por la migración 013. */
export const CODIGO_SERVICIO_COMEDOR = 'COMEDOR'

/** Un servicio del catálogo institucional. */
export type ServicioEscolar = {
  id: string
  tipo: 'COMEDOR' | 'TRANSPORTE'
  codigo: string
  nombre: string
  activo: boolean
}

/** Una inscripción con el alumno, su legajo y el servicio ya resueltos. */
export type InscripcionServicio = {
  id: string
  alumno_id: string
  alumno_nombre: string
  alumno_apellido: string
  legajo_nro: string | null
  alumno_estado: 'ACTIVO' | 'INACTIVO'
  servicio_id: string
  servicio_tipo: 'COMEDOR' | 'TRANSPORTE'
  servicio_codigo: string
  servicio_nombre: string
  estado: 'ACTIVA' | 'CANCELADA'
  fecha_inscripcion: string
  fecha_cancelacion: string | null
}

export type CampoComedor = 'servicio_id' | 'accion'

export type EstadoErrorComedor = 400 | 401 | 403 | 404 | 409 | 500

export type ResultadoComedor<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: EstadoErrorComedor; mensaje: string; campo?: CampoComedor }

/** SQLSTATE que este dominio traduce de forma estable. */
const SQLSTATE_DUPLICADO = '23505'
const SQLSTATE_CLAVE_FORANEA = '23503'
const SQLSTATE_CHECK = '23514'
const SQLSTATE_ENTRADA_INVALIDA = '22P02'
const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_IDENTIDAD_AUSENTE = 'P5505'
const SQLSTATE_SERVICIO_INEXISTENTE = 'P5550'
const SQLSTATE_SERVICIO_INACTIVO = 'P5551'
const SQLSTATE_SIN_LEGAJO_ACADEMICO = 'P5552'
const SQLSTATE_ALUMNO_NO_ACTIVO = 'P5553'
const SQLSTATE_ALUMNO_SIN_LEGAJO = 'P5554'
const SQLSTATE_INSCRIPCION_INEXISTENTE = 'P5555'
const SQLSTATE_INSCRIPCION_YA_CANCELADA = 'P5556'
const SQLSTATE_IDENTIDAD_PROTEGIDA = 'P5557'
const SQLSTATE_TRANSICION_INVALIDA = 'P5558'

const MENSAJE_GENERICO =
  'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

const COLUMNAS_SERVICIO = 'id, tipo, codigo, nombre, activo'

const COLUMNAS_INSCRIPCION =
  'id, alumno_id, alumno_nombre, alumno_apellido, legajo_nro, alumno_estado, ' +
  'servicio_id, servicio_tipo, servicio_codigo, servicio_nombre, estado, ' +
  'fecha_inscripcion, fecha_cancelacion'

type Operacion =
  | 'obtenerServicio'
  | 'obtenerEstadoAcademico'
  | 'listarInscripciones'
  | 'inscribirEnServicio'
  | 'cancelarInscripcion'

type ErrorPostgres = { code?: string | null; message?: string | null }

/**
 * Traduce errores de PostgreSQL en resultados estables, sin devolver al
 * navegador detalles internos, nombres de restricciones, consultas ni SQLSTATE.
 */
function traducirErrorComedor(
  error: ErrorPostgres,
  operacion: Operacion
): { estado: EstadoErrorComedor; mensaje: string; campo?: CampoComedor } {
  switch (error.code) {
    case SQLSTATE_DUPLICADO:
      // Lo produce el índice único parcial, que es la autoridad de la regla
      // también cuando dos pedidos simultáneos llegan a la vez.
      return {
        estado: 409,
        mensaje: 'Ya tenés una inscripción activa al comedor.',
        campo: 'servicio_id',
      }
    case SQLSTATE_SERVICIO_INEXISTENTE:
    case SQLSTATE_CLAVE_FORANEA:
      return {
        estado: 404,
        mensaje: 'El servicio solicitado no existe.',
        campo: 'servicio_id',
      }
    case SQLSTATE_SERVICIO_INACTIVO:
      return {
        estado: 409,
        mensaje: 'El comedor no está disponible para nuevas inscripciones.',
        campo: 'servicio_id',
      }
    case SQLSTATE_SIN_LEGAJO_ACADEMICO:
      return {
        estado: 409,
        mensaje:
          'Todavía no tenés un legajo académico. Comunicate con la administración del centro educativo.',
      }
    case SQLSTATE_ALUMNO_NO_ACTIVO:
      return {
        estado: 409,
        mensaje:
          'Tu legajo académico no está activo, así que no podés inscribirte al comedor. Comunicate con la administración del centro educativo.',
      }
    case SQLSTATE_ALUMNO_SIN_LEGAJO:
      return {
        estado: 409,
        mensaje:
          'Tu legajo académico no tiene número asignado. Comunicate con la administración del centro educativo.',
      }
    case SQLSTATE_INSCRIPCION_INEXISTENTE:
      // Una inscripción ajena y una inexistente devuelven exactamente lo mismo:
      // no se delata que la de otra persona exista.
      return {
        estado: 404,
        mensaje: 'No encontramos una inscripción activa tuya para cancelar.',
      }
    case SQLSTATE_INSCRIPCION_YA_CANCELADA:
      return { estado: 409, mensaje: 'Esa inscripción ya estaba cancelada.' }
    case SQLSTATE_IDENTIDAD_PROTEGIDA:
    case SQLSTATE_TRANSICION_INVALIDA:
      return {
        estado: 409,
        mensaje: 'Esa operación no está permitida sobre una inscripción existente.',
      }
    case SQLSTATE_CHECK:
    case SQLSTATE_ENTRADA_INVALIDA:
      return { estado: 400, mensaje: 'Los datos enviados no son válidos.' }
    case SQLSTATE_IDENTIDAD_AUSENTE:
      return { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      return {
        estado: 403,
        mensaje: 'Solo un estudiante puede administrar su inscripción al comedor.',
      }
    default:
      console.error('[comedor] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return { estado: 500, mensaje: MENSAJE_GENERICO }
  }
}

/** Una escritura sin fila devuelta no es un éxito confirmado. */
function exigirFila<T>(
  datos: T | null | undefined,
  mensaje: string
): ResultadoComedor<T> {
  if (!datos) {
    return { ok: false, estado: 500, mensaje }
  }
  return { ok: true, datos }
}

// ----------------------------------------------------------------
// Lecturas
// ----------------------------------------------------------------

/**
 * Resuelve el servicio de comedor por su código estable.
 *
 * El identificador nunca viaja desde el navegador como autoridad: la pantalla
 * lo recibe del servidor, y de todos modos PostgreSQL vuelve a verificar que el
 * servicio exista y esté activo en el momento del alta.
 */
export async function obtenerServicioComedor(): Promise<
  ResultadoComedor<ServicioEscolar | null>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('servicios_escolares')
    .select(COLUMNAS_SERVICIO)
    .eq('codigo', CODIGO_SERVICIO_COMEDOR)
    .maybeSingle()

  if (error) return { ok: false, ...traducirErrorComedor(error, 'obtenerServicio') }
  return { ok: true, datos: (data ?? null) as unknown as ServicioEscolar | null }
}

/**
 * Inscripciones visibles para la sesión actual, incluidas las canceladas.
 *
 * No recibe ni filtra por alumno: RLS decide. Un estudiante obtiene su propio
 * historial; el director, el listado administrativo completo. Por eso la misma
 * función sirve a las dos pantallas sin ninguna rama de autorización propia.
 */
export async function listarInscripcionesComedor(): Promise<
  ResultadoComedor<InscripcionServicio[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('inscripciones_servicios_detalle')
    .select(COLUMNAS_INSCRIPCION)
    .eq('servicio_codigo', CODIGO_SERVICIO_COMEDOR)
    .order('fecha_inscripcion', { ascending: false })

  if (error) return { ok: false, ...traducirErrorComedor(error, 'listarInscripciones') }
  return { ok: true, datos: (data ?? []) as unknown as InscripcionServicio[] }
}

// ----------------------------------------------------------------
// Escrituras
// ----------------------------------------------------------------

/**
 * Alta de la inscripción del alumno de la sesión.
 *
 * El único parámetro es el servicio. El alumno lo deriva PostgreSQL de
 * `auth.uid()`, de modo que no existe forma de inscribir a otra persona ni
 * manipulando la petición.
 */
export async function inscribirEnServicio(
  servicioId: string
): Promise<ResultadoComedor<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('inscribir_en_servicio', {
    p_servicio_id: servicioId,
  })

  if (error) return { ok: false, ...traducirErrorComedor(error, 'inscribirEnServicio') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar tu inscripción. Revisá tu estado antes de reintentar.'
  )
}

/**
 * Baja lógica de una inscripción propia. No elimina ninguna fila: registra la
 * cancelación y conserva el ciclo en el historial.
 */
export async function cancelarInscripcionServicio(
  inscripcionId: string
): Promise<ResultadoComedor<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cancelar_inscripcion_servicio', {
    p_inscripcion_id: inscripcionId,
  })

  if (error) return { ok: false, ...traducirErrorComedor(error, 'cancelarInscripcion') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar la baja. Revisá tu estado antes de reintentar.'
  )
}

/** Estado académico propio, necesario para explicar por qué no se puede inscribir. */
export type EstadoAcademicoPropio = {
  estado: 'ACTIVO' | 'INACTIVO'
  legajo_nro: string | null
}

/**
 * Situación académica del alumno de la sesión.
 *
 * No recibe ni filtra por identificador: la vista `alumnos_academicos` es
 * `security_invoker` y RLS devuelve exclusivamente la fila cuyo `perfil_id`
 * coincide con la sesión. Un actor sin legajo académico propio obtiene `null`,
 * no un error que delate a otra persona.
 *
 * Sirve para EXPLICAR el impedimento en la pantalla, no para autorizar: la
 * decisión real la vuelve a tomar PostgreSQL en cada intento de alta.
 */
export async function obtenerEstadoAcademicoPropio(): Promise<
  ResultadoComedor<EstadoAcademicoPropio | null>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alumnos_academicos')
    .select('estado, legajo_nro')
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, ...traducirErrorComedor(error, 'obtenerEstadoAcademico') }
  return { ok: true, datos: (data ?? null) as unknown as EstadoAcademicoPropio | null }
}
