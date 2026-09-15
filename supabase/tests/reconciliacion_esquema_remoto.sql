-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de la reconciliación 011
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
VALUES
    ('a1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111',
     (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'), 'Prueba', 'Directora', '92000001'),
    ('a2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222',
     (SELECT id FROM public.roles WHERE nombre = 'DOCENTE'), 'Prueba', 'Docente', '92000002'),
    ('a3333333-3333-4333-8333-333333333333', 'a3333333-3333-4333-8333-333333333333',
     (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Prueba', 'Estudiante', '92000003'),
    ('a4444444-4444-4444-8444-444444444444', 'a4444444-4444-4444-8444-444444444444',
     (SELECT id FROM public.roles WHERE nombre = 'PADRE'), 'Prueba', 'Padre', '92000004'),
    ('a5555555-5555-4555-8555-555555555555', 'a5555555-5555-4555-8555-555555555555',
     (SELECT id FROM public.roles WHERE nombre = 'PERSONAL'), 'Prueba', 'Personal', '92000005');

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES ('a4444444-4444-4444-8444-444444444444', 'a3333333-3333-4333-8333-333333333333');

-- ================================================================
-- 1. ESTRUCTURA, FUNCIONES Y PRIVILEGIOS
-- ================================================================
DO $$
DECLARE
    v_config TEXT[];
    v_privilegio TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'opiniones'
          AND column_name = 'aprobado' AND data_type = 'boolean'
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'FALLO 1: opiniones.aprobado no respeta el contrato';
    END IF;
    RAISE NOTICE 'OK 1: opiniones.aprobado es booleano, obligatorio y persistente';

    IF pg_catalog.to_regclass('public.padres_hijos') IS NULL THEN
        RAISE EXCEPTION 'FALLO 2: falta public.padres_hijos';
    END IF;
    RAISE NOTICE 'OK 2: public.padres_hijos existe';

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.padres_hijos'::regclass
          AND conname = 'padres_hijos_pkey' AND contype = 'p'
    ) THEN
        RAISE EXCEPTION 'FALLO 3: falta la clave primaria compuesta';
    END IF;
    RAISE NOTICE 'OK 3: el vínculo tiene clave primaria compuesta';

    IF (SELECT COUNT(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.padres_hijos'::regclass
          AND contype = 'f' AND confrelid = 'public.perfiles'::regclass
          AND confdeltype = 'c') <> 2 THEN
        RAISE EXCEPTION 'FALLO 4: las dos claves foráneas no conservan el contrato remoto';
    END IF;
    RAISE NOTICE 'OK 4: ambas claves foráneas apuntan a perfiles con ON DELETE CASCADE';

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = 'public.padres_hijos'::regclass
          AND c.relname = 'idx_padres_hijos_hijo_id'
          AND i.indisvalid
    ) THEN
        RAISE EXCEPTION 'FALLO 4bis: falta el índice de la clave foránea hijo_id';
    END IF;
    RAISE NOTICE 'OK 4bis: hijo_id tiene un índice para relaciones y políticas RLS';

    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.padres_hijos'::regclass) THEN
        RAISE EXCEPTION 'FALLO 5: padres_hijos no tiene RLS';
    END IF;
    RAISE NOTICE 'OK 5: padres_hijos tiene RLS habilitado';

    SELECT p.proconfig INTO v_config
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname = 'mis_hijos_ids';

    IF v_config IS DISTINCT FROM ARRAY['search_path=""'] THEN
        RAISE EXCEPTION 'FALLO 6: la función privada no fija search_path vacío: %', v_config;
    END IF;
    RAISE NOTICE 'OK 6: app_private.mis_hijos_ids fija search_path vacío';

    IF pg_catalog.to_regprocedure('public.mis_hijos_ids()') IS NOT NULL
       OR pg_catalog.to_regprocedure('public.is_director()') IS NOT NULL
       OR pg_catalog.to_regprocedure('public.is_director_or_docente()') IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 7: subsiste una función privilegiada histórica en public';
    END IF;
    RAISE NOTICE 'OK 7: no quedan funciones SECURITY DEFINER históricas en public';

    IF pg_catalog.has_function_privilege('anon', 'app_private.mis_hijos_ids()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', 'app_private.mis_hijos_ids()', 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', 'app_private.mis_hijos_ids()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALLO 8: permisos incorrectos sobre la función privada';
    END IF;
    RAISE NOTICE 'OK 8: solo authenticated puede ejecutar la función privada';

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('actividades', 'asistencias', 'inscripciones', 'perfiles')
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'FALLO 9: subsiste una política ALL';
    END IF;
    RAISE NOTICE 'OK 9: no quedan políticas ALL en las tablas reconciliadas';

    FOREACH v_privilegio IN ARRAY ARRAY['INSERT','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege('authenticated', 'public.actividades', v_privilegio)
           OR pg_catalog.has_table_privilege('anon', 'public.actividades', v_privilegio) THEN
            RAISE EXCEPTION 'FALLO 10: actividades conserva %', v_privilegio;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK 10: actividades no permite alta, borrado ni privilegios residuales';

    IF NOT pg_catalog.has_column_privilege('authenticated', 'public.actividades', 'cupo_maximo', 'UPDATE')
       OR pg_catalog.has_column_privilege('authenticated', 'public.actividades', 'nombre', 'UPDATE')
       OR pg_catalog.has_table_privilege('anon', 'public.actividades', 'UPDATE') THEN
        RAISE EXCEPTION 'FALLO 11: UPDATE de actividades no está limitado al cupo';
    END IF;
    RAISE NOTICE 'OK 11: solo cupo_maximo admite UPDATE autenticado';

    IF pg_catalog.has_sequence_privilege('anon', 'public.actividades_id_seq', 'USAGE')
       OR pg_catalog.has_sequence_privilege('authenticated', 'public.actividades_id_seq', 'USAGE') THEN
        RAISE EXCEPTION 'FALLO 12: la secuencia de actividades sigue expuesta';
    END IF;
    RAISE NOTICE 'OK 12: la secuencia de actividades está cerrada';

    IF NOT pg_catalog.has_column_privilege('anon', 'public.opiniones', 'comentario', 'INSERT')
       OR pg_catalog.has_column_privilege('anon', 'public.opiniones', 'id', 'INSERT')
       OR pg_catalog.has_column_privilege('anon', 'public.opiniones', 'aprobado', 'INSERT') THEN
        RAISE EXCEPTION 'FALLO 12bis: el alta pública de opiniones permite columnas indebidas';
    END IF;
    RAISE NOTICE 'OK 12bis: el alta pública de opiniones se limita a nombre y comentario';

    FOREACH v_privilegio IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
        IF pg_catalog.has_table_privilege('anon', 'public.padres_hijos', v_privilegio) THEN
            RAISE EXCEPTION 'FALLO 13: anon conserva % sobre padres_hijos', v_privilegio;
        END IF;
    END LOOP;
    FOREACH v_privilegio IN ARRAY ARRAY['UPDATE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege('authenticated', 'public.padres_hijos', v_privilegio) THEN
            RAISE EXCEPTION 'FALLO 13: authenticated conserva % sobre padres_hijos', v_privilegio;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK 13: padres_hijos tiene privilegios mínimos';

    FOREACH v_privilegio IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
        IF pg_catalog.has_table_privilege('anon', 'public.perfiles', v_privilegio) THEN
            RAISE EXCEPTION 'FALLO 14: anon conserva % sobre perfiles', v_privilegio;
        END IF;
    END LOOP;
    FOREACH v_privilegio IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege('authenticated', 'public.perfiles', v_privilegio) THEN
            RAISE EXCEPTION 'FALLO 14: authenticated conserva % sobre perfiles', v_privilegio;
        END IF;
    END LOOP;
    IF NOT pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'nombre', 'UPDATE')
       OR pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'id', 'UPDATE')
       OR pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'user_id', 'UPDATE')
       OR pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'rol_id', 'UPDATE') THEN
        RAISE EXCEPTION 'FALLO 14: UPDATE de perfiles no quedó limitado a datos editables';
    END IF;
    RAISE NOTICE 'OK 14: perfiles permite lectura, alta y edición acotada sin borrado';
END $$;

-- ================================================================
-- 2. ACTIVIDADES: LECTURA PÚBLICA Y ESCRITURA ACOTADA
-- ================================================================
SET LOCAL ROLE anon;
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.actividades) = 0 THEN
        RAISE EXCEPTION 'FALLO 15: anon perdió la lectura de actividades';
    END IF;
    RAISE NOTICE 'OK 15: anon conserva la lectura pública de actividades';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a3333333-3333-4333-8333-333333333333"}', true);

DO $$
DECLARE
    v_id INTEGER := (SELECT MIN(id) FROM public.actividades);
    v_antes INTEGER;
    v_despues INTEGER;
BEGIN
    SELECT cupo_maximo INTO v_antes FROM public.actividades WHERE id = v_id;
    UPDATE public.actividades SET cupo_maximo = cupo_maximo + 1 WHERE id = v_id;
    SELECT cupo_maximo INTO v_despues FROM public.actividades WHERE id = v_id;
    IF v_despues <> v_antes THEN
        RAISE EXCEPTION 'FALLO 16: un estudiante modificó el cupo';
    END IF;
    RAISE NOTICE 'OK 16: un estudiante no puede modificar el cupo';

    BEGIN
        UPDATE public.actividades SET nombre = nombre || ' alterada' WHERE id = v_id;
        RAISE EXCEPTION 'FALLO 17: un estudiante modificó el nombre';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 17: ni siquiera existe privilegio de columna para cambiar el nombre';
    END;

    BEGIN
        INSERT INTO public.actividades (nombre, tipo, cupo_maximo) VALUES ('Prohibida', 'TALLER', 10);
        RAISE EXCEPTION 'FALLO 18: un estudiante insertó una actividad';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 18: INSERT directo está denegado';
    END;

    BEGIN
        DELETE FROM public.actividades WHERE id = v_id;
        RAISE EXCEPTION 'FALLO 19: un estudiante borró una actividad';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 19: DELETE directo está denegado';
    END;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a1111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    v_id INTEGER := (SELECT MIN(id) FROM public.actividades);
    v_antes INTEGER;
BEGIN
    SELECT cupo_maximo INTO v_antes FROM public.actividades WHERE id = v_id;
    UPDATE public.actividades SET cupo_maximo = cupo_maximo + 1 WHERE id = v_id;
    IF (SELECT cupo_maximo FROM public.actividades WHERE id = v_id) <> v_antes + 1 THEN
        RAISE EXCEPTION 'FALLO 20: el director no pudo modificar el cupo';
    END IF;
    RAISE NOTICE 'OK 20: el director puede modificar únicamente el cupo';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a2222222-2222-4222-8222-222222222222"}', true);

DO $$
DECLARE
    v_id INTEGER := (SELECT MIN(id) FROM public.actividades);
    v_antes INTEGER;
BEGIN
    SELECT cupo_maximo INTO v_antes FROM public.actividades WHERE id = v_id;
    UPDATE public.actividades SET cupo_maximo = cupo_maximo + 1 WHERE id = v_id;
    IF (SELECT cupo_maximo FROM public.actividades WHERE id = v_id) <> v_antes + 1 THEN
        RAISE EXCEPTION 'FALLO 21: el docente no pudo modificar el cupo';
    END IF;
    RAISE NOTICE 'OK 21: el docente conserva la gestión de cupos';
END $$;

-- ================================================================
-- 3. OPINIONES: MODERACIÓN SIN FILTRACIONES
-- ================================================================
RESET ROLE;
SET LOCAL ROLE anon;

INSERT INTO public.opiniones (nombre_usuario, comentario)
VALUES ('Visitante de prueba', 'Comentario pendiente de reconciliación');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.opiniones WHERE nombre_usuario = 'Visitante de prueba') THEN
        RAISE EXCEPTION 'FALLO 22: anon puede leer una opinión pendiente';
    END IF;
    RAISE NOTICE 'OK 22: anon crea una opinión pendiente pero no puede leerla';

    BEGIN
        INSERT INTO public.opiniones (nombre_usuario, comentario, aprobado)
        VALUES ('Ataque', 'Comentario aprobado por quien no corresponde', TRUE);
        RAISE EXCEPTION 'FALLO 23: anon insertó una opinión ya aprobada';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 23: anon no puede autoaprobar una opinión';
    END;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a1111111-1111-4111-8111-111111111111"}', true);

