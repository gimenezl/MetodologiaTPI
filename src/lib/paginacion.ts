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

/**
 * El total informado por la primera página no coincide con lo que devolvieron
 * las demás: los datos cambiaron mientras se leían. Se informa, nunca se
 * entrega un listado que pueda tener filas de menos o de más.
 */
export const ERROR_LECTURA_INCONSISTENTE = 'ERROR_LECTURA_INCONSISTENTE'

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

// ----------------------------------------------------------------
// Lectura completa con páginas en paralelo (EPT-63)
// ----------------------------------------------------------------

/** Cada fila trae, además de su identificador, el total del conjunto filtrado completo. */
type FilaConIdYTotal = FilaConId & { total_filas: number }

/** Páginas que se piden a la vez. Cada una vuelve a resolver el conjunto, así que más no ayuda. */
export const CONCURRENCIA_POR_DEFECTO = 4

type OpcionesEnParalelo = Opciones & { concurrencia?: number }

/**
 * Igual que `leerTodasLasFilas`, pero pide las páginas restantes en paralelo
 * cuando cada fila informa el total del conjunto (`total_filas`).
 *
 * Por qué existe: una consulta con orden total y desplazamiento (`OFFSET`) tiene
 * que resolver y ordenar el conjunto entero en CADA página. Leer 79 páginas una
 * tras otra multiplica ese costo por 79; pedirlas de a `concurrencia` lo divide.
 *
 * Reglas, las mismas de la lectura secuencial y dos más:
 *
 *  1. La primera página va sola: fija el total y comprueba la cota ANTES de leer
 *     el resto (más de `maximoPaginas` páginas falla con `ERROR_LIMITE_DE_PAGINAS`).
 *  2. Si el servidor devolvió menos filas que las pedidas habiendo más
 *     (su tope es menor que `tamano`), no se puede saber qué página cae dónde:
 *     se cae a la lectura secuencial, que no lo supone.
 *  3. Cada página tiene que traer EXACTAMENTE las filas que le corresponden según
 *     el total. Otro largo significa que los datos cambiaron a mitad de la lectura.
 *  4. Al final, las filas únicas (por identificador) tienen que ser el total.
 *
 * Con 3 o 4 incumplidas se devuelve `ERROR_LECTURA_INCONSISTENTE`: un listado que
 * podría tener filas de menos o de más no se entrega. Quien llama decide si
 * reintenta. Un error de cualquier página se devuelve tal cual.
 */
export async function leerTodasLasFilasEnParalelo<T extends FilaConIdYTotal>(
  pagina: (
    desde: number,
    hasta: number
  ) => PromiseLike<{ data: unknown[] | null; error: ErrorDePagina | null }>,
  {
    tamano = TAMANO_PAGINA,
    maximoPaginas = MAXIMO_PAGINAS,
    concurrencia = CONCURRENCIA_POR_DEFECTO,
  }: OpcionesEnParalelo = {}
): Promise<ResultadoLectura<T>> {
  const primera = await pagina(0, tamano - 1)
  if (primera.error) return { ok: false, error: primera.error }

  const inicial = (primera.data ?? []) as T[]
  if (inicial.length === 0) return { ok: true, datos: [] }

  const total = inicial[0].total_filas
  if (!Number.isSafeInteger(total) || total < inicial.length) {
    // La fila no informa un total utilizable: se lee sin suponerlo.
    return leerTodasLasFilas<T>(pagina, { tamano, maximoPaginas })
  }

  if (Math.ceil(total / tamano) > maximoPaginas) {
    return { ok: false, error: { code: ERROR_LIMITE_DE_PAGINAS } }
  }

  if (inicial.length < Math.min(tamano, total)) {
    return leerTodasLasFilas<T>(pagina, { tamano, maximoPaginas })
  }

  const desplazamientos: number[] = []
  for (let desde = tamano; desde < total; desde += tamano) desplazamientos.push(desde)

  const lotes: T[][] = new Array(desplazamientos.length)
  let siguiente = 0
  let fallo: { error: ErrorDePagina | null } | null = null

  async function trabajador() {
    while (fallo === null) {
      const indice = siguiente
      siguiente += 1
      if (indice >= desplazamientos.length) return

      const desde = desplazamientos[indice]
      const { data, error } = await pagina(desde, desde + tamano - 1)
      if (error) {
        fallo ??= { error }
        return
      }

      const lote = (data ?? []) as T[]
      if (lote.length !== Math.min(tamano, total - desde)) {
        fallo ??= { error: { code: ERROR_LECTURA_INCONSISTENTE } }
        return
      }
      lotes[indice] = lote
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrencia, desplazamientos.length)) }, trabajador)
  )
  if (fallo !== null) return { ok: false, error: (fallo as { error: ErrorDePagina | null }).error }

  const vistas = new Set<string>()
  const filas: T[] = []
  for (const lote of [inicial, ...lotes]) {
    for (const fila of lote) {
      if (!vistas.has(fila.id)) {
        vistas.add(fila.id)
        filas.push(fila)
      }
    }
  }

  if (filas.length !== total) return { ok: false, error: { code: ERROR_LECTURA_INCONSISTENTE } }
  return { ok: true, datos: filas }
}
