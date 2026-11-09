# Evidencia Kanban — tablero real del proyecto EPT

Fuente: Jira del proyecto EPT (grupo12-utn.atlassian.net), consultado el 2026-11-09 mediante JQL `project = EPT`. Los datos son una instantánea de esa fecha; el tablero cambia y este archivo no se actualiza solo.

Flujo vigente: Por hacer / En curso / Listo (Testing es una puerta de evidencia, no un estado).

## Resumen

| Alcance | Listo | En curso | Por hacer | Total |
|---|---|---|---|---|
| Tarjetas de trabajo (sin épicas) | 144 | 0 | 6 | 150 |
| Épicas (14) | 8 | 0 | 6 | 14 |
| Todo el proyecto | 152 | 0 | 12 | 164 |

Observación: las épicas P3-EP2 a P3-EP7 figuran en Por hacer en Jira aunque la mayoría de sus tarjetas hijas están en Listo; el estado de las épicas no se actualizó. Se informa tal cual.

## Conteo por épica

| Épica | Estado de la épica | Listo | En curso | Por hacer | Total |
|---|---|---|---|---|---|
| EPT-1 Base del proyecto y documentación | Listo | 5 | 0 | 0 | 5 |
| EPT-2 Administración académica | Listo | 10 | 0 | 0 | 10 |
| EPT-3 Legajos y usuarios | Listo | 9 | 0 | 0 | 9 |
| EPT-4 Servicios escolares | Listo | 8 | 0 | 0 | 8 |
| EPT-5 Actividades deportivas | Listo | 16 | 0 | 0 | 16 |
| EPT-6 Portal de padres | Listo | 7 | 0 | 0 | 7 |
| EPT-7 Reportes, credencial QR, integración y entrega | Listo | 6 | 0 | 0 | 6 |
| EPT-69 [P3-EP1] Planificar y documentar la Parte 3 | Listo | 15 | 0 | 0 | 15 |
| EPT-70 [P3-EP2] Modelar y diseñar la integración web-móvil | Por hacer | 9 | 0 | 0 | 9 |
| EPT-71 [P3-EP3] Preparar la plataforma y la facturación compartida | Por hacer | 5 | 0 | 1 | 6 |
| EPT-72 [P3-EP4] Consultar información familiar desde la aplicación móvil | Por hacer | 22 | 0 | 0 | 22 |
| EPT-73 [P3-EP5] Registrar y verificar pagos con comprobantes privados | Por hacer | 17 | 0 | 0 | 17 |
| EPT-74 [P3-EP6] Automatizar recordatorios y avisos de deuda | Por hacer | 8 | 0 | 0 | 8 |
| EPT-75 [P3-EP7] Verificar, desplegar y entregar la Parte 3 | Por hacer | 7 | 0 | 5 | 12 |

Las subtareas se cuentan bajo la épica de su historia.

## Tarjetas por épica

### EPT-1 — Base del proyecto y documentación

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-50 | Corregir y validar el plan de trabajo | Tarea | Listo | EPT-1 |
| EPT-51 | Reformular los 21 requerimientos funcionales y los 2 no funcionales | Tarea | Listo | EPT-1 |
| EPT-52 | Actualizar el MER, los casos de uso y las dependencias | Tarea | Listo | EPT-1 |
| EPT-53 | Corregir las seis historias de usuario priorizadas | Tarea | Listo | EPT-1 |
| EPT-54 | Ajustar el prototipo responsive y la arquitectura | Tarea | Listo | EPT-1 |

