// GENERADO por mobile/scripts/sync-compartido.mjs desde src/lib/comprobantes-contrato.ts. No editar a mano.
// sha256 de la fuente: 55b114b67bb1ac3c5206f9986066af7fa9f725e19a8729d89d94166d7e76e6b5
/**
 * Contrato de la carga de comprobantes de transferencia (EPT-109).
 *
 * Módulo PURO y autocontenido: lo copia `mobile/scripts/sync-compartido.mjs` a la
 * app móvil, así que la aplicación y el servidor aplican exactamente los mismos
 * tipos, límite y reglas de formato. Ninguna regla de acá reemplaza a la
 * validación del servidor y de la base: es el contrato que ambos comparten.
 *
 * No importar nada: la copia móvil debe ser autocontenida.
 */

/** 5 MiB = 5 * 1024 * 1024. Igual que el CHECK de la tabla y el límite del bucket. */
export const TAMANO_MAXIMO_BYTES = 5_242_880

export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'application/pdf'] as const
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number]

export const EXTENSION_POR_TIPO: Readonly<Record<TipoComprobante, 'jpg' | 'png' | 'pdf'>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const BUCKET_TEMPORAL = 'comprobantes-pago-temporal'
export const BUCKET_FINAL = 'comprobantes-pago'

/** Una carga sin completar vence a las 24 h; la conciliación la cierra. */
export const VENCIMIENTO_CARGA_HORAS = 24

export function esTipoComprobante(valor: unknown): valor is TipoComprobante {
  return typeof valor === 'string' && (TIPOS_COMPROBANTE as readonly string[]).includes(valor)
}

/** Tipo permitido según la extensión del nombre. Solo una ayuda de interfaz: nunca prueba el contenido. */
export function tipoDesdeNombre(nombre: string): TipoComprobante | null {
  const m = /\.([A-Za-z0-9]{1,5})$/u.exec(nombre.trim())
  switch (m?.[1]?.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'pdf':
      return 'application/pdf'
    default:
      return null
  }
}

export type CodigoArchivo = 'TIPO_NO_PERMITIDO' | 'ARCHIVO_VACIO' | 'ARCHIVO_DEMASIADO_GRANDE'

export const MENSAJE_ARCHIVO: Readonly<Record<CodigoArchivo, string>> = {
  TIPO_NO_PERMITIDO: 'El tipo de archivo no está permitido. Elegí una imagen JPG o PNG, o un PDF.',
  ARCHIVO_VACIO: 'El archivo está vacío.',
  ARCHIVO_DEMASIADO_GRANDE: 'El archivo supera el máximo de 5 MB.',
}

export type ResultadoArchivo =
  | { ok: true; tipo: TipoComprobante }
  | { ok: false; codigo: CodigoArchivo; mensaje: string }

/** Comprobación previa del archivo declarado (tipo y tamaño). Es la misma que repite el servidor. */
export function validarArchivoDeclarado(tipo: unknown, tamano: unknown): ResultadoArchivo {
  if (!esTipoComprobante(tipo)) {
    return { ok: false, codigo: 'TIPO_NO_PERMITIDO', mensaje: MENSAJE_ARCHIVO.TIPO_NO_PERMITIDO }
  }
  if (typeof tamano !== 'number' || !Number.isSafeInteger(tamano) || tamano <= 0) {
    return { ok: false, codigo: 'ARCHIVO_VACIO', mensaje: MENSAJE_ARCHIVO.ARCHIVO_VACIO }
  }
  if (tamano > TAMANO_MAXIMO_BYTES) {
    return {
      ok: false,
      codigo: 'ARCHIVO_DEMASIADO_GRANDE',
      mensaje: MENSAJE_ARCHIVO.ARCHIVO_DEMASIADO_GRANDE,
    }
  }
  return { ok: true, tipo }
}

// ---------------------------------------------------------------------------
// Datos de la transferencia
// ---------------------------------------------------------------------------

export type ResultadoDato<T> = { ok: true; valor: T } | { ok: false; mensaje: string }

/**
 * Importe a texto decimal con punto: es lo que recibe la base, que lo valida otra
 * vez ANTES del cast. Acepta un único separador decimal (coma o punto) con uno o
 * dos decimales. No acepta separadores de miles, signo ni notación científica,
 * para no interpretar mal un valor: «1.500» se rechaza en lugar de adivinar si
 * son mil quinientos o uno con cinco. NO redondea.
 */
export function normalizarImporteTransferencia(texto: string): ResultadoDato<string> {
  const limpio = texto.trim()
  const m = /^([0-9]{1,10})(?:[.,]([0-9]{1,2}))?$/u.exec(limpio)
  if (!m) {
    return {
      ok: false,
      mensaje: 'Escribí el importe con hasta dos decimales, por ejemplo 15000,50.',
    }
  }
  // «1.500» (tres dígitos tras el separador) no entra en la expresión anterior.
  const entero = m[1].replace(/^0+(?=[0-9])/u, '')
  return { ok: true, valor: m[2] === undefined ? entero : `${entero}.${m[2]}` }
}

