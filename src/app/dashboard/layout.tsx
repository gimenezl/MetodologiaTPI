import { redirect } from 'next/navigation'
import { consultarEstadoAcceso } from '@/services/autorizacion'
import { createServerSupabaseClient } from '@/services/supabase.server'
import { PanelDashboard } from './_components/PanelDashboard'

/**
 * Layout del panel (EPT-59): Server Component que resuelve la sesión y su
 * estado de acceso antes de entregar el armazón del cliente.
 *
 * Un perfil BLOQUEADO va a `/acceso-bloqueado` en la carga de cualquier ruta
 * del panel, incluidos los enlaces directos. No es una frontera de datos: como
 * explica la guía de autenticación de Next.js, un layout no se vuelve a
 * ejecutar en la navegación del cliente ni impide que la página se renderice.
 * Los datos los niegan las guardas de cada página y ruta
 * (`src/services/autorizacion.ts`) y, sobre todo, PostgreSQL. La navegación
 * del cliente la cubre `AuthContext`.
 *
 * Sin sesión no se decide nada acá: `src/proxy.ts` ya lleva al inicio de
 * sesión. Si el estado no se puede resolver, el armazón se entrega igual y las
 * guardas de datos, que fallan cerrado, deciden.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()

  if (data?.user) {
    const estado = await consultarEstadoAcceso(supabase)
    if (estado === 'BLOQUEADO') redirect('/acceso-bloqueado')
  }

  return <PanelDashboard>{children}</PanelDashboard>
}
