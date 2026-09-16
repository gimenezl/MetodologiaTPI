import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

/**
 * Interfaz real con datos deterministas y API interceptada, sin base remota.
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales: las aserciones
 * se adaptan al ancho, de modo que un mismo archivo demuestra las dos
 * presentaciones.
 */

const ESCRITORIO = { width: 1280, height: 900 }
const REGION_ESTADO = 'Estado de la administración de materias'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  const perfil = esMovil(page) ? 'movil' : 'escritorio'
  await page.screenshot({
    path: path.join('docs/evidence/EPT-56', `fixture-${perfil}-${nombre}.png`),
    fullPage: true,
  })
}

async function haySrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
}

test.describe('interfaz administrativa de materias', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('lista el catálogo con estado, relaciones y sin controles de eliminación', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/materias')

    const catalogo = page.getByRole('list', { name: 'Catálogo de materias' })
    await expect(catalogo).toBeVisible()
    await expect(catalogo.locator('> li')).toHaveCount(3)
    await expect(catalogo.locator('> li').nth(0)).toContainText('Historia')
    await expect(catalogo.locator('> li').nth(0)).toContainText('Inactiva')
    await expect(catalogo.locator('> li').nth(1)).toContainText('Lengua y Literatura')
    await expect(catalogo.locator('> li').nth(2)).toContainText('Matemática')
    await expect(catalogo.locator('> li').nth(2)).toContainText('Activa')
    await expect(catalogo.locator('> li').nth(2)).toContainText(
      '2 curso(s) relacionado(s) · 1 vigente(s)'
    )

    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)
    expect(await haySrollHorizontal(page)).toBe(false)

    await capturar(page, 'listado')
  })

  test('filtra por estado sin perder el catálogo', async ({ page }) => {
    await page.goto('/pruebas-ui/materias')

    const filtros = page.getByRole('group', { name: 'Filtrar materias por estado' })
    await filtros.getByRole('button', { name: 'Inactivas', exact: true }).click()
    const catalogo = page.getByRole('list', { name: 'Catálogo de materias' })
    await expect(catalogo.locator('> li')).toHaveCount(1)
    await expect(catalogo).toContainText('Historia')

    await filtros.getByRole('button', { name: 'Activas', exact: true }).click()
    await expect(catalogo.locator('> li')).toHaveCount(2)
    await expect(catalogo).not.toContainText('Historia')

    await filtros.getByRole('button', { name: 'Todas', exact: true }).click()
    await expect(catalogo.locator('> li')).toHaveCount(3)
    await capturar(page, 'filtro-estado')
  })

  test('abre el alta con foco inicial y valida antes de llamar a la API', async ({
    page,
  }) => {
    let huboLlamada = false
    await page.route('**/api/materias', async (route) => {
      huboLlamada = true
      await route.abort()
    })
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Nueva materia' }).click()
    const nombre = page.getByLabel('Nombre de la materia').first()
    await expect(nombre).toBeFocused()
    await capturar(page, 'formulario-alta')

    await nombre.fill('   ')
    await page.getByRole('button', { name: 'Crear materia' }).click()
    await expect(page.getByText('El nombre de la materia es requerido')).toBeVisible()
    expect(huboLlamada).toBe(false)
    await capturar(page, 'validacion')
  })

  test('recorta el nombre antes de enviarlo y confirma el alta', async ({ page }) => {
    let cuerpo: unknown
    let liberar!: () => void
    const pendiente = new Promise<void>((resolve) => {
      liberar = resolve
    })
    await page.route('**/api/materias', async (route) => {
      cuerpo = route.request().postDataJSON()
      await pendiente
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Nueva materia' }).click()
    await page.getByLabel('Nombre de la materia').first().fill('  Biología  ')
    await page.getByRole('button', { name: 'Crear materia' }).click()

    await expect(page.getByRole('button', { name: 'Cargando...' })).toBeDisabled()
    await capturar(page, 'enviando')
    liberar()

    await expect(
      page.getByRole('status').filter({ hasText: 'Materia Biología creada correctamente.' })
    ).toBeVisible()
    expect(cuerpo).toEqual({ nombre: 'Biología' })
    await capturar(page, 'alta-exitosa')
  })

  test('muestra el duplicado como error y permite corregir sin recargar', async ({
    page,
  }) => {
    let intentos = 0
    await page.route('**/api/materias', async (route) => {
      intentos += 1
      await route.fulfill({
        status: intentos === 1 ? 409 : 201,
        contentType: 'application/json',
        body: JSON.stringify(
          intentos === 1
            ? { error: 'Ya existe una materia con ese nombre.', campo: 'nombre' }
            : { ok: true }
        ),
      })
    })
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Nueva materia' }).click()
    const nombre = page.getByLabel('Nombre de la materia').first()
    await nombre.fill('matemática')
    await page.getByRole('button', { name: 'Crear materia' }).click()

    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Ya existe una materia con ese nombre.' })
        .first()
    ).toBeVisible()
    await capturar(page, 'error-duplicado')

    await nombre.fill('Química')
    await page.getByRole('button', { name: 'Crear materia' }).click()
    await expect(page.getByRole('status')).toContainText(
      'Materia Química creada correctamente.'
    )
    expect(intentos).toBe(2)
  })

  test('renombra desde un diálogo accesible', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/materias/1', async (route) => {
      cuerpo = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Renombrar la materia Matemática' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Renombrar Matemática' })
    await expect(dialogo).toBeVisible()
    await expect(page.locator('#renombrar-materia-nombre')).toBeFocused()
    await capturar(page, 'edicion')

    await page.locator('#renombrar-materia-nombre').fill('Matemática I')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()

    expect(cuerpo).toEqual({ accion: 'renombrar', nombre: 'Matemática I' })
    await expect(page.getByRole('status')).toContainText(
      'Materia renombrada como Matemática I.'
    )
  })

  test('confirma la inactivación y la reactivación sin confirmación nativa', async ({
    page,
  }) => {
    const cuerpos: unknown[] = []
    await page.route('**/api/materias/*', async (route) => {
      cuerpos.push(route.request().postDataJSON())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Inactivar la materia Matemática' }).click()
    const inactivar = page.getByRole('dialog', { name: 'Inactivar Matemática' })
    await expect(inactivar).toContainText(
      'Los cursos y los profesores que ya tiene se conservan como historial.'
    )
    const confirmar = inactivar.getByRole('button', { name: 'Confirmar inactivación' })
    await expect(confirmar).toBeFocused()
    await capturar(page, 'inactivacion')
    await confirmar.click()
    await expect(page.getByRole('status')).toContainText('Materia Matemática inactivada.')

    await page.getByRole('button', { name: 'Reactivar la materia Historia' }).click()
    const reactivar = page.getByRole('dialog', { name: 'Reactivar Historia' })
    await capturar(page, 'reactivacion')
    await reactivar.getByRole('button', { name: 'Confirmar reactivación' }).click()
    await expect(page.getByRole('status')).toContainText('Materia Historia reactivada.')

    expect(cuerpos).toEqual([
      { accion: 'cambiar_estado', activo: false },
      { accion: 'cambiar_estado', activo: true },
    ])
  })

  test('muestra los cursos relacionados con su profesor y su estado', async ({ page }) => {
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Ver los cursos de la materia Matemática' }).click()
    const cursos = page.getByRole('list', { name: 'Cursos de la materia Matemática' })
    await expect(cursos.locator('> li')).toHaveCount(2)
    await expect(cursos.locator('> li').nth(0)).toContainText('1er Grado A')
    await expect(cursos.locator('> li').nth(0)).toContainText('Darío Docente')
    await expect(cursos.locator('> li').nth(0)).toContainText('Vigente')
    await expect(cursos.locator('> li').nth(1)).toContainText('Curso inactivo')
    await expect(cursos.locator('> li').nth(1)).toContainText('Sin profesor responsable')
    await expect(cursos.locator('> li').nth(1)).toContainText('Histórica')
    expect(await haySrollHorizontal(page)).toBe(false)

    await capturar(page, 'asignaciones')
  })

  test('asigna una materia a un curso activo con profesor opcional', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/asignaciones-materias', async (route) => {
      cuerpo = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/materias')

    await page
      .getByRole('button', { name: 'Asignar la materia Matemática a un curso' })
      .click()
    const dialogo = page.getByRole('dialog', { name: 'Asignar Matemática a un curso' })
    await expect(dialogo).toBeVisible()
    await expect(page.locator('#asignar-curso')).toBeFocused()
    await capturar(page, 'asignar-curso')

    await dialogo.getByRole('button', { name: 'Asignar materia' }).click()
    await expect(dialogo.getByText('Seleccioná un curso activo')).toBeVisible()
    expect(cuerpo).toBeUndefined()

    await page.locator('#asignar-curso').selectOption('aaaaaaaa-3333-4333-8333-333333333333')
    await page.locator('#asignar-profesor').selectOption('bbbbbbbb-2222-4222-8222-222222222222')
    await dialogo.getByRole('button', { name: 'Asignar materia' }).click()

    expect(cuerpo).toEqual({
      materia_id: 1,
      curso_id: 'aaaaaaaa-3333-4333-8333-333333333333',
      profesor_id: 'bbbbbbbb-2222-4222-8222-222222222222',
    })
    await expect(page.getByRole('status')).toContainText(
      'Materia Matemática asignada a Sala de 5 A.'
    )
  })

  test('cambia y quita el profesor responsable de una asignación', async ({ page }) => {
    const cuerpos: unknown[] = []
    await page.route('**/api/asignaciones-materias/*', async (route) => {
      cuerpos.push(route.request().postDataJSON())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Ver los cursos de la materia Matemática' }).click()
    await page
      .getByRole('button', {
        name: 'Cambiar el profesor responsable de Matemática en 1er Grado A',
      })
      .click()

    const dialogo = page.getByRole('dialog', {
      name: 'Profesor responsable de Matemática en 1er Grado A',
    })
    await expect(dialogo).toBeVisible()
    await expect(page.locator('#profesor-responsable')).toBeFocused()
    await capturar(page, 'profesor-responsable')

    await page.locator('#profesor-responsable').selectOption('')
    await dialogo.getByRole('button', { name: 'Guardar profesor' }).click()
    await expect(page.getByRole('status')).toContainText('Sin profesor responsable')

    expect(cuerpos).toEqual([{ accion: 'cambiar_profesor', profesor_id: null }])
  })

  test('inactiva una asignación conservándola como historial', async ({ page }) => {
    let cuerpo: unknown
    await page.route('**/api/asignaciones-materias/*', async (route) => {
      cuerpo = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/pruebas-ui/materias')

    await page.getByRole('button', { name: 'Ver los cursos de la materia Matemática' }).click()
    await page
      .getByRole('button', {
        name: 'Inactivar la asignación de Matemática en 1er Grado A',
      })
      .click()

    const dialogo = page.getByRole('dialog', {
      name: 'Inactivar Matemática en 1er Grado A',
    })
    await expect(dialogo).toContainText('No se elimina ningún dato.')
    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()

    expect(cuerpo).toEqual({ accion: 'cambiar_estado', activo: false })
    await expect(page.getByRole('status')).toContainText(
      'Asignación de Matemática en 1er Grado A inactivada.'
    )
  })

  test('retiene el foco, cierra con Escape y lo devuelve al disparador', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/materias')
    const disparador = page.getByRole('button', {
      name: 'Inactivar la materia Matemática',
    })
    // Se abre con el teclado a propósito: WebKit no enfoca un botón al hacer
    // clic, y lo que esta prueba demuestra es el recorrido de teclado completo.
    await disparador.focus()
    await page.keyboard.press('Enter')

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await capturar(page, 'dialogo-foco')

    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]'))
        )
      ).toBe(true)
    }
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Shift+Tab')
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]'))
        )
      ).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
    await expect(disparador).toBeFocused()
  })

  test('muestra los estados de carga, vacío, sin cursos, error y éxito', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/materias?estado=carga')
    await expect(page.getByText('Cargando las materias…')).toBeAttached()
    await capturar(page, 'carga')

    await page.goto('/pruebas-ui/materias?vacio=1')
    await expect(page.getByText('No hay materias registradas')).toBeVisible()
    await capturar(page, 'vacio')

    await page.goto('/pruebas-ui/materias?sin-cursos=1')
    await page
      .getByRole('button', { name: 'Asignar la materia Matemática a un curso' })
      .click()
    await expect(
      page.getByText('No hay cursos activos disponibles para asignar.')
    ).toBeVisible()
    await capturar(page, 'sin-cursos-activos')
    await page.keyboard.press('Escape')

    await page.goto('/pruebas-ui/materias?estado=error')
    await expect(page.getByLabel(REGION_ESTADO).getByRole('alert')).toContainText(
      'No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.'
    )
    await capturar(page, 'error-de-servidor')

    await page.goto('/pruebas-ui/materias?estado=exito')
    await expect(page.getByRole('status')).toContainText(
      'Materia actualizada correctamente.'
    )
    await capturar(page, 'exito')
  })

  test('nombra en español controles, regiones y contenido visible', async ({ page }) => {
    await page.goto('/pruebas-ui/materias')
    await expect(page.getByLabel(REGION_ESTADO)).toHaveAttribute('aria-live', 'polite')
    await page.getByRole('button', { name: 'Nueva materia' }).click()
    await page.getByRole('button', { name: 'Ver los cursos de la materia Matemática' }).click()

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
      'subject',
      'course',
      'teacher',
      'status',
      'actions',
      'inactive',
    ]) {
      expect(new RegExp(`\\b${palabra}\\b`, 'i').test(texto)).toBe(false)
    }

    // La extensibilidad del catálogo es una decisión interna: no se promociona.
    for (const frase of [
      'catálogo ampliable',
      'preparado para futuros',
      'modelo extensible',
      'CURRICULAR',
      'actividad',
    ]) {
      expect(texto.toLowerCase()).not.toContain(frase.toLowerCase())
    }
  })
})
