import type {
  BloqueosInactivacion,
  DetalleProfesor,
  EstadoProfesor,
} from '@/services/profesores.service'

/** Cliente del navegador para el límite HTTP de profesores (EPT-58). */

export class ErrorProfesor extends Error {
  readonly estado: number
  readonly campo?: string
  readonly bloqueos?: BloqueosInactivacion

  constructor(mensaje: string, estado: number, campo?: string, bloqueos?: BloqueosInactivacion) {
    super(mensaje)
    this.name = 'ErrorProfesor'
    this.estado = estado
    this.campo = campo
    this.bloqueos = bloqueos
  }
}

const MENSAJE_RESPALDO = 'No pudimos completar la operación. Volvé a intentarlo.'

async function pedir(url: string, init?: RequestInit) {
  let respuesta: Response
  try {
    respuesta = await fetch(url, init)
  } catch {
    // Sin respuesta: nunca se muestra el mensaje técnico del navegador.
    throw new ErrorProfesor(
      'No pudimos comunicarnos con el servidor. Revisá tu conexión y volvé a intentarlo.',
      0
    )
  }

  const datos = await respuesta.json().catch(() => ({}))

  if (!respuesta.ok) {
    throw new ErrorProfesor(
      typeof datos?.error === 'string' ? datos.error : MENSAJE_RESPALDO,
      respuesta.status,
      typeof datos?.campo === 'string' ? datos.campo : undefined,
      datos?.bloqueos && typeof datos.bloqueos === 'object' ? datos.bloqueos : undefined
    )
  }

  return datos
}

export async function obtenerDetalleProfesorRemoto(profesorId: string): Promise<DetalleProfesor> {
  const datos = await pedir(`/api/profesores/${profesorId}`, { cache: 'no-store' })
  return datos.detalle as DetalleProfesor
}

export function actualizarFichaProfesorRemota(
  profesorId: string,
  legajo: string,
  especialidad: string
) {
  return pedir(`/api/profesores/${profesorId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'actualizar_ficha', legajo_nro: legajo, especialidad }),
  })
}

export function cambiarEstadoProfesorRemoto(
  profesorId: string,
  estado: EstadoProfesor,
  motivo: string | null
) {
  return pedir(`/api/profesores/${profesorId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'cambiar_estado', estado, motivo }),
  })
}
