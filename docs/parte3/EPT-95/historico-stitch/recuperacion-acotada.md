> **Histórico rechazado.** Este documento conserva la recuperación con Stitch de 09/10/2026. Ninguno de estos recursos es el entregable de EPT-95: la entrega vigente está en `../disenos/` con origen `diseno-local` (ver `../README.md`). Se conserva sin edición de contenido para trazabilidad académica.

# EPT-95 — Nueva recuperación acotada: plan antes de generar

**Fase actual: recuperación mediante controles reales del editor visual.** La autorización más reciente permite continuar los recursos independientes aunque W06 falle; sustituye la parada global del plan anterior, no sus condiciones de aceptación. Los 33 derivados saneados y sus originales externos se preservan. No se amplía el validador para resolver defectos visuales.

## Estrategia visual observada el 09/10/2026

El editor expone `Generate → Mobile App Version`, una conversión nativa distinta de escribir MOBILE en un prompt. `Modify → Edit` permite seleccionar elementos; el diálogo real ofrece `Edit Text`, `Edit With AI` y `Delete`. `Edit Text` habilita la edición directa del texto. No se observó un campo editable de dimensiones en `More → View Details`; su tamaño es informativo. `View Code` permite copiar, no editar código.

Se consulta/exporta el resultado real después de cada operación. Un título que termina en «Móvil» no acredita dispositivo: M03 convirtió el título pero produjo DESKTOP 2560×2822; ese candidato queda fuera del manifest. Las modificaciones del editor también pueden agregar animaciones que dejan elementos invisibles en la captura; se rechaza ese resultado aunque su estilo computado tenga contraste adecuado.

| Recurso | Operación acotada | Comprobación de aceptación |
|---|---|---|
| W06 | Conversión nativa ya iniciada; edición directa del encabezado y ajuste localizado de placeholders. | MOBILE real; campos visibles en el PNG persistido; contraste, privacidad y carga nueva sin duplicar operación. |
| M02–M07, M09 | Una conversión nativa por recurso; conservar los originales hasta inspección. | Dispositivo MOBILE y dimensiones reales, textos y cifras completos; aceptar solo tras revisión visual y contractual. |
| Otros defectos independientes | Edit Text sobre el contenido exacto o edición localizada, no regeneración de los 33. | Cada corrección de la tabla anterior y captura/bytes persistidos, sin introducir funciones o reglas. |

Los candidatos y capturas de controles se conservan fuera de Git en `C:/Users/Lucas/.codex/visualizations/2026/10/09/ept95-editor-visual/`. Un bloqueo se limita al recurso afectado; no se invoca indefinidamente la misma acción ni se ocultan fallos mediante recorte o metadata.

## Base y fuentes releídas

Baseline origin/main: 4f4818335ba9b7240c58e04bb17b2e7d87a380cb; proyecto Stitch projects/6277945596504536494. PDF hash revalidado por orquestador: fcfcf5c16e3ba9b60a613978ded7ecdcf85b76479a2c179701202c30e97300a9. AGENTS del worktree y cuatro skills indicadas cargadas (paths-injected). Releídos brief, registro completo de decisiones, contrato EPT-98, historias EPT-92, casos EPT-93 y matriz EPT-81; encabezados históricos no reabren decisiones posteriores.

Worktree y base de las rutas de esta tabla: C:/Users/Lucas/.codex/worktrees/ept-95-disenos-moviles/MetodologiaTPI/docs/parte3/EPT-95/. Los identificadores referencian recursos existentes de Stitch, no futuros IDs inventados.

## Recurso → defecto → corrección → aceptación

