# EPT-65 — RF21: Registrar accesos con QR

**Estado al 01/10/2026: candidato local, `blocked`. NO está listo para revisión ni para desplegar.** El contrato aprobado está implementado y probado en las tres fronteras (base, servidor y navegador) sobre un stack local descartable. No se hizo push, PR, merge, despliegue ni cambio alguno en producción, y EPT-65 **no se transicionó** en Jira. El gate que impide declararlo listo, junto con lo ya resuelto en esta ronda:

1. **Prueba de cámara en dispositivos reales (Android Chrome e iPhone Safari): PENDIENTE (`blocked`).** La emulación (Pixel 5, iPhone 13) y la cámara falsa de Chromium **no cumplen este gate**. El entorno HTTPS local está preparado y verificado (sección 11); falta el resultado observable de Lucas en cada teléfono.
2. **Retención: definida de forma PROVISIONAL.** Responsable por cargo (Dirección o administrador principal) y fechas ficticias fijadas por Lucas; hay que reemplazarlas por las oficiales antes de la primera purga real (sección 15). Esto no es cumplimiento legal.
3. **Límites 60/5 min, 10 inválidos/10 min, 15 min: MEDIDOS en local, no en producción.** Con una cola a ≤ 5 s por alumno una sola cuenta alcanza el tope: se recomienda un ajuste que **requiere aprobación** antes de cambiar la regla (sección 16).
4. **RPC heredada de EPT-64: aceptada por Lucas como deuda separada** (sección 13).
5. **Estrategia de PR: sin decidir** (sección 19).

Resuelto en esta ronda: una revisión independiente halló dos defectos medios causados por el candidato (el `kid` del QR no se ataba a la credencial; carrera entre anulación y purga). Ambos se corrigieron y se probaron (sección 21). La E2E completa final es verde sobre el código corregido.

| Dato | Valor |
|---|---|
| Rama / worktree | `codex/ept-65-accesos-qr` en `E:\Escritorio\codigo\MetodologiaTPI-ept65` (el checkout principal no se tocó) |
| Base | `origin/main` = `d4fa26f5bd0e76c1418822f6446c899b957c5b59` (verificado con `git fetch origin --prune`; coincide con el SHA informado por el orquestador). La rama no tiene upstream ni existe en el remoto |
| Commits | **15** sobre `origin/main` (el informe anterior decía «9»; eran 11 antes de esta ronda): ver sección 12.1 |
| Código verificado | `cbfb78d` (migración, servidor y pruebas corregidos). Los dos commits posteriores solo agregan scripts de prueba (`6314e8f`, `29b4ed8`); la E2E completa se corrió sobre `6314e8f`. Esta documentación se agrega en un commit posterior y no cambia código |
| Jira | EPT-65 «Por hacer», asignada a Lucas Gimenez, hija de EPT-7, sin subtareas (consultado en vivo al comienzo de la tarea). EPT-64 «Listo». No se modificó ninguna issue |
| Producción | **Sin cambios por esta tarea, y NO verificable desde este entorno.** El MCP de Supabase de esta sesión solo ve dos proyectos ajenos a EPT (no se tocaron) y el worktree no está enlazado a producción, de modo que «la migración `20261001012522` no está aplicada» es lo informado por el orquestador, **no comprobado por esta ronda**. Confirmarlo con `supabase migration list --linked` antes de cualquier despliegue (sección 18) |
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
12. **El `kid` del QR se ata a la credencial** *(corrección de la revisión independiente)*. `registrar_acceso_servicio` recibe `p_clave_kid` (el `kid` ya verificado por el servidor) y lo compara con el `clave_kid` guardado, que es inmutable. Si no coincide devuelve `NO_RECONOCIDO` **sin crear evento**. Antes solo se comprobaba la firma: si tras una rotación `k1`→`k2` la clave `k1` seguía en `QR_CREDENCIAL_CLAVES` y se filtraba, alguien podía armar `EPT1.k1.<id>.<hmac>` para una credencial emitida con `k2` (el `id` no es secreto: Dirección lo lee por RLS). Pruebas: SQL E2b–E2d.
13. **Anulación y purga no dejan una anulación identificable sobre un evento anonimizado** *(corrección de la revisión independiente)*. `anular_acceso_servicio` relee `anonimizado_en` bajo bloqueo y se niega (`P5666`); la purga anonimiza primero los eventos y después las anulaciones **de esos eventos** en una sentencia nueva, que ve lo confirmado mientras esperaba. Prueba: carrera 12 en los dos órdenes (verificada contra una versión mutante que reintroduce el defecto: falla en 12a).

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
| 15 | Límite atómico, 429 con `Retry-After`, antes de la firma | base + servidor | `consumir_cupo_escaneo`; ruta | SQL I1–I13; concurrencia 10 (90 simultáneas → 60); auth 429 | Cumplido; valores **medidos en local** y ajuste recomendado pendiente de aprobación (§16.1) |
| 16 | Retención y mantenimiento cerrado y auditado | base | `depurar_accesos_servicios` | SQL K1–K22 | Cumplido; responsable por cargo y fechas **provisionales** (§15) |
| 17 | Dispositivo compartido: datos a ~5 s, sin storage, sin imágenes, sin logs | UI + servidor | `EscanerAcceso`, `decodificar.ts` | UI; auth (sin payload en URL/almacenamiento); servicio (consola limpia) | Cumplido; inactividad: riesgo documentado |
| 18 | El `kid` del QR coincide con el de la credencial | servidor + base | `registrar_acceso_servicio(…, p_clave_kid, …)`; `accesos-qr.service.ts` | SQL E2b–E2d; servicio (el cuerpo de la RPC lleva el `kid`) | Cumplido (sobre `cbfb78d`) |
| 19 | Anulación y purga: ninguna anulación identificable sobre un evento anonimizado | base | `anular_acceso_servicio`, `depurar_accesos_servicios` | concurrencia 12a/12b; mutante | Cumplido (sobre `cbfb78d`) |
| — | Migración aditiva sobre datos existentes | base | — | `accesos_servicios_migracion_sobre_datos.mjs` | 32 tablas idénticas por MD5 |
| — | Auditoría de `consultar_validez_credencial_qr` | base | — | SQL L1–L5; auth | Aceptada por Lucas como deuda separada (§13) |

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
| `public.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,sentido)` y su par `app_private` | – | – | **sí** | – |
| `public.consumir_cupo_escaneo(uuid)` y su par `app_private` | – | – | **sí** | – |
| `public.registrar_escaneo_invalido(uuid)` y su par `app_private` | – | – | **sí** | – |
| `public.anular_acceso_servicio(uuid,text)` y su par | – | sí (revalida Dirección) | – | – |
| `public.listar_accesos_servicios(...)` y su par | – | sí (revalida Dirección) | – | – |
| `app_private.operador_de_escaneo`, `respuesta_de_intento`, `parametros_limite_escaneo`, `depurar_accesos_servicios` | – | – | – | – |
| `public.consultar_validez_credencial_qr(uuid)` (EPT-64, sin cambios) | – | sí (revalida Dirección) | – | – |

