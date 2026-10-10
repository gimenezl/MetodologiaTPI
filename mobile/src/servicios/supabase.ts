// Cliente Supabase único del dispositivo.
//
// - Un solo cliente por proceso (`obtenerClienteSupabase`), independiente del cliente SSR de la web.
// - Solo URL y clave pública: ninguna clave privilegiada de servidor existe en el dispositivo.
// - La sesión se persiste con almacenamiento cifrado fragmentado (almacenamiento-seguro.ts).
// - El refresco automático sigue al estado de la aplicación (AppState) y no se duplica.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native'

import type { Database } from '@/compartido/database.generated'
import { entornoDelBundle, type EntornoPublico } from '@/configuracion/entorno'
import { crearAlmacenamientoSeguro, type AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'

export type ClienteEPT = SupabaseClient<Database>

export class ErrorDeConfiguracion extends Error {
  readonly motivos: readonly string[]
  constructor(motivos: readonly string[]) {
    super('La configuración pública de la aplicación no es válida.')
    this.name = 'ErrorDeConfiguracion'
    this.motivos = motivos
  }
}

export function crearClienteSupabase(entorno: EntornoPublico, almacenamiento: AlmacenamientoSeguro): ClienteEPT {
  return createClient<Database>(entorno.supabaseUrl, entorno.supabaseAnonKey, {
    auth: {
      storage: almacenamiento,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}

const CLAVE_SINGLETON = Symbol.for('ept.mobile.supabase.cliente')
type ContenedorGlobal = { [CLAVE_SINGLETON]?: ClienteEPT }

/** Devuelve siempre la misma instancia, incluso si el módulo se evalúa de nuevo (recarga rápida). */
export function obtenerClienteSupabase(): ClienteEPT {
  const contenedor = globalThis as unknown as ContenedorGlobal
  const existente = contenedor[CLAVE_SINGLETON]
  if (existente) return existente
  const resultado = entornoDelBundle()
  if (!resultado.ok) throw new ErrorDeConfiguracion(resultado.motivos)
  const cliente = crearClienteSupabase(resultado.entorno, crearAlmacenamientoSeguro())
  contenedor[CLAVE_SINGLETON] = cliente
  return cliente
}

/** Solo para pruebas: descarta el singleton. */
export function reiniciarClienteParaPruebas(): void {
  delete (globalThis as unknown as ContenedorGlobal)[CLAVE_SINGLETON]
}

export interface FuenteEstadoApp {
  readonly currentState: AppStateStatus
  addEventListener(tipo: 'change', escucha: (estado: AppStateStatus) => void): NativeEventSubscription
}

type ClienteAuth = Pick<ClienteEPT['auth'], 'startAutoRefresh' | 'stopAutoRefresh'>

interface Registro {
  referencias: number
  suscripcion: NativeEventSubscription
}

const registros = new WeakMap<object, Registro>()

/**
 * Enlaza el refresco de sesión al ciclo de vida: activo en primer plano, detenido en segundo plano.
 * Es idempotente por cliente: llamarlo varias veces comparte un único listener; el último en limpiar
 * lo retira y detiene el refresco.
 */
export function vincularCicloDeVida(
  cliente: { auth: ClienteAuth },
  estadoApp: FuenteEstadoApp = AppState
): () => void {
  const existente = registros.get(cliente)
  if (existente) {
    existente.referencias += 1
  } else {
    const aplicar = (estado: AppStateStatus) => {
      if (estado === 'active') void cliente.auth.startAutoRefresh()
      else void cliente.auth.stopAutoRefresh()
    }
    aplicar(estadoApp.currentState)
    registros.set(cliente, { referencias: 1, suscripcion: estadoApp.addEventListener('change', aplicar) })
  }
  let liberado = false
  return () => {
    if (liberado) return
    liberado = true
    const registro = registros.get(cliente)
    if (!registro) return
    registro.referencias -= 1
    if (registro.referencias <= 0) {
      registro.suscripcion.remove()
      registros.delete(cliente)
      void cliente.auth.stopAutoRefresh()
    }
  }
}