/** Centavos exactos de un importe ya normalizado ("15000.50"). */
export function centavosDeImporte(normalizado: string): number {
  const [entero, decimales = ''] = normalizado.split('.')
  return Number(entero) * 100 + Number(decimales.padEnd(2, '0'))
}

/** Fecha civil AAAA-MM-DD existente. No prohíbe fechas futuras: no es una regla aprobada. */
export function validarFechaTransferencia(texto: string): ResultadoDato<string> {
  const limpio = texto.trim()
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(limpio)
  if (m) {
    const anio = Number(m[1])
    const mes = Number(m[2])
    const dia = Number(m[3])
    const f = new Date(Date.UTC(anio, mes - 1, dia))
    if (
      anio >= 1 &&
      f.getUTCFullYear() === anio &&
      f.getUTCMonth() === mes - 1 &&
      f.getUTCDate() === dia
    ) {
      return { ok: true, valor: limpio }
    }
  }
  return { ok: false, mensaje: 'La fecha no es válida. Usá el formato AAAA-MM-DD.' }
}

/**
 * Número de operación: texto no vacío con la normalización existente (recorte de
 * espacios, tabulaciones y saltos de línea; sin tocar mayúsculas). El único tope
 * es técnico: el índice único es un B-tree y sus entradas no superan ~2700 bytes.
 */
export function validarNumeroOperacion(texto: string): ResultadoDato<string> {
  const limpio = texto.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, '')
  if (limpio === '') return { ok: false, mensaje: 'Ingresá el número de operación.' }
  if (new TextEncoder().encode(limpio).length > 2000) {
    return { ok: false, mensaje: 'El número de operación es demasiado largo.' }
  }
  return { ok: true, valor: limpio }
}

// ---------------------------------------------------------------------------
// Resultados de la carga (los devuelven la base y el servidor)
// ---------------------------------------------------------------------------

export type EstadoCarga = 'PREPARADA' | 'CONFIRMADA' | 'DESCARTADA' | 'EXPIRADA'

export type MotivoDescarte =
  | 'ARCHIVO_INVALIDO'
  | 'CONTENIDO_NO_COINCIDE'
  | 'ARCHIVO_AUSENTE'
  | 'PAGO_NO_PENDIENTE'
  | 'OPERACION_DUPLICADA'
  | 'DATOS_DIFERENTES'
  | 'VINCULO_REVOCADO'
  | 'CUENTA_NO_HABILITADA'
  | 'EXPIRADA'
  | 'ABANDONADA'

export const MENSAJE_DESCARTE: Readonly<Record<MotivoDescarte, string>> = {
  ARCHIVO_INVALIDO:
    'El archivo está dañado o no es una imagen JPG, PNG ni un PDF válido. Elegí otro archivo.',
  CONTENIDO_NO_COINCIDE: 'El contenido del archivo no coincide con su tipo. Elegí otro archivo.',
  ARCHIVO_AUSENTE: 'El archivo no llegó al servidor. Volvé a intentarlo.',
  PAGO_NO_PENDIENTE: 'El pago ya no está pendiente de verificación, no se pueden agregar archivos.',
  OPERACION_DUPLICADA: 'Ese número de operación ya está registrado en otro pago.',
  DATOS_DIFERENTES:
    'Los datos de la transferencia difieren de los ya informados para este pago. No se modifican.',
  VINCULO_REVOCADO: 'Ya no tenés este hijo vinculado a tu cuenta.',
  CUENTA_NO_HABILITADA: 'Tu cuenta no está habilitada para cargar comprobantes.',
  EXPIRADA: 'La carga venció. Iniciá una nueva.',
  ABANDONADA: 'La carga se canceló. Iniciá una nueva.',
}

/** Códigos SQLSTATE propios de la preparación (migración EPT-109). */
export type CodigoPreparacion =
  | 'P6860'
  | 'P6861'
  | 'P6862'
  | 'P6863'
  | 'P6864'
  | 'P6865'
  | 'P6866'
  | 'P6868'
  | 'DENEGADO'
  | 'OTRO'

export const MENSAJE_PREPARACION: Readonly<Record<CodigoPreparacion, string>> = {
  P6860: 'Revisá los datos del archivo y de la transferencia.',
  P6861: 'El pago no existe o no está disponible para tu cuenta.',
  P6862: 'El pago ya no está pendiente de verificación.',
  P6863: 'Ese número de operación ya está registrado en otro pago.',
  P6864: 'Esta carga ya se registró con otros datos. Iniciá una carga nueva.',
  P6865: 'Los datos difieren de los ya informados para este pago. No se modifican.',
  P6866: 'La carga no existe o venció. Iniciá una nueva.',
  P6868: 'Tenés demasiadas cargas sin completar. Terminalas o volvé a intentar en una hora.',
  DENEGADO: 'Tu cuenta no está habilitada para cargar comprobantes.',
  OTRO: 'No se pudo preparar la carga. Volvé a intentarlo.',
}
