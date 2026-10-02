-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Asistencias por vínculo vigente: Identidad y escritura (EPT-66 D)
-- ============================================================
-- registrante derivado de la sesión, sin suplantación; alumno-fecha duplicado (upsert sin cambiar al registrante original); atributos inmutables; escritura directa; actualización de 0 filas; datos inválidos.
--
-- Ejecutar solo contra la base local descartable, después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
--   docker exec -i supabase_db_educar-para-transformar \
--     psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/asistencias_identidad_escritura_rls.sql
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
-- Identificadores a66d0004…: uno por actor. `user_id` = `id`, como en las demás
-- pruebas SQL (`perfiles.user_id` no tiene FK hacia Auth).
CREATE FUNCTION pg_temp.u(p_s TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('a66d0004-0000-4000-8000-0000000000' || p_s)::UUID;
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
        'SELECT pg_catalog.count(*)::TEXT FROM public.asistencias WHERE (%L::UUID IS NULL AND estudiante_id::TEXT LIKE ''a66d0004%%'') OR estudiante_id = %L::UUID',
        p_alumno, p_alumno));
$$;

-- Alumnos que el actor recibe de `listar_estudiantes_para_gestion()`, ordenados por sufijo.
CREATE FUNCTION pg_temp.lista(p_sub UUID) RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub,
        $q$SELECT COALESCE(pg_catalog.string_agg(pg_catalog.right(e.id::TEXT, 2), ',' ORDER BY e.id), '-')
           FROM public.listar_estudiantes_para_gestion() e
           WHERE e.id::TEXT LIKE 'a66d0004%'$q$);
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
SELECT pg_temp.u(v.s), pg_temp.u(v.s), r.id, v.nombre, v.apellido, '96604' || v.s_dni, v.legajo
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
    SELECT id FROM public.materias WHERE nombre = 'Materia ' || p_n || ' EPT66D 04';
$$;

CREATE FUNCTION pg_temp.asig(p_n TEXT, p_curso UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT mc.id FROM public.materias_cursos mc
    WHERE mc.materia_id = pg_temp.mat(p_n) AND mc.curso_id = p_curso;
$$;

-- Materias M1 y M2 por la RPC real de la Dirección.
SELECT pg_temp.dir('crear materia M1', $q$public.crear_materia('Materia M1 EPT66D 04')$q$);
SELECT pg_temp.dir('crear materia M2', $q$public.crear_materia('Materia M2 EPT66D 04')$q$);

-- c1 (e1, e3, e5): M1 con A y M2 con B → A y B tienen vínculo con los mismos alumnos.
-- c2 (e2, e4): sin docentes. D = Dirección (01). C (04) no tiene ningún vínculo.
SELECT pg_temp.dir('asignar M1 a c1 con A',
    $q$public.asignar_materia_curso(pg_temp.mat('M1'), pg_temp.u('c1'), pg_temp.u('02'))$q$);
SELECT pg_temp.dir('asignar M2 a c1 con B',
    $q$public.asignar_materia_curso(pg_temp.mat('M2'), pg_temp.u('c1'), pg_temp.u('03'))$q$);

-- Modificación directa de una asistencia: devuelve filas afectadas o SQLSTATE.
CREATE FUNCTION pg_temp.actualiza(p_sub UUID, p_alumno UUID, p_fecha DATE, p_asignacion TEXT, p_rol TEXT DEFAULT 'authenticated')
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub, pg_catalog.format(
        $q$WITH x AS (UPDATE public.asistencias SET %s WHERE estudiante_id = %L AND fecha = %L RETURNING 1)
           SELECT pg_catalog.count(*)::TEXT FROM x$q$, p_asignacion, p_alumno, p_fecha), p_rol);
$$;

CREATE FUNCTION pg_temp.borra(p_sub UUID, p_alumno UUID, p_fecha DATE) RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub, pg_catalog.format(
        $q$WITH x AS (DELETE FROM public.asistencias WHERE estudiante_id = %L AND fecha = %L RETURNING 1)
           SELECT pg_catalog.count(*)::TEXT FROM x$q$, p_alumno, p_fecha));
$$;

-- Una asistencia de e2 (sin docentes) para probar la actualización de 0 filas.
INSERT INTO public.asistencias (estudiante_id, fecha, estado, docente_id)
VALUES (pg_temp.u('12'), DATE '2031-08-05', 'AUSENTE', NULL);


