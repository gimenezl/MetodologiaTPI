# Manual de usuario — Sistema de gestión Educar para Transformar

Este manual explica cómo usar el sistema según el rol de cada persona: Dirección, Docente,
Estudiante, Padre, madre o tutor, y Personal. Se escribió a partir de las pantallas y los mensajes
que existen hoy en la aplicación (versión desplegada de `main`); si una función no figura acá, es
porque la aplicación no la ofrece.

Los textos entre comillas angulares, como «Cerrar sesión», reproducen lo que se ve en pantalla.

## 1. Primeros pasos

### 1.1 El sitio público y el panel

El sitio tiene dos partes:

* **Sitio público** (sin iniciar sesión): Inicio, Quiénes Somos, Niveles, Bienestar, Noticias,
  Galería, Contacto y Empleo, además del botón «Inscribirse» (pre-inscripción). También se puede
  dejar un testimonio desde la página de inicio.
* **Panel de gestión** (con sesión): se abre desde «Ingresar» (o «Dashboard» si ya hay sesión). Lo
  que se ve en el menú depende del rol.

### 1.2 Iniciar sesión

1. Entrá a «Ingresar» (dirección `/login`).
2. Escribí el **email institucional** y la **contraseña** que te dio Dirección.
3. Tocá «Ingresar al sistema». Si todo está bien aparece «Bienvenido al sistema» y se abre el panel.

El sistema no ofrece auto-registro ni recuperación de contraseña por su cuenta: las cuentas las crea
o vincula Dirección. Si no podés ingresar, usá «Contactar soporte» (lleva a Contacto).

| Mensaje | Qué significa | Qué hacer |
| --- | --- | --- |
| «Email o contraseña incorrectos» | Los datos no coinciden | Revisá mayúsculas y espacios; si persiste, pedí ayuda a Dirección |
| «Tu acceso está bloqueado. Comunicate con Dirección.» | Dirección bloqueó la cuenta | Hablar con Dirección |
| «Tu correo todavía no está confirmado. Comunicate con Dirección.» | La cuenta no terminó de activarse | Hablar con Dirección |
| «Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.» | Límite de intentos | Esperar unos minutos |
| «No pudimos iniciar sesión. Intentá de nuevo en unos minutos.» | Falla temporal | Reintentar más tarde |

Si intentás abrir una pantalla del panel sin sesión, el sistema te lleva a «Ingresar» y, al
entrar, vuelve a la pantalla que querías.

### 1.3 Cerrar sesión

Tocá «Cerrar sesión» al pie del menú lateral (en el celular, también arriba a la derecha). El botón
muestra «Cerrando sesión…» mientras trabaja y después te lleva al inicio del sitio. Al cerrar, no se
puede volver a una pantalla del panel con el botón «atrás» del navegador: se pide ingresar de nuevo.

### 1.4 Cómo se navega

* **Computadora**: menú lateral con las secciones de tu rol; arriba a la derecha, «Ver sitio web».
* **Celular**: botón de menú arriba a la izquierda y barra inferior con atajos a «Asistencias»,
  «Noticias» y «Perfil». Un atajo solo aparece si tu rol puede abrir esa pantalla.
* **Inicio** del panel: accesos rápidos a las secciones principales de tu rol.

### 1.5 Situaciones que afectan a cualquier rol

| Situación | Qué se ve | Qué significa |
| --- | --- | --- |
| Acceso bloqueado | Pantalla «Acceso bloqueado»: «Dirección bloqueó el acceso de tu cuenta. Si creés que es un error, comunicate con la escuela.» | Dirección bloqueó la cuenta. No se muestra ningún dato personal. Solo queda cerrar sesión |
| Cuenta sin perfil | En Inicio: «Tu cuenta no tiene un perfil» y «Comunicate con Dirección para completarlo» | La cuenta existe pero Dirección no creó su perfil; no hay ninguna sección disponible |
| Pantalla fuera de tu rol | «Acceso restringido. No tenés permisos para ver esta sección del panel.» y «Volver al panel» | Escribiste la dirección de una pantalla que tu rol no puede usar |
| Sesión vencida | «Tu sesión venció» o «Necesitás iniciar sesión para continuar.» | Volvé a ingresar |

Un bloqueo de Dirección se aplica en el momento: la persona deja de ver datos aunque tenga el panel
abierto, y se la lleva a la pantalla de bloqueo al cambiar de sección.

### 1.6 Qué ve cada rol en el menú

