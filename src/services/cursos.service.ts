import { createServerSupabaseClient } from '@/services/supabase.server'
import type { ActualizarCursoData, CrearCursoData } from '@/lib/validations'

/**
 * Capa de acceso a datos de cursos (EPT-15).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, por lo que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Usa siempre el cliente ligado a la sesión (clave anónima + cookies), nunca el
 * cliente `service_role`. Así RLS sigue siendo la última línea de defensa: si el
 * control del servidor tuviera un hueco, la base rechaza igual la operación.
 */

/** Curso con el nivel educativo resuelto, tal como lo consume la interfaz. */
export type CursoConNivel = {
  id: string
  nivel_id: number
  denominacion: string
  division: string
  activo: boolean
  fecha_creacion: string
  nivel: { id: number; nombre: string; activo?: boolean } | null
}

export type NivelSeleccionable = {
  id: number
  nombre: string
  orden: number
}

export type CampoCurso = 'denominacion' | 'division' | 'nivel_id'

export type EstadoErrorCurso = 400 | 409 | 500

export type ResultadoCurso<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: EstadoErrorCurso; mensaje: string; campo?: CampoCurso }

/** Códigos SQLSTATE de PostgreSQL que este dominio traduce de forma estable. */
const SQLSTATE_DUPLICADO = '23505'
const SQLSTATE_CLAVE_FORANEA = '23503'
const SQLSTATE_CHECK = '23514'
const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_NIVEL_INACTIVO = 'P5504'

const COLUMNAS =
  'id, nivel_id, denominacion, division, activo, fecha_creacion, nivel:niveles(id, nombre, activo)'

type ErrorPostgres = { code?: string | null; message?: string | null }

/**
 * Traduce un error de PostgreSQL a una respuesta de dominio estable.
 *
 * Nunca devuelve el texto original al usuario: los mensajes de Postgres incluyen
 * nombres de restricciones y valores de la fila. El detalle queda solo en el log
 * del servidor.
 */
function traducirError(
  error: ErrorPostgres,
  operacion: string
): { estado: EstadoErrorCurso; mensaje: string; campo?: CampoCurso } {
  switch (error.code) {
    case SQLSTATE_DUPLICADO:
      return {
        estado: 409,
        mensaje: 'Ya existe un curso con esa denominación y división en el nivel elegido.',
        campo: 'denominacion',
      }
    case SQLSTATE_CLAVE_FORANEA:
      return {
        estado: 400,
        mensaje: 'El nivel educativo elegido no existe.',
        campo: 'nivel_id',
      }
    case SQLSTATE_CHECK:
      return {
        estado: 400,
        mensaje: 'La denominación y la división no pueden quedar vacías.',
        campo: 'denominacion',
      }
    case SQLSTATE_NIVEL_INACTIVO:
      return {
        estado: 400,
        mensaje: 'El nivel educativo elegido está inactivo. Elegí un nivel activo.',
        campo: 'nivel_id',
      }
    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      // RLS rechazó la operación. El servidor ya autorizó antes de llegar acá,
      // así que esto indica una sesión sin permisos que evadió la interfaz.
      return {
        estado: 400,
        mensaje: 'No tenés permisos para realizar esta operación sobre los cursos.',
      }
    default:
      console.error('[cursos] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return {
        estado: 500,
        mensaje: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.',
      }
  }
}

/**
 * Lista todos los cursos con su nivel.
 *
 * Devuelve activos e inactivos: la administración necesita ver el historial para
 * poder reactivar un curso dado de baja. Ordena por nivel, denominación y
 * división, que es el orden en que se muestra la tabla.
 */
export async function listarCursos(): Promise<ResultadoCurso<CursoConNivel[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('cursos')
    .select(COLUMNAS)
    .order('nivel_id', { ascending: true })
    .order('denominacion', { ascending: true })
    .order('division', { ascending: true })

  if (error) {
    return { ok: false, ...traducirError(error, 'listarCursos') }
  }

  // Una lista vacía es un estado válido, nunca un error disfrazado.
  return { ok: true, datos: (data ?? []) as unknown as CursoConNivel[] }
}

/** Lista únicamente niveles válidos para altas o nuevas asignaciones. */
export async function listarNivelesActivos(): Promise<ResultadoCurso<NivelSeleccionable[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('niveles')
    .select('id, nombre, orden')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    return { ok: false, ...traducirError(error, 'listarNivelesActivos') }
  }
  return { ok: true, datos: (data ?? []) as NivelSeleccionable[] }
}

/**
 * Crea un curso.
 *
 * La unicidad normalizada la garantiza el índice único de la base, no una
 * consulta previa: dos altas simultáneas con el mismo nombre no pueden ganar
 * las dos, y la que pierde se traduce con el SQLSTATE 23505.
 */
export async function crearCurso(datos: CrearCursoData): Promise<ResultadoCurso<CursoConNivel>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('cursos')
    .insert({
      nivel_id: datos.nivel_id,
      denominacion: datos.denominacion,
      division: datos.division,
    })
    .select(COLUMNAS)
    .single()

  if (error) {
    return { ok: false, ...traducirError(error, 'crearCurso') }
  }
  if (!data) {
    // Sin fila devuelta no hay alta confirmada, así que no se informa éxito.
    return {
      ok: false,
      estado: 500,
      mensaje: 'No pudimos confirmar el alta del curso. Verificá el listado antes de reintentar.',
    }
  }
  return { ok: true, datos: data as unknown as CursoConNivel }
}

/**
 * Modifica un curso. `activo: false` es la baja lógica y `activo: true` la
 * reactivación; no existe ninguna operación de borrado físico.
 *
 * Exige que la base devuelva la fila actualizada. Cuando RLS filtra un UPDATE, el
 * resultado son cero filas *sin error*, por lo que informar éxito sin verificar
 * la fila mostraría una confirmación falsa.
 */
export async function actualizarCurso(
  id: string,
  cambios: ActualizarCursoData
): Promise<ResultadoCurso<CursoConNivel>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('cursos')
    .update(cambios)
    .eq('id', id)
    .select(COLUMNAS)
    .maybeSingle()

  if (error) {
    return { ok: false, ...traducirError(error, 'actualizarCurso') }
  }
  if (!data) {
    return {
      ok: false,
      estado: 400,
      mensaje: 'El curso no existe o no tenés permisos para modificarlo.',
    }
  }
  return { ok: true, datos: data as unknown as CursoConNivel }
}
