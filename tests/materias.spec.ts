import { expect, test } from '@playwright/test'

/**
 * Frontera HTTP de materias y de asignaciones sin sesión. Demuestran que la
 * autorización precede a la validación y que no existe superficie DELETE.
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
  'P5530',
  'P5531',
  'P5532',
  'P5533',
  'P5534',
  'P5535',
  'P5536',
  'P5537',
  'P5538',
  'P5539',
  'P5540',
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

const ASIGNACION = '11111111-1111-4111-8111-111111111111'
const CURSO = '22222222-2222-4222-8222-222222222222'

test.describe('frontera HTTP de materias', () => {
  test('rechaza el alta de una materia sin sesión con 401', async ({ request }) => {
    const respuesta = await request.post('/api/materias', {
      data: { nombre: 'Matemática' },
    })

    expect(respuesta.status()).toBe(401)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe('Necesitás iniciar sesión para continuar.')
  })

  test('autoriza antes de validar el cuerpo del alta', async ({ request }) => {
    const respuesta = await request.post('/api/materias', { data: { nombre: '' } })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de intentar leer un JSON malformado', async ({ request }) => {
    const respuesta = await request.post('/api/materias', {
      data: '{',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('rechaza la modificación sin sesión con 401', async ({ request }) => {
    const respuesta = await request.patch('/api/materias/1', {
      data: { accion: 'cambiar_estado', activo: false },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de validar el identificador y el contrato PATCH', async ({
    request,
  }) => {
    const respuesta = await request.patch('/api/materias/no-es-un-id', {
      data: { accion: 'desconocida', activo: 'no' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('rechaza asignar una materia a un curso sin sesión con 401', async ({
    request,
  }) => {
    const respuesta = await request.post('/api/asignaciones-materias', {
      data: { materia_id: 1, curso_id: CURSO },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('rechaza cambiar el profesor y el estado de una asignación sin sesión', async ({
    request,
  }) => {
    for (const data of [
      { accion: 'cambiar_profesor', profesor_id: null },
      { accion: 'cambiar_estado', activo: false },
    ]) {
      const respuesta = await request.patch(
        `/api/asignaciones-materias/${ASIGNACION}`,
        { data }
      )
      expect(respuesta.status()).toBe(401)
      esperarSinFiltraciones(await respuesta.text())
    }
  })

  test('no existe eliminación física de materias', async ({ request }) => {
    expect((await request.fetch('/api/materias', { method: 'DELETE' })).status()).toBe(405)
    expect(
      (await request.fetch('/api/materias/1', { method: 'DELETE' })).status()
    ).toBe(405)
  })

  test('no existe eliminación física de asignaciones', async ({ request }) => {
    expect(
      (await request.fetch('/api/asignaciones-materias', { method: 'DELETE' })).status()
    ).toBe(405)
    expect(
      (
        await request.fetch(`/api/asignaciones-materias/${ASIGNACION}`, {
          method: 'DELETE',
        })
      ).status()
    ).toBe(405)
  })

  test('ninguna ruta expone lectura anónima', async ({ request }) => {
    expect((await request.get('/api/materias')).status()).toBe(405)
    expect((await request.get('/api/materias/1')).status()).toBe(405)
    expect((await request.get('/api/asignaciones-materias')).status()).toBe(405)
    expect(
      (await request.get(`/api/asignaciones-materias/${ASIGNACION}`)).status()
    ).toBe(405)
  })

  test('el panel de materias redirige al login sin sesión', async ({ page }) => {
    await page.goto('/dashboard/materias')
    await expect(page).toHaveURL(/\/login/)
  })
})
