import { z } from 'zod'
import { requerirDirector } from '@/services/autorizacion'
import { createServerSupabaseClient } from '@/services/supabase.server'
import { rechazarSiNoEsConfiable } from '../../tarifas/_comun'

const esquema = z.object({ alumno_id: z.uuid(), periodo: z.string().regex(/^\d{4}-\d{2}-01$/u) }).strict()
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const permiso = await requerirDirector('Solo Dirección puede reintentar facturas pendientes.')
  if (!permiso.autorizado) return Response.json({ error: permiso.mensaje }, { status: permiso.estado })
  const rechazo = rechazarSiNoEsConfiable(request)
  if (rechazo) return rechazo
  const cuerpo = esquema.safeParse(await request.json().catch(() => null))
  if (!cuerpo.success) return Response.json({ error: 'La clave de facturación es inválida.' }, { status: 400 })
  const db = await createServerSupabaseClient()
  const resultado = await db.rpc('facturacion_reintentar', {
    p_alumno: cuerpo.data.alumno_id, p_periodo: cuerpo.data.periodo,
  })
  if (resultado.error) return Response.json({ error: 'No se pudo verificar el reintento. Consulte los avisos antes de repetir.' }, { status: 409 })
  return Response.json(resultado.data, { headers: { 'Cache-Control': 'no-store' } })
}
