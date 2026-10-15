# EPT-107 — Contrato de consulta de cuotas (HU6)

Documento de diseño y traspaso para la consulta móvil de cuotas. La implementación vive en `supabase/migrations/20261015130000_ept_107_consulta_cuotas.sql` y en `mobile/`.

## 1. Fuente económica

No se agregan tablas ni columnas. La consulta lee las tablas de EPT-100/101/104:

| Dato | Origen |
|---|---|
| Factura emitida (período, vencimiento día 10, total) | `public.facturas` |
| Ítems (cuota, deportes, transporte, comedor) | `public.items_factura` |
| Pagos y su estado (`PENDIENTE_VERIFICACION`, `APROBADO`, `RECHAZADO`) | `public.pagos` |
| Qué ítems cubre cada pago | `public.imputaciones_pago` |

**Composición pendiente vs. factura emitida.** EPT-104 guarda la composición mensual en `app_private.facturacion_composiciones` (sin acceso para roles de aplicación) y recién emite `facturas` e `items_factura` en una única transacción. Por eso `public.facturas` contiene solo facturas emitidas con sus ítems: una composición incompleta no se expone como deuda cobrable.

## 2. Contrato de lectura

Dos vistas `security_invoker = true` (RLS del invocador; ninguna función `SECURITY DEFINER` en la lectura):

### `public.estado_cuotas_alumno` (una fila por factura)

| Columna | Tipo | Significado |
|---|---|---|
| `factura_id`, `alumno_id` | uuid | `alumno_id` es `alumnos.perfil_id` (= `perfiles.id`), no `auth.users.id` |
| `periodo`, `vencimiento` | date | primer día del mes y día 10 |
| `total_centavos`, `pagado_centavos`, `saldo_centavos` | bigint | `NUMERIC(12,2) × 100`, enteros exactos |
| `estado` | text | `PENDIENTE`, `PAGO_PARCIAL`, `PAGADA`, `VENCIDA` |
| `cantidad_items`, `items_en_verificacion` | int | informativos |
| `inconsistente` | boolean | el histórico no cierra; no se oculta ni se normaliza |
| `fecha_corte` | date | fecha de Buenos Aires del servidor |

### `public.detalle_cuotas_items` (una fila por ítem)

`item_id`, `factura_id`, `alumno_id`, `tipo` (`CUOTA`/`DEPORTE`/`TRANSPORTE`/`COMEDOR`), `importe_centavos`, `pagado_centavos`, `estado_pago`.

### Reglas

1. **Saldo.** `saldo = facturas.total − Σ imputaciones activas de pagos APROBADOS`. Los pagos pendientes de verificación y los rechazados no reducen el saldo (EPT-84).
2. **Sin doble conteo.** El importe pagado se agrega primero por ítem y luego por factura; un pago con varias imputaciones aporta cada imputación una vez.
3. **Estado.** Saldo ≤ 0 → `PAGADA`. Con saldo, si `fecha_corte > vencimiento` → `VENCIDA` (prevalece sobre pago parcial). Si no, con algo pagado → `PAGO_PARCIAL`; si no → `PENDIENTE`. El día 10 todavía no está vencida; el 11 sí.
4. **Fecha de corte.** `app_private.fecha_negocio(now())` en `America/Argentina/Buenos_Aires`; el reloj del teléfono no interviene.
5. **Historia.** Los importes son los almacenados en cada ítem; no se recalculan con tarifas actuales ni se agregan intereses o prorrateos.
6. **Moneda.** ARS con dos decimales; el recorrido servidor → dispositivo usa centavos enteros (`Number.isSafeInteger`, máximo `NUMERIC(12,2)` = 999 999 999 999 centavos).

## 3. Acceso

| Actor | Resultado |
|---|---|
| PADRE habilitado | Solo facturas de hijos con vínculo vigente en `padres_hijos` |
| ESTUDIANTE habilitado | Solo las propias |
| DIRECTOR | Todas (web); la app móvil no ofrece esta vista |
| DOCENTE, PERSONAL | Ninguna |
| Cuenta bloqueada | Ninguna (política restrictiva de bloqueo) |
| `anon` | Sin privilegio (42501) |
| Vínculo revocado | Sin acceso en la siguiente lectura |

Las vistas no admiten escritura para ningún rol y solo `authenticated` puede leerlas; `service_role` no recibe privilegios sobre ellas.

## 4. Pantallas móviles

1. **Cuotas** (pestaña dentro de la sesión PADRE/ESTUDIANTE). El padre elige hijo entre los vinculados; el estudiante no ve selector.
2. Pestañas **Pendientes (n)** y **Pagadas (n)**: Pendientes reúne `PENDIENTE`, `PAGO_PARCIAL` y `VENCIDA`.
3. Tarjeta por cuota: período, vencimiento, importe, saldo, estado (texto + glifo + trazo + color) y *Ver detalle*. La vencida agrega borde grueso y la frase «Vencida el dd/mm/aaaa».
4. **Detalle**: encabezado con total, pagado y saldo, y los conceptos con su importe y estado; «Sin cargo» para importes cero.
5. Estados de pantalla: cargando, vacío (sin cuotas / sin vínculos), error con reintento, no disponible (identificador ajeno).

Sin acciones de pago, selección de ítems ni carga de comprobantes (EPT-108/109 fuera de alcance).

## 5. Concurrencia y contexto

Cada respuesta queda atada a (alumno, recarga). Al cambiar de hijo, volver, reanudar la app o cerrar sesión, las lecturas en vuelo se cancelan (`AbortController`) y una respuesta tardía nunca se muestra bajo otro contexto. Al reanudar (`AppState = active`) se revalida.

## 6. Fuera de alcance

Pago, comprobantes, aprobación, generación/cron de facturación, recuperación de contraseña y cualquier pantalla web nueva.
