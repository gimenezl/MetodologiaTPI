import type { Metadata } from 'next'
import { requerirDirector } from '@/services/autorizacion'
import { leerFiltros, obtenerEnviosCorreo } from '@/services/envios-correo-lectura.service'
import { AccesoRestringido } from '../_components/AccesoRestringido'
import { PanelErrorEnviosCorreo } from './_components/PanelErrorEnviosCorreo'
import { TablaEnviosCorreo } from './_components/TablaEnviosCorreo'

export const metadata: Metadata = {
  title: 'Correos programados | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Canal de revisión de correos programados para Dirección (EPT-118). Solo lectura.
 * La autorización de la página es independiente del menú: `requerirDirector` consulta
 * el rol vigente en la base y RLS vuelve a exigirlo en cada lectura.
 */
export default async function EnviosCorreoPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string; tipo?: string; estado?: string }>
}) {
  const autorizacion = await requerirDirector('Solo Dirección puede consultar los correos programados.')
  if (!autorizacion.autorizado) {
    return <AccesoRestringido mensaje={autorizacion.mensaje} />
  }

  const parametros = await searchParams
  const pagina = /^\d{1,6}$/u.test(parametros.pagina ?? '') ? Math.max(1, Number(parametros.pagina)) : 1
  const filtros = leerFiltros(parametros)
  const lectura = await obtenerEnviosCorreo(pagina, filtros)
  // Una lectura fallida no se disfraza de «sin correos programados».
  if (!lectura.ok) return <PanelErrorEnviosCorreo mensaje={lectura.mensaje} />

  return <TablaEnviosCorreo envios={lectura.datos.envios} hayMas={lectura.datos.hayMas} pagina={pagina} filtros={filtros} />
}
