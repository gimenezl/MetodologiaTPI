import { perfilIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { listarHistorial } from '@/services/gestion-usuarios.service'
import { responderDenegacion, responderError, responderResultado } from '@/services/usuarios.respuestas'

export const dynamic = 'force-dynamic'

/**
 * Historial de cambios de rol, acceso y vínculo de cuenta (EPT-59), del más
 * reciente al más antiguo. Es de solo agregado en la base: no hay forma de
 * editarlo ni borrarlo.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector('Solo la dirección puede administrar usuarios.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const id = perfilIdSchema.safeParse((await params).id)
  if (!id.success) return responderError('PERFIL_INEXISTENTE')

  return responderResultado(await listarHistorial(id.data))
}
