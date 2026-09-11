import { expect, test } from '@playwright/test'

/**
 * Frontera HTTP de niveles sin sesión. Estas pruebas demuestran que la
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
  'P5501',
  'P5502',
  'P5503',
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

test.describe('frontera HTTP de niveles educativos', () => {
  test('rechaza la creación sin sesión con 401', async ({ request }) => {
    const respuesta = await request.post('/api/niveles', {
      data: { nombre: 'SUPERIOR' },
    })

    expect(respuesta.status()).toBe(401)
    const cuerpo = await respuesta.text()
    esperarSinFiltraciones(cuerpo)
    expect(JSON.parse(cuerpo).error).toBe(
      'Necesitás iniciar sesión para continuar.'
    )
  })

  test('autoriza antes de validar el alta', async ({ request }) => {
    const respuesta = await request.post('/api/niveles', {
      data: { nombre: ' NIVEL INVÁLIDO ' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de intentar leer un JSON malformado', async ({ request }) => {
    const respuesta = await request.post('/api/niveles', {
      data: '{',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('rechaza la modificación sin sesión con 401', async ({ request }) => {
    const respuesta = await request.patch('/api/niveles/1', {
      data: { accion: 'cambiar_estado', activo: false },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('autoriza antes de validar el identificador y el contrato PATCH', async ({
    request,
  }) => {
    const respuesta = await request.patch('/api/niveles/no-es-un-id', {
      data: { accion: 'desconocida', activo: 'no' },
    })

    expect(respuesta.status()).toBe(401)
    esperarSinFiltraciones(await respuesta.text())
  })

  test('no existe eliminación física en la colección', async ({ request }) => {
    const respuesta = await request.fetch('/api/niveles', { method: 'DELETE' })
    expect(respuesta.status()).toBe(405)
  })

  test('no existe eliminación física para un nivel individual', async ({
    request,
  }) => {
    const respuesta = await request.fetch('/api/niveles/1', {
      method: 'DELETE',
    })
    expect(respuesta.status()).toBe(405)
  })

  test('la colección no expone lectura anónima', async ({ request }) => {
    expect((await request.get('/api/niveles')).status()).toBe(405)
  })

  test('la ruta individual no expone lectura anónima', async ({ request }) => {
    expect((await request.get('/api/niveles/1')).status()).toBe(405)
  })
})
