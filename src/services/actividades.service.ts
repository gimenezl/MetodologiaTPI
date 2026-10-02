import { createClient } from '@/services/supabase'
import {
  inscripcionDesdeFila,
  mensajeDeAlta,
  mensajeDeBaja,
  mensajeDeLectura,
  ocupacionPorActividad,
  type FilaCupoActividad,
  type FilaInscripcionLegada,
  type InscripcionLegada,
} from '@/lib/inscripciones-legadas'

/**
 * Talleres y actividades legadas (EPT-66, decisión D1=A).
 *
 * Todas las operaciones sobre inscripciones atraviesan funciones de PostgreSQL
 * que revalidan la identidad y el rol (alumno propio, padre de un hijo
 * vinculado y Dirección). La aplicación ya no escribe ni lee `inscripciones`
 * directamente, y no existe ninguna operación de borrado: una baja es lógica y
 * conserva la fila como historia; la reinscripción crea una fila nueva.
 */

type ActividadFila = {
  id: number
  nombre: string
  tipo: string | null
  cupo_maximo: number
  nivel_id: number | null
  nivel: { nombre: string } | null
}

export async function obtenerActividadesConCupos() {
  const supabase = createClient()
  const [actividades, cupos] = await Promise.all([
    supabase.from('actividades').select(`*, nivel:niveles(nombre)`).order('nombre'),
    supabase.rpc('consultar_cupos_actividades_legadas'),
  ])

  if (actividades.error) throw new Error(actividades.error.message)
  if (cupos.error) throw new Error(mensajeDeLectura(cupos.error))

  const ocupacion = ocupacionPorActividad(cupos.data as FilaCupoActividad[] | null)

  return ((actividades.data ?? []) as ActividadFila[]).map((actividad) => {
    const inscriptos = ocupacion.get(actividad.id) ?? 0
    return {
      ...actividad,
      inscriptos,
      cupo_disponible: actividad.cupo_maximo - inscriptos,
      porcentaje_ocupacion: Math.round((inscriptos / actividad.cupo_maximo) * 100),
    }
  })
}

export async function inscribirAlumno(estudianteId: string, actividadId: number) {
  const supabase = createClient()
  const { error } = await supabase.rpc('inscribir_actividad_legada', {
    p_estudiante_id: estudianteId,
    p_actividad_id: actividadId,
  })
  if (error) throw new Error(mensajeDeAlta(error))
  return true
}

/** Inscripciones ACTIVAS de un alumno (propio, hijo vinculado o, para Dirección, cualquiera). */
export async function obtenerInscripcionesDeAlumno(estudianteId: string): Promise<InscripcionLegada[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('listar_inscripciones_actividades_legadas', {
    p_estudiante_id: estudianteId,
    p_incluir_bajas: false,
  })
  if (error) throw new Error(mensajeDeLectura(error))
  return ((data ?? []) as FilaInscripcionLegada[]).map(inscripcionDesdeFila)
}

/** Baja LÓGICA por identificador: la fila se conserva con estado BAJA. */
export async function darBajaInscripcion(inscripcionId: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('dar_baja_inscripcion_legada', {
    p_inscripcion_id: inscripcionId,
  })
  if (error) throw new Error(mensajeDeBaja(error))
  return true
}

/** Baja lógica de la inscripción activa de un alumno en una actividad. */
export async function darBajaInscripcionDeAlumnoEnActividad(estudianteId: string, actividadId: number) {
  const activas = await obtenerInscripcionesDeAlumno(estudianteId)
  const activa = activas.find((inscripcion) => inscripcion.actividad_id === actividadId)
  if (!activa) {
    throw new Error('No encontramos una inscripción activa de este alumno en la actividad.')
  }
  return darBajaInscripcion(activa.id)
}

/** Inscriptos ACTIVOS de una actividad. Solo Dirección; el resto recibe el rechazo de la base. */
export async function listarInscriptosDeActividad(actividadId: number) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('listar_inscriptos_actividad_legada', {
    p_actividad_id: actividadId,
  })
  if (error) throw new Error(mensajeDeLectura(error))
  return ((data ?? []) as { inscripcion_id: string; estudiante_id: string }[]).map((fila) => ({
    id: fila.inscripcion_id,
    estudiante_id: fila.estudiante_id,
  }))
}
