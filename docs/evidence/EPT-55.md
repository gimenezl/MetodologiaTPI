# EPT-55 — Administración de niveles educativos: evidencia de implementación

Este documento registra el candidato de EPT-55 sobre la base
`d4bf6e97885d6492965e87c88387266b8f045acb`. Cada afirmación se marca como
**Demostrada**, **Parcialmente demostrada** o **No demostrada**. Una captura
`fixture-` acredita presentación e interacción determinista; una captura
`real-` proviene de una sesión autenticada contra el Supabase local
descartable. Las pruebas automatizadas, y no las capturas, acreditan reglas de
base de datos, concurrencia y autorización.

## 1. Resumen ejecutivo

**Demostrada.** El candidato incorpora persistencia, API, autorización,
integración con Cursos e interfaz administrativa de niveles. La baja es lógica,
no existe eliminación física y los niveles inactivos dejan de admitirse en
asignaciones nuevas sin perder relaciones históricas.

**Demostrada.** La corrección posterior a revisión agrega la migración 007,
endurece el contrato de whitespace, cierra la carrera entre asignación e
inactivación mediante bloqueo de fila y extiende la misma invariante a
`actividades.nivel_id`. El reset 001–007, 73 comprobaciones SQL, cuatro
intercalaciones concurrentes, las 39 regresiones SQL de Cursos y todas las
pruebas nuevas finalizaron correctamente.

**Parcialmente demostrada.** La revisión independiente que originó esta
corrección quedó atendida. La integración a `main` y la transición final de
Jira continúan fuera de este candidato.

## 2. Alcance exacto

**Demostrada.** El alcance comprende catálogo, estado, orden, protección
institucional, operaciones seguras, acceso DIRECTOR, integración con Cursos,
invariante mínima de asignación para Actividades, pruebas y evidencia.

**Demostrada.** No se implementaron EPT-9, EPT-56, EPT-58, EPT-61, EPT-63 ni
EPT-66. No se creó un módulo de Actividades, no se alteró su RLS general, ACL,
FK ni `ON DELETE SET NULL`; tampoco se dinamizó la preinscripción.

## 3. Estado Jira

**Demostrada.** La evidencia previa registró EPT-55 En curso, responsable Lucas
Gimenez y padre EPT-2. Los comentarios 10032–10034 pertenecen a la primera
preparación del candidato.

**Parcialmente demostrada.** Esta corrección no comenta ni transiciona Jira: el
agente responsable de la entrega realizará esa acción después de validar el SHA
final. Por eso no se atribuye a este documento una actualización posterior que
todavía no ocurrió.

## 4. Línea base y aislamiento

**Demostrada.** La corrección comenzó en la rama
`codex/ept-55-admin-niveles`, HEAD
`cc9ede3caa4d1dedcb473697ecb00016df8bbcc4`, árbol limpio, base
`d4bf6e97885d6492965e87c88387266b8f045acb` y siete commits intactos.

**Demostrada.** El checkout original se mantuvo en `main`, SHA
`7b0facb299397c954482ef97b525fd8af6fb1680`, con sus cambios previos en
`AGENTS.md`, `.agents/skills/ept-sprint-orchestrator/`, `.atl/`,
`.claude/` y `docs/`. No se ejecutaron fetch, rebase, reset, stash, amend,
push, PR ni merge.

## 5. Decisiones funcionales aplicadas

**Demostrada.** Los institucionales se identifican por
`es_institucional`, no por copy. Pueden cambiar de estado, pero no de nombre,
orden ni condición institucional. Los administrativos pueden crearse y
renombrarse; todos usan baja lógica.

**Demostrada.** El orden es explícito y concurrente: 10/20/30 para
INICIAL/PRIMARIO/SECUNDARIO y una secuencia privada con incremento 10 para
nuevos niveles. El nombre se rechaza, sin recorte silencioso, cuando está vacío,
supera 50 caracteres o tiene whitespace lateral reconocido.

