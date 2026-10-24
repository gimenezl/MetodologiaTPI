import { useState } from 'react'
import { AppState } from 'react-native'
import { act, fireEvent, render, screen, within } from '@testing-library/react-native'

import { CONTEXTO_DEUDA_VACIO, DeudaContenedor, type ContextoDeuda } from '@/contenedores/deuda/DeudaContenedor'
import type { ClienteEPT } from '@/servicios/supabase'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

type Objeto = Record<string, unknown>
interface Pendiente {
  nombre: string
  args: Objeto
  senal?: AbortSignal
  resolver: (r: { data: unknown; error: unknown }) => void
}

/** Cliente cuyas RPC quedan pendientes hasta que la prueba las resuelve (respuestas tardías y fuera de orden). */
function clienteControlado(): { cliente: ClienteEPT; pendientes: Pendiente[] } {
  const pendientes: Pendiente[] = []
  const cliente = {
    rpc(nombre: string, args: Objeto) {
      const p: Omit<Pendiente, 'resolver'> = { nombre, args }
      const constructor = {
        abortSignal: (senal: AbortSignal) => { (p as Pendiente).senal = senal; return constructor },
        then: (resolver: (v: unknown) => unknown, rechazar?: (e: unknown) => unknown) =>
          new Promise<{ data: unknown; error: unknown }>(resuelto => {
            pendientes.push({ ...p, resolver: resuelto })
          }).then(resolver, rechazar),
      }
      return constructor
    },
  } as unknown as ClienteEPT
  return { cliente, pendientes }
}

const HIJOS = [
  { id: 'a1', etiqueta: 'Ana Pérez' },
  { id: 'a2', etiqueta: 'Luis Pérez' },
]

interface Spec { n: number; tipo?: string; grupo?: string; concepto?: string; periodo?: string; importe: bigint; pagado?: bigint; extra?: Objeto }
const ORDEN: Record<string, number> = { CUOTA: 1, DEPORTE: 2, TRANSPORTE: 3, COMEDOR: 4 }

/**
 * Documento del servidor construido a mano para la prueba (el oráculo es esta función, no el código bajo prueba).
 * `todos` es el conjunto filtrado completo; `pagina` y `tamano` eligen qué porción devuelve.
 */
function documento(todos: Spec[], { pagina = 1, tamano = 50, huella = 'a'.repeat(32), periodoDesde = null as string | null, periodoHasta = null as string | null } = {}): Objeto {
  const filas = todos.map(s => {
    const tipo = s.tipo ?? 'CUOTA'
    const pagado = s.pagado ?? 0n
    const saldo = s.importe - pagado
    return {
      item_id: `i${s.n}`, factura_id: `f${s.n}`, periodo: s.periodo ?? '2026-01-01', vencimiento: '2026-01-10', tipo,
      grupo: s.grupo ?? tipo, concepto: s.concepto ?? (tipo === 'CUOTA' ? 'Cuota' : tipo), detalle: null,
      importe_centavos: String(s.importe), pagado_centavos: String(pagado), saldo_centavos: String(saldo),
      estado: saldo <= 0n ? 'PAGADO' : 'VENCIDO', en_verificacion: false, vencido: saldo > 0n, inconsistente: false,
      factura_inconsistente: false, origen_estado: null, catalogo_activo: null, ...s.extra,
    }
  })
  const claves = [...new Set(filas.map(f => f.grupo))]
  const grupos = claves.map(clave => {
    const g = filas.filter(f => f.grupo === clave)
    const importe = g.reduce((n, f) => n + BigInt(f.importe_centavos), 0n)
    const pagado = g.reduce((n, f) => n + BigInt(f.pagado_centavos), 0n)
    return {
      clave, tipo: g[0]!.tipo, concepto: g[0]!.concepto, items: g.length, items_con_saldo: g.filter(f => BigInt(f.saldo_centavos) > 0n).length,
      importe_centavos: String(importe), pagado_centavos: String(pagado), saldo_centavos: String(importe - pagado),
    }
  }).sort((x, y) => (ORDEN[x.tipo] ?? 9) - (ORDEN[y.tipo] ?? 9))
  const importe = filas.reduce((n, f) => n + BigInt(f.importe_centavos), 0n)
  const pagado = filas.reduce((n, f) => n + BigInt(f.pagado_centavos), 0n)
  const ordenadas = [...filas].sort((x, y) => (ORDEN[x.tipo] ?? 9) - (ORDEN[y.tipo] ?? 9))
  return {
    filas: ordenadas.slice((pagina - 1) * tamano, pagina * tamano),
    total: filas.length, pagina, tamano,
    totales: {
      items: filas.length, items_con_saldo: filas.filter(f => BigInt(f.saldo_centavos) > 0n).length,
      importe_centavos: String(importe), pagado_centavos: String(pagado), adeudado_centavos: String(importe - pagado),
      facturas: new Set(filas.map(f => f.factura_id)).size, facturas_con_saldo: new Set(filas.filter(f => BigInt(f.saldo_centavos) > 0n).map(f => f.factura_id)).size,
      hay_inconsistencias: false,
    },
    grupos, huella, leido_en: '2026-10-24T12:00:00Z', fecha_corte: '2026-10-24', periodo_desde: periodoDesde, periodo_hasta: periodoHasta,
  }
}

