import { expect, test } from '@playwright/test'
import { exigirContraste } from './_contraste'

/**
 * Contraste WCAG 2.1 AA sobre el banco visual del legajo academico.
 *
 * Corre en los tres perfiles —escritorio, Pixel 5 e iPhone 13— porque el
 * listado cambia de forma: en escritorio es una tabla y en movil son tarjetas,
 * y el DNI y el legajo de la tarjeta son justamente uno de los textos que la
 * revision encontro por debajo del minimo.
 */

const BANCO = '/pruebas-ui/alumnos'

test.describe('Contraste WCAG AA del legajo académico', () => {
  test('el listado con estudiantes activos e inactivos', async ({ page }) => {
    await page.goto(BANCO)
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()
    await exigirContraste(page, 'listado')
  })

  test('el formulario de alta, en sus dos estados', async ({ page }) => {
    await page.goto(BANCO)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo legajo académico' })).toBeVisible()

    await page.locator('#nuevo-alumno-estado').selectOption('ACTIVO')
    await exigirContraste(page, 'formulario en estado ACTIVO')

    await page.locator('#nuevo-alumno-estado').selectOption('INACTIVO')
    await exigirContraste(page, 'formulario en estado INACTIVO')
  })

  test('el formulario con errores de validación visibles', async ({ page }) => {
    await page.goto(BANCO)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await page.locator('#nuevo-alumno-dni').fill('12')
    await page.getByRole('button', { name: 'Crear legajo' }).click()
    await expect(page.locator('#nuevo-alumno-dni-error')).toBeVisible()
    await exigirContraste(page, 'formulario con errores')
  })

  test('el diálogo de cambio de curso', async ({ page }) => {
    await page.goto(BANCO)
    await page
      .getByRole('button', { name: 'Cambiar el curso del alumno Arrieta, Camila' })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await exigirContraste(page, 'diálogo de cambio de curso')
  })

  test('el listado vacío y el listado sin cursos activos', async ({ page }) => {
    await page.goto(`${BANCO}?vacio=1`)
    await expect(page.getByText('No hay alumnos registrados')).toBeVisible()
    await exigirContraste(page, 'listado vacío')

    await page.goto(`${BANCO}?sin-cursos=1`)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await exigirContraste(page, 'sin cursos activos')
  })

  test('los mensajes de error y de éxito', async ({ page }) => {
    await page.goto(`${BANCO}?estado=error`)
    await expect(
      page.getByText('No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.')
    ).toBeVisible()
    await exigirContraste(page, 'mensaje de error')

    await page.goto(`${BANCO}?estado=exito`)
    await expect(page.getByText('Legajo académico actualizado correctamente.')).toBeVisible()
    await exigirContraste(page, 'mensaje de éxito')
  })

  test('el estado de carga', async ({ page }) => {
    await page.goto(`${BANCO}?estado=carga`)
    await exigirContraste(page, 'estado de carga')
  })
})
