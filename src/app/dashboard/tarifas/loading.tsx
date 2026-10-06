import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y lee las tarifas. */
export default function TarifasLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {Array.from({ length: 2 }).map((_, seccion) => (
        <div key={seccion} className="space-y-3">
          <Skeleton className="h-6 w-56" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, tarjeta) => (
              <div
                key={tarjeta}
                className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3"
              >
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-10 w-full sm:w-44" />
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="sr-only">Cargando las tarifas…</p>
    </div>
  )
}
