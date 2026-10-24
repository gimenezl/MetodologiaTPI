# EPT-113: historial de pagos y recibos institucionales

La aprobación crea una identidad única y una fuente canónica privada en la misma transacción económica. La descarga deriva un PDF en servidor después del commit. No hay bucket, cron, correo ni aplicación de migraciones remotas.

## Recorrido y superficies

- **Familia web:** `Mis hijos`, historial por hijo y rango. **Estudiante web:** `Mi legajo`, solo identidad propia, sin selector, selección de ítems ni carga. **Dirección:** `Comprobantes`, búsqueda de pago y consulta por estudiante.
- **Móvil:** amplía `Por período`, conserva los dos filtros existentes y el aislamiento de cuenta, hijo, criterio, intento y recarga. Los estados pendientes y rechazados siguen visibles.
- **Descarga:** acción explícita. En web guarda el PDF validado; en móvil abre el menú nativo para guardar o compartir, y limpia el temporal privado al cerrarlo.

## Original y recibo son recursos diferentes

| Actor habilitado | Transferencia original | Recibo institucional |
|---|---|---|
| Cargador con autorización vigente | Sí | Sí, con vínculo vigente |
| Copadre vinculado | No, salvo su propio archivo | Sí |
| Estudiante propio | No | Sí |
| Dirección | Sí | Sí |
| Familia ajena, PERSONAL, DOCENTE, anónimo, bloqueado, vínculo revocado | No fuera del alcance existente | No |

El PDF no incorpora el original, su ruta, el cargador, correo, DNI, número de operación ni secretos. No modifica las políticas del original.

## Emisión, fechas y numeración

1. `verificar_pago` conserva el orden **perfil del actor FOR SHARE → pago FOR UPDATE → ítems ordenados FOR UPDATE**.
2. Después de aplicar la aprobación y sus imputaciones crea el recibo y su fuente en `app_private.recibos_fuente`. Si falla esta escritura se revierte toda la aprobación nueva.
3. `UNIQUE(pago_id)` impide más de un recibo por pago, incluso multifactura o multiarchivo. La secuencia privada asigna un número positivo y único; permite huecos, no es numeración fiscal ni se reinicia anualmente.
4. La repetición de una aprobación conserva verificador, fecha y motivo originales, y recupera una emisión faltante antes del retorno idempotente.
5. `recuperar_recibo(pago_id)` permite a Dirección emitir un aprobado anterior sin reaprobarlo ni modificar importes. No hay backfill automático ni ejecución productiva en esta unidad.

La fecha de transferencia informada, la aprobación y la emisión actual son diferentes. No se sustituye una fecha ausente por otra. El nombre y los catálogos se capturan con los datos disponibles **al emitir**; no se afirma una reconstrucción retrospectiva de nombres que nunca se guardaron.

Un registro de recibo preexistente sin fuente requiere conciliación institucional (`P6892`), no borrado ni otro número. El historial no presenta ese registro como descargable. Una fuente ausente para una identidad ya existente tampoco se inventa silenciosamente.

## Contenido canónico y dinero

La fuente guarda versión, institución conocida, identidad del recibo/pago/alumno, nombre del alumno al emitir, fechas diferenciadas, ítems, facturas, períodos, concepto/descripción disponibles e importes históricos de `imputaciones_pago`. No contiene el saldo actual de una factura.

| Magnitud | Semántica |
|---|---|
| Importe imputado | Suma exacta de imputaciones históricas completas, no tarifas actuales |
| Importe informado | Transferencia informada por la familia, sin prorratear |
| Diferencia | Informado menos imputado; no se suma como otro pago |
| Pendiente/rechazado | Ítems seleccionados, no abonados; imputaciones inactivas conservadas y rotuladas |

SQL calcula en NUMERIC y emite importes canónicos como texto decimal. El renderer valida forma, suma y diferencia usando enteros exactos. Número de recibo BIGINT viaja como texto. La aplicación móvil mantiene su contrato de centavos enteros seguros y rechaza respuestas fuera de rango.

## PDF y dependencias

- `pdf-lib@1.17.1` y `@pdf-lib/fontkit@1.1.1`, MIT. Sin Chromium, binarios nativos, servicios externos ni secretos. El tamaño npm descomprimido declarado es 19.461.112 y 4.299.890 bytes respectivamente; no equivale al tamaño trazado de despliegue.
- Se reutiliza Outfit Regular (54.912 bytes, OFL ya incluida en `mobile/assets/fonts`) e incrusta un subconjunto. La configuración de Next incluye explícitamente esa fuente en el trazado del endpoint.
- Renderer solo servidor. Ni generador ni módulos Node llegan al paquete móvil. A4, márgenes, ajuste de texto incluso sin espacios, páginas consecutivas, encabezado repetido y total sin recortes.
- Generación bajo demanda: evita conciliación SQL/Storage. Costo: render en cada descarga. Un fallo del renderer entrega 503 y conserva aprobación, número y fuente; el reintento no emite otra identidad.

