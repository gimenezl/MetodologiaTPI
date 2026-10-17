import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { RestablecerContenedor } from '@/contenedores/recuperacion/RestablecerContenedor'
import { reiniciarIntercambiosParaPruebas } from '@/servicios/recuperacion-controlador'
import { alLiberarRecuperacion, recuperacionActiva, reiniciarRecuperacionParaPruebas } from '@/servicios/recuperacion-activa'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
jest.mock('@/servicios/supabase', () => ({ vincularCicloDeVida: () => () => undefined }))

const CODIGO = '34e770dd-9ff9-416c-87fa-43b31d7ef225'
const URL_VALIDA = `educarparatransformar://restablecer?code=${CODIGO}&sb_flow_id=a1b2c3d4e5f60718293a4b5c6d7e8f90`

function errorAuth(nombre: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('detalle interno'), { name: nombre, ...extra })
}

async function montar(opciones: { url?: string | null; sesionPrevia?: string | null; intercambio?: () => Promise<unknown> } = {}) {
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: opciones.sesionPrevia ? { user: { id: opciones.sesionPrevia } } : null }, error: null })),
    exchangeCodeForSession: jest.fn(opciones.intercambio ?? (async () => ({
      data: { session: { user: { id: 'u-rec' } }, user: { id: 'u-rec' }, redirectType: 'recovery' }, error: null,
    }))),
    getUser: jest.fn(async () => ({ data: { user: { id: 'u-rec' } }, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: { id: 'u-rec' } }, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  }
  const onTerminar = jest.fn()
  const onSolicitarNuevo = jest.fn()
  const propiedades = { cliente: { auth } as never, onTerminar, onSolicitarNuevo }
  const utilidades = await render(<RestablecerContenedor {...propiedades} url={opciones.url === undefined ? URL_VALIDA : opciones.url} />)
  return { auth, onTerminar, onSolicitarNuevo, utilidades, propiedades }
}

beforeEach(() => {
  reiniciarIntercambiosParaPruebas()
  reiniciarRecuperacionParaPruebas()
})

