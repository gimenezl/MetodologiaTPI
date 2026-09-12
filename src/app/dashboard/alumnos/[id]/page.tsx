import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import { requerirDirector } from '@/services/autorizacion'
import { listarHistorialAlumno, obtenerAlumno } from '@/services/alumnos.service'
import { SituacionAcademica } from '../_components/SituacionAcademica'

export const metadata: Metadata = {
  title: 'Legajo académico | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo el director puede administrar los legajos académicos.'

/**
 * Detalle de solo lectura. Las operaciones académicas viven en el listado, que
 * es donde el director trabaja sobre varios estudiantes a la vez; acá se
 * consulta la trayectoria completa de uno.
 */
export default async function DetalleAlumnoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)

  if (!autorizacion.autorizado) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Lock size={32} weight="fill" className="text-red-500" />
        </div>
        <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">
          Acceso restringido
        </h1>
        <p className="text-neutral-500 text-sm mt-2">{autorizacion.mensaje}</p>
        <Link href="/dashboard" className="inline-block mt-6">
          <Button>Volver al panel</Button>
        </Link>
      </div>
    )
  }

  const { id } = await params
  const alumno = await obtenerAlumno(id)

  if (!alumno.ok) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <VolverAlListado />
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
        >
          <WarningCircle
            size={22}
            weight="fill"
            className="text-red-500 shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-semibold text-red-800">
              No pudimos mostrar este legajo académico
            </p>
            <p className="text-sm text-red-700 mt-1">{alumno.mensaje}</p>
          </div>
        </div>
      </div>
    )
  }

  const historial = await listarHistorialAlumno(id)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <VolverAlListado />
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Legajo académico
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          {alumno.datos.apellido}, {alumno.datos.nombre}
        </h1>
      </div>

      <SituacionAcademica
        alumno={alumno.datos}
        historial={historial.ok ? historial.datos : []}
      />

      {!historial.ok && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
        >
          <WarningCircle
            size={20}
            weight="fill"
            className="text-red-500 shrink-0 mt-0.5"
          />
          <p className="text-sm text-red-800">
            No pudimos cargar el historial de cursos. {historial.mensaje}
          </p>
        </div>
      )}
    </div>
  )
}

function VolverAlListado() {
  return (
    <Link
      href="/dashboard/alumnos"
      className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-800"
    >
      <ArrowLeft size={16} weight="bold" />
      Volver al listado de alumnos
    </Link>
  )
}
