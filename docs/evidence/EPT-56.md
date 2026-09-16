# EPT-56 — RF2 Administrar materias: evidencia de implementación

## 1. Resumen ejecutivo

EPT-56 entrega la administración completa de materias sobre la base existente, sin
inventar un catálogo inicial y sin tocar deportes ni talleres.

Una materia es una fila de `public.actividades` con `tipo = 'CURRICULAR'`. La
migración aditiva `012_administracion_materias.sql` le agrega estado lógico,
identidad por nombre normalizado y una relación muchos-a-muchos con cursos que
admite un profesor responsable con rol real DOCENTE. Todas las escrituras pasan
por RPC ligadas a `auth.uid()` que verifican el rol DIRECTOR dentro de
PostgreSQL; no existe ninguna superficie de eliminación en la base, en la API ni
en la interfaz.

La pantalla `/dashboard/materias` permite crear, consultar, renombrar, inactivar
y reactivar materias, verlas relacionadas con sus cursos, asignarlas a un curso
activo y cambiar el profesor responsable, con estados de carga, vacío y error,
diálogos accesibles y todo el contenido en español.

Como trabajo complementario se auditó el botón **Cerrar sesión** del panel. La
auditoría encontró dos defectos reales, ambos corregidos y probados: el panel
lateral no tenía desplazamiento y dejaba el botón fuera de la ventana, y la
guarda de sesión del layout competía con el cierre deliberado.

Resultado: 296 comprobaciones SQL y 391 pruebas de Playwright en verde, sin
regresiones en Cursos, Niveles, Alumnos, Usuarios ni Reconciliación.

## 2. Alcance exacto

Incluido:

- Persistencia y migración `012` sobre `actividades` y la nueva
  `public.materias_cursos`.
- Integridad, unicidad normalizada, baja lógica y conservación del historial.
- Seguridad PostgreSQL: privilegios mínimos, RLS, RPC privilegiadas en
  `app_private` y envoltorios públicos `SECURITY INVOKER`.
- Autorización de servidor y frontera HTTP.
- Interfaz administrativa responsive y accesible.
- Pruebas de base, de servidor y de navegador con sesiones reales.
- Auditoría y corrección del cierre de sesión del panel.

Excluido por contrato: horarios (EPT-57), administración de profesores
(EPT-58), roles y permisos (EPT-59), deportes, comedor, transporte, reportes,
QR, semillas inventadas de materias y cualquier eliminación física.

## 3. Estado Jira

| Elemento | Valor |
| --- | --- |
| Clave | EPT-56 — RF2 Administrar materias |
| Estado al iniciar y al cerrar esta sesión | En curso |
| Tipo | Tarea complementaria |
| Padre | EPT-2 — Administración académica |
| Responsable | Lucas Gimenez |
| Sprint | Ninguno; trabajo transversal (ventana 07/09 – 16/10) |
| Subtareas | No tiene |
| Comentarios agregados | Inicio y línea base; candidato final |
| Transiciones aplicadas | Ninguna |

No se modificó EPT-57, EPT-58, EPT-59 ni ninguna otra tarea o historia.

## 4. Línea base y aislamiento