**Demostrada.** Una nueva asignación obtiene `activo` y el bloqueo de la fila
de `niveles` en una sola consulta `SELECT ... FOR SHARE`. Una actualización
histórica que no cambia `nivel_id` se permite sin bloquear; `NULL` continúa
permitido para Actividades.

## 6. Criterios de aceptación

| Grupo | Estado | Evidencia principal |
|---|---|---|
| Administración DIRECTOR | **Demostrada** | SQL, HTTP/auth y capturas reales |
| Integridad de nombre | **Demostrada** | RPC, CHECK directo, Zod y HTTP |
| Concurrencia asignación/estado | **Demostrada** | dos conexiones reales, cuatro intercalaciones |
| Cursos activos e historia | **Demostrada** | trigger, servicio y regresiones |
| Actividades activas e historia | **Demostrada en integridad** | trigger/SQL; UI y RLS general fuera de alcance |
| Ausencia de eliminación | **Demostrada** | ACL/RLS, 405 y ausencia de controles |
| Responsive y accesibilidad | **Demostrada** | escritorio Chrome, Pixel 5 Chromium, iPhone 13 WebKit |
| Integración a main/Jira final | **No demostrada** | acción posterior |

## 7. Matriz criterio → implementación → prueba → evidencia

| Criterio | Implementación | Prueba | Evidencia | Veredicto |
|---|---|---|---|---|
| Crear y renombrar | RPC privadas + wrappers + API | SQL y auth | capturas ciclo/edición | **Demostrada** |
| Nombre 1..50 sin whitespace lateral | helper SQL + CHECK + Zod | tabs/LF/CR/combinado/NBSP, uno/múltiples | 73 OK + auth | **Demostrada** |
| Unicidad normalizada | índice existente | mayúsculas y duplicado con tabs | SQL + captura real | **Demostrada** |
| Orden concurrente | secuencia privada | SQL estructural | salida SQL | **Demostrada** |
| Proteger institucionales | trigger + P5502 | SQL/API real | UI sin renombrado | **Demostrada** |
| Curso nuevo solo activo | trigger con `FOR SHARE` | SQL + concurrencia + Cursos auth | salidas automatizadas | **Demostrada** |
| Curso histórico conservado | retorno temprano si no cambia `nivel_id` | SQL + auth | salida automatizada | **Demostrada** |
| Actividad nueva solo activa | trigger con `FOR SHARE` | SQL + concurrencia | salida automatizada | **Demostrada** |
| Actividad histórica/`NULL` | excepción histórica y NULL | SQL directo | salida automatizada | **Demostrada** |
| Actores sin escritura | ACL/RLS/RPC | SQL por actor y HTTP 401/403 | salidas automatizadas | **Demostrada** |
| Sin DELETE | ausencia de handler/función/policy/grant | SQL + HTTP 405 | captura real | **Demostrada** |
| Tabla/tarjetas accesibles | UI responsive y diálogo propio | Playwright cross-engine | fixture + aserciones | **Demostrada** |
| Preinscripción institucional | selector estático | E2E exacto de tres opciones | salida automatizada | **Demostrada** |

