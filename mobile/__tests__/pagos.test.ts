import {
  analizarCotizacion,
  analizarPago,
  cargarItemsPagables,
  clasificarFallo,
  consultarIntentoPago,
  cotizarPago,
  generarClaveIntento,
  motivoDe,
  registrarPago,
  seleccionCanonica,
} from '@/servicios/pagos'
import type { ClienteEPT } from '@/servicios/supabase'

const A = '11111111-1111-4111-8111-111111111111'
const F1 = '22222222-2222-4222-8222-222222222221'
const F2 = '22222222-2222-4222-8222-222222222222'
const I1 = '33333333-3333-4333-8333-333333333331'
const I2 = '33333333-3333-4333-8333-333333333332'
const P = '44444444-4444-4444-8444-444444444444'

const banco = {
  ficticio: true,
  banco: 'Banco de Prueba Institucional',
  titular: 'Educar para Transformar (datos de prueba)',
  cuit: '00-00000000-0',
  tipo_cuenta: 'Cuenta corriente en pesos',
  cbu: '0000000000000000000000',
  alias: 'EPT.DATOS.FICTICIOS',
  aviso: 'Datos ficticios de prueba.',
}
const linea = (item: string, factura: string, tipo: string, centavos: number) => ({
  item_id: item, factura_id: factura, periodo: '2026-11-01', tipo, importe_centavos: centavos,
})
const cotizacionCruda = () => ({
  alumno_id: A, moneda: 'ARS', total_centavos: 5800000,
  items: [linea(I1, F1, 'CUOTA', 5000000), linea(I2, F1, 'DEPORTE', 800000)], banco,
})
const pagoCrudo = (extra = {}) => ({
  pago_id: P, estado: 'PENDIENTE_VERIFICACION', alumno_id: A, total_centavos: 5800000,
  creado_en: '2026-11-02T12:00:00+00:00', repetido: false,
  items: [linea(I1, F1, 'CUOTA', 5000000), linea(I2, F1, 'DEPORTE', 800000)], banco, ...extra,
})

/** Cliente mínimo: `rpc` devuelve lo que la prueba indique; las lecturas devuelven filas fijas. */
function clienteRpc(respuesta: unknown): { cliente: ClienteEPT; llamadas: { nombre: string; args: unknown }[] } {
  const llamadas: { nombre: string; args: unknown }[] = []
  const cliente = {
    rpc(nombre: string, args: unknown) {
      llamadas.push({ nombre, args })
      const construido = {
        abortSignal: () => construido,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          (typeof respuesta === 'function' ? Promise.resolve().then(respuesta as () => unknown) : Promise.resolve(respuesta)).then(ok, ko),
      }
      return construido
    },
  } as unknown as ClienteEPT
  return { cliente, llamadas }
}

describe('analizarCotizacion y analizarPago', () => {
  it('acepta una respuesta coherente con importes en centavos', () => {
    const c = analizarCotizacion(cotizacionCruda())
    expect(c.totalCentavos).toBe(5800000)
    expect(c.items.map(i => i.itemId)).toEqual([I1, I2])
    expect(c.banco.ficticio).toBe(true)
    expect(analizarPago(pagoCrudo()).estado).toBe('PENDIENTE_VERIFICACION')
  })

  it('rechaza un total que no cierra con sus ítems, sin corregirlo', () => {
    expect(() => analizarCotizacion({ ...cotizacionCruda(), total_centavos: 5800001 })).toThrow(/total/u)
    expect(() => analizarPago(pagoCrudo({ total_centavos: 1 }))).toThrow(/total/u)
  })

  it('rechaza importes decimales, no seguros o negativos', () => {
    expect(() => analizarCotizacion({ ...cotizacionCruda(), total_centavos: 5800000.5 })).toThrow()
    expect(() => analizarCotizacion({ ...cotizacionCruda(), total_centavos: Number.MAX_SAFE_INTEGER + 2 })).toThrow()
    expect(() => analizarCotizacion({ ...cotizacionCruda(), total_centavos: -1 })).toThrow()
    expect(() => analizarCotizacion({ ...cotizacionCruda(), total_centavos: '5800000' })).toThrow()
  })

  it('rechaza un pago que no está pendiente de verificación o sin ítems', () => {
    expect(() => analizarPago(pagoCrudo({ estado: 'APROBADO' }))).toThrow()
    expect(() => analizarPago(pagoCrudo({ items: [] }))).toThrow()
    expect(() => analizarPago(pagoCrudo({ pago_id: 'no-es-uuid' }))).toThrow()
  })
})

