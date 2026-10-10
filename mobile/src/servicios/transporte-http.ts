// Transporte HTTP hacia los Route Handlers de Next (camino B del contrato EPT-98).
//
// - Valida la URL base una sola vez y solo emite solicitudes a ese origen.
// - Adjunta `Authorization: Bearer` con el token de la sesión del dispositivo, nunca cookies.
// - No sigue ni acepta redirecciones a otro origen: el Bearer no sale del origen configurado.
// - Cancelación, tiempo agotado y errores del servidor llegan como `ErrorTransporte`.
// - Nunca registra cabeceras, tokens ni cuerpos.
import { ErrorDeDominio, errorDesdeRespuesta } from '@/compartido/errores'

export type TipoErrorTransporte =
  | 'SIN_SESION'
  | 'CANCELADO'
  | 'TIEMPO_AGOTADO'
  | 'SIN_CONEXION'
  | 'RUTA_INVALIDA'
  | 'REDIRECCION_EXTERNA'
  | 'RESPUESTA_INVALIDA'
  | 'HTTP'

const MENSAJES: Readonly<Record<Exclude<TipoErrorTransporte, 'HTTP'>, string>> = {
  SIN_SESION: 'Necesitás iniciar sesión para continuar.',
  CANCELADO: 'La operación fue cancelada.',
  TIEMPO_AGOTADO: 'El servidor tardó demasiado en responder. Intentá nuevamente.',
  SIN_CONEXION: 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',
  RUTA_INVALIDA: 'La dirección solicitada no es válida.',
  REDIRECCION_EXTERNA: 'La respuesta no proviene del servidor esperado.',
  RESPUESTA_INVALIDA: 'La respuesta del servidor no tiene el formato esperado.',
}

export class ErrorTransporte extends Error {
  readonly tipo: TipoErrorTransporte
  readonly estado: number | null
  readonly dominio: ErrorDeDominio | null

  constructor(tipo: TipoErrorTransporte, opciones: { estado?: number; dominio?: ErrorDeDominio } = {}) {
    super(tipo === 'HTTP' ? (opciones.dominio?.message ?? MENSAJES.RESPUESTA_INVALIDA) : MENSAJES[tipo])
    this.name = 'ErrorTransporte'
    this.tipo = tipo
    this.estado = opciones.estado ?? null
    this.dominio = opciones.dominio ?? null
  }
}

export interface OpcionesTransporte {
  baseUrl: string
  /** Token de acceso de la sesión actual, o `null` si no hay sesión. */
  obtenerToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Permite `http://` solo hacia loopback (desarrollo). Nunca para hosts de red. */
  permitirHttpLocal?: boolean
}

export interface SolicitudHttp {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Se serializa como JSON. */
  cuerpo?: unknown
  consulta?: Readonly<Record<string, string | number | boolean>>
  senal?: AbortSignal
  /** Pensado para endpoints públicos: no adjunta Bearer ni exige sesión. */
  anonima?: boolean
}

export interface RespuestaHttp<T> {
  estado: number
  datos: T
}

const HOSTS_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '10.0.2.2'])

export function validarBaseUrl(baseUrl: string, permitirHttpLocal = false): URL {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new ErrorTransporte('RUTA_INVALIDA')
  }
  const esLoopback = HOSTS_LOOPBACK.has(url.hostname)
  const protocoloValido = url.protocol === 'https:' || (permitirHttpLocal && url.protocol === 'http:' && esLoopback)
  if (!protocoloValido || url.username || url.password || url.search || url.hash) {
    throw new ErrorTransporte('RUTA_INVALIDA')
  }
  return url
}

/** Une `ruta` con la base. Rechaza esquemas, `//host`, `..`, barras invertidas y caracteres de control. */
export function resolverRuta(base: URL, ruta: string, consulta?: SolicitudHttp['consulta']): URL {
  if (!ruta.startsWith('/') || ruta.startsWith('//') || /[\\\u0000-\u001f]/u.test(ruta)) {
    throw new ErrorTransporte('RUTA_INVALIDA')
  }
  const segmentos = ruta.split('?')[0]?.split('/') ?? []
  if (segmentos.some(s => s === '..' || s === '.' || /%2e/iu.test(s) || /%2f|%5c/iu.test(s))) {
    throw new ErrorTransporte('RUTA_INVALIDA')
  }
  const prefijo = base.pathname.replace(/\/$/u, '')
  const destino = new URL(`${base.origin}${prefijo}${ruta}`)
  if (destino.origin !== base.origin) throw new ErrorTransporte('RUTA_INVALIDA')
  if (consulta) for (const [k, v] of Object.entries(consulta)) destino.searchParams.set(k, String(v))
  return destino
}

