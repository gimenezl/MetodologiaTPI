# Matriz de cobertura EPT-99

Cada fila enlaza **criterio → componente → ficha/ejemplo → comprobación**. Las comprobaciones `V01`–`V09` se definen al final y sus resultados están en [`docs/evidence/EPT-99.md`](../../evidence/EPT-99.md).

## 1. Criterios de aceptación de Jira

| Criterio (EPT-99) | Componente / documento | Ficha o ejemplo | Comprobación |
|---|---|---|---|
| **CA1.** Catálogo con botones | `Boton` | [01-boton](./componentes/01-boton.md) · ejemplo `AccionesDePagoVista` | V01, V03 |
| **CA1.** Catálogo con tarjetas | `Tarjeta`, `TarjetaCuota`, `TarjetaPago` | [03-tarjetas](./componentes/03-tarjetas.md) · ejemplo `ListaDeCuotasVista` | V01, V02, V03 |
| **CA1.** Catálogo con badges | `InsigniaEstado` | [02-insignia-estado](./componentes/02-insignia-estado.md) · ejemplo `EncabezadoDeFacturaVista` | V01, V02, V03 |
| **CA1.** Catálogo con listas | `ListaFilas`, `FilaItem`, `FilaSeleccionable`, `FilaArchivo`, `FilaClaveValor`, `Importe`, `Fecha`, `ResumenTotal` | [04-listas-y-filas](./componentes/04-listas-y-filas.md) · ejemplo `SeleccionDePagoVista` | V01, V03 |
| **CA1.** Catálogo con formularios | `CampoTexto`, `Formulario` | [05-campos-y-formularios](./componentes/05-campos-y-formularios.md) · ejemplo `FormularioComprobanteVista` | V01, V03 |
| **CA2.** Separa contenedor / presentacional | Reglas, dependencias y mapa de cuotas, detalle, selección y comprobantes | [separacion-contenedor-presentacional](./separacion-contenedor-presentacional.md) · ejemplo `CuotasContenedor` | V03, V06 |
| **CA2.** Estados institucionales | `InsigniaEstado`, `TarjetaCuota`, `Aviso`, `EstadoPantalla` | [02](./componentes/02-insignia-estado.md), [03](./componentes/03-tarjetas.md), [06](./componentes/06-avisos-y-estados.md) · ejemplo `CuotasVista` | V02, V05 |
| Identidad visual (P3-RNF5) | Tokens de EPT-95 | [tokens](./tokens.md) · objeto de tokens en el [handoff](./handoff-expo-react-native.md) | V05 |
| Reutilizable para implementación nativa | Contratos, traducción a nativo, verificaciones pendientes | [handoff-expo-react-native](./handoff-expo-react-native.md) | V03, V04 |

## 2. Familias y piezas

| Familia | Piezas | Ficha | Reutilización en el prototipo (`pantallas.mjs` EPT-96) |
|---|---|---|---|
| Botones | `Boton` | 01 | 12 `boton(` + 14 `enlaceBoton(` |
| Badges | `InsigniaEstado` | 02 | 11 `insignia(` |
| Tarjetas | `Tarjeta`, `TarjetaCuota`, `TarjetaPago` | 03 | 26 `class: 'card` |
| Listas y filas | `ListaFilas`, `FilaClaveValor`, `Importe`, `Fecha`, `FilaItem`, `FilaSeleccionable`, `FilaArchivo`, `ResumenTotal` | 04 | 35 `fila(`, 23 `importe(` |
| Formularios | `CampoTexto`, `Formulario` | 05 | 7 `campo(` |
| Complementarias | `Aviso`, `EstadoPantalla` | 06 | 24 `alerta(` |
| Complementarias | `ContextoHijo` | 07 | 11 invocaciones de `contexto(ctx, hijo)` |

Las piezas complementarias se incluyen **solo** por reutilización demostrada. No hay selector de hijo propio (una sola pantalla), ni tabs ni barra inferior (navegación de EPT-102).

