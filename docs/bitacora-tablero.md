# Bitácora del tablero de Jira — proyecto EPT

Sitio: https://grupo12-utn.atlassian.net (proyecto EPT, tablero Kanban del Grupo 12).

> **Fuente y alcance.** Los datos salen de una consulta de **solo lectura** a Jira
> (`project = EPT ORDER BY key ASC`, campos resumen, estado, creación, resolución y padre) hecha el
> 02/10/2026. Ese día el proyecto tenía **68 tickets**: 7 épicas, 6 historias, 36 subtareas y 19
> tareas. Las fechas se muestran como día/mes/año. «Resuelta» es la fecha de resolución que Jira
> registró al pasar el ticket a Listo; «—» indica que el ticket sigue abierto. Todos los tickets se
> crearon en bloque el 30/08/2026, por lo que esa columna no refleja cuándo empezó el trabajo: el
> avance real se lee en la fecha de resolución y en las evidencias de `docs/evidence/`.

## 1. Resumen por épica

| Épica | Nombre | Estado | Hijas directas | Hijas en Listo | Resuelta |
| --- | --- | --- | ---: | ---: | --- |
| EPT-1 | Base del proyecto y documentación | Listo | 5 | 5 | 02/10/2026 |
| EPT-2 | Administración académica | Listo | 4 | 4 | 02/10/2026 |
| EPT-3 | Legajos y usuarios | Listo | 3 | 3 | 02/10/2026 |
| EPT-4 | Servicios escolares | Listo | 2 | 2 | 02/10/2026 |
| EPT-5 | Actividades deportivas | Listo | 4 | 4 | 02/10/2026 |
| EPT-6 | Portal de padres | Listo | 1 | 1 | 02/10/2026 |
| EPT-7 | Reportes, credencial QR, integración y entrega | Por hacer | 6 | 4 | — |

Las hijas directas son historias y tareas; las subtareas cuelgan de cada historia (sección 2).

## 2. Detalle por épica

### EPT-1 — Base del proyecto y documentación

Estado: **Listo**. Creada el 30/08/2026; resuelta el 02/10/2026.

| Clave | Tipo | Resumen | Estado | Creada | Resuelta |
| --- | --- | --- | --- | --- | --- |
| EPT-50 | Tarea | Corregir y validar el plan de trabajo | Listo | 30/08/2026 | 30/08/2026 |
| EPT-51 | Tarea | Reformular los 21 requerimientos funcionales y los 2 no funcionales | Listo | 30/08/2026 | 30/08/2026 |
| EPT-52 | Tarea | Actualizar el MER, los casos de uso y las dependencias | Listo | 30/08/2026 | 25/09/2026 |
| EPT-53 | Tarea | Corregir las seis historias de usuario priorizadas | Listo | 30/08/2026 | 30/08/2026 |
| EPT-54 | Tarea | Ajustar el prototipo responsive y la arquitectura | Listo | 30/08/2026 | 25/09/2026 |

### EPT-2 — Administración académica

Estado: **Listo**. Creada el 30/08/2026; resuelta el 02/10/2026.

