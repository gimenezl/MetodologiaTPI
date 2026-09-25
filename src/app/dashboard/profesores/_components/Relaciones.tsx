import { BookOpen, SoccerBall } from '@phosphor-icons/react/dist/ssr'
import { Badge } from '@/components/ui/Badge'
import { nombreNivel } from '@/app/dashboard/deportes/_components/formato'
import { describirFranjaBreve, horaCorta, nombreDiaTitulo, ordenarFranjas } from '@/lib/horarios'
import type { AsignacionProfesor, HorarioProfesor } from '@/services/profesores.service'

/**
 * Presentación de lo que un profesor tiene a cargo (EPT-58).
 *
 * La comparten la ficha que consulta la dirección y «Mis asignaciones». No
 * lee datos: recibe lo que la base ya derivó de materias, cursos, grupos y
 * franjas. Las relaciones vigentes y las históricas se muestran separadas.
 */

export function tituloRelacion(relacion: AsignacionProfesor) {
  if (relacion.tipo === 'MATERIA') {
    const curso = [relacion.curso_denominacion, relacion.curso_division].filter(Boolean).join(' ')
    return `${relacion.actividad_nombre} · ${curso}`
  }
  return `${relacion.grupo_nombre ?? 'Grupo'} · ${relacion.actividad_nombre}`
}

function detalleRelacion(relacion: AsignacionProfesor) {
  const partes = [
    relacion.tipo === 'MATERIA' ? 'Materia' : 'Grupo deportivo',
    `Nivel ${nombreNivel(relacion.nivel_nombre)}`,
  ]
  if (!relacion.actividad_activa) {
    partes.push(relacion.tipo === 'MATERIA' ? 'Materia inactiva' : 'Deporte inactivo')
  }
  if (relacion.curso_activo === false) partes.push('Curso inactivo')
  return partes.join(' · ')
}

function IconoRelacion({ relacion }: { relacion: AsignacionProfesor }) {
  const Icono = relacion.tipo === 'MATERIA' ? BookOpen : SoccerBall
  return (
    <span
      className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"
      aria-hidden="true"
    >
      <Icono size={16} weight="fill" />
    </span>
  )
}

function franjasDe(relacion: AsignacionProfesor, horarios: HorarioProfesor[]) {
  return ordenarFranjas(
    horarios.filter((h) => h.tipo === relacion.tipo && h.relacion_id === relacion.relacion_id)
  )
}

export function RelacionesVigentes({
  asignaciones,
  horarios,
  etiqueta,
  vacio,
}: {
  asignaciones: AsignacionProfesor[]
  horarios: HorarioProfesor[]
  etiqueta: string
  vacio: string
}) {
  const vigentes = asignaciones.filter((relacion) => relacion.vigente)
  if (vigentes.length === 0) return <p className="text-sm text-neutral-500">{vacio}</p>

  return (
    <ul className="space-y-3" aria-label={etiqueta}>
      {vigentes.map((relacion) => {
        const franjas = franjasDe(relacion, horarios)
        return (
          <li
            key={`${relacion.tipo}-${relacion.relacion_id}`}
            className="rounded-xl border border-neutral-200 p-3 flex gap-3"
          >
            <IconoRelacion relacion={relacion} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900 break-words">
                {tituloRelacion(relacion)}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">{detalleRelacion(relacion)}</p>
              {franjas.length === 0 ? (
                <p className="text-xs text-neutral-500 mt-2">Sin horarios cargados</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Horarios de ${tituloRelacion(relacion)}`}>
                  {franjas.map((franja) => (
                    <li
                      key={franja.franja_id}
                      className="text-xs font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-2 py-1"
                    >
                      {describirFranjaBreve(franja)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function RelacionesHistoricas({
  asignaciones,
  etiqueta,
  vacio,
}: {
  asignaciones: AsignacionProfesor[]
  etiqueta: string
  vacio: string
}) {
  const historicas = asignaciones.filter((relacion) => !relacion.vigente)
  if (historicas.length === 0) return <p className="text-sm text-neutral-500">{vacio}</p>

  return (
    <ul className="space-y-2" aria-label={etiqueta}>
      {historicas.map((relacion) => (
        <li
          key={`${relacion.tipo}-${relacion.relacion_id}`}
          className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 flex gap-3"
        >
          <IconoRelacion relacion={relacion} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-neutral-700 break-words">
                {tituloRelacion(relacion)}
              </p>
              <Badge variant="default">Inactiva</Badge>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">{detalleRelacion(relacion)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Franjas de las relaciones vigentes agrupadas por día, de lunes a domingo. */
export function HorarioSemanal({
  asignaciones,
  horarios,
  vacio,
}: {
  asignaciones: AsignacionProfesor[]
  horarios: HorarioProfesor[]
  vacio: string
}) {
  const porRelacion = new Map(
    asignaciones.map((relacion) => [`${relacion.tipo}-${relacion.relacion_id}`, relacion])
  )
  const franjas = ordenarFranjas(horarios)
  if (franjas.length === 0) return <p className="text-sm text-neutral-500">{vacio}</p>

  const dias = Array.from(new Set(franjas.map((franja) => franja.dia_semana)))

  return (
    <div className="space-y-4">
      {dias.map((dia) => (
        <section key={dia} aria-labelledby={`dia-${dia}`}>
          <h3 id={`dia-${dia}`} className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
            {nombreDiaTitulo(dia)}
          </h3>
          <ul className="space-y-1.5">
            {franjas
              .filter((franja) => franja.dia_semana === dia)
              .map((franja) => {
                const relacion = porRelacion.get(`${franja.tipo}-${franja.relacion_id}`)
                return (
                  <li
                    key={franja.franja_id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm"
                  >
                    <span className="font-mono text-xs font-semibold text-neutral-700 shrink-0">
                      {horaCorta(franja.hora_inicio)} a {horaCorta(franja.hora_fin)}
                    </span>
                    <span className="text-neutral-800 min-w-0 break-words">
                      {relacion ? tituloRelacion(relacion) : 'Relación no disponible'}
                    </span>
                  </li>
                )
              })}
          </ul>
        </section>
      ))}
    </div>
  )
}
