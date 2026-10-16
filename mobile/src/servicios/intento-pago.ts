import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import { esUuid, seleccionCanonica } from '@/servicios/pagos'

/**
 * Recuperación de un intento de pago cuyo desenlace quedó incierto (la respuesta no llegó). Se guarda SOLO
 * lo necesario para consultarlo o reintentarlo de forma idempotente: identificadores y el total que el padre
 * vio. No hay credenciales, tokens ni datos personales. La clave de almacenamiento incluye al usuario Y al
 * estudiante: una cuenta nunca recupera el intento de otra y un hijo nunca pisa ni borra el de otro.
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

const claveDe = (usuarioId: string, alumnoId: string): string => `pago.pendiente.${usuarioId}.${alumnoId}`

export async function guardarIntentoPendiente(almacen: AlmacenamientoSeguro, intento: IntentoPendiente): Promise<void> {
  await almacen.setItem(
    claveDe(intento.usuarioId, intento.alumnoId),
    JSON.stringify({ v: VERSION, ...intento, itemIds: seleccionCanonica(intento.itemIds) }),
  )
}

/** `null` si no hay intento, está dañado o no corresponde a esta cuenta y este estudiante. */
export async function leerIntentoPendiente(
  almacen: AlmacenamientoSeguro,
  usuarioId: string,
  alumnoId: string,
): Promise<IntentoPendiente | null> {
  let crudo: string | null
  try {
    crudo = await almacen.getItem(claveDe(usuarioId, alumnoId))
  } catch {
    return null
  }
  if (crudo === null) return null
  try {
    const o = JSON.parse(crudo) as Record<string, unknown>
    if (
      o.v !== VERSION ||
      o.usuarioId !== usuarioId ||
      o.alumnoId !== alumnoId ||
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
      alumnoId,
      claveIntento: o.claveIntento,
      itemIds: o.itemIds as string[],
      totalCentavos: o.totalCentavos,
      creadoEn: o.creadoEn,
    }
  } catch {
    return null
  }
}

/**
 * Elimina el intento SOLO si sigue siendo el indicado: una respuesta tardía de un intento viejo no borra
 * el recuperable de otro posterior del mismo estudiante.
 */
export async function descartarIntentoPendiente(
  almacen: AlmacenamientoSeguro,
  usuarioId: string,
  alumnoId: string,
  claveIntento?: string,
): Promise<void> {
  try {
    if (claveIntento) {
      const actual = await leerIntentoPendiente(almacen, usuarioId, alumnoId)
      if (actual && actual.claveIntento !== claveIntento) return
    }
    await almacen.removeItem(claveDe(usuarioId, alumnoId))
  } catch {
    // Un fallo de borrado no debe bloquear el flujo: el intento se vuelve a resolver por consulta.
  }
}
