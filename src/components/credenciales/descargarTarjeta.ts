/**
 * Descarga de la tarjeta como PNG (EPT-64). Solo navegador.
 *
 * Dibuja la tarjeta en un canvas del tamaño de una tarjeta ID-1 (85,6 × 54 mm)
 * a 300 ppp. No agrega nada que la pantalla no muestre: nombre, apellido,
 * legajo y el QR. No incluye DNI ni foto.
 */

const ANCHO = 1011
const ALTO = 638
const COLOR_MARCA = '#1d3fbf'
const COLOR_TEXTO = '#111827'
const COLOR_SECUNDARIO = '#374151'

export type DatosTarjeta = {
  nombre: string
  apellido: string
  legajo: string | null
  /** URI de datos (SVG) del QR. */
  qr: string
}

function cargarImagen(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const imagen = new Image()
    imagen.onload = () => resolver(imagen)
    imagen.onerror = () => rechazar(new Error('No se pudo cargar la imagen del código QR.'))
    imagen.src = uri
  })
}

/** Nombre de archivo seguro: solo ASCII en minúsculas, sin datos que no sean del alumno. */
export function nombreDeArchivo(datos: Pick<DatosTarjeta, 'nombre' | 'apellido'>): string {
  const base = `${datos.apellido} ${datos.nombre}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `credencial-${base || 'alumno'}.png`
}

export async function generarPngDeTarjeta(datos: DatosTarjeta): Promise<Blob> {
  const imagenQr = await cargarImagen(datos.qr)
  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO
  lienzo.height = ALTO
  const contexto = lienzo.getContext('2d')
  if (!contexto) throw new Error('El navegador no permite generar la imagen.')

  contexto.fillStyle = '#ffffff'
  contexto.fillRect(0, 0, ANCHO, ALTO)

  contexto.fillStyle = COLOR_MARCA
  contexto.fillRect(0, 0, ANCHO, 96)
  contexto.fillStyle = '#ffffff'
  contexto.font = '700 38px system-ui, -apple-system, "Segoe UI", sans-serif'
  contexto.textBaseline = 'middle'
  contexto.fillText('Educar para Transformar', 40, 50)

  // El QR ocupa un cuadrado con su zona silenciosa incluida (la trae el propio SVG).
  const lado = 480
  const x = ANCHO - lado - 40
  const y = 96 + (ALTO - 96 - lado) / 2
  contexto.imageSmoothingEnabled = false
  contexto.drawImage(imagenQr, x, y, lado, lado)

  contexto.textBaseline = 'alphabetic'
  contexto.fillStyle = COLOR_SECUNDARIO
  contexto.font = '600 28px system-ui, -apple-system, "Segoe UI", sans-serif'
  contexto.fillText('CREDENCIAL DIGITAL', 40, 190)

  contexto.fillStyle = COLOR_TEXTO
  contexto.font = '700 54px system-ui, -apple-system, "Segoe UI", sans-serif'
  contexto.fillText(datos.nombre, 40, 290, x - 80)
  contexto.fillText(datos.apellido, 40, 360, x - 80)

  contexto.fillStyle = COLOR_SECUNDARIO
  contexto.font = '600 34px system-ui, -apple-system, "Segoe UI", sans-serif'
  contexto.fillText(datos.legajo ? `Legajo: ${datos.legajo}` : 'Sin legajo', 40, 440, x - 80)

  contexto.font = '500 24px system-ui, -apple-system, "Segoe UI", sans-serif'
  contexto.fillText('Código QR personal. No lo compartas.', 40, ALTO - 40, x - 80)

  return new Promise((resolver, rechazar) => {
    lienzo.toBlob(
      (blob) => (blob ? resolver(blob) : rechazar(new Error('No se pudo generar la imagen.'))),
      'image/png'
    )
  })
}

/** Genera el PNG y dispara la descarga del navegador. */
export async function descargarTarjeta(datos: DatosTarjeta): Promise<void> {
  const blob = await generarPngDeTarjeta(datos)
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreDeArchivo(datos)
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  // Se libera en el turno siguiente para no cancelar la descarga en curso.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
