import type { CodigoAcceso, CodigoResultado } from '@/lib/accesos-qr/errores'

/**
 * Tipos compartidos entre el servidor y la pantalla del escáner (EPT-65).
 * Solo tipos y utilidades puras: no arrastra `next/headers` ni Supabase.
 */

export type Sentido = 'IDA' | 'VUELTA'
export type TipoServicio = 'COMEDOR' | 'TRANSPORTE'

/** Un servicio o recorrido que el operador puede declarar al escanear. */
export type ServicioEscaneable = {
  id: string
  tipo: TipoServicio
  codigo: string
  nombre: string
}

/** Resultado de un escaneo tal como lo entrega la API al operador. */
export type RespuestaEscaneo = {
  codigo: CodigoResultado
  mensaje: string
  /** Solo en REGISTRADO. */
  alumno?: { nombre: string; apellido: string; legajo: string | null }
  /** Solo en REGISTRADO: hora sellada por la base. */
  registrado_en?: string
}

/** Fila de la auditoría de Dirección (la función de lectura ya recorta lo interno). */
export type FilaAcceso = {
  id: string
  registrado_en: string
  hora: string
  dia_servicio: string
  resultado: 'REGISTRADO' | 'DENEGADO'
  motivo_denegacion: string | null
  servicio_nombre: string
  servicio_tipo: TipoServicio
  sentido: Sentido | null
  alumno_nombre: string | null
  alumno_apellido: string | null
  alumno_legajo: string | null
  operador_nombre: string
  anulado: boolean
  anulado_motivo: string | null
  anonimizado: boolean
}

export type ResultadoRemotoRegistro =
  | { ok: true; respuesta: RespuestaEscaneo }
  | {
      ok: false
      /** Estado HTTP, o `0` si la petición no llegó a completarse. */
      estado: number
      codigo?: CodigoAcceso
      mensaje: string
      /** Segundos que indica `Retry-After` en un 429. */
      reintentarEnSegundos?: number
      /** El mismo intento puede reenviarse sin riesgo de duplicar. */
      reintentable: boolean
    }

const ZONA = 'America/Argentina/Buenos_Aires'

/**
 * Hora y fecha de Buenos Aires como texto estable (24 h, sin espacios
 * especiales). Evita `toLocaleTimeString` en 12 h, cuyo separador difiere entre
 * Node y el navegador y rompía la hidratación en EPT-62.
 */
export function formatearMomentoBA(iso: string): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '--'
  return {
    fecha: `${valor('day')}/${valor('month')}/${valor('year')}`,
    hora: `${valor('hour')}:${valor('minute')}:${valor('second')}`,
  }
}

/** Día de hoy en Buenos Aires como `AAAA-MM-DD`. */
export function hoyBA(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ahora)
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00'
  return `${valor('year')}-${valor('month')}-${valor('day')}`
}
