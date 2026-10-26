# EPT-118: matriz de cobertura

Criterio → cobertura existente → brecha → prueba o entregable → resultado. `R` = `supabase/tests/recordatorio-api.mjs` (25 escenarios tras este cambio), `A` = `aviso-deuda-api.mjs` (20), `RC` / `AC` = calendarios, `F` = `factura_pdf.mjs` (7), `U` = `tests/envios-correo-auth.spec.ts`. Los resultados son de ejecuciones nuevas sobre el baseline `587caa8` (stack local `ept118`), no copiados de unidades anteriores.

| # | Criterio | Cobertura existente | Brecha | Prueba / entregable de EPT-118 | Resultado |
|---|---|---|---|---|---|
| 1 | Recordatorio en la fecha simulada correcta | RC, R3 (29/10 y 02/11 sin evento) y R5 (30/10 sí) | ninguna | se reejecutan | OK (9 escenarios RC; R 25) |
| 2 | Aviso en el día 20 simulado (incluye fin de semana o feriado) | AC, A3-A4, A13 | ninguna | se reejecutan | OK (6 escenarios AC; A 20) |
| 3 | PDF correcto donde corresponde | R5 (MIME, nombre, texto, importes, acentos), F | los PDF no se habían visto: solo texto y geometría | PDF recibidos de Mailpit y muestras del generador rasterizados y abiertos como imagen (ver evidencia) | OK |
| 4 | Aviso sin adjuntos | A4-A5 | ninguna | se reejecuta; contraste documentado en el README | OK |
| 5 | Sin duplicados (mismo evento repetido y workers concurrentes) | R7, R18, A6 | ninguna | se reejecutan | OK |
| 6 | Hijos, ítems e importes exactos; sin fugas entre familias ni por To/CC/BCC | R5, A4-A5 | ninguna | se reejecutan | OK |
| 7 | Saldo cero sin envío | A4, A13 | ninguna | se reejecutan | OK |
| 8 | Pago total antes del reintento: omisión, nunca falso ENVIADO; pago parcial: deuda restante | A10 | ninguna | se reejecuta | OK |
| 9 | Revalidación de cuenta y vínculos | R17, A10 | ninguna | se reejecutan | OK |
| 10 | Fallos registrados para reintento; identidad original; límites diarios y fin de ventana | R9-R14, A8-A11, AC | ninguna | se reejecutan | OK |
| 11 | Fallo claro antes de `DATA` (rechazo en `RCPT TO`) | R9 | ninguna | se reejecuta | OK |
| 12 | **Rechazo explícito 4xx/5xx en `DATA`** | solo prueba pura (`F`: `clasificarErrorSmtp`) | no había transporte real | **R20**: `554` al comando, `451` y `554` al terminar; bitácora del intermediario; Mailpit sin mensaje; `FALLIDO`, `intentos=1`, código saneado; **R21**: siguiente día `ENVIADO`, `intentos=2`, una fila, un mensaje | OK |
| 13 | **Corte sin confirmación tras cruzar la frontera** | R9 (respuesta perdida tras aceptación) | faltaba el corte antes de que el servidor reciba el cuerpo | **R20**: corte tras el `354` → `INCIERTO`, frontera cruzada (y el corte previo a `DATA`, en `RCPT TO`, → `FALLIDO`; verificado por mutación del observador de fase); **R21**: sin reenvío ni intento nuevo en días posteriores (aunque arriba nunca lo recibió: la política prioriza evitar duplicados) | OK |
| 14 | Resultado incierto sin reintento automático | R9-R12, A9, A11 | ninguna | se reejecutan | OK |
| 15 | Respuesta perdida al confirmar sin reenviar SMTP | R19, A17 | ninguna | se reejecutan | OK |
| 16 | Caída de worker antes y después de la frontera | R15-R16, A14-A15 | **por estado equivalente**, no con un proceso matado | no se añade una caída real de proceso; se declara el límite | Límite declarado |
| 17 | Canal de revisión de `INCIERTO` para Dirección | RLS de lectura de Dirección (R22); sin pantalla | no existía canal de producto | página `/dashboard/envios-correo` + servicio de lectura + enlace de menú | OK |
| 18 | Acceso del canal: DIRECTOR sí; padre, estudiante, docente, personal y anónimo no; bloqueado con JWT vigente sin datos | R22 (padre, Dirección) | faltaban roles y bloqueado | **R23** (PostgREST con identidades reales) y **U** (pantalla: acceso restringido, `/login`, `/acceso-bloqueado`) | OK |
| 19 | Sin tokens, errores ni acciones de escritura en la vista | — | nuevo | **U**: el HTML no contiene el token interno ni `reserva_*`/`frontera_*`; sin botones, formularios ni enlaces de reenviar o resolver; motivo con el correo oculto | OK |
| 20 | Paginación acotada con orden estable, filtros, vacío | — | nuevo | **U**: 50 filas por página, «Siguiente», `pagina=9999` muestra vacío, filtro por estado y tipo, valor desconocido ignorado | OK |
| 21 | Estados de carga y error de la vista | — | nuevo | `loading.tsx`, `PanelErrorEnviosCorreo` y `error.tsx` revisados por tipos y lectura; **sin prueba automatizada del error** (no se puede forzar una lectura fallida del servidor sin tocar producto) | Límite declarado |
| 22 | Pruebas registradas y ejecutadas por CI | familias y selector (`impact.mjs`) | la pantalla nueva no tenía familia | familia `envios-correo` en `ui.mjs`, alias del servicio, regex de Playwright y prueba de selector en `impact.test.mjs` | OK local; CI sobre el SHA final consta en el PR |

## No cubierto a propósito

- Todos los entrelazados posibles de los workers, volumen y capacidad: no son requisito de esta tarjeta.
- Agenda remota, SMTP real, envío a personas reales, carga de feriados productivos y activación de compuertas: pertenecen a EPT-122 y no se tocaron.
