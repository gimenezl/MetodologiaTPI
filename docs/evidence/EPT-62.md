# EPT-62 — RF16: Administrar inscripciones

Candidato local completo. **No** integrado, **no** en producción: sin push, sin PR,
sin `db push` productivo y sin cambios en Jira. «Implementado» no equivale a
«integrado».

---

## 1. Resumen ejecutivo

Dirección puede consultar, **confirmar** y **cancelar** inscripciones de los tres
dominios de RF16, cada uno sobre su propio modelo (no existe una tabla única):

| Dominio | Modelo | Consultar | Confirmar | Cancelar |
|---|---|---|---|---|
| Académico | `public.matriculas` | sí | sí (matrícula vigente) | por el flujo vigente de Alumnos (inactivar / cambiar de curso); **no** se inventó una operación nueva |
| Deportivo | `public.inscripciones_deportivas` | sí | sí | sí, en nombre del alumno |
| Servicios (comedor y transporte) | `public.inscripciones_servicios` (`servicios_escolares.tipo`) | sí | sí | sí, en nombre del alumno |

- «Confirmar» es una acción administrativa **real y registrada** (quién y cuándo),
  distinta de «consultar», solo de Dirección, **posterior al alta**: no condiciona
  la vigencia ni el derecho de uso.
- La confirmación vive en una tabla de auditoría propia, append-only, que solo
  Dirección lee (`public.confirmaciones_inscripcion`).
- Las cancelaciones administrativas son operaciones **nuevas** y separadas. Las RPC
  de cancelación propia del alumno (013, 014) no se tocaron.
- El modelo legado `public.inscripciones` (CURRICULAR/TALLER) queda **fuera** y su
  deuda se registra en la sección 12.

---

## 2. Línea base, worktree y commits

