import { Skeleton } from '@/components/ui/Badge'

/**
 * Estado de carga de `/dashboard/cursos`. Next lo muestra mientras el componente
 * de servidor autoriza y lee los cursos.
 */
export default function CursosLoading() {
  return (
    <div className="max-w-6xl mx-auto space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                {['Curso', 'Nivel', 'Estado', 'Acciones'].map((col) => (
                  <th
                    key={col}
                    className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {Array.from({ length: 5 }).map((_, fila) => (
                <tr key={fila}>
                  {Array.from({ length: 4 }).map((_, celda) => (
                    <td key={celda} className="px-5 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="sr-only">Cargando los cursos…</p>
    </div>
  )
}
