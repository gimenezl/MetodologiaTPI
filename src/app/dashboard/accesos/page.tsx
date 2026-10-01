import type { Metadata } from 'next'
import { ClipboardText } from '@phosphor-icons/react/dist/ssr'
import { EscanerAcceso } from '@/components/accesos/EscanerAcceso'
import {
  AccesoRestringido,
  EncabezadoCredencial,
  ErrorDeLectura,
} from '@/components/credenciales/EstadosPagina'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { CATALOGO_ACCESOS } from '@/lib/accesos-qr/errores'
import { requerirSesionConRol } from '@/services/autorizacion'
import { listarServiciosEscaneables } from '@/services/accesos-qr.service'

export const metadata: Metadata = { title: 'Registrar accesos | Panel' }
export const dynamic = 'force-dynamic'

const ID_TITULO = 'titulo-registrar-accesos'

/**
 * Registro de accesos con QR al comedor y al transporte (EPT-65, RF21).
 *
 * Solo DIRECTOR y PERSONAL habilitados, cada uno con su propia cuenta: la ruta
 * se resuelve en el servidor antes de hidratar. Esta guarda no es la frontera de
 * seguridad: la API y PostgreSQL vuelven a exigir el rol en cada escaneo.
 */
export default async function AccesosPage() {
  const sesion = await requerirSesionConRol()
  if (!sesion.autorizado) return <AccesoRestringido mensaje={sesion.mensaje} />
  if (sesion.rol !== 'DIRECTOR' && sesion.rol !== 'PERSONAL') {
    return <AccesoRestringido mensaje="Solo la dirección y el personal pueden registrar accesos." />
  }

  const servicios = await listarServiciosEscaneables()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <EncabezadoCredencial
        etiqueta={sesion.rol === 'DIRECTOR' ? 'Dirección' : 'Personal'}
        titulo="Registrar accesos"
        descripcion="Elegí el servicio que estás controlando y leé el código QR de la credencial del alumno. Cada persona usa su propia cuenta."
        idTitulo={ID_TITULO}
      />
      {sesion.rol === 'DIRECTOR' && (
        <div className="print:hidden">
          <EnlaceBoton href="/dashboard/accesos/auditoria" variant="outline" className="min-h-11">
            <ClipboardText size={18} weight="bold" aria-hidden="true" />
            Ver la auditoría de accesos
          </EnlaceBoton>
        </div>
      )}
      {servicios.ok ? (
        <EscanerAcceso servicios={servicios.datos} />
      ) : (
        <ErrorDeLectura
          titulo="No pudimos cargar los servicios"
          mensaje={CATALOGO_ACCESOS[servicios.codigo].mensaje}
          reintentarHref="/dashboard/accesos"
        />
      )}
    </div>
  )
}
