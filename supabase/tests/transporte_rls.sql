-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de transporte (EPT-60)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. Cubre: catálogo y
-- paradas reproducibles, alta, idempotencia del "cambiar al mismo recorrido",
-- cambio atómico real, fallo del destino sin pérdida del recorrido anterior,
-- máximo un recorrido activo (incluso saltando la RPC), convivencia con
-- comedor, alumno ajeno, alumno inactivo, actores sin permiso, Dirección
-- (lectura + actualizar_recorrido), anon, bloqueo de cuenta (EPT-59), sin
-- borrado físico, RLS/grants/vista/funciones y ausencia de regresión sobre
-- inscripciones_servicios y su tipo COMEDOR.

\set ON_ERROR_STOP on

BEGIN;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
WITH base_libre AS (
    SELECT base
    FROM generate_series(80000000, 89999990, 10) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni = ANY (ARRAY[
            (base + 1)::TEXT, (base + 2)::TEXT, (base + 3)::TEXT,
            (base + 4)::TEXT, (base + 5)::TEXT, (base + 6)::TEXT,
            (base + 7)::TEXT
        ])
    )
    ORDER BY base
    LIMIT 1
), identidades(id, rol, apellido, legajo, desplazamiento) AS (
    VALUES
        ('b1111111-1111-4111-8111-111111111111'::UUID, 'DIRECTOR',   'Directora',  NULL,                  1),
        ('b2222222-2222-4222-8222-222222222222'::UUID, 'ESTUDIANTE', 'Activo',     'LEG-EPT60-0002',      2),
        ('b3333333-3333-4333-8333-333333333333'::UUID, 'ESTUDIANTE', 'Ajeno',      'LEG-EPT60-0003',      3),
        ('b4444444-4444-4444-8444-444444444444'::UUID, 'ESTUDIANTE', 'Inactivo',   NULL,                  4),
        ('b5555555-5555-4555-8555-555555555555'::UUID, 'DOCENTE',    'Docente',    NULL,                  5),
        ('b6666666-6666-4666-8666-666666666666'::UUID, 'PADRE',      'Padre',      NULL,                  6),
        ('b7777777-7777-4777-8777-777777777777'::UUID, 'PERSONAL',   'Personal',   NULL,                  7)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT i.id, i.id, r.id, 'Prueba', i.apellido, (b.base + i.desplazamiento)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (
    'ce111111-1111-4111-8111-111111111111',
    (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
    'Curso transporte EPT-60', 'A', TRUE
);

INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES
    ('b2222222-2222-4222-8222-222222222222', 'ce111111-1111-4111-8111-111111111111'),
    ('b3333333-3333-4333-8333-333333333333', 'ce111111-1111-4111-8111-111111111111');

UPDATE public.alumnos
SET estado = 'ACTIVO'
WHERE perfil_id IN (
    'b2222222-2222-4222-8222-222222222222',
    'b3333333-3333-4333-8333-333333333333'
);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

CREATE TEMPORARY TABLE ept60_huella_inscripciones_servicios ON COMMIT DROP AS
SELECT pg_catalog.count(*) AS cantidad
FROM public.inscripciones_servicios;

GRANT SELECT ON ept60_huella_inscripciones_servicios TO authenticated;


-- ================================================================
-- 1. CATÁLOGO Y PARADAS REPRODUCIBLES
-- ================================================================
DO $$
DECLARE
    v_recorridos INTEGER;
    v_paradas    INTEGER;
BEGIN
    IF pg_catalog.to_regclass('public.paradas_recorrido') IS NULL
       OR pg_catalog.to_regclass('public.recorridos_transporte') IS NULL THEN
        RAISE EXCEPTION 'FALLO 1: falta algún objeto de transporte';
    END IF;

    SELECT pg_catalog.count(*) INTO v_recorridos
    FROM public.servicios_escolares
    WHERE tipo = 'TRANSPORTE' AND activo
      AND codigo IN ('TR-NORTE', 'TR-SUR', 'TR-ESTE', 'TR-OESTE');
    IF v_recorridos <> 4 THEN
        RAISE EXCEPTION 'FALLO 1: no están los cuatro recorridos sembrados y activos';
    END IF;

    SELECT pg_catalog.count(*) INTO v_paradas FROM public.paradas_recorrido;
    IF v_paradas <> 12 THEN
        RAISE EXCEPTION 'FALLO 1: no hay doce paradas sembradas (tres por recorrido)';
    END IF;

    RAISE NOTICE 'OK 1: cuatro recorridos ficticios y doce paradas reproducibles';
END $$;


-- ================================================================
-- 2–9. EL ALUMNO ACTIVO: ALTA, IDEMPOTENCIA, CAMBIO Y FALLO DEL DESTINO
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b2222222-2222-4222-8222-222222222222"}', true);

DO $$
DECLARE
    v_norte UUID := 'e0000000-0000-4000-8000-000000000020';
    v_sur   UUID := 'e0000000-0000-4000-8000-000000000021';
    v_comedor UUID := 'e0000000-0000-4000-8000-000000000010';
    v_alta    public.inscripciones_servicios;
    v_igual   public.inscripciones_servicios;
    v_cambio  public.inscripciones_servicios;
    v_activas BIGINT;
BEGIN
    -- 2. Alta: primera inscripción a un recorrido.
    v_alta := public.establecer_recorrido_transporte(v_norte);
    IF v_alta.estado <> 'ACTIVA' OR v_alta.servicio_id <> v_norte
       OR v_alta.alumno_id <> 'b2222222-2222-4222-8222-222222222222' THEN
        RAISE EXCEPTION 'FALLO 2: alta inválida: %', v_alta;
    END IF;
    RAISE NOTICE 'OK 2: un alumno ACTIVO se inscribe a TR-NORTE (id %)', v_alta.id;

    -- 3. Idempotencia: «cambiar» al mismo recorrido no crea fila ni cancela nada.
    v_igual := public.establecer_recorrido_transporte(v_norte);
    IF v_igual.id <> v_alta.id OR v_igual.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO 3: cambiar al mismo recorrido no fue idempotente: %', v_igual;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios
        WHERE alumno_id = 'b2222222-2222-4222-8222-222222222222') <> 1 THEN
        RAISE EXCEPTION 'FALLO 3: el «cambio» al mismo recorrido generó una fila nueva';
    END IF;
    RAISE NOTICE 'OK 3: cambiar al recorrido ya activo es idempotente (misma fila, sin cancelar)';

    -- 4. Cambio real: cancela el anterior (lógicamente) y activa el nuevo.
    v_cambio := public.establecer_recorrido_transporte(v_sur);
    IF v_cambio.id = v_alta.id OR v_cambio.servicio_id <> v_sur::UUID OR v_cambio.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO 4: el cambio de recorrido no activó una fila nueva: %', v_cambio;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inscripciones_servicios
                   WHERE id = v_alta.id AND estado = 'CANCELADA' AND fecha_cancelacion IS NOT NULL) THEN
        RAISE EXCEPTION 'FALLO 4: la inscripción anterior no quedó cancelada lógicamente';
    END IF;
    RAISE NOTICE 'OK 4: el cambio de recorrido cancela lógicamente el anterior y activa el nuevo';

    -- 5. Como máximo un recorrido de transporte ACTIVA a la vez.
    SELECT pg_catalog.count(*) INTO v_activas
    FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id
    WHERE i.alumno_id = 'b2222222-2222-4222-8222-222222222222'
      AND i.estado = 'ACTIVA' AND s.tipo = 'TRANSPORTE';
    IF v_activas <> 1 THEN
        RAISE EXCEPTION 'FALLO 5: hay % recorridos activos simultáneos', v_activas;
    END IF;
    RAISE NOTICE 'OK 5: exactamente un recorrido de transporte activo tras el cambio';

    -- 6. El destino inexistente no toca el recorrido vigente (TR-SUR sigue activo).
    BEGIN
        PERFORM public.establecer_recorrido_transporte('00000000-0000-4000-8000-000000000000');
        RAISE EXCEPTION 'FALLO 6: se aceptó un destino inexistente';
    EXCEPTION WHEN SQLSTATE 'P5550' THEN
        NULL;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.inscripciones_servicios
                   WHERE id = v_cambio.id AND estado = 'ACTIVA') THEN
        RAISE EXCEPTION 'FALLO 6: el recorrido vigente se perdió al fallar el destino';
    END IF;
    RAISE NOTICE 'OK 6: un destino inexistente se rechaza (P5550) sin perder el recorrido vigente';
