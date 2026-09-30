import { Badge } from '@/components/ui/Badge'
import type { EntradaHistorial } from '@/lib/credenciales-qr/tipos'

/**
 * Historial interno de credenciales de un alumno (solo Dirección, EPT-64).
 * Presentación pura. Muestra quién emitió, quién revocó y por qué; nunca el
 * identificador ni ningún dato del QR.
 */

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
})

function fecha(iso: string | null): string {
  if (!iso) return '—'
  const valor = new Date(iso)
  return Number.isNaN(valor.getTime()) ? '—' : FORMATO_FECHA_HORA.format(valor)
}

export function HistorialCredenciales({ historial }: { historial: readonly EntradaHistorial[] }) {
  if (historial.length === 0) {
    return (
      <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-8 text-center text-sm text-neutral-600">
        Este alumno todavía no tuvo ninguna credencial.
      </p>
    )
  }

  return (
    <ol className="space-y-3" aria-label="Historial de credenciales, de la más reciente a la más antigua">
      {historial.map((entrada, indice) => (
        <li key={entrada.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={entrada.estado === 'ACTIVA' ? 'success' : 'default'} dot>
              {entrada.estado === 'ACTIVA' ? 'Vigente' : 'Revocada'}
            </Badge>
            {indice === 0 && <span className="text-xs text-neutral-600">Más reciente</span>}
            {entrada.reemplaza_a && <span className="text-xs text-neutral-600">Reemplazó a la anterior</span>}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-600">Emitida</dt>
              <dd className="font-semibold text-neutral-900">
                {fecha(entrada.emitida_en)} por {entrada.emitida_por_nombre}
              </dd>
            </div>
            {entrada.revocada_en && (
              <div>
                <dt className="text-neutral-600">Revocada</dt>
                <dd className="font-semibold text-neutral-900">
                  {fecha(entrada.revocada_en)} por {entrada.revocada_por_nombre ?? '—'}
                </dd>
              </div>
            )}
            {entrada.motivo_revocacion && (
              <div className="sm:col-span-2">
                <dt className="text-neutral-600">Motivo</dt>
                <dd className="font-semibold text-neutral-900 break-words">{entrada.motivo_revocacion}</dd>
              </div>
            )}
          </dl>
        </li>
      ))}
    </ol>
  )
}
