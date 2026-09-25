# EPT-58 — Etapa 2 (aplicación): evidencia de implementación

**Estado:** candidato local **listo para revisión** (`ready_for_review`). Rama `codex/ept-58-profesores-app`,
worktree `MetodologiaTPI-ept58-app`, base `origin/main` =
`a000ede036aef60d5beec58a162756ae9521a0ff`. Sin push, PR, merge, despliegue,
`db push`, acceso a datos de producción ni cambios en Jira. La migración B
**no existe** en esta rama: su compatibilidad se probó solo con una simulación
local descartable (sección 8).

## 1. Resumen

- **Qué agrega:** `/dashboard/profesores` para Dirección (todas las fichas,
  «Ficha incompleta», edición de legajo y especialidad, inactivación y
  reactivación con motivo, historial y relaciones vigentes/históricas) y
  `/dashboard/mis-asignaciones` para DOCENTE (su ficha, materias, cursos,
  niveles, grupos y horario semanal; lo inactivo aparte). Ambas en el menú solo
  para su rol. Tres rutas de API sobre las RPC de la migración A.
- **Qué adapta:** Asistencias y Cupos obtienen nombre, apellido y legajo de los
  alumnos por `listar_estudiantes_para_gestion()` y ya no por la lectura de
  `perfiles`, con el mismo conjunto de alumnos y las mismas operaciones. Así
  siguen funcionando cuando B cierre la lectura global de perfiles.
- **Qué NO cambia:** ninguna migración, política, función ni privilegio. La
  política «Directores y docentes ven todos los perfiles» sigue vigente. No hay
  `service_role` en la aplicación, ni escrituras directas en las tablas nuevas,
  ni funciones `SECURITY DEFINER` nuevas.

## 2. Alcance exacto

| Dentro (etapa 2) | Fuera |
|---|---|
| Pantallas Profesores y Mis asignaciones, con carga, error y vacío | Migración B y su aplicación (etapa 3) |
| API `GET /api/profesores`, `GET`/`PATCH /api/profesores/{id}`, `GET /api/mis-asignaciones` | Bloqueo de cuenta y transición de rol (EPT-59) |
| Navegación por rol | Editor del profesor de un grupo deportivo |
| Asistencias y Cupos sobre la consulta mínima | Regla de superposición de horarios del docente |
| Mensaje en español del rechazo P5605 en Materias y Deportes | Cierre de permisos preexistentes de asistencias e inscripciones (EPT-66) |
| Paridad de normalización cliente/servidor/PostgreSQL | EPT-60 a EPT-63 |

## 3. Línea base y aislamiento

