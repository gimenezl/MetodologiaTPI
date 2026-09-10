# EPT-8 — Administrar cursos: evidencia de la historia

La administración de cursos está implementada y **verificada de punta a punta**
sobre la rama `codex/ept-8-admin-courses`, partiendo del commit `801c967` de
`origin/main`: migración aditiva con unicidad normalizada y RLS, límite HTTP que
autoriza al DIRECTOR antes de tocar la base, y la pantalla responsive
`/dashboard/cursos`.

**Estado: lista para revisión independiente.**

Con Docker disponible se pudo ejecutar por fin todo lo que antes estaba
bloqueado: reinicio limpio de la base con la cadena completa de migraciones, la
matriz de RLS y privilegios, la generación de tipos desde el esquema real, los
asesores de seguridad y rendimiento, y el camino autenticado del director en un
navegador contra datos reales.

Lo único que falta es lo que esta sesión no puede hacer por sí misma: la revisión
por otra persona y la integración a `main`.

## Ruta rápida para quien revisa

```bash
supabase start
supabase db reset                       # aplica 001 → 005 desde cero
docker cp supabase/tests/cursos_rls.sql supabase_db_educar-para-transformar:/tmp/
docker exec supabase_db_educar-para-transformar \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/cursos_rls.sql

npx tsc --noEmit --incremental false
npm run build
EPT_SUPABASE_LOCAL=1 npm run test:e2e   # 45 pruebas
```

El archivo `.env.local` con las credenciales del stack local se genera desde
`supabase status -o env`; está en `.gitignore` y nunca se confirma.

## Los dos defectos de seguridad que encontró la auditoría

### 1. Escalada de privilegios por `public.roles` — cerrada en `004`

La migración `001` dejó dos huecos que juntos anulaban toda la autorización:

| # | Hueco | Dónde |
|---|---|---|
| 1 | `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated` dio a todo usuario autenticado **todos** los privilegios sobre `public.roles`, incluido `UPDATE` | `001_initial_schema.sql:312` |
| 2 | `public.roles` nunca recibió RLS | `001` no la menciona |

La autorización de cursos deriva el rol de `roles.nombre = 'DIRECTOR'` en las tres
capas. Por lo tanto un ESTUDIANTE podía ejecutar

```sql
UPDATE public.roles SET nombre = 'DIRECTOR' WHERE nombre = 'ESTUDIANTE';
```

y quedar habilitado, sin tocar `perfiles` en ningún momento.

`004_seguridad_roles_niveles.sql` deja `roles` y `niveles` de **solo lectura**
para los roles de aplicación: `REVOKE ALL` (que también cubre `REFERENCES` y
`TRIGGER`, los dos que `003` había dejado en pie sobre `niveles`), `GRANT SELECT`
únicamente a `authenticated`, RLS habilitado con política de lectura y **sin**
política de escritura, y secuencias revocadas.

**Comprobado sobre la base real**, sección §9bis del script: renombrar, insertar,
borrar y truncar `roles` fallan con `42501`; modificar `niveles` también; y
después de todos los intentos `es_director_actual()` sigue devolviendo false y la
creación de cursos sigue rechazada.

### 2. Recursión en las políticas de `perfiles` — cerrada en `005`

Al ejecutar el script por primera vez, la sección §9 falló **exactamente como
estaba diseñada**: detectó que la denegación llegaba por `42P17` (recursión) en
lugar de por autorización, y se negó a contarla como aprobada.

La causa: la política `"Directores y docentes ven todos los perfiles"` de `001` es
una política **sobre** `perfiles` que **consulta** `perfiles`. Verificado contra
una base reconstruida desde cero:

```
SELECT 1 FROM public.perfiles LIMIT 1;
ERROR 42P17: infinite recursion detected in policy for relation "perfiles"
```

