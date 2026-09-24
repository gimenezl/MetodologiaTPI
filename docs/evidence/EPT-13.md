# EPT-13 — Inscribir un hijo al cursado

Evidencia de la historia EPT-13 y sus seis subtareas EPT-44…EPT-49. Todo el trabajo se realizó sobre una base Supabase local descartable y el worktree aislado `codex/ept-13-inscripcion-hijos`. Esta evidencia distingue comprobaciones funcionales de presentación y no contiene credenciales ni datos productivos.

## 1. Alcance, línea base y contrato

| Concepto | Valor verificado |
|---|---|
| Base remota | `origin/main` = `46c4a08bc5a4fdb7db49f10d20ba840eb0d4a02e` |
| Migración previa | 015, sin modificar migraciones 001–015 |
| Nueva migración | `016_matricula_parental.sql`, aditiva y hacia adelante |
| Rama y aislamiento | `codex/ept-13-inscripcion-hijos`, worktree separado del checkout principal |
| Jira | EPT-13 y EPT-44…49 en curso, responsable Lucas Gimenez, Sprint 6; actualización coordinada fuera de este worktree |
| Versión de Next.js | 16.3.3, actualización de seguridad autorizada expresamente desde 16.2.5 |

El padre puede matricular únicamente a un hijo realmente vinculado que tenga rol ESTUDIANTE, legajo no vacío, estado INACTIVO y ninguna matrícula vigente. «Disponible» significa curso existente y activo; el modelo no define cupo académico. La operación crea la matrícula y activa al alumno en una sola transacción. Un alumno ACTIVO se rechaza aunque falte matrícula, y una matrícula vigente se rechaza aunque el estado sea inconsistente. No existe cambio de curso, cierre ni borrado parental; el historial persiste. Los errores para hijo inexistente y ajeno son indistinguibles.

Fuera de alcance: nuevas funciones administrativas de materias/deportes, cupos académicos, producción, despliegue, push, PR y merge.

## 2. Matriz de historias, aceptación y archivos

| Clave | Criterio cubierto | Autoridad y evidencia |
|---|---|---|
| EPT-13 | Padre inscribe a hijo vinculado en curso activo; Director y padre ven resultado | Migración 016, API, `hijos-auth.spec.ts`, prueba SQL |
| EPT-44 | Auditar vínculo existente sin recrearlo | `padres_hijos` de 011, PK compuesta, FK, RLS, índice inverso; comprobaciones SQL en 016 y prueba |
| EPT-45 | Consulta aislada de hijos, matrícula, materia/docente y deporte | RLS consolidada, vista `security_invoker`, `consultar_detalle_hijo`, API GET |
| EPT-46 | Selección, resumen, confirmación y activación atómica | UI `/dashboard/hijos`, POST y RPC `matricular_hijo` |
| EPT-47 | Un solo curso vigente, duplicado, ajeno, rechazos de escritura | Bloqueo de alumno, índice único parcial de 008, SQL y POST concurrentes |
| EPT-48 | Navegador real, API, SQL, tres perfiles visuales | Playwright autenticado y fixtures; 27 PNG |
| EPT-49 | Evidencia, seguridad, pruebas y retrospectiva | Este documento; Jira lo coordina el orquestador |

Los criterios Jira quedan trazados así: (1) listado filtrado en PostgreSQL; (2) cursos activos listados y revalidados por trigger; (3) índice único de matrícula vigente; (4) estado y duplicado rechazados; (5) no enumeración de UUID ajeno; (6) visibilidad parental y administrativa. RF13/RF14/RF15/RF19 no se resuelven por ocultamiento visual: la base es la autoridad.

### Cambios por archivo

