# Listas y filas: `ListaFilas`, `FilaClaveValor`, `Importe`, `Fecha`, `FilaItem`, `FilaSeleccionable`, `FilaArchivo` y `ResumenTotal`

Familia: **listas y filas**. Tipos compartidos: [`contratos-vista.md`](../contratos-vista.md). Tokens: [`tokens.md`](../tokens.md).

## Propósito y escenarios

| Pieza | Para qué | Reutilización demostrada en `pantallas.mjs` (EPT-96) |
|---|---|---|
| `Importe` | Mostrar un importe en ARS con dos decimales, sin cortes | 23 usos en las pantallas económicas |
| `Fecha` | Fecha civil en `dd/mm/aaaa`, sin cortes | Vencimientos, fechas de transferencia |
| `FilaClaveValor` | Par etiqueta → valor («Vencimiento», «Saldo», «N.º de operación») | 35 usos (`fila`) |
| `FilaItem` | Ítem de una factura: concepto, estado e importe (solo lectura) | Detalle de factura, deuda por ítem |
| `FilaSeleccionable` | Ítem que el padre puede marcar para pagar | Selección y pago (una pantalla; es la única pieza con casilla) |
| `FilaArchivo` | Archivo adjunto con nombre, tamaño, error y «Quitar» | Carga de comprobante y vista del comprobante |
| `ListaFilas` | Agrupar filas con título de sección y separadores | Ítems de una factura, archivos adjuntos |
| `ResumenTotal` | Bloque destacado con total calculado | Selección y pago, deuda por ítem (2 pantallas) |

`FilaSeleccionable` se incluye aunque se use en una pantalla porque es la **única** pieza con selección y su regla de objetivo táctil (fila completa de 48) es transversal y estaba especificada en EPT-95. Las listas **extensas** (cuotas, pagos) no pasan por `ListaFilas`: el contenedor usa `FlatList` con `keyExtractor` y estas filas como `renderItem` (ver [handoff](../handoff-expo-react-native.md)).

## Referencias visuales

| Pieza | Lámina |
|---|---|
| `FilaItem` (Pagado, En verificación, Pendiente) | [M04](../../EPT-95/disenos/mockups/M04-factura.png), [V14](../../EPT-95/disenos/variantes/V14-factura-estudiante.png) |
| `FilaSeleccionable` marcada, no marcada y no seleccionable | [M05](../../EPT-95/disenos/mockups/M05-seleccion-y-pago.png), [V15](../../EPT-95/disenos/variantes/V15-seleccion-validacion.png) |
| `ResumenTotal` | [M05](../../EPT-95/disenos/mockups/M05-seleccion-y-pago.png), [M08](../../EPT-95/disenos/mockups/M08-deuda-item.png), [V23](../../EPT-95/disenos/variantes/V23-deuda-estudiante.png) |
| `FilaArchivo` normal y con error | [M06](../../EPT-95/disenos/mockups/M06-comprobantes.png), [V17](../../EPT-95/disenos/variantes/V17-comprobante-validacion.png) |
| `FilaClaveValor` / `Importe` | [M03](../../EPT-95/disenos/mockups/M03-cuotas.png), [M08](../../EPT-95/disenos/mockups/M08-deuda-item.png) |
| Importes con texto ampliado | [V26](../../EPT-95/disenos/variantes/V26-cuotas-texto-200.png) |

Referencia de comportamiento: `importe`, `fila` en `vista.mjs`; selección y archivos en `pantallas.mjs` (`pagar`, `comprobante`).

## Variantes

| Pieza | Variante | Diferencia |
|---|---|---|
| `Importe` | única | Siempre Geist Mono 500 (`.mono`): el diseño no cambia su peso ni siquiera en el saldo |
| `FilaClaveValor` | `normal` / `enfasis` | Con `enfasis` la etiqueta va en peso 700; el importe conserva su peso 500 |
| `FilaItem` | por `EstadoItem` | La insignia cambia; el importe permanece |
| `FilaSeleccionable` | marcada · sin marcar · no seleccionable | Casilla con relleno `primario500` y tilde / casilla vacía / casilla gris sin acción |
| `FilaArchivo` | normal · con error | Con error muestra mensaje y borde de aviso |
| `ResumenTotal` | única | Fondo `primario700`, texto blanco |

## Props y tipos

