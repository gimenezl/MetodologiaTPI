import { createServerSupabaseClient } from '@/services/supabase.server'
import {
  agruparTarifas,
  esFechaIsoReal,
  esImporteCanonico,
  hoyEnArgentina,
  referenciaDe,
  type ActualizarTarifaData,
  type CambiarTarifaData,
  type CampoTarifa,
  type CatalogoReferencia,
  type ConceptoTarifa,
  type CrearTarifaData,
  type FilaTarifa,
  type GrupoTarifas,
  type ReferenciaTarifa,
  type VersionTarifa,
} from '@/lib/tarifas'

/**
 * Administración de tarifas mensuales por Dirección (EPT-103), ligada a la
 * sesión real de Supabase.
 *
 * Solo servidor: `createServerSupabaseClient` importa `next/headers`, así que
 * importar este módulo desde un componente cliente rompe la compilación.
 *
 * Autoridad. Nunca usa `service_role`. Las lecturas atraviesan RLS (solo un
 * DIRECTOR habilitado lee `tarifas`, EPT-101). Las escrituras pasan por las
 * RPC `crear_tarifa`, `cambiar_tarifa` y `actualizar_tarifa`, que derivan la
 * identidad de `auth.uid()` y vuelven a exigir el rol y el bloqueo vigentes
 * dentro de PostgreSQL: ninguna función de este módulo acepta un actor, un rol
 * ni un usuario como parámetro. No existe borrado físico.
 *
 * Dinero. El importe viaja siempre como texto decimal exacto, en las dos
 * direcciones: se lee con `importe::text` y se envía como texto que la base
 * valida antes del cast con escala. Ningún importe se convierte a `number`.
 */

export type EstadoErrorTarifas = 400 | 401 | 403 | 404 | 409 | 500

/** Código de dominio que acompaña a un error para que la pantalla reaccione. */
export type CodigoErrorTarifas = 'CONFLICTO_EDICION' | 'SUPERPOSICION' | 'TARIFA_INEXISTENTE'

export type ResultadoTarifas<T> =
  | { ok: true; datos: T }
  | {
      ok: false
      estado: EstadoErrorTarifas
      mensaje: string
      campo?: CampoTarifa
      codigo?: CodigoErrorTarifas
    }

type ErrorPostgres = { code?: string | null; message?: string | null }

type Operacion = 'leer' | 'crear' | 'cambiar' | 'actualizar'

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'

const MENSAJE_SOLO_DIRECCION = 'Solo Dirección puede administrar las tarifas.'

/**
 * Traduce errores de PostgreSQL en resultados estables, sin devolver al
 * navegador detalles internos: ni SQLSTATE, ni nombres de restricciones, ni
 * consultas. Los mensajes son propios; nunca se reenvía el de la base.
 */
function traducirError(
  error: ErrorPostgres,
  operacion: Operacion
): Extract<ResultadoTarifas<never>, { ok: false }> {
  const falla = (
    estado: EstadoErrorTarifas,
    mensaje: string,
    campo?: CampoTarifa,
    codigo?: CodigoErrorTarifas
  ) => ({ ok: false as const, estado, mensaje, campo, codigo })

  switch (error.code) {
    case 'P6810':
      return falla(
        400,
        'El importe tiene un formato no soportado. Usá solo dígitos y una coma o un punto para los decimales, por ejemplo 1234,50.',
        'importe'
      )
    case 'P6811':
      return falla(400, 'El importe no puede ser negativo.', 'importe')
    case 'P6812':
      return falla(400, 'El importe admite como máximo dos decimales.', 'importe')
    case 'P6813':
      return falla(400, 'El importe supera el máximo permitido (9999999999,99).', 'importe')
    case 'P6820':
      return falla(400, 'Indicá desde qué fecha rige la tarifa.', 'desde')
    case 'P6821':
      return falla(
        400,
        'Las fechas de vigencia deben ser fechas reales. Para una tarifa sin fin, dejá «hasta» vacío.',
        'hasta'
      )
    case 'P6822':
      return falla(400, 'La fecha de fin no puede ser anterior a la de inicio.', 'hasta')
    case 'P6823':
    case 'P6801':
      return falla(400, 'La referencia elegida no corresponde al concepto de la tarifa.', 'referencia_id')
    case 'P6824':
    case '23503':
      return falla(404, 'La referencia elegida ya no existe. Recargá la pantalla.', 'referencia_id')
    case 'P6830':
      return falla(
        409,
        'Esas fechas se superponen con otra versión de la tarifa para la misma referencia. Ajustá el inicio o el fin: cada día debe tener una sola tarifa.',
        // Solo el alta puede atribuirlo con certeza al inicio; en un cambio o una edición
        // la causa puede ser el fin, y el mensaje ya nombra los dos.
        operacion === 'crear' ? 'desde' : undefined,
        'SUPERPOSICION'
      )
    case 'P6831':
      return falla(
        409,
        'Otra persona modificó esta tarifa mientras la editabas. No se guardó nada: recargá los datos y revisá los valores actuales antes de volver a intentarlo.',
        undefined,
        'CONFLICTO_EDICION'
      )
    case 'P6832':
      return falla(404, 'La tarifa ya no existe. Recargá la pantalla.', undefined, 'TARIFA_INEXISTENTE')
    case 'P6833':
      return falla(
        409,
        'El cambio dejaría sin tarifa un tramo que hoy está cubierto. Dejá «hasta» vacío o usá una fecha igual o posterior al fin de la tarifa vigente.',
        'hasta'
      )
    case '22007':
    case '22008':
    case '22P02':
    case '23514':
      return falla(400, 'Los datos enviados no son válidos.')
    case 'P5505':
      return falla(401, 'Necesitás iniciar sesión para continuar.')
    case '42501':
      return falla(403, MENSAJE_SOLO_DIRECCION)
    default:
      console.error('[tarifas] error inesperado de la base', {
        operacion,
        code: error.code,
        message: error.message,
      })
      return falla(500, MENSAJE_GENERICO)
  }
}

