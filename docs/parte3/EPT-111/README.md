# EPT-111: verificación de pagos desde Dirección

Dirección decide una vez por **pago**, después de revisar todos sus comprobantes e ítems. La aprobación paga ítems completos y reduce el saldo derivado. El rechazo conserva el historial, libera las reservas y el número de operación, sin reducir deuda. No se emiten recibos, correos ni ajustes.

## Recorrido

1. Abrir **Comprobantes** en el panel de Dirección.
2. Revisar alumno, facturas, ítems, total calculado, importe informado y todos los archivos.
3. Elegir **Aprobar pago** o **Rechazar pago** y confirmar. El rechazo exige un motivo.
4. Si el resultado es incierto, **Consultar resultado** antes de repetir. Otro Director puede haber decidido entretanto.

El listado muestra hasta 200 pendientes por página y ofrece **Pagos anteriores**. La búsqueda por identificador también encuentra pagos finalizados, sin abrir un segundo dashboard. Las páginas cambian con las decisiones concurrentes: actualizar el listado o usar el identificador recupera un registro concreto.

## Contrato económico

| Estado inicial | Decisión | Pago | Ítems | Imputaciones | Saldo |
|---|---|---|---|---|---|
| Pendiente con comprobantes y reservas coherentes | Aprobar | APROBADO, actor e instante | PAGADO | Conservadas y activas | Baja por importes históricos de los ítems |
| Ídem | Rechazar, motivo no vacío | RECHAZADO, actor, instante y motivo | PENDIENTE | Conservadas e inactivas | No baja |
| Finalizado con la misma decisión | Repetir | Sin cambios, `repetido=true` | Sin cambios | Sin cambios | Sin cambios |
| Finalizado con decisión opuesta | Intentar | Conflicto | Sin cambios | Sin cambios | Sin cambios |

`total_calculado` debe coincidir con las imputaciones y cada imputación con un ítem completo reservado del mismo alumno. Debe existir al menos un comprobante confirmado y la transferencia debe estar informada. No se decide sobre una carga temporal ni sobre reservas incoherentes.

**El importe informado puede ser diferente.** Aprobar aplica los importes históricos completos de los ítems, no el importe informado. No se impone igualdad ni se ajustan importes, prorratean ítems, aplican sobrepagos o reabren decisiones. Una factura puede quedar parcialmente pagada por tener algunos ítems completos aprobados. Varias facturas del mismo hijo confirman o revierten juntas.

El saldo y el estado de factura siguen calculados por `estado_cuotas_alumno` de EPT-107. No hay estado persistido duplicado ni lectura de tarifas actuales.

## Seguridad y superficie

| Actor | Decidir / consultar decisión | Original | Consulta económica |
|---|---|---|---|
| DIRECTOR habilitado | Sí | Sí | Institución |
| PADRE cargador habilitado | No | Propio | Hijos vinculados |
| Copadre habilitado | No | No | Hijos vinculados, registro saneado |
| ESTUDIANTE habilitado | No | No | Propia, registro saneado |
| DOCENTE, PERSONAL, anónimo, cuenta bloqueada | No | No | Sin acceso económico |

- `POST /api/comprobantes/pagos/[pagoId]/verificacion`: cookies, `getUser`, rol vigente, origen y JSON estrictos. Solo admite decisión y motivo; ningún actor, importe o estado como autoridad.
- `GET` en la misma ruta recupera el resultado con `Cache-Control: no-store`. No usa Bearer móvil.
- `public.verificar_pago(uuid,text,text)` y `public.consultar_verificacion_pago(uuid)` son envoltorios SECURITY INVOKER, con EXECUTE solo para `authenticated`. Los cuerpos privados son SECURITY DEFINER, `search_path=''`, referencias calificadas y guarda explícita.
- El actor sale de `auth.uid()` y su perfil vigente. Nunca de `service_role`, metadatos editables o un argumento.
- No hay privilegios nuevos de escritura directa, cambios de RLS ni cambios de Storage. El original mantiene su ruta independiente, cookies y URL firmada de 60 segundos. El permiso del original no se amplía para el móvil.
- Los códigos P6880/P6881/P6882/P6883 significan entrada inválida/pago no disponible/conflicto/incoherencia. P687x permanece reservado a EPT-110. La API traduce los códigos sin exponer SQL.

## Serialización

Orden de decisión: **perfil del actor FOR SHARE → pago FOR UPDATE → ítems FOR UPDATE en orden UUID**. La guarda se toma antes de cualquier espera; FOR KEY SHARE no protege una revocación ordinaria de rol o acceso.

