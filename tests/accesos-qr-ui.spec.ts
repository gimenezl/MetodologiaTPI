import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { capturarSinHerramientas } from './_captura'
import { exigirContraste } from './_contraste'
import { exigirSinControlesAnidados } from './_semantica'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'
import { gifDelQr } from './_accesos-qr'

/**
 * Presentación, accesibilidad y manejo de cámara del escáner de accesos (EPT-65, RF21)
 * sobre el banco visual.
 *
 * Corre en escritorio, Pixel 5 (Chromium) e iPhone 13 (WebKit). La API se simula con
 * `page.route`: el banco demuestra la PRESENTACIÓN, los estados y el cuidado de la cámara,
 * NO la autorización ni la persistencia (eso lo prueban `accesos-qr-auth.spec.ts`, la prueba
 * SQL y la de concurrencia). El QR de las fotos es FICTICIO: firma de ceros que ninguna
 * configuración reconoce.
 *
 * Los dispositivos físicos (Android Chrome, iPhone Safari) NO se simulan acá: un perfil de
 * emulación no es un teléfono. Ver `docs/evidence/EPT-65.md` para el estado de esa prueba.
 *
 * Las capturas solo se escriben con `EPT_CAPTURAS=1`, para que correr la suite completa no
 * regenere evidencia de otras historias ni de esta.
 */

const BANCO = '/pruebas-ui/accesos'
const CAPTURAS = path.join('docs', 'evidence', 'EPT-65')
const escribirCapturas = process.env.EPT_CAPTURAS === '1'
const PAYLOAD_FICTICIO = 'EPT1.k1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const REGISTRO = '**/api/accesos-servicios/registro'

async function captura(page: Page, nombre: string, paginaCompleta = true) {
  if (!escribirCapturas) return
  fs.mkdirSync(CAPTURAS, { recursive: true })
  await capturarSinHerramientas(page, path.join(CAPTURAS, `banco-${test.info().project.name}-${nombre}.png`), { paginaCompleta })
}

/** Espera a que React haya hidratado el control: un clic previo no dispararía el manejador. */
async function hidratado(control: Locator) {
  await expect
    .poll(() => control.evaluate((el) => Object.keys(el).some((clave) => clave.startsWith('__reactProps'))))
    .toBe(true)
}

async function irA(page: Page, vista = 'escaner') {
  await page.goto(`${BANCO}?vista=${vista}`)
  const control = page.locator('button, input, select').first()
  if ((await control.count()) > 0) await hidratado(control)
}

async function sinDesbordeHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function exigirAlMenos44(controles: Locator, contexto: string) {
  const cantidad = await controles.count()
  expect(cantidad, `${contexto}: hay controles`).toBeGreaterThan(0)
  for (let i = 0; i < cantidad; i += 1) {
    const caja = await controles.nth(i).boundingBox()
    expect(caja, `${contexto} #${i}`).not.toBeNull()
    expect(caja!.height, `${contexto} #${i}: alto táctil`).toBeGreaterThanOrEqual(43.5)
    expect(caja!.width, `${contexto} #${i}: ancho táctil`).toBeGreaterThanOrEqual(43.5)
  }
}

type Capturado = { payload: string; intento_id: string; servicio_id: string; sentido?: string }

/** Responde a todas las peticiones de registro con la misma respuesta y las registra. */
async function simular(page: Page, respuesta: { estado: number; cuerpo: unknown; cabeceras?: Record<string, string> }) {
  const peticiones: Capturado[] = []
  await page.route(REGISTRO, async (ruta: Route) => {
    peticiones.push(ruta.request().postDataJSON() as Capturado)
    await ruta.fulfill({
      status: respuesta.estado,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store', ...respuesta.cabeceras },
      body: JSON.stringify(respuesta.cuerpo),
    })
  })
  return peticiones
}

const REGISTRADO = {
  codigo: 'REGISTRADO',
  mensaje: 'Acceso registrado.',
  alumno: { nombre: 'Lucía', apellido: 'Ejemplo Ficticia', legajo: 'LEG-PRUEBA-0065' },
  registrado_en: '2026-10-05T15:02:11.000Z',
}

async function escanearFoto(page: Page) {
  await page.getByTestId('escaner-foto').setInputFiles(gifDelQr(PAYLOAD_FICTICIO))
}

// ---------------------------------------------------------------------------

