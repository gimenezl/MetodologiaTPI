import type { ReactElement, ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { borde, color, espacio, estiloDeTexto, radio } from '@/tokens'

import { Aviso } from './Aviso'
import { Boton } from './Boton'
import { formatearImporte, type Centavos } from './importe'

// ---- Importe -------------------------------------------------------------------------------------------

export function Importe({ centavos, total = false }: { centavos: Centavos; total?: boolean }): ReactElement {
  // Sin `numberOfLines` y sin partir: la fila que lo contiene admite `flexWrap`.
  return (
    <Text
      style={[estiloDeTexto(total ? 'importeTotal' : 'importe'), { color: color.neutro800, flexShrink: 0 }]}
      accessibilityLabel={formatearImporte(centavos).replace('ARS', 'pesos argentinos').replace(/ /gu, ' ')}
    >
      {formatearImporte(centavos)}
    </Text>
  )
}

// ---- InsigniaEstado ------------------------------------------------------------------------------------

export type InsigniaEstadoProps =
  | { dominio: 'factura'; estado: 'pendiente' | 'parcial' | 'pagada' | 'vencida' }
  | { dominio: 'item'; estado: 'pagado' | 'verificacion' | 'pendiente' }
  | { dominio: 'pago'; estado: 'aprobado' | 'pendiente' | 'rechazado' }

interface VarianteInsignia {
  texto: string
  glifo: string
  fondo: string
  tinta: string
  borde: string
  trazo: 'solid' | 'dotted'
  grueso?: boolean
}

const PENDIENTE: VarianteInsignia = { texto: 'Pendiente', glifo: '◷', fondo: color.primario50, tinta: color.primario700, borde: color.primario500, trazo: 'dotted' }
const PAGADA: VarianteInsignia = { texto: 'Pagada', glifo: '✓', fondo: color.exitoFondo, tinta: color.exitoTexto, borde: color.exitoTexto, trazo: 'solid' }
const VERIFICACION: VarianteInsignia = { texto: 'En verificación', glifo: '◉', fondo: color.neutro100, tinta: color.neutro700, borde: color.neutro600, trazo: 'dotted' }
const VENCIDA: VarianteInsignia = { texto: 'Vencida', glifo: '!', fondo: color.peligroFondo, tinta: color.peligroTexto, borde: color.peligroTexto, trazo: 'solid', grueso: true }

function variante(p: InsigniaEstadoProps): VarianteInsignia {
  if (p.dominio === 'factura') {
    if (p.estado === 'pendiente') return PENDIENTE
    if (p.estado === 'pagada') return PAGADA
    if (p.estado === 'vencida') return VENCIDA
    return { texto: 'Pago parcial', glifo: '◐', fondo: color.advertenciaFondo, tinta: color.advertenciaTexto, borde: color.advertenciaTexto, trazo: 'solid' }
  }
  if (p.dominio === 'item') {
    if (p.estado === 'pagado') return { ...PAGADA, texto: 'Pagado' }
    if (p.estado === 'verificacion') return VERIFICACION
    return PENDIENTE
  }
  if (p.estado === 'aprobado') return { ...PAGADA, texto: 'Aprobado' }
  if (p.estado === 'rechazado') return { ...VENCIDA, texto: 'Rechazado' }
  return { ...VERIFICACION, texto: 'Pendiente de verificación' }
}

/** Texto + glifo + trazo + color: el estado nunca depende solo del color. */
export function InsigniaEstado(props: InsigniaEstadoProps): ReactElement {
  const v = variante(props)
  return (
    <View
      accessible
      accessibilityLabel={`Estado: ${v.texto}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radio.pastilla,
        borderWidth: v.grueso ? borde.enfasis : borde.insignia,
        borderStyle: v.trazo,
        borderColor: v.borde,
        backgroundColor: v.fondo,
      }}
    >
      <Text importantForAccessibility="no" accessibilityElementsHidden style={{ color: v.tinta, fontSize: 14 }}>
        {v.glifo}
      </Text>
      <Text style={[estiloDeTexto('insignia'), { color: v.tinta }]}>{v.texto}</Text>
    </View>
  )
}

// ---- Tarjeta -------------------------------------------------------------------------------------------

export function Tarjeta({ children }: { children: ReactNode }): ReactElement {
  return (
    <View
      style={{
        backgroundColor: color.superficie,
        borderRadius: radio.lg,
        borderWidth: borde.fino,
        borderColor: color.neutro200,
        padding: espacio.lg,
        gap: espacio.md,
      }}
    >
      {children}
    </View>
  )
}

// ---- EstadoPantalla ------------------------------------------------------------------------------------

export type EstadoPantallaProps =
  | { tipo: 'cargando'; mensaje: string }
  | { tipo: 'vacio'; titulo: string; descripcion?: string }
  | { tipo: 'error'; titulo: string; descripcion: string; onReintentar?: () => void }

export function EstadoPantalla(props: EstadoPantallaProps): ReactElement {
  if (props.tipo === 'cargando') {
    return (
      <View accessible accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} style={{ alignItems: 'center', gap: espacio.md, padding: espacio.xl }}>
        <ActivityIndicator size="large" color={color.primario500} />
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700, textAlign: 'center' }]}>{props.mensaje}</Text>
      </View>
    )
  }
  if (props.tipo === 'vacio') {
    return (
      <View style={{ alignItems: 'center', gap: espacio.sm, padding: espacio.xl }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('subtitulo'), { color: color.neutro800, textAlign: 'center' }]}>
          {props.titulo}
        </Text>
        {props.descripcion ? (
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700, textAlign: 'center' }]}>{props.descripcion}</Text>
        ) : null}
      </View>
    )
  }
  return (
    <View style={{ gap: espacio.md, padding: espacio.xl }}>
      <Aviso tipo="error" titulo={props.titulo} mensaje={props.descripcion} anuncio="alerta" />
      {props.onReintentar ? <Boton etiqueta="Reintentar" onPress={props.onReintentar} /> : null}
    </View>
  )
}

// ---- MarcoPantalla y Formulario ------------------------------------------------------------------------

/** Marco de pantalla: aplica áreas seguras una sola vez (no por pieza). */
export function MarcoPantalla({ children }: { children: ReactNode }): ReactElement {
  return <SafeAreaView style={{ flex: 1, backgroundColor: color.neutro50 }}>{children}</SafeAreaView>
}

export interface AccionFormulario {
  etiqueta: string
  onPress: () => void
  deshabilitado?: boolean
  cargando?: boolean
  pistaAccesible?: string
}

export interface FormularioProps {
  titulo?: string
  /** Presente solo si hay errores. */
  resumenErrores?: string
  accionPrincipal: AccionFormulario
  accionSecundaria?: AccionFormulario
  children: ReactNode
}

export function Formulario({ titulo, resumenErrores, accionPrincipal, accionSecundaria, children }: FormularioProps): ReactElement {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: espacio.xl, gap: espacio.lg }}
      >
        {titulo ? (
          <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
            {titulo}
          </Text>
        ) : null}
        {resumenErrores ? <Aviso tipo="error" mensaje={resumenErrores} anuncio="alerta" /> : null}
        {children}
        <View style={{ gap: espacio.md }}>
          <Boton variante="primario" {...accionPrincipal} />
          {accionSecundaria ? <Boton variante="secundario" {...accionSecundaria} /> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
