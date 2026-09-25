-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Profesores: RLS, privilegios y reglas (EPT-58)
-- ============================================================
-- Ejecutar solo contra la base local descartable, después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
--   docker exec -i supabase_db_educar-para-transformar \
--     psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profesores_rls.sql
--
-- Cada rechazo se compara por SQLSTATE exacto: un error de recursión de RLS
-- (42P17) o cualquier otro fallo ambiguo nunca cuenta como denegación.
--
-- Vale para el esquema A y para A+B: la sección 11 detecta si la migración B
-- ya reemplazó la lectura global de perfiles y comprueba lo que corresponde.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

-- ================================================================
-- 0. FIXTURE
-- ================================================================
-- Identificadores f58…: DIRECTOR, tres DOCENTE (A con legajo, B sin legajo,
-- C con legajo), ESTUDIANTE, PADRE vinculado, PERSONAL. `user_id` = `id`,
-- como en las demás pruebas SQL: `perfiles.user_id` no tiene FK hacia Auth.
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT v.id, v.id, r.id, v.nombre, v.apellido, v.dni, v.legajo
FROM (VALUES
    ('f5800000-0000-4000-8000-000000000001'::uuid, 'DIRECTOR',   'Dora',    'Dirección EPT58', '95800001', NULL),
    ('f5800000-0000-4000-8000-000000000002'::uuid, 'DOCENTE',    'Alba',    'Docente A EPT58', '95800002', 'LEG-EPT58-A'),
    ('f5800000-0000-4000-8000-000000000003'::uuid, 'DOCENTE',    'Bruno',   'Docente B EPT58', '95800003', NULL),
    ('f5800000-0000-4000-8000-000000000004'::uuid, 'DOCENTE',    'Carla',   'Docente C EPT58', '95800004', 'LEG-EPT58-C'),
    ('f5800000-0000-4000-8000-000000000005'::uuid, 'ESTUDIANTE', 'Emilia',  'Estudiante EPT58', '95800005', 'LEG-EPT58-E'),
    ('f5800000-0000-4000-8000-000000000006'::uuid, 'PADRE',      'Pedro',   'Familia EPT58',   '95800006', NULL),
    ('f5800000-0000-4000-8000-000000000007'::uuid, 'PERSONAL',   'Paula',   'Personal EPT58',  '95800007', NULL)
) AS v(id, rol, nombre, apellido, dni, legajo)
JOIN public.roles r ON r.nombre = v.rol;

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES ('f5800000-0000-4000-8000-000000000006', 'f5800000-0000-4000-8000-000000000005');

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES
    ('f5800000-0000-4000-8000-0000000000c1',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT58', 'A', TRUE),
    ('f5800000-0000-4000-8000-0000000000c2',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT58', 'B', TRUE);

-- Grupos con profesor: el trigger de 014 exige rol DOCENTE y el de EPT-58,
-- ficha ACTIVO.
INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
VALUES
    ('f5800000-0000-4000-8000-0000000000d1', 'e0000000-0000-4000-8000-000000000101',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo EPT58 A', 10,
     'f5800000-0000-4000-8000-000000000002'),
    ('f5800000-0000-4000-8000-0000000000d2', 'e0000000-0000-4000-8000-000000000102',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo EPT58 C', 10,
     'f5800000-0000-4000-8000-000000000004');

-- Materias, asignaciones y franjas por las RPC reales de la dirección.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
SELECT public.crear_materia('Materia EPT58 A');
SELECT public.crear_materia('Materia EPT58 B');
SELECT public.asignar_materia_curso(
    (SELECT id FROM public.materias WHERE nombre = 'Materia EPT58 A'),
    'f5800000-0000-4000-8000-0000000000c1', 'f5800000-0000-4000-8000-000000000002');
SELECT public.asignar_materia_curso(
    (SELECT id FROM public.materias WHERE nombre = 'Materia EPT58 B'),
    'f5800000-0000-4000-8000-0000000000c1', 'f5800000-0000-4000-8000-000000000004');
SELECT public.configurar_horario_materia(
    (SELECT mc.id FROM public.materias_cursos mc JOIN public.materias m ON m.id = mc.materia_id
     WHERE m.nombre = 'Materia EPT58 A' AND mc.curso_id = 'f5800000-0000-4000-8000-0000000000c1'),
    1::smallint, '08:00', '09:00');
SELECT public.agregar_horario_grupo_deportivo(
    'f5800000-0000-4000-8000-0000000000d1', 2::smallint, '10:00', '11:00');
RESET ROLE;


-- ================================================================
-- 1. IDENTIDAD, FICHA 1:1 Y ALTA AUTOMÁTICA (CA-01, CA-02, CA-03)
-- ================================================================
DO $$
DECLARE
    v_codigo TEXT;
BEGIN
    -- El alta de los tres DOCENTE creó exactamente una ficha ACTIVO e
    -- incompleta; los otros roles no tienen ficha.
    IF (SELECT pg_catalog.count(*) FROM public.profesores
        WHERE perfil_id IN ('f5800000-0000-4000-8000-000000000002',
                            'f5800000-0000-4000-8000-000000000003',
                            'f5800000-0000-4000-8000-000000000004')
          AND estado = 'ACTIVO' AND especialidad IS NULL) <> 3 THEN
        RAISE EXCEPTION 'FALLO CA-03: el alta de DOCENTE no creó una ficha ACTIVO sin especialidad.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.profesores
               WHERE perfil_id IN ('f5800000-0000-4000-8000-000000000001',
                                   'f5800000-0000-4000-8000-000000000005',
                                   'f5800000-0000-4000-8000-000000000006',
                                   'f5800000-0000-4000-8000-000000000007')) THEN
        RAISE EXCEPTION 'FALLO CA-03: un perfil que no es DOCENTE recibió ficha.';
    END IF;

    -- Invariante global: una ficha por perfil DOCENTE y ninguna para otros roles.
    IF EXISTS (
        SELECT 1 FROM public.perfiles p
        JOIN public.roles r ON r.id = p.rol_id
        WHERE r.nombre = 'DOCENTE'
          AND NOT EXISTS (SELECT 1 FROM public.profesores pr WHERE pr.perfil_id = p.id)
    ) THEN
        RAISE EXCEPTION 'FALLO CA-03: existe un perfil DOCENTE sin ficha.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.profesores pr
        JOIN public.perfiles p ON p.id = pr.perfil_id
        LEFT JOIN public.roles r ON r.id = p.rol_id
        WHERE r.nombre IS DISTINCT FROM 'DOCENTE'
          AND NOT EXISTS (SELECT 1 FROM public.profesores_estados_historial h
                          WHERE h.profesor_id = pr.perfil_id)
    ) THEN
        RAISE EXCEPTION 'FALLO CA-03: existe una ficha de un perfil que nunca fue DOCENTE.';
    END IF;

    -- Un alta posterior, también por la política de la dirección, crea la ficha.
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
    SELECT 'f5800000-0000-4000-8000-000000000008', NULL, r.id, 'Diego', 'Docente D EPT58', '95800008'
    FROM public.roles r WHERE r.nombre = 'DOCENTE';

    IF (SELECT pg_catalog.count(*) FROM public.profesores
        WHERE perfil_id = 'f5800000-0000-4000-8000-000000000008') <> 1 THEN
        RAISE EXCEPTION 'FALLO CA-03: el alta posterior de un DOCENTE no creó su ficha.';
    END IF;

    -- CA-01: el perfil con ficha no se puede borrar (FK RESTRICT), ni siquiera
    -- por el propietario.
    BEGIN
        DELETE FROM public.perfiles WHERE id = 'f5800000-0000-4000-8000-000000000008';
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> '23503' THEN
        RAISE EXCEPTION 'FALLO CA-01: borrar un perfil con ficha devolvió % y no 23503.', v_codigo;
    END IF;

    -- CA-02: la ficha no duplica datos personales ni el correo.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('profesores', 'profesores_estados_historial')
          AND column_name IN ('nombre', 'apellido', 'dni', 'email', 'correo', 'telefono',
                              'direccion', 'fecha_nacimiento', 'legajo', 'legajo_nro', 'user_id')
    ) THEN
        RAISE EXCEPTION 'FALLO CA-02: una tabla de profesores copia un dato personal o el correo.';
    END IF;

    IF (SELECT pg_catalog.array_agg(column_name::TEXT ORDER BY column_name)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profesores')
       <> ARRAY['especialidad', 'estado', 'fecha_actualizacion', 'fecha_alta', 'perfil_id'] THEN
        RAISE EXCEPTION 'FALLO CA-02: las columnas de public.profesores no son las del contrato.';
    END IF;

    RAISE NOTICE 'OK CA-01/02/03: ficha 1:1 con borrado restringido, alta automática y sin datos duplicados';
END $$;


-- ================================================================
-- 2. CATÁLOGO: RLS, ACL, SECURITY DEFINER/INVOKER Y search_path (CA-18, CA-19)
-- ================================================================
DO $$
DECLARE
    v_rol        TEXT;
    v_tabla      TEXT;
    v_privilegio TEXT;
    v_funcion    RECORD;
    v_publicas   TEXT[] := ARRAY[
        'listar_profesores()', 'consultar_ficha_profesor(uuid)',
        'listar_asignaciones_profesor(uuid)', 'listar_horarios_profesor(uuid)',
        'listar_historial_estados_profesor(uuid)', 'listar_estudiantes_para_gestion()',
        'actualizar_ficha_profesor(uuid,text,text)', 'cambiar_estado_profesor(uuid,text,text)'
    ];
    v_internas   TEXT[] := ARRAY[
        'normalizar_especialidad(text)', 'especialidad_valida(text)',
        'normalizar_motivo_estado(text)', 'motivo_estado_valido(text)',
        'impedir_cambios_historial_profesor()', 'registrar_profesor_de_perfil()',
        'exigir_profesor_activo()', 'profesor_consultable(uuid)'
    ];
    v_firma      TEXT;
BEGIN
    -- RLS y propietario de las tablas.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid IN ('public.profesores'::regclass, 'public.profesores_estados_historial'::regclass)
          AND (NOT c.relrowsecurity OR pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres')
    ) THEN
        RAISE EXCEPTION 'FALLO CA-19: una tabla nueva no tiene RLS o no pertenece a postgres.';
    END IF;

    -- ACL de tabla, columna y secuencia.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.profesores', 'public.profesores_estados_historial'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'FALLO CA-19: % tiene % sobre %.', v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
        IF pg_catalog.has_any_column_privilege(v_rol, 'public.profesores', 'INSERT, UPDATE, REFERENCES')
           OR pg_catalog.has_any_column_privilege(v_rol, 'public.profesores_estados_historial', 'INSERT, UPDATE, REFERENCES') THEN
            RAISE EXCEPTION 'FALLO CA-19: % tiene un privilegio de columna de escritura.', v_rol;
        END IF;
        IF pg_catalog.has_sequence_privilege(v_rol, 'public.profesores_estados_historial_id_seq', 'USAGE, SELECT, UPDATE') THEN
            RAISE EXCEPTION 'FALLO CA-19: % tiene privilegios sobre la secuencia del historial.', v_rol;
        END IF;
    END LOOP;

    IF pg_catalog.has_table_privilege('anon', 'public.profesores', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.profesores_estados_historial', 'SELECT')
       OR pg_catalog.has_table_privilege('service_role', 'public.profesores', 'SELECT')
       OR pg_catalog.has_table_privilege('service_role', 'public.profesores_estados_historial', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO CA-19: anon o service_role pueden leer tablas de profesores.';
    END IF;

    IF NOT pg_catalog.has_table_privilege('authenticated', 'public.profesores', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('authenticated', 'public.profesores_estados_historial', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO CA-19: authenticated perdió la lectura filtrada por RLS.';
    END IF;

    -- Políticas: solo SELECT, con los nombres esperados.
    IF (SELECT pg_catalog.array_agg(p.policyname::TEXT || ':' || p.cmd ORDER BY p.policyname)
        FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename IN ('profesores', 'profesores_estados_historial'))
       <> ARRAY[
           'Dirección ve el historial de estados de profesores:SELECT',
           'Dirección y docente propio ven fichas de profesores:SELECT'
       ] THEN
        RAISE EXCEPTION 'FALLO CA-19: las políticas de profesores no son las esperadas.';
    END IF;

    -- Envoltorios públicos: INVOKER, search_path vacío, propietario postgres,
    -- EXECUTE solo para authenticated.
    FOREACH v_firma IN ARRAY v_publicas LOOP
        SELECT p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) AS dueno, p.oid
        INTO v_funcion
        FROM pg_catalog.pg_proc p
        WHERE p.oid = pg_catalog.to_regprocedure('public.' || v_firma);

        IF NOT FOUND THEN
            RAISE EXCEPTION 'FALLO CA-18: falta public.%.', v_firma;
        END IF;
        IF v_funcion.prosecdef
           OR v_funcion.proconfig IS DISTINCT FROM ARRAY['search_path=""']
           OR v_funcion.dueno <> 'postgres' THEN
            RAISE EXCEPTION 'FALLO CA-18: public.% no es INVOKER con search_path vacío de postgres.', v_firma;
        END IF;
        IF pg_catalog.has_function_privilege('anon', v_funcion.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_funcion.oid, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_funcion.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO CA-18: EXECUTE de public.% no es exclusivo de authenticated.', v_firma;
        END IF;

        -- Su par privado: DEFINER, search_path vacío, postgres, ejecutable solo
        -- por authenticated (lo necesita el envoltorio INVOKER).
        SELECT p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) AS dueno, p.oid
        INTO v_funcion
        FROM pg_catalog.pg_proc p
        WHERE p.oid = pg_catalog.to_regprocedure('app_private.' || v_firma);

        IF NOT FOUND
           OR NOT v_funcion.prosecdef
           OR v_funcion.proconfig IS DISTINCT FROM ARRAY['search_path=""']
           OR v_funcion.dueno <> 'postgres' THEN
            RAISE EXCEPTION 'FALLO CA-18: app_private.% no es DEFINER con search_path vacío de postgres.', v_firma;
        END IF;
        IF pg_catalog.has_function_privilege('anon', v_funcion.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_funcion.oid, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_funcion.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO CA-18: EXECUTE de app_private.% no es exclusivo de authenticated.', v_firma;
        END IF;
    END LOOP;

    -- Funciones internas: nadie de la aplicación puede invocarlas.
    FOREACH v_firma IN ARRAY v_internas LOOP
        SELECT p.proconfig, p.oid INTO v_funcion
        FROM pg_catalog.pg_proc p
        WHERE p.oid = pg_catalog.to_regprocedure('app_private.' || v_firma);

        IF NOT FOUND OR v_funcion.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
            RAISE EXCEPTION 'FALLO CA-18: app_private.% falta o no fija search_path vacío.', v_firma;
        END IF;
        FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF pg_catalog.has_function_privilege(v_rol, v_funcion.oid, 'EXECUTE') THEN
                RAISE EXCEPTION 'FALLO CA-18: % puede ejecutar app_private.%.', v_rol, v_firma;
            END IF;
        END LOOP;
    END LOOP;

    -- Ninguna función SECURITY DEFINER nueva quedó en public.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
    ) THEN
        RAISE EXCEPTION 'FALLO CA-18: existe una función SECURITY DEFINER en public.';
    END IF;

    -- Los guardas nuevos se disparan antes que los de 012/014.
    IF (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.materias_cursos'::regclass AND NOT t.tgisinternal
          AND (t.tgtype & 2) = 2)  -- BEFORE
       <> ARRAY['a_exigir_profesor_activo', 'validar_asignacion_materia_antes_de_escribir']
    OR (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.grupos_deportivos'::regclass AND NOT t.tgisinternal
          AND (t.tgtype & 2) = 2)
       <> ARRAY['a_exigir_profesor_activo', 'validar_grupo_deportivo_antes_de_escribir'] THEN
        RAISE EXCEPTION 'FALLO CA-07: los triggers BEFORE de asignaciones y grupos no son los esperados.';
    END IF;

    RAISE NOTICE 'OK CA-18/19: RLS, ACL de tabla/columna/secuencia, DEFINER en app_private, INVOKER en public, search_path y propietario';
END $$;


-- ================================================================
-- 3. NORMALIZACIÓN DE LA ESPECIALIDAD (CA-05)
-- ================================================================
DO $$
DECLARE
    v_punto   INTEGER;
    v_espacio TEXT;
BEGIN
    -- Cada carácter del conjunto colapsa y se recorta. Es la misma lista de
    -- `nombre_materia_valido` (012), más el espacio ASCII.
    FOREACH v_punto IN ARRAY ARRAY[9, 10, 11, 12, 13, 32, 133, 160, 5760, 8192, 8193, 8194,
        8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279] LOOP
        v_espacio := pg_catalog.chr(v_punto);
        IF app_private.normalizar_especialidad(v_espacio || 'Ciencias' || v_espacio || v_espacio
               || 'Naturales' || v_espacio) <> 'Ciencias Naturales' THEN
            RAISE EXCEPTION 'FALLO CA-05: U+% no se normaliza como espacio.', pg_catalog.to_hex(v_punto);
        END IF;
    END LOOP;

    -- Un carácter que no es espacio en blanco (U+200B) se conserva, igual que
    -- en la clase explícita del cliente.
    IF app_private.normalizar_especialidad('A' || pg_catalog.chr(8203) || 'B')
       <> 'A' || pg_catalog.chr(8203) || 'B' THEN
        RAISE EXCEPTION 'FALLO CA-05: U+200B no debe tratarse como espacio.';
    END IF;

    IF app_private.normalizar_especialidad('   ') <> ''
       OR app_private.normalizar_especialidad(NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO CA-05: solo espacios o NULL no se normalizan como vacío/NULL.';
    END IF;

    -- Límites del contrato sobre el valor ya normalizado.
    IF app_private.especialidad_valida('A')
       OR NOT app_private.especialidad_valida('AB')
       OR NOT app_private.especialidad_valida(pg_catalog.repeat('x', 100))
       OR app_private.especialidad_valida(pg_catalog.repeat('x', 101))
       OR app_private.especialidad_valida(' AB')
       OR app_private.especialidad_valida('A  B')
       OR NOT app_private.especialidad_valida('A B')
       OR app_private.especialidad_valida('')
       OR app_private.especialidad_valida(NULL) IS NOT FALSE THEN
        RAISE EXCEPTION 'FALLO CA-05: los límites de la especialidad no coinciden con el contrato.';
    END IF;

    -- Motivo: solo se recortan los extremos y el vacío es NULL.
    IF app_private.normalizar_motivo_estado('  Licencia' || pg_catalog.chr(10) || 'médica  ')
       <> 'Licencia' || pg_catalog.chr(10) || 'médica'
       OR app_private.normalizar_motivo_estado(pg_catalog.chr(160) || ' ') IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO: el motivo no se normaliza según el contrato.';
    END IF;

    RAISE NOTICE 'OK CA-05: normalización equivalente al conjunto de espacios de 012 y límites 2–100';
END $$;


-- ================================================================
-- 4. MATRIZ DE LECTURA POR ACTOR (CA-13, CA-21)
-- ================================================================
-- Cada caso: [sentencia, SQLSTATE esperado u OK]. Los rechazos se comparan por
-- código exacto; un 42P17 haría fallar la prueba.

-- 4.1 DIRECTOR
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
DO $$
DECLARE
    v_casos  TEXT[] := ARRAY[
        ['SELECT * FROM public.listar_profesores()', 'OK'],
        ['SELECT * FROM public.consultar_ficha_profesor(''f5800000-0000-4000-8000-000000000002'')', 'OK'],
        ['SELECT * FROM public.consultar_ficha_profesor(NULL)', 'P5601'],
        ['SELECT * FROM public.consultar_ficha_profesor(''f5800000-0000-4000-8000-0000000000ff'')', 'P5600'],
        ['SELECT * FROM public.consultar_ficha_profesor(''f5800000-0000-4000-8000-000000000005'')', 'P5600'],
        ['SELECT * FROM public.listar_asignaciones_profesor(''f5800000-0000-4000-8000-000000000002'')', 'OK'],
        ['SELECT * FROM public.listar_horarios_profesor(''f5800000-0000-4000-8000-000000000002'')', 'OK'],
        ['SELECT * FROM public.listar_historial_estados_profesor(''f5800000-0000-4000-8000-000000000002'')', 'OK'],
        ['SELECT * FROM public.listar_historial_estados_profesor(NULL)', 'P5600'],
        ['SELECT * FROM public.listar_estudiantes_para_gestion()', 'OK'],
        ['SELECT * FROM public.profesores', 'OK'],
        ['SELECT * FROM public.profesores_estados_historial', 'OK'],
        ['SELECT * FROM public.perfiles', 'OK'],
        ['INSERT INTO public.profesores (perfil_id) VALUES (''f5800000-0000-4000-8000-000000000007'')', '42501'],
        ['UPDATE public.profesores SET estado = ''INACTIVO''', '42501'],
        ['DELETE FROM public.profesores', '42501'],
        ['TRUNCATE public.profesores', '42501'],
        ['INSERT INTO public.profesores_estados_historial (profesor_id, estado_anterior, estado_nuevo, actor_id) VALUES (''f5800000-0000-4000-8000-000000000002'', ''ACTIVO'', ''INACTIVO'', ''f5800000-0000-4000-8000-000000000001'')', '42501'],
        ['UPDATE public.profesores_estados_historial SET motivo = ''x''', '42501'],
        ['DELETE FROM public.profesores_estados_historial', '42501'],
        ['TRUNCATE public.profesores_estados_historial', '42501'],
        ['SELECT * FROM app_private.profesor_consultable(NULL)', '42501'],
        ['SELECT app_private.normalizar_especialidad(''x'')', '42501']
    ];
    v_caso   TEXT[];
    v_codigo TEXT;
    v_filas  BIGINT;
BEGIN
    FOREACH v_caso SLICE 1 IN ARRAY v_casos LOOP
        BEGIN
            EXECUTE v_caso[1];
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        IF v_codigo IS DISTINCT FROM v_caso[2] THEN
            RAISE EXCEPTION 'FALLO CA-21 DIRECTOR: «%» devolvió %, se esperaba %.', v_caso[1], v_codigo, v_caso[2];
        END IF;
    END LOOP;

    -- Contenido: todas las fichas, incompletas, con asignaciones y horarios.
    IF NOT EXISTS (
        SELECT 1 FROM public.listar_profesores() l
        WHERE l.perfil_id = 'f5800000-0000-4000-8000-000000000002'
          AND l.legajo_nro = 'LEG-EPT58-A' AND NOT l.ficha_completa AND l.rol_docente_vigente
          AND l.asignaciones_activas = 1 AND l.grupos_activos = 1
    ) OR (SELECT pg_catalog.count(*) FROM public.listar_profesores() l
          WHERE l.perfil_id::TEXT LIKE 'f5800000-%') <> 4 THEN
        RAISE EXCEPTION 'FALLO CA-13 DIRECTOR: el listado no muestra las fichas esperadas.';
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.consultar_ficha_profesor('f5800000-0000-4000-8000-000000000002') f
        WHERE f.dni = '95800002' AND f.nombre = 'Alba') <> 1 THEN
        RAISE EXCEPTION 'FALLO CA-13 DIRECTOR: la ficha no trae los datos personales del perfil.';
    END IF;

    IF (SELECT pg_catalog.array_agg(a.tipo || ':' || a.actividad_nombre || ':' || a.vigente ORDER BY a.tipo)
        FROM public.listar_asignaciones_profesor('f5800000-0000-4000-8000-000000000002') a)
       <> ARRAY['GRUPO_DEPORTIVO:Fútbol:true', 'MATERIA:Materia EPT58 A:true'] THEN
        RAISE EXCEPTION 'FALLO CA-12 DIRECTOR: las asignaciones derivadas no son las esperadas.';
    END IF;

    IF (SELECT pg_catalog.array_agg(h.tipo || ':' || h.dia_semana || ':' || h.hora_inicio ORDER BY h.dia_semana)
        FROM public.listar_horarios_profesor('f5800000-0000-4000-8000-000000000002') h)
       <> ARRAY['MATERIA:1:08:00:00', 'GRUPO_DEPORTIVO:2:10:00:00'] THEN
        RAISE EXCEPTION 'FALLO CA-12 DIRECTOR: los horarios derivados no son los esperados.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_filas FROM public.profesores WHERE perfil_id::TEXT LIKE 'f5800000-%';
    IF v_filas <> 4 THEN
        RAISE EXCEPTION 'FALLO CA-19 DIRECTOR: la lectura directa de fichas devolvió % filas del fixture.', v_filas;
    END IF;

    RAISE NOTICE 'OK CA-13/21 DIRECTOR: % casos de lectura y escritura directa', pg_catalog.array_length(v_casos, 1);
END $$;
RESET ROLE;

-- 4.2 DOCENTE propio y ajeno
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000002"}', true);
DO $$
DECLARE
    v_casos  TEXT[] := ARRAY[
        ['SELECT * FROM public.consultar_ficha_profesor(NULL)', 'OK'],
        ['SELECT * FROM public.consultar_ficha_profesor(''f5800000-0000-4000-8000-000000000002'')', 'OK'],
        ['SELECT * FROM public.consultar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'')', '42501'],
        ['SELECT * FROM public.consultar_ficha_profesor(''f5800000-0000-4000-8000-0000000000ff'')', '42501'],
        ['SELECT * FROM public.listar_asignaciones_profesor(NULL)', 'OK'],
        ['SELECT * FROM public.listar_asignaciones_profesor(''f5800000-0000-4000-8000-000000000004'')', '42501'],
        ['SELECT * FROM public.listar_horarios_profesor(NULL)', 'OK'],
        ['SELECT * FROM public.listar_horarios_profesor(''f5800000-0000-4000-8000-000000000004'')', '42501'],
        ['SELECT * FROM public.listar_profesores()', '42501'],
        ['SELECT * FROM public.listar_historial_estados_profesor(''f5800000-0000-4000-8000-000000000002'')', '42501'],
        ['SELECT * FROM public.listar_estudiantes_para_gestion()', 'OK'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000002'', ''LEG-EPT58-A'', ''Matemática'')', '42501'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000003'', ''INACTIVO'')', '42501'],
        ['SELECT * FROM public.profesores', 'OK'],
        ['SELECT * FROM public.profesores_estados_historial', 'OK'],
        ['UPDATE public.profesores SET especialidad = ''Hackeo''', '42501'],
        ['DELETE FROM public.profesores', '42501'],
        ['INSERT INTO public.profesores_estados_historial (profesor_id, estado_anterior, estado_nuevo, actor_id) VALUES (''f5800000-0000-4000-8000-000000000002'', ''ACTIVO'', ''INACTIVO'', ''f5800000-0000-4000-8000-000000000002'')', '42501']
    ];
    v_caso   TEXT[];
    v_codigo TEXT;
BEGIN
    FOREACH v_caso SLICE 1 IN ARRAY v_casos LOOP
        BEGIN
            EXECUTE v_caso[1];
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        IF v_codigo IS DISTINCT FROM v_caso[2] THEN
            RAISE EXCEPTION 'FALLO CA-21 DOCENTE: «%» devolvió %, se esperaba %.', v_caso[1], v_codigo, v_caso[2];
        END IF;
    END LOOP;

    -- Solo lo propio, por RPC y por lectura directa.
    IF (SELECT pg_catalog.array_agg(f.perfil_id) FROM public.consultar_ficha_profesor(NULL) f)
       <> ARRAY['f5800000-0000-4000-8000-000000000002'::uuid]
       OR (SELECT pg_catalog.array_agg(pr.perfil_id) FROM public.profesores pr)
       <> ARRAY['f5800000-0000-4000-8000-000000000002'::uuid]
       OR EXISTS (SELECT 1 FROM public.profesores_estados_historial) THEN
        RAISE EXCEPTION 'FALLO CA-13 DOCENTE: el docente ve una ficha o un historial ajeno.';
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.listar_asignaciones_profesor(NULL)) <> 2
       OR (SELECT pg_catalog.count(*) FROM public.listar_horarios_profesor(NULL)) <> 2 THEN
        RAISE EXCEPTION 'FALLO CA-13 DOCENTE: el docente no ve sus asignaciones y horarios.';
    END IF;

    RAISE NOTICE 'OK CA-13/21 DOCENTE: % casos; solo su ficha, sus asignaciones y sus horarios', pg_catalog.array_length(v_casos, 1);
END $$;
RESET ROLE;

-- 4.3 ESTUDIANTE, PADRE, PERSONAL y sesión sin perfil: ninguna superficie nueva.
DO $$
DECLARE
    v_actor  TEXT;
    v_casos  TEXT[] := ARRAY[
        ['SELECT * FROM public.listar_profesores()', '42501'],
        ['SELECT * FROM public.consultar_ficha_profesor(NULL)', '42501'],
        ['SELECT * FROM public.consultar_ficha_profesor(''f5800000-0000-4000-8000-000000000002'')', '42501'],
        ['SELECT * FROM public.listar_asignaciones_profesor(''f5800000-0000-4000-8000-000000000002'')', '42501'],
        ['SELECT * FROM public.listar_horarios_profesor(''f5800000-0000-4000-8000-000000000002'')', '42501'],
        ['SELECT * FROM public.listar_historial_estados_profesor(''f5800000-0000-4000-8000-000000000002'')', '42501'],
        ['SELECT * FROM public.listar_estudiantes_para_gestion()', '42501'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000002'', ''LEG-EPT58-A'', ''Matemática'')', '42501'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000002'', ''INACTIVO'')', '42501'],
        ['SELECT * FROM public.profesores', 'OK'],
        ['SELECT * FROM public.profesores_estados_historial', 'OK'],
        ['UPDATE public.profesores SET estado = ''INACTIVO''', '42501'],
        ['DELETE FROM public.profesores_estados_historial', '42501']
    ];
    v_caso   TEXT[];
    v_codigo TEXT;
BEGIN
    FOREACH v_actor IN ARRAY ARRAY[
        'f5800000-0000-4000-8000-000000000005',  -- ESTUDIANTE
        'f5800000-0000-4000-8000-000000000006',  -- PADRE
        'f5800000-0000-4000-8000-000000000007',  -- PERSONAL
        'f5800000-0000-4000-8000-000000000099'   -- sesión sin perfil
    ] LOOP
        PERFORM set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_actor)::TEXT, true);
        SET LOCAL ROLE authenticated;

        FOREACH v_caso SLICE 1 IN ARRAY v_casos LOOP
            BEGIN
                EXECUTE v_caso[1];
                v_codigo := 'OK';
            EXCEPTION WHEN OTHERS THEN
                v_codigo := SQLSTATE;
            END;
            IF v_codigo IS DISTINCT FROM v_caso[2] THEN
                RAISE EXCEPTION 'FALLO CA-21 %: «%» devolvió %, se esperaba %.', v_actor, v_caso[1], v_codigo, v_caso[2];
            END IF;
        END LOOP;

        -- La lectura directa no falla, pero no devuelve filas.
        IF EXISTS (SELECT 1 FROM public.profesores)
           OR EXISTS (SELECT 1 FROM public.profesores_estados_historial) THEN
            RAISE EXCEPTION 'FALLO CA-21 %: un actor sin permiso ve fichas o historial.', v_actor;
        END IF;

        RESET ROLE;
    END LOOP;

    RAISE NOTICE 'OK CA-21 ESTUDIANTE/PADRE/PERSONAL/sin perfil: sin acceso a fichas, historial ni RPC';
