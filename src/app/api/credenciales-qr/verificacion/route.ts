import { cuerpoVerificacionSchema } from '@/lib/credenciales-qr/esquemas'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirDirector } from '@/services/autorizacion'
import { verificarQr } from '@/services/credenciales-qr.service'
import {
  leerCuerpoJson,
  responderDatos,
  responderDenegacion,
  responderError,
  validar,
} from '@/services/credenciales-qr.respuestas'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['POST'] as const

const MENSAJES = {
  CREDENCIAL_REVOCADA: 'La credencial fue revocada y no es válida.',
  ALUMNO_INACTIVO: 'El alumno está inactivo: la credencial no es válida por ahora.',
  ACCESO_BLOQUEADO: 'El acceso del alumno está bloqueado: la credencial no es válida por ahora.',
} as const

/**
 * Interfaz mínima de verificación (base para EPT-65). NO escanea, NO registra
 * accesos, NO consulta comedor ni transporte y NO crea eventos.
 *
 * El texto del QR viaja en el CUERPO, nunca en la URL, y no se registra. Solo
 * Dirección puede invocarla: esta historia no concede permisos de escáner a
 * PERSONAL ni a otro rol. La firma se comprueba antes de cualquier consulta de
 * estado; un texto malformado, de una versión o `kid` desconocidos, con la
 * firma alterada o de un identificador que la base no conoce recibe la MISMA
 * respuesta, sin revelar si existe.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirDirector('Solo la dirección puede verificar credenciales.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const cuerpo = await leerCuerpoJson(request)
  if (!cuerpo.ok) return responderError(cuerpo.codigo)
  const datos = validar(cuerpoVerificacionSchema, cuerpo.datos)
  if (!datos.ok) return responderError(datos.codigo)

  const resultado = await verificarQr(datos.datos.payload)
  if (!resultado.ok) return responderError(resultado.codigo)

  const veredicto = resultado.datos
  if (!veredicto.reconocido) {
    return responderDatos({
      reconocido: false,
      valida: false,
      mensaje: 'El código QR no es reconocido.',
    })
  }
  if (veredicto.valida) {
    return responderDatos({ reconocido: true, valida: true, mensaje: 'La credencial es válida.' })
  }
  return responderDatos({
    reconocido: true,
    valida: false,
    motivo: veredicto.motivo,
    mensaje: MENSAJES[veredicto.motivo],
  })
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