| Elemento | Valor verificado |
| --- | --- |
| Fecha y zona | 15/09/2026 19:31, America/Argentina/Buenos_Aires |
| `origin/main` tras `git fetch origin --prune` | `cf8d9edbb1c0ff755cf902c70baa850f432f7d9b` |
| Contenido de ese commit | Merge del PR #5 de recuperación de Supabase |
| Rama creada | `codex/ept-56-admin-materias` (no existía local ni remotamente) |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept56`, creado limpio desde ese commit |
| Migración siguiente | `012`, confirmada como la primera libre |
| Checkout original | No se modificó: `AGENTS.md`, `.agents/`, `.atl/`, `.claude/` y `docs/` quedaron intactos |

La rama se creó sin `upstream` para que ningún `git push` accidental tenga
destino por defecto. Las regresiones SQL se ejecutaron **antes** de cualquier
cambio, sobre `001`–`011`: Cursos 40 OK, Niveles 74 OK, Alumnos 70 OK,
Reconciliación 43 OK y Alta atómica de usuarios 24 OK, sin fallos.

## 5. Decisiones funcionales aplicadas

| # | Decisión aprobada | Dónde se materializa |
| --- | --- | --- |
| 1 | Catálogo único de materias | Vista `public.materias` sobre `actividades` con `tipo = 'CURRICULAR'` |
| 2 | Identidad por nombre normalizado | `idx_materias_nombre_normalizado` parcial sobre `upper(btrim(nombre))` |
| 3 | Materias activas o inactivas | Columna `actividades.activo` |
| 4 y 5 | Baja exclusivamente lógica, nunca física | Sin privilegio, sin política y sin RPC de borrado |
| 6, 7 y 10 | Muchos a muchos sin duplicar la combinación | `materias_cursos` con `UNIQUE (materia_id, curso_id)` |
| 8 y 9 | Profesor responsable opcional con rol real DOCENTE | `profesor_id` nulable validado por trigger contra `perfiles` y `roles` |
| 11 y 13 | La inactivación conserva relaciones e historial | La inactivación no toca `materias_cursos`; las tres claves foráneas son `ON DELETE RESTRICT` |
| 12 | Una materia inactiva no admite nuevas asignaciones | Trigger `validar_asignacion_materia` (SQLSTATE `P5536`) |
| 14 y 15 | Los horarios cuelgan de la asignación, pero son de EPT-57 | `materias_cursos.id` es UUID estable; EPT-56 no crea ningún horario |
| 16, 17 y 18 | Solo se seleccionan perfiles DOCENTE existentes | La interfaz lista perfiles DOCENTE y no edita ni un dato profesional ni un rol |
| 19 | La extensibilidad no se promociona en el frontend | Prueba de idioma que rechaza «catálogo ampliable», «modelo extensible», «CURRICULAR» y «actividad» en el texto visible |
| 20 | Todo lo visible en español | Auditoría automatizada de idioma en las tres suites de interfaz |

### Contradicción encontrada y cómo se resolvió

La migración `011` declara que los duplicados de `actividades` se preservan y su
prueba `reconciliacion_esquema_remoto.sql` (caso 34) **insertaba a propósito dos
materias CURRICULAR duplicadas** para demostrar que 011 no inventa una unicidad.

La decisión aprobada 2 de EPT-56 prohíbe exactamente eso. No es un error de la
prueba ni del producto: es el punto en el que 011 delegó la decisión funcional a
esta historia. Se resolvió sin ocultar nada:

- La migración 012 impone la unicidad **solo** para `CURRICULAR`.
- El caso 34 pasó a usar `TALLER`, que es donde la garantía de 011 sigue
  vigente, con el motivo escrito en el propio archivo.
- Los duplicados históricos de deportes y talleres se conservan sin fusionar.

## 6. Matriz criterio → implementación → prueba → evidencia

| Criterio | Implementación | Prueba | Evidencia |
| --- | --- | --- | --- |
| Crear materia | `public.crear_materia` + `POST /api/materias` | SQL 1; UI «recorta el nombre…»; autenticada «crea, renombra…» | `fixture-escritorio-alta-exitosa.png`, `real-escritorio-listado-autenticado.png` |
| Consultar materias | Vista `materias` + `/dashboard/materias` | SQL 6; UI «lista el catálogo…» | `fixture-escritorio-listado.png` |
| Modificar (renombrar) | `public.renombrar_materia` + `PATCH /api/materias/[id]` | SQL 5bis; UI «renombra desde un diálogo accesible» | `fixture-escritorio-edicion.png` |
| Inactivar y reactivar | `public.cambiar_estado_materia` | SQL 6 y 7; UI «confirma la inactivación…» | `fixture-escritorio-inactivacion.png`, `fixture-escritorio-reactivacion.png` |
| Nombre único normalizado | Índice único parcial | SQL 4, 4bis y 5; autenticada «traduce el duplicado real» | `real-escritorio-duplicado-desde-postgresql.png` |
| Relación con cursos | `materias_cursos` + `POST /api/asignaciones-materias` | SQL 9 y 9bis; UI «asigna una materia…» | `fixture-escritorio-asignar-curso.png`, `fixture-escritorio-asignaciones.png` |
| Relación con profesores | `profesor_id` validado como DOCENTE | SQL 13, 14 y 15; UI «cambia y quita el profesor…» | `fixture-escritorio-profesor-responsable.png`, `real-escritorio-asignacion-con-profesor.png` |
| Sin eliminación física | Sin GRANT, sin política, sin RPC, sin endpoint, sin control | SQL 8; HTTP «no existe eliminación…»; autenticada «ningún control de eliminación» | `real-escritorio-sin-eliminacion.png` |
| Historial conservado | Inactivar no toca asignaciones; FK `RESTRICT` | SQL 17, 17bis y 17cinco | `fixture-escritorio-asignaciones.png` |
| Solo DIRECTOR administra | `requerirDirector` + `app_private.es_director()` | SQL 18–23; autenticada ESTUDIANTE | `real-escritorio-estudiante-restringido.png` |
| Interfaz responsive y accesible | Tarjetas, diálogos con foco contenido | UI en tres perfiles; autenticada a 375 px | `fixture-movil-*.png`, `real-movil-listado-autenticado.png` |
| Cerrar sesión visible y real | Panel lateral con desplazamiento + acción en encabezado móvil | Autenticada «cierra la sesión…» y «encabezado móvil» | `real-escritorio-cerrar-sesion-visible.png`, `real-movil-cerrar-sesion-visible.png`, `real-escritorio-logout-sin-retorno.png` |

## 7. Cambios por archivo

| Archivo | Cambio |
| --- | --- |
| `supabase/migrations/012_administracion_materias.sql` | Nuevo. Estado lógico, contrato de nombre, unicidad normalizada, `materias_cursos`, triggers de integridad, seis RPC privadas con sus envoltorios, dos vistas, privilegios mínimos, RLS y autoverificación |
| `supabase/tests/materias_rls.sql` | Nuevo. 45 comprobaciones dentro de una transacción con `ROLLBACK` |
| `supabase/tests/reconciliacion_esquema_remoto.sql` | Caso 34 pasa de `CURRICULAR` a `TALLER`, con la justificación escrita |
| `src/types/database.generated.ts` | Regenerado desde la base local |
| `src/types/database.types.ts` | Reconciliado a mano: `actividades.activo`, `materias_cursos`, las dos vistas y las seis funciones |
| `src/lib/validations.ts` | Esquemas Zod de materias y asignaciones, recorte canónico y `primerErrorMateria` |
| `src/services/materias.service.ts` | Nuevo. Lecturas por vistas, escrituras por RPC y traducción de SQLSTATE |
| `src/services/materias.client.ts` | Nuevo. Cliente del navegador para el límite HTTP |
| `src/app/api/materias/route.ts` | Nuevo. `POST` |
| `src/app/api/materias/[id]/route.ts` | Nuevo. `PATCH` discriminado |
| `src/app/api/asignaciones-materias/route.ts` | Nuevo. `POST` |
| `src/app/api/asignaciones-materias/[id]/route.ts` | Nuevo. `PATCH` discriminado |
| `src/app/dashboard/materias/page.tsx` | Nueva pantalla protegida en el servidor |
| `src/app/dashboard/materias/loading.tsx` y `error.tsx` | Estados de carga y de error del segmento |
| `src/app/dashboard/materias/_components/GestionMaterias.tsx` | Interfaz administrativa completa |
| `src/app/dashboard/materias/_components/Dialogo.tsx` | Diálogo accesible del segmento |
| `src/app/pruebas-ui/materias/page.banco.tsx` | Banco visual determinista, solo fuera de producción |
| `src/app/dashboard/layout.tsx` | Ítem «Materias» solo para DIRECTOR; panel lateral con desplazamiento; cierre de sesión en el encabezado móvil, sin disparos dobles y con navegación segura |
| `tests/materias.spec.ts`, `tests/materias-ui.spec.ts`, `tests/materias-auth.spec.ts` | Nuevas suites |
| `tests/auth.setup.ts` | Limpieza de asignaciones y materias de prueba; identidad exclusiva para el cierre de sesión |
| `playwright.config.ts` | Registra las suites nuevas en los proyectos autenticados y multiperfil |
| `docs/evidence/EPT-56.md` y `docs/evidence/EPT-56/` | Esta documentación y 48 capturas |

## 8. Modelo de datos, relaciones y cardinalidad

```
niveles 1 ── * cursos 1 ── * materias_cursos * ── 1 actividades (tipo = 'CURRICULAR')
                                  *
                                  │ 0..1
                                  └── perfiles (rol DOCENTE al momento de asignar)
