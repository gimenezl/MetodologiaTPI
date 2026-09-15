import { esErrorDeConsulta } from '@/lib/errores'

/**
 * Clasificador defensivo de la ausencia de `public.padres_hijos` (EPT-9/011).
 *
 * La migración 011 incorporó `padres_hijos` al esquema versionado. Se conserva
 * este clasificador como compatibilidad acotada durante el despliegue en el que
 * el código de EPT-9 puede preceder por minutos a la migración 011; la
 * funcionalidad de escritura completa continúa perteneciendo a EPT-13.
 *
 * Todo lo demás tiene que fallar cerrado. Un permiso revocado, otra relación o
 * cualquier error de transporte no pueden terminar convertidos en una lista
 * vacía silenciosa: harían creer que no hay vínculos cuando en realidad no se
 * pudo leer.
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
