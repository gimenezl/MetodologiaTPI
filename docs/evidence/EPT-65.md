# EPT-65 — RF21: Registrar accesos con QR

**Estado al 01/10/2026: candidato local, `blocked` para dos criterios.** El contrato aprobado está implementado y probado en las tres fronteras (base, servidor y navegador) sobre un stack local descartable. No se hizo push, PR, merge, despliegue ni cambio alguno en producción, y EPT-65 **no se transicionó** en Jira. Quedan dos puntos que este candidato no puede cerrar solo y que se informan sin disimulo:

1. **Prueba de cámara en dispositivos reales (Android Chrome e iPhone Safari): NO realizada.** No hay un teléfono disponible en este entorno. La lectura por cámara se probó con el dispositivo de video falso de Chromium (lee un QR real firmado, registra y suelta las pistas) y los estados de permiso se probaron con simulaciones en Chromium y WebKit; **eso no equivale a un teléfono**. La sección 11 trae el procedimiento y la tabla a completar.
2. **Responsable institucional y primera fecha de purga: SIN DEFINIR.** Son un gate previo al despliegue. Este informe no inventa nombres ni fechas ni afirma cumplimiento legal (sección 15).

| Dato | Valor |
|---|---|
| Rama / worktree | `codex/ept-65-accesos-qr` en `E:\Escritorio\codigo\MetodologiaTPI-ept65` (el checkout principal no se tocó) |
| Base | `origin/main` = `d4fa26f5bd0e76c1418822f6446c899b957c5b59` (verificado con `git fetch origin --prune`; coincide con el SHA informado por el orquestador) |
| Código y pruebas verificados | `[[SHA_FINAL]]` (ver sección 12). El commit posterior solo agrega esta documentación y las capturas |
| Jira | EPT-65 «Por hacer», asignada a Lucas Gimenez, hija de EPT-7, sin subtareas (consultado en vivo). EPT-64 «Listo». No se modificó ninguna issue |
| Migración | `supabase/migrations/20261001012522_ept_65_registro_accesos_qr.sql` (aditiva; creada con `supabase migration new`; la última anterior es `20260929224534`) |
| Entorno de prueba | Supabase local aislado (`project_id = ept65`, puertos 574xx, contenedor `supabase_db_ept65`), Next 16.3.3, `qr` 0.7.2 |

## 1. Resumen ejecutivo

Un operador autenticado (Dirección o Personal, cada uno con su propia cuenta) elige el servicio que controla —comedor, o un recorrido de transporte con su sentido— y lee el QR de la credencial del alumno con la cámara o con una fotografía. **Solo el texto íntegro del QR viaja al servidor.** El servidor verifica formato, versión, `kid` y firma HMAC con una clave que la base nunca ve; **solo con firma válida** invoca la única operación de PostgreSQL que registra un acceso, con un cliente administrativo (`service_role`) que no hereda el token del usuario. PostgreSQL revalida en cada ejecución que el actor sea DIRECTOR o PERSONAL con acceso habilitado, bloquea alumno, credencial, perfil, servicio e inscripción en el orden del dominio, relee todo tras esperar, aplica las reglas de comedor y transporte y devuelve un resultado cerrado.

Lo que **no** se puede hacer, probado con sesiones reales: registrar un acceso conociendo solo un `credencial_id` (ni Dirección ni Personal, por la API, por la RPC pública, por la privada ni escribiendo la tabla); leer eventos o denegaciones como Personal; leer la tabla como cualquiera; ejecutar el mantenimiento de retención desde un rol de aplicación.

Aportes sobre el contrato: auditoría paginada y filtrable de solo lectura para Dirección, anulación con motivo que **libera el cupo del día sin borrar la historia**, límite de intentos atómico por cuenta operadora, idempotencia por `intento_id` ligada al operador, retención con anonimización y un mantenimiento cerrado a todo rol de aplicación y auditado.

## 2. Fuentes, línea base y contradicciones

| Fuente | Resultado |
|---|---|
| Git | `origin/main` `d4fa26f…`, 25 migraciones, la última `20260929224534_ept_64_credencial_qr.sql`. El checkout principal está atrasado y con cambios ajenos (`AGENTS.md`, `.atl/`, `.claude/`, `docs/`): se preservaron íntegros y se trabajó en un worktree limpio nuevo |
| Jira (en vivo) | EPT-64 «Listo»; EPT-65 «Por hacer», de Lucas Gimenez, hija de EPT-7, sin subtareas; descripción: «Identificar al alumno mediante el código QR y registrar el uso del comedor o del transporte. Ventana 12/10 al 16/10.» El informe de auditoría que decía que EPT-64 seguía «En curso» quedó desactualizado |
| Contrato | Aprobado por Lucas en el pedido de esta tarea. **Ninguna contradicción material** con el código ni con la base: no hubo que detener ninguna parte |
| `docs/orchestration/` | Contexto histórico: no se usó su SHA, sus estados de Jira ni sus defectos como hechos actuales. Next es 16.3.3 (no 16.2.5) |
| Next 16.3.3 | Se leyeron las guías locales de `node_modules/next/dist/docs/` antes de escribir código: Route Handlers (`15-route-handlers.md`: solo se cachea `GET` con opción explícita; 405 para métodos no exportados) y `headers` (la última regla gana cuando dos fijan el mismo encabezado) |
| `qr` 0.7.2 | Exports reales: `.`, `./decode.js`, `./dom.js`. Se usan `decodeQR` y `encodeQR`; **no** se usa `dom.js` (la cámara se maneja a mano para controlar permiso, tiempo máximo y liberación de pistas) ni `BarcodeDetector` |
| Auditoría del contrato (memoria de sesión) | Confirmada: una RPC abierta a `authenticated` que reciba un identificador es un bypass del escaneo. Es el diseño que se evitó |

