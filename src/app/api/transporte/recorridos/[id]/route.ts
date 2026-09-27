import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  actualizarRecorridoSchema,
  primerErrorTransporte,
  recorridoServicioIdSchema,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { actualizarRecorrido } from '@/services/transporte.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo Dirección puede administrar los recorridos de transporte.'

/**
 * Mantenimiento descriptivo de un recorrido por Dirección (EPT-60). En
 * Next.js 16 los parámetros dinámicos llegan como una promesa.
 *
 * Solo nombre y estado activo/inactivo. El código y el tipo no se aceptan
 * acá: son inmutables en la base en cuanto el recorrido tiene alguna
 * inscripción, y esta ruta ni siquiera los transporta.
 *
 * No se define POST ni DELETE: los cuatro recorridos son datos de referencia
 * fijos (EPT-60); no se crean ni se borran desde la aplicación.
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
  const idParsed = recorridoServicioIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Identificador de recorrido inválido' },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarRecorridoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorTransporte(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado = await actualizarRecorrido(
    idParsed.data,
    parsed.data.nombre,
    parsed.data.activo
  )
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/transporte')

  return NextResponse.json({ ok: true, recorrido: resultado.datos })
}
