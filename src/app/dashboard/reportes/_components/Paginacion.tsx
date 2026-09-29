import Link from 'next/link'
import { cn } from '@/lib/utils'
import { parametrosDeUrl, type FiltrosReporte, type IdReporte } from '@/lib/reportes'

/** Números de página que se muestran: la primera, la última y las cercanas a la actual. */
export function paginasVisibles(actual: number, total: number): (number | 'salto')[] {
  const deseadas = new Set<number>([1, total, actual - 1, actual, actual + 1])
  const ordenadas = [...deseadas].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const resultado: (number | 'salto')[] = []
  ordenadas.forEach((n, indice) => {
    if (indice > 0 && n - ordenadas[indice - 1] > 1) resultado.push('salto')
    resultado.push(n)
  })
  return resultado
}

const CLASE_BASE =
  'inline-flex h-10 min-w-10 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors'

/**
 * Paginación por enlaces (EPT-63): cada página es una dirección, así que
 * funciona con el teclado, con «Atrás» y compartiendo el enlace. Los filtros y
 * el tamaño de página se conservan en cada enlace.
 */
export function Paginacion({
  reporte,
  filtros,
  pagina,
  paginas,
  tamano,
}: {
  reporte: IdReporte
  filtros: FiltrosReporte
  pagina: number
  paginas: number
  tamano: number
}) {
  if (paginas <= 1) return null

  const enlace = (n: number) =>
    `/dashboard/reportes/${reporte}?${parametrosDeUrl(filtros, { pagina: n, tamano }).toString()}`

  return (
    <nav aria-label="Paginación del reporte" className="flex flex-wrap items-center justify-center gap-1.5">
      {pagina > 1 ? (
        <Link href={enlace(pagina - 1)} rel="prev" className={cn(CLASE_BASE, 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100')}>
          Anterior
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(CLASE_BASE, 'border border-neutral-100 text-neutral-400')}>
          Anterior
        </span>
      )}

      {paginasVisibles(pagina, paginas).map((item, indice) =>
        item === 'salto' ? (
          <span key={`salto-${indice}`} aria-hidden="true" className="px-1 text-neutral-400">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={enlace(item)}
            aria-label={`Página ${item}`}
            aria-current={item === pagina ? 'page' : undefined}
            className={cn(
              CLASE_BASE,
              item === pagina
                ? 'bg-brand-600 text-white'
                : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'
            )}
          >
            {item}
          </Link>
        )
      )}

      {pagina < paginas ? (
        <Link href={enlace(pagina + 1)} rel="next" className={cn(CLASE_BASE, 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100')}>
          Siguiente
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(CLASE_BASE, 'border border-neutral-100 text-neutral-400')}>
          Siguiente
        </span>
      )}
    </nav>
  )
}
