# `CampoTexto` y `Formulario`

Familia: **formularios**. Tipos compartidos: [`contratos-vista.md`](../contratos-vista.md). Tokens: [`tokens.md`](../tokens.md).

## Propósito y escenarios

| Pieza | Para qué | Pantallas (EPT-95) |
|---|---|---|
| `CampoTexto` | Entrada de una línea con etiqueta persistente, ayuda y error asociado | Ingreso (correo, contraseña), carga de comprobante (fecha, importe, número de operación), rango de fechas de período y deuda |
| `Formulario` | Disposición: título de sección, resumen de errores, campos, acción principal y acción secundaria; mantiene la acción visible con el teclado abierto | Ingreso, carga de comprobante, filtros de fecha |

El catálogo **no** incluye selector de fecha ni selector de archivo propios: EPT-95 diseña la fecha como texto con formato `dd/mm/aaaa` y los archivos como filas (`FilaArchivo`). El mecanismo para elegir archivos o fotos (cámara, galería, documentos) es una decisión de EPT-102.

## Referencias visuales

| Estado | Lámina |
|---|---|
| Normal / vacío con etiqueta persistente | [M01](../../EPT-95/disenos/mockups/M01-login.png), [M06](../../EPT-95/disenos/mockups/M06-comprobantes.png) |
| Error de validación | [V01](../../EPT-95/disenos/variantes/V01-login-validacion.png), [V17](../../EPT-95/disenos/variantes/V17-comprobante-validacion.png) |
| Foco con teclado abierto | [V25](../../EPT-95/disenos/variantes/V25-comprobante-teclado.png) |
| Resumen «Revisá los datos marcados» | Solo en el prototipo de EPT-96 (`comprobante`); las láminas V01 y V17 no lo muestran |
| Credenciales inválidas (mensaje genérico) | [V02](../../EPT-95/disenos/variantes/V02-login-credenciales-invalidas.png) |
| Filtro de fechas | [M07](../../EPT-95/disenos/mockups/M07-periodo.png), [M08](../../EPT-95/disenos/mockups/M08-deuda-item.png) |

Referencia de comportamiento: `campo`, `formularioIngreso`, `filtroFechas` y `comprobante` en `docs/parte3/EPT-96/prototipo/js/`.

## Variantes

| Variante de `CampoTexto` | `teclado` | Propiedad de `TextInput` | Ejemplo |
|---|---|---|---|
| Texto | `texto` | `inputMode="text"` | Número de operación |
| Correo | `correo` | `inputMode="email"`, sin autocapitalizar | Ingreso |
| Numérico | `numerico` | `inputMode="numeric"` | Fecha `dd/mm/aaaa` |
| Decimal | `decimal` | `inputMode="decimal"` | Importe informado |
| Secreto | cualquiera + `secreto` | `secureTextEntry` | Contraseña |

`inputMode` tiene precedencia sobre `keyboardType` en React Native; el contrato usa `inputMode`. El teclado numérico de iOS no ofrece la barra `/` que pide el formato `dd/mm/aaaa`: la elección del modo de entrada de la fecha se verifica en dispositivo (README A11).

## Props y tipos

```ts
import type { ReactElement, ReactNode } from 'react'

export type TecladoCampo = 'texto' | 'correo' | 'numerico' | 'decimal'
export type AccionTeclado = 'siguiente' | 'enviar' | 'listo'

export interface CampoTextoProps {
  /** Etiqueta persistente visible. No se reemplaza por placeholder. */
  etiqueta: string
  valor: string
  /** Campo controlado: el contenedor posee el valor. */
  onChangeText: (texto: string) => void
  onSubmitEditing?: () => void
  /** Mensaje de error ya redactado en español. Su presencia activa el estado de error. */
  error?: string
  /** Texto de ayuda persistente bajo el campo, por ejemplo «Formato dd/mm/aaaa». */
  ayuda?: string
  placeholder?: string
  teclado?: TecladoCampo
  secreto?: boolean
  /** Control «Mostrar» de la contraseña (M01, V01). Solo se informa en campos `secreto`. */
  controlMostrar?: { visible: boolean; onToggle: () => void }
  deshabilitado?: boolean
  /** Tecla de acción del teclado: `siguiente` (returnKeyType next), `enviar` (send) o `listo` (done). */
  accionTeclado?: AccionTeclado
  testID?: string
}

export declare function CampoTexto(props: CampoTextoProps): ReactElement

export interface AccionFormulario {
  etiqueta: string
  onPress: () => void
  deshabilitado?: boolean
  cargando?: boolean
  /** Motivo visible cuando la acción está deshabilitada. */
  pistaAccesible?: string
}

export interface FormularioProps {
  titulo?: string
  /** Texto del resumen, por ejemplo «Revisá los datos marcados para continuar.». Presente solo si hay errores. */
  resumenErrores?: string
  accionPrincipal: AccionFormulario
  accionSecundaria?: AccionFormulario
  children: ReactNode
}

export declare function Formulario(props: FormularioProps): ReactElement
```

