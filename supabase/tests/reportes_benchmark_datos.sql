-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Datos sintéticos de volumen para los reportes (EPT-63, RF17)
-- ============================================================
-- Siembra un conjunto representativo y determinista para medir que cada reporte
-- se obtiene en menos de un minuto (RF17 / Jira EPT-63). NO es una prueba de
-- corrección (eso lo hace `reportes_oficiales_rls.sql`): es carga de datos.
--
-- SOLO base local descartable. Nunca contra producción. Salvaguardas:
--   1. Aborta si existe cualquier perfil cuyo DNI no empiece con 9 (los datos
--      reales no son sintéticos; todas las pruebas del repositorio usan 9xxxxxxx).
--   2. Exige el rol supabase_admin: necesita `session_replication_role = replica`
--      para insertar sin recorrer los triggers de validación fila por fila. La
--      corrida lo comprueba. Las suites que la usan se lanzan con
--      `correr-autenticadas.mjs`, que rechaza toda API que no sea de bucle local y
--      exige que el contenedor de `psql` sea la MISMA base que la API.
--
-- Ejecución (el contenedor es el del stack local que se esté usando):
--     docker cp supabase/tests/reportes_benchmark_datos.sql <contenedor>:/tmp/
--     docker exec <contenedor> psql -X -U supabase_admin -d postgres \
--       -v ON_ERROR_STOP=1 -f /tmp/reportes_benchmark_datos.sql
--
-- Volumen (todos los dominios superan las 1000 filas):
--   perfiles          150 docentes + 3400 alumnos
--   cursos            100 (33–34 por nivel), 3000 con matrícula vigente
--   matrículas        3000 vigentes + 800 cerradas (cambio de curso) + 400 cerradas
--                     (inactivación) = 4200
--   materias          30, 1200 asignaciones curso × materia (12 por curso, 5 % sin profesor)
--   franjas académicas 2 por asignación = 2400 (24 por curso, sin superposición)
--   deportes          12 (6 sembrados + 6), 240 grupos, 2 franjas por grupo
--   deportivas        3400 activas + 800 canceladas = 4200
--   transporte        2500 activas + 500 canceladas = 3000
--
-- Filas esperadas por reporte (por defecto, es decir, vigentes):
--   alumnos por curso 3000 · por materia ~34 200 · por deporte 3400 ·
--   por horario ~78 800 · por recorrido 2500 · docentes por nivel ~1 380
--
-- Los identificadores son deterministas (prefijo b0…): correr el script dos
-- veces sobre la misma base falla en lugar de duplicar.

\set ON_ERROR_STOP on
\timing off

SET session_replication_role = replica;

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.perfiles WHERE dni !~ '^9') THEN
        RAISE EXCEPTION 'Datos de volumen: la base contiene perfiles con DNI que no es sintético. Este script es solo para una base local descartable.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.perfiles WHERE legajo_nro LIKE 'BENCH-%') THEN
        RAISE EXCEPTION 'Datos de volumen: ya fueron sembrados en esta base.';
    END IF;
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'Datos de volumen: ejecutar como supabase_admin (superusuario local).';
    END IF;
END $$;

-- Identificador determinista: prefijo hexadecimal + contador.
CREATE FUNCTION pg_temp.uid(p_tipo TEXT, p_n INTEGER)
RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_tipo || '000000-0000-4000-8000-' || lpad(p_n::TEXT, 12, '0'))::UUID;
$$;

