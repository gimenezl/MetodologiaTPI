import { cambiarRolSchema, perfilIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { cambiarRol } from '@/services/gestion-usuarios.service'
import {
  leerJson,
  responderDenegacion,
  responderError,
  responderResultado,
  validar,
} from '@/services/usuarios.respuestas'

export const dynamic = 'force-dynamic'

/**
 * Cambio de rol (EPT-59): `{ rol_esperado, rol_nuevo, motivo }`.
 *
 * `rol_esperado` es el rol que la pantalla mostraba: si ya no coincide, la base
 * responde 409 sin cambiar nada. Las reglas (ESTUDIANTE, PADRE con hijos,
 * DOCENTE con ficha activa o a cargo, último Director efectivo, propia cuenta)
 * y el historial viven en `public.cambiar_rol_perfil`, en una sola
 * transacción.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector('Solo la dirección puede cambiar roles.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const id = perfilIdSchema.safeParse((await params).id)
  if (!id.success) return responderError('PERFIL_INEXISTENTE')

  const cuerpo = validar(cambiarRolSchema, await leerJson(request))
  if (!cuerpo.ok) return responderResultado(cuerpo)

  const { rol_esperado, rol_nuevo, motivo } = cuerpo.datos
  return responderResultado(await cambiarRol(id.data, rol_esperado, rol_nuevo, motivo))
}
