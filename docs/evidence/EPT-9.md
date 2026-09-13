# EPT-9 — Situación académica del alumno: evidencia de ejecución

El legajo académico del estudiante quedó implementado de extremo a extremo:
estado separado de la matrícula, historial temporal de cursos que nunca se
sobrescribe, nivel derivado siempre del curso, y las invariantes garantizadas
dentro de PostgreSQL en vez de sólo en la interfaz. Todo lo que este documento
afirma se ejecutó; los comandos y sus códigos de salida están más abajo.

**Estado: corregido tras tres rondas de revisión independiente.** La primera
bloqueó el candidato `5419942` con doce hallazgos; la segunda encontró siete
más; la tercera, siete más. Los veintiséis están cerrados y demostrados.

**EPT-9 y EPT-20 a EPT-25 permanecen todas `En curso`.** No hubo push, ni pull
request, ni merge, ni ningún cambio en `main`.

---

## Ruta rápida

1. Levantar el stack local y reconstruir la base: `npx supabase db reset --local`.
2. Probar la base: las tres suites SQL, las dos de concurrencia y la de colisión
   de migración (§ 8).
3. Probar el código: TypeScript, ESLint y la política de tipos (§ 11).
4. Probar la aplicación: la suite autenticada completa (§ 9 y § 11).
5. Comprobar que los bancos no existen en producción:
   `node supabase/tests/harness_produccion.mjs`, y que ese arnés se sostiene:
   `node supabase/tests/harness_produccion_negativas.mjs`.
6. Revisar las capturas en [`EPT-9/`](EPT-9/), diferenciadas entre banco visual
   (`fixture-*`) y base real (`real-*`).

---

## 0. Cómo leer las cifras de este documento

Una revisión encontró que casi todos los números estaban desactualizados
—commits, líneas, archivos, pruebas—, y tenía razón. La causa no fue descuido:
un archivo versionado no puede afirmar un total sobre su propio commit, porque
el commit que lo contiene cambia ese total en el instante en que se escribe.
Reemplazar esas cifras por otras nuevas habría repetido el problema.

**Los totales de HEAD se piden, no se escriben.**

```bash
git rev-list --count origin/main..HEAD      # cantidad de commits
git log --oneline origin/main..HEAD         # cadena completa
git diff --shortstat origin/main...HEAD     # líneas y archivos
git rev-parse HEAD                          # SHA final
```

**Las métricas exactas se atan a un SHA anterior, nombrado.** Cuando este
documento da un número concreto, se refiere al **candidato funcional previo al
commit documental**:

    2d1d752a0f0b0a9d55ccb443953ead479f1b40a9

Ese commit contiene todo el código y todas las pruebas de la unidad, y nada de
esta documentación. Sus cifras no cambian.

| Métrica del candidato funcional | Valor |
|---|---|
| Commits desde `origin/main` | 22 |
| Archivos tocados | 116 |
| Líneas | +13 925 / −493 |
| Pruebas de navegador | 246, todas verdes |
| Aserciones SQL | 69 + 39 + 73 |
| Escenarios de concurrencia | 8 + 4 |

**El SHA final y las cifras del candidato definitivo se registran fuera de este
archivo**: en el comentario de Jira y en el informe posterior al último commit.
Es el único lugar donde pueden ser exactos.

---

## 1. Las tres rondas de revisión

### Primera ronda: doce hallazgos

Candidato bloqueado: `5419942d698527780477fa74e5a353a943f1955e`.

| # | Hallazgo | Corrección | Prueba |
|---|---|---|---|
| 1 | Persistencia parcial al crear un estudiante con tutor | La ruta rechaza los vínculos en vez de ignorarlos, comprueba DNI y legajo libres antes de tocar Auth, persiste en una sola sentencia y verifica la compensación | `usuarios-auth.spec.ts` |
| 2 | Permiso denegado sobre las funciones de un CHECK | Expresiones inmutables en línea; ningún EXECUTE nuevo | RLS 51 a 53 |
| 3 | Falta una migración progresiva | `009`, aditiva, idempotente, con verificación previa y autocomprobación | `db reset` exit 0 |
| 4 | `btrim(text)` no rechazaba todos los espacios | Conjunto Unicode de 26 puntos de código, idéntico en PostgreSQL y en Zod | RLS 54 a 56 |
| 5 | La lectura propia no exigía conservar el rol ESTUDIANTE | Las dos políticas exigen `perfil_id` propio **y** rol vigente | RLS 57 a 59bis |
| 6 | ACTIVO → INACTIVO dejaba un curso incompatible | El curso se limpia junto con su error | `alumnos-correcciones.spec.ts` |
| 7 | Cuatro defectos de interfaz | Historial ilegible distinguido del vacío; `aria-invalid` y `aria-describedby`; diálogos coherentes; el curso vigente no se ofrece | `alumnos-correcciones.spec.ts` y `alumnos-auth.spec.ts` |
| 8 | La concurrencia de corrección de DNI estaba simulada | Dos escenarios con dos conexiones `psql` reales | Concurrencia 18bis y 18ter |
| 9 | El 404 del banco se afirmaba leyendo el código | Los bancos salen del binario; la prueba compila, levanta y mide | `harness_produccion.mjs` |
| 10 | Integridad de Git y de los tipos | Tipos regenerados, salto de línea final normalizado | `git diff --check` exit 0 |
| 11 | Evidencia y métricas desactualizadas | Cifras recalculadas; recuentos separados | Este documento |
| 12 | Faltaba la lista completa de pruebas | Tabla con comando, código de salida y resultado | § 11 |

**Tres defectos aparecieron durante esa corrección.** El literal Unicode de la
migración estaba **vacío**: la restricción existía, con su nombre de siempre, y
no rechazaba nada, porque `btrim(legajo_nro, '')` no recorta. La comprobación
previa de identidad rompía con un legajo con coma, porque el filtro `or` de
PostgREST se arma concatenando texto. Y el mensaje de un historial ilegible le
decía a un estudiante que sólo el director puede administrar los legajos.

**Y uno se cerró más allá de lo pedido.** El 404 del banco existía pero no era
igual al de una ruta inexistente: Next incluye los segmentos de la URL en la
carga RSC de toda ruta que el enrutador conoce, así que la respuesta confirmaba
que el banco estaba ahí. Los tres bancos pasaron a `page.banco.tsx` y
`pageExtensions` sólo reconoce esa extensión fuera de producción.

### Segunda ronda: siete hallazgos más

| # | Hallazgo | Corrección | Prueba |
|---|---|---|---|
| 13 | `/dashboard/usuarios` no cargaba sobre una base reproducible | El servicio tolera `PGRST205` sólo cuando el mensaje nombra a `padres_hijos` | `usuarios-auth.spec.ts` |
| 14 | La autoverificación de la 009 consumía DNI y legajos fijos | Copia la definición de la restricción a una tabla temporal sin índices únicos | `migracion_009_colisiones.mjs` |
| 15 | Contraste por debajo de WCAG AA | `neutral-400` de 3,07:1 a 4,67:1; el asterisco de 3,81:1 a 4,77:1 | `alumnos-contraste.spec.ts` |
| 16 | El arnés comparaba respuestas por longitud | SHA-256, referencia estable, manifiestos y artefactos | `harness_produccion.mjs` |
| 17 | Los tipos no eran literalmente idénticos a la salida cruda | Política escrita y ejecutable | `tipos-generados.mjs` |
| 18 | Cifras obsoletas y autorreferenciales | Totales por comando; métricas atadas a un SHA nombrado | § 0 |
| 19 | El foco escapaba al deshabilitarse el control enfocado | El cuadro del diálogo es enfocable por programa | `alumnos-correcciones.spec.ts` |

### Tercera ronda: siete hallazgos más

