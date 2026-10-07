import { timingSafeEqual } from 'node:crypto'
import { ejecutarFacturacion } from '@/services/facturacion-job'
import { metodoNoPermitido } from '@/lib/metodos-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Vercel Cron usa GET y Authorization: Bearer CRON_SECRET. Sin reloj del caller. */
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET
  const recibido = request.headers.get('authorization') ?? ''
  const esperado = `Bearer ${secreto ?? ''}`
  if (!secreto || Buffer.byteLength(recibido) !== Buffer.byteLength(esperado) ||
      !timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado))) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 })
  }
  if (new URL(request.url).search) {
    return Response.json({ error: 'Esta tarea no admite parámetros.' }, { status: 400 })
  }
  if (process.env.EPT_FACTURACION_HABILITADA !== 'habilitada') {
    return Response.json({ habilitada: false, mensaje: 'La facturación está deshabilitada.' },
      { headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const resultado = await ejecutarFacturacion()
    return Response.json(resultado, { status: resultado.inciertas ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'No se pudo verificar la ejecución de facturación.' }, { status: 503 })
  }
}
export const POST = () => metodoNoPermitido(['GET'])
export const PUT = POST
export const PATCH = POST
export const DELETE = POST
export const HEAD = POST
