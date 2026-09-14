import { rm } from 'node:fs/promises'
import type { Page } from '@playwright/test'

/**
 * Captura de evidencia sin las herramientas de desarrollo de Next.
 *
 * `devIndicators: false` apaga el indicador de ruta, pero Next sigue mostrando
 * los errores de compilación y de ejecución en su propio panel. En una captura
 * de evidencia ese panel sugiere que se documenta un entorno de desarrollo,
 * cuando lo que se documenta es el producto.
 *
 * Ocultar el panel no puede servir para esconder un error real. Por eso, antes
 * de ocultarlo, se comprueba que no haya ningún diálogo de error de Next
 * abierto: si lo hay, la captura falla en lugar de documentar una pantalla que
 * en realidad está rota, y el error transcribe el texto del diálogo para que la
 * causa se vea sin repetir la corrida. Lo único que se oculta es la insignia y
 * el menú de herramientas, que no forman parte de la interfaz de la aplicación.
 */
export async function capturarSinHerramientas(page: Page, ruta: string) {
  const revisarYOcultarIndicadores = () => page.evaluate(() => {
    const portales = Array.from(document.querySelectorAll('nextjs-portal'))
    for (const portal of portales) {
      const dialogo = portal.shadowRoot?.querySelector(
        '[data-nextjs-dialog], [data-nextjs-dialog-overlay], [data-nextjs-error-overlay]'
      )
      if (dialogo) return (dialogo.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 600) || '(sin texto)'

      // No se oculta el portal: un error que aparezca después debe seguir
      // visible y detectable. Solo se retiran controles inocuos del framework.
      for (const indicador of portal.shadowRoot?.querySelectorAll(
        '[data-nextjs-toast], [data-nextjs-dev-tools-button], #__next-build-watcher'
      ) ?? []) {
        ;(indicador as HTMLElement).style.setProperty('display', 'none', 'important')
      }
    }
    return null
  })

  const exigirSinError = async () => {
    const errorAbierto = await revisarYOcultarIndicadores()
    if (errorAbierto === null) return
    throw new Error(
      `Next muestra un diálogo de error abierto: la captura ${ruta} no documentaría el producto. ` +
        `Contenido del diálogo: ${errorAbierto}`
    )
  }

  // La lectura ocurre inmediatamente antes de componer la captura.
  await exigirSinError()

  await page.screenshot({ path: ruta, fullPage: true })

  try {
    // Un overlay puede aparecer mientras Chromium compone la imagen. En ese
    // caso la captura ya escrita no es evidencia y se elimina.
    await exigirSinError()
  } catch (error) {
    await rm(ruta, { force: true })
    throw error
  }
}
