# Handoff para la implementación Expo / React Native

Entrega para **EPT-102** («Configurar proyecto Expo en mobile») y las unidades de pantallas posteriores. EPT-99 define contratos; **no** instala Expo, no crea `mobile/package.json` y no compila componentes. Un PASS del catálogo o de Next no demuestra ejecución nativa.

## Cómo usar el catálogo

1. Crear el proyecto Expo (EPT-102) y cargar Outfit y Geist Mono desde `docs/parte3/EPT-95/fuentes/fuentes-tipograficas/` (licencia en `LICENCIAS.md`).
2. Copiar el objeto de tokens de la sección siguiente a un módulo propio; **no** inventar colores nuevos.
3. Implementar las piezas en este orden de dependencia: `Importe`, `Fecha`, `InsigniaEstado`, `Boton`, `Aviso`, `Tarjeta`, filas y `ResumenTotal`, `TarjetaCuota`/`TarjetaPago`, `CampoTexto`, `Formulario`, `EstadoPantalla`, `ContextoHijo`.
4. Implementar los contenedores según el [mapa](./separacion-contenedor-presentacional.md#mapa-de-pantallas-contenedor--vista--catálogo).
5. Contrastar cada pieza con la lámina que cita su ficha y con la [matriz de cobertura](./matriz-cobertura.md).

Estructura de carpetas **propuesta** (EPT-97 §8 ubica la aplicación en `mobile/`; la decisión final es de EPT-102):

```text
mobile/src/
  tokens/            # objeto de tokens (esta página)
  catalogo/          # piezas presentacionales de este catálogo
  contenedores/      # una carpeta por pantalla: contenedor + hook de datos + adaptador
  servicios/         # acceso a PostgREST/RPC/Storage; único lugar con supabase-js
```

## Objeto de tokens propuesto

Valores idénticos a [`tokens.md`](./tokens.md), que a su vez los toma de `docs/parte3/EPT-95/fuentes/estilos.css`.

```ts
export const color = {
  primario50: '#EAF3FF',
  primario100: '#D0E3FF',
  primario200: '#A5C9FF',
  primario500: '#005DCA',
  primario600: '#00459A',
  primario700: '#002F6D',
  neutro50: '#FAFBFF',
  neutro100: '#F3F4F9',
  neutro200: '#E5E7ED',
  neutro300: '#C7C8D0',
  neutro500: '#6B6D74',
  neutro600: '#4D4E53',
  neutro700: '#35363B',
  neutro800: '#1C1D20',
  superficie: '#FFFFFF',
  exito: '#008935',
  exitoTexto: '#00581F',
  exitoFondo: '#E1FAE3',
  advertencia: '#D4A800',
  advertenciaTexto: '#5F4A00',
  advertenciaFondo: '#FFF1CC',
  peligro: '#D81327',
  peligroTexto: '#9E141E',
  peligroFondo: '#FFEDEB',
} as const

export const espacio = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 } as const
export const radio = { sm: 4, md: 8, lg: 16, pastilla: 999 } as const
export const borde = { fino: 1, insignia: 1.5, control: 2, enfasis: 2.5, estado: 6 } as const

export interface EstiloTexto {
  familia: 'texto' | 'mono'
  peso: '400' | '500' | '600' | '700'
  tamano: number
  /** Interlineado absoluto (tamaño × factor de `estilos.css`). */
  interlineado?: number
}

export const texto: Record<string, EstiloTexto> = {
  titulo: { familia: 'texto', peso: '600', tamano: 20, interlineado: 24 },
  tituloEncabezado: { familia: 'texto', peso: '600', tamano: 24, interlineado: 27.6 },
  subtitulo: { familia: 'texto', peso: '600', tamano: 16, interlineado: 22.4 },
  cuerpo: { familia: 'texto', peso: '400', tamano: 16, interlineado: 22.4 },
  etiquetaCampo: { familia: 'texto', peso: '600', tamano: 16, interlineado: 22.4 },
  boton: { familia: 'texto', peso: '600', tamano: 16 },
  seccion: { familia: 'texto', peso: '600', tamano: 14, interlineado: 19.6 },
  insignia: { familia: 'texto', peso: '600', tamano: 14, interlineado: 19.6 },
  aviso: { familia: 'texto', peso: '500', tamano: 15, interlineado: 21 },
  avisoCuerpo: { familia: 'texto', peso: '400', tamano: 15, interlineado: 21 },
  avisoTitulo: { familia: 'texto', peso: '700', tamano: 15, interlineado: 21 },
  pie: { familia: 'texto', peso: '600', tamano: 12 },
  importe: { familia: 'mono', peso: '500', tamano: 16 },
  importeTotal: { familia: 'mono', peso: '600', tamano: 28 },
}

export const tactil = { minimo: 48, casilla: 32, barraInferior: 56 } as const
```

El nombre de familia que recibe `fontFamily` depende de cómo EPT-102 cargue las fuentes (por ejemplo, un nombre por peso); por eso el objeto separa `familia` y `peso` y deja la resolución a un único módulo.

## Traducción del diseño estático a nativo

El diseño de EPT-95 es HTML/CSS **de referencia visual**. Nada de ese marcado, ni los atributos ARIA, ni Next, es la implementación: se traduce así.

| En el diseño (HTML/CSS) | En React Native |
|---|---|
| `div`, `section`, `article` | `View` |
| `p`, `span`, `h1`–`h3`, `strong` | `Text` (títulos con `accessibilityRole="header"`) |
| `button`, `a` tocable | `Pressable` con `onPress` |
| `input` | `TextInput` |
| `ul`/`li` | `FlatList` (lista extensa) o `View` con `role="list"` y `role="listitem"` (lista corta) |
| `label for` | `accessibilityLabel` + texto visible; en Android `nativeID` + `accessibilityLabelledBy` |
| `svg` (íconos) | Librería de SVG a elegir en EPT-102 |
| `aria-live`, `role="alert"`, `role="status"` | `accessibilityLiveRegion` (Android), `accessibilityRole="alert"`, `AccessibilityInfo.announceForAccessibility` |
| `aria-disabled`, `aria-invalid` | `accessibilityState={{ disabled }}`; el error se comunica con texto visible y `accessibilityHint` |
| `:focus-visible`, `box-shadow` de foco | No hay equivalente directo: foco visible solo para teclado físico/conmutador; el halo del campo se dibuja con un contenedor |
| `rem`, `px`, `min()` / `vw` | Números sin unidad; `useWindowDimensions` para magnitudes relativas |
| `white-space: nowrap` en importes | Sin `numberOfLines` y con `flexShrink: 0`; la fila admite `flexWrap: 'wrap'` |
| `overflow-wrap: anywhere` | El texto se parte por defecto; verificar cadenas largas sin espacios (número de operación, nombre de archivo) en dispositivo |
| Barra inferior fija | Navegación: responsabilidad de EPT-102 (Expo Router); no forma parte del catálogo |
| Pestañas Pendientes / Pagadas de Cuotas (`.tabs`, `.tab`) | Filtro dentro de una pantalla, una sola vez: composición de la pantalla con `Pressable`, `accessibilityRole="tab"` en cada pestaña y `"tablist"` en el grupo, alto 48, radio `radio.sm`, fondo `neutro200`, pestaña activa `superficie` con trazo inferior `primario500`; no es pieza del catálogo (README D3) |

## Propiedades y componentes de React Native utilizados

Verificados en esta unidad contra la documentación de React Native (sitio oficial, versiones 0.77 a 0.87) el 10/10/2026. La versión efectiva la fija EPT-102 y debe volver a comprobarse contra ella.

| Nombre | Dónde se usa |
|---|---|
| `View`, `Text`, `Pressable` (`onPress`, `disabled`, `style` como función con `pressed`) | Todas las piezas |
| `TextInput` (`value`, `onChangeText`, `onSubmitEditing`, `inputMode`, `keyboardType`, `returnKeyType`, `placeholder`, `maxFontSizeMultiplier`, `autoComplete`) | `CampoTexto` |
| `TextInput.submitBehavior` (reemplaza a `blurOnSubmit`, que está en desuso) | Campo de envío final |
| `FlatList` (`data`, `renderItem`, `keyExtractor`, `extraData`), `SectionList` | Listas extensas del contenedor |
| `KeyboardAvoidingView` (`behavior`), `ScrollView.keyboardShouldPersistTaps` (`never`, `always`, `handled`) | `Formulario` |
| `ActivityIndicator` (`animating`, `color`, `size`) | `Boton` en `cargando` |
| `RefreshControl` (`refreshing`, `onRefresh`) | Recarga manual de listas, opcional |
| `accessibilityRole` (`button`, `link`, `checkbox`, `header`, `alert`, `text`, `tab`, `tablist`) y su alias `role` (`list`, `listitem`, `heading`, `img`, `presentation`, …); `role` tiene precedencia | Todas las fichas |
| `accessibilityState` con `disabled`, `selected`, `checked`, `busy`, `expanded` (**no** existe `pressed`) | Botón, fila seleccionable, carga |
| `accessibilityLabel`, `accessible` | Todas las fichas |
| `accessibilityLiveRegion` (`none`, `polite`, `assertive`; solo Android) | `Aviso`, `ResumenTotal`, `EstadoPantalla` |
| `accessibilityLabelledBy` con `nativeID` (solo Android) | `CampoTexto` |
| `importantForAccessibility` (Android) | Íconos decorativos |
| `AccessibilityInfo.announceForAccessibility` | Contenedores y `ResumenTotal` |
| `Text`: `numberOfLines`, `allowFontScaling`, `maxFontSizeMultiplier`, `adjustsFontSizeToFit` con `minimumFontScale` | Reglas de contenido largo |
| `react-native-safe-area-context` (`SafeAreaView`, `SafeAreaProvider`) | Marco de pantalla |

Nombres **conocidos pero no verificados en esta unidad**; EPT-102 los confirma contra la versión instalada antes de usarlos: `accessibilityHint`, `TextInput.secureTextEntry`, `TextInput.editable`, `useWindowDimensions`, `Platform.select` y `FlatList.ListEmptyComponent`.

## Áreas seguras, teclado y texto ampliado

Lo que EPT-95 dejó **pendiente de implementación** (`estados-y-roles.md`, «Handoff accesible»):

| Tema | Requisito del diseño | Decisión para EPT-102 |
|---|---|---|
| Áreas seguras | Respetar superior e inferior (el encabezado reserva 24 px superiores) | Aplicar márgenes con `react-native-safe-area-context` al marco de pantalla, no a cada pieza |
| Teclado | Formulario desplazable con la acción visible por encima del teclado | `Formulario` con `KeyboardAvoidingView` y `ScrollView`; verificar el comportamiento en Android (modo de redimensionado de la ventana) e iOS |
| Texto ampliado | Con 200 % crece la altura y la barra inferior pasa a dos filas; nunca hay scroll horizontal | No limitar `allowFontScaling`; decidir si el pie de la barra inferior necesita `maxFontSizeMultiplier`; verificar a 200 % y a los tamaños de accesibilidad de iOS |
| Importes | Nunca partidos ni cortados | Ver la nota de `ResumenTotal` en [`04-listas-y-filas.md`](./componentes/04-listas-y-filas.md) |
| Objetivos táctiles | ≥ 48 | `minHeight: 48` y fila completa en casillas |

## Verificaciones que quedan para EPT-102 (no ejecutadas en EPT-99)

| Verificación | Cómo |
|---|---|
| Ejecución en Android e iOS reales o emuladores | Compilar la app Expo y recorrer las pantallas |
| TalkBack y VoiceOver | Orden de lectura, anuncio de estados y errores, lectura de importes |
| Teclado nativo | Campos de fecha, importe y número de operación; acción visible |
| Escalado del sistema 200 % | Cuotas (V26) y totales |
| Cadenas largas | Nombre de archivo y número de operación largos y sin espacios (la longitud permitida está pendiente: supuesto S1) |
| Contraste en pantalla real | Modo claro; el modo oscuro no está diseñado |
| Consistencia web–móvil | Mismos importes y estados que la web (DoD del PDF) |

## Puntos abiertos que este catálogo no resuelve

Se detallan en el [README](./README.md#supuestos-y-puntos-abiertos); los que afectan a la implementación de componentes son: estados de **presionado** y **cargando** del botón (no ilustrados), origen del total mostrado durante la selección, forma de transporte de los importes, origen de `puedeAbrirOriginal`, y el comportamiento de cadenas largas.
