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
 * Materias con sesiones reales creadas por `tests/auth.setup.ts`.
 *
 * No hay mocks: cada petición atraviesa cookies SSR, auth.getUser(), el control
 * de DIRECTOR, los wrappers RPC y PostgreSQL. El archivo se omite salvo que el
 * operador habilite expresamente la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const SESION_DIRECTORA = 'tests/.auth/directora.json'
const SESION_ESTUDIANTE = 'tests/.auth/estudiante.json'
const BASE_URL = process.env.EPT_BASE_URL ?? 'http://localhost:3000'
const contextosActivos: APIRequestContext[] = []
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await page.screenshot({
    path: path.join('docs/evidence/EPT-56', `real-${nombre}.png`),
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
  'P5530',
  'P5531',
  'P5532',
  'P5533',
  'P5534',
  'P5535',
  'P5536',
  'P5537',
  'P5538',
  'P5539',
  'P5505',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(cuerpo.toLowerCase()).not.toContain(fragmento.toLowerCase())
  }
}

function nombreUnico(prefijo: string) {
  return `${prefijo} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`.slice(0, 100)
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
  throw new Error(`No se encontró la sesión local ${archivoSesion}. Ejecutá auth.setup.ts primero.`)
}

async function crearMateria(nombre: string) {
  const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/materias', {
    method: 'POST',
    data: { nombre },
  })
  expect(respuesta.status()).toBe(201)
  return (await respuesta.json()).materia as { id: number; nombre: string; activo: boolean }
}

/** Curso activo sembrado por `auth.setup.ts`, resuelto desde la propia interfaz. */
async function idDeCursoActivo(page: Page, denominacion: string, division: string) {
  await page.goto('/dashboard/materias')
  const materia = await crearMateria(nombreUnico('Materia de apoyo'))
  await page.reload()
  await page
    .getByRole('button', { name: `Asignar la materia ${materia.nombre} a un curso` })
    .click()
  const opcion = page
    .locator('#asignar-curso option')
    .filter({ hasText: `${denominacion} ${division}` })
    .first()
  const valor = await opcion.getAttribute('value')
  await page.keyboard.press('Escape')
  if (!valor) throw new Error(`No se encontró el curso ${denominacion} ${division}`)
  return { cursoId: valor, materia }
}

