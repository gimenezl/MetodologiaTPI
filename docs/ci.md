# CI acotado por pull request

Cada PR comprueba tipos, lint, pruebas puras, build y cuatro recorridos públicos. Luego ejecuta contratos DB y UI focal **en paralelo**, si el registro de impacto los requiere. `CI / gate` siempre aparece; resultados faltantes, cancelados, fallidos o saltados indebidamente lo dejan rojo. No existe una matriz completa automática por cambios compartidos ni por push a main.

| Comprobación | Alcance real | Límite del job |
|---|---|---|
| Rápida | Tipos, lint, puras, build, smoke público Chromium | 8 min |
| Contratos | Stack nuevo: 29 SQL y 30 scripts API/paridad/concurrencia; tipos reproducibles | 12 min |
| UI focal | Archivos de familias afectadas, Chromium y actores reales; core mínimo compartido | 8 min |

Estos son presupuestos que fallan al agotarse, no duraciones garantizadas. La última ejecución midió rápido 2m12 y contratos previos a UI aproximadamente 7m29; todavía falta medir el nuevo candidato Linux. Docker y fixtures no se comparten entre jobs. No se repite una matriz larga localmente y en GitHub sin una causa concreta.

## Selección y cobertura

`scripts/ci/impact.mjs` combina ambos lados de renombres y todas las familias modificadas. `scripts/ci/ui.mjs` declara familias y archivos reales; `scripts/ci/suites.mjs` conserva SQL/API, carreras, roles de ejecución y exclusiones operacionales. Documentación y puras conocidas no requieren Docker. Migraciones, dependencias, CI y auth compartida requieren contratos reales más core UI, **no 1957 casos**. Mutaciones de facturación se ejecutan al modificar su script y siempre en la matriz completa.

El core incluye seed y login DIRECTOR, banco niveles, todos los endpoints sin sesión (401), PERSONAL (403) y DIRECTOR bloqueado con JWT vigente. La UI familiar conserva positivas y negativas de sus archivos en los proyectos Chromium aplicables; no afirma cobertura móvil. El reporter exige casos no-setup, todos los archivos solicitados y los cuatro proyectos core, y rechaza ejecuciones incompletas u omisiones inesperadas. Cada archivo focal debe ejecutar al menos una comprobación. `--list` valida la selección antes de ejecutar.

Una ruta, suite o paquete mobile/Expo/React Native sin contrato bloquea el plan: registrar comprobaciones reales antes de integrar. No se concede un PASS web a mobile. Los helpers de producción/preflight/carga/replay histórico no se ejecutan por extensión; sus cambios requieren un contrato seguro específico. Pruebas de captura y responsive exclusivas siguen en la matriz completa; cambiarlas exige registrar su gate aplicable, no sustituirlo por un smoke ajeno.

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
