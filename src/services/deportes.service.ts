import { z } from 'zod'
import { createServerSupabaseClient } from '@/services/supabase.server'
import {
  describirFranja,
  esHoraValida,
  MENSAJE_SIN_HORARIO,
  mensajeConflicto,
  normalizarHora,
  ordenarFranjas,
  type ConflictoHorario,
  type Franja,
} from '@/lib/horarios'
import type {
  AgregarHorarioGrupoData,
  CrearGrupoDeportivoData,
  InscripcionAdministrativaData,
} from '@/lib/validations'

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
 * Ninguna función del alumno acepta un alumno, un nivel, un cupo ni un estado
 * como parámetro, y no existe ninguna operación de borrado.
 *
 * EPT-12 agrega los horarios: las franjas se leen de
 * `grupos_deportivos_horarios` (RLS: las ve quien ve el grupo), la
 * compatibilidad se consulta con la MISMA función de la base que decide el
 * alta, y la dirección configura franjas e inscribe a un alumno por RPC que
 * pasan por las mismas reglas que el alta propia.
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

/** Franja activa de un grupo, con el horario del catálogo resuelto. */
export type FranjaHoraria = Franja & { id: string; grupo_id: string }

/** Franjas activas indexadas por grupo, ordenadas por día y hora. */
export type HorariosPorGrupo = Record<string, FranjaHoraria[]>

/** Resultado de la consulta de compatibilidad de un alumno con un grupo. */
export type CompatibilidadGrupo = {
  grupo_id: string
  tiene_horario: boolean
  /** Primer conflicto con otra actividad ACTIVA del alumno, si lo hay. */
  conflicto: ConflictoHorario | null
}

export type CompatibilidadPorGrupo = Record<string, CompatibilidadGrupo>

/** Alumno que la dirección puede elegir para un alta administrativa. */
export type AlumnoInscribible = {
  id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
  nivel_id: number
  nivel_nombre: string
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
  | 'alumno_id'
  | 'dia_semana'
  | 'hora_inicio'
  | 'hora_fin'

export type EstadoErrorDeportes = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503

type RechazoDeportes = {
  estado: EstadoErrorDeportes
  mensaje: string
  campo?: CampoDeportes
  /** Presente solo ante un conflicto horario (P5584). */
  conflicto?: ConflictoHorario
}

export type ResultadoDeportes<T> = { ok: true; datos: T } | ({ ok: false } & RechazoDeportes)

type Operacion =
  | 'listarGrupos'
  | 'listarInscripciones'
  | 'listarCatalogo'
  | 'obtenerSituacion'
  | 'inscribir'
  | 'cancelar'
  | 'crearGrupo'
  | 'listarHorarios'
  | 'consultarCompatibilidad'
  | 'listarAlumnos'
  | 'agregarHorario'
  | 'darDeBajaHorario'
  | 'inscribirAdministrativa'
  | 'consultarCompatibilidadAlumno'

type ErrorPostgres = { code?: string | null; message?: string | null; details?: string | null }

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
  sinHorario: MENSAJE_SIN_HORARIO,
} as const

/**
 * Los mismos rechazos de 014 dichos a la dirección, que inscribe a OTRA
 * persona: mismo código y mismo estado HTTP, en tercera persona.
 */
const MENSAJES_ADMINISTRATIVOS: Partial<Record<string, RechazoDeportes>> = {
  '23505': {
    estado: 409,
    mensaje: 'El alumno ya está inscripto en otro grupo de este deporte.',
    campo: 'grupo_id',
  },
  P5570: {
    estado: 404,
    mensaje: 'La persona seleccionada no tiene legajo académico de alumno.',
    campo: 'alumno_id',
  },
  P5571: {
    estado: 409,
    mensaje: 'El alumno no está activo, así que no puede inscribirse a deportes.',
    campo: 'alumno_id',
  },
  P5572: {
    estado: 409,
    mensaje: 'El alumno no tiene un curso vigente, así que no podemos determinar su nivel educativo.',
    campo: 'alumno_id',
  },
  P5573: {
    estado: 409,
    mensaje: 'Ese grupo no corresponde al nivel educativo del alumno.',
    campo: 'grupo_id',
  },
  P5575: { estado: 409, mensaje: 'El alumno ya está inscripto en este grupo.', campo: 'grupo_id' },
  P5576: {
    estado: 409,
    mensaje: 'El alumno ya está inscripto en otro grupo de este deporte.',
    campo: 'grupo_id',
  },
  P5577: {
    estado: 409,
    mensaje: 'El alumno ya tiene dos deportes activos, que es el máximo permitido.',
    campo: 'grupo_id',
  },
}