test.describe('DIRECTOR autenticado — materias', () => {
  test('crea, renombra, inactiva y reactiva conservando la identidad', async () => {
    const nombre = nombreUnico('Materia API')
    const creada = await crearMateria(nombre)
    expect(creada).toMatchObject({ nombre, activo: true })
    expect(creada.id).toBeGreaterThan(0)

    const nombreNuevo = nombreUnico('Materia renombrada')
    const renombrada = await pedirConSesion(SESION_DIRECTORA, `/api/materias/${creada.id}`, {
      method: 'PATCH',
      data: { accion: 'renombrar', nombre: nombreNuevo },
    })
    expect(renombrada.status()).toBe(200)
    expect((await renombrada.json()).materia).toMatchObject({
      id: creada.id,
      nombre: nombreNuevo,
    })

    const inactivada = await pedirConSesion(SESION_DIRECTORA, `/api/materias/${creada.id}`, {
      method: 'PATCH',
      data: { accion: 'cambiar_estado', activo: false },
    })
    expect(inactivada.status()).toBe(200)
    expect((await inactivada.json()).materia).toMatchObject({ id: creada.id, activo: false })

    const reactivada = await pedirConSesion(SESION_DIRECTORA, `/api/materias/${creada.id}`, {
      method: 'PATCH',
      data: { accion: 'cambiar_estado', activo: true },
    })
    expect(reactivada.status()).toBe(200)
    expect((await reactivada.json()).materia).toMatchObject({ id: creada.id, activo: true })
  })

  test('traduce el duplicado real de PostgreSQL sin filtrar detalles', async () => {
    const nombre = nombreUnico('Materia duplicada')
    await crearMateria(nombre)

    const duplicada = await pedirConSesion(SESION_DIRECTORA, '/api/materias', {
      method: 'POST',
      data: { nombre: nombre.toLowerCase() },
    })
    expect(duplicada.status()).toBe(409)
    const cuerpo = await duplicada.text()
    expect(JSON.parse(cuerpo)).toMatchObject({
      error: 'Ya existe una materia con ese nombre.',
      campo: 'nombre',
    })
    esperarSinFiltraciones(cuerpo)
  })

  test('recorta los espacios laterales y rechaza el nombre vacío', async () => {
    const nombre = nombreUnico('Materia recortada')
    const recortada = await pedirConSesion(SESION_DIRECTORA, '/api/materias', {
      method: 'POST',
      data: { nombre: `  ${nombre}\t` },
    })
    expect(recortada.status()).toBe(201)
    expect((await recortada.json()).materia.nombre).toBe(nombre)

    for (const invalido of ['', '   ', '\t\n', ' ']) {
      const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/materias', {
        method: 'POST',
        data: { nombre: invalido },
      })
      expect(respuesta.status()).toBe(400)
      const cuerpo = await respuesta.text()
      expect(JSON.parse(cuerpo).campo).toBe('nombre')
      esperarSinFiltraciones(cuerpo)
    }
  })

  test('informa una materia inexistente como 404', async () => {
    const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/materias/2147483647', {
      method: 'PATCH',
      data: { accion: 'cambiar_estado', activo: false },
    })
    expect(respuesta.status()).toBe(404)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe('La materia solicitada no existe.')
    esperarSinFiltraciones(cuerpo)
  })

  test('mapea un error inesperado sin exponer PostgreSQL', async () => {
    const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/materias', {
      method: 'POST',
      // El byte nulo se construye en tiempo de ejecución: incrustarlo en el
      // archivo lo volvería binario para Git y la prueba dejaría de ser legible.
      data: { nombre: `Materia ${String.fromCharCode(0)} inválida` },
    })

    expect(respuesta.status()).toBe(500)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe(
      'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'
    )
    esperarSinFiltraciones(cuerpo)
  })

  test('valida el identificador y el contrato PATCH discriminado', async () => {
    const idInvalido = await pedirConSesion(SESION_DIRECTORA, '/api/materias/0', {
      method: 'PATCH',
      data: { accion: 'cambiar_estado', activo: false },
    })
    expect(idInvalido.status()).toBe(400)
    expect((await idInvalido.json()).error).toBe('Identificador de materia inválido')

    const mezclado = await pedirConSesion(SESION_DIRECTORA, '/api/materias/1', {
      method: 'PATCH',
      data: { accion: 'renombrar', nombre: 'Mezcla', activo: false },
    })
    expect(mezclado.status()).toBe(400)
  })

  test('asigna a un curso, valida profesor y curso, y conserva el historial', async ({
    page,
  }) => {
    const { cursoId, materia } = await idDeCursoActivo(page, 'Sala de 5', 'A')

    const asignada = await pedirConSesion(SESION_DIRECTORA, '/api/asignaciones-materias', {
      method: 'POST',
      data: { materia_id: materia.id, curso_id: cursoId },
    })
    expect(asignada.status()).toBe(201)
    const asignacionId = (await asignada.json()).asignacion.id as string

    const duplicada = await pedirConSesion(SESION_DIRECTORA, '/api/asignaciones-materias', {
      method: 'POST',
      data: { materia_id: materia.id, curso_id: cursoId },
    })
    expect(duplicada.status()).toBe(409)
    expect((await duplicada.json()).error).toBe('Esa materia ya está asignada a ese curso.')

    const cursoInexistente = await pedirConSesion(
      SESION_DIRECTORA,
      '/api/asignaciones-materias',
      {
        method: 'POST',
        data: {
          materia_id: materia.id,
          curso_id: '00000000-0000-4000-8000-000000000000',
        },
      }
    )
    expect(cursoInexistente.status()).toBe(404)
    expect((await cursoInexistente.json()).error).toBe('El curso seleccionado no existe.')

    // La directora no es DOCENTE: sirve como perfil real de otro rol.
    const perfilDirectora = await pedirConSesion(SESION_DIRECTORA, '/api/asignaciones-materias', {
      method: 'POST',
      data: {
        materia_id: materia.id,
        curso_id: cursoId,
        profesor_id: '00000000-0000-4000-8000-000000000001',
      },
    })
    expect(perfilDirectora.status()).toBe(404)
    expect((await perfilDirectora.json()).error).toBe('El profesor seleccionado no existe.')

    // Inactivar la materia conserva la asignación y bloquea nuevas.
    expect(
      (
        await pedirConSesion(SESION_DIRECTORA, `/api/materias/${materia.id}`, {
          method: 'PATCH',
          data: { accion: 'cambiar_estado', activo: false },
        })
      ).status()
    ).toBe(200)

    const otroCurso = await idDeCursoActivo(page, '1er Grado', 'A')
    const materiaInactiva = await pedirConSesion(
      SESION_DIRECTORA,
      '/api/asignaciones-materias',
      {
        method: 'POST',
        data: { materia_id: materia.id, curso_id: otroCurso.cursoId },
      }
    )
    expect(materiaInactiva.status()).toBe(409)
    expect((await materiaInactiva.json()).error).toBe(
      'La materia está inactiva y no admite nuevas asignaciones.'
    )

    await page.goto('/dashboard/materias')
    await page
      .getByRole('button', { name: `Ver los cursos de la materia ${materia.nombre}` })
      .click()
    await expect(
      page.getByRole('list', { name: `Cursos de la materia ${materia.nombre}` })
    ).toContainText('Sala de 5 A')

    expect(
      (
        await pedirConSesion(
          SESION_DIRECTORA,
          `/api/asignaciones-materias/${asignacionId}`,
          { method: 'PATCH', data: { accion: 'cambiar_estado', activo: false } }
        )
      ).status()
    ).toBe(200)
  })

  test('crea, asigna y renombra desde la interfaz real y persiste tras recargar', async ({
    page,
  }) => {
    const nombre = nombreUnico('Materia interfaz')
    const nombreNuevo = nombreUnico('Materia editada')

    await page.goto('/dashboard/materias')
    await page.getByRole('button', { name: 'Nueva materia' }).click()
    await page.getByLabel('Nombre de la materia').first().fill(nombre)
    await page.getByRole('button', { name: 'Crear materia' }).click()
    await expect(
      page.getByRole('button', { name: `Renombrar la materia ${nombre}` })
    ).toBeVisible({ timeout: 15_000 })

    await page.reload()
    await expect(
      page.getByRole('button', { name: `Renombrar la materia ${nombre}` })
    ).toBeVisible()
    await capturar(page, 'escritorio-listado-autenticado')

    await page.getByRole('button', { name: `Asignar la materia ${nombre} a un curso` }).click()
    const dialogo = page.getByRole('dialog', { name: `Asignar ${nombre} a un curso` })
    await page.locator('#asignar-curso').selectOption({ index: 1 })
    await page.locator('#asignar-profesor').selectOption({ label: 'Docente, Darío' })
    await dialogo.getByRole('button', { name: 'Asignar materia' }).click()
    await expect(page.getByRole('status')).toContainText('asignada a', { timeout: 15_000 })

    await page.reload()
    await page.getByRole('button', { name: `Ver los cursos de la materia ${nombre}` }).click()
    await expect(
      page.getByRole('list', { name: `Cursos de la materia ${nombre}` })
    ).toContainText('Darío Docente')
    await capturar(page, 'escritorio-asignacion-con-profesor')

    await page.getByRole('button', { name: `Renombrar la materia ${nombre}` }).click()
    await page.locator('#renombrar-materia-nombre').fill(nombreNuevo)
    await page.getByRole('button', { name: 'Guardar nombre' }).click()
    const inactivar = page.getByRole('button', {
      name: `Inactivar la materia ${nombreNuevo}`,
    })
    await expect(inactivar).toBeVisible({ timeout: 15_000 })

    await inactivar.click()
    await page
      .getByRole('dialog', { name: `Inactivar ${nombreNuevo}` })
      .getByRole('button', { name: 'Confirmar inactivación' })
      .click()
    const reactivar = page.getByRole('button', {
      name: `Reactivar la materia ${nombreNuevo}`,
    })
    await expect(reactivar).toBeVisible({ timeout: 15_000 })
    await capturar(page, 'escritorio-ciclo-completo')

    await page.reload()
    await expect(reactivar).toBeVisible()
    await reactivar.click()
    await page
      .getByRole('dialog', { name: `Reactivar ${nombreNuevo}` })
      .getByRole('button', { name: 'Confirmar reactivación' })
      .click()
    await expect(inactivar).toBeVisible({ timeout: 15_000 })
  })

  test('ve la navegación, el duplicado real y ningún control de eliminación', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await expect(
      page
        .getByRole('navigation', { name: 'Menú del dashboard' })
        .getByRole('link', { name: 'Materias' })
    ).toBeVisible()

    const nombre = nombreUnico('Materia repetida')
    await crearMateria(nombre)

    await page.goto('/dashboard/materias')
    await page.getByRole('button', { name: 'Nueva materia' }).click()
    await page.getByLabel('Nombre de la materia').first().fill(nombre.toUpperCase())
    await page.getByRole('button', { name: 'Crear materia' }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Ya existe una materia con ese nombre.' })
        .first()
    ).toBeVisible({ timeout: 15_000 })
    await capturar(page, 'escritorio-duplicado-desde-postgresql')

    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)
    await capturar(page, 'escritorio-sin-eliminacion')
  })

  test('muestra el listado y los cursos relacionados a 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/dashboard/materias')

    await expect(page.getByRole('heading', { name: 'Materias', level: 1 })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
    ).toBe(false)
    await capturar(page, 'movil-listado-autenticado')
  })
})

