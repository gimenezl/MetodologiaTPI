import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, Boton, CampoTexto, EstadoPantalla, Importe, InsigniaEstado, Tarjeta } from '@/catalogo'
import {
  insigniaDePago,
  isoAEntrada,
  type CausaConsulta,
  type CriterioComprobantes,
  type ErroresRango,
  type FacturaPeriodo,
  type RegistroComprobante,
} from '@/servicios/consultas-familia'
import { etiquetaPeriodo, formatearFecha, insigniaDeEstado } from '@/servicios/cuotas'
import { color, espacio, estiloDeTexto } from '@/tokens'

import type { ClienteEPT } from '@/servicios/supabase'
import { DescargaRecibo } from './DescargaRecibo'

import type { AlumnoSelector } from '../cuotas/CuotasVista'
import { SelectorEstudiante } from './SelectorEstudiante'

export type ResultadoLista<T> =
  | { tipo: 'cargando' }
  | { tipo: 'error'; causa: CausaConsulta }
  | { tipo: 'ok'; filas: T[] }

export interface PeriodoVistaProps {
  cliente?: ClienteEPT
  alumnos: AlumnoSelector[]
  alumnoId: string | null
  mostrarSelector: boolean
  desde: string
  hasta: string
  criterio: CriterioComprobantes
  errores: ErroresRango
  /** Hay una consulta aplicada: sin ella solo se ve el formulario. */
  consultado: boolean
  rangoConsultado: { desde: string; hasta: string } | null
  facturas: ResultadoLista<FacturaPeriodo>
  registro: ResultadoLista<RegistroComprobante>
  onSeleccionarAlumno: (id: string) => void
  onCambiarDesde: (texto: string) => void
  onCambiarHasta: (texto: string) => void
  onCambiarCriterio: (criterio: CriterioComprobantes) => void
  onConsultar: () => void
  onReintentar: () => void
}

const EXPLICACION: Record<CriterioComprobantes, string> = {
  PERIODO_FACTURA: 'Se buscan los pagos que cubren facturas cuyo mes cae dentro del rango.',
  FECHA_TRANSFERENCIA: 'Se buscan los pagos por la fecha de transferencia que informó la familia.',
}

function Dato({ rotulo, children }: { rotulo: string; children: ReactElement | string }): ReactElement {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: espacio.sm }}>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{rotulo}</Text>
      {typeof children === 'string' ? (
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro800, flexShrink: 1 }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}

function textoArchivos(n: number): string {
  return n === 0 ? 'Sin archivos' : n === 1 ? '1 archivo' : `${n} archivos`
}

export function TarjetaFacturaPeriodo({ factura }: { factura: FacturaPeriodo }): ReactElement {
  const periodo = etiquetaPeriodo(factura.periodo)
  return (
    <View testID={`factura-${factura.facturaId}`}>
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          Factura de {periodo}
        </Text>
        <InsigniaEstado dominio="factura" estado={insigniaDeEstado(factura.estado)} />
        <Dato rotulo="Vencimiento">{formatearFecha(factura.vencimiento)}</Dato>
        <Dato rotulo="Importe">
          <Importe centavos={factura.totalCentavos} />
        </Dato>
        <Dato rotulo="Saldo">
          <Importe centavos={factura.saldoCentavos} />
        </Dato>
        <Dato rotulo="Pagos relacionados">{String(factura.cantidadPagos)}</Dato>
        <Dato rotulo="Comprobantes">{textoArchivos(factura.cantidadArchivos)}</Dato>
        {factura.inconsistente ? (
          <Aviso
            tipo="advertencia"
            titulo="Revisá esta factura con la institución"
            mensaje="Los importes registrados no coinciden entre sí. Mostramos el saldo tal como figura, sin ajustes."
            anuncio="estado"
          />
        ) : null}
      </Tarjeta>
    </View>
  )
}

