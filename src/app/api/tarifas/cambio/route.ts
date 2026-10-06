import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { cambiarTarifaSchema, primerErrorTarifas } from '@/lib/tarifas'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirDirector } from '@/services/autorizacion'
import { cambiarTarifa } from '@/services/tarifas.service'
import { leerCuerpo, MENSAJE_NO_AUTORIZADO, responderError } from '../_comun'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['POST'] as const

/**
 * Cambio de precio por Dirección (EPT-103): «a partir del día D el importe es X».
 *
 * La base cierra la versión vigente el día anterior (D-1) e inserta la nueva en
 * una sola transacción; un rechazo no deja nada persistido. No toca facturas ni
 * ítems ya emitidos.
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

  const parsed = cambiarTarifaSchema.safeParse(cuerpo)
  if (!parsed.success) {
    const issue = primerErrorTarifas(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado = await cambiarTarifa(parsed.data)
  if (!resultado.ok) return responderError(resultado)

  revalidatePath('/dashboard/tarifas')
  return NextResponse.json({
    ok: true,
    anterior: resultado.datos.anterior,
    nueva: resultado.datos.nueva,
  })
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