### EPT-2 — Administración académica

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-8 | HU1 – Administrar cursos | Historia | Listo | EPT-2 |
| EPT-14 | 1. Verificar la migración de niveles y crear la migración de cursos con claves y unicidad | Subtarea | Listo | EPT-2 |
| EPT-15 | 2. Implementar las consultas y el servicio del lado del servidor para altas, cambios e inactivación | Subtarea | Listo | EPT-2 |
| EPT-16 | 3. Construir el listado y el formulario responsive con validación de datos | Subtarea | Listo | EPT-2 |
| EPT-17 | 4. Aplicar la autorización del director en el servidor y en la base | Subtarea | Listo | EPT-2 |
| EPT-18 | 5. Ejecutar pruebas de alta, edición, duplicado, nivel inexistente e inactivación | Subtarea | Listo | EPT-2 |
| EPT-19 | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Subtarea | Listo | EPT-2 |
| EPT-55 | RF4 – Administrar niveles educativos | Tarea | Listo | EPT-2 |
| EPT-56 | RF2 – Administrar materias | Tarea | Listo | EPT-2 |
| EPT-57 | RF3 – Administrar horarios de materias y cursos | Tarea | Listo | EPT-2 |

### EPT-3 — Legajos y usuarios

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-9 | HU7 – Actualizar información académica del alumno | Historia | Listo | EPT-3 |
| EPT-20 | 1. Agregar a la migración la relación del alumno con su curso y su estado académico | Subtarea | Listo | EPT-3 |
| EPT-21 | 2. Corregir los tipos y servicios de perfiles sin asumir cambios no versionados en la base | Subtarea | Listo | EPT-3 |
| EPT-22 | 3. Extender el formulario y el listado de legajos para mostrar curso, nivel derivado y estado | Subtarea | Listo | EPT-3 |
| EPT-23 | 4. Revisar la creación y edición de usuarios y perfiles para evitar duplicados por DNI | Subtarea | Listo | EPT-3 |
| EPT-24 | 5. Probar curso inválido, cambio de curso, cambio de estado y persistencia del legajo | Subtarea | Listo | EPT-3 |
| EPT-25 | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Subtarea | Listo | EPT-3 |
| EPT-58 | RF8 – Administrar profesores | Tarea | Listo | EPT-3 |
| EPT-59 | RF19 – Administrar usuarios y permisos | Tarea | Listo | EPT-3 |

### EPT-4 — Servicios escolares

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-10 | HU9 – Inscribirse al comedor | Historia | Listo | EPT-4 |
| EPT-26 | 1. Diseñar las tablas de servicios e inscripciones con unicidad por alumno y servicio | Subtarea | Listo | EPT-4 |
| EPT-27 | 2. Implementar el alta y la baja de comedor mediante un servicio del lado del servidor | Subtarea | Listo | EPT-4 |
| EPT-28 | 3. Construir la pantalla del alumno y la consulta administrativa de inscriptos | Subtarea | Listo | EPT-4 |
| EPT-29 | 4. Preparar la estructura reutilizable para los cuatro recorridos de transporte | Subtarea | Listo | EPT-4 |
| EPT-30 | 5. Probar alta, duplicado, baja, reingreso y asociación con el legajo | Subtarea | Listo | EPT-4 |
| EPT-31 | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Subtarea | Listo | EPT-4 |
| EPT-60 | RF5 y RF10 – Administrar el transporte y sus cuatro recorridos | Tarea | Listo | EPT-4 |

### EPT-5 — Actividades deportivas

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-11 | HU11 – Inscribirse a deportes | Historia | Listo | EPT-5 |
| EPT-12 | HU12 – Consultar compatibilidad horaria | Historia | Listo | EPT-5 |
| EPT-32 | 1. Completar el modelo de deportes, grupos, nivel, cupo y profesor responsable | Subtarea | Listo | EPT-5 |
| EPT-33 | 2. Corregir la migración y las políticas de inscripciones antes de usar el flujo del cliente | Subtarea | Listo | EPT-5 |
| EPT-34 | 3. Implementar el listado por nivel y el alta y la baja de inscripción | Subtarea | Listo | EPT-5 |
| EPT-35 | 4. Aplicar la regla de máximo dos inscripciones activas en el servidor y en la base | Subtarea | Listo | EPT-5 |
| EPT-36 | 5. Probar uno, dos y un tercer deporte, duplicado y baja con nueva disponibilidad | Subtarea | Listo | EPT-5 |
| EPT-37 | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Subtarea | Listo | EPT-5 |
| EPT-38 | 1. Crear la migración de horarios y su relación con los grupos deportivos | Subtarea | Listo | EPT-5 |
| EPT-39 | 2. Implementar una función única de comparación de intervalos en el servidor y en la base | Subtarea | Listo | EPT-5 |
| EPT-40 | 3. Integrar la validación al alta realizada por el alumno o por el administrador | Subtarea | Listo | EPT-5 |
| EPT-41 | 4. Mostrar el deporte, el día y el rango que originan el conflicto | Subtarea | Listo | EPT-5 |
| EPT-42 | 5. Probar días distintos, intervalos superpuestos, contenidos y contiguos | Subtarea | Listo | EPT-5 |
| EPT-43 | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Subtarea | Listo | EPT-5 |
| EPT-61 | RF18 – Administrar deportes y grupos | Tarea | Listo | EPT-5 |
| EPT-62 | RF16 – Administrar inscripciones | Tarea | Listo | EPT-5 |

