import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { crearTarifaSchema, primerErrorTarifas } from '@/lib/tarifas'
import { requerirDirector } from '@/services/autorizacion'
import { crearTarifa } from '@/services/tarifas.service'
import { leerCuerpo, MENSAJE_NO_AUTORIZADO, responderError } from './_comun'

export const dynamic = 'force-dynamic'

/**
 * Alta de una versión de tarifa por Dirección (EPT-103).
 *
 * La identidad sale de la sesión: el esquema es estricto y rechaza cualquier
 * campo de actor, rol o perfil. La base vuelve a exigir el rol y el bloqueo
 * vigentes. No se define GET, PUT ni DELETE: la lectura es de la pantalla de
 * servidor y no existe borrado físico de tarifas.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const cuerpo = await leerCuerpo(request)
  if (cuerpo === undefined) {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = crearTarifaSchema.safeParse(cuerpo)
  if (!parsed.success) {
    const issue = primerErrorTarifas(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado = await crearTarifa(parsed.data)
  if (!resultado.ok) return responderError(resultado)

  revalidatePath('/dashboard/tarifas')
  return NextResponse.json({ ok: true, tarifa: resultado.datos }, { status: 201 })
}
