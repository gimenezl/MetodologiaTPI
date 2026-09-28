import type { Metadata } from 'next'
import { requerirSesionConRol } from '@/services/autorizacion'
import { listarInscripcionesDeportivasAdministracion } from '@/services/inscripciones-administracion.service'
import {
  consultarCompatibilidadPropia,
  listarAdministracionDeportes,
  listarAlumnosInscribibles,
  listarCatalogoAltaGrupo,
  listarGruposDeportivos,
  listarHorariosGrupos,
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
 * Deportes (EPT-11, EPT-12, EPT-61).
 *
 * Una sola ruta atiende a los dos actores de la historia: el ESTUDIANTE, que
 * se inscribe y cancela en grupos de su nivel viendo sus horarios y su
 * compatibilidad, y el DIRECTOR, que administra el catálogo de deportes y los
 * grupos, configura sus franjas, inscribe a un alumno con las mismas reglas y
 * administra las inscripciones (confirmar y cancelar en nombre del alumno). El
 * estudiante conserva su vista sin ningún control de administración. El alcance
 * de los datos lo decide PostgreSQL (RLS y
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

  if (sesion.rol === 'DIRECTOR') {
    // Dirección lee las inscripciones por la vista administrativa: además de las
    // activas y las canceladas trae la confirmación (quién y cuándo), que ningún
    // otro rol puede ver (EPT-62).
    const [grupos, inscripciones, horarios, catalogo, alumnos, administracion] = await Promise.all([
      listarGruposDeportivos(),
      listarInscripcionesDeportivasAdministracion(),
      listarHorariosGrupos(),
      listarCatalogoAltaGrupo(),
      listarAlumnosInscribibles(),
      listarAdministracionDeportes(),
    ])

    // Grupos, inscripciones y horarios son la sustancia de la pantalla: sin ellos
    // no se muestra un estado vacío que parezca real. Sin horarios, además, un
    // grupo con franjas se vería como «sin horario» y eso sería falso.
    if (!grupos.ok) return <PanelErrorLectura mensaje={grupos.mensaje} />
    if (!inscripciones.ok) return <PanelErrorLectura mensaje={inscripciones.mensaje} />
    if (!horarios.ok) return <PanelErrorLectura mensaje={horarios.mensaje} />

    return (
      <GestionDeportes
        grupos={grupos.datos}
        inscripciones={inscripciones.datos}
        horarios={horarios.datos}
        catalogo={catalogo.ok ? catalogo.datos : null}
        alumnos={alumnos.ok ? alumnos.datos : null}
        administracion={administracion.ok ? administracion.datos : null}
      />
    )
  }

  const [grupos, inscripciones, horarios] = await Promise.all([
    listarGruposDeportivos(),
    listarInscripcionesDeportivas(),
    listarHorariosGrupos(),
  ])

  if (!grupos.ok) return <PanelErrorLectura mensaje={grupos.mensaje} />
  if (!inscripciones.ok) return <PanelErrorLectura mensaje={inscripciones.mensaje} />
  if (!horarios.ok) return <PanelErrorLectura mensaje={horarios.mensaje} />

  const [situacion, compatibilidad] = await Promise.all([
    obtenerSituacionAcademicaPropia(),
    consultarCompatibilidadPropia(),
  ])
  const datosSituacion = situacion.ok ? situacion.datos : null

  return (
    <MisDeportes
      grupos={grupos.datos}
      inscripciones={inscripciones.datos}
      horarios={horarios.datos}
      compatibilidad={compatibilidad.ok ? compatibilidad.datos : null}
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
