import { NextResponse } from 'next/server'
import { requerirRol } from '@/services/autorizacion'
import { listarHijos, listarCursosDisponibles } from '@/services/hijos.service'

export const dynamic = 'force-dynamic'
// Datos de menores: ninguna respuesta (ni de error) puede quedar en cachés.
const SIN_CACHE = { 'Cache-Control': 'no-store' } as const
const DENEGADO = 'Solo un padre puede consultar a sus hijos vinculados.'

export async function GET() {
  const permiso = await requerirRol('PADRE', DENEGADO)
  if (!permiso.autorizado) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado, headers: SIN_CACHE })
  }
  try {
    const [hijos, cursos] = await Promise.all([listarHijos(), listarCursosDisponibles()])
    return NextResponse.json({ hijos, cursos }, { headers: SIN_CACHE })
  } catch {
    return NextResponse.json(
      { error: 'No pudimos cargar los datos de tus hijos. Volvé a intentarlo.' },
      { status: 500, headers: SIN_CACHE }
    )
  }
}
