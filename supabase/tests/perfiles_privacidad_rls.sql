-- EPT-58 B: matriz de privacidad sobre una base local con 001–A+B.
-- docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/perfiles_privacidad_rls.sql
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT v.id, v.id, r.id, v.nombre, 'Prueba EPT58 B', v.dni, v.legajo
FROM (VALUES
    ('f58b0000-0000-4000-8000-000000000001'::uuid, 'DIRECTOR',   'Dirección',  '95810001', NULL),
    ('f58b0000-0000-4000-8000-000000000002'::uuid, 'DOCENTE',    'Docente',    '95810002', 'LEG-B-D'),
    ('f58b0000-0000-4000-8000-000000000003'::uuid, 'ESTUDIANTE', 'Estudiante', '95810003', 'LEG-B-E'),
    ('f58b0000-0000-4000-8000-000000000004'::uuid, 'PADRE',      'Familia',    '95810004', NULL),
    ('f58b0000-0000-4000-8000-000000000005'::uuid, 'PERSONAL',   'Personal',   '95810005', NULL)
) AS v(id, rol, nombre, dni, legajo)
JOIN public.roles r ON r.nombre = v.rol;

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES ('f58b0000-0000-4000-8000-000000000004',
        'f58b0000-0000-4000-8000-000000000003');

-- El catálogo no debe conservar la lectura amplia ni alterar INSERT/UPDATE.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
               WHERE schemaname = 'public' AND tablename = 'perfiles'
                 AND policyname = 'Directores y docentes ven todos los perfiles')
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
           WHERE schemaname = 'public' AND tablename = 'perfiles'
             AND cmd = 'SELECT') <> 3
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                      WHERE schemaname = 'public' AND tablename = 'perfiles'
                        AND policyname = 'Solo Dirección ve todos los perfiles'
                        AND cmd = 'SELECT')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                      WHERE schemaname = 'public' AND tablename = 'perfiles'
                        AND policyname = 'Perfil propio' AND cmd = 'SELECT')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                      WHERE schemaname = 'public' AND tablename = 'perfiles'
                        AND policyname = 'Padres ven perfiles de sus hijos' AND cmd = 'SELECT')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                      WHERE schemaname = 'public' AND tablename = 'perfiles'
                        AND policyname = 'Solo directores insertan perfiles' AND cmd = 'INSERT')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                      WHERE schemaname = 'public' AND tablename = 'perfiles'
                        AND policyname = 'Directores modifican perfiles' AND cmd = 'UPDATE')
    THEN
        RAISE EXCEPTION 'FALLO: políticas de perfiles fuera del contrato de B.';
    END IF;
    RAISE NOTICE 'OK B-01: catálogo SELECT limitado, INSERT/UPDATE conservados';
END $$;

DO $$
DECLARE
    v_actor UUID;
    v_esperado UUID[];
    v_visibles UUID[];
    v_codigo TEXT;
BEGIN
    FOR v_actor, v_esperado IN
        SELECT * FROM (VALUES
            ('f58b0000-0000-4000-8000-000000000001'::uuid,
             ARRAY['f58b0000-0000-4000-8000-000000000001'::uuid,
                   'f58b0000-0000-4000-8000-000000000002'::uuid,
                   'f58b0000-0000-4000-8000-000000000003'::uuid,
                   'f58b0000-0000-4000-8000-000000000004'::uuid,
                   'f58b0000-0000-4000-8000-000000000005'::uuid]),
            ('f58b0000-0000-4000-8000-000000000002'::uuid,
             ARRAY['f58b0000-0000-4000-8000-000000000002'::uuid]),
            ('f58b0000-0000-4000-8000-000000000003'::uuid,
             ARRAY['f58b0000-0000-4000-8000-000000000003'::uuid]),
            ('f58b0000-0000-4000-8000-000000000004'::uuid,
             ARRAY['f58b0000-0000-4000-8000-000000000003'::uuid,
                   'f58b0000-0000-4000-8000-000000000004'::uuid]),
            ('f58b0000-0000-4000-8000-000000000005'::uuid,
             ARRAY['f58b0000-0000-4000-8000-000000000005'::uuid]),
            ('f58b0000-0000-4000-8000-000000000099'::uuid,
             NULL::uuid[])
        ) AS t(actor, esperado)
    LOOP
        PERFORM set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_actor)::text, true);
        SET LOCAL ROLE authenticated;
        BEGIN
            SELECT pg_catalog.array_agg(p.id ORDER BY p.id)
            INTO v_visibles
            FROM public.perfiles p
            WHERE p.id::text LIKE 'f58b0000-%';
            v_codigo := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_codigo := SQLSTATE;
        END;
        RESET ROLE;

        IF v_codigo <> 'OK' OR v_visibles IS DISTINCT FROM v_esperado THEN
            RAISE EXCEPTION 'FALLO B-02: actor % ve %, esperado %, SQLSTATE %.',
                v_actor, v_visibles, v_esperado, v_codigo;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK B-02: seis actores; Dirección todos, docente/estudiante/personal propio, familia propio+hijo, sin perfil ninguno; sin 42P17';
END $$;

SET LOCAL ROLE anon;
DO $$
DECLARE v_codigo TEXT;
BEGIN
    BEGIN
        PERFORM 1 FROM public.perfiles LIMIT 1;
        v_codigo := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_codigo := SQLSTATE;
    END;
    IF v_codigo <> '42501' THEN
        RAISE EXCEPTION 'FALLO B-03: anon recibió % en vez de 42501.', v_codigo;
    END IF;
    RAISE NOTICE 'OK B-03: anon sin SELECT';
END $$;
RESET ROLE;

-- La RPC expone el mismo conjunto mínimo pese al cierre de la lectura directa.
DO $$
DECLARE
    v_director UUID[];
    v_docente UUID[];
    v_esperado UUID[];
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"f58b0000-0000-4000-8000-000000000001"}', true);
    SET LOCAL ROLE authenticated;
    SELECT pg_catalog.array_agg(id ORDER BY id) INTO v_director
    FROM public.listar_estudiantes_para_gestion();
    RESET ROLE;

    PERFORM set_config('request.jwt.claims', '{"sub":"f58b0000-0000-4000-8000-000000000002"}', true);
    SET LOCAL ROLE authenticated;
    SELECT pg_catalog.array_agg(id ORDER BY id) INTO v_docente
    FROM public.listar_estudiantes_para_gestion();
    RESET ROLE;

    SELECT pg_catalog.array_agg(p.id ORDER BY p.id) INTO v_esperado
    FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'ESTUDIANTE';
    IF v_director IS DISTINCT FROM v_esperado OR v_docente IS DISTINCT FROM v_esperado THEN
        RAISE EXCEPTION 'FALLO B-04: RPC mínima cambió el conjunto de estudiantes.';
    END IF;
    RAISE NOTICE 'OK B-04: consulta mínima conserva el conjunto para Dirección y DOCENTE';
END $$;

ROLLBACK;