Tablas `accesos_servicios`, `anulaciones_accesos_servicios`, `app_private.contadores_escaneo` y `app_private.depuraciones_accesos_servicios`: **RLS activo y ningún privilegio** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) para `anon`, `authenticated` ni `service_role` (la autoverificación de la migración y SQL A1–A2 lo comprueban en cada reset). Las dos tablas públicas tienen solo la política RESTRICTIVE de bloqueo de cuenta de EPT-59 y ninguna política permisiva.

**Ataque directo real (`accesos-qr-auth.spec.ts`, sesiones reales por PostgREST).** DIRECTOR y PERSONAL conocen un `credencial_id` válido (Dirección lo lee por RLS) pero no el payload firmado. Ninguno puede crear un REGISTRADO: `registrar_acceso_servicio` con su propio usuario como actor, con un actor inventado, `consumir_cupo_escaneo`, `registrar_escaneo_invalido`, `INSERT` directo y `SELECT` de las tablas devuelven `42501`/error y **no dejan ningún evento ni contador**. Reejecutado dentro de la E2E completa final sobre `6314e8f` (la corrección del `kid` agregó `p_clave_kid` a esas llamadas para que sigan probando el rechazo por permisos y no por «función no encontrada»). El mismo ataque con ESTUDIANTE, DOCENTE, PADRE, cuenta sin perfil y las cinco identidades bloqueadas también falla.

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
| 12 Anulación frente a la purga | la purga retiene el evento: la anulación en espera se rechaza (`P5666`) y no queda ninguna anulación | la anulación confirma primero: la purga espera, la ve confirmada y la anonimiza (sin autora ni motivo) |

Corrida sobre `cbfb78d` (exit 0): **12 grupos OK**; el estrés dejó 15 REGISTRADO, 9 YA_REGISTRADO y 48 NO_HABILITADO (varía por corrida; lo que se afirma es que respuestas = filas persistidas). La carrera 12 se verificó además contra una versión mutante de `anular_acceso_servicio` sin la relectura: falla en 12a, así que la prueba detecta el defecto.

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
| WebKit de Playwright (Windows) | **No implementa `MediaStream` ni `canvas.captureStream`**: la cámara activa no se puede simular allí (2 pruebas omitidas con motivo). **No es una prueba de iPhone real** | Límite del entorno |
| **Android Chrome real** | — | **PENDIENTE** |
| **iPhone Safari real** | — | **PENDIENTE** |

**Gate: `blocked` hasta que haya un resultado verificable en un Android Chrome real y un iPhone Safari real.** La emulación y la cámara falsa no lo cumplen. Si no hay resultado, el candidato **no se describe como completamente validado**.

### Entorno local preparado (y verificado)

- `supabase/tests/entorno-telefonos.mjs` (commit `6314e8f`): siembra las identidades sintéticas, compila la aplicación con un origen HTTPS de red local y sirve **un solo origen** (la aplicación y `/auth/v1`, `/rest/v1`, `/storage/v1`, `/realtime/v1`) mediante un proxy HTTPS que escucha **solo** en la IP de red local indicada. Un único origen evita contenido mixto y CORS, y exige aceptar un solo certificado.
- La clave de firma de los QR es **efímera**: nace en el proceso, no se imprime ni se guarda y deja de valer al cortarlo. No se abrió ningún túnel público ni se usó un QR de producción.
- El certificado es propio (3 días, IP en `subjectAltName`, fuera del repositorio). El servidor de Next confía en él mediante `NODE_EXTRA_CA_CERTS`, sin desactivar la verificación TLS.
- **Verificado desde la PC el 01/10/2026** (no desde un teléfono): `/login` 200; `/auth/v1/health` 200 bajo el mismo origen; `POST /api/accesos-servicios/registro` sin sesión 401 (el origen se acepta); `/dashboard/accesos` sin sesión 307 a `/login`; `Permissions-Policy: camera=(self), microphone=(), geolocation=()` en `/dashboard/accesos`; el certificado valida contra su propia IP.
- **Riesgo conocido, no resuelto por emulación:** un navegador móvil puede no tratar como contexto seguro una página cuyo certificado se aceptó a mano. La pantalla lo detecta y muestra el estado «sin contexto seguro»; si ocurre en un teléfono, **es un hallazgo del entorno de prueba** y el plan B es instalar el certificado en el teléfono. Se informa tal cual.

### Procedimiento (Lucas, con cada teléfono en el mismo Wi-Fi que la PC)

1. En la PC: abrir `https://<IP>:8443`, aceptar el certificado e iniciar sesión como la alumna sintética → «Mi credencial» (ese QR queda en pantalla).
2. En el teléfono: abrir la misma dirección y aceptar el aviso (Chrome: *Configuración avanzada → Continuar*; Safari: *Mostrar detalles → visitar este sitio web*). Iniciar sesión como Personal sintético → «Registrar accesos».
3. Casos: **A** comedor con cámara (permiso, lectura, «Registrado», pistas liberadas); **B** mismo QR → «Ya registrado»; **C** transporte IDA, VUELTA y IDA repetida; **D** fotografía; **E** permiso denegado; **F** cámara ocupada (opcional); **G** «Escanear siguiente» reabre y libera; **H** diseño vertical sin desborde, controles táctiles y anuncio del resultado con lector de pantalla (opcional). Para repetir el cupo del día, Dirección anula el registro en «Auditoría de accesos».
4. Anotar solo observaciones: **sin capturas con QR válido, sin credenciales y sin datos personales.**

