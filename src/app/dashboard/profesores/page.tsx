import type { Metadata } from 'next'
import { Lock } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { requerirDirector } from '@/services/autorizacion'
import { listarProfesores } from '@/services/profesores.service'
import { ErrorDeCarga } from './_components/ErrorDeCarga'
import { GestionProfesores } from './_components/GestionProfesores'

export const metadata: Metadata = {
  title: 'Profesores | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo la dirección puede administrar las fichas de profesores.'

/**
 * Fichas de profesores (EPT-58). La sesión y el rol DIRECTOR se verifican en
 * el servidor antes de leer nada; la base vuelve a verificarlos en cada RPC.
 * Ocultar el enlace del menú no es la protección: esta página tampoco se
 * renderiza para otro rol.
 */
export default async function ProfesoresPage() {
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

  const profesores = await listarProfesores()

  if (!profesores.ok) return <ErrorDeCarga mensaje={profesores.mensaje} />


  return <GestionProfesores profesores={profesores.datos} />
}
