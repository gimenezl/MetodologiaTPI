import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requerirDirector } from '@/services/autorizacion'
import { crearCurso } from '@/services/cursos.service'
import { crearCursoSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

/**
 * Alta de cursos (EPT-15 / EPT-17).
 *
 * `src/proxy.ts` no cubre `/api/**`: su matcher es `['/dashboard/:path*', '/login']`.
 * Además, aunque lo cubriera, solo refresca la sesión y no verifica roles. Por eso
 * este handler autoriza por su cuenta antes de tocar la base.
 *
 * No existe `DELETE` en este archivo ni en `[id]/route.ts`: la baja de un curso es
 * lógica. Un `DELETE` a esta ruta responde 405 Method Not Allowed.
 */
export async function POST(request: Request) {
  // 1. Exigir sesión válida con rol DIRECTOR, antes de leer o escribir datos.
  const autorizacion = await requerirDirector()
  if (!autorizacion.autorizado) {
    return NextResponse.json(
      { error: autorizacion.mensaje },
      { status: autorizacion.estado }
    )
  }

  // 2. Validar el cuerpo.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = crearCursoSchema.safeParse(body)
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

  // 3. Persistir. La unicidad y los permisos se confirman en PostgreSQL.
  const resultado = await crearCurso(parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  // Invalida la entrada de caché de la ruta para cualquier cliente, no solo para
  // el que envió el formulario.
  revalidatePath('/dashboard/cursos')

  return NextResponse.json({ ok: true, curso: resultado.datos }, { status: 201 })
}
