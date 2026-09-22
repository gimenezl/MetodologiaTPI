/**
 * Formatos compartidos por las dos presentaciones de deportes.
 *
 * `timeZone` explícito y `hour12: false`: sin ellos el servidor (Node/ICU) y el
 * navegador formatean distinto —zona del proceso contra zona de la persona, y
 * separadores de «a. m.» con caracteres de espacio diferentes— y React descarta
 * el árbol hidratado. Es el mismo criterio que el comedor (EPT-10).
 */
const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
})

export function fecha(valor: string | null) {
  if (!valor) return '—'
  const momento = new Date(valor)
  return Number.isNaN(momento.getTime()) ? '—' : FORMATO_FECHA.format(momento)
}

/** «PRIMARIO» → «Primario». Los niveles institucionales se guardan en mayúsculas. */
export function nombreNivel(valor: string | null | undefined) {
  if (!valor) return '—'
  const minusculas = valor.toLocaleLowerCase('es-AR')
  return minusculas.charAt(0).toLocaleUpperCase('es-AR') + minusculas.slice(1)
}

export function plazas(cantidad: number) {
  return cantidad === 1 ? '1 plaza' : `${cantidad} plazas`
}
