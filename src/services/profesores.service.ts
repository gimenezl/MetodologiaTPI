import { z } from 'zod'
import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Fichas de profesores y sus asignaciones, ligadas a la sesión real (EPT-58).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`.
 *
 * Nunca usa `service_role` ni escribe tablas: todo pasa por los envoltorios
 * públicos de la migración A, que vuelven a validar `auth.uid()` y el rol
 * dentro de PostgreSQL. Esta capa solo traduce resultados y errores a un
 * contrato estable en español, sin SQLSTATE ni mensajes de la base.
 *
 * No existe ninguna operación de borrado.
 */

export type EstadoProfesor = 'ACTIVO' | 'INACTIVO'
export type TipoRelacion = 'MATERIA' | 'GRUPO_DEPORTIVO'

/** Fila del listado de la dirección. */
export type FichaResumen = {
  perfil_id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
  especialidad: string | null
  estado: EstadoProfesor
  ficha_completa: boolean
  rol_docente_vigente: boolean
  asignaciones_activas: number
  grupos_activos: number
}

/** Ficha con datos personales, solo para la dirección. Nunca incluye el correo. */
export type FichaProfesor = FichaResumen & {
  dni: string
  telefono: string | null
  direccion: string | null
  fecha_nacimiento: string | null
}

/** Ficha que ve el propio docente: lo que la pantalla muestra y nada más. */
export type FichaPropia = Pick<
  FichaResumen,
  'perfil_id' | 'nombre' | 'apellido' | 'legajo_nro' | 'especialidad' | 'estado' | 'ficha_completa'
>

/** Relación que hoy referencia al profesor: vigente o histórica. */
export type AsignacionProfesor = {
  tipo: TipoRelacion
  relacion_id: string
  vigente: boolean
  actividad_nombre: string
  grupo_nombre: string | null
  curso_denominacion: string | null
  curso_division: string | null
  nivel_nombre: string
  actividad_activa: boolean
  curso_activo: boolean | null
}

/** Franja activa de una relación vigente. */
export type HorarioProfesor = {
  tipo: TipoRelacion
  relacion_id: string
  franja_id: string
  dia_semana: number
  hora_inicio: string
  hora_fin: string
}

export type CambioDeEstado = {
  id: number
  estado_anterior: EstadoProfesor
  estado_nuevo: EstadoProfesor
  motivo: string | null
  fecha: string
  actor: string
}

export type DetalleProfesor = {
  ficha: FichaProfesor
  asignaciones: AsignacionProfesor[]
  horarios: HorarioProfesor[]
  historial: CambioDeEstado[]
}

export type MisAsignaciones = {
  ficha: FichaPropia
  asignaciones: AsignacionProfesor[]
  horarios: HorarioProfesor[]
}

/** Lo que impide inactivar, sin identificadores internos. */
export type BloqueosInactivacion = {
  asignaciones: { materia: string; curso: string; nivel: string }[]
  grupos: { deporte: string; grupo: string; nivel: string }[]
}

export type CampoProfesor = 'legajo_nro' | 'especialidad' | 'estado' | 'motivo'

export type EstadoErrorProfesor = 400 | 401 | 403 | 404 | 409 | 500 | 503

export type RechazoProfesor = {
  estado: EstadoErrorProfesor
  mensaje: string
  campo?: CampoProfesor
  bloqueos?: BloqueosInactivacion
}

export type ResultadoProfesor<T> = ({ ok: true; datos: T }) | ({ ok: false } & RechazoProfesor)

type Operacion =
  | 'listar'
  | 'detalle'
  | 'misAsignaciones'
  | 'actualizarFicha'
  | 'cambiarEstado'

type ErrorPostgres = { code?: string | null; message?: string | null; details?: string | null }

const MENSAJE_GENERICO =
  'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

const MENSAJES_PROHIBIDO: Record<Operacion, string> = {
  listar: 'Solo la dirección puede administrar las fichas de profesores.',
  detalle: 'Solo la dirección puede consultar las fichas de otros profesores.',
  misAsignaciones: 'Solo un docente puede consultar sus propias asignaciones.',
  actualizarFicha: 'Solo la dirección puede modificar las fichas de profesores.',
  cambiarEstado: 'Solo la dirección puede cambiar el estado de un profesor.',
}

const detalleBloqueosSchema = z.object({
  asignaciones: z.array(
    z.object({ materia: z.string(), curso: z.string(), nivel: z.string() }).passthrough()
  ),
  grupos: z.array(
    z.object({ deporte: z.string(), grupo: z.string(), nivel: z.string() }).passthrough()
  ),
})

/** Lee el DETAIL JSON de P5610 y descarta los identificadores internos. */
function leerBloqueos(detalle: string | null | undefined): BloqueosInactivacion | null {
  if (!detalle) return null
  try {
    const leido = detalleBloqueosSchema.safeParse(JSON.parse(detalle))
    if (!leido.success) return null
    return {
      asignaciones: leido.data.asignaciones.map(({ materia, curso, nivel }) => ({ materia, curso, nivel })),
      grupos: leido.data.grupos.map(({ deporte, grupo, nivel }) => ({ deporte, grupo, nivel })),
    }
  } catch {
    return null
  }
}

function mensajeDeBloqueo(bloqueos: BloqueosInactivacion | null): string {
  if (!bloqueos) {
    return 'No se puede inactivar al profesor mientras tenga asignaciones de materias o grupos deportivos activos a su cargo.'
  }
  const partes = [
    ...bloqueos.asignaciones.map(({ materia, curso }) => `la materia ${materia} en ${curso}`),
    ...bloqueos.grupos.map(({ deporte, grupo }) => `el grupo ${grupo} de ${deporte}`),
  ]
  return (
    `No se puede inactivar al profesor: sigue a cargo de ${partes.join(', ')}. ` +
    'Reasigná o inactivá esas relaciones y volvé a intentarlo. No se guardó ningún cambio.'
  )
}

/**
 * Traduce errores de PostgreSQL en resultados estables. Nunca devuelve al
 * navegador el mensaje de la base, un SQLSTATE ni el nombre de un objeto.
 */
function traducirErrorProfesor(error: ErrorPostgres, operacion: Operacion): RechazoProfesor {
  switch (error.code) {
    case 'P5505':
      return { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
    case '42501':
      return { estado: 403, mensaje: MENSAJES_PROHIBIDO[operacion] }
    case 'P5600':
      return {
        estado: 404,
        mensaje:
          operacion === 'misAsignaciones'
            ? 'No encontramos tu ficha de profesor. Avisale a la dirección.'
            : 'El profesor solicitado no existe.',
      }
    case 'P5601':
      return { estado: 400, mensaje: 'Indicá qué profesor querés consultar.' }
    case 'P5602':
      return {
        estado: 400,
        mensaje: 'El número de legajo es obligatorio para completar la ficha.',
        campo: 'legajo_nro',
      }
    case 'P5515':
      return {
        estado: 400,
        mensaje:
          'El número de legajo debe tener entre 1 y 50 caracteres, sin espacios al inicio o al final.',
        campo: 'legajo_nro',
      }
    case '23505':
      // En la ficha, la única unicidad que puede chocar es la del legajo.
      return { estado: 409, mensaje: 'Ya existe un legajo con ese número.', campo: 'legajo_nro' }
    case 'P5603':
      return { estado: 400, mensaje: 'La especialidad es obligatoria.', campo: 'especialidad' }
    case 'P5604':
      return {
        estado: 400,
        mensaje: 'La especialidad debe tener entre 2 y 100 caracteres.',
        campo: 'especialidad',
      }
    case 'P5606':
      return { estado: 400, mensaje: 'Elegí un estado válido: activo o inactivo.', campo: 'estado' }
    case 'P5607':
      return {
        estado: 400,
        mensaje: 'El motivo no puede superar los 500 caracteres.',
        campo: 'motivo',
      }
    case 'P5608':
      return {
        estado: 409,
        mensaje: 'El profesor ya está en ese estado. Actualizá la página para ver su estado actual.',
      }
    case 'P5610': {
      const bloqueos = leerBloqueos(error.details)
      return {
        estado: 409,
        mensaje: mensajeDeBloqueo(bloqueos),
        ...(bloqueos ? { bloqueos } : {}),
      }
    }
    case 'P5611':
      return {
        estado: 409,
        mensaje: 'No se puede reactivar la ficha: la persona ya no tiene el rol DOCENTE.',
      }
    case 'P5612':
      return {
        estado: 409,
        mensaje: 'Para reactivar, completá primero el legajo y la especialidad de la ficha.',
      }
    case '22P02':
      return { estado: 400, mensaje: 'Los datos enviados no son válidos.' }
    case '40P01':
    case '55P03':
    case '57014':
      return {
        estado: 503,
        mensaje: 'Hay otra operación en curso sobre este profesor. Volvé a intentarlo en unos segundos.',
      }
    default:
      console.error('[profesores] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return { estado: 500, mensaje: MENSAJE_GENERICO }
  }
}

// ----------------------------------------------------------------
// Conversión de filas
// ----------------------------------------------------------------

type FilaFicha = FichaResumen & {
  dni?: string
  telefono?: string | null
  direccion?: string | null
  fecha_nacimiento?: string | null
}

function aResumen(fila: FilaFicha): FichaResumen {
  return {
    perfil_id: fila.perfil_id,
    nombre: fila.nombre,
    apellido: fila.apellido,
    legajo_nro: fila.legajo_nro ?? null,
    especialidad: fila.especialidad ?? null,
    estado: fila.estado,
    ficha_completa: fila.ficha_completa,
    rol_docente_vigente: fila.rol_docente_vigente,
    asignaciones_activas: fila.asignaciones_activas ?? 0,
    grupos_activos: fila.grupos_activos ?? 0,
  }
}

function aAsignacion(fila: AsignacionProfesor): AsignacionProfesor {
  return {
    tipo: fila.tipo,
    relacion_id: fila.relacion_id,
    vigente: fila.vigente,
    actividad_nombre: fila.actividad_nombre,
    grupo_nombre: fila.grupo_nombre ?? null,
    curso_denominacion: fila.curso_denominacion ?? null,
    curso_division: fila.curso_division ?? null,
    nivel_nombre: fila.nivel_nombre,
    actividad_activa: fila.actividad_activa,
    curso_activo: fila.curso_activo ?? null,
  }
}

function aHorario(fila: HorarioProfesor): HorarioProfesor {
  return {
    tipo: fila.tipo,
    relacion_id: fila.relacion_id,
    franja_id: fila.franja_id,
    dia_semana: fila.dia_semana,
    hora_inicio: fila.hora_inicio,
    hora_fin: fila.hora_fin,
  }
}

type FilaHistorial = {
  id: number
  estado_anterior: EstadoProfesor
  estado_nuevo: EstadoProfesor
  motivo: string | null
  fecha: string
  actor_nombre: string | null
  actor_apellido: string | null
}

function aCambio(fila: FilaHistorial): CambioDeEstado {
  return {
    id: fila.id,
    estado_anterior: fila.estado_anterior,
    estado_nuevo: fila.estado_nuevo,
    motivo: fila.motivo ?? null,
    fecha: fila.fecha,
    actor: `${fila.actor_nombre ?? ''} ${fila.actor_apellido ?? ''}`.trim() || 'Dirección',
  }
}

// ----------------------------------------------------------------
// Lecturas
// ----------------------------------------------------------------

/** Todas las fichas, activas e inactivas, completas o no (DIRECTOR). */
export async function listarProfesores(): Promise<ResultadoProfesor<FichaResumen[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('listar_profesores')
  if (error) return { ok: false, ...traducirErrorProfesor(error, 'listar') }
  return { ok: true, datos: ((data ?? []) as FilaFicha[]).map(aResumen) }
}

/** Ficha, relaciones, horarios e historial de un profesor (DIRECTOR). */
export async function obtenerDetalleProfesor(
  profesorId: string
): Promise<ResultadoProfesor<DetalleProfesor>> {
  const supabase = await createServerSupabaseClient()
  const argumentos = { p_profesor_id: profesorId }
  const [ficha, asignaciones, horarios, historial] = await Promise.all([
    supabase.rpc('consultar_ficha_profesor', argumentos),
    supabase.rpc('listar_asignaciones_profesor', argumentos),
    supabase.rpc('listar_horarios_profesor', argumentos),
    supabase.rpc('listar_historial_estados_profesor', argumentos),
  ])

  for (const respuesta of [ficha, asignaciones, horarios, historial]) {
    if (respuesta.error) return { ok: false, ...traducirErrorProfesor(respuesta.error, 'detalle') }
  }

  const fila = ((ficha.data ?? []) as FilaFicha[])[0]
  if (!fila) return { ok: false, estado: 404, mensaje: 'El profesor solicitado no existe.' }

  return {
    ok: true,
    datos: {
      ficha: {
        ...aResumen(fila),
        dni: fila.dni ?? '',
        telefono: fila.telefono ?? null,
        direccion: fila.direccion ?? null,
        fecha_nacimiento: fila.fecha_nacimiento ?? null,
      },
      asignaciones: ((asignaciones.data ?? []) as AsignacionProfesor[]).map(aAsignacion),
      horarios: ((horarios.data ?? []) as HorarioProfesor[]).map(aHorario),
      historial: ((historial.data ?? []) as FilaHistorial[]).map(aCambio),
    },
  }
}

/**
 * La ficha, las relaciones y los horarios del docente de la sesión. No recibe
 * identificador: la base resuelve a quién pertenece la sesión.
 */
export async function obtenerMisAsignaciones(): Promise<ResultadoProfesor<MisAsignaciones>> {
  const supabase = await createServerSupabaseClient()
  const [ficha, asignaciones, horarios] = await Promise.all([
    supabase.rpc('consultar_ficha_profesor'),
    supabase.rpc('listar_asignaciones_profesor'),
    supabase.rpc('listar_horarios_profesor'),
  ])

  for (const respuesta of [ficha, asignaciones, horarios]) {
    if (respuesta.error) {
      return { ok: false, ...traducirErrorProfesor(respuesta.error, 'misAsignaciones') }
    }
  }

  const fila = ((ficha.data ?? []) as FilaFicha[])[0]
  if (!fila) {
    return {
      ok: false,
      estado: 404,
      mensaje: 'No encontramos tu ficha de profesor. Avisale a la dirección.',
    }
  }

  const resumen = aResumen(fila)
  return {
    ok: true,
    datos: {
      ficha: {
        perfil_id: resumen.perfil_id,
        nombre: resumen.nombre,
        apellido: resumen.apellido,
        legajo_nro: resumen.legajo_nro,
        especialidad: resumen.especialidad,
        estado: resumen.estado,
        ficha_completa: resumen.ficha_completa,
      },
      asignaciones: ((asignaciones.data ?? []) as AsignacionProfesor[]).map(aAsignacion),
      horarios: ((horarios.data ?? []) as HorarioProfesor[]).map(aHorario),
    },
  }
}

// ----------------------------------------------------------------
// Escrituras (DIRECTOR)
// ----------------------------------------------------------------

type FichaGuardada = { perfil_id: string; especialidad: string | null; estado: EstadoProfesor }

function exigirFila(datos: unknown, mensaje: string): ResultadoProfesor<FichaGuardada> {
  const fila = datos as FichaGuardada | null
  if (!fila?.perfil_id) return { ok: false, estado: 500, mensaje }
  return {
    ok: true,
    datos: { perfil_id: fila.perfil_id, especialidad: fila.especialidad ?? null, estado: fila.estado },
  }
}

export async function actualizarFichaProfesor(
  profesorId: string,
  legajo: string,
  especialidad: string
): Promise<ResultadoProfesor<FichaGuardada>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('actualizar_ficha_profesor', {
    p_profesor_id: profesorId,
    p_legajo_nro: legajo,
    p_especialidad: especialidad,
  })
  if (error) return { ok: false, ...traducirErrorProfesor(error, 'actualizarFicha') }
  return exigirFila(data, 'No pudimos confirmar el cambio de la ficha. Verificá el listado antes de reintentar.')
}

export async function cambiarEstadoProfesor(
  profesorId: string,
  estado: EstadoProfesor,
  motivo: string | null
): Promise<ResultadoProfesor<FichaGuardada>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cambiar_estado_profesor', {
    p_profesor_id: profesorId,
    p_estado: estado,
    p_motivo: motivo,
  })
  if (error) return { ok: false, ...traducirErrorProfesor(error, 'cambiarEstado') }
  return exigirFila(data, 'No pudimos confirmar el cambio de estado. Verificá el listado antes de reintentar.')
}
