-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Asistencias por vínculo vigente: Superficie de seguridad (EPT-66 D)
-- ============================================================
-- ACL de las funciones, search_path, DEFINER/INVOKER, volatilidad, contrato sin identidad, proyección del listado, políticas, privilegios de columna y trigger.
--
-- Ejecutar solo contra la base local descartable, después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
--   docker exec -i supabase_db_educar-para-transformar \
--     psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/asistencias_superficie_seguridad_rls.sql
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
-- Identificadores a66d0006…: uno por actor. `user_id` = `id`, como en las demás
-- pruebas SQL (`perfiles.user_id` no tiene FK hacia Auth).
CREATE FUNCTION pg_temp.u(p_s TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('a66d0006-0000-4000-8000-0000000000' || p_s)::UUID;
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
        'SELECT pg_catalog.count(*)::TEXT FROM public.asistencias WHERE (%L::UUID IS NULL AND estudiante_id::TEXT LIKE ''a66d0006%%'') OR estudiante_id = %L::UUID',
        p_alumno, p_alumno));
$$;

-- Alumnos que el actor recibe de `listar_estudiantes_para_gestion()`, ordenados por sufijo.
CREATE FUNCTION pg_temp.lista(p_sub UUID) RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub,
        $q$SELECT COALESCE(pg_catalog.string_agg(pg_catalog.right(e.id::TEXT, 2), ',' ORDER BY e.id), '-')
           FROM public.listar_estudiantes_para_gestion() e
           WHERE e.id::TEXT LIKE 'a66d0006%'$q$);
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
SELECT pg_temp.u(v.s), pg_temp.u(v.s), r.id, v.nombre, v.apellido, '96606' || v.s_dni, v.legajo
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
    SELECT id FROM public.materias WHERE nombre = 'Materia ' || p_n || ' EPT66D 06';
$$;

