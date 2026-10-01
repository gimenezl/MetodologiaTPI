import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y carga los servicios (EPT-65). */
export default function AccesosLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-11 w-full" />
      </div>
      <p className="sr-only" role="status">Cargando el registro de accesos…</p>
    </div>
  )
}
