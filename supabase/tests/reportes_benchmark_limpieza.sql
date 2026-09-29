-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Retiro de los datos de volumen de los reportes (EPT-63)
-- ============================================================
-- Deshace `reportes_benchmark_datos.sql`. Solo base local descartable.
--
-- Borra por identificador determinista COMPLETO (prefijo + `-0000-4000-8000-`),
-- nunca por un prefijo suelto: un UUID aleatorio de la aplicación puede empezar
-- con los mismos caracteres, y este script no puede tocarlo. Es idempotente:
-- correrlo sin datos sembrados no hace nada.
--
--     docker cp supabase/tests/reportes_benchmark_limpieza.sql <contenedor>:/tmp/
--     docker exec <contenedor> psql -X -U supabase_admin -d postgres \
--       -v ON_ERROR_STOP=1 -f /tmp/reportes_benchmark_limpieza.sql

\set ON_ERROR_STOP on

SET session_replication_role = replica;

BEGIN;

DELETE FROM public.inscripciones_servicios
 WHERE id::TEXT ~ '^c[01]000000-0000-4000-8000-';
DELETE FROM public.inscripciones_deportivas
 WHERE id::TEXT ~ '^b[def]000000-0000-4000-8000-';
DELETE FROM public.grupos_deportivos_horarios
 WHERE id::TEXT ~ '^b8000000-0000-4000-8000-';
DELETE FROM public.grupos_deportivos
 WHERE id::TEXT ~ '^b7000000-0000-4000-8000-';
DELETE FROM public.deportes
 WHERE id::TEXT ~ '^b6000000-0000-4000-8000-';

DELETE FROM public.materias_cursos_horarios
 WHERE id::TEXT ~ '^b5000000-0000-4000-8000-';
DELETE FROM public.materias_cursos
 WHERE id::TEXT ~ '^b3000000-0000-4000-8000-';
DELETE FROM public.horarios
 WHERE id::TEXT ~ '^b4000000-0000-4000-8000-';
DELETE FROM public.actividades
 WHERE nombre ~ '^Materia BENCH [0-9]{2}$' AND tipo = 'CURRICULAR';

DELETE FROM public.matriculas
 WHERE id::TEXT ~ '^b[abc]000000-0000-4000-8000-';
DELETE FROM public.alumnos
 WHERE perfil_id::TEXT ~ '^b9000000-0000-4000-8000-';
DELETE FROM public.cursos
 WHERE id::TEXT ~ '^b2000000-0000-4000-8000-';

DELETE FROM public.profesores
 WHERE perfil_id::TEXT ~ '^b1000000-0000-4000-8000-';
DELETE FROM public.perfiles
 WHERE id::TEXT ~ '^b[19]000000-0000-4000-8000-' OR id::TEXT = 'b0000000-0000-4000-8000-000000000001';

COMMIT;

SET session_replication_role = origin;

SELECT 'perfiles sintéticos restantes' AS relacion, count(*)
FROM public.perfiles WHERE legajo_nro LIKE 'BENCH-%' OR dni ~ '^9[67][0-9]{6}$'
UNION ALL
SELECT 'asignaciones restantes', count(*) FROM public.materias_cursos
 WHERE id::TEXT ~ '^b3000000-0000-4000-8000-';
