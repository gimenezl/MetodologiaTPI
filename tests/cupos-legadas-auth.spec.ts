import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * EPT-66 · inscripciones a talleres con la aplicación nueva contra la base REAL
 * (PostgREST + RLS + funciones de PostgreSQL), en el navegador con sesiones por rol.
 *
 * Complementa a `cupos-legadas-ui.spec.ts`, que intercepta las peticiones: acá nada
 * se simula. Corre solo contra el stack local descartable (`EPT_SUPABASE_LOCAL=1`)
 * con datos sintéticos.
 */

const TALLER = 'Taller real EPT-66'
const DNI_ALUMNO = '99900002' // Beto Estudiante
const DNI_AJENO = '99900003' // Celeste Ajena

function psql(sql: string): string {
  if (process.env.EPT_SUPABASE_LOCAL !== '1') throw new Error('Se requiere la base local descartable.')
  const contenedor = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
  return execFileSync(
    'docker',
    ['exec', '-i', contenedor, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' }
  ).trim()
}

function sembrarTaller() {
  psql(`
    INSERT INTO public.actividades (nombre, tipo, cupo_maximo, activo)
    SELECT '${TALLER}', 'TALLER', 1, TRUE
    WHERE NOT EXISTS (SELECT 1 FROM public.actividades WHERE nombre = '${TALLER}');
  `)
}

function filas(dni: string) {
  const salida = psql(`
    SELECT COALESCE(json_agg(json_build_object('estado', i.estado, 'baja', i.fecha_baja IS NOT NULL) ORDER BY i.fecha_inscripcion, i.id), '[]'::json)
    FROM public.inscripciones i
    JOIN public.perfiles p ON p.id = i.estudiante_id
    JOIN public.actividades a ON a.id = i.actividad_id
    WHERE p.dni = '${dni}' AND a.nombre = '${TALLER}';
  `)
  return JSON.parse(salida) as { estado: string; baja: boolean }[]
}

function tarjeta(page: Page) {
  return page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: TALLER }) }).first()
}

test.describe('ESTUDIANTE autenticado — cupos con la base real', () => {
  test.describe.configure({ mode: 'serial', retries: 0 })
  test.beforeAll(() => sembrarTaller())

  test('se inscribe, se da de baja y se reinscribe: la baja es lógica y la reinscripción crea una fila', async ({ page }) => {
    await page.goto('/dashboard/cupos')
    await expect(tarjeta(page)).toBeVisible()

    await tarjeta(page).getByRole('button', { name: 'Inscribirme' }).click()
    await expect(page.getByText('¡Te inscribiste a la actividad!')).toBeVisible()
    expect(filas(DNI_ALUMNO)).toEqual([{ estado: 'ACTIVO', baja: false }])
    await expect(tarjeta(page).getByText('1 / 1 inscriptos')).toBeVisible()

    await tarjeta(page).getByRole('button', { name: 'Darme de baja' }).click()
    await expect(page.getByText('Te diste de baja de la actividad')).toBeVisible()
    expect(filas(DNI_ALUMNO)).toEqual([{ estado: 'BAJA', baja: true }])

    await page.reload()
    await tarjeta(page).getByRole('button', { name: 'Inscribirme' }).click()
    await expect(page.getByText('¡Te inscribiste a la actividad!')).toBeVisible()
    expect(filas(DNI_ALUMNO)).toEqual([
      { estado: 'BAJA', baja: true },
      { estado: 'ACTIVO', baja: false },
    ])

    await page.reload()
    await expect(tarjeta(page).getByRole('button', { name: 'Darme de baja' })).toBeVisible()
  })

  test('las peticiones del navegador solo usan funciones y nunca escriben la tabla', async ({ page }) => {
    const escrituras: string[] = []
    page.on('request', (peticion) => {
      const url = new URL(peticion.url())
      if (/\/rest\/v1\/inscripciones(\?|$)/u.test(url.pathname + url.search) && peticion.method() !== 'GET') {
        escrituras.push(`${peticion.method()} ${url.pathname}`)
      }
    })
    await page.goto('/dashboard/cupos')
    await tarjeta(page).getByRole('button', { name: 'Darme de baja' }).click()
    await expect(page.getByText('Te diste de baja de la actividad')).toBeVisible()
    expect(escrituras).toEqual([])
    expect(filas(DNI_ALUMNO).map((fila) => fila.estado)).toEqual(['BAJA', 'BAJA'])
    // Deja al alumno inscripto para que el cupo de 1 quede ocupado en la prueba siguiente.
    await tarjeta(page).getByRole('button', { name: 'Inscribirme' }).click()
    await expect(page.getByText('¡Te inscribiste a la actividad!')).toBeVisible()
    expect(filas(DNI_ALUMNO).map((fila) => fila.estado)).toEqual(['BAJA', 'BAJA', 'ACTIVO'])
  })
})

