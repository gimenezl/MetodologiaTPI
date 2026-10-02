# EPT-67 — Ejecutar las pruebas funcionales, por rol y E2E

> **Estado: pruebas por rol y E2E completas ejecutadas contra un stack local aislado con el esquema
> final (migración 30) y datos sintéticos; en producción solo se hicieron los recorridos acotados de
> `docs/evidence/EPT-66.md` §10.** Este documento **no** declara completa la matriz transversal de
> seguridad: ver §8.

## 1. Alcance y qué significa «por rol»

En este repositorio los **proyectos de Playwright** son los roles y perfiles. Cada proyecto de rol
abre el navegador con la sesión (`storageState`) de una identidad sintética creada por el proyecto
`setup`; los proyectos de navegador (`chromium`, `pixel-5-chromium`, `iphone-13-webkit`) ejecutan las
suites sin sesión real: lógica, bancos visuales con datos simulados, responsive y accesibilidad.

| Grupo | Proyectos |
|---|---|
| Preparación | `setup` (crea identidades y datos de prueba) |
| Roles principales | `chromium-directora`, `chromium-docente`, `chromium-estudiante`, `chromium-padre`, `chromium-personal`, `chromium-sin-perfil` |
| Variantes bloqueadas | `chromium-director-bloqueado`, `chromium-docente-bloqueado`, `chromium-estudiante-bloqueado`, `chromium-padre-bloqueado`, `chromium-personal-bloqueado` |
| Variantes de relación | `chromium-estudiante-ajeno` (alumno sin vínculo con los datos probados), `chromium-estudiante-inactivo`, `chromium-padre-segundo` |
| Navegadores base | `chromium` (escritorio), `pixel-5-chromium` (móvil Android), `iphone-13-webkit` (móvil WebKit) |

La corrida analizada es la **E2E completa del candidato D**, sobre el árbol de `main` en `fe07cd9`
(idéntico al del candidato `1cdd703`), con el esquema de PostgreSQL en la migración 30 y el servidor
`next dev`. Se ejecutó sin filtros con `node supabase/tests/correr-autenticadas.mjs --reporter=line,json`
(salida 0, 1874 s). La configuración de Playwright permite un reintento por prueba
(`retries: 1`); **ninguna prueba lo necesitó** en esta corrida.

### 1.1 Totales

Las cifras salen del JSON bruto de Playwright con el script reproducible `matriz.mjs` (ver §6), no
de transcripción manual. Coinciden con las esperadas y con el resumen del propio reporter.

| Cifra | Esperada | Calculada del JSON | Resumen de Playwright (`stats`) |
|---|---:|---:|---:|
| Seleccionadas | 1766 | 1766 | — |
| Aprobadas | 1752 | 1752 | 1752 (`expected`) |
| Omitidas | 14 | 14 | 14 (`skipped`) |
| Fallos | 0 | 0 | 0 (`unexpected`) |
| Flaky | 0 | 0 | 0 |
| Reintentos | 0 | 0 | — |

La suma de la matriz por proyecto y la de la matriz por archivo reproducen los mismos totales;
no hay proyectos fuera de las listas.

### 1.2 Matriz por proyecto (rol o navegador)

| Proyecto | Seleccionadas | Aprobadas | Omitidas | Fallos | Flaky | Reintentos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `setup` | 21 | 21 | 0 | 0 | 0 | 0 |
| `chromium-directora` | 251 | 244 | 7 | 0 | 0 | 0 |
| `chromium-docente` | 55 | 55 | 0 | 0 | 0 | 0 |
| `chromium-estudiante` | 92 | 92 | 0 | 0 | 0 | 0 |
| `chromium-padre` | 35 | 35 | 0 | 0 | 0 | 0 |
| `chromium-personal` | 36 | 36 | 0 | 0 | 0 | 0 |
| `chromium-sin-perfil` | 33 | 33 | 0 | 0 | 0 | 0 |
| `chromium-director-bloqueado` | 17 | 16 | 1 | 0 | 0 | 0 |
| `chromium-docente-bloqueado` | 7 | 7 | 0 | 0 | 0 | 0 |
| `chromium-estudiante-bloqueado` | 10 | 10 | 0 | 0 | 0 | 0 |
| `chromium-padre-bloqueado` | 6 | 6 | 0 | 0 | 0 | 0 |
| `chromium-personal-bloqueado` | 7 | 7 | 0 | 0 | 0 | 0 |
| `chromium-estudiante-ajeno` | 10 | 10 | 0 | 0 | 0 | 0 |
| `chromium-estudiante-inactivo` | 7 | 7 | 0 | 0 | 0 | 0 |
| `chromium-padre-segundo` | 2 | 2 | 0 | 0 | 0 | 0 |
| `chromium` | 657 | 656 | 1 | 0 | 0 | 0 |
| `pixel-5-chromium` | 260 | 260 | 0 | 0 | 0 | 0 |
| `iphone-13-webkit` | 260 | 255 | 5 | 0 | 0 | 0 |
| **Total** | **1766** | **1752** | **14** | **0** | **0** | **0** |

