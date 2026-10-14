# CI acotado por pull request

Cada PR comprueba tipos, lint, pruebas puras, build y cuatro recorridos públicos. Luego ejecuta contratos DB y UI focal **en paralelo**, si el registro de impacto los requiere. `CI / gate` siempre aparece; resultados faltantes, cancelados, fallidos o saltados indebidamente lo dejan rojo. No existe una matriz completa automática por cambios compartidos ni por push a main.

## Presupuesto nativo EPT-105

**Estado medido del PR #57:** [38455446859](https://github.com/gimenezl/MetodologiaTPI/actions/runs/38455446859), head `b31961e2502156871baae69836e9d16712460d4a`, árbol `6d34ef0c32fa7c3b03b04f016803e28565911db5`, merge ref `c8191f442248badc8766026477c44394274af1ab`: supervisor **12/12 Linux y 12/12 macOS**; Brew 51.6s; VM timeout 300.4s; cleanup Colima timeout 45.3s. Backend, fixtures/Auth y Xcode/Maestro **no se ejecutaron**. Artifacts [iOS `11843191236`](https://github.com/gimenezl/MetodologiaTPI/actions/runs/38455446859/artifacts/11843191236) y [Linux `11842190695`](https://github.com/gimenezl/MetodologiaTPI/actions/runs/38455446859/artifacts/11842190695) conservados. La etiqueta diagnóstica y el draft permanecen; ningún merge ni cierre de Jira está autorizado por esta evidencia.

