# EPT-109 · Carga de comprobantes de transferencia (HU9)

Cubre la historia EPT-109 y sus subtareas EPT-147 a EPT-152. La evidencia (matriz de trazabilidad, comandos,
resultados y límites) está en [`docs/evidence/EPT-109.md`](../../evidence/EPT-109.md).

## Alcance

1. **Bucket privado y políticas por padre (EPT-147).** El bucket final `comprobantes-pago` (EPT-101) se
   conserva sin cambios. Se agrega `comprobantes-pago-temporal`, también privado, con una única política de
   `INSERT` atada a una carga propia preparada.
2. **Cámara, galería y PDF (EPT-148).** Selección en la app Expo/React Native con permisos, cancelación y
   dispositivo sin cámara.
3. **Tipo y tamaño (EPT-149).** JPEG, PNG y PDF de hasta 5 MiB (5.242.880 bytes). Se valida en la
   interfaz, en la base, en el servicio de Storage y, sobre el contenido real, en el servidor.
4. **Fecha, importe y número de operación (EPT-150).** Se registran una sola vez, junto con el primer
   comprobante. El importe informado puede diferir del total calculado.
5. **Varios comprobantes por pago (EPT-151).** El comprobante se asocia al pago; las facturas se relacionan
   por las imputaciones de ese pago (un pago puede cubrir varias facturas del mismo hijo).
6. **Prueba de extremo a extremo (EPT-152).** Ver la evidencia: integración real con Auth, PostgREST,
   Storage y el servidor Next, y un flujo Maestro en Android.

### Fuera de alcance (otras tarjetas)

- Aprobar, rechazar, emitir recibos o enviar correos (EPT-111). El pago sigue `PENDIENTE_VERIFICACION`, los
  ítems `EN_VERIFICACION` y el saldo no cambia.
- Consulta de inscripciones y facturas por período (EPT-110) y la épica EPT-73.
- Editar fecha, importe o número ya informados, o reemplazar o borrar un comprobante.
- Antivirus. La validación comprueba estructura y consistencia del formato; **no afirma que el archivo sea
  inocuo**.
- Captura con la cámara en CI (el emulador no tiene cámara) e instalación en el teléfono personal.

## Por qué un protocolo de varios pasos

PostgreSQL y Storage no forman una transacción, y el cuerpo de una función de Vercel está limitado a
4,5 MB, menos que los 5 MiB aprobados. Por eso el archivo no viaja por una ruta de Next ni se valida en SQL:

```
 App (JWT del padre)                Storage                 Servidor Next (service_role)        PostgreSQL
 ───────────────────                ───────                 ────────────────────────────        ──────────
 1 preparar_carga_comprobante ───────────────────────────────────────────────────────────────▶ carga PREPARADA
 2 POST objeto (ruta temporal) ───▶ bucket temporal
 3 POST /api/comprobantes/cargas/{id}/finalizacion (Bearer) ─▶ autentica el token contra Auth
                                    ◀── lee los bytes ───────  valida el CONTENIDO real
                                    ◀── publica ESOS bytes ──  (upsert desactivado)
                                                               confirmar_carga_comprobante ──▶ pago + comprobante
                                                                                              (una transacción)
 4 respuesta (o consultar_carga_comprobante ante un corte)
```

- **El cliente nunca declara «validado».** `confirmar_carga_comprobante`, `obtener_carga_para_finalizar`,
  `descartar_carga_comprobante` y las funciones de conciliación solo las ejecuta `service_role`. Ni un
  booleano ni un hash viajan desde la app: el SHA-256 lo calcula el servidor sobre los bytes que leyó.
- **El objeto no se puede reemplazar entre validación y confirmación.** No hay política de `UPDATE`,
  `DELETE` ni lectura sobre el bucket temporal y la subida usa `x-upsert: false`. Además el servidor publica
  desde memoria los bytes que validó, no copia el objeto: lo publicado es exactamente lo validado.
- **Un comprobante existe solo como fila de `comprobantes_pago`**, que únicamente crea la confirmación SQL
  después de que el archivo se publicó y se validó.

## Contrato de base de datos (migración `20261016120000_ept_109_carga_comprobantes.sql`)

