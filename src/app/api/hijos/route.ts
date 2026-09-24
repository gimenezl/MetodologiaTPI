import { NextResponse } from 'next/server'
import { requerirRol } from '@/services/autorizacion'
import { listarHijos, listarCursosDisponibles } from '@/services/hijos.service'

export const dynamic = 'force-dynamic'
const DENEGADO = 'Solo un padre puede consultar a sus hijos vinculados.'

export async function GET() {
  const permiso = await requerirRol('PADRE', DENEGADO)
  if (!permiso.autorizado) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }
  try {
    const [hijos, cursos] = await Promise.all([listarHijos(), listarCursosDisponibles()])
    return NextResponse.json({ hijos, cursos })
  } catch {
    return NextResponse.json(
      { error: 'No pudimos cargar los datos de tus hijos. Volvé a intentarlo.' },
      { status: 500 }
    )
  }
}
