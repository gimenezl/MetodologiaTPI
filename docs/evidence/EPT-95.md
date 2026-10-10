# EPT-95 — Evidencia de diseño móvil

**Estado: entregables estáticos locales completos, revisados de forma independiente y verificados por CI.** 44 láminas PNG (9 wireframes, 9 mockups, 26 variantes) con fuentes editables y regenerables. Son diseños estáticos con datos ficticios: no son una aplicación móvil implementada ni una aprobación humana o docente.

## Decisión de método y procedencia

| Hecho | Detalle |
|---|---|
| Fallo de Stitch acreditado | 33 PNG históricos con exportaciones de escritorio, texto cortado, importes partidos y contradicciones; el ZIP entregado por el usuario contenía `screen.png` de 28 bytes con `<FIFE Image failed to fetch>`, que no es una imagen |
| Autorización expresa del usuario | 10/10/2026, en el chat: cambiar el método de producción cuando Stitch no permita completar o exportar. Autoriza cambiar la herramienta, no reducir cobertura ni aceptar defectos |
| Claude Design | No disponible en esta sesión |
| Método adoptado | HTML/CSS local + renderizador reproducible (Playwright 1.59.1, Chromium 147.0.7727.15, Node v24.19.0) |
| Origen de cada diseño | `diseno-local`, con fuente HTML y SHA-256 en `manifest.json`. No existen IDs ni exportaciones de Stitch para los diseños nuevos y no se fabricó ninguno |
| Aprobación de la profesora | **No** afirmada. El cambio de método es decisión del usuario; no consta conformidad docente |
| Fuentes tipográficas | Outfit (`@fontsource/outfit` 5.2.8, descarga autorizada por el usuario) y Geist Mono (copia de `node_modules/next`), ambas OFL 1.1; logo `public/logo-emblema.png`. Licencias en `fuentes/LICENCIAS.md` |

## Entregables

| Ruta | Contenido |
|---|---|
| [`disenos/`](../parte3/EPT-95/disenos) | `wireframes/` W01–W09, `mockups/` M01–M09, `variantes/` V01–V26 |
| [`manifest.json`](../parte3/EPT-95/manifest.json) | SHA-256, dimensiones, roles, estados, requisitos y origen de las 44 láminas; hash de las 56 fuentes |
| [`matriz-cobertura.md`](../parte3/EPT-95/matriz-cobertura.md) | Requisito → pantalla → variante → archivo, más inventario completo |
| [`estados-y-roles.md`](../parte3/EPT-95/estados-y-roles.md) | Actores, estados económicos, datos ficticios compartidos y handoff accesible |
| [`README.md`](../parte3/EPT-95/README.md) | Receta de regeneración, identidad institucional y límites |
| [`fuentes/`](../parte3/EPT-95/fuentes) | `pantallas.mjs`, `estilos.css`, `render.mjs`, `html/`, fuentes, logo y licencias |
| [`bitacora-academica.csv`](../parte3/EPT-95/bitacora-academica.csv) | Aportes de IA registrados con comprensión, adaptación, prueba y límite |

## Cobertura de las nueve áreas

| # | Área | Wireframe | Mockup | Variantes |
|---|---|---|---|---|
| 1 | Login | W01 | M01 | V01 validación, V02 credenciales inválidas, V03 cuenta bloqueada, V04 sesión expirada, V05 canal web |
| 2 | Selector de hijo | W02 | M02 | V06 sin vínculos |
| 3 | Cuotas | W03 | M03 | V07 estudiante, V08 Pagadas, V09 Pendiente, V10 carga, V11 vacío, V12 error, V13 guía de estados, V26 texto 200 % |
| 4 | Detalle de factura | W04 | M04 | V14 estudiante |
| 5 | Selección y pago | W05 | M05 | V15 validación, V16 pago registrado |
| 6 | Comprobantes | W06 | M06 | V17 validación, V18 confirmación, V19 error incierto, V20 otro padre, V21 estudiante, V25 teclado |
| 7 | Consulta por período | W07 | M07 | V22 estudiante |
| 8 | Deuda por ítem | W08 | M08 | V23 estudiante |
| 9 | Inscripciones | W09 | M09 | V24 estudiante |

Criterios de Jira: las nueve áreas con ambos tipos; paleta institucional (tokens de `src/app/globals.css`); los cuatro estados de cuota con texto, ícono y trazo (Pendiente V09/V13, Pago parcial M03/V13, Pagada V08/V13, Vencida M03/M04/V13). Reglas verificadas en las láminas: Vencida prevalece sobre Pago parcial pasado el día 10; pago pendiente de verificación no es confirmado; ítems pagados o en verificación no seleccionables; datos bancarios «no configurados»; sin efectivo, QR ni pasarela; ESTUDIANTE sin pago ni carga; original del comprobante no expuesto a estudiante ni a otro padre.

## Verificación