END $$;

-- 4.4 Sesión autenticada sin identidad (claims vacíos): P5505, no un 42P17.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true);
DO $$
DECLARE
    v_codigo TEXT;
BEGIN
    BEGIN
        PERFORM * FROM public.listar_profesores();
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> 'P5505' THEN
        RAISE EXCEPTION 'FALLO CA-21: sin identidad se esperaba P5505 y llegó %.', v_codigo;
    END IF;
    RAISE NOTICE 'OK CA-21: una sesión sin identidad recibe P5505';
END $$;
RESET ROLE;

-- 4.5 anon: sin privilegios sobre tablas ni funciones.
SET LOCAL ROLE anon;
DO $$
DECLARE
    v_casos  TEXT[] := ARRAY[
        ['SELECT * FROM public.profesores', '42501'],
        ['SELECT * FROM public.profesores_estados_historial', '42501'],
        ['SELECT * FROM public.listar_profesores()', '42501'],
        ['SELECT * FROM public.consultar_ficha_profesor(NULL)', '42501'],
        ['SELECT * FROM public.listar_estudiantes_para_gestion()', '42501'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000002'', ''INACTIVO'')', '42501']
    ];
    v_caso   TEXT[];
    v_codigo TEXT;
BEGIN
    FOREACH v_caso SLICE 1 IN ARRAY v_casos LOOP
        BEGIN
            EXECUTE v_caso[1];
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        IF v_codigo IS DISTINCT FROM v_caso[2] THEN
            RAISE EXCEPTION 'FALLO CA-21 anon: «%» devolvió %, se esperaba %.', v_caso[1], v_codigo, v_caso[2];
        END IF;
    END LOOP;
    RAISE NOTICE 'OK CA-21 anon: % casos denegados por privilegio', pg_catalog.array_length(v_casos, 1);