// ----------------------------------------------------------------
// Proyección de las respuestas de la base
// ----------------------------------------------------------------

function proyectarVersion(valor: unknown): VersionTarifa | null {
  if (typeof valor !== 'object' || valor === null) return null
  const fila = valor as Record<string, unknown>
  const hasta = fila.hasta ?? null
  if (
    typeof fila.id !== 'string' ||
    !esImporteCanonico(fila.importe) ||
    !esFechaIsoReal(fila.desde) ||
    !(hasta === null || esFechaIsoReal(hasta))
  ) {
    return null
  }
  return { id: fila.id, importe: fila.importe, desde: fila.desde, hasta }
}

const SIN_CONFIRMAR =
  'No pudimos confirmar el resultado. Revisá el historial de la tarifa antes de volver a intentarlo.'

/** Una escritura cuya respuesta no se puede leer no es un éxito confirmado. */
function sinConfirmar(): Extract<ResultadoTarifas<never>, { ok: false }> {
  return { ok: false, estado: 500, mensaje: SIN_CONFIRMAR }
}

/**
 * Las referencias que la base distingue por NULL. La firma generada las declara
 * obligatorias y no nulas porque PostgreSQL no tiene valores por defecto en ellas;
 * la operación valida que exista exactamente la que corresponde al concepto.
 */
function argumentosReferencia(referencia: ReferenciaTarifa) {
  return {
    p_nivel_id: referencia.nivel_id,
    p_deporte_id: referencia.deporte_id,
    p_servicio_id: referencia.servicio_id,
  } as unknown as { p_nivel_id: number; p_deporte_id: string; p_servicio_id: string }
}

// ----------------------------------------------------------------
// Lectura
// ----------------------------------------------------------------

export type PanelTarifas = {
  grupos: GrupoTarifas[]
  /** Día de la lectura en Argentina (`AAAA-MM-DD`), para marcar la versión vigente. */
  hoy: string
}

type FilaTarifaCruda = {
  id: string
  concepto: ConceptoTarifa
  nivel_id: number | null
  deporte_id: string | null
  servicio_id: string | null
  importe_texto: string
  desde: string
  hasta: string | null
}

const COLUMNAS_TARIFA =
  'id, concepto, nivel_id, deporte_id, servicio_id, importe_texto:importe::text, desde, hasta'

/**
 * Todas las versiones de tarifa y el catálogo al que referencian, para
 * Dirección. No recibe filtros: RLS decide (un perfil que no sea DIRECTOR
 * habilitado obtiene cero filas, no un error que delate nada).
 *
 * Una lectura parcial no es una lista vacía: si cualquiera de las cuatro
 * consultas falla, o si el servicio recortó las filas, se informa el error en
 * lugar de mostrar tarifas faltantes como si no existieran.
 */
