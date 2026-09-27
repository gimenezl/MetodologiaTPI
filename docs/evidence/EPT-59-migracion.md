# EPT-59 — frontera de migración

**Base:** `origin/main` en `ccf58b7` (incluye la aplicación compatible de PR #15).
**Contenido:** migración `20260926190000_ept_59_usuarios_permisos.sql`, tipos generados y pruebas de base. El SQL es idéntico al candidato `70020f4`. Esta frontera no incluye API, interfaz, configuración SMTP ni la bandera `EPT_VINCULO_CUENTAS`; no habilita el flujo D5 en la aplicación productiva.

## Preflight productivo (solo lectura)

Antes de aplicar, una persona con autorización de lectura de `auth.users` debe ejecutar:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/preflight_ept59.sql
```

`DATABASE_URL` debe apuntar explícitamente al proyecto productivo correcto; no se guarda aquí. Revisar que el último historial sea `20260926154000`, que las columnas/funciones/tablas requeridas estén presentes, que `postgres_lee_auth_users` y `columnas_auth_presentes` sean `t`, que `ept59_sin_aplicar` sea `t` y que las dos políticas de `perfiles` coincidan con EPT-58 B. Revisar el conteo de Directores efectivos y perfiles huérfanos antes de aprobar la ventana. Cualquier divergencia detiene el despliegue: no editar la migración aplicada ni forzar el historial.

**Preflight productivo ejecutado el 27/09/2026, solo lectura.** El vínculo CLI existente se verificó contra el ref `ycvrpmrogvjnntnoosbh`. Se ejecutaron por separado los seis `SELECT` de `supabase/tests/preflight_ept59.sql` mediante `npx supabase db query --linked` (sin la directiva `psql` y sin `BEGIN`/`COMMIT`, porque la API devuelve únicamente el resultado de la última sentencia). Cada consulta devolvió código 0:

| Dato | Resultado productivo |
|---|---|
| Base, rol y PostgreSQL | `postgres`, `postgres`, `17.6` |
| Últimas versiones del historial | `20260926154000`, `20260925165924`, `20260924225451`, `016` |
| Lectura de `auth.users` por `postgres` y cuatro columnas requeridas | `true`, `true` |
| Tablas y funciones verificadas; EPT-59 ausente | Todos los indicadores `true` |
| Políticas de `perfiles` | `Solo Dirección ve todos los perfiles` (`SELECT`, `PERMISSIVE`); `Solo directores insertan perfiles` (`INSERT`, `PERMISSIVE`) |
| Directores efectivos; perfiles huérfanos; perfiles sin rol | `2`; `0`; `0` |

La evidencia es una fotografía previa, no autorización automática para migrar: repetirla en la ventana de publicación y detenerse si cambia. No se ejecutó `db push` ni ninguna sentencia de escritura.

## Aplicación y comprobación

En una base local *descartable y exclusiva*, partiendo de las migraciones previas:

```sh
npx supabase start
npx supabase db reset --local --version 20260926154000
docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/preflight_ept59.sql
npx supabase migration up --local
docker exec -i supabase_db_educar-para-transformar psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/usuarios_permisos_rls.sql
node supabase/tests/usuarios_permisos_concurrencia.mjs
```

Los comandos con `<` usan una shell compatible con redirección POSIX. El nombre de contenedor mostrado corresponde al `project_id` del repositorio; si se usa un proyecto local aislado, definir `EPT_SUPABASE_DB_CONTAINER` para la prueba de concurrencia y usar ese mismo contenedor en los comandos SQL. **Nunca** usar `db reset --linked` ni ejecutar la prueba SQL sobre producción. La publicación productiva de la migración queda fuera de esta frontera de Git y requiere aprobación, respaldo y ventana propios.

## Compatibilidad, riesgos y reversión

- La aplicación vigente de `ccf58b7` no llama las RPC nuevas de administración ni ofrece D5. Los auxiliares de identidad y políticas restrictivas conservan la lectura pública, pero un perfil bloqueado no debe acceder a datos protegidos aunque retenga un JWT anterior. El trigger D5 está presente en el esquema, pero no hay flujo aplicativo, SMTP ni bandera para usarlo.
- La migración toma bloqueos de esquema y modifica políticas, privilegios, funciones y el trigger de `auth.users`. Una tabla nueva de `public` creada después necesita su propia política de bloqueo. La aplicación antigua debe verificarse contra la base migrada antes de avanzar a la siguiente frontera.
- Ante incidente, primero volver o mantener la aplicación compatible. La compensación propuesta en `docs/evidence/EPT-59/reversion/R-59_compensacion_no_destructiva.sql` es un **borrador, no una migración automática**: revoca la administración nueva y el enlace, cancela reservas pendientes y conserva datos, historial y bloqueo de acceso. Requiere revisión, respaldo y nueva migración aprobada para aplicarse; no reabre acceso a identidades bloqueadas.

## Evidencia local de esta frontera

Verificado en un stack descartable `ept59-migration-isolated` con PostgreSQL 17.6 y Supabase CLI 2.118.0, **no** en la pila local compartida ni en producción:

| Comprobación | Resultado |
|---|---|
| Reset hasta EPT-58 B, preflight y `migration up --local` | Códigos 0; preflight previo con objetos y columnas presentes y las dos políticas esperadas. Base vacía: 0 Directores efectivos; no representa producción. |
| `usuarios_permisos_rls.sql` y `usuarios_permisos_concurrencia.mjs` | Códigos 0; 3417 evaluaciones de matriz y 11 carreras deterministas. |
| Ocho suites SQL de regresión modificadas por esta frontera | Códigos 0 en las ocho. |
| Tipos generados con CLI 2.117.0, esquemas `public,graphql_public` | Coinciden tras normalizar solo finales de línea del checkout Windows; código 0. |
| `npx tsc --noEmit`; `npm run build` con URL/clave pública del stack aislado | Códigos 0. Sin variables locales el build no puede prerenderizar (`Missing Supabase env vars`); no es una falla de tipos ni de compilación. |
| Aplicación vigente (`ccf58b7`) contra la base migrada, Playwright por suite aislada | `usuarios-auth`: 68 aprobadas; `gestion-estudiantes-auth`: 19; `alumnos-auth`: 55. Códigos 0 en las tres. |
| Compensación R-59, con `COMMIT` sustituido solo en la ejecución de prueba por `ROLLBACK` | Código 0; el trigger de enlace siguió presente después. No se ejecutó una reversión real. |

La primera ejecución combinada de Playwright no es evidencia válida de compatibilidad: mezcló la API aislada con consultas SQL al contenedor compartido por omitir `EPT_SUPABASE_DB_CONTAINER`, y sus fixtures se interfirieron entre suites. Se corrigió el entorno, se reinició la base aislada entre suites y se obtuvieron los resultados anteriores. Los registros locales están en `.tmp-ept59-stack/` (ignorados por Git).