CREATE FUNCTION pg_temp.asig(p_n TEXT, p_curso UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT mc.id FROM public.materias_cursos mc
    WHERE mc.materia_id = pg_temp.mat(p_n) AND mc.curso_id = p_curso;
$$;

-- Materias M1 y M2 por la RPC real de la Dirección.
SELECT pg_temp.dir('crear materia M1', $q$public.crear_materia('Materia M1 EPT66D 06')$q$);
SELECT pg_temp.dir('crear materia M2', $q$public.crear_materia('Materia M2 EPT66D 06')$q$);

SELECT pg_temp.dir('asignar M1 a c1 con A',
    $q$public.asignar_materia_curso(pg_temp.mat('M1'), pg_temp.u('c1'), pg_temp.u('02'))$q$);

-- Funciones de la superficie de Asistencias (firma exacta → texto de comprobación).
CREATE TEMPORARY TABLE funcs (nombre TEXT PRIMARY KEY, oid REGPROCEDURE NOT NULL);
INSERT INTO funcs VALUES
    ('public.registrar_asistencia',            pg_catalog.to_regprocedure('public.registrar_asistencia(uuid,date,text)')),
    ('app_private.registrar_asistencia',       pg_catalog.to_regprocedure('app_private.registrar_asistencia(uuid,date,text)')),
    ('app_private.puede_registrar_asistencia_de', pg_catalog.to_regprocedure('app_private.puede_registrar_asistencia_de(uuid)')),
    ('app_private.alumnos_vinculados_al_docente_actual', pg_catalog.to_regprocedure('app_private.alumnos_vinculados_al_docente_actual()')),
    ('app_private.vinculos_docente_alumno',    pg_catalog.to_regprocedure('app_private.vinculos_docente_alumno(uuid,uuid)')),
    ('app_private.proteger_atributos_asistencia', pg_catalog.to_regprocedure('app_private.proteger_atributos_asistencia()')),
    ('public.listar_estudiantes_para_gestion', pg_catalog.to_regprocedure('public.listar_estudiantes_para_gestion()')),
    ('app_private.listar_estudiantes_para_gestion', pg_catalog.to_regprocedure('app_private.listar_estudiantes_para_gestion()'));

-- Todas existen (si falta una, to_regprocedure devolvió NULL y el INSERT ya habría fallado).

CREATE FUNCTION pg_temp.con_execute(p_rol TEXT) RETURNS TEXT LANGUAGE sql AS $$
    SELECT COALESCE(pg_catalog.string_agg(f.nombre, ', ' ORDER BY f.nombre COLLATE "C"), '-')
    FROM funcs f WHERE pg_catalog.has_function_privilege(p_rol, f.oid, 'EXECUTE');
$$;


-- ================================================================
-- 1. PRIVILEGIOS DE EJECUCIÓN
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('anon no puede ejecutar ninguna función de la superficie de Asistencias',
        pg_temp.con_execute('anon'), '-');
    PERFORM pg_temp.verificar('service_role no puede ejecutar ninguna función de la superficie de Asistencias',
        pg_temp.con_execute('service_role'), '-');
    PERFORM pg_temp.verificar('PUBLIC no tiene EXECUTE sobre ninguna (la pseudo-concesión implícita fue retirada)',
        (SELECT COALESCE(pg_catalog.string_agg(f.nombre, ', '), '-')
         FROM funcs f JOIN pg_catalog.pg_proc p ON p.oid = f.oid
         WHERE EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')), '-');
    PERFORM pg_temp.verificar('authenticated ejecuta exactamente el contrato público y los auxiliares de RLS y listado',
        pg_temp.con_execute('authenticated'),
        'app_private.alumnos_vinculados_al_docente_actual, app_private.listar_estudiantes_para_gestion, '
        'app_private.puede_registrar_asistencia_de, app_private.registrar_asistencia, '
        'public.listar_estudiantes_para_gestion, public.registrar_asistencia');
    PERFORM pg_temp.verificar('El predicado de vínculo y el trigger de inmutabilidad no son ejecutables por ningún cliente (42501)',
        pg_temp.como(pg_temp.u('02'), pg_catalog.format(
            'SELECT pg_catalog.count(*)::TEXT FROM app_private.vinculos_docente_alumno(%L, NULL)', pg_temp.u('02'))) || '/'
        || pg_temp.como(pg_temp.u('02'), 'SELECT app_private.proteger_atributos_asistencia()::TEXT'), 'E:42501/E:42501');
    PERFORM pg_temp.verificar('anon no recibe EXECUTE ni USAGE sobre app_private (42501 al invocar el contrato público)',
        pg_temp.como(NULL, $s$SELECT r.resultado FROM public.registrar_asistencia(NULL, NULL, NULL) r$s$, 'anon') || '/'
        || pg_temp.como(NULL, 'SELECT count(*)::TEXT FROM public.listar_estudiantes_para_gestion()', 'anon') || '/'
        || pg_catalog.has_schema_privilege('anon', 'app_private', 'USAGE')::TEXT, 'E:42501/E:42501/false');
END $$;


-- ================================================================
-- 2. SEARCH_PATH, DEFINER/INVOKER Y VOLATILIDAD
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('Todas las funciones tienen search_path fijo y vacío (sin resolución dependiente del llamador)',
        (SELECT COALESCE(pg_catalog.string_agg(f.nombre, ', '), '-')
         FROM funcs f JOIN pg_catalog.pg_proc p ON p.oid = f.oid
         WHERE p.proconfig IS NULL OR NOT ('search_path=""' = ANY (p.proconfig))), '-');
    PERFORM pg_temp.verificar('Los envoltorios públicos son SECURITY INVOKER: la RLS y los privilegios del llamador rigen',
        (SELECT pg_catalog.string_agg(f.nombre || '=' || p.prosecdef::TEXT, ', ' ORDER BY f.nombre COLLATE "C")
         FROM funcs f JOIN pg_catalog.pg_proc p ON p.oid = f.oid WHERE f.nombre LIKE 'public.%'),
        'public.listar_estudiantes_para_gestion=false, public.registrar_asistencia=false');
    PERFORM pg_temp.verificar('Solo las funciones privadas que leen tablas ajenas a RLS son SECURITY DEFINER',
        (SELECT pg_catalog.string_agg(f.nombre, ', ' ORDER BY f.nombre COLLATE "C")
         FROM funcs f JOIN pg_catalog.pg_proc p ON p.oid = f.oid WHERE p.prosecdef),
        'app_private.alumnos_vinculados_al_docente_actual, app_private.listar_estudiantes_para_gestion, '
        'app_private.puede_registrar_asistencia_de, app_private.registrar_asistencia, '
        'app_private.vinculos_docente_alumno');
    PERFORM pg_temp.verificar('Ninguna función SECURITY DEFINER vive en un esquema expuesto (public)',
        (SELECT pg_catalog.count(*)::TEXT FROM funcs f JOIN pg_catalog.pg_proc p ON p.oid = f.oid
         WHERE p.prosecdef AND f.nombre LIKE 'public.%'), '0');
    PERFORM pg_temp.verificar('El predicado y la lista de alumnos son STABLE; el registro y la guarda con bloqueo son VOLATILE',
        (SELECT pg_catalog.string_agg(f.nombre || '=' || p.provolatile::TEXT, ', ' ORDER BY f.nombre COLLATE "C")
         FROM funcs f JOIN pg_catalog.pg_proc p ON p.oid = f.oid
         WHERE f.nombre IN ('app_private.vinculos_docente_alumno', 'app_private.alumnos_vinculados_al_docente_actual',
                            'app_private.registrar_asistencia', 'app_private.puede_registrar_asistencia_de')),
        'app_private.alumnos_vinculados_al_docente_actual=s, app_private.puede_registrar_asistencia_de=v, '
        'app_private.registrar_asistencia=v, app_private.vinculos_docente_alumno=s');
    PERFORM pg_temp.verificar('El contrato de registro no recibe identidad: tres parámetros (alumno, fecha, estado) y ninguno de actor',
        (SELECT p.pronargs::TEXT || '/' || COALESCE(pg_catalog.array_to_string(p.proargnames[1:3], ','), '?')
         FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.registrar_asistencia(uuid,date,text)')),
        '3/p_estudiante_id,p_fecha,p_estado');
END $$;


-- ================================================================
-- 3. PROYECCIÓN DEL LISTADO
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('El listado de un docente expone exactamente id, nombre, apellido y legajo (sin DNI, domicilio, teléfono ni nacimiento)',
        pg_temp.como(pg_temp.u('02'),
            $s$SELECT pg_catalog.string_agg(k, ',' ORDER BY k) FROM (
                 SELECT DISTINCT pg_catalog.json_object_keys(pg_catalog.row_to_json(e)) AS k
                 FROM public.listar_estudiantes_para_gestion() e) q$s$),
        'OK:apellido,id,legajo_nro,nombre');
    PERFORM pg_temp.verificar('El listado de Dirección conserva la misma proyección de cuatro columnas',
        pg_temp.como(pg_temp.u('01'),
            $s$SELECT pg_catalog.string_agg(k, ',' ORDER BY k) FROM (
                 SELECT DISTINCT pg_catalog.json_object_keys(pg_catalog.row_to_json(e)) AS k
                 FROM public.listar_estudiantes_para_gestion() e) q$s$),
        'OK:apellido,id,legajo_nro,nombre');
    PERFORM pg_temp.verificar('La guarda de escritura responde false (no una excepción) para una sesión sin identidad',
        pg_temp.como(NULL, pg_catalog.format('SELECT app_private.puede_registrar_asistencia_de(%L)::TEXT', pg_temp.u('11'))), 'OK:false');
END $$;


-- ================================================================
-- 4. TABLA: RLS, POLÍTICAS, PRIVILEGIOS Y TRIGGER
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.verificar('asistencias tiene RLS habilitada',
        (SELECT c.relrowsecurity::TEXT FROM pg_catalog.pg_class c WHERE c.oid = 'public.asistencias'::REGCLASS), 'true');
    PERFORM pg_temp.verificar('Las políticas de asistencias son exactamente las del contrato: ninguna «Staff» global sobrevive',
        (SELECT pg_catalog.string_agg(p.policyname || '/' || p.cmd || '/' || p.permissive, ' | ' ORDER BY p.policyname COLLATE "C")
         FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'asistencias'),
        'Alumnos consultan sus asistencias/SELECT/PERMISSIVE | '
        'Bloqueo de acceso sin datos protegidos/ALL/RESTRICTIVE | '
        'Corrección de asistencias con vínculo vigente/UPDATE/PERMISSIVE | '
        'Dirección consulta asistencias/SELECT/PERMISSIVE | '
        'Docentes consultan asistencias de sus alumnos/SELECT/PERMISSIVE | '
        'Padres ven asistencias de sus hijos/SELECT/PERMISSIVE | '
        'Registro de asistencias con vínculo vigente/INSERT/PERMISSIVE');
    PERFORM pg_temp.verificar('authenticated no tiene DELETE, TRUNCATE, REFERENCES ni TRIGGER; anon no tiene ningún privilegio',
        (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege('authenticated', 'public.asistencias', t))::TEXT
         FROM (VALUES ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) v(t)) || '/'
        || (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege('anon', 'public.asistencias', t))::TEXT
            FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) v(t)), 'false/false');
    PERFORM pg_temp.verificar('authenticated solo puede actualizar la columna estado (docente_id, fecha, estudiante_id e id quedan fuera)',
        (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attnum)
         FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.asistencias'::REGCLASS AND a.attnum > 0 AND NOT a.attisdropped
           AND pg_catalog.has_column_privilege('authenticated', 'public.asistencias', a.attname, 'UPDATE')), 'estado');
    PERFORM pg_temp.verificar('El trigger de inmutabilidad está activo, es BEFORE UPDATE y por fila',
        (SELECT t.tgenabled::TEXT || '/' || (t.tgtype & 2)::TEXT || '/' || (t.tgtype & 16)::TEXT || '/' || (t.tgtype & 1)::TEXT
         FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.asistencias'::REGCLASS AND t.tgname = 'proteger_atributos_asistencia' AND NOT t.tgisinternal),
        'O/2/16/1');
END $$;

ROLLBACK;