```ts
import type { ReactElement, ReactNode } from 'react'

export interface ImporteProps {
  centavos: Centavos
}
/** Dibuja `ARS 63.606,65` (NBSP entre `ARS` y la cifra). Nunca recibe un importe «a calcular». */
export declare function Importe(props: ImporteProps): ReactElement

export interface FechaProps {
  fecha: FechaCivil
}
/** Dibuja `dd/mm/aaaa` en `texto.importe`. Solo reordena el texto: no usa zona horaria ni hora. */
export declare function Fecha(props: FechaProps): ReactElement

export interface FilaClaveValorProps {
  etiqueta: string
  /** Texto o un `Importe` / `InsigniaEstado`. */
  valor: ReactNode
  enfasis?: boolean
}
export declare function FilaClaveValor(props: FilaClaveValorProps): ReactElement

export interface FilaItemProps {
  item: ItemVista
}
export declare function FilaItem(props: FilaItemProps): ReactElement

export interface FilaSeleccionableProps {
  item: ItemVista
  seleccionado: boolean
  /** `false` para pagados, en verificación o cuando la persona no puede seleccionar. Lo decide el contenedor. */
  seleccionable: boolean
  onToggle: (itemId: string) => void
}
export declare function FilaSeleccionable(props: FilaSeleccionableProps): ReactElement

export interface FilaArchivoProps {
  archivo: ArchivoVista
  /** Texto de tamaño ya formateado, por ejemplo «1,2 MB». */
  tamanoTexto: string
  /** Si no se informa, no hay botón «Quitar». */
  onQuitar?: (archivoId: string) => void
}
export declare function FilaArchivo(props: FilaArchivoProps): ReactElement

export interface ListaFilasProps {
  titulo?: string
  etiquetaAccesible?: string
  filas: ReactElement[]
}
export declare function ListaFilas(props: ListaFilasProps): ReactElement

export interface ResumenTotalProps {
  titulo: string
  total: Centavos
  /** Texto bajo la cifra, por ejemplo «2 ítems seleccionados». Lo redacta el contenedor. */
  leyenda?: string
}
export declare function ResumenTotal(props: ResumenTotalProps): ReactElement
```

Formato de `Importe`: separador de miles `.`, decimal `,`, siempre dos decimales, prefijo `ARS` + espacio no separable. Es una función **pura** de presentación (en el prototipo, `formatoArs` de `dinero.mjs`) y debe implementarse sin depender de `Intl`, porque el soporte de datos regionales cambia entre motores de JavaScript y plataformas.

## Eventos y callbacks

| Pieza | Evento | Argumento | Contrato |
|---|---|---|---|
| `FilaSeleccionable` | `onToggle` | `itemId` | Solo se emite si `seleccionable`. El contenedor alterna la selección y entrega el resumen; si lo anticipa en el cliente es una cifra provisional y el servidor calcula el definitivo (README A2) |
| `FilaArchivo` | `onQuitar` | `archivoId` | Quita del borrador local; no borra nada en el servidor |

Ninguna otra fila emite eventos.

## Estados

| Pieza | Normal | Deshabilitado | Carga | Vacío | Error | Selección |
|---|---|---|---|---|---|---|
| `FilaItem` | Concepto, insignia, importe | — | — | — | — | — |
| `FilaSeleccionable` | Sin marcar | No seleccionable: casilla `neutro200` con borde `neutro500`; la fila sigue visible con su insignia | — | — | — | Marcada: casilla `primario500` con tilde |
| `FilaArchivo` | Nombre y tamaño | — | — | — | Mensaje de `archivo.error`, ícono de alerta | — |
| `ListaFilas` | Con filas | — | La cubre `EstadoPantalla` | Con `filas` vacío no se renderiza: el contenedor muestra `EstadoPantalla` | — | — |
| `ResumenTotal` | Cifra y leyenda | — | — | Con total 0 muestra `ARS 0,00` | — | — |

## Tokens y dimensiones

- Fila: `padding vertical` 12, separador superior `borde.fino` `neutro200` (salvo la primera), `gap` 12 entre casilla/cuerpo/importe.
- Casilla visible: 32 × 32, `borde.enfasis`, `radio.sm`; marcada `primario500`; no seleccionable `neutro200`/`neutro500`. La **fila completa** mide ≥ 48 y es el objetivo táctil.
- `Importe`: `texto.importe` (Geist Mono 500, 16). `ResumenTotal`: `texto.importeTotal` (28/600), fondo `primario700`, radio `radio.lg`, relleno 16.
- `FilaArchivo`: borde `borde.fino` `neutro300`, radio `radio.md`, relleno 10 × 12, ícono 24, botón «Quitar» de 48 × 48 (medida del prototipo de EPT-96, `.icono-boton`; en V17 es un ícono suelto de 22).

## Contenido largo y escalado