/**
 * Detalle estructurado que PostgreSQL adjunta a P5584, P5588 y P5589. Se valida
 * antes de usarlo: si no tiene la forma esperada, se responde con un mensaje
 * genérico en lugar de reenviar texto de la base.
 */
const horaDetalleSchema = z.string().refine(esHoraValida)
const detalleFranjaSchema = z.object({
  dia_semana: z.number().int().min(1).max(7),
  hora_inicio: horaDetalleSchema,
  hora_fin: horaDetalleSchema,
})
const detalleConflictoSchema = detalleFranjaSchema.extend({
  deporte: z.string().min(1),
  grupo: z.string().min(1),
})
const detalleAfectadosSchema = detalleConflictoSchema.extend({
  alumnos_afectados: z.number().int().positive(),
})
const detalleConflictoAcademicoSchema = detalleFranjaSchema.extend({
  actividad: z.string().min(1),
})

function leerDetalle<T>(esquema: z.ZodType<T>, detalle: string | null | undefined): T | null {
  if (!detalle) return null
  try {
    const resultado = esquema.safeParse(JSON.parse(detalle))
    return resultado.success ? resultado.data : null
  } catch {
    return null
  }
}

const COLUMNAS_INSCRIPCION =
  'id, alumno_id, alumno_nombre, alumno_apellido, legajo_nro, grupo_id, grupo_nombre, ' +
  'deporte_id, deporte_nombre, nivel_id, nivel_nombre, estado, fecha_inscripcion, ' +
  'fecha_cancelacion'

/**
 * Traduce errores de PostgreSQL en resultados estables, sin devolver al
 * navegador detalles internos, nombres de restricciones, consultas ni SQLSTATE.
 */