| Recurso actual (ID Stitch y archivo) | Defecto confirmado | Corrección propuesta | Aceptación antes de sustituir |
|---|---|---|---|
| W03 · 3e37aa9f58bc4d3c948a21c3b88bc688 · wireframes/03-cuotas.png | Campana, perfil/menú extra y falta separación Pendientes/Pagadas. | Nuevo wireframe MOBILE monocromo de consulta con cuatro estados y separación por consulta. | Contenido económico conservado; no acciones adicionales; texto de estados no depende del color. |
| W04 · 0d6fb2b5b03b4ceab9af45f100f27f3d · wireframes/04-factura.png | Cifras partidas; campana y navegación extra. | Nuevo wireframe MOBILE con filas apiladas etiqueta/importe indivisible, sin extras. | Cada importe completo y legible; totales exactos; cuatro conceptos sin overlap. |
| W05 · 3089137a3f5845e189fb78f93c5c114d · wireframes/05-transferencia.png | Campana/perfil extra; legibilidad de cifras partidas. | Nuevo wireframe MOBILE selección, cifras indivisibles y banco pendiente; retirar navegación extra. | Ítems completos mismo hijo; pagados bloqueados; total 41.266,05 servidor sin cortes. |
| W06 · 6c9d87988a1645d9ab0d0a8c4ab0b4d2 · wireframes/06-comprobantes.png | Badge desbordado; operación duplicada; hijo no identificado; campana/perfil. | Nuevo wireframe MOBILE formulario/registro separados, hijo A visible y nuevos campos vacíos. | Wrap sin overlap; original privado; archivos 5 MB; operación nueva no precompletada con existente. |
| W07 · 118230683cd942fcb122215c105f61bf · wireframes/07-periodo.png | Concepto cuota 61.230,55 incorrecto; texto solapado; navegación extra. | Nuevo wireframe MOBILE con Cuota y deporte y Transporte y comedor; diseño apilado. | Sin overlap; transferencia inclusive Argentina y vencimiento de facturas sin pagos; suma exacta. |
| W08 · 46a92f57982343d7acad1e4b89be3744 · wireframes/08-deuda-item.png | Solo deuda actual; falta evolución histórica; navegación extra. | Nuevo wireframe MOBILE historial por ítem septiembre/octubre, filtro, importe/aprobado/saldo. | Periodos y deuda sumada por servidor coherentes; sin fracciones de ítem ni acumulación condicional. |
| W09 · d8117c204d254ffb93dd27d2e39091fe · wireframes/09-inscripciones.png | CTA contacto/gestión extra; navegación/campana no aprobada. | Nuevo wireframe MOBILE inscripciones solo consulta y datos sintéticos. | Sin altas, contacto prescriptivo ni CTA extra; contenido completo legible. |
| M01 · d2b3e264a03343c8937ed45fde1d303d · mockups/01-login.png | Lienzo DESKTOP 2560 px. | Nueva pantalla MOBILE de login; conservar padres/alumnos, validación y recuperación; sin funciones extra. | Metadata MOBILE, PNG estrecho original, formulario completo legible y ningún CTA no aprobado. |
| M02 · 7ee3a35d7e2149b6b53478925a6e7ba4 · mockups/02-selector-hijo.png | Lienzo DESKTOP 2560 px. | Nueva MOBILE del selector; conservar solo dos hijos vinculados ficticios, sin búsquedas de otras familias. | Nombre completo, saldo exacto y selector únicamente PADRE; sin overflow. |
| M03 · fd18013444504f7c95326199521eb6ae · mockups/03-cuotas.png | Lienzo DESKTOP; falta separación clara Pendientes/Pagadas. | Nueva MOBILE con separación de consultas y tablero de cuatro variantes etiquetadas como ejemplos independientes. | Cuatro estados y fechas/saldos exactos visibles; Vencida prevalece, texto/icono y contraste. |
| M04 · c749769f55d841a7a89d2ba7f79eeaa8 · mockups/04-factura.png | Lienzo DESKTOP 2560 px. | Nueva MOBILE de factura; conservar cuatro conceptos exactos y saldo servidor. | 102.496,60 total; 61.230,55 aprobado; 41.266,05 saldo; cifras sin cortes y sin acciones alumno. |
| M05 · 0cf736e28b8f40f38998902586372e5a · mockups/05-transferencia.png | Lienzo DESKTOP 2560 px. | Nueva MOBILE selección PADRE; conservar ítems completos, banco pendiente y total servidor; sin extras. | Pagados bloqueados; V9 cubre en verificación; ningún CBU, efectivo/QR/pasarela o autoridad móvil. |
| M06 · 3a217cb1f7c441989d6a6109674f8ffd · mockups/06-comprobantes.png | DESKTOP; operación repetida en formulario; contexto hijo insuficiente. | Nueva MOBILE: hijo vinculado A visible, registro previo aparte; campos de carga nuevos vacíos y placeholder; badge multilínea. | No repetir DEMO-FICTICIA; solo cargador/DIRECTOR ven original; JPG/PNG/PDF 5 MB; saldo no cambia. |
| M07 · f7f93c6246b34a128d03b0c74da3930d · mockups/07-periodo.png | DESKTOP; necesidad de identificación de conceptos y filtro legible. | Nueva MOBILE período: Cuota y deporte 61.230,55; Transporte y comedor 41.266,05; criterio transferencia y facturas sin pagos por vencimiento. | Intervalo inclusivo Argentina; fechas de transferencia, no aprobación/acreditación; conceptos coherentes sin overlap. |
| M08 · 0669aec9e4364cfea9c4ba86b8c5f67d · mockups/08-deuda-item.png | «Certificación contable unificada» inexistente; agrupación histórica mejorable. | Nueva MOBILE de historial agrupado por ítem con septiembre/octubre y columnas importe/aprobado/saldo; retirar certificación. | Historia real por período, sumas exactas servidor, sin reglas de acumulación inventadas ni certificación. |
| M09 · a20ac4409e8245c58efba1301886ad89 · mockups/09-inscripciones.png | DESKTOP; CTA Consultar servicios y canal de modificación no aprobado. | Nueva MOBILE solo consulta de inscripciones; eliminar CTA extra y copy prescriptivo sin fuente. | Deporte/grupo/horario/docente, recorrido y comedor ficticios; sin altas/bajas/gestión extra. |
| V1 · f4a9b743a22044f594c89b00cd73422c · mockups/v1-variante.png | Campana extra y jerga fiscal; contexto consulta propia. | Nueva MOBILE variante alumno propia sin campana ni jerga; conservar detalle económico correcto. | ESTUDIANTE propio identificado, sin selector hijo/pago/carga/original; cifras exactas. |
| V2 · 86ff1af1fa44423c8f770d32d3b5d712 · mockups/v2-variante.png | Concepto cuota 41.266,05 erróneo; nombre truncado; campana. | Nueva MOBILE copadre: Transporte y comedor, nombre completo y registro sin original. | No botón archivo original; saldo y concepto correctos, sin truncado. |
| V3 · 971d32e484e541288b502ce99eddbe68 · mockups/v3-variante.png | PERSONAL relabelado; pie/acciones recortados; códigos inventados. | Nueva MOBILE con DIRECTOR, DOCENTE, PERSONAL exactos y tres bloques/acciones web. | Tres botones visibles completos; DOCENTE/PERSONAL sin economía; sin códigos ni corte. |
| V4 · 171c9148e584497597ed838670924606 · mockups/v4-variante.png | Ubicación/horario institucional inventados; campana. | Nueva MOBILE sin vínculo: mensaje claro sin ubicación, horario ni requisito nuevo. | No hijo ajeno/búsqueda; sin datos inventados; salida de sesión autorizada. |
| V5 · af316b7805c44007bb1092bfbd3fcd1c · mockups/v5-variante.png | Versión v5.0 y supuesto plazo de inactividad. | Nueva MOBILE bloqueo y expiración en dos bloques; solo texto contractual sin duración/causa supuesta. | Cuenta bloqueada sin plazo; sesión expirada sin atribuir inactividad; sin versiones. |
| V6 · ab4de4dab4604b6abc7fd132086090a5 · mockups/v6-variante.png | Año 2025; códigos/protocolos técnicos; campana. | Nueva MOBILE estados carga/vacío/error/reintento con copy simple en 2026. | Cuatro estados diferenciados; no SQL/PostgREST/códigos/protocolos; relectura antes de retry incierto. |
| V9 · 12c9ff5d62934a68835c8cac96b58dfb · mockups/v9-variante.png | SERVER_SYNC/AUDITORÍA CENTRAL/Terminal Segura y menú balanceado. | Nueva MOBILE ítems en verificación bloqueados; retirar jerga y menú no definido. | Saldo 41.266,05 conservado, pagados/verificación no seleccionables; sin CTA activo de pago. |
| V10 · ca729da2aedd422f90465c84554459d6 · mockups/v10-variante.png | Acreditación en vez de transferencia; omite vencimientos sin pagos; versión/legajo. | Nueva MOBILE período ESTUDIANTE con las dos reglas de fechas y sin IDs ficticios innecesarios. | Sin pago/carga/selector/original; transferencia inclusiva Argentina y facturas sin pagos por vencimiento. |
| V11 · a75806558aa14b718266150e2526f04a · mockups/v11-variante.png | No acumular sin validación: regla inventada; legajo no solicitado. | Nueva MOBILE historial ESTUDIANTE por ítem/período y sumas servidor normales; retirar regla y legajo. | Saldo total es suma de saldos de rango; ningún requisito nuevo de validación; sin CTAs económicos. |
| V15 · a0ee18773f8e44bfa56b86b251a30b2c · mockups/v15-variante.png | Campana extra; etiqueta 200% no es medición. | Nueva MOBILE lámina estática texto ampliado; retirar campana y mantener límite explícito. | Sin desbordes/ellipsis horizontal, contenido completo y cifras exactas; no afirmar prueba nativa/200% medido. |