- **Importes y fechas no se cortan ni se parten**: `flexShrink: 0` y no se usa `numberOfLines`. Si la fila no alcanza, el importe baja a una segunda línea (`flexWrap: 'wrap'` en la fila), como en [V26](../../EPT-95/disenos/variantes/V26-cuotas-texto-200.png).
- Concepto y nombre de archivo se parten en varias líneas; no se elide el texto.
- `ResumenTotal` usa 28 y el diseño lo reduce con `min(1.75rem, 8vw)` en el prototipo para que la cifra entre en 320 px. Con texto ampliado al 200 % una cifra de siete dígitos puede no caber en una línea. La cifra **no puede cortarse**; la técnica (permitir el salto entre `ARS` y la cifra, reducir el tamaño con `adjustsFontSizeToFit` o limitar solo esta cifra con `maxFontSizeMultiplier`) se elige y se verifica en dispositivo en EPT-102. Es un punto abierto, no una regla aprobada.

## Accesibilidad

| Pieza | Contrato |
|---|---|
| `FilaSeleccionable` | `Pressable` en toda la fila con `accessibilityRole="checkbox"` y `accessibilityState={{ checked: seleccionado, disabled: !seleccionable }}`. Etiqueta compuesta: «Comedor, Pendiente, ARS 22.340,60». Sin gesto alternativo: el toque en la fila alterna |
| `ResumenTotal` | `accessibilityLiveRegion="polite"` en Android y, en iOS, anuncio mediante `AccessibilityInfo.announceForAccessibility` al cambiar el total (uno u otro por plataforma, para no duplicar el anuncio) |
| `ListaFilas` | `role="list"`; cada fila `role="listitem"`; el título es `accessibilityRole="header"` |
| `FilaArchivo` | Botón «Quitar» con `accessibilityLabel` = «Quitar {nombre}» (no solo «Quitar») y objetivo de 48 × 48; el error es texto visible, no solo color |
| `Importe` | Lectura legible del importe («63.606 pesos con 65 centavos») mediante `accessibilityLabel`; **a verificar** con TalkBack/VoiceOver cómo se lee «ARS» |

## Responsabilidad y exclusiones

| Hace | No hace |
|---|---|
| Dibujar filas, casillas, importes y totales recibidos | **Sumar** ítems ni recalcular el total definitivo |
| Emitir `onToggle` / `onQuitar` | Decidir qué ítems son seleccionables (pagados y en verificación no lo son) |
| Mantener objetivos táctiles y lectura accesible | Validar tipo o tamaño del archivo (`archivo.error` ya viene resuelto) |

El **total** que muestra `ResumenTotal` llega por prop. En el prototipo se suma en el cliente; en producción el importe definitivo lo calcula el servidor (`registrar_pago` devuelve `total_calculado`, EPT-98 §3). Si durante la selección se muestra una cifra provisional, es una decisión del contenedor y debe indicarse en `leyenda`; es un **punto abierto** (ver [README](../README.md#supuestos-y-puntos-abiertos)).

## Ejemplo de composición

```tsx
import type { ReactElement } from 'react'

/** Ítem ya evaluado por el contenedor: la vista no decide quién puede marcarse. */
export interface ItemParaSeleccionar {
  item: ItemVista
  seleccionado: boolean
  seleccionable: boolean
}

/** Una factura con sus ítems, como en M05: tarjeta por factura con su estado. */
export interface GrupoParaSeleccionar {
  id: string
  periodo: string
  estado: EstadoFactura
  items: ItemParaSeleccionar[]
}

export interface SeleccionDePagoVistaProps {
  grupos: GrupoParaSeleccionar[]
  total: Centavos
  leyendaTotal: string
  onToggle: (itemId: string) => void
}

export function SeleccionDePagoVista(props: SeleccionDePagoVistaProps): ReactElement {
  return (
    <View style={{ gap: 16 }}>
      {props.grupos.map(grupo => (
        <Tarjeta key={grupo.id}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
            <Text accessibilityRole="header">{grupo.periodo}</Text>
            <InsigniaEstado dominio="factura" estado={grupo.estado} />
          </View>
          <ListaFilas
            filas={grupo.items.map(({ item, seleccionado, seleccionable }) => (
              <FilaSeleccionable
                key={item.id}
                item={item}
                seleccionado={seleccionado}
                seleccionable={seleccionable}
                onToggle={props.onToggle}
              />
            ))}
          />
        </Tarjeta>
      ))}
      <ResumenTotal titulo="Total a transferir" total={props.total} leyenda={props.leyendaTotal} />
    </View>
  )
}
```

> El contenedor arma `ItemParaSeleccionar` aplicando la regla de EPT-95 «los pagados y en verificación no se seleccionan» y las capacidades de quien mira. La regla efectiva la valida el servidor al registrar el pago; la vista solo respeta el booleano.
