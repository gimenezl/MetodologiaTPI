# EPT-112: cinco reportes económicos web

Dirección habilitada consulta ingresos, pagos completos, pagos incompletos, deportes y recorridos desde **Reportes oficiales → Reportes económicos**. Las seis consultas académicas conservan sus identificadores, contratos y exportaciones. No se agregan exportaciones económicas, recibos, correos, cron ni pantallas móviles.

## Grano, tiempo y dinero

| Reporte | Una fila | Ubicación temporal | Importe sumable |
|---|---|---|---|
| RF17, ingresos | Pago aprobado | `pagos.fecha_transferencia` | Informado e imputado separados; diferencia = informado menos imputado |
| RF18, completos | Relación pago-factura, agregada desde imputaciones | Transferencia | Solo imputación real de esa relación |
| RF19, incompletos | Relación pago-factura o factura sin ningún aprobado | Transferencia o vencimiento, rotulado por fila | Imputación real; cero si no existe pago |
| RF20, deportes | Imputación de ítem deportivo | Transferencia | Imputación del ítem; horarios agregados antes de unir |
| RF21, recorridos | Imputación de ítem de transporte | Transferencia | Imputación del ítem referido a su inscripción |

- Los extremos son inclusivos y las fechas son civiles de Buenos Aires. Año significa calendario, enero a diciembre.
- La clasificación es **por factura y saldo vigente**, usando `estado_cuotas_alumno` de EPT-107: completa con saldo ≤ 0; incompleta con saldo > 0. «Vencida» no reemplaza esa clasificación.
- Saldo = total histórico menos imputaciones activas de pagos APROBADOS, incluyendo aprobados fuera del intervalo consultado. No se recalculan tarifas ni se recortan saldos negativos. Se muestra la inconsistencia del histórico cuando corresponde.
- Una factura con total cero y sin pagos es completa, ubicada por vencimiento; no se crea ni presenta una transferencia ficticia.
- «Sin ningún aprobado» se comprueba sobre toda la historia, no sobre el intervalo. Una factura parcialmente abonada fuera del intervalo no aparece como factura sin pagos dentro de él.
- El importe informado pertenece al pago. No se asigna a facturas, deportes ni recorridos por prorrateo. Solo RF17 ofrece total informado y diferencia; **no se suman informado e imputado entre sí**.
- Las facturas pueden aparecer en varias relaciones. Sus totales y saldos globales se agregan por factura única, nunca sumando celdas repetidas de las relaciones. Una misma factura puede aparecer en diferentes agrupaciones temporales; las agrupaciones suman imputaciones, no deuda repetida.
- Los importes históricos se calculan con NUMERIC en PostgreSQL. El JSON transporta centavos como texto entero, incluso en totales; la interfaz usa BigInt únicamente para formatear, no para recalcular deuda o importes definitivos.

## Matrícula y límites históricos

La decisión humana del 18/10/2026, aprobada en la conversación y luego registrada en EPT-112, conserva el grupo **«Curso no determinable»** sin perder registros ni importes. Se distinguen **Historial insuficiente** y **Varias matrículas posibles**. No se volvió a solicitar aprobación.

Se construye el día civil `[00:00, 00:00 del día siguiente)` en `America/Argentina/Buenos_Aires` y se buscan matrículas con intersección de duración positiva. Solo se atribuye curso cuando existe una única matrícula que cubre el día completo. Un alta o cierre intradía sin cobertura completa es insuficiente; varias candidatas, incluso con la misma denominación, son ambiguas. Un cierre exacto a medianoche no ocupa el día siguiente. Un intervalo de duración cero no ocupa tiempo. **No se infiere una hora de transferencia a partir de DATE.**

Se agrupa por nivel y denominación, sin división. La matrícula identifica el curso histórico; su nombre y nivel se leen del catálogo actual porque no existen snapshots de esas etiquetas. El mismo límite aplica a nombres de deportes, niveles deportivos, profesor del grupo, horarios y nombres de recorridos. No se afirma reconstruir sus valores históricos.

Los deportes siguen `items_factura.inscripcion_deportiva_id → grupo`; transporte sigue `inscripcion_servicio_id → servicio`. Se conservan referencias canceladas y catálogos inactivos. Un recorrido actual diferente no sustituye el que originó el ítem.

## Lectura, filtros y concurrencia

`public.reporte_economico(reporte, desde, hasta, filtros, pagina, tamano, huella)` devuelve un documento por invocación: filas, total de filas, totales globales, agrupaciones, huella, instante de lectura y fecha de corte. Una función STABLE y una única consulta obtienen detalle y totales bajo la misma instantánea PostgreSQL, incluso durante aprobación o rechazo.

Orden total: fecha descendente e identidad compuesta ascendente. Se admiten 25, 50 o 100 filas por página, páginas de 1 a 1.000.000 y fechas finitas entre años 0001 y 9998. No hay truncamiento silencioso por el límite de 1.000 filas de PostgREST: la RPC devuelve un documento JSON con una página explícita. Los totales y agrupaciones corresponden al conjunto filtrado entero.