Contradicciones de entorno (no de producto): el **puerto 3000 estaba ocupado por un proceso ajeno** (`node codigo.js`, PID 29388, iniciado ese día; no es esta aplicación) que respondía 200. Playwright con `reuseExistingServer` lo habría tomado por esta aplicación. No se lo tocó: se agregó `EPT_PUERTO_APP` / `EPT_BASE_URL` a `playwright.config.ts` y las 19 suites que fijaban `localhost:3000` leen ahora la URL base del entorno (el valor por defecto no cambia).

## 3. Contrato aprobado y decisiones

Los 17 puntos del contrato están implementados. Las decisiones que el contrato dejaba a criterio:

1. **Interfaz de lectura sin tabla.** Ningún rol de aplicación tiene privilegio alguno sobre las tablas (ni `SELECT`). Dirección lee por `listar_accesos_servicios` (solo lectura, paginada a 25, tope 100, filtros por día de Buenos Aires, resultado y servicio) y anula por `anular_acceso_servicio`; ambas revalidan `auth.uid()` y el rol DIRECTOR habilitado dentro de la base.
2. **Resultado cerrado.** `REGISTRADO`, `YA_REGISTRADO`, `NO_HABILITADO`, `NO_RECONOCIDO`, más `INTENTO_REUTILIZADO` (409) para el reuso de un intento con otros argumentos, exigido por el punto 10. `LIMITE_EXCEDIDO` es el código del 429. Solo `REGISTRADO` lleva nombre, apellido y legajo; el texto en pantalla de todo resultado sale **del catálogo local** y nunca de la red.
3. **Anulación libera el cupo.** El cupo diario cuenta solo eventos REGISTRADO **sin** fila de anulación. Probado en SQL, concurrencia, API y pantalla.
4. **Un acceso por día = serialización, no índice.** Un índice único parcial no puede mirar otra tabla (las anulaciones). La garantía es el bloqueo `alumnos FOR NO KEY UPDATE` que toman el registro, la anulación y el trigger de la tabla, más la comprobación en el trigger (defensa aun contra el propietario). Lo prueban 6 escaneos simultáneos del mismo alumno (1 REGISTRADO y 5 YA_REGISTRADO) y el estrés.
5. **Día de Buenos Aires.** `dia_servicio` es una columna generada `(registrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')::date` (la conversión sobre `timestamptz` es inmutable). 02:30 UTC del 10/03 pertenece al 09/03.
6. **Hora sellada con `clock_timestamp()`** (no `now()`): refleja el instante real, tras esperar los bloqueos. Un trigger la reescribe, de modo que ni el propietario retrocede un evento. Ninguna prueba infiere el orden de commits comparando `now()` de transacciones.
7. **Servicio y recorrido por identificador de catálogo.** El operador elige entre los servicios activos de `servicios_escolares` (legibles por toda sesión autenticada); la base valida que el sentido sea obligatorio en transporte y ausente en comedor (`P5653`) y que el servicio exista (`P5652`).
8. **Límite en base, atómico.** Un advisory lock por operador (`65001`) serializa conteo e inserción. Los valores —**60 solicitudes en 5 minutos, 10 inválidos en 10 minutos, bloqueo de 15 minutos— son de partida, NO medidos en producción** y viven en una sola función (`app_private.parametros_limite_escaneo()`): ver sección 16.
9. **`p_actor_user_id` (excepción a EPT-64).** EPT-64 deriva el actor de `auth.uid()`. Acá el invocador es `service_role`, cuyo `auth.uid()` es nulo, así que el actor llega como argumento. Se compensa en dos puntos: el servidor lo obtiene de la **sesión verificada** (nunca del cuerpo; el esquema es estricto y no tiene dónde ponerlo) y PostgreSQL lo **revalida en cada ejecución** bajo `FOR SHARE` de la fila del perfil (rol DIRECTOR o PERSONAL y acceso HABILITADO). La garantía de la firma vive en la frontera servidor → base porque la base no conoce la clave HMAC.
10. **Origen de la petición.** El repositorio no tenía comprobación de `Origin` para rutas con cookies (se apoyaba en `SameSite=Lax`). Las dos rutas nuevas agregan `origenPermitido` (Origin debe coincidir con el host; sin Origin decide `Sec-Fetch-Site`; sin ninguno se admite, porque un cliente que no es un navegador no tiene una cookie ajena que abusar) y exigen `Content-Type: application/json`. No se tocaron las demás rutas.
11. **Política de cámara.** `Permissions-Policy: camera=(), microphone=(), geolocation=()` en todo el sitio y `camera=(self), …` solo en `/dashboard/accesos` (`next.config.ts`, la regla específica va después de la general).

## 4. Matriz criterio → frontera → archivo → prueba → resultado

