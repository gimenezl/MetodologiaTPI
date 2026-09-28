import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import {
  actualizarDeporteSchema,
  deporteIdSchema,
  primerErrorDeportes,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { cambiarEstadoDeporte, renombrarDeporte } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede administrar el catálogo de deportes.'
const PERMITIDOS = ['PATCH'] as const

/**
 * Renombrado o cambio de estado de un deporte, con un contrato discriminado por
 * `accion` (EPT-61). En Next.js 16 los parámetros dinámicos llegan como una
 * promesa.
 *
 * Códigos: 400 cuerpo o identificador malformado; 404 deporte inexistente; 409
 * nombre repetido, renombrado no permitido con grupos (solo mayúsculas y
 * minúsculas) o inactivación con grupos activos.
 *
 * No se define DELETE: la única baja admitida es lógica y viaja por PATCH. Un
 * DELETE recibe 405 con la cabecera `Allow`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id } = await params
  const idParsed = deporteIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Identificador de deporte inválido' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarDeporteSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado =
    parsed.data.accion === 'renombrar'
      ? await renombrarDeporte(idParsed.data, parsed.data.nombre)
      : await cambiarEstadoDeporte(idParsed.data, parsed.data.activo)

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, deporte: resultado.datos })
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const POST = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
