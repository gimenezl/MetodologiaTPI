import { ControladorAutenticacion, type EstadoAutenticacion } from '@/servicios/autenticacion'
import type { ClienteEPT } from '@/servicios/supabase'

type EventoAuth = (_evento: string, sesion: { user: { id: string } } | null) => void

function preparar(acceso = 'HABILITADO', rol: string | null = 'PADRE') {
  const estados: EstadoAutenticacion[] = []
  const cambiar = jest.fn((estado: EstadoAutenticacion) => estados.push(estado))
  const callback: { current?: EventoAuth } = {}
  const cliente = {
    auth: {
      onAuthStateChange: jest.fn((escucha: EventoAuth) => {
        callback.current = escucha
        return { data: { subscription: { unsubscribe: jest.fn() } } }
      }),
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
      getUser: jest.fn(async () => ({ data: { user: { id: 'usuario-1' } }, error: null })),
      signInWithPassword: jest.fn(async () => {
        // auth-js notifies listeners with SIGNED_IN before resolving signInWithPassword.
        callback.current?.('SIGNED_IN', { user: { id: 'usuario-1' } })
        return { data: { user: { id: 'usuario-1' }, session: { access_token: 'jwt' } }, error: null }
      }),
      signOut: jest.fn(async () => ({ error: null })),
    },
    rpc: jest.fn(async (nombre: string) => ({ data: nombre === 'mi_estado_acceso' ? acceso : rol, error: null })),
  } as unknown as ClienteEPT
  const controlador = new ControladorAutenticacion(cliente, { cambiar })
  return { controlador, cliente, estados, callback }
}

