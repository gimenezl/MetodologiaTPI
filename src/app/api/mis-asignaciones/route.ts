import { NextResponse } from 'next/server'
import { requerirRol } from '@/services/autorizacion'
import { obtenerMisAsignaciones } from '@/services/profesores.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo un docente puede consultar sus propias asignaciones.'

/**
 * Ficha, relaciones y horarios del docente de la sesión (EPT-58).
 *
 * No recibe identificador: pedir otra ficha no es algo que esta ruta sepa
 * expresar. La base vuelve a resolver a quién pertenece la sesión y rechaza a
 * cualquier otro rol. Un docente con la ficha INACTIVO sigue pudiendo
 * consultarla. Next.js responde 405 a cualquier método que no sea GET.
 */
export async function GET() {
  const autorizacion = await requerirRol('DOCENTE', MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const resultado = await obtenerMisAsignaciones()
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensaje }, { status: resultado.estado })
  }

  return NextResponse.json(resultado.datos, { headers: { 'Cache-Control': 'no-store' } })
}
