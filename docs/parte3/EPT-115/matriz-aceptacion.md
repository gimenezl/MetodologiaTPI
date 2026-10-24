# EPT-115: matriz de aceptación y trazabilidad

[Contrato](./contrato-recordatorio-mensual.md) · [evidencia](../../evidence/EPT-115.md). Los números `OK n` son los de `recordatorio-api.mjs` (A), `recordatorio-calendario.mjs` (C) y `factura_pdf.mjs` (P).

## Criterios de la historia

| Criterio EPT-115 | Prueba | Dónde |
|---|---|---|
| Solo envía correos el último día hábil | Sin primer envío el 29/10 ni el 02/11; filas solo el 30/10. Los reintentos de filas ya programadas siguen la regla 8 del contrato | A3, A4 |
| Un único correo por padre con el total de todos sus hijos | Padre con dos hijos: un mensaje, dos adjuntos, total 391,20; segundo padre del mismo hijo: su propio mensaje; otra familia aislada | A5 |
| Composición por hijo: cuota, deportes, transporte, comedor | Cuerpo y PDF con los cinco ítems y sus importes exactos | A5, P1, P6 |
| Se adjunta la factura en PDF | MIME `application/pdf`, nombre, texto, acentos, 9 páginas sin recorte, sin contenido activo | A5, P1–P4 |
| Dos ejecuciones el mismo día no reenvían | Cuatro ejecuciones simultáneas y dos ticks del scheduler real | A7, A8 |
| Los errores de envío quedan registrados para su reintento | `FALLIDO` con motivo acotado; retomado al día siguiente con la misma identidad; 12 intentos hasta el día 10 inclusive y ninguno el 11 | A9, A11, A13 |

## Subtareas

| Subtarea | Entregable | Prueba principal |
|---|---|---|
| EPT-158 último día hábil con feriados | `app_private.ultimo_habil` (EPT-104, reutilizada) + `recordatorio_fecha_civil` | C1–C6: hábil, sábado, domingo, feriados encadenados, bisiesto, diciembre/enero, UTC frente a Argentina, calendario único |
| EPT-159 tarea diaria con clave secreta | `GET /api/cron/recordatorio-mensual`, `scripts/recordatorio-local.mjs`, runbook | A1 (401/400/405), A2 y A21 (compuertas), A8 (scheduler real), A20 (RPC solo servidor), A22 (sin filtraciones) |
| EPT-160 factura PDF | `src/services/factura-pdf.ts` | P1–P5; A5 (PDF real recibido en Mailpit) |
| EPT-161 plantilla por hijo e ítem | `src/services/recordatorio-correo.ts` + `enviarCorreoEstructurado` | P6; A5 |
| EPT-162 registro y prevención de duplicados | Reserva con token, frontera SMTP, `envios_correo_facturas` | A6, A7, A10, A12–A19 |
| EPT-163 prueba local con fecha simulada | `recordatorio_reloj` + suite de Next/PostgREST/SMTP | todas las anteriores sobre Mailpit real |

## Riesgos de la política y su prueba

| Riesgo | Prueba |
|---|---|
| Fallo del renderer deja un correo parcial | A4: fuente ausente → todos `FALLIDO`, 0 mensajes, recuperación al día siguiente sin reiniciar |
| Rechazo SMTP confundido con incierto | A9: `RCPT TO` 550 → `FALLIDO` (Dirección ve el motivo) |
| Aceptación con respuesta perdida reintentada | A9: respuesta cortada tras `DATA` → `INCIERTO`, mensaje presente en Mailpit, 0 reintentos en la ventana (A12) |
| `CONN` de Nodemailer clasificado como fallo claro | A9 lo detectó con SMTP real; P7 lo fija con la fase observada |
| Confirmación perdida degrada `ENVIADO` | A19: se lee el estado antes de repetir; queda `ENVIADO`, 1 mensaje |
| Worker caído antes / después de la frontera | A15 (se retoma; el intento viejo no confirma) / A16 (`INCIERTO`, sin envío ni reintento; `datos` rechazado tras la frontera) |
| Doble despacho entre workers | A7 (4 ejecuciones) y A18 (4 workers × 8 padres: 1 correo e intento por padre) |
| Hijo ya no autorizado, cuenta bloqueada, correo inválido o con dos destinatarios | A9, A17: `FALLIDO` sin mensaje; bloqueada antes del evento no se programa |
| Fila que nunca salió al vencer la ventana | A14: el día 11 queda `FALLIDO`, no `PENDIENTE` para siempre |
| Lectura o escritura indebida | A20: padre sin auditoría; Dirección ve estado y error; RPC cerradas a clientes; config y reloj fuera de la API; `service_role` sin DML sobre `envios_correo` |
| Regresión del correo de vinculación | `usuarios_vinculo_cuenta.mjs`: 103 afirmaciones sin incumplimientos con el servicio compartido modificado |

## Limitaciones declaradas

- La caída de un worker se prueba llevando la fila al estado equivalente (reserva vencida con o sin frontera), no matando un proceso de Next a mitad de un envío.
- Las pruebas no cubren SMTP real, feriados cargados ni producción; son sintéticas sobre Mailpit.
- La revisión visual del PDF fue geométrica (todo el texto dentro de márgenes y página) y de contenido (texto extraído); no hay rasterizador local para inspección por imagen.
- La prueba de producción (`next start`) no se corrió: se comprobó que `next build` incluye la fuente en la traza de `/api/cron/recordatorio-mensual`.
