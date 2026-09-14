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
 * en realidad está rota. Lo único que se oculta es la insignia y el menú de
 * herramientas, que no forman parte de la interfaz de la aplicación.
 */
export async function capturarSinHerramientas(page: Page, ruta: string) {
  const errorAbierto = await page.evaluate(() => {
    const portales = Array.from(document.querySelectorAll('nextjs-portal'))
    return portales.some((portal) =>
      Boolean(
        portal.shadowRoot?.querySelector(
          '[data-nextjs-dialog], [data-nextjs-dialog-overlay], [data-nextjs-error-overlay]'
        )
      )
    )
  })
  if (errorAbierto) {
    throw new Error(
      `Next muestra un diálogo de error abierto: la captura ${ruta} no documentaría el producto.`
    )
  }

  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dev-tools-button],
      #__next-build-watcher { display: none !important; }
    `,
  })
  await page.screenshot({ path: ruta, fullPage: true })
}
