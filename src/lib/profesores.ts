/**
 * Contrato de texto de la ficha de profesor (EPT-58).
 *
 * Es la copia de la aplicación de lo que PostgreSQL hace en la migración A
 * (`app_private.normalizar_especialidad`, `app_private.especialidad_valida` y
 * `app_private.normalizar_motivo_estado`). La base sigue siendo la autoridad;
 * esta copia existe para que el formulario y la API rechacen lo mismo antes de
 * llegar a ella. `supabase/tests/profesores_paridad.mjs` compara las dos.
 *
 * No importa nada: Node la carga directamente en la prueba de paridad.
 */

/**
 * Espacios en blanco del contrato, escritos uno por uno.
 *
 * Es exactamente el conjunto de la migración A (el mismo de
 * `nombre_materia_valido`, 012). No se usa `\s`: en JavaScript no incluye
 * U+0085 (next line), que PostgreSQL sí trata como espacio, y una especialidad
 * aceptada acá terminaría normalizada distinto en la base.
 */
const TRAMO_DE_ESPACIOS =
  /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+/gu

const ESPACIOS_LATERALES =
  /^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/gu

export const ESPECIALIDAD_MINIMO = 2
export const ESPECIALIDAD_MAXIMO = 100
export const MOTIVO_MAXIMO = 500

/**
 * Cantidad de caracteres como la cuenta PostgreSQL (`char_length`): puntos de
 * código, no unidades UTF-16. Un emoji cuenta uno, no dos.
 */
export function cantidadDeCaracteres(valor: string): number {
  return Array.from(valor).length
}

/**
 * Cada tramo de espacios pasa a ser un único espacio y se recortan los
 * extremos. «  Ciencias[U+00A0] Naturales » queda «Ciencias Naturales».
 */
export function normalizarEspecialidad(valor: string): string {
  return valor.replace(TRAMO_DE_ESPACIOS, ' ').replace(/^ | $/gu, '')
}

/** `true` si el valor ya está normalizado y mide entre 2 y 100 caracteres. */
export function especialidadValida(valor: string): boolean {
  const largo = cantidadDeCaracteres(valor)
  return (
    valor === normalizarEspecialidad(valor) &&
    largo >= ESPECIALIDAD_MINIMO &&
    largo <= ESPECIALIDAD_MAXIMO
  )
}

/**
 * Motivo de un cambio de estado: solo se recortan los extremos (puede tener
 * varias líneas) y un motivo vacío es `null`.
 */
export function normalizarMotivo(valor: string): string | null {
  const recortado = valor.replace(ESPACIOS_LATERALES, '')
  return recortado === '' ? null : recortado
}
