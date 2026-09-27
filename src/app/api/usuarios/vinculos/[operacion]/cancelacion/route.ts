import { operacionIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { responderDenegacion, responderError, responderResultado } from '@/services/usuarios.respuestas'
import { cancelarVinculo, vinculoDisponible } from '@/services/vinculo-cuenta.service'

export const dynamic = 'force-dynamic'

/**
 * Cancela una vinculación en curso (EPT-59, D5). No borra nada: la reserva
 * queda CANCELADA (o VENCIDA, si ya había vencido) y el código deja de servir.
 * Cancelar dos veces es idempotente; una vinculación completada no se cancela.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ operacion: string }> }) {
  const autorizacion = await requerirDirector('Solo la dirección puede vincular cuentas.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)
  if (!vinculoDisponible()) return responderError('VINCULO_DESHABILITADO')

  const operacion = operacionIdSchema.safeParse((await params).operacion)
  if (!operacion.success) return responderError('RESERVA_INEXISTENTE')

  return responderResultado(await cancelarVinculo(operacion.data))
}
