import type { Metadata } from 'next'
import { requerirDirector } from '@/services/autorizacion'
import { obtenerPagosPendientes } from '@/services/comprobantes-lectura.service'
import { AccesoRestringido } from '../_components/AccesoRestringido'
import { PagosPendientes } from './_components/PagosPendientes'
import { PanelErrorComprobantes } from './_components/PanelErrorComprobantes'

export const metadata: Metadata = {
  title: 'Comprobantes | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Pagos pendientes de verificación con sus comprobantes (EPT-109). Solo Dirección.
 *
 * Es una LECTURA: la aprobación y el rechazo pertenecen a otra historia
 * (EPT-111). La autorización de la página es independiente del menú:
 * `requerirDirector` consulta el rol vigente en la base y RLS vuelve a exigirlo
 * en cada lectura.
 */
export default async function ComprobantesPage() {
  const autorizacion = await requerirDirector(
    'Solo Dirección puede ver los comprobantes de los pagos.'
  )
  if (!autorizacion.autorizado) {
    return <AccesoRestringido mensaje={autorizacion.mensaje} />
  }

  const lectura = await obtenerPagosPendientes()
  // Una lectura fallida no se disfraza de «sin pagos pendientes».
  if (!lectura.ok) return <PanelErrorComprobantes mensaje={lectura.mensaje} />

  return <PagosPendientes pagos={lectura.datos.pagos} truncado={lectura.datos.truncado} />
}
