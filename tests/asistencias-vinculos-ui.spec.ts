import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Pantalla de asistencias por vínculo vigente, en el navegador (EPT-66 D).
 *
 * Corre en los tres perfiles —escritorio, Pixel 5 e iPhone 13— sobre el banco
 * visual `/pruebas-ui/asistencias`, que renderiza las vistas reales por rol.
 * Intercepta `/api/asistencias` (personal) y las lecturas de Supabase (alumno y
 * padre): así se comprueba qué le pide la pantalla al servidor —nunca una
 * identidad de quien registra—, que no muestra un éxito antes de la confirmación,
 * y cómo queda tras un rechazo por revocación. No prueba la base ni la API real:
 * eso lo hacen las suites SQL, de concurrencia y `asistencias-vinculos-auth`.
 * Todos los datos son sintéticos.
 */

const BANCO = '/pruebas-ui/asistencias'
const HOY = new Date().toLocaleDateString('en-CA')
const A1 = { id: 'e2e66d00-0000-4000-8000-0000000000a1', nombre: 'Uma', apellido: 'Vinculo Academico', legajo_nro: 'LEG-66D-E1' }
const A2 = { id: 'e2e66d00-0000-4000-8000-0000000000a2', nombre: 'Dani', apellido: 'Vinculo Doble', legajo_nro: 'LEG-66D-E2' }
const ETIQUETA_A1 = `${A1.apellido}, ${A1.nombre} (${A1.legajo_nro})`
const ETIQUETA_A2 = `${A2.apellido}, ${A2.nombre} (${A2.legajo_nro})`
const MENSAJE_NO_DISPONIBLE = 'El alumno ya no está a tu cargo o no está disponible. Actualizamos la lista.'

type Panel = {
  estudiantes: typeof A1[]
  asistencias: { id: string; fecha: string; estado: string; estudiante_id: string }[]
  historial: { estudiante_id: string; fecha: string; estado: string }[]
}

type Llamada = { metodo: string; ruta: string; cuerpo: Record<string, unknown> | null }

function fila(id: string, alumno: typeof A1, estado = 'PRESENTE') {
  return { id, fecha: HOY, estado, estudiante_id: alumno.id }
}

/** Intercepta la API y devuelve el registro de llamadas. `panel` puede cambiar entre llamadas. */
async function simular(
  page: Page,
  opciones: {
    panel: () => Panel | { estado: number; cuerpo: unknown }
    registro?: (cuerpo: Record<string, unknown>) => Promise<{ estado: number; cuerpo: unknown }> | { estado: number; cuerpo: unknown }
  }
) {
  const llamadas: Llamada[] = []
  await page.route(/\/api\/asistencias(\?.*)?$/u, async (route: Route) => {
    const peticion = route.request()
    const texto = peticion.postData()
    const cuerpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : null
    llamadas.push({ metodo: peticion.method(), ruta: new URL(peticion.url()).pathname + new URL(peticion.url()).search, cuerpo })

    if (peticion.method() === 'GET') {
      const respuesta = opciones.panel()
      const conEstado = 'estado' in respuesta && 'cuerpo' in respuesta
      await route.fulfill({
        status: conEstado ? respuesta.estado : 200,
        contentType: 'application/json',
        body: JSON.stringify(conEstado ? respuesta.cuerpo : respuesta),
      })
      return
    }
    const respuesta = await opciones.registro?.(cuerpo ?? {})
    await route.fulfill({
      status: respuesta?.estado ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(respuesta?.cuerpo ?? {}),
    })
  })
  return llamadas
}

const sinDesborde = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function opciones(page: Page): Promise<string[]> {
  const selector = page.getByLabel('Alumno', { exact: true })
  return selector.locator('option').evaluateAll((lista) =>
    lista.filter((o) => (o as HTMLOptionElement).value !== '').map((o) => o.textContent?.trim() ?? '')
  )
}

