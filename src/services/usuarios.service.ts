export type CrearUsuarioPayload = {
  email: string
  password: string
  nombre: string
  apellido: string
  dni: string
  rol_id: number
  telefono?: string
  direccion?: string
  legajo_nro?: string
}

export async function crearUsuario(payload: CrearUsuarioPayload) {
  const res = await fetch('/api/usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? 'No se pudo crear el usuario')
  }
  return data as { ok: true; user_id: string }
}
