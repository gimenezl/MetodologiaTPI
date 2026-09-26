# EPT-58 — RF8 Administrar profesores: evidencia de implementación

**Estado:** etapa 1 (migración A) implementada y verificada **solo en la base
local descartable**. EPT-58 sigue **En curso**. No hubo push, PR, merge,
despliegue ni `db push`. Las etapas 2 (aplicación) y 3 (migración B) no
empezaron: dependen de que A esté integrada, aplicada y verificada en
producción con autorización del usuario.

> **Etapa 2:** la aplicación se documenta aparte, en
> [`EPT-58/ETAPA-2.md`](EPT-58/ETAPA-2.md). Este documento queda como
> evidencia de la etapa 1.

> **Etapa 3:** el candidato local de privacidad de perfiles se documenta en
> [`EPT-58/ETAPA-3.md`](EPT-58/ETAPA-3.md). El estado histórico de la etapa 1
> registrado abajo no se reescribe.

## 1. Resumen

- **Qué agrega A:** la ficha 1:1 `profesores` de cada perfil DOCENTE
  (especialidad y estado), el historial de estados de solo agregado, el
  backfill de los DOCENTE existentes, el alta automática de la ficha, las
  guardas que impiden que un docente INACTIVO quede a cargo de una asignación o
  un grupo, las lecturas y escrituras privilegiadas en `app_private` con
  envoltorios `SECURITY INVOKER` en `public`, y la consulta mínima de
  estudiantes que usará la etapa 2.
- **Qué NO cambia A:** la política «Directores y docentes ven todos los
  perfiles» (005). La aplicación publicada se comporta igual antes y después
  de A; lo demuestran las 598 pruebas E2E sobre A (sección 11).
- **Resultado local:** 22 suites SQL y de concurrencia con código 0 sobre un
  reset limpio con A (20 existentes, 4 de ellas con la limpieza adaptada, y 2
  nuevas), más los arneses de actualización, API y reversión; TypeScript, lint de archivos tocados y
  build con código 0; asesores y `db lint` sin hallazgos nuevos.

## 2. Alcance exacto

| Dentro de EPT-58 (esta etapa) | Fuera (otra etapa u otra tarea) |
|---|---|
| Migración A `20260925165924_ept_58_profesores.sql` | Pantallas `/dashboard/profesores` y `/dashboard/mis-asignaciones` (etapa 2) |
| Pruebas SQL/RLS, concurrencia, actualización, API y reversión de A | Asistencias y Cupos sobre la consulta mínima (etapa 2) |
| Tipos generados reconciliados | Migración B: cierre de la lectura global de perfiles (etapa 3) |
| Adaptación de limpiezas de arneses a la FK RESTRICT | Bloqueo de cuenta y transición de rol (EPT-59) |
| Borrador y prueba de la compensación R-A | Cierre de permisos preexistentes de asistencias/inscripciones (EPT-66) |

## 3. Estado Jira

| Momento | Hecho |
|---|---|
| 25/09/2026 13:40 ART | EPT-58 «Por hacer», asignada a Lucas Gimenez, sin subtareas, padre EPT-3 «Legajos y usuarios». EPT-56 y EPT-57 en «Listo». |
| 25/09/2026 13:53 ART | Descripción ampliada con el **anexo aprobado** (contrato, CA-01 a CA-21, plan A → aplicación → B y condición de reversión). El texto original se conservó arriba del anexo. |
| 25/09/2026 13:54 ART | Transición a «En curso» y comentario de inicio (10235). |

EPT-59 a EPT-63 no son hijas de EPT-58 y no se modificaron. EPT-58 no pasa a
«Listo» hasta verificar B y los recorridos en producción, con autorización
expresa.

## 4. Línea base y aislamiento

