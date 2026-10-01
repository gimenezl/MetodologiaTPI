import { expect, test, type APIResponse } from '@playwright/test'

/**
 * API y pantallas de accesos con QR SIN sesión (EPT-65, RF21).
 *
 * No necesita base de datos: todo lo que se prueba se decide ANTES de consultar
 * nada (método, origen, sesión). Las pruebas con sesiones reales viven en
 * `accesos-qr-auth.spec.ts`.
 */

const REGISTRO = '/api/accesos-servicios/registro'
const ANULACION = '/api/accesos-servicios/f0000000-0000-4000-8000-000000000001/anulacion'
const CUERPO = {
  payload: 'EPT1.k1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  intento_id: '11111111-1111-4111-8111-111111111111',
  servicio_id: 'e0000000-0000-4000-8000-000000000010',
}

async function exigirError(respuesta: APIResponse, estado: number, codigo: string) {
  expect(respuesta.status()).toBe(estado)
  expect(respuesta.headers()['cache-control']).toBe('no-store')
  const cuerpo = (await respuesta.json()) as Record<string, unknown>
  expect(cuerpo.codigo).toBe(codigo)
  expect(Object.keys(cuerpo).sort()).toEqual(['codigo', 'error'])
  expect(String(cuerpo.error)).toMatch(/[a-záéíóúñ]{3,}/i)
}

test.describe('registro de accesos sin sesión', () => {
  test('POST sin sesión → 401 y nada de lo recibido se refleja', async ({ request }) => {
    await exigirError(await request.post(REGISTRO, { data: CUERPO }), 401, 'NO_AUTENTICADO')
  })

  test('la anulación sin sesión → 401', async ({ request }) => {
    await exigirError(await request.post(ANULACION, { data: { motivo: 'Motivo de prueba' } }), 401, 'NO_AUTENTICADO')
  })

  test('los métodos no admitidos → 405 con Allow, sin consultar la sesión', async ({ request }) => {
    for (const ruta of [REGISTRO, ANULACION]) {
      for (const metodo of ['get', 'put', 'patch', 'delete'] as const) {
        const respuesta = await request[metodo](ruta)
        expect(respuesta.status(), `${metodo.toUpperCase()} ${ruta}`).toBe(405)
        expect(respuesta.headers().allow).toBe('POST, OPTIONS')
      }
      const opciones = await request.fetch(ruta, { method: 'OPTIONS' })
      expect(opciones.status()).toBe(204)
      expect(opciones.headers().allow).toBe('POST, OPTIONS')
    }
  })

  test('un origen ajeno → 403 ORIGEN_NO_PERMITIDO antes de mirar la sesión', async ({ request }) => {
    await exigirError(
      await request.post(REGISTRO, { data: CUERPO, headers: { Origin: 'https://sitio-ajeno.example' } }),
      403,
      'ORIGEN_NO_PERMITIDO'
    )
    await exigirError(
      await request.post(REGISTRO, { data: CUERPO, headers: { 'Sec-Fetch-Site': 'cross-site' } }),
      403,
      'ORIGEN_NO_PERMITIDO'
    )
    await exigirError(
      await request.post(ANULACION, {
        data: { motivo: 'Motivo de prueba' },
        headers: { Origin: 'https://sitio-ajeno.example' },
      }),
      403,
      'ORIGEN_NO_PERMITIDO'
    )
  })
})

test.describe('pantallas de accesos sin sesión', () => {
  for (const ruta of ['/dashboard/accesos', '/dashboard/accesos/auditoria']) {
    test(`${ruta} lleva al inicio de sesión`, async ({ page }) => {
      await page.goto(ruta)
      await expect(page).toHaveURL(/\/login\?redirect=/)
      await expect(page).toHaveURL(new RegExp(`redirect=${encodeURIComponent(ruta).replace(/\./g, '\\.')}`))
    })
  }
})
