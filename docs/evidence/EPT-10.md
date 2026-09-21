# EPT-10 — HU9 Inscribirse al comedor

Evidencia de la historia completa: **EPT-10** y sus seis subtareas **EPT-26**,
**EPT-27**, **EPT-28**, **EPT-29**, **EPT-30** y **EPT-31**.

---

## 1. Resumen ejecutivo

Un alumno con legajo académico **ACTIVO** puede consultar su situación en el
comedor escolar, inscribirse una sola vez, cancelar sin que se borre nada y
volver a inscribirse las veces que necesite. Cada ciclo queda registrado por
separado. La inscripción siempre corresponde al alumno y al legajo de la sesión
autenticada, porque ni el navegador ni el servidor eligen de quién se trata: la
identidad la deriva PostgreSQL desde `auth.uid()`.

La regla de «una sola inscripción activa por alumno y servicio» no se comprueba
consultando antes de escribir. La garantiza un **índice único parcial** sobre
las inscripciones activas, de modo que dos pedidos simultáneos no pueden
confirmar los dos. Está demostrado con dos conexiones PostgreSQL reales.

El **DIRECTOR** consulta el listado de inscriptos con identificación, legajo,
estado y fechas, y no adquiere ninguna facultad para inscribir o cancelar en
nombre del alumno: ni Jira ni el plan se la atribuyen. DOCENTE, PADRE, PERSONAL,
las cuentas sin perfil y las sesiones anónimas no escriben ni leen datos ajenos.

La persistencia separa el **catálogo de servicios** de las **inscripciones**, de
modo que EPT-60 podrá incorporar sus cuatro recorridos de transporte agregando
filas al catálogo, sin crear tablas ni inventar ahora ningún recorrido.

No existe ninguna superficie de eliminación física en ninguna capa.

**Estado: `ready_for_review`.** Sin push, sin PR, sin merge, sin despliegue y sin
ninguna operación contra producción.

---

## 2. Línea base y worktree

| Concepto | Valor |
|---|---|
| Fuente remota verificada | `origin/main = 6023206003bd1133cc53b2a77848c951d1e4b701` |
| Descripción del tip remoto | `Merge pull request #6 from gimenezl/codex/ept-56-admin-materias` |
| Rama creada | `codex/ept-10-inscripcion-comedor` |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept10` |
| Migración anterior integrada | `supabase/migrations/012_administracion_materias.sql` |
| Migración nueva | `supabase/migrations/013_servicios_escolares.sql` |

Comprobaciones previas a editar:

```text
git fetch origin --prune                → exit 0
git status --short --branch             → ## main...origin/main [behind 71]
git rev-parse origin/main               → 6023206003bd1133cc53b2a77848c951d1e4b701
git log -1 --oneline origin/main        → 6023206 Merge pull request #6 …
git diff --check                        → exit 0
git worktree list                       → sin worktree en EPT-10
git branch --list 'codex/ept-10*'       → vacío
git ls-remote --heads origin 'codex/ept-10*' → vacío
```

El checkout original `E:\Escritorio\codigo\MetodologiaTPI` quedó **intacto**: no
se limpió, no se reseteó, no se usó `stash` y no se borró ningún artefacto local
de `AGENTS.md`, `.agents/`, `.atl/`, `.claude/` ni `docs/`.

La migración `013` estaba libre antes de crearla, verificado sobre el árbol de
`origin/main`.

---

## 3. Alcance y fuera de alcance

### Dentro del alcance

- Modelo de servicios escolares e inscripciones, con unicidad activa por alumno
  y servicio (EPT-26).
- Alta y baja lógica mediante operaciones de servidor y de PostgreSQL (EPT-27).
- Pantalla del alumno y consulta administrativa del DIRECTOR (EPT-28).
- Estructura reutilizable para transporte, sin inventar recorridos (EPT-29).
- Pruebas de alta, duplicado, baja, reingreso, legajo y concurrencia (EPT-30).
- Documentación, evidencia y retrospectiva (EPT-31).

### Fuera del alcance, deliberadamente

Nada de lo siguiente se implementó, ni se preparó a medias: menú del comedor,
pagos, cuotas, capacidad o cupo, turnos, asistencia diaria al servicio, códigos
QR, control de acceso, y transporte funcional (recorridos, paradas, dirección y
cobertura). Tampoco se creó una facultad administrativa para inscribir o
cancelar en nombre del alumno, porque ninguna fuente autorizada la define.

---

## 4. Estado de Jira

Consultado en vivo el 2026-09-15 contra `grupo12-utn.atlassian.net`
(`cloudId c552e7b2-7720-4af4-9c2d-9fc020e12ecb`).

| Clave | Tipo | Resumen | Estado al consultar | Responsable | Sprint |
|---|---|---|---|---|---|
| EPT-10 | Historia (padre `EPT-4`) | HU9 – Inscribirse al comedor | Por hacer | Lucas Gimenez | Sprint 3 |
| EPT-26 | Subtask | Diseñar las tablas de servicios e inscripciones con unicidad por alumno y servicio | Por hacer | Lucas Gimenez | Sprint 3 |
| EPT-27 | Subtask | Implementar el alta y la baja de comedor mediante un servicio del lado del servidor | Por hacer | Lucas Gimenez | Sprint 3 |
| EPT-28 | Subtask | Construir la pantalla del alumno y la consulta administrativa de inscriptos | Por hacer | Lucas Gimenez | Sprint 3 |
| EPT-29 | Subtask | Preparar la estructura reutilizable para los cuatro recorridos de transporte | Por hacer | Lucas Gimenez | Sprint 3 |
| EPT-30 | Subtask | Probar alta, duplicado, baja, reingreso y asociación con el legajo | Por hacer | Lucas Gimenez | Sprint 3 |
| EPT-31 | Subtask | Actualizar el tablero Kanban, la evidencia y la retrospectiva | Por hacer | Lucas Gimenez | Sprint 3 |

**Única diferencia respecto del enunciado de la sesión:** el sprint figura ahora
con estado `active` (inicio 2026-09-16, fin 2026-09-18) y no `future`. Es la
transición esperada del propio sprint, no una contradicción de alcance,
responsable ni contenido, así que no activa una condición de detención.

Ninguna incidencia se cerró. No se tocó el sprint, la descripción, el
responsable ni la estimación de ninguna de ellas, y no se tocó EPT-57, EPT-58,
EPT-59, EPT-60 ni ninguna otra.

---

## 5. Decisiones funcionales

### D1 — Modelo propio en lugar de reutilizar `public.inscripciones`

`public.inscripciones` (migración 001) es la inscripción a una **actividad**:
apunta a `actividades` (deportes, talleres y materias) con unicidad **total**
`UNIQUE (estudiante_id, actividad_id)` y claves foráneas `ON DELETE CASCADE`.

Reutilizarla habría tenido tres consecuencias inaceptables:

1. Mezclaría inscripciones académicas, deportivas y de servicios escolares en
   una relación de la que EPT-11 todavía es dueño, junto con sus reglas de cupo.
2. Su unicidad total convierte el reingreso en la **reactivación de la misma
   fila**, de modo que el ciclo anterior se pierde. EPT-10 exige lo contrario.
3. `ON DELETE CASCADE` haría desaparecer el historial en silencio al borrar una
   actividad o un perfil.

Se crearon por eso `public.servicios_escolares` y
`public.inscripciones_servicios`. `public.inscripciones` **no se tocó**: sin
columnas nuevas, sin privilegios nuevos, sin políticas nuevas y sin filas
nuevas, y la verificación 24 de `comedor_rls.sql` compara su huella completa
antes y después.

### D2 — El vínculo con el legajo es estructural, no una copia

`inscripciones_servicios.alumno_id` **es** el `perfil_id` del alumno, y
`perfiles.legajo_nro` es único y 1:1 con ese perfil. Además, desde la migración
008 un alumno `ACTIVO` no puede existir sin legajo (`P5512`), y solo un alumno
`ACTIVO` puede inscribirse. El vínculo con «el legajo correcto» es entonces una
consecuencia del modelo, no un dato replicado.

Se descartó copiar el número de legajo en la fila de inscripción: una copia
quedaría desactualizada ante una corrección de identidad del alumno y exigiría
un trigger de sincronización. La vista `inscripciones_servicios_detalle`
resuelve el legajo en la lectura, siempre vigente. El trigger comprueba además
explícitamente que el legajo exista antes de aceptar el alta (`P5554`), como
defensa en profundidad.

### D3 — Baja lógica con fila nueva en el reingreso

Cancelar cambia `estado` a `CANCELADA` y sella `fecha_cancelacion`. Volver a
inscribirse crea una **fila nueva**. Una inscripción cancelada **no se reactiva
nunca** (`P5558`): si se reactivara, los dos ciclos quedarían fundidos en uno y
el historial dejaría de reflejar lo que pasó. Por eso el índice único es
**parcial** sobre `estado = 'ACTIVA'`, y no total.

### D4 — El DIRECTOR consulta, no opera

Ni la descripción de EPT-10 ni EPT-28 ni el plan le atribuyen al DIRECTOR la
facultad de inscribir o cancelar en nombre del alumno. No se inventó: no existe
RPC, ni ruta, ni control de interfaz para hacerlo, y la verificación 17 de
`comedor_rls.sql` comprueba que el intento recibe `42501`.

### D5 — El catálogo de servicios es legible por cualquier sesión autenticada

`servicios_escolares` no contiene ningún dato personal: es un catálogo
institucional. El alumno necesita leerlo para inscribirse y el director para
consultar. Se concede `SELECT` a `authenticated` y a nadie más; `anon` no tiene
ningún privilegio. Es la única lectura nueva que reciben DOCENTE, PADRE y
PERSONAL, y está documentada aquí a propósito en lugar de ampliarse en silencio.

### D6 — `TRANSPORTE` existe en el tipo, pero no hay ningún recorrido

RF5 y RF10 ya nombran el transporte, y EPT-29 pide una estructura reutilizable.
El tipo enumerado `tipo_servicio_escolar` incluye `'TRANSPORTE'` desde ahora
para que EPT-60 no necesite alterar el modelo. **No se sembró ningún servicio de
transporte**, y la autoverificación de la migración aborta si alguien lo
agregara por esta vía. Los cuatro recorridos, sus paradas, su dirección y su
cobertura son decisiones de producto que pertenecen a EPT-60 (DG-03).

### D7 — Diálogo accesible compartido

El contrato de accesibilidad del diálogo modal (foco inicial declarado,
contención con Tab, Escape y devolución del foco) ya existía duplicado en los
segmentos de Niveles (EPT-55) y Materias (EPT-56). Para no crear una tercera
copia se extrajo a `src/components/ui/Dialogo.tsx`. Las dos pantallas anteriores
**conservan su copia local a propósito**: migrarlas es un cambio de
comportamiento ajeno a esta historia que pondría en riesgo sus pruebas. Unificar
las tres queda como trabajo de consolidación (EPT-66).

### D8 — Fecha con zona horaria institucional y formato de 24 horas

Detectado durante las pruebas: el formateo de fechas rompía la hidratación de
React. Dos causas reales, no artefactos de la prueba:

- Sin `timeZone` explícito, el servidor formatea en la zona del proceso y el
  navegador en la de la persona, de modo que una misma inscripción se vería con
  dos horas distintas según el dispositivo.
- En formato de 12 horas, Node y los navegadores separan el «a. m.» con
  caracteres de espacio distintos (uno usa U+202F, el espacio estrecho sin
  separación). La diferencia es invisible en pantalla, pero React descarta el
  árbol hidratado.

Se fijó `timeZone: 'America/Argentina/Buenos_Aires'` y `hour12: false`.

---

## 6. Modelo de datos

```text
perfiles ──1:1── alumnos ──1:N── inscripciones_servicios ──N:1── servicios_escolares
   │ legajo_nro        │ estado                │ estado                 │ tipo, codigo
   │ (único)           │ ACTIVO/INACTIVO       │ ACTIVA/CANCELADA       │ COMEDOR/TRANSPORTE
