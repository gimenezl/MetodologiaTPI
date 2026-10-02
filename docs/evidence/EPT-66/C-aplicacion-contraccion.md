# EPT-66 — Unidad C: aplicación + contracción de las inscripciones legadas

> **Estado: PR hacia `main`; verificada en el stack local oficial; sin aplicar en producción.**
> La aplicación nueva llama a funciones de la expansión: **no se mergea** hasta que la expansión
> (migración 28) esté aplicada y verificada en producción. La contracción (migración 29) exige
> además la aplicación nueva ya desplegada y una **autorización puntual de Lucas** (ver §7).
> El PR muestra solo esta unidad: las unidades A y B ya están en `main` (#33 y #34); #35 se
> fusionó hacia la rama `codex/ept-66-expansion` y **nunca llegó a `main`**.

## 1. Qué es

Aplicación nueva + segunda migración (**contracción**). Retira lo que la expansión dejó
abierto para no romper a la aplicación anterior durante el despliegue.

| Archivo | SHA-256 |
|---|---|
| `supabase/migrations/20261002130000_ept_66_contraccion_inscripciones_legadas.sql` | `2081a4b4fba48fab181092e9e076a47a71aa99837a2dd0726c71b529e4bcd6bd` |
| `supabase/migrations/20261002120000_ept_66_expansion_inscripciones_legadas.sql` (unidad B, sin cambios) | `cec30f6ab883ba53124904931a38852637690e4a58537e6d60eedaa609d7ca42` |

## 2. Cambios

**Aplicación** (usa solo las funciones de la expansión; ya no lee ni escribe `inscripciones`):

* `src/services/actividades.service.ts`, `src/lib/inscripciones-legadas.ts` (errores en español,
  contrato de filas): alta, baja lógica, lectura de un alumno, inscriptos de una actividad (solo
  Dirección) y cupos agregados.
* `src/app/dashboard/cupos/_components/*`: el alumno y el padre conservan alta, baja y
  reinscripción; Dirección conserva alta, baja y lista de inscriptos; **DOCENTE ya no inscribe,
  no da de baja ni lista inscriptos** (conserva la edición del cupo máximo, que no depende de
  ningún alumno) y ve un aviso.
* Banco `/pruebas-ui/cupos` (solo fuera de producción) para probar las vistas reales por rol.

**Contracción** (`20261002130000`):

1. `inscripciones`: se retiran las 8 políticas anteriores (lectura global `USING (true)`, altas y
   bajas de Staff, Alumno y Padre) y los privilegios de escritura; quedan 3 políticas de lectura
   (alumno propio, padre de hijo **actualmente** vinculado, Dirección) y la restrictiva de bloqueo.
   `service_role` queda solo con SELECT.
2. Sin DELETE físico ni directo: trigger que lo rechaza (P6608) para todos los roles, incluido el
   propietario; el borrado en cascada de un perfil o una actividad (no es un DELETE de aplicación)
   se conserva. `TRUNCATE` también se rechaza.
3. La fila BAJA es **inmutable** (P6609); en una ACTIVO solo cambia el estado a BAJA (la fecha de
   baja se registra sola). Reinscribirse crea una fila nueva.
4. `galeria`, `menu_escolar` y `noticias`: solo `SELECT` para anon y authenticated (los demás
   privilegios, `TRUNCATE` incluido —que la RLS no alcanza—, seguían abiertos desde 001).
5. Privilegios por defecto: tablas, secuencias y funciones nuevas de `public` creadas por el rol de
   las migraciones ya no se otorgan a anon ni authenticated. **No** se retira el EXECUTE implícito de
   PUBLIC en funciones nuevas (no se puede acotar a un esquema y alcanzaría a las extensiones): sigue
   siendo obligatorio el `REVOKE … FROM PUBLIC` explícito. Los privilegios por defecto de
   `supabase_admin` no se pueden cambiar desde una migración.
6. Autoverificación final y precondición: exige la expansión en el ledger si el ledger existe.

## 3. Defectos reproducidos y cerrados

| Defecto | Reproducción | Cierre |
|---|---|---|
| Lectura global de pares alumno–actividad por cualquier sesión autenticada | Política `USING (true)` (011) | 3 políticas acotadas; DOCENTE, PERSONAL, ajenos, bloqueados y anónimo ven 0 filas o reciben 42501 |
| Sobrecupo con altas simultáneas | Línea base: 2 ACTIVO con cupo 1 (ver B) | Bloqueo de fila (B); prueba de concurrencia en ambos estados |
| DELETE físico por Staff, alumno y padre | Políticas «elimina» + privilegio DELETE | Políticas y privilegio retirados + trigger |
| `anon` con `TRUNCATE`/`DELETE` sobre galería, menú y noticias | `relacl` con `arwdxt` | Solo SELECT |

## 4. Pruebas

Entorno: PostgreSQL 16.14 vanilla con emulación mínima de Supabase (ver B §4). **No es el stack
local oficial.** Ledger de la emulación: 27 → 28 (expansión) → 29 (contracción).

| Prueba | Resultado |
|---|---|
| `inscripciones_legadas_contraccion_rls.sql` (nueva) | **64 verificaciones OK, 0 fallos**: políticas exactas, privilegios por rol, lectura por rol (propio, hijo vinculado, hijo ajeno, alumno ajeno, Dirección, DOCENTE, PERSONAL, sin perfil, bloqueados, anónimo), escritura directa cerrada para 7 roles ×4 operaciones, propietario sin DELETE ni reescritura, baja/reinscripción por función, cupos agregados, galería/menú/noticias, INSERT públicos de formularios, privilegios por defecto |
| Las 25 suites SQL existentes + nuevas con expansión + contracción | **PASS las 25** (la suite de la expansión se **omite** de forma explícita) |
| Las mismas suites de esta rama sobre la base con SOLO la expansión (ventana de despliegue) | **PASS las 25** (la suite de la contracción se omite) |
| Concurrencia (14 suites, conexiones `psql` reales) con expansión + contracción | **PASS las 14** (incluida `inscripciones_legadas_concurrencia.mjs`, con el caso 3 convertido en «la BAJA es terminal») |
| Concurrencia con la expansión sola | PASS |
| Migración sobre 3 filas legadas (2 ACTIVO + 1 BAJA), **expansión sola** y **expansión + contracción** | PASS: mismo conteo, misma huella, 3/3 relaciones íntegras tras cada migración |
| Navegador, vistas reales por rol con las peticiones de Supabase interceptadas (`cupos-legadas-ui.spec.ts`) | PASS: el alumno y el padre usan solo `rpc/*` con los identificadores correctos, los 5 rechazos se traducen a español sin filtrar el texto técnico, DOCENTE no ve ni pide el alta/baja/inscriptos, 375×812 y 1280×800 sin desborde |
| Lógica y guardas estáticas (`inscripciones-legadas-lib.spec.ts`) | PASS: ningún módulo llama a `from('inscripciones')` ni borra tablas de inscripciones |
| Mutación | Con el servicio anterior restaurado, 13 de las pruebas nuevas fallan: detectan el defecto |
| C sobre A (árbol local fusionado): `tsc`, `npm run lint`, `npm run build` | exit 0 / exit 0 (0 errores) / exit 0 |
| C sobre A: Playwright `chromium` + `pixel-5-chromium` (sin base) | **884 pasaron, 1 omitida (preexistente, solo móvil), 0 fallos, 0 reintentos**; el árbol de Git quedó sin cambios |

La suite de EPT-59 (`usuarios_permisos_rls.sql`) y las de EPT-11 (`deportes_rls.sql`) e EPT-13
(`inscripcion_hijos_rls.sql`) se ajustaron para aceptar los dos estados (expansión o contracción);
ver sus comentarios.

### 4b. Verificación en el stack local OFICIAL de Supabase (CLI 2.117.0, PostgreSQL 17.6)

Secuencia idéntica a la de producción: `db reset` desde `main` (ledger = 28) y luego
`supabase db push` desde esta rama, con **solo** la 29 pendiente (`--dry-run` previo).

| Prueba | Resultado |
|---|---|
| `supabase migration list` antes/después | 28 aplicadas y 29 pendiente → 29 aplicadas |
| Las 26 suites SQL de esta rama | **26 de 26 PASS** (la de la expansión se omite de forma explícita) |
| Las 14 suites de concurrencia | **14 de 14 PASS** (incluida `inscripciones_legadas_concurrencia.mjs`) |
| Migración sobre las 3 filas legadas (2 ACTIVO + 1 BAJA), expansión sola y expansión + contracción | PASS en ambos: mismo conteo, misma huella y 3/3 relaciones íntegras |
| `tipos-generados.mjs` | OK, byte a byte, determinista |
| `supabase db lint --level warning` | sin errores de esquema |
| `db advisors --type security` | solo 2 avisos preexistentes de INSERT público (formularios; EPT-68) |
| `db advisors --type performance` | 5 avisos de rendimiento no bloqueantes (políticas permisivas múltiples de lectura —entre ellas las 3 de `inscripciones`, por diseño— y un `auth_rls_initplan` preexistente en `perfiles`) |
| `tsc --noEmit`, `npm run lint`, `npm run build` | exit 0 / 0 errores (29 avisos preexistentes) / exit 0 |
| `tests/cupos-legadas-auth.spec.ts` (nueva, **sin interceptar**: navegador → PostgREST → RLS → funciones) | 5 pasaron: el alumno se inscribe, se da de baja y se reinscribe (la baja es lógica y la reinscripción crea una fila nueva); el navegador no escribe nunca la tabla; con el cupo lleno el alumno ajeno queda en «Sin cupo»; Dirección ve los inscriptos; DOCENTE ve el aviso y no inscribe ni lista |
| Playwright autenticado completo (`setup` + `chromium-*`) contra `next start` con el ledger en 29 | **1.ª corrida: 531 pasaron, 22 omitidas, 7 fallos** → 4 causas, ninguna defecto de la base ni de la aplicación (ver nota); tras corregir las pruebas y repetir los archivos afectados (`gestion-estudiantes-auth`, `deportes-auth`, `accesos-qr-auth`, `cupos-legadas-auth`): **todas pasan** (25 + el resto) |
| Playwright base (`chromium` + `pixel-5-chromium`, servidor de desarrollo) | **883 pasaron, 1 omitida (preexistente, solo móvil), 1 *flaky*** (`alumnos-contraste`, pasó en el reintento) |

Nota: `next start` es un build de producción, donde los bancos visuales `/pruebas-ui/*` **no existen
por diseño**; las pruebas que dependen de ellos se ejecutan en los proyectos base (servidor de
desarrollo). La suite autenticada de `main` en el ledger 28 dio 546 pasaron / 8 omitidas / 1 fallo,
y ese único fallo (`alumnos-auth › el banco visual sirve datos sinteticos…`) es exactamente esa
causa: **pasa al ejecutarse contra el servidor de desarrollo**.

Causas de la 1.ª corrida autenticada (7 fallos), todas corregidas **en las pruebas**:

1. `gestion-estudiantes-auth` (3): borraban `inscripciones` con `DELETE` como propietario; desde la
   contracción el trigger P6608 lo impide para todos. La limpieza del stack descartable ahora
   deshabilita los triggers de usuario dentro de la transacción. Además, en Cupos el DOCENTE **ya no
   inscribe ni lista inscriptos** (contrato de esta unidad): la prueba verifica el aviso y que no hay
   formulario ni botones.
2. `deportes-auth › la Data API rechaza escrituras directas…` (1): esperaba `P5582` y `service_role`
   con DELETE; con la contracción toda escritura directa recibe `42501`. Se actualizó al contrato nuevo
   y se agregó que el DOCENTE tampoco inscribe por la función.
3. `accesos-qr-auth` (2): error del arnés de esta corrida, no de la aplicación: el servidor y el
   ejecutor usaban claves QR efímeras distintas (`NO_RECONOCIDO`). Con la misma clave pasan.
4. `alumnos-auth › el banco visual…` (1): el banco no existe en un build de producción (por diseño);
   pasa contra el servidor de desarrollo.

Estas pruebas autenticadas están escritas para el estado FINAL (ledger = 29). Con solo la expansión
aplicada, las suites **SQL** de esta rama aceptan ambos estados; las autenticadas de Playwright no.

### Matriz de roles (SQL, contracción)

| Actor | Lee `inscripciones` | Escribe directo | Alta/baja por función | Cupos agregados |
|---|---|---|---|---|
| Alumno propio | solo lo suyo | 42501 | sí, sobre sí | sí |
| Padre, hijo vinculado | las de sus hijos | 42501 | sí | sí |
| Padre, hijo ajeno | 0 filas | 42501 | P6602 (igual que inexistente) | sí |
| Alumno ajeno | solo lo suyo | 42501 | P6602 sobre otro | sí |
| Dirección | todas | 42501 | sí | sí |
| DOCENTE | 0 filas | 42501 | 42501 | sí |
| PERSONAL | 0 filas | 42501 | 42501 | sí |
| Sin perfil / bloqueado | 0 filas | 42501 | 42501 | 42501 |
| Anónimo | 42501 | 42501 | 42501 | 42501 |

## 5. No probado (límites)

* **Producción** (Supabase `ycvrpmrogvjnntnoosbh` y Vercel): no se consultó ni se modificó nada; la
  sesión de desarrollo no tiene credenciales ni salida de red hacia el proyecto productivo. El ledger
  remoto, el preflight, el respaldo, la aplicación de la 28 y de la 29 y los recorridos autorizados
  **no se ejecutaron**.
* WebKit (perfil `iphone-13-webkit`): no está instalado en el entorno.
* La paleta del PDF (RNF1) queda para revisión humana.

## 6. Decisión de Lucas sobre asistencias (resuelta)

Lucas aprobó la regla del «alumno a cargo»: un DOCENTE está a cargo de un alumno únicamente si el
alumno tiene matrícula vigente en un curso con una materia asignada y activa a ese docente, o una
inscripción activa en un grupo deportivo activo que ese docente dicta; el docente no puede atribuir
un registro a otro docente. Se implementa en una unidad **separada** (D, migración 30), que se
publica **después** de estabilizar esta. Hasta entonces las asistencias siguen abiertas a cualquier
DOCENTE. Ver `docs/evidence/EPT-66.md` §7 y `D-asistencias.md`.

## 7. Plan de despliegue (no ejecutado)

1. Merge de A y de B por Lucas. Aplicar B en producción con su propio gate (ver B §7). Ledger = 28.
2. Merge de **esta** unidad por Lucas **solo después** de (1). Vercel Production despliega la
   aplicación nueva (usa funciones ya presentes).
3. Verificar en Vercel Production: SHA del despliegue = SHA de `main`; recorridos autorizados con las
   cuentas que Lucas indique (alumno propio: alta/baja/reinscripción; padre: hijo vinculado;
   Dirección: lista de inscriptos; DOCENTE: sin alta). **No crear cuentas ni datos funcionales
   productivos sin autorización.** Con la aplicación anterior corriendo, **no** aplicar la contracción.
4. Checkout de despliegue con **solo** la contracción pendiente (`supabase migration list`: 28
   aplicadas, 1 pendiente). Preflight (`supabase/tests/preflight_ept66.sql`) y respaldo. Si producción
   difiere del preflight o el respaldo falla: **detenerse**.
5. **Autorización puntual de Lucas** y recién entonces `supabase db push`.
6. Postflight: ledger = 29; `inscripciones` con los mismos conteos (las 3 filas legadas); DELETE
   directo denegado (42501 para authenticated y P6608 para el propietario); privilegios y políticas
   como en la matriz; recorridos autorizados; galería, menú y noticias públicas siguen leyéndose.

## 8. Reversión

Git no revierte PostgreSQL. Si la contracción debe deshacerse, se escribe una migración nueva que
vuelva a crear las políticas y privilegios retirados (**no recomendado**: reabre la lectura global de
menores y el DELETE físico). Revertir el código de la aplicación sin revertir la base deja a la
aplicación anterior sin poder escribir. Los datos nunca se tocan en esta unidad.

## 9. Riesgos derivados

| Riesgo | Dueño |
|---|---|
| Asistencias de menores abiertas a cualquier DOCENTE hasta aplicar la unidad D | EPT-66 (unidad D) |
| Pruebas por rol y E2E completas contra producción, incluidos los recorridos de esta unidad | EPT-67 |
| Datos ficticios, alta pública de Auth, transporte real, purgas | EPT-68 |
| ~~`database.generated.ts` por delta~~ → regenerado y verificado byte a byte con la CLI oficial | Resuelto |
