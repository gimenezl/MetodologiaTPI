-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Asistencias por vínculo vigente: Vínculo deportivo (EPT-66 D)
-- ============================================================
-- inscripción ACTIVA en un grupo ACTIVO del docente: lectura, escritura, listado, y revocación por cancelación, reingreso, grupo inactivo y cambio de profesor del grupo.
--
-- Ejecutar solo contra la base local descartable, después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
--   docker exec -i supabase_db_educar-para-transformar \
--     psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/asistencias_vinculo_deportivo_rls.sql
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
-- Identificadores a66d0002…: uno por actor. `user_id` = `id`, como en las demás
-- pruebas SQL (`perfiles.user_id` no tiene FK hacia Auth).
CREATE FUNCTION pg_temp.u(p_s TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('a66d0002-0000-4000-8000-0000000000' || p_s)::UUID;
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
        'SELECT pg_catalog.count(*)::TEXT FROM public.asistencias WHERE (%L::UUID IS NULL AND estudiante_id::TEXT LIKE ''a66d0002%%'') OR estudiante_id = %L::UUID',
        p_alumno, p_alumno));
$$;

-- Alumnos que el actor recibe de `listar_estudiantes_para_gestion()`, ordenados por sufijo.
CREATE FUNCTION pg_temp.lista(p_sub UUID) RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub,
        $q$SELECT COALESCE(pg_catalog.string_agg(pg_catalog.right(e.id::TEXT, 2), ',' ORDER BY e.id), '-')
           FROM public.listar_estudiantes_para_gestion() e
           WHERE e.id::TEXT LIKE 'a66d0002%'$q$);
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
SELECT pg_temp.u(v.s), pg_temp.u(v.s), r.id, v.nombre, v.apellido, '96602' || v.s_dni, v.legajo
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
    SELECT id FROM public.materias WHERE nombre = 'Materia ' || p_n || ' EPT66D 02';
$$;

