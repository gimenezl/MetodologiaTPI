import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y obtiene el catálogo. */
export default function NivelesLoading() {
  return (
    <div className="max-w-6xl mx-auto space-y-6" aria-busy="true">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      <div className="hidden sm:block bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
        {Array.from({ length: 4 }).map((_, fila) => (
          <div key={fila} className="grid grid-cols-[5rem_1fr_7rem_7rem_12rem] gap-4">
            {Array.from({ length: 5 }).map((__, celda) => (
              <Skeleton key={celda} className="h-5 w-full" />
            ))}
          </div>
        ))}
      </div>

      <div className="sm:hidden space-y-3">
        {Array.from({ length: 3 }).map((_, fila) => (
          <div
            key={fila}
            className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3"
          >
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>

      <p className="sr-only">Cargando los niveles educativos…</p>
    </div>
  )
}
