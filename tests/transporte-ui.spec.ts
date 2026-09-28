import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'

/**
 * Interfaz real del transporte con datos deterministas y API interceptada,
 * sin base remota (EPT-60).
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales: las
 * aserciones se adaptan al ancho, de modo que un mismo archivo demuestra las
 * dos presentaciones.
 *
 * Lo que estas pruebas demuestran es PRESENTACIÓN: estados, accesibilidad,
 * idioma y comportamiento responsive. No demuestran persistencia ni
 * autorización; eso lo prueban `transporte-auth.spec.ts`, `transporte_rls.sql`
 * y `transporte_concurrencia.mjs`.
 */

const ESCRITORIO = { width: 1280, height: 900 }

/**
 * En el perfil de iPhone 13 (WebKit táctil) el navegador no mueve el foco al
 * pulsar un botón ni recorre los controles con Tab: es el comportamiento real
 * de esa plataforma, no un defecto de la aplicación.
 */
function hayTeclado(page: Page) {
  return page.context().browser()?.browserType().name() !== 'webkit'
}
const REGION_ESTADO = 'Estado de tu recorrido de transporte'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  const perfil = esMovil(page) ? 'movil' : 'escritorio'
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-60', `fixture-${perfil}-${nombre}.png`)
  )
}

/**
 * La aplicación, sin los elementos del framework. Next agrega su propio
 * anunciador de ruta con `role="alert"`, que no es contenido de la
 * aplicación.
 */
function aplicacion(page: Page) {
  return page.getByRole('main')
}

async function haySrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
}

test.describe('pantalla del alumno', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('muestra el estado sin recorrido y los cuatro recorridos elegibles', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/transporte?estado=sin-recorrido')

    await expect(page.getByRole('heading', { name: 'Transporte', level: 1 })).toBeVisible()
    await expect(
      page.getByText('Todavía no tenés un recorrido de transporte activo.')
    ).toBeVisible()
    // Los cuatro recorridos ofrecen el mismo botón; el de TR-ESTE (inactivo)
    // queda deshabilitado en vez de no aparecer.
    await expect(page.getByRole('button', { name: 'Elegir este recorrido' })).toHaveCount(4)
    await expect(page.getByRole('button', { name: 'Cancelar este recorrido' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'sin-recorrido')
  })

  test('el recorrido inactivo se ve marcado y su botón queda deshabilitado', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/transporte?estado=sin-recorrido')

    const tarjetaEste = page.locator('li', { hasText: 'Recorrido Este' })
    await expect(tarjetaEste.getByText('No disponible')).toBeVisible()
    await expect(tarjetaEste.getByRole('button')).toBeDisabled()
  })

  test('muestra el recorrido activo y ofrece cambiar a los demás', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?estado=con-recorrido')

    const tarjetaNorte = page.locator('li', { hasText: 'Recorrido Norte' })
    await expect(tarjetaNorte.getByText('Tu recorrido actual')).toBeVisible()
    await expect(
      tarjetaNorte.getByRole('button', { name: 'Cancelar este recorrido' })
    ).toBeEnabled()
    await expect(
      page.locator('li', { hasText: 'Recorrido Oeste' }).getByRole('button', {
        name: 'Cambiar a este recorrido',
      })
    ).toBeEnabled()

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'con-recorrido')
  })

  test('conserva el historial de recorridos cancelados', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?estado=con-recorrido')

    const historial = page.getByRole('heading', { name: 'Recorridos anteriores' })
    await expect(historial).toBeVisible()
    await expect(page.getByText('Cancelado')).toBeVisible()
    await expect(page.getByText(/^Alta:/)).toBeVisible()
    await capturar(page, 'historial')
  })

  test('el estado vacío explica qué va a aparecer y no parece un error', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/transporte?estado=sin-recorrido&vacio=1')

    await expect(
      page.getByText('Todavía no cancelaste ni cambiaste de recorrido')
    ).toBeVisible()
    await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)
    await capturar(page, 'vacio')
  })

  test('confirma antes de cancelar, con foco inicial, contención, Escape y devolución', async ({
    page,
  }) => {
    let huboLlamada = false
    await page.route('**/api/transporte/**', async (route) => {
      huboLlamada = true
      await route.abort()
    })
    await page.goto('/pruebas-ui/transporte?estado=con-recorrido')

    const disparador = page.getByRole('button', { name: 'Cancelar este recorrido' })
    await disparador.click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(
      dialogo.getByRole('heading', { name: 'Cancelar tu recorrido de transporte' })
    ).toBeVisible()
    await expect(dialogo).toContainText('se conserva en el historial')
    await capturar(page, 'confirmacion-cancelacion')

    const volver = dialogo.getByRole('button', { name: 'Volver sin cancelar' })
    if (hayTeclado(page)) {
      await expect(volver).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(
        dialogo.getByRole('button', { name: 'Sí, cancelar mi recorrido' })
      ).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialogo.getByRole('button', { name: 'Cerrar diálogo' })).toBeFocused()
    }

    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    if (hayTeclado(page)) {
      await expect(disparador).toBeFocused()
    }
    expect(huboLlamada).toBe(false)
  })

  test('el error general se anuncia como alerta dentro de la región de estado', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/transporte?estado=error')

    const region = page.getByLabel(REGION_ESTADO)
    await expect(region).toHaveAttribute('aria-live', 'polite')
    const alerta = aplicacion(page).getByRole('alert')
    await expect(alerta).toBeVisible()
    await expect(alerta).toContainText('No pudimos completar la operación.')

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'error')
  })

  test('el alumno inactivo ve el motivo y los botones deshabilitados', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?estado=inactivo')

    await expect(page.getByText(/Tu legajo académico no está activo/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Elegir este recorrido' }).first()).toBeDisabled()
    await capturar(page, 'alumno-inactivo')
  })

  test('el estado de carga es explícito y anunciado', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?estado=carga')

    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    await expect(page.getByText('Cargando el transporte…')).toBeAttached()
    await capturar(page, 'carga')
  })

  test('se opera completamente con el teclado', async ({ page }) => {
    test.skip(!hayTeclado(page), 'El perfil táctil de WebKit no expone teclado físico.')
    await page.route('**/api/transporte/**', async (route) => route.abort())
    await page.goto('/pruebas-ui/transporte?estado=con-recorrido')

    const disparador = page.getByRole('button', { name: 'Cancelar este recorrido' })
    await disparador.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('todo el texto visible está en español', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?estado=con-recorrido')

    const texto = (await page.locator('main, body').first().innerText()).toLowerCase()
    for (const palabra of [
      'loading',
      'cancel ',
      'submit',
      'delete',
      'error:',
      'undefined',
      'null',
    ]) {
      expect(texto, `la pantalla no debe mostrar "${palabra}"`).not.toContain(palabra)
    }
    await expect(page.getByRole('heading', { name: 'Transporte', level: 1 })).toBeVisible()
  })
})

