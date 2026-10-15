import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native'

import { PagoContenedor } from '@/contenedores/pagos/PagoContenedor'
import { CuotasContenedor } from '@/contenedores/cuotas/CuotasContenedor'
import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import { guardarIntentoPendiente, leerIntentoPendiente } from '@/servicios/intento-pago'
import type { ClienteEPT } from '@/servicios/supabase'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

type Fila = Record<string, unknown>
interface RpcPendiente {
  nombre: string
  args: Record<string, unknown>
  senal?: AbortSignal
  resolver: (r: { data: unknown; error: unknown; status: number }) => void
}

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '11111111-1111-4111-8111-111111111112'
const F1 = '22222222-2222-4222-8222-222222222221'
const F2 = '22222222-2222-4222-8222-222222222222'
const I1 = '33333333-3333-4333-8333-333333333331'
const I2 = '33333333-3333-4333-8333-333333333332'
const I3 = '33333333-3333-4333-8333-333333333333'
const I4 = '33333333-3333-4333-8333-333333333334'
const P = '44444444-4444-4444-8444-444444444444'
const CLAVE = '55555555-5555-4555-8555-555555555555'

const BANCO = {
  ficticio: true,
  banco: 'Banco de Prueba Institucional',
  titular: 'Educar para Transformar (datos de prueba)',
  cuit: '00-00000000-0',
  tipo_cuenta: 'Cuenta corriente en pesos',
  cbu: '0000000000000000000000',
  alias: 'EPT.DATOS.FICTICIOS',
  aviso: 'Datos ficticios de prueba. No son una cuenta real.',
}

const cuota = (id: string, alumno: string, estado: string, extra: Fila = {}): Fila => ({
  factura_id: id, alumno_id: alumno, periodo: '2026-11-01', vencimiento: '2026-11-10', total_centavos: 7692545,
  pagado_centavos: 0, saldo_centavos: 7692545, estado, items_en_verificacion: 0, inconsistente: false,
  fecha_corte: '2026-11-11', ...extra,
})
const item = (id: string, factura: string, alumno: string, tipo: string, importe: number, estadoPago: string): Fila => ({
  item_id: id, factura_id: factura, alumno_id: alumno, tipo, importe_centavos: importe,
  pagado_centavos: estadoPago === 'PAGADO' ? importe : 0, estado_pago: estadoPago,
})
const linea = (id: string, factura: string, tipo: string, importe: number): Fila => ({
  item_id: id, factura_id: factura, periodo: '2026-11-01', tipo, importe_centavos: importe,
})

const FILAS_CUOTAS: Fila[] = [cuota(F1, A1, 'PENDIENTE', { items_en_verificacion: 1 }), cuota(F2, A1, 'VENCIDA')]
const FILAS_ITEMS: Fila[] = [
  item(I1, F1, A1, 'CUOTA', 5000000, 'PENDIENTE'),
  item(I2, F1, A1, 'DEPORTE', 800000, 'PENDIENTE'),
  item(I3, F1, A1, 'TRANSPORTE', 1892545, 'EN_VERIFICACION'),
  item(I4, F2, A1, 'COMEDOR', 0, 'PENDIENTE'),
]

const cotizacion = (ids: string[], total: number): Fila => ({
  alumno_id: A1, moneda: 'ARS', total_centavos: total, banco: BANCO,
  items: ids.map(id => (id === I1 ? linea(I1, F1, 'CUOTA', 5000000) : linea(I2, F1, 'DEPORTE', 800000))),
})
const pagoRegistrado = (ids: string[], total: number, repetido = false): Fila => ({
  pago_id: P, estado: 'PENDIENTE_VERIFICACION', alumno_id: A1, total_centavos: total,
  creado_en: '2026-11-02T12:00:00+00:00', repetido, banco: BANCO,
  items: ids.map(id => (id === I1 ? linea(I1, F1, 'CUOTA', 5000000) : linea(I2, F1, 'DEPORTE', 800000))),
})

