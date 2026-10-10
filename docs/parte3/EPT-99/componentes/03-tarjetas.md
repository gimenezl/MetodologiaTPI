# `Tarjeta`, `TarjetaCuota` y `TarjetaPago`

Familia: **tarjetas**. Tipos compartidos: [`contratos-vista.md`](../contratos-vista.md). Tokens: [`tokens.md`](../tokens.md).

## Propósito y escenarios

| Pieza | Para qué | Dónde se usa (EPT-95 / EPT-96) |
|---|---|---|
| `Tarjeta` | Superficie base: borde, radio, relleno y separación interna. Agrupa filas y secciones | Casi todas las pantallas (26 apariciones literales de `class: 'card` en `pantallas.mjs`) |
| `TarjetaCuota` | **Tarjeta de cuota/factura**: período, estado, vencimiento, importe y saldo; tocable hacia el detalle | Cuotas, facturas sin pagos por período |
| `TarjetaPago` | Registro de un pago: fecha de transferencia, ítems, importes, número de operación y estado del comprobante | Pagos y comprobantes, consulta por período |

La tarjeta del selector de hijo (nombre, peor estado, saldo total) es una **composición** de `Tarjeta`, `InsigniaEstado` y `FilaClaveValor` dentro de la pantalla; aparece en una sola pantalla y por eso **no** se promueve a pieza del catálogo.

## Referencias visuales

| Pieza | Lámina |
|---|---|
| `TarjetaCuota` Pago parcial y Vencida | [M03](../../EPT-95/disenos/mockups/M03-cuotas.png), [V07](../../EPT-95/disenos/variantes/V07-cuotas-estudiante.png) |
| `TarjetaCuota` Pendiente | [V09](../../EPT-95/disenos/variantes/V09-cuotas-pendiente.png) |
| `TarjetaCuota` Pagada | [V08](../../EPT-95/disenos/variantes/V08-cuotas-pagadas.png) |
| `TarjetaCuota` con texto al 200 % | [V26](../../EPT-95/disenos/variantes/V26-cuotas-texto-200.png) |
| Los cuatro estados | [V13](../../EPT-95/disenos/variantes/V13-estados-de-cuota.png) |
| `TarjetaPago` | [M07](../../EPT-95/disenos/mockups/M07-periodo.png), [V20](../../EPT-95/disenos/variantes/V20-comprobantes-otro-padre.png), [V21](../../EPT-95/disenos/variantes/V21-comprobantes-estudiante.png) |

Referencia de comportamiento en el prototipo: `tarjetaCuota` y `tarjetaPago` en `docs/parte3/EPT-96/prototipo/js/pantallas.mjs`.

## Variantes

| Pieza | Variante | Diferencia visual |
|---|---|---|
| `Tarjeta` | `base` | Fondo `superficie`, borde `borde.fino` `neutro200`, radio `radio.lg`, relleno 16, separación interna 12 |
| `TarjetaCuota` | por `EstadoFactura` | Trazo izquierdo `borde.estado` (6) en `primario500` (Pendiente), `advertencia` (Pago parcial), `exito` (Pagada) o `peligro` (Vencida). Vencida además usa fondo `peligroFondo` y borde `peligroTexto` |
| `TarjetaPago` | por `EstadoPago` | Misma superficie; el estado lo porta `InsigniaEstado` |

El trazo lateral **refuerza** el estado pero no lo comunica solo: la insignia con texto e ícono está siempre presente.

## Props y tipos

```ts
import type { ReactElement, ReactNode } from 'react'

export interface TarjetaProps {
  children: ReactNode
  /** Si se informa, la tarjeta completa es tocable (≥ 48 de alto) y se anuncia como botón. */
  onPress?: () => void
  /** Lectura compuesta cuando la tarjeta es tocable (ver Accesibilidad). */
  etiquetaAccesible?: string
  pistaAccesible?: string
  /** Estado que dibuja el trazo lateral; solo lo usan las tarjetas de cuota. */
  acento?: EstadoFactura
}

export declare function Tarjeta(props: TarjetaProps): ReactElement

export interface TarjetaCuotaProps {
  cuota: CuotaVista
  /** Abre el detalle de la factura. El destino lo conoce el contenedor. */
  onPress: (cuotaId: string) => void
}

export declare function TarjetaCuota(props: TarjetaCuotaProps): ReactElement

export interface TarjetaPagoProps {
  pago: PagoVista
  /** Solo se informa si el contenedor permite cargar comprobante para este pago. */
  onCargarComprobante?: (pagoId: string) => void
  onAbrirOriginal?: (pagoId: string) => void
  /** Texto cuando el original existe pero esta persona no puede abrirlo (estudiante u otro padre). */
  avisoOriginalRestringido?: string
}

export declare function TarjetaPago(props: TarjetaPagoProps): ReactElement
```

## Eventos y callbacks

| Pieza | Evento | Argumento | Cuándo |
|---|---|---|---|
| `Tarjeta` | `onPress` | — | Toque en la tarjeta completa |
| `TarjetaCuota` | `onPress` | `cuotaId` | Toque en cualquier punto de la tarjeta |
| `TarjetaPago` | `onCargarComprobante` | `pagoId` | Botón «Cargar comprobante», solo si el callback existe |
| `TarjetaPago` | `onAbrirOriginal` | `pagoId` | Botón «Ver archivo», solo si `pago.puedeAbrirOriginal` es `true` y hay comprobantes |