function traducirErrorDeportes(error: ErrorPostgres, operacion: Operacion): RechazoDeportes {
  // El alta y la consulta de la dirección hablan de OTRO alumno.
  const administrativo =
    (operacion === 'inscribirAdministrativa' || operacion === 'consultarCompatibilidadAlumno') &&
    error.code
      ? MENSAJES_ADMINISTRATIVOS[error.code]
      : undefined
  if (administrativo) return administrativo

  switch (error.code) {
    case '23505':
      // El índice único es la autoridad ante concurrencia. En el alta de grupos
      // protege la identidad del grupo; en las franjas, «una franja activa por
      // grupo»; en la inscripción, «un grupo por deporte».
      if (operacion === 'crearGrupo') {
        return {
          estado: 409,
          mensaje: 'Ya existe un grupo con ese nombre para ese deporte y nivel.',
          campo: 'nombre',
        }
      }
      if (operacion === 'agregarHorario') {
        return { estado: 409, mensaje: 'Esa franja ya está asignada a este grupo.', campo: 'hora_inicio' }
      }
      return { estado: 409, mensaje: MENSAJES_DEPORTES.mismoDeporte, campo: 'grupo_id' }
    case '40P01':
    case '55P03':
    case '57014':
      // Interbloqueo, espera de bloqueo o tiempo agotado: la operación no se
      // aplicó y reintentarla es seguro.
      return {
        estado: 503,
        mensaje: 'Hay otra operación en curso sobre estos datos. Volvé a intentarlo en unos segundos.',
      }
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
    case 'P5583':
      return { estado: 409, mensaje: MENSAJES_DEPORTES.sinHorario, campo: 'grupo_id' }
    case 'P5584': {
      const conflicto = leerDetalle(detalleConflictoSchema, error.details)
      return conflicto
        ? { estado: 409, mensaje: mensajeConflicto(conflicto), campo: 'grupo_id', conflicto }
        : {
            estado: 409,
            mensaje: 'El horario de este grupo se superpone con otra actividad deportiva activa.',
            campo: 'grupo_id',
          }
    }
    case 'P5585':
      return { estado: 422, mensaje: 'El día debe estar entre lunes y domingo.', campo: 'dia_semana' }
    case 'P5586':
      return {
        estado: 422,
        mensaje:
          'Revisá el rango: las horas van de 00:00 a 23:59 y la de inicio debe ser anterior a la de fin.',
        campo: 'hora_fin',
      }
    case 'P5587':
      return { estado: 409, mensaje: 'Esa franja ya está asignada a este grupo.', campo: 'hora_inicio' }
    case 'P5588': {
      const otra = leerDetalle(detalleFranjaSchema, error.details)
      return {
        estado: 409,
        mensaje: otra
          ? `La franja se superpone con otra franja del grupo: ${describirFranja(otra)}.`
          : 'La franja se superpone con otra franja del grupo.',
        campo: 'hora_inicio',
      }
    }
    case 'P5589': {
      const choque = leerDetalle(detalleAfectadosSchema, error.details)
      if (!choque) {
        return {
          estado: 409,
          mensaje: 'La franja se superpone con otra actividad de alumnos ya inscriptos en este grupo.',
          campo: 'hora_inicio',
        }
      }
      const participan =
        choque.alumnos_afectados === 1
          ? 'participa 1 alumno'
          : `participan ${choque.alumnos_afectados} alumnos`
      return {
        estado: 409,
        mensaje: `La franja se superpone con ${choque.deporte} (${choque.grupo}): ${describirFranja(choque)}, donde ${participan} de este grupo.`,
        campo: 'hora_inicio',
      }
    }
    case 'P5590':
      return { estado: 404, mensaje: 'Esa franja no existe en este grupo.' }
    case 'P5591':
      return { estado: 409, mensaje: 'Esa franja ya estaba dada de baja.' }
    case 'P5592':
      return { estado: 409, mensaje: 'Esa operación no está permitida sobre una franja existente.' }
    case 'P5595': {
      const choque = leerDetalle(detalleConflictoAcademicoSchema, error.details)
      return {
        estado: 409,
        mensaje: choque
          ? `El horario se superpone con ${choque.actividad}: ${describirFranja(choque)}.`
          : 'El horario se superpone con una materia del curso.',
        campo: 'grupo_id',
      }
    }
    case '23503':
    case '23514':
    case '22P02':
      return { estado: 400, mensaje: 'Los datos enviados no son válidos.' }
    case 'P5505':
      return { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
    case '42501':
      return { estado: 403, mensaje: MENSAJES_PROHIBIDO[operacion] }
    default:
      console.error('[deportes] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return { estado: 500, mensaje: MENSAJE_GENERICO }
  }
}

/** Mensaje ante 42501 según la operación. Los de EPT-11 se conservan tal cual. */
const MENSAJES_PROHIBIDO: Record<Operacion, string> = {
  listarGrupos: 'No tenés permisos para consultar los grupos deportivos.',
  listarInscripciones:
    'Solo un estudiante puede inscribirse o cancelar su inscripción a un deporte.',
  listarCatalogo: 'Solo un estudiante puede inscribirse o cancelar su inscripción a un deporte.',
  obtenerSituacion:
    'Solo un estudiante puede inscribirse o cancelar su inscripción a un deporte.',
  inscribir: 'Solo un estudiante puede inscribirse o cancelar su inscripción a un deporte.',
  cancelar: 'Solo un estudiante puede inscribirse o cancelar su inscripción a un deporte.',
  crearGrupo: 'Solo la dirección puede crear grupos deportivos.',
  listarHorarios: 'No tenés permisos para consultar los horarios deportivos.',
  consultarCompatibilidad: 'No tenés permisos para consultar la compatibilidad horaria.',
  listarAlumnos: 'No tenés permisos para consultar el listado de alumnos.',
  agregarHorario: 'Solo la dirección puede configurar los horarios de los grupos deportivos.',
  darDeBajaHorario: 'Solo la dirección puede configurar los horarios de los grupos deportivos.',
  inscribirAdministrativa: 'Solo la dirección puede inscribir a un alumno en un deporte.',
  consultarCompatibilidadAlumno:
    'Solo la dirección puede consultar la compatibilidad horaria de un alumno.',
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

// ----------------------------------------------------------------
// Horarios (EPT-12)
// ----------------------------------------------------------------

type FilaFranja = {
  id: string
  grupo_id: string
  horarios: { dia_semana: number; hora_inicio: string; hora_fin: string } | null
}

/**
 * Franjas ACTIVAS de todos los grupos que la sesión puede ver. No filtra por
 * grupo ni por rol: la política de `grupos_deportivos_horarios` devuelve las
 * franjas de los grupos que RLS ya le muestra (todas a la dirección; las de su
 * nivel y las de sus grupos al estudiante; ninguna al resto).
 */
export async function listarHorariosGrupos(): Promise<ResultadoDeportes<HorariosPorGrupo>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('grupos_deportivos_horarios')
    .select('id, grupo_id, horarios(dia_semana, hora_inicio, hora_fin)')
    .eq('activo', true)

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'listarHorarios') }

  const porGrupo: HorariosPorGrupo = {}
  for (const fila of (data ?? []) as unknown as FilaFranja[]) {
    if (!fila.horarios) continue
    const franjas = porGrupo[fila.grupo_id] ?? []
    franjas.push({
      id: fila.id,
      grupo_id: fila.grupo_id,
      dia_semana: fila.horarios.dia_semana,
      hora_inicio: fila.horarios.hora_inicio,
      hora_fin: fila.horarios.hora_fin,
    })
    porGrupo[fila.grupo_id] = franjas
  }
  for (const grupoId of Object.keys(porGrupo)) {
    porGrupo[grupoId] = ordenarFranjas(porGrupo[grupoId])
  }
  return { ok: true, datos: porGrupo }
}