```

- Una materia se relaciona con muchos cursos; un curso, con muchas materias.
- Cada par Curso–Materia existe **una sola vez**, activo o histórico.
- Cada asignación tiene cero o un profesor responsable.
- `materias_cursos.id` es UUID: es el ancla estable que EPT-57 usará para
  horarios.

Tabla `public.materias_cursos`:

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | `uuid` | Clave primaria, `gen_random_uuid()` |
| `materia_id` | `integer` | `REFERENCES actividades(id) ON DELETE RESTRICT`, debe ser CURRICULAR |
| `curso_id` | `uuid` | `REFERENCES cursos(id) ON DELETE RESTRICT` |
| `profesor_id` | `uuid` nulable | `REFERENCES perfiles(id) ON DELETE RESTRICT`, rol DOCENTE al asignar |
| `activo` | `boolean` | Baja lógica de la asignación |
| `fecha_creacion` | `timestamptz` | Inmutable: el trigger la restaura en cada UPDATE |
| `fecha_actualizacion` | `timestamptz` | La actualiza el trigger |

## 9. Migración 012, esquema y privilegios

Comportamiento aditivo comprobado:

- Conserva todas las filas; no fusiona ni elimina ninguna actividad.
- Falla de forma clara y sin dejar esquema parcial si encuentra materias
  CURRICULAR duplicadas por nombre normalizado o con nombre vacío o con espacios
  laterales.
- Es reproducible tanto en base limpia (`001`–`012`) como aplicada sobre una base
  ya en `011` con datos.
- Usa `pg_catalog.gen_random_uuid()`; no invoca `uuid_generate_v4()` sin
  calificar, de modo que no depende de dónde esté instalada `uuid-ossp`.
- No usa `service_role` en ninguna ruta de producción.

### Prueba real de la precondición

| Escenario sobre la base en `011` | Resultado |
| --- | --- |
| Dos materias CURRICULAR con el mismo nombre normalizado (`Música` y ` música `) | `supabase migration up` falla con «existen materias CURRICULAR duplicadas por nombre normalizado (ids: 11, 12)»; `actividades.activo` no existe y `materias_cursos` no se crea |
| Una materia con espacios laterales (` Coro `) | Falla con «existen materias CURRICULAR con nombre vacío o con espacios en blanco laterales (ids: 12)» |
| Datos corregidos a mano | La migración aplica; 4 materias, 6 deportes y 2 talleres, todos activos |

### Privilegios resultantes

| Objeto | `anon` | `authenticated` | Escrituras |
| --- | --- | --- | --- |
| `public.actividades` | SELECT | SELECT + UPDATE solo de `cupo_maximo` | Solo por RPC; sin INSERT, DELETE ni TRUNCATE |
| `public.materias_cursos` | Ninguno | SELECT (RLS: solo DIRECTOR) | Solo por RPC |
| Vistas `materias` y `materias_cursos_detalle` | Ninguno | SELECT, `security_invoker` | — |
| `public.actividades_id_seq` | Ninguno | Ninguno | — |
| Funciones `app_private.*` de materias | Ninguno | EXECUTE solo de las seis operaciones | `SECURITY DEFINER`, `search_path` vacío |
| Envoltorios `public.*` de materias | Ninguno | EXECUTE | `SECURITY INVOKER`, `search_path` vacío |

`app_private.nombre_materia_valido` es la única función privada que recibe
EXECUTE para `authenticated`, y por una razón demostrada: PostgreSQL evalúa el
CHECK de `actividades` en cada UPDATE de la fila, incluido el de `cupo_maximo`
que 011 conserva para DIRECTOR y DOCENTE. Verificado revocando ese permiso
dentro de una transacción: `ERROR: permission denied for function
nombre_materia_valido`. La prueba SQL 27bis cubre la regresión.

### Códigos SQLSTATE propios

`P5530` nombre inválido · `P5531` materia inexistente · `P5532` curso
inexistente · `P5533` profesor inexistente · `P5534` asignación inexistente ·
`P5535` perfil sin rol DOCENTE · `P5536` materia inactiva · `P5537` curso
inactivo · `P5538` asignación inactiva · `P5539` estado inválido · `P5540`
identidad protegida. Reutiliza `P5505` (sin identidad), `42501` (rol no
autorizado) y `23505` (duplicado).

## 10. Matriz de autorización

| Actor | Ve la opción | Abre `/dashboard/materias` | API de escritura | RPC | Escritura directa |
| --- | --- | --- | --- | --- | --- |
| DIRECTOR | Sí | Sí | 200/201 | Permitidas | Denegada (no existe) |
| DOCENTE | No | Acceso restringido | 403 | `42501` | Denegada |
| ESTUDIANTE | No | Acceso restringido | 403 | `42501` | Denegada |
| PADRE | No | Acceso restringido | 403 | `42501` | Denegada |
| PERSONAL | No | Acceso restringido | 403 | `42501` | Denegada |
| Autenticado sin perfil | No | Acceso restringido | 403 | `42501` | Denegada |
| Anónimo | No | Redirige a la pantalla de acceso | 401 | `42501` | Denegada |

Las tres capas se demuestran por separado: navegación e interfaz (Playwright),
servidor (códigos HTTP con sesión real) y PostgreSQL (RLS, ACL y RPC en
`materias_rls.sql`). Ocultar un botón nunca se cuenta como autorización: cada
actor no autorizado también recibe `42501` al invocar la RPC directamente y al
intentar escribir en las tablas.

DOCENTE no obtiene ningún permiso nuevo: conserva exactamente la lectura y la
gestión de cupos que ya tenía desde 011.

## 11. Servicios, validación y API

| Situación | Código | Mensaje visible |
| --- | --- | --- |
| Sin sesión | 401 | Necesitás iniciar sesión para continuar. |
| Rol no autorizado | 403 | Solo el director puede administrar las materias. |
| Nombre vacío o de más de 100 caracteres | 400 | El nombre de la materia es requerido / no puede superar los 100 caracteres |
| Nombre duplicado normalizado | 409 | Ya existe una materia con ese nombre. |
| Materia inexistente | 404 | La materia solicitada no existe. |
| Curso inexistente | 404 | El curso seleccionado no existe. |
| Profesor inexistente | 404 | El profesor seleccionado no existe. |
| Perfil sin rol DOCENTE | 409 | La persona seleccionada no tiene el rol DOCENTE. |
| Asignación duplicada | 409 | Esa materia ya está asignada a ese curso. |
| Materia inactiva | 409 | La materia está inactiva y no admite nuevas asignaciones. |
| Curso inactivo | 409 | El curso está inactivo y no admite nuevas asignaciones. |
| Asignación inactiva al cambiar profesor | 409 | La asignación está inactiva. Reactivala antes de cambiar el profesor responsable. |
| Error no previsto | 500 | No pudimos completar la operación. Volvé a intentarlo en unos minutos. |
| Método no definido | 405 | — (respuesta de Next.js) |

La autorización precede a la validación: una petición sin sesión o con rol
equivocado recibe 401 o 403 aunque el cuerpo sea inválido o esté malformado.
Ninguna respuesta incluye SQLSTATE, nombres de restricciones, fragmentos de SQL,
identificadores internos de PostgreSQL ni referencias a `service_role`; hay una
aserción automatizada de no filtración en las tres suites.

El nombre se recorta en la API con el mismo conjunto de espacios en blanco
Unicode que reconoce PostgreSQL —incluido `U+0085`, que `String.prototype.trim()`
no quita—, de modo que la validación HTTP y la de la base nunca se contradicen.

## 12. Pruebas de base de datos

`supabase/tests/materias_rls.sql`, dentro de una transacción con `ROLLBACK`, que
además restaura la secuencia de `actividades`. Resultado: **45 OK, 0 fallos**.

| # | Comprobación obligatoria | Resultado |
| --- | --- | --- |
| 1 | Creación válida por DIRECTOR | OK |
| 2 | Nombre vacío rechazado (más nulo y de 101 caracteres) | OK |
| 3 | Espacios, tabulaciones, saltos y NBSP laterales rechazados por la base | OK |
| 4 | Duplicado por mayúsculas rechazado (incluye vocales acentuadas) | OK |
| 5 | Duplicado por espacios rechazado | OK |
| 6 | Inactivación sin pérdida de fila | OK |
| 7 | Reactivación | OK |
| 8 | Ausencia de DELETE y de RPC de eliminación | OK |
| 9 | Asignación a curso activo, y muchos a muchos real | OK |
| 10 | Curso inexistente rechazado | OK |
| 11 | Curso inactivo rechazado | OK |
| 12 | Asignación duplicada rechazada | OK |
| 13 | Profesor DOCENTE asignado, reemplazado y quitado | OK |
| 14 | Profesor con otro rol rechazado (ESTUDIANTE y DIRECTOR) | OK |
| 15 | Profesor inexistente rechazado | OK |
| 16 | Materia inactiva sin nuevas asignaciones | OK |
| 17 | Relación histórica conservada tras inactivar materia, curso y cambiar el rol del profesor | OK |
| 18 | ESTUDIANTE sin escritura | OK |
| 19 | DOCENTE sin escritura administrativa | OK |
| 20 | PADRE sin escritura | OK |
| 21 | PERSONAL sin escritura | OK |
| 22 | Usuario sin perfil sin escritura | OK |
| 23 | Anónimo sin escritura ni lectura | OK |
| 24 | Grants residuales ausentes, RLS activo y vistas `security_invoker` | OK |
| 25 | Secuencias sin privilegios innecesarios | OK |
| 26 | Funciones privilegiadas con `search_path` seguro y sin parámetros de identidad | OK |
| 27 | Ningún objeto de EPT-56 amplía permisos de deportes ni talleres | OK |
| 28 | Cantidad, contenido y estado de deportes y talleres sin cambios (comparación por huella MD5) | OK |

Casos complementarios: `17cinco` demuestra que, incluso sin pasar por las RPC, la
base impide cambiar la materia o el curso de una asignación, cambiar el tipo de
una materia asignada, insertar nombres sin recortar y borrar una materia con
historial. `27bis` demuestra que DOCENTE conserva la gestión de cupos de 011
sobre materias y deportes.

## 13. Pruebas del servidor y del navegador

| Suite | Alcance | Resultado |
| --- | --- | --- |
| `tests/materias.spec.ts` | Frontera HTTP sin sesión: 401 antes de validar, 405 en DELETE y en GET, redirección del panel | 10 pruebas, en verde |
| `tests/materias-ui.spec.ts` | Interfaz con datos deterministas y API interceptada, en escritorio, Pixel 5 e iPhone 13 | 13 pruebas × 3 perfiles, en verde |
| `tests/materias-auth.spec.ts` | Sesiones reales contra la base local: DIRECTOR, cierre de sesión y ESTUDIANTE | 25 pruebas, en verde |

Cobertura exigida y dónde se cumple: 401, 403, alta válida, edición, duplicado
real de PostgreSQL, inactivación, reactivación, asignación, profesor inválido,
curso inválido, materia inactiva, `DELETE` → 405, traducción segura de errores de
PostgreSQL y ausencia de `service_role` en producción (la clave solo la usa
`tests/auth.setup.ts` contra el stack local, que además rechaza cualquier URL que
no sea de bucle local).

Navegador con sesión real: DIRECTOR ve el menú y abre la pantalla; el alta
persiste tras recargar; renombra; asigna a un curso; elige profesor responsable;
inactiva y reactiva; ve el duplicado que rechaza PostgreSQL; no encuentra ningún
control de eliminación; ESTUDIANTE no ve el menú, recibe «Acceso restringido» y
403 en la API.

## 14. Cierre de sesión

Auditoría del botón existente y correcciones:

| Hallazgo | Estado anterior | Corrección |
| --- | --- | --- |
| Visibilidad en escritorio | El panel lateral no tenía desplazamiento; con el menú completo de DIRECTOR y un ítem más, el bloque de usuario y **Cerrar sesión** quedaban fuera de la ventana a 1280×900, sin forma de alcanzarlos | `flex-1 min-h-0 overflow-y-auto` en la navegación y `shrink-0` en el pie del panel |
| Accesibilidad en móvil | El botón solo existía dentro del menú lateral, detrás del icono de hamburguesa | Acción visible en el encabezado móvil con el mismo manejador |
| Disparos dobles | Nada impedía dos cierres simultáneos | Guarda de reentrada más `disabled` y `aria-busy` en ambos disparadores |
| Estado de progreso | Sin retroalimentación | Texto «Cerrando sesión…» mientras dura la operación |
| Destino posterior | La guarda de sesión del layout competía con el cierre y ganaba: terminaba en la pantalla de acceso con `redirect` de vuelta a la ruta protegida | La guarda no actúa durante un cierre deliberado; el destino lo decide el manejador |
| Volver atrás o recargar | `push` dejaba la ruta protegida en el historial | `replace('/')` más `router.refresh()` |

Verificación con sesión real y cuenta exclusiva: el texto visible es
**Cerrar sesión**, con nombre accesible; la sesión se invalida efectivamente en
Supabase; la navegación termina en el inicio público; volver atrás, recargar y
escribir la URL del panel llevan a la pantalla de acceso y no muestran ninguna
materia.

Ese aislamiento no es decorativo: `signOut()` revoca las sesiones del usuario
(`/auth/v1/logout?scope=global`). Probar el cierre con la directora compartida
dejaba sin sesión a las suites de Cursos, Niveles, Alumnos y Materias que corren
después, lo que se observó durante esta sesión antes de introducir la identidad
dedicada.

## 15. Responsive, accesibilidad e idioma

- Usable a 1280 px y a 375 px, con aserciones automatizadas de ausencia de
  desplazamiento horizontal en listado, formulario, asignaciones y diálogos.
- Perfiles ejecutados: Desktop Chrome, Pixel 5 (Chromium) e iPhone 13 (WebKit).
- Diálogos: foco inicial declarado, contención con Tab y Shift+Tab (16
  movimientos comprobados), cierre con Escape y devolución del foco al
  disparador.
- Región `aria-live="polite"` nombrada «Estado de la administración de materias»;
  errores con `role="alert"` y confirmaciones con `role="status"`.
- Cada acción por fila tiene nombre accesible completo, por ejemplo «Inactivar la
  asignación de Matemática en 1er Grado A».
- Auditoría de idioma automatizada: rechaza palabras en inglés en el texto
  visible y en `aria-label`, `placeholder` y `title`, y también las frases que
  promocionarían la extensibilidad interna del catálogo.
- En WebKit el foco del disparador se ejercita por teclado, porque Safari no
  enfoca un botón al hacer clic; es comportamiento del motor, no del producto.

## 16. Comandos ejecutados y códigos de salida

| Comando | Salida | Resultado |
| --- | --- | --- |
| `git status --short --branch` | 0 | Árbol limpio en `codex/ept-56-admin-materias` |
| `git diff --check` | 0 | Sin espacios en blanco problemáticos |
| `npx.cmd supabase db reset --local --no-seed` | 0 | Aplica `001`–`012` |
| `npx.cmd supabase migration list --local` | 0 | `001`–`012` alineadas |
| `npx.cmd supabase gen types typescript --local` | 0 | Tipos generados |
| `npx.cmd supabase db lint --local --schema public --level error --fail-on error` | 0 | Sin errores de esquema |
| `npx.cmd supabase db advisors --local --type security --level warn --fail-on none` | 0 | 4 avisos, todos preexistentes |
| `npx.cmd supabase db advisors --local --type performance --level warn --fail-on none` | 0 | 7 avisos, todos preexistentes |
| `npx tsc --noEmit --incremental false` | 0 | Sin errores de tipos |
| `npm run lint -- --no-cache` | 1 | 15 errores y 109 advertencias, todos preexistentes |
| `npm run build` | 0 | Compila; `/dashboard/materias` queda dinámica |
| Pruebas SQL (6 archivos) | 0 | 296 OK, 0 fallos |
| `node supabase/tests/correr-autenticadas.mjs` (suite completa) | 0 | 391 pruebas en verde |

El build necesita `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
En este worktree no existe `.env.local` a propósito: el del checkout original
apunta al proyecto remoto y copiarlo sería apuntar la verificación a producción.
Las credenciales se inyectaron desde la instancia local
(`npx supabase status -o env`) solo para el proceso del build.

