-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Asistencias por vínculo vigente: Vínculo académico (EPT-66 D)
-- ============================================================
-- matrícula vigente + asignación activa de una materia CURRICULAR activa: lectura, escritura, listado, y revocación por cambio de curso, inactivación del alumno, asignación o materia inactiva y cambio de profesor.
--
-- Ejecutar solo contra la base local descartable, después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
--   docker exec -i supabase_db_educar-para-transformar \
--     psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/asistencias_vinculo_academico_rls.sql
--
-- Cada comprobación emite un único marcador «OK …» o aborta con «FALLO …». Los
-- pasos de preparación se anuncian como «Paso:» y no cuentan. Cada rechazo se
-- compara por SQLSTATE exacto; nunca por texto y nunca como éxito la recursión
-- de políticas (42P17). Requiere el esquema 30 (asistencias por vínculo).
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

-- ================================================================
-- 0. SOPORTE (no cuenta como comprobación) Y FIXTURE SINTÉTICO
-- ================================================================
-- Identificadores a66d0001…: uno por actor. `user_id` = `id`, como en las demás
-- pruebas SQL (`perfiles.user_id` no tiene FK hacia Auth).
CREATE FUNCTION pg_temp.u(p_s TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('a66d0001-0000-4000-8000-0000000000' || p_s)::UUID;
$$;

-- Ejecuta `p_sql` como `p_rol` con el JWT de `p_sub` (NULL = sin identidad) y
-- CONSERVA los efectos si no falla. Devuelve `OK:<valor>` o `E:<SQLSTATE>`:
-- cada rechazo se compara por SQLSTATE exacto, nunca por texto.
CREATE FUNCTION pg_temp.como(p_sub UUID, p_sql TEXT, p_rol TEXT DEFAULT 'authenticated')
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            CASE WHEN p_sub IS NULL THEN '{}'
                 ELSE pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT END, TRUE);
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql INTO v;
        RESET ROLE;
        v := 'OK:' || COALESCE(v, '<NULL>');
    EXCEPTION WHEN OTHERS THEN
        v := 'E:' || SQLSTATE;
    END;
    PERFORM pg_catalog.set_config('request.jwt.claims', '{}', TRUE);
    RETURN v;
END;
$$;

-- Una comprobación = una llamada: falla con FALLO o emite un único marcador OK.
CREATE FUNCTION pg_temp.verificar(p_mensaje TEXT, p_actual TEXT, p_esperado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_actual = 'E:42P17' THEN
        RAISE EXCEPTION 'FALLO % → recursión de políticas (42P17)', p_mensaje;
    END IF;
    IF p_actual IS DISTINCT FROM p_esperado THEN
        RAISE EXCEPTION 'FALLO % → se obtuvo %, se esperaba %', p_mensaje, p_actual, p_esperado;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

CREATE FUNCTION pg_temp.exigir(p_mensaje TEXT, p_condicion BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_condicion IS NOT TRUE THEN
        RAISE EXCEPTION 'FALLO %', p_mensaje;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

-- Cantidad de filas de asistencias que un actor ve (RLS), opcionalmente de un alumno.
CREATE FUNCTION pg_temp.ve(p_sub UUID, p_alumno UUID DEFAULT NULL) RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub, pg_catalog.format(
        'SELECT pg_catalog.count(*)::TEXT FROM public.asistencias WHERE (%L::UUID IS NULL AND estudiante_id::TEXT LIKE ''a66d0001%%'') OR estudiante_id = %L::UUID',
        p_alumno, p_alumno));
$$;

-- Alumnos que el actor recibe de `listar_estudiantes_para_gestion()`, ordenados por sufijo.
CREATE FUNCTION pg_temp.lista(p_sub UUID) RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub,
        $q$SELECT COALESCE(pg_catalog.string_agg(pg_catalog.right(e.id::TEXT, 2), ',' ORDER BY e.id), '-')
           FROM public.listar_estudiantes_para_gestion() e
           WHERE e.id::TEXT LIKE 'a66d0001%'$q$);
$$;

-- Registro por la función pública. Devuelve `OK:<resultado>` o `E:<SQLSTATE>`.
CREATE FUNCTION pg_temp.registra(p_sub UUID, p_alumno UUID, p_fecha DATE, p_estado TEXT DEFAULT 'PRESENTE')
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub, pg_catalog.format(
        'SELECT r.resultado FROM public.registrar_asistencia(%L, %L, %L) r', p_alumno, p_fecha, p_estado));