DO $$
BEGIN
    UPDATE public.opiniones SET aprobado = TRUE
    WHERE nombre_usuario = 'Visitante de prueba';
    IF NOT EXISTS (SELECT 1 FROM public.opiniones
                   WHERE nombre_usuario = 'Visitante de prueba' AND aprobado) THEN
        RAISE EXCEPTION 'FALLO 24: el director no pudo aprobar';
    END IF;
    RAISE NOTICE 'OK 24: el director puede aprobar testimonios';
END $$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.opiniones WHERE nombre_usuario = 'Visitante de prueba') THEN
        RAISE EXCEPTION 'FALLO 25: anon no ve la opinión aprobada';
    END IF;
    RAISE NOTICE 'OK 25: anon ve la opinión después de su aprobación';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a3333333-3333-4333-8333-333333333333"}', true);
DO $$
DECLARE
    v_afectadas BIGINT;
BEGIN
    UPDATE public.opiniones SET aprobado = FALSE WHERE nombre_usuario = 'Visitante de prueba';
    GET DIAGNOSTICS v_afectadas = ROW_COUNT;
    IF v_afectadas <> 0 THEN
        RAISE EXCEPTION 'FALLO 26: un estudiante moderó una opinión';
    END IF;
    RAISE NOTICE 'OK 26: un estudiante no puede moderar opiniones';
