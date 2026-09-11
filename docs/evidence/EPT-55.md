# EPT-55 — Administración de niveles educativos: evidencia de implementación

Este documento registra el candidato técnico de EPT-55 sobre la línea base
`d4bf6e97885d6492965e87c88387266b8f045acb`. Las afirmaciones se clasifican
como **Demostrada**, **Parcialmente demostrada** o **No demostrada**. Una
captura `fixture-` demuestra solamente presentación e interacción determinista;
una captura `real-` proviene de una sesión autenticada y datos del Supabase
local descartable.

## 1. Resumen ejecutivo

**Demostrada.** El candidato agrega persistencia, autorización, API, integración
con Cursos e interfaz administrativa para niveles educativos. La baja es lógica,
los registros institucionales tienen identidad estable, no existe eliminación
física y los niveles inactivos dejan de ofrecerse en asignaciones nuevas sin
perderse de relaciones históricas.

**Demostrada.** La verificación final aprobó migraciones 001–006, 54
comprobaciones SQL emitidas por `niveles_rls.sql`, las 39 comprobaciones de
regresión de Cursos, tipos, build, TypeScript, pruebas focalizadas y todas las
pruebas nuevas. Las dos ejecuciones completas conservan como único fallo final
el caso preexistente `tests/e2e.spec.ts:8` por la codificación `%2Fdashboard`.

**Parcialmente demostrada.** El código queda preparado para revisión humana;
la actualización final de Jira y la revisión por el otro integrante se realizan
fuera de este documento.

## 2. Alcance exacto

**Demostrada.** Se implementó exclusivamente RF4: catálogo administrativo,
estado, orden, protección institucional, operaciones seguras, acceso DIRECTOR,
integración con selectores de Cursos, pruebas, capturas y esta evidencia.

**Demostrada.** No se implementaron EPT-9, EPT-56, EPT-58, EPT-61, EPT-63 ni
EPT-66. No se cambió el comportamiento de actividades ni de preinscripción.

## 3. Estado Jira

**Parcialmente demostrada.** El contrato aprobado identifica EPT-55 como **En
curso**, responsable **Lucas Gimenez**, padre **EPT-2 — Administración
académica** y sin subtareas. Este work unit no ejecutó una lectura ni una
mutación de Jira, por lo que esos datos provienen del prompt aprobado y deben
refrescarse antes de publicar la trazabilidad final.

**No demostrada.** No se registra aquí un comentario final de Jira. Tampoco se
afirma transición a Listo: EPT-55 debe permanecer En curso hasta revisión e
integración comprobable.

## 4. Línea base y aislamiento

**Demostrada.** La base es `d4bf6e97885d6492965e87c88387266b8f045acb` y
`origin/main` continúa exactamente en ese SHA. `git merge-base --is-ancestor`
devolvió código 0. La rama es `codex/ept-55-admin-niveles` y el worktree es
`E:\Escritorio\codigo\MetodologiaTPI-ept55`.

**Parcialmente demostrada.** El checkout original permanece en `main`, SHA
`7b0facb299397c954482ef97b525fd8af6fb1680`, con sus cambios previos en
`AGENTS.md`, `.agents/skills/ept-sprint-orchestrator/`, `.atl/`, `.claude/` y
`docs/`. `git worktree list --porcelain` confirma que el candidato se trabajó
en un worktree separado; no existe una prueba criptográfica de ausencia de toda
escritura externa, pero no se ejecutó allí ningún comando de modificación.

## 5. Decisiones funcionales aplicadas

**Demostrada.** Los tres registros institucionales se identifican mediante
`es_institucional`, no por el texto de la interfaz. Pueden cambiar de estado,
pero no de nombre ni de condición institucional. Los niveles administrativos
pueden crearse y renombrarse. Todos usan baja lógica mediante `activo`.

**Demostrada.** El orden es explícito: 10, 20 y 30 para INICIAL, PRIMARIO y
SECUNDARIO; los adicionales usan una secuencia privada en saltos de diez. Los
nombres se rechazan si están vacíos, exceden 50 caracteres o contienen espacios
laterales; la unicidad se evalúa normalizada sin distinguir mayúsculas.

