import { createServerSupabaseClient } from '@/services/supabase.server'
import { normalizarHora } from '@/lib/horarios'

export type FranjaAcademica = {
  id: string
  asignacion_id: string
  horario_id: string
  activo: boolean
  fecha_alta: string
  fecha_baja: string | null
  dia_semana: number
  hora_inicio: string
  hora_fin: string
}

export type CambioFranja = {
  id: number
  franja_id: string
  asignacion_anterior: string
  horario_anterior: string
  activo_anterior: boolean
  fecha_baja_anterior: string | null
  asignacion_nueva: string
  horario_nuevo: string
  activo_nuevo: boolean
  cambiado_en: string
}

export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: number; mensaje: string }

type ErrorBase = { code?: string; details?: string; message?: string }

function traducir(error: ErrorBase): { estado: number; mensaje: string } {
  if (error.code === 'P5595' || error.code === 'P5594') {
    try {
      const detalle = JSON.parse(error.details ?? '') as Record<string, unknown>
      if (typeof detalle.actividad === 'string' &&
          typeof detalle.dia_semana === 'number' &&
          typeof detalle.hora_inicio === 'string' &&
          typeof detalle.hora_fin === 'string') {
        const dias = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
        const dia = dias[detalle.dia_semana - 1]
        if (dia && /^\d{2}:\d{2}$/.test(detalle.hora_inicio) &&
            /^\d{2}:\d{2}$/.test(detalle.hora_fin)) {
          return { estado: 409, mensaje: `La franja se superpone con ${detalle.actividad}: ${dia} de ${detalle.hora_inicio} a ${detalle.hora_fin}.` }
        }
      }
    } catch { /* El detalle desconocido nunca se expone al navegador. */ }
    return { estado: 409, mensaje: error.code === 'P5595'
      ? 'La franja se superpone con una actividad deportiva vigente.'
      : 'La franja se superpone con otra materia del curso.' }
  }
  switch (error.code) {
    case '23505': return { estado: 409, mensaje: 'Esa franja ya está asignada a esta materia y curso.' }
    case 'P5593': return { estado: 409, mensaje: 'La asignación debe existir y estar activa.' }
    case 'P5597': return { estado: 404, mensaje: 'La franja académica no existe.' }
    case 'P5585': return { estado: 422, mensaje: 'Seleccioná un día entre lunes y domingo.' }
    case 'P5586': return { estado: 422, mensaje: 'La hora de inicio debe ser anterior a la de fin.' }
    case 'P5505': return { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
    case '42501': return { estado: 403, mensaje: 'Solo la dirección puede administrar horarios académicos.' }
    case '40P01':
    case '55P03': return { estado: 503, mensaje: 'Hay otra operación en curso. Volvé a intentarlo.' }
    default:
      console.error('[horarios-academicos] error de base', { code: error.code, message: error.message })
      return { estado: 500, mensaje: 'No pudimos completar la operación. Volvé a intentarlo.' }
  }
}

/** El catálogo permanece inmutable; se leen sus filas por referencia. */
export async function listarFranjasAcademicas(): Promise<Resultado<FranjaAcademica[]>> {
  const db = await createServerSupabaseClient()
  const { data, error } = await db.from('materias_cursos_horarios')
    .select('id, asignacion_id, horario_id, activo, fecha_alta, fecha_baja, horarios(dia_semana, hora_inicio, hora_fin)')
    .order('fecha_alta', { ascending: false })
  if (error) return { ok: false, ...traducir(error) }
  const franjas = (data ?? []).flatMap((fila) => {
    const horario = Array.isArray(fila.horarios) ? fila.horarios[0] : fila.horarios
    return horario ? [{ ...fila, ...horario, horarios: undefined } as FranjaAcademica] : []
  })
  return { ok: true, datos: franjas }
}

export async function listarHistorialFranjas(): Promise<Resultado<CambioFranja[]>> {
  const db = await createServerSupabaseClient()
  const { data, error } = await db.from('materias_cursos_horarios_historial')
    .select('*').order('cambiado_en', { ascending: false })
  return error ? { ok: false, ...traducir(error) } : { ok: true, datos: (data ?? []) as CambioFranja[] }
}

export async function configurarFranja(datos: {
  asignacion_id: string
  dia_semana: number
  hora_inicio: string
  hora_fin: string
  franja_id?: string
}): Promise<Resultado<{ id: string }>> {
  const db = await createServerSupabaseClient()
  const { data, error } = await db.rpc('configurar_horario_materia', {
    p_asignacion_id: datos.asignacion_id,
    p_dia: datos.dia_semana,
    p_inicio: normalizarHora(datos.hora_inicio),
    p_fin: normalizarHora(datos.hora_fin),
    p_franja_id: datos.franja_id ?? null,
  })
  return error ? { ok: false, ...traducir(error) } : { ok: true, datos: data as { id: string } }
}

export async function cambiarEstadoFranja(id: string, activo: boolean): Promise<Resultado<{ id: string }>> {
  const db = await createServerSupabaseClient()
  const { data, error } = await db.rpc('cambiar_estado_horario_materia', {
    p_franja_id: id, p_activo: activo,
  })
  return error ? { ok: false, ...traducir(error) } : { ok: true, datos: data as { id: string } }
}
