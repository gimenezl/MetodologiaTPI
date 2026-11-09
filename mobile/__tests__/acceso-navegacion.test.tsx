import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { AccesoContenedor } from '@/contenedores/acceso/AccesoContenedor'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
jest.mock('@/configuracion/entorno', () => ({
  entornoDelBundle: () => ({ ok: true, entorno: { apiBaseUrl: 'https://api.example.org' } }),
}))
jest.mock('@/servicios/supabase', () => ({
  obtenerClienteSupabase: () => ({}),
  vincularCicloDeVida: () => () => undefined,
}))
jest.mock('@/servicios/autenticacion', () => ({
  ...jest.requireActual('@/servicios/autenticacion'),
  ControladorAutenticacion: class {
    private readonly salida: { cambiar: (e: unknown) => void }
    constructor(_cliente: unknown, salida: { cambiar: (e: unknown) => void }) {
      this.salida = salida
    }
    iniciar() {
      this.salida.cambiar({ tipo: 'autenticada', usuarioId: 'u-1', rol: 'ESTUDIANTE' })
      return () => undefined
    }
    async revalidar() {}
    async salir() {}
    async ingresar() {}
  },
}))
jest.mock('@/contenedores/acceso/datos-rol', () => ({
  cargarDatosRol: async () => ({
    rol: 'ESTUDIANTE',
    alumno: {
      id: 'a-1',
      nombre: 'Ana',
      apellido: 'Pérez',
      legajo_nro: '100',
      estado: 'ACTIVO',
      curso_denominacion: '1°',
      curso_division: 'A',
      nivel_nombre: 'Primario',
    },
  }),
}))
jest.mock('@/servicios/cuotas', () => ({
  ...jest.requireActual('@/servicios/cuotas'),
  consultarCuotas: async () => [],
  consultarDetalleCuota: async () => ({ tipo: 'error' }),
}))
jest.mock('@/servicios/almacenamiento-seguro', () => ({
  crearAlmacenamientoSeguro: () => ({ getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined }),
}))
jest.mock('@/servicios/api', () => ({ obtenerTransporteApi: () => ({ solicitar: async () => ({}) }) }))
jest.mock('@/servicios/selector-archivos', () => ({ crearSelectorArchivos: () => ({}) }))
jest.mock('@/servicios/subida-archivo', () => ({ crearSubidaExpo: () => async () => ({ tipo: 'subido' }) }))

async function abrir() {
  await render(<AccesoContenedor />)
  await waitFor(() => expect(screen.getByText('Mi información académica')).toBeTruthy())
}

describe('navegación de la cuenta: barra inferior', () => {
  it('el inicio es la raíz: no tiene flecha y la barra muestra los cuatro destinos', async () => {
    await abrir()
    expect(screen.queryByTestId('volver-flecha')).toBeNull()
    for (const id of ['tab-inicio', 'seccion-cuotas', 'tab-historial', 'tab-cuenta']) expect(screen.getByTestId(id)).toBeTruthy()
  })

  it('«Mi cuenta» se abre desde la barra y el inicio vuelve a la sección principal', async () => {
    await abrir()
    await fireEvent.press(screen.getByTestId('tab-cuenta'))
    expect(screen.getByText('Cuenta verificada')).toBeTruthy()
    expect(screen.getByTestId('cerrar-sesion')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('tab-inicio'))
    expect(screen.getByText('Mi información académica')).toBeTruthy()
  })

  it('«Cuotas» se abre desde la barra y el inicio vuelve a la sección principal', async () => {
    await abrir()
    await fireEvent.press(screen.getByTestId('seccion-cuotas'))
    await waitFor(() => expect(screen.getByText('Tus cuotas')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('tab-inicio'))
    expect(screen.getByText('Mi información académica')).toBeTruthy()
  })

  it('«Historial» ofrece facturas, deuda por ítem e inscripciones', async () => {
    await abrir()
    await fireEvent.press(screen.getByTestId('tab-historial'))
    for (const id of ['seccion-periodo', 'seccion-deuda', 'seccion-inscripciones']) expect(screen.getByTestId(id)).toBeTruthy()
    await fireEvent.press(screen.getByTestId('seccion-deuda'))
    expect(screen.getByTestId('seccion-deuda').props.accessibilityState.selected).toBe(true)
  })

  it('las acciones rápidas del inicio llevan a la sección correspondiente', async () => {
    await abrir()
    await fireEvent.press(screen.getByTestId('accion-pagar'))
    await waitFor(() => expect(screen.getByText('Tus cuotas')).toBeTruthy())
  })
})
