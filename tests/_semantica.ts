import { expect, type Page } from '@playwright/test'

/**
 * Semántica de los controles interactivos (EPT-9, cuarta revisión).
 *
 * La revisión encontró cinco composiciones `<Link><Button /></Link>`: un
 * `<button>` dentro de un `<a>`. El HTML lo prohíbe —el contenido de un enlace
 * no puede ser interactivo—, un lector de pantalla anuncia dos controles para
 * una sola acción y el tabulador se detiene dos veces. Estas comprobaciones
 * miran el DOM renderizado y el árbol de accesibilidad, no el código.
 */

/** Controles interactivos que no pueden contener otro control. */
const CONTENEDORES = 'a[href], button, [role="button"], [role="link"]'

/** Lo que cuenta como control interactivo dentro de otro. */
const INTERACTIVOS =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], ' +
  '[tabindex]:not([tabindex="-1"])'

/** Devuelve cada control que contiene otro control, con una descripción legible. */
export async function controlesAnidados(page: Page, raiz = 'body') {
  return page.evaluate(
    ({ raiz, contenedores, interactivos }) => {
      const describir = (elemento: Element) =>
        `${elemento.tagName.toLowerCase()}${elemento.getAttribute('href') ? `[href="${elemento.getAttribute('href')}"]` : ''}` +
        ` «${(elemento.textContent ?? '').trim().slice(0, 40)}»`
      const region = document.querySelector(raiz)
      if (!region) return [`no existe la región ${raiz}`]
      const hallazgos: string[] = []
      for (const contenedor of Array.from(region.querySelectorAll(contenedores))) {
        for (const interno of Array.from(contenedor.querySelectorAll(interactivos))) {
          hallazgos.push(`${describir(interno)} dentro de ${describir(contenedor)}`)
        }
      }
      return hallazgos
    },
    { raiz, contenedores: CONTENEDORES, interactivos: INTERACTIVOS }
  )
}

export async function exigirSinControlesAnidados(page: Page, contexto: string, raiz = 'body') {
  const hallazgos = await controlesAnidados(page, raiz)
  expect(hallazgos, `${contexto}: controles interactivos anidados\n  ${hallazgos.join('\n  ')}`).toEqual([])
}

/**
 * Exige que una acción de navegación sea exactamente UN enlace accesible.
 *
 * 1. El árbol de accesibilidad tiene un solo enlace con ese nombre y ningún
 *    botón con el mismo nombre (sin duplicar controles).
 * 2. El enlace apunta al destino esperado.
 * 3. El tabulador se detiene una sola vez en esa acción, sobre un `<a>`.
 * 4. Enter lo activa y navega al destino.
 */
export async function exigirEnlaceDeAccionUnico(
  page: Page,
  { nombre, destino, region = 'main' }: { nombre: string; destino: string; region?: string }
) {
  const contenedor = page.locator(region)

  await expect(contenedor.getByRole('link', { name: nombre, exact: true })).toHaveCount(1)
  await expect(contenedor.getByRole('button', { name: nombre })).toHaveCount(0)

  const arbol = await contenedor.ariaSnapshot()
  const menciones = arbol.split('\n').filter((linea) => linea.includes(`"${nombre}"`))
  expect(
    menciones.map((linea) => linea.trim().replace(/:$/u, '')),
    `el árbol de accesibilidad muestra la acción «${nombre}» una sola vez y como enlace`
  ).toEqual([expect.stringMatching(new RegExp(`^- link "${nombre}"`, 'u'))])

  const enlace = contenedor.getByRole('link', { name: nombre, exact: true })
  await expect(enlace).toHaveAttribute('href', destino)

  // Recorrido completo con Tab: desde el principio del documento hasta que el
  // foco vuelve a un elemento ya visitado. Cada parada se registra una vez.
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.querySelectorAll('[data-parada-tab]').forEach((e) => e.removeAttribute('data-parada-tab'))
  })
  const paradas: { etiqueta: string; texto: string }[] = []
  for (let i = 0; i < 150; i += 1) {
    await page.keyboard.press('Tab')
    const actual = await page.evaluate((orden) => {
      const activo = document.activeElement
      if (!activo || activo === document.body) return { vacio: true as const }
      if (activo.hasAttribute('data-parada-tab')) return { repetido: true as const }
      activo.setAttribute('data-parada-tab', String(orden))
      return {
        etiqueta: activo.tagName,
        texto: ((activo as HTMLElement).innerText ?? activo.textContent ?? '').trim(),
      }
    }, i)
    if ('repetido' in actual) break
    if ('vacio' in actual) continue
    paradas.push(actual)
  }
  const sobreLaAccion = paradas.filter((p) => p.texto === nombre)
  expect(
    sobreLaAccion,
    `el tabulador se detiene una sola vez en «${nombre}», sobre un enlace (paradas: ${paradas
      .map((p) => `${p.etiqueta}:${p.texto.slice(0, 20)}`)
      .join(' | ')})`
  ).toEqual([{ etiqueta: 'A', texto: nombre }])

  // Activación con Enter desde el foco.
  await enlace.focus()
  await expect(enlace).toBeFocused()
  const destinoExacto = new RegExp(
    `^[^?#]*${destino.replace(/[/\\^$.*+?()[\]{}|]/gu, '\\$&')}(?:[?#].*)?$`,
    'u'
  )
  if (new URL(page.url()).pathname !== destino) {
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(destinoExacto, { timeout: 15_000 })
    return
  }
  // Un reintento apunta a la misma ruta: la prueba es que Enter pide la página
  // otra vez al servidor.
  const pedido = page.waitForRequest((peticion) => new URL(peticion.url()).pathname === destino, {
    timeout: 15_000,
  })
  await page.keyboard.press('Enter')
  await pedido
  await expect(page).toHaveURL(destinoExacto)
}
