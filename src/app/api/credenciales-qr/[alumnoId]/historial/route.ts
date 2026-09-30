import { parametrosAlumnoSchema } from '@/lib/credenciales-qr/esquemas'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirDirector } from '@/services/autorizacion'
import { obtenerHistorial } from '@/services/credenciales-qr.service'
import {
  responderDatos,
  responderDenegacion,
  responderError,
} from '@/services/credenciales-qr.respuestas'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['GET'] as const

/** Historial interno de un alumno: quién emitió, quién revocó y por qué. Solo Dirección. */
export async function GET(_request: Request, contexto: { params: Promise<{ alumnoId: string }> }) {
  const autorizacion = await requerirDirector('Solo la dirección puede consultar el historial de credenciales.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const parametros = parametrosAlumnoSchema.safeParse(await contexto.params)
  if (!parametros.success) return responderError('IDENTIFICADOR_INVALIDO')

  const resultado = await obtenerHistorial(parametros.data.alumnoId)
  if (!resultado.ok) return responderError(resultado.codigo)
  return responderDatos({ historial: resultado.datos })
}

export const POST = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
