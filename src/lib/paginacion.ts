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

/**
 * La respuesta no cumple el contrato (sin `total_filas` utilizable, o una página que
 * no puede solaparse). No es un cambio de datos: reintentar no la arregla.
 */
export const ERROR_RESPUESTA_INVALIDA = 'ERROR_RESPUESTA_INVALIDA'

type OpcionesEnParalelo = Opciones & { concurrencia?: number }

/**
 * Igual que `leerTodasLasFilas`, pero pide las páginas restantes en paralelo
 * cuando cada fila informa el total del conjunto (`total_filas`).
 *
 * Por qué existe: una consulta con orden total y desplazamiento (`OFFSET`) tiene
 * que resolver y ordenar el conjunto entero en CADA página. Leer 79 páginas una
 * tras otra multiplica ese costo por 79; pedirlas de a `concurrencia` lo divide.
 *
 * Garantía. Cada página es una consulta con su propia foto de la base: entre dos
 * páginas puede haber altas y bajas. Comparar solo CANTIDADES no alcanza: una baja
 * en una página ya leída y un alta al final dejan el total igual y corren un lugar
 * todas las filas siguientes, de modo que una fila se omite y otra queda de más con
 * el mismo total. Por eso las páginas SE SOLAPAN EN UNA FILA: la página `k` arranca
 * en la última fila de la `k-1`, y las dos tienen que coincidir. Si entre las dos
 * lecturas cambió algo que corre el orden antes de esa frontera, la fila de la
 * frontera no coincide y la lectura falla. Con el orden total (clave única como
 * último criterio) esto asegura que toda fila que existió durante TODA la lectura,
 * con su clave de orden sin cambios, aparece exactamente una vez. Las filas que se
 * dieron de alta o de baja mientras se leía pueden o no figurar (como en cualquier
 * lectura confirmada): lo que nunca ocurre es que falte una fila estable.
 *
 * Reglas:
 *
 *  1. La primera página va sola: fija el total y la capacidad de página, y comprueba
 *     la cota ANTES de leer el resto (más de `tamano × maximoPaginas` filas falla con
 *     `ERROR_LIMITE_DE_PAGINAS`).
 *  2. Si el servidor devolvió menos filas que las pedidas habiendo más (su tope es
 *     menor que `tamano`), esa cantidad pasa a ser la capacidad de cada página.
 *  3. Cada página tiene que traer EXACTAMENTE las filas que le corresponden según el
 *     total, el mismo `total_filas` que la primera y una primera fila igual a la
 *     última de la página anterior.
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
    return { ok: false, error: { code: ERROR_RESPUESTA_INVALIDA } }
  }

  if (total > tamano * maximoPaginas) {
    return { ok: false, error: { code: ERROR_LIMITE_DE_PAGINAS } }
  }

  // Filas que el servidor entrega por página. Sin tope propio es `tamano`.
  const capacidad = inicial.length < Math.min(tamano, total) ? inicial.length : tamano

  if (inicial.length === total) return unicas(inicial, total)

  // Cada página nueva aporta `capacidad - 1` filas: la primera es el solape.
  const paso = capacidad - 1
  if (paso < 1) return { ok: false, error: { code: ERROR_RESPUESTA_INVALIDA } }

  const desplazamientos: number[] = []
  for (let desde = paso; desde < total - 1; desde += paso) desplazamientos.push(desde)

  const lotes: T[][] = new Array(desplazamientos.length)
  let siguiente = 0
  let fallo: { error: ErrorDePagina | null } | null = null

  async function trabajador() {
    while (fallo === null) {
      const indice = siguiente
      siguiente += 1
      if (indice >= desplazamientos.length) return

      const desde = desplazamientos[indice]
      const { data, error } = await pagina(desde, desde + capacidad - 1)
      if (error) {
        fallo ??= { error }
        return
      }

      const lote = (data ?? []) as T[]
      if (lote.length !== Math.min(capacidad, total - desde) || lote[0].total_filas !== total) {
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

  // La frontera de cada par de páginas contiguas tiene que ser la MISMA fila.
  const paginas = [inicial, ...lotes]
  for (let i = 1; i < paginas.length; i += 1) {
    const anterior = paginas[i - 1]
    if (paginas[i][0].id !== anterior[anterior.length - 1].id) {
      return { ok: false, error: { code: ERROR_LECTURA_INCONSISTENTE } }
    }
  }

  const filas: T[] = [...inicial]
  for (const lote of lotes) filas.push(...lote.slice(1))
  return unicas(filas, total)
}

/** Las filas tienen que ser exactamente `total` y no repetirse: si no, los datos cambiaron. */
function unicas<T extends FilaConId>(filas: T[], total: number): ResultadoLectura<T> {
  const vistas = new Set<string>()
  for (const fila of filas) vistas.add(fila.id)
  if (filas.length !== total || vistas.size !== total) {
    return { ok: false, error: { code: ERROR_LECTURA_INCONSISTENTE } }
  }
  return { ok: true, datos: filas }
}
