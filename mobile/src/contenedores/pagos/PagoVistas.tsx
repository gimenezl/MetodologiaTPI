import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, Boton, EstadoPantalla, FilaSeleccionable, Importe, InsigniaEstado, ResumenTotal, Tarjeta } from '@/catalogo'
import { ETIQUETA_CONCEPTO, etiquetaPeriodo, formatearFecha, insigniaDeEstado } from '@/servicios/cuotas'
import {
  MENSAJE_RECHAZO,
  type CodigoRechazo,
  type DatosBancarios,
  type GrupoFactura,
  type MotivoNoSeleccionable,
  type PagoRegistrado,
} from '@/servicios/pagos'
import { color, espacio, estiloDeTexto } from '@/tokens'

const ESTADO_ITEM = { PENDIENTE: 'Pendiente', EN_VERIFICACION: 'En verificación', PAGADO: 'Pagado' } as const

const MOTIVO: Record<MotivoNoSeleccionable, string> = {
  PAGADO: 'Ya está pagado.',
  EN_VERIFICACION: 'Tiene un pago en verificación.',
  SIN_CARGO: 'Sin cargo: no hay nada para pagar.',
  REVISAR: 'Revisá esta cuota con la institución.',
}

export type CargaItems = { tipo: 'cargando' } | { tipo: 'error' } | { tipo: 'ok'; grupos: GrupoFactura[] }
export type EstadoCotizacion =
  | { tipo: 'sin_seleccion' }
  | { tipo: 'cargando' }
  | { tipo: 'ok'; totalCentavos: number }
  | { tipo: 'rechazada'; codigo: CodigoRechazo }
  | { tipo: 'error' }
export type EstadoBanco = { tipo: 'cargando' } | { tipo: 'error' } | { tipo: 'ok'; datos: DatosBancarios }

function FilaBanco({ rotulo, valor }: { rotulo: string; valor: string }): ReactElement {
  return (
    <View accessible accessibilityLabel={`${rotulo}: ${valor}`} style={{ gap: espacio.xs }}>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{rotulo}</Text>
      <Text selectable style={[estiloDeTexto('importe'), { color: color.neutro800 }]}>
        {valor}
      </Text>
    </View>
  )
}

