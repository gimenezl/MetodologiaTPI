# EPT-110 · Consultar inscripciones y facturas por período (RF12, RF14)

Tarjeta: EPT-110 (P3-T25), padre EPT-72. Dependencias en Listo: EPT-105 (acceso por rol), EPT-104 (facturas),
EPT-109 (comprobantes), EPT-80 (visibilidad económica). Evidencia y matriz de trazabilidad:
[`docs/evidence/EPT-110.md`](../../evidence/EPT-110.md).

Precedencia aplicada: decisiones humanas explícitas (comentario 10317 de la tarjeta y `registro-decisiones.md`) →
PDF aprobado → Jira → realidad técnica del repositorio.

## Qué entrega

Tres lecturas de **solo lectura**, una pantalla nativa para cada familia de datos y las pruebas de acceso reales.
No hay altas, modificaciones ni cancelaciones de inscripciones, no hay aprobación de pagos ni generación de
recibos, no se carga ningún comprobante nuevo y no se ofrece el archivo original.

| Lectura | Función pública | Qué devuelve |
|---|---|---|
| Inscripciones | `consultar_inscripciones_alumno(p_alumno_id)` | Una fila por inscripción a deporte, transporte (recorrido) o comedor, activa o cancelada, con el nombre **actual** del catálogo, el grupo y nivel del deporte, si el catálogo sigue activo y las fechas de alta y baja. |
| Facturas por período | `consultar_facturas_periodo(p_alumno_id, p_desde, p_hasta)` | Facturas cuyo período (mes calendario) cae en el rango, con el estado y el saldo de `estado_cuotas_alumno` (EPT-107) y la cantidad de pagos y de archivos relacionados con cada una. |
| Registro de comprobantes | `consultar_registro_comprobantes(p_alumno_id, p_criterio, p_desde, p_hasta)` | Una fila **por pago** con estado, fecha de transferencia informada, importes en centavos, cantidad de archivos, fecha del último archivo y todos los períodos de factura que el pago cubre. |

## Semántica temporal

Tres fechas distintas que la aplicación nunca intercambia ni reemplaza una por otra:

| Fecha | Origen | Cómo se filtra |
|---|---|---|
| Período de factura | `facturas.periodo` (primer día del mes) | Por **mes calendario**, extremos inclusivos: `desde = 15/12/2025` incluye el período de diciembre y `hasta = 02/01/2026` incluye el de enero. Criterio `PERIODO_FACTURA`. |
| Fecha de transferencia | `pagos.fecha_transferencia`, la que informó la familia | Extremos inclusivos sobre la fecha informada. Criterio `FECHA_TRANSFERENCIA`. Un pago sin fecha informada **no entra**: no se sustituye por el alta ni por el vencimiento. |
| Fecha de carga del archivo | `comprobantes_pago.creado_en` | Solo informativa («Último archivo cargado el»). No filtra nada. |

Las facturas siempre se filtran por su período. Los comprobantes se filtran por uno de los dos criterios, que el
formulario nombra y explica; el título del resultado dice cuál se usó.

Validación del rango: fechas civiles reales (se rechaza `30/02`), `desde ≤ hasta`, ambos extremos presentes. La
aplicación valida antes de consultar y el servidor vuelve a validar (`P6870` parámetro ausente o criterio
desconocido, `P6871` rango invertido, `22008` fecha inexistente). Las fechas con hora se convierten a fecha civil de
Argentina (UTC−3, sin horario de verano), no a la del teléfono.

### Sin doble conteo

Un pago puede cubrir varias facturas y tener varios archivos. Los conteos se obtienen por subconsultas sobre el
conjunto **distinto** de pagos; ningún importe pasa por un `JOIN` con `comprobantes_pago` ni con
`imputaciones_pago`. Los importes salen de `estado_cuotas_alumno` (facturas) o del propio pago (registro) y viajan
como centavos enteros. Un pago multifactura figura **una vez** en el registro y aparece en cada una de sus facturas
con el mismo archivo contado; eso describe una relación, no suma importes.

## Seguridad

- **Quién lee qué.** El alcance lo decide la base con `app_private.alumno_economico_visible` (EPT-101):
  DIRECTOR habilitado, PADRE habilitado con vínculo vigente **hoy** con ese alumno, ESTUDIANTE habilitado solo sobre
  su propio perfil. PERSONAL, DOCENTE, una cuenta bloqueada, un vínculo revocado y `anon` no reciben nada.
- **Sin filtración.** Un alumno ajeno, inexistente o nulo devuelve cero filas, indistinguibles entre sí. Los errores
  de permiso muestran un mensaje genérico y nunca el detalle del servidor.
- **Patrón del proyecto.** Auxiliar `app_private` `SECURITY DEFINER` con `search_path` vacío y envoltorio público
  `SECURITY INVOKER`. `EXECUTE` solo para `authenticated`. Funciones `STABLE`: no hay DML.
- **No se abrió la RLS de las tablas.** Para que el padre lea inscripciones, grupos, perfiles y catálogos de otras
  personas habría que ampliar políticas de varias tablas; la RPC devuelve solo las columnas necesarias. El padre
  sigue sin poder leer `inscripciones_*` directamente (comprobado).
