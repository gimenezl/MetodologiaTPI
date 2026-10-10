import { entornoDelBundle } from '@/configuracion/entorno'
import { obtenerTokenDeAcceso } from '@/servicios/sesion'
import { ErrorDeConfiguracion, obtenerClienteSupabase } from '@/servicios/supabase'
import { crearTransporteHttp, type TransporteHttp } from '@/servicios/transporte-http'

let transporte: TransporteHttp | null = null

/**
 * Transporte hacia los Route Handlers de Next con la sesión del dispositivo.
 * Es infraestructura: los endpoints concretos (PDF, recibos) los registran las unidades que los usan.
 */
export function obtenerTransporteApi(): TransporteHttp {
  if (transporte) return transporte
  const resultado = entornoDelBundle()
  if (!resultado.ok) throw new ErrorDeConfiguracion(resultado.motivos)
  const cliente = obtenerClienteSupabase()
  transporte = crearTransporteHttp({
    baseUrl: resultado.entorno.apiBaseUrl,
    obtenerToken: () => obtenerTokenDeAcceso(cliente.auth),
    permitirHttpLocal: __DEV__,
  })
  return transporte
}
