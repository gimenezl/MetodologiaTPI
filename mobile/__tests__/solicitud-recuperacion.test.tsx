import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { SolicitudRecuperacionContenedor } from '@/contenedores/recuperacion/SolicitudRecuperacionContenedor'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

function errorAuth(nombre: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('detalle interno'), { name: nombre, ...extra })
}

async function montar(respuesta: () => Promise<unknown> = async () => ({ data: {}, error: null }), esperaSegundos = 60) {
  const resetPasswordForEmail = jest.fn(respuesta)
  const onVolver = jest.fn()
  const cliente = { auth: { resetPasswordForEmail } }
  const utilidades = await render(<SolicitudRecuperacionContenedor cliente={cliente as never} onVolver={onVolver} esperaSegundos={esperaSegundos} />)
  return { resetPasswordForEmail, onVolver, utilidades }
}

describe('solicitud del correo de recuperación', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('valida el correo antes de llamar a Auth', async () => {
    const { resetPasswordForEmail } = await montar()
    await fireEvent.press(screen.getByText('Enviar enlace'))
    expect(screen.getByText('Ingresá tu correo electrónico.')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('recuperar-correo'), 'no-es-un-correo')
    await fireEvent.press(screen.getByText('Enviar enlace'))
    expect(screen.getByText('Ingresá un correo electrónico válido.')).toBeTruthy()
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('envía el correo normalizado y confirma sin revelar si la cuenta existe', async () => {
    const { resetPasswordForEmail } = await montar()
    await fireEvent.changeText(screen.getByTestId('recuperar-correo'), '  familia@escuela.edu.ar ')
    await fireEvent.press(screen.getByText('Enviar enlace'))
    await waitFor(() => expect(screen.getByText('Revisá tu correo')).toBeTruthy())
    expect(resetPasswordForEmail).toHaveBeenCalledWith('familia@escuela.edu.ar', { redirectTo: 'educarparatransformar://restablecer' })
    const confirmacion = screen.getByText(/Si el correo corresponde a una cuenta/u)
    expect(confirmacion.props.children).not.toMatch(/no existe|no está registrado|inexistente/iu)
  })

  it('el doble toque envía una sola solicitud', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const { resetPasswordForEmail } = await montar(() => new Promise(resolve => { resolver = resolve }))
    await fireEvent.changeText(screen.getByTestId('recuperar-correo'), 'a@b.test')
    const boton = screen.getByText('Enviar enlace')
    await fireEvent.press(boton)
    await fireEvent.press(boton)
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1)
    await act(async () => { resolver({ data: {}, error: null }) })
    await waitFor(() => expect(screen.getByText('Revisá tu correo')).toBeTruthy())
  })

  it('tras enviar bloquea el reenvío y lo habilita al terminar la espera', async () => {
    jest.useFakeTimers()
    const { resetPasswordForEmail } = await montar(undefined, 3)
    await fireEvent.changeText(screen.getByTestId('recuperar-correo'), 'a@b.test')
    await fireEvent.press(screen.getByText('Enviar enlace'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(/Podés pedir otro enlace en/u)).toBeTruthy()
    await fireEvent.press(screen.getByText('Reenviar enlace'))
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1)
    // Cada segundo reprograma el siguiente: se avanza de a uno, como el reloj real.
    for (let i = 0; i < 3; i++) await act(async () => { jest.advanceTimersByTime(1000) })
    expect(screen.queryByText(/Podés pedir otro enlace en/u)).toBeNull()
    await fireEvent.press(screen.getByText('Reenviar enlace'))
    await act(async () => { await Promise.resolve() })
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['sin conexión', errorAuth('AuthRetryableFetchError', { status: 0 }), /No pudimos conectarnos/u],
    ['límite del proveedor', errorAuth('AuthApiError', { status: 429, code: 'over_email_send_rate_limit' }), /demasiados correos/u],
    ['falla del servicio', errorAuth('AuthApiError', { status: 500 }), /No pudimos enviar el correo/u],
  ])('informa el error real: %s', async (_caso, error, texto) => {
    await montar(async () => ({ data: null, error }))
    await fireEvent.changeText(screen.getByTestId('recuperar-correo'), 'a@b.test')
    await fireEvent.press(screen.getByText('Enviar enlace'))
    await waitFor(() => expect(screen.getByText(texto)).toBeTruthy())
    expect(screen.queryByText('Revisá tu correo')).toBeNull()
    expect(screen.queryByText(/detalle interno/u)).toBeNull()
  })

  it('volver y cancelar no envían nada', async () => {
    const { resetPasswordForEmail, onVolver } = await montar()
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    await fireEvent.press(screen.getByText('Volver al inicio de sesión'))
    expect(onVolver).toHaveBeenCalledTimes(2)
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('una respuesta que llega tras desmontar no actualiza el estado', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const { utilidades } = await montar(() => new Promise(resolve => { resolver = resolve }))
    await fireEvent.changeText(screen.getByTestId('recuperar-correo'), 'a@b.test')
    await fireEvent.press(screen.getByText('Enviar enlace'))
    const errores = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await utilidades.unmount()
    resolver({ data: {}, error: null })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(errores).not.toHaveBeenCalled()
    errores.mockRestore()
  })
})
