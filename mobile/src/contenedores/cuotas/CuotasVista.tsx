import type { ReactElement } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Aviso, Boton, EstadoPantalla, Importe, InsigniaEstado, Segmentado, Tarjeta } from '@/catalogo'
import {
  etiquetaPeriodo,
  formatearFecha,
  insigniaDeEstado,
  type Cuota,
} from '@/servicios/cuotas'
import { borde, color, espacio, estiloDeTexto, tactil } from '@/tokens'

export interface AlumnoSelector {
  id: string
  etiqueta: string
}

export type PestanaCuotas = 'pendientes' | 'pagadas'

export type ResultadoListado =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'ok'; pendientes: Cuota[]; pagadas: Cuota[]; fechaCorte: string | null }

export interface CuotasVistaProps {
  /** Hijos vinculados (padre) o un único alumno propio (estudiante). */
  alumnos: AlumnoSelector[]
  alumnoId: string | null
  /** Solo el padre ve el selector; el estudiante nunca ve a otros alumnos. */
  mostrarSelector: boolean
  pestana: PestanaCuotas
  resultado: ResultadoListado
  onSeleccionarAlumno: (id: string) => void
  onCambiarPestana: (pestana: PestanaCuotas) => void
  onAbrirDetalle: (facturaId: string) => void
  onReintentar: () => void
  /** Solo el padre registra pagos: el estudiante nunca ve la acción. */
  permitirPago?: boolean
  onPagar?: () => void
  /** Solo el padre adjunta comprobantes (EPT-109). */
  permitirComprobantes?: boolean
  onComprobantes?: () => void
}

function EnlaceDetalle({
  cuota,
  periodo,
  onAbrirDetalle,
}: {
  cuota: Cuota
  periodo: string
  onAbrirDetalle: (id: string) => void
}): ReactElement {
  return (
    <Pressable
      testID={`detalle-${cuota.facturaId}`}
      accessibilityRole="button"
      accessibilityLabel={`Ver detalle de la cuota de ${periodo}`}
      onPress={() => onAbrirDetalle(cuota.facturaId)}
      style={{
        minHeight: tactil.minimo,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: borde.fino,
        borderTopColor: color.neutro200,
        paddingTop: espacio.xs,
      }}
    >
      <Text style={[estiloDeTexto('boton'), { color: color.primario700 }]}>Ver detalle</Text>
      <Text importantForAccessibility="no" accessibilityElementsHidden style={[estiloDeTexto('titulo'), { color: color.primario700 }]}>
        ›
      </Text>
    </Pressable>
  )
}

export function TarjetaCuota({ cuota, onAbrirDetalle }: { cuota: Cuota; onAbrirDetalle: (id: string) => void }): ReactElement {
  const vencida = cuota.estado === 'VENCIDA'
  const periodo = etiquetaPeriodo(cuota.periodo)
  return (
    <View
      testID={`cuota-${cuota.facturaId}`}
      style={vencida ? { borderLeftWidth: borde.enfasis * 3, borderLeftColor: color.peligroTexto, borderRadius: 12 } : undefined}
    >
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('subtitulo'), { color: color.neutro800 }]}>
          Cuota de {periodo}
        </Text>
        <View style={{ gap: espacio.xs }}>
          <Text style={[estiloDeTexto('seccion'), { color: color.neutro600 }]}>Saldo</Text>
          <Importe centavos={cuota.saldoCentavos} total />
          {cuota.saldoCentavos !== cuota.totalCentavos ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: espacio.xs }}>
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>De un total de</Text>
              <Importe centavos={cuota.totalCentavos} />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: espacio.sm }}>
          <InsigniaEstado dominio="factura" estado={insigniaDeEstado(cuota.estado)} />
          <Text style={[estiloDeTexto('cuerpo'), { color: vencida ? color.peligroTexto : color.neutro700 }]}>
            {vencida ? 'Vencida el' : 'Vence el'} {formatearFecha(cuota.vencimiento)}
          </Text>
        </View>
        {cuota.itemsEnVerificacion > 0 ? (
          <Aviso
            tipo="informativo"
            mensaje={`${cuota.itemsEnVerificacion === 1 ? 'Un ítem tiene' : `${cuota.itemsEnVerificacion} ítems tienen`} un pago en verificación. El saldo baja cuando la institución lo apruebe.`}
            anuncio="estado"
          />
        ) : null}
        {cuota.inconsistente ? (
          <Aviso
            tipo="advertencia"
            titulo="Revisá esta cuota con la institución"
            mensaje="Los importes registrados no coinciden entre sí. Mostramos el saldo tal como figura, sin ajustes."
            anuncio="estado"
          />
        ) : null}
        <EnlaceDetalle cuota={cuota} periodo={periodo} onAbrirDetalle={onAbrirDetalle} />
      </Tarjeta>
    </View>
  )
}

