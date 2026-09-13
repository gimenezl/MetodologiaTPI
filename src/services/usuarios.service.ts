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

/** Nombre de la tabla ausente, en el formato con el que la nombra PostgREST. */
const TABLA_VINCULOS = 'padres_hijos'

/**
 * Códigos que significan «esa relación no está en el esquema».
 *
 * Son dos porque el error llega por dos caminos distintos y no dicen lo mismo:
 *
 * - `PGRST205` es de PostgREST, que responde 404 cuando la tabla no figura en su
 *   caché de esquema. Es el que se recibe de verdad desde el navegador. La
 *   versión anterior de esta función solo contemplaba el otro, así que nunca
 *   degradaba y el panel de usuarios quedaba inutilizable sobre una base
 *   reproducida desde cero.
 * - `42P01` es de PostgreSQL, y aparecería si la consulta llegara por SQL
 *   directo en lugar de por la API REST.
 */
const CODIGO_POSTGREST_TABLA_AUSENTE = 'PGRST205'
const SQLSTATE_TABLA_INEXISTENTE = '42P01'

/**
 * Decide si un error corresponde a la ausencia conocida de `padres_hijos`.
 *
 * El código por sí solo no alcanza. `PGRST205` significa «no encontré esa tabla
 * en el esquema», y tolerarlo en general convertiría cualquier tabla que
 * desapareciera por error —o cuya caché de esquema quedara desactualizada tras
 * un despliegue— en una lista vacía silenciosa. Por eso se exige además que el
 * mensaje nombre justamente a `padres_hijos`: se tolera esta ausencia, que está
 * documentada y pertenece a EPT-13, y ninguna otra.
 */
function esLaAusenciaConocida(error: { message: string; code?: string }) {
  if (error.code === SQLSTATE_TABLA_INEXISTENTE) return true
  if (error.code !== CODIGO_POSTGREST_TABLA_AUSENTE) return false
  return error.message.includes(TABLA_VINCULOS)
}

/**
 * Devuelve los vínculos padre/tutor ↔ hijo que existan.
 *
 * Degrada a una lista vacía únicamente ante la ausencia conocida de la tabla.
 * La pantalla de usuarios solo necesita roles y perfiles, pero cargaba las tres
 * cosas con un `Promise.all`, de modo que este error tumbaba toda la carga y la
 * directora no podía dar de alta a nadie.
 *
 * Cualquier otro error se propaga tal cual: un problema de red, de permisos, de
 * configuración o una consulta inválida tienen que llegar a la interfaz y verse.
 * Devolver una lista vacía ante un fallo real haría creer que no hay vínculos.
 */
export async function obtenerRelacionesFamiliares(): Promise<RelacionFamiliar[]> {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from(TABLA_VINCULOS)
    .select('padre_id, hijo_id') as unknown as Promise<{
      data: RelacionFamiliar[] | null
      error: { message: string; code?: string } | null
    }>)

  if (error) {
    if (esLaAusenciaConocida(error)) return []
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