- Base: `origin/main` = `206ed08fbc4996c9761bcf4ebc879a5a2bfe9350` (incluye EPT-60 y el
  PR #19 de EPT-61), verificado con `git fetch origin` al empezar.
- Worktree limpio propio: `E:\Escritorio\codigo\MetodologiaTPI-ept62`, rama
  `codex/ept-62-admin-inscripciones`. No se tocó el checkout principal ni los
  worktrees de otras sesiones.
- Jira vivo (`EPT-62`, verificado): Tarea «Por hacer», asignada a Lucas Gimenez, sin
  subtareas, descripción «Consultar, confirmar, cancelar y controlar la unicidad de las
  inscripciones académicas, deportivas y de servicios».
- PDF `PlanTrabajo_Grupo12_SistemaGestion (1).pdf` (RF16 en la página 2, Definition of
  Done en la 12) leído con `pypdf`.

Commits del candidato (convencionales, con pruebas junto al comportamiento):

| Commit | Contenido |
|---|---|
| `0ce798e` | migración, tipos generados y curados, servicio, cliente y rutas de Dirección, pruebas HTTP |
| `db46255` | pruebas SQL de permisos y comportamiento, y de concurrencia real |
| `1fd6ed7` | trigger que impide `TRUNCATE` del registro de confirmaciones |
| `66f1833` | interfaz de Dirección: comedor, transporte, deportes y matrículas |
| `c9ef9a4` | pruebas de interfaz y E2E con sesión real |
| `ce698aa` | RPC nuevas en la batería de permisos de EPT-59; orden de una aserción de deportes |
| `7310ca9` | evidencia y capturas |
| `3ea46e6` | paginación de los listados administrativos y ficha filtrada por alumno en el servidor, con prueba de más de 1000 filas |
| `5f89775` | cota exacta de la lectura paginada (módulo `src/lib/paginacion.ts` y sus pruebas) y conteo por tipo de servicio en la prueba de paginación |
| (evidencia) | procedencia por SHA de las pruebas (solo `docs/evidence/`) |

---

## 3. Matriz de aceptación (RF16 → dominio → estado previo → cambio → prueba)

Estado previo verificado inspeccionando 008, 009, 013, 014, 015, 016, EPT-60 y EPT-61.

| # | Criterio RF16 / decisión | Dominio | Estado previo | Cambio | Prueba |
|---|---|---|---|---|---|
| 1 | Consultar | académico | Dirección veía matrículas por alumno (008) sin confirmación | vista `matriculas_administracion` solo Dirección; sección «Confirmación de la matrícula» en la ficha | RLS H2–H4; UI `inscripciones-administracion-ui`; E2E `-e2e-auth` |
| 1 | Consultar | deportivo | lista de EPT-11/61 sin confirmación | vista `inscripciones_deportivas_administracion`; lista con filtro de confirmación en Deportes | RLS H2–H4; UI; E2E |
| 1 | Consultar | servicios | comedor: solo lectura; transporte: solo recorridos | vista `inscripciones_servicios_administracion` (tipo COMEDOR/TRANSPORTE) | RLS H2–H4; UI; E2E |
| 2 | Confirmar es real y registrada | los tres | no existía | tabla `confirmaciones_inscripcion` + `confirmar_*` | RLS B1; concurrencia 11–14; API auth |
| 3 | No condiciona la vigencia | los tres | — | ningún flujo lee la confirmación; altas sin cambios | RLS G1–G3; UI (nunca «pendiente de activación») |
| 4 | Doble confirmación idempotente | los tres | — | `ya_confirmada`; misma fila de auditoría | RLS B2–B4; concurrencia 3 (11–14); API auth |
| 4 | Cancelada/cerrada no se confirma | los tres | — | P6202 (función y trigger) | RLS C5, D1, I4; concurrencia 1, 2 |
| 4 | Marca histórica se conserva | los tres | — | append-only; FK RESTRICT | RLS E1–E5, I2, I3; concurrencia 1–10 |
| 4 | Carreras confirmar vs cancelar/cerrar | los tres | — | `FOR UPDATE` de la fila | concurrencia 1–10, 27–32 |
| 5 | Cancelación administrativa | deportivo, servicios | solo cancelación propia | `cancelar_*_administrativa` (Dirección) | RLS C2–C4, F1–F3; concurrencia 15–26; API auth |
| 5 | RPC propias no se debilitan | deportivo, servicios | exigen ESTUDIANTE + propietario | sin cambios | RLS F1–F3 (Dirección da 42501 en la RPC propia) |
| 6 | Sin alumno activo sin matrícula | académico | trigger diferido (008) | no hay cancelación de matrícula; UI explica el cierre | RLS I1, J2; UI (ayuda de cierre) |
| 7 | Modelo legado fuera | legado | — | no se toca | §12 |
| 8 | Reutilizable por EPT-63 | los tres | — | lecturas por dominio del servicio; no hay reportes | — |
| RF16 | Unicidad | deportivo, servicios | índices parciales (013/014) | sin cambios; se prueba que siguen | RLS C1, C6, J1; concurrencia 18–22 |
| DoD 3 | Regla en servidor y base | todos | — | RPC + trigger + RLS; la UI no es el único control | permisos A1–A7; API 401/403 |
| DoD 6 | Cada actor solo lo autorizado | todos | — | matriz de §7 probada por rol | RLS A1, H1–H4; E2E por rol; batería EPT-59 |
| DoD 7 | Escritorio y móvil | UI | — | tabla ≥ 1280 px, tarjetas debajo | UI en Chromium, Pixel 5, iPhone 13; capturas |

---

## 4. Decisiones aprobadas y tomadas

Aprobadas por Lucas (contrato del prompt): confirmar ≠ consultar, solo Dirección,
posterior al alta y sin condicionar vigencia; idempotencia; sin cancelación de
matrícula; sin tocar el legado; sin reportes.

Tomadas en esta implementación:

1. **Almacenamiento: tabla de auditoría propia y no columnas.** Las tres tablas de
   inscripción conceden `SELECT` al alumno dueño fila a fila: una columna
   `confirmada_por` se filtraría a cada alumno con el perfil de Dirección. Restringirla
   habría exigido privilegios por columna y reescribir vistas de 008, 013 y 014. La
   tabla nueva tiene una FK por dominio (exactamente una no nula, por `CHECK`),
   `ON DELETE RESTRICT`, índice único por inscripción y RLS de lectura solo Dirección.
2. **Un tipo de servicio como parámetro** en las operaciones de servicios
   (`p_tipo`): la ruta del comedor no opera sobre transporte (responde 404 igual que
   una inexistente). No es un parámetro de identidad ni de rol.
3. **Orden de bloqueos fila → alumno → grupo**, el mismo que la baja propia, para no
   agregar ciclos de espera (detalle en la cabecera de la migración).
4. **Trigger de protección** además de los privilegios: `UPDATE`/`DELETE` → P6204;
   `INSERT` de algo no vigente → P6202; fecha sellada por la base; `TRUNCATE` → P6204.
5. **API unificada** `POST /api/inscripciones/[dominio]/[id]/{confirmacion,cancelacion}`
   con `dominio ∈ matriculas | deportes | comedor | transporte`. Cancelar `matriculas`
   responde 400 (`MATRICULA_NO_SE_CANCELA`) con el mensaje honesto: no simula nada.
6. **Códigos SQLSTATE nuevos** `P6201`–`P6204` (sin colisión con P550x–P561x ni
   P590x–P597x).

---

## 5. Cancelación académica: cómo se satisface

RF16 pide «cancelar» inscripciones académicas y el contrato prohíbe dejar un alumno
ACTIVO sin matrícula vigente (008: «ACTIVO ⇔ exactamente una matrícula vigente»,
trigger diferido). Por eso no se creó una operación de cancelación de matrícula. El
cierre administrativo se hace con el flujo existente, que ya es atómico y conserva la
historia:

- `inactivar_alumno` cierra la matrícula con `motivo_cierre = 'INACTIVACION'`.
- `cambiar_curso_alumno` la cierra con `'CAMBIO_DE_CURSO'` y abre otra.

La ficha de Dirección lo dice sin rodeos («Una matrícula no se cancela desde acá…») y
enlaza al listado de Alumnos. La matrícula cerrada conserva su marca de confirmación
(RLS E4/E5, concurrencia 7–10). **No se encontró una contradicción real** con un
criterio vigente; ninguna decisión quedó detenida.

---

## 6. Modelo de datos y operaciones

- `public.dominio_inscripcion` (`MATRICULA`, `DEPORTE`, `SERVICIO`).
- `public.confirmaciones_inscripcion`: `id`, `dominio`, tres FK excluyentes,
  `confirmada_por` (perfil de Dirección), `confirmada_en` (sellado por la base).
- RPC públicas (envoltorios `SECURITY INVOKER` sobre `app_private`, `search_path`
  vacío, solo `authenticated`): `confirmar_matricula(uuid)`,
  `confirmar_inscripcion_deportiva(uuid)`, `confirmar_inscripcion_servicio(uuid, tipo)`,
  `cancelar_inscripcion_deportiva_administrativa(uuid)`,
  `cancelar_inscripcion_servicio_administrativa(uuid, tipo)`.
- Vistas `security_invoker` solo Dirección: `matriculas_administracion`,
  `inscripciones_deportivas_administracion`, `inscripciones_servicios_administracion`.
- SQLSTATE: `P5505` sin identidad, `42501` no Dirección, `P6201` inexistente o de otro
  tipo, `P6202` cancelada/cerrada, `P6203` ya cancelada, `P6204` registro protegido.

Traducción en la API: 401, 403 (`ACCESO_BLOQUEADO` si la cuenta está bloqueada), 400
(UUID o dominio inválido; cancelar matrículas), 404 (inexistente o de otro dominio, mismo
cuerpo), 409 (`INSCRIPCION_NO_VIGENTE`, `INSCRIPCION_YA_CANCELADA`, `REGISTRO_PROTEGIDO`,
`CONFLICTO_CONCURRENCIA`), 500 genérico. Nunca se devuelve SQL, SQLSTATE, nombres de
tablas ni datos personales.

---

## 7. Modelo de permisos

| Actor | Consultar administración | Confirmar | Cancelar en nombre del alumno | Ve confirmaciones |
|---|---|---|---|---|
| DIRECTOR habilitado | sí | sí | sí (servicios y deportes) | sí |
| DIRECTOR bloqueado (EPT-59) | 0 filas | 42501 / 403 `ACCESO_BLOQUEADO` | 42501 / 403 | no |
| ESTUDIANTE | 0 filas en las vistas de administración; sus vistas `*_detalle` sin confirmación | 42501 / 403 | 42501 / 403 (su RPC propia sigue igual) | no |
| PADRE, DOCENTE, PERSONAL | 0 filas | 42501 / 403 | 42501 / 403 | no |
| Sin perfil | 0 filas | 42501 / 403 | 42501 / 403 | no |
| anon | sin `EXECUTE` ni `SELECT` | denegado | denegado | no |

Acceso directo a tablas: ningún rol de aplicación tiene `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, `REFERENCES` ni `TRIGGER` sobre `confirmaciones_inscripcion`, `matriculas`,
`inscripciones_deportivas` ni `inscripciones_servicios` (verificado con
`has_table_privilege` y con intentos reales). RLS activo; una sola política permisiva
(`SELECT` para Dirección) y la política `RESTRICTIVE` de bloqueo de cuenta de EPT-59.
`service_role` no se usa en `src/`; en las pruebas solo siembra identidades locales.

---

## 8. Pruebas y resultados

**Cada resultado indica sobre qué SHA se ejecutó.** No se atribuye al HEAD final ninguna
prueba que no se repitió allí. Hubo cuatro rondas:

| Ronda | SHA sobre el que corrió | Alcance |
|---|---|---|
| A | `c9ef9a4` | verificación completa inicial (base, código, aplicación, E2E entera) |
| B | `ce698aa` | repeticiones tras corregir los fallos de la ronda A (batería de permisos, lint, E2E entera, capturas) |
| C | `3ea46e6` | **solo suites focalizadas** tras agregar la paginación; **no** hubo E2E completa |
| D | `5f89775` | verificación sobre el código final: `tsc`, ESLint, lint, `build`, prueba de la cota y **E2E entera** |

`5f89775` es el último commit que cambia código o pruebas. Los commits posteriores solo
tocan `docs/evidence/`. La base de datos y sus suites SQL y de concurrencia no cambian
desde `ce698aa` (`git diff ce698aa HEAD -- supabase` vacío), y por eso se detallan con la
ronda que efectivamente las ejecutó.

### Base de datos (rondas A y B; sin cambios de base desde `ce698aa`)

| Comando | Exit | SHA | Resultado |
|---|---|---|---|
| `npx supabase db reset --local` | 0 | `c9ef9a4` | cadena completa (23 migraciones) con la autoverificación de la migración; el archivo de la migración no cambió después de `1fd6ed7` |
| `npx supabase migration list --local` | 0 | `c9ef9a4` | 23 migraciones, la de EPT-62 posterior a `20260928155706` |
| `npx supabase db lint --local` | 0 | `c9ef9a4` | sin errores |
| `npx supabase db advisors --local --type security` / `--type performance` | 0 / 0 | `c9ef9a4` | seguridad: 2 `function_search_path_mutable` y 2 `rls_policy_always_true`; rendimiento: 1 `auth_rls_initplan` y 5 `multiple_permissive_policies`. **Ninguno recae sobre objetos de EPT-62** (se filtró por nombre y metadatos); son de objetos anteriores y no se tocaron |
| `node supabase/tests/tipos-generados.mjs` | 0 | `c9ef9a4` | `database.generated.ts` coincide byte a byte con el generador |
| SQL: `inscripciones_administracion_rls.sql` | 0 | `c9ef9a4` | 41 comprobaciones OK (incluye TRUNCATE del registro) |
| SQL: alumnos_academicos, comedor, cursos, deportes, deportes_administracion, horarios, horarios_academicos, inscripcion_hijos, materias, niveles, perfiles_privacidad, preflight_ept59, profesores, reconciliacion_esquema_remoto, transporte, usuarios_alta_atomica (esta como `supabase_admin`) | 0 | `c9ef9a4` | todas |
| SQL: `usuarios_permisos_rls.sql` (`supabase_admin`) | 3 | `c9ef9a4` | falló: «06 RPC sin cubrir en la batería» (exige listar toda RPC pública nueva) |
| SQL: `usuarios_permisos_rls.sql` (`supabase_admin`), tras agregar las cinco RPC | 0 | `ce698aa` | corrección verificada |
| Concurrencia (32 carreras): `inscripciones_administracion_concurrencia.mjs` | 0 | `c9ef9a4` | dos veces seguidas; base limpia y trigger habilitado |
| Concurrencia: alumnos_academicos, comedor, deportes, deportes_administracion, horarios, horarios_academicos, niveles, profesores, transporte, usuarios_permisos | 0 | `c9ef9a4` | todas |

### Código y aplicación

| Comando | Exit | SHA | Resultado |
|---|---|---|---|
| `git diff --check origin/main` | 0 | `5f89775` | sin errores de espacios (solo avisos LF/CRLF del entorno) |
| `npx tsc --noEmit --incremental false` | 0 | `5f89775` | sin errores |
| `npx eslint` focalizado (servicio, módulo de paginación, ficha, specs nuevas, `playwright.config.ts`) | 0 | `5f89775` | limpio |
| `npm run lint` | 1 | `5f89775` | **14 errores y 107 advertencias, idéntico a la línea base** (EPT-61: 14 y 107) y a las rondas B y C. Los 14 errores están en 8 archivos que EPT-62 no toca (`inscripcion`, `noticias`, `quienes-somos`, `asistencias`, `solicitudes`, `testimonios`, `global-error`, `login`). Falla **preexistente**, no una regresión; no se llama «verde» |
| `npm run build` (credenciales locales de `supabase status -o env`, API verificada como loopback) | 0 | `5f89775` | correcto |
| `npx playwright test tests/paginacion.spec.ts --project=chromium` | 0 | `5f89775` | 12 aprobadas (borde de la cota y contrato de la lectura paginada) |
| `node supabase/tests/correr-autenticadas.mjs` (toda la E2E: sesión real + bancos, tres perfiles) | 0 | `5f89775` | **1155 aprobadas, 4 omitidas** (18,4 min): **única E2E entera que corresponde al código final** |

Ejecuciones anteriores (no se repitieron con esos números en el HEAD final):

| Comando | Exit | SHA | Resultado |
|---|---|---|---|
| E2E entera, primera corrida | 1 | `c9ef9a4` | 1133 aprobadas, 4 omitidas y 3 fallidas (`deportes-ui.spec.ts:152`, tres perfiles) |
| E2E entera, tras corregir esa aserción | 0 | `ce698aa` | 1136 aprobadas, 4 omitidas (19,9 min); en la misma ronda se regeneraron las capturas |
| Suites focalizadas tras la paginación: autenticadas de inscripciones (107), de comedor, transporte, deportes, alumnos y administración de deportes (172), y UI sin sesión (335 + 4 omitidas) | 0 | `3ea46e6` | **no fue una E2E completa** |
| `inscripciones-administracion-paginacion-auth.spec.ts` (28), dos corridas | 0 | `5f89775` (árbol idéntico al commit) | además de la E2E entera de la ronda D |

Historial honesto de fallos durante la verificación:

1. `usuarios_permisos_rls.sql` (exit 3, `c9ef9a4`): cobertura de RPC de EPT-59 → corregido y
   verificado en `ce698aa`.
2. `deportes-ui.spec.ts:152`, tres perfiles (`c9ef9a4`): la aserción del botón «Confirmar»
   se ejecutaba después de filtrar por «Todas» y buscar «atletismo», donde la fila es una
   baja y no ofrece acciones. Se movió antes del filtro; E2E entera en 0 en `ce698aa`.
3. `tests/auth.setup.ts` borraba matrículas e inscripciones sin tocar las confirmaciones:
   con las FK `RESTRICT` habría fallado tras la primera confirmación. Se limpia antes,
   deshabilitando el trigger de protección solo en esa transacción de pruebas.

Omisiones: 4 pruebas omitidas en la E2E entera, por condición explícita en el propio test
(p. ej. interacción de teclado que no aplica al perfil táctil de WebKit); no se midió
cuántas ya existían antes de esta historia, así que no se afirma que sean idénticas a la
línea base.

Las capturas (§11) se generaron en la ronda B (`ce698aa`) y no se regeneraron después: la
paginación no cambia el marcado de las pantallas.

### Casos permitidos y denegados (resumen)

Permitido: Dirección habilitada confirma (200, `ya_confirmada=false`), repite (200,
`ya_confirmada=true`, misma fecha y confirmador), cancela servicios y deportes (200),
confirma la matrícula vigente.
Denegado: anon, estudiante, padre, docente, personal, sin perfil y Dirección bloqueada
→ 403 en la API y `42501` en las cinco funciones; 401 sin sesión; 404 inexistente o de
otro dominio; 409 cancelada/cerrada, ya cancelada; 400 identificador o dominio inválido y
cancelar matrículas. Ninguna respuesta contiene SQL, SQLSTATE, `app_private`, nombres de
tablas, correos, DNI ni legajos (verificado en cada respuesta).

---

## 8bis. Corrección: los listados administrativos no pierden filas (paginación)

**Defecto.** PostgREST recorta cada respuesta a `max_rows = 1000` (`supabase/config.toml`)
sin devolver error. Los tres listados administrativos (`matriculas_administracion`,
`inscripciones_deportivas_administracion`, `inscripciones_servicios_administracion`)
perdían en silencio las filas posteriores a la 1000, y la ficha del alumno descargaba
el listado global de matrículas para filtrarlo después, así que un alumno cuyas
matrículas quedaran fuera de la primera página aparecía sin ellas.

**Corrección** (`src/services/inscripciones-administracion.service.ts`,
`src/app/dashboard/alumnos/[id]/page.tsx`); el contrato aprobado, la API y la base no
cambian:

- `leerTodasLasFilas` recorre las páginas con `.range()` y un orden **total y estable**
  (`fecha` descendente e `id` ascendente como desempate único). No supone que el servidor
  devuelva exactamente 1000 filas: el siguiente pedido arranca donde terminó el anterior y
  la lectura termina con una página vacía. Descarta repetidos por identificador. Ante un
  error de cualquier página devuelve el error (nunca un listado parcial).
- **Cota exacta** (corregida en `5f89775`; el módulo vive en `src/lib/paginacion.ts`): se
  aceptan hasta 500 páginas **con datos** (500 000 filas con páginas de 1000) y se hace un
  pedido más que comprueba que no queda ninguna. Con exactamente 500 páginas llenas la
  lectura es válida; con una sola fila más falla con `ERROR_LIMITE_DE_PAGINAS` en lugar de
  recortar. La primera versión (`3ea46e6`) devolvía error con 500 páginas llenas sin
  comprobar si había otra fila; ese borde estaba mal.
- `listarMatriculasAdministracion(alumnoId?)` aplica `alumno_id = …` **en PostgreSQL**
  antes de paginar. La ficha llama `listarMatriculasAdministracion(id)`; ya no filtra en
  memoria.

**Prueba de la cota** `tests/paginacion.spec.ts` (12 pruebas, sin navegador ni base): rangos
contiguos, servidor con tope menor que la página, repetidos, error a mitad de lectura, y el
borde con valores reducidos y con los reales (500 000 filas se leen completas; 500 001
fallan). Con el borde anterior (`<` en lugar de `<=`) fallan 4 de esas pruebas.

**Prueba nueva** `tests/inscripciones-administracion-paginacion-auth.spec.ts` (sesión real
de Dirección, base local; enrutada en `playwright.config.ts`). Siembra con las reglas de
la aplicación (altas y bajas lógicas con sus triggers) 1100 ciclos cancelados en comedor,
en transporte y en deportes, más 1100 matrículas cerradas recientes de un alumno de
relleno y **una** matrícula de 2001 de un alumno objetivo, que en el orden global queda
después de la fila 1000 (se comprueba con `row_number()`). Verifica:

1. el fixture supera 1000 filas en cada dominio;
2. comedor, transporte y deportes muestran **todas** las filas con el filtro «Todas». La
   pantalla de comedor o de transporte lista todas las inscripciones de **todos** los
   servicios de ese tipo, así que la base se cuenta con el mismo conjunto
   (`inscripciones_servicios` unida a `servicios_escolares` por `tipo`), no por un solo
   `servicio_id` (`5f89775` corrige la primera versión, que contaba un único servicio). El
   fixture usa **dos servicios por tipo** (`COMEDOR` y un segundo servicio `COMEDOR-PAG62`
   propio de la suite; TR-NORTE y TR-SUR) y comprueba que el total por tipo es mayor que el
   de un solo `servicio_id`;
3. la ficha del alumno objetivo encuentra su matrícula vigente y la de 2001;
4. la ficha del alumno de relleno muestra sus 1101 matrículas;
5. de forma estática: la ficha llama `listarMatriculasAdministracion(id)` sin filtrar en
   memoria y el servicio filtra con `.eq('alumno_id', …)` y `.range(…)`.

Limpieza completa al terminar (`afterAll`): la suite es re-ejecutable.

**Prueba de que la prueba discrimina.** Con el servicio y la ficha anteriores (restaurados
con `git stash`, ya devueltos) los tres listados fallan con `Expected: 1100`,
`Received: 1000`, y la ficha del alumno objetivo con `Expected: 2`, `Received: 1`. Con la
corrección pasan las 28 pruebas, dos corridas seguidas.

Verificaciones de la ronda C, ejecutadas sobre `3ea46e6` (**suites focalizadas, no una E2E
completa**; la E2E entera del código final está en la ronda D de §8):

| Comando | Exit | Resultado |
|---|---|---|
| `npx tsc --noEmit --incremental false` | 0 | sin errores |
| `npx eslint` (servicio, ficha, spec nueva, `playwright.config.ts`) | 0 | limpio |
| `git diff --check` | 0 | sin errores |
| `node supabase/tests/correr-autenticadas.mjs` sobre `inscripciones-administracion-auth`, `-e2e-auth` y `-paginacion-auth` | 0 | 107 aprobadas |
| ídem sobre `comedor-auth`, `transporte-auth`, `deportes-auth`, `alumnos-auth`, `administracion-deportes-auth` | 0 | 172 aprobadas |
| `npx playwright test` sobre `inscripciones-administracion`, `-ui`, `comedor-ui`, `transporte-ui`, `deportes-ui`, `alumnos-ui` (tres perfiles) | 0 | 335 aprobadas, 4 omitidas |
| `npm run lint` | 1 | 14 errores y 107 advertencias, **idéntico a la línea base** y a la corrida anterior; los errores siguen en los 8 archivos ajenos ya listados |

Las cotas y el conteo por tipo se verificaron después, en `5f89775` (ronda D de §8). No se regeneraron capturas en esta corrección (sin `EPT_CAPTURAS=1`) y no hubo cambios
en la base ni en la migración, por lo que no se repitieron el `db reset`, las suites SQL
ni la concurrencia, que no dependen del código modificado.

---

## 9. Concurrencia real (dos conexiones `psql`)

`supabase/tests/inscripciones_administracion_concurrencia.mjs`, coordinada con
`pg_blocking_pids` (sin esperas por tiempo). 32 carreras, sin `40P01` y sin estado parcial:

- confirmar vs cancelar administrativamente en ambos órdenes, para deporte, comedor y
  transporte (1–6): gana confirmar → queda cancelada **con** marca; gana cancelar →
  `P6202` y ninguna fila de confirmación;
- confirmar vs cierre de matrícula (inactivación y cambio de curso), ambos órdenes (7–10);
- doble confirmación (11–14): dos éxitos, **una** fila de auditoría, segunda con
  `ya_confirmada=true`, mismo confirmador y fecha (con dos directoras distintas);
- doble cancelación (15–17): un éxito y un `P6203`, una sola `fecha_cancelacion`;
- cancelar frente a alta nueva (18–22): la reinscripción a otro grupo del mismo deporte
  espera el bloqueo del alumno y tiene éxito cuando la baja confirma (queda exactamente
  una activa); cambio de recorrido de transporte vs baja: sin dos recorridos activos;
- cancelación administrativa vs cancelación propia (23–26): una gana y la otra recibe
  `P6203` / `P5555` / `P5579`;
- confirmar vs cancelación propia (27–32).

Además hay una prueba HTTP de dos confirmaciones simultáneas por la API real.

---

## 10. Interfaz

Se ampliaron las pantallas administrativas existentes, sin una quinta superficie:
Comedor, Transporte y Deportes (vista de Dirección) y la ficha de Alumnos (matrícula).
Componentes compartidos en `src/components/inscripciones/`.

- Estado de la inscripción y estado de confirmación son dos datos separados. «Sin
  confirmar» es una etiqueta neutra; nunca «pendiente de activación».
- «Confirmar» solo para lo vigente y sin confirmar; una confirmada no lo vuelve a ofrecer;
  una cancelada o cerrada explica por qué no se confirma.
- «Cancelar inscripción» con diálogo que nombra al alumno, el servicio o grupo y la
  consecuencia; foco inicial en «Volver sin cancelar»; si falla, el diálogo sigue abierto.
- Avisos `aria-live` en español para éxito, «ya estaba confirmada», 401 (enlace para
  iniciar sesión), 403 (cuenta bloqueada), 404, 409, red y 500.
- Tabla desde 1280 px y tarjetas debajo; botones táctiles ≥ 44 px; contraste AA;
  navegación por teclado; sin desbordes horizontales; todo en español.
- Alumno, padre, docente y personal **no** ven la columna de confirmación ni el
  confirmador (verificado por E2E con cada rol).

Tests existentes modificados, sin debilitarlos: `comedor-ui` (la aserción «solo lectura»
pasó a verificar que Confirmar y Cancelar existen y que no hay eliminar ni inscribir),
`deportes-auth` (la fila pasó de tarjeta a tabla y la aserción «sin cancelar» se
reemplazó por la de los botones administrativos), `deportes-ui` (título y aserción).

---

## 11. Capturas

103 imágenes reales en `docs/evidence/EPT-62/capturas/`, regeneradas sobre el candidato
final con `EPT_CAPTURAS=1` **solo** en las dos specs propias (sesión real `e2e-*` y banco
determinista `ui-*`), en escritorio y móvil: listados de comedor, transporte y deportes;
matrícula sin confirmar y confirmada con la ayuda de cierre; diálogo de cancelación
(escritorio y móvil); cancelada con la confirmación conservada; estados vacío, cargando,
error de lectura, conflicto, sesión vencida y cuenta bloqueada; y las pantallas
restringidas de docente, padre y personal. Ejemplos: `e2e-escritorio-comedor-confirmada-y-no-confirmada.png`,
`e2e-movil-dialogo-cancelacion.png`, `e2e-escritorio-matricula-confirmada.png`.

La E2E completa regenera cinco o seis PNG de `docs/evidence/EPT-13/` aun sin
`EPT_CAPTURAS=1`; se restauraron con `git checkout` y el diff solo contiene archivos de
EPT-62. Los nombres, DNI y legajos de las capturas son sintéticos del arnés de pruebas.

---

## 12. Deuda separada: modelo legado `public.inscripciones` (fuera de EPT-62)

**No se modificó ni se reparó.** No se afirma que conserve historial: hoy tiene un camino
de borrado físico. EPT-62 **no** lo cierra ni lo cubre.

| Dónde | Hecho verificado |
|---|---|
| `supabase/migrations/011_reconciliacion_esquema_remoto.sql:402` | `GRANT SELECT, INSERT, UPDATE, DELETE ON public.inscripciones TO authenticated` |
| `011…:417,425,433` | políticas «Staff elimina inscripciones», «Alumno elimina su propia inscripcion» y «Padre da de baja a sus hijos» permiten `DELETE` |
| `src/services/actividades.service.ts:73,90` | `supabase.from('inscripciones').delete()` (baja física de talleres) |
| `src/app/dashboard/cupos/_components/VistaGestionCupos.tsx` | consulta directa a la tabla |
| `014_inscripcion_deportes.sql` (`bloquear_inscripcion_deportiva_legada`) | solo bloquea filas de actividad DEPORTE; CURRICULAR/TALLER siguen borrables |

Riesgo: la baja de un taller destruye el registro (sin ciclo cancelado) y RF16 no puede
auditarla ni controlar su unicidad con historial. Trabajo pendiente sugerido y separado:
migrar el modelo a baja lógica (estado + fecha de cancelación), retirar el `DELETE` y
sus políticas, adaptar `actividades.service.ts` y la vista de cupos, con las mismas
pruebas de permisos y concurrencia de esta historia.

---

## 13. Privacidad y seguridad

- La confirmación y su autor no se exponen a alumnos, padres, docentes ni personal (RLS
  solo Dirección, vistas con `es_director_actual()`, 0 filas para el resto).
- Funciones `SECURITY DEFINER` con `search_path = ''`; `EXECUTE` solo para
  `authenticated`; los auxiliares no son ejecutables por ningún rol de aplicación.
- El servidor autentica con `auth.getUser()`, exige Dirección, ignora el cuerpo y valida
  con esquemas estrictos; no usa `service_role` ni `user_metadata`.
- Sin filtración de SQL ni datos personales en respuestas ni en logs (el log del error
  interno solo lleva operación, dominio y SQLSTATE).
- Escaneo de secretos y de atribución de IA sobre el diff y esta evidencia: ver
  sección 15.

---

## 14. Riesgos, límites y reversión

**Riesgos y límites conocidos**

1. **No queda registro de quién canceló** en nombre del alumno: el contrato aprobado exige
   registrar la confirmación, no la cancelación. Si se quiere auditar, requiere otra tabla
   append-only equivalente. Decisión pendiente de Lucas.
2. Confirmar no exige alumno ACTIVO: una inscripción vigente de un alumno luego inactivado
   se puede confirmar; inactivar al alumno no cancela sus inscripciones deportivas ni de
   servicios (comportamiento previo, no cambiado).
3. **Resuelto en la corrección de paginación (§8bis).** Las tres lecturas administrativas
   se recortaban en silencio al `max_rows = 1000` de la API; ahora recorren todas las
   páginas. Límite residual: la paginación es por desplazamiento; una alta o baja
   concurrente durante la lectura puede mover una fila entre páginas (las repetidas se
   descartan por identificador; una fila omitida aparecería en la lectura siguiente).
   Para volúmenes muy superiores (cota de 500 páginas = 500 000 filas) convendría
   paginar por clave o filtrar también en las pantallas de comedor, transporte y deportes.
4. El propietario de la base puede desactivar los triggers de protección: es un privilegio
   de administración, no de la aplicación.
5. Mensajes de error del servicio de matrículas por API dicen «inscripción» donde
   correspondería «matrícula» (solo visibles al forzar un rechazo por API).

**Reversión no destructiva** (cabecera de la migración): soltar las diez funciones y las
tres vistas; **conservar** la tabla y el tipo, porque soltarlos destruiría el registro de
quién confirmó. Las bajas administrativas ya aplicadas son cancelaciones lógicas
ordinarias y no se revierten. La migración no modifica filas ni triggers existentes: lo
comprueba su autoverificación (conteos y huellas md5).

**Límite de reversión:** una vez en producción y con confirmaciones registradas, un
`DROP TABLE` perdería auditoría; el camino soportado es dejar las funciones sin uso.

---

## 15. Escaneo de secretos y atribución

Se buscaron claves, tokens, contraseñas y atribución de IA en el diff contra
`origin/main` y en esta evidencia. Los únicos valores «de acceso» presentes son las
identidades sintéticas del arnés local ya existente (`tests/auth.setup.ts`); no se
agregaron credenciales nuevas ni se imprimieron claves de Supabase. No hay `Co-Authored-By`
ni menciones de IA en commits ni documentos.

---

## 16. Retrospectiva

- Lo que funcionó: decidir el almacenamiento por privacidad antes de escribir, y
  serializar por la fila de la inscripción con el mismo orden de bloqueos que la baja
  propia; la concurrencia real lo confirmó en 32 escenarios.
- Lo que costó: los tests compartidos que enumeran objetos (batería de EPT-59) y el
  saneamiento del arnés de pruebas ante FK `RESTRICT`; conviene que la próxima historia
  con tablas append-only revise `auth.setup.ts` desde el principio.
- Deuda visible: legado `public.inscripciones` (sección 12) y auditoría de bajas
  administrativas (riesgo 1).

---

## 17. Texto de trazabilidad para Jira EPT-62 (preparado, NO publicado)

> **RF16 — Administrar inscripciones: candidato local completo (sin integrar).**
> Rama `codex/ept-62-admin-inscripciones`, base `origin/main` 206ed08. Dirección consulta,
> confirma y cancela (servicios y deportes) inscripciones en tres modelos separados
> (matrículas, deportes, servicios comedor/transporte). La confirmación es una acción
> registrada (quién y cuándo) en una tabla append-only solo legible por Dirección; no
> condiciona la vigencia y es idempotente. La cancelación académica se realiza con el flujo
> vigente de inactivación/cambio de curso, sin inventar una operación nueva.
> Migración `20260928193259_ept_62_administracion_inscripciones.sql`, 5 RPC, 3 vistas,
> API `/api/inscripciones/[dominio]/[id]/{confirmacion,cancelacion}` y pantallas de
> Comedor, Transporte, Deportes y Alumnos.
> Verificación local (cada una indica el SHA sobre el que corrió; el último commit de código
> es `5f89775`): sobre `c9ef9a4` y `ce698aa` — `db reset` 0, SQL (41 comprobaciones propias +
> todas las suites; la batería de permisos de EPT-59 se corrigió y pasó en `ce698aa`) 0, 32
> carreras de concurrencia 0, sin cambios de base desde `ce698aa`; sobre `3ea46e6` — solo
> suites focalizadas tras agregar la paginación (no fue una E2E completa); sobre `5f89775` —
> `tsc` 0, `build` 0, prueba de la cota 12/12 y **E2E entera 1155 aprobadas / 4 omitidas**.
> Los listados administrativos se paginan sin perder filas (prueba con más de 1000 filas por
> dominio, incluidos dos servicios por tipo). `npm run lint` sale 1 por 14 errores
> preexistentes en archivos no tocados (idéntico a la línea base). Evidencia:
> `docs/evidence/EPT-62.md`.
> Pendiente: revisión por el otro integrante, integración y aplicación de la migración en
> producción (no realizadas). Deuda separada: modelo legado `public.inscripciones` con
> `DELETE` físico (no incluido en EPT-62).

---

## 18. Texto para el Pull Request (preparado, NO abierto)

**Título:** `feat(inscripciones): administrar inscripciones — confirmar, cancelar y consultar (EPT-62)`

**Descripción:**

Implementa RF16 de punta a punta sobre los tres modelos de inscripción, sin unificarlos.

- Migración `20260928193259_ept_62_administracion_inscripciones.sql`: registro append-only
  de confirmaciones (solo Dirección lo lee), 5 RPC administrativas, 3 vistas de lectura,
  trigger de protección (incluye `TRUNCATE`) y autoverificación. No modifica filas ni
  triggers existentes.
- API `POST /api/inscripciones/[dominio]/[id]/{confirmacion,cancelacion}` con
  autenticación por `auth.getUser()`, rol Dirección y errores estables en español.
- Interfaz de Dirección en Comedor, Transporte, Deportes y ficha de Alumnos.
- Pruebas: SQL de permisos y comportamiento, 32 carreras con dos conexiones, HTTP,
  interfaz en tres perfiles y E2E con sesión real por rol.

**Fuera de alcance:** EPT-63 (reportes); modelo legado `public.inscripciones` (deuda con
`DELETE` físico documentada en la evidencia).

**Riesgos:** ver §14 de la evidencia (sin registro de quién cancela; paginación por desplazamiento).
**Corrección incluida:** los listados administrativos se paginan para no perder filas por el `max_rows` de la API, y la ficha del alumno filtra por `alumno_id` en el servidor (§8bis).
**Reversión:** soltar funciones y vistas; conservar la tabla de auditoría.
**Antes de mergear:** revisión del otro integrante; aplicar la migración con el flujo de
producción acordado (no incluido acá).
