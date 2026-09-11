-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de niveles (EPT-55)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.

\set ON_ERROR_STOP on

-- nextval/setval no son transaccionales. Se guardan ambos estados para que una
-- ejecución correcta restaure también las secuencias al finalizar.
SELECT id_seq.last_value AS nivel_id_last_value,
       id_seq.is_called AS nivel_id_is_called,
       orden_seq.last_value AS orden_last_value,
       orden_seq.is_called AS orden_is_called
FROM public.niveles_id_seq AS id_seq
CROSS JOIN app_private.niveles_orden_seq AS orden_seq
\gset estado_inicial_

BEGIN;

-- Identidades sintéticas. `auth.uid()` obtiene `sub` desde estos claims.
INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni)
VALUES
    ('61111111-1111-4111-8111-111111111111',
     (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),   'Prueba', 'Directora',  'N90000001'),
    ('62222222-2222-4222-8222-222222222222',
     (SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),    'Prueba', 'Docente',    'N90000002'),
    ('63333333-3333-4333-8333-333333333333',
     (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Prueba', 'Estudiante', 'N90000003'),
    ('64444444-4444-4444-8444-444444444444',
     (SELECT id FROM public.roles WHERE nombre = 'PADRE'),      'Prueba', 'Padre',      'N90000004'),
    ('65555555-5555-4555-8555-555555555555',
     (SELECT id FROM public.roles WHERE nombre = 'PERSONAL'),   'Prueba', 'Personal',   'N90000005');

-- ================================================================
-- 1–9. ESTRUCTURA, SEMILLAS Y ORDEN
-- ================================================================
DO $$
DECLARE
    nombres TEXT[];
    ordenes INTEGER[];
    tipo_borrado "char";
BEGIN
    IF (SELECT count(*) FROM public.niveles
        WHERE upper(btrim(nombre)) IN ('INICIAL', 'PRIMARIO', 'SECUNDARIO')) <> 3 THEN
        RAISE EXCEPTION 'FALLO 1: faltan niveles institucionales';
    END IF;
    RAISE NOTICE 'OK 1: existen INICIAL, PRIMARIO y SECUNDARIO';

    SELECT array_agg(nombre ORDER BY orden), array_agg(orden ORDER BY orden)
    INTO nombres, ordenes
    FROM public.niveles
    WHERE es_institucional;
    IF nombres IS DISTINCT FROM ARRAY['INICIAL', 'PRIMARIO', 'SECUNDARIO']
       OR ordenes IS DISTINCT FROM ARRAY[10, 20, 30] THEN
        RAISE EXCEPTION 'FALLO 2: orden institucional inesperado: % / %', nombres, ordenes;
    END IF;
    RAISE NOTICE 'OK 2: el orden institucional es INICIAL 10, PRIMARIO 20 y SECUNDARIO 30';

    IF EXISTS (SELECT 1 FROM public.niveles WHERE NOT activo) THEN
        RAISE EXCEPTION 'FALLO 3: una semilla no quedó activa';
    END IF;
    RAISE NOTICE 'OK 3: las semillas quedan activas';

    IF (SELECT count(*) FROM public.niveles WHERE es_institucional) <> 3 THEN
        RAISE EXCEPTION 'FALLO 4: la protección institucional no identifica exactamente tres filas';
    END IF;
    RAISE NOTICE 'OK 4: la protección institucional identifica exactamente las tres semillas';

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.niveles'::regclass
          AND conname = 'niveles_nombre_valido'
          AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'FALLO 5: falta la restricción de nombre';
    END IF;
    RAISE NOTICE 'OK 5: existe la integridad estructural del nombre';

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_niveles_nombre_normalizado'
          AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
    ) THEN
        RAISE EXCEPTION 'FALLO 6: falta la unicidad normalizada existente';
    END IF;
    RAISE NOTICE 'OK 6: se preserva la unicidad normalizada de nombres';

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_niveles_orden'
          AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
    ) THEN
        RAISE EXCEPTION 'FALLO 7: falta la unicidad del orden';
    END IF;
    RAISE NOTICE 'OK 7: el orden es positivo, explícito y único';

    IF (SELECT increment_by FROM pg_sequences
        WHERE schemaname = 'app_private' AND sequencename = 'niveles_orden_seq') <> 10 THEN
        RAISE EXCEPTION 'FALLO 8: la secuencia de orden no incrementa de a diez';
    END IF;
    RAISE NOTICE 'OK 8: la secuencia privada asigna orden concurrente en saltos de diez';

    BEGIN
        UPDATE public.niveles SET orden = 99 WHERE nombre = 'INICIAL';
        RAISE EXCEPTION 'FALLO 8bis.1: se modificó un orden ya asignado';
    EXCEPTION WHEN SQLSTATE 'P5502' THEN
        RAISE NOTICE 'OK 8bis.1: el trigger impide modificar un orden ya asignado (P5502)';
    END;

    BEGIN
        UPDATE public.niveles SET es_institucional = FALSE WHERE nombre = 'INICIAL';
        RAISE EXCEPTION 'FALLO 8bis.2: se quitó la protección institucional';
    EXCEPTION WHEN SQLSTATE 'P5502' THEN
        RAISE NOTICE 'OK 8bis.2: el trigger impide alterar la protección institucional (P5502)';
    END;

    SELECT confdeltype INTO tipo_borrado
    FROM pg_constraint
    WHERE conrelid = 'public.cursos'::regclass
      AND contype = 'f'
      AND confrelid = 'public.niveles'::regclass;
    IF tipo_borrado IS DISTINCT FROM 'r' THEN
        RAISE EXCEPTION 'FALLO 9: cursos.nivel_id no conserva ON DELETE RESTRICT';
    END IF;
    RAISE NOTICE 'OK 9: cursos.nivel_id conserva ON DELETE RESTRICT';
