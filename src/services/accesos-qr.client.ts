import { esResultadoEscaneo, MENSAJES_RESULTADO, type CodigoAcceso } from '@/lib/accesos-qr/errores'
import type {
  RespuestaEscaneo,
  ResultadoRemotoRegistro,
  Sentido,
} from '@/lib/accesos-qr/tipos'

/**
 * Cliente del navegador para el registro de accesos con QR (EPT-65). Las
 * importaciones son solo de tipos y constantes: no arrastran `next/headers`.
 *
 * Nunca lanza: devuelve un resultado tipado con el mensaje ya en español.
 *
 * Reintento: cada escaneo genera UN `intento_id` (UUID) en la pantalla. Un
 * timeout o un corte de red NO significan «no se registró»: el servidor pudo
 * haber confirmado. Por eso el reintento reutiliza el MISMO intento y el mismo
 * payload: la base devuelve el resultado ya guardado en lugar de duplicarlo. Un
 * error de red nunca se convierte en un escaneo nuevo en silencio.
 *
 * El payload viaja solo en el cuerpo, jamás en la URL, y no se guarda en
 * ningún almacenamiento del navegador.
 */

const MENSAJE_SIN_CONEXION =
  'No pudimos comunicarnos con el servidor. Revisá tu conexión y tocá «Reintentar»: se reutiliza el mismo intento y no se duplica.'
const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentarlo.'
const TIEMPO_MAXIMO_MS = 12_000

export type DatosRegistroRemoto = {
  payload: string
  intentoId: string
  servicioId: string
  sentido?: Sentido
}

/** Estados en los que reenviar el MISMO intento es seguro y esperable. */
function esReintentable(estado: number): boolean {
  return estado === 0 || estado === 502 || estado === 503 || estado === 504
}

export async function registrarAccesoRemoto(datos: DatosRegistroRemoto): Promise<ResultadoRemotoRegistro> {
  let respuesta: Response
  try {
    respuesta = await fetch('/api/accesos-servicios/registro', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      body: JSON.stringify({
        payload: datos.payload,
        intento_id: datos.intentoId,
        servicio_id: datos.servicioId,
        ...(datos.sentido ? { sentido: datos.sentido } : {}),
      }),
    })
  } catch {
    return { ok: false, estado: 0, mensaje: MENSAJE_SIN_CONEXION, reintentable: true }
  }

  const contenido = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>

  if (!respuesta.ok) {
    const retryAfter = Number(respuesta.headers.get('retry-after') ?? '')
    return {
      ok: false,
      estado: respuesta.status,
      mensaje: typeof contenido.error === 'string' ? contenido.error : MENSAJE_GENERICO,
      codigo: typeof contenido.codigo === 'string' ? (contenido.codigo as CodigoAcceso) : undefined,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { reintentarEnSegundos: retryAfter } : {}),
      reintentable: esReintentable(respuesta.status),
    }
  }

  // Una respuesta 200 fuera del conjunto cerrado jamás se muestra como aprobación.
  if (!esResultadoEscaneo(contenido.codigo)) {
    return { ok: false, estado: respuesta.status, mensaje: MENSAJE_GENERICO, reintentable: false }
  }

  const alumno = contenido.alumno as { nombre?: unknown; apellido?: unknown; legajo?: unknown } | undefined
  const normalizada: RespuestaEscaneo = {
    codigo: contenido.codigo,
    mensaje: typeof contenido.mensaje === 'string' ? contenido.mensaje : MENSAJES_RESULTADO[contenido.codigo],
  }
  if (contenido.codigo === 'REGISTRADO') {
    if (typeof alumno?.nombre !== 'string' || typeof alumno.apellido !== 'string') {
      return { ok: false, estado: respuesta.status, mensaje: MENSAJE_GENERICO, reintentable: false }
    }
    normalizada.alumno = {
      nombre: alumno.nombre,
      apellido: alumno.apellido,
      legajo: typeof alumno.legajo === 'string' ? alumno.legajo : null,
    }
    if (typeof contenido.registrado_en === 'string') normalizada.registrado_en = contenido.registrado_en
  }
  return { ok: true, respuesta: normalizada }
}

export type ResultadoRemotoAnulacion =
  | { ok: true }
  | { ok: false; estado: number; mensaje: string; codigo?: CodigoAcceso }

/** Anula un acceso registrado (solo Dirección). */
export async function anularAccesoRemoto(accesoId: string, motivo: string): Promise<ResultadoRemotoAnulacion> {
  let respuesta: Response
  try {
    respuesta = await fetch(`/api/accesos-servicios/${encodeURIComponent(accesoId)}/anulacion`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ motivo }),
    })
  } catch {
    return { ok: false, estado: 0, mensaje: 'No pudimos comunicarnos con el servidor. Revisá tu conexión y volvé a intentarlo.' }
  }
  if (respuesta.ok) return { ok: true }
  const contenido = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>
  return {
    ok: false,
    estado: respuesta.status,
    mensaje: typeof contenido.error === 'string' ? contenido.error : MENSAJE_GENERICO,
    codigo: typeof contenido.codigo === 'string' ? (contenido.codigo as CodigoAcceso) : undefined,
  }
}
