import { expect, test } from '@playwright/test'
import {
  ERROR_LIMITE_DE_PAGINAS,
  MAXIMO_FILAS,
  MAXIMO_PAGINAS,
  TAMANO_PAGINA,
  leerTodasLasFilas,
} from '../src/lib/paginacion'

/**
 * Lectura paginada de los listados administrativos (EPT-62): el borde de la cota
 * y el resto del contrato, sin navegador ni base de datos.
 *
 * `fuente(total, tope)` simula PostgREST sobre `total` filas con identificadores
 * consecutivos; `tope` reproduce un servidor cuyo `max_rows` es menor que la página
 * pedida. Registra cada pedido para comprobar que los rangos son contiguos.
 */

type Fila = { id: string }
type Pedido = { desde: number; hasta: number }

function fuente(total: number, tope = Number.POSITIVE_INFINITY) {
  const pedidos: Pedido[] = []
  const pagina = async (desde: number, hasta: number) => {
    pedidos.push({ desde, hasta })
    const fin = Math.min(hasta + 1, total, desde + tope)
    const data: Fila[] = []
    for (let i = desde; i < fin; i += 1) data.push({ id: `fila-${i}` })
    return { data, error: null }
  }
  return { pagina, pedidos }
}

const OPCIONES = { tamano: 3, maximoPaginas: 4 }

test.describe('leerTodasLasFilas', () => {
  test('los valores por defecto son 1000 filas por página y 500 páginas', () => {
    expect(TAMANO_PAGINA).toBe(1000)
    expect(MAXIMO_PAGINAS).toBe(500)
    expect(MAXIMO_FILAS).toBe(500_000)
  })

  test('sin filas devuelve una lectura vacía con un solo pedido', async () => {
    const { pagina, pedidos } = fuente(0)
    const resultado = await leerTodasLasFilas<Fila>(pagina, OPCIONES)
    expect(resultado).toEqual({ ok: true, datos: [] })
    expect(pedidos).toHaveLength(1)
  })

  test('una página incompleta termina con un pedido de comprobación vacío', async () => {
    const { pagina, pedidos } = fuente(2)
    const resultado = await leerTodasLasFilas<Fila>(pagina, OPCIONES)
    expect(resultado.ok && resultado.datos.map((f) => f.id)).toEqual(['fila-0', 'fila-1'])
    expect(pedidos).toEqual([
      { desde: 0, hasta: 2 },
      { desde: 2, hasta: 4 },
    ])
  })

  test('los rangos son contiguos y no dejan huecos ni repeticiones', async () => {
    const { pagina, pedidos } = fuente(8)
    const resultado = await leerTodasLasFilas<Fila>(pagina, OPCIONES)
    expect(resultado.ok && resultado.datos).toHaveLength(8)
    expect(resultado.ok && new Set(resultado.datos.map((f) => f.id)).size).toBe(8)
    expect(pedidos).toEqual([
      { desde: 0, hasta: 2 },
      { desde: 3, hasta: 5 },
      { desde: 6, hasta: 8 },
      { desde: 8, hasta: 10 },
    ])
  })

  test('BORDE: exactamente maximoPaginas páginas llenas es una lectura válida y completa', async () => {
    const total = OPCIONES.tamano * OPCIONES.maximoPaginas // 12
    const { pagina, pedidos } = fuente(total)
    const resultado = await leerTodasLasFilas<Fila>(pagina, OPCIONES)
    expect(resultado.ok).toBe(true)
    expect(resultado.ok && resultado.datos).toHaveLength(total)
    // Cuatro páginas con datos y un pedido más que comprueba que no queda nada.
    expect(pedidos).toHaveLength(OPCIONES.maximoPaginas + 1)
  })

  test('BORDE: una sola fila más allá de la cota falla en lugar de recortar', async () => {
    const total = OPCIONES.tamano * OPCIONES.maximoPaginas + 1 // 13
    const { pagina } = fuente(total)
    const resultado = await leerTodasLasFilas<Fila>(pagina, OPCIONES)
    expect(resultado).toEqual({ ok: false, error: { code: ERROR_LIMITE_DE_PAGINAS } })
  })

  test('BORDE: maximoPaginas páginas con la última incompleta también es válida', async () => {
    const total = OPCIONES.tamano * (OPCIONES.maximoPaginas - 1) + 1 // 10
    const { pagina } = fuente(total)
    const resultado = await leerTodasLasFilas<Fila>(pagina, OPCIONES)
    expect(resultado.ok && resultado.datos).toHaveLength(total)
  })

  test('un servidor con un tope menor que la página no pierde filas', async () => {
    const { pagina, pedidos } = fuente(7, 2)
    const resultado = await leerTodasLasFilas<Fila>(pagina, OPCIONES)
    expect(resultado.ok && resultado.datos.map((f) => f.id)).toEqual(
      Array.from({ length: 7 }, (_, i) => `fila-${i}`)
    )
    expect(pedidos.map((p) => p.desde)).toEqual([0, 2, 4, 6, 7])
  })

  test('las filas repetidas por una alta concurrente se descartan por identificador', async () => {
    const paginas = [
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'c' }, { id: 'd' }],
      [],
    ]
    let llamada = 0
    const resultado = await leerTodasLasFilas<Fila>(
      async () => ({ data: paginas[llamada++], error: null }),
      OPCIONES
    )
    expect(resultado.ok && resultado.datos.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('un error en cualquier página devuelve ese error y ninguna fila parcial', async () => {
    let llamada = 0
    const resultado = await leerTodasLasFilas<Fila>(async (desde) => {
      llamada += 1
      if (llamada === 3) return { data: null, error: { code: '57014' } }
      return { data: [{ id: `x${desde}` }, { id: `y${desde}` }, { id: `z${desde}` }], error: null }
    }, OPCIONES)
    expect(resultado).toEqual({ ok: false, error: { code: '57014' } })
  })

  test('cota real: exactamente 500 páginas de 1000 filas (500 000) se leen completas', async () => {
    test.setTimeout(60_000)
    const { pagina, pedidos } = fuente(MAXIMO_FILAS)
    const resultado = await leerTodasLasFilas<Fila>(pagina)
    expect(resultado.ok).toBe(true)
    expect(resultado.ok && resultado.datos).toHaveLength(MAXIMO_FILAS)
    expect(pedidos).toHaveLength(MAXIMO_PAGINAS + 1)
  })

  test('cota real: 500 001 filas fallan con el código de límite', async () => {
    test.setTimeout(60_000)
    const { pagina } = fuente(MAXIMO_FILAS + 1)
    const resultado = await leerTodasLasFilas<Fila>(pagina)
    expect(resultado).toEqual({ ok: false, error: { code: ERROR_LIMITE_DE_PAGINAS } })
  })
})
