import {
  agruparCargados,
  analizarRespuestaDeuda,
  centavosDeTexto,
  consultarDeudaItems,
  formatearCentavosExactos,
  TAMANO_PAGINA,
} from '@/servicios/deuda-items'
import { ErrorConsultaFamilia } from '@/servicios/consultas-familia'
import type { ClienteEPT } from '@/servicios/supabase'

type Objeto = Record<string, unknown>

const HUELLA = 'a'.repeat(32)

const item = (n: number, extra: Objeto = {}): Objeto => ({
  item_id: `i${n}`, factura_id: `f${n}`, periodo: '2026-01-01', vencimiento: '2026-01-10', tipo: 'CUOTA', grupo: 'CUOTA',
  concepto: 'Cuota', detalle: null, importe_centavos: '5000000', pagado_centavos: '0', saldo_centavos: '5000000',
  estado: 'VENCIDO', en_verificacion: false, vencido: true, inconsistente: false, factura_inconsistente: false,
  origen_estado: null, catalogo_activo: null, ...extra,
})

const grupo = (clave: string, tipo: string, concepto: string, items: number, conSaldo: number, importe: string, pagado: string, saldo: string): Objeto => ({
  clave, tipo, concepto, items, items_con_saldo: conSaldo, importe_centavos: importe, pagado_centavos: pagado, saldo_centavos: saldo,
})

/** Documento coherente por construcción: una cuota impaga de 50.000,00 y un deporte pagado. */
function documento(extra: Objeto = {}): Objeto {
  return {
    filas: [item(1), item(2, { tipo: 'DEPORTE', grupo: 'DEPORTE:d1', concepto: 'Fútbol', detalle: 'Grupo A', importe_centavos: '800000', pagado_centavos: '800000', saldo_centavos: '0', estado: 'PAGADO', vencido: false, origen_estado: 'ACTIVA', catalogo_activo: true })],
    total: 2, pagina: 1, tamano: TAMANO_PAGINA,
    totales: { items: 2, items_con_saldo: 1, importe_centavos: '5800000', pagado_centavos: '800000', adeudado_centavos: '5000000', facturas: 2, facturas_con_saldo: 1, hay_inconsistencias: false },
    grupos: [
      grupo('CUOTA', 'CUOTA', 'Cuota', 1, 1, '5000000', '0', '5000000'),
      grupo('DEPORTE:d1', 'DEPORTE', 'Fútbol', 1, 0, '800000', '800000', '0'),
    ],
    huella: HUELLA, leido_en: '2026-10-24T12:00:00Z', fecha_corte: '2026-10-24', periodo_desde: null, periodo_hasta: null,
    ...extra,
  }
}

const analizar = (d: unknown, pagina = 1) => analizarRespuestaDeuda(d, { pagina })
const rechaza = (d: unknown, pagina = 1) => expect(() => analizar(d, pagina)).toThrow(ErrorConsultaFamilia)

describe('centavosDeTexto', () => {
  it('lee enteros exactos más allá de la precisión segura de number', () => {
    expect(centavosDeTexto('9099999999990900', 'x')).toBe(9099999999990900n)
    expect(Number.isSafeInteger(Number('9099999999990900'))).toBe(false)
    expect(centavosDeTexto('0', 'x')).toBe(0n)
    expect(centavosDeTexto('-4000', 'x')).toBe(-4000n)
  })

  it.each([10.5, 10, null, undefined, '10.5', '1e3', '007', '-0', '', ' 5', '5 ', '+5', '0x10', '1'.repeat(31)])(
    'rechaza %p',
    valor => {
      expect(() => centavosDeTexto(valor, 'x')).toThrow(ErrorConsultaFamilia)
    },
  )
})