## Eventos y callbacks

| Pieza | Evento | Contrato |
|---|---|---|
| `CampoTexto` | `onChangeText(texto)` | En cada cambio. El campo no formatea ni valida |
| `CampoTexto` | `onSubmitEditing()` | Tecla de acción del teclado. Normalmente mueve el foco o envía |
| `Formulario` | `accionPrincipal.onPress`, `accionSecundaria.onPress` | Mediante `Boton` |

La validación y el cálculo de `error` son del **contenedor** (esquemas Zod compartidos, EPT-98 §5); la base sigue siendo la autoridad.

## Estados

| Estado | Visual | Comportamiento | Lámina |
|---|---|---|---|
| Normal / vacío | Borde `borde.control` `neutro500`, fondo `superficie`; placeholder `neutro600` | Etiqueta siempre visible | M01, M06 |
| Foco | Borde `primario500` y halo de 4 `primario200` | El halo se dibuja con un contenedor, no con `outline` | V25 |
| Error | Borde y fondo `peligro` / `peligroFondo`; texto de error `peligroTexto` 15 con ícono `alerta`; el error está **debajo** del campo y asociado a él | El resumen del `Formulario` repite que hay errores | V01, V17 |
| Con ayuda | Texto `neutro600` bajo el campo | Persistente: no desaparece al escribir | M06 |
| Deshabilitado | Fondo `neutro100`, texto `neutro600` | No editable (`editable={false}`) | — (prototipo: contraseña en EPT-96) |
| Carga | Aplica al `Formulario`: acción principal en `cargando` | Evita envío duplicado | No ilustrado en EPT-95; comportamiento del prototipo (EPT-96 N06) |
| Vacío (sin valor) | Placeholder | — | M01 |
| Selección | No aplica | — | — |

### Validaciones que el catálogo permite representar (sin imponer reglas)

| Situación | Cómo se muestra | Quién decide |
|---|---|---|
| Campo vacío u obligatorio | `error` en el campo + resumen | Contenedor |
| Formato inválido | `error` con el formato esperado en `ayuda`; si el campo exige máscara (por ejemplo `dd/mm/aaaa`), la aplica el contenedor en `onChangeText` | Contenedor |
| Valor ya registrado | `error` en el campo | Contenedor / servidor |
| Archivo no permitido o demasiado grande | `archivo.error` en `FilaArchivo` | Contenedor |
| Importe distinto del total calculado | `Aviso` de advertencia (dato de conciliación; Dirección decide) | Contenedor |
| Resultado incierto del envío | Pantalla con `Aviso` y «Revisar estado» antes de reintentar | Contenedor |