Ejecución de las pruebas SQL:

```powershell
Get-Content -Raw .\supabase\tests\materias_rls.sql |
  docker exec -i supabase_db_educar-para-transformar `
  psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

| Archivo SQL | Salida | Comprobaciones |
| --- | --- | --- |
| `cursos_rls.sql` | 0 | 40 OK |
| `niveles_rls.sql` | 0 | 74 OK |
| `alumnos_academicos_rls.sql` | 0 | 70 OK |
| `materias_rls.sql` | 0 | 45 OK |
| `reconciliacion_esquema_remoto.sql` | 0 | 43 OK |
| `usuarios_alta_atomica.sql` (como `supabase_admin`) | 0 | 24 OK |

Pruebas de Playwright de EPT-56:

```powershell
npx playwright test tests/materias.spec.ts tests/materias-ui.spec.ts
node supabase/tests/correr-autenticadas.mjs tests/materias-auth.spec.ts
node supabase/tests/correr-autenticadas.mjs
```

Correspondencia con los nombres pedidos: `tests/materias.spec.ts`,
`tests/materias-ui.spec.ts` y `tests/materias-auth.spec.ts` son exactamente los
tres archivos solicitados. `npm run test:e2e` corre sin base local y omite las
suites autenticadas; `correr-autenticadas.mjs` es el envoltorio del repositorio
que inyecta las credenciales locales y habilita esas suites sin escribir
secretos en disco.

