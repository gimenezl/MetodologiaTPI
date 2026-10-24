# EPT-114: historial de deuda por ítem (HU13, RF13)

La familia consulta desde la aplicación móvil, por hijo, la deuda discriminada por ítem de pago: cuota, **cada** deporte, cada recorrido de transporte y comedor, con período, importe histórico, importe pagado, saldo vigente, estado y vencimiento; subtotales por agrupación y total adeudado del conjunto filtrado. Es una consulta: no hay selección de ítems, carga de comprobantes, aprobación ni cambios de inscripción.

Implementación: `supabase/migrations/20261024150000_ept_114_historial_deuda_items.sql` y `mobile/` (`servicios/deuda-items.ts`, `contenedores/deuda/`).

## Trazabilidad con Jira

| Tarjeta | Qué cubre | Dónde está |
|---|---|---|
| EPT-114 (HU13) | Historia completa y sus cinco criterios | Este contrato, [matriz](matriz-aceptacion.md), [evidencia](../../evidence/EPT-114.md) |
| EPT-153 | Vista/consulta de deuda por ítem y por período | RPC `public.historial_deuda_items`; `deuda_items_rls.sql` |
| EPT-154 | Servicio de consulta en la app | `mobile/src/servicios/deuda-items.ts`; `deuda-items.test.ts`, `deuda-rpc-real.test.ts` |
| EPT-155 | Pantalla agrupada con total adeudado | `mobile/src/contenedores/deuda/`; `deuda-contenedor.test.tsx`, `maestro/deuda.yaml` |
| EPT-156 | Filtro por rango de fechas | Parámetros `p_desde/p_hasta` (mes de factura) y formulario «Filtrar por período de factura» |
| EPT-157 | Consistencia con los reportes de la web | `supabase/tests/deuda_items.mjs` (contraste con EPT-107 y RF19) |

Decisiones respetadas: EPT-84 (los ítems se pagan completos; el saldo baja solo al aprobar; los rechazos se conservan) y EPT-86 (el total debe coincidir con el reporte de pagos incompletos, que incluye facturas con saldo sin ningún pago; extremos inclusivos; fechas civiles de Buenos Aires).

### Refinamiento del criterio 3 de HU13

El criterio original dice «los ítems pagados parcialmente se muestran con su saldo pendiente». Conforme a EPT-84 un ítem **nunca** se paga en parte. El criterio se interpreta a nivel **factura**: «pago parcial» es una factura con algunos ítems pagados y otros pendientes. La pantalla muestra cada ítem pendiente con su saldo completo y cada ítem pagado con saldo cero, y los subtotales y el total reflejan solo lo pendiente. No existen fracciones de ítem ni se cambia ninguna regla económica. Un ítem con imputación parcial (`pagado` distinto de cero y de `importe`) sería un histórico incoherente: se muestra tal cual y se declara con `inconsistente`; no se corrige ni se oculta.

## Fuente económica y grano

No se agregan tablas, columnas ni deuda materializada. La lectura une, para **un** alumno:

| Dato | Origen |
|---|---|
| Período y vencimiento | `public.facturas` |
| Ítem, tipo, importe histórico y estado de reserva | `public.items_factura` |
| Pagado del ítem | Σ `imputaciones_pago.importe` con `activa` de pagos `APROBADO`, agregado **una vez por ítem** antes de unir catálogos |
| Deporte y grupo | `items_factura.inscripcion_deportiva_id → inscripciones_deportivas → deportes / grupos_deportivos` |
| Recorrido o comedor | `items_factura.inscripcion_servicio_id → inscripciones_servicios → servicios_escolares` |

Grano: **una fila por ítem de factura**. Ningún archivo, recibo, pago, horario ni relación académica multiplica un importe. Los importes de los pagos no entran: el importe informado por la familia nunca cancela deuda.

## Contrato de lectura

`public.historial_deuda_items(p_alumno_id, p_desde, p_hasta, p_pagina, p_tamano, p_huella) RETURNS JSONB`, `SECURITY INVOKER`, `STABLE`, que delega en `app_private.historial_deuda_items` (`SECURITY DEFINER`, `search_path` vacío, `plan_cache_mode = force_custom_plan`). Patrón de EPT-110, por la misma razón: la RLS de inscripciones, grupos y catálogos no admite al PADRE vinculado y abrirla expondría datos ajenos.