END $$;

-- 6bis se hace con el recorrido inactivado como propietario (authenticated no
-- tiene UPDATE sobre servicios_escolares por diseño), y se retoma la misma
-- sesión del alumno para comprobar que su recorrido vigente no se movió.
RESET ROLE;
UPDATE public.servicios_escolares SET activo = FALSE WHERE codigo = 'TR-ESTE';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b2222222-2222-4222-8222-222222222222"}', true);

DO $$
DECLARE
    v_comedor UUID := 'e0000000-0000-4000-8000-000000000010';
    v_vigente UUID;
BEGIN
    SELECT i.id INTO v_vigente FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id
    WHERE i.alumno_id = 'b2222222-2222-4222-8222-222222222222'
      AND i.estado = 'ACTIVA' AND s.tipo = 'TRANSPORTE';

    BEGIN
        PERFORM public.establecer_recorrido_transporte('e0000000-0000-4000-8000-000000000022');
        RAISE EXCEPTION 'FALLO 6bis: se aceptó un destino inactivo';
    EXCEPTION WHEN SQLSTATE 'P5551' THEN
        NULL;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.inscripciones_servicios
                   WHERE id = v_vigente AND estado = 'ACTIVA') THEN
        RAISE EXCEPTION 'FALLO 6bis: el recorrido vigente se perdió al fallar un destino inactivo';
    END IF;
    RAISE NOTICE 'OK 6bis: un destino inactivo se rechaza (P5551) sin perder el recorrido vigente';

    -- 7. La operación es exclusiva de transporte: no acepta un servicio de comedor.
    BEGIN
        PERFORM public.establecer_recorrido_transporte(v_comedor);
        RAISE EXCEPTION 'FALLO 7: establecer_recorrido_transporte aceptó un servicio de comedor';
    EXCEPTION WHEN SQLSTATE 'P5960' THEN
        RAISE NOTICE 'OK 7: la operación rechaza un servicio que no es de transporte (P5960)';
    END;

    -- 8. Convivencia con comedor: inscribirse al comedor no afecta el transporte.
    PERFORM public.inscribir_en_servicio(v_comedor);
    IF (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios
        WHERE alumno_id = 'b2222222-2222-4222-8222-222222222222' AND estado = 'ACTIVA') <> 2 THEN
        RAISE EXCEPTION 'FALLO 8: comedor y transporte activos no conviven';
    END IF;
    RAISE NOTICE 'OK 8: el alumno tiene comedor y transporte activos a la vez, sin interferencia';

    -- 9. Historia conservada: los tres ciclos de transporte más el de comedor siguen.
    IF (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios
        WHERE alumno_id = 'b2222222-2222-4222-8222-222222222222') <> 3 THEN
        RAISE EXCEPTION 'FALLO 9: no se conservó el historial completo de ciclos';
    END IF;
    RAISE NOTICE 'OK 9: se conservan los ciclos de transporte cancelados y el de comedor activo';
