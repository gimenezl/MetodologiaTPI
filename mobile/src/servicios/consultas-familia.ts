import { centavosExactos, type EstadoCuota } from '@/servicios/cuotas'
import type { ClienteEPT } from '@/servicios/supabase'

/**
 * Consultas familiares de solo lectura (EPT-110): inscripciones, facturas por período y registro saneado
 * de comprobantes. El servidor decide el alcance (RPC con guarda de actor); el dispositivo valida el rango,
 * valida la forma de la respuesta y la presenta. Ninguna de estas funciones escribe.
 *
 * Tres fechas distintas que nunca se intercambian:
 *   · período de factura (mes calendario, `facturas.periodo`);
 *   · fecha de transferencia (la que informó el padre, `pagos.fecha_transferencia`);
 *   · fecha de carga del archivo (solo informativa).
 */

export type CausaConsulta = 'red' | 'permiso' | 'rango' | 'respuesta'

export class ErrorConsultaFamilia extends Error {
  constructor(readonly causa: CausaConsulta, mensaje: string, readonly causaTecnica?: unknown) {
    super(mensaje)
    this.name = 'ErrorConsultaFamilia'
  }
}

// ---- Fechas civiles ------------------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/u

function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(mes) ? 30 : 31
}

/** `AAAA-MM-DD` si es una fecha civil real (años bisiestos incluidos); `null` en cualquier otro caso. */
export function fechaIsoValida(texto: string): string | null {
  const m = ISO.exec(texto)
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  if (anio < 1900 || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return null
  return texto
}

/** Máscara de entrada `DD/MM/AAAA`: solo dígitos, con las barras puestas por la aplicación. */
export function formatearEntradaFecha(texto: string): string {
  const d = texto.replace(/\D/gu, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/** `DD/MM/AAAA` → `AAAA-MM-DD` si es una fecha civil real; `null` si no lo es o está incompleta. */
export function entradaAIso(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(texto)
  return m ? fechaIsoValida(`${m[3]}-${m[2]}-${m[1]}`) : null
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
export function isoAEntrada(iso: string): string {
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

export interface RangoValidado {
  desde: string
  hasta: string
}

export interface ErroresRango {
  desde?: string
  hasta?: string
  rango?: string
}

/** Valida el par de fechas escritas por la persona. No usa la fecha del dispositivo ni completa campos vacíos. */
export function validarRango(desdeTexto: string, hastaTexto: string): { ok: true; rango: RangoValidado } | { ok: false; errores: ErroresRango } {
  const errores: ErroresRango = {}
  const desde = entradaAIso(desdeTexto)
  const hasta = entradaAIso(hastaTexto)
  if (desdeTexto.length === 0) errores.desde = 'Ingresá la fecha desde.'
  else if (!desde) errores.desde = 'La fecha desde no existe. Usá el formato DD/MM/AAAA.'
  if (hastaTexto.length === 0) errores.hasta = 'Ingresá la fecha hasta.'
  else if (!hasta) errores.hasta = 'La fecha hasta no existe. Usá el formato DD/MM/AAAA.'
  if (desde && hasta && desde > hasta) errores.rango = 'La fecha desde no puede ser posterior a la fecha hasta.'
  if (errores.desde || errores.hasta || errores.rango || !desde || !hasta) return { ok: false, errores }
  return { ok: true, rango: { desde, hasta } }
}

/** Rango inicial de la pantalla: el año calendario del dispositivo. Es una comodidad, no una regla de negocio. */
export function rangoDelAnio(hoy: Date): { desde: string; hasta: string } {
  const anio = hoy.getFullYear()
  return { desde: `01/01/${anio}`, hasta: `31/12/${anio}` }
}

const INSTANTE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/u

/**
 * Argentina no tiene horario de verano (UTC−3 todo el año): la fecha civil no depende del teléfono.
 * El instante se descompone a mano (sin `Date.parse`): el motor del dispositivo no tiene por qué aceptar las
 * fracciones de microsegundo ni el huso de `timestamptz` tal como los emite PostgREST.
 */
export function fechaArgentina(instante: string): string {
  const m = INSTANTE.exec(instante)
  if (!m || !fechaIsoValida(`${m[1]}-${m[2]}-${m[3]}`)) throw new ErrorConsultaFamilia('respuesta', 'Respuesta inválida: fecha.')
  const huso = m[7] ?? 'Z'
  let desplazamiento = 0
  if (huso !== 'Z') {
    const signo = huso.startsWith('-') ? -1 : 1
    const digitos = huso.slice(1).replace(':', '')
    desplazamiento = signo * (Number(digitos.slice(0, 2)) * 60 + Number(digitos.slice(2) || '0'))
  }
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - desplazamiento * 60_000
  return new Date(utc - 3 * 3_600_000).toISOString().slice(0, 10)
}

// ---- Tipos y análisis de respuestas --------------------------------------------------------------------

type Fila = Record<string, unknown>

function respuestaInvalida(campo: string): ErrorConsultaFamilia {
  return new ErrorConsultaFamilia('respuesta', `Respuesta inválida: ${campo}.`)
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) throw respuestaInvalida(campo)
  return valor
}

function textoOpcional(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null
  return texto(valor, campo)
}

function fechaDia(valor: unknown, campo: string): string {
  const t = texto(valor, campo)
  if (!fechaIsoValida(t)) throw respuestaInvalida(campo)
  return t
}

function entero(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0) throw respuestaInvalida(campo)
  return valor
}

function centavos(valor: unknown, campo: string): number {
  try {
    return centavosExactos(valor, campo)
  } catch {
    throw respuestaInvalida(`importe ${campo}`)
  }
}

export type CategoriaInscripcion = 'DEPORTE' | 'TRANSPORTE' | 'COMEDOR'
export type EstadoInscripcion = 'ACTIVA' | 'CANCELADA'

export interface Inscripcion {
  inscripcionId: string
  categoria: CategoriaInscripcion
  estado: EstadoInscripcion
  /** Nombre ACTUAL del catálogo (deporte, recorrido o comedor): el sistema no conserva el histórico. */
  nombre: string
  grupo: string | null
  nivel: string | null
  /** El catálogo actual ya no marca el deporte/grupo/servicio como activo; la inscripción igual existe. */
  catalogoActivo: boolean
  /** Fecha civil de Argentina. */
  fechaInscripcion: string
  fechaCancelacion: string | null
}

const CATEGORIAS: ReadonlySet<string> = new Set<CategoriaInscripcion>(['DEPORTE', 'TRANSPORTE', 'COMEDOR'])
const ESTADOS_INSCRIPCION: ReadonlySet<string> = new Set<EstadoInscripcion>(['ACTIVA', 'CANCELADA'])

export function analizarInscripcion(fila: Fila): Inscripcion {
  const categoria = texto(fila.categoria, 'categoría')
  const estado = texto(fila.estado, 'estado')
  if (!CATEGORIAS.has(categoria) || !ESTADOS_INSCRIPCION.has(estado)) throw respuestaInvalida('inscripción')
  if (typeof fila.catalogo_activo !== 'boolean') throw respuestaInvalida('catálogo')
  const cancelada = textoOpcional(fila.fecha_cancelacion, 'fecha de cancelación')
  if ((estado === 'CANCELADA') !== (cancelada !== null)) throw respuestaInvalida('cancelación')
  return {
    inscripcionId: texto(fila.inscripcion_id, 'inscripción'),
    categoria: categoria as CategoriaInscripcion,
    estado: estado as EstadoInscripcion,
    nombre: texto(fila.nombre, 'nombre'),
    grupo: textoOpcional(fila.grupo, 'grupo'),
    nivel: textoOpcional(fila.nivel, 'nivel'),
    catalogoActivo: fila.catalogo_activo,
    fechaInscripcion: fechaArgentina(texto(fila.fecha_inscripcion, 'fecha de inscripción')),
    fechaCancelacion: cancelada === null ? null : fechaArgentina(cancelada),
  }
}

export interface FacturaPeriodo {
  facturaId: string
  alumnoId: string
  /** Primer día del mes calendario, `AAAA-MM-DD`. */
  periodo: string
  vencimiento: string
  totalCentavos: number
  pagadoCentavos: number
  saldoCentavos: number
  estado: EstadoCuota
  inconsistente: boolean
  fechaCorte: string
  /** Pagos distintos relacionados con la factura (incluye pendientes y rechazados). */
  cantidadPagos: number
  /** Archivos de comprobante de esos pagos; un pago multifactura se cuenta en cada una de sus facturas. */
  cantidadArchivos: number
}

const ESTADOS_CUOTA: ReadonlySet<string> = new Set<EstadoCuota>(['PENDIENTE', 'PAGO_PARCIAL', 'PAGADA', 'VENCIDA'])

export function analizarFacturaPeriodo(fila: Fila): FacturaPeriodo {
  const estado = texto(fila.estado, 'estado')
  if (!ESTADOS_CUOTA.has(estado)) throw respuestaInvalida('estado desconocido')
  if (typeof fila.inconsistente !== 'boolean') throw respuestaInvalida('inconsistente')
  return {
    facturaId: texto(fila.factura_id, 'factura'),
    alumnoId: texto(fila.alumno_id, 'alumno'),
    periodo: fechaDia(fila.periodo, 'período'),
    vencimiento: fechaDia(fila.vencimiento, 'vencimiento'),
    totalCentavos: centavos(fila.total_centavos, 'total'),
    pagadoCentavos: centavos(fila.pagado_centavos, 'pagado'),
    saldoCentavos: centavos(fila.saldo_centavos, 'saldo'),
    estado: estado as EstadoCuota,
    inconsistente: fila.inconsistente,
    fechaCorte: fechaDia(fila.fecha_corte, 'fecha de corte'),
    cantidadPagos: entero(fila.cantidad_pagos, 'pagos'),
    cantidadArchivos: entero(fila.cantidad_archivos, 'archivos'),
  }
}

export type EstadoPagoRegistro = 'PENDIENTE_VERIFICACION' | 'APROBADO' | 'RECHAZADO'
export type CriterioComprobantes = 'PERIODO_FACTURA' | 'FECHA_TRANSFERENCIA'

/** Registro SANEADO de un pago: nunca contiene ruta, tipo, tamaño, cargador ni contenido del archivo. */
export interface RegistroComprobante {
  pagoId: string
  estado: EstadoPagoRegistro
  /** Fecha que informó el padre; `null` mientras no la haya informado. */
  fechaTransferencia: string | null
  /** `null` mientras no se haya informado. */
  importeInformadoCentavos: number | null
  totalCalculadoCentavos: number
  /** Alta del pago (fecha civil de Argentina). */
  creadoEn: string
  cantidadArchivos: number
  /** Fecha de carga del último archivo (informativa), `null` si no hay archivos. */
  ultimaCarga: string | null
  /** Todos los períodos de factura que toca el pago. */
  periodos: string[]
}

const ESTADOS_PAGO: ReadonlySet<string> = new Set<EstadoPagoRegistro>(['PENDIENTE_VERIFICACION', 'APROBADO', 'RECHAZADO'])

export function analizarRegistroComprobante(fila: Fila): RegistroComprobante {
  const estado = texto(fila.estado, 'estado del pago')
  if (!ESTADOS_PAGO.has(estado)) throw respuestaInvalida('estado del pago desconocido')
  if (!Array.isArray(fila.periodos)) throw respuestaInvalida('períodos')
  const ultima = textoOpcional(fila.ultima_carga_en, 'última carga')
  const archivos = entero(fila.cantidad_archivos, 'archivos')
  if ((archivos === 0) !== (ultima === null)) throw respuestaInvalida('última carga')
  const fecha = textoOpcional(fila.fecha_transferencia, 'fecha de transferencia')
  if (fecha !== null && !fechaIsoValida(fecha)) throw respuestaInvalida('fecha de transferencia')
  return {
    pagoId: texto(fila.pago_id, 'pago'),
    estado: estado as EstadoPagoRegistro,
    fechaTransferencia: fecha,
    importeInformadoCentavos: fila.importe_informado_centavos === null || fila.importe_informado_centavos === undefined
      ? null
      : centavos(fila.importe_informado_centavos, 'informado'),
    totalCalculadoCentavos: centavos(fila.total_calculado_centavos, 'calculado'),
    creadoEn: fechaArgentina(texto(fila.creado_en, 'alta del pago')),
    cantidadArchivos: archivos,
    ultimaCarga: ultima === null ? null : fechaArgentina(ultima),
    periodos: fila.periodos.map(p => fechaDia(p, 'período del pago')),
  }
}

// ---- Llamadas ------------------------------------------------------------------------------------------

const MENSAJE_RED = 'No pudimos completar la consulta. Revisá tu conexión e intentá nuevamente.'

function clasificar(error: { code?: string | null; message?: string }): ErrorConsultaFamilia {
  const codigo = error.code ?? ''
  // 22008/22007: fecha inexistente o con formato inválido; P6870/P6871: rango ausente o invertido.
  if (codigo === 'P6870' || codigo === 'P6871' || codigo === '22008' || codigo === '22007') {
    return new ErrorConsultaFamilia('rango', 'El rango de fechas no es válido.', error)
  }
  // Un rol o una sesión sin permiso no revela si el alumno consultado existe.
  if (codigo === '42501' || codigo === 'PGRST301' || codigo === 'PGRST303') {
    return new ErrorConsultaFamilia('permiso', 'No tenés permiso para consultar esta información.', error)
  }
  return new ErrorConsultaFamilia('red', MENSAJE_RED, error)
}

function filas(data: unknown): Fila[] {
  if (data === null || data === undefined) return []
  if (!Array.isArray(data)) throw respuestaInvalida('lista')
  return data as Fila[]
}

/** Inscripciones existentes de UN alumno. Un identificador ajeno devuelve una lista vacía (lo decide el servidor). */
export async function consultarInscripciones(cliente: ClienteEPT, alumnoId: string, senal?: AbortSignal): Promise<Inscripcion[]> {
  const consulta = cliente.rpc('consultar_inscripciones_alumno', { p_alumno_id: alumnoId })
  const { data, error } = await (senal ? consulta.abortSignal(senal) : consulta)
  if (error) throw clasificar(error)
  return filas(data).map(analizarInscripcion)
}

/** Facturas de UN alumno cuyo período (mes calendario) cae en el rango. Extremos inclusivos por mes. */
export async function consultarFacturasPeriodo(
  cliente: ClienteEPT,
  alumnoId: string,
  rango: RangoValidado,
  senal?: AbortSignal,
): Promise<FacturaPeriodo[]> {
  const consulta = cliente.rpc('consultar_facturas_periodo', { p_alumno_id: alumnoId, p_desde: rango.desde, p_hasta: rango.hasta })
  const { data, error } = await (senal ? consulta.abortSignal(senal) : consulta)
  if (error) throw clasificar(error)
  const facturas = filas(data).map(analizarFacturaPeriodo)
  // Defensa en profundidad: nunca mezclar filas de otro alumno aunque la capa de datos las devolviera.
  if (facturas.some(f => f.alumnoId !== alumnoId)) throw new ErrorConsultaFamilia('respuesta', 'La respuesta no corresponde al alumno consultado.')
  return facturas
}

/** Registro saneado de comprobantes de UN alumno, por período de factura o por fecha de transferencia. */
export async function consultarRegistroComprobantes(
  cliente: ClienteEPT,
  alumnoId: string,
  criterio: CriterioComprobantes,
  rango: RangoValidado,
  senal?: AbortSignal,
): Promise<RegistroComprobante[]> {
  const consulta = cliente.rpc('consultar_registro_comprobantes', {
    p_alumno_id: alumnoId,
    p_criterio: criterio,
    p_desde: rango.desde,
    p_hasta: rango.hasta,
  })
  const { data, error } = await (senal ? consulta.abortSignal(senal) : consulta)
  if (error) throw clasificar(error)
  return filas(data).map(analizarRegistroComprobante)
}

// ---- Presentación --------------------------------------------------------------------------------------

export const ETIQUETA_CATEGORIA: Record<CategoriaInscripcion, string> = {
  DEPORTE: 'Deportes',
  TRANSPORTE: 'Transporte (recorrido)',
  COMEDOR: 'Comedor',
}

export const ORDEN_CATEGORIAS: readonly CategoriaInscripcion[] = ['DEPORTE', 'TRANSPORTE', 'COMEDOR']

export function insigniaDePago(estado: EstadoPagoRegistro): 'aprobado' | 'pendiente' | 'rechazado' {
  if (estado === 'APROBADO') return 'aprobado'
  if (estado === 'RECHAZADO') return 'rechazado'
  return 'pendiente'
}