Que el callback no exista es la forma de decir «esta acción no corresponde»: la vista no pregunta por el rol.

## Estados

| Estado | `Tarjeta` / `TarjetaCuota` | `TarjetaPago` |
|---|---|---|
| Normal | Según el estado de la cuota | Pago aprobado o pendiente de verificación |
| Presionado | Propuesta: fondo `primario50`; **no ilustrado en EPT-95** | — |
| Deshabilitado | No aplica: una cuota sin permiso no se muestra | No aplica |
| Carga | Se sustituye por esqueleto en la lista ([`EstadoPantalla`](./06-avisos-y-estados.md)) | Ídem |
| Vacío | No aplica a la pieza; la lista usa `EstadoPantalla` | «Pago registrado sin comprobante» cuando `fechaTransferencia` es `null` |
| Error | No aplica a la pieza | — |
| Selección | No aplica (la selección vive en [`FilaSeleccionable`](./04-listas-y-filas.md)) | — |
| Original restringido | — | Muestra `avisoOriginalRestringido` con ícono de candado; sin botón de archivo ([V20](../../EPT-95/disenos/variantes/V20-comprobantes-otro-padre.png), [V21](../../EPT-95/disenos/variantes/V21-comprobantes-estudiante.png)) |

## Contenido de `TarjetaCuota` (orden fijo)

1. Fila título: `periodo` (`texto.subtitulo`) a la izquierda, `InsigniaEstado` a la derecha (se acomodan en dos líneas si no entran).
2. «Vencimiento» → fecha `dd/mm/aaaa` en `texto.importe`.
3. «Importe» → [`Importe`](./04-listas-y-filas.md).
4. «Saldo» → `Importe`, énfasis (negrita).

El orden respeta la jerarquía de EPT-95: título, estado, vencimiento, saldo, acción.

## Tokens y dimensiones

- `Tarjeta`: relleno 16, `gap` 12, borde 1, radio 16. `TarjetaCuota` suma `borderLeftWidth: 6`.
- Si es tocable: `minHeight: 48` (siempre se cumple por contenido).
- Fondo de pantalla `neutro50`; la tarjeta usa `superficie` para separarse.

## Contenido largo

- Período y nombres de ítem se **parten en líneas**; no se truncan.
- Importes y fechas **no se parten ni se cortan**: se les da `flexShrink: 0` y, si la fila no alcanza, la fila entera pasa a dos líneas (`flexWrap: 'wrap'`). Es la misma regla que `overflow-wrap: anywhere` + `nowrap` del diseño (ver [V26](../../EPT-95/disenos/variantes/V26-cuotas-texto-200.png)).
- `TarjetaPago` lista tantos conceptos como tenga el pago, sin límite inventado.

## Accesibilidad

| Aspecto | Contrato |
|---|---|
| Tarjeta tocable | `Pressable` con `accessibilityRole="button"` y **una sola lectura**: «Septiembre 2026, Vencida, vence 10/09/2026, saldo ARS 41.266,05» (la compone la vista a partir del DTO) |
| Pista | `accessibilityHint`: «Abre el detalle de la factura» |
| Contenido interno | Los hijos de una tarjeta tocable no son accesibles por separado (`accessible` en el contenedor) para evitar doble lectura |
| Encabezado | El período es `accessibilityRole="header"` cuando la tarjeta **no** es tocable |
| Estado | La insignia queda incluida en la lectura compuesta |
| Objetivo táctil | Toda la tarjeta |

La lectura compuesta y el modo en que cada lector anuncia «ARS» se verifican en dispositivo (TalkBack/VoiceOver) en EPT-102; este documento no los certifica.

## Responsabilidad y exclusiones

| Hace | No hace |
|---|---|
| Muestra período, estado, vencimiento, importe y saldo recibidos | Calcular saldo, estado o importe |
| Informa el toque con `cuotaId` | Navegar o cargar la factura |
| Muestra «archivo restringido» si el contenedor lo indica | Decidir quién ve el original (RLS y Storage lo deciden) |
| Permite el trazo lateral y la insignia coherentes con el estado | Ordenar la lista (el prototipo de EPT-96 ordena Vencida, Pago parcial, Pendiente y Pagada; el orden productivo lo fija el contenedor) |

## Ejemplo de composición

```tsx
import type { ReactElement } from 'react'

export interface ListaDeCuotasVistaProps {
  cuotas: CuotaVista[]
  onAbrirCuota: (cuotaId: string) => void
}

export function ListaDeCuotasVista({ cuotas, onAbrirCuota }: ListaDeCuotasVistaProps): ReactElement {
  return (
    <View role="list" style={{ gap: 16 }}>
      {cuotas.map(cuota => (
        <TarjetaCuota key={cuota.id} cuota={cuota} onPress={onAbrirCuota} />
      ))}
    </View>
  )
}
```

Para listas largas el contenedor puede reemplazar `View` por `FlatList` con `keyExtractor={cuota => cuota.id}` sin cambiar `TarjetaCuota`.
