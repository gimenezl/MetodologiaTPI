import type { Metadata } from 'next'
import Link from 'next/link'
import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import { requerirDirector } from '@/services/autorizacion'
import {
  listarAsignaciones,
  listarCursosAsignables,
  listarMaterias,
  listarProfesoresAsignables,
} from '@/services/materias.service'
import { GestionMaterias } from './_components/GestionMaterias'

export const metadata: Metadata = {
  title: 'Materias | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo el director puede administrar las materias.'

/** Administración protegida y resuelta en el servidor antes de hidratar la UI. */
export default async function MateriasPage() {
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

  const [materias, asignaciones, cursos, profesores] = await Promise.all([
    listarMaterias(),
    listarAsignaciones(),
    listarCursosAsignables(),
    listarProfesoresAsignables(),
  ])

  // El catálogo y sus relaciones son la sustancia de la pantalla: sin ellos no
  // se muestra una administración vacía que parezca real.
  if (!materias.ok) return <PanelErrorLectura mensaje={materias.mensaje} />
  if (!asignaciones.ok) return <PanelErrorLectura mensaje={asignaciones.mensaje} />

  // Las opciones de asignación sí pueden degradarse: la pantalla sigue siendo
  // útil para consultar, renombrar e inactivar, y el diálogo lo informa.
  return (
    <GestionMaterias
      materias={materias.datos}
      asignaciones={asignaciones.datos}
      cursos={cursos.ok ? cursos.datos : []}
      profesores={profesores.ok ? profesores.datos : []}
      mensajeInicial={
        cursos.ok && profesores.ok
          ? undefined
          : {
              tipo: 'error',
              texto:
                'No pudimos cargar las opciones para asignar materias a cursos. Podés seguir administrando el catálogo y reintentar más tarde.',
            }
      }
    />
  )
}

function PanelErrorLectura({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          Materias
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Administración del catálogo y de su relación con los cursos
        </p>
      </div>
      <div
        role="alert"
        className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
      >
        <WarningCircle size={22} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">
            No pudimos cargar las materias
          </p>
          <p className="text-sm text-red-700 mt-1">{mensaje}</p>
          <Link href="/dashboard/materias" className="inline-block mt-4">
            <Button size="sm" variant="outline">
              Reintentar
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
