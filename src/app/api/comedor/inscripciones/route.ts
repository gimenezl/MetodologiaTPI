import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { inscribirEnServicioSchema, primerErrorComedor } from '@/lib/validations'
import { requerirRol } from '@/services/autorizacion'
import { inscribirEnServicio } from '@/services/comedor.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo un estudiante puede inscribirse al comedor desde esta pantalla.'

/**
 * Alta de la inscripción al comedor del alumno de la sesión (EPT-27).
 *
 * Autoriza antes de leer el cuerpo para no revelar reglas de validación a una
 * petición que no tiene acceso al recurso.
 *
 * El cuerpo solo declara QUÉ servicio se solicita. El alumno, su perfil y su
 * legajo se derivan de `auth.uid()` en PostgreSQL, así que esta ruta no tiene
 * ningún parámetro con el que suplantar a otra persona; `.strict()` además
 * rechaza el intento de agregarlo.
 *
 * No se define DELETE: la baja es lógica y Next.js responde 405 Method Not
 * Allowed a cualquier método no declarado.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirRol('ESTUDIANTE', MENSAJE_NO_AUTORIZADO)
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

  const parsed = inscribirEnServicioSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorComedor(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado = await inscribirEnServicio(parsed.data.servicio_id)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/comedor')

  return NextResponse.json(
    { ok: true, inscripcion: resultado.datos },
    { status: 201 }
  )
}
