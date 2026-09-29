import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { LISTA_REPORTES } from '@/lib/reportes'
import { requerirDirector } from '@/services/autorizacion'
import { PanelRestringido } from './_components/Paneles'

export const metadata: Metadata = {
  title: 'Reportes oficiales | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo Dirección puede consultar los reportes oficiales.'

/**
 * Índice de los reportes oficiales de Dirección (EPT-63, RF17).
 *
 * La barrera de datos no está acá: cada reporte se lee con una función de
 * PostgreSQL que exige el rol DIRECTOR y cada ruta de la API vuelve a
 * comprobarlo. Esta guarda solo decide qué se muestra.
 */
export default async function ReportesPage() {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return (
      <PanelRestringido
        mensaje={autorizacion.mensaje}
        accion={autorizacion.estado === 401 ? { href: '/login', texto: 'Iniciar sesión' } : undefined}
      />
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">Dirección</p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Reportes oficiales</h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[70ch]">
          Listados cruzados de alumnos por curso, materia, deporte, nivel, horario y recorrido, y de docentes por
          nivel. Leen las mismas relaciones que usa el trabajo diario y se pueden filtrar, exportar en CSV e
          imprimir o guardar como PDF.
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Reportes disponibles">
        {LISTA_REPORTES.map((reporte) => (
          <li key={reporte.id} className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">{reporte.titulo}</h2>
              <p className="text-sm text-neutral-600 mt-1">{reporte.descripcion}</p>
            </div>
            <p className="text-xs text-neutral-500">{reporte.grano}</p>
            <Link
              href={`/dashboard/reportes/${reporte.id}`}
              className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800 underline-offset-4 hover:underline"
              aria-label={`Abrir el reporte ${reporte.titulo}`}
            >
              Abrir reporte
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