| # | Criterio del contrato | Frontera de seguridad | Implementación | Prueba | Resultado |
|---|---|---|---|---|---|
| 1 | Solo DIRECTOR/PERSONAL habilitados, cada uno con su cuenta | base (`operador_de_escaneo`) + servidor (`requerirSesionConRol`) | migración §9.1; `registro/route.ts` | SQL B1–B9, I14–I19; `accesos-qr-auth` (todos los actores y bloqueados) | Cumplido |
| 2 | Firma HMAC verificada **antes** de consultar la credencial | servidor | `accesos-qr.service.ts` (`registrarEscaneo`) | `accesos-qr-servicio` (8 payloads inválidos → solo el contador de inválidos) | Cumplido |
| 3 | Clave solo en el servidor; falla cerrado | servidor | `credenciales-qr/claves.ts` (reutilizado) | servicio (sin/ con clave inválida → 503, sin fetch); `auth` (la clave no aparece en HTML ni respuestas) | Cumplido |
| 4 | Operación solo `service_role`; sin DML directo; RLS | base | migración §8, §14 | SQL A1–A5, J1–J10; `auth` (ataque directo) | Cumplido |
| 5 | Actor de la sesión verificada; revalidado en la base | servidor + base | `registro/route.ts`; `operador_de_escaneo` | SQL B5–B7; servicio (el cuerpo de la RPC lleva el actor de la sesión) | Cumplido |
| 6 | Reglas bajo bloqueo con relectura | base | migración §10 | concurrencia 1–8; SQL C–E | Cumplido |
| 7 | Comedor 1/día; transporte 1 por recorrido, día y sentido; IDA y VUELTA el mismo día | base | trigger + función | SQL C1–C8, D1–D13; API transporte | Cumplido |
| 8 | Hora de la base; transacción; DENEGADO persistido sin RAISE posterior | base | `registrar_acceso_servicio` retorna | SQL C1/C2, E3–E12; estrés (respuestas = filas) | Cumplido |
| 9 | Sin evento ni datos para payload inválido o id inexistente | servidor + base | `NO_RECONOCIDO` sin fila | SQL E1–E2; API | Cumplido |
| 10 | `intento_id` por operador: idempotente, `INTENTO_REUTILIZADO`, aislado | base | índice único `(operador, intento)` | SQL F1–F13; concurrencia 9; API; UI (reintento con el mismo intento) | Cumplido |
| 11 | Respuesta cerrada; denegación genérica | servidor + UI | catálogo local | cripto; servicio; UI | Cumplido |
| 12 | Solo Dirección lee eventos; PERSONAL no | base | `listar_accesos_servicios` | SQL H1–H15; auth PERSONAL; UI auditoría | Cumplido |
| 13 | Anulación 3–200, sin doble, libera cupo | base | `anular_acceso_servicio` | SQL G1–G26; concurrencia 8; API; UI | Cumplido |
| 14 | Sin registro manual ni modo sin conexión; cámara y foto con la misma verificación | servidor + UI | esquema estricto; `EscanerAcceso` | cripto (campos de identidad rechazados); auth (foto y cámara) | Cumplido en Chromium; **dispositivos reales: pendiente** |
| 15 | Límite atómico, 429 con `Retry-After`, antes de la firma | base + servidor | `consumir_cupo_escaneo`; ruta | SQL I1–I13; concurrencia 10 (90 simultáneas → 60); auth 429 | Cumplido (valores de partida) |
| 16 | Retención y mantenimiento cerrado y auditado | base | `depurar_accesos_servicios` | SQL K1–K22 | Cumplido; **responsable y fecha: pendientes** |
| 17 | Dispositivo compartido: datos a ~5 s, sin storage, sin imágenes, sin logs | UI + servidor | `EscanerAcceso`, `decodificar.ts` | UI; auth (sin payload en URL/almacenamiento); servicio (consola limpia) | Cumplido; inactividad: riesgo documentado |
| — | Migración aditiva sobre datos existentes | base | — | `accesos_servicios_migracion_sobre_datos.mjs` | 32 tablas idénticas por MD5 |
| — | Auditoría de `consultar_validez_credencial_qr` | base | — | SQL L1–L5; auth | Decisión pendiente (sección 13) |

## 5. La frontera HMAC servidor → `service_role`, y por qué un identificador no sirve

```
 Navegador (operador)             Servidor Next                        PostgreSQL
 ───────────────────              ─────────────────────────────        ─────────────────────────────
 payload íntegro del QR  ──POST──▶ 1 origen  2 sesión + rol
 intento_id, servicio_id           3 consumir_cupo_escaneo ─service_role─▶ límite atómico (advisory 65001)
 (sin actor, sin ids)              4 cuerpo estricto
                                   5 verificarPayload (HMAC-SHA256,
                                      formato, versión, kid)  ── falla ──▶ registrar_escaneo_invalido
                                   6 solo con firma válida:                 (cuenta; NO_RECONOCIDO, sin evento)
                                     registrar_acceso_servicio ─service_role─▶ operador_de_escaneo (FOR SHARE)
                                       p_actor_user_id = sesión                alumno FOR NO KEY UPDATE
                                       p_credencial_id = id extraído           → credencial → perfil → servicio
                                                                                → inscripción (FOR SHARE) → INSERT
                                   ◀── resultado cerrado ◀────────────────────  (sin RAISE posterior)
 ◀── JSON no-store ◀──
```

**Por qué un `credencial_id` no alcanza.** Dirección lee todos los identificadores de `credenciales_qr` por RLS y el identificador viaja en claro dentro del payload y de las APIs de tarjeta. Una función abierta a `authenticated` que lo recibiera permitiría «escanear» sin QR ni firma. Por eso la operación **no existe** para `anon` ni `authenticated`: lo prueba la matriz de abajo y el ataque directo real de la sección 6.

**El cliente administrativo.** `createAdminClient()` crea un cliente nuevo con `SUPABASE_SERVICE_ROLE_KEY`, sin sesión ni cookies, en cada operación; `Authorization` y `apikey` llevan la clave de servicio. `accesos-qr-servicio.spec.ts` lo comprueba sobre el código real interceptando `fetch`: la petición a `registrar_acceso_servicio` no lleva cookie ni token de usuario y su cuerpo contiene el actor de la sesión y la credencial extraída del payload, nunca el payload ni la firma. Si no se puede crear (falta la clave), falla cerrado con 503.

