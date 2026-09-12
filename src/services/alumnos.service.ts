import type { CrearAlumnoData, EstadoAlumno } from '@/lib/validations'
import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Acceso al legajo académico ligado a la sesión real de Supabase (EPT-21).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Nunca usa `service_role`. Las lecturas atraviesan las vistas
 * `alumnos_academicos` y `matriculas_historial`, que son `security_invoker` y
 * por lo tanto respetan RLS; las escrituras atraviesan los envoltorios públicos
 * que revalidan `auth.uid()` y el rol DIRECTOR dentro de PostgreSQL.
 *
 * No existe ninguna operación de borrado.
 */

/** Situación académica vigente. El nivel llega derivado del curso, no persistido. */
export type AlumnoAcademico = {
  id: string
  nombre: string
  apellido: string
  dni: string
  legajo_nro: string | null
  fecha_nacimiento: string | null
  telefono: string | null
  direccion: string | null
  estado: EstadoAlumno
  fecha_actualizacion: string
  tiene_cuenta: boolean
  matricula_id: string | null
  matricula_desde: string | null
  curso_id: string | null
  curso_denominacion: string | null
  curso_division: string | null
  curso_activo: boolean | null
  nivel_id: number | null
  nivel_nombre: string | null
}

/** Un tramo del historial. Conserva el curso aunque hoy esté inactivo. */
export type MatriculaHistorica = {
  id: string
  alumno_id: string
  fecha_inicio: string
  fecha_cierre: string | null
  motivo_cierre: 'CAMBIO_DE_CURSO' | 'INACTIVACION' | null
  curso_id: string
  curso_denominacion: string
  curso_division: string
  curso_activo: boolean
  nivel_id: number
  nivel_nombre: string
}

/** Opción válida para una asignación nueva: solo cursos activos. */
export type CursoAsignable = {
  id: string
  denominacion: string
  division: string
  nivel_id: number
  nivel_nombre: string
}

export type CampoAlumno =
  | 'nombre'
  | 'apellido'
  | 'dni'
  | 'legajo_nro'
  | 'curso_id'
  | 'estado'

export type EstadoErrorAlumno = 400 | 401 | 403 | 404 | 409 | 500

export type ResultadoAlumno<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: EstadoErrorAlumno; mensaje: string; campo?: CampoAlumno }

/** SQLSTATE que este dominio traduce de forma estable. */
const SQLSTATE_DUPLICADO = '23505'
const SQLSTATE_CLAVE_FORANEA = '23503'
const SQLSTATE_CHECK = '23514'
const SQLSTATE_ENTRADA_INVALIDA = '22P02'
const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_DATO_INVALIDO = 'P5501'
const SQLSTATE_INEXISTENTE = 'P5503'
const SQLSTATE_CURSO_INACTIVO = 'P5504'
const SQLSTATE_IDENTIDAD_AUSENTE = 'P5505'
const SQLSTATE_DNI_INVALIDO = 'P5510'
const SQLSTATE_SIN_MATRICULA = 'P5511'
const SQLSTATE_SIN_LEGAJO = 'P5512'
const SQLSTATE_MATRICULA_INDEBIDA = 'P5513'
const SQLSTATE_LEGAJO_INVALIDO = 'P5515'
const SQLSTATE_ESTADO_INVALIDO = 'P5516'

const COLUMNAS_ALUMNO =
  'id, nombre, apellido, dni, legajo_nro, fecha_nacimiento, telefono, direccion, ' +
  'estado, fecha_actualizacion, tiene_cuenta, matricula_id, matricula_desde, ' +
  'curso_id, curso_denominacion, curso_division, curso_activo, nivel_id, nivel_nombre'

const COLUMNAS_HISTORIAL =
  'id, alumno_id, fecha_inicio, fecha_cierre, motivo_cierre, curso_id, ' +
  'curso_denominacion, curso_division, curso_activo, nivel_id, nivel_nombre'

const MENSAJE_GENERICO =
  'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

type ErrorPostgres = { code?: string | null; message?: string | null; details?: string | null }

/**
 * Distingue qué restricción única se violó para dar el mensaje correcto.
 *
 * El nombre de la restricción se lee del error de PostgreSQL pero nunca se
 * devuelve al cliente: solo elige cuál de los mensajes de dominio corresponde.
 */
