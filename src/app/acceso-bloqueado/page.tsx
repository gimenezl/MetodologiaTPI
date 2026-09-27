import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LockKey } from '@phosphor-icons/react/dist/ssr'
import { consultarEstadoAcceso } from '@/services/autorizacion'
import { createServerSupabaseClient } from '@/services/supabase.server'
import { CerrarSesionBloqueada } from './_components/CerrarSesionBloqueada'

export const metadata: Metadata = {
  title: 'Acceso bloqueado',
}

export const dynamic = 'force-dynamic'

/**
 * Pantalla de una sesión cuyo perfil está BLOQUEADO (EPT-59).
 *
 * Vive fuera del panel a propósito: no monta el menú ni pide datos. Muestra
 * solo el aviso y la salida; ningún dato personal, ni siquiera el nombre. Sin
 * sesión lleva al inicio de sesión y, si el perfil no está bloqueado, al
 * panel: nadie queda atrapado acá por un estado viejo.
 */
export default async function AccesoBloqueadoPage() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (!data?.user) redirect('/login')

  const estado = await consultarEstadoAcceso(supabase)
  if (estado !== 'BLOQUEADO') redirect('/dashboard')

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-neutral-50 px-4 py-12">
      <section
        aria-labelledby="titulo-acceso-bloqueado"
        className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 text-center shadow-sm"
      >
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <LockKey size={32} weight="fill" className="text-red-600" aria-hidden="true" />
        </div>
        <h1
          id="titulo-acceso-bloqueado"
          className="text-xl font-extrabold text-neutral-900 tracking-tight"
        >
          Acceso bloqueado
        </h1>
        <p className="text-neutral-600 text-sm mt-3 leading-relaxed">
          Dirección bloqueó el acceso de tu cuenta. Si creés que es un error, comunicate con la
          escuela.
        </p>
        <CerrarSesionBloqueada />
      </section>
    </main>
  )
}