## 6. Privilegios y prueba de ataque directo

Privilegio `EXECUTE` (consulta real a `pg_proc` sobre la base local; `PUBLIC` = ningún privilegio concedido a todos):

| Función | anon | authenticated | service_role | PUBLIC |
|---|:-:|:-:|:-:|:-:|
| `public.registrar_acceso_servicio(uuid,uuid,uuid,uuid,sentido)` y su par `app_private` | – | – | **sí** | – |
| `public.consumir_cupo_escaneo(uuid)` y su par `app_private` | – | – | **sí** | – |
| `public.registrar_escaneo_invalido(uuid)` y su par `app_private` | – | – | **sí** | – |
| `public.anular_acceso_servicio(uuid,text)` y su par | – | sí (revalida Dirección) | – | – |
| `public.listar_accesos_servicios(...)` y su par | – | sí (revalida Dirección) | – | – |
| `app_private.operador_de_escaneo`, `respuesta_de_intento`, `parametros_limite_escaneo`, `depurar_accesos_servicios` | – | – | – | – |
| `public.consultar_validez_credencial_qr(uuid)` (EPT-64, sin cambios) | – | sí (revalida Dirección) | – | – |

Tablas `accesos_servicios`, `anulaciones_accesos_servicios`, `app_private.contadores_escaneo` y `app_private.depuraciones_accesos_servicios`: **RLS activo y ningún privilegio** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) para `anon`, `authenticated` ni `service_role` (la autoverificación de la migración y SQL A1–A2 lo comprueban en cada reset). Las dos tablas públicas tienen solo la política RESTRICTIVE de bloqueo de cuenta de EPT-59 y ninguna política permisiva.

**Ataque directo real (`accesos-qr-auth.spec.ts`, sesiones reales por PostgREST).** DIRECTOR y PERSONAL conocen un `credencial_id` válido (Dirección lo lee por RLS) pero no el payload firmado. Ninguno puede crear un REGISTRADO: `registrar_acceso_servicio` con su propio usuario como actor, con un actor inventado, `consumir_cupo_escaneo`, `registrar_escaneo_invalido`, `INSERT` directo y `SELECT` de las tablas devuelven `42501`/error y **no dejan ningún evento ni contador**. El mismo ataque con ESTUDIANTE, DOCENTE, PADRE, cuenta sin perfil y las cinco identidades bloqueadas también falla.

## 7. Modelo de eventos, idempotencia, anulación, límites, retención y privacidad

**Eventos** (`accesos_servicios`): `id`, `intento_id`, operador, credencial, alumno, servicio declarado, sentido, resultado, motivo interno de denegación, `registrado_en` (sellado por la base), `dia_servicio` (generada) y `anonimizado_en`. No hay columna de payload, firma, clave, DNI, IP, user-agent ni imagen (una autoverificación lo comprueba por nombre). Solo se agregan filas; el trigger rechaza `UPDATE` y `DELETE` incluso del propietario, salvo las dos excepciones del mantenimiento.

**Idempotencia.** El índice único `(operador, intento_id)` es la autoridad. Mismo operador + mismo intento + mismos argumentos devuelve el resultado ya guardado (incluida la hora sellada); con otros argumentos devuelve `INTENTO_REUTILIZADO` sin tocar el evento; otro operador con el mismo UUID se procesa por su cuenta y no recibe nada del primero. Un reintento simultáneo con otro alumno (otro candado) lo resuelve el índice: la segunda llamada captura el `unique_violation` y responde `INTENTO_REUTILIZADO`.

**Anulación.** Una fila nueva en `anulaciones_accesos_servicios` (clave primaria = el evento, así que no se anula dos veces), con motivo de 3 a 200 caracteres y la autora tomada de la sesión. Solo se anula un REGISTRADO. El evento original no se edita ni se borra.

**Límite.** `consumir_cupo_escaneo` (≤ 60 solicitudes por 5 minutos) y `registrar_escaneo_invalido` (≤ 10 inválidos por 10 minutos); superar cualquiera bloquea 15 minutos. Las solicitudes rechazadas no suman. Los contadores no guardan el payload y duran 24 horas.

**Retención (política de producto aprobada, no una afirmación legal).** `app_private.depurar_accesos_servicios(fin_ciclo_lectivo)`: anonimiza los REGISTRADO cuyo día de servicio es ≤ el fin de ciclo indicado **solo si pasaron 90 días** (quita operador, alumno, credencial e intento; conserva servicio, sentido, resultado y fecha), anonimiza sus anulaciones (autora y motivo libre), elimina los DENEGADO de más de 90 días y los contadores de más de 24 horas, y deja una fila en un registro de auditoría de solo agregado (quién la ejecutó —`session_user`—, cuándo y cuántas filas). **No está cerrada por una variable que cualquiera pueda fijar:** ningún rol de aplicación tiene `EXECUTE` sobre ella ni privilegios de tabla, así que fijar la variable de mantenimiento no les da nada (SQL K4–K5). La guarda de las tablas es defensa en profundidad contra el propietario.

**Privacidad.** El payload vive solo en memoria de la pantalla (ni `localStorage`, ni `sessionStorage`, ni URL) y se descarta al resolver el intento; las imágenes se decodifican en el dispositivo y el lienzo se suelta enseguida; los datos del alumno desaparecen de la pantalla a los 5 segundos; la consola del servidor solo registra contexto y código (probado: ni payload, ni firma, ni clave, ni credencial).

