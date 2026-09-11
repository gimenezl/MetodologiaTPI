import type { CrearNivelData } from '@/lib/validations'
import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Acceso a niveles educativos ligado a la sesión real de Supabase.
 *
 * Este módulo nunca usa `service_role`: las lecturas respetan RLS y todas las
 * escrituras atraviesan los wrappers públicos que vuelven a validar auth.uid()
 * y el rol DIRECTOR dentro de PostgreSQL.
 */

export type NivelAdministrable = {
  id: number
  nombre: string
  activo: boolean
  orden: number
  es_institucional: boolean
}

export type CampoNivel = 'nombre' | 'activo'
export type EstadoErrorNivel = 400 | 401 | 403 | 404 | 409 | 500

export type ResultadoNivel<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: EstadoErrorNivel; mensaje: string; campo?: CampoNivel }

const SQLSTATE_DUPLICADO = '23505'
const SQLSTATE_NOMBRE_INVALIDO = 'P5501'
const SQLSTATE_INSTITUCIONAL_PROTEGIDO = 'P5502'
const SQLSTATE_NIVEL_INEXISTENTE = 'P5503'
const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_IDENTIDAD_AUSENTE = 'P5505'

const COLUMNAS = 'id, nombre, activo, orden, es_institucional'

type ErrorPostgres = { code?: string | null; message?: string | null }

/**
 * Convierte errores de PostgreSQL en resultados estables sin devolver detalles
 * internos, nombres de restricciones, consultas ni SQLSTATE al cliente.
 */
function traducirErrorNivel(
  error: ErrorPostgres,
  operacion: string
): { estado: EstadoErrorNivel; mensaje: string; campo?: CampoNivel } {
  switch (error.code) {
    case SQLSTATE_DUPLICADO:
      return {
        estado: 409,
        mensaje: 'Ya existe un nivel educativo con ese nombre.',
        campo: 'nombre',
      }
    case SQLSTATE_NOMBRE_INVALIDO:
      return {
        estado: 400,
        mensaje:
          'El nombre del nivel debe tener entre 1 y 50 caracteres y no puede tener espacios al inicio o al final.',
        campo: 'nombre',
      }
    case SQLSTATE_INSTITUCIONAL_PROTEGIDO:
      return {
        estado: 409,
        mensaje: 'Los niveles institucionales no pueden renombrarse.',
        campo: 'nombre',
      }
    case SQLSTATE_NIVEL_INEXISTENTE:
      return {
        estado: 404,
        mensaje: 'El nivel educativo solicitado no existe.',
      }
    case SQLSTATE_IDENTIDAD_AUSENTE:
      return {
        estado: 401,
        mensaje: 'Necesitás iniciar sesión para continuar.',
      }
    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      return {
        estado: 403,
        mensaje: 'Solo el director puede administrar los niveles educativos.',
      }
    default:
      console.error('[niveles] error inesperado de la base', {
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

async function listar(
  soloActivos: boolean
): Promise<ResultadoNivel<NivelAdministrable[]>> {
  const supabase = await createServerSupabaseClient()
  let consulta = supabase.from('niveles').select(COLUMNAS)

  if (soloActivos) {
    consulta = consulta.eq('activo', true)
  }

  const { data, error } = await consulta
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    return { ok: false, ...traducirErrorNivel(error, 'listarNiveles') }
  }

  return { ok: true, datos: (data ?? []) as NivelAdministrable[] }
}

/** Lista el catálogo completo, incluidos los niveles inactivos históricos. */
export function listarNiveles() {
  return listar(false)
}

/** Lista únicamente opciones válidas para una asignación nueva. */
export function listarNivelesActivos() {
  return listar(true)
}

export async function crearNivel(
  datos: CrearNivelData
): Promise<ResultadoNivel<NivelAdministrable>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('crear_nivel', {
    p_nombre: datos.nombre,
  })

  if (error) {
    return { ok: false, ...traducirErrorNivel(error, 'crearNivel') }
  }
  if (!data) {
    return {
      ok: false,
      estado: 500,
      mensaje: 'No pudimos confirmar el alta del nivel. Verificá el listado antes de reintentar.',
    }
  }

  return { ok: true, datos: data as NivelAdministrable }
}

export async function renombrarNivel(
  id: number,
  nombre: string
): Promise<ResultadoNivel<NivelAdministrable>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('renombrar_nivel', {
    p_nivel_id: id,
    p_nombre: nombre,
  })

  if (error) {
    return { ok: false, ...traducirErrorNivel(error, 'renombrarNivel') }
  }
  if (!data) {
    return {
      ok: false,
      estado: 500,
      mensaje: 'No pudimos confirmar la modificación del nivel. Verificá el listado antes de reintentar.',
    }
  }

  return { ok: true, datos: data as NivelAdministrable }
}

export async function cambiarEstadoNivel(
  id: number,
  activo: boolean
): Promise<ResultadoNivel<NivelAdministrable>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cambiar_estado_nivel', {
    p_nivel_id: id,
    p_activo: activo,
  })

  if (error) {
    return { ok: false, ...traducirErrorNivel(error, 'cambiarEstadoNivel') }
  }
  if (!data) {
    return {
      ok: false,
      estado: 500,
      mensaje:
        'No pudimos confirmar el cambio de estado. Verificá el listado antes de reintentar.',
    }
  }

  return { ok: true, datos: data as NivelAdministrable }
}
