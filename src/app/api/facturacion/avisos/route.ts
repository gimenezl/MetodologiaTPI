import { requerirDirector } from '@/services/autorizacion'
import { createServerSupabaseClient } from '@/services/supabase.server'

export const dynamic = 'force-dynamic'

/** Aviso mínimo protegido para Dirección, sin pantalla de facturas ni correo RF15. */
export async function GET() {
  const permiso = await requerirDirector('Solo Dirección puede consultar los avisos de facturación.')
  if (!permiso.autorizado) return Response.json({ error: permiso.mensaje }, { status: permiso.estado })
  const db = await createServerSupabaseClient()
  const resultado = await db.rpc('facturacion_avisos_director')
  if (resultado.error) return Response.json({ error: 'No se pudieron consultar los avisos.' }, { status: 403 })
  return Response.json({ avisos: resultado.data }, { headers: { 'Cache-Control': 'no-store' } })
}