| Elemento | Valor |
|---|---|
| Base remota | `origin/main` = `e27717c0fe66d1193e2f337cc99c19f4188472c3` (merge de EPT-57), verificado con `git fetch` |
| Worktree | `E:/Escritorio/codigo/MetodologiaTPI-ept58`, rama `codex/ept-58-admin-profesores`, creado desde `e27717c` |
| Checkout principal | `main` local 107 commits atrás y con cambios sin versionar (`.atl/`, `.claude/`, `AGENTS.md`, `docs/`): no se tocó |
| Base de datos | Stack local `supabase_*_educar-para-transformar` (PostgreSQL 17), Docker 29.7.2 |
| Credenciales | Inyectadas en el proceso desde `supabase status -o env`, con verificación de host de bucle local. No existe `.env.local` en el worktree |
| Supabase CLI | 2.118.0 por `npx` para operar; 2.117.0 fijado para generar tipos (sección 12) |
| Migraciones remotas | No verificables desde esta sesión: el proyecto de producción no está en la cuenta del conector de Supabase. Se toma como dato del usuario que EPT-57 está aplicada; hay que comprobar el historial remoto antes del `db push` (sección 14) |

## 5. Contrato aprobado y decisiones de implementación

El contrato completo es el anexo de la descripción de EPT-58 en Jira. Estas
son las decisiones de implementación que el contrato no fija literalmente y
cómo se resolvieron, sin agregar reglas de producto:

| # | Decisión | Motivo |
|---|---|---|
| D1 | La ficha se crea en el **alta** del perfil DOCENTE (trigger `AFTER INSERT`), igual que 008 con los estudiantes. Un cambio de rol hacia DOCENTE no crea ficha. | El contrato habla de «dar de alta un DOCENTE» y la transición de rol pertenece a EPT-59, que deberá crear la ficha en esa transición. |
| D2 | «Asignación activa» es el estado de la propia relación: `materias_cursos.activo` o `grupos_deportivos.activo`, aunque la materia, el curso o el deporte estén inactivos por su lado. | Es la entidad que el contrato nombra. Bloquea de más antes que dejar un docente INACTIVO a cargo; el rechazo informa cuál relación reasignar o inactivar. |
| D3 | El historial de estados lo consulta solo la Dirección. El docente ve su estado vigente en la ficha. | Motivo y actor son información administrativa; el contrato solo exige ficha y asignaciones para el docente. |
| D4 | Motivo opcional: se recortan los extremos, vacío = NULL, máximo 500 caracteres. | Límite técnico para un texto libre; no restringe el contenido. |
| D5 | Especialidad: cada tramo de espacios en blanco se reemplaza por un espacio y se recortan los extremos; el conjunto es exactamente el de `nombre_materia_valido` (012). U+200B no es espacio. | Equivalencia verificable entre cliente, servidor y PostgreSQL. `\s` de JavaScript no incluye U+0085: la etapa 2 debe usar la misma clase explícita. |
| D6 | `service_role` no tiene ningún privilegio sobre las tablas nuevas. | El contrato prohíbe usar la clave de servicio en operaciones normales de EPT-58, y así el historial es de solo agregado para todos los roles de aplicación. |
| D7 | El historial rechaza UPDATE, DELETE y TRUNCATE también para el propietario (trigger P5609). | «No permitas edición o borrado del historial» sin excepciones accidentales. Las limpiezas de pruebas locales deshabilitan la guarda dentro de su transacción. |
| D8 | Además de las RPC, `authenticated` tiene SELECT directo sobre las dos tablas, filtrado por RLS (Dirección todo; docente solo su ficha; historial solo Dirección). | Mismo patrón que `alumnos`, `matriculas` y `materias_cursos`; permite probar la frontera de RLS directamente. |
| D9 | El trigger nuevo se llama `a_exigir_profesor_activo` para dispararse antes que los de 012/014. | Orden de bloqueos ficha → perfil en todas las operaciones (sección 7). |
| D10 | Un perfil sin ficha deja la decisión a 012/014. | Conserva los códigos existentes (inexistente P5533/P5564, sin rol DOCENTE P5535/P5565). |

## 6. Matriz criterio → implementación → prueba → evidencia

