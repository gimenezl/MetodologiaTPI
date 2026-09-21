import { useCallback, useEffect, useState } from 'react'
import { UserPlus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  eliminarInscripcionDeAlumnoEnActividad,
  inscribirAlumno,
  obtenerInscripcionesDeAlumno,
} from '@/services/actividades.service'
import { obtenerPerfiles } from '@/services/perfiles.service'
import { obtenerRoles } from '@/services/roles.service'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { cn, getCupoColor } from '@/lib/utils'
import type { Estudiante, PropiedadesVistaCupos, Rol } from './types'
import { AVISO_DEPORTE_LEGADO, esDeporteLegado, variantePorTipo } from './types'

export function VistaPadre({
  actividades,
  cargando,
  recargarActividades,
}: PropiedadesVistaCupos) {
  const [filtroTipo, setFiltroTipo] = useState('TODOS')
  const [hijos, setHijos] = useState<Estudiante[]>([])
  const [hijoSeleccionado, setHijoSeleccionado] = useState('')
  const [actividadesDelHijo, setActividadesDelHijo] = useState<number[]>([])
  const [procesandoActividad, setProcesandoActividad] = useState<number | null>(null)
  const [cargandoHijos, setCargandoHijos] = useState(true)

  const cargarHijos = useCallback(async () => {
    try {
      const roles = await obtenerRoles()
      const rolEstudiante = (roles as Rol[]).find((rol) => rol.nombre === 'ESTUDIANTE')
      if (!rolEstudiante) return

      // RLS limita los perfiles visibles del padre a sus propios hijos.
      const datos = await obtenerPerfiles(rolEstudiante.id)
      setHijos((datos ?? []) as Estudiante[])
    } catch {
      setHijos([])
    } finally {
      setCargandoHijos(false)
    }
  }, [])

  useEffect(() => {
    // La vista se monta únicamente para el rol padre y carga allí sus hijos visibles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarHijos()
  }, [cargarHijos])

  const cargarActividadesDelHijo = useCallback(async () => {
    if (!hijoSeleccionado) {
      setActividadesDelHijo([])
      return
    }
    try {
      const datos = await obtenerInscripcionesDeAlumno(hijoSeleccionado)
      setActividadesDelHijo(((datos ?? []) as { actividad_id: number }[]).map((inscripcion) => inscripcion.actividad_id))
    } catch {
      setActividadesDelHijo([])
    }
  }, [hijoSeleccionado])

  useEffect(() => {
    // Cada cambio de hijo reemplaza la lista de inscripciones que muestra la vista.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarActividadesDelHijo()
  }, [cargarActividadesDelHijo])

  const inscribirHijo = async (actividadId: number) => {
    if (!hijoSeleccionado) {
      toast.error('Elegí primero a un hijo')
      return
    }
    setProcesandoActividad(actividadId)
    try {
      await inscribirAlumno(hijoSeleccionado, actividadId)
      toast.success('Hijo inscripto a la actividad')
      await Promise.all([recargarActividades(), cargarActividadesDelHijo()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo inscribir')
    } finally {
      setProcesandoActividad(null)
    }
  }

  const desinscribirHijo = async (actividadId: number) => {
    if (!hijoSeleccionado) return
    setProcesandoActividad(actividadId)
    try {
      await eliminarInscripcionDeAlumnoEnActividad(hijoSeleccionado, actividadId)
      toast.success('Hijo dado de baja de la actividad')
      await Promise.all([recargarActividades(), cargarActividadesDelHijo()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo dar de baja')
    } finally {
      setProcesandoActividad(null)
    }
  }

  const actividadesFiltradas = actividades.filter(
    (actividad) => filtroTipo === 'TODOS' || actividad.tipo === filtroTipo
  )
  // El aviso depende de la carga de hijos, no de la de actividades: si mirara `cargando`
  // el cartel aparecería mientras los hijos todavía se están pidiendo.
  const sinHijos = !cargandoHijos && hijos.length === 0

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Actividades de mis hijos</h1>
        <p className="text-neutral-500 text-sm mt-0.5">Elegí a un hijo y anotalo (o dalo de baja) en las actividades con cupo.</p>
      </div>

      {sinHijos ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 text-sm text-yellow-800">
          No tenés hijos asignados a tu cuenta. Contactá a la administración.
        </div>
      ) : (
        <>
          <div className="bg-brand-50 border border-brand-200 rounded-2xl p-5">
            <Select
              label="Hijo/a a inscribir"
              placeholder="Seleccioná a tu hijo/a..."
              options={hijos.map((hijo) => ({
                value: hijo.id,
                label: `${hijo.apellido}, ${hijo.nombre}${hijo.legajo_nro ? ` (Leg. ${hijo.legajo_nro})` : ''}`,
              }))}
              value={hijoSeleccionado}
              onChange={(evento) => setHijoSeleccionado(evento.target.value)}
            />
            {hijoSeleccionado && (
              <p className="text-xs text-brand-600 mt-2 font-medium">
                ✓ Inscribí o dá de baja a tu hijo/a en las actividades de abajo.
              </p>
            )}
          </div>

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
            {cargando
              ? Array.from({ length: 4 }).map((_, indice) => (
                  <div key={indice} className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                ))
              : actividadesFiltradas.map((actividad) => {
                  const inscripto = actividadesDelHijo.includes(actividad.id)
                  const lleno = actividad.cupo_disponible <= 0
                  const legado = esDeporteLegado(actividad)
                  const colorBarra = getCupoColor(actividad.porcentaje_ocupacion)

                  return (
                    <div key={actividad.id} className={cn('bg-white rounded-2xl border p-5', inscripto ? 'border-brand-300' : 'border-neutral-200')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-neutral-900">{actividad.nombre}</h3>
                            {actividad.tipo && <Badge variant={variantePorTipo[actividad.tipo] ?? 'info'}>{actividad.tipo}</Badge>}
                            {inscripto && <Badge variant="success" dot>Inscripto</Badge>}
                            {lleno && !inscripto && <Badge variant="danger">Completo</Badge>}
                          </div>
                          {actividad.nivel && <p className="text-xs text-neutral-400 mt-0.5">{actividad.nivel.nombre}</p>}
                          {legado && <p className="text-xs text-neutral-500 mt-1">{AVISO_DEPORTE_LEGADO}</p>}
                        </div>
                        <div className="shrink-0">
                          {legado ? (
                            <Badge variant="default">Histórico</Badge>
                          ) : !hijoSeleccionado ? (
                            <span className="text-xs text-neutral-400">Elegí un hijo/a</span>
                          ) : inscripto ? (
                            <Button variant="ghost" size="sm" loading={procesandoActividad === actividad.id} onClick={() => desinscribirHijo(actividad.id)}>
                              Dar de baja
                            </Button>
                          ) : (
                            <Button variant={lleno ? 'secondary' : 'accent'} size="sm" disabled={lleno || procesandoActividad === actividad.id} loading={procesandoActividad === actividad.id} onClick={() => inscribirHijo(actividad.id)}>
                              <UserPlus size={14} />
                              {lleno ? 'Sin cupo' : 'Inscribir'}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs text-neutral-500 font-medium">{actividad.inscriptos} / {actividad.cupo_maximo} inscriptos</span>
                          <span className={cn('text-xs font-bold font-mono', lleno ? 'text-red-600' : 'text-green-600')}>
                            {actividad.cupo_disponible > 0 ? `${actividad.cupo_disponible} disponibles` : 'Sin cupo'}
                          </span>
                        </div>
                        <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full transition-all duration-700', colorBarra)} style={{ width: `${Math.min(actividad.porcentaje_ocupacion, 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
          </div>
        </>
      )}
    </div>
  )
}