END $$;


-- ================================================================
-- 10. EL TRIGGER RECHAZA UN SEGUNDO RECORRIDO ACTIVO AUNQUE SE SALTEE LA RPC
-- ================================================================
RESET ROLE;
UPDATE public.servicios_escolares SET activo = TRUE WHERE codigo = 'TR-ESTE';
DO $$
BEGIN
    -- Como propietario, sin pasar por establecer_recorrido_transporte: el
    -- trigger es la autoridad aunque alguien escriba la tabla directo.
    BEGIN
        INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
        VALUES ('b2222222-2222-4222-8222-222222222222', 'e0000000-0000-4000-8000-000000000022');
        RAISE EXCEPTION 'FALLO 10: se insertó un segundo recorrido activo saltando la RPC';
    EXCEPTION WHEN SQLSTATE 'P5961' THEN
        RAISE NOTICE 'OK 10: un segundo recorrido activo se rechaza también por escritura directa (P5961)';
    END;
END $$;


-- ================================================================
-- 11. EL ALUMNO AJENO NO ALCANZA NADA DEL OTRO
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b3333333-3333-4333-8333-333333333333"}', true);

DO $$
DECLARE
    v_norte UUID := 'e0000000-0000-4000-8000-000000000020';
    v_propia public.inscripciones_servicios;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.inscripciones_servicios
        WHERE alumno_id <> 'b3333333-3333-4333-8333-333333333333'
    ) THEN
        RAISE EXCEPTION 'FALLO 11: un estudiante ve inscripciones ajenas';
    END IF;

    -- Su propia alta sigue funcionando y no colisiona con la del otro alumno.
    v_propia := public.establecer_recorrido_transporte(v_norte);
    IF v_propia.alumno_id <> 'b3333333-3333-4333-8333-333333333333' THEN
        RAISE EXCEPTION 'FALLO 11: el alta se atribuyó a otra persona';
    END IF;
    RAISE NOTICE 'OK 11: un estudiante no lee inscripciones ajenas y su propia alta no colisiona con la de otro alumno en el mismo recorrido';
