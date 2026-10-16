import { NextResponse } from 'next/server'
import { BUCKET_FINAL } from '@/lib/comprobantes-contrato'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirSesionConRol } from '@/services/autorizacion'
import { createServerSupabaseClient } from '@/services/supabase.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PERMITIDOS = ['GET'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
/** Duración de la URL firmada: corta, y se emite con las credenciales de quien descarga. */
const SEGUNDOS_DE_VIGENCIA = 60

const cabeceras = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}

/**
 * Entrega el archivo ORIGINAL de un comprobante (EPT-109).
 *
 * Solo lo ven quien lo cargó y Dirección: la autoridad es la política de Storage
 * y la de `comprobantes_pago`, que se aplican con la sesión del usuario (no con
 * la clave de servicio). Un copadre, un estudiante, personal, un docente, una
 * cuenta bloqueada y cualquier identificador ajeno reciben el MISMO 404, sin
 * distinguir «no existe» de «no es tuyo».
 *
 * La respuesta es una redirección a una URL firmada de 60 s. Una URL ya emitida
 * sigue sirviendo hasta que vence aunque la cuenta se bloquee después: Storage
 * no ofrece revocación instantánea ni impone un tope de vigencia.
 */
export async function GET(
  _request: Request,
  contexto: { params: Promise<{ comprobanteId: string }> }
) {
  const { comprobanteId } = await contexto.params
  const noEncontrado = () =>
    Response.json(
      { codigo: 'NO_ENCONTRADO', mensaje: 'El comprobante no existe o no está disponible.' },
      { status: 404, headers: cabeceras }
    )
  if (!UUID.test(comprobanteId)) return noEncontrado()

  const sesion = await requerirSesionConRol()
  if (!sesion.autorizado) {
    return Response.json(
      { codigo: sesion.codigo ?? 'SIN_PERMISO', mensaje: sesion.mensaje },
      { status: sesion.estado, headers: cabeceras }
    )
  }
  if (sesion.rol !== 'DIRECTOR' && sesion.rol !== 'PADRE') return noEncontrado()

  const supabase = await createServerSupabaseClient()
  const { data: fila, error } = await supabase
    .from('comprobantes_pago')
    .select('ruta_archivo')
    .eq('id', comprobanteId.toLowerCase())
    .maybeSingle()
  if (error || !fila) return noEncontrado()

  const firmada = await supabase.storage
    .from(BUCKET_FINAL)
    .createSignedUrl(fila.ruta_archivo, SEGUNDOS_DE_VIGENCIA)
  if (firmada.error || !firmada.data?.signedUrl) return noEncontrado()

  return NextResponse.redirect(firmada.data.signedUrl, { status: 302, headers: cabeceras })
}

export const POST = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