END $$;

-- ================================================================
-- 10–18. OPERACIONES VÁLIDAS DE DIRECTOR E HISTORIA
-- ================================================================
DO $$
DECLARE
    creado public.niveles;
    renombrado public.niveles;
    curso_id UUID;
    actividad_id INTEGER;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
        '{"sub":"61111111-1111-4111-8111-111111111111"}', true);

    creado := public.crear_nivel('SUPERIOR');
    IF creado.nombre <> 'SUPERIOR' OR NOT creado.activo OR creado.es_institucional THEN
        RAISE EXCEPTION 'FALLO 10: alta inválida: %', creado;
    END IF;
    RAISE NOTICE 'OK 10: un DIRECTOR crea un nivel adicional activo y no institucional';

    -- Las secuencias no retroceden con ROLLBACK; por eso el test acepta huecos
    -- producidos por ejecuciones anteriores, pero exige el rango y el paso.
    IF creado.orden <= 30 OR creado.orden % 10 <> 0 THEN
        RAISE EXCEPTION 'FALLO 11: orden del nivel nuevo inesperado: %', creado.orden;
    END IF;
    RAISE NOTICE 'OK 11: el nivel nuevo queda después de los institucionales';

    IF creado.id = creado.orden THEN
        RAISE EXCEPTION 'FALLO 12: el orden coincide accidentalmente con el id';
    END IF;
    RAISE NOTICE 'OK 12: el orden no depende del identificador (id %, orden %)', creado.id, creado.orden;

    INSERT INTO public.cursos (nivel_id, denominacion, division)
    VALUES (creado.id, 'Trayecto de prueba', 'A')
    RETURNING id INTO curso_id;

    INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
    VALUES ('Actividad histórica de prueba', 'TALLER', 20, creado.id)
    RETURNING id INTO actividad_id;

    renombrado := public.renombrar_nivel(creado.id, 'TERCIARIO');
    IF renombrado.nombre <> 'TERCIARIO' THEN
        RAISE EXCEPTION 'FALLO 13: no se renombró el nivel';
    END IF;
    RAISE NOTICE 'OK 13: un DIRECTOR renombra un nivel administrativo';

    IF renombrado.id <> creado.id OR renombrado.orden <> creado.orden THEN
        RAISE EXCEPTION 'FALLO 14: el renombrado cambió identidad u orden';
    END IF;
    RAISE NOTICE 'OK 14: el renombrado conserva identificador y orden';

    IF (SELECT nivel_id FROM public.cursos WHERE id = curso_id) <> creado.id THEN
        RAISE EXCEPTION 'FALLO 15: se perdió la relación del curso';
    END IF;
    RAISE NOTICE 'OK 15: el renombrado conserva las relaciones';

    PERFORM public.cambiar_estado_nivel(creado.id, FALSE);
    IF (SELECT activo FROM public.niveles WHERE id = creado.id) THEN
        RAISE EXCEPTION 'FALLO 16: el nivel no quedó inactivo';
    END IF;
    RAISE NOTICE 'OK 16: un DIRECTOR inactiva un nivel';

    IF NOT EXISTS (
        SELECT 1
        FROM public.cursos c
        JOIN public.niveles n ON n.id = c.nivel_id
        WHERE c.id = curso_id AND n.nombre = 'TERCIARIO' AND NOT n.activo
    ) THEN
        RAISE EXCEPTION 'FALLO 17: la lectura histórica perdió el nivel inactivo';
    END IF;
    RAISE NOTICE 'OK 17: la lectura histórica conserva el nivel inactivo relacionado';

    UPDATE public.actividades
    SET cupo_maximo = 21
    WHERE id = actividad_id;
    IF (SELECT nivel_id FROM public.actividades WHERE id = actividad_id) <> creado.id
       OR (SELECT cupo_maximo FROM public.actividades WHERE id = actividad_id) <> 21 THEN
        RAISE EXCEPTION 'FALLO 17bis: la actividad histórica perdió el nivel o no pudo actualizar otros datos';
    END IF;
    RAISE NOTICE 'OK 17bis: una actividad histórica conserva el nivel inactivo y puede actualizar otros datos';

    PERFORM public.cambiar_estado_nivel(creado.id, TRUE);
    IF NOT (SELECT activo FROM public.niveles WHERE id = creado.id) THEN
        RAISE EXCEPTION 'FALLO 18: el nivel no volvió a activo';
    END IF;
    RAISE NOTICE 'OK 18: un DIRECTOR reactiva un nivel';
