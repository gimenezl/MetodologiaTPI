import type { ClavesQr } from '@/lib/credenciales-qr/claves'
import { verificarPayload } from '@/lib/credenciales-qr/payload'

/**
 * Verificación de un QR: primero la firma, después el estado (EPT-64).
 *
 * Es la interfaz mínima y segura que EPT-65 (escaneo y registro de accesos)
 * podrá reutilizar. El orden es la garantía de seguridad:
 *
 *   1. `verificarPayload` comprueba formato, versión, `kid` y firma HMAC. Es
 *      puro: no toca la base.
 *   2. SOLO si la firma es válida se invoca `consultarValidez` con el
 *      identificador extraído. Un texto malformado, de una versión o `kid`
 *      desconocidos, o con la firma alterada, jamás llega a la base.
 *
 * Esta función NO registra accesos, NO consulta comedor ni transporte y NO crea
 * eventos: solo responde si la credencial es válida y, si no lo es, por qué.
 *
 * Sin oráculo de existencia: cualquier payload que no pase la verificación
 * criptográfica, y también un identificador bien firmado que la base no conozca,
 * produce la MISMA respuesta `{ reconocido: false }`.
 */

export type MotivoDeInvalidez = 'CREDENCIAL_REVOCADA' | 'ALUMNO_INACTIVO' | 'ACCESO_BLOQUEADO'

/** Lo que la base informa de una credencial (nunca datos personales). */
export type EstadoConsultado = {
  estadoCredencial: 'ACTIVA' | 'REVOCADA'
  estadoAlumno: 'ACTIVO' | 'INACTIVO'
  accesoAlumno: 'HABILITADO' | 'BLOQUEADO'
}

/** `null` cuando la base no conoce ese identificador. */
export type ConsultorDeValidez = (credencialId: string) => Promise<EstadoConsultado | null>

export type ResultadoDeVerificacion =
  | { reconocido: false }
  | { reconocido: true; valida: true }
  | { reconocido: true; valida: false; motivo: MotivoDeInvalidez }

/** Validez efectiva: credencial ACTIVA + alumno ACTIVO + perfil habilitado. */
export function motivoDeInvalidez(estado: EstadoConsultado): MotivoDeInvalidez | null {
  if (estado.estadoCredencial !== 'ACTIVA') return 'CREDENCIAL_REVOCADA'
  if (estado.estadoAlumno !== 'ACTIVO') return 'ALUMNO_INACTIVO'
  if (estado.accesoAlumno !== 'HABILITADO') return 'ACCESO_BLOQUEADO'
  return null
}

export async function verificarCredencial(
  texto: unknown,
  claves: ClavesQr,
  consultarValidez: ConsultorDeValidez
): Promise<ResultadoDeVerificacion> {
  const firma = verificarPayload(texto, claves)
  if (!firma.ok) return { reconocido: false }

  const estado = await consultarValidez(firma.id)
  if (!estado) return { reconocido: false }

  const motivo = motivoDeInvalidez(estado)
  return motivo ? { reconocido: true, valida: false, motivo } : { reconocido: true, valida: true }
}
