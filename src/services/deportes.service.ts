import { createServerSupabaseClient } from '@/services/supabase.server'
import type { CrearGrupoDeportivoData } from '@/lib/validations'

/**
 * Acceso a deportes, grupos e inscripciones deportivas, ligado a la sesión real
 * de Supabase (EPT-11).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Nunca usa `service_role`. Las lecturas pasan por la vista
 * `inscripciones_deportivas_detalle` (security_invoker, respeta RLS) y por
 * `listar_grupos_deportivos`, que decide en PostgreSQL el alcance de cada rol:
 * el estudiante recibe solo los grupos de SU nivel derivado y el director todos.
 * Las escrituras pasan por los envoltorios públicos, que revalidan `auth.uid()`
 * y el rol dentro de la base.
 *
 * Ninguna función acepta un alumno, un nivel, un cupo ni un estado como
 * parámetro, y no existe ninguna operación de borrado.
 */

/** Un grupo con su disponibilidad, tal como la calcula PostgreSQL. */
export type GrupoDeportivo = {
  grupo_id: string
  grupo_nombre: string
  deporte_id: string
  deporte_nombre: string
  deporte_activo: boolean
  nivel_id: number
  nivel_nombre: string
  /** `null` para el estudiante: no recibe el identificador del profesor. */
  profesor_id: string | null
  profesor_nombre: string
  profesor_apellido: string
  cupo: number
  ocupados: number
  disponibles: number
  activo: boolean
  /** Inscripción activa del estudiante de la sesión en este grupo, si existe. */
  inscripcion_propia_id: string | null
}

/** Una inscripción con alumno, legajo, grupo, deporte y nivel resueltos. */
export type InscripcionDeportiva = {
  id: string
  alumno_id: string
  alumno_nombre: string
  alumno_apellido: string
  legajo_nro: string | null
  grupo_id: string
  grupo_nombre: string
  deporte_id: string
  deporte_nombre: string
  nivel_id: number
  nivel_nombre: string
  estado: 'ACTIVA' | 'CANCELADA'
  fecha_inscripcion: string
  fecha_cancelacion: string | null
}

export type OpcionCatalogo = { id: string; nombre: string }
export type OpcionNivel = { id: number; nombre: string }
export type ProfesorDeportivo = { id: string; nombre: string; apellido: string }

export type CatalogoAltaGrupo = {
  deportes: OpcionCatalogo[]
  niveles: OpcionNivel[]
  profesores: ProfesorDeportivo[]
}

/** Situación académica propia: explica impedimentos, no autoriza nada. */
export type SituacionAcademicaPropia = {
  estado: 'ACTIVO' | 'INACTIVO'
  legajo_nro: string | null
  nivel_nombre: string | null
}

export type CampoDeportes =
  | 'grupo_id'
  | 'accion'
  | 'deporte_id'
  | 'nivel_id'
  | 'nombre'
  | 'cupo'
  | 'profesor_id'

export type EstadoErrorDeportes = 400 | 401 | 403 | 404 | 409 | 500

export type ResultadoDeportes<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: EstadoErrorDeportes; mensaje: string; campo?: CampoDeportes }

type Operacion =
  | 'listarGrupos'
  | 'listarInscripciones'
  | 'listarCatalogo'
  | 'obtenerSituacion'
  | 'inscribir'
  | 'cancelar'
  | 'crearGrupo'

type ErrorPostgres = { code?: string | null; message?: string | null }

const MENSAJE_GENERICO =
  'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

/**
 * Mensajes que la pantalla también usa para explicar un impedimento antes del
 * intento. Son exactamente los mismos que devuelve el servidor ante el rechazo,
 * para que la pantalla y la API nunca digan cosas distintas.
 */
export const MENSAJES_DEPORTES = {
  sinLegajo:
    'Todavía no tenés un legajo académico. Comunicate con la administración del centro educativo.',
  legajoInactivo:
    'Tu legajo académico no está activo, así que no podés inscribirte a deportes. Comunicate con la administración del centro educativo.',
  sinCurso:
    'No tenés un curso vigente, así que no podemos determinar tu nivel educativo. Comunicate con la administración del centro educativo.',
  nivelAjeno: 'Ese grupo no corresponde a tu nivel educativo.',
  sinPlazas: 'El grupo ya no tiene plazas disponibles.',
  mismoGrupo: 'Ya estás inscripto en este grupo.',
  mismoDeporte:
    'Ya estás inscripto en otro grupo de este deporte. Si querés cambiar de grupo, primero cancelá esa inscripción.',
  limiteDos:
    'Ya tenés dos deportes activos, que es el máximo permitido. Cancelá uno para inscribirte en otro.',
} as const

