import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { asignarMateriaSchema, primerErrorMateria } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { asignarMateriaCurso } from '@/services/materias.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo el director puede administrar las materias.'

/**
 * Alta de una asignación Curso–Materia con profesor responsable opcional.
 *
 * La existencia y el estado de la materia y del curso, y el rol real del
 * profesor, los valida PostgreSQL: acá solo se comprueba la forma del cuerpo.
 *
 * No se define DELETE: una asignación nunca se elimina, se inactiva.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json(
      { error: autorizacion.mensaje },
      { status: autorizacion.estado }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = asignarMateriaSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorMateria(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado = await asignarMateriaCurso(
    parsed.data.materia_id,
    parsed.data.curso_id,
    parsed.data.profesor_id ?? null
  )

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/materias')

  return NextResponse.json({ ok: true, asignacion: resultado.datos }, { status: 201 })
}