Lectura: las 7 omisiones de `chromium-directora` son 6 mediciones RF17 y 1 caso de QR sin clave de
firma; las 5 de `iphone-13-webkit` son límites del navegador de pruebas; las otras dos (`chromium`
y `chromium-director-bloqueado`) se explican en §2.

### 1.3 Matriz por archivo de spec (flujo o módulo)

Cada fila indica qué roles (proyectos de rol) y qué navegadores ejercen el archivo. Los archivos
`*-auth.spec.ts` corren contra el stack real (navegador, PostgREST, RLS, funciones) una vez por
cada rol listado, siempre en Chromium; los demás corren en los navegadores base listados. «Base»
agrupa la lógica pura y las interfaces con peticiones simuladas o bancos visuales sintéticos.

| Archivo de spec | Flujo o módulo | Tipo | Roles (proyectos de rol) | Navegadores | Aprobadas | Omitidas |
| --- | --- | --- | --- | --- | ---: | ---: |
| `auth.setup.ts` | Preparación de identidades y datos sintéticos | Preparación | — | — | 21 | 0 |
| `accesos-qr-auth.spec.ts` | Acceso por QR | Autenticada (stack real) | directora, estudiante, docente, padre, personal, sin-perfil, director-bloqueado, docente-bloqueado, estudiante-bloqueado, padre-bloqueado, personal-bloqueado | — | 34 | 0 |
| `administracion-deportes-auth.spec.ts` | Administración de deportes | Autenticada (stack real) | directora, estudiante, docente, padre, personal, sin-perfil, director-bloqueado | — | 30 | 0 |
| `alumnos-auth.spec.ts` | Alumnos | Autenticada (stack real) | directora, estudiante, estudiante-ajeno, docente, padre, personal, sin-perfil | — | 40 | 0 |
| `asistencias-vinculos-auth.spec.ts` | Asistencias por vínculo | Autenticada (stack real) | directora, estudiante, docente, padre, personal, sin-perfil, director-bloqueado, docente-bloqueado, estudiante-bloqueado, padre-bloqueado, personal-bloqueado | — | 28 | 0 |
| `comedor-auth.spec.ts` | Comedor | Autenticada (stack real) | directora, estudiante, estudiante-inactivo, docente, padre, personal, sin-perfil | — | 25 | 0 |
| `credenciales-qr-auth.spec.ts` | Credenciales QR | Autenticada (stack real) | directora, estudiante, estudiante-inactivo, estudiante-ajeno, docente, padre, padre-segundo, personal, sin-perfil, director-bloqueado, docente-bloqueado, estudiante-bloqueado, padre-bloqueado, personal-bloqueado | — | 22 | 1 |
| `cupos-legadas-auth.spec.ts` | Cupos de actividades legadas | Autenticada (stack real) | directora, estudiante, estudiante-ajeno, docente | — | 6 | 0 |
| `cursos-auth.spec.ts` | Cursos | Autenticada (stack real) | directora, estudiante | — | 14 | 0 |
| `deportes-auth.spec.ts` | Deportes | Autenticada (stack real) | directora, estudiante, estudiante-inactivo, estudiante-ajeno, docente, padre, personal, sin-perfil | — | 30 | 0 |
| `gestion-estudiantes-auth.spec.ts` | Gestión de estudiantes | Autenticada (stack real) | directora, docente | — | 4 | 0 |
| `horarios-academicos-auth.spec.ts` | Horarios académicos | Autenticada (stack real) | directora, docente | — | 3 | 0 |
| `horarios-auth.spec.ts` | Horarios | Autenticada (stack real) | directora, estudiante, estudiante-ajeno, docente, padre, personal, sin-perfil | — | 24 | 0 |
| `inscripciones-administracion-auth.spec.ts` | Administración de inscripciones | Autenticada (stack real) | directora, estudiante, docente, padre, personal, sin-perfil, director-bloqueado, estudiante-bloqueado | — | 48 | 0 |
| `inscripciones-administracion-e2e-auth.spec.ts` | Administración de inscripciones (E2E) | Autenticada (stack real) | directora, estudiante, estudiante-ajeno, docente, padre, personal, sin-perfil, director-bloqueado | — | 31 | 0 |
| `inscripciones-administracion-paginacion-auth.spec.ts` | Administración de inscripciones (paginación) | Autenticada (stack real) | directora | — | 7 | 0 |
| `materias-auth.spec.ts` | Materias | Autenticada (stack real) | directora, estudiante | — | 15 | 0 |
| `niveles-auth.spec.ts` | Niveles | Autenticada (stack real) | directora, estudiante | — | 14 | 0 |
| `profesores-auth.spec.ts` | Profesores | Autenticada (stack real) | directora, estudiante, docente, padre, personal, sin-perfil | — | 14 | 0 |
| `reportes-auth.spec.ts` | Reportes oficiales | Autenticada (stack real) | directora, estudiante, docente, padre, personal, sin-perfil, director-bloqueado | — | 46 | 1 |
| `reportes-rendimiento-auth.spec.ts` | Reportes (rendimiento, mediciones) | Autenticada (stack real) | directora | — | 0 | 6 |
| `transporte-auth.spec.ts` | Transporte | Autenticada (stack real) | directora, estudiante, estudiante-inactivo, docente, padre, personal, sin-perfil | — | 26 | 0 |
| `usuarios-auth.spec.ts` | Usuarios | Autenticada (stack real) | directora, estudiante, docente | — | 53 | 0 |
| `usuarios-permisos-auth.spec.ts` | Usuarios y permisos | Autenticada (stack real) | directora, estudiante, docente, padre, personal, sin-perfil, director-bloqueado, docente-bloqueado, estudiante-bloqueado, padre-bloqueado, personal-bloqueado | — | 40 | 0 |
| `hijos-auth.spec.ts` | Hijos y matrícula | Autenticada (stack real) | estudiante, docente, padre, padre-segundo, personal | — | 6 | 0 |
| `accesos-qr-cripto.spec.ts` | Acceso por QR | Base (interfaz con datos simulados o lógica) | — | chromium | 18 | 0 |
| `accesos-qr-servicio.spec.ts` | Acceso por QR | Base (interfaz con datos simulados o lógica) | — | chromium | 27 | 0 |
| `accesos-qr-ui.spec.ts` | Acceso por QR | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 91 | 2 |
| `accesos-qr.spec.ts` | Acceso por QR | Base (interfaz con datos simulados o lógica) | — | chromium | 6 | 0 |
| `administracion-deportes-ui.spec.ts` | Administración de deportes | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 75 | 0 |
| `administracion-deportes.spec.ts` | Administración de deportes | Base (interfaz con datos simulados o lógica) | — | chromium | 5 | 0 |
| `alumnos-contraste.spec.ts` | Alumnos | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 69 | 0 |
| `alumnos-correcciones.spec.ts` | Alumnos | Base (interfaz con datos simulados o lógica) | — | chromium | 11 | 0 |
| `alumnos-ui.spec.ts` | Alumnos | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 48 | 0 |
| `alumnos.spec.ts` | Alumnos | Base (interfaz con datos simulados o lógica) | — | chromium | 10 | 0 |
| `asistencias-lib.spec.ts` | Asistencias (lógica) | Base (interfaz con datos simulados o lógica) | — | chromium | 16 | 0 |
| `asistencias-vinculos-ui.spec.ts` | Asistencias por vínculo | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 24 | 0 |
| `captura.spec.ts` | Capturas de evidencia | Base (interfaz con datos simulados o lógica) | — | chromium | 1 | 0 |
| `comedor-ui.spec.ts` | Comedor | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 47 | 1 |
| `comedor.spec.ts` | Comedor | Base (interfaz con datos simulados o lógica) | — | chromium | 8 | 0 |
| `credenciales-qr-cripto.spec.ts` | Credenciales QR | Base (interfaz con datos simulados o lógica) | — | chromium | 24 | 0 |
| `credenciales-qr-ui.spec.ts` | Credenciales QR | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 72 | 0 |
| `cupos-legadas-ui.spec.ts` | Cupos de actividades legadas | Base (interfaz con datos simulados o lógica) | — | chromium | 13 | 0 |
| `cursos-ui.spec.ts` | Cursos | Base (interfaz con datos simulados o lógica) | — | chromium | 18 | 0 |
| `cursos.spec.ts` | Cursos | Base (interfaz con datos simulados o lógica) | — | chromium | 7 | 0 |
| `deportes-ui.spec.ts` | Deportes | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 27 | 0 |
| `deportes.spec.ts` | Deportes | Base (interfaz con datos simulados o lógica) | — | chromium | 5 | 0 |
| `e2e.spec.ts` | Recorrido general | Base (interfaz con datos simulados o lógica) | — | chromium | 4 | 0 |
| `hijos-ui.spec.ts` | Hijos y matrícula | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 3 | 0 |
| `horarios-ui.spec.ts` | Horarios | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 21 | 0 |
| `horarios.spec.ts` | Horarios | Base (interfaz con datos simulados o lógica) | — | chromium | 3 | 0 |
| `inscripciones-administracion-ui.spec.ts` | Administración de inscripciones | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 160 | 2 |
| `inscripciones-administracion.spec.ts` | Administración de inscripciones | Base (interfaz con datos simulados o lógica) | — | chromium | 6 | 0 |
| `inscripciones-legadas-lib.spec.ts` | Inscripciones legadas (lógica) | Base (interfaz con datos simulados o lógica) | — | chromium | 15 | 0 |
| `materias-ui.spec.ts` | Materias | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 42 | 0 |
| `materias.spec.ts` | Materias | Base (interfaz con datos simulados o lógica) | — | chromium | 11 | 0 |
| `niveles-ui.spec.ts` | Niveles | Base (interfaz con datos simulados o lógica) | — | chromium | 9 | 0 |
| `niveles.spec.ts` | Niveles | Base (interfaz con datos simulados o lógica) | — | chromium | 9 | 0 |
| `paginacion-paralela.spec.ts` | Paginación en paralelo | Base (interfaz con datos simulados o lógica) | — | chromium | 20 | 0 |
| `paginacion.spec.ts` | Paginación | Base (interfaz con datos simulados o lógica) | — | chromium | 12 | 0 |
| `profesores-ui.spec.ts` | Profesores | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 42 | 0 |
| `profesores.spec.ts` | Profesores | Base (interfaz con datos simulados o lógica) | — | chromium | 4 | 0 |
| `redireccion-login.spec.ts` | Redirección de inicio de sesión | Base (interfaz con datos simulados o lógica) | — | chromium | 26 | 0 |
| `reportes-lib.spec.ts` | Reportes oficiales | Base (interfaz con datos simulados o lógica) | — | chromium | 61 | 0 |
| `reportes.spec.ts` | Reportes oficiales | Base (interfaz con datos simulados o lógica) | — | chromium | 4 | 0 |
| `responsive-regresion.spec.ts` | Responsive y accesibilidad | Base (interfaz con datos simulados o lógica) | — | chromium | 44 | 0 |
| `semantica-estatica.spec.ts` | Semántica estática | Base (interfaz con datos simulados o lógica) | — | chromium | 2 | 0 |
| `transporte-ui.spec.ts` | Transporte | Base (interfaz con datos simulados o lógica) | — | chromium, pixel-5, iphone-13 | 47 | 1 |
| `niveles-responsive.spec.ts` | Niveles (responsive) | Base (interfaz con datos simulados o lógica) | — | pixel-5, iphone-13 | 4 | 0 |