function clienteControlado() {
  const rpcs: RpcPendiente[] = []
  const cliente = {
    from(tabla: string) {
      const filas = tabla === 'estado_cuotas_alumno' ? FILAS_CUOTAS : FILAS_ITEMS
      const c = {
        select: () => c, eq: () => c, order: () => c, abortSignal: () => c,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve({ data: filas, error: null }).then(ok, ko),
      }
      return c
    },
    rpc(nombre: string, args: Record<string, unknown> = {}) {
      const p: Partial<RpcPendiente> = { nombre, args }
      const c = {
        abortSignal: (senal: AbortSignal) => { p.senal = senal; return c },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (nombre === 'datos_bancarios_transferencia') {
            return Promise.resolve({ data: BANCO, error: null, status: 200 }).then(ok, ko)
          }
          return new Promise(resuelto => { rpcs.push({ ...p, resolver: resuelto } as RpcPendiente) }).then(ok, ko)
        },
      }
      return c
    },
  } as unknown as ClienteEPT
  return { cliente, rpcs }
}

async function responder(rpcs: RpcPendiente[], nombre: string, data: unknown, error: unknown = null, status = 200): Promise<RpcPendiente> {
  const i = rpcs.findLastIndex(r => r.nombre === nombre && !r.senal?.aborted)
  if (i < 0) throw new Error(`No hay ${nombre} pendiente`)
  const [r] = rpcs.splice(i, 1)
  await act(async () => { r?.resolver({ data: error ? null : data, error, status }) })
  return r as RpcPendiente
}

function memoria(): AlmacenamientoSeguro {
  const datos = new Map<string, string>()
  return {
    getItem: async k => datos.get(k) ?? null,
    setItem: async (k, v) => { datos.set(k, v) },
    removeItem: async k => { datos.delete(k) },
  }
}

const HIJOS = [{ id: A1, etiqueta: 'Ana Pérez' }, { id: A2, etiqueta: 'Luis Pérez' }]

async function abrir(extra: { almacenamiento?: AlmacenamientoSeguro; usuarioId?: string; onVolver?: (h: boolean) => void } = {}) {
  const base = clienteControlado()
  const almacenamiento = extra.almacenamiento ?? memoria()
  const onVolver = extra.onVolver ?? jest.fn()
  await render(
    <PagoContenedor
      cliente={base.cliente}
      usuarioId={extra.usuarioId ?? U}
      alumnoId={A1}
      alumnos={HIJOS}
      almacenamiento={almacenamiento}
      onVolver={onVolver}
      generarClave={() => CLAVE}
    />,
  )
  await waitFor(() => expect(screen.getByTestId(`item-${I1}`)).toBeTruthy())
  return { ...base, almacenamiento, onVolver }
}

