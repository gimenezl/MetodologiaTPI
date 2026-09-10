import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

/**
 * Authenticated course administration against the real local database
 * (EPT-15 / EPT-16 / EPT-17 / EPT-18).
 *
 * Unlike `cursos-ui.spec.ts`, nothing here is mocked. Every assertion travels
 * the whole path: browser → `/api/cursos` → session-bound Supabase client →
 * PostgreSQL grants and RLS. Duplicate and missing-level rejections are the
 * genuine 23505 and 23503 states mapped to their Spanish domain messages.
 *
 * Requires the disposable local stack; `playwright.config.ts` only includes
 * these projects when `EPT_SUPABASE_LOCAL=1`. Identities come from
 * `tests/auth.setup.ts`.
 */

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

/** A course name unique to this run, so retries never collide with themselves. */
function denominacionUnica() {
  return `Curso Prueba ${Date.now().toString().slice(-6)}`
}

/** Screenshots are opt-in; see the note in `cursos-ui.spec.ts`. */
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await page.screenshot({ path: path.join('docs/evidence/EPT-8', `${nombre}.png`), fullPage: true })
}

test.describe('DIRECTOR autenticado', () => {
  test('ve el listado real de cursos que vino de la base', async ({ page }) => {
    await page.goto('/dashboard/cursos')

    await expect(page.getByRole('heading', { name: 'Cursos', level: 1 })).toBeVisible()

    // Las tres filas sembradas, incluida la inactiva.
    const tabla = page.getByRole('table', { name: 'Tabla de cursos' })
    await expect(tabla.getByRole('row')).toHaveCount(4) // encabezado + 3
    await expect(page.getByRole('button', { name: 'Editar el curso 1er Grado A' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reactivar el curso 1er Grado B' })).toBeVisible()

    await capturar(page, 'real-escritorio-01-listado-autenticado')

    // El mismo listado real, en pantalla angosta.
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByRole('list', { name: 'Cursos registrados' })).toBeVisible()
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(desborda, 'el listado real no debe desbordar a 375px').toBe(false)
    await capturar(page, 'real-movil-01-listado-autenticado')
  })

  test('tiene el acceso a Cursos en la navegación', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(
      page.getByRole('navigation', { name: 'Menú del dashboard' }).getByRole('link', { name: 'Cursos' })
    ).toBeVisible()
  })

  test('crea un curso y lo ve en el listado', async ({ page }) => {
    const denominacion = denominacionUnica()

    await page.goto('/dashboard/cursos')
    await page.getByRole('button', { name: 'Nuevo curso' }).click()
    await page.getByLabel('Denominación').first().fill(denominacion)
    await page.getByLabel('División').first().fill('Z')
    await page.getByLabel('Nivel educativo').first().selectOption({ label: 'SECUNDARIO' })
    await page.getByRole('button', { name: 'Crear curso' }).click()

    // El listado se reconcilia contra el servidor: la fila existe de verdad.
    await expect(
      page.getByRole('button', { name: `Editar el curso ${denominacion} Z` })
    ).toBeVisible({ timeout: 15000 })

    // Y sobrevive a una recarga completa, así que quedó persistida.
    await page.reload()
    await expect(page.getByText(`${denominacion} Z`).first()).toBeVisible()
  })

  test('rechaza un duplicado normalizado con el mensaje de dominio', async ({ page }) => {
    await page.goto('/dashboard/cursos')
    await page.getByRole('button', { name: 'Nuevo curso' }).click()

    // Mismo curso sembrado, escrito en otras mayúsculas: la unicidad se define
    // sobre UPPER(BTRIM(...)), así que la base lo rechaza con 23505.
    await page.getByLabel('Denominación').first().fill('1ER GRADO')
    await page.getByLabel('División').first().fill('a')
    await page.getByLabel('Nivel educativo').first().selectOption({ label: 'PRIMARIO' })
    await page.getByRole('button', { name: 'Crear curso' }).click()

    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Ya existe un curso con esa denominación y división en el nivel elegido.' })
        .first()
    ).toBeVisible({ timeout: 15000 })

    await capturar(page, 'real-escritorio-02-duplicado-desde-la-base')
  })

  test('edita un curso y conserva su nivel', async ({ page }) => {
    const nuevaDenominacion = denominacionUnica()

    await page.goto('/dashboard/cursos')
    await page.getByRole('button', { name: 'Editar el curso Sala de 5 A' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.locator('#editar-denominacion').fill(nuevaDenominacion)
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 })
    await expect(
      page.getByRole('button', { name: `Editar el curso ${nuevaDenominacion} A` })
    ).toBeVisible({ timeout: 15000 })

    // Se restaura el nombre para no arrastrar estado entre pruebas.
    await page.getByRole('button', { name: `Editar el curso ${nuevaDenominacion} A` }).click()
    await page.locator('#editar-denominacion').fill('Sala de 5')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 })
  })

  test('inactiva un curso sin borrarlo y lo reactiva', async ({ page }) => {
    const inactivar = page.getByRole('button', { name: 'Inactivar el curso 1er Grado A' })
    const reactivar = page.getByRole('button', { name: 'Reactivar el curso 1er Grado A' })
    const filas = page.getByRole('table', { name: 'Tabla de cursos' }).getByRole('row')

    await page.goto('/dashboard/cursos')

    // El estado de partida se normaliza: la prueba no depende de lo que hayan
    // dejado las anteriores ni de un reintento previo.
    if (await reactivar.isVisible()) {
      page.once('dialog', (d) => d.accept())
      await reactivar.click()
    }
    await expect(inactivar).toBeVisible({ timeout: 15000 })

    const filasAntes = await filas.count()

    page.once('dialog', (d) => d.accept())
    await inactivar.click()

    // La fila sigue existiendo: cambió de estado, no desapareció.
    await expect(reactivar).toBeVisible({ timeout: 15000 })
    await expect(filas, 'la baja lógica no debe eliminar la fila').toHaveCount(filasAntes)

    // Y se puede volver atrás.
    page.once('dialog', (d) => d.accept())
    await reactivar.click()
    await expect(inactivar).toBeVisible({ timeout: 15000 })
    await expect(filas).toHaveCount(filasAntes)
  })

  test('rechaza un nivel inexistente con el mensaje de dominio', async ({ request }) => {
    // El selector solo ofrece niveles válidos, así que este caso se prueba en el
    // límite HTTP, con la sesión real de la directora.
    const respuesta = await request.post('/api/cursos', {
      data: { denominacion: 'Curso Sin Nivel', division: 'X', nivel_id: 999999 },
    })

    expect(respuesta.status()).toBe(400)
    const cuerpo = await respuesta.json()
    expect(cuerpo.error).toBe('El nivel educativo elegido no existe.')
    expect(cuerpo.campo).toBe('nivel_id')
  })

  test('recibe el estado de duplicado en el límite HTTP', async ({ request }) => {
    const respuesta = await request.post('/api/cursos', {
      data: { denominacion: '  1er Grado', division: 'A', nivel_id: 2 },
    })

    // Zod recorta, la base normaliza: en cualquier caso no se crea un duplicado.
    expect([400, 409]).toContain(respuesta.status())
    const cuerpo = await respuesta.json()
    expect(cuerpo.error).toBeTruthy()
    expect(String(cuerpo.error)).not.toContain('23505')
  })

  test('no dispone de borrado físico ni estando autenticada', async ({ request }) => {
    expect((await request.fetch('/api/cursos', { method: 'DELETE' })).status()).toBe(405)
    expect(
      (await request.fetch(`/api/cursos/${ID_INEXISTENTE}`, { method: 'DELETE' })).status()
    ).toBe(405)
  })
})

test.describe('ESTUDIANTE autenticado', () => {
  test('no ve el acceso a Cursos en la navegación', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(
      page.getByRole('navigation', { name: 'Menú del dashboard' }).getByRole('link', { name: 'Cursos' })
    ).toHaveCount(0)
  })

  test('recibe acceso restringido en /dashboard/cursos', async ({ page }) => {
    await page.goto('/dashboard/cursos')
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Tabla de cursos' })).toHaveCount(0)

    await capturar(page, 'real-escritorio-03-estudiante-restringido')
  })

  test('no puede crear cursos aunque evite la interfaz', async ({ request }) => {
    const respuesta = await request.post('/api/cursos', {
      data: { denominacion: 'Curso Del Estudiante', division: 'X', nivel_id: 2 },
    })

    expect(respuesta.status()).toBe(403)
    const cuerpo = await respuesta.json()
    expect(cuerpo.error).toBe('Solo el director puede administrar los cursos.')
  })

  test('no puede modificar ni inactivar cursos', async ({ request }) => {
    const respuesta = await request.patch(`/api/cursos/${ID_INEXISTENTE}`, {
      data: { activo: false },
    })
    expect(respuesta.status()).toBe(403)
  })
})
