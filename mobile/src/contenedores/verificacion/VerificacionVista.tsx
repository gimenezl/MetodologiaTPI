import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, CampoTexto, Formulario, Importe, InsigniaEstado, MarcoPantalla, Tarjeta } from '@/catalogo'
import { color, espacio, estiloDeTexto } from '@/tokens'

export type EstadoSesionVista = 'no_configurada' | 'consultando' | 'sin_sesion' | 'con_sesion'
export type ResultadoVista = { tipo: 'ninguno' } | { tipo: 'ok'; bytes: number } | { tipo: 'fallo' }

export interface VerificacionVistaProps {
  entornoValido: boolean
  motivosEntorno: readonly string[]
  estadoSesion: EstadoSesionVista
  tamanoKb: string
  errorTamano?: string
  resultado: ResultadoVista
  ejecutando: boolean
  onCambiarTamano: (texto: string) => void
  onEjecutar: () => void
}

const TEXTO_SESION: Record<EstadoSesionVista, string> = {
  no_configurada: 'Sin configurar',
  consultando: 'Consultando…',
  sin_sesion: 'Sin sesión en este dispositivo',
  con_sesion: 'Sesión activa',
}

/** Vista presentacional: recibe todo ya decidido. No importa servicios, hooks de datos ni navegación. */
export function VerificacionVista(props: VerificacionVistaProps): ReactElement {
  return (
    <MarcoPantalla>
      <Formulario
        titulo="Verificación de la base móvil"
        resumenErrores={props.errorTamano ? 'Revisá los datos marcados para continuar.' : undefined}
        accionPrincipal={{
          etiqueta: 'Guardar y leer',
          onPress: props.onEjecutar,
          cargando: props.ejecutando,
        }}
      >
        <Aviso
          tipo="informativo"
          titulo="Pantalla de desarrollo"
          mensaje="Comprueba la infraestructura de la aplicación. No es una pantalla funcional ni muestra datos reales."
        />
        {props.entornoValido ? null : (
          <Aviso
            tipo="advertencia"
            titulo="Configuración pública incompleta"
            mensaje={props.motivosEntorno.join(' ')}
            anuncio="estado"
          />
        )}
        <Tarjeta>
          <Text style={[estiloDeTexto('seccion'), { color: color.neutro700 }]}>Sesión del dispositivo</Text>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro800 }]}>{TEXTO_SESION[props.estadoSesion]}</Text>
        </Tarjeta>
        <Tarjeta>
          <Text style={[estiloDeTexto('seccion'), { color: color.neutro700 }]}>Componentes institucionales</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: espacio.sm }}>
            <InsigniaEstado dominio="factura" estado="pendiente" />
            <InsigniaEstado dominio="factura" estado="vencida" />
            <Importe centavos={6360665} />
          </View>
        </Tarjeta>
        <CampoTexto
          testID="campo-tamano"
          etiqueta="Tamaño de la carga de prueba (KB)"
          valor={props.tamanoKb}
          onChangeText={props.onCambiarTamano}
          error={props.errorTamano}
          ayuda="Una sesión real ocupa varios KB: se guarda cifrada en fragmentos."
          teclado="numerico"
          accionTeclado="listo"
          onSubmitEditing={props.ejecutando ? undefined : props.onEjecutar}
        />
        {props.resultado.tipo === 'ok' ? (
          <Aviso
            tipo="exito"
            titulo="Almacenamiento seguro: correcto"
            mensaje={`Se guardó, leyó y borró una carga de ${props.resultado.bytes} caracteres.`}
            anuncio="estado"
          />
        ) : null}
        {props.resultado.tipo === 'fallo' ? (
          <Aviso
            tipo="error"
            titulo="Almacenamiento seguro: falló"
            mensaje="No se pudo completar la verificación en este dispositivo."
            anuncio="alerta"
          />
        ) : null}
      </Formulario>
    </MarcoPantalla>
  )
}
