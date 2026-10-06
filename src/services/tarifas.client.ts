/** Cliente del navegador para el límite HTTP de las tarifas (EPT-103). */

import type { VersionTarifa } from '@/lib/tarifas'

export const MENSAJE_SIN_CONEXION =
  'No pudimos comunicarnos con el servidor, así que no sabemos si el cambio se guardó. Si la conexión se cortó justo después de enviar, revisá el historial de la tarifa antes de reintentar.'

export class ErrorTarifas extends Error {
  readonly estado: number
  readonly campo?: string
  readonly codigo?: string
  /** Verdadero si la petición no llegó a obtener respuesta (red caída, corte, tiempo agotado). */
  readonly sinConexion: boolean

  constructor(
    mensaje: string,
    estado: number,
    opciones: { campo?: string; codigo?: string; sinConexion?: boolean } = {}
  ) {
    super(mensaje)
    this.name = 'ErrorTarifas'
    this.estado = estado
    this.campo = opciones.campo
    this.codigo = opciones.codigo
    this.sinConexion = opciones.sinConexion ?? false
  }
}

async function enviar(url: string, method: 'POST' | 'PATCH', cuerpo: unknown) {
  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
  } catch {
    throw new ErrorTarifas(MENSAJE_SIN_CONEXION, 0, { sinConexion: true })
  }

  const datos = await respuesta.json().catch(() => ({}))

  if (!respuesta.ok) {
    throw new ErrorTarifas(
      typeof datos?.error === 'string'
        ? datos.error
        : 'No pudimos completar la operación. Volvé a intentarlo.',
      respuesta.status,
      {
        campo: typeof datos?.campo === 'string' ? datos.campo : undefined,
        codigo: typeof datos?.codigo === 'string' ? datos.codigo : undefined,
      }
    )
  }

  return datos
}

export type VigenciaEnviada = {
  /** Importe tal como lo escribió la persona: el servidor lo normaliza y la base lo valida. */
  importe: string
  desde: string
  /** Vacío = sin fecha de fin. */
  hasta: string
}

export type TarifaNueva = VigenciaEnviada & { concepto: string; referencia_id: string }

/** Ningún cuerpo declara quién actúa: la identidad se deriva de la sesión en el servidor y en PostgreSQL. */
export function crearTarifaRemota(datos: TarifaNueva): Promise<{ ok: true; tarifa: VersionTarifa }> {
  return enviar('/api/tarifas', 'POST', datos)
}

export function cambiarTarifaRemota(
  datos: TarifaNueva
): Promise<{ ok: true; anterior: VersionTarifa | null; nueva: VersionTarifa }> {
  return enviar('/api/tarifas/cambio', 'POST', datos)
}

export function actualizarTarifaRemota(
  tarifaId: string,
  datos: VigenciaEnviada & { previo: { importe: string; desde: string; hasta: string | null } }
): Promise<{ ok: true; tarifa: VersionTarifa }> {
  return enviar(`/api/tarifas/${tarifaId}`, 'PATCH', datos)
}