async function responder(pendientes: Pendiente[], alumno: string, data: unknown, error: unknown = null, criterio?: (p: Pendiente) => boolean): Promise<void> {
  const i = pendientes.findLastIndex(p => p.args.p_alumno_id === alumno && !p.senal?.aborted && (criterio?.(p) ?? true))
  if (i < 0) throw new Error(`No hay RPC pendiente para ${alumno}`)
  const [p] = pendientes.splice(i, 1)
  await act(async () => { p?.resolver({ data: error ? null : data, error }) })
}

const CUOTA = 5000000n

function Controlado({ cliente, alumnos = HIJOS, mostrarSelector = true }: { cliente: ClienteEPT; alumnos?: typeof HIJOS; mostrarSelector?: boolean }) {
  const [contexto, setContexto] = useState<ContextoDeuda>(CONTEXTO_DEUDA_VACIO)
  return <DeudaContenedor cliente={cliente} alumnos={alumnos} mostrarSelector={mostrarSelector} contexto={contexto} onContexto={setContexto} />
}

async function escribir(testID: string, texto: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId(testID), texto)
}

const textoDe = (testID: string): string => {
  const nodo = screen.getByTestId(testID)
  return within(nodo).getAllByText(/ARS/u).map(n => String(n.props.children)).join('|')
}