## Preservación y límites

W01, W02, V7, V8, V12, V13 y V14 se conservan sin generación en esta recuperación salvo defecto material nuevo verificado por revisión. V7/V8 mantienen sus archivos/estados y titulo_stitch fuente/titulo_local correcto. V12 conserva consulta de inscripciones; sus nombres/códigos sintéticos no se convierten en contratos. V13/V14 son láminas de teclado Android/iOS, no ejecuciones nativas. El texto ampliado V15 no se presenta como medición de escalado.

Los 33 hashes de la tabla inferior se releyeron contra bytes existentes en esta preparación. No se cambió manifest ni PNG. Los recursos defectuosos se mantienen recuperables hasta tener un sustituto aceptable. Antes de sobrescribir uno, conservar copia exacta fuera de la entrega activa en un archivo de recuperación local, con ID y hash original; no reset, clean, stash, borrados ni cambios ajenos. El inventario histórico sigue documentado aquí.

## Secuencia histórica de pilotos (sustituida por la estrategia visual actual)

1. Piloto: M01 (lienzo) y W06 (formulario/wrap). Una llamada nueva individual por recurso, deviceType MOBILE; no prompts multipantalla, edit_screens DOM ni generate_variants multiselección.
2. Por cada piloto: recuperar ID real/get_screen, descargar PNG íntegro (=s0), comprobar metadata MOBILE y dimensiones, hash nuevo, leer visualmente todos los textos y validar su fila. Persistencia no se infiere de texto o eventos.
3. Solo si ambos pilotos satisfacen las condiciones, continuar lotes de uno a tres recursos. Cada recurso tiene máximo una generación en esta recuperación. Orden: M02–M04; M05–M07; M08–M09/W04; W03/W05/W07; W08–W09/V1; V2–V4; V5–V6/V9; V10–V11/V15. Los grupos se procesan secuencialmente y se verifica cada lote antes del siguiente.
4. Si no hay nuevo PNG persistido, el dispositivo sigue DESKTOP o aparece contradicción económica/privacidad, detener ese grupo. Registrar recurso, defecto restante, comando/resultado y mínima intervención requerida. No reintento ciego, nuevos lotes para maquillar el fallo ni claim de aceptación.
5. Un reemplazo solo entra al manifest después de inspección y aceptación de su fila; mantener ID/título fuente nuevo, fecha real, hash y vínculo requisito. Releer al final TODOS los bytes/manifest y comparar hashes de los siete preservados. Revisión externa del delta es automatizada, no aprobación humana.

