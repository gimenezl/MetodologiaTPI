'use client'

import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { CalendarCheck, Warning, CheckCircle, X, Minus, Plus } from '@phosphor-icons/react'
import {
  ErrorAsistencia,
  obtenerPanelDeAsistenciasRemoto,
  registrarAsistenciaRemota,
} from '@/services/asistencias.client'
import {
  ESTADOS_ASISTENCIA,
  mensajeDeRegistro,
  type EstadoAsistencia,
  type PanelDeAsistencias,
} from '@/lib/asistencias'
import { ESTUDIANTE_NO_DISPONIBLE, indexarEstudiantes } from '@/services/estudiantes.service'
import { calcularPorcentajeLocal, getAsistenciaColor, cn } from '@/lib/utils'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { estadoBadge, type AsistenciaRow, type Estudiante } from './tipos'

const ESTADOS = ESTADOS_ASISTENCIA
const PANEL_VACIO: PanelDeAsistencias = { estudiantes: [], asistencias: [], historial: [] }
const MENSAJE_CARGA = 'No pudimos cargar las asistencias. Volvé a intentarlo.'

/**
 * Pantalla de gestión de asistencias del personal (EPT-66 D).
 *
 * Todo pasa por `/api/asistencias`: el servidor autoriza, la base decide qué
 * alumnos ve y registra cada docente (vínculo vigente) y deriva quién registra.
 * Esta pantalla nunca envía una identidad de registrante y no muestra un éxito
 * hasta que el servidor lo confirma.
 */
