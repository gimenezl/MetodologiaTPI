'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { FileText, Check } from '@phosphor-icons/react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { obtenerSolicitudes, actualizarEstadoSolicitud, aceptarSolicitud } from '@/services/inscripciones.service'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

type Solicitud = {
  id: string
  datos_aspirante: Record<string, unknown>
  estado: 'PENDIENTE' | 'REVISADO' | 'ACEPTADO'
  fecha_solicitud: string
}

const estadoConfig = {
  PENDIENTE: { variant: 'warning' as const, label: 'Pendiente', next: 'REVISADO' as const, nextLabel: 'Marcar revisado' },
  REVISADO: { variant: 'info' as const, label: 'Revisado', next: 'ACEPTADO' as const, nextLabel: 'Aceptar' },
  ACEPTADO: { variant: 'success' as const, label: 'Aceptado', next: null, nextLabel: null },
}

function actividadesDe(solicitud: Solicitud): string[] {
  const valor = solicitud.datos_aspirante.actividades_interes
  return Array.isArray(valor) ? valor.filter((a): a is string => typeof a === 'string') : []
}

export default function SolicitudesPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Solicitud | null>(null)
  const [filtro, setFiltro] = useState<string>('TODOS')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    obtenerSolicitudes()
      .then((data) => { if (vigente) setSolicitudes(data as Solicitud[]) })
      .catch(() => { if (vigente) toast.error('Error al cargar solicitudes') })
      .finally(() => { if (vigente) setLoading(false) })
    return () => { vigente = false }
  }, [])

  const avanzarEstado = async (sol: Solicitud) => {
    const config = estadoConfig[sol.estado]
    if (!config.next) return
    setUpdatingId(sol.id)
    try {
      if (config.next === 'ACEPTADO') {
        await aceptarSolicitud(sol.id, sol.datos_aspirante)
      } else {
        await actualizarEstadoSolicitud(sol.id, config.next)
      }
      setSolicitudes((prev) =>
        prev.map((s) => s.id === sol.id ? { ...s, estado: config.next! } : s)
      )
      if (selected?.id === sol.id) {
        setSelected((prev) => prev ? { ...prev, estado: config.next! } : null)
      }
      toast.success(`Solicitud marcada como ${config.next.toLowerCase()}`)
    } catch { toast.error('Error al actualizar') }
    finally { setUpdatingId(null) }
  }

  const filtradas = solicitudes.filter(
    (s) => filtro === 'TODOS' || s.estado === filtro
  )

  const getField = (datos: Record<string, unknown>, key: string) =>
    (datos[key] as string) ?? '—'

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          Solicitudes de Inscripción
        </h1>
        <p className="text-neutral-500 text-sm mt-0.5">
          Revisá y procesá las pre-inscripciones recibidas
        </p>
      </div>

      {/* Filtros + stats */}
      <div className="flex flex-wrap gap-2 items-center">
        {['TODOS', 'PENDIENTE', 'REVISADO', 'ACEPTADO'].map((estado) => {
          const count = estado === 'TODOS'
            ? solicitudes.length
            : solicitudes.filter((s) => s.estado === estado).length
          return (
            <button
              key={estado}
              onClick={() => setFiltro(estado)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-150 flex items-center gap-2',
                filtro === estado
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-neutral-600 border-neutral-300 hover:border-brand-400'
              )}
            >
              {estado === 'TODOS' ? 'Todas' : estado.charAt(0) + estado.slice(1).toLowerCase()}
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded-full font-bold',
                filtro === estado ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-500'
              )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Lista */}
        <div className="space-y-3">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              ))
            : filtradas.length === 0
              ? (
                <div className="py-12 text-center bg-white rounded-xl border border-neutral-200">
                  <FileText size={40} className="text-neutral-300 mx-auto mb-3" />
                  <p className="text-neutral-400 text-sm">Sin solicitudes en este estado</p>
                </div>
              )
              : filtradas.map((sol) => {
                  const datos = sol.datos_aspirante as Record<string, unknown>
                  const config = estadoConfig[sol.estado]
                  const isActive = selected?.id === sol.id

                  return (
                    <div
                      key={sol.id}
                      onClick={() => setSelected(isActive ? null : sol)}
                      className={cn(
                        'bg-white rounded-xl border p-4 cursor-pointer transition-all duration-200',
                        isActive
                          ? 'border-brand-400 shadow-sm ring-1 ring-brand-400/20'
                          : 'border-neutral-200 hover:border-brand-300 hover:shadow-sm'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-neutral-900 text-sm">
                            {getField(datos, 'apellido')}, {getField(datos, 'nombre')}
                          </p>
                          <p className="text-xs text-neutral-400 mt-0.5">
                            {getField(datos, 'nivel')} ·{' '}
                            {format(new Date(sol.fecha_solicitud), "d MMM yyyy", { locale: es })}
                          </p>
                        </div>
                        <Badge variant={config.variant} dot>{config.label}</Badge>
                      </div>
                    </div>
                  )
                })
          }
        </div>

        {/* Detalle */}
        {selected ? (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-5 sticky top-8">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold text-neutral-900">Detalle de solicitud</h2>
                <p className="text-xs text-neutral-400 mt-0.5 font-mono">{selected.id.slice(0, 8)}…</p>
              </div>
              <Badge variant={estadoConfig[selected.estado].variant} dot>
                {estadoConfig[selected.estado].label}
              </Badge>
            </div>

            <div className="space-y-3">
              {Object.entries(selected.datos_aspirante as Record<string, unknown>)
                .filter(([k]) => k !== 'acepta_terminos' && k !== 'actividades_interes')
                .map(([key, val]) => (
                  <div key={key} className="flex justify-between items-start text-sm border-b border-neutral-100 pb-2">
                    <span className="text-neutral-400 text-xs uppercase tracking-wider font-semibold min-w-[140px]">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-neutral-800 text-right font-medium">{String(val) || '—'}</span>
                  </div>
                ))
              }
              {actividadesDe(selected).length > 0 && (
                <div className="text-sm">
                  <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-2">
                    Actividades de interés
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {actividadesDe(selected).map((a) => (
                      <span key={a} className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full text-xs font-semibold">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {estadoConfig[selected.estado].next && (
              <Button
                fullWidth
                onClick={() => avanzarEstado(selected)}
                loading={updatingId === selected.id}
              >
                <Check size={16} />
                {estadoConfig[selected.estado].nextLabel}
              </Button>
            )}
          </div>
        ) : (
          <div className="hidden lg:flex items-center justify-center bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 min-h-[300px]">
            <p className="text-neutral-400 text-sm">Seleccioná una solicitud para ver el detalle</p>
          </div>
        )}
      </div>
    </div>
  )
}
