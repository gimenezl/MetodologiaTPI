import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

/**
 * Course administration — UI, state and accessibility coverage (EPT-16 / EPT-18).
 *
 * Runs against `/pruebas-ui/cursos`, the committed harness that renders the real
 * `GestionCursos` component with fixture rows. The harness is gated by
 * `EPT_UI_HARNESS=1`, which `playwright.config.ts` sets for the dev server, and
 * is disabled outright in production builds.
 *
 * Scope, stated plainly: these tests prove layout, state handling, Spanish copy
 * and keyboard/screen-reader behaviour. Domain errors are asserted by mocking
 * the `/api/cursos` HTTP contract, so they prove the UI renders each documented
 * response — they do NOT prove the PostgreSQL rules that produce them. The
 * database proof lives in `supabase/tests/cursos_rls.sql`, and the authenticated
 * director path is still unproven; `docs/evidence/EPT-8.md` records both.
 */

const CAPTURAS = 'docs/evidence/EPT-8'
const ESCRITORIO = { width: 1280, height: 900 }
const MOVIL = { width: 375, height: 812 }

/** Accessible name of the page's own status region, in Spanish, as shipped. */
const REGION_ESTADO = 'Estado de la administración de cursos'

/**
 * Screenshots are opt-in so an ordinary `npm run test:e2e` leaves the working
 * tree clean — re-rendering produces byte-different files even when nothing
 * changed. Regenerate the committed evidence deliberately with:
 *
 *     EPT_CAPTURAS=1 npx playwright test tests/cursos-ui.spec.ts
 */
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true })
}

/** Fills the create form with valid values so submission reaches the network. */
async function completarAlta(page: Page) {
  await page.getByLabel('Denominación').first().fill('2do Grado')
  await page.getByLabel('División').first().fill('C')
  await page.getByLabel('Nivel educativo').first().selectOption('2')
}

