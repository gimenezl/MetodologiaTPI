# EPT-66 — Integrar los módulos y normalizar las migraciones

> **Estado: unidades A–D integradas en `main` y migraciones 28, 29 y 30 aplicadas en producción**
> (detalle y recorridos en §10). Documento maestro; el detalle de cada unidad está en su archivo.
>
> | Unidad | Contenido | Evidencia | Estado |
> |---|---|---|---|
> | A | Correcciones técnicas sin migraciones | este archivo | **En `main`** (#33) |
> | B | Migración de **expansión** (28) + pruebas | `EPT-66/B-expansion.md` | **En `main`** (#34); **28 aplicada en producción** el 02/10/2026 02:57 ART |
> | C | Aplicación nueva + migración de **contracción** (29) | `EPT-66/C-aplicacion-contraccion.md` | **En `main`** (#36 y la corrección #37); **29 aplicada en producción** el 02/10/2026 15:33 ART. La #35 se fusionó hacia `codex/ept-66-expansion`, **no** hacia `main`; C llegó mediante la #36 |
> | D | Asistencias: el DOCENTE solo ve y registra a sus alumnos a cargo (migración 30) | `EPT-66/D-asistencias.md` | **En `main`** (#38); **30 aplicada en producción** el 02/10/2026 19:13 ART |
>
> «PR fusionado» **no** significa «desplegado en Production»: Vercel despliega la aplicación, pero
> PostgreSQL solo cambia con `supabase db push` y autorización puntual (se pidió y se obtuvo una por
> migración, ver §10).

## 1. Línea base

| Dato | Valor |
|---|---|
| Repositorio | `gimenezl/MetodologiaTPI` |
| `origin/main` al iniciar | `2322ce58734dacb764e181fea55ee1a9d49d6720` |
| Rama de la unidad A | `codex/ept-66-integracion` |
| Migraciones en el repositorio | 27 (hasta `20261001165229_ept_65_correcciones_registro_accesos.sql`) |
| Ledger de producción al iniciar | 27/27, hasta 20261001165229. Tras la ejecución: 28 (02/10 02:57 ART), 29 (02/10 15:33 ART) y 30 (02/10 19:13 ART); ver §10 |
| Decisión D1=A (Lucas) | Talleres y actividades legadas fuera del alcance administrativo de RF16; conservan autoservicio con baja lógica, RPC seguras, cupo serializado y sin DELETE físico |

## 2. Unidad A — qué cambia (sin dependencia de migraciones nuevas)

| # | Cambio | Archivos principales |
|---|---|---|
| A1 | Redirección de login restringida a rutas internas del panel; el proxy conserva `pathname + query` | `src/lib/redireccion-login.ts`, `src/proxy.ts`, `src/app/login/LoginForm.tsx` |
| A2 | `.gitattributes`: LF para texto y binarios explícitos, sin renormalizar nada | `.gitattributes` |
| A3 | 14 errores de lint corregidos; bundle de tercero excluido del lint | `eslint.config.mjs`, 9 archivos de `src/app` |
| A4 | `Cache-Control: no-store` en `/api/hijos`, `/api/hijos/[id]` y `/api/hijos/[id]/matricula`, incluidos los errores; 3 funciones muertas de noticias eliminadas | `src/app/api/hijos/**`, `src/services/noticias.service.ts` |
| A5 | Las capturas versionadas de EPT-13 solo se regeneran con `EPT_CAPTURAS=1`; el arnés SMTP exige `EPT_TEST_SMTP_PORT` con un stack aislado | `tests/hijos-*.spec.ts`, `supabase/tests/correr-autenticadas.mjs` |
| A6 | Regresión permanente responsive/accesibilidad a 375×812 y 1280×800; 25 composiciones `<Link><Button>` reemplazadas por `EnlaceBoton`; campos de `/empleo` etiquetados; `main` en `/login` | `tests/responsive-regresion.spec.ts`, `src/components/layout/Navbar.tsx`, páginas públicas |

### Decisiones y detalles

* **A1.** `destinoPanelSeguro` descarta URL absolutas, `//`, `/\`, esquemas, caracteres de
  control, `..`, rutas fuera de `/dashboard` y cualquier variante codificada (hasta 3
  decodificaciones). `urlLoginConDestino` descarta además el resto de la query original.
* **A3.** El único bundle de tercero versionado que el lint recorría es
  `.agents/skills/impeccable/scripts/modern-screenshot.umd.js` (78 de las 107
  advertencias). Se excluye ese archivo, no la carpeta: el resto de `.agents/` sigue
  bajo lint. Un solo `eslint-disable-next-line` nuevo, justificado en
  `src/app/global-error.tsx` (ese archivo reemplaza el layout raíz y la navegación de
  documento completo es intencional).
* **A5.** Las demás suites que escriben capturas (EPT-8, 9, 10, 11, 12, 55, 56, 58, 60–65)
  no se tocaron: el pedido nombraba solo las de EPT-13. Una corrida completa dejó el
  árbol de Git sin cambios (ver §4).
* **A6.** Las pantallas de EPT-66 sin perfil móvil que la auditoría señaló no pudieron
  identificarse (el informe no estaba disponible, ver §6). Se cubrieron todas las rutas
  públicas, `/login` y los 12 bancos `/pruebas-ui/*`. Las pantallas autenticadas conservan
  sus suites `*-ui` multiperfil.

## 3. Defectos reproducidos antes del cierre

| Defecto | Reproducción en la línea base | Después |
|---|---|---|
| `redirect` de login aceptaba cualquier valor | 22 de 26 pruebas de `redireccion-login.spec.ts` fallaban con el comportamiento heredado | 26/26 pasan |
| Checkout con `core.autocrlf=true` rompía la comparación de tipos | `src/types/database.generated.ts` salía con **3518** líneas con CR | 0 líneas con CR; el único archivo con CRLF es el `.ps1` (intencional) |
| `<button>` dentro de `<a>` en la barra pública y 20 sitios más | 10 de 44 pruebas de `responsive-regresion.spec.ts` fallaban en rutas públicas; 8 más por `main`/etiquetas | 44/44 pasan |
| 14 errores de lint | `npm run lint` salía con 1 (14 errores, 107 advertencias) | exit 0 (0 errores, 29 advertencias) |

## 4. Verificación del candidato (SHA de código `662224050a1a7415858c2d2a9716221e3b6b8eb2`)

| Comando | Resultado |
|---|---|
| `git diff --check origin/main..HEAD` | exit 0 |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npm run lint` | exit 0 — 0 errores, 29 advertencias (todas preexistentes) |
| `npm run build` (con `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` de relleno, como `playwright.config.ts`) | exit 0 |
| `playwright test` (proyectos `chromium` y `pixel-5-chromium`, sin base) | 856 pasaron, 1 omitida, 0 fallos, 0 reintentos exitosos (`flaky` = 0) |
| `git status` tras la suite | sin cambios: ninguna captura versionada se reescribió |
| Historial | sin `Co-Authored-By` ni atribución de IA |

La omisión es preexistente: «los objetivos táctiles miden al menos 44 px en móvil y no hay
desborde» solo corre en los perfiles móviles y se omite en escritorio.

## 5. Matriz requisito → prueba → resultado

| Requisito | Prueba | Resultado | Origen |
|---|---|---|---|
| Redirección: rechazar externos, `//`, `/\`, esquemas, control, codificados | `tests/redireccion-login.spec.ts` | OK | Local |
| Redirección: conservar pathname + query | mismo archivo, caso del proxy | OK | Local |
| LF/binarios con `.gitattributes` | clon con `core.autocrlf=true`: 0 CR en `database.generated.ts` | OK | Local |
| `tipos-generados.mjs` con ambos `autocrlf` | `node supabase/tests/tipos-generados.mjs` con la CLI oficial 2.117.0, con `core.autocrlf` true y false | OK, determinista y byte a byte | Stack local oficial |
| 14 errores de lint | `npm run lint` exit 0 | OK | Local |
| tsc / lint / build exit 0 | ver §4 | OK | Local |
| `no-store` en `/api/hijos` | `hijos-auth.spec.ts` contra el stack local oficial | OK | Stack local oficial |
| Capturas EPT-13 solo explícitas | suite completa sin diferencias en Git | OK | Local |
| Arnés SMTP | simulación con `npx` falso: falla con mensaje claro sin puerto o con puerto inválido | OK (simulado) | Local |
| RNF2 375×812 y 1280×800 | `responsive-regresion.spec.ts` (44 casos) | OK | Local |
| RNF1 paleta exacta del PDF | PDF de la Parte 2 no disponible | **No verificable** | Revisión humana pendiente |
| Cupo serializado sin sobrecupo (2 conexiones reales) | B: `inscripciones_legadas_concurrencia.mjs`; defecto reproducido en la línea base (2 ACTIVO con cupo 1) | OK en PostgreSQL 16 (emulación) **y** en PostgreSQL 17.6 del stack oficial | Local |
| Baja lógica, sin DELETE físico ni directo, BAJA inmutable, reinscripción como fila nueva | B/C: `inscripciones_legadas_expansion_rls.sql` (78) y `…_contraccion_rls.sql` (64) | OK (emulación) y OK en el stack oficial (ledger 28 y ledger 29) | Local |
| Cierre de la lectura global de pares alumno–actividad (propio, hijo vinculado, hijo ajeno, alumno ajeno, Dirección, DOCENTE, PERSONAL, bloqueado, anónimo) | C: suite de contracción + 4 vistas en navegador con peticiones interceptadas | OK (SQL); navegador con peticiones simuladas **y** contra la base real (`cupos-legadas-auth.spec.ts`, 5 casos) | Stack local oficial |
| Las 3 filas legadas sobreviven a ambas migraciones | `inscripciones_legadas_migracion_sobre_datos.mjs` (expansión sola y expansión + contracción) | OK con 3 filas **sintéticas** equivalentes, en PostgreSQL 17.6 oficial; **producción no consultada** | Local |
| Privilegios heredados de galería, menú y noticias; privilegios por defecto; `search_path` y EXECUTE de `calcular_porcentaje_asistencia` y `verificar_cupo_actividad` | B/C: suites SQL | OK (emulación) | Local |
| Migraciones 27 → 28 → 29 → 30 en producción | `supabase db push` desde un checkout limpio con una sola migración pendiente cada vez; postflight por catálogo y md5 de las 37 tablas | **Ejecutado**, ver §10 | Producción, con autorización puntual por migración |
| Recorridos productivos tras cada gate (Vercel, cuentas ficticias autorizadas) | §10: ciclos alta/baja de Dirección y comprobaciones por rol con sesión real | **Ejecutado de forma acotada**; la prueba funcional completa por rol es de EPT-67 | Producción |
| Asistencias de menores: «alumno a cargo» del DOCENTE | Unidad D (`EPT-66/D-asistencias.md`): 151 comprobaciones SQL nuevas, 27 suites SQL y 15 concurrencias en el esquema final, E2E completa 1752/14/0 | **Implementada, probada en local y aplicada en producción**. El caso positivo del DOCENTE con vínculo no se probó en producción (ver §10) | Local y producción |
| Matriz transversal de seguridad | — | **No se declara completa**: no hay prueba funcional completa por rol en producción (EPT-67) y quedan los límites de §6 y §9 | Parcial |

## 6. Límites de esta ejecución (no ocultar)

* Las unidades se desarrollaron en sesiones **sin credenciales hacia el proyecto productivo**
  (Supabase `ycvrpmrogvjnntnoosbh`); la ejecución en producción (§10) se hizo después con la CLI 2.119.0
  enlazada al proyecto exacto. El MCP de Supabase conectado a la sesión pertenece a **otra cuenta** y no
  se usó.
* Las verificaciones previas se hicieron en el stack local (CLI 2.119.0, PostgreSQL 17.11; tipos con el
  generador oficial 2.117.0, GoTrue, PostgREST) con datos **sintéticos**. Los respaldos de restauración
  aislada usaron PostgreSQL 17.6. No sustituyen la prueba funcional completa en Production (EPT-67).
* WebKit: el perfil `iphone-13-webkit` corre en la E2E completa, pero con 5 omisiones por límites del
  navegador de pruebas (MediaStream y teclado físico).
* La paleta del PDF (RNF1) queda para revisión humana.
* El informe de auditoría local y `docs/orchestration/` no existen en este entorno; la lista exacta de
  «duplicados» del contrato manual de tipos no pudo contrastarse y no se retiró ninguno.

## 7. Asistencias de menores — decisión aprobada por Lucas

`public.asistencias` tenía las políticas «Staff consulta/registra/modifica asistencias» con
`rol_actual() IN ('DIRECTOR','DOCENTE')` y **sin vínculo con el alumno**: cualquier DOCENTE leía y
escribía las asistencias de cualquier menor, y la aplicación enviaba `docente_id` desde el navegador.

**Regla aprobada.** Un DOCENTE está a cargo de un alumno únicamente si el alumno tiene una matrícula
vigente en un curso con una materia asignada y activa a ese docente, o una inscripción activa en un
grupo deportivo activo que ese docente dicta. El docente no puede atribuir un registro de asistencia a
otro docente.

**Implementación.** Unidad D (`EPT-66/D-asistencias.md`, migración 30), separada de B y C y publicada
después de estabilizarlas. Aplicada en producción el 02/10/2026 a las 19:13 ART: desde entonces el
defecto está **cerrado** allí. La escritura de DOCENTE sobre inscripciones legadas quedó **cerrada** por
B y C (DOCENTE y PERSONAL reciben 42501). Entre el merge de la #38 (despliegue de Production) y la
aplicación de la 30 hubo una ventana en la que la pantalla de asistencias necesitaba una RPC aún
inexistente; ver §10.

## 8. Reversión

La unidad A no toca PostgreSQL: revertir sus commits en Git es suficiente y no afecta la base.
Para las unidades B, C y D, revertir Git **no** revierte PostgreSQL: se usan migraciones
compensatorias (ver `B-expansion.md` §8, `C-aplicacion-contraccion.md` §8 y `D-asistencias.md` §6).

## 9. Riesgos derivados

| Riesgo | Dueño |
|---|---|
| Datos ficticios, alta pública de Auth, recorridos reales de transporte, purgas | EPT-68 |
| Pruebas funcionales por rol y E2E completas contra producción | EPT-67 |
| Cuentas y datos ficticios de EPT-66 siguen en producción (4 cuentas `example.invalid`, 1 taller de cupo 1 con 6 inscripciones dadas de baja y 1 asistencia de prueba); se conservan sus historiales, sin DELETE físico | EPT-68 (purga) |
| Una corrección de asistencia no deja huella de quién la hizo (`D-asistencias.md` §5) | Aceptado el 02/10/2026; trazabilidad como mejora recomendada (migración futura) |
| Hallazgos heredados: `npm audit` 7 (1 crítica, 4 altas, 1 moderada, 1 baja); advisors de seguridad 3 INFO + 2 WARN y de rendimiento 10 INFO + 5 WARN; aviso de Next GHSA-vcvr-r3jv-pc5j (afecta 16.3.3, parche 16.3.6; no se observó la ruta afectada en las fuentes). No se corrigieron para no ampliar el alcance | Backlog |

## 10. Ejecución en producción (02/10/2026)

Supabase `ycvrpmrogvjnntnoosbh` (sa-east-1) y Vercel `metodologia-tpi` (alias
`metodologia-tpi.vercel.app`). CLI de Supabase 2.119.0, siempre desde un checkout limpio con una sola
migración pendiente. Cada migración tuvo su propio respaldo, restauración aislada, dry-run y
**autorización puntual de Lucas en el chat**; ninguna autorización cubrió otra migración.

### 10.1 Cronología

| Paso | Migración / SHA | Resultado |
|---|---|---|
| Ledger inicial | 27 (hasta `20261001165229`) | Lucas confirmó los 3 originales ACTIVO y 0 BAJA |
| 28 (expansión) | `20261002120000`, SHA256 `cec30f6a…a42`; PR #34 | Aplicada una vez, 02:57:13–02:57:17 ART, exit 0 |
| PR #36 (aplicación C) | `f32ce01` | Merge 02/10/2026 14:31 UTC; Production READY con ese SHA |
| Corrección de refresco de Cupos | PR #37 → `2751c31` (árbol idéntico al candidato `65ac1e3`) | Production READY; recorrido alta → baja verificado como Dirección con la lista abierta |
| 29 (contracción) | `20261002130000`, SHA256 `2081A4B4…D6BD` | Aplicada una vez, 15:33:52–15:33:57 ART (18:33 UTC), exit 0 |
| PR #38 (unidad D) | `fe07cd9` (árbol `3a5d38a9…` idéntico al candidato `1cdd703`) | Production READY (despliegue desde ~18:50 ART) |
| 30 (asistencias) | `20261002185033`, SHA256 `1C89422A…CA6E` | Aplicada una vez, 19:13:15–19:13:20 ART (22:13 UTC), exit 0 |

La ventana entre el despliegue de `fe07cd9` y la aplicación de la 30 (alrededor de 20 minutos) dejó la
pantalla de asistencias de producción dependiendo de una RPC aún inexistente. Es la ventana prevista
por el plan de unidades separadas (el código nuevo se despliega antes de la migración); no se revisó
la actividad de usuarios reales durante ese lapso.

### 10.2 Respaldos y postflight

Los respaldos son **lógicos y parciales**: esquema `public`/`app_private`/`auth`/`ledger`, datos de
`public`/`app_private`/`ledger` y roles/ACL suplementarios, restaurados de forma aislada y comparados
por grupo y por md5 de las 37 tablas. **No** incluyen datos de usuarios de Auth, Storage ni credenciales
de roles administrados: no son un respaldo integral de Supabase. Se guardan fuera del repositorio.

| Postflight | Resultado |
|---|---|
| 28 | Ledger 28; 3 originales ACTIVO, relaciones 3/3, huella `9d69719c…` intacta; `fecha_baja` nullable; índice parcial, CHECK, trigger y 14 funciones/ACL esperados |
| 29 | Ledger 29; md5 de las 37 tablas idéntico antes y después; 3 originales ACTIVO; 3 triggers de bloqueo habilitados; dry-run «al día» |
| 30 | Ledger 30; md5 de las 37 tablas idéntico antes y después (25 asistencias reales intactas); predicado, `registrar_asistencia` y `listar_estudiantes_para_gestion` presentes; 7 políticas de asistencias; `anon` sin EXECUTE; dry-run «al día» |

### 10.3 Recorridos en producción (cuentas ficticias autorizadas)

* **Cupos (Dirección, navegador):** con la corrección #37, alta con la lista abierta → 1/1 y alumno visible
  sin cerrarla; baja → 0/1. Repetido después de aplicar la 29: la baja es lógica y funciona.
* **Asistencias (Dirección, navegador):** la pantalla nueva carga y registra una asistencia PRESENTE
  del alumno ficticio A (1/1).
* **Asistencias, 17 comprobaciones con sesión real** (`anon key`, sin `service_role`): DOCENTE sin
  vínculo → 0 asistencias y 0 alumnos en el listado, `registrar_asistencia` denegada (`P6610`) e INSERT
  directo denegado (`42501`), con o sin `docente_id` ajeno; ESTUDIANTE A y PADRE ven solo lo propio o lo
  de su hijo vinculado y no pueden registrar; B no ve nada ajeno; sin sesión 401 y RPC `42501`. El
  conteo de `asistencias` fue 26 antes y después del smoke (la fila extra es la de Dirección).
* **Originales:** 3 ACTIVO y huella `9d69719c…` sin cambios tras cada paso.

**No probado en producción:** el caso positivo de un DOCENTE **con** vínculo vigente (no existen
datos académicos o deportivos ficticios para esa cuenta; se cubrió en local con las 6 suites nuevas y
la E2E por rol), `GET /api/asistencias` con sesión de DOCENTE por HTTP (se cubrió con las consultas con
el JWT de cada rol) y una sesión real de PERSONAL o de cuenta bloqueada. La prueba funcional completa
por rol en Production corresponde a EPT-67.

### 10.4 Verificación final de lo integrado

El árbol de `main` (`fe07cd9`, `3a5d38a9…`) es **idéntico** al del candidato D (`1cdd703`) sobre el que
corrió la batería completa en el esquema final (reset 0→30): E2E de todos los proyectos sin filtros
(1766 seleccionadas, 1752 aprobadas, 14 omitidas, 0 fallos, 0 flaky, 0 reintentos), 27 suites SQL
aplicables y 15 concurrencias con `FALLO=0`, `tsc`, `lint`, `build`, tipos, harness de producción y
negativo, DB lint y advisors. Para C, la batería sobre `65ac1e3` dio 1683 aprobadas, 14 omitidas y
0 fallos; un test (`usuarios-permisos-auth`, timeout en compilación en frío) pasó solo en el reintento y
no reprodujo en 3 repeticiones aisladas: se registra como **1 flaky**, no como 0. Con el ledger de
producción en 30 y las 14 omisiones conocidas (6 mediciones RF17 con `EPT_BENCH`, 1 QR sin clave de
firma, 1 menú de Reportes de cuenta bloqueada, 1 objetivo táctil solo móvil, 2 de MediaStream y 3 de
teclado físico en WebKit), el estado integrado queda verificado hasta donde se declara en §10.3.

### 10.5 Reversión (compensatoria)

Un rollback de Git **no** revierte PostgreSQL. Cada migración se deshace con una migración nueva
(`B-expansion.md` §8, `C-aplicacion-contraccion.md` §8, `D-asistencias.md` §6); las de contracción (29)
y vínculo (30) **no se recomiendan** porque reabren la lectura global de menores o la escritura de
asistencias por cualquier DOCENTE. Los respaldos permiten comparar o reconstruir datos de `public`, no
reconstruir usuarios de Auth.