- `supabase/migrations/016_matricula_parental.sql`: políticas RLS de lectura y RPCs.
- `supabase/tests/inscripcion_hijos_rls.sql`: transacción con ROLLBACK y casos permitidos/denegados.
- `src/services/hijos.service.ts`: proyección tipada, detalle vinculado y cursos activos.
- `src/app/api/hijos/route.ts`, `[id]/route.ts`, `[id]/matricula/route.ts`: fronteras HTTP.
- `src/app/dashboard/hijos/page.tsx`, `loading.tsx`, `_components/InscripcionHijos.tsx`: autorización en servidor, carga y experiencia parental.
- `src/app/dashboard/layout.tsx`: navegación «Mis hijos» exclusiva para PADRE.
- `src/app/pruebas-ui/hijos/page.banco.tsx`: banco local doblemente protegido y excluido del build.
- `tests/auth.setup.ts`, `tests/hijos-auth.spec.ts`, `tests/hijos-ui.spec.ts`, `playwright.config.ts`: identidades reales, permisos, concurrencia, capturas y accesibilidad.
- `src/types/database.generated.ts`, `src/types/database.types.ts`: tipos regenerados y manuales reconciliados.
- `supabase/tests/harness_produccion.mjs`: 404 exacto del banco parental en producción.
- `package.json`, `package-lock.json`: Next.js y eslint-config-next 16.3.3.
- `AGENTS.md`: bloque de instrucciones regenerado por Next dev, conservado para que el árbol quede estable.

## 3. Modelo de amenazas y matriz de autorización

| Actor | Listar/ver hijo y detalle | Matricular | Escritura directa o cambio de curso |
|---|---|---|---|
| PADRE vinculado | Solo sus hijos, matrícula vigente, materias del curso vigente y deporte ACTIVO | Sí, únicamente hijo apto y curso activo | No |
| PADRE no vinculado | Ninguna fila; UUID existente e inexistente reciben respuesta opaca | No | No |
| DIRECTOR | Conserva lectura administrativa académica | No por RPC parental; usa funciones académicas existentes | Solo según administración previa |
| ESTUDIANTE | Conserva lectura de su propio legajo e historial | No por RPC parental | No |
| DOCENTE, PERSONAL, sin perfil | No por endpoints parentales | No | No |
| Anónimo | 401 HTTP; sin EXECUTE público de RPC | No | No |

Amenazas cubiertas: falsificación de `padre_id` o estado, acceso a UUID ajeno, petición duplicada o simultánea, curso inactivo o inexistente, escritura directa, cambio posterior, cierre/borrado y datos de terceros en dominios académicos/deportivos. La API deriva identidad mediante `auth.getUser()` y rol de sesión; valida UUID y cuerpo estricto con Zod, sin aceptar `padre_id`. La autorización se repite en PostgreSQL. Errores PostgreSQL se traducen a 401/403/404/409/422 sin devolver detalles internos. El frontend es una capa de experiencia, no la autoridad.

## 4. Migración, objetos, privilegios y rendimiento

`padres_hijos` se conserva sin cambios. La migración 016 reemplaza, en cada una de `alumnos` y `matriculas`, dos políticas SELECT anteriores por una política compuesta: exactamente los predicados previos de DIRECTOR y ESTUDIANTE más `mis_hijos_ids()` del PADRE. Esto evita dos WARN nuevos de políticas permisivas múltiples sin ampliar permisos. No introduce RLS recursiva: los ayudantes existentes consultan el perfil y el vínculo bajo su contrato anterior.

RLS está habilitada en ambas tablas, pero no forzada para el propietario (`relforcerowsecurity=false`), igual que en 008: las RPC `SECURITY DEFINER` necesitan efectuar la transacción con autoridad controlada, mientras que todos los roles cliente continúan sujetos a políticas y grants. Activar FORCE en esta unidad alteraría funciones administrativas previas; no se hizo.