```

### `public.servicios_escolares`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()`; el comedor se siembra con un literal fijo y reproducible |
| `tipo` | `tipo_servicio_escolar` | `COMEDOR` \| `TRANSPORTE` |
| `codigo` | `VARCHAR(30)` | Único. Identidad estable; la aplicación resuelve el comedor por `codigo = 'COMEDOR'` |
| `nombre` | `VARCHAR(100)` | Recortado, 1 a 100 caracteres |
| `activo` | `BOOLEAN` | Un servicio inactivo no admite altas nuevas |
| `fecha_creacion`, `fecha_actualizacion` | `TIMESTAMPTZ` | La actualización la sella el trigger |

Semilla reproducible: una única fila
`(e0000000-0000-4000-8000-000000000010, COMEDOR, COMEDOR, 'Comedor escolar', TRUE)`.

### `public.inscripciones_servicios`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID` PK | |
| `alumno_id` | `UUID` → `alumnos(perfil_id)` | `ON DELETE RESTRICT` |
| `servicio_id` | `UUID` → `servicios_escolares(id)` | `ON DELETE RESTRICT` |
| `estado` | `estado_inscripcion_servicio` | `ACTIVA` \| `CANCELADA`; por defecto `ACTIVA` |
| `fecha_inscripcion` | `TIMESTAMPTZ` | Inmutable |
| `fecha_cancelacion` | `TIMESTAMPTZ` | `NULL` mientras está activa; la sella la base |

Restricciones y garantías:

| Invariante | Garantía |
|---|---|
| Una sola inscripción ACTIVA por alumno y servicio | `idx_inscripciones_servicios_una_activa` (único **parcial**) |
| El alumno es el de la sesión | La RPC deriva de `auth.uid()`; no acepta alumno por parámetro |
| Solo un alumno ACTIVO se inscribe | Trigger `BEFORE` + `FOR SHARE` (`P5553`) |
| Solo un perfil con rol ESTUDIANTE | RPC + rol derivado en la base (`42501`) |
| El alumno inscripto tiene legajo | Trigger `BEFORE` (`P5554`) y `P5512` de 008 |
| Solo un servicio activo admite altas | Trigger `BEFORE` + `FOR SHARE` (`P5551`) |
| Alumno, servicio y fecha de alta inmutables | Trigger `BEFORE` (`P5557`) |
| Única transición: ACTIVA → CANCELADA | Trigger `BEFORE` (`P5558`) |
| Coherencia estado / fecha de cancelación | `CHECK inscripciones_servicios_cancelacion_coherente` |
| La baja es posterior al alta | `CHECK inscripciones_servicios_cancelacion_posterior` |
| Historial conservado | Sin `DELETE` y claves foráneas `ON DELETE RESTRICT` |
| Sin borrado físico | Sin `GRANT`, sin política y sin RPC de eliminación |

