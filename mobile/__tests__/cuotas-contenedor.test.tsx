import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { CONTEXTO_CUOTAS_VACIO, CuotasContenedor, type ContextoCuotas } from '@/contenedores/cuotas/CuotasContenedor'
import type { ClienteEPT } from '@/servicios/supabase'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

type Fila = Record<string, unknown>
interface Pendiente { tabla: string; filtros: Record<string, unknown>; senal?: AbortSignal; resolver: (r: { data: Fila[] | null; error: unknown }) => void }

const cuota = (id: string, alumno: string, estado: string, extra: Fila = {}): Fila => ({
  factura_id: id,
  alumno_id: alumno,
  periodo: '2026-11-01',
  vencimiento: '2026-11-10',
  total_centavos: 5800000,
  pagado_centavos: estado === 'PAGADA' ? 5800000 : 0,
  saldo_centavos: estado === 'PAGADA' ? 0 : 5800000,
  estado,
  items_en_verificacion: 0,
  inconsistente: false,
  fecha_corte: '2026-11-11',
  ...extra,
})

/** Cliente cuyas lecturas quedan pendientes hasta que la prueba las resuelve (respuestas tardías). */
function clienteControlado(): { cliente: ClienteEPT; pendientes: Pendiente[] } {
  const pendientes: Pendiente[] = []
  const cliente = {
    from(tabla: string) {
      const p: Omit<Pendiente, 'resolver'> = { tabla, filtros: {} }
      const constructor = {
        select: () => constructor,
        eq: (columna: string, valor: unknown) => { p.filtros[columna] = valor; return constructor },
        order: () => constructor,
        abortSignal: (senal: AbortSignal) => { (p as Pendiente).senal = senal; return constructor },
        then: (resolver: (v: unknown) => unknown, rechazar?: (e: unknown) => unknown) =>
          new Promise<{ data: Fila[] | null; error: unknown }>(resuelto => {
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

async function resolver(pendientes: Pendiente[], tabla: string, alumno: string, filas: Fila[], error: unknown = null): Promise<void> {
  const i = pendientes.findLastIndex(p => p.tabla === tabla && p.filtros.alumno_id === alumno && !p.senal?.aborted)
  if (i < 0) throw new Error(`No hay lectura pendiente de ${tabla} para ${alumno}`)
  const [p] = pendientes.splice(i, 1)
  await act(async () => { p?.resolver({ data: error ? null : filas, error }) })
}

describe('CuotasContenedor', () => {
  it('padre: selector de hijos, pestañas y una respuesta tardía no pisa al hijo vigente', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<CuotasContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector />)
    expect(screen.getByText('Consultando cuotas…')).toBeTruthy()

    // Cambio rápido de hijo antes de que responda el primero.
    await fireEvent.press(screen.getByTestId('hijo-a2'))
    const primera = pendientes.find(p => p.filtros.alumno_id === 'a1')
    expect(primera?.senal?.aborted).toBe(true)

    await resolver(pendientes, 'estado_cuotas_alumno', 'a2', [cuota('f2', 'a2', 'PENDIENTE')])
    expect(screen.getByTestId('cuota-f2')).toBeTruthy()

    // La respuesta tardía del primer hijo llega después y se descarta.
    await act(async () => { primera?.resolver({ data: [cuota('f1', 'a1', 'VENCIDA')], error: null }) })
    expect(screen.queryByTestId('cuota-f1')).toBeNull()
    expect(screen.getByTestId('cuota-f2')).toBeTruthy()
  })

  it('separa Pendientes de Pagadas y destaca la vencida con texto', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [
      cuota('f1', 'a1', 'VENCIDA'),
      cuota('f2', 'a1', 'PAGO_PARCIAL', { pagado_centavos: 100, saldo_centavos: 5799900 }),
      cuota('f3', 'a1', 'PAGADA'),
    ])
    expect(screen.getByText('Pendientes (2)')).toBeTruthy()
    expect(screen.getByText('Pagadas (1)')).toBeTruthy()
    expect(screen.getByText(/Vencida el 10\/11\/2026/u)).toBeTruthy()
    expect(screen.getAllByText('Vencida').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('cuota-f3')).toBeNull()
    await fireEvent.press(screen.getByTestId('pestana-pagadas'))
    expect(screen.getByTestId('cuota-f3')).toBeTruthy()
    expect(screen.queryByTestId('cuota-f1')).toBeNull()
  })

  it('estudiante: sin selector de otros alumnos y sin acciones de pago', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<CuotasContenedor cliente={cliente} alumnos={[{ id: 'a1', etiqueta: 'Mis cuotas' }]} mostrarSelector={false} />)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [cuota('f1', 'a1', 'PENDIENTE')])
    expect(screen.queryByTestId('hijo-a1')).toBeNull()
    expect(screen.queryByText(/Pagar|Seleccionar ítems|comprobante/iu)).toBeNull()
    expect(screen.getByText('Ver detalle')).toBeTruthy()
  })

  it('error con reintento: no muestra datos y reconsulta', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [], { message: 'red' })
    expect(screen.getByText('No pudimos cargar las cuotas')).toBeTruthy()
    await fireEvent.press(screen.getByText('Reintentar'))
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [cuota('f1', 'a1', 'PENDIENTE')])
    expect(screen.getByTestId('cuota-f1')).toBeTruthy()
  })

  it('vacío: sin cuotas y sin vínculos se explican', async () => {
    const { cliente, pendientes } = clienteControlado()
    const { unmount } = await render(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [])
    expect(screen.getByText('No hay cuotas pendientes')).toBeTruthy()
    await unmount()
    await render(<CuotasContenedor cliente={cliente} alumnos={[]} mostrarSelector />)
    expect(screen.getByText('Todavía no hay estudiantes vinculados')).toBeTruthy()
  })

  it('detalle por identificador: conceptos, importes y volver al listado', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [cuota('f1', 'a1', 'PENDIENTE')])
    await fireEvent.press(screen.getByTestId('detalle-f1'))
    await waitFor(() => expect(pendientes.some(p => p.tabla === 'detalle_cuotas_items')).toBe(true))
    const lectura = pendientes.filter(p => p.filtros.factura_id === 'f1' && p.filtros.alumno_id === 'a1')
    expect(lectura).toHaveLength(2)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [cuota('f1', 'a1', 'PENDIENTE')])
    await resolver(pendientes, 'detalle_cuotas_items', 'a1', [
      { item_id: 'i1', alumno_id: 'a1', factura_id: 'f1', tipo: 'CUOTA', importe_centavos: 5000000, pagado_centavos: 0, estado_pago: 'PENDIENTE' },
      { item_id: 'i2', alumno_id: 'a1', factura_id: 'f1', tipo: 'DEPORTE', importe_centavos: 800000, pagado_centavos: 0, estado_pago: 'EN_VERIFICACION' },
      { item_id: 'i3', alumno_id: 'a1', factura_id: 'f1', tipo: 'TRANSPORTE', importe_centavos: 0, pagado_centavos: 0, estado_pago: 'PENDIENTE' },
    ])
    expect(screen.getByText('Cuota')).toBeTruthy()
    expect(screen.getByText('Deportes')).toBeTruthy()
    expect(screen.getByText('Transporte')).toBeTruthy()
    expect(screen.getByText('Sin cargo')).toBeTruthy()
    expect(screen.getByText('En verificación')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('volver-cuotas'))
    expect(screen.getByTestId('cuota-f1')).toBeTruthy()
  })

  it('un identificador ajeno en el detalle se muestra como no disponible', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [cuota('f1', 'a1', 'PENDIENTE')])
    await fireEvent.press(screen.getByTestId('detalle-f1'))
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [])
    await resolver(pendientes, 'detalle_cuotas_items', 'a1', [])
    expect(screen.getByText('Esta cuota no está disponible')).toBeTruthy()
  })

  it('un vínculo revocado quita al hijo y no conserva su listado', async () => {
    const { cliente, pendientes } = clienteControlado()
    const { rerender } = await render(<CuotasContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector />)
    await fireEvent.press(screen.getByTestId('hijo-a2'))
    await resolver(pendientes, 'estado_cuotas_alumno', 'a2', [cuota('f2', 'a2', 'PENDIENTE')])
    expect(screen.getByTestId('cuota-f2')).toBeTruthy()
    await rerender(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    expect(screen.queryByTestId('cuota-f2')).toBeNull()
    expect(screen.queryByTestId('hijo-a2')).toBeNull()
  })

  it('al desmontar (cierre de sesión) cancela las lecturas en vuelo', async () => {
    const { cliente, pendientes } = clienteControlado()
    const { unmount } = await render(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    const lectura = pendientes[0]
    await unmount()
    expect(lectura?.senal?.aborted).toBe(true)
  })

  it('conserva hijo y pestaña cuando la sesión se revalida y la pantalla se remonta', async () => {
    const { cliente, pendientes } = clienteControlado()
    function Anfitrion({ visible }: { visible: boolean }) {
      const [contexto, setContexto] = useState<ContextoCuotas>(CONTEXTO_CUOTAS_VACIO)
      return visible ? <CuotasContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector contexto={contexto} onContexto={setContexto} /> : <></>
    }
    const { rerender } = await render(<Anfitrion visible />)
    await fireEvent.press(screen.getByTestId('hijo-a2'))
    await fireEvent.press(screen.getByTestId('pestana-pagadas'))
    await rerender(<Anfitrion visible={false} />)
    await rerender(<Anfitrion visible />)
    await waitFor(() => expect(pendientes.some(p => p.filtros.alumno_id === 'a2')).toBe(true))
    await resolver(pendientes, 'estado_cuotas_alumno', 'a2', [cuota('f9', 'a2', 'PAGADA')])
    expect(screen.getByTestId('cuota-f9')).toBeTruthy()
  })

  it('un importe largo se muestra completo y exacto', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<CuotasContenedor cliente={cliente} alumnos={[HIJOS[0]!]} mostrarSelector />)
    await resolver(pendientes, 'estado_cuotas_alumno', 'a1', [
      cuota('f1', 'a1', 'PENDIENTE', { total_centavos: 999999999999, saldo_centavos: 999999999999 }),
    ])
    expect(screen.getAllByText('ARS 9.999.999.999,99').length).toBeGreaterThan(0)
  })
})
