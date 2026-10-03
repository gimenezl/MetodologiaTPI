# EPT-68 — Desplegar, documentar y presentar

> **Estado: cerrado en Jira el 02/10/2026 por decisión de Lucas, con las brechas de datos iniciales
> abiertas como pendientes del colegio.** Versión candidata desplegada; manual, bitácora y
> presentación entregados. El inventario de datos iniciales se obtuvo con consultas de **solo
> lectura** a producción. No se cargó, modificó ni eliminó ningún dato, y **no se cargaron datos
> ficticios**: las brechas de la sección 2 siguen abiertas y dependen de información real del
> colegio (horarios deportivos, cursos de Inicial y Secundario, cuentas de Personal, recorridos).
> Entrega final: 22/10/2026.

## 1. Despliegue de la versión candidata

| Elemento | Valor | Cómo se comprobó |
| --- | --- | --- |
| Rama y commit de código | `main` en `52423fa` (el mismo commit que `origin/main` al consultar) | `git ls-remote origin main` |
| Despliegue de producción en Vercel | Estado **READY**, objetivo `production`, creado desde `main` en `52423fa` | Vercel (lectura de despliegues) |
| Despliegue anterior | `fe07cd9` (asistencias por vínculo), también READY | Vercel (lectura de despliegues) |
| Alias público | `metodologia-tpi.vercel.app` | Indicado por la coordinación; **no se volvió a verificar** en esta consulta |
| Ledger de migraciones de producción | **30 de 30** aplicadas, sin diferencias entre local y remoto | `supabase migration list --linked` (CLI 2.119.0) |
| Última migración aplicada | `20261002185033` (asistencias por vínculo docente, la 30) | Idem |

El commit `52423fa` solo agrega documentación sobre `fe07cd9`, por lo que el código desplegado es el
de la unidad D de EPT-66. Las evidencias de despliegue y de las migraciones 28 a 30 están en
`docs/evidence/EPT-66.md` §10.

## 2. Inventario de datos iniciales en producción

### 2.1 Método

Consultas `SELECT` con `supabase db query --linked` (CLI 2.119.0; la ayuda del comando confirma que
ejecuta SQL contra el proyecto vinculado) sobre el proyecto de producción. Solo se tomaron
**conteos agregados y nombres de catálogo** (deportes, actividades, niveles, recorridos, noticias);
no se leyeron ni se registran identidades de personas, correos, UUID ni datos de menores.

### 2.2 Qué define el repositorio como datos mínimos

* **No existe `supabase/seed.sql`**, aunque `supabase/config.toml` lo declara en `[db.seed]`: un
  `db reset` local carga solo lo que hacen las migraciones, y la recuperación documenta el uso de
  `--no-seed`.
* Los datos iniciales viven **dentro de las migraciones**: roles (5) y niveles (3) en la 001; diez
  actividades, tres noticias y seis imágenes de galería también en la 001; el servicio «Comedor
  escolar» en la 013; seis deportes en la 014; y cuatro recorridos de transporte con doce paradas en
  la migración de transporte, **con nombres y paradas declarados ficticios**.
* El repositorio no define cursos, materias asignadas, grupos deportivos con horarios ni cuentas
  de ningún rol: eso se carga operando la aplicación.

### 2.3 Resultado por catálogo