## 3. Cuatro estados económicos

| Estado | Texto | Ícono | `InsigniaEstado` | `TarjetaCuota` | Lámina |
|---|---|---|---|---|---|
| Pendiente | Pendiente | `reloj` | `dominio="factura"` `estado="pendiente"` | Trazo `primario500` | [V09](../EPT-95/disenos/variantes/V09-cuotas-pendiente.png), [V13](../EPT-95/disenos/variantes/V13-estados-de-cuota.png) |
| Pago parcial | Pago parcial | `parcial` | `estado="parcial"` | Trazo `advertencia` | [M03](../EPT-95/disenos/mockups/M03-cuotas.png), [V13](../EPT-95/disenos/variantes/V13-estados-de-cuota.png) |
| Pagada | Pagada | `check` | `estado="pagada"` | Trazo `exito` | [V08](../EPT-95/disenos/variantes/V08-cuotas-pagadas.png), [V13](../EPT-95/disenos/variantes/V13-estados-de-cuota.png) |
| Vencida | Vencida | `alerta` | `estado="vencida"` | Trazo `peligro` + fondo y borde de peligro | [M03](../EPT-95/disenos/mockups/M03-cuotas.png), [V13](../EPT-95/disenos/variantes/V13-estados-de-cuota.png) |

Reglas que el catálogo **respeta sin decidirlas**: Vencida prevalece con saldo después del vencimiento (la deriva el servidor); un pago pendiente de verificación no reduce el saldo y se rotula «Pendiente de verificación», nunca «Pagado».

## 4. Estados por pieza

`●` ilustrado en EPT-95 · `○` propuesto por EPT-99, sin lámina · `—` no aplica.

| Pieza | Normal | Deshabilitado | Carga | Vacío | Error | Selección |
|---|---|---|---|---|---|---|
| `Boton` | ● | ● V15, V17 | ○ | — | — | — |
| `InsigniaEstado` | ● | — | — | — | — | — |
| `Tarjeta` / `TarjetaCuota` | ● | — | ● V10 (esqueleto) | ● V11 | ● V12 | — |
| `TarjetaPago` | ● | — | ● V10 | ● (sin comprobante) | — | — |
| `FilaItem` | ● | — | — | — | — | — |
| `FilaSeleccionable` | ● | ● no seleccionable (M05) | — | — | — | ● marcada (M05) |
| `FilaArchivo` | ● | — | — | — | ● V17 | — |
| `CampoTexto` | ● | ○ | — | ● placeholder (M01) | ● V01, V17 | — |
| `Formulario` | ● | ● acción V17 | ○ | — | ● resumen V17 | — |
| `Aviso` | ● | — | — | — | ● | — |
| `EstadoPantalla` | — | — | ● V10 | ● V11 | ● V12 | — |
| `ContextoHijo` | ● | — | — | — | — | — |
| `Importe`, `Fecha`, `FilaClaveValor`, `ResumenTotal`, `ListaFilas` | ● | — | — | — | — | — |

## 5. Pantallas de EPT-95 y piezas que las componen

