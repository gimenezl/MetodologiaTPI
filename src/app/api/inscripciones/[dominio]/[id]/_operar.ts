import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  operacionInscripcionParamsSchema,
  primerErrorInscripciones,
  type DominioInscripcion,
} from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import type { ResultadoInscripciones } from '@/services/inscripciones-administracion.service'
import { SIN_CACHE } from '@/services/usuarios.respuestas'

/**
 * Núcleo común de las dos rutas de administración de inscripciones (EPT-62).
 * Este archivo no es una ruta: solo `route.ts` lo es.
 *
 * Orden fijo, el mismo en las dos: Dirección (sesión + rol + bloqueo) → validar
 * los parámetros de la URL → operar → revalidar. La autorización va primero a
 * propósito: quien no es Dirección no puede averiguar, por el tipo de error,
 * qué dominios o identificadores son válidos.
 *
 * El cuerpo de la petición nunca se lee: el alumno, el rol y el actor no vienen
 * de ahí. Solo deciden el dominio y el identificador de la URL, y la identidad
 * de quien opera la deriva PostgreSQL de `auth.uid()`.
 */

const MENSAJE_NO_AUTORIZADO = 'Solo Dirección puede administrar las inscripciones.'

/** Pantalla que muestra cada dominio y que hay que refrescar tras un cambio. */
const PANTALLA_POR_DOMINIO: Record<DominioInscripcion, string> = {
  matriculas: '/dashboard/alumnos',
  deportes: '/dashboard/deportes',
  comedor: '/dashboard/comedor',
  transporte: '/dashboard/transporte',
}

export type ParametrosRuta = { params: Promise<{ dominio: string; id: string }> }

export async function operarInscripcion<T>(
  { params }: ParametrosRuta,
  operacion: (dominio: DominioInscripcion, id: string) => Promise<ResultadoInscripciones<T>>,
  proyectar: (datos: T) => Record<string, unknown>
) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return NextResponse.json(
      { error: autorizacion.mensaje, codigo: autorizacion.codigo },
      { status: autorizacion.estado, headers: SIN_CACHE }
    )
  }

  const parsed = operacionInscripcionParamsSchema.safeParse(await params)
  if (!parsed.success) {
    const issue = primerErrorInscripciones(parsed.error)
    return NextResponse.json(
      { error: issue.mensaje, campo: issue.campo, codigo: 'DATOS_INVALIDOS' },
      { status: 400, headers: SIN_CACHE }
    )
  }

  const { dominio, id } = parsed.data
  const resultado = await operacion(dominio, id)
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje, campo: resultado.campo, codigo: resultado.codigo },
      { status: resultado.estado, headers: SIN_CACHE }
    )
  }

  revalidatePath(PANTALLA_POR_DOMINIO[dominio])

  return NextResponse.json({ ok: true, ...proyectar(resultado.datos) }, { headers: SIN_CACHE })
}
