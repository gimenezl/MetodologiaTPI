import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requerirRol } from '@/services/autorizacion'
import { matricularHijo } from '@/services/hijos.service'

export const dynamic = 'force-dynamic'
const idSchema = z.uuid()
const solicitudSchema = z.strictObject({ curso_id: z.uuid() })

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const permiso = await requerirRol('PADRE', 'Solo un padre puede matricular a un hijo vinculado.')
  if (!permiso.autorizado) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'El identificador del hijo no es válido.' }, { status: 400 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'La solicitud no contiene datos válidos.' }, { status: 400 })
  }
  const parsed = solicitudSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Elegí un curso válido sin agregar otros datos.' }, { status: 400 })
  }
  const { data, error } = await matricularHijo(id, parsed.data.curso_id)
  if (error) {
    const respuestas: Record<string, [number, string]> = {
      P5520: [404, 'El hijo solicitado no está disponible.'],
      P5521: [409, 'El hijo necesita un legajo académico válido.'],
      P5522: [409, 'El alumno ya está activo.'],
      P5523: [409, 'El alumno ya tiene una matrícula vigente.'],
      P5503: [422, 'El curso elegido no existe.'],
      P5504: [422, 'El curso elegido no está activo.'],
      '23503': [422, 'El curso elegido no existe.'],
      '23505': [409, 'El alumno ya tiene una matrícula vigente.'],
    }
    const [status, mensaje] = respuestas[error.code] ?? [500, 'No pudimos completar la matrícula. Volvé a intentarlo.']
    return NextResponse.json({ error: mensaje }, { status })
  }
  revalidatePath('/dashboard/hijos')
  return NextResponse.json({ ok: true, matricula_id: data }, { status: 201 })
}
