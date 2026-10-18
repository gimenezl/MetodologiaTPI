# EPT-112: matriz de aceptación

Los nombres de prueba refieren a afirmaciones ejecutables de `supabase/tests/reportes_economicos.mjs`, salvo donde se indica otra suite. No son aprobaciones humanas.

| RF / criterio | Consulta / servidor / UI | Prueba y evidencia |
|---|---|---|
| RF17, aprobados entre fechas | Rama ingresos de `reporte_economico`; API económica; pantalla ingresos | Pago multifactura con varios archivos cuenta una vez; pendientes/rechazados fuera; fecha exacta de un día y cambio de año |
| Informado ≠ imputado | NUMERIC por pago/imputaciones, centavos texto; totales separados | 45900 informado, 46000 imputado, diferencia -100; detalle reconcilia |
| RF18 por factura | Saldo vigente EPT-107, no monto del pago ni etiqueta Vencida | Factura cubierta por dos pagos; pago multifactura en clasificaciones diferentes; factura cero sin transferencia ficticia |
| RF19 con y sin aprobados | Relación pago-factura o vencimiento, ausencia histórica de aprobados | Saldo 4000; facturas sin pago, con pendiente y con rechazado; no confundir intervalo sin aprobados con historia sin aprobados |
| RF20 deporte/nivel/horario/profesor | Ítem → inscripción → grupo, horarios preagregados; filtros reales | Dos horarios, una imputación 2000, profesor trazable; inscripción cancelada conservada |
| RF21 recorrido facturado | Ítem → inscripción servicio → recorrido | Imputación 2000; recorrido actual distinto no reemplaza referencia histórica |
| Matrícula histórica | Auxiliar privado de día civil completo | Curso anterior, cambio intradía, alta exacta a medianoche, cierre con siguiente alta a medianoche, fechas fuera de historia |
| Cobertura temporal insuficiente | Intersecciones de matrícula sin hora de transferencia supuesta | Alta o cierre intradía sin cobertura completa; causa insuficiente |
| Curso no determinable | Causa distinguible y filtros; importes retenidos | Varias matrículas y falta de historia; detalle/grupo/totales reconcilian; decisión humana documentada |
| División no duplica grupos | Nivel + denominación | Dos matrículas en distintas divisiones tienen iguales claves de agrupación |
| Precisión y varias páginas | NUMERIC global y centavos texto; BigInt de presentación | 9010 pagos máximos, total 9009999999990990 centavos; páginas 25 sin IDs repetidos ni total de página |
| Solo lectura | RPC STABLE/INVOKER | Huella económica de pagos/ítems/imputaciones idéntica antes/después de filtros y lecturas |
| Aprobación concurrente | Una instantánea por documento | Conexiones psql y barrera comprobada con `pg_blocking_pids`; respuesta anterior íntegra, posterior íntegra; API409 entre páginas |
| Rechazo concurrente | Solo APROBADO y activa | Rechazo real durante lectura detenida; pendientes y rechazados no ingresan en filas/totales |
| DIRECTOR habilitado | getUser + rol/bloqueo; guarda DB antes de datos | Auth real + cookies Next + JWT PostgREST sobre los cinco reportes |
| Roles denegados | Misma guarda también por RPC directa | Padre, estudiante, docente, personal, bloqueado, segunda familia, otro alumno y anónimo; ID desconocido no revela existencia |
| RLS previa y originales | Sin cambios de RLS ni Storage | Familia propia conserva facturas, otra familia no; respuestas sin rutas, URLs ni datos bancarios |
| ACL y superficie | Grants explícitos, sin actor cliente | `reportes_economicos_rls.sql`; `usuarios_permisos_rls.sql` registra RPC nueva y matriz de actores |
| Validaciones | Librería pura, servidor y RPC | `reportes-economicos-lib.spec.ts`: fechas reales, rango, repetidos, desconocidos, inaplicables, límites; API reales inválidas |
| UI cinco reportes | Índice diferenciado, filtros y tabla | Modo `--ui`: navegación de cinco reportes, fechas, vacío, error real por retiro/restauración temporal de EXECUTE, reintento, permiso padre, navegación anterior retenida sin sustituir contexto nuevo y viewport390 (también con tabla) |
| Regresión académica | Se mantienen seis IDs, servicio y SQL anteriores | `reportes-lib.spec.ts` local; suites `reportes-auth`/`reportes` conservadas en familia focal de CI |
| Selector real | Alias nuevos, suites explícitas, tipos compartidos | Prueba EPT112 en `scripts/ci/impact.test.mjs`; API, servicio, UI y pruebas seleccionan familia reportes; tipos activan móvil |
| Compilación y tipos | Regeneración normalizada y sincronización | `tsc`, lint, build, generador dos veces y sincronizador; resultados en evidencia |

Teléfono real, recuperación por correo y retorno nativo, TalkBack/VoiceOver, texto ampliado y accesibilidad física permanecen aplazados por el usuario. No forman evidencia realizada; no se aplazan automatización, seguridad ni CI.