## 8. Orden de bloqueos y concurrencia

Orden: **perfil del operador (FOR SHARE) → [lectura sin bloqueo del `alumno_id` inmutable de la credencial] → alumnos (FOR NO KEY UPDATE) → relectura de intento → credencial (FOR SHARE) → perfil del alumno (FOR SHARE) → servicio (FOR SHARE) → inscripción (FOR SHARE) → INSERT**. Se verificó contra el código real, sin copiar el orden candidato a ciegas:

- `emitir/reponer/revocar` (EPT-64) e `inactivar/reactivar` (008) toman `alumnos` primero: se serializan, sin ciclos.
- Cancelar una inscripción (013, EPT-62) toma solo la fila de la inscripción y su trigger no toma `alumnos` en un `UPDATE`.
- `establecer_recorrido_transporte` (EPT-60) usa el mismo orden alumnos → servicio → inscripción.
- `cambiar_acceso_perfil` (EPT-59) toma el advisory 59001 y la fila de `perfiles` del afectado; ningún trigger de `perfiles` toca `alumnos` ante un cambio de `estado_acceso`. **No hay ciclo.**
- El límite usa un advisory lock propio que nadie más toma.

**Resultados** (`supabase/tests/accesos_servicios_concurrencia.mjs`, conexiones `psql` reales, coordinadas con `pg_blocking_pids`, nunca por tiempo; cada carrera en los dos órdenes):

| Carrera | Orden a (escaneo confirma antes) | Orden b (el cambio confirma antes) |
|---|---|---|
| 1 Revocación | REGISTRADO legítimo; después NO_HABILITADO | escaneo en espera → NO_HABILITADO (CREDENCIAL_REVOCADA), 0 REGISTRADO |
| 1 Reposición | — | la credencial vieja se deniega; la nueva registra |
| 2 Inactivar alumno | REGISTRADO legítimo | NO_HABILITADO (ALUMNO_INACTIVO) |
| 3 Bloquear perfil del alumno (EPT-59) | REGISTRADO legítimo | NO_HABILITADO (ACCESO_BLOQUEADO) |
| 4 Bloquear al **operador** | REGISTRADO legítimo; después `42501` | `42501`, sin evento parcial |
| 5 Cancelar inscripción | REGISTRADO legítimo | NO_HABILITADO (SIN_INSCRIPCION) |
| 6 Desactivar / reactivar recorrido | REGISTRADO legítimo | NO_HABILITADO (SERVICIO_INACTIVO); reactivado → REGISTRADO |
| 7 Cambio de recorrido | REGISTRADO legítimo en NORTE; después RECORRIDO_DISTINTO | NORTE denegado, SUR registra |
| 8 Anulación | YA_REGISTRADO para el que llegó antes | el escaneo en espera REGISTRA (cupo liberado) |
| 9 Doble escaneo / reintento | segundo = YA_REGISTRADO; reintento idéntico = 1 fila; mismo intento con otra credencial = INTENTO_REUTILIZADO | — |
| 10 Ráfaga | 6 escaneos simultáneos → 1 REGISTRADO + 5 YA_REGISTRADO | 90 solicitudes simultáneas → exactamente 60 permitidas |
| 11 Estrés acotado | 6×12 escaneos + 3×10 cambios de estado (reponer, inactivar, reactivar, bloquear, desbloquear, anular) | sin deadlocks (40P01), sin escrituras parciales (cada respuesta quedó persistida exactamente una vez) y sin REGISTRADO vigentes duplicados |

Corrida registrada: `[[RESULTADO_CONCURRENCIA]]`.

## 9. Servidor y API

| Ruta | Método | Actores | Cuerpo |
|---|---|---|---|
| `/api/accesos-servicios/registro` | POST | DIRECTOR, PERSONAL | `{ payload, intento_id, servicio_id, sentido? }` (estricto) |
| `/api/accesos-servicios/[accesoId]/anulacion` | POST | DIRECTOR | `{ motivo }` |

Otros métodos → **405** con `Allow: POST, OPTIONS`; `OPTIONS` → 204. Toda respuesta lleva `Cache-Control: no-store`. Los errores son `{ error, codigo }` en español, sin SQLSTATE, sin identificadores y sin el motivo de una denegación.

| Situación | Código HTTP | `codigo` |
|---|---|---|
| Origen ajeno / `Sec-Fetch-Site: cross-site` | 403 | `ORIGEN_NO_PERMITIDO` |
| Sin sesión | 401 | `NO_AUTENTICADO` |
| Rol que no opera (estudiante, padre, docente, sin perfil) | 403 | `SIN_PERMISO` |
| Perfil bloqueado | 403 | `ACCESO_BLOQUEADO` |
| Más de 60 solicitudes en 5 min, o 10 inválidos en 10 min | 429 + `Retry-After` | `LIMITE_EXCEDIDO` |
| JSON inválido, tipo de contenido distinto, campo extra o desconocido | 400 | `CUERPO_INVALIDO` |
| Cuerpo > 2048 bytes | 413 | `CUERPO_DEMASIADO_GRANDE` |
| Sentido incoherente o servicio inexistente | 422 | `SERVICIO_INVALIDO` |
| Mismo intento con otros argumentos | 409 | `INTENTO_REUTILIZADO` |
| Falta la clave de firma o la de servicio | 503 | `SERVICIO_NO_DISPONIBLE` |
| La base no respondió a tiempo (no sabemos si se registró) | 504 | `TIEMPO_AGOTADO` |
| Error inesperado | 500 | `ERROR_INTERNO` |

