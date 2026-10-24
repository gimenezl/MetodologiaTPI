import { ErrorConsultaFamilia, fechaIsoValida, type RangoValidado } from '@/servicios/consultas-familia'
import type { ClienteEPT } from '@/servicios/supabase'

/**
 * Historial de deuda por ítem (EPT-114, HU13). El servidor calcula importe, pagado, saldo vigente, subtotales
 * y total adeudado en una sola lectura coherente (`historial_deuda_items`); el dispositivo valida la forma de
 * la respuesta, comprueba que las cifras cierren entre sí y las presenta. Nunca suma importes por su cuenta
 * para decidir una deuda y nunca usa tarifas actuales.
 *
 * Los importes viajan como TEXTO entero de centavos y se leen como `bigint`: un total agregado puede superar la
 * precisión segura de `number` aunque cada ítem la respete.
 *
 * Filtro: PERÍODO DE FACTURA (mes calendario, extremos inclusivos). No es la fecha de transferencia de los
 * reportes web y el saldo es el vigente, no una reconstrucción al final del intervalo.
 */

export type TipoItemDeuda = 'CUOTA' | 'DEPORTE' | 'TRANSPORTE' | 'COMEDOR'
export type EstadoItemDeuda = 'PAGADO' | 'PENDIENTE' | 'VENCIDO' | 'EN_VERIFICACION' | 'SIN_CARGO'
export type OrigenEstado = 'ACTIVA' | 'CANCELADA'

/** Cantidad de ítems por página que pide la app (el servidor admite 25, 50 o 100). */
export const TAMANO_PAGINA = 50

export interface ItemDeuda {
  itemId: string
  facturaId: string
  /** Primer día del mes de la factura, `AAAA-MM-DD`. */
  periodo: string
  vencimiento: string
  tipo: TipoItemDeuda
  /** Clave de agrupación: `CUOTA`, `DEPORTE:<id>`, `TRANSPORTE:<id>` o `COMEDOR`. */
  grupo: string
  /** Nombre del catálogo ACTUAL (el sistema no conserva el nombre histórico). */
  concepto: string
  /** Grupo deportivo, solo para deportes. */
  detalle: string | null
  importe: bigint
  pagado: bigint
  saldo: bigint
  estado: EstadoItemDeuda
  enVerificacion: boolean
  vencido: boolean
  inconsistente: boolean
  facturaInconsistente: boolean
  origenEstado: OrigenEstado | null
  catalogoActivo: boolean | null
}

export interface GrupoDeuda {
  clave: string
  tipo: TipoItemDeuda
  concepto: string
  items: number
  itemsConSaldo: number
  importe: bigint
  pagado: bigint
  saldo: bigint
}

export interface TotalesDeuda {
  items: number
  itemsConSaldo: number
  importe: bigint
  pagado: bigint
  /** Σ saldos del conjunto filtrado COMPLETO, no solo de la página. */
  adeudado: bigint
  facturas: number
  facturasConSaldo: number
  hayInconsistencias: boolean
}

export interface PaginaDeuda {
  tipo: 'pagina'
  filas: ItemDeuda[]
  total: number
  pagina: number
  tamano: number
  totales: TotalesDeuda
  grupos: GrupoDeuda[]
  huella: string
  /** Fecha de Buenos Aires del servidor con la que se evaluó el vencimiento. */
  fechaCorte: string
  periodoDesde: string | null
  periodoHasta: string | null
}

/** El contenido cambió entre páginas: hay que volver a la primera con la huella nueva. */
export interface SenalActualizado {
  tipo: 'actualizado'
  huella: string
}

export type RespuestaDeuda = PaginaDeuda | SenalActualizado

function invalida(campo: string): ErrorConsultaFamilia {
  return new ErrorConsultaFamilia('respuesta', `Respuesta inválida: ${campo}.`)
}

type Objeto = Record<string, unknown>