## 17. Fallos preexistentes y regresiones

No hay regresiones. Todas las suites existentes pasan con `012` aplicada.

Fallo preexistente demostrado: `npm run lint` termina con código 1 por **15
errores en nueve archivos, ninguno de ellos modificado por esta rama**:
`src/app/(public)/inscripcion/page.tsx`, `src/app/(public)/noticias/page.tsx`,
`src/app/(public)/quienes-somos/page.tsx`,
`src/app/dashboard/asistencias/page.tsx`,
`src/app/dashboard/solicitudes/page.tsx`,
`src/app/dashboard/testimonios/page.tsx`, `src/app/global-error.tsx`,
`src/app/login/page.tsx` y `src/context/AuthContext.tsx`. La comparación se hizo
cruzando el informe JSON de ESLint con `git diff --name-only origin/main..HEAD`.

Ningún archivo nuevo de EPT-56 tiene errores ni advertencias. El único archivo
modificado con una advertencia es `src/app/dashboard/layout.tsx` (`perfil`
asignado y no usado), y es anterior: se comprobó guardando el archivo con
`git stash` y volviendo a ejecutar ESLint sobre la versión de la línea base, que
informa la misma advertencia.

Único cambio de comportamiento deliberado en una prueba existente: el caso 34 de
`reconciliacion_esquema_remoto.sql`, explicado en la sección 5.

