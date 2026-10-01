import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { CATALOGO_ACCESOS, cuerpoDeError, type CodigoAcceso } from '@/lib/accesos-qr/errores'
import type { ResultadoAutorizacion } from '@/services/autorizacion'

/**
 * Respuestas HTTP de la API de accesos con QR (EPT-65).
 *
 * Toda respuesta, de éxito o de error, lleva `Cache-Control: no-store`: son
 * datos de personas y estados que cambian con cada escaneo. Un error es siempre
 * `{ error: <mensaje en español>, codigo }`, sin detalle técnico, sin
 * identificadores internos y sin el motivo de una denegación. Un 429 agrega
 * `Retry-After` y `reintentar_en_segundos`.
 *
 * Solo servidor.
 */

export const SIN_CACHE = { 'Cache-Control': 'no-store' } as const

/** Tope del cuerpo de cualquier petición de esta API, en bytes. */
export const MAXIMO_BYTES_CUERPO = 2048

export function responderDatos(datos: unknown, estado = 200) {
  return NextResponse.json(datos, { status: estado, headers: SIN_CACHE })
}

export function responderError(codigo: CodigoAcceso, reintentarEnSegundos?: number) {
  const estado = CATALOGO_ACCESOS[codigo].estado
  if (estado === 429) {
    const segundos = Math.max(1, Math.ceil(reintentarEnSegundos ?? 60))
    return NextResponse.json(
      { ...cuerpoDeError(codigo), reintentar_en_segundos: segundos },
      { status: estado, headers: { ...SIN_CACHE, 'Retry-After': String(segundos) } }
    )
  }
  return NextResponse.json(cuerpoDeError(codigo), { status: estado, headers: SIN_CACHE })
}

/** Convierte la denegación de una guarda en la respuesta de dominio. */
export function responderDenegacion(
  denegacion: Extract<ResultadoAutorizacion, { autorizado: false }>
) {
  if (denegacion.estado === 401) return responderError('NO_AUTENTICADO')
  if (denegacion.codigo === 'ACCESO_BLOQUEADO') return responderError('ACCESO_BLOQUEADO')
  if (denegacion.estado === 403) return responderError('SIN_PERMISO')
  return responderError('SERVICIO_NO_DISPONIBLE')
}

export type CuerpoLeido = { ok: true; datos: unknown } | { ok: false; codigo: CodigoAcceso }

/**
 * Lee el cuerpo JSON con un tope de tamaño. No se confía en `Content-Length`
 * (puede faltar o mentir): se lee el texto y se mide. Exige `application/json`.
 */
export async function leerCuerpoJson(request: Request): Promise<CuerpoLeido> {
  const tipo = request.headers.get('content-type') ?? ''
  if (!/^application\/json\b/i.test(tipo)) return { ok: false, codigo: 'CUERPO_INVALIDO' }

  const declarado = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declarado) && declarado > MAXIMO_BYTES_CUERPO) {
    return { ok: false, codigo: 'CUERPO_DEMASIADO_GRANDE' }
  }
  let texto: string
  try {
    texto = await request.text()
  } catch {
    return { ok: false, codigo: 'CUERPO_INVALIDO' }
  }
  if (Buffer.byteLength(texto, 'utf8') > MAXIMO_BYTES_CUERPO) {
    return { ok: false, codigo: 'CUERPO_DEMASIADO_GRANDE' }
  }
  try {
    return { ok: true, datos: JSON.parse(texto) as unknown }
  } catch {
    return { ok: false, codigo: 'CUERPO_INVALIDO' }
  }
}

/** Valida con Zod. El primer problema se traduce a un código del catálogo. */
export function validar<S extends z.ZodType>(
  esquema: S,
  valor: unknown,
  codigoPorDefecto: CodigoAcceso = 'CUERPO_INVALIDO'
): { ok: true; datos: z.output<S> } | { ok: false; codigo: CodigoAcceso } {
  const analisis = esquema.safeParse(valor)
  if (analisis.success) return { ok: true, datos: analisis.data }
  const campo = analisis.error.issues[0]?.path[0]
  if (campo === 'motivo') return { ok: false, codigo: 'MOTIVO_INVALIDO' }
  if (campo === 'servicio_id' || campo === 'sentido') return { ok: false, codigo: 'SERVICIO_INVALIDO' }
  return { ok: false, codigo: codigoPorDefecto }
}
