import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * API de niveles con sesiones reales creadas por `tests/auth.setup.ts`.
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
const BASE_URL = 'http://localhost:3000'
const contextosActivos: APIRequestContext[] = []
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await page.screenshot({
    path: path.join('docs/evidence/EPT-55', `real-${nombre}.png`),
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
  'P5501',
  'P5502',
  'P5503',
  'P5505',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(cuerpo.toLowerCase()).not.toContain(fragmento.toLowerCase())
  }
}

function nombreUnico(prefijo: string) {
  return `${prefijo} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`.slice(
    0,
    50
  )
}

type EjecutarPeticion = Parameters<APIRequestContext['fetch']>

/**
 * El proyecto base puede iniciar en paralelo con el setup autenticado. Se
 * vuelve a leer el storage state mientras la respuesta sea 401; otro estado
 * prueba que la sesión real ya quedó disponible. No se fabrica ningún token.
 */
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

test.describe('DIRECTOR autenticado — niveles', () => {
  test('crea, renombra, inactiva y reactiva conservando la identidad', async () => {
    const nombre = nombreUnico('NIVEL API')
    const alta = await pedirConSesion(SESION_DIRECTORA, '/api/niveles', {
      method: 'POST',
      data: { nombre },
    })

    expect(alta.status()).toBe(201)
    const nivelCreado = (await alta.json()).nivel
    expect(nivelCreado).toMatchObject({
      nombre,
      activo: true,
      es_institucional: false,
    })
    expect(nivelCreado.id).toBeGreaterThan(0)
    expect(nivelCreado.orden).toBeGreaterThan(30)

    const nombreNuevo = nombreUnico('NIVEL RENOMBRADO')
    const renombrado = await pedirConSesion(
      SESION_DIRECTORA,
      `/api/niveles/${nivelCreado.id}`,
      {
        method: 'PATCH',
        data: { accion: 'renombrar', nombre: nombreNuevo },
      }
    )
    expect(renombrado.status()).toBe(200)
    expect((await renombrado.json()).nivel).toMatchObject({
      id: nivelCreado.id,
      nombre: nombreNuevo,
      orden: nivelCreado.orden,
    })

    const inactivado = await pedirConSesion(
      SESION_DIRECTORA,
      `/api/niveles/${nivelCreado.id}`,
      {
        method: 'PATCH',
        data: { accion: 'cambiar_estado', activo: false },
      }
    )
    expect(inactivado.status()).toBe(200)
    expect((await inactivado.json()).nivel).toMatchObject({
      id: nivelCreado.id,
      activo: false,
    })

    const reactivado = await pedirConSesion(
      SESION_DIRECTORA,
      `/api/niveles/${nivelCreado.id}`,
      {
        method: 'PATCH',
        data: { accion: 'cambiar_estado', activo: true },
      }
    )
    expect(reactivado.status()).toBe(200)
    expect((await reactivado.json()).nivel).toMatchObject({
      id: nivelCreado.id,
      activo: true,
    })
  })

  test('traduce el duplicado real de PostgreSQL sin filtrar detalles', async () => {
    const nombre = nombreUnico('DUPLICADO API')
    expect(
      (
        await pedirConSesion(SESION_DIRECTORA, '/api/niveles', {
          method: 'POST',
          data: { nombre },
        })
      ).status()
    ).toBe(201)

    const duplicado = await pedirConSesion(SESION_DIRECTORA, '/api/niveles', {
      method: 'POST',
      data: { nombre: nombre.toLowerCase() },
    })
    expect(duplicado.status()).toBe(409)
    const cuerpo = await duplicado.text()
    expect(JSON.parse(cuerpo)).toMatchObject({
      error: 'Ya existe un nivel educativo con ese nombre.',
      campo: 'nombre',
    })
    esperarSinFiltraciones(cuerpo)
  })

  test('rechaza nombres vacíos y cualquier whitespace lateral', async () => {
    for (const nombre of [
      '',
      ' NIVEL CON ESPACIOS ',
      '\t',
      '\tNIVEL CON TABS\t',
      '\n',
      ' \t\nNIVEL COMBINADO\r ',
      '\u00a0NIVEL CON NBSP\u00a0',
    ]) {
      const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/niveles', {
        method: 'POST',
        data: { nombre },
      })
      expect(respuesta.status()).toBe(400)
      const cuerpo = await respuesta.text()
      expect(JSON.parse(cuerpo).campo).toBe('nombre')
      esperarSinFiltraciones(cuerpo)
    }
  })

  test('protege el nivel institucional y traduce P5502', async () => {
    const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/niveles/1', {
      method: 'PATCH',
      data: { accion: 'renombrar', nombre: nombreUnico('INICIAL CAMBIADO') },
    })

    expect(respuesta.status()).toBe(409)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe(
      'Los niveles institucionales no pueden renombrarse.'
    )
    esperarSinFiltraciones(cuerpo)
  })

  test('informa un nivel inexistente como 404', async () => {
    const respuesta = await pedirConSesion(
      SESION_DIRECTORA,
      '/api/niveles/2147483647',
      {
        method: 'PATCH',
        data: { accion: 'cambiar_estado', activo: false },
      }
    )

    expect(respuesta.status()).toBe(404)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe(
      'El nivel educativo solicitado no existe.'
    )
    esperarSinFiltraciones(cuerpo)
  })

  test('valida id positivo y contrato PATCH discriminado', async () => {
    const idInvalido = await pedirConSesion(SESION_DIRECTORA, '/api/niveles/0', {
      method: 'PATCH',
      data: { accion: 'cambiar_estado', activo: false },
    })
    expect(idInvalido.status()).toBe(400)
    expect((await idInvalido.json()).error).toBe(
      'Identificador de nivel inválido'
    )

    const contratoMezclado = await pedirConSesion(
      SESION_DIRECTORA,
      '/api/niveles/1',
      {
        method: 'PATCH',
        data: {
          accion: 'renombrar',
          nombre: 'INICIAL',
          activo: false,
        },
      }
    )
    expect(contratoMezclado.status()).toBe(400)
  })

  test('mapea un error inesperado sin exponer PostgreSQL', async () => {
    const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/niveles', {
      method: 'POST',
      data: { nombre: '\u0000' },
    })

    expect(respuesta.status()).toBe(500)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe(
      'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'
    )
    esperarSinFiltraciones(cuerpo)
  })

  test('no dispone de DELETE aunque la sesión sea de DIRECTOR', async () => {
    expect(
      (
        await pedirConSesion(SESION_DIRECTORA, '/api/niveles', {
          method: 'DELETE',
        })
      ).status()
    ).toBe(405)
    expect(
      (
        await pedirConSesion(SESION_DIRECTORA, '/api/niveles/1', {
          method: 'DELETE',
        })
      ).status()
    ).toBe(405)
  })

  test('ve la navegación y el catálogo real en el orden persistido', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await expect(
      page
        .getByRole('navigation', { name: 'Menú del dashboard' })
        .getByRole('link', { name: 'Niveles' })
    ).toBeVisible()

    await page.goto('/dashboard/niveles')
    await expect(
      page.getByRole('heading', { name: 'Niveles educativos', level: 1 })
    ).toBeVisible()
    const filas = page
      .getByRole('table', { name: 'Tabla de niveles educativos' })
      .getByRole('row')
    await expect(filas.nth(1)).toContainText('10')
    await expect(filas.nth(1)).toContainText('INICIAL')
    await expect(filas.nth(2)).toContainText('20')
    await expect(filas.nth(2)).toContainText('PRIMARIO')
    await expect(filas.nth(3)).toContainText('30')
    await expect(filas.nth(3)).toContainText('SECUNDARIO')
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)

    await capturar(page, 'escritorio-listado-autenticado')
    await capturar(page, 'escritorio-sin-eliminacion')
  })

  test('crea, renombra, inactiva y reactiva desde la interfaz real', async ({
    page,
  }) => {
    const nombre = nombreUnico('NIVEL INTERFAZ')
    const nombreNuevo = nombreUnico('NIVEL EDITADO')
    await page.goto('/dashboard/niveles')

    await page.getByRole('button', { name: 'Nuevo nivel' }).click()
    await page.getByLabel('Nombre del nivel').first().fill(nombre)
    await page.getByRole('button', { name: 'Crear nivel' }).click()
    await expect(
      page.getByRole('button', { name: `Renombrar el nivel ${nombre}` })
    ).toBeVisible({ timeout: 15_000 })

    await page.reload()
    await page.getByRole('button', { name: `Renombrar el nivel ${nombre}` }).click()
    await page.locator('#renombrar-nivel-nombre').fill(nombreNuevo)
    await page.getByRole('button', { name: 'Guardar nombre' }).click()
    const inactivar = page.getByRole('button', {
      name: `Inactivar el nivel ${nombreNuevo}`,
    })
    await expect(inactivar).toBeVisible({ timeout: 15_000 })

    await inactivar.click()
    const dialogoInactivar = page.getByRole('dialog', {
      name: `Inactivar ${nombreNuevo}`,
    })
    await expect(dialogoInactivar).toBeVisible()
    await dialogoInactivar
      .getByRole('button', { name: 'Confirmar inactivación' })
      .click()
    const reactivar = page.getByRole('button', {
      name: `Reactivar el nivel ${nombreNuevo}`,
    })
    await expect(reactivar).toBeVisible({ timeout: 15_000 })

    await page.reload()
    await expect(reactivar).toBeVisible()
    await reactivar.click()
    await page
      .getByRole('dialog', { name: `Reactivar ${nombreNuevo}` })
      .getByRole('button', { name: 'Confirmar reactivación' })
      .click()
    await expect(inactivar).toBeVisible({ timeout: 15_000 })

    await capturar(page, 'escritorio-ciclo-completo')
  })

  test('muestra el duplicado real y no permite renombrar institucionales', async ({
    page,
  }) => {
    await page.goto('/dashboard/niveles')
    await expect(
      page.getByRole('button', { name: 'Renombrar el nivel INICIAL' })
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Inactivar el nivel INICIAL' })
    ).toBeVisible()

    await page.getByRole('button', { name: 'Nuevo nivel' }).click()
    await page.getByLabel('Nombre del nivel').first().fill('inicial')
    await page.getByRole('button', { name: 'Crear nivel' }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Ya existe un nivel educativo con ese nombre.' })
        .first()
    ).toBeVisible({ timeout: 15_000 })
    await capturar(page, 'escritorio-duplicado-desde-postgresql')
  })
})

