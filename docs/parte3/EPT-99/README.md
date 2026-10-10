# EPT-99 — Componentes reutilizables móviles

Catálogo de componentes y contratos orientados a **React Native** para la futura aplicación móvil de Educar para Transformar. Se construye a partir de los diseños aprobados de EPT-95 y del prototipo de EPT-96.

> **Qué es:** documentación de contratos (fichas, tokens, tipos, separación contenedor/presentacional y handoff). **Qué no es:** una aplicación, una galería web, un proyecto Expo ni código productivo compilado. No hay ejecución en Android o iOS; EPT-102 implementará la aplicación y verificará el comportamiento nativo.

## Índice

| Documento | Contenido |
|---|---|
| [`matriz-cobertura.md`](./matriz-cobertura.md) | Criterio → componente → ficha → comprobación; familias; cuatro estados; estados por pieza |
| [`tokens.md`](./tokens.md) | Colores, tipografía, espaciado, bordes, objetivos táctiles, estados y contrastes medidos |
| [`contratos-vista.md`](./contratos-vista.md) | Tipos TypeScript compartidos entre contenedor y vista |
| [`separacion-contenedor-presentacional.md`](./separacion-contenedor-presentacional.md) | Responsabilidades, dependencias y mapa de cuotas, detalle, selección y comprobantes |
| [`handoff-expo-react-native.md`](./handoff-expo-react-native.md) | Objeto de tokens, traducción a nativo, API verificadas, áreas seguras, teclado, texto ampliado y verificaciones para EPT-102 |
| [`bitacora-academica.md`](./bitacora-academica.md) | Aportes de IA: insumo, comprensión, adaptación, prueba y resultado |
| [`../../evidence/EPT-99.md`](../../evidence/EPT-99.md) | Aceptación, comprobaciones, revisión, límites y rollback |

### Fichas de componentes

| Ficha | Piezas | Familia pedida |
|---|---|---|
| [`01-boton`](./componentes/01-boton.md) | `Boton` | Botones |
| [`02-insignia-estado`](./componentes/02-insignia-estado.md) | `InsigniaEstado` | Badges |
| [`03-tarjetas`](./componentes/03-tarjetas.md) | `Tarjeta`, `TarjetaCuota`, `TarjetaPago` | Tarjetas (cuota/factura) |
| [`04-listas-y-filas`](./componentes/04-listas-y-filas.md) | `ListaFilas`, `FilaClaveValor`, `Importe`, `Fecha`, `FilaItem`, `FilaSeleccionable`, `FilaArchivo`, `ResumenTotal` | Listas y filas |
| [`05-campos-y-formularios`](./componentes/05-campos-y-formularios.md) | `CampoTexto`, `Formulario` | Formularios |
| [`06-avisos-y-estados`](./componentes/06-avisos-y-estados.md) | `Aviso`, `EstadoPantalla` | Estados institucionales (carga, vacío, error) |
| [`07-contexto-hijo`](./componentes/07-contexto-hijo.md) | `ContextoHijo` | Identificación del hijo (reutilización demostrada) |

Cada ficha incluye propósito y escenarios, referencias visuales a las láminas de EPT-95, variantes, props y tipos, eventos, estados, tokens y dimensiones, contenido largo, accesibilidad, responsabilidad y exclusiones, y un ejemplo de composición.

## Fuentes y precedencia

1. Decisiones humanas vigentes (EPT-80 a EPT-87) y PDF aprobado.
2. Jira vivo de EPT-99 y sus dependencias (EPT-95, EPT-97: Listo).
3. Implementación integrada: `docs/parte3/EPT-95/` (diseños, tokens, fuentes, estados) y `docs/parte3/EPT-96/` (prototipo, mapa de navegación).
4. Arquitectura (EPT-97) y contrato de integración (EPT-98), tomados como **datos**; sus nombres de vistas y RPC son propuestos y se confirman al implementar.

## Convenciones

- **Idioma:** documentación, ejemplos visibles y comentarios en español profesional; identificadores de React Native (`onPress`, `Pressable`, `accessibilityRole`) en su idioma técnico.
- **Nombres:** componentes y props de dominio en español (`Boton`, `TarjetaCuota`, `etiqueta`); los callbacks siguen la convención `on…` de React Native (`onPress`, `onChangeText`) y los eventos de dominio usan la misma forma (`onToggle`, `onCambiarHijo`).
- **Importes:** centavos enteros; formato `ARS 63.606,65` con dos decimales; nunca partidos ni cortados.
- **Identidad:** paleta, tipografía y estados de EPT-95. Sin colores nuevos.
- **Código en este directorio:** son bloques de documentación. No se importan ni se ejecutan; por eso el selector de CI por impacto los clasifica como documentación pasiva (ver [evidencia](../../evidence/EPT-99.md)).

## Decisiones de EPT-99