describe('clasificarFallo', () => {
  it('un 4xx con código de la función es un rechazo confirmado', () => {
    expect(clasificarFallo({ code: 'P6853' }, 400)).toEqual({ tipo: 'rechazado', codigo: 'P6853' })
    expect(clasificarFallo({ code: 'P6857' }, 400)).toEqual({ tipo: 'rechazado', codigo: 'P6857' })
    expect(clasificarFallo({ code: '42501' }, 403)).toEqual({ tipo: 'rechazado', codigo: 'DENEGADO' })
    expect(clasificarFallo({ code: 'PGRST301' }, 401)).toEqual({ tipo: 'rechazado', codigo: 'DENEGADO' })
    expect(clasificarFallo({ code: 'XX' }, 404)).toEqual({ tipo: 'rechazado', codigo: 'OTRO' })
  })

  it('sin red, 5xx o estado ilegible es incierto: nunca se asume que no se registró', () => {
    expect(clasificarFallo({ code: 'TypeError' }, 0)).toEqual({ tipo: 'incierto' })
    expect(clasificarFallo({ code: 'AbortError' }, 0)).toEqual({ tipo: 'incierto' })
    expect(clasificarFallo({ code: '' }, 500)).toEqual({ tipo: 'incierto' })
    expect(clasificarFallo({ code: 'P6853' }, 503)).toEqual({ tipo: 'incierto' })
    expect(clasificarFallo({}, Number.NaN)).toEqual({ tipo: 'incierto' })
  })
})

describe('motivoDe', () => {
  const base = { importeCentavos: 5000000, pagadoCentavos: 0, estadoPago: 'PENDIENTE' as const }
  it('solo es seleccionable un ítem pendiente, con cargo y en una cuota coherente', () => {
    expect(motivoDe(base, false)).toBeNull()
    expect(motivoDe({ ...base, estadoPago: 'PAGADO', pagadoCentavos: 5000000 }, false)).toBe('PAGADO')
    expect(motivoDe({ ...base, estadoPago: 'EN_VERIFICACION' }, false)).toBe('EN_VERIFICACION')
    expect(motivoDe({ ...base, importeCentavos: 0 }, false)).toBe('SIN_CARGO')
    expect(motivoDe(base, true)).toBe('REVISAR')
  })
})

