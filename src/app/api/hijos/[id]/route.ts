import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requerirRol } from '@/services/autorizacion'
import { obtenerHijo } from '@/services/hijos.service'

export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'Cache-Control': 'no-store' } as const
const idSchema = z.uuid()

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const permiso = await requerirRol('PADRE', 'Solo un padre puede consultar a sus hijos vinculados.')
  if (!permiso.autorizado) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado, headers: SIN_CACHE })
  }
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'El identificador del hijo no es válido.' }, { status: 400, headers: SIN_CACHE })
  }
  try {
    const hijo = await obtenerHijo(id)
    if (!hijo) return NextResponse.json({ error: 'El hijo solicitado no está disponible.' }, { status: 404, headers: SIN_CACHE })
    return NextResponse.json({ hijo }, { headers: SIN_CACHE })
  } catch {
    return NextResponse.json({ error: 'No pudimos consultar al hijo. Volvé a intentarlo.' }, { status: 500, headers: SIN_CACHE })
  }
}