| Sección | Dirección | Docente | Estudiante | Padre o tutor | Personal |
| --- | :---: | :---: | :---: | :---: | :---: |
| Inicio | Sí | Sí | Sí | Sí | Sí |
| Mi perfil | Sí | Sí | Sí | Sí | Sí |
| Registrar accesos | Sí | — | — | — | Sí |
| Auditoría de accesos | Sí | — | — | — | — |
| Usuarios, Legajos, Alumnos, Profesores | Sí | — | — | — | — |
| Cursos, Niveles, Materias, Horarios académicos | Sí | — | — | — | — |
| Credenciales (administración) | Sí | — | — | — | — |
| Reportes | Sí | — | — | — | — |
| Solicitudes, Postulaciones, Testimonios | Sí | — | — | — | — |
| Mis asignaciones | — | Sí | — | — | — |
| Mi legajo | — | — | Sí | — | — |
| Mi credencial | — | — | Sí | — | — |
| Mis hijos | — | — | — | Sí | — |
| Credenciales de mis hijos | — | — | — | Sí | — |
| Comedor, Deportes, Transporte | Sí (administración) | — | Sí (autoservicio) | — | — |
| Asistencias | Sí (gestión) | Sí (gestión acotada) | Sí (solo lectura) | Sí (solo lectura) | — |
| Actividades (cupos) | Sí (gestión) | Sí (consulta) | Sí (inscripción propia) | Sí (inscribe a sus hijos) | — |

El menú es una ayuda de navegación, no la protección de los datos: cada pantalla y cada operación
vuelven a comprobar el rol en el servidor y en la base de datos.

## 2. Estudiante

### 2.1 Mi legajo («Mi legajo»)

Muestra, en solo lectura, tu estado académico (activo o inactivo), tu curso vigente, el nivel que
corresponde a ese curso y tu historial completo. Si ves «Todavía no tenés un legajo académico»,
Dirección aún no cargó tu situación académica. Para corregir un dato, comunicate con la
administración: no podés editarlo.

### 2.2 Mi credencial («Mi credencial»)

Es tu credencial digital con código QR (ver la sección 7). Podés **verla, descargarla como imagen
(«Descargar imagen») e imprimirla («Imprimir»)**. Es de solo lectura: no podés emitirla ni
revocarla. Según el estado de tu legajo y de tu credencial verás un aviso en lugar del QR:

| Aviso | Significa |
| --- | --- |
| «Todavía no tenés una credencial» | Dirección todavía no la emitió |
| «Credencial revocada» | Ya no vale; pedí una nueva a Dirección |
| «Estás inactivo» | Tu credencial no es válida mientras estés inactivo; vuelve a valer la misma al reactivarte |
| «Acceso del alumno bloqueado» | No es válida mientras el acceso esté bloqueado |

### 2.3 Comedor

Autoservicio de tu inscripción al comedor escolar (la pantalla trata solo de la inscripción; no
muestra menú diario).

1. Entrá a «Comedor». Verás «Inscripción activa» o «Sin inscripción activa».
2. Para anotarte, tocá «Inscribirme al comedor». Aparece «Te inscribiste al comedor.»
3. Para darte de baja, tocá «Cancelar mi inscripción» y confirmá con «Sí, cancelar mi inscripción».
   La baja es lógica: queda en «Inscripciones anteriores» y podés volver a inscribirte.

No podés inscribirte si no tenés legajo, si tu legajo no está activo o si el comedor no recibe
inscripciones; el botón queda deshabilitado y la pantalla explica el motivo.

### 2.4 Deportes

Inscripción a grupos deportivos **de tu nivel**.

* Podés tener **hasta dos deportes activos** a la vez y **no más de un grupo por deporte**.
* Los horarios de tus deportes no pueden superponerse entre sí ni con tus materias.
* Un grupo sin horarios cargados o sin plazas no admite inscripción.
* Para anotarte, buscá el grupo y tocá «Inscribirme»; para salir, tocá «Cancelar inscripción» en
  tus deportes activos y confirmá. Al cancelar, la plaza y el horario quedan libres. Un grupo sin
  franjas muestra «Sin horario».

Mensajes habituales: «Ese grupo no corresponde a tu nivel educativo.», «El grupo ya no tiene plazas
disponibles.», «Ya estás inscripto en otro grupo de este deporte…», «Ya tenés dos deportes activos,
que es el máximo permitido…» y el aviso de conflicto horario, que indica el deporte, el día y el
rango que se superponen. Si tu legajo está inactivo o no tenés curso vigente, la pantalla lo
informa y no permite inscribirse.