Índices:

| Índice | Para qué |
|---|---|
| `idx_inscripciones_servicios_una_activa` | Autoridad de la unicidad activa ante concurrencia |
| `idx_inscripciones_servicios_alumno` | Historial propio del alumno y clave foránea hacia `alumnos` |
| `idx_inscripciones_servicios_servicio` | Clave foránea hacia el catálogo y consulta administrativa por estado |
| `idx_servicios_escolares_tipo_activo` | Listado por tipo y filtro de activos |

Ninguna de las dos tablas depende de una secuencia, así que no hay privilegios
de secuencia que puedan quedar expuestos (verificación 23).

### Orden de bloqueos

```text
alumnos  →  perfiles  →  servicios_escolares  →  inscripciones_servicios
```

El trigger toma `FOR SHARE` en ese orden y ninguna operación sube en sentido
contrario, de modo que no hay ciclos.

---

## 7. Migración

`supabase/migrations/013_servicios_escolares.sql` — 881 líneas, **aditiva y
hacia adelante**. No modifica ni renumera 001–012, no borra ni renombra ningún
objeto existente.

Estructura:

1. Precondiciones y conteos de preservación (aborta si la base no es 001–012, o
   si los objetos del comedor ya existen).
2. Tipos enumerados `tipo_servicio_escolar` y `estado_inscripcion_servicio`.
3. `app_private.texto_servicio_valido(TEXT, INTEGER)`, contrato de texto con el
   mismo conjunto de espacios Unicode que `nombre_materia_valido` (012).
4. `public.servicios_escolares` y la semilla del comedor.
5. `public.inscripciones_servicios` con su índice único parcial.
6. Triggers `validar_inscripcion_servicio` y `proteger_identidad_servicio`.
7. Vista `public.inscripciones_servicios_detalle` (`security_invoker = true`).
8. RPC privilegiadas en `app_private`.
9. Envoltorios públicos `SECURITY INVOKER`, incluido `public.rol_actual()`.
10. Privilegios mínimos, RLS y políticas.
11. Autoverificación.

### Códigos SQLSTATE propios

Bloque nuevo `P555x`, sin colisión con 006–012 (que usan `P5501`–`P5540`).

| Código | Significado |
|---|---|
| `P5505` | Se requiere una identidad autenticada (reutilizado) |
| `42501` | El rol de la sesión no está autorizado (reutilizado) |
| `23505` | Ya existe una inscripción activa (índice único parcial) |
| `P5550` | El servicio solicitado no existe |
| `P5551` | El servicio está inactivo |
| `P5552` | La sesión no corresponde a un alumno |
| `P5553` | El alumno no está ACTIVO |
| `P5554` | El alumno no tiene número de legajo |
| `P5555` | La inscripción no existe o no pertenece al alumno de la sesión |
| `P5556` | La inscripción ya está cancelada |
| `P5557` | La operación alteraría la identidad de una inscripción o de un servicio |
| `P5558` | La transición de estado solicitada no es válida |

### Autoverificación incluida en la migración

