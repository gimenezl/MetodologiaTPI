# EPT-9 — Situación académica del alumno: evidencia de ejecución

El legajo académico del estudiante quedó implementado de extremo a extremo: estado
separado de la matrícula, historial temporal de cursos que nunca se sobrescribe,
nivel derivado siempre del curso, y las invariantes garantizadas dentro de
PostgreSQL en vez de solo en la interfaz. Todo lo que este documento afirma se
ejecutó; los comandos y sus códigos de salida están más abajo.

**Estado: corregido tras una revisión independiente que bloqueó el candidato
`5419942`.** Los doce hallazgos están cerrados y demostrados; el detalle está en
la sección 0. EPT-9 permanece `En curso`. No hubo push, ni pull request, ni
merge, ni ningún cambio en `main`.

---

## Quick path

1. Levantar el stack local y reconstruir la base: `npx supabase db reset --local`.
2. Probar la base: las dos suites SQL y las dos de concurrencia (§ Pruebas de base).
3. Probar la aplicación: TypeScript, ESLint focalizado, build y las tres suites de
   navegador (§ Pruebas de servidor y navegador).
4. Comprobar que los bancos de pruebas no existen en producción:
   `node supabase/tests/harness_produccion.mjs`.
5. Revisar las capturas en [`EPT-9/`](EPT-9/), diferenciadas entre banco visual
   (`fixture-*`) y base real (`real-*`).

---

## 0. Remediación de la revisión independiente

Una revisión independiente **bloqueó** el candidato anterior y levantó doce
hallazgos. Esta sección es el registro de qué se confirmó, qué se corrigió y con
qué prueba se demuestra cada corrección. Lo que sigue en el resto del documento
describe la unidad completa; acá está solamente lo que cambió después del
bloqueo.

**Candidato bloqueado:** `5419942d698527780477fa74e5a353a943f1955e`.

Ese identificador es el del código revisado, no el de esta entrega. Un archivo
versionado no puede contener honestamente el SHA del commit que lo contiene: el
hash se calcula sobre el contenido, así que escribirlo sería imposible o falso.
El SHA definitivo de esta remediación queda en el comentario de Jira y en el
informe final. Para reconstruirlo desde el repositorio:

```bash
git log --oneline origin/main..HEAD
git rev-parse HEAD
```

### Los doce hallazgos

| # | Hallazgo | Veredicto | Corrección | Prueba que lo demuestra |
|---|---|---|---|---|
| 1 | Persistencia parcial al crear un estudiante con tutor | **Confirmado** | `POST /api/usuarios` reescrito: rechaza los vínculos parentales en vez de ignorarlos, comprueba DNI y legajo libres antes de tocar Auth, persiste en una sola sentencia y verifica la compensación | `tests/usuarios-auth.spec.ts` (9 casos) |
| 2 | Permiso denegado sobre las funciones de un CHECK | **Confirmado y reproducido** | Las restricciones pasan a expresiones inmutables en línea; no se otorga ningún EXECUTE nuevo | `alumnos_academicos_rls.sql` casos 51 a 53 |
| 3 | Falta una migración progresiva | **Confirmado** | `009_correcciones_revision_alumnos.sql`, aditiva, idempotente, con verificación previa de los datos y autocomprobación del contrato | `npx supabase db reset --local` exit 0; sección 7 de la propia migración |
| 4 | `btrim(text)` no rechazaba todos los espacios en blanco | **Confirmado** | Conjunto Unicode de 26 puntos de código, idéntico en PostgreSQL y en Zod | `alumnos_academicos_rls.sql` casos 54 a 56; `alumnos-correcciones.spec.ts` |
| 5 | La lectura propia no exigía conservar el rol ESTUDIANTE | **Confirmado** | Las dos políticas exigen `perfil_id` propio **y** rol vigente | `alumnos_academicos_rls.sql` casos 57 a 59bis |
| 6 | ACTIVO → INACTIVO dejaba un curso incompatible | **Confirmado** | El curso se limpia junto con su error al cambiar de estado | `alumnos-correcciones.spec.ts`, prueba de nueve pasos |
| 7 | Cuatro defectos de interfaz | **Confirmados** | Historial ilegible distinguido del vacío; `aria-invalid` y `aria-describedby`; diálogos coherentes mientras hay una petición en vuelo; el curso vigente no se ofrece como destino | `alumnos-correcciones.spec.ts` (8 casos) y `alumnos-auth.spec.ts` |
| 8 | La concurrencia de corrección de DNI estaba simulada | **Confirmado** | Dos escenarios nuevos con dos conexiones `psql` reales | `alumnos_academicos_concurrencia.mjs` 18bis y 18ter |
| 9 | El 404 del banco de pruebas se afirmaba leyendo el código | **Confirmado** | Los bancos salen del binario de producción; la prueba compila, levanta y mide | `supabase/tests/harness_produccion.mjs`, 12 afirmaciones |
| 10 | Integridad de Git y de los tipos | **Confirmado** | Tipos regenerados desde la base local, salto de línea final normalizado | `git diff --check` exit 0; dos generaciones con el mismo SHA256 |
| 11 | Evidencia y métricas desactualizadas | **Confirmado** | Cifras recalculadas desde Git, recuentos separados entre setup y casos funcionales, 59 capturas regeneradas sin el indicador de desarrollo | Este documento |
| 12 | Faltaba la lista completa de pruebas | **Confirmado** | Tabla de verificación con comando, código de salida y resultado | § 11 |

### Tres defectos que aparecieron durante la corrección

No estaban en el informe de revisión. Se encontraron al escribir las pruebas y
se corrigieron en la misma tanda.

1. **El literal de espacios en blanco de la migración estaba vacío.** La
   restricción `perfiles_legajo_valido` existía, tenía su nombre de siempre y
   no rechazaba nada: `btrim(legajo_nro, '')` no recorta. Una herramienta de
   edición había vaciado la secuencia de escape sin dejar rastro visible. El
   conjunto se reconstruyó con `chr()`, que es ASCII puro en el archivo, y la
   migración ahora ejerce su propio contrato antes de terminar: si un solo caso
   pasa, aborta. La guardia se probó reproduciendo el defecto.
2. **La comprobación previa de identidad rompía con un legajo con coma.** El
   filtro `or` de PostgREST se arma concatenando texto, así que «LEG,2027» —un
   legajo válido según el contrato— producía una expresión inválida y un 500
   que culpaba al sistema de un dato correcto. Se pasó a dos consultas con `eq`,
   que codifica el valor.
3. **El mensaje de un historial ilegible acusaba al estudiante.** Al fallar la
   lectura, el traductor de errores devolvía «Solo el director puede administrar
   los legajos académicos», escrito para una escritura rechazada, a alguien que
   sí tiene derecho a ver su propio legajo, y contradecía al aviso que lo
   rodeaba. Las lecturas fallidas ahora dicen lo único que se puede afirmar: no
   se pudo leer.

### Un defecto que se cerró más allá de lo pedido

El hallazgo 9 pedía comprobar que `/pruebas-ui/alumnos` respondiera 404 en
producción. Responde 404, pero al medirlo apareció algo más: ese 404 **no era
igual** al de una ruta inexistente. Next incluye los segmentos de la URL en la
carga RSC de toda ruta que el enrutador conoce, así que la respuesta confirmaba
que el banco estaba ahí. Un 404 que revela lo que niega no protege nada.

Los tres bancos pasaron a llamarse `page.banco.tsx`, y `pageExtensions` sólo
reconoce esa extensión fuera de producción. `next build` ya no los compila: la
ruta no existe. La guarda en tiempo de ejecución se conserva igual, porque una
sola línea de configuración no debería ser lo único que separa un banco de
pruebas del público.

---

## 1. Línea base y aislamiento

