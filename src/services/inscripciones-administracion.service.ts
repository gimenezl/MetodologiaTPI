import type { DominioInscripcion } from '@/lib/validations'
import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Administración de inscripciones por Dirección (EPT-62, RF16): consultar,
 * confirmar y cancelar las inscripciones académicas, deportivas y de servicios.
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Son TRES modelos distintos y no se funden en uno: `matriculas`,
 * `inscripciones_deportivas` e `inscripciones_servicios` (comedor y transporte).
 * El modelo legado de actividades queda fuera.
 *
 * Nunca usa `service_role`. Las lecturas atraviesan vistas `security_invoker`
 * que solo devuelven filas a Dirección; las escrituras atraviesan funciones
 * públicas que revalidan `auth.uid()` y el rol DIRECTOR dentro de PostgreSQL.
 * Ninguna función de este módulo acepta un alumno, un actor ni un rol: el único
 * dato que decide sobre qué se opera es el dominio y el identificador.
 *
 * Confirmar no es consultar: es una acción real, registrada y exclusiva de
 * Dirección. No condiciona la vigencia de la inscripción y es idempotente. La
 * matrícula académica no se cancela con una operación nueva: se cierra con el
 * flujo vigente de Alumnos (inactivar al alumno o cambiar su curso).
 */

// ----------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------

export type { DominioInscripcion }

type EstadoAlumno = 'ACTIVO' | 'INACTIVO'
type EstadoInscripcion = 'ACTIVA' | 'CANCELADA'
type TipoServicio = 'COMEDOR' | 'TRANSPORTE'

/** Marca de confirmación, común a las tres lecturas. Todo `null` si no se confirmó. */
type Confirmacion = {
  confirmada: boolean
  confirmada_en: string | null
  confirmada_por_nombre: string | null
  confirmada_por_apellido: string | null
}

type AlumnoAdministrado = {
  alumno_id: string
  alumno_nombre: string
  alumno_apellido: string
  legajo_nro: string | null
  alumno_estado: EstadoAlumno
}

/** Una matrícula, vigente o cerrada, con su curso, nivel y confirmación. */
export type MatriculaAdministracion = AlumnoAdministrado &
  Confirmacion & {
    id: string
    curso_id: string
    curso_denominacion: string
    curso_division: string
    nivel_id: number
    nivel_nombre: string
    fecha_inicio: string
    fecha_cierre: string | null
    motivo_cierre: 'CAMBIO_DE_CURSO' | 'INACTIVACION' | null
    vigente: boolean
  }

/** Una inscripción deportiva, activa o cancelada, con su grupo y confirmación. */
export type InscripcionDeportivaAdministracion = AlumnoAdministrado &
  Confirmacion & {
    id: string
    grupo_id: string
    grupo_nombre: string
    deporte_id: string
    deporte_nombre: string
    nivel_id: number
    nivel_nombre: string
    estado: EstadoInscripcion
    fecha_inscripcion: string
    fecha_cancelacion: string | null
  }

/** Una inscripción a un servicio (comedor o transporte) con su confirmación. */
export type InscripcionServicioAdministracion = AlumnoAdministrado &
  Confirmacion & {
    id: string
    servicio_id: string
    servicio_tipo: TipoServicio
    servicio_codigo: string
    servicio_nombre: string
    servicio_activo: boolean
    estado: EstadoInscripcion
    fecha_inscripcion: string
    fecha_cancelacion: string | null
  }

/** Confirmación registrada, sin datos personales más que el nombre de quien confirmó. */
export type ConfirmacionInscripcion = {
  dominio: 'MATRICULA' | 'DEPORTE' | 'SERVICIO'
  inscripcion_id: string
  confirmada_en: string
  confirmada_por_nombre: string | null
  /** `true` si ya estaba confirmada: la primera persona y la primera fecha se conservan. */
  ya_confirmada: boolean
}

/** Resultado mínimo de una cancelación administrativa. Sin identificadores de alumno. */
export type CancelacionInscripcion = {
  id: string
  estado: 'CANCELADA'
  fecha_cancelacion: string | null
}

export type EstadoErrorInscripciones = 400 | 401 | 403 | 404 | 409 | 500

/** Códigos de dominio estables que acompañan a un error, para que la pantalla decida. */
export type CodigoErrorInscripciones =
  | 'DATOS_INVALIDOS'
  | 'INSCRIPCION_NO_ENCONTRADA'
  | 'INSCRIPCION_NO_VIGENTE'
  | 'INSCRIPCION_YA_CANCELADA'
  | 'REGISTRO_PROTEGIDO'
  | 'CONFLICTO_CONCURRENCIA'
  | 'MATRICULA_NO_SE_CANCELA'
  | 'ACCESO_DENEGADO'
  | 'SIN_SESION'
  | 'ERROR_INTERNO'

