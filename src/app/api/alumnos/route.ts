import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { crearAlumnoSchema, primerErrorAlumno } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { crearAlumno } from '@/services/alumnos.service'

export const dynamic = 'force-dynamic'

export const MENSAJE_NO_AUTORIZADO =
  'Solo el director puede administrar los legajos académicos.'

/**
 * Alta del legajo académico. Autoriza antes de leer el cuerpo para no revelar
 * reglas de validación a una petición que no tiene acceso al recurso.
 *
 * No crea cuenta de acceso ni vínculo parental: un legajo puede existir sin
 * usuario de Auth y el tutor no es requisito de esta historia.
 *
 * No se define DELETE: Next.js responde 405 Method Not Allowed.
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

  const parsed = crearAlumnoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorAlumno(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado = await crearAlumno(parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/alumnos')

  return NextResponse.json({ ok: true, alumno_id: resultado.datos }, { status: 201 })
}