| Operación | Efecto | Quién |
|---|---|---|
| `preparar_carga_comprobante(clave, pago, fecha, importe, numero, mime, tamano)` | valida actor, pago, tipo, tamaño y datos; registra la carga y devuelve la ruta temporal; no toca el pago | PADRE habilitado (JWT) |
| `consultar_carga_comprobante(clave)` | resultado durable de una carga propia; no escribe | PADRE habilitado (JWT) |
| `obtener_carga_para_finalizar(usuario, carga)` | revalida identidad y propiedad; datos para finalizar | `service_role` |
| `confirmar_carga_comprobante(usuario, carga, sha256, tamano, mime)` | registra datos de la transferencia (solo la primera vez) y el comprobante, en una transacción | `service_role` |
| `descartar_carga_comprobante(usuario, carga, motivo)` | cierra una carga PREPARADA por una causa comprobada fuera de SQL | `service_role` |
| `cargas_comprobante_a_conciliar` / `marcar_temporal_eliminado` | vence cargas sin finalizar y lista objetos a retirar | `service_role` |

La tabla `cargas_comprobante` está cerrada para los roles de aplicación (RLS, sin grants).

### Datos de la transferencia

- **Importe:** llega como **texto** y se valida antes de cualquier cast: `^[0-9]{1,10}(\.[0-9]{1,2})?$`.
  Un tercer decimal se rechaza, no se redondea (el contrato existente es `NUMERIC(12,2) >= 0`).
- **Fecha:** `AAAA-MM-DD` real. **No** se prohíben fechas futuras: no hay una regla aprobada.
- **Número de operación:** texto no vacío con la normalización existente (recorte de espacios, tabulaciones y
  saltos de línea; **sin tocar mayúsculas**). No se impone el «alfanumérico de hasta 30 caracteres» del
  prototipo. El único tope es técnico (ver «Decisiones pendientes»).
- **Unicidad:** la autoridad es el índice único parcial de EPT-100 (`idx_pagos_operacion_no_rechazada`),
  que se conserva. La preparación solo da un aviso temprano.
- **Un pago con datos ya informados** no los vuelve a pedir: una carga adicional los hereda. Si el cliente
  los reenvía y **difieren**, es un conflicto explícito (P6865), nunca una sobrescritura. Si son iguales, no
  es un falso duplicado.

### Orden de bloqueos

El de EPT-103/108, más el pago y la carga: (1) perfil del actor `FOR SHARE`, (2) consultivo de la carga,
(3) vínculo padre-hijo `FOR SHARE`, (4) pago `FOR UPDATE`, (5) carga `FOR UPDATE`. Una revocación (bloqueo,
cambio de rol, vínculo) o un rechazo del pago solo puede resolverse de dos modos seriales: confirma antes
(la confirmación espera y se rechaza sin escribir) o la confirmación toma la guarda primero (la revocación
espera su COMMIT). Lo prueba `comprobantes_concurrencia.mjs` con `pg_blocking_pids`.

### Idempotencia

`(padre_id, clave_carga)` es único. Misma clave y mismos datos: el mismo resultado (`repetido = true`).
Misma clave con otro pago, otro archivo declarado u otros datos: **P6864**, sin escribir. Confirmar dos
veces la misma carga devuelve el mismo comprobante; confirmarla con otro hash es un conflicto.

### Códigos SQLSTATE propios

| Código | Significado |
|---|---|
| P6860 | datos inválidos o ausentes (tipo, tamaño, fecha, importe, número) |
| P6861 | el pago no existe o no está disponible para la cuenta (ajeno e inexistente: el mismo error) |
| P6862 | el pago ya no está pendiente de verificación |
| P6863 | el número de operación ya está registrado en otro pago |
| P6864 | la clave de carga ya se usó con otros datos |
| P6865 | los datos difieren de los ya informados para el pago |
| P6866 | la carga no existe, venció o fue descartada |
| P6868 | demasiadas cargas sin completar (tope técnico de 10 por padre; las propias abandonadas hace más de una hora se vencen en el acto al alcanzarlo) |
| 42501 / P5505 | identidad no habilitada / sin identidad |

Los códigos de base no salen por la API de Next: allí se traducen a códigos de dominio.

## Validación del contenido (servidor)

`src/services/comprobantes-validacion.ts`, sobre los bytes leídos del objeto temporal:

| Formato | Qué se comprueba |
|---|---|
| JPEG | firma; decodificación completa con libvips (`sharp`, `failOn: warning`) con tope de 40 MP |
| PNG | firma; cada chunk con su CRC, `IHDR` válido, `IDAT`, `IEND` sin bytes finales; decodificación completa |
| PDF | cabecera `%PDF-`; `startxref` + `%%EOF` apuntando a una tabla `xref` u objeto real; apertura con pdf.js (sin evaluar código), al menos una página, sin cifrado, sin JavaScript ni archivos incrustados |

