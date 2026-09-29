import type { Metadata } from 'next'
import { requerirSesionConRol } from '@/services/autorizacion'
import { obtenerEstadoAcademicoPropio } from '@/services/comedor.service'
import { listarInscripcionesServiciosAdministracion } from '@/services/inscripciones-administracion.service'
import { listarInscripcionesTransporte, listarRecorridos } from '@/services/transporte.service'
import { PanelErrorLectura, PanelRestringido } from './_components/Paneles'
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

  if (sesion.rol === 'DIRECTOR') {
    // Dirección lee la vista administrativa: además de las inscripciones trae la
    // confirmación (quién y cuándo), que ningún otro rol puede ver.
    const [recorridos, administracion] = await Promise.all([
      listarRecorridos(),
      listarInscripcionesServiciosAdministracion('TRANSPORTE'),
    ])
    if (!administracion.ok) {
      return <PanelErrorLectura mensaje={administracion.mensaje} />
    }
    // El catálogo es la sustancia de esta vista: si no se pudo leer, un
    // catálogo vacío se vería igual que «no hay recorridos», que no es lo que
    // pasó. Se distingue con el mismo panel de error que ya usa la falta de
    // inscripciones, en vez de degradar a una lista vacía silenciosa.
    if (!recorridos.ok) {
      return <PanelErrorLectura mensaje={recorridos.mensaje} />
    }
    return <GestionTransporte recorridos={recorridos.datos} inscripciones={administracion.datos} />
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

  // Para el alumno el catálogo sí puede degradarse: la pantalla sigue siendo
  // útil para consultar el estado propio y el botón de alta queda explicado
  // y deshabilitado (mismo criterio que el comedor).
  const listaRecorridos = recorridos.ok ? recorridos.datos : []

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
