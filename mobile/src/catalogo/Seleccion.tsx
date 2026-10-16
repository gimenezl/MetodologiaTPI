import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native'

import { borde, color, espacio, estiloDeTexto, radio, tactil } from '@/tokens'

import { formatearImporte, type Centavos } from './importe'

// ---- FilaSeleccionable ---------------------------------------------------------------------------------
// Contrato EPT-99 (04-listas-y-filas): la fila completa es el objetivo táctil (≥ 48), la casilla visible es de
// 32 × 32 y el estado nunca depende solo del color (tilde, texto de motivo y rol `checkbox`).

export interface FilaSeleccionableProps {
  itemId: string
  concepto: string
  /** Texto del estado visible junto al concepto («Pendiente», «En verificación», «Pagado»…). */
  estado: string
  importeCentavos: Centavos
  seleccionado: boolean
  /** Lo decide el contenedor; la pieza no conoce las reglas de negocio. */
  seleccionable: boolean
  /** Motivo visible cuando no es seleccionable. */
  motivo?: string
  /** Solo se emite si `seleccionable`. */
  onToggle: (itemId: string) => void
  testID?: string
}

export function FilaSeleccionable({
  itemId,
  concepto,
  estado,
  importeCentavos,
  seleccionado,
  seleccionable,
  motivo,
  onToggle,
  testID,
}: FilaSeleccionableProps): ReactElement {
  const importe = formatearImporte(importeCentavos)
  const lectura = `${concepto}, ${estado}, ${importe.replace('ARS', 'pesos argentinos')}${motivo ? `. ${motivo}` : ''}`
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={lectura}
      accessibilityState={{ checked: seleccionado, disabled: !seleccionable }}
      disabled={!seleccionable}
      onPress={seleccionable ? () => onToggle(itemId) : undefined}
      style={{
        minHeight: tactil.minimo,
        flexDirection: 'row',
        alignItems: 'center',
        gap: espacio.md,
        paddingVertical: espacio.md,
      }}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          width: tactil.casilla,
          height: tactil.casilla,
          borderRadius: radio.sm,
          borderWidth: borde.enfasis,
          alignItems: 'center',
          justifyContent: 'center',
          borderColor: seleccionable ? color.primario500 : color.neutro500,
          backgroundColor: seleccionado ? color.primario500 : seleccionable ? color.superficie : color.neutro200,
        }}
      >
        {seleccionado ? <Text style={{ color: color.superficie, fontSize: 18, lineHeight: 22 }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text style={[estiloDeTexto('subtitulo'), { color: seleccionable ? color.neutro800 : color.neutro600 }]}>{concepto}</Text>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{estado}</Text>
        {motivo ? <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>{motivo}</Text> : null}
      </View>
      {/* Sin `numberOfLines`: un importe largo nunca se corta. */}
      <Text style={[estiloDeTexto('importe'), { color: color.neutro800, flexShrink: 0 }]}>{importe}</Text>
    </Pressable>
  )
}

// ---- ResumenTotal --------------------------------------------------------------------------------------

export interface ResumenTotalProps {
  titulo: string
  /** Total ya calculado por el servidor; `null` mientras no hay cifra confiable. */
  total: Centavos | null
  leyenda?: string
  /** Contenido adicional bajo la cifra (por ejemplo, un aviso de actualización). */
  children?: ReactNode
  testID?: string
}

export function ResumenTotal({ titulo, total, leyenda, children, testID }: ResumenTotalProps): ReactElement {
  const cifra = total === null ? '—' : formatearImporte(total)
  const anterior = useRef<string | null>(null)
  useEffect(() => {
    // En Android la región viva anuncia el cambio; en iOS se anuncia explícitamente (uno u otro, no ambos).
    if (Platform.OS === 'ios' && anterior.current !== null && anterior.current !== cifra) {
      void AccessibilityInfo.announceForAccessibility(`${titulo}: ${cifra}`)
    }
    anterior.current = cifra
  }, [cifra, titulo])
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${titulo}: ${total === null ? 'sin calcular' : cifra.replace('ARS', 'pesos argentinos')}${leyenda ? `. ${leyenda}` : ''}`}
      accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : 'none'}
      style={{ backgroundColor: color.primario700, borderRadius: radio.lg, padding: espacio.lg, gap: espacio.xs }}
    >
      <Text style={[estiloDeTexto('cuerpo'), { color: color.superficie }]}>{titulo}</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={[estiloDeTexto('importeTotal'), { color: color.superficie, flexShrink: 0 }]}
      >
        {cifra}
      </Text>
      {leyenda ? <Text style={[estiloDeTexto('cuerpo'), { color: color.superficie }]}>{leyenda}</Text> : null}
      {children}
    </View>
  )
}
