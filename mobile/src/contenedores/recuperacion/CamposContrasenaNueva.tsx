import { useState, type ReactElement } from 'react'

import { CampoTexto } from '@/catalogo'

export interface CamposContrasenaNuevaProps {
  contrasena: string
  confirmacion: string
  onContrasena: (texto: string) => void
  onConfirmacion: (texto: string) => void
  /** Se invoca al confirmar con el teclado desde el segundo campo. */
  onEnviar: () => void
  errorContrasena?: string
  errorConfirmacion?: string
  deshabilitado?: boolean
  prefijoId: string
}

/**
 * Nueva contraseña + confirmación con «Mostrar/Ocultar». La contraseña se entrega tal como se escribió:
 * no se recorta, no se normaliza y no se guarda fuera del estado del formulario.
 */
export function CamposContrasenaNueva({
  contrasena,
  confirmacion,
  onContrasena,
  onConfirmacion,
  onEnviar,
  errorContrasena,
  errorConfirmacion,
  deshabilitado = false,
  prefijoId,
}: CamposContrasenaNuevaProps): ReactElement {
  const [visible, setVisible] = useState(false)
  const control = { visible, onToggle: () => setVisible(v => !v) }
  return (
    <>
      <CampoTexto
        etiqueta="Nueva contraseña"
        valor={contrasena}
        onChangeText={onContrasena}
        error={errorContrasena}
        secreto
        contrasenaNueva
        controlMostrar={control}
        accionTeclado="siguiente"
        testID={`${prefijoId}-nueva`}
        deshabilitado={deshabilitado}
      />
      <CampoTexto
        etiqueta="Repetí la nueva contraseña"
        valor={confirmacion}
        onChangeText={onConfirmacion}
        error={errorConfirmacion}
        secreto
        contrasenaNueva
        controlMostrar={control}
        accionTeclado="enviar"
        onSubmitEditing={onEnviar}
        testID={`${prefijoId}-confirmacion`}
        deshabilitado={deshabilitado}
      />
    </>
  )
}
