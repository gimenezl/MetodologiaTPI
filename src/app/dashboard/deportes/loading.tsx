import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y obtiene grupos e inscripciones. */
export default function DeportesLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <Skeleton className="h-16 w-full rounded-2xl" />

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, indice) => (
          <div
            key={indice}
            className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3"
          >
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-10 w-full sm:w-40" />
          </div>
        ))}
      </div>

      <p className="sr-only" role="status">Cargando los deportes…</p>
    </div>
  )
}
