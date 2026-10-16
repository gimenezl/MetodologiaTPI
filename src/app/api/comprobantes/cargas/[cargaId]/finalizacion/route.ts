import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { autenticarBearer } from '@/services/autenticacion-bearer'
import { finalizarCargaComprobante } from '@/services/comprobantes-finalizacion'
import { createAdminClient } from '@/services/supabase.admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Descargar, validar y publicar un archivo de hasta 5 MiB.
export const maxDuration = 60

const PERMITIDOS = ['POST'] as const
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * Finaliza una carga de comprobante (EPT-109).
 *
 * El archivo NO viaja por esta ruta: el servidor de Next limita el cuerpo a
 * 4,5 MB y el máximo aprobado es 5 MiB. El cliente lo sube antes, directo a
 * Storage, a la ruta temporal de su carga. Esta ruta solo recibe la identidad
 * (Bearer, verificada contra Auth) y el id de la carga, lee los bytes, los valida
 * de verdad, los publica y confirma en la base.
 *
 * Sin cuerpo: el cliente no aporta usuario, pago, ruta, tipo, tamaño ni hash.
 */
export async function POST(
  request: Request,
  contexto: { params: Promise<{ cargaId: string }> }
) {
  const { cargaId } = await contexto.params
  if (!UUID.test(cargaId)) {
    return Response.json(
      { codigo: 'CARGA_INVALIDA', mensaje: 'La carga indicada no es válida.' },
      { status: 400, headers: SIN_CACHE }
    )
  }

  const identidad = await autenticarBearer(request.headers)
  if (!identidad.ok) {
    return Response.json(
      { codigo: identidad.estado === 401 ? 'SIN_SESION' : 'SERVICIO_NO_DISPONIBLE', mensaje: identidad.mensaje },
      { status: identidad.estado, headers: SIN_CACHE }
    )
  }

  let admin
  try {
    // Descargar y publicar 5 MiB necesita más que el tope por defecto de 4 s.
    admin = createAdminClient(30_000)
  } catch {
    return Response.json(
      { codigo: 'SERVICIO_NO_DISPONIBLE', mensaje: 'El servicio no está disponible.' },
      { status: 503, headers: SIN_CACHE }
    )
  }

  try {
    const resultado = await finalizarCargaComprobante(admin, identidad.userId, cargaId.toLowerCase())
    return Response.json(resultado.cuerpo, { status: resultado.estado, headers: SIN_CACHE })
  } catch {
    return Response.json(
      {
        codigo: 'RESULTADO_INCIERTO',
        mensaje:
          'No pudimos confirmar si el comprobante quedó registrado. Revisá el estado de la carga antes de volver a enviarlo.',
      },
      { status: 503, headers: SIN_CACHE }
    )
  }
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
