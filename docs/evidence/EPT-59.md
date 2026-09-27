# EPT-59 — RF19 Administrar usuarios y permisos: evidencia de implementación

**Estado:** tercera frontera preparada localmente, **bloqueada para el cierre**. El código,
la base y las pruebas del candidato cubren los criterios 1 a 15 en la pila local. EPT-59
**no está terminada**: el vínculo de cuentas (D5) depende de un canal SMTP productivo que
hoy no existe, y faltan la publicación de esta frontera y la verificación posterior.
No hubo revisión humana de otra integrante; se hizo una auditoría independiente
documentada (D6), en dos rondas, con hallazgos corregidos.

## 1. Resumen

- La Dirección habilitada consulta cuentas y perfiles, edita datos personales, cambia
  roles con una transición atómica y auditada, bloquea y reactiva el acceso, consulta el
  historial y vincula una cuenta nueva a un perfil existente (D5).
- El bloqueo (D4) vive en PostgreSQL: las cuatro funciones de identidad ignoran perfiles
  BLOQUEADOS y cada tabla de `public` tiene una política RESTRICTIVE. Un JWT emitido antes
  del bloqueo ve exactamente lo mismo que `anon`. El baneo en Auth es una defensa
  secundaria contra nuevos inicios y renovaciones.
- D5 usa un desafío propio de un solo uso, guardado como hash, enviado por SMTP y ligado
  a perfil, operación, correo y Director. La cuenta nace ya vinculada, dentro de la
  transacción de GoTrue, solo después de la constancia presencial y la prueba de buzón.

## 2. Alcance exacto

| Tarjeta | Relación | Estado que se deja |
|---|---|---|
| EPT-59 | Propia (tarea de EPT-3, sin subtareas) | Sin cambios de estado; se propone un comentario (§17) |
| EPT-60, EPT-65, EPT-66 | Contexto, no propias | Intactas |
| EPT-58 | Integrada | Fichas docentes, estado laboral y migración B siguen pasando sus suites |

## 3. Línea base y aislamiento

