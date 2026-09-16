import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Acceso a materias y a sus asignaciones, ligado a la sesión real de Supabase
 * (EPT-56).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Nunca usa `service_role`. Las lecturas atraviesan las vistas `materias` y
 * `materias_cursos_detalle`, que son `security_invoker` y por lo tanto respetan
 * RLS; las escrituras atraviesan los envoltorios públicos que revalidan
 * `auth.uid()` y el rol DIRECTOR dentro de PostgreSQL.
 *
 * No existe ninguna operación de borrado.
 */

/** Una materia del catálogo, con su estado lógico. */
export type Materia = {
  id: number
  nombre: string
  activo: boolean
}

/** Una asignación Curso–Materia con todo lo necesario para mostrarla. */
export type AsignacionMateria = {
  id: string
  materia_id: number
  materia_nombre: string
  materia_activa: boolean
  curso_id: string
  curso_denominacion: string
  curso_division: string
  curso_activo: boolean
  nivel_nombre: string
  profesor_id: string | null
  profesor_nombre: string | null
  profesor_apellido: string | null
  activo: boolean
}

/** Opción válida para una asignación nueva: solo cursos activos. */
export type CursoAsignableMateria = {
  id: string
  denominacion: string
  division: string
  nivel_nombre: string
}

/** Perfil con rol real DOCENTE. EPT-56 solo los selecciona, nunca los edita. */
export type ProfesorAsignable = {
  id: string
  nombre: string
  apellido: string
}

export type CampoMateria =
  | 'nombre'
  | 'activo'
  | 'materia_id'
  | 'curso_id'
  | 'profesor_id'

export type EstadoErrorMateria = 400 | 401 | 403 | 404 | 409 | 500

export type ResultadoMateria<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: EstadoErrorMateria; mensaje: string; campo?: CampoMateria }

/** SQLSTATE que este dominio traduce de forma estable. */
const SQLSTATE_DUPLICADO = '23505'
const SQLSTATE_CLAVE_FORANEA = '23503'
const SQLSTATE_CHECK = '23514'
const SQLSTATE_ENTRADA_INVALIDA = '22P02'
const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_IDENTIDAD_AUSENTE = 'P5505'
const SQLSTATE_NOMBRE_INVALIDO = 'P5530'
const SQLSTATE_MATERIA_INEXISTENTE = 'P5531'
const SQLSTATE_CURSO_INEXISTENTE = 'P5532'
const SQLSTATE_PROFESOR_INEXISTENTE = 'P5533'
const SQLSTATE_ASIGNACION_INEXISTENTE = 'P5534'
const SQLSTATE_PROFESOR_NO_DOCENTE = 'P5535'
const SQLSTATE_MATERIA_INACTIVA = 'P5536'
const SQLSTATE_CURSO_INACTIVO = 'P5537'
const SQLSTATE_ASIGNACION_INACTIVA = 'P5538'
const SQLSTATE_ESTADO_INVALIDO = 'P5539'
const SQLSTATE_IDENTIDAD_PROTEGIDA = 'P5540'

const MENSAJE_GENERICO =
  'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

const COLUMNAS_MATERIA = 'id, nombre, activo'

const COLUMNAS_ASIGNACION =
  'id, materia_id, materia_nombre, materia_activa, curso_id, curso_denominacion, ' +
  'curso_division, curso_activo, nivel_nombre, profesor_id, profesor_nombre, ' +
  'profesor_apellido, activo'

/**
 * Qué operación produjo el error. El SQLSTATE 23505 no distingue por sí solo
 * entre el nombre repetido de una materia y una combinación Curso–Materia ya
 * existente, y el mensaje de PostgreSQL no debe llegar al navegador.
 */
type Operacion =
  | 'listarMaterias'
  | 'listarAsignaciones'
  | 'listarCursosAsignables'
  | 'listarProfesores'
  | 'crearMateria'
  | 'renombrarMateria'
  | 'cambiarEstadoMateria'
  | 'asignarMateriaCurso'
  | 'cambiarProfesorAsignacion'
  | 'cambiarEstadoAsignacion'

const OPERACIONES_DE_CATALOGO = new Set<Operacion>([
  'crearMateria',
  'renombrarMateria',
])

type ErrorPostgres = { code?: string | null; message?: string | null }