| Dato | Valor |
|---|---|
| Baseline remoto verificado | `e31bdf250e06ca9aae1233c2ee737a0443f4df51` |
| Qué es ese commit | Merge del PR #3 (EPT-55), contiene EPT-8 y EPT-55 integrados |
| Rama de trabajo | `codex/ept-9-academic-students` |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept9` |
| SHA inicial del worktree | `e31bdf250e06ca9aae1233c2ee737a0443f4df51` |
| Último commit de implementación | `96aea77` |
| Cierre de la unidad | El commit de documentación que incluye este archivo |
| Estado del árbol final | Limpio salvo `docs/evidence/EPT-9/`, que forma parte de esta entrega |
| Checkout original | No se modificó, ni se limpió, ni se reseteó, ni se usó para implementar |

```
git fetch origin --prune
git merge-base --is-ancestor e31bdf250e06ca9aae1233c2ee737a0443f4df51 origin/main   # exit 0
git worktree add -b codex/ept-9-academic-students E:/Escritorio/codigo/MetodologiaTPI-ept9 e31bdf25
```

No existían ni la rama `codex/ept-9-academic-students` ni el directorio
`MetodologiaTPI-ept9` antes de esta ejecución. Los worktrees `-ept8` y `-ept55`
son de unidades anteriores y no se tocaron.

### Un incidente de entorno que corresponde registrar

El worktree nuevo no traía `.env.local` (está en `.gitignore`). Al copiarlo desde
el checkout original se comprobó que **ese archivo apunta a un proyecto remoto de
Supabase**, no al stack local: la guarda de `tests/auth.setup.ts` lo rechazó por
hostname. El archivo se eliminó del worktree de inmediato.

Antes de detectarlo, una corrida de `tests/alumnos.spec.ts` levantó el servidor de
desarrollo con esa configuración. Sus diez pruebas son anónimas y de solo lectura:
lo único que llegó al proyecto remoto fueron llamadas `auth.getUser()` sin cookies,
que devuelven «sin usuario». No hubo escrituras, ni lecturas de datos, ni uso de la
clave de servicio. Todas las corridas posteriores —y todos los números de este
documento— se hicieron con las credenciales del stack local inyectadas en el
entorno del proceso, sin escribirlas a ningún archivo:

```
eval "$(npx supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY)"
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
```

Verificado antes de cada corrida: `hostname` efectivo `127.0.0.1`.

---

## 2. Estado live de Jira

Consultado al inicio y antes de cada mutación.

| Issue | Antes | Ahora | Padre | Sprint | Responsable |
|---|---|---|---|---|---|
| EPT-9 | En curso | **En curso** | EPT-3 «Legajos y usuarios» | Sprint 2 actualizar alumnos | Lucas Gimenez |
| EPT-20 | Por hacer | En curso → Listo | EPT-9 | ídem | ídem |
| EPT-21 | Por hacer | En curso → Listo | EPT-9 | ídem | ídem |
| EPT-22 | Por hacer | En curso → Listo | EPT-9 | ídem | ídem |
| EPT-23 | Por hacer | En curso → Listo | EPT-9 | ídem | ídem |
| EPT-24 | Por hacer | En curso → Listo | EPT-9 | ídem | ídem |
| EPT-25 | Por hacer | En curso → Listo | EPT-9 | ídem | ídem |

La jerarquía, el sprint y el responsable no cambiaron durante la ejecución. No se
tocó ninguna incidencia fuera de estas siete.

---

## 3. Decisiones y arquitectura aplicadas

### El modelo, en tres piezas separadas a propósito

| Pieza | Qué guarda | Por qué está separada |
|---|---|---|
| `public.perfiles` | Identidad: nombre, apellido, DNI, legajo, vínculo Auth opcional | Sigue siendo la **única** fuente de verdad de una persona. Ya tenía `user_id` nullable, así que un legajo académico puede existir sin cuenta de acceso sin inventar un usuario falso |
| `public.alumnos` | Solo el estado académico, con la PK del perfil | `perfiles` aloja los cinco roles; una columna académica quedaría nula para cuatro. Una tabla propia da una superficie RLS exacta para EPT-9 sin tocar las políticas de `perfiles`, cuya administración general es de EPT-59 |
| `public.matriculas` | Un tramo por período: alumno, curso, inicio, cierre y motivo | El estado del estudiante y su relación temporal con un curso son cosas distintas. `fecha_cierre IS NULL` marca la vigente |

**El nivel no se persiste en ninguna.** Se deriva de `cursos.nivel_id` en las dos
vistas de lectura. Una prueba comprueba que no exista ninguna columna con «nivel»
en el modelo académico.

### Decisiones que conviene explicar

| Decisión | Motivo |
|---|---|
| Tipos enumerados en vez de VARCHAR + CHECK | Es la garantía más fuerte en la base y el generador de Supabase lo proyecta como una unión exacta de TypeScript, que es justo lo que pide EPT-21 |
| Triggers de restricción **diferidos** | La regla «ACTIVO ⇔ una matrícula + legajo» cruza filas y tablas. Diferirlos permite que una operación atómica cierre un tramo y abra otro; al confirmar, el estado tiene que ser válido o la transacción entera se cae |
| Escrituras solo por funciones `app_private` | `authenticated` recibe únicamente SELECT. Aunque alguien otorgara un privilegio por error, RLS seguiría denegando: no hay ninguna política de escritura |
| Enumerar los dígitos del DNI (`[0123456789]`) | En PostgreSQL `\d` acepta dígitos no ASCII y un rango `[0-9]` depende de la colación. Verificado en esta base: `'1234567٨' ~ '^\d{7,8}$'` da **true** |
| Unicidad de legajo sin distinguir mayúsculas | El número lo tipea una persona; sin ese índice «A-100» y «a-100» serían dos alumnos que en el listado se ven idénticos |
| El detalle es de solo lectura | Las operaciones viven en el listado, que es donde el director trabaja sobre varios estudiantes. Una sola implementación, un solo conjunto de pruebas |
| Vista propia en `/dashboard/mi-legajo` | No recibe ni filtra por identificador: pide el listado y RLS devuelve solo el legajo de la sesión. No hay parámetro que manipular |

### Orden de bloqueos

Documentado en la migración y respetado por todas las operaciones:

```
alumnos  →  cursos  →  matriculas
```

La inactivación de un curso entra por `cursos` y solo lee `matriculas`; nunca sube
a `alumnos`, así que no puede cerrar un ciclo con las demás.

### Backfill

Los perfiles ESTUDIANTE preexistentes se incorporan como `INACTIVO`, sin matrícula
y sin legajo inventado. Un trigger `AFTER INSERT ON perfiles` garantiza lo mismo
para los que se creen después, venga el alta por esta historia o por la frontera
privilegiada `/api/usuarios`. Sobre un reset limpio el backfill afecta cero filas,
porque la migración 001 no siembra perfiles.

---

## 4. Cambios por archivo

### Persistencia

| Archivo | Cambio |
|---|---|
| `supabase/migrations/008_alumnos_estado_academico.sql` | **Nuevo.** Todo el modelo académico, sus invariantes, funciones, grants y RLS |
| `supabase/tests/alumnos_academicos_rls.sql` | **Nuevo.** 69 comprobaciones de estructura, integridad, ciclo de vida y autorización |
| `supabase/tests/alumnos_academicos_concurrencia.mjs` | **Nuevo.** 6 escenarios con dos conexiones PostgreSQL reales |
| `supabase/tests/_sesion-psql.mjs` | **Nuevo.** Arnés de dos conexiones, extraído de la prueba de niveles |
| `supabase/tests/niveles_concurrencia.mjs` | Usa el arnés compartido; de 249 a 138 líneas |
| `supabase/tests/cursos_rls.sql`, `niveles_rls.sql` | DNI sintéticos ajustados al contrato nuevo. Ninguna garantía cambia |

### Servidor y API

| Archivo | Cambio |
|---|---|
| `src/services/alumnos.service.ts` | **Nuevo.** Lecturas por vista y cinco operaciones atómicas; traducción de SQLSTATE |
| `src/services/alumnos.client.ts` | **Nuevo.** Cliente del navegador con `ErrorAlumno` |
| `src/app/api/alumnos/route.ts` | **Nuevo.** POST del alta |
| `src/app/api/alumnos/[id]/route.ts` | **Nuevo.** PATCH discriminado con cuatro acciones |
| `src/lib/validations.ts` | Esquemas Zod de alumnos y `primerErrorAlumno` |
| `src/services/autorizacion.ts` | `requerirSesion` para la vista propia |
| `src/services/cursos.service.ts` | Traduce P5514 a 409 con mensaje de dominio |
| `src/types/database.generated.ts` | Regenerado desde el esquema final |

### Interfaz

| Archivo | Cambio |
|---|---|
| `src/app/dashboard/alumnos/page.tsx`, `loading.tsx`, `error.tsx` | **Nuevos.** Listado autorizado en el servidor |
| `src/app/dashboard/alumnos/_components/GestionAlumnos.tsx` | **Nuevo.** Alta y las cuatro operaciones, con sus diálogos accesibles |
| `src/app/dashboard/alumnos/_components/SituacionAcademica.tsx` | **Nuevo.** Situación e historial, compartido por el detalle y la vista propia |
| `src/app/dashboard/alumnos/[id]/page.tsx`, `loading.tsx` | **Nuevos.** Detalle con historial |
| `src/app/dashboard/mi-legajo/page.tsx` | **Nuevo.** Vista propia del estudiante |
| `src/app/pruebas-ui/alumnos/page.tsx` | **Nuevo.** Banco visual determinista |
| `src/app/dashboard/layout.tsx` | Entradas «Alumnos» (DIRECTOR) y «Mi legajo» (ESTUDIANTE) |

### Correcciones dentro del alcance

| Archivo | Cambio | Por qué es de EPT-9 |
|---|---|---|
| `src/services/perfiles.service.ts` | Se retira `eliminarPerfil` | Hacía `DELETE FROM perfiles` sin política RLS de DELETE: afectaba cero filas y devolvía éxito. La interfaz confirmaba una baja que nunca ocurría |
| `src/app/dashboard/legajos/page.tsx` | Se retiran el botón y el diálogo de eliminación; se corrige un `as any` | §7.38 exige que no quede ningún control de eliminación aplicable a estudiantes. El `as any` hacía fallar el lint focalizado del archivo |
| `src/app/api/usuarios/route.ts` | Deja de exigir tutor para un ESTUDIANTE | `padres_hijos` no existe en las migraciones: sobre una base reproducida desde cero el alta fallaba siempre |

### Pruebas de navegador

| Archivo | Cambio |
|---|---|
| `tests/alumnos.spec.ts` | **Nuevo.** Frontera HTTP anónima |
| `tests/alumnos-ui.spec.ts` | **Nuevo.** Interfaz en tres perfiles |
| `tests/alumnos-auth.spec.ts` | **Nuevo.** Sesiones reales por actor |
| `tests/auth.setup.ts` | De dos identidades a siete; siembra académica por la API real |
| `playwright.config.ts` | Cinco proyectos autenticados nuevos; `alumnos-ui` en los tres perfiles |

### Archivos de la remediación

| Archivo | Cambio |
|---|---|
| `supabase/migrations/009_correcciones_revision_alumnos.sql` | **Nuevo.** Restricciones inline, política de lectura propia con rol vigente, mensaje del mismo curso y autocomprobación del contrato |
| `src/app/api/usuarios/route.ts` | Reescrito: rechazo explícito de vínculos parentales, comprobación previa de identidad con `eq`, una sola escritura, compensación verificada |
| `src/services/usuarios.service.ts` | `obtenerRelacionesFamiliares` degrada sólo ante 42P01; se retiran las escrituras parentales |
| `src/services/alumnos.service.ts` | Las lecturas fallidas del historial dejan de reutilizar mensajes escritos para escrituras |
| `src/app/dashboard/usuarios/page.tsx` | Sin requisito de tutor ni escrituras parentales; aviso explícito; se retira el código que quedó muerto |
| `src/components/ui/Input.tsx` | `aria-invalid`, `aria-describedby` compuesto y `role="alert"` en `Input`, `Select` y `Textarea` |
| `src/app/dashboard/alumnos/_components/GestionAlumnos.tsx` | Limpieza de `curso_id` al inactivar; diálogos con estado ocupado coherente; el curso vigente no se ofrece como destino |
| `src/app/dashboard/alumnos/_components/SituacionAcademica.tsx` | Distingue «sin trayectoria» de «no se pudo leer», con reintento |
| `src/lib/validations.ts` | Contrato de espacios en blanco Unicode idéntico al de PostgreSQL |
| `next.config.ts` | Los bancos de prueba salen del binario de producción; sin indicador de desarrollo en corridas automatizadas |
| `src/app/pruebas-ui/*/page.banco.tsx` | Renombrados desde `page.tsx` |
| `tests/alumnos-correcciones.spec.ts` | **Nuevo.** Nueve casos de formulario, diálogos y accesibilidad |
| `tests/usuarios-auth.spec.ts` | **Nuevo.** Nueve casos del alta de cuentas contra Auth y PostgreSQL reales |
| `supabase/tests/harness_produccion.mjs` | **Nuevo.** Doce afirmaciones sobre la aplicación compilada |
| `supabase/tests/correr-autenticadas.mjs` | **Nuevo.** Inyecta las credenciales locales sin escribirlas en disco y se niega a correr fuera de una base de bucle local |
| `supabase/tests/alumnos_academicos_concurrencia.mjs` | Dos escenarios nuevos de corrección concurrente |
| `supabase/tests/alumnos_academicos_rls.sql` | Once aserciones nuevas (51 a 60) |
| `tests/e2e.spec.ts` | Se corrige una aserción heredada que esperaba el destino de redirección sin codificar |

---

## 5. Migraciones, esquema e integridad

Migración **008**, aditiva y posterior a 007. Ninguna migración anterior se
modificó ni se renumeró.

### Objetos creados

| Objeto | Tipo |
|---|---|
| `public.estado_alumno` | ENUM (`ACTIVO`, `INACTIVO`) |
| `public.motivo_cierre_matricula` | ENUM (`CAMBIO_DE_CURSO`, `INACTIVACION`) |
| `public.alumnos` | Tabla, PK = `perfiles.id` |
| `public.matriculas` | Tabla |
| `public.alumnos_academicos` | Vista `security_invoker` |
| `public.matriculas_historial` | Vista `security_invoker` |
| `idx_matriculas_una_activa_por_alumno` | Índice único **parcial** (`WHERE fecha_cierre IS NULL`) |
| `idx_matriculas_alumno_historial`, `idx_matriculas_curso` | Índices de clave foránea |
| `idx_perfiles_legajo_normalizado` | Índice único sin distinguir mayúsculas |
| `perfiles_dni_valido`, `perfiles_legajo_valido` | CHECK sobre `perfiles` |
| 5 funciones de operación + 5 envoltorios públicos | `app_private` / `public` |
| 3 triggers de restricción diferidos + 3 triggers BEFORE | — |

### Cómo se garantiza cada invariante

| Invariante | Mecanismo |
|---|---|
| Como máximo una matrícula vigente por alumno | Índice único parcial |
| ACTIVO ⇒ exactamente una matrícula y legajo | Trigger de restricción diferido (P5511, P5512) |
| INACTIVO ⇒ ninguna matrícula vigente | Mismo trigger (P5513) |
| Solo cursos activos en asignaciones nuevas | Trigger BEFORE con `FOR SHARE` sobre el curso (P5504) |
| Un curso con matrículas vigentes no se inactiva | Trigger BEFORE en `cursos` (P5514) |
| DNI de 7 u 8 dígitos ASCII, único global | CHECK + UNIQUE preexistente |
| Legajo único, manual, obligatorio si ACTIVO | UNIQUE exacto + UNIQUE normalizado + CHECK + trigger |
| Sin borrado físico | Sin GRANT de DELETE/TRUNCATE y sin política; FK `ON DELETE RESTRICT` |

### Códigos SQLSTATE propios

`P5510` DNI inválido · `P5511` ACTIVO sin matrícula · `P5512` ACTIVO sin legajo ·
`P5513` INACTIVO con matrícula · `P5514` curso ocupado · `P5515` legajo inválido ·
`P5516` estado o transición inválidos. Se reutilizan `P5503` (no existe),
`P5504` (referencia inactiva), `P5505` (sin identidad) y `42501` (sin permiso).

Ninguno llega al cliente: el servicio los traduce a mensajes de dominio en
español y las pruebas comprueban que la respuesta no contenga el código.

### Cierre de un hueco preexistente, dentro del alcance

Verificado sobre esta misma base **antes** de escribir la migración:

```sql
SET LOCAL ROLE anon;
TRUNCATE public.perfiles CASCADE;   -- funcionaba: NOTICE truncate cascades to inscripciones, asistencias
```

RLS **no** se aplica a TRUNCATE: es un privilegio de tabla, no una operación de
fila. `perfiles` recibió TRUNCATE y DELETE para `anon` y `authenticated` por los
privilegios por defecto del esquema `public`. Como todo el historial académico de
esta historia cuelga de `perfiles`, cerrarlo es requisito de EPT-9. La migración
revoca `DELETE` y `TRUNCATE` sobre esa tabla para los roles de aplicación;
`service_role` no se toca. Las demás tablas con el mismo hueco quedan registradas
como riesgo fuera de alcance (§ Riesgos).

---

## 6. Matriz de autorización, grants y RLS

### Por actor

| Actor | Listado | Detalle propio | Detalle ajeno | Alta | Corregir DNI/legajo | Cambiar curso | Inactivar | Reactivar | Borrar |
|---|---|---|---|---|---|---|---|---|---|
| DIRECTOR | Todos | Sí | Sí | Sí | Sí | Sí | Sí | Sí | **No existe** |
| ESTUDIANTE | Solo el propio | Sí (solo lectura) | Cero filas | No | No | No | No | No | No existe |
| DOCENTE | Nada | — | Cero filas | No | No | No | No | No | No existe |
| PADRE | Nada | — | Cero filas | No | No | No | No | No | No existe |
| PERSONAL | Nada | — | Cero filas | No | No | No | No | No | No existe |
| Autenticado sin perfil | Nada | — | Cero filas | No | No | No | No | No | No existe |
| Anónimo | Sin privilegio | — | Sin privilegio | No | No | No | No | No | No existe |

Un legajo ajeno **no** devuelve error: devuelve cero filas, para no delatar que
esa persona existe. Las cuatro operaciones de escritura devuelven `403` antes de
validar el cuerpo, de modo que quien no tiene acceso tampoco aprende las reglas.

### Privilegios de tabla

| Tabla | `anon` | `authenticated` |
|---|---|---|
| `public.alumnos` | Ninguno | SELECT |
| `public.matriculas` | Ninguno | SELECT |
| `public.alumnos_academicos` (vista) | Ninguno | SELECT |
| `public.matriculas_historial` (vista) | Ninguno | SELECT |
| `public.perfiles` | Sin DELETE ni TRUNCATE (nuevo) | Sin DELETE ni TRUNCATE (nuevo) |

### Políticas

Cuatro, todas de SELECT. No existe ninguna de INSERT, UPDATE ni DELETE sobre el
modelo académico.

| Tabla | Política | Predicado |
|---|---|---|
| `alumnos` | El director consulta todos los legajos academicos | `(SELECT public.es_director_actual())` |
| `alumnos` | El estudiante consulta su propio legajo academico | `perfil_id = (SELECT app_private.perfil_actual())` |
| `matriculas` | El director consulta todo el historial academico | `(SELECT public.es_director_actual())` |
| `matriculas` | El estudiante consulta su propio historial academico | `alumno_id = (SELECT app_private.perfil_actual())` |

Los predicados van envueltos en `(SELECT …)` para que PostgreSQL los evalúe una
vez por consulta y no por fila. Se comprueba en los asesores: ninguna tabla de
EPT-9 aparece en `auth_rls_initplan`.

### Tres capas, ninguna sustituye a otra

1. **Navegación**: `dashboard/layout.tsx` oculta y bloquea las rutas que el rol no
   puede usar. No es autorización.
2. **Servidor**: `requerirDirector` resuelve el rol con `auth.getUser()` y
   `es_director_actual()`, nunca con datos que el cliente pueda editar.
3. **PostgreSQL**: privilegios mínimos, RLS y funciones que revalidan `auth.uid()`
   y el rol internamente. Ninguna acepta el rol o el usuario como parámetro.

---

## 7. Matriz de aceptación

### EPT-9 — criterios de la historia

| # | Criterio | Evidencia |
|---|---|---|
| 1 | DIRECTOR consulta y actualiza atómicamente | `alumnos_academicos_rls.sql` 13-16, 26-34; `alumnos-auth.spec.ts` «crea, cambia de curso…» |
| 2 | Solo curso existente y activo | RLS 17, 18, 29; auth «rechaza un curso inexistente y uno inactivo» |
| 3 | Una matrícula activa, también ante concurrencia | RLS 3, 16, 34bis.4; concurrencia 17 y 17bis |
| 4 | ACTIVO con matrícula y legajo; INACTIVO sin matrícula | RLS 13, 15, 24.1-24.3, 34bis.1-34bis.3 |
| 5 | Cambio de curso conserva ambos tramos | RLS 26; auth «historial» |
| 6 | Inactivar cierra; reactivar exige curso | RLS 27, 28, 30; auth «inactiva y reactiva desde la interfaz» |
| 7 | Curso ocupado no se inactiva, ni ante carrera | RLS 35; concurrencia 20a y 20b; auth «no puede inactivar un curso con estudiantes» |
| 8 | Nivel derivado, sin copia persistida | RLS 6, 14, 31.2 |
| 9 | Coherencia entre listado, detalle y vista propia | auth «el listado y el detalle persisten»; «consulta su propio legajo» |
| 10 | ESTUDIANTE solo lectura propia; demás sin acceso | RLS 38-43; auth: siete proyectos por actor |
| 11 | DNI de 7 u 8 dígitos, único ante concurrencia | RLS 12, 19.1-19.3, 20; concurrencia 18 |
| 12 | Legajo único, obligatorio al activar, manual | RLS 21, 22, 24.2, 34 |
| 13 | Preexistentes sin datos quedan INACTIVO | RLS 49 |
| 14 | Sin eliminación física en ninguna superficie | RLS 44-48; `alumnos.spec.ts` 405; ui «no ofrece ningún control de eliminación» |
| 15 | Mensajes claros y cero persistencia parcial | RLS 25; auth «traduce el DNI y el legajo duplicados» |
| 16 | Reinicio limpio reproduce todo | `supabase db reset --local` exit 0 |
| 17 | Tipos coinciden con el esquema | Regeneración comparada: sin deriva |
| 18 | Pruebas SQL/RLS, servidor, UI y navegador | Cinco suites, todas ejecutadas |
| 19 | Concurrencia con conexiones reales | `alumnos_academicos_concurrencia.mjs`, 6 escenarios |
| 20 | Responsive y accesible en tres perfiles | `alumnos-ui.spec.ts` 16/16 × 3 |
| 21 | Evidencia con comandos, códigos y capturas | Este documento |
| 22 | Cursos y Niveles sin regresiones | 39 OK, 73 OK, 4 OK; suite completa 176 |
| 23 | Subtareas a Listo solo con evidencia | § Actualizaciones de Jira |
| 24 | EPT-9 sigue En curso | Confirmado |

### EPT-20 a EPT-25

| Subtarea | Evidencia específica |
|---|---|
| **EPT-20** Persistencia | Migraciones 008 y 009; `alumnos_academicos_rls.sql` 69 OK; concurrencia 8 escenarios OK; `db reset` y `db lint` exit 0; `migration list` 001→009 |
| **EPT-21** Tipos, servicios y API | Tipos sin deriva y regeneración determinista; `alumnos.service.ts` + rutas; `tsc` exit 0; ESLint sin errores nuevos; build exit 0; `alumnos.spec.ts` 10 casos, `alumnos-auth.spec.ts` 32 casos y `usuarios-auth.spec.ts` 9 casos, todos verdes |
| **EPT-22** Interfaz | `alumnos-ui.spec.ts` 48 casos (16 por perfil: escritorio, Pixel 5 e iPhone 13) y `alumnos-correcciones.spec.ts` 9 casos; 59 capturas; auditoría de idioma automatizada |
| **EPT-23** DNI y legajo | RLS 12, 19-22, 24, 32-34; concurrencia 18; auth «duplicados reales»; fixtures sintéticos corregidos |
| **EPT-24** Verificación | Los 39 casos obligatorios, § Pruebas |
| **EPT-25** Documentación | Este archivo, `EPT-9/` y los comentarios en las siete incidencias |

---

## 8. Pruebas de base de datos y concurrencia

Todas contra el stack local descartable, después de `supabase db reset --local`.

| Comando | Salida | Código |
|---|---|---|
| `npx supabase --version` | `2.117.0` | 0 |
| `npx supabase db reset --local` | Aplica 001 a 008 | 0 |
| `npx supabase migration list --local` | 001…008 local y remoto | 0 |
| `npx supabase db lint --local --level warning --fail-on error` | `No schema errors found` | 0 |
| `alumnos_academicos_rls.sql` | **69 OK, 0 FALLO** | 0 |
| `alumnos_academicos_concurrencia.mjs` | **8 OK** | 0 |
| `cursos_rls.sql` (regresión) | **39 OK, 0 FALLO** | 0 |
| `niveles_rls.sql` (regresión) | **73 OK, 0 FALLO** | 0 |
| `niveles_concurrencia.mjs` (regresión) | **4 OK** | 0 |

```powershell
Get-Content -Raw supabase/tests/alumnos_academicos_rls.sql |
  docker exec -i supabase_db_educar-para-transformar `
  psql -U postgres -d postgres -v ON_ERROR_STOP=1

node supabase/tests/alumnos_academicos_concurrencia.mjs
```

### Los ocho escenarios de concurrencia

Dos procesos `psql` independientes. El orden es determinista: cada escenario
comprueba con `pg_blocking_pids` que la segunda transacción quedó efectivamente
bloqueada por la primera antes de confirmar. **No se usa ninguna espera por
tiempo**, que daría una prueba que pasa o falla según la carga de la máquina.

| # | Escenario | Resultado |
|---|---|---|
| 17 | Dos matrículas simultáneas para el mismo estudiante | Una sola vigente; la perdedora recibe P5516 |
| 17bis | Dos inserciones directas, sin pasar por las funciones | El índice único parcial rechaza la segunda (23505) |
| 18 | Dos altas simultáneas con el mismo DNI | Solo una confirma (23505); gana la primera |
| 18bis | Dos **correcciones** simultáneas hacia el mismo DNI | Solo una confirma (23505); la perdedora conserva su DNI anterior |
| 18ter | Dos correcciones simultáneas hacia el mismo legajo con distinta caja | Solo una confirma (23505); no hay dos legajos que se lean igual |
| 19 | Cambio de curso contra inactivación del estudiante | El cambio se rechaza (P5513); queda INACTIVO sin matrícula |
| 20a | Asignación primero, inactivación del curso después | La inactivación se rechaza (P5514); el curso sigue activo |
| 20b | Inactivación del curso primero, asignación después | La asignación se rechaza (P5504); no persiste matrícula |

Los escenarios 18bis y 18ter son carreras distintas de la 18, no una
repetición. En un alta las dos transacciones insertan; en una corrección
actualizan filas distintas de `alumnos`, de modo que el `FOR UPDATE` del
principio de la función no las serializa: cada una toma su propia fila sin
esperar a la otra. Lo único que impide que las dos confirmen es el índice
único, y por eso hace falta demostrarlo aparte.

### Casos obligatorios de EPT-24, uno por uno

| # | Caso | Dónde |
|---|---|---|
| 1 | Curso inexistente | RLS 17; auth |
| 2 | Curso inactivo | RLS 18, 29; auth; ui |
| 3 | Alta ACTIVO válida | RLS 13; auth |
| 4 | Alta INACTIVO válida | RLS 15; ui |
| 5 | Una sola matrícula activa | RLS 3, 16 |
| 6 | Cambio de curso con historia | RLS 26; auth |
| 7 | Nivel derivado correcto | RLS 6, 14, 31.2 |
| 8 | Inactivación | RLS 27; auth |
| 9 | Reactivación con curso | RLS 30; auth |
| 10 | Reactivación sin curso rechazada | RLS 28; ui |
| 11 | DNI inválido | RLS 19.1-19.3; auth; ui |
| 12 | DNI duplicado | RLS 20, 33; auth |
| 13 | Legajo inválido | RLS 21 |
| 14 | Legajo duplicado | RLS 22; auth; ui |
| 15 | Estado inválido | RLS 23; auth |
| 16 | Cero persistencia parcial | RLS 25 |
| 17 | Doble matrícula concurrente | Concurrencia 17, 17bis |
| 18 | DNI concurrente | Concurrencia 18 |
| 19 | Asignación frente a inactivación del estudiante | Concurrencia 19 |
| 20 | Asignación frente a inactivación del curso | Concurrencia 20a, 20b |
| 21 | DIRECTOR permitido | RLS 38; auth |
| 22 | ESTUDIANTE propio, solo lectura | RLS 39, 41; auth |
| 23 | ESTUDIANTE ajeno denegado | RLS 40; auth, proyecto `chromium-estudiante-ajeno` |
| 24 | DOCENTE denegado | RLS 42, 43; auth, `chromium-docente` |
| 25 | PADRE denegado | RLS 42, 43; auth, `chromium-padre` |
| 26 | PERSONAL denegado | RLS 42, 43; auth, `chromium-personal` |
| 27 | Usuario sin perfil denegado | RLS 42, 43; auth, `chromium-sin-perfil` |
| 28 | Anónimo denegado | RLS 48; `alumnos.spec.ts` |
| 29 | Ausencia de DELETE | RLS 44-47; `alumnos.spec.ts` 405; ui |
| 30 | Persistencia tras recarga | auth «el listado y el detalle persisten» |
| 31 | Historial visible | RLS 31; auth; ui |
| 32 | Carga, vacío, error, envío y éxito | ui «muestra los estados…», «deshabilita el botón…» |
| 33 | Teclado y foco | ui «retiene el foco en el diálogo…» |
| 34 | Pixel 5 / Chromium | `alumnos-ui.spec.ts` 16/16 |
| 35 | iPhone 13 / WebKit | `alumnos-ui.spec.ts` 16/16 |
| 36 | Copy y accesibilidad en español | ui «nombra en español…» |
| 37 | Regresión de Cursos | `cursos_rls.sql` 39 OK; `cursos-auth.spec.ts` en la suite completa |
| 38 | Regresión de Niveles | `niveles_rls.sql` 73 OK; `niveles_concurrencia.mjs` 4 OK |
| 39 | Producción sin rutas de fixture | auth «el banco visual no queda expuesto» |

---

## 9. Pruebas de servidor y navegador

| Comando | Resultado | Código |
|---|---|---|
| `npx tsc --noEmit --incremental false` | Sin errores | 0 |
| `npx eslint --no-cache <archivos cambiados>` | 0 errores, 1 aviso preexistente | 0 |
| `npm run build` | Compila y prerenderiza | 0 |
| `npx playwright test tests/alumnos.spec.ts` | **10 passed** | 0 |
| `npx playwright test tests/alumnos-ui.spec.ts --project=chromium` | **16 passed** | 0 |
| `npx playwright test tests/alumnos-ui.spec.ts --project=pixel-5-chromium` | **16 passed** | 0 |
| `npx playwright test tests/alumnos-ui.spec.ts --project=iphone-13-webkit` | **16 passed** | 0 |
| `node supabase/tests/correr-autenticadas.mjs tests/alumnos-auth.spec.ts` | **32 casos funcionales, más 9 de siembra en el proyecto `setup`** | 0 |

### Nombres de proyecto: por qué difieren de los del enunciado

El enunciado propone `--project="Pixel 5 - Chromium"` e `"iPhone 13 - WebKit"`.
Los nombres reales configurados en el repositorio desde EPT-55 son
**`pixel-5-chromium`** e **`iphone-13-webkit`**, en minúsculas y con guiones, igual
que `chromium`. Se conservan los nombres existentes: renombrarlos rompería las
invocaciones documentadas de la unidad anterior sin ganar nada. Los perfiles de
dispositivo sí son los pedidos (`devices['Pixel 5']` y `devices['iPhone 13']`).

Proyectos autenticados nuevos: `chromium-estudiante-ajeno`, `chromium-docente`,
`chromium-padre`, `chromium-personal`, `chromium-sin-perfil`.

### Qué se probó realmente, y qué no

| Se demostró | Cómo |
|---|---|
| Persistencia real | `alumnos-auth.spec.ts`: cada aserción atraviesa API, PostgreSQL y RLS; incluye recargas |
| Comportamiento de presentación | `alumnos-ui.spec.ts` contra el banco visual, con la red interceptada |
| Concurrencia | Dos conexiones PostgreSQL reales coordinadas por bloqueos |
| Denegación por actor | Siete proyectos de Playwright, cada uno con su sesión real |

| **No** se demostró | Por qué |
|---|---|
| Comportamiento en producción | Fuera de alcance y prohibido por el encargo |
| Rendimiento bajo carga | No lo pide ningún criterio |
| Migración sobre datos preexistentes reales | La base local se reproduce vacía; el backfill se prueba con perfiles sintéticos (RLS 49) |
| Que la ruta de fixture devuelva 404 en producción | Se comprueba la doble guarda en el código (`NODE_ENV` y `EPT_UI_HARNESS`), no un despliegue real |

---

## 10. Responsive, accesibilidad e idioma

### Responsive

Un único punto de corte, `sm` (640 px). Tabla en escritorio, tarjetas en móvil.
Las tres corridas comprueban `scrollWidth <= clientWidth + 1`: **cero
desplazamiento horizontal** en los tres perfiles.

### Accesibilidad

| Requisito | Cómo se cumple |
|---|---|
| Recorrido completo por teclado | Probado: 8 tabulaciones hacia adelante y 8 hacia atrás sin salir del diálogo |
| Foco inicial correcto | El formulario enfoca «Nombre»; los diálogos, su primer control útil |
| Contención y devolución del foco | `Dialogo` guarda el foco previo y lo restituye al desmontar |
| Escape | Cierra el diálogo, salvo mientras una petición está en vuelo |
| Etiquetas y descripciones | Todos los campos con `label`; el DNI con texto de ayuda |
| `role="alert"` y `role="status"` | Errores y éxitos, dentro de una región `aria-live="polite"` nombrada |
| Región viva nombrada | `aria-label="Estado de la administración de alumnos"` |
| Botones con nombre accesible | `aria-label` por fila: «Inactivar al alumno Arrieta, Camila» |
| Sin confirmaciones nativas | No se usa `window.confirm` en ninguna operación de esta historia |

La apertura del diálogo por teclado en la prueba de foco no es un rodeo: **WebKit
no enfoca un `button` al hacer clic**, así que abrirlo con el ratón dejaría la
devolución del foco sin destino real. Abrirlo con `Enter` prueba el recorrido de
una persona que navega con teclado.

### Idioma

Una prueba automatizada recorre el texto visible y los atributos `aria-label`,
`placeholder` y `title`, y falla si aparece alguna de dieciocho palabras en
inglés. Corre en los tres perfiles. Toda la interfaz, los mensajes de dominio, los
estados y los textos accesibles están en español.

---

## 11. Verificación completa: comandos y códigos

Todo lo de esta tabla se ejecutó en esta remediación, contra la base local
descartable reconstruida desde las migraciones. La columna del resultado dice
lo que realmente imprimió cada comando.

### Base de datos y migraciones

| Comando | Resultado | Salida |
|---|---|---|
| `npx supabase db reset --local` | Aplica 001 → 009 y siembra; la sección 7 de la 009 ejerce su propio contrato | 0 |
| `npx supabase db lint --local --level warning` | `No schema errors found` | 0 |
| `docker exec -i … psql … < supabase/tests/alumnos_academicos_rls.sql` | **69 aserciones OK, 0 FALLO** | 0 |
| `docker exec -i … psql … < supabase/tests/cursos_rls.sql` | **39 aserciones OK, 0 FALLO** | 0 |
| `docker exec -i … psql … < supabase/tests/niveles_rls.sql` | **73 aserciones OK, 0 FALLO** | 0 |
| `node supabase/tests/alumnos_academicos_concurrencia.mjs` | **8 escenarios OK** con dos conexiones reales | 0 |
| `node supabase/tests/niveles_concurrencia.mjs` | **4 escenarios OK** | 0 |

Los tres guiones SQL corren íntegramente dentro de una transacción que termina
en `ROLLBACK`: no dejan nada en la base. Cada aserción está escrita como un
`RAISE EXCEPTION` cuando no se cumple, y `psql` corre con `ON_ERROR_STOP=1`, así
que un incumplimiento termina el proceso con código distinto de cero. Eso no es
una afirmación de diseño: durante esta remediación el guion de alumnos falló de
verdad, con salida 3, en el caso 21, y así se descubrió que el literal de
espacios en blanco de la migración estaba vacío.

### Código

| Comando | Resultado | Salida |
|---|---|---|
| `npx tsc --noEmit --incremental false` | Sin errores | 0 |
| `npx eslint` | 112 problemas: 15 errores y 97 avisos, **todos preexistentes y fuera de los archivos de esta unidad** | 1 |
| `npx next build` (dentro de la prueba de producción) | Compila | 0 |
| `npx supabase gen types typescript --local`, dos veces | Mismo SHA256 `7b77055d2e2d408259dde2dc2c46d9fe5d228921712ea4f36b46fc1f2f151cff`, idéntico al del árbol | 0 |
| `git diff --check` sobre el árbol de trabajo | Sin salida | 0 |

Los quince errores de ESLint están en `(public)/inscripcion`, `(public)/noticias`,
`(public)/quienes-somos`, `dashboard/asistencias`, `dashboard/solicitudes`,
`dashboard/testimonios`, `global-error`, `login` y `context/AuthContext`: ninguno
de esos archivos se toca en esta unidad. En los archivos que sí se tocan queda un
único aviso, `react-hooks/incompatible-library` en `dashboard/usuarios/page.tsx`,
preexistente y ajeno a este cambio. Los tres avisos de variable sin uso que esta
remediación había dejado al retirar la interfaz de vínculos parentales se
limpiaron.

### Servidor, navegador, accesibilidad y responsive

| Comando | Resultado | Salida |
|---|---|---|
| `node supabase/tests/correr-autenticadas.mjs` | **196 pruebas, 196 verdes** | 0 |
| `node supabase/tests/harness_produccion.mjs` | **12 afirmaciones cumplidas** | 0 |

De las 196, **nueve pertenecen al proyecto `setup`**: no comprueban nada del
producto, siembran las siete identidades de prueba y sus sesiones. Los **casos
funcionales son 187**, repartidos así:

| Archivo | Casos | Unidad |
|---|---|---|
| `alumnos-ui.spec.ts` | 48 (16 × escritorio, Pixel 5, iPhone 13) | EPT-9 |
| `alumnos-auth.spec.ts` | 32 | EPT-9 |
| `alumnos.spec.ts` | 10 | EPT-9 |
| `alumnos-correcciones.spec.ts` | 9 | EPT-9 (remediación) |
| `usuarios-auth.spec.ts` | 9 | EPT-9 (remediación) |
| **Subtotal EPT-9** | **108** | |
| `cursos-ui.spec.ts`, `cursos-auth.spec.ts`, `cursos.spec.ts` | 39 | EPT-8, regresión |
| `niveles-*.spec.ts` | 36 | EPT-55, regresión |
| `e2e.spec.ts` | 4 | Base, regresión |
| **Subtotal regresión** | **79** | |
| `auth.setup.ts` | 9 | Siembra, no son casos |
| **Total ejecutado** | **196** | |

Por proyecto: `chromium` 82, `chromium-directora` 41, `chromium-estudiante` 13,
`pixel-5-chromium` 18, `iphone-13-webkit` 18, `chromium-docente` 3,
`chromium-estudiante-ajeno` 3, `chromium-padre` 3, `chromium-personal` 3,
`chromium-sin-perfil` 3, `setup` 9.

### Auditoría de seguridad sobre la base migrada

| Comprobación | Resultado |
|---|---|
| Privilegios de tabla para `anon` y `authenticated` | Sólo `SELECT` en `alumnos`, `matriculas` y sus dos vistas; ninguna escritura directa |
| Funciones de `app_private` ejecutables por `anon` o `PUBLIC` | Ninguna |
| `SECURITY DEFINER` sin `search_path` vacío | Ninguna de las 19 |
| Tablas del dominio sin RLS | Ninguna |
| Políticas de `DELETE` en el dominio | Ninguna |
| Vistas académicas | Las dos con `security_invoker = true` |
| Restricciones CHECK que dependan de `app_private` | Ninguna |
| Funciones del dominio que liguen la identidad con `auth.uid()` | Las cinco |

`anon` conserva `INSERT` y `UPDATE` sobre `perfiles`, heredados del flujo de
preinscripción anterior a esta unidad. Se comprobó por comportamiento que RLS
los anula: como `anon`, el `INSERT` se rechaza con 42501 y el `UPDATE` no alcanza
ninguna fila, porque las tres políticas de `perfiles` son para `authenticated` o
para el propio perfil. Queda registrado como observación, no como hallazgo de
EPT-9.

---

## 12. Fallos preexistentes y regresiones

| Hallazgo | Clasificación | Prueba |
|---|---|---|
| `e2e.spec.ts:8` redirect codificado | Preexistente, **corregido** | Reproducido en el baseline con salida idéntica; `encodeURIComponent` viene de `84ef8c7`, muy anterior a esta unidad, y ninguno de los siete commits de EPT-9 tocó ese camino. La aserción era la equivocada, no el código: se ajustó para aceptar el destino codificado |
| Lint global con errores | Preexistente, **mejorado** | 16 → 15 errores |
| `layout.tsx:130` variable sin usar | Preexistente | Bloque idéntico al baseline |
| Asesor ERROR `rls_disabled_in_public` en `actividades` | Preexistente | Ninguna migración habilitó RLS ahí; 008 no menciona la tabla |
| `padres_hijos` inexistente | Preexistente | Se documenta; esta historia no escribe en ella |
| `eliminarPerfil` afectaba cero filas | Preexistente, **corregido** | Verificado con `SET LOCAL ROLE authenticated; DELETE …` → `DELETE 0` |
| `TRUNCATE` anónimo sobre `perfiles` | Preexistente, **corregido** | Verificado antes y después |

**Regresiones causadas por EPT-9: ninguna.** Con la aserción de `e2e.spec.ts`
corregida, la suite completa queda en verde: 196 de 196.

Durante el desarrollo aparecieron dos
fallos en `cursos-auth.spec.ts` que sí eran responsabilidad de esta unidad: la
siembra académica ocupaba «1er Grado A», el curso que esa suite inactiva por
nombre, y dejaba cursos creados que alteraban su recuento exacto. Se corrigió el
fixture invasor, no la suite de Cursos: sus garantías siguen intactas y ambas
pruebas vuelven a pasar.

---

## 13. Tipos y asesores de Supabase

### Tipos

Generados desde la base local final preservando UTF-8, sin BOM:

```
npx supabase gen types typescript --local > src/types/database.generated.ts
```

De 607 a 829 líneas. Incluyen `alumnos`, `matriculas`, las dos vistas, los dos
enumerados y las cinco funciones. Se regeneró a un archivo temporal fuera del
repositorio y se comparó normalizando únicamente BOM y salto final: **sin deriva**.
El temporal se eliminó.

`src/types/database.types.ts` sigue siendo el archivo manual histórico y no afirma
ser generado; esta historia no lo amplía porque el modelo académico se consume
mediante los tipos de dominio de `alumnos.service.ts`.

### Asesores

`npx supabase db advisors --local --type all --level info`: **32 hallazgos**
(1 ERROR, 20 WARN, 11 INFO).

| Clasificación | Cantidad | Detalle |
|---|---|---|
| Causados por EPT-9 | **2** | `multiple_permissive_policies` en `alumnos` y `matriculas` |
| Preexistentes | 30 | Incluido el único ERROR |
| Críticos o altos causados por el candidato | **0** | — |

Sobre los dos atribuibles: son avisos de rendimiento por tener dos políticas
permisivas de SELECT en la misma tabla. Es el mismo patrón deliberado que
`perfiles` usa desde la migración 001, y aquí su costo es despreciable porque los
dos predicados van envueltos en `(SELECT …)`, de modo que PostgreSQL los evalúa
una vez por consulta y no por fila. La prueba de ello es que **ninguna tabla de
EPT-9 aparece en `auth_rls_initplan`**, mientras que cuatro tablas preexistentes
sí. Separar «el director ve todo» de «el estudiante ve lo suyo» en dos políticas
nombradas se conserva porque hace la regla legible y auditable.

El ERROR `rls_disabled_in_public` sobre `public.actividades` es preexistente:
ninguna migración habilitó RLS en esa tabla y 008 no la menciona.

---

## 14. Documentación y capturas

59 capturas reproducibles en [`EPT-9/`](EPT-9/), generadas con `EPT_CAPTURAS=1`.

Se regeneraron todas después de las correcciones: las anteriores mostraban la
interfaz previa y el indicador flotante de desarrollo de Next, que sugería un
entorno de desarrollo en evidencia que habla del comportamiento del producto.
Ese indicador ahora se apaga durante las corridas automatizadas. Ninguna captura
contiene datos personales reales ni credenciales: los DNI pertenecen al rango
sintético 9x.xxx.xxx y los correos a un dominio reservado. El prefijo del nombre
distingue el origen: `fixture-` es el banco determinista, sin base; `real-` es
una sesión autenticada contra la base local.

| Prefijo | Origen | Qué demuestra |
|---|---|---|
| `fixture-chromium-*` | Banco visual, escritorio | Presentación y estados |
| `fixture-pixel-5-chromium-*` | Banco visual, Pixel 5 | Tarjetas y layout Android |
| `fixture-iphone-13-webkit-*` | Banco visual, iPhone 13 | Tarjetas y layout iOS |
| `real-*` | **Base local real**, sesión de la directora o del estudiante | Persistencia |

Cobertura: listado (tres perfiles), formulario ACTIVO, formulario INACTIVO,
validación, DNI duplicado, legajo duplicado, curso inactivo, cambio de curso,
inactivación, reactivación, carga, vacío, error de servidor, envío en curso,
éxito, sin cursos activos, detalle con historial, vista propia del estudiante y
acceso denegado.

Inspeccionadas visualmente. No contienen tokens, correos reales, DNI reales,
variables de entorno ni datos personales: todos los DNI pertenecen a rangos
sintéticos (`98…`, `99900…`) y los nombres son ficticios. El círculo oscuro con
una «N» que aparece en algunas es el indicador de herramientas de desarrollo de
Next.js, no parte de la aplicación.

### Presentación frente a persistencia

Una captura del banco visual **no** demuestra que algo se haya guardado. La
persistencia se demuestra en `alumnos-auth.spec.ts`, que recarga la página y
vuelve a leer de la base, y en las capturas `real-*`.

---

## 15. Commits y estado de entrega

| SHA | Mensaje |
|---|---|
| `6cd0c3c` | feat(alumnos): agregar persistencia y operaciones seguras del estado académico |
| `348723c` | feat(alumnos): administrar el legajo académico desde el servidor |
| `02e9ed8` | fix(perfiles): quitar la eliminación física de legajos y el falso requisito de tutor |
| `840ad3e` | feat(alumnos): agregar la interfaz administrativa y la vista propia del estudiante |
| `605ec5d` | test(alumnos): probar actores, persistencia real, accesibilidad y responsive |
| `96aea77` | test(alumnos): aislar los fixtures académicos de la suite de Cursos |
| `5419942` | docs(alumnos): registrar la evidencia ejecutada de EPT-9 |

Esos siete son el candidato que la revisión bloqueó. **No se reescribieron:**
conservan sus SHA y su historia. La remediación se aplicó encima, en commits
nuevos:

| Commit | Mensaje | Qué agrupa |
|---|---|---|
| _(nuevo 1)_ | fix(alumnos): corregir la persistencia del alta y endurecer el contrato académico | Migración 009, ruta de usuarios, validaciones, servicios y las pruebas de base |
| _(nuevo 2)_ | fix(alumnos): corregir el formulario, los diálogos y la accesibilidad del legajo | Interfaz, componentes de formulario y sus pruebas de navegador |
| _(nuevo 3)_ | test(alumnos): probar la concurrencia real y la ausencia del banco en producción | Concurrencia de dos conexiones y prueba conductual de producción |
| _(nuevo 4)_ | docs(alumnos): actualizar la evidencia con las correcciones de la revisión | Este documento y las capturas regeneradas |

Once commits convencionales en total, ninguno con `Co-Authored-By` ni atribución
de IA. Las pruebas viajan con la conducta que verifican. Los SHA de los cuatro
commits nuevos no pueden figurar dentro de un archivo que ellos mismos
contienen; se informan en Jira y en la respuesta de la sesión, y se obtienen con
`git log --oneline origin/main..HEAD`.

**No hubo push, ni pull request, ni merge, ni ningún cambio en `main`.**

### Propuesta de división para la revisión

La unidad supera con holgura las 400 líneas revisables (+7306/-263). No se
recortaron pruebas ni se partió la responsabilidad. Para la revisión posterior se
propone esta cadena, en este orden; cada eslabón deja el repositorio coherente:

1. `6cd0c3c` — persistencia e invariantes (migración + pruebas de base).
2. `348723c` — servidor, API y tipos.
3. `02e9ed8` — retiro de la eliminación física.
4. `840ad3e` — interfaz administrativa y vista propia.
5. `605ec5d` + `96aea77` — pruebas de navegador e infraestructura de actores.
6. `5419942` — evidencia de la primera entrega.
7. Los cuatro commits de remediación, en su orden.

Lo primero que conviene revisar son las migraciones 008 y 009: todo lo demás
depende de las garantías que establecen. La 009 se lee bien de arriba abajo,
porque cada sección explica qué defecto cierra. Lo intencionalmente fuera de alcance está en § Riesgos.

---

## 16. Límite de reversión

Revertir esto **no** es simétrico: Git deshace archivos, no un esquema ya aplicado.

| Qué se revierte con Git | Qué **no** |
|---|---|
| Todo el código de aplicación y las pruebas | Las tablas, tipos, índices, funciones, triggers y grants que 008 ya creó en una base donde se aplicó |
| Los archivos `008_alumnos_estado_academico.sql` y `009_correcciones_revision_alumnos.sql` | Las filas `008` y `009` en `supabase_migrations.schema_migrations` |
| La entrada de navegación y las rutas | Las filas de `alumnos` y `matriculas` ya cargadas |

### Orden inverso, si hay que revertir

1. Revertir los cuatro commits de remediación, del último al primero.
2. `git revert 5419942 96aea77 605ec5d 840ad3e 02e9ed8 348723c` (código y pruebas).
3. **No revertir `6cd0c3c` sin más.** Si 008 ya se aplicó, hay que escribir una
   migración `010` que deshaga explícitamente lo aplicable.
4. Nunca editar ni borrar `008` ni `009`: pueden haber sido aplicadas en otro
   entorno. La 009 es aditiva e idempotente, así que reaplicarla es inocuo, pero
   modificarla en el lugar rompería cualquier base que ya la tenga.

Revertir sólo la remediación y dejar el candidato bloqueado sería la peor
opción: devolvería el alta que deja perfiles huérfanos reservando DNI y legajo.
Si hay que retroceder, corresponde retroceder la unidad entera.

### Cómo tendría que ser esa `010`

Deshacer sin perder información académica exige, en este orden: quitar los
triggers de `cursos` y `perfiles`; quitar los CHECK de DNI y legajo y el índice
normalizado; retirar las funciones y envoltorios; **exportar `alumnos` y
`matriculas` antes de cualquier `DROP`**; y solo entonces eliminar las vistas, las
tablas y los enumerados.

Dos consecuencias que conviene decir en voz alta:

- **Eliminar `matriculas` destruye el historial académico.** Si el objetivo es
  desactivar la funcionalidad y no perder datos, lo correcto es revertir el código
  y dejar el esquema en pie: sin la interfaz y sin la API, las tablas quedan
  inertes pero íntegras.
- La revocación de `DELETE` y `TRUNCATE` sobre `perfiles` **no debería revertirse**:
  cerraba un agujero por el que un visitante anónimo podía vaciar la tabla.

---

## 17. Riesgos y trabajo fuera de alcance

### Cerrado en esta unidad porque el modelo académico dependía de ello

- `TRUNCATE` y `DELETE` anónimos sobre `public.perfiles`.
- `eliminarPerfil`, que informaba un éxito falso.
- El requisito de tutor que hacía imposible dar de alta a un estudiante sobre una
  base reproducible.

### Registrado y **no** absorbido

| Riesgo | Dueño | Evidencia |
|---|---|---|
| `anon` conserva `TRUNCATE`/`DELETE` sobre `actividades`, `asistencias`, `galeria`, `inscripciones`, `menu_escolar`, `noticias`, `opiniones`, `postulaciones`, `solicitudes_inscripcion` | EPT-66 | `has_table_privilege('anon', …, 'TRUNCATE')` |
| `public.actividades` sin RLS | EPT-66 | Asesor, nivel ERROR |
| `inscripciones` con RLS y sin políticas | EPT-66 | Asesor, nivel INFO |
| `padres_hijos` consultada por código y ausente de las migraciones | EPT-66 / EPT-13 | Vínculos parentales |
| `opiniones.aprobado` con la misma deriva | EPT-66 | — |
| Redirect codificado del login | EPT-66 | `e2e.spec.ts:8` |
| Dos funciones de 001 sin `search_path` fijo | EPT-66 | Asesor, nivel WARN |
| Permisos generales de roles y PERSONAL | EPT-59 | — |
| Relación «alumnos a cargo» del DOCENTE | Sin contrato reproducible todavía | — |

### Riesgos residuales de esta unidad

- La unicidad de legajo sin distinguir mayúsculas se agregó sobre `perfiles`, que
  también aloja legajos de personal no estudiante. Sobre una base poblada con
  legajos que solo difieran en mayúsculas, la migración **falla de forma explícita**
  en lugar de unificarlos por su cuenta.
- El CHECK de DNI alcanza a todos los perfiles, no solo a estudiantes. Es
  coherente con que la unicidad del DNI ya era global y con que la aplicación
  valida 7 u 8 dígitos desde 001, pero sobre una base con datos incompatibles la
  migración falla y exige corregirlos con la persona titular.
- `GestionAlumnos.tsx` tiene 939 líneas. Sigue el patrón de `GestionNiveles.tsx`,
  pero es el candidato natural a dividirse cuando aparezca la próxima operación.

---

## 18. Retrospectiva

**Lo que funcionó.** Modelar el estado separado de la matrícula desde el principio
evitó el rediseño que habría exigido «una columna curso_id en el alumno». Escribir
la migración completa antes de tocar la aplicación permitió que el modelo pasara
su primer sondeo sin correcciones. Y copiar el patrón de EPT-55 —esquema privado,
funciones que revalidan el rol, envoltorios públicos— hizo que la capa de seguridad
fuera casi mecánica.

**Lo que costó tiempo.** Tres cosas, todas de la misma familia: el trigger diferido
es exactamente tan estricto como debe ser, y eso rompe cualquier limpieza que borre
matrículas y legajos en transacciones separadas. Apareció en la prueba de
concurrencia, en el setup de Playwright y en la limpieza de la propia suite. La
lección es que una invariante de dos lados obliga a que **toda** manipulación de
datos, incluida la de las pruebas, ocurra en una sola transacción.

**Lo que casi se escapa.** Que `.env.local` apuntara a un proyecto remoto no era
evidente: el build pasaba igual. Lo detectó la guarda de hostname que EPT-8 había
dejado en `auth.setup.ts`. Una guarda escrita por otra unidad evitó que las pruebas
autenticadas corrieran contra producción.

**Lo que haría distinto.** Habría verificado el destino de `.env.local` antes de la
primera corrida de Playwright, no después. Y habría revisado qué fixtures comparten
las suites existentes antes de sembrar datos, en vez de descubrir la colisión con
la suite de Cursos en la corrida completa.

### Lo que enseñó la revisión que bloqueó la entrega

**Una prueba que mira el código fuente no prueba el comportamiento.** La entrega
anterior afirmaba que el banco de pruebas devolvía 404 en producción porque la
condición estaba escrita en el archivo. Cuando se midió de verdad, el 404
existía, pero era distinguible del de una ruta inexistente: la protección era
más débil de lo que la evidencia decía. Leer una condición demuestra que alguien
la escribió, nada más.

**Una restricción puede existir y no restringir.** El literal Unicode de la
migración se vació sin dejar rastro visible: la restricción seguía declarada,
con su nombre de siempre, y aceptaba todo. Peor que no tenerla, porque aparenta
cobertura y nadie la vuelve a mirar. De ahí dos hábitos nuevos: los conjuntos de
caracteres se construyen con puntos de código en ASCII, nunca con literales
invisibles ni secuencias de escape, y toda restricción nueva se ejerce dentro de
su propia migración antes de darla por aplicada.

**Ignorar un dato en silencio es peor que rechazarlo.** La ruta de alta recibía
un tutor, no lo guardaba y devolvía éxito. Nadie se enteraba. Rechazar con un
mensaje explícito es menos cómodo y más honesto.

**Un mensaje de error heredado puede mentir.** El traductor de errores devolvía
«Solo el director puede administrar los legajos» a un estudiante que sí puede
ver su propio legajo, porque el texto estaba escrito para una escritura
rechazada y se reutilizó en una lectura. Los mensajes no son intercambiables
entre operaciones.

**Verificar el entorno antes de medirlo.** Dos veces durante esta corrección una
prueba midió el proceso equivocado: un servidor de una corrida anterior seguía
escuchando en el puerto, y en Windows `kill()` sobre un proceso lanzado a través
del intérprete no baja el árbol. Las pruebas que levantan servidores ahora
comprueban el puerto antes de empezar y lo liberan de verdad al terminar.

---

## 19. Próximo paso

1. **Nueva revisión independiente** del candidato corregido. Conviene empezar por
   la migración 009 y por `src/app/api/usuarios/route.ts`: son las dos piezas
   donde estaban los dos hallazgos más graves.
2. Verificar en particular las tres cosas que la revisión anterior pidió no dar
   por buenas sin ejecutarlas: que la suite SQL falle de verdad cuando una
   aserción no se cumple, que la concurrencia use dos conexiones reales, y que
   el 404 de producción se mida sobre la aplicación compilada.
3. Con la revisión aprobada: push, pull request en español y merge, para obtener
   el commit de integración identificable en `main`.
4. Recién entonces EPT-9 puede pasar a `Listo`.
5. La siguiente unidad del plan es **WU-04 (EPT-56 a EPT-59)**. No se inició nada
   de ella.
