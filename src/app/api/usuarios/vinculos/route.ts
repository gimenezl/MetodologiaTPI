import { reservarVinculoSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import {
  leerJson,
  responderDenegacion,
  responderError,
  responderResultado,
  validar,
} from '@/services/usuarios.respuestas'
import { reservarVinculo, vinculoDisponible } from '@/services/vinculo-cuenta.service'

export const dynamic = 'force-dynamic'

/**
 * Reserva del vínculo presencial de una cuenta (EPT-59, D5), con la sesión de
 * la dirección:
 *
 *   { operacion_id, perfil_id, dni, modalidad: 'TITULAR' | 'REPRESENTANTE',
 *     representante_dni?, documento_verificado: true }
 *
 * `operacion_id` (UUID v4) es la clave de idempotencia: 201 si la reserva es
 * nueva, 200 si es un reintento de la misma. Reservar no crea ninguna cuenta ni
 * concede ningún permiso.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirDirector('Solo la dirección puede vincular cuentas.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)
  if (!vinculoDisponible()) return responderError('VINCULO_DESHABILITADO')

  const cuerpo = validar(reservarVinculoSchema, await leerJson(request))
  if (!cuerpo.ok) {
    if (cuerpo.campo === 'documento_verificado' || cuerpo.campo === 'representante_dni' || cuerpo.campo === 'modalidad') {
      return responderError('RESERVA_INVALIDA', { campo: cuerpo.campo, mensaje: cuerpo.mensaje })
    }
    return responderResultado(cuerpo)
  }

  return responderResultado(await reservarVinculo(cuerpo.datos))
}