describe('seleccionCanonica y generarClaveIntento', () => {
  it('ordena y elimina duplicados: el contenido del intento no depende del orden de toque', () => {
    expect(seleccionCanonica([I2, I1, I2])).toEqual([I1, I2])
  })

  it('genera UUID v4 distintos', () => {
    const claves = new Set(Array.from({ length: 50 }, () => generarClaveIntento()))
    expect(claves.size).toBe(50)
    for (const clave of claves) expect(clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  })
})

describe('operaciones del servidor', () => {
  it('cotizar envía solo identificadores canónicos, nunca importes ni estados', async () => {
    const { cliente, llamadas } = clienteRpc({ data: cotizacionCruda(), error: null, status: 200 })
    const r = await cotizarPago(cliente, [I2, I1])
    expect(r.tipo).toBe('ok')
    expect(llamadas).toEqual([{ nombre: 'cotizar_pago', args: { p_item_ids: [I1, I2] } }])
  })

  it('cotizar distingue rechazo confirmado de error de red', async () => {
    const rechazo = clienteRpc({ data: null, error: { code: 'P6853', message: 'x' }, status: 400 })
    expect(await cotizarPago(rechazo.cliente, [I1])).toEqual({ tipo: 'rechazada', codigo: 'P6853' })
    const red = clienteRpc({ data: null, error: { code: 'TypeError', message: 'x' }, status: 0 })
    expect(await cotizarPago(red.cliente, [I1])).toEqual({ tipo: 'error' })
  })

  it('registrar: éxito, rechazo confirmado e incierto (respuesta ilegible o excepción)', async () => {
    const ok = clienteRpc({ data: pagoCrudo(), error: null, status: 200 })
    const r = await registrarPago(ok.cliente, P, [I2, I1], 5800000)
    expect(r.tipo).toBe('registrado')
    expect(ok.llamadas[0]).toEqual({
      nombre: 'registrar_pago',
      args: { p_clave_intento: P, p_item_ids: [I1, I2], p_total_esperado_centavos: 5800000 },
    })

    const rechazo = clienteRpc({ data: null, error: { code: 'P6857' }, status: 400 })
    expect(await registrarPago(rechazo.cliente, P, [I1], 1)).toEqual({ tipo: 'rechazado', codigo: 'P6857' })

    const ilegible = clienteRpc({ data: { cualquier: 'cosa' }, error: null, status: 200 })
    expect(await registrarPago(ilegible.cliente, P, [I1], 1)).toEqual({ tipo: 'incierto' })

    const red = clienteRpc({ data: null, error: { code: 'TypeError' }, status: 0 })
    expect(await registrarPago(red.cliente, P, [I1], 1)).toEqual({ tipo: 'incierto' })

    const lanza = clienteRpc(() => { throw new Error('fallo') })
    expect(await registrarPago(lanza.cliente, P, [I1], 1)).toEqual({ tipo: 'incierto' })
  })

  it('consultar el intento: registrado, no registrado y error', async () => {
    const si = clienteRpc({ data: { registrado: true, ...pagoCrudo({ repetido: true }) }, error: null, status: 200 })
    const r = await consultarIntentoPago(si.cliente, P)
    expect(r.tipo).toBe('registrado')
    const no = clienteRpc({ data: { registrado: false }, error: null, status: 200 })
    expect(await consultarIntentoPago(no.cliente, P)).toEqual({ tipo: 'no_registrado' })
    const mal = clienteRpc({ data: { registrado: 'tal vez' }, error: null, status: 200 })
    expect(await consultarIntentoPago(mal.cliente, P)).toEqual({ tipo: 'error' })
    const error = clienteRpc({ data: null, error: { code: '' }, status: 500 })
    expect(await consultarIntentoPago(error.cliente, P)).toEqual({ tipo: 'error' })
  })
})

describe('cargarItemsPagables', () => {
  type Fila = Record<string, unknown>
  const cuota = (id: string, estado: string, extra: Fila = {}): Fila => ({
    factura_id: id, alumno_id: A, periodo: '2026-11-01', vencimiento: '2026-11-10', total_centavos: 5800000,
    pagado_centavos: 0, saldo_centavos: 5800000, estado, items_en_verificacion: 0, inconsistente: false,
    fecha_corte: '2026-11-11', ...extra,
  })
  const item = (id: string, factura: string, tipo: string, importe: number, estadoPago: string, pagado = 0): Fila => ({
    item_id: id, factura_id: factura, alumno_id: A, tipo, importe_centavos: importe, pagado_centavos: pagado, estado_pago: estadoPago,
  })
  function cliente(cuotas: Fila[], items: Fila[]): ClienteEPT {
    return {
      from(tabla: string) {
        const filas = tabla === 'estado_cuotas_alumno' ? cuotas : items
        const c = {
          select: () => c, eq: () => c, order: () => c, abortSignal: () => c,
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve({ data: filas, error: null }).then(ok, ko),
        }
        return c
      },
    } as unknown as ClienteEPT
  }

  it('excluye facturas pagadas y marca el motivo de cada ítem no seleccionable', async () => {
    const grupos = await cargarItemsPagables(
      cliente(
        [cuota(F1, 'PENDIENTE', { items_en_verificacion: 1 }), cuota(F2, 'PAGADA', { saldo_centavos: 0 })],
        [
          item(I1, F1, 'CUOTA', 5000000, 'PENDIENTE'),
          item(I2, F1, 'DEPORTE', 800000, 'EN_VERIFICACION'),
          item('33333333-3333-4333-8333-333333333333', F1, 'TRANSPORTE', 0, 'PENDIENTE'),
          item('33333333-3333-4333-8333-333333333334', F2, 'CUOTA', 5000000, 'PAGADO', 5000000),
        ],
      ),
      A,
    )
    expect(grupos).toHaveLength(1)
    expect(grupos[0]?.items.map(i => [i.tipo, i.motivo])).toEqual([
      ['CUOTA', null], ['DEPORTE', 'EN_VERIFICACION'], ['TRANSPORTE', 'SIN_CARGO'],
    ])
  })

  it('una cuota inconsistente no permite seleccionar sus ítems', async () => {
    const grupos = await cargarItemsPagables(
      cliente([cuota(F1, 'PENDIENTE', { inconsistente: true })], [item(I1, F1, 'CUOTA', 5000000, 'PENDIENTE')]),
      A,
    )
    expect(grupos[0]?.items[0]?.motivo).toBe('REVISAR')
  })

  it('falla cerrado si la respuesta trae filas de otro estudiante', async () => {
    await expect(
      cargarItemsPagables(cliente([cuota(F1, 'PENDIENTE', { alumno_id: P })], []), A),
    ).rejects.toThrow()
  })
})
