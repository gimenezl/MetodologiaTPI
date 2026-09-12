import { expect, test, type Page } from '@playwright/test'

/**
 * Pruebas de las correcciones de la revisión sobre la interfaz de alumnos.
 *
 * Corren contra el banco determinista `/pruebas-ui/alumnos`, que no toca la
 * base: acá se demuestra comportamiento de presentación, formulario y
 * accesibilidad. La persistencia se demuestra en `alumnos-auth.spec.ts`.
 *
 * Los localizadores usan identificadores en lugar de etiquetas porque el
 * asterisco de campo obligatorio aparece y desaparece según el estado elegido,
 * y una prueba no debería fallar por eso.
 *
 * Cada bloque cita el defecto que cierra, para que un revisor pueda ir del
 * informe a la prueba sin buscar.
 */

const BANCO = '/pruebas-ui/alumnos'

/** Camila cursa 1er Grado A en el banco de pruebas. */
const CURSO_DE_CAMILA = '1er Grado A'
const ID_PRIMER_GRADO_A = '11111111-1111-4111-8111-111111111111'
const ID_SEGUNDO_GRADO_B = '22222222-2222-4222-8222-222222222222'
const ID_SALA_DE_5_A = '33333333-3333-4333-8333-333333333333'

/**
 * Espacio no separable (U+00A0), escrito por punto de código a propósito.
 *
 * Justamente este defecto se coló una vez porque un literal invisible se
 * perdió sin dejar rastro en el diff. Acá el carácter se construye, no se
 * escribe.
 */
const ESPACIO_NO_SEPARABLE = String.fromCharCode(160)

async function abrirFormularioDeAlta(page: Page) {
  await page.goto(BANCO)
  await page.getByRole('button', { name: 'Nuevo alumno' }).click()
  await expect(page.getByRole('heading', { name: 'Nuevo legajo académico' })).toBeVisible()
}

async function completarIdentidad(page: Page, dni: string) {
  await page.locator('#nuevo-alumno-nombre').fill('Renata')
  await page.locator('#nuevo-alumno-apellido').fill('Ferreyra')
  await page.locator('#nuevo-alumno-dni').fill(dni)
}

test.describe('Alta: el paso de ACTIVO a INACTIVO no deja un curso incompatible', () => {
  /**
   * Defecto confirmado en la revisión: al pasar el estado a INACTIVO el
   * selector de curso se deshabilitaba pero conservaba el identificador ya
   * elegido. El esquema exige que un inactivo no tenga curso, así que la
   * validación bloqueaba el envío señalando un control que la persona no podía
   * tocar. El formulario quedaba trabado sin explicación visible.
   */
  test('recorre los nueve pasos del flujo sin bloquearse', async ({ page }) => {
    await abrirFormularioDeAlta(page)

    const estado = page.locator('#nuevo-alumno-estado')
    const curso = page.locator('#nuevo-alumno-curso')
    const legajo = page.locator('#nuevo-alumno-legajo')
    const crear = page.getByRole('button', { name: 'Crear legajo' })

    // 1. Estado ACTIVO: el curso es obligatorio y está disponible.
    await estado.selectOption('ACTIVO')
    await expect(curso).toBeEnabled()

    // 2. Se elige un curso concreto.
    await curso.selectOption(ID_PRIMER_GRADO_A)
    await expect(curso).toHaveValue(ID_PRIMER_GRADO_A)

    // 3. La persona cambia de idea y pasa a INACTIVO.
    await estado.selectOption('INACTIVO')

    // 4. El selector queda deshabilitado y, sobre todo, vacío: no conserva un
    //    curso que el estado ya no admite.
    await expect(curso).toBeDisabled()
    await expect(curso).toHaveValue('')

    // 5. No hay ningún error visible sobre un control que no se puede tocar.
    await expect(page.locator('#nuevo-alumno-curso-error')).toHaveCount(0)
    await expect(curso).not.toHaveAttribute('aria-invalid', 'true')

    // 6. El envío se puede completar. Se intercepta para leer el cuerpo real.
    await completarIdentidad(page, '47110022')
    await legajo.fill('LEG-INACTIVO-1')

    let cuerpoInactivo: Record<string, unknown> | null = null
    await page.route('**/api/alumnos', async (ruta) => {
      cuerpoInactivo = ruta.request().postDataJSON()
      await ruta.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Alta interceptada por la prueba.' }),
      })
    })

    await crear.click()
    await expect.poll(() => cuerpoInactivo).not.toBeNull()

    // 7. El cuerpo no lleva un curso incompatible con el estado.
    expect(cuerpoInactivo!).toMatchObject({ estado: 'INACTIVO' })
    expect(cuerpoInactivo!.curso_id ?? null).toBeNull()

    await page.unroute('**/api/alumnos')

    // 8. Al volver a ACTIVO el curso vuelve a exigirse, y vacío: no reaparece
    //    el que se había elegido antes.
    await estado.selectOption('ACTIVO')
    await expect(curso).toBeEnabled()
    await expect(curso).toHaveValue('')

    await crear.click()
    const errorCurso = page.locator('#nuevo-alumno-curso-error')
    await expect(errorCurso).toBeVisible()
    await expect(errorCurso).toHaveText(/curso/i)
    await expect(curso).toHaveAttribute('aria-invalid', 'true')
    await expect(curso).toHaveAttribute('aria-describedby', /nuevo-alumno-curso-error/)

    // 9. El control sigue siendo alcanzable por teclado y su nombre accesible
    //    está en español.
    await legajo.focus()
    await page.keyboard.press('Tab')
    await expect(curso).toBeFocused()
    await expect(curso).toHaveAccessibleName(/^Curso/)
  })

  test('un curso elegido antes de inactivar no vuelve al reactivar el formulario', async ({
    page,
  }) => {
    await abrirFormularioDeAlta(page)

    const estado = page.locator('#nuevo-alumno-estado')
    const curso = page.locator('#nuevo-alumno-curso')

    await estado.selectOption('ACTIVO')
    await curso.selectOption(ID_SEGUNDO_GRADO_B)
    await estado.selectOption('INACTIVO')
    await estado.selectOption('ACTIVO')

    await expect(curso).toHaveValue('')
  })
})

