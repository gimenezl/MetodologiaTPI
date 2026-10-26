import Link from 'next/link'
import { WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { formatearFecha } from '@/lib/tarifas'
import {
  ESTADOS_ENVIO, TIPOS_ENVIO,
  type EnvioCorreoVista, type EstadoEnvio, type FiltrosEnvios, type TipoEnvio,
} from '@/services/envios-correo-lectura.service'

const RUTA = '/dashboard/envios-correo'
const ETIQUETA_TIPO: Record<TipoEnvio, string> = { RECORDATORIO_MENSUAL: 'Recordatorio mensual', AVISO_DEUDA: 'Aviso de deuda' }
const ETIQUETA_ESTADO: Record<EstadoEnvio, string> = {
  PENDIENTE: 'Pendiente', ENVIADO: 'Aceptado por SMTP', FALLIDO: 'Fallido (se reintenta)', INCIERTO: 'Incierto',
}
const VARIANTE: Record<EstadoEnvio, 'default' | 'success' | 'warning' | 'danger'> = {
  PENDIENTE: 'default', ENVIADO: 'success', FALLIDO: 'warning', INCIERTO: 'danger',
}

function enlace(filtros: FiltrosEnvios, pagina: number): string {
  const q = new URLSearchParams()
  if (filtros.tipo) q.set('tipo', filtros.tipo)
  if (filtros.estado) q.set('estado', filtros.estado)
  if (pagina > 1) q.set('pagina', String(pagina))
  const texto = q.toString()
  return texto ? `${RUTA}?${texto}` : RUTA
}

const CHIP = 'inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold border transition-colors'

function Filtro<T extends string>({ titulo, valores, etiquetas, actual, hacia }: {
  titulo: string; valores: readonly T[]; etiquetas: Record<T, string>; actual?: T; hacia: (v?: T) => string
}) {
  return (
    <nav aria-label={titulo} className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-semibold text-neutral-600 mr-1">{titulo}:</span>
      <Link href={hacia(undefined)} aria-current={!actual ? 'true' : undefined}
        className={cn(CHIP, !actual ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100')}>
        Todos
      </Link>
      {valores.map((v) => (
        <Link key={v} href={hacia(v)} aria-current={actual === v ? 'true' : undefined}
          className={cn(CHIP, actual === v ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100')}>
          {etiquetas[v]}
        </Link>
      ))}
    </nav>
  )
}

/** Solo lectura: sin reenviar, reabrir, resolver ni borrar (EPT-118). */
export function TablaEnviosCorreo({ envios, hayMas, pagina, filtros }: {
  envios: EnvioCorreoVista[]; hayMas: boolean; pagina: number; filtros: FiltrosEnvios
}) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Correos programados</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Consulta de recordatorios mensuales y avisos de deuda. Esta pantalla no permite reenviar ni modificar resultados.
        </p>
      </div>

      <div role="note" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 items-start">
        <WarningCircle size={22} weight="fill" className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-amber-900">
          <strong>Incierto:</strong> el servidor SMTP pudo haber aceptado el mensaje sin confirmarlo. No se reintenta
          automáticamente para evitar duplicados. «Aceptado por SMTP» tampoco garantiza lectura ni recepción en el buzón final.
        </p>
      </div>

      <div className="space-y-2">
        <Filtro titulo="Tipo" valores={TIPOS_ENVIO} etiquetas={ETIQUETA_TIPO} actual={filtros.tipo}
          hacia={(v) => enlace({ ...filtros, tipo: v }, 1)} />
        <Filtro titulo="Estado" valores={ESTADOS_ENVIO} etiquetas={ETIQUETA_ESTADO} actual={filtros.estado}
          hacia={(v) => enlace({ ...filtros, estado: v }, 1)} />
      </div>

      {envios.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center text-sm text-neutral-600" role="status">
          {pagina > 1 ? 'No hay más correos programados en esta página.' : 'No hay correos programados con estos filtros.'}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Correos programados, del más reciente al más antiguo</caption>
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                {['Tipo', 'Estado', 'Fecha programada', 'Período', 'Destinatario', 'Intentos', 'Último intento', 'Motivo'].map((t) => (
                  <th key={t} scope="col" className="px-4 py-3 font-semibold whitespace-nowrap">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {envios.map((e) => (
                <tr key={e.id} data-estado={e.estado} data-tipo={e.tipo}>
                  <td className="px-4 py-3 whitespace-nowrap">{ETIQUETA_TIPO[e.tipo]}</td>
                  <td className="px-4 py-3">
                    <Badge variant={VARIANTE[e.estado]} dot>{ETIQUETA_ESTADO[e.estado]}</Badge>
                    {e.estado === 'INCIERTO' && (
                      <p className="text-xs text-red-700 mt-1 font-semibold">Pudo haber sido aceptado. Sin reintento automático.</p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatearFecha(e.fechaProgramada)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{e.periodo ? formatearFecha(e.periodo) : '—'}</td>
                  <td className="px-4 py-3">{e.destinatario}</td>
                  <td className="px-4 py-3">{e.intentos}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{e.ultimoIntento ? formatearFecha(e.ultimoIntento) : '—'}</td>
                  <td className="px-4 py-3 text-neutral-600 max-w-xs break-words">{e.motivo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(pagina > 1 || hayMas) && (
        <nav aria-label="Paginación de correos programados" className="flex items-center justify-center gap-3">
          {pagina > 1 ? (
            <Link href={enlace(filtros, pagina - 1)} rel="prev" className={cn(CHIP, 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100')}>Anterior</Link>
          ) : <span aria-disabled="true" className={cn(CHIP, 'border-neutral-100 text-neutral-400')}>Anterior</span>}
          <span className="text-sm text-neutral-600">Página {pagina}</span>
          {hayMas ? (
            <Link href={enlace(filtros, pagina + 1)} rel="next" className={cn(CHIP, 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100')}>Siguiente</Link>
          ) : <span aria-disabled="true" className={cn(CHIP, 'border-neutral-100 text-neutral-400')}>Siguiente</span>}
        </nav>
      )}
    </div>
  )
}
