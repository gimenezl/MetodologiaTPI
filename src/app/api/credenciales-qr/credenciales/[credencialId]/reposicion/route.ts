import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { reponerCredencial } from '@/services/credenciales-qr.service'
import { operarSobreCredencial } from '../_operar'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['POST'] as const

/** Repone: revoca la credencial indicada y emite otra en una sola transacción. Devuelve la nueva. */
export async function POST(
  request: Request,
  contexto: { params: Promise<{ credencialId: string }> }
) {
  return operarSobreCredencial(
    contexto,
    request,
    'Solo la dirección puede reponer credenciales.',
    reponerCredencial
  )
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
