# EPT-9 — Situación académica del alumno: evidencia de ejecución

El legajo académico del estudiante está implementado de extremo a extremo. El
estado está separado de la matrícula, el historial de cursos nunca se
sobrescribe, el nivel se deriva siempre del curso y las invariantes viven en
PostgreSQL, no solo en la interfaz. La cuarta ronda de revisión agregó una
frontera atómica para el alta de cuentas y cerró los clasificadores de errores,
la semántica de controles interactivos, la auditoría de contraste y el arnés de
compilación. Este documento registra qué se ejecutó, con qué comando exacto, con
qué código de salida y con qué resultado.

**Estado.** El candidato verificado de extremo a extremo fue
`c3aaba0394bbdea59cd848a67f38d30fbab7b0be`. El candidato endurecido para revisión
es `72d5fb6f323aefc154d0e725b0ec7f30edb4f754`: conserva ese código productivo y
agrega el cierre de tres defectos del instrumental de prueba. Los 29 pasos de la
verificación integral tuvieron las salidas esperadas sobre `c3aaba0`; el delta
de `72d5fb6` pasó sus pruebas focalizadas, TypeScript, ESLint y `diff --check`.

Los siete bloqueantes de la cuarta revisión están corregidos, pero su evidencia
no tiene una forma uniforme y no se presenta como si la tuviera. Los bloqueantes
1, 2, 3 y 6 tienen mutaciones reproducibles; el 1 también tiene la prueba inversa
N. Los bloqueantes 4 y 5 tienen casos positivos y negativos directos, incluida la
carrera donde el padre termina antes que su descendiente y tres discriminadores
del medidor anterior. El bloqueante 7 se verifica por lectura estructural y
trazabilidad, no mediante una mutación artificial del documento.

**Jira.** EPT-9 y EPT-20 a EPT-25 siguen `En curso`. **Git.** No hubo push, pull
request ni merge, y `main` no cambió. **Revisión independiente del nuevo SHA:
pendiente.**

---

## 0. Cómo leer este documento

### Candidato funcional y commits documentales

El candidato funcional y los commits documentales que lo siguen son cosas
distintas, y conviene no confundirlos:

| Commit | Qué contiene |
|---|---|
| **Candidato integral** `c3aaba0394bbdea59cd848a67f38d30fbab7b0be` | Código productivo, migraciones y pruebas de la cuarta ronda; sobre este SHA corrieron los 29 pasos integrales de la sección 12.1 |
| **Candidato endurecido** `72d5fb6f323aefc154d0e725b0ec7f30edb4f754` | Incorpora dos commits documentales previos y el commit funcional `72d5fb6`, que corrige contraste, capturas y cierre de procesos. Sus verificaciones focalizadas están en 12.1 bis |
| **Commit documental posterior** | Actualiza únicamente este documento con el SHA y los resultados definitivos del endurecimiento |

Un archivo no puede contener el SHA del commit que lo introduce, porque ese SHA
depende del contenido del archivo. Los SHA de los commits documentales quedan en
los comentarios de Jira y en el informe final. Para comprobar que esos commits no
tocan nada más:

```bash
git diff --stat 72d5fb6f323aefc154d0e725b0ec7f30edb4f754 HEAD
```

La salida esperada lista únicamente `docs/evidence/EPT-9.md`.

### Métricas del candidato endurecido, calculadas con Git

| Métrica | Comando | Resultado |
|---|---|---|
| Commits desde la base | `git rev-list --count e31bdf250e06ca9aae1233c2ee737a0443f4df51..72d5fb6f323aefc154d0e725b0ec7f30edb4f754` | `32` |
| Diferencia contra la base | `git diff --shortstat e31bdf250e06ca9aae1233c2ee737a0443f4df51 72d5fb6f323aefc154d0e725b0ec7f30edb4f754` | `132 files changed, 18241 insertions(+), 612 deletions(-)` |
| Commits desde el inicio de la cuarta ronda | `git rev-list --count 4b593a70aa2030c6d1f3051f47d5131b6d41292c..72d5fb6f323aefc154d0e725b0ec7f30edb4f754` | `9` |
| Diferencia desde el inicio de la cuarta ronda | `git diff --shortstat 4b593a70aa2030c6d1f3051f47d5131b6d41292c 72d5fb6f323aefc154d0e725b0ec7f30edb4f754` | `73 files changed, 7094 insertions(+), 2825 deletions(-)` |
| Migraciones en el candidato | `git ls-tree -r --name-only 72d5fb6f323aefc154d0e725b0ec7f30edb4f754 supabase/migrations` | 10 archivos, de `001` a `010` |

De los 132 archivos, 61 son capturas PNG de `docs/evidence/EPT-9/` y 71 son
código, migraciones, pruebas, configuración y este documento en su versión
anterior. Las cifras de rondas previas **no** se copiaron: todas se volvieron a
calcular sobre `72d5fb6`.

### Requisitos para copiar los comandos

- Git Bash en Windows (o un intérprete POSIX), Docker Desktop, Node 24.19.0 y
  ripgrep (`rg`).
- Supabase CLI 2.117.0 por `npx`, con la pila local levantada
  (`npx supabase start`).
- Directorio de trabajo: la raíz del worktree
  `E:\Escritorio\codigo\MetodologiaTPI-ept9`.
- El worktree **no** debe tener `.env.local`: ese archivo apunta a un proyecto
  remoto. Las pruebas leen las credenciales locales de
  `npx supabase status -o env` y se niegan a correr si la API no es de bucle
  local.

### Qué demuestra cada tipo de evidencia, y qué no

| Evidencia | Demuestra | No demuestra |
|---|---|---|
| Guiones SQL (`psql` con `ON_ERROR_STOP=1`) | Invariantes, privilegios y políticas dentro de PostgreSQL. Cada aserción es un `RAISE EXCEPTION`; un incumplimiento corta con salida distinta de cero | El comportamiento de la aplicación |
| Concurrencia con dos conexiones `psql` | Carreras reales, ordenadas con `pg_blocking_pids`, sin esperas por tiempo | Carga o rendimiento |
| Playwright con sesión real (`*-auth.spec.ts`) | Rutas, API, RLS y persistencia de punta a punta sobre la base local | Producción |
| Playwright contra el banco visual (`/pruebas-ui/alumnos`) | Presentación, estados, foco y accesibilidad con datos sintéticos controlados | **Nunca** persistencia: el banco no toca la base |
| Comprobaciones estáticas (`rg`, guardia de AST) | Propiedades del código: ausencia de anidamientos, de borrados, de secuencias | Comportamiento en tiempo de ejecución |
| Capturas | Cómo se vio una pantalla en una corrida concreta | Persistencia, accesibilidad o contraste: eso lo prueban las pruebas |

Una prueba de navegador en verde no prueba una propiedad estática, y una
comprobación estática no prueba comportamiento. Donde un criterio necesita las
dos cosas, la matriz de la sección 8 cita las dos.

---

## 1. Línea base, rama, worktree y SHA

