import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, Boton, EstadoPantalla, Importe, InsigniaEstado, Tarjeta } from '@/catalogo'
import {
  etiquetaPeriodo,
  formatearFecha,
  insigniaDeEstado,
  type Cuota,
} from '@/servicios/cuotas'
import { borde, color, espacio, estiloDeTexto } from '@/tokens'

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

function FilaDato({ rotulo, children }: { rotulo: string; children: ReactElement | string }): ReactElement {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: espacio.sm }}>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{rotulo}</Text>
      {typeof children === 'string' ? (
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro800 }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
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
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          Cuota de {periodo}
        </Text>
        <InsigniaEstado dominio="factura" estado={insigniaDeEstado(cuota.estado)} />
        {vencida ? (
          <Text style={[estiloDeTexto('cuerpo'), { color: color.peligroTexto }]}>
            Vencida el {formatearFecha(cuota.vencimiento)}. Regularizá el saldo pendiente.
          </Text>
        ) : null}
        <FilaDato rotulo="Vencimiento">{formatearFecha(cuota.vencimiento)}</FilaDato>
        <FilaDato rotulo="Importe">
          <Importe centavos={cuota.totalCentavos} />
        </FilaDato>
        <FilaDato rotulo="Saldo">
          <Importe centavos={cuota.saldoCentavos} />
        </FilaDato>
        {cuota.itemsEnVerificacion > 0 ? (
          <Aviso
            tipo="informativo"
            mensaje={`${cuota.itemsEnVerificacion === 1 ? 'Un ítem tiene' : `${cuota.itemsEnVerificacion} ítems tienen`} un pago en verificación. El saldo baja recién cuando la institución lo aprueba.`}
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
        <Boton
          etiqueta="Ver detalle"
          variante="secundario"
          onPress={() => onAbrirDetalle(cuota.facturaId)}
          etiquetaAccesible={`Ver detalle de la cuota de ${periodo}`}
          testID={`detalle-${cuota.facturaId}`}
        />
      </Tarjeta>
    </View>
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
  const lista = resultado.tipo === 'ok' ? (pestana === 'pendientes' ? resultado.pendientes : resultado.pagadas) : []

  return (
    <View style={{ gap: espacio.md }}>
      {mostrarSelector && alumnos.length > 0 ? (
        <View accessibilityRole="tablist" style={{ gap: espacio.sm }}>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
            {alumnos.map(alumno => (
              <Boton
                key={alumno.id}
                etiqueta={alumno.etiqueta}
                variante={alumno.id === alumnoId ? 'primario' : 'secundario'}
                onPress={() => props.onSeleccionarAlumno(alumno.id)}
                pistaAccesible={alumno.id === alumnoId ? 'Seleccionado' : 'Mostrar las cuotas de este estudiante'}
                testID={`hijo-${alumno.id}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
        <Boton
          etiqueta={cantidadPendientes === null ? 'Pendientes' : `Pendientes (${cantidadPendientes})`}
          variante={pestana === 'pendientes' ? 'primario' : 'secundario'}
          onPress={() => props.onCambiarPestana('pendientes')}
          testID="pestana-pendientes"
        />
        <Boton
          etiqueta={cantidadPagadas === null ? 'Pagadas' : `Pagadas (${cantidadPagadas})`}
          variante={pestana === 'pagadas' ? 'primario' : 'secundario'}
          onPress={() => props.onCambiarPestana('pagadas')}
          testID="pestana-pagadas"
        />
      </View>

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

      {resultado.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Consultando cuotas…" /> : null}
      {resultado.tipo === 'error' ? (
        <EstadoPantalla
          tipo="error"
          titulo="No pudimos cargar las cuotas"
          descripcion="No mostramos datos hasta poder validarlos. Intentá nuevamente."
          onReintentar={props.onReintentar}
        />
      ) : null}
      {resultado.tipo === 'ok' && lista.length === 0 ? (
        <EstadoPantalla
          tipo="vacio"
          titulo={pestana === 'pendientes' ? 'No hay cuotas pendientes' : 'Todavía no hay cuotas pagadas'}
          descripcion={
            pestana === 'pendientes'
              ? 'Las cuotas con saldo aparecerán acá una vez emitidas por la institución.'
              : 'Cuando la institución apruebe un pago, la cuota saldada aparecerá en esta pestaña.'
          }
        />
      ) : null}
      {resultado.tipo === 'ok'
        ? lista.map(cuota => <TarjetaCuota key={cuota.facturaId} cuota={cuota} onAbrirDetalle={props.onAbrirDetalle} />)
        : null}
      {resultado.tipo === 'ok' && resultado.fechaCorte ? (
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>
          Estados calculados al {formatearFecha(resultado.fechaCorte)} (hora de Argentina).
        </Text>
      ) : null}
    </View>
  )
}
