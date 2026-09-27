import type { Metadata } from 'next'
import { requerirDirectorConPerfil } from '@/services/autorizacion'
import { AccesoRestringido } from '../../_components/AccesoRestringido'
import { DetalleUsuario } from './_components/DetalleUsuario'

export const metadata: Metadata = {
  title: 'Detalle de usuario | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Detalle de una persona para la dirección (EPT-59), protegido en el servidor.
 *
 * La guarda también resuelve el perfil propio de quien administra: la pantalla
 * oculta los controles de rol y acceso sobre la propia cuenta. La base los
 * rechaza igual (autobloqueo y cambio de rol propio), así que ocultarlos es
 * solo claridad, no seguridad.
 */
export default async function DetalleUsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const autorizacion = await requerirDirectorConPerfil('Solo la dirección puede administrar usuarios.')
  if (!autorizacion.autorizado) return <AccesoRestringido mensaje={autorizacion.mensaje} />

  const { id } = await params
  return <DetalleUsuario perfilId={id} esPropio={id.toLowerCase() === autorizacion.perfilId.toLowerCase()} />
}
