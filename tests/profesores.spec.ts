import { expect, test } from '@playwright/test'
import { exigirMensajeSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Frontera HTTP de profesores sin sesión (EPT-58). Demuestra que la
 * autorización precede a la validación, que no existe superficie de alta ni de
 * borrado y que ninguna respuesta filtra detalle técnico. No necesita base.
 */

const PROFESOR = '11111111-1111-4111-8111-111111111111'

async function esperarNoAutenticado(respuesta: import('@playwright/test').APIResponse) {
  expect(respuesta.status()).toBe(401)
  const cuerpo = await respuesta.json()
  expect(cuerpo.error).toBe('Necesitás iniciar sesión para continuar.')
  exigirMensajeSinDetalleTecnico('respuesta sin sesión', cuerpo.error)
}

test.describe('frontera HTTP de profesores', () => {
  test('rechaza sin sesión el listado, el detalle y las asignaciones propias con 401', async ({
    request,
  }) => {
    await esperarNoAutenticado(await request.get('/api/profesores'))
    await esperarNoAutenticado(await request.get(`/api/profesores/${PROFESOR}`))
    await esperarNoAutenticado(await request.get('/api/mis-asignaciones'))
  })

  test('autoriza antes de validar el identificador y el cuerpo', async ({ request }) => {
    await esperarNoAutenticado(await request.get('/api/profesores/no-es-un-uuid'))
    await esperarNoAutenticado(
      await request.patch('/api/profesores/no-es-un-uuid', { data: { accion: 'cualquiera' } })
    )
    await esperarNoAutenticado(
      await request.patch(`/api/profesores/${PROFESOR}`, {
        data: { accion: 'cambiar_estado', estado: 'INACTIVO' },
      })
    )
  })

  test('no ofrece alta, reemplazo ni borrado: 405', async ({ request }) => {
    expect((await request.post('/api/profesores', { data: {} })).status()).toBe(405)
    expect((await request.delete('/api/profesores')).status()).toBe(405)
    expect((await request.delete(`/api/profesores/${PROFESOR}`)).status()).toBe(405)
    expect((await request.put(`/api/profesores/${PROFESOR}`, { data: {} })).status()).toBe(405)
    expect((await request.post(`/api/profesores/${PROFESOR}`, { data: {} })).status()).toBe(405)
    expect((await request.post('/api/mis-asignaciones', { data: {} })).status()).toBe(405)
    expect((await request.patch('/api/mis-asignaciones', { data: {} })).status()).toBe(405)
    expect((await request.delete('/api/mis-asignaciones')).status()).toBe(405)
  })

  test('las pantallas sin sesión llevan al acceso', async ({ page }) => {
    for (const ruta of ['/dashboard/profesores', '/dashboard/mis-asignaciones']) {
      await page.goto(ruta)
      await expect(page).toHaveURL(/\/login/)
    }
  })
})
