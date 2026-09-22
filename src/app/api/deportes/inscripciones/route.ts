import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { inscribirEnGrupoDeportivoSchema, primerErrorDeportes } from '@/lib/validations'
import { requerirRol } from '@/services/autorizacion'
import { inscribirEnGrupoDeportivo } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo un estudiante puede inscribirse a un deporte.'

/**
 * Alta de la inscripción deportiva del alumno de la sesión (EPT-34).
 *
 * Autoriza antes de leer el cuerpo para no revelar reglas de validación a una
 * petición sin acceso al recurso. El cuerpo solo declara QUÉ grupo se
 * solicita; `.strict()` rechaza cualquier intento de enviar alumno, nivel, cupo
 * o estado. PostgreSQL deriva la identidad, el nivel y la disponibilidad, y
 * aplica el límite de dos deportes con alumno y grupo bloqueados.
 *
 * No se define DELETE: Next.js responde 405 a cualquier método no declarado.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirRol('ESTUDIANTE', MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = inscribirEnGrupoDeportivoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado = await inscribirEnGrupoDeportivo(parsed.data.grupo_id)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, inscripcion: resultado.datos }, { status: 201 })
}
