# EPT-66 — Unidad D: asistencias del DOCENTE por vínculo vigente

> **Estado: integrada en `main` (#38, `fe07cd9`) y aplicada en producción (migración 30, 02/10/2026
> 19:13 ART).** El detalle de la ejecución en producción está en `docs/evidence/EPT-66.md` §10.

## 1. Regla aprobada

Un DOCENTE consulta y registra la asistencia de un alumno solo si existe al menos uno de estos vínculos
vigentes:

* **Académico:** matrícula vigente del alumno (`fecha_cierre IS NULL`) en un curso donde el docente
  tiene asignada y activa una materia curricular activa.
* **Deportivo:** inscripción deportiva `ACTIVA` en un grupo `activo` que ese docente dicta.

Si se revoca uno y el otro sigue vigente, el acceso se mantiene. Dirección conserva el acceso global;
el estudiante ve solo lo propio y el padre solo el de sus hijos vinculados (ambos en solo lectura); las
cuentas bloqueadas, PERSONAL, sin perfil y anónimas no acceden. El registrante se deriva de la sesión:
el cliente no puede enviar `docente_id`.

## 2. Diseño (migración `20261002185033_ept_66_asistencias_vinculos_docente.sql`)

* **Predicado único** `app_private.vinculos_docente_alumno(docente, alumno)` (sin `EXECUTE` para los
  clientes). Los FK reales de `materias_cursos.profesor_id` y `grupos_deportivos.profesor_id` apuntan a
  `perfiles(id)`. No se agregó ninguna exigencia de nivel, deporte, ficha ni legajo.
* **Consumidores del mismo predicado:** política de lectura del DOCENTE, guarda de escritura
  (políticas INSERT/UPDATE y RPC) y `listar_estudiantes_para_gestion`, que antes devolvía **todos** los
  alumnos a cualquier DOCENTE (fuga corregida; Dirección sigue viendo todos).
* **Registro:** `public.registrar_asistencia(alumno, fecha, estado)` (INVOKER) sin parámetro de
  identidad; devuelve `CREADA`, `ACTUALIZADA` o `SIN_CAMBIOS`. `authenticated` solo puede actualizar la
  columna `estado`; un trigger impide cambiar alumno, fecha y registrante. Un UPDATE sin vínculo afecta
  0 filas por RLS y por la RPC nunca se informa como éxito (`P6610` → 404).
* **Concurrencia:** la guarda toma `FOR SHARE` sobre las filas que sostienen el vínculo (inscripción,
  grupo, matrícula, actividad, asignación) y revalida el predicado. Toda revocación es un UPDATE de una
  de esas filas, así que revocación y registro se serializan en ambos órdenes. No toma `alumnos` para no
  cerrar un ciclo con la baja deportiva. Una mutación de control (quitar los `FOR SHARE`) hace fallar la
  prueba de concurrencia.
* **Servidor y pantalla:** `GET/POST /api/asistencias` con cuerpo estricto, 401 sin sesión y 403
  `ACCESO_BLOQUEADO`; la pantalla no muestra éxito hasta que responde el servidor, corrige la lista
  tras una revocación con la página abierta y se refresca al volver a la pestaña. Banco visual
  `/pruebas-ui/asistencias` (solo fuera de producción).

## 3. Verificación (HEAD `1cdd703`, stack local aislado, CLI 2.119.0, tipos con generador 2.117.0)

| Verificación | Resultado |
|---|---|
| RED contra el esquema 29 | Las 6 suites nuevas fallan (el DOCENTE leía todo; la RPC no existía) |
| Suites SQL nuevas | 28 + 24 + 22 + 29 + 28 + 20 = **151** comprobaciones OK, `FALLO=0` |
| Suites SQL aplicables en el esquema final | 27 ejecutadas, `FALLO=0`, ninguna omitida |
| Concurrencia | 15 scripts; el nuevo cubre 8 carreras con `pg_blocking_pids`, sin `sleep` como prueba |
| Migración 30 sobre datos existentes | mismo conteo y huella de asistencias; registrantes intactos |
| `tsc`, `lint`, `build`, tipos generados, harness de producción y negativo, DB lint, advisors | exit 0 (lint: 0 errores, 30 advertencias) |
| E2E completa, todos los proyectos, esquema 30 | 1766 seleccionadas, 1752 aprobadas, 14 omitidas (las 14 conocidas), 0 fallos, 0 flaky, 0 reintentos |

## 4. Regresiones antiguas ajustadas al contrato nuevo

`profesores_rls.sql` (CA-17), `perfiles_privacidad_rls.sql` (B-04) y
`tests/gestion-estudiantes-auth.spec.ts` exigían el privilegio global anterior y se reescribieron.
`usuarios_permisos_rls.sql` exige cubrir cada RPC pública y se amplió con `registrar_asistencia`.
`inscripciones_legadas_expansion_rls.sql` es exclusiva del esquema 28 y no corre en el 30.

## 5. Riesgos y límites

* **Corrección sin huella:** cualquier docente vinculado (o Dirección) puede corregir el estado de una
  asistencia ya cargada, y no queda registro de quién corrigió; el registrante original no se
  reemplaza. La alternativa más restrictiva rompe el caso de dos docentes del mismo curso y no está en el
  contrato aprobado. **Pregunta abierta para Lucas.**
* **Deadlock residual (`40P01`)** con una operación futura o no revisada; el servidor responde 409
  «volvé a intentarlo».
* `service_role` conserva sus privilegios por defecto sobre `asistencias` (heredado de la migración
  011; ninguna ruta de la app lo usa) y `estudiante_id` y `fecha` siguen siendo nullable (heredado).
* No probado: volumen y carga concurrente reales, WebKit real (en `iphone-13-webkit` solo corre el
  banco visual con datos simulados) y, en producción, el caso positivo de un DOCENTE con vínculo (no
  existen datos académicos o deportivos ficticios para él; se cubrió en local). Ver
  `docs/evidence/EPT-66.md` §10.

## 6. Reversión

Git no revierte PostgreSQL. Deshacer la migración 30 exige una migración compensatoria que restaure las
tres políticas «Staff» globales, el privilegio de UPDATE de tabla y la versión anterior de
`listar_estudiantes_para_gestion`. **No se recomienda:** reabre la lectura y escritura de asistencias de
menores por cualquier DOCENTE. Revertir solo el código deja la pantalla sin la RPC de registro.
