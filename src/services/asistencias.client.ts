import type {
  AsistenciaRegistrada,
  EstadoAsistencia,
  PanelDeAsistencias,
} from '@/lib/asistencias'
import { createClient } from '@/services/supabase'

/**
 * Cliente del navegador de Asistencias (EPT-66 D).
 *
 * El personal (Dirección y docentes) NO habla con las tablas: usa la API
 * `/api/asistencias`, que autoriza en el servidor y deriva el registrante de la
 * sesión. Este módulo nunca envía una identidad de quien registra.
 *
 * El alumno y el padre consultan su propia asistencia con la RLS de la base
 * (solo lectura): ven únicamente lo propio o lo de sus hijos vinculados.
 */

export class ErrorAsistencia extends Error {
  readonly estado: number
  readonly codigo?: string

  constructor(mensaje: string, estado: number, codigo?: string) {
    super(mensaje)
    this.name = 'ErrorAsistencia'
    this.estado = estado
    this.codigo = codigo
  }
}

const MENSAJE_RESPALDO = 'No pudimos completar la operación. Volvé a intentarlo.'

async function pedir(url: string, init?: RequestInit) {
  let respuesta: Response
  try {
    respuesta = await fetch(url, { cache: 'no-store', ...init })
  } catch {
    // Sin respuesta: nunca se muestra el mensaje técnico del navegador.
    throw new ErrorAsistencia(
      'No pudimos comunicarnos con el servidor. Revisá tu conexión y volvé a intentarlo.',
      0
    )
  }

  const datos = await respuesta.json().catch(() => ({}))
  if (!respuesta.ok) {
    throw new ErrorAsistencia(
      typeof datos?.error === 'string' ? datos.error : MENSAJE_RESPALDO,
      respuesta.status,
      typeof datos?.codigo === 'string' ? datos.codigo : undefined
    )
  }
  return datos
}

/** Alumnos gestionables, asistencias de la fecha e historial (personal). */
export async function obtenerPanelDeAsistenciasRemoto(fecha: string): Promise<PanelDeAsistencias> {
  return (await pedir(`/api/asistencias?fecha=${encodeURIComponent(fecha)}`)) as PanelDeAsistencias
}

/** Alta o corrección del estado. La respuesta dice qué hizo la base. */
export async function registrarAsistenciaRemota(datos: {
  estudiante_id: string
  fecha: string
  estado: EstadoAsistencia
}): Promise<AsistenciaRegistrada> {
  const cuerpo = await pedir('/api/asistencias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  })
  return cuerpo.asistencia as AsistenciaRegistrada
}

export type AsistenciaPropia = {
  id: string
  fecha: string
  estado: EstadoAsistencia
  estudiante_id: string | null
  estudiante?: { id: string; nombre: string; apellido: string; legajo_nro: string | null } | null
}

/**
 * Historial de asistencia del alumno de la sesión o, para un padre, de sus hijos
 * vinculados. Lectura directa: la RLS de `asistencias` limita las filas y la
 * pantalla no ofrece ninguna escritura a estos roles.
 */
export async function obtenerAsistenciasPropias(): Promise<AsistenciaPropia[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('asistencias')
    .select(
      `
      id, fecha, estado, estudiante_id,
      estudiante:perfiles!asistencias_estudiante_id_fkey(id, nombre, apellido, legajo_nro)
    `
    )
    .order('fecha', { ascending: false })
  if (error) throw new ErrorAsistencia(MENSAJE_RESPALDO, 0)
  return (data ?? []) as unknown as AsistenciaPropia[]
}
