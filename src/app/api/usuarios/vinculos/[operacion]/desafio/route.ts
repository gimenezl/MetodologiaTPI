import { emitirDesafioSchema, operacionIdSchema } from '@/lib/validations'
import { requerirDirectorConPerfil } from '@/services/autorizacion'
import {
  leerJson,
  responderDenegacion,
  responderError,
  responderResultado,
  validar,
} from '@/services/usuarios.respuestas'
import { emitirDesafio, vinculoDisponible } from '@/services/vinculo-cuenta.service'

export const dynamic = 'force-dynamic'

/**
 * Envía el código de verificación al correo que dicta la persona (EPT-59, D5):
 * `{ correo }`.
 *
 * Responde 202 `{ enviado, desafio_vence_en, correo_enmascarado }`. El código
 * nunca viaja en la respuesta: la dirección no lo conoce, lo dicta la persona
 * que lo recibió. Si el correo no se pudo enviar, el código queda anulado y la
 * respuesta es 502 `ENVIO_FALLIDO`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ operacion: string }> }) {
  const autorizacion = await requerirDirectorConPerfil('Solo la dirección puede vincular cuentas.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)
  if (!vinculoDisponible()) return responderError('VINCULO_DESHABILITADO')

  const operacion = operacionIdSchema.safeParse((await params).operacion)
  if (!operacion.success) return responderError('RESERVA_INEXISTENTE')

  const cuerpo = validar(emitirDesafioSchema, await leerJson(request))
  if (!cuerpo.ok) {
    if (cuerpo.campo === 'correo') return responderError('CORREO_INVALIDO', { campo: 'correo' })
    return responderResultado(cuerpo)
  }

  return responderResultado(
    await emitirDesafio(operacion.data, autorizacion.perfilId, cuerpo.datos.correo)
  )
}
