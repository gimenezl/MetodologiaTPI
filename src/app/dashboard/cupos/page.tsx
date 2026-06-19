'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Pulse, UserPlus, Warning, CaretDown, CaretUp, PencilSimple, Check, X, Trash } from '@phosphor-icons/react'
import {
  obtenerActividadesConCupos,
  inscribirAlumno,
  darBajaInscripcion,
  obtenerInscripcionesDeAlumno,
  desinscribirAlumnoDeActividad,
} from '@/services/actividades.service'
import { obtenerRoles } from '@/services/roles.service'
import { obtenerPerfiles } from '@/services/perfiles.service'
import { getCupoColor, cn } from '@/lib/utils'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'
import { createClient } from '@/services/supabase'

type ActividadConCupo = {
  id: number
  nombre: string
  tipo: string | null
  cupo_maximo: number
  inscriptos: number
  cupo_disponible: number
  porcentaje_ocupacion: number
  nivel: { nombre: string } | null
}

type Inscripcion = {
  id: string
  estudiante: { id: string; nombre: string; apellido: string; legajo_nro: string | null } | null
}

type Estudiante = { id: string; nombre: string; apellido: string; legajo_nro: string | null }
type Rol = { id: number; nombre: string }
type Nivel = { id: number; nombre: string }

const tipoBadge: Record<string, 'info' | 'success' | 'warning'> = {
  DEPORTE: 'success',
  CURRICULAR: 'info',
  TALLER: 'warning',
}

