import {
  ERROR_LECTURA_INCONSISTENTE,
  ERROR_LIMITE_DE_PAGINAS,
  MAXIMO_PAGINAS,
  TAMANO_PAGINA,
  leerTodasLasFilasEnParalelo,
} from '@/lib/paginacion'
import {
  MAXIMO_FILAS_IMPRESION,
  REPORTES,
  argumentosRpc,
  type Catalogos,
  type FilaReporte,
  type FiltrosReporte,
  type IdReporte,
} from '@/lib/reportes'
import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Lectura de los reportes oficiales de Dirección (EPT-63, RF17).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Nunca usa `service_role`: cada lectura viaja con la sesión de quien consulta y
 * atraviesa una función de PostgreSQL SECURITY INVOKER que exige Dirección
 * dentro de la base. Esta capa no decide quién puede leer; traduce el rechazo de
 * PostgreSQL a un resultado estable y sin detalles internos.
 *
 * Toda lectura es COMPLETA o falla: ninguna consulta se recorta en silencio al
 * tope de 1000 filas de la Data API. La pantalla pide una página exacta; la
 * exportación y la impresión recorren todas con `leerTodasLasFilasEnParalelo`.
 */

export type EstadoErrorReportes = 400 | 401 | 403 | 409 | 413 | 500

export type CodigoErrorReportes =
  | 'DATOS_INVALIDOS'
  | 'SIN_SESION'
  | 'ACCESO_DENEGADO'
  | 'DEMASIADAS_FILAS'
  | 'DATOS_CAMBIARON'
  | 'ERROR_INTERNO'

export type FalloReportes = {
  ok: false
  estado: EstadoErrorReportes
  codigo: CodigoErrorReportes
  mensaje: string
  /** Total de filas del conjunto cuando el fallo es `DEMASIADAS_FILAS`. */
  total?: number
}

export type ResultadoReportes<T> = { ok: true; datos: T } | FalloReportes

const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_IDENTIDAD_AUSENTE = 'P5505'
const SQLSTATE_PARAMETRO_INVALIDO = 'P6301'

const MENSAJE_GENERICO =
  'No pudimos obtener el reporte. Volvé a intentarlo en unos minutos; si continúa, avisale al equipo técnico.'

type ErrorPostgres = { code?: string | null; message?: string | null }

/**
 * El rechazo de Dirección de las funciones de reportes (`42501` con este
 * mensaje) se distingue de cualquier OTRO `42501`, como un privilegio de tabla
 * retirado: quien llega acá ya pasó la guarda de Dirección del servidor, así que
 * un privilegio faltante es un fallo de la instalación y no una falta de permiso
 * de la persona. Decirle «solo Dirección puede…» a una directora sería falso.
 */
const MENSAJE_RECHAZO_DE_DIRECCION = /^Solo la dirección puede consultar los reportes oficiales/u

/**
 * Traduce un error de PostgreSQL. Nunca devuelve al navegador el mensaje de la
 * base, un SQLSTATE, el nombre de una función ni una consulta.
 */