Los flujos cubiertos por rol son: cupos y deportes (alta, baja, reinscripción y administración),
asistencias por vínculo, inscripciones (autoservicio y administración), credenciales y acceso por
QR, reportes oficiales, comedor, transporte, usuarios y permisos, hijos y matrícula, alumnos,
cursos, materias, niveles, profesores y horarios.

## 2. Las 14 omisiones y por qué no son defectos

Cada omisión está declarada en la propia prueba con una condición explícita (`test.skip` con motivo);
el JSON conserva el motivo. Ninguna oculta un fallo: o es una medición opt-in, o depende de un
entorno que esta corrida no tiene, o no aplica al perfil.

| # | Cantidad | Prueba (proyecto) | Motivo declarado | Por qué no es un defecto |
|---|---:|---|---|---|
| 1 | 6 | `reportes-rendimiento-auth.spec.ts`, una por reporte: alumnos por curso, materia, deporte, horario, recorrido y docentes por nivel (`chromium-directora`) | Requiere `EPT_BENCH=1`: es una medición, no una prueba funcional | Mide tiempos de RF17 (umbral de 60 s) con un volumen grande; es opt-in y no verifica comportamiento funcional |
| 2 | 1 | `credenciales-qr-auth.spec.ts`, «sin clave de firma el servidor falla cerrado…» (`chromium-directora`) | Requiere `EPT_URL_SIN_CLAVE` (servidor sin clave de firma) | Necesita levantar un segundo servidor sin la clave; es opt-in y el resto de las pruebas de credenciales QR aprueba |
| 3 | 1 | `reportes-auth.spec.ts`, «el menú no ofrece Reportes» (`chromium-director-bloqueado`) | Un perfil bloqueado no llega al panel | El caso verifica un menú que un perfil bloqueado nunca alcanza, porque no llega al panel; la prueba lo declara no aplicable |
| 4 | 1 | `inscripciones-administracion-ui.spec.ts`, «los objetivos táctiles miden al menos 44 px en móvil…» (`chromium`) | Solo aplica a los perfiles móviles | Se ejecuta y aprueba en `pixel-5-chromium` y `iphone-13-webkit`; en escritorio no tiene sentido |
| 5 | 2 | `accesos-qr-ui.spec.ts`, la detención de la cámara activa y el clic duplicado en «Escanear con la cámara» (`iphone-13-webkit`) | Este navegador de pruebas no implementa MediaStream | Límite del WebKit emulado; las mismas pruebas aprueban en Chromium y Pixel 5 |
| 6 | 3 | «se opera completamente con el teclado» en `comedor-ui.spec.ts`, `inscripciones-administracion-ui.spec.ts` y `transporte-ui.spec.ts` (`iphone-13-webkit`) | El perfil táctil de WebKit no expone teclado físico | Límite del perfil táctil; el recorrido por teclado aprueba en Chromium y Pixel 5 |

