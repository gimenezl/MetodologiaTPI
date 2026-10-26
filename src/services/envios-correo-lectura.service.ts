import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Consulta de correos programados para Dirección (EPT-118).
 *
 * Solo servidor y solo lectura. Nunca usa `service_role`: la lectura atraviesa RLS con
 * la sesión (solo un DIRECTOR habilitado ve `envios_correo`; EPT-101). Se listan las
 * columnas una por una: la tabla también guarda `reserva_token`, `reserva_hasta` y
 * `frontera_smtp_en`, que son internas y no se piden.
 *
 * Esta consulta no reenvía, no reabre ni resuelve ningún envío: `INCIERTO` queda tal
 * cual lo dejó el job y no se reintenta automáticamente.
 */

export const TIPOS_ENVIO = ['RECORDATORIO_MENSUAL', 'AVISO_DEUDA'] as const
export const ESTADOS_ENVIO = ['PENDIENTE', 'ENVIADO', 'FALLIDO', 'INCIERTO'] as const
export type TipoEnvio = (typeof TIPOS_ENVIO)[number]
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number]

export interface FiltrosEnvios {
  tipo?: TipoEnvio
  estado?: EstadoEnvio
}

export interface EnvioCorreoVista {
  id: string
  tipo: TipoEnvio
  estado: EstadoEnvio
  fechaProgramada: string
  periodo: string | null
  destinatario: string
  intentos: number
  ultimoIntento: string | null
  motivo: string | null
}

export type ResultadoLecturaEnvios =
  | { ok: true; datos: { envios: EnvioCorreoVista[]; hayMas: boolean } }
  | { ok: false; mensaje: string }

export const LIMITE_ENVIOS = 50
const MAX_MOTIVO = 300
const MENSAJE_FALLA = 'No pudimos cargar los correos programados. Volvé a intentarlo en unos minutos.'

type Fila = {
  id: string
  padre_id: string
  tipo: TipoEnvio
  estado: EstadoEnvio
  fecha_programada: string
  periodo: string | null
  intentos: number
  ultimo_intento_fecha: string | null
  ultimo_error: string | null
}

/** Defensa en profundidad: aun un motivo guardado con un correo no sale con él. */
export function sanearMotivo(motivo: string | null): string | null {
  if (!motivo) return null
  // Se acota antes de aplicar la expresión regular y se corta por caracteres, no por unidades UTF-16.
  const limpio = motivo.slice(0, 1_000).replace(/[^\s@,;<>]+@[^\s@,;<>]+/gu, '[correo oculto]').replace(/\s+/gu, ' ').trim()
  const caracteres = Array.from(limpio)
  return caracteres.length > MAX_MOTIVO ? `${caracteres.slice(0, MAX_MOTIVO).join('')}…` : limpio
}

export function leerFiltros(parametros: { tipo?: string; estado?: string }): FiltrosEnvios {
  return {
    tipo: (TIPOS_ENVIO as readonly string[]).includes(parametros.tipo ?? '') ? (parametros.tipo as TipoEnvio) : undefined,
    estado: (ESTADOS_ENVIO as readonly string[]).includes(parametros.estado ?? '') ? (parametros.estado as EstadoEnvio) : undefined,
  }
}

export async function obtenerEnviosCorreo(pagina = 1, filtros: FiltrosEnvios = {}): Promise<ResultadoLecturaEnvios> {
  try {
    const supabase = await createServerSupabaseClient()
    let consulta = supabase
      .from('envios_correo')
      .select('id, padre_id, tipo, estado, fecha_programada, periodo, intentos, ultimo_intento_fecha, ultimo_error')
      .order('fecha_programada', { ascending: false })
      .order('id', { ascending: false })
    if (filtros.tipo) consulta = consulta.eq('tipo', filtros.tipo)
    if (filtros.estado) consulta = consulta.eq('estado', filtros.estado)
    const inicio = (pagina - 1) * LIMITE_ENVIOS
    // Se pide una fila de más para saber si hay otra página sin contar toda la tabla.
    const lectura = await consulta.range(inicio, inicio + LIMITE_ENVIOS)
    if (lectura.error) return { ok: false, mensaje: MENSAJE_FALLA }

    const filas = (lectura.data ?? []) as unknown as Fila[]
    const hayMas = filas.length > LIMITE_ENVIOS
    const visibles = hayMas ? filas.slice(0, LIMITE_ENVIOS) : filas
    if (visibles.length === 0) return { ok: true, datos: { envios: [], hayMas: false } }

    const ids = [...new Set(visibles.map((f) => f.padre_id))]
    const perfiles = await supabase.from('perfiles').select('id, nombre, apellido').in('id', ids)
    if (perfiles.error) return { ok: false, mensaje: MENSAJE_FALLA }
    const nombres = new Map((perfiles.data ?? []).map((p) => [p.id, `${p.apellido}, ${p.nombre}`]))

    return {
      ok: true,
      datos: {
        hayMas,
        envios: visibles.map((f) => ({
          id: f.id,
          tipo: f.tipo,
          estado: f.estado,
          fechaProgramada: f.fecha_programada,
          periodo: f.periodo,
          destinatario: nombres.get(f.padre_id) ?? 'Destinatario sin datos de perfil',
          intentos: f.intentos,
          ultimoIntento: f.ultimo_intento_fecha,
          motivo: sanearMotivo(f.ultimo_error),
        })),
      },
    }
  } catch {
    return { ok: false, mensaje: MENSAJE_FALLA }
  }
}
