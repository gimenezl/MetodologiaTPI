# EPT-12 — HU12 Consultar compatibilidad horaria

Evidencia de implementación y verificación de la historia EPT-12 y de sus seis
subtareas (EPT-38 a EPT-43). Rama `codex/ept-12-compatibilidad-horaria`.

## 1. Resumen ejecutivo

La inscripción deportiva ahora tiene un motor real de compatibilidad horaria:

- **Modelo**: catálogo `horarios` (día 1–7, `TIME` sin zona, intervalo
  semiabierto `[inicio, fin)`) y relación `grupos_deportivos_horarios` con
  varias franjas por grupo, baja lógica y FK `RESTRICT` (migración **015**).
- **Regla única**: `app_private.intervalos_se_superponen` es la única fórmula de
  superposición de la base; `src/lib/horarios.ts` es su copia exacta,
  demostrada idéntica sobre 400 pares de casos límite.
- **Autoridad en PostgreSQL**: el trigger de inscripción (reemplazado por
  migración forward, sin editar 014) exige que el grupo tenga horario (P5583) y
  rechaza el conflicto con otra actividad **activa** del alumno (P5584),
  informando deporte, grupo, día y rango. Se aplica igual al alumno y al alta
  administrativa del DIRECTOR, porque ambos insertan la misma fila.
- **Concurrencia**: el alta bloquea al alumno y luego, en orden de id, el grupo
  pedido y los grupos activos del alumno; los cambios de franjas se serializan
  con un bloqueo consultivo y el bloqueo del grupo. Nueve carreras reales lo
  demuestran; un control negativo (sin el bloqueo consultivo) hace fallar el
  arnés.
- **Interfaz**: el alumno ve las franjas, el grupo sin horario y el conflicto
  anticipado con el mismo texto que devuelve la base; la dirección configura
  franjas e inscribe a un alumno con las mismas reglas.
- **Hallazgo del advisor**: se reprodujo `unindexed_foreign_keys` sobre la FK
  compuesta `inscripciones_deportivas(grupo_id, deporte_id)` de 014 (solo
  visible con `--level info`) y se corrigió con un índice en 015.

Todo lo verificable en local está verde. No se tocó Supabase remoto ni
producción.

## 2. Línea base, aislamiento y Jira

