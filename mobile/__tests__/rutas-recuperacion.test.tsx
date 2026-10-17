import { renderRouter, screen, waitFor } from 'expo-router/testing-library'
import { fireEvent } from '@testing-library/react-native'
import { Text } from 'react-native'
import { Stack, router } from 'expo-router'

import Inicio from '../app/index'
import NoEncontrada from '../app/+not-found'
import Recuperar from '../app/recuperar'
import Restablecer from '../app/restablecer'

// Las rutas reales de la aplicación (`app/`), con los contenedores sustituidos por marcadores que muestran lo que
// reciben: así se prueba el enrutamiento del esquema, el arranque en frío y la entrega del enlace, no la lógica
// de cada pantalla (que tiene sus propias pruebas).
const mockUrl: { actual: string | null } = { actual: null }
const mockLimpiar = jest.fn()

jest.mock('@/servicios/enlace-entrante', () => ({
  useEnlaceEntrante: () => mockUrl.actual,
  olvidarEnlaceEntrante: () => mockLimpiar(),
}))
jest.mock('@/configuracion/entorno', () => ({ entornoDelBundle: () => ({ ok: true, entorno: {} }) }))
jest.mock('@/servicios/supabase', () => ({ obtenerClienteSupabase: () => ({ auth: {} }) }))
jest.mock('@/contenedores/acceso/AccesoContenedor', () => {
  const { Pressable, Text: T } = jest.requireActual('react-native')
  return {
    AccesoContenedor: ({ alRecuperarContrasena }: { alRecuperarContrasena?: () => void }) => (
      <Pressable onPress={alRecuperarContrasena}><T>Inicio de sesión (marcador)</T></Pressable>
    ),
  }
})
jest.mock('@/contenedores/recuperacion/SolicitudRecuperacionContenedor', () => {
  const { Pressable, Text: T } = jest.requireActual('react-native')
  return {
    SolicitudRecuperacionContenedor: ({ onVolver }: { onVolver: () => void }) => (
      <Pressable onPress={onVolver}><T>Solicitud (marcador)</T></Pressable>
    ),
  }
})
jest.mock('@/contenedores/recuperacion/RestablecerContenedor', () => {
  const { Pressable, Text: T, View } = jest.requireActual('react-native')
  return {
    RestablecerContenedor: ({ url, onTerminar, onSolicitarNuevo }: { url: string | null; onTerminar: () => void; onSolicitarNuevo: () => void }) => (
      <View>
        <T>{`Restablecer (marcador): ${url ?? 'sin enlace'}`}</T>
        <Pressable onPress={onTerminar}><T>terminar</T></Pressable>
        <Pressable onPress={onSolicitarNuevo}><T>nuevo</T></Pressable>
      </View>
    ),
  }
})

const rutas = () => ({
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: Inicio,
  recuperar: Recuperar,
  restablecer: Restablecer,
  '+not-found': NoEncontrada,
})

const ENLACE = 'educarparatransformar://restablecer?code=34e770dd-9ff9-416c-87fa-43b31d7ef225'

describe('rutas de recuperación de contraseña', () => {
  beforeEach(() => {
    mockUrl.actual = null
    mockLimpiar.mockClear()
  })

  it('el inicio de sesión abre la solicitud y volver regresa', async () => {
    const app = renderRouter(rutas(), { initialUrl: '/' })
    await app
    await fireEvent.press(await screen.findByText('Inicio de sesión (marcador)'))
    expect(await screen.findByText('Solicitud (marcador)')).toBeTruthy()
    expect(app.getPathname()).toBe('/recuperar')
    await fireEvent.press(screen.getByText('Solicitud (marcador)'))
    await waitFor(() => expect(app.getPathname()).toBe('/'))
  })

  it('arranque en frío desde el enlace: la ruta recibe la URL completa y no existe pantalla debajo', async () => {
    mockUrl.actual = ENLACE
    const app = renderRouter(rutas(), { initialUrl: '/restablecer?code=34e770dd-9ff9-416c-87fa-43b31d7ef225' })
    await app
    expect(await screen.findByText(`Restablecer (marcador): ${ENLACE}`)).toBeTruthy()
    expect(app.getPathname()).toBe('/restablecer')
    expect(screen.queryByText('Inicio de sesión (marcador)')).toBeNull()
  })

  it('si el sistema no entrega la URL cruda, la ruta reconstruye el retorno desde los parámetros del enrutador', async () => {
    mockUrl.actual = null
    const app = renderRouter(rutas(), { initialUrl: '/restablecer?code=34e770dd-9ff9-416c-87fa-43b31d7ef225&utm=1' })
    await app
    expect(await screen.findByText(`Restablecer (marcador): ${ENLACE}`)).toBeTruthy()
  })

  it('si el sistema conserva un enlace anterior, manda el de la navegación que montó la pantalla', async () => {
    mockUrl.actual = 'educarparatransformar://restablecer?code=00000000-aaaa-bbbb-cccc-000000000000'
    const app = renderRouter(rutas(), { initialUrl: '/restablecer?code=34e770dd-9ff9-416c-87fa-43b31d7ef225' })
    await app
    expect(await screen.findByText(`Restablecer (marcador): ${ENLACE}`)).toBeTruthy()
  })

  it('al terminar limpia el enlace entregado y reemplaza por el inicio (sin poder volver a la recuperación)', async () => {
    mockUrl.actual = ENLACE
    const app = renderRouter(rutas(), { initialUrl: '/restablecer' })
    await app
    await fireEvent.press(await screen.findByText('terminar'))
    await waitFor(() => expect(app.getPathname()).toBe('/'))
    expect(mockLimpiar).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Restablecer \(marcador\)/u)).toBeNull()
  })

  it('«pedir un enlace nuevo» reemplaza la pantalla por la solicitud', async () => {
    mockUrl.actual = ENLACE
    const app = renderRouter(rutas(), { initialUrl: '/restablecer' })
    await app
    await fireEvent.press(await screen.findByText('nuevo'))
    expect(await screen.findByText('Solicitud (marcador)')).toBeTruthy()
    expect(app.getPathname()).toBe('/recuperar')
  })

  it('la app abierta que recibe el enlace pasa a la recuperación', async () => {
    const app = renderRouter(rutas(), { initialUrl: '/' })
    await app
    await screen.findByText('Inicio de sesión (marcador)')
    expect(app.getPathname()).toBe('/')
    mockUrl.actual = ENLACE
    router.push('/restablecer?code=34e770dd-9ff9-416c-87fa-43b31d7ef225')
    expect(await screen.findByText(`Restablecer (marcador): ${ENLACE}`)).toBeTruthy()
  })

  it('una ruta desconocida termina en el inicio sin mostrar sus parámetros', async () => {
    const app = renderRouter(rutas(), { initialUrl: '/desconocida?code=00000000-0000-0000-0000-000000000000' })
    await app
    expect(await screen.findByText('Inicio de sesión (marcador)')).toBeTruthy()
    expect(app.getPathname()).toBe('/')
    expect(screen.queryByText(/00000000/u)).toBeNull()
  })
})

// Evita que el linter marque la importación de Text usada solo para el tipado de los marcadores.
void Text
