import { expect, test, type Page } from '@playwright/test'
import {
  MINIMO_TEXTO_NORMAL,
  PROPIEDADES_LEIDAS,
  exigirContraste,
  exigirSinTextoVisible,
  medirContraste,
} from './_contraste'

/**
 * Contraste WCAG 2.1 AA sobre el banco visual del legajo académico.
 *
 * Corre en los tres perfiles —escritorio, Pixel 5 e iPhone 13— porque el
 * listado cambia de forma: en escritorio es una tabla y en móvil son tarjetas.
 * Los textos esenciales se eligen según la forma que efectivamente se ve: en
 * móvil la tabla no se renderiza, y exigirla sería exigir medir algo invisible.
 */

const BANCO = '/pruebas-ui/alumnos'

/** Punto de quiebre `sm` de Tailwind: desde acá se muestra la tabla. */
const ANCHO_TABLA = 640

function esEscritorio(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= ANCHO_TABLA
}

/**
 * Marca como esencial el elemento que contiene un texto visible.
 *
 * Los textos se ubican con los mismos localizadores accesibles que usa una
 * persona; la marca solo le dice a la auditoría cuál tiene que medir sí o sí.
 */
async function marcarEsencial(page: Page, texto: string, marca: string) {
  await page.getByText(texto, { exact: true }).first().evaluate((elemento, valor) => {
    elemento.setAttribute('data-esencial', valor)
  }, marca)
  return `[data-esencial="${marca}"]`
}