## 18. Tipos y asesores de Supabase

- Los tipos se regeneraron con `node supabase/tests/tipos-generados.mjs --escribir`
  y se verificaron con la misma herramienta, que genera **dos veces** y compara:
  ambas salidas coinciden (SHA-256 crudo `a7183472ac244cba…`, normalizado
  `295743940bab78bf…`), y el archivo versionado coincide byte a byte.
- Diferencias introducidas: `actividades.activo`, la tabla `materias_cursos`, las
  vistas `materias` y `materias_cursos_detalle` y las seis funciones de materias.
- Metadatos internos de PostgREST que aparecen en la salida generada y **no** se
  copiaron al contrato manual: las vistas reciben `Insert`/`Update` porque
  PostgREST las considera actualizables, y `inscripciones` gana una relación
  inferida hacia la vista `materias` por compartir la clave de `actividades`.
  Ninguno implica un privilegio real: la prueba SQL 24 comprueba que ni `anon` ni
  `authenticated` tienen escritura sobre esas vistas.
- `src/types/database.types.ts` sigue declarándose explícitamente como escrito a
  mano; no se presenta como generado.
- Asesores: 4 avisos de seguridad y 7 de rendimiento, **todos sobre objetos de
  `001`–`011`** (`calcular_porcentaje_asistencia`, `verificar_cupo_actividad`,
  políticas públicas de postulaciones y solicitudes, y políticas permisivas
  múltiples de perfiles, alumnos, asistencias, matrículas e inscripciones).
  Ningún objeto de EPT-56 genera avisos.