Un documento por invocación:

| Campo | Contenido |
|---|---|
| `filas` | Página de ítems: `item_id`, `factura_id`, `periodo`, `vencimiento`, `tipo`, `grupo`, `concepto`, `detalle`, `importe_centavos`, `pagado_centavos`, `saldo_centavos`, `estado`, `en_verificacion`, `vencido`, `inconsistente`, `factura_inconsistente`, `origen_estado`, `catalogo_activo` |
| `total`, `pagina`, `tamano` | Cantidad de ítems del conjunto filtrado completo y la página devuelta |
| `totales` | `items`, `items_con_saldo`, `importe_centavos`, `pagado_centavos`, **`adeudado_centavos`**, `facturas`, `facturas_con_saldo`, `hay_inconsistencias` — del conjunto filtrado completo, no de la página |
| `grupos` | Una agrupación por `CUOTA`, por cada deporte (`DEPORTE:<id>`), por cada recorrido (`TRANSPORTE:<id>`) y cada servicio de comedor (`COMEDOR:<id>`), con sus subtotales |
| `huella`, `leido_en`, `fecha_corte`, `periodo_desde`, `periodo_hasta` | Control de coherencia, instante de lectura, fecha de corte de Buenos Aires y mes aplicado a cada extremo |

**Dinero.** Todo el cálculo es `NUMERIC` en PostgreSQL. El JSON transporta centavos como **texto entero**, incluso en los totales, que pueden superar la precisión segura de JavaScript aunque cada ítem la respete (la prueba usa 9.100 ítems de ARS 9.999.999.999,99 = 9.099.999.999.990.900 centavos > 2^53). La app los lee como `bigint`, rechaza decimales, ceros a la izquierda, `-0` y notación científica, y comprueba que las cifras cierren: `saldo = importe − pagado` por ítem, Σ subtotales = total adeudado, Σ ítems de las agrupaciones = total de ítems. Una respuesta que no cierra no se muestra. El dispositivo no recalcula deuda.

**Estado del ítem.** `SIN_CARGO` (importe cero, sin pagos); `PAGADO` (saldo ≤ 0); `EN_VERIFICACION` (saldo > 0 con un pago en revisión: reserva el ítem pero **no** reduce la deuda); `VENCIDO` (saldo > 0 y fecha de corte posterior al vencimiento); `PENDIENTE`. `vencido` y `en_verificacion` se informan además como indicadores, de modo que un ítem en verificación ya vencido lo dice.

**Saldo.** `importe histórico − pagado`, sin recortar a cero. Un valor negativo o `inconsistente` declara un histórico incoherente; la factura se declara inconsistente con las mismas reglas de EPT-107 (suma de ítems distinta del total, sobrepago, imputación parcial), evaluadas sobre los ítems completos de cada factura.

**Etiquetas históricas.** El deporte y el recorrido salen de la inscripción que originó el ítem, también si la inscripción está cancelada o el catálogo inactivo (`origen_estado`, `catalogo_activo`). Un recorrido actual distinto no sustituye al facturado. **Límite:** el *nombre* es el del catálogo actual; el sistema no conserva snapshots de nombres. No se reutilizan las dimensiones de curso de EPT-112 (no son necesarias para esta lectura).

## Filtro y semántica temporal

El filtro es por **período de factura** (`facturas.periodo`, primer día de mes): por mes calendario y con extremos inclusivos, como EPT-110. `desde = 2026-10-17` incluye el período `2026-10-01`; `hasta = 2026-11-02` incluye `2026-11-01`. Sin fechas (ambas nulas) se devuelve todo el historial; una sola fecha, el rango invertido, una fecha infinita o fuera de 0001–9998 se rechazan (`P6870`/`P6871`) antes de la guarda de actor, igual para cualquier alumno. La pantalla lo rotula «Filtrar por período de factura» y aclara que no es la fecha de transferencia.

El saldo es **vigente**: considera los pagos aprobados de cualquier fecha, incluso fuera del rango. No es una reconstrucción del saldo al final del intervalo. La fecha de corte es la fecha de Buenos Aires del servidor (`app_private.fecha_negocio(now())`), nunca la del teléfono.

## Reconciliación con los reportes web (EPT-157)

