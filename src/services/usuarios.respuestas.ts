import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { CATALOGO_DE_ERRORES, type CodigoDeError } from '@/lib/errores'
import type { ResultadoAutorizacion } from '@/services/autorizacion'

/**
 * Respuestas HTTP de la API de Usuarios (EPT-59).
 *
 * Mismo contrato que el alta de `/api/usuarios`: un error es
 * `{ error: <mensaje en español>, codigo: <código de dominio>, campo?, ... }`,
 * que `errorDesdeRespuesta` (src/lib/errores.ts) sabe reconstruir. Toda
 * respuesta, de éxito o de error, lleva `Cache-Control: no-store`: son datos
 * personales y estados que cambian con cada operación.
 *
 * Solo servidor.
 */

export const SIN_CACHE = { 'Cache-Control': 'no-store' } as const

/** Fallo de una operación, ya expresado en el catálogo de dominio. */
export type Fallo = {
  ok: false
  codigo: CodigoDeError
  /** Reemplaza el estado HTTP del catálogo cuando el contexto lo exige. */
  estado?: number
  mensaje?: string
  campo?: string
  /** Datos adicionales seguros (por ejemplo, `intentos_restantes`). */
  extra?: Record<string, unknown>
}

export type Resultado<T> = { ok: true; datos: T; estado?: number } | Fallo

export function fallo(codigo: CodigoDeError, opciones: Omit<Fallo, 'ok' | 'codigo'> = {}): Fallo {
  return { ok: false, codigo, ...opciones }
}

export function responderDatos(datos: unknown, estado = 200) {
  return NextResponse.json(datos, { status: estado, headers: SIN_CACHE })
}

export function responderError(
  codigo: CodigoDeError,
  opciones: Omit<Fallo, 'ok' | 'codigo'> = {}
) {
  const entrada = CATALOGO_DE_ERRORES[codigo]
  return NextResponse.json(
    {
      ...(opciones.extra ?? {}),
      error: opciones.mensaje ?? entrada.mensaje,
      codigo,
      ...(opciones.campo ? { campo: opciones.campo } : {}),
    },
    { status: opciones.estado ?? entrada.estado, headers: SIN_CACHE }
  )
}

export function responderResultado<T>(resultado: Resultado<T>) {
  if (resultado.ok) return responderDatos(resultado.datos, resultado.estado ?? 200)
  const { codigo, ...opciones } = resultado
  return responderError(codigo, opciones)
}

/** Convierte la denegación de una guarda en la respuesta de dominio. */
export function responderDenegacion(
  denegacion: Extract<ResultadoAutorizacion, { autorizado: false }>
) {
  if (denegacion.estado === 401) return responderError('NO_AUTENTICADO')
  if (denegacion.codigo === 'ACCESO_BLOQUEADO') return responderError('ACCESO_BLOQUEADO')
  if (denegacion.estado === 403) return responderError('SIN_PERMISO', { mensaje: denegacion.mensaje })
  return responderError('SERVICIO_NO_DISPONIBLE')
}

/** Lee el cuerpo JSON; `undefined` si no es JSON. */
export async function leerJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/** Mensaje para cualquier dato que el esquema no describa con un mensaje propio. */
const MENSAJE_DATO_INVALIDO = 'Revisá los datos ingresados.'

/**
 * Valida con Zod y traduce el primer problema a un fallo 422.
 *
 * Los mensajes por defecto de Zod están en inglés: cada campo declara el suyo y
 * lo imprevisto recibe el respaldo. Un campo desconocido se rechaza con un
 * mensaje propio, sin nombrarlo. Un motivo inválido tiene su código.
 */
export function validar<S extends z.ZodType>(
  esquema: S,
  valor: unknown
): { ok: true; datos: z.output<S> } | Fallo {
  if (valor === undefined) return fallo('CUERPO_INVALIDO')
  const analisis = esquema.safeParse(valor, { error: () => MENSAJE_DATO_INVALIDO })
  if (analisis.success) return { ok: true, datos: analisis.data }

  const problema = analisis.error.issues[0]
  const campo = typeof problema?.path[0] === 'string' ? problema.path[0] : undefined
  if (problema?.code === 'unrecognized_keys') {
    return fallo('DATOS_INVALIDOS', { estado: 422, mensaje: 'La solicitud contiene campos no permitidos.' })
  }
  if (campo === 'motivo') return fallo('MOTIVO_INVALIDO', { campo })
  return fallo('DATOS_INVALIDOS', {
    estado: 422,
    mensaje: problema?.message || MENSAJE_DATO_INVALIDO,
    campo,
  })
}