### Resultados (a completar con lo que Lucas observe)

| Dispositivo y navegador | Quién probó | Fecha | Cámara (permiso, lectura, pistas) | Fotografía | Estados de error | Resultado y límites |
|---|---|---|---|---|---|---|
| Android Chrome (modelo/versión) | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ |
| iPhone Safari (modelo/iOS) | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ | _pendiente_ |

## 12. Verificación: comandos, exit codes y SHA

Stack aislado `ept65`; variables de corrida: `EPT_SUPABASE_WORKDIR=E:/Escritorio/codigo/_sb-ept65 EPT_PUERTO_APP=3100 EPT_TEST_SMTP_PORT=57425`. Cada resultado se asocia al SHA exacto sobre el que se obtuvo; **ningún resultado anterior a `cbfb78d` se cita como prueba del código posterior** (esa ronda reejecutó todo lo afectado).

### 12.1 Commits de la rama (15, de más reciente a más antiguo)

| # | SHA | Contenido |
|---|---|---|
| 15 | `29b4ed8` | script de medición de límites contra el endpoint real |
| 14 | `6314e8f` | script del entorno HTTPS para teléfonos reales |
| 13 | `cbfb78d` | **corrección** de la revisión independiente (`kid` atado, carrera anulación↔purga), pruebas y tipos |
| 12 | `cbe5989` | restaura los 11 PNG de EPT-13 regenerados por error |
| 11 | `ce04d48` | evidencia, capturas y decisiones (versión anterior) |
| 10 | `9870bee` | expectativa del menú de PERSONAL (**regeneró los 11 PNG de EPT-13**) |
| 9 | `72b4078` | el banco de accesos tampoco existe en producción |
| 8 | `423ed3f` | índice de la clave foránea de `alumnos` y prueba de migración sobre datos |
| 7 | `105f6a0` | pruebas de presentación, accesibilidad y cámara |
| 6 | `8a8bc02` | pruebas de servidor, API y sesiones reales |
| 5 | `264c191` | puerto del servidor de pruebas parametrizable |
| 4 | `e03fdb9` | API, escáner y auditoría |
| 3 | `5b4c85a` | adapta las pruebas de EPT-59 y EPT-64 |
| 2 | `01cf0bd` | concurrencia real del registro |
| 1 | `b68d95e` | migración y operaciones de base |

La cifra «9 commits» del informe anterior era incorrecta: eran 11 y ahora son 15 (más el de esta documentación).

### 12.2 Comandos y resultados

| Ronda | Comando | SHA | Exit | Resultado |
|---|---|---|---|---|
| Integridad | `git fetch origin --prune`; ancestría; `git diff --check origin/main..HEAD` | `29b4ed8` | 0 | `origin/main` = `d4fa26f`, es ancestro; 0 atrás / 15 adelante; sin upstream ni rama remota; sin espacios en blanco erróneos |
| Reset | `npx supabase db reset --workdir <_sb-ept65>` y `migration list --local` | `cbfb78d` | 0 | 26 migraciones aplicadas, incluida la autoverificación de la migración |
| SQL EPT-65 | `psql -f supabase/tests/accesos_servicios_rls.sql` | `cbfb78d` | 0 | **302** comprobaciones OK, 0 FALLO (299 anteriores + 3 del `kid`) |
| SQL regresión | las 18 `supabase/tests/*_rls.sql` (`usuarios_permisos_rls.sql` como `supabase_admin`, como exige su fixture) | `cbfb78d` | 0 (todas) | `alumnos_academicos` 69, `comedor` 31, `credenciales_qr` 148, `cursos` 39, `deportes_administracion` 50, `deportes` 59, `horarios_academicos` 8, `horarios` 44, `inscripcion_hijos` (sin conteo propio), `inscripciones_administracion` 41, `materias` 44, `niveles` 73, `perfiles_privacidad` 4, `profesores` 19, `reportes_oficiales` 31, `transporte` 25, `usuarios_permisos` 46 |
| Concurrencia EPT-65 | `node supabase/tests/accesos_servicios_concurrencia.mjs` | `cbfb78d` | 0 | **12 grupos** (incluye la carrera 12 anulación↔purga). Mutante (anulación sin la relectura) → **falla en 12a**: la prueba detecta el defecto |
| Concurrencia regresión | los 12 `*_concurrencia.mjs` restantes (alumnos_academicos, comedor, credenciales_qr, deportes_administracion, deportes, horarios_academicos, horarios, inscripciones_administracion, niveles, profesores, transporte, usuarios_permisos) | `cbfb78d` | 0 (todos) | todas OK |
| Migración sobre datos | `node supabase/tests/accesos_servicios_migracion_sobre_datos.mjs` | `cbfb78d` | 0 | ledger de 26 versiones sin duplicados; operación privilegiada solo para `service_role`; la base vuelve al estado de las migraciones |
| Tipos | `node supabase/tests/tipos-generados.mjs --escribir` y luego sin bandera | `cbfb78d` | 0 | reproducible; la única diferencia con el commit anterior es `p_clave_kid` (+1 línea) |
| Tipos TS | `npx tsc --noEmit --incremental false` | `cbfb78d` | 0 | limpio |
| ESLint focalizado | archivos `.ts/.tsx` modificados o agregados por la rama | `cbfb78d` | 0 | 0 errores, 0 advertencias |
| `npm run lint` | repo completo, resultado por archivo y regla | `cbfb78d` | 1 | **14 errores y 107 advertencias en 26 archivos; ninguno en un archivo tocado por la rama.** Reglas con error: `no-explicit-any` 5, `react/no-unescaped-entities` 4, `react-hooks/set-state-in-effect` 3, `react-hooks/immutability` 1, `@next/next/no-html-link-for-pages` 1. Los totales coinciden con los de `origin/main` medidos en la ronda anterior en un worktree limpio (esta ronda no repitió esa medición: comprobó que ningún archivo del candidato figura) |
| `npm run build` | con la URL y la clave anónima del stack local | `cbfb78d` | 0 | compila; rutas nuevas presentes; sin `/pruebas-ui` |
| Bancos en producción | `node supabase/tests/harness_produccion.mjs` | `cbfb78d` | 0 | `/pruebas-ui/accesos` responde 404 byte a byte idéntico al de una ruta inexistente. **Nota:** este banco deja en `.next` una compilación con URL de relleno; hay que recompilar antes de servir |
| **E2E completa FINAL** | `node supabase/tests/correr-autenticadas.mjs` (sin filtro) | **`6314e8f`** | **0** | **1577 aprobadas, 14 omitidas, 0 fallos, 24,8 min** |
| E2E completa previa a la corrección | ídem | `cbe5989` | 0 | 1577 aprobadas, 14 omitidas, 0 fallos, 26,0 min |
| E2E completa del informe anterior | ídem | `72b4078` | 1 | 1575 aprobadas, 14 omitidas, 2 fallos (sección 14) |
| Medición de límites | `node supabase/tests/carga_limites_accesos.mjs` | `29b4ed8` | 0 | sección 16.1 |
| Entorno de teléfonos | `node supabase/tests/entorno-telefonos.mjs --ip … --cert … --key …` | `6314e8f` | — | arriba y verificado desde la PC (sección 11) |