export type ResultadoInscripciones<T> =
  | { ok: true; datos: T }
  | {
      ok: false
      estado: EstadoErrorInscripciones
      mensaje: string
      codigo: CodigoErrorInscripciones
      campo?: 'dominio' | 'id'
    }

type Fallo = Extract<ResultadoInscripciones<never>, { ok: false }>

// ----------------------------------------------------------------
// Errores
// ----------------------------------------------------------------

/** SQLSTATE que este dominio traduce de forma estable. */
const SQLSTATE_INTERBLOQUEO = '40P01'
const SQLSTATE_SERIALIZACION = '40001'
const SQLSTATE_UNICIDAD = '23505'
const SQLSTATE_CLAVE_FORANEA = '23503'
const SQLSTATE_ENTRADA_INVALIDA = '22P02'
const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_IDENTIDAD_AUSENTE = 'P5505'
const SQLSTATE_NO_EXISTE = 'P6201'
const SQLSTATE_NO_VIGENTE = 'P6202'
const SQLSTATE_YA_CANCELADA = 'P6203'
const SQLSTATE_REGISTRO_PROTEGIDO = 'P6204'

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

const MENSAJE_MATRICULA_NO_SE_CANCELA =
  'Una matrícula no se cancela desde acá. Para cerrarla, inactivá al alumno o cambiale el curso desde Alumnos.'

const NOMBRE_DOMINIO: Record<DominioInscripcion, { singular: string; nueva: string }> = {
  matriculas: { singular: 'matrícula', nueva: 'la matrícula' },
  deportes: { singular: 'inscripción deportiva', nueva: 'la inscripción deportiva' },
  comedor: { singular: 'inscripción al comedor', nueva: 'la inscripción al comedor' },
  transporte: { singular: 'inscripción de transporte', nueva: 'la inscripción de transporte' },
}

type Operacion = 'confirmar' | 'cancelar' | 'listar'

type ErrorPostgres = { code?: string | null }

/**
 * Traduce errores de PostgreSQL en resultados estables, sin devolver al
 * navegador detalles internos, nombres de restricciones, consultas ni SQLSTATE.
 *
 * Una inscripción inexistente, una de otro dominio (por ejemplo, un identificador
 * de comedor pedido por la ruta de transporte) y una ajena responden lo mismo.
 */
function traducirError(
  error: ErrorPostgres,
  operacion: Operacion,
  dominio: DominioInscripcion | null
): Fallo {
  const nombre = dominio ? NOMBRE_DOMINIO[dominio] : null

  switch (error.code) {
    case SQLSTATE_IDENTIDAD_AUSENTE:
      return {
        ok: false,
        estado: 401,
        codigo: 'SIN_SESION',
        mensaje: 'Necesitás iniciar sesión para continuar.',
      }
    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      return {
        ok: false,
        estado: 403,
        codigo: 'ACCESO_DENEGADO',
        mensaje: 'Solo Dirección puede administrar las inscripciones.',
      }
    case SQLSTATE_NO_EXISTE:
    case SQLSTATE_CLAVE_FORANEA:
      return {
        ok: false,
        estado: 404,
        codigo: 'INSCRIPCION_NO_ENCONTRADA',
        mensaje: `No encontramos ${nombre ? nombre.nueva : 'la inscripción'} solicitada.`,
        campo: 'id',
      }
    case SQLSTATE_NO_VIGENTE:
      return {
        ok: false,
        estado: 409,
        codigo: 'INSCRIPCION_NO_VIGENTE',
        mensaje:
          dominio === 'matriculas'
            ? 'La matrícula ya está cerrada y no puede confirmarse.'
            : 'La inscripción está cancelada y no puede confirmarse.',
      }
    case SQLSTATE_YA_CANCELADA:
      return {
        ok: false,
        estado: 409,
        codigo: 'INSCRIPCION_YA_CANCELADA',
        mensaje: 'Esa inscripción ya estaba cancelada.',
      }
    case SQLSTATE_REGISTRO_PROTEGIDO:
      return {
        ok: false,
        estado: 409,
        codigo: 'REGISTRO_PROTEGIDO',
        mensaje: 'La confirmación es un registro histórico y no puede modificarse ni eliminarse.',
      }
    case SQLSTATE_INTERBLOQUEO:
    case SQLSTATE_SERIALIZACION:
    case SQLSTATE_UNICIDAD:
      return {
        ok: false,
        estado: 409,
        codigo: 'CONFLICTO_CONCURRENCIA',
        mensaje:
          'Otra operación estaba modificando esta inscripción al mismo tiempo. Revisá su estado y reintentá.',
      }
    case SQLSTATE_ENTRADA_INVALIDA:
      return {
        ok: false,
        estado: 400,
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Los datos enviados no son válidos.',
        campo: 'id',
      }
    default:
      // Sin mensaje, sin identificadores y sin datos de personas: solo qué
      // operación falló, sobre qué dominio y con qué código.
      console.error('[inscripciones-administracion] error inesperado de la base', {
        operacion,
        dominio,
        code: error.code ?? null,
      })
      return { ok: false, estado: 500, codigo: 'ERROR_INTERNO', mensaje: MENSAJE_GENERICO }
  }
}