Se rechaza además: archivo vacío, un byte sobre 5 MiB, contenido que no es ninguno de los tres (HTML, SVG,
GIF, ZIP…), tipo declarado contradictorio con el contenido y tamaño declarado distinto del real.

**Límites honestos.** No es un antivirus. La búsqueda de contenido activo en un PDF recorre el texto del
archivo y el contenido de sus flujos Flate (los PDF 1.5 guardan diccionarios en flujos comprimidos), con los
nombres `#XX` decodificados, y rechaza una expansión desmedida (16 MiB por flujo, 48 MiB en total). No cubre
otros filtros (ASCIIHex, LZW), flujos cifrados ni acciones fuera de esos cuatro nombres. El control de CPU se
limita al tope de píxeles y a 10 s para abrir un PDF; no hay aislamiento de proceso.

## Consistencia SQL ↔ Storage y recuperación

No hay atomicidad entre ambos: el protocolo la reemplaza por **orden de pasos + estado durable +
conciliación**.

| Dónde se corta | Estado durable | Qué ocurre después |
|---|---|---|
| tras preparar, sin subir | carga PREPARADA, sin objeto | finalizar responde 409 «archivo no subido»; el cliente puede subir y repetir |
| subida a medias o respuesta de subida perdida | PREPARADA, objeto quizá presente | finalizar lee el objeto: si existe lo valida; si no, 409 |
| contenido inválido | carga DESCARTADA | se retira el temporal; nunca se publica |
| tras publicar y antes de confirmar | PREPARADA + objeto final huérfano | repetir finalizar retoma: el objeto final se verifica byte a byte y se confirma |
| confirmación con respuesta perdida | CONFIRMADA o PREPARADA (desconocido) | **no se borra nada**; el cliente consulta la carga y, si sigue PREPARADA, vuelve a finalizar |
| descarte de negocio (pago ya no pendiente, número duplicado, vínculo revocado) | DESCARTADA | se retiran el objeto final huérfano y el temporal |
| nadie finaliza | PREPARADA > 24 h | la conciliación la vence (EXPIRADA) y retira sus objetos |

La conciliación (`POST /api/comprobantes/conciliacion`, con `CRON_SECRET`, **sin programar**) nunca lista el
objeto final de una carga CONFIRMADA ni de una con fila en `comprobantes_pago`, no toca pagos ni ítems y es
idempotente.

## Permisos

- Solo el **padre** habilitado, vinculado hoy al hijo y creador del pago adjunta archivos a ese pago pendiente.
- El original lo ven **el padre cargador y DIRECTOR**. Otro padre vinculado, ESTUDIANTE, DOCENTE y PERSONAL
  solo acceden al registro saneado (`resumen_comprobantes_pago`: cantidad y fecha, sin ruta, URL ni binario).
- El archivo se entrega con una **URL firmada de 60 s** emitida con las credenciales de quien descarga.
  Una URL ya emitida **sigue sirviendo hasta que vence** aunque la cuenta se bloquee después: Storage no
  ofrece revocación instantánea ni impone un TTL máximo (verificado en `economico_storage.mjs`).
- El Bearer se **autentica contra Auth** (`getUser`), no se decodifica. Nada se autoriza con `user_metadata`.

## Aplicación móvil

Flujo: **Cuotas → Comprobantes de mis pagos** (o **Adjuntar comprobante** tras registrar un pago) → elegir
archivo → datos → **Enviar comprobante** → «Comprobante recibido: pendiente de verificación».

| Pieza | Archivo |
|---|---|
| Contrato compartido con el servidor (tipos, 5 MiB, importe, fecha, número) | `src/lib/comprobantes-contrato.ts` → `mobile/src/compartido/comprobantes-contrato.ts` |
| RPC, finalización, análisis estricto de respuestas | `mobile/src/servicios/comprobantes.ts` |
| Cámara, galería y archivos (validación previa por firma) | `mobile/src/servicios/selector-archivos.ts` |
| Subida binaria con progreso | `mobile/src/servicios/subida-archivo.ts` |
| Recuperación de una carga incierta (solo identificadores) | `mobile/src/servicios/carga-pendiente.ts` |
| Contenedor y vistas | `mobile/src/contenedores/comprobantes/` |

