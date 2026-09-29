import { expect, test } from '@playwright/test'
import { exigirMensajeSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Frontera HTTP de los reportes oficiales sin sesión (EPT-63, RF17).
 *
 * Demuestran que la autorización precede a la resolución del reporte y a la
 * validación de los filtros (quien no inició sesión no puede averiguar qué
 * reportes ni qué filtros existen), que la exportación tampoco se sirve sin
 * sesión, que toda respuesta es `no-store`, que no existe superficie de
 * escritura (todo método distinto de GET recibe 405 con `Allow`) y que ninguna
 * respuesta filtra detalle técnico. No necesitan base de datos: con sesión se
 * prueba en `reportes-auth.spec.ts`.
 */

const REPORTES = [
  'alumnos-por-curso',
  'alumnos-por-materia',
  'alumnos-por-deporte',
  'alumnos-por-horario',
  'alumnos-por-recorrido',
  'docentes-por-nivel',
]

test.describe('frontera HTTP de los reportes oficiales', () => {
  test('la página de un reporte y su exportación responden 401 sin sesión', async ({ request }) => {
    for (const id of REPORTES) {
      for (const url of [`/api/reportes/${id}`, `/api/reportes/${id}/exportar`]) {
        const respuesta = await request.get(url)
        expect(respuesta.status(), url).toBe(401)
        expect(respuesta.headers()['cache-control']).toBe('no-store')
        expect(respuesta.headers()['content-type']).toContain('application/json')
        const cuerpo = await respuesta.json()
        expect(cuerpo.error).toBe('Necesitás iniciar sesión para continuar.')
        expect(cuerpo.codigo).toBe('SIN_SESION')
        exigirMensajeSinDetalleTecnico('respuesta anónima', cuerpo.error)
      }
    }
  })

  test('la sesión se exige antes que el reporte, los filtros y la paginación', async ({ request }) => {
    const casos = [
      request.get('/api/reportes/no-existe'),
      request.get('/api/reportes/alumnos-por-curso?nivel=abc&curso=x&pagina=-1'),
      request.get('/api/reportes/alumnos-por-materia?historial=1'),
      request.get('/api/reportes/alumnos-por-curso/exportar?pagina=2'),
      request.get('/api/reportes/alumnos-por-curso?inventado=1'),
    ]
    for (const respuesta of await Promise.all(casos)) {
      expect(respuesta.status()).toBe(401)
      const texto = await respuesta.text()
      // No delata qué reportes ni qué filtros existen.
      expect(texto).not.toMatch(/no existe|no aplica|filtro|historial|pagina/i)
    }
  })

  test('no hay superficie de escritura: todo método distinto de GET recibe 405 con Allow', async ({ request }) => {
    for (const url of ['/api/reportes/alumnos-por-curso', '/api/reportes/alumnos-por-curso/exportar']) {
      for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const respuesta = await request.fetch(url, { method: metodo, data: {} })
        expect(respuesta.status(), `${metodo} ${url}`).toBe(405)
        expect(respuesta.headers()['allow']).toBe('GET, OPTIONS')
      }
      const opciones = await request.fetch(url, { method: 'OPTIONS' })
      expect(opciones.status()).toBe(204)
      expect(opciones.headers()['allow']).toBe('GET, OPTIONS')
    }
  })

  test('las pantallas del panel llevan al inicio de sesión sin mostrar ningún dato', async ({ page }) => {
    for (const ruta of [
      '/dashboard/reportes',
      '/dashboard/reportes/alumnos-por-curso',
      '/dashboard/reportes/alumnos-por-curso?q=garcia',
      '/dashboard/reportes/alumnos-por-horario/imprimir',
    ]) {
      await page.goto(ruta)
      await expect(page).toHaveURL(/\/login\?(?:.*&)?redirect=%2Fdashboard%2Freportes/)
      await expect(page.getByRole('table')).toHaveCount(0)
    }
  })
})