test.describe('course administration UI', () => {
  test('renders the populated list with active and inactive courses', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')

    await expect(page.getByRole('heading', { name: 'Cursos', level: 1 })).toBeVisible()

    const tabla = page.getByRole('table', { name: 'Tabla de cursos' })
    await expect(tabla).toBeVisible()
    await expect(tabla.getByRole('row')).toHaveCount(6) // header + 5 fixtures
    await expect(tabla.getByText('Activo').first()).toBeVisible()
    await expect(tabla.getByText('Inactivo')).toBeVisible()

    // A row offering "Reactivar" is the visible proof that deactivation is
    // reversible rather than destructive.
    await expect(page.getByRole('button', { name: 'Reactivar el curso 1er Grado B' })).toBeVisible()

    await capturar(page, 'escritorio-01-listado')
  })

  test('offers no delete control anywhere in the list', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')

    for (const etiqueta of [/eliminar/i, /borrar/i, /suprimir/i]) {
      await expect(page.getByRole('button', { name: etiqueta })).toHaveCount(0)
    }
  })

  test('shows a distinct empty state, not an error', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos?vacio=1')

    await expect(page.getByText('No hay cursos registrados')).toBeVisible()
    // "No hay cursos" and "we could not read the courses" must never look alike:
    // the status region has to stay empty here.
    await expect(page.getByLabel(REGION_ESTADO)).toBeEmpty()

    await capturar(page, 'escritorio-06-vacio')
  })

  test('reports validation errors per field, announced as alerts', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')

    await page.getByRole('button', { name: 'Nuevo curso' }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo curso' })).toBeVisible()
    await capturar(page, 'escritorio-02-formulario')

    await page.getByRole('button', { name: 'Crear curso' }).click()

    await expect(page.getByText('La denominación es requerida')).toBeVisible()
    await expect(page.getByText('La división es requerida')).toBeVisible()
    await expect(page.getByText('Seleccioná un nivel educativo')).toBeVisible()

    // The designation error must be exposed as an alert, not just coloured text.
    await expect(
      page.getByRole('alert').filter({ hasText: 'La denominación es requerida' })
    ).toBeVisible()

    await capturar(page, 'escritorio-03-validacion')
  })

  test('rejects whitespace-only input before reaching the network', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    let huboLlamada = false
    await page.route('**/api/cursos', async (route) => {
      huboLlamada = true
      await route.abort()
    })

    await page.goto('/pruebas-ui/cursos')
    await page.getByRole('button', { name: 'Nuevo curso' }).click()
    await page.getByLabel('Denominación').first().fill('   ')
    await page.getByLabel('División').first().fill('   ')
    await page.getByLabel('Nivel educativo').first().selectOption('2')
    await page.getByRole('button', { name: 'Crear curso' }).click()

    await expect(page.getByText('La denominación es requerida')).toBeVisible()
    expect(huboLlamada, 'invalid input must not reach /api/cursos').toBe(false)
  })

  test('renders the duplicate-course domain error in Spanish', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.route('**/api/cursos', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Ya existe un curso con esa denominación y división en el nivel elegido.',
          campo: 'denominacion',
        }),
      })
    })

    await page.goto('/pruebas-ui/cursos')
    await page.getByRole('button', { name: 'Nuevo curso' }).click()
    await completarAlta(page)
    await page.getByRole('button', { name: 'Crear curso' }).click()

    const aviso = page.getByRole('alert').filter({
      hasText: 'Ya existe un curso con esa denominación y división en el nivel elegido.',
    })
    await expect(aviso.first()).toBeVisible()

    await capturar(page, 'escritorio-05-error-duplicado')
  })

  test('renders the missing-level domain error in Spanish', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.route('**/api/cursos', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'El nivel educativo elegido no existe.', campo: 'nivel_id' }),
      })
    })

    await page.goto('/pruebas-ui/cursos')
    await page.getByRole('button', { name: 'Nuevo curso' }).click()
    await completarAlta(page)
    await page.getByRole('button', { name: 'Crear curso' }).click()

    await expect(
      page.getByRole('alert').filter({ hasText: 'El nivel educativo elegido no existe.' }).first()
    ).toBeVisible()
  })

  test('disables the submit button while the request is in flight', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.route('**/api/cursos', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto('/pruebas-ui/cursos')
    await page.getByRole('button', { name: 'Nuevo curso' }).click()
    await completarAlta(page)

    const enviar = page.getByRole('button', { name: 'Crear curso' })
    await enviar.click()

    const cargando = page.getByRole('button', { name: 'Cargando...' })
    await expect(cargando).toBeVisible()
    await expect(cargando).toBeDisabled()
    await capturar(page, 'escritorio-08-enviando')
  })

  test('opens the edit dialog with correct labelling and initial focus', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')

    await page.getByRole('button', { name: 'Editar el curso 1er Grado A' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toHaveAttribute('aria-modal', 'true')
    await expect(dialogo.getByRole('heading', { name: 'Editar 1er Grado A' })).toBeVisible()

    // Focus lands on the first editable field, not the close button.
    await expect(page.locator('#editar-denominacion')).toBeFocused()
    await expect(page.locator('#editar-denominacion')).toHaveValue('1er Grado')

    await capturar(page, 'escritorio-04-edicion')
    await capturar(page, 'escritorio-07-foco-dialogo')
  })

  test('keeps keyboard focus inside the dialog while it is open', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')
    await page.getByRole('button', { name: 'Editar el curso 1er Grado A' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const dentroDelDialogo = () =>
      page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))

    // Forward past the last control must wrap, never escape to the page behind.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect(await dentroDelDialogo(), `focus escaped after ${i + 1} Tab presses`).toBe(true)
    }

    // Backwards from the first control must wrap too.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await dentroDelDialogo(), `focus escaped after ${i + 1} Shift+Tab presses`).toBe(true)
    }
  })

  test('closes the dialog with Escape and restores focus to the trigger', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')

    const disparador = page.getByRole('button', { name: 'Editar el curso 1er Grado A' })
    await disparador.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(disparador).toBeFocused()
  })

  test('reaches the create form using only the keyboard', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')

    await page.keyboard.press('Tab')
    const alta = page.getByRole('button', { name: 'Nuevo curso' })
    await expect(alta).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Nuevo curso' })).toBeVisible()
  })

  test('describes the table and every row action for screen readers', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/pruebas-ui/cursos')

    const tabla = page.getByRole('table', { name: 'Tabla de cursos' })
    await expect(tabla.locator('caption')).toHaveText(/Cursos registrados/)
    await expect(tabla.locator('th[scope="col"]')).toHaveCount(4)

    // Row actions name their course, so "Editar" is never ambiguous out of context.
    await expect(page.getByRole('button', { name: 'Editar el curso Sala de 4 A' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Inactivar el curso Sala de 4 A' })).toBeVisible()

    // The page owns a named live region, so failures are announced, not only shown.
    const estado = page.getByLabel(REGION_ESTADO)
    await expect(estado).toHaveCount(1)
    await expect(estado).toHaveAttribute('aria-live', 'polite')
  })
})