## 19. Seguridad y privacidad

- La lógica privilegiada vive en `app_private`, esquema no expuesto por la Data
  API, con `search_path` vacío y `SECURITY DEFINER`; los envoltorios públicos son
  `SECURITY INVOKER` y vuelven a validar identidad y rol.
- Ninguna RPC acepta usuario, rol ni actor como parámetro: la autorización se
  deriva siempre de `auth.uid()`. Hay una comprobación automatizada que lo exige.
- No se usa `service_role` en ninguna ruta de producción.
- Las respuestas de error no revelan estructura interna de la base.
- La pantalla muestra de un profesor únicamente nombre y apellido; no expone DNI,
  teléfono, dirección ni legajo.
- Las capturas usan exclusivamente identidades sintéticas del arnés local
  (DNI del rango 99.9xx.xxx y dominio reservado `ept.local`); no hay datos de
  personas reales ni credenciales visibles.
- Los mensajes de la migración informan identificadores internos, nunca nombres
  de personas.

## 20. Rollback

- La reversión del código es `git revert` de los cinco commits de la rama, o
  descartar la rama: `main` no fue modificada y no hubo push, PR ni despliegue.
- La migración `012` **no se aplicó a producción**. Mientras no se aplique, el
  límite de reversión es trivial.
- Si en el futuro se aplicara y hubiera que revertirla, la reversión es
  destructiva por definición: eliminar `materias_cursos` borraría las
  asignaciones creadas después. El camino no destructivo es dejar de usar las
  operaciones y, si hiciera falta, inactivar las materias creadas; la información
  se conserva íntegra.
