# Informe de uso de IA, Parte 3 (EPT-127)

Estado: borrador de contenido verificable contra el repositorio y Jira al 09/11/2026. Todo lo afirmado se apoya en los registros del repositorio (cada afirmación cita su fuente) o en el estado de Jira. Lo que solo el equipo puede declarar figura en «Pendientes del equipo» y no se completó por inferencia. La bitácora unificada está en [`bitacora-unificada.md`](bitacora-unificada.md).

## 1. Resumen

La Parte 3 (aplicación Expo/React Native integrada con la plataforma web existente) se desarrolló con asistentes de IA, principalmente Claude (Claude Code, modelo Sonnet 5.5) bajo instrucciones de la persona responsable, Lucas Gimenez. También figuran Google Stitch dirigido por un asistente (EPT-95, abandonado por sus resultados) y Codex (mencionado en EPT-112). Los registros cubren 24 unidades de EPT-95 a EPT-121; EPT-105 y EPT-122 no tienen entrada de bitácora de IA.

Resultado observable: todo aporte registrado se ejecutó contra un stack local aislado o contra el entorno de CI antes de integrarse, hubo revisiones independientes de solo lectura en la mayoría de las unidades, y los errores de la IA que se detectaron quedaron escritos. La documentación no contiene aprobación docente y no se afirma ninguna.

## 2. Relación entre la aplicación móvil y la plataforma web

La app no tiene backend propio: reutiliza el de la web.

| Aspecto | Cómo se relacionan | Fuente |
|---|---|---|
| Datos y reglas | Misma base PostgreSQL/Supabase, mismas tablas económicas, RLS y funciones. Las lecturas móviles usan vistas con `security_invoker` y RPC con guarda de actor, con el JWT real del usuario; `service_role` nunca llega al dispositivo | EPT-107, EPT-110, EPT-114, `topologia.md` |
| Autenticación | La app inicia sesión contra Supabase Auth; la sesión se guarda cifrada en SecureStore (fragmentada). El backend web de Next valida cookies, por eso los endpoints que la app necesita aceptan además un Bearer que se autentica contra Auth (`getUser`), sin decodificar el token ni usar `user_metadata` | EPT-102, EPT-109, EPT-113 |
| Archivos privados | Carga de comprobantes en tres pasos (preparar, subir, finalizar) y recibos PDF por endpoint autenticado; el archivo original lo ve solo quien corresponde y el recibo es distinto del original | EPT-109, EPT-113, EPT-120 |
| Roles | El padre elige ítems y carga comprobantes; Dirección verifica en la web; el alumno solo consulta lo propio | EPT-108, EPT-111, EPT-119 |
| Consistencia | Un mismo pago se crea en la app, lo decide Dirección en la web y ambos canales lo reflejan: ciclo conectado probado en Android (emulador, mismo job que el backend) e iOS (backend en job Linux con túnel efímero hacia el simulador) | EPT-119, `topologia.md` |
| Diseño | Paleta institucional y copy en español heredados de la web; Outfit y Geist Mono | EPT-95, EPT-99 |

Límite declarado: una URL firmada ya emitida sigue vigente hasta vencer aunque cambie el bloqueo o el vínculo; Storage no impone TTL máximo (EPT-101, `registro-defectos.md`).

## 3. Cómo se usó la IA

Patrón registrado de forma repetida:

1. Un único escritor (asistente) implementa en un worktree propio, con stack aislado y fixtures sintéticos.
2. Los insumos se leen primero (Jira, contratos previos, esquema real, documentación oficial instalada) y se aplican precedencias: decisiones humanas, luego PDF, luego Jira, luego implementación (EPT-96, EPT-99).
3. Revisores independientes de solo lectura, en contexto fresco, inspeccionan el candidato (EPT-99, 100, 101, 102, 103, 104, 107, 110, 112, 113, 114, 116, 118).
4. Cada hallazgo se contrasta antes de corregir; tras corregir se repite la prueba.
5. Las decisiones de negocio y de riesgo las toma Lucas (EPT-100: semántica de coherencia, `isfinite`, política restrictiva; EPT-103: `FOR SHARE` y su tradeoff, decisión humana del 06/10/2026; EPT-95: abandonar Stitch, instrucción del usuario).

