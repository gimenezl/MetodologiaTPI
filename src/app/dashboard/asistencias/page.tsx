'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { CalendarCheck, Warning, CheckCircle, X, Minus, Plus } from '@phosphor-icons/react'
import { obtenerTodasAsistencias, actualizarAsistencia, registrarAsistencia } from '@/services/asistencias.service'
import { obtenerRoles } from '@/services/roles.service'
import { obtenerPerfiles } from '@/services/perfiles.service'
import { calcularPorcentajeLocal, getAsistenciaColor, cn } from '@/lib/utils'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'

type AsistenciaRow = {
  id: string
  fecha: string
  estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
  estudiante: { id: string; nombre: string; apellido: string; legajo_nro: string | null } | null
}

type Estudiante = { id: string; nombre: string; apellido: string; legajo_nro: string | null }
type Rol = { id: number; nombre: string }

const ESTADOS = ['PRESENTE', 'AUSENTE', 'JUSTIFICADO'] as const

const estadoBadge: Record<string, { variant: 'success' | 'danger' | 'warning'; label: string }> = {
  PRESENTE: { variant: 'success', label: 'Presente' },
  AUSENTE: { variant: 'danger', label: 'Ausente' },
  JUSTIFICADO: { variant: 'warning', label: 'Justificado' },
}