| Comprobación | Resultado | Duración |
|---|---|---|
| `render.mjs verificar` (44 pantallas × 320/360/390 px) | 0 problemas: sin scroll horizontal, sin elementos fuera de pantalla ni texto recortado; contraste mínimo medido 6,14:1 sobre el fondo efectivo; objetivos táctiles ≥ 48 px | ≈ 21 s |
| `render.mjs png` dos veces consecutivas | Manifest byte a byte idéntico: render determinista | ≈ 13 s por corrida |
| `node --test scripts/ci/impact.test.mjs` | 18 PASS, 0 FAIL, 0 omitidas (incluye paquete real, 27 negativas de imagen/procedencia, 34 de contenido activo) | 36 s local (Windows) |
| Validación del paquete real (`validateEpt95Assets`) | `{ disenos: 44, historicos: 33 }` | 2,4 s |
| `git diff --check` | exit 0 | < 1 s |
| TypeScript, lint, build, E2E, DB | No aplican localmente al diff (sin cambios en `src/`, `supabase/` ni `tests/`); los ejecuta CI según el selector | — |

Pruebas negativas con código específico: FIFE disfrazado de PNG, JPEG renombrado, PNG truncado, hash incorrecto, dimensiones falsas, lienzo de escritorio, origen Stitch inventado, fuente ausente, hash de fuente alterado, recurso o directorio desconocido, falta de un diseño, área reasignada, falta de estados o actores, escala incoherente, HTML/CSS/módulos con contenido activo y receta ajena. Detalle en `docs/ci.md`.

## Revisión independiente (ordinaria; RDD apagado y no se activó)

Tres revisiones de solo lectura por ronda, con lectura de cada imagen completa y recálculo de importes. No constituyen aprobación humana.

| Ronda | Alcance | Resultado | Correcciones aplicadas |
|---|---|---|---|
| 1 | 18 base · 26 variantes · validador y selector | Aceptar con observaciones menores / aceptar con dos «importantes» / aceptar con observaciones | Copy interno en M05/W05 y M09/W09; trazo de Vencida en W03; texto secundario 16 px y casillas 32 px; pestaña «Período»; chip del hijo en V20; número de operación duplicado entre V17 y V18/V19; V11 coherente con los datos; formulario de login unificado; tarjeta redundante en V20/V21; saldo rotulado en V23; escáner HTML pasó de lista negra a lista cerrada; hashes de fuente atados al ID y a la escala; histórico acotado; prueba del paquete real |
| 2 | Bytes regenerados de 44 láminas y del validador | Variantes: un «importante» (corte de «Pendientes» en V26) y menores; base: notas de W05; código: evasiones de importaciones | Pestañas de V26 sin corte; contexto del hijo en V18/V19; filas de deuda con patrón único; botón inactivo en V17; notas de W05; importaciones y `process` en lista cerrada estricta; documentación de límites |
| 3 | Delta final de imágenes y del escáner de módulos | Ver resultado registrado en el comentario de cierre de Jira | — |

Hallazgos que **no** se corrigen por ser inherentes y estar documentados: CI no vuelve a renderizar (verifica imagen móvil bien formada y hash, no su procedencia píxel a píxel); el análisis de módulos es una lista negra de mejor esfuerzo y su contenido queda atado por hash (no se ejecuta en CI); el emblema oficial conserva la grafía «Trasformar».

## Histórico y rechazados (no cubren ningún criterio)

| Conjunto | Estado |
|---|---|
| 33 PNG de Stitch saneados (`historico-stitch/`) | **Rechazados.** 26 MOBILE y 7 DESKTOP; defectos visuales y económicos documentados en `historico-stitch/recuperacion-acotada.md`. Se conservan íntegros con su procedencia; los originales previos al saneamiento siguen fuera de Git |
| Candidatos JPEG/PNG de las recuperaciones del editor | Fuera del repositorio; ninguno promovido |
| ZIP del usuario (`screen.png` de 28 bytes) | No es una imagen; `code.html` contiene referencias externas y contenido ejecutable y no se incorpora |

## Límites

- No hay ejecución nativa Android/iOS, TalkBack, VoiceOver, teclado nativo ni escalado real; V25 y V26 son láminas de diseño.
- No hay prototipo navegable (EPT-96) ni catálogo de componentes (EPT-99); la barra inferior es una pieza estática.
- Los datos son ficticios; los datos bancarios aparecen como «no configurados».
- Sin cambios de producto, base de datos, migraciones, scheduler ni producción.

## Rollback

Revertir el commit de integración (`docs/parte3/EPT-95/`, `scripts/ci/ept95-assets.mjs`, `scripts/ci/impact.mjs`, `scripts/ci/impact.test.mjs`, `docs/ci.md` y este documento). No afecta producto ni datos.

## PR, integración y cierre

PR, SHA final, resultados de `CI / gate` y commit de integración se registran en el comentario de cierre de EPT-95 en Jira, que es la fuente del estado posterior a este documento.
