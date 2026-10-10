# EPT-99 — Evidencia del catálogo de componentes móviles

**Estado: catálogo documental de contratos para React Native, verificado de forma estructural y con revisión independiente.** No es una aplicación, no es el proyecto Expo (EPT-102), no ejecuta nada en Android o iOS y no constituye una aprobación humana o docente.

## Cómo revisarlo

Orden de lectura sugerido: `docs/parte3/EPT-99/README.md` → `matriz-cobertura.md` → `componentes/01` a `07` → `separacion-contenedor-presentacional.md` → `handoff-expo-react-native.md` → `tokens.md` y `contratos-vista.md`.

## Criterios de Jira

| Criterio | Evidencia |
|---|---|
| **CA1.** Catálogo con botones, tarjetas, badges, listas y formularios | Fichas 01 (`Boton`), 03 (`Tarjeta`, `TarjetaCuota`, `TarjetaPago`), 02 (`InsigniaEstado`), 04 (listas y filas) y 05 (`CampoTexto`, `Formulario`); más 06 y 07 por reutilización medida. Comprobaciones V01, V02, V03 |
| **CA2.** Separa contenedor/presentacional y estados institucionales | `separacion-contenedor-presentacional.md` (responsabilidades, dependencias y mapa de cuotas, detalle, selección y comprobantes); estados en fichas 02, 03 y 06 y matriz §3–§4. Comprobaciones V02, V05, V06 |

Matriz criterio → componente → ficha → comprobación: `docs/parte3/EPT-99/matriz-cobertura.md`.

## Entregables

| Ruta | Contenido |
|---|---|
| `docs/parte3/EPT-99/README.md` | Índice, decisiones, supuestos y puntos abiertos, límites y rollback |
| `docs/parte3/EPT-99/componentes/01…07` | Siete fichas: 18 piezas con propósito, láminas, variantes, props, eventos, estados, tokens, contenido largo, accesibilidad, responsabilidades y ejemplo |
| `docs/parte3/EPT-99/tokens.md` | Colores, tipografía, espaciado, bordes, objetivos táctiles, estados y contrastes recalculados |
| `docs/parte3/EPT-99/contratos-vista.md` | Tipos compartidos entre contenedor y vista |
| `docs/parte3/EPT-99/separacion-contenedor-presentacional.md` | Reglas, dependencias, mapa de pantallas, ciclo del envío de comprobante |
| `docs/parte3/EPT-99/handoff-expo-react-native.md` | Objeto de tokens, traducción a nativo, API verificadas, áreas seguras, teclado, texto ampliado y verificaciones para EPT-102 |
| `docs/parte3/EPT-99/matriz-cobertura.md`, `bitacora-academica.md` | Trazabilidad y bitácora de aportes de IA |
| `docs/evidence/EPT-99.md` | Este documento |

No se modificó `docs/parte3/EPT-95/`, `docs/parte3/EPT-96/`, `src/`, `supabase/`, `scripts/` ni `.github/`.

## Aplicabilidad del pipeline por impacto

La unidad cambia solamente archivos Markdown bajo `docs/`. Para `scripts/ci/impact.mjs` eso es **documentación pasiva** (`/^docs\/.*\.md$/`): el plan es `db=false`, `mutations=false`, `ui=[]`, sin prototipo. En consecuencia:

- **No** corresponde levantar base de datos ni ejecutar contratos DB, UI core, `npm run build`, `tsc` del proyecto ni lint del producto: no hay cambios de esquema, de `src/` ni de CI.
- **No** se agregó JSON ni scripts bajo `docs/parte3/EPT-99/`: hacerlo exigiría registrar cobertura en `scripts/ci/` y clasificaría código activo como documentación. El verificador de esta unidad es local, de solo lectura, y su descripción está en la sección siguiente.
- `CI / gate` sobre el SHA final del PR es el control de integración (ver «PR, integración y cierre»).

## Verificación

Ejecutada localmente en Windows 10 con Node 24 y TypeScript del repositorio principal (solo para compilar los bloques; no se instaló nada). La unidad usa un **verificador local de solo lectura** (no integrado al repositorio, para no abrir excepciones de CI) que implementa las comprobaciones V01–V09 de `matriz-cobertura.md`: lee los Markdown, extrae los bloques `ts`/`tsx`, los compila juntos con `tsc --noEmit` en modo `strict` contra declaraciones mínimas de `View`, `Text` y similares, resuelve enlaces y anclas, contrasta hexadecimales con `estilos.css`, recalcula contrastes WCAG, busca importaciones prohibidas en las vistas y evalúa el selector `scripts/ci/impact.mjs` sobre las rutas cambiadas.

| ID | Comprobación | Resultado |
|---|---|---|
| V01 | Siete fichas con las once secciones obligatorias; 18 piezas con declaración de contrato | **PASS** |
| V02 | Cuatro estados económicos con texto e ícono en `InsigniaEstado`, filas en la matriz; tipo `EstadoFactura` de cuatro valores | **PASS** |
| V03 | 17 bloques (9 `ts`, 8 `tsx`) compilan juntos con `tsc --noEmit` estricto: props, eventos y ejemplos coherentes | **PASS** (sin errores) |
| V04 | 168 enlaces relativos en 15 documentos; 32 láminas de EPT-95 distintas, todas en `manifest.json`; anclas válidas | **PASS** (0 rotos) |
| V05 | 25 valores hexadecimales, todos presentes en `estilos.css`; 105 referencias a tokens con definición; 14 contrastes recalculados coinciden con lo documentado | **PASS** |
| V06 | 7 vistas y 2 contenedores de ejemplo; sin importaciones de Supabase, navegación, almacenamiento ni `next/*`; sin hooks de datos dentro de vistas; sin campos de sesión en los DTO | **PASS** |
| V07 | Sin datos bancarios reales; supuestos S1–S3 presentes como pendientes; único texto sobre efectivo/QR/pasarela es la exclusión del README | **PASS** |
| V08 | `profile()` de `impact.mjs` sobre las rutas cambiadas: `{"db":false,"mutations":false,"ui":[]}`; ninguna ruta fuera de `docs/parte3/EPT-99/` y `docs/evidence/EPT-99.md`; sin espacios finales | **PASS** |
| V09 | Conteos de reutilización citados (12, 14, 11, 26, 35, 23, 7, 24, 11) coinciden con `pantallas.mjs` | **PASS** |

