-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de cursos (EPT-17 / EPT-18)
-- ============================================================
-- Prueba las reglas de la historia EPT-8 directamente en PostgreSQL: unicidad
-- normalizada, referencia válida al nivel, baja lógica y autorización por rol.
--
-- Cómo ejecutarlo, sobre una base LOCAL y descartable:
--
--     supabase db reset
--     psql "$(supabase status -o json | jq -r .DB_URL)" -v ON_ERROR_STOP=1 \
--          -f supabase/tests/cursos_rls.sql
--
-- Todo ocurre dentro de una transacción que termina en ROLLBACK: el script no
-- deja datos. Nunca ejecutarlo contra la base de producción.
--
-- Cada comprobación imprime OK o corta la ejecución con un mensaje FALLO.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ================================================================
-- Identidades de prueba
-- ================================================================
-- `auth.uid()` lee el campo `sub` de `request.jwt.claims`, así que alcanza con
-- fijar ese ajuste para actuar como cada usuario. Los perfiles se crean con el
-- rol del propietario de la tabla, que no está sujeto a RLS.

INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni)
VALUES
    ('11111111-1111-4111-8111-111111111111',
     (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),   'Prueba', 'Directora',  'T90000001'),
    ('22222222-2222-4222-8222-222222222222',
     (SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),    'Prueba', 'Docente',    'T90000002'),
    ('33333333-3333-4333-8333-333333333333',
     (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Prueba', 'Estudiante', 'T90000003'),
    ('44444444-4444-4444-8444-444444444444',
     (SELECT id FROM public.roles WHERE nombre = 'PADRE'),      'Prueba', 'Padre',      'T90000004'),
    ('55555555-5555-4555-8555-555555555555',
     (SELECT id FROM public.roles WHERE nombre = 'PERSONAL'),   'Prueba', 'Personal',   'T90000005');

-- Los niveles de referencia se resuelven por nombre normalizado en cada bloque.
-- No se usa una tabla temporal a propósito: pertenecería al usuario de la sesión
-- y el rol `authenticated` no podría leerla.

-- ================================================================
-- 1. ESTRUCTURA: la migración creó lo que la historia necesita
-- ================================================================
DO $$
DECLARE
    accion TEXT;
BEGIN
    -- Clave foránea al nivel con ON DELETE RESTRICT.
    SELECT confdeltype INTO accion
    FROM pg_constraint
    WHERE conrelid = 'public.cursos'::regclass
      AND contype = 'f'
      AND confrelid = 'public.niveles'::regclass;

    IF accion IS DISTINCT FROM 'r' THEN
        RAISE EXCEPTION 'FALLO 1.1: la clave foránea a niveles no usa ON DELETE RESTRICT (confdeltype=%)', accion;
    END IF;
    RAISE NOTICE 'OK 1.1: cursos.nivel_id referencia niveles con ON DELETE RESTRICT';

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_cursos_nivel_denominacion_division'
    ) THEN
        RAISE EXCEPTION 'FALLO 1.2: falta el índice único normalizado de cursos';
    END IF;
    RAISE NOTICE 'OK 1.2: existe el índice único normalizado de cursos';

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.cursos'::regclass AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'FALLO 1.3: cursos no tiene RLS habilitado';
    END IF;
    RAISE NOTICE 'OK 1.3: cursos tiene RLS habilitado';

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.niveles'::regclass AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'FALLO 1.4: niveles no tiene RLS habilitado';
    END IF;
    RAISE NOTICE 'OK 1.4: niveles tiene RLS habilitado';

    -- Ninguna política de borrado sobre cursos.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cursos' AND cmd = 'DELETE'
    ) THEN
        RAISE EXCEPTION 'FALLO 1.5: existe una política DELETE sobre cursos';
    END IF;
    RAISE NOTICE 'OK 1.5: no hay ninguna política DELETE sobre cursos';

    -- Privilegios mínimos: sin DELETE ni TRUNCATE para los roles de aplicación.
    IF has_table_privilege('authenticated', 'public.cursos', 'DELETE') THEN
        RAISE EXCEPTION 'FALLO 1.6: authenticated conserva el privilegio DELETE sobre cursos';
    END IF;
    IF has_table_privilege('anon', 'public.cursos', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO 1.7: anon puede leer cursos';
    END IF;
    IF has_table_privilege('authenticated', 'public.niveles', 'DELETE') THEN
        RAISE EXCEPTION 'FALLO 1.8: authenticated conserva el privilegio DELETE sobre niveles';
    END IF;
    RAISE NOTICE 'OK 1.6-1.8: privilegios mínimos aplicados sobre cursos y niveles';
END $$;

-- ================================================================
-- 2. DIRECTOR: operaciones permitidas
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
                  '{"sub":"11111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    nivel INTEGER := (SELECT id FROM public.niveles WHERE UPPER(BTRIM(nombre)) = 'PRIMARIO');
    creado UUID;
BEGIN
    IF NOT public.es_director_actual() THEN
        RAISE EXCEPTION 'FALLO 2.0: es_director_actual() no reconoce a la directora';
    END IF;
    RAISE NOTICE 'OK 2.0: es_director_actual() reconoce el rol DIRECTOR';

    -- Criterio de aceptación 1: alta con denominación, división y nivel existente.
    INSERT INTO public.cursos (nivel_id, denominacion, division)
    VALUES (nivel, '1er Grado', 'A')
    RETURNING id INTO creado;
    RAISE NOTICE 'OK 2.1: la directora creó un curso';

    -- Criterio de aceptación 2: modificación sin perder relaciones.
    UPDATE public.cursos SET denominacion = '1er Grado Bis' WHERE id = creado;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FALLO 2.2: la directora no pudo modificar el curso';
    END IF;
    IF (SELECT nivel_id FROM public.cursos WHERE id = creado) IS DISTINCT FROM nivel THEN
        RAISE EXCEPTION 'FALLO 2.2: la modificación alteró el nivel del curso';
    END IF;
    RAISE NOTICE 'OK 2.2: la directora modificó el curso y conservó su nivel';
END $$;

-- ================================================================
-- 3. UNICIDAD NORMALIZADA (criterio de aceptación 4)
-- ================================================================
DO $$
DECLARE
    nivel INTEGER := (SELECT id FROM public.niveles WHERE UPPER(BTRIM(nombre)) = 'PRIMARIO');
    variante TEXT;
    variantes TEXT[][] := ARRAY[
        ARRAY['1er Grado Bis', 'A'],      -- idéntico
        ARRAY['1ER GRADO BIS', 'a'],      -- distinto uso de mayúsculas
        ARRAY['1er grado bis', 'A'],      -- minúsculas
        ARRAY['1ER GRADO BIS', 'A']       -- mayúsculas completas
    ];
    par TEXT[];
BEGIN
    FOREACH par SLICE 1 IN ARRAY variantes LOOP
        variante := par[1] || ' / ' || par[2];
        BEGIN
            INSERT INTO public.cursos (nivel_id, denominacion, division)
            VALUES (nivel, par[1], par[2]);
            RAISE EXCEPTION 'FALLO 3: se aceptó un duplicado normalizado (%)', variante;
        EXCEPTION
            WHEN unique_violation THEN
                RAISE NOTICE 'OK 3: duplicado rechazado con 23505 (%)', variante;
        END;
    END LOOP;

    -- Los espacios laterales tampoco permiten evadir la restricción: el CHECK
    -- exige valores ya recortados, así que la fila ni siquiera llega al índice.
    BEGIN
        INSERT INTO public.cursos (nivel_id, denominacion, division)
        VALUES (nivel, '  1er Grado Bis  ', 'A');
        RAISE EXCEPTION 'FALLO 3.5: se aceptó una denominación con espacios laterales';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'OK 3.5: los espacios laterales se rechazan con 23514';
    END;

    -- La misma denominación en OTRO nivel sí es válida.
    INSERT INTO public.cursos (nivel_id, denominacion, division)
    VALUES ((SELECT id FROM public.niveles WHERE UPPER(BTRIM(nombre)) = 'INICIAL'), '1er Grado Bis', 'A');
    RAISE NOTICE 'OK 3.6: la misma denominación se admite en otro nivel';
END $$;

-- ================================================================
-- 4. NIVEL INEXISTENTE (mapeo 23503)
-- ================================================================
DO $$
BEGIN
    BEGIN
        INSERT INTO public.cursos (nivel_id, denominacion, division)
        VALUES (999999, 'Curso Fantasma', 'Z');
        RAISE EXCEPTION 'FALLO 4: se aceptó un curso con un nivel inexistente';
    EXCEPTION
        WHEN foreign_key_violation THEN
            RAISE NOTICE 'OK 4: el nivel inexistente se rechaza con 23503';
    END;
END $$;

-- ================================================================
-- 5. BAJA LÓGICA: conserva la fila y sus relaciones (criterio 3)
-- ================================================================
DO $$
DECLARE
    objetivo UUID;
    nivel_antes INTEGER;
    nivel_despues INTEGER;
BEGIN
    SELECT id, nivel_id INTO objetivo, nivel_antes
    FROM public.cursos WHERE denominacion = '1er Grado Bis' AND division = 'A'
    ORDER BY fecha_creacion LIMIT 1;

    UPDATE public.cursos SET activo = FALSE WHERE id = objetivo;

    IF NOT EXISTS (SELECT 1 FROM public.cursos WHERE id = objetivo) THEN
        RAISE EXCEPTION 'FALLO 5.1: la inactivación eliminó la fila';
    END IF;

    SELECT nivel_id INTO nivel_despues FROM public.cursos WHERE id = objetivo;
    IF nivel_despues IS DISTINCT FROM nivel_antes THEN
        RAISE EXCEPTION 'FALLO 5.2: la inactivación alteró la relación con el nivel';
    END IF;

    IF (SELECT activo FROM public.cursos WHERE id = objetivo) THEN
        RAISE EXCEPTION 'FALLO 5.3: el curso no quedó inactivo';
    END IF;
    RAISE NOTICE 'OK 5: la baja lógica conserva la fila, el nivel y marca activo = false';

    -- Y se puede reactivar.
    UPDATE public.cursos SET activo = TRUE WHERE id = objetivo;
    IF NOT (SELECT activo FROM public.cursos WHERE id = objetivo) THEN
        RAISE EXCEPTION 'FALLO 5.4: no se pudo reactivar el curso';
    END IF;
    RAISE NOTICE 'OK 5.4: el curso se puede reactivar';
END $$;

-- ================================================================
-- 6. BORRADO FÍSICO DENEGADO para el rol de aplicación
-- ================================================================
DO $$
BEGIN
    BEGIN
        DELETE FROM public.cursos;
        RAISE EXCEPTION 'FALLO 6: authenticated pudo borrar cursos';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 6: el borrado físico se rechaza con 42501';
    END;
END $$;

-- ================================================================
-- 7. NIVEL REFERENCIADO: no se puede borrar (ON DELETE RESTRICT)
-- ================================================================
RESET ROLE;

DO $$
DECLARE
    nivel INTEGER := (SELECT id FROM public.niveles WHERE UPPER(BTRIM(nombre)) = 'PRIMARIO');
BEGIN
    BEGIN
        DELETE FROM public.niveles WHERE id = nivel;
        RAISE EXCEPTION 'FALLO 7: se borró un nivel que tiene cursos';
    EXCEPTION
        WHEN foreign_key_violation THEN
            RAISE NOTICE 'OK 7: no se puede borrar un nivel referenciado por un curso';
    END;
END $$;

-- ================================================================
-- 8. ROLES NO AUTORIZADOS: no pueden mutar cursos
-- ================================================================
DO $$
DECLARE
    identidades TEXT[] := ARRAY[
        '22222222-2222-4222-8222-222222222222',  -- DOCENTE
        '33333333-3333-4333-8333-333333333333',  -- ESTUDIANTE
        '44444444-4444-4444-8444-444444444444',  -- PADRE
        '55555555-5555-4555-8555-555555555555',  -- PERSONAL
        '99999999-9999-4999-8999-999999999999'   -- sesión sin perfil (rol inventado)
    ];
    identidad TEXT;
    nivel INTEGER := (SELECT id FROM public.niveles WHERE UPPER(BTRIM(nombre)) = 'PRIMARIO');
    objetivo UUID := (SELECT id FROM public.cursos LIMIT 1);
    filas INTEGER;
    visibles INTEGER;
BEGIN
    FOREACH identidad IN ARRAY identidades LOOP
        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', identidad)::text, true);

        IF public.es_director_actual() THEN
            RAISE EXCEPTION 'FALLO 8.0: es_director_actual() dio true para %', identidad;
        END IF;

        -- Alta denegada por RLS.
        BEGIN
            INSERT INTO public.cursos (nivel_id, denominacion, division)
            VALUES (nivel, 'Intento ' || left(identidad, 4), 'X');
            RAISE EXCEPTION 'FALLO 8.1: % pudo crear un curso', identidad;
        EXCEPTION
            WHEN insufficient_privilege THEN
                NULL;  -- esperado: new row violates row-level security policy
        END;

        -- Modificación: RLS filtra las filas, así que no alcanza ninguna.
        UPDATE public.cursos SET activo = FALSE WHERE id = objetivo;
        GET DIAGNOSTICS filas = ROW_COUNT;
        IF filas <> 0 THEN
            RAISE EXCEPTION 'FALLO 8.2: % modificó % fila(s)', identidad, filas;
        END IF;

        -- Borrado denegado por privilegios.
        BEGIN
            DELETE FROM public.cursos WHERE id = objetivo;
            RAISE EXCEPTION 'FALLO 8.3: % pudo borrar un curso', identidad;
        EXCEPTION
            WHEN insufficient_privilege THEN
                NULL;
        END;

        -- Lectura permitida: el catálogo es visible para cualquier autenticado.
        SELECT count(*) INTO visibles FROM public.cursos;
        IF visibles = 0 THEN
            RAISE EXCEPTION 'FALLO 8.4: % no puede leer el catálogo de cursos', identidad;
        END IF;

        RAISE NOTICE 'OK 8: % no puede crear, modificar ni borrar cursos, y sí puede leerlos', identidad;
    END LOOP;
END $$;

-- ================================================================
-- 9. ROL FORJADO: un usuario no puede ascenderse a DIRECTOR
-- ================================================================
DO $$
DECLARE
    filas INTEGER;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"33333333-3333-4333-8333-333333333333"}', true);

    BEGIN
        UPDATE public.perfiles
        SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR')
        WHERE user_id = '33333333-3333-4333-8333-333333333333';
        GET DIAGNOSTICS filas = ROW_COUNT;

        IF filas <> 0 THEN
            RAISE EXCEPTION 'FALLO 9: un estudiante modificó su propio rol';
        END IF;
        RAISE NOTICE 'OK 9: el estudiante no puede cambiar su rol (0 filas afectadas)';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9: el estudiante no puede cambiar su rol (42501)';
    END;
