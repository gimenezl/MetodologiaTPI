# Matriz de cobertura EPT-95

Cada fila enlaza un requisito con sus diseños finales. Los archivos viven en `disenos/`, sus fuentes editables en `fuentes/html/` y el manifest (`manifest.json`) registra SHA-256, dimensiones y origen. Los enlaces apuntan a los PNG; el histórico de Stitch **no** se usa para cubrir ninguna fila.

## Las nueve áreas obligatorias

| # | Área | Wireframe | Mockup | Variantes (roles y estados) |
|---|---|---|---|---|
| 1 | Login | [W01](disenos/wireframes/W01-login.png) | [M01](disenos/mockups/M01-login.png) | [V01](disenos/variantes/V01-login-validacion.png), [V02](disenos/variantes/V02-login-credenciales-invalidas.png), [V05](disenos/variantes/V05-login-canal-web.png) |
| 2 | Selector de hijo | [W02](disenos/wireframes/W02-selector-hijo.png) | [M02](disenos/mockups/M02-selector-hijo.png) | [V06](disenos/variantes/V06-selector-sin-vinculos.png) |
| 3 | Cuotas | [W03](disenos/wireframes/W03-cuotas.png) | [M03](disenos/mockups/M03-cuotas.png) | [V07](disenos/variantes/V07-cuotas-estudiante.png), [V08](disenos/variantes/V08-cuotas-pagadas.png), [V09](disenos/variantes/V09-cuotas-pendiente.png), [V10](disenos/variantes/V10-cuotas-carga.png), [V11](disenos/variantes/V11-cuotas-vacio.png), [V12](disenos/variantes/V12-cuotas-error-conexion.png), [V13](disenos/variantes/V13-estados-de-cuota.png), [V26](disenos/variantes/V26-cuotas-texto-200.png) |
| 4 | Detalle de factura | [W04](disenos/wireframes/W04-factura.png) | [M04](disenos/mockups/M04-factura.png) | [V14](disenos/variantes/V14-factura-estudiante.png) |
| 5 | Selección y pago | [W05](disenos/wireframes/W05-seleccion-y-pago.png) | [M05](disenos/mockups/M05-seleccion-y-pago.png) | [V15](disenos/variantes/V15-seleccion-validacion.png), [V16](disenos/variantes/V16-pago-registrado.png) |
| 6 | Comprobantes | [W06](disenos/wireframes/W06-comprobantes.png) | [M06](disenos/mockups/M06-comprobantes.png) | [V17](disenos/variantes/V17-comprobante-validacion.png), [V18](disenos/variantes/V18-comprobante-confirmacion.png), [V19](disenos/variantes/V19-comprobante-error-incierto.png), [V20](disenos/variantes/V20-comprobantes-otro-padre.png), [V21](disenos/variantes/V21-comprobantes-estudiante.png), [V25](disenos/variantes/V25-comprobante-teclado.png) |
| 7 | Consulta por período | [W07](disenos/wireframes/W07-periodo.png) | [M07](disenos/mockups/M07-periodo.png) | [V22](disenos/variantes/V22-periodo-estudiante.png) |
| 8 | Deuda por ítem | [W08](disenos/wireframes/W08-deuda-item.png) | [M08](disenos/mockups/M08-deuda-item.png) | [V23](disenos/variantes/V23-deuda-estudiante.png) |
| 9 | Inscripciones | [W09](disenos/wireframes/W09-inscripciones.png) | [M09](disenos/mockups/M09-inscripciones.png) | [V24](disenos/variantes/V24-inscripciones-estudiante.png) |

## Criterios de aceptación de Jira

| Criterio | Cómo se satisface | Diseños |
|---|---|---|
| Login, selector de hijo, cuotas, detalle de factura, pago, comprobantes, período, deuda e inscripciones | Un wireframe y un mockup por área, más variantes por rol y estado | W01/M01; W02/M02; W03/M03; W04/M04; W05/M05; W06/M06; W07/M07; W08/M08; W09/M09 |
| Paleta institucional | Tokens de `src/app/globals.css` traducidos a sRGB; Outfit, Geist Mono y logo real | Todos los mockups y variantes |
| Cuatro estados de cuota distinguibles | Insignia con texto, ícono y trazo; Vencida prevalece sobre Pago parcial pasado el día 10 | Pendiente: V09, V13; Pago parcial: M03, V07, V13; Pagada: V08, V13; Vencida: M03, M04, V07, V13, V14, V26 |