## Reglas comunes de prompts y comprobación

Interfaz español profesional; Outfit, cifras legibles, traducción tokens reales del README. Cuerpo 16 px y objetivos 48 px como diseño, safeareas/scroll/teclado contemplados; contraste de cada par usado comprobado, no AA global desde cinco pares históricos. Sin campanas, perfiles, versiones, certificaciones, ubicaciones/horarios institucionales o protocolos inventados; sin movimiento permanente. Sin HTML funcional, edición raster local, recorte o imagegen.

Solo PADRE selecciona/carga sobre hijos vinculados. ESTUDIANTE solo propio sin pago/carga/selector/original. Original exclusivamente padre cargador y DIRECTOR web; copadre registro. DIRECTOR/DOCENTE/PERSONAL aviso web, estos dos últimos sin economía. Archivos JPG/PNG/PDF hasta 5 MB por archivo, varios sin máximo nuevo. Operación única global entre pagos no rechazados; formulario nuevo vacío, no duplicar la existente. Saldo solo baja con aprobación de Dirección; subir no paga. Ítems completos mismo hijo, pagados/en verificación bloqueados. Banco pendiente de parametrización sin CBU inventado.

Ejemplo de factura: cuota48.750,35 + deporte12.480,20 + transporte18.925,45 + comedor22.340,60 =102.496,60; aprobados61.230,55; saldo41.266,05. Estados: Pendiente sin aprobados no vencida; Pago parcial con aprobados y saldo no vencida; Pagada saldo0; Vencida con saldo después del10 incluso parcial. Ref09/10/2026, octubrevence10/10, septiembrevence10/09. Filtros inclusive Argentina por fecha transferencia, no aprobación/carga/acreditación; factura sin pago por vencimiento.

Para historial de dos facturas distintas (septiembre/octubre) con transporte/comedor pendientes: cada período saldo41.266,05; rango de ambos total servidor82.532,10 (=37.850,90 transporte +44.681,20 comedor). Importe aprobado de esos ítems0,00, sin pagos fraccionados ni regla artificial de no acumulación. Si se muestran cuota/deporte aprobados de ambos: aprobado122.461,10 y facturado204.993,20. Son ejemplos sintéticos, no tarifas reales ni cálculo móvil autorizado.

Fuera de alcance: EPT-96/99/102, Expo, producto/DB/datos/auth/RLS/Storage. Contrato mínimo CI assets está autorizado pero se implementará SOLO con delegación explícita posterior, sin excepción global ni activar RDD. Preparación no hace commits/push/PR/Jira.

## Inventario histórico previo a pilotos (SHA-256 preservado)

