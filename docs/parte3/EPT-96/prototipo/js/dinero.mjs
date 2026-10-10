// EPT-96 · Importes en centavos enteros. ARS con dos decimales; sin punto flotante en los totales.
export const NBSP = String.fromCharCode(160)

const miles = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, '.')

export function formatoNumero(centavos) {
  if (!Number.isSafeInteger(centavos) || centavos < 0) throw new RangeError('Importe inválido')
  return `${miles(Math.floor(centavos / 100))},${String(centavos % 100).padStart(2, '0')}`
}

export const formatoArs = centavos => `ARS${NBSP}${formatoNumero(centavos)}`

export const sumar = importes => importes.reduce((acumulado, importe) => acumulado + importe, 0)

// Acepta «63.606,65», «63606,65» y «63606». Rechaza signos, notación científica y más de dos decimales.
export function parsearImporte(texto) {
  const limpio = String(texto).trim()
  const coincide = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/u.exec(limpio)
  if (!coincide) return null
  const enteros = Number(coincide[1].replaceAll('.', ''))
  const decimales = Number((coincide[2] ?? '').padEnd(2, '0'))
  const centavos = enteros * 100 + decimales
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null
}

export const formatoFecha = iso => iso.split('-').reverse().join('/')

// «dd/mm/aaaa» → «aaaa-mm-dd»; null si no es una fecha de calendario real.
export function parsearFecha(texto) {
  const coincide = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(String(texto).trim())
  if (!coincide) return null
  const [, dia, mes, anio] = coincide
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)))
  const iso = `${anio}-${mes}-${dia}`
  return fecha.toISOString().startsWith(iso) ? iso : null
}