| # | Decisión | Motivo |
|---|---|---|
| D1 | Solo documentación en Markdown; sin JSON, scripts ni paquete mobile | No clasificar código activo como pasivo ni abrir excepciones de CI; no anticipar EPT-102 |
| D2 | Piezas complementarias (`Aviso`, `EstadoPantalla`, `ContextoHijo`, `Fecha`, `ResumenTotal`) solo con reutilización medida | Evitar un framework general |
| D3 | La tarjeta del selector de hijo y las pestañas Pendientes/Pagadas no son piezas propias | Aparecen en una sola pantalla; se componen con piezas del catálogo y `Pressable` (ver handoff) |
| D4 | Formato de importe como función pura, sin `Intl` | El soporte regional cambia entre motores y plataformas |
| D5 | Alias de espaciado propuestos por EPT-99 | EPT-95 usa literales; se rotulan como alias |
| D6 | Capacidades como booleanos y callbacks opcionales | La vista no infiere rol ni permisos; el servidor sigue siendo la autoridad |

## Supuestos y puntos abiertos

### Supuestos exclusivos del prototipo de EPT-96 — **no** son reglas aprobadas

Este catálogo **no** los impone. Quedan pendientes para las unidades de implementación correspondientes y, hasta su confirmación, los componentes solo ofrecen estados de validación (`error`, `Aviso`):

| # | Supuesto del prototipo | Dónde se aplica en el prototipo | Estado |
|---|---|---|---|
| S1 | Número de operación alfanumérico de hasta 30 caracteres | `validarComprobante` en `reglas.mjs` | Pendiente de confirmación |
| S2 | Fecha de transferencia futura sin restricción | `parsearFecha` y `validarComprobante` | Pendiente de confirmación |
| S3 | Deuda por ítem filtrada por el vencimiento de la factura | `deudaPorItem` en `reglas.mjs` | Pendiente de confirmación |

EPT-96 registra además, entre sus supuestos, que las facturas con pago registrado y sin comprobante se ubican por vencimiento hasta que exista fecha de transferencia; tampoco es regla aprobada.

### Puntos abiertos del catálogo

| # | Punto | Dónde afecta | Quién lo cierra |
|---|---|---|---|
| A1 | Estados **presionado** y **cargando** del botón no están ilustrados en EPT-95 | `Boton` | EPT-102 con diseño o criterio del equipo |
| A2 | Origen del total mostrado **mientras** se selecciona (EPT-98 solo define `total_calculado` al registrar) | `ResumenTotal`, contenedor de selección | Unidad de la pantalla de pago |
| A3 | Forma de transporte de importes (`NUMERIC(12,2)` ⟶ centavos) | `Centavos`, adaptadores | Implementación de servicios |
| A4 | Origen de `CapacidadesPago` y de `PagoVista.puedeAbrirOriginal` (¿campo del servidor o derivado por vínculo y cargador?) | Contenedores | Implementación de servicios |
| A5 | Avisos a 15 px frente al criterio de cuerpo ≥ 16 px | `Aviso`, `CampoTexto` | Revisión de accesibilidad en EPT-102 |
| A6 | Cifras grandes y cadenas largas con texto ampliado | `ResumenTotal`, `FilaArchivo`, `CampoTexto` | Verificación en dispositivo |
| A7 | Agregados mostrados (saldo total adeudado, totales del período): ¿los entrega el servidor o se suman centavos ya calculados? | `CuotasContenedor`, `PeriodoContenedor` | Implementación de servicios |
| A8 | Nombres definitivos de vistas y RPC | Mapa de contenedores | EPT-98 al implementar |
| A9 | Cómo cada lector de pantalla pronuncia `ARS` y los importes | `Importe` | Verificación con TalkBack y VoiceOver |
| A10 | El bloqueo de «Registrar pago» con datos bancarios no configurados proviene del prototipo de EPT-96 (N04); EPT-95 solo muestra el aviso y la acción deshabilitada cuando no hay ítems (V15) | `Boton`, contenedor de selección | Unidad de la pantalla de pago |
| A11 | Teclado de `dd/mm/aaaa`: el teclado numérico de iOS no ofrece `/`; puede requerirse otro modo de entrada | `CampoTexto` | Verificación en dispositivo (EPT-102) |

## Límites

- No se ejecutó ninguna prueba en Android ni iOS, TalkBack ni VoiceOver, teclado nativo ni escalado real del sistema. Un PASS de Next, del prototipo o de este catálogo **no** demuestra ejecución nativa.
- Las láminas de EPT-95 y el prototipo de EPT-96 no cuentan con aprobación docente registrada; esta entrega no simula una.
- Los datos de los ejemplos son ficticios. No existen datos bancarios reales: permanecen «no configurados».
- El catálogo no incluye selector de medio de pago: no hay efectivo, QR, pasarela de pago, publicación en tiendas ni modo sin conexión como requisito (Jira EPT-99, controles transversales).
- Las guardas y capacidades de este documento ilustran contratos; la autorización productiva es de RLS y de las RPC (EPT-101, EPT-98).

## Relación con otras unidades

| Unidad | Relación |
|---|---|
| EPT-95 (Listo) | Fuente visual. **No se modifica**; se referencia por ruta relativa |
| EPT-96 (Listo) | Fuente de comportamiento y mapa de navegación. **No se modifica** |
| EPT-97 / EPT-98 | Arquitectura y contrato de integración (insumo) |
| EPT-102 (Por hacer, bloqueada por esta unidad) | Implementa Expo y los componentes; verifica nativo |

## Rollback

Revertir el commit de integración elimina `docs/parte3/EPT-99/` y `docs/evidence/EPT-99.md`. No afecta producto, base de datos, CI, EPT-95 ni EPT-96.