## 4. Bitácora vinculada a Jira

Cada fila de la bitácora unificada lleva el identificador de su tarjeta (EPT-95 a EPT-121) y la fuente del registro original. Las tarjetas padre agrupan subtareas (EPT-107 con EPT-135 a EPT-140, EPT-108 con EPT-141 a EPT-146, EPT-109 con EPT-147 a EPT-152, EPT-115 con EPT-160 a EPT-162). Estado Jira releído para esta tarjeta: dependencia EPT-89 (bitácora y Jira) en Listo; dependencia EPT-125 (presentación en testing del 11/11/2026) en Por hacer.

## 5. Comparación entre lo que propuso la IA y el conocimiento del sistema

Comparación basada en casos registrados; en cada uno el conocimiento del sistema vino de leer el esquema, los contratos, el SDK instalado o de ejecutar la prueba.

| Caso | Propuesta de la IA | Lo que dijo el sistema o la prueba | Decisión |
|---|---|---|---|
| EPT-95 | Google Stitch para generar mockups móviles | Salida en DESKTOP y un `screen.png` de 28 bytes | Decisión del usuario en el chat: cambiar a diseño local reproducible |
| EPT-102 | Variante del tutorial con AES propio más AsyncStorage | Inadecuado: criptografía casera | Fragmentación en SecureStore con manifiesto |
| EPT-103 | Comentario «acotada por `lock_timeout`» | La migración no lo contenía; la espera real dependía de los tiempos de la plataforma | Corregido y reproducido: 4 de 4 escrituras indebidas antes del arreglo |
| EPT-101 | Una afirmación sobre el TTL de las URLs firmadas | Falsa: Storage aceptó una firma de un año | Detectada por la revisión; el límite queda como recomendación |
| EPT-115 | Clasificar el error SMTP por comando | La prueba con SMTP real mostró que `CONN` engaña | Reemplazada por la fase observada |
| EPT-106 | Flujo de recuperación según lo conocido | El SDK instalado mostró que `sb_flow_id` es opcional y que el canje descarta el verificador aunque falle la red | Diseño ajustado al SDK real |
| EPT-107 | Sembrar fixtures por SQL | `service_role` no tiene INSERT sobre facturas | Lecturas con JWT real |
| EPT-114 | Forzar igualdad con RF19 y una tabla de deuda materializada | RF19 selecciona otro universo; la tabla es innecesaria | Descartadas |
| EPT-119 | Selectores de texto exacto | iOS expone etiquetas distintas («Estado: ...», nombre abreviado) | Patrones por plataforma; documentado que son más laxos |

## 6. Qué se aceptó, adaptó y rechazó

* **Aceptado con comprobación:** migraciones, RPC, suites y pantallas, siempre tras ejecutar las pruebas sobre un stack aislado (EPT-100, 107, 108, 110).
* **Adaptado:** contratos de componentes (EPT-99), tipos y parsers del límite SQL a móvil (EPT-113: texto decimal validado con BigInt antes de convertir), selectores por plataforma (EPT-119), cadencia de desplazamiento en Maestro (EPT-113).
* **Rechazado:** Stitch como método (EPT-95), criptografía propia (EPT-102), flujo implícito y tabla propia de contraseñas (EPT-106), multipart por Next y estado «validado» enviado por el cliente (EPT-109), exactly-once (EPT-115), vista nueva y tabla de deuda materializada (EPT-114), prorrateos y snapshots persistidos (EPT-112), inflar plazos de CI sin medición (EPT-121).

## 7. Errores o afirmaciones incorrectas detectados