export default function AsistenciasPage() {
  const { perfil, rol } = useAuth()
  const isStaff = rol === 'DIRECTOR' || rol === 'DOCENTE'

  const [asistencias, setAsistencias] = useState<AsistenciaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fechaFiltro, setFechaFiltro] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([])
  const [selectedEstudiante, setSelectedEstudiante] = useState<string>('')
  const [nuevoEstado, setNuevoEstado] = useState<'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'>('PRESENTE')
  const [registrando, setRegistrando] = useState(false)
  const [historialCompleto, setHistorialCompleto] = useState<AsistenciaRow[]>([])

  const cargarAsistencias = useCallback(async () => {
    setLoading(true)
    try {
      const data = await obtenerTodasAsistencias(fechaFiltro)
      setAsistencias((data ?? []) as AsistenciaRow[])
    } catch {
      toast.error('Error al cargar asistencias')
    } finally {
      setLoading(false)
    }
  }, [fechaFiltro])

  // El historial completo (RLS filtra automáticamente: el alumno ve lo suyo, el padre el de sus hijos)
  const cargarHistorial = useCallback(async () => {
    try {
      const data = await obtenerTodasAsistencias()
      setHistorialCompleto((data ?? []) as AsistenciaRow[])
    } catch {
      setHistorialCompleto([])
    }
  }, [])

  useEffect(() => {
    if (isStaff) cargarAsistencias()
    else setLoading(false)
  }, [isStaff, cargarAsistencias])

  useEffect(() => { cargarHistorial() }, [cargarHistorial])

  const refrescarTodo = useCallback(async () => {
    await cargarAsistencias()
    await cargarHistorial()
  }, [cargarAsistencias, cargarHistorial])

  // Lista de alumnos para el formulario (solo staff)
  useEffect(() => {
    if (!isStaff) return
    const cargarEstudiantes = async () => {
      try {
        const rolesData = await obtenerRoles()
        const rolEstudiante = (rolesData as Rol[]).find((r) => r.nombre === 'ESTUDIANTE')
        if (!rolEstudiante) return
        const data = await obtenerPerfiles(rolEstudiante.id)
        setEstudiantes((data ?? []) as Estudiante[])
      } catch {
        setEstudiantes([])
      }
    }
    cargarEstudiantes()
  }, [isStaff])

  const handleEstadoChange = async (id: string, estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO') => {
    setUpdatingId(id)
    try {
      await actualizarAsistencia(id, estado)
      setAsistencias((prev) => prev.map((a) => (a.id === id ? { ...a, estado } : a)))
      toast.success('Asistencia actualizada')
    } catch {
      toast.error('Error al actualizar asistencia')
    } finally {
      setUpdatingId(null)
    }
  }

  const registrar = async () => {
    if (!selectedEstudiante || !perfil?.id) {
      toast.error('Seleccioná un alumno')
      return
    }
    setRegistrando(true)
    try {
      await registrarAsistencia({
        estudiante_id: selectedEstudiante,
        fecha: fechaFiltro,
        estado: nuevoEstado,
        docente_id: perfil.id,
      })
      toast.success('Asistencia registrada')
      await refrescarTodo()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar'
      toast.error(message)
    } finally {
      setRegistrando(false)
    }
  }

  const estudiantesStats = useMemo(() => Object.values(
    historialCompleto.reduce((acc, row) => {
      if (!row.estudiante) return acc
      const id = row.estudiante.id
      if (!acc[id]) acc[id] = { estudiante: row.estudiante, asistencias: [] }
      acc[id].asistencias.push(row)
      return acc
    }, {} as Record<string, { estudiante: AsistenciaRow['estudiante']; asistencias: AsistenciaRow[] }>)
  ), [historialCompleto])

  // ---------- VISTA ALUMNO / PADRE (solo lectura) ----------
  if (!isStaff) {
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
                {loading ? (
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

  // ---------- VISTA STAFF (gestión) ----------
  const totalDate = asistencias.length
  const presentes = asistencias.filter((a) => a.estado === 'PRESENTE').length
  const ausentes = asistencias.filter((a) => a.estado === 'AUSENTE').length
  const justificados = asistencias.filter((a) => a.estado === 'JUSTIFICADO').length

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Control de Asistencias</h1>
          <p className="text-neutral-500 text-sm mt-0.5">Registrá y consultá la asistencia diaria de los alumnos</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(fechaFiltro + 'T12:00:00'); d.setDate(d.getDate() - 1)
              setFechaFiltro(format(d, 'yyyy-MM-dd'))
            }}
            className="w-9 h-9 rounded-lg border border-neutral-200 bg-white flex items-center justify-center text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 transition-colors text-base font-bold"
            aria-label="Día anterior"
          >‹</button>
          <Input type="date" value={fechaFiltro} onChange={(e) => setFechaFiltro(e.target.value)} aria-label="Filtrar por fecha" className="w-auto" />
          <button
            onClick={() => {
              const d = new Date(fechaFiltro + 'T12:00:00'); d.setDate(d.getDate() + 1)
              setFechaFiltro(format(d, 'yyyy-MM-dd'))
            }}
            className="w-9 h-9 rounded-lg border border-neutral-200 bg-white flex items-center justify-center text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 transition-colors text-base font-bold"
            aria-label="Día siguiente"
          >›</button>
          <Button variant="secondary" onClick={cargarAsistencias} size="sm">Actualizar</Button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-5">
        <div className="grid md:grid-cols-3 gap-3">
          <Select
            label="Alumno"
            placeholder="Seleccionar alumno"
            options={estudiantes.map((e) => ({
              value: e.id,
              label: `${e.apellido}, ${e.nombre} ${e.legajo_nro ? `(${e.legajo_nro})` : ''}`.trim(),
            }))}
            value={selectedEstudiante}
            onChange={(e) => setSelectedEstudiante(e.target.value)}
          />
          <Select
            label="Estado"
            options={ESTADOS.map((estado) => ({
              value: estado,
              label: estado === 'PRESENTE' ? 'Presente' : estado === 'AUSENTE' ? 'Ausente' : 'Justificado',
            }))}
            value={nuevoEstado}
            onChange={(e) => setNuevoEstado(e.target.value as typeof nuevoEstado)}
          />
          <div className="flex items-end">
            <Button type="button" onClick={registrar} loading={registrando} fullWidth>
              <Plus size={16} weight="fill" />
              Registrar
            </Button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total alumnos', value: totalDate, icon: CalendarCheck, color: 'text-brand-600 bg-brand-50' },
          { label: 'Presentes', value: presentes, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
          { label: 'Ausentes', value: ausentes, icon: X, color: 'text-red-600 bg-red-50' },
          { label: 'Justificados', value: justificados, icon: Minus, color: 'text-yellow-600 bg-yellow-50' },
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="bg-white rounded-xl border border-neutral-200 p-4">
              <div className={`w-9 h-9 rounded-lg ${stat.color} flex items-center justify-center mb-3`}>
                <Icon size={18} weight="fill" />
              </div>
              <p className="text-2xl font-extrabold text-neutral-900">{stat.value}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{stat.label}</p>
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <h2 className="font-bold text-neutral-900 text-sm">
            Registro del {format(new Date(fechaFiltro + 'T12:00:00'), "d 'de' MMMM yyyy", { locale: es })}
          </h2>
          {totalDate > 0 && <span className="text-xs text-neutral-400">{presentes}/{totalDate} presentes</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]" aria-label="Tabla de asistencias">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Alumno</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden sm:table-cell">Legajo</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Estado</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden md:table-cell">% Asistencia</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-5 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-16" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-6 w-24 rounded-full" /></td>
                      <td className="px-5 py-3 hidden md:table-cell"><Skeleton className="h-4 w-12" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-8 w-32 ml-auto" /></td>
                    </tr>
                  ))
                : asistencias.length === 0
                  ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <CalendarCheck size={40} className="text-neutral-300" />
                          <p className="text-neutral-400 text-sm">No hay registros para esta fecha</p>
                        </div>
                      </td>
                    </tr>
                  )
                  : asistencias.map((row) => {
                      const badge = estadoBadge[row.estado]
                      const stats = estudiantesStats.find((s) => s.estudiante?.id === row.estudiante?.id)
                      const porcentaje = stats ? calcularPorcentajeLocal(stats.asistencias) : null
                      const isUpdating = updatingId === row.id
                      return (
                        <tr key={row.id} className="hover:bg-neutral-50 transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-xs shrink-0">
                                {row.estudiante?.nombre[0]}{row.estudiante?.apellido[0]}
                              </div>
                              <span className="font-medium text-neutral-900">
                                {row.estudiante?.apellido}, {row.estudiante?.nombre}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-neutral-500 hidden sm:table-cell font-mono text-xs">
                            {row.estudiante?.legajo_nro ?? '—'}
                          </td>
                          <td className="px-5 py-3"><Badge variant={badge.variant} dot>{badge.label}</Badge></td>
                          <td className="px-5 py-3 hidden md:table-cell">
                            {porcentaje !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                                  <div
                                    className={cn('h-full rounded-full transition-all duration-500',
                                      porcentaje >= 85 ? 'bg-green-500' : porcentaje >= 75 ? 'bg-yellow-500' : 'bg-red-500')}
                                    style={{ width: `${porcentaje}%` }}
                                  />
                                </div>
                                <span className={cn('text-xs font-semibold font-mono', getAsistenciaColor(porcentaje))}>
                                  {porcentaje.toFixed(0)}%
                                </span>
                                {porcentaje < 75 && <Warning size={14} className="text-red-500" weight="fill" aria-label="Porcentaje crítico" />}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {ESTADOS.map((estado) => (
                                <button
                                  key={estado}
                                  onClick={() => handleEstadoChange(row.id, estado)}
                                  disabled={isUpdating || row.estado === estado}
                                  className={cn(
                                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-150',
                                    row.estado === estado
                                      ? estado === 'PRESENTE' ? 'bg-green-100 text-green-700 cursor-default'
                                        : estado === 'AUSENTE' ? 'bg-red-100 text-red-700 cursor-default'
                                        : 'bg-yellow-100 text-yellow-700 cursor-default'
                                      : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 disabled:opacity-40'
                                  )}
                                  aria-label={`Marcar ${row.estudiante?.nombre ?? 'alumno'} como ${estado.toLowerCase()}`}
                                >
                                  {estado === 'PRESENTE' ? 'P' : estado === 'AUSENTE' ? 'A' : 'J'}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
