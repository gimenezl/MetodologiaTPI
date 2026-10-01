/**
 * Decodificación del QR en el dispositivo (EPT-65). Solo navegador.
 *
 * Todo ocurre localmente: ningún cuadro de video ni ninguna fotografía se sube
 * al servidor, se guarda o se registra. Solo el TEXTO del QR, ya decodificado,
 * viaja en el cuerpo de una petición.
 *
 * Usa `decodeQR` de la dependencia `qr` (ya instalada para generar la tarjeta de
 * EPT-64). No depende de `BarcodeDetector`: su disponibilidad varía (Chrome para
 * Android lo trae, Safari para iOS lo tiene deshabilitado por defecto y Firefox
 * para Android no lo ofrece).
 */

export type ImagenPixeles = { width: number; height: number; data: Uint8ClampedArray }

/** Tope del archivo de una fotografía, para acotar memoria y tiempo. */
export const BYTES_MAXIMOS_FOTO = 15 * 1024 * 1024

/** Lados máximos que se prueban, del más fino al más tosco (el decodificador es sensible a la escala). */
const ESCALAS_DE_FOTO = [1600, 1000, 640] as const

export async function decodificarPixeles(imagen: ImagenPixeles): Promise<string | null> {
  const { decodeQR } = await import('qr/decode.js')
  try {
    const texto = decodeQR(imagen)
    return typeof texto === 'string' && texto.length > 0 ? texto : null
  } catch {
    // «No se encontró ningún QR» es el caso normal de casi todos los cuadros.
    return null
  }
}

function dibujar(
  fuente: CanvasImageSource,
  ancho: number,
  alto: number,
  maximo: number
): ImageData | null {
  const escala = Math.min(1, maximo / Math.max(ancho, alto))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.max(1, Math.round(ancho * escala))
  lienzo.height = Math.max(1, Math.round(alto * escala))
  const contexto = lienzo.getContext('2d', { willReadFrequently: true })
  if (!contexto) return null
  contexto.drawImage(fuente, 0, 0, lienzo.width, lienzo.height)
  const imagen = contexto.getImageData(0, 0, lienzo.width, lienzo.height)
  // Se suelta el lienzo ya: no queda ninguna copia de la imagen.
  lienzo.width = 0
  lienzo.height = 0
  return imagen
}

/**
 * Lee un QR de una fotografía. Devuelve `null` si no hay un QR legible y lanza
 * si el archivo no es una imagen utilizable.
 */
export async function decodificarArchivo(archivo: File): Promise<string | null> {
  if (!archivo.type.startsWith('image/') || archivo.size === 0 || archivo.size > BYTES_MAXIMOS_FOTO) {
    throw new Error('archivo no utilizable')
  }
  const fuente = await abrirImagen(archivo)
  try {
    for (const maximo of ESCALAS_DE_FOTO) {
      const imagen = dibujar(fuente.imagen, fuente.ancho, fuente.alto, maximo)
      if (!imagen) continue
      const texto = await decodificarPixeles(imagen)
      if (texto) return texto
    }
    return null
  } finally {
    fuente.liberar()
  }
}

type ImagenAbierta = { imagen: CanvasImageSource; ancho: number; alto: number; liberar: () => void }

/**
 * Abre la fotografía con el mejor método disponible. `createImageBitmap` con
 * orientación EXIF es lo ideal (una foto vertical de iPhone llega girada sin
 * ella); si el navegador no admite la opción se prueba sin ella, y como último
 * recurso se carga con un `<img>` (los navegadores aplican allí la orientación).
 */
async function abrirImagen(archivo: File): Promise<ImagenAbierta> {
  for (const opciones of [{ imageOrientation: 'from-image' as const }, undefined]) {
    try {
      const mapa = await (opciones ? createImageBitmap(archivo, opciones) : createImageBitmap(archivo))
      return { imagen: mapa, ancho: mapa.width, alto: mapa.height, liberar: () => mapa.close() }
    } catch {
      // Se prueba el siguiente método.
    }
  }
  const direccion = URL.createObjectURL(archivo)
  try {
    const elemento = new Image()
    elemento.decoding = 'async'
    elemento.src = direccion
    await elemento.decode()
    return {
      imagen: elemento,
      ancho: elemento.naturalWidth,
      alto: elemento.naturalHeight,
      liberar: () => URL.revokeObjectURL(direccion),
    }
  } catch (error) {
    URL.revokeObjectURL(direccion)
    throw error
  }
}

/** Un cuadro de video, reducido para decodificar rápido. */
export function leerCuadro(video: HTMLVideoElement, maximo = 720): ImageData | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null
  return dibujar(video, video.videoWidth, video.videoHeight, maximo)
}

/**
 * UUID v4 para el `intento_id`. `crypto.randomUUID` solo existe en contextos
 * seguros; la fotografía sirve también por HTTP en una red local, así que hay un
 * respaldo con `getRandomValues`.
 */
export function generarUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
