import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y obtiene el legajo. */
export default function DetalleAlumnoLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6" aria-busy="true">
      <Skeleton className="h-5 w-56" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-72 max-w-full" />
      </div>
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4">
        {Array.from({ length: 3 }).map((_, fila) => (
          <div key={fila} className="grid sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((__, celda) => (
              <Skeleton key={celda} className="h-10 w-full" />
            ))}
          </div>
        ))}
      </div>
      <p className="sr-only">Cargando el legajo académico…</p>
    </div>
  )
}
