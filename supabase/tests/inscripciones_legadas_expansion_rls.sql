-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Inscripciones legadas, EXPANSIÓN (EPT-66)
-- ============================================================
-- Ejecutar exclusivamente contra una base local descartable con la cadena de
-- migraciones aplicada HASTA la de expansión (20261002120000). Todo ocurre
-- dentro de una transacción con ROLLBACK: nunca confirma datos.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/inscripciones_legadas_expansion_rls.sql
--
-- Cada comprobación imprime `OK <n>` o aborta con `FALLO <n>`.
--
-- Cubre: autorización por rol (propio, hijo vinculado, hijo ajeno, alumno
-- ajeno, Dirección, DOCENTE, PERSONAL, sin perfil, cuenta bloqueada, anónimo),
-- alta, duplicado, baja lógica con conservación de la fila, reinscripción como
-- fila nueva, cupo, deporte (lógica de EPT-11 intacta), lecturas acotadas,
-- cupo en caminos directos y compatibilidad de la aplicación anterior (que
-- todavía escribe sobre la tabla) con la base ya expandida.

\set ON_ERROR_STOP on

BEGIN;

-- ================================================================
-- ARNÉS DE LA PRUEBA
-- ================================================================
CREATE SCHEMA ept66_t;
GRANT USAGE ON SCHEMA ept66_t TO PUBLIC;

-- Ejecuta `p_sql` con el rol y la identidad indicados y devuelve 'OK' o el
-- SQLSTATE del error. Las escrituras exitosas persisten dentro de la transacción.
CREATE FUNCTION ept66_t.como(p_sub UUID, p_rol TEXT, p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_resultado TEXT;
BEGIN
    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT,
        TRUE);
    EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
    BEGIN
        EXECUTE p_sql;
        v_resultado := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_resultado := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
    RETURN v_resultado;
END;
$$;

-- Igual, pero devuelve el valor escalar (texto) de una consulta o 'ERR:<sqlstate>'.
CREATE FUNCTION ept66_t.valor(p_sub UUID, p_rol TEXT, p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_valor TEXT;
BEGIN
    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT,
        TRUE);
    EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
    BEGIN
        EXECUTE p_sql INTO v_valor;
    EXCEPTION WHEN OTHERS THEN
        v_valor := 'ERR:' || SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
    RETURN v_valor;
END;
$$;

CREATE FUNCTION ept66_t.afirmar(p_numero TEXT, p_obtenido TEXT, p_esperado TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_obtenido IS DISTINCT FROM p_esperado THEN
        RAISE EXCEPTION 'FALLO %: se esperaba «%» y se obtuvo «%»', p_numero, p_esperado, p_obtenido;
    END IF;
    RAISE NOTICE 'OK %', p_numero;
END;
$$;

-- ================================================================
-- DATOS SINTÉTICOS (rango de DNI reservado 97…, nunca datos reales)
-- ================================================================
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT v.id, v.id, r.id, 'Prueba', v.apellido, v.dni, v.legajo
FROM (VALUES
    ('a6600000-0000-4000-8000-000000000001'::UUID, 'DIRECTOR',   'Directora',   '97660001', NULL),
    ('a6600000-0000-4000-8000-000000000002'::UUID, 'ESTUDIANTE', 'Propio',      '97660002', 'LEG-66-02'),
    ('a6600000-0000-4000-8000-000000000003'::UUID, 'ESTUDIANTE', 'Ajeno',       '97660003', 'LEG-66-03'),
    ('a6600000-0000-4000-8000-000000000004'::UUID, 'PADRE',      'Vinculado',   '97660004', NULL),
    ('a6600000-0000-4000-8000-000000000005'::UUID, 'PADRE',      'SinHijos',    '97660005', NULL),
    ('a6600000-0000-4000-8000-000000000006'::UUID, 'DOCENTE',    'Docente',     '97660006', NULL),
    ('a6600000-0000-4000-8000-000000000007'::UUID, 'PERSONAL',   'Personal',    '97660007', NULL),
    ('a6600000-0000-4000-8000-000000000008'::UUID, 'ESTUDIANTE', 'Bloqueado',   '97660008', 'LEG-66-08'),
    ('a6600000-0000-4000-8000-000000000009'::UUID, 'PADRE',      'Bloqueado',   '97660009', NULL),
    ('a6600000-0000-4000-8000-000000000010'::UUID, 'ESTUDIANTE', 'Hermano',     '97660010', 'LEG-66-10')
) AS v(id, rol, apellido, dni, legajo)
JOIN public.roles r ON r.nombre = v.rol;

-- El padre 04 está vinculado a los estudiantes 02 y 10; el padre 05, a ninguno.
INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES
    ('a6600000-0000-4000-8000-000000000004', 'a6600000-0000-4000-8000-000000000002'),
    ('a6600000-0000-4000-8000-000000000004', 'a6600000-0000-4000-8000-000000000010');

UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO'
WHERE id IN ('a6600000-0000-4000-8000-000000000008', 'a6600000-0000-4000-8000-000000000009');

-- Actividades: T1 con un solo lugar, T2 con dos, un deporte y una inactiva.
INSERT INTO public.actividades (id, nombre, tipo, cupo_maximo, activo) VALUES
    (96601, 'Taller EPT-66 de un lugar', 'TALLER', 1, TRUE),
    (96602, 'Taller EPT-66 de dos lugares', 'TALLER', 2, TRUE),
    (96603, 'Deporte EPT-66', 'DEPORTE', 5, TRUE),
    (96604, 'Taller EPT-66 inactivo', 'TALLER', 5, FALSE),
    (96605, 'Taller EPT-66 de la app anterior', 'TALLER', 5, TRUE);

-- Una inscripción legada previa, con baja anterior a EPT-66 (sin fecha_baja).
INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado)
VALUES ('b6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000003', 96602, 'BAJA');

