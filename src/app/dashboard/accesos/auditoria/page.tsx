import type { Metadata } from 'next'
import { AuditoriaAccesos } from '@/components/accesos/AuditoriaAccesos'
import {
  AccesoRestringido,
  EncabezadoCredencial,
  ErrorDeLectura,
} from '@/components/credenciales/EstadosPagina'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { CATALOGO_ACCESOS } from '@/lib/accesos-qr/errores'
import { filtrosAuditoriaSchema } from '@/lib/accesos-qr/esquemas'
import { hoyBA } from '@/lib/accesos-qr/tipos'
import { requerirDirector } from '@/services/autorizacion'
import {
  listarAccesos,
  listarServiciosEscaneables,
  TAMANO_PAGINA_AUDITORIA,
} from '@/services/accesos-qr.service'

export const metadata: Metadata = { title: 'Auditoría de accesos | Panel' }
export const dynamic = 'force-dynamic'

const ID_TITULO = 'titulo-auditoria-accesos'

type ParametrosDeBusqueda = Record<string, string | string[] | undefined>

function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor
}

/**
 * Auditoría de accesos: SOLO Dirección. PERSONAL puede operar el escáner pero no
 * consulta eventos, listados, historial ni intentos de nadie. La autorización se
 * resuelve en el servidor antes de hidratar y la función de lectura de
 * PostgreSQL la vuelve a exigir.
 */
export default async function AuditoriaAccesosPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeBusqueda>
}) {
  const autorizacion = await requerirDirector('Solo la dirección puede consultar los accesos registrados.')
  if (!autorizacion.autorizado) return <AccesoRestringido mensaje={autorizacion.mensaje} />

  const parametros = await searchParams
  // Un parámetro inválido se ignora: nunca rompe la pantalla ni se refleja en ella.
  const analisis = filtrosAuditoriaSchema.safeParse({
    dia: primero(parametros.dia) || undefined,
    resultado: primero(parametros.resultado) || undefined,
    servicio: primero(parametros.servicio) || undefined,
    pagina: primero(parametros.pagina) || undefined,
  })
  const filtros = analisis.success ? analisis.data : {}
  const dia = filtros.dia ?? hoyBA()

  const [lista, servicios] = await Promise.all([
    listarAccesos({ ...filtros, dia }),
    listarServiciosEscaneables(),
  ])

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EncabezadoCredencial
        etiqueta="Dirección"
        titulo="Auditoría de accesos"
        descripcion="Accesos registrados y denegados del comedor y del transporte, con el motivo interno de cada denegación. Podés anular un acceso registrado por error: el registro original se conserva."
        idTitulo={ID_TITULO}
      />
      <div className="print:hidden">
        <EnlaceBoton href="/dashboard/accesos" variant="outline" className="min-h-11">
          Volver a registrar accesos
        </EnlaceBoton>
      </div>
      {lista.ok ? (
        <AuditoriaAccesos
          filas={lista.datos.filas}
          total={lista.datos.total}
          pagina={lista.datos.pagina}
          tamano={TAMANO_PAGINA_AUDITORIA}
          filtros={{
            dia,
            resultado: filtros.resultado ?? '',
            servicio: filtros.servicio ?? '',
          }}
          servicios={servicios.ok ? servicios.datos : []}
        />
      ) : (
        <ErrorDeLectura
          titulo="No pudimos cargar la auditoría"
          mensaje={CATALOGO_ACCESOS[lista.codigo].mensaje}
          reintentarHref="/dashboard/accesos/auditoria"
        />
      )}
    </div>
  )
}