END $$;
RESET ROLE;

-- 4.6 service_role: EPT-58 no le concede nada.
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_codigo TEXT;
BEGIN
    BEGIN
        PERFORM 1 FROM public.profesores_estados_historial;
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> '42501' THEN
        RAISE EXCEPTION 'FALLO CA-19: service_role accede al historial (%).', v_codigo;
    END IF;
    RAISE NOTICE 'OK CA-19 service_role: sin privilegios sobre las tablas de EPT-58';
END $$;
RESET ROLE;


-- ================================================================
-- 5. CONSULTA MÍNIMA DE ESTUDIANTES (CA-17)
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000002"}', true);
DO $$
BEGIN
    -- Exactamente cuatro columnas: sin DNI, domicilio, teléfono ni nacimiento.
    IF (SELECT pg_catalog.array_agg(k ORDER BY k)
        FROM (SELECT pg_catalog.json_object_keys(pg_catalog.row_to_json(e)) AS k
              FROM public.listar_estudiantes_para_gestion() e
              WHERE e.id = 'f5800000-0000-4000-8000-000000000005') AS claves)
       <> ARRAY['apellido', 'id', 'legajo_nro', 'nombre'] THEN
        RAISE EXCEPTION 'FALLO CA-17: la consulta mínima no devuelve exactamente id, nombre, apellido y legajo.';
    END IF;

    -- Mismo conjunto que hoy devuelve la lectura de perfiles ESTUDIANTE.
    IF EXISTS (
        (SELECT e.id FROM public.listar_estudiantes_para_gestion() e)
        EXCEPT
        (SELECT p.id FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id WHERE r.nombre = 'ESTUDIANTE')
    ) THEN
        RAISE EXCEPTION 'FALLO CA-17: la consulta mínima devuelve perfiles que no son ESTUDIANTE.';
    END IF;
    RAISE NOTICE 'OK CA-17 DOCENTE: consulta mínima de cuatro columnas';
