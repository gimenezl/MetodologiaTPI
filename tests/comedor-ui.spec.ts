import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'

/**
 * Interfaz real del comedor con datos deterministas y API interceptada, sin
 * base remota (EPT-10, EPT-28).
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales: las aserciones
 * se adaptan al ancho, de modo que un mismo archivo demuestra las dos
 * presentaciones.
 *
 * Lo que estas pruebas demuestran es PRESENTACIÓN: estados, accesibilidad,
 * idioma y comportamiento responsive. No demuestran persistencia ni
 * autorización; eso lo prueban `comedor-auth.spec.ts`, `comedor_rls.sql` y
 * `comedor_concurrencia.mjs`.
 */

const ESCRITORIO = { width: 1280, height: 900 }

/**
 * En el perfil de iPhone 13 (WebKit táctil) el navegador no mueve el foco al
 * pulsar un botón ni recorre los controles con Tab: es el comportamiento real
 * de esa plataforma, no un defecto de la aplicación. Las aserciones de foco y
 * de navegación por teclado se verifican en los perfiles donde el teclado
 * existe; el resto de la accesibilidad sí se comprueba en los tres.
 */
function hayTeclado(page: Page) {
  return page.context().browser()?.browserType().name() !== 'webkit'
}
const REGION_ESTADO = 'Estado de tu inscripción al comedor'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  const perfil = esMovil(page) ? 'movil' : 'escritorio'
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-10', `fixture-${perfil}-${nombre}.png`)
  )
}

