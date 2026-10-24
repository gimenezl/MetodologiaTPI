import { timingSafeEqual } from 'node:crypto'
import { ejecutarAvisoDeuda } from '@/services/aviso-deuda-job'
import { metodoNoPermitido } from '@/lib/metodos-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Aviso de deuda del día 20 (EPT-116). Vercel Cron usa GET y Authorization: Bearer CRON_SECRET.
 * Sin fecha, destinatario ni importes del llamador; con la compuerta apagada no toca la base
 * ni SMTP. Compuerta propia: no se activa con la del recordatorio mensual.
 */
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
  if (process.env.EPT_AVISO_DEUDA_HABILITADO !== 'habilitado') {
    return Response.json({ habilitada: false, mensaje: 'El aviso de deuda está deshabilitado.' },
      { headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const resultado = await ejecutarAvisoDeuda()
    const fallo = !resultado.smtp_configurado || resultado.sin_confirmar > 0
    return Response.json(resultado, { status: fallo ? 503 : 200, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'No se pudo verificar la ejecución del aviso de deuda.' }, { status: 503 })
  }
}
export const POST = () => metodoNoPermitido(['GET'])
export const PUT = POST
export const PATCH = POST
export const DELETE = POST
export const HEAD = POST