- La migración es idempotente en el sentido de que se niega a aplicarse dos
  veces: aborta si `actividades.activo` ya existe.

## 21. Riesgos y trabajo fuera de alcance

| Riesgo | Efecto | Mitigación |
| --- | --- | --- |
| Producción podría tener materias CURRICULAR con nombres que hoy no se conocen | La migración aborta al aplicarse | Es el comportamiento deseado: exige una decisión funcional explícita. Conviene ejecutar el preflight de duplicados y de espacios laterales antes de aplicar `012` |
| La unicidad sin distinguir mayúsculas usa `upper()` | Depende de la colación de la base | Local y producción usan `en_US.UTF-8`; la prueba 4bis cubre vocales acentuadas. Si alguna vez se migrara a colación `C`, los acentos dejarían de compararse |
| Las materias siguen apareciendo en la pantalla de Actividades y cupos | Una materia nueva se ofrece como actividad inscribible, igual que las dos materias sembradas en `001` | Comportamiento heredado del modelo de `actividades`, no introducido por EPT-56. Queda registrado como próximo incremento |
| `signOut` revoca todas las sesiones del usuario | Cerrar sesión en un dispositivo cierra los demás | Comportamiento del cliente de Supabase; documentado, no modificado, porque cambiar el alcance del cierre excede EPT-56 |
| La evidencia de EPT-55, EPT-8 y EPT-9 muestra un menú sin «Materias» | Las capturas anteriores ya no reflejan el menú actual | Se restauraron a propósito: documentan el momento de su propia entrega. La evidencia actual del menú está en las capturas de EPT-56 |

Trabajo deliberadamente fuera de alcance: horarios y superposiciones (EPT-57),
administración y especialidades de profesores (EPT-58), roles y permisos
(EPT-59), y cualquier refactor general del panel.

## 22. Retrospectiva

Lo que funcionó: ejecutar las regresiones SQL **antes** de tocar nada convirtió
la única incompatibilidad (el caso 34 de la reconciliación) en una decisión
documentada en lugar de una sorpresa; y escribir la prueba de base antes que la
interfaz permitió descubrir los códigos de error que la API tenía que traducir.

Lo que costó tiempo:

- Dos pruebas de cierre de sesión fallaban por causas que no eran del producto:
  `browser.newContext()` hereda las opciones del proyecto, incluida su sesión, de
  modo que la pantalla de acceso redirigía al panel. Encontrarlo exigió leer la
  traza de Playwright.
- Ese mismo camino sí destapó un defecto real y visible del panel lateral sin
  desplazamiento, que estaba a un ítem de menú de distancia de ocurrirle a un
  director real.
- Un byte nulo incrustado en el archivo de pruebas lo convirtió en binario para
  Git y lo volvió irrevisable; se corrigió construyéndolo en tiempo de ejecución.

## 23. Índice de capturas

Con fixture (prueban presentación, sin base de datos), 19 de escritorio y 19 de
móvil: `fixture-escritorio-*.png` y `fixture-movil-*.png`, con los estados
listado, filtro de estado, formulario de alta, validación, envío en curso, alta
exitosa, error por duplicado, edición, asignaciones, asignar curso, profesor
responsable, inactivación, reactivación, diálogo con foco, carga, vacío, sin
cursos activos, error de servidor y éxito.

Con sesión real (prueban autorización y persistencia), 10 archivos
`real-*.png`: listado autenticado de escritorio y de móvil, asignación con
profesor, ciclo completo, duplicado desde PostgreSQL, ausencia de eliminación,
estudiante restringido, **Cerrar sesión** visible en escritorio y en móvil, y
ausencia de retorno al panel después del cierre.

## 24. Reproducción

```powershell
git fetch origin --prune
git worktree add -b codex/ept-56-admin-materias ..\MetodologiaTPI-ept56 origin/main
cd ..\MetodologiaTPI-ept56
npm ci
npx.cmd supabase start
npx.cmd supabase db reset --local --no-seed
Get-Content -Raw .\supabase\tests\materias_rls.sql |
  docker exec -i supabase_db_educar-para-transformar `
  psql -U postgres -d postgres -v ON_ERROR_STOP=1
node supabase/tests/correr-autenticadas.mjs
```

## 25. Próximo incremento recomendado

EPT-57 (horarios) puede apoyarse directamente en `materias_cursos.id`. Antes de
eso conviene resolver, como decisión funcional, si una materia debe seguir
apareciendo entre las actividades inscribibles de estudiantes y familias: hoy lo
hace por herencia del modelo de `actividades`, y esa pregunta pertenece al
producto, no a esta implementación.
