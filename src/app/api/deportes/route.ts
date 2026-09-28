import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { crearDeporteSchema, primerErrorDeportes } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import { crearDeporte } from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede administrar el catálogo de deportes.'
const PERMITIDOS = ['POST'] as const

/**
 * Alta de un deporte en el catálogo por la dirección (EPT-61).
 *
 * Solo transporta el nombre: el profesor responsable es obligatorio por GRUPO,
 * no por deporte. El rol se verifica acá y otra vez en PostgreSQL; la unicidad
 * del nombre la decide el índice de la base, así que dos altas simultáneas del
 * mismo nombre confirman una y rechazan la otra con 409.
 *
 * Solo existe POST: no hay ruta de borrado. Cualquier otro método recibe 405 con
 * la cabecera `Allow`.
 */
export async function POST(request: Request) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.mensaje }, { status: autorizacion.estado })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = crearDeporteSchema.safeParse(body)
  if (!parsed.success) {
    const issue = primerErrorDeportes(parsed.error)
    return NextResponse.json({ error: issue.mensaje, campo: issue.campo }, { status: 400 })
  }

  const resultado = await crearDeporte(parsed.data.nombre)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo },
      { status: resultado.estado }
    )
  }

  revalidatePath('/dashboard/deportes')

  return NextResponse.json({ ok: true, deporte: resultado.datos }, { status: 201 })
}

export const GET = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
