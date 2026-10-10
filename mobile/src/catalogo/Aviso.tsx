import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { borde, color, espacio, estiloDeTexto, radio } from '@/tokens'

export type TipoAviso = 'informativo' | 'advertencia' | 'error' | 'exito'

export interface AvisoProps {
  tipo: TipoAviso
  /** Primera línea en negrita, por ejemplo «No pudimos iniciar sesión.». */
  titulo?: string
  mensaje: string
  /** `alerta`: interrumpe (errores y bloqueos). `estado`: educado, sin interrumpir. Omitido: no se anuncia. */
  anuncio?: 'alerta' | 'estado'
  testID?: string
}

const PALETA: Record<TipoAviso, { fondo: string; texto: string; barra: string; glifo: string }> = {
  informativo: { fondo: color.primario50, texto: color.primario700, barra: color.primario500, glifo: 'i' },
  advertencia: { fondo: color.advertenciaFondo, texto: color.advertenciaTexto, barra: color.advertencia, glifo: '!' },
  error: { fondo: color.peligroFondo, texto: color.peligroTexto, barra: color.peligro, glifo: '×' },
  exito: { fondo: color.exitoFondo, texto: color.exitoTexto, barra: color.exito, glifo: '✓' },
}

/** El tipo se comunica con un glifo decorativo distinto por tipo, el texto y la barra lateral; el color no es el único canal. */
export function Aviso({ tipo, titulo, mensaje, anuncio, testID }: AvisoProps): ReactElement {
  const paleta = PALETA[tipo]
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={anuncio === 'alerta' ? 'alert' : undefined}
      accessibilityLiveRegion={anuncio === 'alerta' ? 'assertive' : anuncio === 'estado' ? 'polite' : 'none'}
      style={{
        backgroundColor: paleta.fondo,
        borderLeftWidth: borde.estado,
        borderLeftColor: paleta.barra,
        borderRadius: radio.md,
        paddingVertical: espacio.md,
        paddingHorizontal: espacio.lg,
        gap: espacio.xs,
      }}
    >
      <View style={{ flexDirection: 'row', gap: espacio.sm }}>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[estiloDeTexto('avisoTitulo'), { color: paleta.texto, width: 18, textAlign: 'center' }]}
        >
          {paleta.glifo}
        </Text>
        <View style={{ flex: 1, gap: espacio.xs }}>
          {titulo ? <Text style={[estiloDeTexto('avisoTitulo'), { color: paleta.texto }]}>{titulo}</Text> : null}
          <Text style={[estiloDeTexto('avisoCuerpo'), { color: paleta.texto }]}>{mensaje}</Text>
        </View>
      </View>
    </View>
  )
}