Las 14 pruebas omitidas de la E2E final: **2 de esta historia** (WebKit de Playwright en Windows no implementa `MediaStream`; cámara activa y clic duplicado, no son prueba de iPhone real) y **12 de otras historias**, omitidas por sus autores con su propio motivo (EPT-62: 1 táctil en móvil; comedor, transporte e inscripciones: 3 «se opera con el teclado» en WebKit; EPT-64: 1 sin clave de firma; reportes: 6 de rendimiento y 1 de menú de bloqueo).

### 12.3 Efecto colateral de la suite

La E2E completa **regenera 11 PNG de `docs/evidence/EPT-13/`** aun sin `EPT_CAPTURAS=1` (los escribe `hijos-auth.spec.ts`). El commit `9870bee` los había arrastrado y el informe anterior afirmaba lo contrario. Se restauraron a los bytes de `origin/main` en `cbe5989`, y tras cada E2E completa se restauran con `git checkout -- docs/evidence/EPT-13`. Comprobado: `git diff --name-only origin/main..HEAD -- docs/evidence/EPT-13` devuelve 0 archivos.

## 13. Análisis focalizado de `consultar_validez_credencial_qr` (EPT-64)

El contrato de EPT-64 decía que no se expondría una función de evaluación por identificador sin pasar por el servidor que valida la firma; la migración `20260929224534` concede `EXECUTE` de `public.consultar_validez_credencial_qr(uuid)` a `authenticated`.

**Comprobado en el reset local:** la concesión es real (`authenticated` sí; `anon`, `service_role` y `PUBLIC` no). La función revalida `auth.uid()` y `app_private.es_director()` y para cualquier otro rol (incluido PERSONAL) falla con `42501`. **Único consumidor:** `verificarQr` (ruta `/api/credenciales-qr/verificacion`, solo Dirección) y la lectura del estado de acceso del alumno en la tarjeta que ve Dirección (`obtenerTarjeta` con `consultarAcceso`).

**Alcance efectivo para DIRECTOR:** con solo un identificador, Dirección obtiene `estado_credencial`, `estado_alumno`, `acceso_alumno` y `valida`. Es información que Dirección **ya lee** por RLS (`credenciales_qr`, `alumnos`, `perfiles`); no concede ninguna capacidad nueva y **no registra ningún acceso** (SQL L3–L4 y la prueba de ataque: cero eventos). No sirve a Personal ni a ningún otro rol.

**No se usó** como prueba de que se escaneó un QR, no se concedió a PERSONAL y el registro no se construyó sobre ella: tiene un TOCTOU (es `STABLE`, sin bloqueos) y por eso el registro evalúa todo bajo bloqueo en su propia operación.

**Efecto de retirarla o restringirla:** dejaría de funcionar la verificación de Dirección y el aviso de «acceso bloqueado» de su tarjeta. Restringirla a `service_role` exige reescribir la función (hoy depende de `auth.uid()`), un cliente administrativo en dos rutas de EPT-64 y la reescritura de sus pruebas (`credenciales_qr_rls.sql` F1…, `credenciales-qr-auth.spec.ts`). Eso cambia el contrato de producto aprobado de EPT-64 y **no es necesario para EPT-65**.

**Decisión (Lucas, 01/10/2026): aceptar la desviación como deuda separada.** No se modificó EPT-64 ni se amplió ningún permiso. La desviación queda documentada con evidencia: la función es ejecutable por `authenticated`, revalida DIRECTOR, devuelve a Dirección solo datos que ya lee por RLS, **no registra accesos** y no sirve a PERSONAL; la operación de registro de EPT-65 permanece cerrada de todos modos. Corregirla (restringirla a `service_role` y mover a Dirección a un cliente administrativo en dos rutas de EPT-64, con reescritura de sus pruebas) requiere una **historia y una migración propias**; no se reabre EPT-64 en Jira por inferencia. Tampoco ata el `kid` (riesgo 11 de la sección 16).

## 14. Fallos de la E2E anterior: causa y atribución

La E2E completa sobre `72b4078` terminó en exit 1 con 2 fallos. Esta ronda los reexaminó y repitió la corrida completa sin filtro.

