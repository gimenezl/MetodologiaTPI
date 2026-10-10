# EPT-96 — Matriz de aceptación

Contrato de prueba del prototipo navegable. Se redactó **antes** de implementar y gobierna el runner `node docs/parte3/EPT-96/pruebas/prototipo.mjs`. Cada fila enlaza criterio → recorrido → prueba → evidencia. Las pruebas `N**` se ejecutan en Chromium real contra el servidor local; `U**` son reglas puras sin navegador; `S**` verifican el aislamiento del servidor.

## Criterios de Jira (EPT-96)

| Criterio | Recorrido | Pruebas | Evidencia |
|---|---|---|---|
| **CA1.** Recorrer cuotas, selección/pago y carga de comprobantes antes de programar | R1 Padre completo · R2 Dos hijos · R7 Estados · R8 Incertidumbre | N01, N02, N03, N04, N05, N06, N12, N15, U01–U06 | `evidencia/N01-*.png` … `N06-*.png`, `N12-*.png`, `N15-*.png`; salida del runner en `docs/evidence/EPT-96.md` |
| **CA2.** Conserva navegación por rol | R3 Estudiante · R4 Canal web · R5 Accesos especiales | N07, N08, N09, N10, N16, U08 | `evidencia/N07-*.png` … `N10-*.png`, `N16-*.png` |

## Requisitos de la misión

| Requisito | Recorrido | Pruebas | Evidencia |
|---|---|---|---|
| Volver, cancelar, cambiar hijo y reiniciar limpian el contexto incompatible | R6 | N11 | `evidencia/N11-*.png` |
| Dos hijos sin mezclar importes ni registros | R2 | N02, U03 | `evidencia/N02-*.png` |
| Selección: solo ítems pendientes, ítems completos, mismo hijo | R1 | N03, U03 | `evidencia/N03-*.png` |
| Banco no configurado bloquea la acción operativa; el escenario simulado es inequívoco | R1 | N04 | `evidencia/N04-*.png` |
| Registrar un pago o adjuntar un comprobante no aprueba ni reduce saldo | R1 | N05, U04 | `evidencia/N05-*.png` |
| Importe informado distinto del total se acepta como dato de conciliación | R1 | N05, U05 | `evidencia/N05-*.png` |
| Número de operación único entre pagos no rechazados | R1 | N05, U05 | `evidencia/N05-*.png` |
| Tipo y tamaño de archivo (JPG, PNG, PDF; 5 MB por archivo) | R1 | N05, U06 | `evidencia/N05-*.png` |
| Resultado incierto: releer el estado antes de reintentar, sin duplicar | R8 | N06 | `evidencia/N06-*.png` |
| Estudiante sin selector, pago, selección, carga ni original, incluso por navegación directa | R3 | N07, N08, U08 | `evidencia/N07-*.png`, `N08-*.png` |
| Otro padre vinculado ve el registro pero no el original | R3 | N16, U08 | `evidencia/N16-*.png` |
| Directora, docente y personal: orientación al canal web sin datos económicos | R4 | N09 | `evidencia/N09-*.png` |
| Cuenta bloqueada, sesión expirada, sin vínculo, credenciales inválidas y validaciones | R5 | N10 | `evidencia/N10-*.png` |
| Carga, vacío, error y reintento | R7 | N12 | `evidencia/N12-*.png` |
| Sumas, conceptos, períodos, hijos y saldos coherentes entre pantallas | R1, R2 | N15, U01, U02, U07 | `evidencia/N15-*.png` |
| Recursos, enlaces, consola sin errores y cero solicitudes externas | todos | N13 | salida del runner |
| Foco, teclado, contraste, objetivos táctiles, sin scroll horizontal a 320/360/390 px y texto ampliado | todos | N14 | salida del runner, `evidencia/N14-*.png` |
| El servidor sirve solo archivos permitidos, sin traversal ni acceso a `.env` | — | S01–S07 | salida del runner |

## Recorridos

| ID | Actor | Camino |
|---|---|---|
| R1 | PADRE | Ingreso simulado → selector → cuotas → detalle de factura → selección de ítems → registro de pago → comprobantes → confirmación |
| R2 | PADRE (dos hijos) | Selección en un hijo, cambio de hijo, importes y registros separados |
| R3 | ESTUDIANTE / otro padre | Cuotas, detalle, período, deuda e inscripciones propias; sin acciones de pago |
| R4 | DIRECTOR · DOCENTE · PERSONAL | Ingreso → orientación al canal web |
| R5 | Cuentas especiales | Credenciales inválidas, validación, cuenta bloqueada, sesión expirada, sin vínculos |
| R6 | PADRE | Volver, cancelar, cambiar hijo, reiniciar |
| R7 | PADRE | Carga, vacío, error de conexión, reintento |
| R8 | PADRE | Envío con resultado incierto, «Revisar estado», reintento solo si no figura recibido |

## Pruebas

| ID | Qué demuestra | Tipo |
|---|---|---|
| U01 | Importes en centavos; formato ARS con dos decimales; cifras aprobadas (102.496,60 · 63.606,65 · 82.532,10 · 41.266,05) | puras |
| U02 | Estados de factura con referencia 09/10/2026; Vencida prevalece sobre Pago parcial | puras |
| U03 | Selección: solo pendientes, solo del mismo hijo, total calculado por el sistema | puras |
| U04 | Registrar pago deja ítems «en verificación» y no cambia saldo ni estado | puras |
| U05 | Número de operación único entre no rechazados; importe distinto aceptado | puras |
| U06 | Validación de archivo: JPG/PNG/PDF y 5 MB | puras |
| U07 | Período con extremos inclusive; facturas sin pagos por vencimiento | puras |
| U08 | Matriz de permisos por rol, vínculo y cargador | puras |
| S01–S07 | Lista cerrada de rutas, traversal codificado y doble codificación, `.env`, métodos, `Host`, cabeceras, sin listado de directorios | servidor |
| N01–N16 | Recorridos en navegador real | Playwright/Chromium |

## Límites declarados de antemano

- La emulación de viewport y de agente de usuario de Chromium **no** demuestra ejecución nativa en Android o iOS, TalkBack ni VoiceOver.
- Los filtros del prototipo ilustran el contrato; **no** equivalen a autorización productiva ni a RLS.
- Datos ficticios; sin Supabase, Storage, correo ni pagos reales; sin persistencia entre recargas.
