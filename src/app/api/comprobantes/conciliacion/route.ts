import { timingSafeEqual } from 'node:crypto'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { conciliarCargasComprobante } from '@/services/comprobantes-conciliacion'
import { createAdminClient } from '@/services/supabase.admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const PERMITIDOS = ['POST'] as const
const SIN_CACHE = { 'Cache-Control': 'no-store' }

/**
 * Conciliación de cargas de comprobante (EPT-109). Retira los objetos temporales
 * de cargas ya resueltas o vencidas. NO está programada: la invoca quien opera el
 * sistema con `Authorization: Bearer ${CRON_SECRET}`. No toca pagos ni ítems.
 */
export async function POST(request: Request) {
  const secreto = process.env.CRON_SECRET
  const recibido = request.headers.get('authorization') ?? ''
  const esperado = `Bearer ${secreto ?? ''}`
  if (
    !secreto ||
    Buffer.byteLength(recibido) !== Buffer.byteLength(esperado) ||
    !timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado))
  ) {
    return Response.json({ error: 'No autorizado.' }, { status: 401, headers: SIN_CACHE })
  }
  if (new URL(request.url).search) {
    return Response.json(
      { error: 'Esta tarea no admite parámetros.' },
      { status: 400, headers: SIN_CACHE }
    )
  }
  try {
    const resultado = await conciliarCargasComprobante(createAdminClient(15_000))
    return Response.json(resultado, {
      status: resultado.pendientes > 0 ? 503 : 200,
      headers: SIN_CACHE,
    })
  } catch {
    return Response.json(
      { error: 'No se pudo completar la conciliación.' },
      { status: 503, headers: SIN_CACHE }
    )
  }
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