1. **Regresión nueva y legítima (corregida):** `usuarios-permisos-auth.spec.ts` («PERSONAL solo tiene Inicio y Mi perfil») esperaba un menú de dos enlaces; ahora PERSONAL ve «Registrar accesos», que es el alcance de esta historia. Se actualizó la expectativa a `['Inicio', 'Registrar accesos', 'Mi perfil']` (y el título), sin debilitar el resto de la prueba, que sigue exigiendo que no vea ninguna otra sección.
2. **Timeout de 30 s en `usuarios-permisos-auth.spec.ts:390`** («sin sesión, cada endpoint nuevo responde 401…», dos intentos seguidos dentro de la corrida larga). **Causa: no determinada.** Lo que se comprobó en esta ronda:
   - El archivo no cambió su lógica por esta historia (solo la URL base y la expectativa del menú del punto 1), y la prueba usa cookies vacías, los endpoints de EPT-59 y `/acceso-bloqueado`; ninguno es código de EPT-65.
   - **Aislada y contra un servidor de desarrollo frío** (puerto nuevo, sin reintentos, con traza): pasa en **8,2 s**. La compilación en frío bajo demanda, por sí sola, no explica los 30 s.
   - **Dos corridas completas sin filtro** (`cbe5989` y la final `6314e8f`): 0 fallos y esa prueba pasa en ambas.
   - **No se reprodujo en `origin/main`** ni se intentó: no se creó un worktree adicional (restricción de la tarea). Por eso **no se rotula «preexistente»**.
   - Conclusión honesta: es un timeout **intermitente no reproducido en tres corridas posteriores**; no se atribuye al candidato ni se descarta. Posible factor (hipótesis, no medida): degradación del servidor de desarrollo de Next tras ~28 minutos de corrida. Si reaparece, obtener la traza de `on-first-retry` antes de tocar nada. No se agregaron reintentos, `skip` ni tiempos de espera mayores.

Otros ajustes de pruebas ajenas por las nuevas claves foráneas y rutas, sin debilitar aserciones: `credenciales_qr_rls.sql` D10 (el `TRUNCATE` sin `CASCADE` ahora lo rechaza PostgreSQL con `0A000` antes del trigger; se agregó la variante `CASCADE` que sí dispara la guarda) y la sección R (revertir EPT-65 antes que EPT-64); la batería de `usuarios_permisos_rls.sql` (+2 RPC de Dirección); `auth.setup.ts` (limpieza de accesos); `harness_produccion.mjs` (+ el banco nuevo); 19 suites leen la URL base de `EPT_BASE_URL`.

Fallos preexistentes comprobados contra `origin/main`: **solo el lint** (14 errores y 107 advertencias, medidos en la ronda anterior en un worktree limpio; ninguno en archivos de esta rama). Ninguna prueba de la E2E falló por un defecto previo.

## 15. Retención: decisión provisional (gate previo a la primera purga real)

Política aprobada como decisión de producto, **no como afirmación legal**: eventos identificables hasta el fin del ciclo lectivo + 90 días y luego anonimización; denegaciones 90 días y luego eliminación; contadores 24 horas. v1 se ejecuta a mano; **no se habilitó `pg_cron`** y habilitarlo requiere una aprobación nueva.

**Decisiones registradas de Lucas (01/10/2026), tal como las dio:**

| Dato | Decisión | Estado |
|---|---|---|
| Responsable de ejecutar y custodiar la purga | «el admin principal o el director»: se registra **por cargo** (Dirección o administrador principal del sistema), **sin nombre propio** | Definido por cargo; **falta la persona concreta** |
| Fin del ciclo lectivo | Lucas indicó que se use una **fecha ficticia**; se fijó `2026-12-18` | **PROVISIONAL, ficticia, no institucional** |
| Primera purga | Derivada de la regla de la función (corre solo si `fin de ciclo + 90 días < hoy`): **no antes del `2027-03-19`** | **PROVISIONAL**, calculada de la fecha ficticia |

Las dos fechas deben **reemplazarse por las oficiales de la institución antes de ejecutar la primera purga real**. Que Lucas haya fijado valores provisionales **no demuestra cumplimiento legal** ni equivale a la fecha del calendario escolar.

**Atención al «quién»:** ejecutar la purga exige **acceso de propietario a la base** (ningún rol de la aplicación tiene `EXECUTE`). Ser Director en la aplicación **no** da ese acceso. «Dirección o administrador principal» solo es operable si esa persona, o quien la asista, tiene ese acceso a la base; conviene nombrar a quien lo tenga.

Runbook manual (lo ejecuta el propietario de la base, nunca un rol de aplicación):

```sql
-- 1. Confirmar con la institución la fecha OFICIAL de fin de ciclo lectivo y quién ejecuta.
-- 2. Previsualizar SIN modificar nada: qué se anonimizaría y qué se eliminaría.
SELECT
  (SELECT count(*) FROM public.accesos_servicios
    WHERE resultado = 'REGISTRADO' AND anonimizado_en IS NULL
      AND dia_servicio <= DATE '<fin del ciclo lectivo>')                       AS accesos_a_anonimizar,
  (SELECT count(*) FROM public.accesos_servicios
    WHERE resultado = 'DENEGADO' AND registrado_en < now() - INTERVAL '90 days') AS denegados_a_eliminar;
-- Una fecha equivocada es irreversible: si los números no son los esperados, no continuar.
-- 3. Ejecutar (una transacción; falla si todavía no pasaron 90 días):
SELECT * FROM app_private.depurar_accesos_servicios(DATE '<fin del ciclo lectivo>');
-- 4. Verificar la auditoría (quién, cuándo, cuántas filas):
SELECT * FROM app_private.depuraciones_accesos_servicios ORDER BY id DESC LIMIT 5;
```

La función se niega a correr antes de `fin de ciclo + 90 días`, pero **no puede saber si la fecha que se le pasa es la correcta**: una fecha anterior a la real anonimizaría evidencia del ciclo en curso. La previsualización del paso 2 es la mitigación; endurecer la función (parámetro de simulacro o registro de ciclos) queda como mejora posible, no incluida.

## 16. Límites medidos, riesgos y retrospectiva

### 16.1 Medición de los límites (local, endpoint real, datos sintéticos)

Script: `supabase/tests/carga_limites_accesos.mjs` (commit `29b4ed8`). Sesión real de PERSONAL, QR firmados con clave efímera, aplicación compilada (`next start`) contra el stack local. **Mide la aplicación, no producción ni a una persona.** La cadencia de escaneo de un comedor real es una **hipótesis**, no un dato.

