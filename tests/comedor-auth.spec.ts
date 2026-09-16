import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Page,
} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Comedor con sesiones reales creadas por `tests/auth.setup.ts` (EPT-10).
 *
 * No hay mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el
 * control de rol del servidor, los envoltorios RPC y PostgreSQL. El duplicado
 * que se verifica acá lo produce el índice único parcial de la base, no una
 * comprobación previa de la aplicación.
 *
 * El archivo se omite salvo que el operador habilite expresamente la base local
 * descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const SESION_DIRECTORA = 'tests/.auth/directora.json'
const SESION_ESTUDIANTE = 'tests/.auth/estudiante.json'
const SESION_ESTUDIANTE_AJENO = 'tests/.auth/estudiante-ajeno.json'
const SESION_ESTUDIANTE_INACTIVO = 'tests/.auth/estudiante-inactivo.json'
const SESION_DOCENTE = 'tests/.auth/docente.json'
const SESION_PADRE = 'tests/.auth/padre.json'
const SESION_PERSONAL = 'tests/.auth/personal.json'
const SESION_SIN_PERFIL = 'tests/.auth/sin-perfil.json'

const BASE_URL = 'http://localhost:3000'
const SERVICIO_COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const LEGAJO_ESTUDIANTE = 'LEG-PRUEBA-0002'

const contextosActivos: APIRequestContext[] = []
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await page.screenshot({
    path: path.join('docs/evidence/EPT-10', `real-${nombre}.png`),
    fullPage: true,
  })
}

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

const FILTRACIONES_PROHIBIDAS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'postgres',
  'supabase.co',
  'select ',
  'insert into',
  'pg_',
  'SQLSTATE',
  '23505',
  'inscripciones_servicios',
  'servicios_escolares',
  'P5550',
  'P5551',
  'P5552',
  'P5553',
  'P5554',
  'P5555',
  'P5556',
  'P5557',
  'P5558',
  'P5505',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(cuerpo.toLowerCase()).not.toContain(fragmento.toLowerCase())
  }
}

type EjecutarPeticion = Parameters<APIRequestContext['fetch']>

