import { expect, test } from '@playwright/test'
import { exigirMensajeSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Frontera HTTP de la administración de deportes y grupos sin sesión (EPT-61).
 *
 * Demuestran que la autorización precede a la validación del cuerpo y del
 * identificador, que no existe superficie de borrado (DELETE recibe 405 con la
 * cabecera `Allow`) ni lectura anónima, y que ninguna respuesta filtra detalle
 * técnico. No necesitan base de datos: con sesión se prueba en
 * `administracion-deportes-auth.spec.ts`.
 */

const DEPORTE = 'e0000000-0000-4000-8000-000000000101'
const GRUPO = '11111111-1111-4111-8111-111111111111'

const RUTAS = [
  { ruta: '/api/deportes', permitido: 'POST' },
  { ruta: `/api/deportes/${DEPORTE}`, permitido: 'PATCH' },
  { ruta: `/api/deportes/grupos/${GRUPO}`, permitido: 'PATCH' },
]

test.describe('frontera HTTP de la administración de deportes', () => {
  test('rechaza cada operación sin sesión con 401 y mensaje en español', async ({ request }) => {
    const peticiones = [
      request.post('/api/deportes', { data: { nombre: 'Anónimo' } }),
      request.patch(`/api/deportes/${DEPORTE}`, { data: { accion: 'renombrar', nombre: 'Anónimo' } }),
      request.patch(`/api/deportes/${DEPORTE}`, { data: { accion: 'cambiar_estado', activo: false } }),
      request.patch(`/api/deportes/grupos/${GRUPO}`, {
        data: { accion: 'editar', nombre: 'Anónimo', cupo: 5, profesor_id: GRUPO },
      }),
      request.patch(`/api/deportes/grupos/${GRUPO}`, {
        data: { accion: 'cambiar_estado', activo: false },
      }),
    ]
    for (const respuesta of await Promise.all(peticiones)) {
      expect(respuesta.status()).toBe(401)
      const cuerpo = await respuesta.json()
      expect(cuerpo.error).toBe('Necesitás iniciar sesión para continuar.')
      exigirMensajeSinDetalleTecnico('respuesta anónima', cuerpo.error)
    }
  })

  test('autoriza antes de validar un identificador o un cuerpo inválido o malformado', async ({ request }) => {
    const casos = [
      request.patch('/api/deportes/no-es-un-id', { data: { accion: 'desconocida' } }),
      request.patch('/api/deportes/grupos/no-es-un-id', { data: { accion: 'desconocida' } }),
      request.post('/api/deportes', { data: '{', headers: { 'Content-Type': 'application/json' } }),
      request.patch(`/api/deportes/${DEPORTE}`, { data: '{', headers: { 'Content-Type': 'application/json' } }),
    ]
    for (const respuesta of await Promise.all(casos)) expect(respuesta.status()).toBe(401)
  })

  test('no existe eliminación física: DELETE, GET y PUT reciben 405 con la cabecera Allow', async ({ request }) => {
    for (const { ruta, permitido } of RUTAS) {
      for (const metodo of ['DELETE', 'GET', 'PUT']) {
        const respuesta = await request.fetch(ruta, { method: metodo })
        expect(respuesta.status(), `${metodo} ${ruta}`).toBe(405)
        expect(respuesta.headers()['allow'], `${metodo} ${ruta}`).toBe(`${permitido}, OPTIONS`)
        exigirMensajeSinDetalleTecnico('405', (await respuesta.json()).error)
      }
    }
  })

  test('OPTIONS informa únicamente los métodos realmente admitidos', async ({ request }) => {
    for (const { ruta, permitido } of RUTAS) {
      const respuesta = await request.fetch(ruta, { method: 'OPTIONS' })
      expect(respuesta.status()).toBe(204)
      expect(respuesta.headers()['allow']).toBe(`${permitido}, OPTIONS`)
    }
  })

  test('las rutas anteriores de deportes conservan su contrato', async ({ request }) => {
    // El segmento dinámico nuevo no tapa a las rutas estáticas de siempre.
    expect((await request.get('/api/deportes/grupos')).status()).toBe(405)
    expect((await request.get('/api/deportes/inscripciones')).status()).toBe(405)
    expect((await request.post('/api/deportes/inscripciones', { data: { grupo_id: GRUPO } })).status()).toBe(401)
    expect((await request.delete(`/api/deportes/grupos/${GRUPO}/horarios`)).status()).toBe(405)
  })
})
