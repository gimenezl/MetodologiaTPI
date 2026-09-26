import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor resuelve la sesión y las asignaciones. */
export default function MisAsignacionesLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-3">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, bloque) => (
          <div key={bloque} className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
      <p className="sr-only" role="status">
        Cargando tus asignaciones…
      </p>
    </div>
  )
}