END $$;

RESET ROLE;

-- ================================================================
-- 19–25. VALIDACIONES, PROTECCIÓN Y NIVEL INACTIVO EN CURSOS
-- ================================================================
DO $$
DECLARE
    administrativo_id INTEGER := (
        SELECT id FROM public.niveles WHERE nombre = 'TERCIARIO'
    );
    institucional_id INTEGER := (
        SELECT id FROM public.niveles WHERE nombre = 'INICIAL'
    );
    curso_id UUID;
    actividad_id INTEGER;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
        '{"sub":"61111111-1111-4111-8111-111111111111"}', true);

    BEGIN
        PERFORM public.renombrar_nivel(institucional_id, 'INICIAL NUEVO');
        RAISE EXCEPTION 'FALLO 19: se renombró un nivel institucional';
    EXCEPTION WHEN SQLSTATE 'P5502' THEN
        RAISE NOTICE 'OK 19: un nivel institucional no puede renombrarse (P5502)';
    END;

    PERFORM public.cambiar_estado_nivel(institucional_id, FALSE);
    IF (SELECT activo FROM public.niveles WHERE id = institucional_id) THEN
        RAISE EXCEPTION 'FALLO 19bis: no se inactivó el nivel institucional';
    END IF;
    PERFORM public.cambiar_estado_nivel(institucional_id, TRUE);
    IF NOT (SELECT activo FROM public.niveles WHERE id = institucional_id) THEN
        RAISE EXCEPTION 'FALLO 19bis: no se reactivó el nivel institucional';
    END IF;
    RAISE NOTICE 'OK 19bis: los niveles institucionales sí pueden inactivarse y reactivarse';

    BEGIN
        PERFORM public.crear_nivel('');
        RAISE EXCEPTION 'FALLO 20: se aceptó un nombre vacío';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 20: se rechaza el nombre vacío (P5501)';
    END;

    BEGIN
        PERFORM public.crear_nivel(' CON ESPACIOS ');
        RAISE EXCEPTION 'FALLO 21: se aceptaron espacios laterales';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 21: se rechazan espacios laterales (P5501)';
    END;

    BEGIN
        PERFORM public.crear_nivel(E'\t');
        RAISE EXCEPTION 'FALLO 21tab.1: se aceptó una tabulación como nombre';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 21tab.1: se rechaza una tabulación como nombre (P5501)';
    END;

    BEGIN
        PERFORM public.crear_nivel(E'\tNIVEL\t');
        RAISE EXCEPTION 'FALLO 21tab.2: se aceptaron tabulaciones laterales';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 21tab.2: se rechazan tabulaciones laterales (P5501)';
    END;

    BEGIN
        PERFORM public.crear_nivel(E'\n');
        RAISE EXCEPTION 'FALLO 21lf: se aceptó un salto de línea como nombre';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 21lf: se rechaza un salto de línea como nombre (P5501)';
    END;

    BEGIN
        PERFORM public.crear_nivel(E' \t\nNIVEL\r ');
        RAISE EXCEPTION 'FALLO 21combinado: se aceptó whitespace lateral combinado';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 21combinado: se rechaza whitespace lateral combinado (P5501)';
    END;

    BEGIN
        PERFORM public.crear_nivel(
            pg_catalog.chr(160) || 'NIVEL' || pg_catalog.chr(160)
        );
        RAISE EXCEPTION 'FALLO 21nbsp: se aceptó NBSP lateral';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 21nbsp: se rechaza NBSP lateral (P5501)';
    END;

    BEGIN
        PERFORM public.renombrar_nivel(administrativo_id, E'RENOMBRADO\t');
        RAISE EXCEPTION 'FALLO 21rename: el renombrado aceptó tabulación lateral';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 21rename: el renombrado aplica el mismo contrato de whitespace (P5501)';
    END;

    BEGIN
        PERFORM public.renombrar_nivel(2147483647, 'INEXISTENTE');
        RAISE EXCEPTION 'FALLO 21bis: se renombró un nivel inexistente';
    EXCEPTION WHEN SQLSTATE 'P5503' THEN
        RAISE NOTICE 'OK 21bis: las operaciones rechazan niveles inexistentes (P5503)';
    END;

    BEGIN
        PERFORM public.crear_nivel('terciario');
        RAISE EXCEPTION 'FALLO 22: se aceptó un duplicado por mayúsculas';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 22: se rechazan duplicados sin distinguir mayúsculas (23505)';
    END;

    BEGIN
        PERFORM public.crear_nivel(' TERCIARIO ');
        RAISE EXCEPTION 'FALLO 23: se aceptó un duplicado con espacios';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 23: la normalización no permite evadir el contrato de espacios (P5501)';
    END;

    BEGIN
        PERFORM public.crear_nivel(E'\tTERCIARIO\t');
        RAISE EXCEPTION 'FALLO 23tab: se intentó normalizar silenciosamente un duplicado con tabs';
    EXCEPTION WHEN SQLSTATE 'P5501' THEN
        RAISE NOTICE 'OK 23tab: un duplicado con tabs se rechaza como nombre inválido (P5501)';
    END;

    IF (public.crear_nivel('A')).nombre <> 'A'
       OR (public.crear_nivel('NIVEL VÁLIDO')).nombre <> 'NIVEL VÁLIDO' THEN
        RAISE EXCEPTION 'FALLO 23validos: se rechazó un nombre válido de uno o varios caracteres';
    END IF;
    RAISE NOTICE 'OK 23validos: se aceptan nombres válidos de uno y varios caracteres';

    PERFORM public.cambiar_estado_nivel(administrativo_id, FALSE);

    BEGIN
        INSERT INTO public.cursos (nivel_id, denominacion, division)
        VALUES (administrativo_id, 'Asignación nueva', 'B');
        RAISE EXCEPTION 'FALLO 24: se asignó un nivel inactivo a un curso nuevo';
    EXCEPTION WHEN SQLSTATE 'P5504' THEN
        RAISE NOTICE 'OK 24: un nivel inactivo no se puede usar en una asignación nueva (P5504)';
    END;

    INSERT INTO public.cursos (nivel_id, denominacion, division)
    VALUES (institucional_id, 'Reasignación de prueba', 'A')
    RETURNING id INTO curso_id;
    BEGIN
        UPDATE public.cursos SET nivel_id = administrativo_id WHERE id = curso_id;
        RAISE EXCEPTION 'FALLO 24bis: se reasignó un curso a un nivel inactivo';
    EXCEPTION WHEN SQLSTATE 'P5504' THEN
        RAISE NOTICE 'OK 24bis: tampoco se puede reasignar un curso a un nivel inactivo (P5504)';
    END;

    BEGIN
        INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
        VALUES ('Actividad nueva inactiva', 'TALLER', 20, administrativo_id);
        RAISE EXCEPTION 'FALLO 24act.1: se asignó un nivel inactivo a una actividad nueva';
    EXCEPTION WHEN SQLSTATE 'P5504' THEN
        RAISE NOTICE 'OK 24act.1: una actividad nueva rechaza un nivel inactivo (P5504)';
    END;

    INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
    VALUES ('Actividad para reasignar', 'TALLER', 20, institucional_id)
    RETURNING id INTO actividad_id;
    BEGIN
        UPDATE public.actividades
        SET nivel_id = administrativo_id
        WHERE id = actividad_id;
        RAISE EXCEPTION 'FALLO 24act.2: se reasignó una actividad a un nivel inactivo';
    EXCEPTION WHEN SQLSTATE 'P5504' THEN
        RAISE NOTICE 'OK 24act.2: una actividad existente rechaza la reasignación inactiva (P5504)';
    END;

    INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
    VALUES ('Actividad sin nivel', 'TALLER', 20, NULL)
    RETURNING id INTO actividad_id;
    UPDATE public.actividades SET cupo_maximo = 22 WHERE id = actividad_id;
    IF (SELECT nivel_id FROM public.actividades WHERE id = actividad_id) IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 24act.3: una actividad sin nivel dejó de aceptar NULL';
    END IF;
    RAISE NOTICE 'OK 24act.3: actividades conserva nivel_id NULL en altas y actualizaciones';

    SELECT id INTO curso_id FROM public.cursos
    WHERE nivel_id = administrativo_id AND denominacion = 'Trayecto de prueba';
    UPDATE public.cursos SET division = 'C' WHERE id = curso_id;
    IF (SELECT division FROM public.cursos WHERE id = curso_id) <> 'C' THEN
        RAISE EXCEPTION 'FALLO 25: no se pudo actualizar el registro histórico';
    END IF;
    RAISE NOTICE 'OK 25: un curso histórico conserva y puede actualizar datos sin reasignar el nivel inactivo';
