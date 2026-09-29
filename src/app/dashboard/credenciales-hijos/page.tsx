import type { Metadata } from 'next'
import { Student } from '@phosphor-icons/react/dist/ssr'
import { TarjetaCredencial } from '@/components/credenciales/TarjetaCredencial'
import {
  AccesoRestringido,
  EncabezadoCredencial,
  ErrorDeLectura,
} from '@/components/credenciales/EstadosPagina'
import { CATALOGO_CREDENCIALES } from '@/lib/credenciales-qr/errores'
import { requerirRol } from '@/services/autorizacion'
import { obtenerTarjetasDeHijos } from '@/services/credenciales-qr.service'

export const metadata: Metadata = { title: 'Credenciales de mis hijos | Panel' }
export const dynamic = 'force-dynamic'

const ID_TITULO = 'titulo-credenciales-hijos'

/**
 * Credenciales de los hijos actualmente vinculados (EPT-64, RF20).
 *
 * La lista de hijos la decide RLS a partir del vínculo vigente: no llega ningún
 * identificador desde el cliente. Un hijo desvinculado desaparece de la
 * siguiente lectura.
 */
export default async function CredencialesHijosPage() {
  const permiso = await requerirRol('PADRE', 'Solo un padre o tutor puede ver las credenciales de sus hijos.')
  if (!permiso.autorizado) return <AccesoRestringido mensaje={permiso.mensaje} />

  const resultado = await obtenerTarjetasDeHijos()

  const encabezado = (
    <EncabezadoCredencial
      etiqueta="Identificación"
      titulo="Credenciales de mis hijos"
      descripcion="La credencial digital con código QR de cada hijo o hija vinculado. Podés verla, descargarla como imagen e imprimirla."
      idTitulo={ID_TITULO}
    />
  )

  if (!resultado.ok) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {encabezado}
        <ErrorDeLectura
          titulo="No pudimos cargar las credenciales"
          mensaje={CATALOGO_CREDENCIALES[resultado.codigo].mensaje}
          reintentarHref="/dashboard/credenciales-hijos"
        />
      </div>
    )
  }

  if (resultado.datos.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {encabezado}
        <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-16 text-center">
          <Student size={40} className="mx-auto mb-3 text-neutral-400" aria-hidden="true" />
          <p className="font-semibold text-neutral-800">Todavía no tenés hijos vinculados</p>
          <p className="mt-1 text-sm text-neutral-600">
            Cuando Dirección vincule a tus hijos con tu cuenta, vas a ver sus credenciales acá.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      {encabezado}
      {resultado.datos.map((tarjeta) => {
        const idHijo = `hijo-${tarjeta.alumno.id}`
        return (
          <div key={tarjeta.alumno.id} className="space-y-3">
            <h2 id={idHijo} className="text-lg font-bold text-neutral-900 print:hidden">
              {tarjeta.alumno.nombre} {tarjeta.alumno.apellido}
            </h2>
            <TarjetaCredencial tarjeta={tarjeta} vista="HIJO" idTitulo={idHijo} />
          </div>
        )
      })}
    </div>
  )
}
