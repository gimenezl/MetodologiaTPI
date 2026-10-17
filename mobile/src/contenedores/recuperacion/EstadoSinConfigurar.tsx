import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, MarcoPantalla } from '@/catalogo'
import { color, espacio, estiloDeTexto } from '@/tokens'

/** Pantalla de las rutas de recuperación cuando la configuración pública no permite crear el cliente de Auth. */
export function EstadoSinConfigurar(): ReactElement {
  return (
    <MarcoPantalla>
      <View style={{ flex: 1, padding: espacio.xl, justifyContent: 'center' }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>Aplicación no configurada</Text>
        <Aviso tipo="advertencia" titulo="Falta configuración pública" mensaje="No se pudo inicializar el servicio de autenticación." anuncio="alerta" />
      </View>
    </MarcoPantalla>
  )
}
