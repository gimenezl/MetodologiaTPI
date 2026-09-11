import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

/** Interfaz real con datos deterministas y API interceptada, sin base remota. */

const ESCRITORIO = { width: 1280, height: 900 }
const MOVIL = { width: 375, height: 812 }
const REGION_ESTADO = 'Estado de la administración de niveles'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await page.screenshot({
    path: path.join('docs/evidence/EPT-55', `fixture-${nombre}.png`),
    fullPage: true,
  })
}

test.describe('interfaz administrativa de niveles', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
  })

  test('muestra el catálogo ordenado con estados y protección institucional', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/niveles')

    const tabla = page.getByRole('table', { name: 'Tabla de niveles educativos' })
    await expect(tabla).toBeVisible()
    await expect(tabla.getByRole('row')).toHaveCount(6)

    const filas = tabla.getByRole('row')
    await expect(filas.nth(1)).toContainText('10')
    await expect(filas.nth(1)).toContainText('INICIAL')
    await expect(filas.nth(3)).toContainText('SECUNDARIO')
    await expect(filas.nth(3)).toContainText('Inactivo')
    await expect(filas.nth(4)).toContainText('Administrativo')

    await expect(
      page.getByText(/Los nombres de los niveles institucionales están protegidos/)
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Renombrar el nivel INICIAL' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)

    await capturar(page, 'escritorio-listado')
  })

  test('abre el alta con foco inicial y valida antes de llamar a la API', async ({
    page,
  }) => {
    let huboLlamada = false
    await page.route('**/api/niveles', async (route) => {
      huboLlamada = true
      await route.abort()
    })
    await page.goto('/pruebas-ui/niveles')

    await page.getByRole('button', { name: 'Nuevo nivel' }).click()
    const nombre = page.getByLabel('Nombre del nivel').first()
    await expect(nombre).toBeFocused()
    await nombre.fill(' NIVEL INVÁLIDO ')
    await page.getByRole('button', { name: 'Crear nivel' }).click()

    await expect(
      page.getByText('El nombre del nivel no puede tener espacios al inicio o al final')
    ).toBeVisible()
    expect(huboLlamada).toBe(false)
  })

  test('expone el estado de envío y confirma un alta correcta', async ({ page }) => {
    await page.route('**/api/niveles', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700))
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/niveles')
    await page.getByRole('button', { name: 'Nuevo nivel' }).click()
    await page.getByLabel('Nombre del nivel').first().fill('NIVEL DE PRUEBA')

    await page.getByRole('button', { name: 'Crear nivel' }).click()
    await expect(page.getByRole('button', { name: 'Cargando...' })).toBeDisabled()
    await expect(
      page.getByRole('status').filter({ hasText: 'Nivel NIVEL DE PRUEBA creado correctamente.' })
    ).toBeVisible()

    await capturar(page, 'escritorio-alta-exitosa')
  })

  test('permite corregir un duplicado y reintentar sin recargar', async ({ page }) => {
    let intentos = 0
    await page.route('**/api/niveles', async (route) => {
      intentos += 1
      if (intentos === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Ya existe un nivel educativo con ese nombre.',
            campo: 'nombre',
          }),
        })
        return
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/niveles')
    await page.getByRole('button', { name: 'Nuevo nivel' }).click()
    const nombre = page.getByLabel('Nombre del nivel').first()
    await nombre.fill('INICIAL')
    await page.getByRole('button', { name: 'Crear nivel' }).click()

    await expect(
      page.getByRole('alert').filter({
        hasText: 'Ya existe un nivel educativo con ese nombre.',
      }).first()
    ).toBeVisible()

    await nombre.fill('NIVEL CORREGIDO')
    await page.getByRole('button', { name: 'Crear nivel' }).click()
    await expect(page.getByRole('status')).toContainText(
      'Nivel NIVEL CORREGIDO creado correctamente.'
    )
    expect(intentos).toBe(2)
  })

  test('renombra un nivel administrativo desde un diálogo accesible', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/niveles/4', async (route) => {
      cuerpo = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/niveles')
    await page
      .getByRole('button', { name: 'Renombrar el nivel FORMACIÓN PROFESIONAL' })
      .click()

    const dialogo = page.getByRole('dialog', {
      name: 'Renombrar FORMACIÓN PROFESIONAL',
    })
    await expect(dialogo).toBeVisible()
    await expect(page.locator('#renombrar-nivel-nombre')).toBeFocused()
    await page.locator('#renombrar-nivel-nombre').fill('TRAYECTO PROFESIONAL')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()

    expect(cuerpo).toEqual({ accion: 'renombrar', nombre: 'TRAYECTO PROFESIONAL' })
    await expect(page.getByRole('status')).toContainText(
      'Nivel renombrado como TRAYECTO PROFESIONAL.'
    )
  })

  test('confirma el cambio de estado sin usar confirmación nativa', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/niveles/4', async (route) => {
      cuerpo = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/niveles')
    await page
      .getByRole('button', { name: 'Inactivar el nivel FORMACIÓN PROFESIONAL' })
      .click()

    const dialogo = page.getByRole('dialog', {
      name: 'Inactivar FORMACIÓN PROFESIONAL',
    })
    await expect(dialogo).toBeVisible()
    const confirmar = dialogo.getByRole('button', { name: 'Confirmar inactivación' })
    await expect(confirmar).toBeFocused()
    await confirmar.click()

    expect(cuerpo).toEqual({ accion: 'cambiar_estado', activo: false })
    await expect(page.getByRole('status')).toContainText(
      'Nivel FORMACIÓN PROFESIONAL inactivado.'
    )
  })

  test('retiene el foco, cierra con Escape y lo devuelve al disparador', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/niveles')
    const disparador = page.getByRole('button', {
      name: 'Inactivar el nivel FORMACIÓN PROFESIONAL',
    })
    await disparador.click()

    const dialogo = page.getByRole('dialog')
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
      ).toBe(true)
    }
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Shift+Tab')
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
      ).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
    await expect(disparador).toBeFocused()
  })

  test('muestra estados difíciles de carga, vacío, error y éxito', async ({ page }) => {
    await page.goto('/pruebas-ui/niveles?estado=carga')
    await expect(page.getByText('Cargando los niveles educativos…')).toBeAttached()

    await page.goto('/pruebas-ui/niveles?vacio=1')
    await expect(page.getByText('No hay niveles educativos registrados')).toBeVisible()

    await page.goto('/pruebas-ui/niveles?estado=error')
    await expect(
      page.getByLabel(REGION_ESTADO).getByRole('alert')
    ).toContainText('No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.')

    await page.goto('/pruebas-ui/niveles?estado=exito')
    await expect(page.getByRole('status')).toContainText(
      'Nivel actualizado correctamente.'
    )
  })

  test('nombra en español controles, regiones y contenido visible', async ({ page }) => {
    await page.goto('/pruebas-ui/niveles')
    await expect(page.getByLabel(REGION_ESTADO)).toHaveAttribute('aria-live', 'polite')
    await page.getByRole('button', { name: 'Nuevo nivel' }).click()

    const texto = await page.evaluate(() => {
      const raiz = document.querySelector('main, body') as HTMLElement
      const nombres = Array.from(
        document.querySelectorAll('[aria-label], [placeholder], [title]')
      ).flatMap((elemento) => [
        elemento.getAttribute('aria-label'),
        elemento.getAttribute('placeholder'),
        elemento.getAttribute('title'),
      ])
      return [raiz.innerText, ...nombres].filter(Boolean).join('\n')
    })

    for (const palabra of [
      'save',
      'delete',
      'remove',
      'submit',
      'close',
      'required',
      'create',
      'update',
      'level',
      'status',
      'actions',
      'inactive',
    ]) {
      expect(new RegExp(`\\b${palabra}\\b`, 'i').test(texto)).toBe(false)
    }
  })
})

test.describe('interfaz administrativa de niveles en pantalla angosta', () => {
  test.use({ viewport: MOVIL })

  test('usa tarjetas y no genera desplazamiento horizontal', async ({ page }) => {
    await page.goto('/pruebas-ui/niveles')

    await expect(page.getByRole('list', { name: 'Niveles educativos ordenados' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Tabla de niveles educativos' })).toBeHidden()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
    ).toBe(false)

    await capturar(page, 'movil-listado')
  })

  test('permite abrir el alta y el diálogo sin desbordar', async ({ page }) => {
    await page.goto('/pruebas-ui/niveles')
    await page.getByRole('button', { name: 'Nuevo nivel' }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo nivel educativo' })).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar formulario' }).click()

    await page
      .getByRole('button', { name: 'Renombrar el nivel FORMACIÓN PROFESIONAL' })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
    ).toBe(false)

    await capturar(page, 'movil-renombrado')
  })
})
