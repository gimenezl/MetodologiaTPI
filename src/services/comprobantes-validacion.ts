import { createHash } from 'node:crypto'
import {
  TAMANO_MAXIMO_BYTES,
  type TipoComprobante,
} from '@/lib/comprobantes-contrato'

/**
 * Validación del CONTENIDO de un comprobante (EPT-109), del lado del servidor.
 *
 * Ni la extensión, ni el MIME declarado, ni el tamaño que informa el cliente
 * prueban qué hay en los bytes: esta función los lee y comprueba que el archivo
 * es realmente del tipo declarado y que su estructura es coherente.
 *
 *   · JPEG y PNG se decodifican por completo con libvips (sharp), con un tope de
 *     píxeles que corta las bombas de descompresión. El PNG, además, se recorre
 *     chunk por chunk con su CRC.
 *   · PDF: cabecera, cola `startxref` + `%%EOF` apuntando a una tabla de
 *     referencias real, apertura con pdf.js (sin evaluar código), al menos una
 *     página, sin cifrado, sin JavaScript ni archivos incrustados.
 *
 * NO es un antivirus. No detecta malware en general: acota el formato y rechaza
 * los elementos activos más comunes de un PDF. Los PDF con contenido activo
 * oculto en flujos que pdf.js no interpreta no se pueden descartar por completo.
 */

export type CodigoRechazoBinario =
  | 'ARCHIVO_VACIO'
  | 'ARCHIVO_DEMASIADO_GRANDE'
  | 'TIPO_NO_PERMITIDO'
  | 'CONTENIDO_NO_COINCIDE'
  | 'ARCHIVO_CORRUPTO'
  | 'ARCHIVO_PROTEGIDO'
  | 'CONTENIDO_ACTIVO'

export type ResultadoValidacionBinaria =
  | { ok: true; tipo: TipoComprobante; tamano: number; sha256: string }
  | { ok: false; codigo: CodigoRechazoBinario; mensaje: string }

const MENSAJES: Readonly<Record<CodigoRechazoBinario, string>> = {
  ARCHIVO_VACIO: 'El archivo está vacío.',
  ARCHIVO_DEMASIADO_GRANDE: 'El archivo supera el máximo de 5 MB.',
  TIPO_NO_PERMITIDO: 'El archivo no es una imagen JPG, PNG ni un PDF.',
  CONTENIDO_NO_COINCIDE: 'El contenido del archivo no coincide con el tipo indicado.',
  ARCHIVO_CORRUPTO: 'El archivo está dañado o incompleto. Elegí otro archivo.',
  ARCHIVO_PROTEGIDO: 'El PDF está protegido con contraseña. Elegí un archivo sin protección.',
  CONTENIDO_ACTIVO: 'El PDF contiene scripts o archivos incrustados, que no se aceptan.',
}

const rechazo = (codigo: CodigoRechazoBinario): ResultadoValidacionBinaria => ({
  ok: false,
  codigo,
  mensaje: MENSAJES[codigo],
})

/** Techo de píxeles decodificados: 40 MP cubre cualquier cámara de teléfono. */
const PIXELES_MAXIMOS = 40_000_000
/** Techo de tiempo para abrir un PDF. */
const TIEMPO_MAXIMO_PDF_MS = 10_000

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Tipo según la firma de los primeros bytes (solo un paso: la estructura se valida después). */
export function detectarTipo(bytes: Uint8Array): TipoComprobante | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 8 && FIRMA_PNG.every((b, i) => bytes[i] === b)) return 'image/png'
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return 'application/pdf'
  }
  return null
}

// ---------------------------------------------------------------------------
// PNG: estructura de chunks con CRC
// ---------------------------------------------------------------------------
const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[n] = c >>> 0
  }
  return tabla
})()

