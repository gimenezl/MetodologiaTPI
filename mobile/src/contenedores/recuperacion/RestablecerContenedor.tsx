import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Text } from 'react-native'

import { Aviso, EstadoPantalla, Formulario, MarcoPantalla } from '@/catalogo'
import { interpretarEnlace } from '@/servicios/recuperacion'
import {
  ControladorRecuperacion,
  type CausaEnlaceNoValido,
  type EstadoRecuperacion,
} from '@/servicios/recuperacion-controlador'
import { vincularCicloDeVida, type ClienteEPT } from '@/servicios/supabase'
import { color, estiloDeTexto } from '@/tokens'

import { CamposContrasenaNueva } from './CamposContrasenaNueva'

export interface RestablecerProps {
  cliente: ClienteEPT
  /** Enlace recibido (arranque en frío o aplicación abierta). `null`: la aplicación no se abrió con un enlace. */
  url: string | null
  /** Vuelve al inicio de sesión. Se llama después de liberar la compuerta de recuperación. */
  onTerminar: () => void
  /** Abre la pantalla para pedir un enlace nuevo. */
  onSolicitarNuevo: () => void
}

const TEXTO_NO_VALIDO: Record<CausaEnlaceNoValido, string> = {
  expirado: 'El enlace venció. Pedí uno nuevo para continuar.',
  invalido: 'El enlace no es válido o está incompleto. Pedí uno nuevo para continuar.',
  no_admitido: 'Este enlace no corresponde a la recuperación de contraseña.',
  usado: 'Este enlace ya se utilizó o venció. Pedí uno nuevo para continuar.',
  sin_verificador: 'No pudimos verificar el enlace en este teléfono. Pedí uno nuevo desde esta aplicación y abrilo aquí.',
  sin_conexion: 'No pudimos completar la verificación por un problema de conexión. Pedí un enlace nuevo.',
  no_es_recuperacion: 'Este enlace no sirve para restablecer la contraseña. Pedí uno nuevo.',
  sesion_vencida: 'La verificación venció antes de guardar la contraseña. No se modificó nada: pedí un enlace nuevo.',
  error: 'No pudimos verificar el enlace. Pedí uno nuevo para continuar.',
}