Esto no era un detalle de la prueba. `src/context/AuthContext.tsx:77` hace esa
misma lectura para resolver el rol en cada carga del panel, así que **sobre una
base construida desde las migraciones del repositorio ningún usuario autenticado
podía cargar su perfil**: `rol` quedaba en null y todo el panel respondía «Acceso
restringido». La pantalla de cursos era literalmente inalcanzable.

`005_perfiles_sin_recursion.sql` reemplaza la expresión recursiva por una llamada
a `app_private.rol_actual()`, una función `SECURITY DEFINER` en un esquema que la
Data API no expone. **Mismo criterio de siempre** —el propio perfil, y todos los
perfiles para DIRECTOR y DOCENTE—, otra implementación. No se rediseña el modelo
de roles, no se agregan políticas de UPDATE ni DELETE, y no cambia quién ve qué.

Que esto además destrabe `asistencias`, `solicitudes_inscripcion` y
`postulaciones` —que copian el mismo patrón— es una consecuencia inevitable de
quitar la recursión, no una ampliación de alcance.

## Decisión sobre el límite de migración

**Se agregaron migraciones nuevas. `003` nunca se editó.**

| Evidencia | Observación |
|---|---|
| ¿En qué refs vive `003_cursos.sql`? | Solo en `c183c1a`, de esta rama |
| ¿Está en `origin/main`? | No |
| ¿La rama se subió alguna vez? | No: `git ls-remote --heads origin` solo devuelve `main` y `mejora-buenas-practicas` |
| ¿El proyecto Supabase del repositorio es alcanzable? | **No.** El ref configurado no coincide con ningún proyecto accesible por MCP |

Como el proyecto real no se puede inspeccionar, no se puede **probar** que `003`
no haya sido aplicado ahí. Sumado a que el flujo documentado del repositorio es
aplicar SQL a mano en el editor —sin ledger que detecte divergencia—, un archivo
mutado sería un riesgo silencioso. Migraciones hacia adelante son correctas en
los dos escenarios.

Nombre de archivo: se consultó `supabase migration new --help` (CLI 2.117.0), que
genera marcas de tiempo. Se mantiene la convención del repositorio,
`NNN_nombre.sql`, que `001`–`003` ya establecen.

## Criterios de aceptación y su evidencia

Los cinco criterios son los de EPT-8 en Jira. **Todos verificados contra la base
real y contra el navegador.**

| # | Criterio | Evidencia ejecutada | Estado |
|---|---|---|---|
| 1 | Se crea un curso con denominación, división y nivel existentes. | Base: `cursos_rls.sql` §2.1. Navegador: «crea un curso y lo ve en el listado», que además recarga la página para confirmar que quedó persistido | **Aprobado** |
| 2 | Se consulta y modifica un curso sin perder relaciones. | Base: §2.2 (la modificación conserva el nivel). Navegador: «ve el listado real», «edita un curso y conserva su nivel» | **Aprobado** |
| 3 | Se inactiva un curso con historial en lugar de eliminarlo físicamente. | Base: §5 (la fila y su nivel se conservan, se puede reactivar) y §6 (borrado físico rechazado con `42501`). Navegador: «inactiva un curso sin borrarlo y lo reactiva» comprueba que la cantidad de filas no cambia; `DELETE` responde 405 incluso autenticada | **Aprobado** |
| 4 | No se admite la misma denominación y división dentro de un mismo nivel. | Base: §3, cuatro variantes de mayúsculas más espacios laterales (`23505` y `23514`), y §3.6 confirma que sí se admite en otro nivel. Navegador: «rechaza un duplicado normalizado», escribiendo `1ER GRADO` / `a` contra el sembrado `1er Grado` / `A` | **Aprobado** |
| 5 | Un usuario no autorizado no puede usar la administración de cursos. | Base: §8 (DOCENTE, ESTUDIANTE, PADRE, PERSONAL y sesión sin perfil), §9, §9bis, §10. Navegador: el estudiante no ve el ítem de menú, recibe «Acceso restringido», y `POST`/`PATCH` responden 403; sin sesión, 401 y redirección | **Aprobado** |

