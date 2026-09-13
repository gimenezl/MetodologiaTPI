import { expect, type Page } from '@playwright/test'

/**
 * Medicion de contraste WCAG 2.1 AA compartida por las suites de alumnos.
 *
 * La revision midio alrededor de 3,05:1 en textos esenciales de 12 px, muy por
 * debajo del 4,5:1 que exige el nivel AA para texto normal. Un DNI o el rotulo
 * de un campo no son decoracion: si no se leen, la pantalla no informa.
 *
 * La comprobacion no parte de los valores del archivo de estilos, sino del
 * color que el navegador realmente pinta. Los tokens estan en `oklch` y el
 * navegador los devuelve en ese espacio, asi que la conversion se delega en un
 * canvas en lugar de reimplementarla: un error en esa cuenta haria que la
 * prueba mintiera sin que nadie lo notara.
 */

/** Umbrales de WCAG 2.1 AA. */
const MINIMO_TEXTO_NORMAL = 4.5
const MINIMO_TEXTO_GRANDE = 3

type Hallazgo = {
  texto: string
  selector: string
  color: string
  fondo: string
  tamano: number
  negrita: boolean
  ratio: number
  minimo: number
}

/**
 * Recorre el texto visible y devuelve lo que no alcanza su umbral.
 *
 * Se ejecuta dentro de la página porque necesita los estilos ya resueltos.
 */