Reglas del contenedor: un solo envío en vuelo (doble toque); un desenlace incierto **no habilita reenviar**
hasta consultar la carga; un archivo distinto invalida la clave anterior; el estado vive en el contexto de la
pantalla y sobrevive a la revalidación de la sesión (garantía de EPT-108); una respuesta atrasada nunca se
aplica a otro hijo ni a otra cuenta; no se persisten binarios ni rutas, y el archivo elegido es una copia en
la caché de la aplicación (el original del usuario no se toca ni se borra). Las imágenes de la cámara y de la
galería se **reducen y recodifican a JPEG** antes de validarse (lado mayor de 2400 px, calidad 0,8): una foto
de un iPhone (HEIC de 12 MP o más) puede pasar los 5 MiB aprobados, y la recodificación además descarta los
metadatos EXIF, ubicación incluida. Un PNG o JPEG elegido desde Archivos solo se recodifica si supera el
máximo; un PDF nunca se toca (si pasa de 5 MiB se rechaza). El decodificador nativo es quien confirma que lo
elegido es una imagen; el servidor valida igualmente los bytes que recibe.

## Lectura web para Dirección

`/dashboard/comprobantes` (solo DIRECTOR): lista los pagos pendientes con importe informado, total
calculado (marca «Distinto del total calculado»), fecha, número de operación y los archivos, y descarga el
original por URL firmada. **No aprueba ni rechaza.**

## Decisiones pendientes de confirmación humana

No están en las decisiones aprobadas; se tomaron como mínimo técnico y deben ratificarse o corregirse:

1. **Tope técnico de 10 cargas sin completar por padre.** No limita comprobantes confirmados (no hay máximo
   de archivos por pago); evita acumular objetos temporales de 5 MiB sin límite. El conteo se serializa por
   padre y, al alcanzarlo, las cargas propias abandonadas hace más de una hora se vencen en el acto: una app
   cerrada no deja al padre bloqueado hasta la próxima conciliación.
2. **Vencimiento de 24 h de una carga sin finalizar** (solo del intento y su objeto temporal; no de pagos).
3. **Tope técnico de 2000 bytes del número de operación**, derivado del límite de las entradas del índice
   único. No es una regla comercial.
4. **PDF con JavaScript o archivos incrustados se rechazan** (criterio de seguridad, no de negocio).
5. **El mismo archivo puede adjuntarse dos veces** a un pago con claves distintas: no hay deduplicación
   porque no hay una regla aprobada. La clave de carga evita el duplicado por doble toque o reintento.
6. **Un importe informado de 0 y una fecha futura se aceptan**, conforme al contrato existente.

## Reversión

La migración es **aditiva**: una tabla (`cargas_comprobante`), un bucket, una política de `INSERT`, una
política restrictiva y funciones nuevas; no altera tablas de EPT-100/101/108. Revertirla es retirar esos
objetos (los comprobantes ya registrados en `comprobantes_pago` y sus objetos finales se conservan). La
aplicación móvil sin la ruta de finalización muestra el envío como incierto y no pierde datos. Un servidor
sin `sharp` o `unpdf` responde 503 «resultado incierto» sin registrar nada.

## Bitácora de IA

| Campo | Registro |
|---|---|
| Tarjetas | EPT-109, EPT-147, EPT-148, EPT-149, EPT-150, EPT-151, EPT-152 |
| Problema | cargar comprobantes de hasta 5 MiB sin superar el límite de 4,5 MB de las funciones de Vercel, validando el contenido real, sin exponer `service_role` y sin una transacción entre Storage y PostgreSQL |
| Prompt | encargo completo de la historia con el contrato funcional aprobado, las decisiones EPT-80/EPT-84 y las restricciones de seguridad |
| Respuesta | protocolo preparar → subir → finalizar con funciones solo de `service_role`, validación por estructura real, conciliación y flujo móvil |
| Comprensión y adaptación | se leyeron las migraciones EPT-100/101/108, el contrato de Storage y los arneses de prueba; se descartó el multipart por Next (límite de payload), el estado «validado» enviado por el cliente y la copia de objeto entre buckets (se publica lo validado); los topes técnicos se declararon como pendientes de decisión |
| Prueba | suites SQL/API/Storage reales, concurrencia con `pg_blocking_pids`, pruebas de componente y de adaptador, mutaciones focales, integración Android (ver la evidencia) |
| Resultado | ver `docs/evidence/EPT-109.md`. **No hay aprobación docente registrada ni inventada.** |
