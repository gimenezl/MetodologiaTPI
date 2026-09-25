import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requerirDirector } from '@/services/autorizacion'
import { cambiarEstadoFranja } from '@/services/horarios-academicos.service'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const permiso = await requerirDirector('Solo la dirección puede administrar horarios académicos.')
  if (!permiso.autorizado) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  const { id } = await params
  const identificador = z.uuid().safeParse(id)
  const body = await request.json().catch(() => null)
  const estado = z.object({ activo: z.boolean() }).safeParse(body)
  if (!identificador.success || !estado.success) {
    return NextResponse.json({ error: 'Identificador o estado inválido.' }, { status: 422 })
  }
  const resultado = await cambiarEstadoFranja(id, estado.data.activo)
  if (!resultado.ok) return NextResponse.json({ error: resultado.mensaje }, { status: resultado.estado })
  revalidatePath('/dashboard/horarios-academicos')
  return NextResponse.json({ ok: true, franja: resultado.datos })
}
