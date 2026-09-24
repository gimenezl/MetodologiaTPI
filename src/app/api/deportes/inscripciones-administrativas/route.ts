import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { inscripcionAdministrativaSchema, primerErrorDeportes } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { inscribirAlumnoAdministrativamente } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede inscribir a un alumno en un deporte.'

/**
 * Alta deportiva realizada por la dirección en nombre de un alumno (EPT-40).
 *
 * La dirección elige el alumno y el grupo; nada más. PostgreSQL inserta la
 * misma fila que el alta del propio alumno y la valida con el mismo trigger:
 * alumno activo, nivel, cupo, duplicados, máximo de dos deportes, horario
 * cargado y compatibilidad horaria. No existe forma de eludir ninguna regla
 * por esta vía.
 *
 * Códigos: 400 cuerpo malformado; 422 campos inválidos; 404 alumno o grupo
 * inexistente; 409 regla de negocio (incluido el conflicto horario, que se
 * devuelve también estructurado en `conflicto`).
 */
export async function POST(request: Request) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = inscripcionAdministrativaSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 422 })
  }

  const resultado = await inscribirAlumnoAdministrativamente(parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo, conflicto: resultado.conflicto },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, inscripcion: resultado.datos }, { status: 201 })
}
