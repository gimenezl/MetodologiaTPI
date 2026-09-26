import { Info, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Badge } from '@/components/ui/Badge'
import {
  HorarioSemanal,
  RelacionesHistoricas,
  RelacionesVigentes,
} from '@/app/dashboard/profesores/_components/Relaciones'
import type { MisAsignaciones } from '@/services/profesores.service'

/**
 * Lo que el docente de la sesión tiene a cargo (EPT-58). Solo presenta: los
 * datos llegan ya derivados por la base a partir de materias, cursos, grupos y
 * franjas, y nunca incluyen a otro docente.
 */
export function VistaMisAsignaciones({ datos }: { datos: MisAsignaciones }) {
  const { ficha, asignaciones, horarios } = datos
  const faltantes = [
    ficha.legajo_nro ? null : 'el número de legajo',
    ficha.especialidad ? null : 'la especialidad',
  ].filter(Boolean)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Mi trabajo
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Mis asignaciones</h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[70ch]">
          Las materias, cursos, niveles, grupos y horarios que tenés a cargo. Si algo no coincide,
          consultalo con la dirección.
        </p>
      </div>

      <section
        aria-label="Mi ficha de profesor"
        className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-neutral-900 break-words">
              {ficha.apellido}, {ficha.nombre}
            </p>
            <p className="text-sm text-neutral-600 mt-1 break-words">
              Legajo {ficha.legajo_nro ?? 'sin cargar'} · {ficha.especialidad ?? 'Especialidad sin cargar'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={ficha.estado === 'ACTIVO' ? 'success' : 'default'} dot>
              {ficha.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </Badge>
            {!ficha.ficha_completa && <Badge variant="warning">Ficha incompleta</Badge>}
          </div>
        </div>

        {ficha.estado === 'INACTIVO' && (
          <p className="flex gap-2 items-start text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <WarningCircle size={18} weight="fill" className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            Tu ficha está inactiva. Podés consultar tu información, pero no vas a recibir asignaciones
            nuevas hasta que la dirección la reactive.
          </p>
        )}
        {faltantes.length > 0 && (
          <p className="flex gap-2 items-start text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-xl p-3">
            <Info size={18} weight="fill" className="text-brand-600 shrink-0 mt-0.5" aria-hidden="true" />
            Tu ficha está incompleta: falta {faltantes.join(' y ')}. La completa la dirección.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="titulo-a-cargo"
          className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-3"
        >
          <h2 id="titulo-a-cargo" className="font-bold text-neutral-900">
            A cargo actualmente
          </h2>
          <RelacionesVigentes
            asignaciones={asignaciones}
            horarios={horarios}
            etiqueta="Materias y grupos que tengo a cargo"
            vacio="Todavía no tenés materias ni grupos activos a cargo."
          />
        </section>

        <section
          aria-labelledby="titulo-horario"
          className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-3"
        >
          <h2 id="titulo-horario" className="font-bold text-neutral-900">
            Horario semanal
          </h2>
          <HorarioSemanal
            asignaciones={asignaciones}
            horarios={horarios}
            vacio="No hay horarios cargados para lo que tenés a cargo."
          />
        </section>
      </div>

      <section
        aria-labelledby="titulo-historicas"
        className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-3"
      >
        <div>
          <h2 id="titulo-historicas" className="font-bold text-neutral-900">
            Relaciones históricas
          </h2>
          <p className="text-sm text-neutral-500 mt-1">
            Materias y grupos que siguen a tu nombre pero están inactivos. No forman parte de tu
            horario.
          </p>
        </div>
        <RelacionesHistoricas
          asignaciones={asignaciones}
          etiqueta="Materias y grupos inactivos a mi nombre"
          vacio="No hay relaciones inactivas a tu nombre."
        />
      </section>
    </div>
  )
}
