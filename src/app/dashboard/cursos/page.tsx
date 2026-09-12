import type { Metadata } from 'next'
import Link from 'next/link'
import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { requerirDirector } from '@/services/autorizacion'
import { listarCursos, listarNivelesActivos } from '@/services/cursos.service'
import { Button } from '@/components/ui/Button'
import { GestionCursos } from './_components/GestionCursos'

export const metadata: Metadata = {
  title: 'Cursos | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Administración de cursos (EPT-16).
 *
 * Componente de servidor: autoriza y lee los datos antes de enviar nada al
 * navegador. Es la primera de las tres capas de control (interfaz), y no
 * reemplaza ni a la autorización de `/api/cursos` ni a RLS.
 */
export default async function CursosPage() {
  const autorizacion = await requerirDirector()

  if (!autorizacion.autorizado) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Lock size={32} weight="fill" className="text-red-500" />
        </div>
        <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">Acceso restringido</h1>
        <p className="text-neutral-500 text-sm mt-2">{autorizacion.mensaje}</p>
        <Link href="/dashboard" className="inline-block mt-6">
          <Button>Volver al panel</Button>
        </Link>
      </div>
    )
  }

  const [resultadoCursos, resultadoNiveles] = await Promise.all([
    listarCursos(),
    listarNivelesActivos(),
  ])

  // Un fallo de lectura se muestra como error explícito. Nunca se degrada a una
  // lista vacía, porque "no hay cursos" y "no pudimos leer los cursos" son
  // estados distintos y el director necesita distinguirlos.
  if (!resultadoCursos.ok) return <PanelErrorLectura mensaje={resultadoCursos.mensaje} />
  if (!resultadoNiveles.ok) return <PanelErrorLectura mensaje={resultadoNiveles.mensaje} />

  return <GestionCursos cursos={resultadoCursos.datos} niveles={resultadoNiveles.datos} />
}

function PanelErrorLectura({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Cursos</h1>
        <p className="text-neutral-500 text-sm mt-0.5">
          Denominación, división y nivel educativo
        </p>
      </div>
      <div
        role="alert"
        className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
      >
        <WarningCircle size={22} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">No pudimos cargar los cursos</p>
          <p className="text-sm text-red-700 mt-1">{mensaje}</p>
        </div>
      </div>
    </div>
  )
}
