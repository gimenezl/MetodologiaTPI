import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  actualizarInscripcionDeportivaSchema,
  inscripcionDeportivaIdSchema,
  primerErrorDeportes,
} from '@/lib/validations'
import { requerirRol } from '@/services/autorizacion'
import { cancelarInscripcionDeportiva } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo un estudiante puede cancelar su inscripción a un deporte.'

/**
 * Baja lógica de una inscripción deportiva propia (EPT-34). En Next.js 16 los
 * parámetros dinámicos llegan como una promesa.
 *
 * El identificador no alcanza para cancelar: PostgreSQL exige además que la
 * inscripción sea del alumno de la sesión. Una ajena responde igual que una
 * inexistente. Un reintento sobre una baja ya confirmada responde 409 y no
 * libera la plaza dos veces.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const autorizacion = await requerirRol('ESTUDIANTE', MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id } = await params
  const idParsed = inscripcionDeportivaIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Identificador de inscripción inválido' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarInscripcionDeportivaSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado = await cancelarInscripcionDeportiva(idParsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, inscripcion: resultado.datos })
}