Total: 6 + 1 + 1 + 1 + 2 + 3 = 14, igual a las omitidas del JSON. Las mismas 14 se registraron en la
corrida del candidato C, con idénticos motivos.

## 3. Pruebas SQL por rol (evidencia complementaria de enforcement en PostgreSQL)

La E2E prueba el comportamiento visible; las suites SQL prueban el enforcement por rol en
PostgreSQL (políticas RLS, privilegios, funciones `SECURITY DEFINER`) con los roles reales
`anon`, `authenticated` y `service_role` y las identidades de cada perfil. Corrieron en el esquema
final (reset 0 a 30), con salida 0 y sin fallos:

| Verificación | Resultado |
|---|---|
| Suites SQL aplicables en el esquema 30 | 27 ejecutadas, 0 fallos, ninguna omitida |
| Suites nuevas de asistencias (unidad D) | 6 suites, 28 + 24 + 22 + 29 + 28 + 20 = **151** comprobaciones, 0 fallos |
| Suites de concurrencia con conexiones reales | 15 scripts, 0 fallos (el nuevo de asistencias cubre 8 carreras con `pg_blocking_pids`) |
| Migración 30 sobre datos existentes | mismo conteo y huella de asistencias; registrantes intactos |
| Harness de producción y harness negativo | 53 y 58 comprobaciones, 0 fallos |
| `tsc`, `lint`, `build`, tipos generados, `db lint`, advisors | exit 0 (lint: 0 errores, 30 advertencias preexistentes) |

