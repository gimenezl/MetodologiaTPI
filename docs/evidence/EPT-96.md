# EPT-96 — Evidencia del prototipo navegable

**Estado: prototipo local recorrible, probado en Chromium real, con revisión independiente y verificación focal en CI.** Es un prototipo con datos y operaciones simulados: no es la aplicación Expo (EPT-102), no es el catálogo de componentes (EPT-99) y no constituye una aprobación humana o docente.

## Cómo abrirlo y recorrerlo

```bash
node docs/parte3/EPT-96/servidor/servidor.mjs        # http://127.0.0.1:4196/
```

Elegir una cuenta de ejemplo (no se solicitan contraseñas). Recorrido PADRE: Laura Ejemplo → Mateo → Cuotas → «Septiembre 2026» → «Seleccionar ítems para pagar» → habilitar el escenario simulado en el panel de simulación → elegir comedor de septiembre y transporte y comedor de octubre (ARS 63.606,65) → «Registrar pago» → «Cargar comprobante» → archivo de ejemplo y número de operación → «Enviar comprobante». Detalle, cuentas y escenarios en `docs/parte3/EPT-96/README.md` y `mapa-navegacion.md`.

## Criterios de Jira

| Criterio | Evidencia |
|---|---|
| **CA1.** Recorrer cuotas, selección/pago y carga de comprobantes antes de programar | Recorridos R1, R2, R7 y R8; pruebas N01–N06, N12, N15 y U01–U07; capturas `N01-*` a `N06-*`, `N12-*`, `N15-*` |
| **CA2.** Conserva navegación por rol | Recorridos R3, R4 y R5; pruebas N07–N10, N16 y U08; capturas `N07-*` a `N10-*`, `N16-*`; mapa de rutas por rol |

Matriz completa criterio → recorrido → prueba → evidencia: `docs/parte3/EPT-96/matriz-aceptacion.md` (redactada antes de implementar).

## Entregables (`docs/parte3/EPT-96/`)

| Ruta | Contenido |
|---|---|
| `prototipo/` | `index.html`, `estilos.css` y seis módulos (`datos`, `dinero`, `reglas`, `vista`, `pantallas`, `app`): 19 pantallas, ruteo por hash y guardas por rol, vínculo y cargador |
| `servidor/servidor.mjs` | Servidor local de lista cerrada (15 rutas), solo `127.0.0.1`, `GET`/`HEAD`, `Host` validado y CSP exacta |
| `pruebas/prototipo.mjs` | Runner: 8 pruebas puras, 6 de servidor y 17 de navegador real; cuenta aserciones y autoverifica las pruebas ejecutadas |
| `evidencia/` | 47 capturas de los recorridos finales (390 px, factor 1; el panel de simulación se oculta) |
| `matriz-aceptacion.md`, `mapa-navegacion.md`, `README.md` | Contrato de prueba, navegación por rol y receta |
| `receta-prototipo.json`, `bitacora-academica.csv` | Receta de arranque y bitácora de aportes de IA |

Cambios de CI: `scripts/ci/ept96-assets.mjs` (registro literal y escáneres), `scripts/ci/impact.mjs`, `scripts/ci/impact.test.mjs`, `.github/workflows/ci.yml` y `docs/ci.md`.

## Verificación

Ejecutada localmente en Windows 10 con Node 24.19.0 y Chromium de Playwright.

| Comprobación | Resultado | Duración |
|---|---|---|
| `node docs/parte3/EPT-96/pruebas/prototipo.mjs` (candidato final) | **31 PASS, 0 FAIL**: U01–U08, S01–S06, N01–N16 y N13b; contraste mínimo medido 6,14:1 | ≈ 25 s |
| `node --test scripts/ci/impact.test.mjs` | **25 PASS, 0 FAIL, 0 omitidas** (incluye paquete real EPT-95 y EPT-96, negativas de HTML, CSS, módulos, servidor, runner, PNG y gate de CI) | ≈ 76 s local |
| `npx tsc --noEmit` | exit 0 (sin cambios en `src/`) | 1 min 32 s |
| `npm run lint` | exit 0: 32 advertencias preexistentes, ninguna del paquete EPT-96 | 57 s |
| `npx eslint docs/parte3/EPT-96 scripts/ci/ept96-assets.mjs scripts/ci/impact.mjs` | exit 0, sin advertencias | < 10 s |
| `git diff --check` | exit 0 | < 1 s |
| `npm run build`, contratos DB y UI core | Los ejecuta `CI / gate` sobre el SHA final (el selector exige core por cambiar `scripts/ci/`); no se repiten localmente | — |

Qué demuestra el runner en navegador real:

