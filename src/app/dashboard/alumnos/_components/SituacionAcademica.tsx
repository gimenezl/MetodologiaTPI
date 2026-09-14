import { WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Badge } from '@/components/ui/Badge'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import type { AlumnoAcademico, MatriculaHistorica } from '@/services/alumnos.service'

/**
 * Presentación de solo lectura de la situación académica y su historial.
 *
 * Es un Server Component compartido por el detalle administrativo y por la vista
 * propia del estudiante, para que las dos muestren exactamente la misma verdad.
 * El nivel que se muestra proviene siempre del curso de la matrícula, nunca de
 * una copia guardada en el alumno.
 */

const MOTIVOS: Record<string, string> = {
  CAMBIO_DE_CURSO: 'Cambio de curso',
  INACTIVACION: 'Inactivación del estudiante',
}

function formatearFecha(valor: string) {
  return new Date(valor).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function SituacionAcademica({
  alumno,
  historial,
  errorHistorial,
  rutaReintento,
}: {
  alumno: AlumnoAcademico
  historial: MatriculaHistorica[]
  /**
   * Mensaje de dominio cuando el historial no se pudo leer.
   *
   * «No hay tramos registrados» y «no pudimos leer los tramos» son estados
   * distintos: presentarlos igual haría creer que un legajo con trayectoria no
   * la tiene. Cuando este mensaje existe, se muestra en lugar del estado vacío.
   */
  errorHistorial?: string
  /** Ruta a la que vuelve el botón de reintento; si falta, no se ofrece. */
  rutaReintento?: string
}) {
  const cursoVigente = alumno.curso_denominacion
    ? `${alumno.curso_denominacion} ${alumno.curso_division}`
    : null

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="titulo-situacion-actual"
        className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="titulo-situacion-actual" className="font-bold text-neutral-900">
            Situación actual
          </h2>
          <Badge variant={alumno.estado === 'ACTIVO' ? 'success' : 'default'} dot>
            {alumno.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
          </Badge>
        </div>

        <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {[
            ['DNI', alumno.dni],
            ['Número de legajo', alumno.legajo_nro ?? 'Sin asignar'],
            ['Curso vigente', cursoVigente ?? 'Sin curso asignado'],
            ['Nivel', alumno.nivel_nombre ?? 'Sin nivel'],
            [
              'Matriculado desde',
              alumno.matricula_desde ? formatearFecha(alumno.matricula_desde) : '—',
            ],
            ['Cuenta de acceso', alumno.tiene_cuenta ? 'Vinculada' : 'Sin vincular'],
          ].map(([etiqueta, valor]) => (
            <div key={etiqueta} className="space-y-1">
              <dt className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                {etiqueta}
              </dt>
              <dd className="text-neutral-800 font-medium break-words">{valor}</dd>
            </div>
          ))}
        </dl>

        {alumno.estado === 'ACTIVO' && alumno.curso_activo === false && (
          <p role="status" className="text-xs text-amber-700">
            El curso vigente figura como inactivo en el catálogo. La matrícula histórica se
            conserva, pero ese curso ya no se ofrece para asignaciones nuevas.
          </p>
        )}
      </section>

      <section
        aria-labelledby="titulo-historial"
        className="bg-white rounded-2xl border border-neutral-200 overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-neutral-100">
          <h2 id="titulo-historial" className="font-bold text-neutral-900">
            Historial de cursos
          </h2>
          <p className="text-sm text-neutral-500 mt-1">
            Cada tramo se conserva completo. Un cambio de curso cierra el anterior y abre
            uno nuevo; nada se sobrescribe.
          </p>
        </div>

        {errorHistorial ? (
          <div
            role="alert"
            className="m-6 bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <WarningCircle
              size={20}
              weight="fill"
              className="text-red-500 shrink-0 mt-0.5"
            />
            <div>
              <p className="text-sm font-semibold text-red-800">
                No pudimos cargar el historial de cursos
              </p>
              <p className="text-sm text-red-700 mt-1">{errorHistorial}</p>
              <p className="text-sm text-red-700 mt-1">
                Esto no significa que el legajo no tenga trayectoria: no se pudo leer.
              </p>
              {rutaReintento && (
                <EnlaceBoton href={rutaReintento} size="sm" variant="outline" className="mt-4">
                  Reintentar
                </EnlaceBoton>
              )}
            </div>
          </div>
        ) : historial.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-400">
            Todavía no hay matrículas registradas para este legajo.
          </p>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm" aria-label="Tabla del historial de cursos">
                <caption className="sr-only">
                  Tramos de matrícula con curso, nivel, fecha de inicio, fecha de cierre y
                  motivo.
                </caption>
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-100">
                    {['Curso', 'Nivel', 'Desde', 'Hasta', 'Motivo del cierre'].map((columna) => (
                      <th
                        key={columna}
                        scope="col"
                        className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider"
                      >
                        {columna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {historial.map((tramo) => (
                    <tr key={tramo.id}>
                      <td className="px-5 py-3 font-semibold text-neutral-900">
                        {tramo.curso_denominacion} {tramo.curso_division}
                        {!tramo.curso_activo && (
                          <span className="ml-2 font-normal text-xs text-neutral-400">
                            (curso inactivo)
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-700">{tramo.nivel_nombre}</td>
                      <td className="px-5 py-3 text-neutral-700">
                        {formatearFecha(tramo.fecha_inicio)}
                      </td>
                      <td className="px-5 py-3 text-neutral-700">
                        {tramo.fecha_cierre ? formatearFecha(tramo.fecha_cierre) : 'Vigente'}
                      </td>
                      <td className="px-5 py-3 text-neutral-700">
                        {tramo.motivo_cierre ? MOTIVOS[tramo.motivo_cierre] : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="sm:hidden divide-y divide-neutral-100" aria-label="Historial de cursos">
              {historial.map((tramo) => (
                <li key={tramo.id} className="px-4 py-4 space-y-1">
                  <p className="font-semibold text-neutral-900 break-words">
                    {tramo.curso_denominacion} {tramo.curso_division}
                    {!tramo.curso_activo && (
                      <span className="ml-2 font-normal text-xs text-neutral-400">
                        (curso inactivo)
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-neutral-600">{tramo.nivel_nombre}</p>
                  <p className="text-xs text-neutral-500">
                    Desde {formatearFecha(tramo.fecha_inicio)} ·{' '}
                    {tramo.fecha_cierre
                      ? `hasta ${formatearFecha(tramo.fecha_cierre)}`
                      : 'vigente'}
                  </p>
                  {tramo.motivo_cierre && (
                    <p className="text-xs text-neutral-500">
                      Motivo: {MOTIVOS[tramo.motivo_cierre]}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