/**
 * Cierre de sesión con una sesión real, iniciada en el momento por el
 * formulario de login y con una cuenta exclusiva.
 *
 * `signOut()` revoca las sesiones del usuario en Supabase: hacerlo con la
 * directora compartida dejaría sin sesión al resto de las suites autenticadas.
 * Por eso estas pruebas crean su propio contexto, sin `storageState`.
 */
test.describe('DIRECTOR autenticado — cierre de sesión', () => {
  // Cada prueba inicia sesión por el formulario real y después recorre el panel,
  // el cierre y la vuelta atrás. En el servidor de desarrollo eso incluye la
  // compilación de varias rutas, así que necesitan más margen que el resto.
  test.slow()

  const CUENTA = {
    email: 'directora.cierre.prueba@ept.local',
    password: 'prueba-ept-56-cierre',
  }

  async function abrirPanelConSesionPropia(
    browser: Browser,
    viewport?: { width: number; height: number }
  ) {
    // Playwright hace que `browser.newContext()` herede las opciones del
    // proyecto, incluido su `storageState`. Acá hay que partir sin ninguna
    // sesión: con la de la directora compartida, `/login` redirige al panel y
    // nunca se probaría un cierre de sesión propio.
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
    await page.goto('/dashboard/materias')
    return { contexto, page }
  }

  test('cierra la sesión desde el panel de escritorio y no permite recuperarlo', async ({
    browser,
  }) => {
    const { contexto, page } = await abrirPanelConSesionPropia(browser)
    try {
      const cerrar = page.getByRole('button', { name: 'Cerrar sesión' })
      await expect(cerrar.first()).toBeVisible()
      await capturar(page, 'escritorio-cerrar-sesion-visible')

      await cerrar.first().click()
      await page.waitForURL(`${process.env.EPT_BASE_URL ?? 'http://localhost:3000'}/`, { timeout: 20_000 })

      // Volver atrás no devuelve el panel: la sesión ya no existe.
      await page.goBack()
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })

      await page.reload()
      await expect(page).toHaveURL(/\/login/)

      await page.goto('/dashboard/materias')
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('list', { name: 'Catálogo de materias' })).toHaveCount(0)
      await capturar(page, 'escritorio-logout-sin-retorno')
    } finally {
      await contexto.close()
    }
  })

  test('ofrece la acción de cerrar sesión en el encabezado móvil', async ({ browser }) => {
    const { contexto, page } = await abrirPanelConSesionPropia(browser, {
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
      await page.waitForURL(`${process.env.EPT_BASE_URL ?? 'http://localhost:3000'}/`, { timeout: 20_000 })

      await page.goto('/dashboard/materias')
      await expect(page).toHaveURL(/\/login/)
    } finally {
      await contexto.close()
    }
  })
})