| Catálogo (tabla) | Filas en producción | Mínimo que define el repo | Observación |
| --- | ---: | --- | --- |
| Roles | 5 | 5 (Director, Docente, Padre, Estudiante, Personal) | Completo |
| Niveles | 3 (3 activos) | 3 (Inicial, Primario, Secundario) | Completo |
| Cursos | 1 (1ero A, Primario, activo) | Ninguno | **Brecha**: no hay cursos de Inicial ni de Secundario |
| Materias (actividades de tipo Curricular) | 4 | 2 sembradas | Hay 2 cargadas además de las sembradas |
| Asignaciones materia-curso | 1 | Ninguna | Solo un curso con una materia asignada |
| Franjas horarias académicas | 1 | Ninguna | Cobertura mínima |
| Actividades (total) | 23 (13 Deporte, 6 Taller, 4 Curricular) | 10 sembradas | Incluye duplicados de nombre y una actividad de prueba (sección 4) |
| Deportes (catálogo) | 6 (6 activos) | 6 | Completo: Fútbol, Natación, Atletismo, Artes Marciales, Vóley, Básquet |
| Grupos deportivos | 4 (4 activos, todos de Primario) | Ninguno | **Brecha**: ninguno de Inicial ni de Secundario |
| Franjas horarias de grupos deportivos | 0 | Ninguna | **Brecha crítica**: un grupo sin franjas no admite inscripciones, por lo que hoy ningún estudiante puede inscribirse a deportes |
| Servicio de comedor | 1 (activo) | 1 | Completo |
| Recorridos de transporte | 4 (4 activos; códigos TR-NORTE, TR-SUR, TR-ESTE, TR-OESTE) | 4 | La cantidad cumple lo que pide el requerimiento; **nombres y 12 paradas son ficticios** (cada nombre lleva «(ficticio)») |
| Menú escolar | 0 | 0 | Sin brecha de datos: la aplicación no tiene pantalla de menú del comedor |
| Noticias | 3 | 3 | Completo (textos de ejemplo de la migración) |
| Galería | 6 | 6 | Completo (imágenes de ejemplo de la migración) |
| Opiniones (testimonios) | 4 (3 aprobadas, 1 pendiente) | 0 | Cargadas operando el sitio |
| Perfiles, total | 19 | Ninguno | Ver el desglose siguiente |
| Perfiles de Dirección | 3 (3 con cuenta) | Ninguno | |
| Perfiles de Docente | 3 (3 con cuenta); 3 fichas de profesor | Ninguno | |
| Perfiles de Estudiante | 8 (5 con cuenta) | Ninguno | Solo 1 legajo ACTIVO y 7 INACTIVO; 1 matrícula vigente |
| Perfiles de Padre | 5 (4 con cuenta); 5 vínculos padre-hijo | Ninguno | |
| Perfiles de Personal | 0 | Ninguno | **Brecha**: no hay ninguna cuenta del rol que opera el registro de accesos |
| Cuentas de ingreso | 15 (15 perfiles con cuenta); 0 bloqueadas | Ninguna | |
| Credenciales QR | 5 | Ninguna | |
| Accesos registrados | 2 (1 anulado) | Ninguno | |
| Asistencias | 26 | Ninguna | Incluye 1 de prueba (sección 4) |
| Solicitudes de inscripción | 8 (2 pendientes, 2 revisadas, 4 aceptadas) | Ninguna | |
| Postulaciones de empleo | 3 | Ninguna | |
| Inscripciones a servicios | 2 (1 activa, 1 cancelada) | Ninguna | |
| Inscripciones deportivas | 1 (cancelada) | Ninguna | |
| Inscripciones a actividades (modelo legado) | 9 (3 activas, 6 de baja) | Ninguna | Las 6 bajas pertenecen a la actividad de prueba |

Los conteos coinciden con los de las evidencias previas (por ejemplo 26 asistencias y 3 inscripciones
originales en `docs/evidence/EPT-67.md` §4.1).

### 2.4 Brechas detectadas (no se cargó nada)

| # | Brecha | Efecto | Quién decide |
| --- | --- | --- | --- |
| 1 | Los 4 grupos deportivos no tienen franjas horarias | Nadie puede inscribirse a deportes; Dirección tampoco puede inscribir (misma regla) | Lucas, o la persona de Dirección que cargue los horarios desde «Deportes» → «Horarios» |
| 2 | Falta oferta en Inicial y Secundario: 1 curso y 4 grupos, todos de Primario | El sitio presenta tres niveles, pero solo Primario tiene curso y grupos | Lucas |
| 3 | Sin cuentas de Personal | Solo Dirección puede operar «Registrar accesos» | Lucas |
| 4 | Recorridos y paradas con nombre «(ficticio)» | Cumplen la cantidad pedida (cuatro), pero no representan un servicio real | Lucas (nombres reales o conservar como demostración); Dirección puede renombrar los recorridos, **no las paradas** |
| 5 | 7 de 8 estudiantes INACTIVO y 1 matrícula | Los servicios escolares exigen legajo activo; la demostración con estudiantes depende de pocos datos | Lucas |
| 6 | No hay `supabase/seed.sql` | Un entorno nuevo no recibe datos de demostración ni cuentas | Lucas (decidir si se quiere un seed sintético) |
| 7 | Catálogo de actividades con duplicados y una fila de prueba | Aparecen nombres repetidos (por ejemplo Fútbol, Danza, Natación) en «Actividades» | Lucas |

## 3. Estado de los entregables

| Entregable | Archivo o enlace | Estado |
| --- | --- | --- |
| Datos iniciales | Sección 2 de este documento | Inventariado; **no cargados**, brechas abiertas (sección 2.4) por decisión de Lucas |
| Versión candidata desplegada | Sección 1 de este documento | Desplegada (código verificado en `52423fa`; `main` posterior solo agrega documentación; migraciones 30 de 30) |
| Manual de usuario | `docs/manual-usuario.md` | Entregado: por rol, credencial QR, escaneo y preguntas frecuentes |
| Bitácora del tablero | `docs/bitacora-tablero.md` | Entregada con los datos de Jira del 02/10/2026 |
| Presentación | Deck de 10 diapositivas como artefacto privado de Claude (no versionado en el repositorio); se comparte desde su menú Share | Entregada |
| Evidencia de pruebas | `docs/evidence/EPT-67.md` | Entregada |

