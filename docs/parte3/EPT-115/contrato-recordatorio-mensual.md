# EPT-115: contrato del recordatorio mensual por correo

Historia [EPT-115](https://grupo12-utn.atlassian.net/browse/EPT-115) (P3-HU15, RF15 y RNF6) y subtareas EPT-158 a EPT-163. Fuente funcional: `PlanTrabajoMetGrupo12-Parte3.pdf`, comentarios de decisión EPT-85 (10311), EPT-83 (10309) y EPT-115 (10328). Este contrato es el único lugar donde se fija la política; la [matriz](./matriz-aceptacion.md) lo traza a las pruebas y la [evidencia](../../evidence/EPT-115.md) registra su ejecución.

## Reglas aprobadas

| # | Regla | Dónde se cumple |
|---|---|---|
| 1 | Zona horaria `America/Argentina/Buenos_Aires` | `app_private.recordatorio_fecha_civil`, `recordatorio_hoy` |
| 2 | Feriados nacionales en `public.feriados` | `app_private.ultimo_habil` (EPT-104), sin segundo calendario |
| 3 | **Primer envío** el último día hábil de cada mes | `recordatorio_plan` programa filas solo si `hoy = ultimo_habil(mes)` |
| 4 | Un correo por padre y evento, con todos sus hijos | `UNIQUE (padre_id, tipo, fecha_programada)` + `recordatorio_datos` |
| 5 | Un PDF de **factura** por hijo | `src/services/factura-pdf.ts` |
| 6 | Facturas del **mes siguiente** (M+1) | `envios_correo.periodo = M+1`; las emite EPT-104 antes del último hábil de M |
| 7 | Vencimiento el día 10 | `facturas.vencimiento = periodo + 9` |
| 8 | Fallo claro: reintento diario hasta el día 10 **inclusive** | `ultimo_intento_fecha < hoy` y `hoy <= periodo + 9` |
| 9 | Resultado SMTP incierto: **sin reintento automático**, marca para Dirección | estado `INCIERTO`, sin transición de salida |

### Refinamiento: primer envío frente a reintentos

El criterio de aceptación «la tarea solo envía correos el último día hábil del mes» se cumple para el **primer envío**: una fila del evento solo nace ese día. No prohíbe los reintentos ya aprobados (regla 8): una fila `PENDIENTE` o `FALLIDA` del evento se retoma los días siguientes con la **misma identidad**. Un padre no programado el último hábil (tarea caída, cuenta creada después) no recibe un primer envío tardío.

## Identidad del evento

`(padre_id, 'RECORDATORIO_MENSUAL', fecha_programada)` con `fecha_programada` = último día hábil de M, **inmutable**. Un reintento nunca cambia esa fecha: cambiarla crearía otra identidad y un duplicado. `periodo` (primer día de M+1) y `ultimo_intento_fecha` son columnas aparte. Las filas de otros tipos (`AVISO_DEUDA`, EPT-116) no se ven afectadas: el plan filtra por tipo y por `periodo IS NOT NULL`.

## Máquina de estados y frontera SMTP

```
PENDIENTE ──reservar──▶ PENDIENTE (token, reserva_hasta)
PENDIENTE (token) ──frontera──▶ PENDIENTE (token, frontera_smtp_en)   ← posible aceptación SMTP desde aquí
PENDIENTE (token) ──resultado──▶ ENVIADO | FALLIDO | INCIERTO
PENDIENTE (frontera, reserva vencida) ──barrido──▶ INCIERTO
PENDIENTE (sin frontera, reserva vencida) ──reservar──▶ PENDIENTE (token nuevo)
PENDIENTE (sin frontera, hoy > día 10) ──barrido──▶ FALLIDO (venció el plazo)
FALLIDO (último intento < hoy, hoy ≤ día 10) ──reservar──▶ PENDIENTE
```

1. **Preparación (antes de SMTP).** `reservar` (fila bloqueada `FOR UPDATE`, token nuevo, reserva de 120 s, `intentos + 1`), `datos` (revalida cuenta, rol, vínculos y facturas) y generación de PDF. Cualquier impedimento termina en `FALLIDO` con motivo acotado; no sale nada. Un error transitorio de Auth al leer el correo no consume el intento (la reserva vence y se retoma). El destinatario debe ser **una única dirección** (sin comas, punto y coma ni espacios) y los adjuntos no pueden superar 15 MB.
2. **Cruce de la frontera.** `frontera` persiste `frontera_smtp_en` y extiende la reserva. Si esa marca no se confirma, **no se envía**.
3. **Resultado.** `resultado` solo lo acepta quien posee el token vigente. `ENVIADO` e `INCIERTO` exigen frontera cruzada (`CHECK` para `ENVIADO`).
4. **Persistencia.** Si la confirmación se pierde, el job **lee el estado antes de repetir**: un `ENVIADO` ya confirmado nunca se degrada a `INCIERTO`. Si ni la lectura responde, no se repite a ciegas; la reserva vence y el barrido deja `INCIERTO` (la aceptación pudo ocurrir).

Un intento viejo (token rotado o fila ya resuelta) recibe `false` y no libera ni confirma el trabajo de otro. Una caída tras la frontera nunca habilita reenvío automático. **No se promete exactly-once entre PostgreSQL y SMTP**: ante incertidumbre se prioriza no duplicar, a costa de un posible no-envío que Dirección revisa.

### Clasificación de errores SMTP

Nodemailer rotula `CONN` cualquier corte o plazo vencido, aun en medio de `DATA`; el comando del error **no** sirve para saber si el mensaje pudo salir. La fase se observa aparte (el cliente llegó a enviar `DATA`):

| Situación | Resultado |
|---|---|
| Error antes de `DATA` (conexión, saludo, STARTTLS, autenticación, `MAIL FROM`, `RCPT TO`) | `FALLO_CLARO` → `FALLIDO` |
| Error con código 4xx/5xx del servidor desde `DATA` (rechazo explícito) | `FALLO_CLARO` → `FALLIDO` |
| Corte, plazo vencido o error sin rechazo explícito desde `DATA` | `INCIERTO` |
| Sin excepción y `info.accepted` con al menos un destinatario | `ACEPTADO` → `ENVIADO` (después de `DATA` nunca es fallo claro) |
| Tope total de 20 s vencido: antes / después de iniciar `DATA` | `FALLO_CLARO` / `INCIERTO` |

«Aceptado» significa que el servidor SMTP tomó el mensaje; **no** acredita entrega al buzón ni lectura. La prueba lo demostró: con la respuesta cortada tras `DATA`, Mailpit conservó el mensaje y la fila quedó `INCIERTO`.

## Composición del correo y de la factura

- Cuerpo y adjuntos salen del mismo conjunto de facturas: `recordatorio_datos` calcula todo en PostgreSQL con `NUMERIC` y lo registra en `envios_correo_facturas` (la auditoría coincide con lo enviado); el servidor valida con centavos enteros (`BigInt`) que totales, duplicados y período coincidan antes de enviar.
- Si falta una factura de un hijo vinculado activo, o un total no coincide con sus ítems, **no se envía un mensaje aparentemente completo**: `FALLIDO` con el motivo. El recordatorio no genera facturas, tarifas ni importes (no activa EPT-104).
- Se distinguen **total facturado** (no cambia), **ya abonado**, **en verificación** y **saldo por abonar** (ítems `PENDIENTE`).
- El PDF es una **factura institucional informativa**, no un recibo ni un comprobante fiscal: no exige un pago aprobado, no adjunta comprobantes de transferencia y no inventa numeración fiscal. Identifica la factura con su UUID.
- Dos padres vinculados al mismo hijo reciben cada uno su correo; no se deduplica por hijo ni se mezclan familias.

## Autorización y privacidad

- El job usa `service_role` de servidor (como EPT-104); nunca expone la clave al cliente ni sustituye la autorización de un padre. Identidad, correo (`auth.admin.getUserById`) y vínculos salen de fuentes confiables, no de la petición.
- Las seis RPC `recordatorio_*_job` son solo de `service_role`, que además **no tiene DML directo** sobre `envios_correo` (se le revoca en esta migración): una fila `ENVIADO`/`INCIERTO` no vuelve a `PENDIENTE` fuera de la máquina de estados; `anon`, `authenticated` (incluida Dirección) reciben 401/403. `recordatorio_config` y `recordatorio_reloj` no están en la API.
- `envios_correo` y `envios_correo_facturas` (con `ultimo_error`, `frontera_smtp_en`, token) las lee solo DIRECTOR por RLS; la segunda tiene además la política restrictiva de bloqueo de cuentas. PADRE y ESTUDIANTE no ven nada.
- Las respuestas del cron solo cuentan; no incluyen correos, nombres ni errores. Los logs no contienen secreto, `service_role` ni destinatarios. La causa de un fallo se reduce a clase, código y comando.

## Cron protegido y activación separada

`GET /api/cron/recordatorio-mensual` exige `Authorization: Bearer CRON_SECRET` (comparación en tiempo constante), rechaza parámetros (400) y métodos distintos de GET (405), y no concede ejecución a usuarios con sesión. Tiene **dos compuertas independientes, ambas apagadas por defecto**, y la agenda no existe en el repositorio:

1. `EPT_RECORDATORIO_HABILITADO=habilitado` (entorno de la aplicación).
2. `app_private.recordatorio_config.habilitada = true` (base de datos).
Sin agenda (no hay `vercel.json`; ver el runbook) nadie invoca el endpoint, y con cualquiera de las dos apagada, el endpoint no produce efectos: con la de entorno apagada ni siquiera consulta la base ni SMTP. El reloj es el de PostgreSQL; `recordatorio_reloj` (fecha simulada) solo puede escribirla el propietario de la base en un entorno de pruebas y producción no tiene esa fila.

**Presupuesto del lote.** Ruta con `maxDuration = 60 s`. No se inicia otro padre pasados 15 s ni más de 100 por ejecución. Peor caso por padre: hasta cuatro llamadas a Supabase/Auth de 5 s, la generación de PDF y un envío con **tope total de 20 s** (el plazo de inactividad del socket no acota el total). Si el tope vence después de iniciar `DATA` el resultado es `INCIERTO`; antes, fallo claro. Medido en Mailpit local: ≈ 0,3 s por padre (3 padres en 0,8 s), es decir, unos 50 padres por ejecución. Con una agenda de una ejecución diaria, un lote mayor continúa al día siguiente (sigue `PENDIENTE`, dentro de la ventana hasta el día 10); para el día del evento conviene una agenda más frecuente (ver runbook).

## Runbook de activación (posterior, requiere autorización específica de EPT-122)

Esta unidad **no activa nada**. Para activar, con autorización explícita y en este orden:

1. Aplicar la migración `20261026120000_ept_115_recordatorio_mensual.sql` (forward) tras verificar el ledger de producción (45 aplicadas antes de esta).
2. Cargar `public.feriados` con los feriados nacionales (sin ellos solo se consideran fines de semana) y comprobar `SELECT app_private.ultimo_habil(date_trunc('month', now()))`.
3. Configurar SMTP real del remitente de la escuela (`EPT_SMTP_*`; mismo servicio que la vinculación de cuentas) y probar con una cuenta propia.
4. Confirmar que EPT-104 emitió las facturas del mes siguiente antes del último hábil.
5. Definir `CRON_SECRET` y `EPT_RECORDATORIO_HABILITADO=habilitado` en el entorno, y recién entonces `UPDATE app_private.recordatorio_config SET habilitada = true`.
6. Agregar la agenda. Ejemplo **inerte** (no está en el repositorio; copiar a `vercel.json` solo al activar). `0 12 * * *` (UTC) es una ejecución diaria a las 09:00 de Argentina:

   ```json
   { "crons": [{ "path": "/api/cron/recordatorio-mensual", "schedule": "0 12 * * *" }] }
   ```

7. Para el scheduler local de desarrollo: `EPT_RECORDATORIO_LOCAL_SCHEDULER=habilitado CRON_SECRET=… node scripts/recordatorio-local.mjs` (solo HTTP de bucle local, ruta fija, 06:00 de Argentina).

**Rollback:** poner `habilitada = false` y/o quitar la variable de entorno y la agenda. Se **conservan** auditoría, estados, identidades e inciertos. Un correo enviado no se puede deshacer. No borrar registros `ENVIADO`/`INCIERTO` ni reiniciar identidades para repetir un envío.

## Límites y riesgos aceptados

- **Un día perdido pierde el primer envío del mes.** Si la agenda no corre el último día hábil (o la compuerta está apagada), no nace ninguna fila y no hay primer envío tardío: es la consecuencia de «solo el último día hábil». Se recomienda una agenda más frecuente ese día y una alerta si no hay filas `RECORDATORIO_MENSUAL` con la `fecha_programada` esperada.
- **Un hijo sin factura frena a toda la familia.** No se envía un mensaje que parezca completo; el padre queda `FALLIDO` con el motivo y se reintenta a diario hasta el día 10. Un alumno activo sin matrícula abierta no tiene factura de EPT-104 y produce este impedimento: Dirección lo ve en la auditoría.
- Los campos `reserva_token` y `reserva_hasta` son legibles por Dirección (el `SELECT` de `envios_correo` es de tabla, conservado de EPT-101); no permiten actuar, porque las RPC son solo de servidor.
- Antes del despliegue conviene una consulta de solo lectura en producción: `SELECT count(*) FROM public.envios_correo WHERE tipo = 'RECORDATORIO_MENSUAL'` (el `CHECK` de frontera y el `ON CONFLICT` del plan suponen que no hay filas previas de ese tipo).
- Los caracteres sin glifo en la fuente se dibujan como casilla vacía en el PDF (no falla); es cosmético.

## Alcance excluido

El aviso de deuda del día 20 (EPT-116), la revisión/reenvío de inciertos con auditoría (se refina en EPT-118; aquí queda la marca durable y consultable por Dirección), la carga de feriados, el alta de vínculos (EPT-164) y la activación productiva (EPT-122).
