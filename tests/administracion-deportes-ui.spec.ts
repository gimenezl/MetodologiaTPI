import { expect, test, type Locator, type Page } from '@playwright/test'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirContraste } from './_contraste'
import { exigirSinControlesAnidados } from './_semantica'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Administración de deportes y grupos con datos deterministas y API interceptada,
 * sin base (EPT-61). PRUEBA DE PRESENTACIÓN.
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales. Demuestra estados,
 * accesibilidad, idioma, teclado, foco y comportamiento responsive del catálogo y
 * de las acciones sobre grupos. NO demuestra persistencia ni autorización: eso lo
 * prueban `administracion-deportes-auth.spec.ts`,
 * `deportes_administracion_rls.sql` y `deportes_administracion_concurrencia.mjs`.
 * Las capturas se nombran `fixture-*` para no confundirlas con las reales.
 */

const ESCRITORIO = { width: 1280, height: 900 }
const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const ADMIN = '/pruebas-ui/deportes?vista=director&estado=administracion'

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
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-61', `fixture-${perfil}-${nombre}.png`),
    { paginaCompleta: !nombre.startsWith('dialogo') }
  )
}

function aplicacion(page: Page) {
  return page.getByRole('main')
}

async function sinScrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )
}

function tarjetaDeporte(page: Page, nombre: string) {
  return page
    .getByRole('region', { name: 'Catálogo de deportes' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: nombre, exact: true }) })
}

function tarjetaGrupo(page: Page, deporte: string, grupo: string) {
  return page
    .getByRole('region', { name: 'Grupos deportivos' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: deporte, exact: true, level: 3 }) })
    .filter({ has: page.getByText(grupo, { exact: true }) })
}

/** Respuesta JSON simulada de la API. */
function json(estado: number, cuerpo: unknown) {
  return { status: estado, contentType: 'application/json', body: JSON.stringify(cuerpo) }
}

async function alturaMinima(control: Locator, minimo: number, nombre: string) {
  const caja = await control.boundingBox()
  expect(caja, `${nombre} no tiene caja`).not.toBeNull()
  expect(caja!.height, `${nombre} mide menos de ${minimo}px de alto`).toBeGreaterThanOrEqual(minimo - 0.5)
}

test.beforeEach(async ({ page }) => {
  if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
})