## 4. Datos ficticios de prueba que siguen en producción

| Dato | Detalle | Riesgo |
| --- | --- | --- |
| 4 cuentas de prueba de ingreso | 4 de las 15 cuentas pertenecen a un dominio reservado para pruebas; no se transcriben sus correos | Cuentas con contraseña conocida por el equipo de pruebas; conviene bloquearlas antes de la entrega |
| 1 taller de cupo 1 | Actividad «EPT66 PRUEBA AISLADA CUPOS 20261002» con 6 inscripciones dadas de baja (ninguna activa) | Aparece en «Actividades» con un nombre de prueba; sin plazas libres reales |
| 1 asistencia de prueba | Registrada en el recorrido de EPT-66 (la cuenta de Dirección que probó la pantalla nueva) | Cuenta en el porcentaje del alumno afectado; poco riesgo |

### 4.1 Plan de purga o bloqueo sin DELETE físico

La base **no admite borrado físico** de estos datos: el diseño usa bajas lógicas y un disparador que
rechaza el DELETE. Por eso el plan es **bloquear y conservar**, no borrar:

1. **Cuentas de prueba**: desde «Usuarios» → detalle de cada persona → «Bloquear acceso», con un
   motivo (5 a 500 caracteres). Es reversible, conserva el perfil y el historial, y la pantalla
   confirma el bloqueo. Si son perfiles de Estudiante, además se puede «Inactivar» el legajo desde
   «Alumnos» (baja lógica). Un perfil sin vínculos puede dejarse bloqueado indefinidamente.
2. **Actividad de prueba**: las 6 inscripciones ya están de baja, así que no hay inscripciones
   activas que limpiar. La aplicación **no ofrece inactivar una actividad** (solo editar su cupo);
   renombrarla o archivarla requiere una migración revisada o una operación con autorización de
   Lucas. Hasta entonces se la puede dejar con cupo 1, lo que además la vuelve inofensiva.
3. **Asistencia de prueba**: no se puede borrar; si se la quiere neutralizar, se corrige su estado
   desde «Asistencias» (la corrección actualiza el registro y no deja huella de quién corrigió,
   riesgo ya registrado en `docs/evidence/EPT-67.md` §5.4).
4. Antes de bloquear una cuenta se debe comprobar que **no sea la única de Dirección en uso**: el
   sistema no permite que una persona bloquee su propia cuenta, así que otra persona de Dirección
   debe hacerlo.

Nada de lo anterior se ejecutó en esta tarea.

## 5. Límites honestos y decisiones de Lucas

### 5.1 Límites

* Los conteos son de una fotografía del 02/10/2026; cualquier uso posterior los modifica.
* No se verificó el alias de Vercel ni se hizo un recorrido funcional completo en producción: las
  pruebas por rol y E2E se hicieron en un stack local aislado (`docs/evidence/EPT-67.md` §8).
* La presentación no está hecha; este documento deja el marcador.
* El manual refleja las pantallas del código desplegado; no se validó con usuarios reales.
* La bitácora toma de Jira solo estado, creación y resolución; no hay historial de transiciones.
* Siguen abiertos los riesgos de `docs/evidence/EPT-67.md` §5.4 (corrección de asistencia sin
  huella, hallazgos de `npm audit`, aviso de Next, deadlock residual).

### 5.2 Decisiones que requieren a Lucas

| # | Decisión | Opciones |
| --- | --- | --- |
| 1 | Franjas horarias de los 4 grupos deportivos | Cargarlas antes de la entrega para poder demostrar la inscripción a deportes, o aceptar que no se demuestra |
| 2 | Recorridos y paradas ficticios | Renombrar los recorridos (Dirección puede) y aceptar paradas de ejemplo, o conservar todo como demostración |
| 3 | Cuentas del rol Personal | Crear al menos una cuenta de Personal para demostrar el registro de accesos |
| 4 | Cuentas, taller y asistencia de prueba | Bloquear las cuentas y dejar el resto, o encargar una migración de limpieza de la actividad |
| 5 | Oferta de Inicial y Secundario | Cargar un curso y un grupo de cada nivel, o aclarar en la presentación que la demostración es de Primario |
| 6 | Seed sintético | Agregar un `supabase/seed.sql` para entornos nuevos, o dejarlo fuera del alcance |

### 5.3 Qué impide dar por cerrado EPT-68

Quedan abiertos: la **presentación** y las decisiones 1 a 5 de la tabla anterior (si Lucas decide
demostrar esos casos). El despliegue, el manual y la bitácora no tienen pendientes.
