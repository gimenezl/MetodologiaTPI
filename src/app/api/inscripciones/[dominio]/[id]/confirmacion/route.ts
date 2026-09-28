import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { operarInscripcion, type ParametrosRuta } from '../_operar'
import { confirmarInscripcion } from '@/services/inscripciones-administracion.service'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['POST'] as const

/**
 * Confirma una inscripción o una matrícula (EPT-62, RF16). Exclusivo de Dirección.
 *
 * Confirmar es una acción real y registrada, no una consulta: queda guardado
 * quién y cuándo. Es idempotente (repetirla devuelve la confirmación original con
 * `ya_confirmada: true`), no condiciona la vigencia y no se aplica a una
 * inscripción cancelada ni a una matrícula cerrada. El cuerpo se ignora.
 *
 * Códigos: 200 confirmada; 400 dominio o identificador inválido; 401 sin sesión;
 * 403 no es Dirección o acceso bloqueado; 404 no existe (o es de otro dominio);
 * 409 cancelada o cerrada, o conflicto concurrente; 500 error interno.
 *
 * En Next.js 16 los parámetros dinámicos llegan como una promesa.
 */
export async function POST(_request: Request, contexto: ParametrosRuta) {
  return operarInscripcion(contexto, confirmarInscripcion, (confirmacion) => ({ confirmacion }))
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
