# EPT-117 · Matriz de cobertura económica y de calendario

Estado de cada criterio sobre la implementación real (`a591e53` + este PR). «Existente» = prueba ya integrada, **reejecutada** localmente sobre el stack descartable `ept117` salvo `CV` (`comprobantes_verificacion.mjs`, solo CI); «Nueva» = caso añadido por EPT-117. Los resultados locales están en [`docs/evidence/EPT-117.md`](../../evidence/EPT-117.md); CI se registra allí por separado.

Archivos: `F` = `supabase/tests/facturacion.mjs`, `RC` = `supabase/tests/recordatorio-calendario.mjs`, `AC` = `aviso-deuda-calendario.mjs`, `FC` = `facturacion-concurrencia.mjs`, `PS` = `pagos_seleccion_rls.sql`, `PC` = `pagos_seleccion_concurrencia.mjs`, `CQ` = `cuotas_consulta_rls.sql`, `CV` = `comprobantes_verificacion.mjs` (+ `_concurrencia`), `DI` = `deuda_items.mjs`, `TL` = `tests/tarifas-lib.spec.ts`.

## A. Composición mensual

| Criterio | Contrato | Cobertura | Archivo / caso | Valor esperado independiente |
|---|---|---|---|---|
| Conceptos y orígenes correctos por ítem | Cada ítem usa la tarifa de su concepto y el origen que le corresponde | **Nueva** (antes parcial: solo conteo y total) | `F` caso 3 (oráculo por ítem) | `CUOTA/matrícula 100.10`, `DEPORTE/insc. A 0.00`, `DEPORTE/insc. B 20.20`, `TRANSPORTE 30.30`, `COMEDOR 40.40`; total `191.00` escrito a mano |
| Servicios y deportes opcionales | Cero o más orígenes por contexto | Existente | `F` casos 5 y 6 | 1 ítem / `200.20`; 2 ítems / `200.20` |
| Tarifa vigente el día 1, límites inclusivos | `desde ≤ período ≤ hasta` | **Nueva** (antes parcial: faltaban los días vecinos) + existente | `F` caso 3 (`hasta = día 1`), `F` caso 8 | `desde = día 2` → bloqueada; `desde = día 1` → emitida `200.20`; `hasta = día anterior` → bloqueada; `hasta = día 1` → emitida `200.20` |
| Histórico conservado tras cambiar el catálogo | Snapshot y ítems inmutables | Existente | `F` casos 2, 4 y 9 (P6840, P6802, P6803) | ítems idénticos tras subir una tarifa |
| Tarifa faltante sin emisión parcial | `bloqueada`, 0 facturas, causas persistidas | Existente | `F` casos 1, 7, 10 | 0 facturas; 5 causas |
| Reintento e idempotencia | Captura única; emisión `existente` | Existente | `F` casos 3 y 4; `FC` carreras 1–6 | misma factura, 23505 ante duplicado |

## B. Importes

| Criterio | Contrato | Cobertura | Archivo / caso | Esperado |
|---|---|---|---|---|
| NUMERIC exacto, dos decimales | Ninguna columna monetaria es `real/double/money`; escala 2 | **Nueva** | `F` caso 13 (catálogo `information_schema`) | `facturas.total`, `items_factura.importe`, `pagos.total_calculado/importe_informado`, `imputaciones_pago.importe`, `tarifas.importe` → `numeric:2` |
| Exceso de precisión rechazado antes del cast | `importe_tarifa_valido` | Existente | `F` caso 10 (P6812); `TL` | `10.005` → P6812 |
| NaN / Infinity | P6810 | Existente | `F` caso 10; `TL` | `NaN`, `Infinity`, `-Infinity` → P6810 |
| Cero y límites | Ítem sin cargo; overflow | Existente | `F` casos 6 y 10 | `9999999999.99` → `TOTAL_FUERA_DE_RANGO`, 0 facturas |
| Centavos reales en pagos | Conversión exacta a centavos | **Nueva** | `F` casos 14–20 | `140.50 → 14050`, `50.50 → 5050`, `191.00 → 19100` |

## C. Selección y pago

| Criterio | Contrato | Cobertura | Archivo / caso | Esperado |
|---|---|---|---|---|
| Ítems del mismo hijo, varias facturas | `cotizar_pago`/`registrar_pago` | Existente | `PS` A4, `CV`, `DI` | total en centavos de la suma |
| Duplicada / ajena / mixta / inválida | P6850, P6851, P6852 | Existente + **Nueva** (duplicada y ajena sobre factura real con centavos) | `PS` A5–A8; `F` caso 15 | `cuota, cuota` → P6850; otra familia → P6851 |
| Total desactualizado | P6857 sin escribir | Existente + **Nueva** | `PS` C1; `F` caso 15 | `14049`, `14051`, `1`, `19100` → P6857; 0 pagos |
| Actores no habilitados | 42501 | Existente + **Nueva** | `PS` G1–G9; `F` casos 15 y 17 | estudiante, director, anónimo → 42501 |
| Atomicidad ante falla intermedia | Todo o nada | Existente | `PS` F1–F3; `CV` (trigger de falla) | sin efectos parciales |
| Reintento sin duplicados | Misma clave → mismo pago | Existente + **Nueva** | `PS` D1–D5; `PC` 22 casos; `F` caso 16 | 1 pago, 2 imputaciones |
| Importe informado no sustituye el total | `total_calculado` manda | Parcial → **Nueva** | `PS` C1/C4; `CV`; `F` caso 17 | informado `140.49`, total `140.50`, saldo restante `5050` |

