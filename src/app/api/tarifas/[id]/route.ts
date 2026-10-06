import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { actualizarTarifaSchema, primerErrorTarifas, tarifaIdSchema } from '@/lib/tarifas'
import { requerirDirector } from '@/services/autorizacion'
import { actualizarTarifa } from '@/services/tarifas.service'
import { leerCuerpo, MENSAJE_NO_AUTORIZADO, responderError } from '../_comun'

export const dynamic = 'force-dynamic'

/**
 * Corrección del importe y la vigencia de una versión de tarifa (EPT-103). En
 * Next.js 16 los parámetros dinámicos llegan como una promesa.
 *
 * El concepto y la referencia no se aceptan: son la identidad de la tarifa y la
 * base los protege cuando ya se facturó con ella. El cuerpo trae además los
 * valores previos que vio quien edita; si otra persona cambió la tarifa en el
 * medio la respuesta es 409 y no se sobrescribe nada.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id } = await params
  const idParsed = tarifaIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Identificador de tarifa inválido' }, { status: 400 })
  }

  const cuerpo = await leerCuerpo(request)
  if (cuerpo === undefined) {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarTarifaSchema.safeParse(cuerpo)
  if (!parsed.success) {
    const issue = primerErrorTarifas(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado = await actualizarTarifa(idParsed.data, parsed.data)
  if (!resultado.ok) return responderError(resultado)

  revalidatePath('/dashboard/tarifas')
  return NextResponse.json({ ok: true, tarifa: resultado.datos })
}
