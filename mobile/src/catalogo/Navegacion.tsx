import type { ReactElement, ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { borde, color, espacio, estiloDeTexto, radio, tactil } from '@/tokens'

// ---- Segmentado ----------------------------------------------------------------------------------------
// Selector de pocas opciones excluyentes (por ejemplo «Pendientes / Pagadas»). Reemplaza a las hileras de
// botones: una sola barra, la opción activa se ve de un vistazo.

export interface OpcionSegmentada {
  clave: string
  etiqueta: string
  testID?: string
}

export interface SegmentadoProps {
  opciones: OpcionSegmentada[]
  activa: string
  onCambiar: (clave: string) => void
  /** Con muchas opciones o textos largos, la barra se desliza en vez de apretar el texto. */
  deslizable?: boolean
}

export function Segmentado({ opciones, activa, onCambiar, deslizable = false }: SegmentadoProps): ReactElement {
  const botones = opciones.map(opcion => {
    const seleccionada = opcion.clave === activa
    return (
      <Pressable
        key={opcion.clave}
        testID={opcion.testID}
        accessibilityRole="tab"
        accessibilityState={{ selected: seleccionada }}
        onPress={() => onCambiar(opcion.clave)}
        style={{
          flexGrow: deslizable ? 0 : 1,
          flexBasis: deslizable ? undefined : 0,
          minHeight: 44,
          paddingHorizontal: espacio.lg,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radio.pastilla,
          backgroundColor: seleccionada ? color.superficie : 'transparent',
          borderWidth: seleccionada ? borde.fino : 0,
          borderColor: color.neutro200,
        }}
      >
        <Text
          style={[
            estiloDeTexto('boton'),
            { color: seleccionada ? color.primario700 : color.neutro600, fontSize: 15, textAlign: 'center' },
          ]}
        >
          {opcion.etiqueta}
        </Text>
      </Pressable>
    )
  })
  const contenedor = {
    flexDirection: 'row' as const,
    gap: espacio.xs,
    padding: espacio.xs,
    backgroundColor: color.neutro100,
    borderRadius: radio.pastilla,
  }
  if (deslizable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" style={{ flexGrow: 0 }}>
        <View style={contenedor}>{botones}</View>
      </ScrollView>
    )
  }
  return (
    <View accessibilityRole="tablist" style={contenedor}>
      {botones}
    </View>
  )
}

// ---- BarraInferior -------------------------------------------------------------------------------------
// Navegación principal: 4 destinos siempre visibles, como en las apps bancarias.

export interface DestinoBarra {
  clave: string
  etiqueta: string
  /** Símbolo decorativo; la etiqueta de texto siempre acompaña. */
  glifo: string
  testID?: string
}

export function BarraInferior({
  destinos,
  activo,
  onCambiar,
}: {
  destinos: DestinoBarra[]
  activo: string
  onCambiar: (clave: string) => void
}): ReactElement {
  return (
    <View
      testID="barra-inferior"
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: color.superficie,
        borderTopWidth: borde.fino,
        borderTopColor: color.neutro200,
        paddingTop: espacio.xs,
      }}
    >
      {destinos.map(destino => {
        const seleccionado = destino.clave === activo
        return (
          <Pressable
            key={destino.clave}
            testID={destino.testID}
            accessibilityRole="tab"
            accessibilityLabel={destino.etiqueta}
            accessibilityState={{ selected: seleccionado }}
            onPress={() => onCambiar(destino.clave)}
            style={{ flex: 1, minHeight: tactil.barraInferior, alignItems: 'center', justifyContent: 'center', gap: 2 }}
          >
            <View
              style={{
                paddingHorizontal: espacio.lg,
                paddingVertical: 2,
                borderRadius: radio.pastilla,
                backgroundColor: seleccionado ? color.primario100 : 'transparent',
              }}
            >
              <Text
                importantForAccessibility="no"
                accessibilityElementsHidden
                style={{ fontSize: 20, color: seleccionado ? color.primario700 : color.neutro500 }}
              >
                {destino.glifo}
              </Text>
            </View>
            <Text
              style={[
                estiloDeTexto('pie'),
                { color: seleccionado ? color.primario700 : color.neutro600, fontSize: 12 },
              ]}
            >
              {destino.etiqueta}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ---- Avatar y EncabezadoPantalla -----------------------------------------------------------------------

export function Avatar({ nombre, tamano = 44 }: { nombre: string; tamano?: number }): ReactElement {
  const iniciales = nombre
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map(parte => parte.charAt(0).toUpperCase())
    .join('')
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: tamano,
        height: tamano,
        borderRadius: tamano / 2,
        backgroundColor: color.primario100,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={[estiloDeTexto('subtitulo'), { color: color.primario700 }]}>{iniciales || '?'}</Text>
    </View>
  )
}

/** Encabezado de pantalla: título grande y, si hace falta, una línea que explica para qué sirve. */
export function EncabezadoPantalla({
  titulo,
  descripcion,
  children,
}: {
  titulo: string
  descripcion?: string
  children?: ReactNode
}): ReactElement {
  return (
    <View style={{ gap: espacio.xs }}>
      <Text accessibilityRole="header" style={[estiloDeTexto('tituloEncabezado'), { color: color.neutro800 }]}>
        {titulo}
      </Text>
      {descripcion ? <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>{descripcion}</Text> : null}
      {children}
    </View>
  )
}
