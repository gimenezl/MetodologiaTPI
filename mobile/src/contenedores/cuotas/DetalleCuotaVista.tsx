import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Aviso, Boton, EstadoPantalla, Importe, InsigniaEstado, Tarjeta } from '@/catalogo'
import {
  ETIQUETA_CONCEPTO,
  etiquetaPeriodo,
  formatearFecha,
  insigniaDeEstado,
  type DetalleCuota,
  type ItemCuota,
} from '@/servicios/cuotas'
import { color, espacio, estiloDeTexto } from '@/tokens'

export type ResultadoDetalle =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'no_encontrada' }
  | { tipo: 'ok'; detalle: DetalleCuota }

export interface DetalleCuotaVistaProps {
  resultado: ResultadoDetalle
  onVolver: () => void
  onReintentar: () => void
}

function estadoItem(item: ItemCuota): 'pagado' | 'verificacion' | 'pendiente' {
  if (item.importeCentavos > 0 && item.pagadoCentavos >= item.importeCentavos) return 'pagado'
  if (item.estadoPago === 'EN_VERIFICACION') return 'verificacion'
  return 'pendiente'
}

function FilaItem({ item }: { item: ItemCuota }): ReactElement {
  return (
    <View
      testID={`item-${item.itemId}`}
      style={{ gap: espacio.xs }}
      accessible
      accessibilityLabel={`${ETIQUETA_CONCEPTO[item.tipo]}`}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: espacio.sm }}>
        <Text style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>{ETIQUETA_CONCEPTO[item.tipo]}</Text>
        <Importe centavos={item.importeCentavos} />
      </View>
      {item.importeCentavos === 0 ? (
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Sin cargo</Text>
      ) : (
        <InsigniaEstado dominio="item" estado={estadoItem(item)} />
      )}
      {item.pagadoCentavos > 0 && item.pagadoCentavos < item.importeCentavos ? (
        <Text style={[estiloDeTexto('cuerpo'), { color: color.advertenciaTexto }]}>
          Imputación parcial registrada: revisá este ítem con la institución.
        </Text>
      ) : null}
    </View>
  )
}

export function DetalleCuotaVista({ resultado, onVolver, onReintentar }: DetalleCuotaVistaProps): ReactElement {
  return (
    <View style={{ gap: espacio.md }}>
      <Boton etiqueta="Volver a las cuotas" variante="enlace" onPress={onVolver} testID="volver-cuotas" />
      {resultado.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Consultando el detalle…" /> : null}
      {resultado.tipo === 'error' ? (
        <EstadoPantalla
          tipo="error"
          titulo="No pudimos cargar el detalle"
          descripcion="No mostramos datos hasta poder validarlos. Intentá nuevamente."
          onReintentar={onReintentar}
        />
      ) : null}
      {resultado.tipo === 'no_encontrada' ? (
        <EstadoPantalla
          tipo="vacio"
          titulo="Esta cuota no está disponible"
          descripcion="No existe o ya no tenés acceso a ella. Volvé al listado para ver las cuotas vigentes."
        />
      ) : null}
      {resultado.tipo === 'ok' ? (
        <>
          <Tarjeta>
            <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
              Cuota de {etiquetaPeriodo(resultado.detalle.cuota.periodo)}
            </Text>
            <InsigniaEstado dominio="factura" estado={insigniaDeEstado(resultado.detalle.cuota.estado)} />
            {resultado.detalle.cuota.estado === 'VENCIDA' ? (
              <Text style={[estiloDeTexto('cuerpo'), { color: color.peligroTexto }]}>
                Vencida el {formatearFecha(resultado.detalle.cuota.vencimiento)}.
              </Text>
            ) : (
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
                Vencimiento: {formatearFecha(resultado.detalle.cuota.vencimiento)}
              </Text>
            )}
            <View style={{ gap: espacio.xs }}>
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Importe total</Text>
              <Importe centavos={resultado.detalle.cuota.totalCentavos} total />
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Pagado con pagos aprobados</Text>
              <Importe centavos={resultado.detalle.cuota.pagadoCentavos} />
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Saldo</Text>
              <Importe centavos={resultado.detalle.cuota.saldoCentavos} />
            </View>
            {resultado.detalle.cuota.inconsistente ? (
              <Aviso
                tipo="advertencia"
                titulo="Revisá esta cuota con la institución"
                mensaje="Los importes registrados no coinciden entre sí. Mostramos el saldo tal como figura, sin ajustes."
                anuncio="estado"
              />
            ) : null}
          </Tarjeta>
          <Tarjeta>
            <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
              Conceptos
            </Text>
            {resultado.detalle.items.length === 0 ? (
              <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Esta cuota no tiene conceptos con cargo.</Text>
            ) : (
              resultado.detalle.items.map(item => <FilaItem key={item.itemId} item={item} />)
            )}
          </Tarjeta>
        </>
      ) : null}
    </View>
  )
}
