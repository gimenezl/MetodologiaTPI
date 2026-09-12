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

async function enviar(url: string, method: 'POST' | 'PATCH', cuerpo: unknown) {
  const respuesta = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })

  const datos = await respuesta.json().catch(() => ({}))

  if (!respuesta.ok) {
    throw new ErrorAlumno(
      typeof datos?.error === 'string'
        ? datos.error
        : 'No pudimos completar la operación. Volvé a intentarlo.',
      respuesta.status,
      typeof datos?.campo === 'string' ? datos.campo : undefined
    )
  }

  return datos
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
