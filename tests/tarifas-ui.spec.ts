import { expect, test, type Locator, type Page } from '@playwright/test'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirContraste, exigirSinTextoVisible } from './_contraste'
import { exigirSinControlesAnidados } from './_semantica'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Interfaz de administración de tarifas con datos deterministas y API
 * interceptada, sin base (EPT-103).
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales: las
 * aserciones se adaptan al ancho. Demuestra PRESENTACIÓN y comportamiento del
 * formulario: estados (carga, error, vacío, vigente, futura, finalizada, sin
 * tarifa vigente), formato monetario es-AR, errores por campo, conflictos,
 * falla de red, doble envío, teclado y foco, contraste y ausencia de
 * desplazamiento horizontal. NO demuestra persistencia ni autorización: eso lo
 * prueban `tarifas-auth.spec.ts`, `tarifas_administracion_rls.sql` y
 * `tarifas_administracion_concurrencia.mjs`.
 */

const ESCRITORIO = { width: 1280, height: 900 }
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

const DEPORTE_B = 'e1030000-0000-4000-8000-000000000002'
const VERSION_INICIAL_VIGENTE = 'e1030000-0000-4000-8000-0000000000a2'

/** En WebKit táctil el navegador no mueve el foco al pulsar ni recorre con Tab: es de la plataforma. */
function hayTeclado(page: Page) {
  return page.context().browser()?.browserType().name() !== 'webkit'
}

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

test.beforeEach(async ({ page }) => {
  if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
})

async function capturar(page: Page, nombre: string, opciones: { paginaCompleta?: boolean } = {}) {
  if (!CAPTURAR) return
  const perfil = esMovil(page) ? 'movil' : 'escritorio'
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-103', `fixture-${perfil}-${nombre}.png`),
    opciones
  )
}

const aplicacion = (page: Page) => page.getByRole('main')

const sinScrollHorizontal = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

async function alturaMinima(control: Locator, minimo: number, nombre: string) {
  const caja = await control.boundingBox()
  expect(caja, `${nombre}: sin caja visible`).not.toBeNull()
  expect(caja!.height, `${nombre}: alto táctil`).toBeGreaterThanOrEqual(minimo - 0.5)
}

function json(estado: number, cuerpo: unknown) {
  return { status: estado, contentType: 'application/json', body: JSON.stringify(cuerpo) }
}

function tarjeta(page: Page, nombre: string) {
  return aplicacion(page).getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: nombre, exact: true }) })
}

async function abrir(page: Page, estado = 'datos') {
  await page.goto(`/pruebas-ui/tarifas?estado=${estado}`)
}

