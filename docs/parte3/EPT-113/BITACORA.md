# Bitácora académica EPT-113

## Unidad y autorización

19 de octubre de 2026. RF7/RF10, tarjeta EPT-113; EPT-73 es solo la épica de referencia. Baseline remoto verificado por la sesión: `5a2ebc7c385f91df74e3124f4c022efe6f7cbca1`. Checkout humano y Expo preservados; implementación en worktree dedicado y un único escritor.

El usuario autorizó explícitamente `size:exception` para un único PR con revisión focal por bloques. No se heredó la excepción de EPT-112. No se usó SDD ni se cambió el interruptor RDD.

## Decisiones y aprendizaje

| Momento | Trabajo y fundamento |
|---|---|
| Preparación | Jira/PDF y dependencias EPT-111/84/80 verificados por la coordinación. Sin nuevos hijos en la última lectura. |
| Base | Identidad y fuente privada en la misma transacción; secuencia segura y recuperación antes del retorno temprano. |
| Descarga | PDF bajo demanda evita una transacción distribuida ficticia con Storage; un renderer fallido no revierte pagos. |
| Móvil | Se verificaron APIs SDK57 y redirecciones nativas de expo/fetch; se agregó expo-sharing compatible, sin reutilizar transporte JSON. |
| Pruebas | Fallo inicial de columnas RPC, transferencia de ArrayBuffer en unpdf y fixtures heredados sin recibos detectados y corregidos. Ninguna negativa se retiró. |
| Normalización | Se corrigieron UTF-8/LF de archivos editados en Windows antes de la revisión. Los scripts bash se conservan LF en Git. |
| PDF | Muestra sintética de 9 páginas, 75 ítems y acentos revisada visualmente, con verificación adicional de coordenadas y texto. |
| Gates | Evidencia local focal; CI sobre SHA final y revisión independiente a cargo de coordinación. No se afirma aprobación ni cierre anticipado. |

## Revisión y entrega

Ruta sugerida para revisión independiente: (1) transacción/locks/ACL y fuente; (2) renderer, API y dinero; (3) autorización por recurso; (4) transporte/limpieza/contexto móvil; (5) rutas de historial, paginación y cobertura CI. Los resultados deben registrarse con evidencia del candidato exacto antes de integrar.

No se inventó aprobación docente, humana o legal. PR, checks finales, squash merge, publicación de evidencia y transición Jira permanecen a cargo de la coordinación hasta que los gates reales lo permitan.


### Corrección focal de revisión

La revisión independiente detectó un único P2: menú nativo abierto después de 60 s dejaba el botón de recibo cargando indefinidamente. La descarga ahora notifica su finalización antes de compartir para detener el timeout de red; toda resolución del intento vigente termina su estado, y un cambio de cuenta/recibo descarta progreso/resultado anterior. Se conservan cancelación y límite de red. Pruebas focales: 20/20 (3,14 s), TypeScript (3,09 s), lint sin errores (2,67 s). No hubo nueva matriz larga. Primer draft PR67/head17b39ad inició CI39291239847; validación independiente de la corrección y CI del head final siguen pendientes. Rollback de esta unidad se limita al controlador móvil, callback de fase y sus pruebas; no toca datos ni migraciones.


### CI y arneses

El primer CI final `39291610198` falló: limpieza EPT112 sin recibos, segundo Next dentro de Playwright, carrera Android de destrucción de tarea y timeout del step iOS posterior a tres flujos aprobados. Se corrigieron únicamente fixtures/runners/sanitización: limpieza sintética prefijada, reutilización de base local, barrera observada de detención, diagnóstico/screenshot acotados y upload Android fail-closed. Artefacto propio con contraseñas sintéticas omitidas por el filtro se eliminó con autorización y 404 verificado, conservando copia privada saneada. No se atribuyó una causa exacta al tramo iOS sin trazas. Regresiones reales 87+32 y pruebas focales17+2 aprobadas; nuevo SHA debe superar validación independiente y CI, sin rerun ciego ni aumento de timeouts. Ver evidencia detallada.


### Contraste y límite SQL → móvil

El segundo CI aprobó contratos DB pero detectó un botón fuera del catálogo (sin fondo Tailwind generado) y el parser móvil rechazando centavos textuales de ítems reales. Se reutiliza el botón institucional y se valida el texto decimal por BigInt antes de convertir a entero seguro, sin ampliar el contrato global. Se agregaron negativas y respuesta RPC real no vacía de los tres estados al arnés Android. AA real y axe sin hallazgos; regresión móvil67/67 y contrato real1/1 aprobados. iOS volvió a agotar el step aunque los tres flujos y capturas acabaron: solo se desactiva telemetría CLI oficial, sin afirmar causa ni solución hasta CI. No se aumentan límites ni se quitan gates. Ver evidencia detallada del run39296436449.


### Gate y límites medidos

El tercer CI concluyó cancelled/gate failure. Aunque UI completó150/150 sin omisiones, el job8min venció (509s reales), por lo que no se declaró PASS. Se autorizó únicamente UI10min (600s, margen aproximado18%), sin retirar fresh/reset/cleanup ni150tests. Android avanzó hasta un scroll cuyo último gesto dejó Hasta visible después del plazo: se ajusta solo su velocidad80 conservando15s/100%/asserts. iOS no inició el primer flujo porque XCTest no atendió120s; la causa sigue indeterminada. Se añade captura temprana acotada de sus procesos para diagnóstico, no cambios de readiness ni reparación especulativa. Si persiste sin causa con mejor evidencia, se detiene para decisión, sin merge ni bypass.

