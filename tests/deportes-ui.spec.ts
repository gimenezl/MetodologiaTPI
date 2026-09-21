import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Interfaz de deportes con datos deterministas y API interceptada, sin base
 * (EPT-11). PRUEBA DE PRESENTACIÓN.
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales. Demuestra
 * estados difíciles de inducir contra la base (carga, vacío, error de lectura,
 * fallo de red, error del servidor, plaza ocupada por otro), accesibilidad,
 * idioma y comportamiento responsive. NO demuestra persistencia ni
 * autorización: eso lo prueban `deportes-auth.spec.ts`, `deportes_rls.sql` y
 * `deportes_concurrencia.mjs`. Las capturas de este archivo se nombran
 * `fixture-*` para no confundirlas con las reales.
 */

const ESCRITORIO = { width: 1280, height: 900 }
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

/** En WebKit táctil (iPhone 13) el navegador no recorre controles con Tab. */
function hayTeclado(page: Page) {
  return page.context().browser()?.browserType().name() !== 'webkit'
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  const perfil = esMovil(page) ? 'movil' : 'escritorio'
  await capturarSinHerramientas(page, path.join('docs/evidence/EPT-11', `fixture-${perfil}-${nombre}.png`))
}

function aplicacion(page: Page) {
  return page.getByRole('main')
}

async function sinScrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )
}

test.describe('pantalla del alumno (fixture)', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('muestra grupos, plazas, grupo completo y ningún control de eliminación', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=uno')
    await expect(page.getByRole('heading', { name: 'Deportes', level: 1 })).toBeVisible()
    await expect(page.getByText('1 de 2', { exact: true })).toBeVisible()
    await expect(aplicacion(page).getByText('Sin plazas')).toBeVisible()
    await expect(page.getByRole('button', { name: /Eliminar|Borrar/ })).toHaveCount(0)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await exigirPantallaSinDetalleTecnico(page, 'listado fixture')
    await capturar(page, 'alumno-un-deporte')
  })

  test('con dos deportes explica el límite en cada control, que sigue siendo enfocable', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=limite')
    await expect(page.getByText('2 de 2', { exact: true })).toBeVisible()
    const boton = page.getByRole('button', { name: /Inscribirme en Fútbol, Primario turno mañana/ })
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await expect(boton).toHaveAccessibleDescription(
      'Ya tenés dos deportes activos, que es el máximo permitido. Cancelá uno para inscribirte en otro.'
    )
    if (hayTeclado(page)) {
      await boton.focus()
      await expect(boton).toBeFocused()
    }
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'alumno-limite')
  })

  test('la plaza ocupada por otro alumno se informa con el mensaje del servidor', async ({ page }) => {
    await page.route('**/api/deportes/inscripciones', (ruta) =>
      ruta.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'El grupo ya no tiene plazas disponibles.', campo: 'grupo_id' }),
      })
    )
    await page.goto('/pruebas-ui/deportes?estado=disponible')
    await page.getByRole('button', { name: /Inscribirme en Natación/ }).click()
    await expect(
      aplicacion(page).getByRole('alert').filter({ hasText: 'El grupo ya no tiene plazas disponibles.' })
    ).toBeVisible()
    if (hayTeclado(page)) {
      await expect(page.getByLabel('Resultado de tu última operación')).toBeFocused()
    }
    await capturar(page, 'alumno-sin-plazas')
  })

  test('un error inesperado del servidor y un fallo de red muestran mensajes en español', async ({ page }) => {
    let intento = 0
    await page.route('**/api/deportes/inscripciones', (ruta) => {
      intento += 1
      if (intento === 1) {
        return ruta.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.' }),
        })
      }
      return ruta.abort('failed')
    })
    await page.goto('/pruebas-ui/deportes?estado=disponible')
    const boton = page.getByRole('button', { name: /Inscribirme en Atletismo/ })

    await boton.click()
    await expect(
      aplicacion(page).getByRole('alert').filter({ hasText: 'No pudimos completar la operación.' })
    ).toBeVisible()

    await boton.click()
    await expect(
      aplicacion(page).getByRole('alert').filter({ hasText: 'No pudimos comunicarnos con el servidor.' })
    ).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'fallo de red')
    await capturar(page, 'alumno-fallo-red')
  })

  test('sin grupos y con legajo inactivo explica el motivo', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=inactivo')
    await expect(aplicacion(page).getByText(/Tu legajo académico no está activo/)).toBeVisible()
    await expect(page.getByText('No hay grupos deportivos disponibles para tu nivel')).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'alumno-inactivo')
  })

  test('el estado de carga se anuncia y el error de lectura ofrece reintentar', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=carga')
    await expect(page.getByRole('status')).toHaveText('Cargando los deportes…')
    await capturar(page, 'carga')

    await page.goto('/pruebas-ui/deportes?estado=error-lectura')
    await expect(page.getByText('No pudimos cargar los deportes')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reintentar' })).toBeVisible()
    await capturar(page, 'error-lectura')
  })
})

test.describe('pantalla de la dirección (fixture)', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('muestra grupos con ocupación e inscripciones filtrables, sin controles de inscripción', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/deportes?vista=director')
    await expect(page.getByRole('heading', { name: 'Grupos deportivos' })).toBeVisible()
    await expect(aplicacion(page).getByText('Completo')).toBeVisible()
    await expect(page.getByText('2 inscripciones')).toBeVisible()
    await page.getByRole('button', { name: 'Todas' }).click()
    await expect(page.getByText('3 inscripciones')).toBeVisible()
    await page.getByLabel('Buscar').fill('atletismo')
    await expect(page.getByText('1 inscripción', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Inscribirme|Cancelar mi/ })).toHaveCount(0)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'director-listado')
  })

  test('el diálogo de alta retiene el foco, se cierra con Escape y devuelve el foco', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?vista=director')
    const nuevo = page.getByRole('button', { name: 'Nuevo grupo' })
    await nuevo.click()
    const dialogo = page.getByRole('dialog', { name: 'Nuevo grupo deportivo' })
    await expect(dialogo).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'director-dialogo')
    if (hayTeclado(page)) {
      await expect(dialogo.getByLabel('Deporte')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialogo).toHaveCount(0)
      await expect(nuevo).toBeFocused()
    }
  })

  test('sin grupos ni inscripciones muestra estados vacíos', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?vista=director&estado=vacio')
    await expect(page.getByText('Todavía no hay grupos deportivos')).toBeVisible()
    await expect(page.getByText('No hay inscripciones para mostrar')).toBeVisible()
    await capturar(page, 'director-vacio')
  })
})