/**
 * La aplicación, sin los elementos del framework.
 *
 * Next agrega su propio anunciador de ruta con `role="alert"` y, en desarrollo,
 * una región de notificaciones. Una búsqueda global de alertas los encontraría
 * y haría fallar la comprobación de «acá no hay ningún error» aunque la
 * pantalla esté perfecta. Acotar al landmark principal deja fuera todo lo que
 * no es contenido de la aplicación.
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

  test('muestra el estado sin inscripción y ningún control de eliminación', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/comedor?estado=sin-inscripcion')

    await expect(page.getByRole('heading', { name: 'Comedor', level: 1 })).toBeVisible()
    await expect(page.getByText('Sin inscripción activa')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Inscribirme al comedor' })
    ).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Cancelar mi inscripción' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'sin-inscripcion')
  })

  test('muestra el estado inscripto con el legajo y la fecha de alta', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/comedor?estado=inscripto')

    await expect(page.getByText('Inscripción activa')).toBeVisible()
    await expect(page.getByText('LEG-BANCO-0002')).toBeVisible()
    await expect(page.getByText('Legajo')).toBeVisible()
    await expect(page.getByText('Fecha de inscripción')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Cancelar mi inscripción' })
    ).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Inscribirme al comedor' })
    ).toHaveCount(0)

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'estado-inscripto')
  })

  test('conserva el historial de ciclos cancelados', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?estado=inscripto')

    const historial = page.getByRole('heading', { name: 'Inscripciones anteriores' })
    await expect(historial).toBeVisible()
    await expect(page.getByText('Cancelada')).toBeVisible()
    await expect(page.getByText(/^Alta:/)).toBeVisible()
    await expect(page.getByText(/^Baja:/)).toBeVisible()
    await capturar(page, 'historial')
  })

  test('el estado vacío explica qué va a aparecer y no parece un error', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/comedor?estado=sin-inscripcion&vacio=1')

    await expect(
      page.getByText('Todavía no cancelaste ninguna inscripción')
    ).toBeVisible()
    await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)
    await capturar(page, 'vacio')
  })

  test('confirma antes de cancelar, con foco inicial, contención, Escape y devolución', async ({
    page,
  }) => {
    let huboLlamada = false
    await page.route('**/api/comedor/**', async (route) => {
      huboLlamada = true
      await route.abort()
    })
    await page.goto('/pruebas-ui/comedor?estado=inscripto')

    const disparador = page.getByRole('button', { name: 'Cancelar mi inscripción' })
    await disparador.click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(
      dialogo.getByRole('heading', { name: 'Cancelar tu inscripción al comedor' })
    ).toBeVisible()
    // La confirmación explica que nada se elimina.
    await expect(dialogo).toContainText('se conserva en el historial')

    const volver = dialogo.getByRole('button', { name: 'Volver sin cancelar' })
    await expect(volver).toBeVisible()
    await capturar(page, 'confirmacion-cancelacion')

    if (hayTeclado(page)) {
      // Foco inicial en la acción NO destructiva.
      await expect(volver).toBeFocused()

      // Contención del foco: Tab circula dentro del diálogo.
      await page.keyboard.press('Tab')
      await expect(
        dialogo.getByRole('button', { name: 'Sí, cancelar mi inscripción' })
      ).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialogo.getByRole('button', { name: 'Cerrar diálogo' })).toBeFocused()
    }

    // Escape cierra, sin llamar a la API.
    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    if (hayTeclado(page)) {
      // El foco vuelve al disparador.
      await expect(disparador).toBeFocused()
    }
    expect(huboLlamada).toBe(false)
  })

  test('el error de duplicado se anuncia como alerta dentro de la región de estado', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/comedor?estado=duplicado')

    const region = page.getByLabel(REGION_ESTADO)
    await expect(region).toHaveAttribute('aria-live', 'polite')
    const alerta = aplicacion(page).getByRole('alert')
    await expect(alerta).toBeVisible()
    await expect(alerta).toContainText('Ya tenés una inscripción activa al comedor.')

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'error-duplicado')
  })

  test('el alumno inactivo ve el motivo y el botón deshabilitado', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?estado=inactivo')

    await expect(page.getByText(/Tu legajo académico no está activo/)).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Inscribirme al comedor' })
    ).toBeDisabled()
    await capturar(page, 'alumno-inactivo')
  })

  test('el servicio inactivo también impide el alta y lo explica', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?estado=servicio-inactivo')

    await expect(
      page.getByText('El comedor no está recibiendo inscripciones en este momento.')
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Inscribirme al comedor' })
    ).toBeDisabled()
  })

  test('el error general se muestra como alerta', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?estado=error')

    await expect(aplicacion(page).getByRole('alert')).toContainText(
      'No pudimos completar la operación.'
    )
    await capturar(page, 'error')
  })

  test('el estado de carga es explícito y anunciado', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?estado=carga')

    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    await expect(page.getByText('Cargando el comedor…')).toBeAttached()
    await capturar(page, 'carga')
  })

  test('se opera completamente con el teclado', async ({ page }) => {
    test.skip(!hayTeclado(page), 'El perfil táctil de WebKit no expone teclado físico.')
    await page.route('**/api/comedor/**', async (route) => route.abort())
    await page.goto('/pruebas-ui/comedor?estado=inscripto')

    const disparador = page.getByRole('button', { name: 'Cancelar mi inscripción' })
    await disparador.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('todo el texto visible está en español', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?estado=inscripto')

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
    await expect(page.getByRole('heading', { name: 'Comedor', level: 1 })).toBeVisible()
  })
})

test.describe('consulta administrativa de inscriptos', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('presenta tabla en escritorio y tarjetas legibles en móvil', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?vista=director')

    await expect(page.getByRole('heading', { name: 'Comedor', level: 1 })).toBeVisible()

    if (esMovil(page)) {
      // A 375 px la tabla se reemplaza por tarjetas: se conserva el contenido y
      // no aparece desplazamiento horizontal. El texto se busca dentro de la
      // lista visible, porque la tabla oculta conserva el mismo contenido en el
      // DOM y una búsqueda global resolvería a dos elementos.
      await expect(page.getByRole('table')).toBeHidden()
      const tarjetas = page.getByRole('listitem').filter({ hasText: 'Estudiante, Beto' })
      await expect(tarjetas.first()).toBeVisible()
      await expect(tarjetas.first()).toContainText('LEG-BANCO-0002')
    } else {
      const tabla = page.getByRole('table', { name: /inscriptos al comedor/i })
      await expect(tabla).toBeVisible()
      await expect(
        tabla.getByRole('columnheader', { name: 'Legajo' })
      ).toBeVisible()
      await expect(tabla.getByRole('rowheader', { name: 'Estudiante, Beto' })).toBeVisible()
      await expect(tabla.getByRole('cell', { name: 'LEG-BANCO-0002' })).toBeVisible()
    }

    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'consulta-administrativa')
  })

  test('no ofrece ningún control de escritura ni de eliminación', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?vista=director')

    await expect(
      page.getByRole('button', { name: /inscribir|cancelar|eliminar|borrar/i })
    ).toHaveCount(0)
    await expect(page.getByText('Esta consulta es de solo lectura')).toBeVisible()
  })

  test('filtra por estado y busca por apellido o legajo', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?vista=director')

    const filtros = page.getByRole('group', {
      name: 'Filtrar inscripciones por estado',
    })
    await expect(page.getByText('Se muestran 2 de 3 registros.')).toBeVisible()

    await filtros.getByRole('button', { name: 'Bajas', exact: true }).click()
    await expect(page.getByText('Se muestran 1 de 3 registros.')).toBeVisible()

    await filtros.getByRole('button', { name: 'Todas', exact: true }).click()
    await expect(page.getByText('Se muestran 3 de 3 registros.')).toBeVisible()

    await page.getByLabel('Buscar por apellido o legajo').fill('LEG-BANCO-0003')
    await expect(page.getByText('Se muestran 1 de 3 registros.')).toBeVisible()
    await capturar(page, 'consulta-administrativa-filtro')
  })

  test('el listado vacío se explica y no se confunde con un error', async ({ page }) => {
    await page.goto('/pruebas-ui/comedor?vista=director&vacio=1')

    await expect(page.getByText('No hay inscripciones que coincidan')).toBeVisible()
    await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)
    await capturar(page, 'consulta-administrativa-vacia')
  })
})
