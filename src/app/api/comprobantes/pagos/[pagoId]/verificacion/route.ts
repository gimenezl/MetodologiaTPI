import { NextResponse } from 'next/server'
import { requerirDirector } from '@/services/autorizacion'
import { operarVerificacion } from '@/services/comprobantes-verificacion.service'
import { decisionPagoSchema, pagoIdSchema } from '@/lib/comprobantes-verificacion'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { leerCuerpo, rechazarSiNoEsConfiable } from '@/app/api/tarifas/_comun'

export const dynamic = 'force-dynamic'
type Contexto = { params: Promise<{ pagoId: string }> }
const METODOS = ['GET', 'POST'] as const

async function ejecutar(request: Request, contexto: Contexto, escribir: boolean) {
  const permiso = await requerirDirector('Solo Dirección puede verificar los pagos.')
  if (!permiso.autorizado) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado, headers: { 'Cache-Control': 'no-store' } })
  }
  const { pagoId } = await contexto.params
  if (!pagoIdSchema.safeParse(pagoId).success) {
    return NextResponse.json({ error: 'Identificador de pago inválido.' }, { status: 400 })
  }
  let decision
  if (escribir) {
    const rechazo = rechazarSiNoEsConfiable(request)
    if (rechazo) return rechazo
    const parsed = decisionPagoSchema.safeParse(await leerCuerpo(request))
    if (!parsed.success) return NextResponse.json({ error: 'Revisa la decisión y el motivo de rechazo.' }, { status: 400 })
    decision = parsed.data
  }
  const resultado = await operarVerificacion(pagoId, decision)
  return resultado.ok
    ? NextResponse.json({ resultado: resultado.datos }, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ error: resultado.error, codigo: resultado.codigo }, { status: resultado.estado, headers: { 'Cache-Control': 'no-store' } })
}
export const GET = (request: Request, contexto: Contexto) => ejecutar(request, contexto, false)
export const POST = (request: Request, contexto: Contexto) => ejecutar(request, contexto, true)
export const PUT = () => metodoNoPermitido(METODOS)
export const PATCH = () => metodoNoPermitido(METODOS)
export const DELETE = () => metodoNoPermitido(METODOS)
export const OPTIONS = () => opcionesPermitidas(METODOS)
