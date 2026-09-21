import { expect, test } from '@playwright/test'

/**
 * Frontera HTTP de deportes sin sesión (EPT-11, EPT-36).
 *
 * Demuestran que la autorización precede a la validación del cuerpo, que no
 * existe superficie DELETE ni lectura anónima, y que ninguna respuesta filtra
 * detalle técnico. No necesitan base de datos.
 */

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
  'inscripciones_deportivas',
  'grupos_deportivos',
  'app_private',
  'P55',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(cuerpo.toLowerCase(), `la respuesta no debe filtrar "${fragmento}"`).not.toContain(
      fragmento.toLowerCase()
    )
  }
}

const GRUPO = '11111111-1111-4111-8111-111111111111'
const INSCRIPCION = '22222222-2222-4222-8222-222222222222'

test.describe('frontera HTTP de deportes', () => {
  test('rechaza la inscripción sin sesión con 401 y mensaje en español', async ({ request }) => {
    const respuesta = await request.post('/api/deportes/inscripciones', { data: { grupo_id: GRUPO } })
    expect(respuesta.status()).toBe(401)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe('Necesitás iniciar sesión para continuar.')
  })

  test('autoriza antes de validar un cuerpo inválido o malformado', async ({ request }) => {
    for (const data of [{ grupo_id: 'no-es-un-uuid', alumno_id: GRUPO }, '{']) {
      const respuesta = await request.post('/api/deportes/inscripciones', {
        data,
        headers: { 'Content-Type': 'application/json' },
      })
      expect(respuesta.status()).toBe(401)
      esperarSinFiltraciones(await respuesta.text())
    }
  })

  test('rechaza la cancelación y el alta de grupos sin sesión con 401', async ({ request }) => {
    const baja = await request.patch(`/api/deportes/inscripciones/${INSCRIPCION}`, {
      data: { accion: 'cancelar' },
    })
    expect(baja.status()).toBe(401)
    esperarSinFiltraciones(await baja.text())

    const idInvalido = await request.patch('/api/deportes/inscripciones/no-es-un-id', {
      data: { accion: 'desconocida' },
    })
    expect(idInvalido.status()).toBe(401)

    const grupo = await request.post('/api/deportes/grupos', {
      data: { deporte_id: GRUPO, nivel_id: 1, nombre: 'Anónimo', cupo: 5, profesor_id: GRUPO },
    })
    expect(grupo.status()).toBe(401)
    esperarSinFiltraciones(await grupo.text())
  })

  test('no existe eliminación física ni lectura anónima', async ({ request }) => {
    for (const ruta of [
      '/api/deportes/inscripciones',
      `/api/deportes/inscripciones/${INSCRIPCION}`,
      '/api/deportes/grupos',
    ]) {
      expect((await request.fetch(ruta, { method: 'DELETE' })).status()).toBe(405)
      expect((await request.get(ruta)).status()).toBe(405)
    }
  })

  test('el panel de deportes redirige al login sin sesión', async ({ page }) => {
    await page.goto('/dashboard/deportes')
    await expect(page).toHaveURL(/\/login/)
  })
})