| CA | Implementación | Prueba | Resultado local | Etapa |
|---|---|---|---|---|
| CA-01 Ficha 1:1 con borrado restringido | PK = FK `ON DELETE RESTRICT` | `profesores_rls.sql` §1 (23503) | OK | A |
| CA-02 Legajo en `perfiles`, sin copias ni correo | Columnas de `profesores`; RPC usa `perfiles.legajo_nro` | `profesores_rls.sql` §1; `profesores_postgrest.mjs` (ficha sin `email`) | OK | A |
| CA-03 Backfill 1:1 y alta automática | §6 y §7 de la migración | `profesores_migracion_a.mjs`; `profesores_rls.sql` §1; autoverificación de A | OK | A |
| CA-04 Ficha incompleta; guardar exige ambos | `ficha_completa` derivado; `actualizar_ficha_profesor` | `profesores_rls.sql` §6 (P5602, P5515, sin cambios parciales) | OK (base) | A + app |
| CA-05 Especialidad normalizada 2–100 | `normalizar_especialidad`, `especialidad_valida`, CHECK | `profesores_rls.sql` §3 y §6; `profesores_postgrest.mjs` (400 P5604) | OK (base); paridad con cliente pendiente | A + app |
| CA-06 Inactivar bloqueado por asignaciones | `cambiar_estado_profesor` (P5610 + DETAIL JSON) | `profesores_rls.sql` §7; `profesores_concurrencia.mjs` 1 y 5 | OK (base) | A + app |
| CA-07 Docente INACTIVO nunca a cargo | Trigger `a_exigir_profesor_activo` (P5605) | `profesores_rls.sql` §7 (RPC y SQL directo); concurrencia 2, 4 y 6 | OK | A |
| CA-08 Reactivar exige ficha completa y rol | `cambiar_estado_profesor` (P5611, P5612) | `profesores_rls.sql` §7 | OK (base) | A + app |
| CA-09 Historial solo agregable | Tabla + trigger P5609 + sin privilegios | `profesores_rls.sql` §4 y §7; `profesores_reversion_a.mjs` | OK | A |
| CA-10 Inactivar no bloquea el inicio de sesión | A no toca `auth.users` | `profesores_rls.sql` §7 (docente inactivo consulta su ficha) | OK (base); navegador pendiente | app |
| CA-11 Carreras con un único resultado | Ficha `FOR SHARE` / `FOR NO KEY UPDATE` | `profesores_concurrencia.mjs` 1–7 + mutaciones | OK | A |
| CA-12 Asignaciones derivadas | `listar_asignaciones_profesor`, `listar_horarios_profesor` | `profesores_rls.sql` §4 | OK | A |
| CA-13 Dirección todo; docente lo propio | `profesor_consultable` + RLS | `profesores_rls.sql` §4; `profesores_postgrest.mjs` | OK (base) | A + app |
| CA-14 Relaciones inactivas separadas | Columna `vigente` | `profesores_rls.sql` §7 | OK (base) | A + app |
| CA-15 Pantallas y navegación | — | — | Pendiente | app |
| CA-16 Tras B, docente ve solo su perfil | — (B) | `profesores_rls.sql` §8 se adapta a A y A+B | A: lectura amplia intacta | B |
| CA-17 Consulta mínima, mismo conjunto | `listar_estudiantes_para_gestion` | `profesores_rls.sql` §5; `profesores_postgrest.mjs` | OK (base) | A + app + B |
| CA-18 DEFINER en `app_private`, INVOKER en `public` | §9–§11 de la migración | `profesores_rls.sql` §2 (catálogo); autoverificación | OK | A |
| CA-19 RLS y privilegios mínimos | §12 de la migración | `profesores_rls.sql` §2 y §4; `profesores_postgrest.mjs` (406) | OK | A |
| CA-20 Servidor con sesión, Zod y `requerirDirector` | — | — | Pendiente | app |
| CA-21 Matriz de actores sin 42P17 | Toda la superficie | `profesores_rls.sql` §4; `profesores_postgrest.mjs` | OK (base y API de datos) | A + app + B |

«OK (base)» significa que la regla está garantizada y probada en PostgreSQL;
la parte de interfaz o de servidor se prueba en la etapa 2.

## 7. Migración A

