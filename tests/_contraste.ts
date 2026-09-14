import { expect, type Page } from '@playwright/test'

/**
 * Auditoría de contraste WCAG 2.1 AA compartida por las suites de EPT-9.
 *
 * ## Qué se mide
 *
 * El color que el navegador pinta, en el punto donde está el texto. No el valor
 * del archivo de estilos, y no el fondo que «debería» tener por sus ancestros.
 *
 * ## Por qué así (cuarta revisión)
 *
 * La versión anterior tenía tres caminos por los que fallaba abierta:
 *
 * 1. **Dividía por alfa un valor que no estaba premultiplicado.**
 *    `getImageData` devuelve RGB sin premultiplicar. Dividirlo otra vez por el
 *    alfa aclaraba los colores semitransparentes y podía aprobar un texto
 *    ilegible: un gris 120 al 50 % sobre negro se pinta como 60 (≈ 1,9:1) y la
 *    cuenta anterior lo medía como 120 (≈ 4,8:1).
 *    Ahora cada color se pinta en el canvas sobre negro opaco y sobre blanco
 *    opaco. Como el pintado sobre un fondo B es lineal en B, el resultado
 *    compuesto es exactamente `sobreNegro + (sobreBlanco - sobreNegro) · B/255`,
 *    sin premultiplicar ni despremultiplicar nada.
 * 2. **Descartaba en silencio los fondos que no entendía.** Un degradado que no
 *    se podía interpretar, o un `background-color` ilegible, desaparecían de la
 *    cuenta y quedaba el fondo de un ancestro. Ahora son fallos.
 * 3. **Suponía el fondo por los ancestros sin probar el píxel.** Un elemento
 *    posicionado detrás del texto que no es su ancestro cambia el píxel real.
 *    Ahora se consulta `document.elementsFromPoint` en el centro de cada línea
 *    de texto: la pila de pintado real en ese punto.
 *
 * ## Qué hace fallar la auditoría
 *
 * - No hay canvas 2D, o la raíz auditada no existe.
 * - Un texto visible con color de texto o de fondo que no se pueda
 *   interpretar, con fondo de imagen o degradado, con opacidad parcial, filtro,
 *   mezcla o `backdrop-filter` en su composición, con un pseudo-elemento con
 *   fondo en la pila, cubierto por otro elemento, o sobre un lienzo base que
 *   depende del esquema oscuro.
 * - Menos mediciones que el mínimo, que nunca puede ser cero.
 * - Un selector esencial sin coincidencias, sin texto, o con algún texto que no
 *   se midió por la razón que sea.
 * - Un texto medido por debajo del umbral AA.
 *
 * Lo que se omite (texto que no se renderiza, recortado para lectores de
 * pantalla o dentro de un control inactivo, que WCAG 1.4.3 exime) se informa con
 * su motivo y nunca cuenta como medido.
 */

/** Umbrales de WCAG 2.1 AA. */
export const MINIMO_TEXTO_NORMAL = 4.5
export const MINIMO_TEXTO_GRANDE = 3

/** Mínimo de elementos medidos por pantalla, salvo que la prueba declare otro. */
const MINIMO_MEDIDOS = 8

/**
 * Propiedades de estilo que la auditoría lee. Las pruebas negativas que simulan
 * valores de `getComputedStyle` copian exactamente estas.
 */
export const PROPIEDADES_LEIDAS = [
  'color',
  'webkitTextFillColor',
  'backgroundColor',
  'backgroundImage',
  'boxShadow',
  'opacity',
  'filter',
  'backdropFilter',
  'mixBlendMode',
  'visibility',
  'display',
  'overflow',
  'clip',
  'clipPath',
  'content',
  'fontSize',
  'fontWeight',
  'colorScheme',
] as const

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

export type Problema = { texto: string; selector: string; motivo: string }

export type ResultadoEsencial = {
  selector: string
  coincidencias: number
  textos: number
  medidos: number
  faltantes: Problema[]
}

export type Medicion = {
  hallazgos: Hallazgo[]
  /** Textos visibles que no se pudieron medir: siempre son fallo. */
  ilegibles: Problema[]
  /** Textos que no se miden por un motivo legítimo, con ese motivo. */
  omitidos: Problema[]
  inspeccionados: number
  medidos: number
  esenciales: ResultadoEsencial[]
  errorFatal: string | null
}