test.describe('Contraste WCAG AA del legajo académico', () => {
  test('el listado con estudiantes activos e inactivos', async ({ page }) => {
    await page.goto(BANCO)
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()
    await exigirContraste(page, 'listado', {
      esenciales: esEscritorio(page)
        ? ['h1', '[aria-label="Tabla de alumnos"] th', '[aria-label="Tabla de alumnos"] td']
        : ['h1', '[aria-label="Alumnos por apellido"] li'],
    })
  })

  test('el formulario de alta, en sus dos estados', async ({ page }) => {
    await page.goto(BANCO)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo legajo académico' })).toBeVisible()

    const esenciales = [
      'label[for="nuevo-alumno-dni"]',
      'label[for="nuevo-alumno-estado"]',
      '#nuevo-alumno-dni-ayuda',
    ]

    await page.locator('#nuevo-alumno-estado').selectOption('ACTIVO')
    await exigirContraste(page, 'formulario en estado ACTIVO', { esenciales })

    await page.locator('#nuevo-alumno-estado').selectOption('INACTIVO')
    await exigirContraste(page, 'formulario en estado INACTIVO', { esenciales })
  })

  test('el formulario con errores de validación visibles', async ({ page }) => {
    await page.goto(BANCO)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await page.locator('#nuevo-alumno-dni').fill('12')
    await page.getByRole('button', { name: 'Crear legajo' }).click()
    await expect(page.locator('#nuevo-alumno-dni-error')).toBeVisible()
    await exigirContraste(page, 'formulario con errores', {
      esenciales: ['#nuevo-alumno-dni-error', 'label[for="nuevo-alumno-dni"]'],
    })
  })

  test('el diálogo de cambio de curso', async ({ page }) => {
    await page.goto(BANCO)
    await page.getByRole('button', { name: 'Cambiar curso del alumno Arrieta, Camila' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await exigirContraste(page, 'diálogo de cambio de curso', {
      raiz: '[role="dialog"]',
      minimoMedidos: 3,
      esenciales: ['[role="dialog"] h2', 'label[for="cambiar-curso-destino"]'],
    })
  })

  test('el listado vacío y el listado sin cursos activos', async ({ page }) => {
    await page.goto(`${BANCO}?vacio=1`)
    await expect(page.getByText('No hay alumnos registrados')).toBeVisible()
    // Esta pantalla tiene poco texto a propósito; a cambio se nombra
    // exactamente lo que tiene que haberse medido.
    const vacio = await marcarEsencial(page, 'No hay alumnos registrados', 'vacio')
    await exigirContraste(page, 'listado vacío', { minimoMedidos: 5, esenciales: ['h1', vacio] })

    await page.goto(`${BANCO}?sin-cursos=1`)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo legajo académico' })).toBeVisible()
    await exigirContraste(page, 'sin cursos activos', {
      esenciales: ['h1', 'label[for="nuevo-alumno-estado"]'],
    })
  })

  test('los mensajes de error y de éxito', async ({ page }) => {
    const error = 'No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.'
    await page.goto(`${BANCO}?estado=error`)
    await expect(page.getByText(error)).toBeVisible()
    await exigirContraste(page, 'mensaje de error', {
      esenciales: ['h1', await marcarEsencial(page, error, 'error')],
    })

    const exito = 'Legajo académico actualizado correctamente.'
    await page.goto(`${BANCO}?estado=exito`)
    await expect(page.getByText(exito)).toBeVisible()
    await exigirContraste(page, 'mensaje de éxito', {
      esenciales: ['h1', await marcarEsencial(page, exito, 'exito')],
    })
  })

  test('el estado de carga no tiene texto visible que medir', async ({ page }) => {
    await page.goto(`${BANCO}?estado=carga`)
    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    // Un esqueleto es todo forma: su único texto es el aviso para lectores de
    // pantalla. Se prueba eso —que no hay texto visible— en lugar de aprobar
    // una auditoría de contraste con cero mediciones.
    const medicion = await exigirSinTextoVisible(page, 'estado de carga')
    expect(
      medicion.omitidos.some(
        (o) => o.texto.startsWith('Cargando los legajos') && o.motivo.startsWith('recortado visualmente')
      ),
      'el aviso de carga existe y se reconoce como texto solo para lectores de pantalla'
    ).toBe(true)
  })
})

// ================================================================
// El instrumento falla cerrado
// ================================================================

/** Reemplaza lo que `getComputedStyle` devuelve para un elemento. */
async function sustituirEstilo(page: Page, selector: string, sustituto: Record<string, string>) {
  await page.evaluate(
    ({ selector, sustituto, propiedades }) => {
      const objetivo = document.querySelector(selector)
      const original = window.getComputedStyle.bind(window)
      // Copia plana y no proxy: WebKit no admite envolver CSSStyleDeclaration.
      window.getComputedStyle = ((elemento: Element, pseudo?: string | null) => {
        const estilos = original(elemento, pseudo ?? undefined)
        if (elemento !== objetivo || pseudo) return estilos
        const copia: Record<string, string> = {}
        for (const propiedad of propiedades) {
          copia[propiedad] = (estilos as unknown as Record<string, string>)[propiedad]
        }
        return Object.assign(copia, sustituto) as unknown as CSSStyleDeclaration
      }) as typeof window.getComputedStyle
    },
    { selector, sustituto, propiedades: [...PROPIEDADES_LEIDAS] }
  )
}

/** Inserta un caso aislado al principio del cuerpo y devuelve su selector. */
async function insertarCaso(page: Page, html: string) {
  await page.evaluate((contenido) => {
    const caso = document.createElement('section')
    caso.id = 'caso-de-contraste'
    caso.innerHTML = contenido
    document.body.prepend(caso)
  }, html)
  return '#caso-de-contraste'
}

test.describe('La auditoría de contraste falla cerrada', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BANCO)
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()
  })

  test('un color de texto que no se puede interpretar produce fallo', async ({ page }) => {
    await sustituirEstilo(page, 'h1', { color: 'un-color-que-no-existe' })
    const medicion = await medirContraste(page, { esenciales: ['h1'] })
    expect(medicion.ilegibles.some((i) => i.motivo.includes('color del texto no se pudo interpretar'))).toBe(true)
    await expect(exigirContraste(page, 'texto ilegible', { esenciales: ['h1'] })).rejects.toThrow(/no se pudieron medir/)
  })

  test('un color de fondo que no se puede interpretar produce fallo', async ({ page }) => {
    await sustituirEstilo(page, 'h1', { backgroundColor: 'fondo-que-no-existe' })
    const medicion = await medirContraste(page, { esenciales: ['h1'] })
    expect(medicion.ilegibles.some((i) => i.motivo.includes('color de fondo'))).toBe(true)
    await expect(exigirContraste(page, 'fondo ilegible', { esenciales: ['h1'] })).rejects.toThrow(/no se pudieron medir/)
  })

  test('un fondo con degradado falla en lugar de inventar un color plano', async ({ page }) => {
    await page.evaluate(() => {
      const titulo = document.querySelector('h1') as HTMLElement
      titulo.style.backgroundImage = 'linear-gradient(90deg, rgb(255, 255, 255), rgb(240, 240, 240))'
    })
    const medicion = await medirContraste(page, { esenciales: ['h1'] })
    expect(medicion.ilegibles.some((i) => i.motivo.includes('degradado'))).toBe(true)
    await expect(exigirContraste(page, 'degradado', { esenciales: ['h1'] })).rejects.toThrow(/degradado/)
  })

  test('un fondo transparente se resuelve por el píxel real, no por los ancestros', async ({ page }) => {
    // Un bloque oscuro que NO es ancestro del título queda detrás de él. Subir
    // por los ancestros daría el fondo claro de la página y aprobaría; el píxel
    // real es oscuro y tiene que fallar.
    await page.evaluate(() => {
      const titulo = document.querySelector('h1') as HTMLElement
      const caja = titulo.getBoundingClientRect()
      const velo = document.createElement('div')
      Object.assign(velo.style, {
        position: 'absolute',
        left: `${caja.left + window.scrollX}px`,
        top: `${caja.top + window.scrollY}px`,
        width: `${caja.width}px`,
        height: `${caja.height}px`,
        backgroundColor: 'rgb(17, 24, 39)',
      })
      document.body.appendChild(velo)
      titulo.style.position = 'relative'
      titulo.style.zIndex = '1'
    })
    const medicion = await medirContraste(page, { esenciales: ['h1'] })
    const hallazgo = medicion.hallazgos.find((h) => h.texto === 'Alumnos')
    expect(hallazgo, 'el título sobre el bloque oscuro tiene que quedar por debajo del mínimo').toBeTruthy()
    expect(hallazgo?.fondo).toBe('rgb(17, 24, 39)')
    await expect(exigirContraste(page, 'fondo real oscuro', { esenciales: ['h1'] })).rejects.toThrow(/por debajo del mínimo/)
  })

  test('un texto semitransparente se compone con su fondo', async ({ page }) => {
    const raiz = await insertarCaso(
      page,
      '<div style="background:rgb(255,255,255);padding:16px">' +
        '<p id="alfa" style="color:rgba(0,0,0,0.3);font-size:16px;margin:0">Texto semitransparente de prueba</p>' +
        '</div>'
    )
    const medicion = await medirContraste(page, { raiz, esenciales: ['#alfa'] })
    const hallazgo = medicion.hallazgos.find((h) => h.selector.startsWith('p#alfa'))
    expect(hallazgo, 'un negro al 30 % sobre blanco se ve gris claro y no alcanza 4,5:1').toBeTruthy()
    expect(hallazgo!.ratio).toBeLessThan(2.5)
  })

  test('un color moderno que el navegador no soporta produce fallo', async ({ page }) => {
    const valor = 'device-cmyk(0.1 0.2 0.3 0.4)'
    const soportado = await page.evaluate((v) => CSS.supports('color', v), valor)
    // Precondición: si algún día el motor lo soporta, este caso deja de ser
    // «no soportado» y hay que elegir otro.
    expect(soportado, `${valor} no debería estar soportado por este motor`).toBe(false)
    await sustituirEstilo(page, 'h1', { color: valor })
    await expect(exigirContraste(page, 'color moderno', { esenciales: ['h1'] })).rejects.toThrow(/no se pudo interpretar/)
  })

  test('sin canvas la auditoría no se ejecuta y falla', async ({ page }) => {
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
    })
    const medicion = await medirContraste(page, { esenciales: ['h1'] })
    expect(medicion.errorFatal).toContain('canvas')
    await expect(exigirContraste(page, 'sin canvas', { esenciales: ['h1'] })).rejects.toThrow(/no se pudo ejecutar/)
  })

  test('un selector esencial ausente produce fallo', async ({ page }) => {
    await expect(
      exigirContraste(page, 'esencial ausente', { esenciales: ['#no-existe-este-texto-esencial'] })
    ).rejects.toThrow(/no hay ningún elemento/)
  })

  test('cero mediciones producen fallo, no éxito silencioso', async ({ page }) => {
    await page.evaluate(() => document.body.replaceChildren())
    await expect(exigirContraste(page, 'pantalla vacía', { esenciales: ['body'] })).rejects.toThrow(/sólo se midieron 0/)
    await expect(
      exigirContraste(page, 'mínimo cero', { esenciales: ['h1'], minimoMedidos: 0 })
    ).rejects.toThrow(/mayor que cero/)
    await expect(exigirContraste(page, 'sin esenciales', { esenciales: [] })).rejects.toThrow(/textos esenciales/)
  })

  test('un texto esencial omitido bloquea aunque todo lo demás pase', async ({ page }) => {
    await page.evaluate(() => {
      ;(document.querySelector('h1') as HTMLElement).style.visibility = 'hidden'
    })
    const medicion = await medirContraste(page, { esenciales: ['h1'] })
    expect(medicion.omitidos.some((o) => o.texto === 'Alumnos')).toBe(true)
    await expect(exigirContraste(page, 'esencial omitido', { esenciales: ['h1'] })).rejects.toThrow(/no se midieron completos/)
  })

  test('la cuenta de alfa anterior aprobaba un texto que en realidad no se lee', async ({ page }) => {
    const raiz = await insertarCaso(
      page,
      '<div style="background:rgb(0,0,0);padding:16px">' +
        '<p id="alfa-oscuro" style="color:rgba(120,120,120,0.5);font-size:16px;margin:0">Gris al cincuenta por ciento</p>' +
        '</div>'
    )

    // La fórmula anterior, reproducida sobre los mismos píxeles del navegador:
    // lee RGB sin premultiplicar y lo divide otra vez por el alfa.
    const ratioAnterior = await page.evaluate(() => {
      const lienzo = document.createElement('canvas')
      lienzo.width = 1
      lienzo.height = 1
      const pincel = lienzo.getContext('2d', { willReadFrequently: true })!
      pincel.fillStyle = getComputedStyle(document.querySelector('#alfa-oscuro')!).color
      pincel.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = pincel.getImageData(0, 0, 1, 1).data
      const alfa = a / 255
      const frente = [r / alfa, g / alfa, b / alfa].map((c) => c * alfa + 0 * (1 - alfa))
      const canal = (v: number) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
      }
      const l = 0.2126 * canal(frente[0]) + 0.7152 * canal(frente[1]) + 0.0722 * canal(frente[2])
      return (l + 0.05) / (0 + 0.05)
    })
    expect(
      ratioAnterior,
      'el caso discrimina: con la cuenta anterior este texto pasaba el umbral'
    ).toBeGreaterThanOrEqual(MINIMO_TEXTO_NORMAL)

    const medicion = await medirContraste(page, { raiz, esenciales: ['#alfa-oscuro'] })
    const hallazgo = medicion.hallazgos.find((h) => h.selector.startsWith('p#alfa-oscuro'))
    expect(hallazgo, 'con la composición correcta el mismo texto no alcanza el mínimo').toBeTruthy()
    expect(hallazgo!.ratio).toBeLessThan(2.5)
  })

  test('un texto cubierto por otro elemento no se da por medido', async ({ page }) => {
    await page.evaluate(() => {
      const titulo = document.querySelector('h1') as HTMLElement
      const caja = titulo.getBoundingClientRect()
      const tapa = document.createElement('div')
      Object.assign(tapa.style, {
        position: 'absolute',
        left: `${caja.left + window.scrollX}px`,
        top: `${caja.top + window.scrollY}px`,
        width: `${caja.width}px`,
        height: `${caja.height}px`,
        backgroundColor: 'rgb(255, 255, 255)',
        zIndex: '10',
      })
      document.body.appendChild(tapa)
    })
    const medicion = await medirContraste(page, { esenciales: ['h1'] })
    expect(medicion.ilegibles.some((i) => i.texto === 'Alumnos' && i.motivo.includes('cubierto'))).toBe(true)
  })

  test('afirmar que no hay texto visible falla si lo hay', async ({ page }) => {
    await expect(exigirSinTextoVisible(page, 'listado con texto')).rejects.toThrow(/hay texto visible/)
  })
})