function objeto(valor: unknown, campo: string): Objeto {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) throw invalida(campo)
  return valor as Objeto
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) throw invalida(campo)
  return valor
}

function textoOpcional(valor: unknown, campo: string): string | null {
  return valor === null || valor === undefined ? null : texto(valor, campo)
}

function logico(valor: unknown, campo: string): boolean {
  if (typeof valor !== 'boolean') throw invalida(campo)
  return valor
}

function logicoOpcional(valor: unknown, campo: string): boolean | null {
  return valor === null || valor === undefined ? null : logico(valor, campo)
}

function entero(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0) throw invalida(campo)
  return valor
}

function dia(valor: unknown, campo: string): string {
  const t = texto(valor, campo)
  if (!fechaIsoValida(t)) throw invalida(campo)
  return t
}

function diaOpcional(valor: unknown, campo: string): string | null {
  return valor === null || valor === undefined ? null : dia(valor, campo)
}

/** Centavos como texto entero (con signo opcional); sin decimales, sin ceros a la izquierda, sin notación científica. */
export function centavosDeTexto(valor: unknown, campo: string): bigint {
  if (typeof valor !== 'string' || valor.length > 30 || !/^-?(?:0|[1-9]\d*)$/u.test(valor) || valor === '-0') {
    throw invalida(`importe ${campo}`)
  }
  return BigInt(valor)
}

const TIPOS: ReadonlySet<string> = new Set<TipoItemDeuda>(['CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR'])
const ESTADOS: ReadonlySet<string> = new Set<EstadoItemDeuda>(['PAGADO', 'PENDIENTE', 'VENCIDO', 'EN_VERIFICACION', 'SIN_CARGO'])
const ORIGENES: ReadonlySet<string> = new Set<OrigenEstado>(['ACTIVA', 'CANCELADA'])
const HUELLA = /^[a-f0-9]{32}$/u

export function analizarItemDeuda(valor: unknown): ItemDeuda {
  const f = objeto(valor, 'ítem')
  const tipo = texto(f.tipo, 'concepto')
  const estado = texto(f.estado, 'estado del ítem')
  if (!TIPOS.has(tipo) || !ESTADOS.has(estado)) throw invalida('ítem')
  const origen = textoOpcional(f.origen_estado, 'origen')
  if (origen !== null && !ORIGENES.has(origen)) throw invalida('origen')
  const importe = centavosDeTexto(f.importe_centavos, 'del ítem')
  const pagado = centavosDeTexto(f.pagado_centavos, 'pagado')
  const saldo = centavosDeTexto(f.saldo_centavos, 'saldo')
  // El saldo es siempre importe − pagado, sin recortes: si el servidor enviara otra cosa, no se muestra.
  if (importe - pagado !== saldo) throw invalida('saldo del ítem')
  const grupo = texto(f.grupo, 'agrupación')
  if (!(grupo === tipo || grupo.startsWith(`${tipo}:`))) throw invalida('agrupación')
  return {
    itemId: texto(f.item_id, 'ítem'),
    facturaId: texto(f.factura_id, 'factura'),
    periodo: dia(f.periodo, 'período'),
    vencimiento: dia(f.vencimiento, 'vencimiento'),
    tipo: tipo as TipoItemDeuda,
    grupo,
    concepto: texto(f.concepto, 'concepto'),
    detalle: textoOpcional(f.detalle, 'detalle'),
    importe,
    pagado,
    saldo,
    estado: estado as EstadoItemDeuda,
    enVerificacion: logico(f.en_verificacion, 'verificación'),
    vencido: logico(f.vencido, 'vencido'),
    inconsistente: logico(f.inconsistente, 'inconsistente'),
    facturaInconsistente: logico(f.factura_inconsistente, 'factura inconsistente'),
    origenEstado: origen as OrigenEstado | null,
    catalogoActivo: logicoOpcional(f.catalogo_activo, 'catálogo'),
  }
}