test.describe('ESTUDIANTE autenticado — materias', () => {
  test('no ve Materias en la navegación ni accede al catálogo', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(
      page
        .getByRole('navigation', { name: 'Menú del dashboard' })
        .getByRole('link', { name: 'Materias' })
    ).toHaveCount(0)

    await page.goto('/dashboard/materias')
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Catálogo de materias' })).toHaveCount(0)

    await capturar(page, 'escritorio-estudiante-restringido')
  })

  test('recibe 403 antes de que se valide un cuerpo inválido', async () => {
    const respuesta = await pedirConSesion(SESION_ESTUDIANTE, '/api/materias', {
      method: 'POST',
      data: { nombre: '' },
    })

    expect(respuesta.status()).toBe(403)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe(
      'Solo el director puede administrar las materias.'
    )
    esperarSinFiltraciones(cuerpo)
  })

  test('no puede renombrar, inactivar, asignar ni cambiar profesores', async () => {
    for (const [url, data] of [
      ['/api/materias/1', { accion: 'renombrar', nombre: 'Prohibida' }],
      ['/api/materias/1', { accion: 'cambiar_estado', activo: false }],
      [
        '/api/asignaciones-materias/11111111-1111-4111-8111-111111111111',
        { accion: 'cambiar_profesor', profesor_id: null },
      ],
      [
        '/api/asignaciones-materias/11111111-1111-4111-8111-111111111111',
        { accion: 'cambiar_estado', activo: true },
      ],
    ] as const) {
      const respuesta = await pedirConSesion(SESION_ESTUDIANTE, url, {
        method: 'PATCH',
        data,
      })
      expect(respuesta.status()).toBe(403)
      esperarSinFiltraciones(await respuesta.text())
    }

    const asignacion = await pedirConSesion(SESION_ESTUDIANTE, '/api/asignaciones-materias', {
      method: 'POST',
      data: {
        materia_id: 1,
        curso_id: '11111111-1111-4111-8111-111111111111',
      },
    })
    expect(asignacion.status()).toBe(403)
    esperarSinFiltraciones(await asignacion.text())
  })
})
