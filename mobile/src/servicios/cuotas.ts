import type { ClienteEPT } from '@/servicios/supabase'

/**
 * Consulta de cuotas (EPT-107). El servidor calcula total, pagado, saldo, estado y fecha de corte
 * (vistas `security_invoker`, RLS del actor); el dispositivo solo valida y presenta. Los importes
 * llegan en centavos enteros: no hay coma flotante en el recorrido.
 */

export type EstadoCuota = 'PENDIENTE' | 'PAGO_PARCIAL' | 'PAGADA' | 'VENCIDA'
export type ConceptoItem = 'CUOTA' | 'DEPORTE' | 'TRANSPORTE' | 'COMEDOR'
export type EstadoPagoItem = 'PENDIENTE' | 'EN_VERIFICACION' | 'PAGADO'

export interface Cuota {
  facturaId: string
  alumnoId: string
  /** Primer día del mes calendario, `AAAA-MM-DD`. */
  periodo: string
  /** Día 10 del período, `AAAA-MM-DD`. */
  vencimiento: string
  totalCentavos: number
  pagadoCentavos: number
  saldoCentavos: number
  estado: EstadoCuota
  itemsEnVerificacion: number
  /** El histórico no cierra (suma de ítems, imputaciones parciales o sobrepago). No se oculta. */
  inconsistente: boolean
  /** Fecha de Buenos Aires del servidor con la que se evaluó el vencimiento. */
  fechaCorte: string
}

export interface ItemCuota {
  itemId: string
  tipo: ConceptoItem
  importeCentavos: number
  pagadoCentavos: number
  estadoPago: EstadoPagoItem
}

export interface DetalleCuota {
  cuota: Cuota
  items: ItemCuota[]
}

export class ErrorConsultaCuotas extends Error {
  constructor(mensaje: string, readonly causaTecnica?: unknown) {
    super(mensaje)
    this.name = 'ErrorConsultaCuotas'
  }
}

const ESTADOS: ReadonlySet<string> = new Set<EstadoCuota>(['PENDIENTE', 'PAGO_PARCIAL', 'PAGADA', 'VENCIDA'])
const CONCEPTOS: ReadonlySet<string> = new Set<ConceptoItem>(['CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR'])
const ESTADOS_ITEM: ReadonlySet<string> = new Set<EstadoPagoItem>(['PENDIENTE', 'EN_VERIFICACION', 'PAGADO'])
const FECHA = /^\d{4}-\d{2}-\d{2}$/u

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) throw new ErrorConsultaCuotas(`Respuesta inválida: ${campo}.`)
  return valor
}

function fecha(valor: unknown, campo: string): string {
  const t = texto(valor, campo)
  if (!FECHA.test(t)) throw new ErrorConsultaCuotas(`Respuesta inválida: ${campo}.`)
  return t
}

/** Centavos enteros y seguros. Rechaza decimales, NaN y valores fuera del rango exacto de JavaScript. */
export function centavosExactos(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) {
    throw new ErrorConsultaCuotas(`Respuesta inválida: importe ${campo}.`)
  }
  return valor
}

function entero(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0) {
    throw new ErrorConsultaCuotas(`Respuesta inválida: ${campo}.`)
  }
  return valor
}

type Fila = Record<string, unknown>

export function analizarCuota(fila: Fila): Cuota {
  const estado = texto(fila.estado, 'estado')
  if (!ESTADOS.has(estado)) throw new ErrorConsultaCuotas('Respuesta inválida: estado desconocido.')
  if (typeof fila.inconsistente !== 'boolean') throw new ErrorConsultaCuotas('Respuesta inválida: inconsistente.')
  return {
    facturaId: texto(fila.factura_id, 'factura'),
    alumnoId: texto(fila.alumno_id, 'alumno'),
    periodo: fecha(fila.periodo, 'período'),
    vencimiento: fecha(fila.vencimiento, 'vencimiento'),
    totalCentavos: centavosExactos(fila.total_centavos, 'total'),
    pagadoCentavos: centavosExactos(fila.pagado_centavos, 'pagado'),
    saldoCentavos: centavosExactos(fila.saldo_centavos, 'saldo'),
    estado: estado as EstadoCuota,
    itemsEnVerificacion: entero(fila.items_en_verificacion, 'ítems en verificación'),
    inconsistente: fila.inconsistente,
    fechaCorte: fecha(fila.fecha_corte, 'fecha de corte'),
  }
}

export function analizarItem(fila: Fila): ItemCuota & { alumnoId: string; facturaId: string } {
  const tipo = texto(fila.tipo, 'concepto')
  const estadoPago = texto(fila.estado_pago, 'estado del ítem')
  if (!CONCEPTOS.has(tipo) || !ESTADOS_ITEM.has(estadoPago)) throw new ErrorConsultaCuotas('Respuesta inválida: ítem.')
  return {
    itemId: texto(fila.item_id, 'ítem'),
    alumnoId: texto(fila.alumno_id, 'alumno del ítem'),
    facturaId: texto(fila.factura_id, 'factura del ítem'),
    tipo: tipo as ConceptoItem,
    importeCentavos: centavosExactos(fila.importe_centavos, 'del ítem'),
    pagadoCentavos: centavosExactos(fila.pagado_centavos, 'imputado'),
    estadoPago: estadoPago as EstadoPagoItem,
  }
}

