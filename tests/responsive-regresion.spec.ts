import { expect, test, type Page } from '@playwright/test'
import { exigirSinControlesAnidados } from './_semantica'

/**
 * Regresión permanente de RNF2 (responsive) y de accesibilidad básica (EPT-66).
 *
 * Cada ruta se abre a 375×812 (móvil) y a 1280×800 (escritorio) y se exige:
 * sin desplazamiento horizontal, idioma español, un único `main` y un único
 * `h1`, nombre accesible en todo enlace/botón, etiqueta en todo campo, texto
 * alternativo en toda imagen y ningún control dentro de otro.
 *
 * Alcance: las rutas públicas, el acceso y los bancos de pruebas de interfaz
 * (`/pruebas-ui/*`), que no necesitan base de datos. Las pantallas
 * autenticadas se cubren en sus suites `*-ui` (multiperfil) y `*-auth`.
 * IMPORTANTE: esta prueba comprueba estructura y desborde; NO certifica la
 * conformidad exacta con la paleta del PDF de la Parte 2 (RNF1), que no se pudo
 * contrastar. Esa revisión visual queda a cargo de una persona.
 */

const VISTAS = [
  { nombre: 'móvil 375×812', ancho: 375, alto: 812 },
  { nombre: 'escritorio 1280×800', ancho: 1280, alto: 800 },
] as const

const RUTAS_PUBLICAS = [
  '/',
  '/quienes-somos',
  '/niveles',
  '/galeria',
  '/bienestar',
  '/contacto',
  '/empleo',
  '/inscripcion',
  '/noticias',
  '/login',
]

const BANCOS_UI = [
  'accesos',
  'alumnos',
  'comedor',
  'credenciales',
  'cursos',
  'deportes',
  'hijos',
  'materias',
  'mis-asignaciones',
  'niveles',
  'profesores',
  'transporte',
].map((banco) => `/pruebas-ui/${banco}`)

async function sinDesborde(page: Page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    cliente: document.documentElement.clientWidth,
  }))
}

/** Controles sin nombre accesible, con una descripción legible de cada uno. */
async function controlesSinNombre(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = (el as HTMLElement).getBoundingClientRect()
      const estilo = getComputedStyle(el)
      return caja.width > 0 && caja.height > 0 && estilo.visibility !== 'hidden' && estilo.display !== 'none'
    }
    const texto = (id: string | null) =>
      (id ?? '').split(/\s+/u).map((i) => document.getElementById(i)?.textContent ?? '').join(' ').trim()
    const nombreDe = (el: Element) => {
      const aria = el.getAttribute('aria-label')?.trim()
      if (aria) return aria
      const rotulo = texto(el.getAttribute('aria-labelledby'))
      if (rotulo) return rotulo
      const interno = (el.textContent ?? '').trim()
      if (interno) return interno
      const imagen = el.querySelector('img[alt]')?.getAttribute('alt')?.trim()
      if (imagen) return imagen
      return (el.getAttribute('title') ?? '').trim()
    }
    const describir = (el: Element) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').slice(0, 40)}`
    const hallazgos: string[] = []
    for (const el of Array.from(document.querySelectorAll('a[href], button, [role="button"], [role="link"]'))) {
      if (visible(el) && !nombreDe(el)) hallazgos.push(`sin nombre: ${describir(el)}`)
    }
    for (const el of Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'))) {
      // Un campo oculto a la tecnología asistiva (p. ej. el selector de archivo del escáner) no necesita etiqueta.
      if (!visible(el) || el.closest('[aria-hidden="true"]')) continue
      const id = el.getAttribute('id')
      const etiquetado =
        el.getAttribute('aria-label')?.trim() ||
        texto(el.getAttribute('aria-labelledby')) ||
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
        el.closest('label')
      if (!etiquetado) hallazgos.push(`campo sin etiqueta: ${describir(el)}`)
    }
    for (const img of Array.from(document.querySelectorAll('img'))) {
      if (!img.hasAttribute('alt')) hallazgos.push(`imagen sin alt: ${(img.getAttribute('src') ?? '').slice(0, 60)}`)
    }
    return hallazgos
  })
}

for (const vista of VISTAS) {
  test.describe(`Regresión responsive y accesibilidad — ${vista.nombre}`, () => {
    test.use({ viewport: { width: vista.ancho, height: vista.alto } })

    for (const ruta of [...RUTAS_PUBLICAS, ...BANCOS_UI]) {
      test(`${ruta}`, async ({ page }) => {
        const respuesta = await page.goto(ruta, { waitUntil: 'domcontentloaded' })
        expect(respuesta?.status(), `${ruta} debe responder sin error`).toBeLessThan(400)
        await page.waitForLoadState('networkidle').catch(() => undefined)

        const { scroll, cliente } = await sinDesborde(page)
        expect(scroll, `desborde horizontal en ${ruta}: scrollWidth=${scroll} clientWidth=${cliente}`).toBeLessThanOrEqual(cliente + 1)

        await expect(page.locator('html')).toHaveAttribute('lang', /^es/u)
        // Los bancos de pruebas se renderizan sin el layout del panel, que es quien aporta `main`.
        if (!ruta.startsWith('/pruebas-ui/')) await expect(page.locator('main')).toHaveCount(1)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

        const sinNombre = await controlesSinNombre(page)
        expect(sinNombre, `${ruta}\n  ${sinNombre.join('\n  ')}`).toEqual([])
        await exigirSinControlesAnidados(page, ruta)
      })
    }
  })
}
