import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import { esUuid, seleccionCanonica } from '@/servicios/pagos'

/**
 * Recuperación de un intento de pago cuyo desenlace quedó incierto (la respuesta no llegó). Se guarda SOLO
 * lo necesario para consultarlo o reintentarlo de forma idempotente: identificadores y el total que el padre
 * vio. No hay credenciales, tokens ni datos personales, y la clave de almacenamiento incluye al usuario para
 * que una cuenta nunca recupere el intento de otra.
 */

export interface IntentoPendiente {
  usuarioId: string
  alumnoId: string
  claveIntento: string
  itemIds: string[]
  totalCentavos: number
  creadoEn: string
}

const VERSION = 1

const claveDe = (usuarioId: string): string => `pago.pendiente.${usuarioId}`

export async function guardarIntentoPendiente(almacen: AlmacenamientoSeguro, intento: IntentoPendiente): Promise<void> {
  await almacen.setItem(claveDe(intento.usuarioId), JSON.stringify({ v: VERSION, ...intento, itemIds: seleccionCanonica(intento.itemIds) }))
}

/** `null` si no hay intento, está dañado o pertenece a otro usuario (nunca se devuelve una recuperación ajena). */
export async function leerIntentoPendiente(almacen: AlmacenamientoSeguro, usuarioId: string): Promise<IntentoPendiente | null> {
  let crudo: string | null
  try {
    crudo = await almacen.getItem(claveDe(usuarioId))
  } catch {
    return null
  }
  if (crudo === null) return null
  try {
    const o = JSON.parse(crudo) as Record<string, unknown>
    if (
      o.v !== VERSION ||
      o.usuarioId !== usuarioId ||
      !esUuid(o.alumnoId) ||
      !esUuid(o.claveIntento) ||
      !Array.isArray(o.itemIds) ||
      o.itemIds.length === 0 ||
      !o.itemIds.every(esUuid) ||
      typeof o.totalCentavos !== 'number' ||
      !Number.isSafeInteger(o.totalCentavos) ||
      o.totalCentavos < 0 ||
      typeof o.creadoEn !== 'string'
    ) {
      return null
    }
    return {
      usuarioId,
      alumnoId: o.alumnoId,
      claveIntento: o.claveIntento,
      itemIds: o.itemIds as string[],
      totalCentavos: o.totalCentavos,
      creadoEn: o.creadoEn,
    }
  } catch {
    return null
  }
}

export async function descartarIntentoPendiente(almacen: AlmacenamientoSeguro, usuarioId: string): Promise<void> {
  try {
    await almacen.removeItem(claveDe(usuarioId))
  } catch {
    // Un fallo de borrado no debe bloquear el flujo: el intento se vuelve a resolver por consulta.
  }
}
