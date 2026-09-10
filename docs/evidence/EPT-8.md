# EPT-8 — Administrar cursos: evidencia de la historia

La administración de cursos queda implementada de punta a punta sobre la rama
`codex/ept-8-admin-courses`, partiendo del commit `801c967` de `origin/main`.
Incluye una migración aditiva con unicidad normalizada y RLS, un límite HTTP que
autoriza al DIRECTOR antes de tocar la base, y la pantalla responsive
`/dashboard/cursos`.

**Estado: listo para revisión, no terminado.** No hay ninguna base de datos
disponible en este entorno (sin Docker, sin PostgreSQL local y sin un proyecto
Supabase de descarte), así que la migración nunca se aplicó y las reglas de la
base están escritas y verificables pero **no ejecutadas**. La sección
[Pruebas pendientes](#pruebas-pendientes) dice exactamente qué falta y cómo
completarlo.

## Ruta rápida para quien revisa

1. Leer `supabase/migrations/003_cursos.sql`: ahí están todas las reglas de negocio.
2. Leer `src/services/autorizacion.ts` y `src/app/api/cursos/route.ts`: ahí está la
   autorización del servidor.
3. Ejecutar los tres controles que sí corren sin base de datos:

   ```bash
   npx tsc --noEmit --incremental false
   npm run build
   npx playwright test tests/cursos.spec.ts
   ```

4. Con una base local descartable, ejecutar la prueba que falta:

   ```bash
   supabase db reset
   psql "$(supabase status -o json | jq -r .DB_URL)" -v ON_ERROR_STOP=1 \
        -f supabase/tests/cursos_rls.sql
   ```

## Criterios de aceptación y su evidencia

Los cinco criterios son los de EPT-8 en Jira, consultados en vivo el 2026-09-09.

| # | Criterio | Dónde se implementa | Evidencia | Estado |
|---|---|---|---|---|
| 1 | Se crea un curso con denominación, división y nivel existentes. | `003_cursos.sql` (tabla `cursos`), `POST /api/cursos`, formulario de alta | `cursos_rls.sql` §2.1; captura `escritorio-02-formulario` | Código listo; falta ejecutar la base |
| 2 | Se consulta y modifica un curso sin perder relaciones. | `listarCursos`, `actualizarCurso`, `PATCH /api/cursos/[id]` | `cursos_rls.sql` §2.2; capturas `escritorio-01-listado`, `escritorio-04-edicion` | Código listo; falta ejecutar la base |
| 3 | Se inactiva un curso con historial en lugar de eliminarlo físicamente. | Columna `activo`; sin GRANT ni política DELETE; sin endpoint DELETE | `cursos_rls.sql` §5 y §6; `tests/cursos.spec.ts` (405 en DELETE) — **ejecutado, pasa** | Parcial: el 405 está probado; la conservación de filas no |
| 4 | No se admite la misma denominación y división dentro de un mismo nivel. | `idx_cursos_nivel_denominacion_division` sobre `UPPER(BTRIM(...))` | `cursos_rls.sql` §3 (4 variantes de mayúsculas + espacios) | Código listo; falta ejecutar la base |
| 5 | Un usuario no autorizado no puede usar la administración de cursos. | Navegación por rol, `requerirDirector()`, políticas RLS | `tests/cursos.spec.ts` (401 y redirección) — **ejecutado, pasa**; `cursos_rls.sql` §8-§10 | Parcial: las capas de interfaz y servidor están probadas; la de base no |

## Decisiones tomadas

| Tema | Decisión | Por qué |
|---|---|---|
| Nombre de la migración | `003_cursos.sql` | El repositorio no es un proyecto de CLI de Supabase: no existe `supabase/config.toml` y la convención establecida por `001` y `002` es `NNN_nombre.sql`. Se consultó `supabase migration new --help` (CLI 2.117.0 vía `npx`), que genera nombres con marca de tiempo; se descartó ese formato por no ser el del repositorio. |
| Alcance de la unicidad | Se aplica a cursos activos **e inactivos** | El criterio 4 no admite excepciones y el plan aprobado tampoco. Además evita que un registro histórico quede ambiguo. Si más adelante el producto quiere reutilizar el nombre de un curso dado de baja, la alternativa es un índice parcial `WHERE activo`; es un cambio de regla de negocio, no un detalle técnico. |
| Forma de normalizar | `UPPER(BTRIM(...))` en el índice, con un CHECK que obliga a guardar valores ya recortados | Determinista y verificable. El valor se guarda tal como lo escribió el director (solo recortado), así que la pantalla conserva su forma de nombrar los cursos. `src/lib/validations.ts` replica la misma expresión. |
| Autorización en RLS | Función `app_private.es_director()` con `SECURITY DEFINER`, expuesta por `public.es_director_actual()` con `SECURITY INVOKER` | La política `"Directores y docentes ven todos los perfiles"` de `001` consulta `perfiles` dentro de una política sobre `perfiles`, lo que produce recursión (SQLSTATE 42P17). Copiar ese patrón habría roto la funcionalidad. La lógica privilegiada queda en un esquema que la Data API no expone, y la aplicación solo ve un punto de entrada sin parámetros que devuelve el rol del propio usuario. |
| Identificador del curso | `UUID` | Coincide con `perfiles` e `inscripciones`, y evita exponer identificadores enumerables en las URL de la API. |
| Índices | Solo el índice único | Es también el índice de la clave foránea, porque `nivel_id` es su primera columna. El volumen es de decenas de filas y no hay otra ruta de consulta demostrada, así que no se agregaron índices especulativos. |
| Tipos de base de datos | Editados a mano | `src/types/database.types.ts` no es un archivo generado: no tiene `Relationships`, `Enums` ni `CompositeTypes`, no hay ningún script que lo regenere, y ya contiene `padres_hijos`, que no existe en ninguna migración. Se extendió siguiendo su forma actual. |

## Cambios por archivo

### Base de datos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/003_cursos.sql` | **Nuevo.** Esquema `app_private`; `app_private.es_director()`; `public.es_director_actual()`; unicidad normalizada y RLS de solo lectura sobre `niveles`; tabla `cursos` con FK `ON DELETE RESTRICT`, CHECKs de recorte y `activo`; índice único normalizado; RLS y privilegios mínimos. |
| `supabase/tests/cursos_rls.sql` | **Nuevo.** Verificación ejecutable de las reglas anteriores. Corre dentro de una transacción que termina en `ROLLBACK`. |
| `src/types/database.types.ts` | Se agregan `cursos`, la función `es_director_actual` y `export type Curso`. |

### Servidor

| Archivo | Cambio |
|---|---|
| `src/services/autorizacion.ts` | **Nuevo.** `requerirDirector()`: sesión con `auth.getUser()` y rol con `es_director_actual()`. Falla cerrado. |
| `src/services/cursos.service.ts` | **Nuevo.** Capa de acceso a datos de solo servidor. Traduce 23505, 23503, 23514 y 42501 a respuestas de dominio estables. |
| `src/app/api/cursos/route.ts` | **Nuevo.** `POST`. Sin `DELETE` ni `GET`. |
| `src/app/api/cursos/[id]/route.ts` | **Nuevo.** `PATCH` para modificar e inactivar. Sin `DELETE`. |
| `src/lib/validations.ts` | Se agregan `crearCursoSchema`, `actualizarCursoSchema`, `cursoIdSchema` y `normalizarTextoCurso`. |

### Interfaz

| Archivo | Cambio |
|---|---|
| `src/app/dashboard/cursos/page.tsx` | **Nuevo.** Componente de servidor: autoriza y lee. Un fallo de lectura se muestra como error, nunca como lista vacía. |
| `src/app/dashboard/cursos/_components/GestionCursos.tsx` | **Nuevo.** Listado, alta, edición y baja/alta lógica, con sus estados. |
| `src/app/dashboard/cursos/loading.tsx` | **Nuevo.** Esqueleto de carga. |
| `src/app/dashboard/cursos/error.tsx` | **Nuevo.** Límite de error de la sección. |
| `src/services/cursos.client.ts` | **Nuevo.** Cliente del navegador contra `/api/cursos`. No expone ninguna operación de borrado. |
| `src/app/dashboard/layout.tsx` | Se agrega el ítem `Cursos` con `roles: ['DIRECTOR']`. Esto también activa el bloqueo de ruta de `rutaPermitida()`. |

### Otros

| Archivo | Cambio |
|---|---|
| `tests/cursos.spec.ts` | **Nuevo.** Cobertura de los caminos de denegación y de la superficie de métodos HTTP. |
| `.gitignore` | Se ignoran `test-results/` y `playwright-report/`, que genera la suite al ejecutarse. |

## Matriz de autorización

Las tres capas se aplican por separado. Aprobar una no compensa la ausencia de otra.

| Actor | Ve el ítem del menú | `/dashboard/cursos` | `POST` / `PATCH` en `/api/cursos` | Lectura en la base | Escritura en la base | Borrado físico |
|---|---|---|---|---|---|---|
| Anónimo | No | Redirige a `/login` | 401 | Denegada (sin GRANT) | Denegada | Denegado |
| ESTUDIANTE | No | «Acceso restringido» | 403 | Permitida | Denegada (RLS) | Denegado (sin privilegio) |
| DOCENTE | No | «Acceso restringido» | 403 | Permitida | Denegada (RLS) | Denegado (sin privilegio) |
| PADRE | No | «Acceso restringido» | 403 | Permitida | Denegada (RLS) | Denegado (sin privilegio) |
| PERSONAL | No | «Acceso restringido» | 403 | Permitida | Denegada (RLS) | Denegado (sin privilegio) |
| DIRECTOR | Sí | Administración completa | 201 / 200 | Permitida | Permitida (RLS) | Denegado (sin privilegio) |

Notas:

- La lectura del catálogo se concede a cualquier usuario autenticado, igual que ya
  ocurre con `niveles` y `actividades`. `anon` queda excluido por falta de GRANT y
  por ausencia de política.
- El borrado físico está denegado **para todos**, incluido el director: no hay
  GRANT de DELETE, no hay política DELETE y no hay endpoint DELETE.
- `src/proxy.ts` no cubre `/api/**` y solo refresca la sesión. No es un límite de
  autorización y no se modificó.

## Comandos ejecutados y resultados exactos

Todo desde `E:/Escritorio/codigo/MetodologiaTPI-ept8`, sobre la rama
`codex/ept-8-admin-courses`.

| Comando | Salida | Código |
|---|---|---|
| `git rev-parse origin/main` | `801c96768fec70849123128c3c57288edee6aa2f` | 0 |
| `git merge-base --is-ancestor 801c967 origin/main` | sin salida | **0** |
| `npx tsc --noEmit --incremental false` | sin salida | **0** |
| `npx eslint --no-cache` sobre los archivos de la historia | 0 errores, 1 advertencia preexistente en `dashboard/layout.tsx:127` (`perfil` sin usar) | **0** |
| `npm run lint -- --no-cache` (repositorio completo) | `125 problems (16 errors, 109 warnings)` | 1 |
| `npm run build` | `✓ Compiled successfully`. `/api/cursos`, `/api/cursos/[id]` y `/dashboard/cursos` figuran como `ƒ` (servidor, bajo demanda) | **0** |
| `npx playwright test tests/cursos.spec.ts` | **7 passed** | **0** |
| `npm run test:e2e` (suite completa) | 10 passed, 1 failed | 1 |
| `npx supabase@latest --version` | `2.117.0` | 0 |
| `supabase db reset` | **No ejecutado.** Docker no está instalado | — |
| `supabase gen types` | **No ejecutado.** Requiere `--local`, `--linked`, `--db-url` o `--project-id`; ninguno disponible | — |
| `supabase db advisors` / `get_advisors` | **No ejecutado.** No hay proyecto de este repositorio accesible | — |

### Sobre las dos salidas con código 1

Ninguna de las dos la introduce esta historia:

- **`npm run lint`**: `REGISTRO_MODIFICACIONES.md:35` ya documenta «16 errores y 109
  advertencias preexistentes fuera del alcance». El total obtenido es exactamente
  ese, y el lint acotado a los archivos de la historia da 0 errores.
- **`npm run test:e2e`**: falla `tests/e2e.spec.ts:8` («dashboard redirects to
  login when unauthenticated»), que espera `redirect=/dashboard` mientras la
  aplicación produce `redirect=%2Fdashboard`. Se comprobó guardando los cambios con
  `git stash` y ejecutando esa prueba sobre el árbol limpio de `origin/main`: falla
  igual, con el mismo `"http://localhost:3000/login?redirect=%2Fdashboard"`. Es un
  defecto preexistente de la prueba, no de la aplicación. `tests/cursos.spec.ts`
  usa una expresión regular que acepta ambas codificaciones.

Las ejecuciones usaron variables de entorno de Supabase con valores de relleno
(`https://placeholder-build.supabase.co`). Ninguna credencial real intervino, y por
eso los caminos que necesitan base de datos no se pudieron probar.

## Evidencia de la interfaz responsive

Las capturas están en `docs/evidence/EPT-8/`.

**Cómo se obtuvieron, con precisión:** se renderizó el componente real
`GestionCursos` con datos de prueba fijos desde una ruta temporal local, que se
eliminó antes de confirmar los cambios. Prueban maquetación, comportamiento
responsive, estados y accesibilidad. **No** prueban el camino de datos: para eso
hace falta un director autenticado contra una base real.

| Archivo | Ancho | Qué muestra |
|---|---|---|
| `escritorio-01-listado.png` | 1280 | Listado con cursos activos e inactivos, y la acción correspondiente en cada fila |
| `escritorio-02-formulario.png` | 1280 | Formulario de alta desplegado |
| `escritorio-03-validacion.png` | 1280 | Errores de validación por campo, en español |
| `escritorio-04-edicion.png` | 1280 | Diálogo de edición |
| `escritorio-05-error-servidor.png` | 1280 | Estado de error tras un rechazo del servidor |
| `escritorio-06-vacio.png` | 1280 | Estado vacío |
| `escritorio-07-foco-dialogo.png` | 1280 | Foco visible en el primer campo del diálogo |
| `movil-01-listado.png` | 375 | Listado en tarjetas, sin desplazamiento horizontal |
| `movil-02-formulario-validacion.png` | 375 | Alta y validación en pantalla angosta |
| `movil-03-edicion.png` | 375 | Diálogo de edición en móvil |
| `movil-04-vacio.png` | 375 | Estado vacío en móvil |

Accesibilidad comprobada durante la captura, con aserciones automáticas:

- Se llega al botón «Nuevo curso» solo con `Tab` y se activa con `Enter`.
- Al abrir el diálogo, el foco pasa a su primer campo; al cerrarlo con `Escape`,
  vuelve al botón que lo abrió.
- Cada error de validación se muestra junto a su campo con `role="alert"`.
- Los fallos generales viven en una región `aria-live="polite"`.
- La tabla tiene `caption`, `scope="col"` y una etiqueta accesible; las acciones de
  cada fila nombran el curso («Inactivar el curso 1er Grado A»).

## Seguridad y privacidad

- `SUPABASE_SERVICE_ROLE_KEY` no se usa en ningún archivo de esta historia. Toda la
  operación de cursos pasa por el cliente ligado a la sesión, de modo que RLS sigue
  siendo la última línea de defensa.
- `cursos.service.ts` y `autorizacion.ts` importan `next/headers` de forma indirecta,
  así que importarlos desde un componente cliente rompe la compilación. Es una
  garantía del compilador, no una convención.
- Los mensajes de PostgreSQL nunca llegan al usuario: se traducen por SQLSTATE. El
  detalle queda en el registro del servidor y no contiene datos personales.
- `tests/cursos.spec.ts` verifica que las respuestas de error no contengan
  `service_role`, `postgres`, `supabase.co`, fragmentos de SQL ni códigos SQLSTATE.
- Las capturas usan datos inventados; no hay información de personas reales.
- El rol nunca se toma de metadatos que el usuario pueda editar.

## Límite de reversión

Los tres commits son independientes y se revierten de atrás hacia adelante:

1. **Interfaz** — revertir el tercer commit elimina `/dashboard/cursos`, su ítem de
   menú, el cliente del navegador y esta documentación. La API y el esquema quedan
   intactos.
2. **Servidor** — revertir el segundo elimina `/api/cursos`, la capa de acceso a
   datos, la autorización y los esquemas Zod.
3. **Base de datos** — revertir el primero quita `003_cursos.sql` del repositorio.
   **Si la migración ya se aplicó, revertirla en el repositorio no deshace el
   esquema.** Para eso hace falta una migración `004` que haga `DROP TABLE
   public.cursos`, quite las dos funciones y el esquema `app_private`, y decida
   explícitamente si `niveles` vuelve a quedar sin RLS. Nada de esto destruye datos
   ajenos a cursos.

## Pruebas pendientes

Estas son las razones por las que la historia no está terminada.

| Falta | Por qué está bloqueado | Cómo se destraba | Afecta a |
|---|---|---|---|
| Reinicio limpio de la base y aplicación de `003` | `supabase db reset` necesita Docker; no hay Docker, PostgreSQL local, WSL ni `psql` en este entorno | Instalar Docker Desktop y ejecutar `supabase db reset` | EPT-14, EPT-17, EPT-18 |
| Ejecución de `supabase/tests/cursos_rls.sql` | Igual que arriba | Ejecutar el comando de la ruta rápida | EPT-14, EPT-17, EPT-18 |
| Regeneración de tipos desde el esquema | `supabase gen types` necesita una base o un proyecto | Ejecutar `supabase gen types --local` tras el reinicio y comparar con el archivo actual | EPT-14 |
| Asesores de seguridad y rendimiento | No hay ningún proyecto Supabase de este repositorio accesible | Ejecutar `supabase db advisors` o el MCP `get_advisors` | EPT-14, EPT-17 |
| Camino permitido del director en el navegador | No existe ninguna infraestructura de sesiones autenticadas en las pruebas, y hacen falta usuarios sembrados | Crear un proyecto de Playwright que inicie sesión por rol y guarde `storageState`, sembrando con `createAdminClient()` | EPT-16, EPT-18 |
| Duplicado y nivel inexistente de punta a punta | Igual que arriba | Igual que arriba | EPT-18 |
| Revisión por el otro integrante | Es un acto humano | Abrir la revisión sobre esta rama | EPT-8, EPT-19 |
| Integración en `main` | Depende de la revisión | Integrar tras aprobar | EPT-8, EPT-19 |

## Riesgos que quedan abiertos

1. **Las migraciones del repositorio no describen la base real.** `padres_hijos` y
   `opiniones.aprobado` existen en los tipos y en el código, pero no en ninguna
   migración; `inscripciones` tiene RLS habilitado y cero políticas. Alguien aplicó
   DDL directamente en el editor SQL de Supabase. Antes de aplicar `003` conviene
   comparar el esquema real con `001` + `002`. Corresponde a EPT-66.
2. **Recursión en las políticas de `perfiles`.** La política
   `"Directores y docentes ven todos los perfiles"` de `001` se consulta a sí misma.
   Esta historia la esquiva con `es_director_actual()`, pero el defecto sigue ahí y
   afecta a `postulaciones` y `solicitudes_inscripcion`, que copian el mismo patrón.
   Corresponde a EPT-66.
3. **`roles` y `actividades` siguen sin RLS** y con `GRANT ALL` para `authenticated`.
   Quedan fuera del alcance de esta historia. `niveles` sí se endureció, porque los
   cursos lo referencian.
4. **Endurecer `niveles` es un cambio de comportamiento.** A partir de `003`,
   `authenticated` solo puede leer niveles. Ningún código actual los escribe, pero
   EPT-55 deberá agregar sus propias políticas de escritura.

## Retrospectiva

Lo que funcionó: leer primero las migraciones existentes. La recursión de las
políticas de `perfiles` habría roto silenciosamente la funcionalidad si se hubiera
copiado el patrón dominante del repositorio, y solo se detectó leyendo `001`
completo antes de escribir una línea de SQL.

Lo que costó: la ausencia de infraestructura de base de datos. Buena parte del
trabajo de esta historia es una regla de PostgreSQL, y ninguna de esas reglas pudo
ejecutarse. Escribir `cursos_rls.sql` como artefacto ejecutable fue la forma de
dejar la verificación lista en lugar de simplemente describirla.

Lo que conviene cambiar para la próxima historia: montar la infraestructura de
sesiones autenticadas para Playwright antes de empezar. Todas las historias que
siguen (EPT-9 en adelante) van a necesitar exactamente lo mismo, y hoy no existe.
