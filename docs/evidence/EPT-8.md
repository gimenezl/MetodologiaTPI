# EPT-8 — Administrar cursos: evidencia de la historia

La administración de cursos está implementada de punta a punta sobre la rama
`codex/ept-8-admin-courses`, partiendo del commit `801c967` de `origin/main`:
migración aditiva con unicidad normalizada y RLS, límite HTTP que autoriza al
DIRECTOR antes de tocar la base, y la pantalla responsive `/dashboard/cursos`.

**Estado: lista para revisión, no terminada.**

Una auditoría independiente encontró una **escalada de privilegios crítica** que
esta remediación cierra con la migración `004`: `public.roles` no tenía RLS y
`authenticated` conservaba `GRANT ALL` desde la migración `001`, así que
cualquier usuario podía renombrar su propio rol como `DIRECTOR` y quedar
autorizado para administrar cursos. El detalle está en
[La escalada de privilegios](#la-escalada-de-privilegios-y-cómo-se-cierra).

Sigue sin poder ejecutarse la verificación de base de datos: en este entorno no
hay Docker ni ninguna base PostgreSQL alcanzable. La sección
[Pruebas pendientes](#pruebas-pendientes) dice qué falta, por qué, y cuál es la
acción exacta que lo destraba.

## Ruta rápida para quien revisa

1. Leer `supabase/migrations/004_seguridad_roles_niveles.sql`: es el arreglo de seguridad.
2. Leer `supabase/migrations/003_cursos.sql`: ahí están las reglas de negocio del curso.
3. Leer `src/services/autorizacion.ts` y `src/app/api/cursos/route.ts`: el control del servidor.
4. Ejecutar todo lo que corre sin base de datos:

   ```bash
   npx tsc --noEmit --incremental false
   npm run build
   npx playwright test tests/cursos.spec.ts tests/cursos-ui.spec.ts
   ```

5. Con una base local descartable, ejecutar lo que falta:

   ```bash
   supabase db reset
   psql "$(supabase status -o json | jq -r .DB_URL)" -v ON_ERROR_STOP=1 \
        -f supabase/tests/cursos_rls.sql
   ```

## La escalada de privilegios y cómo se cierra

La migración `001` dejó dos huecos que por separado parecen menores y juntos
anulan por completo la autorización del director:

| # | Hueco | Dónde |
|---|---|---|
| 1 | `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated` le dio a todo usuario autenticado **todos** los privilegios sobre `public.roles`, incluido `UPDATE` | `001_initial_schema.sql:312` |
| 2 | `public.roles` nunca recibió RLS, así que no había política que frenara esa escritura | `001` no la menciona |

La autorización de cursos deriva el rol de `roles.nombre = 'DIRECTOR'`, tanto en
RLS como en el servidor. Por lo tanto, un ESTUDIANTE autenticado podía ejecutar:

```sql
UPDATE public.roles SET nombre = 'DIRECTOR' WHERE nombre = 'ESTUDIANTE';
```

y a partir de ahí `public.es_director_actual()` devolvía `true` para él y para
todos los estudiantes. Ninguna de las tres capas lo detenía, porque las tres
consultan la misma fuente. No hacía falta tocar `perfiles` en ningún momento.

**Qué cambia `004`:** `roles` y `niveles` quedan de **solo lectura** para los
roles de aplicación. Se revoca `ALL` (que incluye `REFERENCES` y `TRIGGER`, no
solo las escrituras habituales), se otorga únicamente `SELECT` a `authenticated`,
se habilita RLS y se crean políticas de lectura. No se agregan políticas de
escritura, así que RLS deniega la escritura aunque alguien vuelva a otorgar el
privilegio por error.

**Por qué no rompe nada:** en todo el repositorio no hay una sola escritura sobre
`roles` ni sobre `niveles`. Solo lecturas: directas en `roles.service.ts:7`,
`inscripciones.service.ts:40` y `cursos.service.ts:122`, y embebidas
(`rol:roles(nombre)` en `AuthContext.tsx:77`, `perfiles.service.ts` y
`api/usuarios/route.ts:33`; `nivel:niveles(nombre)` en `actividades.service.ts:8`).
La administración privilegiada sigue funcionando porque `service_role` no está
sujeto a RLS ni a estas revocaciones.

El segundo hallazgo, más chico, también queda cerrado: `003` había revocado de
`niveles` solo `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE`, dejando `REFERENCES` y
`TRIGGER` en pie y contradiciendo la afirmación de "solo lectura".

## Decisión sobre el límite de migración

**Se agregó una migración nueva, `004`. No se editó `003`.**

| Evidencia | Observación |
|---|---|
| ¿En qué refs vive `003_cursos.sql`? | Solo en `c183c1a`, de esta rama (`git log --all -- supabase/migrations/003_cursos.sql`) |
| ¿Está en `origin/main`? | No (`git cat-file -e origin/main:...` falla) |
| ¿La rama se subió alguna vez? | No. `git ls-remote --heads origin` solo devuelve `main` y `mejora-buenas-practicas` |
| ¿Hay base local o historial de migraciones? | No: sin Docker, sin PostgreSQL, sin `supabase/config.toml`, sin `supabase/.temp` ni `.branches` |
| ¿El proyecto Supabase del repositorio es alcanzable? | **No.** El ref configurado en el entorno local no coincide con ninguno de los proyectos accesibles por MCP |

La última fila es la decisiva. El proyecto real del repositorio no se puede
inspeccionar, así que **no se puede probar** que `003` no haya sido aplicado ahí.
Sumado a que el flujo documentado del repositorio es aplicar el SQL a mano en el
editor de Supabase —sin tabla de historial que detecte la divergencia—, un
archivo de migración mutado sería un riesgo silencioso. Una migración hacia
adelante es correcta en los dos escenarios.

Nombre del archivo: se volvió a consultar `supabase migration new --help`
(CLI 2.117.0 vía `npx`), que genera nombres con marca de tiempo. Se mantiene la
convención del repositorio, `NNN_nombre.sql`, porque este repositorio no es un
proyecto de CLI de Supabase (no existe `supabase/config.toml`) y `001`, `002` y
`003` ya la establecen.

## Criterios de aceptación y su evidencia

Los cinco criterios son los de EPT-8 en Jira, consultados en vivo.

| # | Criterio | Dónde se implementa | Evidencia ejecutada | Estado |
|---|---|---|---|---|
| 1 | Se crea un curso con denominación, división y nivel existentes. | `003` (tabla `cursos`), `POST /api/cursos`, formulario de alta | Interfaz: `cursos-ui.spec.ts` (formulario, validación, envío). Base: `cursos_rls.sql` §2.1, **sin ejecutar** | Parcial |
| 2 | Se consulta y modifica un curso sin perder relaciones. | `listarCursos`, `actualizarCurso`, `PATCH /api/cursos/[id]` | Interfaz: diálogo de edición probado. Base: `cursos_rls.sql` §2.2, **sin ejecutar** | Parcial |
| 3 | Se inactiva un curso con historial en lugar de eliminarlo físicamente. | Columna `activo`; sin GRANT, sin política y sin endpoint DELETE | **Probado:** 405 en todo `DELETE` (`cursos.spec.ts`); no existe ningún control de borrado en la interfaz (`cursos-ui.spec.ts`); la fila inactiva ofrece «Reactivar». Conservación de filas: `cursos_rls.sql` §5, **sin ejecutar** | Parcial |
| 4 | No se admite la misma denominación y división dentro de un mismo nivel. | `idx_cursos_nivel_denominacion_division` sobre `UPPER(BTRIM(...))` | Interfaz: el mensaje de duplicado se muestra correctamente (`cursos-ui.spec.ts`). Base: `cursos_rls.sql` §3, 4 variantes, **sin ejecutar** | Parcial |
| 5 | Un usuario no autorizado no puede usar la administración de cursos. | Navegación por rol, `requerirDirector()`, políticas RLS, migración `004` | **Probado:** 401 y redirección (`cursos.spec.ts`). Base: `cursos_rls.sql` §8–§10 y §9bis, **sin ejecutar** | Parcial |

## Decisiones tomadas

| Tema | Decisión | Por qué |
|---|---|---|
| Límite de migración | Migración `004` nueva; `003` intacto | Ver [la sección anterior](#decisión-sobre-el-límite-de-migración) |
| Alcance de la unicidad | Activos **e** inactivos | El criterio 4 no admite excepciones y evita que un registro histórico quede ambiguo. La alternativa —índice parcial `WHERE activo`— es un cambio de regla de negocio, no un detalle técnico |
| Forma de normalizar | `UPPER(BTRIM(...))` en el índice, más CHECK que obliga a guardar valores recortados | Determinista y verificable. Se guarda como lo escribió el director, solo recortado. `src/lib/validations.ts` replica la misma expresión |
| Autorización en RLS | `app_private.es_director()` con `SECURITY DEFINER`, expuesta por `public.es_director_actual()` con `SECURITY INVOKER` | La política `"Directores y docentes ven todos los perfiles"` de `001` consulta `perfiles` dentro de una política sobre `perfiles`, lo que produce recursión (SQLSTATE 42P17). Copiar ese patrón habría roto la funcionalidad. La lógica privilegiada queda en un esquema que la Data API no expone |
| Identificador del curso | `UUID` | Coincide con `perfiles` e `inscripciones` y evita identificadores enumerables en las URL de la API |
| Índices | Solo el índice único | Es también el índice de la clave foránea, porque `nivel_id` es su primera columna. Decenas de filas y ninguna otra ruta de consulta demostrada |
| Retención del foco en el diálogo | Implementada | El diálogo declara `aria-modal="true"`, así que un lector de pantalla anuncia que el resto de la página quedó inactivo. Sin retención, ese anuncio sería falso |
| Banco de pruebas de interfaz | Comprometido en el repositorio, con doble cierre | Ver [Cómo se prueban la interfaz y la accesibilidad](#cómo-se-prueban-la-interfaz-y-la-accesibilidad) |

## Cambios por archivo

### Base de datos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/003_cursos.sql` | **Sin cambios.** Esquema `app_private`, las dos funciones de rol, unicidad y RLS de `niveles`, tabla `cursos` con FK `ON DELETE RESTRICT`, CHECKs, `activo`, índice único normalizado, RLS y privilegios mínimos |
| `supabase/migrations/004_seguridad_roles_niveles.sql` | **Nuevo.** Cierra la escalada por `public.roles` y los privilegios residuales de `niveles`; reafirma los de `cursos` |
| `supabase/tests/cursos_rls.sql` | Se agregan §1bis (privilegios residuales, incluidos `REFERENCES`, `TRIGGER` y las secuencias) y §9bis (ataque directo a la tabla de roles). §9 se reescribe para **clasificar** la recursión 42P17 como FALLO en lugar de contarla como denegación |
| `src/types/database.types.ts` | **Sin cambios.** Sigue siendo un archivo escrito a mano; ver [Tipos](#tipos-de-base-de-datos) |

### Servidor

Sin cambios respecto del candidato anterior: `src/services/autorizacion.ts`,
`src/services/cursos.service.ts`, `src/app/api/cursos/route.ts` (`POST`),
`src/app/api/cursos/[id]/route.ts` (`PATCH`), `src/lib/validations.ts`.

### Interfaz

| Archivo | Cambio |
|---|---|
| `src/app/dashboard/cursos/_components/GestionCursos.tsx` | Se agrega retención del foco en el diálogo (`Tab` y `Shift+Tab` ciclan dentro) y nombre accesible a la región de estado |
| `src/app/pruebas-ui/cursos/page.tsx` | **Nuevo.** Banco de pruebas con doble cierre |
| Resto de `src/app/dashboard/cursos/` y `src/services/cursos.client.ts` | Sin cambios |

### Pruebas y configuración

| Archivo | Cambio |
|---|---|
| `tests/cursos-ui.spec.ts` | **Nuevo.** 18 pruebas de interfaz, estados, accesibilidad e idioma |
| `tests/cursos.spec.ts` | Sin cambios. 7 pruebas de límite HTTP |
| `playwright.config.ts` | Habilita el banco de pruebas para la corrida y completa las credenciales de Supabase con valores de relleno **solo si el entorno no trae los suyos** |

## Matriz de autorización, privilegios y RLS

| Actor | Menú | `/dashboard/cursos` | `POST`/`PATCH` | Leer cursos | Escribir cursos | Borrar cursos | Escribir `roles`/`niveles` |
|---|---|---|---|---|---|---|---|
| Anónimo | No | Redirige a `/login` | 401 | Denegado (sin GRANT) | Denegado | Denegado | Denegado |
| ESTUDIANTE | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | **Denegado (004)** |
| DOCENTE | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | **Denegado (004)** |
| PADRE | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | **Denegado (004)** |
| PERSONAL | No | Acceso restringido | 403 | Permitido | Denegado (RLS) | Denegado | **Denegado (004)** |
| DIRECTOR | Sí | Administración completa | 201 / 200 | Permitido | Permitido (RLS) | **Denegado** | **Denegado (004)** |

Privilegios de tabla después de `004`, para `anon` y `authenticated`:

| Tabla | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER |
|---|---|---|---|---|---|---|---|
| `public.cursos` | authenticated | authenticated | authenticated | — | — | — | — |
| `public.niveles` | authenticated | — | — | — | — | — | — |
| `public.roles` | authenticated | — | — | — | — | — | — |

El borrado físico de cursos está denegado **para todos, incluido el director**:
no hay GRANT, no hay política y no hay endpoint. `src/proxy.ts` no cubre
`/api/**` y solo refresca la sesión; no es un límite de autorización y no se
modificó.

## Cómo se prueban la interfaz y la accesibilidad

`tests/cursos-ui.spec.ts` corre contra `/pruebas-ui/cursos`, un banco de pruebas
**comprometido en el repositorio** que renderiza el componente real
`GestionCursos` con datos fijos. La versión anterior de esta evidencia usaba una
ruta temporal que se borraba antes de confirmar los cambios, de modo que las
afirmaciones sobre teclado y foco no eran reproducibles. Ahora sí lo son.

**Doble cierre, verificado:** el banco responde 404 en cualquier compilación de
producción y además exige `EPT_UI_HARNESS=1`, que solo define
`playwright.config.ts`. Se comprobó levantando el servidor de producción con la
variable puesta: `/pruebas-ui/cursos` devolvió **404**, mientras
`/dashboard/cursos` devolvió **307** hacia el login.

**Alcance, dicho con precisión:** estas pruebas demuestran maquetación, manejo de
estados, textos en español y comportamiento de teclado y lector de pantalla. Los
errores de dominio se verifican **simulando el contrato HTTP de `/api/cursos`**,
así que prueban que la interfaz muestra cada respuesta documentada; **no**
prueban las reglas de PostgreSQL que las producen. Eso vive en
`supabase/tests/cursos_rls.sql` y sigue sin ejecutarse.

Lo que queda probado por aserciones automáticas, no por inspección visual:

| Comportamiento | Prueba |
|---|---|
| Se llega al alta solo con `Tab` y se activa con `Enter` | «reaches the create form using only the keyboard» |
| El foco inicial del diálogo cae en el primer campo, no en el botón de cerrar | «opens the edit dialog with correct labelling and initial focus» |
| El foco no se escapa del diálogo: 12 `Tab` y 12 `Shift+Tab` siguen dentro | «keeps keyboard focus inside the dialog while it is open» |
| `Escape` cierra y devuelve el foco al botón que abrió | «closes the dialog with Escape and restores focus to the trigger» |
| Los errores de validación se exponen con `role="alert"` | «reports validation errors per field, announced as alerts» |
| La región de estado existe, tiene nombre y es `aria-live="polite"` | «describes the table and every row action for screen readers» |
| La tabla tiene `caption` y `scope="col"`; cada acción nombra su curso | idem |
| El estado vacío no se parece a un error: la región de estado queda vacía | «shows a distinct empty state, not an error» |
| No existe ningún control de borrado | «offers no delete control anywhere in the list» |
| Un valor con solo espacios no llega a la red | «rejects whitespace-only input before reaching the network» |
| El botón queda deshabilitado mientras se envía | «disables the submit button while the request is in flight» |
| A 375 px la página no depende del desplazamiento horizontal | «lays out as cards without depending on horizontal scrolling» |
| Todo el texto visible y los nombres accesibles están en español | «every visible string and accessible name is Spanish» |

## Auditoría de idioma

La prueba «every visible string and accessible name is Spanish» recorre el texto
visible más los atributos `aria-label`, `placeholder`, `alt` y `title`, y falla si
aparece cualquiera de 23 palabras inglesas frecuentes en interfaces, comparadas
con límites de palabra para que «Cancelar», «Editar» o «Crear» no den falsos
positivos. También exige que estén presentes «Cursos», «Nuevo curso»,
«Denominación», «División» y «Nivel educativo».

Los textos que el banco de pruebas no puede renderizar —porque requieren sesión—
se auditaron leyendo el código: «Acceso restringido», «Volver al panel», «No
pudimos cargar los cursos», «No pudimos mostrar los cursos», «Cargando los
cursos…», el título `Cursos | Panel`, el ítem de menú «Cursos» y los mensajes de
`autorizacion.ts`, `cursos.service.ts`, `cursos.client.ts` y las dos rutas de la
API. Todos están en español.

## Capturas

Están en `docs/evidence/EPT-8/` y las regenera `tests/cursos-ui.spec.ts`, así que
cualquier revisor puede reproducirlas:

```bash
EPT_CAPTURAS=1 npx playwright test tests/cursos-ui.spec.ts
```

La captura es opcional a propósito: volver a renderizar produce archivos
distintos byte a byte aunque no haya cambiado nada, así que una corrida normal de
`npm run test:e2e` deja el árbol de trabajo limpio.

| Archivo | Ancho | Qué muestra |
|---|---|---|
| `escritorio-01-listado.png` | 1280 | Listado con cursos activos e inactivos, y «Reactivar» en la fila inactiva |
| `escritorio-02-formulario.png` | 1280 | Formulario de alta desplegado |
| `escritorio-03-validacion.png` | 1280 | Errores de validación por campo, en español |
| `escritorio-04-edicion.png` | 1280 | Diálogo de edición |
| `escritorio-05-error-duplicado.png` | 1280 | **Error de dominio real y visible**: «Ya existe un curso con esa denominación y división en el nivel elegido», en la región de estado y junto al campo |
| `escritorio-06-vacio.png` | 1280 | Estado vacío |
| `escritorio-07-foco-dialogo.png` | 1280 | Foco visible en el primer campo del diálogo |
| `escritorio-08-enviando.png` | 1280 | Estado de envío: botón deshabilitado con «Cargando...» |
| `movil-01-listado.png` | 375 | Listado en tarjetas, sin desplazamiento horizontal |
| `movil-02-formulario-validacion.png` | 375 | Alta y validación en pantalla angosta |
| `movil-03-edicion.png` | 375 | Diálogo de edición en móvil |
| `movil-04-vacio.png` | 375 | Estado vacío en móvil |

**Corrección respecto de la versión anterior de esta evidencia:** el archivo
`escritorio-05-error-servidor.png` decía mostrar un error del servidor, pero
mostraba el estado de envío. Se eliminó. Ahora hay dos capturas distintas y
correctamente rotuladas: `escritorio-05-error-duplicado.png` para el error de
dominio y `escritorio-08-enviando.png` para el envío en curso.

## Tipos de base de datos

`src/types/database.types.ts` **está escrito a mano** y esta historia lo extendió
a mano. Nunca se ejecutó una generación desde el esquema, y no debe describirse
como generado hasta que se ejecute y se reconcilie.

Que no es un archivo generado se comprueba en el propio archivo: no tiene
`Relationships`, `Enums` ni `CompositeTypes`, no hay ningún script que lo
regenere en `package.json`, no hay CLI de Supabase en las dependencias, y ya
contenía `padres_hijos`, que no existe en ninguna migración.

Cuando haya base local, `supabase gen types --local` va a producir un archivo con
otra forma y va a **exponer la deriva de base** (`padres_hijos`,
`opiniones.aprobado`, políticas faltantes de `inscripciones`). Esa deriva hay que
reconciliarla de forma deliberada, no borrarla ni volver a editarla a mano.

## Comandos ejecutados y resultados exactos

Entorno: Windows 10 Pro 19045, Node v24.19.0, npm 11.17.0, Next.js 16.2.5,
Playwright 1.52+, Supabase CLI 2.117.0 vía `npx`. Todo desde
`E:/Escritorio/codigo/MetodologiaTPI-ept8`, sobre el candidato final.

| Comando | Salida | Código |
|---|---|---|
| `git diff --check` | sin hallazgos | **0** |
| `npx tsc --noEmit --incremental false` | sin salida | **0** |
| `npx eslint --no-cache` sobre los archivos de EPT-8 | 0 errores; 1 advertencia preexistente en `dashboard/layout.tsx:127` (`perfil` sin usar) | **0** |
| `npm run lint -- --no-cache` (repositorio) | `125 problems (16 errors, 109 warnings)`; **ninguna ruta de EPT-8 aparece** | 1 |
| `npm run build` | `✓ Compiled successfully`; `/api/cursos`, `/api/cursos/[id]`, `/dashboard/cursos` y `/pruebas-ui/cursos` como rutas de servidor | **0** |
| `npx next start` + `GET /pruebas-ui/cursos` con `EPT_UI_HARNESS=1` | **404** | — |
| `npx next start` + `GET /dashboard/cursos` sin sesión | **307** hacia el login | — |
| `npx playwright test tests/cursos.spec.ts` | **7 passed** | **0** |
| `npx playwright test tests/cursos-ui.spec.ts` | **18 passed** | **0** |
| `npm run test:e2e` (suite completa) | 29 pruebas: **28 passed, 1 failed** | 1 |

### Entorno de base de datos: observaciones exactas

Esto corrige la redacción de la versión anterior, que decía que WSL no estaba
disponible. **WSL sí está instalado.**

| Comando | Observación |
|---|---|
| `docker --version` | «El término 'docker' no se reconoce…». No está en el PATH |
| `Test-Path 'C:\Program Files\Docker\Docker\Docker Desktop.exe'` | `False`. Docker Desktop no está instalado |
| `wsl --status` | **«Versión predeterminada: 2»**, actualizaciones automáticas activadas. WSL 2 está instalado y funciona |
| `wsl -l -v` | «El subsistema de Windows para Linux no tiene distribuciones instaladas» |
| `psql --version` | No se reconoce |
| `Get-Service '*postgre*'` | Ningún servicio |
| Proyecto Supabase del repositorio | No accesible por MCP (el ref configurado no coincide con ningún proyecto accesible) |

En resumen: **el bloqueo real es que no hay ningún motor de contenedores ni
ninguna base PostgreSQL alcanzable.** WSL 2 existe pero sin distribución, así que
tampoco sirve tal como está. Instalar Docker Desktop, una distribución de WSL o
PostgreSQL es instalar software de sistema y requiere autorización explícita del
usuario, que no se pidió ni se dio en esta sesión.

### Sobre las dos salidas con código 1

Ninguna la introduce esta historia, y ambas están comprobadas contra la línea
base, **sin tocar el árbol de trabajo de la rama**.

- **`npm run lint`**: `REGISTRO_MODIFICACIONES.md:35` ya documenta «16 errores y
  109 advertencias preexistentes fuera del alcance». El total obtenido es
  exactamente ese, y ninguna ruta de EPT-8 aparece en la salida.
- **`npm run test:e2e`**: falla `tests/e2e.spec.ts:8` («dashboard redirects to
  login when unauthenticated»), que espera `redirect=/dashboard` mientras la
  aplicación produce `redirect=%2Fdashboard`. Se comprobó creando un árbol de
  trabajo descartable en el commit exacto `801c967`, con su propia instalación de
  dependencias y su propia configuración, y ejecutando ahí la suite: **3 passed,
  1 failed**, con la misma cadena
  `"http://localhost:3000/login?redirect=%2Fdashboard"`. Es un defecto
  preexistente de esa prueba. El árbol descartable se eliminó después.

La comparación en números: la línea base tiene 4 pruebas, de las que 1 falla.
El candidato tiene 29, de las que falla exactamente la misma. EPT-8 agrega 25
pruebas y todas pasan.

## Seguridad y privacidad

- `SUPABASE_SERVICE_ROLE_KEY` no se usa en ningún archivo de esta historia. Toda
  la operación de cursos pasa por el cliente ligado a la sesión.
- `cursos.service.ts` y `autorizacion.ts` importan `next/headers` de forma
  indirecta, así que importarlos desde un componente cliente rompe la
  compilación. Es una garantía del compilador, no una convención.
- Los mensajes de PostgreSQL nunca llegan al usuario: se traducen por SQLSTATE.
- `tests/cursos.spec.ts` verifica que las respuestas de error no contengan
  `service_role`, `postgres`, `supabase.co`, fragmentos de SQL ni SQLSTATE.
- El banco de pruebas usa datos inventados y no accede a la base. Las identidades
  de `cursos_rls.sql` son sintéticas y la transacción termina en `ROLLBACK`.
- No se confirmó ningún secreto, archivo de entorno, reporte, traza ni estado de
  sesión. `.gitignore` cubre `test-results/` y `playwright-report/`.
- El rol nunca se toma de metadatos que el usuario pueda editar.

## Límite de reversión

Cuatro commits, revertibles de atrás hacia adelante:

1. **Remediación** (`fix(courses): harden authorization and complete proof`) —
   revertirlo devuelve la escalada por `public.roles`, quita el banco de pruebas
   y las 18 pruebas de interfaz, y saca la retención de foco. **No conviene
   revertirlo solo**: reabre un agujero de seguridad crítico.
2. **Interfaz** — revertirlo elimina `/dashboard/cursos`, su ítem de menú y el
   cliente del navegador.
3. **Servidor** — revertirlo elimina `/api/cursos`, la capa de datos y la
   autorización.
4. **Base de datos** — revertirlo quita `003_cursos.sql` del repositorio. **Si las
   migraciones ya se aplicaron, revertir los archivos no deshace el esquema.**
   Para eso hace falta una migración `005` que elimine `cursos`, las dos
   funciones y el esquema `app_private`, y decida explícitamente si `roles` y
   `niveles` vuelven a quedar sin RLS. Nada de esto destruye datos ajenos a
   cursos.

## Pruebas pendientes

| Falta | Por qué está bloqueado | Cómo se destraba | Afecta a |
|---|---|---|---|
| Reinicio limpio y aplicación de la cadena completa `001`→`004` | `supabase db reset` necesita un motor de contenedores. No hay Docker; WSL 2 está instalado pero sin distribución | Instalar Docker Desktop (requiere autorización del usuario) y ejecutar `supabase db reset` | EPT-14, EPT-17, EPT-18 |
| Ejecución de `supabase/tests/cursos_rls.sql`, incluido §9bis | Igual que arriba | Ejecutar el comando de la ruta rápida | EPT-14, EPT-17, EPT-18 |
| Regeneración de tipos y reconciliación de la deriva | `supabase gen types` necesita `--local`, `--linked`, `--db-url` o `--project-id`; ninguno disponible | Ejecutar `supabase gen types --local` tras el reinicio | EPT-14 |
| Asesores de seguridad y rendimiento | No hay proyecto accesible ni base local | `supabase db advisors` o el MCP `get_advisors` | EPT-14, EPT-17 |
| Camino permitido del director en el navegador, con datos reales | No hay infraestructura de sesiones autenticadas ni usuarios sembrados | Proyecto de Playwright que inicie sesión por rol y guarde `storageState`, sembrando con `createAdminClient()` | EPT-16, EPT-18 |
| Duplicado y nivel inexistente contra la base real | Igual que arriba. Hoy solo está probado el contrato HTTP simulado | Igual que arriba | EPT-18 |
| Revisión por el otro integrante | Es un acto humano | Abrir la revisión sobre esta rama | EPT-8, EPT-19 |
| Integración en `main` | Depende de la revisión | Integrar tras aprobar | EPT-8, EPT-19 |

## Riesgos que quedan abiertos

1. **Las migraciones del repositorio no describen la base real.** `padres_hijos` y
   `opiniones.aprobado` existen en los tipos y en el código, pero no en ninguna
   migración; `inscripciones` tiene RLS habilitado y cero políticas. Alguien
   aplicó DDL directamente en el editor SQL. Antes de aplicar `003` y `004`
   conviene comparar el esquema real con `001` + `002`. Corresponde a EPT-66.
2. **Recursión en las políticas de `perfiles`.** La política
   `"Directores y docentes ven todos los perfiles"` de `001` se consulta a sí
   misma. Esta historia la esquiva con `es_director_actual()`, y `cursos_rls.sql`
   ahora **falla explícitamente** si una denegación llega por 42P17 en lugar de
   por autorización. El defecto sigue ahí y afecta también a `postulaciones` y
   `solicitudes_inscripcion`. Corresponde a EPT-66.
3. **`actividades` sigue sin RLS** y con `GRANT ALL` para `authenticated`, así que
   cualquier usuario autenticado puede modificarla desde el navegador. Queda
   fuera del alcance de esta historia porque no participa de la autorización de
   cursos, pero es el mismo patrón que causó la escalada por `roles`.
   Corresponde a EPT-66.
4. **Endurecer `roles` y `niveles` es un cambio de comportamiento.** A partir de
   `004`, `authenticated` solo puede leerlas. Ningún código actual las escribe,
   pero EPT-55 (niveles) y EPT-59 (roles y permisos) deberán definir sus propias
   políticas de escritura, o hacer esas operaciones por un límite privilegiado.

## Retrospectiva

**Lo que funcionó:** leer primero las migraciones existentes. La recursión de las
políticas de `perfiles` habría roto la funcionalidad en silencio si se hubiera
copiado el patrón dominante del repositorio.

**Lo que falló:** la primera versión de esta historia dio por segura la
autorización por rol sin auditar quién puede escribir la tabla de la que ese rol
se deriva. El control estaba bien construido sobre una base que cualquiera podía
mover. La lección es concreta: cuando una decisión de autorización lee una tabla,
hay que revisar los privilegios de **esa** tabla, no solo los de la que se quiere
proteger.

**Lo segundo que falló:** se borró el banco de pruebas de interfaz antes de
confirmar los cambios, dejando afirmaciones de accesibilidad sin nada que las
respaldara, y una captura quedó mal rotulada. Una evidencia que no se puede
volver a ejecutar no es evidencia. Ahora el banco está comprometido y cerrado
por partida doble.

**Qué conviene cambiar:** montar la infraestructura de sesiones autenticadas para
Playwright antes de empezar la próxima historia. Todas las que siguen (EPT-9 en
adelante) van a necesitar exactamente lo mismo, y hoy no existe.