## 8. Cambios por archivo

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/006_administracion_niveles.sql` | base original de catálogo, RPC, ACL y RLS; no se modificó en la corrección |
| `supabase/migrations/007_correcciones_integridad_niveles.sql` | whitespace ampliado y locks para Cursos/Actividades |
| `supabase/tests/niveles_rls.sql` | 73 controles SQL directos y estructurales |
| `supabase/tests/niveles_concurrencia.mjs` | dos sesiones PostgreSQL persistentes y cuatro intercalaciones |
| `src/lib/validations.ts` | contrato Zod equivalente de whitespace |
| `src/services/niveles.service.ts` | traducción segura P5501 |
| `tests/niveles-auth.spec.ts` | whitespace y traducción con sesión real |
| `playwright.config.ts` | perfiles oficiales Pixel 5/iPhone 13, acotados a responsive |
| `tests/niveles-ui.spec.ts` | suite de escritorio sin duplicar casos móviles |
| `tests/niveles-responsive.spec.ts` | tarjetas, overflow, formulario, diálogo y foco cross-engine |
| `docs/evidence/EPT-55.md` | evidencia corregida |

**Demostrada.** Los demás archivos de EPT-55 permanecen en los siete commits
anteriores: tipos, autorización, API, servicios, Cursos, interfaz, harness,
pruebas y veinte PNG.

## 9. Esquema final

**Demostrada.** `public.niveles` conserva `id` y `nombre`, y agrega
`activo BOOLEAN NOT NULL DEFAULT TRUE`, `orden INTEGER NOT NULL` positivo y
único, y `es_institucional BOOLEAN NOT NULL DEFAULT FALSE`.

**Demostrada.** La migración 007 reemplaza el CHECK
`niveles_nombre_valido` para delegar en
`app_private.nombre_nivel_valido(text)`; conserva
`idx_niveles_nombre_normalizado` sin duplicarlo.

## 10. Estado, orden y protección institucional

**Demostrada.** INICIAL, PRIMARIO y SECUNDARIO siguen protegidos y ordenados
10/20/30. Los extras preexistentes fueron ordenados desde 40 por
`UPPER(BTRIM(nombre))`. La secuencia privada continúa sincronizada con el
máximo.

**Demostrada.** `proteger_nivel()` impide cambiar orden, condición
institucional y nombre institucional, pero permite cambiar `activo`.

## 11. Arquitectura de autorización

**Demostrada.** La API exige primero `requerirDirector()` con cliente ligado
a cookies y `auth.getUser()`, y recién después valida el cuerpo. PostgreSQL
deriva identidad mediante `auth.uid()`; ninguna RPC acepta actor o rol.

**Demostrada.** Las privadas permanecen `SECURITY DEFINER` con
`search_path = ''`; los wrappers son `SECURITY INVOKER`. El helper del CHECK
revoca EXECUTE a PUBLIC/anon/authenticated y lo concede solo a `service_role`,
porque PostgreSQL evalúa la función del CHECK con el rol que realiza DML.

## 12. Matriz por actor

| Actor | Administración | Lectura requerida | Asignar nivel inactivo | DELETE |
|---|---:|---:|---:|---:|
| DIRECTOR | Sí, vía RPC/API | Sí | No, P5504 | No |
| DOCENTE | No | Sí según aplicación | No, P5504 | No |
| ESTUDIANTE | No | Sí según aplicación | No, P5504 | No |
| PADRE | No | Sí según aplicación | No, P5504 | No |
| PERSONAL | No | Sí según aplicación | No, P5504 | No |
| autenticado sin perfil | No | SELECT mínimo | No | No |
| anónimo | No | No | No | No |

**Demostrada.** SQL cubre todos los actores; navegador real cubre DIRECTOR y
ESTUDIANTE. No se afirma una sesión de navegador por cada rol.

## 13. Matriz de privilegios sobre tabla, secuencias y funciones

| Objeto | anon | authenticated | PUBLIC | Nota |
|---|---|---|---|---|
| `public.niveles` | ninguno | SELECT | ninguno | sin escritura directa |
| secuencias de niveles | sin USAGE | sin USAGE | sin USAGE | orden no manipulable |
| privadas administrativas | ninguno | EXECUTE mínimo para wrappers | ninguno | esquema no expuesto |
| wrappers públicos | ninguno | EXECUTE | ninguno | sin DELETE |
| helper de CHECK | ninguno | ninguno | ninguno | EXECUTE solo service_role |

## 14. Fronteras servidor, base e interfaz

**Demostrada.** La interfaz escribe por POST/PATCH, servicio ligado a sesión,
wrappers y privadas. Los códigos 23505, P5501, P5502, P5503, P5504, P5505 y
42501 se traducen a resultados seguros; errores inesperados no filtran SQL ni
datos del proveedor.

**Demostrada.** La traducción de P5501 dice “caracteres en blanco al inicio o
al final”, coherente con el contrato ampliado y sin prometer solo espacios ASCII.

## 15. Comprobación de que no existe eliminación

**Demostrada.** No hay handler DELETE, función, policy, grant ni control visual
de borrado. DELETE HTTP devuelve 405 y el intento directo se rechaza con 42501.
La migración 007 no introduce superficie de eliminación.

## 16. Comportamiento histórico de niveles inactivos

**Demostrada.** La lectura administrativa incluye activos e inactivos. Cuando
un UPDATE conserva el mismo `nivel_id`, Cursos y Actividades pueden modificar
otros datos aunque el nivel ya esté inactivo. No se cambia ni borra la relación.

## 17. Relación con Cursos

**Demostrada.** Las altas ofrecen niveles activos ordenados. La edición muestra
el nivel actual inactivo como “inactivo · selección actual” sin ofrecer otros
inactivos. La base rechaza INSERT/reasignación a inactivo con P5504.

**Demostrada.** `validar_nivel_activo_curso()` obtiene `activo` y adquiere
`FOR SHARE` en la misma consulta. La inactivación concurrente debe esperar al
fin de la asignación; si la inactivación confirma primero, la asignación espera
y luego rechaza P5504.

## 18. Alcance acotado de Actividades

**Demostrada.** La migración 007 agrega a `public.actividades.nivel_id` la
misma regla de nivel activo y el mismo lock. INSERT/UPDATE hacia inactivo
rechazan P5504; conservar la relación histórica inactiva y usar `NULL` siguen
permitidos.

**Demostrada.** No existe selector de creación de Actividades en la aplicación
actual, por lo que no había una lista que filtrar. No se creó un módulo nuevo ni
se filtraron lecturas históricas. Se conservaron la FK, `ON DELETE SET NULL`,
grants y RLS general; el ERROR del asesor por RLS deshabilitado continúa
preexistente y corresponde a EPT-66.

## 19. Relación con la página pública

**Demostrada.** `/niveles` permanece estática y desacoplada del catálogo
administrativo. Solo se neutralizó previamente el copy numérico engañoso; esta
corrección no cambia UI pública.

## 20. Relación con preinscripción

**Demostrada.** El E2E localiza el selector por etiqueta visible y comprueba
exactamente placeholder + INICIAL, PRIMARIO y SECUNDARIO por texto y valor. No
se admite una opción administrativa y el selector sigue estático.

## 21. Pruebas SQL

**Demostrada.** Tras reset limpio 001–007, `niveles_rls.sql` emitió
exactamente **73 OK**, cero FALLO y cero ERROR, y terminó en ROLLBACK. Cubre
RPC y tabla con vacío, espacio, tab, tab lateral, LF, whitespace combinado,
NBSP, duplicado con tabs y nombres válidos de uno y varios caracteres.

**Demostrada.** También cubre actores, Actividades activas/inactivas,
actualización histórica, NULL, estructura del trigger, FK sin cambios, ACL,
RLS, ausencia de DELETE y consulta activa exacta. La antigua comprobación 37
vacua fue reemplazada por el conjunto exacto esperado.

**Demostrada.** `cursos_rls.sql` permanece sin cambios y emitió exactamente
**39 OK**, cero fallos y cero errores.

## 22. Prueba determinista de concurrencia

**Demostrada.** `niveles_concurrencia.mjs` abre dos procesos `psql`
persistentes y coordina BEGIN, DML, consulta a `pg_blocking_pids`, COMMIT y
marcadores de salida. No usa sleeps ni probabilidad; el timeout de 30 s es solo
un fusible ante bloqueo del harness.

| Relación | Primera transacción | Segunda transacción | Resultado |
|---|---|---|---|
| Cursos | asigna y mantiene SHARE | intenta inactivar | espera; luego historia válida e inactivo |
| Cursos | inactiva y mantiene lock | intenta asignar | espera; luego P5504 y sin relación |
| Actividades | asigna y mantiene SHARE | intenta inactivar | espera; luego historia válida e inactivo |
| Actividades | inactiva y mantiene lock | intenta asignar | espera; luego P5504 y sin relación |

**Demostrada.** La salida final fue **4 OK CONCURRENCIA**, código 0.

## 23. Pruebas del servidor y navegador

**Demostrada.** HTTP Niveles: **9 passed**. Niveles con sesión real y setup:
**17 passed**. Integración Cursos con sesión real y setup: **17 passed**.
Niveles UI escritorio: **9 passed**. Responsive cross-engine: **4 passed**.

**Demostrada.** Las pruebas auth usan login/storage state real y el stack local;
no fabrican tokens. El modo destructivo se habilita solo con
`EPT_SUPABASE_LOCAL=1` y se ejecuta serialmente sobre la base compartida.

## 24. Accesibilidad

**Demostrada.** Playwright comprueba labels, región `aria-live` nombrada,
`role="alert"`, foco inicial, Tab/Shift+Tab contenido, Escape y retorno al
disparador. En WebKit el caso abre el diálogo con foco explícito + Enter, lo que
prueba teclado en lugar de asumir que un tap táctil mueve foco.

## 25. Responsive: viewport y motor

**Demostrada.** La suite de escritorio usa Chrome/Chromium. La suite nueva usa
los descriptores oficiales de Playwright:

| Proyecto | Motor | Viewport del descriptor | Casos |
|---|---|---:|---:|
| `pixel-5-chromium` | Chromium | 393 × 727 | 2 |
| `iphone-13-webkit` | WebKit | 390 × 664 | 2 |

**Demostrada.** Los cuatro casos verifican tarjetas, ausencia de overflow,
formulario, diálogo y foco. Las capturas móviles existentes a 375 px acreditan
solo ese viewport fixture; no se las presenta como evidencia de motor o
dispositivo. No se regeneraron PNG porque no cambió la UI de producción.

## 26. Auditoría de idioma

**Demostrada.** El copy visible y accesible permanece en español profesional.
La corrección cambia “espacios” por “caracteres en blanco” para describir el
contrato real. Identificadores técnicos y salidas de herramientas quedan fuera
de la regla de idioma visible.

## 27. Comandos ejecutados

```powershell
npx.cmd supabase db reset --local
npx.cmd supabase migration list --local
docker exec supabase_db_educar-para-transformar psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/niveles_rls.sql
node supabase/tests/niveles_concurrencia.mjs
docker exec supabase_db_educar-para-transformar psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/cursos_rls.sql
npx.cmd tsc --noEmit --incremental false
npx.cmd eslint --no-cache -- playwright.config.ts src/lib/validations.ts src/services/niveles.service.ts tests/niveles-auth.spec.ts tests/niveles-ui.spec.ts tests/niveles-responsive.spec.ts
npm.cmd run build
npx.cmd playwright test tests/niveles.spec.ts --project=chromium
$env:EPT_SUPABASE_LOCAL='1'; npx.cmd playwright test tests/niveles-auth.spec.ts
$env:EPT_SUPABASE_LOCAL='1'; npx.cmd playwright test tests/cursos-auth.spec.ts
npx.cmd playwright test tests/niveles-ui.spec.ts --project=chromium
npx.cmd playwright test tests/niveles-responsive.spec.ts --project=pixel-5-chromium --project=iphone-13-webkit
npm.cmd run test:e2e
$env:EPT_SUPABASE_LOCAL='1'; npm.cmd run test:e2e
npm.cmd run lint -- --no-cache
npx.cmd supabase gen types typescript --local
npx.cmd supabase db lint --local --level warning --fail-on error
npx.cmd supabase db advisors --local --type security
npx.cmd supabase db advisors --local --type performance
git diff --check
```

**Demostrada.** WebKit faltaba localmente y se instaló con el comando oficial
`npx.cmd playwright install webkit`, código 0, sin modificar dependencias.

## 28. Códigos de salida

| Comando | Código |
|---|---:|
| reset / migration list / SQL Niveles / concurrencia / SQL Cursos | 0 / 0 / 0 / 0 / 0 |
| TypeScript / ESLint focalizado / build | 0 / 0 / 0 |
| HTTP / Niveles auth / Cursos auth / UI escritorio / responsive | 0 / 0 / 0 / 0 / 0 |
| E2E completo sin DB | 1, único fallo baseline |
| E2E completo con DB | 1, único fallo baseline |
| lint completo | 1, baseline 16 errores |
| tipos / db lint / advisors seguridad-rendimiento | 0 / 0 / 0-0 |
| `git diff --check` | 0 |

## 29. Resultados exactos

| Verificación | Resultado |
|---|---|
| Migraciones | 001–007 locales/remotas |
| Niveles SQL | 73 OK; 0 FALLO; 0 ERROR |
| Concurrencia | 4/4 intercalaciones |
| Cursos SQL | 39 OK; 0 FALLO; 0 ERROR |
| HTTP Niveles | 9 passed |
| Niveles auth | 17 passed |
| Cursos auth | 17 passed |
| Niveles UI escritorio | 9 passed |
| Pixel 5 Chromium + iPhone 13 WebKit | 4 passed |
| E2E sin DB | 50 passed, 1 failed |
| E2E con DB | 81 passed, 1 failed |
| lint completo | 125: 16 errores, 109 advertencias |
| build | Next 16.2.5, 20 páginas, código 0 |
| tipos | hash sin cambios `E48E71E3963EBB3A242862DFD92294086F9D7E04553D39AB84E2C7B04F2105B8` |
| capturas | 20 PNG previos; no regenerados |

## 30. Baseline y fallos preexistentes

**Demostrada.** La base registraba E2E **28/29**, E2E con auth **44/45** y lint
**125 (16/109)**. El candidato previo a esta corrección registraba **48/49** y
**79/80**. Los dos casos responsive se ejecutan una vez en cada motor móvil, por
lo que el candidato corregido registra **50/51** sin DB y **81/82** con DB.

**Demostrada.** El único fallo en ambas suites continúa en
`tests/e2e.spec.ts:8`: esperaba `/login?redirect=/dashboard` y recibió
`/login?redirect=%2Fdashboard`. Es el mismo defecto baseline. El lint completo
conserva exactamente 125 problemas y ningún diagnóstico pertenece a los
archivos modificados por esta corrección.

## 31. Resultados de Supabase

**Demostrada.** `supabase db lint --fail-on error` informó “No schema errors
found”, código 0. El asesor de seguridad mantiene 6 hallazgos preexistentes:
2 `function_search_path_mutable`, 1 ERROR por RLS deshabilitado en
`actividades` y 3 WARN de policies INSERT permisivas. Rendimiento mantiene
13 WARN: 7 `auth_rls_initplan` y 6 `multiple_permissive_policies`.

**Demostrada.** Ningún hallazgo referencia el helper, los triggers o las
funciones agregadas por las migraciones 006/007.

## 32. Capturas indexadas

**Demostrada.** Los veinte PNG fueron inspeccionados en la entrega anterior y
no cambiaron porque esta corrección no modifica UI de producción.

| Grupo | Archivos |
|---|---|
| Fixture escritorio | `fixture-escritorio-listado.png`, `fixture-escritorio-formulario-alta.png`, `fixture-escritorio-error-duplicado.png`, `fixture-escritorio-nivel-inactivo.png`, `fixture-escritorio-edicion.png`, `fixture-escritorio-enviando.png`, `fixture-escritorio-error.png`, `fixture-escritorio-alta-exitosa.png`, `fixture-escritorio-exito.png`, `fixture-escritorio-carga.png`, `fixture-escritorio-vacio.png` |
| Fixture móvil 375 | `fixture-movil-listado.png`, `fixture-movil-formulario.png`, `fixture-movil-confirmacion-estado.png`, `fixture-movil-renombrado.png` |
| Real | `real-escritorio-listado-autenticado.png`, `real-escritorio-ciclo-completo.png`, `real-escritorio-duplicado-desde-postgresql.png`, `real-escritorio-sin-eliminacion.png`, `real-escritorio-estudiante-restringido.png` |

**Demostrada.** Los fixtures no prueban PostgreSQL/autorización y los PNG de
375 px no prueban WebKit/Chromium. Esas afirmaciones dependen de las pruebas
automatizadas de las secciones 21–25.

## 33. Privacidad y credenciales

**Demostrada.** No se versionan `.env.local`, storage state, resultados,
trazas ni secretos. Las capturas contienen identidades sintéticas. El flujo de
producción no usa `service_role`; el setup de pruebas lo usa solo contra
localhost/127.0.0.1/::1 y el helper SQL le concede EXECUTE únicamente para que
los CHECK se evalúen bajo ese rol, no acceso nuevo a tablas.

**Demostrada.** El escaneo del parche obtuvo `SECRET_PATCH_MATCHES=0` y
`ATTRIBUTION_PATCH_MATCHES=0`; los siete commits previos obtuvieron
`ATTRIBUTION_EXISTING_COMMITS_MATCHES=0`. Se buscaron credenciales de alta
confianza, firmas de coautoría y atribución automatizada.

## 34. Riesgos restantes

1. **Demostrada como preexistente.** Actividades sigue sin RLS general; la
   corrección solo incorpora la invariante de nivel activo.
2. **Demostrada como preexistente.** Persisten 6 hallazgos de seguridad, 13 de
   rendimiento, 125 problemas de lint y el redirect codificado.
3. **Parcialmente demostrada.** DOCENTE/PADRE/PERSONAL se cubren en SQL, no con
   una sesión de navegador por rol.
4. **No demostrada.** Integración a `main` y cierre Jira aún no ocurrieron.

## 35. Retrospectiva

**Demostrada.** Leer `activo` sin bloquear no era suficiente: la asignación
podía validar TRUE mientras otra transacción confirmaba FALSE. El
`SELECT ... FOR SHARE` alinea la decisión con el UPDATE de estado y conserva
historia en ambas intercalaciones.

**Demostrada.** `BTRIM(text)` sin conjunto explícito cubría solo espacio ASCII.
El helper centraliza tab, LF, VT, FF, CR, espacio, NEL, NBSP, separadores
Unicode y BOM; Zod replica el borde mediante `\s` más U+0085.

**Demostrada.** Dos defectos del harness se corrigieron durante la verificación:
`psql` representa booleanos como `true/false`, no `t/f`; y un tap táctil
de WebKit no implica foco. Ninguno requirió cambiar producción.

## 36. Reproducción

1. Iniciar Docker/Supabase y ejecutar reset local.
2. Confirmar migration list 001–007.
3. Ejecutar `niveles_rls.sql`, `niveles_concurrencia.mjs` y
   `cursos_rls.sql`; esperar 73, 4 y 39 OK.
4. Ejecutar TypeScript, ESLint focalizado y build.
5. Ejecutar HTTP, auth Niveles, Cursos auth, UI escritorio y los dos proyectos
   responsive.
6. Ejecutar suites completas sin/con `EPT_SUPABASE_LOCAL=1` y comparar
   50/51 y 81/82 con el único fallo baseline.
7. Regenerar tipos y verificar que no dejan diff.
8. Ejecutar lint/advisors, diff-check y escaneos.

## 37. Límite de reversión

**Demostrada.** Revertir de adelante hacia atrás por mensaje:

1. `test(niveles): completar pruebas de integridad y navegadores móviles` —
   configuración, pruebas responsive y evidencia corregida; se identifica por
   mensaje porque no puede auto-incrustar su propio SHA.
2. `fix(niveles): cerrar invariantes concurrentes de asignación` — migración
   007, validaciones y pruebas de integridad; se identifica por mensaje.
3. `cc9ede3caa4d1dedcb473697ecb00016df8bbcc4` — preinscripción exacta.
4. `0539150` — trazabilidad anterior de Jira.
5. `321fa13` — evidencia/capturas previas.
6. `372b5ab` — interfaz administrativa.
7. `cf8d438` — integración activa/histórica de Cursos.
8. `c39b4bb` — API, servicios y validación.
9. `7ab799a` — migración 006 y tipos.

**Demostrada.** Revertir un archivo de migración no revierte un esquema ya
aplicado. En un entorno no descartable se crea una migración posterior; nunca
se edita o elimina una migración aplicada ni se reabren privilegios.
