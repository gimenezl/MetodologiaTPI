import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { AccesoContenedor } from '@/contenedores/acceso/AccesoContenedor'
import { iniciarRecuperacion, marcarSesionAlterada, reiniciarRecuperacionParaPruebas } from '@/servicios/recuperacion-activa'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
jest.mock('@/configuracion/entorno', () => ({
  entornoDelBundle: () => ({ ok: true, entorno: { apiBaseUrl: 'https://api.example.org' } }),
}))

const mocks = {
  estado: { tipo: 'sin_sesion' } as Record<string, unknown>,
  revalidar: jest.fn(async () => undefined),
  auth: {
    getUser: jest.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
    reauthenticate: jest.fn(),
  },
}

jest.mock('@/servicios/supabase', () => ({
  obtenerClienteSupabase: () => ({ auth: mocks.auth }),
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
      this.salida.cambiar(mocks.estado)
      return () => undefined
    }
    revalidar() { return mocks.revalidar() }
    async salir() {}
    async ingresar() {}
  },
}))
jest.mock('@/contenedores/acceso/datos-rol', () => ({
  cargarDatosRol: async () => ({
    rol: 'ESTUDIANTE',
    alumno: { id: 'a-1', nombre: 'Ana', apellido: 'Pérez', legajo_nro: '100', estado: 'ACTIVO', curso_denominacion: '1°', curso_division: 'A', nivel_nombre: 'Primario' },
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

beforeEach(() => {
  reiniciarRecuperacionParaPruebas()
  mocks.revalidar.mockClear()
  mocks.auth.getUser.mockClear()
  mocks.auth.updateUser.mockClear()
})

describe('inicio de sesión: recuperar contraseña', () => {
  it('ofrece «¿Olvidaste tu contraseña?» y abre la solicitud', async () => {
    mocks.estado = { tipo: 'sin_sesion' }
    const alRecuperar = jest.fn()
    await render(<AccesoContenedor alRecuperarContrasena={alRecuperar} />)
    await fireEvent.press(await screen.findByTestId('olvide-contrasena'))
    expect(alRecuperar).toHaveBeenCalledTimes(1)
  })

  it('sin destino configurado no muestra el enlace', async () => {
    mocks.estado = { tipo: 'sin_sesion' }
    await render(<AccesoContenedor />)
    await screen.findByText('Iniciar sesión')
    expect(screen.queryByTestId('olvide-contrasena')).toBeNull()
  })
})

describe('Mi cuenta: cambiar contraseña', () => {
  async function abrirCuenta() {
    mocks.estado = { tipo: 'autenticada', usuarioId: 'u-1', rol: 'ESTUDIANTE' }
    await render(<AccesoContenedor />)
    await waitFor(() => expect(screen.getByText('Mi información académica')).toBeTruthy())
    await fireEvent.press(screen.getByText('Mi cuenta'))
  }

  it('muestra «Seguridad» y abre el formulario con su propia flecha', async () => {
    await abrirCuenta()
    expect(screen.getByText('Seguridad')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('cambiar-contrasena'))
    expect(screen.getByTestId('cambio-nueva')).toBeTruthy()
    // Una sola flecha: la del formulario (el marco de la sección queda inactivo).
    expect(screen.getAllByTestId('volver-flecha')).toHaveLength(1)
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    expect(screen.getByText('Cuenta verificada')).toBeTruthy()
    // Desde «Mi cuenta» la flecha sigue llevando a la sección principal.
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    expect(screen.getByText('Mi información académica')).toBeTruthy()
  })

  it('cambia la contraseña del usuario autenticado con Auth', async () => {
    await abrirCuenta()
    await fireEvent.press(screen.getByTestId('cambiar-contrasena'))
    await fireEvent.changeText(screen.getByTestId('cambio-nueva'), 'Clave-Nueva-9')
    await fireEvent.changeText(screen.getByTestId('cambio-confirmacion'), 'Clave-Nueva-9')
    await fireEvent.press(screen.getByTestId('cambio-guardar'))
    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeTruthy())
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: 'Clave-Nueva-9' })
  })
})

describe('compuerta de recuperación en la pantalla de acceso', () => {
  it('no revalida (ni desmonta lo que se está haciendo) si la recuperación no tocó la sesión', async () => {
    mocks.estado = { tipo: 'autenticada', usuarioId: 'u-1', rol: 'ESTUDIANTE' }
    await render(<AccesoContenedor />)
    await waitFor(() => expect(screen.getByText('Mi información académica')).toBeTruthy())
    const liberar = iniciarRecuperacion()
    await act(async () => { liberar() })
    expect(mocks.revalidar).not.toHaveBeenCalled()
    expect(screen.getByText('Mi información académica')).toBeTruthy()
  })

  it('revalida cuando la recuperación reemplazó la sesión guardada', async () => {
    mocks.estado = { tipo: 'autenticada', usuarioId: 'u-1', rol: 'ESTUDIANTE' }
    await render(<AccesoContenedor />)
    await waitFor(() => expect(screen.getByText('Mi información académica')).toBeTruthy())
    const liberar = iniciarRecuperacion()
    marcarSesionAlterada()
    await act(async () => { liberar() })
    expect(mocks.revalidar).toHaveBeenCalledTimes(1)
  })
})
