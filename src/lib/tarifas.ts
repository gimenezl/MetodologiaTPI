import { z } from 'zod'

/**
 * Contrato de las tarifas mensuales (EPT-103), compartido por el servidor, la
 * interfaz y las pruebas.
 *
 * Módulo puro: sin base de datos, sin `next/headers` y sin dependencias del
 * navegador, de modo que lo importan por igual los servicios de servidor, los
 * componentes cliente y una futura aplicación móvil.
 *
 * DINERO. Ningún importe pasa por `Number`, `parseFloat`, `toFixed` ni `Intl`:
 * viaja y se valida como texto decimal exacto. El formato canónico es el que
 * acepta la base de datos (`app_private.importe_tarifa_valido`):
 *
 *     ^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$
 *
 * ARS, hasta 10 dígitos enteros y 2 decimales (`NUMERIC(12,2)`), cero permitido.
 * La base vuelve a validar y es la autoridad; esto adelanta el mensaje.
 *
 * FECHAS. Fechas calendario `AAAA-MM-DD` (tipo DATE), sin zona horaria. La
 * vigencia es cerrada e inclusiva `[desde, hasta]` y `hasta` vacío significa sin
 * fin. Se formatean a mano (`dd/mm/aaaa`) y no con `Intl`: el reloj y el idioma de
 * Node y del navegador difieren y rompen la hidratación.
 */

// ----------------------------------------------------------------
// Conceptos y referencias
// ----------------------------------------------------------------

export const CONCEPTOS_TARIFA = ['CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR'] as const
export type ConceptoTarifa = (typeof CONCEPTOS_TARIFA)[number]

export const TITULO_CONCEPTO: Record<ConceptoTarifa, string> = {
  CUOTA: 'Cuota por nivel educativo',
  DEPORTE: 'Deportes',
  TRANSPORTE: 'Transporte',
  COMEDOR: 'Comedor',
}

/** Etiqueta singular de la referencia de cada concepto. */
export const ETIQUETA_REFERENCIA: Record<ConceptoTarifa, string> = {
  CUOTA: 'Nivel',
  DEPORTE: 'Deporte',
  TRANSPORTE: 'Recorrido',
  COMEDOR: 'Servicio',
}

export type ReferenciaTarifa = {
  nivel_id: number | null
  deporte_id: string | null
  servicio_id: string | null
}

const ID_ENTERO = /^[1-9][0-9]{0,9}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const ENTERO_MAXIMO = 2_147_483_647

/**
 * Traduce el identificador único de referencia que viaja por HTTP (`referencia_id`)
 * a la columna que corresponde al concepto. Devuelve `null` si no tiene la forma
 * de ese concepto (la cuota usa el id entero del nivel; el resto, un UUID).
 */
export function referenciaDe(
  concepto: ConceptoTarifa,
  referenciaId: string
): ReferenciaTarifa | null {
  if (concepto === 'CUOTA') {
    if (!ID_ENTERO.test(referenciaId)) return null
    const nivel = Number(referenciaId)
    if (!Number.isSafeInteger(nivel) || nivel > ENTERO_MAXIMO) return null
    return { nivel_id: nivel, deporte_id: null, servicio_id: null }
  }
  if (!UUID.test(referenciaId)) return null
  const id = referenciaId.toLowerCase()
  return concepto === 'DEPORTE'
    ? { nivel_id: null, deporte_id: id, servicio_id: null }
    : { nivel_id: null, deporte_id: null, servicio_id: id }
}

// ----------------------------------------------------------------
// Importe
// ----------------------------------------------------------------

export const IMPORTE_MAXIMO_ARS = '9999999999.99'

const IMPORTE_CANONICO = /^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$/u

export type ResultadoImporte = { ok: true; valor: string } | { ok: false; mensaje: string }

export const MENSAJES_IMPORTE = {
  vacio: 'Ingresá el importe de la tarifa.',
  negativo: 'El importe no puede ser negativo.',
  formato:
    'El importe tiene un formato no soportado. Usá solo dígitos y una coma o un punto para los decimales, por ejemplo 1234,50.',
  ambiguo:
    'No uses separadores de miles ni más de una coma o punto. Escribí el importe así: 1234,50.',
  decimales: 'El importe admite como máximo dos decimales.',
  maximo: 'El importe supera el máximo permitido (9999999999,99).',
  ceros: 'El importe no debe empezar con ceros a la izquierda.',
} as const

