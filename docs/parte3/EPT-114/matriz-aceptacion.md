# EPT-114: matriz de aceptación

Los nombres de prueba refieren a afirmaciones ejecutables de `supabase/tests/deuda_items_rls.sql` (SQL, actores simulados con `SET ROLE` + JWT, **«SQL»**), `supabase/tests/deuda_items.mjs` (Auth, PostgREST y concurrencia reales, **«MJS»**), las pruebas Jest de `mobile/__tests__/` (**«JEST»**) y el escenario `mobile/maestro/deuda.yaml` con la etapa `mobile/scripts/integracion-deuda.mjs` (**«ANDROID»**). No son aprobaciones humanas.

## Criterios de la historia EPT-114

| Criterio de HU13 | Cómo se cumple | Prueba y evidencia |
|---|---|---|
| Por cada ítem: período, importe, pagado y saldo | Fila por ítem con `periodo`, `importe_centavos`, `pagado_centavos`, `saldo_centavos` | SQL B1–B11 (importes a mano), MJS «Pagado, parcialmente pendiente…», JEST «padre: al abrir…», ANDROID `deuda.yaml` |
| El total adeudado es la suma de los saldos | `totales.adeudado_centavos` del conjunto filtrado completo, agregado en `NUMERIC` | SQL B1 (302.000 − 158.000 = 144.000), E1 (9.100 ítems, 9.099.999.999.990.900 centavos), MJS «El total adeudado es la suma exacta…», JEST «un total que supera la precisión segura…» |
| Los ítems pagados parcialmente se muestran con su saldo pendiente | Refinado por EPT-84: «pago parcial» = factura con ítems pagados y pendientes; cada ítem pendiente muestra su saldo completo | Contrato (refinamiento del criterio 3); MJS «La factura 603 con un ítem pagado y otro pendiente…»; SQL G3 (imputación parcial declarada, no corregida) |
| Se puede filtrar por período | `p_desde/p_hasta` por mes de factura, extremos inclusivos | SQL D1–D8, JEST «filtro: valida fechas reales…», ANDROID filtro abril = ARS 69.000,00 |
| La deuda coincide con el reporte de pagos incompletos de la web | Contraste con RF19 y EPT-107 sobre el mismo universo | MJS (EPT-157): conjuntos completos, saldo por factura única, diferencias legítimas documentadas |

## EPT-153 — consulta de deuda por ítem y por período

| Requisito | Servidor / base | Prueba |
|---|---|---|
| Cálculo pagado/saldo/estado por ítem | Imputaciones activas de pagos aprobados, una vez por ítem | SQL B2–B9: pagado, en verificación (no reduce), rechazado (mantiene), informado ≠ imputado, ítem cero |
| Agrupación por cuota, cada deporte, cada recorrido y comedor | `grupo` = `CUOTA`, `DEPORTE:<id>`, `TRANSPORTE:<id>`, `COMEDOR` | SQL B3–B4 (seis agrupaciones, Fútbol y Natación por separado) |
| Etiquetas históricas | Ítem → inscripción → catálogo; cancelada/inactiva conservadas | SQL C1–C3; MJS «El recorrido facturado… no se reemplaza…» |
| Sin tarifas actuales | Importe almacenado en el ítem | SQL C4 (tarifa cambiada, deuda intacta) |
| Permisos | Guarda `alumno_economico_visible` antes de leer datos | SQL A1–A13; MJS (JWT reales, vínculo revocado, bloqueo con JWT vigente); `usuarios_permisos_rls.sql` (RPC registrada, 5.746 evaluaciones) |
| ACL y superficie | `EXECUTE` solo a `authenticated`; INVOKER/DEFINER, `search_path` vacío | SQL H2–H4 |
| Solo lectura | `STABLE`, sin DML | SQL H1 (huella de pagos, ítems, imputaciones y facturas idéntica antes/después), MJS «Leer la deuda… no modifica…» |

## EPT-154 — servicio de consulta móvil

| Requisito | Implementación | Prueba |
|---|---|---|
| Validación exacta | `bigint`; rechaza decimales, `-0`, ceros a la izquierda, notación científica; cifras que cierran | JEST `deuda-items.test.ts` (37 casos) |
| Contrato real | El analizador de producción valida la respuesta de Auth/RLS/RPC reales | `deuda-rpc-real.test.ts` ejecutado por la etapa `integracion-deuda.mjs` |
| Errores y sesión | `P6870/P6871/22008 → rango`, `42501/PGRST301 → permiso`, resto → red | JEST «clasifica el error…» |
| Sin fechas nulas en la llamada | Solo envía lo que se pidió | JEST «sin rango ni huella…» |
| Paginación | Página + huella; señal de actualización | JEST (`actualizado`, página incompleta, repetidos); MJS (120 ítems, 5 páginas; cambio entre páginas) |
| Sin Next/DOM/service_role en el dispositivo | Solo el cliente Supabase con la sesión del usuario | `npm run verificar:importaciones` |

## EPT-155 — pantalla agrupada con total adeudado