describe('analizarRespuestaDeuda', () => {
  it('acepta un documento coherente y lo convierte a bigint', () => {
    const r = analizar(documento())
    expect(r.tipo).toBe('pagina')
    if (r.tipo !== 'pagina') return
    expect(r.totales.adeudado).toBe(5000000n)
    expect(r.filas.map(f => f.itemId)).toEqual(['i1', 'i2'])
    expect(r.filas[1]).toMatchObject({ tipo: 'DEPORTE', concepto: 'Fútbol', detalle: 'Grupo A', saldo: 0n, estado: 'PAGADO' })
    expect(r.fechaCorte).toBe('2026-10-24')
  })

  it('un total agregado que supera 2^53 llega exacto', () => {
    const grande = '9099999999990900'
    const d = documento({
      filas: [item(1, { importe_centavos: '999999999999', saldo_centavos: '999999999999' })],
      total: 9100,
      tamano: TAMANO_PAGINA,
      totales: { items: 9100, items_con_saldo: 9100, importe_centavos: grande, pagado_centavos: '0', adeudado_centavos: grande, facturas: 9100, facturas_con_saldo: 9100, hay_inconsistencias: false },
      grupos: [grupo('CUOTA', 'CUOTA', 'Cuota', 9100, 9100, grande, '0', grande)],
    })
    // Una página de 50 de las 9.100 no puede traer una sola fila: la validación de página incompleta lo rechaza.
    rechaza(d)
    const pagina = documento({
      filas: Array.from({ length: 50 }, (_, i) => item(i + 1, { importe_centavos: '999999999999', saldo_centavos: '999999999999' })),
      total: 9100,
      totales: { items: 9100, items_con_saldo: 9100, importe_centavos: grande, pagado_centavos: '0', adeudado_centavos: grande, facturas: 9100, facturas_con_saldo: 9100, hay_inconsistencias: false },
      grupos: [grupo('CUOTA', 'CUOTA', 'Cuota', 9100, 9100, grande, '0', grande)],
    })
    const r = analizar(pagina)
    expect(r.tipo === 'pagina' && r.totales.adeudado).toBe(9099999999990900n)
    expect(r.tipo === 'pagina' && r.totales.adeudado > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('la señal de actualización solo transporta la huella', () => {
    expect(analizar({ actualizado: true, huella: 'b'.repeat(32) })).toEqual({ tipo: 'actualizado', huella: 'b'.repeat(32) })
    rechaza({ actualizado: true, huella: 'corta' })
  })

  it('rechaza un saldo que no es importe menos pagado, sin recortar ni corregir', () => {
    rechaza(documento({ filas: [item(1, { saldo_centavos: '0' }), documento().filas ? (documento().filas as Objeto[])[1] : {}] }))
    rechaza(documento({ filas: [item(1, { pagado_centavos: '6000000', saldo_centavos: '0' }), (documento().filas as Objeto[])[1]] }))
  })

  it('un saldo negativo coherente (sobrepago declarado) no se oculta ni se recorta', () => {
    const filas = [item(1, { importe_centavos: '5000000', pagado_centavos: '6000000', saldo_centavos: '-1000000', inconsistente: true, estado: 'PAGADO', vencido: false }), (documento().filas as Objeto[])[1]]
    const d = documento({
      filas,
      totales: { items: 2, items_con_saldo: 0, importe_centavos: '5800000', pagado_centavos: '6800000', adeudado_centavos: '-1000000', facturas: 2, facturas_con_saldo: 0, hay_inconsistencias: true },
      grupos: [grupo('CUOTA', 'CUOTA', 'Cuota', 1, 0, '5000000', '6000000', '-1000000'), grupo('DEPORTE:d1', 'DEPORTE', 'Fútbol', 1, 0, '800000', '800000', '0')],
    })
    const r = analizar(d)
    expect(r.tipo === 'pagina' && r.totales.adeudado).toBe(-1000000n)
    expect(r.tipo === 'pagina' && r.filas[0]?.saldo).toBe(-1000000n)
  })

  it('rechaza cifras que no cierran entre sí', () => {
    rechaza(documento({ totales: { ...(documento().totales as Objeto), adeudado_centavos: '4999999' } }))
    rechaza(documento({ totales: { ...(documento().totales as Objeto), importe_centavos: '5800001' } }))
    rechaza(documento({ grupos: [grupo('CUOTA', 'CUOTA', 'Cuota', 1, 1, '5000000', '0', '5000000'), grupo('DEPORTE:d1', 'DEPORTE', 'Fútbol', 1, 0, '800000', '800000', '1')] }))
    rechaza(documento({ total: 3 }))
    rechaza(documento({ totales: { ...(documento().totales as Objeto), items_con_saldo: 2 } }))
  })

  it('rechaza ítems repetidos, agrupaciones desconocidas y páginas incompletas', () => {
    const [a] = documento().filas as Objeto[]
    rechaza(documento({ filas: [a, a] }))
    rechaza(documento({ filas: [a, item(2, { grupo: 'DEPORTE:otro', tipo: 'DEPORTE' })] }))
    rechaza(documento({ filas: [a] }))
    rechaza(documento(), 2)
    rechaza(documento({ tamano: 25 }))
  })

  it('rechaza estados, tipos, fechas, huellas y booleanos inválidos', () => {
    const [, b] = documento().filas as Objeto[]
    rechaza(documento({ filas: [item(1, { estado: 'PARCIAL' }), b] }))
    rechaza(documento({ filas: [item(1, { tipo: 'MATRICULA', grupo: 'MATRICULA' }), b] }))
    rechaza(documento({ filas: [item(1, { periodo: '2026-02-30' }), b] }))
    rechaza(documento({ filas: [item(1, { vencido: 'no' }), b] }))
    rechaza(documento({ filas: [item(1, { origen_estado: 'PAUSADA' }), b] }))
    rechaza(documento({ filas: [item(1, { grupo: 'COMEDOR' }), b] }))
    rechaza(documento({ huella: 'XYZ' }))
    rechaza(documento({ fecha_corte: 'hoy' }))
    rechaza(null)
    rechaza([])
    rechaza('texto')
    rechaza(documento({ filas: 'no' }))
  })

  it('una página 3 con la cantidad exacta de filas restantes es válida', () => {
    const filas = Array.from({ length: 1 }, (_, i) => item(i + 101))
    const d = documento({
      filas, pagina: 3, total: 101,
      totales: { items: 101, items_con_saldo: 101, importe_centavos: '505000000', pagado_centavos: '0', adeudado_centavos: '505000000', facturas: 101, facturas_con_saldo: 101, hay_inconsistencias: false },
      grupos: [grupo('CUOTA', 'CUOTA', 'Cuota', 101, 101, '505000000', '0', '505000000')],
    })
    expect(analizar(d, 3).tipo).toBe('pagina')
    rechaza(d, 2)
  })
})

interface Llamada { nombre: string; args: Objeto; senal?: AbortSignal }

function clienteConRespuesta(respuesta: { data: unknown; error: unknown }): { cliente: ClienteEPT; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  const cliente = {
    rpc(nombre: string, args: Objeto) {
      const llamada: Llamada = { nombre, args }
      llamadas.push(llamada)
      const constructor = {
        abortSignal: (senal: AbortSignal) => { llamada.senal = senal; return constructor },
        then: (resolver: (v: unknown) => unknown, rechazar?: (e: unknown) => unknown) => Promise.resolve(respuesta).then(resolver, rechazar),
      }
      return constructor
    },
  } as unknown as ClienteEPT
  return { cliente, llamadas }
}

describe('consultarDeudaItems', () => {
  it('sin rango ni huella no envía fechas nulas: pide todo el historial', async () => {
    const { cliente, llamadas } = clienteConRespuesta({ data: documento(), error: null })
    const r = await consultarDeudaItems(cliente, 'a1', null, 1, null)
    expect(r.tipo).toBe('pagina')
    expect(llamadas).toEqual([{ nombre: 'historial_deuda_items', args: { p_alumno_id: 'a1', p_pagina: 1, p_tamano: 50 } }])
  })

  it('con rango y huella los envía tal cual y comprueba el mes aplicado por el servidor', async () => {
    const { cliente, llamadas } = clienteConRespuesta({ data: documento({ periodo_desde: '2025-12-01', periodo_hasta: '2026-01-01' }), error: null })
    await consultarDeudaItems(cliente, 'a1', { desde: '2025-12-15', hasta: '2026-01-02' }, 1, HUELLA)
    expect(llamadas[0]?.args).toEqual({ p_alumno_id: 'a1', p_desde: '2025-12-15', p_hasta: '2026-01-02', p_pagina: 1, p_tamano: 50, p_huella: HUELLA })
  })

  it('rechaza una respuesta cuyo período aplicado no corresponde al pedido', async () => {
    const { cliente } = clienteConRespuesta({ data: documento({ periodo_desde: '2025-11-01', periodo_hasta: '2026-01-01' }), error: null })
    await expect(consultarDeudaItems(cliente, 'a1', { desde: '2025-12-15', hasta: '2026-01-02' }, 1, null)).rejects.toMatchObject({ causa: 'respuesta' })
    const sinRango = clienteConRespuesta({ data: documento({ periodo_desde: '2025-11-01', periodo_hasta: null }), error: null })
    // Sin rango el servidor no aplica período: no hay nada que contrastar y la respuesta se valida por su forma.
    await expect(consultarDeudaItems(sinRango.cliente, 'a1', null, 1, null)).resolves.toMatchObject({ tipo: 'pagina' })
  })

  it('pasa la señal de cancelación', async () => {
    const control = new AbortController()
    const { cliente, llamadas } = clienteConRespuesta({ data: documento(), error: null })
    await consultarDeudaItems(cliente, 'a1', null, 1, null, control.signal)
    expect(llamadas[0]?.senal).toBe(control.signal)
  })

  it.each([
    [{ code: 'P6871', message: 'x' }, 'rango'],
    [{ code: 'P6870', message: 'x' }, 'rango'],
    [{ code: '22008', message: 'x' }, 'rango'],
    [{ code: '42501', message: 'x' }, 'permiso'],
    [{ code: 'PGRST301', message: 'x' }, 'permiso'],
    [{ code: 'P6872', message: 'x' }, 'respuesta'],
    [{ message: 'Failed to fetch' }, 'red'],
  ])('clasifica el error %p como %s', async (error, causa) => {
    const { cliente } = clienteConRespuesta({ data: null, error })
    await expect(consultarDeudaItems(cliente, 'a1', null, 1, null)).rejects.toMatchObject({ causa })
  })
})

describe('formatearCentavosExactos', () => {
  it('formatea sin pasar por number', () => {
    expect(formatearCentavosExactos(0n)).toBe('ARS 0,00')
    expect(formatearCentavosExactos(5n)).toBe('ARS 0,05')
    expect(formatearCentavosExactos(5000000n)).toBe('ARS 50.000,00')
    expect(formatearCentavosExactos(9099999999990900n)).toBe('ARS 90.999.999.999.909,00')
    expect(formatearCentavosExactos(-1000000n)).toBe('-ARS 10.000,00')
    expect(formatearCentavosExactos(123456789012345678n)).toBe('ARS 1.234.567.890.123.456,78')
  })
})

describe('agruparCargados', () => {
  it('reparte lo cargado según las agrupaciones del servidor, también las que aún no tienen filas', () => {
    const r = analizar(documento())
    if (r.tipo !== 'pagina') throw new Error('se esperaba una página')
    const visible = agruparCargados(r.grupos, [r.filas[0]!])
    expect(visible.map(v => [v.grupo.clave, v.items.length])).toEqual([['CUOTA', 1], ['DEPORTE:d1', 0]])
  })
})