/**
 * Normaliza lo que escribió la persona al formato canónico, sin redondear ni
 * adivinar. Reglas explícitas:
 *
 *   · se recortan los espacios de los extremos (nada más);
 *   · un único separador, coma o punto, es el separador decimal: `1234,5` y
 *     `1234.5` son lo mismo (`1234.5`);
 *   · dos separadores o más (`1.234,50`, `1,234.50`, `1.234.567`) son ambiguos y se
 *     rechazan: no se interpreta ningún separador de miles;
 *   · letras, `NaN`, `Infinity`, notación exponencial (`1e3`), signos y espacios
 *     internos se rechazan;
 *   · más de dos decimales se rechaza: `10.005` no pasa a `10.01`;
 *   · no se aceptan ceros a la izquierda ni más de 10 dígitos enteros.
 */
export function normalizarImporte(entrada: unknown): ResultadoImporte {
  if (typeof entrada !== 'string') return { ok: false, mensaje: MENSAJES_IMPORTE.vacio }
  const texto = entrada.trim()
  if (texto === '') return { ok: false, mensaje: MENSAJES_IMPORTE.vacio }

  if (/^-[0-9]+([.,][0-9]+)?$/u.test(texto)) {
    return { ok: false, mensaje: MENSAJES_IMPORTE.negativo }
  }
  if (!/^[0-9.,]+$/u.test(texto)) return { ok: false, mensaje: MENSAJES_IMPORTE.formato }

  const separadores = texto.match(/[.,]/gu)?.length ?? 0
  if (separadores > 1) return { ok: false, mensaje: MENSAJES_IMPORTE.ambiguo }

  const [enteros, decimales] = texto.split(/[.,]/u)
  if (enteros === '' || (separadores === 1 && (decimales ?? '') === '')) {
    return { ok: false, mensaje: MENSAJES_IMPORTE.formato }
  }
  if (enteros.length > 10) return { ok: false, mensaje: MENSAJES_IMPORTE.maximo }
  if ((decimales ?? '').length > 2) return { ok: false, mensaje: MENSAJES_IMPORTE.decimales }
  if (enteros.length > 1 && enteros.startsWith('0')) {
    return { ok: false, mensaje: MENSAJES_IMPORTE.ceros }
  }

  const canonico = decimales === undefined ? enteros : `${enteros}.${decimales}`
  return IMPORTE_CANONICO.test(canonico)
    ? { ok: true, valor: canonico }
    : { ok: false, mensaje: MENSAJES_IMPORTE.formato }
}

/** ¿El texto ya está en el formato canónico de la base? */
export function esImporteCanonico(valor: unknown): valor is string {
  return typeof valor === 'string' && IMPORTE_CANONICO.test(valor)
}

/** Agrupa los miles con punto, sobre texto: `1234567` -> `1.234.567`. */
function agruparMiles(enteros: string): string {
  return enteros.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
}

/**
 * Importe en formato visual es-AR, `$ 1.234,50`, a partir del texto decimal que
 * devuelve la base (`1234.50`). Siempre con dos decimales. Un valor que no tiene
 * la forma esperada se devuelve tal cual: nunca se inventa un número.
 */
export function formatearImporteArs(valor: string): string {
  if (!/^[0-9]+([.][0-9]{1,2})?$/u.test(valor)) return valor
  const [enteros, decimales = ''] = valor.split('.')
  return `$ ${agruparMiles(enteros)},${decimales.padEnd(2, '0')}`
}

/** Importe para precargar un campo editable: coma decimal, sin miles (`1234,50`). */
export function importeParaCampo(valor: string): string {
  if (!/^[0-9]+([.][0-9]{1,2})?$/u.test(valor)) return valor
  const [enteros, decimales = ''] = valor.split('.')
  return `${enteros},${decimales.padEnd(2, '0')}`
}

// ----------------------------------------------------------------
// Fechas
// ----------------------------------------------------------------

const FECHA_ISO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u

/** Verdadero solo para una fecha de calendario real en formato `AAAA-MM-DD`. */
export function esFechaIsoReal(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false
  const partes = FECHA_ISO.exec(valor)
  if (!partes) return false
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])]
  if (anio < 1900 || mes < 1 || mes > 12 || dia < 1) return false
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  )
}

/** `2029-07-01` -> `01/07/2029`. Un valor que no es fecha se devuelve tal cual. */
export function formatearFecha(valor: string): string {
  const partes = FECHA_ISO.exec(valor)
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor
}