### 2.5 Transporte

Muestra los cuatro recorridos con sus paradas.

* Podés tener **un solo recorrido activo**. «Elegir este recorrido» te anota; «Cambiar a este
  recorrido» pasa de uno a otro en una sola operación; «Cancelar este recorrido» te da de baja.
* Un recorrido marcado «No disponible» no admite inscripciones nuevas.
* Si tu legajo no existe o no está activo, la pantalla lo explica y bloquea la elección.

### 2.6 Asistencias («Mi asistencia»)

Historial de tu asistencia en **solo lectura**: cantidad de registros, presentes, ausentes y
justificados, porcentaje de asistencia y la lista por fecha. Solo los docentes y Dirección pueden
registrar o modificar asistencias; la pantalla lo recuerda con «Solo los docentes pueden registrar o
modificar».

### 2.7 Actividades («Actividades y talleres»)

Lista de actividades con cupo, filtrable por tipo (Todas, Deporte, Curricular, Taller). Podés
inscribirte a los talleres con cupo («Inscribirme», «Darme de baja»). Los deportes se gestionan por
grupo desde «Deportes»; las filas de deportes antiguos figuran como «Histórico» y no admiten
cambios. Una actividad sin plazas muestra «Sin cupo».

### 2.8 Mi perfil

Datos personales registrados (DNI, teléfono, dirección, legajo, email, fecha de nacimiento). Es de
solo lectura: «Si algún dato es incorrecto, comunicate con la administración del centro educativo».

### 2.9 Lo que el estudiante NO puede hacer

* Editar su legajo, su perfil, su curso o su estado.
* Registrar o modificar asistencias, emitir o revocar credenciales.
* Ver datos de otros estudiantes: el sistema solo le entrega su propio legajo y sus propias
  inscripciones.
* Usar «Registrar accesos» ni ninguna pantalla de administración.

## 3. Padre, madre o tutor

Solo ve a los hijos **actualmente vinculados** a su cuenta. El vínculo familiar lo gestiona la
administración: si falta uno, la pantalla indica «Si falta un vínculo familiar, contactá a la
administración». Si un hijo se desvincula, desaparece de la siguiente consulta.

### 3.1 Mis hijos

Por cada hijo se muestra su estado (Activo o Inactivo), legajo, nivel, curso y matrícula, las
materias con sus docentes y los deportes activos.

**Matricular a un hijo en un curso.** Solo se ofrece a quien está inactivo, sin matrícula y con
número de legajo:

1. Tocá «Seleccionar para matricular» en la tarjeta del hijo.
2. Elegí un **curso activo** y tocá «Revisar matrícula».
3. Confirmá con «Confirmar matrícula».

La confirmación activa el legajo y **después no se puede cambiar el curso desde esta pantalla**: los
cambios los gestiona la administración. Si el hijo ya está activo o tiene matrícula, la tarjeta dice
«Ya tiene una situación académica activa. Los cambios de curso los gestiona la administración.». Si
no tiene legajo: «Necesita un número de legajo antes de matricularse.».

### 3.2 Credenciales de mis hijos

La credencial QR de cada hijo vinculado: se puede ver, descargar como imagen e imprimir. Si todavía
no hay hijos vinculados, la pantalla dice «Todavía no tenés hijos vinculados». Los avisos (sin
credencial, revocada, inactivo, bloqueado) son los mismos de la sección 2.2, redactados en tercera
persona. No se emite ni se revoca desde esta cuenta.

### 3.3 Asistencias («Asistencia de mis hijos»)

Historial de solo lectura de los hijos vinculados, con el nombre del hijo en cada fila.

### 3.4 Actividades («Actividades de mis hijos»)

Elegí a un hijo y usá los botones de inscripción o baja en las actividades con cupo. Si no hay hijos
vinculados: «No tenés hijos asignados a tu cuenta. Contactá a la administración.». Los deportes por
grupo no se gestionan desde esta cuenta (no tiene la pantalla «Deportes»).

### 3.5 Mi perfil

Igual que el del estudiante: solo lectura.

### 3.6 Lo que el padre NO puede hacer

* Ver o actuar sobre hijos que no estén vinculados a su cuenta.
* Registrar o modificar asistencias.
* Cambiar el curso de un hijo ya matriculado, ni editar su legajo.
* Usar Comedor, Deportes ni Transporte (esas pantallas son del estudiante y de Dirección).

## 4. Docente

