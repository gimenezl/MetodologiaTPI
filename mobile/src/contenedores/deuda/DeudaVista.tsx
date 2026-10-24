import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, Boton, CampoTexto, EstadoPantalla, InsigniaEstado, Tarjeta } from '@/catalogo'
import { isoAEntrada, type ErroresRango, type CausaConsulta, type RangoValidado } from '@/servicios/consultas-familia'
import { etiquetaPeriodo, formatearFecha } from '@/servicios/cuotas'
import {
  agruparCargados,
  formatearCentavosExactos,
  type GrupoDeuda,
  type GrupoVisible,
  type ItemDeuda,
  type TotalesDeuda,
} from '@/servicios/deuda-items'
import { color, espacio, estiloDeTexto } from '@/tokens'

import type { AlumnoSelector } from '../cuotas/CuotasVista'
import { SelectorEstudiante } from '../consultas/SelectorEstudiante'

export interface DatosDeuda {
  filas: ItemDeuda[]
  grupos: GrupoDeuda[]
  totales: TotalesDeuda
  total: number
  pagina: number
  huella: string
  fechaCorte: string
  cargandoMas: boolean
  falloMas: boolean
}

export type EstadoDeuda =
  | { tipo: 'cargando' }
  | { tipo: 'error'; causa: CausaConsulta }
  | { tipo: 'ok'; datos: DatosDeuda }

export interface DeudaVistaProps {
  alumnos: AlumnoSelector[]
  alumnoId: string | null
  mostrarSelector: boolean
  desde: string
  hasta: string
  errores: ErroresRango
  rangoAplicado: RangoValidado | null
  estado: EstadoDeuda
  onSeleccionarAlumno: (id: string) => void
  onCambiarDesde: (texto: string) => void
  onCambiarHasta: (texto: string) => void
  onAplicarFiltro: () => void
  onVerTodo: () => void
  onCargarMas: () => void
  onReintentar: () => void
}

function Dato({ rotulo, children }: { rotulo: string; children: string }): ReactElement {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: espacio.sm }}>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{rotulo}</Text>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro800, flexShrink: 1 }]}>{children}</Text>
    </View>
  )
}

function Cifra({ valor, total = false }: { valor: bigint; total?: boolean }): ReactElement {
  const formateado = formatearCentavosExactos(valor)
  return (
    <Text
      style={[estiloDeTexto(total ? 'importeTotal' : 'importe'), { color: color.neutro800, flexShrink: 0 }]}
      accessibilityLabel={formateado.replace('ARS', 'pesos argentinos')}
    >
      {formateado}
    </Text>
  )
}

function EstadoItem({ item }: { item: ItemDeuda }): ReactElement {
  if (item.estado === 'SIN_CARGO') {
    return <Text style={[estiloDeTexto('insignia'), { color: color.neutro700 }]}>Sin cargo</Text>
  }
  if (item.estado === 'PAGADO') return <InsigniaEstado dominio="item" estado="pagado" />
  if (item.estado === 'EN_VERIFICACION') return <InsigniaEstado dominio="item" estado="verificacion" />
  if (item.estado === 'VENCIDO') return <InsigniaEstado dominio="factura" estado="vencida" />
  return <InsigniaEstado dominio="item" estado="pendiente" />
}

