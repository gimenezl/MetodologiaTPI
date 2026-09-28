import type { Metadata } from 'next'
import { requerirSesionConRol } from '@/services/autorizacion'
import { listarInscripcionesServiciosAdministracion } from '@/services/inscripciones-administracion.service'
import {
  listarInscripcionesComedor,
  obtenerEstadoAcademicoPropio,
  obtenerServicioComedor,
} from '@/services/comedor.service'
import { PanelErrorLectura, PanelRestringido } from './_components/Paneles'
import { InscriptosComedor } from './_components/InscriptosComedor'
import { MiComedor } from './_components/MiComedor'

export const metadata: Metadata = {
  title: 'Comedor | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Comedor escolar (EPT-10).
 *
 * Una sola ruta atiende a los dos actores de la historia porque muestran los
 * mismos datos con distinto alcance, y ese alcance ya lo decide RLS: el
 * estudiante recibe solo sus filas y el director todas. La rama de esta función
 * elige qué presentación renderizar; nunca decide qué datos se pueden leer.
 * Solo el director lee, además, la confirmación de cada inscripción (EPT-62).
 *
 * El resto de los roles no tiene nada que hacer acá y recibe el panel de acceso
 * restringido. Eso es presentación, no seguridad: aunque alguien llegara igual,
 * la lectura devolvería cero filas y la API respondería 403.
 */
export default async function ComedorPage() {
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
      <PanelRestringido mensaje="No tenés permisos para ver el comedor escolar." />
    )
  }

  if (sesion.rol === 'DIRECTOR') {
    // Dirección lee la vista administrativa: además de las inscripciones trae la
    // confirmación (quién y cuándo), que ningún otro rol puede ver.
    const [servicio, administracion] = await Promise.all([
      obtenerServicioComedor(),
      listarInscripcionesServiciosAdministracion('COMEDOR'),
    ])
    if (!administracion.ok) {
      return <PanelErrorLectura mensaje={administracion.mensaje} />
    }
    return (
      <InscriptosComedor
        servicio={servicio.ok ? servicio.datos : null}
        inscripciones={administracion.datos}
      />
    )
  }

  const [servicio, inscripciones] = await Promise.all([
    obtenerServicioComedor(),
    listarInscripcionesComedor(),
  ])

  // Las inscripciones son la sustancia de la pantalla: sin ellas no se muestra
  // un estado vacío que parezca real.
  if (!inscripciones.ok) {
    return <PanelErrorLectura mensaje={inscripciones.mensaje} />
  }

  // El catálogo sí puede degradarse: la pantalla sigue siendo útil para
  // consultar el estado propio y el botón de alta queda explicado y deshabilitado.
  const servicioComedor = servicio.ok ? servicio.datos : null
  const academico = await obtenerEstadoAcademicoPropio()
  const situacion = academico.ok ? academico.datos : null

  return (
    <MiComedor
      servicio={servicioComedor}
      inscripciones={inscripciones.datos}
      impedimento={impedimentoDeAlta(servicioComedor, situacion)}
      mensajeInicial={
        servicio.ok
          ? undefined
          : 'No pudimos cargar los datos del comedor. Podés consultar tu estado y reintentar más tarde.'
      }
    />
  )
}

/**
 * Explica, en el idioma del alumno, por qué todavía no puede inscribirse.
 *
 * Es texto para la persona, no una frontera: PostgreSQL vuelve a evaluar cada
 * una de estas condiciones en el momento del alta, con la fila bloqueada. Los
 * mensajes son exactamente los mismos que devuelve el servidor ante el rechazo
 * correspondiente, para que la pantalla y la API nunca digan cosas distintas.
 */
function impedimentoDeAlta(
  servicio: { activo: boolean } | null,
  situacion: { estado: 'ACTIVO' | 'INACTIVO' } | null
): string | undefined {
  if (situacion === null) {
    return 'Todavía no tenés un legajo académico. Comunicate con la administración del centro educativo.'
  }
  if (situacion.estado !== 'ACTIVO') {
    return 'Tu legajo académico no está activo, así que no podés inscribirte al comedor. Comunicate con la administración del centro educativo.'
  }
  if (servicio === null) {
    return 'El comedor no está disponible en este momento. Volvé a intentarlo más tarde.'
  }
  if (!servicio.activo) {
    return 'El comedor no está recibiendo inscripciones en este momento.'
  }
  return undefined
}