### 4.1 Mis asignaciones

Muestra tu ficha (legajo y especialidad, con los avisos «Ficha incompleta» o ficha inactiva), lo que
tenés **a cargo actualmente** (materias, cursos, niveles y grupos), tu **horario semanal** y las
**relaciones históricas** (materias o grupos inactivos a tu nombre, que no forman parte de tu
horario). Si algo no coincide, consultalo con Dirección. Un docente con ficha inactiva puede
consultar su información pero no recibe asignaciones nuevas.

### 4.2 Asistencias («Control de Asistencias»)

1. Elegí la **fecha** (con las flechas de día anterior y siguiente) y tocá «Actualizar» si hace falta.
2. En «Alumno», elegí a quien querés registrar; en «Estado», Presente, Ausente o Justificado.
3. Tocá «Registrar». Los avisos son «Asistencia registrada», «Asistencia actualizada» o «La asistencia
   ya tenía ese estado».
4. Para corregir, usá los botones P, A y J de la fila del alumno en la tabla del día.

**Regla central:** solo ves y registrás a los alumnos que **tenés a cargo con vínculo vigente**: los
de los cursos donde dictás una materia y los de tus grupos deportivos. Si no tenés ninguno, la
pantalla dice «No tenés alumnos a cargo en este momento.». El sistema deriva quién registra a partir
de tu sesión; no se puede registrar en nombre de otro docente.

| Mensaje | Qué significa |
| --- | --- |
| «El alumno ya no está a cargo o no está disponible. Actualizamos la lista.» | El alumno no existe, no es estudiante o dejó de estar a tu cargo (una sola respuesta para los tres casos) |
| «No tenés permiso para registrar asistencias de este alumno.» | Tu rol, tu cuenta o tu perfil no lo permiten |
| «Revisá el alumno, la fecha y el estado.» | Dato inválido |
| «Otra operación se cruzó con ésta. Volvé a intentarlo.» | Conflicto momentáneo |

La lista se vuelve a pedir al volver a la pestaña, de modo que un cambio de asignaciones hecho por
Dirección se refleja solo.

### 4.3 Actividades («Gestión de Cupos»)

Disponibilidad de cada actividad (inscriptos, cupo, «Casi lleno», «Completo»), con filtros por tipo
y nivel. La pantalla informa: «La inscripción de alumnos a los talleres la realiza Dirección. Acá
podés consultar la disponibilidad de cada actividad.». La pantalla ofrece editar el cupo máximo de
una actividad (ícono de lápiz «Cupo: N»); no ofrece inscribir ni dar de baja alumnos ni ver la
lista de inscriptos.

### 4.4 Mi perfil

Solo lectura, igual que los demás roles.

### 4.5 Lo que el docente NO puede hacer

* Ver o registrar asistencia de alumnos sin vínculo vigente con él.
* Inscribir o dar de baja alumnos en actividades, ni ver quiénes están inscriptos.
* Usar las pantallas de administración (Usuarios, Alumnos, Reportes, etc.) ni «Registrar accesos».

## 5. Personal

El rol Personal tiene un panel mínimo: **Inicio**, **Mi perfil** (solo lectura) y **Registrar
accesos**. Cualquier otra dirección del panel muestra «Acceso restringido». En el celular la barra
inferior solo ofrece «Noticias» y «Perfil».

### 5.1 Registrar accesos

Sirve para controlar el ingreso de alumnos al comedor y al transporte leyendo el código QR de su
credencial (ver la sección 7 para el procedimiento paso a paso). **Cada persona usa su propia
cuenta**: no se comparten sesiones.

Lo que Personal NO puede hacer: consultar la auditoría de accesos, ver listados o historiales de
eventos, anular accesos, ni registrar un acceso a mano (no existe carga manual por legajo o DNI; el
único camino es leer un QR).

## 6. Dirección

Dirección administra todo el sistema. Todas las pantallas de esta sección son exclusivas de
Dirección (el rol se comprueba en el servidor).

### 6.1 Usuarios

* **Cuentas y perfiles**: listado con búsqueda (por nombre, apellido, DNI o legajo), paginado. El
  correo se muestra enmascarado. Cada persona abre su **detalle**.
* **Nuevo usuario con cuenta**: formulario con nombre, apellido, DNI (7 u 8 dígitos), rol, email y
  contraseña (mínimo 6 caracteres), más teléfono, dirección y legajo opcionales. «Crear usuario» da
  el alta. Si el resultado es incierto, el listado se vuelve a cargar y es donde se comprueba; el
  reintento no duplica la cuenta. Nunca se crea una cuenta con rol Dirección sin pasar por el alta
  con cuenta.