- El candidato original `70020f4` partió de `ab2299e`. Su historial mezclaba código SQL y
  aplicación; por eso no se publica tal cual. La frontera 1 quedó integrada en `ccf58b7`
  (PR #15). La frontera 2 se reconstruyó desde allí en `c4e084e` (PR #16), con la
  migración y los tipos idénticos al candidato, más preflight y documentación propios.
- Esta frontera 3 parte exactamente de `c4e084e`, en el worktree gestionado
  `ept59-app`, rama `codex/ept-59-aplicacion`; conserva la frontera SQL intacta y
  transfiere solo aplicación, pruebas, dependencias, configuración local y evidencia.
  La integración de PR #16 y la aplicación productiva de SQL deben verificarse antes de
  publicar la aplicación. No se tocó el checkout del candidato original.
- Worktree auxiliar desechable `MetodologiaTPI-ept59-compat` en `0e3f615` para probar la
  compatibilidad del orden de despliegue (§14).
- Pila local: GoTrue v2.196.0, PostgreSQL 17.6, Mailpit v1.30.2, Supabase CLI 2.118.0.

## 4. Contrato y decisiones de implementación

| Decisión | Implementación |
|---|---|
| D1 PERSONAL | Solo Inicio y Mi perfil (lectura). Menú y guardas de servidor; el resto muestra «Acceso restringido» y las API responden 403. |
| D2 ESTUDIANTE | `cambiar_rol_perfil` rechaza ESTUDIANTE en ambos sentidos (P5907). |
| D3 PADRE | Salir de PADRE exige cero filas en `padres_hijos` (P5910); nunca se borran vínculos. |
| D4 Bloqueo | `perfiles.estado_acceso` independiente de la cuenta y de las fichas; auxiliares filtrados, RESTRICTIVE en todas las tablas, guardas de servidor, pantalla «Acceso bloqueado», baneo secundario. |
| D5 Vínculo | Reserva idempotente de 15 min, DNI reingresado y constancia presencial; desafío propio por SMTP; enlace atómico por trigger sobre `auth.users`. Apagado salvo `EPT_VINCULO_CUENTAS=habilitado` con SMTP configurado. |
| D6 Revisión | Auditoría independiente en dos rondas por revisores de contexto separado; hallazgos y correcciones en §12. |

Decisiones técnicas relevantes:

- **Desafío propio en lugar del OTP de GoTrue.** La sonda del preflight mostró que, con
  confirmación automática, `signInWithOtp` marca el correo como confirmado **al enviar**,
  la plantilla por defecto no trae código y el token no queda ligado a la operación ni al
  Director. No sirve como prueba de control del buzón.
- **La cuenta nace vinculada.** No existe un usuario Auth provisional: la cuenta se crea
  al final con `createUser({ id: cuenta_id, app_metadata.ept_vinculo })` y el trigger
  `enlazar_perfil_al_crear_cuenta` enlaza el perfil en la misma transacción. Si cualquier
  condición falla, GoTrue revierte todo (500) y no queda cuenta.
- **`email_confirm: true`** solo se alcanza después de una prueba de buzón registrada en la
  base; el trigger rechaza el enlace sin ella (P5944). No sustituye la prueba.
- **La contraseña** la elige la persona titular en el acto presencial, en campos
  enmascarados que nunca se registran ni se devuelven (riesgo residual en §15).
- **Orden de candados** en el cambio de rol: candado consultivo → ficha de profesor →
  perfil, el mismo que usan EPT-58 y sus triggers, para evitar ciclos de espera (40P01).

## 5. Preflight

| Comprobación | Resultado |
|---|---|
| `postgres` (dueño de `app_private.*`) lee `auth.users` | Sí, localmente y en el preflight productivo de solo lectura del 27/09/2026; columnas `deleted_at`, `banned_until`, `email_confirmed_at`, `is_anonymous` presentes. Repetir antes de aplicar (§14). |
| Transacción de GoTrue (`createUser`, `updateUserById`, `ban_duration`) | Una sola transacción; un trigger que falla devuelve 500 y no deja cuenta ni cambios. |
| Baneo con JWT previo | Login y renovación rechazados (`user_banned`); `/auth/v1/user` 403; **PostgREST acepta el JWT (200)** → la barrera tiene que estar en PostgreSQL. |
| OTP de GoTrue | Confirma el correo al enviar con autoconfirmación; sin código en la plantilla por defecto. Descartado como prueba. |
| Canal de correo local | Mailpit recibe por SMTP en `127.0.0.1:54325` (`[local_smtp] smtp_port` habilitado en `supabase/config.toml`). |
| Canal de correo productivo | **No existe.** `[auth.email.smtp]` está comentado y la aplicación no tiene variables `EPT_SMTP_*` en producción. D5 queda apagado. |

El preflight productivo de la frontera 2 (seis consultas, código 0) está detallado en
`docs/evidence/EPT-59-migracion.md`: historial hasta `20260926154000`, EPT-59 ausente,
dos Directores efectivos, cero perfiles huérfanos y cero perfiles sin rol. Es una
fotografía previa, no autorización para aplicar la migración sin repetirla.

## 6. Arquitectura de autorización

1. **PostgreSQL (primaria).** `app_private.es_director()`, `rol_actual()`,
   `perfil_actual()` y `mis_hijos_ids()` ignoran perfiles BLOQUEADOS; toda RPC existente
   autoriza por ellas (las 52 funciones DEFINER usan `auth.uid()` solo para exigir sesión).
   `app_private.acceso_bloqueado()` alimenta una política RESTRICTIVE en cada tabla de
   `public`. Las funciones privilegiadas viven en `app_private` con `search_path = ''`;
   los envoltorios de `public` son `SECURITY INVOKER` con EXECUTE mínimo.
2. **Servidor (capa de acceso a datos).** `requerirSesion`, `requerirRol`,
   `requerirSesionConRol` y `requerirDirector` consultan `mi_estado_acceso` y responden 403
   `ACCESO_BLOQUEADO`. Usuarios, su detalle y Legajos son Server Components con guarda.
3. **Experiencia.** El layout de `/dashboard` redirige a `/acceso-bloqueado`; el contexto
   de autenticación lo detecta en la navegación del cliente. La visibilidad del menú nunca
   autoriza. El proxy no consulta la base (lo desaconseja la guía de Next 16).
4. **Auth (secundaria).** Bloquear: base primero, después baneo. Reactivar: se levanta el
   baneo y después la base. Tras cada escritura en Auth se relee la base con el cliente
   administrativo y se alinea el baneo.

## 7. Inventario de superficies

| Superficie | Cobertura para un bloqueado |
|---|---|
| 26 tablas de `public` | RESTRICTIVE por comando; superficies públicas iguales a `anon` (`actividades`, `galeria`, `menu_escolar`, `noticias` en lectura; `opiniones` aprobadas y alta pendiente; alta de `postulaciones` y `solicitudes_inscripcion`). |
| 6 vistas | `security_invoker = true`: heredan RLS. |
| RPC de `public` (61) | Rechazan o no devuelven datos protegidos; probado por rol. |
| Auxiliares de identidad | Filtrados por estado; incluye `mis_hijos_ids()`. |
| `calcular_porcentaje_asistencia` | INVOKER, bajo RLS: 0 filas. `verificar_cupo_actividad` es de trigger. |
| `app_private` | Sin GRANT de tabla para roles de aplicación; `service_role` solo ejecuta las 4 funciones del desafío. |
| Storage | Sin buckets ni políticas. |
| Realtime | Publicación `supabase_realtime` sin tablas; sin políticas en `realtime.messages`. |
| TRUNCATE | Revocado a `anon` y `authenticated` en todo `public` (estaba abierto en `noticias`, `galeria`, `menu_escolar`). |
| Rutas y API | Guardas de servidor en `/dashboard` (layout), Usuarios, detalle, Legajos y las 13 rutas de `/api/usuarios/**`. |

## 8. Matriz criterio → implementación → prueba → resultado

| # | Criterio | Implementación | Prueba | Resultado |
|---|---|---|---|---|
| 1 | Cambio de rol por RPC atómica con historial | `app_private.cambiar_rol_perfil`, `perfiles_historial` | SQL 21–27; `usuarios-permisos-auth` (UI y API) | OK |
| 2 | UPDATE directo, autoelevación y autobloqueo rechazados | Sin GRANT de columna; P5903 | SQL 05, 28, 30 | OK |
| 3 | ESTUDIANTE, DOCENTE, PADRE en ambos sentidos | P5907, P5911, P5910; ficha única al entrar a DOCENTE | SQL 23–26; concurrencia b1–b4 | OK |
| 4 | Último Director efectivo, Auth ausente/no confirmada/baneada/borrada/anónima, carreras | `contar_directores_efectivos`, candado 59001, P5912, P5913 | SQL 31, 46; concurrencia a1–a3; API 409 | OK |
| 5 | Rol esperado obsoleto → 409 sin cambios | P5909 | SQL 22, 30; concurrencia c2, d; UI | OK |
| 6 | Bloqueado con JWT previo = `anon` en los cinco roles; sin 42P17 | Auxiliares + RESTRICTIVE | SQL 07–17 (3417 evaluaciones); `usuarios_bloqueo_auth` sección 1 | OK |
| 7 | Bloqueado no inicia ni renueva; reactivación coherente | Baneo secundario, orden de reactivación, `converger` | `usuarios_bloqueo_auth` 2–4i; UI | OK |
| 8 | Bloquear no cambia fichas; inactivar una ficha no bloquea | Estado independiente | `usuarios_bloqueo_auth` 2 y 5 | OK |
| 9 | PERSONAL, sin perfil, 403 | Menú, guardas, pantallas | E2E por actor | OK |
| 10 | Legajos sin DIRECTOR; INSERT directo cerrado | Frontera 1; política «Dirección crea legajos sin cuenta»; fecha fijada por la base | SQL 33, 50; E2E | OK |
| 11 | Historial solo agregable y consultable por Dirección | Triggers de fila y de TRUNCATE, RLS | SQL 29 | OK |
| 12 | D5: mismo perfil, rechazos, reconciliación, sin borrados | Reservas, desafío, trigger de enlace, P5914 | SQL 34–45, 47–49; `usuarios_vinculo_cuenta` (103); E2E con Mailpit | OK en local |
| 13 | Catálogo: DEFINER privado, INVOKER público, grants mínimos, RLS, sin DELETE/TRUNCATE | Migración y autoverificación | SQL 01–06 | OK |
| 14 | Español, teclado, foco, 1280 y 375 px | Interfaz nueva | E2E (61 pruebas) y capturas | OK |
| 15 | Reset, migración versionada, tipos, suites sin regresión | §10 | §10 | OK |

## 9. Matriz de permisos

| Actor | Usuarios (API y pantallas) | Datos protegidos | Superficie pública |
|---|---|---|---|
| Anónimo | 401 | No | Sí |
| Sin perfil | 403 | Comportamiento previo (sin cambios) | Sí |
| DIRECTOR habilitado | 200/201; no se administra a sí mismo | Los ya aprobados | Sí |
| DOCENTE, ESTUDIANTE, PADRE habilitados | 403 | Solo los ya aprobados (sin ampliar) | Sí |
| PERSONAL habilitado | 403 | Solo Mi perfil | Sí |
| Cualquier rol BLOQUEADO | 403 `ACCESO_BLOQUEADO` | Ninguno (igual a `anon`); solo `mi_estado_acceso` | Igual a `anon` |

## 10. Comandos ejecutados y códigos de salida

La tabla siguiente conserva la evidencia **histórica del candidato `70020f4`**, ejecutada
contra su pila local descartable; no sustituye la verificación de esta rama. La única
consulta productiva realizada para las fronteras fue el preflight de solo lectura de
la frontera 2, registrado en `docs/evidence/EPT-59-migracion.md`.

| Orden | Salida | Resultado |
|---|---|---|
| `git fetch origin --prune`; `git rev-parse origin/main` | 0 | `ab2299eb…` |
| `npx supabase db reset` (cadena completa, 20 migraciones) | 0 | `migration list --local`: 001 … 20260926190000 |
| Migración sobre datos previos (`--version 20260926154000` + datos de todos los roles, huérfano, rol nulo, Director sin confirmar y baneado + `migration up`) | 0 | Huella de 9 tablas idéntica antes y después; diagnóstico: 1 Director efectivo, 1 huérfano, 1 rol nulo |
| `npx supabase gen types` + `node supabase/tests/tipos-generados.mjs` | 0 | tipos reconciliados |
| `npx supabase db lint --local --level warning` | 0 | sin errores de esquema |
| `npx supabase db advisors --local --type security` / `performance` | 0 | solo hallazgos preexistentes (§11) |
| `npx.cmd tsc --noEmit --incremental false` | 0 | limpio |
| `npx.cmd eslint <archivos cambiados>` | 0 | 0 errores, 1 advertencia heredada |
| `npm run lint -- --no-cache` | 1 | 14 errores preexistentes en archivos no tocados (§11) |
| `npm run build` (URL y clave anónima locales en memoria) | 0 | rutas nuevas dinámicas |
| `node supabase/tests/correr-autenticadas.mjs` (Playwright completo) | 0 | **708 aprobadas, 1 omitida preexistente, 0 fallidas** |
| `node supabase/tests/correr-autenticadas.mjs tests/usuarios-permisos-auth.spec.ts` (con y sin `EPT_CAPTURAS=1`) | 0 | 61 aprobadas; 26 capturas |
| `git diff --check ab2299eb` | 0 | limpio |

### 10.1 Batería final de base (después del último reset)

| Suite | Usuario | Salida | Líneas OK |
|---|---|---|---|
| `usuarios_permisos_rls.sql` | supabase_admin | 0 | 46 (3417 evaluaciones de matriz, sin 42P17) |
| `usuarios_alta_atomica.sql` | supabase_admin | 0 | 23 |
| `perfiles_privacidad_rls.sql` · `profesores_rls.sql` · `alumnos_academicos_rls.sql` | postgres | 0 | 4 · 19 · 69 |
| `inscripcion_hijos_rls.sql` | postgres | 0 | sin líneas OK por diseño |
| `comedor_rls.sql` · `deportes_rls.sql` · `horarios_rls.sql` · `horarios_academicos_rls.sql` | postgres | 0 | 31 · 59 · 44 · 8 |
| `cursos_rls.sql` · `materias_rls.sql` · `niveles_rls.sql` · `reconciliacion_esquema_remoto.sql` | postgres | 0 | 39 · 44 · 73 · 42 |
| `usuarios_permisos_concurrencia.mjs` | — | 0 | 13 (11 carreras) |
| Concurrencia de profesores, alumnos, comedor, deportes, horarios, horarios académicos, niveles | — | 0 | 9 · 8 · 4 · 10 · 11 · 4 · 4 |
| `profesores_postgrest.mjs` · `profesores_paridad.mjs` · `horarios_paridad.mjs` · `tipos-generados.mjs` | — | 0 | 44 · 1 · 1 · 4 |
| `usuarios_reconciliacion.mjs` (altas reales contra GoTrue, con P5914 activa) | — | 0 | 180 |
| `usuarios_bloqueo_auth.mjs` | — | 0 | 165 afirmaciones |
| `usuarios_vinculo_cuenta.mjs` | — | 0 | 103 afirmaciones |

### 10.2 Resultados de concurrencia

| Carrera | Resultado |
|---|---|
| (a1–a3) dos Directores se degradan o bloquean entre sí; uno degrada a dos | Una operación gana; nunca quedan cero Directores efectivos (42501 o P5912 para la otra) |
| (b1–b4) DOCENTE→PERSONAL contra reactivar ficha y asignar materia o crear grupo | Nunca queda un no DOCENTE a cargo (P5611 o P5911) |
| (c1) bloqueo contra cambio de rol | Se serializan; ambos registrados en el historial |
| (c2, d) doble modificación con el mismo valor esperado | Una gana; la otra P5909 sin cambios |
| (e) dos Directores reservan el mismo perfil (D5) | Una reserva; la otra P5922 |
| 4h / 4i (Auth real, intermediario que retiene el baneo) | Auth termina igual a la base; 4h y 4i **fallan sin sus correcciones** |

### 10.3 Verificación de la tercera frontera (27/09/2026)

Se ejecutó en el proyecto local exclusivo `ept59-app-isolated` (PostgreSQL 17.6,
Supabase CLI 2.118.0, Mailpit con SMTP en `127.0.0.1:56325`), sin tocar el stack
compartido ni producción. La migración EPT-59 se aplicó al iniciar esa pila.

| Comprobación | Código | Resultado |
|---|---:|---|
| `npm ci` | 0 | Dependencias instaladas; el auditor informó 6 vulnerabilidades del árbol de dependencias (1 baja, 1 moderada, 4 altas), sin aplicar actualizaciones automáticas. |
| `npx tsc --noEmit` | 0 | Sin errores. |
| `npm run build` con URL y clave pública de la pila aislada | 0 | Compilación, TypeScript y generación de rutas completas. |
| ESLint sobre archivos TS/TSX/MJS de esta frontera | 0 | 0 errores, 1 advertencia de `watch()` de React Hook Form. |
| `node supabase/tests/usuarios_bloqueo_auth.mjs` | 0 | 165 afirmaciones, 0 incumplidas. |
| `node supabase/tests/usuarios_vinculo_cuenta.mjs` | 0 | 103 afirmaciones, 0 incumplidas; SMTP y Mailpit exclusivamente locales. |
| `node supabase/tests/correr-autenticadas.mjs tests/usuarios-permisos-auth.spec.ts --reporter=dot` | 0 | 61 aprobadas. |
| `node supabase/tests/correr-autenticadas.mjs --reporter=dot` | 0 | 708 aprobadas, 1 omitida preexistente, 0 fallidas. |

Se pasó `EPT_SUPABASE_DB_CONTAINER=supabase_db_ept59-app-isolated` y
`EPT_TEST_SMTP_PORT=56325` a los arneses para que nunca apunten a la pila compartida.
Las seis capturas de EPT-13 reescritas por la batería se restituyeron desde la base
inicial de este worktree; no se incluyeron en esta frontera. El árbol combinado se
comparó por hash con las 832 rutas del candidato `70020f4`: no faltan archivos.
Las únicas diferencias intencionales son este documento, `README.md` (advertencia
de D5 productivo apagado) y dos arneses que permiten variar el puerto SMTP local.
Además se conservan los dos archivos propios de la frontera 2: el preflight SQL y
`EPT-59-migracion.md`. El SQL y los tipos de PR #16 permanecen idénticos.

## 11. Regresiones y fallos preexistentes

- `npm run lint -- --no-cache`: 14 errores, **todos en archivos que EPT-59 no tocó**
  (`(public)/inscripcion`, `(public)/noticias`, `(public)/quienes-somos`, `asistencias`,
  `solicitudes`, `testimonios`, `global-error`, `login/page.tsx`); la configuración de
  ESLint no cambió. ESLint sobre los archivos cambiados: 0 errores, 1 advertencia heredada
  (`watch()` de react-hook-form, ya presente en `ab2299eb`).
- `npm run build` sin variables de Supabase falla al prerenderizar `/_not-found`
  («Missing Supabase env vars»), comportamiento preexistente documentado en EPT-9, EPT-10
  y EPT-57. Con la URL y la clave anónima locales inyectadas en memoria: OK.
- Playwright completo: 1 omitida preexistente (`comedor-ui`, teclado en WebKit táctil).
- Pruebas existentes adaptadas (cada cambio lleva un comentario en el archivo):
  - Ocho suites SQL que contaban políticas por nombre ahora cuentan solo las permisivas:
    la RESTRICTIVE de bloqueo no concede nada.
  - `perfiles_privacidad_rls.sql`: espera la nueva política de alta de legajos.
  - `tests/semantica-estatica.spec.ts`: sigue al shell movido a `PanelDashboard.tsx`.
  - `tests/auth.setup.ts`: cinco identidades bloqueadas con sesión previa al bloqueo; la
    limpieza borra también historial y reservas de los perfiles que ya borraba antes
    (la base local es descartable por diseño desde EPT-8).

## 12. Auditoría independiente (D6)

Revisores de contexto separado, en solo lectura, sobre los commits del candidato. **No es
una revisión humana.** El primer intento con el revisor `review-risk` se rechazó sin
revisar (su contrato solo admite el circuito de Gentle AI) y se repitió con otro revisor.

| Ronda | Hallazgo | Severidad | Resolución | Prueba |
|---|---|---|---|---|
| 1 | El alta atómica (010) entregaba un perfil huérfano a una cuenta nueva | Media | P5914 | SQL 47 |
| 1 | Un baneo demorado podía pisar una reactivación (cero Directores efectivos) | Media | `converger` | 4h (falla sin la corrección) |
| 1 | La contraseña se escribe en el dispositivo de Dirección | Media (diseño) | Riesgo residual documentado | — |
| 1 | Promover a DIRECTOR un perfil sin cuenta | Baja | P5913 | SQL 46 |
| 1 | Alta pública abierta y autoconfirmada | Baja (preexistente) | Documentado para EPT-66 | — |
| 1 | Sin tope de envíos entre operaciones | Baja | Topes por correo y por Director | SQL 48–49 |
| 2 | Un Director podía fijar `fecha_creacion` al insertar | Baja | Trigger `fijar_fecha_creacion_perfil` | SQL 50 |
| 2 | `converger` releía con la sesión del operador y se salteaba ante un corte | Media | Relectura administrativa y convergencia siempre | 4i |
| 2 | Tope por Director contaba operaciones; envíos concurrentes sin serializar | Baja | Cuenta envíos (60/h) y candados por Director y correo | SQL 48–49 |
| 2 | Login mostraba el texto de GoTrue en inglés a una cuenta baneada | Baja | Mensajes en español por código | E2E de bloqueo |
| 2 | Restauración inexacta de la Directora en una prueba | Info | Valor original restituido | — |

## 13. Capturas

`docs/evidence/EPT-59/`: 26 capturas (escritorio 1280 y móvil 375) del listado, detalle,
diálogo de rol, bloqueo, asistente D5 (pasos 1–4), acceso bloqueado, inicio de PERSONAL,
sin perfil y selector de Legajos. Datos ficticios, correos enmascarados, sin códigos ni
contraseñas. En las capturas móviles de página completa la barra inferior fija aparece a
mitad de página por el cosido de la captura, no por el diseño.

## 14. Despliegue, orden y reversión

Cada frontera se publica por separado; **no** debe abrirse una única PR que haga que
Vercel publique la aplicación dependiente antes de aplicar la migración.

1. **Frontera 1 — aplicación compatible** (`0e3f615`, PR #15 integrado en `ccf58b7`):
   Legajos sin DIRECTOR. Funciona sin la migración y con ella (§14.1).
2. **Frontera 2 — migración** (`c4e084e`, PR #16): SQL
   `20260926190000_ept_59_usuarios_permisos.sql`, tipos y pruebas de base. Su
   preflight productivo de solo lectura pasó el 27/09/2026, pero debe repetirse en la
   ventana y acompañarse con respaldo de `public.perfiles`. La migración cambia de
   inmediato el INSERT directo de perfiles y revoca TRUNCATE; la frontera 1 es compatible.
3. **Frontera 3 — aplicación de administración** (`codex/ept-59-aplicacion`): servidor,
   interfaz, pruebas y configuración de Mailpit **solo local**. Publicarla únicamente
   después de confirmar el merge de PR #16, aplicar y verificar su SQL en producción.
   No configurar `EPT_SMTP_*` ni `EPT_VINCULO_CUENTAS=habilitado` en producción en esta
   frontera: D5 debe seguir deshabilitado hasta disponer de canal y autorización propios.

**Reversión** (`docs/evidence/EPT-59/reversion/R-59_compensacion_no_destructiva.sql`,
borrador no aplicado): vuelve a la aplicación de la frontera 1, deja dormidas las
funciones nuevas, retira el trigger de enlace y cierra las reservas pendientes. **No**
reabre el acceso a bloqueados, no borra historial ni reservas y no restituye la política
de INSERT anterior.

### 14.1 Compatibilidad comprobada

Worktree desechable en `0e3f615` (frontera 1), suites `usuarios-auth`,
`gestion-estudiantes-auth` (Asistencias y Cupos) y `alumnos-auth` (Legajos):

| Base | Aplicación | Resultado |
|---|---|---|
| Hasta `20260926154000` (sin EPT-59) | Frontera 1 | **112 aprobadas, 0 fallidas** |
| La misma base + `migration up` (solo `20260926190000`) | Frontera 1 | **112 aprobadas, 0 fallidas** |

La reversión R-59 se aplicó dentro de una transacción descartable: pasó sus
autoverificaciones y, al revertirse, el estado quedó intacto.

## 15. Riesgos y trabajo fuera de alcance

- **Canal SMTP productivo inexistente** → D5 apagado; bloquea el cierre de EPT-59.
- **Confianza en la verificación presencial.** La Dirección declara la constancia y el
  DNI reingresado lo puede ver; un Director malintencionado podría usar su propio buzón.
  Es inherente a un trámite presencial; mitigaciones posibles (a decidir): que la persona
  fije la contraseña desde un enlace a su buzón y aviso posterior al titular.
- **Alias de buzón** (`a+b@`) cuentan como correos distintos para el tope.
- **Alta pública abierta** (`enable_signup = true`, confirmación automática en local):
  una cuenta nueva «sin perfil» lee lo que ya leía antes (tablas `USING (true)` para
  `authenticated`). Pertenece a EPT-66.
- **Tablas futuras** de `public` no reciben la RESTRICTIVE automáticamente; su migración
  debe agregarla (la suite SQL la exige para todas las tablas existentes).
- **Privilegios por defecto de `supabase_admin`** y secuencias con USAGE para roles de
  aplicación: preexistentes, para EPT-66.
- Parámetro `redirect` del login preexistente sin validación de origen: para EPT-66.

## 16. Retrospectiva

- La sonda contra GoTrue real cambió el diseño de D5 antes de escribir código.
- Delegar la base, el servidor y la interfaz a escritores separados con una
  especificación escrita funcionó; la auditoría independiente encontró dos defectos
  reales de concurrencia que las pruebas del escritor no cubrían.
- Una prueba nueva se valida viéndola fallar sin la corrección (4h).

## 17. Jira

Comentario propuesto para EPT-59 (**no publicado**; requiere actualización con la evidencia
de esta tercera frontera antes de cualquier uso):

> La aplicación de EPT-59 se preparó localmente en `codex/ept-59-aplicacion`, encima de
> la frontera SQL de PR #16. D1–D4 y la administración de usuarios están implementadas;
> D5 conserva su bloqueo por configuración y no debe activarse en producción sin SMTP
> y decisión explícita. La publicación de la aplicación espera confirmar el merge y la
> aplicación productiva de la migración, además de revisión y pruebas de integración.
> Evidencia: `docs/evidence/EPT-59.md` y `docs/evidence/EPT-59-migracion.md`.

Recomendación de transición: pasar a **«En curso»**. No a «Listo»: faltan el canal SMTP,
la publicación ordenada, la integración y la comprobación posterior.

## 18. Reproducción

Ejecutar exclusivamente en una pila Supabase local descartable y exclusiva; no reiniciar
ni borrar una pila compartida. Si se usa otro `project_id`, ajustar el contenedor y
`EPT_TEST_SMTP_PORT` al puerto SMTP local correspondiente. No ejecutar en producción.

```bash
npx supabase start
npx supabase db reset
docker exec -i supabase_db_educar-para-transformar psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/usuarios_permisos_rls.sql
node supabase/tests/usuarios_permisos_concurrencia.mjs
node supabase/tests/usuarios_bloqueo_auth.mjs
node supabase/tests/usuarios_vinculo_cuenta.mjs
node supabase/tests/correr-autenticadas.mjs
```

`tests/hijos-auth.spec.ts` y `tests/hijos-ui.spec.ts` pueden reescribir capturas de
EPT-13. Revisar el diff de esos archivos después de correrlas; no restituir cambios
ajenos automáticamente.

Variables de la aplicación para D5: `EPT_VINCULO_CUENTAS=habilitado`, `EPT_SMTP_HOST`,
`EPT_SMTP_PORT`, `EPT_SMTP_SECURE`, `EPT_SMTP_USUARIO`, `EPT_SMTP_CLAVE`,
`EPT_SMTP_REMITENTE`. En local, `correr-autenticadas.mjs` las inyecta apuntando a Mailpit
(`127.0.0.1:54325`).