test.describe('pantalla inicial', () => {
  test('encabezado, controles, nombres accesibles y área táctil de al menos 44 px', async ({ page }) => {
    await irA(page)
    await expect(page.getByRole('heading', { name: 'Registrar accesos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '1. ¿Qué servicio estás controlando?' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '2. Leé el código QR' })).toBeVisible()
    await expect(page.getByLabel('Comedor', { exact: true })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Escanear con la cámara' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Usar una foto del QR' })).toBeEnabled()
    await expect(page.getByText('Usá la cámara o sacale una foto al código. La imagen se procesa en este dispositivo y no se guarda.')).toBeVisible()

    await exigirAlMenos44(page.locator('label:has(input[type="radio"]), button').filter({ visible: true }), 'controles del escáner')
    // El video existe (la cámara tiene dónde mostrarse) pero no es visible hasta que arranca.
    await expect(page.getByTestId('escaner-vista-camara')).toHaveClass(/sr-only/)
    await sinDesbordeHorizontal(page)
    await captura(page, 'inicio')
  })

  test('a 375 px de ancho no hay desborde horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await irA(page)
    await sinDesbordeHorizontal(page)
    await page.getByLabel('Transporte', { exact: true }).check()
    await sinDesbordeHorizontal(page)
    await captura(page, 'transporte-375')
  })

  test('sin controles anidados, sin detalle técnico y con contraste AA', async ({ page }) => {
    await irA(page)
    await exigirSinControlesAnidados(page, 'escáner')
    await exigirPantallaSinDetalleTecnico(page, 'escáner')
    await exigirContraste(page, 'escáner', { esenciales: ['h1', 'h2', 'label', 'p'], minimoMedidos: 6 })
  })

  test('transporte: recorrido y sentido son obligatorios y se explica por qué falta algo', async ({ page }) => {
    await irA(page)
    await page.getByLabel('Transporte', { exact: true }).check()
    const camara = page.getByRole('button', { name: 'Escanear con la cámara' })
    const foto = page.getByRole('button', { name: 'Usar una foto del QR' })
    await expect(camara).toBeDisabled()
    await expect(foto).toBeDisabled()
    await expect(page.getByText('Elegí el recorrido y el sentido para habilitar la lectura.')).toBeVisible()
    await page.getByLabel('Recorrido donde estás escaneando').selectOption({ label: 'Recorrido Norte (ficticio)' })
    await expect(foto).toBeDisabled()
    await page.getByLabel('Vuelta', { exact: true }).check()
    await expect(foto).toBeEnabled()
    await expect(camara).toBeEnabled()
    // El recorrido lo elige el operador entre los servicios activos; nunca un identificador libre.
    const opciones = await page.getByLabel('Recorrido donde estás escaneando').locator('option').allInnerTexts()
    expect(opciones).toEqual(['Elegí un recorrido', 'Recorrido Norte (ficticio)', 'Recorrido Sur (ficticio)'])
    await exigirAlMenos44(page.getByLabel('Recorrido donde estás escaneando'), 'selector de recorrido')
  })

  test('sin servicio de comedor activo el comedor no se ofrece', async ({ page }) => {
    await irA(page, 'sin-comedor')
    await expect(page.getByLabel('Comedor', { exact: true })).toBeDisabled()
    await expect(page.getByLabel('Transporte', { exact: true })).toBeChecked()
  })

  test('el teclado recorre la pantalla completa en un orden lógico', async ({ page }) => {
    await irA(page)
    const orden: string[] = []
    await page.getByLabel('Comedor', { exact: true }).focus()
    for (let i = 0; i < 6; i += 1) {
      orden.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          return el ? `${el.tagName}:${el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.getAttribute('type') ?? ''}` : ''
        })
      )
      await page.keyboard.press('Tab')
    }
    // Radio de servicio → (el radio de transporte se alcanza con flechas) → cámara → foto.
    expect(orden[0]).toContain('INPUT')
    expect(orden.join('|')).toMatch(/Escanear con la cámara/)
    expect(orden.join('|').indexOf('Escanear con la cámara')).toBeLessThan(orden.join('|').indexOf('Usar una foto del QR'))
  })
})

// ---------------------------------------------------------------------------

