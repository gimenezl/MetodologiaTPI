'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarCheck } from '@phosphor-icons/react'
import { obtenerAsistenciasPropias } from '@/services/asistencias.client'
import { calcularPorcentajeLocal, getAsistenciaColor, cn } from '@/lib/utils'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { estadoBadge, type AsistenciaRow } from './tipos'

/**
 * Historial de asistencia de solo lectura del alumno de la sesión o, para un
 * padre, de sus hijos vinculados. La RLS de la base limita las filas; esta
 * pantalla no ofrece ninguna escritura a estos roles.
 */
export function VistaAsistenciaPropia({ rol }: { rol: string | null }) {
  const [historialCompleto, setHistorialCompleto] = useState<AsistenciaRow[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    obtenerAsistenciasPropias()
      .then((data) => {
        if (vigente) setHistorialCompleto(data as AsistenciaRow[])
      })
      .catch(() => {
        if (vigente) setHistorialCompleto([])
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [])

  const historialOrdenado = [...historialCompleto].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const totalH = historialCompleto.length
  const presentesH = historialCompleto.filter((a) => a.estado === 'PRESENTE').length
  const ausentesH = historialCompleto.filter((a) => a.estado === 'AUSENTE').length
  const justificadosH = historialCompleto.filter((a) => a.estado === 'JUSTIFICADO').length
  const porcentajeGlobal = historialCompleto.length ? calcularPorcentajeLocal(historialCompleto) : null
  const esPadre = rol === 'PADRE'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          {esPadre ? 'Asistencia de mis hijos' : 'Mi asistencia'}
        </h1>
        <p className="text-neutral-500 text-sm mt-0.5">
          Consultá el historial de asistencia. Solo los docentes pueden registrar o modificar.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Registros', value: totalH, color: 'text-brand-600 bg-brand-50' },
          { label: 'Presentes', value: presentesH, color: 'text-green-600 bg-green-50' },
          { label: 'Ausentes', value: ausentesH, color: 'text-red-600 bg-red-50' },
          { label: 'Justificados', value: justificadosH, color: 'text-yellow-600 bg-yellow-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-neutral-200 p-4">
            <p className="text-2xl font-extrabold text-neutral-900">{stat.value}</p>
            <p className="text-xs text-neutral-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {porcentajeGlobal !== null && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 flex items-center justify-between">
          <span className="text-sm font-semibold text-neutral-700">Porcentaje de asistencia</span>
          <span className={cn('text-lg font-extrabold font-mono', getAsistenciaColor(porcentajeGlobal))}>
            {porcentajeGlobal.toFixed(0)}%
          </span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100">
          <h2 className="font-bold text-neutral-900 text-sm">Historial de asistencia</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[320px]" aria-label="Historial de asistencia">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                {esPadre && <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Alumno</th>}
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Fecha</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {cargando ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {esPadre && <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>}
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-6 w-20 rounded-full" /></td>
                  </tr>
                ))
              ) : historialOrdenado.length === 0 ? (
                <tr>
                  <td colSpan={esPadre ? 3 : 2} className="px-4 py-16 text-center">
                    <CalendarCheck size={40} className="text-neutral-300 mx-auto mb-3" />
                    <p className="text-neutral-400 text-sm">Todavía no hay registros de asistencia</p>
                  </td>
                </tr>
              ) : (
                historialOrdenado.map((row) => {
                  const badge = estadoBadge[row.estado]
                  return (
                    <tr key={row.id} className="hover:bg-neutral-50 transition-colors">
                      {esPadre && (
                        <td className="px-4 py-3 font-medium text-neutral-900">
                          {row.estudiante?.apellido}, {row.estudiante?.nombre}
                        </td>
                      )}
                      <td className="px-4 py-3 text-neutral-600">
                        {format(new Date(row.fecha + 'T12:00:00'), "d 'de' MMM yyyy", { locale: es })}
                      </td>
                      <td className="px-4 py-3"><Badge variant={badge.variant} dot>{badge.label}</Badge></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
