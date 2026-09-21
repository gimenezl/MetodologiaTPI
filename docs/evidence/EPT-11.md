# EPT-11 — HU11 Inscribirse a deportes

Evidencia de la historia completa: **EPT-11** y sus seis subtareas **EPT-32**,
**EPT-33**, **EPT-34**, **EPT-35**, **EPT-36** y **EPT-37**.

---

## 1. Resumen ejecutivo

Un alumno con legajo académico **ACTIVO** ve únicamente los grupos deportivos
activos de **su nivel**, que PostgreSQL deriva de su matrícula vigente. Puede
mantener **una o dos** inscripciones deportivas activas, en **deportes
distintos**. El tercer deporte, un segundo grupo del mismo deporte y la
repetición del mismo grupo se rechazan con mensajes claros en español. Cancelar
es una baja lógica: la fila se conserva, la plaza queda libre y el alumno puede
inscribirse en otra actividad o volver al mismo grupo.

Cada inscripción activa ocupa **una plaza** del cupo del grupo. La ocupación no
se guarda: se cuenta sobre las inscripciones activas con la fila del grupo
bloqueada, de modo que una baja no libera dos veces y la última plaza no se
entrega a dos alumnos. Las reglas viven en PostgreSQL (trigger con alumno y
grupo bloqueados, índice único parcial, clave foránea compuesta) y en la
frontera del servidor (rol verificado, esquemas estrictos, identidad derivada de
la sesión). Están demostradas con dos conexiones PostgreSQL reales.

La **dirección** consulta grupos, ocupación e inscripciones, y puede hacer el
**alta mínima** de un grupo con deporte, nivel, cupo y un profesor responsable
con rol real **DOCENTE**. No inscribe ni cancela en nombre del alumno. DOCENTE,
PADRE, PERSONAL, las cuentas sin perfil y las sesiones anónimas no reciben
ningún poder deportivo.

La vía legada (`public.inscripciones` sobre actividades `DEPORTE`) quedó en
**solo lectura** para todo rol, incluido el propietario; el histórico sigue
visible y **TALLER** conserva todas sus operaciones.

**Estado: `ready_for_review`.** Sin push, sin PR, sin merge, sin despliegue, sin
migraciones remotas y sin mutaciones de Jira.

---

## 2. Línea base, worktree y Jira verificados

