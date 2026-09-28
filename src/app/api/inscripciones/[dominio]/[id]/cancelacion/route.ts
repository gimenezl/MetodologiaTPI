import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { operarInscripcion, type ParametrosRuta } from '../_operar'
import { cancelarInscripcionAdministrativa } from '@/services/inscripciones-administracion.service'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['POST'] as const

/**
 * Cancela una inscripción en nombre del alumno (EPT-62, RF16). Exclusivo de Dirección.
 *
 * Baja lógica: no elimina ninguna fila, conserva el historial y la confirmación
 * previa. Una matrícula no se cancela por esta vía (400): se cierra inactivando
 * al alumno o cambiándole el curso desde Alumnos. No existe DELETE. El cuerpo se
 * ignora: la inscripción la decide la URL, nunca un alumno enviado por el navegador.
 *
 * Códigos: 200 cancelada; 400 dominio o identificador inválido, o matrícula;
 * 401 sin sesión; 403 no es Dirección o acceso bloqueado; 404 no existe (o es de
 * otro dominio); 409 ya estaba cancelada, o conflicto concurrente; 500 error interno.
 *
 * En Next.js 16 los parámetros dinámicos llegan como una promesa.
 */
export async function POST(_request: Request, contexto: ParametrosRuta) {
  return operarInscripcion(contexto, cancelarInscripcionAdministrativa, (inscripcion) => ({
    inscripcion,
  }))
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