Archivo: `supabase/migrations/20260925165924_ept_58_profesores.sql`, creado
con `supabase migration new` (marca de tiempo posterior a `20260924225451`).

| Objeto | Tipo | Notas |
|---|---|---|
| `public.estado_profesor` | enum | `ACTIVO`, `INACTIVO` |
| `public.profesores` | tabla | `perfil_id` PK/FK RESTRICT, `especialidad` (NULL o normalizada), `estado`, fechas |
| `public.profesores_estados_historial` | tabla | identidad, FK a ficha y a actor (RESTRICT), estados anterior/nuevo distintos, motivo, fecha |
| `registrar_profesor_al_crear_perfil` | trigger `AFTER INSERT` en `perfiles` | crea la ficha ACTIVO de todo DOCENTE nuevo |
| `a_exigir_profesor_activo` | trigger `BEFORE` en `materias_cursos` y `grupos_deportivos` | alta, cambio de responsable o reactivación exigen ficha ACTIVO |
| `impedir_modificar_historial_profesor`, `impedir_vaciar_historial_profesor` | triggers | UPDATE/DELETE/TRUNCATE del historial → P5609 |
| 8 RPC en `app_private` + 8 envoltorios en `public` | funciones | ver sección 8 |
| Autoverificación | `DO` final | huellas de `perfiles`, `materias_cursos`, `grupos_deportivos`; backfill 1:1; ACL; `search_path`; política amplia intacta |

**Orden de bloqueos.** Toda operación toma primero la ficha: las asignaciones
`FOR SHARE` (trigger con prefijo `a_`, antes que 012/014) y los cambios de
estado o de ficha `FOR NO KEY UPDATE`; recién después el perfil. Las dos
operaciones que compiten por un mismo docente quedan serializadas y ninguna
sube en sentido contrario. La concurrencia 1–7 lo prueba con dos sesiones
reales; que no haya ciclos de espera se sostiene por ese orden y el orden de
los triggers se comprueba por catálogo (`profesores_rls.sql` §2).

**Códigos SQLSTATE nuevos (P5600–P5612):** P5600 profesor inexistente ·
P5601 falta el profesor a consultar · P5602 legajo obligatorio · P5603
especialidad obligatoria · P5604 especialidad de 2 a 100 caracteres · P5605
docente inactivo a cargo · P5606 estado inválido · P5607 motivo de más de 500
caracteres · P5608 ya está en ese estado · P5609 historial de solo agregado ·
P5610 inactivación con relaciones vigentes (DETAIL JSON con `asignaciones` y
`grupos`) · P5611 reactivación sin rol DOCENTE · P5612 reactivación con ficha
incompleta. Se reutilizan P5505, 42501, P5515 y 23505.

**Defecto encontrado y corregido antes del candidato:** el nombre de la
política de fichas superaba los 63 bytes de PostgreSQL (la «ó» ocupa dos) y
quedaba truncado. Lo detectó `profesores_rls.sql` §2; se acortaron ambos
nombres y la prueba compara los nombres exactos.

## 8. Matriz de permisos

Superficie nueva de A. «RLS» = la lectura no falla pero devuelve solo las
filas permitidas.

| Actor | Tablas nuevas (SELECT) | Escritura directa | `listar_profesores` | `consultar_ficha`, `listar_asignaciones`, `listar_horarios` | `listar_historial_estados` | `listar_estudiantes_para_gestion` | `actualizar_ficha`, `cambiar_estado` |
|---|---|---|---|---|---|---|---|
| Dirección | todas las filas | 42501 / HTTP 403 | sí | cualquier ficha | sí | sí | sí |
| DOCENTE propio | su ficha; historial vacío | 42501 / 403 | 42501 / 403 | la propia (argumento nulo o propio) | 42501 / 403 | sí | 42501 / 403 |
| DOCENTE sobre otro | — | — | — | 42501 / 403 | — | — | — |
| ESTUDIANTE, PADRE, PERSONAL | 0 filas | 42501 / 403 | 42501 / 403 | 42501 / 403 | 42501 / 403 | 42501 / 403 | 42501 / 403 |
| Sesión sin perfil | 0 filas | 42501 / 403 | 42501 / 403 | 42501 / 403 | 42501 / 403 | 42501 / 403 | 42501 / 403 |
| Anónimo | 42501 / HTTP 401 | 42501 / 401 | 42501 / 401 | 42501 / 401 | 42501 / 401 | 42501 / 401 | 42501 / 401 |
| `service_role` | sin privilegio | sin privilegio | sin EXECUTE | sin EXECUTE | sin EXECUTE | sin EXECUTE | sin EXECUTE |