| Pantalla/archivo | Bytes | SHA-256 | Disposición |
|---|---:|---|---|
| W01 · wireframes/01-login.png | 75713 | 490e218f534bda20884757a8c4a0378491f57368a18380c5c29a3c5f1f5f896f | Preservar |
| W02 · wireframes/02-selector-hijo.png | 156457 | 35bd14c6b3a4ee196854a81354f4f75cb15f21c54fb413bcc563c1260a54812e | Preservar |
| W03 · wireframes/03-cuotas.png | 241647 | 28a1f94b4257315f90c02a0b84a4cada39de279a8bfe0e36696e9ad8e9365aca | Sustituir solo tras aceptación |
| W04 · wireframes/04-factura.png | 235199 | 0d4eb140326c22231924bfd5a3edb2d67a2f4aca5ddd7af63139e5f8430cf594 | Sustituir solo tras aceptación |
| W05 · wireframes/05-transferencia.png | 181772 | 935101f9ebc88866bfce0bcc4a1cd43d78b7d28be8436dfef0dbbddee29f1f78 | Sustituir solo tras aceptación |
| W06 · wireframes/06-comprobantes.png | 239006 | 178433ffbf595ab4f181f0904dc854e21ea92b2acfaa9a76037a6ef509fd7a16 | Sustituir solo tras aceptación |
| W07 · wireframes/07-periodo.png | 322110 | 10a65be9ef3374b9469ae02b12483d9e0208f4517cf1a3a044152c778afb527a | Sustituir solo tras aceptación |
| W08 · wireframes/08-deuda-item.png | 191949 | 4c46c1351fa7ab4fa3da23034b74a559099d8ff9838e97d865abf1ceaab0ba89 | Sustituir solo tras aceptación |
| W09 · wireframes/09-inscripciones.png | 183302 | 453b9c059672aea18099ec3e833da2caa4e0463f6e84d86f2737839131397944 | Sustituir solo tras aceptación |
| M01 · mockups/01-login.png | 74177 | 5f23f164f6d89d2f0583d7bea6b4308297feba91d49c87b1de1e5ed8a85d11da | Sustituir solo tras aceptación |
| M02 · mockups/02-selector-hijo.png | 119254 | 26a9e3be107e042872f20b5ef33941be0997515a3bd80ea364cc7f44b3e31d5e | Sustituir solo tras aceptación |
| M03 · mockups/03-cuotas.png | 278104 | 1442f50352697a0d1fc10d4d100b0e8595bf6b500dd0a48bbca90cb9972ebb1f | Sustituir solo tras aceptación |
| M04 · mockups/04-factura.png | 185798 | e7f942070218930c9161ff69b343de9bfedbb3a9e294341998923bc3ee2c108f | Sustituir solo tras aceptación |
| M05 · mockups/05-transferencia.png | 160357 | 36999ef6c220ea49686dc57de4de99168225fc1057111fe7adbf2bd9f1d929fe | Sustituir solo tras aceptación |
| M06 · mockups/06-comprobantes.png | 216328 | eeef71df1a26932aaf4371e083fe3507b9a512f62c834d0d80597b6b26727c04 | Sustituir solo tras aceptación |
| M07 · mockups/07-periodo.png | 239880 | 35a199f45f6bf1d12bf91fc681ea5b00d654fec8b91d3f518460b085a9e55011 | Sustituir solo tras aceptación |
| M08 · mockups/08-deuda-item.png | 296073 | 7e993c4c1ac93bd8f07afe6ea08b6254633b87c9853fb892f6c103d457aa6f78 | Sustituir solo tras aceptación |
| M09 · mockups/09-inscripciones.png | 160645 | c791435994a4f20ebe8fb9187c54a3bf2fa4c562bd9f287c7c0f4979d8134a2b | Sustituir solo tras aceptación |
| V1 · mockups/v1-variante.png | 271009 | 0f5ab66d9b4e9f10ca206870b97241f6f19fbaf597a14c655dac92567ee71826 | Sustituir solo tras aceptación |
| V2 · mockups/v2-variante.png | 221212 | b2102fa6fa61017aa77a09cac2728972df31e436b22f6d9bf4e101c563999ec6 | Sustituir solo tras aceptación |
| V3 · mockups/v3-variante.png | 156884 | f93719c96caa06d4b014fe913fcd1df43b1cf1afa27fab87f8ffb7ee8888f8d0 | Sustituir solo tras aceptación |
| V4 · mockups/v4-variante.png | 125571 | f691da86d5bd099065d06d098b3a6048f5846c112fa891405e7023896b0232f9 | Sustituir solo tras aceptación |
| V5 · mockups/v5-variante.png | 87329 | 05124ead6684d8813ea321bc11103ebfd23e177c4d4db22865a7d5f793eaecde | Sustituir solo tras aceptación |
| V6 · mockups/v6-variante.png | 196024 | e9acb9d6f831f64965508c42dff66c5fc1d571a5d77568530bc7de2dfca32aa9 | Sustituir solo tras aceptación |
| V7 · mockups/v7-variante.png | 189333 | 9ddf5bb5d390de4af06522b9bf99ea99c054ac17e55ef7f9f6ad7e7c7f9a5c11 | Preservar |
| V8 · mockups/v8-variante.png | 185715 | 4a36be9b153dde68f5e09cb2e1b614cfc9f91c99c73cb9e1ae13ed435b04355b | Preservar |
| V9 · mockups/v9-variante.png | 264560 | 3bc5956f1b4360d7443db3c394ed1b10a2ae4bf7e8d879946b1e9db0abb7e67e | Sustituir solo tras aceptación |
| V10 · mockups/v10-variante.png | 211568 | 8629f1abb5acd614ebaf800944d6d015f2718a2e16e7b7fb85970dba97785f8a | Sustituir solo tras aceptación |
| V11 · mockups/v11-variante.png | 210300 | 4eaa62f2b501a9634ce176bbc025a400b7742455d6678508641a4cea672fb1e9 | Sustituir solo tras aceptación |
| V12 · mockups/v12-variante.png | 180605 | c9471427d1ac7675992ffaf938a92b509cef8b6753e4e4d892c8be1449ff2c04 | Preservar |
| V14 · mockups/v14-variante.png | 127550 | 12b30105146a600481e1fd3075641667d3563640f5d86fb5b7cb5467dcbe9036 | Preservar |
| V13 · mockups/v13-variante.png | 105589 | 551dabe65622b9068a22e78e21c797ad172f03116f7dc80b33a1257f3ff537ae | Preservar |
| V15 · mockups/v15-variante.png | 370016 | c2c1f4ccc3d099deeed0cc9415374dc27403d10b887a159ff752f1d912ae8096 | Sustituir solo tras aceptación |

Inventario: 33 PNG, 6461036 bytes; 26 objetivos y siete preservados. Estado de ejecución: pilotos M01 y W06 procesados una vez; M01 sustituido tras aceptación de fila, W06 no aceptado ni sustituido; otros recursos no generados.


## Resultado de los dos pilotos individuales

Backups exactos anteriores: C:/Users/Lucas/.codex/visualizations/2026/10/09/ept95-recuperacion/backups-pilotos/. Ruta absoluta resuelta verificada dentro de visualizations/2026/10/09; contiene PNG M01/W06 y su inventario ID/SHA histórico. Sin borrados, reset, clean o stash.