export type OpcionesMedicion = {
  /** Selector de la región auditada. Por omisión, `body`. */
  raiz?: string
  esenciales?: string[]
}

/**
 * Recorre el texto de la raíz y devuelve la medición completa.
 *
 * Se ejecuta dentro de la página porque necesita los estilos resueltos y la
 * pila de pintado real.
 */
export async function medirContraste(page: Page, opciones: OpcionesMedicion = {}): Promise<Medicion> {
  return page.evaluate(
    ({ minimoNormal, minimoGrande, selectoresEsenciales, raizSelector }) => {
      type Rgb = [number, number, number]
      type Capa = { negro: Rgb; blanco: Rgb }
      type Estado = { estado: 'medido' | 'omitido' | 'ilegible'; motivo?: string }

      const resultadoVacio = {
        hallazgos: [] as {
          texto: string; selector: string; color: string; fondo: string
          tamano: number; negrita: boolean; ratio: number; minimo: number
        }[],
        ilegibles: [] as { texto: string; selector: string; motivo: string }[],
        omitidos: [] as { texto: string; selector: string; motivo: string }[],
        inspeccionados: 0,
        medidos: 0,
        esenciales: [] as {
          selector: string; coincidencias: number; textos: number; medidos: number
          faltantes: { texto: string; selector: string; motivo: string }[]
        }[],
        errorFatal: null as string | null,
      }

      const lienzo = document.createElement('canvas')
      lienzo.width = 1
      lienzo.height = 1
      const pincel = lienzo.getContext('2d', { willReadFrequently: true })
      if (!pincel) {
        return {
          ...resultadoVacio,
          errorFatal:
            'El navegador no ofreció un contexto 2D de canvas: no se puede convertir ningún ' +
            'color y la auditoría no puede declarar conformidad.',
        }
      }

      const raiz = document.querySelector(raizSelector)
      if (!raiz) {
        return { ...resultadoVacio, errorFatal: `No existe la región auditada «${raizSelector}».` }
      }

      const leerEstilo = (elemento: Element, pseudo?: string) =>
        getComputedStyle(elemento, pseudo) as unknown as Record<string, string>

      // ---- Colores ----------------------------------------------------------
      const lapiz = pincel
      function pintarSobre(base: string, valor: string): Rgb {
        lapiz.globalAlpha = 1
        lapiz.globalCompositeOperation = 'source-over'
        lapiz.clearRect(0, 0, 1, 1)
        lapiz.fillStyle = base
        lapiz.fillRect(0, 0, 1, 1)
        lapiz.fillStyle = valor
        lapiz.fillRect(0, 0, 1, 1)
        const datos = lapiz.getImageData(0, 0, 1, 1).data
        return [datos[0], datos[1], datos[2]]
      }

      /** Interpreta un color CSS. `null` si el navegador no lo acepta. */
      function interpretar(valor: unknown): Capa | null {
        const limpio = typeof valor === 'string' ? valor.trim() : ''
        if (limpio === '') return null
        // Un valor inválido deja `fillStyle` sin cambios; se detecta asignándolo
        // sobre dos valores base distintos y comparando lo que queda.
        lapiz.fillStyle = '#000000'
        lapiz.fillStyle = limpio
        const primero = lapiz.fillStyle
        lapiz.fillStyle = '#ffffff'
        lapiz.fillStyle = limpio
        if (lapiz.fillStyle !== primero) return null
        return { negro: pintarSobre('#000000', limpio), blanco: pintarSobre('#ffffff', limpio) }
      }

      const esOpaca = (capa: Capa) => capa.negro.every((v, i) => Math.abs(v - capa.blanco[i]) <= 1)
      const esTransparente = (capa: Capa) =>
        capa.negro.every((v) => v === 0) && capa.blanco.every((v) => v === 255)

      /** Pinta una capa sobre un fondo opaco: lineal en el fondo, sin alfa explícito. */
      const componer = (capa: Capa, base: Rgb): Rgb =>
        capa.negro.map((v, i) => v + ((capa.blanco[i] - v) * base[i]) / 255) as Rgb

      function luminancia([r, g, b]: Rgb) {
        const canal = (valor: number) => {
          const v = valor / 255
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
      }

      const contraste = (a: Rgb, b: Rgb) => {
        const la = luminancia(a)
        const lb = luminancia(b)
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
      }

      function describir(elemento: Element) {
        const clases = (elemento.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
        const id = elemento.id ? `#${elemento.id}` : ''
        return `${elemento.tagName.toLowerCase()}${id}${clases.length ? `.${clases.slice(0, 3).join('.')}` : ''}`
      }

      // ---- Preparación: estado de reposo y pila completa ---------------------
      // Las animaciones finitas se llevan a su estado final: se audita la
      // pantalla en reposo, no un fotograma intermedio de un fundido.
      for (const animacion of document.getAnimations()) {
        const tiempo = animacion.effect?.getComputedTiming()
        if (tiempo && Number.isFinite(tiempo.endTime as number)) {
          try {
            animacion.finish()
          } catch {
            // Una animación que no se puede terminar sigue su curso.
          }
        }
      }
      // Sin esto, un elemento con `pointer-events: none` no aparece en la pila de
      // `elementsFromPoint`: ni el propio texto ni un velo que lo cubra.
      const hoja = document.createElement('style')
      hoja.textContent = '*, *::before, *::after { pointer-events: auto !important; }'
      document.head.appendChild(hoja)
      const desplazamientoInicial = [window.scrollX, window.scrollY]

      const esquemaRaiz = String(leerEstilo(document.documentElement).colorScheme ?? '')
      const lienzoOscuro = /\bdark\b/u.test(esquemaRaiz) && !/\blight\b/u.test(esquemaRaiz)

      // La unidad de auditoría es el nodo de texto, no su elemento padre. Un
      // mismo elemento puede contener varios nodos con cajas y fondos distintos
      // (por saltos, pseudomaquetado o contenido intercalado).
      const estados = new Map<Text, Estado>()
      const res = { ...resultadoVacio, hallazgos: [...resultadoVacio.hallazgos] }

      try {
        const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
        while (recorrido.nextNode()) {
          const nodo = recorrido.currentNode as Text
          const contenido = (nodo.textContent ?? '').trim()
          if (contenido.length === 0) continue
          const elemento = nodo.parentElement
          if (!elemento) continue
          res.inspeccionados += 1

          const texto = contenido.slice(0, 60)
          const selector = describir(elemento)
          const omitir = (motivo: string) => {
            estados.set(nodo, { estado: 'omitido', motivo })
            res.omitidos.push({ texto, selector, motivo })
          }
          const rechazar = (motivo: string) => {
            estados.set(nodo, { estado: 'ilegible', motivo })
            res.ilegibles.push({ texto, selector, motivo })
          }

          const estilo = leerEstilo(elemento)

          // 1. ¿Se renderiza?
          if (estilo.display === 'none' || estilo.visibility !== 'visible') {
            omitir('no se renderiza (display o visibility)')
            continue
          }
          let transparenteTotal = false
          let recortado = false
          for (let actual: Element | null = elemento; actual; actual = actual.parentElement) {
            const propio = leerEstilo(actual)
            if (Number(propio.opacity) === 0) transparenteTotal = true
            const caja = actual.getBoundingClientRect()
            const recorta =
              (propio.overflow && propio.overflow !== 'visible') ||
              (propio.clip && propio.clip !== 'auto') ||
              (propio.clipPath && propio.clipPath !== 'none')
            if (recorta && (caja.width <= 1 || caja.height <= 1)) recortado = true
          }
          if (transparenteTotal) {
            omitir('no se ve: opacidad cero en su cadena de ancestros')
            continue
          }
          if (recortado) {
            omitir('recortado visualmente: solo existe para lectores de pantalla')
            continue
          }
          if (elemento.closest(':disabled, [aria-disabled="true"]')) {
            omitir('pertenece a un control inactivo, que WCAG 1.4.3 exime de contraste')
            continue
          }

          // `instant`: el sitio declara `scroll-behavior: smooth`, y un
          // desplazamiento animado todavía no llegó cuando se consulta el píxel.
          elemento.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
          const rango = document.createRange()
          rango.selectNodeContents(nodo)
          const lineas = Array.from(rango.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
          if (lineas.length === 0) {
            omitir('no se renderiza (sin caja de texto)')
            continue
          }

          // 2. Color del texto.
          const colorTexto = String(estilo.color ?? '')
          let capaTexto = interpretar(colorTexto)
          if (!capaTexto) {
            rechazar(`el color del texto no se pudo interpretar: «${colorTexto}»`)
            continue
          }
          const relleno = String(estilo.webkitTextFillColor ?? '')
          if (relleno && relleno !== colorTexto) {
            const capaRelleno = interpretar(relleno)
            if (!capaRelleno) {
              rechazar(`el relleno del texto no se pudo interpretar: «${relleno}»`)
              continue
            }
            capaTexto = capaRelleno
          }
          if (esTransparente(capaTexto)) {
            rechazar('el texto es transparente: lo que se ve depende de otra capa')
            continue
          }

          // 3. Composición de la cadena del texto: opacidad, filtros y mezclas
          // afectan al texto aunque el ancestro no esté detrás del punto medido.
          let composicion: string | null = null
          for (let actual: Element | null = elemento; actual; actual = actual.parentElement) {
            const propio = leerEstilo(actual)
            if (Number(propio.opacity) < 1) composicion = `opacidad parcial en ${describir(actual)}`
            else if (propio.filter && propio.filter !== 'none') composicion = `filtro en ${describir(actual)}`
            else if (propio.mixBlendMode && propio.mixBlendMode !== 'normal') composicion = `modo de mezcla en ${describir(actual)}`
            if (composicion) break
          }
          if (composicion) {
            rechazar(`composición no resoluble: ${composicion}`)
            continue
          }

          // 4. Pila de pintado real en el centro de cada línea. No se muestrea:
          // una línea posterior puede cruzar un fondo distinto de las primeras.
          let peor = Infinity
          let fondoPeor: Rgb = [255, 255, 255]
          let problema: string | null = null

          for (const linea of lineas) {
            const x = linea.left + linea.width / 2
            const y = linea.top + linea.height / 2
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
              problema = 'el texto quedó fuera de la vista y no se pudo consultar su píxel'
              break
            }
            const pila = document.elementsFromPoint(x, y)
            const indice = pila.findIndex((otro) => otro === elemento || elemento.contains(otro))
            if (indice === -1) {
              problema = 'el texto no aparece en la pila de pintado de su propio punto'
              break
            }
            // Lo que está por encima del texto no puede tapar con color.
            const encima = pila
              .slice(0, indice)
              .find((otro) => {
                const propio = leerEstilo(otro)
                const capa = interpretar(propio.backgroundColor)
                return (
                  !capa ||
                  !esTransparente(capa) ||
                  (propio.backgroundImage && propio.backgroundImage !== 'none') ||
                  ['IMG', 'SVG', 'CANVAS', 'VIDEO', 'svg'].includes(otro.tagName)
                )
              })
            if (encima) {
              problema = `el texto está cubierto por ${describir(encima)}`
              break
            }

            const capas: Capa[] = []
            let opacoAlcanzado = false
            for (const otro of pila.slice(indice)) {
              const propio = leerEstilo(otro)
              const nombre = describir(otro)
              if (propio.backgroundImage && propio.backgroundImage !== 'none') {
                problema = `fondo con imagen o degradado en ${nombre}: no se inventa un color plano`
                break
              }
              if (propio.backdropFilter && propio.backdropFilter !== 'none') {
                problema = `backdrop-filter en ${nombre}`
                break
              }
              if (Number(propio.opacity) < 1) {
                problema = `opacidad parcial en ${nombre}`
                break
              }
              if ((propio.filter && propio.filter !== 'none') || (propio.mixBlendMode && propio.mixBlendMode !== 'normal')) {
                problema = `filtro o mezcla en ${nombre}`
                break
              }
              if (propio.boxShadow && /\binset\b/u.test(propio.boxShadow)) {
                problema = `sombra interior en ${nombre}`
                break
              }
              for (const pseudo of ['::before', '::after']) {
                const estiloPseudo = leerEstilo(otro, pseudo)
                const contenidoPseudo = String(estiloPseudo.content ?? 'none')
                if (contenidoPseudo === 'none' || contenidoPseudo === 'normal') continue
                const capaPseudo = interpretar(estiloPseudo.backgroundColor)
                if (!capaPseudo || !esTransparente(capaPseudo) || (estiloPseudo.backgroundImage && estiloPseudo.backgroundImage !== 'none')) {
                  problema = `pseudo-elemento ${pseudo} con fondo en ${nombre}`
                  break
                }
              }
              if (problema) break
              const capa = interpretar(propio.backgroundColor)
              if (!capa) {
                problema = `el color de fondo de ${nombre} no se pudo interpretar: «${propio.backgroundColor}»`
                break
              }
              if (!esTransparente(capa)) capas.push(capa)
              if (esOpaca(capa)) {
                opacoAlcanzado = true
                break
              }
            }
            if (problema) break

            if (!opacoAlcanzado && lienzoOscuro) {
              problema = 'el fondo depende del lienzo base, que usa el esquema oscuro'
              break
            }

            let fondo: Rgb = [255, 255, 255]
            for (let i = capas.length - 1; i >= 0; i -= 1) fondo = componer(capas[i], fondo)
            const visto = componer(capaTexto, fondo)
            const ratio = contraste(visto, fondo)
            if (ratio < peor) {
              peor = ratio
              fondoPeor = fondo
            }
          }

          if (problema) {
            rechazar(problema)
            continue
          }

          estados.set(nodo, { estado: 'medido' })
          res.medidos += 1

          const tamano = parseFloat(String(estilo.fontSize))
          const negrita = (Number(estilo.fontWeight) || 400) >= 700
          // WCAG considera «grande» desde 18,66 px en negrita o 24 px.
          const grande = tamano >= 24 || (negrita && tamano >= 18.66)
          const minimo = grande ? minimoGrande : minimoNormal
          // WCAG define el umbral, no una banda de tolerancia. Se conserva toda
          // la precisión para decidir y solo se redondea el valor informado.
          if (peor < minimo) {
            res.hallazgos.push({
              texto,
              selector,
              color: colorTexto,
              fondo: `rgb(${fondoPeor.map((c) => Math.round(c)).join(', ')})`,
              tamano,
              negrita,
              ratio: Math.round(peor * 100) / 100,
              minimo,
            })
          }
        }

        // 5. Esenciales: cada texto que contienen tiene que haberse medido.
        for (const selectorEsencial of selectoresEsenciales) {
          let coincidencias: Element[]
          try {
            coincidencias = Array.from(document.querySelectorAll(selectorEsencial))
          } catch {
            res.esenciales.push({
              selector: selectorEsencial, coincidencias: 0, textos: 0, medidos: 0,
              faltantes: [{ texto: '', selector: selectorEsencial, motivo: 'selector inválido' }],
            })
            continue
          }
          const faltantes: { texto: string; selector: string; motivo: string }[] = []
          let textos = 0
          let medidosEsenciales = 0
          for (const coincidencia of coincidencias) {
            if (!raiz.contains(coincidencia)) {
              faltantes.push({ texto: '', selector: describir(coincidencia), motivo: 'fuera de la región auditada' })
              continue
            }
            const portadores: Text[] = []
            const caminante = document.createTreeWalker(coincidencia, NodeFilter.SHOW_TEXT)
            while (caminante.nextNode()) {
              const nodo = caminante.currentNode as Text
              if ((nodo.textContent ?? '').trim() && nodo.parentElement) portadores.push(nodo)
            }
            if (portadores.length === 0) {
              faltantes.push({ texto: '', selector: describir(coincidencia), motivo: 'el elemento esencial no tiene texto' })
              continue
            }
            for (const nodo of portadores) {
              textos += 1
              const estado = estados.get(nodo)
              const portador = nodo.parentElement!
              if (estado?.estado === 'medido') {
                medidosEsenciales += 1
              } else {
                faltantes.push({
                  texto: (portador.textContent ?? '').trim().slice(0, 60),
                  selector: describir(portador),
                  motivo: estado ? `${estado.estado}: ${estado.motivo}` : 'no se inspeccionó',
                })
              }
            }
          }
          res.esenciales.push({
            selector: selectorEsencial,
            coincidencias: coincidencias.length,
            textos,
            medidos: medidosEsenciales,
            faltantes,
          })
        }
      } finally {
        hoja.remove()
        window.scrollTo({ left: desplazamientoInicial[0], top: desplazamientoInicial[1], behavior: 'instant' })
      }

      return res
    },
    {
      minimoNormal: MINIMO_TEXTO_NORMAL,
      minimoGrande: MINIMO_TEXTO_GRANDE,
      selectoresEsenciales: opciones.esenciales ?? [],
      raizSelector: opciones.raiz ?? 'body',
    }
  )
}

function listar(problemas: Problema[]) {
  return problemas.map((p) => `  ${p.motivo}\n    «${p.texto}»\n    ${p.selector}`).join('\n')
}

function resumen(medicion: Medicion) {
  return (
    `inspeccionados ${medicion.inspeccionados}, medidos ${medicion.medidos}, ` +
    `omitidos ${medicion.omitidos.length}, ilegibles ${medicion.ilegibles.length}`
  )
}

export type OpcionesContraste = {
  raiz?: string
  /** Selectores cuyo texto tiene que medirse completo. Obligatorio y no vacío. */
  esenciales: string[]
  /** Mínimo de elementos medidos. Por omisión, 8. Nunca puede ser cero. */
  minimoMedidos?: number
}

/**
 * Exige que una región cumpla WCAG AA y que la auditoría haya medido de verdad.
 *
 * Todas las condiciones son independientes. Una lista de hallazgos vacía no
 * alcanza: podría venir de no haber medido nada.
 */
export async function exigirContraste(page: Page, contexto: string, opciones: OpcionesContraste) {
  const minimoMedidos = opciones.minimoMedidos ?? MINIMO_MEDIDOS
  if (!Number.isInteger(minimoMedidos) || minimoMedidos < 1) {
    throw new Error(`${contexto}: el mínimo de mediciones tiene que ser un entero mayor que cero`)
  }
  if (!opciones.esenciales || opciones.esenciales.length === 0) {
    throw new Error(`${contexto}: una auditoría de contraste tiene que nombrar sus textos esenciales`)
  }

  const medicion = await medirContraste(page, { raiz: opciones.raiz, esenciales: opciones.esenciales })

  expect(
    medicion.errorFatal,
    `${contexto}: la auditoría de contraste no se pudo ejecutar. ${medicion.errorFatal ?? ''}`
  ).toBeNull()

  expect(
    medicion.ilegibles,
    `${contexto}: ${medicion.ilegibles.length} texto(s) visibles que no se pudieron medir. ` +
      `No se omiten: sin medirlos, la auditoría no puede declarar conformidad.\n` +
      `${listar(medicion.ilegibles)}\n(${resumen(medicion)})`
  ).toEqual([])

  expect(
    medicion.medidos,
    `${contexto}: sólo se midieron ${medicion.medidos} elementos, menos que el mínimo de ` +
      `${minimoMedidos}. Una auditoría que casi no mide nada no demuestra nada. (${resumen(medicion)})`
  ).toBeGreaterThanOrEqual(minimoMedidos)

  const incompletos = medicion.esenciales.filter((e) => e.coincidencias === 0 || e.faltantes.length > 0)
  expect(
    incompletos,
    `${contexto}: textos esenciales que no se midieron completos:\n` +
      incompletos
        .map((e) =>
          e.coincidencias === 0
            ? `  ${e.selector}: no hay ningún elemento en la pantalla`
            : `  ${e.selector}: ${e.faltantes.length} sin medir\n${listar(e.faltantes)}`
        )
        .join('\n') +
      `\n(${resumen(medicion)})`
  ).toEqual([])

  expect(
    medicion.hallazgos,
    `${contexto}: ${medicion.hallazgos.length} texto(s) por debajo del mínimo AA\n` +
      medicion.hallazgos
        .map(
          (h) =>
            `  ${h.ratio}:1 (mínimo ${h.minimo}) — ${h.tamano}px${h.negrita ? ' negrita' : ''} ` +
            `${h.color} sobre ${h.fondo}\n    «${h.texto}»\n    ${h.selector}`
        )
        .join('\n') +
      `\n(${resumen(medicion)})`
  ).toEqual([])

  return medicion
}

/**
 * Exige que una región no tenga NINGÚN texto visible.
 *
 * Es una afirmación distinta de «pasa el contraste»: un esqueleto de carga no
 * tiene texto que medir, y eso se prueba en lugar de aprobar una auditoría con
 * cero mediciones. Falla si aparece un solo texto visible.
 */
export async function exigirSinTextoVisible(page: Page, contexto: string, raiz = 'body') {
  const medicion = await medirContraste(page, { raiz })
  expect(medicion.errorFatal, `${contexto}: ${medicion.errorFatal ?? ''}`).toBeNull()
  expect(
    [...medicion.ilegibles, ...medicion.hallazgos.map((h) => ({ texto: h.texto, selector: h.selector, motivo: 'medido' }))],
    `${contexto}: se esperaba que no hubiera texto visible (${resumen(medicion)})`
  ).toEqual([])
  expect(medicion.medidos, `${contexto}: hay texto visible (${resumen(medicion)})`).toBe(0)
  expect(medicion.inspeccionados, `${contexto}: no hay ningún texto, ni siquiera para lectores de pantalla`).toBeGreaterThan(0)
  return medicion
}