Las 6 suites de asistencias cubren: actores bloqueados, identidad de escritura, superficie de
seguridad, vínculo académico, vínculo deportivo y vínculos combinados. Complementan la matriz por rol:
por ejemplo, el DOCENTE solo lee y registra a los alumnos que tiene a cargo (regla aprobada de la
unidad D).

## 4. Producción

El proyecto de Supabase y el despliegue de Vercel de producción recibieron las migraciones 28, 29 y
30 con autorización puntual cada una (ver `docs/evidence/EPT-66.md` §10). Tras la 30 se hicieron
recorridos con **sesión real**, con cuentas ficticias autorizadas y sin `service_role`.

### 4.1 Lo que se probó con sesión real en producción

| Recorrido | Rol | Resultado |
|---|---|---|
| Ciclos de Cupos: alta con la lista abierta, baja y repetición tras la 29 | Dirección (navegador) | Alta 1/1 con el alumno visible sin cerrar la lista; baja lógica 0/1 |
| Asistencias: la pantalla nueva carga y registra una asistencia PRESENTE | Dirección (navegador) | Registro 1/1 |
| 17 comprobaciones por rol contra PostgREST y RPC | DOCENTE sin vínculo, estudiante, padre vinculado, anónimo | **17 de 17 aprobadas** |