describe('DeudaContenedor', () => {
  it('padre: al abrir pide todo el historial del primer hijo, agrupa por ítem y muestra el total adeudado sin acciones de escritura', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    expect(screen.getByText('Consultando la deuda…')).toBeTruthy()
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0]).toMatchObject({ nombre: 'historial_deuda_items', args: { p_alumno_id: 'a1', p_pagina: 1, p_tamano: 50 } })
    expect(pendientes[0]?.args).not.toHaveProperty('p_desde')
    await responder(pendientes, 'a1', documento([
      { n: 1, importe: CUOTA, pagado: CUOTA, periodo: '2026-01-01' },
      { n: 2, importe: CUOTA, periodo: '2026-02-01' },
      { n: 3, tipo: 'DEPORTE', grupo: 'DEPORTE:fut', concepto: 'Fútbol', importe: 800000n },
      { n: 4, tipo: 'DEPORTE', grupo: 'DEPORTE:nat', concepto: 'Natación', importe: 900000n },
      { n: 5, tipo: 'TRANSPORTE', grupo: 'TRANSPORTE:sur', concepto: 'Recorrido Sur', importe: 1200000n },
      { n: 6, tipo: 'COMEDOR', concepto: 'Comedor escolar', importe: 700000n },
    ]))
    // 50.000,00 + 8.000,00 + 9.000,00 + 12.000,00 + 7.000,00 = 86.000,00 (la primera cuota está pagada).
    expect(textoDe('deuda-total')).toBe('ARS 86.000,00')
    // Cada deporte es una agrupación propia; no hay un bloque indistinto «Deportes».
    for (const clave of ['CUOTA', 'DEPORTE:fut', 'DEPORTE:nat', 'TRANSPORTE:sur', 'COMEDOR']) expect(screen.getByTestId(`deuda-grupo-${clave}`)).toBeTruthy()
    expect(screen.queryByText('Deportes')).toBeNull()
    expect(within(screen.getByTestId('deuda-grupo-DEPORTE:fut')).getAllByText('ARS 8.000,00').length).toBeGreaterThan(0)
    expect(within(screen.getByTestId('deuda-grupo-DEPORTE:nat')).getAllByText('ARS 9.000,00').length).toBeGreaterThan(0)
    // El ítem pagado conserva su historial con saldo cero.
    const pagado = within(screen.getByTestId('deuda-item-i1'))
    expect(pagado.getByLabelText('Estado: Pagado')).toBeTruthy()
    expect(pagado.getByText('Cuota · enero de 2026')).toBeTruthy()
    expect(pagado.getAllByText('ARS 0,00').length).toBeGreaterThan(0)
    expect(screen.getByText('Ítems con saldo')).toBeTruthy()
    // Ítems con saldo y facturas con saldo: cada ítem de este caso es de una factura distinta.
    expect(screen.getAllByText('5 de 6')).toHaveLength(2)
    // Solo consulta.
    expect(screen.queryByRole('button', { name: /pagar|registrar|comprobante|cancelar|inscrib|aprobar|seleccionar/iu })).toBeNull()
  })

  it('un total que supera la precisión segura de JavaScript se muestra exacto', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const grande = Array.from({ length: 50 }, (_, i) => ({ n: i + 1, importe: 999999999999n, periodo: '2026-01-01' }))
    const d = documento(grande)
    // 9.100 ítems en total: el total global lo calcula el servidor, la página solo trae 50.
    const enorme = '9099999999990900'
    ;(d.totales as Objeto).items = 9100; (d.totales as Objeto).items_con_saldo = 9100; (d.totales as Objeto).importe_centavos = enorme
    ;(d.totales as Objeto).adeudado_centavos = enorme; (d.totales as Objeto).facturas = 9100; (d.totales as Objeto).facturas_con_saldo = 9100
    d.total = 9100
    ;(d.grupos as Objeto[])[0]!.items = 9100; (d.grupos as Objeto[])[0]!.items_con_saldo = 9100
    ;(d.grupos as Objeto[])[0]!.importe_centavos = enorme; (d.grupos as Objeto[])[0]!.saldo_centavos = enorme
    await responder(pendientes, 'a1', d)
    expect(textoDe('deuda-total')).toBe('ARS 90.999.999.999.909,00')
    expect(screen.getByText('Mostrando 50 de 9100 ítems. El total adeudado incluye todos.')).toBeTruthy()
  })

  it('«Mostrar más ítems» pide la página siguiente con la huella de la primera y agrega sin duplicar', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const todos: Spec[] = Array.from({ length: 51 }, (_, i) => ({ n: i + 1, importe: CUOTA, periodo: '2026-01-01' }))
    await responder(pendientes, 'a1', documento(todos, { pagina: 1, huella: 'b'.repeat(32) }))
    expect(screen.getByText('Mostrando 50 de 51 ítems. El total adeudado incluye todos.')).toBeTruthy()
    // El total ya es el global (51 × 50.000,00), aun con la página parcial.
    expect(textoDe('deuda-total')).toBe('ARS 2.550.000,00')
    await fireEvent.press(screen.getByTestId('deuda-mas'))
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0]?.args).toMatchObject({ p_alumno_id: 'a1', p_pagina: 2, p_huella: 'b'.repeat(32) })
    expect(screen.getByText('Cargando más ítems…')).toBeTruthy()
    await responder(pendientes, 'a1', documento(todos, { pagina: 2, huella: 'b'.repeat(32) }))
    expect(screen.queryByText(/Mostrando/u)).toBeNull()
    expect(screen.queryByTestId('deuda-mas')).toBeNull()
    expect(screen.getAllByTestId(/^deuda-item-/u)).toHaveLength(51)
    expect(textoDe('deuda-total')).toBe('ARS 2.550.000,00')
  })

  it('si el servidor avisa que el contenido cambió, descarta lo acumulado y vuelve a la primera página', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const todos: Spec[] = Array.from({ length: 51 }, (_, i) => ({ n: i + 1, importe: CUOTA }))
    await responder(pendientes, 'a1', documento(todos, { huella: 'b'.repeat(32) }))
    await fireEvent.press(screen.getByTestId('deuda-mas'))
    await responder(pendientes, 'a1', { actualizado: true, huella: 'c'.repeat(32) })
    expect(screen.getByText('Consultando la deuda…')).toBeTruthy()
    expect(screen.queryByTestId('deuda-item-i1')).toBeNull()
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0]?.args).toMatchObject({ p_pagina: 1 })
    expect(pendientes[0]?.args).not.toHaveProperty('p_huella')
    await responder(pendientes, 'a1', documento(todos.slice(0, 10), { huella: 'c'.repeat(32) }))
    expect(screen.getAllByTestId(/^deuda-item-/u)).toHaveLength(10)
  })

  it('un fallo al cargar más conserva lo mostrado, avisa y permite reintentar', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const todos: Spec[] = Array.from({ length: 51 }, (_, i) => ({ n: i + 1, importe: CUOTA }))
    await responder(pendientes, 'a1', documento(todos))
    await fireEvent.press(screen.getByTestId('deuda-mas'))
    await responder(pendientes, 'a1', null, { message: 'Failed to fetch' })
    expect(screen.getByText('No pudimos cargar más ítems. Intentá nuevamente.')).toBeTruthy()
    expect(screen.getAllByTestId(/^deuda-item-/u)).toHaveLength(50)
    await fireEvent.press(screen.getByTestId('deuda-mas'))
    await responder(pendientes, 'a1', documento(todos, { pagina: 2 }))
    expect(screen.getAllByTestId(/^deuda-item-/u)).toHaveLength(51)
    expect(screen.queryByText('No pudimos cargar más ítems. Intentá nuevamente.')).toBeNull()
  })

  it('una página siguiente con un total distinto o repetida se rechaza: no mezcla versiones', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const todos: Spec[] = Array.from({ length: 51 }, (_, i) => ({ n: i + 1, importe: CUOTA }))
    await responder(pendientes, 'a1', documento(todos))
    await fireEvent.press(screen.getByTestId('deuda-mas'))
    await responder(pendientes, 'a1', documento([...todos, { n: 99, importe: CUOTA }], { pagina: 2 }))
    expect(screen.getByText('No pudimos cargar más ítems. Intentá nuevamente.')).toBeTruthy()
    expect(screen.getAllByTestId(/^deuda-item-/u)).toHaveLength(50)
  })

  it('una respuesta tardía de otro hijo, aun cancelada, nunca pisa al hijo vigente', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const primera = pendientes.find(p => p.args.p_alumno_id === 'a1')
    await fireEvent.press(screen.getByTestId('deuda-hijo-a2'))
    expect(primera?.senal?.aborted).toBe(true)
    await responder(pendientes, 'a2', documento([{ n: 2, importe: CUOTA }]))
    expect(screen.getByTestId('deuda-item-i2')).toBeTruthy()
    await act(async () => { primera?.resolver({ data: documento([{ n: 1, importe: CUOTA }]), error: null }) })
    expect(screen.queryByTestId('deuda-item-i1')).toBeNull()
    expect(screen.getByTestId('deuda-item-i2')).toBeTruthy()
  })

  it('una página siguiente que llega tarde, ya cambiado el hijo, no se mezcla con el nuevo', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const todos: Spec[] = Array.from({ length: 51 }, (_, i) => ({ n: i + 1, importe: CUOTA }))
    await responder(pendientes, 'a1', documento(todos))
    await fireEvent.press(screen.getByTestId('deuda-mas'))
    const tardia = pendientes.find(p => p.args.p_pagina === 2)
    await fireEvent.press(screen.getByTestId('deuda-hijo-a2'))
    expect(tardia?.senal?.aborted).toBe(true)
    await responder(pendientes, 'a2', documento([{ n: 500, importe: CUOTA }]))
    await act(async () => { tardia?.resolver({ data: documento(todos, { pagina: 2 }), error: null }) })
    expect(screen.getAllByTestId(/^deuda-item-/u)).toHaveLength(1)
    expect(screen.getByTestId('deuda-item-i500')).toBeTruthy()
  })

  it('filtro: valida fechas reales y el orden, pide el rango por mes de factura y aclara que no es la fecha de transferencia', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    await responder(pendientes, 'a1', documento([{ n: 1, importe: CUOTA }]))
    expect(screen.getByText('Filtrar por período de factura')).toBeTruthy()
    expect(screen.getByText(/no por la fecha de transferencia/u)).toBeTruthy()

    await escribir('deuda-desde', '30022026')
    await escribir('deuda-hasta', '01032026')
    await fireEvent.press(screen.getByTestId('deuda-aplicar'))
    expect(screen.getByText('La fecha desde no existe. Usá el formato DD/MM/AAAA.')).toBeTruthy()
    expect(pendientes).toHaveLength(0)

    await escribir('deuda-desde', '01032026')
    await escribir('deuda-hasta', '01022026')
    await fireEvent.press(screen.getByTestId('deuda-aplicar'))
    expect(screen.getByText('La fecha desde no puede ser posterior a la fecha hasta.')).toBeTruthy()
    expect(pendientes).toHaveLength(0)

    // Un solo extremo no es un filtro válido.
    await escribir('deuda-hasta', '')
    await fireEvent.press(screen.getByTestId('deuda-aplicar'))
    expect(screen.getByText('Ingresá la fecha hasta.')).toBeTruthy()
    expect(pendientes).toHaveLength(0)

    await escribir('deuda-desde', '15122025')
    await escribir('deuda-hasta', '02012026')
    await fireEvent.press(screen.getByTestId('deuda-aplicar'))
    expect(pendientes[0]?.args).toMatchObject({ p_alumno_id: 'a1', p_desde: '2025-12-15', p_hasta: '2026-01-02', p_pagina: 1 })
    await responder(pendientes, 'a1', documento([{ n: 7, importe: CUOTA, periodo: '2025-12-01' }], { periodoDesde: '2025-12-01', periodoHasta: '2026-01-01' }))
    expect(screen.getByText('Facturas de diciembre de 2025 a enero de 2026 (período de factura).')).toBeTruthy()
  })

  it('«Ver todo el historial» quita el filtro y vuelve a pedir sin fechas', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    await responder(pendientes, 'a1', documento([{ n: 1, importe: CUOTA }]))
    await escribir('deuda-desde', '01012026')
    await escribir('deuda-hasta', '31012026')
    await fireEvent.press(screen.getByTestId('deuda-aplicar'))
    await responder(pendientes, 'a1', documento([], { periodoDesde: '2026-01-01', periodoHasta: '2026-01-01' }))
    expect(screen.getByText('No hay ítems en este período')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('deuda-todo'))
    expect(screen.getByTestId('deuda-desde').props.value).toBe('')
    expect(pendientes[0]?.args).not.toHaveProperty('p_desde')
    await responder(pendientes, 'a1', documento([{ n: 1, importe: CUOTA }]))
    expect(screen.getByTestId('deuda-item-i1')).toBeTruthy()
  })

  it('cambiar de hijo descarta el filtro, el historial y las respuestas del anterior', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    await responder(pendientes, 'a1', documento([{ n: 1, importe: CUOTA }]))
    await escribir('deuda-desde', '01012026')
    await escribir('deuda-hasta', '31012026')
    await fireEvent.press(screen.getByTestId('deuda-aplicar'))
    await responder(pendientes, 'a1', documento([{ n: 1, importe: CUOTA }], { periodoDesde: '2026-01-01', periodoHasta: '2026-01-01' }))
    await fireEvent.press(screen.getByTestId('deuda-hijo-a2'))
    expect(screen.queryByTestId('deuda-item-i1')).toBeNull()
    expect(screen.getByTestId('deuda-desde').props.value).toBe('')
    expect(pendientes[0]?.args).toEqual({ p_alumno_id: 'a2', p_pagina: 1, p_tamano: 50 })
  })

  it('estados: sin ítems, error con reintento, permiso insuficiente y rango rechazado por el servidor', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    await responder(pendientes, 'a1', documento([]))
    expect(screen.getByText('Todavía no hay ítems facturados')).toBeTruthy()
    expect(textoDe('deuda-total')).toBe('ARS 0,00')

    await fireEvent.press(screen.getByTestId('deuda-aplicar'))
    await responder(pendientes, 'a1', null, { message: 'Failed to fetch' })
    expect(screen.getByText('No pudimos cargar la deuda')).toBeTruthy()
    await fireEvent.press(screen.getByText('Reintentar'))
    expect(screen.getByText('Consultando la deuda…')).toBeTruthy()
    await responder(pendientes, 'a1', null, { code: '42501' })
    expect(screen.getByText('No tenés permiso para ver esta información')).toBeTruthy()
    expect(screen.queryByText('Reintentar')).toBeNull()

    await fireEvent.press(screen.getByTestId('deuda-todo'))
    await responder(pendientes, 'a1', null, { code: 'P6871' })
    expect(screen.getByText('El rango de fechas no es válido')).toBeTruthy()
  })

  it('una respuesta con cifras que no cierran no se muestra', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const d = documento([{ n: 1, importe: CUOTA }])
    ;(d.totales as Objeto).adeudado_centavos = '1'
    await responder(pendientes, 'a1', d)
    expect(screen.getByText('No pudimos cargar la deuda')).toBeTruthy()
    expect(screen.queryByTestId('deuda-total')).toBeNull()
  })

  it('ítems especiales: sin cargo, en verificación, inscripción cancelada, catálogo inactivo e importes inconsistentes', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    await responder(pendientes, 'a1', documento([
      { n: 1, tipo: 'TRANSPORTE', grupo: 'TRANSPORTE:norte', concepto: 'Recorrido Norte', importe: 0n, extra: { estado: 'SIN_CARGO', vencido: false, origen_estado: 'CANCELADA' } },
      { n: 2, tipo: 'DEPORTE', grupo: 'DEPORTE:nat', concepto: 'Natación', importe: 900000n, extra: { estado: 'EN_VERIFICACION', en_verificacion: true, catalogo_activo: false, origen_estado: 'CANCELADA' } },
      { n: 3, importe: CUOTA, pagado: 3000000n, extra: { inconsistente: true } },
    ]))
    const sinCargo = within(screen.getByTestId('deuda-item-i1'))
    expect(sinCargo.getByText('Sin cargo')).toBeTruthy()
    expect(sinCargo.getByText('La inscripción de origen fue cancelada; el importe facturado se conserva.')).toBeTruthy()
    const verificacion = within(screen.getByTestId('deuda-item-i2'))
    expect(verificacion.getByText('En verificación')).toBeTruthy()
    expect(verificacion.getByText(/Venció el 10\/01\/2026\. Hay un pago en verificación: la deuda no baja hasta que se apruebe\./u)).toBeTruthy()
    expect(verificacion.getByText('Este concepto ya no está activo en el catálogo.')).toBeTruthy()
    expect(within(screen.getByTestId('deuda-item-i3')).getByText('Revisá este ítem con la institución')).toBeTruthy()
  })

  it('reanudar la aplicación repite la consulta y descarta la respuesta anterior', async () => {
    let alActivar: ((estado: string) => void) | undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementationOnce(((_: string, fn: (e: string) => void) => {
      alActivar = fn
      return { remove: () => undefined }
    }) as never)
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} />)
    const vieja = pendientes.find(p => p.args.p_alumno_id === 'a1')
    await act(async () => { alActivar?.('active') })
    expect(vieja?.senal?.aborted).toBe(true)
    await responder(pendientes, 'a1', documento([{ n: 2, importe: CUOTA }]))
    await act(async () => { vieja?.resolver({ data: documento([{ n: 1, importe: CUOTA }]), error: null }) })
    expect(screen.queryByTestId('deuda-item-i1')).toBeNull()
    expect(screen.getByTestId('deuda-item-i2')).toBeTruthy()
  })

  it('estudiante: sin selector y solo su alumno; sin vínculos no consulta nada', async () => {
    const solo = clienteControlado()
    await render(<Controlado cliente={solo.cliente} alumnos={[{ id: 's1', etiqueta: 'Mi deuda' }]} mostrarSelector={false} />)
    expect(screen.queryByTestId('deuda-hijo-s1')).toBeNull()
    expect(solo.pendientes.every(p => p.args.p_alumno_id === 's1')).toBe(true)
    await responder(solo.pendientes, 's1', documento([{ n: 1, importe: CUOTA }]))
    expect(screen.getByTestId('deuda-item-i1')).toBeTruthy()
  })

  it('sin vínculos: no consulta nada', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<Controlado cliente={cliente} alumnos={[]} />)
    expect(screen.getByText('Todavía no hay estudiantes vinculados')).toBeTruthy()
    expect(pendientes).toHaveLength(0)
  })

  it('un vínculo revocado reemplaza al hijo y descarta lo anterior', async () => {
    const { cliente, pendientes } = clienteControlado()
    const vista = await render(<Controlado cliente={cliente} />)
    await responder(pendientes, 'a1', documento([{ n: 1, importe: CUOTA }]))
    await vista.rerender(<Controlado cliente={cliente} alumnos={[HIJOS[1]!]} />)
    expect(screen.queryByTestId('deuda-item-i1')).toBeNull()
    expect(pendientes.some(p => p.args.p_alumno_id === 'a2')).toBe(true)
  })

  it('un contexto elevado sobrevive a un remontaje de la pantalla sin volver a pedir un filtro inválido', async () => {
    const { cliente, pendientes } = clienteControlado()
    function Padre({ montado }: { montado: boolean }) {
      const [contexto, setContexto] = useState<ContextoDeuda>(CONTEXTO_DEUDA_VACIO)
      return montado ? <DeudaContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector contexto={contexto} onContexto={setContexto} /> : null
    }
    const vista = await render(<Padre montado />)
    await escribir('deuda-desde', '01022026')
    await vista.rerender(<Padre montado />)
    expect(screen.getByTestId('deuda-desde').props.value).toBe('01/02/2026')
    expect(pendientes.filter(p => !p.senal?.aborted)).toHaveLength(1)
  })
})