Duración del verificador: ≈ 8 s. Resumen: **9 PASS, 0 FAIL**.

**Pruebas negativas del verificador** (copias con una rotura cada una, ≈ 44 s): ficha sin sección de accesibilidad (V01), estado «Pago parcial» ausente (V02), prop inexistente en un ejemplo (V03), enlace roto a una lámina (V04), color fuera de `estilos.css` (V05), vista que importa Supabase (V06), supuesto S1 convertido en regla (V07) y conteo desactualizado (V09): **8 de 8 detectadas**.

Procedimiento de contraste (referido por `tokens.md`): luminancia relativa WCAG 2.x, `L = 0,2126 R + 0,7152 G + 0,0722 B` con canales linealizados (`c ≤ 0,03928 → c/12,92`, en otro caso `((c + 0,055)/1,055)^2,4`), relación `(L1 + 0,05)/(L2 + 0,05)` con `L1 ≥ L2`.

| Comando local | Resultado |
|---|---|
| Verificador V01–V09 sobre el worktree | 9 PASS, 0 FAIL |
| Negativas del verificador | 8/8 detectadas |
| `git diff --check origin/main HEAD` | exit 0 (se registra tras el commit en el comentario de cierre) |
| `node --test scripts/ci/impact.test.mjs`, `npm run build`, contratos DB y UI | No aplican: no cambia CI ni código; los cubre `CI / gate` según el plan por impacto |

**Verificación de nombres de React Native:** contraste de cada nombre usado en los contratos contra la documentación oficial (conector de documentación, versiones 0.77 a 0.87) el 10/10/2026. El handoff separa los nombres verificados de los «conocidos, a confirmar».

## Revisión independiente

Dos revisiones ordinarias de solo lectura sobre el candidato (RDD apagado y no se activó); no constituyen aprobación humana ni docente.

| Revisión | Alcance | Hallazgos | Tratamiento |
|---|---|---|---|
| Adversarial de reglas | Reglas inventadas, afirmaciones de verificación, separación, conteos y español | 1 bloqueante (afirmaciones de verificación pendientes en esta evidencia), 4 importantes y 5 menores | Evidencia completada con órdenes y resultados; el bloqueo por banco no configurado se atribuye al prototipo de EPT-96 (A10); el ejemplo del detalle de factura ya no recibe el rol y distingue «solo consulta» de «sin ítems»; el supuesto S1 ya no aparece como caso de prueba; el cálculo provisional del total queda sujeto a A2 |
| Técnica y de fidelidad | Láminas citadas, tokens, tipos y nombres de React Native, contra HTML y CSS de EPT-95/96 | 2 bloqueantes (el bloqueo por banco y V06 citados como respaldo de lo que las láminas no muestran), 10 importantes y 8 menores | V06 pasa a `Aviso` informativo; M06 ya no cita `TarjetaPago`; el resumen de errores y el bloqueo por banco se atribuyen al prototipo; `Importe` ya no cambia de peso; se agregan `avisoCuerpo` y `avisoTitulo` (400 y 700), interlineados y peso 700; `SeleccionDePagoVista` agrupa por factura; el envío evita duplicados y usa `||`; control «Mostrar» de la contraseña; permiso del original por pago; pestañas documentadas como composición |

Hallazgos no aplicados: la redacción de un mensaje de ejemplo del selector (menor). Los nombres de React Native revisados no arrojaron observaciones; los no verificados figuran como tales en el handoff.

## Límites

- Ninguna comprobación ejecuta Android o iOS, TalkBack ni VoiceOver, teclado nativo ni escalado real del sistema. El comportamiento de las piezas queda como contrato hasta que EPT-102 implemente y verifique la aplicación.
- La compilación de los bloques TypeScript usa declaraciones mínimas de `View`, `Text` y similares: valida sintaxis y coherencia de tipos entre fichas, no el uso real de la API de React Native.
- Los nombres de React Native se verificaron contra la documentación oficial (versiones 0.77 a 0.87); la versión instalada por EPT-102 deberá volver a contrastarse.
- No hay aprobación docente de las láminas de EPT-95 ni del prototipo de EPT-96.
- Los supuestos S1 a S3 del prototipo (número de operación, fecha futura, deuda por vencimiento) y los puntos abiertos A1 a A11 quedan listados en `docs/parte3/EPT-99/README.md`.

## Rollback

Revertir el commit de integración (elimina `docs/parte3/EPT-99/` y este documento). No afecta producto, base de datos, CI, EPT-95 ni EPT-96.

## PR, integración y cierre

PR, SHA final, resultados de `CI / gate` y commit de integración se registran en el comentario de cierre de EPT-99 en Jira, que es la fuente del estado posterior a este documento.