export function TarjetaItemDeuda({ item }: { item: ItemDeuda }): ReactElement {
  return (
    <View testID={`deuda-item-${item.itemId}`}>
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          {item.tipo === 'CUOTA' ? 'Cuota' : item.concepto} · {etiquetaPeriodo(item.periodo)}
        </Text>
        {item.detalle ? <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>{item.detalle}</Text> : null}
        <EstadoItem item={item} />
        <Dato rotulo="Vencimiento">{formatearFecha(item.vencimiento)}</Dato>
        <Dato rotulo="Importe">{formatearCentavosExactos(item.importe)}</Dato>
        <Dato rotulo="Pagado">{formatearCentavosExactos(item.pagado)}</Dato>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: espacio.sm }}>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Saldo</Text>
          <Cifra valor={item.saldo} />
        </View>
        {item.enVerificacion && item.vencido ? (
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Venció el {formatearFecha(item.vencimiento)}. Hay un pago en verificación: la deuda no baja hasta que se apruebe.
          </Text>
        ) : item.enVerificacion ? (
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Hay un pago en verificación: la deuda no baja hasta que se apruebe.
          </Text>
        ) : null}
        {item.origenEstado === 'CANCELADA' ? (
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>La inscripción de origen fue cancelada; el importe facturado se conserva.</Text>
        ) : null}
        {item.catalogoActivo === false ? (
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>Este concepto ya no está activo en el catálogo.</Text>
        ) : null}
        {item.inconsistente || item.facturaInconsistente ? (
          <Aviso
            tipo="advertencia"
            titulo="Revisá este ítem con la institución"
            mensaje="Los importes registrados no coinciden entre sí. Mostramos el saldo tal como figura, sin ajustes."
            anuncio="estado"
          />
        ) : null}
      </Tarjeta>
    </View>
  )
}

function SeccionGrupo({ visible }: { visible: GrupoVisible }): ReactElement {
  const { grupo, items } = visible
  const faltan = grupo.items - items.length
  return (
    <View style={{ gap: espacio.md }} testID={`deuda-grupo-${grupo.clave}`}>
      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('subtitulo'), { color: color.neutro800 }]}>
          {grupo.concepto}
        </Text>
        <Dato rotulo="Ítems">{`${grupo.items} (${grupo.itemsConSaldo} con saldo)`}</Dato>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: espacio.sm }}>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Subtotal adeudado</Text>
          <Cifra valor={grupo.saldo} />
        </View>
      </Tarjeta>
      {items.map(item => <TarjetaItemDeuda key={item.itemId} item={item} />)}
      {faltan > 0 && items.length > 0 ? (
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>
          Mostramos {items.length} de {grupo.items} ítems de esta agrupación; el subtotal incluye todos.
        </Text>
      ) : null}
    </View>
  )
}

/**
 * Historial de deuda por ítem de cada hijo: cuota, cada deporte, transporte y comedor, con período, importe,
 * pagado y saldo; subtotales por agrupación y total adeudado del filtro completo. Solo consulta: no hay
 * selección, carga ni aprobación de nada.
 */