RF19 (`reporte_economico('incompletos')`) selecciona **relaciones de pagos aprobados por fecha de transferencia** y **facturas con saldo sin ningún aprobado histórico por vencimiento**. Su saldo es vigente y global. El filtro móvil selecciona **facturas por período**. Por lo tanto el mismo rango literal en «período de factura» y «fecha de transferencia» **no garantiza el mismo universo**; no se alteró RF19 para forzar la igualdad.

| Caso (fixture de EPT-112 + factura 611) | RF19 (transferencia/vencimiento) | Móvil (período de factura) |
|---|---|---|
| Año 2030 completo | {603, 604, 605, 606, 611}, saldo ARS 380,00 | Mismo universo, mismo saldo |
| Abril–junio 2030 | {604, 605, 606}, ARS 300,00 | Mismo universo, mismo saldo |
| Noviembre 2030 | {611}, ARS 40,00 (dos relaciones, una deuda) | Mismo universo, mismo saldo |
| Marzo 2030 | Vacío (la factura 603 tiene aprobados; las transferencias de marzo pagan la 602) | {603}, ARS 40,00: es de ese período y su saldo vigente es 40,00 |
| Enero 2030 | {603} por la transferencia del 10/01 | Solo la 601, ya pagada |

La prueba compara **conjuntos completos de identificadores antes de sumar**, agrega el saldo de los ítems por **factura única**, y contrasta tres lecturas independientes: la RPC móvil, `estado_cuotas_alumno` (EPT-107) y el `saldo_facturas_centavos` de RF19. Demuestra que sumar el saldo de cada *relación* de RF19 duplicaría la deuda de la factura 611. No compara el total imputado del período (RF17) con la deuda: son magnitudes distintas. Los resultados esperados son constantes calculadas a mano en el fixture, no la salida de un ayudante compartido.

## Autorización

| Actor | Resultado |
|---|---|
| PADRE habilitado | Solo hijos con vínculo vigente **hoy** en `padres_hijos` |
| ESTUDIANTE habilitado | Solo lo propio |
| DIRECTOR habilitado | Cualquier alumno (la app móvil no ofrece esta vista; sirve a la comparación con la web) |
| DOCENTE, PERSONAL, bloqueado, sin vínculo, alumno ajeno o inexistente | Documento vacío, idéntico (salvo `leido_en`) al de un alumno autorizado sin ítems: no revela si el alumno existe |
| `anon` | Sin `EXECUTE` (42501) |

La identidad sale de `auth.uid()`; el único identificador que acepta el servidor es el del alumno. La guarda (`app_private.alumno_economico_visible`, EPT-101) se resuelve antes de leer ninguna tabla económica o de catálogo. `service_role` no recibe `EXECUTE`. La RLS de `inscripciones_*`, `grupos_deportivos` y demás no se modificó: el padre sigue sin leerlas directamente. No se promete revocación retroactiva de datos ya entregados.

## Lectura coherente, paginación y concurrencia

Una función `STABLE` y una única consulta obtienen filas, subtotales, total y huella bajo la misma instantánea de PostgreSQL, incluso durante una aprobación o un rechazo concurrente. Orden total estable: agrupación (cuota, deportes, recorridos, comedor; por nombre), período descendente e identidad del ítem. Páginas de 25, 50 o 100 (la app pide 50), de 1 a 1.000.000. No hay truncamiento silencioso por el límite de filas de PostgREST: la RPC devuelve un documento JSON con una página explícita.

La huella MD5 del contenido ordenado detecta cambios entre páginas. Con una huella distinta el servidor contesta solo `{ actualizado: true, huella }` y la app descarta lo acumulado y vuelve a la primera página; nunca publica una mezcla de versiones. No es un informe inmutable multipágina.

En el dispositivo cada respuesta queda atada a (hijo, filtro, intento, recarga). Al cambiar de hijo, aplicar un filtro, reanudar la app (`AppState = active`) o recargar, las lecturas en vuelo se cancelan (`AbortController`) y una respuesta tardía —aunque su petición ya estuviera cancelada— no se muestra bajo otro contexto, tampoco una página siguiente tardía. El filtro y lo acumulado se descartan al cambiar de hijo. Una renovación de token de la misma cuenta no es un cambio de identidad: el contenedor no compara `access_token`.

## Pantalla móvil

