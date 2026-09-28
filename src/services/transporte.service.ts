import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Acceso a los recorridos de transporte y a sus inscripciones, ligado a la
 * sesión real de Supabase (EPT-60).
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Reutiliza el catálogo y la inscripción de EPT-10 (013): los cuatro
 * recorridos son filas de `servicios_escolares` con `tipo = 'TRANSPORTE'`, y
 * no existe una segunda tabla de inscripciones paralela. Nunca usa
 * `service_role`. Las lecturas atraviesan vistas `security_invoker`, que
 * respetan RLS: el estudiante obtiene solo lo suyo y Dirección todo. Las
 * escrituras atraviesan los envoltorios públicos, que revalidan `auth.uid()`
 * y el rol dentro de PostgreSQL y derivan el alumno de la sesión.
 *
 * Ninguna función de este módulo acepta un alumno, un perfil, un usuario ni un
 * legajo como parámetro, y no existe ninguna operación de borrado físico.
 */

/** Códigos estables de los cuatro recorridos, sembrados por la migración de EPT-60. */
export const CODIGOS_RECORRIDO = ['TR-NORTE', 'TR-SUR', 'TR-ESTE', 'TR-OESTE'] as const

/** Una parada ordenada de un recorrido. */
export type ParadaRecorrido = { orden: number; nombre: string }

/** Un recorrido de transporte con sus paradas ficticias ordenadas. */
export type Recorrido = {
  id: string
  codigo: string
  nombre: string
  activo: boolean
  paradas: ParadaRecorrido[]
}

/** Una inscripción de transporte con el alumno y el recorrido ya resueltos. */
export type InscripcionTransporte = {
  id: string
  alumno_id: string
  alumno_nombre: string
  alumno_apellido: string
  legajo_nro: string | null
  alumno_estado: 'ACTIVO' | 'INACTIVO'
  servicio_id: string
  servicio_codigo: string
  servicio_nombre: string
  estado: 'ACTIVA' | 'CANCELADA'
  fecha_inscripcion: string
  fecha_cancelacion: string | null
}

export type CampoTransporte = 'servicio_id' | 'nombre' | 'activo'

export type EstadoErrorTransporte = 400 | 401 | 403 | 404 | 409 | 500

export type ResultadoTransporte<T> =
  | { ok: true; datos: T }
  | { ok: false; estado: EstadoErrorTransporte; mensaje: string; campo?: CampoTransporte }

/** SQLSTATE que este dominio traduce de forma estable. */
const SQLSTATE_CLAVE_FORANEA = '23503'
const SQLSTATE_CHECK = '23514'
const SQLSTATE_ENTRADA_INVALIDA = '22P02'
const SQLSTATE_PRIVILEGIO_INSUFICIENTE = '42501'
const SQLSTATE_IDENTIDAD_AUSENTE = 'P5505'
const SQLSTATE_SERVICIO_INEXISTENTE = 'P5550'
const SQLSTATE_SERVICIO_INACTIVO = 'P5551'
const SQLSTATE_SIN_LEGAJO_ACADEMICO = 'P5552'
const SQLSTATE_ALUMNO_NO_ACTIVO = 'P5553'
const SQLSTATE_ALUMNO_SIN_LEGAJO = 'P5554'
const SQLSTATE_INSCRIPCION_INEXISTENTE = 'P5555'
const SQLSTATE_INSCRIPCION_YA_CANCELADA = 'P5556'
const SQLSTATE_IDENTIDAD_PROTEGIDA = 'P5557'
const SQLSTATE_TRANSICION_INVALIDA = 'P5558'
const SQLSTATE_OPERACION_EXCLUSIVA_TRANSPORTE = 'P5960'
const SQLSTATE_YA_TIENE_RECORRIDO_ACTIVO = 'P5961'

const MENSAJE_GENERICO =
  'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

