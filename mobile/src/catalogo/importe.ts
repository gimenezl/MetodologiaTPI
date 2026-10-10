/** Importes en centavos enteros. El servidor calcula; la app solo presenta. */
export type Centavos = number

const ESPACIO_NO_SEPARABLE = ' '

/**
 * Dibuja `ARS 63.606,65` (espacio no separable entre `ARS` y la cifra).
 * Función pura, sin `Intl`: el soporte regional cambia entre motores de JavaScript y plataformas (EPT-99, D4).
 */
export function formatearImporte(centavos: Centavos): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError('El importe debe ser un entero de centavos.')
  const negativo = centavos < 0
  const absoluto = Math.abs(centavos)
  const enteros = Math.floor(absoluto / 100).toString()
  const decimales = (absoluto % 100).toString().padStart(2, '0')
  const conMiles = enteros.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
  return `${negativo ? '-' : ''}ARS${ESPACIO_NO_SEPARABLE}${conMiles},${decimales}`
}
