import { expect, type Page } from '@playwright/test'

/**
 * Medición de contraste WCAG 2.1 AA compartida por las suites de alumnos.
 *
 * La revisión midió alrededor de 3,05:1 en textos esenciales de 12 px, muy por
 * debajo del 4,5:1 que exige el nivel AA para texto normal. Un DNI o el rótulo
 * de un campo no son decoración: si no se leen, la pantalla no informa.
 *
 * La medición no parte de los valores del archivo de estilos, sino del color
 * que el navegador realmente pinta. Los tokens están en `oklch` y el navegador
 * los devuelve en ese espacio; reimplementar la conversión sería justo el tipo
 * de cuenta donde un error hace que la prueba mienta. Se delega en un canvas.
 *
 * **Falla cerrada.** La versión anterior devolvía `null` ante un color que no
 * podía interpretar y omitía el elemento, así que una corrida podía terminar
 * con cero hallazgos sin haber medido nada: el silencio se leía como éxito.
 * Ahora un color visible que no se pueda interpretar es un fallo, la ausencia
 * de canvas es un fallo, y una lista vacía sólo cuenta como éxito si además se
 * midió una cantidad mínima de elementos y todos los textos esenciales.
 */

/** Umbrales de WCAG 2.1 AA. */
const MINIMO_TEXTO_NORMAL = 4.5
const MINIMO_TEXTO_GRANDE = 3

/**
 * Mínimo de elementos medidos por pantalla.
 *
 * Cualquier vista del legajo tiene bastante más que esto. El número no busca
 * ser exacto: busca que una medición vacía o casi vacía no pase por buena.
 */
const MINIMO_MEDIDOS = 8

export type Hallazgo = {
  texto: string
  selector: string
  color: string
  fondo: string
  tamano: number
  negrita: boolean
  ratio: number
  minimo: number
}

export type Ilegible = {
  texto: string
  selector: string
  color: string
  motivo: string
}

export type Medicion = {
  hallazgos: Hallazgo[]
  ilegibles: Ilegible[]
  inspeccionados: number
  medidos: number
  omitidos: number
  /** Selectores esenciales pedidos que no llegaron a medirse. */
  esencialesSinMedir: string[]
  /** Selectores esenciales pedidos que sí se midieron, con su recuento. */
  esencialesMedidos: { selector: string; elementos: number }[]
  /** Motivo por el que la medición no se pudo hacer en absoluto. */
  errorFatal: string | null
}

export type OpcionesContraste = {
  /**
   * Selectores que tienen que haber sido medidos sí o sí.
   *
   * Sin esto, una pantalla que dejara de renderizar su texto esencial pasaría
   * la auditoría por no tener nada que medir.
   */
  esenciales?: string[]
  /** Mínimo de elementos medidos. Por omisión, {@link MINIMO_MEDIDOS}. */
  minimoMedidos?: number
}

/**
 * Recorre el texto visible y devuelve la medición completa.
 *
 * Se ejecuta dentro de la página porque necesita los estilos ya resueltos.
 */