-- ================================================================
-- 1. EL REGISTRANTE SE DERIVA DE LA SESIÓN
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('La función crea la asistencia cuando no existe',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06', 'PRESENTE'), 'OK:CREADA');
    PERFORM pg_temp.verificar('El registrante guardado es el perfil real de A, sin que el cliente envíe ninguna identidad',
        pg_temp.registrante_de(pg_temp.u('11'), DATE '2031-08-06'), '02');
    PERFORM pg_temp.verificar('Alta directa firmada por otro docente (docente_id = B) es rechazada por RLS (42501): sin suplantación',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('13'), DATE '2031-08-06', pg_temp.u('03')), 'E:42501');
    PERFORM pg_temp.verificar('Alta directa sin registrante (docente_id NULL) es rechazada por RLS (42501)',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('13'), DATE '2031-08-06', NULL), 'E:42501');
    PERFORM pg_temp.verificar('Alta directa firmada por Dirección en nombre de A es rechazada (42501): tampoco Dirección suplanta',
        pg_temp.inserta(pg_temp.u('01'), pg_temp.u('13'), DATE '2031-08-06', pg_temp.u('02')), 'E:42501');
    PERFORM pg_temp.verificar('Alta directa firmada por el propio actor entra y queda a su nombre',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('13'), DATE '2031-08-06', pg_temp.u('02'))
        || '/' || pg_temp.registrante_de(pg_temp.u('13'), DATE '2031-08-06'), 'OK:1/02');
    PERFORM pg_temp.verificar('Dirección registra por la función y queda como registrante real',
        pg_temp.registra(pg_temp.u('01'), pg_temp.u('15'), DATE '2031-08-06') || '/'
        || pg_temp.registrante_de(pg_temp.u('15'), DATE '2031-08-06'), 'OK:CREADA/01');
END $$;


