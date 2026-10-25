# EPT-116: matriz de aceptación

Cada fila cita la prueba que la demuestra. Suites: `A` = `supabase/tests/aviso-deuda-api.mjs` (Next + PostgREST + SMTP/Mailpit real, números = escenarios OK); `C` = `aviso-deuda-calendario.mjs` (PostgreSQL con reloj simulado local); `S` = `economico_esquema.sql`; `P` = `usuarios_permisos_rls.sql`.

| # | Criterio / escenario | Prueba | Resultado |
|---|---|---|---|
| 1 | Fecha correcta: día 19 y día 21 sin evento previo no envían; el día 20 sí | C1, A3, A4 | Cubierto |
| 2 | Día 20 en fin de semana o feriado (viernes, sábado, domingo; feriado cargado) | C1, C2, A13 (domingo 20/12) | Cubierto |
| 3 | Un correo por padre, detalle de deuda restante, total exacto, sin adjuntos ni copias | A4, A5 | Cubierto (conteo en Mailpit, destinatario y total) |
| 4 | No envía a saldo cero (sin fila ni SMTP) | A4 (padre Z), A13 | Cubierto |
| 5 | Facturas sin pagos; parciales; varios períodos; conceptos distintos | A4 (octubre parcial + noviembre sin pagos, 3 conceptos + cuota) | Cubierto |
| 6 | EN_VERIFICACION conserva deuda (se muestra aparte); RECHAZADO e `importe_informado` no cancelan | A4 | Cubierto |
| 7 | Doble ejecución y workers simultáneos | A6 (4 simultáneas) | Cubierto |
| 8 | Fallo claro → reintento diario con la identidad original | A8, A10 | Cubierto |
| 9 | Fin de mes inclusive y vencimiento de la ventana (28/29/30/31, dic→ene) | C3, A11 (11 intentos hasta el 30/11, ninguno el 1/12) | Cubierto |
| 10 | Aceptación seguida de pérdida de respuesta | A17 (consulta de estado antes de repetir) | Cubierto |
| 11 | INCIERTO sin nuevo despacho, ni aunque cambie el saldo | A8, A9, A11, A15 | Cubierto |
| 12 | Padre que paga todo antes del reintento (omisión honesta, historia conservada) | A10 | Cubierto |
| 13 | Padre que paga una parte (deuda restante real) | A10 | Cubierto |
| 14 | Vínculo revocado, cuenta bloqueada | A10 | Cubierto (rol perdido: el filtro `rol = PADRE` está en `aviso_deuda_datos`; sin escenario propio) |
| 15 | Progreso del lote pese a destinatarios fallidos | A8 | Cubierto |
| 16 | Secreto incorrecto, usuario normal, métodos | A1 | Cubierto |
| 17 | Compuertas apagadas (base, entorno) y aviso/recordatorio independientes | A2, A19, A12 | Cubierto |
| 18 | Reloj, destinatario, importe y rol falsificados por HTTP | A1 (400 con parámetros) | Cubierto |
| 19 | Frontera, fencing y barrido a INCIERTO (caída después de la frontera = estado equivalente) | A14, A15 | Cubierto con **estado equivalente**: no se mató un proceso real |
| 20 | Carrera con la aprobación de un pago | A16 | Cubierto con límite: el correo es coherente con una lectura; no se prueba cada entrelazado posible |
| 21 | Permisos: RPC solo servidor, sin DML, padre sin auditoría, Dirección con lectura | A18, P | Cubierto |
| 22 | Escape HTML de nombres | A4 | Cubierto |
| 23 | Esquema: columnas con `isfinite`, tablas cerradas | S, P | Cubierto |
| 24 | Regresión EPT-115 y correo de vinculación | `recordatorio-calendario.mjs`, `recordatorio-api.mjs`, `factura_pdf.mjs`, `usuarios_vinculo_cuenta.mjs` | Cubierto |