CREATE TEMPORARY TABLE ept66_huella_previa ON COMMIT DROP AS
SELECT id, estudiante_id, actividad_id, estado, fecha_inscripcion
FROM public.inscripciones WHERE id = 'b6600000-0000-4000-8000-000000000001';

-- Atajos
CREATE FUNCTION ept66_t.dir() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000001'::UUID $$;
CREATE FUNCTION ept66_t.propio() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000002'::UUID $$;
CREATE FUNCTION ept66_t.ajeno() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000003'::UUID $$;
CREATE FUNCTION ept66_t.padre() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000004'::UUID $$;
CREATE FUNCTION ept66_t.padre_sin_hijos() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000005'::UUID $$;
CREATE FUNCTION ept66_t.docente() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000006'::UUID $$;
CREATE FUNCTION ept66_t.personal() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000007'::UUID $$;
CREATE FUNCTION ept66_t.alumno_bloqueado() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000008'::UUID $$;
CREATE FUNCTION ept66_t.padre_bloqueado() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000009'::UUID $$;
CREATE FUNCTION ept66_t.hermano() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000010'::UUID $$;
CREATE FUNCTION ept66_t.sin_perfil() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-0000000000ff'::UUID $$;

-- ================================================================
-- 1. ESTRUCTURA Y PRIVILEGIOS DE LA EXPANSIÓN
-- ================================================================
SELECT ept66_t.afirmar('1a columna fecha_baja existe',
    (SELECT pg_catalog.count(*)::TEXT FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'inscripciones' AND column_name = 'fecha_baja'), '1');
SELECT ept66_t.afirmar('1b índice único parcial de la inscripción activa',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_inscripciones_una_activa'
       AND indexdef LIKE '%WHERE%ACTIVO%'), '1');
SELECT ept66_t.afirmar('1c la restricción única completa ya no existe',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.pg_constraint
     WHERE conname = 'inscripciones_estudiante_id_actividad_id_key'), '0');
SELECT ept66_t.afirmar('1d cada función nueva fija search_path vacío',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname IN ('inscribir_actividad_legada', 'dar_baja_inscripcion_legada',
                         'listar_inscripciones_actividades_legadas',
                         'listar_inscriptos_actividad_legada',
                         'consultar_cupos_actividades_legadas',
                         'autorizar_inscripcion_legada', 'verificar_cupo_actividad',
                         'calcular_porcentaje_asistencia')
       AND n.nspname IN ('public', 'app_private')
       AND p.proconfig @> ARRAY['search_path=""']::TEXT[]), '13');
SELECT ept66_t.afirmar('1e anon no ejecuta ninguna función nueva ni calcular_porcentaje_asistencia',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'app_private')
       AND p.proname IN ('inscribir_actividad_legada', 'dar_baja_inscripcion_legada',
                         'listar_inscripciones_actividades_legadas',
                         'listar_inscriptos_actividad_legada',
                         'consultar_cupos_actividades_legadas',
                         'autorizar_inscripcion_legada', 'verificar_cupo_actividad',
                         'calcular_porcentaje_asistencia')
       AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')), '0');