END $$;


-- ================================================================
-- 12. EL ALUMNO INACTIVO NO SE INSCRIBE A TRANSPORTE
-- ================================================================
SELECT set_config('request.jwt.claims', '{"sub":"b4444444-4444-4444-8444-444444444444"}', true);

DO $$
BEGIN
    BEGIN
        PERFORM public.establecer_recorrido_transporte('e0000000-0000-4000-8000-000000000020');
        RAISE EXCEPTION 'FALLO 12: un alumno INACTIVO se inscribió a un recorrido';
    EXCEPTION WHEN SQLSTATE 'P5553' THEN
        RAISE NOTICE 'OK 12: un alumno INACTIVO no puede establecer un recorrido de transporte (P5553)';
    END;
END $$;


-- ================================================================
-- 13. LOS DEMÁS ACTORES NO ESTABLECEN NI ACTUALIZAN RECORRIDOS
-- ================================================================
DO $$
DECLARE
    v_actor RECORD;
BEGIN
    FOR v_actor IN
        SELECT * FROM (VALUES
            ('b1111111-1111-4111-8111-111111111111', 'DIRECTOR'),
            ('b5555555-5555-4555-8555-555555555555', 'DOCENTE'),
            ('b6666666-6666-4666-8666-666666666666', 'PADRE'),
            ('b7777777-7777-4777-8777-777777777777', 'PERSONAL'),
            ('b8888888-8888-4888-8888-888888888888', 'SIN PERFIL')
        ) AS a(sub, etiqueta)
    LOOP
        PERFORM set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', v_actor.sub)::TEXT, true);

        BEGIN
            PERFORM public.establecer_recorrido_transporte('e0000000-0000-4000-8000-000000000020');
            RAISE EXCEPTION 'FALLO 13: % pudo establecer un recorrido de transporte', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;
        END;

        -- Ni siquiera Dirección: actualizar_recorrido es la única vía que le
        -- corresponde, y establecer_recorrido_transporte sigue siendo del alumno.
        IF v_actor.etiqueta <> 'DIRECTOR' THEN
            BEGIN
                PERFORM public.actualizar_recorrido('e0000000-0000-4000-8000-000000000020', 'x', TRUE);
                RAISE EXCEPTION 'FALLO 13: % pudo actualizar un recorrido', v_actor.etiqueta;
            EXCEPTION WHEN insufficient_privilege THEN
                NULL;
            END;
        END IF;
    END LOOP;

    RAISE NOTICE 'OK 13: DIRECTOR, DOCENTE, PADRE, PERSONAL y una cuenta sin perfil no establecen recorridos; solo Dirección puede intentar actualizar_recorrido';
END $$;


-- ================================================================
-- 14–15. DIRECCIÓN: CONSULTA Y MANTENIMIENTO DESCRIPTIVO
-- ================================================================
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    v_norte      UUID := 'e0000000-0000-4000-8000-000000000020';
    v_inscriptos BIGINT;
    v_actualizado public.servicios_escolares;
