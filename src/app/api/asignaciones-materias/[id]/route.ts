import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  actualizarAsignacionSchema,
  asignacionIdSchema,
  primerErrorMateria,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import {
  cambiarEstadoAsignacion,
  cambiarProfesorAsignacion,
} from '@/services/materias.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo el director puede administrar las materias.'

/**
 * Cambio de profesor responsable o de estado de una asignación existente. La
 * materia y el curso de una asignación no se modifican: son su identidad.
 *
 * No se define DELETE: la baja de una asignación es lógica.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json(
      { error: autorizacion.mensaje },
      { status: autorizacion.estado }
    )
  }

  const { id } = await params
  const idParsed = asignacionIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Identificador de asignación inválido' },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarAsignacionSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorMateria(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado =
    parsed.data.accion === 'cambiar_profesor'
      ? await cambiarProfesorAsignacion(idParsed.data, parsed.data.profesor_id)
      : await cambiarEstadoAsignacion(idParsed.data, parsed.data.activo)

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/materias')

  return NextResponse.json({ ok: true, asignacion: resultado.datos })
}