SELECT ept66_t.afirmar('1f authenticated no ejecuta verificar_cupo_actividad ni la autorización interna',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname IN ('verificar_cupo_actividad', 'autorizar_inscripcion_legada')
       AND n.nspname IN ('public', 'app_private')
       AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')), '0');
SELECT ept66_t.afirmar('1g la aplicación anterior conserva sus privilegios sobre la tabla',
    (pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'INSERT')
     AND pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'UPDATE')
     AND pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'DELETE'))::TEXT, 'true');

-- ================================================================
-- 2. ALUMNO PROPIO: ALTA, DUPLICADO, BAJA LÓGICA, REINSCRIPCIÓN
-- ================================================================
SELECT ept66_t.afirmar('2a el alumno se inscribe a sí mismo',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), 'OK');
SELECT ept66_t.afirmar('2b queda una inscripción ACTIVO sin fecha de baja',
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones
     WHERE estudiante_id = ept66_t.propio() AND actividad_id = 96602
       AND estado = 'ACTIVO' AND fecha_baja IS NULL), '1');
SELECT ept66_t.afirmar('2c una segunda alta de la misma actividad es duplicado (23505)',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), '23505');

-- Baja lógica por la función: la fila se conserva con el mismo id.
CREATE TEMPORARY TABLE ept66_ids (clave TEXT PRIMARY KEY, id UUID) ON COMMIT DROP;
GRANT ALL ON ept66_ids TO PUBLIC;
INSERT INTO ept66_ids SELECT 'primera', id FROM public.inscripciones
WHERE estudiante_id = ept66_t.propio() AND actividad_id = 96602 AND estado = 'ACTIVO';

SELECT ept66_t.afirmar('2d el alumno da de baja su propia inscripción',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            (SELECT id FROM ept66_ids WHERE clave = 'primera'))), 'OK');
SELECT ept66_t.afirmar('2e la fila sigue existiendo como BAJA con fecha_baja (baja lógica)',
    (SELECT (estado = 'BAJA' AND fecha_baja IS NOT NULL)::TEXT FROM public.inscripciones
     WHERE id = (SELECT id FROM ept66_ids WHERE clave = 'primera')), 'true');
SELECT ept66_t.afirmar('2f dar de baja dos veces es un error explícito (P6607)',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            (SELECT id FROM ept66_ids WHERE clave = 'primera'))), 'P6607');
SELECT ept66_t.afirmar('2g la reinscripción es posible tras la baja',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), 'OK');
SELECT ept66_t.afirmar('2h la reinscripción CREA una fila nueva: dos filas, una ACTIVO y una BAJA',
    (SELECT pg_catalog.count(*)::TEXT || '/' ||
            pg_catalog.count(*) FILTER (WHERE estado = 'ACTIVO')::TEXT || '/' ||
            pg_catalog.count(*) FILTER (WHERE estado = 'BAJA')::TEXT
     FROM public.inscripciones
     WHERE estudiante_id = ept66_t.propio() AND actividad_id = 96602), '2/1/1');
SELECT ept66_t.afirmar('2i la fila histórica BAJA no se reciclo: mismo id, sigue BAJA',
    (SELECT estado FROM public.inscripciones
     WHERE id = (SELECT id FROM ept66_ids WHERE clave = 'primera')), 'BAJA');

-- ================================================================
-- 3. PADRE: HIJO VINCULADO VS HIJO AJENO
-- ================================================================
SELECT ept66_t.afirmar('3a el padre inscribe a su hijo vinculado',
    ept66_t.como(ept66_t.padre(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.hermano())), 'OK');
SELECT ept66_t.afirmar('3b el padre lee las inscripciones de su hijo vinculado',
    ept66_t.valor(ept66_t.padre(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L)$q$, ept66_t.hermano())), '1');
SELECT ept66_t.afirmar('3c el padre NO inscribe a un alumno no vinculado (P6602)',
    ept66_t.como(ept66_t.padre(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.ajeno())), 'P6602');