export function DatosTransferencia({ banco, onReintentar }: { banco: EstadoBanco; onReintentar: () => void }): ReactElement {
  return (
    <Tarjeta>
      <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
        Datos para la transferencia
      </Text>
      {banco.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Consultando los datos bancarios…" /> : null}
      {banco.tipo === 'error' ? (
        <EstadoPantalla
          tipo="error"
          titulo="No pudimos cargar los datos bancarios"
          descripcion="Intentá nuevamente antes de transferir."
          onReintentar={onReintentar}
        />
      ) : null}
      {banco.tipo === 'ok' ? (
        <>
          {banco.datos.ficticio ? <Aviso tipo="advertencia" titulo="Datos de prueba" mensaje={banco.datos.aviso} anuncio="estado" /> : null}
          <FilaBanco rotulo="Banco" valor={banco.datos.banco} />
          <FilaBanco rotulo="Titular" valor={banco.datos.titular} />
          <FilaBanco rotulo="CUIT" valor={banco.datos.cuit} />
          <FilaBanco rotulo="Tipo de cuenta" valor={banco.datos.tipoCuenta} />
          <FilaBanco rotulo="CBU" valor={banco.datos.cbu} />
          <FilaBanco rotulo="Alias" valor={banco.datos.alias} />
        </>
      ) : null}
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>No se acepta pago en efectivo.</Text>
    </Tarjeta>
  )
}

// ---- Selección -----------------------------------------------------------------------------------------

export interface PagoSeleccionVistaProps {
  etiquetaAlumno: string
  carga: CargaItems
  seleccion: ReadonlySet<string>
  cotizacion: EstadoCotizacion
  banco: EstadoBanco
  registrando: boolean
  onToggle: (itemId: string) => void
  onRegistrar: () => void
  onVolver: () => void
  onReintentarCarga: () => void
  onReintentarCotizacion: () => void
  onReintentarBanco: () => void
}

function leyendaTotal(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? 'ítem seleccionado' : 'ítems seleccionados'} · calculado por el sistema`
}

export function PagoSeleccionVista(props: PagoSeleccionVistaProps): ReactElement {
  const { carga, seleccion, cotizacion } = props
  const puedeRegistrar = cotizacion.tipo === 'ok' && seleccion.size > 0 && !props.registrando
  return (
    <View style={{ gap: espacio.md }}>
      <Boton etiqueta="Volver a las cuotas" variante="enlace" onPress={props.onVolver} testID="volver-cuotas-pago" />
      <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
        Pagar ítems
      </Text>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante: {props.etiquetaAlumno}</Text>
      <Text style={[estiloDeTexto('subtitulo'), { color: color.neutro800 }]}>Elegí los ítems a pagar</Text>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
        Los ítems pagados o en verificación no se pueden seleccionar.
      </Text>

      {carga.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Consultando ítems…" /> : null}
      {carga.tipo === 'error' ? (
        <EstadoPantalla
          tipo="error"
          titulo="No pudimos cargar los ítems"
          descripcion="No mostramos datos hasta poder validarlos. Intentá nuevamente."
          onReintentar={props.onReintentarCarga}
        />
      ) : null}
      {carga.tipo === 'ok' && carga.grupos.length === 0 ? (
        <EstadoPantalla
          tipo="vacio"
          titulo="No hay ítems para pagar"
          descripcion="Cuando la institución emita una cuota con saldo, sus ítems aparecerán acá."
        />
      ) : null}
      {carga.tipo === 'ok'
        ? carga.grupos.map(grupo => (
            <Tarjeta key={grupo.facturaId}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: espacio.sm }}>
                <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
                  Cuota de {etiquetaPeriodo(grupo.periodo)}
                </Text>
                <InsigniaEstado dominio="factura" estado={insigniaDeEstado(grupo.estado)} />
              </View>
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
                Vencimiento: {formatearFecha(grupo.vencimiento)}
              </Text>
              {grupo.items.map(item => (
                <FilaSeleccionable
                  key={item.itemId}
                  testID={`item-${item.itemId}`}
                  itemId={item.itemId}
                  concepto={ETIQUETA_CONCEPTO[item.tipo]}
                  estado={ESTADO_ITEM[item.estadoPago]}
                  importeCentavos={item.importeCentavos}
                  seleccionado={seleccion.has(item.itemId)}
                  seleccionable={item.motivo === null && !props.registrando}
                  motivo={item.motivo ? MOTIVO[item.motivo] : undefined}
                  onToggle={props.onToggle}
                />
              ))}
            </Tarjeta>
          ))
        : null}

      <ResumenTotal
        testID="total-a-transferir"
        titulo="Total a transferir"
        total={cotizacion.tipo === 'ok' ? cotizacion.totalCentavos : cotizacion.tipo === 'sin_seleccion' ? 0 : null}
        leyenda={
          cotizacion.tipo === 'ok' || cotizacion.tipo === 'sin_seleccion'
            ? leyendaTotal(seleccion.size)
            : cotizacion.tipo === 'cargando'
              ? 'Calculando el total en el servidor…'
              : 'No se pudo calcular el total.'
        }
      />
      {cotizacion.tipo === 'sin_seleccion' && carga.tipo === 'ok' && carga.grupos.length > 0 ? (
        <Text accessibilityLiveRegion="polite" style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
          Seleccioná al menos un ítem para continuar.
        </Text>
      ) : null}
      {cotizacion.tipo === 'rechazada' ? (
        <Aviso tipo="advertencia" titulo="Revisá la selección" mensaje={MENSAJE_RECHAZO[cotizacion.codigo]} anuncio="alerta" />
      ) : null}
      {cotizacion.tipo === 'error' ? (
        <View style={{ gap: espacio.sm }}>
          <Aviso
            tipo="error"
            titulo="No pudimos calcular el total"
            mensaje="No registramos nada. Revisá tu conexión e intentá nuevamente."
            anuncio="alerta"
          />
          <Boton etiqueta="Reintentar" variante="secundario" onPress={props.onReintentarCotizacion} testID="reintentar-cotizacion" />
        </View>
      ) : null}

      <DatosTransferencia banco={props.banco} onReintentar={props.onReintentarBanco} />

      <Boton
        etiqueta="Registrar pago"
        onPress={props.onRegistrar}
        deshabilitado={!puedeRegistrar && !props.registrando}
        cargando={props.registrando}
        pistaAccesible={
          puedeRegistrar ? 'Registra el pago como pendiente de verificación' : 'Disponible cuando el total esté calculado'
        }
        testID="registrar-pago"
      />
    </View>
  )
}

// ---- Resultado -----------------------------------------------------------------------------------------

export type VistaResultado =
  | { tipo: 'registrado'; pago: PagoRegistrado }
  | { tipo: 'rechazado'; codigo: CodigoRechazo }
  | { tipo: 'incierto'; verificando: boolean; fallo: boolean }
  | { tipo: 'no_registrado' }

export interface PagoResultadoVistaProps {
  resultado: VistaResultado
  etiquetaAlumno: string
  onVolverACuotas: () => void
  onVolverASeleccion: () => void
  onVerificar: () => void
  onReintentarMismoIntento: () => void
  /** Solo con un pago pendiente de verificación recién registrado o recuperado (EPT-109). */
  onAdjuntarComprobante?: () => void
}

export function PagoResultadoVista(props: PagoResultadoVistaProps): ReactElement {
  const { resultado } = props
  if (resultado.tipo === 'registrado') {
    const { pago } = resultado
    const cantidad = pago.items.length
    return (
      <View style={{ gap: espacio.md }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
          Pago registrado
        </Text>
        {pago.estado === 'PENDIENTE_VERIFICACION' ? (
          <Aviso
            tipo="exito"
            titulo="Pago registrado: pendiente de verificación."
            mensaje={`${cantidad === 1 ? 'El ítem queda' : `Los ${cantidad} ítems quedan`} en verificación y el saldo no cambia hasta que la institución apruebe el pago.`}
            anuncio="estado"
          />
        ) : (
          <Aviso
            tipo="informativo"
            titulo={pago.estado === 'APROBADO' ? 'Este pago ya fue aprobado.' : 'Este pago fue rechazado.'}
            mensaje="El intento ya se había registrado y la institución lo resolvió. Revisá el estado actualizado en tus cuotas."
            anuncio="estado"
          />
        )}
        {pago.repetido ? (
          <Aviso tipo="informativo" mensaje="Este pago ya estaba registrado: no se duplicó." anuncio="estado" />
        ) : null}
        <Tarjeta>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante: {props.etiquetaAlumno}</Text>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Total a transferir</Text>
          <Importe centavos={pago.totalCentavos} total />
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Ítems: {cantidad}
          </Text>
          <InsigniaEstado
            dominio="pago"
            estado={pago.estado === 'APROBADO' ? 'aprobado' : pago.estado === 'RECHAZADO' ? 'rechazado' : 'pendiente'}
          />
          <Text
            testID="codigo-pago"
            accessibilityLabel={`Código del pago ${pago.pagoId.slice(0, 8).toUpperCase()}`}
            style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}
          >
            Código del pago: {pago.pagoId.slice(0, 8).toUpperCase()}
          </Text>
          {pago.items.map(item => (
            <View
              key={item.itemId}
              style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: espacio.sm }}
            >
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro800 }]}>
                {ETIQUETA_CONCEPTO[item.tipo]} · {etiquetaPeriodo(item.periodo)}
              </Text>
              <Importe centavos={item.importeCentavos} />
            </View>
          ))}
        </Tarjeta>
        <DatosTransferencia banco={{ tipo: 'ok', datos: pago.banco }} onReintentar={() => undefined} />
        {pago.estado === 'PENDIENTE_VERIFICACION' && props.onAdjuntarComprobante ? (
          <Boton
            etiqueta="Adjuntar comprobante"
            onPress={props.onAdjuntarComprobante}
            pistaAccesible="Adjuntá la foto o el PDF del comprobante de tu transferencia"
            testID="adjuntar-comprobante"
          />
        ) : null}
        <Boton
          etiqueta="Volver a las cuotas"
          variante={props.onAdjuntarComprobante ? 'secundario' : 'primario'}
          onPress={props.onVolverACuotas}
          testID="volver-cuotas-pago"
        />
      </View>
    )
  }

  if (resultado.tipo === 'rechazado') {
    return (
      <View style={{ gap: espacio.md }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
          No se registró el pago
        </Text>
        <Aviso
          tipo="advertencia"
          titulo="No registramos nada."
          mensaje={MENSAJE_RECHAZO[resultado.codigo]}
          anuncio="alerta"
        />
        <Boton etiqueta="Volver a la selección" onPress={props.onVolverASeleccion} testID="volver-seleccion" />
      </View>
    )
  }

  if (resultado.tipo === 'no_registrado') {
    return (
      <View style={{ gap: espacio.md }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
          El pago todavía no figura registrado
        </Text>
        <Aviso
          tipo="informativo"
          mensaje="Todavía no figura como registrado. Podés reintentarlo con la misma selección: si el pedido anterior llegara después, no se duplica."
          anuncio="estado"
        />
        <Boton etiqueta="Reintentar el mismo pago" onPress={props.onReintentarMismoIntento} testID="reintentar-intento" />
        <Boton
          etiqueta="Volver a las cuotas"
          variante="enlace"
          onPress={props.onVolverACuotas}
          pistaAccesible="El intento queda guardado para verificarlo después"
          testID="volver-cuotas-pago"
        />
      </View>
    )
  }

  return (
    <View style={{ gap: espacio.md }}>
      <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
        No pudimos confirmar el pago
      </Text>
      <Aviso
        tipo="advertencia"
        titulo="Todavía no sabemos si se registró."
        mensaje="No volvemos a enviarlo hasta comprobarlo, para no duplicar el pago. Verificá el resultado."
        anuncio="alerta"
      />
      {resultado.fallo ? (
        <Aviso tipo="error" mensaje="No pudimos verificar el resultado. Revisá tu conexión e intentá nuevamente." anuncio="alerta" />
      ) : null}
      <Boton
        etiqueta="Verificar resultado"
        onPress={props.onVerificar}
        cargando={resultado.verificando}
        testID="verificar-intento"
      />
      <Boton
        etiqueta="Volver a las cuotas"
        variante="enlace"
        onPress={props.onVolverACuotas}
        pistaAccesible="El intento queda guardado para verificarlo después"
        testID="volver-cuotas-pago"
      />
    </View>
  )
}
