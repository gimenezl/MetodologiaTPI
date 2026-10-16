import type { SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_FINAL, BUCKET_TEMPORAL } from '@/lib/comprobantes-contrato'

/**
 * Conciliación de cargas de comprobante (EPT-109).
 *
 * Qué hace:
 *   · cierra por vencimiento las cargas PREPARADA que nadie finalizó;
 *   · retira el objeto TEMPORAL de las cargas ya resueltas y, si la carga se
 *     descartó o venció y nunca tuvo fila en `comprobantes_pago`, el objeto FINAL
 *     huérfano que una finalización interrumpida pudo dejar.
 *
 * Qué NO hace:
 *   · No toca pagos ni ítems: un pago pendiente sigue pendiente aunque su carga
 *     venza. No existe expiración automática de pagos.
 *   · No borra el objeto final de una carga CONFIRMADA ni de ninguna con fila en
 *     `comprobantes_pago`: la función SQL nunca las devuelve.
 *   · No decide por un tiempo agotado: un borrado que falla se reintenta en la
 *     próxima conciliación (la marca `temporal_eliminado_en` solo se escribe
 *     cuando ambos borrados salieron bien).
 *
 * Es idempotente y puede repetirse sin duplicar ni perder nada. No hay una tarea
 * programada: la dispara quien opera el sistema.
 */

/** Objetos que Storage realmente quitó (`remove` no falla si el objeto ya no estaba: devuelve una lista vacía). */
function quitados(respuesta: { data: unknown }): number {
  return Array.isArray(respuesta.data) ? respuesta.data.length : 1
}

export interface ResultadoConciliacion {
  examinadas: number
  temporalesRetirados: number
  finalesHuerfanosRetirados: number
  pendientes: number
}

interface FilaConciliar {
  carga_id: string
  estado: string
  ruta_temporal: string
  ruta_final_huerfana: string | null
}

export async function conciliarCargasComprobante(
  admin: SupabaseClient,
  opciones: { antiguedadHoras?: number; limite?: number } = {}
): Promise<ResultadoConciliacion> {
  const horas = opciones.antiguedadHoras ?? 24
  const limite = opciones.limite ?? 100
  const { data, error } = await admin.rpc('cargas_comprobante_a_conciliar', {
    p_antiguedad: `${Math.max(1, Math.floor(horas))} hours`,
    p_limite: limite,
  })
  if (error) throw new Error('No se pudo listar las cargas a conciliar.')

  const filas = (data ?? []) as FilaConciliar[]
  const resultado: ResultadoConciliacion = {
    examinadas: filas.length,
    temporalesRetirados: 0,
    finalesHuerfanosRetirados: 0,
    pendientes: 0,
  }

  for (const fila of filas) {
    let completo = true

    const temporal = await admin.storage.from(BUCKET_TEMPORAL).remove([fila.ruta_temporal])
    if (temporal.error) completo = false
    else resultado.temporalesRetirados += quitados(temporal)

    if (fila.ruta_final_huerfana) {
      const final = await admin.storage.from(BUCKET_FINAL).remove([fila.ruta_final_huerfana])
      if (final.error) completo = false
      else resultado.finalesHuerfanosRetirados += quitados(final)
    }

    if (completo) {
      const marca = await admin.rpc('marcar_temporal_eliminado', { p_carga_id: fila.carga_id })
      if (marca.error) completo = false
    }
    if (!completo) resultado.pendientes += 1
  }
  return resultado
}
