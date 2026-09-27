import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  actualizarInscripcionServicioSchema,
  inscripcionServicioIdSchema,
  primerErrorTransporte,
} from '@/lib/validations'
import { requerirRol } from '@/services/autorizacion'
import { cancelarInscripcionTransporte } from '@/services/transporte.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo un estudiante puede cancelar su inscripción de transporte.'

/**
 * Baja lógica de la inscripción de transporte propia, sin reemplazo (EPT-60).
 * En Next.js 16 los parámetros dinámicos llegan como una promesa.
 *
 * Reutiliza el mismo contrato que el comedor
 * (`actualizarInscripcionServicioSchema`): la única acción admitida es
 * `{accion: 'cancelar'}`. El identificador de la inscripción no alcanza para
 * cancelarla: PostgreSQL exige además que su `alumno_id` sea el de la sesión.
 * Una inscripción ajena devuelve exactamente la misma respuesta que una
 * inexistente.
 *
 * No se define DELETE: la única baja admitida es lógica y viaja por PATCH.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const autorizacion = await requerirRol('ESTUDIANTE', MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json(
      { error: autorizacion.mensaje },
      { status: autorizacion.estado }
    )
  }

  const { id } = await params
  const idParsed = inscripcionServicioIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Identificador de inscripción inválido' },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarInscripcionServicioSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorTransporte(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado = await cancelarInscripcionTransporte(idParsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/transporte')

  return NextResponse.json({ ok: true, inscripcion: resultado.datos })
}