function traducirError(error: ErrorPostgres, operacion: string, reporte: IdReporte | null): FalloReportes {
  if (error.code === SQLSTATE_PRIVILEGIO_INSUFICIENTE && !MENSAJE_RECHAZO_DE_DIRECCION.test(error.message ?? '')) {
    console.error('[reportes] privilegio insuficiente en la base', { operacion, reporte, code: error.code })
    return { ok: false, estado: 500, codigo: 'ERROR_INTERNO', mensaje: MENSAJE_GENERICO }
  }

  switch (error.code) {
    case SQLSTATE_IDENTIDAD_AUSENTE:
      return { ok: false, estado: 401, codigo: 'SIN_SESION', mensaje: 'Necesitás iniciar sesión para continuar.' }
    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      return {
        ok: false,
        estado: 403,
        codigo: 'ACCESO_DENEGADO',
        mensaje: 'Solo Dirección puede consultar los reportes oficiales.',
      }
    case SQLSTATE_PARAMETRO_INVALIDO:
      return {
        ok: false,
        estado: 400,
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Los filtros enviados no son válidos.',
      }
    case ERROR_LECTURA_INCONSISTENTE:
      return {
        ok: false,
        estado: 409,
        codigo: 'DATOS_CAMBIARON',
        mensaje: 'Los datos cambiaron mientras se preparaba el reporte y el resultado podría estar incompleto. Volvé a intentarlo.',
      }
    case ERROR_LIMITE_DE_PAGINAS:
      return {
        ok: false,
        estado: 413,
        codigo: 'DEMASIADAS_FILAS',
        mensaje: `El reporte supera el máximo que se puede exportar (${(TAMANO_PAGINA * MAXIMO_PAGINAS).toLocaleString('es-AR')} filas). Acotalo con filtros.`,
      }
    default:
      console.error('[reportes] error inesperado de la base', { operacion, reporte, code: error.code ?? null })
      return { ok: false, estado: 500, codigo: 'ERROR_INTERNO', mensaje: MENSAJE_GENERICO }
  }
}

function respuestaInesperada(operacion: string, reporte: IdReporte | null): FalloReportes {
  console.error('[reportes] respuesta inesperada de la base', { operacion, reporte })
  return { ok: false, estado: 500, codigo: 'ERROR_INTERNO', mensaje: MENSAJE_GENERICO }
}

function esFila(valor: unknown): valor is FilaReporte {
  if (typeof valor !== 'object' || valor === null) return false
  const fila = valor as Record<string, unknown>
  return typeof fila.id === 'string' && typeof fila.total_filas === 'number'
}

// ----------------------------------------------------------------
// Página
// ----------------------------------------------------------------

export type PaginaReporte = {
  filas: FilaReporte[]
  /** Filas del conjunto filtrado completo, no de la página. */
  total: number
  pagina: number
  tamano: number
  paginas: number
}

/**
 * Una página del reporte, en el orden total y estable de PostgreSQL.
 *
 * El total viene de la propia consulta (una ventana sobre el conjunto filtrado),
 * de modo que es exacto y no depende de traer todas las filas. Si se pide una
 * página fuera de rango la base no devuelve filas y por lo tanto tampoco el
 * total: en ese caso se lee la primera página para informarlo, y la pantalla
 * explica que la página no existe en lugar de mostrar un vacío engañoso.
 */
export async function leerPaginaReporte(
  id: IdReporte,
  filtros: FiltrosReporte,
  pagina: number,
  tamano: number
): Promise<ResultadoReportes<PaginaReporte>> {
  const reporte = REPORTES[id]
  const supabase = await createServerSupabaseClient()

  async function leer(desplazamiento: number, limite: number) {
    return supabase.rpc(reporte.rpc, argumentosRpc(reporte, filtros, limite, desplazamiento))
  }

  const { data, error } = await leer((pagina - 1) * tamano, tamano)
  if (error) return traducirError(error, 'pagina', id)
  if (!Array.isArray(data) || !data.every(esFila)) return respuestaInesperada('pagina', id)

  if (data.length > 0) {
    const total = data[0].total_filas
    return {
      ok: true,
      datos: { filas: data, total, pagina, tamano, paginas: Math.max(1, Math.ceil(total / tamano)) },
    }
  }

  // Sin filas: o el conjunto está vacío o la página está fuera de rango.
  if (pagina === 1) {
    return { ok: true, datos: { filas: [], total: 0, pagina, tamano, paginas: 1 } }
  }
  const primera = await leer(0, 1)
  if (primera.error) return traducirError(primera.error, 'pagina', id)
  if (!Array.isArray(primera.data) || !primera.data.every(esFila)) return respuestaInesperada('pagina', id)
  const total = primera.data.length > 0 ? primera.data[0].total_filas : 0
  return {
    ok: true,
    datos: { filas: [], total, pagina, tamano, paginas: Math.max(1, Math.ceil(total / tamano)) },
  }
}

