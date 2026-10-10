# `Boton`

Familia: **botones**. Tipos compartidos: [`contratos-vista.md`](../contratos-vista.md). Tokens: [`tokens.md`](../tokens.md).

## Propósito y escenarios

Acción explícita del usuario: ingresar, reintentar, registrar un pago, cargar o enviar un comprobante, cancelar, aplicar un filtro. Es una pieza **presentacional**: no sabe qué acción ejecuta ni si está permitida; recibe un `onPress` y un estado.

| Escenario | Variante | Ejemplo de etiqueta (EPT-95) |
|---|---|---|
| Acción principal de la pantalla | `primario` | «Ingresar», «Registrar pago», «Enviar comprobante», «Aplicar», «Reintentar» |
| Acción de apoyo o cancelación | `secundario` | «Cancelar», «Volver a cuotas», «Cargar otro comprobante» |
| Navegación dentro del texto | `enlace` | «¿Olvidaste tu contraseña?», «Ver cuotas» |

## Referencias visuales

| Estado | Lámina |
|---|---|
| Primario | [M01](../../EPT-95/disenos/mockups/M01-login.png), [M05](../../EPT-95/disenos/mockups/M05-seleccion-y-pago.png), [M06](../../EPT-95/disenos/mockups/M06-comprobantes.png), [V12](../../EPT-95/disenos/variantes/V12-cuotas-error-conexion.png) |
| Secundario | [M06](../../EPT-95/disenos/mockups/M06-comprobantes.png), [V16](../../EPT-95/disenos/variantes/V16-pago-registrado.png), [V18](../../EPT-95/disenos/variantes/V18-comprobante-confirmacion.png) |
| Inactivo | [V15](../../EPT-95/disenos/variantes/V15-seleccion-validacion.png) («Registrar pago» sin ítems), [V17](../../EPT-95/disenos/variantes/V17-comprobante-validacion.png) («Enviar comprobante» con errores) |
| Enlace | [M01](../../EPT-95/disenos/mockups/M01-login.png), [M02](../../EPT-95/disenos/mockups/M02-selector-hijo.png), [V06](../../EPT-95/disenos/variantes/V06-selector-sin-vinculos.png) |

Implementación de referencia en el prototipo: `boton`, `enlaceBoton` y `enlace` en `docs/parte3/EPT-96/prototipo/js/vista.mjs`.

## Variantes

| Variante | Fondo | Texto | Borde | Notas |
|---|---|---|---|---|
| `primario` | `color.primario500` | `#FFFFFF` | `borde.control`, `color.primario500` | Ancho completo. Como máximo uno por bloque de acciones |
| `secundario` | `color.superficie` | `color.primario700` | `borde.control`, `color.primario500` | Ancho completo |
| `enlace` | transparente | `color.primario600`, subrayado | ninguno | Ancho del contenido, alto mínimo 48 |

## Props y tipos

```ts
import type { ReactElement, ReactNode } from 'react'

export type VarianteBoton = 'primario' | 'secundario' | 'enlace'

export interface BotonProps {
  /** Texto visible. Siempre en español y siempre presente (no existe botón solo con ícono en este catálogo). */
  etiqueta: string
  /** Se invoca una vez por toque. No se invoca si `deshabilitado` o `cargando`. */
  onPress: () => void
  variante?: VarianteBoton
  /** Acción no disponible ahora. El motivo debe estar visible cerca del botón (lo aporta la pantalla). */
  deshabilitado?: boolean
  /** Hay una operación en curso: bloquea el toque y evita envíos duplicados. */
  cargando?: boolean
  /** Se anuncia como pista: qué hará el botón o por qué está bloqueado. */
  pistaAccesible?: string
  /** Solo si la lectura del lector de pantalla debe diferir del texto visible. */
  etiquetaAccesible?: string
  /** Ícono decorativo opcional a la izquierda. Nunca porta información. */
  icono?: ReactNode
  testID?: string
}

export declare function Boton(props: BotonProps): ReactElement
```

## Eventos y callbacks

| Evento | Cuándo | Contrato |
|---|---|---|
| `onPress` | Toque completado dentro del objetivo táctil | Sin argumentos. El componente **no** navega, no invoca servicios y no decide permisos |

No se exponen `onLongPress` ni gestos: ninguna pantalla de EPT-95 los requiere.

## Estados

