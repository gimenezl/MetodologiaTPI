# `ContextoHijo`

Familia: **identificación del hijo** (complementaria; incluida por reutilización demostrada). Tipos compartidos: [`contratos-vista.md`](../contratos-vista.md). Tokens: [`tokens.md`](../tokens.md).

## Propósito y escenarios

Mostrar, en cada pantalla económica, **de quién es la información**. Es la defensa de interfaz contra el error de operar sobre el hijo equivocado cuando un padre tiene más de un estudiante vinculado, y la forma de decirle al estudiante que ve «Información propia».

**Reutilización demostrada:** la función `contexto` del prototipo se invoca en 11 pantallas de `docs/parte3/EPT-96/prototipo/js/pantallas.mjs` (cuotas, detalle de factura, pagar, pago registrado, comprobante enviado, resultado incierto, comprobantes, archivo, período, deuda e inscripciones) y la barra aparece en 26 de los mockups y variantes de EPT-95 (cuenta de `class="ctx"` en `docs/parte3/EPT-95/fuentes/html/M*.html` y `V*.html`, sin contar wireframes; ver [matriz](../matriz-cobertura.md)). Por eso se promueve a pieza del catálogo.

No se crea una pieza de «selector de hijo»: la lista de hijos del selector (EPT-95 M02) es una composición de [`Tarjeta`](./03-tarjetas.md), [`InsigniaEstado`](./02-insignia-estado.md) y [`FilaClaveValor`](./04-listas-y-filas.md) en una sola pantalla.

## Referencias visuales

| Caso | Lámina |
|---|---|
| Padre con «Cambiar hijo» | [M03](../../EPT-95/disenos/mockups/M03-cuotas.png), [M04](../../EPT-95/disenos/mockups/M04-factura.png), [M08](../../EPT-95/disenos/mockups/M08-deuda-item.png) |
| Estudiante, «Información propia» | [V07](../../EPT-95/disenos/variantes/V07-cuotas-estudiante.png), [V14](../../EPT-95/disenos/variantes/V14-factura-estudiante.png) |
| Con dato adicional («Pago por …») | [M06](../../EPT-95/disenos/mockups/M06-comprobantes.png) |
| Selector (origen del contexto) | [M02](../../EPT-95/disenos/mockups/M02-selector-hijo.png) |

## Variantes

| Variante | Contenido | Quién la ve |
|---|---|---|
| `padre` | Nombre del hijo + enlace «Cambiar hijo» | PADRE con al menos un hijo vinculado |
| `propio` | Nombre + «Información propia», sin enlace | ESTUDIANTE |
| `con-detalle` | Nombre + texto de detalle (por ejemplo «Pago por ARS 63.606,65») | Pantallas de comprobante |

## Props y tipos

```ts
import type { ReactElement } from 'react'

export type ContextoHijoProps =
  | { variante: 'padre'; hijo: HijoVista; onCambiarHijo: () => void }
  | { variante: 'propio'; hijo: HijoVista }
  | { variante: 'con-detalle'; hijo: HijoVista; detalle: string }

export declare function ContextoHijo(props: ContextoHijoProps): ReactElement
```

El estudiante **no recibe** `onCambiarHijo`: la forma del tipo impide ofrecer un selector donde no corresponde.

## Eventos y callbacks

| Evento | Contrato |
|---|---|
| `onCambiarHijo()` | El contenedor vuelve al selector y **descarta** selección, borrador y filtros del hijo anterior (EPT-96 «Cambiar hijo») |

## Estados

| Estado | Aplica | Nota |
|---|---|---|
| Normal | Sí | Las tres variantes |
| Carga | Sí | El nombre del hijo suele estar disponible desde el selector; si no, el contenedor muestra el esqueleto de la pantalla completa |
| Deshabilitado, vacío, error, selección | No | El selector sin vínculos lo cubre un `Aviso` informativo (V06) |

## Tokens y dimensiones