test.describe('Cambio de curso: el curso actual no se ofrece como destino', () => {
  /**
   * Defecto confirmado: el desplegable incluía el curso en el que el
   * estudiante ya estaba. Elegirlo abría un diálogo que sólo podía terminar en
   * el error P5516 del servidor. Una opción que nunca puede prosperar no es
   * una opción.
   */
  test('el desplegable excluye el curso vigente', async ({ page }) => {
    await page.goto(BANCO)
    await page
      .getByRole('button', { name: 'Cambiar el curso del alumno Arrieta, Camila' })
      .click()

    const destino = page.locator('#cambiar-curso-destino')
    await expect(destino).toBeVisible()

    const valores = await destino.locator('option').evaluateAll((opciones) =>
      opciones.map((opcion) => (opcion as HTMLOptionElement).value)
    )
    expect(valores).not.toContain(ID_PRIMER_GRADO_A)
    expect(valores).toContain(ID_SEGUNDO_GRADO_B)
    expect(valores).toContain(ID_SALA_DE_5_A)

    // Tampoco aparece por su rótulo: la exclusion es del curso, no del
    // identificador.
    const etiquetas = await destino.locator('option').allTextContents()
    expect(etiquetas.some((texto) => texto.startsWith(CURSO_DE_CAMILA))).toBe(false)
    expect(etiquetas.some((texto) => texto.startsWith('2do Grado B'))).toBe(true)
  })
})