| Clave | Tipo | Resumen | Estado | Creada | Resuelta |
| --- | --- | --- | --- | --- | --- |
| EPT-8 | Historia | HU1 – Administrar cursos | Listo | 30/08/2026 | 10/09/2026 |
| EPT-14 | Subtask (de EPT-8) | 1. Verificar la migración de niveles y crear la migración de cursos con claves y unicidad | Listo | 30/08/2026 | 10/09/2026 |
| EPT-15 | Subtask (de EPT-8) | 2. Implementar las consultas y el servicio del lado del servidor para altas, cambios e inactivación | Listo | 30/08/2026 | 10/09/2026 |
| EPT-16 | Subtask (de EPT-8) | 3. Construir el listado y el formulario responsive con validación de datos | Listo | 30/08/2026 | 10/09/2026 |
| EPT-17 | Subtask (de EPT-8) | 4. Aplicar la autorización del director en el servidor y en la base | Listo | 30/08/2026 | 10/09/2026 |
| EPT-18 | Subtask (de EPT-8) | 5. Ejecutar pruebas de alta, edición, duplicado, nivel inexistente e inactivación | Listo | 30/08/2026 | 10/09/2026 |
| EPT-19 | Subtask (de EPT-8) | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Listo | 30/08/2026 | 10/09/2026 |
| EPT-55 | Tarea | RF4 – Administrar niveles educativos | Listo | 30/08/2026 | 12/09/2026 |
| EPT-56 | Tarea | RF2 – Administrar materias | Listo | 30/08/2026 | 15/09/2026 |
| EPT-57 | Tarea | RF3 – Administrar horarios de materias y cursos | Listo | 30/08/2026 | 25/09/2026 |

### EPT-3 — Legajos y usuarios

Estado: **Listo**. Creada el 30/08/2026; resuelta el 02/10/2026.

| Clave | Tipo | Resumen | Estado | Creada | Resuelta |
| --- | --- | --- | --- | --- | --- |
| EPT-9 | Historia | HU7 – Actualizar información académica del alumno | Listo | 30/08/2026 | 14/09/2026 |
| EPT-20 | Subtask (de EPT-9) | 1. Agregar a la migración la relación del alumno con su curso y su estado académico | Listo | 30/08/2026 | 14/09/2026 |
| EPT-21 | Subtask (de EPT-9) | 2. Corregir los tipos y servicios de perfiles sin asumir cambios no versionados en la base | Listo | 30/08/2026 | 14/09/2026 |
| EPT-22 | Subtask (de EPT-9) | 3. Extender el formulario y el listado de legajos para mostrar curso, nivel derivado y estado | Listo | 30/08/2026 | 14/09/2026 |
| EPT-23 | Subtask (de EPT-9) | 4. Revisar la creación y edición de usuarios y perfiles para evitar duplicados por DNI | Listo | 30/08/2026 | 14/09/2026 |
| EPT-24 | Subtask (de EPT-9) | 5. Probar curso inválido, cambio de curso, cambio de estado y persistencia del legajo | Listo | 30/08/2026 | 14/09/2026 |
| EPT-25 | Subtask (de EPT-9) | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Listo | 30/08/2026 | 14/09/2026 |
| EPT-58 | Tarea | RF8 – Administrar profesores | Listo | 30/08/2026 | 26/09/2026 |
| EPT-59 | Tarea | RF19 – Administrar usuarios y permisos | Listo | 30/08/2026 | 27/09/2026 |

### EPT-4 — Servicios escolares

Estado: **Listo**. Creada el 30/08/2026; resuelta el 02/10/2026.

| Clave | Tipo | Resumen | Estado | Creada | Resuelta |
| --- | --- | --- | --- | --- | --- |
| EPT-10 | Historia | HU9 – Inscribirse al comedor | Listo | 30/08/2026 | 21/09/2026 |
| EPT-26 | Subtask (de EPT-10) | 1. Diseñar las tablas de servicios e inscripciones con unicidad por alumno y servicio | Listo | 30/08/2026 | 21/09/2026 |
| EPT-27 | Subtask (de EPT-10) | 2. Implementar el alta y la baja de comedor mediante un servicio del lado del servidor | Listo | 30/08/2026 | 21/09/2026 |
| EPT-28 | Subtask (de EPT-10) | 3. Construir la pantalla del alumno y la consulta administrativa de inscriptos | Listo | 30/08/2026 | 21/09/2026 |
| EPT-29 | Subtask (de EPT-10) | 4. Preparar la estructura reutilizable para los cuatro recorridos de transporte | Listo | 30/08/2026 | 21/09/2026 |
| EPT-30 | Subtask (de EPT-10) | 5. Probar alta, duplicado, baja, reingreso y asociación con el legajo | Listo | 30/08/2026 | 21/09/2026 |
| EPT-31 | Subtask (de EPT-10) | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Listo | 30/08/2026 | 21/09/2026 |
| EPT-60 | Tarea | RF5 y RF10 – Administrar el transporte y sus cuatro recorridos | Listo | 30/08/2026 | 01/10/2026 |