// ----------------------------------------------------------------
// Lectura completa (exportación e impresión)
// ----------------------------------------------------------------

export type ReporteCompleto = { filas: FilaReporte[]; total: number }

type OpcionesLecturaCompleta = {
  /** Cota en filas. Por encima, la lectura falla con `DEMASIADAS_FILAS`, nunca se recorta. */
  maximoFilas?: number
}

/**
 * TODAS las filas del conjunto filtrado. Se apoya en
 * `leerTodasLasFilasEnParalelo`: el orden es total, las páginas se piden de a
 * cuatro (cada una vuelve a resolver el conjunto, así que en serie 79 páginas
 * costaban 79 veces), cada una tiene que traer exactamente las filas que le
 * tocan según el total y un error en cualquier página devuelve ese error, nunca
 * un listado parcial. Si los datos cambian a mitad de la lectura se reintenta
 * una vez y luego se informa con 409.
 *
 * Con `maximoFilas` (la impresión) se lee antes el total —una sola fila— y se
 * rechaza el pedido si lo supera, informando cuántas filas tiene el conjunto.
 */
export async function leerReporteCompleto(
  id: IdReporte,
  filtros: FiltrosReporte,
  { maximoFilas }: OpcionesLecturaCompleta = {}
): Promise<ResultadoReportes<ReporteCompleto>> {
  const reporte = REPORTES[id]

  if (maximoFilas !== undefined) {
    const primera = await leerPaginaReporte(id, filtros, 1, 1)
    if (!primera.ok) return primera
    if (primera.datos.total > maximoFilas) {
      return {
        ok: false,
        estado: 413,
        codigo: 'DEMASIADAS_FILAS',
        total: primera.datos.total,
        mensaje: `Este reporte tiene ${primera.datos.total.toLocaleString('es-AR')} filas, más que las ${maximoFilas.toLocaleString('es-AR')} que se pueden imprimir. Acotalo con filtros o exportalo en CSV.`,
      }
    }
  }

  const supabase = await createServerSupabaseClient()
  const leer = () =>
    leerTodasLasFilasEnParalelo<FilaReporte>((desde, hasta) =>
      supabase.rpc(reporte.rpc, argumentosRpc(reporte, filtros, hasta - desde + 1, desde))
    )

  let resultado = await leer()
  // Un alta o una baja a mitad de la lectura cambia el total: se reintenta UNA vez
  // y, si vuelve a cambiar, se informa. Nunca se entrega un listado dudoso.
  if (!resultado.ok && resultado.error?.code === ERROR_LECTURA_INCONSISTENTE) resultado = await leer()

  if (!resultado.ok) return traducirError(resultado.error ?? {}, 'completo', id)
  return { ok: true, datos: { filas: resultado.datos, total: resultado.datos.length } }
}

/** Cota de la vista imprimible, para que la ruta y la pantalla no la dupliquen. */
export const MAXIMO_FILAS_PARA_IMPRIMIR = MAXIMO_FILAS_IMPRESION

// ----------------------------------------------------------------
// Catálogos de los filtros
// ----------------------------------------------------------------

const CLAVES_CATALOGO = [
  'niveles',
  'cursos',
  'materias',
  'deportes',
  'recorridos',
  'horarios',
  'profesores',
] as const

/** Los siete catálogos de los selectores, en un solo documento (una sola ida a la base). */
export async function leerCatalogos(): Promise<ResultadoReportes<Catalogos>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('catalogos_reportes')
  if (error) return traducirError(error, 'catalogos', null)

  const documento = data as Record<string, unknown> | null
  if (
    typeof documento !== 'object' ||
    documento === null ||
    !CLAVES_CATALOGO.every((clave) => Array.isArray(documento[clave]))
  ) {
    return respuestaInesperada('catalogos', null)
  }
  return { ok: true, datos: documento as unknown as Catalogos }
}
