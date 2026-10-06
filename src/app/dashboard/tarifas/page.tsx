import type { Metadata } from 'next'
import { requerirDirector } from '@/services/autorizacion'
import { obtenerPanelTarifas } from '@/services/tarifas.service'
import { AccesoRestringido } from '../_components/AccesoRestringido'
import { GestionTarifas } from './_components/GestionTarifas'
import { PanelErrorTarifas } from './_components/PanelErrorTarifas'

export const metadata: Metadata = {
  title: 'Tarifas | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Administración de tarifas mensuales (EPT-103). Solo Dirección.
 *
 * La autorización de esta página es independiente del menú: aunque alguien
 * llegue por la URL, `requerirDirector` consulta el rol vigente en la base. Eso
 * es presentación; la barrera real son RLS y las RPC, que vuelven a exigir
 * DIRECTOR habilitado en cada lectura y escritura.
 */
export default async function TarifasPage() {
  const autorizacion = await requerirDirector('Solo Dirección puede administrar las tarifas.')
  if (!autorizacion.autorizado) {
    return <AccesoRestringido mensaje={autorizacion.mensaje} />
  }

  const panel = await obtenerPanelTarifas()
  // Una lectura fallida no se disfraza de «sin tarifas»: se informa y se ofrece reintentar.
  if (!panel.ok) return <PanelErrorTarifas mensaje={panel.mensaje} />

  return <GestionTarifas grupos={panel.datos.grupos} hoy={panel.datos.hoy} />
}