| Dato | Valor | Cómo se verificó |
|---|---|---|
| Base integrada | `e31bdf250e06ca9aae1233c2ee737a0443f4df51` (merge del PR #3, EPT-55; contiene EPT-8 y EPT-55) | `git ls-remote origin refs/heads/main` devolvió ese SHA |
| Rama | `codex/ept-9-academic-students` | `git branch --show-current` |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept9` | — |
| HEAD al iniciar la cuarta ronda | `4b593a70aa2030c6d1f3051f47d5131b6d41292c` | Es ancestro del candidato: `git merge-base --is-ancestor 4b593a70aa2030c6d1f3051f47d5131b6d41292c 72d5fb6f323aefc154d0e725b0ec7f30edb4f754` terminó con salida 0 |
| Candidato integral | `c3aaba0394bbdea59cd848a67f38d30fbab7b0be` | Paso 00 de la sección 12.1 |
| HEAD al iniciar el endurecimiento final | `0fcd853fb27f93f9ad5bd5fa608e981bd9259f11` | Árbol limpio; ancestro directo del candidato endurecido |
| Candidato endurecido | `72d5fb6f323aefc154d0e725b0ec7f30edb4f754` | Commit funcional adicional y pruebas focalizadas de 12.1 bis |
| Rama remota | No existe | `git ls-remote origin 'refs/heads/codex/ept-9-*'` no devolvió nada |
| Pull requests | Ninguno | `gh pr list --head codex/ept-9-academic-students --state all --json number,state,url` devolvió `[]` |
| Checkout original `E:\Escritorio\codigo\MetodologiaTPI` | No se modificó, ni se limpió, ni se reseteó, ni se usó para implementar | — |

Los 23 commits anteriores a esta ronda conservan su SHA: no hubo amend, rebase
ni squash. Los nueve commits posteriores al inicio de la cuarta ronda, en orden:

| Commit | Asunto | Alcance |
|---|---|---|
| `02e5ea6` | `fix(usuarios): hacer segura la reconciliación de altas ambiguas` | 8 archivos, +2739 / −716 |
| `029eb1d` | `fix(alumnos): corregir semántica interactiva y contraste` | 17 archivos, +1286 / −485 |
| `81ff960` | `fix(usuarios): cerrar clasificadores y traducir errores de dominio` | 11 archivos, +932 / −527 |
| `d639e87` | `test(pruebas): acotar el build y ampliar negativos` | 3 archivos, +394 / −199 |
| `3c13a66` | `fix(usuarios): registrar la carga fallida como aviso y esperar los roles` | 3 archivos, +62 / −17 |
| `c3aaba0` | `fix(usuarios): verificar el perfil después de un alta confirmada` | 3 archivos, +75 / −5 |
| `a88aa64` | `docs(alumnos): reconciliar la evidencia final con el candidato` | Documento y capturas de evidencia |
| `0fcd853` | `docs(alumnos): corregir una fila de la matriz de evidencia` | Solo este documento |
| `72d5fb6` | `test(pruebas): cerrar carreras en contraste capturas y procesos` | 6 archivos, +262 / −40 |

---

## 2. Estado de Jira en vivo

Consultado el 14/09/2026 por la API de Atlassian con
`key in (EPT-9, EPT-20, EPT-21, EPT-22, EPT-23, EPT-24, EPT-25)`.

| Incidencia | Tipo | Estado | Padre | Responsable | Última actualización |
|---|---|---|---|---|---|
| EPT-9 «HU7 – Actualizar información académica del alumno» | Historia | **En curso** | EPT-3 «Legajos y usuarios» | Lucas Gimenez | 13/09/2026 13:43 |
| EPT-20 «Agregar a la migración la relación del alumno con su curso y su estado académico» | Subtarea | **En curso** | EPT-9 | Lucas Gimenez | 13/09/2026 10:31 |
| EPT-21 «Corregir los tipos y servicios de perfiles sin asumir cambios no versionados en la base» | Subtarea | **En curso** | EPT-9 | Lucas Gimenez | 13/09/2026 13:43 |
| EPT-22 «Extender el formulario y el listado de legajos para mostrar curso, nivel derivado y estado» | Subtarea | **En curso** | EPT-9 | Lucas Gimenez | 13/09/2026 10:30 |
| EPT-23 «Revisar la creación y edición de usuarios y perfiles para evitar duplicados por DNI» | Subtarea | **En curso** | EPT-9 | Lucas Gimenez | 13/09/2026 13:43 |
| EPT-24 «Probar curso inválido, cambio de curso, cambio de estado y persistencia del legajo» | Subtarea | **En curso** | EPT-9 | Lucas Gimenez | 13/09/2026 13:43 |
| EPT-25 «Actualizar el tablero Kanban, la evidencia y la retrospectiva» | Subtarea | **En curso** | EPT-9 | Lucas Gimenez | 13/09/2026 13:43 |

Ninguna incidencia se movió de estado en esta ronda y no se tocó ninguna fuera
de estas siete. La tabla es anterior a los comentarios de evidencia, publicados
después del primer commit documental: EPT-9 `10125`, EPT-20 `10126`, EPT-21
`10127`, EPT-22 `10128`, EPT-23 `10129`, EPT-24 `10130` y EPT-25 `10131`. Una
consulta posterior a esos comentarios devolvió las siete `En curso`, con última
actualización el 14/09/2026 entre las 06:51 y las 06:52. Los comentarios sobre
commits documentales posteriores quedan en el informe final.

---

## 3. Revisiones y hallazgos

### 3.1 Rondas 1 a 3: 26 hallazgos

La primera revisión bloqueó el candidato `5419942d698527780477fa74e5a353a943f1955e`
con doce hallazgos; la segunda encontró siete más y la tercera otros siete. Las
correcciones se conservan salvo las marcadas como **reemplazadas**, que la cuarta
ronda sustituyó por una solución más fuerte.

| # | Hallazgo | Corrección vigente |
|---|---|---|
| 1 | Persistencia parcial al crear un estudiante con tutor | La ruta rechaza los vínculos en lugar de ignorarlos. **Reemplazada** en lo demás por la frontera atómica de la 010 |
| 2 | Permiso denegado sobre las funciones de un CHECK | Expresiones inmutables en línea, sin EXECUTE nuevo (RLS 51 a 53) |
| 3 | Faltaba una migración progresiva | Migración 009, aditiva, con autoverificación |
| 4 | `btrim(text)` no rechazaba todos los espacios | Conjunto Unicode de 26 puntos de código, igual en PostgreSQL y en Zod (RLS 54 a 56) |
| 5 | La lectura propia no exigía conservar el rol ESTUDIANTE | Las políticas exigen perfil propio y rol vigente (RLS 57 a 59bis) |
| 6 | ACTIVO → INACTIVO dejaba un curso incompatible | El curso se limpia con su error (`alumnos-correcciones.spec.ts:56`) |
| 7 | Cuatro defectos de interfaz | Historial ilegible distinguido del vacío; `aria-invalid`; diálogos coherentes; el curso vigente no se ofrece |
| 8 | La concurrencia de corrección de DNI estaba simulada | Escenarios 18bis y 18ter con dos conexiones reales |
| 9 | El 404 del banco se afirmaba leyendo el código | Los bancos salen del binario; el arnés compila, levanta y mide |
| 10 | Integridad de Git y de los tipos | Tipos regenerados; política de salto de línea final |
| 11 | Evidencia desactualizada | Este documento, reescrito otra vez en la cuarta ronda |
| 12 | Faltaba la lista completa de pruebas | Sección 12 |
| 13 | `/dashboard/usuarios` no cargaba sobre una base reproducible | Tolerancia a la ausencia de `padres_hijos`. **Reemplazada** por el clasificador exacto de la sección 4.5 |
| 14 | La autoverificación de la 009 consumía identificadores fijos | Copia la restricción a una tabla temporal (`migracion_009_colisiones.mjs`) |
| 15 | Contraste por debajo de WCAG AA | Tokens `neutral-400` y asterisco `red-600` |
| 16 | El arnés comparaba respuestas por longitud | SHA-256, referencia estable y manifiestos |
| 17 | Los tipos no eran literalmente la salida cruda | Política escrita y ejecutable (`tipos-generados.mjs`) |
| 18 | Cifras obsoletas y autorreferenciales | Métricas calculadas con Git sobre un SHA nombrado (sección 0) |
| 19 | El foco escapaba al deshabilitarse el control enfocado | El cuadro del diálogo es enfocable por programa |
| 20 | El tabulador escapaba sin controles habilitados | Tab y Shift+Tab retenidos en el cuadro |
| 21 | La auditoría de contraste fallaba abierta | **Reemplazada** por el medidor de la sección 11.1 |
| 22 | La prueba de `PGRST205` no atravesaba el clasificador | **Reemplazada** por los 17 casos de la sección 4.5 |
| 23 | La pantalla mostraba mensajes crudos de Supabase | **Reemplazada** por el catálogo de errores de dominio de la sección 4.4 |
| 24 | El arnés podía colgarse y no cerrar | **Reemplazada** por el build acotado de la cuarta ronda |
| 25 | La compensación no distinguía rechazo de respuesta perdida | **Reemplazada**: ya no hay compensación (sección 4.3) |
| 26 | Evidencia con contradicciones | Este documento |

### 3.2 Cuarta ronda: los siete bloqueantes

| # | Bloqueante | Causa raíz | Corrección | Pruebas positivas | Evidencia negativa, inversa o de mutación |
|---|---|---|---|---|---|
| 1 | Reconciliación ambigua | La ruta leía una vez por `user_id` tras un error de transporte y, si no encontraba nada, borraba la cuenta. Una lectura vacía no prueba ausencia: la escritura podía seguir en vuelo | Migración 010: el perfil nace en la misma transacción que la cuenta. El `id` de la cuenta es la clave de idempotencia. `cuentas.service.ts` no borra en ningún camino y verifica el perfil después de confirmar | Reconciliación A, C, D (confirmación tardía), E, F, I, L, M; SQL de alta atómica 6 a 11 y 20 a 23 | Reconciliación B, G, H, J, K y O; SQL de alta atómica 12 a 19; **inversa** N (el código de `4b593a70` borra la cuenta y deja un perfil huérfano); mutaciones M2 y M5 |
| 2 | Errores técnicos visibles | Los servicios relanzaban el mensaje de PostgREST o de Auth y la pantalla lo mostraba | Catálogo `src/lib/errores.ts` con estados 400, 401, 403, 409, 422, 500 y 503; traducción por nombre exacto de restricción; la interfaz solo muestra mensajes con código de dominio | `usuarios-auth.spec.ts` (50 casos) y `alumnos-auth.spec.ts` | Guardia `tests/_sin-detalle-tecnico.ts` sobre texto visible, nombres accesibles y respuestas; «la respuesta no contiene detalle técnico» en 11 comprobaciones de la reconciliación; mutación M1 |
| 3 | Clasificador permisivo | `padres_hijos_backup` o `padres_hijos_old` pasaban por la ausencia documentada | `src/lib/vinculos.ts`: 404, código `PGRST205` o `42P01`, mensaje completo anclado y exactamente `public.padres_hijos` | 2 casos tolerados | 14 casos no tolerados, más la conexión cortada; mutación M3 |
| 4 | Build sin límite | `next build` podía colgarse para siempre | `ejecutarConLimite` con techo configurable (`EPT_LIMITE_BUILD_MS`), cierre del árbol completo de procesos, lista blanca de variables | `harness_produccion.mjs` (21 afirmaciones) | `harness_produccion_negativas.mjs` (58 afirmaciones): build colgado, árbol con hijo y nieto, padre que termina antes que su descendiente, arranque sin respuesta, puerto ocupado, secretos y limpieza. Son negativos directos; no se registró una mutación separada |
| 5 | Contraste | El medidor omitía lo que no entendía y dividía otra vez por alfa sobre valores ya no premultiplicados | `tests/_contraste.ts` falla cerrado, inspecciona cada nodo de texto y todas sus líneas, informa elementos inspeccionados, medidos y omitidos, compone con la pila real de pintura y aplica el umbral exacto | 7 casos de estados por perfil | 16 casos negativos por perfil: incluyen la cuenta de alfa anterior, dos nodos con el mismo padre, contraste insuficiente después de la tercera línea y un ratio 4,496. Son discriminadores directos del código anterior; no se ejecutó una mutación de repositorio adicional |
| 6 | Controles anidados | Cinco composiciones `Link → Button` en pantallas de EPT-9 | `EnlaceBoton`: un único `<a>` con el estilo de botón | Enlace único con nombre, destino, Tab y Enter en `alumnos-auth.spec.ts:700`, `:724` y `:942` | Guardia estática sobre la superficie de EPT-9, con caso sintético negativo; mutación M4 |
| 7 | Evidencia | Métricas copiadas, comandos incompletos, filas agrupadas, afirmaciones sin ejecución | Este documento, reconciliado primero sobre `c3aaba0` y actualizado con el candidato `72d5fb6` | Matrices individuales, comandos copiables y lectura estructural de las secciones 0, 8 y 12 | No corresponde inventar una mutación documental: la comprobación es la consistencia entre Git, comandos, resultados y filas |

### 3.3 Hallazgos de la verificación final de esta ronda

La primera corrida completa con capturas sobre `d639e87` terminó con 307 pruebas
aprobadas y **2 fallidas**. Las dos se diagnosticaron antes de tocar código.

| Hallazgo | Causa | Corrección | Prueba |
|---|---|---|---|
| La captura del error de carga de Usuarios encontró abierto el diálogo de error de Next | La pantalla registraba una carga fallida, ya manejada, con `console.error`. En desarrollo, Next trata cada `console.error` del navegador como un defecto y abre su diálogo | `console.warn` con el código de dominio (commit `3c13a66`) | Los 14 negativos del clasificador exigen que el registro exista y sea un aviso; los 2 positivos, que no exista. Mutación M1 |
| `tolera PGRST205 de public.padres_hijos y la pantalla carga` leyó el selector de rol vacío | `allTextContents()` no reintenta, y el formulario se dibuja antes de terminar la carga | Aserción que reintenta por opción (commit `3c13a66`) | Suite completa en verde, sin reintentos |

Al redactar este documento apareció un tercer problema: el comentario de la
migración 010 afirmaba que, si una versión de GoTrue dejara de escribir
`app_metadata` dentro de la transacción, la ruta detectaría la cuenta sin perfil.
No era cierto. Ante un alta confirmada, el servicio respondía éxito sin mirar el
perfil. El commit `c3aaba0` agrega esa verificación y el escenario O la prueba
con el trigger realmente deshabilitado.

### 3.4 Cada corrección falla si se revierte

Las mutaciones que sí se ejecutaron se aplicaron a mano sobre un solo archivo, se corrió la prueba que
debía detectarla y se restauró el archivo. La restauración se comprobó por
SHA-256. Las mutaciones M1, M3 y M4 corrieron sobre archivos que son idénticos
byte a byte en `c3aaba0`, porque ese commit no los toca.

| # | Archivo | Cambio aplicado | Comando | Resultado con la mutación |
|---|---|---|---|---|
| M1 | `src/app/dashboard/usuarios/page.tsx` | `console.warn('[usuarios] no se pudo cargar la pantalla', …)` pasa a `console.error(…)` | `node supabase/tests/correr-autenticadas.mjs tests/usuarios-auth.spec.ts --project=chromium-directora -g "solo la ausencia exacta" --retries=0 --reporter=list` | Salida 1: `14 failed`, `13 passed`. Fallan los 14 negativos, en la aserción del registro como aviso |
| M2a | Función `app_private.registrar_perfil_de_alta()` (dentro de una transacción) | Cuerpo reemplazado por uno que retira `ept_alta` y no crea el perfil | Ver bloque M2 en la sección 12 | Salida 3: `ERROR:  FALLO 6: el alta no creó el perfil con los datos pedidos` |
| M2b | Trigger `registrar_perfil_al_crear_cuenta` (dentro de una transacción) | `ALTER TABLE auth.users DISABLE TRIGGER registrar_perfil_al_crear_cuenta` | Ver bloque M2 en la sección 12 | Salida 3: `ERROR:  FALLO 3: el trigger no tiene la forma esperada: <NULL>` |
| M3 | `src/lib/vinculos.ts` | El clasificador vuelve a aceptar `PGRST205` o `42P01` con cualquier mensaje que contenga `padres_hijos` | `node supabase/tests/correr-autenticadas.mjs tests/usuarios-auth.spec.ts --project=chromium-directora -g "solo la ausencia exacta" --retries=0 --reporter=list` | Salida 1: `7 failed`, `20 passed`. Fallan exactamente `padres_hijos_backup`, `padres_hijos_old`, `otra_padres_hijos`, el mismo código sin el esquema exacto, con texto agregado, `42P01` sin el esquema exacto y el estado HTTP distinto de 404 |
| M4 | `src/app/dashboard/alumnos/[id]/page.tsx` | El `EnlaceBoton` vuelve a ser `<Link><Button>…</Button></Link>` | `node supabase/tests/correr-autenticadas.mjs tests/semantica-estatica.spec.ts --project=chromium --retries=0 --reporter=list` | Salida 1: `1 failed`, con el hallazgo `src\app\dashboard\alumnos\[id]\page.tsx:41 — <Button> dentro de <Link>` |
| M5 | `src/services/cuentas.service.ts` | El caso `confirmada` vuelve a devolver éxito sin consultar el perfil | `node supabase/tests/usuarios_reconciliacion.mjs` | Salida 1: `179 afirmaciones, 2 incumplida(s)`: `FALLO  O: sin el trigger, la ruta no afirma éxito: responde 500 ESTADO_INCONSISTENTE (200 undefined)` |
| N | Código real de la ruta en `4b593a70` | Prueba inversa, sin mutar nada: el arnés extrae la ruta anterior de Git y la ejecuta frente a un INSERT en vuelo | `node supabase/tests/usuarios_reconciliacion.mjs` | `OK  N: la ruta anterior BORRÓ la cuenta tras una sola lectura vacía` y `OK  N: resultado del código anterior: un perfil huérfano, sin cuenta` |

Después de M2 se comprobó que la función y el trigger quedaron exactamente como
estaban: `md5(prosrc)`, `prosecdef`, `proconfig` y `tgenabled` idénticos antes y
después (`51ecdb426c6bbb79f8cdad237d57757e|t|{"search_path=\"\""}|O`).

---

## 4. Decisiones y arquitectura

### 4.1 El modelo, en tres piezas separadas a propósito

| Pieza | Qué guarda | Por qué está separada |
|---|---|---|
| `public.perfiles` | Identidad: nombre, apellido, DNI, legajo y vínculo opcional con Auth | Es la única fuente de verdad de una persona. `user_id` admite nulos, así que un legajo puede existir sin cuenta de acceso |
| `public.alumnos` | Solo el estado académico, con la clave primaria del perfil | `perfiles` aloja cinco roles; una columna académica quedaría nula para cuatro. Una tabla propia da una superficie RLS exacta |
| `public.matriculas` | Un tramo por período: alumno, curso, inicio, cierre y motivo | El estado del estudiante y su relación temporal con un curso son cosas distintas. `fecha_cierre IS NULL` marca la vigente |

El nivel **no se persiste** en ninguna de las tres: se deriva de
`cursos.nivel_id` en las vistas de lectura (RLS 6 y 14).

### 4.2 Decisiones que conviene explicar

| Decisión | Motivo |
|---|---|
| Tipos enumerados en lugar de texto con CHECK | Es la garantía más fuerte en la base, y el generador de Supabase la proyecta como una unión exacta de TypeScript |
| Triggers de restricción **diferidos** | «ACTIVO ⇔ una matrícula y legajo» cruza filas y tablas. Diferirlos permite que una operación cierre un tramo y abra otro dentro de la misma transacción |
| Escrituras académicas solo por funciones de `app_private` | `authenticated` recibe únicamente SELECT sobre el modelo académico. Aunque alguien otorgara un privilegio por error, RLS seguiría denegando |
| Dígitos del DNI enumerados (`[0123456789]`) | En PostgreSQL `\d` acepta dígitos no ASCII, y un rango `[0-9]` depende de la colación |
| Espacios en blanco construidos con `chr()` | El archivo queda en ASCII puro: un literal invisible puede vaciarse sin que el diff lo muestre |
| Legajo único sin distinguir mayúsculas | «A-100» y «a-100» serían dos alumnos que en el listado se ven idénticos |
| Detalle de solo lectura | Las operaciones viven en el listado, donde la dirección trabaja sobre varios estudiantes |
| Vista propia en `/dashboard/mi-legajo` | No recibe identificador: pide el listado y RLS devuelve solo el legajo de la sesión |

### 4.3 Alta de cuentas: dónde hay atomicidad y dónde no

**Qué es atómico.** `POST /api/usuarios` hace una sola escritura:
`auth.admin.createUser` con el perfil en `app_metadata.ept_alta`. GoTrue v2.196.0
—la versión de la pila local, verificada— inserta la fila en `auth.users` y
actualiza `raw_app_meta_data` dentro de una única transacción de PostgreSQL. El
trigger `BEFORE INSERT OR UPDATE OF raw_app_meta_data` de la migración 010 lee esa
clave, la retira de la fila y crea el perfil en la misma transacción. Si el rol es
ESTUDIANTE, el trigger de `perfiles` de la migración 008 crea además su legajo
académico `INACTIVO`. Cuenta, perfil y legajo académico se confirman juntos o no
se confirma ninguno. Eso es atomicidad en sentido técnico: una transacción, no una
compensación.

**Qué no es atómico.** La respuesta HTTP, en los dos tramos: navegador → ruta y
ruta → GoTrue. Una respuesta puede perderse, llegar tarde o no llegar, y en ese
caso la ruta no sabe si la transacción confirmó.

**Idempotencia.** El formulario genera un UUID v4 por alta y lo conserva mientras
reintenta. Ese UUID es el `id` de la cuenta. Un reintento con el mismo `id`
converge: si el intento anterior confirmó, choca con la clave primaria y la
consulta encuentra la cuenta; si sigue en vuelo, espera en la clave primaria; si
nunca llegó, crea la cuenta.

**Clasificación.** La ruta nunca interpreta un error de transporte como ausencia,
y no borra cuentas en ningún camino: `rg -n "deleteUser" src` no devuelve
coincidencias (salida 1).

| Situación observada | Resultado | HTTP |
|---|---|---|
| GoTrue confirma y la consulta posterior encuentra cuenta y perfil coherentes | Alta confirmada | 200 |
| GoTrue confirma y la consulta posterior no responde | Alta confirmada; la ruta registra que no pudo verificar el perfil | 200 |
| GoTrue confirma y la cuenta quedó sin perfil o con otros datos | `ESTADO_INCONSISTENTE`, con referencia; no se borra ni se inventa nada | 500 |
| Rechazo determinista y la consulta confirma que no quedó nada | `ALTA_RECHAZADA`, con referencia | 422 |
| Respuesta explícita y existen cuenta y perfil con los mismos datos (respuesta perdida o reintento) | Alta confirmada y reconciliada | 200 |
| Respuesta explícita y el mismo `id` tiene otros datos | `OPERACION_REUTILIZADA` | 409 |
| Respuesta explícita y el DNI, el legajo o el email son de otra persona | `DNI_DUPLICADO`, `LEGAJO_DUPLICADO` o `EMAIL_DUPLICADO` | 409 |
| Algún resultado de transporte quedó sin resolver al agotar intentos o plazo | `ALTA_SIN_CONFIRMAR`, con referencia; nada se borró y reintentar converge | 503 |
| GoTrue rechaza la contraseña (`weak_password`) o el formato de los datos | `CONTRASENA_RECHAZADA` o `DATOS_INVALIDOS` | 422 o 400 |
| GoTrue no acepta la clave administrativa, o limita la frecuencia en todos los intentos | `SERVICIO_NO_DISPONIBLE`, con referencia | 503 |

Las dos últimas filas no tienen una prueba dedicada en esta ronda: el formato de
los datos se valida antes con Zod (`usuarios-auth.spec.ts:281` y `:297`), y la
clave administrativa y la frecuencia no se pueden alterar sin tocar la
configuración de la pila local.

**Límites.** La garantía depende de que GoTrue escriba `raw_app_meta_data` dentro
de la transacción de alta. Si una versión futura dejara de hacerlo, o si el
trigger faltara, la verificación posterior lo detecta y responde
`ESTADO_INCONSISTENTE` (escenario O). La consulta posterior agrega una lectura por
alta. Si esa lectura no responde, el alta se informa confirmada porque la garantía
es la transacción, y el caso queda registrado en el servidor.

**Por qué `raw_app_meta_data` y nunca `raw_user_meta_data`.** El autorregistro
público escribe `raw_user_meta_data`; si el trigger leyera ese campo, cualquier
visitante podría fabricarse un perfil. `raw_app_meta_data` solo lo escribe la API
administrativa. `anon`, `authenticated` y `service_role` no tienen privilegios de
escritura sobre `auth.users` (alta atómica 4). La clave `ept_alta` se retira antes
de guardar la fila, así que los datos personales no quedan en `auth.users` ni
viajan en el JWT (alta atómica 8, 10 y 23).

### 4.4 Errores de dominio

`src/lib/errores.ts` define el catálogo. La interfaz solo confía en el texto de
una respuesta cuando trae un `codigo` conocido. Lo demás se muestra como un
mensaje genérico honesto.

| Código | HTTP | Mensaje exacto |
|---|---|---|
| `NO_AUTENTICADO` | 401 | Necesitás iniciar sesión para continuar. |
| `SIN_PERMISO` | 403 | No tenés permiso para realizar esta operación. |
| `CUERPO_INVALIDO` | 400 | La solicitud no tiene un formato válido. |
| `DATOS_INVALIDOS` | 400 | Revisá los datos ingresados. |
| `VINCULO_NO_DISPONIBLE` | 400 | Los vínculos entre padres o tutores e hijos todavía no están disponibles. Creá la cuenta sin vincular y registrá la relación cuando la funcionalidad esté publicada. |
| `ROL_INEXISTENTE` | 422 | El rol elegido no existe. Actualizá la página y elegí otro. |
| `DNI_DUPLICADO` | 409 | Ya existe una persona registrada con ese DNI. |
| `LEGAJO_DUPLICADO` | 409 | Ya existe un legajo con ese número. |
| `EMAIL_DUPLICADO` | 409 | Ya existe una cuenta con ese email. |
| `CONTRASENA_RECHAZADA` | 422 | La contraseña no cumple los requisitos de seguridad. Elegí una más larga o más compleja. |
| `OPERACION_REUTILIZADA` | 409 | Este envío ya se registró con otros datos. Revisá el listado de usuarios y, si hace falta, volvé a cargar el formulario desde cero. |
| `ALTA_RECHAZADA` | 422 | No se pudo crear la cuenta con estos datos. No se guardó ningún dato. |
| `ALTA_SIN_CONFIRMAR` | 503 | No pudimos confirmar si la cuenta se creó. No se borró ningún dato. Revisá el listado de usuarios antes de volver a intentarlo: si reintentás desde este mismo formulario, la cuenta no se duplica. |
| `ESTADO_INCONSISTENTE` | 500 | Encontramos la cuenta en un estado que no esperábamos y no la modificamos. Avisale al equipo técnico con la referencia. |
| `SIN_CAMBIOS` | 409 | No se guardaron los cambios: el registro ya no existe o tu perfil no puede modificarlo desde este panel. |
| `CARGA_FALLIDA` | 503 | No pudimos cargar la información. Intentá nuevamente. |
| `SERVICIO_NO_DISPONIBLE` | 503 | El servicio no está disponible en este momento. Volvé a intentarlo en unos minutos. |
| `ERROR_INESPERADO` | 500 | No pudimos completar la operación. Volvé a intentarlo en unos minutos. |

El detalle técnico va solo al registro del servidor, con una referencia aleatoria
y clasificaciones, sin datos personales. En el navegador se registra únicamente
el código de dominio, y una carga fallida manejada se registra como aviso, no
como error (sección 3.3). Las respuestas de `ALTA_RECHAZADA`,
`ALTA_SIN_CONFIRMAR`, `ESTADO_INCONSISTENTE` y `SERVICIO_NO_DISPONIBLE` llevan la
referencia para que el equipo técnico encuentre el episodio.

### 4.5 El clasificador de la ausencia conocida de `public.padres_hijos`

`padres_hijos` no existe en el esquema versionado; su funcionalidad pertenece a
EPT-13. La pantalla de Usuarios la consulta y tiene que cargar igual, así que esa
ausencia, y solo esa, se degrada a «no hay vínculos». `src/lib/vinculos.ts` exige
a la vez la forma real de un error de PostgREST, el estado HTTP 404, el código
`PGRST205` o `42P01`, el mensaje completo de ese código anclado de principio a fin
y, dentro de él, exactamente `public.padres_hijos`.

**Casos reales: 17**, todos en `tests/usuarios-auth.spec.ts`, proyecto
`chromium-directora`, interceptando la lectura de `padres_hijos` y atravesando
servicio y pantalla reales:

| Grupo | Casos |
|---|---|
| Tolerados (2) | `PGRST205` de `public.padres_hijos`; `42P01` de `public.padres_hijos` |
| No tolerados (14) | `padres_hijos_backup`; `padres_hijos_old`; `otra_padres_hijos`; `roles`; `matriculas`; el mismo mensaje con otro código; el mismo código sin el esquema exacto; el mismo código con texto agregado al mensaje; `42P01` sin el esquema exacto; un permiso denegado sobre `padres_hijos`; el código y el mensaje exactos con un estado HTTP que no es 404; un error sin código; un cuerpo que no es un error de PostgREST; un tiempo agotado de PostgreSQL |
| Conexión cortada (1) | La promesa del cliente no se resuelve ni se rechaza; el límite de carga la convierte en un error visible |

### 4.6 Orden de bloqueos y backfill

El orden es `alumnos → cursos → matriculas`. La inactivación de un curso entra
por `cursos` y solo lee `matriculas`, así que no puede cerrar un ciclo con las
demás operaciones. Los perfiles ESTUDIANTE preexistentes se incorporan como
`INACTIVO`, sin matrícula y sin legajo inventado (RLS 49). Sobre un reinicio
limpio el backfill afecta cero filas, porque la migración 001 no siembra perfiles.

---

## 5. Cambios por archivo

Rama completa contra la base. **R4** marca los archivos que la cuarta ronda
modificó o creó.

### Persistencia

| Archivo | Cambio |
|---|---|
| `supabase/migrations/008_alumnos_estado_academico.sql` | Nuevo. Modelo académico, invariantes, funciones, grants y RLS |
| `supabase/migrations/009_correcciones_revision_alumnos.sql` | Nuevo. Restricciones en línea, lectura propia con rol vigente y autoverificación sobre tablas temporales |
| `supabase/migrations/010_alta_atomica_de_cuentas.sql` | **R4.** Nuevo. Función y trigger del alta atómica, con autoverificación de privilegios y forma del trigger |
| `supabase/tests/usuarios_alta_atomica.sql` | **R4.** Nuevo. 23 aserciones del alta atómica |
| `supabase/tests/alumnos_academicos_rls.sql` | Nuevo. 69 aserciones de estructura, integridad, ciclo de vida y autorización |
| `supabase/tests/alumnos_academicos_concurrencia.mjs` | Nuevo. 8 escenarios con dos conexiones reales |
| `supabase/tests/_sesion-psql.mjs` | Nuevo. Arnés de dos conexiones, extraído de la prueba de Niveles |
| `supabase/tests/migracion_009_colisiones.mjs` | Nuevo. Reconstruye 001 → 008, siembra la colisión y aplica la 009 dos veces |
| `supabase/tests/niveles_concurrencia.mjs` | Usa el arnés compartido; los cuatro escenarios no cambian |
| `supabase/tests/cursos_rls.sql`, `supabase/tests/niveles_rls.sql` | Solo cambian DNI sintéticos para cumplir el contrato de 7 u 8 dígitos (sección 13.4) |
| `supabase/tests/tipos-generados.mjs` | Nuevo. Política de tipos ejecutable |

### Servidor y API

| Archivo | Cambio |
|---|---|
| `src/app/api/alumnos/route.ts`, `src/app/api/alumnos/[id]/route.ts` | Nuevos. Alta y PATCH con cuatro acciones; autorizan antes de leer el cuerpo |
| `src/app/api/usuarios/route.ts` | **R4.** Reescrita: catálogo de errores, clave de idempotencia, alta por `cuentas.service.ts`, sin compensación |
| `src/services/cuentas.service.ts` | **R4.** Nuevo. Alta idempotente, clasificación de resultados y verificación posterior; nunca borra |
| `src/services/supabase.admin.ts` | **R4.** Límite de 4 s por petición administrativa |
| `src/lib/errores.ts` | **R4.** Nuevo. Catálogo de errores de dominio y traducción por restricción exacta |
| `src/lib/vinculos.ts` | **R4.** Nuevo. Clasificador exacto de la ausencia de `public.padres_hijos` |
| `src/services/usuarios.service.ts` | **R4.** Clave de operación, límite de 60 s, respuestas sin código tratadas como alta sin confirmar |
| `src/services/perfiles.service.ts` | Se retira `eliminarPerfil`. **R4:** traducción de errores y límite de escritura de 15 s |
| `src/services/roles.service.ts` | **R4.** Traducción de errores de lectura |
| `src/services/alumnos.service.ts` | Nuevo. Lecturas por vista y operaciones por función. **R4:** duplicados por nombre exacto de restricción y 503 sin respuesta |
| `src/services/alumnos.client.ts` | Nuevo. **R4:** límite de 20 s y mensaje de dominio sin respuesta |
| `src/lib/validations.ts` | Esquemas Zod y contrato de espacios Unicode igual al de PostgreSQL |
| `src/services/autorizacion.ts` | `requerirSesion` para la vista propia; la identidad sale de `auth.getUser()` |
| `src/services/cursos.service.ts` | Traduce `P5514` a 409 con mensaje de dominio |
| `src/types/database.generated.ts` | Regenerado desde el esquema final |

### Interfaz

| Archivo | Cambio |
|---|---|
| `src/app/dashboard/alumnos/page.tsx`, `loading.tsx`, `error.tsx` | Nuevos. **R4:** `EnlaceBoton` en lugar de `Link → Button`; `error.tsx` usa `unstable_retry` y registra solo el `digest` |
| `src/app/dashboard/alumnos/[id]/page.tsx`, `[id]/loading.tsx` | Nuevos. **R4:** `EnlaceBoton` |
| `src/app/dashboard/alumnos/_components/GestionAlumnos.tsx` | Nuevo. Alta y cuatro operaciones. **R4:** nombre accesible que contiene la etiqueta visible (WCAG 2.5.3) y mensajes solo de `ErrorAlumno` |
| `src/app/dashboard/alumnos/_components/SituacionAcademica.tsx` | Nuevo. **R4:** reintento con `EnlaceBoton` |
| `src/app/dashboard/mi-legajo/page.tsx` | Nuevo. **R4:** `EnlaceBoton` |
| `src/app/dashboard/usuarios/page.tsx` | Sin requisito de tutor. **R4:** aviso persistente del alta, clave de operación, mensajes de dominio y registro de la carga fallida como aviso |
| `src/app/dashboard/layout.tsx` | Entradas «Alumnos» y «Mi legajo». **R4:** el acceso restringido usa `EnlaceBoton` |
| `src/app/dashboard/legajos/page.tsx` | Se retiran el botón y el diálogo de eliminación |
| `src/components/ui/EnlaceBoton.tsx`, `src/components/ui/estilosDeBoton.ts` | **R4.** Nuevos. Enlace con el estilo de botón; `Button.tsx` usa las mismas clases |
| `src/components/ui/Input.tsx` | `aria-invalid`, `aria-describedby` compuesto y `role="alert"` |
| `src/app/globals.css` | Token `neutral-400` más oscuro para alcanzar AA |
| `src/app/(public)/empleo/page.tsx`, `src/app/(public)/inscripcion/page.tsx` | Asterisco de campo obligatorio en `red-600`, por contraste |
| `src/app/pruebas-ui/alumnos/page.banco.tsx` | Nuevo banco visual; los de Cursos y Niveles pasan a `page.banco.tsx` |
| `next.config.ts` | Los bancos salen del binario de producción; sin indicador de ruta en las corridas automatizadas |

### Pruebas

| Archivo | Cambio |
|---|---|
| `tests/usuarios-auth.spec.ts` | Nuevo. **R4:** reescrito, 50 casos |
| `tests/alumnos-auth.spec.ts` | Nuevo. **R4:** privilegios retirados, enlace único por actor y contraste con datos reales; 40 casos |
| `tests/alumnos-contraste.spec.ts` | Nuevo. **R4:** 20 casos por perfil, 13 negativos |
| `tests/semantica-estatica.spec.ts`, `tests/_semantica.ts` | **R4.** Nuevos. Guardia estática y comprobaciones de enlace único |
| `tests/_contraste.ts` | **R4.** Reescrito, falla cerrado |
| `tests/_sin-detalle-tecnico.ts` | **R4.** Nuevo. Guardia de detalle técnico |
| `tests/_captura.ts` | **R4.** Falla si hay un diálogo de error de Next abierto y transcribe su texto |
| `tests/alumnos-ui.spec.ts`, `tests/alumnos-correcciones.spec.ts` | Nuevos. **R4:** nombre accesible actualizado |
| `tests/alumnos.spec.ts` | Nuevo. Frontera HTTP anónima |
| `tests/auth.setup.ts` | De dos identidades a siete; siembra académica por la API real |
| `tests/e2e.spec.ts` | Se corrige una aserción heredada que esperaba el destino de redirección sin codificar |
| `playwright.config.ts` | Cinco proyectos autenticados nuevos; `alumnos-ui` y `alumnos-contraste` en tres perfiles |
| `supabase/tests/_arnes-produccion.mjs`, `harness_produccion.mjs`, `harness_produccion_negativas.mjs` | **R4.** Build acotado, cierre de árbol de procesos, lista blanca de variables |
| `supabase/tests/usuarios_reconciliacion.mjs` | **R4.** Reescrito: intermediario con planes por petición y 15 escenarios, de A a O, uno de ellos la prueba inversa |
| `supabase/tests/correr-autenticadas.mjs` | Inyecta credenciales locales sin escribirlas y verifica el bucle local |

---

## 6. Migraciones, esquema e integridad

`git diff --name-status e31bdf250e06ca9aae1233c2ee737a0443f4df51 c3aaba0394bbdea59cd848a67f38d30fbab7b0be -- supabase/migrations`
devolvió exactamente `A 008_alumnos_estado_academico.sql`,
`A 009_correcciones_revision_alumnos.sql` y `A 010_alta_atomica_de_cuentas.sql`:
tres migraciones agregadas y ninguna migración de la base modificada.

### Objetos

| Objeto | Migración | Tipo |
|---|---|---|
| `public.estado_alumno` (`ACTIVO`, `INACTIVO`), `public.motivo_cierre_matricula` | 008 | Enumerados |
| `public.alumnos`, `public.matriculas` | 008 | Tablas con RLS |
| `public.alumnos_academicos`, `public.matriculas_historial` | 008 | Vistas `security_invoker` |
| `idx_matriculas_una_activa_por_alumno` | 008 | Índice único parcial (`WHERE fecha_cierre IS NULL`) |
| `idx_matriculas_alumno_historial`, `idx_matriculas_curso` | 008 | Índices de clave foránea |
| `idx_perfiles_legajo_normalizado` | 008 | Índice único sin distinguir mayúsculas |
| `perfiles_dni_valido`, `perfiles_legajo_valido` | 008, redefinidas en 009 | CHECK con expresiones inmutables en línea |
| Cinco funciones de operación en `app_private` y cinco envoltorios en `public` | 008 | Funciones |
| Triggers de coherencia académica (diferidos) y de validación de curso activo | 008 | Triggers |
| `app_private.registrar_perfil_de_alta()` y trigger `registrar_perfil_al_crear_cuenta` sobre `auth.users` | 010 | Función y trigger |

### Cómo se garantiza cada invariante

| Invariante | Mecanismo | Prueba |
|---|---|---|
| Como máximo una matrícula vigente por alumno | Índice único parcial | RLS 3 y 34bis.4; concurrencia 17 y 17bis |
| ACTIVO ⇒ exactamente una matrícula y legajo | Trigger de restricción diferido (`P5511`, `P5512`) | RLS 24.1, 24.2, 34bis.1 y 34bis.2 |
| INACTIVO ⇒ ninguna matrícula vigente | Mismo trigger (`P5513`) | RLS 24.3 y 34bis.3 |
| Solo cursos activos en asignaciones nuevas | Trigger con bloqueo compartido sobre el curso (`P5504`) | RLS 18 y 29; concurrencia 20b |
| Un curso con matrículas vigentes no se inactiva | Trigger sobre `cursos` (`P5514`) | RLS 35; concurrencia 20a |
| DNI de 7 u 8 dígitos ASCII, único | CHECK en línea y UNIQUE | RLS 12, 19.1 a 19.3 y 20 |
| Legajo único, manual, obligatorio si ACTIVO | UNIQUE exacto, UNIQUE normalizado, CHECK y trigger | RLS 21, 22, 34 y 54 a 56 |
| Sin borrado físico | Sin DELETE ni TRUNCATE para roles de aplicación; claves foráneas `ON DELETE RESTRICT` | RLS 4, 11, 46 y 47 |
| Cuenta, perfil y legajo nacen juntos | Trigger `BEFORE` sobre `auth.users` en la transacción de GoTrue | Alta atómica 6 a 19 |

### Códigos SQLSTATE propios

`P5510` DNI inválido · `P5511` ACTIVO sin matrícula · `P5512` ACTIVO sin legajo ·
`P5513` INACTIVO con matrícula · `P5514` curso ocupado · `P5515` legajo inválido ·
`P5516` estado o transición inválidos · `P5520` pedido de alta que no respeta el
contrato de `ept_alta` · `P5521` cuenta que ya tiene un perfil con otros datos.
Se reutilizan `P5503`, `P5504`, `P5505` y `42501`. Ninguno llega al navegador:
los servicios los traducen a mensajes de dominio y la guardia de la sección 10 lo
comprueba.

### Autoverificaciones

- **009:** ejerce su propio contrato sobre copias temporales de cada restricción,
  obtenidas con `pg_get_constraintdef`. No escribe en `public.perfiles`. Si una
  restricción quedara sin efecto, aborta. `migracion_009_colisiones.mjs` lo
  demuestra degradando la restricción: la migración aborta con salida 3.
- **010:** al terminar comprueba que la función fije `search_path` vacío, que
  ningún rol de aplicación pueda ejecutarla, que `anon`, `authenticated` y
  `service_role` no puedan escribir `auth.users` y que el trigger exista
  habilitado. Si algo no se cumple, la migración falla.

### Un hueco preexistente que EPT-9 cerró

RLS no se aplica a `TRUNCATE`, que es un privilegio de tabla. Sobre la base, un
visitante anónimo podía vaciar `public.perfiles`, y todo el historial académico
cuelga de esa tabla. La migración 008 revoca `DELETE` y `TRUNCATE` sobre
`perfiles` para los roles de aplicación (RLS 11 y 47). Las demás tablas con el
mismo hueco quedan registradas fuera de alcance (sección 18).

---

## 7. Matriz de autorización

### 7.1 Páginas

| Página | DIRECTOR | ESTUDIANTE | ESTUDIANTE ajeno | DOCENTE, PADRE, PERSONAL, sin perfil | Anónimo | Control y prueba |
|---|---|---|---|---|---|---|
| `/dashboard/alumnos` | Listado completo | «Acceso restringido» | «Acceso restringido» | «Acceso restringido» | Redirige a `/login` | `requerirDirector` en el servidor y guardián del panel. `alumnos-auth.spec.ts:849`, `:929` (4 actores), `:942` (4 actores); `alumnos.spec.ts:123` |
| `/dashboard/alumnos/[id]` | Detalle con historial | «Acceso restringido» | «Acceso restringido» | «Acceso restringido» | Redirige a `/login` | `requerirDirector`. `alumnos-auth.spec.ts:581`, `:894` |
| `/dashboard/mi-legajo` | «Acceso restringido»: el guardián declara la ruta solo para ESTUDIANTE (sin prueba propia para DIRECTOR) | Solo su legajo | Solo su propio legajo | «Acceso restringido» | Redirige a `/login` | Guardián del panel, `requerirSesion` y RLS. `alumnos-auth.spec.ts:770`, `:887`, `:949` (4 actores); `alumnos.spec.ts:123` |
| `/dashboard/usuarios` | Panel completo | Bloqueada por el guardián del panel | Ídem | Ídem | Redirige a `/login` | Guardián del panel (`layout.tsx:24`, solo DIRECTOR), RLS sobre las lecturas y `requerirDirector` en la API. La API se prueba por actor; la página para actores no directores no tiene una prueba propia en esta unidad |

### 7.2 API

| Ruta | Sin sesión | DIRECTOR | Cualquier otro actor | Pruebas |
|---|---|---|---|---|
| `POST /api/alumnos` | 401, antes de leer el cuerpo | Alta | 403, antes de validar el cuerpo | `alumnos.spec.ts:43`, `:74`, `:84`; `alumnos-auth.spec.ts:266`, `:856`, `:957` |
| `PATCH /api/alumnos/[id]` | 401, antes de validar el identificador | Cuatro acciones | 403 | `alumnos.spec.ts:59`, `:94`; `alumnos-auth.spec.ts:867`, `:901`, `:957` |
| `GET` y `DELETE` sobre `/api/alumnos` y `/api/alumnos/[id]` | 405 | 405 | 405 | `alumnos.spec.ts:103`, `:108`, `:115`, `:119` |
| `POST /api/usuarios` | 401 `NO_AUTENTICADO` | Alta atómica | 403 `SIN_PERMISO` | `usuarios-auth.spec.ts:482`, `:217`, `:502` |

Un legajo ajeno no se revela. Por RLS, la lectura devuelve cero filas (RLS 40).
Por la API, un actor que no es DIRECTOR recibe 403 antes de cualquier lectura
(`alumnos-auth.spec.ts:901`), y un legajo inexistente devuelve 404 sin detalle
(`alumnos-auth.spec.ts:517`).

### 7.3 Funciones

Consulta ejecutada sobre la base migrada. Solo se listan las funciones de EPT-9;
el resto de `app_private` pertenece a EPT-55.

```bash
docker exec -i supabase_db_educar-para-transformar psql -X -A -F ' | ' -U postgres -d postgres -c "SELECT n.nspname||'.'||p.proname AS funcion, CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS seguridad, coalesce(array_to_string(p.proconfig, ','),'') AS config, coalesce((SELECT string_agg(DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',') FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.privilege_type='EXECUTE' AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role'))),'') AS execute_app FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app_private','public') AND p.prokind='f' ORDER BY 1;"
```

| Función | Seguridad | `search_path` | EXECUTE para roles de aplicación | Qué hace además |
|---|---|---|---|---|
| `public.crear_alumno`, `cambiar_curso_alumno`, `corregir_identidad_alumno`, `inactivar_alumno`, `reactivar_alumno` | INVOKER | vacío | `authenticated`, `service_role` | Envoltorios públicos; `anon` no puede ejecutarlos |
| `app_private.` con los mismos cinco nombres | DEFINER | vacío | `authenticated` | Revalidan `auth.uid()` y el rol DIRECTOR; cualquier otro actor recibe `42501` (RLS 43) |
| `app_private.perfil_actual` (008) y `app_private.rol_actual` (005, de la base, que EPT-9 reutiliza) | DEFINER | vacío | `authenticated` | Resuelven el perfil y el rol desde la sesión |
| `app_private.dni_valido`, `legajo_valido` | INVOKER | vacío | `service_role` | Sin EXECUTE para `anon` ni `authenticated` (RLS 52) |
| `app_private.exigir_coherencia_academica`, `validar_coherencia_alumno`, `validar_curso_activo_matricula`, `proteger_curso_con_matriculas`, `registrar_alumno_de_perfil` | DEFINER | vacío | ninguno | Solo triggers |
| `app_private.registrar_perfil_de_alta` | DEFINER | vacío | ninguno | Solo trigger sobre `auth.users` (alta atómica 1 y 2) |

### 7.4 Tablas

```bash
docker exec -i supabase_db_educar-para-transformar psql -X -A -F ' | ' -U postgres -d postgres -c "SELECT table_schema||'.'||table_name AS tabla, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privilegios FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated','service_role') AND ((table_schema='public' AND table_name IN ('alumnos','matriculas','alumnos_academicos','matriculas_historial','perfiles')) OR (table_schema='auth' AND table_name='users')) GROUP BY 1,2 ORDER BY 1,2;"
```

| Tabla | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `public.alumnos`, `public.matriculas` | Ninguno | `SELECT` | Todos |
| `public.alumnos_academicos`, `public.matriculas_historial` | Ninguno | `SELECT` | Todos |
| `public.perfiles` | `INSERT, REFERENCES, SELECT, TRIGGER, UPDATE` | `INSERT, REFERENCES, SELECT, TRIGGER, UPDATE` | Todos |
| `auth.users` | Ninguno | Ninguno | Ninguno |

`anon` y `authenticated` no tienen `DELETE` ni `TRUNCATE` sobre `perfiles`. Los
`INSERT` y `UPDATE` de `anon` sobre `perfiles` son anteriores a EPT-9 y RLS los
anula: no existe política de `UPDATE`, y la de `INSERT` exige DIRECTOR.
`service_role` solo se usa en `POST /api/usuarios` (sección 15).

### 7.5 Filas

```bash
docker exec -i supabase_db_educar-para-transformar psql -X -A -U postgres -d postgres -c "SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename IN ('perfiles','alumnos','matriculas') ORDER BY 1,2;"
```

| Tabla | Política | Comando |
|---|---|---|
| `alumnos` | El director consulta todos los legajos academicos | SELECT |
| `alumnos` | El estudiante consulta su propio legajo academico | SELECT |
| `matriculas` | El director consulta todo el historial academico | SELECT |
| `matriculas` | El estudiante consulta su propio historial academico | SELECT |
| `perfiles` | Directores y docentes ven todos los perfiles | SELECT |
| `perfiles` | Perfil propio | SELECT |
| `perfiles` | Solo directores insertan perfiles | INSERT |

No existe ninguna política de `INSERT`, `UPDATE` ni `DELETE` sobre el modelo
académico: las escrituras pasan por las funciones de `app_private`. Las políticas
de lectura propia exigen el perfil de la sesión **y** el rol ESTUDIANTE vigente
(RLS 57 a 59bis).

### 7.6 Tres capas, ninguna sustituye a otra

1. **Navegación y guardián del panel** (`dashboard/layout.tsx`): ocultan y
   bloquean rutas por rol. No son una frontera de autorización.
2. **Servidor**: `requerirDirector` y `requerirSesion` resuelven la identidad con
   `auth.getUser()` (`src/services/autorizacion.ts:38` y `:86`), nunca con datos
   que envíe el cliente.
3. **PostgreSQL**: privilegios mínimos, RLS y funciones que revalidan
   `auth.uid()` y el rol.

---

## 8. Matriz completa criterio → prueba

Una fila por criterio, sin agrupar. Todos los resultados provienen de la
verificación de la sección 12 sobre `c3aaba0`, salvo las filas que citan otra
ejecución. Abreviaturas de resultado: «RLS n» es la línea
`NOTICE:  OK n: …` del guion de alumnos; «Alta n», la del guion de alta atómica.
En todas las filas de Playwright la corrida completa terminó con
`309 passed (…)` y salida 0.

### 8.1 EPT-9: criterios de aceptación

| Jira / criterio | Comportamiento esperado | Archivo o migración | Prueba concreta | Comando exacto | Resultado exacto | Veredicto |
|---|---|---|---|---|---|---|
| EPT-9 CA1: el DIRECTOR consulta y actualiza de forma atómica estado, curso, DNI y legajo | Cada operación es una función PL/pgSQL: una transacción | `008_alumnos_estado_academico.sql`; `src/services/alumnos.service.ts`; `src/app/api/alumnos/[id]/route.ts` | RLS 13, 26, 27, 30, 32 y 38; `alumnos-auth.spec.ts:266` y `:449` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | 69 líneas OK, salida 0; `ok … [chromium-directora] › tests\alumnos-auth.spec.ts:266:7 › DIRECTOR autenticado — alumnos › crea, cambia de curso, inactiva y reactiva conservando la historia` | Cumple |
| EPT-9 CA2: solo un curso existente y activo | Curso inexistente `23503`; inactivo `P5504` | 008 (trigger de curso activo) | RLS 17, 18 y 29; concurrencia 20b; `alumnos-auth.spec.ts:329` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 17: curso inexistente rechazado (23503)`; `OK 18: curso inactivo rechazado (P5504)`; `OK CONCURRENCIA 20b: inactivación primero rechaza la asignación tardía (P5504)`; `ok … rechaza un curso inexistente y uno inactivo sin persistir nada` | Cumple |
| EPT-9 CA3: como máximo una matrícula activa, incluso en concurrencia | Índice único parcial | `008` (`idx_matriculas_una_activa_por_alumno`) | RLS 3, 16 y 34bis.4; concurrencia 17 y 17bis | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs` | `OK CONCURRENCIA 17: dos matrículas simultáneas dejan una sola vigente`; `OK CONCURRENCIA 17bis: el índice único parcial rechaza la segunda inserción directa (23505)` | Cumple |
| EPT-9 CA4: ACTIVO con una matrícula y legajo; INACTIVO sin matrícula | Trigger diferido `P5511`/`P5512`/`P5513` | 008 | RLS 24.1, 24.2, 24.3 y 34bis.1 a 34bis.3 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 24.1: alumno activo sin curso rechazado (P5511)`; `OK 34bis.3: el trigger diferido rechaza un alumno inactivo con matrícula (P5513)` | Cumple |
| EPT-9 CA5: cambiar de curso cierra la anterior, crea la nueva y conserva ambas | Tramo cerrado con motivo `CAMBIO_DE_CURSO` | 008 (`app_private.cambiar_curso_alumno`) | RLS 26 y 31; `alumnos-auth.spec.ts:266` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 26: el cambio de curso cierra el tramo anterior, abre otro y conserva la historia`; `OK 31: el historial expone los tres tramos con su nivel derivado` | Cumple |
| EPT-9 CA6: inactivar cierra la matrícula; reactivar exige curso activo | Motivo `INACTIVACION`; reactivar sin curso `P5511` | 008 | RLS 27 a 30; `alumnos-auth.spec.ts:615` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 28: la reactivación sin curso se rechaza (P5511)`; `ok … inactiva y reactiva desde la interfaz y el cambio queda persistido` | Cumple |
| EPT-9 CA7: no se inactiva un curso con matrículas activas, incluso en carrera | `P5514`; la asignación tardía recibe `P5504` | 008 (`proteger_curso_con_matriculas`); `src/services/cursos.service.ts` | RLS 35 y 36; concurrencia 20a y 20b; `alumnos-auth.spec.ts:529` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK CONCURRENCIA 20a: asignación primero impide inactivar el curso (P5514)`; `ok … no puede inactivar un curso con estudiantes matriculados` | Cumple |
| EPT-9 CA8: el nivel coincide con `cursos.nivel_id` y no se persiste | Sin columna de nivel en el modelo académico | 008 (vistas) | RLS 6, 14 y 31; `alumnos-auth.spec.ts:770` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 6: el nivel no se persiste; se deriva de cursos.nivel_id`; `ok … consulta su propio legajo académico con su curso y nivel` | Cumple |
| EPT-9 CA9: cambios coherentes en listado, detalle y vista propia | Lectura real después de recargar | `src/app/dashboard/alumnos/page.tsx`, `[id]/page.tsx`, `mi-legajo/page.tsx` | `alumnos-auth.spec.ts:581`, `:615` y `:770` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … el listado y el detalle persisten después de recargar`; `ok … inactiva y reactiva desde la interfaz y el cambio queda persistido` | Cumple |
| EPT-9 CA10: ESTUDIANTE solo lee lo propio; DIRECTOR opera; los demás sin acceso | RLS y `requerirDirector` | 008, 009; `src/services/autorizacion.ts` | RLS 38 a 43, 48 y 57 a 59bis; `alumnos-auth.spec.ts:856`, `:867`, `:887`, `:901`, `:929`, `:949`, `:957`; `alumnos.spec.ts:43`, `:59`, `:123` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 42: DOCENTE, PADRE, PERSONAL y un usuario sin perfil no acceden a datos académicos`; `ok … recibe 403 en todas las operaciones académicas` en `chromium-docente`, `chromium-padre`, `chromium-personal` y `chromium-sin-perfil` | Cumple |
| EPT-9 CA11: DNI de 7 u 8 dígitos ASCII, único en altas y correcciones concurrentes | CHECK, UNIQUE y Zod | 009; `src/lib/validations.ts` | RLS 12, 15, 19.1 a 19.3, 20 y 33; concurrencia 18 y 18bis; `alumnos-auth.spec.ts:484` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 19.3: dígito no ASCII en el DNI rechazado (P5510)`; `OK CONCURRENCIA 18bis: dos correcciones simultáneas hacia el mismo DNI dejan una sola (23505)` | Cumple |
| EPT-9 CA12: legajo único y obligatorio al activar; no se genera | Sin secuencia ni valor automático | 008, 009 | RLS 22, 24.2, 34 y 54 a 56; concurrencia 18ter; `alumnos-ui.spec.ts:144`; estática sin secuencias | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `rg -n -i "nextval\|create sequence" supabase/migrations/008_alumnos_estado_academico.sql supabase/migrations/009_correcciones_revision_alumnos.sql supabase/migrations/010_alta_atomica_de_cuentas.sql` | `OK 22: legajo duplicado rechazado (23505), sin distinguir mayúsculas`; el `rg` no devolvió coincidencias (salida 1) | Cumple |
| EPT-9 CA13: perfiles existentes sin datos quedan INACTIVO sin inventar | Backfill y trigger de perfil | 008 | RLS 49 y 50 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 49: un perfil ESTUDIANTE sin datos suficientes queda INACTIVO, sin curso ni legajo inventados` | Cumple |
| EPT-9 CA14: sin eliminación física en interfaz, API, funciones o privilegios | Sin DELETE, sin política, 405 y sin control | 008; `src/app/api/alumnos/*`; `src/services/perfiles.service.ts` | RLS 4, 8, 11, 46 y 47; `alumnos.spec.ts:103` y `:108`; `alumnos-ui.spec.ts:110`; estática `rg -n "\.delete\(" src` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `rg -n "\.delete\(" src` | `OK 46: no existe borrado físico de alumnos, matrículas ni perfiles (42501)`; `ok … no existe eliminación física en la colección`; el `rg` solo encontró `actividades.service.ts`, `noticias.service.ts` y `VistaGestionCupos.tsx`, ajenos a EPT-9 | Cumple |
| EPT-9 CA15: rechazos con mensajes claros en español y cero persistencia parcial | Mensajes de dominio y transacción única | `src/services/alumnos.service.ts`; `src/lib/errores.ts` | RLS 25; `alumnos-auth.spec.ts:329`, `:393`, `:484`, `:495`; concurrencia | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 25: ninguno de los rechazos persistió una fila (cero persistencia parcial)`; `ok … traduce el DNI y el legajo duplicados reales de PostgreSQL` | Cumple |
| EPT-9 CA16: un reinicio limpio reproduce todo | Migraciones 001 → 010 aplican en limpio | `supabase/migrations/*` | Pasos 04, 06 y 07; autoverificaciones de 009 y 010 | `npx supabase db reset --local`; `npx supabase migration list --local`; `npx supabase db lint --local --level warning` | `Applying migration 010_alta_atomica_de_cuentas.sql...`, salida 0; lista 001 a 010; `No schema errors found` | Cumple |
| EPT-9 CA17: tipos generados iguales al esquema; los manuales no dicen ser generados | Salida normalizada idéntica | `src/types/database.generated.ts`; `src/types/database.types.ts` | `tipos-generados.mjs`; estática del encabezado | `node supabase/tests/tipos-generados.mjs`; `rg -n "ESTE ARCHIVO NO ES GENERADO" src/types/database.types.ts` | `OK  src/types/database.generated.ts coincide byte a byte con la salida normalizada`; `4: * ESTE ARCHIVO NO ES GENERADO.` | Cumple |
| EPT-9 CA18: pruebas SQL/RLS, API, UI y navegador autenticado, permitidas y denegadas | Cobertura por frontera | `supabase/tests/*`; `tests/*` | 69 + 39 + 73 + 23 aserciones SQL; `alumnos.spec.ts` (10); `alumnos-ui.spec.ts` (48); proyectos por actor | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/cursos_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/niveles_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/usuarios_alta_atomica.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | Todas en salida 0; `309 passed` | Cumple |
| EPT-9 CA19: concurrencia con conexiones PostgreSQL reales | Dos procesos `psql` y `pg_blocking_pids` | `supabase/tests/_sesion-psql.mjs`; `alumnos_academicos_concurrencia.mjs` | Escenarios 17, 17bis, 19, 20a y 20b | `node supabase/tests/alumnos_academicos_concurrencia.mjs` | 8 líneas `OK CONCURRENCIA`, salida 0; `OK CONCURRENCIA 19: la asignación concurrente a un estudiante inactivado se rechaza (P5513)` | Cumple |
| EPT-9 CA20: responsive y accesible en tres perfiles, con teclado, foco y estados | Sin desplazamiento horizontal; foco contenido | `GestionAlumnos.tsx`; `src/components/ui/*` | `alumnos-ui.spec.ts` (16 casos × 3 perfiles), `alumnos-contraste.spec.ts` (20 × 3), `alumnos-correcciones.spec.ts` (11, escritorio) | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `chromium` 106, `pixel-5-chromium` 38 e `iphone-13-webkit` 38 casos, todos `ok`; `ok … muestra los estados de carga, vacío, error y éxito` en los tres | Cumple, con el límite de que `alumnos-correcciones.spec.ts` corre solo en escritorio |
| EPT-9 CA21: la evidencia documenta matriz, comandos, capturas, seguridad, decisiones, riesgos, retrospectiva y reversión | Este documento | `docs/evidence/EPT-9.md` | Secciones 3 a 20 | No aplica | — | Cumple |
| EPT-9 CA22: Cursos y Niveles siguen aprobando sin relajar contratos | Mismas aserciones | `supabase/tests/cursos_rls.sql`, `niveles_rls.sql`, `niveles_concurrencia.mjs`; `tests/cursos*`, `tests/niveles*` | 39 + 73 aserciones SQL; 4 escenarios; 75 casos de Playwright | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/cursos_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/niveles_rls.sql`; `node supabase/tests/niveles_concurrencia.mjs`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | 39 y 73 OK, salida 0; 4 OK; `cursos-ui` 18, `cursos` 7, `cursos-auth` 14, `niveles-ui` 9, `niveles` 9, `niveles-responsive` 4, `niveles-auth` 14, todos `ok`. Cambios en esas pruebas: sección 13.4 | Cumple |
| EPT-9 CA23: EPT-20 a EPT-25 pasan a Listo solo con evidencia específica | Ninguna transición sin evidencia | Jira | Consulta en vivo (sección 2) | No aplica | Las seis subtareas `En curso` | Cumple: ninguna pasó a Listo |
| EPT-9 CA24: EPT-9 pasa a Listo solo con subtareas Listo, revisión independiente e integración en `main` | Permanece En curso | Jira | Consulta en vivo | No aplica | `En curso`; revisión independiente del nuevo SHA pendiente; sin integración | Cumple la regla; las condiciones de cierre están pendientes |

### 8.2 EPT-20: migración del estado académico

| Jira / criterio | Comportamiento esperado | Archivo o migración | Prueba concreta | Comando exacto | Resultado exacto | Veredicto |
|---|---|---|---|---|---|---|
| EPT-20 A1: estado `ACTIVO` o `INACTIVO`, separado de la matrícula | Enumerado y tablas separadas | 008 | RLS 1 y 2 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 2: el estado académico admite exactamente ACTIVO e INACTIVO` | Cumple |
| EPT-20 A2: ACTIVO con una matrícula y legajo; INACTIVO sin matrícula | Trigger diferido | 008 | RLS 16, 24.1 a 24.3 y 34bis.1 a 34bis.3 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 16: el alumno activo tiene exactamente una matrícula vigente` | Cumple |
| EPT-20 A3: el cambio de curso cierra y crea | Nuevo tramo | 008 | RLS 26 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 26: …conserva la historia` | Cumple |
| EPT-20 A4: nivel derivado solo de `cursos.nivel_id` | Vistas | 008 | RLS 6 y 14 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 14: el nivel mostrado se deriva de cursos.nivel_id` | Cumple |
| EPT-20 A5: ESTUDIANTE preexistente sin datos queda INACTIVO | Backfill | 008 | RLS 49 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 49: …sin curso ni legajo inventados` | Cumple |
| EPT-20 A6: claves foráneas que impiden borrado accidental | `ON DELETE RESTRICT` | 008 | RLS 4 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 4: las tres claves foráneas del legajo usan ON DELETE RESTRICT` | Cumple |
| EPT-20 A7: índice parcial y operación transaccional contra dos matrículas, también en concurrencia | Índice único parcial | 008 | RLS 3; concurrencia 17 y 17bis | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs` | `OK 3: un índice único parcial garantiza una sola matrícula vigente por alumno`; `OK CONCURRENCIA 17: …` | Cumple |
| EPT-20 A8: solo cursos existentes y activos | `23503` y `P5504` | 008 | RLS 17 y 18; concurrencia 20b | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs` | `OK 17 …`; `OK 18 …`; `OK CONCURRENCIA 20b …` | Cumple |
| EPT-20 A9: inactivar un curso con matrículas se rechaza también en concurrencia | `P5514` | 008 | RLS 35; concurrencia 20a | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs` | `OK 35: un curso con matrículas vigentes no se puede inactivar (P5514)`; `OK CONCURRENCIA 20a …` | Cumple |
| EPT-20 A10: privilegios mínimos, RLS y funciones ligadas a `auth.uid()`; sin `service_role` en el CRUD normal | Solo SELECT; funciones DEFINER con `search_path` vacío | 008, 009 | RLS 7 a 10, 43, 52 y 53; consulta de funciones (7.3); estática de `service_role` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `rg -n "createAdminClient\(\|SUPABASE_SERVICE_ROLE_KEY" src` | `OK 10: toda función SECURITY DEFINER de app_private fija search_path vacío`; `OK 53: un DIRECTOR autenticado crea un legajo sin privilegios extra`; el `rg` solo encontró `supabase.admin.ts` y `src/app/api/usuarios/route.ts:142` | Cumple |
| EPT-20 A11: no se edita ninguna migración aplicada; se usa el siguiente identificador | Solo migraciones agregadas | `supabase/migrations` | Estática | `git diff --name-status e31bdf250e06ca9aae1233c2ee737a0443f4df51 c3aaba0394bbdea59cd848a67f38d30fbab7b0be -- supabase/migrations` | `A 008…`, `A 009…`, `A 010…` | Cumple. La 009 nació en la primera ronda (`0e11fc5`) y se corrigió en su lugar en la segunda (`9179c86`), antes de publicarse (sección 17.4) |
| EPT-20 A12: sin eliminación física en la superficie normal | Sin DELETE ni TRUNCATE | 008 | RLS 46 y 47; `alumnos.spec.ts:103` y `:108` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 47: ni authenticated ni anon pueden truncar perfiles ni el historial académico` | Cumple |
| EPT-20 evidencia requerida | Reset, lista, SQL/RLS por actor, dos conexiones, tipos, asesores y lint, regresión | `supabase/migrations/*`; `supabase/tests/*` | Pasos 04 a 15 y 26 | `npx supabase db reset --local`; `npx supabase migration list --local`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/cursos_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/niveles_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs`; `node supabase/tests/niveles_concurrencia.mjs`; `node supabase/tests/tipos-generados.mjs`; `npx supabase db advisors --local --type all --level info --fail-on none --output-format json`; `npx supabase db lint --local --level warning`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | Reset con 10 migraciones y salida 0; lista de `001` a `010`; 69, 39 y 73 líneas OK; 8 y 4 escenarios OK; 4 afirmaciones de tipos; 35 hallazgos de asesores, clasificados en 13.2; `No schema errors found`; `309 passed (4.7m)` | Cumple |
| EPT-20 cierre | Esquema e invariantes ejecutados y documentados | — | Secciones 6 y 12 | No aplica | Ejecutados y documentados; la incidencia sigue En curso hasta la revisión independiente | Cumple la condición; transición pendiente |

### 8.3 EPT-21: tipos, autorización, servicios y API

| Jira / criterio | Comportamiento esperado | Archivo o migración | Prueba concreta | Comando exacto | Resultado exacto | Veredicto |
|---|---|---|---|---|---|---|
| EPT-21 A1: regenerar `database.generated.ts` y reconciliar los manuales | Salida normalizada idéntica | `src/types/*` | `tipos-generados.mjs` | `node supabase/tests/tipos-generados.mjs` | `OK  dos generaciones seguidas producen la misma salida cruda (SHA-256 48d2ab2b11a2da52…)` y 3 OK más, salida 0 | Cumple |
| EPT-21 A2: frontera de servidor con `auth.getUser()` | Identidad desde la sesión | `src/services/autorizacion.ts` | Estática; `alumnos.spec.ts:43` | `rg -n "auth\.getUser\(\)" src/services/autorizacion.ts`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `38:` y `86:` con `supabase.auth.getUser()`; `ok … rechaza el alta sin sesión con 401` | Cumple |
| EPT-21 A3: DIRECTOR todo; ESTUDIANTE solo lo propio | RLS por rol | 008, 009 | RLS 38 a 41; `alumnos-auth.spec.ts:770` y `:887` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 39: el ESTUDIANTE consulta exclusivamente su propio legajo`; `ok … ve su propio legajo y nunca el de otra persona` | Cumple |
| EPT-21 A4: DOCENTE, PADRE, PERSONAL, sin perfil y anónimo sin acceso nuevo | 403 y cero filas | 008; `requerirDirector` | RLS 42, 43 y 48; `alumnos-auth.spec.ts:929`, `:949`, `:957`; `alumnos.spec.ts:115` y `:123` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 48: un usuario anónimo no lee ni ejecuta nada del dominio académico`; `ok … no alcanza la vista propia del legajo académico` en los cuatro actores | Cumple |
| EPT-21 A5: Zod valida estado, DNI, legajo, curso y operaciones | Esquemas discriminados | `src/lib/validations.ts` | `alumnos-auth.spec.ts:484` y `:495`; `alumnos-ui.spec.ts:115` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … rechaza un estado fuera del catálogo y una acción desconocida` | Cumple |
| EPT-21 A6: actualizaciones atómicas; sin escrituras parciales del cliente | Una función por operación | 008; `alumnos.service.ts` | RLS 25; `alumnos-auth.spec.ts:329` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 25 …`; `ok … rechaza un curso inexistente y uno inactivo sin persistir nada` | Cumple |
| EPT-21 A7: no se aceptan identificadores ni roles del cliente como autorización | 403 antes de validar | `src/app/api/alumnos/*`; `autorizacion.ts` | `alumnos-auth.spec.ts:856` y `:901`; `usuarios-auth.spec.ts:502` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … recibe 403 antes de que se valide un cuerpo inválido`; `ok … tampoco puede operar sobre otro estudiante por la API` | Cumple |
| EPT-21 A8: sin `service_role` en operaciones académicas | Cliente de sesión en Alumnos | `src/services/alumnos.service.ts` | Estática | `rg -n "createAdminClient\(\|SUPABASE_SERVICE_ROLE_KEY" src` | Solo `src/services/supabase.admin.ts` y `src/app/api/usuarios/route.ts:142` | Cumple. `service_role` se usa únicamente en el alta de cuentas de Auth, que la API de Auth exige |
| EPT-21 A9: restricciones y errores traducidos a HTTP en español sin filtrar SQL | Catálogo de la sección 4.4 | `src/lib/errores.ts`; servicios | `alumnos-auth.spec.ts:393`, `:495`, `:517`; `usuarios-auth.spec.ts` (50); guardia de detalle técnico | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `node supabase/tests/usuarios_reconciliacion.mjs` | `ok … devuelve 404 para un legajo que no existe, sin revelar nada`; 11 líneas `OK  …: la respuesta no contiene detalle técnico` | Cumple |
| EPT-21 A10: bloqueo de inactivación de Cursos con matrículas activas | `P5514` → 409 | `src/services/cursos.service.ts` | `alumnos-auth.spec.ts:529` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … no puede inactivar un curso con estudiantes matriculados` | Cumple |
| EPT-21 A11: corregir solo los servicios de perfiles necesarios | Sin absorber EPT-59 ni EPT-66 | `perfiles.service.ts`, `roles.service.ts`, `usuarios.service.ts` | Revisión de alcance (sección 5) | `git diff --stat e31bdf250e06ca9aae1233c2ee737a0443f4df51 c3aaba0394bbdea59cd848a67f38d30fbab7b0be -- src/services` | `9 files changed, 1359 insertions(+), 57 deletions(-)`: `alumnos.client.ts`, `alumnos.service.ts`, `autorizacion.ts`, `cuentas.service.ts`, `cursos.service.ts`, `perfiles.service.ts`, `roles.service.ts`, `supabase.admin.ts` y `usuarios.service.ts`, todos del flujo de Alumnos o del alta de Usuarios | Cumple |
| EPT-21 A12: perfiles sin cuenta Auth y sin falso requisito de tutor | `user_id` nulo; tutor opcional | 008; `src/app/api/usuarios/route.ts` | RLS 13; `usuarios-auth.spec.ts:217`, `:246`, `:253`, `:569` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 13: alta ACTIVO válida, con legajo y matrícula, y sin cuenta de acceso`; `ok … el tutor no es obligatorio: el alta funciona sin mencionarlo` | Cumple |
| EPT-21 evidencia requerida | 401, 403, éxito, lectura propia, duplicados, cursos, estados, atomicidad, traducción; TypeScript, ESLint y build | `src/*`; `tests/*` | Filas anteriores; pasos 17 a 21 | `npx tsc --noEmit --incremental false`; `npx eslint $(git diff --name-only --diff-filter=d 4b593a70aa2030c6d1f3051f47d5131b6d41292c HEAD -- '*.ts' '*.tsx' '*.mjs' '*.js')`; `npx eslint $(git diff --name-only --diff-filter=d e31bdf250e06ca9aae1233c2ee737a0443f4df51 HEAD -- '*.ts' '*.tsx' '*.mjs' '*.js')`; `ENTORNO_LOCAL="$(npx supabase status -o env)" && NEXT_PUBLIC_SUPABASE_URL="$(printf '%s\n' "$ENTORNO_LOCAL" \| rg -o -r '$1' '^API_URL="(.*)"$')" NEXT_PUBLIC_SUPABASE_ANON_KEY="$(printf '%s\n' "$ENTORNO_LOCAL" \| rg -o -r '$1' '^ANON_KEY="(.*)"$')" npx next build` | `tsc` sin salida, salida 0; ronda: `✖ 2 problems (0 errors, 2 warnings)`, salida 0; rama: `✖ 7 problems (2 errors, 5 warnings)`, salida 1; build: `✓ Generating static pages using 15 workers (20/20)`, salida 0 | Cumple. Los errores de ESLint de la rama son idénticos a la base (13.1) |
| EPT-21 cierre | Tipos iguales al esquema; fronteras probadas | — | Pasos 15 y 26 | No aplica | Cumplido; la incidencia sigue En curso | Cumple la condición; transición pendiente |

### 8.4 EPT-22: formulario, listado, detalle y vista propia

| Jira / criterio | Comportamiento esperado | Archivo o migración | Prueba concreta | Comando exacto | Resultado exacto | Veredicto |
|---|---|---|---|---|---|---|
| EPT-22 A1: listado con alumno, DNI, legajo, estado, curso y nivel | Tabla en escritorio, tarjetas en móvil | `GestionAlumnos.tsx` | Banco: `alumnos-ui.spec.ts:59` (3 perfiles). Base real: `alumnos-auth.spec.ts:581` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … presenta el legajo con su estado, curso y nivel derivado` en tres perfiles; `ok … el listado y el detalle persisten después de recargar` | Cumple |
| EPT-22 A2: detalle con situación actual e historial | Tramos con curso, nivel, desde, hasta y motivo | `SituacionAcademica.tsx`; `[id]/page.tsx` | `alumnos-auth.spec.ts:266` y `:581` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … crea, cambia de curso, inactiva y reactiva conservando la historia` | Cumple |
| EPT-22 A3: formulario explícito ACTIVO/INACTIVO | ACTIVO exige legajo y curso; INACTIVO sin matrícula | `GestionAlumnos.tsx`; `validations.ts` | `alumnos-ui.spec.ts:115`, `:144`, `:166`; `alumnos-correcciones.spec.ts:56` y `:128` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … un alta activa exige curso y legajo antes de tocar la red`; `ok … recorre los nueve pasos del flujo sin bloquearse` | Cumple |
| EPT-22 A4: cambio de curso, inactivación y reactivación con confirmación y resultado persistido | Diálogo y confirmación | `GestionAlumnos.tsx` | Presentación: `alumnos-ui.spec.ts:332` y `:353`. Persistencia: `alumnos-auth.spec.ts:615` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … confirma la inactivación explicando qué se conserva`; `ok … inactiva y reactiva desde la interfaz y el cambio queda persistido` | Cumple |
| EPT-22 A5: vista propia limitada al legajo del estudiante | Sin parámetro de identificador | `mi-legajo/page.tsx` | `alumnos-auth.spec.ts:770` y `:887`; RLS 39 y 40 | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `ok … consulta su propio legajo académico con su curso y nivel`; `OK 40: un legajo ajeno devuelve cero filas y no delata su existencia` | Cumple |
| EPT-22 A6: cursos inactivos no se ofrecen; el historial conserva sus nombres | Opciones solo activas | `GestionAlumnos.tsx`; 008 | `alumnos-ui.spec.ts:88`; `alumnos-correcciones.spec.ts:152`; RLS 37 | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `ok … conserva el curso histórico de un estudiante cuyo curso ya está inactivo`; `OK 37: el historial conserva y muestra los tramos de cursos hoy inactivos` | Cumple |
| EPT-22 A7: ningún control de eliminación física | Sin botón ni ruta | `GestionAlumnos.tsx`; `legajos/page.tsx` | `alumnos-ui.spec.ts:110`; `alumnos.spec.ts:103` y `:108` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … no ofrece ningún control de eliminación física` en tres perfiles; `ok … no existe eliminación física para un legajo individual` | Cumple |
| EPT-22 A8: estados de carga, vacío, error, validación, envío y éxito | Todos visibles y anunciados | `GestionAlumnos.tsx`; `loading.tsx` | `alumnos-ui.spec.ts:115`, `:199`, `:418`; `alumnos-contraste.spec.ts:124`; base real: `alumnos-auth.spec.ts:724` y `:785` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … muestra los estados de carga, vacío, error y éxito`; `ok … deshabilita el botón mientras el alta está en vuelo`; `ok … distingue no tener trayectoria de no poder leerla` | Cumple |
| EPT-22 A9: mensajes de dominio en español profesional | Sin inglés ni detalle técnico | `alumnos.service.ts`; `errores.ts` | `alumnos-ui.spec.ts:452`; `_sin-detalle-tecnico.ts` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … nombra en español controles, regiones y contenido visible` en tres perfiles | Cumple |
| EPT-22 A10: teclado, foco inicial, contención y devolución, etiquetas, errores descritos, alertas y regiones vivas | Diálogo accesible; enlaces únicos | `GestionAlumnos.tsx`; `Input.tsx`; `EnlaceBoton.tsx` | `alumnos-ui.spec.ts:378` y `:452`; `alumnos-correcciones.spec.ts:232`, `:288`, `:403`, `:425`, `:453`, `:472`; `alumnos-auth.spec.ts:700`, `:724`, `:942` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … el tabulador no escapa del diálogo ocupado, ni con Tab ni con Shift+Tab`; `ok … el acceso restringido es un único enlace para volver` en cuatro actores | Cumple |
| EPT-22 A11: sin desplazamiento horizontal en escritorio, Pixel 5 e iPhone 13 | `scrollWidth <= clientWidth + 1` | `GestionAlumnos.tsx` | `alumnos-ui.spec.ts:59` (aserción en `:84`) y `:378` (aserción en `:411`), en tres perfiles | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok` en `chromium`, `pixel-5-chromium` e `iphone-13-webkit` | Cumple |
| EPT-22 A12: identidad institucional y reutilización sin copiar componentes gigantes | Mismos tokens y clases | `estilosDeBoton.ts`; `EnlaceBoton.tsx`; `Button.tsx` | Revisión de código | `rg -n "estilosDeBoton" src/components/ui` | `Button.tsx:23` y `EnlaceBoton.tsx:34` llaman a `estilosDeBoton`, definida en `estilosDeBoton.ts:33` | Cumple, con el riesgo de tamaño de `GestionAlumnos.tsx` (1033 líneas, sección 18) |
| EPT-22 evidencia requerida | Pruebas UI controladas, autenticadas reales, capturas de tres perfiles, inspección visual y guardia de idioma | — | `alumnos-ui.spec.ts` (48), `alumnos-auth.spec.ts` (40), 61 capturas, `alumnos-ui.spec.ts:452` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `309 passed (4.7m)`; 61 capturas generadas sobre `c3aaba0` e inspeccionadas una por una (sección 14) | Cumple |
| EPT-22 cierre | Listado, detalle, historial, vista propia, accesibilidad, responsive y persistencia demostrados | — | Filas anteriores | No aplica | Demostrados; la incidencia sigue En curso | Cumple la condición; transición pendiente |

### 8.5 EPT-23: altas y correcciones sin duplicados

| Jira / criterio | Comportamiento esperado | Archivo o migración | Prueba concreta | Comando exacto | Resultado exacto | Veredicto |
|---|---|---|---|---|---|---|
| EPT-23 A1: DNI obligatorio de 7 u 8 dígitos ASCII | Tres fronteras | 009; `validations.ts`; `Input.tsx` | RLS 12 y 19.1 a 19.3; `alumnos-auth.spec.ts:484`; `alumnos-correcciones.spec.ts:453` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 12: PostgreSQL exige el contrato de DNI de 7 u 8 dígitos`; `ok … un DNI inválido queda anunciado como inválido y descrito por su mensaje` | Cumple |
| EPT-23 A2: unicidad global, incluidos INACTIVOS | UNIQUE | 001, 008 | RLS 20 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 20: DNI duplicado rechazado (23505), incluso reservado por un inactivo` | Cumple |
| EPT-23 A3: corregir el DNI conservando identificador y relaciones | Misma PK | 008 (`corregir_identidad_alumno`) | RLS 32; `alumnos-auth.spec.ts:449` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 32: el DIRECTOR corrige el DNI conservando el identificador interno y sus relaciones`; `ok … corrige el DNI conservando el identificador interno y el historial` | Cumple |
| EPT-23 A4: altas y correcciones concurrentes con el mismo DNI: una sola confirma | UNIQUE bajo carrera | 008 | Concurrencia 18 y 18bis | `node supabase/tests/alumnos_academicos_concurrencia.mjs` | `OK CONCURRENCIA 18: dos altas simultáneas con el mismo DNI dejan una sola (23505)` | Cumple |
| EPT-23 A5: legajo manual, único y obligatorio para activar | Sin numeración automática | 008, 009 | RLS 22, 24.2 y 54 a 56; concurrencia 18ter; estática sin secuencias | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `node supabase/tests/alumnos_academicos_concurrencia.mjs`; `rg -n -i "nextval\|create sequence" supabase/migrations/008_alumnos_estado_academico.sql supabase/migrations/009_correcciones_revision_alumnos.sql supabase/migrations/010_alta_atomica_de_cuentas.sql` | `OK CONCURRENCIA 18ter: el mismo legajo con distinta caja no se duplica bajo concurrencia (23505)`; el `rg` no devolvió coincidencias (salida 1) | Cumple |
| EPT-23 A6: estado explícito al crear | ACTIVO con curso y legajo; INACTIVO sin matrícula | 008; `GestionAlumnos.tsx` | RLS 13 y 15; `alumnos-ui.spec.ts:115` y `:166` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 15: alta INACTIVO válida, sin matrícula y sin nivel, con DNI de 7 dígitos` | Cumple |
| EPT-23 A7: legajo sin cuenta Auth | `user_id` nulo | 008 | RLS 13; captura `real-escritorio-detalle-historial.png` («Cuenta de acceso: Sin vincular») | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 13 …sin cuenta de acceso` | Cumple |
| EPT-23 A8: tutor no requerido; no se escribe `padres_hijos` | Vínculos rechazados con 400 | `src/app/api/usuarios/route.ts` | `usuarios-auth.spec.ts:246`, `:253`, `:271`; RLS 60 | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `ok … pedir un vínculo parental se rechaza con un mensaje claro y no escribe nada`; `OK 60: padres_hijos sigue fuera del esquema y nada de EPT-9 la usa` | Cumple |
| EPT-23 A9: no convertir perfiles hacia o desde ESTUDIANTE | Sin operación de conversión | 008 (sin función de rol); `perfiles` sin política UPDATE | RLS 50; `usuarios-auth.spec.ts:701`; consulta de políticas (7.5) | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 50: solo los perfiles ESTUDIANTE tienen legajo académico`; `ok … editar un usuario sin permiso de actualización informa que no se guardó` | Cumple |
| EPT-23 A10: sin eliminación física de estudiantes | Sin DELETE | 008; `perfiles.service.ts` | RLS 46; `alumnos.spec.ts:108` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 46 …` | Cumple |
| EPT-23 A11: fixtures sintéticos alineados al contrato de DNI | DNI de 7 u 8 dígitos, sin personas reales | `supabase/tests/*.sql`; `page.banco.tsx` | Diferencia de las suites de regresión (13.4); estática del banco | `rg -n "Los datos son sintéticos" src/app/pruebas-ui/alumnos/page.banco.tsx` | `10: * Los datos son sintéticos y no representan a ninguna persona real.` | Cumple |
| EPT-23 A12: ante datos incompatibles, fallar o documentar; nunca normalizar datos personales | CHECK y UNIQUE fallan; sin UPDATE correctivo | 008, 009 | `migracion_009_colisiones.mjs` | `node supabase/tests/migracion_009_colisiones.mjs` | `OK  con la restricción vaciada, la autoverificación aborta (salida 3)` y 11 OK más, salida 0 | Cumple |
| EPT-23 evidencia requerida | Validación en tres fronteras, duplicados secuenciales y concurrentes, corrección, cero persistencia, ACTIVO/INACTIVO, sin Auth, sin tutor, sin DELETE | — | Filas anteriores; `usuarios-auth.spec.ts:377`, `:393`, `:404`; alta atómica 12 a 19 | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/usuarios_alta_atomica.sql` | `ok … un legajo existente que solo cambia en mayúsculas también es un duplicado`; 23 OK, salida 0 | Cumple |
| EPT-23 cierre | Integridad de DNI y legajo probada en las tres fronteras | — | Filas anteriores | No aplica | Probada; la incidencia sigue En curso | Cumple la condición; transición pendiente |

### 8.6 EPT-24: casos obligatorios y reglas de evidencia

| Jira / criterio | Comportamiento esperado | Archivo o migración | Prueba concreta | Comando exacto | Resultado exacto | Veredicto |
|---|---|---|---|---|---|---|
| EPT-24 C1: curso inexistente y curso inactivo | `23503` y `P5504` | 008 | RLS 17 y 18; `alumnos-auth.spec.ts:329` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 17 …`; `OK 18 …`; `ok … rechaza un curso inexistente y uno inactivo sin persistir nada` | Cumple |
| EPT-24 C2: alta ACTIVO válida y alta INACTIVO válida | Ambas persisten | 008 | RLS 13 y 15; `alumnos-auth.spec.ts:266`; `usuarios-auth.spec.ts:217` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 13 …`; `OK 15 …`; `ok … crea un estudiante sin tutor y persiste perfil, legajo académico y cuenta` | Cumple |
| EPT-24 C3: una única matrícula activa | Índice parcial | 008 | RLS 16 y 34bis.4 | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql` | `OK 34bis.4: el índice único parcial impide una segunda matrícula vigente (23505)` | Cumple |
| EPT-24 C4: cambio de curso con historial y nivel derivado | Tramos y nivel | 008 | RLS 26 y 31; `alumnos-auth.spec.ts:266` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 31 …` | Cumple |
| EPT-24 C5: ACTIVO → INACTIVO y reactivación con curso | Cierre y nuevo tramo | 008 | RLS 27 y 30; `alumnos-auth.spec.ts:615` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 30: la reactivación exige un curso activo y agrega un tramo al historial` | Cumple |
| EPT-24 C6: DNI y legajo inválidos o duplicados | Rechazos con mensaje | 008, 009 | RLS 19.1 a 19.3, 20 a 22 y 54 a 56; `alumnos-auth.spec.ts:393` y `:484`; `usuarios-auth.spec.ts:377` y `:393` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `OK 21: legajo con espacios laterales rechazado (P5515)`; `ok … un DNI ya usado se rechaza antes de crear la cuenta de Auth` | Cumple |
| EPT-24 C7: dos altas o correcciones concurrentes con el mismo DNI | Una confirma | 008 | Concurrencia 18 y 18bis | `node supabase/tests/alumnos_academicos_concurrencia.mjs` | `OK CONCURRENCIA 18 …`; `OK CONCURRENCIA 18bis …` | Cumple |
| EPT-24 C8: dos matrículas concurrentes para el mismo estudiante | Una vigente | 008 | Concurrencia 17 y 17bis | `node supabase/tests/alumnos_academicos_concurrencia.mjs` | `OK CONCURRENCIA 17 …` | Cumple |
| EPT-24 C9: carrera entre asignación e inactivación de curso | Orden determinista en los dos sentidos | 008 | Concurrencia 20a y 20b; Niveles: 4 escenarios | `node supabase/tests/alumnos_academicos_concurrencia.mjs`; `node supabase/tests/niveles_concurrencia.mjs` | `OK CONCURRENCIA 20a …`; `OK CONCURRENCIA 20b …`; `OK CONCURRENCIA cursos: inactivación primero rechaza P5504` | Cumple |
| EPT-24 C10: cero persistencia parcial en todos los rechazos | Nada queda | 008, 010 | RLS 25; alta atómica 12 a 19; `usuarios-auth.spec.ts:281` y `:336`; invariantes de reconciliación | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/usuarios_alta_atomica.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list`; `node supabase/tests/usuarios_reconciliacion.mjs` | `OK 12: un DNI ya registrado revierte también la cuenta; no quedó cuenta, perfil ni legajo`; `ok … si PostgreSQL rechaza el perfil, la cuenta tampoco llega a existir`; `180 afirmaciones, 0 incumplida(s).` | Cumple |
| EPT-24 C11: DIRECTOR permitido; ESTUDIANTE solo lectura propia; ajeno, DOCENTE, PADRE, PERSONAL, sin perfil y anónimo denegados | Matriz de la sección 7 | 008; rutas | RLS 38 a 48; siete proyectos de actor; `alumnos.spec.ts` | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `chromium-estudiante` 14, `chromium-estudiante-ajeno` 3, `chromium-docente` 5, `chromium-padre` 4, `chromium-personal` 4, `chromium-sin-perfil` 4, todos `ok` | Cumple |
| EPT-24 C12: listado, detalle, historial y vista propia con base real | Sesión real | Páginas de EPT-9 | `alumnos-auth.spec.ts:581` y `:770`; capturas `real-*` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … el listado y el detalle persisten después de recargar` | Cumple |
| EPT-24 C13: carga, vacío, validación, error de servidor, envío y éxito | Estados visibles | `GestionAlumnos.tsx`; `usuarios/page.tsx` | `alumnos-ui.spec.ts:115`, `:199`, `:418`; `alumnos-auth.spec.ts:724`; `usuarios-auth.spec.ts:793` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … el error de lectura del listado ofrece un único enlace para reintentar`; `ok … un error de carga de roles no se oculta y no muestra detalle técnico` | Cumple |
| EPT-24 C14: teclado, foco, alertas y región viva | Diálogos y región `aria-live` | `GestionAlumnos.tsx` | `alumnos-ui.spec.ts:378` y `:452`; `alumnos-correcciones.spec.ts:288` y `:425` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | `ok … retiene el foco en el diálogo, cierra con Escape y lo devuelve` en tres perfiles | Cumple |
| EPT-24 C15: escritorio, Pixel 5/Chromium e iPhone 13/WebKit | Tres proyectos | `playwright.config.ts` | Proyectos `chromium`, `pixel-5-chromium`, `iphone-13-webkit` | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | 106, 38 y 38 casos `ok` | Cumple |
| EPT-24 C16: regresión exacta de Cursos y Niveles | Suites sin relajar | Sección 13.4 | SQL, concurrencia y Playwright de Cursos y Niveles | `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/cursos_rls.sql`; `docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/niveles_rls.sql`; `node supabase/tests/niveles_concurrencia.mjs`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | 39 y 73 OK; 4 OK; 75 casos `ok` | Cumple |
| EPT-24 C17: reset, tipos, TypeScript, ESLint focalizado, build y E2E completa | Todo en verde o clasificado | `supabase/migrations/*`; `src/*`; `tests/*` | Pasos 04, 15, 17, 18, 21 y 26 | `npx supabase db reset --local`; `node supabase/tests/tipos-generados.mjs`; `npx tsc --noEmit --incremental false`; `npx eslint $(git diff --name-only --diff-filter=d 4b593a70aa2030c6d1f3051f47d5131b6d41292c HEAD -- '*.ts' '*.tsx' '*.mjs' '*.js')`; `ENTORNO_LOCAL="$(npx supabase status -o env)" && NEXT_PUBLIC_SUPABASE_URL="$(printf '%s\n' "$ENTORNO_LOCAL" \| rg -o -r '$1' '^API_URL="(.*)"$')" NEXT_PUBLIC_SUPABASE_ANON_KEY="$(printf '%s\n' "$ENTORNO_LOCAL" \| rg -o -r '$1' '^ANON_KEY="(.*)"$')" npx next build`; `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | Salida 0 en los seis; `✖ 2 problems (0 errors, 2 warnings)`; `(20/20)`; `309 passed (4.7m)` | Cumple |
| EPT-24 regla 1: comando, código de salida y resultado exacto | Sección 12 | — | — | No aplica | Registrados para los 29 pasos, las mutaciones y las corridas focalizadas | Cumple |
| EPT-24 regla 2: preexistentes solo si se reproducen sobre la base integrada | Comparación real | — | ESLint de cada archivo contra su versión en la base; asesores con la base reconstruida | `node "$TEMP/eslint-contra-base.mjs" e31bdf250e06ca9aae1233c2ee737a0443f4df51 "$TEMP/eslint-contra-base.json"` (guion completo en 13.1); `npx supabase db reset --local --version 007 --no-seed`; `npx supabase db advisors --local --type all --level info --fail-on none --output-format json` | `{"totalCandidato":{"errores":15,"avisos":109},"totalBaseMismosArchivos":{"errores":15,"avisos":109}}` y `igual a la base` en los 28 archivos; asesores: 32 en la base, 35 en el candidato, 4 nuevos y 1 desaparecido (13.2). El build sin variables **no** se declara preexistente (13.3) | Cumple |
| EPT-24 regla 3: no modificar pruebas para reducir garantías | Cambios que agregan o endurecen aserciones | `tests/*`; `supabase/tests/*` | Diferencias desde el inicio de la cuarta ronda | `git diff --stat 4b593a70aa2030c6d1f3051f47d5131b6d41292c 72d5fb6f323aefc154d0e725b0ec7f30edb4f754 -- tests supabase/tests` | `16 files changed, 3854 insertions(+), 1443 deletions(-)`. Las supresiones corresponden a reescrituras con más casos (`usuarios-auth.spec.ts`, `_contraste.ts`, `usuarios_reconciliacion.mjs`, arnés). El endurecimiento final agrega tres discriminadores de contraste, la carrera de captura y el padre que termina antes que su descendiente. Las pruebas de Cursos y Niveles no cambiaron en esta ronda | Cumple |
| EPT-24 cierre | Pruebas ejecutadas y trazables | — | Secciones 8 y 12 | No aplica | Ejecutadas; la incidencia sigue En curso | Cumple la condición; transición pendiente |

### 8.7 EPT-25: entregables y reglas de cierre

| Jira / criterio | Comportamiento esperado | Archivo o migración | Prueba concreta | Comando exacto | Resultado exacto | Veredicto |
|---|---|---|---|---|---|---|
| EPT-25 E1: `docs/evidence/EPT-9.md` en español profesional | Este archivo | `docs/evidence/EPT-9.md` | Lectura | No aplica | — | Cumple |
| EPT-25 E2: matriz completa de EPT-9 y EPT-20..EPT-25 | Una fila por criterio | Sección 8 | — | No aplica | 24 + 14 + 14 + 14 + 14 + 21 + 16 filas | Cumple |
| EPT-25 E3: baseline remoto, rama, worktree, commits y estado final limpio | Sección 1 | Git | Candidato endurecido | `git rev-parse HEAD origin/main && git branch --show-current && git status --porcelain=v1 \| wc -l && git ls-remote origin refs/heads/main 'refs/heads/codex/ept-9-*' && gh pr list --head codex/ept-9-academic-students --state all --json number,state,url` | Al congelar `72d5fb6`: candidato `72d5fb6f323aefc154d0e725b0ec7f30edb4f754`; base `e31bdf250e06ca9aae1233c2ee737a0443f4df51`; rama correcta; `0` archivos modificados; solo `refs/heads/main`; `[]` | Cumple. El commit de este documento queda después y se comprueba en el informe final |
| EPT-25 E4: migraciones y tipos con su procedencia | Secciones 6 y 12 | `supabase/migrations/*`; `src/types/database.generated.ts` | Pasos 04, 06 y 15 | `npx supabase db reset --local`; `npx supabase migration list --local`; `node supabase/tests/tipos-generados.mjs` | 10 migraciones aplicadas; lista de `001` a `010`; `OK  src/types/database.generated.ts coincide byte a byte con la salida normalizada` | Cumple |
| EPT-25 E5: matrices de autorización de página, API, función, tabla y fila | Sección 7 | Este documento | Consultas de 7.3 a 7.5 | No aplica: entregable documental. Las tres consultas completas están en 7.3, 7.4 y 7.5 | Resultados transcritos en esas secciones | Cumple |
| EPT-25 E6: resultados exactos de reset, SQL/RLS, concurrencia, TypeScript, lint, build, Playwright focalizado y completo, y regresiones | Sección 12 | Este documento | 29 pasos; corridas focalizadas de 12.3 | No aplica: entregable documental. Los comandos completos están en 12.1 a 12.4 | Resultados transcritos en esas secciones | Cumple |
| EPT-25 E7: capturas de tres perfiles, fixtures separadas de datos reales | Prefijos `fixture-` y `real-` | `docs/evidence/EPT-9/` | Inventario de la sección 14 | `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list` | 61 capturas: 19 `fixture-chromium-*`, 18 `fixture-pixel-5-chromium-*`, 18 `fixture-iphone-13-webkit-*` y 6 `real-escritorio-*` | Cumple |
| EPT-25 E8: seguridad, privacidad, secretos, accesibilidad e idioma | Secciones 11 y 15 | Rama completa | Paso 28 | `git diff e31bdf250e06ca9aae1233c2ee737a0443f4df51 HEAD \| rg '^\+' \| rg -n --pcre2 'eyJhbGciOi[A-Za-z0-9_-]{20,}\|sb_secret_[A-Za-z0-9_-]{10,}\|sb_publishable_[A-Za-z0-9_-]{10,}\|-----BEGIN [A-Z ]*PRIVATE KEY\|SUPABASE_SERVICE_ROLE_KEY\s*=\s*["\x27]?[A-Za-z0-9]\|postgres(ql)?://[^:\s]+:[^@\s]+@(?!127\.0\.0\.1)\|[a-z0-9]{20}\.supabase\.co' \|\| echo 'sin coincidencias'`; `git ls-files \| rg '(^\|/)\.env' \|\| echo 'ninguno'` | Dos líneas, las del valor sintético del arnés (sección 15); `ninguno` | Cumple |
| EPT-25 E9: decisiones, riesgos fuera de alcance, retrospectiva y siguiente unidad | Secciones 4, 18, 19 y 20 | — | — | No aplica | — | Cumple |
| EPT-25 E10: límite de reversión | Sección 17 | — | — | No aplica | — | Cumple |
| EPT-25 E11: commits convencionales sin `Co-Authored-By` ni atribución | Asuntos y trailers | Git | Estáticas | `git log --format='%s' e31bdf250e06ca9aae1233c2ee737a0443f4df51..72d5fb6f323aefc154d0e725b0ec7f30edb4f754 \| rg -v '^(feat\|fix\|docs\|test\|refactor\|chore\|style\|perf\|build\|ci)(\([a-z0-9-]+\))?!?: '`; `git log e31bdf250e06ca9aae1233c2ee737a0443f4df51..HEAD --format=%B \| rg -n -i 'co-authored\|generated with\|claude\|anthropic\|openai\|chatgpt\|copilot\|🤖' \|\| echo 'sin coincidencias'`; `git log e31bdf250e06ca9aae1233c2ee737a0443f4df51..HEAD --format='%(trailers:only)' \| rg -v '^$' \|\| echo 'sin trailers'` | Sin salida (salida 1): los 32 asuntos hasta el candidato endurecido son convencionales; `sin coincidencias`; `sin trailers` | Cumple |
| EPT-25 E12: revisión independiente documentada antes de push o PR | Revisión del nuevo SHA | — | — | No aplica | No realizada todavía | **Pendiente** |
| EPT-25 E13: PR en español cuando exista autorización posterior | — | — | — | No aplica | No hay PR: esta ronda lo prohíbe | No aplica todavía |
| EPT-25 E14: comentario de evidencia en cada incidencia antes de cualquier transición a Listo | Comentarios en las siete | Jira | Consulta en vivo (sección 2) | No aplica | Publicados después del primer commit documental: EPT-9 `10125`, EPT-20 `10126`, EPT-21 `10127`, EPT-22 `10128`, EPT-23 `10129`, EPT-24 `10130` y EPT-25 `10131`; las siete siguen `En curso` | Cumple; ninguna transición ocurrió |
| EPT-25 política de Jira | Subtareas a Listo solo con evidencia; EPT-9 En curso hasta hijas, revisión e integración | Jira | Sección 2 | No aplica | Las siete `En curso` | Cumple |
| EPT-25 cierre | Evidencia igual a los bytes finales; Jira real; ninguna afirmación sin demostrar | — | Secciones 0 y 12 | `git diff --stat 72d5fb6f323aefc154d0e725b0ec7f30edb4f754 HEAD` | Después del candidato endurecido solo debe aparecer este documento. El resultado se verifica en el informe final, porque el archivo no puede contener el SHA del commit que lo introduce | Cumple la condición; transición pendiente |

---

## 9. Pruebas de carrera y fallos ambiguos

### 9.1 El intermediario

`supabase/tests/usuarios_reconciliacion.mjs` levanta un intermediario delante de
Auth y de PostgREST y decide, petición por petición, qué hacer con cada escritura:

| Plan | Qué hace |
|---|---|
| `perder-respuesta` | Reenvía, espera la confirmación y devuelve 502 |
| `en-vuelo` | Devuelve 502 al instante y reenvía la escritura después: el error llega antes de que la escritura exista |
| `retener` | Reenvía, espera la confirmación y no responde nunca |
| `retener-sin-reenviar` | Guarda la escritura hasta que la prueba la libera |
| `cortar` | Cierra la conexión sin reenviar |

Levanta su propio servidor de Next en el puerto 3210, siembra su directora y
limpia todo al terminar. Pasa a los procesos hijos una lista blanca de variables.
Después de cada escenario comprueba cinco invariantes globales: ninguna cuenta sin
perfil, ningún perfil apuntando a una cuenta borrada, ningún ESTUDIANTE sin legajo
académico, ninguna matrícula parcial y ninguna cuenta con `ept_alta` en
`app_metadata`.

### 9.2 Escenarios y casos exigidos

Resultado de la corrida: `180 afirmaciones, 0 incumplida(s).`, salida 0.

| Caso exigido por la revisión | Escenario | Afirmación central |
|---|---|---|
| Escritura confirmada y respuesta perdida | C | `OK  C: la ruta la reconcilia como confirmada (200)` y `OK  C: nada se borró: cuenta, perfil y legajo siguen juntos` |
| INSERT retrasado a propósito, todavía en vuelo | D | `OK  D: con todo en vuelo responde 503 ALTA_SIN_CONFIRMAR (503 ALTA_SIN_CONFIRMAR)` |
| Primera lectura vacía y confirmación tardía | D y E | `OK  D: en el momento de responder la lectura está vacía: la escritura todavía no llegó`; `OK  D: confirmación tardía: cuenta, perfil y legajo existen y nada se borró`; `OK  E: la escritura tardía no creó una segunda cuenta (422)` |
| Rechazo determinista | B | `OK  B: un rechazo confirmado responde 422 ALTA_RECHAZADA (422 ALTA_RECHAZADA)` y `OK  B: la transacción revirtió también la cuenta` |
| Perfil existente coherente | F e I | `OK  F: repetir una operación confirmada responde 200 reconciliada (200)`; `OK  I: a lo sumo uno creó la cuenta; el otro la reconcilió` |
| Perfil existente incompatible | G y K | `OK  G: otra identidad con la misma operación responde 409 OPERACION_REUTILIZADA (409 OPERACION_REUTILIZADA)`; `OK  K: la cuenta inconsistente NO se borró a ciegas` |
| Caída durante la reconciliación | L y M | `OK  L: después de reiniciar, la misma operación se reconcilia (200)`; `OK  M: la escritura llegó después de la caída y confirmó` |
| Reintento de la misma operación | B, D, F, L y M | `OK  D: reintentar la misma operación confirma sin duplicar (200)` |
| Prueba inversa del código anterior | N | `OK  N: la ruta anterior BORRÓ la cuenta tras una sola lectura vacía` |
| Sin cuentas borradas, huérfanos, duplicados, matrículas parciales ni estados imposibles | Todos | Las cinco invariantes después de cada escenario, y `OK  la base quedó sin datos de la suite` |
| Garantía de la 010 ausente | O | `OK  O: sin el trigger, la ruta no afirma éxito: responde 500 ESTADO_INCONSISTENTE (500 ESTADO_INCONSISTENTE)` |
| Duplicados ajenos | H | `OK  H: un legajo ajeno en minúsculas responde 409 LEGAJO_DUPLICADO (409 LEGAJO_DUPLICADO)` |
| Auth sin respuesta en todos los intentos | J | `OK  J: sin respuesta de Auth responde 503 ALTA_SIN_CONFIRMAR (503 ALTA_SIN_CONFIRMAR)` |

### 9.3 Alta atómica en PostgreSQL

`usuarios_alta_atomica.sql` corre como `supabase_admin` porque reproduce la
secuencia de GoTrue con `SET LOCAL ROLE supabase_auth_admin`, y `postgres` no es
miembro de ese rol. Resultado: 23 líneas OK, salida 0.

| # | Aserción |
|---|---|
| 1 | La función es SECURITY DEFINER con `search_path` vacío |
| 2 | Ningún rol de aplicación puede invocar la función |
| 3 | Trigger BEFORE INSERT OR UPDATE OF `raw_app_meta_data`, por fila, con WHEN y habilitado |
| 4 | `anon`, `authenticated` y `service_role` no pueden escribir `auth.users` |
| 5 | `supabase_auth_admin` no tiene privilegios propios sobre `perfiles` |
| 6 | El UPDATE de `app_metadata` de GoTrue crea el perfil en la misma transacción |
| 7 | Un rol que no es ESTUDIANTE no recibe legajo académico |
| 8 | La clave `ept_alta` se retira y el resto de `app_metadata` queda intacto |
| 9 | Un ESTUDIANTE nace con perfil y legajo académico INACTIVO coherentes |
| 10 | Un alta que trae `app_metadata` desde el INSERT también crea el perfil y retira la clave |
| 11 | Repetir exactamente el mismo alta es idempotente |
| 12 | Un DNI ya registrado revierte también la cuenta |
| 13 | Un legajo que solo difiere en mayúsculas revierte también la cuenta |
| 14 | Un rol inexistente revierte también la cuenta |
| 15 | Un DNI que no cumple el contrato revierte también la cuenta |
| 16 | Un pedido de alta que no es un objeto se rechaza |
| 17 | Una clave que el perfil no admite se rechaza en lugar de ignorarse |
| 18 | Un rol enviado como texto se rechaza |
| 19 | Un pedido sin nombre se rechaza |
| 20 | Una cuenta con perfil no acepta otro perfil ni cambia el que tiene |
| 21 | Un `ept_alta` en `raw_user_meta_data` (autorregistro) no crea ningún perfil |
| 22 | Un inicio de sesión o un cambio de `app_metadata` sin `ept_alta` no toca perfiles |
| 23 | Ninguna cuenta conserva datos personales del alta en `app_metadata` |

### 9.4 Concurrencia académica

Dos procesos `psql` independientes. Cada escenario comprueba con
`pg_blocking_pids` que la segunda transacción quedó bloqueada por la primera antes
de confirmar; no hay esperas por tiempo.

| # | Escenario | Resultado |
|---|---|---|
| 17 | Dos matrículas simultáneas | Una sola vigente |
| 17bis | Dos inserciones directas | El índice único parcial rechaza la segunda (`23505`) |
| 18 | Dos altas con el mismo DNI | Una sola (`23505`) |
| 18bis | Dos correcciones hacia el mismo DNI | Una sola (`23505`) |
| 18ter | Mismo legajo con distinta caja | No se duplica (`23505`) |
| 19 | Asignación contra la inactivación del estudiante | Se rechaza (`P5513`) |
| 20a | Asignación primero | Impide inactivar el curso (`P5514`) |
| 20b | Inactivación primero | Rechaza la asignación tardía (`P5504`) |

`niveles_concurrencia.mjs` agrega cuatro escenarios de EPT-55 para cursos y
actividades, en los dos órdenes.

---

## 10. Pruebas de errores de dominio

| Situación | Frontera | Prueba | Resultado observado |
|---|---|---|---|
| Alta sin sesión | API | `usuarios-auth.spec.ts:482`; `alumnos.spec.ts:43` | 401 con `Necesitás iniciar sesión para continuar.` |
| Alta de un actor sin permiso | API | `usuarios-auth.spec.ts:502`; `alumnos-auth.spec.ts:957` | 403 con mensaje de dominio; nada creado |
| Cuerpo que no es JSON | API | `usuarios-auth.spec.ts:317`; `alumnos.spec.ts:74` | 400 `CUERPO_INVALIDO` o 401 antes de leer |
| Tipos equivocados | API | `usuarios-auth.spec.ts:297` | Mensajes en español, nunca los de Zod |
| Rol inexistente | API | `usuarios-auth.spec.ts:328` | 422 `ROL_INEXISTENTE` |
| PostgreSQL rechaza el perfil | API y base | `usuarios-auth.spec.ts:336`; reconciliación B | 422 `ALTA_RECHAZADA`; la cuenta no existe; el reintento sin el rechazo confirma |
| DNI, legajo o email duplicados | API y pantalla | `usuarios-auth.spec.ts:377`, `:393`, `:404`, `:606`; reconciliación H | 409 con el campo marcado y aviso persistente |
| Operación reutilizada | API | `usuarios-auth.spec.ts:461`; reconciliación G | 409 `OPERACION_REUTILIZADA`; la existente intacta |
| Respuesta del alta perdida | Pantalla | `usuarios-auth.spec.ts:625`; reconciliación C | La pantalla lo dice y el reintento no duplica |
| Respuesta sin código de dominio | Pantalla | `usuarios-auth.spec.ts:663` | Nunca se muestra tal cual |
| Conexión cortada al crear o al editar | Pantalla | `usuarios-auth.spec.ts:690` y `:778` | Mensaje de dominio, sin el error del navegador |
| Edición sin política UPDATE (`PGRST116`) | Pantalla y base | `usuarios-auth.spec.ts:701` | `No se guardaron los cambios…`; la base conserva el valor |
| Edición con `23505`, `42501`, restricción desconocida o `57014` | Pantalla | `usuarios-auth.spec.ts:760` (cuatro casos) | Mensaje de dominio por caso |
| Error de carga de roles | Pantalla | `usuarios-auth.spec.ts:793` y `:811` | Aviso persistente con reintento que vuelve a cargar |
| Tiempo agotado de PostgreSQL al cargar | Pantalla | Clasificador, caso `57014` | Estado de error estable, sin detalle técnico |
| Permiso denegado en lecturas académicas | Pantalla con base real | `alumnos-auth.spec.ts:700` y `:724`, con `REVOKE` real | Mensaje de dominio y un único enlace para volver o reintentar |
| Auth sin respuesta o escrituras en vuelo | API | Reconciliación J y D | 503 `ALTA_SIN_CONFIRMAR`, con referencia; nada creado en J y nada borrado en D |
| Estado imposible | API | Reconciliación K y O | 500 `ESTADO_INCONSISTENTE`, con referencia; nada borrado ni inventado |

**La guardia.** `tests/_sin-detalle-tecnico.ts` recorre el texto visible, los
atributos `aria-label`, `aria-description`, `title` y `alt`, y cada mensaje de la
API. Falla ante SQLSTATE, códigos de PostgREST, `schema cache`,
`permission denied`, nombres de restricciones o tablas, SQL, URL internas y
trazas. La reconciliación aplica la misma idea a las respuestas de error y a las
de éxito de sus escenarios: `OK  …: la respuesta no contiene detalle técnico`
aparece 11 veces, en A, B, C, D, E, G, H (dos), J, K y O.

---

## 11. Contraste, semántica y accesibilidad

### 11.1 La auditoría de contraste falla cerrada

`tests/_contraste.ts` pinta cada color en un canvas sobre negro y sobre blanco, y
compone con la fórmula `negro + (blanco − negro) × B / 255` sobre los valores que
devuelve `getImageData`, que no están premultiplicados: no se vuelve a dividir
por alfa. Toma la pila real de pintura con `elementsFromPoint`, espera a que
terminen las animaciones y exige 4,5:1 para texto normal y 3:1 para texto grande.
Cada informe cuenta los elementos inspeccionados, medidos y omitidos, con motivo.
Una omisión dentro de un selector esencial bloquea.

Casos negativos, en tres perfiles cada uno (`alumnos-contraste.spec.ts`):

| Línea | Caso | Resultado exigido |
|---|---|---|
| 182 | Color de texto que no se puede interpretar | Fallo |
| 189 | Color de fondo que no se puede interpretar | Fallo |
| 196 | Fondo con degradado | Fallo explícito, sin inventar un color plano |
| 206 | Fondo transparente | Se resuelve por el píxel real, no por los ancestros |
| 233 | Texto semitransparente | Se compone con su fondo |
| 246 | Color moderno no soportado (`device-cmyk`) | Fallo |
| 256 | Sin canvas | La auditoría no se ejecuta y falla |
| 265 | Selector esencial ausente | Fallo |
| 271 | Cero mediciones, mínimo 0 o sin esenciales | Fallo, no éxito silencioso |
| 280 | Texto esencial omitido | Bloquea aunque todo lo demás pase |
| 289 | Caso donde la cuenta de alfa anterior aprobaba en falso | Fallo con la cuenta correcta |
| 327 | Texto cubierto por otro elemento | No se da por medido |
| 347 | Dos nodos de texto con el mismo `parentElement` | Ambos se inspeccionan y miden |
| 364 | Contraste insuficiente recién después de la tercera línea | Se inspeccionan todas las líneas y falla |
| 406 | Ratio real 4,496:1 | Falla contra 4,5:1 sin tolerancia oculta; el redondeo solo afecta el informe |
| 421 | Afirmar que no hay texto visible cuando lo hay | Fallo |

Los siete casos positivos miden el listado, el formulario en sus dos estados, los
errores de validación, el diálogo de cambio de curso, el listado vacío y sin
cursos activos, y los mensajes de error y éxito. El estado de carga se comprueba
sin texto visible que medir. Con base real miden además el detalle
(`alumnos-auth.spec.ts:661`) y la vista propia (`:829`).

`tests/captura.spec.ts` agrega un caso de carrera: inyecta un overlay de error de
Next dentro de la propia operación de `screenshot`. `tests/_captura.ts` ya no
oculta globalmente `nextjs-portal`; retira solo los indicadores inocuos dentro
del shadow root, comprueba inmediatamente antes y después de capturar, elimina
el PNG inválido y falla con el texto del overlay si aparece durante la captura.

### 11.2 Un único control interactivo

`EnlaceBoton` renderiza un solo `<a>` con las clases de botón, en lugar de un
`Link` que envuelve un `Button`. Sus usos en EPT-9:

```bash
rg -n "<Link|<Button|<EnlaceBoton" src/app/dashboard/alumnos/page.tsx "src/app/dashboard/alumnos/[id]/page.tsx" src/app/dashboard/mi-legajo/page.tsx src/app/dashboard/alumnos/_components/SituacionAcademica.tsx src/app/dashboard/layout.tsx
```

La salida muestra `EnlaceBoton` en `alumnos/page.tsx:31` y `:78`,
`[id]/page.tsx:40`, `mi-legajo/page.tsx:35`, `SituacionAcademica.tsx:128` y
`layout.tsx:235`, y ningún `<Button>` en esos archivos.

| Comprobación | Tipo | Prueba |
|---|---|---|
| Ningún enlace contiene un botón y ningún botón contiene un enlace, en toda la superficie de EPT-9 | Estática (AST de TSX) | `semantica-estatica.spec.ts:77`, sobre `dashboard/alumnos`, `dashboard/mi-legajo`, `dashboard/usuarios`, `pruebas-ui/alumnos`, `components/ui` y `dashboard/layout.tsx` |
| La guardia detecta los dos anidamientos | Estática, caso sintético | `semantica-estatica.spec.ts:90`: `caso-sintetico.tsx:5 — <Button> dentro de <Link>` y `:7 — <a> dentro de <button>` |
| Un solo enlace, cero botones, nombre accesible, destino, recorrido con Tab y activación con Enter | Tiempo de ejecución | `alumnos-auth.spec.ts:700`, `:724` y `:942` (cuatro actores) |
| La guardia falla si se reintroduce el anidamiento | Mutación | M4 (sección 3.4) |

Durante la ronda, la guardia estática aplicada ad hoc a los árboles de
`4b593a70` y de la base encontró 6 y 1 anidamientos respectivamente; el de la
base era el del acceso restringido de `layout.tsx`. Esa ejecución no está
versionada: la prueba reproducible es la mutación M4.

### 11.3 Teclado, foco, estados y responsive

| Requisito | Cómo se cumple | Prueba |
|---|---|---|
| Foco contenido con el diálogo ocupado | Tab y Shift+Tab retenidos en el cuadro, aun sin controles habilitados | `alumnos-correcciones.spec.ts:288` |
| Foco al deshabilitarse el control enfocado | El cuadro es enfocable por programa | `alumnos-correcciones.spec.ts:232` |
| Escape y devolución del foco | Cierra si no hay operación en vuelo y devuelve el foco al disparador | `alumnos-ui.spec.ts:378` (tres perfiles); `alumnos-correcciones.spec.ts:403` |
| Errores de campo | `aria-invalid` y `aria-describedby` con el mensaje | `alumnos-correcciones.spec.ts:453` y `:472` |
| Región viva y estados | `role="status"`, `role="alert"` y `aria-live="polite"` | `alumnos-ui.spec.ts:418` y `:452` |
| `aria-busy` durante la operación | El diálogo lo marca y lo retira | `alumnos-correcciones.spec.ts:182` |
| Nombre accesible con la etiqueta visible (WCAG 2.5.3) | `Cambiar curso del alumno Arrieta, Camila` | `alumnos-correcciones.spec.ts:152` |
| Sin desplazamiento horizontal | `scrollWidth <= clientWidth + 1` | `alumnos-ui.spec.ts:84` y `:411`, en tres perfiles |

WebKit no enfoca un `button` al hacer clic, así que las pruebas de devolución del
foco abren el diálogo por teclado.

### 11.4 Idioma

`alumnos-ui.spec.ts:452` recorre el texto visible y los atributos `aria-label`,
`placeholder` y `title` en tres perfiles y falla ante palabras en inglés. La
guardia de detalle técnico de la sección 10 cubre los mensajes crudos de PostgREST,
PostgreSQL y Auth.

---

## 12. Comandos exactos, códigos y resultados

### 12.1 La verificación completa

Ejecutada en este orden, con HEAD en `c3aaba0394bbdea59cd848a67f38d30fbab7b0be`,
desde la raíz del worktree y sin ninguna otra prueba ni escritura sobre la base
local mientras corría. El árbol estaba limpio al empezar (paso 00). Mientras
corrían los pasos 21 a 28 se redactaba este documento en `docs/evidence/EPT-9.md`,
un archivo que ninguno de esos pasos lee.

```bash
# 00
git rev-parse HEAD origin/main && git branch --show-current && git status --porcelain=v1 | wc -l && git ls-remote origin refs/heads/main 'refs/heads/codex/ept-9-*' && gh pr list --head codex/ept-9-academic-students --state all --json number,state,url
# 01
docker ps --filter name=supabase_ --format '{{.Names}}\t{{.Status}}'
# 02
npx supabase db reset --local --version 007 --no-seed
# 03
npx supabase db advisors --local --type all --level info --fail-on none --output-format json
# 04
npx supabase db reset --local
# 05
npx supabase db advisors --local --type all --level info --fail-on none --output-format json
# 06
npx supabase migration list --local
# 07
npx supabase db lint --local --level warning
# 08
docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/alumnos_academicos_rls.sql
# 09
docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/cursos_rls.sql
# 10
docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/niveles_rls.sql
# 11
docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/usuarios_alta_atomica.sql
# 12
node supabase/tests/alumnos_academicos_concurrencia.mjs
# 13
node supabase/tests/niveles_concurrencia.mjs
# 14
node supabase/tests/migracion_009_colisiones.mjs
# 15
node supabase/tests/tipos-generados.mjs
# 16
git diff --check && git diff --check e31bdf250e06ca9aae1233c2ee737a0443f4df51 HEAD
# 17
npx tsc --noEmit --incremental false
# 18
npx eslint $(git diff --name-only --diff-filter=d 4b593a70aa2030c6d1f3051f47d5131b6d41292c HEAD -- '*.ts' '*.tsx' '*.mjs' '*.js')
# 19
npx eslint $(git diff --name-only --diff-filter=d e31bdf250e06ca9aae1233c2ee737a0443f4df51 HEAD -- '*.ts' '*.tsx' '*.mjs' '*.js')
# 20
npx eslint
# 21
ENTORNO_LOCAL="$(npx supabase status -o env)" && NEXT_PUBLIC_SUPABASE_URL="$(printf '%s\n' "$ENTORNO_LOCAL" | rg -o -r '$1' '^API_URL="(.*)"$')" NEXT_PUBLIC_SUPABASE_ANON_KEY="$(printf '%s\n' "$ENTORNO_LOCAL" | rg -o -r '$1' '^ANON_KEY="(.*)"$')" npx next build
# 22
node supabase/tests/harness_produccion.mjs
# 23
node supabase/tests/harness_produccion_negativas.mjs
# 24
node supabase/tests/usuarios_reconciliacion.mjs
# 25
sha256sum docs/evidence/EPT-9/*.png docs/evidence/EPT-8/*.png docs/evidence/EPT-55/*.png
# 26
EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs --retries=0 --reporter=list
# 27
sha256sum docs/evidence/EPT-9/*.png docs/evidence/EPT-8/*.png docs/evidence/EPT-55/*.png
# 28
echo '== secretos en líneas agregadas por la rama'; git diff e31bdf250e06ca9aae1233c2ee737a0443f4df51 HEAD | rg '^\+' | rg -n --pcre2 'eyJhbGciOi[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{10,}|sb_publishable_[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY\s*=\s*["\x27]?[A-Za-z0-9]|postgres(ql)?://[^:\s]+:[^@\s]+@(?!127\.0\.0\.1)|[a-z0-9]{20}\.supabase\.co' || echo 'sin coincidencias'; echo '== archivos de entorno versionados'; git ls-files | rg '(^|/)\.env' || echo 'ninguno'; echo '== atribución en mensajes de commit de la rama'; git log e31bdf250e06ca9aae1233c2ee737a0443f4df51..HEAD --format=%B | rg -n -i 'co-authored|generated with|claude|anthropic|openai|chatgpt|copilot|🤖' || echo 'sin coincidencias'; echo '== trailers de commit'; git log e31bdf250e06ca9aae1233c2ee737a0443f4df51..HEAD --format='%(trailers:only)' | rg -v '^$' || echo 'sin trailers'
```

| Paso | Salida | Duración | Resultado exacto |
|---|---|---|---|
| 00 | 0 | 2 s | `c3aaba0394bbdea59cd848a67f38d30fbab7b0be`, `e31bdf250e06ca9aae1233c2ee737a0443f4df51`, `codex/ept-9-academic-students`, `0` archivos modificados, `e31bdf250e06ca9aae1233c2ee737a0443f4df51 refs/heads/main` sin ninguna rama remota de EPT-9, y `[]` |
| 01 | 0 | 0 s | 12 contenedores: 9 `Up … (healthy)`, `edge_runtime` y `rest` `Up` sin chequeo de salud, y `supabase_vector_educar-para-transformar` en `Restarting`. Vector solo recolecta registros y ninguna prueba lo usa |
| 02 | 0 | 34 s | Aplica `001_initial_schema.sql` a `007_correcciones_integridad_niveles.sql`, sin semillas; `Finished supabase db reset on branch main.` |
| 03 | 0 | 4 s | 32 hallazgos sobre la base (sección 13.2) |
| 04 | 0 | 33 s | 10 líneas `Applying migration`, de `001` a `010_alta_atomica_de_cuentas.sql`; `Finished supabase db reset on branch main.` |
| 05 | 0 | 3 s | 35 hallazgos sobre el candidato (sección 13.2) |
| 06 | 0 | 2 s | `{"migrations":[{"local":"001","remote":"001",…},…,{"local":"010","remote":"010","time":"010"}],"message":"Migrations listed"}` |
| 07 | 0 | 3 s | `Linting schema: app_private`, `extensions`, `public`; `No schema errors found` |
| 08 | 0 | 1 s | 69 líneas `NOTICE:  OK`, ninguna `FALLO` |
| 09 | 0 | 0 s | 39 líneas `NOTICE:  OK`, ninguna `FALLO` |
| 10 | 0 | 0 s | 73 líneas `NOTICE:  OK`, ninguna `FALLO` |
| 11 | 0 | 0 s | 23 líneas `NOTICE:  OK`, ninguna `FALLO` |
| 12 | 0 | 1 s | 8 líneas `OK CONCURRENCIA` (17, 17bis, 18, 18bis, 18ter, 19, 20a, 20b) |
| 13 | 0 | 0 s | 4 líneas `OK CONCURRENCIA` (cursos y actividades, en los dos órdenes) |
| 14 | 0 | 6 s | 12 líneas `OK`; entre ellas `OK  la 009 se puede volver a aplicar (salida 0)` y `OK  con la restricción vaciada, la autoverificación aborta (salida 3)` |
| 15 | 0 | 9 s | 4 líneas `OK`: salida cruda `48d2ab2b11a2da52…`, normalizada `7b77055d2e2d4082…`, archivo idéntico byte a byte y sin línea en blanco final |
| 16 | 0 | 0 s | Sin salida |
| 17 | 0 | 5 s | Sin salida |
| 18 | 0 | 4 s | 35 archivos: `✖ 2 problems (0 errors, 2 warnings)` |
| 19 | 1 | 4 s | 61 archivos: `✖ 7 problems (2 errors, 5 warnings)`, idénticos a la base (13.1) |
| 20 | 1 | 7 s | `✖ 124 problems (15 errors, 109 warnings)`, idénticos a la base (13.1) |
| 21 | 0 | 17 s | `✓ Compiled successfully in 3.4s`; `✓ Generating static pages using 15 workers (20/20)` |
| 22 | 0 | 19 s | 21 líneas `OK`; `OK  se leyeron los artefactos del servidor (625)`; los tres bancos responden 404 con el mismo SHA-256 que una ruta inexistente (`28b1acf0622e8a14…`) |
| 23 | 0 | 14 s | 55 líneas `OK`; `OK  árbol bloqueado: termina en tiempo acotado aunque el nieto retenga las tuberías (4098 ms)`; `OK  no quedó ningún proceso lanzado por la prueba` |
| 24 | 0 | 51 s | `180 afirmaciones, 0 incumplida(s).` |
| 25 | 0 | 0 s | Hashes previos de 97 capturas (61 de EPT-9, 16 de EPT-8 y 20 de EPT-55) |
| 26 | 0 | 290 s | `309 passed (4.7m)`, sin reintentos. Por proyecto: `setup` 9, `chromium` 106, `pixel-5-chromium` 38, `iphone-13-webkit` 38, `chromium-directora` 84, `chromium-estudiante` 14, `chromium-estudiante-ajeno` 3, `chromium-docente` 5, `chromium-padre` 4, `chromium-personal` 4, `chromium-sin-perfil` 4 |
| 27 | 0 | 0 s | 34 capturas de EPT-9 cambiaron de bytes y 27 no. Las de EPT-8 y EPT-55 también se regeneraron: se restauraron con `git restore --source=HEAD --worktree -- docs/evidence/EPT-8 docs/evidence/EPT-55`, porque no pertenecen a esta unidad |
| 28 | 0 | 1 s | Secretos: dos líneas del valor sintético del arnés (sección 15); `ninguno`; `sin coincidencias`; `sin trailers` |

**Por archivo de Playwright (paso 26):** EPT-9 suma 221 casos:
`alumnos-contraste.spec.ts` 60, `usuarios-auth.spec.ts` 50, `alumnos-ui.spec.ts` 48,
`alumnos-auth.spec.ts` 40, `alumnos-correcciones.spec.ts` 11, `alumnos.spec.ts` 10 y
`semantica-estatica.spec.ts` 2. La regresión suma 79: `cursos-ui.spec.ts` 18,
`cursos-auth.spec.ts` 14, `niveles-auth.spec.ts` 14, `niveles-ui.spec.ts` 9,
`niveles.spec.ts` 9, `cursos.spec.ts` 7, `niveles-responsive.spec.ts` 4 y
`e2e.spec.ts` 4. `auth.setup.ts` agrega 9, que siembran identidades y sesiones y
no comprueban el producto.

Una verificación completa anterior, con los mismos 29 pasos, corrió sobre
`3c13a66`, con resultados idénticos salvo la reconciliación (167 afirmaciones, sin
el escenario O). La del candidato `c3aaba0` es la de esta tabla.

### 12.1 bis Endurecimiento final sobre `72d5fb6`

El commit `72d5fb6` no cambia código productivo ni migraciones. Antes de corregir
el instrumental, la primera corrida de las nuevas pruebas de contraste y captura
terminó con salida 1: `20 passed, 4 failed`. Fallaron exactamente la deduplicación
por `parentElement`, la cuarta línea no inspeccionada, el ratio 4,496 aceptado por
la tolerancia y el overlay de Next aparecido dentro de `screenshot`.

Después de la corrección se ejecutaron estos comandos sobre `72d5fb6`:

```bash
npx playwright test tests/alumnos-contraste.spec.ts tests/captura.spec.ts --project=chromium --retries=0
node supabase/tests/harness_produccion_negativas.mjs
npx tsc --noEmit --incremental false
npx eslint --no-cache tests/_contraste.ts tests/alumnos-contraste.spec.ts tests/_captura.ts tests/captura.spec.ts supabase/tests/_arnes-produccion.mjs supabase/tests/harness_produccion_negativas.mjs
git diff --check
```

| Comando | Salida | Resultado exacto |
|---|---:|---|
| Playwright focalizado | 0 | `24 passed`; incluye 23 casos de contraste y la carrera de captura |
| Negativas del arnés | 0 | `58 afirmaciones, 0 incumplida(s)`; el padre conserva su código 0 y el descendiente queda terminado antes de resolver |
| TypeScript | 0 | Sin salida |
| ESLint focalizado | 0 | Sin errores ni advertencias |
| `git diff --check` | 0 | Sin errores; Git solo avisó la conversión futura LF→CRLF del worktree |

No se presenta el caso del padre que termina primero como una mutación: es una
prueba negativa directa del cierre de grupo. La revisión final debe volver a
ejecutar la suite integral sobre el candidato completo antes del PR.

### 12.2 Mutaciones

M1, M3, M4 y M5 son ediciones de un solo archivo, descritas en la sección 3.4,
seguidas del comando indicado allí. La restauración se hizo copiando los bytes
originales y se verificó por SHA-256. El equivalente con Git, archivo por archivo:

```bash
git restore --source=HEAD -- src/app/dashboard/usuarios/page.tsx
git restore --source=HEAD -- src/lib/vinculos.ts
git restore --source=HEAD -- "src/app/dashboard/alumnos/[id]/page.tsx"
git restore --source=HEAD -- src/services/cuentas.service.ts
```

M2 se ejecuta dentro de una transacción que `psql` aborta al primer fallo, así que
no deja rastro:

```bash
{ printf "BEGIN;\nCREATE OR REPLACE FUNCTION app_private.registrar_perfil_de_alta() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$\$ BEGIN NEW.raw_app_meta_data := NEW.raw_app_meta_data - 'ept_alta'; RETURN NEW; END; \$\$;\n"; cat supabase/tests/usuarios_alta_atomica.sql; } | docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1
{ printf "BEGIN;\nALTER TABLE auth.users DISABLE TRIGGER registrar_perfil_al_crear_cuenta;\n"; cat supabase/tests/usuarios_alta_atomica.sql; } | docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1
```

Resultados: salida 3 en los dos, con `FALLO 6` y `FALLO 3` respectivamente.

### 12.3 Corridas focalizadas

| Comando | Árbol | Resultado | Salida |
|---|---|---|---|
| `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs tests/usuarios-auth.spec.ts --retries=0 --reporter=list` | El que se confirmó como `3c13a66` | `59 passed (1.2m)` | 0 |
| `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs tests/usuarios-auth.spec.ts --project=chromium-directora -g "no tolera roles" --retries=0 --reporter=list` | `d639e87` con el diagnóstico de `_captura.ts` | `1 failed`, con `Contenido del diálogo: … Console Error [usuarios] no se pudo cargar la pantalla …`. Así se identificó la causa de la sección 3.3 | 1 |
| `node supabase/tests/usuarios_reconciliacion.mjs` | El que se confirmó como `c3aaba0` | `180 afirmaciones, 0 incumplida(s).` | 0 |

### 12.4 Compilación sin variables de Supabase

Se ejecutó `next build` con la lista blanca del arnés y sin
`NEXT_PUBLIC_SUPABASE_URL` ni `NEXT_PUBLIC_SUPABASE_ANON_KEY`, sobre el árbol que
luego se confirmó como `3c13a66`.
Terminó con salida 1 en 11 s. Next informó
`Error occurred prerendering page "/_not-found"` durante la generación de páginas
estáticas, con `Error: Missing Supabase env vars`, que lanza
`src/services/supabase.ts`. Ese archivo es idéntico en la base (blob `0525e2a961d8`)
y en el candidato. No se declara un fallo preexistente: no pudo reproducirse sobre
la base (sección 13.3). La compilación del paso 21, con las variables de la
instancia local, termina con salida 0.

---

## 13. Comparación contra la base

### 13.1 ESLint

Cada archivo con problemas en el candidato se volvió a analizar en su versión de
la base, con la misma configuración y las mismas dependencias
(`eslint.config.mjs`, `package.json` y `package-lock.json` son idénticos en los dos
commits). El texto de la base se obtiene con `git show` y se analiza con
`ESLint.lintText` usando la misma ruta de archivo. La comparación corrió sobre el
árbol de `c3aaba0`, con este guion guardado fuera del repositorio:

```bash
node "$TEMP/eslint-contra-base.mjs" e31bdf250e06ca9aae1233c2ee737a0443f4df51 "$TEMP/eslint-contra-base.json"
```

Terminó con salida 0 e imprimió
`{"totalCandidato":{"errores":15,"avisos":109},"totalBaseMismosArchivos":{"errores":15,"avisos":109}}`,
con `igual a la base` en los 28 archivos.

<details>
<summary>Guion <code>eslint-contra-base.mjs</code></summary>

```js
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [BASE, SALIDA] = process.argv.slice(2)
const RAIZ = process.cwd()
const require = createRequire(resolve(RAIZ, 'package.json'))
const { ESLint } = require('eslint')

const git = (...args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const eslint = new ESLint({ cwd: RAIZ })

const porRegla = (mensajes) => {
  const cuenta = {}
  for (const m of mensajes) {
    const clave = `${m.severity === 2 ? 'error' : 'aviso'} ${m.ruleId ?? '(sin regla)'}`
    cuenta[clave] = (cuenta[clave] ?? 0) + 1
  }
  return cuenta
}

const candidatos = await eslint.lintFiles(['.'])
const tocadosPorLaRama = new Set(git('diff', '--name-only', BASE, 'HEAD').split('\n').filter(Boolean))
const filas = []
for (const r of candidatos) {
  if (r.errorCount + r.warningCount === 0) continue
  const ruta = r.filePath.slice(RAIZ.length + 1).replaceAll('\\', '/')
  let base = null
  try {
    const texto = git('show', `${BASE}:${ruta}`)
    const [rb] = await eslint.lintText(texto, { filePath: r.filePath })
    base = { errores: rb.errorCount, avisos: rb.warningCount, reglas: porRegla(rb.messages) }
  } catch {
    base = null
  }
  const cand = { errores: r.errorCount, avisos: r.warningCount, reglas: porRegla(r.messages) }
  filas.push({
    ruta,
    tocadoPorLaRama: tocadosPorLaRama.has(ruta),
    candidato: cand,
    base,
    identicoABase: base !== null && JSON.stringify(base.reglas) === JSON.stringify(cand.reglas),
  })
}
filas.sort((a, b) => a.ruta.localeCompare(b.ruta))
const total = (lado) => filas.reduce((s, f) => ({ errores: s.errores + (f[lado]?.errores ?? 0), avisos: s.avisos + (f[lado]?.avisos ?? 0) }), { errores: 0, avisos: 0 })
writeFileSync(SALIDA, JSON.stringify({ base: BASE, totalCandidato: total('candidato'), totalBaseMismosArchivos: total('base'), filas }, null, 2))
for (const f of filas) {
  console.log(`${f.identicoABase ? 'igual a la base' : 'DISTINTO       '} | ${f.tocadoPorLaRama ? 'tocado ' : 'intacto'} | cand ${f.candidato.errores}e/${f.candidato.avisos}a | base ${f.base ? `${f.base.errores}e/${f.base.avisos}a` : 'no existe'} | ${f.ruta}`)
}
console.log(JSON.stringify({ totalCandidato: total('candidato'), totalBaseMismosArchivos: total('base') }))
```

</details>

| Alcance | Comando | Archivos analizados | Resultado en el candidato | Contra la base |
|---|---|---|---|---|
| Ronda | Paso 18 | 35 | 0 errores, 2 avisos; salida 0 | Los 2 avisos existen igual en la base |
| Rama completa | Paso 19 | 61 | 2 errores, 5 avisos; salida 1 | Idénticos por archivo y por regla |
| Global | Paso 20 | Todo el repositorio | 124 problemas: 15 errores y 109 avisos; salida 1 | Idénticos por archivo y por regla |

Los 28 archivos con problemas del análisis global, con su recuento en el
candidato y en la base:

| Archivo | Tocado por la rama | Candidato | Base |
|---|---|---|---|
| `src/app/(public)/inscripcion/page.tsx` | Sí (color del asterisco) | 2 errores, 2 avisos | 2 errores, 2 avisos |
| `src/app/(public)/empleo/page.tsx` | Sí (color del asterisco) | 0 errores, 1 aviso | 0 errores, 1 aviso |
| `src/app/dashboard/layout.tsx` | Sí | 0 errores, 1 aviso | 0 errores, 1 aviso |
| `src/app/dashboard/usuarios/page.tsx` | Sí | 0 errores, 1 aviso | 0 errores, 1 aviso |
| `src/app/dashboard/solicitudes/page.tsx` | No | 3 errores | 3 errores |
| `src/app/(public)/quienes-somos/page.tsx` | No | 2 errores | 2 errores |
| `src/app/dashboard/asistencias/page.tsx` | No | 2 errores | 2 errores |
| `src/app/login/page.tsx` | No | 2 errores | 2 errores |
| `src/app/(public)/noticias/page.tsx` | No | 1 error | 1 error |
| `src/app/dashboard/testimonios/page.tsx` | No | 1 error | 1 error |
| `src/app/global-error.tsx` | No | 1 error | 1 error |
| `src/context/AuthContext.tsx` | No | 1 error, 1 aviso | 1 error, 1 aviso |
| `src/app/(public)/galeria/GaleriaClient.tsx` | No | 2 avisos | 2 avisos |
| `src/app/(public)/TestimoniosClient.tsx`, `bienestar/page.tsx`, `contacto/page.tsx`, `niveles/page.tsx`, `src/app/layout.tsx` | No | 1 aviso cada uno | 1 aviso cada uno |
| Diez archivos de `.agents/skills/impeccable/scripts/` | No | 96 avisos en total | 96 avisos en total |

Los cuatro archivos tocados por la rama que tienen problemas los tienen igual en
la base: `react-hooks/incompatible-library` en `empleo`, `inscripcion` y
`usuarios`; una variable sin usar en `dashboard/layout.tsx` y otra en
`inscripcion`; y dos `no-explicit-any` en `inscripcion`. EPT-9 solo cambió en
ellos lo descrito en la sección 5.

### 13.2 Asesores de Supabase

La base se reconstruyó hasta la migración 007 (paso 02) y el candidato completo
(paso 04), cada uno sobre una base recién creada. Las salidas de los pasos 03 y 05
se guardaron en `$TEMP/asesores-base.json` y `$TEMP/asesores-candidato.json`, y
los hallazgos se compararon por su clave (`cacheKey`) con:

```bash
node -e "const fs=require('fs');const leer=(p)=>{const t=fs.readFileSync(p,'utf8');return JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1)).results};const b=leer(process.env.TEMP+'/asesores-base.json'),c=leer(process.env.TEMP+'/asesores-candidato.json');const kb=new Set(b.map(r=>r.cacheKey)),kc=new Set(c.map(r=>r.cacheKey));const cuenta=(l)=>l.reduce((a,r)=>(a[r.level]=(a[r.level]||0)+1,a),{});console.log('base',b.length,JSON.stringify(cuenta(b)));console.log('candidato',c.length,JSON.stringify(cuenta(c)));for(const r of c)if(!kb.has(r.cacheKey))console.log('nuevo',r.level,r.name,r.detail);for(const r of b)if(!kc.has(r.cacheKey))console.log('desaparecido',r.level,r.name,r.detail)"
```

Salida 0. Resultado:

| | Total | ERROR | WARN | INFO |
|---|---|---|---|---|
| Base (001 a 007) | 32 | 1 | 18 | 13 |
| Candidato (001 a 010) | 35 | 1 | 20 | 14 |

| Diferencia | Nivel | Hallazgo | Evaluación |
|---|---|---|---|
| Nuevo | WARN | `multiple_permissive_policies` en `public.alumnos` | Dos políticas de SELECT: dirección y lectura propia. Rendimiento, no seguridad. Los predicados van envueltos en `(SELECT …)` y ninguna tabla de EPT-9 aparece en `auth_rls_initplan`. Se conservan separadas porque la regla queda legible |
| Nuevo | WARN | `multiple_permissive_policies` en `public.matriculas` | Ídem |
| Nuevo | INFO | `unused_index` en `idx_matriculas_alumno_historial` e `idx_matriculas_curso` | Índices de clave foránea sobre una base recién creada, sin uso todavía |
| Desaparecido | INFO | `unused_index` en `idx_perfiles_rol_id` | Depende de las estadísticas de uso de una base recién creada, no del esquema: ninguna migración de EPT-9 quita ni cambia ese índice |

El único ERROR, `rls_disabled_in_public` en `public.actividades`, está en la base.
La migración 010 no agrega hallazgos. Ningún hallazgo nuevo es de seguridad.

### 13.3 Compilación sin variables

El intento de reproducirla sobre la base usó una extracción de `e31bdf25` hecha
con `git archive` y un enlace a `node_modules`. Turbopack lo rechazó antes de
compilar: `Symlink [project]/node_modules is invalid, it points out of the
filesystem root`. Sin una reproducción real sobre la base, el fallo no se clasifica
como preexistente. Lo único demostrado es que el módulo que lanza el error es
idéntico en los dos commits y que la compilación del paso 21 termina bien.

### 13.4 Pruebas de regresión tocadas por la rama

```bash
git diff --stat e31bdf250e06ca9aae1233c2ee737a0443f4df51 c3aaba0394bbdea59cd848a67f38d30fbab7b0be -- tests/cursos-auth.spec.ts tests/cursos-ui.spec.ts tests/cursos.spec.ts tests/niveles-auth.spec.ts tests/niveles-ui.spec.ts tests/niveles.spec.ts tests/niveles-responsive.spec.ts supabase/tests/cursos_rls.sql supabase/tests/niveles_rls.sql supabase/tests/niveles_concurrencia.mjs
```

Salida: `supabase/tests/cursos_rls.sql | 12`, `supabase/tests/niveles_concurrencia.mjs | 122`
y `supabase/tests/niveles_rls.sql | 10`. Las siete pruebas de Playwright de Cursos
y Niveles no cambiaron. En los dos guiones SQL solo cambiaron los DNI de las
identidades sintéticas: `T9000000n` pasa a `9100000n` y `N9000000n` a `9000000n`,
porque el contrato nuevo exige dígitos. `niveles_concurrencia.mjs` pasó a usar el
arnés compartido `_sesion-psql.mjs`; sus cuatro escenarios conservan nombres y
aserciones. `tests/e2e.spec.ts` sí cambió: se corrigió una aserción que esperaba
el destino de redirección sin codificar, cuando `encodeURIComponent` venía de un
commit muy anterior a EPT-9.

---

## 14. Capturas y privacidad

### 14.1 Inventario y procedencia

Las 61 capturas de [`EPT-9/`](EPT-9/) se generaron en el paso 26, sobre `c3aaba0`,
con `EPT_CAPTURAS=1`. Todas pasan por `tests/_captura.ts`, que **falla** si hay un
diálogo de error de Next abierto y solo después oculta la insignia y el menú de
herramientas del framework.

| Prefijo | Cantidad | Origen | Qué demuestra | Qué no demuestra |
|---|---|---|---|---|
| `fixture-chromium-*` | 19 | Banco visual `/pruebas-ui/alumnos`, escritorio | Presentación de listado, formularios, validación, diálogos, carga, vacío, error, envío, éxito y foco contenido | Persistencia: el banco no toca la base |
| `fixture-pixel-5-chromium-*` | 18 | Banco visual, Pixel 5 | Tarjetas y disposición móvil en Chromium | Persistencia |
| `fixture-iphone-13-webkit-*` | 18 | Banco visual, iPhone 13 | Tarjetas y disposición móvil en WebKit | Persistencia; tipografía de Safari real (14.3) |
| `real-escritorio-*` | 6 | Base local real, con sesión de la directora o del estudiante | Listado y detalle después de operaciones reales, vista propia, acceso restringido, historial ilegible y error de carga de Usuarios | Por sí solas, persistencia: la prueban las aserciones que recargan y leen la base |

Detalle de las `real-*`:

| Captura | Sesión | Estado |
|---|---|---|
| `real-escritorio-listado.png` | Directora | Listado con los estudiantes sembrados y creados por la suite |
| `real-escritorio-detalle-historial.png` | Directora | Detalle con un tramo vigente y «Cuenta de acceso: Sin vincular» |
| `real-escritorio-estudiante-mi-legajo.png` | Estudiante | Vista propia de solo lectura |
| `real-escritorio-estudiante-historial-ilegible.png` | Estudiante | Permiso de lectura del historial retirado de verdad (`REVOKE SELECT ON public.matriculas_historial FROM authenticated`, restituido al terminar): aviso que distingue «no se pudo leer» de «sin trayectoria», con un único enlace para reintentar |
| `real-escritorio-estudiante-restringido.png` | Estudiante | Acceso restringido a `/dashboard/alumnos`, con un único enlace «Volver al panel» |
| `real-escritorio-usuarios-error-de-carga.png` | Directora | Respuesta de `padres_hijos` interceptada con un `PGRST205` de `public.roles` (negativo del clasificador): aviso persistente con reintento |

### 14.2 Inspección visual

Las 61 se inspeccionaron una por una en esta ronda. Frente a la corrida anterior
sobre `3c13a66`, 27 conservaron los bytes y 34 cambiaron píxeles. Las diferencias
se concentran en animaciones: esqueletos de carga, avisos flotantes, indicadores
de envío y el cursor. Las 57 que no tenían bytes ya inspeccionados se revisaron
sobre los archivos definitivos.

| Comprobación | Resultado |
|---|---|
| Herramientas de desarrollo de Next | Ninguna captura muestra la insignia, el menú ni un diálogo de error |
| Secretos, tokens, URL internas o variables de entorno | Ninguno |
| Datos personales reales | Ninguno. Las `real-*` usan identidades sintéticas de la suite (DNI `98…` y `999000…`, nombres como «Zabala, Persistente» o «Ana Directora»). Las `fixture-*` usan los datos inventados del banco, que declara `Los datos son sintéticos y no representan a ninguna persona real` |
| Textos de ejemplo del formulario de Usuarios | «María», «González», `28456123`, `usuario@ejemplo.com`, `0362 4123456`, «Av. Belgrano 1234» y `2027-0001` son marcadores de posición de la interfaz, presentes en la base |
| Idioma | Todo el texto visible está en español |

### 14.3 Limitaciones observadas

- **Avisos flotantes en plena animación.** En `real-escritorio-usuarios-error-de-carga.png`
  y en varias `fixture-*` de error y éxito, el aviso de `sonner` aparece
  semitransparente. En la de Usuarios se ven dos avisos superpuestos: el efecto de
  carga corre dos veces en desarrollo, un patrón que ya existe en la base. El
  mensaje persistente es la evidencia; el aviso flotante no.
- **Diálogos en capturas de página completa.** El fondo del diálogo cubre la ventana
  visible, no el alto completo de la página. En las capturas móviles la parte
  inferior queda sin oscurecer. Es un efecto de la captura de página completa, no
  de la interfaz.
- **Tipografía en WebKit.** En las capturas de iPhone 13 los títulos se ven con un
  grosor menor que en Chromium. Documentan la disposición, no la tipografía que
  mostraría Safari en un dispositivo real.
- **Servidor de desarrollo.** Las capturas salen de `next dev`, no de la
  compilación de producción.
- **Banco con DNI inventados.** Los DNI del banco no pertenecen a los rangos
  reservados de las pruebas con base real (sección 18.1).

---

## 15. Seguridad, secretos e idioma

| Comprobación | Resultado |
|---|---|
| Uso de `service_role` en la aplicación | Solo `src/services/supabase.admin.ts`, usado por `POST /api/usuarios` después de `requerirDirector`, para la API administrativa de Auth y las lecturas de verificación del alta. Nunca en `/api/alumnos` |
| Límite de las peticiones administrativas | 4 s por petición y 15 s por alta |
| Variables en procesos hijos | El arnés de producción y la reconciliación pasan una lista blanca; `SUPABASE_SERVICE_ROLE_KEY` se elimina siempre. Probado con un proceso hijo real (negativas: `OK  secretos: el proceso hijo real no ve ninguno (ausente,ausente)`) |
| Secretos en líneas agregadas por la rama | Dos coincidencias, las dos en `supabase/tests/harness_produccion_negativas.mjs:435` y `:457`: el valor sintético `'secreto-de-prueba-que-no-debe-viajar'` y su restauración `= previo`. No hay claves reales |
| Archivos de entorno versionados | Ninguno |
| Atribución en commits | Sin coincidencias; sin trailers |
| Datos personales en `auth.users` y en el JWT | `ept_alta` se retira antes de guardar la fila (alta atómica 8, 10 y 23) |
| Registros del servidor | Referencia aleatoria, identificador de operación y clasificaciones del alta; si falla la lectura del rol, además el código y el mensaje técnico de PostgREST (`route.ts:152`). Sin DNI, nombres, correos ni contraseñas |
| Registros del navegador | Solo el código de dominio |
| Idioma | Interfaz, mensajes, pruebas, documentación y comentarios de Jira en español profesional |

`anon` conserva `INSERT` y `UPDATE` sobre `perfiles`, heredados de la base, y RLS
los anula. Se registra como observación, no como hallazgo de EPT-9.

---

## 16. Commits

La cadena completa se obtiene con `git log --oneline e31bdf250e06ca9aae1233c2ee737a0443f4df51..HEAD`.
Hasta `c3aaba0` son 29 commits: los 23 de las rondas 1 a 3 y los seis de la
cuarta ronda original, con sus SHA intactos. Después se agregaron `a88aa64` y
`0fcd853` para reconciliar la evidencia, y `72d5fb6` para cerrar los tres
hallazgos finales del instrumental. El commit documental que contiene esta
actualización queda después del candidato endurecido y solo toca este archivo.

Todos los asuntos son convencionales y ningún mensaje lleva `Co-Authored-By` ni
atribución de IA (paso 28 y fila E11 de la sección 8.7). No hubo push, pull
request ni merge.

Orden sugerido para la revisión independiente:

1. `supabase/migrations/010_alta_atomica_de_cuentas.sql` y
   `supabase/tests/usuarios_alta_atomica.sql`.
2. `src/services/cuentas.service.ts` y `src/app/api/usuarios/route.ts`.
3. `supabase/tests/usuarios_reconciliacion.mjs`, en especial los escenarios D, L,
   M, N y O.
4. `src/lib/errores.ts`, `src/lib/vinculos.ts` y `tests/usuarios-auth.spec.ts`.
5. `tests/_contraste.ts`, `tests/alumnos-contraste.spec.ts`, `tests/_captura.ts`,
   `tests/captura.spec.ts`, `tests/_semantica.ts` y `tests/semantica-estatica.spec.ts`.
6. `supabase/tests/_arnes-produccion.mjs` y las 58 negativas del arnés, en
   especial el padre que termina antes que su descendiente.
7. Las migraciones 008 y 009, que no cambiaron en esta ronda.

---

## 17. Reversión

Git deshace archivos, no un esquema aplicado. Revertir un archivo de migración no
quita las tablas, funciones, triggers ni grants que esa migración ya creó donde se
aplicó, ni su fila en `supabase_migrations.schema_migrations`.

### 17.1 Commits de la cuarta ronda, en orden inverso

| Orden | Commit | Qué vuelve si se revierte | Esquema |
|---|---|---|---|
| 1 | `72d5fb6` | Vuelven la deduplicación por padre, el límite de tres líneas, la tolerancia de 0,005, el ocultamiento global del portal y la posibilidad de resolver tras morir el padre sin controlar descendientes | Ninguno |
| 2 | `c3aaba0` | El alta confirmada vuelve a informarse sin verificar el perfil | Ninguno |
| 3 | `3c13a66` | `console.error` en la carga fallida, que en desarrollo abre el diálogo de Next, y la carrera al leer los roles | Ninguno |
| 4 | `d639e87` | `next build` sin límite y el arnés sin negativas de árbol de procesos | Ninguno |
| 5 | `81ff960` | El clasificador por subcadena y los mensajes crudos de PostgREST | Ninguno |
| 6 | `029eb1d` | Los controles `Link → Button` y el medidor de contraste que falla abierto | Ninguno |
| 7 | `02e5ea6` | La ruta que compensa borrando la cuenta tras una lectura vacía: el defecto que la prueba inversa N reproduce | Quita el **archivo** de la 010; el trigger sigue aplicado donde ya se aplicó |

Los reverts se hacen en ese orden porque los commits posteriores tocan los mismos
archivos (`tests/usuarios-auth.spec.ts`, `src/app/dashboard/usuarios/page.tsx`,
`src/services/cuentas.service.ts`). Revertir solo `02e5ea6` es la peor opción:
reintroduce el borrado de cuentas con la escritura en vuelo.

### 17.2 Por migración

| Migración | Cómo deshacerla | Riesgo |
|---|---|---|
| 010 | Primero dejar de desplegar el código que envía `ept_alta`: revertir `c3aaba0` y `02e5ea6` con sus dependientes. Después, una migración nueva `011` con `DROP TRIGGER IF EXISTS registrar_perfil_al_crear_cuenta ON auth.users;` y `DROP FUNCTION IF EXISTS app_private.registrar_perfil_de_alta();` | **Nunca quitar el trigger mientras la ruta nueva siga desplegada**: GoTrue guardaría `ept_alta`, con datos personales, en `raw_app_meta_data`, que viaja en el JWT, y la cuenta quedaría sin perfil. La verificación posterior lo informaría como `ESTADO_INCONSISTENTE`, pero la cuenta ya existiría |
| 009 | Migración nueva que retire `perfiles_dni_valido` y `perfiles_legajo_valido` y restituya las políticas de lectura propia de la 008 | Volverían los defectos de las rondas 1 y 2: espacios Unicode aceptados y lectura propia sin rol vigente |
| 008 | Migración nueva que, en este orden, quite los triggers de `cursos` y `perfiles`, el índice normalizado y las funciones; **exporte `alumnos` y `matriculas`**; y recién entonces elimine vistas, tablas y enumerados | Eliminar `matriculas` destruye el historial académico. Para desactivar la funcionalidad sin perder datos conviene revertir el código y dejar el esquema en pie. La revocación de `DELETE` y `TRUNCATE` sobre `perfiles` no debería revertirse: cerraba un vaciado anónimo de la tabla |

### 17.3 Rondas 1 a 3

Si hay que retroceder la unidad entera, se revierten todos los commits en el
orden inverso al que devuelve `git log --oneline e31bdf250e06ca9aae1233c2ee737a0443f4df51..HEAD`,
y el esquema se deshace con migraciones nuevas, como indica 17.2.

### 17.4 Una migración publicada no se edita

La 009 nació en la primera ronda (`0e11fc5`) y se corrigió en su lugar en la
segunda (`9179c86`). Eso fue admisible solo
porque se demostró que nunca había salido del candidato: no estaba en ninguna
referencia remota, la rama no tenía upstream y no había proyecto de Supabase
vinculado. Hoy sigue sin rama remota (sección 1). En cuanto la rama se publique,
cualquier corrección de 008, 009 o 010 irá en una migración nueva.

---

## 18. Riesgos residuales y trabajo fuera de alcance

### 18.1 Riesgos residuales de esta unidad

| Riesgo | Por qué existe | Mitigación actual |
|---|---|---|
| La atomicidad del alta depende de GoTrue | Se verificó sobre GoTrue v2.196.0 local. En un proyecto alojado, Supabase administra la versión | La verificación posterior informa `ESTADO_INCONSISTENTE` si el perfil no nace; `usuarios_alta_atomica.sql` y `usuarios_reconciliacion.mjs` deben repetirse ante cualquier cambio de versión |
| La migración 010 no se aplicó sobre un proyecto alojado | Esta ronda prohíbe usar Supabase remoto. Supabase permite triggers sobre `auth.users`, pero la aplicación real no se probó | La autoverificación de la 010 hace fallar la migración si el trigger no queda como se espera |
| Un alta sin confirmar requiere revisar el listado | Si la red falla más de 15 s, la ruta no puede afirmar nada | Mensaje que lo explica, referencia técnica y reintento idempotente desde el mismo formulario. Si la página se recarga, la clave se pierde; un segundo intento con los mismos datos se rechaza como duplicado y no crea otra cuenta |
| Lectura de verificación sin respuesta | Después de una confirmación, la ruta informa éxito si no pudo leer | Queda registrado en el servidor con la referencia |
| Rechazos de GoTrue por contraseña, clave administrativa o frecuencia sin prueba dedicada | Provocarlos exige cambiar la configuración de la pila local | La clasificación está en `cuentas.service.ts` y termina en mensajes del catálogo; queda como cobertura pendiente |
| La edición de usuarios desde el panel no persiste | `perfiles` no tiene política `UPDATE` desde la base; la corrección de DNI y legajo de estudiantes vive en `/dashboard/alumnos` | La pantalla informa que no se guardó (`SIN_CAMBIOS`). La administración general de perfiles es de EPT-59 |
| La página `/dashboard/usuarios` para actores no directores no tiene prueba propia | La cubren el guardián del panel, RLS y la API, que sí están probados | Registrado en la sección 7.1 |
| `alumnos-correcciones.spec.ts` corre solo en escritorio | Sus once casos cubren diálogos y foco con Chromium | La retención y devolución del foco también corre en tres perfiles (`alumnos-ui.spec.ts:378`) |
| `GestionAlumnos.tsx` tiene 1033 líneas | Sigue el patrón de `GestionNiveles.tsx` | Candidato natural a dividirse con la próxima operación |
| Límites de espera fijos | 15 s de carga en Usuarios, 20 s en el cliente de Alumnos, 60 s en el alta | Cortan esperas infinitas, pero no distinguen una red lenta de una caída |
| `unstable_retry` en `error.tsx` | Es la API documentada de Next 16.2 y su nombre indica que puede cambiar | Revisar al actualizar Next |
| La tolerancia a la ausencia de `padres_hijos` | Cuando EPT-13 cree la tabla, la tolerancia sobra | Clasificador acotado a esa ausencia exacta; retirarlo con EPT-13 |
| Unicidad de legajo sin distinguir mayúsculas y CHECK de DNI sobre todos los perfiles | Alcanzan también a roles no estudiantes | Sobre datos incompatibles la migración falla de forma explícita; no normaliza |
| La compilación requiere las variables públicas de Supabase | `src/services/supabase.ts` lanza sin ellas | Documentado en 12.4 |
| Los DNI del banco visual son números inventados en rangos plausibles | El banco declara datos sintéticos, pero un número de 7 u 8 dígitos puede coincidir con uno real | No se asocian a ninguna identidad real; las pruebas con base real usan rangos reservados (`96…` a `99…`) |

### 18.2 Registrado y no absorbido

| Riesgo | Dueño |
|---|---|
| `anon` conserva `TRUNCATE` y `DELETE` sobre `actividades`, `asistencias`, `galeria`, `inscripciones`, `menu_escolar`, `noticias`, `opiniones`, `postulaciones` y `solicitudes_inscripcion` | EPT-66 |
| `public.actividades` sin RLS (el único ERROR de los asesores) | EPT-66 |
| `inscripciones` con RLS y sin políticas | EPT-66 |
| Políticas `USING (true)` de escritura en `opiniones`, `postulaciones` y `solicitudes_inscripcion` | EPT-66 |
| Dos funciones de 001 sin `search_path` fijo | EPT-66 |
| `padres_hijos` no existe en las migraciones | EPT-13 |
| Permisos generales de roles, PERSONAL y edición de perfiles | EPT-59 |
| Relación «alumnos a cargo» del DOCENTE | Sin contrato reproducible |

---

## 19. Retrospectiva

**Lo que funcionó.** Modelar el estado separado de la matrícula desde el principio
evitó un rediseño. Escribir la migración completa antes de tocar la aplicación
permitió que el modelo pasara su primer sondeo sin correcciones. Y copiar el
patrón de EPT-55 —esquema privado, funciones que revalidan el rol, envoltorios
públicos— volvió casi mecánica la capa de seguridad.

**Lo que costó tiempo.** El trigger diferido es tan estricto como debe ser, y eso
rompe cualquier limpieza que borre matrículas y legajos en transacciones
separadas: toda manipulación de datos, incluida la de las pruebas, tiene que
ocurrir en una sola transacción.

**Lo que enseñaron las cuatro revisiones.**

- **Una lectura vacía no prueba ausencia.** Compensar sin saber si la escritura
  terminó destruyó cuentas válidas. La salida no fue una reconciliación más
  astuta sino eliminar la segunda confirmación: una sola transacción.
- **Un comentario también es una afirmación.** La 010 prometía una detección que
  el código no hacía. Se encontró al redactar esta evidencia y se cerró con una
  prueba que deshabilita el trigger de verdad.
- **Un instrumento que se calla es peor que uno que falla.** La auditoría de
  contraste omitía lo que no entendía, y su cuenta de alfa aprobaba textos
  ilegibles. Ahora cuenta lo que midió, lo que omitió y por qué.
- **Una prueba de navegador no prueba una propiedad estática.** Los controles
  anidados pasaban todas las pruebas de interacción. Hizo falta una guardia sobre
  el AST.
- **En desarrollo, un `console.error` no es inocuo.** Next lo trata como un
  defecto y abre su diálogo encima de la pantalla. Una falla ya manejada se
  registra como aviso.
- **Una lectura instantánea en una prueba es una carrera.** `allTextContents()`
  pasó cientos de veces y falló en la suite completa.
- **Un proceso que no termina no avisa.** `next build` colgado, un nieto que
  retiene las tuberías o un temporizador sin referencia pueden dejar una prueba
  esperando para siempre. Todo tiene límite, y el cierre baja el árbol completo.
- **Un preexistente se demuestra, no se supone.** El build sin variables quedó sin
  clasificar porque no pudo reproducirse sobre la base.
- **Verificar el entorno antes de medirlo.** `.env.local` apuntaba a un proyecto
  remoto; un servidor viejo escuchaba en el puerto; el build de desarrollo vive en
  `.next/dev`. Cada prueba que levanta un servidor comprueba el puerto y libera al
  terminar.

---

## 20. Próximo paso

1. **Revisión independiente del candidato endurecido `72d5fb6` y del commit documental posterior**,
   con el orden de la sección 16. Conviene empezar por la migración 010, el
   servicio de cuentas y los escenarios D, L, M, N y O.
2. Verificar en especial lo que las revisiones pidieron no dar por bueno sin
   ejecutarlo: que la suite SQL falle de verdad (M2), que la concurrencia use dos
   conexiones reales, que el 404 de producción se mida sobre la aplicación
   compilada y que el medidor de contraste falle cuando no puede medir.
3. Con la revisión aprobada y la autorización correspondiente: push, pull request
   en español y merge, para obtener un commit de integración identificable en
   `main`.
4. Recién entonces las subtareas pueden pasar a Listo, y después EPT-9.
5. La siguiente unidad del plan es WU-04 (EPT-56 a EPT-59). No se inició nada de
   ella.