Un fallo **nunca** se convierte en una aprobación: una respuesta de la base fuera del conjunto cerrado, sin filas o con un REGISTRADO sin nombre es `ERROR_INTERNO` (probado). Los 401, 403, 405, 413, 429 y los códigos de dominio se probaron por HTTP; el 503 y el 504 se probaron en el servicio (con `fetch` interceptado) y en la pantalla (respuestas simuladas), no con el servidor real sin clave.

## 10. Interfaz y accesibilidad

`/dashboard/accesos` (Dirección y Personal): selector de servicio (comedor / transporte), recorrido y sentido obligatorios en transporte, lectura por cámara y por fotografía, estados de permiso pendiente (con tiempo máximo de 20 s), denegado, sin cámara, sin contexto seguro, error, QR ilegible, envío, éxito, denegación, límite, tiempo agotado y reintento. `/dashboard/accesos/auditoria` (solo Dirección): lista paginada y filtrable, motivo interno de cada denegación, estados anulado y anonimizado, y diálogo de anulación.

- Región viva **cortés** (`role="status"`) para el éxito y **asertiva** (`role="alert"`) para el rechazo; el foco se mueve al título del resultado; «Escanear siguiente» devuelve el foco a la lectura.
- No depende solo del color: cada resultado lleva icono decorativo y título textual.
- Controles de al menos 44 px (medido en escritorio, Pixel 5 e iPhone 13), etiquetas accesibles, teclado completo, diálogo con foco contenido y retorno del foco al disparador.
- 375 px sin desborde horizontal; contraste AA medido con la auditoría compartida del repositorio.
- La cámara se inicia solo por un gesto; sin contexto seguro ni se intenta; se detienen **todas** las pistas al obtener un resultado, al ocultarse la pestaña, al cambiar de modo, al fallar, al detener y al desmontar. Un `play()` que no responde también vence.
- La navegación del panel (EPT-59) sigue ocultando lo que el rol no puede usar; Personal ve «Registrar accesos» pero no «Auditoría de accesos».

## 11. Dispositivos: lo realmente probado y lo no probado

| Entorno | Qué se probó | Estado |
|---|---|---|
| Chromium de escritorio con dispositivo de video falso (`--use-file-for-fake-video-capture`, un `.y4m` generado en la corrida con un QR firmado con la clave efímera) | Lectura real de un QR por la cámara, registro, resultado y **todas las pistas en `ended`**, sesión real de Dirección | Probado |
| Chromium escritorio y Pixel 5 emulado; WebKit iPhone 13 emulado | Todos los estados de permiso (denegado, sin dispositivo, ocupado, sin contexto seguro, sin API, permiso colgado con vencimiento), fotografía y resultados | Probado |
| WebKit de Playwright (Windows) | **No implementa `MediaStream` ni `canvas.captureStream`**: la cámara activa no se puede simular allí (2 pruebas omitidas con motivo) | Límite del entorno |
| **Android Chrome real** | — | **NO probado** |
| **iPhone Safari real** | — | **NO probado** |

Criterio de aceptación pendiente (**`blocked` hasta que se haga**): probar al menos un Android Chrome y un iPhone Safari con un QR real de prueba local, en condiciones seguras. Procedimiento:

1. Levantar el stack local y la aplicación con HTTPS (por ejemplo `npx next dev --experimental-https -H <IP-de-la-red>`; el navegador del teléfono pedirá aceptar el certificado local).
2. Iniciar sesión en el teléfono con una cuenta Personal de prueba y en otra pantalla con la alumna de prueba, abriendo «Mi credencial» (QR real firmado con la clave local).
3. Elegir comedor, tocar «Escanear con la cámara», aceptar el permiso y apuntar. Repetir con una fotografía, con transporte (IDA y VUELTA) y con el permiso denegado.
4. Completar la tabla siguiente **sin** adjuntar capturas con un QR válido ni datos personales.

| Dispositivo y navegador | Fecha | Cámara (permiso, lectura, pistas liberadas) | Fotografía | Estados de error | Resultado |
|---|---|---|---|---|---|
| Android Chrome (modelo/versión) | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ |
| iPhone Safari (modelo/iOS) | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ |

## 12. Verificación: comandos, exit codes y SHA

`[[VERIFICACION]]`

## 13. Análisis focalizado de `consultar_validez_credencial_qr` (EPT-64)

El contrato de EPT-64 decía que no se expondría una función de evaluación por identificador sin pasar por el servidor que valida la firma; la migración `20260929224534` concede `EXECUTE` de `public.consultar_validez_credencial_qr(uuid)` a `authenticated`.

**Comprobado en el reset local:** la concesión es real (`authenticated` sí; `anon`, `service_role` y `PUBLIC` no). La función revalida `auth.uid()` y `app_private.es_director()` y para cualquier otro rol (incluido PERSONAL) falla con `42501`. **Único consumidor:** `verificarQr` (ruta `/api/credenciales-qr/verificacion`, solo Dirección) y la lectura del estado de acceso del alumno en la tarjeta que ve Dirección (`obtenerTarjeta` con `consultarAcceso`).

**Alcance efectivo para DIRECTOR:** con solo un identificador, Dirección obtiene `estado_credencial`, `estado_alumno`, `acceso_alumno` y `valida`. Es información que Dirección **ya lee** por RLS (`credenciales_qr`, `alumnos`, `perfiles`); no concede ninguna capacidad nueva y **no registra ningún acceso** (SQL L3–L4 y la prueba de ataque: cero eventos). No sirve a Personal ni a ningún otro rol.

