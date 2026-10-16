import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import { esUuid } from '@/servicios/pagos'

/**
 * Recuperación de una carga de comprobante cuyo desenlace quedó incierto (EPT-109). Se guarda SOLO lo
 * necesario para consultar el resultado: identificadores. No hay tokens, bytes, rutas ni datos de la
 * transferencia. La clave incluye al usuario Y al pago: una cuenta nunca recupera la carga de otra.
 */

export interface CargaPendiente {
  usuarioId: string
  pagoId: string
  claveCarga: string
  /** `null` mientras la preparación no confirmó cuál es la carga (se resuelve por la clave). */
  cargaId: string | null
  creadaEn: string
}

const VERSION = 1

const claveDe = (usuarioId: string, pagoId: string): string => `comprobante.pendiente.${usuarioId}.${pagoId}`

export async function guardarCargaPendiente(almacen: AlmacenamientoSeguro, carga: CargaPendiente): Promise<void> {
  await almacen.setItem(claveDe(carga.usuarioId, carga.pagoId), JSON.stringify({ v: VERSION, ...carga }))
}

/** `null` si no hay carga, está dañada o no corresponde a esta cuenta y este pago. */
export async function leerCargaPendiente(
  almacen: AlmacenamientoSeguro,
  usuarioId: string,
  pagoId: string,
): Promise<CargaPendiente | null> {
  let crudo: string | null
  try {
    crudo = await almacen.getItem(claveDe(usuarioId, pagoId))
  } catch {
    return null
  }
  if (crudo === null) return null
  try {
    const o = JSON.parse(crudo) as Record<string, unknown>
    if (
      o.v !== VERSION ||
      o.usuarioId !== usuarioId ||
      o.pagoId !== pagoId ||
      !esUuid(o.claveCarga) ||
      !(o.cargaId === null || esUuid(o.cargaId)) ||
      typeof o.creadaEn !== 'string'
    ) {
      return null
    }
    return { usuarioId, pagoId, claveCarga: o.claveCarga, cargaId: o.cargaId as string | null, creadaEn: o.creadaEn }
  } catch {
    return null
  }
}

/** Elimina la carga SOLO si sigue siendo la indicada: una respuesta tardía no borra la de otra posterior. */
export async function descartarCargaPendiente(
  almacen: AlmacenamientoSeguro,
  usuarioId: string,
  pagoId: string,
  claveCarga?: string,
): Promise<void> {
  try {
    if (claveCarga) {
      const actual = await leerCargaPendiente(almacen, usuarioId, pagoId)
      if (actual && actual.claveCarga !== claveCarga) return
    }
    await almacen.removeItem(claveDe(usuarioId, pagoId))
  } catch {
    // Un fallo de borrado no bloquea el flujo: la carga se vuelve a resolver por consulta.
  }
}