function traducirDuplicado(error: ErrorPostgres): {
  estado: EstadoErrorAlumno
  mensaje: string
  campo?: CampoAlumno
} {
  const detalle = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()

  if (detalle.includes('dni')) {
    return {
      estado: 409,
      mensaje: 'Ya existe una persona registrada con ese DNI.',
      campo: 'dni',
    }
  }
  if (detalle.includes('legajo')) {
    return {
      estado: 409,
      mensaje: 'Ya existe un legajo con ese número.',
      campo: 'legajo_nro',
    }
  }
  if (detalle.includes('matricula')) {
    return {
      estado: 409,
      mensaje:
        'El estudiante ya tiene una matrícula vigente. Actualizá el listado antes de reintentar.',
      campo: 'curso_id',
    }
  }
  return {
    estado: 409,
    mensaje: 'El dato ingresado ya está registrado para otra persona.',
  }
}

/**
 * Convierte errores de PostgreSQL en resultados estables sin devolver detalles
 * internos, nombres de restricciones, consultas ni SQLSTATE al cliente.
 */
function traducirErrorAlumno(
  error: ErrorPostgres,
  operacion: string
): { estado: EstadoErrorAlumno; mensaje: string; campo?: CampoAlumno } {
  switch (error.code) {
    case SQLSTATE_DUPLICADO:
      return traducirDuplicado(error)

    case SQLSTATE_CLAVE_FORANEA:
      return {
        estado: 400,
        mensaje: 'El curso elegido no existe.',
        campo: 'curso_id',
      }

    case SQLSTATE_CURSO_INACTIVO:
      return {
        estado: 409,
        mensaje: 'El curso elegido está inactivo. Elegí un curso activo.',
        campo: 'curso_id',
      }

    case SQLSTATE_DNI_INVALIDO:
      return {
        estado: 400,
        mensaje: 'El DNI debe tener exactamente 7 u 8 dígitos, sin puntos ni letras.',
        campo: 'dni',
      }

    case SQLSTATE_LEGAJO_INVALIDO:
      return {
        estado: 400,
        mensaje:
          'El número de legajo debe tener entre 1 y 50 caracteres, sin espacios al inicio o al final.',
        campo: 'legajo_nro',
      }

    case SQLSTATE_SIN_MATRICULA:
      return {
        estado: 409,
        mensaje: 'Un estudiante activo debe tener exactamente una matrícula vigente.',
        campo: 'curso_id',
      }

    case SQLSTATE_SIN_LEGAJO:
      return {
        estado: 409,
        mensaje: 'Un estudiante activo debe tener un número de legajo.',
        campo: 'legajo_nro',
      }

    case SQLSTATE_MATRICULA_INDEBIDA:
      return {
        estado: 409,
        mensaje: 'Un estudiante inactivo no puede conservar una matrícula vigente.',
        campo: 'curso_id',
      }

    case SQLSTATE_ESTADO_INVALIDO:
    case SQLSTATE_ENTRADA_INVALIDA:
      return {
        estado: 409,
        mensaje: 'El cambio solicitado no corresponde a la situación actual del estudiante.',
        campo: 'estado',
      }

    case SQLSTATE_DATO_INVALIDO:
    case SQLSTATE_CHECK:
      return {
        estado: 400,
        mensaje: 'Los datos personales cargados no son válidos.',
        campo: 'nombre',
      }

    case SQLSTATE_INEXISTENTE:
      return {
        estado: 404,
        mensaje: 'El legajo académico solicitado no existe.',
      }

    case SQLSTATE_IDENTIDAD_AUSENTE:
      return {
        estado: 401,
        mensaje: 'Necesitás iniciar sesión para continuar.',
      }

    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      return {
        estado: 403,
        mensaje: 'Solo el director puede administrar los legajos académicos.',
      }

    default:
      console.error('[alumnos] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return { estado: 500, mensaje: MENSAJE_GENERICO }
  }
}

// ================================================================
// Lecturas
// ================================================================

/**
 * Lista los legajos académicos que la sesión puede ver.
 *
 * Para el DIRECTOR son todos; para un ESTUDIANTE, únicamente el propio. El
 * filtrado lo hace RLS, no esta consulta: un estudiante ajeno no produce error,
 * simplemente no aparece.
 */
export async function listarAlumnos(): Promise<ResultadoAlumno<AlumnoAcademico[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alumnos_academicos')
    .select(COLUMNAS_ALUMNO)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    return { ok: false, ...traducirErrorAlumno(error, 'listarAlumnos') }
  }

  // Una lista vacía es un estado válido, nunca un error disfrazado.
  return { ok: true, datos: (data ?? []) as unknown as AlumnoAcademico[] }
}

/**
 * Obtiene un legajo académico.
 *
 * Devuelve 404 tanto si el legajo no existe como si RLS lo ocultó: el mensaje es
 * el mismo en los dos casos para no revelar la existencia de un estudiante ajeno.
 */