END $$;

-- ================================================================
-- 4. VÍNCULOS FAMILIARES Y LECTURA DE PERFILES
-- ================================================================
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a3333333-3333-4333-8333-333333333333"}', true);
DO $$
DECLARE
    v_afectadas BIGINT;
    v_rol_antes BIGINT;
BEGIN
    UPDATE public.perfiles SET telefono = '111111'
    WHERE id = 'a3333333-3333-4333-8333-333333333333';
    GET DIAGNOSTICS v_afectadas = ROW_COUNT;
    IF v_afectadas <> 0 THEN
        RAISE EXCEPTION 'FALLO 26bis: un estudiante modificó su perfil directamente';
    END IF;

    SELECT rol_id INTO v_rol_antes
    FROM public.perfiles
    WHERE id = 'a3333333-3333-4333-8333-333333333333';
    BEGIN
        UPDATE public.perfiles
        SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'DOCENTE')
        WHERE id = 'a3333333-3333-4333-8333-333333333333';
        RAISE EXCEPTION 'FALLO 26bis: un estudiante cambió su propio rol';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    IF (SELECT rol_id FROM public.perfiles
        WHERE id = 'a3333333-3333-4333-8333-333333333333') <> v_rol_antes THEN
        RAISE EXCEPTION 'FALLO 26bis: cambió el rol del estudiante pese a la denegación';
    END IF;
    RAISE NOTICE 'OK 26bis: un estudiante no edita perfiles ni cambia su rol';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a1111111-1111-4111-8111-111111111111"}', true);
