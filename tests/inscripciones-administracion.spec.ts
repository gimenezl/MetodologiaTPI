import { expect, test } from '@playwright/test'
import { exigirMensajeSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Frontera HTTP de la administración de inscripciones sin sesión (EPT-62, RF16).
 *
 * Demuestran que la autorización precede a la validación de los parámetros, que
 * no existe superficie de borrado ni de lectura (todo método distinto de POST
 * recibe 405 con la cabecera `Allow`) y que ninguna respuesta filtra detalle
 * técnico. No necesitan base de datos: con sesión se prueba en
 * `inscripciones-administracion-auth.spec.ts`.
 */

const ID = '11111111-1111-4111-8111-111111111111'
const DOMINIOS = ['matriculas', 'deportes', 'comedor', 'transporte'] as const
const OPERACIONES = ['confirmacion', 'cancelacion'] as const

test.describe('frontera HTTP de la administración de inscripciones', () => {
  test('rechaza cada operación sin sesión con 401 para los cuatro dominios', async ({ request }) => {
    for (const dominio of DOMINIOS) {
      for (const operacion of OPERACIONES) {
        const respuesta = await request.post(`/api/inscripciones/${dominio}/${ID}/${operacion}`)
        expect(respuesta.status(), `${dominio} ${operacion}`).toBe(401)
        expect(respuesta.headers()['cache-control']).toBe('no-store')
        const cuerpo = await respuesta.json()
        expect(cuerpo.error).toBe('Necesitás iniciar sesión para continuar.')
        exigirMensajeSinDetalleTecnico('respuesta anónima', cuerpo.error)
      }
    }
  })

  test('la sesión se exige antes que la validación de dominio, identificador y cuerpo', async ({
    request,
  }) => {
    const casos = [
      request.post(`/api/inscripciones/no-es-un-dominio/${ID}/confirmacion`),
      request.post('/api/inscripciones/comedor/no-es-un-id/confirmacion'),
      request.post('/api/inscripciones/no-es-un-dominio/no-es-un-id/cancelacion'),
      request.post(`/api/inscripciones/matriculas/${ID}/cancelacion`),
      request.post(`/api/inscripciones/deportes/${ID}/confirmacion`, {
        data: '{',
        headers: { 'Content-Type': 'application/json' },
      }),
      request.post(`/api/inscripciones/transporte/${ID}/cancelacion`, {
        data: { alumno_id: ID, rol: 'DIRECTOR', actor: ID },
      }),
    ]
    for (const respuesta of await Promise.all(casos)) {
      expect(respuesta.status()).toBe(401)
      const cuerpo = await respuesta.json()
      expect(cuerpo.error).toBe('Necesitás iniciar sesión para continuar.')
      expect(cuerpo.campo).toBeUndefined()
    }
  })

  test('no existe eliminación ni lectura: todo método distinto de POST recibe 405 con Allow', async ({
    request,
  }) => {
    for (const operacion of OPERACIONES) {
      for (const metodo of ['DELETE', 'GET', 'PUT', 'PATCH']) {
        const ruta = `/api/inscripciones/comedor/${ID}/${operacion}`
        const respuesta = await request.fetch(ruta, { method: metodo })
        expect(respuesta.status(), `${metodo} ${ruta}`).toBe(405)
        expect(respuesta.headers()['allow'], `${metodo} ${ruta}`).toBe('POST, OPTIONS')
        exigirMensajeSinDetalleTecnico('405', (await respuesta.json()).error)
      }
    }
  })

  test('OPTIONS informa únicamente los métodos realmente admitidos', async ({ request }) => {
    for (const operacion of OPERACIONES) {
      const respuesta = await request.fetch(`/api/inscripciones/deportes/${ID}/${operacion}`, {
        method: 'OPTIONS',
      })
      expect(respuesta.status()).toBe(204)
      expect(respuesta.headers()['allow']).toBe('POST, OPTIONS')
    }
  })

  test('no hay ruta para la inscripción sola ni para otras operaciones', async ({ request }) => {
    // Sin segmento de operación no existe recurso: no hay borrado, edición ni lectura.
    expect((await request.delete(`/api/inscripciones/comedor/${ID}`)).status()).toBe(404)
    expect((await request.post(`/api/inscripciones/comedor/${ID}/reactivacion`)).status()).toBe(404)
  })

  test('ninguna respuesta anónima filtra detalle técnico', async ({ request }) => {
    const respuesta = await request.post(`/api/inscripciones/transporte/${ID}/confirmacion`)
    const cuerpo = (await respuesta.text()).toLowerCase()
    for (const fragmento of [
      'service_role',
      'sqlstate',
      'app_private',
      'confirmaciones_inscripcion',
      'inscripciones_servicios',
      'matriculas_administracion',
      'p62',
      'select ',
      'supabase',
    ]) {
      expect(cuerpo).not.toContain(fragmento)
    }
  })
})