test.describe('consulta administrativa de recorridos', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('presenta los cuatro recorridos con su ocupación, legible en los tres perfiles', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/transporte?vista=director')

    await expect(page.getByRole('heading', { name: 'Transporte', level: 1 })).toBeVisible()
    const recorridos = page.getByRole('region', { name: 'Recorridos' })
    await expect(recorridos.getByText('TR-NORTE', { exact: true })).toBeVisible()
    await expect(recorridos.getByText('TR-SUR', { exact: true })).toBeVisible()
    await expect(recorridos.getByText('TR-ESTE', { exact: true })).toBeVisible()
    await expect(recorridos.getByText('TR-OESTE', { exact: true })).toBeVisible()
    await expect(
      page.locator('li', { hasText: 'Recorrido Norte' }).getByText(/alumno\(s\)/)
    ).toContainText('1')

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'gestion')
  })

  test('el código y las paradas no ofrecen ningún control de edición', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?vista=director')

    await expect(page.getByText('El código y las paradas son datos de referencia')).toBeVisible()
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)
  })

  test('edita el nombre y el estado de un recorrido con foco inicial en el campo', async ({
    page,
  }) => {
    let cuerpoEnviado: unknown
    await page.route('**/api/transporte/recorridos/**', async (route) => {
      cuerpoEnviado = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          recorrido: { id: 'x', codigo: 'TR-NORTE', nombre: 'x', activo: true },
        }),
      })
    })
    await page.goto('/pruebas-ui/transporte?vista=director')

    await page
      .locator('li', { hasText: 'Recorrido Norte' })
      .getByRole('button', { name: /Editar/ })
      .click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    const campoNombre = dialogo.getByLabel('Nombre del recorrido')
    if (hayTeclado(page)) await expect(campoNombre).toBeFocused()

    await campoNombre.fill('Recorrido Norte (renombrado en la prueba)')
    await dialogo.getByLabel(/Recorrido activo/).uncheck()
    await capturar(page, 'editar-recorrido')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page.getByText('Actualizaste TR-NORTE.')).toBeVisible()
    expect(cuerpoEnviado).toMatchObject({
      nombre: 'Recorrido Norte (renombrado en la prueba)',
      activo: false,
    })
  })

  test('filtra por recorrido, por estado y busca por apellido o legajo', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?vista=director')

    // Por defecto solo se ven las activas: 2 de las 3 filas del banco.
    await expect(page.getByText('2 inscripciones')).toBeVisible()

    await page.getByRole('button', { name: 'Todas', exact: true }).click()
    await expect(page.getByText('3 inscripciones')).toBeVisible()

    await page.getByRole('button', { name: 'TR-NORTE', exact: true }).click()
    await expect(page.getByText('1 inscripción')).toBeVisible()

    await page.getByRole('button', { name: 'Todos los recorridos' }).click()
    await page.getByRole('button', { name: 'Canceladas', exact: true }).click()
    await expect(page.getByText('1 inscripción')).toBeVisible()

    await page.getByRole('button', { name: 'Todas', exact: true }).click()
    await page.getByLabel('Buscar').fill('LEG-BANCO-0003')
    await expect(page.getByText('1 inscripción')).toBeVisible()
    await capturar(page, 'gestion-filtro')
  })

  test('el listado vacío se explica y no se confunde con un error', async ({ page }) => {
    await page.goto('/pruebas-ui/transporte?vista=director&vacio=1')

    await expect(page.getByText('No hay inscripciones para mostrar')).toBeVisible()
    await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)
    await capturar(page, 'gestion-vacia')
  })
})
