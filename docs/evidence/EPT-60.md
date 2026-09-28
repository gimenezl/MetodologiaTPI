# EPT-60 — RF5 y RF10: Administrar el transporte y sus cuatro recorridos

Evidencia de la tarea completa **EPT-60**, sin subtareas en Jira al momento de
trabajar.

---

## 0. Revisión del candidato `376d88e` y corrección de tres hallazgos

Una segunda sesión revisó el candidato `376d88e` (commit `docs(evidencia):
agregar reversion no destructiva a EPT-60`, mismo worktree) y encontró tres
problemas concretos, corregidos en esta misma rama antes de pedir PR. Los
tres se reprodujeron primero para confirmar que eran reales y después se
corrigieron con la prueba de regresión correspondiente.

| # | Hallazgo | Corrección | Prueba nueva |
|---|---|---|---|
| 1 | `PATCH /api/transporte/inscripciones/[id]` cancelaba cualquier inscripción propia y activa, incluida una de **comedor**, porque reutiliza la RPC genérica `cancelar_inscripcion_servicio` de 013, que no distingue tipo de servicio | `transporte.service.ts::cancelarInscripcionTransporte` verifica, ANTES de invocar la RPC, que el identificador corresponda a una inscripción propia de tipo TRANSPORTE (lectura sobre la vista `inscripciones_servicios_detalle`, ya `security_invoker`); si no, responde igual que si no existiera, sin tocar la RPC compartida. **013 no se modificó** y la baja legítima de comedor sigue intacta | `transporte-auth.spec.ts`: «la API de transporte no cancela una inscripción propia de comedor» — crea una inscripción real de comedor, intenta cancelarla por la ruta de transporte (404), y confirma que sigue activa y cancelable por su propia ruta |
| 2 | `establecer_recorrido_transporte` comprobaba `activo` del destino ANTES de comprobar si era el recorrido ya vigente del alumno. Si Dirección inactivaba el recorrido que el alumno ya tenía, repetir la misma elección dejaba de ser idempotente y pasaba a rechazarse con P5551 | Se reordenó la función (editada en el mismo archivo de migración, nunca publicada — ver nota más abajo): la comprobación de idempotencia ahora corre antes que la de `activo`. Un destino inactivo **distinto** se sigue rechazando igual que antes | SQL (`transporte_rls.sql` #9bis) y HTTP real (`transporte-auth.spec.ts`: «repetir el recorrido vigente sigue siendo idempotente aunque Dirección lo inactive», que inactiva el recorrido vigente por la propia API de Dirección y confirma el no-op) |
| 3 | En `/dashboard/transporte`, si `listarRecorridos()` fallaba para Dirección, la página convertía el error en `[]` y `GestionTransporte` mostraba un catálogo vacío indistinguible de «no hay recorridos» | `page.tsx` distingue la rama de Dirección: si la lectura del catálogo falla, muestra el mismo `PanelErrorLectura` (alerta en español, con reintento) que ya usa la falta de inscripciones, en vez de degradar a una lista vacía. La pantalla del alumno conserva la degradación intencional (mismo criterio que el comedor) | `transporte-auth.spec.ts`: «un fallo al leer el catálogo muestra un error real, no un catálogo vacío» — revoca de verdad el `SELECT` de `authenticated` sobre `recorridos_transporte` con `docker exec psql` (mismo patrón que `alumnos-auth.spec.ts::conPrivilegioRetirado`), no una respuesta de red simulada, porque esta pantalla lee desde un Server Component y `page.route()` no intercepta esa llamada |

**Confirmación pedida por la revisión:** la migración
`20260927220114_transporte_recorridos.sql` nunca se publicó (sin push, sin
PR, sin merge) en ningún momento de esta tarea; solo se aplicó contra la base
local descartable. Por eso el hallazgo 2 se corrigió editando esa misma
migración en el lugar, en vez de agregar una migración correctiva nueva. No
se tocó ninguna migración de 001 a 016, EPT-57, EPT-58 ni EPT-59.

Los tres cambios de código están en:

```
src/services/transporte.service.ts                          → hallazgo 1
supabase/migrations/20260927220114_transporte_recorridos.sql → hallazgo 2
src/app/dashboard/transporte/page.tsx                        → hallazgo 3
supabase/tests/transporte_rls.sql                            → prueba SQL del hallazgo 2
tests/transporte-auth.spec.ts                                → pruebas HTTP/navegador de los tres
```

Después de corregir, se repitió el ciclo completo de verificación: reset
local, `transporte_rls.sql` (22 comprobaciones, incluida la nueva 9bis),
`transporte_concurrencia.mjs` (3 escenarios), regresión de `comedor_rls.sql`
(24) y de la batería genérica de EPT-59 (`usuarios_permisos_rls.sql`, 01–41,
mismo fallo preexistente 42 aislado y confirmado ajeno), `transporte-auth.
spec.ts` (47, con las 3 pruebas nuevas), `transporte-ui.spec.ts` (47),
`tsc`, ESLint focalizado, `npm run build`, `git diff --check` y la suite E2E
completa del repositorio. El detalle exacto de cada comando está en las
secciones 12 a 16 más abajo, ya actualizadas con estos resultados.

---

## 1. Resumen ejecutivo

El transporte escolar reutiliza exactamente el modelo que dejó EPT-10
(migración 013): los cuatro recorridos son filas nuevas del catálogo
`public.servicios_escolares` con `tipo = 'TRANSPORTE'`, y sus inscripciones
viven en la misma tabla `public.inscripciones_servicios` que ya usa el
comedor. No se creó ninguna tabla de inscripciones paralela.

Un alumno con legajo académico **ACTIVO** puede:

- Consultar los cuatro recorridos ficticios (TR-NORTE, TR-SUR, TR-ESTE,
  TR-OESTE) con sus paradas ordenadas.
- Elegir un recorrido si no tiene ninguno activo, o cambiar de recorrido si ya
  tiene otro, con **una sola operación atómica**: `establecer_recorrido_
  transporte`. Si el destino falla (inexistente o inactivo), el recorrido
  anterior nunca se pierde, porque la cancelación y el alta ocurren dentro de
  la misma función y PostgreSQL revierte todo si algo falla.
- Cambiar «al mismo recorrido que ya tiene activo» es **idempotente**: no crea
  una fila nueva ni cancela nada.
- Cancelar su recorrido sin reemplazo, con la misma RPC genérica que ya usaba
  el comedor.
- Tener el comedor y el transporte activos **a la vez**, sin ninguna
  interferencia entre servicios.

**Como máximo un recorrido de transporte activo por alumno**, incluso ante dos
solicitudes concurrentes, lo garantiza un trigger que bloquea la fila del
alumno en modo exclusivo (`FOR NO KEY UPDATE`) antes de contar los recorridos
activos — el mismo patrón que ya usaba el límite de dos deportes de EPT-11 —,
no una comprobación previa de la aplicación. Está demostrado con dos
conexiones PostgreSQL reales, no con dos promesas del mismo proceso.

**Dirección** consulta los cuatro recorridos, sus alumnos inscriptos, y
mantiene el nombre y el estado activo/inactivo de cada uno. El código y el
tipo de un recorrido con inscripciones son inmutables (regla ya existente de
013, reutilizada tal cual). Dirección no adquiere ninguna facultad de
inscribir o cambiar el recorrido en nombre de un alumno.

DOCENTE, PADRE, PERSONAL, las cuentas sin perfil, las sesiones anónimas y las
cuentas **bloqueadas** (EPT-59) no leen ni escriben ningún objeto de
transporte.

No existe ninguna superficie de eliminación física en ninguna capa.

**Estado: listo para revisión**, sobre el candidato que corrigió los tres
hallazgos de una revisión anterior (§0). Sin push, sin PR, sin merge, sin
`db push` y sin ninguna operación contra producción. La suite E2E completa
del repositorio (781 pruebas autenticadas, todas las historias) corre sin
ningún fallo después de este cambio (§14, §16).

---

## 2. Línea base y worktree

| Concepto | Valor |
|---|---|
| `origin/main` verificado | `6d054a81249b90841d0eb7cffa67dff7f5f444c5` |
| Descripción del tip remoto | `Merge pull request #17 from gimenezl/codex/ept-59-aplicacion` |
| Rama creada | `codex/ept-60-transporte` |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept60` |
| Migración anterior integrada | `supabase/migrations/20260926190000_ept_59_usuarios_permisos.sql` |
| Migración nueva | `supabase/migrations/20260927220114_transporte_recorridos.sql` |

```text
git fetch origin --prune                     → exit 0
git rev-parse origin/main                    → 6d054a81249b90841d0eb7cffa67dff7f5f444c5
git rev-parse main                           → 7b0facb299397c954482ef97b525fd8af6fb1680 (126 commits atrás)
git worktree add -b codex/ept-60-transporte  → worktree limpio, sin colisión con otro
git status --short (worktree nuevo)          → árbol limpio tras `git worktree add`
supabase migration new transporte_recorridos → 20260927220114_transporte_recorridos.sql
git diff --check                             → exit 0 (sin errores de espacio en blanco)
```

El checkout principal `E:\Escritorio\codigo\MetodologiaTPI` no se tocó: no se
hizo `stash`, no se resetió y no se copió ningún archivo no versionado
(`AGENTS.md`, `.agents/`, `.atl/`, `.claude/`, `docs/`) al worktree nuevo.
`node_modules` se instaló de nuevo con `npm ci` dentro del worktree, sin
junction, según la gotcha documentada de EPT-9/EPT-55.

No había otro worktree para EPT-60. La sesión de auditoría de EPT-61 no fue
tocada: no se editó ningún archivo de deportes, grupos ni sus reglas.

---

## 3. Alcance y fuera de alcance

### Dentro del alcance

- Siembra reproducible de los cuatro recorridos y sus doce paradas ficticias
  en el catálogo existente de servicios escolares.
- Extensión de la invariante de inscripción para que como máximo un recorrido
  de transporte esté activo por alumno, ante concurrencia real.
- RPC atómica de alta/cambio de recorrido (`establecer_recorrido_transporte`)
  que nunca deja al alumno sin su recorrido anterior si el destino falla.
- Semántica idempotente explícita para «cambiar al mismo recorrido».
- RPC de mantenimiento descriptivo para Dirección (`actualizar_recorrido`):
  nombre y estado activo/inactivo, nunca código ni tipo.
- Servicios de servidor, rutas API, validación de entrada y traducción de
  errores sin filtrar detalle técnico.
- Pantalla del alumno (elegir, cambiar, cancelar, historial) y pantalla de
  Dirección (consulta + mantenimiento descriptivo), responsivas a 1280 y
  375 px.
- Entrada de navegación «Transporte» para DIRECTOR y ESTUDIANTE.
- Pruebas de base (RLS, autoverificación, concurrencia real), de servidor y
  navegador (autenticadas y con banco de fixtures), y regresión sobre EPT-10,
  EPT-11 y EPT-59.
- Documentación y evidencia.

### Fuera del alcance, deliberadamente

Nada de lo siguiente se implementó, ni se preparó a medias: direcciones,
coordenadas, horarios, vehículos, choferes, tarifas, cupos ni capacidad de
los recorridos — los cuatro recorridos y sus paradas son **datos de
referencia ficticios**, documentados como tales en el propio SQL de la
migración. Tampoco se creó una facultad para que Dirección edite el orden o
el texto de las paradas (son parte de la semilla fija, de solo lectura para
la aplicación), ni una RPC para crear o eliminar recorridos: los cuatro son
fijos por decisión expresa del usuario.

---

## 4. Estado de Jira

Consultado en vivo el 2026-09-27 contra `grupo12-utn.atlassian.net`
(`cloudId c552e7b2-7720-4af4-9c2d-9fc020e12ecb`), antes de empezar y de nuevo
al cerrar esta evidencia.

| Clave | Tipo | Resumen | Estado | Responsable | Etiquetas |
|---|---|---|---|---|---|
| EPT-60 | Tarea | RF5 y RF10 – Administrar el transporte y sus cuatro recorridos | Por hacer | Lucas Gimenez | RF10, RF5, complementario, servicios |

Sin subtareas (`parent = EPT-60` no devuelve resultados). No se cambió el
estado, la descripción, el responsable ni la estimación de EPT-60, ni de
ninguna otra incidencia. La sección 22 deja preparado el comentario y la
recomendación de transición para que se revisen antes de aplicarlos.

---

## 5. Decisiones funcionales

### D1 — Reutilizar 013 en lugar de un modelo paralelo

`servicios_escolares` e `inscripciones_servicios` ya estaban preparadas para
esto: el propio comentario de 013 dice que incorporar los cuatro recorridos
es «agregar filas al catálogo, no crear tablas», y el tipo
`tipo_servicio_escolar` ya incluye `'TRANSPORTE'`. Por eso EPT-60 solo agrega
filas y una tabla de extensión (`paradas_recorrido`), y reutiliza tal cual la
vista `inscripciones_servicios_detalle`, las políticas RLS y las RPC
genéricas `inscribir_en_servicio` / `cancelar_inscripcion_servicio`.

### D2 — Por qué hace falta una RPC nueva y no alcanza con las genéricas

El índice único parcial de 013 impide repetir el **mismo** servicio activo,
pero no impide tener dos recorridos **distintos** activos a la vez, porque
cada recorrido es una fila distinta del catálogo. Postgres tampoco admite una
subconsulta como predicado de un índice parcial. La regla se garantiza
entonces con un trigger (mismo patrón que el límite de dos deportes de 014).

Además, comedor y deportes cambian de inscripción con **dos llamadas RPC
separadas** (cancelar + inscribir), que no garantizan nada si la segunda
falla. `establecer_recorrido_transporte` hace las dos operaciones dentro de
la misma función: si el `INSERT` falla, PostgreSQL revierte toda la función
(no hay `COMMIT` parcial posible dentro de una función), así que la
inscripción anterior nunca queda cancelada sin una nueva activa. La misma RPC
sirve para el alta (no hay nada que cancelar) y para el cambio, y es
idempotente si el recorrido pedido ya es el activo.

### D3 — Bloqueo exclusivo del alumno, no solo del servicio

Para que el conteo de «recorridos de transporte activos» sea exacto ante dos
altas simultáneas del mismo alumno, el trigger `validar_inscripcion_
servicio()` (013, reemplazada por `CREATE OR REPLACE` desde esta migración,
nunca editando el archivo 013) pasa su bloqueo de `alumnos` de `FOR SHARE` a
`FOR NO KEY UPDATE`. Para comedor esto es una serialización más fuerte pero
no cambia ningún resultado observable, porque no existe ninguna regla cruzada
entre servicios de comedor: la suite `comedor_rls.sql`, ejecutada íntegra
después del cambio, lo confirma (§13).

### D4 — Paradas como tabla de extensión, de solo lectura

Las paradas son un atributo propio del transporte, no del comedor: se
modelan en `public.paradas_recorrido` (migración aditiva normalizada, como
pide el encargo), con `UNIQUE (servicio_id, orden)` y un trigger que impide
que cuelguen de un servicio que no sea `TRANSPORTE`. Se siembran una sola vez
en esta migración y no existe ninguna RPC que las escriba: son parte del dato
de referencia fijo, no una superficie editable.

### D5 — Mantenimiento descriptivo acotado a nombre y estado

Dirección mantiene únicamente `nombre` y `activo` de un recorrido
(`actualizar_recorrido`). El código y el tipo siguen protegidos por el
trigger `proteger_identidad_servicio` de 013 en cuanto el recorrido tiene
alguna inscripción, reutilizado sin cambios.

### D6 — Política RESTRICTIVE de bloqueo agregada a mano

La migración de EPT-59 advierte expresamente que una tabla nueva de `public`
no hereda su política RESTRICTIVE de bloqueo de cuenta en forma automática.
Como esta migración crea `paradas_recorrido`, le agrega esa política a mano,
con el mismo predicado y el mismo nombre de política que usa EPT-59. La
suite genérica de EPT-59 (`usuarios_permisos_rls.sql`, extendida con las dos
RPC nuevas en su batería) confirma que una cuenta bloqueada no lee ni escribe
ningún objeto de transporte, incluida `paradas_recorrido` (§13).

---

## 6. Modelo de datos

Sin tablas nuevas de inscripción. Extensión mínima sobre 013:

```
public.servicios_escolares            (013, reutilizada)
  + 4 filas nuevas: TR-NORTE, TR-SUR, TR-ESTE, TR-OESTE (tipo = 'TRANSPORTE')

public.paradas_recorrido              (nueva, EPT-60)
  id, servicio_id → servicios_escolares(id) ON DELETE RESTRICT,
  orden SMALLINT (1..20), nombre VARCHAR(100), fecha_creacion
  UNIQUE (servicio_id, orden)
  + 12 filas sembradas (3 por recorrido)

public.recorridos_transporte          (vista nueva, security_invoker)
  servicios_escolares (tipo=TRANSPORTE) + paradas agregadas en JSON ordenado

public.inscripciones_servicios        (013, reutilizada sin cambios de esquema)
```

### Recorridos ficticios sembrados

| Código | Nombre | Paradas (orden) |
|---|---|---|
| TR-NORTE | Recorrido Norte (ficticio) | Escuela → Plaza del Norte → Los Álamos |
| TR-SUR | Recorrido Sur (ficticio) | Escuela → Parque del Sur → El Molino |
| TR-ESTE | Recorrido Este (ficticio) | Escuela → Centro Este → La Ribera |
| TR-OESTE | Recorrido Oeste (ficticio) | Escuela → Polideportivo Oeste → Los Aromos |

Nombres y paradas son ficticios para el proyecto: no representan un servicio
de transporte real, y así lo documenta expresamente el encabezado de la
migración.

### Invariantes y su garantía

| Invariante | Garantía |
|---|---|
| Los cuatro códigos de recorrido existen y son estables | semilla con id y código fijos, verificada por autoverificación |
| Una parada pertenece a un servicio de tipo TRANSPORTE | trigger `BEFORE INSERT` + `FOR SHARE` |
| Paradas de un recorrido con orden único | índice único `(servicio_id, orden)` |
| Un solo recorrido de transporte `ACTIVA` por alumno | trigger + `alumnos FOR NO KEY UPDATE` |
| Cambio de recorrido atómico, sin perder el anterior | una sola función, sin `COMMIT` parcial |
| Cambio al mismo recorrido es idempotente | la función detecta el caso y devuelve la fila existente sin tocar nada |
| Solo ESTUDIANTE se inscribe o cambia de recorrido | RPC + rol derivado en la base |
| El alumno de la operación es el de la sesión | RPC deriva de `auth.uid()` |
| Solo DIRECTOR edita nombre/activo de un recorrido | RPC + `es_director()` |
| Código y tipo de un recorrido con inscripciones, inmutables | trigger de 013, reutilizado |
| Comedor no puede tener paradas | trigger `BEFORE INSERT` |
| Sin borrado físico de recorridos, paradas ni inscripciones | sin `GRANT`, política ni RPC de eliminación |
| Bloqueo de cuenta (EPT-59) también cubre `paradas_recorrido` | política RESTRICTIVE agregada a mano en esta migración |

---

## 7. Migración

`supabase/migrations/20260927220114_transporte_recorridos.sql` (856 líneas),
creada con `supabase migration new transporte_recorridos` (nunca a mano).

Secciones: (1) precondiciones y conteos de preservación, (2) siembra de los
cuatro recorridos, (3) tabla y siembra de paradas + trigger de tipo, (4)
extensión de `validar_inscripcion_servicio()` (bloqueo exclusivo + regla de
un solo recorrido activo), (5) vista `recorridos_transporte`, (6) privilegios
y RLS de `paradas_recorrido` (incluida la política RESTRICTIVE manual), (7)
RPC privilegiadas (`establecer_recorrido_transporte`,
`actualizar_recorrido`), (8) envoltorios públicos, (9) autoverificación.

Bloque de SQLSTATE propio: **P596x**, sin colisión con 006–014 (P550x–P558x)
ni con EPT-57/58/59 (P590x–P594x, más P5520/P5521 reutilizados).

| Código | Significado |
|---|---|
| P5960 | la operación es exclusiva de recorridos de transporte / falta un campo obligatorio del mantenimiento |
| P5961 | ya existe un recorrido de transporte activo distinto (defensa en profundidad; el flujo normal nunca lo alcanza porque la RPC atómica cancela antes de insertar) |

No se editó ningún archivo de migración existente. `CREATE OR REPLACE
FUNCTION app_private.validar_inscripcion_servicio()` en la sección 4
reemplaza hacia adelante la función que crea 013, sin tocar ese archivo.

---

## 8. Matriz de privilegios y RLS

| Objeto | `anon` | `authenticated` | Notas |
|---|---|---|---|
| `servicios_escolares` (filas TRANSPORTE) | sin acceso | `SELECT` (013, reutilizado) | catálogo institucional, sin datos personales |
| `paradas_recorrido` | sin acceso | `SELECT` | + política RESTRICTIVE de bloqueo agregada a mano |
| `recorridos_transporte` (vista) | sin acceso | `SELECT` | `security_invoker`, agrega el catálogo con paradas |
| `inscripciones_servicios` (filas TRANSPORTE) | sin acceso | `SELECT` propio (estudiante) / total (director) | política de 013, reutilizada sin cambios |
| `app_private.establecer_recorrido_transporte(uuid)` | sin acceso | `EXECUTE` | `SECURITY DEFINER`, `search_path=''`, exige rol ESTUDIANTE |
| `app_private.actualizar_recorrido(uuid,text,boolean)` | sin acceso | `EXECUTE` | `SECURITY DEFINER`, `search_path=''`, exige `es_director()` |
| `public.establecer_recorrido_transporte` / `public.actualizar_recorrido` | sin acceso | `EXECUTE` | `SECURITY INVOKER`, envoltorios mínimos |

Ninguna política `INSERT`, `UPDATE` ni `DELETE` permisiva en `paradas_
recorrido`: se siembra en la migración y no hay ninguna RPC que la escriba.

---

## 9. Matriz actor / acción / dato

| Actor | Ver los 4 recorridos | Elegir / cambiar propio | Cancelar propio | Ver inscriptos (todos) | Editar nombre/activo |
|---|---|---|---|---|---|
| ESTUDIANTE (propio) | Sí | Sí | Sí | No | No |
| ESTUDIANTE (ajeno) | Sí (catálogo) | No | No | No | No |
| DIRECTOR | Sí | No | No | Sí | Sí |
| DOCENTE / PADRE / PERSONAL / sin perfil | No (redirige a Acceso restringido) | No (403) | No (403) | No | No |
| Bloqueado (EPT-59) | No | No (403 / sin filas) | No | No | No |
| `anon` | No | No | No | No | No |

No se amplió por analogía a PADRE, DOCENTE ni PERSONAL: ninguno de los tres
tiene entrada de navegación ni facultad en el servidor ni en la base.

---

## 10. Matriz de criterios de aceptación

| Criterio | Migración | Servidor | UI | Prueba | Evidencia |
|---|---|---|---|---|---|
| Cuatro recorridos disponibles, con códigos estables | §2 semilla | `listarRecorridos` | `MiTransporte`, `GestionTransporte` | `transporte_rls.sql` #1 | §12, §13, §18 |
| Alumno elige un recorrido si no tiene ninguno | RPC `establecer_recorrido_transporte` | `establecerRecorridoTransporte` | `MiTransporte` (botón «Elegir») | `transporte_rls.sql` #2, `transporte-auth.spec.ts` | §12, §13, §18 |
| Alumno cambia de recorrido si ya tiene otro | misma RPC | idem | `MiTransporte` (botón «Cambiar») | `transporte_rls.sql` #4, `transporte_concurrencia.mjs` #1 | §12, §13, §18 |
| Cambio atómico, sin perder el anterior si falla el destino | trigger + función única | idem | — | `transporte_rls.sql` #6, #6bis | §12, §13 |
| Cambio al mismo recorrido, idempotente | función detecta el caso | idem | — | `transporte_rls.sql` #3, `transporte_concurrencia.mjs` #2, `transporte-auth.spec.ts` | §12, §13 |
| Máximo un recorrido activo, también concurrente | trigger + `FOR NO KEY UPDATE` | — | — | `transporte_rls.sql` #5, #10, `transporte_concurrencia.mjs` #1 | §12 |
| Convivencia con comedor | reutiliza 013 sin cambios de esquema | — | — | `transporte_rls.sql` #8, `transporte-auth.spec.ts` | §12, §13 |
| Dirección consulta alumnos inscriptos por recorrido | vista reutilizada | `listarInscripcionesTransporte` | `GestionTransporte` | `transporte_rls.sql` #14 | §12, §13, §18 |
| Dirección mantiene la información descriptiva | RPC `actualizar_recorrido` | `actualizarRecorrido` | `GestionTransporte` (diálogo Editar) | `transporte_rls.sql` #15, `transporte-auth.spec.ts` | §12, §13, §18 |
| Solo el alumno titular y Dirección acceden a lo suyo | RLS + trigger | `requerirRol` / `requerirDirector` | navegación oculta | `transporte_rls.sql` #11, #13, `usuarios_permisos_rls.sql` | §12, §13 |
| Sin ampliación por analogía a PADRE/DOCENTE/PERSONAL | — | `requerirRol('ESTUDIANTE', …)` | sin entrada de nav | `transporte-auth.spec.ts` (bucle de actores) | §13 |
| Bloqueo de cuenta (EPT-59) también rige transporte | política RESTRICTIVE agregada a mano | `consultarEstadoAcceso` (reutilizado) | redirige a `/acceso-bloqueado` | `transporte_rls.sql` #19, `usuarios_permisos_rls.sql` (batería extendida) | §12, §13, §18 |
| Sin borrado físico | sin `GRANT`/política/RPC de eliminación | — | sin controles de eliminación | `transporte_rls.sql` #18 | §12 |
| Responsive 1280/375 sin scroll horizontal | — | — | clases Tailwind, sin overflow | `transporte-auth.spec.ts`, `transporte-ui.spec.ts` | §14, §18 |

---

## 11. Reproducción local

```bash
docker info                                   # Docker Desktop debe estar corriendo
cd MetodologiaTPI-ept60
npm ci
npx supabase start
npx supabase db reset                         # aplica 001…014, EPT-57/58/59 y esta migración
```

---

## 12. Pruebas de base de datos

Todas corridas contra la base local descartable, después de `supabase db
reset`, con `docker exec … psql -v ON_ERROR_STOP=1 -f …`.

```text
supabase/tests/transporte_rls.sql        → 22 comprobaciones OK (más 6bis, 9bis, 15bis, 15ter), ROLLBACK, sin dejar datos
supabase/tests/comedor_rls.sql           → 24 comprobaciones OK (regresión de EPT-10, ver §16 por el único ajuste)
supabase/tests/deportes_rls.sql          → A1…G3 OK (regresión de EPT-11, sin ningún cambio de código)
supabase/tests/usuarios_permisos_rls.sql → 01…41 OK, con las dos RPC de transporte agregadas a su batería (06, 07, 11, 13)
```

La comprobación **9bis** (agregada al corregir el hallazgo 2 de la revisión,
§0) verifica que repetir el recorrido vigente sigue siendo un no-op después
de que Dirección lo inactiva, y que un destino inactivo distinto (6bis) se
sigue rechazando.

`npx supabase db advisors --local` (todas las categorías): las únicas
observaciones son preexistentes (`calcular_porcentaje_asistencia`,
`verificar_cupo_actividad`, políticas `USING (true)` de `postulaciones` /
`solicitudes_inscripcion`, y de rendimiento sobre `perfiles` /
`asistencias` / `inscripciones` / `inscripciones_servicios`). Ninguna
observación nueva sobre `paradas_recorrido`, `recorridos_transporte`,
`servicios_escolares` ni las RPC de transporte.

`npx supabase gen types typescript --local` regenerado limpio (sin las
líneas de conexión de la CLI mezcladas por error en un primer intento,
corregido separando stdout de stderr).

---

## 13. Prueba de concurrencia real

`supabase/tests/transporte_concurrencia.mjs`: dos procesos `psql`
independientes (no dos promesas del mismo proceso), coordinados con
`pg_blocking_pids` (sin esperas por tiempo).

```text
OK CONCURRENCIA 1: dos cambios simultáneos a recorridos distintos dejan exactamente uno activo
                    (el de quien confirma después) y conservan los ciclos anteriores
OK CONCURRENCIA 2: dos altas simultáneas al mismo recorrido no duplican la fila;
                    la segunda es idempotente también bajo carrera
OK CONCURRENCIA 3: un alumno INACTIVO no establece un recorrido bajo concurrencia
                    y no deja ninguna fila
OK CONCURRENCIA: las tres carreras del transporte quedan demostradas y la base queda limpia
```

---

## 14. Pruebas de servidor y navegador

```text
npx tsc --noEmit                          → exit 0
npx eslint .                              → 14 errores / 107 avisos, todos preexistentes (§16); 0 en archivos de transporte
npm run build                             → build de producción correcto; /pruebas-ui/transporte NO aparece en la lista de rutas
node supabase/tests/correr-autenticadas.mjs transporte-auth.spec.ts → 47 aprobadas (incluye el setup de 21 identidades)
npx playwright test transporte-ui.spec.ts → 47 aprobadas, 1 omitida (WebKit táctil sin teclado físico)
git diff --check                          → exit 0
node supabase/tests/correr-autenticadas.mjs (SIN filtro, TODAS las historias) → 781 aprobadas, 2 omitidas, 17.7 min, exit 0
npx playwright test (SIN filtro, sin sesión: base + bancos visuales de las 9 historias) → 452 aprobadas, 2 omitidas, exit 0 (sin cambios respecto del candidato anterior: ninguno de los tres hallazgos toca el banco visual)
```

La corrida sin filtro subió de 778 a **781 aprobadas** (las tres pruebas
nuevas de §0), sigue en **2 omitidas** (WebKit sin teclado) y **exit code 0**:
ningún fallo, ni en transporte ni en el resto del repositorio. Entre las dos
corridas sin filtro, **1233 pruebas de Playwright pasan y ninguna falla**
sobre el candidato final.

Al correr la suite completa se regeneraron por segunda vez, por el mismo
efecto colateral ya documentado en §16, cuatro capturas de
`docs/evidence/EPT-13/`; se revirtieron con `git restore` antes de comitear,
igual que la vez anterior.

`transporte-auth.spec.ts` pasó de 44 a **47** pruebas: las tres nuevas
corresponden a los hallazgos de la revisión (§0). Corre contra sesiones
reales (`tests/auth.setup.ts`) y cubre: alta, idempotencia del cambio al
mismo recorrido (incluida la idempotencia después de que Dirección inactiva
el recorrido vigente), cambio atómico real, fallo del destino sin pérdida,
cancelación sin reemplazo, frontera de dominio con el comedor (no se cancela
por acá una inscripción de comedor), convivencia con el comedor, alumno
ajeno, alumno inactivo, cuerpo sin campos de identidad, ausencia de
`DELETE`, foco/Escape del diálogo, 375 px sin scroll horizontal, consulta y
mantenimiento de Dirección, el error real cuando falla la lectura del
catálogo (privilegio revocado de verdad, no una respuesta de red simulada),
y denegación de DOCENTE, PADRE, PERSONAL y una cuenta sin perfil.

`transporte-ui.spec.ts` corre sobre `/pruebas-ui/transporte` (banco de datos
sintéticos, sin base) en escritorio, Pixel 5 e iPhone 13, y cubre estados de
presentación: sin recorrido, con recorrido, recorrido inactivo, historial,
vacío, error, alumno inactivo, carga, teclado completo e idioma español.

---

## 15. Verificación manual en el navegador (evidencia real)

Con el stack local levantado y `npm run dev` con las credenciales locales
inyectadas por proceso (nunca escritas a `.env.local`), se recorrió a mano:

1. **ESTUDIANTE** (`estudiante.prueba@ept.local`): eligió TR-NORTE (mensaje
   «Te inscribiste al recorrido TR-NORTE.»), cambió a TR-OESTE (mensaje
   «Cambiaste tu recorrido a TR-OESTE.», el anterior quedó cancelado en el
   historial), y canceló sin reemplazo con el diálogo de confirmación.
2. **DIRECTOR** (`directora.prueba@ept.local`): vio los cuatro recorridos con
   su ocupación, editó el nombre de TR-ESTE y lo puso inactivo (persistió y
   se reflejó de inmediato como «No disponible» en la pantalla del alumno),
   y lo revirtió a su estado original.
3. **DOCENTE**: `/dashboard/transporte` devolvió «Acceso restringido» y la
   entrada «Transporte» no apareció en la navegación.
4. **ESTUDIANTE BLOQUEADO** (EPT-59): un inicio de sesión nuevo con esa
   cuenta redirigió directamente a `/acceso-bloqueado`, antes de llegar al
   panel.
5. Responsive a 375 px: sin desplazamiento horizontal, menú móvil con la
   entrada «Transporte» y su ícono.

---

## 16. Fallos preexistentes y regresiones

| Hallazgo | Preexistente o regresión | Evidencia |
|---|---|---|
| `usuarios_permisos_rls.sql` (original, sin editar) falla en «FALLO 42 user_metadata» | **Preexistente**, ajeno a EPT-60 | Reproducido corriendo el archivo tal cual de `origin/main` contra una base con migraciones solo hasta EPT-59 (sin la migración de EPT-60 aplicada): mismo fallo, idéntico mensaje |
| `comedor_rls.sql`, aserción «el catálogo sembró más de un servicio» | Ajuste necesario, no una corrección de comportamiento | 013 asumía que el comedor era el único servicio del catálogo; EPT-60 agrega recorridos al mismo catálogo por diseño (así lo documenta 013). Se corrigió la aserción para verificar «un único servicio de tipo COMEDOR» en lugar de «un único servicio en total»; el resto de las 24 comprobaciones de EPT-10 pasa sin cambios |
| ESLint: 14 errores / 107 avisos en `asistencias/page.tsx`, `solicitudes/page.tsx`, `testimonios/page.tsx`, `GestionUsuarios.tsx`, `global-error.tsx`, `layout.tsx`, `login/page.tsx` | **Preexistentes**, ninguno en archivos de transporte | `npx eslint .` antes y después del cambio; ningún resultado contiene la palabra «transporte» |
| La corrida sin filtro de `correr-autenticadas.mjs` regeneró capturas de `docs/evidence/EPT-13/` (7 la primera vez, 4 la segunda, tras corregir los hallazgos de §0) | **Preexistente**, no un efecto de EPT-60: `tests/hijos-auth.spec.ts` llama a `page.screenshot(...)` sin comprobar `EPT_CAPTURAS`, a diferencia del resto de las suites (`comedor-auth.spec.ts`, `transporte-auth.spec.ts`, etc.), que sí lo hacen. Escribe esas rutas en cualquier corrida completa, la toque o no EPT-60 | Confirmado leyendo `tests/hijos-auth.spec.ts`: la función de captura de ese archivo no tiene la guarda `if (!CAPTURAR) return` que sí tienen las demás. Detectado ambas veces con `git status` antes de comitear (byte a byte distintas, no solo metadata) y revertido con `git restore -- docs/evidence/EPT-13/` antes de cada commit de evidencia |

Ningún punto queda bloqueado: los dos que estaban pendientes al cerrar la
redacción de esta sección se completaron antes de la entrega (ver §14 y §18).

---

## 17. Archivos modificados y creados

### Nuevos

```
supabase/migrations/20260927220114_transporte_recorridos.sql
supabase/tests/transporte_rls.sql
supabase/tests/transporte_concurrencia.mjs
src/services/transporte.service.ts
src/services/transporte.client.ts
src/app/api/transporte/inscripciones/route.ts
src/app/api/transporte/inscripciones/[id]/route.ts
src/app/api/transporte/recorridos/[id]/route.ts
src/app/dashboard/transporte/page.tsx
src/app/dashboard/transporte/loading.tsx
src/app/dashboard/transporte/error.tsx
src/app/dashboard/transporte/_components/MiTransporte.tsx
src/app/dashboard/transporte/_components/GestionTransporte.tsx
src/app/pruebas-ui/transporte/page.banco.tsx
tests/transporte-auth.spec.ts
tests/transporte-ui.spec.ts
docs/evidence/EPT-60.md (este archivo)
```

Cinco de estos archivos recibieron una segunda pasada de cambios al corregir
los tres hallazgos de la revisión (§0):
`supabase/migrations/20260927220114_transporte_recorridos.sql`,
`src/services/transporte.service.ts`, `src/app/dashboard/transporte/page.tsx`,
`supabase/tests/transporte_rls.sql` y `tests/transporte-auth.spec.ts`. Siguen
listados acá como «nuevos» porque no existían antes de esta tarea; el detalle
de qué cambió en la segunda pasada está en §0.

### Modificados

```
src/lib/validations.ts                    → esquemas de transporte (EPT-60), al final del archivo
src/types/database.types.ts               → paradas_recorrido, recorridos_transporte, dos funciones nuevas
src/types/database.generated.ts           → regenerado desde la base local
src/app/dashboard/_components/PanelDashboard.tsx → entrada de navegación «Transporte»
playwright.config.ts                      → «transporte» agregado a los dos regex de dominio
supabase/tests/comedor_rls.sql            → un ajuste de aserción (§16), resto sin cambios
supabase/tests/usuarios_permisos_rls.sql  → dos RPC de transporte agregadas a la batería genérica
```

### Compartidos, para que EPT-61 integre sobre esta base

- `src/lib/validations.ts` (sección nueva al final, no toca las existentes).
- `src/app/dashboard/_components/PanelDashboard.tsx` (una línea de `navItems`).
- `playwright.config.ts` (dos regex ampliados con la palabra «transporte»).
- `supabase/tests/usuarios_permisos_rls.sql` (una variable y dos líneas de
  registro de RPC en la batería; no se tocó ninguna lógica de deportes).
- `supabase/tests/comedor_rls.sql` (una aserción corregida; no se tocó
  ninguna lógica de comedor).

No se tocó ningún archivo de deportes, grupos ni sus reglas.

---

## 18. Capturas

Generadas con `EPT_CAPTURAS=1` sobre `transporte-ui.spec.ts` (banco de datos
sintéticos, determinista, en `docs/evidence/EPT-60/`, prefijo `fixture-`):
sin recorrido, recorrido inactivo, con recorrido activo, historial, estado
vacío, confirmación de cancelación, error, alumno inactivo, carga, gestión
de Dirección, gestión filtrada, gestión vacía y edición de un recorrido —
cada una en versión escritorio y móvil (24 archivos en total).

Las capturas `real-*` (sesión y base verdaderas, vía
`transporte-auth.spec.ts`) no se generaron como archivo en esta sesión: la
verificación con datos reales se hizo a mano en el navegador embebido del
entorno de trabajo (§15), que no vuelca capturas a disco por defecto.
Corriendo `EPT_CAPTURAS=1 node supabase/tests/correr-autenticadas.mjs
transporte-auth.spec.ts` contra la base local se generarían del mismo modo
que las de EPT-10, si se necesitan como archivo.

Además, la verificación manual del §15 se hizo con el navegador embebido del
entorno de trabajo; sus capturas no se guardan como archivo por defecto.

---

## 19. Privacidad y seguridad

- Ninguna credencial ni clave se escribió en el repositorio, en `.env.local`
  ni en este documento. Las credenciales locales se inyectaron por proceso
  (`supabase status -o env`), siguiendo la convención ya documentada del
  proyecto.
- Los mensajes de error del servidor no exponen SQLSTATE, nombres de tabla,
  consultas ni ningún detalle interno; `transporte-auth.spec.ts` lo verifica
  contra una lista de fragmentos prohibidos en cada respuesta de error.
- La autorización se aplica en PostgreSQL (RLS + funciones `SECURITY
  DEFINER`) y en el servidor (`requerirRol` / `requerirDirector`), nunca
  solo ocultando controles en la interfaz.
- Ninguna RPC de transporte recibe alumno, perfil, usuario, rol ni legajo
  como parámetro (verificado por la autoverificación de la migración y por
  `transporte_rls.sql`).

---

## 20. Ausencia de eliminación física

Ninguna tabla, vista ni función de este cambio admite `DELETE` para ningún
rol de aplicación. `paradas_recorrido` se siembra una sola vez en la
migración; no existe ninguna RPC que la escriba, y `transporte_rls.sql` #18
verifica que ningún rol conserva `DELETE` ni `TRUNCATE`, y que no existe
ninguna función cuyo nombre sugiera una eliminación de recorridos, paradas ni
inscripciones.

---

## 20bis. Reversión no destructiva

La migración es puramente aditiva (filas nuevas, una tabla nueva, funciones
nuevas): no modifica ninguna fila ni ningún privilegio preexistente, así que
no existe un escenario de «deshacer datos». Si hiciera falta retirar el
transporte de la aplicación sin revertir la migración ni perder historial:

```sql
-- Deja de admitir altas nuevas sin borrar nada ni afectar inscripciones
-- vigentes (mismo mecanismo que ya usa el catálogo para el comedor).
UPDATE public.servicios_escolares
SET activo = FALSE
WHERE tipo = 'TRANSPORTE';
```

Los alumnos con un recorrido activo lo conservan (la RPC de cancelación
sigue funcionando); solo se cierra la puerta a nuevas altas y cambios. Para
retirar la entrada de navegación sin tocar la base alcanza con revertir el
commit `feat(transporte): pantallas de alumno y Dirección`. No se creó
ningún script de compensación en `docs/evidence/EPT-60/reversion/` porque no
hay ninguna operación destructiva ni sobre datos preexistentes que
compensar.

---

## 21. Riesgos y trabajo habilitado

- El límite de un solo recorrido activo descansa en el bloqueo exclusivo de
  la fila del alumno. Cualquier operación futura que necesite modificar
  `alumnos` o `inscripciones_servicios` para el mismo alumno debe respetar
  el mismo orden de bloqueos (`alumnos → servicios_escolares →
  inscripciones_servicios`) para no introducir un interbloqueo.
- Si una historia futura necesita editar el texto o el orden de las paradas,
  hace falta una RPC nueva con las mismas garantías de rol y de
  inmutabilidad de identidad que ya tiene `actualizar_recorrido`; no
  reutilizar un `UPDATE` directo.
- El bloque SQLSTATE reservado para transporte es P596x; una historia futura
  de este dominio debería continuar desde P5962 en adelante.

---

## 22. Retrospectiva y comentario preparado para Jira

**Retrospectiva breve:** reutilizar el modelo de EPT-10 redujo el trabajo a
una migración de extensión y dos RPC nuevas, pero exigió releer con cuidado
013 y 014 para no romper ninguna de sus garantías: el hallazgo más costoso
fue notar que el índice único parcial de 013 no alcanza para «un solo
recorrido activo entre varios servicios», lo que llevó a extender el trigger
existente en lugar de escribir uno nuevo. La política RESTRICTIVE de bloqueo
de EPT-59 sobre una tabla creada después de esa migración fue el segundo
punto que costó tiempo: el aviso está en el propio SQL de EPT-59, pero es
fácil de pasar por alto si no se lo busca expresamente.

Una segunda sesión de revisión (§0) encontró tres problemas reales que la
primera pasada no cubrió: una RPC genérica compartida que no distinguía
dominio (comedor/transporte) en la baja, un orden de comprobaciones que
rompía la idempotencia ante un cambio de estado posterior de Dirección, y un
error de lectura degradado a estado vacío en la pantalla administrativa. Los
tres comparten un patrón — reutilizar una pieza genérica o degradar un error
sin distinguirlo de un estado legítimo — que vale la pena revisar
expresamente la próxima vez que se reutilice una RPC o un `!ok → []`.

**Comentario preparado para Jira (no publicado; a revisar antes de
enviarlo):**

> Migración, RLS, RPC atómica de alta/cambio, mantenimiento descriptivo de
> Dirección, UI de alumno y Dirección, y pruebas de base/servidor/navegador
> completas para los cuatro recorridos de transporte (ficticios, según lo
> acordado). Una revisión de código encontró tres problemas (frontera de
> dominio en la cancelación, orden de la idempotencia, y un error de lectura
> mostrado como catálogo vacío), corregidos con su prueba de regresión cada
> uno. Regresión verificada sobre EPT-10, EPT-11 y EPT-59, y sobre el resto
> del repositorio: la suite E2E autenticada completa (781 pruebas, todas las
> historias) pasa sin ningún fallo después de este cambio. Candidato en la
> rama `codex/ept-60-transporte`, sin push, sin PR.

**Recomendación de transición:** el candidato está listo para revisión de
código; no se movió el estado en Jira desde esta sesión. Queda a criterio de
quien revise pasar EPT-60 de **Por hacer** a **En progreso** o directamente a
la columna de revisión del tablero.
