import { expect, test, type Locator, type Page } from '@playwright/test'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirContraste } from './_contraste'
import { exigirSinControlesAnidados } from './_semantica'

/**
 * Interfaz de administración de inscripciones (EPT-62, RF16) con datos
 * deterministas y API interceptada, sin base.
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales; las aserciones se
 * adaptan a lo que hay en pantalla (tabla desde 1280 px, tarjetas debajo).
 *
 * Lo que demuestran estas pruebas es PRESENTACIÓN: estados, textos, foco,
 * anuncios y responsive. No demuestran persistencia ni autorización: eso lo
 * prueban `inscripciones-administracion-e2e-auth.spec.ts` (sesiones reales) y
 * `inscripciones-administracion-auth.spec.ts` (API).
 */

const ESCRITORIO = { width: 1280, height: 900 }
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

/** El perfil táctil de WebKit no mueve el foco al pulsar ni recorre con Tab. */
function hayTeclado(page: Page) {
  return page.context().browser()?.browserType().name() !== 'webkit'
}

/** Una sola captura por perfil: el iPhone repetiría la del Pixel con otro motor. */
async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR || !hayTeclado(page)) return
  const perfil = esMovil(page) ? 'movil' : 'escritorio'
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-62/capturas', `ui-${perfil}-${nombre}.png`)
  )
}

function aplicacion(page: Page) {
  return page.getByRole('main')
}

async function hayScrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
}

type Area = {
  clave: 'comedor' | 'transporte' | 'deportes'
  ruta: string
  titulo: string
  /** Alumno cuya inscripción vigente está SIN confirmar. */
  alumnoSinConfirmar: string
  idSinConfirmar: string
  /** Cómo nombra el diálogo al servicio o al grupo. */
  descripcion: string
  /** Texto exacto de una confirmación registrada en el banco. */
  confirmacion: RegExp
  /** Cómo llama la pantalla al filtro de las inscripciones canceladas. */
  filtroCanceladas: string
}

const AREAS: Area[] = [
  {
    clave: 'comedor',
    ruta: '/pruebas-ui/comedor?vista=director',
    titulo: 'Comedor',
    alumnoSinConfirmar: 'Estudiante, Beto',
    idSinConfirmar: '11111111-1111-4111-8111-111111111111',
    descripcion: 'Comedor escolar',
    confirmacion: /Confirmada por Dora Directora el 11\/09\/2026,? 11:05/,
    filtroCanceladas: 'Bajas',
  },
  {
    clave: 'transporte',
    ruta: '/pruebas-ui/transporte?vista=director',
    titulo: 'Transporte',
    alumnoSinConfirmar: 'Estudiante, Beto',
    idSinConfirmar: '11111111-1111-4111-8111-111111111111',
    descripcion: 'Recorrido Norte (ficticio) (TR-NORTE)',
    confirmacion: /Confirmada por Dora Directora el 11\/09\/2026,? 11:05/,
    filtroCanceladas: 'Canceladas',
  },
  {
    clave: 'deportes',
    ruta: '/pruebas-ui/deportes?vista=director',
    titulo: 'Deportes',
    alumnoSinConfirmar: 'Estudiante, Beto',
    idSinConfirmar: 'aaaaaaaa-1111-4111-8111-111111111111',
    descripcion: 'Natación (Primario)',
    confirmacion: /Confirmada por Dora Directora el 22\/09\/2026,? 11:05/,
    filtroCanceladas: 'Canceladas',
  },
]

const CONFIRMACION_NUEVA = {
  ok: true,
  confirmacion: {
    dominio: 'SERVICIO',
    inscripcion_id: '11111111-1111-4111-8111-111111111111',
    confirmada_en: '2026-09-28T15:30:00.000Z',
    confirmada_por_nombre: 'Dora',
    ya_confirmada: false,
  },
}

const CONFIRMACION_REPETIDA = {
  ok: true,
  confirmacion: { ...CONFIRMACION_NUEVA.confirmacion, ya_confirmada: true },
}