## Matriz de autorización, privilegios y RLS

Las tres capas se verificaron por separado, cada una con su propio caso permitido
y denegado.

| Actor | Menú | `/dashboard/cursos` | `POST`/`PATCH` | Leer cursos | Escribir cursos | Borrar cursos | Escribir `roles`/`niveles` |
|---|---|---|---|---|---|---|---|
| Anónimo | No | Redirige a `/login` | **401** | Denegado (sin GRANT) | Denegado | Denegado | Denegado |
| ESTUDIANTE | **No** | **Acceso restringido** | **403** | Permitido | Denegado (RLS) | Denegado | Denegado (42501) |
| DOCENTE | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | Denegado (42501) |
| PADRE | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | Denegado (42501) |
| PERSONAL | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | Denegado (42501) |
| Sesión sin perfil | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | Denegado (42501) |
| DIRECTOR | **Sí** | **Administración completa** | **201 / 200** | Permitido | **Permitido (RLS)** | **Denegado** | Denegado (42501) |

En negrita, lo comprobado en un navegador con sesión real; el resto, en la base.

Privilegios de tabla después de `004`, comprobados con `has_table_privilege` en
§1bis:

| Tabla | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER |
|---|---|---|---|---|---|---|---|
| `public.cursos` | authenticated | authenticated | authenticated | — | — | — | — |
| `public.niveles` | authenticated | — | — | — | — | — | — |
| `public.roles` | authenticated | — | — | — | — | — | — |

`anon` no tiene ningún privilegio sobre las tres. Las secuencias
`roles_id_seq` y `niveles_id_seq` también quedaron cerradas.

El borrado físico está denegado **para todos, incluido el director**: no hay
GRANT, no hay política y no hay endpoint. `src/proxy.ts` no cubre `/api/**` y solo
refresca la sesión; no es un límite de autorización y no se modificó.

## Base de datos: reinicio, prueba SQL, tipos y asesores

### Reinicio limpio

```
Applying migration 001_initial_schema.sql...
Applying migration 002_postulaciones.sql...
Applying migration 003_cursos.sql...
Applying migration 004_seguridad_roles_niveles.sql...
Applying migration 005_perfiles_sin_recursion.sql...
Finished supabase db reset on branch main.
```

`supabase migration list --local` confirma las cinco versiones aplicadas: 001,
002, 003, 004, 005.

### Prueba SQL

`supabase/tests/cursos_rls.sql`, ejecutado con `ON_ERROR_STOP=1`:
**39 comprobaciones OK, 0 fallos, 0 errores, código de salida 0.** Todo ocurre
dentro de una transacción que termina en `ROLLBACK`, y los nombres de prueba
(`Prueba RLS…`) no colisionan con datos de la aplicación, así que el script se
puede correr en cualquier momento.

| Sección | Qué prueba |
|---|---|
| §1 | `ON DELETE RESTRICT`, índice único normalizado, RLS en `cursos`, `niveles` y `roles`, ausencia de política DELETE |
| §1bis | Los seis privilegios prohibidos sobre `roles` y `niveles`, los cuatro sobre `cursos`, las secuencias, y que `authenticated` conserve `SELECT` |
| §2 | Alta y modificación por la directora, conservando el nivel |
| §3 | Cuatro variantes de duplicado normalizado (`23505`), espacios laterales (`23514`), y que otro nivel sí lo admite |
| §4 | Nivel inexistente (`23503`) |
| §5 | Baja lógica: la fila y su nivel se conservan; se puede reactivar |
| §6 | Borrado físico denegado (`42501`) |
| §7 | No se puede borrar un nivel referenciado |
| §8 | Cinco identidades no autorizadas: sin escritura, con lectura |
| §9 | El estudiante no puede reasignarse el rol ni crearse un perfil de director — **y falla si la denegación llega por `42P17`** |
| §9bis | El ataque directo a `public.roles` en sus cuatro formas, y la comprobación posterior de que sigue sin ser director |
| §10 | `anon` no puede leer ni crear cursos |
| §11 | Diagnóstico: la lectura directa de `perfiles` ahora funciona |

