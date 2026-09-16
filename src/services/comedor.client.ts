/** Cliente del navegador para el límite HTTP del comedor (EPT-10). */

export class ErrorComedor extends Error {
  readonly estado: number
  readonly campo?: string

  constructor(mensaje: string, estado: number, campo?: string) {
    super(mensaje)
    this.name = 'ErrorComedor'
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
    throw new ErrorComedor(
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
 * El cuerpo solo declara QUÉ servicio se solicita. El alumno se deriva de la
 * sesión en el servidor y en PostgreSQL, nunca acá.
 */
export function inscribirEnServicioRemoto(servicioId: string) {
  return enviar('/api/comedor/inscripciones', 'POST', { servicio_id: servicioId })
}

/** Baja lógica. No existe ninguna ruta de eliminación física. */
export function cancelarInscripcionRemota(inscripcionId: string) {
  return enviar(`/api/comedor/inscripciones/${inscripcionId}`, 'PATCH', {
    accion: 'cancelar',
  })
}