// ================================================================
// Estados de la pantalla
// ================================================================
test.describe('estados de la pantalla', () => {
  test('carga: esqueleto sin texto visible y anuncio para lectores de pantalla', async ({ page }) => {
    await abrir(page, 'carga')
    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    await expect(page.getByText('Cargando las tarifas…')).toBeAttached()
    await exigirSinTextoVisible(page, 'esqueleto de tarifas', 'main')
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'carga')
  })

  test('error de lectura: alerta con reintento y sin detalle técnico', async ({ page }) => {
    await abrir(page, 'error')
    const alerta = aplicacion(page).getByRole('alert')
    await expect(alerta).toContainText('No pudimos cargar las tarifas')
    await expect(alerta).toContainText('No pudimos completar la operación. Volvé a intentarlo en unos minutos.')
    await expect(alerta.getByRole('link', { name: 'Reintentar' })).toHaveAttribute('href', '/dashboard/tarifas')
    await exigirPantallaSinDetalleTecnico(page, 'error de lectura de tarifas')
    await capturar(page, 'error-lectura')
  })

  test('vacío: ninguna referencia tiene tarifa, se puede cargar la primera y no se ofrece cambiar precio', async ({ page }) => {
    await abrir(page, 'vacio')
    await expect(aplicacion(page).getByRole('heading', { level: 1, name: 'Tarifas' })).toBeVisible()
    await expect(aplicacion(page).getByText('Todavía no se cargó ninguna tarifa.')).toHaveCount(9)
    await expect(aplicacion(page).getByRole('button', { name: /^Cambiar precio/ })).toHaveCount(0)
    await expect(aplicacion(page).getByRole('button', { name: /^Nueva tarifa de/ })).toHaveCount(9)
    await expect(aplicacion(page).locator('details')).toHaveCount(0)
    await capturar(page, 'vacio')
  })

  test('con datos: las cuatro secciones y el estado de cada referencia al día fijo 15/06/2030', async ({ page }) => {
    await abrir(page)
    for (const titulo of ['Cuota por nivel educativo', 'Deportes', 'Transporte', 'Comedor']) {
      await expect(aplicacion(page).getByRole('heading', { level: 2, name: titulo })).toBeVisible()
    }

    // Vigente sin fin, con miles y decimales exactos.
    const inicial = tarjeta(page, 'INICIAL')
    await expect(inicial).toContainText('Vigente hoy')
    await expect(inicial).toContainText('$ 1.234.567,89')
    await expect(inicial).toContainText('Desde el 01/06/2030, sin fecha de fin')

    // Cero: se muestra, no se oculta ni se confunde con «sin tarifa».
    const primario = tarjeta(page, 'PRIMARIO')
    await expect(primario).toContainText('$ 0,00')
    await expect(primario).toContainText('Del 01/01/2030 al 30/06/2030')

    // Referencia sin tarifas, otra con una versión ya terminada y una inactiva.
    await expect(tarjeta(page, 'Deporte ficticio B')).toContainText('Sin tarifa vigente hoy')
    await expect(tarjeta(page, 'Deporte ficticio B')).toContainText('Todavía no se cargó ninguna tarifa.')
    const c = tarjeta(page, 'Deporte ficticio C')
    await expect(c).toContainText('Todas las versiones cargadas ya terminaron.')
    await expect(c).toContainText('Inactivo')

    // Solo una versión futura.
    const norte = tarjeta(page, 'Recorrido ficticio Norte')
    await expect(norte).toContainText('Sin tarifa vigente hoy')
    await expect(norte).toContainText('Próxima: $ 12.000,00. Desde el 01/09/2030, sin fecha de fin.')

    await exigirPantallaSinDetalleTecnico(page, 'tarifas con datos')
    await exigirSinControlesAnidados(page, 'tarifas con datos', 'main')
    await capturar(page, 'con-datos')
  })

  test('el historial conserva todas las versiones y las marca como vigente, futura o finalizada', async ({ page }) => {
    await abrir(page)
    const primario = tarjeta(page, 'PRIMARIO')
    await primario.getByText(/^Historial \(2 versiones\)/).click()
    const filas = primario.locator('details li')
    await expect(filas).toHaveCount(2)
    await expect(filas.nth(0)).toContainText('$ 45.000,50')
    await expect(filas.nth(0)).toContainText('Futura')
    await expect(filas.nth(1)).toContainText('$ 0,00')
    await expect(filas.nth(1)).toContainText('Vigente')

    const inicial = tarjeta(page, 'INICIAL')
    await inicial.getByText(/^Historial \(2 versiones\)/).click()
    await expect(inicial.locator('details li').nth(1)).toContainText('Finalizada')
    await capturar(page, 'historial')
  })

  test('sin desplazamiento horizontal y con contraste AA', async ({ page }) => {
    await abrir(page)
    expect(await sinScrollHorizontal(page)).toBe(true)
    // Los historiales cerrados no se pintan (`content-visibility`): se abren todos para medirlos.
    const resumenes = aplicacion(page).locator('details > summary')
    for (let i = 0, n = await resumenes.count(); i < n; i += 1) await resumenes.nth(i).click()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await exigirContraste(page, 'listado de tarifas', {
      raiz: 'main',
      esenciales: ['h1', 'h2', 'h3'],
      minimoMedidos: 40,
    })
  })

  test('todo el texto visible está en español', async ({ page }) => {
    await abrir(page)
    const texto = (await aplicacion(page).innerText()).toLowerCase()
    for (const palabra of ['loading', 'submit', 'delete', 'undefined', 'null', 'nan', 'save', 'edit ']) {
      expect(texto, palabra).not.toContain(palabra)
    }
  })

  test('en móvil los controles tienen alto táctil de 44 px', async ({ page }) => {
    test.skip(!esMovil(page), 'Solo aplica a los perfiles móviles.')
    await abrir(page)
    const inicial = tarjeta(page, 'INICIAL')
    await alturaMinima(inicial.getByRole('button', { name: 'Cambiar precio de INICIAL' }), 44, 'Cambiar precio')
    await alturaMinima(inicial.getByRole('button', { name: 'Nueva tarifa de INICIAL' }), 44, 'Nueva tarifa')
    await alturaMinima(inicial.getByText(/^Historial/), 44, 'resumen del historial')
    await inicial.getByText(/^Historial/).click()
    await alturaMinima(inicial.getByRole('button', { name: /^Editar la tarifa de INICIAL/ }).first(), 44, 'Editar')
  })
})