| Área | Mockup | Piezas |
|---|---|---|
| 1 Login | [M01](../EPT-95/disenos/mockups/M01-login.png) | `Formulario`, `CampoTexto`, `Boton`, `Aviso` |
| 2 Selector de hijo | [M02](../EPT-95/disenos/mockups/M02-selector-hijo.png) | `Tarjeta`, `InsigniaEstado`, `FilaClaveValor`, `Importe`, `Boton` (enlace) |
| 3 Cuotas | [M03](../EPT-95/disenos/mockups/M03-cuotas.png) | `ContextoHijo`, `TarjetaCuota`, `InsigniaEstado`, `Importe`, `Boton`, `EstadoPantalla` |
| 4 Detalle de factura | [M04](../EPT-95/disenos/mockups/M04-factura.png) | `ContextoHijo`, `Tarjeta`, `ListaFilas`, `FilaItem`, `InsigniaEstado`, `Aviso` |
| 5 Selección y pago | [M05](../EPT-95/disenos/mockups/M05-seleccion-y-pago.png) | `FilaSeleccionable`, `ResumenTotal`, `Aviso`, `Boton` |
| 6 Comprobantes | [M06](../EPT-95/disenos/mockups/M06-comprobantes.png) | `ContextoHijo`, `Formulario`, `CampoTexto`, `FilaArchivo`, `ListaFilas`, `Boton` (el registro de pagos con `TarjetaPago` es V20/V21) |
| 7 Período | [M07](../EPT-95/disenos/mockups/M07-periodo.png) | `Formulario`, `CampoTexto`, `TarjetaPago`, `FilaClaveValor` |
| 8 Deuda por ítem | [M08](../EPT-95/disenos/mockups/M08-deuda-item.png) | `Formulario`, `ResumenTotal`, `Tarjeta`, `FilaItem` |
| 9 Inscripciones | [M09](../EPT-95/disenos/mockups/M09-inscripciones.png) | `Tarjeta`, `FilaClaveValor` |

El catálogo **referencia** los diseños aprobados; no copia ni regenera las 44 láminas.

## 6. Roles

| Regla | Dónde se refleja en el catálogo |
|---|---|
| ESTUDIANTE consulta lo propio; no paga ni carga | `ContextoHijo` variante `propio`; ausencia de `onToggle`/`onCargarComprobante`; `Aviso` «Solo consulta» ([V07](../EPT-95/disenos/variantes/V07-cuotas-estudiante.png), [V14](../EPT-95/disenos/variantes/V14-factura-estudiante.png)) |
| Original del comprobante: solo quien lo cargó y Dirección | `PagoVista.puedeAbrirOriginal` y `avisoOriginalRestringido` ([V20](../EPT-95/disenos/variantes/V20-comprobantes-otro-padre.png), [V21](../EPT-95/disenos/variantes/V21-comprobantes-estudiante.png)) |
| Datos bancarios «no configurados» | `Aviso` informativo ([M05](../EPT-95/disenos/mockups/M05-seleccion-y-pago.png)); no se inventa ningún dato bancario. El **bloqueo** de «Registrar pago» mientras el banco no está configurado es comportamiento del prototipo de EPT-96 (prueba N04), no de las láminas de EPT-95: el catálogo ofrece el estado `deshabilitado` con motivo visible y deja la decisión al contenedor (punto abierto A10) |

## 7. Comprobaciones

Las definiciones usan **evidencia observable**: conteos, listados y compilación. Los resultados y las órdenes exactas están en [`docs/evidence/EPT-99.md`](../../evidence/EPT-99.md).

| ID | Qué comprueba | Resultado esperado |
|---|---|---|
| V01 | Cinco familias y once secciones obligatorias en cada ficha | Cada ficha contiene las once secciones; las cinco familias existen |
| V02 | Cuatro estados económicos | Los cuatro estados con texto e ícono en `InsigniaEstado` y `TarjetaCuota`; «Pendiente de verificación» presente |
| V03 | Props y eventos coherentes | Los bloques `ts` y `tsx` compilan juntos con `tsc --noEmit` y sin errores |
| V04 | Referencias y enlaces | Todo enlace relativo resuelve; toda lámina citada existe y figura en `manifest.json` de EPT-95 |
| V05 | Tokens trazables | Todo valor hexadecimal de `tokens.md` y del handoff existe en `estilos.css`; contrastes recalculados |
| V06 | Separación | Ningún bloque de vista importa servicios, navegación, sesión ni Supabase |
| V07 | Sin reglas inventadas | Sin datos bancarios reales; los tres supuestos del prototipo figuran como pendientes |
| V08 | Aplicabilidad CI | El selector por impacto clasifica las rutas como documentación pasiva; `git diff --check` limpio |
| V09 | Reutilización medida | Los conteos citados coinciden con `pantallas.mjs` |
