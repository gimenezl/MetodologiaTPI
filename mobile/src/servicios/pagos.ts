import type { ClienteEPT } from '@/servicios/supabase'
import {
  analizarCuota,
  analizarItem,
  centavosExactos,
  type ConceptoItem,
  type EstadoCuota,
  type EstadoPagoItem,
} from '@/servicios/cuotas'

/**
 * Selección y registro inicial del pago (EPT-108). El servidor decide todo lo económico: valida el
 * vínculo, la disponibilidad de cada ítem, calcula el total con los importes históricos y reserva los
 * ítems en una única transacción. El dispositivo solo elige identificadores, presenta lo que el servidor
 * devuelve y distingue tres desenlaces: registrado, rechazado con certeza e incierto.
 */

export type MotivoNoSeleccionable = 'PAGADO' | 'EN_VERIFICACION' | 'SIN_CARGO' | 'REVISAR'

export interface ItemPagable {
  itemId: string
  facturaId: string
  tipo: ConceptoItem
  importeCentavos: number
  estadoPago: EstadoPagoItem
  /** `null` si el padre puede marcarlo. El servidor vuelve a validar al registrar. */
  motivo: MotivoNoSeleccionable | null
}

export interface GrupoFactura {
  facturaId: string
  periodo: string
  vencimiento: string
  estado: EstadoCuota
  items: ItemPagable[]
}

export interface LineaPago {
  itemId: string
  facturaId: string
  periodo: string
  tipo: ConceptoItem
  importeCentavos: number
}

export interface DatosBancarios {
  ficticio: boolean
  banco: string
  titular: string
  cuit: string
  tipoCuenta: string
  cbu: string
  alias: string
  aviso: string
}

export interface Cotizacion {
  alumnoId: string
  totalCentavos: number
  items: LineaPago[]
  banco: DatosBancarios
}

export type EstadoPagoRegistrado = 'PENDIENTE_VERIFICACION' | 'APROBADO' | 'RECHAZADO'

export interface PagoRegistrado {
  pagoId: string
  /**
   * Un pago recién registrado es PENDIENTE_VERIFICACION. Al recuperar un intento antiguo la institución
   * pudo haberlo resuelto ya: la aplicación lo informa tal cual, sin presentarlo como pendiente.
   */
  estado: EstadoPagoRegistrado
  alumnoId: string
  totalCentavos: number
  creadoEn: string
  /** `true` si es el resultado de un intento ya registrado (reintento idéntico). */
  repetido: boolean
  items: LineaPago[]
  banco: DatosBancarios
}

export type CodigoRechazo = 'P6850' | 'P6851' | 'P6852' | 'P6853' | 'P6854' | 'P6855' | 'P6856' | 'P6857' | 'DENEGADO' | 'OTRO'

export type ResultadoCotizacion =
  | { tipo: 'ok'; cotizacion: Cotizacion }
  | { tipo: 'rechazada'; codigo: CodigoRechazo }
  | { tipo: 'error' }

export type ResultadoRegistro =
  | { tipo: 'registrado'; pago: PagoRegistrado }
  /** El servidor respondió con certeza que NO registró nada. */
  | { tipo: 'rechazado'; codigo: CodigoRechazo }
  /** Sin respuesta confiable: puede o no haberse registrado. Se consulta el intento antes de reenviar. */
  | { tipo: 'incierto' }

export type ResultadoConsultaIntento =
  | { tipo: 'registrado'; pago: PagoRegistrado }
  | { tipo: 'no_registrado' }
  | { tipo: 'error' }

export const MAXIMO_ITEMS_POR_PAGO = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const FECHA = /^\d{4}-\d{2}-\d{2}$/u
const CONCEPTOS: ReadonlySet<string> = new Set<ConceptoItem>(['CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR'])

export class ErrorRespuestaPago extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorRespuestaPago'
  }
}

function invalida(campo: string): never {
  throw new ErrorRespuestaPago(`Respuesta inválida: ${campo}.`)
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) invalida(campo)
  return valor
}

function uuid(valor: unknown, campo: string): string {
  const t = texto(valor, campo)
  if (!UUID.test(t)) invalida(campo)
  return t
}

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) invalida(campo)
  return valor as Record<string, unknown>
}

function centavosNoNegativos(valor: unknown, campo: string): number {
  const c = centavosExactos(valor, campo)
  if (c < 0) invalida(campo)
  return c
}

