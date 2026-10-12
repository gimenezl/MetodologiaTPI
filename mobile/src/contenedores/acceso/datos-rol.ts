import type { ClienteEPT } from '@/servicios/supabase'
import type { RolAplicacion } from '@/servicios/autenticacion'

export interface ResumenAlumno {
  id: string
  nombre: string | null
  apellido: string | null
  legajo_nro: string | null
  estado: 'ACTIVO' | 'INACTIVO' | null
  curso_denominacion: string | null
  curso_division: string | null
  nivel_nombre: string | null
}

export type DatosRol =
  | { rol: 'PADRE'; hijos: ResumenAlumno[] }
  | { rol: 'ESTUDIANTE'; alumno: ResumenAlumno }

/** Lee únicamente vistas y relaciones del actor autenticado; RLS decide qué filas existen. */
export async function cargarDatosRol(cliente: ClienteEPT, usuarioId: string, rol: RolAplicacion): Promise<DatosRol> {
  if (rol !== 'PADRE' && rol !== 'ESTUDIANTE') throw new Error('El rol no tiene una vista móvil disponible.')

  const { data: perfil, error: errorPerfil } = await cliente
    .from('perfiles')
    .select('id')
    .eq('user_id', usuarioId)
    .maybeSingle()
  if (errorPerfil || !perfil) throw new Error('No se pudo cargar el perfil autorizado.')

  if (rol === 'PADRE') {
    const { data: vinculos, error: errorVinculos } = await cliente
      .from('padres_hijos')
      .select('hijo_id')
      .eq('padre_id', perfil.id)
    if (errorVinculos) throw new Error('No se pudieron consultar los vínculos familiares.')
    const idsHijos = (vinculos ?? []).map(vinculo => vinculo.hijo_id)
    if (idsHijos.length === 0) return { rol, hijos: [] }
    const { data: hijos, error: errorHijos } = await cliente
      .from('alumnos_academicos')
      .select('id,nombre,apellido,legajo_nro,estado,curso_denominacion,curso_division,nivel_nombre')
      .in('id', idsHijos)
    if (errorHijos) throw new Error('No se pudo cargar la información de los estudiantes vinculados.')
    return { rol, hijos: hijos?.filter((hijo): hijo is ResumenAlumno => hijo.id !== null) ?? [] }
  }

  const { data: alumno, error: errorAlumno } = await cliente
    .from('alumnos_academicos')
    .select('id,nombre,apellido,legajo_nro,estado,curso_denominacion,curso_division,nivel_nombre')
    .eq('id', perfil.id)
    .maybeSingle()
  if (errorAlumno || !alumno || !alumno.id) throw new Error('No se pudo cargar el perfil académico propio.')
  return { rol, alumno: { ...alumno, id: String(alumno.id) } }
}