| # | Hallazgo | Corrección | Prueba |
|---|---|---|---|
| 20 | El tabulador escapaba cuando no quedaba ningún control habilitado | El manejador detiene Tab y Shift+Tab y retiene el foco en el cuadro | Prueba de diez pasos en `alumnos-correcciones.spec.ts` |
| 21 | La auditoría de contraste fallaba abierta | Un color no interpretable, la falta de canvas o una medición vacía son fallos; se exigen mínimo y textos esenciales | Tres casos negativos en `alumnos-contraste.spec.ts` |
| 22 | La prueba de `PGRST205` no atravesaba el clasificador | Siete casos que interceptan `padres_hijos`, la única solicitud que llega a él | `usuarios-auth.spec.ts` |
| 23 | La pantalla mostraba el mensaje crudo de Supabase | Mensaje estable en español; el detalle va a `console.error` | Cuatro casos que recorren el DOM visible |
| 24 | El arnés podía colgarse y podía no cerrar | Límite en cada petición y en el arranque; `process.exit` fuera del `try`; cierre garantizado; lista blanca de variables | `harness_produccion_negativas.mjs` |
| 25 | La compensación no distinguía un rechazo de una respuesta perdida | Reconciliación por `user_id` antes de compensar | `usuarios_reconciliacion.mjs` |
| 26 | Evidencia con contradicciones acumuladas | Documento reescrito entero y reconciliado | Este documento |

**Dos defectos más aparecieron en esta ronda, los dos en el propio flujo de
usuarios.** El primero: `42P01` se aceptaba a secas como «falta la tabla», sin
mirar cuál —la misma indulgencia ya corregida para `PGRST205`—, de modo que la
desaparición de cualquier otra tabla se convertía en una lista vacía silenciosa.
El segundo, más grave: con la conexión cortada, la promesa del cliente de
Supabase **no se resuelve ni se rechaza**. El `catch` nunca corría, no aparecía
ningún error y la pantalla quedaba esperando indefinidamente, sin explicación y
sin forma de reintentar. La carga tiene ahora un límite de espera.

### Cada corrección se comprobó al revés

Ninguna se dio por buena sin verificar que su prueba **falla cuando la
corrección se revierte**:

| Corrección revertida | Qué falla |
|---|---|
| Tolerancia a `PGRST205` | 3 de 6 casos del panel |
| Token de contraste a `oklch(0.665)` | La auditoría del listado vacío |
| Retención de foco en el cuadro | «Tab 1: el foco cayó al body» |
| Guardia de la migración 009 | La autoverificación aborta con salida 3 |
| Reconciliación del alta | La cuenta se borra y el perfil queda huérfano |

### Por qué la corrección de la 009 fue en la 009

Una migración posterior no podía arreglarlo: `db reset` aplica la 009 primero y
abortaría antes de llegar a la 010. La corrección tenía que ir ahí.

Que fuera admisible se demostró, no se supuso: `git for-each-ref --contains`
sobre el commit que introdujo la 009 devuelve únicamente la rama local, la rama
no existe en el remoto, no tiene upstream configurado y no hay ningún proyecto
de Supabase vinculado en `supabase/.temp`. La 009 nunca salió de este candidato
y sólo se aplicó contra la instancia de bucle local.

La regla general sigue en pie y está en § 16: **una migración publicada no se
edita.** Ésta no lo estaba, y eso se demostró antes de tocarla.

---

## 2. Línea base y aislamiento

