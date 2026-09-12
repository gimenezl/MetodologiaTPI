import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  actualizarNivelSchema,
  nivelEducativoIdSchema,
  primerErrorNivel,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import {
  cambiarEstadoNivel,
  renombrarNivel,
} from '@/services/niveles.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo el director puede administrar los niveles educativos.'

/**
 * Renombrado o cambio de estado, expresados mediante un contrato discriminado.
 * En Next.js 16 los parámetros dinámicos son una promesa.
 *
 * No se define DELETE: la única baja admitida es lógica y viaja por PATCH.
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
  const idParsed = nivelEducativoIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Identificador de nivel inválido' },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarNivelSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorNivel(parsed.error)
    return NextResponse.json(
      {
        error: issue.mensaje,
        campo: issue.campo,
      },
      { status: 400 }
    )
  }

  const resultado =
    parsed.data.accion === 'renombrar'
      ? await renombrarNivel(idParsed.data, parsed.data.nombre)
      : await cambiarEstadoNivel(idParsed.data, parsed.data.activo)

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/niveles')

  return NextResponse.json({ ok: true, nivel: resultado.datos })
}