Aborta la migración si: cambia la cantidad de filas de `inscripciones`,
`actividades`, `alumnos`, `matriculas` o `perfiles`; el comedor no queda
sembrado y activo; se sembró un servicio de transporte; la migración creó
inscripciones; `anon` o `authenticated` conservan `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, `REFERENCES` o `TRIGGER`; `anon` puede leer; falta RLS; existe una
política de escritura; la vista no es `security_invoker`; alguna función
privilegiada no es `SECURITY DEFINER` con `search_path` vacío o es ejecutable
por `anon`; algún envoltorio público no es `SECURITY INVOKER` mínimo; alguna RPC
acepta identidad, rol o legajo del llamador; alguna clave foránea no es
`ON DELETE RESTRICT`; o alguna tabla depende de una secuencia.

### Reversión

La migración es **aditiva y no destructiva**: no borra ni modifica ningún dato
anterior. Revertir el candidato es volver a `origin/main = 6023206` y aplicar
001–012 sobre una base limpia. Sobre una base que ya tenga 013 aplicada, la
reversión manual consiste en eliminar, en este orden y solo si se decide
explícitamente: el trigger y las funciones de 013, los envoltorios públicos, la
vista, `inscripciones_servicios`, `servicios_escolares` y los dos tipos
enumerados. No hay nada que restaurar porque 013 no alteró nada preexistente.
`public.rol_actual()` es el único objeto nuevo del que depende código anterior a
esta historia: ninguno, hoy solo lo usa el comedor.

---

## 8. Matriz de privilegios y RLS

### Privilegios de tabla

| Objeto | `anon` | `authenticated` | Escritura directa |
|---|---|---|---|
| `servicios_escolares` | — | `SELECT` | Ninguna, para ningún rol de aplicación |
| `inscripciones_servicios` | — | `SELECT` | Ninguna, para ningún rol de aplicación |
| `inscripciones_servicios_detalle` (vista) | — | `SELECT` | No aplica |

`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` y `TRIGGER` están
revocados explícitamente para `PUBLIC`, `anon` y `authenticated` en las dos
tablas, y la autoverificación de la migración lo comprueba.

### Políticas RLS

| Tabla | Política | Comando | Predicado |
|---|---|---|---|
| `servicios_escolares` | Los servicios escolares son visibles para las sesiones autenticadas | `SELECT` | `TRUE` (catálogo institucional sin datos personales) |
| `inscripciones_servicios` | El estudiante consulta sus propias inscripciones a servicios | `SELECT` | `alumno_id = app_private.perfil_actual() AND app_private.rol_actual() = 'ESTUDIANTE'` |
| `inscripciones_servicios` | El director consulta todas las inscripciones a servicios | `SELECT` | `public.es_director_actual()` |

No existe ninguna política `INSERT`, `UPDATE`, `DELETE` ni `ALL`. Aunque alguien
concediera el privilegio por error, RLS seguiría rechazando la escritura directa.

El predicado del estudiante exige además conservar el rol `ESTUDIANTE`, igual
que hicieron las políticas académicas en 009: el acceso propio es consecuencia
del rol vigente y no de un vínculo histórico.

### Funciones

| Función | Esquema | Seguridad | `search_path` | `EXECUTE` |
|---|---|---|---|---|
| `inscribir_en_servicio(uuid)` | `app_private` | `DEFINER` | `''` | `authenticated` |
| `cancelar_inscripcion_servicio(uuid)` | `app_private` | `DEFINER` | `''` | `authenticated` |
| `validar_inscripcion_servicio()` | `app_private` | `DEFINER` | `''` | ninguno (trigger) |
| `proteger_identidad_servicio()` | `app_private` | `DEFINER` | `''` | ninguno (trigger) |
| `texto_servicio_valido(text,int)` | `app_private` | `INVOKER` | `''` | `authenticated`, `service_role` |
| `inscribir_en_servicio(uuid)` | `public` | `INVOKER` | `''` | `authenticated` |
| `cancelar_inscripcion_servicio(uuid)` | `public` | `INVOKER` | `''` | `authenticated` |
| `rol_actual()` | `public` | `INVOKER` | `''` | `authenticated` |

`anon` no puede ejecutar ninguna, y no tiene `USAGE` sobre `app_private`.

**Ninguna RPC acepta identidad, rol ni legajo.** Los únicos argumentos de todo
el dominio son `p_servicio_id` y `p_inscripcion_id`, y la verificación 19 lo
comprueba leyendo `pg_proc.proargnames`.

### Ausencia de recursión

`app_private.rol_actual()`, `app_private.perfil_actual()` y
`app_private.es_director()` son `SECURITY DEFINER` sobre `perfiles` y `roles`.
La fuente que decide la autorización **no es modificable por quien se
autoriza**: desde la migración 011, `authenticated` solo tiene `UPDATE` sobre
las columnas `nombre, apellido, dni, direccion, telefono, legajo_nro,
fecha_nacimiento` de `perfiles`, `rol_id` queda fuera, y la única política de
`UPDATE` exige el rol DIRECTOR. Un estudiante no puede cambiarse el rol ni el
legajo propio. La verificación 24 comprueba que esos privilegios no se ampliaron.

`service_role` no interviene en ninguna ruta de la aplicación. Solo lo usa el
setup local de pruebas, aislado y contra una base descartable.

---

## 9. Matriz actor / acción / datos

| Actor | Ver catálogo | Ver inscripción propia | Ver inscripciones ajenas | Inscribirse | Cancelar propia | Cancelar ajena | Eliminar |
|---|---|---|---|---|---|---|---|
| Anónimo | No (sin `GRANT`) | No | No | No (401) | No (401) | No | No (405) |
| ESTUDIANTE activo | Sí | Sí | No (0 filas) | **Sí** | **Sí** | No (404 idéntico a inexistente) | No (405) |
| ESTUDIANTE inactivo | Sí | Sí | No | No (409 `P5553`) | No aplica | No | No |
| ESTUDIANTE sin legajo académico | Sí | — | No | No (409 `P5552`) | No | No | No |
| DIRECTOR | Sí | No aplica | **Sí (listado completo)** | No (403 / `42501`) | No | No (403 / `42501`) | No |
| DOCENTE | Sí | No aplica | No (0 filas) | No (403) | No | No (403) | No |
| PADRE | Sí | No aplica | No (0 filas) | No (403) | No | No (403) | No |
| PERSONAL | Sí | No aplica | No (0 filas) | No (403) | No | No (403) | No |
| Cuenta sin perfil | Sí | No aplica | No (0 filas) | No (403) | No | No (403) | No |

La lectura del catálogo por DOCENTE, PADRE, PERSONAL y cuentas sin perfil es la
única lectura nueva de la historia, y es deliberada (decisión **D5**). No expone
ningún dato personal ni ninguna inscripción.

---

## 10. Matriz de criterios de aceptación

### EPT-10 (criterios de la historia)

| # | Criterio | Cómo se demuestra |
|---|---|---|
| 1 | Un alumno registra una única inscripción activa al comedor | `comedor_rls.sql` OK 2, OK 5; `comedor_concurrencia.mjs` 1; `comedor-auth.spec.ts` «se inscribe, el alta persiste…» |
| 2 | Una segunda inscripción activa es rechazada | `comedor_rls.sql` OK 5 (23505); `comedor-auth.spec.ts` «el duplicado activo lo rechaza PostgreSQL con 409…» y «una pestaña desactualizada…» |
| 3 | El alumno puede cancelar y luego volver a inscribirse | `comedor_rls.sql` OK 6, OK 7; `comedor_concurrencia.mjs` 2; `comedor-auth.spec.ts` «cancela, la baja persiste…» |
| 4 | El estado es visible para el alumno y para el administrador | `comedor_rls.sql` OK 9, OK 16; `comedor-auth.spec.ts` (alumno y DIRECTOR); capturas `real-*-estado-inscripto` y `real-*-consulta-administrativa` |
| 5 | La inscripción queda vinculada al legajo correcto | `comedor_rls.sql` OK 3, OK 4; `comedor-auth.spec.ts` verifica `LEG-PRUEBA-0002` tras recargar |

### Subtareas

| Clave | Entregable | Evidencia específica |
|---|---|---|
| EPT-26 | Tablas de servicios e inscripciones con unicidad por alumno y servicio | `013_servicios_escolares.sql` §4–§5; `comedor_rls.sql` OK 1, OK 5, OK 23 (unicidad parcial) |
| EPT-27 | Alta y baja mediante servicio del lado del servidor | `src/app/api/comedor/inscripciones/**`, `src/services/comedor.service.ts`, RPC de §8–§9 de la migración; `comedor.spec.ts` y `comedor-auth.spec.ts` |
| EPT-28 | Pantalla del alumno y consulta administrativa | `src/app/dashboard/comedor/**`; `comedor-ui.spec.ts` (3 perfiles) y `comedor-auth.spec.ts` |
| EPT-29 | Estructura reutilizable para los cuatro recorridos | Catálogo separado de inscripciones; `tipo_servicio_escolar` con `TRANSPORTE`; autoverificación que impide sembrar recorridos; §12 de este documento |
| EPT-30 | Alta, duplicado, baja, reingreso y legajo probados | `comedor_rls.sql` (31 comprobaciones), `comedor_concurrencia.mjs` (3 carreras), `comedor-auth.spec.ts` (37 casos), `comedor.spec.ts` (8 casos) |
| EPT-31 | Tablero, evidencia y retrospectiva | Este documento, `docs/evidence/EPT-10/` (41 capturas) y los comentarios de Jira de §17 del informe |

---

## 11. Pruebas de base de datos

`supabase/tests/comedor_rls.sql` — 808 líneas, íntegramente dentro de una
transacción que termina en `ROLLBACK`. No deja ningún dato.

```bash
docker exec -i supabase_db_educar-para-transformar \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/comedor_rls.sql
```

Resultado: **exit 0, 31 comprobaciones `OK`**.

| # | Comprobación |
|---|---|
| 1 | Objetos, columnas exactas y semilla reproducible del comedor |
| 2 | Un alumno ACTIVO se inscribe |
| 3 | La inscripción se liga al perfil derivado de `auth.uid()` |
| 4 | La inscripción queda vinculada al legajo correcto, resuelto en la vista |
| 5 | La segunda inscripción activa se rechaza (23505) |
| 6 | La cancelación es lógica y conserva la fila y su fecha de alta |
| 6bis | Una inscripción ya cancelada no se vuelve a cancelar (`P5555`) |
| 7 | El reingreso crea una fila nueva y conserva el ciclo anterior |
| 8 | El alumno no tiene privilegio de `UPDATE` directo sobre sus inscripciones |
| 9 | El alumno lee exactamente sus dos inscripciones |
| 10 | Un estudiante no lee ninguna inscripción ajena, ni en la tabla ni en la vista |
| 11 | Cancelar una inscripción ajena responde igual que una inexistente (`P5555`) |
| 11bis | La unicidad es por alumno y servicio, no global |
| 12 | Un alumno INACTIVO no puede inscribirse (`P5553`) y no deja filas |
| 13 | DOCENTE, PADRE, PERSONAL y una cuenta sin perfil no inscriben ni cancelan (`42501`) |
| 14 | Ninguno de esos actores lee inscripciones ajenas |
| 15 | El catálogo institucional sí es legible por cualquier sesión autenticada |
| 16 | El DIRECTOR consulta el listado con identificación, legajo y estado |
| 17 | El DIRECTOR no inscribe ni cancela en nombre del alumno (`42501`) |
| 18 | `anon` no lee ni escribe ningún objeto del comedor |
| 19 | Las RPC solo aceptan servicio o inscripción; la identidad la deriva la base |
| 19bis | No hay privilegio de `INSERT` directo sobre `inscripciones_servicios` |
| 20 | Un perfil sin fila en `alumnos` no puede inscribirse (`P5552`) |
| 20bis | Una inscripción nueva solo nace `ACTIVA` (`P5558`) |
| 20ter | Alumno, servicio y fecha de alta son inmutables (`P5557`) |
| 20quater | Una inscripción cancelada no se reactiva (`P5558`) |
| 21 | Un servicio inactivo no admite altas y no atrapa a quien ya estaba inscripto (`P5551`) |
| 21bis | Un servicio con inscripciones no cambia de tipo ni de código (`P5557`) |
| 22 | Ningún rol de aplicación puede borrar ni vaciar; no existe RPC de eliminación |
| 23 | RLS activo, grants mínimos, vista `security_invoker`, funciones correctas, FK restrictivas, sin secuencias y unicidad parcial |
| 24 | `public.inscripciones`, materias, actividades y el modelo académico conservan filas y privilegios |

---

## 12. Prueba de concurrencia

`supabase/tests/comedor_concurrencia.mjs` — usa **dos procesos `psql`
independientes** contra el contenedor local, no dos promesas del mismo proceso.
La coordinación es determinista con `pg_blocking_pids`, nunca por tiempo.

```bash
node supabase/tests/comedor_concurrencia.mjs
```

Resultado: **exit 0**.

| # | Carrera | Resultado demostrado |
|---|---|---|
| 1 | Dos altas simultáneas del mismo alumno y servicio | Exactamente **una** inscripción activa y **una** fila en total; la perdedora recibe `23505` |
| 2 | Cancelación y reingreso simultáneos | Una sola activa y **dos** filas: el ciclo anterior se conserva |
| 3 | Alta de un alumno INACTIVO compitiendo con otra transacción | Rechazo `P5553` y **cero** filas |

El fixture se crea y se limpia en una única transacción. Es obligatorio: la
invariante académica de 008 se comprueba con triggers diferidos que miran los
dos lados de la relación, de modo que borrar las matrículas en una transacción
propia dejaría, al confirmarla, un alumno ACTIVO sin matrícula vigente y la
limpieza fallaría por la misma regla que protege los datos reales.

---

## 13. Pruebas de servidor y navegador

### `tests/comedor.spec.ts` — frontera HTTP sin sesión (8 casos, exit 0)

| Caso | Esperado |
|---|---|
| `POST /api/comedor/inscripciones` sin sesión | 401, mensaje de dominio |
| `POST` con cuerpo inválido sin sesión | 401 (autoriza **antes** de validar) |
| `POST` con JSON malformado sin sesión | 401 (autoriza antes de leer el cuerpo) |
| `PATCH /api/comedor/inscripciones/:id` sin sesión | 401 |
| `PATCH` con identificador y acción inválidos | 401 |
| `DELETE` sobre colección y elemento | **405** |
| `GET` sobre colección y elemento | 405 (no hay lectura anónima) |
| `/dashboard/comedor` sin sesión | Redirige a `/login` |

Todas las respuestas se comprueban contra una lista de filtraciones prohibidas:
claves, nombres de tablas, SQL, `pg_*`, `SQLSTATE` y los doce códigos del
dominio. Ninguna aparece.

### `tests/comedor-auth.spec.ts` — sesiones reales (37 casos, exit 0)

Sin mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el control de
rol del servidor, los envoltorios RPC y PostgreSQL.

| Actor | Casos |
|---|---|
| ESTUDIANTE | Alta que persiste tras recargar con el legajo correcto; duplicado real desde PostgreSQL (409); cancelación persistente y reingreso; Escape en el diálogo sin cancelar nada; pestaña desactualizada que recibe el duplicado real y reconcilia el estado; pantalla usable a 375 px; imposibilidad de enviar `alumno_id`, `perfil_id` o `legajo_nro`; servicio inexistente (404); `DELETE` → 405 |
| ESTUDIANTE INACTIVO | La pantalla explica el motivo y deshabilita el botón; la API responde 409 |
| ESTUDIANTE AJENO | No puede cancelar la inscripción de otra persona (404 idéntico a inexistente) y la ajena sigue activa |
| DIRECTOR | Consulta el listado con legajo, estado y fechas, en escritorio y a 375 px; no inscribe ni cancela (403); recibe 403 antes de validar el cuerpo |
| DOCENTE, PADRE, PERSONAL, SIN PERFIL | No ven Comedor en la navegación ni acceden; 403 en alta y baja |
| Cierre de sesión | Botón visible y funcional en escritorio y en móvil; tras cerrar, `/dashboard/comedor` redirige al login |

El caso del duplicado merece énfasis: la segunda alta no la rechaza una
comprobación previa de la aplicación, sino el índice único de PostgreSQL. La
prueba de la pestaña desactualizada lo hace evidente, porque el navegador cree
que la persona no está inscripta.

### `tests/comedor-ui.spec.ts` — presentación (16 casos × 3 perfiles, exit 0)

Corre en escritorio (1280×900), Pixel 5 y iPhone 13. Cubre: estado sin
inscripción, estado inscripto con legajo y fecha, historial de ciclos
cancelados, vacío, confirmación con foco y contención, error de duplicado como
alerta dentro de la región `aria-live`, alumno inactivo, servicio inactivo,
error general, carga, operación por teclado, idioma, tabla en escritorio y
tarjetas en móvil, filtro y búsqueda administrativa, y listado vacío.

Estas pruebas demuestran **presentación**, no persistencia ni autorización.

---

## 14. Responsive, accesibilidad e idioma

| Requisito | Cómo se cumple y dónde se verifica |
|---|---|
| 375 px sin desplazamiento horizontal | Comprobado por `document.documentElement.scrollWidth` en `comedor-ui.spec.ts` (5 casos) y en `comedor-auth.spec.ts` con sesión real |
| Tabla en escritorio, presentación legible en móvil | `InscriptosComedor` renderiza `<table>` con `<caption>` y encabezados de fila y columna a partir de `md`, y tarjetas con `<dl>` por debajo |
| Uso completo por teclado | `comedor-ui.spec.ts` «se opera completamente con el teclado» |
| Foco inicial en diálogos | Declarado en la acción **no destructiva** («Volver sin cancelar»), verificado |
| Contención del foco | Tab y Shift+Tab circulan dentro del diálogo, verificado |
| Escape | Cierra el diálogo sin llamar a la API, verificado |
| Devolución del foco | Vuelve al disparador, verificado con sesión real y en el banco |
| `role="alert"` para errores | Todos los errores del dominio, verificado |
| Región `aria-live` nombrada | `aria-live="polite"` con `aria-label="Estado de tu inscripción al comedor"` y `aria-label="Resumen de inscripciones al comedor"` |
| Etiqueta visible en el nombre accesible | Los botones y el campo de búsqueda usan su texto visible como nombre accesible |
| Botones deshabilitados durante envíos | `disabled` + `aria-busy` mientras dura la operación |
| Ningún control de eliminación física | Verificado con `getByRole('button', { name: /eliminar\|borrar/i })` → 0 |
| Todo el texto en español | Verificado por búsqueda de cadenas en inglés y de `undefined` / `null` en la pantalla |
| Cerrar sesión visible y funcional | Escritorio y móvil, con sesión propia; tras cerrar, la ruta protegida redirige al login |
| Banco visual fuera de producción | `harness_produccion.mjs`: `/pruebas-ui/comedor` responde exactamente igual que una ruta inexistente (misma huella SHA-256) |

El botón **Cerrar sesión** reutiliza el mecanismo existente de
`src/app/dashboard/layout.tsx`; no se duplicó ninguna implementación de logout.
El único cambio en ese archivo es la entrada de navegación del comedor.

---

## 15. Comandos ejecutados y resultados

Todos contra la base local descartable. Ninguno contra producción.

| Comando | Salida | Resultado |
|---|---|---|
| `git fetch origin --prune` | 0 | `origin/main = 6023206` |
| `git status --short --branch` | 0 | Worktree limpio salvo lo de esta historia |
| `git diff --check` | 0 | Sin espacios en blanco conflictivos |
| `npx.cmd supabase db reset --local` | 0 | Migraciones 001–013 aplicadas |
| `npx.cmd supabase migration list --local` | 0 | 001–013, local y remoto alineados |
| `node supabase/tests/tipos-generados.mjs --escribir` | 0 | Tipos regenerados desde la base local |
| `node supabase/tests/tipos-generados.mjs` | 0 | Dos generaciones idénticas; coincide byte a byte |
| `npx.cmd supabase db lint --local` | 0 | **Sin errores de esquema** |
| `npx.cmd supabase db advisors --local` | 0 | Solo `WARN`; ninguno `ERROR` (ver §16) |
| `npx tsc --noEmit --incremental false` | 0 | Sin errores de tipos |
| `npm run lint -- --no-cache` | 1 | **Fallo preexistente** (ver §16) |
| `npx eslint` sobre todos los archivos modificados | 0 | **0 errores nuevos**, 1 advertencia preexistente |
| `npm run build` | 0 | Incluye `/dashboard/comedor` y las dos rutas de API; excluye `/pruebas-ui/*` |
| `psql < supabase/tests/comedor_rls.sql` | 0 | 31 `OK` |
| `psql < supabase/tests/cursos_rls.sql` | 0 | 39 `OK` |
| `psql < supabase/tests/niveles_rls.sql` | 0 | 73 `OK` |
| `psql < supabase/tests/alumnos_academicos_rls.sql` | 0 | 69 `OK` |
| `psql < supabase/tests/reconciliacion_esquema_remoto.sql` | 0 | 42 `OK` |
| `psql < supabase/tests/materias_rls.sql` | 0 | 44 `OK` |
| `psql -U supabase_admin < supabase/tests/usuarios_alta_atomica.sql` | 0 | 23 `OK` |
| `node supabase/tests/comedor_concurrencia.mjs` | 0 | 3 carreras |
| `node supabase/tests/niveles_concurrencia.mjs` | 0 | 4 carreras |
| `node supabase/tests/alumnos_academicos_concurrencia.mjs` | 0 | 6 carreras |
| `node supabase/tests/migracion_009_colisiones.mjs` | 0 | Todas las afirmaciones |
| `node supabase/tests/usuarios_reconciliacion.mjs` | 0 | 180 afirmaciones, 0 incumplidas |
| `node supabase/tests/harness_produccion.mjs` | 0 | Los 4 bancos, incluido comedor, responden como rutas inexistentes |
| `npx playwright test tests/comedor.spec.ts` | 0 | 8 pasaron |
| `npx playwright test tests/comedor-ui.spec.ts` | 0 | 47 pasaron, 1 omitida |
| `node supabase/tests/correr-autenticadas.mjs` (suite completa) | 0 | **472 pasaron**, 1 omitida |

`usuarios_alta_atomica.sql` se ejecuta como `supabase_admin` porque necesita
`SET ROLE supabase_auth_admin`. Es la forma documentada en la evidencia de
EPT-56; como `postgres` aborta por permisos, y eso no es un fallo del candidato.

La omitida es «se opera completamente con el teclado» en el perfil iPhone 13:
WebKit táctil no expone teclado físico ni mueve el foco al pulsar. Es el
comportamiento real de esa plataforma, y la misma prueba sí corre en escritorio
y en Pixel 5.

---

## 16. Fallos preexistentes y regresiones

### Fallos preexistentes, verificados contra `origin/main` antes de tocar código

1. **`npm run lint` falla en la línea base.** Medido sobre el worktree recién
   creado desde `6023206`, antes de cualquier cambio: **15 errores y 109
   advertencias**, repartidos en nueve archivos:
   `src/app/(public)/inscripcion/page.tsx` (2),
   `src/app/(public)/noticias/page.tsx` (1),
   `src/app/(public)/quienes-somos/page.tsx` (2),
   `src/app/dashboard/asistencias/page.tsx` (2),
   `src/app/dashboard/solicitudes/page.tsx` (3),
   `src/app/dashboard/testimonios/page.tsx` (1),
   `src/app/global-error.tsx` (1),
   `src/app/login/page.tsx` (2) y
   `src/context/AuthContext.tsx` (1).
   Ninguno de esos archivos forma parte de esta historia. `npx eslint` sobre
   **todos** los archivos que este candidato crea o modifica devuelve **0
   errores**; la única advertencia es `'perfil' is assigned a value but never
   used` en `src/app/dashboard/layout.tsx:153`, que ya existía y que este
   candidato no introdujo (el único cambio de ese archivo es la entrada de
   navegación).

2. **`npm run build` sin variables de Supabase falla en la línea base.** Sin
   `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, el prerender de
   `/_not-found` aborta con `Missing Supabase env vars`, tanto en `6023206`
   como con el candidato. Con las variables de la instancia local inyectadas,
   la compilación pasa en los dos casos.

3. **`/pruebas-ui/materias` no estaba cubierto por `harness_produccion.mjs`.**
   La lista de bancos solo incluía alumnos, cursos y niveles. Este candidato
   agregó `/pruebas-ui/comedor`, que es su propia superficie. Añadir materias
   corresponde a quien sea dueño de EPT-56 o al pase de consistencia (EPT-66).

### Advisors

`supabase db advisors --local` devuelve únicamente avisos de nivel `WARN`,
ninguno `ERROR`. El único atribuible a 013 es `multiple_permissive_policies` en
`inscripciones_servicios`, por tener dos políticas `SELECT` (estudiante y
director). Es exactamente la misma forma que ya tenían `alumnos` y `matriculas`
desde 008, y es el diseño deliberado: separar los dos permisos es más legible y
más auditable que fundirlos en un predicado con un `OR`. El resto de los avisos
son preexistentes (`perfiles`, `asistencias`, `inscripciones`,
`calcular_porcentaje_asistencia`, `verificar_cupo_actividad`, `postulaciones`,
`solicitudes_inscripcion`).

### Regresiones nuevas

**Ninguna.** La suite autenticada completa pasó de 391 casos en la línea base a
472 con el candidato, sin ningún fallo. Todas las suites SQL, de concurrencia y
de reconciliación anteriores siguen en verde con exactamente el mismo número de
comprobaciones.

Un caso preexistente de `usuarios-auth.spec.ts` («crea un estudiante sin tutor y
persiste perfil, legajo académico y cuenta») apareció como `flaky` en una
corrida completa: falló en el primer intento y pasó en el reintento. Se lo
ejecutó tres veces aisladamente después, y pasó las tres. Es latencia de
compilación del servidor de desarrollo bajo carga, no una regresión.

### Defecto real encontrado y corregido durante esta historia

El formateo de fechas rompía la hidratación de React (ver decisión **D8**). No
era un artefacto de las pruebas: en producción habría mostrado horas distintas
según el dispositivo y habría descartado el árbol hidratado en cada carga. Se
corrigió con `timeZone` explícito y formato de 24 horas.

---

## 17. Archivos modificados

### Nuevos

| Archivo | Líneas | Qué es |
|---|---|---|
| `supabase/migrations/013_servicios_escolares.sql` | 881 | Persistencia, invariantes, RPC, RLS y privilegios |
| `supabase/tests/comedor_rls.sql` | 808 | 31 comprobaciones dentro de una transacción con `ROLLBACK` |
| `supabase/tests/comedor_concurrencia.mjs` | 270 | Tres carreras con dos conexiones PostgreSQL reales |
| `src/services/comedor.service.ts` | 307 | Lecturas y escrituras ligadas a la sesión; traducción estable de SQLSTATE |
| `src/services/comedor.client.ts` | 50 | Cliente del navegador para la frontera HTTP |
| `src/app/api/comedor/inscripciones/route.ts` | 65 | `POST` del alta; sin `DELETE` |
| `src/app/api/comedor/inscripciones/[id]/route.ts` | 75 | `PATCH` de la baja lógica; sin `DELETE` |
| `src/app/dashboard/comedor/page.tsx` | 167 | Ruta única que atiende a los dos actores |
| `src/app/dashboard/comedor/loading.tsx` | 34 | Estado de carga anunciado |
| `src/app/dashboard/comedor/error.tsx` | 37 | Recuperación ante fallo inesperado |
| `src/app/dashboard/comedor/_components/MiComedor.tsx` | 340 | Pantalla del alumno |
| `src/app/dashboard/comedor/_components/InscriptosComedor.tsx` | 275 | Consulta administrativa, solo lectura |
| `src/components/ui/Dialogo.tsx` | 125 | Diálogo accesible compartido |
| `src/app/pruebas-ui/comedor/page.banco.tsx` | 149 | Banco visual determinista, excluido de producción |
| `tests/comedor.spec.ts` | 122 | Frontera HTTP sin sesión |
| `tests/comedor-auth.spec.ts` | 672 | Sesiones reales por actor |
| `tests/comedor-ui.spec.ts` | 335 | Presentación en tres perfiles |
| `docs/evidence/EPT-10.md` | — | Este documento |
| `docs/evidence/EPT-10/` | 41 imágenes | Capturas |

### Modificados

| Archivo | Cambio | Diff |
|---|---|---|
| `src/lib/validations.ts` | Esquemas Zod del comedor y `primerErrorComedor` | +56 |
| `src/services/autorizacion.ts` | `requerirRol` y `requerirSesionConRol` | +100 |
| `src/types/database.types.ts` | Tablas, vista y funciones nuevas; nota de reconciliación | +99 −1 |
| `src/types/database.generated.ts` | Regenerado desde la base local | +163 |
| `src/app/dashboard/layout.tsx` | Entrada «Comedor» para DIRECTOR y ESTUDIANTE | +2 −1 |
| `playwright.config.ts` | Registra las suites del comedor y el proyecto del estudiante inactivo | +17 −5 |
| `tests/auth.setup.ts` | Identidades `ESTUDIANTE INACTIVO` y `ESTUDIANTE CIERRE`; limpieza de `inscripciones_servicios` | +52 −2 |
| `supabase/tests/harness_produccion.mjs` | Agrega `/pruebas-ui/comedor` a los bancos verificados | +6 −1 |

Ningún archivo de migración 001–012 fue tocado.

---

## 18. Capturas

Viven en `docs/evidence/EPT-10/`. El prefijo dice **qué prueba cada una**, y la
distinción es deliberada.

### `real-*` — sesión real contra la base local

Producidas por `tests/comedor-auth.spec.ts` con `EPT_CAPTURAS=1`, con cookies de
Supabase reales y datos que pasaron por PostgreSQL.

**Prueban:** que el flujo funciona de extremo a extremo con autorización real,
persistencia real y las reglas de la base aplicadas.
**No prueban:** estados que el sistema no produce por sí solo, como un error de
red genérico.

| Captura | Qué documenta |
|---|---|
| `real-escritorio-sin-inscripcion.png`, `real-movil-sin-inscripcion.png` | Estado no inscripto |
| `real-escritorio-inscripcion-exitosa.png` | Confirmación inmediata del alta |
| `real-escritorio-estado-inscripto.png`, `real-movil-estado-inscripto.png` | Estado inscripto con legajo y fecha, **tras recargar** |
| `real-escritorio-confirmacion-cancelacion.png`, `real-movil-confirmacion-cancelacion.png` | Diálogo de confirmación |
| `real-escritorio-cancelacion-exitosa.png`, `real-movil-cancelacion-exitosa.png` | Baja confirmada |
| `real-escritorio-error-duplicado.png` | **Duplicado real rechazado por PostgreSQL** desde una pestaña desactualizada |
| `real-escritorio-reingreso.png` | Reingreso después de cancelar |
| `real-escritorio-alumno-inactivo.png`, `real-movil-alumno-inactivo.png` | Alumno con legajo INACTIVO |
| `real-escritorio-consulta-administrativa.png`, `real-movil-consulta-administrativa.png` | Consulta del DIRECTOR |
| `real-escritorio-cerrar-sesion-visible.png`, `real-movil-cerrar-sesion-visible.png` | Botón «Cerrar sesión» visible |

### `fixture-*` — estados sintéticos del banco visual

Producidas por `tests/comedor-ui.spec.ts` sobre `/pruebas-ui/comedor`, con datos
inventados y sin base de datos.

**Prueban:** presentación, accesibilidad, idioma y comportamiento responsive de
cada estado, incluidos los que son difíciles de provocar a demanda.
**No prueban:** ninguna regla de persistencia, de autorización ni de unicidad.
Las personas y los legajos que aparecen (`LEG-BANCO-*`) son ficticios.

Cubren, en escritorio y móvil: sin inscripción, estado inscripto, historial,
vacío, confirmación de cancelación, error de duplicado, error general, carga,
alumno inactivo, consulta administrativa, su filtro y su listado vacío.

### Nota sobre las capturas de otras historias

Agregar «Comedor» a la navegación cambia la barra lateral que aparece en las
capturas de EPT-8, EPT-9, EPT-55 y EPT-56. Esas imágenes **no se regeneraron**:
documentan sus historias en su momento y actualizarlas es trabajo del pase de
consistencia (EPT-66), no de este candidato. Se restauraron a su versión de
`origin/main` para que el diff no tenga ruido.

---

## 19. Privacidad y seguridad

- **Ningún secreto en el árbol ni en las capturas.** `SUPABASE_SERVICE_ROLE_KEY`
  no aparece en ningún archivo del candidato. Las credenciales locales se leen
  de `supabase status -o env` y se inyectan en el proceso hijo; nada se escribe
  en disco.
- **`service_role` nunca interviene en la aplicación.** Solo lo usa el setup
  local de pruebas, que además **se niega a correr** si la URL de Supabase no es
  de bucle local.
- **Ningún detalle técnico llega al navegador.** Las respuestas se comprueban
  contra una lista que incluye claves, nombres de tabla, SQL, `pg_*`,
  `SQLSTATE` y los doce códigos del dominio.
- **Una inscripción ajena y una inexistente son indistinguibles.** Las dos
  devuelven 404 con el mismo texto, de modo que no se puede inferir la
  existencia de la inscripción de otra persona.
- **La pantalla no es la frontera.** Ocultar «Comedor» del menú es presentación;
  quien llegue igual recibe cero filas por RLS y 403 de la API.
- **Datos de prueba sintéticos.** Correos en el dominio reservado `@ept.local`,
  DNI del rango 99.9xx.xxx y legajos `LEG-PRUEBA-*` / `LEG-BANCO-*`. Ninguno
  corresponde a una persona real.
- **El banco visual no existe en producción**, verificado sobre la aplicación
  compilada comparando la respuesta con la de una ruta que nunca existió.

---

## 20. Ausencia de eliminación física

| Capa | Comprobación |
|---|---|
| Privilegios | `DELETE` y `TRUNCATE` revocados para `PUBLIC`, `anon` y `authenticated` en las dos tablas (autoverificación de la migración y comprobación 22) |
| Políticas | No existe ninguna política `DELETE` ni `ALL` (comprobación 22) |
| RPC | No existe ninguna función cuyo nombre insinúe eliminación, verificado por consulta a `pg_proc` (comprobación 22) |
| Claves foráneas | Las dos son `ON DELETE RESTRICT`: el historial no desaparece por el borrado de una fila relacionada (comprobaciones 23 y autoverificación) |
| API | Ninguna ruta declara `DELETE`; Next responde **405** (`comedor.spec.ts` y `comedor-auth.spec.ts`) |
| Interfaz | No hay ningún control cuyo nombre accesible contenga «eliminar» o «borrar» (`comedor-ui.spec.ts`) |
| Dominio | Cancelar conserva la fila; el reingreso crea una nueva; una cancelada no se reactiva (comprobaciones 6, 7 y 20quater) |

Los `DELETE` que existen en el arnés de pruebas y en el fixture de concurrencia
los ejecuta el **propietario de las tablas** contra una base descartable. No
representan ninguna operación disponible en la aplicación.

---

## 21. Riesgos y trabajo habilitado

### Riesgos abiertos

| Riesgo | Mitigación actual | Quién lo cierra |
|---|---|---|
| El catálogo de servicios no tiene administración: hoy solo la migración lo escribe | Suficiente para EPT-10, que solo necesita el comedor sembrado | EPT-60 necesitará decidir cómo se administran los servicios |
| Tres copias del diálogo accesible (niveles, materias y la compartida) | La nueva es la compartida; las anteriores no se tocaron para no arriesgar sus pruebas | EPT-66 |
| Las capturas de EPT-8, EPT-9, EPT-55 y EPT-56 no muestran la entrada «Comedor» | Documentado explícitamente en §18 | EPT-66 |
| `npm run lint` sigue rojo por 15 errores preexistentes | Ninguno en archivos de esta historia; verificado con ESLint focalizado | EPT-66 / EPT-67 |
| `/pruebas-ui/materias` no está en el arnés de producción | El de comedor sí se agregó | EPT-56 o EPT-66 |

### Trabajo que esta historia habilita

**EPT-60 (transporte)** puede construirse sin tocar el modelo:

1. Agregar filas a `servicios_escolares` con `tipo = 'TRANSPORTE'` y un `codigo`
   propio por recorrido, una vez que DG-03 defina cuáles son los cuatro,
   sus paradas, su dirección y su cobertura.
2. Reutilizar `inscripciones_servicios` tal cual está: la unicidad ya es **por
   alumno y servicio**, de modo que un alumno podrá tener a la vez una
   inscripción activa al comedor y una a un recorrido, y no dos al mismo
   recorrido.
3. Reutilizar `public.inscribir_en_servicio` y
   `public.cancelar_inscripcion_servicio` sin cambios: reciben el servicio, no
   el tipo.
4. Reutilizar la vista `inscripciones_servicios_detalle`, que ya expone
   `servicio_tipo` y `servicio_codigo`.
5. Decidir si el transporte necesita atributos propios (parada, sentido,
   horario). Si los necesita, corresponden a una tabla de extensión de
   `servicios_escolares` o de `inscripciones_servicios`, **no** a columnas
   nuevas con sentido solo para transporte.

Esta historia **no** ejecutó el punto 1 y no inventó ningún recorrido.

---

## 22. Retrospectiva

**Lo que salió bien.** Auditar primero `public.inscripciones` fue lo que evitó
el error grande. Era tentador reutilizarla «para no crear tablas»; su unicidad
total habría fundido los ciclos de alta y baja en una sola fila y habría
incumplido el criterio 3 de la historia de una forma difícil de detectar después.
La decisión de separar catálogo e inscripción, además, es exactamente lo que
deja EPT-29 resuelto sin inventar nada de transporte.

**Lo que costó tiempo.** La hidratación de React. El síntoma era una prueba que
fallaba de forma intermitente en móvil; la causa real era que Node y el
navegador formatean la misma fecha con caracteres de espacio distintos, algo
invisible en pantalla. Perseguir el síntoma habría llevado a relajar la
aserción; perseguir la causa encontró un defecto que habría llegado a
producción.

**Lo que hay que recordar.** Limpiar datos académicos exige una sola
transacción, porque la invariante de 008 se comprueba en triggers diferidos que
miran los dos lados de la relación. La prueba de concurrencia falló por esto
hasta que la limpieza se envolvió en `BEGIN … COMMIT`.

**Qué haría distinto.** Las aserciones sobre `role="alert"` y sobre textos
compartidos entre la tabla y las tarjetas se escribieron demasiado amplias y
chocaron con elementos del framework y con la doble presentación. Acotar desde
el principio al landmark principal y a la presentación visible habría ahorrado
tres iteraciones.
