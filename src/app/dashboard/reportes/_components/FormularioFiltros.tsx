import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { Select } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import {
  ETIQUETAS_FILTRO,
  TAMANOS_PAGINA,
  etiquetaHorario,
  type Catalogos,
  type DefinicionReporte,
  type ErrorDeFiltro,
  type FiltrosReporte,
} from '@/lib/reportes'

const CLASES_CONTROL =
  'h-10 px-3 rounded-lg border bg-white text-neutral-900 text-sm border-neutral-200 hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500'

/**
 * Formulario de filtros de un reporte (EPT-63).
 *
 * Es un formulario HTML `GET`, sin JavaScript: los filtros viajan por la URL y los
 * aplica el SERVIDOR (la base de datos, no el navegador). Eso hace que cada
 * combinación sea un enlace compartible, que «Atrás» funcione y que los mismos
 * parámetros alimenten la exportación y la impresión.
 *
 * Muestra solo los filtros que el reporte admite. Donde el esquema no registra
 * historial no hay casilla: se explica por qué en lugar de ofrecer un control que
 * prometería una historia que no existe.
 */
export function FormularioFiltros({
  reporte,
  filtros,
  tamano,
  catalogos,
  errores,
}: {
  reporte: DefinicionReporte
  filtros: FiltrosReporte
  tamano: number
  catalogos: Catalogos | null
  errores: ErrorDeFiltro[]
}) {
  const admite = (filtro: (typeof reporte.filtros)[number]) => reporte.filtros.includes(filtro)
  const errorDe = (campo: string) => errores.find((error) => error.campo === campo)?.mensaje

  const opciones = {
    niveles: (catalogos?.niveles ?? []).map((n) => ({ value: n.id, label: n.nombre })),
    cursos: (catalogos?.cursos ?? []).map((c) => {
      const nivel = catalogos?.niveles.find((n) => n.id === c.nivel_id)?.nombre
      return {
        value: c.id,
        label: `${nivel ? `${nivel} · ` : ''}${c.denominacion} ${c.division}${c.activo ? '' : ' (inactivo)'}`,
      }
    }),
    materias: (catalogos?.materias ?? []).map((m) => ({ value: m.id, label: m.activo ? m.nombre : `${m.nombre} (inactiva)` })),
    deportes: (catalogos?.deportes ?? []).map((d) => ({ value: d.id, label: d.activo ? d.nombre : `${d.nombre} (inactivo)` })),
    recorridos: (catalogos?.recorridos ?? []).map((r) => ({ value: r.id, label: `${r.nombre} (${r.codigo})` })),
    horarios: (catalogos?.horarios ?? []).map((h) => ({ value: h.id, label: etiquetaHorario(h) })),
    profesores: (catalogos?.profesores ?? []).map((p) => ({ value: p.id, label: `${p.apellido}, ${p.nombre}` })),
  }

  const base = `/dashboard/reportes/${reporte.id}`

  return (
    <form method="get" action={base} className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-4">
      {/* min-w-0: un fieldset no se achica por debajo de su contenido y a 375 px desbordaba. */}
      <fieldset className="space-y-4 min-w-0">
        <legend className="text-sm font-bold text-neutral-900">Filtros</legend>
        <p className="text-xs text-neutral-500 -mt-2 max-w-[80ch]">
          Los filtros se combinan y los aplica el servidor: la pantalla, el CSV y la impresión usan siempre
          los mismos.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {admite('q') && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="filtro-q" className="text-sm font-semibold text-neutral-700">
                {ETIQUETAS_FILTRO.q}
              </label>
              <input
                id="filtro-q"
                name="q"
                type="search"
                maxLength={100}
                defaultValue={filtros.q ?? ''}
                autoComplete="off"
                aria-invalid={errorDe('q') ? true : undefined}
                aria-describedby={errorDe('q') ? 'filtro-q-error' : undefined}
                className={cn(CLASES_CONTROL, errorDe('q') && 'border-red-400')}
              />
              {errorDe('q') && (
                <p id="filtro-q-error" className="text-xs text-red-600">
                  {errorDe('q')}
                </p>
              )}
            </div>
          )}
          {admite('nivel') && (
            <Select
              id="filtro-nivel"
              name="nivel"
              label={ETIQUETAS_FILTRO.nivel}
              placeholder="Todos"
              options={opciones.niveles}
              defaultValue={filtros.nivel !== undefined ? String(filtros.nivel) : ''}
              error={errorDe('nivel')}
            />
          )}
          {admite('curso') && (
            <Select
              id="filtro-curso"
              name="curso"
              label={ETIQUETAS_FILTRO.curso}
              placeholder="Todos"
              options={opciones.cursos}
              defaultValue={filtros.curso ?? ''}
              error={errorDe('curso')}
            />
          )}
          {admite('materia') && (
            <Select
              id="filtro-materia"
              name="materia"
              label={ETIQUETAS_FILTRO.materia}
              placeholder="Todas"
              options={opciones.materias}
              defaultValue={filtros.materia !== undefined ? String(filtros.materia) : ''}
              error={errorDe('materia')}
            />
          )}
          {admite('deporte') && (
            <Select
              id="filtro-deporte"
              name="deporte"
              label={ETIQUETAS_FILTRO.deporte}
              placeholder="Todos"
              options={opciones.deportes}
              defaultValue={filtros.deporte ?? ''}
              error={errorDe('deporte')}
            />
          )}
          {admite('recorrido') && (
            <Select
              id="filtro-recorrido"
              name="recorrido"
              label={ETIQUETAS_FILTRO.recorrido}
              placeholder="Todos"
              options={opciones.recorridos}
              defaultValue={filtros.recorrido ?? ''}
              error={errorDe('recorrido')}
            />
          )}
          {admite('horario') && (
            <Select
              id="filtro-horario"
              name="horario"
              label={ETIQUETAS_FILTRO.horario}
              placeholder="Todos"
              options={opciones.horarios}
              defaultValue={filtros.horario ?? ''}
              error={errorDe('horario')}
            />
          )}
          {admite('responsable') && (
            <Select
              id="filtro-responsable"
              name="responsable"
              label={ETIQUETAS_FILTRO.responsable}
              placeholder="Todos"
              options={opciones.profesores}
              defaultValue={filtros.responsable ?? ''}
              error={errorDe('responsable')}
            />
          )}
          {admite('origen') && (
            <Select
              id="filtro-origen"
              name="origen"
              label={ETIQUETAS_FILTRO.origen}
              placeholder="Académico y deportivo"
              options={[
                { value: 'ACADEMICO', label: 'Académico' },
                { value: 'DEPORTIVO', label: 'Deportivo' },
              ]}
              defaultValue={filtros.origen ?? ''}
              error={errorDe('origen')}
            />
          )}
          <Select
            id="filtro-tamano"
            name="tamano"
            label="Filas por página"
            options={TAMANOS_PAGINA.map((n) => ({ value: n, label: String(n) }))}
            defaultValue={String(tamano)}
            error={errorDe('tamano')}
          />
        </div>

        {reporte.historial ? (
          <div className="flex items-start gap-2">
            <input
              id="filtro-historial"
              name="historial"
              type="checkbox"
              value="1"
              defaultChecked={filtros.historial}
              className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-[var(--color-brand-600)]"
              aria-describedby="filtro-historial-ayuda"
            />
            <div>
              <label htmlFor="filtro-historial" className="text-sm font-semibold text-neutral-700">
                {ETIQUETAS_FILTRO.historial}
              </label>
              <p id="filtro-historial-ayuda" className="text-xs text-neutral-500">
                Agrega las relaciones cerradas o canceladas, con sus fechas. Sin marcar, solo se muestran las
                vigentes.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg p-3 max-w-[90ch]">
            <span className="font-semibold">Historial no disponible.</span> {reporte.sinHistorial}
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="btn font-semibold rounded-lg h-10 px-4 text-sm gap-2 bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/25 transition-all duration-150"
        >
          Aplicar filtros
        </button>
        <EnlaceBoton href={base} variant="ghost">
          Limpiar filtros
        </EnlaceBoton>
      </div>
    </form>
  )
}
