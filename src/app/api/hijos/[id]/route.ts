import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requerirRol } from '@/services/autorizacion'
import { obtenerHijo } from '@/services/hijos.service'

export const dynamic = 'force-dynamic'
const idSchema = z.uuid()

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const permiso = await requerirRol('PADRE', 'Solo un padre puede consultar a sus hijos vinculados.')
  if (!permiso.autorizado) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'El identificador del hijo no es válido.' }, { status: 400 })
  }
  try {
    const hijo = await obtenerHijo(id)
    if (!hijo) return NextResponse.json({ error: 'El hijo solicitado no está disponible.' }, { status: 404 })
    return NextResponse.json({ hijo })
  } catch {
    return NextResponse.json({ error: 'No pudimos consultar al hijo. Volvé a intentarlo.' }, { status: 500 })
  }
}
