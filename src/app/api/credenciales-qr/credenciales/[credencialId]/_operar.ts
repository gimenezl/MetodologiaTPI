import { cuerpoMotivoSchema, parametrosCredencialSchema } from '@/lib/credenciales-qr/esquemas'
import { requerirDirector } from '@/services/autorizacion'
import type { Resultado } from '@/services/credenciales-qr.service'
import {
  leerCuerpoJson,
  responderDatos,
  responderDenegacion,
  responderError,
  validar,
} from '@/services/credenciales-qr.respuestas'

/**
 * Cuerpo común de la reposición y de la revocación: ambas son operaciones de
 * Dirección sobre UNA credencial, con un motivo obligatorio.
 *
 * Orden: sesión y rol → identificador → cuerpo → operación. El actor sale de la
 * sesión; ni el alumno ni el rol ni el actor viajan en la petición.
 */
export async function operarSobreCredencial(
  contexto: { params: Promise<{ credencialId: string }> },
  request: Request,
  mensajeNoAutorizado: string,
  operar: (credencialId: string, motivo: string) => Promise<Resultado<{ credencialId: string }>>
) {
  const autorizacion = await requerirDirector(mensajeNoAutorizado)
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const parametros = parametrosCredencialSchema.safeParse(await contexto.params)
  if (!parametros.success) return responderError('IDENTIFICADOR_INVALIDO')

  const cuerpo = await leerCuerpoJson(request)
  if (!cuerpo.ok) return responderError(cuerpo.codigo)
  const datos = validar(cuerpoMotivoSchema, cuerpo.datos)
  if (!datos.ok) return responderError(datos.codigo)

  const resultado = await operar(parametros.data.credencialId, datos.datos.motivo)
  if (!resultado.ok) return responderError(resultado.codigo)
  return responderDatos({ credencial: { id: resultado.datos.credencialId } })
}