export function DeudaVista(props: DeudaVistaProps): ReactElement {
  const { alumnos, alumnoId, mostrarSelector, errores, estado, rangoAplicado } = props

  if (alumnos.length === 0) {
    return (
      <EstadoPantalla
        tipo="vacio"
        titulo="Todavía no hay estudiantes vinculados"
        descripcion="Cuando la institución registre un vínculo familiar autorizado, vas a poder consultar su deuda desde acá."
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
          pista="Consultar la deuda de este estudiante"
          prefijoId="deuda-hijo"
        />
      ) : null}

      <Tarjeta>
        <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
          Filtrar por período de factura
        </Text>
        <CampoTexto
          etiqueta="Desde"
          valor={props.desde}
          onChangeText={props.onCambiarDesde}
          teclado="numerico"
          placeholder="DD/MM/AAAA"
          ayuda="Se toma el mes de la fecha. Los extremos están incluidos."
          error={errores.desde}
          accionTeclado="siguiente"
          testID="deuda-desde"
        />
        <CampoTexto
          etiqueta="Hasta"
          valor={props.hasta}
          onChangeText={props.onCambiarHasta}
          teclado="numerico"
          placeholder="DD/MM/AAAA"
          error={errores.hasta}
          accionTeclado="enviar"
          onSubmitEditing={props.onAplicarFiltro}
          testID="deuda-hasta"
        />
        {errores.rango ? <Aviso tipo="error" mensaje={errores.rango} anuncio="alerta" /> : null}
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>
          Se filtran las facturas por el mes de su período, no por la fecha de transferencia. El saldo es el vigente: ya considera los pagos aprobados en cualquier fecha. Con los dos campos vacíos se muestra todo el historial.
        </Text>
        <Boton etiqueta="Aplicar filtro" onPress={props.onAplicarFiltro} testID="deuda-aplicar" />
        <Boton etiqueta="Ver todo el historial" variante="secundario" onPress={props.onVerTodo} testID="deuda-todo" />
      </Tarjeta>

      {estado.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Consultando la deuda…" /> : null}

      {estado.tipo === 'error' ? (
        estado.causa === 'permiso' ? (
          <EstadoPantalla
            tipo="error"
            titulo="No tenés permiso para ver esta información"
            descripcion="Tu cuenta no puede consultar estos datos. Si creés que es un error, contactá a la institución."
          />
        ) : estado.causa === 'rango' ? (
          <EstadoPantalla tipo="error" titulo="El rango de fechas no es válido" descripcion="Revisá las fechas e intentá nuevamente." />
        ) : (
          <EstadoPantalla
            tipo="error"
            titulo="No pudimos cargar la deuda"
            descripcion="No mostramos datos hasta poder validarlos. Intentá nuevamente."
            onReintentar={props.onReintentar}
          />
        )
      ) : null}

      {estado.tipo === 'ok' ? (
        <View style={{ gap: espacio.md }} testID="deuda-resultado">
          <Tarjeta>
            <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
              Total adeudado
            </Text>
            <View testID="deuda-total">
              <Cifra valor={estado.datos.totales.adeudado} total />
            </View>
            <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
              {rangoAplicado
                ? `Facturas de ${etiquetaPeriodo(`${rangoAplicado.desde.slice(0, 8)}01`)} a ${etiquetaPeriodo(`${rangoAplicado.hasta.slice(0, 8)}01`)} (período de factura).`
                : 'Todo el historial de facturas.'}
            </Text>
            <Dato rotulo="Ítems con saldo">{`${estado.datos.totales.itemsConSaldo} de ${estado.datos.totales.items}`}</Dato>
            <Dato rotulo="Facturas con saldo">{`${estado.datos.totales.facturasConSaldo} de ${estado.datos.totales.facturas}`}</Dato>
            <Dato rotulo="Saldo vigente al">{isoAEntrada(estado.datos.fechaCorte)}</Dato>
          </Tarjeta>

          {estado.datos.totales.hayInconsistencias ? (
            <Aviso
              tipo="advertencia"
              titulo="Hay importes para revisar con la institución"
              mensaje="Algunos importes registrados no coinciden entre sí. Mostramos los saldos tal como figuran, sin ajustes."
              anuncio="estado"
            />
          ) : null}

          {estado.datos.total === 0 ? (
            <EstadoPantalla
              tipo="vacio"
              titulo={rangoAplicado ? 'No hay ítems en este período' : 'Todavía no hay ítems facturados'}
              descripcion={rangoAplicado
                ? 'No hay facturas emitidas con un período dentro de las fechas elegidas.'
                : 'Cuando la institución emita facturas para este estudiante, vas a ver acá sus ítems.'}
            />
          ) : (
            agruparCargados(estado.datos.grupos, estado.datos.filas).map(visible => (
              <SeccionGrupo key={visible.grupo.clave} visible={visible} />
            ))
          )}

          {estado.datos.filas.length < estado.datos.total ? (
            <View style={{ gap: espacio.sm }}>
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
                Mostrando {estado.datos.filas.length} de {estado.datos.total} ítems. El total adeudado incluye todos.
              </Text>
              {estado.datos.falloMas ? (
                <Aviso tipo="error" mensaje="No pudimos cargar más ítems. Intentá nuevamente." anuncio="alerta" />
              ) : null}
              {estado.datos.cargandoMas ? (
                <EstadoPantalla tipo="cargando" mensaje="Cargando más ítems…" />
              ) : (
                <Boton etiqueta="Mostrar más ítems" variante="secundario" onPress={props.onCargarMas} testID="deuda-mas" />
              )}
            </View>
          ) : null}

          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro600 }]}>
            Los nombres de deportes y recorridos son los del catálogo actual. Cada ítem se paga completo; un ítem en verificación todavía figura como deuda.
          </Text>
        </View>
      ) : null}
    </View>
  )
}