test.describe('ESTUDIANTE AJENO autenticado — cupos con la base real', () => {
  test('con el cupo lleno no puede inscribirse y no ve a otros alumnos', async ({ page }) => {
    await page.goto('/dashboard/cupos')
    await expect(tarjeta(page)).toBeVisible()
    await expect(tarjeta(page).getByRole('button', { name: 'Sin cupo' })).toBeDisabled()
    await expect(page.locator('body')).not.toContainText('Estudiante, Beto')
    expect(filas(DNI_AJENO)).toEqual([])
  })
})

test.describe('DIRECTOR autenticado — cupos con la base real', () => {
  test('refresca la lista abierta tras alta, baja y reinscripción sin ocultarla', async ({ page }) => {
    const nombre = 'Taller refresco EPT-66'
    psql(`
      INSERT INTO public.actividades (nombre, tipo, cupo_maximo, activo)
      SELECT '${nombre}', 'TALLER', 1, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM public.actividades WHERE nombre = '${nombre}');
    `)
    const alumnoId = psql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_ALUMNO}';`)
    await page.goto('/dashboard/cupos')
    const taller = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: nombre }) }).first()
    await expect(taller.getByText('0 / 1 inscriptos')).toBeVisible()
    await taller.getByRole('button', { name: 'Ver inscriptos (0)' }).click()
    await expect(taller.getByText('No hay alumnos inscriptos')).toBeVisible()
    await page.getByLabel('Seleccioná el alumno').selectOption(alumnoId)

    for (let ciclo = 0; ciclo < 2; ciclo++) {
      await taller.getByRole('button', { name: 'Inscribir', exact: true }).click()
      await expect(taller.getByText('1 / 1 inscriptos')).toBeVisible()
      await expect(taller.getByRole('button', { name: 'Ocultar inscriptos (1)' })).toBeVisible()
      await expect(taller.getByText('Estudiante, Beto', { exact: true })).toBeVisible()
      await expect(taller.getByText('No hay alumnos inscriptos')).toHaveCount(0)
      await taller.getByRole('button', { name: 'Dar de baja', exact: true }).click()
      await expect(taller.getByText('0 / 1 inscriptos')).toBeVisible()
      await expect(taller.getByRole('button', { name: 'Ocultar inscriptos (0)' })).toBeVisible()
      await expect(taller.getByText('No hay alumnos inscriptos')).toBeVisible()
      await expect(taller.getByRole('button', { name: 'Dar de baja', exact: true })).toHaveCount(0)
    }

    expect(psql(`
      SELECT count(*) FROM public.inscripciones i
      JOIN public.actividades a ON a.id = i.actividad_id
      WHERE a.nombre = '${nombre}' AND i.estudiante_id = '${alumnoId}' AND i.estado = 'BAJA';
    `)).toBe('2')
  })

  test('ve los inscriptos del taller', async ({ page }) => {
    sembrarTaller()
    await page.goto('/dashboard/cupos')
    await expect(page.getByRole('heading', { name: 'Gestión de Cupos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: TALLER })).toBeVisible()
    await page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: TALLER }) }).first()
      .getByRole('button', { name: /inscriptos/ }).click()
    await expect(page.locator('body')).toContainText(/Estudiante|No hay alumnos inscriptos/)
  })
})

test.describe('DOCENTE autenticado — cupos con la base real', () => {
  test('no inscribe ni lista inscriptos: ve el aviso y la disponibilidad', async ({ page }) => {
    sembrarTaller()
    await page.goto('/dashboard/cupos')
    await expect(page.getByText('La inscripción de alumnos a los talleres la realiza Dirección.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Ver inscriptos/ })).toHaveCount(0)
    await expect(page.getByText('Inscribir alumno a actividad')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Estudiante, Beto')
  })
})
