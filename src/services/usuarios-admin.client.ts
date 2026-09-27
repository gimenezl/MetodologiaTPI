import { ErrorDeDominio, errorDesdeRespuesta } from '@/lib/errores'
import type {
  CambioDeAcceso,
  CambioDeRol,
  DetalleDeUsuario,
  EntradaDeHistorial,
  PaginaDeUsuarios,
  Sincronizacion,
} from '@/services/gestion-usuarios.service'
import type {
  DesafioEnviado,
  EstadoDeVinculo,
  VinculoCompletado,
} from '@/services/vinculo-cuenta.service'

/**
 * Cliente del navegador para la API de Usuarios (EPT-59).
 *
 * Toda respuesta de error se reconstruye con `errorDesdeRespuesta`: el mensaje
 * que se muestra sale del catálogo de dominio o de la propia ruta, nunca de un
 * intermediario ni del navegador. Los tipos se importan solo como tipos: los
 * servicios que los declaran son de servidor.
 *
 * Ninguna función de este módulo registra el cuerpo que envía: el vínculo de
 * cuentas lleva el código de verificación y la contraseña elegida.
 */

export type {
  CambioDeAcceso,
  CambioDeRol,
  DetalleDeUsuario,
  EntradaDeHistorial,
  PaginaDeUsuarios,
  UsuarioResumen,
} from '@/services/gestion-usuarios.service'
export type { EstadoDeVinculo } from '@/services/vinculo-cuenta.service'

/** Error de la API con los datos adicionales seguros que la ruta devolvió. */
export class ErrorDeUsuarios extends ErrorDeDominio {
  readonly estadoHttp: number
  /** `null` si no hubo respuesta: el resultado de la operación es desconocido. */
  readonly sinRespuesta: boolean
  readonly intentosRestantes: number | null

  constructor(base: ErrorDeDominio, estadoHttp: number, sinRespuesta: boolean, intentos: number | null) {
    super(base.codigo, {
      mensaje: base.message,
      referencia: base.referencia,
      campo: base.campo,
    })
    this.name = 'ErrorDeUsuarios'
    this.estadoHttp = estadoHttp
    this.sinRespuesta = sinRespuesta
    this.intentosRestantes = intentos
  }
}

const MENSAJE_SIN_CONEXION =
  'No pudimos comunicarnos con el servidor. Revisá tu conexión y volvé a intentarlo.'

/** Plazo por defecto de una petición; la verificación D5 usa uno mayor. */
const LIMITE_MS = 30_000
const LIMITE_VERIFICACION_MS = 60_000

async function pedir<T>(url: string, init: RequestInit & { limiteMs?: number } = {}): Promise<T> {
  const { limiteMs = LIMITE_MS, ...opciones } = init
  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      cache: 'no-store',
      ...opciones,
      signal: AbortSignal.timeout(limiteMs),
    })
  } catch {
    throw new ErrorDeUsuarios(
      new ErrorDeDominio('SERVICIO_NO_DISPONIBLE', { mensaje: MENSAJE_SIN_CONEXION }),
      0,
      true,
      null
    )
  }

  const cuerpo: unknown = await respuesta.json().catch(() => null)
  if (!respuesta.ok) {
    const datos = (cuerpo ?? {}) as Record<string, unknown>
    const intentos =
      typeof datos.intentos_restantes === 'number' ? datos.intentos_restantes : null
    throw new ErrorDeUsuarios(errorDesdeRespuesta(cuerpo, respuesta.status), respuesta.status, false, intentos)
  }
  return cuerpo as T
}

function json(metodo: string, cuerpo?: unknown): RequestInit {
  return {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  }
}

// ---- Listado, detalle e historial ----

export function listarUsuarios(busqueda: string, pagina: number) {
  const parametros = new URLSearchParams()
  if (busqueda.trim()) parametros.set('busqueda', busqueda.trim())
  parametros.set('pagina', String(pagina))
  return pedir<PaginaDeUsuarios>(`/api/usuarios?${parametros.toString()}`)
}

export function obtenerUsuario(id: string) {
  return pedir<DetalleDeUsuario>(`/api/usuarios/${encodeURIComponent(id)}`)
}

export async function obtenerHistorial(id: string) {
  const datos = await pedir<{ historial: EntradaDeHistorial[] }>(
    `/api/usuarios/${encodeURIComponent(id)}/historial`
  )
  return datos.historial
}

// ---- Datos personales, rol y acceso ----

export type DatosPersonales = {
  nombre: string
  apellido: string
  dni: string
  fecha_nacimiento: string | null
  telefono: string | null
  direccion: string | null
  legajo_nro: string | null
}

export function actualizarDatosPersonales(id: string, datos: DatosPersonales) {
  return pedir<{ perfil: Record<string, unknown> }>(
    `/api/usuarios/${encodeURIComponent(id)}`,
    json('PATCH', datos)
  )
}

export function cambiarRol(id: string, rolEsperado: string | null, rolNuevo: string, motivo: string) {
  return pedir<CambioDeRol>(
    `/api/usuarios/${encodeURIComponent(id)}/rol`,
    json('POST', { rol_esperado: rolEsperado, rol_nuevo: rolNuevo, motivo })
  )
}

export function cambiarAcceso(
  id: string,
  estadoEsperado: 'HABILITADO' | 'BLOQUEADO',
  estadoNuevo: 'HABILITADO' | 'BLOQUEADO',
  motivo: string
) {
  return pedir<CambioDeAcceso>(
    `/api/usuarios/${encodeURIComponent(id)}/acceso`,
    json('POST', { estado_esperado: estadoEsperado, estado_nuevo: estadoNuevo, motivo })
  )
}

export function sincronizarAcceso(id: string) {
  return pedir<Sincronizacion>(`/api/usuarios/${encodeURIComponent(id)}/acceso/sincronizar`, {
    method: 'POST',
  })
}

// ---- Vínculo presencial de cuenta (D5) ----

export type DatosDeReserva = {
  operacion_id: string
  perfil_id: string
  dni: string
  modalidad: 'TITULAR' | 'REPRESENTANTE'
  representante_dni: string | null
  documento_verificado: true
}

export function reservarVinculo(datos: DatosDeReserva) {
  return pedir<EstadoDeVinculo>('/api/usuarios/vinculos', json('POST', datos))
}

export function consultarVinculo(operacion: string) {
  return pedir<EstadoDeVinculo>(`/api/usuarios/vinculos/${encodeURIComponent(operacion)}`)
}

export function enviarCodigo(operacion: string, correo: string) {
  return pedir<DesafioEnviado>(
    `/api/usuarios/vinculos/${encodeURIComponent(operacion)}/desafio`,
    json('POST', { correo })
  )
}

export function verificarCodigo(operacion: string, codigo: string, contrasena: string) {
  return pedir<VinculoCompletado>(
    `/api/usuarios/vinculos/${encodeURIComponent(operacion)}/verificacion`,
    { ...json('POST', { codigo, contrasena }), limiteMs: LIMITE_VERIFICACION_MS }
  )
}

export function cancelarVinculo(operacion: string) {
  return pedir<EstadoDeVinculo>(
    `/api/usuarios/vinculos/${encodeURIComponent(operacion)}/cancelacion`,
    { method: 'POST' }
  )
}
