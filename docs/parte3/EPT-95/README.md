# EPT-95 — Diseños móviles de Educar para Transformar

Wireframes, mockups y variantes **estáticos** de las nueve áreas móviles de Parte 3. No son una aplicación ejecutada, un prototipo navegable (EPT-96) ni el catálogo de componentes (EPT-99). Ningún archivo prueba comportamiento nativo en Android o iOS.

## Qué contiene

| Ruta | Contenido | Estado |
|---|---|---|
| `disenos/wireframes/` | 9 wireframes en escala de grises, con notas numeradas | **Entregable aceptado** |
| `disenos/mockups/` | 9 mockups con la identidad institucional | **Entregable aceptado** |
| `disenos/variantes/` | 26 variantes de roles y estados | **Entregable aceptado** |
| `fuentes/` | HTML/CSS/módulos editables, fuentes tipográficas, logo y generador | Fuente de los diseños |
| `manifest.json` | SHA-256, dimensiones, roles, estados y origen de cada diseño | Registro verificado por CI |
| `matriz-cobertura.md` | Requisito → pantalla → variante → archivo | Trazabilidad |
| `estados-y-roles.md` | Reglas de actores, estados económicos y datos ficticios | Contrato de diseño |
| `historico-stitch/` | 33 PNG de Stitch y su recuperación | **Histórico rechazado**, no cubre ningún criterio |

## Decisión de método

Stitch no permitió completar ni exportar los diseños: los PNG obtenidos eran de escritorio, con texto cortado, cifras partidas y contradicciones, y la exportación ZIP entregó un `screen.png` de 28 bytes con el texto `<FIFE Image failed to fetch>`. El **usuario autorizó expresamente** cambiar el método de producción (10/10/2026). Claude Design no estaba disponible en esta sesión, por lo que los diseños se producen con HTML/CSS locales y un renderizador reproducible (Playwright con Chromium). Esta decisión no implica que la profesora la haya aprobado ni que existan IDs de Stitch para los diseños nuevos: su origen es `diseno-local`.

## Cómo regenerar las imágenes

Desde la raíz del repositorio, con Playwright instalado (`npm ci`) o indicando su ruta:

```bash
# opcional: EPT95_PLAYWRIGHT=/ruta/absoluta/node_modules/playwright/index.mjs
node docs/parte3/EPT-95/fuentes/render.mjs html       # escribe fuentes/html/*.html desde pantallas.mjs
node docs/parte3/EPT-95/fuentes/render.mjs verificar  # desborde, contraste y objetivos táctiles medidos
node docs/parte3/EPT-95/fuentes/render.mjs png        # renderiza disenos/**/*.png
node docs/parte3/EPT-95/fuentes/render.mjs manifest   # recalcula hashes y escribe manifest.json
node --test scripts/ci/impact.test.mjs                # validador del paquete y pruebas del selector
```

Parámetros del render: viewport 390 × 844 px CSS, factor 2 (PNG de 780 px de ancho), tema claro, sin animaciones, locale es-AR. La red está bloqueada: toda solicitud que no sea `file:` aborta. Versiones y hashes quedan en `receta-render.json` y `manifest.json`. Para editar un diseño se modifica `fuentes/pantallas.mjs` o `fuentes/estilos.css` y se repite la secuencia anterior.

## Identidad institucional

Tokens de `src/app/globals.css` (baseline `4f4818335ba9b7240c58e04bb17b2e7d87a380cb`) convertidos de OKLCH a sRGB por reducción binaria de croma, sin recorte por canal. Outfit para texto y títulos, Geist Mono para importes y números, logo `public/logo-emblema.png`.

| Token | sRGB | Uso |
|---|---|---|
| primary-500 | `#005DCA` | Acción primaria (texto blanco, 6,14:1) |
| primary-700 | `#002F6D` | Encabezado y totales |
| primary-50 / 200 | `#EAF3FF` / `#A5C9FF` | Contexto y foco |
| neutral-50 / 200 | `#FAFBFF` / `#E5E7ED` | Fondo y bordes |
| neutral-600 / 800 | `#4D4E53` / `#1C1D20` | Texto secundario y principal |
| success / warning / danger | `#008935` / `#D4A800` / `#D81327` | Trazos de estado; el texto usa variantes oscuras del mismo matiz |

El naranja de acento (`#F86200`) no se usa para estados de deuda ni como fondo de texto blanco. `neutral-400` no se usa para texto porque no alcanza 4,5:1 sobre blanco (3,07:1).

## Verificación visual

Las 44 láminas se inspeccionaron como imágenes completas. El script `verificar` mide, sobre cada HTML en anchos de 320, 360 y 390 px: ausencia de scroll horizontal, elementos fuera de pantalla, texto recortado, contraste de cada texto contra su fondo efectivo (mínimo medido 6,14:1) y objetivos táctiles de al menos 48 px. Esa medición es sobre el DOM; la aceptación visual se hizo sobre los PNG exportados.

## Alcance siguiente

EPT-96 podrá construir el prototipo navegable y EPT-99 el catálogo de componentes a partir de estas láminas. EPT-102 implementará Expo y deberá verificar áreas seguras, teclado, escalado, TalkBack/VoiceOver y Android/iOS reales.
