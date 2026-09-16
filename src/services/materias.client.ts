/** Cliente del navegador para el límite HTTP de materias (EPT-56). */

export class ErrorMateria extends Error {
  readonly estado: number
  readonly campo?: string

  constructor(mensaje: string, estado: number, campo?: string) {
    super(mensaje)
    this.name = 'ErrorMateria'
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
    throw new ErrorMateria(
      typeof datos?.error === 'string'
        ? datos.error
        : 'No pudimos completar la operación. Volvé a intentarlo.',
      respuesta.status,
      typeof datos?.campo === 'string' ? datos.campo : undefined
    )
  }

  return datos
}

export function crearMateriaRemota(nombre: string) {
  return enviar('/api/materias', 'POST', { nombre })
}

export function renombrarMateriaRemota(id: number, nombre: string) {
  return enviar(`/api/materias/${id}`, 'PATCH', { accion: 'renombrar', nombre })
}

export function cambiarEstadoMateriaRemota(id: number, activo: boolean) {
  return enviar(`/api/materias/${id}`, 'PATCH', { accion: 'cambiar_estado', activo })
}

export function asignarMateriaCursoRemota(
  materiaId: number,
  cursoId: string,
  profesorId: string | null
) {
  return enviar('/api/asignaciones-materias', 'POST', {
    materia_id: materiaId,
    curso_id: cursoId,
    profesor_id: profesorId,
  })
}

export function cambiarProfesorAsignacionRemota(
  asignacionId: string,
  profesorId: string | null
) {
  return enviar(`/api/asignaciones-materias/${asignacionId}`, 'PATCH', {
    accion: 'cambiar_profesor',
    profesor_id: profesorId,
  })
}

export function cambiarEstadoAsignacionRemota(asignacionId: string, activo: boolean) {
  return enviar(`/api/asignaciones-materias/${asignacionId}`, 'PATCH', {
    accion: 'cambiar_estado',
    activo,
  })
}
