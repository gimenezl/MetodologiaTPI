import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { crearNivelSchema, primerErrorNivel } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { crearNivel } from '@/services/niveles.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo el director puede administrar los niveles educativos.'

/**
 * Alta de niveles educativos. Autoriza antes de leer el cuerpo para no revelar
 * reglas de validación a una petición que no tiene acceso al recurso.
 *
 * No se define DELETE: Next.js responde 405 Method Not Allowed.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json(
      { error: autorizacion.mensaje },
      { status: autorizacion.estado }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = crearNivelSchema.safeParse(body)
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

  const resultado = await crearNivel(parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/niveles')

  return NextResponse.json({ ok: true, nivel: resultado.datos }, { status: 201 })
}
