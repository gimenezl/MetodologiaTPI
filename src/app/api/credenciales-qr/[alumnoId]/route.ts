import { parametrosAlumnoSchema } from '@/lib/credenciales-qr/esquemas'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirDirector, requerirSesionConRol } from '@/services/autorizacion'
import { emitirCredencial, obtenerTarjeta } from '@/services/credenciales-qr.service'
import {
  responderDatos,
  responderDenegacion,
  responderError,
} from '@/services/credenciales-qr.respuestas'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['GET', 'POST'] as const

type Contexto = { params: Promise<{ alumnoId: string }> }

/** Roles que pueden consultar una credencial; RLS decide además QUÉ filas ve cada uno. */
const ROLES_LECTURA = new Set(['DIRECTOR', 'ESTUDIANTE', 'PADRE'])

/**
 * Consulta la tarjeta de un alumno.
 *
 * Orden deliberado: sesión → rol → identificador → lectura. Quien no inició
 * sesión recibe 401 sin enterarse de si el identificador es válido. Docente,
 * PERSONAL y una cuenta sin perfil reciben 403. Para un alumno, un padre no
 * vinculado o un identificador inexistente, la respuesta es la MISMA (404): RLS
 * oculta la fila y la ruta no distingue «no existe» de «no es tuyo».
 */
export async function GET(_request: Request, contexto: Contexto) {
  const sesion = await requerirSesionConRol()
  if (!sesion.autorizado) return responderDenegacion(sesion)
  if (!sesion.rol || !ROLES_LECTURA.has(sesion.rol)) return responderError('SIN_PERMISO')

  const parametros = parametrosAlumnoSchema.safeParse(await contexto.params)
  if (!parametros.success) return responderError('IDENTIFICADOR_INVALIDO')

  const resultado = await obtenerTarjeta(parametros.data.alumnoId, {
    consultarAcceso: sesion.rol === 'DIRECTOR',
  })
  if (!resultado.ok) return responderError(resultado.codigo)
  return responderDatos({ tarjeta: resultado.datos })
}

/** Emite la credencial del alumno (solo Dirección). No lee cuerpo: el alumno viene de la URL y el actor, de la sesión. */
export async function POST(_request: Request, contexto: Contexto) {
  const autorizacion = await requerirDirector('Solo la dirección puede emitir credenciales.')
  if (!autorizacion.autorizado) return responderDenegacion(autorizacion)

  const parametros = parametrosAlumnoSchema.safeParse(await contexto.params)
  if (!parametros.success) return responderError('IDENTIFICADOR_INVALIDO')

  const resultado = await emitirCredencial(parametros.data.alumnoId)
  if (!resultado.ok) return responderError(resultado.codigo)
  return responderDatos({ credencial: { id: resultado.datos.credencialId } }, 201)
}

export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
