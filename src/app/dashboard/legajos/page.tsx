import type { Metadata } from 'next'
import { requerirDirector } from '@/services/autorizacion'
import { AccesoRestringido } from '../_components/AccesoRestringido'
import { GestionLegajos } from './_components/GestionLegajos'

export const metadata: Metadata = {
  title: 'Legajos | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Legajos, protegido en el servidor (EPT-59): la guarda se resuelve antes de
 * entregar el componente del cliente. Un perfil bloqueado o sin rol DIRECTOR
 * recibe «Acceso restringido» sin que la pantalla llegue a montarse.
 */
export default async function LegajosPage() {
  const autorizacion = await requerirDirector('Solo la dirección puede gestionar legajos.')
  if (!autorizacion.autorizado) return <AccesoRestringido mensaje={autorizacion.mensaje} />
  return <GestionLegajos />
}