Las reglas concretas del número de operación, de la fecha de transferencia y del filtro por período **no** están definidas por este catálogo (ver [supuestos pendientes](../README.md#supuestos-y-puntos-abiertos)).

## Tokens y dimensiones

- Campo: `minHeight` 48; borde `borde.control`; radio `radio.md`; relleno 10 × 14; texto `texto.cuerpo`; placeholder `neutro600`.
- Etiqueta: `texto.etiquetaCampo`, `gap` 6 con el campo. Error: `texto.aviso`, `gap` 6 con el ícono de 18.
- Formulario: separación 16 entre campos; márgenes de pantalla `espacio.xl`; botones a ancho completo, separados 12.

## Contenido largo y teclado

- Etiqueta, ayuda y error se **parten en líneas**; el campo no recorta el valor (sin `numberOfLines` en el mensaje).
- El valor de una línea (por ejemplo un número de operación) debe poder desplazarse horizontalmente dentro del campo; el campo no crece.
- Con teclado abierto el formulario se desplaza y la acción principal permanece visible por encima del teclado ([V25](../../EPT-95/disenos/variantes/V25-comprobante-teclado.png)). El mecanismo (`KeyboardAvoidingView`, `ScrollView` con `keyboardShouldPersistTaps="handled"`) y su comportamiento en Android e iOS se verifican en dispositivo (EPT-102).

## Accesibilidad

| Aspecto | Contrato |
|---|---|
| Etiqueta | `accessibilityLabel` = `etiqueta`; la etiqueta visible no se sustituye por el placeholder |
| Pista | `accessibilityHint` compone `ayuda` y, si existe, `error` (el error primero) |
| Estado de error | Texto visible asociado; no solo color. Al aparecer un error, el contenedor anuncia con `AccessibilityInfo.announceForAccessibility` y el `Aviso` del resumen usa `accessibilityRole="alert"` |
| Android | Asociación etiqueta–campo con `nativeID` y `accessibilityLabelledBy` (propiedad solo Android) |
| Teclado | `inputMode` coherente con el dato; `autoComplete` para correo y contraseña (no combinar con `textContentType`) |
| Texto ampliado | El campo crece en alto; no se fija `height` |

## Responsabilidad y exclusiones

| Hace | No hace |
|---|---|
| Dibujar etiqueta, valor, ayuda y error con foco y estados | Validar, normalizar importes o fechas |
| Mantener la acción visible con teclado | Subir archivos, llamar `adjuntar_comprobante` o Storage |
| Anunciar el estado a tecnologías de asistencia | Conservar el valor entre pantallas (el contenedor posee el borrador) |

El borrador **no se persiste** en la vista. Descartarlo al cambiar de hijo, cancelar o cerrar sesión es política del contenedor (EPT-96 N11 ilustra el comportamiento esperado).

## Ejemplo de composición

```tsx
import type { ReactElement } from 'react'

export interface FormularioComprobanteVistaProps {
  fecha: string
  importe: string
  operacion: string
  errores: { fecha?: string; importe?: string; operacion?: string }
  avisoImporte?: string
  enviando: boolean
  onCambiarFecha: (texto: string) => void
  onCambiarImporte: (texto: string) => void
  onCambiarOperacion: (texto: string) => void
  onEnviar: () => void
  onCancelar: () => void
}

export function FormularioComprobanteVista(props: FormularioComprobanteVistaProps): ReactElement {
  const hayErrores = Boolean(props.errores.fecha || props.errores.importe || props.errores.operacion)
  return (
    <Formulario
      titulo="Datos de la transferencia"
      resumenErrores={hayErrores ? 'Revisá los datos marcados para continuar.' : undefined}
      accionPrincipal={{ etiqueta: 'Enviar comprobante', onPress: props.onEnviar, cargando: props.enviando }}
      accionSecundaria={{ etiqueta: 'Cancelar', onPress: props.onCancelar }}
    >
      <CampoTexto
        etiqueta="Fecha de transferencia"
        valor={props.fecha}
        onChangeText={props.onCambiarFecha}
        error={props.errores.fecha}
        ayuda="Formato dd/mm/aaaa."
        teclado="numerico"
        accionTeclado="siguiente"
      />
      <CampoTexto
        etiqueta="Importe informado (ARS)"
        valor={props.importe}
        onChangeText={props.onCambiarImporte}
        error={props.errores.importe}
        ayuda="Es un dato de conciliación; Dirección decide al verificar."
        teclado="decimal"
        accionTeclado="siguiente"
      />
      {props.avisoImporte ? <Aviso tipo="advertencia" mensaje={props.avisoImporte} /> : null}
      <CampoTexto
        etiqueta="Número de operación"
        valor={props.operacion}
        onChangeText={props.onCambiarOperacion}
        error={props.errores.operacion}
        teclado="texto"
        accionTeclado="enviar"
        onSubmitEditing={props.enviando ? undefined : props.onEnviar}
      />
    </Formulario>
  )
}
```

> El contenedor del ejemplo arma `errores` y `avisoImporte` con los esquemas compartidos y las respuestas del servidor; el catálogo no impone formato de número de operación, fecha futura ni rango.