- `app_private` no está expuesto: PostgREST responde 406 `PGRST106` al pedir
  ese esquema, incluso con sesión de Dirección.
- Un GET sobre una RPC de escritura responde 405 (`25006`): PostgREST ejecuta
  los GET en una transacción de solo lectura, así que la escritura se rechaza
  sin cambios. Los 401/403/405 de las rutas de Next son de la etapa 2.
- Las funciones privadas son `SECURITY DEFINER`, propiedad de `postgres`, con
  `search_path` vacío, y verifican `auth.uid()` y el rol dentro de la base. Los
  envoltorios públicos son `SECURITY INVOKER`. Las funciones auxiliares
  (normalización, triggers, `profesor_consultable`) no son ejecutables por
  ningún rol de aplicación.
- La autorización nunca usa claims editables: el rol sale de `perfiles` +
  `roles` a partir del `sub` firmado.

**Permisos preexistentes que A no cambia y quedan documentados:**

| Permiso | Origen | Responsable |
|---|---|---|
| DOCENTE lee todos los perfiles, con DNI y domicilio | 005 | EPT-58 etapa 3 (migración B) |
| DOCENTE lee todas las asistencias y registra asistencias con cualquier `docente_id` | 011 | EPT-66 |
| Cualquier sesión autenticada lee todas las `inscripciones`; DOCENTE las crea, modifica y borra | 011 | EPT-66 |
| Dirección modifica datos personales de cualquier perfil por UPDATE directo, incluido el legajo | 011 | EPT-59 |

## 9. Pruebas de base de datos

| Suite | Qué demuestra |
|---|---|
| `profesores_rls.sql` (19 bloques) | CA-01/02/03, catálogo (RLS, ACL de tabla/columna/secuencia, DEFINER/INVOKER, `search_path`, propietario, orden de triggers), normalización con los 26 puntos de código, matriz de actores con SQLSTATE exacto, consulta mínima (4 columnas y mismo conjunto), ficha, estados, historial, guardas por RPC y por SQL directo, relaciones inactivas, lectura de perfiles antes/después de B |
| `profesores_concurrencia.mjs` (7 carreras) | 1 asignar→inactivar (P5610) · 2 inactivar→asignar (P5605) · 3 reactivar→asignar (OK) · 4 reactivar revertida→asignar (P5605) · 5 reactivar grupo→inactivar (P5610) · 6 inactivar→cambiar responsable (P5605) · 7 ficha y asignación en ambos órdenes sin interbloqueo; invariante final |
| `profesores_migracion_a.mjs` | A aplicada con `supabase migration up --local` sobre datos previos: backfill 1:1, huellas intactas, lectura amplia intacta |
| `profesores_postgrest.mjs` | Matriz por HTTP con siete sesiones reales: 401/403/405/406 y contenido |
| `profesores_reversion_a.mjs` | R-A conserva fichas e historial, retira el comportamiento y respeta la precondición de B |

**Sensibilidad (mutaciones).** Se inyectaron tres defectos y las pruebas los
detectaron:

| Mutación | Detectada por | Resultado |
|---|---|---|
| La guarda `exigir_profesor_activo` no hace nada | `profesores_rls.sql` | FALLO CA-07 («devolvió OK, se esperaba P5605») |
| La guarda lee la ficha sin `FOR SHARE` | `profesores_concurrencia.mjs` | la inactivación ya no espera: FALLO en la carrera 1 |
| La inactivación cuenta sin bloquear antes la ficha | `profesores_concurrencia.mjs` | «Carrera 1: se esperaba P5610 y llegó OK»: se confirmaban ambas |

