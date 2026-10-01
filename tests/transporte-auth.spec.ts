import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Transporte con sesiones reales creadas por `tests/auth.setup.ts` (EPT-60).
 *
 * No hay mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el
 * control de rol del servidor, los envoltorios RPC y PostgreSQL. El cambio
 * atómico y la unicidad de recorrido activo que se verifican acá los produce
 * la base (trigger + índice), no una comprobación previa de la aplicación.
 *
 * El archivo se omite salvo que el operador habilite expresamente la base
 * local descartable.
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

const BASE_URL = process.env.EPT_BASE_URL ?? 'http://localhost:3000'
const TR_NORTE = 'e0000000-0000-4000-8000-000000000020'
const TR_SUR = 'e0000000-0000-4000-8000-000000000021'
const SERVICIO_COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const LEGAJO_ESTUDIANTE = 'LEG-PRUEBA-0002'

const contextosActivos: APIRequestContext[] = []
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await page.screenshot({
    path: path.join('docs/evidence/EPT-60', `real-${nombre}.png`),
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
  'paradas_recorrido',
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
  'P5960',
  'P5961',
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

function establecer(sesion: string, servicioId: string) {
  return pedirConSesion(sesion, '/api/transporte/inscripciones', {
    method: 'POST',
    data: { servicio_id: servicioId },
  })
}

function cancelar(sesion: string, inscripcionId: string) {
  return pedirConSesion(sesion, `/api/transporte/inscripciones/${inscripcionId}`, {
    method: 'PATCH',
    data: { accion: 'cancelar' },
  })
}

function actualizarRecorridoComoDirector(
  servicioId: string,
  nombre: string,
  activo: boolean
) {
  return pedirConSesion(SESION_DIRECTORA, `/api/transporte/recorridos/${servicioId}`, {
    method: 'PATCH',
    data: { nombre, activo },
  })
}

/**
 * Retira un privilegio de `authenticated` mientras dura `cuerpo` y lo
 * devuelve, incluso si `cuerpo` lanza.
 *
 * Mismo patrón que `alumnos-auth.spec.ts`: sirve para llegar de verdad al
 * estado que el servidor muestra cuando no puede leer, provocado con un
 * privilegio real retirado y no simulado con una respuesta de red falsa
 * (esta pantalla lee desde un Server Component, así que `page.route()` no
 * intercepta nada: la petición nunca pasa por el navegador).
 */
function conPrivilegioRetirado(
  retirar: string,
  restituir: string,
  cuerpo: () => Promise<void>
) {
  const contenedor =
    process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
  const psql = (sentencia: string) =>
    execFileSync(
      'docker',
      [
        'exec', '-i', contenedor, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1',
      ],
      { input: sentencia, stdio: ['pipe', 'pipe', 'pipe'] }
    )
  psql(retirar)
  return cuerpo().finally(() => {
    psql(restituir)
  })
}

/**
 * Deja a un estudiante sin recorrido de transporte activo, usando
 * exclusivamente la aplicación real.
 *
 * Cancela por la pantalla: nunca borra filas, así que el historial crece en
 * vez de desaparecer. Abre su propio contexto con la sesión indicada porque
 * `browser.newContext()` hereda el `storageState` del proyecto.
 */
async function dejarSinRecorridoActivo(browser: Browser, archivoSesion: string) {
  const contexto = await browser.newContext({
    baseURL: BASE_URL,
    storageState: archivoSesion,
  })
  try {
    const page = await contexto.newPage()
    await page.goto('/dashboard/transporte')

    await expect(
      page.getByRole('heading', { name: 'Transporte', level: 1 })
    ).toBeVisible({ timeout: 20_000 })

    const cancelarBoton = page.getByRole('button', { name: 'Cancelar este recorrido' })
    if ((await cancelarBoton.count()) === 0) return

    await cancelarBoton.click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByRole('button', { name: 'Sí, cancelar mi recorrido' }).click()
    await expect(
      page.getByText('Todavía no tenés un recorrido de transporte activo.')
    ).toBeVisible({ timeout: 20_000 })
  } finally {
    await contexto.close()
  }
}

/**
 * Deja a un estudiante sin inscripción de comedor activa, usando
 * exclusivamente la aplicación real. Sirve solo para preparar el fixture de
 * la prueba de frontera de dominio; el resto de las pruebas de este archivo
 * no toca el comedor.
 */
async function dejarSinInscripcionComedorActiva(browser: Browser, archivoSesion: string) {
  const contexto = await browser.newContext({
    baseURL: BASE_URL,
    storageState: archivoSesion,
  })
  try {
    const page = await contexto.newPage()
    await page.goto('/dashboard/comedor')

    await expect(
      page.getByRole('button', { name: /Inscribirme al comedor|Cancelar mi inscripción/ })
    ).toBeVisible({ timeout: 20_000 })

    const cancelarBoton = page.getByRole('button', { name: 'Cancelar mi inscripción' })
    if ((await cancelarBoton.count()) === 0) return

    await cancelarBoton.click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByRole('button', { name: 'Sí, cancelar mi inscripción' }).click()
    await expect(page.getByText('Sin inscripción activa')).toBeVisible({ timeout: 20_000 })
  } finally {
    await contexto.close()
  }
}

/** Alta o cambio que además devuelve el identificador confirmado por el servidor. */
async function establecerYObtenerId(sesion: string, servicioId = TR_NORTE) {
  const alta = await establecer(sesion, servicioId)
  expect(alta.status()).toBe(201)
  const { inscripcion } = await alta.json()
  return inscripcion.id as string
}

test.describe('ESTUDIANTE autenticado — transporte', () => {
  test.slow()

  test('elige un recorrido y el alta persiste tras recargar, ligada a su legajo', async ({
    page,
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)

    await page.goto('/dashboard/transporte')
    await expect(page.getByRole('heading', { name: 'Transporte', level: 1 })).toBeVisible()
    await expect(
      page.getByText('Todavía no tenés un recorrido de transporte activo.')
    ).toBeVisible()
    await capturar(page, 'escritorio-sin-recorrido')

    await page
      .locator('li', { hasText: 'Recorrido Norte' })
      .getByRole('button', { name: 'Elegir este recorrido' })
      .click()

    await expect(page.getByText('Te inscribiste al recorrido TR-NORTE.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('Tu recorrido actual')).toBeVisible()
    await capturar(page, 'escritorio-recorrido-elegido')

    // Persistencia real: se vuelve a pedir la página al servidor.
    await page.reload()
    await expect(page.getByText('Tu recorrido actual')).toBeVisible()
    await capturar(page, 'escritorio-estado-persistido')
  })

  test('cambiar al recorrido ya activo es idempotente: no agrega historial', async ({
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    const id = await establecerYObtenerId(SESION_ESTUDIANTE, TR_NORTE)

    const repetido = await establecer(SESION_ESTUDIANTE, TR_NORTE)
    expect(repetido.status()).toBe(201)
    const { inscripcion } = await repetido.json()
    // Misma fila, no una nueva: el «cambio» al recorrido vigente no crea nada.
    expect(inscripcion.id).toBe(id)
  })

  test('repetir el recorrido vigente sigue siendo idempotente aunque Dirección lo inactive', async ({
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    const id = await establecerYObtenerId(SESION_ESTUDIANTE, TR_NORTE)

    try {
      const inactivacion = await actualizarRecorridoComoDirector(
        TR_NORTE,
        'Recorrido Norte (ficticio)',
        false
      )
      expect(inactivacion.status()).toBe(200)

      // El alumno "vuelve a elegir" el mismo recorrido que ya tenía: como no
      // pide una plaza nueva, tiene que seguir siendo un no-op, no un P5551.
      // (Un destino inactivo DISTINTO sí se rechaza: ver transporte_rls.sql
      // #6bis, que cubre exactamente ese caso contrario.)
      const repetido = await establecer(SESION_ESTUDIANTE, TR_NORTE)
      expect(repetido.status()).toBe(201)
      const { inscripcion } = await repetido.json()
      expect(inscripcion.id).toBe(id)
    } finally {
      const restitucion = await actualizarRecorridoComoDirector(
        TR_NORTE,
        'Recorrido Norte (ficticio)',
        true
      )
      expect(restitucion.status()).toBe(200)
    }
  })

  test('cambia de recorrido de forma atómica: cancela el anterior y activa el nuevo', async ({
    page,
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    await establecerYObtenerId(SESION_ESTUDIANTE, TR_NORTE)

    await page.goto('/dashboard/transporte')
    await expect(page.getByText('Tu recorrido actual')).toBeVisible()

    await page
      .locator('li', { hasText: 'Recorrido Sur' })
      .getByRole('button', { name: 'Cambiar a este recorrido' })
      .click()

    await expect(page.getByText('Cambiaste tu recorrido a TR-SUR.')).toBeVisible({
      timeout: 20_000,
    })
    await capturar(page, 'escritorio-cambio-recorrido')

    await page.reload()
    // El historial conserva el recorrido anterior cancelado; nada se pierde.
    await expect(page.getByRole('heading', { name: 'Recorridos anteriores' })).toBeVisible()
    await expect(page.getByText('Cancelado').first()).toBeVisible()
    await expect(
      page.locator('li', { hasText: 'Recorrido Sur' }).getByText('Tu recorrido actual')
    ).toBeVisible()
  })

  test('un destino inexistente no toca el recorrido vigente', async ({ browser }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    const vigente = await establecerYObtenerId(SESION_ESTUDIANTE, TR_NORTE)

    const fallo = await establecer(
      SESION_ESTUDIANTE,
      '00000000-0000-4000-8000-000000000000'
    )
    expect(fallo.status()).toBe(404)
    const cuerpo = await fallo.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe('El recorrido solicitado no existe.')

    // El recorrido vigente sigue siendo el mismo: no se canceló nada.
    const repetido = await establecer(SESION_ESTUDIANTE, TR_NORTE)
    const { inscripcion } = await repetido.json()
    expect(inscripcion.id).toBe(vigente)
  })

  test('cancela sin reemplazo y el historial se conserva; convive con el comedor', async ({
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    const idTransporte = await establecerYObtenerId(SESION_ESTUDIANTE, TR_NORTE)

    // El comedor es independiente: inscribirse no interfiere con el transporte.
    const comedor = await pedirConSesion(SESION_ESTUDIANTE, '/api/comedor/inscripciones', {
      method: 'POST',
      data: { servicio_id: SERVICIO_COMEDOR },
    })
    expect([201, 409]).toContain(comedor.status())

    const baja = await cancelar(SESION_ESTUDIANTE, idTransporte)
    expect(baja.status()).toBe(200)

    // Reintentar la misma baja: la RPC genérica filtra por estado ACTIVA, así
    // que una inscripción ya cancelada responde igual que una inexistente
    // (mismo comportamiento que el comedor, comedor_rls.sql 6bis).
    const reintento = await cancelar(SESION_ESTUDIANTE, idTransporte)
    expect(reintento.status()).toBe(404)
    const cuerpoReintento = await reintento.text()
    esperarSinFiltraciones(cuerpoReintento)
    expect(JSON.parse(cuerpoReintento).error).toBe(
      'No encontramos una inscripción de transporte activa tuya para cancelar.'
    )
  })

  test('no puede cancelar el recorrido de otro alumno', async ({ browser }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE_AJENO)

    const ajena = await establecerYObtenerId(SESION_ESTUDIANTE_AJENO, TR_SUR)

    const intento = await cancelar(SESION_ESTUDIANTE, ajena)
    expect(intento.status()).toBe(404)
    const cuerpo = await intento.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe(
      'No encontramos una inscripción de transporte activa tuya para cancelar.'
    )
  })

  test('la API de transporte no cancela una inscripción propia de comedor', async ({
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    await dejarSinInscripcionComedorActiva(browser, SESION_ESTUDIANTE)

    // Inscripción propia de COMEDOR, no de transporte.
    const comedor = await pedirConSesion(SESION_ESTUDIANTE, '/api/comedor/inscripciones', {
      method: 'POST',
      data: { servicio_id: SERVICIO_COMEDOR },
    })
    expect(comedor.status()).toBe(201)
    const comedorId = (await comedor.json()).inscripcion.id as string

    // El identificador es real y propio, pero de otro dominio: la ruta de
    // transporte tiene que tratarlo como si no existiera, nunca cancelarlo.
    const intento = await cancelar(SESION_ESTUDIANTE, comedorId)
    expect(intento.status()).toBe(404)
    const cuerpo = await intento.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe(
      'No encontramos una inscripción de transporte activa tuya para cancelar.'
    )

    // Y la inscripción de comedor sigue activa: no se tocó nada. Un segundo
    // alta la rechaza por duplicado, que es la prueba de que sigue viva.
    const reintentoAlta = await pedirConSesion(SESION_ESTUDIANTE, '/api/comedor/inscripciones', {
      method: 'POST',
      data: { servicio_id: SERVICIO_COMEDOR },
    })
    expect(reintentoAlta.status()).toBe(409)
    const cuerpoReintento = await reintentoAlta.text()
    expect(JSON.parse(cuerpoReintento).error).toBe('Ya tenés una inscripción activa al comedor.')

    // Limpieza: se cancela por la vía correcta para no dejar estado a la
    // siguiente corrida.
    const bajaLegitima = await pedirConSesion(
      SESION_ESTUDIANTE,
      `/api/comedor/inscripciones/${comedorId}`,
      { method: 'PATCH', data: { accion: 'cancelar' } }
    )
    expect(bajaLegitima.status()).toBe(200)
  })

  test('el cuerpo no admite un alumno, un perfil ni un legajo elegidos por el navegador', async () => {
    for (const data of [
      { servicio_id: TR_NORTE, alumno_id: '11111111-1111-4111-8111-111111111111' },
      { servicio_id: TR_NORTE, legajo_nro: LEGAJO_ESTUDIANTE },
    ]) {
      const respuesta = await pedirConSesion(
        SESION_ESTUDIANTE,
        '/api/transporte/inscripciones',
        { method: 'POST', data }
      )
      expect(respuesta.status()).toBe(400)
      const cuerpo = await respuesta.text()
      esperarSinFiltraciones(cuerpo)
      expect(JSON.parse(cuerpo).error).toBe('La petición contiene campos no permitidos')
    }
  })

  test('no existe ninguna superficie DELETE para un estudiante autenticado', async () => {
    const borradoColeccion = await pedirConSesion(
      SESION_ESTUDIANTE,
      '/api/transporte/inscripciones',
      { method: 'DELETE' }
    )
    expect(borradoColeccion.status()).toBe(405)

    const borradoElemento = await pedirConSesion(
      SESION_ESTUDIANTE,
      '/api/transporte/inscripciones/11111111-1111-4111-8111-111111111111',
      { method: 'DELETE' }
    )
    expect(borradoElemento.status()).toBe(405)
  })

  test('escapa del diálogo de confirmación de baja sin cancelar nada', async ({
    page,
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    await establecerYObtenerId(SESION_ESTUDIANTE, TR_NORTE)

    await page.goto('/dashboard/transporte')
    const disparador = page.getByRole('button', { name: 'Cancelar este recorrido' })
    await disparador.click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByRole('button', { name: 'Volver sin cancelar' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(disparador).toBeFocused()

    await page.reload()
    await expect(page.getByText('Tu recorrido actual')).toBeVisible()
  })

  test('la pantalla del alumno es usable a 375 px, sin desplazamiento horizontal', async ({
    page,
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    await page.setViewportSize({ width: 375, height: 812 })

    await page.goto('/dashboard/transporte')
    await expect(page.getByRole('heading', { name: 'Transporte', level: 1 })).toBeVisible()
    await capturar(page, 'movil-sin-recorrido')

    await page
      .locator('li', { hasText: 'Recorrido Norte' })
      .getByRole('button', { name: 'Elegir este recorrido' })
      .click()
    await expect(page.getByText('Tu recorrido actual')).toBeVisible({ timeout: 20_000 })
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
    ).toBe(false)
    await capturar(page, 'movil-recorrido-elegido')
  })
})

test.describe('ESTUDIANTE INACTIVO autenticado — transporte', () => {
  test('la pantalla explica por qué no puede elegir un recorrido y el botón queda deshabilitado', async ({
    page,
  }) => {
    await page.goto('/dashboard/transporte')
    await expect(page.getByRole('heading', { name: 'Transporte', level: 1 })).toBeVisible()
    await expect(page.getByText(/Tu legajo académico no está activo/)).toBeVisible()
    await expect(
      page.locator('li', { hasText: 'Recorrido Norte' }).getByRole('button')
    ).toBeDisabled()
    await capturar(page, 'escritorio-alumno-inactivo')
  })

  test('la API tampoco lo deja establecer un recorrido', async () => {
    const respuesta = await establecer(SESION_ESTUDIANTE_INACTIVO, TR_NORTE)
    expect(respuesta.status()).toBe(409)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toContain('Tu legajo académico no está activo')
  })
})

test.describe('DIRECTOR autenticado — transporte', () => {
  test.slow()

  test('consulta los alumnos inscriptos y mantiene la descripción de un recorrido', async ({
    page,
    browser,
  }) => {
    await dejarSinRecorridoActivo(browser, SESION_ESTUDIANTE)
    await establecerYObtenerId(SESION_ESTUDIANTE, TR_NORTE)

    await page.goto('/dashboard/transporte')
    await expect(page.getByRole('heading', { name: 'Transporte', level: 1 })).toBeVisible()
    await expect(page.getByText(/alumno\(s\) con inscripción activa/).first()).toBeVisible()
    await capturar(page, 'escritorio-gestion')

    await page
      .locator('li', { hasText: 'Recorrido Norte' })
      .getByRole('button', { name: /Editar/ })
      .click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    const nombre = dialogo.getByLabel('Nombre del recorrido')
    await nombre.fill('Recorrido Norte (ficticio, prueba E2E)')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page.getByText('Actualizaste TR-NORTE.')).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByRole('heading', { name: 'Recorrido Norte (ficticio, prueba E2E)' })
    ).toBeVisible()

    // Se revierte para no dejar el catálogo de referencia alterado.
    await page
      .locator('li', { hasText: 'Recorrido Norte' })
      .getByRole('button', { name: /Editar/ })
      .click()
    await dialogo.getByLabel('Nombre del recorrido').fill('Recorrido Norte (ficticio)')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByText('Actualizaste TR-NORTE.')).toBeVisible({ timeout: 20_000 })
  })

  test('un fallo al leer el catálogo muestra un error real, no un catálogo vacío', async ({
    page,
  }) => {
    await conPrivilegioRetirado(
      'REVOKE SELECT ON public.recorridos_transporte FROM authenticated;',
      'GRANT SELECT ON public.recorridos_transporte TO authenticated;',
      async () => {
        await page.goto('/dashboard/transporte')

        // No es "no hay recorridos": es que no se pudieron leer. La pantalla
        // no puede confundir las dos cosas.
        await expect(
          page.getByRole('alert').filter({ hasText: 'No pudimos cargar el transporte' })
        ).toBeVisible({ timeout: 20_000 })
        // Prueba de que GestionTransporte no llegó a renderizar en absoluto:
        // no hay un catálogo vacío disfrazando el error.
        await expect(page.getByRole('heading', { name: 'Recorridos' })).toHaveCount(0)
        await capturar(page, 'escritorio-director-error-catalogo')
      }
    )

    // Restituido el privilegio, la misma ruta vuelve a mostrar el catálogo real.
    await page.goto('/dashboard/transporte')
    await expect(page.getByRole('heading', { name: 'Recorridos' })).toBeVisible()
    await expect(
      page.getByRole('alert').filter({ hasText: 'No pudimos cargar el transporte' })
    ).toHaveCount(0)
  })

  test('no obtiene ninguna facultad de establecer un recorrido en nombre del alumno', async () => {
    const alta = await establecer(SESION_DIRECTORA, TR_NORTE)
    expect(alta.status()).toBe(403)
    const cuerpo = await alta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe(
      'Solo un estudiante puede inscribirse o cambiar de recorrido de transporte.'
    )
  })

  test('el código y el tipo de un recorrido no se aceptan en la ruta de mantenimiento', async () => {
    const respuesta = await pedirConSesion(
      SESION_DIRECTORA,
      `/api/transporte/recorridos/${TR_NORTE}`,
      { method: 'PATCH', data: { nombre: 'x', activo: true, codigo: 'TR-NORTE-2' } }
    )
    expect(respuesta.status()).toBe(400)
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
  test.describe(`${actor.etiqueta} autenticado — transporte`, () => {
    test('no ve Transporte en la navegación ni accede a la pantalla', async ({ page }) => {
      await page.goto('/dashboard')
      await expect(
        page
          .getByRole('navigation', { name: 'Menú del dashboard' })
          .getByRole('link', { name: 'Transporte' })
      ).toHaveCount(0)

      await page.goto('/dashboard/transporte')
      await expect(
        page.getByRole('heading', { name: 'Acceso restringido' })
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Elegir este recorrido' })).toHaveCount(0)
    })

    test('recibe 403 al establecer un recorrido, sin filtrar detalle técnico', async () => {
      const alta = await establecer(actor.sesion, TR_NORTE)
      expect(alta.status()).toBe(403)
      esperarSinFiltraciones(await alta.text())
    })
  })
}
