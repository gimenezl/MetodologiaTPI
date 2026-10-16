import {
  centavosDeImporte,
  esTipoComprobante,
  type CodigoPreparacion,
  type EstadoCarga,
  type MotivoDescarte,
  type TipoComprobante,
} from '@/compartido/comprobantes-contrato'
import { esUuid, generarClaveIntento } from '@/servicios/pagos'
import type { ClienteEPT } from '@/servicios/supabase'
import { ErrorTransporte, type TransporteHttp } from '@/servicios/transporte-http'

/**
 * Carga de comprobantes de transferencia (EPT-109), lado aplicación.
 *
 * Protocolo (la base y el servidor son la autoridad; esto solo lo ejecuta):
 *   1. `prepararCarga`  RPC con la sesión del padre: valida pago, archivo y datos.
 *   2. subida           los bytes van directo a Storage, a la ruta temporal de la carga.
 *   3. `finalizarCarga` el servidor autentica el Bearer, valida el CONTENIDO real,
 *                       lo publica y confirma en SQL.
 *   `consultarCarga` resuelve una respuesta perdida sin reenviar nada.
 *
 * Ningún valor «validado» ni hash viaja desde acá: el servidor calcula el suyo.
 */

const ESTADOS: ReadonlySet<string> = new Set<EstadoCarga>(['PREPARADA', 'CONFIRMADA', 'DESCARTADA', 'EXPIRADA'])
const FECHA = /^\d{4}-\d{2}-\d{2}$/u

export interface CargaComprobante {
  cargaId: string
  claveCarga: string
  pagoId: string
  estado: EstadoCarga
  motivoDescarte: MotivoDescarte | null
  bucketTemporal: string
  rutaTemporal: string
  tipoMime: TipoComprobante
  tamanoBytes: number
  fechaTransferencia: string
  importeCentavos: number
  numeroOperacion: string
  comprobanteId: string | null
  /** Archivos confirmados del pago (incluido este, si ya se confirmó). */
  cantidadArchivos: number
  estadoPago: string
  /** `true` si es el resultado de un intento ya registrado (reintento idéntico). */
  repetido: boolean
}

export type ResultadoPreparacion =
  | { tipo: 'preparada'; carga: CargaComprobante }
  | { tipo: 'rechazada'; codigo: CodigoPreparacion }
  | { tipo: 'incierto' }

export type ResultadoConsultaCarga =
  | { tipo: 'registrada'; carga: CargaComprobante }
  | { tipo: 'no_registrada' }
  | { tipo: 'error' }

export type ResultadoFinalizacion =
  | { tipo: 'confirmada'; carga: CargaComprobante }
  /** El servidor respondió con certeza que NO registró el comprobante (la carga queda cerrada). */
  | { tipo: 'rechazada'; codigo: string; mensaje: string }
  /** El archivo todavía no figura en el servidor: se puede reintentar la subida. */
  | { tipo: 'no_subido' }
  | { tipo: 'incierto' }

export class ErrorRespuestaCarga extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorRespuestaCarga'
  }
}

function invalida(campo: string): never {
  throw new ErrorRespuestaCarga(`Respuesta inválida: ${campo}.`)
}

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) invalida(campo)
  return valor as Record<string, unknown>
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) invalida(campo)
  return valor
}

function uuid(valor: unknown, campo: string): string {
  const t = texto(valor, campo)
  if (!esUuid(t)) invalida(campo)
  return t
}

function entero(valor: unknown, campo: string, minimo: number): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < minimo) invalida(campo)
  return valor
}

/** Interpreta la carga que devuelve la base. Cualquier campo fuera de contrato invalida TODA la respuesta. */
export function analizarCarga(crudo: unknown): CargaComprobante {
  const o = objeto(crudo, 'carga')
  const estado = texto(o.estado, 'estado')
  if (!ESTADOS.has(estado)) invalida('estado')
  const tipoMime = texto(o.tipo_mime, 'tipo_mime')
  if (!esTipoComprobante(tipoMime)) invalida('tipo_mime')
  const fecha = texto(o.fecha_transferencia, 'fecha_transferencia')
  if (!FECHA.test(fecha)) invalida('fecha_transferencia')
  const motivo = o.motivo_descarte
  if (motivo !== null && typeof motivo !== 'string') invalida('motivo_descarte')
  if (o.repetido !== true && o.repetido !== false) invalida('repetido')
  const comprobante = o.comprobante_id
  return {
    cargaId: uuid(o.carga_id, 'carga_id'),
    claveCarga: uuid(o.clave_carga, 'clave_carga'),
    pagoId: uuid(o.pago_id, 'pago_id'),
    estado: estado as EstadoCarga,
    motivoDescarte: (motivo ?? null) as MotivoDescarte | null,
    bucketTemporal: texto(o.bucket_temporal, 'bucket_temporal'),
    rutaTemporal: texto(o.ruta_temporal, 'ruta_temporal'),
    tipoMime,
    tamanoBytes: entero(o.tamano_bytes, 'tamano_bytes', 1),
    fechaTransferencia: fecha,
    importeCentavos: entero(o.importe_centavos, 'importe_centavos', 0),
    numeroOperacion: texto(o.numero_operacion, 'numero_operacion'),
    comprobanteId: comprobante === null || comprobante === undefined ? null : uuid(comprobante, 'comprobante_id'),
    cantidadArchivos: entero(o.cantidad_archivos, 'cantidad_archivos', 0),
    estadoPago: texto(o.estado_pago, 'estado_pago'),
    repetido: o.repetido,
  }
}

