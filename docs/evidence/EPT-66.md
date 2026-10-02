# EPT-66 — Integrar los módulos y normalizar las migraciones

> **Estado: EN CURSO.** Documento maestro; el detalle de cada unidad está en su archivo.
>
> | Unidad | Contenido | Evidencia | Estado |
> |---|---|---|---|
> | A | Correcciones técnicas sin migraciones | este archivo | **En `main`** (#33) |
> | B | Migración de **expansión** (28) + pruebas | `EPT-66/B-expansion.md` | **En `main`** (#34); **aplicación en producción pendiente** de preflight, respaldo y autorización puntual |
> | C | Aplicación nueva + migración de **contracción** (29) | `EPT-66/C-aplicacion-contraccion.md` | PR nuevo hacia `main`. La #35 se fusionó hacia `codex/ept-66-expansion`, **no** hacia `main` |
> | D | Asistencias: el DOCENTE solo ve y registra a sus alumnos a cargo (migración 30) | `EPT-66/D-asistencias.md` | Candidata separada; se publica tras estabilizar C |
>
> EPT-66 **no** pasa a Listo hasta que las tres migraciones estén aplicadas y comprobadas en
> producción, los recorridos autorizados pasen y no quede un defecto crítico de privacidad.
> «PR fusionado» **no** significa «desplegado en Production»: Vercel despliega la aplicación, pero
> PostgreSQL solo cambia con `supabase db push` y autorización puntual.

## 1. Línea base

| Dato | Valor |
|---|---|
| Repositorio | `gimenezl/MetodologiaTPI` |
| `origin/main` al iniciar | `2322ce58734dacb764e181fea55ee1a9d49d6720` |
| Rama de la unidad A | `codex/ept-66-integracion` |
| Migraciones en el repositorio | 27 (hasta `20261001165229_ept_65_correcciones_registro_accesos.sql`) |
| Ledger de producción informado | 27/27, hasta 20261001165229 — **no revalidado en esta sesión** (ver §6). Con la expansión (28) y la contracción (29) pendientes, el ledger esperado tras ambas es 29 y, con la unidad D, 30 |
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
| Migraciones 27 → 28 → 29 en producción | — | **No ejecutado** (requiere merge de Lucas y autorización puntual) | No probado |
| Recorridos productivos tras cada gate (Vercel, cuentas autorizadas) | — | **No ejecutado** | No probado |
| Asistencias de menores: «alumno a cargo» del DOCENTE | Unidad D (`EPT-66/D-asistencias.md`): 82 verificaciones SQL, concurrencia en los 2 órdenes de 4 revocaciones, 12 casos de API/navegador por rol | Regla aprobada e **implementada y probada en el stack local**; **sin aplicar en producción** | Pendiente de despliegue |
| Matriz transversal de seguridad | — | **No se declara completa** hasta aplicar la unidad D y comprobar los recorridos productivos | Pendiente |

## 6. Límites de esta ejecución (no ocultar)

* La sesión de desarrollo **no tiene credenciales ni salida de red hacia el proyecto productivo**
  (Supabase `ycvrpmrogvjnntnoosbh`): el ledger remoto, el preflight, el respaldo y la aplicación de las
  migraciones 28, 29 y 30 **no se pudieron ejecutar** y requieren a Lucas. El MCP de Supabase conectado
  a la sesión pertenece a **otra cuenta** y no demuestra el estado de este proyecto: no se usó.
* Las verificaciones se hicieron en el stack local oficial (CLI 2.117.0, PostgreSQL 17.6, GoTrue,
  PostgREST) con datos **sintéticos**. No sustituyen los recorridos autenticados en Vercel Production.
* No hay WebKit instalado: el perfil `iphone-13-webkit` no se ejecutó.
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
después de estabilizarlas. Hasta que se aplique en producción, el defecto sigue **abierto** allí.
La escritura de DOCENTE sobre inscripciones legadas quedó **cerrada** por B y C (DOCENTE y PERSONAL
reciben 42501).

## 8. Reversión

La unidad A no toca PostgreSQL: revertir sus commits en Git es suficiente y no afecta la base.
Para las unidades B, C y D, revertir Git **no** revierte PostgreSQL: se usan migraciones
compensatorias (ver `B-expansion.md` §8, `C-aplicacion-contraccion.md` §8 y `D-asistencias.md` §6).

## 9. Riesgos derivados

| Riesgo | Dueño |
|---|---|
| Datos ficticios, alta pública de Auth, recorridos reales de transporte, purgas | EPT-68 |
| Pruebas funcionales por rol y E2E completas contra producción | EPT-67 |