| Estado | Visual | Comportamiento | Fuente |
|---|---|---|---|
| Normal | Según variante | `onPress` activo | M01, M05, M06 |
| Presionado | Propuesta: fondo `color.primario600` (primario) / fondo `color.primario50` (secundario) | Retroalimentación inmediata con `Pressable` | **No ilustrado en EPT-95**; propuesta de EPT-99, a confirmar en EPT-102 |
| Deshabilitado | Fondo `color.neutro200`, borde `color.neutro300`, texto `color.neutro700` | No dispara `onPress`; `accessibilityState.disabled` en `true`; texto de motivo visible. EPT-95 lo ilustra por falta de ítems seleccionados y por errores de validación; el bloqueo por banco no configurado es del prototipo de EPT-96 (punto abierto A10) | V15, V17 |
| Cargando | Mantiene la variante; `ActivityIndicator` reemplaza al ícono; la etiqueta no cambia | No dispara `onPress`; `accessibilityState.busy` en `true` | **No ilustrado**; necesario por el envío único de comprobante (EPT-96 N06) |
| Foco (teclado físico o conmutador) | Halo de 3 con `color.primario500`, separación 2 | Visible solo con navegación por teclado/foco | `:focus-visible` del CSS del prototipo de EPT-96; el soporte nativo se verifica en EPT-102 |
| Vacío / error / selección | No aplican | — | — |

## Tokens y dimensiones

- Alto mínimo `48`; relleno vertical `12`, horizontal `20`; radio `radio.md`; borde `borde.control`; texto `texto.boton`; separación con ícono `espacio.sm`.
- Contenido centrado; la etiqueta puede ocupar varias líneas y el botón crece en alto.

## Contenido largo y escalado

- La etiqueta **no se trunca**: se parte en líneas y el botón crece. Con texto al 200 % («Seleccionar ítems para pagar») el alto aumenta, nunca aparece scroll horizontal.
- No se usa `numberOfLines` en la etiqueta.

## Accesibilidad

| Aspecto | Contrato (propiedades de React Native) |
|---|---|
| Rol | `accessibilityRole="button"` (o `role="button"`, que tiene precedencia); `enlace` usa `accessibilityRole="link"` |
| Estado | `accessibilityState={{ disabled, busy }}` |
| Etiqueta | `accessibilityLabel` solo cuando difiere del texto visible |
| Pista | `accessibilityHint` con `pistaAccesible` (motivo del bloqueo o efecto) |
| Objetivo táctil | `minHeight: 48` en la variante primaria y secundaria y en `enlace` |
| Contraste | Ver tabla en [`tokens.md`](../tokens.md): mínimo 6,14:1 |

Un botón deshabilitado debe seguir siendo encontrable por el lector de pantalla y debe anunciar su estado; el motivo se muestra como texto visible (por ejemplo «Datos bancarios: no configurados», caso del prototipo de EPT-96), no solo como color.

## Responsabilidad y exclusiones

| Hace | No hace |
|---|---|
| Dibuja las variantes y estados, evita el doble toque mientras `cargando` | Navegar, llamar servicios, consultar permisos |
| Expone `onPress` y propiedades de accesibilidad | Decidir si «Registrar pago» está bloqueado: lo decide el contenedor |
| Mantiene el objetivo táctil de 48 | Mostrar mensajes de error: eso es de `Aviso` |

## Ejemplo de composición

```tsx
import type { ReactElement } from 'react'

/** Vista: recibe todo ya decidido. No importa servicios ni hooks de datos. */
export interface AccionesDePagoVistaProps {
  bloqueadoPorBanco: boolean
  enviando: boolean
  onRegistrar: () => void
  onCancelar: () => void
}

export function AccionesDePagoVista(props: AccionesDePagoVistaProps): ReactElement {
  return (
    <>
      <Boton
        etiqueta="Registrar pago"
        onPress={props.onRegistrar}
        deshabilitado={props.bloqueadoPorBanco}
        cargando={props.enviando}
        pistaAccesible={props.bloqueadoPorBanco ? 'Disponible cuando la institución configure los datos bancarios' : undefined}
      />
      <Boton etiqueta="Cancelar" variante="secundario" onPress={props.onCancelar} />
    </>
  )
}

/** Contenedor: consulta el estado del banco y llama a `registrar_pago` (EPT-98 §3). */
declare function useRegistroDePago(hijoId: string): {
  bloqueadoPorBanco: boolean
  enviando: boolean
  registrar: () => void
  cancelar: () => void
}

export function AccionesDePagoContenedor({ hijoId }: { hijoId: string }): ReactElement {
  const pago = useRegistroDePago(hijoId)
  return (
    <AccionesDePagoVista
      bloqueadoPorBanco={pago.bloqueadoPorBanco}
      enviando={pago.enviando}
      onRegistrar={pago.registrar}
      onCancelar={pago.cancelar}
    />
  )
}
```