**No se usó** como prueba de que se escaneó un QR, no se concedió a PERSONAL y el registro no se construyó sobre ella: tiene un TOCTOU (es `STABLE`, sin bloqueos) y por eso el registro evalúa todo bajo bloqueo en su propia operación.

**Efecto de retirarla o restringirla:** dejaría de funcionar la verificación de Dirección y el aviso de «acceso bloqueado» de su tarjeta. Restringirla a `service_role` exige reescribir la función (hoy depende de `auth.uid()`), un cliente administrativo en dos rutas de EPT-64 y la reescritura de sus pruebas (`credenciales_qr_rls.sql` F1…, `credenciales-qr-auth.spec.ts`). Eso cambia el contrato de producto aprobado de EPT-64 y **no es necesario para EPT-65**.

**Decisión: no se modificó.** La desviación queda documentada con evidencia y la nueva operación de EPT-65 permanece cerrada de todos modos. **Decisión mínima que se solicita a Lucas:** ¿se aprueba una historia posterior que restrinja esa función a `service_role` y mueva a Dirección a un cliente administrativo, o se acepta la desviación porque no concede capacidad adicional? No se reabre EPT-64 en Jira por inferencia.

## 14. Fallos preexistentes frente a regresiones

`[[PREEXISTENTES]]`

## 15. Retención: gate previo al despliegue (PENDIENTE)

Política aprobada como decisión de producto, **no como afirmación legal**: eventos identificables hasta el fin del ciclo lectivo + 90 días y luego anonimización; denegaciones 90 días y luego eliminación; contadores 24 horas. v1 se ejecuta a mano; **no se habilitó `pg_cron`** y habilitarlo requiere una aprobación nueva.

**Gate pendiente (no se inventa ningún dato):**

- Responsable institucional de ejecutar y custodiar la purga: **sin definir**.
- Primera fecha de purga: **sin definir**.
- Fin del ciclo lectivo que se pasará como argumento: **sin definir** (la función exige la fecha y se niega a correr antes de fin de ciclo + 90 días).

Hasta que Lucas los asiente, este candidato **no está listo para desplegar**.

Runbook manual (lo ejecuta el propietario de la base, nunca un rol de aplicación):

```sql
-- 1. Confirmar la fecha de fin de ciclo lectivo con la institución y quién ejecuta.
-- 2. Ejecutar (una transacción; falla si todavía no pasaron 90 días):
SELECT * FROM app_private.depurar_accesos_servicios(DATE '<fin del ciclo lectivo>');
-- 3. Verificar la auditoría (quién, cuándo, cuántas filas):
SELECT * FROM app_private.depuraciones_accesos_servicios ORDER BY id DESC LIMIT 5;
```

## 16. Riesgos, límites honestos y retrospectiva

1. **Valores del límite sin medir.** 60/5 min, 10/10 min y 15 min son de partida. Antes de fijarlos como umbral productivo hay que someterlos a una prueba de carga y de usabilidad (una cola de comedor puede acercarse a 60 escaneos por operador en 5 minutos). El cambio es un solo `CREATE OR REPLACE` de `parametros_limite_escaneo()`.
2. **Dispositivos reales sin probar** (sección 11).
3. **Dispositivo compartido sin cierre por inactividad.** No se modificó el sistema de sesiones ni se inventó un tiempo universal: una sesión de operador abierta en un teléfono compartido sigue abierta. Mitigaciones presentes: cada operador usa su cuenta, los datos del alumno se ocultan a los 5 s y el payload no persiste. **Decisión pendiente si se quiere un cierre por inactividad.**
4. **Vercel y el límite por región.** El límite es por cuenta y está en la base, no depende de la infraestructura del borde.
5. **El propietario de la base puede deshabilitar los triggers de protección** (como en las demás tablas de historial del proyecto): la garantía frente a las aplicaciones es la ausencia de privilegios, no el trigger.
6. **`service_role` es una clave poderosa.** Está solo en el servidor y la operación es la única que su rol puede ejecutar sobre estas tablas, pero una fuga de la clave sigue siendo grave: rotarla es una acción de Supabase fuera de este código.
7. **Anulación sin límite de tiempo.** Dirección puede anular un acceso de cualquier día no anonimizado. Es lo aprobado; queda auditado.
8. **`consultar_validez_credencial_qr`** (sección 13): decisión pendiente.
9. **Un solo bloque de Dirección.** No hay un Director de respaldo para la anulación si el único Director está bloqueado; es una propiedad de EPT-59, no de esta historia.

**Retrospectiva.** Lo que ahorró tiempo: probar la frontera con un `fetch` espía (demuestra el orden y la ausencia del token sin base) y fijar las carreras con `pg_blocking_pids` en vez de dormir. Lo que costó: el puerto 3000 ocupado por un proceso ajeno (obligó a parametrizar el puerto en 20 archivos de prueba), WebKit sin `MediaStream` en Windows (las pruebas de cámara activa solo corren en Chromium), y que una prueba ajena (`credenciales_qr_rls.sql`) asumía que `TRUNCATE` llegaba al trigger: con la clave foránea nueva PostgreSQL lo rechaza antes (se ajustó el código esperado sin debilitar la aserción y se agregó la variante con `CASCADE`). A mejorar: una verificación de que el usuario existe en Auth además del perfil (hoy el baneo no revoca el JWT en PostgREST; el servidor ya consulta `getUser`).

## 17. Reversión

La reversión de Git **no** deshace la base. Plan compensatorio (**documentado, no ejecutado**) que no destruye auditoría:

