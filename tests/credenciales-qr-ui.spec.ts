import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { capturarSinHerramientas } from './_captura'
import { exigirContraste } from './_contraste'
import { exigirSinControlesAnidados } from './_semantica'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Presentación de la credencial QR (EPT-64, RF20) sobre el banco visual.
 *
 * Corre en escritorio, Pixel 5 (Chromium) e iPhone 13 (WebKit). El banco usa un
 * QR FICTICIO —firma de ceros y un `kid` que ninguna configuración conoce—: es
 * imposible de validar en cualquier entorno. Estas pruebas demuestran la
 * presentación, no la autorización; la integración con sesiones reales vive en
 * `credenciales-qr-auth.spec.ts`.
 *
 * Las capturas solo se escriben con `EPT_CAPTURAS=1`, para que correr la suite
 * completa no regenere evidencia de otras historias ni de esta.
 */

const BANCO = '/pruebas-ui/credenciales'
const CAPTURAS = path.join('docs', 'evidence', 'EPT-64')
const escribirCapturas = process.env.EPT_CAPTURAS === '1'

async function captura(page: Page, nombre: string, paginaCompleta = true) {
  if (!escribirCapturas) return
  fs.mkdirSync(CAPTURAS, { recursive: true })
  await capturarSinHerramientas(
    page,
    path.join(CAPTURAS, `fixture-${test.info().project.name}-${nombre}.png`),
    { paginaCompleta }
  )
}

/**
 * Espera a que React haya hidratado el control. Un clic o un `fill` previo a la
 * hidratación no dispara los manejadores: en WebKit, más lento, se nota.
 */
async function hidratado(control: Locator) {
  await expect
    .poll(() => control.evaluate((el) => Object.keys(el).some((clave) => clave.startsWith('__reactProps'))))
    .toBe(true)
}

/** Navega y espera a que el primer control de la pantalla esté hidratado. */
async function irA(page: Page, url: string) {
  await page.goto(url)
  const control = page.locator('button, input, select').first()
  if ((await control.count()) > 0) await hidratado(control)
}

async function sinDesbordeHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

/** Ningún atributo ni texto visible contiene el texto del payload. */
async function sinTokenExpuesto(page: Page) {
  const expuesto = await page.evaluate(() => {
    const texto = document.body.innerText
    const atributos = Array.from(document.querySelectorAll('*')).flatMap((el) =>
      Array.from(el.attributes)
        .filter((a) => a.name !== 'src' || !a.value.startsWith('data:image/svg+xml;base64,'))
        .map((a) => a.value)
    )
    return [texto, ...atributos].some((valor) => /EPT1\./.test(valor) || /pruebas\.A{10}/.test(valor))
  })
  expect(expuesto, 'el payload del QR no debe aparecer como texto ni en atributos').toBe(false)
}

