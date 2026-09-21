/** Cliente del navegador para el límite HTTP de deportes (EPT-11). */

export class ErrorDeportes extends Error {
  readonly estado: number
  readonly campo?: string

  constructor(mensaje: string, estado: number, campo?: string) {
    super(mensaje)
    this.name = 'ErrorDeportes'
    this.estado = estado
    this.campo = campo
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
    // Sin respuesta del servidor no se sabe si la operación se aplicó: la
    // pantalla vuelve a leer el estado real en lugar de suponerlo.
    throw new ErrorDeportes(
      'No pudimos comunicarnos con el servidor. Revisá tu conexión; vamos a mostrarte el estado actual.',
      0
    )
  }

  const datos = await respuesta.json().catch(() => ({}))

  if (!respuesta.ok) {
    throw new ErrorDeportes(
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
 * El cuerpo solo declara QUÉ grupo se solicita. El alumno, su nivel y la
 * disponibilidad se resuelven en el servidor y en PostgreSQL, nunca acá.
 */
export function inscribirEnGrupoRemoto(grupoId: string) {
  return enviar('/api/deportes/inscripciones', 'POST', { grupo_id: grupoId })
}

/** Baja lógica. No existe ninguna ruta de eliminación física. */
export function cancelarInscripcionDeportivaRemota(inscripcionId: string) {
  return enviar(`/api/deportes/inscripciones/${inscripcionId}`, 'PATCH', {
    accion: 'cancelar',
  })
}

export type DatosNuevoGrupo = {
  deporte_id: string
  nivel_id: number
  nombre: string
  cupo: number
  profesor_id: string
}

/** Alta mínima de un grupo por la dirección. */
export function crearGrupoDeportivoRemoto(datos: DatosNuevoGrupo) {
  return enviar('/api/deportes/grupos', 'POST', datos)
}
