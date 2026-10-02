# EPT-66 — Integrar los módulos y normalizar las migraciones

> **Estado: EN CURSO.** Este documento se actualiza con cada unidad de entrega.
> Unidad A (PR técnico, sin migraciones) lista para revisión. Unidades B
> (expansión) y C (aplicación + contracción) **pendientes**. EPT-66 no se pasa a
> Listo hasta que ambas migraciones estén aplicadas y comprobadas en producción.

## 1. Línea base

| Dato | Valor |
|---|---|
| Repositorio | `gimenezl/MetodologiaTPI` |
| `origin/main` al iniciar | `2322ce58734dacb764e181fea55ee1a9d49d6720` |
| Rama de la unidad A | `codex/ept-66-integracion` |
| Migraciones en el repositorio | 27 (hasta `20261001165229_ept_65_correcciones_registro_accesos.sql`) |
| Ledger de producción informado | 27/27, hasta 20261001165229 — **no revalidado en esta sesión** (ver §6) |
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
| `tipos-generados.mjs` con ambos `autocrlf` | **no ejecutado**: requiere `supabase gen types --local` | No probado | — |
| 14 errores de lint | `npm run lint` exit 0 | OK | Local |
| tsc / lint / build exit 0 | ver §4 | OK | Local |
| `no-store` en `/api/hijos` | revisión de código; la prueba autenticada `hijos-auth` requiere base | **No probado en ejecución** | — |
| Capturas EPT-13 solo explícitas | suite completa sin diferencias en Git | OK | Local |
| Arnés SMTP | simulación con `npx` falso: falla con mensaje claro sin puerto o con puerto inválido | OK (simulado) | Local |
| RNF2 375×812 y 1280×800 | `responsive-regresion.spec.ts` (44 casos) | OK | Local |
| RNF1 paleta exacta del PDF | PDF de la Parte 2 no disponible | **No verificable** | Revisión humana pendiente |
| Privilegios, cupo, baja lógica, lectura global, asistencias | unidades B y C | **Pendiente** | — |

## 6. Límites de esta ejecución (no ocultar)

* El entorno es un contenedor Linux **sin Docker ni Supabase CLI** y con salida de red
  restringida: no hay stack local oficial de Supabase. Las pruebas autenticadas,
  `supabase db reset`, `db lint`, advisors y las suites `*-auth` **no se ejecutaron** aquí.
* El informe de auditoría (`E:\Escritorio\...\EPT-66-auditoria-y-contrato.md` y anexos) y
  `docs/orchestration/` **no existen en este entorno**; las afirmaciones se revalidaron
  contra el código actual, pero la lista exacta de pantallas sin perfil móvil y de
  «duplicados» del contrato manual de tipos no pudo contrastarse.
* No hay WebKit instalado: el perfil `iphone-13-webkit` no se ejecutó.
* Producción (Supabase `ycvrpmrogvjnntnoosbh`, Vercel): no se consultó ni se modificó nada.
* **Tipos manuales (`database.types.ts`)**: no se retiró ningún duplicado, porque sin la
  lista de la auditoría no se puede distinguir lo duplicado de lo que la aplicación
  importa. `database.generated.ts` sigue sin editarse.

## 7. Hallazgo de privacidad abierto — asistencias de menores

`public.asistencias` tiene las políticas «Staff consulta/registra/modifica asistencias»
con `rol_actual() IN ('DIRECTOR','DOCENTE')` y **sin vínculo con el alumno**: cualquier
DOCENTE lee y escribe las asistencias de cualquier menor. No existe un contrato que
defina «alumno a cargo»: `docs/evidence/EPT-9.md` §18.2 lo registra como «Sin contrato
reproducible», Jira no lo define y el PDF no estaba disponible. Por eso **no se corrige
dentro de esta unidad**: requiere una decisión de Lucas (ver la pregunta en el PR y en
Jira). Mientras siga abierto, la matriz transversal de seguridad **no** se declara
completa.

## 8. Reversión

Esta unidad no toca PostgreSQL: revertir sus commits en Git es suficiente y no afecta la
base. (Para las unidades B y C, revertir Git **no** revierte PostgreSQL: se usarán
migraciones compensatorias.)

## 9. Riesgos derivados

| Riesgo | Dueño |
|---|---|
| Datos ficticios, alta pública de Auth, recorridos reales de transporte, purgas | EPT-68 |
| Pruebas funcionales por rol y E2E completas contra producción | EPT-67 |