function analizarGrupo(valor: unknown): GrupoDeuda {
  const g = objeto(valor, 'agrupación')
  const tipo = texto(g.tipo, 'tipo de agrupación')
  if (!TIPOS.has(tipo)) throw invalida('tipo de agrupación')
  const importe = centavosDeTexto(g.importe_centavos, 'de la agrupación')
  const pagado = centavosDeTexto(g.pagado_centavos, 'pagado de la agrupación')
  const saldo = centavosDeTexto(g.saldo_centavos, 'saldo de la agrupación')
  if (importe - pagado !== saldo) throw invalida('saldo de la agrupación')
  return {
    clave: texto(g.clave, 'clave de agrupación'),
    tipo: tipo as TipoItemDeuda,
    concepto: texto(g.concepto, 'concepto de agrupación'),
    items: entero(g.items, 'ítems de la agrupación'),
    itemsConSaldo: entero(g.items_con_saldo, 'ítems con saldo de la agrupación'),
    importe,
    pagado,
    saldo,
  }
}

function analizarTotales(valor: unknown): TotalesDeuda {
  const t = objeto(valor, 'totales')
  const importe = centavosDeTexto(t.importe_centavos, 'total')
  const pagado = centavosDeTexto(t.pagado_centavos, 'pagado total')
  const adeudado = centavosDeTexto(t.adeudado_centavos, 'adeudado')
  if (importe - pagado !== adeudado) throw invalida('total adeudado')
  return {
    items: entero(t.items, 'cantidad de ítems'),
    itemsConSaldo: entero(t.items_con_saldo, 'ítems con saldo'),
    importe,
    pagado,
    adeudado,
    facturas: entero(t.facturas, 'facturas'),
    facturasConSaldo: entero(t.facturas_con_saldo, 'facturas con saldo'),
    hayInconsistencias: logico(t.hay_inconsistencias, 'inconsistencias'),
  }
}

/**
 * Valida un documento del servidor. Además de la forma comprueba que las cifras cierren: Σ subtotales = total
 * adeudado, Σ ítems de las agrupaciones = total de ítems, y que cada fila pertenezca a una agrupación conocida.
 * Una respuesta que no cierra se rechaza entera; no se «corrige».
 */
export function analizarRespuestaDeuda(valor: unknown, esperado: { pagina: number }): RespuestaDeuda {
  const d = objeto(valor, 'documento')
  const huella = texto(d.huella, 'huella')
  if (!HUELLA.test(huella)) throw invalida('huella')
  if (d.actualizado === true) return { tipo: 'actualizado', huella }
  const pagina = entero(d.pagina, 'página')
  const tamano = entero(d.tamano, 'tamaño de página')
  if (pagina !== esperado.pagina || tamano !== TAMANO_PAGINA) throw invalida('paginación')
  if (!Array.isArray(d.filas) || !Array.isArray(d.grupos)) throw invalida('lista')
  const filas = d.filas.map(analizarItemDeuda)
  const grupos = d.grupos.map(analizarGrupo)
  const totales = analizarTotales(d.totales)
  const total = entero(d.total, 'total de ítems')
  if (total !== totales.items || filas.length > tamano) throw invalida('cantidad de ítems')
  if (filas.length !== Math.max(0, Math.min(tamano, total - (pagina - 1) * tamano))) throw invalida('página incompleta')
  if (new Set(filas.map(f => f.itemId)).size !== filas.length) throw invalida('ítems repetidos')
  const claves = new Set(grupos.map(g => g.clave))
  if (claves.size !== grupos.length || filas.some(f => !claves.has(f.grupo))) throw invalida('agrupaciones')
  if (grupos.reduce((s, g) => s + g.saldo, 0n) !== totales.adeudado) throw invalida('subtotales')
  if (grupos.reduce((s, g) => s + g.items, 0) !== totales.items) throw invalida('ítems de las agrupaciones')
  if (grupos.reduce((s, g) => s + g.itemsConSaldo, 0) !== totales.itemsConSaldo) throw invalida('ítems con saldo')
  return {
    tipo: 'pagina',
    filas,
    total,
    pagina,
    tamano,
    totales,
    grupos,
    huella,
    fechaCorte: dia(d.fecha_corte, 'fecha de corte'),
    periodoDesde: diaOpcional(d.periodo_desde, 'período desde'),
    periodoHasta: diaOpcional(d.periodo_hasta, 'período hasta'),
  }
}