Pestaña **Deuda por ítem** de la sesión PADRE/ESTUDIANTE (el padre elige hijo; el estudiante no ve selector). Tarjeta «Total adeudado» (con la fecha de vigencia del saldo, ítems y facturas con saldo), una sección por agrupación con su subtotal y las tarjetas de ítem (período, vencimiento, importe, pagado, saldo y estado con texto, glifo y trazo, nunca solo color). Estados: cargando, vacío («Todavía no hay ítems facturados» / «No hay ítems en este período»), sin vínculos, error con reintento, permiso, y «Mostrar más ítems» con aviso de que el total incluye todos. Ítems sin cargo, en verificación, de inscripción cancelada y de catálogo inactivo se rotulan; las inconsistencias se declaran. Paleta e insignias del catálogo existente; flecha y gesto de volver como el resto de las secciones.

## Migración, despliegue y reversión

Migración forward `20261024150000_ept_114_historial_deuda_items.sql`: dos funciones nuevas, sin tablas, datos, RLS ni privilegios de escritura; no edita las 44 migraciones integradas. Tipos regenerados con CLI 2.117.0 (dos generaciones idénticas, salida normalizada) y copia móvil sincronizada.

**Estado de despliegue: no aplicada a producción.** Integrar a `main` no es desplegar; su aplicación requiere una autorización aparte. Antes de ella la pestaña móvil mostraría un error de lectura (la función no existiría).

Reversión: retirar la pestaña y los módulos móviles y, mediante una migración forward revisada, `DROP FUNCTION public.historial_deuda_items(uuid,date,date,integer,integer,text)` y `app_private.historial_deuda_items(uuid,date,date,integer,integer,text)`. No hay datos que revertir ni historia que borrar; EPT-107, EPT-110, EPT-112 y EPT-113 son independientes.

## Riesgos y límites

- El costo de cada página es proporcional al historial filtrado del alumno (se calculan filas, subtotales y huella completos): ≈190 ms para 9.100 ítems en la base local; un alumno real tiene del orden de cientos.
- Los nombres de deportes y recorridos son los del catálogo actual.
- Al volver a primer plano la app recarga desde la primera página (descarta lo acumulado con «Mostrar más ítems»): prioriza la coherencia sobre conservar la posición.
- `facturas_con_saldo` clasifica por el saldo neto de la factura (como EPT-107 y RF19) e `items_con_saldo` por ítem; solo difieren con un histórico incoherente, que se declara con `hay_inconsistencias`.
- La clave de agrupación del comedor incluye el servicio (`COMEDOR:<id>`) por si el catálogo admitiera más de uno.
- Una huella distinta entre páginas obliga a recargar; no hay snapshot persistente.
- iOS: ver [evidencia](../../evidence/EPT-114.md#plataformas-y-alcance-ios). Las pruebas con teléfono real, TalkBack/VoiceOver, texto ampliado y retorno de correo las hará el usuario más adelante y no se declaran realizadas.

## Bitácora académica

| Campo | Registro |
|---|---|
| Problema / encargo | Completar EPT-114 y sus cinco subtareas conforme a Parte 3 RF13, decisiones EPT-84/EPT-86 y el encargo del 24/10/2026 |
| Prompt | «Misión: completar EPT-114 y sus cinco subtareas», con consulta, autorización, servicio, interfaz nativa, pruebas, revisión, CI y cierre |
| Respuesta | RPC de lectura con guarda de actor y una instantánea, servicio móvil con validación exacta en `bigint`, pantalla agrupada con filtro y paginación, pruebas SQL/Auth/API/concurrencia, contraste con EPT-107 y RF19, escenario Maestro |
| Apoyo utilizado | Claude (Sonnet 5.5) para auditoría de fuentes, implementación, fixtures sintéticos, pruebas y documentación; un revisor independiente en solo lectura |
| Análisis y adaptación | Se contrastaron EPT-107/110/112/113, el esquema, las decisiones de Jira y el PDF; se descartaron una vista nueva (no resuelve nombres bajo RLS), una tabla de deuda materializada (innecesaria) y la igualdad forzada con RF19 (selecciona otro universo) |
| Verificación | Matriz enlazada y evidencia con comandos, códigos de salida y duraciones |
| Revisión | Ver la evidencia: hallazgos del revisor independiente y su resolución |
| Comprensión / aprobación humana | No se inventa comprensión, aprobación humana ni aprobación docente; se registra el análisis técnico observable y las decisiones expresas del usuario |
