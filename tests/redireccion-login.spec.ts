import { expect, test } from '@playwright/test'
import { destinoPanelSeguro, urlLoginConDestino } from '@/lib/redireccion-login'

/**
 * EPT-66: el parámetro `redirect` del login solo puede apuntar a rutas internas
 * del panel. Lógica pura, sin navegador ni base de datos.
 */

const INICIO = '/dashboard'

const MALICIOSOS: Array<[string, string]> = [
  ['URL absoluta', 'https://evil.example/dashboard'],
  ['esquema relativo al protocolo', '//evil.example/dashboard'],
  ['barra y contrabarra', '/\\evil.example'],
  ['contrabarra inicial', '\\\\evil.example'],
  ['esquema javascript', 'javascript:alert(1)'],
  ['esquema data', 'data:text/html,hola'],
  ['doble barra codificada', '%2F%2Fevil.example'],
  ['barra y contrabarra codificadas', '/%5Cevil.example'],
  ['doble codificación', '%252F%252Fevil.example'],
  ['salto de línea', '/dashboard\n//evil.example'],
  ['salto de línea codificado', '/dashboard%0d%0aSet-Cookie:x=1'],
  ['carácter nulo codificado', '/dashboard%00'],
  ['tabulación (el parser la descarta)', '/\t/evil.example'],
  ['ruta fuera del panel', '/login'],
  ['API interna', '/api/usuarios'],
  ['prefijo parecido', '/dashboardx'],
  ['escape del panel por puntos', '/dashboard/../login'],
  ['escape codificado por puntos', '/dashboard/%2e%2e/login'],
  ['sin barra inicial', 'dashboard'],
  ['vacío', ''],
]

test.describe('Destino seguro del login', () => {
  for (const [nombre, valor] of MALICIOSOS) {
    test(`rechaza: ${nombre}`, () => {
      expect(destinoPanelSeguro(valor)).toBe(INICIO)
    })
  }

  test('sin parámetro usa el inicio del panel', () => {
    expect(destinoPanelSeguro(null)).toBe(INICIO)
    expect(destinoPanelSeguro(undefined)).toBe(INICIO)
  })

  for (const valor of [
    '/dashboard',
    '/dashboard/alumnos',
    '/dashboard/inscripciones?pagina=2&q=ana',
    '/dashboard/niveles?nivel=PRIMARIA#detalle',
  ]) {
    test(`admite: ${valor}`, () => {
      const esperado = valor.split('#')[0]
      expect(destinoPanelSeguro(valor)).toBe(esperado)
    })
  }

  test('conserva pathname y query al construir la URL de login desde el proxy', () => {
    const url = urlLoginConDestino(
      new URL('http://localhost:3000/dashboard/inscripciones?pagina=2&q=ana%20maria')
    )
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('redirect')).toBe('/dashboard/inscripciones?pagina=2&q=ana%20maria')
    expect(url.searchParams.has('pagina')).toBe(false)
    expect(destinoPanelSeguro(url.searchParams.get('redirect'))).toBe(
      '/dashboard/inscripciones?pagina=2&q=ana%20maria'
    )
  })
})