test.describe('credencial vigente', () => {
  test('la tarjeta muestra nombre, apellido y legajo; nunca DNI; y un QR legible', async ({ page }) => {
    await irA(page, BANCO)

    await expect(page.getByRole('heading', { name: 'Mi credencial' })).toBeVisible()
    const tarjeta = page.getByRole('article', { name: 'Credencial digital de Lucía Ejemplo Ficticia' })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta.getByText('Credencial digital', { exact: true })).toBeVisible()
    await expect(tarjeta.getByText('Lucía')).toBeVisible()
    await expect(tarjeta.getByText('Ejemplo Ficticia')).toBeVisible()
    await expect(tarjeta.getByText('Legajo: LEG-PRUEBA-0064')).toBeVisible()
    await expect(page.getByText('Credencial vigente')).toBeVisible()
    await expect(page.getByText(/Emitida el \d{1,2} de octubre de 2026/)).toBeVisible()

    // Sin DNI ni foto.
    expect(await tarjeta.innerText()).not.toMatch(/dni|documento/i)
    await expect(tarjeta.locator('img')).toHaveCount(1)

    const qr = tarjeta.getByRole('img', { name: 'Código QR de la credencial de Lucía Ejemplo Ficticia' })
    await expect(qr).toBeVisible()
    const caja = await qr.boundingBox()
    expect(caja).not.toBeNull()
    // Lado suficiente para escanearse en pantalla (≥ 200 px) y cuadrado.
    expect(caja!.width).toBeGreaterThanOrEqual(200)
    expect(Math.abs(caja!.width - caja!.height)).toBeLessThan(2)
    expect(await qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)

    // Contraste del QR: negro sobre blanco, con marco blanco (zona silenciosa) dentro del SVG.
    const colores = await qr.evaluate(async (img: HTMLImageElement) => {
      const lienzo = document.createElement('canvas')
      lienzo.width = 210
      lienzo.height = 210
      const contexto = lienzo.getContext('2d')!
      contexto.drawImage(img, 0, 0, 210, 210)
      const esquina = contexto.getImageData(2, 2, 1, 1).data
      return Array.from(esquina)
    })
    expect(colores.slice(0, 3)).toEqual([255, 255, 255])

    await sinTokenExpuesto(page)
    await sinDesbordeHorizontal(page)
    await captura(page, 'vigente')
  })

  test('sin controles anidados, sin detalle técnico y con contraste AA', async ({ page }) => {
    await irA(page, BANCO)
    await exigirSinControlesAnidados(page, 'credencial vigente')
    await exigirPantallaSinDetalleTecnico(page, 'credencial vigente')
    await exigirContraste(page, 'credencial vigente', {
      esenciales: ['h1', '[data-estado-credencial] article p', '[data-estado-credencial] > div p'],
    })
  })

  test('la descarga entrega un PNG de tarjeta con el nombre esperado', async ({ page }) => {
    await irA(page, BANCO)
    const descarga = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar imagen' }).click()
    const archivo = await descarga

    expect(archivo.suggestedFilename()).toBe('credencial-ejemplo-ficticia-lucia.png')
    const ruta = await archivo.path()
    const bytes = fs.readFileSync(ruta)
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // Tarjeta ID-1 a 300 ppp: 1011 × 638 (IHDR: ancho y alto en los bytes 16..23).
    expect(bytes.readUInt32BE(16)).toBe(1011)
    expect(bytes.readUInt32BE(20)).toBe(638)
    expect(bytes.length).toBeGreaterThan(5_000)

    await expect(page.getByRole('status').filter({ hasText: 'La descarga comenzó' })).toBeVisible()
  })

  test('imprimir abre el diálogo de impresión y el medio impreso muestra solo la tarjeta', async ({ page }) => {
    await irA(page, BANCO)
    await page.evaluate(() => {
      ;(window as unknown as { __impresiones: number }).__impresiones = 0
      window.print = () => {
        ;(window as unknown as { __impresiones: number }).__impresiones += 1
      }
    })
    await page.getByRole('button', { name: 'Imprimir' }).click()
    expect(await page.evaluate(() => (window as unknown as { __impresiones: number }).__impresiones)).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: 'Abriendo la impresión' })).toBeVisible()

    await page.emulateMedia({ media: 'print' })
    const tarjeta = page.getByRole('article', { name: /Credencial digital de/ })
    await expect(tarjeta).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Mi credencial' })).toBeHidden()
    // Los botones dejan de verse: solo se imprime la tarjeta.
    const visibilidad = await page.evaluate(() => {
      const estilo = (selector: string) => {
        const el = document.querySelector(selector)
        return el ? getComputedStyle(el).visibility : 'inexistente'
      }
      return {
        tarjeta: estilo('.imprimible'),
        qr: estilo('.imprimible img'),
        botones: estilo('section button'),
      }
    })
    expect(visibilidad).toEqual({ tarjeta: 'visible', qr: 'visible', botones: 'hidden' })
    await captura(page, 'impresion', false)
    await page.emulateMedia({ media: 'screen' })
  })

  test('con dos hijos, «Imprimir» de cada tarjeta imprime solo esa (no se superponen)', async ({ page }) => {
    await irA(page, `${BANCO}?estado=dos-hijos&vista=hijo`)
    await page.evaluate(() => {
      window.print = () => {}
    })
    const tarjetas = page.locator('.imprimible')
    await expect(tarjetas).toHaveCount(2)

    for (const [indice, nombre] of ['Lucía', 'Mateo'].entries()) {
      // El botón de cada tarjeta está en su propia sección.
      await page.locator('section', { has: page.getByRole('article', { name: new RegExp(`de ${nombre}`) }) })
        .getByRole('button', { name: 'Imprimir' }).click()
      await page.emulateMedia({ media: 'print' })
      const impresas = await page.evaluate(() =>
        [...document.querySelectorAll('.imprimible')].map((el) => ({
          visible: getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility === 'visible',
          texto: el.textContent ?? '',
        }))
      )
      const visibles = impresas.filter((t) => t.visible)
      expect(visibles, `tarjeta ${indice + 1}: solo una se imprime`).toHaveLength(1)
      expect(visibles[0].texto).toContain(nombre)
      await page.emulateMedia({ media: 'screen' })
      // Simula el fin de la impresión: la marca se retira y no queda ninguna oculta en pantalla.
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
      await expect(page.locator('.imprimible[data-imprimiendo]')).toHaveCount(0)
    }
  })

  test('el teclado alcanza descargar e imprimir con foco visible y objetivos táctiles de 44 px', async ({ page }) => {
    await irA(page, BANCO)
    const descargar = page.getByRole('button', { name: 'Descargar imagen' })
    const imprimir = page.getByRole('button', { name: 'Imprimir' })

    for (const boton of [descargar, imprimir]) {
      const caja = await boton.boundingBox()
      expect(caja!.height).toBeGreaterThanOrEqual(44)
      expect(caja!.width).toBeGreaterThanOrEqual(44)
    }

    await descargar.focus()
    await expect(descargar).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(imprimir).toBeFocused()
    const contorno = await imprimir.evaluate((el) => {
      const estilo = getComputedStyle(el)
      return { ancho: estilo.outlineWidth, estilo: estilo.outlineStyle, sombra: estilo.boxShadow }
    })
    expect(contorno.estilo !== 'none' || contorno.sombra !== 'none').toBe(true)
    await captura(page, 'foco-visible')
  })
})

