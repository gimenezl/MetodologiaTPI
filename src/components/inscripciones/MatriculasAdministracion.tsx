'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { MatriculaAdministracion } from '@/services/inscripciones-administracion.service'
import { AvisoAdministracion } from './AvisoAdministracion'
import { EstadoConfirmacion } from './EstadoConfirmacion'
import { fechaHora } from './formato'
import { confirmacionDe } from './tipos'
import { useAdministracionInscripciones, useDevolverFoco } from './useAdministracionInscripciones'

const MOTIVOS_CIERRE: Record<string, string> = {
  CAMBIO_DE_CURSO: 'Cambio de curso',
  INACTIVACION: 'Inactivación del alumno',
}

/**
 * Matrículas de un alumno con su estado de confirmación (EPT-62, RF16).
 *
 * Solo Dirección. La matrícula vigente se puede confirmar; las cerradas se
 * conservan en el historial y no se confirman. Confirmar es una acción
 * administrativa registrada (quién y cuándo) y no cambia si la matrícula está
 * vigente.
 *
 * NO hay botón para cancelar una matrícula, y esto es deliberado: una matrícula
 * no se cancela, se CIERRA como consecuencia de dos operaciones del legajo
 * —inactivar al alumno o cambiarle el curso— que además mantienen la regla
 * «alumno activo = exactamente una matrícula vigente». La ayuda de esta pantalla
 * lo explica y lleva al listado de Alumnos, donde esas operaciones viven.
 */
export function MatriculasAdministracion({
  alumno,
  matriculas,
  errorLectura,
}: {
  alumno: string
  matriculas: MatriculaAdministracion[]
  /** Mensaje de dominio si no se pudieron leer las matrículas. */
  errorLectura?: string
}) {
  const region = useRef<HTMLElement>(null)
  const { aviso, enCurso, ocupado, refrescando, foco, limpiarFoco, confirmar } =
    useAdministracionInscripciones('matriculas')
  useDevolverFoco(region, { refrescando, foco, limpiarFoco })

  const vigente = matriculas.find((matricula) => matricula.vigente)

  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-labelledby="titulo-matriculas-administracion"
      aria-busy={refrescando}
      className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4 focus:outline-none"
    >
      <div>
        <h2 id="titulo-matriculas-administracion" className="font-bold text-neutral-900">
          Confirmación de la matrícula
        </h2>
        <p className="text-sm text-neutral-600 mt-1 max-w-[72ch]">
          Confirmar registra quién y cuándo dio por verificada la matrícula. Es un paso
          administrativo posterior al alta: una matrícula vigente sin confirmar sigue siendo
          válida.
        </p>
      </div>

      <AvisoAdministracion aviso={aviso} />

      {errorLectura ? (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800">
            No pudimos cargar la confirmación de las matrículas
          </p>
          <p className="text-sm text-red-700 mt-1">{errorLectura}</p>
          <p className="text-sm text-red-700 mt-1">
            Esto no significa que el alumno no tenga matrículas: no se pudieron leer.
          </p>
        </div>
      ) : matriculas.length === 0 ? (
        <p className="text-sm text-neutral-600">
          Este alumno todavía no tiene matrículas registradas.
        </p>
      ) : (
        <ul className="space-y-3">
          {matriculas.map((matricula) => {
            const curso = `${matricula.curso_denominacion} ${matricula.curso_division}`
            const confirmando = enCurso?.id === matricula.id
            return (
              <li
                key={matricula.id}
                className="rounded-xl border border-neutral-200 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p
                    tabIndex={-1}
                    data-foco-inscripcion={matricula.id}
                    className="font-semibold text-neutral-900 break-words min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {curso}
                  </p>
                  {matricula.vigente ? (
                    <Badge variant="success" dot>
                      Vigente
                    </Badge>
                  ) : (
                    <Badge variant="default">Cerrada</Badge>
                  )}
                </div>

                <dl className="grid sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-neutral-600">Nivel</dt>
                    <dd className="text-neutral-900">{matricula.nivel_nombre}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-600">Desde</dt>
                    <dd className="text-neutral-900">{fechaHora(matricula.fecha_inicio)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-600">Hasta</dt>
                    <dd className="text-neutral-900">
                      {matricula.fecha_cierre ? fechaHora(matricula.fecha_cierre) : 'Vigente'}
                    </dd>
                  </div>
                  {matricula.motivo_cierre && (
                    <div className="sm:col-span-3">
                      <dt className="text-neutral-600">Motivo del cierre</dt>
                      <dd className="text-neutral-900">{MOTIVOS_CIERRE[matricula.motivo_cierre]}</dd>
                    </div>
                  )}
                </dl>

                <EstadoConfirmacion
                  confirmacion={confirmacionDe(matricula)}
                  motivoNoConfirmable={
                    !matricula.vigente && !matricula.confirmada
                      ? 'No se confirma: la matrícula está cerrada.'
                      : undefined
                  }
                />

                {matricula.vigente && !matricula.confirmada && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    disabled={ocupado}
                    aria-busy={confirmando}
                    aria-label={`Confirmar matrícula de ${alumno} en ${curso}`}
                    onClick={() =>
                      void confirmar({ id: matricula.id, alumno, descripcion: curso })
                    }
                  >
                    {confirmando ? 'Confirmando…' : 'Confirmar matrícula'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {vigente && (
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-4 space-y-2">
          <h3 className="text-sm font-bold text-neutral-900">Cómo se cierra una matrícula</h3>
          <p className="text-sm text-neutral-700 max-w-[72ch]">
            Una matrícula no se cancela desde acá. Para cerrar esta matrícula, inactivá al alumno
            (se cierra por inactivación) o cambiale el curso (se cierra por cambio de curso).
            Las dos acciones están en el listado de Alumnos.
          </p>
          <Link
            href="/dashboard/alumnos"
            className="inline-flex items-center min-h-11 sm:min-h-0 text-sm font-semibold text-brand-700 hover:text-brand-900 underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Ir al listado de alumnos
          </Link>
        </div>
      )}
    </section>
  )
}