END $$;
RESET ROLE;

-- El conjunto completo se compara como propietario, que ve todos los perfiles.
DO $$
DECLARE
    v_rpc      UUID[];
    v_docente  UUID[];
    v_esperado UUID[];
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
    SET LOCAL ROLE authenticated;
    SELECT pg_catalog.array_agg(e.id ORDER BY e.id) INTO v_rpc
    FROM public.listar_estudiantes_para_gestion() e;
    RESET ROLE;

    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000002"}', true);
    SET LOCAL ROLE authenticated;
    SELECT pg_catalog.array_agg(e.id ORDER BY e.id) INTO v_docente
    FROM public.listar_estudiantes_para_gestion() e;
    RESET ROLE;

    SELECT pg_catalog.array_agg(p.id ORDER BY p.id) INTO v_esperado
    FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'ESTUDIANTE';

    IF v_rpc IS DISTINCT FROM v_esperado OR v_docente IS DISTINCT FROM v_esperado THEN
        RAISE EXCEPTION 'FALLO CA-17: la consulta mínima no conserva el conjunto de estudiantes.';
    END IF;
    RAISE NOTICE 'OK CA-17: mismo conjunto de estudiantes que la lectura previa, sin filtrar por curso';
END $$;


-- ================================================================
-- 6. FICHA: LEGAJO Y ESPECIALIDAD (CA-04, CA-05)
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
DO $$
DECLARE
    v_casos  TEXT[] := ARRAY[
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', NULL, ''Matemática'')', 'P5602'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', '' LEG-EPT58-B'', ''Matemática'')', 'P5515'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', '''', ''Matemática'')', 'P5515'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', ''LEG-EPT58-B'', NULL)', 'P5603'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', ''LEG-EPT58-B'', '''')', 'P5603'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', ''LEG-EPT58-B'', ''    '')', 'P5603'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', ''LEG-EPT58-B'', '' X '')', 'P5604'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', ''LEG-EPT58-B'', repeat(''x'', 101))', 'P5604'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000003'', ''leg-ept58-a'', ''Matemática'')', '23505'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-0000000000ff'', ''LEG-EPT58-Z'', ''Matemática'')', 'P5600'],
        ['SELECT public.actualizar_ficha_profesor(''f5800000-0000-4000-8000-000000000005'', ''LEG-EPT58-Z'', ''Matemática'')', 'P5600'],
        ['SELECT public.actualizar_ficha_profesor(NULL, ''LEG-EPT58-Z'', ''Matemática'')', 'P5600']
    ];
    v_caso   TEXT[];
    v_codigo TEXT;
    v_ficha  RECORD;
