import { interpretarEnlace } from '@/servicios/recuperacion'
import {
  ControladorRecuperacion,
  reiniciarIntercambiosParaPruebas,
  type EstadoRecuperacion,
} from '@/servicios/recuperacion-controlador'
import {
  alLiberarRecuperacion,
  recuperacionActiva,
  reiniciarRecuperacionParaPruebas,
  type LiberacionRecuperacion,
} from '@/servicios/recuperacion-activa'

const CODIGO_A = '34e770dd-9ff9-416c-87fa-43b31d7ef225'
const CODIGO_B = '99999999-aaaa-bbbb-cccc-111111111111'
const FLUJO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const url = (codigo: string) => `educarparatransformar://restablecer?code=${codigo}&sb_flow_id=${FLUJO}`

function errorAuth(nombre: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('detalle'), { name: nombre, ...extra })
}

function diferido<T>() {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>(resolve => { resolver = resolve })
  return { promesa, resolver }
}

function preparar(opciones: {
  sesionPrevia?: string | null
  intercambio?: () => Promise<unknown>
  actualizacion?: () => Promise<unknown>
  usuarioActual?: string
} = {}) {
  const estados: EstadoRecuperacion[] = []
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: opciones.sesionPrevia ? { user: { id: opciones.sesionPrevia } } : null }, error: null })),
    exchangeCodeForSession: jest.fn(opciones.intercambio ?? (async () => ({
      data: { session: { user: { id: 'u-recuperado' } }, user: { id: 'u-recuperado' }, redirectType: 'recovery' }, error: null,
    }))),
    getUser: jest.fn(async () => ({ data: { user: { id: opciones.usuarioActual ?? 'u-recuperado' } }, error: null })),
    updateUser: jest.fn(opciones.actualizacion ?? (async () => ({ data: { user: { id: 'u-recuperado' } }, error: null }))),
    signOut: jest.fn(async () => ({ error: null })),
  }
  const controlador = new ControladorRecuperacion({ auth } as never, estado => estados.push(estado))
  return { auth, controlador, estados, ultimo: () => estados.at(-1) }
}

beforeEach(() => {
  reiniciarIntercambiosParaPruebas()
  reiniciarRecuperacionParaPruebas()
})