### Autoridad renovada y remediación nativa por clase

El usuario renovó autorización para resolver causas reales y obtener CI verde, sin bypass. CI39338153901 aprobó rápido, JS, UI150/150 y DB; Android falló al preparar el ZIP SDK e iOS antes del primer flujo. Se agrega preflight del paquete Android en SDK privado, recuperación máxima de una descarga solo por ZIP observado y publicación atómica verificada. Sin borrar cachés globales ni repetir flujos.

A/B sin PR reutilizó app/versiones verificadas, sin backend/build. Los primeros dos runs no alcanzaron Maestro por microtimeouts; el tercero mantuvo360s compartidos. B ejecutó smoke1/1 en95,136s, pero terminó failure por deadline, no aceptación. A tuvo menos tiempo restante: no prueba causa exclusiva. Se adopta dispositivo propio+GUI y una sesión de driver para acceso/recuperación/recibo, clearState individual y verificación de tres marcadores/PNG completos. Startup120s/step12min/job40min intactos. Se corrige redacción JSON/XML que consumía delimitadores tras Bearer/URL. Revisión focal y gate final pendientes; producción intacta. Detalle y fuentes en evidencia EPT-113.
### CI5 y ajuste de contratos del arnés

CI39365273890 no quedó verde. iOS ejecutó y acreditó3/3 subflujos y Maestro exit0, pero cleanup delete falló dentro del nuevo límite5s; se sustituye por el restante validado del mismo step720s y readback estricto, sin ampliar CI. Android falló por sdkmanager ausente de PATH antes de la action; se resuelve únicamente el ejecutable del SDK existente con ayuda/versión y raíces verificadas. Impact todavía esperaba tres CLI directas: ahora exige grafo transitivo exacto y negativas.37/37 impact y79/79 scripts móviles,513 tests Jest, tipos/lint aprobaron localmente;14/14 Python POSIX se acreditaron en Ubuntu real del run. No se declara gate por los flujos aprobados. Detalle, tiempos, artifacts y limitaciones en evidencia.
### CI6: iOS aprobado y semántica de ayuda SDK

CI39367841086 aprobó rápido/JS/UI/DB e iOS completo, incluidos3/3 subflujos y cleanup/readback real en9m21s dentro del step12min. Gate siguió fallando únicamente por Android: SDK12.0 --help sale1 al imprimir Usage según fuente oficial, mientras el nuevo preflight exigía0. Se corrige solo esa semántica con Usage/flags completos, rechazo de errores y --version exit0 numérica; instalar/listar siguen estrictos.9/9 regresiones aprobaron; ningún cambio de versión, presupuesto o aserciones. Falta acreditar Android real y gate del nuevo SHA.

La revisión focal detectó además FATAL junto a Usage válido. La corrección conserva la ayuda legítima y rechaza ese diagnóstico antes de consultar versión o instalar. Regresión final10/10, lint y diff-check aprobados; corroboración independiente del P2 resuelto10/10, exit0. La publicación de CI7 conserva los cuatro paths de esta unidad y no sustituye su aceptación remota.

### CI7: imagen Android verificada y desplazamiento del recibo

CI39457410176 aprobó rápido/JS/UI/DB e iOS completo; el gate siguió fallando por Android. El SDK preflight ya preparó correctamente la imagen en un único intento y el emulador aprobó consultas de padre y estudiante. El flujo de recibo venció después de su último gesto: la captura final muestra el botón visible y habilitado, sin haberlo pulsado todavía. Se ajusta solo la cadencia de sus tres desplazamientos a80, manteniendo100% de visibilidad, plazos y aserciones de descarga/compartir/limpieza. Contrato nativo14/14 e impacto focal2/2, YAML y lint aprobados; nueva revisión y gate real pendientes. No se presenta el botón visible ni la suite iOS sin backend como aceptación de la descarga Android.

La revisión técnica focal de esta cadencia quedó corroborada sin hallazgos:14/14, sin omisiones, exit0 en4,449s Node/4,507s de pared y diff-check0. CI8 sobre el SHA publicado sigue siendo la puerta obligatoria para integrar; no se atribuye aprobación humana ni se cierra Jira por la revisión local.

### CI8: adquisición SDK como clase común

CI39462239783 aprobó rápido/JS/UI/DB e iOS completo, pero Android falló antes del emulador: el build recibió un ZIP ilegible al adquirir el NDK27.1.12297006 ya requerido por React Native. No es prueba contra la cadencia de recibos, que no alcanzó a ejecutarse. Fuente/configuración real y metadata oficial confirmaron la misma versión, licencia y archivo; no se cambió toolchain. Se amplía únicamente la allowlist del instalador aislado existente a imagenAPI34 y ese NDK, con validadores específicos, publicación atómica y enlaces relativos portables, conservando dos intentos solo por ZIP y presupuestos originales. Scripts87 aprobados/1 POSIX omitido en Windows, impacto2/2, lint/YAML aprobados; el caso de symlink debe ejecutarse en Ubuntu real. Revisión focal y CI del nuevo SHA pendientes, sin cerrar Jira ni sustituir el gate por pruebas locales.