/**
 * Una inscripción ajena, inexistente o de otro tipo de servicio (comedor)
 * responden todas lo mismo: no se delata cuál de las tres es.
 */
const MENSAJE_INSCRIPCION_TRANSPORTE_INEXISTENTE =
  'No encontramos una inscripción de transporte activa tuya para cancelar.'

const COLUMNAS_RECORRIDO = 'id, codigo, nombre, activo, paradas'

const COLUMNAS_INSCRIPCION =
  'id, alumno_id, alumno_nombre, alumno_apellido, legajo_nro, alumno_estado, ' +
  'servicio_id, servicio_codigo, servicio_nombre, estado, ' +
  'fecha_inscripcion, fecha_cancelacion'

type Operacion =
  | 'listarRecorridos'
  | 'listarInscripciones'
  | 'establecerRecorrido'
  | 'cancelarInscripcion'
  | 'actualizarRecorrido'

type ErrorPostgres = { code?: string | null; message?: string | null }

/**
 * Traduce errores de PostgreSQL en resultados estables, sin devolver al
 * navegador detalles internos, nombres de restricciones, consultas ni SQLSTATE.
 */
function traducirErrorTransporte(
  error: ErrorPostgres,
  operacion: Operacion
): { estado: EstadoErrorTransporte; mensaje: string; campo?: CampoTransporte } {
  switch (error.code) {
    case SQLSTATE_SERVICIO_INEXISTENTE:
    case SQLSTATE_CLAVE_FORANEA:
      return { estado: 404, mensaje: 'El recorrido solicitado no existe.', campo: 'servicio_id' }
    case SQLSTATE_SERVICIO_INACTIVO:
      return {
        estado: 409,
        mensaje: 'Ese recorrido no está disponible para nuevas inscripciones.',
        campo: 'servicio_id',
      }
    case SQLSTATE_OPERACION_EXCLUSIVA_TRANSPORTE:
      return { estado: 400, mensaje: 'Los datos enviados no son válidos.' }
    case SQLSTATE_YA_TIENE_RECORRIDO_ACTIVO:
      // En uso normal no debería ocurrir: `establecer_recorrido_transporte`
      // cancela el anterior y activa el nuevo en una sola operación atómica.
      // Solo aparece ante una carrera extrema; se traduce igual que un
      // conflicto de estado para que la pantalla pueda pedir un reintento.
      return {
        estado: 409,
        mensaje: 'Ya tenés un recorrido de transporte activo. Volvé a intentarlo.',
        campo: 'servicio_id',
      }
    case SQLSTATE_SIN_LEGAJO_ACADEMICO:
      return {
        estado: 409,
        mensaje:
          'Todavía no tenés un legajo académico. Comunicate con la administración del centro educativo.',
      }
    case SQLSTATE_ALUMNO_NO_ACTIVO:
      return {
        estado: 409,
        mensaje:
          'Tu legajo académico no está activo, así que no podés usar el transporte. Comunicate con la administración del centro educativo.',
      }
    case SQLSTATE_ALUMNO_SIN_LEGAJO:
      return {
        estado: 409,
        mensaje:
          'Tu legajo académico no tiene número asignado. Comunicate con la administración del centro educativo.',
      }
    case SQLSTATE_INSCRIPCION_INEXISTENTE:
      // Una inscripción ajena y una inexistente devuelven exactamente lo mismo:
      // no se delata que la de otra persona exista.
      return { estado: 404, mensaje: MENSAJE_INSCRIPCION_TRANSPORTE_INEXISTENTE }
    case SQLSTATE_INSCRIPCION_YA_CANCELADA:
      return { estado: 409, mensaje: 'Esa inscripción ya estaba cancelada.' }
    case SQLSTATE_IDENTIDAD_PROTEGIDA:
    case SQLSTATE_TRANSICION_INVALIDA:
      return {
        estado: 409,
        mensaje: 'Esa operación no está permitida sobre un recorrido o una inscripción existente.',
      }
    case SQLSTATE_CHECK:
    case SQLSTATE_ENTRADA_INVALIDA:
      return { estado: 400, mensaje: 'Los datos enviados no son válidos.' }
    case SQLSTATE_IDENTIDAD_AUSENTE:
      return { estado: 401, mensaje: 'Necesitás iniciar sesión para continuar.' }
    case SQLSTATE_PRIVILEGIO_INSUFICIENTE:
      return {
        estado: 403,
        mensaje:
          operacion === 'actualizarRecorrido'
            ? 'Solo Dirección puede administrar los recorridos de transporte.'
            : 'Solo un estudiante puede administrar su recorrido de transporte.',
      }
    default:
      console.error('[transporte] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return { estado: 500, mensaje: MENSAJE_GENERICO }
  }
}

/** Una escritura sin fila devuelta no es un éxito confirmado. */
function exigirFila<T>(
  datos: T | null | undefined,
  mensaje: string
): ResultadoTransporte<T> {
  if (!datos) {
    return { ok: false, estado: 500, mensaje }
  }
  return { ok: true, datos }
}

type FilaRecorrido = {
  id: string | null
  codigo: string | null
  nombre: string | null
  activo: boolean | null
  paradas: unknown
}

/** Proyecta la fila cruda de la vista, incluida la desagregación de `paradas`. */
function proyectarRecorrido(fila: FilaRecorrido): Recorrido {
  const paradas = Array.isArray(fila.paradas)
    ? fila.paradas.filter(
        (parada): parada is ParadaRecorrido =>
          typeof parada === 'object' &&
          parada !== null &&
          typeof (parada as ParadaRecorrido).orden === 'number' &&
          typeof (parada as ParadaRecorrido).nombre === 'string'
      )
    : []

  return {
    id: fila.id ?? '',
    codigo: fila.codigo ?? '',
    nombre: fila.nombre ?? '',
    activo: fila.activo ?? false,
    paradas,
  }
}

// ----------------------------------------------------------------
// Lecturas
// ----------------------------------------------------------------

/**
 * Los cuatro recorridos del catálogo, con sus paradas ficticias ordenadas.
 *
 * Institucional y sin datos personales: visible para cualquier sesión
 * autenticada no bloqueada, igual que el resto del catálogo de servicios
 * escolares.
 */
export async function listarRecorridos(): Promise<ResultadoTransporte<Recorrido[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('recorridos_transporte')
    .select(COLUMNAS_RECORRIDO)
    .order('codigo', { ascending: true })

  if (error) return { ok: false, ...traducirErrorTransporte(error, 'listarRecorridos') }
  return { ok: true, datos: ((data ?? []) as unknown as FilaRecorrido[]).map(proyectarRecorrido) }
}

/**
 * Inscripciones de transporte visibles para la sesión actual, incluidas las
 * canceladas.
 *
 * No recibe ni filtra por alumno: RLS decide. Un estudiante obtiene su propio
 * historial; Dirección, el listado administrativo completo de los cuatro
 * recorridos. Por eso la misma función sirve a las dos pantallas.
 */
export async function listarInscripcionesTransporte(): Promise<
  ResultadoTransporte<InscripcionTransporte[]>
> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('inscripciones_servicios_detalle')
    .select(COLUMNAS_INSCRIPCION)
    .eq('servicio_tipo', 'TRANSPORTE')
    .order('fecha_inscripcion', { ascending: false })

  if (error) return { ok: false, ...traducirErrorTransporte(error, 'listarInscripciones') }
  return { ok: true, datos: (data ?? []) as unknown as InscripcionTransporte[] }
}