describe('ControladorAutenticacion', () => {
  it('autoriza solo tras confirmar usuario, estado y rol desde el servidor', async () => {
    const { controlador, cliente, estados } = preparar()
    await controlador.ingresar(' padre@escuela.edu ', 'secreto')
    expect(cliente.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'padre@escuela.edu', password: 'secreto' })
    expect(cliente.auth.getUser).toHaveBeenCalledTimes(1)
    expect(cliente.rpc).toHaveBeenCalledWith('mi_estado_acceso')
    expect(cliente.rpc).toHaveBeenCalledWith('rol_actual')
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'usuario-1', rol: 'PADRE' })
  })

  it.each(['DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE', 'PERSONAL'] as const)('acepta únicamente el rol vigente %s devuelto por la RPC', async rol => {
    const { controlador, estados } = preparar('HABILITADO', rol)
    await controlador.ingresar('a@b.test', 'x')
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'usuario-1', rol })
  })

  it('no autoriza perfiles ausentes, bloqueados ni roles desconocidos', async () => {
    const ausente = preparar('SIN_PERFIL')
    await ausente.controlador.ingresar('a@b.test', 'x')
    expect(ausente.estados.at(-1)).toEqual({ tipo: 'sin_perfil' })
    expect(ausente.cliente.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })

    const bloqueado = preparar('BLOQUEADO')
    await bloqueado.controlador.ingresar('a@b.test', 'x')
    expect(bloqueado.estados.at(-1)).toEqual({ tipo: 'bloqueada' })

    const rolDesconocido = preparar('HABILITADO', 'ROOT')
    await rolDesconocido.controlador.ingresar('a@b.test', 'x')
    expect(rolDesconocido.estados.at(-1)).toEqual({ tipo: 'rol_no_admitido' })
  })

  it.each([
    ['perfil ausente', 'SIN_PERFIL', 'PADRE', 'sin_perfil', true],
    ['cuenta bloqueada', 'BLOQUEADO', 'PADRE', 'bloqueada', true],
    ['rol desconocido', 'HABILITADO', 'ROOT', 'rol_no_admitido', true],
    ['rol permitido', 'HABILITADO', 'PADRE', 'autenticada', false],
  ] as const)('mantiene la transacción de ingreso ante SIGNED_IN síncrono (%s)', async (_caso, acceso, rol, tipoEsperado, cerrarSesion) => {
    const { controlador, cliente, estados, callback } = preparar(acceso, rol)
    const detener = controlador.iniciar()
    await Promise.resolve()
    await Promise.resolve()

    await controlador.ingresar('a@b.test', 'x')

    expect(callback.current).toBeDefined()
    if (cerrarSesion) expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    else expect(cliente.auth.signOut).not.toHaveBeenCalled()
    expect(estados.at(-1)?.tipo).toBe(tipoEsperado)
    detener()
  })

  it('revalida los eventos SIGNED_IN externos cuando no hay una transacción de ingreso en curso', async () => {
    const { controlador, cliente, callback } = preparar()
    const detener = controlador.iniciar()
    await Promise.resolve()
    await Promise.resolve()

    callback.current?.('SIGNED_IN', { user: { id: 'usuario-1' } })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(cliente.auth.getUser).toHaveBeenCalledTimes(1)
    expect(cliente.rpc).toHaveBeenCalledWith('mi_estado_acceso')
    detener()
  })

  it('no publica una autorización tardía del usuario anterior después de un cambio de cuenta', async () => {
    const { controlador, cliente, estados, callback } = preparar()
    let identidadActiva = 'usuario-anterior'
    ;(cliente.auth.getUser as jest.Mock).mockImplementation(async () => ({ data: { user: { id: identidadActiva } }, error: null }))
    const pendientes: ((valor: { data: unknown; error: null }) => void)[] = []
    ;(cliente.rpc as jest.Mock).mockImplementation(() => new Promise(resolve => pendientes.push(resolve)))
    const detener = controlador.iniciar()
    await Promise.resolve()

    callback.current?.('SIGNED_IN', { user: { id: 'usuario-anterior' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(pendientes).toHaveLength(2)

    identidadActiva = 'usuario-actual'
    callback.current?.('TOKEN_REFRESHED', { user: { id: 'usuario-actual' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(pendientes).toHaveLength(4)
    pendientes[2]?.({ data: 'HABILITADO', error: null })
    pendientes[3]?.({ data: 'ESTUDIANTE', error: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'usuario-actual', rol: 'ESTUDIANTE' })

    pendientes[0]?.({ data: 'HABILITADO', error: null })
    pendientes[1]?.({ data: 'PADRE', error: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'usuario-actual', rol: 'ESTUDIANTE' })
    expect(estados).not.toContainEqual({ tipo: 'autenticada', usuarioId: 'usuario-anterior', rol: 'PADRE' })
    detener()
  })

  it('revalida la sesión de nuevo si cambia mientras getSession está pendiente', async () => {
    const { controlador, cliente, callback, estados } = preparar()
    const sesiones: ((valor: { data: { session: { user: { id: string } } | null }; error: null }) => void)[] = []
    ;(cliente.auth.getSession as jest.Mock).mockImplementation(() => new Promise(resolve => sesiones.push(resolve)))
    ;(cliente.auth.getUser as jest.Mock).mockImplementation(async () => ({ data: { user: { id: 'usuario-actual' } }, error: null }))
    const detener = controlador.iniciar()
    await Promise.resolve()
    const revalidacion = controlador.revalidar()
    callback.current?.('SIGNED_IN', { user: { id: 'usuario-actual' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    sesiones[0]?.({ data: { session: { user: { id: 'usuario-anterior' } } }, error: null })
    sesiones[1]?.({ data: { session: { user: { id: 'usuario-actual' } } }, error: null })
    await revalidacion
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(estados).not.toContainEqual(expect.objectContaining({ usuarioId: 'usuario-anterior' }))
    detener()
  })

  it('presenta un único error de credenciales y no filtra detalles del proveedor', async () => {
    const { controlador, cliente, estados } = preparar()
    ;(cliente.auth.signInWithPassword as jest.Mock).mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } })
    await expect(controlador.ingresar('a@b.test', 'bad')).rejects.toThrow('No se pudo iniciar sesión. Revisá el correo y la contraseña.')
    expect(estados.at(-1)).toEqual({ tipo: 'sin_sesion' })
  })

  it('no invalida localmente una sesión vigente ante una falla temporal de autorización', async () => {
    const { controlador, cliente, estados } = preparar()
    ;(cliente.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'network down' } })
    await expect(controlador.ingresar('a@b.test', 'x')).rejects.toThrow('No se pudo verificar tu acceso. Comprobá la conexión e intentá nuevamente.')
    expect(estados.at(-1)?.tipo).toBe('error_conexion')
    expect(cliente.auth.signOut).not.toHaveBeenCalled()
  })

  it('limpia el contexto autorizado al cerrar sesión aunque el servidor no responda', async () => {
    const { controlador, cliente, estados } = preparar()
    await controlador.ingresar('a@b.test', 'x')
    ;(cliente.auth.signOut as jest.Mock).mockRejectedValue(new Error('network down'))
    await controlador.salir()
    expect(estados.at(-1)).toEqual({ tipo: 'sin_sesion' })
  })
})
