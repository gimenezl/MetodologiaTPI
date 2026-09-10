import { test, expect } from '@playwright/test'

/**
 * Course administration — boundary coverage (EPT-8 / EPT-17 / EPT-18).
 *
 * These tests exercise the deny paths and the HTTP method surface of
 * `/api/cursos`. They deliberately need no seeded database: with no session
 * cookie, `supabase.auth.getUser()` resolves locally to "no session", so the
 * route boundary answers 401 before any query runs.
 *
 * The allowed paths (director creates / edits / inactivates a course, duplicate
 * rejection, missing level rejection) require an authenticated director against
 * a real Supabase instance. That harness does not exist in this repository yet;
 * `supabase/tests/cursos_rls.sql` covers the same rules at the database layer
 * and `docs/evidence/EPT-8.md` records what is still unproven.
 */

const ID_CURSO_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

/** Strings that must never reach a client, whatever goes wrong. */
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
  '23503',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(
      cuerpo.toLowerCase(),
      `the response must not leak "${fragmento}"`
    ).not.toContain(fragmento.toLowerCase())
  }
}

test.describe('course administration route boundary', () => {
  test('unauthenticated visitor is redirected away from /dashboard/cursos', async ({ page }) => {
    await page.goto('/dashboard/cursos')
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard%2Fcursos|\/login\?redirect=\/dashboard\/cursos/)
  })

  test('creating a course without a session is rejected with 401', async ({ request }) => {
    const respuesta = await request.post('/api/cursos', {
      data: { denominacion: '1er Grado', division: 'A', nivel_id: 1 },
    })

    expect(respuesta.status()).toBe(401)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBeTruthy()
  })

  test('updating a course without a session is rejected with 401', async ({ request }) => {
    const respuesta = await request.patch(`/api/cursos/${ID_CURSO_INEXISTENTE}`, {
      data: { activo: false },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('authorization runs before validation, so an invalid body still yields 401', async ({
    request,
  }) => {
    // A malformed payload must not reveal whether it would have been accepted.
    const respuesta = await request.post('/api/cursos', {
      data: { denominacion: '   ', division: '', nivel_id: -1 },
    })

    expect(respuesta.status()).toBe(401)
  })

  test('no physical delete endpoint exists for the course collection', async ({ request }) => {
    const respuesta = await request.fetch('/api/cursos', { method: 'DELETE' })
    expect(respuesta.status()).toBe(405)
  })

  test('no physical delete endpoint exists for an individual course', async ({ request }) => {
    const respuesta = await request.fetch(`/api/cursos/${ID_CURSO_INEXISTENTE}`, {
      method: 'DELETE',
    })
    expect(respuesta.status()).toBe(405)
  })

  test('the collection endpoint does not expose a listing to anonymous callers', async ({
    request,
  }) => {
    // Reads happen in the server component, not through this route. A GET must
    // therefore be method-not-allowed rather than an anonymous data source.
    const respuesta = await request.get('/api/cursos')
    expect(respuesta.status()).toBe(405)
  })
})