export async function obtenerPanelTarifas(): Promise<ResultadoTarifas<PanelTarifas>> {
  const supabase = await createServerSupabaseClient()

  const [tarifas, niveles, deportes, servicios] = await Promise.all([
    supabase
      .from('tarifas')
      .select(COLUMNAS_TARIFA, { count: 'exact' })
      .order('desde', { ascending: false }),
    supabase.from('niveles').select('id, nombre, activo').order('orden', { ascending: true }),
    supabase.from('deportes').select('id, nombre, activo').order('nombre', { ascending: true }),
    supabase
      .from('servicios_escolares')
      .select('id, tipo, codigo, nombre, activo')
      .order('codigo', { ascending: true }),
  ])

  const fallo = tarifas.error ?? niveles.error ?? deportes.error ?? servicios.error
  if (fallo) return traducirError(fallo, 'leer')

  const filas = (tarifas.data ?? []) as unknown as FilaTarifaCruda[]
  if (typeof tarifas.count === 'number' && tarifas.count > filas.length) {
    console.error('[tarifas] lectura recortada por el servicio', {
      recibidas: filas.length,
      total: tarifas.count,
    })
    return {
      ok: false,
      estado: 500,
      mensaje: 'Hay más tarifas de las que se pueden mostrar juntas. Avisale al equipo técnico.',
    }
  }

  const tarifasProyectadas: FilaTarifa[] = []
  for (const fila of filas) {
    const referencia =
      fila.concepto === 'CUOTA'
        ? fila.nivel_id === null
          ? null
          : String(fila.nivel_id)
        : fila.concepto === 'DEPORTE'
          ? fila.deporte_id
          : fila.servicio_id
    if (referencia === null || !esImporteCanonico(fila.importe_texto)) {
      console.error('[tarifas] fila con forma inesperada', { id: fila.id })
      return { ok: false, estado: 500, mensaje: MENSAJE_GENERICO }
    }
    tarifasProyectadas.push({
      id: fila.id,
      concepto: fila.concepto,
      referencia_id: referencia,
      importe: fila.importe_texto,
      desde: fila.desde,
      hasta: fila.hasta,
    })
  }

  const serviciosCrudos = (servicios.data ?? []) as Array<{
    id: string
    tipo: string
    codigo: string
    nombre: string
    activo: boolean
  }>
  const delTipo = (tipo: 'TRANSPORTE' | 'COMEDOR'): CatalogoReferencia[] =>
    serviciosCrudos
      .filter((s) => s.tipo === tipo)
      .map((s) => ({ referencia_id: s.id, nombre: s.nombre, detalle: s.codigo, activa: s.activo }))

  const grupos = agruparTarifas(
    {
      CUOTA: (niveles.data ?? []).map((n) => ({
        referencia_id: String(n.id),
        nombre: n.nombre,
        detalle: null,
        activa: n.activo,
      })),
      DEPORTE: (deportes.data ?? []).map((d) => ({
        referencia_id: d.id,
        nombre: d.nombre,
        detalle: null,
        activa: d.activo,
      })),
      TRANSPORTE: delTipo('TRANSPORTE'),
      COMEDOR: delTipo('COMEDOR'),
    },
    tarifasProyectadas
  )

  return { ok: true, datos: { grupos, hoy: hoyEnArgentina() } }
}

// ----------------------------------------------------------------
// Escritura
// ----------------------------------------------------------------

/** Alta de una versión de tarifa. Estricta: una superposición se rechaza. */
export async function crearTarifa(datos: CrearTarifaData): Promise<ResultadoTarifas<VersionTarifa>> {
  const referencia = referenciaDe(datos.concepto, datos.referencia_id)
  if (!referencia) {
    return { ok: false, estado: 400, mensaje: 'Elegí la referencia de la tarifa.', campo: 'referencia_id' }
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('crear_tarifa', {
    p_concepto: datos.concepto,
    ...argumentosReferencia(referencia),
    p_importe: datos.importe,
    p_desde: datos.desde,
    p_hasta: datos.hasta as string,
  })
  if (error) return traducirError(error, 'crear')

  const version = proyectarVersion(data)
  return version ? { ok: true, datos: version } : sinConfirmar()
}

export type CambioDePrecio = {
  /** Versión que estaba vigente el día anterior, ya con su fin ajustado; `null` si no había. */
  anterior: VersionTarifa | null
  nueva: VersionTarifa
}

/**
 * «El día D el precio pasa a X»: la base cierra la versión vigente el día
 * anterior e inserta la nueva en una sola transacción. Un rechazo no deja nada
 * persistido.
 */
export async function cambiarTarifa(
  datos: CambiarTarifaData
): Promise<ResultadoTarifas<CambioDePrecio>> {
  const referencia = referenciaDe(datos.concepto, datos.referencia_id)
  if (!referencia) {
    return { ok: false, estado: 400, mensaje: 'Elegí la referencia de la tarifa.', campo: 'referencia_id' }
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cambiar_tarifa', {
    p_concepto: datos.concepto,
    ...argumentosReferencia(referencia),
    p_importe: datos.importe,
    p_desde: datos.desde,
    p_hasta: datos.hasta as string,
  })
  if (error) return traducirError(error, 'cambiar')

  const respuesta = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const nueva = proyectarVersion(respuesta.nueva)
  const anterior = respuesta.anterior == null ? null : proyectarVersion(respuesta.anterior)
  if (!nueva || (respuesta.anterior != null && !anterior)) return sinConfirmar()
  return { ok: true, datos: { anterior, nueva } }
}

/**
 * Corrección del importe y la vigencia de una versión existente. Concepto y
 * referencia no se pueden cambiar. Los valores previos son los que vio la
 * persona: si otra cambió la tarifa en el medio, no se sobrescribe (409).
 */
export async function actualizarTarifa(
  tarifaId: string,
  datos: ActualizarTarifaData
): Promise<ResultadoTarifas<VersionTarifa>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('actualizar_tarifa', {
    p_tarifa_id: tarifaId,
    p_importe: datos.importe,
    p_desde: datos.desde,
    p_hasta: datos.hasta as string,
    p_importe_previo: datos.previo.importe,
    p_desde_previo: datos.previo.desde,
    p_hasta_previo: datos.previo.hasta as string,
  })
  if (error) return traducirError(error, 'actualizar')

  const version = proyectarVersion(data)
  return version ? { ok: true, datos: version } : sinConfirmar()
}