## D. Saldos

| Criterio | Contrato | Cobertura | Archivo / caso | Esperado |
|---|---|---|---|---|
| Completo, parcial y cero | `estado_cuotas_alumno` | Existente + **Nueva** | `CQ` A5–A6, B3–B5; `F` casos 14, 17, 20 | `19100` → `5050` → `0`; `PENDIENTE` → `PAGO_PARCIAL` → `PAGADA` |
| `EN_VERIFICACION` reserva sin reducir deuda | Solo APROBADO resta | Existente + **Nueva** | `PS` C5–C7; `CQ` B6; `F` caso 16 | saldo `19100` con 2 ítems en verificación |
| `RECHAZADO` libera | Imputación inactiva, ítem `PENDIENTE` | Existente + **Nueva** | `CV`; `CQ` B7; `F` caso 19 | saldo `5050` intacto, comprobante conservado |
| `APROBADO` imputa una vez | Repetición idempotente | Existente + **Nueva** | `CV` + `_concurrencia`; `F` caso 18 | 2 imputaciones activas, suma `140.50` |
| Sin doble conteo por joins | Una fila por ítem | Existente + **Nueva** | `CQ` B8; `DI`; `F` caso 20 | `sum(pagado)=sum(importe)=19100` en 5 filas |
| Conservación | Total = imputaciones activas aprobadas | **Nueva** | `F` caso 20 | `191.00 = 191.00`; el ítem sin cargo no se imputa |
| Mismo universo que las lecturas | Vista por factura = vista por ítem | **Nueva** | `F` caso 20 | misma factura, mismo padre, misma RLS |
| Ciclo parcial con centavos | seleccionar parte → aprobar → saldo exacto → reintento | **Nueva** | `F` casos 14–20 | ver arriba |
| Autorización | Otra familia sin acceso | Existente + **Nueva** | `F` caso 21 | 0 filas; UPDATE directo → 42501 |

## E. Calendario (`app_private.ultimo_habil`, función real)

| Criterio | Cobertura | Archivo / caso | Esperado |
|---|---|---|---|
| Fin de mes hábil, sábado, domingo | Existente | `RC` caso 1 | `2026-09-30`, `2026-10-30`, `2027-01-29` |
| Feriado de fin de mes y consecutivos | Existente | `RC` caso 2 | `2026-09-28` |
| Fin de semana + feriados previos | **Nueva** | `RC` caso 6 | oct. 2026: feriado vie 30 → `2026-10-29`; con el 29 → `2026-10-28`; feriado en sábado 31 y feriado a mitad de mes (15/10) no influyen; los de octubre no se filtran a noviembre (`2026-11-30`) |
| Enero 2027 con feriado **sintético** vie 29 | **Nueva** | `RC` caso 5 | `2027-01-28`; con el 28 también → `2027-01-27` |
| Febrero bisiesto / no bisiesto | Existente | `RC` caso 3; `F` caso 11 | `2024-02-29`, `2028-02-29`, `2027-02-26`, `2028-02-28` con feriado |
| Diciembre → enero | Existente | `RC` caso 4 | `2026-12-31`, `2026-12-29`, `2027-01-29` |
| Frontera America/Argentina/Buenos_Aires | Existente | `RC` caso 8; `F` caso 11; `AC` caso 5 | `02:59:59Z` aún es el día anterior; `03:00Z` cambia de día |
| Nulo y no finito | **Nueva** | `RC` caso 7 | `NULL`, `infinity`, `-infinity` → `P6841` con mensaje `Mes inválido.` (no `NO_RECHAZADA`, no otro código) |
| Un solo calendario | Existente | `RC` caso 9 | 1 función; el plan la invoca |
| Día 20 del aviso no se desplaza por feriados | Existente | `AC` casos 1–6 | el feriado del 20 no mueve el evento; el plan no usa `ultimo_habil` |

## Pendiente real (no cubierto por esta unidad)

| Tema | Motivo |
|---|---|
| Cron, SMTP real, envíos y feriados productivos | EPT-118 y EPT-122; no autorizados aquí |
| Ejecución en teléfono físico, buzón y accesibilidad | verificaciones personales aplazadas |
| `comprobantes_verificacion.mjs` (Next + Storage) | Se ejecuta en CI; no se repitió localmente |
