/**
 * Destino posterior al inicio de sesión (EPT-66).
 *
 * El parámetro `redirect` de `/login` lo controla quien arma el enlace, así que
 * nunca se confía en él: solo se admiten rutas internas del panel
 * (`/dashboard` y debajo). Todo lo demás —URL absolutas, `//host`, `/\host`,
 * esquemas, caracteres de control, variantes codificadas, escapes con `..` o
 * rutas fuera del panel— se descarta y se usa el inicio del panel.
 */

export const DESTINO_PANEL_POR_DEFECTO = '/dashboard'

const LONGITUD_MAXIMA = 2048
const BASE_FICTICIA = 'http://destino.invalid'
const MAXIMO_DECODIFICACIONES = 3

const CONTROL_O_CONTRABARRA = /[\u0000-\u001f\u007f\\]/u

function esRutaDelPanel(pathname: string): boolean {
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
}

/** Devuelve `pathname + query` si `valor` es una ruta interna del panel; si no, el inicio. */
export function destinoPanelSeguro(valor: string | null | undefined): string {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > LONGITUD_MAXIMA) {
    return DESTINO_PANEL_POR_DEFECTO
  }

  // Se inspecciona cada nivel de decodificación: `%2F%2F`, `%5C` o `%0d%0a`
  // llegan como texto inocuo y se vuelven peligrosos al decodificarse.
  let actual = valor
  for (let nivel = 0; nivel <= MAXIMO_DECODIFICACIONES; nivel += 1) {
    if (CONTROL_O_CONTRABARRA.test(actual)) return DESTINO_PANEL_POR_DEFECTO
    if (!actual.startsWith('/') || actual.startsWith('//')) return DESTINO_PANEL_POR_DEFECTO
    let siguiente: string
    try {
      siguiente = decodeURIComponent(actual)
    } catch {
      return DESTINO_PANEL_POR_DEFECTO
    }
    if (siguiente === actual) break
    actual = siguiente
    if (nivel === MAXIMO_DECODIFICACIONES) return DESTINO_PANEL_POR_DEFECTO
  }

  let analizado: URL
  try {
    analizado = new URL(valor, BASE_FICTICIA)
  } catch {
    return DESTINO_PANEL_POR_DEFECTO
  }
  if (analizado.origin !== BASE_FICTICIA || !esRutaDelPanel(analizado.pathname)) {
    return DESTINO_PANEL_POR_DEFECTO
  }
  return `${analizado.pathname}${analizado.search}`
}

/**
 * URL de `/login` a la que el proxy envía a una persona sin sesión. Conserva
 * pathname y query del destino solicitado y descarta el resto de la query
 * original para que no se filtre al formulario de acceso.
 */
export function urlLoginConDestino(solicitada: URL): URL {
  const url = new URL(solicitada)
  url.pathname = '/login'
  url.search = ''
  url.hash = ''
  url.searchParams.set(
    'redirect',
    destinoPanelSeguro(`${solicitada.pathname}${solicitada.search}`)
  )
  return url
}