### Tipos generados y reconciliación

`supabase gen types typescript --local` corrió contra el esquema final y su salida
está en `src/types/database.generated.ts`, sin editar a mano. La comparación con
el archivo escrito a mano da:

| Elemento | Esquema real | `database.types.ts` | Lectura |
|---|---|---|---|
| `cursos` (Row/Insert/Update) | Presente | Presente | **Coinciden exactamente** |
| `es_director_actual` | Presente | Presente | **Coinciden** |
| `padres_hijos` | **No existe** | Presente | Deriva preexistente. Lo usan `usuarios.service.ts` y `api/usuarios/route.ts` |
| `opiniones.aprobado` | **No existe** | Presente | Deriva preexistente. Lo usa `noticias.service.ts` |

`src/types/database.types.ts` sigue siendo el archivo que importa la aplicación,
y **está escrito a mano**. No se lo reemplaza por el generado porque quitar
`padres_hijos` y `opiniones.aprobado` rompería la compilación y, sobre todo,
escondería el problema: hay código que consulta objetos que ninguna migración
crea. La deriva queda expuesta en un comentario al principio del archivo y es
trabajo de EPT-66 decidir si se documenta en migraciones nuevas o se corrige el
código.

### Asesores

`supabase db advisors --local --type security` — 6 hallazgos, **ninguno sobre
`cursos`, `roles`, `niveles` ni sobre las funciones de esta historia**:

| Nivel | Hallazgo | Objeto | Origen |
|---|---|---|---|
| ERROR | `rls_disabled_in_public` | `public.actividades` | Preexistente (`001`) |
| WARN | `function_search_path_mutable` | `calcular_porcentaje_asistencia` | Preexistente (`001`) |
| WARN | `function_search_path_mutable` | `verificar_cupo_actividad` | Preexistente (`001`) |
| WARN | `rls_policy_always_true` | `opiniones` INSERT | Preexistente, deliberado (formulario público) |
| WARN | `rls_policy_always_true` | `postulaciones` INSERT | Preexistente, deliberado |
| WARN | `rls_policy_always_true` | `solicitudes_inscripcion` INSERT | Preexistente, deliberado |

Que `es_director_actual`, `app_private.es_director` y `app_private.rol_actual` no
aparezcan en `function_search_path_mutable` confirma que el `SET search_path = ''`
de esta historia es correcto.

`supabase db advisors --local --type performance` — 13 hallazgos, todos WARN y
todos sobre tablas preexistentes (`perfiles`, `asistencias`,
`solicitudes_inscripcion`, `postulaciones`): `auth_rls_initplan` por no envolver
`auth.uid()` en un `SELECT`, y `multiple_permissive_policies`. **Ninguno sobre
`cursos`, `roles` ni `niveles`**, porque las políticas de esta historia sí usan
`(SELECT ...)`.

## Pruebas de navegador

45 pruebas en total con el stack local; 41 las agrega esta historia.

| Suite | Proyecto | Pruebas | Qué cubre |
|---|---|---|---|
| `tests/cursos.spec.ts` | `chromium` | 7 | Límite HTTP sin sesión: 401, 405, sin filtraciones |
| `tests/cursos-ui.spec.ts` | `chromium` | 18 | Interfaz, estados, accesibilidad e idioma sobre el banco de pruebas |
| `tests/cursos-auth.spec.ts` | `chromium-directora` / `chromium-estudiante` | 16 | **Camino real autenticado contra la base** |
| `tests/e2e.spec.ts` | `chromium` | 4 | Suite preexistente del repositorio |

### El camino autenticado, sin nada simulado

