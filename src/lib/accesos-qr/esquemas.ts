import { z } from 'zod'
import { motivoSchema } from '@/lib/credenciales-qr/esquemas'

/**
 * Esquemas Zod de la API de accesos con QR (EPT-65). Todos estrictos: un campo
 * desconocido se rechaza, y en particular NO existe ningún campo `actor`,
 * `alumno_id`, `credencial_id`, `legajo` ni `dni`: el escaneo viaja SOLO con el
 * payload íntegro del QR, y el servidor deriva el resto.
 */

const identificador = z.guid({ error: 'El identificador indicado no es válido.' })

/**
 * Cuerpo del registro. El tope de 512 caracteres acota el trabajo antes de mirar
 * el contenido; el verificador aplica el tope real del formato (128) y trata lo
 * que lo supere como un QR no reconocido, que SÍ suma al contador de inválidos.
 */
export const cuerpoRegistroSchema = z.strictObject({
  payload: z.string({ error: 'El código QR debe ser un texto.' }).min(1).max(512),
  intento_id: identificador,
  servicio_id: identificador,
  sentido: z.enum(['IDA', 'VUELTA']).optional(),
})

export type CuerpoRegistro = z.infer<typeof cuerpoRegistroSchema>

export const parametrosAccesoSchema = z.strictObject({ accesoId: identificador })
export const cuerpoAnulacionSchema = z.strictObject({ motivo: motivoSchema })

/** Filtros de la auditoría de Dirección (parámetros de la URL, ya en cadena). */
export const filtrosAuditoriaSchema = z.object({
  dia: z.iso.date().optional(),
  resultado: z.enum(['REGISTRADO', 'DENEGADO']).optional(),
  servicio: identificador.optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).optional(),
})

export type FiltrosAuditoria = z.infer<typeof filtrosAuditoriaSchema>