type FilaCompatibilidad = {
  grupo_id: string
  tiene_horario: boolean
  conflicto_deporte: string | null
  conflicto_grupo: string | null
  conflicto_dia_semana: number | null
  conflicto_hora_inicio: string | null
  conflicto_hora_fin: string | null
}

function indexarCompatibilidad(filas: FilaCompatibilidad[]): CompatibilidadPorGrupo {
  const porGrupo: CompatibilidadPorGrupo = {}
  for (const fila of filas) {
    const conflicto: ConflictoHorario | null =
      fila.conflicto_deporte &&
      fila.conflicto_grupo &&
      fila.conflicto_dia_semana !== null &&
      fila.conflicto_hora_inicio &&
      fila.conflicto_hora_fin
        ? {
            deporte: fila.conflicto_deporte,
            grupo: fila.conflicto_grupo,
            dia_semana: fila.conflicto_dia_semana,
            hora_inicio: fila.conflicto_hora_inicio,
            hora_fin: fila.conflicto_hora_fin,
          }
        : null
    porGrupo[fila.grupo_id] = {
      grupo_id: fila.grupo_id,
      tiene_horario: fila.tiene_horario,
      conflicto,
    }
  }
  return porGrupo
}

/**
 * Compatibilidad horaria del alumno de la sesión con cada grupo de su nivel.
 * La base usa la misma función que decide el alta, así que lo que se anticipa
 * es lo que el alta decidiría con el estado de este momento.
 */
export async function consultarCompatibilidadPropia(): Promise<
  ResultadoDeportes<CompatibilidadPorGrupo>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('consultar_compatibilidad_horaria')

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'consultarCompatibilidad') }
  return { ok: true, datos: indexarCompatibilidad((data ?? []) as FilaCompatibilidad[]) }
}

/** Compatibilidad de un alumno elegido por la dirección. La base exige DIRECTOR. */
export async function consultarCompatibilidadAlumno(
  alumnoId: string
): Promise<ResultadoDeportes<CompatibilidadPorGrupo>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('consultar_compatibilidad_horaria_alumno', {
    p_alumno_id: alumnoId,
  })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'consultarCompatibilidadAlumno') }
  return { ok: true, datos: indexarCompatibilidad((data ?? []) as FilaCompatibilidad[]) }
}

/**
 * Alumnos ACTIVOS con un curso vigente, para el alta administrativa. Solo se
 * piden los datos necesarios para identificarlos; la RLS de
 * `alumnos_academicos` decide quién puede leerlos.
 */
export async function listarAlumnosInscribibles(): Promise<
  ResultadoDeportes<AlumnoInscribible[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alumnos_academicos')
    .select('id, nombre, apellido, legajo_nro, nivel_id, nivel_nombre')
    .eq('estado', 'ACTIVO')
    .not('nivel_id', 'is', null)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'listarAlumnos') }
  return { ok: true, datos: (data ?? []) as AlumnoInscribible[] }
}

/** Asigna una franja a un grupo. La base valida superposiciones y conflictos. */
export async function agregarHorarioGrupo(
  grupoId: string,
  datos: AgregarHorarioGrupoData
): Promise<ResultadoDeportes<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('agregar_horario_grupo_deportivo', {
    p_grupo_id: grupoId,
    p_dia_semana: datos.dia_semana,
    p_hora_inicio: normalizarHora(datos.hora_inicio),
    p_hora_fin: normalizarHora(datos.hora_fin),
  })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'agregarHorario') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar la franja. Revisá los horarios del grupo antes de reintentar.'
  )
}

/** Baja lógica de una franja. No elimina ninguna fila. */
export async function darDeBajaHorarioGrupo(
  grupoId: string,
  franjaId: string
): Promise<ResultadoDeportes<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('dar_de_baja_horario_grupo_deportivo', {
    p_grupo_id: grupoId,
    p_franja_id: franjaId,
  })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'darDeBajaHorario') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar la baja de la franja. Revisá los horarios del grupo antes de reintentar.'
  )
}

/**
 * Alta administrativa. La dirección elige alumno y grupo; la base aplica
 * exactamente las reglas del alta propia, incluida la compatibilidad horaria.
 */
export async function inscribirAlumnoAdministrativamente(
  datos: InscripcionAdministrativaData
): Promise<ResultadoDeportes<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('inscribir_alumno_en_grupo_deportivo', {
    p_alumno_id: datos.alumno_id,
    p_grupo_id: datos.grupo_id,
  })

  if (error) return { ok: false, ...traducirErrorDeportes(error, 'inscribirAdministrativa') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar la inscripción. Revisá las inscripciones del alumno antes de reintentar.'
  )
}
