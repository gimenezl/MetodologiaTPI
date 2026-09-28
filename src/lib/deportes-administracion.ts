import { recortarNombreMateria } from '@/lib/validations'

/**
 * Reglas y textos de la administración de deportes y grupos (EPT-61) que la
 * pantalla anticipa y el servidor vuelve a decir cuando la base rechaza.
 *
 * Es un módulo puro, sin acceso a la base ni a `next/headers`, para que lo
 * importen tanto el servicio (solo servidor) como los componentes cliente. La
 * pantalla y la API nunca dicen cosas distintas porque arman el mensaje con las
 * mismas funciones. La autoridad sigue siendo PostgreSQL: lo que se anticipa acá
 * es una ayuda, y la base vuelve a decidir con la fila bloqueada.
 */

/** «Primario» a partir de «PRIMARIO»: los niveles se guardan en mayúsculas. */
export function nivelLegible(valor: string | null | undefined): string {
  if (!valor) return '—'
  const minusculas = valor.toLocaleLowerCase('es-AR')
  return minusculas.charAt(0).toLocaleUpperCase('es-AR') + minusculas.slice(1)
}

/**
 * Identidad de un deporte: su nombre recortado y en mayúsculas, la misma
 * expresión que el índice único de la base (`UPPER(BTRIM(nombre))`).
 */
export function normalizarNombreDeporte(valor: string): string {
  return recortarNombreMateria(valor).toLocaleUpperCase('es-AR')
}

/**
 * Un deporte con grupos (activos o inactivos) solo admite un cambio de
 * mayúsculas y minúsculas. Devuelve `true` si el nombre nuevo es de ese tipo.
 */
export function soloCambiaMayusculas(actual: string, nuevo: string): boolean {
  return normalizarNombreDeporte(actual) === normalizarNombreDeporte(nuevo)
}

export const MENSAJE_RENOMBRAR_CON_GRUPOS =
  'Este deporte ya tiene grupos, así que solo podés cambiar las mayúsculas y minúsculas del nombre, por ejemplo «Fútbol» por «FÚTBOL». Para usar otro nombre, creá un deporte nuevo.'

export const MENSAJE_NOMBRE_SIN_CAMBIOS = 'El nombre es el mismo que el actual. Modificalo para guardar.'

export function textoGruposActivos(cantidad: number): string {
  return cantidad === 1 ? '1 grupo activo' : `${cantidad} grupos activos`
}

export type GrupoActivoDeDeporte = { grupo: string; nivel: string }

/** Cuántos nombres de grupo se listan en un mensaje antes de resumir el resto. */
const MAXIMO_GRUPOS_LISTADOS = 5

/**
 * Motivo por el que un deporte no se puede inactivar: todavía tiene grupos
 * activos. Con el detalle de la base nombra cuáles; sin él, solo cuenta.
 */
export function mensajeDeporteConGruposActivos(
  cantidad: number,
  grupos?: GrupoActivoDeDeporte[]
): string {
  const base =
    cantidad === 1
      ? 'No se puede inactivar el deporte porque tiene 1 grupo activo'
      : `No se puede inactivar el deporte porque tiene ${cantidad} grupos activos`

  if (!grupos || grupos.length === 0) {
    return `${base}. Inactivá esos grupos primero.`
  }

  const nombres = grupos
    .slice(0, MAXIMO_GRUPOS_LISTADOS)
    .map((grupo) => `«${grupo.grupo}» (${nivelLegible(grupo.nivel)})`)
    .join(', ')
  const restantes = grupos.length - MAXIMO_GRUPOS_LISTADOS
  const resumen = restantes > 0 ? `${nombres} y ${restantes} más` : nombres
  return `${base}: ${resumen}. Inactivá esos grupos primero.`
}

/** Motivo por el que un grupo no se puede inactivar: tiene inscripciones activas. */
export function mensajeGrupoConInscripciones(cantidad: number): string {
  const alumnos = cantidad === 1 ? '1 alumno con inscripción activa' : `${cantidad} alumnos con inscripción activa`
  return `No se puede inactivar el grupo porque tiene ${alumnos}. Cada alumno debe cancelar la suya antes; Dirección no cancela por el alumno.`
}

/** El cupo no puede quedar por debajo de la ocupación. */
export function mensajeCupoBajoOcupacion(ocupados: number): string {
  const alumnos = ocupados === 1 ? '1 alumno inscripto' : `${ocupados} alumnos inscriptos`
  return `El cupo no puede ser menor que la cantidad de inscripciones activas: el grupo tiene ${alumnos}.`
}

export const MENSAJES_REACTIVACION_GRUPO = {
  deporteInactivo:
    'El deporte de este grupo está inactivo. Reactivá el deporte antes de reactivar el grupo.',
  nivelInactivo:
    'El nivel educativo de este grupo está inactivo. Reactivalo en Niveles antes de reactivar el grupo.',
  profesorInactivo:
    'El profesor responsable está inactivo. Editá el grupo para asignar otro profesor, o reactivá su ficha en Profesores, antes de reactivar el grupo.',
  profesorSinRol:
    'El profesor responsable ya no tiene el rol DOCENTE. Editá el grupo para asignar otro profesor antes de reactivarlo.',
} as const
