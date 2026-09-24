import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const CAPTURAS = path.join('docs', 'evidence', 'EPT-13')

async function captura(page: import('@playwright/test').Page, nombre: string) {
  fs.mkdirSync(CAPTURAS, { recursive: true })
  await page.screenshot({ path: path.join(CAPTURAS, `fixture-${test.info().project.name}-${nombre}.png`), fullPage: true })
}

test('el banco visual cubre estados, foco y móvil sin desbordamiento', async ({ page }) => {
  await page.goto('/pruebas-ui/hijos?estado=carga')
  await expect(page.getByRole('status', { name: 'Cargando hijos' })).toBeVisible()
  await captura(page, 'carga')

  await page.goto('/pruebas-ui/hijos?estado=vacio')
  await expect(page.getByText('Todavía no tenés hijos vinculados')).toBeVisible()
  await captura(page, 'vacio')

  await page.goto('/pruebas-ui/hijos?estado=sin-cursos')
  await page.getByRole('article').filter({ hasText: 'Lara Vinculada' }).getByRole('button', { name: 'Seleccionar para matricular' }).click()
  await expect(page.getByText('No hay cursos activos disponibles en este momento.')).toBeVisible()
  await captura(page, 'sin-cursos')

  await page.goto('/pruebas-ui/hijos')
  await captura(page, 'hijo-activo-y-apto')
  const boton = page.getByRole('article').filter({ hasText: 'Lara Vinculada' }).getByRole('button', { name: 'Seleccionar para matricular' })
  await boton.focus()
  await expect(boton).toBeFocused()
  await captura(page, 'foco-visible')
  await boton.press('Enter')
  await page.getByLabel('Curso activo').selectOption({ index: 1 })
  const revisar = page.getByRole('button', { name: 'Revisar matrícula' })
  await revisar.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(revisar).toBeFocused()

  await page.route('**/api/hijos/*/matricula', async (route) => {
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'El alumno ya tiene una matrícula vigente.' }) })
  })
  await revisar.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar matrícula' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'matrícula vigente' })).toBeVisible()
  await captura(page, 'error-dominio-simulado')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
