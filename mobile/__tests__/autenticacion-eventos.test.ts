import { ControladorAutenticacion, type EstadoAutenticacion } from '@/servicios/autenticacion'
import { reiniciarRecuperacionParaPruebas } from '@/servicios/recuperacion-activa'
import { ControladorRecuperacion } from '@/servicios/recuperacion-controlador'
import type { ClienteEPT } from '@/servicios/supabase'

type Evento = 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY' | 'USER_UPDATED' | 'TOKEN_REFRESHED' | 'INITIAL_SESSION'
type Escucha = (evento: Evento, sesion: { user: { id: string } } | null) => void

async function preparar(recuperacion: { activa: boolean } | undefined = { activa: false }, compuertaPorDefecto = false) {
  const estados: EstadoAutenticacion[] = []
  const escucha: { actual?: Escucha } = {}
  const cliente = {
    auth: {
      onAuthStateChange: jest.fn((fn: Escucha) => {
        escucha.actual = fn
        return { data: { subscription: { unsubscribe: jest.fn() } } }
      }),
      getSession: jest.fn(async () => ({ data: { session: { user: { id: 'u-1' } } }, error: null })),
      getUser: jest.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(async () => ({ error: null })),
    },
    rpc: jest.fn(async (nombre: string) => ({ data: nombre === 'mi_estado_acceso' ? 'HABILITADO' : 'PADRE', error: null })),
  } as unknown as ClienteEPT
  const controlador = compuertaPorDefecto
    ? new ControladorAutenticacion(cliente, { cambiar: e => estados.push(e) })
    : new ControladorAutenticacion(cliente, { cambiar: e => estados.push(e) }, () => recuperacion.activa)
  const detener = controlador.iniciar()
  // La lectura inicial de la sesión publica su propio estado: se descarta para medir solo cada evento.
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
  estados.length = 0
  ;(cliente.rpc as jest.Mock).mockClear()
  ;(cliente.auth.getUser as jest.Mock).mockClear()
  const emitir = async (evento: Evento, id: string | null = 'u-1') => {
    escucha.actual?.(evento, id ? { user: { id } } : null)
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return { controlador, cliente, estados, emitir, detener, recuperacion }
}

describe('cableado real de la compuerta de recuperación', () => {
  afterEach(() => reiniciarRecuperacionParaPruebas())

  it('con la compuerta por defecto, ControladorRecuperacion.iniciar() hace que el acceso ignore los eventos y detener() los reanuda', async () => {
    const { cliente, estados, emitir, detener } = await preparar(undefined, true)
    const recuperacion = new ControladorRecuperacion({ auth: cliente.auth } as never, () => undefined)
    recuperacion.iniciar()
    for (const evento of ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'] as const) await emitir(evento, 'u-recuperado')
    await emitir('SIGNED_OUT', null)
    expect(estados).toEqual([])
    expect(cliente.rpc).not.toHaveBeenCalled()
    recuperacion.detener()
    await emitir('SIGNED_IN', 'u-1')
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'u-1', rol: 'PADRE' })
    detener()
  })
})

describe('eventos de Auth y recuperación de contraseña', () => {
  it('SIGNED_IN y TOKEN_REFRESHED revalidan al mismo usuario sin cambiar de rol', async () => {
    const { estados, emitir, detener } = await preparar()
    await emitir('SIGNED_IN')
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'u-1', rol: 'PADRE' })
    estados.length = 0
    await emitir('TOKEN_REFRESHED')
    // Primero `revalidando` (la interfaz conserva la vista: ver estadoVisible) y luego el mismo usuario.
    expect(estados.map(e => e.tipo)).toEqual(['revalidando', 'autenticada'])
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'u-1', rol: 'PADRE' })
    detener()
  })

  it('USER_UPDATED (cambio de contraseña desde el perfil) revalida y conserva al usuario', async () => {
    const { estados, emitir, detener } = await preparar()
    await emitir('USER_UPDATED')
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'u-1', rol: 'PADRE' })
    detener()
  })

  it('PASSWORD_RECOVERY nunca es un ingreso: no consulta roles ni publica estados', async () => {
    const { cliente, estados, emitir, detener } = await preparar()
    await emitir('PASSWORD_RECOVERY')
    expect(estados).toEqual([])
    expect(cliente.rpc).not.toHaveBeenCalled()
    detener()
  })

  it('durante una recuperación en curso se ignoran SIGNED_IN, TOKEN_REFRESHED y SIGNED_OUT', async () => {
    const { cliente, estados, emitir, detener, recuperacion } = await preparar({ activa: true })
    for (const evento of ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'] as const) await emitir(evento, 'u-recuperado')
    await emitir('SIGNED_OUT', null)
    expect(estados).toEqual([])
    expect(cliente.rpc).not.toHaveBeenCalled()
    expect(cliente.auth.getUser).not.toHaveBeenCalled()
    // Al terminar la recuperación, el mismo evento vuelve a tratarse de forma ordinaria.
    recuperacion.activa = false
    await emitir('SIGNED_OUT', null)
    expect(estados.at(-1)).toEqual({ tipo: 'sin_sesion' })
    detener()
  })

  it('revalidar() no hace nada mientras la recuperación está en curso', async () => {
    const { controlador, cliente, estados, detener } = await preparar({ activa: true })
    await controlador.revalidar()
    expect(estados).toEqual([])
    expect(cliente.auth.getSession).toHaveBeenCalledTimes(1) // solo la lectura inicial de iniciar()
    detener()
  })

  it('un cambio de usuario real (otra cuenta) se refleja sin conservar la cuenta anterior', async () => {
    const { cliente, estados, emitir, detener } = await preparar()
    await emitir('SIGNED_IN', 'u-1')
    ;(cliente.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'u-2' } }, error: null })
    await emitir('SIGNED_IN', 'u-2')
    expect(estados.at(-1)).toEqual({ tipo: 'autenticada', usuarioId: 'u-2', rol: 'PADRE' })
    await emitir('SIGNED_OUT', null)
    expect(estados.at(-1)).toEqual({ tipo: 'sin_sesion' })
    detener()
  })
})