| Comprobación | Resultado |
|---|---|
| `git fetch origin --prune` y `git rev-parse origin/main` | `a000ede036aef60d5beec58a162756ae9521a0ff` (PR #12 mergeada) |
| Rama y worktree nuevos | `codex/ept-58-profesores-app` en `E:/Escritorio/codigo/MetodologiaTPI-ept58-app`, sin upstream |
| Rama de la etapa 1 | `codex/ept-58-admin-profesores` sin commits nuevos |
| Checkout principal | No se usó ni se copió nada de él (`.atl/`, `.claude/`, `AGENTS.md`, `docs/` intactos) |
| Dependencias | `npm ci` propio del worktree |
| Credenciales | Sin `.env.local`: `supabase/tests/correr-autenticadas.mjs` inyecta las del stack local y se niega a correr si la API no es de bucle local |
| Migraciones | Ninguna nueva; `001`–A sin editar (`git diff a000ede -- supabase/migrations` vacío) |
| Next.js | Instalado 16.3.3. Antes de escribir se leyeron en `node_modules/next/dist/docs/` las guías de Route Handlers (métodos no declarados → 405, `params` como `Promise`), `error.js` (`retry`) y `loading.js` |

## 4. Decisiones de implementación

- **Superficie HTTP mínima.** Dirección: `GET /api/profesores` (listado),
  `GET /api/profesores/{id}` (ficha, relaciones, horarios e historial) y
  `PATCH /api/profesores/{id}` con un cuerpo discriminado
  (`actualizar_ficha` | `cambiar_estado`). DOCENTE: `GET /api/mis-asignaciones`,
  que no recibe identificador: la base resuelve el perfil por `auth.uid()`.
  Ningún `POST`, `PUT` ni `DELETE` (Next.js responde 405).
- **Autorización en dos capas.** Cada ruta verifica la sesión con
  `auth.getUser()` y el rol (`requerirDirector` / `requerirRol('DOCENTE')`)
  **antes** de mirar el identificador o el cuerpo; después la RPC vuelve a
  verificar identidad y rol en PostgreSQL. Ocultar un enlace no reemplaza
  ninguna de las dos.
- **Solo RPC de A.** Lecturas: `listar_profesores`, `consultar_ficha_profesor`,
  `listar_asignaciones_profesor`, `listar_horarios_profesor`,
  `listar_historial_estados_profesor`, `listar_estudiantes_para_gestion`.
  Escrituras: `actualizar_ficha_profesor` y `cambiar_estado_profesor`. El
  cliente de servidor usa la sesión del usuario (cookies SSR).
- **Errores de dominio.** `profesores.service.ts` traduce cada SQLSTATE
  (P5600–P5612, P5505, 42501, 23505, P5515) a un estado HTTP y a un mensaje en
  español, con el campo afectado cuando corresponde. Un P5610 lista las
  materias y grupos que impiden inactivar, leídos del `DETAIL` validado con
  Zod, sin identificadores internos. Lo inesperado responde 500 genérico y se
  registra solo en el servidor.
- **Normalización idéntica a PostgreSQL.** `src/lib/profesores.ts` usa la misma
  clase explícita de espacios del contrato (U+0009–U+000D, U+0020, U+0085,
  U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000,
  U+FEFF) escrita con escapes ASCII, no `\s`. La usan el formulario, Zod del
  servidor y la prueba de paridad.
- **Correo y datos personales.** Ninguna respuesta incluye correo. DNI,
  teléfono, dirección y nacimiento solo aparecen en el detalle de Dirección,
  que ya los administra en Alumnos/Usuarios; el DOCENTE ve solo su ficha.
- **Asistencias y Cupos.** Las filas de asistencia e inscripción se leen sin
  embeber `perfiles` (`id, fecha, estado, estudiante_id` / `id, estudiante_id`)
  y el nombre se resuelve con un mapa por `id` de la consulta mínima. Si un
  alumno no está en la consulta se muestra «Estudiante no disponible». Las
  vistas de ESTUDIANTE y PADRE no cambian.

## 5. Matriz criterio → implementación → prueba → resultado

| CA | Implementación (etapa 2) | Prueba | Resultado |
|---|---|---|---|
| CA-04 | Insignia «Ficha incompleta», filtro, aviso en Mis asignaciones; Zod exige legajo y especialidad | `profesores-ui` «lista las fichas…», «edita la ficha…»; `profesores-auth` DIRECTOR «completa la ficha…» | Pasa |
| CA-05 | `normalizarEspecialidad`, `especialidadSchema` 2–100, mensajes en español | `profesores_paridad.mjs` (748 textos); `profesores-ui` «edita la ficha…» (U+0085/U+00A0); `profesores-auth` guarda «Ciencias Sociales» normalizada; API 400 | Pasa |
| CA-06 | Diálogo de inactivación con la lista de bloqueos del P5610 | `profesores-auth` «rechaza inactivar con una materia activa…» y «…con un grupo deportivo activo» (estado y historial sin cambios en la base); `profesores-ui` «explica qué impide inactivar…» | Pasa |
| CA-07 | Mensaje en español del P5605 en Materias y Deportes | `profesores-auth` «inactiva con motivo, impide asignarlo…» (409 en `/api/asignaciones-materias`) | Pasa |
| CA-08 | Reactivación con aviso de requisitos; P5612/P5611 traducidos | `profesores-auth` «rechaza reactivar una ficha incompleta…»; `profesores-ui` «anuncia qué exige la reactivación» | Pasa |
| CA-09 | Motivo opcional ≤500 recortado; historial de solo lectura en el detalle | `profesores-auth` historial «Activo → Inactivo», motivo y «Por Ana Directora»; `profesores-ui` motivo >500 rechazado | Pasa |
| CA-10 | Mis asignaciones no depende del estado de la ficha | `profesores-auth` «con la ficha INACTIVO sigue iniciando sesión…» (inicio de sesión real) | Pasa |
| CA-13 | Rutas por rol y RPC por `auth.uid()` | `profesores-auth` DOCENTE: 403 en `/api/profesores` y `/api/profesores/{ajeno\|propio}`, `PATCH` 403, solo lo propio en `/api/mis-asignaciones`; `profesores_postgrest.mjs` | Pasa |
| CA-14 | Secciones «A cargo actualmente» y «Relaciones históricas» | `profesores-ui` «separa lo vigente…»; `profesores-auth` DOCENTE (histórica fuera de vigentes) | Pasa |
| CA-15 | Menú por rol, español, 1280/375 sin desplazamiento horizontal, teclado y foco | `profesores-ui` en Chromium, Pixel 5 y iPhone 13; `profesores-auth` 1280 y 375 con sesión real | Pasa |
| CA-16 | Sin cambios de esquema; la aplicación no lee `perfiles` ajenos | Simulación local de B (sección 8) | Compatibilidad local probada; CA-16 se cierra en la etapa 3 |
| CA-17 | Asistencias y Cupos sobre la consulta mínima | `gestion-estudiantes-auth` (DIRECTOR y DOCENTE) con A y con B simulada | Pasa |
| CA-20 | Sesión verificada, `requerirDirector`/`requerirRol`, Zod, sin `service_role`; 401/403/405 | `profesores.spec` (anónimo), `profesores-auth` (API por actor) | Pasa |
| CA-21 | Matriz de actores en menú, página, API y RPC | `profesores-auth` (7 actores), `profesores_postgrest.mjs`, `profesores_rls.sql` | Pasa |

CA-01, CA-02, CA-03, CA-11, CA-12, CA-18 y CA-19 quedaron probados en la
etapa 1; se volvieron a correr sus suites sobre esta rama (sección 9).

## 6. Matriz de permisos

### Por actor y superficie

| Actor | Menú | `/dashboard/profesores` | `/dashboard/mis-asignaciones` | `GET /api/profesores` | `GET /api/profesores/{id}` | `PATCH /api/profesores/{id}` | `GET /api/mis-asignaciones` |
|---|---|---|---|---|---|---|---|
| Anónimo | — | → `/login` | → `/login` | 401 | 401 | 401 | 401 |
| DIRECTOR | «Profesores» | Todas las fichas | Acceso restringido | 200 | 200 | 200 / 400 / 404 / 409 | 403 |
| DOCENTE | «Mis asignaciones» | Acceso restringido | Solo lo propio | 403 | 403 (ajeno y propio) | 403 | 200 (solo lo propio) |
| DOCENTE INACTIVO | «Mis asignaciones» (sin «Profesores») | Mismo control que DOCENTE | Solo lo propio, con aviso | 403 | Mismo control que DOCENTE | Mismo control que DOCENTE | 200 (su ficha, INACTIVO) |
| ESTUDIANTE | — | Acceso restringido | Acceso restringido | 403 | 403 | 403 | 403 |
| PADRE | — | Acceso restringido | Acceso restringido | 403 | 403 | 403 | 403 |
| PERSONAL | — | Acceso restringido | Acceso restringido | 403 | 403 | 403 | 403 |
| Sin perfil | — | Acceso restringido | Acceso restringido | 403 | 403 | 403 | 403 |

`POST`/`DELETE /api/profesores`, `POST`/`PUT`/`DELETE /api/profesores/{id}` y
`POST`/`PATCH`/`DELETE /api/mis-asignaciones` responden 405 para cualquier
actor. La autorización precede a la validación: sin sesión, un identificador o
cuerpo inválido también devuelve 401.

### Por fila (lo que la base entrega a cada actor)

| Dato | DIRECTOR | DOCENTE | Otros |
|---|---|---|---|
| Fichas (`profesores`) | Todas | Solo la propia | Ninguna (0 filas / 403 en RPC) |
| Datos personales del docente | En el detalle | Solo los propios (nombre, legajo, especialidad, estado) | — |
| Correo | Nunca | Nunca | Nunca |
| Asignaciones y horarios | De cualquier docente | Solo los propios | — |
| Historial de estados | Sí, solo lectura | No | No |
| Consulta mínima de estudiantes | `id, nombre, apellido, legajo_nro` | Igual | 403 |

## 7. Mensajes de dominio

| Situación | HTTP | Mensaje |
|---|---|---|
| Legajo duplicado (23505) | 409 | «Ya existe un legajo con ese número.» (campo legajo) |
| Especialidad vacía / fuera de rango | 400 | «La especialidad es obligatoria.» / «…entre 2 y 100 caracteres.» |
| Motivo largo | 400 | «El motivo no puede superar los 500 caracteres.» |
| Inactivar con relaciones activas (P5610) | 409 | «No se puede inactivar al profesor: sigue a cargo de …. Reasigná o inactivá esas relaciones y volvé a intentarlo. No se guardó ningún cambio.» |
| Reactivar ficha incompleta (P5612) | 409 | «Para reactivar, completá primero el legajo y la especialidad de la ficha.» |
| Reactivar sin rol DOCENTE (P5611) | 409 | «No se puede reactivar la ficha: la persona ya no tiene el rol DOCENTE.» |
| Asignar a un docente inactivo (P5605) | 409 | «El profesor está inactivo y no puede quedar a cargo de nuevas asignaciones…» |
| Mismo estado (P5608) | 409 | «El profesor ya está en ese estado. Actualizá la página…» |
| Profesor inexistente (P5600) | 404 | «El profesor solicitado no existe.» |
| Bloqueo o espera agotada | 503 | «Hay otra operación en curso sobre este profesor…» |

Las pruebas de API y de pantalla de esta etapa pasan los mensajes por
`exigirMensajeSinDetalleTecnico` / `exigirPantallaSinDetalleTecnico`: ninguno
trae SQLSTATE, nombres de función ni identificadores internos.

## 8. Compatibilidad con A y con la futura B

B no está en esta rama ni se aplicó en ningún entorno remoto. Se simuló solo en
el contenedor local `supabase_db_educar-para-transformar`:

1. `npx supabase db reset --local` (base con 001–A).
2. Se guardó el estado de las políticas de `perfiles` (`pg_policies`, SHA-256
   `a0eb383a…`).
3. Se aplicó por `psql` este SQL, que no es una migración ni queda en el
   ledger:

   ```sql
   BEGIN;
   DROP POLICY "Directores y docentes ven todos los perfiles" ON public.perfiles;
   CREATE POLICY "Dirección ve todos los perfiles" ON public.perfiles
       AS PERMISSIVE FOR SELECT TO authenticated
       USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');
   COMMIT;
   ```

4. Se corrieron las pruebas de la tabla siguiente.
5. Se restauró con el SQL inverso (vuelve a crear la política de 005 con
   `rol_actual() = ANY (ARRAY['DIRECTOR','DOCENTE'])`), se comprobó que
   `pg_policies` quedó idéntico al paso 2 (mismo SHA-256) y, por último, se
   hizo un `db reset --local` completo.

| Prueba | Con A | Con A + B simulada |
|---|---|---|
| `profesores_rls.sql` (19 comprobaciones) | Código 0; CA-16 «esquema A: la lectura global de DOCENTE sigue vigente hasta B (8 perfiles)» | Código 0; CA-16 «esquema A+B: DOCENTE ve solo su propio perfil»; las otras 18 comprobaciones, idénticas |
| `profesores_postgrest.mjs` | Código 0, 44 OK | Código 0, 44 OK |
| E2E completo con esta aplicación (incluye `profesores-auth` y `gestion-estudiantes-auth`) | 662 pasaron, 1 omitida (preexistente), 0 fallos, 0 reintentos | 659 pasaron, 1 omitida (preexistente), 0 fallos, 0 reintentos (revisión anterior al ajuste de anuncios de la sección 12) |
| Suites de esta etapa sobre el código final (`profesores`, `profesores-ui`, `profesores-auth`, `gestion-estudiantes-auth`) | Incluidas en el E2E final | 79 pasaron, 0 reintentos |
| `gestion-estudiantes-auth` contra la aplicación **anterior** (`a000ede`) | 19 pasaron | 17 pasaron, **2 fallaron**: DOCENTE en Asistencias y en Cupos recibe el selector sin ningún alumno |

La última fila es la razón de esta etapa: la aplicación anterior depende de la
lectura global de `perfiles`, y con B el DOCENTE se queda sin alumnos. La
misma prueba pasa con la aplicación anterior y con A, así que exige
exactamente el conjunto, las etiquetas y las operaciones que había antes del
cambio. Para correrla sobre la aplicación anterior se copió temporalmente el
archivo de prueba al worktree de la etapa 1 (árbol idéntico a `a000ede`, sin
commits nuevos) y se habilitó en su `playwright.config.ts`; después se
restauró con `git checkout -- playwright.config.ts` y se borró la copia
(`git status` vacío).

**Ajuste de una prueba de la etapa 1.** Con B simulada, la sección 5 de
`profesores_rls.sql` fallaba («la consulta mínima devuelve perfiles que no son
ESTUDIANTE»): comparaba la RPC contra una lectura directa de `perfiles` hecha
**como DOCENTE**, que con B devuelve solo su fila. La comparación completa del
conjunto, en ambos sentidos, ya la hace el bloque siguiente como propietario.
Se quitó la resta redundante; con A la suite sigue dando las mismas 19
comprobaciones.

## 9. Comandos ejecutados y códigos de salida

Todo contra el stack local `educar-para-transformar` (Docker Desktop, Supabase
CLI 2.117.0), desde el worktree de la etapa 2. `$C` es
`supabase_db_educar-para-transformar`.

| Comando | Código | Resultado |
|---|---|---|
| `npx supabase db reset --local` (antes de cada tanda) | 0 | 001–A aplicadas; última versión `20260925165924` |
| `docker exec -i $C psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/<suite>.sql` para `alumnos_academicos_rls`, `comedor_rls`, `cursos_rls`, `deportes_rls`, `horarios_academicos_rls`, `horarios_rls`, `inscripcion_hijos_rls`, `materias_rls`, `niveles_rls`, `reconciliacion_esquema_remoto`, `profesores_rls` | 0 cada una | 11 suites SQL |
| `docker exec -i $C psql -X -U supabase_admin … < supabase/tests/usuarios_alta_atomica.sql` | 0 | |
| `node supabase/tests/<suite>.mjs` para `alumnos_academicos_concurrencia`, `comedor_concurrencia`, `deportes_concurrencia`, `horarios_academicos_concurrencia`, `horarios_concurrencia`, `horarios_paridad`, `niveles_concurrencia`, `migracion_009_colisiones`, `usuarios_reconciliacion` | 0 cada una | |
| `node supabase/tests/profesores_concurrencia.mjs` | 0 | 9 OK (carreras de A) |
| `node supabase/tests/profesores_postgrest.mjs` | 0 | 44 OK |
| `node supabase/tests/profesores_reversion_a.mjs` | 0 | 7 OK |
| `node supabase/tests/profesores_paridad.mjs` (nueva) | 0 | 748 textos, 653 válidos una vez normalizados, misma decisión en PostgreSQL y en `src/lib/profesores.ts` |
| `npx supabase db reset --local --version 20260924225451` y `node supabase/tests/profesores_migracion_a.mjs` | 0 y 0 | 14 OK; deja A aplicada |
| `node supabase/tests/tipos-generados.mjs` | 0 | Tipos sin cambios: el blob versionado coincide byte a byte con la salida normalizada (SHA-256 `b4e918ae…`) |
| `node supabase/tests/correr-autenticadas.mjs tests/profesores.spec.ts tests/profesores-ui.spec.ts tests/profesores-auth.spec.ts tests/gestion-estudiantes-auth.spec.ts --reporter=line` | 1 → 0 | Primera corrida 74/76: dos fallas de la prueba, no del producto (espera de opciones en Cupos y foco por clic en WebKit); corregidas, 58/58 en la repetición |
| `node supabase/tests/correr-autenticadas.mjs tests/usuarios-auth.spec.ts tests/profesores-auth.spec.ts --reporter=line` | 0 | 82/82; reproduce el renombre del DOCENTE que hace `usuarios-auth` (sección 10) |
| `node supabase/tests/correr-autenticadas.mjs --reporter=line` (E2E completo, A, primera corrida) | 1 | 658 pasaron, 1 omitida, 1 falló (sección 10) |
| E2E completo con B simulada | 0 | 659 pasaron, 1 omitida |
| `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs tests/profesores-ui.spec.ts tests/profesores-auth.spec.ts --reporter=line` (código final) | 0 | 71 pasaron; 42 capturas |
| Suites de esta etapa con B simulada (código final) | 0 | 79 pasaron |
| Suites de esta etapa con A, tras sumar aserciones de permisos (DIRECTOR en Mis asignaciones; menú y API del DOCENTE INACTIVO) | 0 | 79 pasaron, 0 reintentos. Esas aserciones se agregaron a pruebas existentes después del E2E final; no cambió código de la aplicación |
| E2E completo final con A | 0 | 662 pasaron, 1 omitida (preexistente), 0 fallos, 0 reintentos |
| `npx tsc --noEmit --incremental false` | 0 | |
| ESLint focalizado sobre los archivos tocados | 1 | Solo los 2 errores preexistentes de `asistencias/page.tsx` |
| `npm run lint -- --no-cache` | 1 | 15 errores / 108 advertencias, igual que la base |
| `npm run build` | 0 | Con `NEXT_PUBLIC_SUPABASE_URL` y la clave pública del stack local inyectadas en el entorno; rutas nuevas compiladas y ningún banco `pruebas-ui` |
| `node supabase/tests/harness_produccion.mjs` | 0 | 41 OK: con `EPT_UI_HARNESS=1`, `/pruebas-ui/profesores` y `/pruebas-ui/mis-asignaciones` responden 404 idéntico a una ruta inexistente y ningún artefacto contiene sus datos |
| `git diff --check` | 0 | |

No se agregaron comandos nuevos de Supabase respecto de la etapa 1
(`db reset --local [--version]`, `status -o env`, `gen types` a través de
`tipos-generados.mjs`); se usaron con las opciones que ya documenta su
`--help`.

## 10. Regresiones y comparación con la línea base

| Medida | Base (`a000ede`) | Etapa 2 |
|---|---|---|
| E2E completo | 598 pasaron, 1 omitida | 662 pasaron, 1 omitida (preexistente), 0 fallos, 0 reintentos: las 598 de la base, más 64 nuevas |
| Suites SQL y de concurrencia | 22 con código 0 | 27 con código 0 (las mismas, más `profesores_paridad`, `profesores_postgrest`, `profesores_reversion_a`, `profesores_migracion_a` y `tipos-generados` corridas explícitamente) |
| `npm run lint -- --no-cache` | 15 errores / 108 advertencias | 15 / 108; 0 diferencias por archivo y regla |
| Tipos generados | — | Sin cambios |
| Migraciones | 001–A | Sin cambios |

- **Nuevas pruebas E2E (64):** `profesores.spec` 4 (anónimo), `profesores-ui`
  14 × 3 perfiles (Chromium 1280, Pixel 5 y iPhone 13 a 375), `profesores-auth`
  14 (DIRECTOR 7, DOCENTE 3, ESTUDIANTE, PADRE, PERSONAL y sin perfil) y
  `gestion-estudiantes-auth` 4 (Asistencias y Cupos para DIRECTOR y DOCENTE).
- **Falla de la primera corrida completa.** `usuarios-auth` (preexistente)
  renombra al DOCENTE compartido a «CambioPermitido» y no lo restaura; la
  prueba nueva esperaba el nombre original. Ahora lee el nombre de la base en
  el momento de la prueba (lo mismo para el actor del historial). No era un
  defecto de la aplicación: la pantalla mostraba el nombre vigente.
- **Errores de lint preexistentes en un archivo tocado.** `asistencias/page.tsx`
  tenía 2 errores `react-hooks/set-state-in-effect` en efectos que esta etapa no
  modifica. No se silenciaron: siguen contando en los 15 de la base.
- **Aviso del servidor de desarrollo** «The destination stream closed early»:
  aparece 5 veces en la corrida completa de la base y 8–9 en las de esta etapa,
  también junto a suites que esta etapa no toca (Alumnos, Comedor, Horarios,
  Materias, Niveles). Lo emite `next dev` cuando el navegador corta una
  respuesta en curso al recargar o navegar; ninguna prueba falla por él.

## 11. Capturas

Todas son de la base local descartable o de los bancos visuales con datos
sintéticos; ninguna de producción. Están en `docs/evidence/EPT-58/etapa-2/`.

Se generan con `EPT_CAPTURAS=1` (sección 9) y cada prueba escribe solo en esa
carpeta. Las corridas completas reescriben capturas de EPT-13; se restauraron
con `git checkout -- docs/evidence/EPT-13` y no forman parte de esta entrega.

**Sesión real local** (`real-…`, `profesores-auth`): usuarios de
`tests/auth.setup.ts` y docentes sintéticos del fixture (`Prueba`,
`LEG-E2E-EPT58-…`).

| Archivo | Qué muestra |
|---|---|
| `real-escritorio-1280-listado.png`, `real-movil-375-listado.png` | Dirección: menú con «Profesores», fichas activas, inactivas e incompletas |
| `real-escritorio-1280-inactivacion-bloqueada.png` | Rechazo del P5610 en el diálogo, con la materia que lo impide y un solo anuncio |
| `real-escritorio-1280-historial.png` | Detalle con datos personales, historial «Activo → Inactivo», fecha, actor y motivo |
| `real-escritorio-1280-mis-asignaciones.png`, `real-movil-375-mis-asignaciones.png` | DOCENTE: su ficha, materia y grupo vigentes con franjas, horario semanal y relación histórica aparte |
| `real-escritorio-1280-docente-inactivo.png` | DOCENTE con ficha INACTIVO que inició sesión y ve el aviso |
| `real-escritorio-1280-acceso-restringido.png` | ESTUDIANTE en `/dashboard/mis-asignaciones`: acceso restringido y sin enlaces |

**Bancos visuales** (`fixture-escritorio-1280-…` y `fixture-movil-375-…`,
`profesores-ui`): las mismas 17 vistas en cada ancho.

| Vista | Qué muestra |
|---|---|
| `listado`, `filtro-incompletas`, `vacio` | Listado, filtro de fichas incompletas y estado vacío |
| `carga`, `error`, `exito` | Carga de la página, error de carga del listado con «Reintentar» y éxito anunciado |
| `detalle-carga`, `detalle-error`, `detalle` | Detalle bajo demanda: carga, error con reintento y contenido completo |
| `ficha-validacion`, `ficha-exito` | Validación local de la ficha y guardado normalizado |
| `dialogo-estado`, `inactivacion-bloqueada` | Diálogo de inactivación con motivo y rechazo con sus causas |
| `mis-asignaciones`, `mis-asignaciones-inactiva`, `mis-asignaciones-vacio`, `mis-asignaciones-carga` | Mis asignaciones: con datos, ficha inactiva e incompleta, sin asignaciones y carga |

## 12. Idioma y accesibilidad

- Todo el texto visible, `aria-label`, regiones de estado y mensajes de error
  está en español; `profesores-ui` falla si aparece una palabra inglesa común
  en pantalla.
- Encabezados jerárquicos (`h1` por página, `h2` por sección, `h3` por día del
  horario); listas con nombre accesible («Fichas de profesores», «Materias y
  grupos que tengo a cargo», «Cambios de estado de …»).
- **Un anuncio por resultado.** Un rechazo se anuncia una sola vez y donde
  está el foco: en el campo (`role="alert"` del campo, `aria-invalid`) si es
  de un campo, o en una alerta dentro del diálogo, que sigue abierto. La
  primera versión lo repetía en la región de la página y en un aviso flotante
  (se vio en la captura de la inactivación bloqueada); las pruebas ahora
  exigen exactamente una alerta con ese texto. El éxito, que llega con el
  diálogo ya cerrado, usa la región viva «Estado de la administración de
  profesores» (`role="status"`) y el aviso flotante, como Materias.
- Carga anunciada con `role="status"` y texto oculto visualmente; error de
  carga del listado con `role="alert"` y «Reintentar».
- Diálogos con foco inicial declarado (legajo o motivo), contención del foco,
  cierre con Escape y devolución del foco al disparador. En WebKit se prueba
  abriendo con el teclado, porque Safari no enfoca un botón al hacer clic.
- Botones con nombre completo («Inactivar a Castro, Irene», «Ver el detalle de
  …», `aria-expanded`/`aria-controls`); filtros con `aria-pressed`; íconos y
  iniciales `aria-hidden`.
- 1280 px y 375 px sin desplazamiento horizontal, comprobado en cada prueba de
  pantalla y en la sesión real.

## 13. Hallazgos

- **Caracteres literales en la migración A.** Las clases de espacios de
  `normalizar_especialidad` y `normalizar_motivo_estado` (líneas 206–208 y
  242–246) contienen U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F,
  U+205F, U+3000 y U+FEFF como caracteres reales, no como escapes. Funcionan
  (lo prueba la paridad con 748 textos), pero son invisibles en una revisión.
  A está aplicada y no se edita; si se quiere, una migración futura puede
  redefinir las dos funciones con escapes. En la aplicación se evitó el mismo
  problema: en un literal de expresión regular de JavaScript U+2028/U+2029 son
  fin de línea y rompen la compilación.
- **Preexistente en `src/lib/validations.ts`.** `recortarNombreMateria` (EPT-56)
  tiene U+0085 y U+FEFF literales en su expresión regular. No se tocó.
- **Next.js 16.3.3.** Es la versión instalada por `package-lock.json` en
  `a000ede`; el enunciado mencionaba 16.2.5. No cambia ninguna API usada.

## 14. Riesgos y trabajo fuera de alcance

| Riesgo | Mitigación |
|---|---|
| El detalle de Dirección muestra DNI, teléfono, dirección y nacimiento | Mismo alcance que Dirección ya tiene en Alumnos/Usuarios; nunca correo; el DOCENTE no los recibe de otros |
| Docentes siguen leyendo `perfiles` completos hasta B | Intencional en esta etapa; la aplicación ya no lo necesita (probado con B simulada) |
| Permisos preexistentes de docentes sobre asistencias e inscripciones | Sin ampliar ni reducir; EPT-66 |
| Inactivar la ficha no bloquea la cuenta | Por contrato; EPT-59 |
| Condiciones de carrera entre inactivar y asignar | Resueltas en PostgreSQL por A (CA-11, `profesores_concurrencia.mjs`) |

## 15. Reversión

- **Cómo:** revertir los commits de esta etapa (`git revert` de los commits de
  aplicación) y desplegar esa aplicación. Vuelve la aplicación compatible con A
  de la etapa 1: sin pantallas de profesores y con Asistencias/Cupos leyendo
  `perfiles`, que funciona porque la política amplia sigue vigente.
- **Qué se conserva:** la migración A, todas las fichas y todo el historial
  creados con esta aplicación. Revertir la aplicación no toca datos ni
  esquema. No se usa `git revert` de una migración como reversión de esquema.
- **Condición:** solo mientras B no esté aplicada. Con B aplicada, una
  aplicación anterior a la etapa 2 dejaría a DOCENTE sin nombres en
  Asistencias/Cupos; primero se compensa B (orden inverso del contrato).
- B no existe en esta rama, así que no hay nada que compensar hoy.

## 16. Reproducción

```bash
# Stack local y base limpia con 001–A (nunca contra producción)
npx supabase start
npx supabase db reset --local

# Suites de base de esta rama
docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profesores_rls.sql
node supabase/tests/profesores_paridad.mjs
node supabase/tests/profesores_postgrest.mjs
node supabase/tests/profesores_concurrencia.mjs

# E2E: las credenciales locales se inyectan desde `supabase status -o env`
node supabase/tests/correr-autenticadas.mjs tests/profesores.spec.ts tests/profesores-ui.spec.ts tests/profesores-auth.spec.ts tests/gestion-estudiantes-auth.spec.ts --reporter=line
node supabase/tests/correr-autenticadas.mjs --reporter=line

# Capturas (después, restaurar la evidencia ajena)
EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs tests/profesores-ui.spec.ts tests/profesores-auth.spec.ts --reporter=line
git checkout -- docs/evidence/EPT-13
```

La simulación de B de la sección 8 se aplica y se deshace con los dos bloques
SQL que allí figuran, por `docker exec … psql`, y se cierra con
`npx supabase db reset --local`.
