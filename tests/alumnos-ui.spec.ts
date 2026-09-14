import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { capturarSinHerramientas } from './_captura'

/**
 * Interfaz del legajo académico contra el banco visual determinista.
 *
 * Corre en los tres perfiles configurados: `chromium` (escritorio),
 * `pixel-5-chromium` e `iphone-13-webkit`. Las aserciones que dependen del
 * ancho se adaptan al viewport, de modo que un mismo archivo demuestra la tabla
 * de escritorio y las tarjetas móviles.
 *
 * Estas pruebas demuestran comportamiento de presentación con datos sintéticos.
 * La persistencia real se demuestra en `alumnos-auth.spec.ts`.
 */

const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const REGION_ESTADO = 'Estado de la administración de alumnos'
const ANCHO_TABLA = 640

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  const perfil = test.info().project.name
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-9', `fixture-${perfil}-${nombre}.png`)
  )
}

/** Acota los campos al formulario de alta: varias etiquetas se repiten en los diálogos. */
function formularioAlta(page: Page) {
  return page.locator('#formulario-nuevo-alumno')
}

function esEscritorio(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= ANCHO_TABLA
}

/**
 * Contenedor del listado que corresponde al viewport.
 *
 * La tabla y las tarjetas conviven en el DOM: una queda oculta por CSS. Las
 * consultas por rol ya descartan lo que está oculto, pero `getByText` no, así
 * que las aserciones de texto se acotan al contenedor visible.
 */
function listado(page: Page) {
  return esEscritorio(page)
    ? page.getByRole('table', { name: 'Tabla de alumnos' })
    : page.getByRole('list', { name: 'Alumnos por apellido' })
}

async function hayDesplazamientoHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
}