Después de las mutaciones se hizo `db reset` completo y se repitió todo.

## 10. Comandos ejecutados y códigos de salida

Todos desde `E:/Escritorio/codigo/MetodologiaTPI-ept58` (Git Bash, Windows).

| Comando | Código | Nota |
|---|---|---|
| `git fetch origin` + `git rev-parse origin/main` | 0 | `e27717c…` |
| `npx.cmd supabase db reset --local` (línea base, sin A) | 0 | 001–016 + `20260924225451` |
| 20 suites SQL y de concurrencia existentes (línea base) | 0 | todas |
| `node supabase/tests/correr-autenticadas.mjs --reporter=line` (línea base) | 0 | 598 pasadas, 1 omitida (`comedor-ui.spec.ts:235`, WebKit táctil sin teclado), 10,8 min |
| `npx.cmd supabase db lint --local --level warning --fail-on none` (base y A) | 0 | «No schema errors found» |
| `npx.cmd supabase db advisors --local --type all --level info --fail-on none --output-format json` (base y A) | 0 | 19 hallazgos en ambas, 0 nuevos |
| `npx.cmd supabase migration new ept_58_profesores` | 0 | `20260925165924_ept_58_profesores.sql` |
| `npx.cmd supabase db reset --local --version 20260924225451` | 0 | base previa a A |
| `node supabase/tests/profesores_migracion_a.mjs` | 0 | 14 afirmaciones OK |
| `npx.cmd supabase db reset --local` (con A) | 0 | cadena completa, `migration list --local` termina en `20260925165924` |
| 20 suites existentes (4 con limpieza adaptada) + `profesores_rls.sql` + `profesores_concurrencia.mjs` | 0 | ver sección 11 |
| `node supabase/tests/tipos-generados.mjs --escribir` y verificación | 0 | 202 líneas agregadas, byte a byte |
| `npx.cmd tsc --noEmit --incremental false` | 0 | |
| `npx.cmd eslint --no-cache <archivos modificados>` | 0 | |
| `npm run lint -- --no-cache` | 1 | 15 errores y 108 advertencias **preexistentes**: idénticos en la base (`git stash`) y en el candidato, 0 nuevos |
| `npm run build` (credenciales locales inyectadas) | 0 | |
| `node supabase/tests/correr-autenticadas.mjs --reporter=line` (con A, dos veces) | 0 y 0 | 598 pasadas, 1 omitida en cada una |
| `node supabase/tests/profesores_postgrest.mjs` | 0 | 44 afirmaciones OK |
| `node supabase/tests/profesores_reversion_a.mjs` | 0 | ver sección 14 |
| `git diff --check` | 0 | |

Los comandos SQL se ejecutan con
`docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/<suite>.sql`,
excepto `usuarios_alta_atomica.sql`, que corre como `supabase_admin`.

## 11. Regresiones y adaptaciones de arneses

Con A aplicada, cuatro suites existentes fallaron en su **limpieza**, no en sus
aserciones: borraban un perfil DOCENTE de prueba y la FK con restricción de
borrado que exige el contrato (CA-01) ahora lo impide.

| Suite | Error con A | Adaptación |
|---|---|---|
| `alumnos_academicos_rls.sql` | 23503 al borrar perfiles `9275000x` | borrar antes sus fichas |
| `deportes_concurrencia.mjs` | 23503 en `limpiar()` | ídem |
| `horarios_concurrencia.mjs` | 23503 en `limpiar()` | ídem |
| `horarios_academicos_concurrencia.mjs` | 23503 en `limpiar()` | ídem |
| `tests/auth.setup.ts` | fallaría desde la segunda corrida | retira fichas e historial de los perfiles de prueba (guarda deshabilitada solo dentro de la transacción local) |
| `tests/usuarios-auth.spec.ts` | fallaría al limpiar docentes dados de alta por `/api/usuarios` | borrar antes sus fichas |

