import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y lee los correos programados. */
export default function EnviosCorreoLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {Array.from({ length: 4 }).map((_, fila) => (
        <div key={fila} className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      ))}
      <p className="sr-only">Cargando los correos programados…</p>
    </div>
  )
}