`tests/auth.setup.ts` crea identidades sintéticas contra el stack local
(rechaza ejecutarse si la URL no es local), siembra un conjunto conocido de
cursos, inicia sesión **por el formulario real** y guarda el estado de sesión en
`tests/.auth/`, que está en `.gitignore`.

Todo lo que sigue viaja el camino completo: navegador → `/api/cursos` → cliente
ligado a la sesión → privilegios y RLS de PostgreSQL.

| Prueba | Qué demuestra |
|---|---|
| ve el listado real de cursos | Las tres filas sembradas, la inactiva con «Reactivar», y sin desborde horizontal a 375 px |
| tiene el acceso a Cursos en la navegación | El ítem aparece para DIRECTOR |
| crea un curso y lo ve en el listado | Se persiste y sobrevive a una recarga completa |
| rechaza un duplicado normalizado | `1ER GRADO`/`a` contra `1er Grado`/`A`: la base responde `23505` y la pantalla muestra el mensaje en español |
| edita un curso y conserva su nivel | Modificación real, y se restaura para no arrastrar estado |
| inactiva un curso sin borrarlo y lo reactiva | La cantidad de filas no cambia; el estado sí |
| rechaza un nivel inexistente | `23503` real → 400 con «El nivel educativo elegido no existe.» y `campo: nivel_id` |
| recibe el estado de duplicado en el límite HTTP | El error nunca contiene `23505` |
| no dispone de borrado físico ni estando autenticada | 405 en las dos rutas |
| el estudiante no ve el acceso a Cursos | El ítem no existe para su rol |
| el estudiante recibe acceso restringido | Y no se renderiza ninguna tabla de cursos |
| el estudiante no puede crear cursos | 403 con «Solo el director puede administrar los cursos.» |
| el estudiante no puede modificar ni inactivar | 403 |

Sin `EPT_SUPABASE_LOCAL=1` la suite corre igual, con 29 pruebas, y no falla por
infraestructura ausente.

### Accesibilidad, probada por aserción

`tests/cursos-ui.spec.ts` corre contra `/pruebas-ui/cursos`, un banco de pruebas
**comprometido en el repositorio** con doble cierre: queda deshabilitado en
cualquier compilación de producción **y** exige `EPT_UI_HARNESS=1`. Comprobado
levantando el servidor de producción con la variable puesta: devolvió **404**,
mientras `/dashboard/cursos` devolvió **307**.

| Comportamiento | Prueba |
|---|---|
| Se llega al alta solo con `Tab` y se activa con `Enter` | «reaches the create form using only the keyboard» |
| Foco inicial del diálogo en el primer campo | «opens the edit dialog with correct labelling and initial focus» |
| El foco no se escapa: 12 `Tab` y 12 `Shift+Tab` siguen dentro | «keeps keyboard focus inside the dialog while it is open» |
| `Escape` cierra y devuelve el foco al botón que abrió | «closes the dialog with Escape and restores focus to the trigger» |
| Errores de validación con `role="alert"` | «reports validation errors per field, announced as alerts» |
| Región de estado con nombre propio y `aria-live="polite"` | «describes the table and every row action for screen readers» |
| `caption`, `scope="col"` y acciones que nombran su curso | idem |
| El estado vacío no se parece a un error | «shows a distinct empty state, not an error» |
| No existe ningún control de borrado | «offers no delete control anywhere in the list» |
| Un valor con solo espacios no llega a la red | «rejects whitespace-only input before reaching the network» |
| Botón deshabilitado mientras se envía | «disables the submit button while the request is in flight» |
| A 375 px no hay dependencia del desplazamiento horizontal | «lays out as cards without depending on horizontal scrolling» |
| Todo el texto visible y los nombres accesibles en español | «every visible string and accessible name is Spanish» |

## Auditoría de idioma

