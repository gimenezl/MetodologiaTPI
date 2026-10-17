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

describe('navegación de la cuenta: flecha «Volver» en toda la aplicación', () => {
  it('la sección principal es la raíz: no tiene flecha', async () => {
    await abrir()
    expect(screen.queryByTestId('volver-flecha')).toBeNull()
  })

  it('«Mi cuenta» tiene flecha y vuelve a la sección principal', async () => {
    await abrir()
    await fireEvent.press(screen.getByText('Mi cuenta'))
    expect(screen.getByText('Cuenta verificada')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    expect(screen.getByText('Mi información académica')).toBeTruthy()
    expect(screen.queryByTestId('volver-flecha')).toBeNull()
  })

  it('«Cuotas» tiene flecha y vuelve a la sección principal', async () => {
    await abrir()
    await fireEvent.press(screen.getByTestId('seccion-cuotas'))
    await waitFor(() => expect(screen.getByTestId('volver-flecha')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    expect(screen.getByText('Mi información académica')).toBeTruthy()
  })

  it('el gesto de deslizar desde el borde también vuelve desde «Mi cuenta»', async () => {
    await abrir()
    await fireEvent.press(screen.getByText('Mi cuenta'))
    const marco = screen.getByTestId('pantalla-con-volver')
    marco.props.onTouchStart({ nativeEvent: { pageX: 8, pageY: 300 } })
    const capturado = marco.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 120, pageY: 305 } })
    expect(capturado).toBe(true)
    await fireEvent(marco, 'responderRelease', { nativeEvent: { pageX: 120, pageY: 305 } })
    await waitFor(() => expect(screen.getByText('Mi información académica')).toBeTruthy())
  })
})
