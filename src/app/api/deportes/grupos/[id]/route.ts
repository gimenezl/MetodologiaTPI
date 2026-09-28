import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import {
  actualizarGrupoDeportivoSchema,
  grupoDeportivoIdSchema,
  primerErrorDeportes,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import {
  cambiarEstadoGrupoDeportivo,
  editarGrupoDeportivo,
} from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede administrar los grupos deportivos.'
const PERMITIDOS = ['PATCH'] as const

/**
 * Edición o cambio de estado de un grupo deportivo, con un contrato discriminado
 * por `accion` (EPT-61). En Next.js 16 los parámetros dinámicos llegan como una
 * promesa.
 *
 * `editar` reemplaza nombre, cupo y profesor; el deporte y el nivel NO se
 * aceptan (son la identidad del grupo y `.strict()` rechaza el intento).
 * `cambiar_estado` da de baja o reactiva sin tocar inscripciones ni franjas.
 *
 * Códigos: 400 cuerpo o identificador malformado; 404 grupo, profesor o deporte
 * inexistente; 409 nombre repetido, cupo por debajo de la ocupación, profesor
 * inactivo o sin rol DOCENTE, inactivación con inscripciones activas o
 * reactivación con deporte, nivel o profesor inactivos.
 *
 * Este segmento dinámico convive con `grupos/[id]/horarios`, que ya existía:
 * son rutas distintas. No se define DELETE (405 con `Allow`).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  const { id } = await params
  const idParsed = grupoDeportivoIdSchema.safeParse(id)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Identificador de grupo inválido' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = actualizarGrupoDeportivoSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado =
    parsed.data.accion === 'editar'
      ? await editarGrupoDeportivo(idParsed.data, {
          nombre: parsed.data.nombre,
          cupo: parsed.data.cupo,
          profesor_id: parsed.data.profesor_id,
        })
      : await cambiarEstadoGrupoDeportivo(idParsed.data, parsed.data.activo)

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, grupo: resultado.datos })
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const POST = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
