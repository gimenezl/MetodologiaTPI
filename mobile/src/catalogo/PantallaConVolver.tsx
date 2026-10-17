import { useRef, type ReactElement, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { color, espacio, tactil } from '@/tokens'

export interface PantallaConVolverProps {
  /** Vuelve a la pantalla anterior. Lo invocan la flecha y el gesto de deslizar desde el borde izquierdo. */
  onVolver: () => void
  /** Hay una operación en curso que no debe interrumpirse: la flecha y el gesto quedan sin efecto. */
  deshabilitado?: boolean
  children: ReactNode
}

/** El gesto solo arranca en este margen del borde izquierdo (px), como el de «volver» del sistema. */
const ZONA_BORDE = 40
/** Distancia horizontal mínima para tomarlo como un «volver». */
const UMBRAL = 72

/**
 * Marco de una pantalla secundaria: una flecha arriba a la izquierda y el gesto de deslizar hacia la derecha
 * desde el borde, como en las demás aplicaciones. No cambia el contenido ni la lógica de la pantalla: solo
 * llama a `onVolver`. El gesto se limita al borde para no competir con el desplazamiento vertical ni con los
 * campos de texto.
 */
export function PantallaConVolver({ onVolver, deshabilitado = false, children }: PantallaConVolverProps): ReactElement {
  // Dónde empezó el toque: solo se escribe y se lee en los manejadores de eventos, nunca al dibujar.
  const inicio = useRef({ x: 0, y: 0 })

  return (
    <View
      testID="pantalla-con-volver"
      style={{ gap: espacio.md }}
      onTouchStart={evento => {
        inicio.current = { x: evento.nativeEvent.pageX, y: evento.nativeEvent.pageY }
      }}
      // Captura solo un arrastre claramente horizontal hacia la derecha que nació en el borde izquierdo.
      onMoveShouldSetResponderCapture={evento => {
        if (deshabilitado) return false
        const dx = evento.nativeEvent.pageX - inicio.current.x
        const dy = evento.nativeEvent.pageY - inicio.current.y
        return inicio.current.x <= ZONA_BORDE && dx > 12 && Math.abs(dy) < dx * 0.5
      }}
      onResponderRelease={evento => {
        if (deshabilitado) return
        const dx = evento.nativeEvent.pageX - inicio.current.x
        const dy = evento.nativeEvent.pageY - inicio.current.y
        if (dx >= UMBRAL && Math.abs(dy) < dx * 0.6) onVolver()
      }}
    >
      <Pressable
        testID="volver-flecha"
        accessibilityRole="button"
        accessibilityLabel="Volver"
        accessibilityHint="Vuelve a la pantalla anterior"
        accessibilityState={{ disabled: deshabilitado }}
        disabled={deshabilitado}
        onPress={deshabilitado ? undefined : onVolver}
        hitSlop={8}
        style={({ pressed }) => ({
          minHeight: tactil.minimo,
          minWidth: tactil.minimo,
          alignSelf: 'flex-start',
          justifyContent: 'center',
          opacity: deshabilitado ? 0.4 : pressed ? 0.6 : 1,
        })}
      >
        {/* Decorativa: el lector de pantalla anuncia «Volver» por la etiqueta del botón. */}
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ fontSize: 32, lineHeight: 36, color: color.primario600 }}
        >
          ←
        </Text>
      </Pressable>
      {children}
    </View>
  )
}
