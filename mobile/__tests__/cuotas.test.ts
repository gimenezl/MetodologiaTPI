import {
  analizarCuota,
  analizarItem,
  centavosExactos,
  consultarCuotas,
  consultarDetalleCuota,
  ErrorConsultaCuotas,
  etiquetaPeriodo,
  formatearFecha,
  separarPorPestana,
  type Cuota,
} from '@/servicios/cuotas'
import type { ClienteEPT } from '@/servicios/supabase'

const FILA = {
  factura_id: 'f1',
  alumno_id: 'a1',
  periodo: '2026-11-01',
  vencimiento: '2026-11-10',
  total_centavos: 5800000,
  pagado_centavos: 5000000,
  saldo_centavos: 800000,
  estado: 'VENCIDA',
  items_en_verificacion: 0,
  inconsistente: false,
  fecha_corte: '2026-11-11',
}

interface Llamada { tabla: string; filtros: Record<string, unknown>; senal?: AbortSignal }

function clienteFalso(respuestas: Record<string, { data?: unknown[]; error?: unknown }>, llamadas: Llamada[] = []): ClienteEPT {
  return {
    from(tabla: string) {
      const llamada: Llamada = { tabla, filtros: {} }
      llamadas.push(llamada)
      const constructor = {
        select: () => constructor,
        eq: (columna: string, valor: unknown) => {
          llamada.filtros[columna] = valor
          return constructor
        },
        order: () => constructor,
        abortSignal: (senal: AbortSignal) => {
          llamada.senal = senal
          return constructor
        },
        then: (resolver: (v: unknown) => unknown) => Promise.resolve(respuestas[tabla] ?? { data: [], error: null }).then(r => ({ data: r.data ?? null, error: r.error ?? null })).then(resolver),
      }
      return constructor
    },
  } as unknown as ClienteEPT
}

describe('importes exactos', () => {
  it('acepta centavos enteros y rechaza decimales, texto y valores inseguros', () => {
    expect(centavosExactos(1999, 'x')).toBe(1999)
    expect(() => centavosExactos(19.99, 'x')).toThrow(ErrorConsultaCuotas)
    expect(() => centavosExactos('1999', 'x')).toThrow(ErrorConsultaCuotas)
    expect(() => centavosExactos(Number.MAX_SAFE_INTEGER + 2, 'x')).toThrow(ErrorConsultaCuotas)
    expect(() => centavosExactos(NaN, 'x')).toThrow(ErrorConsultaCuotas)
  })

  it('suma de importes largos sin pérdida (límite NUMERIC(12,2))', () => {
    const maximo = 999999999999
    const cuota = analizarCuota({ ...FILA, total_centavos: maximo, pagado_centavos: 0, saldo_centavos: maximo })
    expect(cuota.totalCentavos + 1).toBe(1000000000000)
  })
})

describe('análisis de filas', () => {
  it('convierte una fila válida', () => {
    expect(analizarCuota(FILA)).toMatchObject({ facturaId: 'f1', estado: 'VENCIDA', saldoCentavos: 800000 })
  })

  it('rechaza estados y conceptos desconocidos en lugar de inventarlos', () => {
    expect(() => analizarCuota({ ...FILA, estado: 'APROBADO' })).toThrow(ErrorConsultaCuotas)
    expect(() => analizarItem({ item_id: 'i', tipo: 'MORA', importe_centavos: 1, pagado_centavos: 0, estado_pago: 'PENDIENTE' })).toThrow(ErrorConsultaCuotas)
    expect(() => analizarCuota({ ...FILA, periodo: '01/11/2026' })).toThrow(ErrorConsultaCuotas)
  })

  it('un saldo negativo del servidor se conserva tal cual (no se normaliza)', () => {
    expect(analizarCuota({ ...FILA, saldo_centavos: -500, inconsistente: true })).toMatchObject({ saldoCentavos: -500, inconsistente: true })
  })
})