export async function medirContraste(
  page: Page,
  esenciales: string[] = []
): Promise<Medicion> {
  return page.evaluate(
    ([minimoNormal, minimoGrande, selectoresEsenciales]) => {
      const vacia = {
        hallazgos: [] as Hallazgo[],
        ilegibles: [] as Ilegible[],
        inspeccionados: 0,
        medidos: 0,
        omitidos: 0,
        esencialesSinMedir: selectoresEsenciales as string[],
        esencialesMedidos: [] as { selector: string; elementos: number }[],
        errorFatal: null as string | null,
      }

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
      type Ilegible = { texto: string; selector: string; color: string; motivo: string }

      const lienzo = document.createElement('canvas')
      lienzo.width = 1
      lienzo.height = 1
      const pincel = lienzo.getContext('2d', { willReadFrequently: true })

      if (!pincel) {
        return {
          ...vacia,
          errorFatal:
            'El navegador no ofreció un contexto 2D de canvas, así que no se pudo ' +
            'convertir ningún color. Sin eso la auditoría no mide nada y no puede ' +
            'declararse conforme.',
        }
      }

      function aRgb(valor: string): [number, number, number, number] | null {
        const lapiz = pincel as CanvasRenderingContext2D
        const limpio = (valor ?? '').trim()
        if (limpio === '' || limpio === 'transparent' || limpio === 'none') {
          return [0, 0, 0, 0]
        }
        // Un valor invalido deja `fillStyle` sin cambios; se detecta comparando
        // el resultado de asignarlo sobre dos colores base distintos.
        lapiz.fillStyle = '#000000'
        lapiz.fillStyle = limpio
        const primerIntento = lapiz.fillStyle
        lapiz.fillStyle = '#ffffff'
        lapiz.fillStyle = limpio
        if (lapiz.fillStyle !== primerIntento) return null

        lapiz.clearRect(0, 0, 1, 1)
        lapiz.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = lapiz.getImageData(0, 0, 1, 1).data
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
       * Colores de un `background-image`.
       *
       * Varios botones se pintan con un degradado, de modo que
       * `backgroundColor` viene transparente y subir por los ancestros daría el
       * fondo de la página en lugar del del botón. Se extraen los tramos y
       * después se evalúa el peor: si el texto se lee sobre el tramo más
       * desfavorable, se lee sobre todos.
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

      /** Fondos efectivos posibles, subiendo por los ancestros. */
      function fondosDe(elemento: Element): [number, number, number][] {
        const capas: [number, number, number, number][] = []
        let actual: Element | null = elemento

        while (actual) {
          const degradado = coloresDelDegradado(actual)
          if (degradado.length > 0) {
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

      function describir(elemento: Element) {
        const clases = elemento.className.toString().split(/\s+/).filter(Boolean)
        return `${elemento.tagName.toLowerCase()}${
          clases.length ? `.${clases.slice(0, 3).join('.')}` : ''
        }`
      }

      const hallazgos: Hallazgo[] = []
      const ilegibles: Ilegible[] = []
      const medidos = new Set<Element>()
      let inspeccionados = 0
      let omitidos = 0

      const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const vistos = new Set<Element>()

      while (recorrido.nextNode()) {
        const nodo = recorrido.currentNode as Text
        const texto = (nodo.textContent ?? '').trim()
        if (texto.length === 0) continue

        const elemento = nodo.parentElement
        if (!elemento || vistos.has(elemento)) continue
        vistos.add(elemento)
        inspeccionados += 1

        const caja = elemento.getBoundingClientRect()
        const estilos = getComputedStyle(elemento)

        // Lo que no se ve no se mide, y se cuenta como omitido a propósito.
        const invisible =
          caja.width === 0 ||
          caja.height === 0 ||
          estilos.visibility === 'hidden' ||
          estilos.display === 'none' ||
          Number(estilos.opacity) === 0
        if (invisible) {
          omitidos += 1
          continue
        }

        const frente = aRgb(estilos.color)
        if (!frente) {
          // Un texto visible cuyo color no se puede interpretar no se omite:
          // es un fallo. Omitirlo era lo que permitía una auditoría vacía.
          ilegibles.push({
            texto: texto.slice(0, 60),
            selector: describir(elemento),
            color: estilos.color,
            motivo: 'el color del texto no se pudo interpretar',
          })
          continue
        }

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

        medidos.add(elemento)

        const tamano = parseFloat(estilos.fontSize)
        const peso = Number(estilos.fontWeight) || 400
        const negrita = peso >= 700
        // WCAG considera «grande» a partir de 18,66 px en negrita o 24 px.
        const grande = tamano >= 24 || (negrita && tamano >= 18.66)
        const minimo = grande ? minimoGrande : minimoNormal

        if (ratio + 0.005 < minimo) {
          hallazgos.push({
            texto: texto.slice(0, 60),
            selector: describir(elemento),
            color: estilos.color,
            fondo: `rgb(${fondo.map((c) => Math.round(c)).join(', ')})`,
            tamano,
            negrita,
            ratio: Math.round(ratio * 100) / 100,
            minimo,
          })
        }
      }

      // Los textos esenciales tienen que haberse medido de verdad.
      const esencialesSinMedir: string[] = []
      const esencialesMedidos: { selector: string; elementos: number }[] = []
      for (const selector of selectoresEsenciales as string[]) {
        let encontrados: Element[]
        try {
          encontrados = Array.from(document.querySelectorAll(selector))
        } catch {
          esencialesSinMedir.push(`${selector} (selector inválido)`)
          continue
        }
        const cubiertos = encontrados.filter((elemento) => medidos.has(elemento))
        if (cubiertos.length === 0) {
          esencialesSinMedir.push(selector)
        } else {
          esencialesMedidos.push({ selector, elementos: cubiertos.length })
        }
      }

      return {
        hallazgos,
        ilegibles,
        inspeccionados,
        medidos: medidos.size,
        omitidos,
        esencialesSinMedir,
        esencialesMedidos,
        errorFatal: null,
      }
    },
    [MINIMO_TEXTO_NORMAL, MINIMO_TEXTO_GRANDE, esenciales] as const
  )
}

function describirHallazgos(hallazgos: Hallazgo[]) {
  return hallazgos
    .map(
      (h) =>
        `  ${h.ratio}:1 (mínimo ${h.minimo}) — ${h.tamano}px${h.negrita ? ' negrita' : ''} ` +
        `${h.color} sobre ${h.fondo}\n    «${h.texto}»\n    ${h.selector}`
    )
    .join('\n')
}

function describirIlegibles(ilegibles: Ilegible[]) {
  return ilegibles
    .map((i) => `  ${i.motivo}: «${i.color}»\n    «${i.texto}»\n    ${i.selector}`)
    .join('\n')
}

/**
 * Exige que una pantalla cumpla WCAG AA, y que la auditoría haya medido algo.
 *
 * Las cuatro condiciones son independientes y todas tienen que cumplirse. Una
 * lista de hallazgos vacía no alcanza: podría venir de no haber medido nada.
 */
export async function exigirContraste(
  page: Page,
  contexto: string,
  opciones: OpcionesContraste = {}
) {
  const esenciales = opciones.esenciales ?? []
  const minimoMedidos = opciones.minimoMedidos ?? MINIMO_MEDIDOS

  const medicion = await medirContraste(page, esenciales)

  const resumen =
    `inspeccionados ${medicion.inspeccionados}, medidos ${medicion.medidos}, ` +
    `omitidos por invisibles ${medicion.omitidos}, ilegibles ${medicion.ilegibles.length}`

  // 1. La medición se pudo hacer.
  expect(
    medicion.errorFatal,
    `${contexto}: la auditoría de contraste no se pudo ejecutar. ${medicion.errorFatal ?? ''}`
  ).toBeNull()

  // 2. Ningún texto visible quedó sin interpretar.
  expect(
    medicion.ilegibles,
    `${contexto}: ${medicion.ilegibles.length} texto(s) visibles con un color que no se ` +
      `pudo interpretar. No se omiten: sin poder medirlos, la auditoría no puede ` +
      `declarar conformidad.\n${describirIlegibles(medicion.ilegibles)}\n(${resumen})`
  ).toEqual([])

  // 3. Se midió una cantidad razonable, y los textos esenciales entre ellos.
  expect(
    medicion.medidos,
    `${contexto}: sólo se midieron ${medicion.medidos} elementos, menos que el mínimo ` +
      `de ${minimoMedidos}. Una auditoría que casi no mide nada no demuestra nada. ` +
      `(${resumen})`
  ).toBeGreaterThanOrEqual(minimoMedidos)

  expect(
    medicion.esencialesSinMedir,
    `${contexto}: estos textos esenciales no se midieron, porque no están en la ` +
      `pantalla o no son visibles: ${medicion.esencialesSinMedir.join(', ')}. ` +
      `La auditoría no puede declarar conformidad sobre algo que no encontró. ` +
      `(${resumen})`
  ).toEqual([])

  // 4. Y lo medido cumple el umbral.
  expect(
    medicion.hallazgos,
    `${contexto}: ${medicion.hallazgos.length} texto(s) por debajo del mínimo AA\n` +
      `${describirHallazgos(medicion.hallazgos)}\n(${resumen})`
  ).toEqual([])

  return medicion
}