-- ================================================================
-- 2. ALUMNO-FECHA YA REGISTRADO: UPSERT COHERENTE, SIN SUPLANTAR AL ORIGINAL
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('El alta directa de un alumno-fecha existente choca con la unicidad (23505)',
        pg_temp.inserta(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06', pg_temp.u('02')), 'E:23505');
    PERFORM pg_temp.verificar('La función sobre un alumno-fecha existente con el mismo estado no cambia nada (SIN_CAMBIOS)',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06', 'PRESENTE'), 'OK:SIN_CAMBIOS');
    PERFORM pg_temp.verificar('B corrige por la función lo registrado por A: ACTUALIZADA, el estado cambia',
        pg_temp.registra(pg_temp.u('03'), pg_temp.u('11'), DATE '2031-08-06', 'JUSTIFICADO') || '/'
        || pg_temp.estado_de(pg_temp.u('11'), DATE '2031-08-06'), 'OK:ACTUALIZADA/JUSTIFICADO');
    PERFORM pg_temp.verificar('La corrección de B no suplanta al registrante original (sigue A)',
        pg_temp.registrante_de(pg_temp.u('11'), DATE '2031-08-06'), '02');
    PERFORM pg_temp.verificar('La corrección de Dirección tampoco cambia el registrante original',
        pg_temp.registra(pg_temp.u('01'), pg_temp.u('11'), DATE '2031-08-06', 'AUSENTE') || '/'
        || pg_temp.registrante_de(pg_temp.u('11'), DATE '2031-08-06'), 'OK:ACTUALIZADA/02');
END $$;


-- ================================================================
-- 3. MODIFICACIÓN DIRECTA: ATRIBUTOS INMUTABLES, 0 FILAS Y BORRADO
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('A modifica por la API de tablas el estado de un alumno vinculado: 1 fila',
        pg_temp.actualiza(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06', $s$estado = 'PRESENTE'$s$)
        || '/' || pg_temp.estado_de(pg_temp.u('11'), DATE '2031-08-06'), 'OK:1/PRESENTE');
    PERFORM pg_temp.verificar('A modifica el estado de un alumno SIN vínculo: 0 filas y el dato no cambia (no parece éxito)',
        pg_temp.actualiza(pg_temp.u('02'), pg_temp.u('12'), DATE '2031-08-05', $s$estado = 'PRESENTE'$s$)
        || '/' || pg_temp.estado_de(pg_temp.u('12'), DATE '2031-08-05'), 'OK:0/AUSENTE');
    PERFORM pg_temp.verificar('C (sin ningún vínculo) tampoco modifica nada: 0 filas',
        pg_temp.actualiza(pg_temp.u('04'), pg_temp.u('11'), DATE '2031-08-06', $s$estado = 'AUSENTE'$s$), 'OK:0');
    PERFORM pg_temp.verificar('A no puede reasignar el registrante por UPDATE (sin privilegio de columna, 42501)',
        pg_temp.actualiza(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06',
            pg_catalog.format('docente_id = %L', pg_temp.u('03'))), 'E:42501');
    PERFORM pg_temp.verificar('A no puede mover una asistencia de fecha por UPDATE (42501)',
        pg_temp.actualiza(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06', $s$fecha = DATE '2031-08-07'$s$), 'E:42501');
    PERFORM pg_temp.verificar('A no puede pasar una asistencia a otro alumno por UPDATE (42501)',
        pg_temp.actualiza(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06',
            pg_catalog.format('estudiante_id = %L', pg_temp.u('12'))), 'E:42501');
    PERFORM pg_temp.verificar('Ni el propietario reasigna el registrante: el trigger de inmutabilidad lo rechaza (P6612)',
        pg_temp.actualiza(NULL, pg_temp.u('11'), DATE '2031-08-06',
            pg_catalog.format('docente_id = %L', pg_temp.u('03')), 'postgres'), 'E:P6612');
    PERFORM pg_temp.verificar('Ni el propietario cambia la fecha de una asistencia (P6612)',
        pg_temp.actualiza(NULL, pg_temp.u('11'), DATE '2031-08-06', $s$fecha = DATE '2031-08-07'$s$, 'postgres'), 'E:P6612');
    PERFORM pg_temp.verificar('El registrante sí puede quedar en NULL (el ON DELETE SET NULL de la clave foránea lo exige)',
        pg_temp.actualiza(NULL, pg_temp.u('15'), DATE '2031-08-06', 'docente_id = NULL', 'postgres')
        || '/' || pg_temp.registrante_de(pg_temp.u('15'), DATE '2031-08-06'), 'OK:1/-');
    PERFORM pg_temp.verificar('A no borra asistencias: sin privilegio de DELETE (42501)',
        pg_temp.borra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-06'), 'E:42501');
    PERFORM pg_temp.verificar('Dirección tampoco borra asistencias (42501)',
        pg_temp.borra(pg_temp.u('01'), pg_temp.u('11'), DATE '2031-08-06'), 'E:42501');
END $$;


-- ================================================================
-- 4. DATOS INVÁLIDOS Y ALUMNOS NO DISPONIBLES
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('Estado fuera del conjunto: la función responde P6611',
        pg_temp.registra(pg_temp.u('02'), pg_temp.u('11'), DATE '2031-08-08', 'TARDE'), 'E:P6611');
    PERFORM pg_temp.verificar('Fecha ausente: la función responde P6611',
        pg_temp.como(pg_temp.u('02'), pg_catalog.format(
            'SELECT r.resultado FROM public.registrar_asistencia(%L, NULL, %L) r', pg_temp.u('11'), 'PRESENTE')), 'E:P6611');
    PERFORM pg_temp.verificar('Alumno ausente: la función responde P6611',
        pg_temp.como(pg_temp.u('02'), $s$SELECT r.resultado FROM public.registrar_asistencia(NULL, DATE '2031-08-08', 'PRESENTE') r$s$), 'E:P6611');
    PERFORM pg_temp.verificar('Alumno inexistente: la misma respuesta que sin vínculo (P6610), sin revelar si existe',
        pg_temp.registra(pg_temp.u('02'), 'a66dffff-0000-4000-8000-000000000000', DATE '2031-08-08'), 'E:P6610');
    PERFORM pg_temp.verificar('Un perfil que no es ESTUDIANTE no se registra ni siquiera por Dirección (P6610)',
        pg_temp.registra(pg_temp.u('01'), pg_temp.u('03'), DATE '2031-08-08'), 'E:P6610');
    PERFORM pg_temp.verificar('Un estado inválido no deja ninguna fila (la transacción no persiste nada)',
        (SELECT pg_catalog.count(*)::TEXT FROM public.asistencias WHERE fecha = DATE '2031-08-08'), '0');
END $$;

ROLLBACK;