| Piloto | Recurso nuevo y PNG | Resultado |
|---|---|---|
| M01 | 84e028ad86694d5b9e758c47b9a8b05e · MOBILE 780×1768 · SHA256 428030f16bc165dee7ae2afb8db2513fa6935a643ed3f789cb6b752c4e8c3229 · 50.958 bytes | PNG íntegro nuevo e inspeccionado; copy exacto y sin funciones extra, cifras no aplican. Lienzo móvil aceptable como diseño estático; se sustituyó solo mockups/01-login.png y entrada M01 |
| W06 | 29336783f6b642849720ac205940a711 · DESKTOP 2560×2768 · SHA256 45aa628a6e022bb1aacac8f4beb9a702eabb96b8d56ce344449377360d5bcd27 · 205.330 bytes | PNG nuevo persiste y mejora badge, contexto hijo/formulario vacío, pero falla gate MOBILE. Permanece fuera de entrega activa en C:/Users/Lucas/.codex/visualizations/2026/10/09/ept95-recuperacion/pilot-W06-candidato.png; W06 original intacto |

Cada piloto tuvo una llamada generate_screen_from_text con deviceType MOBILE y prompt individual. No reintentos ni otros lotes. M01 se validó get_screen/PNG/hash/lectura visual antes de manifest; W06 se recuperó e inspeccionó pero no se aceptó pese al resumen del servicio. No se recortó ni modificó raster localmente.

