# `InsigniaEstado`

Familia: **insignias (badges)**. Tipos compartidos: [`contratos-vista.md`](../contratos-vista.md). Tokens y señales redundantes: [`tokens.md`](../tokens.md#estados-institucionales-y-su-señal-redundante).

## Propósito y escenarios

Comunica el estado económico de una factura (cuota), de un ítem o de un pago. Aparece en tarjetas de cuota, filas de ítem, tarjetas de pago, selector de hijo y deuda por ítem.

| Escenario | Dominio | Estados |
|---|---|---|
| Estado de la cuota / factura | `factura` | Pendiente, Pago parcial, Pagada, Vencida |
| Estado de un ítem de la factura | `item` | Pagado, En verificación, Pendiente |
| Estado de un pago registrado | `pago` | Aprobado, Pendiente de verificación, Rechazado |

## Referencias visuales

| Qué muestra | Lámina |
|---|---|
| Los cuatro estados de cuota juntos, con su guía | [V13](../../EPT-95/disenos/variantes/V13-estados-de-cuota.png) |
| Pago parcial y Vencida en lista | [M03](../../EPT-95/disenos/mockups/M03-cuotas.png) |
| Pendiente en lista | [V09](../../EPT-95/disenos/variantes/V09-cuotas-pendiente.png) |
| Pagada en lista | [V08](../../EPT-95/disenos/variantes/V08-cuotas-pagadas.png) |
| Estados por ítem (Pagado, En verificación, Pendiente) | [M04](../../EPT-95/disenos/mockups/M04-factura.png), [M05](../../EPT-95/disenos/mockups/M05-seleccion-y-pago.png) |
| Pago pendiente de verificación | [V16](../../EPT-95/disenos/variantes/V16-pago-registrado.png), [V20](../../EPT-95/disenos/variantes/V20-comprobantes-otro-padre.png) |

Referencia de comportamiento en el prototipo: `ESTADO_FACTURA`, `ESTADO_ITEM`, `ESTADO_PAGO` e `insignia` en `docs/parte3/EPT-96/prototipo/js/vista.mjs`.

## Variantes

Una variante por combinación dominio–estado. Cada una porta **texto + ícono + trazo + color** (nunca solo color).

| Dominio · estado | Texto | Ícono | Trazo | Fondo / texto / borde |
|---|---|---|---|---|
| factura · `pendiente` | Pendiente | `reloj` | punteado | `primario50` / `primario700` / `primario500` |
| factura · `parcial` | Pago parcial | `parcial` | continuo | `advertenciaFondo` / `advertenciaTexto` / `advertenciaTexto` |
| factura · `pagada` | Pagada | `check` | continuo | `exitoFondo` / `exitoTexto` / `exitoTexto` |
| factura · `vencida` | Vencida | `alerta` | continuo grueso | `peligroFondo` / `peligroTexto` / `peligroTexto` |
| item · `pagado` | Pagado | `check` | continuo | como Pagada |
| item · `verificacion` | En verificación | `ojo` | punteado fino | `neutro100` / `neutro700` / `neutro600` |
| item · `pendiente` | Pendiente | `reloj` | punteado | como Pendiente |
| pago · `aprobado` | Aprobado | `check` | continuo | como Pagada |
| pago · `pendiente` | Pendiente de verificación | `ojo` | punteado fino | como En verificación |
| pago · `rechazado` | Rechazado | `alerta` | continuo grueso | como Vencida |

## Props y tipos

```ts
import type { ReactElement } from 'react'

export type InsigniaEstadoProps =
  | { dominio: 'factura'; estado: EstadoFactura }
  | { dominio: 'item'; estado: EstadoItem }
  | { dominio: 'pago'; estado: EstadoPago }

export declare function InsigniaEstado(props: InsigniaEstadoProps): ReactElement
```

La unión discriminada impide, en tiempo de compilación, mezclar un estado de ítem con un dominio de factura. No hay prop `texto`: el texto sale de la tabla de variantes para que el mismo estado se lea igual en todas las pantallas.

## Eventos y callbacks

Ninguno. La insignia es informativa; no es tocable.

## Estados

| Estado de la pieza | Aplica | Nota |
|---|---|---|
| Normal | Sí | Una de las diez variantes |
| Deshabilitado, carga, error, selección | No | La pieza no tiene interacción; el estado de carga de una lista lo cubre [`EstadoPantalla`](./06-avisos-y-estados.md) |
| Vacío | No | Si no hay estado que mostrar, no se renderiza la insignia |

## Reglas de negocio que la pieza **no** decide

- **Vencida prevalece** sobre Pago parcial cuando hay saldo después del vencimiento (EPT-83; [`estados-y-roles.md`](../../EPT-95/estados-y-roles.md)). La regla la aplica el servidor al derivar `EstadoFactura`; la insignia solo dibuja el valor recibido.
- **Pago pendiente de verificación no reduce saldo** ni se presenta como pago aprobado: el texto de la variante `pago · pendiente` es «Pendiente de verificación», nunca «Pagado».

## Tokens y dimensiones

- Relleno `10` horizontal y `4` vertical; radio `radio.pastilla`; texto `texto.insignia`; ícono de 16; separación `6` entre ícono y texto; borde `borde.insignia` (`borde.enfasis` para Vencida y Rechazado).
- Ancho del contenido; no se estira.

## Contenido largo y escalado

- «Pendiente de verificación» es el texto más largo. La insignia **puede partirse en dos líneas**; no se corta ni se elide. En el diseño la insignia es `nowrap` a 390 px porque cabe; en nativo debe permitirse el salto cuando el texto escala. Si la fila no alcanza, la insignia pasa debajo del título (la fila usa `flexWrap`, ver [`04-listas-y-filas.md`](./04-listas-y-filas.md)).

## Accesibilidad

| Aspecto | Contrato |
|---|---|
| Rol | Texto estático (`accessibilityRole="text"`); no es un control |
| Lectura | El texto visible ya describe el estado; el ícono es decorativo (`accessible={false}` / `importantForAccessibility="no"` en Android) para no leerlo dos veces |
| Información no cromática | Texto, forma de ícono y trazo distinguen los estados incluso en escala de grises (lámina [V13](../../EPT-95/disenos/variantes/V13-estados-de-cuota.png)) |
| Contraste | Mínimo 7,22:1 en las insignias de estado (ver `tokens.md`) |
| Dentro de una tarjeta tocable | La tarjeta compone una única lectura que incluye el estado (ver [`03-tarjetas.md`](./03-tarjetas.md)) |

## Responsabilidad y exclusiones

| Hace | No hace |
|---|---|
| Traduce un estado ya derivado a texto + ícono + trazo + color | Derivar el estado (Vencida/Parcial/Pagada) |
| Mantiene el mismo texto en todas las pantallas | Mostrar importes, fechas o permisos |
| | Decidir si un ítem se puede seleccionar |

## Ejemplo de composición

```tsx
import type { ReactElement } from 'react'

export function EncabezadoDeFacturaVista({ periodo, estado }: { periodo: string; estado: EstadoFactura }): ReactElement {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
      <Text accessibilityRole="header">{periodo}</Text>
      <InsigniaEstado dominio="factura" estado={estado} />
    </View>
  )
}
```