test.describe('ESTUDIANTE autenticado — niveles', () => {
  test('no ve Niveles en la navegación ni accede al catálogo', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(
      page
        .getByRole('navigation', { name: 'Menú del dashboard' })
        .getByRole('link', { name: 'Niveles' })
    ).toHaveCount(0)

    await page.goto('/dashboard/niveles')
    await expect(
      page.getByRole('heading', { name: 'Acceso restringido' })
    ).toBeVisible()
    await expect(
      page.getByRole('table', { name: 'Tabla de niveles educativos' })
    ).toHaveCount(0)

    await capturar(page, 'escritorio-estudiante-restringido')
  })

  test('recibe 403 antes de que se valide un cuerpo inválido', async () => {
    const respuesta = await pedirConSesion(SESION_ESTUDIANTE, '/api/niveles', {
      method: 'POST',
      data: { nombre: ' NIVEL INVÁLIDO ' },
    })

    expect(respuesta.status()).toBe(403)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe(
      'Solo el director puede administrar los niveles educativos.'
    )
    esperarSinFiltraciones(cuerpo)
  })

  test('no puede renombrar, inactivar ni reactivar', async () => {
    for (const data of [
      { accion: 'renombrar', nombre: 'NIVEL PROHIBIDO' },
      { accion: 'cambiar_estado', activo: false },
      { accion: 'cambiar_estado', activo: true },
    ]) {
      const respuesta = await pedirConSesion(
        SESION_ESTUDIANTE,
        '/api/niveles/1',
        { method: 'PATCH', data }
      )
      expect(respuesta.status()).toBe(403)
      esperarSinFiltraciones(await respuesta.text())
    }
  })
})