type ErrorRpc = { code?: string | null; message?: string | null }

/**
 * Un 4xx significa que la base rechazó la operación ANTES de escribir (o ni la ejecutó): no hay carga.
 * Estado 0 (sin red), 5xx o una respuesta ilegible no prueban nada: el desenlace es incierto.
 */
export function clasificarFalloPreparacion(
  error: ErrorRpc,
  status: number,
): { tipo: 'rechazada'; codigo: CodigoPreparacion } | { tipo: 'incierto' } {
  if (!Number.isInteger(status) || status < 400 || status >= 500) return { tipo: 'incierto' }
  const codigo = error.code ?? ''
  if (/^P686[0-6]$|^P6868$/u.test(codigo)) return { tipo: 'rechazada', codigo: codigo as CodigoPreparacion }
  if (codigo === '42501' || codigo === 'P5505' || status === 401 || status === 403) {
    return { tipo: 'rechazada', codigo: 'DENEGADO' }
  }
  return { tipo: 'rechazada', codigo: 'OTRO' }
}

export interface ArgumentosPreparacion {
  claveCarga: string
  pagoId: string
  tipoMime: TipoComprobante
  tamanoBytes: number
  /** `null` los tres: el pago ya tiene sus datos y la carga los hereda. */
  datos: { fecha: string; importe: string; numero: string } | null
}

export async function prepararCarga(cliente: ClienteEPT, a: ArgumentosPreparacion): Promise<ResultadoPreparacion> {
  let respuesta
  try {
    respuesta = await cliente.rpc('preparar_carga_comprobante', {
      p_clave_carga: a.claveCarga,
      p_pago_id: a.pagoId,
      p_fecha: a.datos?.fecha ?? null,
      p_importe: a.datos?.importe ?? null,
      p_numero: a.datos?.numero ?? null,
      p_tipo_mime: a.tipoMime,
      p_tamano: a.tamanoBytes,
    } as never)
  } catch {
    return { tipo: 'incierto' }
  }
  const { data, error, status } = respuesta
  if (error) return clasificarFalloPreparacion(error, status)
  try {
    return { tipo: 'preparada', carga: analizarCarga(data) }
  } catch {
    // La base respondió pero no se entiende: la carga pudo registrarse. Se resuelve consultando.
    return { tipo: 'incierto' }
  }
}

/** Resultado durable de una carga propia. No escribe. */
export async function consultarCarga(
  cliente: ClienteEPT,
  claveCarga: string,
  senal?: AbortSignal,
): Promise<ResultadoConsultaCarga> {
  let consulta = cliente.rpc('consultar_carga_comprobante', { p_clave_carga: claveCarga })
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
    const o = objeto(data, 'consulta')
    if (o.registrada === false) return { tipo: 'no_registrada' }
    if (o.registrada !== true) invalida('registrada')
    return { tipo: 'registrada', carga: analizarCarga(o) }
  } catch {
    return { tipo: 'error' }
  }
}

/**
 * Pide al servidor validar y confirmar la carga. Idempotente: repetirla tras un corte retoma donde quedó.
 * Solo un 2xx confirma; un 4xx con código de dominio es un rechazo cierto; todo lo demás es incierto.
 */
export async function finalizarCarga(
  transporte: TransporteHttp,
  cargaId: string,
  senal?: AbortSignal,
): Promise<ResultadoFinalizacion> {
  try {
    const r = await transporte.solicitar<{ carga?: unknown }>(`/api/comprobantes/cargas/${cargaId}/finalizacion`, {
      metodo: 'POST',
      senal,
    })
    const carga = analizarCarga(objeto(r.datos, 'respuesta').carga)
    return carga.estado === 'CONFIRMADA' ? { tipo: 'confirmada', carga } : { tipo: 'incierto' }
  } catch (error) {
    if (!(error instanceof ErrorTransporte) || error.tipo !== 'HTTP' || error.estado === null) {
      return { tipo: 'incierto' }
    }
    const cuerpo = (typeof error.cuerpo === 'object' && error.cuerpo !== null ? error.cuerpo : {}) as Record<string, unknown>
    const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo : null
    const mensaje = typeof cuerpo.mensaje === 'string' ? cuerpo.mensaje : null
    if (error.estado === 409 && codigo === 'ARCHIVO_NO_SUBIDO') return { tipo: 'no_subido' }
    // El servidor declara que no sabe si quedó registrado: se consulta antes de reenviar.
    if (error.estado >= 500 || codigo === 'RESULTADO_INCIERTO') return { tipo: 'incierto' }
    if (error.estado >= 400 && codigo) {
      return {
        tipo: 'rechazada',
        codigo,
        mensaje: mensaje ?? 'No se pudo registrar el comprobante.',
      }
    }
    return { tipo: 'incierto' }
  }
}