### EPT-6 — Portal de padres

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-13 | HU15 – Inscribir un hijo al cursado | Historia | Listo | EPT-6 |
| EPT-44 | 1. Crear y versionar la tabla padre-hijo que el código actual presupone | Subtarea | Listo | EPT-6 |
| EPT-45 | 2. Implementar la consulta de hijos y el aislamiento de los datos autorizados | Subtarea | Listo | EPT-6 |
| EPT-46 | 3. Construir la selección de hijo, de curso y la confirmación de matrícula | Subtarea | Listo | EPT-6 |
| EPT-47 | 4. Impedir el curso múltiple, el duplicado y el acceso a alumnos ajenos | Subtarea | Listo | EPT-6 |
| EPT-48 | 5. Ejecutar pruebas E2E con padre válido, hijo ajeno, duplicado y curso inválido | Subtarea | Listo | EPT-6 |
| EPT-49 | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Subtarea | Listo | EPT-6 |

### EPT-7 — Reportes, credencial QR, integración y entrega

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-63 | RF17 – Generar los reportes oficiales de la Dirección | Tarea | Listo | EPT-7 |
| EPT-64 | RF20 – Emitir la credencial digital QR | Tarea | Listo | EPT-7 |
| EPT-65 | RF21 – Registrar accesos con QR | Tarea | Listo | EPT-7 |
| EPT-66 | Integrar los módulos y normalizar las migraciones | Tarea | Listo | EPT-7 |
| EPT-67 | Ejecutar las pruebas funcionales, por rol y E2E | Tarea | Listo | EPT-7 |
| EPT-68 | Desplegar, documentar y presentar | Tarea | Listo | EPT-7 |

### EPT-69 — [P3-EP1] Planificar y documentar la Parte 3

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-76 | [P3-T01] Definir el equipo y el alcance de la Parte 3 | Tarea | Listo | EPT-69 |
| EPT-77 | [P3-T02] Inventariar el sistema de gestión existente | Tarea | Listo | EPT-69 |
| EPT-78 | [P3-T07] Registrar y trazar los 21 requisitos funcionales | Tarea | Listo | EPT-69 |
| EPT-79 | [P3-T08] Registrar y trazar los siete requisitos no funcionales | Tarea | Listo | EPT-69 |
| EPT-80 | [P3-DG01] Precisar visibilidad y roles económicos | Tarea | Listo | EPT-69 |
| EPT-81 | [P3-T03] Documentar actores y accesos por canal | Tarea | Listo | EPT-69 |
| EPT-82 | [P3-T04] Documentar el objetivo SMART | Tarea | Listo | EPT-69 |
| EPT-83 | [P3-DG02] Precisar factura, período, tarifa y vencimiento | Tarea | Listo | EPT-69 |
| EPT-84 | [P3-DG03] Precisar semántica del pago y comprobante | Tarea | Listo | EPT-69 |
| EPT-85 | [P3-DG04] Precisar calendario y notificación mensual | Tarea | Listo | EPT-69 |
| EPT-86 | [P3-DG05] Precisar filtros de los cinco reportes | Tarea | Listo | EPT-69 |
| EPT-87 | [P3-DG06] Reconciliar calendario con inicio real y capacidad individual | Tarea | Listo | EPT-69 |
| EPT-88 | [P3-T05] Consolidar cronograma, Gantt y PERT | Tarea | Listo | EPT-69 |
| EPT-89 | [P3-T06] Configurar Jira/Kanban y la bitácora de IA | Tarea | Listo | EPT-69 |
| EPT-90 | [P3-T09] Validar requisitos frente al sistema y al plan | Tarea | Listo | EPT-69 |

