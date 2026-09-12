import type { CrearNivelData } from '@/lib/validations'

/** Cliente del navegador para el límite HTTP de niveles educativos. */

export class ErrorNivel extends Error {
  readonly estado: number
  readonly campo?: string

  constructor(mensaje: string, estado: number, campo?: string) {
    super(mensaje)
    this.name = 'ErrorNivel'
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
    throw new ErrorNivel(
      typeof datos?.error === 'string'
        ? datos.error
        : 'No pudimos completar la operación. Volvé a intentarlo.',
      respuesta.status,
      typeof datos?.campo === 'string' ? datos.campo : undefined
    )
  }

  return datos
}

export function crearNivelRemoto(datos: CrearNivelData) {
  return enviar('/api/niveles', 'POST', datos)
}

export function renombrarNivelRemoto(id: number, nombre: string) {
  return enviar(`/api/niveles/${id}`, 'PATCH', {
    accion: 'renombrar',
    nombre,
  })
}

export function cambiarEstadoNivelRemoto(id: number, activo: boolean) {
  return enviar(`/api/niveles/${id}`, 'PATCH', {
    accion: 'cambiar_estado',
    activo,
  })
}