CREATE FUNCTION pg_temp.asig(p_n TEXT, p_curso UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT mc.id FROM public.materias_cursos mc
    WHERE mc.materia_id = pg_temp.mat(p_n) AND mc.curso_id = p_curso;
$$;

-- Materias M1 y M2 por la RPC real de la Dirección.
SELECT pg_temp.dir('crear materia M1', $q$public.crear_materia('Materia M1 EPT66D 02')$q$);
SELECT pg_temp.dir('crear materia M2', $q$public.crear_materia('Materia M2 EPT66D 02')$q$);

-- Grupos deportivos por la RPC real de la Dirección:
--   G1 Fútbol (A) · G2 Natación (B) · G3 Atletismo (A).
-- Ningún docente tiene materias en esta prueba: el único vínculo posible es el deportivo.
CREATE FUNCTION pg_temp.g(p_n TEXT) RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT id FROM public.grupos_deportivos WHERE nombre = 'Grupo ' || p_n || ' EPT66D 02';
$$;
CREATE FUNCTION pg_temp.insc_activa(p_alumno UUID, p_grupo UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT id FROM public.inscripciones_deportivas WHERE alumno_id = p_alumno AND grupo_id = p_grupo AND estado = 'ACTIVA';
$$;

SELECT pg_temp.dir('crear G1 (Fútbol, A)', $q$public.crear_grupo_deportivo(
    'e0000000-0000-4000-8000-000000000101', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo G1 EPT66D 02', 10, pg_temp.u('02'))$q$);
SELECT pg_temp.dir('crear G2 (Natación, B)', $q$public.crear_grupo_deportivo(
    'e0000000-0000-4000-8000-000000000102', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo G2 EPT66D 02', 10, pg_temp.u('03'))$q$);
SELECT pg_temp.dir('crear G3 (Atletismo, A)', $q$public.crear_grupo_deportivo(
    'e0000000-0000-4000-8000-000000000103', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo G3 EPT66D 02', 10, pg_temp.u('02'))$q$);

SELECT pg_temp.dir('horario de G1', $q$public.agregar_horario_grupo_deportivo(pg_temp.g('G1'), 1::SMALLINT, '08:00', '09:00')$q$);
SELECT pg_temp.dir('horario de G2', $q$public.agregar_horario_grupo_deportivo(pg_temp.g('G2'), 2::SMALLINT, '08:00', '09:00')$q$);
SELECT pg_temp.dir('horario de G3', $q$public.agregar_horario_grupo_deportivo(pg_temp.g('G3'), 3::SMALLINT, '08:00', '09:00')$q$);

-- Inscripciones por la RPC real de cada alumno: e1→G1; e2→G2; e3→G1 y G3; e4→G1 y la cancela.
SELECT pg_temp.paso('e1 se inscribe en G1', pg_temp.u('11'), $q$SELECT (public.inscribir_en_grupo_deportivo(pg_temp.g('G1')))::TEXT$q$);
SELECT pg_temp.paso('e2 se inscribe en G2', pg_temp.u('12'), $q$SELECT (public.inscribir_en_grupo_deportivo(pg_temp.g('G2')))::TEXT$q$);
SELECT pg_temp.paso('e3 se inscribe en G1', pg_temp.u('13'), $q$SELECT (public.inscribir_en_grupo_deportivo(pg_temp.g('G1')))::TEXT$q$);
SELECT pg_temp.paso('e3 se inscribe en G3', pg_temp.u('13'), $q$SELECT (public.inscribir_en_grupo_deportivo(pg_temp.g('G3')))::TEXT$q$);
SELECT pg_temp.paso('e4 se inscribe en G1', pg_temp.u('14'), $q$SELECT (public.inscribir_en_grupo_deportivo(pg_temp.g('G1')))::TEXT$q$);
SELECT pg_temp.paso('e4 cancela su inscripción en G1', pg_temp.u('14'),
    $q$SELECT (public.cancelar_inscripcion_deportiva(pg_temp.insc_activa(pg_temp.u('14'), pg_temp.g('G1'))))::TEXT$q$);

INSERT INTO public.asistencias (estudiante_id, fecha, estado)
SELECT pg_temp.u(s), DATE '2031-06-05', 'PRESENTE' FROM (VALUES ('11'), ('12'), ('13'), ('14'), ('15')) v(s);


-- ================================================================
-- 1. VÍNCULO DEPORTIVO VIGENTE: LECTURA Y LISTADO
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('A: lee la asistencia de un alumno con inscripción ACTIVA en un grupo activo que dicta',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('11')), 'OK:1');
    PERFORM pg_temp.verificar('A: no lee la asistencia de un alumno inscripto en el grupo de otro docente',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('12')), 'OK:0');
    PERFORM pg_temp.verificar('A: no lee la de un alumno cuya inscripción en su grupo está CANCELADA (historial sin vínculo)',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('14')), 'OK:0');
    PERFORM pg_temp.verificar('A: no lee la de un alumno sin ninguna inscripción deportiva',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('15')), 'OK:0');
    PERFORM pg_temp.verificar('A: sin filtro ve exactamente a los dos alumnos de sus grupos',
        pg_temp.ve(pg_temp.u('02')), 'OK:2');
    PERFORM pg_temp.verificar('B: ve solo al alumno de su grupo',
        pg_temp.ve(pg_temp.u('03')), 'OK:1');
    PERFORM pg_temp.verificar('C: un docente sin grupos no ve ninguna asistencia',
        pg_temp.ve(pg_temp.u('04')), 'OK:0');
    PERFORM pg_temp.verificar('Listado de A: e1 y e3, y e3 una sola vez aunque esté en dos grupos de A',
        pg_temp.lista(pg_temp.u('02')), 'OK:11,13');
    PERFORM pg_temp.verificar('Listado de B: solo e2',
        pg_temp.lista(pg_temp.u('03')), 'OK:12');
END $$;


-- ================================================================
-- 2. VÍNCULO DEPORTIVO VIGENTE: ESCRITURA
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('A: registra por la función a un alumno de su grupo',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-06-06'), 'OK:CREADA');
    PERFORM pg_temp.verificar('A: la función rechaza (P6610) a un alumno del grupo de otro docente',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('12'), DATE '2031-06-06'), 'E:P6610');
    PERFORM pg_temp.verificar('A: la función rechaza (P6610) a un alumno con inscripción CANCELADA',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('14'), DATE '2031-06-06'), 'E:P6610');
    PERFORM pg_temp.verificar('A: el alta directa para un alumno de su grupo, firmada por A, entra',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('13'), DATE '2031-06-06', pg_temp.u('02')), 'OK:1');
    PERFORM pg_temp.verificar('A: el alta directa para un alumno ajeno al grupo es rechazada por RLS (42501)',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('12'), DATE '2031-06-06', pg_temp.u('02')), 'E:42501');
END $$;


-- ================================================================
-- 3. REVOCACIÓN DEL VÍNCULO DEPORTIVO Y REINGRESO
-- ================================================================
SELECT pg_temp.paso('e1 cancela su inscripción en G1', pg_temp.u('11'),
    $q$SELECT (public.cancelar_inscripcion_deportiva(pg_temp.insc_activa(pg_temp.u('11'), pg_temp.g('G1'))))::TEXT$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Cancelada la inscripción, A pierde la lectura del alumno',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('11')), 'OK:0');
    PERFORM pg_temp.verificar('Cancelada la inscripción, A no puede registrar (P6610)',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-06-07'), 'E:P6610');
END $$;

SELECT pg_temp.paso('e1 se reinscribe en G1 (fila nueva)', pg_temp.u('11'),
    $q$SELECT (public.inscribir_en_grupo_deportivo(pg_temp.g('G1')))::TEXT$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Con el reingreso (fila nueva ACTIVA) A recupera la lectura',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('11')), 'OK:2');
    PERFORM pg_temp.verificar('Con el reingreso A vuelve a poder registrar',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-06-07'), 'OK:CREADA');
END $$;

-- e3 está en G1 y G3: desactivar G3 no alcanza para quitarle el vínculo.
-- La Dirección no puede desactivar un grupo con inscriptos activos (P5975): el estado
-- «grupo inactivo con inscripción ACTIVA» solo existe como dato histórico. Lo forzamos
-- como propietario para probar que el predicado exige el grupo ACTIVO.
UPDATE public.grupos_deportivos SET activo = FALSE WHERE id = pg_temp.g('G3');
DO $$
BEGIN
    PERFORM pg_temp.verificar('Con G3 inactivo (dato histórico forzado) A conserva a e3 mientras siga inscripto en el grupo activo G1',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('13')), 'OK:2');
END $$;

SELECT pg_temp.paso('e3 cancela su inscripción en G1', pg_temp.u('13'),
    $q$SELECT (public.cancelar_inscripcion_deportiva(pg_temp.insc_activa(pg_temp.u('13'), pg_temp.g('G1'))))::TEXT$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Con G1 cancelada y G3 inactivo (grupo inactivo no da vínculo) A pierde a e3',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('13')), 'OK:0');
    PERFORM pg_temp.verificar('Con el grupo inactivo A no puede registrar (P6610)',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('13'), DATE '2031-06-08'), 'E:P6610');
END $$;

UPDATE public.grupos_deportivos SET activo = TRUE WHERE id = pg_temp.g('G3');
DO $$
BEGIN
    PERFORM pg_temp.verificar('Reactivado el grupo, A recupera a e3 por su inscripción ACTIVA en G3',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('13')), 'OK:2');
END $$;

SELECT pg_temp.dir('pasar G1 al profesor B', $q$public.editar_grupo_deportivo(pg_temp.g('G1'), 'Grupo G1 EPT66D 02', 10, pg_temp.u('03'))$q$);
DO $$
BEGIN
    PERFORM pg_temp.verificar('Cambiado el profesor del grupo, A pierde a e1',
        pg_temp.ve(pg_temp.u('02'), pg_temp.u('11')), 'OK:0');
    PERFORM pg_temp.verificar('Cambiado el profesor del grupo, B gana a e1',
        pg_temp.ve(pg_temp.u('03'), pg_temp.u('11')), 'OK:3');
END $$;

ROLLBACK;
