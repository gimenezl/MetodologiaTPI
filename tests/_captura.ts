import type { Page } from '@playwright/test'

/**
 * Captura de evidencia sin las herramientas de desarrollo de Next.
 *
 * `devIndicators: false` apaga el indicador de ruta, pero la documentación de
 * Next lo dice con todas las letras: los errores de compilación y de ejecución
 * se siguen mostrando. Esa insignia flotante aparece, por ejemplo, en la
 * pantalla de error de Usuarios —donde el fallo se registra a propósito con
 * `console.error`— y en una captura de evidencia sugiere que lo que se está
 * viendo es un entorno de desarrollo, cuando lo que se documenta es el
 * comportamiento del producto.
 *
 * No se oculta el error: se oculta el panel del framework que lo anuncia. El
 * mensaje de dominio, que es lo que la evidencia demuestra, queda intacto.
 */
export async function capturarSinHerramientas(page: Page, ruta: string) {
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
