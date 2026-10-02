# EPT-66 — Unidad B: expansión de las inscripciones legadas

> **Estado: lista para revisión; NO aplicada en producción.** La aplicación en producción
> exige el merge de Lucas, un checkout de despliegue con **solo esta migración pendiente**,
> preflight, respaldo y una autorización puntual (ver §7).

## 1. Qué es

Primera de dos migraciones (decisión D1=A). Es **aditiva y compatible hacia atrás**: no retira
ningún permiso, política ni dato. La aplicación anterior sigue funcionando íntegra contra la
base ya expandida; la aplicación nueva (unidad C) usa las funciones que acá se agregan.

| Archivo | SHA-256 |
|---|---|
| `supabase/migrations/20261002120000_ept_66_expansion_inscripciones_legadas.sql` | `cec30f6ab883ba53124904931a38852637690e4a58537e6d60eedaa609d7ca42` |

## 2. Cambios de la migración

1. `inscripciones.fecha_baja` (nullable) + CHECK `fecha_baja IS NULL OR estado = 'BAJA'`.
2. Tratamiento de la fila histórica BAJA: **nunca se recicla**. La restricción
   `UNIQUE(estudiante_id, actividad_id)` se reemplaza por el índice único parcial
   `idx_inscripciones_una_activa … WHERE estado = 'ACTIVO'` (mismo criterio que 013 para
   servicios). La reinscripción **crea una fila nueva**; la BAJA queda intacta como historia.
3. **Cupo serializado en PostgreSQL**: el trigger de cupo toma un bloqueo de fila
   (`FOR NO KEY UPDATE`) sobre la actividad, mediante `app_private.verificar_cupo_bloqueando`
   (SECURITY DEFINER). También valida un cambio de estado a ACTIVO o de actividad.
   La función del trigger sigue en `public` como SECURITY INVOKER (la convención del proyecto
   prohíbe SECURITY DEFINER en `public`; la suite `profesores_rls.sql` CA-18 lo exige).
4. Cinco RPC (patrón 013/016: `app_private` SECURITY DEFINER + envoltorio público SECURITY
   INVOKER): `inscribir_actividad_legada`, `dar_baja_inscripcion_legada`,
   `listar_inscripciones_actividades_legadas`, `listar_inscriptos_actividad_legada`,
   `consultar_cupos_actividades_legadas`. Autorizan al alumno propio, al padre de un hijo
   **actualmente vinculado** y a Dirección. DOCENTE y PERSONAL reciben 42501. Un alumno o hijo
   ajeno recibe el mismo error que uno inexistente (P6602).
5. `calcular_porcentaje_asistencia` y `verificar_cupo_actividad`: `search_path` fijo y
   EXECUTE mínimo (el segundo, sin EXECUTE para ningún rol de la aplicación).
6. Autoverificación final: ningún conteo cambió, índice/restricción, triggers y su orden,
   `search_path`, privilegios y que **no se retiró** ningún permiso de `inscripciones`.

No toca: la lógica deportiva de EPT-11/EPT-61 (`bloquear_inscripcion_deportiva_legada` corre
antes que el trigger de cupo), políticas RLS, GRANT de tablas ni datos.

## 3. Códigos de error nuevos

`P6602` alumno/inscripción no disponible · `P6603` actividad inexistente · `P6604` actividad
inactiva · `P6607` baja repetida. Se reutilizan `P5505` (sin identidad), `P5582` (deporte, EPT-11),
`23505` (duplicado) y `23514` (cupo completo).

## 4. Pruebas

Las suites que limpian datos usan `ALTER TABLE … DISABLE TRIGGER USER` dentro de la transacción (lo
puede hacer el propietario de la tabla) y no `session_replication_role`, que exige superusuario.

Entorno: **PostgreSQL 16.14 vanilla en un contenedor Linux con una emulación mínima de Supabase**
(roles `anon`/`authenticated`/`service_role`/`supabase_auth_admin`, esquema `auth` con
`auth.uid()`, `extensions`, ledger de migraciones). **No es el stack local oficial** (Docker y la
CLI de Supabase no están disponibles en esta sesión; el stack oficial usa PostgreSQL 17). La
cadena de 27 migraciones aplica completa sobre la emulación.