/**
 * English words that would betray untranslated UI copy. Matched with word
 * boundaries so Spanish words that merely start the same way — "Cancelar",
 * "Editar", "Crear", "Nivel" — never trigger a false positive.
 */
const PALABRAS_EN_INGLES = [
  'save', 'cancel', 'delete', 'remove', 'loading', 'submit', 'close', 'required',
  'create', 'update', 'search', 'level', 'course', 'courses', 'name', 'status',
  'actions', 'empty', 'error', 'active', 'inactive', 'edit', 'new', 'back',
]

test('every visible string and accessible name is Spanish', async ({ page }) => {
  await page.setViewportSize(ESCRITORIO)
  await page.goto('/pruebas-ui/cursos')

  // Open the form and the dialog so their copy is included in the audit.
  await page.getByRole('button', { name: 'Nuevo curso' }).click()
  await page.getByRole('button', { name: 'Crear curso' }).click()
  await expect(page.getByText('La denominación es requerida')).toBeVisible()

  const textos = await page.evaluate(() => {
    const raiz = document.querySelector('main, body') as HTMLElement
    const visible = raiz.innerText
    const nombres = Array.from(
      document.querySelectorAll('[aria-label], [aria-labelledby], [placeholder], [alt], [title]')
    ).flatMap((e) => [
      e.getAttribute('aria-label'),
      e.getAttribute('placeholder'),
      e.getAttribute('alt'),
      e.getAttribute('title'),
    ])
    return [visible, ...nombres].filter(Boolean).join('\n')
  })

  for (const palabra of PALABRAS_EN_INGLES) {
    const patron = new RegExp(`\\b${palabra}\\b`, 'i')
    expect(
      patron.test(textos),
      `found the English word "${palabra}" in user-visible course copy`
    ).toBe(false)
  }

  // And confirm the Spanish copy that must be there really is.
  for (const esperado of ['Cursos', 'Nuevo curso', 'Denominación', 'División', 'Nivel educativo']) {
    expect(textos, `missing expected Spanish copy "${esperado}"`).toContain(esperado)
  }
})

test.describe('course administration UI on a narrow screen', () => {
  test.use({ viewport: MOVIL })

  test('lays out as cards without depending on horizontal scrolling', async ({ page }) => {
    await page.goto('/pruebas-ui/cursos')

    await expect(page.getByRole('list', { name: 'Cursos registrados' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Tabla de cursos' })).toBeHidden()

    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(desborda, 'the page must not scroll horizontally at 375px').toBe(false)

    await capturar(page, 'movil-01-listado')
  })

  test('shows the form and its validation errors', async ({ page }) => {
    await page.goto('/pruebas-ui/cursos')

    await page.getByRole('button', { name: 'Nuevo curso' }).click()
    await page.getByRole('button', { name: 'Crear curso' }).click()
    await expect(page.getByText('La denominación es requerida')).toBeVisible()

    await capturar(page, 'movil-02-formulario-validacion')
  })

  test('shows the edit dialog', async ({ page }) => {
    await page.goto('/pruebas-ui/cursos')

    await page.getByRole('button', { name: 'Editar el curso 1er Grado A' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await capturar(page, 'movil-03-edicion')
  })

  test('shows the empty state', async ({ page }) => {
    await page.goto('/pruebas-ui/cursos?vacio=1')

    await expect(page.getByText('No hay cursos registrados')).toBeVisible()
    await capturar(page, 'movil-04-vacio')
  })
})