### EPT-70 — [P3-EP2] Modelar y diseñar la integración web-móvil

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-91 | [P3-T10] Modelar la ampliación entidad-relación económica | Tarea | Listo | EPT-70 |
| EPT-92 | [P3-T11] Documentar seis historias priorizadas con tareas y aceptación | Tarea | Listo | EPT-70 |
| EPT-93 | [P3-T12] Documentar seis casos de uso | Tarea | Listo | EPT-70 |
| EPT-94 | [P3-T13] Diagramar las seis secuencias app-API-base de datos | Tarea | Listo | EPT-70 |
| EPT-95 | [P3-T14] Diseñar wireframes y mockups móviles con Stitch | Tarea | Listo | EPT-70 |
| EPT-96 | [P3-T15] Construir el prototipo navegable | Tarea | Listo | EPT-70 |
| EPT-97 | [P3-T16] Documentar arquitectura de información y software | Tarea | Listo | EPT-70 |
| EPT-98 | [P3-T17] Definir contrato de integración web-móvil | Tarea | Listo | EPT-70 |
| EPT-99 | [P3-T18] Definir componentes reutilizables móviles | Tarea | Listo | EPT-70 |

### EPT-71 — [P3-EP3] Preparar la plataforma y la facturación compartida

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-100 | [P3-T19] Crear migraciones SQL del módulo económico | Tarea | Listo | EPT-71 |
| EPT-101 | [P3-T20] Definir RLS y almacenamiento privado | Tarea | Listo | EPT-71 |
| EPT-102 | [P3-T21] Configurar proyecto Expo en mobile | Tarea | Listo | EPT-71 |
| EPT-103 | [P3-T22] Gestionar tarifas desde la web (RF4) | Tarea | Listo | EPT-71 |
| EPT-104 | [P3-T23] Generar facturas mensuales (RF5) | Tarea | Listo | EPT-71 |
| EPT-164 | [P3-R01] Definir el flujo de alta de vínculos padre-hijo para la app | Tarea | Por hacer | EPT-71 |