test.describe('estados sin QR', () => {
  const casos = [
    {
      estado: 'sin-credencial',
      vista: 'propia',
      titulo: 'Todavía no tenés una credencial',
      detalle: /Cuando Dirección la emita/,
    },
    {
      estado: 'sin-credencial',
      vista: 'hijo',
      titulo: 'Todavía no hay una credencial',
      detalle: /Cuando Dirección emita la credencial de Lucía/,
    },
    {
      estado: 'revocada',
      vista: 'propia',
      titulo: 'Credencial revocada',
      detalle: /Comunicate con Dirección para obtener una nueva/,
    },
    {
      estado: 'inactivo',
      vista: 'propia',
      titulo: 'Estás inactivo',
      detalle: /vuelve a valer la misma/,
    },
    {
      estado: 'inactivo',
      vista: 'hijo',
      titulo: 'Alumno inactivo',
      detalle: /La credencial de Lucía no es válida mientras esté inactivo/,
    },
    {
      estado: 'bloqueado',
      vista: 'direccion',
      titulo: 'Acceso del alumno bloqueado',
      detalle: /Al habilitarlo vuelve a valer la misma credencial/,
    },
  ] as const

  for (const caso of casos) {
    test(`${caso.estado} (${caso.vista}): dice qué pasa, sin QR y sin descargar ni imprimir`, async ({ page }) => {
      await irA(page, `${BANCO}?estado=${caso.estado}&vista=${caso.vista}`)
      await expect(page.getByRole('heading', { name: caso.titulo })).toBeVisible()
      await expect(page.getByText(caso.detalle)).toBeVisible()
      await expect(page.getByText('Legajo: LEG-PRUEBA-0064')).toBeVisible()

      await expect(page.getByRole('img')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Descargar imagen' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Imprimir' })).toHaveCount(0)
      await sinTokenExpuesto(page)
      await exigirPantallaSinDetalleTecnico(page, `${caso.estado}/${caso.vista}`)
      await exigirContraste(page, `${caso.estado}/${caso.vista}`, { esenciales: ['h3'], minimoMedidos: 5 })
      await sinDesbordeHorizontal(page)
      await captura(page, `${caso.estado}-${caso.vista}`)
    })
  }

  test('cargando: región de estado anunciada y sin contenido inventado', async ({ page }) => {
    await irA(page, `${BANCO}?estado=carga`)
    await expect(page.getByRole('status').filter({ hasText: 'Cargando la credencial' })).toBeAttached()
    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    await expect(page.getByRole('img')).toHaveCount(0)
    await captura(page, 'carga')
  })

  test('error de lectura: alerta en español con reintento, sin detalle técnico', async ({ page }) => {
    await irA(page, `${BANCO}?estado=error`)
    // El anunciador de rutas de Next también es un `alert`: se acota por contenido.
    const alerta = page.getByRole('alert').filter({ hasText: 'No pudimos cargar tu credencial' })
    await expect(alerta).toBeVisible()
    await expect(alerta).toContainText('Volvé a intentarlo en unos minutos')
    await expect(alerta.getByRole('link', { name: 'Reintentar' })).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'error de lectura')
    await captura(page, 'error')
  })
})

