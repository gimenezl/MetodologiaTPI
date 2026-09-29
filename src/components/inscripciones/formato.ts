/**
 * Formatos compartidos por las pantallas de administración de inscripciones
 * (EPT-62).
 *
 * `timeZone` explícito y `hour12: false`: sin ellos el servidor (Node/ICU) y el
 * navegador formatean distinto —zona del proceso contra zona de la persona, y
 * espacios distintos en el «a. m.»— y React descarta el árbol hidratado. Es el
 * mismo criterio que usan el comedor, el transporte y los deportes.
 */
const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
})

/** «15/09/2026, 09:30». Un valor ausente o inválido se muestra como «—». */
export function fechaHora(valor: string | null | undefined) {
  if (!valor) return '—'
  const momento = new Date(valor)
  return Number.isNaN(momento.getTime()) ? '—' : FORMATO_FECHA_HORA.format(momento)
}

/** «Apellido, Nombre», el orden con el que Dirección ordena y busca alumnos. */
export function nombreAlumno(apellido: string, nombre: string) {
  return `${apellido}, ${nombre}`
}

/** Une las partes que existan: «Ana Directora», «Ana» o `null` si no hay ninguna. */
export function nombrePersona(nombre: string | null, apellido: string | null) {
  const partes = [nombre, apellido].filter((parte): parte is string => Boolean(parte?.trim()))
  return partes.length > 0 ? partes.join(' ') : null
}
