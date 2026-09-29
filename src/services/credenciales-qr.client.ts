import type { CodigoCredencial } from '@/lib/credenciales-qr/errores'

/**
 * Cliente del navegador para las operaciones de Dirección sobre la credencial QR
 * (EPT-64). Las importaciones son solo de tipos: no arrastran `next/headers`.
 *
 * Nunca lanza: devuelve un resultado tipado con el mensaje ya en español. El
 * alumno destinatario viaja como parte de la URL y la credencial como
 * identificador; el rol y el actor NO viajan: los deriva el servidor de la sesión.
 */

export type ResultadoRemotoCredencial =
  | { ok: true; credencialId: string }
  | {
      ok: false
      /** Estado HTTP, o `0` si la petición no llegó a completarse. */
      estado: number
      mensaje: string
      codigo?: CodigoCredencial
    }

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentarlo.'
const MENSAJE_SIN_CONEXION =
  'No pudimos comunicarnos con el servidor. Revisá tu conexión y volvé a intentarlo.'
const TIEMPO_MAXIMO_MS = 15_000

async function enviar(url: string, cuerpo?: Record<string, string>): Promise<ResultadoRemotoCredencial> {
  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      ...(cuerpo
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }
        : {}),
    })
  } catch {
    return { ok: false, estado: 0, mensaje: MENSAJE_SIN_CONEXION }
  }

  const contenido = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>

  if (!respuesta.ok) {
    return {
      ok: false,
      estado: respuesta.status,
      mensaje: typeof contenido.error === 'string' ? contenido.error : MENSAJE_GENERICO,
      codigo: typeof contenido.codigo === 'string' ? (contenido.codigo as CodigoCredencial) : undefined,
    }
  }

  const credencial = contenido.credencial as { id?: unknown } | undefined
  if (typeof credencial?.id !== 'string') {
    return { ok: false, estado: respuesta.status, mensaje: MENSAJE_GENERICO }
  }
  return { ok: true, credencialId: credencial.id }
}

/** Emite la credencial del alumno. Solo ocurre por un clic explícito de Dirección. */
export function emitirCredencialRemota(alumnoId: string) {
  return enviar(`/api/credenciales-qr/${encodeURIComponent(alumnoId)}`)
}

/** Repone: revoca la credencial indicada y emite otra. */
export function reponerCredencialRemota(credencialId: string, motivo: string) {
  return enviar(`/api/credenciales-qr/credenciales/${encodeURIComponent(credencialId)}/reposicion`, { motivo })
}

/** Revoca la credencial indicada. No se puede deshacer. */
export function revocarCredencialRemota(credencialId: string, motivo: string) {
  return enviar(`/api/credenciales-qr/credenciales/${encodeURIComponent(credencialId)}/revocacion`, { motivo })
}