BEGIN
    -- 14. Consulta de alumnos inscriptos por recorrido.
    SELECT pg_catalog.count(*) INTO v_inscriptos
    FROM public.inscripciones_servicios_detalle
    WHERE servicio_codigo = 'TR-NORTE' AND estado = 'ACTIVA';
    IF v_inscriptos < 1 THEN
        RAISE EXCEPTION 'FALLO 14: Dirección no ve alumnos inscriptos en TR-NORTE';
    END IF;
    RAISE NOTICE 'OK 14: Dirección consulta % alumno(s) activo(s) en TR-NORTE', v_inscriptos;

    -- 15. Mantenimiento descriptivo: nombre y activo mutables por Dirección.
    v_actualizado := public.actualizar_recorrido(v_norte, 'Recorrido Norte (renombrado)', TRUE);
    IF v_actualizado.nombre <> 'Recorrido Norte (renombrado)' OR v_actualizado.codigo <> 'TR-NORTE' THEN
        RAISE EXCEPTION 'FALLO 15: actualizar_recorrido no aplicó el nombre o alteró el código: %', v_actualizado;
    END IF;
    RAISE NOTICE 'OK 15: Dirección renombra un recorrido a través de actualizar_recorrido';

    -- No adquiere la facultad de inscribir en nombre del alumno.
    BEGIN
        PERFORM public.establecer_recorrido_transporte(v_norte);
        RAISE EXCEPTION 'FALLO 15bis: Dirección pudo establecer un recorrido en nombre de un alumno';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 15bis: Dirección consulta y mantiene la descripción, pero no inscribe en nombre del alumno (42501)';
    END;
END $$;

-- El código y el tipo son inmutables incluso para el propietario en cuanto el
-- recorrido tiene inscripciones (trigger de 013, reutilizado). Se comprueba
-- como propietario, igual que el 21bis de comedor_rls.sql: es la única forma
-- de aislar la regla del trigger de la ausencia total de privilegio de
-- authenticated sobre esta tabla.
RESET ROLE;
DO $$
BEGIN
    BEGIN
        UPDATE public.servicios_escolares SET codigo = 'TR-NORTE-2' WHERE codigo = 'TR-NORTE';
        RAISE EXCEPTION 'FALLO 15ter: se cambió el código de un recorrido con inscripciones';
    EXCEPTION WHEN SQLSTATE 'P5557' THEN
        RAISE NOTICE 'OK 15ter: el código de un recorrido con inscripciones sigue inmutable incluso para el propietario (P5557, reutilizado de 013)';
    END;
END $$;


-- ================================================================
-- 16. ANÓNIMO: NI LECTURA NI ESCRITURA
-- ================================================================
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', NULL, true);

DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM public.paradas_recorrido;
        RAISE EXCEPTION 'FALLO 16: anon lee las paradas de los recorridos';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        PERFORM 1 FROM public.recorridos_transporte;
        RAISE EXCEPTION 'FALLO 16: anon lee el catálogo de recorridos';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        PERFORM public.establecer_recorrido_transporte('e0000000-0000-4000-8000-000000000020');
        RAISE EXCEPTION 'FALLO 16: anon pudo ejecutar el establecimiento de un recorrido';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    RAISE NOTICE 'OK 16: anon no lee ni escribe ningún objeto de transporte';
END $$;

RESET ROLE;


-- ================================================================
-- 17. UNA PARADA SOLO PUEDE COLGAR DE UN SERVICIO DE TRANSPORTE
-- ================================================================
DO $$
BEGIN
    BEGIN
        INSERT INTO public.paradas_recorrido (servicio_id, orden, nombre)
        VALUES ('e0000000-0000-4000-8000-000000000010', 1, 'Parada inválida');
        RAISE EXCEPTION 'FALLO 17: se agregó una parada a un servicio de comedor';
    EXCEPTION WHEN SQLSTATE 'P5960' THEN
        RAISE NOTICE 'OK 17: una parada solo puede colgar de un recorrido de transporte (P5960)';
    END;
END $$;


-- ================================================================
-- 18. SIN BORRADO FÍSICO NI TRUNCATE EN LOS OBJETOS DE TRANSPORTE
-- ================================================================
DO $$
DECLARE
    v_rol        TEXT;
    v_tabla      TEXT;
    v_privilegio TEXT;
BEGIN
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.paradas_recorrido'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'FALLO 18: % conserva % sobre %', v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname ILIKE '%eliminar%recorrido%' OR p.proname ILIKE '%borrar%recorrido%'
               OR p.proname ILIKE '%eliminar%parada%' OR p.proname ILIKE '%borrar%parada%')
    ) THEN
        RAISE EXCEPTION 'FALLO 18: existe una función de eliminación de recorridos o paradas';
    END IF;

    RAISE NOTICE 'OK 18: ningún rol de aplicación puede borrar ni vaciar los objetos de transporte, y no existe RPC de eliminación';
END $$;