const CANCELACION = {
  ok: true,
  inscripcion: {
    id: '11111111-1111-4111-8111-111111111111',
    estado: 'CANCELADA',
    fecha_cancelacion: '2026-09-28T15:30:00.000Z',
  },
}

type Respuesta =
  | { estado: number; cuerpo: unknown; demoraMs?: number }
  | { abortar: true }

/** Intercepta la API de administración y registra cada llamada. */
async function simularApi(page: Page, respuesta: Respuesta) {
  const llamadas: { url: string; metodo: string; cuerpo: string | null }[] = []
  await page.route('**/api/inscripciones/**', async (ruta) => {
    llamadas.push({
      url: new URL(ruta.request().url()).pathname,
      metodo: ruta.request().method(),
      cuerpo: ruta.request().postData(),
    })
    if ('abortar' in respuesta) {
      await ruta.abort()
      return
    }
    if (respuesta.demoraMs) await new Promise((r) => setTimeout(r, respuesta.demoraMs))
    await ruta.fulfill({
      status: respuesta.estado,
      contentType: 'application/json',
      body: JSON.stringify(respuesta.cuerpo),
    })
  })
  return llamadas
}

/** Filas de inscripciones visibles: de la tabla en escritorio, tarjetas debajo. */
function filas(page: Page): Locator {
  return page
    .locator('tbody tr, li')
    .filter({ hasText: /Legajo|LEG-/ })
    .filter({ visible: true })
}

/**
 * Textos esenciales de la lista para la auditoría de contraste. Tabla y tarjetas
 * conviven en el DOM y una de las dos está oculta, así que se nombra la que se ve.
 */
async function esencialesDeLista(page: Page) {
  const conTabla = await page.getByRole('table').isVisible()
  return ['h1', conTabla ? 'main table button' : 'main li button[aria-label*="inscripción de"]']
}