const COLUMNAS_CUOTA =
  'factura_id,alumno_id,periodo,vencimiento,total_centavos,pagado_centavos,saldo_centavos,estado,items_en_verificacion,inconsistente,fecha_corte'
const COLUMNAS_ITEM = 'item_id,factura_id,alumno_id,tipo,importe_centavos,pagado_centavos,estado_pago'
const MENSAJE_RED = 'No pudimos consultar las cuotas. Revisá tu conexión e intentá nuevamente.'

/** Cuotas de UN alumno, más recientes primero. Un identificador ajeno devuelve una lista vacía por RLS. */
export async function consultarCuotas(cliente: ClienteEPT, alumnoId: string, senal?: AbortSignal): Promise<Cuota[]> {
  let consulta = cliente
    .from('estado_cuotas_alumno')
    .select(COLUMNAS_CUOTA)
    .eq('alumno_id', alumnoId)
    .order('periodo', { ascending: false })
  if (senal) consulta = consulta.abortSignal(senal)
  const { data, error } = await consulta
  if (error) throw new ErrorConsultaCuotas(MENSAJE_RED, error)
  const cuotas = (data ?? []).map(fila => analizarCuota(fila as Fila))
  // Defensa en profundidad: nunca mezclar filas de otro alumno aunque la capa de datos las devolviera.
  if (cuotas.some(c => c.alumnoId !== alumnoId)) throw new ErrorConsultaCuotas('La respuesta no corresponde al alumno consultado.')
  return cuotas
}

/** Detalle de una factura del alumno indicado. Devuelve `null` si no existe o no es visible. */
export async function consultarDetalleCuota(
  cliente: ClienteEPT,
  alumnoId: string,
  facturaId: string,
  senal?: AbortSignal,
): Promise<DetalleCuota | null> {
  let cabecera = cliente
    .from('estado_cuotas_alumno')
    .select(COLUMNAS_CUOTA)
    .eq('alumno_id', alumnoId)
    .eq('factura_id', facturaId)
  let items = cliente
    .from('detalle_cuotas_items')
    .select(COLUMNAS_ITEM)
    .eq('alumno_id', alumnoId)
    .eq('factura_id', facturaId)
  if (senal) {
    cabecera = cabecera.abortSignal(senal)
    items = items.abortSignal(senal)
  }
  const [rCabecera, rItems] = await Promise.all([cabecera, items])
  if (rCabecera.error || rItems.error) throw new ErrorConsultaCuotas(MENSAJE_RED, rCabecera.error ?? rItems.error)
  const filaCabecera = (rCabecera.data ?? [])[0]
  if (!filaCabecera) return null
  const cuota = analizarCuota(filaCabecera as Fila)
  if (cuota.alumnoId !== alumnoId || cuota.facturaId !== facturaId) {
    throw new ErrorConsultaCuotas('La respuesta no corresponde a la cuota consultada.')
  }
  const filas = (rItems.data ?? []) as Fila[]
  const analizados = filas.map(analizarItem)
  if (analizados.some(i => i.alumnoId !== alumnoId || i.facturaId !== facturaId)) {
    throw new ErrorConsultaCuotas('Los ítems no corresponden a la cuota consultada.')
  }
  const detalle: ItemCuota[] = analizados.map(({ alumnoId: _a, facturaId: _f, ...item }) => item)
  const orden: Record<ConceptoItem, number> = { CUOTA: 0, DEPORTE: 1, TRANSPORTE: 2, COMEDOR: 3 }
  detalle.sort((a, b) => orden[a.tipo] - orden[b.tipo])
  return { cuota, items: detalle }
}

/** Pendientes: todo lo que conserva saldo (Pendiente, Pago parcial, Vencida). Pagadas: saldo cero. */
export function separarPorPestana(cuotas: readonly Cuota[]): { pendientes: Cuota[]; pagadas: Cuota[] } {
  return {
    pendientes: cuotas.filter(c => c.estado !== 'PAGADA'),
    pagadas: cuotas.filter(c => c.estado === 'PAGADA'),
  }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** `2026-11-01` → `noviembre de 2026`. Sin `Date`: no depende de la zona horaria del dispositivo. */
export function etiquetaPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split('-')
  const nombre = MESES[Number(mes) - 1]
  return nombre ? `${nombre} de ${anio}` : periodo
}

/** `2026-11-10` → `10/11/2026`. */
export function formatearFecha(valor: string): string {
  const [anio, mes, dia] = valor.split('-')
  return `${dia}/${mes}/${anio}`
}

export const ETIQUETA_CONCEPTO: Record<ConceptoItem, string> = {
  CUOTA: 'Cuota',
  DEPORTE: 'Deportes',
  TRANSPORTE: 'Transporte',
  COMEDOR: 'Comedor',
}

export function insigniaDeEstado(estado: EstadoCuota): 'pendiente' | 'parcial' | 'pagada' | 'vencida' {
  if (estado === 'PAGO_PARCIAL') return 'parcial'
  if (estado === 'PAGADA') return 'pagada'
  if (estado === 'VENCIDA') return 'vencida'
  return 'pendiente'
}
