# EPT-57 — Candidato de horarios académicos

**Estado:** candidato local para revisión; EPT-57 continúa **En curso**. No se aplicó nada en producción ni se hizo push, PR o merge.

**Última verificación del candidato:** 25/09/2026, después de corregir los hallazgos del comentario Jira 10231. Las pruebas de base, servidor y navegador indicadas se ejecutaron contra la migración y la interfaz corregidas.

## Alcance y decisión aplicada

Se releyó la descripción vigente de [EPT-57](https://grupo12-utn.atlassian.net/browse/EPT-57), actualizada el 24/09/2026. La unidad es `materias_cursos.id`: admite varias franjas semanales. Solo Dirección ve y administra la nueva relación; docentes, estudiantes y familias no reciben lectura nueva. La baja es lógica; cada cambio se registra en una tabla de historial. El catálogo `horarios` de la migración 015 conserva su identidad inmutable, con día ISO, `TIME` local e intervalos semiabiertos `[inicio, fin)`.

La compatibilidad académico–deportiva se comprueba al configurar, reactivar o reasignar una franja académica, al inscribir en un grupo deportivo y al configurar una franja deportiva para alumnos ya inscriptos. También se protege la reactivación de asignaciones académicas y grupos deportivos, y el cambio de matrícula, para que otros caminos no introduzcan un estado incompatible. Las inscripciones deportivas canceladas continúan sin reactivarse, conforme a EPT-12: un nuevo ciclo requiere una nueva inscripción. No se modificaron las reglas deportivas previas.

## Candidato y recorrido de revisión

| Concepto | Evidencia |
|---|---|
| Base verificada | `d3f80c89ab43b06ccd11526b00048e819a36a208` en `HEAD` y `origin/main` antes de editar |
| Rama y worktree | `codex/ept-57-admin-horarios`, `E:\Escritorio\codigo\MetodologiaTPI-ept57` |
| Unidades de implementación | `8891c50` (migración, seguridad y SQL) y `5dcca10` (servidor, API, interfaz y navegador) |
| Correcciones auditadas | `a6a3212` (matrícula/grupo inactivo), `3b8a5aa` (reactivación de grupo y franja inactiva) y `a642e67` (reasignación desde origen inactivo) |
| Migración | `supabase/migrations/20260924225451_ept_57_horarios_academicos.sql` |
| Límite de lectura | RLS de solo lectura para Dirección sobre relación e historial; sin grants de escritura directa |
| Escritura | RPC con `auth.uid()` y rol DIRECTOR; triggers de PostgreSQL aplican las invariantes también ante SQL directo |
| Catálogo 015 | Solo `INSERT ... ON CONFLICT DO NOTHING` y referencia por clave; nunca `UPDATE` de sus filas |
| UI | `/dashboard/horarios-academicos`, visible solo a Dirección, con alta, edición/reasignación, baja, reactivación e historial |
| Fuera de alcance | EPT-58, EPT-59, lectura nueva para otros actores, producción y entrega remota |

La migración es aditiva. El bloqueo consultivo transaccional común serializa cambios de franjas académicas y deportivas; el bloqueo de alumnos ordena cambios académicos frente a altas deportivas. Los rechazos ocurren dentro de la misma transacción, por lo que no dejan inscripciones o franjas parciales.

Una revisión del candidato detectó un falso positivo posible al reabrir matrícula: una inscripción puede seguir `ACTIVA` aunque su grupo deportivo haya sido dado de baja por administración de datos. El control de matrícula era el único cruce que no filtraba `grupos_deportivos.activo`; ahora lo hace, igual que los demás. Se agregó una prueba SQL que conserva la inscripción, da de baja el grupo, crea una franja académica superpuesta y reabre la matrícula sin rechazo. El grupo inactivo no representa actividad deportiva vigente.

Tras esa primera corrección se repitieron desde cero el reset local, el SQL EPT-57 y EPT-12, la paridad y ambas suites de concurrencia, la verificación de tipos, typecheck, lint enfocado, build, advisors y la suite E2E completa: todos conservaron exit 0; entonces E2E terminó con 597 pasadas y 1 omitida. El lint global conservó los mismos 15 errores y 108 advertencias preexistentes.

La revisión independiente del comentario Jira 10231 identificó tres secuencias omitidas. La reactivación de un grupo con inscripción conservada ahora valida el cruce académico bajo el mismo bloqueo transaccional y rechaza `P5595` antes de confirmar; configurar una franja de grupo todavía inactivo no se rechaza por academia, sin relajar el control del grupo activo; y la interfaz puede reasignar una franja histórica desde una asignación inactiva a una asignación de destino activa. La SQL comprueba baja → franja superpuesta → reactivación rechazada sin parcial y ambos estados de grupo; Playwright comprueba la reasignación en sesión real.

Después de esta segunda corrección se repitieron reset, SQL EPT-57/EPT-12, paridad 400/400, concurrencia EPT-12 (9 carreras) y cruzada (2), tipos, TypeScript, lint focalizado, build y advisors: exit 0. Playwright focalizado terminó 18/18 y la suite completa 598 pasadas/1 omitida, exit 0. Los asesores conservan 4 avisos de seguridad y 6 de rendimiento anteriores, fuera de EPT-57. El lint global sigue en exit 1 con los mismos 15 errores y 108 advertencias ajenos al candidato. La primera versión del nuevo test de reasignación falló por esperar que la RPC conservara la franja inactiva; la RPC la reactiva al editar. Se corrigió la expectativa y se repitió la prueba; no fue una regresión del producto.

## Criterios de aceptación

| Criterio | Evidencia local |
|---|---|
| Varias franjas por asignación; día diferente y contigüidad | `supabase/tests/horarios_academicos_rls.sql` |
| Duplicados, día/rango inválidos y solapamiento académico rechazados | Prueba SQL con SQLSTATE `23505`, `P5585`, `P5586`, `P5594` |
| Conflicto académico–deportivo en ambas direcciones, atómico y explicativo | Prueba SQL `P5595`; detalle estructurado con actividad, día y rango; servicio traduce sin exponer SQL. El solapamiento académico `P5594` también devuelve actividad, día y rango. |
| Baja lógica, historial y reactivación | Prueba SQL; prueba autenticada de navegador |
| Grupo inactivo con inscripción conservada: configurar y reactivar sin dejar conflictos | Prueba SQL de grupo inactivo y activo, detalle `P5595`, rechazo atómico de reactivación |
| Reasignación desde origen inactivo hacia destino activo | Playwright autenticado de Dirección, persistencia y movimiento de historial |
| Dirección permitida; otros actores sin consulta ni escritura | RLS/RPC SQL para docente, estudiante, familia, personal, sin perfil y anon; navegador con docente |
| Regresión deportiva EPT-12 | `horarios_rls.sql`, `horarios_paridad.mjs`, `horarios_concurrencia.mjs` |
| Responsive y sesión real | `tests/horarios-academicos-auth.spec.ts`; capturas de escritorio y móvil en esta carpeta |

## Verificación y estado

| Comando o escenario | Resultado |
|---|---|
| `npx --yes supabase db reset --local --yes --no-seed` | Exit 0; migraciones 001–016 y EPT-57 aplicadas |
| `npx --yes supabase migration list --local` | Exit 0; EPT-57 figura local y aplicada |
| `node supabase/tests/tipos-generados.mjs --escribir` y luego sin opción | Exit 0; `database.generated.ts` reconciliado y verificado byte a byte. La redirección directa de la CLI no respeta la normalización de fin de archivo del repositorio. |
| `horarios_academicos_rls.sql` mediante `docker exec … psql -v ON_ERROR_STOP=1` | Exit 0 |
| `horarios_rls.sql` mediante `docker exec … psql -v ON_ERROR_STOP=1` | Exit 0 |
| `node supabase/tests/horarios_paridad.mjs` | Exit 0; 400 pares iguales |
| `node supabase/tests/horarios_concurrencia.mjs` | Exit 0; 9 carreras de EPT-12 |
| `node supabase/tests/horarios_academicos_concurrencia.mjs` | Exit 0; 2 carreras cruzadas en orden inverso, estado final atómico y sin residuos |
| `node supabase/tests/tipos-generados.mjs` | Exit 0; comparación byte a byte de salida normalizada |
| `npx eslint` sobre rutas, servicios, tipos y UI modificados | Exit 0 |
| `npx tsc --noEmit` | Exit 0 |
| `npm run build` con credenciales **locales** del stack Supabase | Exit 0 |
| `npx playwright test tests/horarios-academicos-auth.spec.ts --project=chromium-directora --project=chromium-docente` | Exit 0; 18/18, incluidos setup y reasignación desde origen inactivo |
| `npm run test:e2e` con `EPT_SUPABASE_LOCAL=1` y stack local | Exit 0; 598 pasadas, 1 omitida por la suite existente de teclado en WebKit móvil |
| `npm run lint` global | Exit 1: 15 errores y 108 advertencias en código preexistente; lint enfocado del candidato pasa |
| `npx supabase db advisors --local --type security/performance --fail-on none` | Exit 0; 4 avisos de seguridad y 6 de rendimiento, todos fuera de objetos EPT-57 |
| `git diff --check` | Exit 0; solo advertencias de conversión LF/CRLF de Git en Windows |

La primera ejecución de `npm run build` sin variables Supabase locales falló en el prerender de `/_not-found` por `Missing Supabase env vars`; el mismo build con las variables del stack local pasó. Durante la revalidación final, Docker Desktop se cerró tras un reset exitoso: el primer intento de conexión y pruebas devolvió exit 1 por `ECONNREFUSED`/daemon ausente. Se reinició Docker Desktop y se repitieron todas las pruebas afectadas con exit 0. No se usó ninguna credencial de producción.

Para repetir las pruebas autenticadas y el build en PowerShell, primero obtener exclusivamente el stack descartable: `$s = npx --yes supabase status -o json | ConvertFrom-Json; $env:NEXT_PUBLIC_SUPABASE_URL=$s.API_URL; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY=$s.ANON_KEY; $env:SUPABASE_SERVICE_ROLE_KEY=$s.SERVICE_ROLE_KEY; $env:EPT_SUPABASE_LOCAL='1'`. Para regenerar capturas, sumar `$env:EPT_CAPTURAS='1'` antes de la prueba enfocada. Las pruebas SQL se ejecutaron con `Get-Content supabase/tests/<archivo>.sql -Raw | docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1`; `<archivo>` fue `horarios_academicos_rls` y luego `horarios_rls`. Los códigos de salida de cada ejecución final figuran arriba; los logs crudos locales se mantienen fuera del repositorio.

## Permisos

| Actor | Leer franjas e historial | Configurar por RPC/API | Escritura directa |
|---|---|---|---|
| Dirección autenticada | Sí | Sí | No |
| Docente | No | No | No |
| Estudiante | No | No | No |
| Familia vinculada | No | No | No |
| Sin perfil o anon | No | No | No |

La aplicación conserva los permisos de lectura preexistentes de otras relaciones y del catálogo general. El nuevo vínculo administrativo nunca se proyecta en consultas de docentes, estudiantes ni familias.

## Riesgos, reversión y próxima decisión

No existe carga retroactiva: las asignaciones sin franja permanecen válidas. El catálogo puede acumular ternas no referenciadas si una transacción falla después de `INSERT` solo si esa escritura fue confirmada de forma independiente; la RPC actual es una única transacción y revierte todo al fallar. PostgreSQL y el servidor rechazan conflictos de manera autoritativa; la anticipación de la UI no sustituye esas reglas.

Para revertir **antes de integrar**, retirar el commit del candidato. Si alguna vez se desplegara la migración, no se debe borrar una tabla con historia silenciosamente: la reversión de esquema requiere una migración compensatoria aprobada y preservación/exportación de su historial. EPT-57 solo debe pasar a revisión tras el informe y nunca a Done antes de integración y verificación posterior.

## Capturas

- `real-directora-escritorio.png`: sesión real de Dirección.
- `real-directora-movil.png`: misma sesión en ancho móvil de 390 px; sin desplazamiento horizontal.
