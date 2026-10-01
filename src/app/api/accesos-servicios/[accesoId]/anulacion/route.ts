import { cuerpoAnulacionSchema, parametrosAccesoSchema } from '@/lib/accesos-qr/esquemas'
import { origenPermitido } from '@/lib/accesos-qr/origen'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirDirector } from '@/services/autorizacion'
import { anularAcceso } from '@/services/accesos-qr.service'
import {
  leerCuerpoJson,
  responderDatos,
  responderDenegacion,
  responderError,
  validar,
} from '@/services/accesos-qr.respuestas'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['POST'] as const

/**
 * Anula un acceso REGISTRADO erróneo (EPT-65, RF21). Solo Dirección.
 *
 * Agrega UNA fila de anulación con un motivo libre de 3 a 200 caracteres: el
 * evento original no se edita ni se borra, y no se puede anular dos veces. Un
 * acceso anulado deja de contar para la regla de un acceso por día, de modo que
 * un nuevo escaneo legítimo vuelve a registrarse. La autora sale de la sesión.
 */
export async function POST(request: Request, contexto: { params: Promise<{ accesoId: string }> }) {
  if (!origenPermitido(request.headers)) return responderError('ORIGEN_NO_PERMITIDO')

  const autorizacion = await requerirDirector('Solo la dirección puede anular un acceso.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const parametros = parametrosAccesoSchema.safeParse(await contexto.params)
  if (!parametros.success) return responderError('ACCESO_NO_ENCONTRADO')

  const cuerpo = await leerCuerpoJson(request)
  if (!cuerpo.ok) return responderError(cuerpo.codigo)
  const datos = validar(cuerpoAnulacionSchema, cuerpo.datos)
  if (!datos.ok) return responderError(datos.codigo)

  const resultado = await anularAcceso(parametros.data.accesoId, datos.datos.motivo)
  if (!resultado.ok) return responderError(resultado.codigo)
  return responderDatos({ acceso: { id: resultado.datos.accesoId, anulado: true } })
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