**Demostrada.** La página pública conserva contenido institucional estático y la
preinscripción sigue limitada a los tres niveles institucionales.

## 6. Criterios de aceptación

| Grupo | Estado | Síntesis |
|---|---|---|
| Administración DIRECTOR | **Demostrada** | Listado, alta, renombrado y cambio de estado por API e interfaz reales |
| Integridad PostgreSQL | **Demostrada** | Nombre, orden, protección, ACL, RLS, identidad y concurrencia cubiertos por SQL |
| Historia de Cursos | **Demostrada** | Solo activos en altas; relación actual inactiva visible y conservable |
| Ausencia de eliminación | **Demostrada** | Sin función, handler, control, policy ni grant DELETE; intentos rechazados |
| Otros actores | **Demostrada** | Anónimo, ESTUDIANTE, DOCENTE, PADRE, PERSONAL y usuario sin perfil sin escritura |
| Responsive y accesibilidad | **Demostrada** | Aserciones a 1280/375, foco, teclado, alertas, live region y ausencia de overflow |
| Jira actualizado | **No demostrada** | Requiere operación posterior del orquestador |
| Revisión humana | **No demostrada** | Es el próximo paso, no una acción de esta implementación |

## 7. Matriz criterio → implementación → prueba → evidencia

| Criterio | Implementación | Prueba | Evidencia | Veredicto |
|---|---|---|---|---|
| DIRECTOR consulta el listado | página server + `listarNiveles()` | `niveles-auth.spec.ts` | `real-escritorio-listado-autenticado.png` | **Demostrada** |
| Crear nivel válido | RPC privada y POST | SQL OK 10–12; auth real | `real-escritorio-ciclo-completo.png` | **Demostrada** |
| Renombrar administrativo conservando id | RPC `renombrar_nivel` | SQL OK 13–15; auth real | `fixture-escritorio-edicion.png` | **Demostrada** |
| Semillas obligatorias y ordenadas | migración 006 | SQL OK 1–4 | listado real | **Demostrada** |
| Institucionales no renombrables | trigger + RPC P5502 | SQL OK 19; API real | listado sin acción de renombre | **Demostrada** |
| Todos pueden cambiar estado | RPC `cambiar_estado_nivel` | SQL OK 16, 18, 19bis | confirmación móvil | **Demostrada** |
| Nombres válidos y únicos | CHECK + índice normalizado | SQL OK 20–23; HTTP/auth | duplicado real y fixture | **Demostrada** |
| Solo activos en asignaciones nuevas | trigger P5504 + consulta activa | SQL OK 24/24bis/39; Cursos auth | pruebas automatizadas | **Demostrada** |
| Historia inactiva conservada | lectura completa + excepción de relación actual | SQL OK 17/25/38; Cursos auth | prueba automatizada | **Demostrada** |
| Autorización servidor y base | `requerirDirector`, auth.getUser, RPC interna | HTTP 401/403; SQL OK 26–31 | acceso restringido real | **Demostrada** |
| Sin escritura directa | revokes + SELECT mínimo | SQL OK 32/33/41 | salida SQL | **Demostrada** |
| Sin eliminación | ausencia de superficie + ACL/RLS | SQL OK 35/42; HTTP 405 | `real-escritorio-sin-eliminacion.png` | **Demostrada** |
| Navegación solo DIRECTOR | layout condicionado por rol + página protegida | auth DIRECTOR/ESTUDIANTE | capturas reales | **Demostrada** |
| 1280 y 375 sin overflow | tabla/tarjetas responsive | UI focalizada | capturas escritorio/móvil | **Demostrada** |
| Teclado y foco | diálogo propio con focus trap/retorno | UI focalizada | aserciones Playwright | **Demostrada** |
| Idioma español | copy y nombres accesibles | guard sobre contenido visible | capturas + prueba UI | **Demostrada** |
| Página pública desacoplada | no consulta tabla; copy atemporal | build marca `/niveles` estática | salida de build | **Demostrada** |
| Preinscripción institucional | selector existente sin modificación | prueba general de página | inspección de diff | **Parcialmente demostrada** |
| Jira con trazabilidad | comentario final | no ejecutada aquí | ninguna | **No demostrada** |

