import Constants from 'expo-constants'

import { entornoDelBundle } from '@/configuracion/entorno'
import { obtenerTokenDeAcceso } from '@/servicios/sesion'
import { ErrorDeConfiguracion, obtenerClienteSupabase } from '@/servicios/supabase'
import { crearTransporteHttp, type TransporteHttp } from '@/servicios/transporte-http'

const TIEMPO_POR_DEFECTO_MS = 15_000

// Un transporte por límite de tiempo: la finalización de un comprobante lee, valida y publica un
// archivo de hasta 5 MiB y necesita más que una consulta común.
const transportes = new Map<number, TransporteHttp>()

/**
 * Transporte hacia los Route Handlers de Next con la sesión del dispositivo (Bearer, nunca cookies).
 * Los endpoints concretos los registran las unidades que los usan (EPT-109: finalización de comprobantes).
 */
export function obtenerTransporteApi(timeoutMs: number = TIEMPO_POR_DEFECTO_MS): TransporteHttp {
  const existente = transportes.get(timeoutMs)
  if (existente) return existente
  const resultado = entornoDelBundle()
  if (!resultado.ok) throw new ErrorDeConfiguracion(resultado.motivos)
  const cliente = obtenerClienteSupabase()
  // El build de integración local (CI) es el único que habla `http://` con el servidor del runner.
  const integracionLocal = Constants.expoConfig?.extra?.eptAuthIntegration === true
  const transporte = crearTransporteHttp({
    baseUrl: resultado.entorno.apiBaseUrl,
    obtenerToken: () => obtenerTokenDeAcceso(cliente.auth),
    permitirHttpLocal: __DEV__ || integracionLocal,
    hostsHttpLocalesExtra: integracionLocal ? ['10.0.2.2'] : [],
    timeoutMs,
  })
  transportes.set(timeoutMs, transporte)
  return transporte
}
