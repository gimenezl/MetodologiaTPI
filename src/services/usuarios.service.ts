import { createClient } from '@/services/supabase'

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
  hijos_ids?: string[]
  tutor_id?: string
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

export type RelacionFamiliar = { padre_id: string; hijo_id: string }

/**
 * Mensaje único del vínculo parental, compartido por la lectura y la escritura.
 *
 * `padres_hijos` no existe en el esquema versionado: ninguna migración la crea.
 * Sobre una base reproducida desde cero, cualquier consulta a esa tabla falla.
 * La funcionalidad completa pertenece a EPT-13.
 */
export const VINCULO_PARENTAL_NO_DISPONIBLE =
  'Los vínculos entre padres o tutores e hijos todavía no están disponibles.'

/** SQLSTATE de PostgreSQL para «la relación no existe». */
const SQLSTATE_TABLA_INEXISTENTE = '42P01'

/**
 * Devuelve los vínculos padre/tutor ↔ hijo que existan.
 *
 * Degrada a una lista vacía cuando la tabla no está en el esquema, en lugar de
 * propagar el error. Antes, una pantalla que solo necesita roles y perfiles se
 * caía entera porque cargaba las tres cosas con un `Promise.all`: sobre una base
 * reproducible el panel de usuarios quedaba inutilizable. Cualquier otro error
 * sí se propaga: no corresponde ocultar un fallo real de lectura.
 */
export async function obtenerRelacionesFamiliares(): Promise<RelacionFamiliar[]> {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('padres_hijos')
    .select('padre_id, hijo_id') as unknown as Promise<{
      data: RelacionFamiliar[] | null
      error: { message: string; code?: string } | null
    }>)

  if (error) {
    if (error.code === SQLSTATE_TABLA_INEXISTENTE) return []
    throw new Error(error.message)
  }
  return data ?? []
}

/*
 * No existen `setHijosDePadre` ni `setTutorDeHijo` (EPT-9).
 *
 * Escribían en `padres_hijos`, que no existe en ninguna migración: la operación
 * fallaba siempre y, en el alta de usuarios, lo hacía después de haber creado la
 * cuenta de Auth y el perfil, dejando filas huérfanas que reservaban el DNI y el
 * legajo. La escritura del vínculo parental vuelve cuando EPT-13 aporte su
 * migración; hasta entonces la interfaz lo informa en lugar de intentarlo.
 */
