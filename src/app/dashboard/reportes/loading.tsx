import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y consulta el reporte. */
export default function ReportesLoading() {
  return (
    <div className="max-w-6xl mx-auto space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
        <Skeleton className="h-5 w-24" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, indice) => (
            <Skeleton key={indice} className="h-10 w-full" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, indice) => (
          <Skeleton key={indice} className="h-12 w-full" />
        ))}
      </div>

      <p className="sr-only">Cargando el reporte…</p>
    </div>
  )
}
