import { z } from 'zod'

/**
 * Esquemas Zod de la API de la credencial QR (EPT-64). Todos estrictos: un campo
 * desconocido se rechaza. Los mensajes están en español y no repiten el valor
 * recibido.
 */

/** Identificador de alumno o de credencial (UUID). */
export const identificadorSchema = z.guid({ error: 'El identificador indicado no es válido.' })

export const parametrosAlumnoSchema = z.strictObject({ alumnoId: identificadorSchema })
export const parametrosCredencialSchema = z.strictObject({ credencialId: identificadorSchema })

/** Motivo de una reposición o de una revocación: 3 a 200 caracteres, sin espacios en los bordes. */
export const motivoSchema = z
  .string({ error: 'El motivo debe ser un texto.' })
  .trim()
  .min(3, { error: 'El motivo debe tener entre 3 y 200 caracteres.' })
  .max(200, { error: 'El motivo debe tener entre 3 y 200 caracteres.' })
  // Sin caracteres de control: el motivo se guarda y se muestra a Dirección.
  .refine((texto) => !/[\u0000-\u001f\u007f]/.test(texto), {
    error: 'El motivo no puede contener caracteres de control.',
  })

export const cuerpoMotivoSchema = z.strictObject({ motivo: motivoSchema })

/**
 * Texto leído de un QR. El tope de 256 es holgado respecto del payload real
 * (74 caracteres) y acota el trabajo; el verificador aplica su propio tope.
 */
export const cuerpoVerificacionSchema = z.strictObject({
  payload: z.string({ error: 'El código QR debe ser un texto.' }).min(1).max(256),
})

export type CuerpoMotivo = z.infer<typeof cuerpoMotivoSchema>
