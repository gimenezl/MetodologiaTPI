import { useState } from 'react'
import { AppState } from 'react-native'
import { act, fireEvent, render, screen, within } from '@testing-library/react-native'

import { InscripcionesContenedor } from '@/contenedores/consultas/InscripcionesContenedor'
import { contextoPeriodoVacio, PeriodoContenedor, type ContextoPeriodo } from '@/contenedores/consultas/PeriodoContenedor'
import type { ClienteEPT } from '@/servicios/supabase'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

type Fila = Record<string, unknown>
interface Pendiente {
  nombre: string
  args: Record<string, unknown>
  senal?: AbortSignal
  resolver: (r: { data: Fila[] | null; error: unknown }) => void
}

/** Cliente cuyas RPC quedan pendientes hasta que la prueba las resuelve (respuestas tardías y fuera de orden). */
function clienteControlado(): { cliente: ClienteEPT; pendientes: Pendiente[] } {
  const pendientes: Pendiente[] = []
  const cliente = {
    rpc(nombre: string, args: Record<string, unknown>) {
      const p: Omit<Pendiente, 'resolver'> = { nombre, args }
      const constructor = {
        range: () => constructor,
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

async function responder(
  pendientes: Pendiente[],
  nombre: string,
  alumno: string,
  filas: Fila[] | null,
  error: unknown = null,
  criterio?: (p: Pendiente) => boolean,
): Promise<void> {
  const i = pendientes.findLastIndex(p => p.nombre === nombre && p.args.p_alumno_id === alumno && !p.senal?.aborted && (criterio?.(p) ?? true))
  if (i < 0) throw new Error(`No hay RPC pendiente ${nombre} para ${alumno}`)
  const [p] = pendientes.splice(i, 1)
  await act(async () => { p?.resolver({ data: error ? null : filas, error }) })
}

const inscripcion = (id: string, categoria: string, estado: string, extra: Fila = {}): Fila => ({
  categoria, inscripcion_id: id, estado, nombre: `Nombre ${id}`, grupo: categoria === 'DEPORTE' ? 'Grupo A' : null,
  nivel: categoria === 'DEPORTE' ? 'PRIMARIO' : null, catalogo_activo: true,
  fecha_inscripcion: '2026-03-01T12:00:00+00:00',
  fecha_cancelacion: estado === 'CANCELADA' ? '2026-04-01T12:00:00+00:00' : null, ...extra,
})

const factura = (id: string, alumno: string, periodo: string, extra: Fila = {}): Fila => ({
  factura_id: id, alumno_id: alumno, periodo, vencimiento: periodo.slice(0, 8) + '10', total_centavos: 5000000,
  pagado_centavos: 0, saldo_centavos: 5000000, estado: 'PENDIENTE', inconsistente: false, fecha_corte: '2026-02-01',
  cantidad_pagos: 1, cantidad_archivos: 2, ...extra,
})

const pago = (id: string, extra: Fila = {}): Fila => ({
  pago_id: id, estado: 'PENDIENTE_VERIFICACION', fecha_transferencia: '2026-01-05', importe_informado_centavos: 5000000,
  total_calculado_centavos: 5000000, creado_en: '2026-01-04T12:00:00+00:00', cantidad_archivos: 2,
  items:[],recibo_id:null,verificado_en:null,motivo_rechazo:null,ultima_carga_en: '2026-01-06T12:00:00+00:00', periodos: ['2025-12-01', '2026-01-01'], ...extra,
})

describe('InscripcionesContenedor', () => {
  it('padre: agrupa deportes, transporte y comedor con su estado real y no ofrece acciones de escritura', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<InscripcionesContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector />)
    expect(screen.getByText('Consultando inscripciones…')).toBeTruthy()
    await responder(pendientes, 'consultar_inscripciones_alumno', 'a1', [
      inscripcion('d1', 'DEPORTE', 'ACTIVA'),
      inscripcion('d2', 'DEPORTE', 'CANCELADA', { catalogo_activo: false }),
      inscripcion('t1', 'TRANSPORTE', 'ACTIVA'),
    ])
    expect(screen.getByTestId('inscripcion-d1')).toBeTruthy()
    expect(screen.getByTestId('inscripcion-d2')).toBeTruthy()
    expect(screen.getByText('Cancelada')).toBeTruthy()
    expect(screen.getByText(/ya no figura como activo/u)).toBeTruthy()
    // El comedor sin inscripciones se dice, no se omite.
    expect(screen.getByText('No hay inscripciones al comedor registradas.')).toBeTruthy()
    expect(screen.getByText('Solo consulta')).toBeTruthy()
    // Sin altas, modificaciones ni cancelaciones.
    expect(screen.queryByRole('button', { name: /inscrib|cancelar|baja|agregar|modificar/iu })).toBeNull()
    expect(screen.queryByTestId('inscribir')).toBeNull()
  })

  it('una respuesta tardía de otro hijo, aun cancelada, nunca pisa al hijo vigente', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<InscripcionesContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector />)
    const primera = pendientes.find(p => p.args.p_alumno_id === 'a1')
    await fireEvent.press(screen.getByTestId('insc-hijo-a2'))
    expect(primera?.senal?.aborted).toBe(true)
    await responder(pendientes, 'consultar_inscripciones_alumno', 'a2', [inscripcion('x2', 'COMEDOR', 'ACTIVA')])
    expect(screen.getByTestId('inscripcion-x2')).toBeTruthy()
    await act(async () => { primera?.resolver({ data: [inscripcion('x1', 'COMEDOR', 'ACTIVA')], error: null }) })
    expect(screen.queryByTestId('inscripcion-x1')).toBeNull()
    expect(screen.getByTestId('inscripcion-x2')).toBeTruthy()
  })

  it('error con reintento y permiso insuficiente sin revelar datos', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<InscripcionesContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector />)
    await responder(pendientes, 'consultar_inscripciones_alumno', 'a1', null, { message: 'Failed to fetch' })
    expect(screen.getByText('No pudimos cargar las inscripciones')).toBeTruthy()
    await fireEvent.press(screen.getByText('Reintentar'))
    await responder(pendientes, 'consultar_inscripciones_alumno', 'a1', null, { code: '42501' })
    expect(screen.getByText('No tenés permiso para ver esta información')).toBeTruthy()
    expect(screen.queryByText('Reintentar')).toBeNull()
  })

  it('estudiante: sin selector, solo su alumno y estado vacío cuando no hay inscripciones', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<InscripcionesContenedor cliente={cliente} alumnos={[{ id: 's1', etiqueta: 'Mis inscripciones' }]} mostrarSelector={false} />)
    expect(screen.queryByTestId('insc-hijo-s1')).toBeNull()
    expect(pendientes.every(p => p.args.p_alumno_id === 's1')).toBe(true)
    await responder(pendientes, 'consultar_inscripciones_alumno', 's1', [])
    expect(screen.getByText('No hay inscripciones a deportes registradas.')).toBeTruthy()
    expect(screen.getByText('No hay inscripciones a recorridos de transporte registradas.')).toBeTruthy()
  })

  it('sin vínculos: no consulta nada', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<InscripcionesContenedor cliente={cliente} alumnos={[]} mostrarSelector />)
    expect(screen.getByText('Todavía no hay estudiantes vinculados')).toBeTruthy()
    expect(pendientes).toHaveLength(0)
  })

  it('un vínculo revocado reemplaza al hijo y descarta lo anterior', async () => {
    const { cliente, pendientes } = clienteControlado()
    const vista = await render(<InscripcionesContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector />)
    await responder(pendientes, 'consultar_inscripciones_alumno', 'a1', [inscripcion('x1', 'COMEDOR', 'ACTIVA')])
    await vista.rerender(<InscripcionesContenedor cliente={cliente} alumnos={[HIJOS[1]!]} mostrarSelector />)
    expect(screen.queryByTestId('inscripcion-x1')).toBeNull()
    expect(pendientes.some(p => p.args.p_alumno_id === 'a2')).toBe(true)
  })
})