Solo se listan los registrados. No se hace un recuento global de «alucinaciones»: ninguna fuente lo mide.

| Unidad | Qué estaba mal | Quién o qué lo detectó |
|---|---|---|
| EPT-101 | Afirmación falsa sobre el TTL; una expresión regular borró `const IDS = {` en una suite | Revisión independiente; lint |
| EPT-103 | Afirmación sobre `lock_timeout` ausente de la migración; la autorización se leía sin bloqueo y escribía tras perderse (4 de 4 casos); pruebas propias con errores (referencia ocupada, escape de Python, comprobación de `pg_blocking_pids`) | Revisión y reproducción con conexiones reales; la corrección fue una decisión humana aprobada el 06/10/2026 |
| EPT-100 | El comentario de `facturas_items.sql` sobreestimaba la protección de coherencia (H1); `infinity` pasaba los CHECK por NULL (H2) | Revisión independiente; reproducido también por el autor |
| EPT-99 | Hallazgos de reglas inventadas y de fidelidad técnica: 2 bloqueantes, 14 importantes y 13 menores en total | Dos revisores de solo lectura contra el HTML/CSS y el prototipo |
| EPT-102 | Condiciones del gate de CI encadenadas con `&&` bajo `bash -e` (bloqueante); `expo-doctor` no instalado; build iOS sin entitlement de llavero | Revisión independiente; logs de CI |
| EPT-107 | Aserción Maestro exacta frente a la etiqueta accesible; GRANT inútil; detalle abierto tras cambiar de alumno; ids sin validar | Revisión de solo lectura |
| EPT-112 | Filtros aplicados que desaparecían si fallaba el catálogo (P2) | Revisión independiente |
| EPT-113 | Menú nativo abierto después de 60 s dejaba el botón cargando (P2); fallos de columnas RPC, transferencia de ArrayBuffer y fixtures heredados | Revisión; pruebas |
| EPT-115 | Clasificación del error por comando de SMTP | Prueba con SMTP real |
| EPT-116 | Una factura inconsistente salía del universo y ocultaba deuda (importante); plan con tope de 5 s | Revisión independiente |
| EPT-119 a 121 | Prueba del gate que fallaba en Windows por derivar mal la ruta de `bash` (H-01); comentario de endpoint desactualizado (D-01); revalidación de acceso que desmontaba la vista (P-01), cuyo efecto en iOS no se demostró | `registro-defectos.md`: cada defecto se reprodujo antes de corregirlo |

## 8. Verificación humana

* **Decisiones humanas registradas con fecha:** EPT-100 (Lucas, 05/10/2026), EPT-103 (06/10/2026), EPT-95 (10/10/2026: cambio de método, instrucción del usuario), autorizaciones de `size:exception` (EPT-112, EPT-113), túnel efímero para iOS (EPT-119).
* **Comprobación ejecutable:** las fuentes distinguen lo ejecutado de lo declarado; por ejemplo, EPT-104 deja escrito que «ninguna memoria, resumen o llamada enviada equivale a resultado de prueba».
* **No registrado:** la comprensión personal de cada integrante sobre el código de cada tarjeta. Las fuentes registran análisis técnico observable y decisiones, y varias lo dicen expresamente («no se inventa comprensión, aprobación humana ni aprobación docente», EPT-111, EPT-112, EPT-114).

## 9. Modificaciones y resultados