export default function CuposPage() {
  const { rol, perfil } = useAuth()
  const isStudent = rol === 'ESTUDIANTE'
  const [actividades, setActividades] = useState<ActividadConCupo[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState<string>('TODOS')
  const [filtroNivel, setFiltroNivel] = useState<string>('TODOS')
  const [misActividades, setMisActividades] = useState<number[]>([])
  const [procesandoAct, setProcesandoAct] = useState<number | null>(null)
  const [inscribiendoId, setInscribiendoId] = useState<number | null>(null)
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([])
  const [selectedEstudiante, setSelectedEstudiante] = useState<string>('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [inscripcionesMap, setInscripcionesMap] = useState<Record<number, Inscripcion[]>>({})
  const [loadingInscriptos, setLoadingInscriptos] = useState<number | null>(null)
  const [bajandoId, setBajandoId] = useState<string | null>(null)
  const [editandoCupoId, setEditandoCupoId] = useState<number | null>(null)
  const [nuevoCupo, setNuevoCupo] = useState<string>('')
  const [guardandoCupo, setGuardandoCupo] = useState(false)
  const [eliminandoId, setEliminandoId] = useState<number | null>(null)
  const [showFormActividad, setShowFormActividad] = useState(false)
  const [creandoActividad, setCreandoActividad] = useState(false)
  const [formActividad, setFormActividad] = useState({ nombre: '', tipo: 'DEPORTE', cupo_maximo: '20', nivel_id: '' })

  const canManage = rol === 'DIRECTOR' || rol === 'DOCENTE'
  const isDirector = rol === 'DIRECTOR'

  const cargarActividades = async () => {
    setLoading(true)
    try {
      const data = await obtenerActividadesConCupos()
      setActividades(data as ActividadConCupo[])
    } catch {
      toast.error('Error al cargar actividades')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargarActividades() }, [])

  useEffect(() => {
    if (!canManage) return
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
  }, [rol])

  const toggleExpanded = async (actId: number) => {
    if (expandedId === actId) {
      setExpandedId(null)
      return
    }
    setExpandedId(actId)
    if (inscripcionesMap[actId]) return
    setLoadingInscriptos(actId)
    try {
      const supabase = createClient()
      const { data, error } = await (supabase
        .from('inscripciones')
        .select(`id, estudiante:perfiles!inscripciones_estudiante_id_fkey(id, nombre, apellido, legajo_nro)`)
        .eq('actividad_id', actId)
        .eq('estado', 'ACTIVO') as any)
      if (error) throw new Error(error.message)
      setInscripcionesMap((prev) => ({ ...prev, [actId]: data ?? [] }))
    } catch {
      toast.error('Error al cargar inscriptos')
    } finally {
      setLoadingInscriptos(null)
    }
  }

  const handleBaja = async (inscripcionId: string, actId: number) => {
    setBajandoId(inscripcionId)
    try {
      await darBajaInscripcion(inscripcionId)
      toast.success('Inscripción dada de baja')
      setInscripcionesMap((prev) => ({
        ...prev,
        [actId]: (prev[actId] ?? []).filter((i) => i.id !== inscripcionId),
      }))
      await cargarActividades()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo dar de baja'
      toast.error(message)
    } finally {
      setBajandoId(null)
    }
  }

  // Cargar las actividades en las que el alumno ya está inscripto
  const cargarMisActividades = useCallback(async () => {
    if (!isStudent || !perfil?.id) return
    try {
      const data = await obtenerInscripcionesDeAlumno(perfil.id)
      setMisActividades(((data ?? []) as { actividad_id: number }[]).map((i) => i.actividad_id))
    } catch {
      setMisActividades([])
    }
  }, [isStudent, perfil?.id])

  useEffect(() => { cargarMisActividades() }, [cargarMisActividades])

  const handleInscribirme = async (actId: number) => {
    if (!perfil?.id) return
    setProcesandoAct(actId)
    try {
      await inscribirAlumno(perfil.id, actId)
      toast.success('¡Te inscribiste a la actividad!')
      await Promise.all([cargarActividades(), cargarMisActividades()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo inscribir')
    } finally {
      setProcesandoAct(null)
    }
  }

  const handleDesinscribirme = async (actId: number) => {
    if (!perfil?.id) return
    setProcesandoAct(actId)
    try {
      await desinscribirAlumnoDeActividad(perfil.id, actId)
      toast.success('Te diste de baja de la actividad')
      await Promise.all([cargarActividades(), cargarMisActividades()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo dar de baja')
    } finally {
      setProcesandoAct(null)
    }
  }

  const handleInscribir = async (actId: number) => {
    if (!selectedEstudiante) { toast.error('Seleccioná un alumno primero'); return }
    setInscribiendoId(actId)
    try {
      await inscribirAlumno(selectedEstudiante, actId)
      toast.success('Alumno inscripto')
      // Refrescar inscriptos del panel si está abierto
      setInscripcionesMap((prev) => {
        const updated = { ...prev }
        delete updated[actId]
        return updated
      })
      await cargarActividades()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo inscribir'
      toast.error(message)
    } finally {
      setInscribiendoId(null)
    }
  }

  const handleGuardarCupo = async (actId: number) => {
    const valor = parseInt(nuevoCupo)
    if (isNaN(valor) || valor < 1) { toast.error('Ingresá un número válido'); return }
    setGuardandoCupo(true)
    try {
      const supabase = createClient()
      const { error } = await (supabase.from('actividades').update({ cupo_maximo: valor }).eq('id', actId) as any)
      if (error) throw new Error(error.message)
      toast.success('Cupo actualizado')
      setEditandoCupoId(null)
      setNuevoCupo('')
      await cargarActividades()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el cupo'
      toast.error(message)
    } finally {
      setGuardandoCupo(false)
    }
  }

  const handleCrearActividad = async () => {
    if (!formActividad.nombre.trim()) { toast.error('Ingresá un nombre'); return }
    const cupo = parseInt(formActividad.cupo_maximo)
    if (isNaN(cupo) || cupo < 1) { toast.error('Cupo máximo inválido'); return }
    setCreandoActividad(true)
    try {
      const supabase = createClient()
      const payload: any = {
        nombre: formActividad.nombre.trim(),
        tipo: formActividad.tipo,
        cupo_maximo: cupo,
      }
      if (formActividad.nivel_id) payload.nivel_id = parseInt(formActividad.nivel_id)
      const { error } = await (supabase.from('actividades').insert(payload) as any)
      if (error) throw new Error(error.message)
      toast.success('Actividad creada')
      setShowFormActividad(false)
      setFormActividad({ nombre: '', tipo: 'DEPORTE', cupo_maximo: '20', nivel_id: '' })
      await cargarActividades()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear la actividad'
      toast.error(message)
    } finally {
      setCreandoActividad(false)
    }
  }

  const handleEliminarActividad = async (actId: number) => {
    if (!confirm('¿Eliminar esta actividad? Se perderán todas las inscripciones asociadas.')) return
    setEliminandoId(actId)
    try {
      const supabase = createClient()
      const { error } = await (supabase.from('actividades').delete().eq('id', actId) as any)
      if (error) throw new Error(error.message)
      toast.success('Actividad eliminada')
      setActividades((prev) => prev.filter((a) => a.id !== actId))
      if (expandedId === actId) setExpandedId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar'
      toast.error(message)
    } finally {
      setEliminandoId(null)
    }
  }

  const nivelesDisponibles = [
    'TODOS',
    ...Array.from(new Set(actividades.map((a) => a.nivel?.nombre).filter(Boolean))) as string[],
  ]

  const filtradas = actividades.filter(
    (a) =>
      (filtroTipo === 'TODOS' || a.tipo === filtroTipo) &&
      (filtroNivel === 'TODOS' || a.nivel?.nombre === filtroNivel)
  )

  // ---------- VISTA ESTUDIANTE (auto-inscripción) ----------
  if (isStudent) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Actividades y talleres</h1>
          <p className="text-neutral-500 text-sm mt-0.5">Inscribite a las actividades deportivas y talleres con cupo disponible.</p>
        </div>

        {/* Filtros por tipo */}
        <div className="flex gap-2 flex-wrap">
          {['TODOS', 'DEPORTE', 'CURRICULAR', 'TALLER'].map((tipo) => (
            <button
              key={tipo}
              onClick={() => setFiltroTipo(tipo)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-150',
                filtroTipo === tipo ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-neutral-600 border-neutral-300 hover:border-brand-400 hover:text-brand-600'
              )}
            >
              {tipo === 'TODOS' ? 'Todas' : tipo.charAt(0) + tipo.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))
            : filtradas.length === 0
              ? (
                <div className="py-16 text-center">
                  <Pulse size={40} className="text-neutral-300 mx-auto mb-3" />
                  <p className="text-neutral-400 text-sm">No hay actividades para este filtro</p>
                </div>
              )
              : filtradas.map((act) => {
                  const inscripto = misActividades.includes(act.id)
                  const lleno = act.cupo_disponible <= 0
                  const colorBar = getCupoColor(act.porcentaje_ocupacion)
                  return (
                    <div key={act.id} className={cn('bg-white rounded-2xl border p-5', inscripto ? 'border-brand-300' : 'border-neutral-200')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-neutral-900">{act.nombre}</h3>
                            {act.tipo && <Badge variant={tipoBadge[act.tipo] ?? 'info'}>{act.tipo}</Badge>}
                            {inscripto && <Badge variant="success" dot>Inscripto</Badge>}
                            {lleno && !inscripto && <Badge variant="danger">Completo</Badge>}
                          </div>
                          {act.nivel && <p className="text-xs text-neutral-400 mt-0.5">{act.nivel.nombre}</p>}
                        </div>
                        <div className="shrink-0">
                          {inscripto ? (
                            <Button variant="ghost" size="sm" loading={procesandoAct === act.id} onClick={() => handleDesinscribirme(act.id)}>
                              Darme de baja
                            </Button>
                          ) : (
                            <Button variant={lleno ? 'secondary' : 'accent'} size="sm" disabled={lleno || procesandoAct === act.id} loading={procesandoAct === act.id} onClick={() => handleInscribirme(act.id)}>
                              <UserPlus size={14} />
                              {lleno ? 'Sin cupo' : 'Inscribirme'}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs text-neutral-500 font-medium">{act.inscriptos} / {act.cupo_maximo} inscriptos</span>
                          <span className={cn('text-xs font-bold font-mono', lleno ? 'text-red-600' : 'text-green-600')}>
                            {act.cupo_disponible > 0 ? `${act.cupo_disponible} disponibles` : 'Sin cupo'}
                          </span>
                        </div>
                        <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full transition-all duration-700', colorBar)} style={{ width: `${Math.min(act.porcentaje_ocupacion, 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })
          }
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Gestión de Cupos</h1>
          <p className="text-neutral-500 text-sm mt-0.5">Disponibilidad en tiempo real por actividad</p>
        </div>
        <Button variant="secondary" onClick={cargarActividades} size="sm">Actualizar</Button>
      </div>

      {/* Selector de alumno para inscribir */}
      {canManage && (
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-5">
          <p className="text-xs font-bold text-brand-700 uppercase tracking-widest mb-3">Inscribir alumno a actividad</p>
          <Select
            label="Seleccioná el alumno"
            placeholder="Buscar alumno..."
            options={estudiantes.map((e) => ({
              value: e.id,
              label: `${e.apellido}, ${e.nombre}${e.legajo_nro ? ` (Leg. ${e.legajo_nro})` : ''}`,
            }))}
            value={selectedEstudiante}
            onChange={(e) => setSelectedEstudiante(e.target.value)}
          />
          {selectedEstudiante && (
            <p className="text-xs text-brand-600 mt-2 font-medium">
              ✓ Alumno seleccionado. Hacé clic en "Inscribir" en la actividad deseada.
            </p>
          )}
        </div>
      )}

      {/* Filtros por tipo */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Tipo</p>
        <div className="flex gap-2 flex-wrap">
          {['TODOS', 'DEPORTE', 'CURRICULAR', 'TALLER'].map((tipo) => (
            <button
              key={tipo}
              onClick={() => setFiltroTipo(tipo)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-150',
                filtroTipo === tipo
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-neutral-600 border-neutral-300 hover:border-brand-400 hover:text-brand-600'
              )}
            >
              {tipo === 'TODOS' ? 'Todas' : tipo.charAt(0) + tipo.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros por nivel */}
      {nivelesDisponibles.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Nivel</p>
          <div className="flex gap-2 flex-wrap">
            {nivelesDisponibles.map((nivel) => (
              <button
                key={nivel}
                onClick={() => setFiltroNivel(nivel)}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-150',
                  filtroNivel === nivel
                    ? 'bg-brand-700 text-white border-brand-700'
                    : 'bg-white text-neutral-600 border-neutral-300 hover:border-brand-400 hover:text-brand-600'
                )}
              >
                {nivel === 'TODOS' ? 'Todos los niveles' : nivel.charAt(0) + nivel.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="space-y-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))
          : filtradas.length === 0
            ? (
              <div className="py-16 text-center">
                <Pulse size={40} className="text-neutral-300 mx-auto mb-3" />
                <p className="text-neutral-400 text-sm">No hay actividades para este filtro</p>
              </div>
            )
            : filtradas.map((act) => {
                const lleno = act.cupo_disponible <= 0
                const colorBar = getCupoColor(act.porcentaje_ocupacion)
                const urgente = act.porcentaje_ocupacion >= 90 && !lleno
                const isExpanded = expandedId === act.id
                const inscriptos = inscripcionesMap[act.id] ?? []

                return (
                  <div
                    key={act.id}
                    className={cn(
                      'bg-white rounded-2xl border overflow-hidden transition-all duration-200',
                      lleno ? 'border-red-200' : urgente ? 'border-yellow-200' : 'border-neutral-200'
                    )}
                  >
                    {/* Card header */}
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-neutral-900">{act.nombre}</h3>
                            {act.tipo && <Badge variant={tipoBadge[act.tipo] ?? 'default'}>{act.tipo}</Badge>}
                            {lleno && <Badge variant="danger">Completo</Badge>}
                            {urgente && <Badge variant="warning"><Warning size={12} />Casi lleno</Badge>}
                          </div>
                          {act.nivel && <p className="text-xs text-neutral-400 mt-0.5">{act.nivel.nombre}</p>}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* Editar cupo máximo */}
                          {canManage && editandoCupoId === act.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={1}
                                value={nuevoCupo}
                                onChange={(e) => setNuevoCupo(e.target.value)}
                                className="w-16 h-8 px-2 text-sm border border-brand-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') handleGuardarCupo(act.id); if (e.key === 'Escape') setEditandoCupoId(null) }}
                              />
                              <button onClick={() => handleGuardarCupo(act.id)} disabled={guardandoCupo}
                                aria-label="Guardar cupo"
                                className="w-7 h-7 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center justify-center transition-colors">
                                <Check size={13} weight="bold" />
                              </button>
                              <button onClick={() => setEditandoCupoId(null)}
                                aria-label="Cancelar edición de cupo"
                                className="w-7 h-7 bg-neutral-200 hover:bg-neutral-300 text-neutral-600 rounded-lg flex items-center justify-center transition-colors">
                                <X size={13} weight="bold" />
                              </button>
                            </div>
                          ) : (
                            canManage && (
                              <button
                                onClick={() => { setEditandoCupoId(act.id); setNuevoCupo(String(act.cupo_maximo)) }}
                                className="flex items-center gap-1 text-xs text-neutral-400 hover:text-brand-600 transition-colors px-2 py-1 rounded-lg hover:bg-brand-50"
                                title="Editar cupo máximo"
                              >
                                <PencilSimple size={12} />
                                Cupo: {act.cupo_maximo}
                              </button>
                            )
                          )}

                          {/* Botón inscribir */}
                          {canManage && (
                            <Button
                              variant={lleno ? 'secondary' : selectedEstudiante ? 'accent' : 'outline'}
                              size="sm"
                              disabled={lleno || inscribiendoId === act.id || !selectedEstudiante}
                              loading={inscribiendoId === act.id}
                              onClick={() => handleInscribir(act.id)}
                            >
                              <UserPlus size={14} />
                              {lleno ? 'Sin cupo' : 'Inscribir'}
                            </Button>
                          )}

                          {/* Botón eliminar actividad (solo DIRECTOR) */}
                          {isDirector && (
                            <button
                              onClick={() => handleEliminarActividad(act.id)}
                              disabled={eliminandoId === act.id}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                              title="Eliminar actividad"
                              aria-label="Eliminar actividad"
                            >
                              <Trash size={15} weight="fill" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Barra de cupo */}
                      <div className="mt-4">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs text-neutral-500 font-medium">
                            {act.inscriptos} / {act.cupo_maximo} inscriptos
                          </span>
                          <span className={cn(
                            'text-xs font-bold font-mono',
                            lleno ? 'text-red-600' : urgente ? 'text-yellow-600' : 'text-green-600'
                          )}>
                            {act.cupo_disponible > 0 ? `${act.cupo_disponible} disponibles` : 'Sin cupo'}
                          </span>
                        </div>
                        <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-700', colorBar)}
                            style={{ width: `${Math.min(act.porcentaje_ocupacion, 100)}%` }}
                            role="progressbar"
                            aria-valuenow={act.porcentaje_ocupacion}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          />
                        </div>
                      </div>

                      {/* Toggle inscriptos */}
                      <button
                        onClick={() => toggleExpanded(act.id)}
                        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-brand-600 transition-colors mt-3"
                      >
                        {isExpanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
                        {isExpanded ? 'Ocultar' : 'Ver'} inscriptos ({act.inscriptos})
                      </button>
                    </div>

                    {/* Panel de inscriptos expandible */}
                    {isExpanded && (
                      <div className="border-t border-neutral-100 bg-neutral-50 px-5 py-4">
                        {loadingInscriptos === act.id ? (
                          <div className="space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <Skeleton key={i} className="h-8 w-full" />
                            ))}
                          </div>
                        ) : inscriptos.length === 0 ? (
                          <p className="text-xs text-neutral-400 text-center py-4">No hay alumnos inscriptos</p>
                        ) : (
                          <ul className="space-y-2">
                            {inscriptos.map((insc) => (
                              <li key={insc.id} className="flex items-center justify-between gap-3 bg-white rounded-xl px-4 py-2.5 border border-neutral-200">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-xs shrink-0">
                                    {insc.estudiante?.nombre[0]}{insc.estudiante?.apellido[0]}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-neutral-900 truncate">
                                      {insc.estudiante?.apellido}, {insc.estudiante?.nombre}
                                    </p>
                                    {insc.estudiante?.legajo_nro && (
                                      <p className="text-xs text-neutral-400 font-mono">Leg. {insc.estudiante.legajo_nro}</p>
                                    )}
                                  </div>
                                </div>
                                {canManage && (
                                  <button
                                    onClick={() => handleBaja(insc.id, act.id)}
                                    disabled={bajandoId === insc.id}
                                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                                  >
                                    <Trash size={12} weight="fill" />
                                    {bajandoId === insc.id ? 'Quitando...' : 'Dar de baja'}
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
        }
      </div>
    </div>
  )
}
