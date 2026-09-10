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

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.roles'::regclass AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'FALLO 1.6: roles no tiene RLS habilitado';
    END IF;
    RAISE NOTICE 'OK 1.6: roles tiene RLS habilitado';
END $$;

-- ================================================================
-- 1bis. PRIVILEGIOS RESIDUALES
-- ================================================================
-- `GRANT ALL` de la migración 001 incluye SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES y TRIGGER. Revocar solo las escrituras habituales deja
-- REFERENCES y TRIGGER en pie, así que se comprueban todos explícitamente.
DO $$
DECLARE
    prohibidos TEXT[] := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    tablas TEXT[] := ARRAY['public.roles', 'public.niveles'];
    tabla TEXT;
    privilegio TEXT;
BEGIN
    FOREACH tabla IN ARRAY tablas LOOP
        FOREACH privilegio IN ARRAY prohibidos LOOP
            IF has_table_privilege('authenticated', tabla, privilegio) THEN
                RAISE EXCEPTION 'FALLO 1bis: authenticated conserva % sobre %', privilegio, tabla;
            END IF;
            IF has_table_privilege('anon', tabla, privilegio) THEN
                RAISE EXCEPTION 'FALLO 1bis: anon conserva % sobre %', privilegio, tabla;
            END IF;
        END LOOP;

        -- La lectura sí tiene que seguir funcionando para la aplicación.
        IF NOT has_table_privilege('authenticated', tabla, 'SELECT') THEN
            RAISE EXCEPTION 'FALLO 1bis: authenticated perdió SELECT sobre %, lo que rompería la aplicación', tabla;
        END IF;
        IF has_table_privilege('anon', tabla, 'SELECT') THEN
            RAISE EXCEPTION 'FALLO 1bis: anon puede leer %', tabla;
        END IF;

        RAISE NOTICE 'OK 1bis: % queda de solo lectura para authenticated y cerrada para anon', tabla;
    END LOOP;

    -- Cursos: además de las escrituras prohibidas, se permiten INSERT y UPDATE
    -- porque el director los necesita; el filtro por rol lo hace RLS.
    FOREACH privilegio IN ARRAY ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege('authenticated', 'public.cursos', privilegio) THEN
            RAISE EXCEPTION 'FALLO 1bis: authenticated conserva % sobre public.cursos', privilegio;
        END IF;
    END LOOP;
    IF has_table_privilege('anon', 'public.cursos', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO 1bis: anon puede leer cursos';
    END IF;
    RAISE NOTICE 'OK 1bis: public.cursos sin DELETE, TRUNCATE, REFERENCES ni TRIGGER, y cerrada para anon';

    -- Las secuencias acompañan a las tablas: sin ellas no se puede insertar
    -- aunque alguien reotorgara INSERT por error.
    IF has_sequence_privilege('authenticated', 'public.roles_id_seq', 'USAGE')
       OR has_sequence_privilege('authenticated', 'public.niveles_id_seq', 'USAGE') THEN
        RAISE EXCEPTION 'FALLO 1bis: authenticated conserva USAGE sobre las secuencias de roles o niveles';
    END IF;
    RAISE NOTICE 'OK 1bis: secuencias de roles y niveles cerradas para authenticated';
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
    VALUES (nivel, 'Prueba RLS', 'A')
    RETURNING id INTO creado;
    RAISE NOTICE 'OK 2.1: la directora creó un curso';

    -- Criterio de aceptación 2: modificación sin perder relaciones.
    UPDATE public.cursos SET denominacion = 'Prueba RLS Bis' WHERE id = creado;
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
        ARRAY['Prueba RLS Bis', 'A'],      -- idéntico
        ARRAY['PRUEBA RLS BIS', 'a'],      -- distinto uso de mayúsculas
        ARRAY['prueba rls bis', 'A'],      -- minúsculas
        ARRAY['PRUEBA RLS BIS', 'A']       -- mayúsculas completas
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
        VALUES (nivel, '  Prueba RLS Bis  ', 'A');
        RAISE EXCEPTION 'FALLO 3.5: se aceptó una denominación con espacios laterales';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'OK 3.5: los espacios laterales se rechazan con 23514';
    END;

    -- La misma denominación en OTRO nivel sí es válida.
    INSERT INTO public.cursos (nivel_id, denominacion, division)
    VALUES ((SELECT id FROM public.niveles WHERE UPPER(BTRIM(nombre)) = 'INICIAL'), 'Prueba RLS Bis', 'A');
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
    FROM public.cursos WHERE denominacion = 'Prueba RLS Bis' AND division = 'A'
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
-- Una denegación solo cuenta si ocurre por el motivo correcto. La política
-- recursiva de `perfiles` que trae la migración 001 puede provocar SQLSTATE
-- 42P17, y un error interno inesperado NO es una autorización correcta: se
-- clasifica aparte y se marca como FALLO.
DO $$
DECLARE
    filas INTEGER;
    id_director INTEGER := (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR');
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"33333333-3333-4333-8333-333333333333"}', true);

    -- 9.1 Reasignarse el rol en su propio perfil.
    BEGIN
        UPDATE public.perfiles
        SET rol_id = id_director
        WHERE user_id = '33333333-3333-4333-8333-333333333333';
        GET DIAGNOSTICS filas = ROW_COUNT;

        IF filas <> 0 THEN
            RAISE EXCEPTION 'FALLO 9.1: un estudiante modificó su propio rol (% filas)', filas;
        END IF;
        RAISE NOTICE 'OK 9.1: RLS impide que el estudiante cambie su rol (0 filas afectadas)';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9.1: el estudiante no puede cambiar su rol (42501)';
        WHEN OTHERS THEN
            IF SQLSTATE = '42P17' THEN
                RAISE EXCEPTION 'FALLO 9.1: la denegación llegó por recursión de políticas (42P17), no por autorización. Arreglar las políticas de perfiles de la migración 001 antes de aceptar esta prueba.';
            END IF;
            RAISE EXCEPTION 'FALLO 9.1: denegación por un motivo inesperado % (%)', SQLSTATE, SQLERRM;
    END;

    -- 9.2 Insertarse un perfil nuevo con rol de director.
    BEGIN
        INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni)
        VALUES ('33333333-3333-4333-8333-333333333333', id_director, 'Falso', 'Director', 'T90000099');
        RAISE EXCEPTION 'FALLO 9.2: un estudiante se creó un perfil de director';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9.2: el estudiante no puede insertarse un perfil de director (42501)';
        WHEN OTHERS THEN
            IF SQLSTATE = '42P17' THEN
                RAISE EXCEPTION 'FALLO 9.2: la denegación llegó por recursión de políticas (42P17), no por autorización.';
            END IF;
            RAISE EXCEPTION 'FALLO 9.2: denegación por un motivo inesperado % (%)', SQLSTATE, SQLERRM;
    END;