function errorInterno(operacion: Operacion, dominio: DominioInscripcion | null, motivo: string): Fallo {
  console.error('[inscripciones-administracion] respuesta inesperada de la base', {
    operacion,
    dominio,
    motivo,
  })
  return { ok: false, estado: 500, codigo: 'ERROR_INTERNO', mensaje: MENSAJE_GENERICO }
}

// ----------------------------------------------------------------
// Lecturas
// ----------------------------------------------------------------

const COLUMNAS_ALUMNO =
  'alumno_id, alumno_nombre, alumno_apellido, legajo_nro, alumno_estado'
const COLUMNAS_CONFIRMACION =
  'confirmada, confirmada_en, confirmada_por_nombre, confirmada_por_apellido'

const COLUMNAS_MATRICULA =
  `id, ${COLUMNAS_ALUMNO}, curso_id, curso_denominacion, curso_division, nivel_id, nivel_nombre, ` +
  `fecha_inicio, fecha_cierre, motivo_cierre, vigente, ${COLUMNAS_CONFIRMACION}`

const COLUMNAS_DEPORTIVA =
  `id, ${COLUMNAS_ALUMNO}, grupo_id, grupo_nombre, deporte_id, deporte_nombre, nivel_id, nivel_nombre, ` +
  `estado, fecha_inscripcion, fecha_cancelacion, ${COLUMNAS_CONFIRMACION}`

const COLUMNAS_SERVICIO =
  `id, ${COLUMNAS_ALUMNO}, servicio_id, servicio_tipo, servicio_codigo, servicio_nombre, servicio_activo, ` +
  `estado, fecha_inscripcion, fecha_cancelacion, ${COLUMNAS_CONFIRMACION}`

/**
 * Todas las matrículas —vigentes y cerradas— con su confirmación. Más recientes
 * primero; el identificador desempata para que el orden sea estable entre
 * lecturas. No recibe ni filtra por alumno: la vista solo devuelve filas a
 * Dirección. Es la base que EPT-63 reutiliza; no es un reporte.
 */
export async function listarMatriculasAdministracion(): Promise<
  ResultadoInscripciones<MatriculaAdministracion[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('matriculas_administracion')
    .select(COLUMNAS_MATRICULA)
    .order('fecha_inicio', { ascending: false })
    .order('id', { ascending: true })

  if (error) return traducirError(error, 'listar', 'matriculas')
  return { ok: true, datos: (data ?? []) as unknown as MatriculaAdministracion[] }
}

/** Todas las inscripciones deportivas —activas y canceladas— con su confirmación. */
export async function listarInscripcionesDeportivasAdministracion(): Promise<
  ResultadoInscripciones<InscripcionDeportivaAdministracion[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('inscripciones_deportivas_administracion')
    .select(COLUMNAS_DEPORTIVA)
    .order('fecha_inscripcion', { ascending: false })
    .order('id', { ascending: true })

  if (error) return traducirError(error, 'listar', 'deportes')
  return { ok: true, datos: (data ?? []) as unknown as InscripcionDeportivaAdministracion[] }
}

/**
 * Las inscripciones de un servicio —activas y canceladas— con su confirmación.
 * El tipo se decide acá, del lado del servidor: `'COMEDOR'` o `'TRANSPORTE'`.
 */
export async function listarInscripcionesServiciosAdministracion(
  tipo: TipoServicio
): Promise<ResultadoInscripciones<InscripcionServicioAdministracion[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('inscripciones_servicios_administracion')
    .select(COLUMNAS_SERVICIO)
    .eq('servicio_tipo', tipo)
    .order('fecha_inscripcion', { ascending: false })
    .order('id', { ascending: true })

  if (error) {
    return traducirError(error, 'listar', tipo === 'COMEDOR' ? 'comedor' : 'transporte')
  }
  return { ok: true, datos: (data ?? []) as unknown as InscripcionServicioAdministracion[] }
}

// ----------------------------------------------------------------
// Escrituras
// ----------------------------------------------------------------

const TIPO_POR_DOMINIO: Record<'comedor' | 'transporte', TipoServicio> = {
  comedor: 'COMEDOR',
  transporte: 'TRANSPORTE',
}