test.describe('interfaz administrativa de alumnos', () => {
  test('presenta el legajo con su estado, curso y nivel derivado', async ({ page }) => {
    await page.goto('/pruebas-ui/alumnos')

    if (esEscritorio(page)) {
      const tabla = page.getByRole('table', { name: 'Tabla de alumnos' })
      await expect(tabla).toBeVisible()
      await expect(page.getByRole('list', { name: 'Alumnos por apellido' })).toBeHidden()

      const fila = tabla.getByRole('row').filter({ hasText: 'Arrieta, Camila' })
      await expect(fila).toContainText('48213907')
      await expect(fila).toContainText('LEG-2027-018')
      await expect(fila).toContainText('1er Grado A')
      await expect(fila).toContainText('PRIMARIO')
      await expect(fila).toContainText('Activo')
    } else {
      await expect(page.getByRole('list', { name: 'Alumnos por apellido' })).toBeVisible()
      await expect(page.getByRole('table', { name: 'Tabla de alumnos' })).toBeHidden()
      const tarjeta = page.getByRole('listitem').filter({ hasText: 'Arrieta, Camila' })
      await expect(tarjeta).toContainText('DNI 48213907')
      await expect(tarjeta).toContainText('LEG-2027-018')
      await expect(tarjeta).toContainText('1er Grado A')
      await expect(tarjeta).toContainText('PRIMARIO')
      await expect(tarjeta).toContainText('Activo')
    }

    expect(await hayDesplazamientoHorizontal(page)).toBe(false)
    await capturar(page, 'listado')
  })

  test('conserva el curso histórico de un estudiante cuyo curso ya está inactivo', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/alumnos')

    // Ferreyra cursa "Sala de 4 C", que ya no está entre los cursos activos.
    await expect(listado(page)).toContainText('Sala de 4 C')

    await page.getByRole('button', { name: 'Cambiar curso del alumno Ferreyra, Bautista' }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText('Actualmente cursa Sala de 4 C')

    // El selector solo ofrece cursos activos: "Sala de 4 C" no aparece.
    const opciones = await dialogo.getByLabel('Curso nuevo').locator('option').allInnerTexts()
    expect(opciones.some((texto) => texto.includes('Sala de 4'))).toBe(false)
    expect(opciones.some((texto) => texto.includes('1er Grado A'))).toBe(true)

    await capturar(page, 'cambio-de-curso')
    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
  })

  test('no ofrece ningún control de eliminación física', async ({ page }) => {
    await page.goto('/pruebas-ui/alumnos')
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)
  })

  test('exige elegir el estado y no llama a la API con datos inválidos', async ({
    page,
  }) => {
    let huboLlamada = false
    await page.route('**/api/alumnos', async (route) => {
      huboLlamada = true
      await route.abort()
    })
    await page.goto('/pruebas-ui/alumnos')

    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await expect(formularioAlta(page).getByLabel('Nombre')).toBeFocused()
    await capturar(page, 'formulario-vacio')

    await formularioAlta(page).getByLabel('Nombre').fill('Lucía')
    await formularioAlta(page).getByLabel('Apellido').fill('Maidana')
    await formularioAlta(page).getByLabel('DNI').fill('123')
    await page.getByRole('button', { name: 'Crear legajo' }).click()

    await expect(
      page.getByText('El DNI debe tener exactamente 7 u 8 dígitos, sin puntos ni letras')
    ).toBeVisible()
    await expect(
      page.getByText('Elegí explícitamente si el estudiante queda activo o inactivo')
    ).toBeVisible()
    expect(huboLlamada).toBe(false)
    await capturar(page, 'validacion')
  })

  test('un alta activa exige curso y legajo antes de tocar la red', async ({ page }) => {
    let huboLlamada = false
    await page.route('**/api/alumnos', async (route) => {
      huboLlamada = true
      await route.abort()
    })
    await page.goto('/pruebas-ui/alumnos')

    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await formularioAlta(page).getByLabel('Nombre').fill('Lucía')
    await formularioAlta(page).getByLabel('Apellido').fill('Maidana')
    await formularioAlta(page).getByLabel('DNI').fill('47881290')
    await formularioAlta(page).getByLabel('Estado académico').selectOption('ACTIVO')
    await capturar(page, 'formulario-activo')
    await page.getByRole('button', { name: 'Crear legajo' }).click()

    await expect(
      page.getByText('Un estudiante activo debe tener un número de legajo')
    ).toBeVisible()
    expect(huboLlamada).toBe(false)
  })

  test('un alta inactiva no ofrece matrícula y se envía sin curso', async ({ page }) => {
    let cuerpoEnviado: unknown = null
    await page.route('**/api/alumnos', async (route) => {
      cuerpoEnviado = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, alumno_id: 'a1111111-1111-4111-8111-111111111111' }),
      })
    })
    await page.goto('/pruebas-ui/alumnos')

    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await formularioAlta(page).getByLabel('Nombre').fill('Lucía')
    await formularioAlta(page).getByLabel('Apellido').fill('Maidana')
    await formularioAlta(page).getByLabel('DNI').fill('47881290')
    await formularioAlta(page).getByLabel('Estado académico').selectOption('INACTIVO')

    await expect(formularioAlta(page).getByLabel('Curso')).toBeDisabled()
    await expect(
      page.getByText('Un estudiante inactivo se registra sin matrícula', { exact: false })
    ).toBeVisible()
    await capturar(page, 'formulario-inactivo')

    await page.getByRole('button', { name: 'Crear legajo' }).click()
    await expect(page.getByRole('status')).toContainText(
      'Legajo de Maidana, Lucía creado como inactivo.'
    )
    expect(cuerpoEnviado).toMatchObject({ estado: 'INACTIVO' })
    expect((cuerpoEnviado as Record<string, unknown>).curso_id).toBeUndefined()
    await capturar(page, 'exito')
  })

  test('deshabilita el botón mientras el alta está en vuelo', async ({ page }) => {
    let liberar: () => void = () => {}
    const enVuelo = new Promise<void>((resolve) => {
      liberar = resolve
    })

    await page.route('**/api/alumnos', async (route) => {
      await enVuelo
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, alumno_id: 'a1111111-1111-4111-8111-111111111111' }),
      })
    })
    await page.goto('/pruebas-ui/alumnos')

    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await formularioAlta(page).getByLabel('Nombre').fill('Lucía')
    await formularioAlta(page).getByLabel('Apellido').fill('Maidana')
    await formularioAlta(page).getByLabel('DNI').fill('47881291')
    await formularioAlta(page).getByLabel('Estado académico').selectOption('INACTIVO')
    await page.getByRole('button', { name: 'Crear legajo' }).click()

    // Mientras la petición está en vuelo, el botón anuncia la espera y enviar
    // de nuevo es imposible.
    const enviando = page.getByRole('button', { name: 'Cargando...' })
    await expect(enviando).toBeVisible()
    await expect(enviando).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Crear legajo' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await capturar(page, 'envio-en-curso')

    liberar()
    await expect(page.getByRole('status')).toContainText('creado como inactivo.')
  })

  test('permite corregir un DNI duplicado y reintentar sin recargar', async ({ page }) => {
    let intentos = 0
    await page.route('**/api/alumnos', async (route) => {
      intentos += 1
      if (intentos === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Ya existe una persona registrada con ese DNI.',
            campo: 'dni',
          }),
        })
        return
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, alumno_id: 'a1111111-1111-4111-8111-111111111111' }),
      })
    })
    await page.goto('/pruebas-ui/alumnos')

    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await formularioAlta(page).getByLabel('Nombre').fill('Lucía')
    await formularioAlta(page).getByLabel('Apellido').fill('Maidana')
    await formularioAlta(page).getByLabel('DNI').fill('48213907')
    await formularioAlta(page).getByLabel('Estado académico').selectOption('INACTIVO')
    await page.getByRole('button', { name: 'Crear legajo' }).click()

    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Ya existe una persona registrada con ese DNI.' })
        .first()
    ).toBeVisible()
    await capturar(page, 'error-dni-duplicado')

    await formularioAlta(page).getByLabel('DNI').fill('47881290')
    await page.getByRole('button', { name: 'Crear legajo' }).click()
    await expect(page.getByRole('status')).toContainText('creado como inactivo.')
    expect(intentos).toBe(2)
  })

  test('informa un legajo duplicado sin exponer detalles internos', async ({ page }) => {
    await page.route('**/api/alumnos/*', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Ya existe un legajo con ese número.',
          campo: 'legajo_nro',
        }),
      })
    })
    await page.goto('/pruebas-ui/alumnos')

    await page
      .getByRole('button', { name: 'Corregir la identidad del alumno Arrieta, Camila' })
      .click()
    await page.getByLabel('Número de legajo').fill('LEG-2027-041')
    await page.getByRole('button', { name: 'Guardar identidad' }).click()

    await expect(
      page.getByRole('alert').filter({ hasText: 'Ya existe un legajo con ese número.' }).first()
    ).toBeVisible()
    await capturar(page, 'error-legajo-duplicado')
  })

  test('informa un curso inactivo elegido por otra vía', async ({ page }) => {
    await page.route('**/api/alumnos/*', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'El curso elegido está inactivo. Elegí un curso activo.',
          campo: 'curso_id',
        }),
      })
    })
    await page.goto('/pruebas-ui/alumnos')

    await page
      .getByRole('button', { name: 'Cambiar curso del alumno Arrieta, Camila' })
      .click()
    await page.getByLabel('Curso nuevo').selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Confirmar cambio de curso' }).click()

    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'El curso elegido está inactivo. Elegí un curso activo.' })
        .first()
    ).toBeVisible()
    await capturar(page, 'error-curso-inactivo')
  })

  test('confirma la inactivación explicando qué se conserva', async ({ page }) => {
    await page.route('**/api/alumnos/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, alumno_id: 'a1111111-1111-4111-8111-111111111111' }),
      })
    })
    await page.goto('/pruebas-ui/alumnos')

    await page.getByRole('button', { name: 'Inactivar al alumno Arrieta, Camila' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Inactivar a Arrieta, Camila' })
    await expect(dialogo).toContainText('No se elimina ningún dato')
    await capturar(page, 'inactivacion')

    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()
    await expect(page.getByRole('status')).toContainText(
      'Arrieta, Camila quedó inactivo. Se conservan legajo e historial.'
    )
  })

  test('la reactivación exige elegir un curso activo', async ({ page }) => {
    await page.route('**/api/alumnos/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, alumno_id: 'a3333333-3333-4333-8333-333333333333' }),
      })
    })
    await page.goto('/pruebas-ui/alumnos')

    await page.getByRole('button', { name: 'Reactivar al alumno Quiroga, Renata' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Reactivar a Quiroga, Renata' })
    const confirmar = dialogo.getByRole('button', { name: 'Confirmar reactivación' })

    await expect(confirmar).toBeDisabled()
    await capturar(page, 'reactivacion')

    await dialogo.getByLabel('Curso para la reactivación').selectOption({ index: 1 })
    await expect(confirmar).toBeEnabled()
    await confirmar.click()
    await expect(page.getByRole('status')).toContainText(
      'Quiroga, Renata volvió a estar activo con una matrícula nueva.'
    )
  })

  test('retiene el foco en el diálogo, cierra con Escape y lo devuelve', async ({
    page,
  }) => {
    await page.goto('/pruebas-ui/alumnos')
    const disparador = page.getByRole('button', {
      name: 'Inactivar al alumno Arrieta, Camila',
    })
    // Se abre con el teclado, que es el recorrido que esta prueba verifica.
    // Además WebKit no enfoca un `button` al hacer clic, de modo que abrirlo con
    // el ratón haría que la devolución del foco no tuviera un destino real.
    await disparador.focus()
    await page.keyboard.press('Enter')

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()

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

    expect(await hayDesplazamientoHorizontal(page)).toBe(false)

    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
    await expect(disparador).toBeFocused()
  })

  test('muestra los estados de carga, vacío, error y éxito', async ({ page }) => {
    await page.goto('/pruebas-ui/alumnos?estado=carga')
    await expect(page.getByText('Cargando los legajos académicos…')).toBeAttached()
    await capturar(page, 'carga')

    await page.goto('/pruebas-ui/alumnos?vacio=1')
    await expect(page.getByText('No hay alumnos registrados')).toBeVisible()
    await capturar(page, 'vacio')

    await page.goto('/pruebas-ui/alumnos?estado=error')
    await expect(page.getByLabel(REGION_ESTADO).getByRole('alert')).toContainText(
      'No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.'
    )
    await capturar(page, 'error-de-servidor')

    await page.goto('/pruebas-ui/alumnos?estado=exito')
    await expect(page.getByRole('status')).toContainText(
      'Legajo académico actualizado correctamente.'
    )
    await capturar(page, 'exito-inicial')
  })

  test('avisa cuando no hay ningún curso activo disponible', async ({ page }) => {
    await page.goto('/pruebas-ui/alumnos?sin-cursos=1')
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()

    const selectorCurso = formularioAlta(page).getByLabel('Curso')
    await expect(selectorCurso).toBeDisabled()
    // Las `option` de un `select` nunca son "visibles" para Playwright; se
    // comprueba el texto que ofrece el selector.
    await expect(selectorCurso).toHaveText(/No hay cursos activos disponibles/)
    await capturar(page, 'sin-cursos-activos')
  })

  test('nombra en español controles, regiones y contenido visible', async ({ page }) => {
    await page.goto('/pruebas-ui/alumnos')
    await expect(page.getByLabel(REGION_ESTADO)).toHaveAttribute('aria-live', 'polite')
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()

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
      'student',
      'status',
      'actions',
      'inactive',
      'active',
      'course',
      'level',
      'enrollment',
      'loading',
      'error',
    ]) {
      expect(
        new RegExp(`\\b${palabra}\\b`, 'i').test(texto),
        `la interfaz no debe contener la palabra en inglés "${palabra}"`
      ).toBe(false)
    }
  })
})
