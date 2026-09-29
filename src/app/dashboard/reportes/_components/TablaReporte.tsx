import { cn } from '@/lib/utils'
import { CLAVES_DEL_TITULO, columnasDe, tituloDeFila, type FilaReporte, type IdReporte } from '@/lib/reportes'

/**
 * Filas de un reporte: tabla desde 1280 px (y siempre en la impresión) y una
 * tarjeta por fila debajo de ese ancho, con el mismo contenido y sin
 * desplazamiento horizontal.
 *
 * Las dos variantes salen de las mismas columnas que la exportación CSV
 * (`columnasDe`), de modo que la pantalla, la impresión y el archivo nunca
 * difieren. Es un componente de servidor: no envía nada de esto como
 * JavaScript al navegador.
 *
 * `impresion`: la vista imprimible muestra la tabla en la pantalla también y
 * usa una tipografía más chica para que entre en la página.
 */
export function TablaReporte({
  reporte,
  titulo,
  filas,
  impresion = false,
}: {
  reporte: IdReporte
  titulo: string
  filas: FilaReporte[]
  impresion?: boolean
}) {
  const columnas = columnasDe(reporte)

  return (
    <>
      <div
        className={cn(
          'hidden xl:block bg-white rounded-2xl border border-neutral-200 overflow-hidden',
          'print:block print:rounded-none print:border-0'
        )}
      >
        <table className={cn('w-full text-sm', impresion && 'print:text-[9pt]')}>
          <caption className="sr-only">{titulo}</caption>
          <thead className="bg-neutral-50 text-neutral-600 print:bg-transparent">
            <tr>
              {columnas.map((columna) => (
                <th
                  key={columna.clave}
                  scope="col"
                  className="text-left font-semibold px-3 py-3 align-bottom print:px-1.5 print:py-1 print:border-b print:border-neutral-400"
                >
                  {columna.encabezado}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 print:divide-neutral-300">
            {filas.map((fila) => (
              <tr key={fila.id} className="align-top print:break-inside-avoid">
                {columnas.map((columna) => (
                  <td key={columna.clave} className="px-3 py-2.5 text-neutral-800 break-words print:px-1.5 print:py-1">
                    {columna.valor(fila)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="xl:hidden print:hidden space-y-3" aria-label={titulo}>
        {filas.map((fila) => (
          <li key={fila.id} className="bg-white rounded-2xl border border-neutral-200 p-4">
            <p className="font-bold text-neutral-900 break-words">{tituloDeFila(reporte, fila)}</p>
            <dl className="mt-2 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {columnas
                .filter((columna) => !CLAVES_DEL_TITULO.includes(columna.clave))
                .map((columna) => (
                  <div key={columna.clave} className="contents">
                    <dt className="text-neutral-500">{columna.encabezado}</dt>
                    <dd className="text-neutral-900 break-words">{columna.valor(fila)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
