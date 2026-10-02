import { leerTodasLasFilas } from '@/lib/paginacion'
import {
  traducirErrorDeAsistencia,
  type AsistenciaDeGestion,
  type AsistenciaRegistrada,
  type CodigoErrorAsistencia,
  type EstadoAsistencia,
  type EstudianteDeAsistencia,
  type HistorialAsistencia,
  type PanelDeAsistencias,
  type RegistroAsistenciaData,
  type ResultadoRegistro,
} from '@/lib/asistencias'
import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Asistencias del personal, ligadas a la sesión real de Supabase (EPT-66 D).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación. La
 * pantalla habla con `/api/asistencias` (ver `asistencias.client.ts`).
 *
 * Nunca usa `service_role`. Quién ve y quién escribe lo decide PostgreSQL con
 * un único predicado de vínculo vigente (matrícula vigente en un curso donde el
 * docente dicta una materia activa, o inscripción deportiva activa en un grupo
 * activo del docente): las lecturas pasan por RLS y por
 * `listar_estudiantes_para_gestion`, y el registro por `registrar_asistencia`,
 * que bloquea y revalida el vínculo. Ninguna función de este módulo recibe un
 * registrante: la identidad de quien registra la deriva la base de `auth.uid()`.
 *
 * Una modificación que no alcanza ninguna fila no se informa como éxito: la
 * función de la base responde un error explícito (P6610) y acá se devuelve tal
 * cual, con el estado HTTP que corresponde.
 */

export type FalloAsistencias = {
  ok: false
  estado: 400 | 401 | 403 | 404 | 409 | 500
  codigo: CodigoErrorAsistencia
  mensaje: string
}

export type ResultadoAsistencias<T> = { ok: true; datos: T } | FalloAsistencias

type ErrorBase = { code?: string | null; message?: string | null } | null

function fallo(error: ErrorBase): FalloAsistencias {
  const traducido = traducirErrorDeAsistencia(error)
  if (traducido.estado === 500) {
    // Solo el servidor registra el detalle técnico.
    console.error('[asistencias] error inesperado', { code: error?.code, message: error?.message })
  }
  return { ok: false, ...traducido }
}

/**
 * Panel de la pantalla de gestión: los alumnos que el actor puede gestionar, las
 * asistencias de la fecha y el historial para el porcentaje. Todo atraviesa la
 * RLS del actor: un DOCENTE recibe solo lo de sus alumnos vinculados.
 */
export async function obtenerPanelDeAsistencias(
  fecha: string
): Promise<ResultadoAsistencias<PanelDeAsistencias>> {
  const supabase = await createServerSupabaseClient()

  const [estudiantes, delDia, historial] = await Promise.all([
    supabase.rpc('listar_estudiantes_para_gestion'),
    supabase
      .from('asistencias')
      .select('id, fecha, estado, estudiante_id')
      .eq('fecha', fecha)
      .order('id', { ascending: true }),
    leerTodasLasFilas<HistorialAsistencia & { id: string }>((desde, hasta) =>
      supabase
        .from('asistencias')
        .select('id, estudiante_id, fecha, estado')
        .order('fecha', { ascending: false })
        .order('id', { ascending: true })
        .range(desde, hasta)
    ),
  ])

  if (estudiantes.error) return fallo(estudiantes.error)
  if (delDia.error) return fallo(delDia.error)
  if (!historial.ok) return fallo(historial.error)

  return {
    ok: true,
    datos: {
      estudiantes: ((estudiantes.data ?? []) as EstudianteDeAsistencia[]).map(
        ({ id, nombre, apellido, legajo_nro }) => ({
          id,
          nombre,
          apellido,
          legajo_nro: legajo_nro ?? null,
        })
      ),
      asistencias: (delDia.data ?? []) as AsistenciaDeGestion[],
      historial: historial.datos.map(({ estudiante_id, fecha: dia, estado }) => ({
        estudiante_id,
        fecha: dia,
        estado,
      })),
    },
  }
}

/**
 * Alta o corrección de estado de la asistencia de un alumno y un día.
 *
 * `resultado` dice qué hizo la base: CREADA, ACTUALIZADA (cambió el estado de
 * una existente; el registrante original se conserva) o SIN_CAMBIOS.
 */
export async function registrarAsistenciaDeSesion(
  datos: RegistroAsistenciaData
): Promise<ResultadoAsistencias<AsistenciaRegistrada>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('registrar_asistencia', {
    p_estudiante_id: datos.estudiante_id,
    p_fecha: datos.fecha,
    p_estado: datos.estado,
  })
  if (error) return fallo(error)

  const fila = (data ?? [])[0] as
    | {
        id: string
        estudiante_id: string
        fecha: string
        estado: EstadoAsistencia
        resultado: ResultadoRegistro
      }
    | undefined
  // Sin fila no hay certeza de que algo se haya registrado: nunca se informa éxito.
  if (!fila) return fallo(null)

  return {
    ok: true,
    datos: {
      id: fila.id,
      estudiante_id: fila.estudiante_id,
      fecha: fila.fecha,
      estado: fila.estado,
      resultado: fila.resultado,
    },
  }
}