Ninguna aserción se relajó. La aplicación publicada no borra perfiles (no
existe esa operación y 008 revocó DELETE), así que el cambio afecta solo a
las limpiezas de prueba. Una segunda corrida de `deportes_rls.sql` falló por
residuos que dejaron esas limpiezas rotas; tras `db reset` limpio, las 22
suites terminaron con código 0:

`alumnos_academicos_rls` · `comedor_rls` · `cursos_rls` · `deportes_rls` ·
`horarios_academicos_rls` · `horarios_rls` · `inscripcion_hijos_rls` ·
`materias_rls` · `niveles_rls` · `reconciliacion_esquema_remoto` ·
`profesores_rls` · `usuarios_alta_atomica` · `alumnos_academicos_concurrencia`
· `comedor_concurrencia` · `deportes_concurrencia` ·
`horarios_academicos_concurrencia` · `horarios_concurrencia` ·
`horarios_paridad` · `niveles_concurrencia` · `migracion_009_colisiones` ·
`usuarios_reconciliacion` · `profesores_concurrencia`.

**E2E sobre A (aplicación actual + A).** Dos corridas seguidas de
`node supabase/tests/correr-autenticadas.mjs --reporter=line` después del
reset con A: **598 pasadas, 1 omitida, código 0** en ambas (11,2 y 11,1 min),
sin reintentos. La primera crea las identidades (el DOCENTE de prueba recibe su
ficha por el trigger); la segunda demuestra que la limpieza adaptada de
`auth.setup.ts` retira esa ficha antes de borrar el perfil. Después de las
dos: 0 perfiles DOCENTE sin ficha. Es el mismo resultado que la línea base
sin A (598/1), así que la aplicación publicada no cambia su comportamiento con
A. Las capturas que la corrida reescribe en `docs/evidence/EPT-13` se
restauraron y no forman parte del candidato.

## 12. Tipos y asesores

- `src/types/database.generated.ts` se regeneró desde el esquema local final
  con `node supabase/tests/tipos-generados.mjs --escribir` y se verificó byte a
  byte. El diff son 202 líneas agregadas, todas objetos de EPT-58.
- `npx supabase` sin versión resolvía 2.118.0, que cambió el formato de
  `gen types` (reescribía unas 3000 líneas sin cambio de esquema). EPT-8 a
  EPT-57 usaron 2.117.0. `tipos-generados.mjs` fija ahora 2.117.0, cambiable
  con `EPT_SUPABASE_CLI`.
- Con `core.autocrlf=true`, Git deja el archivo en CRLF en el árbol de trabajo
  y lo guarda en LF. La verificación compara el archivo escrito por
  `--escribir`; el blob versionado es LF.
- `src/types/database.types.ts` es manual y no se tocó: A no agrega nada que
  la aplicación actual use.
- **Asesores:** 19 hallazgos preexistentes, idénticos antes y después de A
  (0 nuevos, 0 resueltos). Ninguno toca objetos de EPT-58:
  `unindexed_foreign_keys` (2), `unused_index` (7), `auth_rls_initplan` en
  «Perfil propio», `multiple_permissive_policies` (5, incluida `perfiles`
  SELECT), `function_search_path_mutable` (`calcular_porcentaje_asistencia`,
  `verificar_cupo_actividad`) y `rls_policy_always_true` (formularios públicos
  de postulaciones y solicitudes).

## 13. Compatibilidad aplicación × esquema

| Aplicación \ Esquema | Actual (sin A) | A | A + B |
|---|---|---|---|
| Actual (`main`) | Publicada hoy. E2E línea base: 598/599 (1 omitida) | **Etapa 1.** Probada: suites SQL + E2E sobre A | **No es ruta de publicación**: Asistencias y Cupos del DOCENTE leen nombres y legajos de `perfiles` con la política amplia que B cierra; perderían los datos de los estudiantes |
| Etapa 2 | **No publicar**: usa funciones que solo existen con A | Probada localmente ([`ETAPA-2.md`](EPT-58/ETAPA-2.md)) | Compatibilidad probada con B simulada en la base local; B se aplica en la etapa 3 |

## 14. Despliegue y reversión no destructiva

