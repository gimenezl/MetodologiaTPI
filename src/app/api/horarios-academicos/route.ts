import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { esHoraValida, normalizarHora } from '@/lib/horarios'
import { requerirDirector } from '@/services/autorizacion'
import { configurarFranja } from '@/services/horarios-academicos.service'

export const dynamic = 'force-dynamic'

const uuid = z.uuid()
const hora = z.string().refine(esHoraValida)
const esquema = z.object({
  asignacion_id: uuid,
  dia_semana: z.number().int().min(1).max(7),
  hora_inicio: hora,
  hora_fin: hora,
  franja_id: uuid.optional(),
}).refine((datos) => normalizarHora(datos.hora_inicio) < normalizarHora(datos.hora_fin))

export async function POST(request: Request) {
  const permiso = await requerirDirector('Solo la dirección puede administrar horarios académicos.')
  if (!permiso.autorizado) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  const body = await request.json().catch(() => null)
  const parsed = esquema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Revisá la asignación, el día y el rango horario.' }, { status: 422 })
  }
  const resultado = await configurarFranja(parsed.data)
  if (!resultado.ok) return NextResponse.json({ error: resultado.mensaje }, { status: resultado.estado })
  revalidatePath('/dashboard/horarios-academicos')
  return NextResponse.json({ ok: true, franja: resultado.datos }, { status: parsed.data.franja_id ? 200 : 201 })
}