test.describe('administración de inscripciones: pantallas de Dirección', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  for (const area of AREAS) {
    test.describe(area.titulo, () => {
      test('muestra el estado vigente y la confirmación como dos datos distintos', async ({
        page,
      }) => {
        await page.goto(area.ruta)

        await expect(page.getByRole('heading', { name: area.titulo, level: 1 })).toBeVisible()

        // Una inscripción vigente sin confirmar sigue siendo Activa.
        const sinConfirmar = filas(page).filter({ hasText: 'Sin confirmar' }).first()
        await expect(sinConfirmar).toContainText('Activa')
        await expect(sinConfirmar).not.toContainText('Cancelada')

        // Una confirmada dice quién y cuándo.
        await expect(page.getByText(area.confirmacion).filter({ visible: true }).first()).toBeVisible()

        // Nunca se presenta como pendiente de activación ni como no válida.
        const texto = await aplicacion(page).innerText()
        expect(texto).not.toMatch(/pendiente de activaci[oó]n|no v[aá]lida/i)
        // Ninguna inscripción se presenta como inactiva: solo Activa o Cancelada.
        for (const fila of await filas(page).allInnerTexts()) {
          expect(fila).not.toMatch(/inactiv/i)
        }

        expect(await hayScrollHorizontal(page)).toBe(false)
        await capturar(page, `${area.clave}-director`)
      })

      test('cumple contraste AA, no anida controles y no muestra texto en inglés', async ({
        page,
      }) => {
        await page.goto(area.ruta)
        await expect(page.getByRole('heading', { name: area.titulo, level: 1 })).toBeVisible()

        await exigirContraste(page, `${area.titulo}: lista de inscripciones`, {
          raiz: 'main',
          esenciales: await esencialesDeLista(page),
          minimoMedidos: 10,
        })
        await exigirSinControlesAnidados(page, area.titulo, 'main')

        const texto = (await aplicacion(page).innerText()).toLowerCase()
        for (const palabra of ['loading', 'submit', 'delete', 'pending', 'confirmed', 'undefined', 'null']) {
          expect(texto, `no debe mostrar "${palabra}"`).not.toContain(palabra)
        }
      })

      test('filtra por confirmación además del estado', async ({ page }) => {
        await page.goto(area.ruta)

        const filtro = page.getByLabel('Confirmación', { exact: true })
        await expect(filtro).toBeVisible()
        await expect(filtro.locator('option')).toHaveText(['Todas', 'Confirmadas', 'Sin confirmar'])

        const todas = await filas(page).count()
        await filtro.selectOption('CONFIRMADAS')
        const confirmadas = await filas(page).count()
        await filtro.selectOption('SIN_CONFIRMAR')
        const sin = await filas(page).count()

        expect(confirmadas).toBeGreaterThan(0)
        expect(sin).toBeGreaterThan(0)
        expect(confirmadas + sin).toBe(todas)
        await expect(filas(page).first()).toContainText('Sin confirmar')

        await filtro.selectOption('CONFIRMADAS')
        await expect(filas(page).first()).toContainText('Confirmada por')
        await capturar(page, `${area.clave}-filtro-confirmacion`)
      })

      test('la cancelada no ofrece acciones y explica por qué no se confirma', async ({ page }) => {
        await page.goto(area.ruta)
        await page.getByRole('button', { name: area.filtroCanceladas, exact: true }).click()

        const cancelada = filas(page).first()
        await expect(cancelada).toContainText('Cancelada')
        await expect(cancelada).toContainText('Sin confirmar')
        await expect(cancelada).toContainText('No se puede confirmar: la inscripción está cancelada.')
        await expect(cancelada).toContainText('Sin acciones')
        await expect(cancelada.getByRole('button')).toHaveCount(0)
        await capturar(page, `${area.clave}-cancelada`)
      })

      test('confirma: envía POST sin cuerpo, anuncia el éxito y devuelve el foco a la fila', async ({
        page,
      }) => {
        const llamadas = await simularApi(page, { estado: 200, cuerpo: CONFIRMACION_NUEVA })
        await page.goto(area.ruta)

        await page
          .getByRole('button', { name: `Confirmar inscripción de ${area.alumnoSinConfirmar}` })
          .click()

        const aviso = page.getByRole('status').filter({ hasText: 'Confirmaste la inscripción' })
        await expect(aviso).toContainText(`Confirmaste la inscripción de ${area.alumnoSinConfirmar}.`)
        await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)

        expect(llamadas).toHaveLength(1)
        expect(llamadas[0]).toMatchObject({
          metodo: 'POST',
          url: `/api/inscripciones/${area.clave}/${area.idSinConfirmar}/confirmacion`,
          cuerpo: null,
        })

        // Tras releer, el foco vuelve a la fila operada: no se pierde en el <body>.
        await expect(page.locator('[data-foco-inscripcion]:focus')).toHaveCount(1)
        await capturar(page, `${area.clave}-confirmada-aviso`)
      })

      test('mientras confirma anuncia el progreso y no admite un segundo envío', async ({ page }) => {
        const llamadas = await simularApi(page, {
          estado: 200,
          cuerpo: CONFIRMACION_NUEVA,
          demoraMs: 700,
        })
        await page.goto(area.ruta)

        const boton = page.getByRole('button', {
          name: `Confirmar inscripción de ${area.alumnoSinConfirmar}`,
        })
        await boton.click()

        await expect(boton).toBeDisabled()
        await expect(boton).toHaveAttribute('aria-busy', 'true')
        await expect(boton).toHaveText('Confirmando…')
        // Se opera de a una: ninguna otra acción está disponible mientras tanto.
        for (const otro of await page
          .getByRole('button', { name: /^(Confirmar|Cancelar) inscripción de/ })
          .all()) {
          await expect(otro).toBeDisabled()
        }

        await expect(page.getByRole('status').filter({ hasText: 'Confirmaste' })).toBeVisible()
        expect(llamadas).toHaveLength(1)
      })

      test('«ya estaba confirmada» se informa sin alarma', async ({ page }) => {
        await simularApi(page, { estado: 200, cuerpo: CONFIRMACION_REPETIDA })
        await page.goto(area.ruta)

        await page
          .getByRole('button', { name: `Confirmar inscripción de ${area.alumnoSinConfirmar}` })
          .click()

        const aviso = page.getByRole('status').filter({ hasText: 'Ya estaba confirmada' })
        await expect(aviso).toContainText('Ya estaba confirmada por Dora el')
        await expect(aviso).toContainText('no se modificó')
        await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)
        await capturar(page, `${area.clave}-ya-confirmada`)
      })

      test('el diálogo de cancelación nombra al alumno, al servicio y la consecuencia, y maneja el foco', async ({
        page,
      }) => {
        const llamadas = await simularApi(page, { estado: 200, cuerpo: CANCELACION })
        await page.goto(area.ruta)

        const disparador = page
          .getByRole('button', { name: `Cancelar inscripción de ${area.alumnoSinConfirmar}` })
          .first()
        await disparador.click()

        const dialogo = page.getByRole('dialog')
        await expect(dialogo).toBeVisible()
        await expect(
          dialogo.getByRole('heading', {
            name: `Cancelar la inscripción de ${area.alumnoSinConfirmar}`,
          })
        ).toBeVisible()
        await expect(dialogo).toContainText(area.descripcion)
        await expect(dialogo).toContainText('Queda cancelada')
        await expect(dialogo).toContainText('se conserva en el historial')
        await expect(dialogo).toContainText('el alumno podrá volver a inscribirse')
        await capturar(page, `${area.clave}-dialogo-cancelacion`)

        if (hayTeclado(page)) {
          // Foco inicial en la acción que no destruye nada, y contención con Tab.
          const volver = dialogo.getByRole('button', { name: 'Volver sin cancelar' })
          await expect(volver).toBeFocused()
          await page.keyboard.press('Tab')
          await expect(
            dialogo.getByRole('button', { name: 'Sí, cancelar inscripción' })
          ).toBeFocused()
          await page.keyboard.press('Tab')
          await expect(dialogo.getByRole('button', { name: 'Cerrar diálogo' })).toBeFocused()
          await page.keyboard.press('Tab')
          await expect(volver).toBeFocused()
        }

        // Escape cierra, devuelve el foco al disparador y no llama a la API.
        await page.keyboard.press('Escape')
        await expect(dialogo).toHaveCount(0)
        if (hayTeclado(page)) await expect(disparador).toBeFocused()
        expect(llamadas).toHaveLength(0)
      })

      test('cancelar en nombre del alumno: cierra el diálogo, anuncia el resultado y llama a la API', async ({
        page,
      }) => {
        const llamadas = await simularApi(page, { estado: 200, cuerpo: CANCELACION })
        await page.goto(area.ruta)

        await page
          .getByRole('button', { name: `Cancelar inscripción de ${area.alumnoSinConfirmar}` })
          .first()
          .click()
        await page.getByRole('button', { name: 'Sí, cancelar inscripción' }).click()

        await expect(page.getByRole('dialog')).toHaveCount(0)
        const aviso = page.getByRole('status').filter({ hasText: 'Cancelaste la inscripción' })
        await expect(aviso).toContainText(`Cancelaste la inscripción de ${area.alumnoSinConfirmar}`)
        await expect(aviso).toContainText('Se conserva en el historial')

        expect(llamadas).toHaveLength(1)
        expect(llamadas[0]).toMatchObject({
          metodo: 'POST',
          url: `/api/inscripciones/${area.clave}/${area.idSinConfirmar}/cancelacion`,
        })
        await capturar(page, `${area.clave}-cancelada-aviso`)
      })
    })
  }
})

