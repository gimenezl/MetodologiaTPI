/** Cliente del navegador para el límite HTTP del transporte (EPT-60). */

export class ErrorTransporte extends Error {
  readonly estado: number
  readonly campo?: string

  constructor(mensaje: string, estado: number, campo?: string) {
    super(mensaje)
    this.name = 'ErrorTransporte'
    this.estado = estado
    this.campo = campo
  }
}

async function enviar(url: string, method: 'POST' | 'PATCH', cuerpo: unknown) {
  const respuesta = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })

  const datos = await respuesta.json().catch(() => ({}))

  if (!respuesta.ok) {
    throw new ErrorTransporte(
      typeof datos?.error === 'string'
        ? datos.error
        : 'No pudimos completar la operación. Volvé a intentarlo.',
      respuesta.status,
      typeof datos?.campo === 'string' ? datos.campo : undefined
    )
  }

  return datos
}

/**
 * El cuerpo solo declara QUÉ recorrido se solicita. El alumno se deriva de la
 * sesión en el servidor y en PostgreSQL, nunca acá. Sirve tanto para
 * inscribirse por primera vez como para cambiar de recorrido: PostgreSQL
 * decide cuál de las dos es, de forma atómica.
 */
export function establecerRecorridoRemoto(servicioId: string) {
  return enviar('/api/transporte/inscripciones', 'POST', { servicio_id: servicioId })
}

/** Baja lógica sin reemplazo. No existe ninguna ruta de eliminación física. */
export function cancelarInscripcionTransporteRemota(inscripcionId: string) {
  return enviar(`/api/transporte/inscripciones/${inscripcionId}`, 'PATCH', {
    accion: 'cancelar',
  })
}

/** Mantenimiento descriptivo de un recorrido, exclusivo de Dirección. */
export function actualizarRecorridoRemoto(
  servicioId: string,
  nombre: string,
  activo: boolean
) {
  return enviar(`/api/transporte/recorridos/${servicioId}`, 'PATCH', { nombre, activo })
}