describe('PagoContenedor', () => {
  it('muestra los ítems con su motivo, sin permitir marcar los pagados, en verificación o sin cargo', async () => {
    const { rpcs } = await abrir()
    expect(screen.getByText('Pagar ítems')).toBeTruthy()
    expect(screen.getByText('Los ítems pagados o en verificación no se pueden seleccionar.')).toBeTruthy()
    expect(screen.getByText('Tiene un pago en verificación.')).toBeTruthy()
    expect(screen.getByText('Sin cargo: no hay nada para pagar.')).toBeTruthy()
    await fireEvent.press(screen.getByTestId(`item-${I3}`))
    await fireEvent.press(screen.getByTestId(`item-${I4}`))
    expect(rpcs.filter(r => r.nombre === 'cotizar_pago')).toHaveLength(0)
    expect(screen.getByText('Seleccioná al menos un ítem para continuar.')).toBeTruthy()
    expect(screen.getByText('Datos de prueba')).toBeTruthy()
    expect(screen.getByText('No se acepta pago en efectivo.')).toBeTruthy()
  })

  it('el total mostrado es el que calcula el servidor y registrar no se habilita hasta tenerlo', async () => {
    const { rpcs } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await fireEvent.press(screen.getByTestId(`item-${I2}`))
    // Mientras el servidor no responde no hay cifra confiable ni registro posible.
    expect(screen.getByText('Calculando el total en el servidor…')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(false)

    const cotizada = await responder(rpcs, 'cotizar_pago', cotizacion([I1, I2], 5800000))
    expect(cotizada.args).toEqual({ p_item_ids: [I1, I2] })
    expect(screen.getAllByText('ARS 58.000,00').length).toBeGreaterThan(0)
    expect(screen.getByText('2 ítems seleccionados · calculado por el sistema')).toBeTruthy()
  })

  it('registra una sola vez aunque se toque dos veces y muestra Pendiente de verificación', async () => {
    const { rpcs, almacenamiento } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(true))
    expect(rpcs.filter(r => r.nombre === 'registrar_pago')).toHaveLength(1)
    // El intento queda guardado mientras el desenlace es desconocido.
    expect(await leerIntentoPendiente(almacenamiento, U)).toMatchObject({ claveIntento: CLAVE, alumnoId: A1, totalCentavos: 5000000 })

    const envio = await responder(rpcs, 'registrar_pago', pagoRegistrado([I1], 5000000))
    expect(envio.args).toEqual({ p_clave_intento: CLAVE, p_item_ids: [I1], p_total_esperado_centavos: 5000000 })
    expect(screen.getByText('Pago registrado: pendiente de verificación.')).toBeTruthy()
    expect(screen.getByText('Pendiente de verificación')).toBeTruthy()
    expect(screen.getByText('Código del pago: 44444444')).toBeTruthy()
    expect(screen.getByText('El ítem queda en verificación y el saldo no cambia hasta que la institución apruebe el pago.')).toBeTruthy()
    expect(await leerIntentoPendiente(almacenamiento, U)).toBeNull()
  })

  it('un conflicto confirmado no registra nada y devuelve a una selección actualizada', async () => {
    const { rpcs, almacenamiento } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(true))
    await responder(rpcs, 'registrar_pago', null, { code: 'P6853', message: 'x' }, 400)
    expect(screen.getByText('No se registró el pago')).toBeTruthy()
    expect(screen.getByText(/ya fue pagado o tiene un pago en verificación/u)).toBeTruthy()
    expect(await leerIntentoPendiente(almacenamiento, U)).toBeNull()
    await fireEvent.press(screen.getByTestId('volver-seleccion'))
    await waitFor(() => expect(screen.getByTestId(`item-${I1}`)).toBeTruthy())
    expect(screen.getByText('Seleccioná al menos un ítem para continuar.')).toBeTruthy()
  })

  it('resultado incierto: no se reenvía hasta verificar, y si no se registró reintenta con la MISMA clave', async () => {
    const { rpcs, almacenamiento } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(true))
    await responder(rpcs, 'registrar_pago', null, { code: 'TypeError', message: 'Network request failed' }, 0)

    expect(screen.getByText('No pudimos confirmar el pago')).toBeTruthy()
    expect(screen.queryByTestId('registrar-pago')).toBeNull()
    expect(await leerIntentoPendiente(almacenamiento, U)).toMatchObject({ claveIntento: CLAVE })

    await fireEvent.press(screen.getByTestId('verificar-intento'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'consultar_intento_pago')).toBe(true))
    const consulta = await responder(rpcs, 'consultar_intento_pago', { registrado: false })
    expect(consulta.args).toEqual({ p_clave_intento: CLAVE })
    expect(screen.getByText('El pago no llegó a registrarse')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('reintentar-intento'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(true))
    const reintento = await responder(rpcs, 'registrar_pago', pagoRegistrado([I1], 5000000))
    expect(reintento.args).toEqual({ p_clave_intento: CLAVE, p_item_ids: [I1], p_total_esperado_centavos: 5000000 })
    expect(screen.getByText('Pago registrado: pendiente de verificación.')).toBeTruthy()
  })

  it('respuesta perdida después del COMMIT: verificar recupera el pago sin duplicarlo', async () => {
    const { rpcs } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(true))
    await responder(rpcs, 'registrar_pago', null, { code: '' , message: 'x' }, 500)
    await fireEvent.press(screen.getByTestId('verificar-intento'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'consultar_intento_pago')).toBe(true))
    await responder(rpcs, 'consultar_intento_pago', { registrado: true, ...pagoRegistrado([I1], 5000000, true) })
    expect(screen.getByText('Pago registrado: pendiente de verificación.')).toBeTruthy()
    expect(screen.getByText('Este pago ya estaba registrado: no se duplicó.')).toBeTruthy()
    expect(rpcs.filter(r => r.nombre === 'registrar_pago')).toHaveLength(0)
  })

  it('un fallo al verificar sigue sin permitir un envío nuevo', async () => {
    const { rpcs } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(true))
    await responder(rpcs, 'registrar_pago', null, { code: 'TypeError' }, 0)
    await fireEvent.press(screen.getByTestId('verificar-intento'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'consultar_intento_pago')).toBe(true))
    await responder(rpcs, 'consultar_intento_pago', null, { code: 'TypeError' }, 0)
    expect(screen.getByText(/No pudimos verificar el resultado/u)).toBeTruthy()
    expect(screen.queryByTestId('registrar-pago')).toBeNull()
    expect(screen.getByTestId('verificar-intento')).toBeTruthy()
  })

  it('una cotización atrasada no se aplica a otra selección', async () => {
    const { rpcs } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    const primera = rpcs.find(r => r.nombre === 'cotizar_pago')
    await fireEvent.press(screen.getByTestId(`item-${I1}`)) // se desmarca
    await fireEvent.press(screen.getByTestId(`item-${I2}`))
    expect(primera?.senal?.aborted).toBe(true)
    await act(async () => { primera?.resolver({ data: cotizacion([I1], 5000000), error: null, status: 200 }) })
    const total = within(screen.getByTestId('total-a-transferir'))
    expect(total.queryByText('ARS 50.000,00')).toBeNull()
    await responder(rpcs, 'cotizar_pago', cotizacion([I2], 800000))
    expect(total.getByText('ARS 8.000,00')).toBeTruthy()
    expect(screen.getByText('1 ítem seleccionado · calculado por el sistema')).toBeTruthy()
  })

  it('al cambiar la selección el total anterior deja de valer y no se puede registrar con él', async () => {
    const { rpcs } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    const total = within(screen.getByTestId('total-a-transferir'))
    expect(total.getByText('ARS 50.000,00')).toBeTruthy()
    await fireEvent.press(screen.getByTestId(`item-${I2}`))
    // La cifra anterior no se muestra para la selección nueva y registrar queda bloqueado hasta recotizar.
    expect(total.queryByText('ARS 50.000,00')).toBeNull()
    expect(screen.getByText('Calculando el total en el servidor…')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(false)
    await responder(rpcs, 'cotizar_pago', cotizacion([I1, I2], 5800000))
    expect(total.getByText('ARS 58.000,00')).toBeTruthy()
  })

  it('un total que cambió se informa sin registrar y permite recotizar', async () => {
    const { rpcs } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    await fireEvent.press(screen.getByTestId('registrar-pago'))
    await waitFor(() => expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(true))
    await responder(rpcs, 'registrar_pago', null, { code: 'P6857' }, 400)
    expect(screen.getByText(/El total cambió desde que lo viste/u)).toBeTruthy()
  })

  it('volver antes de confirmar no escribe nada', async () => {
    const { rpcs, onVolver, almacenamiento } = await abrir()
    await fireEvent.press(screen.getByTestId(`item-${I1}`))
    await responder(rpcs, 'cotizar_pago', cotizacion([I1], 5000000))
    await fireEvent.press(screen.getByTestId('volver-cuotas-pago'))
    expect(onVolver).toHaveBeenCalledWith(false)
    expect(rpcs.some(r => r.nombre === 'registrar_pago')).toBe(false)
    expect(await leerIntentoPendiente(almacenamiento, U)).toBeNull()
  })

  it('al reabrir recupera un intento pendiente de la MISMA cuenta y lo verifica antes de enviar algo', async () => {
    const almacenamiento = memoria()
    await guardarIntentoPendiente(almacenamiento, {
      usuarioId: U, alumnoId: A1, claveIntento: CLAVE, itemIds: [I1], totalCentavos: 5000000, creadoEn: '2026-11-02T12:00:00.000Z',
    })
    const base = clienteControlado()
    await render(
      <PagoContenedor cliente={base.cliente} usuarioId={U} alumnoId={A1} alumnos={HIJOS} almacenamiento={almacenamiento} onVolver={() => undefined} />,
    )
    await waitFor(() => expect(screen.getByText('No pudimos confirmar el pago')).toBeTruthy())
    expect(base.rpcs.some(r => r.nombre === 'registrar_pago')).toBe(false)
    await fireEvent.press(screen.getByTestId('verificar-intento'))
    await waitFor(() => expect(base.rpcs.some(r => r.nombre === 'consultar_intento_pago')).toBe(true))
    await responder(base.rpcs, 'consultar_intento_pago', { registrado: true, ...pagoRegistrado([I1], 5000000, true) })
    expect(screen.getByText('Pago registrado: pendiente de verificación.')).toBeTruthy()
    expect(await leerIntentoPendiente(almacenamiento, U)).toBeNull()
  })

  it('un intento guardado por otra cuenta no aparece', async () => {
    const almacenamiento = memoria()
    await guardarIntentoPendiente(almacenamiento, {
      usuarioId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', alumnoId: A1, claveIntento: CLAVE, itemIds: [I1], totalCentavos: 5000000, creadoEn: 'x',
    })
    await abrir({ almacenamiento })
    expect(screen.queryByText('No pudimos confirmar el pago')).toBeNull()
    expect(screen.getByText('Seleccioná al menos un ítem para continuar.')).toBeTruthy()
  })

  it('un intento pendiente de otro hijo de la misma cuenta se advierte sin bloquear la lectura', async () => {
    const almacenamiento = memoria()
    await guardarIntentoPendiente(almacenamiento, {
      usuarioId: U, alumnoId: A2, claveIntento: CLAVE, itemIds: [I1], totalCentavos: 5000000, creadoEn: 'x',
    })
    await abrir({ almacenamiento })
    expect(screen.getByText('Hay un pago sin confirmar de otro estudiante.')).toBeTruthy()
  })

  it('error de carga: reintento sin mostrar datos', async () => {
    const rpcs: RpcPendiente[] = []
    let fallar = true
    const cliente = {
      from() {
        const c = {
          select: () => c, eq: () => c, order: () => c, abortSignal: () => c,
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve(fallar ? { data: null, error: { message: 'red' } } : { data: [], error: null }).then(ok, ko),
        }
        return c
      },
      rpc() {
        const c = {
          abortSignal: () => c,
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve({ data: BANCO, error: null, status: 200 }).then(ok, ko),
        }
        return c
      },
    } as unknown as ClienteEPT
    await render(
      <PagoContenedor cliente={cliente} usuarioId={U} alumnoId={A1} alumnos={HIJOS} almacenamiento={memoria()} onVolver={() => undefined} />,
    )
    await waitFor(() => expect(screen.getByText('No pudimos cargar los ítems')).toBeTruthy())
    fallar = false
    await fireEvent.press(screen.getByText('Reintentar'))
    await waitFor(() => expect(screen.getByText('No hay ítems para pagar')).toBeTruthy())
    expect(rpcs).toHaveLength(0)
  })
})

describe('CuotasContenedor con pagos', () => {
  const almacenamiento = memoria()

  it('el padre abre «Pagar ítems» y al volver tras registrar recarga el listado', async () => {
    const base = clienteControlado()
    await render(
      <CuotasContenedor
        cliente={base.cliente}
        alumnos={[HIJOS[0]!]}
        mostrarSelector
        pagos={{ usuarioId: U, almacenamiento }}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('pagar-items')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('pagar-items'))
    await waitFor(() => expect(screen.getByTestId(`item-${I1}`)).toBeTruthy())
    await fireEvent.press(screen.getByTestId('volver-cuotas-pago'))
    await waitFor(() => expect(screen.getByTestId('pagar-items')).toBeTruthy())
  })

  it('sin habilitación de pagos (estudiante) no existe la acción ni la pantalla', async () => {
    const base = clienteControlado()
    await render(<CuotasContenedor cliente={base.cliente} alumnos={[HIJOS[0]!]} mostrarSelector={false} />)
    await waitFor(() => expect(screen.getByTestId(`cuota-${F1}`)).toBeTruthy())
    expect(screen.queryByTestId('pagar-items')).toBeNull()
    expect(screen.queryByText('Pagar ítems')).toBeNull()
  })
})