/**
 * Traduce errores de PostgreSQL en resultados estables, sin devolver al
 * navegador detalles internos, nombres de restricciones, consultas ni SQLSTATE.
 */
function traducirErrorMateria(
  error: ErrorPostgres,
  operacion: Operacion
): { estado: EstadoErrorMateria; mensaje: string; campo?: CampoMateria } {
  switch (error.code) {
    case SQLSTATE_DUPLICADO:
      return OPERACIONES_DE_CATALOGO.has(operacion)
        ? {
            estado: 409,
            mensaje: 'Ya existe una materia con ese nombre.',
            campo: 'nombre',
          }
        : {
            estado: 409,
            mensaje: 'Esa materia ya está asignada a ese curso.',
            campo: 'curso_id',
          }
    case SQLSTATE_NOMBRE_INVALIDO:
    case SQLSTATE_CHECK:
      return {
        estado: 400,
        mensaje:
          'El nombre de la materia debe tener entre 1 y 100 caracteres y no puede quedar vacío.',
        campo: 'nombre',
      }
    case SQLSTATE_MATERIA_INEXISTENTE:
      return { estado: 404, mensaje: 'La materia solicitada no existe.', campo: 'materia_id' }
    case SQLSTATE_CURSO_INEXISTENTE:
    case SQLSTATE_CLAVE_FORANEA:
      return { estado: 404, mensaje: 'El curso seleccionado no existe.', campo: 'curso_id' }
    case SQLSTATE_PROFESOR_INEXISTENTE:
      return {
        estado: 404,
        mensaje: 'El profesor seleccionado no existe.',
        campo: 'profesor_id',
      }
    case SQLSTATE_ASIGNACION_INEXISTENTE:
      return { estado: 404, mensaje: 'La asignación solicitada no existe.' }
    case SQLSTATE_PROFESOR_NO_DOCENTE:
      return {
        estado: 409,
        mensaje: 'La persona seleccionada no tiene el rol DOCENTE.',
        campo: 'profesor_id',
      }
    case SQLSTATE_MATERIA_INACTIVA:
      return {
        estado: 409,
        mensaje: 'La materia está inactiva y no admite nuevas asignaciones.',
        campo: 'materia_id',
      }
    case SQLSTATE_CURSO_INACTIVO:
      return {
        estado: 409,
        mensaje: 'El curso está inactivo y no admite nuevas asignaciones.',
        campo: 'curso_id',
      }
    case SQLSTATE_ASIGNACION_INACTIVA:
      return {
        estado: 409,
        mensaje:
          'La asignación está inactiva. Reactivala antes de cambiar el profesor responsable.',
      }
    case SQLSTATE_IDENTIDAD_PROTEGIDA:
      return {
        estado: 409,
        mensaje: 'No se puede cambiar la materia ni el curso de una asignación existente.',
      }
    case SQLSTATE_ESTADO_INVALIDO:
      return { estado: 400, mensaje: 'El estado solicitado no es válido.', campo: 'activo' }
    case SQLSTATE_ENTRADA_INVALIDA:
      return { estado: 400, mensaje: 'Los datos enviados no son válidos.' }
    case SQLSTATE_IDENTIDAD_AUSENTE:
      return { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      return { estado: 403, mensaje: 'Solo el director puede administrar las materias.' }
    default:
      console.error('[materias] error inesperado de la base', {
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
): ResultadoMateria<T> {
  if (!datos) {
    return { ok: false, estado: 500, mensaje }
  }
  return { ok: true, datos }
}

// ----------------------------------------------------------------
// Lecturas
// ----------------------------------------------------------------

/** Catálogo completo: activas e inactivas, para poder reactivar el historial. */
export async function listarMaterias(): Promise<ResultadoMateria<Materia[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('materias')
    .select(COLUMNAS_MATERIA)
    .order('nombre', { ascending: true })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'listarMaterias') }
  return { ok: true, datos: (data ?? []) as unknown as Materia[] }
}

/** Todas las asignaciones, incluidas las históricas de materias o cursos inactivos. */
export async function listarAsignaciones(): Promise<
  ResultadoMateria<AsignacionMateria[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('materias_cursos_detalle')
    .select(COLUMNAS_ASIGNACION)
    .order('materia_nombre', { ascending: true })
    .order('curso_denominacion', { ascending: true })
    .order('curso_division', { ascending: true })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'listarAsignaciones') }
  return { ok: true, datos: (data ?? []) as unknown as AsignacionMateria[] }
}