## Actores, estados y reglas

| Regla | Dónde se ve |
|---|---|
| PADRE elige hijo vinculado; sin vínculos informa y deriva a Dirección | [M02](disenos/mockups/M02-selector-hijo.png), [V06](disenos/variantes/V06-selector-sin-vinculos.png) |
| ESTUDIANTE ve solo lo propio, sin pagar ni cargar | [V07](disenos/variantes/V07-cuotas-estudiante.png), [V14](disenos/variantes/V14-factura-estudiante.png), [V21](disenos/variantes/V21-comprobantes-estudiante.png), [V22](disenos/variantes/V22-periodo-estudiante.png), [V23](disenos/variantes/V23-deuda-estudiante.png), [V24](disenos/variantes/V24-inscripciones-estudiante.png) |
| Original del comprobante no se expone al estudiante ni a otro padre vinculado | [V20](disenos/variantes/V20-comprobantes-otro-padre.png), [V21](disenos/variantes/V21-comprobantes-estudiante.png), [V22](disenos/variantes/V22-periodo-estudiante.png) |
| DIRECTOR, DOCENTE y PERSONAL se dirigen al canal web | [V05](disenos/variantes/V05-login-canal-web.png) |
| Pagado, en verificación y pendiente se distinguen por ítem; los dos primeros no se seleccionan | [M04](disenos/mockups/M04-factura.png), [M05](disenos/mockups/M05-seleccion-y-pago.png), [V15](disenos/variantes/V15-seleccion-validacion.png) |
| Pago pendiente de verificación no implica pago confirmado; el saldo no baja hasta aprobar | [M04](disenos/mockups/M04-factura.png), [V16](disenos/variantes/V16-pago-registrado.png), [V18](disenos/variantes/V18-comprobante-confirmacion.png) |
| Datos bancarios representados como «no configurados»; sin efectivo, QR ni pasarela | [W05](disenos/wireframes/W05-seleccion-y-pago.png), [M05](disenos/mockups/M05-seleccion-y-pago.png) |
| Tipos y tamaño de archivo; varios archivos; número de operación duplicado | [M06](disenos/mockups/M06-comprobantes.png), [V17](disenos/variantes/V17-comprobante-validacion.png) |
| Resultado incierto: releer el estado antes de reintentar | [V19](disenos/variantes/V19-comprobante-error-incierto.png) |
| Estados de carga, vacío y error | [V10](disenos/variantes/V10-cuotas-carga.png), [V11](disenos/variantes/V11-cuotas-vacio.png), [V12](disenos/variantes/V12-cuotas-error-conexion.png) |
| Validación de login, credenciales genéricas, cuenta bloqueada y sesión expirada | [V01](disenos/variantes/V01-login-validacion.png), [V02](disenos/variantes/V02-login-credenciales-invalidas.png), [V03](disenos/variantes/V03-login-cuenta-bloqueada.png), [V04](disenos/variantes/V04-login-sesion-expirada.png) |
| Teclado abierto y texto ampliado al 200 % (láminas de diseño, no prueba nativa) | [V25](disenos/variantes/V25-comprobante-teclado.png), [V26](disenos/variantes/V26-cuotas-texto-200.png) |

## Inventario completo

