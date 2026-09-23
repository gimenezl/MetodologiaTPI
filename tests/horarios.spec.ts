import { expect, test } from '@playwright/test'

/**
 * Frontera HTTP de los horarios deportivos sin sesión (EPT-12).
 *
 * Demuestran que cada ruta nueva autoriza antes de validar el cuerpo, que no
 * hay superficie DELETE ni lectura anónima y que ninguna respuesta filtra
 * detalle técnico. No necesitan base de datos.
 */

const FILTRACIONES_PROHIBIDAS = [
  'service_role',
  'postgres',
  'supabase.co',
  'SQLSTATE',
  'P55',
  'app_private',
  'grupos_deportivos_horarios',
  'horarios_',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(cuerpo.toLowerCase(), `la respuesta no debe filtrar "${fragmento}"`).not.toContain(
      fragmento.toLowerCase()
    )
  }
}

const GRUPO = '11111111-1111-4111-8111-111111111111'
const FRANJA = '33333333-3333-4333-8333-333333333333'
const ALUMNO = '44444444-4444-4444-8444-444444444444'

test.describe('frontera HTTP de horarios', () => {
  test('cada operación nueva responde 401 sin sesión, con mensaje en español', async ({ request }) => {
    const intentos = [
      request.post(`/api/deportes/grupos/${GRUPO}/horarios`, {
        data: { dia_semana: 1, hora_inicio: '10:00', hora_fin: '11:00' },
      }),
      request.patch(`/api/deportes/grupos/${GRUPO}/horarios/${FRANJA}`, { data: { accion: 'dar_de_baja' } }),
      request.post('/api/deportes/inscripciones-administrativas', {
        data: { alumno_id: ALUMNO, grupo_id: GRUPO },
      }),
      request.get(`/api/deportes/compatibilidad?alumno_id=${ALUMNO}`),
      request.get('/api/deportes/compatibilidad'),
    ]
    for (const respuesta of await Promise.all(intentos)) {
      expect(respuesta.status()).toBe(401)
      const cuerpo = await respuesta.text()
      esperarSinFiltraciones(cuerpo)
      expect(JSON.parse(cuerpo).error).toBe('Necesitás iniciar sesión para continuar.')
    }
  })

  test('autoriza antes de validar un cuerpo inválido o malformado', async ({ request }) => {
    for (const data of [{ dia_semana: 9, hora_inicio: 'x' }, '{']) {
      const respuesta = await request.post('/api/deportes/grupos/no-es-un-id/horarios', {
        data,
        headers: { 'Content-Type': 'application/json' },
      })
      expect(respuesta.status()).toBe(401)
      esperarSinFiltraciones(await respuesta.text())
    }
  })

  test('no existe eliminación física ni métodos no declarados', async ({ request }) => {
    for (const ruta of [
      `/api/deportes/grupos/${GRUPO}/horarios`,
      `/api/deportes/grupos/${GRUPO}/horarios/${FRANJA}`,
      '/api/deportes/inscripciones-administrativas',
      '/api/deportes/compatibilidad',
    ]) {
      expect((await request.fetch(ruta, { method: 'DELETE' })).status()).toBe(405)
    }
    expect((await request.get(`/api/deportes/grupos/${GRUPO}/horarios`)).status()).toBe(405)
    expect((await request.get('/api/deportes/inscripciones-administrativas')).status()).toBe(405)
    expect((await request.post('/api/deportes/compatibilidad', { data: {} })).status()).toBe(405)
  })
})
