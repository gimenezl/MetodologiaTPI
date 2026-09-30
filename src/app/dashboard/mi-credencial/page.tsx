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
import { obtenerTarjetaPropia } from '@/services/credenciales-qr.service'

export const metadata: Metadata = { title: 'Mi credencial | Panel' }
export const dynamic = 'force-dynamic'

const ID_TITULO = 'titulo-mi-credencial'

/**
 * Credencial propia del estudiante (EPT-64, RF20).
 *
 * No recibe ni filtra por identificador: la vista académica solo devuelve al
 * estudiante su propia fila (RLS), así que no hay parámetro que manipular. Un
 * estudiante bloqueado ni siquiera llega acá: el layout del panel lo redirige.
 */
export default async function MiCredencialPage() {
  const permiso = await requerirRol('ESTUDIANTE', 'Solo los estudiantes pueden ver su credencial.')
  if (!permiso.autorizado) return <AccesoRestringido mensaje={permiso.mensaje} />

  const resultado = await obtenerTarjetaPropia()

  const encabezado = (
    <EncabezadoCredencial
      etiqueta="Identificación"
      titulo="Mi credencial"
      descripcion="Tu credencial digital con código QR. Podés verla, descargarla como imagen e imprimirla. Esta vista es de solo lectura."
      idTitulo={ID_TITULO}
    />
  )

  if (!resultado.ok) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {encabezado}
        <ErrorDeLectura
          titulo="No pudimos cargar tu credencial"
          mensaje={CATALOGO_CREDENCIALES[resultado.codigo].mensaje}
          reintentarHref="/dashboard/mi-credencial"
        />
      </div>
    )
  }

  if (!resultado.datos) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {encabezado}
        <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-16 text-center">
          <Student size={40} className="mx-auto mb-3 text-neutral-400" aria-hidden="true" />
          <p className="font-semibold text-neutral-800">Todavía no tenés un legajo académico</p>
          <p className="mt-1 text-sm text-neutral-600">
            Cuando Dirección complete tu situación académica, vas a poder ver tu credencial desde acá.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {encabezado}
      <TarjetaCredencial tarjeta={resultado.datos} vista="PROPIA" idTitulo={ID_TITULO} />
    </div>
  )
}