test.describe('Diálogos: durante una operación en vuelo no se cierran de mentira', () => {
  /**
   * Defecto confirmado: el botón de cerrar y el fondo respondían al clic
   * mientras había una petición en curso, pero la función descartaba la acción
   * en silencio. El control parecía disponible sin serlo.
   */
  test('el diálogo permanece coherente mientras la petición está pendiente', async ({
    page,
  }) => {
    await page.goto(BANCO)

    // La petición se deja colgada a propósito hasta que la prueba la libere.
    let liberar: () => void = () => {}
    const pendiente = new Promise<void>((resolver) => {
      liberar = resolver
    })

    await page.route('**/api/alumnos/**', async (ruta) => {
      await pendiente
      await ruta.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Operación interceptada por la prueba.' }),
      })
    })

    await page
      .getByRole('button', { name: 'Cambiar el curso del alumno Arrieta, Camila' })
      .click()

    const dialogo = page.getByRole('dialog')
    await page.locator('#cambiar-curso-destino').selectOption(ID_SEGUNDO_GRADO_B)
    await page.getByRole('button', { name: 'Confirmar cambio de curso' }).click()

    // El estado ocupado se anuncia y los tres caminos de cierre coinciden.
    await expect(dialogo).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('button', { name: 'Cerrar diálogo' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeDisabled()

    await page.keyboard.press('Escape')
    await expect(dialogo).toBeVisible()

    // El fondo tampoco cierra: se pulsa una esquina, fuera del cuadro.
    await page.mouse.click(8, 8)
    await expect(dialogo).toBeVisible()

    liberar()

    // Al terminar la operación el estado ocupado se retira y el diálogo vuelve
    // a poder cerrarse de verdad.
    await expect(dialogo).not.toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('button', { name: 'Cerrar diálogo' })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
  })

  test('sin operación en vuelo, Escape cierra y devuelve el foco al disparador', async ({
    page,
  }) => {
    await page.goto(BANCO)

    const disparador = page.getByRole('button', {
      name: 'Cambiar el curso del alumno Arrieta, Camila',
    })
    await disparador.click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(dialogo).not.toHaveAttribute('aria-busy', 'true')

    // El foco inicial cae dentro del diálogo, en el control principal.
    await expect(page.locator('#cambiar-curso-destino')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
    await expect(disparador).toBeFocused()
  })

  test('el tabulador queda contenido dentro del diálogo', async ({ page }) => {
    await page.goto(BANCO)
    await page
      .getByRole('button', { name: 'Cambiar el curso del alumno Arrieta, Camila' })
      .click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()

    // Se recorre el ciclo completo hacia adelante y hacia atrás; en ningún
    // momento el foco se escapa al contenido de atrás.
    for (let paso = 0; paso < 8; paso += 1) {
      await page.keyboard.press('Tab')
      await expect(dialogo.locator(':focus')).toHaveCount(1)
    }
    for (let paso = 0; paso < 8; paso += 1) {
      await page.keyboard.press('Shift+Tab')
      await expect(dialogo.locator(':focus')).toHaveCount(1)
    }
  })
})

test.describe('Accesibilidad de los campos con error', () => {
  /**
   * Defecto confirmado: los campos inválidos no exponían `aria-invalid` ni
   * apuntaban al mensaje con `aria-describedby`, y el mensaje no tenía
   * `role="alert"`. Un lector de pantalla anunciaba el campo como correcto.
   */
  test('un DNI inválido queda anunciado como inválido y descrito por su mensaje', async ({
    page,
  }) => {
    await abrirFormularioDeAlta(page)

    await completarIdentidad(page, '123')
    await page.locator('#nuevo-alumno-estado').selectOption('INACTIVO')
    await page.getByRole('button', { name: 'Crear legajo' }).click()

    const dni = page.locator('#nuevo-alumno-dni')
    await expect(dni).toHaveAttribute('aria-invalid', 'true')

    const error = page.locator('#nuevo-alumno-dni-error')
    await expect(error).toBeVisible()
    await expect(error).toHaveAttribute('role', 'alert')
    await expect(error).toHaveText(/DNI/)
    await expect(dni).toHaveAttribute('aria-describedby', /nuevo-alumno-dni-error/)
  })

  test('el texto de ayuda deja de describir el campo cuando aparece el error', async ({
    page,
  }) => {
    await abrirFormularioDeAlta(page)

    const dni = page.locator('#nuevo-alumno-dni')

    // Sin error, la ayuda es la descripción.
    await expect(dni).toHaveAttribute('aria-describedby', 'nuevo-alumno-dni-ayuda')
    await expect(dni).not.toHaveAttribute('aria-invalid', 'true')

    await completarIdentidad(page, '12')
    await page.locator('#nuevo-alumno-estado').selectOption('INACTIVO')
    await page.getByRole('button', { name: 'Crear legajo' }).click()

    await expect(dni).toHaveAttribute('aria-describedby', 'nuevo-alumno-dni-error')
  })

  test('un legajo con espacio no separable al final se rechaza como en la base', async ({
    page,
  }) => {
    await abrirFormularioDeAlta(page)

    await completarIdentidad(page, '47110033')
    await page.locator('#nuevo-alumno-estado').selectOption('INACTIVO')

    // El carácter es invisible, pero «LEG-1» y «LEG-1 + U+00A0» son dos
    // legajos distintos para la base. El formulario tiene que decir lo mismo.
    await page.locator('#nuevo-alumno-legajo').fill(`LEG-1${ESPACIO_NO_SEPARABLE}`)
    await page.getByRole('button', { name: 'Crear legajo' }).click()

    const error = page.locator('#nuevo-alumno-legajo-error')
    await expect(error).toBeVisible()
    await expect(error).toHaveText(/espacios al inicio o al final/)
  })
})