export async function medirContraste(page: Page): Promise<Hallazgo[]> {
  return page.evaluate(
    ([minimoNormal, minimoGrande]) => {
      /**
       * Convierte cualquier color CSS a sRGB con alfa.
       *
       * Los tokens de este proyecto estan definidos en `oklch`, y Chromium
       * devuelve `getComputedStyle` en ese mismo espacio. Analizar la cadena a
       * mano obligaria a reimplementar la conversion OKLCH -> sRGB, que es
       * justo el tipo de calculo donde un error pasa inadvertido y hace que la
       * prueba mienta. Se delega en el canvas, que acepta cualquier color CSS
       * valido y devuelve los bytes que el navegador realmente pinta.
       */
      const lienzo = document.createElement('canvas')
      lienzo.width = 1
      lienzo.height = 1
      const pincel = lienzo.getContext('2d', { willReadFrequently: true })

      function aRgb(valor: string): [number, number, number, number] | null {
        if (!pincel) return null
        const limpio = (valor ?? '').trim()
        if (limpio === '' || limpio === 'transparent' || limpio === 'none') {
          return [0, 0, 0, 0]
        }
        pincel.clearRect(0, 0, 1, 1)
        // Un valor invalido deja `fillStyle` sin cambios; se detecta comparando.
        pincel.fillStyle = '#000000'
        pincel.fillStyle = limpio
        const primerIntento = pincel.fillStyle
        pincel.fillStyle = '#ffffff'
        pincel.fillStyle = limpio
        if (pincel.fillStyle !== primerIntento) return null

        pincel.clearRect(0, 0, 1, 1)
        pincel.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = pincel.getImageData(0, 0, 1, 1).data
        if (a === 0) return [0, 0, 0, 0]
        // `getImageData` devuelve el color premultiplicado por el alfa.
        const alfa = a / 255
        return [r / alfa, g / alfa, b / alfa, alfa]
      }

      function luminancia([r, g, b]: [number, number, number]) {
        const canal = (valor: number) => {
          const v = valor / 255
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
      }

      function mezclar(
        frente: [number, number, number, number],
        fondo: [number, number, number]
      ): [number, number, number] {
        const a = frente[3]
        return [
          frente[0] * a + fondo[0] * (1 - a),
          frente[1] * a + fondo[1] * (1 - a),
          frente[2] * a + fondo[2] * (1 - a),
        ]
      }

      /**
       * Todos los colores de un `background-image`.
       *
       * Varios botones se pintan con un degradado, no con un color plano, de
       * modo que `backgroundColor` viene transparente y subir por los
       * ancestros daria el fondo de la pagina en lugar del del boton. Se
       * extraen los tramos del degradado y despues se evalua el peor: si el
       * texto se lee sobre el tramo mas desfavorable, se lee sobre todos.
       */
      function coloresDelDegradado(elemento: Element): [number, number, number][] {
        const imagen = getComputedStyle(elemento).backgroundImage
        if (!imagen || imagen === 'none') return []
        const encontrados = imagen.match(
          /(?:rgba?|oklch|oklab|lab|lch|hsla?|color)\([^)]*\)|#[0-9a-fA-F]{3,8}/g
        )
        if (!encontrados) return []
        return encontrados
          .map(aRgb)
          .filter((color): color is [number, number, number, number] => color !== null)
          .filter((color) => color[3] > 0)
          .map((color) => mezclar(color, [255, 255, 255]))
      }

      /**
       * Fondos efectivos posibles: sube por los ancestros hasta encontrar uno
       * opaco y devuelve todos los candidatos cuando hay un degradado.
       */
      function fondosDe(elemento: Element): [number, number, number][] {
        const capas: [number, number, number, number][] = []
        let actual: Element | null = elemento

        while (actual) {
          const degradado = coloresDelDegradado(actual)
          if (degradado.length > 0) {
            // El degradado es opaco: no hace falta seguir subiendo.
            return degradado.map((base) => {
              let resultado = base
              for (let i = capas.length - 1; i >= 0; i -= 1) {
                resultado = mezclar(capas[i], resultado)
              }
              return resultado
            })
          }

          const color = aRgb(getComputedStyle(actual).backgroundColor)
          if (color && color[3] > 0) {
            capas.push(color)
            if (color[3] === 1) break
          }
          actual = actual.parentElement
        }

        let resultado: [number, number, number] = [255, 255, 255]
        for (let i = capas.length - 1; i >= 0; i -= 1) {
          resultado = mezclar(capas[i], resultado)
        }
        return [resultado]
      }

      const hallazgos: {
        texto: string
        selector: string
        color: string
        fondo: string
        tamano: number
        negrita: boolean
        ratio: number
        minimo: number
      }[] = []

      const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const vistos = new Set<Element>()

      while (recorrido.nextNode()) {
        const nodo = recorrido.currentNode as Text
        const texto = (nodo.textContent ?? '').trim()
        if (texto.length === 0) continue

        const elemento = nodo.parentElement
        if (!elemento || vistos.has(elemento)) continue
        vistos.add(elemento)

        const caja = elemento.getBoundingClientRect()
        if (caja.width === 0 || caja.height === 0) continue

        const estilos = getComputedStyle(elemento)
        if (estilos.visibility === 'hidden' || estilos.display === 'none') continue
        if (Number(estilos.opacity) === 0) continue

        const frente = aRgb(estilos.color)
        if (!frente) continue

        // Con un degradado hay varios fondos posibles; manda el peor.
        const candidatos = fondosDe(elemento)
        let ratio = Infinity
        let fondo: [number, number, number] = candidatos[0]
        for (const candidato of candidatos) {
          const primerPlano = mezclar(frente, candidato)
          const l1 = luminancia(primerPlano)
          const l2 = luminancia(candidato)
          const actual = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
          if (actual < ratio) {
            ratio = actual
            fondo = candidato
          }
        }

        const tamano = parseFloat(estilos.fontSize)
        const peso = Number(estilos.fontWeight) || 400
        const negrita = peso >= 700
        // WCAG considera «grande» a partir de 18,66 px en negrita o 24 px.
        const grande = tamano >= 24 || (negrita && tamano >= 18.66)
        const minimo = grande ? minimoGrande : minimoNormal

        if (ratio + 0.005 < minimo) {
          hallazgos.push({
            texto: texto.slice(0, 60),
            selector: `${elemento.tagName.toLowerCase()}.${elemento.className
              .toString()
              .split(/\s+/)
              .slice(0, 3)
              .join('.')}`,
            color: estilos.color,
            fondo: `rgb(${fondo.map((c) => Math.round(c)).join(', ')})`,
            tamano,
            negrita,
            ratio: Math.round(ratio * 100) / 100,
            minimo,
          })
        }
      }

      return hallazgos
    },
    [MINIMO_TEXTO_NORMAL, MINIMO_TEXTO_GRANDE] as const
  )
}

function describir(hallazgos: Hallazgo[]) {
  return hallazgos
    .map(
      (h) =>
        `  ${h.ratio}:1 (mínimo ${h.minimo}) — ${h.tamano}px${h.negrita ? ' negrita' : ''} ` +
        `${h.color} sobre ${h.fondo}\n    «${h.texto}»\n    ${h.selector}`
    )
    .join('\n')
}

export async function exigirContraste(page: Page, contexto: string) {
  const hallazgos = await medirContraste(page)
  expect(
    hallazgos,
    `${contexto}: ${hallazgos.length} texto(s) por debajo del mínimo AA\n${describir(hallazgos)}`
  ).toEqual([])
}