BEGIN
    FOREACH v_caso SLICE 1 IN ARRAY v_casos LOOP
        BEGIN
            EXECUTE v_caso[1];
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        IF v_codigo IS DISTINCT FROM v_caso[2] THEN
            RAISE EXCEPTION 'FALLO CA-04/05: «%» devolvió %, se esperaba %.', v_caso[1], v_codigo, v_caso[2];
        END IF;
    END LOOP;

    -- Ningún rechazo dejó cambios parciales.
    SELECT l.legajo_nro, l.especialidad, l.ficha_completa INTO v_ficha
    FROM public.listar_profesores() l WHERE l.perfil_id = 'f5800000-0000-4000-8000-000000000003';
    IF v_ficha.legajo_nro IS NOT NULL OR v_ficha.especialidad IS NOT NULL OR v_ficha.ficha_completa THEN
        RAISE EXCEPTION 'FALLO CA-04: un rechazo dejó la ficha modificada.';
    END IF;

    -- Alta válida: se normaliza la especialidad y la ficha queda completa. La
    -- especialidad no es única: otra ficha puede repetirla.
    PERFORM public.actualizar_ficha_profesor(
        'f5800000-0000-4000-8000-000000000003', 'LEG-EPT58-B',
        '  Ciencias' || pg_catalog.chr(160) || ' ' || pg_catalog.chr(9) || 'Naturales  ');
    PERFORM public.actualizar_ficha_profesor(
        'f5800000-0000-4000-8000-000000000002', 'LEG-EPT58-A', 'Ciencias Naturales');

    SELECT l.legajo_nro, l.especialidad, l.ficha_completa INTO v_ficha
    FROM public.listar_profesores() l WHERE l.perfil_id = 'f5800000-0000-4000-8000-000000000003';
    IF v_ficha.legajo_nro <> 'LEG-EPT58-B' OR v_ficha.especialidad <> 'Ciencias Naturales'
       OR NOT v_ficha.ficha_completa THEN
        RAISE EXCEPTION 'FALLO CA-04/05: la ficha válida no quedó completa y normalizada.';
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.listar_profesores() l
        WHERE l.especialidad = 'Ciencias Naturales' AND l.perfil_id::TEXT LIKE 'f5800000-%') <> 2 THEN
        RAISE EXCEPTION 'FALLO CA-05: la especialidad no admite repetirse entre docentes.';
    END IF;

    RAISE NOTICE 'OK CA-04/05: % rechazos sin cambios parciales; ficha completa normalizada', pg_catalog.array_length(v_casos, 1);
