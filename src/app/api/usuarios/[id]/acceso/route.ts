import { cambiarAccesoSchema, perfilIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { cambiarAcceso } from '@/services/gestion-usuarios.service'
import {
  leerJson,
  responderDenegacion,
  responderError,
  responderResultado,
  validar,
} from '@/services/usuarios.respuestas'

export const dynamic = 'force-dynamic'

/**
 * Bloqueo y reactivación del acceso (EPT-59):
 * `{ estado_esperado, estado_nuevo, motivo }`.
 *
 * El orden entre la base y Auth está explicado en `cambiarAcceso`
 * (src/services/gestion-usuarios.service.ts). Un bloqueo cuya sincronización
 * con Auth quedó pendiente responde 200 con `auth_sincronizado: false`; una
 * reactivación que no pudo levantar el baneo responde 503 `AUTH_PENDIENTE` sin
 * haber tocado la base.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector('Solo la dirección puede bloquear o reactivar accesos.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const id = perfilIdSchema.safeParse((await params).id)
  if (!id.success) return responderError('PERFIL_INEXISTENTE')

  const cuerpo = validar(cambiarAccesoSchema, await leerJson(request))
  if (!cuerpo.ok) {
    // Pedir el mismo estado que el esperado no es un dato mal cargado.
    if (cuerpo.campo === 'estado_nuevo' && cuerpo.codigo === 'DATOS_INVALIDOS') {
      return responderError('MISMO_VALOR')
    }
    return responderResultado(cuerpo)
  }

  const { estado_esperado, estado_nuevo, motivo } = cuerpo.datos
  return responderResultado(await cambiarAcceso(id.data, estado_esperado, estado_nuevo, motivo))
}