Detalle de las 17: el DOCENTE sin vínculo ve 0 asistencias y 0 alumnos, `registrar_asistencia` se
deniega (`P6610`) y el INSERT directo se deniega (`42501`), con o sin `docente_id` ajeno; el
estudiante y el padre ven solo lo propio o lo del hijo vinculado y no registran; el estudiante de
control no ve nada ajeno; sin sesión, el GET responde 401 y la RPC y el SELECT de `anon` se deniegan.
El recuento de `asistencias` fue 26 antes y después del smoke (la fila extra es la de Dirección) y
las 3 inscripciones originales siguieron ACTIVO e intactas.

### 4.2 Lo NO probado en producción

| Caso | Motivo | Cobertura alternativa |
|---|---|---|
| Caso positivo del DOCENTE **con** vínculo vigente | No existen datos académicos o deportivos ficticios para esa cuenta | Local: 6 suites SQL nuevas y E2E por rol |
| `GET /api/asistencias` con sesión de DOCENTE por HTTP (cookie SSR) | Solo se probó el 401 anónimo por HTTP | Consultas con el JWT de cada rol (17 comprobaciones) y E2E local |
| Sesión real de PERSONAL | No se usó una cuenta de ese rol en producción | E2E local (`chromium-personal`, 36 aprobadas) y suites SQL |
| Cuentas bloqueadas con sesión real | Idem | E2E local (5 proyectos `*-bloqueado`, 47 pruebas, 46 aprobadas y 1 omitida) y suites SQL |
| Flujos destructivos (altas masivas, purgas, administración de inscripciones, transporte con recorridos reales) | Por diseño solo se prueban en el stack aislado | E2E local; el alcance de datos reales corresponde a EPT-68 |

## 5. Defectos

### 5.1 Defectos hallados durante EPT-66 y su cierre