export function RestablecerContenedor({ cliente, url, onTerminar, onSolicitarNuevo }: RestablecerProps): ReactElement {
  const [estado, setEstado] = useState<EstadoRecuperacion>({ tipo: 'iniciando' })
  const controlador = useMemo(() => new ControladorRecuperacion(cliente, setEstado), [cliente])
  const enlace = useMemo(() => (url === null ? null : interpretarEnlace(url)), [url])

  // El refresco de la sesión sigue al primer plano también cuando la app arranca directamente en esta pantalla.
  useEffect(() => vincularCicloDeVida(cliente), [cliente])

  useEffect(() => {
    controlador.iniciar()
    return () => controlador.detener()
  }, [controlador])

  useEffect(() => {
    if (enlace === null) return
    void controlador.procesarEnlace(enlace)
  }, [controlador, enlace])

  const terminar = () => {
    controlador.detener()
    onTerminar()
  }
  const solicitarNuevo = () => {
    controlador.detener()
    onSolicitarNuevo()
  }

  if (enlace === null) {
    return (
      <MarcoPantalla>
        <Formulario titulo="Restablecer contraseña" accionPrincipal={{ etiqueta: 'Pedir un enlace nuevo', onPress: solicitarNuevo }} accionSecundaria={{ etiqueta: 'Volver al inicio de sesión', onPress: terminar }}>
          <Aviso tipo="advertencia" titulo="No hay un enlace para continuar" mensaje="Abrí el enlace del correo desde este teléfono o pedí uno nuevo." anuncio="alerta" />
        </Formulario>
      </MarcoPantalla>
    )
  }

  if (estado.tipo === 'iniciando' || estado.tipo === 'verificando') {
    return <MarcoPantalla><EstadoPantalla tipo="cargando" mensaje="Verificando el enlace…" /></MarcoPantalla>
  }

  if (estado.tipo === 'confirmar_reemplazo') {
    return (
      <MarcoPantalla>
        <Formulario
          titulo="Hay una sesión iniciada"
          accionPrincipal={{ etiqueta: 'Cerrar esa sesión y continuar', onPress: () => void controlador.confirmarReemplazo() }}
          accionSecundaria={{ etiqueta: 'Cancelar', onPress: terminar }}
        >
          <Aviso
            tipo="advertencia"
            titulo="Se reemplazará la sesión actual"
            mensaje="Este enlace corresponde a la cuenta que pidió restablecer su contraseña. Si continuás, se cierra la sesión que está abierta en este teléfono. Si cancelás, no cambia nada."
            anuncio="alerta"
          />
        </Formulario>
      </MarcoPantalla>
    )
  }

  if (estado.tipo === 'enlace_no_valido') {
    return (
      <MarcoPantalla>
        <Formulario titulo="No pudimos usar el enlace" accionPrincipal={{ etiqueta: 'Pedir un enlace nuevo', onPress: solicitarNuevo }} accionSecundaria={{ etiqueta: 'Volver al inicio de sesión', onPress: terminar }}>
          <Aviso tipo="error" titulo="Enlace no disponible" mensaje={TEXTO_NO_VALIDO[estado.causa]} anuncio="alerta" />
        </Formulario>
      </MarcoPantalla>
    )
  }

  if (estado.tipo === 'exito') {
    return (
      <MarcoPantalla>
        <Formulario titulo="Contraseña actualizada" accionPrincipal={{ etiqueta: 'Ir a iniciar sesión', onPress: terminar }}>
          <Aviso tipo="exito" titulo="Listo" mensaje="Tu contraseña se cambió. Iniciá sesión con la contraseña nueva." anuncio="estado" />
        </Formulario>
      </MarcoPantalla>
    )
  }

  return (
    <FormularioNuevaContrasena
      guardando={estado.tipo === 'guardando'}
      error={estado.tipo === 'formulario' ? estado.error : undefined}
      onGuardar={(contrasena, confirmacion) => void controlador.guardar(contrasena, confirmacion)}
      onCancelar={terminar}
    />
  )
}

interface FormularioNuevaContrasenaProps {
  guardando: boolean
  error?: string
  onGuardar: (contrasena: string, confirmacion: string) => void
  onCancelar: () => void
}

/**
 * Los campos viven aquí: cuando el flujo termina (éxito o enlace no válido) este componente se desmonta y la
 * contraseña escrita desaparece junto con él.
 */
function FormularioNuevaContrasena({ guardando, error, onGuardar, onCancelar }: FormularioNuevaContrasenaProps): ReactElement {
  const [contrasena, setContrasena] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  return (
    <MarcoPantalla>
      <Formulario
        titulo="Elegí una contraseña nueva"
        resumenErrores={error ? 'No se pudo guardar la contraseña.' : undefined}
        accionPrincipal={{ etiqueta: 'Guardar contraseña', onPress: () => onGuardar(contrasena, confirmacion), cargando: guardando }}
        accionSecundaria={{ etiqueta: 'Cancelar', onPress: onCancelar, deshabilitado: guardando }}
      >
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
          Elegí la contraseña con la que vas a ingresar a la aplicación.
        </Text>
        <CamposContrasenaNueva
          prefijoId="restablecer"
          contrasena={contrasena}
          confirmacion={confirmacion}
          onContrasena={setContrasena}
          onConfirmacion={setConfirmacion}
          onEnviar={() => onGuardar(contrasena, confirmacion)}
          deshabilitado={guardando}
        />
        {error ? <Aviso tipo="error" titulo="No se guardó la contraseña" mensaje={error} anuncio="alerta" /> : null}
      </Formulario>
    </MarcoPantalla>
  )
}
