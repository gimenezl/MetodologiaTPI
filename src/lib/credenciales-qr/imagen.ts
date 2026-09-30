import { encodeQR } from 'qr'

/**
 * Imagen del QR (EPT-64, RF20).
 *
 * Generar la imagen NO es validar la credencial: acá no se firma ni se verifica
 * nada, solo se dibuja el texto que ya construyó `construirPayload`.
 *
 * Librería: `qr` 0.7.2 (MIT o Apache-2.0, sin dependencias, con tipos
 * propios). Es la sucesora del paquete `@paulmillr/qr`, que su autor deprecó
 * («para recibir actualizaciones de seguridad, usar `qr`»). Se usa únicamente la salida `raw`
 * (matriz booleana) y el SVG lo arma este módulo, para controlar la zona
 * silenciosa, el contraste y el peso: la salida SVG de la librería dibuja un
 * `<rect>` por módulo (≈29 KB) y no incluye fondo.
 *
 * El SVG resultante:
 *  - tiene fondo blanco y módulos negros (contraste máximo; no depende del tema);
 *  - reserva una zona silenciosa de 4 módulos, el mínimo de la norma ISO/IEC 18004;
 *  - usa un único `<path>` (unos pocos KB);
 *  - NO lleva `<title>`, `<desc>` ni atributos de texto: el payload no aparece
 *    como texto en ningún atributo. El nombre accesible lo pone quien lo usa.
 */

/** Zona silenciosa mínima que exige la norma, en módulos. */
export const ZONA_SILENCIOSA = 4

/** Corrección de errores media: buen equilibrio entre densidad y tolerancia al desgaste. */
const CORRECCION = 'medium'

/** SVG (texto) a partir de una matriz de módulos; `true` es un módulo oscuro. */
export function svgDesdeMatriz(matriz: readonly (readonly boolean[])[]): string {
  const lado = matriz.length
  const total = lado + ZONA_SILENCIOSA * 2
  const segmentos: string[] = []

  for (let fila = 0; fila < lado; fila += 1) {
    let columna = 0
    while (columna < lado) {
      if (!matriz[fila][columna]) {
        columna += 1
        continue
      }
      let largo = 1
      while (columna + largo < lado && matriz[fila][columna + largo]) largo += 1
      segmentos.push(`M${columna + ZONA_SILENCIOSA} ${fila + ZONA_SILENCIOSA}h${largo}v1h-${largo}z`)
      columna += largo
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${segmentos.join('')}"/>` +
    `</svg>`
  )
}

/** SVG del QR de un texto. Lanza si el texto no entra en un QR. */
export function generarSvgQr(texto: string): string {
  return svgDesdeMatriz(encodeQR(texto, 'raw', { ecc: CORRECCION }))
}

/** El mismo SVG como URI de datos, para usarlo en un `<img>` sin inyectar HTML. */
export function generarUriQr(texto: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(generarSvgQr(texto), 'utf8').toString('base64')}`
}
