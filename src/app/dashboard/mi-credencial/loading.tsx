import { Skeleton } from '@/components/ui/Badge'

/** Estado inmediato mientras el servidor autoriza y obtiene la credencial (EPT-64). */
export default function CredencialLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="mx-auto w-full max-w-md space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mx-auto h-56 w-56" />
      </div>
      <p className="sr-only" role="status">Cargando la credencial…</p>
    </div>
  )
}