DO $$
DECLARE
    v_rol_docente BIGINT;
BEGIN
    UPDATE public.perfiles SET telefono = '222222'
    WHERE id = 'a3333333-3333-4333-8333-333333333333';
    IF (SELECT telefono FROM public.perfiles
        WHERE id = 'a3333333-3333-4333-8333-333333333333') <> '222222' THEN
        RAISE EXCEPTION 'FALLO 26ter: el director no pudo editar un dato permitido';
    END IF;

    BEGIN
        UPDATE public.perfiles
        SET user_id = 'afffffff-ffff-4fff-8fff-ffffffffffff'
        WHERE id = 'a3333333-3333-4333-8333-333333333333';
        RAISE EXCEPTION 'FALLO 26ter: el director cambió user_id mediante escritura directa';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    SELECT rol_id INTO v_rol_docente
    FROM public.perfiles
    WHERE id = 'a2222222-2222-4222-8222-222222222222';
    BEGIN
        UPDATE public.perfiles
        SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE')
        WHERE id = 'a2222222-2222-4222-8222-222222222222';
        RAISE EXCEPTION 'FALLO 26ter: el director cambió DOCENTE a ESTUDIANTE directamente';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    IF (SELECT rol_id FROM public.perfiles
        WHERE id = 'a2222222-2222-4222-8222-222222222222') <> v_rol_docente
       OR EXISTS (
           SELECT 1 FROM public.alumnos
           WHERE perfil_id = 'a2222222-2222-4222-8222-222222222222'
       ) THEN
        RAISE EXCEPTION 'FALLO 26ter: la transición denegada dejó perfil o alumno inconsistente';
    END IF;
    RAISE NOTICE 'OK 26ter: el director edita datos personales sin cambiar identidad ni rol';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a4444444-4444-4444-8444-444444444444"}', true);
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.padres_hijos) <> 1 THEN
        RAISE EXCEPTION 'FALLO 27: el padre no ve su vínculo';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.perfiles
                   WHERE id = 'a3333333-3333-4333-8333-333333333333') THEN
        RAISE EXCEPTION 'FALLO 28: el padre no ve el perfil de su hijo';
    END IF;
    RAISE NOTICE 'OK 27: el padre ve su vínculo';
    RAISE NOTICE 'OK 28: el padre ve el perfil de su hijo sin recursión';

    BEGIN
        INSERT INTO public.padres_hijos (padre_id, hijo_id)
        VALUES ('a4444444-4444-4444-8444-444444444444', 'a5555555-5555-4555-8555-555555555555');
        RAISE EXCEPTION 'FALLO 29: el padre creó un vínculo';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 29: el padre no puede crear vínculos';
    END;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a5555555-5555-4555-8555-555555555555"}', true);
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.padres_hijos) <> 0 THEN
        RAISE EXCEPTION 'FALLO 30: un tercero ve vínculos ajenos';
    END IF;
    IF EXISTS (SELECT 1 FROM public.perfiles
               WHERE id = 'a3333333-3333-4333-8333-333333333333') THEN
        RAISE EXCEPTION 'FALLO 31: un tercero ve el perfil del hijo';
    END IF;
    RAISE NOTICE 'OK 30: un tercero no ve vínculos ajenos';
    RAISE NOTICE 'OK 31: un tercero no ve perfiles ajenos';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"a1111111-1111-4111-8111-111111111111"}', true);