La prueba «every visible string and accessible name is Spanish» recorre el texto
visible más `aria-label`, `placeholder`, `alt` y `title`, y falla ante cualquiera
de 23 palabras inglesas frecuentes, comparadas con límites de palabra para que
«Cancelar», «Editar» o «Crear» no den falsos positivos. También exige que estén
«Cursos», «Nuevo curso», «Denominación», «División» y «Nivel educativo».

Los textos que el banco de pruebas no renderiza se auditaron leyendo el código:
«Acceso restringido», «Volver al panel», «No pudimos cargar los cursos», «No
pudimos mostrar los cursos», «Cargando los cursos…», el título `Cursos | Panel`,
el ítem de menú «Cursos» y todos los mensajes de `autorizacion.ts`,
`cursos.service.ts`, `cursos.client.ts` y las dos rutas de la API. Todos en
español. Las capturas autenticadas lo confirman visualmente.

## Capturas

En `docs/evidence/EPT-8/`. Se regeneran con:

```bash
EPT_CAPTURAS=1 npx playwright test tests/cursos-ui.spec.ts                    # con datos fijos
EPT_SUPABASE_LOCAL=1 EPT_CAPTURAS=1 npx playwright test --project=setup \
  --project=chromium-directora --project=chromium-estudiante                  # con datos reales
```

La captura es opcional a propósito: volver a renderizar produce archivos
distintos byte a byte, así que una corrida normal deja el árbol limpio.

### Con sesión real y datos de la base

| Archivo | Ancho | Qué muestra |
|---|---|---|
| `real-escritorio-01-listado-autenticado.png` | 1280 | Panel completo con «Ana Directora / DIRECTOR», el ítem «Cursos» activo y los cursos reales, uno de ellos inactivo |
| `real-escritorio-02-duplicado-desde-la-base.png` | 1280 | El `23505` real de PostgreSQL traducido al mensaje en español |
| `real-escritorio-03-estudiante-restringido.png` | 1280 | Lo que ve un estudiante en `/dashboard/cursos` |
| `real-movil-01-listado-autenticado.png` | 375 | El mismo listado real en tarjetas |

### Con datos fijos, para estados difíciles de provocar

| Archivo | Ancho | Qué muestra |
|---|---|---|
| `escritorio-01-listado.png` | 1280 | Listado con activos e inactivos |
| `escritorio-02-formulario.png` | 1280 | Formulario de alta |
| `escritorio-03-validacion.png` | 1280 | Errores de validación por campo |
| `escritorio-04-edicion.png` | 1280 | Diálogo de edición |
| `escritorio-05-error-duplicado.png` | 1280 | Error de dominio en la región de estado y junto al campo |
| `escritorio-06-vacio.png` | 1280 | Estado vacío |
| `escritorio-07-foco-dialogo.png` | 1280 | Foco visible en el primer campo |
| `escritorio-08-enviando.png` | 1280 | Botón deshabilitado con «Cargando...» |
| `movil-01-listado.png` … `movil-04-vacio.png` | 375 | Listado, validación, edición y vacío en móvil |

## Comandos ejecutados y resultados exactos

Entorno: Windows 10 Pro 19045, Docker 29.7.2 con Compose v5.5.0, Node v24.19.0,
Next.js 16.2.5, Supabase CLI 2.117.0 vía `npx`, PostgreSQL 17 del stack local.