function PeriodoControlado({ cliente, alumnos = HIJOS, mostrarSelector = true }: { cliente: ClienteEPT; alumnos?: typeof HIJOS; mostrarSelector?: boolean }) {
  const [contexto, setContexto] = useState<ContextoPeriodo>(() => contextoPeriodoVacio(new Date(2026, 0, 15)))
  return <PeriodoContenedor cliente={cliente} alumnos={alumnos} mostrarSelector={mostrarSelector} contexto={contexto} onContexto={setContexto} />
}

async function escribir(testID: string, texto: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId(testID), texto)
}

describe('PeriodoContenedor', () => {
  it('no consulta hasta pedirlo y valida fechas reales y el orden del rango', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} />)
    expect(pendientes).toHaveLength(0)
    expect(screen.getByTestId('periodo-desde').props.value).toBe('01/01/2026')
    expect(screen.getByTestId('periodo-hasta').props.value).toBe('31/12/2026')

    await escribir('periodo-desde', '30022026')
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(screen.getByText('La fecha desde no existe. Usá el formato DD/MM/AAAA.')).toBeTruthy()
    expect(pendientes).toHaveLength(0)

    await escribir('periodo-desde', '')
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(screen.getByText('Ingresá la fecha desde.')).toBeTruthy()

    await escribir('periodo-desde', '01022026')
    await escribir('periodo-hasta', '01012026')
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(screen.getByText('La fecha desde no puede ser posterior a la fecha hasta.')).toBeTruthy()
    expect(pendientes).toHaveLength(0)
  })

  it('consulta facturas y comprobantes con el rango en ISO y rotula cada fecha', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} />)
    await escribir('periodo-desde', '01122025')
    await escribir('periodo-hasta', '31012026')
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(screen.getByText('Facturas por período de factura')).toBeTruthy()
    expect(screen.getByText('Comprobantes por período de factura')).toBeTruthy()
    const f = pendientes.find(p => p.nombre === 'consultar_facturas_periodo')
    const r = pendientes.find(p => p.nombre === 'consultar_registro_comprobantes')
    expect(f?.args).toEqual({ p_alumno_id: 'a1', p_desde: '2025-12-01', p_hasta: '2026-01-31' })
    expect(r?.args).toEqual({ p_alumno_id: 'a1', p_criterio: 'PERIODO_FACTURA', p_desde: '2025-12-01', p_hasta: '2026-01-31' })

    await responder(pendientes, 'consultar_facturas_periodo', 'a1', [factura('f1', 'a1', '2025-12-01'), factura('f2', 'a1', '2026-01-01')])
    await responder(pendientes, 'consultar_registro_comprobantes', 'a1', [pago('p1')])
    expect(screen.getByTestId('factura-f1')).toBeTruthy()
    expect(screen.getByTestId('factura-f2')).toBeTruthy()
    // El pago multifactura figura una sola vez, con todas las facturas que cubre.
    expect(screen.getAllByTestId('comprobante-p1')).toHaveLength(1)
    expect(screen.getByText('diciembre de 2025, enero de 2026')).toBeTruthy()
    const tarjeta = within(screen.getByTestId('comprobante-p1'))
    expect(tarjeta.getByText('Fecha de transferencia')).toBeTruthy()
    expect(tarjeta.getByText('05/01/2026')).toBeTruthy()
    expect(tarjeta.getByText('2 archivos')).toBeTruthy()
    expect(tarjeta.getByText('06/01/2026')).toBeTruthy()
    expect(screen.getByText(/solo lo puede ver quien lo cargó y la Dirección/u)).toBeTruthy()
    // La vista no ofrece abrir, descargar ni cargar archivos.
    expect(screen.queryByText(/descargar|ver archivo|abrir original|adjuntar|cargar comprobante/iu)).toBeNull()
  })

  it('cambiar el criterio vuelve a pedir solo los comprobantes', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} />)
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    await responder(pendientes, 'consultar_facturas_periodo', 'a1', [factura('f1', 'a1', '2026-01-01')])
    await responder(pendientes, 'consultar_registro_comprobantes', 'a1', [pago('p1')])
    expect(pendientes).toHaveLength(0)

    await fireEvent.press(screen.getByTestId('criterio-transferencia'))
    expect(pendientes.map(p => p.nombre)).toEqual(['consultar_registro_comprobantes'])
    expect(pendientes[0]?.args.p_criterio).toBe('FECHA_TRANSFERENCIA')
    expect(screen.getByText('Comprobantes por fecha de transferencia')).toBeTruthy()
    // Las facturas siguen visibles: no dependen del criterio de los comprobantes.
    expect(screen.getByTestId('factura-f1')).toBeTruthy()
    await responder(pendientes, 'consultar_registro_comprobantes', 'a1', [])
    expect(screen.getByText('Ningún pago tiene una fecha de transferencia informada dentro de las fechas elegidas.')).toBeTruthy()
  })

  it('una respuesta tardía de otro rango o de otro hijo nunca aparece bajo la consulta vigente', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} />)
    await escribir('periodo-desde', '01012026')
    await escribir('periodo-hasta', '31012026')
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    const viejaFacturas = pendientes.find(p => p.nombre === 'consultar_facturas_periodo')

    // Segunda consulta con otro rango antes de que responda la primera.
    await escribir('periodo-hasta', '28022026')
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(viejaFacturas?.senal?.aborted).toBe(true)
    await responder(pendientes, 'consultar_facturas_periodo', 'a1', [factura('nueva', 'a1', '2026-02-01')])
    await act(async () => { viejaFacturas?.resolver({ data: [factura('vieja', 'a1', '2026-01-01')], error: null }) })
    expect(screen.queryByTestId('factura-vieja')).toBeNull()
    expect(screen.getByTestId('factura-nueva')).toBeTruthy()

    // Cambio de hijo: la consulta anterior se descarta y su respuesta tardía no aparece.
    const viejaRegistro = pendientes.find(p => p.nombre === 'consultar_registro_comprobantes' && !p.senal?.aborted)
    await fireEvent.press(screen.getByTestId('periodo-hijo-a2'))
    expect(screen.queryByTestId('factura-nueva')).toBeNull()
    expect(screen.queryByTestId('periodo-facturas')).toBeNull()
    await act(async () => { viejaRegistro?.resolver({ data: [pago('ajeno')], error: null }) })
    expect(screen.queryByTestId('comprobante-ajeno')).toBeNull()
    // El rango escrito se conserva; la persona vuelve a consultar para el hijo elegido.
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(pendientes.some(p => p.nombre === 'consultar_facturas_periodo' && p.args.p_alumno_id === 'a2')).toBe(true)
  })

  it('un rango inválido no deja visibles los resultados del rango anterior', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} />)
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    await responder(pendientes, 'consultar_facturas_periodo', 'a1', [factura('f1', 'a1', '2026-01-01')])
    await responder(pendientes, 'consultar_registro_comprobantes', 'a1', [])
    expect(screen.getByTestId('factura-f1')).toBeTruthy()
    await escribir('periodo-hasta', '01012020')
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(screen.queryByTestId('factura-f1')).toBeNull()
    expect(screen.getByText('La fecha desde no puede ser posterior a la fecha hasta.')).toBeTruthy()
  })

  it('estados: vacío, error con reintento, permiso insuficiente y dato no disponible', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} />)
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    await responder(pendientes, 'consultar_facturas_periodo', 'a1', [])
    expect(screen.getByText('No hay facturas en este rango')).toBeTruthy()
    await responder(pendientes, 'consultar_registro_comprobantes', 'a1', null, { message: 'Failed to fetch' })
    expect(screen.getByText('No pudimos cargar los comprobantes')).toBeTruthy()
    await fireEvent.press(screen.getByText('Reintentar'))
    // Se vuelven a pedir ambas lecturas con el mismo contexto.
    await responder(pendientes, 'consultar_facturas_periodo', 'a1', [])
    await responder(pendientes, 'consultar_registro_comprobantes', 'a1', [pago('p9', {
      fecha_transferencia: null, importe_informado_centavos: null, cantidad_archivos: 0, ultima_carga_en: null, periodos: [],
    })])
    expect(screen.getByText('No informada')).toBeTruthy()
    expect(screen.getByText('No informado')).toBeTruthy()
    expect(screen.getByText('Sin archivos')).toBeTruthy()
    expect(screen.getByText('No disponible')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    await responder(pendientes, 'consultar_facturas_periodo', 'a1', null, { code: '42501' })
    expect(screen.getAllByText('No tenés permiso para ver esta información').length).toBeGreaterThan(0)
  })

  it('reanudar la aplicación repite la consulta y descarta la respuesta anterior', async () => {
    let alActivar: ((estado: string) => void) | undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementationOnce(((_: string, fn: (e: string) => void) => {
      alActivar = fn
      return { remove: () => undefined }
    }) as never)
    {
      const { cliente, pendientes } = clienteControlado()
      await render(<PeriodoControlado cliente={cliente} />)
      await fireEvent.press(screen.getByTestId('periodo-consultar'))
      const vieja = pendientes.find(p => p.nombre === 'consultar_facturas_periodo')
      await act(async () => { alActivar?.('active') })
      expect(vieja?.senal?.aborted).toBe(true)
      await responder(pendientes, 'consultar_facturas_periodo', 'a1', [factura('nueva', 'a1', '2026-01-01')])
      await act(async () => { vieja?.resolver({ data: [factura('vieja', 'a1', '2026-01-01')], error: null }) })
      expect(screen.queryByTestId('factura-vieja')).toBeNull()
      expect(screen.getByTestId('factura-nueva')).toBeTruthy()
    }
  })

  it('una respuesta tardía de comprobantes del criterio anterior no aparece bajo el nuevo', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} />)
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    const porFactura = pendientes.find(p => p.nombre === 'consultar_registro_comprobantes')
    await fireEvent.press(screen.getByTestId('criterio-transferencia'))
    expect(porFactura?.senal?.aborted).toBe(true)
    await responder(pendientes, 'consultar_registro_comprobantes', 'a1', [pago('nuevo')])
    await act(async () => { porFactura?.resolver({ data: [pago('viejo')], error: null }) })
    expect(screen.queryByTestId('comprobante-viejo')).toBeNull()
    expect(screen.getByTestId('comprobante-nuevo')).toBeTruthy()
  })

  it('estudiante: sin selector y solo sobre su alumno', async () => {
    const { cliente, pendientes } = clienteControlado()
    await render(<PeriodoControlado cliente={cliente} alumnos={[{ id: 's1', etiqueta: 'Mis facturas' }]} mostrarSelector={false} />)
    expect(screen.queryByTestId('periodo-hijo-s1')).toBeNull()
    await fireEvent.press(screen.getByTestId('periodo-consultar'))
    expect(pendientes.every(p => p.args.p_alumno_id === 's1')).toBe(true)
    expect(screen.queryByText(/registrar pago|pagar|adjuntar/iu)).toBeNull()
  })

  it('un contexto elevado sobrevive a un remontaje de la pantalla', async () => {
    const { cliente, pendientes } = clienteControlado()
    function Padre({ montado }: { montado: boolean }) {
      const [contexto, setContexto] = useState<ContextoPeriodo>(() => contextoPeriodoVacio(new Date(2026, 0, 15)))
      return montado ? <PeriodoContenedor cliente={cliente} alumnos={HIJOS} mostrarSelector contexto={contexto} onContexto={setContexto} /> : null
    }
    const vista = await render(<Padre montado />)
    await escribir('periodo-desde', '01022026')
    await vista.rerender(<Padre montado />)
    expect(screen.getByTestId('periodo-desde').props.value).toBe('01/02/2026')
    expect(pendientes).toHaveLength(0)
  })
})
