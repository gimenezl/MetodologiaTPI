/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { CaretDown, CaretUp, Check, PencilSimple, Pulse, Trash, UserPlus, Warning, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { darBajaInscripcion, inscribirAlumno } from '@/services/actividades.service'
import { obtenerPerfiles } from '@/services/perfiles.service'
import { obtenerRoles } from '@/services/roles.service'
import { createClient } from '@/services/supabase'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { cn, getCupoColor } from '@/lib/utils'
import type { Estudiante, Inscripcion, PropiedadesVistaCupos, Rol } from './types'
import { AVISO_DEPORTE_LEGADO, esDeporteLegado, variantePorTipo } from './types'

type RolNombre = 'DIRECTOR' | 'DOCENTE' | 'PADRE' | 'ESTUDIANTE' | 'PERSONAL' | null

type PropiedadesVistaGestion = PropiedadesVistaCupos & {
  rol: RolNombre
}

export function VistaGestionCupos({
  actividades,
  cargando,
  recargarActividades,
  rol,
}: PropiedadesVistaGestion) {
  const [filtroTipo, setFiltroTipo] = useState('TODOS')
  const [filtroNivel, setFiltroNivel] = useState('TODOS')
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([])
  const [estudianteSeleccionado, setEstudianteSeleccionado] = useState('')
  const [actividadExpandidaId, setActividadExpandidaId] = useState<number | null>(null)
  const [inscripcionesPorActividad, setInscripcionesPorActividad] = useState<Record<number, Inscripcion[]>>({})
  const [cargandoInscriptosId, setCargandoInscriptosId] = useState<number | null>(null)
  const [bajandoInscripcionId, setBajandoInscripcionId] = useState<string | null>(null)
  const [inscribiendoActividadId, setInscribiendoActividadId] = useState<number | null>(null)
  const [editandoCupoId, setEditandoCupoId] = useState<number | null>(null)
  const [nuevoCupo, setNuevoCupo] = useState('')
  const [guardandoCupo, setGuardandoCupo] = useState(false)

  const puedeGestionar = rol === 'DIRECTOR' || rol === 'DOCENTE'

  useEffect(() => {
    if (!puedeGestionar) return

    const cargarEstudiantes = async () => {
      try {
        const datosRoles = await obtenerRoles()
        const rolEstudiante = (datosRoles as Rol[]).find((rolDisponible) => rolDisponible.nombre === 'ESTUDIANTE')
        if (!rolEstudiante) return
        const datos = await obtenerPerfiles(rolEstudiante.id)
        setEstudiantes((datos ?? []) as Estudiante[])
      } catch {
        setEstudiantes([])
      }
    }

    cargarEstudiantes()
  }, [puedeGestionar, rol])

  const alternarInscriptos = async (actividadId: number) => {
    if (actividadExpandidaId === actividadId) {
      setActividadExpandidaId(null)
      return
    }

    setActividadExpandidaId(actividadId)
    if (inscripcionesPorActividad[actividadId]) return

    setCargandoInscriptosId(actividadId)
    try {
      const supabase = createClient()
      const { data, error } = await (supabase
        .from('inscripciones')
        .select(`id, estudiante:perfiles!inscripciones_estudiante_id_fkey(id, nombre, apellido, legajo_nro)`)
        .eq('actividad_id', actividadId)
        .eq('estado', 'ACTIVO') as any)
      if (error) throw new Error(error.message)
      setInscripcionesPorActividad((anteriores) => ({ ...anteriores, [actividadId]: data ?? [] }))
    } catch {
      toast.error('Error al cargar inscriptos')
    } finally {
      setCargandoInscriptosId(null)
    }
  }

  const darDeBaja = async (inscripcionId: string, actividadId: number) => {
    setBajandoInscripcionId(inscripcionId)
    try {
      await darBajaInscripcion(inscripcionId)
      toast.success('Inscripción dada de baja')
      setInscripcionesPorActividad((anteriores) => ({
        ...anteriores,
        [actividadId]: (anteriores[actividadId] ?? []).filter((inscripcion) => inscripcion.id !== inscripcionId),
      }))
      await recargarActividades()
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo dar de baja'
      toast.error(mensaje)
    } finally {
      setBajandoInscripcionId(null)
    }
  }

  const inscribirEstudiante = async (actividadId: number) => {
    if (!estudianteSeleccionado) {
      toast.error('Seleccioná un alumno primero')
      return
    }

    setInscribiendoActividadId(actividadId)
    try {
      await inscribirAlumno(estudianteSeleccionado, actividadId)
      toast.success('Alumno inscripto')
      setInscripcionesPorActividad((anteriores) => {
        const actualizadas = { ...anteriores }
        delete actualizadas[actividadId]
        return actualizadas
      })
      await recargarActividades()
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo inscribir'
      toast.error(mensaje)
    } finally {
      setInscribiendoActividadId(null)
    }
  }

  const guardarCupo = async (actividadId: number) => {
    const valor = parseInt(nuevoCupo)
    if (isNaN(valor) || valor < 1) {
      toast.error('Ingresá un número válido')
      return
    }

    setGuardandoCupo(true)
    try {
      const supabase = createClient()
      const { error } = await (supabase.from('actividades').update({ cupo_maximo: valor }).eq('id', actividadId) as any)
      if (error) throw new Error(error.message)
      toast.success('Cupo actualizado')
      setEditandoCupoId(null)
      setNuevoCupo('')
      await recargarActividades()
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo actualizar el cupo'
      toast.error(mensaje)
    } finally {
      setGuardandoCupo(false)
    }
  }

  const nivelesDisponibles = [
    'TODOS',
    ...Array.from(new Set(actividades.map((actividad) => actividad.nivel?.nombre).filter(Boolean))) as string[],
  ]
  const actividadesFiltradas = actividades.filter(
    (actividad) =>
      (filtroTipo === 'TODOS' || actividad.tipo === filtroTipo) &&
      (filtroNivel === 'TODOS' || actividad.nivel?.nombre === filtroNivel)
  )

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Gestión de Cupos</h1>
          <p className="text-neutral-500 text-sm mt-0.5">Disponibilidad en tiempo real por actividad</p>
        </div>
        <Button variant="secondary" onClick={recargarActividades} size="sm">Actualizar</Button>
      </div>

      {puedeGestionar && (
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-5">
          <p className="text-xs font-bold text-brand-700 uppercase tracking-widest mb-3">Inscribir alumno a actividad</p>
          <Select
            label="Seleccioná el alumno"
            placeholder="Buscar alumno..."
            options={estudiantes.map((estudiante) => ({
              value: estudiante.id,
              label: `${estudiante.apellido}, ${estudiante.nombre}${estudiante.legajo_nro ? ` (Leg. ${estudiante.legajo_nro})` : ''}`,
            }))}
            value={estudianteSeleccionado}
            onChange={(evento) => setEstudianteSeleccionado(evento.target.value)}
          />
          {estudianteSeleccionado && (
            <p className="text-xs text-brand-600 mt-2 font-medium">
              ✓ Alumno seleccionado. Hacé clic en &quot;Inscribir&quot; en la actividad deseada.
            </p>
          )}
        </div>
      )}

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

      <div className="space-y-3">
        {cargando
          ? Array.from({ length: 4 }).map((_, indice) => (
              <div key={indice} className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))
          : actividadesFiltradas.length === 0
            ? (
              <div className="py-16 text-center">
                <Pulse size={40} className="text-neutral-300 mx-auto mb-3" />
                <p className="text-neutral-400 text-sm">No hay actividades para este filtro</p>
              </div>
            )
            : actividadesFiltradas.map((actividad) => {
                const lleno = actividad.cupo_disponible <= 0
                const colorBarra = getCupoColor(actividad.porcentaje_ocupacion)
                const urgente = actividad.porcentaje_ocupacion >= 90 && !lleno
                const expandida = actividadExpandidaId === actividad.id
                const inscriptos = inscripcionesPorActividad[actividad.id] ?? []
                const legado = esDeporteLegado(actividad)
                const gestionable = puedeGestionar && !legado

                return (
                  <div
                    key={actividad.id}
                    className={cn(
                      'bg-white rounded-2xl border overflow-hidden transition-all duration-200',
                      lleno ? 'border-red-200' : urgente ? 'border-yellow-200' : 'border-neutral-200'
                    )}
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-neutral-900">{actividad.nombre}</h3>
                            {actividad.tipo && <Badge variant={variantePorTipo[actividad.tipo] ?? 'default'}>{actividad.tipo}</Badge>}
                            {lleno && <Badge variant="danger">Completo</Badge>}
                            {urgente && <Badge variant="warning"><Warning size={12} />Casi lleno</Badge>}
                          </div>
                          {actividad.nivel && <p className="text-xs text-neutral-400 mt-0.5">{actividad.nivel.nombre}</p>}
                          {legado && <p className="text-xs text-neutral-500 mt-1">{AVISO_DEPORTE_LEGADO}</p>}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {legado && <Badge variant="default">Histórico</Badge>}
                          {gestionable && editandoCupoId === actividad.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={1}
                                value={nuevoCupo}
                                onChange={(evento) => setNuevoCupo(evento.target.value)}
                                className="w-16 h-8 px-2 text-sm border border-brand-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                                autoFocus
                                onKeyDown={(evento) => {
                                  if (evento.key === 'Enter') guardarCupo(actividad.id)
                                  if (evento.key === 'Escape') setEditandoCupoId(null)
                                }}
                              />
                              <button
                                onClick={() => guardarCupo(actividad.id)}
                                disabled={guardandoCupo}
                                aria-label="Guardar cupo"
                                className="w-7 h-7 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center justify-center transition-colors"
                              >
                                <Check size={13} weight="bold" />
                              </button>
                              <button
                                onClick={() => setEditandoCupoId(null)}
                                aria-label="Cancelar edición de cupo"
                                className="w-7 h-7 bg-neutral-200 hover:bg-neutral-300 text-neutral-600 rounded-lg flex items-center justify-center transition-colors"
                              >
                                <X size={13} weight="bold" />
                              </button>
                            </div>
                          ) : (
                            gestionable && (
                              <button
                                onClick={() => {
                                  setEditandoCupoId(actividad.id)
                                  setNuevoCupo(String(actividad.cupo_maximo))
                                }}
                                className="flex items-center gap-1 text-xs text-neutral-400 hover:text-brand-600 transition-colors px-2 py-1 rounded-lg hover:bg-brand-50"
                                title="Editar cupo máximo"
                              >
                                <PencilSimple size={12} />
                                Cupo: {actividad.cupo_maximo}
                              </button>
                            )
                          )}

                          {gestionable && (
                            <Button
                              variant={lleno ? 'secondary' : estudianteSeleccionado ? 'accent' : 'outline'}
                              size="sm"
                              disabled={lleno || inscribiendoActividadId === actividad.id || !estudianteSeleccionado}
                              loading={inscribiendoActividadId === actividad.id}
                              onClick={() => inscribirEstudiante(actividad.id)}
                            >
                              <UserPlus size={14} />
                              {lleno ? 'Sin cupo' : 'Inscribir'}
                            </Button>
                          )}

                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs text-neutral-500 font-medium">
                            {actividad.inscriptos} / {actividad.cupo_maximo} inscriptos
                          </span>
                          <span className={cn(
                            'text-xs font-bold font-mono',
                            lleno ? 'text-red-600' : urgente ? 'text-yellow-600' : 'text-green-600'
                          )}>
                            {actividad.cupo_disponible > 0 ? `${actividad.cupo_disponible} disponibles` : 'Sin cupo'}
                          </span>
                        </div>
                        <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-700', colorBarra)}
                            style={{ width: `${Math.min(actividad.porcentaje_ocupacion, 100)}%` }}
                            role="progressbar"
                            aria-valuenow={actividad.porcentaje_ocupacion}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => alternarInscriptos(actividad.id)}
                        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-brand-600 transition-colors mt-3"
                      >
                        {expandida ? <CaretUp size={12} /> : <CaretDown size={12} />}
                        {expandida ? 'Ocultar' : 'Ver'} inscriptos ({actividad.inscriptos})
                      </button>
                    </div>

                    {expandida && (
                      <div className="border-t border-neutral-100 bg-neutral-50 px-5 py-4">
                        {cargandoInscriptosId === actividad.id ? (
                          <div className="space-y-2">
                            {Array.from({ length: 3 }).map((_, indice) => (
                              <Skeleton key={indice} className="h-8 w-full" />
                            ))}
                          </div>
                        ) : inscriptos.length === 0 ? (
                          <p className="text-xs text-neutral-400 text-center py-4">No hay alumnos inscriptos</p>
                        ) : (
                          <ul className="space-y-2">
                            {inscriptos.map((inscripcion) => (
                              <li key={inscripcion.id} className="flex items-center justify-between gap-3 bg-white rounded-xl px-4 py-2.5 border border-neutral-200">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-xs shrink-0">
                                    {inscripcion.estudiante?.nombre[0]}{inscripcion.estudiante?.apellido[0]}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-neutral-900 truncate">
                                      {inscripcion.estudiante?.apellido}, {inscripcion.estudiante?.nombre}
                                    </p>
                                    {inscripcion.estudiante?.legajo_nro && (
                                      <p className="text-xs text-neutral-400 font-mono">Leg. {inscripcion.estudiante.legajo_nro}</p>
                                    )}
                                  </div>
                                </div>
                                {gestionable && (
                                  <button
                                    onClick={() => darDeBaja(inscripcion.id, actividad.id)}
                                    disabled={bajandoInscripcionId === inscripcion.id}
                                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                                  >
                                    <Trash size={12} weight="fill" />
                                    {bajandoInscripcionId === inscripcion.id ? 'Quitando...' : 'Dar de baja'}
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
              })}
      </div>
    </div>
  )
}