END $$;

RESET ROLE;

-- La tabla aplica el mismo contrato aun fuera de las RPC. Estos casos se
-- ejecutan como propietario para aislar la restricción CHECK de las ACL.
DO $$
DECLARE
    caso TEXT;
    orden_prueba INTEGER := 900000;
BEGIN
    FOREACH caso IN ARRAY ARRAY[
        E'\t',
        E'\tTABLA\t',
        E'\n',
        E' \t\nTABLA\r ',
        pg_catalog.chr(160) || 'TABLA' || pg_catalog.chr(160)
    ] LOOP
        BEGIN
            INSERT INTO public.niveles (nombre, orden)
            VALUES (caso, orden_prueba);
            RAISE EXCEPTION 'FALLO 25tabla: la tabla aceptó un nombre con whitespace lateral';
        EXCEPTION WHEN check_violation THEN
            NULL;
        END;
        orden_prueba := orden_prueba + 10;
    END LOOP;
    RAISE NOTICE 'OK 25tabla.1: la restricción de tabla rechaza tabs, saltos, combinaciones y NBSP laterales';

    INSERT INTO public.niveles (nombre, orden)
    VALUES ('Z', orden_prueba), ('NIVEL DE TABLA', orden_prueba + 10);
    IF NOT EXISTS (SELECT 1 FROM public.niveles WHERE nombre = 'Z')
       OR NOT EXISTS (SELECT 1 FROM public.niveles WHERE nombre = 'NIVEL DE TABLA') THEN
        RAISE EXCEPTION 'FALLO 25tabla: la tabla rechazó nombres válidos';
    END IF;
    DELETE FROM public.niveles WHERE nombre IN ('Z', 'NIVEL DE TABLA');
    RAISE NOTICE 'OK 25tabla.2: la restricción de tabla acepta nombres válidos de uno y varios caracteres';
