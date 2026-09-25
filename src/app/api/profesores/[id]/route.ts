import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { actualizarProfesorSchema, primerErrorProfesor, profesorIdSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import {
  actualizarFichaProfesor,
  cambiarEstadoProfesor,
  obtenerDetalleProfesor,
  type RechazoProfesor,
} from '@/services/profesores.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede administrar las fichas de profesores.'

function rechazo({ estado, mensaje, campo, bloqueos }: RechazoProfesor) {
  return NextResponse.json(
    { error: mensaje, ...(campo ? { campo } : {}), ...(bloqueos ? { bloqueos } : {}) },
    { status: estado }
  )
}

/**
 * Ficha, relaciones, horarios e historial de un profesor. Solo la dirección:
 * un docente consulta lo suyo por `/api/mis-asignaciones`, que no recibe
 * identificador. Se autoriza antes de mirar el parámetro.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id } = await params
  const idParsed = profesorIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Identificador de profesor inválido' }, { status: 400 })
  }

  const resultado = await obtenerDetalleProfesor(idParsed.data)
  if (!resultado.ok) return rechazo(resultado)

  return NextResponse.json(
    { detalle: resultado.datos },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

/**
 * Completar la ficha o cambiar el estado, con un contrato discriminado. La
 * base vuelve a validar la sesión, el rol DIRECTOR, el legajo, la especialidad
 * y las reglas de inactivación y reactivación.
 *
 * No se define DELETE ni PUT: Next.js responde 405.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id } = await params
  const idParsed = profesorIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Identificador de profesor inválido' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarProfesorSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorProfesor(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado =
    parsed.data.accion === 'actualizar_ficha'
      ? await actualizarFichaProfesor(idParsed.data, parsed.data.legajo_nro, parsed.data.especialidad)
      : await cambiarEstadoProfesor(idParsed.data, parsed.data.estado, parsed.data.motivo)

  if (!resultado.ok) return rechazo(resultado)

  revalidatePath('/dashboard/profesores')

  return NextResponse.json({ ok: true, ficha: resultado.datos })
}
