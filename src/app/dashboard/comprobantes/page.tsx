import { HistorialPagos, type FiltrosHistorial } from '@/components/recibos/HistorialPagos'
import type { Metadata } from 'next'
import { requerirDirector } from '@/services/autorizacion'
import { obtenerPagosPendientes } from '@/services/comprobantes-lectura.service'
import { AccesoRestringido } from '../_components/AccesoRestringido'
import { PagosPendientes } from './_components/PagosPendientes'
import { PanelErrorComprobantes } from './_components/PanelErrorComprobantes'
import { pagoIdSchema } from '@/lib/comprobantes-verificacion'

export const metadata: Metadata = {
  title: 'Comprobantes | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Pagos, comprobantes y decisión de Dirección (EPT-109/111).
 * La autorización de la página es independiente del menú:
 * `requerirDirector` consulta el rol vigente en la base y RLS vuelve a exigirlo
 * en cada lectura.
 */
export default async function ComprobantesPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string; pago?: string } & FiltrosHistorial>
}) {
  const autorizacion = await requerirDirector(
    'Solo Dirección puede ver los comprobantes de los pagos.'
  )
  if (!autorizacion.autorizado) {
    return <AccesoRestringido mensaje={autorizacion.mensaje} />
  }

  const parametros = await searchParams
  const pagina = /^\d{1,6}$/u.test(parametros.pagina ?? '') ? Math.max(1, Number(parametros.pagina)) : 1
  if (parametros.pago && !pagoIdSchema.safeParse(parametros.pago).success) {
    return <PanelErrorComprobantes mensaje="El identificador de pago no es válido. Vuelve al listado y revisa el dato." />
  }
  const lectura = await obtenerPagosPendientes(pagina, parametros.pago)
  // Una lectura fallida no se disfraza de «sin pagos pendientes».
  if (!lectura.ok) return <PanelErrorComprobantes mensaje={lectura.mensaje} />

  return <><PagosPendientes pagos={lectura.datos.pagos} truncado={lectura.datos.truncado}
    pagina={pagina} busqueda={Boolean(parametros.pago)} /><HistorialPagos alumnos={[]} director filtros={parametros} ruta="/dashboard/comprobantes" /></>
}
