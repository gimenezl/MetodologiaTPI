import type { AppStateStatus } from 'react-native'

import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

const ENTORNO = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://proyecto.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abcdefghij',
  EXPO_PUBLIC_API_BASE_URL: 'https://app.educarparatransformar.example',
}

function cargarModulo() {
  jest.resetModules()
  Object.assign(process.env, ENTORNO)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/servicios/supabase') as typeof import('@/servicios/supabase')
}

class EstadoAppFalso {
  currentState: AppStateStatus = 'active'
  escuchas = new Set<(e: AppStateStatus) => void>()
  addEventListener = jest.fn((_t: 'change', fn: (e: AppStateStatus) => void) => {
    this.escuchas.add(fn)
    return { remove: jest.fn(() => this.escuchas.delete(fn)) }
  })
  emitir(e: AppStateStatus) {
    this.currentState = e
    this.escuchas.forEach(fn => fn(e))
  }
}

describe('cliente Supabase único', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('ept.mobile.supabase.cliente')]
  })

  it('devuelve siempre la misma instancia', () => {
    const { obtenerClienteSupabase } = cargarModulo()
    expect(obtenerClienteSupabase()).toBe(obtenerClienteSupabase())
  })

  it('conserva la instancia aunque el módulo se evalúe de nuevo', () => {
    const primero = cargarModulo().obtenerClienteSupabase()
    const segundo = cargarModulo().obtenerClienteSupabase()
    expect(segundo).toBe(primero)
  })

  it('falla de forma explícita con configuración inválida, sin crear cliente', () => {
    const { obtenerClienteSupabase, ErrorDeConfiguracion } = cargarModulo()
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = ''
    expect(() => obtenerClienteSupabase()).toThrow(ErrorDeConfiguracion)
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = ENTORNO.EXPO_PUBLIC_SUPABASE_ANON_KEY
  })

  it('persiste la sesión en el almacenamiento seguro y no detecta sesión en la URL', async () => {
    const { crearClienteSupabase } = cargarModulo()
    const guardado = new Map<string, string>()
    const almacen: AlmacenamientoSeguro = {
      getItem: async k => guardado.get(k) ?? null,
      setItem: async (k, v) => void guardado.set(k, v),
      removeItem: async k => void guardado.delete(k),
    }
    const cliente = crearClienteSupabase(
      { supabaseUrl: ENTORNO.EXPO_PUBLIC_SUPABASE_URL, supabaseAnonKey: ENTORNO.EXPO_PUBLIC_SUPABASE_ANON_KEY, apiBaseUrl: ENTORNO.EXPO_PUBLIC_API_BASE_URL },
      almacen
    )
    expect((await cliente.auth.getSession()).data.session).toBeNull()
    await cliente.auth.stopAutoRefresh()
  })
})

describe('ciclo de vida del refresco', () => {
  function clienteFalso() {
    return { auth: { startAutoRefresh: jest.fn(async () => undefined), stopAutoRefresh: jest.fn(async () => undefined) } }
  }

  it('inicia el refresco en primer plano y lo detiene en segundo plano', () => {
    const { vincularCicloDeVida } = cargarModulo()
    const app = new EstadoAppFalso()
    const c = clienteFalso()
    vincularCicloDeVida(c, app)
    expect(c.auth.startAutoRefresh).toHaveBeenCalledTimes(1)
    app.emitir('background')
    expect(c.auth.stopAutoRefresh).toHaveBeenCalledTimes(1)
    app.emitir('active')
    expect(c.auth.startAutoRefresh).toHaveBeenCalledTimes(2)
  })

  it('no duplica listeners y limpia solo al liberar el último', () => {
    const { vincularCicloDeVida } = cargarModulo()
    const app = new EstadoAppFalso()
    const c = clienteFalso()
    const a = vincularCicloDeVida(c, app)
    const b = vincularCicloDeVida(c, app)
    expect(app.addEventListener).toHaveBeenCalledTimes(1)
    expect(app.escuchas.size).toBe(1)
    a()
    expect(app.escuchas.size).toBe(1)
    b()
    expect(app.escuchas.size).toBe(0)
    expect(c.auth.stopAutoRefresh).toHaveBeenCalled()
  })

  it('liberar dos veces la misma suscripción es inocuo', () => {
    const { vincularCicloDeVida } = cargarModulo()
    const app = new EstadoAppFalso()
    const c = clienteFalso()
    const a = vincularCicloDeVida(c, app)
    const b = vincularCicloDeVida(c, app)
    a()
    a()
    expect(app.escuchas.size).toBe(1)
    b()
    expect(app.escuchas.size).toBe(0)
  })

  it('arranca detenido si la app está en segundo plano', () => {
    const { vincularCicloDeVida } = cargarModulo()
    const app = new EstadoAppFalso()
    app.currentState = 'background'
    const c = clienteFalso()
    vincularCicloDeVida(c, app)
    expect(c.auth.startAutoRefresh).not.toHaveBeenCalled()
    expect(c.auth.stopAutoRefresh).toHaveBeenCalledTimes(1)
  })
})
