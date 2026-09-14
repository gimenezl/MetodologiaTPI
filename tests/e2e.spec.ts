import { test, expect } from '@playwright/test'

test('home loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /educación que/i })).toBeVisible()
})

test('dashboard redirects to login when unauthenticated', async ({ page }) => {
  await page.goto('/dashboard')
  // El destino viaja codificado (`%2Fdashboard`), que es lo correcto para un
  // valor dentro de una cadena de consulta. La expresion acepta las dos formas
  // para no volver a fallar si alguien cambia la codificacion.
  await expect(page).toHaveURL(/\/login\?redirect=(?:\/|%2F)dashboard/)
})

test('inscripción muestra exactamente los tres niveles institucionales', async ({ page }) => {
  await page.goto('/inscripcion')
  await expect(page.getByRole('heading', { name: /formulario de inscripción/i })).toBeVisible()

  const opciones = page
    .getByLabel('Nivel al que desea inscribirse')
    .locator('option')
  await expect(opciones).toHaveText([
    'Seleccionar nivel...',
    'Inicial (3 a 5 años)',
    'Primario (6 a 12 años)',
    'Secundario (13 a 17 años)',
  ])
  expect(await opciones.evaluateAll((items) => items.map((item) => item.getAttribute('value')))).toEqual([
    '',
    'INICIAL',
    'PRIMARIO',
    'SECUNDARIO',
  ])
})

test('noticias page renders', async ({ page }) => {
  await page.goto('/noticias')
  await expect(page.getByRole('heading', { name: /noticias institucionales/i })).toBeVisible()
})
