import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, EstadoPantalla, InsigniaEstado, Tarjeta } from '@/catalogo'
import {
  ETIQUETA_CATEGORIA,
  ORDEN_CATEGORIAS,
  isoAEntrada,
  type CausaConsulta,
  type CategoriaInscripcion,
  type Inscripcion,
} from '@/servicios/consultas-familia'
import { color, espacio, estiloDeTexto } from '@/tokens'

import type { AlumnoSelector } from '../cuotas/CuotasVista'
import { SelectorEstudiante } from './SelectorEstudiante'

export type ResultadoInscripciones =
  | { tipo: 'cargando' }
  | { tipo: 'error'; causa: CausaConsulta }
  | { tipo: 'ok'; inscripciones: Inscripcion[] }

export interface InscripcionesVistaProps {
  alumnos: AlumnoSelector[]
  alumnoId: string | null
  mostrarSelector: boolean
  resultado: ResultadoInscripciones
  onSeleccionarAlumno: (id: string) => void
  onReintentar: () => void
}

const TEXTO_VACIO: Record<CategoriaInscripcion, string> = {
  DEPORTE: 'No hay inscripciones a deportes registradas.',
  TRANSPORTE: 'No hay inscripciones a recorridos de transporte registradas.',
  COMEDOR: 'No hay inscripciones al comedor registradas.',
}

const TEXTO_INACTIVO: Record<CategoriaInscripcion, string> = {
  DEPORTE: 'El deporte o su grupo ya no figura como activo en el catálogo actual. La inscripción se muestra igual.',
  TRANSPORTE: 'El recorrido ya no figura como activo en el catálogo actual. La inscripción se muestra igual.',
  COMEDOR: 'El servicio ya no figura como activo en el catálogo actual. La inscripción se muestra igual.',
}

function Dato({ rotulo, valor }: { rotulo: string; valor: string }): ReactElement {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{rotulo}</Text>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro800, flexShrink: 1 }]}>{valor}</Text>
    </View>
  )
}

export function TarjetaInscripcion({ inscripcion }: { inscripcion: Inscripcion }): ReactElement {
  const cancelada = inscripcion.estado === 'CANCELADA'
  return (
    <View testID={`inscripcion-${inscripcion.inscripcionId}`}>
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          {inscripcion.nombre}
        </Text>
        <InsigniaEstado dominio="inscripcion" estado={cancelada ? 'cancelada' : 'activa'} />
        {inscripcion.grupo ? <Dato rotulo="Grupo:" valor={inscripcion.grupo} /> : null}
        {inscripcion.nivel ? <Dato rotulo="Nivel del grupo:" valor={inscripcion.nivel} /> : null}
        <Dato rotulo="Inscripción:" valor={isoAEntrada(inscripcion.fechaInscripcion)} />
        {inscripcion.fechaCancelacion ? <Dato rotulo="Cancelada el:" valor={isoAEntrada(inscripcion.fechaCancelacion)} /> : null}
        {!inscripcion.catalogoActivo ? (
          <Aviso tipo="informativo" mensaje={TEXTO_INACTIVO[inscripcion.categoria]} anuncio="estado" />
        ) : null}
      </Tarjeta>
    </View>
  )
}

/**
 * Inscripciones de solo lectura: deportes, transporte y comedor. No hay alta, modificación ni
 * cancelación: la institución es quien las gestiona.
 */
export function InscripcionesVista(props: InscripcionesVistaProps): ReactElement {
  const { alumnos, alumnoId, mostrarSelector, resultado } = props

  if (alumnos.length === 0) {
    return (
      <EstadoPantalla
        tipo="vacio"
        titulo="Todavía no hay estudiantes vinculados"
        descripcion="Cuando la institución registre un vínculo familiar autorizado, vas a poder consultar sus inscripciones desde acá."
      />
    )
  }

  return (
    <View style={{ gap: espacio.md }}>
      {mostrarSelector ? (
        <SelectorEstudiante
          alumnos={alumnos}
          alumnoId={alumnoId}
          onSeleccionar={props.onSeleccionarAlumno}
          pista="Mostrar las inscripciones de este estudiante"
          prefijoId="insc-hijo"
        />
      ) : null}

      <Aviso
        tipo="informativo"
        titulo="Solo consulta"
        mensaje="Estas inscripciones ya están registradas en el sistema de la institución. Desde la aplicación no se pueden agregar, modificar ni cancelar."
        anuncio="estado"
      />

      {resultado.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Consultando inscripciones…" /> : null}
      {resultado.tipo === 'error' ? (
        <EstadoPantalla
          tipo="error"
          titulo={resultado.causa === 'permiso' ? 'No tenés permiso para ver esta información' : 'No pudimos cargar las inscripciones'}
          descripcion={
            resultado.causa === 'permiso'
              ? 'Tu cuenta no puede consultar estas inscripciones. Si creés que es un error, contactá a la institución.'
              : 'No mostramos datos hasta poder validarlos. Intentá nuevamente.'
          }
          onReintentar={resultado.causa === 'permiso' ? undefined : props.onReintentar}
        />
      ) : null}
      {resultado.tipo === 'ok'
        ? ORDEN_CATEGORIAS.map(categoria => {
            const lista = resultado.inscripciones.filter(i => i.categoria === categoria)
            return (
              <View key={categoria} style={{ gap: espacio.md }} testID={`inscripciones-${categoria}`}>
                <Text accessibilityRole="header" style={[estiloDeTexto('subtitulo'), { color: color.neutro800 }]}>
                  {ETIQUETA_CATEGORIA[categoria]}
                </Text>
                {lista.length === 0 ? (
                  <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{TEXTO_VACIO[categoria]}</Text>
                ) : (
                  lista.map(inscripcion => <TarjetaInscripcion key={inscripcion.inscripcionId} inscripcion={inscripcion} />)
                )}
              </View>
            )
          })
        : null}
      {resultado.tipo === 'ok' ? (
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>
          Los nombres de deportes, grupos y recorridos son los vigentes hoy en el catálogo: el sistema no conserva cómo se llamaban cuando te inscribiste.
        </Text>
      ) : null}
    </View>
  )
}