const COLUMNAS_INSCRIPCION =
  'id, alumno_id, alumno_nombre, alumno_apellido, legajo_nro, grupo_id, grupo_nombre, ' +
  'deporte_id, deporte_nombre, nivel_id, nivel_nombre, estado, fecha_inscripcion, ' +
  'fecha_cancelacion'

/**
 * Traduce errores de PostgreSQL en resultados estables, sin devolver al
 * navegador detalles internos, nombres de restricciones, consultas ni SQLSTATE.
 */
function traducirErrorDeportes(
  error: ErrorPostgres,
  operacion: Operacion
): { estado: EstadoErrorDeportes; mensaje: string; campo?: CampoDeportes } {
  switch (error.code) {
    case '23505':
      // El índice único es la autoridad ante concurrencia. En el alta de grupos
      // protege la identidad del grupo; en la inscripción, «un grupo por deporte».
      return operacion === 'crearGrupo'
        ? {
            estado: 409,
            mensaje: 'Ya existe un grupo con ese nombre para ese deporte y nivel.',
            campo: 'nombre',
          }
        : { estado: 409, mensaje: MENSAJES_DEPORTES.mismoDeporte, campo: 'grupo_id' }
    case 'P5560':
      return { estado: 404, mensaje: 'El deporte seleccionado no existe.', campo: 'deporte_id' }
    case 'P5561':
      return {
        estado: 409,
        mensaje: 'El deporte está inactivo y no admite grupos ni inscripciones nuevas.',
        campo: operacion === 'crearGrupo' ? 'deporte_id' : 'grupo_id',
      }
    case 'P5562':
      return { estado: 404, mensaje: 'El nivel educativo seleccionado no existe.', campo: 'nivel_id' }
    case 'P5563':
      return {
        estado: 409,
        mensaje: 'El nivel educativo está inactivo y no admite grupos nuevos.',
        campo: 'nivel_id',
      }
    case 'P5564':
      return { estado: 404, mensaje: 'El profesor seleccionado no existe.', campo: 'profesor_id' }
    case 'P5565':
      return {
        estado: 409,
        mensaje: 'La persona seleccionada no tiene el rol DOCENTE.',
        campo: 'profesor_id',
      }
    case 'P5566':
      return { estado: 400, mensaje: 'El cupo debe ser un número entero entre 1 y 100.', campo: 'cupo' }
    case 'P5567':
      return {
        estado: 400,
        mensaje: 'El nombre del grupo debe tener entre 1 y 100 caracteres.',
        campo: 'nombre',
      }
    case 'P5568':
      return {
        estado: 404,
        mensaje: 'El grupo deportivo no existe o ya no está disponible.',
        campo: 'grupo_id',
      }
    case 'P5569':
      return { estado: 409, mensaje: 'El grupo ya no recibe inscripciones.', campo: 'grupo_id' }
    case 'P5570':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.sinLegajo }
    case 'P5571':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.legajoInactivo }
    case 'P5572':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.sinCurso }
    case 'P5573':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.nivelAjeno, campo: 'grupo_id' }
    case 'P5574':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.sinPlazas, campo: 'grupo_id' }
    case 'P5575':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.mismoGrupo, campo: 'grupo_id' }
    case 'P5576':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.mismoDeporte, campo: 'grupo_id' }
    case 'P5577':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.limiteDos, campo: 'grupo_id' }
    case 'P5578':
      // Una inscripción ajena y una inexistente responden exactamente igual.
      return {
        estado: 404,
        mensaje: 'No encontramos una inscripción deportiva activa tuya para cancelar.',
      }
    case 'P5579':
      return { estado: 409, mensaje: 'Esa inscripción ya estaba cancelada.' }
    case 'P5580':
    case 'P5581':
      return {
        estado: 409,
        mensaje: 'Esa operación no está permitida sobre un grupo o una inscripción existente.',
      }
    case '23503':
    case '23514':
    case '22P02':
      return { estado: 400, mensaje: 'Los datos enviados no son válidos.' }
    case 'P5505':
      return { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
    case '42501':
      return {
        estado: 403,
        mensaje:
          operacion === 'crearGrupo'
            ? 'Solo la dirección puede crear grupos deportivos.'
            : operacion === 'listarGrupos'
              ? 'No tenés permisos para consultar los grupos deportivos.'
              : 'Solo un estudiante puede inscribirse o cancelar su inscripción a un deporte.',
      }
    default:
      console.error('[deportes] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return { estado: 500, mensaje: MENSAJE_GENERICO }
  }
}

/** Una escritura sin fila devuelta no es un éxito confirmado. */
function exigirFila<T>(datos: T | null | undefined, mensaje: string): ResultadoDeportes<T> {
  if (!datos) return { ok: false, estado: 500, mensaje }
  return { ok: true, datos }
}

