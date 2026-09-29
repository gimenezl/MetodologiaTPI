import { expect, test } from '@playwright/test'
import {
  CONCURRENCIA_POR_DEFECTO,
  ERROR_LECTURA_INCONSISTENTE,
  ERROR_LIMITE_DE_PAGINAS,
  ERROR_RESPUESTA_INVALIDA,
  leerTodasLasFilasEnParalelo,
} from '../src/lib/paginacion'

/**
 * Lectura completa con páginas en paralelo (EPT-63): completitud, orden,
 * concurrencia acotada y detección de datos que cambian a mitad de la lectura.
 * Sin navegador ni base de datos.
 *
 * `fuente(total, opciones)` simula PostgREST sobre `total` filas con
 * identificadores consecutivos y `total_filas` en cada una. Registra los pedidos
 * y cuántos hubo en vuelo a la vez.
 */

type Fila = { id: string; total_filas: number }
type Pedido = { desde: number; hasta: number }

type OpcionesFuente = {
  /** Tope de filas por respuesta (un `max_rows` menor que la página). */
  tope?: number
  /** Demora de cada página, para forzar que terminen desordenadas. */
  demora?: (desde: number) => number
  /** Reemplaza la respuesta de una página (error, faltantes, sobrantes). */
  intervenir?: (desde: number, filas: Fila[]) => { data: Fila[] | null; error: { code?: string } | null } | null
}

function fuente(total: number, { tope = Number.POSITIVE_INFINITY, demora, intervenir }: OpcionesFuente = {}) {
  const pedidos: Pedido[] = []
  let enVuelo = 0
  let maximoEnVuelo = 0

  const pagina = async (desde: number, hasta: number) => {
    pedidos.push({ desde, hasta })
    enVuelo += 1
    maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo)
    try {
      await new Promise((resolver) => setTimeout(resolver, demora ? demora(desde) : 0))
      const fin = Math.min(hasta + 1, total, desde + tope)
      const filas: Fila[] = []
      for (let i = desde; i < fin; i += 1) filas.push({ id: `fila-${i}`, total_filas: total })
      return intervenir?.(desde, filas) ?? { data: filas, error: null }
    } finally {
      enVuelo -= 1
    }
  }
  return { pagina, pedidos, maximoEnVuelo: () => maximoEnVuelo }
}

const OPCIONES = { tamano: 3, maximoPaginas: 100 }