test.describe('administración de inscripciones: errores y estados', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  const RUTA = '/pruebas-ui/comedor?vista=director'
  const CONFIRMAR = 'Confirmar inscripción de Estudiante, Beto'

  const FALLOS: {
    nombre: string
    respuesta: Respuesta
    texto: RegExp
    enlaceInicio?: boolean
  }[] = [
    {
      nombre: 'sesión vencida (401) invita a iniciar sesión',
      respuesta: {
        estado: 401,
        cuerpo: { error: 'Necesitás iniciar sesión para continuar.', codigo: 'SIN_SESION' },
      },
      texto: /Tu sesión venció\. Iniciá sesión nuevamente para continuar\./,
      enlaceInicio: true,
    },
    {
      nombre: 'cuenta bloqueada (403 ACCESO_BLOQUEADO)',
      respuesta: {
        estado: 403,
        cuerpo: { error: 'Tu acceso está bloqueado. Comunicate con Dirección.', codigo: 'ACCESO_BLOQUEADO' },
      },
      texto: /Tu acceso está bloqueado\. Comunicate con Dirección\./,
    },
    {
      nombre: 'sin permiso (403)',
      respuesta: {
        estado: 403,
        cuerpo: { error: 'Solo Dirección puede administrar las inscripciones.', codigo: 'ACCESO_DENEGADO' },
      },
      texto: /Solo Dirección puede administrar las inscripciones\./,
    },
    {
      nombre: 'inscripción inexistente (404)',
      respuesta: {
        estado: 404,
        cuerpo: { error: 'No encontramos la inscripción al comedor solicitada.', codigo: 'INSCRIPCION_NO_ENCONTRADA' },
      },
      texto: /No encontramos la inscripción al comedor solicitada\./,
    },
    {
      nombre: 'conflicto de concurrencia (409)',
      respuesta: {
        estado: 409,
        cuerpo: {
          error: 'Otra operación estaba modificando esta inscripción al mismo tiempo. Revisá su estado y reintentá.',
          codigo: 'CONFLICTO_CONCURRENCIA',
        },
      },
      texto: /Otra operación estaba modificando esta inscripción al mismo tiempo\./,
    },
    {
      nombre: 'inscripción cancelada mientras tanto (409)',
      respuesta: {
        estado: 409,
        cuerpo: { error: 'La inscripción está cancelada y no puede confirmarse.', codigo: 'INSCRIPCION_NO_VIGENTE' },
      },
      texto: /La inscripción está cancelada y no puede confirmarse\./,
    },
    {
      nombre: 'error del servidor (500)',
      respuesta: {
        estado: 500,
        cuerpo: { error: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.', codigo: 'ERROR_INTERNO' },
      },
      texto: /No pudimos completar la operación\. Volvé a intentarlo en unos minutos\./,
    },
    {
      nombre: 'sin conexión',
      respuesta: { abortar: true },
      texto: /No pudimos comunicarnos con el servidor\. Revisá tu conexión y volvé a intentarlo\./,
    },
  ]

  for (const fallo of FALLOS) {
    test(`confirmar: ${fallo.nombre}`, async ({ page }) => {
      await simularApi(page, fallo.respuesta)
      await page.goto(RUTA)

      await page.getByRole('button', { name: CONFIRMAR }).click()

      const alerta = aplicacion(page).getByRole('alert')
      await expect(alerta).toBeVisible()
      // La sesión vencida no se atribuye a una inscripción: solo invita a volver a entrar.
      if (!fallo.enlaceInicio) {
        await expect(alerta).toContainText('No pudimos confirmar la inscripción de Estudiante, Beto.')
      }
      await expect(alerta).toContainText(fallo.texto)
      // Sin detalle técnico: ni códigos, ni SQLSTATE, ni nombres de funciones.
      await expect(alerta).not.toContainText(/P6\d{3}|SQLSTATE|rpc|jsonb|undefined|null/i)

      const enlace = alerta.getByRole('link', { name: 'Iniciar sesión' })
      if (fallo.enlaceInicio) await expect(enlace).toHaveAttribute('href', '/login')
      else await expect(enlace).toHaveCount(0)

      // Tras un error, la persona puede reintentar: el botón vuelve a estar habilitado.
      await expect(page.getByRole('button', { name: CONFIRMAR })).toBeEnabled()
      if (fallo.nombre.startsWith('sesión')) await capturar(page, 'error-sesion-vencida')
      if (fallo.nombre.startsWith('cuenta')) await capturar(page, 'error-cuenta-bloqueada')
      if (fallo.nombre.startsWith('conflicto')) await capturar(page, 'error-conflicto')
    })
  }

  test('un error al cancelar deja el diálogo abierto con el motivo dentro', async ({ page }) => {
    await simularApi(page, {
      estado: 409,
      cuerpo: { error: 'Esa inscripción ya estaba cancelada.', codigo: 'INSCRIPCION_YA_CANCELADA' },
    })
    await page.goto(RUTA)

    await page.getByRole('button', { name: 'Cancelar inscripción de Estudiante, Beto' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByRole('button', { name: 'Sí, cancelar inscripción' }).click()

    const alerta = dialogo.getByRole('alert')
    await expect(alerta).toContainText('No pudimos cancelar la inscripción de Estudiante, Beto.')
    await expect(alerta).toContainText('Esa inscripción ya estaba cancelada.')
    await expect(dialogo.getByRole('button', { name: 'Volver sin cancelar' })).toBeEnabled()
    await expect(dialogo.getByRole('button', { name: 'Sí, cancelar inscripción' })).toBeEnabled()
    await capturar(page, 'dialogo-error')

    await dialogo.getByRole('button', { name: 'Volver sin cancelar' }).click()
    await expect(dialogo).toHaveCount(0)
  })

  test('sesión vencida dentro del diálogo ofrece iniciar sesión', async ({ page }) => {
    await simularApi(page, {
      estado: 401,
      cuerpo: { error: 'Necesitás iniciar sesión para continuar.', codigo: 'SIN_SESION' },
    })
    await page.goto(RUTA)

    await page.getByRole('button', { name: 'Cancelar inscripción de Estudiante, Beto' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByRole('button', { name: 'Sí, cancelar inscripción' }).click()

    await expect(dialogo.getByRole('alert')).toContainText('Tu sesión venció')
    await expect(dialogo.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login')
  })

  test('se opera completamente con el teclado', async ({ page }) => {
    test.skip(!hayTeclado(page), 'El perfil táctil de WebKit no expone teclado físico.')
    const llamadas = await simularApi(page, { estado: 200, cuerpo: CONFIRMACION_NUEVA })
    await page.goto(RUTA)

    const boton = page.getByRole('button', { name: CONFIRMAR })
    await boton.focus()
    await expect(boton).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'Confirmaste' })).toBeVisible()
    expect(llamadas).toHaveLength(1)

    const cancelar = page.getByRole('button', { name: 'Cancelar inscripción de Estudiante, Beto' })
    // Mientras la pantalla relee, las acciones están deshabilitadas: se espera a que vuelvan.
    await expect(cancelar).toBeEnabled()
    await cancelar.focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('los objetivos táctiles miden al menos 44 px en móvil y no hay desborde', async ({ page }) => {
    test.skip(!esMovil(page), 'Solo aplica a los perfiles móviles.')
    for (const ruta of AREAS.map((area) => area.ruta)) {
      await page.goto(ruta)
      for (const boton of await page
        .getByRole('button', { name: /^(Confirmar|Cancelar) inscripción de/ })
        .all()) {
        const caja = await boton.boundingBox()
        expect(caja?.height ?? 0, `${ruta}: alto de un botón de acción`).toBeGreaterThanOrEqual(44)
      }
      expect(await hayScrollHorizontal(page), ruta).toBe(false)
    }
  })

  for (const area of AREAS) {
    test(`${area.titulo}: el estado vacío explica y no parece un error`, async ({ page }) => {
      await page.goto(`${area.ruta}${area.clave === 'deportes' ? '&estado=vacio' : '&vacio=1'}`)

      await expect(page.getByText('No hay inscripciones', { exact: false }).first()).toBeVisible()
      await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)
      expect(await hayScrollHorizontal(page)).toBe(false)
      await capturar(page, `${area.clave}-vacio`)
    })
  }

  for (const area of AREAS.filter((a) => a.clave !== 'deportes')) {
    test(`${area.titulo}: el error de carga se anuncia como alerta y permite reintentar`, async ({
      page,
    }) => {
      await page.goto(`${area.ruta}&estado=error-lectura`)

      const alerta = aplicacion(page).getByRole('alert')
      await expect(alerta).toContainText(`No pudimos cargar`)
      await expect(alerta).toContainText('No pudimos completar la operación.')
      await expect(alerta.getByRole('link', { name: 'Reintentar' })).toBeVisible()
      await expect(aplicacion(page).getByRole('button', { name: /Confirmar|Cancelar/ })).toHaveCount(0)
      await capturar(page, `${area.clave}-error-lectura`)
    })

    test(`${area.titulo}: el estado de carga es explícito`, async ({ page }) => {
      await page.goto(`${area.ruta}&estado=carga`)
      await expect(page.locator('[aria-busy="true"]').first()).toBeVisible()
      await capturar(page, `${area.clave}-carga`)
    })
  }

  test('deportes: el error de carga se anuncia como alerta', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?vista=director&estado=error-lectura')
    await expect(aplicacion(page).getByRole('alert')).toContainText('No pudimos cargar los deportes')
    await capturar(page, 'deportes-error-lectura')
  })
})

test.describe('administración de matrículas', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  const BANCO = '/pruebas-ui/alumnos?matriculas='
  const CONFIRMAR = 'Confirmar matrícula de Arrieta, Camila en 1er Grado A'

  const CONFIRMACION_MATRICULA = {
    ok: true,
    confirmacion: {
      ...CONFIRMACION_NUEVA.confirmacion,
      dominio: 'MATRICULA',
      inscripcion_id: 'b1111111-1111-4111-8111-111111111111',
    },
  }

  test('la vigente sin confirmar se puede confirmar y la ayuda explica cómo se cierra', async ({
    page,
  }) => {
    await page.goto(`${BANCO}sin-confirmar`)

    const seccion = page.getByRole('region', { name: 'Confirmación de la matrícula' })
    await expect(seccion).toBeVisible()

    const vigente = seccion.getByRole('listitem').filter({ hasText: '1er Grado A' })
    await expect(vigente).toContainText('Vigente')
    await expect(vigente).toContainText('Sin confirmar')
    await expect(vigente.getByRole('button', { name: CONFIRMAR })).toBeVisible()

    // No existe ningún botón para cancelar una matrícula: se cierra por otras vías.
    await expect(page.getByRole('button', { name: /cancelar|eliminar|borrar/i })).toHaveCount(0)
    await expect(seccion).toContainText(
      'Para cerrar esta matrícula, inactivá al alumno (se cierra por inactivación) o cambiale el curso (se cierra por cambio de curso).'
    )
    await expect(seccion.getByRole('link', { name: 'Ir al listado de alumnos' })).toHaveAttribute(
      'href',
      '/dashboard/alumnos'
    )

    const texto = await aplicacion(page).innerText()
    expect(texto).not.toMatch(/pendiente de activaci[oó]n|no v[aá]lida/i)
    expect(await hayScrollHorizontal(page)).toBe(false)
    await capturar(page, 'matricula')
  })

  test('las cerradas se conservan en el historial y no se confirman', async ({ page }) => {
    await page.goto(`${BANCO}sin-confirmar`)
    const seccion = page.getByRole('region', { name: 'Confirmación de la matrícula' })

    const cambio = seccion.getByRole('listitem').filter({ hasText: 'Sala de 5 A' })
    await expect(cambio).toContainText('Cerrada')
    await expect(cambio).toContainText('Cambio de curso')
    await expect(cambio).toContainText(/Confirmada por Dora Directora el 05\/03\/2025,? 10:10/)
    await expect(cambio.getByRole('button')).toHaveCount(0)

    const inactivacion = seccion.getByRole('listitem').filter({ hasText: 'Sala de 4 B' })
    await expect(inactivacion).toContainText('Inactivación del alumno')
    await expect(inactivacion).toContainText('No se confirma: la matrícula está cerrada.')
    await expect(inactivacion.getByRole('button')).toHaveCount(0)
  })

  test('confirmar anuncia el éxito y llama a la API de matrículas', async ({ page }) => {
    const llamadas = await simularApi(page, { estado: 200, cuerpo: CONFIRMACION_MATRICULA })
    await page.goto(`${BANCO}sin-confirmar`)

    await page.getByRole('button', { name: CONFIRMAR }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Confirmaste la matrícula' })).toContainText(
      'Confirmaste la matrícula de Arrieta, Camila.'
    )
    expect(llamadas[0]).toMatchObject({
      metodo: 'POST',
      url: '/api/inscripciones/matriculas/b1111111-1111-4111-8111-111111111111/confirmacion',
    })
    await capturar(page, 'matricula-confirmada-aviso')
  })

  test('«ya estaba confirmada» y los errores se anuncian con el tono correcto', async ({ page }) => {
    await simularApi(page, {
      estado: 200,
      cuerpo: {
        ok: true,
        confirmacion: { ...CONFIRMACION_MATRICULA.confirmacion, ya_confirmada: true },
      },
    })
    await page.goto(`${BANCO}sin-confirmar`)
    await page.getByRole('button', { name: CONFIRMAR }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ya estaba confirmada' })).toBeVisible()
    await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)

    await page.unroute('**/api/inscripciones/**')
    await simularApi(page, {
      estado: 409,
      cuerpo: { error: 'La matrícula ya está cerrada y no puede confirmarse.', codigo: 'INSCRIPCION_NO_VIGENTE' },
    })
    await page.getByRole('button', { name: CONFIRMAR }).click()
    await expect(aplicacion(page).getByRole('alert')).toContainText(
      'La matrícula ya está cerrada y no puede confirmarse.'
    )
  })

  test('una matrícula confirmada no vuelve a ofrecer «Confirmar»', async ({ page }) => {
    await page.goto(`${BANCO}confirmada`)
    const vigente = page.getByRole('listitem').filter({ hasText: '1er Grado A' })
    await expect(vigente).toContainText(/Confirmada por Dora Directora el 03\/03\/2026,? 12:40/)
    await expect(vigente.getByRole('button')).toHaveCount(0)
    await capturar(page, 'matricula-confirmada')
  })

  test('sin matrículas y con error de lectura se distinguen', async ({ page }) => {
    await page.goto(`${BANCO}vacio`)
    await expect(page.getByText('Este alumno todavía no tiene matrículas registradas.')).toBeVisible()
    await expect(aplicacion(page).getByRole('alert')).toHaveCount(0)

    await page.goto(`${BANCO}error-lectura`)
    await expect(aplicacion(page).getByRole('alert')).toContainText(
      'No pudimos cargar la confirmación de las matrículas'
    )
    await expect(aplicacion(page).getByRole('alert')).toContainText('no se pudieron leer')
    await capturar(page, 'matricula-error-lectura')
  })

  test('cumple contraste AA y no anida controles', async ({ page }) => {
    await page.goto(`${BANCO}sin-confirmar`)
    await exigirContraste(page, 'matrículas', {
      raiz: 'main',
      esenciales: ['h2', 'main li button'],
      minimoMedidos: 10,
    })
    await exigirSinControlesAnidados(page, 'matrículas', 'main')
  })
})