- **Original del comprobante.** El registro **no** contiene ruta, tipo, tamaño, cargador ni contenido
  (`comprobantes_pago` conserva su política: cargador y DIRECTOR). **La aplicación no ofrece abrir ni descargar el
  original.** Decisión: la ruta web existente de archivos usa cookies y redirige a una URL firmada; no admite Bearer
  móvil, y adaptarla (o firmar URLs desde el dispositivo) amplía la superficie de un secreto sin que esta tarjeta lo
  exija. El criterio de aceptación pide *mantener* el acceso condicionado a P3-DG01, no crear uno nuevo.
- **Escritura.** Ningún rol de aplicación recibe privilegios nuevos; la escritura directa sobre `inscripciones_*`
  sigue denegada (probado con padre y estudiante reales).

## Aplicación móvil

- `mobile/src/servicios/consultas-familia.ts`: llamadas, análisis estricto de respuestas, fechas civiles y rangos.
- `mobile/src/contenedores/consultas/`: `InscripcionesContenedor`/`Vista` y `PeriodoContenedor`/`Vista`
  (contenedor + presentacional), con un selector de hijo reutilizable.
- Dos pestañas nuevas en la cuenta móvil: **Por período** e **Inscripciones**. El padre elige un hijo; el estudiante
  no ve selector y opera solo sobre su alumno.
- Cada respuesta queda atada a (hijo, rango, criterio, intento, recarga). Una respuesta tardía **no se muestra bajo
  otro contexto aunque su petición ya se hubiera cancelado**: la cancelación es una optimización, la clave de la
  respuesta es la garantía. Cambiar de hijo descarta la consulta aplicada; un rango inválido no deja resultados
  de otro rango; cambiar el criterio vuelve a pedir solo los comprobantes.
- El contexto de la pantalla se eleva a la pantalla de acceso: un refresco de token o una revalidación no pierde lo
  escrito; un cambio de cuenta (otra clave usuario+rol) lo descarta. Reanudar la aplicación repite la consulta.
- Estados diferenciados: cargando, vacío por familia de datos, sin vínculos, error con reintento, permiso
  insuficiente (sin reintento y sin revelar existencia), dato no disponible («No informada», «No informado», «Sin
  archivos»).
- Se preservan PKCE y recuperación (EPT-106), flecha y gesto de volver sin duplicación, pestañas deslizables,
  carga e imágenes de EPT-109 y el contexto de pagos y comprobantes.

## Lo que la aplicación no afirma

- Los nombres de deportes, grupos y recorridos son los **vigentes hoy** en el catálogo; el sistema no conserva cómo
  se llamaban cuando la persona se inscribió, y la pantalla lo dice.
- Una inscripción cancelada o un catálogo inactivo **se muestran** (con insignia «Cancelada» o aviso). Un cambio de
  nivel del alumno no oculta sus inscripciones previas.
- No hay historial de inscripciones por período de factura, ni snapshots, ni prorrateos. La relación entre una
  inscripción y una factura existe en los ítems de la factura, que esta tarjeta no reinterpreta.

## Migración

Una migración nueva, aditiva y de solo funciones: `20261017120000_ept_110_consultas_periodo_inscripciones.sql`.
No toca tablas, columnas, políticas ni privilegios existentes. **Sin aplicar a producción.**

Rollback: `DROP FUNCTION` de las siete funciones (tres públicas, tres de `app_private` y `validar_rango_fechas`);
la aplicación móvil queda con las pestañas en estado de error con reintento, sin pérdida de datos.

## Bitácora académica

Registro de los aportes de IA de la unidad. **No hay aprobación docente registrada ni inventada.**

| Campo | Contenido |
|---|---|
| Tarjeta | EPT-110 · Consultar inscripciones y facturas por período (RF12, RF14). |
| Problema | El padre no podía consultar desde la app las inscripciones de sus hijos (la RLS de 013/014 solo permite estudiante propio y Dirección) ni las facturas y comprobantes por rango de fechas; había que distinguir período de factura, fecha de transferencia y fecha de carga sin duplicar importes ni exponer archivos. |
| Prompt | Encargo de Lucas Gimenez del 17/10/2026 (misión de extremo a extremo de EPT-110) con alcance, seguridad, semántica temporal, pruebas reales y reglas de entrega. |
| Respuesta | Claude Code (Sonnet 5.5): tres RPC de lectura con guarda de alcance, pantallas nativas, suite SQL, etapa de integración real, escenarios Maestro y documentación. Una revisión independiente acotada con un segundo agente (ver evidencia). |
| Comprensión | Se leyeron las migraciones de 013, 014, EPT-100/101, EPT-107 y EPT-109 y los patrones existentes (envoltorio `SECURITY INVOKER`, auxiliar privado, guarda `alumno_economico_visible`) antes de escribir; se descartó abrir políticas RLS y exponer el original. |
| Adaptación | Los períodos de las pruebas de integración son fijos (2030) para no depender de la fecha del runner; el filtro por período es por mes calendario; el rango inicial de la pantalla es el año del dispositivo (comodidad, no regla de negocio); no se ofrece el original (ver «Seguridad»). |
| Prueba | Suite SQL de 46 comprobaciones y las 32 suites SQL registradas; etapa de integración con Auth, RLS y RPC reales; Jest (servicio y contenedores); Maestro Android; selector de CI. |
| Resultado | Ver [`docs/evidence/EPT-110.md`](../../evidence/EPT-110.md). |
