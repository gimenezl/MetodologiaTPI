# EPT-66 — Unidad C: aplicación + contracción de las inscripciones legadas

> **Estado: preparada, NO publicada para merge.** Esta unidad **no se mergea** hasta que la
> expansión (unidad B) esté aplicada y verificada en producción. Con la expansión sin
> aplicar, la aplicación nueva llama a funciones que no existen. La contracción exige además
> la aplicación nueva ya desplegada y una autorización puntual de Lucas (ver §7).

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

* **Aplicación contra PostgREST y Supabase reales**: no hay stack local oficial, Docker ni acceso a
  producción en esta sesión. Las pruebas de navegador usan las vistas reales con las peticiones
  interceptadas; no prueban la base (eso lo hacen las suites SQL).
* **Suites autenticadas de Playwright** (`*-auth.spec.ts`) y el perfil WebKit (iPhone 13): no
  ejecutadas.
* `supabase db reset`, `db lint`, asesores de seguridad y rendimiento, `tipos-generados.mjs`: no
  ejecutados (ver B §5).
* **Producción**: nada se consultó ni se modificó.

## 6. Decisión pendiente de Lucas (bloquea solo esa parte)

DOCENTE hoy lee y escribe asistencias de cualquier menor, y antes de esta unidad también
inscribía a cualquier alumno. No existe un contrato que defina «alumno a cargo» (EPT-9 §18.2).
Hasta que se decida: DOCENTE no inscribe ni lee inscripciones (queda cerrado, no abierto), y las
asistencias **siguen abiertas**. Ver `docs/evidence/EPT-66.md` §7.

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
| Asistencias de menores abiertas a cualquier DOCENTE; definición de «alumno a cargo» | Lucas (decisión) → EPT-66 |
| Pruebas por rol y E2E completas contra producción, incluidos los recorridos de esta unidad | EPT-67 |
| Datos ficticios, alta pública de Auth, transporte real, purgas | EPT-68 |
| `database.generated.ts` actualizado por delta y no regenerado con la CLI oficial | Quien tenga el stack local |