| Comando | Salida | Código |
|---|---|---|
| `docker --version` / `docker info` | 29.7.2, motor en marcha | 0 |
| `supabase init` | `Finished supabase init` | **0** |
| `supabase start` | 12 contenedores en marcha | **0** |
| `supabase db reset --local` | Aplica 001, 002, 003, 004 y 005 | **0** |
| `supabase migration list --local` | 001, 002, 003, 004, 005 | **0** |
| `psql -v ON_ERROR_STOP=1 -f supabase/tests/cursos_rls.sql` | **39 OK, 0 fallos, 0 errores** | **0** |
| `supabase gen types typescript --local` | `src/types/database.generated.ts` | **0** |
| `supabase db advisors --local --type security` | 6 hallazgos, todos preexistentes | 0 |
| `supabase db advisors --local --type performance` | 13 hallazgos, todos preexistentes | 0 |
| `git diff --check` desde la base | sin hallazgos | **0** |
| `npx tsc --noEmit --incremental false` | sin salida | **0** |
| `npx eslint --no-cache` sobre los archivos de EPT-8 | 0 errores; 1 advertencia preexistente en `dashboard/layout.tsx:127` | **0** |
| `npm run build` | `✓ Compiled successfully` | **0** |
| `EPT_SUPABASE_LOCAL=1 npm run test:e2e` | 45 pruebas: **44 passed, 1 failed** | 1 |
| `npm run test:e2e` (sin base local) | 29 pruebas: **28 passed, 1 failed** | 1 |
| `npm run lint -- --no-cache` (repositorio) | `125 problems (16 errors, 109 warnings)`; ninguna ruta de EPT-8 | 1 |
| `next start` + `GET /pruebas-ui/cursos` con `EPT_UI_HARNESS=1` | **404** | — |
| `next start` + `GET /dashboard/cursos` sin sesión | **307** | — |

### Sobre las dos salidas con código 1

Ninguna la introduce esta historia.

- **`npm run test:e2e`**: falla `tests/e2e.spec.ts:8`, que espera
  `redirect=/dashboard` mientras la aplicación produce `redirect=%2Fdashboard`.
  Se comprobó creando un árbol de trabajo descartable en el commit exacto
  `801c967`, con su propia instalación y su propia configuración, **sin tocar el
  árbol de la rama**: ahí da 3 passed, 1 failed, con la misma cadena. La línea
  base tiene 4 pruebas y falla 1; el candidato tiene 45 y falla exactamente la
  misma. EPT-8 agrega 41 pruebas y todas pasan.
- **`npm run lint`**: `REGISTRO_MODIFICACIONES.md:35` documenta «16 errores y 109
  advertencias preexistentes fuera del alcance». El total es exactamente ese y
  ninguna ruta de EPT-8 aparece en la salida.

## Seguridad y privacidad

- `SUPABASE_SERVICE_ROLE_KEY` no se usa en ningún archivo de producción de esta
  historia. Toda la operación de cursos pasa por el cliente ligado a la sesión,
  así que RLS es la última línea de defensa. La única excepción es
  `tests/auth.setup.ts`, que crea identidades de prueba y **se niega a ejecutarse
  si la URL no es local**.
- `cursos.service.ts` y `autorizacion.ts` importan `next/headers` de forma
  indirecta: importarlos desde un componente cliente rompe la compilación.
- Los mensajes de PostgreSQL nunca llegan al usuario: se traducen por SQLSTATE.
  `tests/cursos.spec.ts` verifica que las respuestas no contengan `service_role`,
  `postgres`, `supabase.co`, SQL ni códigos SQLSTATE.
- Las credenciales del stack local viven en `.env.local`, cubierto por
  `.gitignore`. Los estados de sesión viven en `tests/.auth/`, también ignorado.
  No se confirmó ningún secreto, archivo de entorno, reporte ni traza.
- Las identidades de prueba son sintéticas: correos en un dominio reservado
  (`@ept.local`), DNIs con prefijo `T9`, y nombres inventados.
- `supabase/config.toml` sí se confirma: es la plantilla por defecto, solo
  referencia variables de entorno y no contiene ningún valor.

## Límite de reversión

Cinco commits, revertibles de atrás hacia adelante:

1. **Verificación** (`test(courses)`) — revertirlo quita las pruebas
   autenticadas, la configuración local de Supabase, los tipos generados y la
   migración `005`. **Cuidado:** también reabre la recursión de `perfiles`, que
   deja el panel inservible.
2. **Remediación** (`fix(courses)`) — revertirlo reabre la escalada por
   `public.roles`. No conviene revertirlo solo.