const DOMINIOS_REGISTRO = new Set(['MATRICULA', 'DEPORTE', 'SERVICIO'])

/** Valida la forma del `jsonb` que devuelven las funciones de confirmación. */
function proyectarConfirmacion(datos: unknown): ConfirmacionInscripcion | null {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return null
  const fila = datos as Record<string, unknown>

  if (
    typeof fila.dominio !== 'string' ||
    !DOMINIOS_REGISTRO.has(fila.dominio) ||
    typeof fila.inscripcion_id !== 'string' ||
    typeof fila.confirmada_en !== 'string' ||
    typeof fila.ya_confirmada !== 'boolean'
  ) {
    return null
  }

  return {
    dominio: fila.dominio as ConfirmacionInscripcion['dominio'],
    inscripcion_id: fila.inscripcion_id,
    confirmada_en: fila.confirmada_en,
    confirmada_por_nombre:
      typeof fila.confirmada_por_nombre === 'string' ? fila.confirmada_por_nombre : null,
    ya_confirmada: fila.ya_confirmada,
  }
}

/**
 * Confirma una inscripción (o una matrícula) en nombre de Dirección.
 *
 * Es una acción real y registrada: PostgreSQL guarda quién y cuándo la
 * confirmó, y solo Dirección puede consultarlo. Confirmar por segunda vez
 * devuelve la confirmación original (`ya_confirmada: true`) sin cambiar a la
 * primera persona ni la primera fecha. Una inscripción cancelada o una matrícula
 * cerrada no se confirma. La confirmación no condiciona la vigencia.
 *
 * El identificador de una inscripción de otro dominio responde igual que uno
 * inexistente: la ruta del comedor no confirma una inscripción de transporte.
 */
export async function confirmarInscripcion(
  dominio: DominioInscripcion,
  id: string
): Promise<ResultadoInscripciones<ConfirmacionInscripcion>> {
  const supabase = await createServerSupabaseClient()

  const { data, error } =
    dominio === 'matriculas'
      ? await supabase.rpc('confirmar_matricula', { p_matricula_id: id })
      : dominio === 'deportes'
        ? await supabase.rpc('confirmar_inscripcion_deportiva', { p_inscripcion_id: id })
        : await supabase.rpc('confirmar_inscripcion_servicio', {
            p_inscripcion_id: id,
            p_tipo: TIPO_POR_DOMINIO[dominio],
          })

  if (error) return traducirError(error, 'confirmar', dominio)

  const confirmacion = proyectarConfirmacion(data)
  if (!confirmacion) return errorInterno('confirmar', dominio, 'forma')
  return { ok: true, datos: confirmacion }
}

/**
 * Cancela una inscripción en nombre del alumno, por decisión de Dirección. Baja
 * lógica: no elimina ninguna fila, registra la fecha y conserva el historial y
 * la confirmación, si la había.
 *
 * Una matrícula NO se cancela por esta vía y esta función nunca simula que sí:
 * la matrícula académica se cierra con el flujo vigente de Alumnos, que además
 * mantiene el invariante «alumno activo = exactamente una matrícula vigente».
 */
export async function cancelarInscripcionAdministrativa(
  dominio: DominioInscripcion,
  id: string
): Promise<ResultadoInscripciones<CancelacionInscripcion>> {
  if (dominio === 'matriculas') {
    return {
      ok: false,
      estado: 400,
      codigo: 'MATRICULA_NO_SE_CANCELA',
      mensaje: MENSAJE_MATRICULA_NO_SE_CANCELA,
      campo: 'dominio',
    }
  }

  const supabase = await createServerSupabaseClient()

  const { data, error } =
    dominio === 'deportes'
      ? await supabase.rpc('cancelar_inscripcion_deportiva_administrativa', {
          p_inscripcion_id: id,
        })
      : await supabase.rpc('cancelar_inscripcion_servicio_administrativa', {
          p_inscripcion_id: id,
          p_tipo: TIPO_POR_DOMINIO[dominio],
        })

  if (error) return traducirError(error, 'cancelar', dominio)

  // Solo se devuelve lo mínimo: nada del alumno ni del grupo o servicio.
  const fila = data as { id?: unknown; estado?: unknown; fecha_cancelacion?: unknown } | null
  if (!fila || typeof fila.id !== 'string' || fila.estado !== 'CANCELADA') {
    return errorInterno('cancelar', dominio, 'forma')
  }
  return {
    ok: true,
    datos: {
      id: fila.id,
      estado: 'CANCELADA',
      fecha_cancelacion: typeof fila.fecha_cancelacion === 'string' ? fila.fecha_cancelacion : null,
    },
  }
}
