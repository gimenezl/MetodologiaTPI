import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y obtiene las fichas. */
export default function ProfesoresLoading() {
  return (
    <div className="max-w-6xl mx-auto space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, filtro) => (
          <Skeleton key={filtro} className="h-8 w-28" />
        ))}
      </div>

      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, fila) => (
          <div
            key={fila}
            className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-3"
          >
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>

      <p className="sr-only" role="status">
        Cargando las fichas de profesores…
      </p>
    </div>
  )
}