### EPT-5 — Actividades deportivas

Estado: **Listo**. Creada el 30/08/2026; resuelta el 02/10/2026.

| Clave | Tipo | Resumen | Estado | Creada | Resuelta |
| --- | --- | --- | --- | --- | --- |
| EPT-11 | Historia | HU11 – Inscribirse a deportes | Listo | 30/08/2026 | 22/09/2026 |
| EPT-32 | Subtask (de EPT-11) | 1. Completar el modelo de deportes, grupos, nivel, cupo y profesor responsable | Listo | 30/08/2026 | 22/09/2026 |
| EPT-33 | Subtask (de EPT-11) | 2. Corregir la migración y las políticas de inscripciones antes de usar el flujo del cliente | Listo | 30/08/2026 | 22/09/2026 |
| EPT-34 | Subtask (de EPT-11) | 3. Implementar el listado por nivel y el alta y la baja de inscripción | Listo | 30/08/2026 | 22/09/2026 |
| EPT-35 | Subtask (de EPT-11) | 4. Aplicar la regla de máximo dos inscripciones activas en el servidor y en la base | Listo | 30/08/2026 | 22/09/2026 |
| EPT-36 | Subtask (de EPT-11) | 5. Probar uno, dos y un tercer deporte, duplicado y baja con nueva disponibilidad | Listo | 30/08/2026 | 22/09/2026 |
| EPT-37 | Subtask (de EPT-11) | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Listo | 30/08/2026 | 22/09/2026 |
| EPT-12 | Historia | HU12 – Consultar compatibilidad horaria | Listo | 30/08/2026 | 24/09/2026 |
| EPT-38 | Subtask (de EPT-12) | 1. Crear la migración de horarios y su relación con los grupos deportivos | Listo | 30/08/2026 | 24/09/2026 |
| EPT-39 | Subtask (de EPT-12) | 2. Implementar una función única de comparación de intervalos en el servidor y en la base | Listo | 30/08/2026 | 24/09/2026 |
| EPT-40 | Subtask (de EPT-12) | 3. Integrar la validación al alta realizada por el alumno o por el administrador | Listo | 30/08/2026 | 24/09/2026 |
| EPT-41 | Subtask (de EPT-12) | 4. Mostrar el deporte, el día y el rango que originan el conflicto | Listo | 30/08/2026 | 24/09/2026 |
| EPT-42 | Subtask (de EPT-12) | 5. Probar días distintos, intervalos superpuestos, contenidos y contiguos | Listo | 30/08/2026 | 24/09/2026 |
| EPT-43 | Subtask (de EPT-12) | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Listo | 30/08/2026 | 24/09/2026 |
| EPT-61 | Tarea | RF18 – Administrar deportes y grupos | Listo | 30/08/2026 | 01/10/2026 |
| EPT-62 | Tarea | RF16 – Administrar inscripciones | Listo | 30/08/2026 | 01/10/2026 |

### EPT-6 — Portal de padres

Estado: **Listo**. Creada el 30/08/2026; resuelta el 02/10/2026.

