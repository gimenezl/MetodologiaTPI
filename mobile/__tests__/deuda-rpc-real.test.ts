import { readFileSync } from 'node:fs'
import { analizarRespuestaDeuda, TAMANO_PAGINA } from '@/servicios/deuda-items'

// El gate JS no tiene DB; Android invoca esta misma prueba con respuestas Auth/RLS reales de `historial_deuda_items`.
const archivo = process.env.EPT_DEUDA_RPC_FIXTURE
const comprobar = archivo ? test : test.skip
comprobar('contrato RPC real: la respuesta del servidor atraviesa el analizador móvil y sus cifras cierran', () => {
  const [completo, abril, vacio] = JSON.parse(readFileSync(archivo!, 'utf8')) as unknown[]

  const total = analizarRespuestaDeuda(completo, { pagina: 1 })
  if (total.tipo !== 'pagina') throw new Error('se esperaba una página')
  expect(total.tamano).toBe(TAMANO_PAGINA)
  expect(total.filas).toHaveLength(5)
  expect(total.totales.adeudado).toBe(7700000n)
  expect(total.totales.facturasConSaldo).toBe(2)
  expect(total.grupos.map(g => [g.tipo, g.concepto])).toEqual([
    ['CUOTA', 'Cuota'], ['DEPORTE', 'Fútbol'], ['TRANSPORTE', 'Recorrido Sur (ficticio)'], ['COMEDOR', 'Comedor escolar'],
  ])
  // La cuota de marzo está pagada con el importe imputado, no con el informado por la familia.
  const pagado = total.filas.find(f => f.estado === 'PAGADO')
  expect(pagado).toMatchObject({ tipo: 'CUOTA', importe: 5000000n, pagado: 5000000n, saldo: 0n })
  expect(total.filas.filter(f => f.saldo > 0n).map(f => f.tipo).sort()).toEqual(['COMEDOR', 'CUOTA', 'DEPORTE', 'TRANSPORTE'])
  expect(total.filas.reduce((n, f) => n + f.saldo, 0n)).toBe(total.totales.adeudado)

  const filtrado = analizarRespuestaDeuda(abril, { pagina: 1 })
  if (filtrado.tipo !== 'pagina') throw new Error('se esperaba una página')
  expect(filtrado.periodoDesde).toBe('2030-04-01')
  expect(filtrado.periodoHasta).toBe('2030-04-01')
  expect(filtrado.totales.adeudado).toBe(6900000n)

  const sinItems = analizarRespuestaDeuda(vacio, { pagina: 1 })
  if (sinItems.tipo !== 'pagina') throw new Error('se esperaba una página')
  expect(sinItems.filas).toHaveLength(0)
  expect(sinItems.grupos).toHaveLength(0)
  expect(sinItems.totales.adeudado).toBe(0n)
})