function crc32(bytes: Uint8Array, desde: number, hasta: number): number {
  let c = 0xffffffff
  for (let i = desde; i < hasta; i += 1) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function estructuraPngValida(bytes: Uint8Array): boolean {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  let primero = true
  let hayDatos = false
  while (pos + 12 <= bytes.length) {
    const largo = vista.getUint32(pos)
    const tipo = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    const finDatos = pos + 8 + largo
    if (finDatos + 4 > bytes.length) return false
    if (crc32(bytes, pos + 4, finDatos) !== vista.getUint32(finDatos)) return false
    if (primero) {
      if (tipo !== 'IHDR' || largo !== 13) return false
      if (vista.getUint32(pos + 8) === 0 || vista.getUint32(pos + 12) === 0) return false
      primero = false
    }
    if (tipo === 'IDAT') hayDatos = true
    pos = finDatos + 4
    if (tipo === 'IEND') return largo === 0 && hayDatos && pos === bytes.length
  }
  return false
}

// ---------------------------------------------------------------------------
// Imágenes: decodificación completa con libvips
// ---------------------------------------------------------------------------
async function imagenDecodificable(bytes: Uint8Array, formato: 'jpeg' | 'png'): Promise<boolean> {
  const { default: sharp } = await import('sharp')
  try {
    const imagen = sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      failOn: 'warning',
      limitInputPixels: PIXELES_MAXIMOS,
      sequentialRead: true,
    })
    const meta = await imagen.metadata()
    if (meta.format !== formato || !meta.width || !meta.height) return false
    // `stats()` obliga a decodificar todos los píxeles sin construir otra imagen.
    await imagen.stats()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
const PDF_CABECERA = /^%PDF-(?:1\.[0-7]|2\.0)(?:[\r\n]|$)/u
const PDF_ACTIVO = /\/(?:JavaScript|Launch|EmbeddedFile|RichMedia)\b/u

/** `startxref` + `%%EOF` al final, y el offset apunta a una tabla `xref` o a un objeto de flujo. */
export function colaPdfValida(bytes: Uint8Array): boolean {
  const cola = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 2048))).toString('latin1')
  const m = /startxref\s+([0-9]{1,12})\s+%%EOF\s*$/u.exec(cola)
  if (!m) return false
  const offset = Number(m[1])
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= bytes.length) return false
  const destino = Buffer.from(bytes.subarray(offset, Math.min(bytes.length, offset + 64))).toString('latin1')
  return /^(?:xref\b|[0-9]{1,10}\s+[0-9]{1,5}\s+obj\b)/u.test(destino)
}

async function pdfValido(bytes: Uint8Array): Promise<CodigoRechazoBinario | null> {
  if (!PDF_CABECERA.test(Buffer.from(bytes.subarray(0, 16)).toString('latin1'))) return 'ARCHIVO_CORRUPTO'
  if (!colaPdfValida(bytes)) return 'ARCHIVO_CORRUPTO'
  if (PDF_ACTIVO.test(Buffer.from(bytes).toString('latin1'))) return 'CONTENIDO_ACTIVO'

  const { getDocumentProxy } = await import('unpdf')
  let temporizador: ReturnType<typeof setTimeout> | undefined
  try {
    const trabajo = (async (): Promise<CodigoRechazoBinario | null> => {
      // pdf.js transfiere (desacopla) el buffer: se le entrega una copia.
      // `isEvalSupported` existe en pdf.js pero no en el tipo público de unpdf.
      const opciones = {
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0,
      }
      const pdf = await getDocumentProxy(new Uint8Array(bytes), opciones)
      if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) return 'ARCHIVO_CORRUPTO'
      await pdf.getPage(1)
      const js = await pdf.getJSActions()
      if (js && Object.keys(js).length > 0) return 'CONTENIDO_ACTIVO'
      const adjuntos = await pdf.getAttachments()
      if (adjuntos && Object.keys(adjuntos).length > 0) return 'CONTENIDO_ACTIVO'
      return null
    })()
    const limite = new Promise<CodigoRechazoBinario>((resolver) => {
      temporizador = setTimeout(() => resolver('ARCHIVO_CORRUPTO'), TIEMPO_MAXIMO_PDF_MS)
    })
    return await Promise.race([trabajo, limite])
  } catch (error) {
    const nombre = error instanceof Error ? error.name : ''
    if (nombre === 'PasswordException') return 'ARCHIVO_PROTEGIDO'
    return 'ARCHIVO_CORRUPTO'
  } finally {
    if (temporizador) clearTimeout(temporizador)
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------
/**
 * Valida los bytes de un comprobante contra el tipo declarado. Devuelve el SHA-256
 * de ESOS bytes: es el que se registra y el que identifica el objeto publicado.
 */
export async function validarComprobante(
  bytes: Uint8Array,
  declarado: TipoComprobante
): Promise<ResultadoValidacionBinaria> {
  if (bytes.length === 0) return rechazo('ARCHIVO_VACIO')
  if (bytes.length > TAMANO_MAXIMO_BYTES) return rechazo('ARCHIVO_DEMASIADO_GRANDE')

  const detectado = detectarTipo(bytes)
  if (!detectado) return rechazo('TIPO_NO_PERMITIDO')
  if (detectado !== declarado) return rechazo('CONTENIDO_NO_COINCIDE')

  if (detectado === 'application/pdf') {
    const problema = await pdfValido(bytes)
    if (problema) return rechazo(problema)
  } else if (detectado === 'image/png') {
    if (!estructuraPngValida(bytes) || !(await imagenDecodificable(bytes, 'png'))) {
      return rechazo('ARCHIVO_CORRUPTO')
    }
  } else if (!(await imagenDecodificable(bytes, 'jpeg'))) {
    return rechazo('ARCHIVO_CORRUPTO')
  }

  return {
    ok: true,
    tipo: detectado,
    tamano: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