| Clave | Tipo | Resumen | Estado | Creada | Resuelta |
| --- | --- | --- | --- | --- | --- |
| EPT-13 | Historia | HU15 – Inscribir un hijo al cursado | Listo | 30/08/2026 | 24/09/2026 |
| EPT-44 | Subtask (de EPT-13) | 1. Crear y versionar la tabla padre-hijo que el código actual presupone | Listo | 30/08/2026 | 24/09/2026 |
| EPT-45 | Subtask (de EPT-13) | 2. Implementar la consulta de hijos y el aislamiento de los datos autorizados | Listo | 30/08/2026 | 24/09/2026 |
| EPT-46 | Subtask (de EPT-13) | 3. Construir la selección de hijo, de curso y la confirmación de matrícula | Listo | 30/08/2026 | 24/09/2026 |
| EPT-47 | Subtask (de EPT-13) | 4. Impedir el curso múltiple, el duplicado y el acceso a alumnos ajenos | Listo | 30/08/2026 | 24/09/2026 |
| EPT-48 | Subtask (de EPT-13) | 5. Ejecutar pruebas E2E con padre válido, hijo ajeno, duplicado y curso inválido | Listo | 30/08/2026 | 24/09/2026 |
| EPT-49 | Subtask (de EPT-13) | 6. Actualizar el tablero Kanban, la evidencia y la retrospectiva | Listo | 30/08/2026 | 24/09/2026 |

### EPT-7 — Reportes, credencial QR, integración y entrega

Estado: **Por hacer**. Creada el 30/08/2026; resuelta el —.

| Clave | Tipo | Resumen | Estado | Creada | Resuelta |
| --- | --- | --- | --- | --- | --- |
| EPT-63 | Tarea | RF17 – Generar los reportes oficiales de la Dirección | Listo | 30/08/2026 | 29/09/2026 |
| EPT-64 | Tarea | RF20 – Emitir la credencial digital QR | Listo | 30/08/2026 | 30/09/2026 |
| EPT-65 | Tarea | RF21 – Registrar accesos con QR | Listo | 30/08/2026 | 01/10/2026 |
| EPT-66 | Tarea | Integrar los módulos y normalizar las migraciones | Listo | 30/08/2026 | 02/10/2026 |
| EPT-67 | Tarea | Ejecutar las pruebas funcionales, por rol y E2E | Por hacer | 30/08/2026 | — |
| EPT-68 | Tarea | Desplegar, documentar y presentar | Por hacer | 30/08/2026 | — |

## 3. Estado de la entrega final

| Ticket | Estado en Jira | Comentario |
| --- | --- | --- |
| EPT-66 Integrar los módulos y normalizar las migraciones | Listo (02/10/2026) | Evidencia en `docs/evidence/EPT-66.md` |
| EPT-67 Ejecutar las pruebas funcionales, por rol y E2E | Por hacer | Evidencia preparada en `docs/evidence/EPT-67.md`; el cierre del ticket lo actualiza la coordinación |
| EPT-68 Desplegar, documentar y presentar | Por hacer | Evidencia en `docs/evidence/EPT-68.md`; falta la presentación |
| EPT-7 Reportes, credencial QR, integración y entrega | Por hacer | Se cierra cuando EPT-67 y EPT-68 pasen a Listo |

La entrega final está prevista para el 22/10/2026. Esta bitácora refleja el tablero al momento de la
consulta: el cambio de estado de EPT-67, EPT-68 y EPT-7 se registra en Jira y se reflejará en una
actualización posterior de este archivo.

## 4. Observaciones sobre el tablero

* Las subtareas existen solo para las seis historias de usuario (EPT-8 a EPT-13), con seis pasos cada
  una, el último siempre «Actualizar el tablero Kanban, la evidencia y la retrospectiva».
* Las tareas de requerimientos (EPT-55 a EPT-65) se identifican por su RF en el título y no tienen
  subtareas; su detalle está en `docs/evidence/EPT-<n>.md`.
* Las tareas EPT-63 a EPT-65 (reportes, credencial QR y acceso QR) cuelgan de la épica EPT-7, que
  sigue abierta por las tareas EPT-67 y EPT-68.
* El tablero no guarda un historial de transiciones en esta consulta: las fechas de resolución son
  las únicas marcas de tiempo disponibles. No se reconstruyeron fechas de inicio.
