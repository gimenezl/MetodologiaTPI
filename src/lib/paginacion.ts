/**
 * Lectura completa de una consulta paginada (EPT-62).
 *
 * PostgREST recorta cada respuesta a `max_rows` (1000 en `supabase/config.toml`)
 * sin devolver ningún error: un `select` sin paginar pierde en silencio las filas
 * posteriores. Este módulo no depende del servidor de Next ni de Supabase, de modo
 * que su comportamiento —incluida la cota— se prueba de forma aislada.
 */

/** Tamaño de página: coincide con el `max_rows` por defecto de PostgREST. */
export const TAMANO_PAGINA = 1000

/**
 * Cota de seguridad: como máximo `MAXIMO_PAGINAS` páginas CON datos. Una lectura
 * más grande falla en lugar de devolver un listado recortado.
 */
export const MAXIMO_PAGINAS = 500

/** Filas máximas que la lectura acepta con los valores por defecto. */
export const MAXIMO_FILAS = TAMANO_PAGINA * MAXIMO_PAGINAS

export const ERROR_LIMITE_DE_PAGINAS = 'ERROR_LIMITE_DE_PAGINAS'

export type ErrorDePagina = { code?: string | null }

type FilaConId = { id: string }

export type ResultadoLectura<T> = { ok: true; datos: T[] } | { ok: false; error: ErrorDePagina | null }

type Opciones = { tamano?: number; maximoPaginas?: number }

/**
 * Recorre TODAS las filas de una lectura ordenada, página a página.
 *
 * `pagina(desde, hasta)` debe pedir siempre el mismo orden TOTAL (un criterio de
 * fecha y el identificador como desempate único); sin él, dos páginas podrían
 * repetir o saltear filas. No se asume que el servidor devuelva exactamente
 * `tamano` filas: si su tope fuera menor, el siguiente pedido arranca donde
 * terminó el anterior, y la lectura solo termina con una página vacía. Las filas
 * repetidas por una alta concurrente se descartan por identificador. Ante un error
 * de cualquier página se devuelve ese error, nunca un listado parcial.
 *
 * Cota exacta: se aceptan hasta `maximoPaginas` páginas con datos y se hace UN
 * pedido más para comprobar que no queda ninguna fila. Con exactamente
 * `maximoPaginas` páginas llenas y nada después, la lectura es válida; si ese pedido
 * de comprobación devuelve una sola fila, falla con `ERROR_LIMITE_DE_PAGINAS`.
 */
export async function leerTodasLasFilas<T extends FilaConId>(
  pagina: (
    desde: number,
    hasta: number
  ) => PromiseLike<{ data: unknown[] | null; error: ErrorDePagina | null }>,
  { tamano = TAMANO_PAGINA, maximoPaginas = MAXIMO_PAGINAS }: Opciones = {}
): Promise<ResultadoLectura<T>> {
  const vistas = new Set<string>()
  const filas: T[] = []
  let desde = 0

  for (let paginas = 0; paginas <= maximoPaginas; paginas += 1) {
    const { data, error } = await pagina(desde, desde + tamano - 1)
    if (error) return { ok: false, error }

    const lote = (data ?? []) as T[]
    if (lote.length === 0) return { ok: true, datos: filas }

    // Ya se aceptaron `maximoPaginas` páginas y todavía hay filas: no se recorta.
    if (paginas === maximoPaginas) break

    for (const fila of lote) {
      if (!vistas.has(fila.id)) {
        vistas.add(fila.id)
        filas.push(fila)
      }
    }
    desde += lote.length
  }

  return { ok: false, error: { code: ERROR_LIMITE_DE_PAGINAS } }
}