**Orden obligatorio (cada paso con autorización puntual del usuario):**

1. PR de la etapa 1 (este candidato) → revisión → merge por el usuario.
2. Antes del `db push`: respaldo fuera del repositorio
   (`pg_dump` de esquema y datos), comprobar que el historial remoto termina en
   `20260924225451` y que `20260925165924` es la **única** pendiente
   (`supabase migration list --linked`). Nunca `--include-all`.
3. `db push` de A y verificación en producción con lecturas que no expongan
   datos personales (conteo de fichas = conteo de DOCENTE, autoverificación
   sin error, política amplia presente).
4. Recién entonces, etapa 2 (aplicación) en un PR aparte; después, etapa 3 (B).

**Reversión, en orden inverso y sin perder datos:**

| Paso | Cuándo | Cómo | Datos |
|---|---|---|---|
| R-B | Etapa 3 aplicada y hay que volver | Migración nueva que restaure temporalmente la política amplia | No toca datos |
| R-app | Etapa 2 publicada y hay que volver | Volver a la aplicación de la etapa 1 (solo con B ya compensada) | No toca datos |
| R-A | Solo si A misma causa el problema | Migración nueva a partir de `docs/evidence/EPT-58/reversion/R-A_compensacion_no_destructiva.sql` | Conserva fichas e historial (huella idéntica), la FK RESTRICT y la guarda de solo agregado |

Reglas: nunca volver a una aplicación anterior a la etapa 2 con B aplicada;
nunca retirar A mientras la aplicación de la etapa 2 dependa de sus funciones;
ningún DROP de tablas con datos ni reescritura de migraciones aplicadas. Si
basta revertir la aplicación y la política, A se conserva.

R-A se probó localmente con `node supabase/tests/profesores_reversion_a.mjs`
(código 0), dentro de transacciones con ROLLBACK:

- 3 fichas y 3 filas de historial (inactivar, reactivar, inactivar) con huella
  idéntica antes y después de la compensación;
- vuelve la regla previa (se puede asignar a un docente con ficha INACTIVO),
  un DOCENTE nuevo ya no recibe ficha y la superficie pública queda sin
  EXECUTE;
- DELETE sobre el historial sigue devolviendo P5609 y borrar un perfil con
  ficha sigue devolviendo 23503;
- con la política amplia quitada (B simulada), R-A aborta con «la migración B
  sigue aplicada» y no cambia nada;
- la base local queda con A completa y sin residuos del fixture.

R-B y la vuelta de la aplicación se prueban en las etapas 3 y 2.

## 15. Riesgos y trabajo fuera de alcance

| Riesgo | Mitigación |
|---|---|
| Historial remoto de migraciones no verificado en esta sesión | Paso 2 de la sección 14 antes del `db push` |
| Un rol que cambie a DOCENTE por SQL no recibe ficha | D1; la transición de rol es de EPT-59 y debe crear la ficha |
| La etapa 2 debe usar la clase de espacios explícita (no `\s`) | Prueba de paridad obligatoria en la etapa 2 |
| Las capturas E2E reescriben evidencia ajena (EPT-13) | Se restauraron con `git checkout`; no se versionan cambios ajenos |
| Permisos preexistentes de la sección 8 | EPT-59 y EPT-66; A no los amplía |

## 16. Qué no se ejecutó y por qué

- Pantallas, API de Next, Zod, Playwright de Dirección y DOCENTE, capturas y
  accesibilidad: son la etapa 2 y dependen de A en producción.
- Migración B y sus pruebas antes/después: etapa 3.
- Push, PR, merge, `db push` y cualquier lectura de producción: requieren
  autorización puntual.

## 17. Reproducción

```bash
npx supabase db reset --local --version 20260924225451
node supabase/tests/profesores_migracion_a.mjs
npx supabase db reset --local
docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profesores_rls.sql
node supabase/tests/profesores_concurrencia.mjs
node supabase/tests/profesores_postgrest.mjs
node supabase/tests/profesores_reversion_a.mjs
node supabase/tests/tipos-generados.mjs
node supabase/tests/correr-autenticadas.mjs
```