SELECT ept66_t.afirmar('3d el padre NO lee las inscripciones de un alumno no vinculado (P6602)',
    ept66_t.valor(ept66_t.padre(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L)$q$, ept66_t.ajeno())), 'ERR:P6602');
SELECT ept66_t.afirmar('3e un padre sin hijos no inscribe a nadie (P6602)',
    ept66_t.como(ept66_t.padre_sin_hijos(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), 'P6602');
SELECT ept66_t.afirmar('3f el padre da de baja a su hijo vinculado',
    ept66_t.como(ept66_t.padre(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            (SELECT id FROM public.inscripciones
             WHERE estudiante_id = ept66_t.hermano() AND actividad_id = 96602 AND estado = 'ACTIVO'))), 'OK');
SELECT ept66_t.afirmar('3g el padre NO da de baja una inscripción de un hijo ajeno (P6602, igual que una inexistente)',
    ept66_t.como(ept66_t.padre(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            'b6600000-0000-4000-8000-000000000001'::UUID)), 'P6602');
SELECT ept66_t.afirmar('3h baja de una inscripción inexistente: mismo error (P6602)',
    ept66_t.como(ept66_t.padre(), 'authenticated',
        $q$SELECT public.dar_baja_inscripcion_legada('b6600000-0000-4000-8000-0000000000aa')$q$), 'P6602');

-- ================================================================
-- 4. ALUMNO AJENO
-- ================================================================
SELECT ept66_t.afirmar('4a un alumno NO inscribe a otro alumno (P6602)',
    ept66_t.como(ept66_t.ajeno(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), 'P6602');
SELECT ept66_t.afirmar('4b un alumno NO lee las inscripciones de otro (P6602)',
    ept66_t.valor(ept66_t.ajeno(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L)$q$, ept66_t.propio())), 'ERR:P6602');
SELECT ept66_t.afirmar('4c un alumno NO da de baja la inscripción de otro (P6602)',
    ept66_t.como(ept66_t.ajeno(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            (SELECT id FROM public.inscripciones
             WHERE estudiante_id = ept66_t.propio() AND actividad_id = 96602 AND estado = 'ACTIVO'))), 'P6602');
SELECT ept66_t.afirmar('4d la inscripción del alumno propio sigue ACTIVO tras los intentos ajenos',
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones
     WHERE estudiante_id = ept66_t.propio() AND actividad_id = 96602 AND estado = 'ACTIVO'), '1');

-- ================================================================
-- 5. DIRECCIÓN
-- ================================================================
SELECT ept66_t.afirmar('5a Dirección inscribe a un alumno',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96601)$q$, ept66_t.ajeno())), 'OK');
SELECT ept66_t.afirmar('5b Dirección lista las inscripciones de cualquier alumno',
    ept66_t.valor(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L, TRUE)$q$, ept66_t.ajeno())), '2');
SELECT ept66_t.afirmar('5c Dirección lista los inscriptos de una actividad',
    ept66_t.valor(ept66_t.dir(), 'authenticated',
        $q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscriptos_actividad_legada(96601)$q$), '1');
SELECT ept66_t.afirmar('5d Dirección da de baja',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            (SELECT id FROM public.inscripciones
             WHERE estudiante_id = ept66_t.ajeno() AND actividad_id = 96601 AND estado = 'ACTIVO'))), 'OK');
SELECT ept66_t.afirmar('5e Dirección no inscribe a un perfil que no es estudiante (P6602)',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.docente())), 'P6602');