END $$;
RESET ROLE;


-- ================================================================
-- 7. ESTADO, HISTORIAL Y GUARDAS DE ASIGNACIÓN (CA-06 a CA-09)
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
DO $$
DECLARE
    v_codigo  TEXT;
    v_detalle TEXT;
    v_mensaje TEXT;
    v_casos   TEXT[] := ARRAY[
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000003'', ''SUSPENDIDO'')', 'P5606'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000003'', NULL)', 'P5606'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000003'', ''ACTIVO'')', 'P5608'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000003'', ''INACTIVO'', repeat(''m'', 501))', 'P5607'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-0000000000ff'', ''INACTIVO'')', 'P5600'],
        ['SELECT public.cambiar_estado_profesor(''f5800000-0000-4000-8000-000000000005'', ''INACTIVO'')', 'P5600']
    ];
    v_caso    TEXT[];
BEGIN
    FOREACH v_caso SLICE 1 IN ARRAY v_casos LOOP
        BEGIN
            EXECUTE v_caso[1];
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        IF v_codigo IS DISTINCT FROM v_caso[2] THEN
            RAISE EXCEPTION 'FALLO CA-06/08: «%» devolvió %, se esperaba %.', v_caso[1], v_codigo, v_caso[2];
        END IF;
    END LOOP;

    -- CA-06: A tiene una asignación y un grupo activos. El rechazo informa
    -- cuáles y no deja cambios ni historial.
    BEGIN
        PERFORM public.cambiar_estado_profesor('f5800000-0000-4000-8000-000000000002', 'INACTIVO', 'Prueba');
        RAISE EXCEPTION 'FALLO CA-06: se inactivó un profesor con asignaciones activas.';
    EXCEPTION WHEN SQLSTATE 'P5610' THEN
        GET STACKED DIAGNOSTICS v_detalle = PG_EXCEPTION_DETAIL, v_mensaje = MESSAGE_TEXT;
    END;
    IF v_mensaje NOT LIKE '%1 asignación(es)%1 grupo(s)%'
       OR (v_detalle::JSONB -> 'asignaciones' -> 0 ->> 'materia') IS DISTINCT FROM 'Materia EPT58 A'
       OR (v_detalle::JSONB -> 'grupos' -> 0 ->> 'grupo') IS DISTINCT FROM 'Grupo EPT58 A' THEN
        RAISE EXCEPTION 'FALLO CA-06: el rechazo no informa qué impide la inactivación (% / %).', v_mensaje, v_detalle;
    END IF;
    IF (SELECT l.estado FROM public.listar_profesores() l
        WHERE l.perfil_id = 'f5800000-0000-4000-8000-000000000002') <> 'ACTIVO'
       OR EXISTS (SELECT 1 FROM public.listar_historial_estados_profesor('f5800000-0000-4000-8000-000000000002')) THEN
        RAISE EXCEPTION 'FALLO CA-06: el rechazo dejó cambios parciales.';
    END IF;

    -- CA-09: B no tiene asignaciones. Se inactiva con motivo normalizado y
    -- queda una fila de historial con el actor de la sesión.
    PERFORM public.cambiar_estado_profesor('f5800000-0000-4000-8000-000000000003', 'INACTIVO', '  Licencia  ');
    IF (SELECT pg_catalog.array_agg(h.estado_anterior || '>' || h.estado_nuevo || ':' || COALESCE(h.motivo, '-')
                                    || ':' || h.actor_id)
        FROM public.listar_historial_estados_profesor('f5800000-0000-4000-8000-000000000003') h)
       <> ARRAY['ACTIVO>INACTIVO:Licencia:f5800000-0000-4000-8000-000000000001'] THEN
        RAISE EXCEPTION 'FALLO CA-09: la inactivación no registró el historial esperado.';
    END IF;

    BEGIN
        PERFORM public.cambiar_estado_profesor('f5800000-0000-4000-8000-000000000003', 'INACTIVO');
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> 'P5608' THEN
        RAISE EXCEPTION 'FALLO CA-06: inactivar dos veces devolvió %.', v_codigo;
    END IF;

    RAISE NOTICE 'OK CA-06/09: inactivación bloqueada con detalle y sin cambios; inactivación válida con historial';
