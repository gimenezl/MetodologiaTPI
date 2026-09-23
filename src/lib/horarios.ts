/**
 * Franjas horarias semanales (EPT-12).
 *
 * Contrato, idéntico al de `supabase/migrations/015_compatibilidad_horaria.sql`:
 *
 *   - `dia_semana` va de 1 a 7, con 1 = lunes y 7 = domingo (ISO 8601).
 *   - Cada franja es el intervalo SEMIABIERTO [inicio, fin): incluye el inicio y
 *     excluye el fin, así que dos franjas contiguas no se superponen.
 *   - Dos franjas se superponen cuando son del mismo día y
 *     `inicio_a < fin_b && inicio_b < fin_a`.
 *
 * PostgreSQL es la autoridad final (`app_private.intervalos_se_superponen`):
 * esta copia solo ANTICIPA lo que la base va a decidir, para explicarlo antes
 * de enviar. `tests/horarios-paridad.spec.ts` compara las dos implementaciones
 * sobre la misma matriz de casos límite, de modo que no pueden divergir sin que
 * una prueba lo muestre.
 *
 * Módulo puro, sin dependencias de servidor: lo usan el servidor y la pantalla.
 */

export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type Franja = {
  dia_semana: number
  /** `HH:MM` o `HH:MM:SS`, tal como la devuelve PostgreSQL para `TIME`. */
  hora_inicio: string
  hora_fin: string
}

export const DIAS_SEMANA: readonly { valor: DiaSemana; nombre: string }[] = [
  { valor: 1, nombre: 'lunes' },
  { valor: 2, nombre: 'martes' },
  { valor: 3, nombre: 'miércoles' },
  { valor: 4, nombre: 'jueves' },
  { valor: 5, nombre: 'viernes' },
  { valor: 6, nombre: 'sábado' },
  { valor: 7, nombre: 'domingo' },
]

/** «lunes» para 1 … «domingo» para 7. */
export function nombreDia(dia: number): string {
  return DIAS_SEMANA.find((opcion) => opcion.valor === dia)?.nombre ?? '—'
}

/** Igual que `nombreDia`, con mayúscula inicial para títulos y listas. */
export function nombreDiaTitulo(dia: number): string {
  const nombre = nombreDia(dia)
  return nombre.charAt(0).toLocaleUpperCase('es-AR') + nombre.slice(1)
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/u

/** `true` si el texto es una hora válida `HH:MM` o `HH:MM:SS` de 00:00 a 23:59. */
export function esHoraValida(valor: string): boolean {
  return HORA.test(valor)
}

/**
 * Lleva una hora a `HH:MM:SS`. Con un formato fijo de ancho constante, el orden
 * lexicográfico coincide con el cronológico, que es lo que usa `seSuperponen`.
 */
export function normalizarHora(valor: string): string {
  const partes = HORA.exec(valor)
  if (!partes) throw new Error(`Hora inválida: ${valor}`)
  return `${partes[1]}:${partes[2]}:${partes[3] ?? '00'}`
}

/** `10:00:00` → `10:00`. */
export function horaCorta(valor: string): string {
  return normalizarHora(valor).slice(0, 5)
}

/**
 * Única definición de superposición del lado de la aplicación. Misma fórmula
 * que la base: mismo día e intersección de intervalos semiabiertos.
 */
export function seSuperponen(a: Franja, b: Franja): boolean {
  return (
    a.dia_semana === b.dia_semana &&
    normalizarHora(a.hora_inicio) < normalizarHora(b.hora_fin) &&
    normalizarHora(b.hora_inicio) < normalizarHora(a.hora_fin)
  )
}

/** Primera franja de `existentes` que se superpone con `nueva`, si hay alguna. */
export function primeraSuperpuesta<T extends Franja>(nueva: Franja, existentes: T[]): T | undefined {
  return ordenarFranjas(existentes).find((existente) => seSuperponen(nueva, existente))
}

/** Orden de presentación: por día y luego por hora de inicio. */
export function ordenarFranjas<T extends Franja>(franjas: T[]): T[] {
  return [...franjas].sort(
    (a, b) =>
      a.dia_semana - b.dia_semana ||
      normalizarHora(a.hora_inicio).localeCompare(normalizarHora(b.hora_inicio))
  )
}

/** «lunes de 10:00 a 11:00». */
export function describirFranja(franja: Franja): string {
  return `${nombreDia(franja.dia_semana)} de ${horaCorta(franja.hora_inicio)} a ${horaCorta(franja.hora_fin)}`
}

/** «Lunes · 10:00 a 11:00», para listas compactas. */
export function describirFranjaBreve(franja: Franja): string {
  return `${nombreDiaTitulo(franja.dia_semana)} · ${horaCorta(franja.hora_inicio)} a ${horaCorta(franja.hora_fin)}`
}

export type ConflictoHorario = Franja & {
  deporte: string
  grupo: string
}

/**
 * Texto del conflicto. Es el mismo que arma PostgreSQL en P5584 y el que usa
 * la pantalla al anticiparlo, para que el alumno lea lo mismo antes y después
 * de intentar la inscripción.
 */
export function mensajeConflicto(conflicto: ConflictoHorario): string {
  return `Conflicto de horario con ${conflicto.deporte} (${conflicto.grupo}): ${describirFranja(conflicto)}.`
}

export const MENSAJE_SIN_HORARIO =
  'Este grupo todavía no tiene horarios cargados, así que no admite inscripciones.'
