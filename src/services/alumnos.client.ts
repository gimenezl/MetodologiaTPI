import type { CrearAlumnoData } from '@/lib/validations'

/** Cliente del navegador para el límite HTTP de legajos académicos. */

export class ErrorAlumno extends Error {
  readonly estado: number
  readonly campo?: string

  constructor(mensaje: string, estado: number, campo?: string) {
    super(mensaje)
    this.name = 'ErrorAlumno'
    this.estado = estado
    this.campo = campo
  }
}

/**
 * Cuánto espera el navegador una operación académica, en milisegundos.
 *
 * Sin límite, una petición que nunca responde deja el diálogo ocupado para
 * siempre y sin explicación.
 */
export const LIMITE_DE_OPERACION_ACADEMICA_MS = 20_000

const MENSAJE_SIN_RESPUESTA =
  'No pudimos confirmar si el cambio se guardó porque el servidor no respondió. ' +
  'Actualizá el listado antes de volver a intentarlo.'

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentarlo.'

async function enviar(url: string, method: 'POST' | 'PATCH', cuerpo: unknown) {
  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(LIMITE_DE_OPERACION_ACADEMICA_MS),
    })
  } catch {
    // Un `TypeError: Failed to fetch` o un `TimeoutError` no son mensajes para
    // una persona. Y sin respuesta no se sabe si la operación llegó a
    // confirmarse: se dice eso, no «falló».
    throw new ErrorAlumno(MENSAJE_SIN_RESPUESTA, 503)
  }

  const datos = await respuesta.json().catch(() => null)

  if (!respuesta.ok) {
    // La ruta responde siempre JSON con un mensaje de dominio en `error`. Sin
    // ese formato, la respuesta no la escribió la ruta y su texto no se muestra.
    const mensaje =
      datos && typeof datos === 'object' && typeof datos.error === 'string' && datos.error
        ? datos.error
        : MENSAJE_GENERICO
    throw new ErrorAlumno(
      mensaje,
      respuesta.status,
      datos && typeof datos.campo === 'string' ? datos.campo : undefined
    )
  }

  return datos ?? {}
}

export function crearAlumnoRemoto(datos: CrearAlumnoData) {
  return enviar('/api/alumnos', 'POST', datos)
}

export function corregirIdentidadRemoto(
  id: string,
  dni: string,
  legajoNro?: string
) {
  return enviar(`/api/alumnos/${id}`, 'PATCH', {
    accion: 'corregir_identidad',
    dni,
    ...(legajoNro ? { legajo_nro: legajoNro } : {}),
  })
}

export function cambiarCursoRemoto(id: string, cursoId: string) {
  return enviar(`/api/alumnos/${id}`, 'PATCH', {
    accion: 'cambiar_curso',
    curso_id: cursoId,
  })
}

export function inactivarAlumnoRemoto(id: string) {
  return enviar(`/api/alumnos/${id}`, 'PATCH', { accion: 'inactivar' })
}

export function reactivarAlumnoRemoto(id: string, cursoId: string) {
  return enviar(`/api/alumnos/${id}`, 'PATCH', {
    accion: 'reactivar',
    curso_id: cursoId,
  })
}
