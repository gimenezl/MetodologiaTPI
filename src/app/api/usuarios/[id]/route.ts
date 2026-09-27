import { actualizarDatosPersonalesSchema, perfilIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { actualizarDatosPersonales, consultarUsuario } from '@/services/gestion-usuarios.service'
import {
  leerJson,
  responderDenegacion,
  responderError,
  responderResultado,
  validar,
} from '@/services/usuarios.respuestas'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede administrar usuarios.'

/**
 * Detalle de una persona para la dirección (EPT-59): datos personales, rol,
 * acceso, cuenta (correo enmascarado) y vinculación pendiente.
 * `vinculo_disponible` indica si el servidor tiene habilitado el vínculo
 * presencial de cuentas, para que la pantalla explique por qué no lo ofrece.
 *
 * Se autoriza antes de mirar el parámetro. No se declaran PUT ni DELETE: no
 * existe borrado de personas y Next.js responde 405.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const id = perfilIdSchema.safeParse((await params).id)
  if (!id.success) return responderError('PERFIL_INEXISTENTE')

  return responderResultado(await consultarUsuario(id.data))
}

/**
 * Datos personales, con las mismas columnas y validaciones que Legajos. Corre
 * con la sesión de la dirección: RLS, los GRANT de columna y las restricciones
 * de EPT-9 se aplican igual que desde Legajos. Un DNI o legajo repetido es 409;
 * un dato que la base rechaza, 422.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const id = perfilIdSchema.safeParse((await params).id)
  if (!id.success) return responderError('PERFIL_INEXISTENTE')

  const cuerpo = validar(actualizarDatosPersonalesSchema, await leerJson(request))
  if (!cuerpo.ok) return responderResultado(cuerpo)

  return responderResultado(await actualizarDatosPersonales(id.data, cuerpo.datos))
}