// ----------------------------------------------------------------
// Escrituras
// ----------------------------------------------------------------

/**
 * Alta o cambio del recorrido del alumno de la sesión, en una sola operación
 * atómica.
 *
 * El único parámetro es el recorrido destino. El alumno lo deriva PostgreSQL
 * de `auth.uid()`. Si el alumno no tenía ningún recorrido activo, esto es un
 * alta; si ya tenía otro, PostgreSQL cancela el anterior e instala el nuevo
 * dentro de la misma función, de modo que un fallo del destino nunca deja al
 * alumno sin el recorrido que ya tenía. Cambiar al recorrido que ya está
 * activo es idempotente: no crea una fila ni cancela nada.
 */
export async function establecerRecorridoTransporte(
  servicioId: string
): Promise<ResultadoTransporte<{ id: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('establecer_recorrido_transporte', {
    p_servicio_id: servicioId,
  })

  if (error) return { ok: false, ...traducirErrorTransporte(error, 'establecerRecorrido') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar tu recorrido. Revisá tu estado antes de reintentar.'
  )
}

/**
 * Baja lógica de la inscripción de transporte propia, sin reemplazo. No
 * elimina ninguna fila: registra la cancelación y conserva el ciclo en el
 * historial.
 *
 * Reutiliza la RPC genérica `cancelar_inscripcion_servicio` de 013, que no
 * distingue tipo de servicio: solo exige que la inscripción sea propia y
 * esté activa. Por eso, ANTES de invocarla, esta función verifica que el
 * identificador corresponda a una inscripción de tipo TRANSPORTE — si no,
 * responde igual que si no existiera, sin llegar a tocar la RPC genérica.
 * Sin este paso, esta ruta podría cancelar por acá una inscripción de
 * comedor propia, porque la RPC compartida no sabe distinguir dominios. La
 * lectura usa la vista `inscripciones_servicios_detalle`, que ya es
 * `security_invoker`: RLS la limita a las filas propias del alumno, así que
 * la comprobación de tipo no amplía ni reduce a quién pertenece la fila.
 */
