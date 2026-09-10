import type { ActualizarCursoData, CrearCursoData } from '@/lib/validations'

/**
 * Cliente del navegador para el límite HTTP de cursos.
 *
 * Es un módulo aparte de `cursos.service.ts` a propósito: ese corre solo en el
 * servidor y habla con PostgreSQL, este corre en el navegador y solo habla con
 * `/api/cursos`. La separación evita que un componente cliente arrastre el
 * acceso a datos por error.
 *
 * No expone ninguna operación de borrado: la baja de un curso es lógica y viaja
 * como `{ activo: false }`.
 */

export class ErrorCurso extends Error {
  readonly estado: number
  readonly campo?: string

  constructor(mensaje: string, estado: number, campo?: string) {
    super(mensaje)
    this.name = 'ErrorCurso'
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
    throw new ErrorCurso(
      typeof datos?.error === 'string' ? datos.error : 'No pudimos completar la operación.',
      respuesta.status,
      typeof datos?.campo === 'string' ? datos.campo : undefined
    )
  }

  return datos
}

export function crearCursoRemoto(datos: CrearCursoData) {
  return enviar('/api/cursos', 'POST', datos)
}

export function actualizarCursoRemoto(id: string, cambios: ActualizarCursoData) {
  return enviar(`/api/cursos/${id}`, 'PATCH', cambios)
}
