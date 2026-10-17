import { z } from 'zod'

export const pagoIdSchema = z.uuid()
export const decisionPagoSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APROBADO') }).strict(),
  z.object({ decision: z.literal('RECHAZADO'), motivo: z.string().trim().min(1) }).strict(),
])
export type DecisionPago = z.infer<typeof decisionPagoSchema>

export const verificacionPagoSchema = z.object({
  pago_id: z.uuid(),
  estado: z.enum(['PENDIENTE_VERIFICACION', 'APROBADO', 'RECHAZADO']),
  verificado_por: z.uuid().nullable(),
  verificado_en: z.iso.datetime({ offset: true }).nullable(),
  motivo_rechazo: z.string().nullable(),
  repetido: z.boolean(),
}).superRefine((v, ctx) => {
  const pendiente = v.estado === 'PENDIENTE_VERIFICACION'
  if ((pendiente && (v.verificado_por !== null || v.verificado_en !== null || v.motivo_rechazo !== null))
      || (!pendiente && (!v.verificado_por || !v.verificado_en))
      || (v.estado === 'APROBADO' && v.motivo_rechazo !== null)
      || (v.estado === 'RECHAZADO' && !v.motivo_rechazo?.trim())) {
    ctx.addIssue({ code: 'custom', message: 'Resultado de verificación incoherente.' })
  }
})
export type VerificacionPago = z.infer<typeof verificacionPagoSchema>

export function errorVerificacion(codigo?: string): { estado: number; codigo: string; error: string } {
  switch (codigo) {
    case '42501': case 'P5505':
      return { estado: 403, codigo: 'NO_AUTORIZADO', error: 'Solo Dirección habilitada puede verificar pagos.' }
    case 'P6880':
      return { estado: 400, codigo: 'DATOS_INVALIDOS', error: 'Revisa la decisión y el motivo de rechazo.' }
    case 'P6881':
      return { estado: 404, codigo: 'NO_DISPONIBLE', error: 'El pago no está disponible.' }
    case 'P6882':
      return { estado: 409, codigo: 'CONFLICTO', error: 'Otro Director ya decidió. Consulta el resultado actual.' }
    case 'P6883':
      return { estado: 409, codigo: 'PAGO_INCOHERENTE', error: 'El pago no tiene comprobantes o reservas coherentes. Requiere revisión institucional.' }
    default:
      return { estado: 503, codigo: 'RESULTADO_INCIERTO', error: 'No se pudo confirmar el resultado. Consulta el estado antes de volver a decidir.' }
  }
}