export async function cancelarInscripcionTransporte(
  inscripcionId: string
): Promise<ResultadoTransporte<{ id: string }>> {
  const supabase = await createServerSupabaseClient()

  const { data: propia, error: errorLectura } = await supabase
    .from('inscripciones_servicios_detalle')
    .select('id')
    .eq('id', inscripcionId)
    .eq('servicio_tipo', 'TRANSPORTE')
    .eq('estado', 'ACTIVA')
    .maybeSingle()

  if (errorLectura) {
    return { ok: false, ...traducirErrorTransporte(errorLectura, 'cancelarInscripcion') }
  }
  if (!propia) {
    return { ok: false, estado: 404, mensaje: MENSAJE_INSCRIPCION_TRANSPORTE_INEXISTENTE }
  }

  const { data, error } = await supabase.rpc('cancelar_inscripcion_servicio', {
    p_inscripcion_id: inscripcionId,
  })

  if (error) return { ok: false, ...traducirErrorTransporte(error, 'cancelarInscripcion') }
  return exigirFila(
    data as { id: string } | null,
    'No pudimos confirmar la baja. Revisá tu estado antes de reintentar.'
  )
}

/**
 * Mantenimiento descriptivo de un recorrido por Dirección: nombre y estado
 * activo/inactivo. El código y el tipo no se pueden editar por esta vía: son
 * inmutables en la base en cuanto el recorrido tiene alguna inscripción.
 */
export async function actualizarRecorrido(
  servicioId: string,
  nombre: string,
  activo: boolean
): Promise<ResultadoTransporte<Recorrido>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('actualizar_recorrido', {
    p_servicio_id: servicioId,
    p_nombre: nombre,
    p_activo: activo,
  })

  if (error) return { ok: false, ...traducirErrorTransporte(error, 'actualizarRecorrido') }
  const fila = data as { id: string; codigo: string; nombre: string; activo: boolean } | null
  if (!fila) {
    return {
      ok: false,
      estado: 500,
      mensaje: 'No pudimos confirmar los cambios. Revisá el recorrido antes de reintentar.',
    }
  }
  return { ok: true, datos: { ...fila, paradas: [] } }
}
