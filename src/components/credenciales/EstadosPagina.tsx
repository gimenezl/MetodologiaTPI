import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'

/**
 * Piezas de estado compartidas por las pantallas de la credencial (EPT-64).
 * Server Components: no llevan estado ni manejadores.
 */

export function EncabezadoCredencial({
  etiqueta,
  titulo,
  descripcion,
  idTitulo,
}: {
  etiqueta: string
  titulo: string
  descripcion: string
  idTitulo: string
}) {
  return (
    <div className="print:hidden">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-brand-700">{etiqueta}</p>
      <h1 id={idTitulo} className="text-2xl font-extrabold tracking-tight text-neutral-900">
        {titulo}
      </h1>
      <p className="mt-1 max-w-[64ch] text-sm text-neutral-600">{descripcion}</p>
    </div>
  )
}

export function AccesoRestringido({
  mensaje,
  href = '/dashboard',
  etiqueta = 'Volver al panel',
}: {
  mensaje: string
  href?: string
  etiqueta?: string
}) {
  return (
    <div className="mx-auto mt-12 max-w-md text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
        <Lock size={32} weight="fill" className="text-red-700" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-neutral-900">Acceso restringido</h1>
      <p className="mt-2 text-sm text-neutral-600">{mensaje}</p>
      <EnlaceBoton href={href} className="mt-6">
        {etiqueta}
      </EnlaceBoton>
    </div>
  )
}

export function ErrorDeLectura({
  titulo,
  mensaje,
  reintentarHref,
}: {
  titulo: string
  mensaje: string
  reintentarHref: string
}) {
  return (
    <div role="alert" className="mx-auto flex max-w-2xl items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-6">
      <WarningCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-red-900">{titulo}</p>
        <p className="mt-1 text-sm text-red-800">{mensaje}</p>
        <EnlaceBoton href={reintentarHref} size="sm" variant="outline" className="mt-4">
          Reintentar
        </EnlaceBoton>
      </div>
    </div>
  )
}