### EPT-72 — [P3-EP4] Consultar información familiar desde la aplicación móvil

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-105 | [P3-HU1] Inicio de sesión y acceso por rol en la app | Historia | Listo | EPT-72 |
| EPT-106 | [P3-T24] Recuperar y cambiar contraseña (RF2) | Tarea | Listo | EPT-72 |
| EPT-107 | [P3-HU6] Consulta de cuotas | Historia | Listo | EPT-72 |
| EPT-110 | [P3-T25] Consultar inscripciones y facturas por período (RF12, RF14) | Tarea | Listo | EPT-72 |
| EPT-114 | [P3-HU13] Historial de deuda por ítem | Historia | Listo | EPT-72 |
| EPT-129 | [P3-HU1-T1] Configurar el cliente de Supabase en la app con almacenamiento seguro de la sesión. | Subtarea | Listo | EPT-72 |
| EPT-130 | [P3-HU1-T2] Construir la pantalla de inicio de sesión con validación. | Subtarea | Listo | EPT-72 |
| EPT-131 | [P3-HU1-T3] Obtener el rol desde la tabla perfiles y armar la navegación por rol. | Subtarea | Listo | EPT-72 |
| EPT-132 | [P3-HU1-T4] Dirigir a la web a los roles sin funcionalidades en la app. | Subtarea | Listo | EPT-72 |
| EPT-133 | [P3-HU1-T5] Implementar el cierre de sesión y la expiración de la sesión. | Subtarea | Listo | EPT-72 |
| EPT-134 | [P3-HU1-T6] Probar el ingreso con usuarios de cada rol. | Subtarea | Listo | EPT-72 |
| EPT-135 | [P3-HU6-T1] Crear la vista del estado de cuotas por alumno con el saldo calculado. | Subtarea | Listo | EPT-72 |
| EPT-136 | [P3-HU6-T2] Desarrollar el servicio de consulta de cuotas en la app. | Subtarea | Listo | EPT-72 |
| EPT-137 | [P3-HU6-T3] Construir la pantalla con selector de hijo y pestañas Pendientes / Pagadas. | Subtarea | Listo | EPT-72 |
| EPT-138 | [P3-HU6-T4] Mostrar el detalle de la cuota con sus ítems. | Subtarea | Listo | EPT-72 |
| EPT-139 | [P3-HU6-T5] Resaltar las cuotas vencidas. | Subtarea | Listo | EPT-72 |
| EPT-140 | [P3-HU6-T6] Escribir la prueba de la política de acceso. | Subtarea | Listo | EPT-72 |
| EPT-153 | [P3-HU13-T1] Crear la vista de deuda por ítem y por período. | Subtarea | Listo | EPT-72 |
| EPT-154 | [P3-HU13-T2] Desarrollar el servicio de consulta en la app. | Subtarea | Listo | EPT-72 |
| EPT-155 | [P3-HU13-T3] Construir la pantalla agrupada por ítem con el total adeudado. | Subtarea | Listo | EPT-72 |
| EPT-156 | [P3-HU13-T4] Agregar el filtro por rango de fechas. | Subtarea | Listo | EPT-72 |
| EPT-157 | [P3-HU13-T5] Escribir la prueba de consistencia con los reportes de la web. | Subtarea | Listo | EPT-72 |

### EPT-73 — [P3-EP5] Registrar y verificar pagos con comprobantes privados

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-108 | [P3-HU8] Selección de ítems a pagar | Historia | Listo | EPT-73 |
| EPT-109 | [P3-HU9] Carga de comprobantes de transferencia | Historia | Listo | EPT-73 |
| EPT-111 | [P3-T26] Verificar comprobantes desde la web (RF11) | Tarea | Listo | EPT-73 |
| EPT-112 | [P3-T27] Construir los cinco reportes económicos web (RF17-RF21) | Tarea | Listo | EPT-73 |
| EPT-113 | [P3-T28] Consultar historial de pagos y emitir recibos PDF (RF7, RF10) | Tarea | Listo | EPT-73 |
| EPT-141 | [P3-HU8-T1] Crear la función que registra el pago y lo imputa a los ítems en una única transacción. | Subtarea | Listo | EPT-73 |
| EPT-142 | [P3-HU8-T2] Construir la pantalla de selección de ítems con el total calculado por el servidor. | Subtarea | Listo | EPT-73 |
| EPT-143 | [P3-HU8-T3] Mostrar los datos bancarios de la institución para la transferencia. | Subtarea | Listo | EPT-73 |
| EPT-144 | [P3-HU8-T4] Impedir seleccionar ítems pagados o con un pago pendiente de verificación. | Subtarea | Listo | EPT-73 |
| EPT-145 | [P3-HU8-T5] Registrar el pago en estado Pendiente de verificación. | Subtarea | Listo | EPT-73 |
| EPT-146 | [P3-HU8-T6] Escribir las pruebas unitarias del cálculo e imputación. | Subtarea | Listo | EPT-73 |
| EPT-147 | [P3-HU9-T1] Crear el bucket privado de comprobantes con políticas por padre. | Subtarea | Listo | EPT-73 |
| EPT-148 | [P3-HU9-T2] Permitir tomar una foto o elegir una imagen o un PDF del dispositivo. | Subtarea | Listo | EPT-73 |
| EPT-149 | [P3-HU9-T3] Validar el tipo y el tamaño del archivo. | Subtarea | Listo | EPT-73 |
| EPT-150 | [P3-HU9-T4] Registrar fecha, importe y número de operación de la transferencia. | Subtarea | Listo | EPT-73 |
| EPT-151 | [P3-HU9-T5] Asociar el comprobante a la factura admitiendo varios por factura. | Subtarea | Listo | EPT-73 |
| EPT-152 | [P3-HU9-T6] Escribir la prueba de extremo a extremo del flujo. | Subtarea | Listo | EPT-73 |

