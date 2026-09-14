import { expect, type Page } from '@playwright/test'

/**
 * Guardia de detalle técnico visible (EPT-9, cuarta revisión).
 *
 * Nada de lo que una persona lee —el DOM visible, los nombres accesibles, los
 * títulos emergentes o el mensaje de una respuesta de la API— puede contener
 * un SQLSTATE, un código de PostgREST, `schema cache`, `permission denied`, el
 * nombre de una tabla o de una restricción, SQL, una URL interna o una traza.
 */
export const PATRONES_TECNICOS: { patron: RegExp; que: string }[] = [
  { patron: /\b[0-9]{2}[0-9A-Z]{3}\b/u, que: 'un SQLSTATE' },
  { patron: /\bP[0-9]{4}\b/u, que: 'un SQLSTATE propio' },
  { patron: /PGRST[0-9]{3}/u, que: 'un código de PostgREST' },
  { patron: /schema cache/iu, que: 'la caché de esquema' },
  { patron: /permission denied/iu, que: 'un permiso denegado de PostgreSQL' },
  { patron: /duplicate key|violates|constraint/iu, que: 'una restricción de PostgreSQL' },
  { patron: /\brelation\b/iu, que: 'una relación de PostgreSQL' },
  { patron: /database error|unexpected_failure|email_exists|validation_failed|weak_password/iu, que: 'un error de Auth' },
  { patron: /JSON object requested|Cannot coerce/iu, que: 'un error de PostgREST' },
  { patron: /Failed to fetch|NetworkError|TypeError|AbortError|TimeoutError/u, que: 'un error de red del navegador' },
  { patron: /\b(?:public|auth|app_private)\.[a-z_]+/u, que: 'un nombre calificado de la base' },
  { patron: /\b[a-z]+_[a-z0-9_]+\b/u, que: 'un identificador interno' },
  { patron: /https?:\/\/(?:127\.0\.0\.1|localhost)/u, que: 'una URL interna' },
  { patron: /\n\s+at\s|\bat [\w.$<>]+ \(/u, que: 'una traza' },
  { patron: /\bselect\b[\s\S]+\bfrom\b|\binsert into\b|\bupdate\b[\s\S]+\bset\b/iu, que: 'SQL' },
]

/** Devuelve qué patrón técnico aparece en un texto, si aparece alguno. */
export function detalleTecnicoEn(texto: string) {
  return PATRONES_TECNICOS.filter(({ patron }) => patron.test(texto)).map(
    ({ patron, que }) => `${que} (${texto.match(patron)?.[0]})`
  )
}

export function exigirMensajeSinDetalleTecnico(contexto: string, texto: string) {
  expect(detalleTecnicoEn(texto), `${contexto}: «${texto}»`).toEqual([])
}

/**
 * Revisa todo lo que la pantalla le presenta a una persona: el texto visible,
 * los avisos flotantes y los atributos que leen los lectores de pantalla.
 */
export async function exigirPantallaSinDetalleTecnico(page: Page, contexto: string) {
  const presentado = await page.evaluate(() => {
    const atributos = Array.from(
      document.querySelectorAll('[aria-label], [aria-description], [title], [alt]')
    ).flatMap((elemento) =>
      ['aria-label', 'aria-description', 'title', 'alt']
        .map((nombre) => elemento.getAttribute(nombre))
        .filter((valor): valor is string => Boolean(valor))
    )
    return [document.body.innerText, ...atributos].join('\n')
  })
  const hallazgos = detalleTecnicoEn(presentado)
  expect(hallazgos, `${contexto}: la pantalla muestra detalle técnico`).toEqual([])
}
