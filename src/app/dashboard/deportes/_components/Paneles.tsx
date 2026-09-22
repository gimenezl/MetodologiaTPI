import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'

/** Paneles de servidor de la sección Deportes (acceso restringido y error de lectura). */

export function PanelRestringido({
  mensaje,
  accion,
}: {
  mensaje: string
  accion?: { href: string; texto: string }
}) {
  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
        <Lock size={32} weight="fill" className="text-red-500" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">Acceso restringido</h1>
      <p className="text-neutral-500 text-sm mt-2">{mensaje}</p>
      <EnlaceBoton href={accion?.href ?? '/dashboard'} className="mt-6">
        {accion?.texto ?? 'Volver al panel'}
      </EnlaceBoton>
    </div>
  )
}

export function PanelErrorLectura({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Deportes</h1>
        <p className="text-neutral-500 text-sm mt-1">Inscripción a grupos deportivos</p>
      </div>
      <div
        role="alert"
        className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
      >
        <WarningCircle size={22} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">No pudimos cargar los deportes</p>
          <p className="text-sm text-red-700 mt-1">{mensaje}</p>
          <EnlaceBoton href="/dashboard/deportes" variant="outline" className="mt-4">
            Reintentar
          </EnlaceBoton>
        </div>
      </div>
    </div>
  )
}