| Concepto | Valor |
|---|---|
| Fecha de verificación | 21/09/2026 |
| `git fetch origin --prune` | exit 0 |
| `origin/main` | `86df99cd651148893c80478e49939105ddd1b5cc` (`Merge pull request #7 … ept-10-inscripcion-comedor`) — igual al informado |
| `main` local del checkout original | `7b0facb`, 0 adelante / 77 detrás de `origin/main`; sucio (`AGENTS.md`, `.agents/`, `.atl/`, `.claude/`, `docs/`) — **no se tocó** |
| Colisiones de rama | `codex/ept-11*` inexistente en local y en remoto |
| Rama creada | `codex/ept-11-inscripcion-deportes`, desde `origin/main` |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept11` |
| Última migración integrada | `013_servicios_escolares.sql` |
| Migración nueva | `014_inscripcion_deportes.sql` (el número estaba libre en `origin/main`) |

Jira (`grupo12-utn.atlassian.net`, consulta `key = EPT-11 OR parent = EPT-11`):

| Clave | Tipo | Resumen | Estado | Responsable | Sprint |
|---|---|---|---|---|---|
| EPT-11 | Historia (padre EPT-5) | HU11 – Inscribirse a deportes | Por hacer | Lucas Gimenez | Sprint 4 inscribirse a deporte (`future`) |
| EPT-32 | Subtask | 1. Completar el modelo de deportes, grupos, nivel, cupo y profesor responsable | Por hacer | Lucas Gimenez | ídem |
| EPT-33 | Subtask | 2. Corregir la migración y las políticas de inscripciones antes de usar el flujo del cliente | Por hacer | Lucas Gimenez | ídem |
| EPT-34 | Subtask | 3. Implementar el listado por nivel y el alta y la baja de inscripción | Por hacer | Lucas Gimenez | ídem |
| EPT-35 | Subtask | 4. Aplicar la regla de máximo dos inscripciones activas en el servidor y en la base | Por hacer | Lucas Gimenez | ídem |
| EPT-36 | Subtask | 5. Probar uno, dos y un tercer deporte, duplicado y baja con nueva disponibilidad | Por hacer | Lucas Gimenez | ídem |
| EPT-37 | Subtask | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Por hacer | Lucas Gimenez | ídem |

Sin altas ni cambios de jerarquía respecto del enunciado. La única divergencia
entre fuentes —el PDF asigna HU11 a González Milagros y Jira a Lucas Gimenez—
ya está resuelta por la decisión del usuario (el usuario no tiene compañera y
Jira manda sobre responsable).

---

## 3. Alcance

### Dentro del alcance

- Modelo de deportes, grupos (nivel, cupo, profesor DOCENTE) e inscripciones (EPT-32).
- Corrección de las escrituras de inscripciones antes del flujo del cliente:
  el deporte legado queda en solo lectura (EPT-33).
- Listado por nivel, alta y baja; alta mínima de grupos por la dirección (EPT-34).
- Máximo de dos deportes en servidor y base, seguro ante concurrencia (EPT-35).
- Pruebas SQL, de concurrencia, de API y de navegador (EPT-36).
- Evidencia, trazabilidad Kanban preparada y retrospectiva (EPT-37).

### Fuera del alcance, deliberadamente

| Trabajo | Dueño | Por qué no se hizo acá |
|---|---|---|
| Administración completa de profesores (estado, especialidad, alta) | EPT-58 | El modelo no tiene estado de docente; EPT-11 solo exige el rol DOCENTE real. |
| Administración integral de deportes y grupos (editar, inactivar, cambiar cupo o profesor, ampliar el catálogo) | EPT-61 | La decisión 5 limita EPT-11 al alta mínima. Los triggers ya protegen esas futuras operaciones (cupo ≥ ocupación, identidad). |
| Administración transversal de inscripciones (bajas administrativas, alumnos inactivados o con cambio de nivel que conservan deportes activos) | EPT-62 | La decisión 3 impide que la dirección inscriba o cancele en nombre del alumno. |
| Transporte | EPT-60 | Ajeno a esta historia. |
| Horarios y choques | EPT-12 / EPT-57 | No se adelantan; `grupos_deportivos` es la entidad a la que se asociarán. |

Ninguna de esas claves fue comentada, transicionada ni tocada.

---

## 4. Decisiones aplicadas

### Decisiones de producto aprobadas (no se volvieron a preguntar)

| # | Decisión | Dónde se aplica |
|---|---|---|
| 1 | Cada inscripción activa ocupa una plaza; la baja la libera; carreras seguras | Trigger con grupo bloqueado; conteo sobre ACTIVAS; concurrencia 1, 5, 6, 7 |
| 2 | Máximo dos deportes distintos; no dos grupos del mismo deporte; no duplicar grupo | Índice único parcial (alumno, deporte) + trigger con alumno bloqueado; concurrencia 2–4 |
| 3 | Solo el ALUMNO se inscribe/cancela; DIRECTOR consulta y crea grupos | RPC con rol en la base + `requerirRol`/`requerirDirector`; SQL D1–D4; E2E por actor |
| 4 | TALLER intacto; deporte legado de solo lectura, sin borrar ni convertir | Trigger `bloquear_inscripcion_deportiva_legada`; SQL F1–F7; E2E Data API y pantalla legada |
| 5 | Solo alta mínima de grupos; profesor con rol DOCENTE real | `crear_grupo_deportivo` + trigger con perfil bloqueado; SQL B1–B8, E5 |

### Decisiones técnicas justificadas

**T1 — Catálogo `public.deportes` propio y no `public.actividades`.** La identidad
del deporte decide las reglas «dos deportes distintos» y «un grupo por deporte».
En producción hay 22 actividades con **7 grupos duplicados** por tipo, nivel y
nombre normalizado (`RECUPERACION-SUPABASE-PRODUCCION.md`). Con dos filas
«Fútbol» un alumno podría estar en dos grupos del mismo deporte; imponer unicidad
abortaría la migración en producción y fusionar sería pérdida de datos. Además,
una fila DEPORTE de `actividades` es en realidad una *oferta* con cupo y nivel
opcional (un grupo sin profesor), no un deporte. `actividades` conserva así
intacto el contrato que prueban 011 y 012.

**T2 — Semilla del catálogo.** Seis deportes con identificador fijo: exactamente
los nombres que la migración 001 versiona como DEPORTE (Fútbol, Natación,
Atletismo, Artes Marciales, Vóley, Básquet). Se escriben como literales; no se
leen de `actividades`, así que no se equipara ninguna fila existente. Un
catálogo sin grupos es inerte; ampliarlo es EPT-61. **Recomendación:** que el
responsable de producto confirme la lista antes de aplicar en producción, porque
producción tiene más actividades que la base local.

**T3 — Ocupación contada, no persistida.** Un contador podría desincronizarse; el
conteo de ACTIVAS con el grupo bloqueado es la única fuente de verdad.

**T4 — Orden de bloqueos `alumnos → grupos_deportivos → deportes`.** El alta
bloquea al alumno (`FOR NO KEY UPDATE`) y luego al grupo. Las operaciones
académicas de 008/009 empiezan por `alumnos FOR UPDATE`, así que un cambio de
curso concurrente queda serializado (concurrencia 8). `FOR NO KEY UPDATE` no
choca con los `FOR KEY SHARE` de las claves foráneas.

**T5 — FK compuesta `(grupo_id, deporte_id)`.** El deporte de la inscripción es
estructuralmente el de su grupo; el trigger lo completa y la FK impide que
difiera. Permite el índice único parcial por deporte.

**T6 — Bloqueo legado por trigger, no por políticas.** Reescribir las ocho
políticas de `inscripciones` arriesgaba el flujo de TALLER y materias. Un trigger
rechaza todo alta, cambio o borrado que involucre DEPORTE, para cualquier rol,
y deja las políticas de 011 intactas (SQL G2).

**T7 — Listado por función `SECURITY DEFINER`.** La ocupación cuenta filas de
todos los alumnos, que RLS no muestra a un estudiante. La función devuelve solo
agregados, decide el alcance por rol en la base y no expone al estudiante el
identificador del profesor.

**T8 — Controles bloqueados con `aria-disabled`.** Siguen siendo enfocables y
anuncian el motivo por `aria-describedby`; un botón `disabled` sacaría el motivo
del recorrido de teclado.

**T9 — Una política SELECT por tabla.** Se consolidaron director + estudiante en
una política con `OR` para no introducir el hallazgo
`multiple_permissive_policies` del asesor de rendimiento.

---

## 5. Modelo de datos y migración

`supabase/migrations/014_inscripcion_deportes.sql` — aditiva; no edita 001–013.

### `public.deportes`
| Columna | Tipo | Reglas |
|---|---|---|
| `id` | UUID PK | semilla fija `e0000000-…-00000000010N` |
| `nombre` | VARCHAR(100) | recortado, 1–100; único por `UPPER(BTRIM(nombre))` |
| `activo` | BOOLEAN | baja lógica |
| `fecha_creacion`, `fecha_actualizacion` | TIMESTAMPTZ | inmutable / sellada por trigger |

### `public.grupos_deportivos`
| Columna | Tipo | Reglas |
|---|---|---|
| `id` | UUID PK | `UNIQUE (id, deporte_id)` para la FK compuesta |
| `deporte_id` | UUID FK → deportes RESTRICT | activo al crear/reactivar; inmutable con inscripciones |
| `nivel_id` | INTEGER FK → niveles RESTRICT | activo al crear/reactivar; inmutable con inscripciones |
| `nombre` | VARCHAR(100) | 1–100 recortado; único por (deporte, nivel, nombre normalizado) |
| `cupo` | INTEGER | 1–100; nunca menor que las inscripciones activas |
| `profesor_id` | UUID FK → perfiles RESTRICT | rol real DOCENTE al elegirlo o cambiarlo |
| `activo` | BOOLEAN | baja lógica (sin superficie en EPT-11) |

### `public.inscripciones_deportivas`
| Columna | Tipo | Reglas |
|---|---|---|
| `id` | UUID PK | |
| `alumno_id` | UUID FK → alumnos RESTRICT | siempre el de la sesión; inmutable |
| `grupo_id`, `deporte_id` | FK compuesta → grupos RESTRICT | deporte derivado del grupo; inmutables |
| `estado` | ENUM `ACTIVA`/`CANCELADA` | única transición ACTIVA → CANCELADA |
| `fecha_inscripcion`, `fecha_cancelacion` | TIMESTAMPTZ | coherencia por CHECK; la baja la sella la base |

Índices: único parcial `(alumno_id, deporte_id) WHERE estado='ACTIVA'`;
`(grupo_id, estado)`; `(alumno_id, fecha_inscripcion DESC)`; `(deporte_id)`;
`(nivel_id, activo)` y `(profesor_id)` en grupos. Todas las FK tienen índice.

Vista `public.inscripciones_deportivas_detalle` con `security_invoker = true`.

### Compatibilidad de datos

- No se borra, fusiona ni convierte ninguna fila. La autoverificación compara
  conteos y **huellas md5** de `inscripciones` y `actividades` antes y después.
- Las inscripciones DEPORTE legadas quedan visibles como histórico (la
  recuperación de producción registró 4 filas en `inscripciones` en total, sin
  distinguir tipo). No se mapean a
  grupos: no hay una identidad segura para hacerlo.
- La migración aborta si ya existen objetos deportivos o si faltan las tablas y
  funciones de 001–013.

### Códigos SQLSTATE (bloque P556x–P558x, sin colisión)

| Código | Significado | HTTP | Mensaje al usuario |
|---|---|---|---|
| P5560 / P5561 | deporte inexistente / inactivo | 404 / 409 | El deporte seleccionado no existe. / … está inactivo … |
| P5562 / P5563 | nivel inexistente / inactivo | 404 / 409 | El nivel educativo … |
| P5564 / P5565 | profesor inexistente / sin rol DOCENTE | 404 / 409 | La persona seleccionada no tiene el rol DOCENTE. |
| P5566 / P5567 | cupo / nombre inválido | 400 | El cupo debe ser un número entero entre 1 y 100. |
| P5568 / P5569 | grupo inexistente / inactivo | 404 / 409 | El grupo ya no recibe inscripciones. |
| P5570 / P5571 / P5572 | sin legajo / legajo inactivo / sin curso vigente | 409 | Tu legajo académico no está activo … |
| P5573 | nivel ajeno | 409 | Ese grupo no corresponde a tu nivel educativo. |
| P5574 | sin plazas | 409 | El grupo ya no tiene plazas disponibles. |
| P5575 | mismo grupo | 409 | Ya estás inscripto en este grupo. |
| P5576 | mismo deporte | 409 | Ya estás inscripto en otro grupo de este deporte … |
| P5577 | tercer deporte | 409 | Ya tenés dos deportes activos, que es el máximo permitido … |
| P5578 / P5579 | inscripción ajena o inexistente / ya cancelada | 404 / 409 | No encontramos una inscripción deportiva activa tuya … / Esa inscripción ya estaba cancelada. |
| P5580 / P5581 | identidad o transición inválida / cupo menor que ocupación | 409 | Esa operación no está permitida … |
| P5582 | escritura deportiva legada | (vía legada) | Las inscripciones deportivas se hacen por grupo en la sección Deportes. |

### Reversión

- **Código** (antes de aplicar la migración en un entorno): `git revert` de los
  commits de la rama. Sin la migración aplicada no queda nada que deshacer en la base.
- **Esquema ya aplicado**: 014 **no se edita ni se borra**. Se escribe una
  migración nueva (015) que, tras una decisión explícita sobre los datos
  deportivos creados, quite el trigger legado y los objetos nuevos. Si hubiera
  inscripciones deportivas reales, primero se exportan. Una restauración
  completa solo por PITR/backup, como en migraciones anteriores.
- En esta sesión no se escribió ni migró producción.

---

## 6. Matriz de autorización, RLS y privilegios

### Privilegios de tabla
| Objeto | anon | authenticated | service_role |
|---|---|---|---|
| `deportes` | ninguno | SELECT | predeterminado (solo preparación de pruebas locales) |
| `grupos_deportivos` | ninguno | SELECT | ídem |
| `inscripciones_deportivas` | ninguno | SELECT | ídem |
| `inscripciones_deportivas_detalle` | ninguno | SELECT | ídem |
| `inscripciones` (011) | sin cambios | sin cambios + trigger DEPORTE | sin cambios |
| `actividades` (011/012) | sin cambios | sin cambios | sin cambios |

Sin INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER para `anon` ni
`authenticated` sobre las tablas nuevas; sin secuencias (PK UUID).

### Políticas RLS (solo SELECT)
| Tabla | Política | Predicado |
|---|---|---|
| `deportes` | visible para sesiones autenticadas | `TRUE` |
| `grupos_deportivos` | dirección o estudiante de su nivel | `es_director_actual() OR (rol = ESTUDIANTE AND ((activo AND nivel = nivel_actual()) OR grupo con inscripción propia))` |
| `inscripciones_deportivas` | dirección o su alumno | `es_director_actual() OR (alumno = perfil_actual() AND rol = ESTUDIANTE)` |

### Funciones
| Función | Tipo | EXECUTE | Autorización interna |
|---|---|---|---|
| `public.listar_grupos_deportivos()` | INVOKER → `app_private` DEFINER | authenticated | DIRECTOR: todo; ESTUDIANTE: su nivel; resto: 42501 |
| `public.crear_grupo_deportivo(...)` | INVOKER → DEFINER | authenticated | `es_director()` |
| `public.inscribir_en_grupo_deportivo(grupo)` | INVOKER → DEFINER | authenticated | perfil y rol ESTUDIANTE de `auth.uid()` |
| `public.cancelar_inscripcion_deportiva(id)` | INVOKER → DEFINER | authenticated | ídem + fila propia |
| `app_private.nivel_actual()` | DEFINER | authenticated (para RLS) | deriva de la sesión, sin parámetros |
| `app_private.nivel_alumno(uuid)` y triggers | DEFINER | nadie | solo internas |

Todas con `search_path = ''`. `anon` no tiene USAGE sobre `app_private`.

### Actores
| Actor | Ver grupos | Inscribirse / cancelar | Crear grupo | Ver inscripciones | Vía legada DEPORTE |
|---|---|---|---|---|---|
| ESTUDIANTE activo | activos de su nivel + propios | propias (API 201/200) | 403 / 42501 | propias | rechazada (P5582) |
| ESTUDIANTE inactivo | ninguno (sin nivel) | 409 (P5571) | 403 | propias | rechazada |
| DIRECTOR | todos | 403 / 42501 | 201 | todas | rechazada |
| DOCENTE | ninguno (42501) | 403 / 42501 | 403 / 42501 | ninguna | rechazada; TALLER sigue |
| PADRE | ninguno | 403 / 42501 | 403 | ninguna | rechazada; TALLER de hijos sigue |
| PERSONAL | ninguno | 403 / 42501 | 403 | ninguna | sin políticas |
| Sin perfil | ninguno | 403 / 42501 | 403 | ninguna | — |
| Anónimo | 401 / sin privilegio | 401 / sin EXECUTE | 401 | 401 | sin privilegio |

---

## 7. Matriz criterio → evidencia

### EPT-11
| Criterio | SQL / base | Servidor / API | Navegador | Captura |
|---|---|---|---|---|
| 1. Grupos disponibles para el nivel | C1, C20, C21 | `listar_grupos_deportivos` | «ve solo los grupos de su nivel derivado…» | `real-escritorio-alumno-listado.png` |
| 2. Una o dos inscripciones activas | C2, C5 | POST 201 | primer y segundo deporte | `real-escritorio-primer-deporte.png`, `real-escritorio-limite-dos.png` |
| 3. Tercer deporte rechazado con mensaje claro | C6, E4; concurrencia 2 | 409 `limiteDos` | API + pantalla desactualizada | `real-escritorio-error-tercer-deporte.png` |
| 4. Sin duplicado al mismo grupo | C3, C4; concurrencia 3, 4 | 409 `mismoGrupo` / `mismoDeporte` | «no puede duplicar…» | `real-escritorio-limite-dos.png` |
| 5. La baja libera disponibilidad | C8–C11, C17–C19; concurrencia 5, 6 | PATCH 200; repetida 409 | baja con teclado y nueva alta | `real-escritorio-baja-exitosa.png` |

### Subtareas
| Clave | Entregable | Evidencia |
|---|---|---|
| EPT-32 | Modelo deporte–grupo–nivel–cupo–DOCENTE | Migración §5; SQL A1–A7, B1–B8, E1–E5 |
| EPT-33 | Escrituras de inscripciones corregidas antes del cliente | Trigger legado; SQL F1–F7, G2; E2E Data API y pantalla legada |
| EPT-34 | Listado por nivel, alta y baja, alta mínima de grupos | Rutas, servicio, pantallas; E2E de alumno y dirección |
| EPT-35 | Límite de dos en servidor y base, concurrente | Trigger + índice; SQL C6, E4; concurrencia 2, 4, 8; API 409 |
| EPT-36 | Pruebas uno/dos/tercero/duplicado/baja/disponibilidad | §8 completo |
| EPT-37 | Evidencia, Kanban preparado, retrospectiva | Este documento, §11 y §13 |

---

## 8. Pruebas

### `supabase/tests/deportes_rls.sql` — 59 comprobaciones OK, transacción con ROLLBACK
- **A1–A9** objetos, semilla, RLS, privilegios exactos, sin políticas de escritura,
  funciones DEFINER con `search_path` vacío, índice parcial, FK compuesta, RPC sin
  parámetros de identidad, anon fuera de `app_private`.
- **B1–B8** alta válida; profesor PADRE/ESTUDIANTE (P5565), inexistente o nulo (P5564);
  cupo 0/101/nulo (P5566); nombre vacío o con espacios (P5567); nivel inexistente/inactivo,
  deporte inexistente/inactivo; duplicado normalizado (23505); escritura directa denegada al DIRECTOR.
- **C1–C22** matriz del alumno (ver §7), aislamiento, baja ajena (P5578), cupo agotado y
  recuperado, nivel ajeno, alumno INACTIVO, alumno sin curso vigente (P5572).
- **D1–D4** DIRECTOR consulta y no opera; DOCENTE, PADRE, PERSONAL y sin perfil sin
  poderes; anon sin privilegios ni EXECUTE.
- **E1–E6** cupo menor que ocupación (P5581); identidad del grupo y de la inscripción;
  escritura directa del propietario sujeta al límite; ex DOCENTE; sin funciones de borrado.
- **F1–F7** vía legada: DEPORTE visible pero sin alta/cambio/borrado para alumno,
  padre, docente y propietario; TALLER con alta, baja y borrado para alumno, padre y docente.
- **G1–G3** sin regresiones en `actividades`, `inscripciones`, académico y comedor.

### `supabase/tests/deportes_concurrencia.mjs` — 8 carreras reales, 10 OK
Dos procesos `psql` independientes, coordinados por `pg_blocking_pids` (sin esperas por tiempo):

| # | Carrera | Resultado |
|---|---|---|
| 1 | Dos alumnos por la última plaza | una confirma; la otra P5574; ocupación 1 de 1 |
| 2 | Alumno con un deporte pide dos nuevos a la vez | uno solo adicional; el otro P5577 |
| 3 | Mismo grupo dos veces a la vez | una fila; P5575 |
| 4 | Dos grupos del mismo deporte a la vez | uno; P5576 |
| 5 | Baja y alta simultáneas en grupo lleno | la plaza liberada la toma el otro; 1 de 1 |
| 6 | Doble baja simultánea | una confirma; P5579; se libera una vez |
| 7a/7b | Reducción de cupo y alta, en los dos órdenes | P5574 / P5581; nunca ocupación > cupo |
| 8 | Cambio de curso y alta simultáneos | el alta se serializa y usa el nivel nuevo (P5573) |

### `tests/deportes.spec.ts` — frontera HTTP sin sesión (5 casos)
401 antes de validar cuerpo o identificador (alta, baja, grupos); 405 para DELETE y GET;
redirección del panel al login; ninguna respuesta filtra detalle técnico.

### `tests/deportes-auth.spec.ts` — 30 casos con sesiones reales, sin mocks (más los 12 pasos del setup)
Alumno (listado por nivel, primero, recarga persistente, duplicado, mismo deporte,
segundo, límite anunciado, tercero por API, pantalla desactualizada, baja con teclado
y retorno de foco, disponibilidad recuperada, alta por teclado, nivel ajeno, grupo
inexistente, cuerpo manipulado, DELETE 405, baja repetida, 375 px, sesión vencida);
última plaza entre dos alumnos por la API (uno 201, otro 409); aislamiento entre
alumnos; alumno inactivo; dirección (alta por diálogo y teclado, validación, duplicado
en campo, rechazos de API, consulta sin controles de operación, 375 px); DOCENTE,
PADRE, PERSONAL y sin perfil (sin navegación, acceso restringido, 403 en todo); Data
API directa (42501 en tablas y RPC; P5582 en DEPORTE legado; TALLER alta/baja/borrado);
pantalla legada con histórico sin acciones y TALLER operativo.

### `tests/deportes-ui.spec.ts` — 9 casos × 3 perfiles (27), **prueba de presentación**
Datos sintéticos del banco `/pruebas-ui/deportes` y API interceptada. Demuestra
estados de carga, vacío, error de lectura, plaza ocupada por otro, error 500, fallo
de red, límite con control enfocable, diálogo con foco retenido y devuelto, filtros
y búsqueda. No demuestra persistencia ni autorización.

### Accesibilidad, responsive e idioma
- Todo texto visible, accesible y de error en español (verificado con
  `exigirPantallaSinDetalleTecnico` y `exigirMensajeSinDetalleTecnico`).
- Teclado: alta por Enter, diálogo con foco inicial en «Volver sin cancelar»,
  Escape sin efecto y foco devuelto al disparador, Tab hasta la confirmación;
  en la dirección el foco vuelve a «Nuevo grupo».
- Resultados anunciados (`role="status"` / `role="alert"` en región `aria-live`)
  y foco llevado a la región tras cada operación del alumno.
- Motivos de bloqueo asociados por `aria-describedby`; errores de formulario con
  `aria-invalid` y descripción accesible.
- 375 px sin desplazamiento horizontal (alumno, diálogo, dirección) y perfiles
  Pixel 5 e iPhone 13 en los fixtures.

---

## 9. Comandos y resultados

Candidato verificado: `ccf6438ec8a0385a5e87456ccacd651cd5c3b81f` (código y pruebas; este documento y las capturas se agregan en el commit siguiente, sin cambios de código). Base local: `127.0.0.1:54321/54322`, confirmada antes de cada reset.

Gate final ejecutado de punta a punta con un único script sobre ese SHA:

| # | Comando | Exit | Resultado |
|---|---|---|---|
| 1 | `git diff --check origin/main...HEAD` | 0 | sin problemas de espacios |
| 2 | `npx.cmd tsc --noEmit --incremental false` | 0 | sin errores |
| 3 | `npx.cmd eslint --no-cache <archivos de la historia>` | 0 | 0 errores (1 aviso preexistente en `layout.tsx`) |
| 4 | `npm run lint -- --no-cache` | 1 | 124 problemas (15 errores, 109 avisos), **idénticos a la base limpia** (ver §10) |
| 5 | `npm run build` (credenciales locales inyectadas) | 0 | compila `/dashboard/deportes` y las tres rutas `/api/deportes/*` |
| 6 | `node supabase/tests/harness_produccion.mjs` | 0 | los cinco bancos, incluido `/pruebas-ui/deportes`, responden como rutas inexistentes |
| 7 | `node supabase/tests/harness_produccion_negativas.mjs` | 0 | 58 afirmaciones, 0 incumplidas |
| 8 | `npx.cmd supabase db reset --local` | 0 | 14 migraciones aplicadas (001–014) |
| 9 | `npx.cmd supabase migration list --local` | 0 | 001–014 locales = aplicadas |
| 10 | `docker exec -i … psql … < supabase/tests/deportes_rls.sql` | 0 | 59 OK |
| 10 | `cursos_rls.sql` / `niveles_rls.sql` / `alumnos_academicos_rls.sql` | 0 / 0 / 0 | 39 / 73 / 69 OK |
| 10 | `materias_rls.sql` / `comedor_rls.sql` / `reconciliacion_esquema_remoto.sql` | 0 / 0 / 0 | 44 / 31 / 42 OK |
| 10 | `usuarios_alta_atomica.sql` (como `supabase_admin`) | 0 | 23 OK |
| 11 | `node supabase/tests/deportes_concurrencia.mjs` | 0 | 8 carreras, 10 OK |
| 11 | `niveles_` / `alumnos_academicos_` / `comedor_concurrencia.mjs` | 0 / 0 / 0 | 4 / 8 / 4 OK |
| 12 | `node supabase/tests/tipos-generados.mjs` | 0 | dos generaciones idénticas; archivo igual byte a byte |
| 13 | `npx.cmd supabase db advisors --local --type security\|performance -o json` | 0 / 0 | 4 / 8 hallazgos, ninguno sobre objetos de 014 |
| 14 | `npm run test:e2e -- --reporter=line` (sin base local) | 0 | 333 casos: 332 pasan, 1 omitido preexistente (teclado en WebKit del comedor) |
| 15 | `node supabase/tests/correr-autenticadas.mjs --reporter=line` | 0 | 536 casos: 535 pasan, 1 omitido (el mismo); **0 reintentos** |

Además, antes del gate: `deportes-auth.spec.ts` repetida 3 veces sin reintentos
(`--repeat-each=3 --retries=0`) → exit 0; y las capturas se regeneraron sobre
`ccf6438` (69 casos, exit 0).

**Comparación con la línea base.** Asesores: se ejecutaron sobre la base en 013
(`db reset --local --version 013`) y en 014; los conjuntos son idénticos
(seguridad 4 = 4, rendimiento 8 = 8). Lint: comparado con un worktree limpio en
`86df99c`. No hubo ninguna prueba global fallida en el gate final.

---

## 10. Tipos, asesores, legado y regresiones

- **Tipos**: `node supabase/tests/tipos-generados.mjs --escribir` regenera
  `src/types/database.generated.ts` desde la base local; la verificación
  (`node supabase/tests/tipos-generados.mjs`) genera dos veces, confirma salida
  idéntica y coincidencia byte a byte. `database.types.ts` refleja además la
  nulabilidad real de `profesor_id` e `inscripcion_propia_id`.
- **Asesores**: seguridad — 4 hallazgos preexistentes (`search_path` mutable de
  `calcular_porcentaje_asistencia` y `verificar_cupo_actividad`; INSERT público de
  `postulaciones` y `solicitudes_inscripcion`). Rendimiento — 8 preexistentes
  (`auth_rls_initplan` en `perfiles`; políticas permisivas múltiples en tablas
  anteriores). La primera versión de 014 agregaba dos
  `multiple_permissive_policies` propias; se corrigieron (T9) y 014 queda con
  **0 hallazgos nuevos**.
- **Lint**: `npm run lint -- --no-cache` termina con exit 1 por **15 errores y 109
  avisos preexistentes**. Se comparó con una base limpia real (worktree desachado
  en `86df99c` con `npm ci`): mismas 124 entradas; la única diferencia es el
  aviso preexistente `perfil` sin uso de `layout.tsx`, desplazado de la línea 153
  a la 154 por el ítem de navegación agregado. ESLint focalizado de los archivos
  de la historia: 0 errores.
- **Legado**: TALLER y materias sin cambios de contrato; histórico DEPORTE visible.
- **Regresiones**: ninguna. Todas las suites SQL, de concurrencia y E2E
  anteriores pasan. Durante la sesión aparecieron y se corrigieron:
  (a) un defecto real de interfaz —ante un 401 la pantalla refrescaba, el proxy
  llevaba al login y el aviso de sesión vencida desaparecía según el tiempo—;
  (b) una dependencia de mi spec del nombre del docente compartido, que la suite
  de usuarios modifica.

---

## 11. Capturas

`docs/evidence/EPT-11/`. Generadas con `EPT_CAPTURAS=1` **solo** sobre las specs
de deportes, para no regenerar evidencia de otras historias.

- `real-*` (18): sesión real contra la base local — listado del alumno, primer
  deporte, límite de dos, error del tercer deporte, confirmación y baja, sesión
  vencida, alumno inactivo, dirección (listado, validación, grupo creado,
  duplicado, inscripciones), docente restringido, actividades legadas y móviles
  (alumno, confirmación, dirección).
- `fixture-*` (20): banco sintético, escritorio y móvil — carga, error de
  lectura, un deporte, límite, sin plazas, fallo de red, inactivo, dirección
  (listado, diálogo, vacío). Son **prueba de presentación**, no de base de datos.

Todas las identidades y datos son sintéticos (dominio `ept.local`, DNI en el
rango 99.9xx.xxx, legajos `LEG-PRUEBA-*`); no hay claves ni datos personales.

---

## 12. Seguridad, privacidad, concurrencia y riesgos

- Sin `service_role` en el camino de la aplicación ni en el navegador; solo lo
  usan las pruebas para preparar datos en la base local, con guarda de host.
- Identidad, rol, nivel, cupo y estado nunca vienen del navegador; `.strict()`
  rechaza campos extra.
- Respuestas sin SQLSTATE, nombres de objetos ni trazas; una inscripción ajena
  responde igual que una inexistente.
- El estudiante no recibe el identificador del profesor; solo nombre y apellido.

**Riesgos abiertos**
1. Un alumno que se inactiva o cambia de nivel conserva sus deportes activos y
   su plaza: requiere política de EPT-62.
2. `actividades.cupo_maximo` de filas DEPORTE sigue editable por DIRECTOR/DOCENTE
   (privilegio de columna de 011); no tiene efecto porque no hay altas legadas.
   Cerrarlo modificaría el contrato de EPT-56 (prueba 27bis): se deja para EPT-62/66.
3. La lista sembrada de deportes debe confirmarse contra producción antes de aplicar.
4. Si hubiera inscripciones DEPORTE legadas activas en producción, esos alumnos no
   quedan inscriptos en grupos: nadie los convierte sin decisión explícita.
5. Deuda previa no tocada: `search_path` mutable de `verificar_cupo_actividad` y
   `calcular_porcentaje_asistencia`; lectura global de `inscripciones` (EPT-66).

---

## 13. Handoff Jira preparado (sin mutar)

| Clave | Estado recomendado | Texto de evidencia propuesto |
|---|---|---|
| EPT-32 | En revisión (Testing) | Modelo `deportes`/`grupos_deportivos`/`inscripciones_deportivas` en `014_inscripcion_deportes.sql`; profesor DOCENTE real; SQL A1–A7, B1–B8, E1–E5 OK. |
| EPT-33 | En revisión (Testing) | Deporte legado en solo lectura por trigger (P5582) sin tocar las políticas de TALLER; SQL F1–F7, G2 y E2E Data API OK. |
| EPT-34 | En revisión (Testing) | Listado por nivel, alta, baja y alta mínima de grupos; E2E con sesiones reales 30/30. |
| EPT-35 | En revisión (Testing) | Límite de dos en trigger con alumno bloqueado e índice único parcial; concurrencia 2, 4 y 8 OK; API 409. |
| EPT-36 | En revisión (Testing) | SQL 59 OK, concurrencia 8 carreras OK, E2E autenticada, frontera HTTP y fixtures en tres perfiles. |
| EPT-37 | En revisión (Testing) | `docs/evidence/EPT-11.md`, 38 capturas y retrospectiva; tablero pendiente de mover por una persona. |
| EPT-11 | En curso → Testing tras revisión | Todos los criterios con evidencia SQL, API y navegador. **No pasar a Listo** hasta revisión independiente, integración en `main`, aplicación remota segura de 014 y verificación final. |

Ningún hijo se recomienda `Listo` todavía: la Definición de Hecho del plan exige
revisión por otra persona e integración en la rama principal.

---

## 14. Retrospectiva

**Qué funcionó.** Diseñar la regla en la base con el orden de bloqueos escrito
antes del código hizo que la suite SQL y las ocho carreras pasaran al primer
intento. Reutilizar el patrón de EPT-10 (RPC en `app_private`, envoltorios
INVOKER, traducción de SQLSTATE, banco de fixtures) redujo decisiones nuevas.

**Qué costó.** Dos fallas de prueba fueron del arnés, no del producto: contar
ocupación con la identidad de un alumno (RLS ocultaba las filas ajenas) y un
selector que coincidía con el texto de marcador del `<select>`. El asesor de
rendimiento detectó dos políticas permisivas por tabla; se consolidaron.

**Acción de mejora concreta.** En toda prueba de concurrencia, contar como
propietario; en toda prueba de formulario, verificar errores por descripción
accesible del control, no por texto suelto.
