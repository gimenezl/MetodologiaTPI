import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  fechaAsistenciaSchema,
  primerErrorAsistencia,
  registroAsistenciaSchema,
} from '@/lib/asistencias'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { requerirSesionConRol } from '@/services/autorizacion'
import {
  obtenerPanelDeAsistencias,
  registrarAsistenciaDeSesion,
} from '@/services/asistencias.service'

export const dynamic = 'force-dynamic'

// Datos de menores: ninguna respuesta (ni de error) puede quedar en cachés.
const SIN_CACHE = { 'Cache-Control': 'no-store' } as const
const MENSAJE_NO_AUTORIZADO = 'Solo la dirección o un docente pueden gestionar asistencias.'
const PERMITIDOS = ['GET', 'POST'] as const

/** Dirección o DOCENTE habilitados. El rol lo resuelve la base; un bloqueado recibe 403. */
async function autorizar() {
  const sesion = await requerirSesionConRol()
  if (!sesion.autorizado) {
    return {
      denegada: NextResponse.json(
        { error: sesion.mensaje, codigo: sesion.codigo ?? (sesion.estado === 401 ? 'NO_AUTENTICADO' : 'SIN_PERMISO') },
        { status: sesion.estado, headers: SIN_CACHE }
      ),
    }
  }
  if (sesion.rol !== 'DIRECTOR' && sesion.rol !== 'DOCENTE') {
    return {
      denegada: NextResponse.json(
        { error: MENSAJE_NO_AUTORIZADO, codigo: 'SIN_PERMISO' },
        { status: 403, headers: SIN_CACHE }
      ),
    }
  }
  return { denegada: null }
}

/**
 * Panel de asistencias de una fecha: los alumnos que la sesión puede gestionar,
 * las asistencias del día y el historial para el porcentaje.
 *
 * Autoriza antes de leer la consulta. Un DOCENTE recibe solo a sus alumnos con
 * vínculo vigente (lo decide PostgreSQL con RLS, no este archivo); Dirección
 * recibe a todos. Estudiantes y padres consultan lo propio por RLS directa y no
 * usan esta ruta.
 */
export async function GET(request: Request) {
  const { denegada } = await autorizar()
  if (denegada) return denegada

  const fecha = fechaAsistenciaSchema.safeParse(new URL(request.url).searchParams.get('fecha'))
  if (!fecha.success) {
    return NextResponse.json(
      { error: 'Indicá una fecha válida.', campo: 'fecha', codigo: 'DATOS_INVALIDOS' },
      { status: 400, headers: SIN_CACHE }
    )
  }

  const resultado = await obtenerPanelDeAsistencias(fecha.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, codigo: resultado.codigo },
      { status: resultado.estado, headers: SIN_CACHE }
    )
  }
  return NextResponse.json(resultado.datos, { headers: SIN_CACHE })
}

/**
 * Registra o corrige el estado de la asistencia de un alumno y un día.
 *
 * Autoriza antes de leer el cuerpo. El cuerpo solo declara alumno, fecha y
 * estado; `.strict()` rechaza cualquier intento de enviar `docente_id` u otra
 * identidad: el registrante lo deriva PostgreSQL de `auth.uid()`. Si el alumno
 * no tiene un vínculo vigente con el docente (o ya lo perdió) la base responde
 * P6610 y esta ruta, 404: nunca un éxito optimista.
 *
 * Códigos: 201 creada; 200 actualizada o sin cambios; 400 cuerpo inválido; 401 sin
 * sesión; 403 rol sin competencia o acceso bloqueado; 404 alumno no disponible;
 * 409 conflicto concurrente; 500 error interno.
 */
export async function POST(request: Request) {
  const { denegada } = await autorizar()
  if (denegada) return denegada

  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'La solicitud no tiene un formato válido.', codigo: 'DATOS_INVALIDOS' },
      { status: 400, headers: SIN_CACHE }
    )
  }

  const parsed = registroAsistenciaSchema.safeParse(cuerpo)
  if (!parsed.success) {
    const problema = primerErrorAsistencia(parsed.error)
    return NextResponse.json(
      { error: problema.mensaje, campo: problema.campo, codigo: 'DATOS_INVALIDOS' },
      { status: 400, headers: SIN_CACHE }
    )
  }

  const resultado = await registrarAsistenciaDeSesion(parsed.data)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, codigo: resultado.codigo },
      { status: resultado.estado, headers: SIN_CACHE }
    )
  }

  revalidatePath('/dashboard/asistencias')

  return NextResponse.json(
    { ok: true, asistencia: resultado.datos },
    { status: resultado.datos.resultado === 'CREADA' ? 201 : 200, headers: SIN_CACHE }
  )
}

export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