-- Entero pseudoaleatorio determinista y no negativo.
CREATE FUNCTION pg_temp.h(p_semilla TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
    SELECT abs(hashtext(p_semilla));
$$;

CREATE TEMPORARY TABLE apellidos (i INTEGER PRIMARY KEY, v TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO apellidos (i, v)
SELECT row_number() OVER (), x FROM unnest(ARRAY[
    'García','Rodríguez','González','Fernández','López','Martínez','Sánchez','Pérez','Gómez','Martín',
    'Jiménez','Ruiz','Hernández','Díaz','Moreno','Álvarez','Muñoz','Romero','Alonso','Gutiérrez',
    'Navarro','Torres','Domínguez','Vázquez','Ramos','Gil','Ramírez','Serrano','Blanco','Molina',
    'Morales','Suárez','Ortega','Delgado','Castro','Ortiz','Rubio','Marín','Sanz','Iglesias',
    'Medina','Garrido','Cortés','Castillo','Santos','Lozano','Guerrero','Cano','Prieto','Méndez',
    'Cruz','Calvo','Gallego','Vidal','León','Márquez','Herrera','Peña','Flores','Cabrera']) AS x;

CREATE TEMPORARY TABLE nombres (i INTEGER PRIMARY KEY, v TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO nombres (i, v)
SELECT row_number() OVER (), x FROM unnest(ARRAY[
    'Sofía','Mateo','Valentina','Santiago','Isabella','Benjamín','Camila','Lucas','Martina','Joaquín',
    'Emma','Thiago','Lucía','Tomás','Julieta','Bautista','Catalina','Nicolás','Mía','Facundo',
    'Renata','Agustín','Abril','Franco','Delfina','Lautaro','Olivia','Gael','Florencia','Ian',
    'Milagros','Dante','Jazmín','Felipe','Agustina','Ciro','Victoria','Bruno','Malena','Emilio',
    'Pilar','Lorenzo','Antonella','Alan','Guadalupe','Ramiro','Bianca','Simón','Candela','Manuel',
    'Rocío','Ezequiel','Paula','Gonzalo','Luna','Ivo','Nadia','Tobías','Zoe','Máximo']) AS x;

-- ------------------------------------------------------------
-- Docentes (150) y sus fichas
-- ------------------------------------------------------------
INSERT INTO public.perfiles (id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.uid('b1', n),
       (SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),
       (SELECT v FROM nombres  WHERE i = pg_temp.h('dn' || n) % 60 + 1),
       (SELECT v FROM apellidos WHERE i = pg_temp.h('da' || n) % 60 + 1),
       '96' || lpad(n::TEXT, 6, '0'),
       NULL
FROM generate_series(1, 150) AS n;

INSERT INTO public.profesores (perfil_id, especialidad, estado)
SELECT pg_temp.uid('b1', n),
       (ARRAY['Matemática','Lengua','Ciencias','Historia','Educación Física','Inglés'])[n % 6 + 1],
       CASE WHEN n % 25 = 0 THEN 'INACTIVO'::public.estado_profesor ELSE 'ACTIVO'::public.estado_profesor END
FROM generate_series(1, 150) AS n;

-- ------------------------------------------------------------
-- Cursos (100), materias (30), asignaciones (1200) y franjas académicas (2400)
-- ------------------------------------------------------------
INSERT INTO public.cursos (id, nivel_id, denominacion, division)
SELECT pg_temp.uid('b2', n),
       (SELECT id FROM public.niveles ORDER BY id OFFSET (n - 1) % 3 LIMIT 1),
       'Curso BENCH ' || ((n - 1) / 3 + 1),
       (ARRAY['A','B','C'])[(n - 1) % 3 + 1]
FROM generate_series(1, 100) AS n;

INSERT INTO public.actividades (nombre, tipo, cupo_maximo)
SELECT 'Materia BENCH ' || lpad(n::TEXT, 2, '0'), 'CURRICULAR', 30
FROM generate_series(1, 30) AS n;

CREATE TEMPORARY TABLE mat (i INTEGER PRIMARY KEY, id INTEGER NOT NULL) ON COMMIT DROP;
INSERT INTO mat (i, id)
SELECT substring(nombre FROM '[0-9]+$')::INTEGER, id
FROM public.actividades WHERE nombre LIKE 'Materia BENCH %';

INSERT INTO public.materias_cursos (id, materia_id, curso_id, profesor_id)
SELECT pg_temp.uid('b3', c * 100 + k),
       (SELECT m.id FROM mat m WHERE m.i = ((c * 7 + k) % 30) + 1),
       pg_temp.uid('b2', c),
       CASE WHEN pg_temp.h('mp' || c || '-' || k) % 20 = 0 THEN NULL
            ELSE pg_temp.uid('b1', (pg_temp.h('md' || c || '-' || k) % 150) + 1) END
FROM generate_series(1, 100) AS c, generate_series(0, 11) AS k;

-- Catálogo de horarios: lunes a viernes, diez franjas de una hora (08 a 17).
INSERT INTO public.horarios (id, dia_semana, hora_inicio, hora_fin)
SELECT pg_temp.uid('b4', d * 100 + s), d, make_time(7 + s, 0, 0), make_time(8 + s, 0, 0)
FROM generate_series(1, 5) AS d, generate_series(1, 10) AS s
ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;

-- Otras suites ya crean franjas del catálogo (la franja es única): se reutilizan
-- las existentes y la limpieza solo retira las que sembró este script.
CREATE TEMPORARY TABLE hor (clave INTEGER PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
INSERT INTO hor (clave, id)
SELECT g.d * 100 + g.s, h.id
FROM (SELECT d, s FROM generate_series(1, 5) AS d, generate_series(1, 10) AS s) AS g
JOIN public.horarios h ON h.dia_semana = g.d AND h.hora_inicio = make_time(7 + g.s, 0, 0)
                      AND h.hora_fin = make_time(8 + g.s, 0, 0);

-- 24 franjas distintas por curso: la asignación k usa los lugares 2k y 2k+1 de
-- una ronda de 50, de modo que un curso nunca se superpone consigo mismo.
INSERT INTO public.materias_cursos_horarios (id, asignacion_id, horario_id)
SELECT pg_temp.uid('b5', (c * 100 + k) * 10 + j),
       pg_temp.uid('b3', c * 100 + k),
       (SELECT h.id FROM hor h WHERE h.clave = ((pos - 1) / 10 + 1) * 100 + ((pos - 1) % 10 + 1))
FROM generate_series(1, 100) AS c,
     generate_series(0, 11) AS k,
     generate_series(0, 1) AS j,
     LATERAL (SELECT ((k * 2 + j + c) % 50) + 1 AS pos) AS p;

-- ------------------------------------------------------------
-- Deportes (12), grupos (240) y sus franjas
-- ------------------------------------------------------------
INSERT INTO public.deportes (id, nombre)
SELECT pg_temp.uid('b6', n), 'Deporte BENCH ' || n FROM generate_series(1, 6) AS n;

CREATE TEMPORARY TABLE dep (i INTEGER PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
INSERT INTO dep (i, id)
SELECT row_number() OVER (ORDER BY id), id FROM public.deportes;

INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
SELECT pg_temp.uid('b7', g),
       (SELECT d.id FROM dep d WHERE d.i = (g % 12) + 1),
       (SELECT id FROM public.niveles ORDER BY id OFFSET (g / 12) % 3 LIMIT 1),
       'Grupo BENCH ' || g,
       100,
       pg_temp.uid('b1', (pg_temp.h('gp' || g) % 150) + 1)
FROM generate_series(0, 239) AS g;

-- Franjas de tarde (lugares 31 a 50), dos por grupo.
INSERT INTO public.grupos_deportivos_horarios (id, grupo_id, horario_id)
SELECT pg_temp.uid('b8', g * 10 + j),
       pg_temp.uid('b7', g),
       (SELECT h.id FROM hor h WHERE h.clave = ((pos - 1) / 10 + 1) * 100 + ((pos - 1) % 10 + 1))
FROM generate_series(0, 239) AS g,
     generate_series(0, 1) AS j,
     LATERAL (SELECT 30 + ((g * 3 + j) % 20) + 1 AS pos) AS p;

-- ------------------------------------------------------------
-- Alumnos: 3000 con matrícula vigente y 400 inactivados
-- ------------------------------------------------------------
INSERT INTO public.perfiles (id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.uid('b9', n),
       (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
       (SELECT v FROM nombres  WHERE i = pg_temp.h('an' || n) % 60 + 1),
       (SELECT v FROM apellidos WHERE i = pg_temp.h('aa' || n) % 60 + 1),
       '97' || lpad(n::TEXT, 6, '0'),
       'BENCH-' || lpad(n::TEXT, 6, '0')
FROM generate_series(1, 3400) AS n;

INSERT INTO public.alumnos (perfil_id, estado)
SELECT pg_temp.uid('b9', n),
       CASE WHEN n <= 3000 THEN 'ACTIVO'::public.estado_alumno ELSE 'INACTIVO'::public.estado_alumno END
FROM generate_series(1, 3400) AS n;

-- Vigentes: alumno n → curso ((n - 1) % 100) + 1.
INSERT INTO public.matriculas (id, alumno_id, curso_id, fecha_inicio)
SELECT pg_temp.uid('ba', n), pg_temp.uid('b9', n), pg_temp.uid('b2', ((n - 1) % 100) + 1),
       timestamptz '2026-03-01 08:00+00' + (n % 30) * interval '1 hour'
FROM generate_series(1, 3000) AS n;

-- 800 cerradas por cambio de curso (curso anterior del mismo nivel).
INSERT INTO public.matriculas (id, alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre)
SELECT pg_temp.uid('bb', n), pg_temp.uid('b9', n), pg_temp.uid('b2', ((n + 2) % 100) + 1),
       timestamptz '2025-03-01 08:00+00', timestamptz '2026-02-20 12:00+00', 'CAMBIO_DE_CURSO'
FROM generate_series(1, 800) AS n;

-- 400 inactivados: solo una matrícula cerrada por inactivación.
INSERT INTO public.matriculas (id, alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre)
SELECT pg_temp.uid('bc', n), pg_temp.uid('b9', n), pg_temp.uid('b2', ((n - 1) % 100) + 1),
       timestamptz '2026-03-01 08:00+00', timestamptz '2026-06-01 12:00+00', 'INACTIVACION'
FROM generate_series(3001, 3400) AS n;

-- ------------------------------------------------------------
-- Inscripciones deportivas: 3400 activas + 800 canceladas
-- ------------------------------------------------------------
CREATE TEMPORARY TABLE gd (nivel_id INTEGER, dep_i INTEGER, k INTEGER, grupo_id UUID, deporte_id UUID) ON COMMIT DROP;
INSERT INTO gd
SELECT g.nivel_id, d.i,
       row_number() OVER (PARTITION BY g.nivel_id, d.i ORDER BY g.id),
       g.id, g.deporte_id
FROM public.grupos_deportivos g
JOIN dep d ON d.id = g.deporte_id;

CREATE TEMPORARY TABLE gd_max (nivel_id INTEGER, dep_i INTEGER, m INTEGER) ON COMMIT DROP;
INSERT INTO gd_max SELECT nivel_id, dep_i, max(k) FROM gd GROUP BY nivel_id, dep_i;

CREATE TEMPORARY TABLE alu_nivel (n INTEGER PRIMARY KEY, nivel_id INTEGER NOT NULL) ON COMMIT DROP;
INSERT INTO alu_nivel
SELECT n, c.nivel_id
FROM generate_series(1, 3000) AS n
JOIN public.cursos c ON c.id = pg_temp.uid('b2', ((n - 1) % 100) + 1);

-- Primera inscripción activa: los 3000 alumnos activos.
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id, deporte_id, estado, fecha_inscripcion)
SELECT pg_temp.uid('bd', n), pg_temp.uid('b9', n), x.grupo_id, x.deporte_id, 'ACTIVA',
       timestamptz '2026-03-10 10:00+00' + (n % 20) * interval '1 hour'
FROM alu_nivel a
CROSS JOIN LATERAL (
    SELECT gd.grupo_id, gd.deporte_id
    FROM gd
    WHERE gd.nivel_id = a.nivel_id
      AND gd.dep_i = (pg_temp.h('d1' || a.n) % 12) + 1
      AND gd.k = (pg_temp.h('k1' || a.n) % (SELECT m FROM gd_max WHERE nivel_id = a.nivel_id AND dep_i = (pg_temp.h('d1' || a.n) % 12) + 1)) + 1
) AS x;

-- Segunda inscripción activa (deporte distinto): 400 alumnos, hasta 3400.
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id, deporte_id, estado, fecha_inscripcion)
SELECT pg_temp.uid('be', n), pg_temp.uid('b9', n), x.grupo_id, x.deporte_id, 'ACTIVA',
       timestamptz '2026-03-12 10:00+00' + (n % 20) * interval '1 hour'
FROM alu_nivel a
CROSS JOIN LATERAL (
    SELECT gd.grupo_id, gd.deporte_id
    FROM gd
    WHERE gd.nivel_id = a.nivel_id
      AND gd.dep_i = ((pg_temp.h('d1' || a.n) % 12 + 1 + pg_temp.h('d2' || a.n) % 11) % 12) + 1
      AND gd.k = (pg_temp.h('k2' || a.n) % (SELECT m FROM gd_max WHERE nivel_id = a.nivel_id
                     AND dep_i = ((pg_temp.h('d1' || a.n) % 12 + 1 + pg_temp.h('d2' || a.n) % 11) % 12) + 1)) + 1
) AS x
WHERE a.n <= 400;

-- Canceladas: 800 alumnos (1001 a 1800), en un deporte distinto del activo.
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id, deporte_id, estado, fecha_inscripcion, fecha_cancelacion)
SELECT pg_temp.uid('bf', a.n), pg_temp.uid('b9', a.n), x.grupo_id, x.deporte_id, 'CANCELADA',
       timestamptz '2026-03-05 10:00+00', timestamptz '2026-04-05 10:00+00' + (a.n % 10) * interval '1 day'
FROM alu_nivel a
CROSS JOIN LATERAL (
    SELECT gd.grupo_id, gd.deporte_id
    FROM gd
    WHERE gd.nivel_id = a.nivel_id
      AND gd.dep_i = ((pg_temp.h('d1' || a.n) % 12 + 6) % 12) + 1
      AND gd.k = 1
) AS x
WHERE a.n BETWEEN 1001 AND 1800;

-- ------------------------------------------------------------
-- Transporte: 2500 activas + 500 canceladas
-- ------------------------------------------------------------
INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id, estado, fecha_inscripcion)
SELECT pg_temp.uid('c0', n), pg_temp.uid('b9', n),
       ('e0000000-0000-4000-8000-00000000002' || (pg_temp.h('tr' || n) % 4))::UUID,
       'ACTIVA',
       timestamptz '2026-03-15 10:00+00' + (n % 40) * interval '1 hour'
FROM generate_series(1, 2500) AS n;

INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id, estado, fecha_inscripcion, fecha_cancelacion)
SELECT pg_temp.uid('c1', n), pg_temp.uid('b9', n),
       ('e0000000-0000-4000-8000-00000000002' || ((pg_temp.h('tr' || n) % 4 + 1) % 4))::UUID,
       'CANCELADA',
       timestamptz '2026-03-01 10:00+00', timestamptz '2026-03-12 10:00+00'
FROM generate_series(1, 500) AS n;

COMMIT;

SET session_replication_role = origin;

-- Recuentos sembrados, como comprobación de la propia siembra.
SELECT 'perfiles'                 AS relacion, count(*) FROM public.perfiles WHERE dni ~ '^9[67]'
UNION ALL SELECT 'matriculas vigentes', count(*) FROM public.matriculas WHERE fecha_cierre IS NULL AND id::TEXT LIKE 'ba%'
UNION ALL SELECT 'matriculas cerradas', count(*) FROM public.matriculas WHERE fecha_cierre IS NOT NULL AND (id::TEXT LIKE 'bb%' OR id::TEXT LIKE 'bc%')
UNION ALL SELECT 'asignaciones',        count(*) FROM public.materias_cursos WHERE id::TEXT LIKE 'b3%'
UNION ALL SELECT 'franjas academicas',  count(*) FROM public.materias_cursos_horarios WHERE id::TEXT LIKE 'b5%'
UNION ALL SELECT 'grupos deportivos',   count(*) FROM public.grupos_deportivos WHERE id::TEXT LIKE 'b7%'
UNION ALL SELECT 'insc. deportivas activas', count(*) FROM public.inscripciones_deportivas WHERE estado = 'ACTIVA' AND id::TEXT ~ '^b[def]'
UNION ALL SELECT 'insc. deportivas canceladas', count(*) FROM public.inscripciones_deportivas WHERE estado = 'CANCELADA' AND id::TEXT ~ '^b[def]'
UNION ALL SELECT 'transporte activas',  count(*) FROM public.inscripciones_servicios WHERE estado = 'ACTIVA' AND id::TEXT LIKE 'c0%'
UNION ALL SELECT 'transporte canceladas', count(*) FROM public.inscripciones_servicios WHERE estado = 'CANCELADA' AND id::TEXT LIKE 'c1%';

ANALYZE;