describe('pestañas y etiquetas', () => {
  const cuota = (estado: Cuota['estado']): Cuota => ({ ...analizarCuota({ ...FILA, estado }) })

  it('Pendientes reúne Pendiente, Pago parcial y Vencida; Pagadas solo saldadas', () => {
    const { pendientes, pagadas } = separarPorPestana([cuota('PENDIENTE'), cuota('PAGO_PARCIAL'), cuota('VENCIDA'), cuota('PAGADA')])
    expect(pendientes.map(c => c.estado)).toEqual(['PENDIENTE', 'PAGO_PARCIAL', 'VENCIDA'])
    expect(pagadas.map(c => c.estado)).toEqual(['PAGADA'])
  })

  it('formatea período y fecha sin depender de la zona horaria del dispositivo', () => {
    expect(etiquetaPeriodo('2026-11-01')).toBe('noviembre de 2026')
    expect(etiquetaPeriodo('2026-01-01')).toBe('enero de 2026')
    expect(formatearFecha('2026-11-10')).toBe('10/11/2026')
  })
})

describe('consulta contra el servidor', () => {
  it('filtra por alumno, ordena y propaga la señal de cancelación', async () => {
    const llamadas: Llamada[] = []
    const control = new AbortController()
    const cliente = clienteFalso({ estado_cuotas_alumno: { data: [FILA] } }, llamadas)
    const cuotas = await consultarCuotas(cliente, 'a1', control.signal)
    expect(cuotas).toHaveLength(1)
    expect(llamadas[0]?.tabla).toBe('estado_cuotas_alumno')
    expect(llamadas[0]?.filtros).toEqual({ alumno_id: 'a1' })
    expect(llamadas[0]?.senal).toBe(control.signal)
  })

  it('un identificador ajeno devuelve lista vacía (RLS), nunca datos de otro alumno', async () => {
    const cliente = clienteFalso({ estado_cuotas_alumno: { data: [] } })
    await expect(consultarCuotas(cliente, 'ajeno')).resolves.toEqual([])
  })

  it('defensa en profundidad: rechaza filas de otro alumno', async () => {
    const cliente = clienteFalso({ estado_cuotas_alumno: { data: [{ ...FILA, alumno_id: 'otro' }] } })
    await expect(consultarCuotas(cliente, 'a1')).rejects.toThrow(ErrorConsultaCuotas)
  })

  it('un error de transporte no deja datos parciales', async () => {
    const cliente = clienteFalso({ estado_cuotas_alumno: { error: { message: 'x' } } })
    await expect(consultarCuotas(cliente, 'a1')).rejects.toThrow(/conexión/u)
  })

  it('detalle: ordena conceptos y consulta por alumno y factura', async () => {
    const llamadas: Llamada[] = []
    const items = [
      { item_id: 'i2', tipo: 'COMEDOR', importe_centavos: 100, pagado_centavos: 0, estado_pago: 'PENDIENTE' },
      { item_id: 'i1', tipo: 'CUOTA', importe_centavos: 5000000, pagado_centavos: 5000000, estado_pago: 'PAGADO' },
      { item_id: 'i3', tipo: 'DEPORTE', importe_centavos: 800000, pagado_centavos: 0, estado_pago: 'EN_VERIFICACION' },
    ]
    const cliente = clienteFalso({ estado_cuotas_alumno: { data: [FILA] }, detalle_cuotas_items: { data: items } }, llamadas)
    const detalle = await consultarDetalleCuota(cliente, 'a1', 'f1')
    expect(detalle?.items.map(i => i.tipo)).toEqual(['CUOTA', 'DEPORTE', 'COMEDOR'])
    expect(llamadas.map(l => l.filtros)).toEqual([
      { alumno_id: 'a1', factura_id: 'f1' },
      { alumno_id: 'a1', factura_id: 'f1' },
    ])
  })

  it('detalle de una factura ajena o inexistente devuelve null', async () => {
    const cliente = clienteFalso({ estado_cuotas_alumno: { data: [] }, detalle_cuotas_items: { data: [] } })
    await expect(consultarDetalleCuota(cliente, 'a1', 'f-ajena')).resolves.toBeNull()
  })
})