const MENSAJE_RED = 'No pudimos consultar la deuda. Revisá tu conexión e intentá nuevamente.'

function clasificar(error: { code?: string | null; message?: string }): ErrorConsultaFamilia {
  const codigo = error.code ?? ''
  if (codigo === 'P6870' || codigo === 'P6871' || codigo === '22008' || codigo === '22007') {
    return new ErrorConsultaFamilia('rango', 'El rango de fechas no es válido.', error)
  }
  if (codigo === '42501' || codigo === 'PGRST301' || codigo === 'PGRST303') {
    return new ErrorConsultaFamilia('permiso', 'No tenés permiso para consultar esta información.', error)
  }
  if (codigo === 'P6872') return new ErrorConsultaFamilia('respuesta', 'La paginación solicitada no es válida.', error)
  return new ErrorConsultaFamilia('red', MENSAJE_RED, error)
}

/**
 * Una página del historial de deuda de UN alumno. `rango = null` pide todo el historial. Con `huella` el servidor
 * contesta solo la señal de actualización si el contenido cambió desde la primera página.
 */
export async function consultarDeudaItems(
  cliente: ClienteEPT,
  alumnoId: string,
  rango: RangoValidado | null,
  pagina: number,
  huella: string | null,
  senal?: AbortSignal,
): Promise<RespuestaDeuda> {
  const consulta = cliente.rpc('historial_deuda_items', {
    p_alumno_id: alumnoId,
    ...(rango ? { p_desde: rango.desde, p_hasta: rango.hasta } : {}),
    p_pagina: pagina,
    p_tamano: TAMANO_PAGINA,
    ...(huella ? { p_huella: huella } : {}),
  })
  const { data, error } = await (senal ? consulta.abortSignal(senal) : consulta)
  if (error) throw clasificar(error)
  const respuesta = analizarRespuestaDeuda(data, { pagina })
  if (respuesta.tipo === 'pagina' && rango) {
    // El servidor devuelve el mes calendario de cada extremo; debe coincidir con lo pedido.
    if (respuesta.periodoDesde !== `${rango.desde.slice(0, 8)}01` || respuesta.periodoHasta !== `${rango.hasta.slice(0, 8)}01`) {
      throw invalida('período consultado')
    }
  }
  return respuesta
}

// ---- Presentación --------------------------------------------------------------------------------------

/** `bigint` de centavos → `ARS 1.234.567,89`, sin pasar por `number`. */
export function formatearCentavosExactos(centavos: bigint): string {
  const negativo = centavos < 0n
  const absoluto = negativo ? -centavos : centavos
  const enteros = (absoluto / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
  const decimales = (absoluto % 100n).toString().padStart(2, '0')
  // Espacio no separable, como el resto de los importes de la aplicación: «ARS» nunca queda solo al cortar la línea.
  return `${negativo ? '-' : ''}ARS ${enteros},${decimales}`
}

export interface GrupoVisible {
  grupo: GrupoDeuda
  /** Ítems ya cargados de esta agrupación, en el orden del servidor. */
  items: ItemDeuda[]
}

/** Agrupa lo cargado según las agrupaciones del servidor (que cubren el conjunto filtrado completo). */
export function agruparCargados(grupos: readonly GrupoDeuda[], items: readonly ItemDeuda[]): GrupoVisible[] {
  return grupos.map(grupo => ({ grupo, items: items.filter(i => i.grupo === grupo.clave) }))
}