END $$;
RESET ROLE;

-- CA-07: un docente INACTIVO (B) no queda a cargo por ninguna vía.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
DO $$
DECLARE
    v_casos  TEXT[] := ARRAY[
        -- Asignación nueva.
        ['SELECT public.asignar_materia_curso((SELECT id FROM public.materias WHERE nombre = ''Materia EPT58 A''), ''f5800000-0000-4000-8000-0000000000c2'', ''f5800000-0000-4000-8000-000000000003'')', 'P5605'],
        -- Cambio de responsable.
        ['SELECT public.cambiar_profesor_asignacion((SELECT mc.id FROM public.materias_cursos mc JOIN public.materias m ON m.id = mc.materia_id WHERE m.nombre = ''Materia EPT58 A'' AND mc.curso_id = ''f5800000-0000-4000-8000-0000000000c1''), ''f5800000-0000-4000-8000-000000000003'')', 'P5605'],
        -- Grupo nuevo.
        ['SELECT public.crear_grupo_deportivo(''e0000000-0000-4000-8000-000000000103'', (SELECT id FROM public.niveles WHERE nombre = ''PRIMARIO''), ''Grupo EPT58 B'', 10, ''f5800000-0000-4000-8000-000000000003'')', 'P5605'],
        -- Una asignación sin profesor sigue siendo posible.
        ['SELECT public.asignar_materia_curso((SELECT id FROM public.materias WHERE nombre = ''Materia EPT58 A''), ''f5800000-0000-4000-8000-0000000000c2'', NULL)', 'OK']
    ];
    v_caso   TEXT[];
    v_codigo TEXT;
BEGIN
    FOREACH v_caso SLICE 1 IN ARRAY v_casos LOOP
        BEGIN
            EXECUTE v_caso[1];
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        IF v_codigo IS DISTINCT FROM v_caso[2] THEN
            RAISE EXCEPTION 'FALLO CA-07: «%» devolvió %, se esperaba %.', v_caso[1], v_codigo, v_caso[2];
        END IF;
    END LOOP;

    IF (SELECT mc.profesor_id FROM public.materias_cursos mc JOIN public.materias m ON m.id = mc.materia_id
        WHERE m.nombre = 'Materia EPT58 A' AND mc.curso_id = 'f5800000-0000-4000-8000-0000000000c1')
       <> 'f5800000-0000-4000-8000-000000000002' THEN
        RAISE EXCEPTION 'FALLO CA-07: el cambio de responsable rechazado dejó otro profesor.';
    END IF;

    RAISE NOTICE 'OK CA-07: asignación, cambio de responsable y grupo nuevo rechazados para un docente inactivo';
END $$;
RESET ROLE;

-- CA-07 por escritura directa del propietario (servicio o SQL): el trigger
-- rige igual. C se inactiva después de cerrar sus relaciones, y reactivarlas
-- a su nombre se rechaza.
DO $$
DECLARE
    v_codigo TEXT;
BEGIN
    -- B no puede quedar a cargo de un grupo existente.
    BEGIN
        UPDATE public.grupos_deportivos SET profesor_id = 'f5800000-0000-4000-8000-000000000003'
        WHERE id = 'f5800000-0000-4000-8000-0000000000d1';
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> 'P5605' THEN
        RAISE EXCEPTION 'FALLO CA-07: cambiar el profesor de un grupo a un docente inactivo devolvió %.', v_codigo;
    END IF;

    -- Cerrar relaciones de C: su asignación (por la RPC de materias) y su grupo
    -- (no hay RPC de grupos hasta EPT-61).
    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.cambiar_estado_asignacion(
        (SELECT mc.id FROM public.materias_cursos mc JOIN public.materias m ON m.id = mc.materia_id
         WHERE m.nombre = 'Materia EPT58 B' AND mc.curso_id = 'f5800000-0000-4000-8000-0000000000c1'),
        FALSE);
    RESET ROLE;
    UPDATE public.grupos_deportivos SET activo = FALSE WHERE id = 'f5800000-0000-4000-8000-0000000000d2';

    -- Mantener o inactivar relaciones de un docente activo o inactivo nunca se
    -- bloquea; ahora C se puede inactivar.
    SET LOCAL ROLE authenticated;
    PERFORM public.cambiar_estado_profesor('f5800000-0000-4000-8000-000000000004', 'INACTIVO', NULL);

    -- Reactivar la asignación o el grupo con C inactivo se rechaza.
    BEGIN
        PERFORM public.cambiar_estado_asignacion(
            (SELECT mc.id FROM public.materias_cursos mc JOIN public.materias m ON m.id = mc.materia_id
             WHERE m.nombre = 'Materia EPT58 B' AND mc.curso_id = 'f5800000-0000-4000-8000-0000000000c1'),
            TRUE);
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> 'P5605' THEN
        RAISE EXCEPTION 'FALLO CA-07: reactivar una asignación de un docente inactivo devolvió %.', v_codigo;
    END IF;
    RESET ROLE;

    BEGIN
        UPDATE public.grupos_deportivos SET activo = TRUE WHERE id = 'f5800000-0000-4000-8000-0000000000d2';
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> 'P5605' THEN
        RAISE EXCEPTION 'FALLO CA-07: reactivar un grupo de un docente inactivo devolvió %.', v_codigo;
    END IF;

    -- CA-14: las relaciones inactivas se siguen informando, marcadas.
    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000004"}', true);
    SET LOCAL ROLE authenticated;
    IF (SELECT pg_catalog.array_agg(a.tipo || ':' || a.vigente ORDER BY a.tipo)
        FROM public.listar_asignaciones_profesor(NULL) a)
       <> ARRAY['GRUPO_DEPORTIVO:false', 'MATERIA:false']
       OR EXISTS (SELECT 1 FROM public.listar_horarios_profesor(NULL)) THEN
        RAISE EXCEPTION 'FALLO CA-14: las relaciones inactivas no se informan separadas de las vigentes.';
    END IF;
    -- CA-10 (parte de base): el docente inactivo conserva su sesión y ve su ficha.
    IF (SELECT f.estado FROM public.consultar_ficha_profesor(NULL) f) <> 'INACTIVO' THEN
        RAISE EXCEPTION 'FALLO CA-10: el docente inactivo no puede consultar su ficha.';
    END IF;
    RESET ROLE;

    RAISE NOTICE 'OK CA-07/14: guardas por SQL directo, reactivación de asignación y grupo rechazadas; historial de relaciones visible';