END $$;

-- ================================================================
-- 26–31. DENEGACIÓN POR ACTOR E IDENTIDAD REAL
-- ================================================================
DO $$
DECLARE
    actor RECORD;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';

    FOR actor IN
        SELECT * FROM (VALUES
            ('DOCENTE',    '62222222-2222-4222-8222-222222222222'),
            ('ESTUDIANTE', '63333333-3333-4333-8333-333333333333'),
            ('PADRE',      '64444444-4444-4444-8444-444444444444'),
            ('PERSONAL',   '65555555-5555-4555-8555-555555555555')
        ) AS actores(rol, user_id)
    LOOP
        PERFORM set_config('request.jwt.claims',
            format('{"sub":"%s"}', actor.user_id), true);
        BEGIN
            PERFORM public.crear_nivel('DENEGADO ' || actor.rol);
            RAISE EXCEPTION 'FALLO 26: % creó un nivel', actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 26: % no puede escribir niveles (42501)', actor.rol;
        END;

        BEGIN
            INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
            VALUES (
                'Actividad denegada ' || actor.rol,
                'TALLER',
                20,
                (SELECT id FROM public.niveles WHERE nombre = 'TERCIARIO')
            );
            RAISE EXCEPTION 'FALLO 26act: % asignó un nivel inactivo a una actividad', actor.rol;
        EXCEPTION WHEN SQLSTATE 'P5504' THEN
            RAISE NOTICE 'OK 26act: % tampoco puede asignar un nivel inactivo a actividades (P5504)', actor.rol;
        END;
    END LOOP;

    PERFORM set_config('request.jwt.claims',
        '{"sub":"66666666-6666-4666-8666-666666666666"}', true);
    BEGIN
        PERFORM public.crear_nivel('SIN PERFIL');
        RAISE EXCEPTION 'FALLO 27: un usuario sin perfil creó un nivel';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 27: un usuario sin perfil no puede escribir (42501)';
    END;

    PERFORM set_config('request.jwt.claims', NULL, true);
    BEGIN
        PERFORM app_private.crear_nivel('SIN IDENTIDAD');
        RAISE EXCEPTION 'FALLO 28: authenticated sin identidad creó un nivel';
    EXCEPTION WHEN SQLSTATE 'P5505' THEN
        RAISE NOTICE 'OK 28: la función privada exige auth.uid() real (P5505)';
    END;

    -- La firma no recibe actor ni rol, de modo que no existe parámetro para
    -- suplantar al director. El cambio de claims cambia el resultado.
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_nivel', 'renombrar_nivel', 'cambiar_estado_nivel')
          AND EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%' OR nombre ILIKE '%actor%'
          )
    ) THEN
        RAISE EXCEPTION 'FALLO 29: una RPC acepta identidad o rol del llamador';
    END IF;
    RAISE NOTICE 'OK 29: ninguna RPC acepta actor, usuario o rol para autorizar';

    PERFORM set_config('request.jwt.claims',
        '{"sub":"63333333-3333-4333-8333-333333333333"}', true);
    IF public.es_director_actual() THEN
        RAISE EXCEPTION 'FALLO 30: auth.uid() de estudiante fue aceptado como director';
    END IF;
    RAISE NOTICE 'OK 30: la autorización depende de auth.uid() y rechaza al estudiante';

    PERFORM set_config('request.jwt.claims',
        '{"sub":"61111111-1111-4111-8111-111111111111"}', true);
    IF NOT public.es_director_actual() THEN
        RAISE EXCEPTION 'FALLO 31: auth.uid() de directora no fue reconocido';
    END IF;
    RAISE NOTICE 'OK 31: la misma autorización reconoce a la DIRECTORA real';
