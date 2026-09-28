import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { establecerRecorridoTransporteSchema, primerErrorTransporte } from '@/lib/validations'
import { requerirRol } from '@/services/autorizacion'
import { establecerRecorridoTransporte } from '@/services/transporte.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo un estudiante puede inscribirse o cambiar de recorrido de transporte.'

/**
 * Alta o cambio del recorrido de transporte del alumno de la sesión (EPT-60).
 *
 * Autoriza antes de leer el cuerpo para no revelar reglas de validación a una
 * petición que no tiene acceso al recurso.
 *
 * El cuerpo solo declara QUÉ recorrido se solicita. El alumno se deriva de
 * `auth.uid()` en PostgreSQL, así que esta ruta no tiene ningún parámetro con
 * el que suplantar a otra persona; `.strict()` además rechaza el intento de
 * agregarlo. La misma operación sirve para inscribirse por primera vez y para
 * cambiar de recorrido: PostgreSQL decide cuál de las dos es, de forma
 * atómica e idempotente si el recorrido pedido ya es el activo.
 *
 * No se define DELETE: la baja es lógica y viaja por PATCH sobre el
 * identificador de la inscripción; Next.js responde 405 a cualquier otro
 * método no declarado.
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

  const parsed = establecerRecorridoTransporteSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorTransporte(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo },
      { status: 400 }
    )
  }

  const resultado = await establecerRecorridoTransporte(parsed.data.servicio_id)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/transporte')

  return NextResponse.json(
    { ok: true, inscripcion: resultado.datos },
    { status: 201 }
  )
}