* **Listado de edición rápida**: «Editar» cambia nombre, apellido, DNI, teléfono, dirección y legajo.
* El alta de un padre o un estudiante no exige vínculo familiar; la pantalla avisa que los vínculos
  padres-hijos todavía no se administran desde Usuarios.

**Detalle de una persona** (secciones Datos personales, Rol, Acceso, Cuenta, Historial):

* **Cambiar rol**: se elige el rol nuevo y se escribe un motivo de **5 a 500 caracteres**. No se
  ofrece «ESTUDIANTE» (depende del legajo académico y se gestiona desde Alumnos) y «DIRECTOR» solo
  para personas con cuenta confirmada.
* **Bloquear acceso / Reactivar acceso**: pide un motivo (5 a 500 caracteres). Al bloquear, la
  persona deja de ver datos del panel de inmediato y no puede volver a ingresar hasta la
  reactivación; sus datos, rol e historial se conservan. Si la cuenta de ingreso no quedó
  sincronizada, aparece «Reintentar sincronización».
* **Vincular cuenta** (para una persona sin cuenta): asistente de cuatro pasos, con la persona
  presente y su documento: (1) identidad presencial (DNI del documento, titular o representante,
  constancia de verificación); (2) correo de la persona, al que se envía un código; (3) la persona
  escribe el código de 6 dígitos y elige su contraseña (8 a 72 caracteres), y recién ahí se crea la
  cuenta enlazada al perfil; (4) resultado. La reserva vence a los pocos minutos, y se puede
  «Continuar vinculación» o «Cancelar vinculación en curso». Si el envío de correos no está
  configurado, el sistema lo informa y pide ayuda al equipo técnico.
* No podés cambiar el rol ni bloquear **tu propia** cuenta: lo hace otra persona de Dirección.

### 6.2 Legajos

Listado paginado (10 por página) de perfiles con búsqueda desde 2 caracteres. «Nuevo legajo» crea un
perfil, «Editar» lo modifica. Un legajo sin cuenta no puede nacer con rol Dirección.

### 6.3 Alumnos (situación académica)

Estado, curso vigente y nivel derivado de cada estudiante (el nivel siempre proviene del curso).
Acciones: «Nuevo alumno» (formulario con datos, estado, número de legajo y curso), **Corregir
identidad** (DNI y legajo), **Cambiar curso** (nunca ofrece el curso vigente) e **Inactivar** o
**Reactivar**. La baja es lógica: no se elimina ningún dato; un alumno activo tiene exactamente una
matrícula vigente y un legajo, y para reactivarlo hay que elegir un curso activo.

### 6.4 Profesores

Fichas de docentes con legajo, especialidad, estado y lo que tienen a cargo. El alta de la persona y
su cuenta se hace en Usuarios; acá se usa «Editar ficha», «Inactivar» o «Reactivar» y «Ver detalle»
(datos personales, historial de estados con motivo, materias y grupos vigentes e históricos).
Filtros por estado. Una ficha cuya persona ya no tiene rol Docente se conserva como historial y no
se puede reactivar.

### 6.5 Cursos, Niveles, Materias y Horarios académicos

* **Cursos**: «Nuevo curso» (denominación, división y nivel), «Editar» e «Inactivar» o «Reactivar».
  Se conservan los datos y las relaciones.
* **Niveles**: «Nuevo nivel», «Renombrar» e «Inactivar» o «Reactivar». Los nombres de los niveles
  institucionales están protegidos para mantener referencias estables; su disponibilidad sí puede
  cambiar sin borrar datos.
* **Materias**: «Nueva materia», «Renombrar», inactivar o reactivar, «Asignar a un curso» (solo
  cursos activos) y elegir el profesor responsable (opcional, solo perfiles con rol Docente).
  Las relaciones inactivas quedan como historial.
* **Horarios académicos**: se elige la asignación (materia y curso) y se agregan franjas
  semanales con día, hora de inicio y hora de fin. Las franjas contiguas se admiten; una que se
  superpone con otra materia o con un deporte se rechaza sin cambios parciales
  («La franja se superpone con…»). Se pueden «Editar o reasignar», «Desactivar» y «Reactivar»; el
  historial de cambios se conserva.

### 6.6 Comedor, Transporte y Deportes (administración)

