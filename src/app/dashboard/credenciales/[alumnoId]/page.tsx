import type { Metadata } from 'next'
import { AccionesCredencial } from '@/components/credenciales/AccionesCredencial'
import {
  AccesoRestringido,
  EncabezadoCredencial,
  ErrorDeLectura,
} from '@/components/credenciales/EstadosPagina'
import { HistorialCredenciales } from '@/components/credenciales/HistorialCredenciales'
import { TarjetaCredencial } from '@/components/credenciales/TarjetaCredencial'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { CATALOGO_CREDENCIALES } from '@/lib/credenciales-qr/errores'
import { identificadorSchema } from '@/lib/credenciales-qr/esquemas'
import { requerirDirector } from '@/services/autorizacion'
import { obtenerHistorial, obtenerTarjeta } from '@/services/credenciales-qr.service'

export const metadata: Metadata = { title: 'Credencial del alumno | Panel' }
export const dynamic = 'force-dynamic'

const ID_TITULO = 'titulo-credencial-alumno'

/** Credencial de un alumno para Dirección: tarjeta, acciones e historial interno. */
export default async function CredencialAlumnoPage({
  params,
}: {
  params: Promise<{ alumnoId: string }>
}) {
  const autorizacion = await requerirDirector('Solo la dirección puede administrar las credenciales.')
  if (!autorizacion.autorizado) return <AccesoRestringido mensaje={autorizacion.mensaje} />

  const identificador = identificadorSchema.safeParse((await params).alumnoId)
  const volver = (
    <EnlaceBoton href="/dashboard/credenciales" variant="ghost" size="sm" className="print:hidden">
      ← Volver a las credenciales
    </EnlaceBoton>
  )

  if (!identificador.success) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {volver}
        <ErrorDeLectura
          titulo="No encontramos al alumno"
          mensaje={CATALOGO_CREDENCIALES.ALUMNO_NO_ENCONTRADO.mensaje}
          reintentarHref="/dashboard/credenciales"
        />
      </div>
    )
  }

  const [tarjeta, historial] = await Promise.all([
    obtenerTarjeta(identificador.data, { consultarAcceso: true }),
    obtenerHistorial(identificador.data),
  ])

  if (!tarjeta.ok) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {volver}
        <ErrorDeLectura
          titulo={
            tarjeta.codigo === 'ALUMNO_NO_ENCONTRADO'
              ? 'No encontramos al alumno'
              : 'No pudimos cargar la credencial'
          }
          mensaje={CATALOGO_CREDENCIALES[tarjeta.codigo].mensaje}
          reintentarHref={`/dashboard/credenciales/${identificador.data}`}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {volver}
      <EncabezadoCredencial
        etiqueta="Dirección"
        titulo={`Credencial de ${tarjeta.datos.alumno.nombre} ${tarjeta.datos.alumno.apellido}`}
        descripcion="Emitir, reponer y revocar son acciones registradas con tu nombre. Una credencial revocada nunca vuelve a valer."
        idTitulo={ID_TITULO}
      />
      <TarjetaCredencial tarjeta={tarjeta.datos} vista="DIRECCION" idTitulo={ID_TITULO} />
      <div className="print:hidden">
        <AccionesCredencial tarjeta={tarjeta.datos} />
      </div>
      <section aria-labelledby="titulo-historial-credenciales" className="space-y-3 print:hidden">
        <h2 id="titulo-historial-credenciales" className="text-lg font-bold text-neutral-900">
          Historial
        </h2>
        {historial.ok ? (
          <HistorialCredenciales historial={historial.datos} />
        ) : (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            No pudimos cargar el historial. {CATALOGO_CREDENCIALES[historial.codigo].mensaje}
          </p>
        )}
      </section>
    </div>
  )
}