### EPT-74 — [P3-EP6] Automatizar recordatorios y avisos de deuda

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-115 | [P3-HU15] Recordatorio mensual por correo | Historia | Listo | EPT-74 |
| EPT-116 | [P3-T29] Enviar aviso de deuda del día 20 (RF16) | Tarea | Listo | EPT-74 |
| EPT-158 | [P3-HU15-T1] Crear la función que determina el último día hábil considerando feriados. | Subtarea | Listo | EPT-74 |
| EPT-159 | [P3-HU15-T2] Configurar la tarea programada diaria protegida con una clave secreta. | Subtarea | Listo | EPT-74 |
| EPT-160 | [P3-HU15-T3] Generar la factura en PDF. | Subtarea | Listo | EPT-74 |
| EPT-161 | [P3-HU15-T4] Armar la plantilla del correo con el detalle por hijo e ítem, reutilizando el servicio de correo. | Subtarea | Listo | EPT-74 |
| EPT-162 | [P3-HU15-T5] Registrar cada envío para evitar duplicados. | Subtarea | Listo | EPT-74 |
| EPT-163 | [P3-HU15-T6] Probar el envío en el entorno local simulando la fecha. | Subtarea | Listo | EPT-74 |

### EPT-75 — [P3-EP7] Verificar, desplegar y entregar la Parte 3

| Clave | Resumen | Tipo | Estado | Épica |
|---|---|---|---|---|
| EPT-117 | [P3-T30] Ejecutar pruebas unitarias económicas y de calendario | Tarea | Listo | EPT-75 |
| EPT-118 | [P3-T31] Probar correos programados en Mailpit | Tarea | Listo | EPT-75 |
| EPT-119 | [P3-T32] Ejecutar E2E de web y flujos móviles | Tarea | Listo | EPT-75 |
| EPT-120 | [P3-T33] Probar acceso por rol y archivos privados | Tarea | Listo | EPT-75 |
| EPT-121 | [P3-T34] Corregir defectos detectados | Tarea | Listo | EPT-75 |
| EPT-122 | [P3-T35] Desplegar migraciones y tareas programadas | Tarea | Listo | EPT-75 |
| EPT-123 | [P3-T36] Generar APK Android y acceso iOS con Expo Go | Tarea | Por hacer | EPT-75 |
| EPT-124 | [P3-T37] Cargar tarifas y datos iniciales | Tarea | Por hacer | EPT-75 |
| EPT-125 | [P3-T38] Presentar la aplicación en testing del 11/11/2026 | Tarea | Por hacer | EPT-75 |
| EPT-126 | [P3-T39] Redactar manual de usuario móvil | Tarea | Listo | EPT-75 |
| EPT-127 | [P3-T40] Completar bitácora y elaborar informe de IA | Tarea | Por hacer | EPT-75 |
| EPT-128 | [P3-T41] Preparar presentación final y evidencia Kanban | Tarea | Por hacer | EPT-75 |

## Pendientes explícitos del equipo

- **Capturas del tablero:** exportar capturas del tablero Kanban de Jira (y del historial de evolución por sprint) solo puede hacerlo el equipo desde su cuenta; este archivo no las incluye. PENDIENTE.
- **Registro de evolución del tablero por equipo y por integrante único:** Jira no se consultó por historial de transiciones en este trabajo; solo se documenta el estado en la fecha indicada. PENDIENTE.
- **Retrospectivas:** no hay registro de retrospectivas en el repositorio. PENDIENTE.
- Tarjetas abiertas al 2026-11-09: EPT-123, EPT-124, EPT-125, EPT-127, EPT-128 (esta) y EPT-164, todas en Por hacer.