## 8. Cambios por archivo

**Demostrada.** `git diff --name-status` desde la base identifica estas
responsabilidades:

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/006_administracion_niveles.sql` | esquema, backfill, integridad, RPC, triggers, ACL y RLS |
| `supabase/tests/niveles_rls.sql` | 54 comprobaciones emitidas dentro de transacción y rollback |
| `src/types/database.generated.ts` | tipos generados desde la base local final |
| `src/types/database.types.ts` | tipos manuales reconciliados sin corregir drift ajeno |
| `src/services/autorizacion.ts` | autorización DIRECTOR reutilizable con copy parametrizable |
| `src/services/niveles.service.ts` | lecturas, RPC ligadas a sesión y traducción de dominio |
| `src/services/niveles.client.ts` | cliente browser para POST/PATCH |
| `src/lib/validations.ts` | contratos Zod de alta y PATCH discriminado |
| `src/app/api/niveles/route.ts` | POST; sin GET ni DELETE |
| `src/app/api/niveles/[id]/route.ts` | PATCH por id entero positivo; sin DELETE |
| `src/services/cursos.service.ts` | niveles activos y traducción segura de P5504 |
| `src/app/dashboard/cursos/page.tsx` | entrega opciones activas e historia al cliente |
| `src/app/dashboard/cursos/_components/GestionCursos.tsx` | conserva el nivel actual inactivo, sin ofrecer otros inactivos |
| `src/app/dashboard/niveles/page.tsx` | página server protegida y lectura completa ordenada |
| `src/app/dashboard/niveles/loading.tsx` | esqueleto de carga |
| `src/app/dashboard/niveles/error.tsx` | error de segmento recuperable |
| `src/app/dashboard/niveles/_components/GestionNiveles.tsx` | tabla/tarjetas, formularios, estados y diálogos accesibles |
| `src/app/dashboard/layout.tsx` | navegación Niveles exclusiva de DIRECTOR |
| `src/app/pruebas-ui/niveles/page.tsx` | harness visual con doble guarda |
| `src/app/(public)/niveles/page.tsx` | neutralización puntual de copy numérico |
| `src/app/(public)/page.tsx` | copy institucional atemporal |
| `tests/niveles.spec.ts` | frontera HTTP anónima, precedencia y 405 |
| `tests/niveles-auth.spec.ts` | API e interfaz con sesiones reales |
| `tests/niveles-ui.spec.ts` | estados, responsive, idioma, teclado y capturas fixture |
| `tests/cursos-auth.spec.ts` | reglas activas/históricas contra Supabase real |
| `tests/auth.setup.ts` | identidades, login real y aislamiento local seguro |
| `playwright.config.ts` | proyectos auth condicionales y ejecución serial sobre base compartida |
| `docs/evidence/EPT-55.md` | este informe |
| `docs/evidence/EPT-55/*.png` | veinte capturas finales inspeccionadas |

## 9. Esquema final

**Demostrada.** `public.niveles` conserva `id` y `nombre`, y agrega:

| Columna | Definición |
|---|---|
| `activo` | `BOOLEAN NOT NULL DEFAULT TRUE` |
| `orden` | `INTEGER NOT NULL`, `CHECK (orden > 0)`, índice único |
| `es_institucional` | `BOOLEAN NOT NULL DEFAULT FALSE` |

**Demostrada.** `niveles_nombre_valido` exige `nombre = BTRIM(nombre)` y longitud
1..50. Se preserva `idx_niveles_nombre_normalizado`; no se duplicó su función.

## 10. Estado, orden y protección institucional

**Demostrada.** INICIAL/PRIMARIO/SECUNDARIO reciben órdenes 10/20/30 y
`es_institucional = true`. Extras preexistentes se ordenan desde 40 por
`UPPER(BTRIM(nombre))`, no por id. `app_private.niveles_orden_seq` asigna nuevos
órdenes con incremento 10 y se sincroniza con el máximo luego del backfill.

**Demostrada.** `app_private.proteger_nivel()` impide cambiar orden, condición
institucional o nombre institucional, pero permite cambiar `activo`.

## 11. Arquitectura de autorización

**Demostrada.** La frontera HTTP invoca primero `requerirDirector()`, que usa
cliente ligado a cookies, `auth.getUser()` y `es_director_actual()`. Luego valida
el cuerpo. PostgreSQL vuelve a derivar identidad con `auth.uid()` y consulta
`app_private.es_director()` dentro de cada operación crítica.

**Demostrada.** Las privadas son `VOLATILE SECURITY DEFINER` con
`SET search_path = ''`; los wrappers públicos son `SECURITY INVOKER` mínimos.
Ninguna función acepta actor, usuario o rol para autorizar.

## 12. Matriz por actor

| Actor | Menú | Página | API | Lectura persistida | Escritura | Eliminación | Estado |
|---|---:|---:|---:|---:|---:|---:|---|
| DIRECTOR | Sí | Sí | POST/PATCH | Sí | Solo RPC | No | **Demostrada** |
| ESTUDIANTE | No | Restringida | 403 | Sí cuando la app lo requiere | No | No | **Demostrada** |
| DOCENTE | No | Restringida | 403 esperado por rol | Sí | No | No | **Demostrada en SQL; parcial en navegador** |
| PADRE | No | Restringida | 403 esperado por rol | Sí | No | No | **Demostrada en SQL; parcial en navegador** |
| PERSONAL | No | Restringida | 403 esperado por rol | Sí | No | No | **Demostrada en SQL; parcial en navegador** |
| autenticado sin perfil | No | Restringida | 403 esperado | Sí por ACL | No | No | **Demostrada en SQL** |
| anónimo | No | Login/no exposición | 401 | No | No | No | **Demostrada** |

## 13. Matriz de privilegios sobre tabla, secuencias y funciones

| Objeto | `anon` | `authenticated` | `PUBLIC` | Estado |
|---|---|---|---|---|
| `public.niveles` | ninguno | SELECT | ninguno | **Demostrada, SQL OK 32** |
| `public.niveles_id_seq` | ninguno | sin USAGE | ninguno | **Demostrada, SQL OK 33** |
| `app_private.niveles_orden_seq` | ninguno | sin USAGE | ninguno | **Demostrada, SQL OK 8/33** |
| privadas crear/renombrar/estado | ninguno | EXECUTE mínimo para wrapper | ninguno | **Demostrada, SQL OK 34bis** |
| wrappers públicos | ninguno | EXECUTE | ninguno | **Demostrada, SQL OK 34** |
| función o policy DELETE | inexistente | inexistente | inexistente | **Demostrada, SQL OK 35** |

## 14. Fronteras servidor, base e interfaz

**Demostrada.** La interfaz nunca habla directamente con la tabla para escribir:
usa `niveles.client.ts`, POST/PATCH, autorización server, servicio ligado a
sesión, wrappers y privadas. RLS/ACL permanecen como defensa final.

**Demostrada.** Los errores 23505, P5501, P5502, P5503, P5504, P5505 y 42501 se
traducen a resultados de dominio; respuestas inesperadas usan un mensaje seguro
sin SQL, SQLSTATE ni detalles del proveedor.

## 15. Comprobación de que no existe eliminación

**Demostrada.** No hay handler DELETE, función de borrado, policy DELETE, grant
DELETE ni control visual. DELETE sobre colección e individuo devuelve 405; el
borrado directo se rechaza con 42501. La captura real sin eliminación se apoya
en una aserción que busca controles llamados eliminar o borrar y obtiene cero.

## 16. Comportamiento histórico de niveles inactivos

**Demostrada.** La lectura administrativa incluye activos e inactivos. Un curso
puede actualizar otros datos conservando su `nivel_id` inactivo; el trigger solo
exige estado activo en INSERT o al cambiar `nivel_id`. El listado histórico
mantiene nombre y relación.

## 17. Relación con Cursos

**Demostrada.** Las altas ofrecen `listarNivelesActivos()` ordenado por `orden`.
En edición se agrega únicamente el nivel actual inactivo y se rotula
“inactivo · selección actual”. Intentar una nueva asignación inactiva devuelve
P5504 traducido de manera segura. `cursos.nivel_id` conserva NOT NULL y ON
DELETE RESTRICT.

## 18. Alcance deliberadamente excluido de actividades

**Demostrada.** `actividades.nivel_id ON DELETE SET NULL` no se modificó. Como
EPT-55 no expone eliminación, esa acción referencial no puede activarse desde
este módulo. Su revisión integral pertenece a EPT-66.

## 19. Relación con la página pública

**Demostrada.** `/niveles` no consulta el catálogo administrativo y el build la
reporta como `○ Static`. Solo se neutralizaron afirmaciones numéricas que podían
confundirse con el tamaño del catálogo; se conservó la presentación individual
de Inicial, Primario y Secundario.

## 20. Relación con preinscripción

**Parcialmente demostrada.** No existe diff en el formulario de preinscripción y
la prueba E2E general confirma que `/inscripcion` renderiza. El selector conserva
la implementación previa con Inicial, Primario y Secundario; este work unit no
añadió un caso focalizado que enumere sus opciones.

## 21. Pruebas SQL

**Demostrada.** Tras reset limpio, `niveles_rls.sql` emitió **54 líneas OK**, sin
fallos ni errores, y terminó en ROLLBACK. Cubre semillas, orden, identidad
institucional, nombre, concurrencia, relación, estados, actores, ACL, RLS,
funciones, ausencia de DELETE y compatibilidad con actividades.

**Demostrada.** `cursos_rls.sql` emitió exactamente **39 OK**, cero fallos y cero
errores, también dentro de transacción con rollback.

## 22. Pruebas del servidor

**Demostrada.** `tests/niveles.spec.ts` contiene 9 casos anónimos/HTTP: 401,
precedencia autorización-validación, JSON inválido, id/contrato PATCH, ausencia
de GET persistido y DELETE 405. `tests/niveles-auth.spec.ts` prueba contra sesión
real creación, renombrado, estado, duplicado PostgreSQL, nombre inválido,
protección, inexistente, error inesperado seguro y 403.

## 23. Pruebas del navegador

**Demostrada.** La corrida focalizada HTTP/UI obtuvo **20 passed**. La corrida
autenticada de Niveles obtuvo **17 passed** contando 3 casos de setup. La suite
completa sin base obtuvo **48 passed, 1 fallo preexistente**; la final con base
obtuvo **79 passed, 1 fallo preexistente**.

**Demostrada.** Las pruebas reales usan el formulario de login y storage state;
no fabrican tokens. La suite destructiva se omite salvo
`EPT_SUPABASE_LOCAL=1`.

## 24. Accesibilidad

**Demostrada.** Playwright verifica etiquetas, región `aria-live` nombrada,
`role="alert"`, foco inicial, Tab/Shift+Tab contenidos, Escape y retorno al
disparador. Los diálogos son propios y accesibles; no se usa `window.confirm`.

## 25. Responsive

**Demostrada.** A 1280 px se usa tabla y a 375 px tarjetas. Las pruebas comparan
`scrollWidth` con `clientWidth` y no detectan desplazamiento horizontal. Las
capturas móviles de hasta 1513 px de alto son `fullPage`: su altura documenta el
contenido completo, no overflow horizontal.

## 26. Auditoría de idioma

**Demostrada.** La prueba recopila texto visible y nombres de `aria-label`,
`placeholder` y `title`, y excluye vocabulario de controles en inglés mediante
límites de palabra. Las capturas inspeccionadas muestran copy profesional en
español. Identificadores técnicos y salidas de herramientas quedan fuera de
esta regla.

## 27. Comandos ejecutados

**Demostrada.** Entorno observado: Next.js 16.2.5, Supabase CLI 2.117.0 vía
`npx`, PostgreSQL 17 local y Playwright del proyecto.

```powershell
npx.cmd supabase db reset --local
npx.cmd supabase migration list --local
docker cp supabase/tests/niveles_rls.sql supabase_db_educar-para-transformar:/tmp/niveles_rls.sql
docker exec supabase_db_educar-para-transformar psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/niveles_rls.sql
docker cp supabase/tests/cursos_rls.sql supabase_db_educar-para-transformar:/tmp/cursos_rls.sql
docker exec supabase_db_educar-para-transformar psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/cursos_rls.sql
npx.cmd tsc --noEmit --incremental false
npx.cmd eslint --no-cache -- <archivos TypeScript modificados desde la base>
npm.cmd run build
npx.cmd playwright test tests/niveles.spec.ts tests/niveles-ui.spec.ts --project=chromium
$env:EPT_SUPABASE_LOCAL='1'; npx.cmd playwright test tests/niveles-auth.spec.ts
npm.cmd run test:e2e
$env:EPT_SUPABASE_LOCAL='1'; npm.cmd run test:e2e
npm.cmd run lint -- --no-cache
npx.cmd supabase gen types typescript --local
npx.cmd supabase db advisors --local --type security
npx.cmd supabase db advisors --local --type performance
git diff --check
```

## 28. Códigos de salida

| Comando | Código |
|---|---:|
| reset final / lista de migraciones | 0 / 0 |
| SQL Niveles / SQL Cursos | 0 / 0 |
| TypeScript / ESLint focalizado / build | 0 / 0 / 0 |
| Niveles HTTP+UI / Niveles autenticado | 0 / 0 |
| E2E completo sin base | 1, por el único fallo preexistente |
| E2E completo con base | 1, por el único fallo preexistente |
| lint completo | 1, por 16 errores preexistentes |
| generación canónica de tipos / diff de tipos | 0 / 0 |
| asesor seguridad / rendimiento | 0 / 0 |
| `git diff --check` | 0 |

## 29. Resultados exactos

| Verificación | Resultado |
|---|---|
| Migraciones | 001, 002, 003, 004, 005 y 006 locales/remotas |
| Niveles SQL | 54 OK; 0 fallos; 0 errores |
| Cursos SQL | exactamente 39 OK; 0 fallos; 0 errores |
| TypeScript | sin salida; código 0 |
| ESLint focalizado | 0 errores, 2 advertencias preexistentes |
| Build | compilación, tipos y 20 páginas generadas; código 0 |
| Niveles HTTP/UI | 20 passed |
| Niveles auth | 17 passed |
| E2E sin DB | 48 passed, 1 failed |
| E2E con DB | 79 passed, 1 failed |
| lint completo | 125 problemas: 16 errores, 109 advertencias |
| capturas | 20 PNG inspeccionados y aceptados |

## 30. Fallos preexistentes separados de regresiones

**Demostrada.** La línea base registró E2E sin DB **28/29**, E2E auth **44/45**
y lint **125 (16/109)**. El candidato registra **48/49**, **79/80** y exactamente
**125 (16/109)**. El único fallo E2E final sigue siendo
`tests/e2e.spec.ts:8`: esperaba `/login?redirect=/dashboard` y recibió
`/login?redirect=%2Fdashboard`. Las 20 pruebas sin DB y 35 pruebas con DB
agregadas/ampliadas por EPT-55 pasan.

**Demostrada.** Una primera corrida autenticada completa obtuvo 78/80 por una
carrera adicional: Cursos y Niveles mutaban simultáneamente el catálogo local.
Se limitó a un worker solo cuando `EPT_SUPABASE_LOCAL=1`; después de reset, la
corrida final obtuvo 79/80 y eliminó esa regresión de prueba sin cambiar
producción.

## 31. Resultados de asesores de Supabase

**Demostrada.** Seguridad devuelve 6 hallazgos preexistentes: 2
`function_search_path_mutable`, 1 ERROR por RLS deshabilitado en `actividades` y
3 WARN por policies INSERT permisivas. Rendimiento devuelve 13 WARN: 7
`auth_rls_initplan` y 6 `multiple_permissive_policies`. Ninguno referencia
`niveles`, sus funciones, secuencias o policies; los conteos coinciden con la
evidencia de EPT-8.

## 32. Capturas con índice y explicación

**Demostrada.** Se abrieron e inspeccionaron visualmente los veinte PNG con
`view_image`. Todos corresponden al estado indicado, muestran copy en español y
no presentan overflow horizontal visible.

| Captura | Origen | Qué demuestra visualmente |
|---|---|---|
| [fixture-escritorio-listado.png](EPT-55/fixture-escritorio-listado.png) | fixture 1280 | listado completo y ordenado |
| [fixture-escritorio-formulario-alta.png](EPT-55/fixture-escritorio-formulario-alta.png) | fixture 1280 | formulario de alta y foco |
| [fixture-escritorio-error-duplicado.png](EPT-55/fixture-escritorio-error-duplicado.png) | fixture 1280 | duplicado en región y campo |
| [fixture-escritorio-nivel-inactivo.png](EPT-55/fixture-escritorio-nivel-inactivo.png) | fixture 1280 | estados inactivos y reactivación |
| [fixture-escritorio-edicion.png](EPT-55/fixture-escritorio-edicion.png) | fixture 1280 | diálogo de renombrado |
| [fixture-escritorio-enviando.png](EPT-55/fixture-escritorio-enviando.png) | fixture 1280 | envío bloqueado con “Cargando...” |
| [fixture-escritorio-error.png](EPT-55/fixture-escritorio-error.png) | fixture 1280 | error recuperable |
| [fixture-escritorio-alta-exitosa.png](EPT-55/fixture-escritorio-alta-exitosa.png) | fixture 1280 | alta exitosa |
| [fixture-escritorio-exito.png](EPT-55/fixture-escritorio-exito.png) | fixture 1280 | estado de éxito inicial |
| [fixture-escritorio-carga.png](EPT-55/fixture-escritorio-carga.png) | fixture 1280 | esqueleto de carga |
| [fixture-escritorio-vacio.png](EPT-55/fixture-escritorio-vacio.png) | fixture 1280 | estado vacío |
| [fixture-movil-listado.png](EPT-55/fixture-movil-listado.png) | fixture 375 | tarjetas sin tabla horizontal |
| [fixture-movil-formulario.png](EPT-55/fixture-movil-formulario.png) | fixture 375 | alta móvil completa |
| [fixture-movil-confirmacion-estado.png](EPT-55/fixture-movil-confirmacion-estado.png) | fixture 375 | confirmación de inactivación |
| [fixture-movil-renombrado.png](EPT-55/fixture-movil-renombrado.png) | fixture 375 | diálogo de edición móvil |
| [real-escritorio-listado-autenticado.png](EPT-55/real-escritorio-listado-autenticado.png) | real DIRECTOR | menú, identidad y catálogo de la base |
| [real-escritorio-ciclo-completo.png](EPT-55/real-escritorio-ciclo-completo.png) | real DIRECTOR | persistencia y ciclo completo |
| [real-escritorio-duplicado-desde-postgresql.png](EPT-55/real-escritorio-duplicado-desde-postgresql.png) | real DIRECTOR | duplicado traducido desde PostgreSQL |
| [real-escritorio-sin-eliminacion.png](EPT-55/real-escritorio-sin-eliminacion.png) | real DIRECTOR | interfaz sin controles de borrado, respaldada por aserción |
| [real-escritorio-estudiante-restringido.png](EPT-55/real-escritorio-estudiante-restringido.png) | real ESTUDIANTE | navegación ausente y página restringida |

Las capturas fixture **no** demuestran PostgreSQL ni autorización. Las capturas
reales complementan, pero no reemplazan, las aserciones HTTP y SQL.

## 33. Privacidad y manejo de credenciales

**Demostrada.** No se confirmó `.env.local`, `tests/.auth`, resultados,
trazas ni secretos. Las capturas contienen identidades sintéticas, sin correos,
tokens ni valores de configuración. El CRUD de producción no usa
`service_role`; su única presencia funcional está en `tests/auth.setup.ts` para
crear/limpiar datos del stack local descartable, detrás de variable explícita y
hostname exacto `localhost`, `127.0.0.1` o `::1`.

**Demostrada.** El escaneo del parche staged obtuvo `SECRET_VALUE_MATCHES=0` y
`ATTRIBUTION_PATCH_MATCHES=0`; los cuatro commits previos obtuvieron
`ATTRIBUTION_COMMIT_MATCHES=0`. La inspección binaria acotada de los veinte PNG
obtuvo `PNG_SECRET_MARKERS=0`.

## 34. Riesgos restantes

1. **Demostrada como preexistente.** `actividades` sigue sin RLS y conserva ON
   DELETE SET NULL; corresponde a EPT-66.
2. **Demostrada como preexistente.** Persisten 6 hallazgos de seguridad y 13 de
   rendimiento, ninguno introducido por EPT-55.
3. **Demostrada como preexistente.** Continúan 125 problemas de lint global y el
   redirect codificado del E2E general.
4. **Parcialmente demostrada.** Los roles distintos de DIRECTOR y ESTUDIANTE se
   prueban en PostgreSQL, no con una sesión de navegador por cada rol.
5. **No demostrada.** La revisión humana y la integración a `main` aún no
   ocurrieron.

## 35. Retrospectiva

**Demostrada.** La separación entre lectura activa y lectura histórica evitó
resolver un requisito nuevo rompiendo datos existentes. La identidad
institucional explícita evita que la protección dependa del copy. La secuencia
privada evita carreras de `max(orden) + 10`.

**Demostrada.** El principal defecto detectado durante la verificación final fue
de aislamiento: suites correctas individualmente podían interferirse sobre la
misma base local. Serializar solo el modo destructivo convirtió esa condición en
una prueba reproducible sin encubrir el fallo E2E preexistente.

**Demostrada.** La primera redirección directa de tipos produjo únicamente drift
de BOM/nueva línea por Windows. Se regeneró desde la misma base aplicando la
convención ya versionada (UTF-8 BOM y LF final); hash antes/después
`E48E71E3963EBB3A242862DFD92294086F9D7E04553D39AB84E2C7B04F2105B8` y diff 0.

## 36. Instrucciones de reproducción

**Demostrada.** En Windows/PowerShell, desde el worktree:

1. Iniciar Docker y ejecutar `npx.cmd supabase start` si el stack no está activo.
2. Ejecutar `npx.cmd supabase db reset --local`.
3. Copiar y ejecutar ambas pruebas SQL con los comandos de la sección 27.
4. Ejecutar `npx.cmd tsc --noEmit --incremental false` y `npm.cmd run build`.
5. Ejecutar la prueba focalizada de 20 casos y luego
   `$env:EPT_SUPABASE_LOCAL='1'; npx.cmd playwright test tests/niveles-auth.spec.ts`.
6. Para regenerar evidencia, agregar `$env:EPT_CAPTURAS='1'`; las capturas se
   escriben en `docs/evidence/EPT-55/`.
7. Ejecutar ambas suites completas y comparar contra 48/49 y 79/80.

## 37. Límite de reversión

**Demostrada.** Revertir de adelante hacia atrás:

1. `test(niveles): completar pruebas y evidencia` — elimina documentación,
   capturas y ajustes de evidencia/aislamiento; no cambia producción.
2. `372b5aba247e9d0e475d0b6810590f7d75bd81a1` — interfaz, navegación,
   harness y copy público.
3. `cf8d438acd3d4924851e42ab3a0600648107f4ad` — integración activa/histórica
   de Cursos.
4. `c39b4bbd0f5b0046e022179b39688bfbe47cc547` — API, servicios y validación.
5. `7ab799a4a955bff0c305999e6a97166358f4f275` — migración 006 y tipos.

**Demostrada.** Revertir el archivo de migración no deshace un esquema ya
aplicado. Fuera de un entorno descartable debe crearse una migración posterior;
no se edita ni elimina una migración aplicada y la reversión no debe reabrir
privilegios inseguros. El SHA del quinto commit se obtiene después de confirmar
este mismo documento: no puede auto-incrustarse en el contenido del objeto Git
que lo calcula.