export function TarjetaRegistro({ registro, cliente }: { registro: RegistroComprobante; cliente?: ClienteEPT }): ReactElement {
  return (
    <View testID={`comprobante-${registro.pagoId}`}>
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          Pago del {isoAEntrada(registro.creadoEn)}
        </Text>
        <InsigniaEstado dominio="pago" estado={insigniaDePago(registro.estado)} />
        <Dato rotulo="Fecha de transferencia">
          {registro.fechaTransferencia ? isoAEntrada(registro.fechaTransferencia) : 'No informada'}
        </Dato>
        <Dato rotulo="Importe informado">
          {registro.importeInformadoCentavos === null ? 'No informado' : <Importe centavos={registro.importeInformadoCentavos} />}
        </Dato>
        <Dato rotulo={registro.estado === 'APROBADO' ? 'Importe imputado' : 'Importe seleccionado'}>
          <Importe centavos={registro.totalCalculadoCentavos} />
        </Dato>
        {registro.importeInformadoCentavos!==null ? <Dato rotulo="Diferencia (informado menos imputado o seleccionado)"><Importe centavos={registro.importeInformadoCentavos-registro.totalCalculadoCentavos}/></Dato> : null}
        <Text accessibilityRole="header">{registro.estado === 'APROBADO' ? 'Ítems abonados' : 'Ítems seleccionados, no abonados'}</Text>
        {(registro.items ?? []).map(i=><View key={i.itemId}><Text>{i.concepto} · {etiquetaPeriodo(i.periodo)}</Text><Importe centavos={i.importeCentavos} /><Text>Factura: {i.facturaId}{!i.activa ? ' · Imputación histórica inactiva' : ''}</Text></View>)}
        {registro.motivoRechazo ? <Text>Motivo del rechazo: {registro.motivoRechazo}</Text> : null}
        {registro.verificadoEn ? <Text>Verificación: {registro.verificadoEn}</Text> : null}
        {registro.estado === 'APROBADO' ? (registro.reciboId && cliente ? <DescargaRecibo key={registro.reciboId} cliente={cliente} reciboId={registro.reciboId} /> : <Text>Recibo preparándose. Consulta nuevamente o contacta a Dirección.</Text>) : null}
        <Dato rotulo="Comprobantes">{textoArchivos(registro.cantidadArchivos)}</Dato>
        {registro.ultimaCarga ? <Dato rotulo="Último archivo cargado el">{isoAEntrada(registro.ultimaCarga)}</Dato> : null}
        <Dato rotulo="Facturas que cubre">
          {registro.periodos.length === 0 ? 'No disponible' : registro.periodos.map(etiquetaPeriodo).join(', ')}
        </Dato>
      </Tarjeta>
    </View>
  )
}

function ListaConsultada<T>({
  titulo,
  resultado,
  vacio,
  cargando,
  errorTitulo,
  onReintentar,
  render,
  testID,
}: {
  titulo: string
  resultado: ResultadoLista<T>
  vacio: { titulo: string; descripcion: string }
  cargando: string
  errorTitulo: string
  onReintentar: () => void
  render: (fila: T) => ReactElement
  testID: string
}): ReactElement {
  return (
    <View style={{ gap: espacio.md }} testID={testID}>
      <Text accessibilityRole="header" style={[estiloDeTexto('subtitulo'), { color: color.neutro800 }]}>
        {titulo}
      </Text>
      {resultado.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje={cargando} /> : null}
      {resultado.tipo === 'error' ? (
        resultado.causa === 'permiso' ? (
          <EstadoPantalla
            tipo="error"
            titulo="No tenés permiso para ver esta información"
            descripcion="Tu cuenta no puede consultar estos datos. Si creés que es un error, contactá a la institución."
          />
        ) : resultado.causa === 'rango' ? (
          <EstadoPantalla
            tipo="error"
            titulo="El rango de fechas no es válido"
            descripcion="Revisá las fechas e intentá nuevamente."
          />
        ) : (
          <EstadoPantalla
            tipo="error"
            titulo={errorTitulo}
            descripcion="No mostramos datos hasta poder validarlos. Intentá nuevamente."
            onReintentar={onReintentar}
          />
        )
      ) : null}
      {resultado.tipo === 'ok' && resultado.filas.length === 0 ? (
        <EstadoPantalla tipo="vacio" titulo={vacio.titulo} descripcion={vacio.descripcion} />
      ) : null}
      {resultado.tipo === 'ok' ? resultado.filas.map(render) : null}
    </View>
  )
}

/**
 * Facturas y registro de comprobantes por rango de fechas. El formulario dice qué fecha filtra cada
 * resultado: facturas por mes de factura; comprobantes por mes de factura o por fecha de transferencia.
 */
