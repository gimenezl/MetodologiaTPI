import {
  argumentosEconomicos,
  documentoEconomico,
  type ConsultaEconomica,
  type DocumentoEconomico,
  type ReporteEconomico,
} from '@/lib/reportes-economicos'
import { createServerSupabaseClient } from './supabase.server'

export type ResultadoEconomico =
  | { ok: true; datos: DocumentoEconomico }
  | { ok: false; estado: 400 | 401 | 403 | 409 | 500; mensaje: string }

export async function leerReporteEconomico(
  id: ReporteEconomico,
  consulta: ConsultaEconomica
): Promise<ResultadoEconomico> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('reporte_economico', argumentosEconomicos(id, consulta))
  if (error) {
    if (error.code === 'P5505')
      return { ok: false, estado: 401, mensaje: 'Debe iniciar sesión para consultar los reportes.' }
    if (error.code === '42501' && /^Solo la dirección/.test(error.message))
      return { ok: false, estado: 403, mensaje: 'Solo Dirección habilitada puede consultar los reportes económicos.' }
    if (error.code === 'P6890') return { ok: false, estado: 400, mensaje: 'Los filtros del reporte no son válidos.' }
    console.error('[reportes-economicos] fallo de lectura', { code: error.code })
    return { ok: false, estado: 500, mensaje: 'No se pudo consultar el reporte. Intente nuevamente.' }
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && data.actualizado === true) {
    return {
      ok: false,
      estado: 409,
      mensaje:
        'La información económica cambió desde la página anterior. Actualice la consulta desde la primera página.',
    }
  }
  const lectura = documentoEconomico.safeParse(data)
  if (
    !lectura.success ||
    lectura.data.pagina !== consulta.pagina ||
    lectura.data.tamano !== consulta.tamano ||
    lectura.data.filas.length > consulta.tamano ||
    lectura.data.filas.length !==
      Math.max(0, Math.min(consulta.tamano, lectura.data.total - (consulta.pagina - 1) * consulta.tamano))
  ) {
    return { ok: false, estado: 500, mensaje: 'La respuesta del reporte no es válida. Intente nuevamente.' }
  }
  return { ok: true, datos: lectura.data }
}