- Fondo `primario50`, borde `borde.fino` `primario200`, radio `radio.md`, relleno 10 × 12, texto `texto.aviso` (15, peso 500, color `primario700`; «Cambiar hijo» ≥ 48 de alto es una medida del prototipo de EPT-96), ícono `usuario` de 18, `gap` 8. El enlace «Cambiar hijo» usa `primario600` subrayado y mide ≥ 48 de alto.
- Es el **primer** elemento tras el encabezado y el título, según el orden de EPT-95: título, contexto del hijo, saldo, vencimiento, acción.

## Contenido largo

- El nombre (por ejemplo, un nombre compuesto) se parte en líneas; «Cambiar hijo» baja a la línea siguiente si no entra. Sin truncado.

## Accesibilidad

| Aspecto | Contrato |
|---|---|
| Lectura | Una sola frase: «Información de Mateo Ejemplo» (padre) o «Información propia de Mateo Ejemplo» (estudiante) |
| Enlace | `accessibilityRole="link"` con etiqueta «Cambiar hijo» y objetivo ≥ 48 |
| Ícono | Decorativo |
| Orden | Primero en el orden de lectura de la pantalla, antes del saldo |

## Responsabilidad y exclusiones

| Hace | No hace |
|---|---|
| Mostrar el hijo cuya información se ve y exponer «Cambiar hijo» | Decidir qué hijos están vinculados ni validar el vínculo |
| Impedir visualmente el selector para ESTUDIANTE (por tipo) | Filtrar datos: el servidor y RLS limitan lo que cada persona ve |

## Ejemplo de composición

```tsx
import type { ReactElement } from 'react'

/** Lo que la persona puede hacer en esta factura. Lo decide el contenedor; la vista solo lo dibuja. */
export type AccionDeFactura =
  | { tipo: 'seleccionar'; onSeleccionarItems: () => void }
  | { tipo: 'solo-consulta' }
  | { tipo: 'sin-items' }

export interface DetalleDeFacturaVistaProps {
  /** Variante y callbacks ya elegidos por el contenedor según quién mira. */
  contexto: ContextoHijoProps
  factura: FacturaVista
  accion: AccionDeFactura
}

export function DetalleDeFacturaVista(props: DetalleDeFacturaVistaProps): ReactElement {
  return (
    <View style={{ gap: 16 }}>
      <ContextoHijo {...props.contexto} />
      <Tarjeta acento={props.factura.estado}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
          <Text accessibilityRole="header">{props.factura.periodo}</Text>
          <InsigniaEstado dominio="factura" estado={props.factura.estado} />
        </View>
        <FilaClaveValor etiqueta="Vencimiento" valor={<Fecha fecha={props.factura.vencimiento} />} />
      </Tarjeta>
      <ListaFilas
        titulo="Ítems"
        filas={props.factura.items.map(item => <FilaItem key={item.id} item={item} />)}
      />
      <Tarjeta>
        <FilaClaveValor etiqueta="Importe total" valor={<Importe centavos={props.factura.importe} />} />
        <FilaClaveValor etiqueta="Pagado (aprobado)" valor={<Importe centavos={props.factura.pagado} />} />
        <FilaClaveValor etiqueta="Saldo" valor={<Importe centavos={props.factura.saldo} />} enfasis />
      </Tarjeta>
      {props.accion.tipo === 'seleccionar' ? (
        <Boton etiqueta="Seleccionar ítems para pagar" onPress={props.accion.onSeleccionarItems} />
      ) : null}
      {props.accion.tipo === 'solo-consulta' ? (
        <Aviso tipo="informativo" titulo="Solo consulta." mensaje="El pago y la carga de comprobantes los realiza tu padre o madre vinculado." icono="candado" />
      ) : null}
      {props.accion.tipo === 'sin-items' ? (
        <Aviso tipo="informativo" mensaje="Esta factura no tiene ítems disponibles para pagar." />
      ) : null}
    </View>
  )
}
```

> La vista **no recibe el rol**: el contenedor arma `contexto` (`propio` para un estudiante, `padre` para un padre vinculado) y `accion`. «Solo consulta» y «sin ítems» son casos distintos y se distinguen en el contenedor: un padre con una factura Pagada ve el segundo, no el primero. Los textos provienen del prototipo de EPT-96.