export function analizarBanco(crudo: unknown): DatosBancarios {
  const o = objeto(crudo, 'datos bancarios')
  if (typeof o.ficticio !== 'boolean') invalida('datos bancarios')
  return {
    ficticio: o.ficticio,
    banco: texto(o.banco, 'banco'),
    titular: texto(o.titular, 'titular'),
    cuit: texto(o.cuit, 'CUIT'),
    tipoCuenta: texto(o.tipo_cuenta, 'tipo de cuenta'),
    cbu: texto(o.cbu, 'CBU'),
    alias: texto(o.alias, 'alias'),
    aviso: texto(o.aviso, 'aviso'),
  }
}

function analizarLinea(crudo: unknown): LineaPago {
  const o = objeto(crudo, 'ítem')
  const tipo = texto(o.tipo, 'concepto')
  if (!CONCEPTOS.has(tipo)) invalida('concepto');
  const periodo = texto(o.periodo, 'período')
  if (!FECHA.test(periodo)) invalida('período')
  return {
    itemId: uuid(o.item_id, 'ítem'),
    facturaId: uuid(o.factura_id, 'factura'),
    periodo,
    tipo: tipo as ConceptoItem,
    importeCentavos: centavosNoNegativos(o.importe_centavos, 'importe del ítem'),
  }
}

function analizarLineas(crudo: unknown): LineaPago[] {
  if (!Array.isArray(crudo) || crudo.length === 0) invalida('ítems')
  return crudo.map(analizarLinea)
}

/** Valida que total e ítems cierren: el dispositivo no suma, pero sí detecta una respuesta incoherente. */
function exigirCierre(total: number, items: LineaPago[]): void {
  const suma = items.reduce((acumulado, i) => acumulado + i.importeCentavos, 0)
  if (!Number.isSafeInteger(suma) || suma !== total) invalida('total')
}

export function analizarCotizacion(crudo: unknown): Cotizacion {
  const o = objeto(crudo, 'cotización')
  const items = analizarLineas(o.items)
  const total = centavosNoNegativos(o.total_centavos, 'total')
  exigirCierre(total, items)
  return { alumnoId: uuid(o.alumno_id, 'alumno'), totalCentavos: total, items, banco: analizarBanco(o.banco) }
}

export function analizarPago(crudo: unknown): PagoRegistrado {
  const o = objeto(crudo, 'pago')
  const estado = texto(o.estado, 'estado del pago')
  if (estado !== 'PENDIENTE_VERIFICACION' && estado !== 'APROBADO' && estado !== 'RECHAZADO') invalida('estado del pago')
  if (typeof o.repetido !== 'boolean') invalida('repetido')
  const items = analizarLineas(o.items)
  const total = centavosNoNegativos(o.total_centavos, 'total')
  exigirCierre(total, items)
  return {
    pagoId: uuid(o.pago_id, 'pago'),
    estado,
    alumnoId: uuid(o.alumno_id, 'alumno'),
    totalCentavos: total,
    creadoEn: texto(o.creado_en, 'fecha de registro'),
    repetido: o.repetido,
    items,
    banco: analizarBanco(o.banco),
  }
}

interface ErrorRpc {
  code?: string | null
  message?: string | null
}

/**
 * Un 4xx significa que la función rechazó la operación ANTES de confirmar (PostgreSQL revierte todo) o
 * que ni siquiera se ejecutó: no hay registro. Estado 0 (sin red), 5xx o cualquier respuesta ilegible no
 * prueban nada: el desenlace es incierto.
 */
export function clasificarFallo(error: ErrorRpc, status: number): { tipo: 'rechazado'; codigo: CodigoRechazo } | { tipo: 'incierto' } {
  if (!Number.isInteger(status) || status < 400 || status >= 500) return { tipo: 'incierto' }
  const codigo = error.code ?? ''
  if (/^P685[0-7]$/u.test(codigo)) return { tipo: 'rechazado', codigo: codigo as CodigoRechazo }
  if (codigo === '42501' || codigo === 'P5505' || status === 401 || status === 403) return { tipo: 'rechazado', codigo: 'DENEGADO' }
  return { tipo: 'rechazado', codigo: 'OTRO' }
}