1. Código: revertir el PR. Las rutas dejan de existir; la base queda con las operaciones cerradas, inofensivas.
2. Base, paso mínimo (apaga la función sin perder datos): `REVOKE EXECUTE` de `public.registrar_acceso_servicio`, `public.consumir_cupo_escaneo` y `public.registrar_escaneo_invalido` (y de sus pares de `app_private`) a `service_role`, en una migración **nueva** (`..._ept_65_cerrar_registro_accesos.sql`).
3. Base, retirada total (solo si se decide): exportar antes `accesos_servicios` y `anulaciones_accesos_servicios` y recién entonces `DROP` de funciones y tablas, en ese orden (`anulaciones` antes que `accesos`; las dos referencian a `credenciales_qr`, de modo que **revertir EPT-65 es previo a revertir EPT-64**). Nunca se borran tablas con datos sin exportarlas.
4. Las pruebas de EPT-64 ya contemplan ese orden (`credenciales_qr_rls.sql`, sección R).

## 18. Plan de despliegue y postflight (DOCUMENTADO, NO EJECUTADO)

1. **Gate de retención resuelto** (sección 15) y decisión sobre `consultar_validez_credencial_qr` (sección 13) tomada.
2. Confirmar el **proyecto correcto** y el **ledger**: `supabase migration list --linked` debe mostrar aplicada `20260929224534` y pendiente solo `20261001012522`.
3. **Respaldo** de la base antes de aplicar (registrar su identificador, nunca su contenido).
4. Aplicar **solo la migración pendiente** (revisar antes con `--dry-run`); la migración se autoverifica y aborta si algo no queda como se espera.
5. Verificar grants y objetos **sin datos personales** con la consulta de privilegios de la sección 6 (la operación de registro solo para `service_role`; ninguna tabla con privilegios).
6. Confirmar por **nombre, no por valor**, que existen en el servidor de producción: `SUPABASE_SERVICE_ROLE_KEY`, `QR_CREDENCIAL_KID_ACTIVA`, `QR_CREDENCIAL_CLAVES`. Nunca imprimir una clave ni un payload.
7. Integrar el código **con autorización de Lucas** (PR → revisión → merge).
8. Comprobar el despliegue: `/api/accesos-servicios/registro` responde 401 sin sesión y 405 a `GET`; `/dashboard/accesos` redirige al inicio de sesión; los encabezados `Permissions-Policy` coinciden; `/pruebas-ui/accesos` responde 404 idéntico al de una ruta inexistente.
9. **Postflight con identidades de prueba autorizadas.** **No insertar eventos de prueba en producción sin autorización explícita y un plan de limpieza:** un REGISTRADO no se puede borrar (solo anular y, a su tiempo, anonimizar); una denegación de prueba se elimina a los 90 días. Si Lucas lo autoriza, acordar de antemano qué credencial y qué día se usan y aceptar que ese evento queda anulado en la auditoría.
10. Programar la **primera purga** con el responsable y la fecha que la institución defina.

## 19. Textos preparados (NO publicados)

**Comentario para Jira (EPT-65):**

> Candidato local de RF21 «Registrar accesos con QR» listo para revisión, sin integrar ni desplegar. Rama `codex/ept-65-accesos-qr` sobre `origin/main` `d4fa26f`; evidencia en `docs/evidence/EPT-65.md`. El operador (Dirección o Personal, con su propia cuenta) elige comedor o recorrido y sentido y lee el QR con la cámara o una foto; el servidor verifica la firma HMAC **antes** de invocar la operación de PostgreSQL, que solo ejecuta `service_role` y revalida al operador. Un `credencial_id` conocido no permite registrar nada (probado por PostgREST con sesiones reales). Incluye límite de intentos por cuenta, idempotencia por intento, anulación de Dirección que libera el cupo sin borrar historia, auditoría de solo lectura y retención con mantenimiento manual. Pruebas: SQL, concurrencia real en ambos órdenes, API con sesiones reales por actor, pantalla en escritorio, Pixel 5 e iPhone 13 emulados. **Pendiente:** (1) prueba de cámara en un Android Chrome y un iPhone Safari reales; (2) responsable institucional y primera fecha de purga; (3) decisión sobre `consultar_validez_credencial_qr` de EPT-64 (concedida a `authenticated`, sin capacidad adicional). Estado recomendado: **mantener «En curso»** hasta la revisión, la integración y el postflight de producción.

**Título del PR:** `feat(accesos): registrar accesos al comedor y al transporte con QR (EPT-65)`

**Descripción del PR:**

> ## Qué hace
> Registra el uso del comedor y del transporte a partir del QR de la credencial (RF21): operador autenticado (Dirección o Personal) → servidor verifica la firma HMAC → operación privilegiada de PostgreSQL (solo `service_role`) que revalida al operador, bloquea, relee y decide.
>
> ## Seguridad
> - Ningún usuario autenticado puede registrar un acceso por RPC ni por tabla; un `credencial_id` no alcanza.
> - La clave HMAC vive solo en el servidor; falla cerrado.
> - Ningún rol de aplicación tiene privilegios sobre las tablas; Dirección lee por una función de solo lectura.
> - Límite atómico por cuenta (60/5 min, 10 inválidos/10 min, bloqueo de 15 min: valores de partida, sin medir).
>
> ## Pruebas
> SQL (299 comprobaciones), concurrencia real, migración sobre datos, API por actor, pantalla en tres perfiles. Ver `docs/evidence/EPT-65.md`.
>
> ## Pendiente antes de desplegar
> Prueba en dispositivos reales; responsable y primera fecha de purga; decisión sobre `consultar_validez_credencial_qr`.

## 20. Capturas

`[[CAPTURAS]]`