| Qué se midió | Resultado |
|---|---|
| Latencia de una solicitud válida (30 muestras, local) | **p50 106 ms, p95 128 ms** → techo teórico ≈ **565 solicitudes/min por cuenta**: el cuello de botella **no** es la aplicación, es el límite |
| Tope por volumen | **60 solicitudes permitidas**; la 61.ª responde **429 `LIMITE_EXCEDIDO`** con `Retry-After: 900`; las 3 siguientes también 429. Quedan 60 filas `SOLICITUD` y 1 `BLOQUEO` de **15 minutos** |
| Duración del bloqueo (reloj de los contadores corrido, sin esperar) | a los 14 min: **429**; a los 16 min: **200** |
| Firmas inválidas | los **10** primeros responden 200 (`NO_RECONOCIDO`); el **11.º** responde **429**; después, **un escaneo válido también da 429** (bloqueo de la cuenta) |

Modelo de cola de **una sola cuenta** (cada solicitud cuenta, también «Ya registrado» y los reintentos):

| Segundos por alumno | Alumnos/min | Solicitudes en 5 min | ¿Alcanza el tope de 60? | Minutos hasta el primer 429 |
|---:|---:|---:|:-:|---:|
| 2 | 30 | 150 | sí | 2,0 |
| 3 | 20 | 100 | sí | 3,0 |
| 4 | 15 | 75 | sí | 4,1 |
| 5 | 12 | 60 | sí | 5,1 |
| 6 | 10 | 50 | no | — |
| 8 | 7,5 | 37 | no | — |
| 10 | 6 | 30 | no | — |

**Conclusión: el parámetro puede ser inadecuado.** Una cuenta que atienda a un alumno cada 5 s o menos (12 por minuto) es **bloqueada 15 minutos en plena fila**, y esos 15 minutos dejan sin servicio al único escáner. La pantalla muestra el resultado ~5 s y exige «Escanear siguiente», así que una cadencia de 6–10 s es plausible, pero **no se midió con una persona**.

**Recomendación (con números; NO aplicada, requiere aprobación antes de cambiar la regla productiva):**

| Parámetro | Valor actual | Propuesto | Motivo |
|---|---|---|---|
| Solicitudes por cuenta | 60 / 5 min | **150 / 5 min** (30/min, 2 s por alumno) | por encima de lo que un solo puesto atiende; sigue acotando a una cuenta autenticada (≈ 5 % del techo técnico: 150 de unas 2825 solicitudes que la aplicación admite en 5 min) |
| Bloqueo por volumen | 15 min | **2 min** | un bloqueo largo cuesta más que el abuso que evita |
| Firmas inválidas | 10 / 10 min | sin cambio | solo se alcanza por abuso; con una firma de 32 bytes, adivinar no es viable aunque no hubiera límite |
| Bloqueo por inválidos | 15 min | sin cambio | idem |

El cambio es un único `CREATE OR REPLACE` de `app_private.parametros_limite_escaneo()`; no toca el resto. **Hasta que Lucas lo apruebe, los valores siguen siendo «de partida, medidos en local, no ajustados a la operación real».** No se convierten en «valores medidos en producción».

### 16.2 Riesgos y límites honestos

1. **Límites**: ver 16.1. Medidos en local; ajuste recomendado pendiente de aprobación.
2. **Dispositivos reales sin probar** (sección 11).
3. **Dispositivo compartido sin cierre por inactividad.** No se modificó el sistema de sesiones ni se inventó un tiempo universal: una sesión de operador abierta en un teléfono compartido sigue abierta. Mitigaciones presentes: cada operador usa su cuenta, los datos del alumno se ocultan a los 5 s y el payload no persiste. **Decisión pendiente si se quiere un cierre por inactividad.**
4. **Vercel y el límite por región.** El límite es por cuenta y está en la base, no depende de la infraestructura del borde.
5. **El propietario de la base puede deshabilitar los triggers de protección** (como en las demás tablas de historial del proyecto): la garantía frente a las aplicaciones es la ausencia de privilegios, no el trigger.
6. **`service_role` es una clave poderosa.** Está solo en el servidor y la operación es la única que su rol puede ejecutar sobre estas tablas, pero una fuga de la clave sigue siendo grave: rotarla es una acción de Supabase fuera de este código.
7. **Anulación sin límite de tiempo.** Dirección puede anular un acceso de cualquier día no anonimizado. Es lo aprobado; queda auditado.
8. **`consultar_validez_credencial_qr`** (sección 13): aceptada como deuda separada.
9. **Un solo bloque de Dirección.** No hay un Director de respaldo para la anulación si el único Director está bloqueado; es una propiedad de EPT-59, no de esta historia.
10. **Purga con fecha equivocada** (hallazgo bajo de la revisión): irreversible; mitigada con la previsualización del runbook (sección 15), no con código.
11. **Un `credencial_id` en `consultar_validez_credencial_qr` no ata el `kid`** (EPT-64): la corrección de esta historia cubre el registro de accesos; esa función de solo lectura de Dirección queda dentro de la deuda de la sección 13.
12. **Memoria del navegador en la lectura de fotos**: una imagen con dimensiones enormes pero pocos bytes podría agotar memoria en el dispositivo **del propio operador** (el archivo tiene tope de 15 MB). Bajo el umbral de severidad; no se corrigió.

**Retrospectiva.** Lo que ahorró tiempo: probar la frontera con un `fetch` espía (demuestra el orden y la ausencia del token sin base) y fijar las carreras con `pg_blocking_pids` en vez de dormir; verificar una prueba nueva contra una versión mutante. Lo que costó: el puerto 3000 ocupado por un proceso ajeno, WebKit sin `MediaStream` en Windows, que una prueba ajena (`credenciales_qr_rls.sql`) asumía que `TRUNCATE` llegaba al trigger, y herramientas propias: un reemplazo de texto con `$$` rompió bloques `DO $$` y una subconsulta del fixture corría como `service_role` (que no tiene privilegios sobre la tabla, por diseño); ambos se detectaron por las propias pruebas. A mejorar: una verificación de que el usuario existe en Auth además del perfil (hoy el baneo no revoca el JWT en PostgREST; el servidor ya consulta `getUser`).

## 17. Reversión

