import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  actualizarHorarioGrupoSchema,
  franjaHorariaIdSchema,
  grupoDeportivoIdSchema,
  primerErrorDeportes,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { darDeBajaHorarioGrupo } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo la dirección puede configurar los horarios de los grupos deportivos.'

/**
 * Baja lógica de una franja de un grupo (EPT-38). La fila se conserva con su
 * fecha de baja; volver a asignar la franja crea una fila nueva que se valida
 * de nuevo. Quitar una franja nunca crea un conflicto horario.
 *
 * No existe eliminación física: DELETE no está definido y Next.js responde 405.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; franjaId: string }> }
) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id, franjaId } = await params
  const grupo = grupoDeportivoIdSchema.safeParse(id)
  const franja = franjaHorariaIdSchema.safeParse(franjaId)
  if (!grupo.success || !franja.success) {
    return NextResponse.json({ error: 'Identificador de franja inválido' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarHorarioGrupoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 422 })
  }

  const resultado = await darDeBajaHorarioGrupo(grupo.data, franja.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, franja: resultado.datos })
}