DO $$
DECLARE
    v_antes BIGINT := (SELECT COUNT(*) FROM public.padres_hijos);
BEGIN
    INSERT INTO public.padres_hijos (padre_id, hijo_id)
    VALUES ('a4444444-4444-4444-8444-444444444444', 'a5555555-5555-4555-8555-555555555555');
    IF (SELECT COUNT(*) FROM public.padres_hijos) <> v_antes + 1 THEN
        RAISE EXCEPTION 'FALLO 32: el director no pudo vincular';
    END IF;
    DELETE FROM public.padres_hijos
    WHERE hijo_id = 'a5555555-5555-4555-8555-555555555555';
    IF (SELECT COUNT(*) FROM public.padres_hijos) <> v_antes THEN
        RAISE EXCEPTION 'FALLO 33: el director no pudo desvincular';
    END IF;
    RAISE NOTICE 'OK 32: el director puede vincular';
    RAISE NOTICE 'OK 33: el director puede desvincular';
END $$;

-- ================================================================
-- 5. NO SE INVENTA UNA UNICIDAD DE ACTIVIDADES
-- ================================================================
RESET ROLE;
DO $$
DECLARE
    v_nivel INTEGER := (SELECT id FROM public.niveles ORDER BY id LIMIT 1);
BEGIN
    INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
    VALUES
        ('Duplicada intencional 011', 'CURRICULAR', 20, v_nivel),
        (' duplicada intencional 011 ', 'CURRICULAR', 20, v_nivel);

    IF (SELECT COUNT(*) FROM public.actividades
        WHERE tipo = 'CURRICULAR'
          AND nivel_id = v_nivel
          AND UPPER(BTRIM(nombre)) = 'DUPLICADA INTENCIONAL 011') <> 2 THEN
        RAISE EXCEPTION 'FALLO 34: 011 fusionó o rechazó actividades ambiguas';
    END IF;
    RAISE NOTICE 'OK 34: 011 preserva duplicados de actividades para resolución funcional posterior';
END $$;

-- ================================================================
-- 6. ANÓNIMO Y USUARIO SIN PERFIL FALLAN CERRADO
-- ================================================================
SET LOCAL ROLE anon;
DO $$
BEGIN
    BEGIN
        SELECT COUNT(*) FROM public.padres_hijos;
        RAISE EXCEPTION 'FALLO 35: anon leyó padres_hijos';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 35: anon no puede leer padres_hijos';
    END;

    BEGIN
        SELECT app_private.mis_hijos_ids();
        RAISE EXCEPTION 'FALLO 36: anon ejecutó la función privada';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 36: anon no puede ejecutar la función privada';
    END;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"afffffff-ffff-4fff-8fff-ffffffffffff"}', true);
DO $$
DECLARE
    v_id INTEGER := (SELECT MIN(id) FROM public.actividades);
    v_antes INTEGER;
BEGIN
    SELECT cupo_maximo INTO v_antes FROM public.actividades WHERE id = v_id;
    UPDATE public.actividades SET cupo_maximo = cupo_maximo + 1 WHERE id = v_id;
    IF (SELECT cupo_maximo FROM public.actividades WHERE id = v_id) <> v_antes THEN
        RAISE EXCEPTION 'FALLO 37: una sesión sin perfil modificó actividades';
    END IF;
    IF EXISTS (SELECT 1 FROM public.padres_hijos) THEN
        RAISE EXCEPTION 'FALLO 38: una sesión sin perfil leyó vínculos';
    END IF;
    RAISE NOTICE 'OK 37: una sesión sin perfil no modifica actividades';
    RAISE NOTICE 'OK 38: una sesión sin perfil no ve vínculos';
END $$;

ROLLBACK;