-- ================================================================
-- 6. DOCENTE, PERSONAL, SIN PERFIL, BLOQUEADOS, ANÓNIMO
-- ================================================================
SELECT ept66_t.afirmar('6a DOCENTE no inscribe a ningún alumno (42501)',
    ept66_t.como(ept66_t.docente(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('6b DOCENTE no lee inscripciones (42501)',
    ept66_t.valor(ept66_t.docente(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L)$q$, ept66_t.propio())), 'ERR:42501');
SELECT ept66_t.afirmar('6c DOCENTE no da de baja (42501)',
    ept66_t.como(ept66_t.docente(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            (SELECT id FROM public.inscripciones
             WHERE estudiante_id = ept66_t.propio() AND actividad_id = 96602 AND estado = 'ACTIVO'))), '42501');
SELECT ept66_t.afirmar('6d DOCENTE no lista inscriptos de una actividad (42501)',
    ept66_t.valor(ept66_t.docente(), 'authenticated',
        $q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscriptos_actividad_legada(96602)$q$), 'ERR:42501');
SELECT ept66_t.afirmar('6e PERSONAL no inscribe (42501)',
    ept66_t.como(ept66_t.personal(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('6f PERSONAL no lee inscripciones (42501)',
    ept66_t.valor(ept66_t.personal(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L)$q$, ept66_t.propio())), 'ERR:42501');
SELECT ept66_t.afirmar('6g una sesión sin perfil no inscribe (42501)',
    ept66_t.como(ept66_t.sin_perfil(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('6h un alumno BLOQUEADO no se inscribe (42501)',
    ept66_t.como(ept66_t.alumno_bloqueado(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.alumno_bloqueado())), '42501');
SELECT ept66_t.afirmar('6i un padre BLOQUEADO no inscribe a su hijo (42501)',
    ept66_t.como(ept66_t.padre_bloqueado(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.hermano())), '42501');
SELECT ept66_t.afirmar('6j una cuenta bloqueada no consulta cupos (42501)',
    ept66_t.valor(ept66_t.alumno_bloqueado(), 'authenticated',
        $q$SELECT pg_catalog.count(*)::TEXT FROM public.consultar_cupos_actividades_legadas()$q$), 'ERR:42501');
SELECT ept66_t.afirmar('6k el anónimo no puede ejecutar el alta (permiso denegado 42501)',
    ept66_t.como(NULL, 'anon',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('6l el anónimo no puede ejecutar la baja (42501)',
    ept66_t.como(NULL, 'anon',
        $q$SELECT public.dar_baja_inscripcion_legada('b6600000-0000-4000-8000-000000000001')$q$), '42501');
SELECT ept66_t.afirmar('6m el anónimo no puede listar (42501)',
    ept66_t.como(NULL, 'anon',
        pg_catalog.format($q$SELECT * FROM public.listar_inscripciones_actividades_legadas(%L)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('6n el anónimo no puede consultar cupos (42501)',
    ept66_t.como(NULL, 'anon', $q$SELECT * FROM public.consultar_cupos_actividades_legadas()$q$), '42501');
SELECT ept66_t.afirmar('6o el anónimo no ejecuta calcular_porcentaje_asistencia (42501)',
    ept66_t.como(NULL, 'anon',
        pg_catalog.format($q$SELECT public.calcular_porcentaje_asistencia(%L)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('6p una sesión autenticada sí ejecuta calcular_porcentaje_asistencia',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$SELECT public.calcular_porcentaje_asistencia(%L)$q$, ept66_t.propio())), 'OK');
SELECT ept66_t.afirmar('6q nadie de la aplicación ejecuta verificar_cupo_actividad directamente (42501)',
    ept66_t.como(ept66_t.dir(), 'authenticated', $q$SELECT public.verificar_cupo_actividad()$q$), '42501');

-- ================================================================
-- 7. CUPO, DEPORTE, ACTIVIDAD INACTIVA E INEXISTENTE
-- ================================================================
-- T1 (96601) tiene un lugar y ahora está libre (5d). Un alumno la ocupa y otro no puede.
SELECT ept66_t.afirmar('7a el alumno propio ocupa el único lugar',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96601)$q$, ept66_t.propio())), 'OK');
SELECT ept66_t.afirmar('7b otro alumno recibe cupo completo (check_violation 23514)',
    ept66_t.como(ept66_t.ajeno(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96601)$q$, ept66_t.ajeno())), '23514');
SELECT ept66_t.afirmar('7c tras una baja, el lugar se libera para otro alumno',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.dar_baja_inscripcion_legada(%L)$q$,
            (SELECT id FROM public.inscripciones
             WHERE estudiante_id = ept66_t.propio() AND actividad_id = 96601 AND estado = 'ACTIVO'))), 'OK');
SELECT ept66_t.afirmar('7d el otro alumno ya puede inscribirse',
    ept66_t.como(ept66_t.ajeno(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96601)$q$, ept66_t.ajeno())), 'OK');
SELECT ept66_t.afirmar('7e jamás hay más ACTIVO que el cupo',
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE actividad_id = 96601 AND estado = 'ACTIVO'), '1');
SELECT ept66_t.afirmar('7f deporte: se rechaza con el código de EPT-11 (P5582)',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96603)$q$, ept66_t.propio())), 'P5582');
SELECT ept66_t.afirmar('7g actividad inactiva (P6604)',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96604)$q$, ept66_t.propio())), 'P6604');
SELECT ept66_t.afirmar('7h actividad inexistente (P6603)',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96699)$q$, ept66_t.propio())), 'P6603');