export function VistaGestionAsistencias({ rol }: { rol: 'DIRECTOR' | 'DOCENTE' }) {
  const esDocente = rol === 'DOCENTE'

  const [fechaFiltro, setFechaFiltro] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [panel, setPanel] = useState<PanelDeAsistencias>(PANEL_VACIO)
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  // Cada incremento vuelve a pedir el panel al servidor (Actualizar, regreso a la
  // pestaña, y después de cada registro o rechazo).
  const [recarga, setRecarga] = useState(0)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [selectedEstudiante, setSelectedEstudiante] = useState<string>('')
  const [nuevoEstado, setNuevoEstado] = useState<EstadoAsistencia>('PRESENTE')
  const [registrando, setRegistrando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  const asistencias = panel.asistencias as AsistenciaRow[]
  const estudiantes: Estudiante[] = panel.estudiantes

  // La carga inicial, los cambios de fecha y las recargas no activan el
  // indicador desde el efecto: parte en `true` y los manejadores lo reactivan
  // antes de cambiar el filtro o el contador.
  useEffect(() => {
    let vigente = true
    obtenerPanelDeAsistenciasRemoto(fechaFiltro)
      .then((datos) => {
        if (!vigente) return
        setPanel(datos)
        setErrorCarga(null)
        // Si el alumno elegido ya no está a cargo, el selector no lo conserva.
        setSelectedEstudiante((actual) =>
          datos.estudiantes.some((estudiante) => estudiante.id === actual) ? actual : ''
        )
      })
      .catch((error) => {
        if (!vigente) return
        setErrorCarga(error instanceof ErrorAsistencia ? error.message : MENSAJE_CARGA)
      })
      .finally(() => {
        if (vigente) setLoading(false)
      })
    return () => {
      vigente = false
    }
  }, [fechaFiltro, recarga])

  // Un cambio de permisos (por ejemplo, Dirección cambia un curso o un grupo)
  // ocurre sin que esta pestaña lo sepa: al volver a ella se pide de nuevo.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') setRecarga((n) => n + 1)
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [])

  const cargando = loading

  const recargar = () => {
    setLoading(true)
    setRecarga((n) => n + 1)
  }

  const cambiarFecha = (fecha: string) => {
    if (fecha === fechaFiltro) return
    setLoading(true)
    setFechaFiltro(fecha)
  }

  const estudiantesPorId = useMemo(() => indexarEstudiantes(estudiantes), [estudiantes])

  const resolverEstudiante = (row: AsistenciaRow): Estudiante | null => {
    return row.estudiante_id ? estudiantesPorId.get(row.estudiante_id) ?? null : null
  }

  /**
   * Alta o corrección por la API. El éxito se informa solo si el servidor lo
   * confirmó; después se vuelve a pedir el panel en lugar de editar la lista
   * local. Un rechazo (por ejemplo, el alumno dejó de estar a cargo mientras la
   * página estaba abierta) se muestra tal cual y también refresca la lista.
   */
  const guardar = async (estudianteId: string, fecha: string, estado: EstadoAsistencia) => {
    setErrorAccion(null)
    try {
      const registrada = await registrarAsistenciaRemota({
        estudiante_id: estudianteId,
        fecha,
        estado,
      })
      toast.success(mensajeDeRegistro(registrada.resultado))
    } catch (error) {
      const mensaje = error instanceof ErrorAsistencia ? error.message : 'No se pudo registrar'
      setErrorAccion(mensaje)
      toast.error(mensaje)
    } finally {
      setRecarga((n) => n + 1)
    }
  }

  const handleEstadoChange = async (row: AsistenciaRow, estado: EstadoAsistencia) => {
    if (!row.estudiante_id) return
    setUpdatingId(row.id)
    try {
      await guardar(row.estudiante_id, row.fecha, estado)
    } finally {
      setUpdatingId(null)
    }
  }

  const registrar = async () => {
    if (!selectedEstudiante) {
      toast.error('Seleccioná un alumno')
      return
    }
    setRegistrando(true)
    try {
      await guardar(selectedEstudiante, fechaFiltro, nuevoEstado)
    } finally {
      setRegistrando(false)
    }
  }

  const estudiantesStats = useMemo(
    () =>
      Object.values(
        panel.historial.reduce(
          (acc, row) => {
            if (!row.estudiante_id) return acc
            const id = row.estudiante_id
            if (!acc[id]) acc[id] = { estudianteId: id, asistencias: [] }
            acc[id].asistencias.push(row)
            return acc
          },
          {} as Record<string, { estudianteId: string; asistencias: { estado: string }[] }>
        )
      ),
    [panel.historial]
  )

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
          <p className="text-neutral-500 text-sm mt-0.5">
            {esDocente
              ? 'Registrá y consultá la asistencia de los alumnos que tenés a cargo: los de los cursos donde dictás una materia y los de tus grupos deportivos.'
              : 'Registrá y consultá la asistencia diaria de los alumnos'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(fechaFiltro + 'T12:00:00'); d.setDate(d.getDate() - 1)
              cambiarFecha(format(d, 'yyyy-MM-dd'))
            }}
            className="w-9 h-9 rounded-lg border border-neutral-200 bg-white flex items-center justify-center text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 transition-colors text-base font-bold"
            aria-label="Día anterior"
          >‹</button>
          <Input type="date" value={fechaFiltro} onChange={(e) => cambiarFecha(e.target.value)} aria-label="Filtrar por fecha" className="w-auto" />
          <button
            onClick={() => {
              const d = new Date(fechaFiltro + 'T12:00:00'); d.setDate(d.getDate() + 1)
              cambiarFecha(format(d, 'yyyy-MM-dd'))
            }}
            className="w-9 h-9 rounded-lg border border-neutral-200 bg-white flex items-center justify-center text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 transition-colors text-base font-bold"
            aria-label="Día siguiente"
          >›</button>
          <Button variant="secondary" onClick={recargar} size="sm">Actualizar</Button>
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
            helperText={
              !cargando && !errorCarga && estudiantes.length === 0
                ? esDocente
                  ? 'No tenés alumnos a cargo en este momento.'
                  : 'No hay alumnos registrados.'
                : undefined
            }
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
            <Button type="button" onClick={registrar} loading={registrando} disabled={estudiantes.length === 0} fullWidth>
              <Plus size={16} weight="fill" />
              Registrar
            </Button>
          </div>
        </div>
      </div>

      {errorCarga && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <p className="text-sm text-red-700">{errorCarga}</p>
          <Button variant="secondary" size="sm" onClick={recargar}>
            Reintentar
          </Button>
        </div>
      )}

      {errorAccion && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{errorAccion}</p>
        </div>
      )}

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
              {cargando
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
                      const estudiante = resolverEstudiante(row)
                      const stats = estudiantesStats.find((s) => s.estudianteId === row.estudiante_id)
                      const porcentaje = stats ? calcularPorcentajeLocal(stats.asistencias) : null
                      const isUpdating = updatingId === row.id
                      return (
                        <tr key={row.id} className="hover:bg-neutral-50 transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-xs shrink-0"
                                aria-hidden="true"
                              >
                                {estudiante ? `${estudiante.nombre[0]}${estudiante.apellido[0]}` : '?'}
                              </div>
                              <span className="font-medium text-neutral-900">
                                {estudiante
                                  ? `${estudiante.apellido}, ${estudiante.nombre}`
                                  : ESTUDIANTE_NO_DISPONIBLE}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-neutral-500 hidden sm:table-cell font-mono text-xs">
                            {estudiante?.legajo_nro ?? '—'}
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
                                  onClick={() => handleEstadoChange(row, estado)}
                                  disabled={isUpdating || row.estado === estado || !row.estudiante_id}
                                  className={cn(
                                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-150',
                                    row.estado === estado
                                      ? estado === 'PRESENTE' ? 'bg-green-100 text-green-700 cursor-default'
                                        : estado === 'AUSENTE' ? 'bg-red-100 text-red-700 cursor-default'
                                        : 'bg-yellow-100 text-yellow-700 cursor-default'
                                      : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 disabled:opacity-40'
                                  )}
                                  aria-label={`Marcar ${estudiante?.nombre ?? 'alumno'} como ${estado.toLowerCase()}`}
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
