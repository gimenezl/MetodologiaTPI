import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { CambioContrasenaContenedor } from '@/contenedores/recuperacion/CambioContrasenaContenedor'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

function errorAuth(nombre: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('detalle interno'), { name: nombre, ...extra })
}

type Respuesta = { data: { user: { id: string } | null }; error: unknown }

async function montar(actualizaciones: (() => Promise<Respuesta>)[] = [], usuarioActual = 'u-1') {
  const cola = [...actualizaciones]
  const auth = {
    getUser: jest.fn(async () => ({ data: { user: { id: usuarioActual } }, error: null })),
    updateUser: jest.fn(async () => (cola.shift() ?? (async () => ({ data: { user: { id: 'u-1' } }, error: null })))()),
    reauthenticate: jest.fn(async () => ({ data: {}, error: null })),
  }
  const onVolver = jest.fn()
  const onSesionExpirada = jest.fn()
  await render(<CambioContrasenaContenedor cliente={{ auth } as never} usuarioId="u-1" onVolver={onVolver} onSesionExpirada={onSesionExpirada} />)
  return { auth, onVolver, onSesionExpirada }
}

async function completar(nueva: string, confirmacion = nueva) {
  await fireEvent.changeText(screen.getByTestId('cambio-nueva'), nueva)
  await fireEvent.changeText(screen.getByTestId('cambio-confirmacion'), confirmacion)
  await fireEvent.press(screen.getByTestId('cambio-guardar'))
}

describe('cambio de contraseña desde Mi cuenta', () => {
  it('cambia la contraseña del usuario autenticado, sin pedir ni validar la anterior', async () => {
    const { auth } = await montar()
    expect(screen.queryByText(/contraseña actual|contraseña anterior/iu)).toBeNull()
    await completar('Clave-Nueva-9')
    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeTruthy())
    expect(auth.getUser).toHaveBeenCalledTimes(1)
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Clave-Nueva-9' })
    expect(screen.queryByTestId('cambio-nueva')).toBeNull()
  })

  it('valida vacío y confirmación distinta sin llamar a Auth', async () => {
    const { auth } = await montar()
    await fireEvent.press(screen.getByTestId('cambio-guardar'))
    expect(screen.getByText('Ingresá la nueva contraseña.')).toBeTruthy()
    await completar('uno', 'dos')
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('no recorta la contraseña', async () => {
    const { auth } = await montar()
    await completar('  espacios  ')
    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeTruthy())
    expect(auth.updateUser).toHaveBeenCalledWith({ password: '  espacios  ' })
  })

  it('el doble toque envía una sola actualización', async () => {
    const { auth } = await montar()
    await fireEvent.changeText(screen.getByTestId('cambio-nueva'), 'x')
    await fireEvent.changeText(screen.getByTestId('cambio-confirmacion'), 'x')
    const guardar = screen.getByTestId('cambio-guardar')
    await fireEvent.press(guardar)
    await fireEvent.press(guardar)
    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeTruthy())
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
  })

  it('muestra los rechazos reales de Auth en español', async () => {
    await montar([
      async () => ({ data: { user: null }, error: errorAuth('AuthApiError', { status: 422, code: 'same_password' }) }),
      async () => ({ data: { user: null }, error: errorAuth('AuthWeakPasswordError', { status: 422, code: 'weak_password', reasons: ['length'] }) }),
      async () => ({ data: { user: null }, error: errorAuth('AuthRetryableFetchError', { status: 0 }) }),
    ])
    await completar('misma')
    await waitFor(() => expect(screen.getByText('La nueva contraseña debe ser distinta de la actual.')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('cambio-guardar'))
    await waitFor(() => expect(screen.getByText(/Debe tener más caracteres/u)).toBeTruthy())
    await fireEvent.press(screen.getByTestId('cambio-guardar'))
    await waitFor(() => expect(screen.getByText(/No pudimos conectarnos/u)).toBeTruthy())
    expect(screen.queryByText(/detalle interno/u)).toBeNull()
    expect(screen.getByTestId('cambio-nueva').props.value).toBe('misma') // lo escrito se conserva para reintentar
  })

  it('si Auth exige reautenticación, envía el código y completa el cambio con el nonce', async () => {
    const { auth } = await montar([
      async () => ({ data: { user: null }, error: errorAuth('AuthApiError', { status: 400, code: 'reauthentication_needed' }) }),
    ])
    await completar('Clave-Nueva-9')
    await waitFor(() => expect(screen.getByTestId('cambio-codigo')).toBeTruthy())
    expect(auth.reauthenticate).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Te enviamos un código de verificación/u)).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('cambio-codigo'), ' 123456 ')
    await fireEvent.press(screen.getByTestId('cambio-guardar'))
    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeTruthy())
    expect(auth.updateUser).toHaveBeenLastCalledWith({ password: 'Clave-Nueva-9', nonce: '123456' })
  })

  it('exige el código antes de reintentar cuando ya se pidió', async () => {
    const { auth } = await montar([
      async () => ({ data: { user: null }, error: errorAuth('AuthApiError', { status: 400, code: 'reauthentication_needed' }) }),
    ])
    await completar('Clave-Nueva-9')
    await waitFor(() => expect(screen.getByTestId('cambio-codigo')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('cambio-guardar'))
    expect(screen.getByText('Ingresá el código que te enviamos por correo.')).toBeTruthy()
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
  })

  it('con la sesión vencida no cambia nada y ofrece volver a validar el acceso', async () => {
    const { onSesionExpirada } = await montar([
      async () => ({ data: { user: null }, error: errorAuth('AuthSessionMissingError') }),
    ])
    await completar('nueva')
    await waitFor(() => expect(screen.getByText('Tu sesión cambió')).toBeTruthy())
    await fireEvent.press(screen.getByText('Continuar'))
    expect(onSesionExpirada).toHaveBeenCalledTimes(1)
  })

  it('si la sesión pertenece a otro usuario no escribe y descarta el formulario', async () => {
    const { auth } = await montar([], 'u-intruso')
    await completar('nueva')
    await waitFor(() => expect(screen.getByText('Tu sesión cambió')).toBeTruthy())
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cambio-nueva')).toBeNull()
  })

  it('cancelar y la flecha vuelven sin llamar a Auth', async () => {
    const { auth, onVolver } = await montar()
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    await fireEvent.press(screen.getByText('Cancelar'))
    expect(onVolver).toHaveBeenCalledTimes(2)
    expect(auth.getUser).not.toHaveBeenCalled()
  })
})
