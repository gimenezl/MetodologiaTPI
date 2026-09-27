import { operacionIdSchema, verificarDesafioSchema } from '@/lib/validations'
import { requerirDirectorConPerfil } from '@/services/autorizacion'
import {
  leerJson,
  responderDenegacion,
  responderError,
  responderResultado,
  validar,
} from '@/services/usuarios.respuestas'
import { verificarYVincular, vinculoDisponible } from '@/services/vinculo-cuenta.service'

export const dynamic = 'force-dynamic'

/**
 * Verifica el código y crea la cuenta ya enlazada al perfil (EPT-59, D5):
 * `{ codigo, contrasena }`. La persona escribe ambos en el dispositivo de la
 * escuela.
 *
 * - Código incorrecto: 422 con `intentos_restantes`.
 * - Código vencido: 409; intentos agotados: 429. En ambos casos, enviar uno nuevo.
 * - Verificado: 201 con la cuenta creada y enlazada; 200 si ya lo estaba (un
 *   reintento). Ante una respuesta perdida de Auth se reconcilia leyendo el
 *   estado: nunca se duplica la cuenta ni se borra nada.
 */
export async function POST(request: Request, { params }: { params: Promise<{ operacion: string }> }) {
  const autorizacion = await requerirDirectorConPerfil('Solo la dirección puede vincular cuentas.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)
  if (!vinculoDisponible()) return responderError('VINCULO_DESHABILITADO')

  const operacion = operacionIdSchema.safeParse((await params).operacion)
  if (!operacion.success) return responderError('RESERVA_INEXISTENTE')

  const cuerpo = validar(verificarDesafioSchema, await leerJson(request))
  if (!cuerpo.ok) return responderResultado(cuerpo)

  return responderResultado(
    await verificarYVincular(
      operacion.data,
      autorizacion.perfilId,
      cuerpo.datos.codigo,
      cuerpo.datos.contrasena
    )
  )
}