Referencias oficiales: [pdf-lib](https://pdf-lib.js.org/), [fuentes personalizadas](https://pdf-lib.js.org/#embed-font-and-measure-text), [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/), [Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/).

## Autorización y transporte

`GET /api/recibos/[reciboId]/pdf` entrega bytes, nunca redirecciones. Admite cookies web y Bearer validado contra Auth; la RPC usa el cliente público con el token del actor, **no service_role**. Autorización vigente en base antes del render y otra vez antes de entregar bytes. No acepta rutas ni URL del cliente.

`consultar_recibo` mantiene bloqueo compartido del perfil, vínculo familiar y pago frente a bloqueo/revocación. Los envoltorios públicos son SECURITY INVOKER; los auxiliares privilegiados viven en esquema privado con search_path vacío y ACL mínimas. Los clientes no leen la fuente por SELECT ni usan la secuencia.

| Respuesta | Situación |
|---|---|
| 400 | Identificador inválido |
| 401 | Sin sesión válida |
| 403 | Recurso no autorizado o indistinguible de inexistente |
| 503 | Auth/base indisponible, fuente por conciliar o PDF no generado |
| 200 application/pdf | PDF validado con no-store y nombre seguro |

La descarga móvil utiliza **expo/fetch**, cuya implementación nativa instalada deshabilita seguimiento antes de reenviar cuando `redirect: error`. No usa el fetch de React Native esperando detectar después una fuga del token. `credentials: omit`, origen configurado controlado, sin tokens en URL, cancelación/timeout, un trabajo a la vez, progreso por bytes, validación de MIME/tamaño/firma/EOF y sesión vigente antes de compartir.

Los temporales se limitan a `Paths.cache/recibos-institucionales`, se eliminan tras uso/fallo y al iniciar/cambiar estado de sesión; un cierre inesperado deja a lo sumo el trabajo pendiente, que se limpia en la siguiente apertura. Una copia que la persona guarda voluntariamente fuera de la app no se puede revocar retroactivamente.

## Paginación y contexto

Móvil recorre el registro saneado en páginas de 200, no acepta silenciosamente el límite PostgREST de 1000 y falla con reconsulta si detecta duplicados durante una lectura cambiante. Web ofrece páginas de 100 y navegación que conserva alumno/rango/criterio. El servidor vuelve a derivar el alumno del estudiante e ignora identificadores ajenos en su superficie propia.

Los filtros siguen siendo `PERIODO_FACTURA` (mes calendario) y `FECHA_TRANSFERENCIA` (fecha informada). Carga, verificación y emisión no reemplazan esos criterios. La paginación por offset es una vista viva, no una exportación transaccional congelada: ante cambios concurrentes de la lista corresponde actualizar la consulta.

## Matriz de aceptación

| Criterio | Implementación | Prueba/evidencia |
|---|---|---|
| RF7 fecha, importes, ítems y estado por hijo | RPC ampliada, historial web y `PeriodoVista` | `recibos_historial.mjs`, SQL EPT-110, Jest consultas |
| Estudiante solo propio, sin carga/selección | Mi legajo y pantalla móvil existente de consulta | UI real con hijo manipulado, negativas API/RLS, Jest |
| Pendientes/rechazados e inactivas visibles | Sin eliminar imputaciones, rótulos seleccionados/no abonados | API real, SQL EPT-110 |
| RF10 aprobación → emisión única → PDF | Migración EPT-113 + renderer + endpoint | Fallo transaccional, aprobación real y descarga cookies/Bearer |
| Un recibo multifactura/multiarchivo | UNIQUE(pago_id), fuente agregada por imputación | API EPT-113 y regresión EPT-111 |
| Repetición y aprobado antiguo | Emisor privado y RPC recuperación de Dirección | API y carreras EPT-113, identidad y fecha sin cambios |
| Dinero histórico exacto y diferencia | NUMERIC/texto y suma decimal validada | API 1000/990/-10, PDF >2^53, tarifas posteriores |
| Snapshot estable y privado | Tabla privada, sin escritura cliente | Renombre y tarifa posterior, pruebas ACL y SELECT negativo |
| Copadre/estudiante reciben recibo, no original | Autorización independiente por recurso | API/RLS EPT-113 y regresión original EPT-111 |
| Bloqueo, rol perdido y vínculo revocado | Guardas vigentes, bloqueo compartido | Negativas con JWT vigente y pg_blocking_pids |
| Descarga móvil real sin fuga Bearer | expo/fetch redirect:error y compartir nativo | Jest binario; Maestro Android con backend real en CI |
| Doble pulsación, red, cancelación y limpieza | Trabajo único, AbortSignal y finally | Jest recibos; menú nativo Android/iOS en CI |
| PDF español, largo y multipágina | Fuente embebida, ajuste y saltos | 9 páginas/75 ítems, parseo y QA visual archivados |
| Historial grande | Páginas 200 móvil /100 web | 1006 registros RPC reales y Jest 6 páginas |
| Regresión económica y privilegios | Contratos existentes conservados | SQL cuotas, reportes, permisos, EPT-110; 18 carreras EPT-111 |
| Tipos y CI por impacto | Generación normalizada y copia móvil, registros CI | Tipos dos generaciones iguales, impact, CI del SHA final pendiente |

## Despliegue y rollback no destructivo

Pendientes conocidos: EPT-110 `20261017120000`, EPT-111 `20261017222738`, EPT-112 `20261018174050` y EPT-113 `20261019162234`. No se consultó ni modificó el ledger productivo. Merge no implica despliegue.

Desplegar solo mediante el procedimiento autorizado del proyecto, respetando el orden de migraciones. No ejecutar backfill remoto desde esta sesión. Recuperar aprobados anteriores exclusivamente mediante Dirección autenticada o un procedimiento institucional revisado que conserve identidad y contenido existentes.

Rollback: retirar/deshabilitar controladamente botones y consulta nueva, manteniendo compatibilidad de las RPC existentes y el renderer mientras haya clientes que lo usen. **No** borrar recibos/fuentes/pagos, reiniciar secuencia, revertir aprobaciones ni reescribir historia. Una falla de render se corrige hacia adelante sobre el renderer, no eliminando la emisión.

Fuera de alcance: EPT-114/115, correos, cron, facturación nueva, despliegue productivo y cierre de EPT-73. Las pruebas personales posteriores de teléfono físico, correo/retorno nativo, TalkBack/VoiceOver y texto ampliado siguen pendientes, sin afirmar aprobación académica.