function desplazarDia(valor: string, dias: number): string {
  const partes = FECHA_ISO.exec(valor)
  if (!partes) return valor
  const fecha = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])))
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha.toISOString().slice(0, 10)
}

/** Día anterior: para anunciar que la versión previa termina en D-1. */
export function diaAnterior(valor: string): string {
  return desplazarDia(valor, -1)
}

/** Texto de la vigencia cerrada: `Del 01/07/2029 al 31/12/2029` o `Desde el … sin fecha de fin`. */
export function textoVigencia(desde: string, hasta: string | null): string {
  return hasta === null
    ? `Desde el ${formatearFecha(desde)}, sin fecha de fin`
    : `Del ${formatearFecha(desde)} al ${formatearFecha(hasta)}`
}

export type EstadoVersion = 'VIGENTE' | 'FUTURA' | 'FINALIZADA'

/** Estado de una versión respecto de un día dado (`hoy`, `AAAA-MM-DD`), con extremos inclusivos. */
export function estadoDeVersion(
  version: { desde: string; hasta: string | null },
  hoy: string
): EstadoVersion {
  if (version.desde > hoy) return 'FUTURA'
  if (version.hasta !== null && version.hasta < hoy) return 'FINALIZADA'
  return 'VIGENTE'
}

/** Hoy en Argentina (`AAAA-MM-DD`), calculado en el servidor. */
export function hoyEnArgentina(ahora: Date = new Date()): string {
  const argentina = new Date(ahora.getTime() - 3 * 60 * 60 * 1000)
  return argentina.toISOString().slice(0, 10)
}

// ----------------------------------------------------------------
// Modelo que muestra la pantalla
// ----------------------------------------------------------------

export type VersionTarifa = {
  id: string
  /** Importe como texto decimal exacto (`1234.50`): nunca un número de doble precisión. */
  importe: string
  desde: string
  hasta: string | null
}

export type ReferenciaConTarifas = {
  /** `nivel_id` (cuota) o UUID del deporte o del servicio. */
  referencia_id: string
  nombre: string
  detalle: string | null
  activa: boolean
  /** De la más reciente a la más antigua. */
  versiones: VersionTarifa[]
}

export type GrupoTarifas = {
  concepto: ConceptoTarifa
  titulo: string
  referencias: ReferenciaConTarifas[]
}

export type CatalogoReferencia = {
  referencia_id: string
  nombre: string
  detalle: string | null
  activa: boolean
}

export type FilaTarifa = VersionTarifa & {
  concepto: ConceptoTarifa
  referencia_id: string
}

/**
 * Une el catálogo existente con las tarifas leídas, sin crear catálogos
 * paralelos: cada referencia es una fila ya existente de niveles, deportes o
 * servicios escolares. Una referencia sin tarifas aparece igual, con la lista
 * vacía, para poder cargar la primera.
 */
export function agruparTarifas(
  catalogos: Record<ConceptoTarifa, CatalogoReferencia[]>,
  tarifas: FilaTarifa[]
): GrupoTarifas[] {
  return CONCEPTOS_TARIFA.map((concepto) => ({
    concepto,
    titulo: TITULO_CONCEPTO[concepto],
    referencias: catalogos[concepto].map((referencia) => ({
      ...referencia,
      versiones: tarifas
        .filter((t) => t.concepto === concepto && t.referencia_id === referencia.referencia_id)
        .map(({ id, importe, desde, hasta }) => ({ id, importe, desde, hasta }))
        .sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0)),
    })),
  }))
}

// ----------------------------------------------------------------
// Esquemas de entrada (HTTP)
// ----------------------------------------------------------------

const MENSAJE_CONCEPTO = 'Elegí un concepto válido.'
const MENSAJE_REFERENCIA = 'Elegí la referencia de la tarifa.'
const MENSAJE_DESDE = 'Ingresá una fecha de inicio válida.'
const MENSAJE_HASTA = 'Ingresá una fecha de fin válida o dejala vacía.'

const conceptoSchema = z.enum(CONCEPTOS_TARIFA, { message: MENSAJE_CONCEPTO })

const importeSchema = z
  .string({ message: MENSAJES_IMPORTE.vacio })
  .transform((valor, contexto) => {
    const resultado = normalizarImporte(valor)
    if (!resultado.ok) {
      contexto.addIssue({ code: 'custom', message: resultado.mensaje })
      return z.NEVER
    }
    return resultado.valor
  })