| Requisito | Implementación | Prueba |
|---|---|---|
| Agrupación y subtotales | Una sección por agrupación con su subtotal global | JEST «padre: al abrir…»; ANDROID (Fútbol, Recorrido Sur, Comedor escolar) |
| Total global, no de la página | `totales` del servidor, «Mostrando X de Y» | JEST «Mostrar más ítems…», «un total que supera…» |
| Estados | Cargando, vacío, sin vínculos, error con reintento, permiso, rango rechazado | JEST «estados: sin ítems, error con reintento…», «sin vínculos» |
| Ítems pagados con saldo cero; sin cargo | Se conservan en el historial; «Sin cargo» sin transferencia ni deuda | JEST «ítems especiales», SQL B9 |
| Solo consulta | Sin botones de pagar, cargar, cancelar, aprobar | JEST (`queryByRole` de acciones de escritura) |
| Contexto y respuestas tardías | Clave (hijo, filtro, intento, recarga); `AbortController` | JEST: hijo distinto, página tardía tras cambiar de hijo, reanudar la app, vínculo revocado, remontaje con contexto elevado |
| Navegación | Pestaña «Deuda por ítem» dentro del área accesible, con flecha y gesto de volver | JEST (`acceso-navegacion`, `pantalla-con-volver` sin cambios), ANDROID |

## EPT-156 — filtro por rango de fechas

| Requisito | Prueba |
|---|---|
| Fechas reales, formato, orden, un solo extremo | JEST «filtro: valida fechas reales…»; SQL D6 |
| Extremos inclusivos por mes, un día, cambio de año | SQL D1–D2 (15/12 incluye diciembre; 02/01 incluye enero; 31/12–01/01) |
| Período de factura, no transferencia ni vencimiento | SQL D3 (pago de marzo cubre la cuota de febrero: saldo vigente); rotulado en pantalla; contrato |
| Facturas sin ningún aprobado incluidas | SQL D4; MJS RF19 |
| Rango sin facturas | SQL D5; JEST «No hay ítems en este período» |
| «Ver todo el historial» | JEST «Ver todo el historial…» |
| Servidor informa el mes aplicado | SQL D7; JEST «rechaza una respuesta cuyo período aplicado no corresponde» |

## EPT-157 — consistencia con los reportes de la web

| Requisito del encargo | Prueba (MJS) |
|---|---|
| 1. Mismos alumnos y universo de facturas | Universo {603, 604, 605, 606, 611}: RF19 = EPT-107 = RPC móvil |
| 2. Corte de lectura compatible | Ambas leen con la fecha de corte de Buenos Aires del servidor; saldo vigente en las tres |
| 3. Conjuntos completos de IDs antes de sumar | `igualesConjuntos` sobre todas las páginas de RF19 y de la RPC |
| 4. Saldo de ítems agregado por factura única | `facturasConSaldo`; aserción de que sumar relaciones duplicaría la 611 |
| 5. Igualdad con EPT-107 y con `saldo_facturas_centavos` de RF19 | 38.000 centavos en ambas; saldo por factura igual a `estado_cuotas_alumno` en las 11 facturas (también SQL G1–G2) |
| 6. Facturas sin ningún aprobado | 604, 605, 606 por vencimiento en RF19 y completas en la móvil |
| 7. Pagos fuera del intervalo | Marzo y enero: diferencias legítimas; la factura 601 de enero figura pagada |
| 8. Factura con varias relaciones | 611 con dos pagos aprobados: dos filas en RF19, una deuda de ARS 40,00 |
| Subconjuntos definidos y diferencias legítimas | Abril–junio y noviembre coinciden; marzo y enero difieren y se explican |
| Oráculo independiente | Constantes calculadas a mano sobre el fixture de EPT-112; no se reutiliza el ayudante |

## Concurrencia y consistencia

| Escenario | Prueba |
|---|---|
| Aprobación/rechazo mientras se consulta | MJS: cuatro lectores y un escritor sobre una conexión `psql` propia; ambos estados observados y cada documento coherente en sí mismo (filas = subtotales = total); SQL F1–F3 |
| Cambio entre páginas | MJS y SQL F1: huella distinta → solo señal de actualización; JEST: la app recarga desde la primera página |
| Vínculo revocado o cuenta bloqueada antes de la lectura | SQL A10–A13; MJS (JWT vigente) |
| Historial grande | SQL E1–E5 (9.100 ítems; 183 páginas de 50 y 92 de 100; mismo orden que el calculado desde las tablas; filtro anual de 12 ítems); MJS (120 ítems, 5 páginas) |

## Regresiones

| Área | Verificación |
|---|---|
| Recibos, cuotas, consultas, navegación | Suite Jest móvil completa (36 suites); flujos Maestro existentes intactos en `ejecutar-android.sh` |
| Reportes web | RF19 no se tocó; `reportes_economicos.mjs` y `reportes_economicos_rls.sql` sin cambios |
| Selector de CI | `scripts/ci/suites.mjs` registra la suite SQL y el script de contrato real; las rutas móviles nuevas ya tienen patrón en `mobile.mjs`; `impact.test.mjs` sin regresiones nuevas |
| Tipos | `tipos-generados.mjs` (verificación) y `compartido:check` sin deriva |

Teléfono real, recuperación por correo y retorno nativo, TalkBack/VoiceOver, texto ampliado y accesibilidad física permanecen aplazados por el usuario. No forman evidencia realizada; no se aplazan automatización, seguridad ni CI.
