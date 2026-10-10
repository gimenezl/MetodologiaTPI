import type { ReactElement, ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import { borde, color, espacio, estiloDeTexto, radio, tactil } from '@/tokens'

export type VarianteBoton = 'primario' | 'secundario' | 'enlace'

export interface BotonProps {
  /** Texto visible. Siempre en español y siempre presente. */
  etiqueta: string
  /** Una vez por toque. No se invoca si `deshabilitado` o `cargando`. */
  onPress: () => void
  variante?: VarianteBoton
  /** Acción no disponible ahora. El motivo debe estar visible cerca del botón (lo aporta la pantalla). */
  deshabilitado?: boolean
  /** Hay una operación en curso: bloquea el toque y evita envíos duplicados. */
  cargando?: boolean
  /** Se anuncia como pista: qué hará el botón o por qué está bloqueado. */
  pistaAccesible?: string
  /** Solo si la lectura del lector de pantalla debe diferir del texto visible. */
  etiquetaAccesible?: string
  /** Ícono decorativo opcional a la izquierda. Nunca porta información. */
  icono?: ReactNode
  testID?: string
}

export function Boton({
  etiqueta,
  onPress,
  variante = 'primario',
  deshabilitado = false,
  cargando = false,
  pistaAccesible,
  etiquetaAccesible,
  icono,
  testID,
}: BotonProps): ReactElement {
  const bloqueado = deshabilitado || cargando
  const esEnlace = variante === 'enlace'

  return (
    <Pressable
      testID={testID}
      accessibilityRole={esEnlace ? 'link' : 'button'}
      accessibilityLabel={etiquetaAccesible}
      accessibilityHint={pistaAccesible}
      accessibilityState={{ disabled: bloqueado, busy: cargando }}
      // `disabled` no oculta el botón al lector de pantalla: lo anuncia como no disponible y bloquea el toque.
      disabled={bloqueado}
      onPress={bloqueado ? undefined : onPress}
      style={({ pressed }) => {
        if (esEnlace) {
          return { minHeight: tactil.minimo, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 }
        }
        const primario = variante === 'primario'
        const fondo = deshabilitado
          ? color.neutro200
          : primario
            ? pressed
              ? color.primario600
              : color.primario500
            : pressed
              ? color.primario50
              : color.superficie
        return {
          minHeight: tactil.minimo,
          paddingVertical: espacio.md,
          paddingHorizontal: espacio.xl,
          borderRadius: radio.md,
          borderWidth: borde.control,
          borderColor: deshabilitado ? color.neutro300 : primario && pressed ? color.primario600 : color.primario500,
          backgroundColor: fondo,
          alignItems: 'center',
          justifyContent: 'center',
        }
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: espacio.sm }}>
        {cargando ? (
          <ActivityIndicator
            animating
            size="small"
            color={variante === 'primario' ? color.superficie : color.primario700}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : (
          icono
        )}
        <Text
          style={[
            estiloDeTexto('boton'),
            {
              textAlign: 'center',
              flexShrink: 1,
              color: esEnlace
                ? color.primario600
                : deshabilitado
                  ? color.neutro700
                  : variante === 'primario'
                    ? color.superficie
                    : color.primario700,
              textDecorationLine: esEnlace ? 'underline' : 'none',
            },
          ]}
        >
          {etiqueta}
        </Text>
      </View>
    </Pressable>
  )
}