La reversión de Git **no** deshace la base. Plan compensatorio (**documentado, no ejecutado**) que no destruye auditoría:

1. Código: revertir el PR. Las rutas dejan de existir; la base queda con las operaciones cerradas, inofensivas.
2. Base, paso mínimo (apaga la función sin perder datos): `REVOKE EXECUTE` de `public.registrar_acceso_servicio`, `public.consumir_cupo_escaneo` y `public.registrar_escaneo_invalido` (y de sus pares de `app_private`) a `service_role`, en una migración **nueva** (`..._ept_65_cerrar_registro_accesos.sql`).
3. Base, retirada total (solo si se decide): exportar antes `accesos_servicios` y `anulaciones_accesos_servicios` y recién entonces `DROP` de funciones y tablas, en ese orden (`anulaciones` antes que `accesos`; las dos referencian a `credenciales_qr`, de modo que **revertir EPT-65 es previo a revertir EPT-64**). Nunca se borran tablas con datos sin exportarlas.
4. Las pruebas de EPT-64 ya contemplan ese orden (`credenciales_qr_rls.sql`, sección R).

## 18. Plan de despliegue y postflight (DOCUMENTADO, NO EJECUTADO)

1. **Gates cerrados:** prueba en teléfonos reales (sección 11); persona y fechas **oficiales** de la retención (la sección 15 es provisional); aprobación o rechazo del ajuste de límites (16.1). La decisión sobre `consultar_validez_credencial_qr` ya está tomada (deuda separada, sección 13).
2. Confirmar el **proyecto correcto** y el **ledger**: `supabase migration list --linked` debe mostrar aplicada `20260929224534` y pendiente solo `20261001012522`.
3. **Respaldo** de la base antes de aplicar (registrar su identificador, nunca su contenido).
4. Aplicar **solo la migración pendiente** (revisar antes con `--dry-run`); la migración se autoverifica y aborta si algo no queda como se espera.
5. Verificar grants y objetos **sin datos personales** con la consulta de privilegios de la sección 6 (la operación de registro solo para `service_role`; ninguna tabla con privilegios).
6. Confirmar por **nombre, no por valor**, que existen en el servidor de producción: `SUPABASE_SERVICE_ROLE_KEY`, `QR_CREDENCIAL_KID_ACTIVA`, `QR_CREDENCIAL_CLAVES`. Nunca imprimir una clave ni un payload.
7. Integrar el código **con autorización de Lucas** (PR → revisión → merge).
8. Comprobar el despliegue: `/api/accesos-servicios/registro` responde 401 sin sesión y 405 a `GET`; `/dashboard/accesos` redirige al inicio de sesión; los encabezados `Permissions-Policy` coinciden; `/pruebas-ui/accesos` responde 404 idéntico al de una ruta inexistente.
9. **Postflight con identidades de prueba autorizadas.** **No insertar eventos de prueba en producción sin autorización explícita y un plan de limpieza:** un REGISTRADO no se puede borrar (solo anular y, a su tiempo, anonimizar); una denegación de prueba se elimina a los 90 días. Si Lucas lo autoriza, acordar de antemano qué credencial y qué día se usan y aceptar que ese evento queda anulado en la auditoría.
10. Programar la **primera purga** con el responsable y la fecha que la institución defina.

## 19. Entrega: política del repositorio, estrategia de PR y textos preparados (NO publicados)

**Política real consultada el 01/10/2026** (no se inventa ninguna): el repositorio **no tiene** `.github/` (ni plantillas de PR o de issue, ni workflows de CI), `main` **no está protegida**, las etiquetas son las predeterminadas de GitHub (sin `status:approved` ni `type:*`) y **Jira es la autoridad del requisito**. Precedente: el PR de EPT-64 (feat de la credencial QR, **7651 líneas agregadas**) se integró como un único PR.

**Tamaño.** El diff de `origin/main..HEAD` es grande (100 archivos y 9829 inserciones al cierre de esta ronda, entre migración, pruebas y 42 capturas; ya no incluye ningún archivo de EPT-13). **Estrategia a decidir por Lucas:**

- **Un PR indivisible con excepción explícita de tamaño** (recomendado): migración, servidor y pruebas dependen entre sí (el servidor llama a una operación que solo existe con la migración, y las pruebas de EPT-59/EPT-64 se adaptaron a las tablas nuevas). Partirlo deja en `main` código que referencia una operación inexistente o una base sin su único cliente. Es el precedente de EPT-64.
- **Cadena de PR**: solo sería seguro en este orden y cada eslabón desplegable por sí solo: (1) migración + pruebas SQL + tipos (inerte: nadie la llama), (2) servidor, API y pruebas, (3) pantallas. Exige que el eslabón 1 se despliegue antes que el 2, y duplica la revisión de seguridad.

**Texto del comentario para Jira (EPT-65). NO publicado; el estado recomendado es mantener «En curso»:**

> Candidato local de RF21 «Registrar accesos con QR», **todavía no listo para revisión**, sin integrar ni desplegar. Rama `codex/ept-65-accesos-qr` sobre `origin/main` `d4fa26f`; evidencia en `docs/evidence/EPT-65.md`. El operador (Dirección o Personal, con su propia cuenta) elige comedor o recorrido y sentido y lee el QR con la cámara o una foto; el servidor verifica la firma HMAC **antes** de invocar la operación de PostgreSQL, que solo ejecuta `service_role` y revalida al operador. Un `credencial_id` conocido no permite registrar nada (probado por PostgREST con sesiones reales). Incluye límite de intentos por cuenta, idempotencia por intento, anulación de Dirección que libera el cupo sin borrar historia, auditoría de solo lectura y retención con mantenimiento manual. Una revisión independiente halló dos defectos medios (el `kid` del QR no se ataba a la credencial; carrera entre anulación y purga): corregidos y probados. Pruebas sobre el código final: SQL (302 comprobaciones), concurrencia real en 12 grupos, API con sesiones reales por actor y E2E completa (1577 aprobadas, 14 omitidas de las cuales 12 son de otras historias, 0 fallos).
> **Pendiente / abierto:** (1) prueba de cámara en un Android Chrome y un iPhone Safari **reales** (la emulación no cuenta); (2) retención: responsable por cargo (Dirección o administrador principal, sin persona concreta) y fechas **ficticias provisionales** (fin de ciclo 2026-12-18, primera purga no antes del 2027-03-19) que deben reemplazarse por las oficiales; (3) límites 60/5 min y 15 min **medidos solo en local**: una cola a ≤ 5 s por alumno alcanza el tope; se recomienda 150/5 min y bloqueo de 2 min, pendiente de aprobación; (4) `consultar_validez_credencial_qr` de EPT-64 (concedida a `authenticated`, sin capacidad adicional): **aceptada como deuda separada**; (5) estrategia de PR.