Colima 0.10.3 dispone de un reinicio de VM para aplicar acceso del grupo Docker cuando falla `docker info` sin root; el log es compatible, pero no demuestra un crash/deadlock. Lima 2.2.0 desacopla el hostagent mediante otro grupo y permite hasta tres minutos de shutdown QEMU: el daemon escapó al grupo del CLI y Actions lo eliminó como orphan al finalizar. **El cleanup real todavía falla**; no se declara resuelto por las pruebas del supervisor. Fuentes, tiempos y límites: [segundo diagnóstico](evidence/EPT-105.md#segundo-diagnóstico-supervisor-probado-infraestructura-todavía-bloqueada).

**Cambio autorizado posteriormente:** el usuario aprobó únicamente iOS en `macos-15` ARM64 y backend nativo real sin VM. El candidato local usa archivos experimentales oficiales de [Supabase Slim Services](https://github.com/supabase/slim-services), no un paquete `@supabase/stack` privado ni un flag inventado de la CLI. Android conserva exactamente su job Docker/CLI. No se ha ejecutado todavía este backend ni un build ARM: revisión independiente y diagnóstico siguen pendientes.

`native-services.lock.json` fija PostgreSQL 17.6.1.167, Auth v2.196.0-r0, PostgREST v16.2-r0 y Storage v1.72.1 por commit fuente y SHA-256 de archive, manifest y SHA256SUMS. Se revalida la caché y se extrae en un directorio privado nuevo; solo se cachean archivos oficiales inmutables, nunca bases, fixtures, claves ni sesiones. El bootstrap original `supabase-postgres-start` precede a GoTrue; Storage ejecuta su entrypoint upstream `app/dist/scripts/migrate-call.js` (v1.72.1 no contiene `bin/prepare`), antes de las 37 migraciones del proyecto sin omisiones ni tablas sustitutas. Backend y contratos Auth/RLS existentes deben aprobar antes de pods/Xcode.

Servicios y proxy SDK escuchan exclusivamente en loopback. El proxy conserva Authorization recibido: una apikey service-role no se convierte en Bearer privilegiado. Claves/passwords aleatorios permanecen en estado privado fuera de artifacts; solo anon llega al build. Cada servicio es hijo foreground de un worker con grupo propio, UID, instante de inicio y comando ligado al directorio del run. Cleanup valida identidad antes de TERM/KILL y comprueba ausencia de miembros vivos; symlinks, PID reciclado o stack ajeno fallan sin señalarlos. El watchdog retira el grupo al vencer el deadline operativo aunque se interrumpa el coordinador. Evitar Colima no demuestra por sí solo cleanup: se exige prueba POSIX y diagnóstico nuevo.

### Diagnóstico previo explícito, sin aprobación de entrega

La etiqueta de PR **`ci:ios-infrastructure-diagnostic`** opta por una corrida acotada: primero supervisión/negativas en Ubuntu (3 minutos), después archivos oficiales, backend nativo, migraciones y Auth real en `macos-15` ARM64 (12 minutos, 10 operativos). No instala dependencias de la aplicación ni ejecuta Xcode/Maestro. Los jobs completos se omiten y **`CI / gate` falla explícitamente incluso si el diagnóstico aprueba**. No modifica branch protection ni permite cerrar Jira.

Para el PR existente: aplicar la etiqueta antes del primer push del candidato revisado; `synchronize` ejecuta el workflow del merge ref nuevo. Tras inspeccionar los artifacts, retirar la etiqueta dispara `unlabeled` y ejecuta los checks completos del mismo candidato. No se depende de `workflow_dispatch` disponible en la rama predeterminada. Se mantienen los eventos normales `opened`, `synchronize`, `reopened` y push a main; se agregan `labeled`, `unlabeled`, `ready_for_review`. Las etiquetas deben aplicarse con una credencial humana autorizada: eventos producidos por `GITHUB_TOKEN` no son un mecanismo fiable para lanzar otra corrida. Fuente: [eventos GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

No repetir un diagnóstico que falla sin inspeccionar primero la evidencia. Registrar head y merge ref de cada corrida; un diagnóstico saludable no equivale a login nativo ni a aceptación. La etiqueta no se aplica ni se retira automáticamente desde CI.

Android e iOS conservan build **y ejecución de login real** contra PostgreSQL/GoTrue/PostgREST/RLS; el gate exige SUCCESS de ambas plataformas. Los jobs tienen techo de 30 minutos y presupuesto operativo común de 28 minutos, con cleanup independiente. El objetivo de 20–25 minutos con caché requiere medición; no se garantiza para una ejecución fría.

`scripts/ci/run-stage.py` crea un grupo POSIX por comando, transmite progreso saneado y cada 30s registra etapa, tiempo, arquitectura, carga, RSS/CPU de herramientas (sin argv/entorno) y disco disponible. En Supabase registra solo contenedores `ept105-`. Al vencer el deadline, recibir cancelación o quedar descendientes tras salir el líder, conserva diagnóstico y termina el grupo con TERM/KILL acotados; propaga códigos de fallo. Los daemons de servicio tienen teardown explícito: nunca se detiene el Colima por defecto ni un stack de otro run.

| Etapa | Deadline propio |
|---|---:|
| Instalador Supabase aislado/fijado `2.117.0` | 90s |
| Archivos nativos iOS | 240s total, 90s por archivo |
| Extracción confinada iOS | 60s |
| Readiness PG / Auth / Storage / REST / proxy | 120s / 60s / 30s / 30s / 10s |
| Migraciones upstream Storage / 37 SQL del proyecto | 90s / 90s |
| Supabase Docker Android start / status | 240s / 30s |
| Contratos Auth reales y fixtures | 210s |
| npm iOS / prebuild+pods | 120s / 240s |
| Xcode o Gradle | 720s |
| simctl boot / bootstatus / install | 30s / 120s / 60s |
| adb wait-for-device / install | 60s / 60s |
| Maestro | 240s (driver iOS 120s) |
| Supabase Android stop / workers iOS cleanup | 60s / 45s, fuera del presupuesto operativo |

Se selecciona un UDID disponible en `macos-15` ARM64; build de integración Release solo arm64 y comprobación `lipo` antes de instalar. No cambia soporte productivo. CocoaPods cachea descargas/repos, invalidado por OS, arquitectura, Xcode/SDK, configuración, lockfiles y plugins; no se cachean DerivedData/bundles, credenciales, sesiones ni fixtures. Android instala la CLI aislada sin `npm ci` web; iOS no usa CLI Docker. Los artifacts se redactan antes de subirlos y después del cleanup.

Las nuevas suites `native-backend.test.py` e `install-native.test.mjs` cubren procedencia, caché corrupta, extracción confinada, identidad/stack ajeno, árbol bloqueado y proxy sin elevación. Sus fixtures de transporte son unitarios, no reemplazan Auth real. El candidato posterior al diagnóstico ARM tiene 18 casos nativos: Windows aprobó 14 y omitió 4 POSIX; instalador 4/4 PASS del árbol anterior. No se afirma bootstrap ARM ni cumplimiento del presupuesto frío.

**Corrección acotada de revisión:** el arranque Auth exige el workdir correspondiente al backend elegido, sin aceptar el de CLI como sustituto del nativo ni viceversa. Tras completar readiness se publican únicamente `EPT_MOBILE_AUTH_INTEGRATION=1`, URL loopback y clave anon para el build; service-role/passwords permanecen privados. La regresión ejecuta la entrada de status/guard existente con el entorno emitido, rechaza workdir/owner incorrectos y comprueba que readiness fallido no publica variables del build. El startup simulado de esta prueba es unitario, no evidencia de migraciones ni Auth alojado.

**Primer diagnóstico ARM:** [38488688431](https://github.com/gimenezl/MetodologiaTPI/actions/runs/38488688431), head `1eeb0a413a127adf55f68d9b57ded119c3516437`, árbol `1c93550f85b117b8259caeb6f0b240ce02d60d45`, merge ref `64fad1a3954335608bebc24e6a7c4b18e625926d`. Linux: supervisor 12/12 y nativo 14/14; ARM: supervisor 12/12 y nativo 13/14, rechazo de identidad antes del backend. Actions retiró dos procesos Python del fixture como orphans; el cleanup posterior fue no-op, no prueba de cierre de servicios. No se ejecutaron descargas, bootstrap, migraciones, Auth ni Xcode/Maestro.

La corrección local verifica el ejecutable de kernel mediante `proc_pidpath` en Darwin (`/proc/<pid>/exe` en Linux), comparándolo con el intérprete real del supervisor, además de PID/UID/PGID/inicio y argumentos exactos del worker. Solo admite el prefix literal del launcher o del intérprete confiable; no aprende un ejecutable permitido de argv ajeno. [CPython 3.14.7](https://github.com/python/cpython/blob/v3.14.7/Mac/Tools/pythonw.c) reescribe argv[0] a Python.app preservando PID: la comparación anterior contra sys.executable rechazaba ese caso válido. Es un defecto reproducido por fuente/prueba unitaria, **no identificación probada del campo concreto de la corrida**. Las nuevas negativas rechazan ejecutable, UID, PID/PGID, inicio o ruta ajenos, con diagnóstico que solo enumera campos. Los fixtures retienen sus Popen propios antes de verificar y hacen TERM/KILL/readback/reap incluso al fallar la admisión; su prueba POSIX sigue pendiente. [Evidencia y fuentes](evidence/EPT-105.md#primer-diagnóstico-arm-identidad-rechazada-antes-del-backend).

Checks rápidos: `python3 scripts/ci/run-stage.test.py` en **Linux y macOS** (padre/nieto bloqueado, líder que sale antes, supervisores anidados, TERM/KILL y proceso ajeno intacto); `node --test mobile/scripts/stack-isolation.test.mjs` (stack ajeno y ownership de otro run); `node --test scripts/ci/impact.test.mjs` (incluye negativas del gate y rechazo incondicional del diagnóstico parcial). Windows omite explícitamente tres casos POSIX: no equivale a PASS nativo. El supervisor anidado completa TERM/KILL con una gracia menor que la del ancestro para no abandonar su grupo al morir el padre. Diagnóstico previo, causas históricas, SHA de head/merge ref, resultados medidos y rollback: [evidencia EPT-105](evidence/EPT-105.md). No se ejecuta la matriz completa web como rutina.

**Corrección posterior a revisión:** se admiten como máximo **dos niveles de supervisor** (etapa exterior y CLI/status interior). Un tercer nivel se rechaza antes de crear proceso/sesión; no comparte una gracia de cleanup que pueda abandonar otro grupo. La topología actual de los scripts cumple ese límite. La redacción reconoce las familias `sb_secret_` y `sb_publishable_` aunque no estén en variables de entorno, tanto en salida en vivo como en artifacts JSON/tablas. La suite actual contiene nueve pruebas: cuatro aprobadas en Windows y **cinco POSIX omitidas**, pendientes de ejecución Linux/macOS; esta cuenta reemplaza la fotografía anterior de tres casos omitidos.

Tras el primer diagnóstico, Linux aprobó las nueve pruebas; macOS detectó EPERM en el sondeo `killpg(..., 0)` y **no llegó a iniciar infraestructura**. La corrección trata ese sondeo como inconcluso, conserva KILL y verifica únicamente PGID/estados del grupo propio. No confunde zombie con proceso vivo ni oculta una denegación de TERM/KILL con miembros vivos: cleanup inaccesible o incompleto falla con código 125. La suite agrega tres regresiones inyectadas (12 pruebas; siete aprobadas y cinco POSIX omitidas en Windows). Los artifacts de diagnóstico ahora incluyen los logs saneados de fixtures y el resumen del smoke incluso al fallar. Resultados, SHA y fundamento Apple: [evidencia EPT-105](evidence/EPT-105.md#primer-diagnóstico-y-corrección-específica-de-eperm).

| Comprobación | Alcance real | Límite del job |
|---|---|---|
| Rápida | Tipos, lint, puras, build, smoke público Chromium | 8 min |
| Contratos | Stack nuevo: 29 SQL y 30 scripts API/paridad/concurrencia; tipos reproducibles | 12 min |
| UI focal | Archivos de familias afectadas, Chromium y actores reales; core mínimo compartido | 8 min |

Estos son presupuestos que fallan al agotarse, no duraciones garantizadas. La última ejecución midió rápido 2m12 y contratos previos a UI aproximadamente 7m29; todavía falta medir el nuevo candidato Linux. Docker y fixtures no se comparten entre jobs. No se repite una matriz larga localmente y en GitHub sin una causa concreta.

## Selección y cobertura

`scripts/ci/impact.mjs` combina ambos lados de renombres y todas las familias modificadas. `scripts/ci/ui.mjs` declara familias y archivos reales; `scripts/ci/suites.mjs` conserva SQL/API, carreras, roles de ejecución y exclusiones operacionales. Documentación y puras conocidas no requieren Docker. Migraciones, dependencias, CI y auth compartida requieren contratos reales más core UI, **no 1957 casos**. Mutaciones de facturación se ejecutan al modificar su script y siempre en la matriz completa.

El core incluye seed y login DIRECTOR, banco niveles, todos los endpoints sin sesión (401), PERSONAL (403) y DIRECTOR bloqueado con JWT vigente. La UI familiar conserva positivas y negativas de sus archivos en los proyectos Chromium aplicables; no afirma cobertura móvil. El reporter exige casos no-setup, todos los archivos solicitados y los cuatro proyectos core, y rechaza ejecuciones incompletas u omisiones inesperadas. Cada archivo focal debe ejecutar al menos una comprobación. `--list` valida la selección antes de ejecutar.

Una ruta, suite o paquete mobile/Expo/React Native sin contrato bloquea el plan: registrar comprobaciones reales antes de integrar. No se concede un PASS web a mobile. Desde EPT-102 el único paquete móvil registrado es `mobile/` (ver «Aplicación móvil»); cualquier otro paquete con Expo o React Native, y cualquier archivo de `mobile/` fuera de `scripts/ci/mobile.mjs`, sigue bloqueando. Los helpers de producción/preflight/carga/replay histórico no se ejecutan por extensión; sus cambios requieren un contrato seguro específico. Pruebas de captura y responsive exclusivas siguen en la matriz completa; cambiarlas exige registrar su gate aplicable, no sustituirlo por un smoke ajeno.

## Aplicación móvil

`scripts/ci/mobile.mjs` registra, con patrones literales, los archivos permitidos bajo `mobile/`. `impact.mjs` marca `mobile=true` cuando cambia `mobile/`, `src/lib/errores.ts` o `src/types/database.generated.ts` (que la app copia de la web) o la infraestructura que decide cómo se prueba (`ci.yml`, `impact.mjs`, `impact.test.mjs`, `mobile.mjs`). Con plan móvil, `CI / gate` exige **los tres** jobs; un skip obligatorio lo deja rojo.

| Job | Qué prueba | Límite |
|---|---|---|
| `CI / plan móvil` | Evalúa el plan sin esperar al job `fast` | 5 min |
| `CI / móvil` | `npm ci`, copia compartida sin deriva, importaciones prohibidas y secretos, `expo install --check`, `expo-doctor`, tipos, lint, Jest y `node:test`, bundles Android e iOS y su escaneo | 20 min |
| `CI / móvil Android` | `prebuild`, `assembleRelease` (x86_64), instalación en emulador API 34 y flujo Maestro | 30 min |
| `CI / móvil iOS` | `prebuild` con pods, `xcodebuild` Release arm64 para simulador seleccionado y flujo Maestro (`macos-15` ARM64) | 30 min |

Exportar bundles, Expo web o compilar TypeScript no demuestra un APK ni una aplicación iOS: por eso los builds y la ejecución son parte del gate. Los artefactos (`movil-android-<sha>`, `movil-ios-<sha>`) se conservan 14 días con logs, capturas y resultados JUnit. No se ejecutan los E2E web ni la matriz completa por cambios móviles.

## Omisiones de aplicabilidad

`scripts/ci/omissions.mjs` registra archivo, proyecto, título y motivo exactos originales: casos solo móviles en Chromium; teclado o MediaStream ausentes en WebKit táctil; menú inaccesible para cuentas bloqueadas; último Director no alcanzable con el fixture compartido; servidor QR sin clave separado y benchmark opt-in. Estos dos últimos no se certifican ni se habilitan por rutina. Los resúmenes enumeran omisiones y casos ejecutados; setup omitido, título/motivo nuevo, fixture Director ausente, timeout o unexpected pass fallan. Los expected failures originales se contrastan con su resultado real. La prueba de benchmark conserva su ejecución especializada fuera del foco PR: cambiarla exige registrar ese gate específico.

## Matriz completa y release

`full.yml` se ejecuta manualmente o los domingos 06:00 UTC (03:00 Argentina), nunca por PR. Conserva los 17 proyectos terminales originales, con setup cuando corresponde y stack nuevo por proyecto; máximo cuatro jobs UI concurrentes, 30 min por job y 20 min de Playwright. No elimina casos ni assertions. Contratos y mutaciones corren en un job independiente. Un proyecto cancelado, incompleto o sin casos invalida `Matriz completa / gate`.

Antes de release, ejecutar esta matriz sobre la revisión exacta y comprobar su gate; un resultado programado de otro SHA no certifica el release. El conjunto actual tenía 1957 casos antes de separarlo; 1936/31,5 minutos es evidencia histórica de EPT-103. La suma separada puede repetir setup y no debe presentarse como el mismo número sin medirla.

## Seguridad y diagnóstico

- CLI 2.117.0 fuera de las dependencias de la aplicación; `npm ci` y versiones contrastadas con el lock. Runner exclusivamente GitHub Linux desechable, sin enlaces ni secretos remotos, reset sin seed, Mailpit local.
- Solo se conservan resúmenes saneados de SHA, selección, duración y estado; no claves, JWT, `.env`, sesiones ni traces. Se intenta retirar únicamente el stack propio y siempre restaurar config, preservando errores de ejecución y cleanup.
- Run 37847128039: rol SQL incorrecto. Run 37848873378: fixture docente anterior al vínculo de EPT-66 D. Se corrigieron el runner y fixture, sin rebajar controles ni permisos.
- Run 37877809753: Next bloqueó assets desde 127.0.0.1; UI usa localhost y `--max-failures=1`. Run 37885748022: shutdown sin resumen final después de 1613/1957; no hay prueba de una assertion fallida ni de su causa. El helper SQL sin timeout era una hipótesis: ahora tiene lock timeout 5s, statement timeout 15s y timeout del hijo 20s, solo en pruebas.
- La protección de main debe requerir GitHub Actions `CI / gate`, no solo Vercel. La configuración remota es una operación separada.

## Comprobación local económica

Run 37935327938: rápidas y DB verdes; el presupuesto UI interno de seis minutos agotó el wrapper antes del cierre de sus hijos y el cleanup retiró la base mientras seguían pruebas. No fue un defecto de permisos. El presupuesto interno pasa a siete minutos (job de ocho intacto, Playwright cinco); GNU timeout envía TERM al grupo y KILL tras cinco segundos antes del cleanup. La regresión usa un árbol real de procesos sin Docker y mantiene el error original y `timedOut` explícito.

El límite cubre el grupo de procesos, no descendientes que crean otro grupo detached: algunos arneses DB lo hacen. Playwright solicita cierre gradual de sus procesos externos, pero no se garantiza ante un escape detached. Un timeout conserva status y señal crudos, falla el job y mantiene el teardown del runner efímero como límite final; no certifica cierre completo de todos los descendientes.

`node --test scripts/ci/impact.test.mjs`, `npx tsc --noEmit` y lint focal. Se permite listar Playwright sin ejecutar fixtures. La primera ejecución Linux verificará los presupuestos y el comportamiento real; no declarar verde una comprobación todavía no ejecutada.

## Paquete de diseño EPT-95

`scripts/ci/ept95-assets.mjs` registra de forma literal cada ruta de `docs/parte3/EPT-95/`: 44 PNG de diseño, 44 HTML fuente, hoja de estilos, dos módulos de render, cinco fuentes woff2, licencias, logo, receta, manifest, bitácora, tres documentos y el histórico Stitch (33 PNG, su manifest y su recuperación). No hay excepción por extensión: una ruta del directorio que no figura en el registro bloquea el plan, y `profile(paths, { root })` valida el paquete completo una vez antes de clasificar cualquiera de sus rutas. Cambiar el propio validador también valida el paquete real. El parámetro `root` solo permite fixtures aislados.

| Contenido | Naturaleza | Comprobación concreta |
|---|---|---|
| `disenos/**/*.png` | Imagen | Firma y chunks PNG, CRC, zlib acotado, filtros, lienzo de 780 px de ancho (390 CSS × 2) y alto mínimo 1688, SHA-256 y dimensiones contra el manifest |
| `fuentes/html/*.html` | **Activo/mixto** | Lista cerrada de etiquetas y atributos con valores acotados, comillas dobles, entidades solo `&amp; &lt; &gt;`, anidación válida, un único `link` a `../estilos.css`, `src` solo al logo, `<style>` solo con `--escala`; el `<title>` debe empezar con el ID de la pantalla registrada |
| `fuentes/estilos.css` | **Activo/mixto** | Sin escapes, `@import`, `image-set`, `expression` ni URLs; solo `@font-face`; `url()` exclusivamente a los cinco woff2 registrados |
| `fuentes/pantallas.mjs`, `fuentes/render.mjs` | **Activo** | Especificadores estáticos reconocidos en lista cerrada (cualquier otra aparición de `import` o `from '…'` bloquea) y lista negra de mejor esfuerzo sobre texto: sin `child_process`, red, `eval`, `Function`, `constructor`, borrado, `process` salvo `argv`, `exitCode` y `EPT95_PLAYWRIGHT`, ni escapes `\u`/`\x`, acceso por corchetes con literal ni concatenación en corchetes. Las palabras de la lista negra bloquean también en comentarios. No es una barrera de seguridad: el generador se revisa a mano antes de ejecutarlo |
| woff2, logo | Binario | woff2: firma y longitud declarada; logo: PNG decodificado; ambos con hash |
| `receta-render.json`, `manifest.json` | Datos | Manifest: esquema cerrado. Receta: claves requeridas (línea base, renderizador Playwright/Chromium, viewport, factor, comandos en lista cerrada), idéntica a la copiada en el manifest; ambos pasan además el escaneo de texto y de secretos |

El manifest v5 declara `metodo: diseno-local` y, por diseño, la fuente HTML con su SHA-256 (los HTML se normalizan a LF antes del hash para que `core.autocrlf` no invalide el manifest). Cualquier otro origen, por ejemplo un ID Stitch inventado, falla con `E_ORIGIN`. La escala de texto declarada debe coincidir con la fuente y con el estado «Texto 200%». El histórico Stitch se valida solo como integridad y procedencia (`E_HISTORIC`, `E_STITCH_ID`, `E_SHA`): su estado debe decir «rechazado» y `device_type` debe ser coherente con el lienzo exportado (MOBILE si el ancho es de 1440 px o menos); nunca cubre un criterio. La cobertura exige nueve áreas con wireframe y mockup, los cuatro estados de cuota, estados de carga, vacío, error, validación y confirmación, y los actores PADRE, ESTUDIANTE, otro padre vinculado, DIRECTOR, DOCENTE y PERSONAL.

**Qué no garantiza.** Los HTML, CSS y módulos no se ejecutan en CI: el render (Chromium) es una operación manual documentada en el README del paquete. Que no se ejecuten no los convierte en documentación pasiva; por eso tienen análisis propio y sus hashes quedan atados al manifest. El HTML se acepta por lista cerrada, pero el análisis de los módulos es una lista negra de mejor esfuerzo sobre texto: la protección real es que no corren en CI y que cualquier cambio exige revisión. CI **no vuelve a renderizar**: verifica que cada PNG sea una imagen móvil bien formada con el hash declarado, no que sus píxeles provengan de su HTML (la correspondencia depende del render manual y de la revisión de las imágenes), y los estados declarados se comprueban por cobertura, no leyendo cada imagen. Ningún escáner certifica ausencia de datos personales en píxeles ni corrección visual o económica: eso lo cubre la revisión independiente de las imágenes finales. Cambiar `scripts/ci/` sigue exigiendo DB y UI core; el paquete de diseño por sí solo no toca producto y su selección es `db=false`, `ui=[]`.

Negativas cubiertas por `node --test scripts/ci/impact.test.mjs` con códigos específicos: FIFE disfrazado de PNG y JPEG renombrado (`E_PNG_SIGNATURE`), PNG truncado, hash incorrecto (`E_SHA`), dimensiones declaradas falsas (`E_DIMENSIONS`), lienzo de escritorio o sin factor 2 (`E_MOBILE_CANVAS`), origen inventado (`E_ORIGIN`), fuente ausente (`E_SOURCE_MISSING`), hash de fuente alterado (`E_SOURCE_HASH`), recurso o directorio desconocido (`E_UNKNOWN_RESOURCE`), falta de un diseño (`E_PACKAGE`), área reasignada o escala incoherente (`E_MANIFEST`), faltas de estados o actores (`E_STATES_COVERAGE`, `E_ROLES_COVERAGE`), contenido activo (`E_ACTIVE_HTML`, `E_ACTIVE_CSS`, `E_ACTIVE_MODULE`: eventos, comillas simples, entidades, `svg/onload`, `meta refresh`, importaciones laterales y reexportaciones, imports tras `;` o comentarios, `eval` indirecto, alias de `process`, `process['env']`, `constructor`, `rm`), fuente tipográfica inválida (`E_FONT`), receta ajena (`E_RECIPE`) y un histórico presentado como aceptado o con dispositivo incoherente (`E_HISTORIC`). Una prueba valida además el paquete real del repositorio. También se prueban CSV, secretos, modos Git ejecutables y enlaces simbólicos (los casos de filesystem Linux no se presentan como prueba nativa en Windows).

Los originales Stitch saneados del histórico siguen derivándose con `deriveEpt95Png` (retiro de un único `zTXt` Raw profile type APP1, píxeles RGBA idénticos).

## Prototipo navegable EPT-96

`scripts/ci/ept96-assets.mjs` registra de forma literal cada ruta de `docs/parte3/EPT-96/` (documentos, bitácora, receta, `index.html`, `estilos.css`, seis módulos del navegador, servidor, runner y 47 capturas PNG). A diferencia de EPT-95, el prototipo **se ejecuta**: el HTML carga un módulo JavaScript y el runner levanta un servidor Node. Por eso nunca se trata como documentación pasiva ni recibe una excepción por extensión: una ruta del directorio que no figura en el registro bloquea el plan (`Ruta EPT-96 sin contrato`), y `profile(paths, { root })` valida el paquete completo antes de clasificar cualquiera de sus rutas.

| Contenido | Naturaleza | Comprobación concreta |
|---|---|---|
| `prototipo/index.html` | **Activo** | Lista cerrada de etiquetas y atributos con valores acotados; exactamente un `script` (`type="module"`, `src="/js/app.mjs"`) sin contenido en línea, una hoja de estilos y un ícono locales; sin `style`, eventos, `iframe` ni recursos externos (`E_ACTIVE_HTML`) |
| `prototipo/estilos.css` | **Activo/mixto** | Sin `@import`, escapes ni URLs externas; `url()` solo a las cinco fuentes de `/activos/`; solo `@font-face` y `@media (prefers-reduced-motion)` (`E_ACTIVE_CSS`) |
| `prototipo/js/*.mjs` | **Activo** | Importaciones solo entre los seis módulos; sin `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function`, import dinámico, almacenamiento, cookies, `FileReader`, `<input type="file">`, `innerHTML`/`insertAdjacentHTML`, `window.open`, `location.href`, estilos en línea ni ofuscación léxica (`E_ACTIVE_BROWSER`) |
| `servidor/servidor.mjs`, `pruebas/prototipo.mjs` | **Activo** | Importaciones en lista cerrada; sin `child_process`, red saliente, escritura o borrado de archivos ni `process` salvo `argv`, `exitCode`, `exit`, `on` y `EPT96_PLAYWRIGHT`; el servidor debe resolver por tabla cerrada (`RUTAS.get(req.url …)`), validar `Host`, escuchar en `127.0.0.1` y fijar CSP; el runner debe conservar sus 31 pruebas obligatorias, el límite de tiempo y el cierre en `finally` (`E_ACTIVE_NODE`) |
| `evidencia/*.png` | Imagen | Firma, chunks, CRC, zlib acotado, 390 px de ancho (factor 1) y sin metadatos de texto (`E_PNG_*`) |
| Documentos, CSV, receta | Datos | UTF-8, sin secretos ni marcado ejecutable; CSV de ocho columnas; comandos de la receta en lista cerrada (`E_TEXT`, `E_RECIPE`) |

**Ejecución real.** Cuando el plan incluye `prototipo=true`, el job `CI / rápido` ejecuta `node docs/parte3/EPT-96/pruebas/prototipo.mjs` con el Chromium que ya instaló para el smoke público (límite de 5 min del paso; el runner tiene 4 min propios). El plan marca `prototipo` ante cambios en `docs/parte3/EPT-96/`, en las fuentes tipográficas y el logo de EPT-95 que el servidor sirve, y en `scripts/ci/impact.mjs`, `impact.test.mjs`, `ept96-assets.mjs`, `.github/workflows/ci.yml`, `package.json` y `package-lock.json`. Como el resto de los cambios en `scripts/ci/`, estos exigen además contratos DB y UI core. Un paquete que solo cambia documentación o capturas del prototipo ejecuta el runner y ningún contrato DB (`db=false`, `ui=[]`).

**Qué no garantiza.** El runner demuestra comportamiento en Chromium sobre datos ficticios; no prueba ejecución nativa en Android o iOS, TalkBack, VoiceOver ni autorización productiva (RLS). Los escáneres de texto son una lista negra de mejor esfuerzo: la barrera real es la ejecución bajo CSP estricta, con red bloqueada y verificada por la prueba N13b (cero solicitudes externas, cero violaciones de CSP, cero errores de consola). La evidencia PNG no se regenera en CI: se valida su forma, y la revisión independiente inspecciona las imágenes.

Negativas cubiertas por `node --test scripts/ci/impact.test.mjs`: HTML con script en línea o externo, segundo script, eventos, `iframe`, `style`, `meta refresh` y entidades; CSS con importación, URL remota o no registrada, escapes y `image-set`; 23 variantes de módulos del navegador; 12 variantes del servidor y del runner (incluidas las negativas retiradas, la ruta unida a la URL y la falta de cierre en `finally`); PNG con firma falsa, truncado, de otro ancho o con metadatos; archivos o directorios extra; documentos con secretos o marcado; y receta con comandos ajenos.