test.describe('resultados del escaneo por foto', () => {
  test('REGISTRADO: muestra nombre, apellido, legajo y hora; región cortés; foco al título; datos ocultos a los 5 s', async ({ page }) => {
    const peticiones = await simular(page, { estado: 200, cuerpo: REGISTRADO })
    await irA(page)
    await escanearFoto(page)

    const exito = page.locator('[role="status"][aria-live="polite"]').getByTestId('escaner-resultado')
    await expect(exito.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()
    await expect(exito.getByRole('heading', { name: 'Acceso registrado' })).toBeFocused()
    const datos = exito.getByTestId('escaner-datos')
    await expect(datos).toContainText('Lucía Ejemplo Ficticia')
    await expect(datos).toContainText('LEG-PRUEBA-0065')
    // Hora de Buenos Aires (UTC−3): 15:02:11Z → 12:02:11.
    await expect(datos).toContainText('12:02:11')
    // No depende solo del color: hay icono (decorativo) y un título textual.
    await expect(exito.locator('svg[aria-hidden="true"]').first()).toBeVisible()
    await captura(page, 'registrado')

    // La petición lleva el payload COMPLETO, un UUID por intento y el servicio elegido; nada más.
    expect(peticiones).toHaveLength(1)
    expect(Object.keys(peticiones[0]).sort()).toEqual(['intento_id', 'payload', 'servicio_id'])
    expect(peticiones[0].payload).toBe(PAYLOAD_FICTICIO)
    expect(peticiones[0].intento_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(peticiones[0].servicio_id).toBe('e0000000-0000-4000-8000-000000000010')

    // Pasados ~5 segundos los datos personales ya no están en pantalla.
    await expect(page.getByTestId('escaner-datos-ocultos')).toBeVisible({ timeout: 9_000 })
    await expect(page.getByText('Lucía')).toHaveCount(0)
    await expect(exito.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()

    // Ni el payload ni el resultado quedan en el almacenamiento ni en la URL.
    const rastro = await page.evaluate(() => {
      const claves = [localStorage, sessionStorage].flatMap((a) => Array.from({ length: a.length }, (_, i) => `${a.key(i)}=${a.getItem(a.key(i) as string)}`))
      return [location.href, document.cookie, ...claves].join('\n')
    })
    expect(rastro).not.toMatch(/EPT1\.|Lucía|LEG-PRUEBA/)
  })

  test('el transporte envía el recorrido y el sentido declarados por el operador', async ({ page }) => {
    const peticiones = await simular(page, { estado: 200, cuerpo: REGISTRADO })
    await irA(page)
    await page.getByLabel('Transporte', { exact: true }).check()
    await page.getByLabel('Recorrido donde estás escaneando').selectOption({ label: 'Recorrido Sur (ficticio)' })
    await page.getByLabel('Ida', { exact: true }).check()
    await escanearFoto(page)
    await expect(page.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()
    expect(peticiones[0]).toMatchObject({
      servicio_id: 'e0000000-0000-4000-8000-000000000021',
      sentido: 'IDA',
    })
  })

  for (const [codigo, titulo, mensaje] of [
    ['YA_REGISTRADO', 'Ya registrado hoy', /ya se registró hoy/],
    ['NO_HABILITADO', 'No habilitado', /No habilitado para este servicio/],
    ['NO_RECONOCIDO', 'Código QR no reconocido', /No reconocemos este código QR/],
  ] as const) {
    test(`${codigo}: región asertiva, sin datos de la persona y con «Escanear siguiente»`, async ({ page }) => {
      await simular(page, { estado: 200, cuerpo: { codigo, mensaje: 'texto del servidor' } })
      await irA(page)
      await escanearFoto(page)
      const rechazo = page.locator('[role="alert"][aria-live="assertive"]').getByTestId('escaner-resultado')
      await expect(rechazo.getByRole('heading', { name: titulo })).toBeVisible()
      await expect(rechazo.getByRole('heading', { name: titulo })).toBeFocused()
      // El texto de pantalla es el del catálogo local, no el que mande la red.
      await expect(rechazo).toContainText(mensaje)
      expect(await rechazo.innerText()).not.toMatch(/Lucía|Ejemplo|LEG-|revocad|inactiv|bloquead|inscri|recorrido/i)
      await expect(rechazo.getByRole('button', { name: 'Escanear siguiente' })).toBeVisible()
      await exigirAlMenos44(rechazo.getByRole('button'), codigo)
      if (codigo === 'NO_HABILITADO') await captura(page, 'no-habilitado')
    })
  }

  test('«Escanear siguiente» limpia el resultado y devuelve el foco a la lectura', async ({ page }) => {
    await simular(page, { estado: 200, cuerpo: REGISTRADO })
    await irA(page)
    await escanearFoto(page)
    await expect(page.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()
    await page.getByRole('button', { name: 'Escanear siguiente' }).click()
    await expect(page.getByTestId('escaner-resultado')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Usar una foto del QR' })).toBeFocused()
    await expect(page.getByText('Lucía')).toHaveCount(0)
  })

  test('una respuesta fuera del conjunto cerrado nunca se muestra como aprobación', async ({ page }) => {
    for (const cuerpo of [{ codigo: 'APROBADO', mensaje: 'ok' }, { mensaje: 'ok' }, { codigo: 'REGISTRADO' }]) {
      await page.unroute(REGISTRO).catch(() => undefined)
      await simular(page, { estado: 200, cuerpo })
      await irA(page)
      await escanearFoto(page)
      await expect(page.getByRole('heading', { name: 'No se pudo registrar' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Acceso registrado' })).toHaveCount(0)
    }
  })

  test('una fotografía sin QR o un archivo que no es imagen no envía nada', async ({ page }) => {
    const peticiones = await simular(page, { estado: 200, cuerpo: REGISTRADO })
    await irA(page)
    const entrada = page.getByTestId('escaner-foto')
    await entrada.setInputFiles({
      name: 'sin-qr.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
    })
    const aviso = page.getByTestId('escaner-ilegible')
    await expect(aviso).toBeVisible()
    await expect(aviso).toHaveAttribute('role', 'alert')
    await expect(aviso).toContainText('No pudimos leer un código QR en la imagen')
    await captura(page, 'qr-ilegible')

    await entrada.setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('no es una imagen') })
    await expect(aviso).toBeVisible()
    expect(peticiones).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

test.describe('errores de red y límites', () => {
  test('429: informa la espera, no ofrece reintento inmediato y no acusa una falla', async ({ page }) => {
    await simular(page, {
      estado: 429,
      cuerpo: { error: 'Hiciste demasiados intentos en poco tiempo. Esperá unos minutos antes de volver a escanear.', codigo: 'LIMITE_EXCEDIDO', reintentar_en_segundos: 840 },
      cabeceras: { 'retry-after': '840' },
    })
    await irA(page)
    await escanearFoto(page)
    const rechazo = page.locator('[role="alert"][aria-live="assertive"]').getByTestId('escaner-resultado')
    await expect(rechazo.getByRole('heading', { name: 'Demasiados intentos' })).toBeVisible()
    await expect(rechazo).toContainText('Volvé a intentar en unos 14 minutos')
    await expect(rechazo.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    await captura(page, 'limite')
  })

  test('un corte de red conserva el MISMO intento: «Reintentar» no duplica ni crea un escaneo nuevo', async ({ page }) => {
    const peticiones: Capturado[] = []
    let intentos = 0
    await page.route(REGISTRO, async (ruta) => {
      peticiones.push(ruta.request().postDataJSON() as Capturado)
      intentos += 1
      if (intentos === 1) return ruta.abort('timedout')
      return ruta.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(REGISTRADO) })
    })
    await irA(page)
    await escanearFoto(page)

    const alerta = page.locator('[role="alert"][aria-live="assertive"]').getByTestId('escaner-resultado')
    await expect(alerta.getByRole('heading', { name: 'No se pudo registrar' })).toBeVisible()
    await expect(alerta).toContainText('Revisá tu conexión')
    await captura(page, 'sin-conexion')
    await alerta.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()

    expect(peticiones).toHaveLength(2)
    expect(peticiones[1].intento_id, 'el reintento reutiliza el intento').toBe(peticiones[0].intento_id)
    expect(peticiones[1].payload).toBe(peticiones[0].payload)
    expect(peticiones[1].servicio_id).toBe(peticiones[0].servicio_id)
  })

  test('504 (tiempo agotado) y 503 (no disponible) son reintentables; 401 y 409 no', async ({ page }) => {
    for (const [estado, codigo, reintentable] of [
      [504, 'TIEMPO_AGOTADO', true],
      [503, 'SERVICIO_NO_DISPONIBLE', true],
      [401, 'NO_AUTENTICADO', false],
      [409, 'INTENTO_REUTILIZADO', false],
      [500, 'ERROR_INTERNO', false],
    ] as const) {
      await page.unroute(REGISTRO).catch(() => undefined)
      await simular(page, { estado, cuerpo: { error: 'Mensaje de la API en español.', codigo } })
      await irA(page)
      await escanearFoto(page)
      const alerta = page.locator('[role="alert"][aria-live="assertive"]').getByTestId('escaner-resultado')
      await expect(alerta.getByRole('heading', { name: 'No se pudo registrar' }), String(estado)).toBeVisible()
      await expect(alerta).toContainText('Mensaje de la API en español.')
      await expect(alerta.getByRole('button', { name: 'Reintentar' }), String(estado)).toHaveCount(reintentable ? 1 : 0)
    }
  })

  test('mientras se envía hay un aviso de estado y los controles quedan bloqueados', async ({ page }) => {
    let liberar: () => void = () => undefined
    const espera = new Promise<void>((resolver) => {
      liberar = resolver
    })
    await page.route(REGISTRO, async (ruta) => {
      await espera
      await ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REGISTRADO) })
    })
    await irA(page)
    await escanearFoto(page)
    await expect(page.getByText('Registrando el acceso…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Usar una foto del QR' })).toBeDisabled()
    await expect(page.getByLabel('Transporte', { exact: true })).toBeDisabled()
    await captura(page, 'enviando')
    liberar()
    await expect(page.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------

/** Cámara simulada: cada flujo es un canvas real, con pistas cuyo `stop` se registra. */
async function simularCamara(page: Page, comportamiento: 'ok' | 'denegada' | 'sin-camara' | 'colgada' | 'ocupada') {
  await page.addInitScript((modo) => {
    const registro = { flujos: [] as MediaStream[], pedidos: 0 }
    ;(window as unknown as { __camara: typeof registro }).__camara = registro
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          registro.pedidos += 1
          if (modo === 'denegada') return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
          if (modo === 'sin-camara') return Promise.reject(new DOMException('Requested device not found', 'NotFoundError'))
          if (modo === 'ocupada') return Promise.reject(new DOMException('Could not start video source', 'NotReadableError'))
          if (modo === 'colgada') return new Promise(() => undefined)
          const lienzo = document.createElement('canvas')
          lienzo.width = 320
          lienzo.height = 240
          const contexto = lienzo.getContext('2d')!
          // Se dibuja de forma continua: WebKit no entrega cuadros de un canvas que no cambia.
          let tono = 0
          const pintar = () => {
            tono = (tono + 7) % 200
            contexto.fillStyle = `rgb(${tono + 30}, ${tono + 30}, ${tono + 30})`
            contexto.fillRect(0, 0, 320, 240)
          }
          pintar()
          const reloj = setInterval(pintar, 40)
          const flujo = lienzo.captureStream(15)
          flujo.getTracks().forEach((pista) => pista.addEventListener('ended', () => clearInterval(reloj)))
          const detenerOriginal = flujo.getTracks().map((pista) => pista.stop.bind(pista))
          flujo.getTracks().forEach((pista, i) => {
            pista.stop = () => {
              clearInterval(reloj)
              detenerOriginal[i]()
            }
          })
          registro.flujos.push(flujo)
          return Promise.resolve(flujo)
        },
      },
    })
  }, comportamiento)
}

const estadoDePistas = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __camara: { flujos: MediaStream[] } }).__camara.flujos.flatMap((f) => f.getTracks().map((p) => p.readyState))
  )

test.describe('cámara: permisos, errores y liberación de recursos', () => {
  test('permiso denegado: mensaje en español, sin cámara activa y con la foto como alternativa', async ({ page }) => {
    await simularCamara(page, 'denegada')
    await irA(page)
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    const estado = page.getByTestId('escaner-estado-camara')
    await expect(estado.getByRole('alert')).toContainText('El navegador no permitió usar la cámara')
    await expect(page.getByRole('button', { name: 'Usar una foto del QR' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Escanear con la cámara' })).toBeEnabled()
    await captura(page, 'camara-denegada')
  })

  test('sin dispositivo o dispositivo ocupado: mensajes específicos', async ({ page }) => {
    await simularCamara(page, 'sin-camara')
    await irA(page)
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('No encontramos una cámara en este dispositivo')

    const otra = await page.context().newPage()
    await simularCamara(otra, 'ocupada')
    await irA(otra)
    await otra.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(otra.getByTestId('escaner-estado-camara').getByRole('alert')).toContainText('No pudimos iniciar la cámara')
    await otra.close()
  })

  test('sin contexto seguro la cámara ni se intenta y se ofrece la foto', async ({ page }) => {
    await simularCamara(page, 'ok')
    await page.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false }))
    await irA(page)
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('La cámara solo funciona en una conexión segura (HTTPS)')
    expect(await page.evaluate(() => (window as unknown as { __camara: { pedidos: number } }).__camara.pedidos)).toBe(0)
  })

  test('sin la API de cámara del navegador: mensaje de «sin cámara»', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }))
    await irA(page)
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('No encontramos una cámara en este dispositivo')
  })

  test('un permiso que nunca se responde vence con tiempo máximo y permite reintentar', async ({ page }) => {
    await simularCamara(page, 'colgada')
    await page.clock.install()
    await irA(page)
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('Esperando el permiso de la cámara')
    await expect(page.getByRole('button', { name: 'Detener la cámara' })).toBeVisible()
    await page.clock.fastForward(21_000)
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('No recibimos respuesta del aviso de permiso')
    await expect(page.getByRole('button', { name: 'Reintentar cámara' })).toBeVisible()
    await captura(page, 'camara-tiempo')
  })

  test('la cámara activa se detiene con «Detener», al cambiar de modo y al ocultarse la pestaña', async ({ page }) => {
    // Playwright WebKit (Windows/Linux) no implementa MediaStream ni canvas.captureStream: la cámara
    // ACTIVA solo se puede simular en Chromium. Los estados de permiso y error sí corren en WebKit.
    test.skip(
      await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream !== 'function'),
      'este navegador de pruebas no implementa MediaStream: la cámara activa se prueba en Chromium'
    )
    await simularCamara(page, 'ok')
    await irA(page)

    // 1. Detener manualmente.
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('Cámara activa')
    await expect(page.getByTestId('escaner-vista-camara')).not.toHaveClass(/sr-only/)
    await page.getByRole('button', { name: 'Detener la cámara' }).click()
    expect(await estadoDePistas(page)).toEqual(['ended'])
    await expect(page.getByRole('button', { name: 'Escanear con la cámara' })).toBeVisible()

    // 2. Cambiar de modo (comedor → transporte).
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('Cámara activa')
    await page.getByLabel('Transporte', { exact: true }).check()
    await expect.poll(() => estadoDePistas(page)).toEqual(['ended', 'ended'])
    await expect(page.getByTestId('escaner-estado-camara')).not.toContainText('Cámara activa')

    // 3. Ocultar la pestaña.
    await page.getByLabel('Comedor', { exact: true }).check()
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()
    await expect(page.getByTestId('escaner-estado-camara')).toContainText('Cámara activa')
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => estadoDePistas(page)).toEqual(['ended', 'ended', 'ended'])
    await expect(page.getByRole('button', { name: 'Escanear con la cámara' })).toBeVisible()
    // Una cámara detenida no queda reteniendo el flujo en el video.
    expect(await page.evaluate(() => document.querySelector('video')?.srcObject ?? null)).toBeNull()
  })

  test('un clic duplicado en «Escanear con la cámara» no deja flujos huérfanos', async ({ page }) => {
    // Playwright WebKit (Windows/Linux) no implementa MediaStream ni canvas.captureStream: la cámara
    // ACTIVA solo se puede simular en Chromium. Los estados de permiso y error sí corren en WebKit.
    test.skip(
      await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream !== 'function'),
      'este navegador de pruebas no implementa MediaStream: la cámara activa se prueba en Chromium'
    )
    await simularCamara(page, 'ok')
    await irA(page)
    const boton = page.getByRole('button', { name: 'Escanear con la cámara' })
    // El segundo toque cae sobre «Detener la cámara» (el botón cambia al instante): la cámara
    // queda detenida y NINGÚN flujo queda abierto, termine donde termine la carrera.
    await boton.dblclick()
    await page.waitForTimeout(500)
    const detener = page.getByRole('button', { name: 'Detener la cámara' })
    if (await detener.isVisible()) await detener.click()
    await expect.poll(async () => (await estadoDePistas(page)).every((e) => e === 'ended')).toBe(true)
    expect(await page.evaluate(() => document.querySelector('video')?.srcObject ?? null)).toBeNull()
    await expect(page.getByRole('button', { name: 'Escanear con la cámara' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------

const FILAS_DE_AUDITORIA = 3

test.describe('auditoría de Dirección', () => {
  test('lista, motivo interno, estados y accesibilidad', async ({ page }) => {
    await irA(page, 'auditoria')
    await expect(page.getByRole('heading', { name: 'Auditoría de accesos' })).toBeVisible()
    await expect(page.getByTestId('auditoria-total')).toContainText('31 accesos el 05/10/2026. Página 1 de 2.')
    const filas = page.getByTestId('auditoria-fila')
    await expect(filas).toHaveCount(FILAS_DE_AUDITORIA)
    await expect(filas.nth(0)).toContainText('Ejemplo Ficticia, Lucía')
    await expect(filas.nth(1)).toContainText('Motivo interno: Sin inscripción activa')
    await expect(filas.nth(2)).toContainText('Anulado')
    await expect(filas.nth(2)).toContainText('Motivo de la anulación: Se escaneó la credencial de otra persona')
    // Solo el registrado y vigente se puede anular.
    await expect(page.getByRole('button', { name: /^Anular el acceso de las/ })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Siguiente' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Anterior' })).toHaveCount(0)
    await exigirAlMenos44(page.locator('button, a, input, select').filter({ visible: true }), 'auditoría')
    await sinDesbordeHorizontal(page)
    await exigirSinControlesAnidados(page, 'auditoría')
    await exigirContraste(page, 'auditoría', { esenciales: ['h1', 'li p'], minimoMedidos: 8 })
    await captura(page, 'auditoria')
  })

  test('a 375 px la auditoría no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await irA(page, 'auditoria')
    await sinDesbordeHorizontal(page)
  })

  test('el diálogo de anulación: foco inicial, validación, Escape y retorno del foco al disparador', async ({ page }) => {
    await irA(page, 'auditoria')
    const disparador = page.getByRole('button', { name: /^Anular el acceso de las/ })
    await disparador.click()
    const dialogo = page.getByRole('dialog', { name: 'Anular un acceso registrado' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel(/Motivo/)).toBeFocused()
    await captura(page, 'anular-dialogo', false)

    await dialogo.getByLabel(/Motivo/).fill('ab')
    await dialogo.getByRole('button', { name: 'Anular acceso' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('El motivo debe tener entre 3 y 200 caracteres.')
    await expect(dialogo.getByLabel(/Motivo/)).toHaveAttribute('aria-invalid', 'true')

    // El Tab no escapa del diálogo.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab')
    expect(await dialogo.evaluate((el) => el.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(disparador).toBeFocused()
  })

  test('anular con motivo válido llama a la API con el motivo y muestra el aviso', async ({ page }) => {
    const pedidos: Array<{ url: string; cuerpo: unknown }> = []
    await page.route('**/api/accesos-servicios/*/anulacion', async (ruta) => {
      pedidos.push({ url: ruta.request().url(), cuerpo: ruta.request().postDataJSON() })
      await ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ acceso: { id: 'x', anulado: true } }) })
    })
    await irA(page, 'auditoria')
    await page.getByRole('button', { name: /^Anular el acceso de las/ }).click()
    const dialogo = page.getByRole('dialog', { name: 'Anular un acceso registrado' })
    await dialogo.getByLabel(/Motivo/).fill('  Se escaneó la credencial equivocada  ')
    await dialogo.getByRole('button', { name: 'Anular acceso' }).click()
    await expect(page.getByTestId('auditoria-aviso')).toContainText('Acceso anulado')
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].url).toContain('/api/accesos-servicios/f0000000-0000-4000-8000-000000000001/anulacion')
    // El motivo se recorta en el cliente; el identificador viaja en la ruta, el actor NO viaja.
    expect(pedidos[0].cuerpo).toEqual({ motivo: 'Se escaneó la credencial equivocada' })
  })

  test('un rechazo de la API se muestra en el diálogo en español, sin detalle técnico', async ({ page }) => {
    await page.route('**/api/accesos-servicios/*/anulacion', (ruta) =>
      ruta.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Este acceso ya estaba anulado.', codigo: 'ACCESO_YA_ANULADO' }) })
    )
    await irA(page, 'auditoria')
    await page.getByRole('button', { name: /^Anular el acceso de las/ }).click()
    const dialogo = page.getByRole('dialog', { name: 'Anular un acceso registrado' })
    await dialogo.getByLabel(/Motivo/).fill('Motivo válido')
    await dialogo.getByRole('button', { name: 'Anular acceso' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('Este acceso ya estaba anulado.')
    await exigirPantallaSinDetalleTecnico(page, 'rechazo de anulación')
  })
})