/** Un solo número arriba: lo que falta pagar entre las cuotas pendientes (suma de los saldos ya informados). */
function ResumenSaldo({ cuotas }: { cuotas: Cuota[] }): ReactElement | null {
  if (cuotas.length === 0 || cuotas.some(cuota => cuota.inconsistente)) return null
  const saldo = cuotas.reduce((suma, cuota) => suma + cuota.saldoCentavos, 0)
  const vencidas = cuotas.filter(cuota => cuota.estado === 'VENCIDA').length
  const detalle = `${cuotas.length} ${cuotas.length === 1 ? 'cuota pendiente' : 'cuotas pendientes'}${
    vencidas > 0 ? ` · ${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}` : ''
  }`
  return (
    <Tarjeta>
      <View testID="saldo-pendiente" style={{ gap: espacio.xs }}>
        <Text style={[estiloDeTexto('seccion'), { color: color.neutro600 }]}>Saldo pendiente</Text>
        <Importe centavos={saldo} total />
        <Text style={[estiloDeTexto('cuerpo'), { color: vencidas > 0 ? color.peligroTexto : color.neutro700 }]}>{detalle}</Text>
      </View>
    </Tarjeta>
  )
}

export function CuotasVista(props: CuotasVistaProps): ReactElement {
  const { alumnos, alumnoId, mostrarSelector, pestana, resultado } = props

  if (alumnos.length === 0) {
    return (
      <EstadoPantalla
        tipo="vacio"
        titulo="Todavía no hay estudiantes vinculados"
        descripcion="Cuando la institución registre un vínculo familiar autorizado, vas a poder consultar sus cuotas desde acá."
      />
    )
  }

  const cantidadPendientes = resultado.tipo === 'ok' ? resultado.pendientes.length : null
  const cantidadPagadas = resultado.tipo === 'ok' ? resultado.pagadas.length : null
  const origen = resultado.tipo === 'ok' ? (pestana === 'pendientes' ? resultado.pendientes : resultado.pagadas) : []
  // Las vencidas primero (el orden relativo del resto se conserva).
  const lista = [...origen].sort((a, b) => Number(b.estado === 'VENCIDA') - Number(a.estado === 'VENCIDA'))

  return (
    <View style={{ gap: espacio.lg }}>
      {mostrarSelector && alumnos.length > 0 ? (
        <View style={{ gap: espacio.sm }}>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante</Text>
          <Segmentado
            deslizable={alumnos.length > 2}
            activa={alumnoId ?? ''}
            onCambiar={props.onSeleccionarAlumno}
            opciones={alumnos.map(alumno => ({ clave: alumno.id, etiqueta: alumno.etiqueta, testID: `hijo-${alumno.id}` }))}
          />
        </View>
      ) : null}

      {resultado.tipo === 'ok' && pestana === 'pendientes' ? <ResumenSaldo cuotas={resultado.pendientes} /> : null}

      {props.permitirPago && props.onPagar && resultado.tipo === 'ok' && resultado.pendientes.length > 0 ? (
        <Boton
          etiqueta="Pagar ítems"
          onPress={props.onPagar}
          pistaAccesible="Elegí los ítems a pagar y registrá el pago por transferencia"
          testID="pagar-items"
        />
      ) : null}

      {props.permitirComprobantes && props.onComprobantes && resultado.tipo === 'ok' ? (
        <Boton
          etiqueta="Comprobantes de mis pagos"
          variante="secundario"
          onPress={props.onComprobantes}
          pistaAccesible="Adjuntá el comprobante de un pago pendiente de verificación"
          testID="comprobantes-pagos"
        />
      ) : null}

      <Segmentado
        activa={pestana}
        onCambiar={clave => props.onCambiarPestana(clave === 'pagadas' ? 'pagadas' : 'pendientes')}
        opciones={[
          {
            clave: 'pendientes',
            etiqueta: cantidadPendientes === null ? 'Pendientes' : `Pendientes (${cantidadPendientes})`,
            testID: 'pestana-pendientes',
          },
          {
            clave: 'pagadas',
            etiqueta: cantidadPagadas === null ? 'Pagadas' : `Pagadas (${cantidadPagadas})`,
            testID: 'pestana-pagadas',
          },
        ]}
      />

      {resultado.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Consultando cuotas…" /> : null}
      {resultado.tipo === 'error' ? (
        <EstadoPantalla
          tipo="error"
          titulo="No pudimos cargar las cuotas"
          descripcion="No mostramos datos hasta poder validarlos. Revisá tu conexión e intentá nuevamente."
          onReintentar={props.onReintentar}
        />
      ) : null}
      {resultado.tipo === 'ok' && lista.length === 0 ? (
        <EstadoPantalla
          tipo="vacio"
          titulo={pestana === 'pendientes' ? 'No hay cuotas pendientes' : 'Todavía no hay cuotas pagadas'}
          descripcion={
            pestana === 'pendientes'
              ? 'Las cuotas con saldo aparecerán acá cuando la institución las emita.'
              : 'Cuando la institución apruebe un pago, la cuota saldada aparecerá acá.'
          }
        />
      ) : null}
      {resultado.tipo === 'ok'
        ? lista.map(cuota => <TarjetaCuota key={cuota.facturaId} cuota={cuota} onAbrirDetalle={props.onAbrirDetalle} />)
        : null}

      {resultado.tipo === 'ok' && resultado.fechaCorte ? (
        <Text style={[estiloDeTexto('pie'), { color: color.neutro600 }]}>
          Estados al {formatearFecha(resultado.fechaCorte)} (hora de Argentina).
        </Text>
      ) : null}
    </View>
  )
}
