import type { ReactElement } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Avatar, EstadoPantalla, Tarjeta } from '@/catalogo'
import { color, espacio, estiloDeTexto, radio, tactil } from '@/tokens'

import type { DatosRol } from './datos-rol'

type Padre = Extract<DatosRol, { rol: 'PADRE' }>
type Estudiante = Extract<DatosRol, { rol: 'ESTUDIANTE' }>

function nombreCompleto(persona: { nombre: string | null; apellido: string | null }, alternativa: string): string {
  return [persona.nombre, persona.apellido].filter(Boolean).join(' ') || alternativa
}

/** Una acción grande y clara: qué hace y para qué sirve, en dos líneas. */
export function AccionRapida({
  titulo,
  descripcion,
  glifo,
  onPress,
  testID,
}: {
  titulo: string
  descripcion: string
  glifo: string
  onPress: () => void
  testID?: string
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${titulo}. ${descripcion}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: tactil.minimo + 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: espacio.lg,
        padding: espacio.lg,
        borderRadius: radio.lg,
        backgroundColor: pressed ? color.primario100 : color.primario50,
      })}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.superficie, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 22, color: color.primario600 }}>{glifo}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[estiloDeTexto('subtitulo'), { color: color.primario700 }]}>{titulo}</Text>
        <Text style={[estiloDeTexto('avisoCuerpo'), { color: color.neutro700 }]}>{descripcion}</Text>
      </View>
      <Text importantForAccessibility="no" accessibilityElementsHidden style={{ fontSize: 24, color: color.primario600 }}>
        ›
      </Text>
    </Pressable>
  )
}

export interface AccionesInicio {
  onCuotas: () => void
  onHistorial: () => void
  onDeuda: () => void
}

export function InicioPadre({ datos, acciones }: { datos: Padre; acciones: AccionesInicio }): ReactElement {
  return (
    <View style={{ gap: espacio.xl }}>
      <View style={{ gap: espacio.md }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro600 }]}>Hijos vinculados</Text>
        {datos.hijos.length === 0 ? (
          <EstadoPantalla
            tipo="vacio"
            titulo="Todavía no hay estudiantes vinculados"
            descripcion="Cuando la institución registre un vínculo familiar autorizado, aparecerá en esta sección."
          />
        ) : (
          datos.hijos.map(hijo => {
            const nombre = nombreCompleto(hijo, 'Estudiante')
            const curso = [hijo.curso_denominacion, hijo.curso_division].filter(Boolean).join(' ')
            const detalle = [curso || 'Sin curso informado', hijo.nivel_nombre].filter(Boolean).join(' · ')
            return (
              <Tarjeta key={hijo.id}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.md }}>
                  <Avatar nombre={nombre} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text accessibilityRole="header" style={[estiloDeTexto('subtitulo'), { color: color.neutro800 }]}>{nombre}</Text>
                    <Text style={[estiloDeTexto('avisoCuerpo'), { color: color.neutro600 }]}>{detalle}</Text>
                  </View>
                </View>
                <Text style={[estiloDeTexto('avisoCuerpo'), { color: color.neutro600 }]}>
                  Legajo {hijo.legajo_nro ?? 'no disponible'}
                  {hijo.estado ? ` · ${hijo.estado}` : ''}
                </Text>
              </Tarjeta>
            )
          })
        )}
      </View>

      {datos.hijos.length > 0 ? (
        <View style={{ gap: espacio.md }}>
          <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro600 }]}>¿Qué querés hacer?</Text>
          <AccionRapida glifo="$" titulo="Pagar cuotas" descripcion="Elegí qué pagar y subí el comprobante" onPress={acciones.onCuotas} testID="accion-pagar" />
          <AccionRapida glifo="☰" titulo="Ver historial y recibos" descripcion="Facturas, pagos y recibos por período" onPress={acciones.onHistorial} testID="accion-historial" />
          <AccionRapida glifo="◷" titulo="Ver deuda por ítem" descripcion="Cuánto debés de cada concepto" onPress={acciones.onDeuda} testID="accion-deuda" />
        </View>
      ) : null}
    </View>
  )
}

export function InicioEstudiante({ datos, acciones }: { datos: Estudiante; acciones: AccionesInicio }): ReactElement {
  const alumno = datos.alumno
  const curso = [alumno.curso_denominacion, alumno.curso_division].filter(Boolean).join(' ')
  const filas: [string, string][] = [
    ['Estudiante', nombreCompleto(alumno, 'No disponible')],
    ['Legajo', alumno.legajo_nro ?? 'No disponible'],
    ['Estado', alumno.estado ?? 'No disponible'],
    ['Curso', curso || 'Sin curso informado'],
    ['Nivel', alumno.nivel_nombre ?? 'No disponible'],
  ]
  return (
    <View style={{ gap: espacio.xl }}>
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('subtitulo'), { color: color.neutro800 }]}>Mi información académica</Text>
        {filas.map(([rotulo, valor]) => (
          <View key={rotulo} style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: espacio.sm }}>
            <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>{rotulo}</Text>
            <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro800, flexShrink: 1 }]}>{valor}</Text>
          </View>
        ))}
      </Tarjeta>
      <View style={{ gap: espacio.md }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro600 }]}>¿Qué querés hacer?</Text>
        <AccionRapida glifo="$" titulo="Ver mis cuotas" descripcion="Lo que debés y lo que ya está pagado" onPress={acciones.onCuotas} testID="accion-pagar" />
        <AccionRapida glifo="☰" titulo="Ver historial y recibos" descripcion="Facturas e inscripciones" onPress={acciones.onHistorial} testID="accion-historial" />
      </View>
    </View>
  )
}
