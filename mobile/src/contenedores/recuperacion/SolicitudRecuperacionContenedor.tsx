import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Text } from 'react-native'

import { Aviso, CampoTexto, Formulario, MarcoPantalla, PantallaConVolver } from '@/catalogo'
import { normalizarCorreo, solicitarRecuperacion, type ResultadoSolicitud } from '@/servicios/recuperacion'
import type { ClienteEPT } from '@/servicios/supabase'
import { color, estiloDeTexto } from '@/tokens'

/**
 * Espera visible entre solicitudes desde esta pantalla. Evita el reenvío accidental; no reemplaza el límite del
 * proveedor, que Auth sigue aplicando y esta pantalla informa si lo alcanza.
 */
export const ESPERA_REENVIO_SEGUNDOS = 60

export interface SolicitudRecuperacionProps {
  cliente: Pick<ClienteEPT, 'auth'>
  onVolver: () => void
  esperaSegundos?: number
}

const MENSAJES: Record<Exclude<ResultadoSolicitud['tipo'], 'enviada' | 'correo_invalido'>, string> = {
  limite: 'Se enviaron demasiados correos en poco tiempo. Esperá unos minutos antes de volver a intentar.',
  sin_conexion: 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',
  error: 'No pudimos enviar el correo. Intentá nuevamente en unos minutos.',
}

export function SolicitudRecuperacionContenedor({
  cliente,
  onVolver,
  esperaSegundos = ESPERA_REENVIO_SEGUNDOS,
}: SolicitudRecuperacionProps): ReactElement {
  const [correo, setCorreo] = useState('')
  const [errorCorreo, setErrorCorreo] = useState<string>()
  const [aviso, setAviso] = useState<{ tipo: 'enviada' } | { tipo: 'fallo'; mensaje: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [restante, setRestante] = useState(0)
  // El estado de React llega tarde ante un doble toque rápido: la referencia cierra esa ventana.
  const enCurso = useRef(false)
  const vigente = useRef(true)

  useEffect(() => {
    vigente.current = true
    return () => {
      vigente.current = false
    }
  }, [])

  useEffect(() => {
    if (restante <= 0) return
    const temporizador = setTimeout(() => setRestante(valor => Math.max(0, valor - 1)), 1000)
    return () => clearTimeout(temporizador)
  }, [restante])

  const enviar = async () => {
    if (enCurso.current || restante > 0) return
    const normalizado = normalizarCorreo(correo)
    if (normalizado.tipo === 'vacio') return setErrorCorreo('Ingresá tu correo electrónico.')
    if (normalizado.tipo === 'invalido') return setErrorCorreo('Ingresá un correo electrónico válido.')
    enCurso.current = true
    setErrorCorreo(undefined)
    setAviso(null)
    setEnviando(true)
    try {
      const resultado = await solicitarRecuperacion(cliente.auth, normalizado.correo)
      if (!vigente.current) return
      if (resultado.tipo === 'enviada') {
        setAviso({ tipo: 'enviada' })
        setRestante(esperaSegundos)
      } else if (resultado.tipo === 'correo_invalido') {
        setErrorCorreo('Ingresá un correo electrónico válido.')
      } else {
        setAviso({ tipo: 'fallo', mensaje: MENSAJES[resultado.tipo] })
        if (resultado.tipo === 'limite') setRestante(esperaSegundos)
      }
    } finally {
      enCurso.current = false
      if (vigente.current) setEnviando(false)
    }
  }

  const enEspera = restante > 0
  return (
    <MarcoPantalla>
      <Formulario
        titulo="Recuperar contraseña"
        accionPrincipal={{
          etiqueta: aviso?.tipo === 'enviada' ? 'Reenviar enlace' : 'Enviar enlace',
          onPress: () => void enviar(),
          cargando: enviando,
          deshabilitado: enEspera,
          pistaAccesible: enEspera ? `Podés pedir otro enlace en ${restante} segundos.` : undefined,
        }}
        accionSecundaria={{ etiqueta: 'Volver al inicio de sesión', onPress: onVolver, deshabilitado: enviando }}
      >
        <PantallaConVolver onVolver={onVolver} deshabilitado={enviando}>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
          Ingresá el correo de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.
        </Text>
        <CampoTexto
          etiqueta="Correo electrónico"
          valor={correo}
          onChangeText={texto => {
            setCorreo(texto)
            setErrorCorreo(undefined)
          }}
          teclado="correo"
          accionTeclado="enviar"
          onSubmitEditing={() => void enviar()}
          placeholder="nombre@institucion.edu.ar"
          testID="recuperar-correo"
          error={errorCorreo}
          deshabilitado={enviando}
        />
        {aviso?.tipo === 'enviada' ? (
          <Aviso
            tipo="exito"
            titulo="Revisá tu correo"
            mensaje="Si el correo corresponde a una cuenta, te enviamos un enlace para restablecer la contraseña. Abrilo desde este mismo teléfono y, si pediste más de uno, usá el último. Si no lo ves, revisá la carpeta de correo no deseado."
            anuncio="estado"
          />
        ) : null}
        {aviso?.tipo === 'fallo' ? <Aviso tipo="error" titulo="No se envió el correo" mensaje={aviso.mensaje} anuncio="alerta" /> : null}
        {enEspera ? (
          <Text accessibilityLiveRegion="polite" style={[estiloDeTexto('avisoCuerpo'), { color: color.neutro600 }]}>
            Podés pedir otro enlace en {restante} s.
          </Text>
        ) : null}
        </PantallaConVolver>
      </Formulario>
    </MarcoPantalla>
  )
}
