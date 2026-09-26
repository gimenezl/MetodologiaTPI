import type { Metadata } from 'next'
import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { requerirRol } from '@/services/autorizacion'
import { obtenerMisAsignaciones } from '@/services/profesores.service'
import { VistaMisAsignaciones } from './_components/VistaMisAsignaciones'

export const metadata: Metadata = {
  title: 'Mis asignaciones | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Esta sección es para docentes: muestra sus propias asignaciones.'

/**
 * Asignaciones del docente de la sesión (EPT-58). No recibe identificador: la
 * base resuelve a quién pertenece la sesión, así que no hay forma de pedir la
 * ficha de otra persona desde esta página. Un docente INACTIVO también entra.
 */
export default async function MisAsignacionesPage() {
  const autorizacion = await requerirRol('DOCENTE', MENSAJE_NO_AUTORIZADO)

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

  const resultado = await obtenerMisAsignaciones()

  if (!resultado.ok) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Mis asignaciones</h1>
          <p className="text-neutral-500 text-sm mt-1">Lo que tenés a cargo como docente</p>
        </div>
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
        >
          <WarningCircle size={22} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">No pudimos cargar tus asignaciones</p>
            <p className="text-sm text-red-700 mt-1">{resultado.mensaje}</p>
            <EnlaceBoton href="/dashboard/mis-asignaciones" size="sm" variant="outline" className="mt-4">
              Reintentar
            </EnlaceBoton>
          </div>
        </div>
      </div>
    )
  }

  return <VistaMisAsignaciones datos={resultado.datos} />
}