// ---- Subida a Storage ---------------------------------------------------------------------------------

/** Lo que necesita una subida; la implementación nativa vive aparte para poder simularla en pruebas. */
export interface ArchivoParaSubir {
  uri: string
  tipoMime: TipoComprobante
  tamanoBytes: number
}

export interface SolicitudSubida {
  bucket: string
  ruta: string
  archivo: ArchivoParaSubir
  /** Fracción 0..1 de bytes enviados. */
  onProgreso: (fraccion: number) => void
  senal?: AbortSignal
}

export type ResultadoSubida =
  | { tipo: 'subido' }
  /** El objeto ya estaba en la ruta (reintento): Storage no permite reemplazarlo y no hace falta. */
  | { tipo: 'ya_existia' }
  | { tipo: 'rechazada'; estado: number }
  | { tipo: 'incierto' }

export type SubirArchivo = (solicitud: SolicitudSubida) => Promise<ResultadoSubida>

/** Interpreta la respuesta HTTP de Storage a un POST de objeto. */
export function clasificarRespuestaSubida(estado: number, cuerpo: string): ResultadoSubida {
  if (estado >= 200 && estado < 300) return { tipo: 'subido' }
  if (estado === 409 || (estado === 400 && /duplicate|already exists/iu.test(cuerpo))) return { tipo: 'ya_existia' }
  if (estado >= 400 && estado < 500) return { tipo: 'rechazada', estado }
  return { tipo: 'incierto' }
}

// ---- Pagos pendientes del propio padre ----------------------------------------------------------------

export interface PagoPendienteDelPadre {
  pagoId: string
  alumnoId: string
  totalCentavos: number
  creadoEn: string
  /** `null` mientras no se informó la transferencia (el primer comprobante la establece). */
  datosTransferencia: { fecha: string; importeCentavos: number; numero: string } | null
  archivos: number
}

function aCentavos(valor: unknown): number {
  if (typeof valor !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/u.test(valor)) invalida('importe')
  return centavosDeImporte(valor)
}

/**
 * Pagos PENDIENTE_VERIFICACION del propio padre para un hijo. Lee `pagos` y `comprobantes_pago` bajo
 * RLS (el padre ve solo los archivos que cargó). Los importes llegan como texto exacto.
 */
export async function listarPagosPendientes(
  cliente: ClienteEPT,
  usuarioId: string,
  alumnoId: string,
  senal?: AbortSignal,
): Promise<PagoPendienteDelPadre[]> {
  let perfil = cliente.from('perfiles').select('id').eq('user_id', usuarioId)
  if (senal) perfil = perfil.abortSignal(senal)
  const rPerfil = await perfil.maybeSingle()
  if (rPerfil.error || !rPerfil.data) throw new ErrorRespuestaCarga('No pudimos identificar tu perfil.')

  let pagos = cliente
    .from('pagos')
    .select('id,alumno_id,creado_en,fecha_transferencia,numero_operacion,total:total_calculado::text,importe:importe_informado::text')
    .eq('padre_id', rPerfil.data.id)
    .eq('alumno_id', alumnoId)
    .eq('estado', 'PENDIENTE_VERIFICACION')
    .order('creado_en', { ascending: false })
    .limit(50)
  if (senal) pagos = pagos.abortSignal(senal)
  const rPagos = await pagos
  if (rPagos.error) throw new ErrorRespuestaCarga('No pudimos consultar tus pagos.')
  const filas = (rPagos.data ?? []) as unknown as Record<string, unknown>[]
  if (filas.length === 0) return []

  const ids = filas.map(f => uuid(f.id, 'id'))
  let archivos = cliente.from('comprobantes_pago').select('pago_id').in('pago_id', ids)
  if (senal) archivos = archivos.abortSignal(senal)
  const rArchivos = await archivos
  if (rArchivos.error) throw new ErrorRespuestaCarga('No pudimos consultar tus comprobantes.')
  const conteo = new Map<string, number>()
  for (const f of (rArchivos.data ?? []) as { pago_id: string }[]) {
    conteo.set(f.pago_id, (conteo.get(f.pago_id) ?? 0) + 1)
  }

  return filas.map(f => {
    const informado = f.numero_operacion !== null && f.fecha_transferencia !== null && f.importe !== null
    return {
      pagoId: uuid(f.id, 'id'),
      alumnoId: uuid(f.alumno_id, 'alumno_id'),
      totalCentavos: aCentavos(f.total),
      creadoEn: texto(f.creado_en, 'creado_en'),
      datosTransferencia: informado
        ? {
            fecha: texto(f.fecha_transferencia, 'fecha_transferencia'),
            importeCentavos: aCentavos(f.importe),
            numero: texto(f.numero_operacion, 'numero_operacion'),
          }
        : null,
      archivos: conteo.get(uuid(f.id, 'id')) ?? 0,
    }
  })
}

/** Clave de una carga: UUID v4 por intento. No es un secreto; solo debe ser único por padre. */
export const generarClaveCarga = generarClaveIntento