test.describe('acciones de Dirección', () => {
  test('sin credencial NO se emite sola: hace falta un clic, y el clic emite una vez', async ({ page }) => {
    const pedidos: string[] = []
    await page.route('**/api/credenciales-qr/**', async (ruta) => {
      pedidos.push(`${ruta.request().method()} ${new URL(ruta.request().url()).pathname}`)
      await ruta.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ credencial: { id: 'eeeeeeee-6400-4000-8000-0000000000aa' } }),
      })
    })

    await irA(page, `${BANCO}?estado=sin-credencial&vista=direccion`)
    await expect(page.getByRole('button', { name: 'Emitir credencial' })).toBeVisible()
    expect(pedidos, 'cargar la pantalla no debe emitir').toEqual([])

    await page.getByRole('button', { name: 'Emitir credencial' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Credencial emitida.' })).toBeVisible()
    expect(pedidos).toEqual(['POST /api/credenciales-qr/eeeeeeee-6400-4000-8000-000000000001'])
    await captura(page, 'direccion-emitida')
  })

  test('tras una revocación se ofrece emitir una nueva', async ({ page }) => {
    await irA(page, `${BANCO}?estado=revocada&vista=direccion`)
    await expect(page.getByRole('button', { name: 'Emitir credencial nueva' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reponer credencial' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Revocar credencial' })).toHaveCount(0)
  })

  test('reponer: diálogo con foco en el motivo, validación, Escape devuelve el foco y el cuerpo solo lleva el motivo', async ({ page }) => {
    const cuerpos: unknown[] = []
    const urls: string[] = []
    await page.route('**/api/credenciales-qr/credenciales/**', async (ruta) => {
      urls.push(new URL(ruta.request().url()).pathname)
      cuerpos.push(ruta.request().postDataJSON())
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ credencial: { id: 'eeeeeeee-6400-4000-8000-0000000000bb' } }),
      })
    })

    await irA(page, `${BANCO}?estado=vigente&vista=direccion`)
    const abrir = page.getByRole('button', { name: 'Reponer credencial' })
    await abrir.click()

    const dialogo = page.getByRole('dialog', { name: 'Reponer credencial' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel(/Motivo/)).toBeFocused()
    await captura(page, 'direccion-dialogo-reponer', false)

    // Escape cierra y devuelve el foco al disparador.
    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
    await expect(abrir).toBeFocused()

    await abrir.click()
    await dialogo.getByRole('button', { name: 'Reponer credencial' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('El motivo debe tener entre 3 y 200 caracteres.')
    await expect(dialogo.getByLabel(/Motivo/)).toBeFocused()
    expect(urls).toHaveLength(0)

    await dialogo.getByLabel(/Motivo/).fill('  Extravío de la tarjeta  ')
    await dialogo.getByRole('button', { name: 'Reponer credencial' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Credencial repuesta. La anterior quedó revocada.' })).toBeVisible()

    expect(urls).toEqual([
      '/api/credenciales-qr/credenciales/eeeeeeee-6400-4000-8000-000000000003/reposicion',
    ])
    // Solo el motivo: ni alumno, ni rol, ni actor viajan en la petición.
    expect(cuerpos).toEqual([{ motivo: 'Extravío de la tarjeta' }])
  })

  test('revocar: aclara que no se puede deshacer y usa la ruta de revocación', async ({ page }) => {
    const urls: string[] = []
    await page.route('**/api/credenciales-qr/credenciales/**', async (ruta) => {
      urls.push(new URL(ruta.request().url()).pathname)
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ credencial: { id: 'eeeeeeee-6400-4000-8000-000000000003' } }),
      })
    })

    await irA(page, `${BANCO}?estado=vigente&vista=direccion`)
    await page.getByRole('button', { name: 'Revocar credencial' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Revocar credencial' })
    await expect(dialogo).toContainText('no se puede restaurar')
    await dialogo.getByLabel(/Motivo/).fill('Baja por egreso')
    await dialogo.getByRole('button', { name: 'Revocar credencial' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Credencial revocada.' })).toBeVisible()
    expect(urls).toEqual(['/api/credenciales-qr/credenciales/eeeeeeee-6400-4000-8000-000000000003/revocacion'])
  })

  test('si otra operación ya cambió la credencial (409) se pide actualizar, no se reintenta a ciegas', async ({ page }) => {
    await page.route('**/api/credenciales-qr/credenciales/**', async (ruta) => {
      await ruta.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'La credencial ya no está vigente. Actualizá la pantalla para ver su estado actual.',
          codigo: 'CREDENCIAL_NO_VIGENTE',
        }),
      })
    })

    await irA(page, `${BANCO}?estado=vigente&vista=direccion`)
    await page.getByRole('button', { name: 'Reponer credencial' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/Motivo/).fill('Extravío')
    await dialogo.getByRole('button', { name: 'Reponer credencial' }).click()

    await expect(dialogo.getByRole('alert')).toContainText('La credencial ya no está vigente')
    await captura(page, 'direccion-conflicto', false)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Actualizar pantalla' })).toBeVisible()
  })

  test('sin conexión: mensaje en español y el diálogo sigue abierto para reintentar', async ({ page }) => {
    await page.route('**/api/credenciales-qr/credenciales/**', (ruta) => ruta.abort('failed'))
    await irA(page, `${BANCO}?estado=vigente&vista=direccion`)
    await page.getByRole('button', { name: 'Revocar credencial' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/Motivo/).fill('Baja por egreso')
    await dialogo.getByRole('button', { name: 'Revocar credencial' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('No pudimos comunicarnos con el servidor')
    await expect(dialogo).toBeVisible()
  })
})

test.describe('panel e historial de Dirección', () => {
  test('el panel lista, busca por nombre y legajo, filtra por estado y nunca muestra DNI', async ({ page }) => {
    await irA(page, `${BANCO}?estado=panel`)
    const lista = page.getByRole('list', { name: 'Alumnos y estado de su credencial' })
    await expect(lista.getByRole('listitem')).toHaveCount(3)
    await expect(page.getByRole('status').filter({ hasText: '3 alumnos' })).toBeVisible()
    expect(await lista.innerText()).not.toMatch(/dni/i)
    await captura(page, 'panel')

    await page.getByLabel('Buscar por nombre, apellido o legajo').fill('xyzzy')
    await expect(lista.getByRole('listitem')).toHaveCount(0)
    await page.getByLabel('Buscar por nombre, apellido o legajo').fill('mateo')
    await expect(lista.getByRole('listitem')).toHaveCount(1)
    await expect(page.getByRole('status').filter({ hasText: '1 de 3 alumnos' })).toBeVisible()
    await expect(lista.getByText('Sin credencial')).toBeVisible()

    await page.getByLabel('Buscar por nombre, apellido o legajo').fill('LEG-PRUEBA-0064')
    await expect(lista.getByRole('listitem')).toHaveCount(1)

    await page.getByLabel('Buscar por nombre, apellido o legajo').fill('')
    await page.getByLabel('Filtrar por estado de la credencial').selectOption('REVOCADA')
    await expect(lista.getByRole('listitem')).toHaveCount(1)
    await expect(lista.getByText('Alumno inactivo')).toBeVisible()

    await page.getByLabel('Filtrar por estado de la credencial').selectOption('VIGENTE')
    await page.getByLabel('Buscar por nombre, apellido o legajo').fill('zzz')
    await expect(page.getByText('No hay alumnos que coincidan')).toBeVisible()
    await sinDesbordeHorizontal(page)
  })

  test('el enlace de cada alumno lleva a su credencial y tiene nombre accesible', async ({ page }) => {
    await irA(page, `${BANCO}?estado=panel`)
    const enlace = page.getByRole('link', { name: 'Ver la credencial de Lucía Ejemplo Ficticia' })
    await expect(enlace).toHaveAttribute('href', '/dashboard/credenciales/a1')
    const caja = await enlace.boundingBox()
    expect(caja!.height).toBeGreaterThanOrEqual(44)
  })

  test('panel sin alumnos: estado vacío', async ({ page }) => {
    await irA(page, `${BANCO}?estado=panel-vacio`)
    await expect(page.getByText('Todavía no hay alumnos registrados')).toBeVisible()
    await captura(page, 'panel-vacio')
  })

  test('el historial muestra quién, cuándo y por qué, de la más reciente a la más antigua', async ({ page }) => {
    await irA(page, `${BANCO}?estado=historial`)
    const historial = page.getByRole('list', { name: /Historial de credenciales/ })
    const items = historial.getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('Vigente')
    await expect(items.nth(0)).toContainText('Reemplazó a la anterior')
    await expect(items.nth(1)).toContainText('Revocada')
    await expect(items.nth(1)).toContainText('Extravío de la tarjeta')
    await expect(items.nth(1)).toContainText('Dirección Ficticia')
    await sinTokenExpuesto(page)
    await captura(page, 'historial')
  })
})
