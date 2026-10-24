# EPT-116: contrato del aviso de deuda del día 20 (RF16)

Fuentes: Parte 3 (RF16, RNF6), decisiones EPT-85 (comentario 10311) y EPT-86 (comentario 10312), actualización de EPT-116 (comentario 10329) y contratos de EPT-107, EPT-114 y EPT-115. Este documento fija lo que el código promete y lo que no.

## Qué hace

El día 20 de cada mes (fecha civil de `America/Argentina/Buenos_Aires`) el sistema envía **un correo por padre** con el detalle de la deuda pendiente de sus hijos autorizados. No envía con saldo cero. No adjunta PDF (RF16 exige el detalle de deuda, no documentos).

## Evento, primer envío y reintentos

| Concepto | Regla |
|---|---|
| Identidad | `(padre_id, tipo = AVISO_DEUDA, fecha_programada = día 20 original)`. Un reintento del 21, 25 o 31 conserva esa identidad y no crea filas. El mes siguiente es otro evento. |
| Primer evento | Solo cuando la fecha civil es el día 20, aunque sea sábado, domingo o feriado. **No** usa `ultimo_habil` ni la tabla `feriados`. No hay catch-up: si nadie ejecuta el día 20, el evento no nace. |
| Reintento tras fallo claro | Una vez por día (`ultimo_intento_fecha < hoy`) hasta el **último día del mismo mes inclusive** (`periodo + 1 mes − 1 día`). El día 1 del mes siguiente el evento vencido no se retoma. No hereda el límite del día 10 del recordatorio. |
| Resultado SMTP incierto | Sin reintento automático. Queda `INCIERTO` y consultable por Dirección. Un cambio posterior de saldo no lo reabre. |
| Estados terminales | `ENVIADO` e `INCIERTO` nunca vuelven a `PENDIENTE`. |
| Separación | El plan, las reservas y los barridos del aviso filtran `tipo = 'AVISO_DEUDA'`; los del recordatorio, `RECORDATORIO_MENSUAL`. Compuertas independientes (`app_private.aviso_deuda_config`, `EPT_AVISO_DEUDA_HABILITADO`). |

## Deuda: universo, fecha de corte y aritmética

Fuente única: `app_private.aviso_deuda_composicion(padre)`, una sola consulta SQL (una instantánea) de la que salen el detalle y el total del mismo correo.

- **Saldo del ítem** = importe histórico − Σ imputaciones **activas** de pagos **APROBADOS** (agregado una vez por ítem, antes de unir catálogos: no se multiplica por pagos, archivos, vínculos ni horarios).
- `EN_VERIFICACION` **conserva** su deuda. Se informa aparte («comprobante en verificación») para no inducir un pago duplicado, y entra en el total.
- `RECHAZADO` e imputaciones inactivas no reducen saldo. `importe_informado` nunca cancela deuda. No se recalcula con tarifas actuales ni se usa la existencia de un recibo.
- **Universo**: facturas de **todos los períodos** de los hijos con alumno `ACTIVO` vinculados al padre (`padres_hijos`; no hay vencimiento del vínculo: existir es estar vigente) cuyo saldo neto (Σ saldos de sus ítems) es > 0, con o sin pagos. Dentro de ellas, las líneas son los ítems con saldo > 0 (los de importe 0 no figuran). No hay filtros «solo mes actual» ni «solo vencidas».
- **Fecha de corte**: la fecha civil argentina del intento (`corte_fecha`), que consta en el correo, en `envios_correo.corte_fecha` y en la historia por intento. No se confunde con el período de la factura ni con la fecha de transferencia.
- **Aritmética**: `NUMERIC(12,2)` en PostgreSQL; importes como texto; sumas de verificación con `BigInt` de centavos en el servidor. Si los subtotales de una factura o de un hijo, o el total, no coinciden con los ítems, el correo no se arma (`FALLIDO`).
- **Inconsistencias** (suma de ítems ≠ total de la factura, pagado > total, ítem parcialmente pagado) no se corrigen ni se ocultan: el intento queda `FALLIDO` con el motivo, visible para Dirección, y se reintenta por la regla diaria.

## Revalidación en cada intento y corte de lectura

`aviso_deuda_datos` corre bajo la reserva vigente del intento y reconsulta cuenta (`PADRE`, `HABILITADO`), vínculos, alumnos activos y saldos. Cuerpo y total salen de ese mismo conjunto.

