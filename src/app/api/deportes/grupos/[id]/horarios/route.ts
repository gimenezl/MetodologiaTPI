import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  agregarHorarioGrupoSchema,
  grupoDeportivoIdSchema,
  primerErrorDeportes,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { agregarHorarioGrupo } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo la dirección puede configurar los horarios de los grupos deportivos.'

/**
 * Asigna una franja semanal a un grupo deportivo (EPT-38, EPT-40).
 *
 * El rol se verifica acá y otra vez en PostgreSQL. La base valida, con el grupo
 * bloqueado, que la franja no se superponga con otra del mismo grupo ni genere
 * un conflicto a los alumnos que ya están inscriptos.
 *
 * Códigos: 400 cuerpo o identificador malformado; 422 franja inválida (día o
 * rango); 404 grupo inexistente; 409 franja repetida o superpuesta.
 *
 * No se define DELETE: Next.js responde 405. La baja es lógica y va por PATCH
 * sobre la franja.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id } = await params
  const grupo = grupoDeportivoIdSchema.safeParse(id)
  if (!grupo.success) {
    return NextResponse.json({ error: 'Identificador de grupo inválido' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = agregarHorarioGrupoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 422 })
  }

  const resultado = await agregarHorarioGrupo(grupo.data, parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, franja: resultado.datos }, { status: 201 })
}