3. **Interfaz** — elimina `/dashboard/cursos`, su ítem de menú y el cliente.
4. **Servidor** — elimina `/api/cursos`, la capa de datos y la autorización.
5. **Base de datos** — quita `003_cursos.sql` del repositorio. **Si las
   migraciones ya se aplicaron, revertir los archivos no deshace el esquema:**
   hace falta una migración `006` que elimine `cursos`, las tres funciones y el
   esquema `app_private`, y decida explícitamente si `roles` y `niveles` vuelven
   a quedar sin RLS.

## Lo que falta

| Falta | Por qué | Afecta a |
|---|---|---|
| Revisión por el otro integrante | Es un acto humano. Esta sesión no puede revisar su propio trabajo | EPT-8, EPT-19 |
| Integración a `main` con un commit identificable | Depende de la revisión, y no hubo autorización para hacer push, PR ni merge | EPT-8, EPT-19 |

## Riesgos que quedan abiertos

1. **Las migraciones del repositorio no describen la base que la aplicación
   asume.** Ahora está probado, no supuesto: la generación de tipos desde el
   esquema real confirma que `padres_hijos` y `opiniones.aprobado` **no existen**,
   aunque `usuarios.service.ts`, `api/usuarios/route.ts` y `noticias.service.ts`
   los usan. Esas rutas fallarán en tiempo de ejecución contra una base
   construida desde las propias migraciones del repositorio. Corresponde a
   EPT-66.
2. **`actividades` sigue sin RLS** y con `GRANT ALL` para `authenticated`: el
   asesor de seguridad lo marca como ERROR. Es el mismo patrón que causó la
   escalada por `roles`. Queda fuera del alcance de esta historia porque no
   participa de la autorización de cursos. Corresponde a EPT-66.
3. **Advertencias de rendimiento en políticas preexistentes**: 13 hallazgos de
   `auth_rls_initplan` y `multiple_permissive_policies` sobre `perfiles`,
   `asistencias`, `solicitudes_inscripcion` y `postulaciones`. Ninguno sobre esta
   historia. Corresponde a EPT-66.
4. **Endurecer `roles` y `niveles` cambia el comportamiento.** A partir de `004`,
   `authenticated` solo puede leerlas. Ningún código actual las escribe, pero
   EPT-55 (niveles) y EPT-59 (roles y permisos) deberán definir sus propias
   políticas de escritura o hacer esas operaciones por un límite privilegiado.

## Retrospectiva

**Lo que falló y por qué importa.** La primera versión de esta historia dio por
segura la autorización por rol sin auditar quién podía escribir la tabla de la
que ese rol se deriva. El control estaba bien construido sobre una base que
cualquiera podía mover. La lección es concreta: cuando una decisión de
autorización lee una tabla, hay que revisar los privilegios de **esa** tabla, no
solo los de la que se quiere proteger.

**Lo segundo que falló.** Se borró el banco de pruebas de interfaz antes de
confirmar los cambios, dejando afirmaciones de accesibilidad sin nada que las
respaldara, y una captura quedó mal rotulada. Una evidencia que no se puede
volver a ejecutar no es evidencia.

**Lo que funcionó.** Escribir `cursos_rls.sql` como artefacto ejecutable mientras
no había base de datos, en lugar de describir la verificación en prosa. Cuando
apareció Docker, la prueba estaba lista y encontró dos cosas en su primera
corrida: confirmó que la escalada estaba cerrada, y descubrió la recursión de
`perfiles` que ninguna revisión estática había detectado. Que la sección §9
estuviera escrita para **fallar** ante un `42P17` en lugar de aceptarlo como
denegación es lo que convirtió un error silencioso en un hallazgo.

**Lo que conviene llevarse a la próxima historia.** La infraestructura de
sesiones autenticadas ya existe: `tests/auth.setup.ts` y los proyectos de
Playwright se reutilizan tal cual para EPT-9 en adelante. Levantar el stack local
antes de empezar, y no al final, habría ahorrado dos sesiones.
