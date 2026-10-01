import { cuerpoRegistroSchema } from '@/lib/accesos-qr/esquemas'
import { origenPermitido } from '@/lib/accesos-qr/origen'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirSesionConRol } from '@/services/autorizacion'
import { consumirCupo, registrarEscaneo } from '@/services/accesos-qr.service'
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
 * Registra el acceso de un alumno al comedor o al transporte a partir del texto
 * ÍNTEGRO de su QR (EPT-65, RF21).
 *
 * Secuencia estricta (la garantía de seguridad está en el orden):
 *
 *   1. origen de la petición (no consulta nada);
 *   2. sesión verificada y rol DIRECTOR o PERSONAL, con acceso habilitado;
 *   3. contador de solicitudes del operador → 429 con `Retry-After` si se excedió.
 *      Es ATÓMICO en la base y va ANTES de verificar la firma;
 *   4. cuerpo: JSON, tope de tamaño y esquema estricto;
 *   5. formato, versión, kid y firma HMAC. Si falla: contador de inválidos y
 *      `NO_RECONOCIDO`, SIN consultar la credencial ni crear ningún evento;
 *   6. solo con firma válida: la operación privilegiada, con el cliente
 *      administrativo (`service_role`, sin el token del usuario).
 *
 * El cliente NUNCA aporta el actor: se obtiene de la sesión del paso 2. Una
 * llamada con solo `credencial_id`, `alumno_id`, `legajo` o `dni` no tiene dónde
 * viajar (el esquema es estricto) y jamás registra un acceso.
 *
 * La respuesta es un conjunto cerrado. Solo `REGISTRADO` trae nombre, apellido y
 * legajo; toda denegación es genérica. `Cache-Control: no-store` en todo.
 */
export async function POST(request: Request) {
  if (!origenPermitido(request.headers)) return responderError('ORIGEN_NO_PERMITIDO')

  const sesion = await requerirSesionConRol()
  if (!sesion.autorizado) return responderDenegacion(sesion)
  if (sesion.rol !== 'DIRECTOR' && sesion.rol !== 'PERSONAL') return responderError('SIN_PERMISO')

  const cupo = await consumirCupo(sesion.userId)
  if (!cupo.ok) return responderError(cupo.codigo)
  if (!cupo.datos.permitido) return responderError('LIMITE_EXCEDIDO', cupo.datos.reintentarEnSegundos)

  const cuerpo = await leerCuerpoJson(request)
  if (!cuerpo.ok) return responderError(cuerpo.codigo)
  const datos = validar(cuerpoRegistroSchema, cuerpo.datos)
  if (!datos.ok) return responderError(datos.codigo)

  const resultado = await registrarEscaneo({
    userId: sesion.userId,
    payload: datos.datos.payload,
    intentoId: datos.datos.intento_id,
    servicioId: datos.datos.servicio_id,
    sentido: datos.datos.sentido,
  })
  if (!resultado.ok) return responderError(resultado.codigo, resultado.reintentarEnSegundos)

  return responderDatos(resultado.datos)
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