`app_private.matricular_hijo` es `SECURITY DEFINER`, `search_path=''`, nombres calificados y errores de dominio estables. Comprueba `auth.uid()`, rol PADRE, vínculo bloqueado `FOR SHARE`, rol/legajo del hijo y fila `alumnos FOR UPDATE`; luego exige INACTIVO y ausencia de matrícula vigente. El trigger de 008 valida y bloquea el curso activo; INSERT y UPDATE de estado se confirman o revierten juntos. El orden mantiene alumno → curso → matrícula. El índice único parcial de 008 impide estructuralmente dos matrículas vigentes. `public.matricular_hijo` es un envoltorio `SECURITY INVOKER`; solo `authenticated` tiene EXECUTE. No hay GRANT de INSERT/UPDATE/DELETE, REFERENCES ni TRIGGER a `authenticated` sobre las tablas.

`app_private.consultar_detalle_hijo` exige vínculo antes de proyectar materias activas del curso vigente (docente opcional) e inscripciones deportivas ACTIVA. No concede SELECT parental directo sobre esas tablas. Su envoltorio público también es `SECURITY INVOKER` y solo `authenticated` puede ejecutarlo. Ninguna RPC devuelve identificadores de terceros. Ambas funciones privadas mantienen autorización propia incluso si se invocan por SQL con ese rol.

Las FK existentes conservan `ON DELETE RESTRICT` donde protege historial; no se creó borrado físico. `padres_hijos` usa PK `(padre_id,hijo_id)` y su índice inverso; `matriculas` usa índice parcial por `alumno_id`. En base vacía, `EXPLAIN` eligió escaneo secuencial para `alumnos` (tabla sin filas), índice parcial para matrícula vigente y bitmap del PK para vínculo. Esa elección sobre tabla vacía no demuestra un problema productivo.

## 5. API, interfaz y accesibilidad

- `GET /api/hijos`: hijos y cursos activos; `GET /api/hijos/[id]`: hijo vinculado u opaco 404; `POST /api/hijos/[id]/matricula`: validación estricta y resultado confirmado. Otros métodos: 405.
- La página se autoriza en servidor. Contiene identidad, legajo, estado, nivel, curso, materias/docentes y deportes activos, sin IDs internos. Si no hay hijos o cursos, explica el motivo; si está activo, no ofrece matrícula. El formulario exige seleccionar hijo y curso, muestra resumen y advierte que el padre no puede cambiar curso posteriormente.
- Diálogo nativo `showModal()`: foco contenido, Escape, cierre y devolución de foco; región de estado `aria-live` nombrada y error `role=alert`. Estados de carga, envío, éxito, dominio, error inesperado y reintento están en español profesional.
- Se verificaron escritorio 1280 px, móvil 375 px y perfiles Chromium/WebKit; sin desplazamiento horizontal accidental en 375 px.
- El banco visual requiere variable local y está fuera del build; el arnés productivo comprobó respuesta 404 idéntica a ruta inexistente aun forzando la variable.

## 6. Pruebas y comandos reproducibles

Todos los comandos se ejecutaron en `E:\Escritorio\codigo\MetodologiaTPI-ept13` con Supabase local. Para pruebas SQL en PowerShell se canalizó `Get-Content -Raw <archivo>` a `docker exec -i supabase_db_educar-para-transformar psql -X -U <usuario> -d postgres -v ON_ERROR_STOP=1`; `usuarios_alta_atomica.sql` requiere `supabase_admin` según su propio contrato, los demás `postgres`.