Contraste M01 observado en píxeles: blanco/azul6,1429:1, principal/fondo16,2986:1, secundario/fondo8,0261:1, azul/fondo5,9404:1. W06 usa placeholders grises débiles (#A1A1AA/blanco, ratio registrado en evidencia), otro punto de legibilidad; no AA global ni prueba nativa.

Parada histórica del piloto: W06 deviceType DESKTOP y canvas2560px. Este resultado no describe las correcciones posteriores del editor visual, registradas a continuación. No se acepta deuda ni se cambia el contrato CI para resolver defectos visuales.

## Recuperación mediante controles reales del editor · 09/10/2026, 22:35 ART

Proyecto: https://stitch.withgoogle.com/projects/6277945596504536494. Candidatos y capturas preservados fuera de Git en `C:/Users/Lucas/.codex/visualizations/2026/10/09/ept95-editor-visual/`. Los 33 PNG saneados activos y su procedencia no fueron sustituidos en esta etapa. La tabla anterior conserva el historial; los candidatos siguientes no son aceptación del paquete.

| Recurso / ID Stitch | Corrección y comprobación real | Resultado / defecto pendiente |
|---|---|---|
| W06 / 42ed15ec5baa42b89ac366d400cf3c27 | Conversión nativa y edición localizada: formulario visible, placeholders #52525B, Outfit. `W06-editor-identidad-export.bin`: JPEG 390×979, SHA d940512bc49ce478ec97a93cb8e82280e90034eec5a0f81f601b6e10918a366f | Imagen revisada, pero falta export PNG nativo. No se convierte JPEG ni se disfraza con extensión PNG |
| M02 / 9c5546e6464e436f82a4533251c1f332 | Edit Text retiró homologación de secretaría. `M02-texto-reconsultado-export.bin`: JPEG 390×884, SHA 17eff510d666fc180dafa6469c8eba8bd39eaea28f688995b5ef099b6d48d8ea | Nuevo render persiste texto correcto, pero parte símbolo y cifra $41.266,05; pie débil y PNG pendiente |
| M03 / 7de81bc3c2ce4302970284e13ca69fad | Mobile App Version produjo PNG 2560×2822. Resize del marco a 390 refluye localmente; nueva pestaña y View Details restauran 1280 | DESKTOP, rechazo. SHA 4a641e513f96fda96976249e3ed0467b32e87e629ffd7bd3a658a5bcac49d7f3. No recorte ni cambio metadata |
| M04 / f0a99ae511f8410fb8f5939fff52f611 | `M04-mobile-original.png`: PNG 780×2736, SHA 95a15201f8408405c210cd88ef40748b5a9e72ed859c0c62e90953c6add86101. Ítems 102.496,60, aprobado 61.230,55 y saldo 41.266,05 visibles | Candidato preservado; pie #727785/fondo #FAFBFF: 4,33:1, no AA global. Revisión final pendiente |
| M05 / 51420b306bce4a1cbc1f61ae2e28a73f | `M05-mobile-original.png`: PNG 780×1912, SHA f1c3a02dee8cb8052830d95b258d588560facd11daf725856893889a6e0853e7. Selección coherente, banco pendiente, continuar deshabilitado | Candidato preservado; contraste del pie pendiente de corrección y comprobación |
| M06 / 1a84134ddc7b4fee83352f1ea023b573 | PNG inicial 780×2734, SHA e46b7447093559cdf97de6cc617490ba78a32f070c0b8dc996feba25244d7249. Edit Text añadió hijo A; `M06-contexto-export.bin`: JPEG 390×1367, SHA de1ca006d9293003e370c146284ba4b1dc183be9559e1f1c65a65884f0fbc8f4 | Imagen nueva revisada, hijo resuelto; formulario todavía reutiliza operación del pago pendiente con CTA activo. El guardado cambió el nodo a Generating Screen e interceptó la siguiente edición; no se forzó el overlay. No aceptado |
| M07 / 4b41dd620ef94724ac3a280044f96c63 | Edit Text: hijo A, transferencia informada, Cuota/deporte y Transporte/comedor. `M07-texto-reconsultado-export.bin`: JPEG 390×1045, SHA 0b4ac73380b842bbac0c8a2df4f465a16f405772716841a245b70a73e84a2fb2 | Nuevos bytes e imagen inspeccionada sin solapes; no PNG nativo, no promoción al manifest |
| M09 / 53d81da6b26e412eb960990558c7aaf4 | Delete retiró CTA extra; Edit Text retiró indicación de secretaría, solo consulta hijo vinculado. `M09-editor-tokens-export.bin`: JPEG 390×884, SHA 0cf045a1753a1446e4fc2f23eb7e311858218949eb10aa21c07a490e904ffb47 | Imagen revisada; pie 4,54:1. Falta PNG nativo |
| V10 / ca729da2aedd422f90465c84554459d6 | DOM corrige transferencia informada y facturas sin pagos por vencimiento. `V10-revalidado-export.bin`: JPEG 390×1213, SHA da6a64b471d4525b1af1b055140936c1d64314045b39f79f4030fc4a2527fe7a | Export oculta titular y criterio por animación: rechazado. El mensaje Element edited no acredita aceptación |
| V11 / a75806558aa14b718266150e2526f04a | Primera revalidación mantuvo PNG original SHA 4eaa62f… sin cambio. Después Edit Text retiró legajo y regla inventada; suma explícita del servidor 82.532,10. `V11-texto-reconsultado-export.bin`: JPEG 390×1346, SHA f41c9e6f0f4371fa74c5cd3b95147d65b54c248c1c06435cc71580365dcfa41c | Imagen persistida inspeccionada; subtotales aún parten símbolo/cifra y falta PNG nativo |

Controles comprobados: Generate → Mobile App Version; Modify → Edit → Edit Text / Edit With AI / Delete. View Details solo informa tamaño; View Code solo permite copiar. El icono del compositor que parecía dispositivo es **Variations (3x)**, restaurado a una pantalla; menús de adjuntos y comandos no muestran selector Mobile. Captura `control-compositor-sin-dispositivo.jpg`.

Capturas de límites: `control-m03-tamano-no-persistido.jpg`, `control-edicion-w06-real.jpg`, `m09-corregido-editor.jpg`, `m02-texto-corregido-editor.jpg`, `m07-texto-corregido-editor.jpg` y `v11-texto-corregido-editor.jpg`, todas en la carpeta externa indicada. La captura del editor no certifica exportación ni ejecución Android/iOS.

Acción manual de exportación comprobada: seleccionar la pantalla corregida → More → Export → .zip → Export y proporcionar el archivo descargado. Captura real del panel con W06 42ed15ec5baa42b89ac366d400cf3c27 seleccionado, opción .zip marcada y botón Export: `C:/Users/Lucas/.codex/visualizations/2026/10/09/ept95-editor-visual/control-export-zip-w06-corregido.jpg`. En esta captura no se pulsó Export otra vez. Un intento anterior registrado no devolvió archivo accesible en 20 segundos; esto no prueba que la descarga no exista. No se repite a ciegas ni se elude la restricción del navegador sobre páginas internas. M03 requiere además obtener un lienzo cuyo ancho permanezca tras recarga y en el export; el resize local observado no cumple esa comprobación.

Los recibos `recibo-candidatos-inicial.json` y `recibo-candidatos-segundo-lote.json` verifican saneamiento de los candidatos PNG, no aceptación visual. No se amplió el validador, no hubo generaciones adicionales al reanudar, ni commit, PR, merge o cierre Jira. Quedan los defectos independientes y la revisión final de toda la cobertura.


## Pasada independiente restante · 09/10/2026, 22:47 ART

Una pasada de controles Edit Text/Delete por recurso, sin regeneración. Todos los archivos siguientes son nuevos bytes reales JPEG preservados fuera de Git, no derivados PNG ni exports originales byte a byte. No se modificó el manifest activo ni se amplió CI. Imágenes inspeccionadas completas; no aceptación por resumen de Stitch.

| Recurso / ID Stitch | Archivo, dimensión decodificada y SHA-256 | Resultado visual/contractual |
|---|---|---|
| V2 / 86ff1af1fa44423c8f770d32d3b5d712 | V2-pasada-editor.bin · JPEG 390×1425 · e9e174bde1f37ed0815c19def0ca66e8735a9c10647068d70f929490d67d7188 | Concepto Transporte y comedor, fecha transferencia informada y campana retirados. Nombre sigue truncado; navegación extra, PNG pendiente. |
| V3 / 971d32e484e541288b502ce99eddbe68 | V3-pasada-editor.bin · JPEG 390×884 · 5e527194ffcc982864f823b6b26c1dc5f6faa2dab7177877a15b6feb4e213323 | PERSONAL exacto, códigos ID_CANAL/PORTAL retirados y explicación alumno sin pago. Export sigue cortando acciones web y pie: no aceptado. |
| V4 / 171c9148e584497597ed838670924606 | V4-pasada-editor.bin · JPEG 390×884 · 69dd1692687c0d06c05992d4209d256c92ff7dec1f2b572c1f6a4ecba95be4b4 | Dirección, horario, referencia y campana retirados; consulta institución sin imponer presencialidad. Render usa serif ajena y marca partida, no aceptado. |
| V5 / af316b7805c44007bb1092bfbd3fcd1c | V5-pasada-editor.bin · JPEG 390×884 · c6c9a127e3948bdb1bc843e886215155c24de18b71654b5cb31ca07ee9366b29 | Versión y causa de inactividad retiradas; cuenta bloqueada sin plazo y sesión no vigente. Copy corregido visible; falta PNG y revisión contraste final. |
| V6 / ab4de4dab4604b6abc7fd132086090a5 | V6-pasada-editor.bin · JPEG 390×1533 · 323d950c5c5a6ce51d0295a34e81728890848b47a8cf1cbd49b87cd6bbcd0c41 | 2026, sin campana/MOD/protocolo/certificación. ERR_SYNC reapareció en guardado; texto del error no se pudo llenar y conserva contenido inventado. Captura v6-limite-guardado-editor.jpg; no forzar ni detener otros. |
| V9 / 12c9ff5d62934a68835c8cac96b58dfb | V9-pasada-editor.bin · JPEG 390×1526 · ef6117d3540a038c7e5e5eb53dbac4ecfd65a22d4c9288cd60db19c048f7f2b8 | Auditoría central, terminal y menú balanceado retirados; 4 ítems; saldo conserva41.266,05 y CTA deshabilitado. SERVER SYNC reapareció; jerga auditado permanece, no aceptado. |
| W04 / 0d6fb2b5b03b4ceab9af45f100f27f3d | W04-pasada-editor.bin · JPEG 390×1553 · 41a17ca017e954c2f098af461a47991e0934953848b72e4ce7014be84e69a63a | Campana y números de comprobante4401/4402 retirados. Saldo y aprobado aún parten símbolo/cifra; navegación extra, no aceptado. |
| W07 / 118230683cd942fcb122215c105f61bf | W07-pasada-editor.bin · JPEG 390×1748 · 50458ca7fe684ea2ff3ad8023e8b2eda40fe882983a8909caf99fc6aeb37108b | Conceptos Cuota/deporte y Transporte/comedor; fecha informada y sin pagos por vencimiento, campana retirada. Archivo/nota se solapan y navegación extra, no aceptado. |
| W08 / 46a92f57982343d7acad1e4b89be3744 | W08-pasada-editor.bin · JPEG 390×1401 · 9f80aeccd1a4fd558e01b36d2d06a842fe5d2291912ee507a9de7f661f88a77c | Pago aprobado diferencia saldo; navegación extra retirada. Solo octubre: falta evolución septiembre y suma del rango; no se finge cobertura mediante texto. |
| M08 / 0669aec9e4364cfea9c4ba86b8c5f67d | M08-pasada-editor.bin · JPEG 390×1882 · e4951a2cbd6c194f07ce3077d25c1a7b0d3bb53fcd51fd8cd80e62867c3c7f18 | Certificación contable retirada; suma82.532,10 explícita. Edit Text reemplazó solo strong, dejando texto histórico contradictorio detrás; no aceptado. |
| V15 / a0ee18773f8e44bfa56b86b251a30b2c | V15-pasada-editor.bin · JPEG 390×3172 · 826e55d5ec17438ebdfdb7f3f1d5c4e3483eb1ea64ff944a8fec6d336d439750 | Etiqueta Texto ampliado sin medir200%, campana retirada. Cifras completas, pie mínimo y legibilidad/revisión pendiente; no prueba nativa. |

Archivos y recibo JSON íntegro: C:/Users/Lucas/.codex/visualizations/2026/10/09/ept95-editor-visual/recibo-pasada-independientes.json; cada entrada apunta al archivo absoluto. Capturas de edición en esa misma carpeta con sufijos pasada-editor.jpg/texto-corregido-editor.jpg. La superposición de guardado se documenta por recurso, sin usar fuerza ni generar otra pantalla.

M04 fuente externa M04-source.html: Outfit/Geist Mono, footer text-outline #727785, 14px sobre #FAFBFF; contraste4,33:1. Buena consistencia económica no elimina este hallazgo AA y no se promovió el candidato. Ninguno de los once JPEG se aceptó como PNG; originales activos íntegros. Revisión independiente del contenido nuevo todavía pendiente.

Lote congelado 09/10/2026, 22:47:20 ART para revisión independiente acotada. Recibo de los once incluye IDs completos, proyecto, formatos, hashes y dimensiones; los originales/activos permanecen íntegros. Fuentes exportadas V6-pasada-source.html:238, V9-pasada-source.html:279 y M08-pasada-source.html:360 conservan respectivamente ERR_SYNC, SERVER SYNC y el aviso histórico detrás del texto agregado; las imágenes también lo muestran. No se consideran resueltos.

La entrega manual del ZIP nativo es para inspeccionar su contenido y procedencia; no garantiza que contenga PNG aceptables ni resuelve los defectos de diseño. Revisar V3/V5/V10/V11/M08, estilos W06 y formatos del recibo antes de cualquier sustitución. No hubo otra ronda ni generación.

Checkpoint final: revisión independiente y prueba única Reload deV10/V11/M08 registradas en docs/evidence/EPT-95.md. Reload no cambió hashes/imágenes. V11 actual f41c9e6 sí muestra82.532,10 y ausencia de validación adicional: no confundir con su original previo; cifras partidas/JPEG siguen bloqueantes. Sin más generación ni edición y sin promociones de activos.
