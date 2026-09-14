import { expect, test } from '@playwright/test'
import { capturarSinHerramientas } from './_captura'

test('una superposición de error que aparece durante la captura bloquea la evidencia', async ({ page }, testInfo) => {
  await page.setContent('<main><h1>Pantalla estable</h1></main>')

  const capturarOriginal = page.screenshot.bind(page)
  page.screenshot = (async (opciones) => {
    await page.evaluate(() => {
      const portal = document.createElement('nextjs-portal')
      const sombra = portal.attachShadow({ mode: 'open' })
      const dialogo = document.createElement('div')
      dialogo.setAttribute('data-nextjs-error-overlay', '')
      dialogo.textContent = 'Error tardío de ejecución'
      sombra.appendChild(dialogo)
      document.body.appendChild(portal)
    })
    return capturarOriginal(opciones)
  }) as typeof page.screenshot

  await expect(
    capturarSinHerramientas(page, testInfo.outputPath('captura-no-valida.png'))
  ).rejects.toThrow(/Error tardío de ejecución/)
})
