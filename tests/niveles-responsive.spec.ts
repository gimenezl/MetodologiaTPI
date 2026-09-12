import { expect, test } from '@playwright/test'

/**
 * Suite acotada a responsive y accesibilidad móvil. Playwright la ejecuta con
 * los perfiles oficiales Pixel 5/Chromium e iPhone 13/WebKit.
 */
test.describe('interfaz administrativa de niveles en dispositivo móvil', () => {
  test('usa tarjetas y no genera desplazamiento horizontal', async ({ page }) => {
    await page.goto('/pruebas-ui/niveles')

    await expect(
      page.getByRole('list', { name: 'Niveles educativos ordenados' })
    ).toBeVisible()
    await expect(
      page.getByRole('table', { name: 'Tabla de niveles educativos' })
    ).toBeHidden()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
    ).toBe(false)
  })

  test('permite operar el formulario y el diálogo sin desbordar', async ({ page }) => {
    await page.goto('/pruebas-ui/niveles')
    await page.getByRole('button', { name: 'Nuevo nivel' }).click()
    await expect(
      page.getByRole('heading', { name: 'Nuevo nivel educativo' })
    ).toBeVisible()
    await expect(page.getByLabel('Nombre del nivel').first()).toBeFocused()
    await page.getByRole('button', { name: 'Cerrar formulario' }).click()

    const disparador = page.getByRole('button', {
      name: 'Inactivar el nivel FORMACIÓN PROFESIONAL',
    })
    await disparador.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', {
      name: 'Inactivar FORMACIÓN PROFESIONAL',
    })
    await expect(dialogo).toBeVisible()
    await expect(
      dialogo.getByRole('button', { name: 'Confirmar inactivación' })
    ).toBeFocused()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
    ).toBe(false)

    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
    await expect(disparador).toBeFocused()
  })
})