-- ================================================================
-- 8. LECTURAS ACOTADAS
-- ================================================================
SELECT ept66_t.afirmar('8a el alumno lista solo lo suyo, sin el historial por defecto',
    ept66_t.valor(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L)$q$, ept66_t.propio())), '1');
SELECT ept66_t.afirmar('8b con p_incluir_bajas aparece el historial (2 bajas + 1 activa)',
    ept66_t.valor(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L, TRUE)$q$, ept66_t.propio())), '3');
SELECT ept66_t.afirmar('8c los cupos devuelven solo actividad_id e inscriptos (sin pares alumno–actividad)',
    pg_catalog.pg_get_function_result('public.consultar_cupos_actividades_legadas()'::pg_catalog.regprocedure),
    'TABLE(actividad_id integer, inscriptos integer)');
SELECT ept66_t.afirmar('8d cualquier cuenta habilitada consulta los cupos agregados',
    ept66_t.valor(ept66_t.docente(), 'authenticated',
        $q$SELECT (pg_catalog.count(*) > 0)::TEXT FROM public.consultar_cupos_actividades_legadas()$q$), 'true');
SELECT ept66_t.afirmar('8e el cupo agregado de T2 coincide con las inscripciones activas',
    ept66_t.valor(ept66_t.propio(), 'authenticated',
        $q$SELECT inscriptos::TEXT FROM public.consultar_cupos_actividades_legadas() WHERE actividad_id = 96602$q$),
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE actividad_id = 96602 AND estado = 'ACTIVO'));
SELECT ept66_t.afirmar('8f solo Dirección lista los inscriptos de una actividad (el alumno recibe 42501)',
    ept66_t.valor(ept66_t.propio(), 'authenticated',
        $q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscriptos_actividad_legada(96602)$q$), 'ERR:42501');

-- ================================================================
-- 9. CUPO TAMBIÉN EN LOS CAMINOS DIRECTOS (sin pasar por las funciones)
-- ================================================================
-- Se prepara T1 llena: ya hay una inscripción ACTIVO de `ajeno` (7d).
SELECT ept66_t.afirmar('9a alta directa por SQL sobre una actividad llena: 23514 (la aplicación anterior sigue protegida)',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$INSERT INTO public.inscripciones (estudiante_id, actividad_id) VALUES (%L, 96601)$q$, ept66_t.propio())), '23514');
-- Una baja directa y una reactivación directa de la fila histórica ya no pueden saltarse el cupo.
INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado, fecha_baja)
VALUES ('b6600000-0000-4000-8000-000000000002', ept66_t.hermano(), 96601, 'BAJA', pg_catalog.now());
SELECT ept66_t.afirmar('9b reactivar por UPDATE directo una fila BAJA con la actividad llena: 23514',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        $q$UPDATE public.inscripciones SET estado = 'ACTIVO', fecha_baja = NULL WHERE id = 'b6600000-0000-4000-8000-000000000002'$q$), '23514');
SELECT ept66_t.afirmar('9c cambiar por UPDATE directo la actividad de una fila ACTIVO hacia una actividad llena: 23514',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$UPDATE public.inscripciones SET actividad_id = 96601 WHERE estudiante_id = %L AND actividad_id = 96602 AND estado = 'ACTIVO'$q$, ept66_t.propio())), '23514');
SELECT ept66_t.afirmar('9d la restricción de coherencia impide fecha_baja en una fila ACTIVO (23514)',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        $q$UPDATE public.inscripciones SET fecha_baja = pg_catalog.now() WHERE estado = 'ACTIVO' AND actividad_id = 96601$q$), '23514');

-- ================================================================
-- 10. LÓGICA DEPORTIVA DE EPT-11 INTACTA
-- ================================================================
SELECT ept66_t.afirmar('10a alta directa sobre un DEPORTE sigue rechazada (P5582)',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$INSERT INTO public.inscripciones (estudiante_id, actividad_id) VALUES (%L, 96603)$q$, ept66_t.propio())), 'P5582');
-- Fila histórica deportiva (creada antes de EPT-11): se siembra sin disparar triggers.
SET LOCAL session_replication_role = replica;
INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado)
VALUES ('b6600000-0000-4000-8000-000000000003', ept66_t.ajeno(), 96603, 'ACTIVO');
SET LOCAL session_replication_role = origin;
SELECT ept66_t.afirmar('10b la baja de una inscripción deportiva histórica sigue rechazada (P5582)',
    ept66_t.como(ept66_t.dir(), 'authenticated',
        $q$SELECT public.dar_baja_inscripcion_legada('b6600000-0000-4000-8000-000000000003')$q$), 'P5582');

