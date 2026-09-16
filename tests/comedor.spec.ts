import { expect, test } from '@playwright/test'

/**
 * Frontera HTTP del comedor sin sesión (EPT-10, EPT-30).
 *
 * Demuestran que la autorización precede a la validación, que no existe
 * superficie DELETE y que ninguna respuesta filtra detalle técnico.
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
  'inscripciones_servicios',
  'servicios_escolares',
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
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(
      cuerpo.toLowerCase(),
      `la respuesta no debe filtrar "${fragmento}"`
    ).not.toContain(fragmento.toLowerCase())
  }
}

const SERVICIO = 'e0000000-0000-4000-8000-000000000010'
const INSCRIPCION = '11111111-1111-4111-8111-111111111111'

test.describe('frontera HTTP del comedor', () => {
  test('rechaza la inscripción sin sesión con 401', async ({ request }) => {
    const respuesta = await request.post('/api/comedor/inscripciones', {
      data: { servicio_id: SERVICIO },
    })

    expect(respuesta.status()).toBe(401)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe('Necesitás iniciar sesión para continuar.')
  })

  test('autoriza antes de validar el cuerpo de la inscripción', async ({ request }) => {
    const respuesta = await request.post('/api/comedor/inscripciones', {
      data: { servicio_id: 'no-es-un-uuid' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de intentar leer un JSON malformado', async ({ request }) => {
    const respuesta = await request.post('/api/comedor/inscripciones', {
      data: '{',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('rechaza la cancelación sin sesión con 401', async ({ request }) => {
    const respuesta = await request.patch(
      `/api/comedor/inscripciones/${INSCRIPCION}`,
      { data: { accion: 'cancelar' } }
    )

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de validar el identificador y el contrato PATCH', async ({
    request,
  }) => {
    const respuesta = await request.patch('/api/comedor/inscripciones/no-es-un-id', {
      data: { accion: 'desconocida' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('no existe eliminación física de inscripciones', async ({ request }) => {
    expect(
      (await request.fetch('/api/comedor/inscripciones', { method: 'DELETE' })).status()
    ).toBe(405)
    expect(
      (
        await request.fetch(`/api/comedor/inscripciones/${INSCRIPCION}`, {
          method: 'DELETE',
        })
      ).status()
    ).toBe(405)
  })

  test('ninguna ruta del comedor expone lectura anónima', async ({ request }) => {
    expect((await request.get('/api/comedor/inscripciones')).status()).toBe(405)
    expect(
      (await request.get(`/api/comedor/inscripciones/${INSCRIPCION}`)).status()
    ).toBe(405)
  })

  test('el panel del comedor redirige al login sin sesión', async ({ page }) => {
    await page.goto('/dashboard/comedor')
    await expect(page).toHaveURL(/\/login/)
  })
})