test.describe('Asistencias del personal (banco visual)', () => {
  test('el docente ve solo a los alumnos que recibe del servidor, sin desbordar la pantalla', async ({ page }) => {
    await simular(page, {
      panel: () => ({ estudiantes: [A1, A2], asistencias: [fila('f1', A1)], historial: [] }),
    })
    await page.goto(BANCO)

    await expect(page.getByRole('heading', { name: 'Control de Asistencias' })).toBeVisible()
    await expect(page.getByText('los alumnos que tenés a cargo', { exact: false })).toBeVisible()
    await expect.poll(() => opciones(page)).toEqual([ETIQUETA_A1, ETIQUETA_A2].sort())
    const tabla = page.getByRole('table', { name: 'Tabla de asistencias' })
    await expect(tabla.getByRole('row').filter({ hasText: A1.apellido })).toBeVisible()
    expect(await sinDesborde(page)).toBe(true)

    // Los controles principales son alcanzables por teclado y visibles.
    await expect(page.getByLabel('Filtrar por fecha')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Registrar' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Actualizar' })).toBeVisible()
  })

  test('un docente sin alumnos a cargo ve el estado vacío y no puede registrar', async ({ page }) => {
    await simular(page, { panel: () => ({ estudiantes: [], asistencias: [], historial: [] }) })
    await page.goto(BANCO)

    await expect(page.getByText('No tenés alumnos a cargo en este momento.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Registrar' })).toBeDisabled()
    await expect(page.getByText('No hay registros para esta fecha')).toBeVisible()
    expect(await sinDesborde(page)).toBe(true)
  })

  test('registrar: el cuerpo no lleva ninguna identidad de quien registra y el éxito espera al servidor', async ({ page }) => {
    let liberar!: () => void
    const confirmacion = new Promise<void>((resolver) => {
      liberar = resolver
    })
    let panel: Panel = { estudiantes: [A1, A2], asistencias: [], historial: [] }
    const llamadas = await simular(page, {
      panel: () => panel,
      registro: async () => {
        await confirmacion
        panel = { ...panel, asistencias: [fila('f1', A2, 'AUSENTE')] }
        return {
          estado: 201,
          cuerpo: { ok: true, asistencia: { id: 'f1', estudiante_id: A2.id, fecha: HOY, estado: 'AUSENTE', resultado: 'CREADA' } },
        }
      },
    })
    await page.goto(BANCO)
    await expect.poll(() => opciones(page)).toHaveLength(2)

    await page.getByLabel('Alumno', { exact: true }).selectOption({ label: ETIQUETA_A2 })
    await page.getByLabel('Estado', { exact: true }).selectOption('AUSENTE')
    await page.getByRole('button', { name: 'Registrar' }).click()

    // Mientras el servidor no confirma, no hay éxito optimista ni fila nueva.
    await expect.poll(() => llamadas.some((l) => l.metodo === 'POST')).toBe(true)
    await expect(page.getByText('Asistencia registrada')).toHaveCount(0)
    await expect(page.getByText('No hay registros para esta fecha')).toBeVisible()

    liberar()
    await expect(page.getByText('Asistencia registrada')).toBeVisible()
    const tabla = page.getByRole('table', { name: 'Tabla de asistencias' })
    await expect(tabla.getByRole('row').filter({ hasText: A2.apellido })).toBeVisible()

    const envio = llamadas.find((l) => l.metodo === 'POST')
    expect(envio?.cuerpo).toEqual({ estudiante_id: A2.id, fecha: HOY, estado: 'AUSENTE' })
    expect(Object.keys(envio?.cuerpo ?? {})).not.toContain('docente_id')
    expect(llamadas.filter((l) => l.metodo === 'GET').length).toBeGreaterThanOrEqual(2)
  })

  test('revocación con la página abierta: el rechazo es explícito, no hay éxito y la lista se corrige', async ({ page }) => {
    let revocado = false
    const llamadas = await simular(page, {
      panel: () => ({
        estudiantes: revocado ? [A2] : [A1, A2],
        asistencias: revocado ? [] : [fila('f1', A1)],
        historial: [],
      }),
      registro: () => {
        revocado = true
        return { estado: 404, cuerpo: { error: MENSAJE_NO_DISPONIBLE, codigo: 'ALUMNO_NO_DISPONIBLE' } }
      },
    })
    await page.goto(BANCO)
    await expect.poll(() => opciones(page)).toHaveLength(2)
    const tabla = page.getByRole('table', { name: 'Tabla de asistencias' })
    const filaA1 = tabla.getByRole('row').filter({ hasText: A1.apellido })
    await expect(filaA1).toBeVisible()

    await filaA1.getByRole('button', { name: `Marcar ${A1.nombre} como ausente` }).click()

    await expect(page.getByRole('alert').filter({ hasText: MENSAJE_NO_DISPONIBLE })).toBeVisible()
    await expect(page.getByText('Asistencia actualizada')).toHaveCount(0)
    await expect(tabla.getByRole('row').filter({ hasText: A1.apellido })).toHaveCount(0)
    await expect.poll(() => opciones(page)).toEqual([ETIQUETA_A2])
    expect(llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(1)
    expect(await sinDesborde(page)).toBe(true)
  })

  test('un error de carga se informa con una acción para reintentar', async ({ page }) => {
    let falla = true
    await simular(page, {
      panel: () =>
        falla
          ? { estado: 500, cuerpo: { error: 'No pudimos completar la operación. Volvé a intentarlo.', codigo: 'ERROR_INESPERADO' } }
          : { estudiantes: [A1], asistencias: [], historial: [] },
    })
    await page.goto(BANCO)

    const alerta = page.getByRole('alert').filter({ hasText: 'No pudimos completar la operación' })
    await expect(alerta).toBeVisible()
    falla = false
    await alerta.getByRole('button', { name: 'Reintentar' }).click()
    await expect(alerta).toHaveCount(0)
    await expect.poll(() => opciones(page)).toEqual([ETIQUETA_A1])
  })

  test('la Dirección ve la misma pantalla sin el texto de alumnos a cargo', async ({ page }) => {
    await simular(page, { panel: () => ({ estudiantes: [A1, A2], asistencias: [], historial: [] }) })
    await page.goto(`${BANCO}?vista=director`)
    await expect(page.getByText('Registrá y consultá la asistencia diaria de los alumnos')).toBeVisible()
    await expect(page.getByText('los alumnos que tenés a cargo', { exact: false })).toHaveCount(0)
    expect(await sinDesborde(page)).toBe(true)
  })
})