| Competencia | Resultado |
|---|---|
| Dos decisiones sobre el mismo pago | La segunda espera y obtiene repetición o conflicto; no sobrescribe actor, instante ni motivo |
| Revocación confirma primero | La guarda observa el nuevo estado, deniega y no escribe |
| Decisión obtiene primero la guarda | La revocación espera el fin de esa transacción; no se promete revocación retroactiva |
| Finalización EPT-109 / decisión | Comparten bloqueo de pago. Si finaliza primero, el archivo queda en el historial; si decide primero, la carga posterior se descarta como pago no pendiente |
| Rechazo / nueva reserva EPT-108 | La reserva espera los ítems y después ve la liberación; el índice parcial libera el número de operación |
| Consulta / decisión en vuelo | La consulta toma FOR SHARE en el pago y espera su desenlace antes de informar pendiente |

EPT-108 bloquea ítems antes de **insertar un pago nuevo**, no espera un pago existente. EPT-109 toma pago y luego carga, sin ítems. La decisión no espera vínculos, cargas ni consultivos, de modo que no introduce una arista de regreso en esos caminos. Las pruebas demuestran las esperas con conexiones identificables y `pg_blocking_pids`, sin usar sleeps como evidencia.

## Recuperación e interfaz

La decisión se confirma en línea, conservando el contexto y sin un modal nuevo. El formulario bloquea doble envío. Un error de transporte, respuesta inválida o servidor no disponible deja el resultado incierto y permite únicamente consultar. Si otro Director decidió, se consulta y presenta el resultado durable, sin ofrecer una decisión opuesta. Los mensajes no incluyen rutas privadas ni datos técnicos.

Los archivos y las imputaciones se leen paginados internamente para no perder filas por el límite de PostgREST. No se fija un máximo comercial de archivos. Se conservan paleta institucional, navegación, etiquetas, teclado, foco, estados textuales y ajuste de contenido largo. El contexto de diseño se recuperó de EPT-95/99 y los tokens existentes mediante el cargador Impeccable, en un archivo privado externo al repositorio, sin redefinir marca o requisitos.

## Verificación y plataformas

La [evidencia y matriz de aceptación](../../evidence/EPT-111.md) distinguen contratos reales de pruebas puras. El circuito real registra con JWT del padre, sube un PNG sintético a Storage, finaliza con Bearer, decide por cookies web y vuelve a consultar las vistas/RPC que usa el móvil con JWT de padre, estudiante y copadre. Se comprueban dos familias y alumno ajeno.

No se modificó lógica móvil: únicamente se sincronizó la copia generada de tipos. Los gates Android/iOS/JS se activan por el contrato compartido. Un smoke iOS sin backend no demuestra autorización ni el circuito real. Se mantienen para la revisión final del usuario las pruebas personales en teléfono, texto ampliado y lectores de pantalla; no se solicita hacerlas ahora ni se afirman realizadas.

## Migraciones y despliegue

Nueva migración forward: `20261017222738_ept_111_verificacion_comprobantes.sql`, creada con CLI 2.117.0. No se modificaron las 41 migraciones del baseline.

Esta entrega **no aplica nada remotamente**. EPT-110 (`20261017120000`) estaba integrado pero pendiente de producción según su cierre; EPT-111 también queda pendiente de un release separado y autorizado. No se consultó el ledger remoto, por lo que no se afirma inventario productivo actualizado. EPT-107/108/109 tienen despliegues históricos registrados en Jira, sin habilitar cambios productivos en esta unidad.

## Reversión

Antes del uso real, retirar los controles web y las dos RPC nuevas, después sus auxiliares privados, permite volver al panel de lectura sin tocar datos. Con decisiones reales confirmadas, **no invertir estados, borrar pagos o reactivar imputaciones**: un rollback de código no es una reversión contable. Preservar comprobantes e historial; cualquier corrección de negocio futura necesita decisión explícita y una migración forward revisada. No existe reapertura autorizada.

## Bitácora académica de asistencia

| Campo | Registro |
|---|---|
| Tarjeta | EPT-111, sin subtareas vivas al releer Jira |
| Problema / prompt | Completar verificación económica de extremo a extremo, con decisiones EPT-80/84 y controles de autorización, incertidumbre y concurrencia |
| Respuesta | RPC transaccional idempotente, recuperación durable, extensión del panel existente y contratos reales |
| Comprensión y adaptación | Se contrastaron Jira completo, contratos EPT-107/108/109/110, esquema exacto, guarda EPT-103, arnés de conexiones y docs de Next instalado; se separó decisión por pago de sus múltiples archivos y se mantuvo saldo derivado |
| Pruebas | Matriz enlazada, pruebas puras identificadas como tales; Auth/Storage/API/JWT y carreras reales, CI por impacto |
| Resultado | Ver evidencia. No se inventa comprensión, revisión o aprobación humana/docente; la revisión independiente de la entrega queda registrada por su responsable |

Fuera de alcance: EPT-112 a EPT-116, recibos PDF, correos, reportes, cron, despliegue y datos productivos.
