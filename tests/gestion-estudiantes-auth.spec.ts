import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * Regresión de Asistencias y Cupos para el personal (EPT-58).
 *
 * Desde EPT-58 los nombres de los alumnos llegan por
 * `listar_estudiantes_para_gestion()` y no por la lectura de `perfiles`. Estas
 * pruebas exigen, con sesiones reales, el mismo conjunto de alumnos que la base
 * tiene con rol ESTUDIANTE, con el mismo nombre, apellido y legajo, y las mismas
 * operaciones: registrar y cambiar una asistencia, inscribir, ver inscriptos y
 * dar de baja. Corren igual con la migración A y con la política futura de B.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const ALUMNO = { dni: '99900002', etiqueta: 'Estudiante, Beto', legajo: 'LEG-PRUEBA-0002' }
const TALLER = 'Taller E2E EPT58 Gestión'
/** Una fecha lejana por actor: la asistencia es única por alumno y día. */
const FECHA = { 'chromium-directora': '2031-03-10', 'chromium-docente': '2031-03-11' } as const

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

function fechaDelProyecto() {
  const fecha = FECHA[test.info().project.name as keyof typeof FECHA]
  if (!fecha) throw new Error('Proyecto sin fecha asignada')
  return fecha
}

function limpiar(fecha: string) {
  sql(`
    BEGIN;
    DELETE FROM public.asistencias
      WHERE fecha = '${fecha}' AND estudiante_id = (SELECT id FROM public.perfiles WHERE dni = '${ALUMNO.dni}');
    DELETE FROM public.inscripciones WHERE actividad_id IN (SELECT id FROM public.actividades WHERE nombre = '${TALLER}');
    DELETE FROM public.actividades WHERE nombre = '${TALLER}';
    COMMIT;
  `)
}

/** Etiquetas esperadas, armadas desde la base con el formato de cada pantalla. */
function etiquetasEsperadas(formato: 'asistencias' | 'cupos') {
  const legajo =
    formato === 'asistencias'
      ? `coalesce(' (' || p.legajo_nro || ')', '')`
      : `coalesce(' (Leg. ' || p.legajo_nro || ')', '')`
  const filas = sql(`
    SELECT p.apellido || ', ' || p.nombre || ${legajo}
    FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'ESTUDIANTE'
  `)
  return filas.split('\n').filter(Boolean).sort()
}

async function opcionesDe(page: Page, etiqueta: string) {
  const selector = page.getByLabel(etiqueta, { exact: true })
  // El selector se monta antes de que lleguen los alumnos: esperar más que el marcador.
  await expect.poll(() => selector.locator('option').count()).toBeGreaterThan(1)
  const textos = await selector.locator('option').evaluateAll((opciones) =>
    opciones.filter((o) => (o as HTMLOptionElement).value !== '').map((o) => o.textContent?.trim() ?? '')
  )
  return textos.sort()
}

for (const actor of ['DIRECTOR', 'DOCENTE'] as const) {
  test.describe(`${actor} autenticado — gestión de estudiantes`, () => {
    test.beforeEach(() => {
      limpiar(fechaDelProyecto())
      sql(`INSERT INTO public.actividades (nombre, tipo, cupo_maximo, activo) VALUES ('${TALLER}', 'TALLER', 5, TRUE);`)
    })

    test.afterEach(() => {
      limpiar(fechaDelProyecto())
    })

    test('Asistencias: mismo conjunto de alumnos, registra y cambia el estado', async ({ page }) => {
      const fecha = fechaDelProyecto()
      await page.goto('/dashboard/asistencias')
      await page.getByLabel('Filtrar por fecha').fill(fecha)

      expect(await opcionesDe(page, 'Alumno')).toEqual(etiquetasEsperadas('asistencias'))

      await page.getByLabel('Alumno', { exact: true }).selectOption({ label: `${ALUMNO.etiqueta} (${ALUMNO.legajo})` })
      await page.getByLabel('Estado', { exact: true }).selectOption('PRESENTE')
      await page.getByRole('button', { name: 'Registrar' }).click()
      await expect(page.getByText('Asistencia registrada')).toBeVisible()

      const tabla = page.getByRole('table', { name: 'Tabla de asistencias' })
      const fila = tabla.getByRole('row').filter({ hasText: ALUMNO.etiqueta })
      await expect(fila).toContainText(ALUMNO.legajo)
      await expect(tabla).not.toContainText('Estudiante no disponible')

      await fila.getByRole('button', { name: 'Marcar Beto como ausente' }).click()
      await expect
        .poll(() =>
          sql(`SELECT estado FROM public.asistencias
               WHERE fecha = '${fecha}' AND estudiante_id = (SELECT id FROM public.perfiles WHERE dni = '${ALUMNO.dni}')`)
        )
        .toBe('AUSENTE')

      await page.reload()
      await page.getByLabel('Filtrar por fecha').fill(fecha)
      await expect(tabla.getByRole('row').filter({ hasText: ALUMNO.etiqueta })).toContainText(ALUMNO.legajo)
    })

    test('Cupos: mismo conjunto de alumnos, inscribe, lista inscriptos y da de baja', async ({ page }) => {
      await page.goto('/dashboard/cupos')
      expect(await opcionesDe(page, 'Seleccioná el alumno')).toEqual(etiquetasEsperadas('cupos'))

      await page
        .getByLabel('Seleccioná el alumno', { exact: true })
        .selectOption({ label: `${ALUMNO.etiqueta} (Leg. ${ALUMNO.legajo})` })
      const tarjeta = page
        .getByRole('heading', { name: TALLER, exact: true })
        .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]')
      await tarjeta.getByRole('button', { name: 'Inscribir' }).click()
      await expect(page.getByText('Alumno inscripto')).toBeVisible()

      await tarjeta.getByRole('button', { name: 'Ver inscriptos (1)' }).click()
      const inscripto = tarjeta.getByRole('listitem').filter({ hasText: ALUMNO.etiqueta })
      await expect(inscripto).toContainText(`Leg. ${ALUMNO.legajo}`)
      await expect(tarjeta).not.toContainText('Estudiante no disponible')

      await inscripto.getByRole('button', { name: 'Dar de baja' }).click()
      await expect(page.getByText('Inscripción dada de baja')).toBeVisible()
      expect(
        sql(`SELECT estado FROM public.inscripciones
             WHERE actividad_id = (SELECT id FROM public.actividades WHERE nombre = '${TALLER}')`)
      ).toBe('BAJA')
    })
  })
}
