import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Pulse, UserPlus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  eliminarInscripcionDeAlumnoEnActividad,
  inscribirAlumno,
  obtenerInscripcionesDeAlumno,
} from '@/services/actividades.service'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn, getCupoColor } from '@/lib/utils'
import type { PropiedadesVistaCupos } from './types'
import { AVISO_DEPORTE_LEGADO, esDeporteLegado, variantePorTipo } from './types'

type PropiedadesVistaEstudiante = PropiedadesVistaCupos & {
  perfilId?: string
}

export function VistaEstudiante({
  actividades,
  cargando,
  recargarActividades,
  perfilId,
}: PropiedadesVistaEstudiante) {
  const [filtroTipo, setFiltroTipo] = useState('TODOS')
  const [misActividades, setMisActividades] = useState<number[]>([])
  const [procesandoActividad, setProcesandoActividad] = useState<number | null>(null)

  const cargarMisActividades = useCallback(async () => {
    if (!perfilId) return
    try {
      const datos = await obtenerInscripcionesDeAlumno(perfilId)
      setMisActividades(((datos ?? []) as { actividad_id: number }[]).map((inscripcion) => inscripcion.actividad_id))
    } catch {
      setMisActividades([])
    }
  }, [perfilId])

  useEffect(() => {
    // La carga inicial y las recargas posteriores deben usar la misma consulta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarMisActividades()
  }, [cargarMisActividades])

  const inscribirme = async (actividadId: number) => {
    if (!perfilId) return
    setProcesandoActividad(actividadId)
    try {
      await inscribirAlumno(perfilId, actividadId)
      toast.success('¡Te inscribiste a la actividad!')
      await Promise.all([recargarActividades(), cargarMisActividades()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo inscribir')
    } finally {
      setProcesandoActividad(null)
    }
  }

  const desinscribirme = async (actividadId: number) => {
    if (!perfilId) return
    setProcesandoActividad(actividadId)
    try {
      await eliminarInscripcionDeAlumnoEnActividad(perfilId, actividadId)
      toast.success('Te diste de baja de la actividad')
      await Promise.all([recargarActividades(), cargarMisActividades()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo dar de baja')
    } finally {
      setProcesandoActividad(null)
    }
  }

  const actividadesFiltradas = actividades.filter(
    (actividad) => filtroTipo === 'TODOS' || actividad.tipo === filtroTipo
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Actividades y talleres</h1>
        <p className="text-neutral-500 text-sm mt-0.5">
          Inscribite a los talleres con cupo disponible. Los deportes se gestionan por grupo en{' '}
          <Link href="/dashboard/deportes" className="font-semibold text-brand-700 underline underline-offset-2">
            Deportes
          </Link>
          .
        </p>
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
          : actividadesFiltradas.length === 0
            ? (
              <div className="py-16 text-center">
                <Pulse size={40} className="text-neutral-300 mx-auto mb-3" />
                <p className="text-neutral-400 text-sm">No hay actividades para este filtro</p>
              </div>
            )
            : actividadesFiltradas.map((actividad) => {
                const inscripto = misActividades.includes(actividad.id)
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
                        ) : inscripto ? (
                          <Button variant="ghost" size="sm" loading={procesandoActividad === actividad.id} onClick={() => desinscribirme(actividad.id)}>
                            Darme de baja
                          </Button>
                        ) : (
                          <Button variant={lleno ? 'secondary' : 'accent'} size="sm" disabled={lleno || procesandoActividad === actividad.id} loading={procesandoActividad === actividad.id} onClick={() => inscribirme(actividad.id)}>
                            <UserPlus size={14} />
                            {lleno ? 'Sin cupo' : 'Inscribirme'}
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
    </div>
  )
}