END $$;

-- ================================================================
-- 10. ANÓNIMO: sin acceso alguno a cursos
-- ================================================================
DO $$
BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claims', NULL, true);

    BEGIN
        PERFORM 1 FROM public.cursos;
        RAISE EXCEPTION 'FALLO 10.1: anon puede leer cursos';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 10.1: anon no puede leer cursos (42501)';
    END;

    BEGIN
        INSERT INTO public.cursos (nivel_id, denominacion, division) VALUES (1, 'Anon', 'A');
        RAISE EXCEPTION 'FALLO 10.2: anon puede crear cursos';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 10.2: anon no puede crear cursos (42501)';
    END;
END $$;

RESET ROLE;

-- ================================================================
-- 11. DIAGNÓSTICO INFORMATIVO (defecto preexistente, fuera del alcance)
-- ================================================================
-- La política "Directores y docentes ven todos los perfiles" de la migración 001
-- consulta `perfiles` dentro de una política sobre `perfiles`, lo que produce
-- recursión (42P17). Por eso las políticas de cursos usan
-- `public.es_director_actual()` en lugar de consultar `perfiles` directamente.
-- Esto NO detiene el script: solo deja constancia del estado real.
DO $$
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
    BEGIN
        PERFORM 1 FROM public.perfiles LIMIT 1;
        RAISE NOTICE 'INFO 11: la lectura directa de perfiles funciona en esta base';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'INFO 11: la lectura directa de perfiles falla con % (%). Defecto preexistente de 001, ajeno a esta historia.',
                SQLSTATE, SQLERRM;
    END;
END $$;

RESET ROLE;

ROLLBACK;

-- Si llegaste hasta acá sin ningún FALLO, todas las reglas de EPT-8 se cumplen
-- en la base de datos.