export interface TransporteHttp {
  solicitar<T = unknown>(ruta: string, solicitud?: SolicitudHttp): Promise<RespuestaHttp<T>>
}

export function crearTransporteHttp(opciones: OpcionesTransporte): TransporteHttp {
  const base = validarBaseUrl(opciones.baseUrl, opciones.permitirHttpLocal)
  const timeoutMs = opciones.timeoutMs ?? 15000
  const llamar: typeof fetch = opciones.fetchImpl ?? ((...args) => fetch(...args))

  async function solicitar<T>(ruta: string, solicitud: SolicitudHttp = {}): Promise<RespuestaHttp<T>> {
    const destino = resolverRuta(base, ruta, solicitud.consulta)
    if (solicitud.senal?.aborted) throw new ErrorTransporte('CANCELADO')

    const cabeceras: Record<string, string> = { Accept: 'application/json' }
    if (!solicitud.anonima) {
      const token = await opciones.obtenerToken()
      if (!token) throw new ErrorTransporte('SIN_SESION')
      cabeceras.Authorization = `Bearer ${token}`
    }
    if (solicitud.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'

    const controlador = new AbortController()
    let vencio = false
    const temporizador = setTimeout(() => {
      vencio = true
      controlador.abort()
    }, timeoutMs)
    const alCancelar = () => controlador.abort()
    solicitud.senal?.addEventListener('abort', alCancelar)

    try {
      let respuesta: Response
      try {
        respuesta = await llamar(destino.toString(), {
          method: solicitud.metodo ?? 'GET',
          headers: cabeceras,
          body: solicitud.cuerpo === undefined ? undefined : JSON.stringify(solicitud.cuerpo),
          redirect: 'manual',
          credentials: 'omit',
          signal: controlador.signal,
        })
      } catch {
        if (vencio) throw new ErrorTransporte('TIEMPO_AGOTADO')
        if (solicitud.senal?.aborted || controlador.signal.aborted) throw new ErrorTransporte('CANCELADO')
        throw new ErrorTransporte('SIN_CONEXION')
      }

      // La pila nativa puede seguir redirecciones sin respetar `manual`: se verifica el destino final.
      if (respuesta.type === 'opaqueredirect' || (respuesta.status >= 300 && respuesta.status < 400)) {
        throw new ErrorTransporte('REDIRECCION_EXTERNA', { estado: respuesta.status })
      }
      if (respuesta.url) {
        let finalUrl: URL | null = null
        try {
          finalUrl = new URL(respuesta.url)
        } catch {
          finalUrl = null
        }
        if (finalUrl && finalUrl.origin !== base.origin) throw new ErrorTransporte('REDIRECCION_EXTERNA')
      }

      let datos: unknown = null
      const tipo = respuesta.headers.get('content-type') ?? ''
      if (respuesta.status !== 204 && /json/iu.test(tipo)) {
        try {
          datos = await respuesta.json()
        } catch {
          if (respuesta.ok) throw new ErrorTransporte('RESPUESTA_INVALIDA', { estado: respuesta.status })
        }
      } else if (respuesta.ok && respuesta.status !== 204) {
        throw new ErrorTransporte('RESPUESTA_INVALIDA', { estado: respuesta.status })
      }

      if (!respuesta.ok) {
        throw new ErrorTransporte('HTTP', { estado: respuesta.status, dominio: errorDesdeRespuesta(datos, respuesta.status) })
      }
      return { estado: respuesta.status, datos: datos as T }
    } finally {
      clearTimeout(temporizador)
      solicitud.senal?.removeEventListener('abort', alCancelar)
    }
  }

  return { solicitar }
}