END $$;

-- CA-08: reactivar exige ficha completa y rol DOCENTE vigente.
DO $$
DECLARE
    v_codigo TEXT;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000001"}', true);
    SET LOCAL ROLE authenticated;

    -- C tiene legajo pero no especialidad.
    BEGIN
        PERFORM public.cambiar_estado_profesor('f5800000-0000-4000-8000-000000000004', 'ACTIVO');
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> 'P5612' THEN
        RAISE EXCEPTION 'FALLO CA-08: reactivar una ficha incompleta devolvió %.', v_codigo;
    END IF;

    -- Completar una ficha inactiva está permitido.
    PERFORM public.actualizar_ficha_profesor('f5800000-0000-4000-8000-000000000004', 'LEG-EPT58-C', 'Educación Física');

    -- Sin rol DOCENTE vigente (transición simulada; la real es de EPT-59).
    RESET ROLE;
    UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
    WHERE id = 'f5800000-0000-4000-8000-000000000004';
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.cambiar_estado_profesor('f5800000-0000-4000-8000-000000000004', 'ACTIVO');
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> 'P5611' THEN
        RAISE EXCEPTION 'FALLO CA-08: reactivar sin rol DOCENTE devolvió %.', v_codigo;
    END IF;
    IF (SELECT l.rol_docente_vigente FROM public.listar_profesores() l
        WHERE l.perfil_id = 'f5800000-0000-4000-8000-000000000004') THEN
        RAISE EXCEPTION 'FALLO CA-08: el listado no informa la pérdida del rol DOCENTE.';
    END IF;
    RESET ROLE;
    UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'DOCENTE')
    WHERE id = 'f5800000-0000-4000-8000-000000000004';
    SET LOCAL ROLE authenticated;

    -- Completa y DOCENTE: se reactiva, se agrega historial y la asignación
    -- puede volver a quedar a su cargo.
    PERFORM public.cambiar_estado_profesor('f5800000-0000-4000-8000-000000000004', 'ACTIVO', 'Regreso');
    PERFORM public.cambiar_estado_asignacion(
        (SELECT mc.id FROM public.materias_cursos mc JOIN public.materias m ON m.id = mc.materia_id
         WHERE m.nombre = 'Materia EPT58 B' AND mc.curso_id = 'f5800000-0000-4000-8000-0000000000c1'),
        TRUE);

    IF (SELECT pg_catalog.array_agg(h.estado_anterior || '>' || h.estado_nuevo ORDER BY h.id)
        FROM public.listar_historial_estados_profesor('f5800000-0000-4000-8000-000000000004') h)
       <> ARRAY['ACTIVO>INACTIVO', 'INACTIVO>ACTIVO'] THEN
        RAISE EXCEPTION 'FALLO CA-09: el historial de C no conserva los dos cambios en orden.';
    END IF;
    RESET ROLE;

    RAISE NOTICE 'OK CA-08: reactivación exige ficha completa y rol DOCENTE; historial agregado';
END $$;

-- CA-09: el historial es de solo agregado, incluso para el propietario.
DO $$
DECLARE
    v_codigo TEXT;
    v_casos  TEXT[] := ARRAY[
        'UPDATE public.profesores_estados_historial SET motivo = ''Reescrito''',
        'DELETE FROM public.profesores_estados_historial',
        'TRUNCATE public.profesores_estados_historial'
    ];
    v_caso   TEXT;
    v_filas  BIGINT;
BEGIN
    SELECT pg_catalog.count(*) INTO v_filas FROM public.profesores_estados_historial;

    FOREACH v_caso IN ARRAY v_casos LOOP
        BEGIN
            EXECUTE v_caso;
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        IF v_codigo <> 'P5609' THEN
            RAISE EXCEPTION 'FALLO CA-09: «%» como propietario devolvió %, se esperaba P5609.', v_caso, v_codigo;
        END IF;
    END LOOP;

    IF (SELECT pg_catalog.count(*) FROM public.profesores_estados_historial) <> v_filas
       OR EXISTS (SELECT 1 FROM public.profesores_estados_historial WHERE motivo = 'Reescrito') THEN
        RAISE EXCEPTION 'FALLO CA-09: el historial cambió.';
    END IF;

    RAISE NOTICE 'OK CA-09: UPDATE, DELETE y TRUNCATE del historial rechazados también para el propietario';
END $$;


-- ================================================================
-- 8. LECTURA DE PERFILES ANTES Y DESPUÉS DE B (CA-16)
-- ================================================================
-- Con A sola, la política amplia sigue vigente: DOCENTE todavía ve todos los
-- perfiles. Con A+B, solo la propia fila. La sección se adapta al esquema y
-- deja constancia de cuál comprobó.
DO $$
DECLARE
    v_con_b    BOOLEAN;
    v_visibles BIGINT;
    v_total    BIGINT;
    v_codigo   TEXT;
BEGIN
    v_con_b := NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Directores y docentes ven todos los perfiles'
    );
    SELECT pg_catalog.count(*) INTO v_total FROM public.perfiles;

    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000002"}', true);
    SET LOCAL ROLE authenticated;
    BEGIN
        SELECT pg_catalog.count(*) INTO v_visibles FROM public.perfiles;
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    RESET ROLE;

    IF v_codigo <> 'OK' THEN
        RAISE EXCEPTION 'FALLO CA-16: DOCENTE leyendo perfiles recibió % (¿recursión 42P17?).', v_codigo;
    END IF;

    IF v_con_b THEN
        IF v_visibles <> 1 THEN
            RAISE EXCEPTION 'FALLO CA-16: con B, DOCENTE ve % perfiles y debería ver solo el propio.', v_visibles;
        END IF;
        RAISE NOTICE 'OK CA-16 (esquema A+B): DOCENTE ve solo su propio perfil';
    ELSE
        IF v_visibles <> v_total THEN
            RAISE EXCEPTION 'FALLO: con A sola, DOCENTE debería conservar la lectura previa (% de %).', v_visibles, v_total;
        END IF;
        RAISE NOTICE 'OK CA-16 (esquema A): la lectura global de DOCENTE sigue vigente hasta B (% perfiles)', v_visibles;
    END IF;

    -- En ambos esquemas: el padre ve solo su perfil y el de su hijo; el
    -- estudiante, solo el propio.
    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000006"}', true);
    SET LOCAL ROLE authenticated;
    IF (SELECT pg_catalog.array_agg(p.id ORDER BY p.id) FROM public.perfiles p)
       <> ARRAY['f5800000-0000-4000-8000-000000000005'::uuid, 'f5800000-0000-4000-8000-000000000006'::uuid] THEN
        RESET ROLE;
        RAISE EXCEPTION 'FALLO CA-16: la política parental cambió.';
    END IF;
    RESET ROLE;

    PERFORM set_config('request.jwt.claims', '{"sub":"f5800000-0000-4000-8000-000000000005"}', true);
    SET LOCAL ROLE authenticated;
    IF (SELECT pg_catalog.array_agg(p.id) FROM public.perfiles p)
       <> ARRAY['f5800000-0000-4000-8000-000000000005'::uuid] THEN
        RESET ROLE;
        RAISE EXCEPTION 'FALLO CA-16: la política de perfil propio cambió.';
    END IF;
    RESET ROLE;

    RAISE NOTICE 'OK CA-16: perfil propio y política parental intactos';
END $$;

ROLLBACK;