| Prueba | Demuestra |
|---|---|
| N01 | Recorrido PADRE completo hasta la confirmación «pendiente de verificación»; saldo y deuda sin cambios |
| N02 | Dos hijos sin mezclar importes, selección ni registros; factura de otro hijo denegada |
| N03 | Ítems pagados o en verificación no seleccionables; totales y teclado (Espacio) |
| N04 | Banco no configurado bloquea «Registrar pago»; sin CBU, alias ni titular; escenario simulado inequívoco |
| N05 | Validaciones (fecha, importe, operación única, JPG/PNG/PDF y 5 MB); importe distinto como dato de conciliación; saldo intacto |
| N06 | Resultado incierto: relectura antes de reintentar, sin duplicados, ni con doble clic ni con «Atrás» |
| N07 | ESTUDIANTE sin selector, pago, selección ni original |
| N08 | Navegación directa denegada: estudiante, otro padre, sin sesión, pagos ajenos |
| N09 | DIRECTOR, DOCENTE y PERSONAL orientados al canal web sin datos económicos |
| N10 | Validación de ingreso, mensaje genérico idéntico, cuenta bloqueada, sin vínculos, sesión expirada |
| N11 | Volver, cancelar, reiniciar y borrador descartado; pago aprobado sin pantalla de registro |
| N12 | Carga, error y reintento, vacío, rango inclusivo y rango inválido |
| N13/N13b | Enlaces internos, recursos de la lista cerrada, cero solicitudes externas, cero violaciones de CSP, consola sin errores |
| N14 | Foco visible y teclado; contraste, objetivos táctiles ≥ 48 px y sin scroll horizontal a 320/360/390 px; texto al 200 % |
| N15 | Sumas coherentes entre selector, cuotas, deuda por ítem y período |
| N16 | Otro padre vinculado ve el registro, no el original; solo quien cargó lo abre |

## Revisión independiente (ordinaria; RDD apagado y no se activó)

Cuatro revisiones de solo lectura sobre el candidato; no constituyen aprobación humana.

| Ronda | Alcance | Resultado | Correcciones aplicadas |
|---|---|---|---|
| 1 | Lógica y navegación · servidor y fuentes activas · cambios de CI | Sin bloqueantes. Importantes: doble clic duplicaba el comprobante; «Atrás» tras un resultado incierto saltaba la relectura; el gate no verificaba el paso del prototipo; las pruebas obligatorias se comprobaban solo por texto; la CSP se verificaba parcialmente | Bandera de envío con `finally`; redirección al resultado incierto hasta releer; gate con `PLAN_PROTOTIPO`/`PASO_PROTOTIPO`; el runner cuenta aserciones y autoverifica; CSP exacta; además `pago-enviado` sin comprobante, pagos aprobados, sesión viva al ingresar, período con pagos sin fecha, filtros sin aplicar, cabeceras en errores y endurecimiento de escáneres |
| 2 | Verificación de las correcciones | Un importante: «Cargar otro comprobante» tras un envío exitoso abría el resultado incierto; un menor: envío en vuelo tras cerrar sesión | `ultimoEnvio` y `revision` se anulan tras un éxito; el envío se descarta si cambió la sesión; prueba N06 ampliada con ese recorrido y con «Atrás» |

Hallazgos **no** corregidos por ser inherentes o de bajo riesgo, y documentados: los escáneres de texto son una lista negra de mejor esfuerzo (la barrera real es CSP + red bloqueada + N13b, solo para los flujos recorridos); `--solo` omite verificaciones y lo declara; el modelo del prototipo no implementa el rechazo de pagos desde la web (Dirección), por lo que «el rechazo libera los ítems» solo está cubierto a nivel de unicidad del número de operación.

## Supuestos del prototipo a confirmar en la implementación

Formato del número de operación (letras y números, hasta 30 caracteres), fecha de transferencia sin restricción de futuro, rango de la deuda por ítem aplicado al vencimiento de la factura y facturas con pago registrado sin comprobante ubicadas por vencimiento hasta que exista fecha de transferencia. Ninguno inventa reglas de negocio nuevas: son límites de validación del prototipo.

## Límites

- La emulación de viewport y de agente de usuario en Chromium **no** demuestra ejecución nativa en Android o iOS, TalkBack ni VoiceOver, teclado nativo ni escalado real del sistema.
- Los filtros y las guardas del prototipo ilustran el contrato; **no** equivalen a autorización productiva ni a RLS.
- Sin Supabase, Storage, correo ni pagos reales; sin persistencia; los archivos de comprobante son ejemplos inocuos (solo metadatos).
- CI ejecuta el runner sobre el candidato, pero no regenera las capturas: valida su forma (PNG, 390 px, sin metadatos) y la revisión inspecciona las imágenes.
- Datos bancarios «no configurados»; el escenario simulado no afirma ninguna transferencia.

## Rollback

Revertir el commit de integración (`docs/parte3/EPT-96/`, `scripts/ci/ept96-assets.mjs`, `scripts/ci/impact.mjs`, `scripts/ci/impact.test.mjs`, `.github/workflows/ci.yml`, `docs/ci.md` y este documento). No afecta producto, base de datos ni EPT-95.

## PR, integración y cierre

PR, SHA final, resultados de `CI / gate` y commit de integración se registran en el comentario de cierre de EPT-96 en Jira, que es la fuente del estado posterior a este documento.