test.describe('leerTodasLasFilasEnParalelo', () => {
  test('la concurrencia por defecto es 4', () => {
    expect(CONCURRENCIA_POR_DEFECTO).toBe(4)
  })

  test('trae todas las filas, en orden y sin repetir', async () => {
    const { pagina } = fuente(20)
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.datos.map((f) => f.id)).toEqual(Array.from({ length: 20 }, (_, i) => `fila-${i}`))
  })

  test('mantiene el orden aunque las páginas terminen desordenadas', async () => {
    // Las primeras páginas tardan más que las últimas.
    const { pagina } = fuente(30, { demora: (desde) => Math.max(0, 40 - desde) })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, { ...OPCIONES, concurrencia: 5 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.datos.map((f) => f.id)).toEqual(Array.from({ length: 30 }, (_, i) => `fila-${i}`))
  })

  test('nunca hay más pedidos en vuelo que la concurrencia', async () => {
    for (const concurrencia of [1, 2, 4, 7]) {
      const { pagina, maximoEnVuelo } = fuente(60, { demora: () => 5 })
      const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, { ...OPCIONES, concurrencia })
      expect(r.ok).toBe(true)
      expect(maximoEnVuelo()).toBeLessThanOrEqual(concurrencia)
      expect(maximoEnVuelo()).toBeGreaterThanOrEqual(Math.min(concurrencia, 2) === 1 ? 1 : 2)
    }
  })

  test('la primera página va sola y fija el total antes de pedir el resto', async () => {
    const { pagina, pedidos } = fuente(10)
    await leerTodasLasFilasEnParalelo<Fila>(pagina, { ...OPCIONES, concurrencia: 4 })
    expect(pedidos[0]).toEqual({ desde: 0, hasta: 2 })
    // Las páginas se solapan en una fila (cada una arranca en la última de la anterior):
    // avanzan de a tamano - 1 y no se pide ninguna de más.
    expect(pedidos.map((p) => p.desde).sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8])
    expect(pedidos).toHaveLength(5)
  })

  test('un conjunto de una sola página, o vacío, no pide nada más', async () => {
    const una = fuente(2)
    const r1 = await leerTodasLasFilasEnParalelo<Fila>(una.pagina, OPCIONES)
    expect(r1.ok && r1.datos).toHaveLength(2)
    expect(una.pedidos).toHaveLength(1)

    const vacia = fuente(0)
    const r2 = await leerTodasLasFilasEnParalelo<Fila>(vacia.pagina, OPCIONES)
    expect(r2).toEqual({ ok: true, datos: [] })
    expect(vacia.pedidos).toHaveLength(1)
  })

  test('nunca pide una página que no aporte una fila nueva', async () => {
    const { pagina, pedidos } = fuente(9)
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r.ok && r.datos).toHaveLength(9)
    // Desde 0, 2, 4 y 6: la última cubre las filas 6, 7 y 8.
    expect(pedidos.map((p) => p.desde).sort((a, b) => a - b)).toEqual([0, 2, 4, 6])
  })

  test('el resultado es idéntico al de una lectura de una sola pasada', async () => {
    for (const total of [1, 3, 4, 17, 18, 100]) {
      const { pagina } = fuente(total, { demora: (desde) => (desde * 7) % 11 })
      const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
      expect(r.ok, `total ${total}`).toBe(true)
      if (r.ok) expect(r.datos.map((f) => f.id)).toEqual(Array.from({ length: total }, (_, i) => `fila-${i}`))
    }
  })

  test('respeta la cota: con más páginas que el máximo falla sin leer el resto', async () => {
    const { pagina, pedidos } = fuente(50)
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, { tamano: 3, maximoPaginas: 4 })
    expect(r).toEqual({ ok: false, error: { code: ERROR_LIMITE_DE_PAGINAS } })
    expect(pedidos).toHaveLength(1)
  })

  test('la cota es exacta: justo el máximo de páginas es válido', async () => {
    const { pagina } = fuente(12)
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, { tamano: 3, maximoPaginas: 4 })
    expect(r.ok && r.datos).toHaveLength(12)
    const uno_mas = await leerTodasLasFilasEnParalelo<Fila>(fuente(13).pagina, { tamano: 3, maximoPaginas: 4 })
    expect(uno_mas).toEqual({ ok: false, error: { code: ERROR_LIMITE_DE_PAGINAS } })
  })

  test('un error en cualquier página se devuelve tal cual, nunca un listado parcial', async () => {
    const { pagina } = fuente(20, {
      intervenir: (desde) => (desde === 10 ? { data: null, error: { code: '57014' } } : null),
    })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r).toEqual({ ok: false, error: { code: '57014' } })
  })

  test('un error en la primera página también se devuelve', async () => {
    const { pagina, pedidos } = fuente(20, { intervenir: () => ({ data: null, error: { code: '42501' } }) })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r).toEqual({ ok: false, error: { code: '42501' } })
    expect(pedidos).toHaveLength(1)
  })

  test('una página con filas de menos (datos que cambiaron) se detecta', async () => {
    const { pagina } = fuente(20, {
      intervenir: (desde, filas) => (desde === 6 ? { data: filas.slice(0, 2), error: null } : null),
    })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r).toEqual({ ok: false, error: { code: ERROR_LECTURA_INCONSISTENTE } })
  })

  test('una página con filas de más se detecta', async () => {
    const { pagina } = fuente(20, {
      intervenir: (desde, filas) => (desde === 6 ? { data: [...filas, { id: 'sobrante', total_filas: 20 }], error: null } : null),
    })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r).toEqual({ ok: false, error: { code: ERROR_LECTURA_INCONSISTENTE } })
  })

  test('filas repetidas entre páginas con el largo correcto se detectan por el recuento único', async () => {
    const { pagina } = fuente(20, {
      intervenir: (desde, filas) =>
        desde === 6 ? { data: filas.map((f) => ({ ...f, id: 'fila-0' })), error: null } : null,
    })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r).toEqual({ ok: false, error: { code: ERROR_LECTURA_INCONSISTENTE } })
  })

  test('si el servidor devuelve menos que lo pedido (tope menor), usa ese tope como página y trae todo', async () => {
    const { pagina } = fuente(10, { tope: 2 })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, { tamano: 4, maximoPaginas: 100 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.datos.map((f) => f.id)).toEqual(Array.from({ length: 10 }, (_, i) => `fila-${i}`))
  })

  test('sin total utilizable no se lee a ciegas: falla con respuesta inválida', async () => {
    const pedidos: Pedido[] = []
    const pagina = async (desde: number, hasta: number) => {
      pedidos.push({ desde, hasta })
      const filas: { id: string }[] = []
      for (let i = desde; i < Math.min(hasta + 1, 7); i += 1) filas.push({ id: `fila-${i}` })
      return { data: filas, error: null }
    }
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, OPCIONES)
    expect(r).toEqual({ ok: false, error: { code: ERROR_RESPUESTA_INVALIDA } })
    expect(pedidos).toHaveLength(1)
  })

  test('un fallo detiene los pedidos pendientes: no se sigue leyendo a ciegas', async () => {
    const { pagina, pedidos } = fuente(300, {
      demora: () => 3,
      intervenir: (desde) => (desde === 4 ? { data: null, error: { code: '57014' } } : null),
    })
    const r = await leerTodasLasFilasEnParalelo<Fila>(pagina, { tamano: 3, maximoPaginas: 500, concurrencia: 2 })
    expect(r.ok).toBe(false)
    expect(pedidos.length).toBeLessThan(20)
  })
})

// ----------------------------------------------------------------
// Consistencia bajo altas y bajas concurrentes (revisión de EPT-63)
// ----------------------------------------------------------------

type FilaMutable = { id: string; total_filas: number }