export function PeriodoVista(props: PeriodoVistaProps): ReactElement {
  const { alumnos, alumnoId, mostrarSelector, errores } = props

  if (alumnos.length === 0) {
    return (
      <EstadoPantalla
        tipo="vacio"
        titulo="Todavía no hay estudiantes vinculados"
        descripcion="Cuando la institución registre un vínculo familiar autorizado, vas a poder consultar sus facturas y comprobantes desde acá."
      />
    )
  }

  return (
    <View style={{ gap: espacio.md }}>
      {mostrarSelector ? (
        <SelectorEstudiante
          alumnos={alumnos}
          alumnoId={alumnoId}
          onSeleccionar={props.onSeleccionarAlumno}
          pista="Consultar las facturas y comprobantes de este estudiante"
          prefijoId="periodo-hijo"
        />
      ) : null}

      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          Rango de fechas
        </Text>
        <CampoTexto
          etiqueta="Desde"
          valor={props.desde}
          onChangeText={props.onCambiarDesde}
          teclado="numerico"
          placeholder="DD/MM/AAAA"
          ayuda="Día, mes y año. Los extremos están incluidos."
          error={errores.desde}
          accionTeclado="siguiente"
          testID="periodo-desde"
        />
        <CampoTexto
          etiqueta="Hasta"
          valor={props.hasta}
          onChangeText={props.onCambiarHasta}
          teclado="numerico"
          placeholder="DD/MM/AAAA"
          error={errores.hasta}
          accionTeclado="enviar"
          onSubmitEditing={props.onConsultar}
          testID="periodo-hasta"
        />
        {errores.rango ? <Aviso tipo="error" mensaje={errores.rango} anuncio="alerta" /> : null}

        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          Qué fecha se usa para los comprobantes
        </Text>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
          <Boton
            etiqueta="Período de factura"
            variante={props.criterio === 'PERIODO_FACTURA' ? 'primario' : 'secundario'}
            onPress={() => props.onCambiarCriterio('PERIODO_FACTURA')}
            testID="criterio-factura"
          />
          <Boton
            etiqueta="Fecha de transferencia"
            variante={props.criterio === 'FECHA_TRANSFERENCIA' ? 'primario' : 'secundario'}
            onPress={() => props.onCambiarCriterio('FECHA_TRANSFERENCIA')}
            testID="criterio-transferencia"
          />
        </View>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{EXPLICACION[props.criterio]}</Text>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>
          Las facturas siempre se filtran por su período (mes calendario). La fecha en que se cargó cada archivo es solo informativa y no filtra.
        </Text>
        <Boton etiqueta="Consultar" onPress={props.onConsultar} testID="periodo-consultar" />
      </Tarjeta>

      {props.consultado && props.rangoConsultado ? (
        <>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Resultados del {isoAEntrada(props.rangoConsultado.desde)} al {isoAEntrada(props.rangoConsultado.hasta)}.
          </Text>
          <ListaConsultada
            titulo="Facturas por período de factura"
            testID="periodo-facturas"
            resultado={props.facturas}
            cargando="Consultando facturas…"
            errorTitulo="No pudimos cargar las facturas"
            vacio={{ titulo: 'No hay facturas en este rango', descripcion: 'No hay facturas emitidas con un período dentro de las fechas elegidas.' }}
            onReintentar={props.onReintentar}
            render={factura => <TarjetaFacturaPeriodo key={factura.facturaId} factura={factura} />}
          />
          <ListaConsultada
            titulo={props.criterio === 'PERIODO_FACTURA' ? 'Comprobantes por período de factura' : 'Comprobantes por fecha de transferencia'}
            testID="periodo-comprobantes"
            resultado={props.registro}
            cargando="Consultando comprobantes…"
            errorTitulo="No pudimos cargar los comprobantes"
            vacio={{
              titulo: 'No hay pagos para este rango',
              descripcion: props.criterio === 'PERIODO_FACTURA'
                ? 'Ningún pago cubre facturas con un período dentro de las fechas elegidas.'
                : 'Ningún pago tiene una fecha de transferencia informada dentro de las fechas elegidas.',
            }}
            onReintentar={props.onReintentar}
            render={registro => <TarjetaRegistro key={registro.pagoId} registro={registro} cliente={props.cliente} />}
          />
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>
            Solo se muestra el registro de cada comprobante. El archivo original solo lo puede ver quien lo cargó y la Dirección de la institución.
          </Text>
        </>
      ) : null}
    </View>
  )
}
