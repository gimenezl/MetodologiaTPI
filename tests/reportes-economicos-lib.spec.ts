import { expect, test } from '@playwright/test'
import {
  REPORTES_ECONOMICOS,
  argumentosEconomicos,
  dineroEconomico,
  fechaEconomica,
  leerConsultaEconomica,
  urlConsultaEconomica,
} from '../src/lib/reportes-economicos'

test('cinco reportes económicos separados de los académicos', () => {
  expect(Object.keys(REPORTES_ECONOMICOS)).toEqual(['ingresos', 'completos', 'incompletos', 'deportes', 'recorridos'])
})
for (const consulta of [
  'desde=2030-02-30&hasta=2030-03-01',
  'desde=2030-04-01&hasta=2030-03-01',
  'desde=2030-01-01&hasta=2030-12-31&pagina=0',
  'desde=2030-01-01&hasta=2030-12-31&tamano=1000',
  'desde=2030-01-01&desde=2030-02-01&hasta=2030-12-31',
  'desde=2030-01-01&hasta=2030-12-31&actor=',
  'desde=2030-01-01&hasta=2030-12-31&deporte=b1120000-0000-4000-8000-000000000001',
]) {
  test(`rechaza consulta inválida ${consulta}`, () =>
    expect(leerConsultaEconomica('ingresos', new URLSearchParams(consulta)).ok).toBe(false))
}
test('fechas inclusivas, moneda exacta y referencias de página', () => {
  const resultado = leerConsultaEconomica(
    'ingresos',
    new URLSearchParams('desde=2028-02-29&hasta=2028-02-29&curso=Primero')
  )
  expect(resultado.ok).toBe(true)
  if (!resultado.ok) return
  expect(argumentosEconomicos('ingresos', resultado.consulta)).toMatchObject({
    p_desde: '2028-02-29',
    p_hasta: '2028-02-29',
    p_filtros: { curso: 'Primero' },
    p_pagina: 1,
  })
  expect(urlConsultaEconomica(resultado.consulta, { pagina: 2 }).get('curso')).toBe('Primero')
  expect(fechaEconomica('2030-01-01')).toBe('01/01/2030')
  expect(dineroEconomico('999999999999999999')).toBe('$ 9.999.999.999.999.999,99')
  expect(dineroEconomico('-1')).toBe('-$ 0,01')
  expect(dineroEconomico('0')).toBe('$ 0,00')
  expect(dineroEconomico(null)).toBe('No atribuible')
  expect(() => dineroEconomico('1.01')).toThrow()
})