| Dato | Valor |
|---|---|
| `git fetch origin --prune` | exit 0 |
| `origin/main` (baseline) | `fae68b2b118ad506c5736790042a44c16e769996` (merge del PR #8, EPT-11) |
| Contiene `fae68b2…` | sí (es el propio HEAD remoto) |
| Worktree aislado | `E:\Escritorio\codigo\MetodologiaTPI-ept12`, creado limpio desde `origin/main` |
| Rama | `codex/ept-12-compatibilidad-horaria` (no existía local ni remota) |
| Checkout original | no se modificó (conserva sus cambios locales) |
| Número de migración | 015 libre en `origin/main`; 001–014 sin cambios |

Jira consultado en vivo antes de tocar código:

| Clave | Resumen | Estado | Responsable | Sprint |
|---|---|---|---|---|
| EPT-12 | HU12 – Consultar compatibilidad horaria (padre: EPT-5) | En curso | Lucas Gimenez | Sprint 5 validar horarios |
| EPT-38 | Crear la migración de horarios y su relación con los grupos deportivos | En curso | Lucas Gimenez | Sprint 5 |
| EPT-39 | Implementar una función única de comparación de intervalos en el servidor y en la base | En curso | Lucas Gimenez | Sprint 5 |
| EPT-40 | Integrar la validación al alta realizada por el alumno o por el administrador | En curso | Lucas Gimenez | Sprint 5 |
| EPT-41 | Mostrar el deporte, el día y el rango que originan el conflicto | En curso | Lucas Gimenez | Sprint 5 |
| EPT-42 | Probar días distintos, intervalos superpuestos, contenidos y contiguos | En curso | Lucas Gimenez | Sprint 5 |
| EPT-43 | Actualizar el tablero Kanban, la evidencia y la retrospectiva | En curso | Lucas Gimenez | Sprint 5 |

La jerarquía y los seis criterios coinciden con el encargo. Ninguna tarea se
movió a Listo: eso requiere merge y comprobación productiva.

## 3. Alcance

**Dentro**: modelo y migración de horarios, regla única, integración al alta
del alumno y al alta administrativa, consulta de compatibilidad, mensajes de
conflicto, gestión mínima de franjas por la dirección, pruebas, evidencia.

**Fuera, deliberadamente**:

- Horarios académicos de materias o cursos (EPT-57): el catálogo `horarios` es
  genérico para que EPT-57 lo relacione sin tocarlo.
- Administración integral de grupos (editar, inactivar, reactivar) — EPT-61.
- Cancelación administrativa y administración general de inscripciones — EPT-62.
- Cualquier cambio en producción: la migración **no** debe aplicarse antes del
  merge.

## 4. Contrato de horarios e intervalos

- `dia_semana`: entero 1–7, **1 = lunes … 7 = domingo** (ISO 8601).
- `hora_inicio`, `hora_fin`: `TIME WITHOUT TIME ZONE`, `hora_inicio < hora_fin`
  (una franja no cruza la medianoche).
- Cada franja es el intervalo semiabierto `[inicio, fin)`.
- Condición canónica, única en la base y en el servidor:

```text
mismo día  Y  inicio_nuevo < fin_existente  Y  inicio_existente < fin_nuevo
```

| Caso (contra lunes 10:00–11:00) | Resultado |
|---|---|
| Lunes 10:00–11:00 (igualdad) | superpone → rechazo |
| Lunes 09:30–10:30 (parcial izquierda) | superpone → rechazo |
| Lunes 10:30–11:30 (parcial derecha) | superpone → rechazo |
| Lunes 10:15–10:45 (contenido) | superpone → rechazo |
| Lunes 09:00–12:00 (contiene) | superpone → rechazo |
| Lunes 11:00–12:00 (contiguo posterior) | permitido |
| Lunes 09:00–10:00 (contiguo anterior) | permitido |
| Martes 10:00–11:00 (otro día) | permitido |

## 5. Modelo de datos (migración 015)

### `public.horarios`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | UUID | PK |
| `dia_semana` | SMALLINT | `CHECK (dia_semana BETWEEN 1 AND 7)` |
| `hora_inicio`, `hora_fin` | TIME sin zona | `CHECK (hora_inicio < hora_fin)`; `CHECK` de horas representables (menores que 24:00, sin fracciones de segundo) |
| `fecha_creacion` | timestamptz | — |

`UNIQUE (dia_semana, hora_inicio, hora_fin)`: dos grupos con la misma franja
comparten una fila. Un trigger impide cambiar día o rango de una fila del
catálogo (P5592): movería a todos los grupos sin validar conflictos.

### `public.grupos_deportivos_horarios`

| Columna | Regla |
|---|---|
| `grupo_id` | FK → `grupos_deportivos` `ON DELETE/UPDATE RESTRICT` |
| `horario_id` | FK → `horarios` `ON DELETE/UPDATE RESTRICT` |
| `activo`, `fecha_alta`, `fecha_baja` | baja lógica coherente (`CHECK`) |

Índices: único parcial `(grupo_id, horario_id) WHERE activo`, `(grupo_id,
activo)` y `(horario_id)` (cubren ambas FK). La baja es lógica; reasignar una
franja crea una fila nueva y vuelve a validarse.

### Índice de la FK compuesta de 014

`idx_inscripciones_deportivas_grupo_deporte (grupo_id, deporte_id)`. El índice
`(grupo_id, estado)` de 014 no cubría la clave compuesta; el advisor lo señalaba
como `unindexed_foreign_keys` (nivel INFO). 014 no se editó.

### Invariantes y garantía

| Invariante | Garantía |
|---|---|
| Día 1–7, inicio < fin | CHECK + validación en la RPC (P5585/P5586) |
| Franja no duplicada activa en un grupo | índice único parcial + trigger (P5587) |
| Franjas de un grupo no superpuestas | trigger con grupo bloqueado (P5588) |
| Una franja nueva no crea conflictos a inscriptos | trigger con grupo bloqueado (P5589) — regla agregada por esta historia, no escrita en Jira: sin ella, una franja cargada después dejaría a un alumno con actividades superpuestas |
| Sin horario no hay alta | trigger de inscripción (P5583) |
| Ningún alumno con dos actividades activas superpuestas | trigger de inscripción (P5584) + P5589 |
| Cancelada no participa | todas las consultas filtran `estado = 'ACTIVA'` |
| Misma regla para alumno y DIRECTOR | ambos insertan la misma fila; decide el mismo trigger |
| Reglas de EPT-11 | conservadas en el mismo orden y con los mismos códigos; las de horario van al final |

### Códigos SQLSTATE nuevos (P5583–P5592)

| Código | Significado | HTTP |
|---|---|---|
| P5583 | grupo sin horarios | 409 |
| P5584 | conflicto horario (DETAIL JSON con deporte, grupo, día, rango) | 409 |
| P5585 | día inválido | 422 |
| P5586 | rango inválido (inicio ≥ fin, 24:00 o fracciones de segundo) | 422 |
| P5587 | franja ya asignada | 409 |
| P5588 | franja superpuesta dentro del grupo | 409 |
| P5589 | franja que generaría conflicto a inscriptos (informa cantidad, no identidad) | 409 |
| P5590 | franja inexistente en ese grupo | 404 |
| P5591 | franja ya dada de baja | 409 |
| P5592 | identidad de horario o franja inmutable | 409 |

## 6. Orden de bloqueos y concurrencia

```text
alumnos → grupos_deportivos (pedido + activos del alumno, ORDER BY id) → deportes
franjas: pg_advisory_xact_lock(fijo) → grupos_deportivos (el grupo de la franja)
```

- Dos altas del mismo alumno se serializan en `alumnos` (heredado de EPT-11): la
  segunda ve la primera y aplica P5584 o P5577.
- Bloquear los grupos activos del alumno impide que una franja nueva se agregue
  a uno de ellos mientras se evalúa el alta (y viceversa).
- El bloqueo consultivo serializa dos cambios de franjas en grupos distintos
  que comparten alumnos; nunca se toma en el camino del alta, así que no hay
  ciclo.
- El orden por id evita interbloqueos entre altas que tocan los mismos grupos
  en sentido inverso.

## 7. Matriz de roles

| Actor | Ver franjas | Consultar compatibilidad | Inscribirse | Inscribir a otro | Configurar franjas |
|---|---|---|---|---|---|
| ESTUDIANTE | grupos de su nivel y propios | solo propia (sin parámetro) | sí (reglas completas) | 403 / 42501 | 403 / 42501 |
| DIRECTOR | todas | de un alumno elegido | no por la vía del alumno (403, EPT-11) | sí (mismas reglas) | sí |
| DOCENTE, PADRE, PERSONAL | ninguna (RLS) | 403 / 42501 | 403 | 403 / 42501 | 403 / 42501 |
| Sesión sin perfil | ninguna | 403 / 42501 | 403 | 403 / 42501 | 403 / 42501 |
| Anónimo | sin privilegio (42501) | 401 / sin EXECUTE | 401 | 401 / sin EXECUTE | 401 / sin EXECUTE |

## 8. Matriz de privilegios

| Objeto | anon | authenticated | Escritura |
|---|---|---|---|
| `horarios` | ninguno | SELECT (RLS `TRUE`) | solo RPC `agregar_horario_grupo_deportivo` |
| `grupos_deportivos_horarios` | ninguno | SELECT (RLS: quien ve el grupo) | solo RPC agregar / dar de baja |
| `app_private.*` de 015 | sin EXECUTE | EXECUTE solo en las operaciones; las internas (`intervalos_se_superponen`, `primer_conflicto_horario`, `compatibilidad_grupos_de_alumno`, `lanzar_conflicto_horario`) sin EXECUTE | — |
| Envoltorios `public.*` de 015 | sin EXECUTE | EXECUTE | SECURITY INVOKER, `search_path = ''` |

Sin INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER para anon ni
authenticated; sin políticas de escritura; sin ninguna RPC, política, grant ni
ruta de DELETE físico. Todas las operaciones son `SECURITY DEFINER` en
`app_private` con `SET search_path = ''` y derivan la identidad de
`auth.uid()`.

## 9. Matriz criterio → implementación → prueba → resultado

| Criterio | Implementación | Prueba | Resultado |
|---|---|---|---|
| 1. Sin actividades previas continúa | trigger: sin conflicto posible | SQL D1, E2; E2E «sin actividades previas…» | OK |
| 2. Días distintos no se superponen | fórmula: `dia_a = dia_b` | SQL B1, D8; paridad; E2E «días distintos…» | OK |
| 3. Superposición del mismo día rechazada | P5584 | SQL B1, D2, D3; E2E «la API rechaza…»; carreras 1 y 9 | OK |
| 4. Contiguos permitidos | `<` estricto (semiabierto) | SQL B1, D6, D7, C6, F1; E2E «un intervalo contiguo…» | OK |
| 5. Mensaje con actividad, día y rango | P5584 + `mensajeConflicto` | SQL D2 (mensaje y DETAIL exactos); E2E con texto y `conflicto` | OK |
| 6. Misma regla alumno / administrador | una sola inserción validada por el trigger | SQL E1–E5; E2E «alumno y dirección reciben la misma decisión»; carrera 9 | OK |
| Cancelada no participa y libera | filtro `ACTIVA` | SQL D9, F2; E2E cancelación con teclado; carrera 8 | OK |
| Grupo sin horario rechazado | P5583 | SQL D5, E5; E2E | OK |
| Varias franjas por grupo | relación N:1 | SQL C1, D3 (conflicto con la segunda franja) | OK |
| Garantías de EPT-11 | trigger reemplazado con el mismo orden | SQL de EPT-11 (59 OK, idénticos a la base), G1–G6; carreras de EPT-11 (10 OK); E2E de EPT-11 | OK |

| Subtarea | Evidencia |
|---|---|
| EPT-38 | migración 015; SQL A1–A7, C1–C10 |
| EPT-39 | `app_private.intervalos_se_superponen` + `src/lib/horarios.ts`; SQL B1; `horarios_paridad.mjs` (400 pares) |
| EPT-40 | trigger + `inscribir_alumno_en_grupo_deportivo`; rutas; SQL D/E/G; E2E |
| EPT-41 | P5584 con DETAIL, `mensajeConflicto`, UI; capturas de conflicto |
| EPT-42 | SQL B1/D; paridad; carreras; E2E |
| EPT-43 | este documento, capturas y comentarios de Jira |

## 10. Decisiones y alternativas descartadas

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Catálogo `horarios` + relación | columnas de horario en `grupos_deportivos` | no admite varias franjas y no es reutilizable por EPT-57 |
| Regla en el trigger de inscripción | validar solo en la RPC | una escritura directa del propietario la saltearía; EPT-11 ya usaba el trigger como autoridad |
| Bloquear grupos activos del alumno | `EXCLUDE USING gist` | no expresa «por alumno a través de grupos» y exige `btree_gist` |
| Bloqueo consultivo para franjas | bloquear todos los grupos vecinos | el conjunto de grupos que comparten alumnos no es estable sin serializar |
| Rechazar grupo sin horario | considerarlo compatible | no se puede afirmar que no choca; es el pedido explícito |
| Chequeos de horario al final | al principio | ninguna respuesta de EPT-11 cambia de código |
| Mensajes administrativos en tercera persona | reutilizar los del alumno | «Ya tenés…» es falso dicho a la dirección |
| 422 para validación semántica en rutas nuevas | 400 como EPT-11 | el encargo pide distinguir 422; las rutas de EPT-11 conservan su contrato |

## 11. Cambios por archivo

| Archivo | Cambio |
|---|---|
| `supabase/migrations/015_compatibilidad_horaria.sql` | nuevo: modelo, regla, trigger reemplazado, RPC, RLS, grants, índice de FK, autoverificación |
| `src/lib/horarios.ts` | nuevo: copia exacta de la fórmula, formatos y mensajes |
| `src/lib/validations.ts` | esquemas de franja, baja y alta administrativa |
| `src/services/deportes.service.ts` | lecturas de franjas, compatibilidad, alumnos; operaciones; mapeo P5583–P5592 |
| `src/services/deportes.client.ts` | cliente de las rutas nuevas |
| `src/app/api/deportes/grupos/[id]/horarios/route.ts` | POST franja (DIRECTOR) |
| `src/app/api/deportes/grupos/[id]/horarios/[franjaId]/route.ts` | PATCH baja lógica (DIRECTOR) |
| `src/app/api/deportes/inscripciones-administrativas/route.ts` | POST alta administrativa (DIRECTOR) |
| `src/app/api/deportes/compatibilidad/route.ts` | GET compatibilidad (propia o de un alumno) |
| `src/app/api/deportes/inscripciones/route.ts` | devuelve también `conflicto` estructurado |
| `src/app/dashboard/deportes/page.tsx` | carga franjas, compatibilidad y alumnos |
| `src/app/dashboard/deportes/_components/MisDeportes.tsx` | franjas, sin horario, conflicto anticipado |
| `src/app/dashboard/deportes/_components/GestionDeportes.tsx` | franjas por grupo, botones «Horarios» e «Inscribir alumno» |
| `src/app/dashboard/deportes/_components/HorariosGrupo.tsx` | nuevo: diálogo de franjas |
| `src/app/dashboard/deportes/_components/InscripcionAdministrativa.tsx` | nuevo: diálogo de alta administrativa |
| `src/app/dashboard/deportes/_components/ListaFranjas.tsx` | nuevo: lista accesible de franjas |
| `src/app/pruebas-ui/deportes/page.banco.tsx` | fixtures con horarios (solo desarrollo) |
| `src/types/database.generated.ts` | regenerado desde la base local final |
| `src/types/database.types.ts` | reconciliado a mano (nulabilidad real de `conflicto_*`) |
| `supabase/tests/horarios_rls.sql` | nuevo: 44 comprobaciones |
| `supabase/tests/horarios_concurrencia.mjs` | nuevo: 9 carreras + invariante + limpieza garantizada |
| `supabase/tests/horarios_paridad.mjs` | nuevo: paridad TS ↔ PostgreSQL |
| `supabase/tests/deportes_rls.sql`, `deportes_concurrencia.mjs` | EPT-11: una franja por grupo en días distintos |
| `tests/horarios-auth.spec.ts`, `horarios-ui.spec.ts`, `horarios.spec.ts` | nuevos |
| `tests/deportes-auth.spec.ts` | EPT-11: franjas y botón «Inscribir alumno» esperado |
| `playwright.config.ts` | registra las suites nuevas |

## 12. Comandos ejecutados y códigos de salida

Base local `127.0.0.1:54321/54322`, verificada antes de cada corrida. Las
credenciales se inyectan desde `supabase status -o env` (nunca `.env.local`).

| # | Comando | Baseline `fae68b2` | Candidato |
|---|---|---|---|
| 1 | `git diff --check` | 0 | 0 |
| 2 | `npx.cmd tsc --noEmit --incremental false` | 0 | 0 |
| 3 | `npx.cmd eslint --no-cache <archivos modificados>` | — | 0 (0 errores, 0 avisos) |
| 4 | `npm run lint -- --no-cache` | 1 (124: 15 errores, 109 avisos) | 1 (**idénticos** línea por línea) |
| 5 | `npm run build` | 0 | 0 |
| 6 | `npx.cmd supabase db reset --local` | 0 (001–014) | 0 (001–015), tres veces desde cero |
| 7 | `npx.cmd supabase migration list --local` | 0 | 0 |
| 8 | 9 suites SQL (`docker exec … psql`) | 8 × exit 0 | 9 × exit 0 |
| 9 | 6 arneses de concurrencia/migración | 5 × exit 0 | 6 × exit 0 |
| 10 | `node supabase/tests/horarios_paridad.mjs` | — | 0 (400 pares) |
| 11 | `node supabase/tests/tipos-generados.mjs` | 1 (ver §15) | 0 |
| 12 | `npx.cmd supabase db lint --local -s public,app_private` | — | 0, sin errores |
| 13 | `supabase db advisors --local --type security/performance [--level info]` | 0 / 0 | 0 / 0 |
| 14 | `node supabase/tests/harness_produccion.mjs` | — | 0 (el banco no existe en producción) |
| 15 | `node supabase/tests/harness_produccion_negativas.mjs` | — | 0 (58 afirmaciones) |
| 16 | `npm run test:e2e -- --reporter=line` (sin base) | 0: 332 pasan, 1 omitida | 0: 356 pasan, 1 omitida |
| 17 | `node supabase/tests/correr-autenticadas.mjs --reporter=line` | 0: 535 pasan, 1 omitida | 0: 582 pasan, 1 inestable (ver abajo), 1 omitida |
| 18 | `EPT_CAPTURAS=1 … horarios-auth horarios-ui` | — | 0: 57 pasan |
| 19 | `playwright test tests/alumnos-contraste.spec.ts:364 --project=iphone-13-webkit --repeat-each=20 --retries=0` | 1: 19 pasan, 1 falla | 1: 19 pasan, 1 falla |

La tabla refleja la regresión completa repetida sobre el candidato **después**
de las correcciones de la auditoría (§19); la corrida anterior a las
correcciones había dado 583 pasan sin inestables.

- La prueba omitida es la misma en base y candidato (teclado en WebKit del
  comedor, preexistente).
- **Inestabilidad preexistente, no regresión**: `alumnos-contraste.spec.ts:364`
  (auditoría de contraste de EPT-9, iPhone 13) falló una vez y pasó en el
  reintento. EPT-12 no toca ese archivo ni su banco. Repetida 20 veces sin
  reintentos, falla 1 de 20 **tanto en el baseline limpio `fae68b2`** (worktree
  descartable, eliminado después) como en el candidato.

## 13. Resultados SQL y de concurrencia

| Suite | Baseline | Candidato |
|---|---|---|
| `horarios_rls.sql` | — | 44 OK |
| `deportes_rls.sql` (EPT-11) | 59 OK | 59 OK |
| `alumnos_academicos_rls.sql` | 69 | 69 |
| `comedor_rls.sql` | 31 | 31 |
| `cursos_rls.sql` | 39 | 39 |
| `materias_rls.sql` | 44 | 44 |
| `niveles_rls.sql` | 73 | 73 |
| `reconciliacion_esquema_remoto.sql` | 42 | 42 |
| `usuarios_alta_atomica.sql` | 23 | 23 |

Carreras de `horarios_concurrencia.mjs` (coordinación con `pg_blocking_pids`,
nunca por tiempo):

| # | Carrera | Resultado |
|---|---|---|
| 1 | mismo alumno, dos grupos incompatibles | uno confirma, el otro P5584 |
| 2 | mismo alumno, dos compatibles | ambos confirman (2 activos) |
| 3 | dos alumnos por la última plaza | uno confirma, el otro P5574 |
| 4 | tercer deporte simultáneo | uno más, el otro P5577 |
| 5 | franja nueva y alta a la vez | el alta ve la franja (P5584) |
| 6 | alta y franja nueva a la vez | la franja ve el alta (P5589) |
| 7 | dos franjas en grupos que comparten alumno | una confirma, la otra P5589 |
| 8 | baja y alta que chocaba con ella | la baja libera y el alta confirma |
| 9 | dirección y alumno a la vez | misma regla, confirma uno (P5584) |

Invariante final: ningún alumno con actividades activas superpuestas ni con
más de dos deportes. Sin residuos, también ante fallo (la limpieza corre al
inicio y en `finally` con una conexión nueva).

**Control negativo**: con el bloqueo consultivo quitado de la base local, la
carrera 7 deja de serializarse y el arnés falla («La sesión … no quedó
bloqueada»), limpiando igual. Luego se restauró con `db reset`.

## 14. Resultados de navegador

- `horarios-auth.spec.ts` (sesiones reales): matriz del alumno, pantalla
  desactualizada con rechazo real, consulta propia y ajena, carrera HTTP,
  franjas con teclado, API de franjas (400/404/405/409/422), alta
  administrativa con la misma decisión que el alumno, P5589 sin identificar al
  alumno, DOCENTE/PADRE/PERSONAL/sin perfil (403), Data API directa, 375 px.
- `horarios-ui.spec.ts` (fixtures, tres perfiles): franjas, sin horario,
  conflicto anticipado y del servidor, envío, carga, vacío, error, diálogos.
- `horarios.spec.ts` (anónimo): 401 antes de validar, 405 sin DELETE.
- Regresión: todas las suites de EPT-11 (`deportes*.spec.ts`) pasan.

## 15. Tipos generados y fallos preexistentes

- `src/types/database.generated.ts` se regeneró con
  `node supabase/tests/tipos-generados.mjs --escribir` (+147 líneas, solo objetos
  de 015); la verificación pasa byte a byte.
- **Preexistente, no regresión**: en el baseline la verificación fallaba (exit 1)
  porque el worktree de Windows sale con `core.autocrlf=true` y el archivo queda
  en CRLF; el contenido del índice (LF) era idéntico a la salida del generador.
- **Preexistente, no regresión**: `npm run lint` termina con exit 1 por 15
  errores y 109 avisos en archivos ajenos a esta historia; la salida es
  idéntica en base y candidato.
- `src/types/database.types.ts` (manual) declara `conflicto_*` como nulos, cosa
  que el generador no expresa.

## 16. Advisors

| Tipo | Baseline | Candidato |
|---|---|---|
| security (WARN) | 4 preexistentes | los mismos 4, ninguno sobre 015 |
| performance (WARN) | 8 preexistentes | los mismos 8 |
| performance `unindexed_foreign_keys` (INFO) | 3, incluida `inscripciones_deportivas_grupo_deporte_fk` | 2 preexistentes (`actividades_nivel_id_fkey`, `asistencias_docente_id_fkey`); **la de 014 quedó resuelta** |
| performance `unused_index` (INFO) | — | esperables en una base recién creada |

El hallazgo de la FK compuesta no aparece con el nivel por defecto (WARN): por
eso la evidencia de EPT-11 no lo mostraba.

## 17. Capturas

Carpeta `docs/evidence/EPT-12/`. **`real-*`**: sesión real contra Supabase
local, datos creados por la API. **`fixture-*`**: banco con datos sintéticos,
solo presentación. Móvil: 375 px (real) y Pixel 5 / iPhone 13 (fixture).

| Captura | Muestra |
|---|---|
| `real-escritorio-alumno-horarios.png` | grupos con franjas, grupo sin horario |
| `real-escritorio-inscripcion-compatible.png` | primera inscripción confirmada |
| `real-escritorio-conflicto-anticipado.png` | conflicto explicado antes del intento |
| `real-escritorio-conflicto-servidor.png` | rechazo real de la base en pantalla desactualizada |
| `real-escritorio-contiguo-permitido.png` | intervalo contiguo aceptado |
| `real-escritorio-sin-horario.png` | grupo sin horario bloqueado con motivo |
| `real-escritorio-cancelacion-libera.png` | baja que libera el horario |
| `real-escritorio-director-horarios.png` | diálogo de franjas de la dirección |
| `real-escritorio-director-inscribe.png` | alta administrativa confirmada |
| `real-escritorio-director-conflicto.png` | alta administrativa rechazada por la base |
| `real-movil-alumno-horarios.png`, `real-movil-director-horarios.png` | 375 px |
| `fixture-*-alumno-horarios.png` | franjas, conflicto y sin horario |
| `fixture-*-alumno-conflicto-servidor.png` | alerta del servidor |
| `fixture-*-alumno-envio.png` | estado de envío |
| `fixture-*-carga.png`, `fixture-*-alumno-vacio.png`, `fixture-*-error-lectura.png` | carga, vacío y error |
| `fixture-*-alumno-sin-compatibilidad.png` | consulta de compatibilidad fallida |
| `fixture-*-director-horarios.png`, `fixture-*-director-inscripcion*.png` | diálogos de la dirección |

Las capturas con un diálogo abierto usan la ventana visible (no la página
completa), porque la composición de página completa deformaba el overlay. Las
capturas de otras historias no se regeneraron.

## 18. Accesibilidad e idioma

- Diálogos (`Dialogo`): foco inicial declarado, contención con Tab, Escape y
  devolución del foco; probado con teclado en Chromium (WebKit táctil no
  recorre con Tab).
- Resultados en `role="status"`/`role="alert"` dentro de regiones `aria-live`;
  el foco va al resultado tras cada operación del alumno.
- Controles bloqueados con `aria-disabled` y `aria-describedby` al motivo
  (enfocables); errores de campo con `aria-invalid` y descripción asociada.
- Cada franja se lee como frase («lunes de 10:00 a 11:00») para lectores de
  pantalla.
- Sin desplazamiento horizontal a 1280 y 375 px.
- Todo el texto visible, de accesibilidad y de error está en español; las
  respuestas no filtran SQLSTATE, nombres de tablas ni texto de PostgreSQL.

## 19. Auditoría independiente

Antes de publicar se ejecutaron tres revisiones de solo lectura, independientes
entre sí. Ninguna encontró hallazgos críticos, altos ni bloqueantes.

| Revisión | Resultado | Correcciones aplicadas (commit `fix(horarios): …`) |
|---|---|---|
| Seguridad e integridad | sin CRÍTICO/ALTO/MEDIO; RLS, grants, DEFINER, `auth.uid()`, orden de bloqueos sin ciclos, sin bypass ni DELETE verificados | interbloqueo/espera/tiempo agotado → 503 con «volvé a intentarlo»; mensaje propio para 23505 en franjas; P5586 ya no significa «horario inexistente»; trigger de identidad del catálogo sin DEFINER; mensajes propios en la consulta administrativa |
| Aceptación, idioma y accesibilidad | 6 criterios y EPT-38…EPT-42 cubiertos con pruebas reales; un hallazgo MAYOR (capturas de página completa deformadas con diálogos abiertos) y varios menores | capturas de diálogos con la ventana visible y tras terminar la consulta; preparación que solo acepta «franja ya asignada»; rechazo por nivel sin condicional; prueba de contención del foco; una sola región viva por aviso; foco al resultado tras dar de baja; «Sin horario» no se muestra sobre un grupo inscripto; texto de P5583 unificado; referencia corregida |
| Runtime | reset, 9 suites SQL, 3 arneses, paridad, tipos, advisors y 22 casos límite manuales en verde | **defecto real**: la base aceptaba `24:00` y fracciones de segundo, que la aplicación no puede mostrar; ahora lo impiden un CHECK del catálogo y la RPC (P5586) |

Tras las correcciones se repitió la regresión completa (§12).

## 20. Seguridad y riesgos

- La base es la autoridad: la pantalla y el servidor solo anticipan.
- El conflicto revela solo actividades del propio alumno; P5589 informa a la
  dirección cuántos alumnos, nunca quiénes.
- **Riesgo operativo**: al aplicar 015 en producción, los grupos existentes
  quedan sin horario y **dejan de aceptar inscripciones nuevas** hasta que la
  dirección cargue sus franjas. Las inscripciones activas no se tocan. Planificar
  la carga de franjas junto con el despliegue.
- La serialización de franjas es global (bloqueo consultivo); es una operación
  administrativa infrecuente.

## 21. Reversión

- **Código**: revertir los commits de la rama (o el merge) con `git revert`.
- **Base, antes de aplicar**: no aplicar 015.
- **Base, después de aplicar**: migración forward que restaure el cuerpo de
  `app_private.validar_inscripcion_deportiva` de 014 y elimine las funciones de
  015; las tablas de horarios pueden conservarse (son aditivas) o eliminarse si
  están vacías. Nunca editar 014 ni 015 ya aplicadas.

## 22. Retrospectiva

- **Bien**: registrar el baseline completo antes de tocar código permitió
  demostrar que el lint y la verificación de tipos ya fallaban, y comparar
  conteos suite por suite.
- **Bien**: las pruebas encontraron un defecto propio real antes de publicar
  (un `refine` de Zod 4 que se ejecuta aunque un campo falle devolvía 500 ante
  `25:00`); se corrigió y quedó cubierto.
- **Bien**: el control negativo demostró que el arnés de concurrencia detecta
  la falta del bloqueo, no solo que pasa.
- **Bien**: la auditoría de runtime encontró que `TIME` admite `24:00`, un caso
  que ni la paridad ni la suite cubrían porque la aplicación nunca lo genera.
- **Mejorar**: el advisor de FK sin índice es de nivel INFO; conviene correr
  siempre `--level info` en las historias con migraciones.
- **Mejorar**: la verificación de tipos depende de los finales de línea del
  checkout; convendría fijar `eol=lf` para el archivo generado (EPT-66).

## 23. Reproducción local

```bash
git fetch origin --prune
git worktree add ../MetodologiaTPI-ept12 codex/ept-12-compatibilidad-horaria
cd ../MetodologiaTPI-ept12 && npm ci
npx supabase start
npx supabase db reset --local
docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/horarios_rls.sql
node supabase/tests/horarios_concurrencia.mjs
node supabase/tests/horarios_paridad.mjs
node supabase/tests/tipos-generados.mjs
npm run test:e2e
node supabase/tests/correr-autenticadas.mjs
```

**No aplicar la migración 015 en Supabase remoto ni en producción antes del
merge.**
