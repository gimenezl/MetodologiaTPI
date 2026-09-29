import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { revocarCredencial } from '@/services/credenciales-qr.service'
import { operarSobreCredencial } from '../_operar'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['POST'] as const

/**
 * Revoca la credencial indicada. No existe la operación inversa: una credencial
 * revocada nunca vuelve a valer y tampoco hay DELETE (el historial se conserva).
 */
export async function POST(
  request: Request,
  contexto: { params: Promise<{ credencialId: string }> }
) {
  return operarSobreCredencial(
    contexto,
    request,
    'Solo la dirección puede revocar credenciales.',
    revocarCredencial
  )
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
