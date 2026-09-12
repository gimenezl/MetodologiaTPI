import { expect, test } from '@playwright/test'

/**
 * Frontera HTTP del legajo académico sin sesión. Estas pruebas demuestran que la
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
  '23503',
  'P5501',
  'P5504',
  'P5505',
  'P5510',
  'P5511',
  'P5512',
  'P5513',
  'P5514',
  'P5515',
  'P5516',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(
      cuerpo.toLowerCase(),
      `la respuesta no debe filtrar "${fragmento}"`
    ).not.toContain(fragmento.toLowerCase())
  }
}

const ID_CUALQUIERA = '11111111-1111-4111-8111-111111111111'

test.describe('frontera HTTP del legajo académico', () => {
  test('rechaza el alta sin sesión con 401', async ({ request }) => {
    const respuesta = await request.post('/api/alumnos', {
      data: {
        nombre: 'Sin',
        apellido: 'Sesión',
        dni: '95000001',
        estado: 'INACTIVO',
      },
    })

    expect(respuesta.status()).toBe(401)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe('Necesitás iniciar sesión para continuar.')
  })

  test('rechaza cualquier acción de modificación sin sesión con 401', async ({
    request,
  }) => {
    for (const data of [
      { accion: 'corregir_identidad', dni: '95000002' },
      { accion: 'cambiar_curso', curso_id: ID_CUALQUIERA },
      { accion: 'inactivar' },
      { accion: 'reactivar', curso_id: ID_CUALQUIERA },
    ]) {
      const respuesta = await request.patch(`/api/alumnos/${ID_CUALQUIERA}`, { data })
      expect(respuesta.status()).toBe(401)
      esperarSinFiltraciones(await respuesta.text())
    }
  })

  test('autoriza antes de intentar leer un JSON malformado', async ({ request }) => {
    const respuesta = await request.post('/api/alumnos', {
      data: '{',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de validar un cuerpo inválido', async ({ request }) => {
    const respuesta = await request.post('/api/alumnos', {
      data: { nombre: '', dni: 'no-es-un-dni', estado: 'INVENTADO' },
    })

    // Un 400 acá revelaría las reglas de validación a quien no tiene acceso.
    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de validar un identificador inválido', async ({ request }) => {
    const respuesta = await request.patch('/api/alumnos/no-es-un-uuid', {
      data: { accion: 'inactivar' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('no existe eliminación física en la colección', async ({ request }) => {
    const respuesta = await request.fetch('/api/alumnos', { method: 'DELETE' })
    expect(respuesta.status()).toBe(405)
  })

  test('no existe eliminación física para un legajo individual', async ({ request }) => {
    const respuesta = await request.fetch(`/api/alumnos/${ID_CUALQUIERA}`, {
      method: 'DELETE',
    })
    expect(respuesta.status()).toBe(405)
  })

  test('la colección no expone lectura anónima', async ({ request }) => {
    expect((await request.get('/api/alumnos')).status()).toBe(405)
  })

  test('la ruta individual no expone lectura anónima', async ({ request }) => {
    expect((await request.get(`/api/alumnos/${ID_CUALQUIERA}`)).status()).toBe(405)
  })

  test('un anónimo no alcanza el panel administrativo ni la vista propia', async ({
    page,
  }) => {
    for (const ruta of ['/dashboard/alumnos', '/dashboard/mi-legajo']) {
      await page.goto(ruta)
      await expect(page).toHaveURL(/\/login/)
    }
  })
})
