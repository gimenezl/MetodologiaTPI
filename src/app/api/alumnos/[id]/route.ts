import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  actualizarAlumnoSchema,
  alumnoIdSchema,
  primerErrorAlumno,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import {
  cambiarCursoAlumno,
  corregirIdentidadAlumno,
  inactivarAlumno,
  reactivarAlumno,
} from '@/services/alumnos.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo el director puede administrar los legajos académicos.'

/**
 * Corrección de identidad, cambio de curso, inactivación y reactivación,
 * expresadas mediante un contrato discriminado: cada petición realiza una sola
 * operación académica. En Next.js 16 los parámetros dinámicos son una promesa.
 *
 * No se define DELETE: la única baja admitida es lógica y viaja por PATCH.
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
  const idParsed = alumnoIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Identificador de alumno inválido' },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarAlumnoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorAlumno(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const alumnoId = idParsed.data
  const accion = parsed.data

  const resultado =
    accion.accion === 'corregir_identidad'
      ? await corregirIdentidadAlumno(alumnoId, accion.dni, accion.legajo_nro)
      : accion.accion === 'cambiar_curso'
        ? await cambiarCursoAlumno(alumnoId, accion.curso_id)
        : accion.accion === 'inactivar'
          ? await inactivarAlumno(alumnoId)
          : await reactivarAlumno(alumnoId, accion.curso_id)

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/alumnos')
  revalidatePath(`/dashboard/alumnos/${alumnoId}`)

  return NextResponse.json({ ok: true, alumno_id: resultado.datos })
}