// ================================================================
// Formularios
// ================================================================
test.describe('alta de una tarifa', () => {
  test('valida por campo antes de enviar, revisa y guarda con lo que devuelve el servidor', async ({ page }) => {
    let cuerpo: Record<string, unknown> | null = null
    let llamadas = 0
    await page.route('**/api/tarifas', async (ruta) => {
      llamadas += 1
      cuerpo = ruta.request().postDataJSON()
      await ruta.fulfill(
        json(201, {
          ok: true,
          tarifa: { id: 'e1030000-0000-4000-8000-0000000000f1', importe: '1500.50', desde: '2030-08-01', hasta: null },
        })
      )
    })
    await abrir(page)

    const abrirBoton = tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' })
    await abrirBoton.click()
    const dialogo = page.getByRole('dialog', { name: 'Nueva tarifa · Deporte ficticio B' })
    await expect(dialogo).toBeVisible()
    if (hayTeclado(page)) await expect(dialogo.getByLabel('Importe (ARS)')).toBeFocused()
    await capturar(page, 'dialogo-alta', { paginaCompleta: false })

    // Vacío.
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveAccessibleDescription('Ingresá el importe de la tarifa.')
    await expect(dialogo.getByLabel('Vigente desde')).toHaveAccessibleDescription('Ingresá la fecha de inicio.')
    if (hayTeclado(page)) await expect(dialogo.getByLabel('Importe (ARS)')).toBeFocused()

    // Precisión extra: no se redondea, se rechaza.
    await dialogo.getByLabel('Importe (ARS)').fill('10.005')
    await dialogo.getByLabel('Vigente desde').fill('2030-08-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveAccessibleDescription('El importe admite como máximo dos decimales.')
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveAttribute('aria-invalid', 'true')

    // Otros formatos rechazados, cada uno con su mensaje.
    for (const [entrada, mensaje] of [
      ['-5', 'El importe no puede ser negativo.'],
      ['NaN', 'formato no soportado'],
      ['Infinity', 'formato no soportado'],
      ['1e3', 'formato no soportado'],
      ['1.234,50', 'No uses separadores de miles'],
      ['10000000000', 'supera el máximo permitido'],
    ] as const) {
      await dialogo.getByLabel('Importe (ARS)').fill(entrada)
      await dialogo.getByRole('button', { name: 'Revisar' }).click()
      await expect(dialogo.getByLabel('Importe (ARS)')).toHaveAccessibleDescription(new RegExp(mensaje, 'u'))
    }

    // Fechas.
    await dialogo.getByLabel('Importe (ARS)').fill('1500,5')
    await dialogo.getByLabel('Vigente hasta (opcional)').fill('2030-07-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo.getByLabel('Vigente hasta (opcional)')).toHaveAccessibleDescription(
      'La fecha de fin no puede ser anterior a la de inicio.'
    )
    expect(llamadas, 'ninguna validación local llegó al servidor').toBe(0)

    // Revisión.
    await dialogo.getByLabel('Vigente hasta (opcional)').fill('')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo.getByText('Revisá los datos antes de guardar:')).toBeVisible()
    // El cambio de paso se anuncia: el foco va al encabezado de la revisión, no a <body>.
    if (hayTeclado(page)) await expect(dialogo.getByText('Revisá los datos antes de guardar:')).toBeFocused()
    await expect(dialogo).toContainText('$ 1.500,50')
    await expect(dialogo).toContainText('Desde el 01/08/2030, sin fecha de fin')
    await capturar(page, 'dialogo-revision', { paginaCompleta: false })
    expect(llamadas).toBe(0)

    // «Volver a editar» conserva lo escrito.
    await dialogo.getByRole('button', { name: 'Volver a editar' }).click()
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveValue('1500,50')
    if (hayTeclado(page)) await expect(dialogo.getByLabel('Importe (ARS)')).toBeFocused()
    await dialogo.getByRole('button', { name: 'Revisar' }).click()

    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo).toHaveCount(0)
    expect(llamadas).toBe(1)
    // El cuerpo lleva el importe como texto exacto y ningún dato de identidad.
    expect(cuerpo).toEqual({
      concepto: 'DEPORTE',
      referencia_id: DEPORTE_B,
      importe: '1500.50',
      desde: '2030-08-01',
      hasta: '',
    })
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste la tarifa de Deporte ficticio B: $ 1.500,50.' })
    ).toBeVisible()
    if (hayTeclado(page)) await expect(abrirBoton).toBeFocused()
    await capturar(page, 'alta-guardada')
  })

  test('Escape cierra sin enviar nada, devuelve el foco y el teclado no se escapa del diálogo', async ({ page }) => {
    test.skip(!hayTeclado(page), 'WebKit táctil no recorre con Tab.')
    let llamadas = 0
    await page.route('**/api/tarifas**', async (ruta) => {
      llamadas += 1
      await ruta.abort()
    })
    await abrir(page)
    const abrirBoton = tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' })
    await abrirBoton.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog')
    await expect(dialogo.getByLabel('Importe (ARS)')).toBeFocused()
    for (let paso = 0; paso < 8; paso += 1) {
      await page.keyboard.press('Tab')
      expect(await dialogo.evaluate((nodo) => nodo.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(abrirBoton).toBeFocused()
    expect(llamadas).toBe(0)
  })

  test('un rechazo de la base por superposición vuelve al formulario y señala la fecha de inicio', async ({ page }) => {
    await page.route('**/api/tarifas', async (ruta) => {
      await ruta.fulfill(
        json(409, {
          error:
            'Esas fechas se superponen con otra versión de la tarifa para la misma referencia. Ajustá el inicio o el fin: cada día debe tener una sola tarifa.',
          campo: 'desde',
          codigo: 'SUPERPOSICION',
        })
      )
    })
    await abrir(page)
    await tarjeta(page, 'Deporte ficticio A').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio A' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('100')
    await dialogo.getByLabel('Vigente desde').fill('2030-06-15')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByLabel('Vigente desde')).toHaveAccessibleDescription(/se superponen con otra versión/u)
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveValue('100,00')
    // No hay mensaje de éxito: un rechazo no se parece a un guardado.
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste' })).toHaveCount(0)
    await exigirPantallaSinDetalleTecnico(page, 'rechazo por superposición')
    await capturar(page, 'superposicion', { paginaCompleta: false })
  })

  test('una falla de red no parece un guardado y permite reintentar explícitamente', async ({ page }) => {
    let llamadas = 0
    let responder = false
    await page.route('**/api/tarifas', async (ruta) => {
      llamadas += 1
      if (!responder) return ruta.abort('failed')
      return ruta.fulfill(
        json(201, {
          ok: true,
          tarifa: { id: 'e1030000-0000-4000-8000-0000000000f2', importe: '100.00', desde: '2030-08-01', hasta: null },
        })
      )
    })
    await abrir(page)
    await tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('100')
    await dialogo.getByLabel('Vigente desde').fill('2030-08-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()

    const alerta = dialogo.getByRole('alert')
    await expect(alerta).toContainText('No pudimos comunicarnos con el servidor')
    await expect(alerta).toContainText('revisá el historial de la tarifa antes de reintentar')
    // Tras el fallo el foco sigue en un control del diálogo, no en <body>.
    if (hayTeclado(page)) await expect(dialogo.getByRole('button', { name: 'Reintentar guardado' })).toBeFocused()
    await expect(dialogo).toBeVisible()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste' })).toHaveCount(0)
    await capturar(page, 'falla-de-red', { paginaCompleta: false })

    responder = true
    await dialogo.getByRole('button', { name: 'Reintentar guardado' }).click()
    await expect(dialogo).toHaveCount(0)
    expect(llamadas).toBe(2)
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste la tarifa' })).toBeVisible()
  })

  test('el doble envío llega una sola vez al servidor', async ({ page }) => {
    let llamadas = 0
    await page.route('**/api/tarifas', async (ruta) => {
      llamadas += 1
      await new Promise((resolver) => setTimeout(resolver, 900))
      await ruta.fulfill(
        json(201, {
          ok: true,
          tarifa: { id: 'e1030000-0000-4000-8000-0000000000f3', importe: '100.00', desde: '2030-08-01', hasta: null },
        })
      )
    })
    await abrir(page)
    await tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('100')
    await dialogo.getByLabel('Vigente desde').fill('2030-08-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    const confirmar = dialogo.getByRole('button', { name: 'Confirmar y guardar' })
    await confirmar.click()
    const guardando = dialogo.getByRole('button', { name: 'Guardando…' })
    await expect(guardando).toBeDisabled()
    await expect(guardando).toHaveAttribute('aria-busy', 'true')
    await guardando.click({ force: true }).catch(() => undefined)
    await page.keyboard.press('Enter')
    await expect(dialogo).toHaveCount(0)
    expect(llamadas).toBe(1)
  })
})

test.describe('cambio de precio', () => {
  test('anticipa el cierre de la versión anterior en D-1 y envía la misma forma que el alta', async ({ page }) => {
    let cuerpo: Record<string, unknown> | null = null
    await page.route('**/api/tarifas/cambio', async (ruta) => {
      cuerpo = ruta.request().postDataJSON()
      await ruta.fulfill(
        json(200, {
          ok: true,
          anterior: { id: VERSION_INICIAL_VIGENTE, importe: '1234567.89', desde: '2030-06-01', hasta: '2030-06-30' },
          nueva: { id: 'e1030000-0000-4000-8000-0000000000f4', importe: '1300000.00', desde: '2030-07-01', hasta: null },
        })
      )
    })
    await abrir(page)
    await tarjeta(page, 'INICIAL').getByRole('button', { name: 'Cambiar precio de INICIAL' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Cambiar precio · INICIAL' })
    await dialogo.getByLabel('Nuevo importe (ARS)').fill('1300000')
    await dialogo.getByLabel('Rige desde').fill('2030-07-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo).toContainText('$ 1.234.567,89')
    await expect(dialogo).toContainText('pasará a terminar el 30/06/2030')
    await capturar(page, 'cambio-de-precio', { paginaCompleta: false })

    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo).toHaveCount(0)
    expect(cuerpo).toEqual({
      concepto: 'CUOTA',
      referencia_id: '1',
      importe: '1300000.00',
      desde: '2030-07-01',
      hasta: '',
    })
    await expect(
      aplicacion(page).getByRole('status').filter({
        hasText: 'Registraste el nuevo precio de INICIAL: $ 1.300.000,00 desde el 01/07/2030, sin fecha de fin. La tarifa anterior quedó vigente hasta el 30/06/2030.',
      })
    ).toBeVisible()
  })

  test('sin una versión vigente el día anterior, avisa que solo se agrega la nueva', async ({ page }) => {
    await abrir(page)
    await tarjeta(page, 'Recorrido ficticio Norte').getByRole('button', { name: 'Cambiar precio de Recorrido ficticio Norte' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Nuevo importe (ARS)').fill('13000')
    await dialogo.getByLabel('Rige desde').fill('2030-01-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo).toContainText('No hay una versión vigente el día anterior')
  })
})

test.describe('edición de una versión', () => {
  test('envía los valores previos que vio la persona y no acepta concepto ni referencia', async ({ page }) => {
    let cuerpo: Record<string, unknown> | null = null
    let url = ''
    await page.route('**/api/tarifas/*', async (ruta) => {
      cuerpo = ruta.request().postDataJSON()
      url = ruta.request().url()
      await ruta.fulfill(
        json(200, {
          ok: true,
          tarifa: { id: VERSION_INICIAL_VIGENTE, importe: '1240000.00', desde: '2030-06-01', hasta: null },
        })
      )
    })
    await abrir(page)
    const inicial = tarjeta(page, 'INICIAL')
    await inicial.getByText(/^Historial/).click()
    await inicial.getByRole('button', { name: /^Editar la tarifa de INICIAL: Desde el 01\/06\/2030/ }).click()
    const dialogo = page.getByRole('dialog', { name: 'Editar tarifa · INICIAL' })
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveValue('1234567,89')
    await expect(dialogo.getByLabel('Vigente desde')).toHaveValue('2030-06-01')
    await expect(dialogo).toContainText('Las facturas ya emitidas conservan el importe con el que se emitieron')
    await dialogo.getByLabel('Importe (ARS)').fill('1240000')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo).toContainText('Antes: $ 1.234.567,89')
    await capturar(page, 'edicion-revision', { paginaCompleta: false })
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo).toHaveCount(0)
    expect(url.endsWith(`/api/tarifas/${VERSION_INICIAL_VIGENTE}`)).toBe(true)
    expect(cuerpo).toEqual({
      importe: '1240000.00',
      desde: '2030-06-01',
      hasta: '',
      previo: { importe: '1234567.89', desde: '2030-06-01', hasta: null },
    })
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Actualizaste la tarifa de INICIAL: $ 1.240.000,00.' })
    ).toBeVisible()
  })

  test('un conflicto de edición no se presenta como guardado y ofrece recargar', async ({ page }) => {
    await page.route('**/api/tarifas/*', async (ruta) => {
      await ruta.fulfill(
        json(409, {
          error:
            'Otra persona modificó esta tarifa mientras la editabas. No se guardó nada: recargá los datos y revisá los valores actuales antes de volver a intentarlo.',
          codigo: 'CONFLICTO_EDICION',
        })
      )
    })
    await abrir(page)
    const inicial = tarjeta(page, 'INICIAL')
    await inicial.getByText(/^Historial/).click()
    await inicial.getByRole('button', { name: /^Editar la tarifa de INICIAL: Desde el 01\/06\/2030/ }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('1')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()

    await expect(dialogo.getByRole('alert')).toContainText('Otra persona modificó esta tarifa')
    await expect(dialogo.getByRole('button', { name: 'Confirmar y guardar' })).toHaveCount(0)
    if (hayTeclado(page)) await expect(dialogo.getByRole('button', { name: 'Recargar datos' })).toBeFocused()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Actualizaste' })).toHaveCount(0)
    await exigirPantallaSinDetalleTecnico(page, 'conflicto de edición')
    await capturar(page, 'conflicto-de-edicion', { paginaCompleta: false })

    await dialogo.getByRole('button', { name: 'Recargar datos' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Volvimos a leer las tarifas.' })
    ).toBeVisible()
  })
})

test.describe('errores del servidor', () => {
  test('un error por campo devuelto por el servidor se muestra en ese campo', async ({ page }) => {
    await page.route('**/api/tarifas', async (ruta) => {
      await ruta.fulfill(json(400, { error: 'El importe admite como máximo dos decimales.', campo: 'importe' }))
    })
    await abrir(page)
    await tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('100')
    await dialogo.getByLabel('Vigente desde').fill('2030-08-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveAccessibleDescription('El importe admite como máximo dos decimales.')
  })

  test('un 500 o una sesión vencida se informan con el mensaje del servidor y sin éxito', async ({ page }) => {
    await page.route('**/api/tarifas', async (ruta) => {
      await ruta.fulfill(json(401, { error: 'Necesitás iniciar sesión para continuar.' }))
    })
    await abrir(page)
    await tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('100')
    await dialogo.getByLabel('Vigente desde').fill('2030-08-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('Necesitás iniciar sesión para continuar.')
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste' })).toHaveCount(0)
  })
})

test.describe('móvil', () => {
  test('el formulario es usable a 375 px, sin desplazamiento horizontal', async ({ page }) => {
    test.skip(!esMovil(page), 'Solo aplica a los perfiles móviles.')
    await abrir(page)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'listado')
    await tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await alturaMinima(dialogo.getByRole('button', { name: 'Revisar' }), 44, 'Revisar')
    await alturaMinima(dialogo.getByRole('button', { name: 'Cancelar' }), 44, 'Cancelar')
    await capturar(page, 'dialogo', { paginaCompleta: false })
  })
})

test.describe('guardado al pie de la página y respuestas inesperadas', () => {
  async function llenarYRevisar(page: Page, boton: Locator) {
    await boton.scrollIntoViewIfNeeded()
    await boton.click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('100')
    await dialogo.getByLabel('Vigente desde').fill('2030-08-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    return dialogo
  }

  test('el aviso de éxito queda a la vista aunque se haya guardado al pie de la página', async ({ page }) => {
    await page.route('**/api/tarifas', async (ruta) => {
      await ruta.fulfill(
        json(201, {
          ok: true,
          tarifa: { id: 'e1030000-0000-4000-8000-0000000000f5', importe: '100.00', desde: '2030-08-01', hasta: null },
        })
      )
    })
    await abrir(page)
    const dialogo = await llenarYRevisar(
      page,
      tarjeta(page, 'Comedor ficticio').getByRole('button', { name: 'Nueva tarifa de Comedor ficticio' })
    )
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    const aviso = aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste la tarifa de Comedor ficticio' })
    await expect(aviso).toBeVisible()
    await expect(aviso).toBeInViewport()
  })

  test('un 200 sin la forma esperada se informa como «no sabemos si se guardó»', async ({ page }) => {
    await page.route('**/api/tarifas', async (ruta) => {
      await ruta.fulfill(json(200, {}))
    })
    await abrir(page)
    const dialogo = await llenarYRevisar(
      page,
      tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' })
    )
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('no sabemos si el cambio se guardó')
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste' })).toHaveCount(0)
  })

  test('mientras guarda, Escape no cierra el diálogo', async ({ page }) => {
    test.skip(!hayTeclado(page), 'WebKit táctil no envía Escape como en escritorio.')
    await page.route('**/api/tarifas', async (ruta) => {
      await new Promise((resolver) => setTimeout(resolver, 700))
      await ruta.fulfill(
        json(201, {
          ok: true,
          tarifa: { id: 'e1030000-0000-4000-8000-0000000000f6', importe: '100.00', desde: '2030-08-01', hasta: null },
        })
      )
    })
    await abrir(page)
    const dialogo = await llenarYRevisar(
      page,
      tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' })
    )
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByRole('button', { name: 'Guardando…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toHaveCount(0)
  })

  test('una tarifa que ya no existe pide recargar', async ({ page }) => {
    await page.route('**/api/tarifas/*', async (ruta) => {
      await ruta.fulfill(
        json(404, { error: 'La tarifa ya no existe. Recargá la pantalla.', codigo: 'TARIFA_INEXISTENTE' })
      )
    })
    await abrir(page)
    const inicial = tarjeta(page, 'INICIAL')
    await inicial.getByText(/^Historial/).click()
    await inicial.getByRole('button', { name: /^Editar la tarifa de INICIAL: Desde el 01\/06\/2030/ }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('1')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('La tarifa ya no existe')
    await expect(dialogo.getByRole('button', { name: 'Recargar datos' })).toBeVisible()
  })

  test('una superposición sin campo (cambio o edición) no ofrece reintentar lo mismo: lleva a volver a editar', async ({ page }) => {
    await page.route('**/api/tarifas/cambio', async (ruta) => {
      await ruta.fulfill(
        json(409, {
          error:
            'Esas fechas se superponen con otra versión de la tarifa para la misma referencia. Ajustá el inicio o el fin: cada día debe tener una sola tarifa.',
          codigo: 'SUPERPOSICION',
        })
      )
    })
    await abrir(page)
    await tarjeta(page, 'INICIAL').getByRole('button', { name: 'Cambiar precio de INICIAL' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Nuevo importe (ARS)').fill('1')
    await dialogo.getByLabel('Rige desde').fill('2030-07-01')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('se superponen con otra versión')
    await expect(dialogo.getByRole('button', { name: 'Reintentar guardado' })).toHaveCount(0)
    if (hayTeclado(page)) await expect(dialogo.getByRole('button', { name: 'Volver a editar' })).toBeFocused()
  })

  test('el diálogo, con un error visible, también cumple el contraste AA', async ({ page }) => {
    await abrir(page)
    await tarjeta(page, 'Deporte ficticio B').getByRole('button', { name: 'Nueva tarifa de Deporte ficticio B' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('10.005')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await exigirContraste(page, 'diálogo de tarifa con error', {
      raiz: '[role="dialog"]',
      esenciales: ['[role="dialog"] h2'],
      minimoMedidos: 6,
    })
  })
})