| Defecto | Cómo se detectó | Cierre |
|---|---|---|
| La lista de inscriptos de Cupos no se refrescaba tras inscribir | Prueba autenticada de la unidad C | Corregido en la #37 (`VistaGestionCupos.tsx`) con regresión nueva en `cupos-legadas-auth.spec.ts`; verificado en producción alta → baja con la lista abierta |
| Lectura global de pares alumno–actividad por cualquier sesión autenticada | Política `USING (true)` heredada, reproducida en la unidad C | Migración 29: tres políticas acotadas (alumno propio, padre vinculado, Dirección); DOCENTE, PERSONAL, ajenos, bloqueados y anónimo reciben 0 filas o 42501 |
| Fuga del listado de alumnos y escritura global de asistencias por cualquier DOCENTE | Reproducido contra el esquema 29: las 6 suites nuevas fallan antes de la migración | Migración 30: el DOCENTE solo ve y registra a sus alumnos a cargo; no puede atribuir un registro a otro docente |
| Sobrecupo con altas simultáneas (2 ACTIVO con cupo 1) | Línea base de la unidad B | Bloqueo de fila y prueba de concurrencia (migración 28) |
| DELETE físico por Staff, alumno y padre; `TRUNCATE`/`DELETE` de `anon` en galería, menú y noticias | Unidad C | Migración 29: sin DELETE físico (trigger P6608), BAJA inmutable, solo `SELECT` en esas tablas |
| Redirección de login aceptaba cualquier valor; `<button>` dentro de `<a>`; checkout con CRLF; 14 errores de lint | Unidad A (22 de 26 pruebas de redirección fallaban en la línea base) | Corregidos en la unidad A (#33) con pruebas permanentes |

Además, la primera corrida autenticada de C tuvo 7 fallos con 4 causas, todas del arnés o de pruebas
anteriores al contrato nuevo (no de la base ni de la aplicación); se corrigieron las pruebas y los
archivos afectados pasaron al repetirse (`docs/evidence/EPT-66/C-aplicacion-contraccion.md` §4b).

### 5.2 Prueba flaky registrada

| Prueba | Corrida | Ocurrencia | Seguimiento |
|---|---|---|---|
| `usuarios-permisos-auth.spec.ts`, «sin sesión, cada endpoint nuevo responde 401 y la pantalla de bloqueo lleva al inicio de sesión» (`chromium-directora`) | E2E completa del candidato C (1698 seleccionadas) | Timeout en compilación en frío (`timedOut`) en el primer intento y aprobada en el reintento | No reprodujo en 3 repeticiones aisladas (`--repeat-each=3`, 3 de 3 aprobadas) ni en la E2E completa del candidato D (0 flaky, 0 reintentos) |

### 5.3 Estado de los defectos

**No quedan defectos críticos conocidos abiertos** en la evidencia de EPT-66 y de esta corrida: los
defectos listados arriba constan como cerrados y verificados; la E2E completa del esquema final
terminó con 0 fallos. Esta afirmación se limita a lo que consta en la evidencia y a lo ejecutado
en el stack local; no es una garantía sobre producción (ver §8).

### 5.4 Riesgos abiertos

| Riesgo | Detalle | Dueño |
|---|---|---|
| Corrección de asistencia sin huella | Un docente vinculado o Dirección puede corregir el estado de una asistencia cargada y no queda registro de quién la corrigió; el registrante original no cambia | Lucas (decisión abierta, `D-asistencias.md` §5) |
| Hallazgos heredados | `npm audit` con 7 hallazgos (1 crítica, 4 altas, 1 moderada, 1 baja); advisors de seguridad (3 INFO y 2 WARN) y de rendimiento (10 INFO y 5 WARN) preexistentes | Backlog |
| Aviso de Next GHSA-vcvr-r3jv-pc5j | Afecta a 16.3.3 (parche en 16.3.6); no se observó la ruta afectada en las fuentes | Backlog |
| Cuentas y datos ficticios en producción | Siguen en producción; se conservan sus historiales sin DELETE físico | EPT-68 (purga) |
| Deadlock residual (`40P01`) | Posible con una operación futura no revisada; el servidor responde 409 «volvé a intentarlo» | Sin dueño asignado en la evidencia |

## 6. Reproducibilidad

### 6.1 Entorno

| Componente | Versión |
|---|---|
| Node.js | 24.19.0 |
| Next.js | 16.3.3 |
| Playwright | 1.59.1 |
| Supabase CLI | 2.119.0 (tipos con el generador oficial 2.117.0) |
| PostgreSQL | 17.x (stack local 17.11; restauraciones aisladas en 17.6) |
| Servidor de la E2E | `next dev` (la compatibilidad con el esquema 28 se verificó con `next start`) |

### 6.2 Comandos

Con el stack local aislado en el esquema 30 (reset 0 a 30) y desde la raíz del repositorio:

| Qué | Comando |
|---|---|
| E2E completa, todos los proyectos | `node supabase/tests/correr-autenticadas.mjs --reporter=line,json` |
| Un archivo o un rol | `node supabase/tests/correr-autenticadas.mjs tests/<archivo>.spec.ts --project=<proyecto> --reporter=line,json` |
| Repetición del flaky | `node supabase/tests/correr-autenticadas.mjs tests/usuarios-permisos-auth.spec.ts --project=chromium-directora --project=setup -g "sin sesión, cada endpoint nuevo" --repeat-each=3 --reporter=line,json` |
| Mediciones RF17 (opt-in) | Definir `EPT_BENCH=1` antes de la corrida |
| QR sin clave de firma (opt-in) | Definir `EPT_URL_SIN_CLAVE` con el servidor sin clave |
| Matrices de este documento | `node matriz.mjs <json-de-playwright> > matriz.json` y `node tablas.mjs matriz.json` |

El arnés usa `next dev` y las identidades sintéticas del proyecto `setup`; las capturas versionadas de otras
historias solo se regeneran con `EPT_CAPTURAS=1`, que **no** se usó en esta corrida. Los scripts
`matriz.mjs` y `tablas.mjs` recorren recursivamente `suites[].specs[].tests[]` del JSON, agrupan
por `projectName` y por archivo, y cuentan como omitida la prueba con estado `skipped`, como fallo
`unexpected`, como flaky `flaky`, y como reintento cada resultado adicional. Están en la evidencia
privada fuera del repositorio.

### 6.3 Huellas SHA-256 de la evidencia privada (fuera del repositorio)

| Archivo | SHA-256 |
|---|---|
| `dfull-e2e.json` (E2E de D, JSON bruto) | `436682a1474197118dbbb6c2fb9455ef12ecfa1a8cd96de676bdba2a98c9cab8` |
| `dfull-e2e.log` | `41fa5a2c53af838c1a0d640235efbf27a12531895555d0ce7c6463966bb6f493` |
| `dfull-e2e-exit.json` | `4899ed54674db3f774b0353fd5b849a7d9420fb5e69df851fb47b22a1bd168b6` |
| `dfull-step1.txt` (resumen de la batería de D) | `831319b01d6bdcf47872a65b65d2bc1e66726f3adc08f5c9f79351bbd7f87d8a` |
| `dfull-sha256.txt` (manifiesto de la batería de D) | `937f0c641ab4a39eb13765bbcf7fb036f5878ca9e64661c22bf6698fb0fa9c15` |
| `full-e2e.json` (E2E de C) | `aa398b5ce7e4e2f61603f3bfedf06762c949fb2200985792fc9b98b628ff2720` |
| `full-c28.json` (compatibilidad con el esquema 28) | `92ecbc3c55b0a87875260e8c2137ba80021749623822ddeac2a112380f283f0c` |
| `full-flaky-repro.json` (3 repeticiones del flaky) | `dbeebf14943ebd9352b262c1eae8c9c725f69a367dad09fe99495a93b96c0ba7` |
| `prod-smoke-30-roles.json` (smoke de producción) | `3dffb23bf4e98b928d2e37315fcb2de074a0a4c3a4d4d405e22bb028bd070dd7` |

El manifiesto `dfull-sha256.txt` lista los hashes de 61 archivos de la batería de D (incluye los tres
primeros de la tabla, además de suites SQL, concurrencia, advisors, build y lint). Los datos y las rutas privadas no se publican.

## 7. Verificación de la corrida de C y de compatibilidad con el esquema 28

| Corrida | Seleccionadas | Aprobadas | Omitidas | Fallos | Flaky |
|---|---:|---:|---:|---:|---:|
| E2E completa del candidato C, esquema 29 (`next dev`) | 1698 | 1683 | 14 | 0 | 1 (aprobada en el reintento) |
| `cupos-legadas-auth.spec.ts`, compatibilidad con el esquema 28 (`next start`) | 27 | 27 | 0 | 0 | 0 |
| Repetición del flaky (3 repeticiones, esquema 29) | 45 | 45 | 0 | 0 | 0 |

La primera fila reparte 1683 aprobadas en el primer intento y 1 en el reintento (1684 totales con
resultado final aprobado). La compatibilidad con el 28 prueba que la aplicación nueva funciona
también en la ventana entre el despliegue y la contracción.

## 8. Límites honestos

* La E2E corre contra un **stack local aislado con datos sintéticos**, no contra producción. Una
  corrida verde local no prueba el comportamiento de producción ni el de usuarios reales.
* En producción solo se hicieron los recorridos acotados de §4.1; lo no probado está en §4.2.
* **La matriz transversal de seguridad no se declara completa**: falta la prueba funcional completa
  por rol en producción (caso positivo del DOCENTE con vínculo, PERSONAL y cuentas bloqueadas con
  sesión real) y siguen abiertos los riesgos de §5.4.
* El proyecto `iphone-13-webkit` corre WebKit emulado: no implementa MediaStream ni teclado físico
  (5 omisiones), y no sustituye a un iPhone real. Tampoco se midió volumen ni carga concurrente real.
* Las mediciones RF17 de rendimiento (6 omitidas) no se ejecutaron en esta corrida.
* La paleta del PDF (RNF1) sigue pendiente de revisión humana, como consta en `EPT-66.md` §5.
* Los hashes de §6.3 permiten verificar los archivos privados, que no se publican; quien no los
  tenga no puede reproducir las cifras desde este documento, solo desde una corrida propia.
