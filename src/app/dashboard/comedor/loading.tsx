import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y obtiene la inscripción. */
export default function ComedorLoading() {
  return (
    <div className="max-w-3xl mx-auto space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-32" />
          </div>
        </div>
        <Skeleton className="h-10 w-full sm:w-56" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-52" />
        {Array.from({ length: 2 }).map((_, fila) => (
          <Skeleton key={fila} className="h-20 w-full rounded-2xl" />
        ))}
      </div>

      <p className="sr-only">Cargando el comedor…</p>
    </div>
  )
}