test.describe('Asistencias de alumno y padre (solo lectura)', () => {
  for (const vista of ['estudiante', 'padre'] as const) {
    test(`${vista}: historial de solo lectura, sin controles de registro`, async ({ page }) => {
      const filas = [
        { id: 'p1', fecha: '2031-01-10', estado: 'PRESENTE', estudiante_id: A1.id, estudiante: A1 },
        { id: 'p2', fecha: '2031-01-11', estado: 'AUSENTE', estudiante_id: A1.id, estudiante: A1 },
      ]
      let escrituras = 0
      await page.route(/\/rest\/v1\/asistencias/u, async (route: Route) => {
        if (route.request().method() !== 'GET') escrituras += 1
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, accept, accept-profile, content-profile, range',
            'content-type': 'application/json',
          },
          body: JSON.stringify(filas),
        })
      })
      await page.goto(`${BANCO}?vista=${vista}`)

      await expect(
        page.getByRole('heading', { name: vista === 'padre' ? 'Asistencia de mis hijos' : 'Mi asistencia' })
      ).toBeVisible()
      const tabla = page.getByRole('table', { name: 'Historial de asistencia' })
      await expect(tabla.getByRole('row')).toHaveCount(3) // encabezado + 2 filas
      await expect(page.getByRole('button', { name: 'Registrar' })).toHaveCount(0)
      await expect(page.getByLabel('Alumno', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Marcar / })).toHaveCount(0)
      expect(escrituras).toBe(0)
      expect(await sinDesborde(page)).toBe(true)
    })
  }
})