$$;

-- Alta directa por la API de tablas: la RLS decide.
CREATE FUNCTION pg_temp.inserta(p_sub UUID, p_alumno UUID, p_fecha DATE, p_docente UUID, p_estado TEXT DEFAULT 'PRESENTE')
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub, pg_catalog.format(
        $q$WITH x AS (INSERT INTO public.asistencias (estudiante_id, fecha, estado, docente_id)
                      VALUES (%L, %L, %L, %L) RETURNING 1) SELECT pg_catalog.count(*)::TEXT FROM x$q$,
        p_alumno, p_fecha, p_estado, p_docente));
$$;

-- Estado persistido de una asistencia, leído como propietario (sin RLS).
CREATE FUNCTION pg_temp.estado_de(p_alumno UUID, p_fecha DATE) RETURNS TEXT LANGUAGE sql AS $$
    SELECT COALESCE((SELECT a.estado FROM public.asistencias a WHERE a.estudiante_id = p_alumno AND a.fecha = p_fecha), '-');
$$;

CREATE FUNCTION pg_temp.registrante_de(p_alumno UUID, p_fecha DATE) RETURNS TEXT LANGUAGE sql AS $$
    SELECT COALESCE((SELECT pg_catalog.right(a.docente_id::TEXT, 2) FROM public.asistencias a
                     WHERE a.estudiante_id = p_alumno AND a.fecha = p_fecha), '-');
$$;

-- Perfiles. 01 DIRECTOR; 02/03/04 DOCENTE A/B/C; 11–15 ESTUDIANTE e1–e5;
-- 21 PADRE de e1; 22 PADRE sin hijos; 31 PERSONAL; 41 DOCENTE D (reserva).
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.u(v.s), pg_temp.u(v.s), r.id, v.nombre, v.apellido, '96601' || v.s_dni, v.legajo
FROM (VALUES
    ('01', '001', 'DIRECTOR',   'Dora',   'Dirección EPT66D',   NULL),
    ('02', '002', 'DOCENTE',    'Alba',   'Docente A EPT66D',   'LEG-66D-A'),
    ('03', '003', 'DOCENTE',    'Bruno',  'Docente B EPT66D',   'LEG-66D-B'),
    ('04', '004', 'DOCENTE',    'Carla',  'Docente C EPT66D',   'LEG-66D-C'),
    ('11', '011', 'ESTUDIANTE', 'Elena',  'Alumno 1 EPT66D',    'LEG-66D-E1'),
    ('12', '012', 'ESTUDIANTE', 'Fabio',  'Alumno 2 EPT66D',    'LEG-66D-E2'),
    ('13', '013', 'ESTUDIANTE', 'Gina',   'Alumno 3 EPT66D',    'LEG-66D-E3'),
    ('14', '014', 'ESTUDIANTE', 'Hugo',   'Alumno 4 EPT66D',    'LEG-66D-E4'),
    ('15', '015', 'ESTUDIANTE', 'Irene',  'Alumno 5 EPT66D',    'LEG-66D-E5'),
    ('21', '021', 'PADRE',      'Pedro',  'Padre EPT66D',       NULL),
    ('22', '022', 'PADRE',      'Pablo',  'Padre sin hijos EPT66D', NULL),
    ('31', '031', 'PERSONAL',   'Paula',  'Personal EPT66D',    NULL),
    ('41', '041', 'DOCENTE',    'Dario',  'Docente D EPT66D',   'LEG-66D-D')
) AS v(s, s_dni, rol, nombre, apellido, legajo)
JOIN public.roles r ON r.nombre = v.rol;

INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES (pg_temp.u('21'), pg_temp.u('11'));

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u('c1'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT66D', 'A', TRUE),
       (pg_temp.u('c2'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT66D', 'B', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES (pg_temp.u('11'), pg_temp.u('c1')), (pg_temp.u('12'), pg_temp.u('c2')),
       (pg_temp.u('13'), pg_temp.u('c1')), (pg_temp.u('14'), pg_temp.u('c2')),
       (pg_temp.u('15'), pg_temp.u('c1'));
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (pg_temp.u('11'), pg_temp.u('12'), pg_temp.u('13'), pg_temp.u('14'), pg_temp.u('15'));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Paso de preparación u operación administrativa: la Dirección usa la RPC real y
-- debe tener éxito. No es una comprobación (se anuncia como «Paso», no como «OK»).
CREATE FUNCTION pg_temp.paso(p_mensaje TEXT, p_sub UUID, p_sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v TEXT := pg_temp.como(p_sub, p_sql);
BEGIN
    IF v NOT LIKE 'OK:%' THEN
        RAISE EXCEPTION 'FALLO en el paso «%» → %', p_mensaje, v;
    END IF;
    RAISE NOTICE 'Paso: %', p_mensaje;
END;
$$;

CREATE FUNCTION pg_temp.dir(p_mensaje TEXT, p_sql TEXT) RETURNS VOID LANGUAGE sql AS $$
    SELECT pg_temp.paso(p_mensaje, pg_temp.u('01'), 'SELECT (' || p_sql || ')::TEXT');
$$;

CREATE FUNCTION pg_temp.mat(p_n TEXT) RETURNS INTEGER LANGUAGE sql STABLE AS $$
    SELECT id FROM public.materias WHERE nombre = 'Materia ' || p_n || ' EPT66D 01';
$$;

CREATE FUNCTION pg_temp.asig(p_n TEXT, p_curso UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT mc.id FROM public.materias_cursos mc
    WHERE mc.materia_id = pg_temp.mat(p_n) AND mc.curso_id = p_curso;
$$;

-- Materias M1 y M2 por la RPC real de la Dirección.
SELECT pg_temp.dir('crear materia M1', $q$public.crear_materia('Materia M1 EPT66D 01')$q$);
SELECT pg_temp.dir('crear materia M2', $q$public.crear_materia('Materia M2 EPT66D 01')$q$);

-- A (02) dicta M1 en c1; B (03) dicta M2 en c2. C (04) no dicta nada.
-- c1: e1, e3, e5. c2: e2, e4.
SELECT pg_temp.dir('asignar M1 a c1 con A',
    $q$public.asignar_materia_curso(pg_temp.mat('M1'), pg_temp.u('c1'), pg_temp.u('02'))$q$);
SELECT pg_temp.dir('asignar M2 a c2 con B',
    $q$public.asignar_materia_curso(pg_temp.mat('M2'), pg_temp.u('c2'), pg_temp.u('03'))$q$);

-- Una asistencia previa por alumno, cargada como propietario.
INSERT INTO public.asistencias (estudiante_id, fecha, estado)
SELECT pg_temp.u(s), DATE '2031-05-05', 'PRESENTE' FROM (VALUES ('11'), ('12'), ('13'), ('14'), ('15')) v(s);


-- ================================================================
-- 1. VÍNCULO ACADÉMICO VIGENTE: LECTURA
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('A: lee la asistencia de un alumno matriculado en el curso donde dicta una materia activa',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('11')), 'OK:1');
    PERFORM pg_temp.verificar('A: no lee la asistencia de un alumno matriculado en otro curso (sin vínculo)',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('12')), 'OK:0');
    PERFORM pg_temp.verificar('A: sin filtro ve exactamente los tres alumnos de c1 y ninguno de c2',
        pg_temp.ve(pg_temp.u('02')), 'OK:3');
    PERFORM pg_temp.verificar('B: ve solo los dos alumnos de c2 (el vínculo es por curso, no por nivel)',
        pg_temp.ve(pg_temp.u('03')), 'OK:2');
    PERFORM pg_temp.verificar('C: un docente sin materias asignadas no ve ninguna asistencia',
        pg_temp.ve(pg_temp.u('04')), 'OK:0');
    PERFORM pg_temp.verificar('Dirección: sigue viendo las cinco asistencias (acceso global preservado)',
        pg_temp.ve(pg_temp.u('01')), 'OK:5');
END $$;


-- ================================================================
-- 2. VÍNCULO ACADÉMICO VIGENTE: ESCRITURA Y LISTADO
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('A: registra por la función a un alumno de su curso',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-05-06'), 'OK:CREADA');
    PERFORM pg_temp.verificar('A: la función rechaza (P6610) a un alumno de otro curso',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('12'), DATE '2031-05-06'), 'E:P6610');
    PERFORM pg_temp.verificar('A: el alta directa para un alumno de su curso, firmada por A, entra',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('13'), DATE '2031-05-06', pg_temp.u('02')), 'OK:1');
    PERFORM pg_temp.verificar('A: el alta directa para un alumno de otro curso es rechazada por RLS (42501)',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('12'), DATE '2031-05-06', pg_temp.u('02')), 'E:42501');
    PERFORM pg_temp.verificar('Listado de A: solo los alumnos de c1',
        pg_temp.lista(pg_temp.u('02')), 'OK:11,13,15');
    PERFORM pg_temp.verificar('Listado de B: solo los alumnos de c2',
        pg_temp.lista(pg_temp.u('03')), 'OK:12,14');
    PERFORM pg_temp.verificar('Listado de C (sin materias): vacío',
        pg_temp.lista(pg_temp.u('04')), 'OK:-');
    PERFORM pg_temp.verificar('Listado de Dirección: los cinco alumnos',
        pg_temp.lista(pg_temp.u('01')), 'OK:11,12,13,14,15');
END $$;


-- ================================================================
-- 3. MATRÍCULA CERRADA O CAMBIADA
-- ================================================================
SELECT pg_temp.dir('cambiar a e1 de c1 a c2 (cierra la matrícula vigente)',
    $q$public.cambiar_curso_alumno(pg_temp.u('11'), pg_temp.u('c2'))$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('A pierde la lectura de un alumno cuya matrícula en c1 se cerró por cambio de curso',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('11')), 'OK:0');
    PERFORM pg_temp.verificar('B gana la lectura del mismo alumno en su nuevo curso',
        pg_temp.ve(pg_temp.u('03'), pg_temp.u('11')), 'OK:2');
    PERFORM pg_temp.verificar('A ya no puede registrar al alumno que cambió de curso (P6610)',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-05-07'), 'E:P6610');
    PERFORM pg_temp.verificar('B registra al alumno en su nuevo curso',
        pg_temp.registra(pg_temp.u('03'), pg_temp.u('11'), DATE '2031-05-07'), 'OK:CREADA');
END $$;

SELECT pg_temp.dir('inactivar a e3 (cierra su matrícula por inactivación)',
    $q$public.inactivar_alumno(pg_temp.u('13'))$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Un alumno inactivado (sin matrícula vigente) deja de ser visible para su docente',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('13')), 'OK:0');
    PERFORM pg_temp.verificar('Un alumno inactivado tampoco puede registrarse por un docente (P6610)',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('13'), DATE '2031-05-08'), 'E:P6610');
    PERFORM pg_temp.verificar('Dirección conserva la lectura de un alumno inactivado (historial)',
        pg_temp.ve(pg_temp.u('01'), pg_temp.u('13')), 'OK:2');
END $$;


-- ================================================================
-- 4. ASIGNACIÓN O MATERIA INACTIVA, O CON OTRO PROFESOR
-- ================================================================
-- Desde acá el único alumno de c1 que queda matriculado es e5.
SELECT pg_temp.dir('desactivar la asignación M1–c1',
    $q$public.cambiar_estado_asignacion(pg_temp.asig('M1', pg_temp.u('c1')), FALSE)$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Con la asignación desactivada A pierde la lectura del alumno del curso',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('15')), 'OK:0');
    PERFORM pg_temp.verificar('Con la asignación desactivada A no puede registrar (P6610)',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('15'), DATE '2031-05-09'), 'E:P6610');
END $$;

SELECT pg_temp.dir('reactivar la asignación M1–c1',
    $q$public.cambiar_estado_asignacion(pg_temp.asig('M1', pg_temp.u('c1')), TRUE)$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Reactivada la asignación, A recupera la lectura',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('15')), 'OK:1');
END $$;

SELECT pg_temp.dir('desactivar la materia M1', $q$public.cambiar_estado_materia(pg_temp.mat('M1'), FALSE)$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Con la materia inactiva A pierde la lectura aunque la asignación siga activa',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('15')), 'OK:0');
    PERFORM pg_temp.verificar('Con la materia inactiva A no puede registrar (P6610)',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('15'), DATE '2031-05-09'), 'E:P6610');
END $$;

SELECT pg_temp.dir('reactivar la materia M1', $q$public.cambiar_estado_materia(pg_temp.mat('M1'), TRUE)$q$);
SELECT pg_temp.dir('pasar la asignación M1–c1 a B',
    $q$public.cambiar_profesor_asignacion(pg_temp.asig('M1', pg_temp.u('c1')), pg_temp.u('03'))$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Cambiado el profesor de la asignación, A pierde al alumno de c1',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('15')), 'OK:0');
    PERFORM pg_temp.verificar('Cambiado el profesor de la asignación, B gana al alumno de c1',
        pg_temp.ve(pg_temp.u('03'), pg_temp.u('15')), 'OK:1');
END $$;

ROLLBACK;