-- ================================================================
-- 19. BLOQUEO DE CUENTA (EPT-59) TAMBIÉN CUBRE TRANSPORTE
-- ================================================================
UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO'
WHERE id = 'b3333333-3333-4333-8333-333333333333';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b3333333-3333-4333-8333-333333333333"}', true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.paradas_recorrido) THEN
        RAISE EXCEPTION 'FALLO 19: un bloqueado lee las paradas de los recorridos';
    END IF;
    IF EXISTS (SELECT 1 FROM public.recorridos_transporte) THEN
        RAISE EXCEPTION 'FALLO 19: un bloqueado lee el catálogo de recorridos';
    END IF;

    BEGIN
        PERFORM public.establecer_recorrido_transporte('e0000000-0000-4000-8000-000000000021');
        RAISE EXCEPTION 'FALLO 19: un bloqueado pudo establecer un recorrido';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    RAISE NOTICE 'OK 19: una cuenta bloqueada (EPT-59) no lee ni escribe ningún objeto de transporte, aunque ya tuviera un recorrido activo';
END $$;

RESET ROLE;
UPDATE public.perfiles SET estado_acceso = 'HABILITADO'
WHERE id = 'b3333333-3333-4333-8333-333333333333';


-- ================================================================
-- 20. RLS, GRANTS, VISTA SECURITY_INVOKER Y FUNCIONES
-- ================================================================
DO $$
DECLARE
    v_firma pg_catalog.regprocedure;
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.paradas_recorrido'::regclass) THEN
        RAISE EXCEPTION 'FALLO 20: paradas_recorrido no tiene RLS';
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.paradas_recorrido', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.recorridos_transporte', 'SELECT')
       OR has_table_privilege('anon', 'public.paradas_recorrido', 'SELECT')
       OR has_table_privilege('anon', 'public.recorridos_transporte', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO 20: la lectura no quedó limitada a authenticated';
    END IF;

    IF NOT ('security_invoker=true' = ANY (
        COALESCE((SELECT reloptions FROM pg_class
                  WHERE oid = 'public.recorridos_transporte'::regclass), ARRAY[]::TEXT[])
    )) THEN
        RAISE EXCEPTION 'FALLO 20: la vista de recorridos no es security_invoker';
    END IF;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.establecer_recorrido_transporte(uuid)'::regprocedure,
        'app_private.actualizar_recorrido(uuid,text,boolean)'::regprocedure,
        'app_private.validar_parada_recorrido()'::regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO 20: % no es SECURITY DEFINER con search_path vacío o es ejecutable por anon', v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'public.establecer_recorrido_transporte(uuid)'::regprocedure,
        'public.actualizar_recorrido(uuid,text,boolean)'::regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO 20: el envoltorio % no es SECURITY INVOKER mínimo', v_firma;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.paradas_recorrido'::regclass AND contype = 'f' AND confdeltype <> 'r'
    ) THEN
        RAISE EXCEPTION 'FALLO 20: la clave foránea de paradas_recorrido no es ON DELETE RESTRICT';
    END IF;

    RAISE NOTICE 'OK 20: RLS activo, grants mínimos, vista security_invoker y funciones correctas';
END $$;


-- ================================================================
-- 21. SIN REGRESIÓN SOBRE EPT-10 (COMEDOR) NI SOBRE EL RESTO DEL MODELO
-- ================================================================
DO $$
DECLARE
    v_inicial BIGINT;
    v_actual  BIGINT;
BEGIN
    SELECT cantidad INTO v_inicial FROM ept60_huella_inscripciones_servicios;
    -- Esta prueba agregó filas (alta, cambios, comedor); lo que no debe pasar
    -- es que alguna quedara físicamente borrada.
    SELECT pg_catalog.count(*) INTO v_actual FROM public.inscripciones_servicios;
    IF v_actual < v_inicial THEN
        RAISE EXCEPTION 'FALLO 21: inscripciones_servicios perdió filas (% → %)', v_inicial, v_actual;
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.servicios_escolares WHERE tipo = 'COMEDOR') <> 1 THEN
        RAISE EXCEPTION 'FALLO 21: el servicio de comedor no sigue único';
    END IF;

    RAISE NOTICE 'OK 21: inscripciones_servicios no perdió filas y el comedor sigue siendo un único servicio';
END $$;

ROLLBACK;

-- Si el script llega hasta acá sin FALLO, las garantías de transporte de
-- EPT-60 quedan demostradas sin dejar datos.
