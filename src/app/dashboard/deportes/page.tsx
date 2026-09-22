import type { Metadata } from 'next'
import { requerirSesionConRol } from '@/services/autorizacion'
import {
  listarCatalogoAltaGrupo,
  listarGruposDeportivos,
  listarInscripcionesDeportivas,
  MENSAJES_DEPORTES,
  obtenerSituacionAcademicaPropia,
  type SituacionAcademicaPropia,
} from '@/services/deportes.service'
import { GestionDeportes } from './_components/GestionDeportes'
import { MisDeportes } from './_components/MisDeportes'
import { PanelErrorLectura, PanelRestringido } from './_components/Paneles'

export const metadata: Metadata = {
  title: 'Deportes | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Deportes (EPT-11).
 *
 * Una sola ruta atiende a los dos actores de la historia: el ESTUDIANTE, que
 * se inscribe y cancela en grupos de su nivel, y el DIRECTOR, que consulta y
 * crea grupos. El alcance de los datos lo decide PostgreSQL (RLS y
 * `listar_grupos_deportivos`); esta función solo elige qué presentación
 * renderizar. El resto de los roles recibe el panel de acceso restringido,
 * que es presentación, no seguridad: la API y la base también los rechazan.
 */
export default async function DeportesPage() {
  const sesion = await requerirSesionConRol()

  if (!sesion.autorizado) {
    return (
      <PanelRestringido
        mensaje={sesion.mensaje}
        accion={sesion.estado === 401 ? { href: '/login', texto: 'Iniciar sesión' } : undefined}
      />
    )
  }

  if (sesion.rol !== 'ESTUDIANTE' && sesion.rol !== 'DIRECTOR') {
    return <PanelRestringido mensaje="No tenés permisos para ver la sección de deportes." />
  }

  const [grupos, inscripciones] = await Promise.all([
    listarGruposDeportivos(),
    listarInscripcionesDeportivas(),
  ])

  // Grupos e inscripciones son la sustancia de la pantalla: sin ellos no se
  // muestra un estado vacío que parezca real.
  if (!grupos.ok) return <PanelErrorLectura mensaje={grupos.mensaje} />
  if (!inscripciones.ok) return <PanelErrorLectura mensaje={inscripciones.mensaje} />

  if (sesion.rol === 'DIRECTOR') {
    const catalogo = await listarCatalogoAltaGrupo()
    return (
      <GestionDeportes
        grupos={grupos.datos}
        inscripciones={inscripciones.datos}
        catalogo={catalogo.ok ? catalogo.datos : null}
      />
    )
  }

  const situacion = await obtenerSituacionAcademicaPropia()
  const datosSituacion = situacion.ok ? situacion.datos : null

  return (
    <MisDeportes
      grupos={grupos.datos}
      inscripciones={inscripciones.datos}
      nivelNombre={datosSituacion?.nivel_nombre ?? null}
      impedimento={situacion.ok ? impedimentoDeAlta(datosSituacion) : undefined}
      mensajeInicial={
        situacion.ok
          ? undefined
          : 'No pudimos verificar tu situación académica. Podés consultar tus deportes y reintentar más tarde.'
      }
    />
  )
}

/**
 * Explica por qué el alumno todavía no puede inscribirse. Es texto para la
 * persona, no una frontera: PostgreSQL vuelve a evaluar cada condición en el
 * alta, con el alumno bloqueado, y responde con estos mismos mensajes.
 */
function impedimentoDeAlta(situacion: SituacionAcademicaPropia | null): string | undefined {
  if (situacion === null) return MENSAJES_DEPORTES.sinLegajo
  if (situacion.estado !== 'ACTIVO') return MENSAJES_DEPORTES.legajoInactivo
  if (!situacion.nivel_nombre) return MENSAJES_DEPORTES.sinCurso
  return undefined
}