| Comando o comprobación | Resultado |
|---|---|
| `npx.cmd supabase start` | exit 0; sin registrar secretos de su salida |
| `npx.cmd supabase db reset --local` | exit 0; migraciones 001–016, repetido tras consolidar RLS |
| `npx.cmd supabase migration list --local` | exit 0; 001–016 local/remoto local coinciden |
| SQL `inscripcion_hijos_rls.sql` | exit 0, termina en ROLLBACK; vínculo, otro padre, no perfil, rol, anónimo, curso, estado, duplicado, grants, detalle y Director |
| SQL `alumnos_academicos_rls.sql` | exit 0; 69 aserciones OK |
| SQL `cursos_rls.sql` | exit 0; 39 OK |
| SQL `usuarios_alta_atomica.sql` | exit 0; 23 OK |
| SQL `materias_rls.sql` | exit 0; 44 OK |
| SQL `deportes_rls.sql` | exit 0; 59 OK después de reset limpio |
| `node supabase/tests/alumnos_academicos_concurrencia.mjs` | exit 0; 8 carreras/casos |
| `node supabase/tests/tipos-generados.mjs --escribir` y verificación sin flag | exit 0 ambos; salida determinista y tipos reconciliados |
| `npx.cmd supabase db lint --local --schema public,app_private --level warning --fail-on error` | exit 0, sin errores de esquema |
| `npx.cmd supabase db advisors --local --type all --level info --fail-on none --output-format json` | exit 0; 12 INFO, 10 WARN tras consolidación, **0 WARN nuevos** |
| `npx.cmd tsc --noEmit --incremental false` | exit 0 |
| `npm.cmd run build` | exit 0, Next.js 16.3.3 |
| `node supabase/tests/harness_produccion.mjs` | exit 0; banco `/pruebas-ui/hijos` 404 exacto |
| `npm.cmd run test:e2e` | exit 0; 359 passed, 1 skipped |
| `EPT_SUPABASE_LOCAL=1 npx.cmd playwright test --config=playwright.config.ts --reporter=dot` | exit 0; 595 passed, 1 skipped **después** de consolidar RLS (8,8 min) |
| `EPT_SUPABASE_LOCAL=1 npx.cmd playwright test tests/hijos-auth.spec.ts --project=chromium-padre --project=chromium-padre-segundo --reporter=dot` | exit 0; 18 passed tras agregar y comprobar la captura administrativa auténtica |
| ESLint focalizado sobre todos los TS/TSX modificados | exit 0 |
| `npm.cmd run lint -- --no-cache` | exit 1; 15 errores y 108 avisos del conjunto preexistente, cero errores nuevos frente a base verificada |
| `npm.cmd audit --json` | exit 1 por 6 avisos no críticos restantes; 0 críticos y ninguna entrada `next` |
| `npm.cmd audit --omit=dev --audit-level=critical` | exit 0; informa 1 alto y 1 moderado, sin críticos |
| `git diff --check` | exit 0; sin errores de espacios |
| `rg` de secretos y atribución en archivos nuevos | exit 1 (sin coincidencias); el setup local usa credenciales sintéticas fuera de la aplicación productiva |

La prueba real de concurrencia parental envía dos POST simultáneos al mismo hijo: una respuesta 201 y una 409, exactamente una matrícula y estado ACTIVO al releer. Los rechazos SQL ocurren en subtransacciones dentro de un ROLLBACK; se comprueban estado y número de matrículas sin efectos parciales. El navegador autenticado cubre padre 1, padre 2, Director, Estudiante, Docente, Personal, anónimo y sin perfil, además de confirmación, persistencia tras recarga, foco, móvil, mensajes y ausencia de controles destructivos.

### Fallos preexistentes y seguridad de dependencias

El lint global de la línea base descartable informó 15 errores/109 avisos; el candidato 15/108, sin nueva ubicación/regla de error. El primer intento de `deportes_rls.sql` después de la suite autenticada encontró grupos E2E residuales; se reinició la base local y la prueba pasó 59/59: no era un defecto del candidato. La primera ejecución de `usuarios_alta_atomica.sql` con `postgres` fue inválida para ese arnés; repetida con el superusuario local `supabase_admin`, pasó 23/23. Estos intentos fallidos no se ocultan.

`npm audit` sobre Next 16.2.5 señaló las vulnerabilidades críticas `GHSA-p293-qw3h-jr36` (RCE en servidor Windows) y `GHSA-2xp9-vwfh-vxw4` (RCE vía AVIF). Con autorización explícita se actualizó `next` y `eslint-config-next` a 16.3.3. `npm audit --json` posterior: **0 críticas**, 4 altas, 1 moderada, 1 baja; ninguna entrada `next`. `npm audit --omit=dev --audit-level=critical` sale 0 pero informa dos vulnerabilidades no críticas de dependencias transitivas (`ws` alta, `baseline-browser-mapping` moderada), fuera de la ampliación autorizada. Requieren triage posterior; no se declara la cadena libre de riesgo.