**Título del PR:** `feat(accesos): registrar accesos al comedor y al transporte con QR (EPT-65)`

**Descripción del PR (se completará con el resultado de los teléfonos y la decisión de tamaño):**

> ## Qué hace
> Registra el uso del comedor y del transporte a partir del QR de la credencial (RF21): operador autenticado (Dirección o Personal) → servidor verifica la firma HMAC → operación privilegiada de PostgreSQL (solo `service_role`) que revalida al operador, bloquea, relee y decide.
>
> ## Seguridad
> - Ningún usuario autenticado puede registrar un acceso por RPC ni por tabla; un `credencial_id` no alcanza.
> - La clave HMAC vive solo en el servidor; falla cerrado. El `kid` del QR debe coincidir con el de la credencial.
> - Ningún rol de aplicación tiene privilegios sobre las tablas; Dirección lee por una función de solo lectura.
> - Límite atómico por cuenta (60/5 min, 10 inválidos/10 min, bloqueo de 15 min: valores de partida **medidos solo en local**; ajuste recomendado pendiente de aprobación).
>
> ## Pruebas (sobre el código final)
> SQL (302), concurrencia real (12 grupos), migración sobre datos, API por actor y E2E completa (1577 OK, 14 omitidas, 0 fallos). Ver `docs/evidence/EPT-65.md`.
>
> ## Despliegue ordenado
> Gate de retención resuelto → respaldo → aplicar solo la migración pendiente → verificar grants → confirmar por nombre las variables del servidor → integrar el código → postflight. **No hay migración ni cambios aplicados en producción.**
>
> ## Pendiente antes de desplegar
> Prueba en dispositivos reales; fechas y persona responsable oficiales de la purga; aprobación del ajuste de límites; deuda de `consultar_validez_credencial_qr`.

## 20. Capturas

42 capturas en `docs/evidence/EPT-65/`, sin ningún QR ni datos de personas reales (todas las identidades son sintéticas):

- `banco-<chromium|pixel-5-chromium|iphone-13-webkit>-*.png`: banco visual (escritorio y móvil, incluido 375 px): `inicio`, `transporte-375`, `registrado`, `no-habilitado`, `limite`, `sin-conexion`, `enviando`, `qr-ilegible`, `camara-denegada`, `camara-tiempo`, `auditoria`, `anular-dialogo`.
- `chromium-directora-*.png` y `chromium-personal-*.png`: pantallas reales con sesión (`escaner-registrado`, `escaner-ya-registrado`, `auditoria`, `auditoria-anulado`, `escaner-inicio`, `escaner-denegado`).

No se regeneraron en esta ronda (se corrió la E2E completa sin `EPT_CAPTURAS=1` sobre las de EPT-65); las 11 de EPT-13 que la suite ensucia se restauran (sección 12.3).

## 21. Revisión independiente de la frontera de seguridad

Revisión de **solo lectura** del diff `origin/main..cbe5989` por un revisor independiente (sin ejecutar nada ni leer más que el código), acotada a: frontera HMAC→`service_role`, privilegios, RLS, carreras, privacidad, anulación y retención, cámara y origen. No es un reporte de recibo de revisión nativa (esa modalidad no está activada en este repositorio).

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| 1 | **Medio** | La firma no estaba atada al `clave_kid` de la credencial: una clave anterior retenida y filtrada permitía falsificar el QR de una credencial emitida con otra clave | **Corregido y probado** (`cbfb78d`, decisión 12) |
| 2 | **Medio** (bajo en probabilidad) | Carrera entre anulación y purga: en ambos órdenes quedaba una anulación identificable sobre un evento anonimizado, que ninguna purga posterior volvía a anonimizar | **Corregido y probado** (`cbfb78d`, decisión 13; carrera 12; mutante) |
| 3 | Bajo | La purga acepta cualquier fecha que cumpla `fecha + 90 < hoy`; es irreversible | **Mitigado en el runbook** (previsualización); sin cambio de código |
| — | Info | 60 solicitudes en 5 min bloquean 15 min a la cuenta | **Medido y con recomendación** (sección 16.1) |

Áreas inspeccionadas sin hallazgo alto ni medio (según el revisor): los únicos llamadores de `registrar_acceso_servicio` son el servicio (tras `verificarPayload`) y el envoltorio SQL; el esquema del cuerpo es estricto y sin campos de actor ni identificadores; el actor sale de `getUser()`; el verificador limita el largo, exige ASCII, comprueba base64url canónico y compara con `timingSafeEqual` (con `kid` desconocido calcula igual el HMAC); `REVOKE ALL` sobre las tablas, funciones `SECURITY DEFINER` con `search_path` vacío y autoverificación de ACL incluido `PUBLIC`; RLS sin políticas permisivas y triggers contra `UPDATE`/`DELETE`/`TRUNCATE`; orden de bloqueos y relecturas tras esperar, índice `(operador, intento)`, advisory lock propio sin ciclo; logs solo con SQLSTATE, errores de catálogo cerrado, `no-store`, sin `localStorage`/`sessionStorage`; cámara con gesto, contexto seguro, liberación de pistas en todos los caminos y `Permissions-Policy`; `origenPermitido`, `application/json`, 405 y sesión resuelta antes de cualquier consulta. **Límites de la revisión:** no ejecutó pruebas ni tocó una base real; el escenario 2 se demostró después con la carrera 12 y su mutante, y el escenario 1 con SQL E2b–E2c. Es **una** pasada acotada: no garantiza ausencia de defectos.
