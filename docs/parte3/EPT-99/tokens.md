# Tokens y dimensiones del catálogo

Fuente única: `docs/parte3/EPT-95/fuentes/estilos.css` (identidad aprobada en EPT-95) y `docs/parte3/EPT-95/README.md`. Este documento **no define colores ni medidas nuevas**: traduce los valores aprobados a nombres estables para React Native. Donde un valor aparece solo como número literal en el diseño, el nombre es un **alias propuesto por EPT-99** y así se rotula.

## Unidades

- El diseño estático usa píxeles CSS a 390 px de ancho. En React Native los estilos son números sin unidad: **1 px de diseño = 1 unidad de layout** (dp en Android, pt en iOS). No se aplican factores de conversión.
- Los tamaños de texto escalan con la configuración del sistema (`allowFontScaling` está activo por defecto en `Text` y `TextInput`). El diseño de EPT-95 ilustra el 200 % en la lámina [V26](../EPT-95/disenos/variantes/V26-cuotas-texto-200.png); el comportamiento real se verifica en dispositivo (ver [handoff](./handoff-expo-react-native.md)).

## Colores

Valores sRGB de EPT-95 (convertidos de OKLCH desde `src/app/globals.css`). La columna «Nombre RN» es el identificador propuesto para el objeto de tokens.

| Nombre RN | Token EPT-95 | Valor | Uso en el catálogo |
|---|---|---|---|
| `color.primario50` | `--primary-50` | `#EAF3FF` | Fondo de `ContextoHijo`, de `Aviso` informativo y de la insignia Pendiente |
| `color.primario100` | `--primary-100` | `#D0E3FF` | Texto secundario sobre encabezado (no usado por el catálogo) |
| `color.primario200` | `--primary-200` | `#A5C9FF` | Borde de `ContextoHijo`; halo de foco del campo |
| `color.primario500` | `--primary-500` | `#005DCA` | Botón primario, casilla marcada, foco, borde de insignia Pendiente |
| `color.primario600` | `--primary-600` | `#00459A` | Texto de enlace (`Boton` variante `enlace`) |
| `color.primario700` | `--primary-700` | `#002F6D` | Texto del botón secundario, fondo de `ResumenTotal`, texto de insignia Pendiente |
| `color.neutro50` | `--neutral-50` | `#FAFBFF` | Fondo de pantalla |
| `color.neutro100` | `--neutral-100` | `#F3F4F9` | Fondo de insignia En verificación y de campo deshabilitado |
| `color.neutro200` | `--neutral-200` | `#E5E7ED` | Bordes de tarjeta, separadores, fondo de botón inactivo y de esqueleto |
| `color.neutro300` | `--neutral-300` | `#C7C8D0` | Borde de botón inactivo y de `FilaArchivo` |
| `color.neutro500` | `--neutral-500` | `#6B6D74` | Borde de campo y de casilla no seleccionable |
| `color.neutro600` | `--neutral-600` | `#4D4E53` | Texto secundario y de ayuda |
| `color.neutro700` | `--neutral-700` | `#35363B` | Texto de botón inactivo y de insignia En verificación |
| `color.neutro800` | `--neutral-800` | `#1C1D20` | Texto principal |
| `color.superficie` | `--surface` | `#FFFFFF` | Fondo de tarjeta, campo y botón secundario |
| `color.exito` | `--success` | `#008935` | Trazo izquierdo de cuota Pagada |
| `color.exitoTexto` | `--success-text` | `#00581F` | Texto y borde de insignia Pagada / Pagado |
| `color.exitoFondo` | `--success-bg` | `#E1FAE3` | Fondo de insignia Pagada / Pagado |
| `color.advertencia` | `--warning` | `#D4A800` | Trazo izquierdo de cuota Pago parcial |
| `color.advertenciaTexto` | `--warning-text` | `#5F4A00` | Texto y borde de insignia Pago parcial; texto de `Aviso` de advertencia |
| `color.advertenciaFondo` | `--warning-bg` | `#FFF1CC` | Fondo de insignia Pago parcial y de `Aviso` de advertencia |
| `color.peligro` | `--danger` | `#D81327` | Trazo izquierdo de cuota Vencida; borde de campo con error |
| `color.peligroTexto` | `--danger-text` | `#9E141E` | Texto y borde de insignia Vencida / Rechazado; mensaje de error |
| `color.peligroFondo` | `--danger-bg` | `#FFEDEB` | Fondo de cuota Vencida, de campo con error y de `Aviso` de error |

Fuera de uso a propósito (EPT-95): el acento naranja `--accent-500` `#F86200` no se emplea en estados de deuda ni como fondo de texto blanco, y `--neutral-400` no se usa para texto por no alcanzar 4,5:1 sobre blanco (3,07:1).