export async function obtenerAlumno(
  id: string
): Promise<ResultadoAlumno<AlumnoAcademico>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alumnos_academicos')
    .select(COLUMNAS_ALUMNO)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return { ok: false, ...traducirErrorAlumno(error, 'obtenerAlumno') }
  }
  if (!data) {
    return {
      ok: false,
      estado: 404,
      mensaje: 'El legajo académico solicitado no existe.',
    }
  }

  return { ok: true, datos: data as unknown as AlumnoAcademico }
}

/** Historial completo de cursos, del más reciente al más antiguo. */
export async function listarHistorialAlumno(
  id: string
): Promise<ResultadoAlumno<MatriculaHistorica[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('matriculas_historial')
    .select(COLUMNAS_HISTORIAL)
    .eq('alumno_id', id)
    .order('fecha_inicio', { ascending: false })

  if (error) {
    return { ok: false, ...traducirErrorAlumno(error, 'listarHistorialAlumno') }
  }

  return { ok: true, datos: (data ?? []) as unknown as MatriculaHistorica[] }
}

/**
 * Cursos ofrecibles en una asignación nueva.
 *
 * Solo activos: el historial conserva los inactivos, pero no se pueden elegir.
 * La base vuelve a rechazarlos con P5504 aunque alguien fuerce el identificador.
 */
export async function listarCursosAsignables(): Promise<ResultadoAlumno<CursoAsignable[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('cursos')
    .select('id, denominacion, division, nivel_id, nivel:niveles(nombre)')
    .eq('activo', true)
    .order('denominacion', { ascending: true })
    .order('division', { ascending: true })

  if (error) {
    return { ok: false, ...traducirErrorAlumno(error, 'listarCursosAsignables') }
  }

  const cursos = (data ?? []).map((fila) => {
    const curso = fila as unknown as {
      id: string
      denominacion: string
      division: string
      nivel_id: number
      nivel: { nombre: string } | null
    }
    return {
      id: curso.id,
      denominacion: curso.denominacion,
      division: curso.division,
      nivel_id: curso.nivel_id,
      nivel_nombre: curso.nivel?.nombre ?? 'Sin nivel',
    }
  })

  return { ok: true, datos: cursos }
}

// ================================================================
// Escrituras atómicas
// ================================================================

/**
 * Cada operación es una única llamada RPC y, por lo tanto, una única
 * transacción: ante cualquier rechazo no persiste ninguna parte.
 *
 * La base devuelve el identificador del alumno. Confirmar el resultado exige que
 * ese identificador llegue: una respuesta sin dato no se informa como éxito.
 */
async function ejecutar(
  operacion: string,
  invocar: (
    supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  ) => PromiseLike<{ data: unknown; error: ErrorPostgres | null }>
): Promise<ResultadoAlumno<string>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await invocar(supabase)

  if (error) {
    return { ok: false, ...traducirErrorAlumno(error, operacion) }
  }
  if (typeof data !== 'string' || data.length === 0) {
    return {
      ok: false,
      estado: 500,
      mensaje:
        'No pudimos confirmar el cambio en el legajo. Verificá el listado antes de reintentar.',
    }
  }

  return { ok: true, datos: data }
}

export function crearAlumno(datos: CrearAlumnoData) {
  return ejecutar('crearAlumno', (supabase) =>
    supabase.rpc('crear_alumno', {
      p_nombre: datos.nombre,
      p_apellido: datos.apellido,
      p_dni: datos.dni,
      p_estado: datos.estado,
      p_legajo_nro: datos.legajo_nro ?? undefined,
      p_curso_id: datos.curso_id ?? undefined,
      p_fecha_nacimiento: datos.fecha_nacimiento ?? undefined,
      p_telefono: datos.telefono ?? undefined,
      p_direccion: datos.direccion ?? undefined,
    })
  )
}

export function corregirIdentidadAlumno(
  id: string,
  dni: string,
  legajoNro?: string
) {
  return ejecutar('corregirIdentidadAlumno', (supabase) =>
    supabase.rpc('corregir_identidad_alumno', {
      p_alumno_id: id,
      p_dni: dni,
      p_legajo_nro: legajoNro ?? undefined,
    })
  )
}

export function cambiarCursoAlumno(id: string, cursoId: string) {
  return ejecutar('cambiarCursoAlumno', (supabase) =>
    supabase.rpc('cambiar_curso_alumno', { p_alumno_id: id, p_curso_id: cursoId })
  )
}

export function inactivarAlumno(id: string) {
  return ejecutar('inactivarAlumno', (supabase) =>
    supabase.rpc('inactivar_alumno', { p_alumno_id: id })
  )
}

export function reactivarAlumno(id: string, cursoId: string) {
  return ejecutar('reactivarAlumno', (supabase) =>
    supabase.rpc('reactivar_alumno', { p_alumno_id: id, p_curso_id: cursoId })
  )
}