| Prueba | Resultado |
|---|---|
| Cadena de 27 migraciones sobre la emulación | OK |
| 27 migraciones + expansión | OK (28 archivos) |
| `inscripciones_legadas_expansion_rls.sql` (nueva) | **78 OK, 0 fallos** — alta, duplicado, baja lógica, reinscripción como fila nueva, padre/hijo vinculado/hijo ajeno, alumno ajeno, Dirección, DOCENTE, PERSONAL, sin perfil, bloqueados, anónimo, cupo, deporte, lecturas acotadas, cupo en caminos directos, compatibilidad con la app anterior |
| Suites SQL existentes (23) con la expansión aplicada | **PASS las 23**, idénticas a la línea base (incluye `usuarios_permisos_rls.sql`, con los 5 RPC nuevos agregados a su batería, y `profesores_rls.sql`). Con la suite nueva y el preflight, **25/25 PASS** sobre una base recién creada |
| Concurrencia existente (13 suites, dos conexiones reales) | **PASS las 13**, tanto en la línea base como con la expansión |
| `inscripciones_legadas_concurrencia.mjs` (nueva, 2–3 conexiones `psql` reales) | **PASS**: última plaza (alumno vs alumno, orden inverso, padre vs alumno), alta vs reactivación directa en ambos órdenes, mismo alumno dos veces (23505), baja sin confirmar que no libera la plaza, filas BAJA conservadas |
| Defecto reproducido antes del cierre | En la línea base, dos altas simultáneas con cupo 1 dejaron **2** inscripciones ACTIVO |
| `inscripciones_legadas_migracion_sobre_datos.mjs` (nueva) | **PASS**: 3 filas legadas (2 ACTIVO + 1 BAJA) sobreviven con el mismo conteo, la misma huella y 3/3 relaciones íntegras |
| `npx tsc --noEmit --incremental false` | exit 0 |

### Compatibilidad por ventana

| Ventana | Cómo se probó | Resultado |
|---|---|---|
| App anterior + expansión | Sección 11 de la suite nueva: INSERT directo del alumno, baja con UPDATE de Dirección, reinscripción con DELETE + INSERT, duplicado activo (23505), conteo por SELECT | OK a nivel SQL con los roles reales. **No probado contra la aplicación anterior ejecutándose** (no hay PostgREST ni stack local en esta sesión) |
| App nueva prevista + expansión | Las mismas llamadas RPC que hará la aplicación nueva, con cada rol, en la suite nueva | OK a nivel SQL. La aplicación nueva se prueba en la unidad C |

## 5. Tipos generados

`src/types/database.generated.ts` se actualizó con **+40 líneas**: `fecha_baja` en
`inscripciones` y las cinco funciones. El delta se obtuvo diferenciando la salida de
`@supabase/postgres-meta` 0.99.0 sobre la base emulada antes y después de la expansión y
aplicándolo al archivo versionado (la CLI de Supabase necesita Docker). La salida completa de
esa versión **no es idéntica** a la versionada (formato de versiones distintas del generador),
así que **esta actualización no sustituye** la regeneración oficial.

**Pendiente de verificar por quien tenga el stack local:** `node supabase/tests/tipos-generados.mjs`
(con `core.autocrlf` en `true` y en `false`); si difiere, regenerar con `--escribir`.

## 6. Hashes

Ver §1. El SHA del commit publicado figura en el PR; la migración no cambia después de ese commit.

## 7. Plan de despliegue (no ejecutado)

1. Lucas hace el merge del PR de la unidad A y luego el de este PR.
2. Checkout de despliegue desde `main` con **solo** esta migración pendiente
   (`supabase migration list` debe mostrar 27 aplicadas y 1 pendiente). **Prohibido** un
   `db push` desde un checkout que contenga también la migración de contracción.
3. Preflight en producción por agregados con `supabase/tests/preflight_ept66.sql` (solo lectura;
   ledger = 27 hasta 20261001165229; conteos de `inscripciones` por estado, duplicados activos = 0,
   relaciones íntegras, políticas, triggers y privilegios; las tres filas legadas), sin volcar
   identidades.
4. Respaldo verificado (si falla, detenerse).
5. **Autorización puntual de Lucas** y recién entonces `supabase db push`.
6. Postflight: ledger = 28; mismos conteos; índice y columna presentes; EXECUTE de las
   funciones (solo `authenticated`); la aplicación anterior sigue operando.

## 8. Reversión

Git no revierte PostgreSQL. Una vez aplicada, la compensación es **otra migración hacia
adelante**: retirar las cinco funciones (`DROP FUNCTION`), el helper de cupo y, si no existen
dos filas del mismo par, volver a la restricción única. El trigger de cupo serializado es
compatible con la restricción anterior y puede conservarse.