/**
 * Fuente con datos que cambian ENTRE pedidos. Cada pedido toma una foto del
 * conjunto en el momento de pedirlo (como una consulta de PostgreSQL en su propia
 * transacción) y responde después. `antesDelPedido(n, conjunto)` puede
 * agregar o quitar claves antes de que se tome la foto del pedido `n`.
 */
function fuenteMutable(
  inicial: number[],
  antesDelPedido: (n: number, conjunto: number[], leidas: Set<number>) => void,
  demora: (n: number) => number = () => 0
) {
  const conjunto = [...inicial].sort((a, b) => a - b)
  const leidas = new Set<number>()
  let pedidos = 0
  const pagina = async (desde: number, hasta: number) => {
    const n = pedidos
    pedidos += 1
    antesDelPedido(n, conjunto, leidas)
    conjunto.sort((a, b) => a - b)
    const claves = conjunto.slice(desde, hasta + 1)
    const foto = claves.map((k) => ({ id: `k-${k}`, total_filas: conjunto.length }))
    for (const k of claves) leidas.add(k)
    for (let i = 0; i < demora(n); i += 1) await Promise.resolve()
    return { data: foto as FilaMutable[], error: null }
  }
  return { pagina, conjunto }
}

/** PRNG determinista (mulberry32): la prueba es repetible. */
function aleatorio(semilla: number) {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test.describe('leerTodasLasFilasEnParalelo: altas y bajas a mitad de la lectura', () => {
  test('una baja ya leída y un alta al final con el MISMO total no dejan pasar una fila omitida', async () => {
    // 20 filas; tras leer la primera página se da de baja la 1 (ya leída) y se da de
    // alta la 99 (al final). El total sigue siendo 20, pero la fila 3 quedaría fuera.
    const inicial = Array.from({ length: 20 }, (_, i) => i)
    const { pagina } = fuenteMutable(inicial, (n, conjunto) => {
      if (n === 1) {
        conjunto.splice(conjunto.indexOf(1), 1)
        conjunto.push(99)
      }
    })
    const r = await leerTodasLasFilasEnParalelo<FilaMutable>(pagina, { tamano: 3, maximoPaginas: 100, concurrencia: 1 })
    if (r.ok) {
      const ids = r.datos.map((f) => f.id)
      // Si entrega un listado, no puede faltarle ninguna fila que existió siempre.
      for (const k of inicial.filter((k) => k !== 1)) expect(ids, `falta k-${k}`).toContain(`k-${k}`)
      expect(new Set(ids).size).toBe(ids.length)
    } else {
      expect(r.error?.code).toBe(ERROR_LECTURA_INCONSISTENTE)
    }
  })

  test('500 escenarios aleatorios: o error de inconsistencia, o cada fila estable exactamente una vez', async () => {
    let fallos = 0
    let entregados = 0
    let rechazados = 0
    for (let semilla = 1; semilla <= 500; semilla += 1) {
      const azar = aleatorio(semilla)
      const total = 5 + Math.floor(azar() * 60)
      const tamano = 2 + Math.floor(azar() * 6)
      const concurrencia = 1 + Math.floor(azar() * 4)
      const inicial = Array.from({ length: total }, (_, i) => (i + 1) * 10)
      const permanentes = new Set(inicial)
      let siguienteClave = 5
      const cambios = new Map<number, number>()
      for (let i = 0; i < 1 + Math.floor(azar() * 3); i += 1) cambios.set(1 + Math.floor(azar() * 6), i)

      const { pagina } = fuenteMutable(
        inicial,
        (n, conjunto, leidas) => {
          if (!cambios.has(n)) return
          // Una baja (casi siempre de una fila que el lector ya recibió) y un alta en
          // una posición al azar: el total puede quedar igual.
          const yaLeidas = conjunto.filter((k) => leidas.has(k))
          const elegibles = yaLeidas.length > 0 && azar() < 0.8 ? yaLeidas : conjunto
          const baja = elegibles[Math.floor(azar() * elegibles.length)]
          permanentes.delete(baja)
          conjunto.splice(conjunto.indexOf(baja), 1)
          // Casi siempre al final del orden: así el total no cambia y las filas no
          // leídas se corren un lugar (el caso que la comprobación de cantidad no ve).
          conjunto.push(azar() < 0.7 ? Math.max(...conjunto) + 10 : siguienteClave)
          siguienteClave += 10
        },
        (n) => Math.floor(azar() * 6) + (n % 2)
      )
      const r = await leerTodasLasFilasEnParalelo<FilaMutable>(pagina, { tamano, maximoPaginas: 1000, concurrencia })
      if (!r.ok) {
        if (r.error?.code !== ERROR_LECTURA_INCONSISTENTE) fallos += 1
        rechazados += 1
        continue
      }
      entregados += 1
      const ids = r.datos.map((f) => f.id)
      const unicos = new Set(ids)
      const faltan = [...permanentes].filter((k) => !unicos.has(`k-${k}`))
      if (unicos.size !== ids.length || faltan.length > 0) fallos += 1
    }
    expect(fallos, `escenarios con listado incompleto o repetido (entregados ${entregados}, rechazados ${rechazados})`).toBe(0)
  })
})
