import { perfilIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { sincronizarAcceso } from '@/services/gestion-usuarios.service'
import { responderDenegacion, responderError, responderResultado } from '@/services/usuarios.respuestas'

export const dynamic = 'force-dynamic'

/**
 * Hace que la cuenta Auth coincida con el estado de acceso de la base
 * (EPT-59). Idempotente: repara un bloqueo cuyo baneo quedó pendiente, o una
 * cuenta que quedó baneada sin estar bloqueada. Responde 200 con
 * `auth_sincronizado`.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector('Solo la dirección puede bloquear o reactivar accesos.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const id = perfilIdSchema.safeParse((await params).id)
  if (!id.success) return responderError('PERFIL_INEXISTENTE')

  return responderResultado(await sincronizarAcceso(id.data))
}