/** Solo cursos activos: son las únicas opciones de una asignación nueva. */
export async function listarCursosAsignables(): Promise<
  ResultadoMateria<CursoAsignableMateria[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('cursos')
    .select('id, denominacion, division, nivel:niveles(nombre)')
    .eq('activo', true)
    .order('denominacion', { ascending: true })
    .order('division', { ascending: true })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'listarCursosAsignables') }

  const filas = (data ?? []) as unknown as Array<{
    id: string
    denominacion: string
    division: string
    nivel: { nombre: string } | null
  }>

  return {
    ok: true,
    datos: filas.map((fila) => ({
      id: fila.id,
      denominacion: fila.denominacion,
      division: fila.division,
      nivel_nombre: fila.nivel?.nombre ?? '',
    })),
  }
}

/**
 * Perfiles cuyo rol real es DOCENTE.
 *
 * Se piden solo nombre y apellido: la pantalla no necesita ningún otro dato
 * personal para elegir al responsable de una asignación.
 */
export async function listarProfesoresAsignables(): Promise<
  ResultadoMateria<ProfesorAsignable[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('perfiles')
    .select('id, nombre, apellido, roles!inner(nombre)')
    .eq('roles.nombre', 'DOCENTE')
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'listarProfesores') }

  const filas = (data ?? []) as unknown as Array<{
    id: string
    nombre: string
    apellido: string
  }>

  return {
    ok: true,
    datos: filas.map(({ id, nombre, apellido }) => ({ id, nombre, apellido })),
  }
}

// ----------------------------------------------------------------
// Escrituras
// ----------------------------------------------------------------

export async function crearMateria(nombre: string): Promise<ResultadoMateria<Materia>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('crear_materia', { p_nombre: nombre })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'crearMateria') }
  return exigirFila(
    data as Materia | null,
    'No pudimos confirmar el alta de la materia. Verificá el listado antes de reintentar.'
  )
}

export async function renombrarMateria(
  id: number,
  nombre: string
): Promise<ResultadoMateria<Materia>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('renombrar_materia', {
    p_materia_id: id,
    p_nombre: nombre,
  })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'renombrarMateria') }
  return exigirFila(
    data as Materia | null,
    'No pudimos confirmar el cambio de nombre. Verificá el listado antes de reintentar.'
  )
}

export async function cambiarEstadoMateria(
  id: number,
  activo: boolean
): Promise<ResultadoMateria<Materia>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cambiar_estado_materia', {
    p_materia_id: id,
    p_activo: activo,
  })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'cambiarEstadoMateria') }
  return exigirFila(
    data as Materia | null,
    'No pudimos confirmar el cambio de estado. Verificá el listado antes de reintentar.'
  )
}

/** Alta de una asignación Curso–Materia con profesor responsable opcional. */
export async function asignarMateriaCurso(
  materiaId: number,
  cursoId: string,
  profesorId: string | null
): Promise<ResultadoMateria<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('asignar_materia_curso', {
    p_materia_id: materiaId,
    p_curso_id: cursoId,
    p_profesor_id: profesorId,
  })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'asignarMateriaCurso') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar la asignación. Verificá el listado antes de reintentar.'
  )
}

export async function cambiarProfesorAsignacion(
  asignacionId: string,
  profesorId: string | null
): Promise<ResultadoMateria<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cambiar_profesor_asignacion', {
    p_asignacion_id: asignacionId,
    p_profesor_id: profesorId,
  })

  if (error) {
    return { ok: false, ...traducirErrorMateria(error, 'cambiarProfesorAsignacion') }
  }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar el cambio de profesor. Verificá el listado antes de reintentar.'
  )
}

export async function cambiarEstadoAsignacion(
  asignacionId: string,
  activo: boolean
): Promise<ResultadoMateria<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cambiar_estado_asignacion', {
    p_asignacion_id: asignacionId,
    p_activo: activo,
  })

  if (error) return { ok: false, ...traducirErrorMateria(error, 'cambiarEstadoAsignacion') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar el cambio de estado. Verificá el listado antes de reintentar.'
  )
}