-- ================================================================
-- 11. COMPATIBILIDAD CON LA APLICACIÓN ANTERIOR (base ya expandida)
-- ================================================================
-- La aplicación anterior da de baja con UPDATE, vuelve a inscribir con
-- DELETE de la fila BAJA + INSERT y cuenta con SELECT. Todo debe seguir
-- funcionando hasta la contracción.
SELECT ept66_t.afirmar('11a app anterior: el alumno se inscribe con INSERT directo',
    ept66_t.como(ept66_t.hermano(), 'authenticated',
        pg_catalog.format($q$INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado) VALUES (%L, 96605, 'ACTIVO')$q$, ept66_t.hermano())), 'OK');
SELECT ept66_t.afirmar('11b app anterior: Dirección da de baja con UPDATE a BAJA (modifica una fila)',
    ept66_t.valor(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$WITH m AS (UPDATE public.inscripciones SET estado = 'BAJA' WHERE estudiante_id = %L AND actividad_id = 96605 AND estado = 'ACTIVO' RETURNING 1) SELECT pg_catalog.count(*)::TEXT FROM m$q$, ept66_t.hermano())), '1');
SELECT ept66_t.afirmar('11c app anterior: reinscripción borrando la fila BAJA y reinsertando',
    ept66_t.como(ept66_t.hermano(), 'authenticated',
        pg_catalog.format($q$WITH borrada AS (DELETE FROM public.inscripciones WHERE estudiante_id = %L AND actividad_id = 96605 AND estado = 'BAJA' RETURNING 1)
                             INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado) VALUES (%L, 96605, 'ACTIVO')$q$,
                          ept66_t.hermano(), ept66_t.hermano())), 'OK');
SELECT ept66_t.afirmar('11d1 app anterior: el alumno se da de baja con DELETE de su propia fila (la contracción lo cierra)',
    ept66_t.valor(ept66_t.hermano(), 'authenticated',
        pg_catalog.format($q$WITH m AS (DELETE FROM public.inscripciones WHERE estudiante_id = %L AND actividad_id = 96605 AND estado = 'ACTIVO' RETURNING 1) SELECT pg_catalog.count(*)::TEXT FROM m$q$, ept66_t.hermano())), '1');
SELECT ept66_t.afirmar('11d2 app anterior: el alumno vuelve a inscribirse',
    ept66_t.como(ept66_t.hermano(), 'authenticated',
        pg_catalog.format($q$INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado) VALUES (%L, 96605, 'ACTIVO')$q$, ept66_t.hermano())), 'OK');
SELECT ept66_t.afirmar('11d app anterior: duplicado activo sigue siendo 23505',
    ept66_t.como(ept66_t.hermano(), 'authenticated',
        pg_catalog.format($q$INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado) VALUES (%L, 96605, 'ACTIVO')$q$, ept66_t.hermano())), '23505');
SELECT ept66_t.afirmar('11e app anterior: el conteo por SELECT sigue funcionando',
    ept66_t.valor(ept66_t.hermano(), 'authenticated',
        $q$SELECT (pg_catalog.count(*) > 0)::TEXT FROM public.inscripciones WHERE actividad_id = 96605 AND estado = 'ACTIVO'$q$), 'true');

-- ================================================================
-- 12. LA FILA LEGADA PREVIA SOBREVIVE INTACTA
-- ================================================================
SELECT ept66_t.afirmar('12a la fila anterior a EPT-66 no cambió',
    (SELECT (i.id = h.id AND i.estudiante_id = h.estudiante_id AND i.actividad_id = h.actividad_id
             AND i.estado = h.estado AND i.fecha_inscripcion = h.fecha_inscripcion
             AND i.fecha_baja IS NULL)::TEXT
     FROM public.inscripciones i JOIN ept66_huella_previa h USING (id)), 'true');

ROLLBACK;
