// Configuración pública del dispositivo: URL del proyecto, clave pública y origen del servidor web.
// Las variables EXPO_PUBLIC_* se incrustan en el bundle, por eso aquí se rechazan claves privilegiadas.
import Constants from 'expo-constants'
import { Platform } from 'react-native'

export interface EntornoPublico {
  supabaseUrl: string
  supabaseAnonKey: string
  apiBaseUrl: string
}

export type ResultadoEntorno =
  | { ok: true; entorno: EntornoPublico }
  | { ok: false; motivos: readonly string[] }

export interface VariablesCrudas {
  EXPO_PUBLIC_SUPABASE_URL?: string
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string
  EXPO_PUBLIC_API_BASE_URL?: string
}

export interface OpcionesEntorno {
  /** Solo se habilita en builds e2e efímeros que esperan el Supabase local exacto del runner. */
  authIntegracionLocal?: boolean
  plataforma?: 'android' | 'ios'
}

function decodificarBase64Url(segmento: string): string | null {
  try {
    const normal = segmento.replace(/-/gu, '+').replace(/_/gu, '/')
    const relleno = normal + '='.repeat((4 - (normal.length % 4)) % 4)
    const decodificar = (globalThis as { atob?: (s: string) => string }).atob
    return decodificar ? decodificar(relleno) : null
  } catch {
    return null
  }
}

/**
 * Rol declarado por una clave con forma de JWT.
 * `undefined`: no es un JWT (p. ej. una clave publicable `sb_publishable_*`). `null`: JWT ilegible.
 */
export function rolDeClaveJwt(clave: string): string | null | undefined {
  const partes = clave.split('.')
  if (partes.length !== 3) return undefined
  const cargaUtil = decodificarBase64Url(partes[1] ?? '')
  if (cargaUtil === null) return null
  try {
    const rol = (JSON.parse(cargaUtil) as { role?: unknown }).role
    return typeof rol === 'string' ? rol : null
  } catch {
    return null
  }
}

/** Una clave con forma de JWT debe declarar rol `anon`; cualquier otro rol (p. ej. `service_role`) se rechaza. */
export function esClavePrivada(clave: string): boolean {
  if (/^sb_secret_/u.test(clave) || /service[_-]?role/iu.test(clave)) return true
  const rol = rolDeClaveJwt(clave)
  return rol !== undefined && rol !== 'anon'
}

export function esUrlHttpsValida(valor: string): boolean {
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function esUrlLocalIntegracionValida(valor: string, plataforma: OpcionesEntorno['plataforma']): boolean {
  const hostEsperado = plataforma === 'android' ? '10.0.2.2' : '127.0.0.1'
  try {
    const url = new URL(valor)
    return url.protocol === 'http:' && url.hostname === hostEsperado && url.port === '54321' &&
      url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

export function leerEntorno(variables: VariablesCrudas, opciones: OpcionesEntorno = {}): ResultadoEntorno {
  const motivos: string[] = []
  const supabaseUrl = (variables.EXPO_PUBLIC_SUPABASE_URL ?? '').trim()
  const supabaseAnonKey = (variables.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  const apiBaseUrl = (variables.EXPO_PUBLIC_API_BASE_URL ?? '').trim()
  if (!supabaseUrl) motivos.push('Falta EXPO_PUBLIC_SUPABASE_URL.')
  else if (!esUrlHttpsValida(supabaseUrl) &&
    !(opciones.authIntegracionLocal && esUrlLocalIntegracionValida(supabaseUrl, opciones.plataforma))) {
    motivos.push('EXPO_PUBLIC_SUPABASE_URL debe ser una URL https sin credenciales.')
  }
  if (!supabaseAnonKey) motivos.push('Falta EXPO_PUBLIC_SUPABASE_ANON_KEY.')
  else if (esClavePrivada(supabaseAnonKey)) motivos.push('EXPO_PUBLIC_SUPABASE_ANON_KEY contiene una clave privilegiada: solo se admite la clave pública.')
  if (!apiBaseUrl) motivos.push('Falta EXPO_PUBLIC_API_BASE_URL.')
  else if (!esUrlHttpsValida(apiBaseUrl)) motivos.push('EXPO_PUBLIC_API_BASE_URL debe ser una URL https sin credenciales.')
  return motivos.length ? { ok: false, motivos } : { ok: true, entorno: { supabaseUrl, supabaseAnonKey, apiBaseUrl } }
}

/** Expo reemplaza `process.env.EXPO_PUBLIC_*` solo con acceso estático: no se puede iterar `process.env`. */
export function entornoDelBundle(): ResultadoEntorno {
  // Esta excepción se activa únicamente por app.config.ts en builds CI de integración.
  // La URL además debe coincidir con el host y puerto del emulador/simulador esperado.
  const integracionLocal = Constants.expoConfig?.extra?.eptAuthIntegration === true
  return leerEntorno({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  }, { authIntegracionLocal: integracionLocal, plataforma: Platform.OS === 'android' ? 'android' : 'ios' })
}