END $$;

RESET ROLE;

-- ================================================================
-- 32–40. ACL, RLS Y SUPERFICIE MÍNIMA
-- ================================================================
DO $$
DECLARE
    privilegio TEXT;
    firma REGPROCEDURE;
BEGIN
    FOREACH privilegio IN ARRAY ARRAY[
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
        IF has_table_privilege('authenticated', 'public.niveles', privilegio) THEN
            RAISE EXCEPTION 'FALLO 32: authenticated conserva % sobre niveles', privilegio;
        END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'public.niveles', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO 32: authenticated perdió SELECT sobre niveles';
    END IF;
    RAISE NOTICE 'OK 32: public.niveles continúa de solo lectura directa para authenticated';

    IF has_sequence_privilege('authenticated', 'public.niveles_id_seq', 'USAGE')
       OR has_sequence_privilege('authenticated', 'app_private.niveles_orden_seq', 'USAGE') THEN
        RAISE EXCEPTION 'FALLO 33: authenticated conserva USAGE sobre una secuencia de niveles';
    END IF;
    RAISE NOTICE 'OK 33: authenticated no tiene USAGE sobre ninguna secuencia de niveles';

    FOREACH firma IN ARRAY ARRAY[
        'public.crear_nivel(text)'::regprocedure,
        'public.renombrar_nivel(integer,text)'::regprocedure,
        'public.cambiar_estado_nivel(integer,boolean)'::regprocedure,
        'app_private.crear_nivel(text)'::regprocedure,
        'app_private.renombrar_nivel(integer,text)'::regprocedure,
        'app_private.cambiar_estado_nivel(integer,boolean)'::regprocedure
    ] LOOP
        -- has_function_privilege para `anon` incluye los privilegios heredados
        -- de PUBLIC; una concesión a cualquiera de los dos vuelve esto true.
        IF has_function_privilege('anon', firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO 34: anon o PUBLIC puede ejecutar %', firma;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK 34: anon y PUBLIC no ejecutan funciones privilegiadas ni wrappers';

    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN ('crear_nivel', 'renombrar_nivel', 'cambiar_estado_nivel')
          AND (
              (n.nspname = 'app_private' AND NOT p.prosecdef)
              OR (n.nspname = 'public' AND p.prosecdef)
              OR NOT ('search_path=""' = ANY (p.proconfig))
          )
    ) THEN
        RAISE EXCEPTION 'FALLO 34bis: una función no respeta SECURITY DEFINER/INVOKER o search_path vacío';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.crear_nivel(text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.renombrar_nivel(integer,text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.cambiar_estado_nivel(integer,boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALLO 34bis: authenticated no puede ejecutar todos los wrappers mínimos';
    END IF;
    RAISE NOTICE 'OK 34bis: privadas SECURITY DEFINER, wrappers SECURITY INVOKER, search_path vacío y EXECUTE mínimo';

    IF has_schema_privilege('anon', 'app_private', 'USAGE') THEN
        RAISE EXCEPTION 'FALLO 34ter: anon tiene USAGE sobre app_private';
    END IF;
    RAISE NOTICE 'OK 34ter: app_private permanece fuera del acceso anónimo';

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname ILIKE '%eliminar%nivel%'
             OR (n.nspname IN ('public', 'app_private') AND p.proname ILIKE '%borrar%nivel%')
    ) THEN
        RAISE EXCEPTION 'FALLO 35: existe una función de eliminación de niveles';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'niveles' AND cmd = 'DELETE'
    ) THEN
        RAISE EXCEPTION 'FALLO 35: existe una política DELETE de niveles';
    END IF;
    RAISE NOTICE 'OK 35: no existe superficie de eliminación de niveles';

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.niveles'::regclass AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'FALLO 36: niveles no tiene RLS';
    END IF;
    RAISE NOTICE 'OK 36: public.niveles conserva RLS habilitado';

    IF (SELECT pg_catalog.array_agg(nombre ORDER BY nombre)::TEXT[]
        FROM public.niveles
        WHERE activo) IS DISTINCT FROM
       ARRAY['A', 'INICIAL', 'NIVEL VÁLIDO', 'PRIMARIO', 'SECUNDARIO']::TEXT[] THEN
        RAISE EXCEPTION 'FALLO 37: la consulta activa no devolvió el conjunto exacto esperado';
    END IF;
    RAISE NOTICE 'OK 37: la consulta con activo = true devuelve exactamente los niveles activos esperados';

    IF NOT EXISTS (SELECT 1 FROM public.niveles WHERE nombre = 'TERCIARIO' AND NOT activo) THEN
        RAISE EXCEPTION 'FALLO 38: la lectura general perdió el nivel inactivo';
    END IF;
    RAISE NOTICE 'OK 38: la lectura general conserva niveles inactivos para historia';

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.cursos'::regclass
          AND tgname = 'validar_nivel_activo_en_curso'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'FALLO 39: falta la regla de nivel activo en cursos';
    END IF;
    RAISE NOTICE 'OK 39: nuevas asignaciones de cursos validan el nivel activo';

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.actividades'::regclass
          AND tgname = 'validar_nivel_activo_en_actividad'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'FALLO 39bis: falta la regla de nivel activo en actividades';
    END IF;
    RAISE NOTICE 'OK 39bis: nuevas asignaciones de actividades validan el nivel activo';

    IF (SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'public.actividades'::regclass
          AND contype = 'f'
          AND confrelid = 'public.niveles'::regclass) IS DISTINCT FROM 'n' THEN
        RAISE EXCEPTION 'FALLO 40: se modificó actividades.nivel_id';
    END IF;
    RAISE NOTICE 'OK 40: actividades.nivel_id conserva ON DELETE SET NULL sin cambios';
END $$;

-- ================================================================
-- 41–44. DENEGACIÓN DIRECTA Y ANÓNIMA
-- ================================================================
DO $$
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
        '{"sub":"61111111-1111-4111-8111-111111111111"}', true);

    BEGIN
        INSERT INTO public.niveles (nombre, orden) VALUES ('DIRECTO', 900);
        RAISE EXCEPTION 'FALLO 41: authenticated insertó directamente';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 41: ni siquiera DIRECTOR tiene escritura directa sobre niveles (42501)';
    END;

    BEGIN
        DELETE FROM public.niveles WHERE nombre = 'TERCIARIO';
        RAISE EXCEPTION 'FALLO 42: authenticated borró físicamente un nivel';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 42: el borrado físico se rechaza por ACL/RLS (42501)';
    END;
END $$;

RESET ROLE;

DO $$
BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claims', NULL, true);

    BEGIN
        PERFORM public.crear_nivel('ANON');
        RAISE EXCEPTION 'FALLO 43: anon ejecutó el wrapper';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 43: anon no puede ejecutar el wrapper público (42501)';
    END;

    BEGIN
        PERFORM 1 FROM public.niveles;
        RAISE EXCEPTION 'FALLO 44: anon leyó el catálogo persistido';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 44: anon no accede al catálogo persistido (42501)';
    END;
END $$;

RESET ROLE;

ROLLBACK;

SELECT pg_catalog.setval(
    'public.niveles_id_seq'::pg_catalog.regclass,
    :'estado_inicial_nivel_id_last_value'::BIGINT,
    :'estado_inicial_nivel_id_is_called'::BOOLEAN
);
SELECT pg_catalog.setval(
    'app_private.niveles_orden_seq'::pg_catalog.regclass,
    :'estado_inicial_orden_last_value'::BIGINT,
    :'estado_inicial_orden_is_called'::BOOLEAN
);

-- Si el script llega hasta acá sin FALLO, las garantías de persistencia y
-- seguridad de EPT-55 quedan demostradas sin dejar datos.
