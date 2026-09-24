import { test, expect, request as crearContexto } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const HIJO_APTO = { nombre: 'Lara', apellido: 'Vinculada' }
const ESTUDIANTE_AJENO = { nombre: 'Celeste', apellido: 'Ajena' }
const CAPTURAS = path.join('docs', 'evidence', 'EPT-13')

async function captura(page: import('@playwright/test').Page, nombre: string) {
  fs.mkdirSync(CAPTURAS, { recursive: true })
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true })
}

test.describe('PADRE autenticado', () => {
  test.describe.configure({ retries: 0 })
  test('consulta solamente a los hijos vinculados, matricula y comprueba persistencia', async ({ page, request, browser }) => {
    await page.goto('/dashboard/hijos')
    await expect(page.getByRole('heading', { name: 'Mis hijos' })).toBeVisible()
    await expect(page.getByText(`${HIJO_APTO.nombre} ${HIJO_APTO.apellido}`)).toBeVisible()
    await expect(page.getByText(`${ESTUDIANTE_AJENO.nombre} ${ESTUDIANTE_AJENO.apellido}`)).toHaveCount(0)
    await captura(page, '01-escritorio-hijos-vinculados')

    const listado = await request.get('/api/hijos')
    expect(listado.status()).toBe(200)
    const datos = await listado.json()
    expect(datos.hijos).toHaveLength(2)
    const hijo = datos.hijos.find((item: { nombre: string }) => item.nombre === HIJO_APTO.nombre)
    expect(hijo?.estado).toBe('INACTIVO')
    const ajeno = await request.get(`/api/hijos/${'00000000-0000-4000-8000-000000000099'}`)
    expect(ajeno.status()).toBe(404)
    const anonimo = await crearContexto.newContext({
      baseURL: 'http://localhost:3000',
      storageState: { cookies: [], origins: [] },
    })
    try {
      expect((await anonimo.get('/api/hijos')).status()).toBe(401)
    } finally {
      await anonimo.dispose()
    }
    expect((await request.get('/api/hijos/identificador-invalido')).status()).toBe(400)
    expect((await request.get(`/api/hijos/${hijo.id}/matricula`)).status()).toBe(405)
    expect((await request.post(`/api/hijos/${hijo.id}/matricula`, { data: { curso_id: 'no-es-uuid' } })).status()).toBe(400)
    expect((await request.post(`/api/hijos/${hijo.id}/matricula`, { data: { curso_id: datos.cursos[0].id, padre_id: hijo.id } })).status()).toBe(400)
    expect((await request.post(`/api/hijos/${hijo.id}/matricula`, { data: { curso_id: '00000000-0000-4000-8000-000000000099' } })).status()).toBe(422)

    await page.getByRole('article').filter({ hasText: `${HIJO_APTO.nombre} ${HIJO_APTO.apellido}` }).getByRole('button', { name: 'Seleccionar para matricular' }).click()
    await captura(page, '02-hijo-apto')
    const selector = page.getByLabel('Curso activo')
    await expect(selector.locator('option')).toHaveCount(datos.cursos.length + 1)
    await selector.selectOption({ index: 1 })
    await captura(page, '03-cursos-activos')
    await page.getByRole('button', { name: 'Revisar matrícula' }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo.getByRole('heading', { name: 'Confirmar matrícula' })).toBeVisible()
    await expect(dialogo.getByText(/Después no podrás cambiar el curso/)).toBeVisible()
    await captura(page, '04-confirmacion')
    let registrarRetencion: () => void = () => {}
    let liberarSolicitud: () => void = () => {}
    const solicitudRetenida = new Promise<void>((resolve) => { registrarRetencion = resolve })
    const continuarSolicitud = new Promise<void>((resolve) => { liberarSolicitud = resolve })
    await page.route('**/api/hijos/*/matricula', async (route) => {
      registrarRetencion()
      await continuarSolicitud
      await route.continue()
    })
    await dialogo.getByRole('button', { name: 'Confirmar matrícula' }).click()
    try {
      await solicitudRetenida
      await expect(page.getByRole('status', { name: 'Estado de la matrícula' })).toContainText('Enviando')
      await captura(page, '04b-envio-autenticado')
    } finally {
      liberarSolicitud()
    }
    await expect(page.getByRole('status', { name: 'Estado de la matrícula' })).toContainText('confirmó')
    await captura(page, '05-exito')
    await page.reload()
    await expect(page.getByText('Activo', { exact: true })).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: `${HIJO_APTO.nombre} ${HIJO_APTO.apellido}` }).getByText('Sin matrícula vigente')).toHaveCount(0)
    await expect(page.getByRole('article').filter({ hasText: `${HIJO_APTO.nombre} ${HIJO_APTO.apellido}` }).getByRole('button', { name: 'Seleccionar para matricular' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /cambiar curso|borrar|cerrar matrícula/i })).toHaveCount(0)
    await captura(page, '06-persistencia-recarga')
    await page.setViewportSize({ width: 375, height: 812 })
    await captura(page, '07-movil-375')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    const segunda = await request.post(`/api/hijos/${hijo.id}/matricula`, {
      data: { curso_id: datos.cursos[0].id },
    })
    expect(segunda.status()).toBe(409)
    expect((await segunda.json()).error).toMatch(/alumno ya está activo|matrícula vigente/i)

    const contextoDirector = await browser.newContext({ baseURL: 'http://localhost:3000', storageState: 'tests/.auth/directora.json' })
    try {
      const paginaDirector = await contextoDirector.newPage()
      await paginaDirector.goto('/dashboard/alumnos')
      await expect(paginaDirector.getByRole('link', { name: `${HIJO_APTO.apellido}, ${HIJO_APTO.nombre}` }).first()).toBeVisible()
      await captura(paginaDirector, '09-directora-matricula-visible')
    } finally {
      await contextoDirector.close()
    }
  })

  test('dos solicitudes simultáneas generan exactamente una matrícula', async ({ request }) => {
    const listado = await request.get('/api/hijos')
    const datos = await listado.json()
    const hijo = datos.hijos.find((item: { nombre: string }) => item.nombre === 'Nicolás')
    expect(hijo?.estado).toBe('INACTIVO')
    const cursoId = datos.cursos[0].id
    const resultados = await Promise.all([
      request.post(`/api/hijos/${hijo.id}/matricula`, { data: { curso_id: cursoId } }),
      request.post(`/api/hijos/${hijo.id}/matricula`, { data: { curso_id: cursoId } }),
    ])
    expect(resultados.map((respuesta) => respuesta.status()).sort()).toEqual([201, 409])
    const exitosa = resultados.find((respuesta) => respuesta.status() === 201)
    if (!exitosa) throw new Error('Ninguna solicitud confirmó la matrícula.')
    const confirmacion = await exitosa.json()
    expect(confirmacion.matricula_id).toMatch(/^[0-9a-f-]{36}$/i)
    const despues = await request.get(`/api/hijos/${hijo.id}`)
    expect(despues.status()).toBe(200)
    const situacion = (await despues.json()).hijo
    expect(situacion.estado).toBe('ACTIVO')
    expect(situacion.matricula_id).toBe(confirmacion.matricula_id)
    const curso = datos.cursos.find((item: { id: string }) => item.id === cursoId)
    expect(situacion.curso_denominacion).toBe(curso.denominacion)
    expect(situacion.curso_division).toBe(curso.division)
    expect(situacion.nivel_nombre).toBe(curso.nivel.nombre)

    // Consulta de solo lectura contra el contenedor descartable: el endpoint
    // parental proyecta la matrícula vigente, no expone el historial completo.
    if (process.env.EPT_SUPABASE_LOCAL !== '1') throw new Error('Se requiere la base local descartable.')
    expect(hijo.id).toMatch(/^[0-9a-f-]{36}$/i)
    const contenedor = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
    const filas = execFileSync('docker', [
      'exec', '-i', contenedor, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-c',
      `SELECT COALESCE(json_agg(json_build_object('id', id, 'curso_id', curso_id, 'fecha_cierre', fecha_cierre)), '[]'::json) FROM public.matriculas WHERE alumno_id = '${hijo.id}';`,
    ], { encoding: 'utf8' }).trim()
    const matriculas = JSON.parse(filas) as { id: string; curso_id: string; fecha_cierre: string | null }[]
    expect(matriculas).toEqual([{ id: confirmacion.matricula_id, curso_id: cursoId, fecha_cierre: null }])
  })
})

test.describe('PADRE SEGUNDO autenticado', () => {
  test('no puede enumerar ni matricular al hijo ajeno', async ({ request, page }) => {
    const listado = await request.get('/api/hijos')
    expect(listado.status()).toBe(200)
    expect((await listado.json()).hijos).toHaveLength(0)
    await page.goto('/dashboard/hijos')
    await expect(page.getByText('Todavía no tenés hijos vinculados')).toBeVisible()
    await captura(page, '08-padre-sin-hijos')
  })
})

for (const actor of ['ESTUDIANTE', 'DOCENTE', 'PERSONAL']) {
  test.describe(`${actor} autenticado`, () => {
    test('no puede acceder al listado parental', async ({ request }) => {
      expect((await request.get('/api/hijos')).status()).toBe(403)
    })
  })
}
