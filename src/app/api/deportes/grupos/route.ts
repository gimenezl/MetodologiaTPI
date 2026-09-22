import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { crearGrupoDeportivoSchema, primerErrorDeportes } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { crearGrupoDeportivo } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede crear grupos deportivos.'

/**
 * Alta mínima de un grupo deportivo por la dirección (EPT-32, EPT-34).
 *
 * Es el mínimo que exige EPT-11 para que el flujo del alumno exista: no hay
 * edición, inactivación ni borrado de grupos por esta ruta. El rol se verifica
 * acá y otra vez en PostgreSQL; el profesor responsable debe tener el rol real
 * DOCENTE, cosa que la base comprueba con la fila del perfil bloqueada.
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

  const parsed = crearGrupoDeportivoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado = await crearGrupoDeportivo(parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, grupo: resultado.datos }, { status: 201 })
}