const desdeSchema = z
  .string({ message: MENSAJE_DESDE })
  .refine((valor) => esFechaIsoReal(valor), MENSAJE_DESDE)

/** `hasta` ausente, nulo o vacío significa «sin fecha de fin». */
const hastaSchema = z
  .union([z.string(), z.null()], { message: MENSAJE_HASTA })
  .optional()
  .transform((valor) => (valor === undefined || valor === null || valor.trim() === '' ? null : valor))
  .refine((valor) => valor === null || esFechaIsoReal(valor), MENSAJE_HASTA)

/** Igual que `hastaSchema`, pero obligatorio: editar sin enviar el fin no puede borrarlo en silencio. */
const hastaRequeridoSchema = z
  .union([z.string(), z.null()], { message: MENSAJE_HASTA })
  .transform((valor) => (valor === null || valor.trim() === '' ? null : valor))
  .refine((valor) => valor === null || esFechaIsoReal(valor), MENSAJE_HASTA)

const referenciaIdSchema = z.string({ message: MENSAJE_REFERENCIA }).min(1, MENSAJE_REFERENCIA)

const MENSAJE_ORDEN = 'La fecha de fin no puede ser anterior a la de inicio.'

function ordenValido(valor: { desde: string; hasta: string | null }): boolean {
  return valor.hasta === null || valor.hasta >= valor.desde
}

const vigenciaNueva = {
  concepto: conceptoSchema,
  referencia_id: referenciaIdSchema,
  importe: importeSchema,
  desde: desdeSchema,
  hasta: hastaSchema,
}

function conReferencia<T extends { concepto: ConceptoTarifa; referencia_id: string }>(
  valor: T,
  contexto: z.RefinementCtx
) {
  if (referenciaDe(valor.concepto, valor.referencia_id) === null) {
    contexto.addIssue({ code: 'custom', message: MENSAJE_REFERENCIA, path: ['referencia_id'] })
  }
}

/**
 * Alta de una versión. `.strict()` rechaza cualquier campo de identidad (actor,
 * rol, perfil): la autoridad sale de la sesión, nunca del cuerpo.
 */
export const crearTarifaSchema = z
  .object(vigenciaNueva)
  .strict()
  .superRefine(conReferencia)
  .refine(ordenValido, { message: MENSAJE_ORDEN, path: ['hasta'] })
export type CrearTarifaData = z.infer<typeof crearTarifaSchema>

/** Cambio de precio: misma forma que el alta; la base cierra la versión vigente en D-1. */
export const cambiarTarifaSchema = crearTarifaSchema
export type CambiarTarifaData = CrearTarifaData

const valoresPreviosSchema = z
  .object({
    importe: importeSchema,
    desde: desdeSchema,
    hasta: hastaRequeridoSchema,
  })
  .strict()

/**
 * Edición de una versión: el concepto y la referencia no se aceptan (son su
 * identidad) y se exigen los valores que la persona vio, para detectar un cambio
 * hecho por otra en el medio.
 */
export const actualizarTarifaSchema = z
  .object({
    importe: importeSchema,
    desde: desdeSchema,
    hasta: hastaRequeridoSchema,
    previo: valoresPreviosSchema,
  })
  .strict()
  .refine(ordenValido, { message: MENSAJE_ORDEN, path: ['hasta'] })
export type ActualizarTarifaData = z.infer<typeof actualizarTarifaSchema>

export const tarifaIdSchema = z.string().regex(UUID, 'Identificador de tarifa inválido')

export type CampoTarifa = 'concepto' | 'referencia_id' | 'importe' | 'desde' | 'hasta'

const CAMPOS_TARIFA = new Set<string>(['concepto', 'referencia_id', 'importe', 'desde', 'hasta'])

/** Primer error de un esquema, con el campo de formulario al que corresponde. */
export function primerErrorTarifas(error: z.ZodError): { mensaje: string; campo?: CampoTarifa } {
  const issue = error.issues[0]
  if (!issue) return { mensaje: 'Datos inválidos' }
  if (issue.code === 'unrecognized_keys') {
    return { mensaje: 'La petición contiene campos no permitidos' }
  }
  const primero = issue.path[0]
  const campo =
    typeof primero === 'string' && CAMPOS_TARIFA.has(primero) ? (primero as CampoTarifa) : undefined
  if (issue.code === 'invalid_type' && campo === undefined) return { mensaje: 'Datos inválidos' }
  return { mensaje: issue.message, campo }
}
