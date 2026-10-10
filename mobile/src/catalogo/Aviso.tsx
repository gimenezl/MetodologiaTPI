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

const PALETA: Record<TipoAviso, { fondo: string; texto: string; barra: string }> = {
  informativo: { fondo: color.primario50, texto: color.primario700, barra: color.primario500 },
  advertencia: { fondo: color.advertenciaFondo, texto: color.advertenciaTexto, barra: color.advertencia },
  error: { fondo: color.peligroFondo, texto: color.peligroTexto, barra: color.peligro },
  exito: { fondo: color.exitoFondo, texto: color.exitoTexto, barra: color.exito },
}

/** El tipo se comunica con el texto del título/mensaje y la barra lateral; el color nunca es el único canal. */
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
      {titulo ? <Text style={[estiloDeTexto('avisoTitulo'), { color: paleta.texto }]}>{titulo}</Text> : null}
      <Text style={[estiloDeTexto('avisoCuerpo'), { color: paleta.texto }]}>{mensaje}</Text>
    </View>
  )
}
