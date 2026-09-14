import { esErrorDeConsulta } from '@/lib/errores'

/**
 * Clasificador de la ausencia conocida de `public.padres_hijos` (EPT-9).
 *
 * `padres_hijos` no existe en el esquema versionado: ninguna migración la crea
 * y la funcionalidad pertenece a EPT-13. La pantalla de Usuarios consulta esa
 * tabla y tiene que poder cargar igual, así que esa ausencia —y solo esa— se
 * degrada a «no hay vínculos».
 *
 * Todo lo demás tiene que fallar cerrado. Una tabla que falta por error, una
 * caché de esquema desactualizada después de un despliegue o un permiso
 * revocado no pueden terminar convertidos en una lista vacía silenciosa: harían
 * creer que no hay vínculos cuando en realidad no se pudo leer.
 *
 * La versión anterior aceptaba cualquier mensaje que *contuviera* `padres_hijos`,
 * de modo que `padres_hijos_backup`, `padres_hijos_old` u `otra_padres_hijos`
 * pasaban por la ausencia documentada. Ahora se exige, a la vez:
 *
 * - la forma real de un error de PostgREST (`code` y `message` como cadenas);
 * - el estado HTTP 404, que es con el que PostgREST informa una relación ausente;
 * - uno de los dos códigos de ausencia, `PGRST205` o `42P01`;
 * - el mensaje completo de ese código, anclado de principio a fin;
 * - y, dentro de él, exactamente `public.padres_hijos`: esquema y tabla.
 */

/** Esquema y tabla exactos cuya ausencia está documentada. */
export const TABLA_DE_VINCULOS = 'public.padres_hijos'

/** PostgREST: la tabla no figura en su caché de esquema. */
const AUSENCIA_EN_POSTGREST = /^Could not find the table '([^']+)' in the schema cache$/u

/** PostgreSQL: la relación no existe. */
const AUSENCIA_EN_POSTGRESQL = /^relation "([^"]+)" does not exist$/u

export function esAusenciaDeLaTablaDeVinculos(error: unknown, estadoHttp: number | null): boolean {
  if (!esErrorDeConsulta(error)) return false
  if (estadoHttp !== 404) return false

  const patron =
    error.code === 'PGRST205'
      ? AUSENCIA_EN_POSTGREST
      : error.code === '42P01'
        ? AUSENCIA_EN_POSTGRESQL
        : null
  if (!patron) return false

  return patron.exec(error.message)?.[1] === TABLA_DE_VINCULOS
}