* **Comedor**: alumnos inscriptos con legajo, estado (Activa o Cancelada), **confirmación** y fechas;
  filtros «Inscriptos», «Bajas», «Todas» y búsqueda por apellido o legajo.
* **Transporte**: los cuatro recorridos con sus paradas y la cantidad de inscripciones activas; se
  puede «Editar» el nombre y marcar el recorrido activo o inactivo (el código y las paradas no se
  editan desde ninguna pantalla); además, el listado de inscripciones con filtro por recorrido.
  Dirección no inscribe a nadie en transporte: el alta la hace el estudiante.
* **Deportes**: catálogo de deportes («Nuevo deporte», «Renombrar», «Inactivar» o «Reactivar»);
  grupos («Nuevo grupo» con deporte, nivel, nombre, cupo de 1 a 100 y profesor responsable con rol
  Docente; «Editar» cambia nombre, cupo y profesor, no el deporte ni el nivel; «Inactivar» o
  «Reactivar»); **«Horarios»** de cada grupo (un grupo sin franjas no admite inscripciones);
  «Inscribir alumno», que aplica las mismas reglas que el autoservicio (cupo, nivel, máximo de dos
  deportes, compatibilidad horaria); y el listado de inscripciones.
* **Confirmar y cancelar inscripciones** (comedor, transporte y deportes): cada fila muestra dos
  estados distintos, el vigente (Activa o Cancelada) y la confirmación (Confirmada por quién y
  cuándo, o Sin confirmar). «Confirmar» es una acción posterior al alta; una inscripción activa sin
  confirmar sigue siendo válida. «Cancelar inscripción» actúa en nombre del alumno, pide
  confirmación y deja la inscripción cancelada en el historial, sin eliminar nada.

### 6.7 Actividades (cupos)

Gestión de las actividades con cupo: filtros por tipo y nivel, edición del cupo máximo, «Inscribir
alumno a actividad» (elegir el alumno y tocar «Inscribir» en la actividad), «Ver inscriptos» y baja
de una inscripción. Las actividades de deportes antiguos figuran como «Histórico» y no admiten
inscripción ni baja.

### 6.8 Asistencias

Misma pantalla que la del docente (sección 4.2), pero sin límite de vínculo: Dirección ve y registra a
todos los alumnos.

### 6.9 Credenciales QR

* **Credenciales**: listado de alumnos con el estado de la credencial (Vigente, Revocada, Sin
  credencial) y, si corresponde, «Alumno inactivo»; búsqueda por nombre, apellido o legajo y filtro
  por estado. «Ver credencial» abre el detalle.
* **Detalle**: tarjeta, historial y acciones. «Emitir credencial» es **siempre un clic explícito**:
  la ausencia de credencial nunca dispara una emisión. «Reponer credencial» revoca la actual y emite
  una nueva en el mismo paso; «Revocar credencial» la deja sin validez para siempre. Reponer y
  revocar piden un **motivo de 3 a 200 caracteres** que queda en el historial. Con el alumno inactivo
  no se puede emitir ni reponer (solo revocar).
* Una credencial por alumno como máximo vigente. Si otra persona la cambió mientras tanto, aparece
  «La credencial ya no está vigente. Actualizá la pantalla…» y el botón «Actualizar pantalla».

### 6.10 Registrar accesos y Auditoría de accesos

«Registrar accesos» funciona como en la sección 7. La **Auditoría** (exclusiva de Dirección) lista
los accesos registrados y denegados de comedor y transporte con el **motivo interno** de cada
denegación (por ejemplo: ya registrado ese día, credencial revocada, alumno inactivo, acceso
bloqueado, servicio o recorrido inactivo, sin inscripción activa, inscripto en otro recorrido).
Filtros por día, resultado y servicio, paginados. «Anular» un acceso registrado por error pide un
motivo de 3 a 200 caracteres; el registro original se conserva.

### 6.11 Reportes oficiales

Seis reportes: alumnos por curso y nivel, por materia, por deporte, por horario y por recorrido, y
docentes por nivel. Cada uno declara qué es una fila («grano»). Se pueden **filtrar** (texto libre,
nivel, curso, materia, deporte, recorrido, horario, responsable, origen y, donde corresponde,
«incluir historial»), paginar (25, 50 o 100 filas), **«Exportar CSV»** e **«Imprimir o guardar como
PDF»** (el PDF se genera con la impresión del navegador). La impresión admite hasta 10.000 filas;
por encima se avisa y se ofrece acotar o exportar. Los filtros viajan en la dirección de la página.

