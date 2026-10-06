import { WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'

/** Error de lectura: no se muestra una lista vacía que parezca real. */
export function PanelErrorTarifas({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Tarifas</h1>
        <p className="text-neutral-500 text-sm mt-1">Tarifas mensuales de los servicios escolares</p>
      </div>
      <div
        role="alert"
        className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
      >
        <WarningCircle
          size={22}
          weight="fill"
          className="text-red-500 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold text-red-800">No pudimos cargar las tarifas</p>
          <p className="text-sm text-red-700 mt-1">{mensaje}</p>
          <EnlaceBoton href="/dashboard/tarifas" variant="outline" className="mt-4">
            Reintentar
          </EnlaceBoton>
        </div>
      </div>
    </div>
  )
}
