/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@/services/supabase'

export async function obtenerActividadesConCupos() {
  const supabase = createClient()
  const { data: actividades, error } = await supabase
    .from('actividades')
    .select(`*, nivel:niveles(nombre)`)
    .order('nombre') as any

  if (error) throw new Error(error.message)

  const actividadesConConteo = await Promise.all(
    (actividades ?? []).map(async (act: any) => {
      const { count } = await supabase
        .from('inscripciones')
        .select('*', { count: 'exact', head: true })
        .eq('actividad_id', act.id)
        .eq('estado', 'ACTIVO') as any

      return {
        ...act,
        inscriptos: count ?? 0,
        cupo_disponible: act.cupo_maximo - (count ?? 0),
        porcentaje_ocupacion: Math.round(((count ?? 0) / act.cupo_maximo) * 100),
      }
    })
  )
  return actividadesConConteo
}

// Traduce errores crudos de Postgres a mensajes claros para el usuario
function traducirErrorInscripcion(error: { message?: string; code?: string }): string {
  const msg = error?.message ?? ''
  // EPT-11: la vía legada ya no acepta escrituras sobre actividades DEPORTE.
  if (error?.code === 'P5582') {
    return 'Las inscripciones deportivas se hacen por grupo en la sección Deportes.'
  }
  if (error?.code === '23505' || msg.includes('inscripciones_estudiante_id_actividad_id_key')) {
    return 'Este alumno ya está inscripto en esta actividad.'
  }
  if (msg.toLowerCase().includes('cupo')) {
    return 'El cupo para esta actividad está completo.'
  }
  return 'No se pudo inscribir al alumno. Intentá nuevamente.'
}

// Las bajas conservan su mensaje anterior salvo el rechazo deportivo de EPT-11.
function mensajeDeBaja(error: { message?: string; code?: string }): string {
  if (error?.code === 'P5582') {
    return 'Las inscripciones deportivas anteriores son históricas y no se pueden modificar.'
  }
  return error?.message ?? 'No se pudo dar de baja.'
}

export async function inscribirAlumno(estudianteId: string, actividadId: number) {
  const supabase = createClient()

  // ¿Ya existe una inscripción (activa o dada de baja) de este alumno en esta actividad?
  const { data: existente } = await (supabase
    .from('inscripciones')
    .select('id, estado')
    .eq('estudiante_id', estudianteId)
    .eq('actividad_id', actividadId)
    .maybeSingle() as any)

  if (existente?.estado === 'ACTIVO') {
    throw new Error('Este alumno ya está inscripto en esta actividad.')
  }

  // Si había una baja previa la quitamos para poder reinscribir y que el trigger revalide el cupo
  if (existente) {
    await (supabase.from('inscripciones').delete().eq('id', existente.id) as any)
  }

  const { error } = await (supabase
    .from('inscripciones')
    .insert({ estudiante_id: estudianteId, actividad_id: actividadId, estado: 'ACTIVO' } as any) as any)
  if (error) {
    throw new Error(traducirErrorInscripcion(error))
  }
  return true
}

// Elimina físicamente la inscripción cuando el alumno o su tutor deciden desinscribirlo.
export async function eliminarInscripcionDeAlumnoEnActividad(estudianteId: string, actividadId: number) {
  const supabase = createClient()
  const { error } = await (supabase
    .from('inscripciones')
    .delete()
    .eq('estudiante_id', estudianteId)
    .eq('actividad_id', actividadId) as any)
  if (error) throw new Error(mensajeDeBaja(error))
  return true
}

export async function darBajaInscripcion(inscripcionId: string) {
  const supabase = createClient()
  const { error } = await (supabase as any)
    .from('inscripciones')
    .update({ estado: 'BAJA' })
    .eq('id', inscripcionId)
  if (error) throw new Error(mensajeDeBaja(error))
  return true
}

export async function obtenerInscripcionesDeAlumno(estudianteId: string) {
  const supabase = createClient()
  const { data, error } = await (supabase
    .from('inscripciones')
    .select(`*, actividad:actividades(nombre, tipo, cupo_maximo)`)
    .eq('estudiante_id', estudianteId)
    .eq('estado', 'ACTIVO') as any)
  if (error) throw new Error(error.message)
  return data
}
