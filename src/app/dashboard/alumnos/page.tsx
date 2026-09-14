import type { Metadata } from 'next'
import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { requerirDirector } from '@/services/autorizacion'
import { listarAlumnos, listarCursosAsignables } from '@/services/alumnos.service'
import { GestionAlumnos } from './_components/GestionAlumnos'

export const metadata: Metadata = {
  title: 'Alumnos | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO =
  'Solo el director puede administrar los legajos académicos.'

/** Administración protegida y resuelta en el servidor antes de hidratar la UI. */
export default async function AlumnosPage() {
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
        <EnlaceBoton href="/dashboard" className="mt-6">
          Volver al panel
        </EnlaceBoton>
      </div>
    )
  }

  const [alumnos, cursos] = await Promise.all([
    listarAlumnos(),
    listarCursosAsignables(),
  ])

  if (!alumnos.ok) {
    return <PanelErrorLectura mensaje={alumnos.mensaje} />
  }
  if (!cursos.ok) {
    return <PanelErrorLectura mensaje={cursos.mensaje} />
  }

  return <GestionAlumnos alumnos={alumnos.datos} cursos={cursos.datos} />
}

function PanelErrorLectura({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          Alumnos
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Estado académico, curso vigente y nivel derivado
        </p>
      </div>
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
            No pudimos cargar los legajos académicos
          </p>
          <p className="text-sm text-red-700 mt-1">{mensaje}</p>
          <EnlaceBoton href="/dashboard/alumnos" size="sm" variant="outline" className="mt-4">
            Reintentar
          </EnlaceBoton>
        </div>
      </div>
    </div>
  )
}