describe('retorno del correo de recuperación', () => {
  it('verifica el enlace, pide la contraseña nueva y confirma el resultado', async () => {
    const { auth, onTerminar } = await montar()
    await waitFor(() => expect(screen.getByText('Elegí una contraseña nueva')).toBeTruthy())
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)

    await fireEvent.changeText(screen.getByTestId('restablecer-nueva'), 'Nueva-Clave-123')
    await fireEvent.changeText(screen.getByTestId('restablecer-confirmacion'), 'Nueva-Clave-123')
    await fireEvent.press(screen.getByText('Guardar contraseña'))

    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeTruthy())
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Nueva-Clave-123' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(screen.queryByTestId('restablecer-nueva')).toBeNull() // la contraseña escrita desaparece
    expect(recuperacionActiva()).toBe(true)

    await fireEvent.press(screen.getByText('Ir a iniciar sesión'))
    expect(onTerminar).toHaveBeenCalledTimes(1)
    expect(recuperacionActiva()).toBe(false)
  })

  it('no guarda si la confirmación no coincide y conserva lo escrito', async () => {
    const { auth } = await montar()
    await waitFor(() => expect(screen.getByText('Elegí una contraseña nueva')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('restablecer-nueva'), 'uno')
    await fireEvent.changeText(screen.getByTestId('restablecer-confirmacion'), 'dos')
    await fireEvent.press(screen.getByText('Guardar contraseña'))
    expect(screen.getAllByText('Las contraseñas no coinciden.').length).toBeGreaterThan(0)
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(screen.getByTestId('restablecer-nueva').props.value).toBe('uno')
  })

  it('el control «Mostrar» alterna la visibilidad de ambas contraseñas', async () => {
    await montar()
    await waitFor(() => expect(screen.getByText('Elegí una contraseña nueva')).toBeTruthy())
    expect(screen.getByTestId('restablecer-nueva').props.secureTextEntry).toBe(true)
    await fireEvent.press(screen.getAllByText('Mostrar')[0])
    expect(screen.getByTestId('restablecer-nueva').props.secureTextEntry).toBe(false)
    expect(screen.getByTestId('restablecer-confirmacion').props.secureTextEntry).toBe(false)
  })

  it('el doble toque en «Guardar» actualiza una sola vez', async () => {
    const { auth } = await montar()
    await waitFor(() => expect(screen.getByText('Elegí una contraseña nueva')).toBeTruthy())
    await fireEvent.changeText(screen.getByTestId('restablecer-nueva'), 'x')
    await fireEvent.changeText(screen.getByTestId('restablecer-confirmacion'), 'x')
    const boton = screen.getByText('Guardar contraseña')
    await fireEvent.press(boton)
    await fireEvent.press(boton)
    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeTruthy())
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
  })

  it('la entrega repetida del mismo enlace (re-render) no vuelve a canjear', async () => {
    const { auth, utilidades, propiedades } = await montar()
    await waitFor(() => expect(screen.getByText('Elegí una contraseña nueva')).toBeTruthy())
    await utilidades.rerender(<RestablecerContenedor {...propiedades} url={URL_VALIDA} />)
    await utilidades.rerender(<RestablecerContenedor {...propiedades} url={`${URL_VALIDA}`} />)
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['inválido', 'educarparatransformar://restablecer?code=corto', /no es válido o está incompleto/u],
    ['vencido', 'educarparatransformar://restablecer?error=access_denied&error_code=otp_expired', /El enlace venció/u],
    ['de otro destino', 'educarparatransformar://otra?code=abcdefghij', /no corresponde a la recuperación/u],
  ])('muestra el enlace %s y permite pedir uno nuevo', async (_caso, url, texto) => {
    const { auth, onSolicitarNuevo } = await montar({ url })
    await waitFor(() => expect(screen.getByText(texto)).toBeTruthy())
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(screen.queryByTestId('restablecer-nueva')).toBeNull()
    await fireEvent.press(screen.getByText('Pedir un enlace nuevo'))
    expect(onSolicitarNuevo).toHaveBeenCalledTimes(1)
    expect(recuperacionActiva()).toBe(false)
  })

  it('un enlace ya usado o sin verificador no abre el formulario', async () => {
    await montar({ intercambio: async () => ({ data: { session: null, user: null }, error: errorAuth('AuthApiError', { status: 400, code: 'flow_state_not_found' }) }) })
    await waitFor(() => expect(screen.getByText(/ya se utilizó o venció/u)).toBeTruthy())
    expect(screen.queryByText(/detalle interno/u)).toBeNull()
  })

  it('sin enlace explica cómo continuar', async () => {
    await montar({ url: null })
    expect(screen.getByText('No hay un enlace para continuar')).toBeTruthy()
  })

  it('con la sesión de otra cuenta pide confirmación; cancelar no cambia nada', async () => {
    const { auth, onTerminar } = await montar({ sesionPrevia: 'u-otra' })
    await waitFor(() => expect(screen.getByText('Hay una sesión iniciada')).toBeTruthy())
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByText('Cancelar'))
    expect(onTerminar).toHaveBeenCalledTimes(1)
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('con la sesión de otra cuenta, confirmar continúa solo con la cuenta del enlace', async () => {
    const { auth } = await montar({ sesionPrevia: 'u-otra' })
    await waitFor(() => expect(screen.getByText('Hay una sesión iniciada')).toBeTruthy())
    await fireEvent.press(screen.getByText('Cerrar esa sesión y continuar'))
    await waitFor(() => expect(screen.getByText('Elegí una contraseña nueva')).toBeTruthy())
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
  })

  it('la compuerta se libera al desmontar y avisa si la sesión cambió', async () => {
    const avisos: boolean[] = []
    alLiberarRecuperacion(l => avisos.push(l.sesionAlterada))
    const { utilidades } = await montar()
    await waitFor(() => expect(screen.getByText('Elegí una contraseña nueva')).toBeTruthy())
    await act(async () => { utilidades.unmount() })
    expect(recuperacionActiva()).toBe(false)
    expect(avisos).toEqual([true])
  })
})
