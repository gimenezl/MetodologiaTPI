# Estados, permisos y datos de ejemplo

Contrato de diseño de EPT-95. No implementa autorización ni sustituye las verificaciones de RLS y Storage previstas para la app. Fuentes: decisiones EPT-80 a EPT-87 y matriz de actores EPT-81.

## Roles y alcance

| Actor | Consulta | Acciones y archivos |
|---|---|---|
| PADRE | Únicamente hijos vinculados; el hijo consultado es visible en cada pantalla | Selecciona ítems completos y carga comprobantes. El original solo lo ve quien lo cargó |
| ESTUDIANTE | Exclusivamente información propia; sin selector de hijo | No selecciona, no paga ni carga. Ve el registro del comprobante, no el original |
| Otro padre vinculado | Facturas, pagos y recibos del mismo hijo | Ve el registro del comprobante, no el original cargado por otra persona |
| DIRECTOR | Canal web | Verifica pagos y accede a originales en la web; sin panel económico móvil |
| DOCENTE / PERSONAL | Canal web | Sin información económica ni archivos |

Sin vínculo: informar que no hay estudiantes asociados y remitir a Dirección; no hay búsqueda de otras familias. Cuenta bloqueada: no se muestran datos, y el aviso solo aparece después de una autenticación válida para no revelar si un correo existe. Sesión expirada: vuelve al ingreso sin conservar una vista económica. El ingreso fallido muestra siempre el mismo mensaje genérico.

## Estado de factura, de ítem y de pago

| Factura | Condición | Señal redundante |
|---|---|---|
| Pendiente | Saldo positivo, sin ítems aprobados, antes del vencimiento | Reloj, texto y trazo punteado |
| Pago parcial | Algunos ítems aprobados y saldo positivo, antes del vencimiento | Medio círculo y texto |
| Pagada | Saldo cero | Tilde y texto |
| Vencida | Saldo positivo después del día 10, incluso con ítems aprobados | Alerta, texto y trazo grueso |

Ítems: **Pagado**, **En verificación** (pago registrado, aún sin decisión de Dirección) y **Pendiente**. Un pago registrado figura como **Pendiente de verificación**. Adjuntar un archivo no aprueba el pago ni reduce el saldo; Dirección aprueba o rechaza desde la web y el rechazo libera los ítems conservando el historial. Ningún ítem admite pagos fraccionados.

## Datos ficticios compartidos

Referencia: **09/10/2026**, zona Argentina. Octubre vence el 10/10; septiembre vence el 10/09. Nombres, grupos, horarios y números de operación son ficticios y se rotulan como tales.

| Concepto | Importe (ARS) |
|---|---|
| Cuota | 48.750,35 |
| Deporte · Fútbol | 12.480,20 |
| Transporte | 18.925,45 |
| Comedor | 22.340,60 |
| **Total de una factura completa** | **102.496,60** |

| Hijo | Factura | Estado | Saldo |
|---|---|---|---|
| Mateo Ejemplo | Septiembre 2026 (cuota y deporte pagados, transporte en verificación, comedor pendiente) | Vencida | 41.266,05 |
| Mateo Ejemplo | Octubre 2026 (cuota y deporte pagados, transporte y comedor pendientes) | Pago parcial | 41.266,05 |
| Mateo Ejemplo | Agosto 2026 | Pagada | 0,00 |
| Sofía Ejemplo | Octubre 2026 (cuota y comedor, sin ítems aprobados) | Pendiente | 71.090,95 |

Sofía no tiene cuotas pagadas: su pestaña Pagadas ilustra el estado vacío.

Deuda total de Mateo: **82.532,10** (41.266,05 + 41.266,05). Selección de ejemplo: comedor de septiembre + transporte y comedor de octubre = **63.606,65**, calculado por el servidor. Pagos de ejemplo por fecha de transferencia: 05/09 y 03/10 aprobados por 61.230,55 cada uno (suman 122.461,10) y 07/10 pendiente de verificación por 18.925,45. Todos los totales de las láminas se calculan en centavos a partir de estas cifras en `fuentes/pantallas.mjs`.

## Importes y transferencia

Un pago puede reunir ítems de varias facturas del **mismo hijo**; los pagados o en verificación no se seleccionan. El importe informado distinto del total se acepta como dato de conciliación y Dirección decide; no hay rechazo automático. El número de operación es único entre pagos no rechazados.

Los datos bancarios se representan como **no configurados**: no se inventan CBU, alias ni titulares, no hay edición desde la app y no existen efectivo, QR ni pasarela. JPG, PNG y PDF hasta 5 MB **por archivo**, con varios archivos por pago y sin máximo inventado. Ante un resultado incierto se relee el estado antes de ofrecer reintento.

Consulta por período: extremos inclusive; pagos por fecha de transferencia, facturas sin pagos por vencimiento, hora de Argentina. Inscripciones: solo consulta de deporte, grupo, horario, profesor, recorrido y comedor.

## Handoff accesible, pendiente de implementación

Una columna, margen de 20 px y ritmo de 8 px. Controles de al menos 48 px, cuerpo y datos de 16 px o más, títulos de 20 a 24 px, radios 8 y 16 px. Etiquetas de insignia, barra inferior y pie de diseño quedan entre 12 y 14 px y no portan información obligatoria. Orden: título, contexto del hijo, saldo, vencimiento, acción. El estado nunca se comunica solo con color. Etiquetas persistentes, errores asociados al campo, y los lectores de pantalla deben anunciar resultados de carga y verificación sin afirmar pago aprobado.

Android e iOS: respetar áreas seguras superior e inferior, formulario desplazable con la acción visible sobre el teclado, texto largo con salto de línea y sin truncar importes. En las filas con casilla, la fila completa (no solo la caja de 32 px) es el objetivo táctil de al menos 48 px. Con escalado del 200 % crece la altura y la barra inferior pasa a dos filas; nunca hay scroll horizontal. Las láminas V25 y V26 ilustran teclado y texto ampliado: **no prueban** comportamiento nativo, TalkBack, VoiceOver ni escalado real, que deberán verificarse cuando exista la app Expo (fuera de EPT-95).
