import { useState, type ReactElement } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { borde, color, espacio, estiloDeTexto, radio, tactil } from '@/tokens'

export type TecladoCampo = 'texto' | 'correo' | 'numerico' | 'decimal'
export type AccionTeclado = 'siguiente' | 'enviar' | 'listo'

export interface CampoTextoProps {
  /** Etiqueta persistente visible. No se reemplaza por placeholder. */
  etiqueta: string
  valor: string
  /** Campo controlado: el contenedor posee el valor. */
  onChangeText: (texto: string) => void
  onSubmitEditing?: () => void
  onBlur?: () => void
  /** Mensaje de error ya redactado en español. Su presencia activa el estado de error. */
  error?: string
  /** Texto de ayuda persistente bajo el campo. */
  ayuda?: string
  placeholder?: string
  teclado?: TecladoCampo
  secreto?: boolean
  /** Control «Mostrar» de la contraseña. Solo se informa en campos `secreto`. */
  controlMostrar?: { visible: boolean; onToggle: () => void }
  deshabilitado?: boolean
  accionTeclado?: AccionTeclado
  testID?: string
}

const MODO_ENTRADA = { texto: 'text', correo: 'email', numerico: 'numeric', decimal: 'decimal' } as const
const TECLA_ACCION = { siguiente: 'next', enviar: 'send', listo: 'done' } as const

export function CampoTexto({
  etiqueta,
  valor,
  onChangeText,
  onSubmitEditing,
  onBlur,
  error,
  ayuda,
  placeholder,
  teclado = 'texto',
  secreto = false,
  controlMostrar,
  deshabilitado = false,
  accionTeclado,
  testID,
}: CampoTextoProps): ReactElement {
  const [enFoco, setEnFoco] = useState(false)
  const conError = Boolean(error)
  const idEtiqueta = `${testID ?? etiqueta}-etiqueta`
  const pista = [error, ayuda].filter(Boolean).join(' ') || undefined
  const ocultar = secreto && !(controlMostrar?.visible ?? false)

  return (
    <View style={{ gap: 6 }}>
      <Text nativeID={idEtiqueta} style={[estiloDeTexto('etiquetaCampo'), { color: color.neutro800 }]}>
        {etiqueta}
      </Text>
      <View
        style={{
          // El halo de foco se dibuja con un contenedor: no existe `outline` en nativo.
          padding: enFoco ? 4 : 0,
          margin: enFoco ? -4 : 0,
          borderRadius: radio.md + 4,
          backgroundColor: enFoco ? color.primario200 : 'transparent',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: tactil.minimo,
            borderWidth: borde.control,
            borderRadius: radio.md,
            borderColor: conError ? color.peligro : enFoco ? color.primario500 : color.neutro500,
            backgroundColor: deshabilitado ? color.neutro100 : conError ? color.peligroFondo : color.superficie,
          }}
        >
          <TextInput
            testID={testID}
            value={valor}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmitEditing}
            onFocus={() => setEnFoco(true)}
            onBlur={() => {
              setEnFoco(false)
              onBlur?.()
            }}
            editable={!deshabilitado}
            placeholder={placeholder}
            placeholderTextColor={color.neutro600}
            inputMode={MODO_ENTRADA[teclado]}
            autoCapitalize={teclado === 'correo' || secreto ? 'none' : undefined}
            autoCorrect={teclado === 'correo' || secreto ? false : undefined}
            autoComplete={teclado === 'correo' ? 'email' : secreto ? 'current-password' : 'off'}
            secureTextEntry={ocultar}
            returnKeyType={accionTeclado ? TECLA_ACCION[accionTeclado] : undefined}
            submitBehavior={accionTeclado === 'siguiente' ? 'submit' : accionTeclado ? 'blurAndSubmit' : undefined}
            accessibilityLabel={etiqueta}
            accessibilityHint={pista}
            accessibilityLabelledBy={idEtiqueta}
            accessibilityState={{ disabled: deshabilitado }}
            style={[
              estiloDeTexto('cuerpo'),
              {
                flex: 1,
                minHeight: tactil.minimo - borde.control * 2,
                paddingVertical: 10,
                paddingHorizontal: 14,
                color: deshabilitado ? color.neutro600 : color.neutro800,
              },
            ]}
          />
          {secreto && controlMostrar ? (
            <Pressable
              onPress={controlMostrar.onToggle}
              accessibilityRole="button"
              accessibilityLabel={controlMostrar.visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={{ minHeight: tactil.minimo, minWidth: tactil.minimo, justifyContent: 'center', paddingHorizontal: espacio.md }}
            >
              <Text style={[estiloDeTexto('seccion'), { color: color.primario600 }]}>
                {controlMostrar.visible ? 'Ocultar' : 'Mostrar'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {ayuda ? <Text style={[estiloDeTexto('avisoCuerpo'), { color: color.neutro600 }]}>{ayuda}</Text> : null}
      {error ? <Text style={[estiloDeTexto('aviso'), { color: color.peligroTexto }]}>{error}</Text> : null}
    </View>
  )
}