| Dato | Valor |
|---|---|
| Baseline remoto verificado | `e31bdf250e06ca9aae1233c2ee737a0443f4df51` |
| Qué es ese commit | Merge del PR #3 (EPT-55), contiene EPT-8 y EPT-55 integrados |
| Rama de trabajo | `codex/ept-9-academic-students` |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept9` |
| SHA inicial del worktree | `e31bdf250e06ca9aae1233c2ee737a0443f4df51` |
| Candidato funcional | `2d1d752a0f0b0a9d55ccb443953ead479f1b40a9` |
| Estado del árbol al cerrar | Limpio |
| Checkout original | No se modificó, ni se limpió, ni se reseteó, ni se usó para implementar |

```bash
git fetch origin --prune
git merge-base --is-ancestor e31bdf250e06ca9aae1233c2ee737a0443f4df51 origin/main   # exit 0
git worktree add -b codex/ept-9-academic-students E:/Escritorio/codigo/MetodologiaTPI-ept9 e31bdf25
```

No existían ni la rama ni el directorio antes de esta ejecución. Los worktrees
`-ept8` y `-ept55` son de unidades anteriores y no se tocaron.

### Un incidente de entorno que corresponde registrar

El worktree nuevo no traía `.env.local` (está en `.gitignore`). Al copiarlo desde
el checkout original se comprobó que **ese archivo apunta a un proyecto remoto de
Supabase**, no al stack local: la guarda de `tests/auth.setup.ts` lo rechazó por
hostname. El archivo se eliminó del worktree de inmediato.

Antes de detectarlo, una corrida de `tests/alumnos.spec.ts` levantó el servidor de
desarrollo con esa configuración. Sus diez pruebas son anónimas y de sólo lectura:
lo único que llegó al proyecto remoto fueron llamadas `auth.getUser()` sin cookies,
que devuelven «sin usuario». No hubo escrituras, ni lecturas de datos, ni uso de la
clave de servicio.

Desde entonces las credenciales locales se inyectan en el entorno del proceso,
nunca en un archivo. Lo hace `supabase/tests/correr-autenticadas.mjs`, que además
se niega a correr si `API_URL` no es de bucle local: esta suite crea y borra
usuarios y filas, y no debe hacerlo fuera de una base descartable.

---

## 3. Estado de Jira

Consultado al inicio y antes de cada mutación.

| Issue | Estado actual | Padre | Sprint | Responsable |
|---|---|---|---|---|
| EPT-9 | **En curso** | EPT-3 «Legajos y usuarios» | Sprint 2 actualizar alumnos | Lucas Gimenez |
| EPT-20 | **En curso** | EPT-9 | ídem | ídem |
| EPT-21 | **En curso** | EPT-9 | ídem | ídem |
| EPT-22 | **En curso** | EPT-9 | ídem | ídem |
| EPT-23 | **En curso** | EPT-9 | ídem | ídem |
| EPT-24 | **En curso** | EPT-9 | ídem | ídem |
| EPT-25 | **En curso** | EPT-9 | ídem | ídem |

En una ronda anterior cinco subtareas se movieron a `Listo` razonando que sus
definiciones de terminado estaban demostradas. La revisión siguiente encontró
defectos reales en tres de ellas. Volvieron a `En curso` y ahí se quedan: hasta
que una revisión independiente apruebe el candidato, «demostrado por mí» no es
lo mismo que demostrado.

La jerarquía, el sprint y el responsable no cambiaron. No se tocó ninguna
incidencia fuera de estas siete.

---

## 4. Decisiones y arquitectura

### El modelo, en tres piezas separadas a propósito

| Pieza | Qué guarda | Por qué está separada |
|---|---|---|
| `public.perfiles` | Identidad: nombre, apellido, DNI, legajo, vínculo Auth opcional | Sigue siendo la **única** fuente de verdad de una persona. Ya tenía `user_id` nullable, así que un legajo académico puede existir sin cuenta de acceso |
| `public.alumnos` | Sólo el estado académico, con la PK del perfil | `perfiles` aloja los cinco roles; una columna académica quedaría nula para cuatro. Una tabla propia da una superficie RLS exacta sin tocar las políticas de `perfiles` |
| `public.matriculas` | Un tramo por período: alumno, curso, inicio, cierre y motivo | El estado del estudiante y su relación temporal con un curso son cosas distintas. `fecha_cierre IS NULL` marca la vigente |

**El nivel no se persiste en ninguna.** Se deriva de `cursos.nivel_id` en las dos
vistas de lectura. Una prueba comprueba que no exista ninguna columna con «nivel»
en el modelo académico.

### Decisiones que conviene explicar

| Decisión | Motivo |
|---|---|
| Tipos enumerados en vez de VARCHAR + CHECK | Es la garantía más fuerte en la base y el generador de Supabase lo proyecta como una unión exacta de TypeScript |
| Triggers de restricción **diferidos** | La regla «ACTIVO ⇔ una matrícula + legajo» cruza filas y tablas. Diferirlos permite que una operación atómica cierre un tramo y abra otro |
| Escrituras sólo por funciones `app_private` | `authenticated` recibe únicamente SELECT. Aunque alguien otorgara un privilegio por error, RLS seguiría denegando |
| Enumerar los dígitos del DNI (`[0123456789]`) | En PostgreSQL `\d` acepta dígitos no ASCII y un rango `[0-9]` depende de la colación. Verificado: `'1234567٨' ~ '^\d{7,8}$'` da **true** |
| Conjunto de espacios en blanco con `chr()` | Un literal obliga a poner caracteres invisibles en el archivo o a confiar en escapes, y los dos se pueden vaciar sin que se note. Con puntos de código el archivo es ASCII puro y toda pérdida se ve en el diff |
| Unicidad de legajo sin distinguir mayúsculas | El número lo tipea una persona; sin ese índice «A-100» y «a-100» serían dos alumnos que en el listado se ven idénticos |
| El detalle es de sólo lectura | Las operaciones viven en el listado, que es donde el director trabaja sobre varios estudiantes |
| Vista propia en `/dashboard/mi-legajo` | No recibe ni filtra por identificador: pide el listado y RLS devuelve sólo el legajo de la sesión. No hay parámetro que manipular |

### Reconciliación entre Auth y PostgreSQL

El alta de una cuenta toca dos sistemas que no comparten confirmación. **No hay
ni puede haber atomicidad distribuida acá**, y conviene decirlo en lugar de
sugerir lo contrario. Lo que hay es una estrategia de reconciliación explícita.

Un error del cliente de PostgREST significa una de dos cosas muy distintas: que
PostgreSQL rechazó la escritura, o que no sabemos qué pasó porque la respuesta
no llegó. La versión anterior las trataba igual. Antes de borrar nada se
pregunta a PostgreSQL qué pasó, buscando por `user_id`:

| Lo que encuentra | Qué hace |
|---|---|
| El perfil existe y, si es ESTUDIANTE, su fila de `alumnos` también | Da el alta por buena. No compensa |
| No hay ninguna fila | Compensa Auth y verifica el borrado |
| Estado parcial o contradictorio | No borra nada. Registra con un identificador de correlación y devuelve un error operativo |
| La reconciliación tampoco responde | Igual que el anterior |

El identificador de correlación es aleatorio, no lleva datos personales, y sirve
para encontrar el episodio en el registro del servidor.

### Orden de bloqueos

```
alumnos  →  cursos  →  matriculas
```

La inactivación de un curso entra por `cursos` y sólo lee `matriculas`; nunca
sube a `alumnos`, así que no puede cerrar un ciclo con las demás.

### Backfill

Los perfiles ESTUDIANTE preexistentes se incorporan como `INACTIVO`, sin
matrícula y sin legajo inventado. Un trigger `AFTER INSERT ON perfiles`
garantiza lo mismo para los que se creen después. Sobre un reset limpio el
backfill afecta cero filas, porque la migración 001 no siembra perfiles.

---

## 5. Cambios por archivo

### Persistencia

| Archivo | Cambio |
|---|---|
| `supabase/migrations/008_alumnos_estado_academico.sql` | **Nuevo.** Todo el modelo académico, sus invariantes, funciones, grants y RLS |
| `supabase/migrations/009_correcciones_revision_alumnos.sql` | **Nuevo.** Restricciones inline, política de lectura propia con rol vigente, mensaje del mismo curso y autoverificación del contrato sobre tablas temporales |
| `supabase/tests/alumnos_academicos_rls.sql` | **Nuevo.** 69 comprobaciones de estructura, integridad, ciclo de vida y autorización |
| `supabase/tests/alumnos_academicos_concurrencia.mjs` | **Nuevo.** 8 escenarios con dos conexiones PostgreSQL reales |
| `supabase/tests/migracion_009_colisiones.mjs` | **Nuevo.** Reconstruye 001→008, siembra la colisión y comprueba que la 009 aplica igual |
| `supabase/tests/_sesion-psql.mjs` | **Nuevo.** Arnés de dos conexiones, extraído de la prueba de niveles |
| `supabase/tests/niveles_concurrencia.mjs` | Usa el arnés compartido |
| `supabase/tests/cursos_rls.sql`, `niveles_rls.sql` | DNI sintéticos ajustados al contrato nuevo. Ninguna garantía cambia |

### Servidor y API

| Archivo | Cambio |
|---|---|
| `src/services/alumnos.service.ts` | **Nuevo.** Lecturas por vista y cinco operaciones atómicas; traducción de SQLSTATE; las lecturas fallidas no reutilizan mensajes de escritura |
| `src/services/alumnos.client.ts` | **Nuevo.** Cliente del navegador con `ErrorAlumno` |
| `src/app/api/alumnos/route.ts`, `[id]/route.ts` | **Nuevos.** POST del alta y PATCH discriminado con cuatro acciones |
| `src/app/api/usuarios/route.ts` | Rechazo explícito de vínculos parentales, comprobación previa con `eq`, una sola escritura y reconciliación antes de compensar |
| `src/services/usuarios.service.ts` | El clasificador de la ausencia conocida exige el código **y** el nombre de la tabla, para `PGRST205` y para `42P01` |
| `src/lib/validations.ts` | Esquemas Zod y contrato de espacios en blanco Unicode idéntico al de PostgreSQL |
| `src/services/autorizacion.ts` | `requerirSesion` para la vista propia |
| `src/services/cursos.service.ts` | Traduce P5514 a 409 con mensaje de dominio |
| `src/types/database.generated.ts` | Regenerado desde el esquema final por `tipos-generados.mjs` |

### Interfaz

| Archivo | Cambio |
|---|---|
| `src/app/dashboard/alumnos/page.tsx`, `loading.tsx`, `error.tsx` | **Nuevos.** Listado autorizado en el servidor |
| `src/app/dashboard/alumnos/_components/GestionAlumnos.tsx` | **Nuevo.** Alta y las cuatro operaciones. Limpieza de `curso_id` al inactivar; diálogos con estado ocupado coherente; campos congelados durante el envío; foco contenido incluso sin controles habilitados; el curso vigente no se ofrece como destino |
| `src/app/dashboard/alumnos/_components/SituacionAcademica.tsx` | **Nuevo.** Situación e historial; distingue «sin trayectoria» de «no se pudo leer», con reintento |
| `src/app/dashboard/alumnos/[id]/page.tsx`, `loading.tsx` | **Nuevos.** Detalle con historial |
| `src/app/dashboard/mi-legajo/page.tsx` | **Nuevo.** Vista propia del estudiante |
| `src/app/dashboard/usuarios/page.tsx` | Sin requisito de tutor; estado de error persistente con mensaje estable y reintento; límite de espera en la carga |
| `src/components/ui/Input.tsx` | `aria-invalid`, `aria-describedby` compuesto y `role="alert"` en `Input`, `Select` y `Textarea` |
| `src/app/globals.css` | `neutral-400` de `oklch(0.665)` a `oklch(0.56)`: de 3,07:1 a 4,67:1 sobre blanco |
| `src/app/pruebas-ui/*/page.banco.tsx` | **Nuevos**, renombrados desde `page.tsx` |
| `next.config.ts` | Los bancos salen del binario de producción; sin indicador de ruta en corridas automatizadas |
| `src/app/dashboard/layout.tsx` | Entradas «Alumnos» (DIRECTOR) y «Mi legajo» (ESTUDIANTE) |

### Correcciones dentro del alcance

| Archivo | Cambio | Por qué es de EPT-9 |
|---|---|---|
| `src/services/perfiles.service.ts` | Se retira `eliminarPerfil` | Hacía `DELETE FROM perfiles` sin política RLS: afectaba cero filas y devolvía éxito. La interfaz confirmaba una baja que nunca ocurría |
| `src/app/dashboard/legajos/page.tsx` | Se retiran el botón y el diálogo de eliminación | No debe quedar ningún control de eliminación aplicable a estudiantes |
| `src/app/(public)/empleo/page.tsx`, `inscripcion/page.tsx` | El asterisco de campo obligatorio pasa a `red-600` | Mismo defecto de contraste, mismo token. Está fuera del alcance literal y se señala como tal |

### Pruebas

| Archivo | Cambio |
|---|---|
| `tests/alumnos.spec.ts` | **Nuevo.** Frontera HTTP anónima |
| `tests/alumnos-ui.spec.ts` | **Nuevo.** Interfaz en tres perfiles |
| `tests/alumnos-auth.spec.ts` | **Nuevo.** Sesiones reales por actor, más contraste con datos reales |
| `tests/alumnos-correcciones.spec.ts` | **Nuevo.** Formulario, diálogos, foco y accesibilidad |
| `tests/alumnos-contraste.spec.ts` | **Nuevo.** Contraste AA en tres perfiles, con sus casos negativos |
| `tests/usuarios-auth.spec.ts` | **Nuevo.** Alta de cuentas y clasificador de la ausencia conocida |
| `tests/_contraste.ts` | **Nuevo.** Medidor de contraste que falla cerrado |
| `tests/_captura.ts` | **Nuevo.** Captura sin las herramientas de desarrollo de Next |
| `tests/auth.setup.ts` | De dos identidades a siete; siembra académica por la API real |
| `tests/e2e.spec.ts` | Se corrige una aserción heredada que esperaba el destino de redirección sin codificar |
| `playwright.config.ts` | Cinco proyectos autenticados nuevos; `alumnos-ui` y `alumnos-contraste` en los tres perfiles |
| `supabase/tests/_arnes-produccion.mjs` | **Nuevo.** Piezas del arnés, para poder probarlas |
| `supabase/tests/harness_produccion.mjs` | **Nuevo.** Comprobación sobre la aplicación compilada |
| `supabase/tests/harness_produccion_negativas.mjs` | **Nuevo.** El arnés puesto a prueba |
| `supabase/tests/usuarios_reconciliacion.mjs` | **Nuevo.** Reconciliación con un intermediario delante de PostgREST |
| `supabase/tests/tipos-generados.mjs` | **Nuevo.** Política de tipos, ejecutable |
| `supabase/tests/correr-autenticadas.mjs` | **Nuevo.** Inyecta credenciales locales sin escribirlas y verifica el bucle local |

---

## 6. Migraciones, esquema e integridad

Migraciones **008** y **009**, aditivas. Ninguna migración anterior se modificó
ni se renumeró.

### Objetos creados

| Objeto | Tipo |
|---|---|
| `public.estado_alumno` | ENUM (`ACTIVO`, `INACTIVO`) |
| `public.motivo_cierre_matricula` | ENUM (`CAMBIO_DE_CURSO`, `INACTIVACION`) |
| `public.alumnos` | Tabla, PK = `perfiles.id` |
| `public.matriculas` | Tabla |
| `public.alumnos_academicos`, `public.matriculas_historial` | Vistas `security_invoker` |
| `idx_matriculas_una_activa_por_alumno` | Índice único **parcial** (`WHERE fecha_cierre IS NULL`) |
| `idx_matriculas_alumno_historial`, `idx_matriculas_curso` | Índices de clave foránea |
| `idx_perfiles_legajo_normalizado` | Índice único sin distinguir mayúsculas |
| `perfiles_dni_valido`, `perfiles_legajo_valido` | CHECK sobre `perfiles`, con expresiones inmutables en línea |
| 5 funciones de operación + 5 envoltorios públicos | `app_private` / `public` |
| 3 triggers de restricción diferidos + 3 triggers BEFORE | — |

### Cómo se garantiza cada invariante

| Invariante | Mecanismo |
|---|---|
| Como máximo una matrícula vigente por alumno | Índice único parcial |
| ACTIVO ⇒ exactamente una matrícula y legajo | Trigger de restricción diferido (P5511, P5512) |
| INACTIVO ⇒ ninguna matrícula vigente | Mismo trigger (P5513) |
| Sólo cursos activos en asignaciones nuevas | Trigger BEFORE con `FOR SHARE` sobre el curso (P5504) |
| Un curso con matrículas vigentes no se inactiva | Trigger BEFORE en `cursos` (P5514) |
| DNI de 7 u 8 dígitos ASCII, único global | CHECK inline + UNIQUE preexistente |
| Legajo único, manual, obligatorio si ACTIVO | UNIQUE exacto + UNIQUE normalizado + CHECK inline + trigger |
| Sin borrado físico | Sin GRANT de DELETE/TRUNCATE y sin política; FK `ON DELETE RESTRICT` |

### La autoverificación de la 009

La sección 7 de la migración ejerce su propio contrato antes de terminar: si una
restricción quedara sin efecto, aborta en lugar de aplicarse en silencio. Existe
porque eso pasó: una restricción quedó vigente con un conjunto de recorte vacío,
seguía declarada con su nombre de siempre y no rechazaba nada.

La comprobación **no escribe en `public.perfiles`**. Una versión anterior lo
hacía, con un DNI y un legajo fijos, y sobre una base que ya contuviera alguno
de esos valores la migración abortaba por un dato legítimo. Ahora copia la
definición exacta de cada restricción con `pg_get_constraintdef` a una tabla
temporal sin índices únicos ni claves foráneas. Es la misma expresión —no una
transcripción que pueda derivar— y no hay ningún valor con el que chocar.

### Códigos SQLSTATE propios

`P5510` DNI inválido · `P5511` ACTIVO sin matrícula · `P5512` ACTIVO sin legajo ·
`P5513` INACTIVO con matrícula · `P5514` curso ocupado · `P5515` legajo inválido ·
`P5516` estado o transición inválidos. Se reutilizan `P5503` (no existe),
`P5504` (referencia inactiva), `P5505` (sin identidad) y `42501` (sin permiso).

Ninguno llega al cliente: el servicio los traduce a mensajes de dominio en
español y las pruebas comprueban que la respuesta no contenga el código.

### Cierre de un hueco preexistente

Verificado sobre esta misma base **antes** de escribir la migración:

```sql
SET LOCAL ROLE anon;
TRUNCATE public.perfiles CASCADE;   -- funcionaba
```

RLS **no** se aplica a TRUNCATE: es un privilegio de tabla, no una operación de
fila. Como todo el historial académico cuelga de `perfiles`, cerrarlo es
requisito de EPT-9. La migración revoca `DELETE` y `TRUNCATE` sobre esa tabla
para los roles de aplicación; `service_role` no se toca. Las demás tablas con el
mismo hueco quedan registradas como riesgo fuera de alcance (§ 17).

---

## 7. Matriz de autorización, grants y RLS

### Por actor

| Actor | Listado | Detalle propio | Detalle ajeno | Alta | Corregir DNI/legajo | Cambiar curso | Inactivar | Reactivar | Borrar |
|---|---|---|---|---|---|---|---|---|---|
| DIRECTOR | Todos | Sí | Sí | Sí | Sí | Sí | Sí | Sí | **No existe** |
| ESTUDIANTE | Sólo el propio | Sí (sólo lectura) | Cero filas | No | No | No | No | No | No existe |
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
| `public.perfiles` | Sin DELETE ni TRUNCATE | Sin DELETE ni TRUNCATE |

### Políticas

Cuatro, todas de SELECT. No existe ninguna de INSERT, UPDATE ni DELETE sobre el
modelo académico.

| Tabla | Política | Predicado |
|---|---|---|
| `alumnos` | El director consulta todos los legajos academicos | `(SELECT public.es_director_actual())` |
| `alumnos` | El estudiante consulta su propio legajo academico | `perfil_id = (SELECT app_private.perfil_actual()) AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE'` |
| `matriculas` | El director consulta todo el historial academico | `(SELECT public.es_director_actual())` |
| `matriculas` | El estudiante consulta su propio historial academico | `alumno_id = (SELECT app_private.perfil_actual()) AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE'` |

Los predicados van envueltos en `(SELECT …)` para que PostgreSQL los evalúe una
vez por consulta y no por fila. Ninguna tabla de EPT-9 aparece en
`auth_rls_initplan`.

### Tres capas, ninguna sustituye a otra

1. **Navegación**: `dashboard/layout.tsx` oculta las rutas que el rol no puede
   usar. No es autorización.
2. **Servidor**: `requerirDirector` resuelve el rol con `auth.getUser()`, nunca
   con datos que el cliente pueda editar.
3. **PostgreSQL**: privilegios mínimos, RLS y funciones que revalidan
   `auth.uid()` y el rol internamente.

---

## 8. Pruebas de base de datos y concurrencia

Todas contra el stack local descartable, después de `supabase db reset --local`.

| Comando | Resultado | Salida |
|---|---|---|
| `npx supabase db reset --local` | Aplica 001 → 009 y siembra | 0 |
| `npx supabase migration list --local` | 001 a 009, local y remoto alineados | 0 |
| `npx supabase db lint --local --level warning` | `No schema errors found` | 0 |
| `psql < supabase/tests/alumnos_academicos_rls.sql` | **69 aserciones OK, 0 FALLO** | 0 |
| `psql < supabase/tests/cursos_rls.sql` | **39 aserciones OK, 0 FALLO** | 0 |
| `psql < supabase/tests/niveles_rls.sql` | **73 aserciones OK, 0 FALLO** | 0 |
| `node supabase/tests/alumnos_academicos_concurrencia.mjs` | **8 escenarios OK** | 0 |
| `node supabase/tests/niveles_concurrencia.mjs` | **4 escenarios OK** | 0 |
| `node supabase/tests/migracion_009_colisiones.mjs` | **12 afirmaciones OK** | 0 |

Los tres guiones SQL corren íntegramente dentro de una transacción que termina
en `ROLLBACK`: no dejan nada en la base. Cada aserción está escrita como un
`RAISE EXCEPTION`, y `psql` corre con `ON_ERROR_STOP=1`, así que un
incumplimiento termina el proceso con código distinto de cero. Eso no es una
afirmación de diseño: durante la corrección el guion de alumnos falló de verdad,
con salida 3, en el caso 21, y así se descubrió el literal vacío.

### Los ocho escenarios de concurrencia

Dos procesos `psql` independientes. El orden es determinista: cada escenario
comprueba con `pg_blocking_pids` que la segunda transacción quedó efectivamente
bloqueada por la primera antes de confirmar. **No se usa ninguna espera por
tiempo**, que daría una prueba que pasa o falla según la carga de la máquina.

| # | Escenario | Resultado |
|---|---|---|
| 17 | Dos matrículas simultáneas para el mismo estudiante | Una sola vigente; la perdedora recibe P5516 |
| 17bis | Dos inserciones directas, sin pasar por las funciones | El índice único parcial rechaza la segunda (23505) |
| 18 | Dos altas simultáneas con el mismo DNI | Sólo una confirma (23505) |
| 18bis | Dos **correcciones** simultáneas hacia el mismo DNI | Sólo una confirma; la perdedora conserva su DNI anterior |
| 18ter | Dos correcciones hacia el mismo legajo con distinta caja | Sólo una confirma; no hay dos legajos que se lean igual |
| 19 | Cambio de curso contra inactivación del estudiante | El cambio se rechaza (P5513) |
| 20a | Asignación primero, inactivación del curso después | La inactivación se rechaza (P5514) |
| 20b | Inactivación del curso primero, asignación después | La asignación se rechaza (P5504) |

Los escenarios 18bis y 18ter son carreras distintas de la 18, no una repetición.
En un alta las dos transacciones insertan; en una corrección actualizan filas
distintas de `alumnos`, de modo que el `FOR UPDATE` no las serializa. Lo único
que impide que las dos confirmen es el índice único.

### La prueba de colisión de la migración

`migracion_009_colisiones.mjs` trabaja sobre una base propia dentro de la misma
instancia, así que no interfiere con la de la aplicación. Reconstruye 001 → 008,
siembra exactamente los identificadores que la autoverificación consumía, aplica
la 009 y comprueba que termina bien, que los datos legítimos sobreviven y que
los doce casos Unicode se siguen rechazando. Después la aplica **una segunda
vez** para demostrar que es idempotente, y por último degrada la restricción al
defecto original para comprobar que la guardia aborta con salida 3.

---

## 9. Pruebas de servidor y navegador

| Comando | Resultado | Salida |
|---|---|---|
| `npx tsc --noEmit --incremental false` | Sin errores | 0 |
| `npx eslint <archivos de esta unidad>` | 0 errores, **1 aviso** preexistente | 0 |
| `npx eslint` | **124 problemas: 15 errores y 109 avisos**, todos preexistentes | 1 |
| `npx next build` con credenciales de bucle local | Compila | 0 |
| `node supabase/tests/correr-autenticadas.mjs` | **246 pruebas, 246 verdes** | 0 |
| `node supabase/tests/harness_produccion.mjs` | **19 afirmaciones** | 0 |
| `node supabase/tests/harness_produccion_negativas.mjs` | **24 afirmaciones** | 0 |
| `node supabase/tests/usuarios_reconciliacion.mjs` | **25 afirmaciones** | 0 |
| `node supabase/tests/tipos-generados.mjs` | **4 afirmaciones** | 0 |

El único aviso del lint focalizado es `react-hooks/incompatible-library` en
`dashboard/usuarios/page.tsx`, preexistente y ajeno a este cambio.

`npx next build` **a secas falla** con «Missing Supabase env vars» al
prerrenderizar `/bienestar`. No es un defecto de esta unidad: la aplicación
siempre necesitó esas variables en tiempo de compilación. Con ellas, exit 0.

### Recuento honesto

De las 246, **nueve pertenecen al proyecto `setup`**: no comprueban nada del
producto, siembran las siete identidades de prueba y sus sesiones. Los **casos
funcionales son 237**:

| Archivo | Casos | Unidad |
|---|---|---|
| `alumnos-ui.spec.ts` | 48 (16 × tres perfiles) | EPT-9 |
| `alumnos-auth.spec.ts` | 34 | EPT-9 |
| `alumnos-contraste.spec.ts` | 30 (10 × tres perfiles) | EPT-9 |
| `usuarios-auth.spec.ts` | 25 | EPT-9 |
| `alumnos-correcciones.spec.ts` | 11 | EPT-9 |
| `alumnos.spec.ts` | 10 | EPT-9 |
| **Subtotal EPT-9** | **158** | |
| `cursos-*.spec.ts` | 39 | EPT-8, regresión |
| `niveles-*.spec.ts` | 36 | EPT-55, regresión |
| `e2e.spec.ts` | 4 | Base, regresión |
| **Subtotal regresión** | **79** | |
| `auth.setup.ts` | 9 | Siembra, no son casos |
| **Total ejecutado** | **246** | |

Por proyecto: `chromium` 94, `chromium-directora` 58, `pixel-5-chromium` 28,
`iphone-13-webkit` 28, `chromium-estudiante` 14, `chromium-docente` 3,
`chromium-estudiante-ajeno` 3, `chromium-padre` 3, `chromium-personal` 3,
`chromium-sin-perfil` 3, `setup` 9.

### Nombres de proyecto

El enunciado propone `--project="Pixel 5 - Chromium"`. Los nombres reales del
repositorio desde EPT-55 son **`pixel-5-chromium`** e **`iphone-13-webkit`**. Se
conservan: renombrarlos rompería las invocaciones documentadas de la unidad
anterior sin ganar nada. Los perfiles de dispositivo sí son los pedidos.

### Qué se demostró, y qué no

| Se demostró | Cómo |
|---|---|
| Persistencia real | `alumnos-auth.spec.ts`: cada aserción atraviesa API, PostgreSQL y RLS; incluye recargas |
| El alta desde la pantalla | `usuarios-auth.spec.ts`: se crea un ESTUDIANTE sin tutor desde el formulario, se recarga y se comprueba en la base |
| Comportamiento de presentación | `alumnos-ui.spec.ts` contra el banco visual |
| Concurrencia | Dos conexiones PostgreSQL reales coordinadas por bloqueos |
| Denegación por actor | Siete proyectos, cada uno con su sesión real |
| Que los bancos no existan en producción | `harness_produccion.mjs` sobre la aplicación compilada |
| Reconciliación ante una respuesta perdida | `usuarios_reconciliacion.mjs`, con un intermediario delante de PostgREST |

| **No** se demostró | Por qué |
|---|---|
| Comportamiento en producción | Fuera de alcance y prohibido por el encargo |
| Rendimiento bajo carga | No lo pide ningún criterio |
| Migración sobre datos preexistentes reales | La base local se reproduce vacía; el backfill se prueba con perfiles sintéticos (RLS 49) y la colisión con `migracion_009_colisiones.mjs` |

---

## 10. Responsive, accesibilidad e idioma

### Responsive

Un único punto de corte, `sm` (640 px). Tabla en escritorio, tarjetas en móvil.
Las tres corridas comprueban `scrollWidth <= clientWidth + 1`: **cero
desplazamiento horizontal** en los tres perfiles.

### Accesibilidad

| Requisito | Cómo se cumple |
|---|---|
| Recorrido completo por teclado | 8 tabulaciones hacia adelante y 8 hacia atrás sin salir del diálogo |
| Foco contenido con el diálogo ocupado | 5 Tab y 5 Shift+Tab con **cero** controles habilitados: el foco no sale del cuadro |
| Foco inicial correcto | El formulario enfoca «Nombre»; los diálogos, su primer control útil |
| Foco al deshabilitarse el control enfocado | El cuadro es enfocable por programa y lo recibe |
| Contención y devolución del foco | `Dialogo` guarda el foco previo y lo restituye al desmontar |
| Escape | Cierra el diálogo, salvo mientras una petición está en vuelo |
| Etiquetas y descripciones | Todos los campos con `label`; `aria-invalid` y `aria-describedby` cuando hay error |
| `role="alert"` y `role="status"` | Errores y éxitos, dentro de una región `aria-live="polite"` nombrada |
| `aria-busy` | En el diálogo mientras dura la operación |
| Botones con nombre accesible | `aria-label` por fila: «Inactivar al alumno Arrieta, Camila» |
| Sin confirmaciones nativas | No se usa `window.confirm` en ninguna operación |
| Contraste WCAG 2.1 AA | Medido sobre el color que pinta el navegador, en los tres perfiles |

La apertura del diálogo por teclado en la prueba de foco no es un rodeo: **WebKit
no enfoca un `button` al hacer clic**, así que abrirlo con el ratón dejaría la
devolución del foco sin destino real.

### La auditoría de contraste falla cerrada

Medir no alcanza si el instrumento puede callarse. La versión anterior devolvía
`null` ante un color que no podía interpretar y omitía el elemento: una corrida
podía terminar con cero hallazgos sin haber medido nada.

| Condición | Resultado |
|---|---|
| Un texto visible con un color que no se puede interpretar | Fallo |
| Falta el canvas o su contexto | Fallo |
| Se midieron menos elementos que el mínimo declarado | Fallo |
| Un texto esencial declarado no se midió | Fallo |
| Algo medido está por debajo del umbral | Fallo |

Cada informe dice cuántos elementos se inspeccionaron, se midieron y se
omitieron. Tres casos negativos comprueban que el instrumento falla cuando
corresponde.

Valores medidos sobre blanco: `neutral-300` 1,67:1 · `neutral-400` **4,67:1**
(antes 3,07) · `neutral-500` 5,17:1 · `neutral-600` 8,30:1 · `red-500` 3,81:1 ·
`red-600` **4,77:1**.

### Idioma

Una prueba automatizada recorre el texto visible y los atributos `aria-label`,
`placeholder` y `title`, y falla si aparece alguna de dieciocho palabras en
inglés. Corre en los tres perfiles. Cuatro pruebas más comprueban que ningún
mensaje técnico de PostgREST o de PostgreSQL —códigos, nombres de tablas,
`schema cache`, `permission denied`— llegue al DOM visible.

---

## 11. Verificación completa: comandos y códigos

Ejecutada en aislamiento, sin compartir la base local con ningún otro proceso.

| # | Comando | Resultado | Salida |
|---|---|---|---|
| 1 | `docker ps` + `supabase status -o env` | contenedor sano, `API_URL="http://127.0.0.1:54321"` | — |
| 2 | `npx supabase db reset --local` | aplica 001 → 009 | 0 |
| 3 | `npx supabase migration list --local` | 001 a 009 | 0 |
| 4 | `npx supabase db lint --local --level warning` | `No schema errors found` | 0 |
| 5 | `psql < alumnos_academicos_rls.sql` | 69 aserciones OK | 0 |
| 6 | `psql < cursos_rls.sql` | 39 aserciones OK | 0 |
| 7 | `psql < niveles_rls.sql` | 73 aserciones OK | 0 |
| 8 | `node alumnos_academicos_concurrencia.mjs` | 8 escenarios OK | 0 |
| 9 | `node niveles_concurrencia.mjs` | 4 escenarios OK | 0 |
| 10 | `node migracion_009_colisiones.mjs` | 12 afirmaciones OK | 0 |
| 11 | `node tipos-generados.mjs` | 4 afirmaciones OK | 0 |
| 12 | `git diff --check origin/main...HEAD` | sin salida | 0 |
| 13 | `npx tsc --noEmit --incremental false` | sin errores | 0 |
| 14 | `npx eslint <archivos de esta unidad>` | 0 errores, 1 aviso previo | 0 |
| 15 | `npx eslint` | 124 problemas: 15 errores, 109 avisos, todos previos | 1 |
| 16 | `npx next build` con credenciales de bucle local | compila | 0 |
| 17–24, 26 | `node correr-autenticadas.mjs` | 246 pruebas, 246 verdes | 0 |
| 25 | `node harness_produccion.mjs` | 19 afirmaciones OK | 0 |
| 25b | `node harness_produccion_negativas.mjs` | 24 afirmaciones OK | 0 |
| 25c | `node usuarios_reconciliacion.mjs` | 25 afirmaciones OK | 0 |
| 27 | Inspección de capturas | 61 revisadas | — |
| 28 | Escaneo de secretos y atribución | sin coincidencias | — |

Los quince errores de ESLint están en `(public)/inscripcion`,
`(public)/noticias`, `(public)/quienes-somos`, `dashboard/asistencias`,
`dashboard/solicitudes`, `dashboard/testimonios`, `global-error`, `login` y
`context/AuthContext`: ninguno de esos archivos se toca en esta unidad.

### Política de tipos

Se versiona **la salida normalizada** del generador, y la normalización es una
sola regla: quitar las líneas finales en blanco y dejar exactamente un salto.
Nada más.

Hace falta decirlo porque no son idénticos: el generador termina con una línea
en blanco que hace fallar `git diff --check` con «new blank line at EOF». La
evidencia anterior afirmaba que el archivo del repositorio y la salida cruda
coincidían literalmente, y no era cierto: difieren en un byte.

```bash
node supabase/tests/tipos-generados.mjs             # verifica
node supabase/tests/tipos-generados.mjs --escribir  # regenera
```

El script genera dos veces, comprueba que las dos salidas crudas coincidan
(`48d2ab2b…`), normaliza, comprueba que las dos normalizadas coincidan
(`7b77055d…`) y compara byte a byte contra el repositorio. Nadie edita el
archivo a mano. Son 828 líneas e incluyen `alumnos`, `matriculas`, las dos
vistas, los dos enumerados y las cinco funciones.

`src/types/database.types.ts` sigue siendo el archivo manual histórico y no
afirma ser generado.

### Auditoría de seguridad sobre la base migrada

| Comprobación | Resultado |
|---|---|
| Privilegios de tabla para `anon` y `authenticated` | Sólo `SELECT` en `alumnos`, `matriculas` y sus dos vistas |
| Funciones de `app_private` ejecutables por `anon` o `PUBLIC` | Ninguna |
| `SECURITY DEFINER` sin `search_path` vacío | Ninguna de las 19 |
| Tablas del dominio sin RLS | Ninguna |
| Políticas de `DELETE` en el dominio | Ninguna |
| Vistas académicas | Las dos con `security_invoker = true` |
| Restricciones CHECK que dependan de `app_private` | Ninguna |
| Funciones del dominio que liguen la identidad con `auth.uid()` | Las cinco |
| Secretos en el diff | Ninguno; sólo nombres de variables |
| `service_role` fuera del setup de pruebas | No aparece |

`anon` conserva `INSERT` y `UPDATE` sobre `perfiles`, heredados del flujo de
preinscripción anterior a esta unidad. Se comprobó por comportamiento que RLS
los anula: como `anon`, el `INSERT` se rechaza con 42501 y el `UPDATE` no alcanza
ninguna fila. Queda registrado como observación, no como hallazgo de EPT-9.

El arnés de producción y la prueba de reconciliación pasan a sus procesos hijos
una **lista blanca** de variables, no el entorno completo: no heredan
`SUPABASE_SERVICE_ROLE_KEY` ni ningún otro secreto que no necesiten.

---

## 12. Fallos preexistentes y regresiones

| Hallazgo | Clasificación | Prueba |
|---|---|---|
| `e2e.spec.ts:8` redirect codificado | Preexistente, **corregido** | `encodeURIComponent` viene de `84ef8c7`, muy anterior; ninguno de los commits de EPT-9 tocó ese camino. La aserción era la equivocada |
| Lint global con errores | Preexistente | 15 errores, ninguno en archivos de esta unidad |
| Asesor ERROR `rls_disabled_in_public` en `actividades` | Preexistente | Ninguna migración habilitó RLS ahí |
| `padres_hijos` inexistente | Preexistente | El código ya no se cae por su ausencia; la funcionalidad es de EPT-13 |
| `eliminarPerfil` afectaba cero filas | Preexistente, **corregido** | Verificado con `SET LOCAL ROLE authenticated; DELETE …` → `DELETE 0` |
| `TRUNCATE` anónimo sobre `perfiles` | Preexistente, **corregido** | Verificado antes y después |
| `next build` sin credenciales falla | Preexistente | La aplicación siempre las necesitó |

**Regresiones causadas por EPT-9: ninguna.** La suite completa queda en verde:
246 de 246.

Durante el desarrollo aparecieron dos fallos en `cursos-auth.spec.ts` que sí
eran responsabilidad de esta unidad: la siembra académica ocupaba «1er Grado A»,
el curso que esa suite inactiva por nombre. Se corrigió el fixture invasor, no
la suite de Cursos.

---

## 13. Asesores de Supabase

`npx supabase db advisors --local --type all --level info`: **32 hallazgos**
(1 ERROR, 20 WARN, 11 INFO).

| Clasificación | Cantidad | Detalle |
|---|---|---|
| Causados por EPT-9 | **2** | `multiple_permissive_policies` en `alumnos` y `matriculas` |
| Preexistentes | 30 | Incluido el único ERROR |
| Críticos o altos causados por el candidato | **0** | — |

Los dos atribuibles son avisos de rendimiento por tener dos políticas permisivas
de SELECT en la misma tabla. Es el mismo patrón que `perfiles` usa desde 001, y
su costo acá es despreciable porque los predicados van envueltos en `(SELECT …)`.
La prueba es que **ninguna tabla de EPT-9 aparece en `auth_rls_initplan`**.
Separar «el director ve todo» de «el estudiante ve lo suyo» en dos políticas
nombradas se conserva porque hace la regla legible y auditable.

---

## 14. Capturas

61 capturas reproducibles en [`EPT-9/`](EPT-9/), generadas con `EPT_CAPTURAS=1`.

| Prefijo | Origen | Qué demuestra |
|---|---|---|
| `fixture-chromium-*` | Banco visual, escritorio | Presentación y estados |
| `fixture-pixel-5-chromium-*` | Banco visual, Pixel 5 | Tarjetas y layout Android |
| `fixture-iphone-13-webkit-*` | Banco visual, iPhone 13 | Tarjetas y layout iOS |
| `real-*` | **Base local real**, sesión de la directora o del estudiante | Persistencia |

Cobertura: listado (tres perfiles), formulario ACTIVO, formulario INACTIVO,
validación, DNI duplicado, legajo duplicado, curso inactivo, cambio de curso,
inactivación, reactivación, carga, vacío, error de servidor, envío en curso,
éxito, sin cursos activos, detalle con historial, vista propia del estudiante,
historial ilegible, acceso denegado, **estado de error de Usuarios con su
mensaje de dominio** y **diálogo ocupado con el foco contenido**.

Se regeneraron todas después de las correcciones de color y de mensajes. Se
revisaron una por una: ninguna contiene datos personales reales, credenciales,
tokens ni variables de entorno. Los DNI pertenecen a rangos sintéticos
(`96…`, `97…`, `98…`, `99900…`) y los nombres son ficticios.

**Ninguna muestra herramientas de desarrollo.** `devIndicators: false` apaga el
indicador de ruta, pero la documentación de Next dice que los errores de
ejecución se siguen mostrando, y esa insignia aparecía en la captura del estado
de error de Usuarios —donde el fallo se registra a propósito—. Todas las
capturas pasan ahora por un ayudante que oculta el panel del framework antes de
disparar. No se oculta el error: se oculta el panel que lo anuncia. El mensaje
de dominio y el aviso flotante de la aplicación quedan intactos.

### Presentación frente a persistencia

Una captura del banco visual **no** demuestra que algo se haya guardado. La
persistencia se demuestra en `alumnos-auth.spec.ts` y `usuarios-auth.spec.ts`,
que recargan la página y vuelven a leer de la base, y en las capturas `real-*`.

---

## 15. Commits y estado de entrega

La cadena completa, con sus SHA, se obtiene con:

```bash
git log --oneline origin/main..HEAD
```

No se transcribe acá. Enumerar los commits dentro de un archivo que a su vez
genera uno más deja la lista incompleta en el instante en que se escribe.

Agrupados por intención, los commits cubren: la persistencia y las invariantes
de la migración 008; el servidor, la API y los tipos; el retiro de la
eliminación física; la interfaz administrativa y la vista propia; las pruebas de
navegador y la infraestructura de actores; y después, por cada ronda de
revisión, sus correcciones con las pruebas que las verifican.

Ningún commit lleva `Co-Authored-By` ni atribución de IA. Las pruebas viajan con
la conducta que verifican. Los siete commits del candidato original y todos los
posteriores conservan sus SHA: **no se reescribió ninguno**.

**No hubo push, ni pull request, ni merge, ni ningún cambio en `main`.**

### Orden sugerido para la revisión

1. Migración `008` — persistencia e invariantes. Todo lo demás depende de sus
   garantías.
2. Migración `009` — se lee bien de arriba abajo: cada sección explica qué
   defecto cierra.
3. `src/app/api/usuarios/route.ts` — la reconciliación y su justificación.
4. `src/services/usuarios.service.ts` — el clasificador de la ausencia conocida.
5. `GestionAlumnos.tsx` — el diálogo, el foco y el formulario.
6. Las pruebas, junto a la conducta que verifican.

---

## 16. Límite de reversión

Revertir esto **no** es simétrico: Git deshace archivos, no un esquema ya
aplicado.

| Qué se revierte con Git | Qué **no** |
|---|---|
| Todo el código de aplicación y las pruebas | Las tablas, tipos, índices, funciones, triggers y grants que 008 y 009 ya crearon donde se aplicaron |
| Los archivos `008_…sql` y `009_…sql` | Las filas `008` y `009` en `supabase_migrations.schema_migrations` |
| La entrada de navegación y las rutas | Las filas de `alumnos` y `matriculas` ya cargadas |

### Orden inverso

1. Revertir los commits, del último al primero, en el orden inverso al que
   devuelve `git log --oneline origin/main..HEAD`.
2. **No revertir el primero sin más.** Si 008 ya se aplicó, hay que escribir una
   migración `010` que deshaga explícitamente lo aplicable.
3. **Una migración publicada no se edita.** La 009 se corrigió en el lugar en
   esta unidad, y eso fue admisible únicamente porque se demostró que nunca
   había salido de este candidato: no está en ninguna referencia remota, la rama
   no tiene upstream y no hay proyecto de Supabase vinculado. Una vez publicada,
   esa puerta se cierra: cualquier corrección posterior va en una migración
   nueva.

Revertir sólo la remediación y dejar el candidato bloqueado sería la peor
opción: devolvería el alta que deja perfiles huérfanos reservando DNI y legajo,
y el panel de usuarios que no cargaba. Si hay que retroceder, corresponde
retroceder la unidad entera.

### Cómo tendría que ser esa `010`

Deshacer sin perder información académica exige, en este orden: quitar los
triggers de `cursos` y `perfiles`; quitar los CHECK de DNI y legajo y el índice
normalizado; retirar las funciones y envoltorios; **exportar `alumnos` y
`matriculas` antes de cualquier `DROP`**; y sólo entonces eliminar las vistas,
las tablas y los enumerados.

Dos consecuencias que conviene decir en voz alta:

- **Eliminar `matriculas` destruye el historial académico.** Si el objetivo es
  desactivar la funcionalidad sin perder datos, lo correcto es revertir el
  código y dejar el esquema en pie: sin la interfaz y sin la API, las tablas
  quedan inertes pero íntegras.
- La revocación de `DELETE` y `TRUNCATE` sobre `perfiles` **no debería
  revertirse**: cerraba un agujero por el que un visitante anónimo podía vaciar
  la tabla.

---

## 17. Riesgos y trabajo fuera de alcance

### Cerrado en esta unidad porque el modelo académico dependía de ello

- `TRUNCATE` y `DELETE` anónimos sobre `public.perfiles`.
- `eliminarPerfil`, que informaba un éxito falso.
- El requisito de tutor que hacía imposible dar de alta a un estudiante.
- El panel de usuarios, que no cargaba sobre una base reproducible.

### Registrado y **no** absorbido

| Riesgo | Dueño |
|---|---|
| `anon` conserva `TRUNCATE`/`DELETE` sobre `actividades`, `asistencias`, `galeria`, `inscripciones`, `menu_escolar`, `noticias`, `opiniones`, `postulaciones`, `solicitudes_inscripcion` | EPT-66 |
| `public.actividades` sin RLS | EPT-66 |
| `inscripciones` con RLS y sin políticas | EPT-66 |
| El vínculo parental: `padres_hijos` no existe en las migraciones | EPT-13 |
| `opiniones.aprobado` con la misma deriva | EPT-66 |
| Dos funciones de 001 sin `search_path` fijo | EPT-66 |
| Permisos generales de roles y PERSONAL | EPT-59 |
| Relación «alumnos a cargo» del DOCENTE | Sin contrato reproducible todavía |

### Riesgos residuales de esta unidad

- La unicidad de legajo sin distinguir mayúsculas se agregó sobre `perfiles`,
  que también aloja legajos de personal no estudiante. Sobre una base poblada
  con legajos que sólo difieran en mayúsculas, la migración **falla de forma
  explícita** en lugar de unificarlos por su cuenta.
- El CHECK de DNI alcanza a todos los perfiles, no sólo a estudiantes. Sobre una
  base con datos incompatibles la migración falla y exige corregirlos con la
  persona titular.
- `GestionAlumnos.tsx` supera las mil líneas (`wc -l` da el número exacto de cada
  momento). Sigue el patrón de `GestionNiveles.tsx`, pero es el candidato natural
  a dividirse cuando aparezca la próxima operación.
- El límite de espera de la carga de Usuarios es de 15 segundos. Corta una
  espera infinita, pero no distingue una red lenta de una caída: en los dos
  casos ofrece reintentar.
- La reconciliación del alta cubre los estados que se pueden distinguir desde
  fuera. Si Auth y PostgreSQL quedaran inconsistentes de una forma que la
  consulta por `user_id` no revela, la ruta lo informa como error operativo con
  una referencia, y la resolución es manual. Es una decisión deliberada: no
  borrar a ciegas.

---

## 18. Retrospectiva

**Lo que funcionó.** Modelar el estado separado de la matrícula desde el
principio evitó el rediseño que habría exigido «una columna curso_id en el
alumno». Escribir la migración completa antes de tocar la aplicación permitió
que el modelo pasara su primer sondeo sin correcciones. Y copiar el patrón de
EPT-55 —esquema privado, funciones que revalidan el rol, envoltorios públicos—
hizo que la capa de seguridad fuera casi mecánica.

**Lo que costó tiempo.** El trigger diferido es exactamente tan estricto como
debe ser, y eso rompe cualquier limpieza que borre matrículas y legajos en
transacciones separadas. Apareció en la prueba de concurrencia, en el setup de
Playwright y en la limpieza de la propia suite. Una invariante de dos lados
obliga a que **toda** manipulación de datos, incluida la de las pruebas, ocurra
en una sola transacción.

**Lo que casi se escapa.** Que `.env.local` apuntara a un proyecto remoto no era
evidente: el build pasaba igual. Lo detectó una guarda de hostname que EPT-8
había dejado en `auth.setup.ts`.

### Lo que enseñaron las tres revisiones

**Una prueba que mira el código fuente no prueba el comportamiento.** Se afirmó
que el banco devolvía 404 en producción porque la condición estaba escrita en el
archivo. Cuando se midió, el 404 existía pero era distinguible del de una ruta
inexistente. Leer una condición demuestra que alguien la escribió, nada más.

**Una restricción puede existir y no restringir.** El literal Unicode se vació
sin dejar rastro: la restricción seguía declarada y aceptaba todo. Peor que no
tenerla, porque aparenta cobertura. De ahí dos hábitos: los conjuntos de
caracteres se construyen con puntos de código en ASCII, y toda restricción nueva
se ejerce dentro de su propia migración.

**Un instrumento que se calla es peor que uno que falla.** La auditoría de
contraste omitía lo que no entendía y podía terminar con cero hallazgos sin
haber medido nada. Ahora cuenta lo que midió y exige un mínimo.

**Probar la ruta no es probar la pantalla.** `POST /api/usuarios` funcionaba
perfectamente mientras `/dashboard/usuarios` no cargaba. Nueve pruebas pasaban y
la directora no podía dar de alta a nadie.

**Ignorar un dato en silencio es peor que rechazarlo.** La ruta recibía un
tutor, no lo guardaba y devolvía éxito.

**Un mensaje heredado puede mentir, y uno crudo puede delatar.** El traductor
devolvía «Solo el director puede administrar los legajos» a un estudiante que sí
puede ver el suyo. Y la pantalla de usuarios mostraba el mensaje de PostgREST
tal cual: inglés, nombres de tablas internas y códigos.

**Compensar sin reconciliar destruye.** Un error de transporte no es un rechazo.
Tratarlos igual borraba la cuenta de una fila que sí se había guardado.

**Verificar el entorno antes de medirlo.** Cuatro veces una prueba midió el
artefacto equivocado: un servidor de una corrida anterior escuchando en el
puerto; el build de desarrollo bajo `.next/dev`; un bundle servido por un
servidor que no se había reiniciado; y `kill()` en Windows, que no baja el árbol
de procesos. Toda prueba que levanta un servidor comprueba ahora el puerto,
compila en limpio y libera de verdad al terminar.

**Y una espera infinita no avisa.** Con la conexión cortada, la promesa del
cliente de Supabase no se resuelve ni se rechaza. No había error, no había
mensaje: había una pantalla esperando para siempre.

---

## 19. Próximo paso

1. **Nueva revisión independiente** del candidato. Conviene empezar por
   `/dashboard/usuarios` sobre una base reconstruida desde cero: es donde una
   entrega anterior falló sin que ninguna prueba lo notara.
2. Seguir por `src/app/api/usuarios/route.ts` —la reconciliación—, la sección 7
   de la migración 009 y `supabase/tests/harness_produccion.mjs`.
3. Verificar en particular las cosas que las revisiones pidieron no dar por
   buenas sin ejecutarlas: que la suite SQL falle de verdad cuando una aserción
   no se cumple, que la concurrencia use dos conexiones reales, que el 404 de
   producción se mida sobre la aplicación compilada, y que la auditoría de
   contraste falle cuando no puede medir.
4. Con la revisión aprobada: push, pull request en español y merge, para obtener
   el commit de integración identificable en `main`.
5. Recién entonces las subtareas pueden pasar a `Listo`, y después EPT-9.
6. La siguiente unidad del plan es **WU-04 (EPT-56 a EPT-59)**. No se inició nada
   de ella.