| Situación al reintentar | Resultado |
|---|---|
| Pagó todo (o ya no hay hijos autorizados) | **Omisión**: no se envía, el estado queda `FALLIDO` con `omitido_motivo` (nunca `ENVIADO`), `ultimo_error` anterior se conserva y la historia registra `FALLIDO` → `OMITIDO`. La fila deja de ser candidata. |
| Pagó una parte | El correo refleja la deuda restante real y la fecha de corte del reintento. |
| Vínculo revocado | La información de ese hijo no se envía. |
| Cuenta bloqueada o sin rol PADRE | `FALLIDO` («no está habilitada»), sin correo. |

**Frontera de despacho.** Entre la lectura (`datos`) y la marca de frontera (`frontera`) no se mantiene ninguna transacción abierta ni bloqueo sobre perfiles. Un pago aprobado **después** de la lectura no cancela un correo cuya frontera se cruce a continuación; una vez cruzada la frontera SMTP no se promete cancelar (un correo enviado no puede deshacerse). La composición ya enviada consta en el correo y en `total_adeudado`.

## Reserva, frontera y máquina de estados

Idéntica a EPT-115 (reserva por token con vencimiento, frontera persistida antes del posible despacho, confirmación solo por el propietario vigente, consulta de estado ante respuesta perdida), con un estado final más para el cierre sin envío:

```
PENDIENTE --reservar--> PENDIENTE(token, reserva_hasta)
PENDIENTE(token) --frontera--> PENDIENTE(token, frontera_smtp_en)
PENDIENTE(token) --resultado--> ENVIADO | FALLIDO | INCIERTO
PENDIENTE(token, sin frontera) --omitir--> FALLIDO + omitido_motivo
PENDIENTE(frontera, reserva vencida) --barrido--> INCIERTO
PENDIENTE(sin frontera, ventana vencida) --barrido--> FALLIDO
FALLIDO(ultimo_intento_fecha < hoy, sin omitido_motivo, hoy <= fin de mes) --reservar--> PENDIENTE
```

`UNIQUE (padre_id, tipo, fecha_programada)` no sustituye el control del despacho: lo hacen el token y la frontera. Nada garantiza exactly-once entre PostgreSQL y SMTP; ante incertidumbre se prioriza no duplicar. La aceptación SMTP no prueba entrega final ni lectura del buzón.

## Clasificación SMTP

Reutiliza `enviarCorreoEstructurado` (EPT-115) sin cambios: la fase se observa con un registrador propio (¿el cliente envió `DATA`?) y no se clasifica por `error.command`/`CONN` aislado. Error demostrado antes de la posible aceptación o rechazo SMTP explícito → fallo claro (`FALLIDO`); corte o plazo tras la posible aceptación → `INCIERTO`; aceptación confirmada → `ENVIADO` tras persistir. Si se pierde la respuesta de confirmación, se consulta el estado antes de repetir.

## Seguridad, permisos y privacidad

- Endpoint `GET /api/cron/aviso-deuda`: `Authorization: Bearer CRON_SECRET` (comparación en tiempo constante), sin parámetros (400), otros métodos 405, respuesta sin PII ni secretos (solo conteos). Fecha, destinatario, importe y rol no provienen de la petición.
- Compuertas **apagadas por defecto**: variable `EPT_AVISO_DEUDA_HABILITADO` y `app_private.aviso_deuda_config.habilitada = FALSE`. Con cualquiera apagada no hay SMTP ni efectos de envío.
- Siete RPC `aviso_deuda_*_job`: `EXECUTE` solo para `service_role`; `anon`/`authenticated` reciben 401/403. Auxiliares `SECURITY DEFINER` en `app_private` con `search_path = ''`. `service_role` no tiene DML sobre `envios_correo` ni sobre `envios_correo_intentos`.
- `envios_correo_intentos` (historia por intento): RLS, lectura solo `DIRECTOR`, política restrictiva de bloqueo. PADRE/ESTUDIANTE no ven errores ni filas de otras familias.
- Un correo por padre; destinatario único tomado de Auth; sin CC/BCC; nombres y conceptos escapados en HTML; texto alternativo legible. Dos padres vinculados al mismo hijo reciben cada uno su aviso.

## Activación y rollback

La migración **no está aplicada en producción** y no hay agenda: no se agrega ninguna entrada a `vercel.json`. La activación remota (agenda, SMTP real, carga de feriados, compuertas) pertenece a EPT-122 y requiere autorización aparte. Rollback: dejar apagadas las compuertas o quitar la agenda; la auditoría, las identidades y los estados se conservan; no se borra ni se reabre ningún `ENVIADO`/`INCIERTO`, y un correo enviado no se deshace.

## Fuera de alcance

Política de alta de vínculos (EPT-164), PDF/recibos/originales de transferencia, desplazamiento por último hábil, catch-up de primeros envíos tardíos, activación productiva.