### 6.12 Solicitudes, Postulaciones y Testimonios

* **Solicitudes de inscripción**: pre-inscripciones del formulario público. Estados Pendiente,
  Revisado y Aceptado; «Marcar revisado» y «Aceptar». **Aceptar** crea el perfil de estudiante con
  un número de legajo (si ya existe un perfil con ese DNI, solo marca la solicitud como aceptada). No
  crea una cuenta de ingreso ni una matrícula.
* **Postulaciones**: lista de solo lectura de lo recibido por el formulario de Empleo.
* **Testimonios**: los enviados desde el sitio quedan pendientes; «Aprobar» los publica y
  «Eliminar» los quita.

### 6.13 Lo que Dirección no puede hacer

* Cambiar su propio rol ni bloquear su propia cuenta.
* Modificar el código o las paradas de un recorrido de transporte, ni el deporte o el nivel de un
  grupo ya creado.
* Emitir o reponer la credencial de un alumno inactivo.
* Eliminar datos: las bajas del sistema son lógicas y conservan el historial.

## 7. Credencial QR y cómo se escanea

### 7.1 Qué es

Cada alumno puede tener **una credencial digital con código QR** vigente. La tarjeta muestra
nombre, apellido y legajo (nunca el DNI ni una foto) y un QR **personal**: «Mostralo solo cuando
te lo pidan y no lo compartas». Se emite, repone o revoca únicamente por Dirección.

### 7.2 Cómo obtenerla y usarla

1. Dirección emite la credencial (sección 6.9).
2. El estudiante entra a «Mi credencial», o el padre a «Credenciales de mis hijos».
3. Tocá «Descargar imagen» para guardarla en el celular o «Imprimir» para sacarla en papel.
4. Mostrá el QR en la pantalla o impreso al personal que controla el acceso.

La credencial vale mientras el alumno esté activo y con el acceso habilitado; si no, la tarjeta
muestra el motivo en lugar del QR.

### 7.3 Cómo se escanea (Dirección y Personal)

1. Entrá a «Registrar accesos».
2. **Paso 1: elegí el servicio.** «Comedor» o «Transporte». Para Transporte, elegí además el
   **recorrido** donde estás escaneando y el **sentido** (Ida o Vuelta).
3. **Paso 2: leé el código.** «Escanear con la cámara» (el navegador pide permiso para usar la
   cámara; la lectura solo funciona en una conexión segura, HTTPS) o «Usar una foto del QR». La
   imagen se procesa en el mismo dispositivo y no se guarda. «Detener la cámara» la apaga.
4. **Paso 3: mirá el resultado.**

| Resultado | Significa | Qué hacer |
| --- | --- | --- |
| «Acceso registrado» | Se anotó el acceso; se ven nombre, legajo y hora durante 5 segundos y luego se ocultan por privacidad | Tocá «Escanear siguiente» |
| «Ya registrado hoy» | Ese alumno ya figuraba ese día en ese servicio; no se duplica | Seguir con el siguiente |
| «No habilitado» | La persona no puede usar ese servicio (sin inscripción activa, alumno inactivo, credencial revocada, otro recorrido, etc.); el motivo exacto solo lo ve Dirección en la auditoría | Derivarla con Dirección |
| «Código QR no reconocido» | El código no es de una credencial válida | Probar de nuevo o derivar con Dirección |
| «No se pudo registrar» | Falla de la solicitud | Seguir el mensaje; con «Reintentar» se reutiliza el mismo intento y **no se duplica** el acceso |
| «Demasiados intentos» | Límite de escaneos en poco tiempo | Esperar los minutos indicados |

Problemas de cámara: «El navegador no permitió usar la cámara» (habilitala en los permisos del
sitio o usá una foto), «No encontramos una cámara en este dispositivo» y «No pudimos leer un código
QR en la imagen» (acercá el código y evitá los reflejos). Cambiar el servicio, el recorrido o el
sentido detiene la cámara y limpia el resultado.

Los datos del QR no se guardan en el navegador (ni en el almacenamiento local ni en la dirección de
la página) y no existe modo sin conexión.

## 8. Sitio público

* **Pre-inscripción** («Inscribirse»): formulario de tres pasos (Datos del aspirante, Información de
  contacto, Responsable legal). Al enviarlo aparece «Solicitud enviada con éxito»; Dirección lo
  recibe en «Solicitudes». Si falla: «Hubo un error al enviar la solicitud. Intentá de nuevo.».
