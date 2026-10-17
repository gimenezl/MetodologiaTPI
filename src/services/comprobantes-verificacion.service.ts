import { createServerSupabaseClient } from '@/services/supabase.server'
import { errorVerificacion, verificacionPagoSchema, type DecisionPago } from '@/lib/comprobantes-verificacion'

/** Nunca usa service_role. La guarda SQL vuelve a validar el actor bajo bloqueo. */
export async function operarVerificacion(pagoId: string, decision?: DecisionPago) {
  try {
    const cliente = await createServerSupabaseClient()
    const respuesta = decision
      ? await cliente.rpc('verificar_pago', {
        p_pago_id: pagoId, p_decision: decision.decision,
        p_motivo: decision.decision === 'RECHAZADO' ? decision.motivo : null,
      })
      : await cliente.rpc('consultar_verificacion_pago', { p_pago_id: pagoId })
    if (respuesta.error) return { ok: false as const, ...errorVerificacion(respuesta.error.code) }
    const parsed = verificacionPagoSchema.safeParse(respuesta.data)
    if (!parsed.success || parsed.data.pago_id !== pagoId) {
      return { ok: false as const, ...errorVerificacion() }
    }
    return { ok: true as const, datos: parsed.data }
  } catch {
    return { ok: false as const, ...errorVerificacion() }
  }
}