Producto de la Parte 3 integrado en `main` mediante pull requests revisados: EPT-95 (#53), EPT-96 (#54), EPT-99 (#55), EPT-102 (#56), EPT-105 (#57), EPT-107 (#58), EPT-108 (#59), EPT-109 (#61, #62), EPT-106 (#63), EPT-110 (#64), EPT-111 (#65), EPT-112 (#66), EPT-113 (#67), EPT-114 (#68), EPT-115 (#69), EPT-116 (#70), EPT-117 (#71), EPT-118 (#72), EPT-119 a EPT-121 (#73), EPT-122 (#82). EPT-100 (#42) y EPT-103 (#46) y EPT-104 (#49) cierran el esquema, las tarifas y la facturación mensual.

Resultados medibles registrados: 507 comprobaciones de esquema (EPT-100), 44 casos y 955 comprobaciones de la matriz de acceso con mutaciones que llevan la suite de 0 a 15 casos en fallo (EPT-120), 46 comprobaciones SQL de períodos (EPT-110), run 41351770905 verde en Android e iOS (EPT-119).

Abiertos al cierre de la campaña de validación: P-02 (en iOS, el selector de fotos del sistema a veces no entrega el archivo; causa no demostrada, afectó a cerca de la mitad de los runs) e I-02 (`statement_timeout` intermitente en un caso de carga grande de reportes).

## 10. Reflexión crítica

* La IA aceleró la lectura de contexto, el volumen de pruebas y la escritura de contratos, pero sus errores más costosos fueron afirmaciones plausibles sobre el comportamiento del sistema (TTL, `lock_timeout`, clasificación de errores, reglas de diseño). Se detectaron porque había una prueba ejecutable o un revisor que las contrastó; sin esa puerta habrían quedado integradas.
* Una prueba verde no es una causa demostrada: EPT-121 lo aplica a las intermitencias nativas y deja P-02 abierto en lugar de atribuirlo.
* Los revisores independientes también son IA. Detectan clases de error distintas del escritor, pero su independencia es de contexto, no de criterio humano.
* La bitácora se escribió de forma desigual: las unidades de Parte 3 tardías la llevan en tablas con el formato exigido, y las primeras (EPT-100, 101, 103, 104) la llevan narrativa y sin prompt. Esto limita la reconstrucción de quién pidió qué.

## 11. Riesgos y límites

* Los prompts literales no se conservan; solo su descripción.
* No se ejercitaron cámara, TalkBack, VoiceOver ni teléfono físico (EPT-115, `registro-defectos.md`).
* No hay aprobación docente registrada en ninguna fuente.
* Las URLs firmadas ya emitidas no se revocan de inmediato.
* La bitácora se consolidó a partir de lo escrito; si hubo aportes que nunca se registraron, este informe no puede detectarlos.

## 12. Pendientes del equipo

| Tema | Qué falta y quién puede decidirlo |
|---|---|
| EPT-105 y EPT-122 | Confirmar si hubo aporte de IA y, de haberlo, registrarlo. No se inventó entrada. |
| Formato de entrega del 17/11 | Jira no define si el informe se entrega como este archivo, en PDF o en otro formato; lo define el equipo o la cátedra. |
| Aprobación docente | No existe registro; solo la cátedra puede otorgarla. |
| Comprensión individual y horas | Cada integrante debe declarar lo que comprendió y revisó; las horas no están registradas (el seguimiento temporal no existe en este proyecto Jira). |
| Prompts literales | Si el equipo los conserva fuera del repositorio, pueden anexarse. |
| EPT-125 | La presentación en testing (11/11/2026) sigue en Por hacer; sus hallazgos, si usó IA, deberán sumarse. |

## 13. Trazabilidad con los criterios de aceptación de EPT-127

| Criterio | Estado | Dónde |
|---|---|---|
| Informe con relación web-móvil | Cumplido | §2 |
| Bitácora vinculada a Jira | Cumplido | `bitacora-unificada.md`, §4 |
| Comparación IA vs conocimiento del sistema | Cumplido | §5 |
| Modificaciones y resultados | Cumplido | §6, §9 |
| Reflexión crítica | Cumplido | §10 |
| Aportes registrados antes de integración | Parcial: 24 unidades tienen registro en el repositorio integrado (no se auditó, por unidad, el orden entre el registro y la integración); EPT-105 y EPT-122 no tienen registro | `bitacora-unificada.md` «Huecos», §12 |
