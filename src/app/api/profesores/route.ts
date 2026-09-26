import { NextResponse } from 'next/server'
import { requerirDirector } from '@/services/autorizacion'
import { listarProfesores } from '@/services/profesores.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede administrar las fichas de profesores.'

/**
 * Listado de fichas de profesores (EPT-58). Solo la dirección.
 *
 * Es una lectura: no se declara POST (el alta de personas sigue en Usuarios) ni
 * DELETE (no existe borrado). Next.js responde 405 a cualquier método no
 * declarado.
 */
export async function GET() {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const resultado = await listarProfesores()
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensaje }, { status: resultado.estado })
  }

  return NextResponse.json(
    { profesores: resultado.datos },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
