import { operacionIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { responderDenegacion, responderError, responderResultado } from '@/services/usuarios.respuestas'
import { consultarVinculo, vinculoDisponible } from '@/services/vinculo-cuenta.service'

export const dynamic = 'force-dynamic'

/**
 * Estado de una vinculación (EPT-59, D5). También sirve para reconciliar
 * después de un resultado ambiguo: `vinculado: true` significa que la cuenta ya
 * quedó enlazada al perfil. Nunca expone el código, su hash ni el correo
 * completo.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ operacion: string }> }) {
  const autorizacion = await requerirDirector('Solo la dirección puede vincular cuentas.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)
  if (!vinculoDisponible()) return responderError('VINCULO_DESHABILITADO')

  const operacion = operacionIdSchema.safeParse((await params).operacion)
  if (!operacion.success) return responderError('RESERVA_INEXISTENTE')

  return responderResultado(await consultarVinculo(operacion.data))
}