### Contraste medido de los pares del catálogo

Cálculo WCAG 2.x sobre los valores de la tabla anterior (relación de luminancia relativa; el procedimiento y el resultado están en `docs/evidence/EPT-99.md`). Los pares de texto superan 4,5:1; los trazos no textuales listados, 3:1. El trazo lateral de Pago parcial (`#D4A800` sobre blanco, ≈ 2,2:1) no cumple 3:1 por sí solo: por eso nunca comunica el estado solo y siempre va con insignia de texto e ícono.

| Par | Relación |
|---|---|
| Botón primario: `#FFFFFF` sobre `#005DCA` | 6,14:1 |
| Botón secundario: `#002F6D` sobre `#FFFFFF` | 12,90:1 |
| Botón inactivo: `#35363B` sobre `#E5E7ED` | 9,75:1 |
| Insignia Pendiente: `#002F6D` sobre `#EAF3FF` | 11,53:1 |
| Insignia Pago parcial: `#5F4A00` sobre `#FFF1CC` | 7,59:1 |
| Insignia Pagada / Pagado: `#00581F` sobre `#E1FAE3` | 7,86:1 |
| Insignia Vencida / Rechazado y error de campo: `#9E141E` sobre `#FFEDEB` | 7,22:1 |
| Insignia En verificación: `#35363B` sobre `#F3F4F9` | 10,97:1 |
| Texto secundario: `#4D4E53` sobre `#FAFBFF` | 8,03:1 |
| Texto principal: `#1C1D20` sobre `#FFFFFF` | 16,85:1 |
| `ResumenTotal`: `#FFFFFF` sobre `#002F6D` | 12,90:1 |
| Enlace: `#00459A` sobre `#FAFBFF` | 8,76:1 |
| Borde de campo (no texto): `#6B6D74` sobre `#FFFFFF` | 5,17:1 |
| Trazo Vencida (no texto): `#D81327` sobre `#FFEDEB` | 4,59:1 |

## Tipografía

Familias de EPT-95: **Outfit** (texto y títulos) y **Geist Mono** (importes, fechas y números de operación). Las fuentes y su licencia están en `docs/parte3/EPT-95/fuentes/fuentes-tipograficas/` y `LICENCIAS.md`. La carga en Expo (por ejemplo con `expo-font`) corresponde a EPT-102; este catálogo no instala nada.

| Nombre RN | Familia · peso | Tamaño | Interlineado | Origen en `estilos.css` | Uso |
|---|---|---|---|---|---|
| `texto.titulo` | Outfit · 600 | 20 | 1,2 | `h2`, `.h1` del prototipo | Título de pantalla y de sección |
| `texto.tituloEncabezado` | Outfit · 600 | 24 | 1,15 | `.topbar .t` | Título del encabezado de la aplicación (fuera del catálogo) |
| `texto.subtitulo` | Outfit · 600 | 16 | 1,4 | `h3`, `.h3` | Período de una tarjeta, concepto |
| `texto.cuerpo` | Outfit · 400 | 16 | 1,4 | `body` | Texto corriente, datos |
| `texto.etiquetaCampo` | Outfit · 600 | 16 | 1,4 | `.field label` | Etiqueta persistente de campo |
| `texto.boton` | Outfit · 600 | 16 | — | `.btn` | Etiqueta de botón |
| `texto.seccion` | Outfit · 600 | 14, mayúsculas, espaciado 0,04 em | 1,4 | `.sec` | Cabecera de bloque («Ítems», «Archivos») |
| `texto.insignia` | Outfit · 600 | 14 | 1,4 | `.badge` | Texto de insignia de estado |
| `texto.aviso` | Outfit · 500 | 15 | 1,4 | `.err-txt`, `.ctx` | Mensaje de error de campo y texto de `ContextoHijo` |
| `texto.avisoCuerpo` | Outfit · 400 | 15 | 1,4 | `.alert` | Cuerpo de `Aviso` |
| `texto.avisoTitulo` | Outfit · 700 | 15 | 1,4 | `.alert strong` | Primera línea en negrita de `Aviso` |
| `texto.pie` | Outfit · 600 | 12 | — | `.nav div` | Etiqueta de la barra inferior (fuera del catálogo) |
| `texto.importe` | Geist Mono · 500 | 16 | — | `.mono` | Importes, fechas, números de operación |
| `texto.importeTotal` | Geist Mono · 600 | 28 | — | `.total .mono` | Total de `ResumenTotal` |

Observaciones heredadas del diseño aprobado, **no modificadas por EPT-99**:

1. Los avisos y mensajes de error se dibujan a 15 px (`.9375rem`), un píxel por debajo del criterio de cuerpo (≥ 16 px) que enuncia `estados-y-roles.md`. Se conserva el valor aprobado y se deja constancia para la revisión de accesibilidad de EPT-102.
2. `letter-spacing: .04em` sobre 14 px equivale a `letterSpacing` ≈ 0,56 en React Native (valor numérico, no em).

## Espaciado, bordes y radios

| Nombre RN | Valor | Estado del nombre | Dónde se ve |
|---|---|---|---|
| `espacio.xs` | 4 | Alias propuesto | Separación entre ítems de lista simple, `gap` de pestañas |
| `espacio.sm` | 8 | Alias propuesto (ritmo de 8 px, `estados-y-roles.md`) | Separación entre elementos de un bloque, `gap` de botón con ícono |
| `espacio.md` | 12 | Alias propuesto | Separación interna de tarjeta, relleno de fila |
| `espacio.lg` | 16 | Alias propuesto | Relleno de tarjeta y separación entre bloques |
| `espacio.xl` | 20 | Alias propuesto (margen de 20 px, `estados-y-roles.md`) | Margen horizontal de pantalla |
| `radio.sm` | 4 | `--radius-sm` | Casilla, pestaña |
| `radio.md` | 8 | `--radius-md` | Botón, campo, aviso, archivo |
| `radio.lg` | 16 | `--radius-lg` | Tarjeta, resumen total |
| `radio.pastilla` | 999 | Literal de `.badge` | Insignia |
| `borde.fino` | 1 | Literal | Tarjeta, separador, fila de archivo |
| `borde.insignia` | 1,5 | Literal de `.badge` | Insignias; en RN `borderWidth` admite valores fraccionarios, el render real depende de la densidad |
| `borde.control` | 2 | Literal de `.btn`, `.input` | Botón, campo |
| `borde.enfasis` | 2,5 | Literal de `.b-vencida`, `.chk` | Insignia Vencida y casilla |
| `borde.estado` | 6 | Literal de `.cuota` | Trazo izquierdo de `TarjetaCuota` |

Valores sueltos de 6 px (separación etiqueta–campo) y 10 px (relleno de insignia y de aviso) existen en `estilos.css`; se conservan como literales dentro de la ficha que los usa y no se promueven a tokens.

## Objetivos táctiles

| Elemento | Medida | Origen |
|---|---|---|
| Botón, campo, enlace, pestaña (filtro de Cuotas, composición de pantalla), botón de ícono | alto mínimo 48 | `.btn`, `.input`, `.link`, `.tab`, `.icono-boton` |
| Fila con casilla | toda la fila ≥ 48 de alto; la caja visible mide 32 × 32 | `.chk`; `estados-y-roles.md` («la fila completa es el objetivo táctil») |
| Barra inferior (fuera del catálogo) | alto mínimo 56 | `.nav div` |

En React Native se cumple con `minHeight: 48` y, cuando la caja visible es menor, con el `Pressable` cubriendo la fila completa. No se usa `hitSlop` para compensar un control visualmente pequeño dentro de una fila que ya mide 48.

## Estados institucionales y su señal redundante

El estado **nunca** se comunica solo con color (`estados-y-roles.md`). Cada estado lleva texto, ícono y trazo propio:

| Estado | Texto | Ícono (nombre EPT-96) | Trazo del borde | Colores |
|---|---|---|---|---|
| Pendiente | «Pendiente» | `reloj` (círculo con agujas) | punteado, `borde.insignia` | `primario50` / `primario700` / `primario500` |
| Pago parcial | «Pago parcial» | `parcial` (medio círculo relleno) | continuo, `borde.insignia` | `advertenciaFondo` / `advertenciaTexto` |
| Pagada · Pagado | «Pagada» · «Pagado» | `check` (tilde en círculo) | continuo, `borde.insignia` | `exitoFondo` / `exitoTexto` |
| Vencida · Rechazado | «Vencida» · «Rechazado» | `alerta` (triángulo) | continuo grueso, `borde.enfasis` | `peligroFondo` / `peligroTexto` |
| En verificación · Pendiente de verificación | «En verificación» · «Pendiente de verificación» | `ojo` | punteado fino, 2 | `neutro100` / `neutro700` / `neutro600` |

Los íconos del prototipo son trazos SVG de 24 × 24 definidos en `docs/parte3/EPT-96/prototipo/js/vista.mjs`. Qué librería de íconos usa la aplicación (por ejemplo `react-native-svg`) lo decide EPT-102; el contrato solo exige que cada estado conserve su forma distintiva.