* **Empleo**: formulario con puesto, datos de contacto y un mensaje de 20 a 800 caracteres.
  Confirma con «¡Postulación enviada!».
* **Noticias** (con detalle de cada artículo y paginación), **Galería**, **Niveles**, **Bienestar**,
  **Quiénes Somos** y **Contacto** son páginas informativas.
* **Testimonios**: desde el inicio, «Agregar testimonio». Se revisa antes de publicarse.

## 9. Preguntas frecuentes

**No puedo ingresar. ¿Qué hago?**
Revisá el email y la contraseña. Si el mensaje dice que el acceso está bloqueado o que el correo no
está confirmado, es Dirección quien tiene que resolverlo. Después de varios intentos fallidos hay una
espera de unos minutos.

**Olvidé mi contraseña.**
La aplicación no ofrece un flujo propio para recuperarla. Comunicate con Dirección o con la escuela.

**Veo «Acceso restringido».**
La pantalla no corresponde a tu rol. Volvé al panel con «Volver al panel» y usá las secciones de tu
menú.

**Veo «Tu cuenta no tiene un perfil».**
La cuenta existe pero Dirección todavía no creó el perfil. Pedile que lo complete.

**Mi hijo no aparece en «Mis hijos».**
El vínculo familiar lo carga la administración. Contactala; mientras no esté vinculado, no podés ver
sus datos.

**¿Por qué no puedo cambiar el curso de mi hijo?**
Después de confirmar la matrícula, solo la administración académica puede cambiarlo.

**Como docente, no veo a un alumno en Asistencias.**
Solo ves a los alumnos con vínculo vigente: los de los cursos donde dictás una materia (asignación
activa) y los de tus grupos deportivos activos. Si Dirección cambió una asignación, tocá
«Actualizar».

**Como estudiante o padre, ¿puedo corregir una asistencia?**
No. Es de solo lectura. Pedí la corrección al docente o a Dirección.

**No puedo inscribirme a un deporte.**
Puede ser por nivel (el grupo es de otro nivel), por plazas, por el máximo de dos deportes activos,
por tener ya otro grupo del mismo deporte, por superposición de horarios, o porque tu legajo está
inactivo o sin curso. El mensaje en pantalla indica la causa.

**Mi credencial no muestra el QR.**
Mirá el aviso de la tarjeta: puede no haberse emitido, estar revocada, o no ser válida por estar el
alumno inactivo o con el acceso bloqueado. Dirección resuelve los tres casos.

**El escáner dice «No habilitado». ¿Es un error?**
No necesariamente: significa que esa persona no puede usar ese servicio hoy. El motivo exacto lo ve
Dirección en la auditoría; Personal debe derivar a la persona con Dirección.

**Registré un acceso por error.**
Solo Dirección puede anularlo desde «Auditoría de accesos» y el registro original se conserva.

**¿Se borra algo cuando se da de baja una inscripción, un alumno o un deporte?**
No. Las bajas son lógicas: el historial se conserva.

## 10. Alcance y requerimientos

Este manual describe lo que hoy ofrece la aplicación. No están disponibles, porque no existen en el
código: recuperación de contraseña por cuenta propia, administración de los vínculos padres-hijos
desde Usuarios, registro manual de accesos por legajo o DNI, modo sin conexión para el escáner y
publicación de un menú del comedor.

Los requerimientos funcionales y no funcionales a los que remite cada pantalla constan en las
evidencias de `docs/evidence/` y en los títulos de las tareas del tablero de Jira:

| Requerimiento | Pantallas relacionadas |
| --- | --- |
| RF2 Administrar materias | Materias |
| RF3 Administrar horarios de materias y cursos | Horarios académicos |
| RF4 Administrar niveles educativos | Niveles |
| RF5 y RF10 Transporte y sus cuatro recorridos | Transporte |
| RF8 Administrar profesores | Profesores y Mis asignaciones |
| RF16 Administrar inscripciones | Comedor, Transporte, Deportes (confirmar y cancelar) |
| RF17 Reportes oficiales de la Dirección | Reportes |
| RF18 Administrar deportes y grupos | Deportes (Dirección) |
| RF19 Administrar usuarios y permisos | Usuarios y roles |
| RF20 Credencial digital QR | Credenciales, Mi credencial, Credenciales de mis hijos |
| RF21 Registrar accesos con QR | Registrar accesos y Auditoría de accesos |
| RNF2 Diseño responsive (375 y 1280 píxeles de ancho) | Todo el panel |