export const MENSAJE_RECHAZO: Record<CodigoRechazo, string> = {
  P6850: 'La selección no es válida. Elegí al menos un ítem y volvé a intentarlo.',
  P6851: 'Algún ítem ya no está disponible para tu cuenta. Actualizá la selección.',
  P6852: 'Un pago solo puede incluir ítems de un mismo estudiante.',
  P6853: 'Algún ítem ya fue pagado o tiene un pago en verificación. Actualizá la selección.',
  P6854: 'Un ítem sin cargo no se paga.',
  P6855: 'Una cuota tiene importes que no coinciden entre sí. Consultá con la institución.',
  P6856: 'Este intento ya se usó con otra selección. Volvé a la selección y confirmá de nuevo.',
  P6857: 'El total cambió desde que lo viste. Revisá la selección y confirmá de nuevo.',
  DENEGADO: 'Tu cuenta no puede registrar pagos. Si creés que es un error, contactá a la institución.',
  OTRO: 'No pudimos registrar el pago. Actualizá la selección e intentá nuevamente.',
}

// ---- Lectura de ítems ---------------------------------------------------------------------------------

const COLUMNAS_CUOTA =
  'factura_id,alumno_id,periodo,vencimiento,total_centavos,pagado_centavos,saldo_centavos,estado,items_en_verificacion,inconsistente,fecha_corte'
const COLUMNAS_ITEM = 'item_id,factura_id,alumno_id,tipo,importe_centavos,pagado_centavos,estado_pago'
const ORDEN_CONCEPTO: Record<ConceptoItem, number> = { CUOTA: 0, DEPORTE: 1, TRANSPORTE: 2, COMEDOR: 3 }

type Fila = Record<string, unknown>

/** Motivo por el que un ítem no puede marcarse. Es presentación: el servidor valida de nuevo. */
export function motivoDe(item: { importeCentavos: number; pagadoCentavos: number; estadoPago: EstadoPagoItem }, facturaInconsistente: boolean): MotivoNoSeleccionable | null {
  if (item.estadoPago === 'PAGADO' || (item.importeCentavos > 0 && item.pagadoCentavos >= item.importeCentavos)) return 'PAGADO'
  if (item.estadoPago === 'EN_VERIFICACION') return 'EN_VERIFICACION'
  if (item.importeCentavos === 0) return 'SIN_CARGO'
  if (facturaInconsistente) return 'REVISAR'
  return null
}

/** Facturas con saldo del hijo y sus ítems, más recientes primero. Un identificador ajeno devuelve vacío por RLS. */
export async function cargarItemsPagables(cliente: ClienteEPT, alumnoId: string, senal?: AbortSignal): Promise<GrupoFactura[]> {
  let cuotas = cliente.from('estado_cuotas_alumno').select(COLUMNAS_CUOTA).eq('alumno_id', alumnoId).order('periodo', { ascending: false })
  let items = cliente.from('detalle_cuotas_items').select(COLUMNAS_ITEM).eq('alumno_id', alumnoId)
  if (senal) {
    cuotas = cuotas.abortSignal(senal)
    items = items.abortSignal(senal)
  }
  const [rCuotas, rItems] = await Promise.all([cuotas, items])
  if (rCuotas.error || rItems.error) throw new ErrorRespuestaPago('No pudimos consultar los ítems.')
  const listaCuotas = ((rCuotas.data ?? []) as Fila[]).map(analizarCuota)
  const listaItems = ((rItems.data ?? []) as Fila[]).map(analizarItem)
  if (listaCuotas.some(c => c.alumnoId !== alumnoId) || listaItems.some(i => i.alumnoId !== alumnoId)) {
    throw new ErrorRespuestaPago('La respuesta no corresponde al estudiante consultado.')
  }
  const porFactura = new Map<string, typeof listaItems>()
  for (const item of listaItems) porFactura.set(item.facturaId, [...(porFactura.get(item.facturaId) ?? []), item])
  return listaCuotas
    .filter(cuota => cuota.estado !== 'PAGADA')
    .map(cuota => ({
      facturaId: cuota.facturaId,
      periodo: cuota.periodo,
      vencimiento: cuota.vencimiento,
      estado: cuota.estado,
      items: (porFactura.get(cuota.facturaId) ?? [])
        .map<ItemPagable>(item => ({
          itemId: item.itemId,
          facturaId: item.facturaId,
          tipo: item.tipo,
          importeCentavos: item.importeCentavos,
          estadoPago: item.estadoPago,
          motivo: motivoDe(item, cuota.inconsistente),
        }))
        .sort((a, b) => ORDEN_CONCEPTO[a.tipo] - ORDEN_CONCEPTO[b.tipo]),
    }))
    .filter(grupo => grupo.items.length > 0)
}

