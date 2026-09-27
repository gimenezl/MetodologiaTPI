import type { Metadata } from 'next'
import { Lock, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { requerirSesionConRol } from '@/services/autorizacion'
import { obtenerEstadoAcademicoPropio } from '@/services/comedor.service'
import { listarInscripcionesTransporte, listarRecorridos } from '@/services/transporte.service'
import { GestionTransporte } from './_components/GestionTransporte'
import { MiTransporte } from './_components/MiTransporte'

export const metadata: Metadata = {
  title: 'Transporte | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Transporte escolar y sus cuatro recorridos (EPT-60).
 *
 * Una sola ruta atiende a los dos actores de la historia porque muestran los
 * mismos datos con distinto alcance, y ese alcance ya lo decide RLS: el
 * estudiante recibe solo sus filas y Dirección todas. La rama de esta función
 * elige qué presentación renderizar; nunca decide qué datos se pueden leer.
 *
 * Reutiliza `obtenerEstadoAcademicoPropio` de EPT-10: la situación académica
 * que explica por qué un alumno todavía no puede usar un servicio escolar no
 * depende de cuál sea el servicio.
 *
 * El resto de los roles no tiene nada que hacer acá y recibe el panel de
 * acceso restringido. Eso es presentación, no seguridad: aunque alguien
 * llegara igual, la lectura devolvería cero filas y la API respondería 403.
 */
export default async function TransportePage() {
  const sesion = await requerirSesionConRol()

  if (!sesion.autorizado) {
    return (
      <PanelRestringido
        mensaje={sesion.mensaje}
        accion={
          sesion.estado === 401 ? { href: '/login', texto: 'Iniciar sesión' } : undefined
        }
      />
    )
  }

  if (sesion.rol !== 'ESTUDIANTE' && sesion.rol !== 'DIRECTOR') {
    return (
      <PanelRestringido mensaje="No tenés permisos para ver el transporte escolar." />
    )
  }

  const [recorridos, inscripciones] = await Promise.all([
    listarRecorridos(),
    listarInscripcionesTransporte(),
  ])

  // Las inscripciones son la sustancia de la pantalla: sin ellas no se muestra
  // un estado vacío que parezca real.
  if (!inscripciones.ok) {
    return <PanelErrorLectura mensaje={inscripciones.mensaje} />
  }

  const listaRecorridos = recorridos.ok ? recorridos.datos : []

  if (sesion.rol === 'DIRECTOR') {
    return (
      <GestionTransporte recorridos={listaRecorridos} inscripciones={inscripciones.datos} />
    )
  }

  const academico = await obtenerEstadoAcademicoPropio()
  const situacion = academico.ok ? academico.datos : null

  return (
    <MiTransporte
      recorridos={listaRecorridos}
      inscripciones={inscripciones.datos}
      impedimento={impedimentoDeAlta(situacion)}
      mensajeInicial={
        recorridos.ok
          ? undefined
          : 'No pudimos cargar el catálogo de recorridos. Podés consultar tu estado y reintentar más tarde.'
      }
    />
  )
}

/**
 * Explica, en el idioma del alumno, por qué todavía no puede elegir un
 * recorrido.
 *
 * Es texto para la persona, no una frontera: PostgreSQL vuelve a evaluar cada
 * una de estas condiciones en el momento del alta, con la fila bloqueada. Los
 * mensajes son exactamente los mismos que devuelve el servidor ante el
 * rechazo correspondiente, para que la pantalla y la API nunca digan cosas
 * distintas.
 */
function impedimentoDeAlta(
  situacion: { estado: 'ACTIVO' | 'INACTIVO' } | null
): string | undefined {
  if (situacion === null) {
    return 'Todavía no tenés un legajo académico. Comunicate con la administración del centro educativo.'
  }
  if (situacion.estado !== 'ACTIVO') {
    return 'Tu legajo académico no está activo, así que no podés usar el transporte. Comunicate con la administración del centro educativo.'
  }
  return undefined
}

function PanelRestringido({
  mensaje,
  accion,
}: {
  mensaje: string
  accion?: { href: string; texto: string }
}) {
  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
        <Lock size={32} weight="fill" className="text-red-500" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">
        Acceso restringido
      </h1>
      <p className="text-neutral-500 text-sm mt-2">{mensaje}</p>
      <EnlaceBoton href={accion?.href ?? '/dashboard'} className="mt-6">
        {accion?.texto ?? 'Volver al panel'}
      </EnlaceBoton>
    </div>
  )
}

function PanelErrorLectura({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          Transporte
        </h1>
        <p className="text-neutral-500 text-sm mt-1">Recorridos de transporte escolar</p>
      </div>
      <div
        role="alert"
        className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
      >
        <WarningCircle size={22} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">
            No pudimos cargar el transporte
          </p>
          <p className="text-sm text-red-700 mt-1">{mensaje}</p>
          <EnlaceBoton href="/dashboard/transporte" variant="outline" className="mt-4">
            Reintentar
          </EnlaceBoton>
        </div>
      </div>
    </div>
  )
}