Filtros: desde/hasta, año calendario, nivel, denominación exacta de curso y causa de curso no determinable. Deportes añade deporte, horario y profesor; recorridos añade recorrido. El nivel de RF20 es el del grupo deportivo. Se rechazan parámetros desconocidos, repetidos, inaplicables o inválidos, tanto en servidor como en la RPC para su dominio.

La huella MD5 del contenido ordenado detecta cambios entre páginas, incluyendo importe, saldo, matrícula y etiquetas mostradas. Ante una huella diferente la RPC devuelve solo la señal de actualización y la API responde 409; la interfaz exige volver a la primera página conservando filtros. No es una firma de integridad ni un informe inmutable multipágina. Recargar sin huella produce una lectura nueva, identificada por su instante.

Si el catálogo falla o ya no contiene un identificador aplicado, cada selector conserva ese valor en una opción de respaldo identificada. Consultar mantiene el filtro, y elegir explícitamente «Todos» lo quita. No se sustituye silenciosamente por vacío.

El formulario GET y los enlaces de paginación realizan navegación de documento completo; no existen respuestas de fetch reutilizadas bajo filtros nuevos. El navegador descarta la navegación anterior al iniciar otra. No se crea infraestructura persistente de snapshots. Se preagrega por pago en un mapa JSONB materializado de una sola fila, con clave UUID de pago única y valor NUMERIC en centavos. El acceso por clave evita que una estimación pequeña cause un recorrido completo del agregado para cada pago. La extracción vuelve a NUMERIC, sin pasar por Number ni punto flotante. La RPC conserva RLS e INVOKER y usa `plan_cache_mode=force_custom_plan` solo durante su ejecución para evitar reutilizar planes inadecuados entre filtros de cardinalidades muy distintas; no modifica timeouts ni configuración persistente.

## Autorización y privacidad

| Actor | API/pantalla económica | RPC directa | Economía propia previa |
|---|---|---|---|
| DIRECTOR habilitado | Sí | Sí | Institución |
| PADRE / ESTUDIANTE habilitado | No | No | Se conserva alcance previo |
| DOCENTE / PERSONAL / sin perfil | No | No | Sin nuevos permisos |
| Bloqueado / anónimo | No | No | Sin nuevos permisos |

Servidor: cookies, `getUser`, rol vigente y bloqueo mediante `requerirDirector`. Base: `exigir_director_reporte` antes de ID y filtros, SECURITY INVOKER, STABLE, `search_path=''` y grants explícitos mínimos. No se acepta actor/rol del cliente ni se usa service_role para leer reportes.

No se devuelven rutas ni URLs de Storage, originales, tokens, números de operación ni datos bancarios. Se conservan RLS y privacidad del original de comprobantes. Todas las operaciones de reporte son de solo lectura.

## Migración y reversión

Forward creada con CLI 2.117.0: `20261018174050_ept_112_reportes_economicos.sql`. No modifica las 42 migraciones anteriores, tablas, datos, RLS ni permisos de escritura. Tipos regenerados dos veces con salida normalizada reproducible y copia móvil sincronizada.

Retirar enlaces/pantallas/API económicos y sus módulos; retirar después `public.reporte_economico(text,date,date,jsonb,integer,integer,text)` y `app_private.curso_reporte_economico(uuid,date)` mediante una migración forward revisada. No revertir estados de pagos ni borrar historia. Las seis consultas académicas y EPT-107 siguen independientes.

Inventario de despliegue futuro, **no aplicado a producción en esta unidad**: EPT-110 `20261017120000`, EPT-111 `20261017222738`, EPT-112 `20261018174050`. No se consultó ni alteró el ledger remoto.

## Bitácora académica

| Campo | Registro |
|---|---|
| Problema / encargo | Completar EPT-112 de extremo a extremo conforme a Parte 3 RF17–21, decisiones EPT-80/83/84/86 y conversación del 18/10/2026 |
| Prompt | «Misión: completar EPT-112 de extremo a extremo», encargo del 18/10/2026 con cinco reportes web, contratos económicos, seguridad, pruebas y entrega autorizada |
| Respuesta | Implementación de cinco reportes con consulta SQL coherente, API autorizada, filtros y totales exactos, interfaz institucional, pruebas reales y documentación de límites |
| Apoyo utilizado | Codex para auditoría de fuentes, implementación, fixtures sintéticos, pruebas y documentación |
| Análisis y adaptación | Se contrastaron contratos EPT-107–111, esquema, PDF, autorización, guías Next instaladas y selector; se separaron granos, informado/imputado y saldo vigente; se descartaron prorrateos y snapshots persistidos |
| Verificación | Matriz enlazada y evidencia con pruebas puras y contratos SQL/Auth/API/lectura concurrente/UI diferenciados |
| Revisión | Revisión independiente de fcde8ed inspeccionó 22 archivos y confirmó P2 de pérdida silenciosa de filtros ante fallo/ausencia de catálogo. Corregido con opciones de respaldo y prueba UI real; revalidación acotada y CI del SHA final pendientes |
| Comprensión / aprobación humana | No se inventa comprensión, aprobación humana ni aprobación docente; se registra el análisis técnico observable y las decisiones expresas del usuario |

Véanse [matriz de aceptación](matriz-aceptacion.md) y [evidencia de entrega](../../evidence/EPT-112.md).