END $$;

-- ================================================================
-- 9bis. ESCALADA POR LA TABLA DE ROLES
-- ================================================================
-- Éste es el ataque que cierra la migración 004. La autorización de cursos
-- deriva el rol de `roles.nombre = 'DIRECTOR'`. Si un usuario autenticado puede
-- escribir en `public.roles`, le alcanza con renombrar su propio rol para que
-- `es_director_actual()` lo acepte, sin tocar nunca su perfil.
--
-- Antes de 004: `GRANT ALL ON ALL TABLES ... TO authenticated` (001:312) y
-- ninguna RLS sobre `roles` hacían que este bloque fallara.
DO $$
DECLARE
    filas INTEGER;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"33333333-3333-4333-8333-333333333333"}', true);

    IF public.es_director_actual() THEN
        RAISE EXCEPTION 'FALLO 9bis.0: el estudiante ya era director antes del ataque';
    END IF;

    -- 9bis.1 Renombrar el rol propio como DIRECTOR.
    BEGIN
        UPDATE public.roles SET nombre = 'DIRECTOR' WHERE nombre = 'ESTUDIANTE';
        GET DIAGNOSTICS filas = ROW_COUNT;
        IF filas <> 0 THEN
            RAISE EXCEPTION 'FALLO 9bis.1: un estudiante renombró % fila(s) de public.roles', filas;
        END IF;
        RAISE NOTICE 'OK 9bis.1: RLS impide renombrar roles (0 filas afectadas)';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9bis.1: el estudiante no puede renombrar roles (42501)';
    END;

    -- 9bis.2 Insertar un rol nuevo.
    BEGIN
        INSERT INTO public.roles (nombre) VALUES ('SUPERDIRECTOR');
        RAISE EXCEPTION 'FALLO 9bis.2: un estudiante insertó una fila en public.roles';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9bis.2: el estudiante no puede insertar roles (42501)';
    END;

    -- 9bis.3 Borrar un rol.
    BEGIN
        DELETE FROM public.roles WHERE nombre = 'DOCENTE';
        GET DIAGNOSTICS filas = ROW_COUNT;
        IF filas <> 0 THEN
            RAISE EXCEPTION 'FALLO 9bis.3: un estudiante borró % fila(s) de public.roles', filas;
        END IF;
        RAISE NOTICE 'OK 9bis.3: RLS impide borrar roles (0 filas afectadas)';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9bis.3: el estudiante no puede borrar roles (42501)';
    END;

    -- 9bis.4 Vaciar la tabla.
    BEGIN
        TRUNCATE public.roles CASCADE;
        RAISE EXCEPTION 'FALLO 9bis.4: un estudiante truncó public.roles';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9bis.4: el estudiante no puede truncar roles (42501)';
    END;

    -- 9bis.5 Lo mismo sobre niveles, que es la otra tabla de catálogo.
    BEGIN
        UPDATE public.niveles SET nombre = 'HACKEADO' WHERE TRUE;
        GET DIAGNOSTICS filas = ROW_COUNT;
        IF filas <> 0 THEN
            RAISE EXCEPTION 'FALLO 9bis.5: un estudiante modificó % nivel(es)', filas;
        END IF;
        RAISE NOTICE 'OK 9bis.5: RLS impide modificar niveles (0 filas afectadas)';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9bis.5: el estudiante no puede modificar niveles (42501)';
    END;

    -- 9bis.6 Después de todos los intentos, sigue sin ser director y sigue sin
    -- poder crear cursos.
    IF public.es_director_actual() THEN
        RAISE EXCEPTION 'FALLO 9bis.6: el ataque logró que es_director_actual() acepte al estudiante';
    END IF;

    BEGIN
        INSERT INTO public.cursos (nivel_id, denominacion, division)
        VALUES ((SELECT id FROM public.niveles WHERE UPPER(BTRIM(nombre)) = 'PRIMARIO'), 'Escalada', 'Z');
        RAISE EXCEPTION 'FALLO 9bis.6: el estudiante creó un curso después del intento de escalada';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 9bis.6: tras el ataque, el estudiante sigue sin ser director y sin poder crear cursos';
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