| ID | Tipo | Título | Roles | Estados | Archivo |
|---|---|---|---|---|---|
| W01 | wireframe | Wireframe · Inicio de sesión | PADRE, ESTUDIANTE | Normal | [W01-login.png](disenos/wireframes/W01-login.png) |
| W02 | wireframe | Wireframe · Selector de hijo | PADRE | Normal | [W02-selector-hijo.png](disenos/wireframes/W02-selector-hijo.png) |
| W03 | wireframe | Wireframe · Cuotas pendientes | PADRE, ESTUDIANTE | Pago parcial, Vencida | [W03-cuotas.png](disenos/wireframes/W03-cuotas.png) |
| W04 | wireframe | Wireframe · Detalle de factura | PADRE, ESTUDIANTE | Vencida, En verificación | [W04-factura.png](disenos/wireframes/W04-factura.png) |
| W05 | wireframe | Wireframe · Selección y pago por transferencia | PADRE | Selección, En verificación, Datos bancarios no configurados | [W05-seleccion-y-pago.png](disenos/wireframes/W05-seleccion-y-pago.png) |
| W06 | wireframe | Wireframe · Carga de comprobantes | PADRE | Carga | [W06-comprobantes.png](disenos/wireframes/W06-comprobantes.png) |
| W07 | wireframe | Wireframe · Facturas por período | PADRE, ESTUDIANTE | Consulta, Pendiente de verificación | [W07-periodo.png](disenos/wireframes/W07-periodo.png) |
| W08 | wireframe | Wireframe · Deuda por ítem | PADRE, ESTUDIANTE | Consulta, En verificación | [W08-deuda-item.png](disenos/wireframes/W08-deuda-item.png) |
| W09 | wireframe | Wireframe · Inscripciones | PADRE, ESTUDIANTE | Consulta | [W09-inscripciones.png](disenos/wireframes/W09-inscripciones.png) |
| M01 | mockup | Mockup · Inicio de sesión | PADRE, ESTUDIANTE | Normal | [M01-login.png](disenos/mockups/M01-login.png) |
| M02 | mockup | Mockup · Selector de hijo | PADRE | Normal | [M02-selector-hijo.png](disenos/mockups/M02-selector-hijo.png) |
| M03 | mockup | Mockup · Cuotas pendientes | PADRE, ESTUDIANTE | Pago parcial, Vencida | [M03-cuotas.png](disenos/mockups/M03-cuotas.png) |
| M04 | mockup | Mockup · Detalle de factura | PADRE, ESTUDIANTE | Vencida, En verificación | [M04-factura.png](disenos/mockups/M04-factura.png) |
| M05 | mockup | Mockup · Selección y pago por transferencia | PADRE | Selección, En verificación, Datos bancarios no configurados | [M05-seleccion-y-pago.png](disenos/mockups/M05-seleccion-y-pago.png) |
| M06 | mockup | Mockup · Carga de comprobantes | PADRE | Carga | [M06-comprobantes.png](disenos/mockups/M06-comprobantes.png) |
| M07 | mockup | Mockup · Facturas por período | PADRE, ESTUDIANTE | Consulta, Pendiente de verificación | [M07-periodo.png](disenos/mockups/M07-periodo.png) |
| M08 | mockup | Mockup · Deuda por ítem | PADRE, ESTUDIANTE | Consulta, En verificación | [M08-deuda-item.png](disenos/mockups/M08-deuda-item.png) |
| M09 | mockup | Mockup · Inscripciones | PADRE, ESTUDIANTE | Consulta | [M09-inscripciones.png](disenos/mockups/M09-inscripciones.png) |
| V01 | variante | Inicio de sesión · validación de campos | PADRE, ESTUDIANTE | Validación | [V01-login-validacion.png](disenos/variantes/V01-login-validacion.png) |
| V02 | variante | Inicio de sesión · credenciales inválidas | PADRE, ESTUDIANTE | Error | [V02-login-credenciales-invalidas.png](disenos/variantes/V02-login-credenciales-invalidas.png) |
| V03 | variante | Cuenta bloqueada | PADRE, ESTUDIANTE | Cuenta bloqueada | [V03-login-cuenta-bloqueada.png](disenos/variantes/V03-login-cuenta-bloqueada.png) |
| V04 | variante | Sesión expirada | PADRE, ESTUDIANTE | Sesión expirada | [V04-login-sesion-expirada.png](disenos/variantes/V04-login-sesion-expirada.png) |
| V05 | variante | Roles de canal web | DIRECTOR, DOCENTE, PERSONAL | Canal web | [V05-login-canal-web.png](disenos/variantes/V05-login-canal-web.png) |
| V06 | variante | Selector · sin hijos vinculados | PADRE | Sin vínculo, Vacío | [V06-selector-sin-vinculos.png](disenos/variantes/V06-selector-sin-vinculos.png) |
| V07 | variante | Cuotas · estudiante (información propia) | ESTUDIANTE | Consulta propia, Pago parcial, Vencida | [V07-cuotas-estudiante.png](disenos/variantes/V07-cuotas-estudiante.png) |
| V08 | variante | Cuotas · pestaña Pagadas | PADRE, ESTUDIANTE | Pagada | [V08-cuotas-pagadas.png](disenos/variantes/V08-cuotas-pagadas.png) |
| V09 | variante | Cuotas · hijo con cuota Pendiente | PADRE | Pendiente | [V09-cuotas-pendiente.png](disenos/variantes/V09-cuotas-pendiente.png) |
| V10 | variante | Cuotas · carga | PADRE, ESTUDIANTE | Carga | [V10-cuotas-carga.png](disenos/variantes/V10-cuotas-carga.png) |
| V11 | variante | Cuotas · estado vacío (pestaña Pagadas) | PADRE, ESTUDIANTE | Vacío | [V11-cuotas-vacio.png](disenos/variantes/V11-cuotas-vacio.png) |
| V12 | variante | Cuotas · error de conexión | PADRE, ESTUDIANTE | Error | [V12-cuotas-error-conexion.png](disenos/variantes/V12-cuotas-error-conexion.png) |
| V13 | variante | Guía de los cuatro estados de cuota | PADRE, ESTUDIANTE | Pendiente, Pago parcial, Pagada, Vencida | [V13-estados-de-cuota.png](disenos/variantes/V13-estados-de-cuota.png) |
| V14 | variante | Detalle de factura · estudiante | ESTUDIANTE | Consulta propia, Vencida, En verificación | [V14-factura-estudiante.png](disenos/variantes/V14-factura-estudiante.png) |
| V15 | variante | Selección · validación sin ítems | PADRE | Validación, Selección | [V15-seleccion-validacion.png](disenos/variantes/V15-seleccion-validacion.png) |
| V16 | variante | Pago registrado · pendiente de verificación | PADRE | Confirmación, En verificación | [V16-pago-registrado.png](disenos/variantes/V16-pago-registrado.png) |
| V17 | variante | Comprobante · errores de validación | PADRE | Validación, Error | [V17-comprobante-validacion.png](disenos/variantes/V17-comprobante-validacion.png) |
| V18 | variante | Comprobante · confirmación | PADRE | Confirmación, En verificación | [V18-comprobante-confirmacion.png](disenos/variantes/V18-comprobante-confirmacion.png) |
| V19 | variante | Comprobante · resultado incierto | PADRE | Error incierto | [V19-comprobante-error-incierto.png](disenos/variantes/V19-comprobante-error-incierto.png) |
| V20 | variante | Comprobantes · otro padre vinculado | Otro padre vinculado | Original no autorizado, Pendiente de verificación | [V20-comprobantes-otro-padre.png](disenos/variantes/V20-comprobantes-otro-padre.png) |
| V21 | variante | Comprobantes · estudiante | ESTUDIANTE | Consulta propia, Original no autorizado | [V21-comprobantes-estudiante.png](disenos/variantes/V21-comprobantes-estudiante.png) |
| V22 | variante | Facturas por período · estudiante | ESTUDIANTE | Consulta propia, Pendiente de verificación | [V22-periodo-estudiante.png](disenos/variantes/V22-periodo-estudiante.png) |
| V23 | variante | Deuda por ítem · estudiante | ESTUDIANTE | Consulta propia, En verificación | [V23-deuda-estudiante.png](disenos/variantes/V23-deuda-estudiante.png) |
| V24 | variante | Inscripciones · estudiante | ESTUDIANTE | Consulta propia | [V24-inscripciones-estudiante.png](disenos/variantes/V24-inscripciones-estudiante.png) |
| V25 | variante | Comprobante · formulario con teclado abierto | PADRE | Teclado, Carga | [V25-comprobante-teclado.png](disenos/variantes/V25-comprobante-teclado.png) |
| V26 | variante | Cuotas · texto ampliado al 200 % | PADRE, ESTUDIANTE | Texto 200%, Vencida | [V26-cuotas-texto-200.png](disenos/variantes/V26-cuotas-texto-200.png) |

## Límites

Son láminas estáticas de diseño con datos ficticios. No demuestran ejecución en Android o iOS, TalkBack, VoiceOver, teclado nativo ni escalado real. No incluyen navegación operativa: el prototipo corresponde a EPT-96 y el catálogo de componentes a EPT-99.
