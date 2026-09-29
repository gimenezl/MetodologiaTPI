import type { Metadata } from 'next'
import { PanelCredenciales } from '@/components/credenciales/PanelCredenciales'
import {
  AccesoRestringido,
  EncabezadoCredencial,
  ErrorDeLectura,
} from '@/components/credenciales/EstadosPagina'
import { CATALOGO_CREDENCIALES } from '@/lib/credenciales-qr/errores'
import { requerirDirector } from '@/services/autorizacion'
import { listarPanelDireccion } from '@/services/credenciales-qr.service'

export const metadata: Metadata = { title: 'Credenciales | Panel' }
export const dynamic = 'force-dynamic'

const ID_TITULO = 'titulo-credenciales'

/** Administración de credenciales: solo Dirección, resuelta en el servidor antes de hidratar. */
export default async function CredencialesPage() {
  const autorizacion = await requerirDirector('Solo la dirección puede administrar las credenciales.')
  if (!autorizacion.autorizado) return <AccesoRestringido mensaje={autorizacion.mensaje} />

  const resultado = await listarPanelDireccion()

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EncabezadoCredencial
        etiqueta="Dirección"
        titulo="Credenciales"
        descripcion="Emití, reponé o revocá la credencial digital con código QR de cada alumno. Cada alumno tiene, como máximo, una credencial vigente."
        idTitulo={ID_TITULO}
      />
      {resultado.ok ? (
        <PanelCredenciales filas={resultado.datos} />
      ) : (
        <ErrorDeLectura
          titulo="No pudimos cargar las credenciales"
          mensaje={CATALOGO_CREDENCIALES[resultado.codigo].mensaje}
          reintentarHref="/dashboard/credenciales"
        />
      )}
    </div>
  )
}