/** Espera a que el setup autenticado deje disponible la sesión real. */
async function pedirConSesion(
  archivoSesion: string,
  url: EjecutarPeticion[0],
  opciones?: EjecutarPeticion[1]
) {
  const limite = Date.now() + 20_000
  let ultimoEstado: number | null = null

  do {
    if (fs.existsSync(archivoSesion)) {
      const contexto = await crearContexto.newContext({
        baseURL: BASE_URL,
        storageState: archivoSesion,
      })
      const respuesta: APIResponse = await contexto.fetch(url, opciones)
      ultimoEstado = respuesta.status()

      if (ultimoEstado !== 401) {
        contextosActivos.push(contexto)
        return respuesta
      }
      await contexto.dispose()
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < limite)

  if (ultimoEstado !== null) {
    throw new Error(
      `La sesión local ${archivoSesion} continuó respondiendo ${ultimoEstado} durante 20 segundos.`
    )
  }
  throw new Error(
    `No se encontró la sesión local ${archivoSesion}. Ejecutá auth.setup.ts primero.`
  )
}

function inscribir(sesion: string, servicioId = SERVICIO_COMEDOR) {
  return pedirConSesion(sesion, '/api/comedor/inscripciones', {
    method: 'POST',
    data: { servicio_id: servicioId },
  })
}

function cancelar(sesion: string, inscripcionId: string) {
  return pedirConSesion(sesion, `/api/comedor/inscripciones/${inscripcionId}`, {
    method: 'PATCH',
    data: { accion: 'cancelar' },
  })
}

/**
 * Deja a un estudiante sin inscripción activa, usando exclusivamente la
 * aplicación real.
 *
 * Cancela por la pantalla, que es la única baja que el sistema admite: nunca
 * borra filas, así que el historial crece en vez de desaparecer. Abre su propio
 * contexto con la sesión indicada porque `browser.newContext()` hereda el
 * `storageState` del proyecto, y algunas pruebas necesitan normalizar a un actor
 * distinto del suyo.
 */
async function dejarSinInscripcionActiva(browser: Browser, archivoSesion: string) {
  const contexto = await browser.newContext({
    baseURL: BASE_URL,
    storageState: archivoSesion,
  })
  try {
    const page = await contexto.newPage()
    await page.goto('/dashboard/comedor')

    // Antes de mirar si hay algo que cancelar hay que esperar a que la pantalla
    // resuelva su estado. Contar el botón sobre una página a medio renderizar
    // devolvería cero y dejaría la inscripción activa sin tocar.
    await expect(
      page.getByRole('button', {
        name: /Inscribirme al comedor|Cancelar mi inscripción/,
      })
    ).toBeVisible({ timeout: 20_000 })

    const cancelarBoton = page.getByRole('button', { name: 'Cancelar mi inscripción' })
    if ((await cancelarBoton.count()) === 0) return

    await cancelarBoton.click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByRole('button', { name: 'Sí, cancelar mi inscripción' }).click()
    await expect(page.getByText('Sin inscripción activa')).toBeVisible({
      timeout: 20_000,
    })
  } finally {
    await contexto.close()
  }
}

/** Alta que además devuelve el identificador confirmado por el servidor. */
async function inscribirYObtenerId(sesion: string) {
  const alta = await inscribir(sesion)
  expect(alta.status()).toBe(201)
  const { inscripcion } = await alta.json()
  return inscripcion.id as string
}

test.describe('ESTUDIANTE autenticado — comedor', () => {
  test.slow()

  test('se inscribe, el alta persiste tras recargar y queda ligada a su legajo', async ({
    page,
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)

    await page.goto('/dashboard/comedor')
    await expect(page.getByRole('heading', { name: 'Comedor', level: 1 })).toBeVisible()
    await expect(page.getByText('Sin inscripción activa')).toBeVisible()
    await capturar(page, 'escritorio-sin-inscripcion')

    await page.getByRole('button', { name: 'Inscribirme al comedor' }).click()

    await expect(page.getByText('Te inscribiste al comedor.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('Inscripción activa')).toBeVisible()
    await capturar(page, 'escritorio-inscripcion-exitosa')

    // Persistencia real: se vuelve a pedir la página al servidor.
    await page.reload()
    await expect(page.getByText('Inscripción activa')).toBeVisible()
    await expect(page.getByText(LEGAJO_ESTUDIANTE)).toBeVisible()
    await capturar(page, 'escritorio-estado-inscripto')
  })

  test('el duplicado activo lo rechaza PostgreSQL con 409 y un mensaje de dominio', async ({
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)

    const primera = await inscribir(SESION_ESTUDIANTE)
    expect(primera.status()).toBe(201)

    const segunda = await inscribir(SESION_ESTUDIANTE)
    expect(segunda.status()).toBe(409)
    const cuerpo = await segunda.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe('Ya tenés una inscripción activa al comedor.')
  })

  test('cancela, la baja persiste y después puede volver a inscribirse', async ({
    page,
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)
    await inscribirYObtenerId(SESION_ESTUDIANTE)

    await page.goto('/dashboard/comedor')
    await expect(page.getByText('Inscripción activa')).toBeVisible()

    await page.getByRole('button', { name: 'Cancelar mi inscripción' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(
      dialogo.getByRole('heading', { name: 'Cancelar tu inscripción al comedor' })
    ).toBeVisible()
    await capturar(page, 'escritorio-confirmacion-cancelacion')

    await dialogo.getByRole('button', { name: 'Sí, cancelar mi inscripción' }).click()

    await expect(
      page.getByText('Cancelaste tu inscripción al comedor. Podés volver a inscribirte.')
    ).toBeVisible({ timeout: 20_000 })
    await capturar(page, 'escritorio-cancelacion-exitosa')

    await page.reload()
    await expect(page.getByText('Sin inscripción activa')).toBeVisible()
    // El ciclo cancelado se conserva: no hay borrado físico.
    await expect(page.getByRole('heading', { name: 'Inscripciones anteriores' })).toBeVisible()
    await expect(page.getByText('Cancelada').first()).toBeVisible()

    // Reingreso.
    await page.getByRole('button', { name: 'Inscribirme al comedor' }).click()
    await expect(page.getByText('Te inscribiste al comedor.')).toBeVisible({
      timeout: 20_000,
    })
    await page.reload()
    await expect(page.getByText('Inscripción activa')).toBeVisible()
    await capturar(page, 'escritorio-reingreso')
  })

  test('escapa del diálogo de confirmación sin cancelar nada', async ({
    page,
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)
    await inscribirYObtenerId(SESION_ESTUDIANTE)

    await page.goto('/dashboard/comedor')
    const disparador = page.getByRole('button', { name: 'Cancelar mi inscripción' })
    await disparador.click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    // Foco inicial declarado en la acción no destructiva.
    await expect(dialogo.getByRole('button', { name: 'Volver sin cancelar' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    // El foco vuelve al disparador.
    await expect(disparador).toBeFocused()

    await page.reload()
    await expect(page.getByText('Inscripción activa')).toBeVisible()
  })

  test('no puede usar la identidad de otro alumno ni cancelar una inscripción ajena', async ({
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE_AJENO)

    const ajena = await inscribirYObtenerId(SESION_ESTUDIANTE_AJENO)

    // Cancelar la inscripción de otra persona responde igual que si no existiera.
    const intento = await cancelar(SESION_ESTUDIANTE, ajena)
    expect(intento.status()).toBe(404)
    const cuerpo = await intento.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe(
      'No encontramos una inscripción activa tuya para cancelar.'
    )

    // Y sigue activa para su dueño: nada se canceló.
    const duplicadoDelDueno = await inscribir(SESION_ESTUDIANTE_AJENO)
    expect(duplicadoDelDueno.status()).toBe(409)
  })

  test('una pestaña desactualizada muestra el error real de duplicado y reconcilia el estado', async ({
    page,
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)

    // La pantalla se abre sin inscripción activa.
    await page.goto('/dashboard/comedor')
    await expect(
      page.getByRole('button', { name: 'Inscribirme al comedor' })
    ).toBeVisible()

    // Mientras tanto, otra pestaña de la misma persona se inscribe.
    await inscribirYObtenerId(SESION_ESTUDIANTE)

    // El botón viejo sigue ahí. Al usarlo, el rechazo lo produce el índice
    // único de PostgreSQL, no una comprobación previa del navegador.
    await page.getByRole('button', { name: 'Inscribirme al comedor' }).click()

    // La alerta se busca dentro de la región de estado de la pantalla: Next
    // agrega su propio anunciador de ruta con `role="alert"`, que no es
    // contenido de la aplicación.
    const alerta = page
      .getByLabel('Estado de tu inscripción al comedor')
      .getByRole('alert')
    await expect(alerta).toContainText('Ya tenés una inscripción activa al comedor.', {
      timeout: 20_000,
    })
    await capturar(page, 'escritorio-error-duplicado')

    // Y la pantalla se reconcilia con lo que realmente hay persistido. El
    // texto se compara exacto: «Sin inscripción activa» y el propio mensaje de
    // error contienen la misma subcadena.
    await expect(
      page.getByText('Inscripción activa', { exact: true })
    ).toBeVisible({ timeout: 20_000 })
  })

  test('la pantalla del alumno es usable a 375 px, sin desplazamiento horizontal', async ({
    page,
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)
    await page.setViewportSize({ width: 375, height: 812 })

    await page.goto('/dashboard/comedor')
    await expect(page.getByRole('heading', { name: 'Comedor', level: 1 })).toBeVisible()
    await capturar(page, 'movil-sin-inscripcion')

    await page.getByRole('button', { name: 'Inscribirme al comedor' }).click()
    await expect(page.getByText('Inscripción activa')).toBeVisible({ timeout: 20_000 })
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1
      )
    ).toBe(false)
    await capturar(page, 'movil-estado-inscripto')

    await page.getByRole('button', { name: 'Cancelar mi inscripción' }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await capturar(page, 'movil-confirmacion-cancelacion')

    await dialogo.getByRole('button', { name: 'Sí, cancelar mi inscripción' }).click()
    await expect(page.getByText('Sin inscripción activa')).toBeVisible({
      timeout: 20_000,
    })
    await capturar(page, 'movil-cancelacion-exitosa')
  })

  test('el cuerpo no admite un alumno, un perfil ni un legajo elegidos por el navegador', async () => {
    for (const data of [
      { servicio_id: SERVICIO_COMEDOR, alumno_id: '11111111-1111-4111-8111-111111111111' },
      { servicio_id: SERVICIO_COMEDOR, legajo_nro: 'LEG-PRUEBA-0003' },
      { servicio_id: SERVICIO_COMEDOR, perfil_id: '11111111-1111-4111-8111-111111111111' },
    ]) {
      const respuesta = await pedirConSesion(
        SESION_ESTUDIANTE,
        '/api/comedor/inscripciones',
        { method: 'POST', data }
      )
      expect(respuesta.status()).toBe(400)
      const cuerpo = await respuesta.text()
      esperarSinFiltraciones(cuerpo)
      expect(JSON.parse(cuerpo).error).toBe('La petición contiene campos no permitidos')
    }
  })

  test('un servicio inexistente devuelve 404 sin filtrar detalle técnico', async () => {
    const respuesta = await inscribir(
      SESION_ESTUDIANTE,
      '00000000-0000-4000-8000-000000000000'
    )
    expect(respuesta.status()).toBe(404)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe('El servicio solicitado no existe.')
  })

  test('no existe ninguna superficie DELETE para un estudiante autenticado', async () => {
    const borradoColeccion = await pedirConSesion(
      SESION_ESTUDIANTE,
      '/api/comedor/inscripciones',
      { method: 'DELETE' }
    )
    expect(borradoColeccion.status()).toBe(405)

    const borradoElemento = await pedirConSesion(
      SESION_ESTUDIANTE,
      `/api/comedor/inscripciones/11111111-1111-4111-8111-111111111111`,
      { method: 'DELETE' }
    )
    expect(borradoElemento.status()).toBe(405)
  })
})

test.describe('ESTUDIANTE INACTIVO autenticado — comedor', () => {
  test('la pantalla explica por qué no puede inscribirse y el botón queda deshabilitado', async ({
    page,
  }) => {
    await page.goto('/dashboard/comedor')
    await expect(page.getByRole('heading', { name: 'Comedor', level: 1 })).toBeVisible()
    await expect(page.getByText('Sin inscripción activa')).toBeVisible()
    await expect(
      page.getByText(/Tu legajo académico no está activo/)
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Inscribirme al comedor' })).toBeDisabled()
    await capturar(page, 'escritorio-alumno-inactivo')

    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    await expect(page.getByText(/Tu legajo académico no está activo/)).toBeVisible()
    await capturar(page, 'movil-alumno-inactivo')
  })

  test('la API tampoco lo deja inscribirse', async () => {
    const respuesta = await inscribir(SESION_ESTUDIANTE_INACTIVO)
    expect(respuesta.status()).toBe(409)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toContain('Tu legajo académico no está activo')
  })
})

test.describe('DIRECTOR autenticado — comedor', () => {
  test.slow()

  test('consulta el listado de inscriptos con legajo, estado y fechas', async ({
    page,
    browser,
  }) => {
    await dejarSinInscripcionActiva(browser, SESION_ESTUDIANTE)
    await inscribirYObtenerId(SESION_ESTUDIANTE)

    await page.goto('/dashboard/comedor')
    await expect(page.getByRole('heading', { name: 'Comedor', level: 1 })).toBeVisible()
    await expect(
      page.getByRole('table', { name: /inscriptos al comedor/i })
    ).toBeVisible()
    await expect(
      page.getByRole('rowheader', { name: 'Estudiante, Beto' })
    ).toBeVisible()
    await expect(page.getByRole('cell', { name: LEGAJO_ESTUDIANTE })).toBeVisible()
    await expect(page.getByText(/alumnos? con inscripción activa/)).toBeVisible()
    await capturar(page, 'escritorio-consulta-administrativa')

    // Misma consulta a 375 px: la tabla cede el lugar a tarjetas legibles.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    // La tabla de escritorio conserva el mismo contenido en el DOM aunque esté
    // oculta, así que la aserción se acota a la tarjeta que sí se ve.
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Estudiante, Beto' }).first()
    ).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1
      )
    ).toBe(false)
    await capturar(page, 'movil-consulta-administrativa')
  })

  test('no obtiene ninguna facultad de inscribir ni de cancelar', async () => {
    const alta = await inscribir(SESION_DIRECTORA)
    expect(alta.status()).toBe(403)
    const cuerpo = await alta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe(
      'Solo un estudiante puede inscribirse al comedor desde esta pantalla.'
    )

    const baja = await cancelar(
      SESION_DIRECTORA,
      '11111111-1111-4111-8111-111111111111'
    )
    expect(baja.status()).toBe(403)
    esperarSinFiltraciones(await baja.text())
  })

  test('recibe 403 antes de que se valide un cuerpo inválido', async () => {
    const respuesta = await pedirConSesion(
      SESION_DIRECTORA,
      '/api/comedor/inscripciones',
      { method: 'POST', data: { servicio_id: 'no-es-un-uuid' } }
    )

    expect(respuesta.status()).toBe(403)
    esperarSinFiltraciones(await respuesta.text())
  })
})

/**
 * El resto de los actores. Cada bloque corre con la sesión del proyecto que le
 * corresponde, de modo que la denegación se prueba con la identidad que
 * realmente debe ser rechazada y no con una simulación.
 */
for (const actor of [
  { etiqueta: 'DOCENTE', sesion: SESION_DOCENTE },
  { etiqueta: 'PADRE', sesion: SESION_PADRE },
  { etiqueta: 'PERSONAL', sesion: SESION_PERSONAL },
  { etiqueta: 'SIN PERFIL', sesion: SESION_SIN_PERFIL },
]) {
  test.describe(`${actor.etiqueta} autenticado — comedor`, () => {
    test('no ve Comedor en la navegación ni accede a la pantalla', async ({ page }) => {
      await page.goto('/dashboard')
      await expect(
        page
          .getByRole('navigation', { name: 'Menú del dashboard' })
          .getByRole('link', { name: 'Comedor' })
      ).toHaveCount(0)

      await page.goto('/dashboard/comedor')
      await expect(
        page.getByRole('heading', { name: 'Acceso restringido' })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Inscribirme al comedor' })
      ).toHaveCount(0)
      await expect(page.getByRole('table')).toHaveCount(0)
    })

    test('recibe 403 en el alta y en la baja, sin filtrar detalle técnico', async () => {
      const alta = await inscribir(actor.sesion)
      expect(alta.status()).toBe(403)
      esperarSinFiltraciones(await alta.text())

      const baja = await cancelar(
        actor.sesion,
        '11111111-1111-4111-8111-111111111111'
      )
      expect(baja.status()).toBe(403)
      esperarSinFiltraciones(await baja.text())
    })
  })
}

/**
 * Cierre de sesión con una cuenta propia (EPT-10).
 *
 * `signOut()` revoca todas las sesiones del usuario en Supabase, así que este
 * bloque usa `ESTUDIANTE_CIERRE` y crea su propio contexto sin `storageState`:
 * con la sesión compartida del proyecto, `/login` redirigiría al panel y además
 * dejaría sin sesión a las pruebas que corren después.
 */
test.describe('ESTUDIANTE autenticado — cierre de sesión desde el comedor', () => {
  test.slow()

  const CUENTA = {
    email: 'estudiante.cierre.prueba@ept.local',
    password: 'prueba-ept-10-cierre',
  }

  async function abrirComedorConSesionPropia(
    browser: Browser,
    viewport?: { width: number; height: number }
  ) {
    const contexto = await browser.newContext({
      baseURL: BASE_URL,
      storageState: undefined,
      ...(viewport ? { viewport } : {}),
    })
    const page = await contexto.newPage()
    await page.goto('/login')
    await page.getByLabel('Email institucional').fill(CUENTA.email)
    await page.getByLabel('Contraseña').fill(CUENTA.password)
    await page.getByRole('button', { name: /ingresar|iniciar/i }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 })
    await page.goto('/dashboard/comedor')
    return { contexto, page }
  }

  test('el botón sigue visible en escritorio y la ruta protegida vuelve al login', async ({
    browser,
  }) => {
    const { contexto, page } = await abrirComedorConSesionPropia(browser)
    try {
      const cerrar = page.getByRole('button', { name: 'Cerrar sesión' })
      await expect(cerrar.first()).toBeVisible()
      await capturar(page, 'escritorio-cerrar-sesion-visible')

      await cerrar.first().click()
      await page.waitForURL('http://localhost:3000/', { timeout: 20_000 })

      await page.goto('/dashboard/comedor')
      await expect(page).toHaveURL(/\/login/)
      await expect(
        page.getByRole('button', { name: 'Inscribirme al comedor' })
      ).toHaveCount(0)
    } finally {
      await contexto.close()
    }
  })

  test('el botón sigue visible y funcional en móvil, sin desplazamiento horizontal', async ({
    browser,
  }) => {
    const { contexto, page } = await abrirComedorConSesionPropia(browser, {
      width: 375,
      height: 812,
    })
    try {
      const cerrarMovil = page
        .locator('header')
        .getByRole('button', { name: 'Cerrar sesión' })
      await expect(cerrarMovil).toBeVisible()
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth + 1
        )
      ).toBe(false)
      await capturar(page, 'movil-cerrar-sesion-visible')

      await cerrarMovil.click()
      await page.waitForURL('http://localhost:3000/', { timeout: 20_000 })

      await page.goto('/dashboard/comedor')
      await expect(page).toHaveURL(/\/login/)
    } finally {
      await contexto.close()
    }
  })
})
