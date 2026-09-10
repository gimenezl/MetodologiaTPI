import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requerirDirector } from '@/services/autorizacion'
import { actualizarCurso } from '@/services/cursos.service'
import { actualizarCursoSchema, cursoIdSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

/**
 * Modificación e inactivación lógica de un curso (EPT-15 / EPT-17).
 *
 * `PATCH` cubre las dos operaciones: cambiar denominación, división o nivel, y
 * cambiar `activo`. No se define `DELETE`, por lo que Next responde
 * 405 Method Not Allowed ante cualquier intento de borrado físico.
 *
 * En Next.js 16 `params` es una promesa y debe esperarse.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Exigir sesión válida con rol DIRECTOR, antes de leer o escribir datos.
  const autorizacion = await requerirDirector()
  if (!autorizacion.autorizado) {
    return NextResponse.json(
      { error: autorizacion.mensaje },
      { status: autorizacion.estado }
    )
  }

  // 2. Validar el identificador de la ruta.
  const { id } = await params
  const idParsed = cursoIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Identificador de curso inválido' }, { status: 400 })
  }

  // 3. Validar el cuerpo.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarCursoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue?.message ?? 'Datos inválidos',
        campo: issue?.path?.[0] ?? undefined,
      },
      { status: 400 }
    )
  }

  // 4. Persistir. `actualizarCurso` exige que la base devuelva la fila, así que
  //    un UPDATE filtrado por RLS no puede informarse como éxito.
  const resultado = await actualizarCurso(idParsed.data, parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/cursos')

  return NextResponse.json({ ok: true, curso: resultado.datos })
}