test.describe('catálogo de deportes (fixture)', () => {
  test('lista los deportes con estado y grupos activos, sin controles de borrado', async ({ page }) => {
    await page.goto(ADMIN)
    await expect(page.getByRole('heading', { name: 'Catálogo de deportes', level: 2 })).toBeVisible()

    const futbol = tarjetaDeporte(page, 'Fútbol')
    await expect(futbol).toContainText('Activo')
    await expect(futbol).toContainText('2 grupos activos')
    await expect(tarjetaDeporte(page, 'Hockey')).toContainText('Inactivo')
    await expect(tarjetaDeporte(page, 'Hockey')).toContainText('Todavía no tiene grupos.')
    await expect(tarjetaDeporte(page, 'Vóley')).toContainText('0 grupos activos')

    await expect(page.getByRole('button', { name: /Eliminar|Borrar/ })).toHaveCount(0)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await exigirPantallaSinDetalleTecnico(page, 'catálogo fixture')
    await capturar(page, 'catalogo-y-grupos')
  })

  test('inactivar un deporte con grupos activos se explica y no abre el diálogo', async ({ page }) => {
    await page.goto(ADMIN)
    const boton = tarjetaDeporte(page, 'Fútbol').getByRole('button', { name: 'Inactivar el deporte Fútbol' })
    const motivo =
      'No se puede inactivar el deporte porque tiene 2 grupos activos. Inactivá esos grupos primero.'

    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await expect(boton).toHaveAccessibleDescription(motivo)
    await expect(tarjetaDeporte(page, 'Fútbol').getByText(motivo)).toBeVisible()
    if (hayTeclado(page)) {
      await boton.focus()
      await expect(boton).toBeFocused()
    }
    // Playwright trata aria-disabled como «no habilitado»: se fuerza el clic real.
    await boton.click({ force: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Sin grupos activos sí se puede, y un deporte inactivo se puede reactivar.
    await expect(
      tarjetaDeporte(page, 'Vóley').getByRole('button', { name: 'Inactivar el deporte Vóley' })
    ).not.toHaveAttribute('aria-disabled', 'true')
    await expect(
      tarjetaDeporte(page, 'Hockey').getByRole('button', { name: 'Reactivar el deporte Hockey' })
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('el alta valida en español, envía solo el nombre y confirma con un aviso', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/deportes', async (ruta) => {
      cuerpo = ruta.request().postDataJSON()
      await ruta.fulfill(json(201, { ok: true, deporte: { id: 'x', nombre: 'Hándbol', activo: true } }))
    })
    await page.goto(ADMIN)
    await page.getByRole('button', { name: 'Nuevo deporte' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Nuevo deporte' })
    await expect(dialogo).toBeVisible()
    if (hayTeclado(page)) await expect(dialogo.getByLabel('Nombre del deporte')).toBeFocused()
    await expect(dialogo).toContainText('elegís el profesor responsable')
    await capturar(page, 'dialogo-nuevo-deporte')

    await dialogo.getByRole('button', { name: 'Crear deporte' }).click()
    await expect(dialogo.getByLabel('Nombre del deporte')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialogo.getByLabel('Nombre del deporte')).toHaveAccessibleDescription(
      'El nombre del deporte es requerido'
    )
    expect(cuerpo).toBeUndefined()

    await dialogo.getByLabel('Nombre del deporte').fill('  Hándbol  ')
    await dialogo.getByRole('button', { name: 'Crear deporte' }).click()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Creaste el deporte «Hándbol».' })).toBeVisible()
    await expect(dialogo).toHaveCount(0)
    expect(cuerpo).toEqual({ nombre: 'Hándbol' })
  })

  test('un nombre repetido lo informa el servidor en el campo, sin detalle técnico', async ({ page }) => {
    await page.route('**/api/deportes', (ruta) =>
      ruta.fulfill(json(409, { error: 'Ya existe un deporte con ese nombre.', campo: 'nombre' }))
    )
    await page.goto(ADMIN)
    await page.getByRole('button', { name: 'Nuevo deporte' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Nuevo deporte' })
    await dialogo.getByLabel('Nombre del deporte').fill('Fútbol')
    await dialogo.getByRole('button', { name: 'Crear deporte' }).click()
    await expect(dialogo.getByLabel('Nombre del deporte')).toHaveAccessibleDescription(
      'Ya existe un deporte con ese nombre.'
    )
    await exigirPantallaSinDetalleTecnico(page, 'nombre repetido')
    await capturar(page, 'dialogo-nombre-repetido')
  })

  test('renombrar un deporte con grupos explica la regla y no ofrece otro nombre', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/deportes/*', async (ruta) => {
      cuerpo = ruta.request().postDataJSON()
      await ruta.fulfill(json(200, { ok: true, deporte: { id: 'x', nombre: 'FÚTBOL', activo: true } }))
    })
    await page.goto(ADMIN)
    await tarjetaDeporte(page, 'Fútbol').getByRole('button', { name: 'Renombrar el deporte Fútbol' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Renombrar Fútbol' })
    await expect(dialogo).toContainText('solo podés cambiar las mayúsculas y minúsculas')
    await capturar(page, 'dialogo-renombrar-con-grupos')

    const campo = dialogo.getByLabel('Nombre del deporte')
    await campo.fill('Football')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()
    await expect(campo).toHaveAccessibleDescription(/solo podés cambiar las mayúsculas y minúsculas/)
    expect(cuerpo).toBeUndefined()

    await campo.fill('Fútbol')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()
    await expect(campo).toHaveAccessibleDescription('El nombre es el mismo que el actual. Modificalo para guardar.')

    await campo.fill('FÚTBOL')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Renombraste el deporte «Fútbol» a «FÚTBOL».' })
    ).toBeVisible()
    expect(cuerpo).toEqual({ accion: 'renombrar', nombre: 'FÚTBOL' })
  })

  test('un deporte sin grupos se puede renombrar libremente', async ({ page }) => {
    await page.goto(ADMIN)
    await tarjetaDeporte(page, 'Hockey').getByRole('button', { name: 'Renombrar el deporte Hockey' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Renombrar Hockey' })
    await expect(dialogo).toContainText('todavía no tiene grupos, así que podés cambiarle el nombre libremente')
    await expect(dialogo).not.toContainText('solo podés cambiar las mayúsculas')
  })

  test('la inactivación pide confirmación con foco inicial seguro y Escape devuelve el foco', async ({
    page,
  }) => {
    let llamadas = 0
    await page.route('**/api/deportes/*', async (ruta) => {
      llamadas += 1
      await ruta.fulfill(json(200, { ok: true, deporte: { id: 'x', nombre: 'Vóley', activo: false } }))
    })
    await page.goto(ADMIN)
    const disparador = tarjetaDeporte(page, 'Vóley').getByRole('button', { name: 'Inactivar el deporte Vóley' })
    await disparador.click()

    const dialogo = page.getByRole('dialog', { name: 'Inactivar el deporte Vóley' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText('se conservan')
    await capturar(page, 'dialogo-inactivar-deporte')
    if (hayTeclado(page)) {
      await expect(dialogo.getByRole('button', { name: 'Volver sin cambios' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialogo.getByRole('button', { name: 'Sí, inactivar el deporte' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialogo.getByRole('button', { name: 'Cerrar diálogo' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialogo.getByRole('button', { name: 'Volver sin cambios' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialogo).toHaveCount(0)
      await expect(disparador).toBeFocused()
    } else {
      await dialogo.getByRole('button', { name: 'Volver sin cambios' }).click()
    }
    expect(llamadas).toBe(0)

    await disparador.click()
    await page.getByRole('button', { name: 'Sí, inactivar el deporte' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Inactivaste el deporte «Vóley».' })
    ).toBeVisible()
    expect(llamadas).toBe(1)
  })

  test('un rechazo por una carrera nombra los grupos y queda en el diálogo', async ({ page }) => {
    await page.route('**/api/deportes/*', (ruta) =>
      ruta.fulfill(
        json(409, {
          error:
            'No se puede inactivar el deporte porque tiene 1 grupo activo: «Primario turno mañana» (Primario). Inactivá esos grupos primero.',
          campo: 'activo',
        })
      )
    )
    await page.goto(ADMIN)
    await tarjetaDeporte(page, 'Vóley').getByRole('button', { name: 'Inactivar el deporte Vóley' }).click()
    await page.getByRole('button', { name: 'Sí, inactivar el deporte' }).click()
    const alerta = page.getByRole('dialog').getByRole('alert')
    await expect(alerta).toContainText('«Primario turno mañana» (Primario)')
    await exigirPantallaSinDetalleTecnico(page, 'rechazo por carrera')
    await capturar(page, 'dialogo-rechazo-carrera')
  })

  test('reactivar un deporte pide confirmación explícita', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/deportes/*', async (ruta) => {
      cuerpo = ruta.request().postDataJSON()
      await ruta.fulfill(json(200, { ok: true, deporte: { id: 'x', nombre: 'Hockey', activo: true } }))
    })
    await page.goto(ADMIN)
    await tarjetaDeporte(page, 'Hockey').getByRole('button', { name: 'Reactivar el deporte Hockey' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Reactivar el deporte Hockey' })
    await expect(dialogo).toContainText('vuelve a poder recibir grupos nuevos')
    await dialogo.getByRole('button', { name: 'Sí, reactivar el deporte' }).click()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Reactivaste el deporte «Hockey».' })).toBeVisible()
    expect(cuerpo).toEqual({ accion: 'cambiar_estado', activo: true })
  })

  test('sin deportes en el catálogo muestra un estado vacío que no parece un error', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?vista=director&estado=vacio')
    await expect(page.getByText('Todavía no hay deportes en el catálogo')).toBeVisible()
    await expect(page.getByText('Todavía no hay grupos deportivos')).toBeVisible()
    await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)
    await capturar(page, 'vacio')
  })

  test('si no se cargó la administración, se conserva la consulta y se avisa', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?vista=director&estado=sin-administracion')
    await expect(aplicacion(page).getByRole('alert')).toContainText(
      'No pudimos cargar los datos para administrar el catálogo y los grupos.'
    )
    await expect(page.getByRole('region', { name: 'Catálogo de deportes' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Editar|Inactivar|Reactivar) el grupo/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Grupos deportivos' })).toBeVisible()
    await capturar(page, 'sin-administracion')
  })
})

test.describe('grupos: edición y cambio de estado (fixture)', () => {
  test('inactivar un grupo con inscripciones activas se explica en el control', async ({ page }) => {
    await page.goto(ADMIN)
    const tarjeta = tarjetaGrupo(page, 'Fútbol', 'Primario turno mañana')
    const boton = tarjeta.getByRole('button', { name: 'Inactivar el grupo Primario turno mañana de Fútbol' })
    const motivo =
      'No se puede inactivar el grupo porque tiene 12 alumnos con inscripción activa. Cada alumno debe cancelar la suya antes; Dirección no cancela por el alumno.'
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await expect(boton).toHaveAccessibleDescription(motivo)
    await expect(tarjeta.getByText(motivo)).toBeVisible()
    await boton.click({ force: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('reactivar explica el impedimento: deporte inactivo, profesor inactivo o nada', async ({ page }) => {
    await page.goto(ADMIN)
    const porDeporte = tarjetaGrupo(page, 'Básquet', 'Primario invierno')
    const botonDeporte = porDeporte.getByRole('button', { name: /^Reactivar el grupo/ })
    await expect(botonDeporte).toHaveAttribute('aria-disabled', 'true')
    await expect(botonDeporte).toHaveAccessibleDescription(
      'El deporte de este grupo está inactivo. Reactivá el deporte antes de reactivar el grupo.'
    )

    const porProfesor = tarjetaGrupo(page, 'Natación', 'Primario noche')
    await expect(porProfesor.getByRole('button', { name: /^Reactivar el grupo/ })).toHaveAccessibleDescription(
      /El profesor responsable está inactivo\. Editá el grupo para asignar otro profesor/
    )

    const libre = tarjetaGrupo(page, 'Vóley', 'Primario turno mañana')
    await expect(libre.getByRole('button', { name: /^Reactivar el grupo/ })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  test('el diálogo de edición muestra deporte y nivel de solo lectura y explica el mínimo del cupo', async ({
    page,
  }) => {
    await page.goto(ADMIN)
    await tarjetaGrupo(page, 'Fútbol', 'Primario turno mañana')
      .getByRole('button', { name: 'Editar el grupo Primario turno mañana de Fútbol' })
      .click()
    const dialogo = page.getByRole('dialog', { name: 'Editar Fútbol · Primario turno mañana' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText('El deporte y el nivel no se pueden cambiar')
    await expect(dialogo.getByText('Ocupación actual')).toBeVisible()
    await expect(dialogo.getByLabel('Deporte')).toHaveCount(0)
    await expect(dialogo.getByLabel('Nivel educativo')).toHaveCount(0)
    if (hayTeclado(page)) await expect(dialogo.getByLabel('Nombre del grupo')).toBeFocused()

    const cupo = dialogo.getByLabel('Cupo (plazas)')
    await expect(cupo).toHaveAttribute('min', '12')
    await expect(cupo).toHaveAccessibleDescription(/No puede ser menor que las inscripciones activas \(12\)/)

    // Profesores: solo activos (y el actual). El inactivo no se ofrece.
    const opciones = await dialogo.getByLabel('Profesor responsable').locator('option').allTextContents()
    expect(opciones).toContain('Docente, Darío')
    expect(opciones).toContain('Profesora, Ana')
    expect(opciones.join('|')).not.toContain('Inactivo, Pablo')
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'dialogo-editar-grupo')

    await cupo.fill('5')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(cupo).toHaveAccessibleDescription(
      'El cupo no puede ser menor que la cantidad de inscripciones activas: el grupo tiene 12 alumnos inscriptos.'
    )
    await cupo.fill('0')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(cupo).toHaveAccessibleDescription('El cupo debe ser un número entero entre 1 y 100')
    await dialogo.getByLabel('Nombre del grupo').fill('   ')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(dialogo.getByLabel('Nombre del grupo')).toHaveAccessibleDescription(
      'El nombre del grupo es requerido'
    )
    await capturar(page, 'dialogo-editar-validacion')
  })

  test('guardar sin cambios avisa y guardar con cambios envía solo nombre, cupo y profesor', async ({ page }) => {
    const cuerpos: unknown[] = []
    await page.route('**/api/deportes/grupos/*', async (ruta) => {
      cuerpos.push(ruta.request().postDataJSON())
      await ruta.fulfill(json(200, { ok: true, grupo: { id: 'x' } }))
    })
    await page.goto(ADMIN)
    await tarjetaGrupo(page, 'Atletismo', 'Primario')
      .getByRole('button', { name: 'Editar el grupo Primario de Atletismo' })
      .click()
    const dialogo = page.getByRole('dialog', { name: 'Editar Atletismo · Primario' })

    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('No hiciste ningún cambio en el grupo.')
    expect(cuerpos).toHaveLength(0)

    await dialogo.getByLabel('Nombre del grupo').fill('Primario mañana')
    await dialogo.getByLabel('Cupo (plazas)').fill('30')
    await dialogo.getByLabel('Profesor responsable').selectOption({ label: 'Profesora, Ana' })
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste los cambios del grupo «Primario mañana».' })
    ).toBeVisible()
    expect(cuerpos).toEqual([
      {
        accion: 'editar',
        nombre: 'Primario mañana',
        cupo: 30,
        profesor_id: 'cccccccc-3333-4333-8333-333333333333',
      },
    ])
  })

  test('el rechazo del servidor por cupo o profesor aparece junto al campo', async ({ page }) => {
    await page.route('**/api/deportes/grupos/*', (ruta) =>
      ruta.fulfill(
        json(409, {
          error:
            'El cupo no puede ser menor que la cantidad de inscripciones activas: el grupo tiene 3 alumnos inscriptos.',
          campo: 'cupo',
        })
      )
    )
    await page.goto(ADMIN)
    await tarjetaGrupo(page, 'Atletismo', 'Primario').getByRole('button', { name: /^Editar el grupo/ }).click()
    const dialogo = page.getByRole('dialog', { name: 'Editar Atletismo · Primario' })
    await dialogo.getByLabel('Cupo (plazas)').fill('10')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(dialogo.getByLabel('Cupo (plazas)')).toHaveAccessibleDescription(/el grupo tiene 3 alumnos inscriptos/)
    await exigirPantallaSinDetalleTecnico(page, 'rechazo por cupo')
  })

  test('inactivar y reactivar un grupo confirman y envían solo el estado', async ({ page }) => {
    const cuerpos: unknown[] = []
    await page.route('**/api/deportes/grupos/*', async (ruta) => {
      cuerpos.push(ruta.request().postDataJSON())
      await ruta.fulfill(json(200, { ok: true, grupo: { id: 'x' } }))
    })
    await page.goto(ADMIN)

    await tarjetaGrupo(page, 'Vóley', 'Primario turno mañana')
      .getByRole('button', { name: /^Reactivar el grupo/ })
      .click()
    const dialogo = page.getByRole('dialog', { name: 'Reactivar el grupo Primario turno mañana' })
    await expect(dialogo).toContainText('siempre que su deporte, su nivel y su profesor sigan activos')
    await capturar(page, 'dialogo-reactivar-grupo')
    await dialogo.getByRole('button', { name: 'Sí, reactivar el grupo' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Reactivaste el grupo «Primario turno mañana».' })
    ).toBeVisible()
    expect(cuerpos).toEqual([{ accion: 'cambiar_estado', activo: true }])
  })

  test('sin sesión el aviso ofrece iniciar sesión y no se pierde al releer', async ({ page }) => {
    await page.route('**/api/deportes/grupos/*', (ruta) =>
      ruta.fulfill(json(401, { error: 'Necesitás iniciar sesión para continuar.' }))
    )
    await page.goto(ADMIN)
    await tarjetaGrupo(page, 'Vóley', 'Primario turno mañana')
      .getByRole('button', { name: /^Reactivar el grupo/ })
      .click()
    await page.getByRole('button', { name: 'Sí, reactivar el grupo' }).click()
    const alerta = page.getByRole('dialog').getByRole('alert')
    await expect(alerta).toContainText('Tu sesión venció. Iniciá sesión nuevamente para continuar.')
    await expect(alerta.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible()
    // Pasado un rato el aviso sigue: no hubo relectura que lo borre.
    await page.waitForTimeout(600)
    await expect(alerta).toBeVisible()
    await capturar(page, 'dialogo-sesion-vencida')
  })

  test('un doble clic envía una sola petición y el botón anuncia el progreso', async ({ page }) => {
    let llamadas = 0
    await page.route('**/api/deportes/grupos/*', async (ruta) => {
      llamadas += 1
      await new Promise((resolver) => setTimeout(resolver, 500))
      await ruta.fulfill(json(200, { ok: true, grupo: { id: 'x' } }))
    })
    await page.goto(ADMIN)
    await tarjetaGrupo(page, 'Vóley', 'Primario turno mañana')
      .getByRole('button', { name: /^Reactivar el grupo/ })
      .click()
    const confirmar = page.getByRole('button', { name: 'Sí, reactivar el grupo' })
    await confirmar.dblclick()
    await expect(page.getByRole('button', { name: 'Reactivando…' })).toBeDisabled()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Reactivaste el grupo' })).toBeVisible()
    expect(llamadas).toBe(1)
  })

  test('un fallo de red se informa en español y no rompe la pantalla', async ({ page }) => {
    await page.route('**/api/deportes/grupos/*', (ruta) => ruta.abort('failed'))
    await page.goto(ADMIN)
    await tarjetaGrupo(page, 'Vóley', 'Primario turno mañana')
      .getByRole('button', { name: /^Reactivar el grupo/ })
      .click()
    await page.getByRole('button', { name: 'Sí, reactivar el grupo' }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'No pudimos comunicarnos con el servidor.'
    )
    await exigirPantallaSinDetalleTecnico(page, 'fallo de red')
  })
})

test.describe('accesibilidad, idioma y responsive de la administración (fixture)', () => {
  test('cumple contraste AA y no anida controles', async ({ page }) => {
    await page.goto(ADMIN)
    await exigirContraste(page, 'administración de deportes', {
      raiz: 'main',
      esenciales: ['h1', '#catalogo-titulo', '#grupos-titulo'],
      minimoMedidos: 40,
    })
    await exigirSinControlesAnidados(page, 'administración de deportes', 'main')
  })

  test('los diálogos de administración cumplen contraste AA', async ({ page }) => {
    await page.goto(ADMIN)
    await tarjetaGrupo(page, 'Fútbol', 'Primario turno mañana').getByRole('button', { name: /^Editar el grupo/ }).click()
    await exigirContraste(page, 'diálogo de edición', {
      raiz: '[role="dialog"]',
      esenciales: ['[role="dialog"] h2', '[role="dialog"] dl'],
      minimoMedidos: 8,
    })
    await page.keyboard.press('Escape')
    await tarjetaDeporte(page, 'Vóley').getByRole('button', { name: /^Inactivar el deporte/ }).click()
    await exigirContraste(page, 'diálogo de estado', {
      raiz: '[role="dialog"]',
      esenciales: ['[role="dialog"] h2'],
      minimoMedidos: 4,
    })
  })

  test('todo el texto visible está en español y sin detalle técnico', async ({ page }) => {
    await page.goto(ADMIN)
    await exigirPantallaSinDetalleTecnico(page, 'administración')
    const texto = (await aplicacion(page).innerText()).toLowerCase()
    for (const palabra of ['loading', 'submit', 'delete', 'edit ', 'undefined', 'null', 'inactive', 'active ']) {
      expect(texto, `la pantalla no debe mostrar "${palabra}"`).not.toContain(palabra)
    }
  })

  test('no hay desplazamiento horizontal y los controles tienen tamaño táctil en móvil', async ({ page }) => {
    await page.goto(ADMIN)
    expect(await sinScrollHorizontal(page)).toBe(true)

    if (esMovil(page)) {
      const controles = [
        page.getByRole('button', { name: 'Nuevo deporte' }),
        tarjetaDeporte(page, 'Vóley').getByRole('button', { name: /^Renombrar/ }),
        tarjetaDeporte(page, 'Vóley').getByRole('button', { name: /^Inactivar/ }),
        tarjetaGrupo(page, 'Fútbol', 'Primario turno mañana').getByRole('button', { name: /^Editar el grupo/ }),
        tarjetaGrupo(page, 'Vóley', 'Primario turno mañana').getByRole('button', { name: /^Reactivar el grupo/ }),
      ]
      for (const control of controles) await alturaMinima(control, 44, 'control de administración')

      await controles[3].click()
      const dialogo = page.getByRole('dialog')
      for (const campo of ['Nombre del grupo', 'Cupo (plazas)', 'Profesor responsable']) {
        await alturaMinima(dialogo.getByLabel(campo), 44, campo)
      }
      await alturaMinima(dialogo.getByRole('button', { name: 'Guardar cambios' }), 44, 'Guardar cambios')
      expect(await sinScrollHorizontal(page)).toBe(true)
      await capturar(page, 'dialogo-editar-movil')
    }
    await capturar(page, 'administracion-completa')
  })
})

test.describe('vista del alumno sin administración (fixture)', () => {
  test('el alumno no ve ningún control de administración', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=disponible')
    await expect(page.getByRole('heading', { name: 'Deportes', level: 1 })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Catálogo de deportes' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /Nuevo deporte|Renombrar|Inactivar|Reactivar|Editar/ })
    ).toHaveCount(0)
  })
})
