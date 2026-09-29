import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { AccionesReporte } from './AccionesReporte'

/** Paneles de servidor de la sección de reportes: acceso restringido y error de lectura. */

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
        <Lock size={32} weight="fill" className="text-red-500" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">Acceso restringido</h1>
      <p className="text-neutral-500 text-sm mt-2">{mensaje}</p>
      <EnlaceBoton href={accion?.href ?? '/dashboard'} className="mt-6">
        {accion?.texto ?? 'Volver al panel'}
      </EnlaceBoton>
    </div>
  )
}

/**
 * La vista imprimible se niega a imprimir un conjunto demasiado grande. No es un
 * fallo de lectura: se explica con el total exacto y los filtros aplicados, y se
 * ofrece lo que sí corresponde (acotar con filtros o exportar el CSV completo).
 */
export function PanelImpresionExcedida({
  titulo,
  mensaje,
  total,
  filtros,
  urlExportar,
  volver,
}: {
  titulo: string
  mensaje: string
  total: number
  filtros: { etiqueta: string; valor: string }[]
  urlExportar: string
  /** El reporte en pantalla, con los mismos filtros, para acotarlos. */
  volver: string
}) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">Reportes oficiales</p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">{titulo}</h1>
      </div>
      <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex gap-3 items-start">
        <WarningCircle size={22} weight="fill" className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-3">
          <p className="text-sm font-semibold text-amber-900">Este reporte es demasiado grande para imprimirlo</p>
          <p className="text-sm text-amber-900">{mensaje}</p>
          <p className="text-xs text-amber-900">
            <span className="font-semibold">Filtros aplicados:</span>{' '}
            {filtros.map((f) => `${f.etiqueta}: ${f.valor}`).join(' · ')}
          </p>
          <AccionesReporte urlExportar={urlExportar} urlImprimir={volver} total={total} conImpresion={false} />
          <div className="flex flex-wrap gap-2">
            <EnlaceBoton href={volver} variant="outline">
              Acotar con filtros
            </EnlaceBoton>
            <EnlaceBoton href="/dashboard/reportes" variant="ghost">
              Volver a los reportes
            </EnlaceBoton>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PanelErrorLectura({
  titulo,
  mensaje,
  reintentar,
}: {
  titulo: string
  mensaje: string
  /** Dirección a la que lleva «Reintentar»: la misma pantalla, con los mismos filtros. */
  reintentar: string
}) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">Reportes oficiales</p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">{titulo}</h1>
      </div>
      <div role="alert" className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start">
        <WarningCircle size={22} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-red-800">No pudimos cargar el reporte</p>
          <p className="text-sm text-red-700 mt-1">{mensaje}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <EnlaceBoton href={reintentar} variant="outline">
              Reintentar
            </EnlaceBoton>
            <EnlaceBoton href="/dashboard/reportes" variant="ghost">
              Volver a los reportes
            </EnlaceBoton>
          </div>
        </div>
      </div>
    </div>
  )
}