// ---- Operaciones del servidor -------------------------------------------------------------------------

/** Orden canónico de una selección: el servidor la normaliza igual, así que la clave del intento la ata a su contenido. */
export function seleccionCanonica(itemIds: readonly string[]): string[] {
  return [...new Set(itemIds)].sort()
}

export async function consultarDatosBancarios(cliente: ClienteEPT, senal?: AbortSignal): Promise<DatosBancarios> {
  let consulta = cliente.rpc('datos_bancarios_transferencia')
  if (senal) consulta = consulta.abortSignal(senal)
  const { data, error } = await consulta
  if (error) throw new ErrorRespuestaPago('No pudimos consultar los datos para la transferencia.')
  return analizarBanco(data)
}

/** Cotiza sin efectos. El total es el del servidor; nada se calcula ni se envía como importe. */
export async function cotizarPago(cliente: ClienteEPT, itemIds: readonly string[], senal?: AbortSignal): Promise<ResultadoCotizacion> {
  let consulta = cliente.rpc('cotizar_pago', { p_item_ids: seleccionCanonica(itemIds) })
  if (senal) consulta = consulta.abortSignal(senal)
  const { data, error, status } = await consulta
  if (error) {
    const fallo = clasificarFallo(error, status)
    return fallo.tipo === 'rechazado' ? { tipo: 'rechazada', codigo: fallo.codigo } : { tipo: 'error' }
  }
  try {
    return { tipo: 'ok', cotizacion: analizarCotizacion(data) }
  } catch {
    return { tipo: 'error' }
  }
}

/**
 * Registra el pago pendiente de verificación. `totalEsperadoCentavos` es el total que el padre vio: el
 * servidor lo usa solo como precondición de consentimiento y rechaza con P6857 si cambió.
 */
export async function registrarPago(
  cliente: ClienteEPT,
  claveIntento: string,
  itemIds: readonly string[],
  totalEsperadoCentavos: number,
): Promise<ResultadoRegistro> {
  let respuesta
  try {
    respuesta = await cliente.rpc('registrar_pago', {
      p_clave_intento: claveIntento,
      p_item_ids: seleccionCanonica(itemIds),
      p_total_esperado_centavos: totalEsperadoCentavos,
    })
  } catch {
    return { tipo: 'incierto' }
  }
  const { data, error, status } = respuesta
  if (error) return clasificarFallo(error, status)
  try {
    return { tipo: 'registrado', pago: analizarPago(data) }
  } catch {
    // La confirmación existió pero no es legible: puede haberse registrado. Se resuelve consultando.
    return { tipo: 'incierto' }
  }
}

/** Resultado durable de un intento propio. No escribe. */
export async function consultarIntentoPago(cliente: ClienteEPT, claveIntento: string, senal?: AbortSignal): Promise<ResultadoConsultaIntento> {
  let consulta = cliente.rpc('consultar_intento_pago', { p_clave_intento: claveIntento })
  if (senal) consulta = consulta.abortSignal(senal)
  let respuesta
  try {
    respuesta = await consulta
  } catch {
    return { tipo: 'error' }
  }
  const { data, error } = respuesta
  if (error) return { tipo: 'error' }
  try {
    const o = objeto(data, 'intento')
    if (o.registrado === false) return { tipo: 'no_registrado' }
    if (o.registrado !== true) invalida('registrado')
    return { tipo: 'registrado', pago: analizarPago(o) }
  } catch {
    return { tipo: 'error' }
  }
}

// ---- Identidad del intento ----------------------------------------------------------------------------

/**
 * UUID v4 del intento. No es un secreto ni una credencial: solo debe ser único por padre. Usa el CSPRNG de
 * la plataforma cuando existe y, si no, `Math.random` (la unicidad por padre la impone la base de datos).
 */
export function generarClaveIntento(): string {
  const bytes = new Uint8Array(16)
  const cripto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (cripto?.getRandomValues) cripto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const esUuid = (valor: unknown): valor is string => typeof valor === 'string' && UUID.test(valor)
