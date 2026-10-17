import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, Boton, CampoTexto, PantallaConVolver, Tarjeta } from '@/catalogo'
import {
  actualizarContrasena,
  mensajeDeActualizacion,
  pedirCodigoDeVerificacion,
  type ResultadoActualizacion,
} from '@/servicios/recuperacion'
import type { ClienteEPT } from '@/servicios/supabase'
import { color, espacio, estiloDeTexto } from '@/tokens'

import { CamposContrasenaNueva } from './CamposContrasenaNueva'

export interface CambioContrasenaProps {
  cliente: Pick<ClienteEPT, 'auth'>
  /** Usuario autenticado y autorizado de esta pantalla: el cambio solo se aplica si la sesión sigue siendo suya. */
  usuarioId: string
  onVolver: () => void
  /** La sesión venció o cambió: se vuelve a validar el acceso. */
  onSesionExpirada: () => void
}

type Fase = 'formulario' | 'guardando' | 'exito' | 'sesion'

export function CambioContrasenaContenedor({ cliente, usuarioId, onVolver, onSesionExpirada }: CambioContrasenaProps): ReactElement {
  const [contrasena, setContrasena] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [codigo, setCodigo] = useState('')
  const [pideCodigo, setPideCodigo] = useState(false)
  const [fase, setFase] = useState<Fase>('formulario')
  const [errorCampo, setErrorCampo] = useState<{ contrasena?: string; confirmacion?: string; codigo?: string }>({})
  const [mensaje, setMensaje] = useState<{ tipo: 'error' | 'informativo'; texto: string } | null>(null)
  const [enviandoCodigo, setEnviandoCodigo] = useState(false)
  // El doble toque llega antes de que React publique `guardando`: la referencia cierra esa ventana.
  const enCurso = useRef(false)
  const vigente = useRef(true)

  useEffect(() => {
    vigente.current = true
    return () => {
      vigente.current = false
    }
  }, [])

  const mandarCodigo = async () => {
    if (enCurso.current) return
    enCurso.current = true
    setEnviandoCodigo(true)
    setMensaje(null)
    const resultado = await pedirCodigoDeVerificacion(cliente.auth)
    enCurso.current = false
    if (!vigente.current) return
    setEnviandoCodigo(false)
    if (resultado.tipo === 'enviado') {
      setMensaje({ tipo: 'informativo', texto: 'Te enviamos un código de verificación por correo. Ingresalo para confirmar el cambio.' })
    } else if (resultado.tipo === 'sesion_expirada') {
      setFase('sesion')
    } else {
      setMensaje({
        tipo: 'error',
        texto: resultado.tipo === 'limite'
          ? 'Se enviaron demasiados correos en poco tiempo. Esperá unos minutos antes de pedir otro código.'
          : resultado.tipo === 'sin_conexion'
            ? 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.'
            : 'No pudimos enviar el código. Intentá nuevamente.',
      })
    }
  }

  const guardar = async () => {
    if (enCurso.current) return
    const errores: { contrasena?: string; confirmacion?: string; codigo?: string } = {}
    if (contrasena.length === 0) errores.contrasena = 'Ingresá la nueva contraseña.'
    else if (contrasena !== confirmacion) errores.confirmacion = 'Las contraseñas no coinciden.'
    if (pideCodigo && codigo.trim().length === 0) errores.codigo = 'Ingresá el código que te enviamos por correo.'
    setErrorCampo(errores)
    if (errores.contrasena || errores.confirmacion || errores.codigo) return

    enCurso.current = true
    setFase('guardando')
    setMensaje(null)
    const resultado: ResultadoActualizacion = await actualizarContrasena(cliente.auth, contrasena, {
      usuarioEsperado: usuarioId,
      nonce: pideCodigo ? codigo.trim() : undefined,
    })
    enCurso.current = false
    if (!vigente.current) return
    if (resultado.tipo === 'ok') {
      setContrasena('')
      setConfirmacion('')
      setCodigo('')
      return setFase('exito')
    }
    if (resultado.tipo === 'sesion_expirada' || resultado.tipo === 'usuario_distinto') {
      setContrasena('')
      setConfirmacion('')
      return setFase('sesion')
    }
    setFase('formulario')
    if (resultado.tipo === 'reautenticar') {
      setPideCodigo(true)
      void mandarCodigo()
      return
    }
    setMensaje({ tipo: 'error', texto: mensajeDeActualizacion(resultado) })
  }

  if (fase === 'exito') {
    return (
      <PantallaConVolver onVolver={onVolver}>
        <Tarjeta>
          <Aviso tipo="exito" titulo="Contraseña actualizada" mensaje="Desde ahora ingresás con la contraseña nueva." anuncio="estado" />
          <Boton etiqueta="Volver a Mi cuenta" onPress={onVolver} />
        </Tarjeta>
      </PantallaConVolver>
    )
  }

  if (fase === 'sesion') {
    return (
      <PantallaConVolver onVolver={onSesionExpirada}>
        <Tarjeta>
          <Aviso tipo="advertencia" titulo="Tu sesión cambió" mensaje="No se modificó ninguna contraseña. Volvé a iniciar sesión para continuar." anuncio="alerta" />
          <Boton etiqueta="Continuar" onPress={onSesionExpirada} />
        </Tarjeta>
      </PantallaConVolver>
    )
  }

  const guardando = fase === 'guardando'
  return (
    <PantallaConVolver onVolver={onVolver} deshabilitado={guardando}>
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>Cambiar contraseña</Text>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
          Elegí una contraseña nueva para tu cuenta. Tus datos y vínculos no cambian.
        </Text>
        <CamposContrasenaNueva
          prefijoId="cambio"
          contrasena={contrasena}
          confirmacion={confirmacion}
          onContrasena={texto => { setContrasena(texto); setErrorCampo(e => ({ ...e, contrasena: undefined })) }}
          onConfirmacion={texto => { setConfirmacion(texto); setErrorCampo(e => ({ ...e, confirmacion: undefined })) }}
          onEnviar={() => void guardar()}
          errorContrasena={errorCampo.contrasena}
          errorConfirmacion={errorCampo.confirmacion}
          deshabilitado={guardando}
        />
        {pideCodigo ? (
          <View style={{ gap: espacio.sm }}>
            <CampoTexto
              etiqueta="Código de verificación"
              valor={codigo}
              onChangeText={texto => { setCodigo(texto); setErrorCampo(e => ({ ...e, codigo: undefined })) }}
              error={errorCampo.codigo}
              teclado="numerico"
              accionTeclado="listo"
              testID="cambio-codigo"
              deshabilitado={guardando}
            />
            <Boton etiqueta="Reenviar código" variante="enlace" onPress={() => void mandarCodigo()} cargando={enviandoCodigo} deshabilitado={guardando} />
          </View>
        ) : null}
        {mensaje ? (
          <Aviso
            tipo={mensaje.tipo === 'error' ? 'error' : 'informativo'}
            titulo={mensaje.tipo === 'error' ? 'No se cambió la contraseña' : undefined}
            mensaje={mensaje.texto}
            anuncio={mensaje.tipo === 'error' ? 'alerta' : 'estado'}
          />
        ) : null}
        <Boton etiqueta="Guardar contraseña" onPress={() => void guardar()} cargando={guardando} testID="cambio-guardar" />
        <Boton etiqueta="Cancelar" variante="secundario" onPress={onVolver} deshabilitado={guardando} />
      </Tarjeta>
    </PantallaConVolver>
  )
}