describe('ControladorRecuperacion', () => {
  it('canjea el enlace, habilita el formulario y cambia la contraseña del usuario verificado', async () => {
    const { auth, controlador, ultimo } = preparar()
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(CODIGO_A, { flowId: FLUJO })
    expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado' })

    await controlador.guardar('contraseña-nueva', 'contraseña-nueva')
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'contraseña-nueva' })
    // La sesión del enlace no queda como ingreso: la persona entra con la contraseña nueva.
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(ultimo()).toEqual({ tipo: 'exito' })
  })

  it('abre la compuerta de recuperación y la libera, avisando si la sesión cambió', async () => {
    const liberaciones: LiberacionRecuperacion[] = []
    alLiberarRecuperacion(l => liberaciones.push(l))
    const { controlador } = preparar()
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    expect(recuperacionActiva()).toBe(true)
    controlador.detener()
    // La sesión del canje se cierra ANTES de devolver el control al acceso ordinario.
    await Promise.resolve()
    await Promise.resolve()
    expect(recuperacionActiva()).toBe(false)
    expect(liberaciones).toEqual([{ sesionAlterada: true }])
    controlador.detener() // idempotente
    expect(liberaciones).toHaveLength(1)
  })

  it('salir sin terminar (cancelar, atrás o gesto) cierra la sesión que creó el canje: el enlace no equivale a un ingreso', async () => {
    const orden: string[] = []
    alLiberarRecuperacion(() => orden.push('liberada'))
    const { auth, controlador, ultimo } = preparar()
    auth.signOut.mockImplementation(async () => {
      await Promise.resolve()
      orden.push('signOut')
      return { error: null }
    })
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado' })
    controlador.cancelar()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(orden).toEqual(['signOut', 'liberada'])
  })

  it('salir con el canje en vuelo cierra la sesión apenas llega el resultado', async () => {
    const lento = diferido<unknown>()
    const { auth, controlador } = preparar({ intercambio: () => lento.promesa })
    const pendiente = controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    for (let i = 0; i < 4; i++) await Promise.resolve()
    controlador.detener()
    expect(auth.signOut).not.toHaveBeenCalled()
    lento.resolver({ data: { session: { user: { id: 'u-recuperado' } }, user: { id: 'u-recuperado' }, redirectType: 'recovery' }, error: null })
    await pendiente
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('no cierra la sesión si otra instancia de la pantalla ya tomó el relevo del mismo canje', async () => {
    const lento = diferido<unknown>()
    const { auth, controlador } = preparar({ intercambio: () => lento.promesa })
    const pendiente = controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    for (let i = 0; i < 4; i++) await Promise.resolve()
    controlador.detener()
    const relevo = preparar({ intercambio: () => lento.promesa })
    relevo.controlador.iniciar()
    lento.resolver({ data: { session: { user: { id: 'u-recuperado' } }, user: { id: 'u-recuperado' }, redirectType: 'recovery' }, error: null })
    await pendiente
    expect(auth.signOut).not.toHaveBeenCalled()
    relevo.controlador.detener()
  })

  it('un enlace nuevo no interrumpe un guardado en curso', async () => {
    const lento = diferido<unknown>()
    const { auth, controlador, ultimo } = preparar({ actualizacion: () => lento.promesa })
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    const guardando = controlador.guardar('nueva', 'nueva')
    await Promise.resolve()
    expect(ultimo()).toEqual({ tipo: 'guardando', usuarioId: 'u-recuperado' })
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_B)))
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(ultimo()).toEqual({ tipo: 'guardando', usuarioId: 'u-recuperado' })
    lento.resolver({ data: { user: { id: 'u-recuperado' } }, error: null })
    await guardando
    expect(ultimo()).toEqual({ tipo: 'exito' })
  })

  it('un enlace inválido o de otro destino no toca la sesión ni llama a Auth', async () => {
    const { auth, controlador, ultimo } = preparar()
    await controlador.procesarEnlace(interpretarEnlace('educarparatransformar://otra?code=abc'))
    expect(ultimo()).toEqual({ tipo: 'enlace_no_valido', causa: 'no_admitido' })
    await controlador.procesarEnlace(interpretarEnlace('educarparatransformar://restablecer?code=x'))
    expect(ultimo()).toEqual({ tipo: 'enlace_no_valido', causa: 'invalido' })
    await controlador.procesarEnlace(interpretarEnlace('educarparatransformar://restablecer?error=access_denied&error_code=otp_expired'))
    expect(ultimo()).toEqual({ tipo: 'enlace_no_valido', causa: 'expirado' })
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it.each([
    ['vencido o usado', errorAuth('AuthApiError', { status: 400, code: 'flow_state_not_found' }), 'usado'],
    ['sin verificador', errorAuth('AuthPKCECodeVerifierMissingError'), 'sin_verificador'],
    ['sin conexión', errorAuth('AuthRetryableFetchError', { status: 0 }), 'sin_conexion'],
  ])('muestra el enlace %s y no habilita el cambio', async (_caso, error, causa) => {
    const { auth, controlador, ultimo } = preparar({ intercambio: async () => ({ data: { session: null, user: null }, error }) })
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    expect(ultimo()).toEqual({ tipo: 'enlace_no_valido', causa })
    await controlador.guardar('x', 'x')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('un código que no es de recuperación no abre el formulario', async () => {
    const { auth, controlador, ultimo } = preparar({
      intercambio: async () => ({ data: { session: { user: { id: 'u-1' } }, user: { id: 'u-1' }, redirectType: null }, error: null }),
    })
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    expect(ultimo()).toEqual({ tipo: 'enlace_no_valido', causa: 'no_es_recuperacion' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('la entrega doble del mismo enlace canjea el código una sola vez', async () => {
    const lento = diferido<unknown>()
    const { auth, controlador, ultimo } = preparar({ intercambio: () => lento.promesa })
    const primera = controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    const segunda = controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    await Promise.resolve()
    lento.resolver({ data: { session: { user: { id: 'u-recuperado' } }, user: { id: 'u-recuperado' }, redirectType: 'recovery' }, error: null })
    await Promise.all([primera, segunda])
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado' })
  })

  it('el remonte de la pantalla con el enlace ya canjeado reutiliza el resultado, no vuelve a canjear', async () => {
    const primero = preparar()
    await primero.controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    primero.controlador.detener()

    const segundo = preparar({ sesionPrevia: 'u-recuperado' })
    await segundo.controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    expect(segundo.auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(segundo.ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado' })

    // Sin la sesión verificada (ya se cerró), el mismo enlace figura como usado.
    const tercero = preparar({ sesionPrevia: null })
    await tercero.controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    expect(tercero.ultimo()).toEqual({ tipo: 'enlace_no_valido', causa: 'usado' })
  })

  describe('con la sesión de otra cuenta', () => {
    it('pide confirmación y no canjea antes de recibirla', async () => {
      const { auth, controlador, ultimo } = preparar({ sesionPrevia: 'u-otra' })
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      expect(ultimo()).toEqual({ tipo: 'confirmar_reemplazo' })
      expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
      expect(auth.signOut).not.toHaveBeenCalled()
    })

    it('cancelar deja intacta la sesión de la otra cuenta y no avisa de cambios', async () => {
      const liberaciones: LiberacionRecuperacion[] = []
      alLiberarRecuperacion(l => liberaciones.push(l))
      const { auth, controlador } = preparar({ sesionPrevia: 'u-otra' })
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      controlador.cancelar()
      expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
      expect(auth.signOut).not.toHaveBeenCalled()
      expect(liberaciones).toEqual([{ sesionAlterada: false }])
    })

    it('confirmar canjea el enlace y solo cambia la contraseña de la cuenta verificada', async () => {
      const { auth, controlador, ultimo } = preparar({ sesionPrevia: 'u-otra' })
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      await controlador.confirmarReemplazo()
      expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado' })
      await controlador.guardar('nueva', 'nueva')
      expect(auth.updateUser).toHaveBeenCalledTimes(1)
      expect(ultimo()).toEqual({ tipo: 'exito' })
    })

    it('si la sesión cambia de usuario antes de guardar, no se modifica ninguna contraseña', async () => {
      const { auth, controlador, ultimo } = preparar({ usuarioActual: 'u-intruso' })
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      await controlador.guardar('nueva', 'nueva')
      expect(auth.updateUser).not.toHaveBeenCalled()
      expect(ultimo()).toEqual({ tipo: 'enlace_no_valido', causa: 'sesion_vencida' })
    })
  })

  it('un segundo enlace distinto reinicia el flujo y el primero ya no puede escribir', async () => {
    const lento = diferido<unknown>()
    let llamadas = 0
    const { auth, controlador, ultimo } = preparar({
      intercambio: () => {
        llamadas += 1
        return llamadas === 1
          ? lento.promesa
          : Promise.resolve({ data: { session: { user: { id: 'u-B' } }, user: { id: 'u-B' }, redirectType: 'recovery' }, error: null })
      },
    })
    const primera = controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    await Promise.resolve()
    await Promise.resolve()
    await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_B)))
    expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-B' })
    lento.resolver({ data: { session: { user: { id: 'u-A' } }, user: { id: 'u-A' }, redirectType: 'recovery' }, error: null })
    await primera
    expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-B' })
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(2)
  })

  it('una respuesta que llega tras salir de la pantalla se descarta', async () => {
    const lento = diferido<unknown>()
    const { controlador, estados } = preparar({ intercambio: () => lento.promesa })
    const pendiente = controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
    await Promise.resolve()
    await Promise.resolve()
    controlador.detener()
    const cantidad = estados.length
    lento.resolver({ data: { session: { user: { id: 'u-recuperado' } }, user: { id: 'u-recuperado' }, redirectType: 'recovery' }, error: null })
    await pendiente
    expect(estados).toHaveLength(cantidad)
  })

  describe('guardar', () => {
    it('valida sin llamar a Auth: vacío y confirmación distinta', async () => {
      const { auth, controlador, ultimo } = preparar()
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      await controlador.guardar('', '')
      expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado', error: 'Ingresá la nueva contraseña.' })
      await controlador.guardar('uno', 'dos')
      expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado', error: 'Las contraseñas no coinciden.' })
      expect(auth.updateUser).not.toHaveBeenCalled()
    })

    it('el doble toque envía una sola vez', async () => {
      const lento = diferido<unknown>()
      const { auth, controlador, ultimo } = preparar({ actualizacion: () => lento.promesa })
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      const a = controlador.guardar('nueva', 'nueva')
      const b = controlador.guardar('nueva', 'nueva')
      lento.resolver({ data: { user: { id: 'u-recuperado' } }, error: null })
      await Promise.all([a, b])
      expect(auth.updateUser).toHaveBeenCalledTimes(1)
      expect(ultimo()).toEqual({ tipo: 'exito' })
    })

    it('un rechazo del servicio vuelve al formulario con el mensaje en español, sin cerrar la sesión', async () => {
      const { auth, controlador, ultimo } = preparar({
        actualizacion: async () => ({ data: { user: null }, error: errorAuth('AuthApiError', { status: 422, code: 'same_password' }) }),
      })
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      await controlador.guardar('igual', 'igual')
      expect(ultimo()).toEqual({ tipo: 'formulario', usuarioId: 'u-recuperado', error: 'La nueva contraseña debe ser distinta de la actual.' })
      expect(auth.signOut).not.toHaveBeenCalled()
    })

    it('si la verificación venció antes de guardar, pide un enlace nuevo y no escribe', async () => {
      const { controlador, ultimo } = preparar({
        actualizacion: async () => ({ data: { user: null }, error: errorAuth('AuthSessionMissingError') }),
      })
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      await controlador.guardar('nueva', 'nueva')
      expect(ultimo()).toEqual({ tipo: 'enlace_no_valido', causa: 'sesion_vencida' })
    })

    it('si el cierre local falla después del cambio, el éxito se conserva', async () => {
      const { auth, controlador, ultimo } = preparar()
      auth.signOut.mockRejectedValueOnce(new Error('almacén bloqueado'))
      await controlador.procesarEnlace(interpretarEnlace(url(CODIGO_A)))
      await controlador.guardar('nueva', 'nueva')
      expect(ultimo()).toEqual({ tipo: 'exito' })
    })
  })
})