// ----------------------------------------------------------------
// Lecturas
// ----------------------------------------------------------------

/**
 * Grupos con su disponibilidad. No recibe ni filtra por nivel ni por alumno:
 * PostgreSQL decide el alcance a partir de la sesión.
 */
export async function listarGruposDeportivos(): Promise<ResultadoDeportes<GrupoDeportivo[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('listar_grupos_deportivos')

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'listarGrupos') }
  return { ok: true, datos: (data ?? []) as GrupoDeportivo[] }
}

/**
 * Inscripciones visibles para la sesión, incluidas las canceladas. RLS decide:
 * el estudiante obtiene su historial y el director el listado completo.
 */
export async function listarInscripcionesDeportivas(): Promise<
  ResultadoDeportes<InscripcionDeportiva[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('inscripciones_deportivas_detalle')
    .select(COLUMNAS_INSCRIPCION)
    .order('fecha_inscripcion', { ascending: false })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'listarInscripciones') }
  return { ok: true, datos: (data ?? []) as unknown as InscripcionDeportiva[] }
}

/**
 * Opciones del alta mínima de grupos: deportes activos, niveles activos y
 * perfiles con rol real DOCENTE. Solo se piden nombre y apellido del profesor.
 * Es informativo: la base vuelve a validar cada elección con la fila bloqueada.
 */
export async function listarCatalogoAltaGrupo(): Promise<ResultadoDeportes<CatalogoAltaGrupo>> {
  const supabase = await createServerSupabaseClient()
  const [deportes, niveles, profesores] = await Promise.all([
    supabase.from('deportes').select('id, nombre').eq('activo', true).order('nombre'),
    supabase
      .from('niveles')
      .select('id, nombre')
      .eq('activo', true)
      .order('orden', { ascending: true, nullsFirst: false }),
    supabase
      .from('perfiles')
      .select('id, nombre, apellido, roles!inner(nombre)')
      .eq('roles.nombre', 'DOCENTE')
      .order('apellido', { ascending: true })
      .order('nombre', { ascending: true }),
  ])

  const fallo = deportes.error ?? niveles.error ?? profesores.error
  if (fallo) return { ok: false, ...traducirErrorDeportes(fallo, 'listarCatalogo') }

  const filasProfesores = (profesores.data ?? []) as unknown as ProfesorDeportivo[]

  return {
    ok: true,
    datos: {
      deportes: (deportes.data ?? []) as OpcionCatalogo[],
      niveles: (niveles.data ?? []) as OpcionNivel[],
      profesores: filasProfesores.map(({ id, nombre, apellido }) => ({ id, nombre, apellido })),
    },
  }
}

/**
 * Situación académica del alumno de la sesión. `alumnos_academicos` es
 * security_invoker y RLS devuelve solo la fila propia; un actor sin legajo
 * obtiene `null`. Sirve para EXPLICAR un impedimento, nunca para autorizar.
 */
export async function obtenerSituacionAcademicaPropia(): Promise<
  ResultadoDeportes<SituacionAcademicaPropia | null>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alumnos_academicos')
    .select('estado, legajo_nro, nivel_nombre')
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'obtenerSituacion') }
  return { ok: true, datos: (data ?? null) as SituacionAcademicaPropia | null }
}

// ----------------------------------------------------------------
// Escrituras
// ----------------------------------------------------------------

/** Alta del alumno de la sesión. El único parámetro es el grupo. */
export async function inscribirEnGrupoDeportivo(
  grupoId: string
): Promise<ResultadoDeportes<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('inscribir_en_grupo_deportivo', {
    p_grupo_id: grupoId,
  })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'inscribir') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar tu inscripción. Revisá tus deportes antes de reintentar.'
  )
}

/** Baja lógica de una inscripción propia. No elimina ninguna fila. */
export async function cancelarInscripcionDeportiva(
  inscripcionId: string
): Promise<ResultadoDeportes<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cancelar_inscripcion_deportiva', {
    p_inscripcion_id: inscripcionId,
  })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'cancelar') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar la baja. Revisá tus deportes antes de reintentar.'
  )
}

/** Alta mínima de un grupo por la dirección. */
export async function crearGrupoDeportivo(
  datos: CrearGrupoDeportivoData
): Promise<ResultadoDeportes<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('crear_grupo_deportivo', {
    p_deporte_id: datos.deporte_id,
    p_nivel_id: datos.nivel_id,
    p_nombre: datos.nombre,
    p_cupo: datos.cupo,
    p_profesor_id: datos.profesor_id,
  })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'crearGrupo') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar el alta del grupo. Revisá el listado antes de reintentar.'
  )
}
