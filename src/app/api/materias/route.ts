import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { crearMateriaSchema, primerErrorMateria } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { crearMateria } from '@/services/materias.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo el director puede administrar las materias.'

/**
 * Alta de materias. Autoriza antes de leer el cuerpo para no revelar reglas de
 * validación a una petición que no tiene acceso al recurso.
 *
 * No se define DELETE: la baja es lógica y Next.js responde 405 Method Not
 * Allowed a cualquier método no declarado.
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

  const parsed = crearMateriaSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorMateria(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado = await crearMateria(parsed.data.nombre)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/materias')

  return NextResponse.json({ ok: true, materia: resultado.datos }, { status: 201 })
}