Los advisors restantes (10 WARN) son anteriores a 016: uno `auth_rls_initplan` en `perfiles`, cinco `multiple_permissive_policies` en `asistencias`, `inscripciones`, `inscripciones_servicios` y `perfiles`, dos `function_search_path_mutable` heredados y dos `rls_policy_always_true` de inserción pública heredada. Los INFO del estado recién reiniciado son 2 FK sin índice y 10 índices sin uso observado; el conteo de estos últimos fluctúa al correr pruebas (en una consulta posterior: 7 índices sin uso, total 9 INFO). Antes de consolidar RLS aparecían dos WARN adicionales en `alumnos` y `matriculas`; ya no aparecen. Ningún aviso nuevo permanece.

## 7. Capturas y privacidad

Directorio: `docs/evidence/EPT-13/` (27 PNG). Las capturas `01-` a `07-` proceden de una sesión **PADRE autenticada por el formulario real**: escritorio, hijo apto, cursos, confirmación, éxito, recarga persistente y móvil 375 px. La `08-padre-sin-hijos.png` corresponde a un **segundo PADRE autenticado** sin vínculo, y `09-directora-matricula-visible.png` a la **DIRECTORA autenticada** en `/dashboard/alumnos` después de la matrícula. Estas nueve capturas demuestran autorización, operación, persistencia y visibilidad administrativa, no solo apariencia. Las 18 capturas `fixture-<perfil>-` cubren seis estados visuales en Chromium, Pixel 5 Chromium y iPhone 13 WebKit: carga, vacío, apto/activo, ausencia de cursos, error de dominio simulado y foco visible. Las fixtures **solo prueban presentación**. Todos los nombres, DNI y correos de pruebas son sintéticos; las capturas no incluyen secretos, tokens ni información productiva.

## 8. Riesgos, reversión y retrospectiva

Riesgo residual: avisos de dependencias transitivas no críticos; lint global preexistente; advisor heredado. El cambio de RLS, las RPC y la API se deben revisar como un único candidato: revertir parcialmente solo la UI dejaría una superficie incoherente. Antes de producción, un rollback de código necesita revertir la migración mediante otra migración hacia adelante que restaure las políticas SELECT de 008/009 y retire las dos RPC; **no** se borra ni revierte físicamente una matrícula ya creada. La reversión de Next.js a 16.2.5 reintroduciría dos críticas y no es aceptable.

Retrospectiva: la tabla parental ya existía y recrearla habría sido destructivo; la autorización real debía cerrar tanto API como RLS. El estado ACTIVO y la matrícula vigente se validan por separado porque la corrupción no debe habilitar una segunda alta. El arnés de deportes de 015 exige horario incluso en fixtures. La limpieza E2E debe borrar primero `grupos_deportivos_horarios` para respetar FK RESTRICT. Próxima unidad dependiente: revisión humana de EPT-13 y de la evidencia, PR/merge autorizados y verificación posterior; no se inicia EPT-57 ni otras historias en esta unidad.

## 9. Commits funcionales y entrega

| Orden | SHA completo | Unidad |
|---|---|---|
| 1 | `72f4a9a4a4c9c5b5530e4802a8dce48f82bb3e87` | Persistencia, RLS/RPC, tipos y prueba SQL |
| 2 | `61758ba5012f1c0941c12ec88c46180ca3aa78a4` | API, interfaz, identidades y pruebas de navegador |
| 3 | `17124dc4c76b1131df6c008bf9d46cb07a6bd1e5` | Corrección de Next.js y eslint-config-next |

Este documento y las capturas forman el cuarto commit. No se realizó push, PR, merge, despliegue ni cambio en producción. EPT-13 permanece En curso hasta revisión e integración.
