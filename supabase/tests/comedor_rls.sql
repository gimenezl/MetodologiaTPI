-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación del comedor (EPT-10)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. La numeración sigue
-- la lista de verificaciones obligatorias de EPT-10 (1–24); los casos
-- complementarios usan sufijos.
--
-- Cubre: objetos y columnas esperados, servicio de comedor reproducible, RLS
-- habilitado, grants exactos, anon denegado, alumno activo autorizado solo
-- sobre sí mismo, alumno inactivo denegado, perfil sin vínculo académico
-- denegado, estudiante ajeno denegado, consulta administrativa del DIRECTOR,
-- DOCENTE/PADRE/PERSONAL/sin perfil sin escritura, alta válida, duplicado
-- activo rechazado, cancelación lógica, reingreso, vínculo con el legajo
-- correcto, imposibilidad de falsificar el alumno, ausencia de DELETE y
-- TRUNCATE, conservación del historial, claves foráneas, secuencias y ausencia
-- de regresiones sobre los privilegios anteriores.

\set ON_ERROR_STOP on

BEGIN;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- Identidades de prueba. `auth.uid()` toma `sub` desde request.jwt.claims.
-- Los DNI se eligen en un rango libre para no chocar con datos existentes.
WITH base_libre AS (
    SELECT base
    FROM generate_series(93000000, 99999990, 10) AS g(base)
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
        ('d1111111-1111-4111-8111-111111111111'::UUID, 'DIRECTOR',   'Directora',  NULL,                 1),
        ('d2222222-2222-4222-8222-222222222222'::UUID, 'ESTUDIANTE', 'Activo',     'LEG-EPT10-0002',     2),
        ('d3333333-3333-4333-8333-333333333333'::UUID, 'ESTUDIANTE', 'Ajeno',      'LEG-EPT10-0003',     3),
        ('d4444444-4444-4444-8444-444444444444'::UUID, 'ESTUDIANTE', 'Inactivo',   NULL,                 4),
        ('d5555555-5555-4555-8555-555555555555'::UUID, 'DOCENTE',    'Docente',    NULL,                 5),
        ('d6666666-6666-4666-8666-666666666666'::UUID, 'PADRE',      'Padre',      NULL,                 6),
        ('d7777777-7777-4777-8777-777777777777'::UUID, 'PERSONAL',   'Personal',   NULL,                 7)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT i.id, i.id, r.id, 'Prueba', i.apellido, (b.base + i.desplazamiento)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- Curso de soporte para las matrículas.
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (
    'cc111111-1111-4111-8111-111111111111',
    (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
    'Curso comedor EPT-10', 'A', TRUE
);

-- El trigger de 008 ya creó una fila INACTIVA en `alumnos` para cada perfil
-- ESTUDIANTE. Se activan dos de los tres, con su matrícula vigente. El tercero
-- queda INACTIVO y sin legajo a propósito.
INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES
    ('d2222222-2222-4222-8222-222222222222', 'cc111111-1111-4111-8111-111111111111'),
    ('d3333333-3333-4333-8333-333333333333', 'cc111111-1111-4111-8111-111111111111');

UPDATE public.alumnos
SET estado = 'ACTIVO'
WHERE perfil_id IN (
    'd2222222-2222-4222-8222-222222222222',
    'd3333333-3333-4333-8333-333333333333'
);

-- La coherencia académica de 008 se comprueba en triggers diferidos; se fuerza
-- ahora para trabajar sobre un estado que la base ya considera válido.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Huella de `public.inscripciones` (actividades y deportes) antes de tocar
-- nada: EPT-10 no debe alterar esa tabla de ninguna forma (24).
CREATE TEMPORARY TABLE ept10_huella_inscripciones ON COMMIT DROP AS
SELECT pg_catalog.count(*) AS cantidad,
       pg_catalog.md5(COALESCE(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, estudiante_id, actividad_id, estado),
           ';' ORDER BY id
       ), '')) AS huella
FROM public.inscripciones;

GRANT SELECT ON ept10_huella_inscripciones TO authenticated;


-- ================================================================
-- 1. OBJETOS, COLUMNAS Y SEMILLA REPRODUCIBLE
-- ================================================================
DO $$
DECLARE
    v_columnas TEXT[];
    v_servicio public.servicios_escolares;
BEGIN
    IF pg_catalog.to_regclass('public.servicios_escolares') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios_detalle') IS NULL THEN
        RAISE EXCEPTION 'FALLO 1: falta algún objeto de servicios escolares';
    END IF;

    SELECT pg_catalog.array_agg(attname::TEXT ORDER BY attname)
    INTO v_columnas
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.inscripciones_servicios'::pg_catalog.regclass
      AND attnum > 0 AND NOT attisdropped;

    IF v_columnas IS DISTINCT FROM ARRAY[
        'alumno_id', 'estado', 'fecha_cancelacion', 'fecha_inscripcion', 'id', 'servicio_id'
    ] THEN
        RAISE EXCEPTION 'FALLO 1: las columnas de inscripciones_servicios son %', v_columnas;
    END IF;

    SELECT * INTO v_servicio
    FROM public.servicios_escolares WHERE codigo = 'COMEDOR';

    IF NOT FOUND OR v_servicio.tipo <> 'COMEDOR' OR NOT v_servicio.activo THEN
        RAISE EXCEPTION 'FALLO 1: el servicio de comedor no está sembrado y activo';
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.servicios_escolares) <> 1 THEN
        RAISE EXCEPTION 'FALLO 1: el catálogo sembró más de un servicio';
    END IF;

    RAISE NOTICE 'OK 1: objetos, columnas y semilla reproducible del comedor (id %)', v_servicio.id;
END $$;


-- ================================================================
-- 2–9. EL ALUMNO ACTIVO: ALTA, DUPLICADO, BAJA Y REINGRESO
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d2222222-2222-4222-8222-222222222222"}', true);

DO $$
DECLARE
    v_servicio_id UUID := (SELECT id FROM public.servicios_escolares WHERE codigo = 'COMEDOR');
    v_alta        public.inscripciones_servicios;
    v_baja        public.inscripciones_servicios;
    v_reingreso   public.inscripciones_servicios;
    v_detalle     RECORD;
BEGIN
    -- 2. Alta válida.
    v_alta := public.inscribir_en_servicio(v_servicio_id);
    IF v_alta.estado <> 'ACTIVA'
       OR v_alta.alumno_id <> 'd2222222-2222-4222-8222-222222222222'
       OR v_alta.servicio_id <> v_servicio_id
       OR v_alta.fecha_cancelacion IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 2: alta inválida: %', v_alta;
    END IF;
    RAISE NOTICE 'OK 2: un alumno ACTIVO se inscribe al comedor (id %)', v_alta.id;

    -- 3. El alumno de la inscripción es el de la sesión, nunca uno elegido.
    IF v_alta.alumno_id <> (SELECT app_private.perfil_actual()) THEN
        RAISE EXCEPTION 'FALLO 3: la inscripción no quedó ligada al perfil de la sesión';
    END IF;
    RAISE NOTICE 'OK 3: la inscripción se liga al perfil derivado de auth.uid()';

    -- 4. Vínculo con el legajo correcto, resuelto en la vista.
    SELECT * INTO v_detalle
    FROM public.inscripciones_servicios_detalle WHERE id = v_alta.id;

    IF NOT FOUND
       OR v_detalle.legajo_nro <> 'LEG-EPT10-0002'
       OR v_detalle.alumno_estado <> 'ACTIVO'
       OR v_detalle.servicio_codigo <> 'COMEDOR' THEN
        RAISE EXCEPTION 'FALLO 4: el detalle no resuelve el legajo correcto: %', v_detalle;
    END IF;
    RAISE NOTICE 'OK 4: la inscripción queda vinculada al legajo % del alumno de la sesión',
        v_detalle.legajo_nro;

    -- 5. Segunda inscripción activa rechazada por el índice único parcial.
    BEGIN
        PERFORM public.inscribir_en_servicio(v_servicio_id);
        RAISE EXCEPTION 'FALLO 5: se aceptó una segunda inscripción activa';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 5: la segunda inscripción activa se rechaza (23505)';
    END;

    -- 6. Cancelación lógica: no borra, sella la fecha.
    v_baja := public.cancelar_inscripcion_servicio(v_alta.id);
    IF v_baja.id <> v_alta.id
       OR v_baja.estado <> 'CANCELADA'
       OR v_baja.fecha_cancelacion IS NULL
       OR v_baja.fecha_inscripcion <> v_alta.fecha_inscripcion THEN
        RAISE EXCEPTION 'FALLO 6: la baja no es lógica ni conserva el alta: %', v_baja;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inscripciones_servicios WHERE id = v_alta.id) THEN
        RAISE EXCEPTION 'FALLO 6: la fila desapareció al cancelar';
    END IF;
    RAISE NOTICE 'OK 6: la cancelación es lógica y conserva la fila y su fecha de alta';

    -- 6bis. Cancelar dos veces no vuelve a ser posible.
    BEGIN
        PERFORM public.cancelar_inscripcion_servicio(v_alta.id);
        RAISE EXCEPTION 'FALLO 6bis: se canceló dos veces la misma inscripción';
    EXCEPTION WHEN SQLSTATE 'P5555' THEN
        RAISE NOTICE 'OK 6bis: una inscripción ya cancelada no se vuelve a cancelar (P5555)';
    END;

    -- 7. Reingreso: fila NUEVA, el ciclo anterior se conserva.
    v_reingreso := public.inscribir_en_servicio(v_servicio_id);
    IF v_reingreso.id = v_alta.id OR v_reingreso.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO 7: el reingreso reutilizó la fila cancelada: %', v_reingreso;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios
        WHERE alumno_id = 'd2222222-2222-4222-8222-222222222222') <> 2 THEN
        RAISE EXCEPTION 'FALLO 7: no se conservaron los dos ciclos';
    END IF;
    RAISE NOTICE 'OK 7: el reingreso crea una fila nueva y conserva el ciclo anterior';

    -- 8. Una inscripción cancelada no se reactiva por ninguna vía.
    BEGIN
        UPDATE public.inscripciones_servicios
        SET estado = 'ACTIVA', fecha_cancelacion = NULL
        WHERE id = v_alta.id;
        RAISE EXCEPTION 'FALLO 8: el alumno pudo reactivar una inscripción cancelada';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 8: el alumno no tiene privilegio de UPDATE directo sobre sus inscripciones';
    END;

    -- 9. Lectura propia: ve sus dos ciclos y nada más.
    IF (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios) <> 2 THEN
        RAISE EXCEPTION 'FALLO 9: el alumno ve un número de filas distinto del propio';
    END IF;
    RAISE NOTICE 'OK 9: el alumno lee exactamente sus dos inscripciones';
END $$;


-- ================================================================
-- 10–11. EL ESTUDIANTE AJENO NO ALCANZA NADA DE OTRA PERSONA
-- ================================================================
SELECT set_config('request.jwt.claims', '{"sub":"d3333333-3333-4333-8333-333333333333"}', true);

DO $$
DECLARE
    v_servicio_id UUID := (SELECT id FROM public.servicios_escolares WHERE codigo = 'COMEDOR');
    v_ajena       UUID;
    v_propia      public.inscripciones_servicios;
BEGIN
    -- 10. No ve ninguna inscripción de la otra persona.
    IF EXISTS (
        SELECT 1 FROM public.inscripciones_servicios
        WHERE alumno_id <> 'd3333333-3333-4333-8333-333333333333'
    ) THEN
        RAISE EXCEPTION 'FALLO 10: un estudiante ve inscripciones ajenas';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.inscripciones_servicios_detalle
        WHERE alumno_id <> 'd3333333-3333-4333-8333-333333333333'
    ) THEN
        RAISE EXCEPTION 'FALLO 10: la vista filtra un estudiante ajeno';
    END IF;
    RAISE NOTICE 'OK 10: un estudiante no lee ninguna inscripción ajena, ni en la tabla ni en la vista';

    -- 11. Tampoco puede cancelar la ajena, aunque conozca su identificador.
    RESET ROLE;
    SELECT id INTO v_ajena
    FROM public.inscripciones_servicios
    WHERE alumno_id = 'd2222222-2222-4222-8222-222222222222' AND estado = 'ACTIVA';
    SET LOCAL ROLE authenticated;

    BEGIN
        PERFORM public.cancelar_inscripcion_servicio(v_ajena);
        RAISE EXCEPTION 'FALLO 11: se canceló la inscripción de otra persona';
    EXCEPTION WHEN SQLSTATE 'P5555' THEN
        RAISE NOTICE 'OK 11: cancelar una inscripción ajena devuelve el mismo error que una inexistente (P5555)';
    END;

    -- 11bis. Su propia alta sigue funcionando y no colisiona con la ajena.
    v_propia := public.inscribir_en_servicio(v_servicio_id);
    IF v_propia.alumno_id <> 'd3333333-3333-4333-8333-333333333333' THEN
        RAISE EXCEPTION 'FALLO 11bis: el alta se atribuyó a otra persona';
    END IF;
    RAISE NOTICE 'OK 11bis: la unicidad es por alumno y servicio, no global';
END $$;


-- ================================================================
-- 12. EL ALUMNO INACTIVO NO SE INSCRIBE
-- ================================================================
SELECT set_config('request.jwt.claims', '{"sub":"d4444444-4444-4444-8444-444444444444"}', true);

DO $$
DECLARE
    v_servicio_id UUID := (SELECT id FROM public.servicios_escolares WHERE codigo = 'COMEDOR');
BEGIN
    BEGIN
        PERFORM public.inscribir_en_servicio(v_servicio_id);
        RAISE EXCEPTION 'FALLO 12: un alumno INACTIVO se inscribió';
    EXCEPTION WHEN SQLSTATE 'P5553' THEN
        RAISE NOTICE 'OK 12: un alumno INACTIVO no puede inscribirse (P5553)';
    END;

    IF EXISTS (
        SELECT 1 FROM public.inscripciones_servicios
        WHERE alumno_id = 'd4444444-4444-4444-8444-444444444444'
    ) THEN
        RAISE EXCEPTION 'FALLO 12: quedó una inscripción de un alumno INACTIVO';
    END IF;
END $$;


-- ================================================================
-- 13–15. LOS DEMÁS ACTORES NO ESCRIBEN NI LEEN LO AJENO
-- ================================================================
DO $$
DECLARE
    v_servicio_id UUID := (SELECT id FROM public.servicios_escolares WHERE codigo = 'COMEDOR');
    v_actor       RECORD;
    v_ajena       UUID;
BEGIN
    RESET ROLE;
    SELECT id INTO v_ajena
    FROM public.inscripciones_servicios
    WHERE alumno_id = 'd2222222-2222-4222-8222-222222222222' AND estado = 'ACTIVA';
    SET LOCAL ROLE authenticated;

    FOR v_actor IN
        SELECT * FROM (VALUES
            ('d5555555-5555-4555-8555-555555555555', 'DOCENTE'),
            ('d6666666-6666-4666-8666-666666666666', 'PADRE'),
            ('d7777777-7777-4777-8777-777777777777', 'PERSONAL'),
            ('d8888888-8888-4888-8888-888888888888', 'SIN PERFIL')
        ) AS t(sub, etiqueta)
    LOOP
        PERFORM set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', v_actor.sub)::TEXT, true);

        BEGIN
            PERFORM public.inscribir_en_servicio(v_servicio_id);
            RAISE EXCEPTION 'FALLO 13: % pudo inscribirse al comedor', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;
        END;

        BEGIN
            PERFORM public.cancelar_inscripcion_servicio(v_ajena);
            RAISE EXCEPTION 'FALLO 13: % pudo cancelar una inscripción ajena', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;
        END;

        -- 14. Tampoco leen ninguna inscripción: no son su dueño ni DIRECTOR.
        IF EXISTS (SELECT 1 FROM public.inscripciones_servicios) THEN
            RAISE EXCEPTION 'FALLO 14: % lee inscripciones de otras personas', v_actor.etiqueta;
        END IF;
        IF EXISTS (SELECT 1 FROM public.inscripciones_servicios_detalle) THEN
            RAISE EXCEPTION 'FALLO 14: % lee el detalle de otras personas', v_actor.etiqueta;
        END IF;

        -- 15. El catálogo institucional sí es legible: es la lectura mínima que
        -- el sistema ya necesita y no expone ningún dato personal.
        IF NOT EXISTS (SELECT 1 FROM public.servicios_escolares WHERE codigo = 'COMEDOR') THEN
            RAISE EXCEPTION 'FALLO 15: % no puede leer el catálogo de servicios', v_actor.etiqueta;
        END IF;
    END LOOP;

    RAISE NOTICE 'OK 13: DOCENTE, PADRE, PERSONAL y una cuenta sin perfil no inscriben ni cancelan (42501)';
    RAISE NOTICE 'OK 14: ninguno de esos actores lee inscripciones ajenas, ni en la tabla ni en la vista';
    RAISE NOTICE 'OK 15: el catálogo institucional de servicios es legible por cualquier sesión autenticada';
END $$;


-- ================================================================
-- 16–17. LA CONSULTA ADMINISTRATIVA DEL DIRECTOR
-- ================================================================
SELECT set_config('request.jwt.claims', '{"sub":"d1111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    v_servicio_id UUID := (SELECT id FROM public.servicios_escolares WHERE codigo = 'COMEDOR');
    v_activas     BIGINT;
    v_total       BIGINT;
    v_con_legajo  BIGINT;
    v_ajena       UUID;
BEGIN
    -- 16. Ve el listado completo con identificación, legajo y estado.
    SELECT pg_catalog.count(*) FILTER (WHERE estado = 'ACTIVA'),
           pg_catalog.count(*),
           pg_catalog.count(*) FILTER (
               WHERE legajo_nro IS NOT NULL
                 AND alumno_apellido IS NOT NULL
                 AND alumno_nombre IS NOT NULL
           )
    INTO v_activas, v_total, v_con_legajo
    FROM public.inscripciones_servicios_detalle;

    IF v_activas <> 2 OR v_total <> 3 OR v_con_legajo <> v_total THEN
        RAISE EXCEPTION
            'FALLO 16: el listado administrativo devolvió % activas de % filas, % con legajo',
            v_activas, v_total, v_con_legajo;
    END IF;
    RAISE NOTICE
        'OK 16: el DIRECTOR consulta % inscripción(es) activa(s) sobre % registro(s), con legajo y estado',
        v_activas, v_total;

    -- 17. Pero no adquiere la facultad de inscribir ni de cancelar: EPT-10 no
    -- se la atribuye, así que tampoco existe la superficie para ejercerla.
    BEGIN
        PERFORM public.inscribir_en_servicio(v_servicio_id);
        RAISE EXCEPTION 'FALLO 17: el DIRECTOR pudo inscribir a alguien al comedor';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    SELECT id INTO v_ajena
    FROM public.inscripciones_servicios
    WHERE alumno_id = 'd2222222-2222-4222-8222-222222222222' AND estado = 'ACTIVA';

    BEGIN
        PERFORM public.cancelar_inscripcion_servicio(v_ajena);
        RAISE EXCEPTION 'FALLO 17: el DIRECTOR pudo cancelar la inscripción de un alumno';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    RAISE NOTICE 'OK 17: el DIRECTOR consulta pero no inscribe ni cancela en nombre del alumno (42501)';
END $$;


-- ================================================================
-- 18. ANÓNIMO: NI LECTURA NI ESCRITURA
-- ================================================================
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', NULL, true);

DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM public.servicios_escolares;
        RAISE EXCEPTION 'FALLO 18: anon lee el catálogo de servicios';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        PERFORM 1 FROM public.inscripciones_servicios;
        RAISE EXCEPTION 'FALLO 18: anon lee las inscripciones';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        PERFORM 1 FROM public.inscripciones_servicios_detalle;
        RAISE EXCEPTION 'FALLO 18: anon lee el detalle de inscripciones';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        PERFORM public.inscribir_en_servicio('e0000000-0000-4000-8000-000000000010');
        RAISE EXCEPTION 'FALLO 18: anon pudo ejecutar el alta';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    RAISE NOTICE 'OK 18: anon no lee ni escribe ningún objeto del comedor';
END $$;

RESET ROLE;


-- ================================================================
-- 19. NO SE PUEDE FALSIFICAR EL ALUMNO NI POR PARÁMETRO NI POR ESCRITURA
-- ================================================================
DO $$
DECLARE
    v_argumentos TEXT[];
BEGIN
    -- Ninguna RPC del dominio acepta alumno, perfil, usuario, rol ni legajo.
    SELECT pg_catalog.array_agg(DISTINCT nombre)
    INTO v_argumentos
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
    WHERE n.nspname IN ('public', 'app_private')
      AND p.proname IN ('inscribir_en_servicio', 'cancelar_inscripcion_servicio');

    IF v_argumentos IS DISTINCT FROM ARRAY['p_inscripcion_id', 'p_servicio_id'] THEN
        RAISE EXCEPTION 'FALLO 19: los argumentos de las RPC son %', v_argumentos;
    END IF;

    RAISE NOTICE 'OK 19: las RPC solo aceptan el servicio o la inscripción; la identidad la deriva la base';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d3333333-3333-4333-8333-333333333333"}', true);

DO $$
BEGIN
    -- Escritura directa de una fila a nombre de otra persona.
    BEGIN
        INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
        VALUES ('d2222222-2222-4222-8222-222222222222',
                'e0000000-0000-4000-8000-000000000010');
        RAISE EXCEPTION 'FALLO 19bis: se insertó una inscripción a nombre de otra persona';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 19bis: no hay privilegio de INSERT directo sobre inscripciones_servicios';
    END;
END $$;

RESET ROLE;


-- ================================================================
-- 20. UN PERFIL SIN VÍNCULO ACADÉMICO NO PUEDE TENER INSCRIPCIÓN
-- ================================================================
-- Se comprueba como propietario de la tabla, que es el único actor capaz de
-- escribirla directamente: el trigger es la autoridad aunque se saltearan las
-- RPC y los privilegios.
DO $$
BEGIN
    BEGIN
        INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
        VALUES ('d5555555-5555-4555-8555-555555555555',
                'e0000000-0000-4000-8000-000000000010');
        RAISE EXCEPTION 'FALLO 20: se inscribió un perfil sin legajo académico';
    EXCEPTION
        -- El trigger BEFORE se adelanta a la clave foránea y da un motivo de
        -- dominio en lugar de un error de integridad genérico. Cualquiera de
        -- los dos rechaza la fila; se aceptan ambos para no atar la prueba al
        -- orden interno de PostgreSQL.
        WHEN SQLSTATE 'P5552' OR foreign_key_violation THEN
            RAISE NOTICE 'OK 20: un perfil sin fila en alumnos no puede inscribirse (P5552)';
    END;

    BEGIN
        INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id, estado)
        VALUES ('d2222222-2222-4222-8222-222222222222',
                'e0000000-0000-4000-8000-000000000010', 'CANCELADA');
        RAISE EXCEPTION 'FALLO 20bis: se sembró historial cancelado directamente';
    EXCEPTION WHEN SQLSTATE 'P5558' THEN
        RAISE NOTICE 'OK 20bis: una inscripción nueva solo nace ACTIVA (P5558)';
    END;

    BEGIN
        UPDATE public.inscripciones_servicios
        SET alumno_id = 'd3333333-3333-4333-8333-333333333333'
        WHERE alumno_id = 'd2222222-2222-4222-8222-222222222222'
          AND estado = 'ACTIVA';
        RAISE EXCEPTION 'FALLO 20ter: se reatribuyó una inscripción a otro alumno';
    EXCEPTION WHEN SQLSTATE 'P5557' THEN
        RAISE NOTICE 'OK 20ter: el alumno, el servicio y la fecha de alta son inmutables (P5557)';
    END;

    BEGIN
        UPDATE public.inscripciones_servicios
        SET estado = 'ACTIVA', fecha_cancelacion = NULL
        WHERE estado = 'CANCELADA';
        RAISE EXCEPTION 'FALLO 20quater: se reactivó una inscripción cancelada';
    EXCEPTION WHEN SQLSTATE 'P5558' THEN
        RAISE NOTICE 'OK 20quater: una inscripción cancelada no se reactiva (P5558)';
    END;
END $$;


-- ================================================================
-- 21. EL SERVICIO INACTIVO NO ADMITE ALTAS Y CONSERVA SU HISTORIAL
-- ================================================================
UPDATE public.servicios_escolares SET activo = FALSE WHERE codigo = 'COMEDOR';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d2222222-2222-4222-8222-222222222222"}', true);

DO $$
DECLARE
    v_servicio_id UUID := (SELECT id FROM public.servicios_escolares WHERE codigo = 'COMEDOR');
    v_activa      UUID;
BEGIN
    SELECT id INTO v_activa
    FROM public.inscripciones_servicios
    WHERE alumno_id = 'd2222222-2222-4222-8222-222222222222' AND estado = 'ACTIVA';

    -- Cancelar una inscripción existente sigue siendo posible: inactivar el
    -- servicio cierra las altas, no atrapa a quien ya está inscripto.
    PERFORM public.cancelar_inscripcion_servicio(v_activa);

    BEGIN
        PERFORM public.inscribir_en_servicio(v_servicio_id);
        RAISE EXCEPTION 'FALLO 21: se aceptó un alta sobre un servicio inactivo';
    EXCEPTION WHEN SQLSTATE 'P5551' THEN
        RAISE NOTICE 'OK 21: un servicio inactivo no admite altas y no atrapa a quien ya estaba inscripto (P5551)';
    END;
END $$;

RESET ROLE;

UPDATE public.servicios_escolares SET activo = TRUE WHERE codigo = 'COMEDOR';

DO $$
BEGIN
    -- La identidad de un servicio con inscripciones está protegida.
    BEGIN
        UPDATE public.servicios_escolares SET codigo = 'COMEDOR-2' WHERE codigo = 'COMEDOR';
        RAISE EXCEPTION 'FALLO 21bis: se cambió el código de un servicio con inscripciones';
    EXCEPTION WHEN SQLSTATE 'P5557' THEN
        RAISE NOTICE 'OK 21bis: un servicio con inscripciones no cambia de tipo ni de código (P5557)';
    END;
END $$;


-- ================================================================
-- 22. SIN BORRADO FÍSICO NI TRUNCATE
-- ================================================================
DO $$
DECLARE
    v_rol        TEXT;
    v_tabla      TEXT;
    v_privilegio TEXT;
BEGIN
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY[
            'public.servicios_escolares', 'public.inscripciones_servicios',
            'public.inscripciones_servicios_detalle'
        ] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'FALLO 22: % conserva % sobre %', v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('servicios_escolares', 'inscripciones_servicios')
          AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'FALLO 22: existe una política de escritura sobre el comedor';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname ILIKE '%eliminar%servicio%'
               OR p.proname ILIKE '%borrar%servicio%'
               OR p.proname ILIKE '%eliminar%inscripcion%'
               OR p.proname ILIKE '%borrar%inscripcion%')
    ) THEN
        RAISE EXCEPTION 'FALLO 22: existe una función de eliminación de inscripciones o servicios';
    END IF;

    RAISE NOTICE 'OK 22: ningún rol de aplicación puede borrar ni vaciar el comedor, y no existe RPC de eliminación';
END $$;


-- ================================================================
-- 23. RLS, GRANTS EXACTOS, VISTA SECURITY INVOKER, FUNCIONES Y SECUENCIAS
-- ================================================================
DO $$
DECLARE
    v_firma regprocedure;
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.servicios_escolares'::regclass)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inscripciones_servicios'::regclass) THEN
        RAISE EXCEPTION 'FALLO 23: falta RLS en alguna tabla del comedor';
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.servicios_escolares', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.inscripciones_servicios', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.inscripciones_servicios_detalle', 'SELECT')
       OR has_table_privilege('anon', 'public.servicios_escolares', 'SELECT')
       OR has_table_privilege('anon', 'public.inscripciones_servicios', 'SELECT')
       OR has_table_privilege('anon', 'public.inscripciones_servicios_detalle', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO 23: la lectura no quedó limitada a authenticated';
    END IF;

    IF NOT ('security_invoker=true' = ANY (
        COALESCE((SELECT reloptions FROM pg_class
                  WHERE oid = 'public.inscripciones_servicios_detalle'::regclass), ARRAY[]::TEXT[])
    )) THEN
        RAISE EXCEPTION 'FALLO 23: la vista de inscripciones no es security_invoker';
    END IF;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.inscribir_en_servicio(uuid)'::regprocedure,
        'app_private.cancelar_inscripcion_servicio(uuid)'::regprocedure,
        'app_private.validar_inscripcion_servicio()'::regprocedure,
        'app_private.proteger_identidad_servicio()'::regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO 23: % no es SECURITY DEFINER con search_path vacío o es ejecutable por anon', v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'public.rol_actual()'::regprocedure,
        'public.inscribir_en_servicio(uuid)'::regprocedure,
        'public.cancelar_inscripcion_servicio(uuid)'::regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO 23: el envoltorio % no es SECURITY INVOKER mínimo', v_firma;
        END IF;
    END LOOP;

    IF has_function_privilege('authenticated', 'app_private.validar_inscripcion_servicio()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'app_private.proteger_identidad_servicio()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALLO 23: authenticated puede ejecutar una función de trigger';
    END IF;

    IF has_schema_privilege('anon', 'app_private', 'USAGE') THEN
        RAISE EXCEPTION 'FALLO 23: anon tiene USAGE sobre app_private';
    END IF;

    -- Claves foráneas restrictivas y sin dependencia de secuencias.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.inscripciones_servicios'::regclass
          AND contype = 'f' AND confdeltype <> 'r'
    ) THEN
        RAISE EXCEPTION 'FALLO 23: una clave foránea de inscripciones_servicios no es ON DELETE RESTRICT';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid IN ('public.servicios_escolares'::regclass,
                             'public.inscripciones_servicios'::regclass)
          AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%nextval%'
    ) THEN
        RAISE EXCEPTION 'FALLO 23: una tabla del comedor depende de una secuencia';
    END IF;

    -- El índice único que garantiza la regla es PARCIAL sobre las activas.
    IF (SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_inscripciones_servicios_una_activa')
       NOT ILIKE '%WHERE%ACTIVA%' THEN
        RAISE EXCEPTION 'FALLO 23: la unicidad no es parcial sobre las inscripciones activas';
    END IF;

    RAISE NOTICE 'OK 23: RLS activo, grants mínimos, vista security_invoker, funciones correctas, FK restrictivas, sin secuencias y unicidad parcial';
END $$;


-- ================================================================
-- 24. SIN REGRESIONES SOBRE LO ANTERIOR
-- ================================================================
DO $$
DECLARE
    v_inicial RECORD;
    v_actual  RECORD;
BEGIN
    SELECT * INTO v_inicial FROM ept10_huella_inscripciones;
    SELECT pg_catalog.count(*) AS cantidad,
           pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, estudiante_id, actividad_id, estado),
               ';' ORDER BY id
           ), '')) AS huella
    INTO v_actual
    FROM public.inscripciones;

    IF v_actual.cantidad <> v_inicial.cantidad OR v_actual.huella <> v_inicial.huella THEN
        RAISE EXCEPTION 'FALLO 24: cambió public.inscripciones (% → %)', v_inicial, v_actual;
    END IF;

    -- Las políticas y los privilegios de las tablas anteriores siguen intactos.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'materias_cursos' AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'FALLO 24: cambiaron las políticas de materias_cursos';
    END IF;

    IF (SELECT pg_catalog.array_agg(attname::TEXT ORDER BY attname)
        FROM pg_attribute
        WHERE attrelid = 'public.actividades'::regclass AND attnum > 0 AND NOT attisdropped
          AND has_column_privilege('authenticated', attrelid, attnum, 'UPDATE'))
       IS DISTINCT FROM ARRAY['cupo_maximo'] THEN
        RAISE EXCEPTION 'FALLO 24: cambió el UPDATE directo permitido sobre actividades';
    END IF;

    IF has_table_privilege('authenticated', 'public.alumnos', 'INSERT')
       OR has_table_privilege('authenticated', 'public.alumnos', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.matriculas', 'INSERT')
       OR has_table_privilege('authenticated', 'public.matriculas', 'UPDATE') THEN
        RAISE EXCEPTION 'FALLO 24: se ampliaron los privilegios académicos de 008';
    END IF;

    RAISE NOTICE 'OK 24: public.inscripciones, materias, actividades y el modelo académico conservan filas y privilegios';
END $$;

ROLLBACK;

-- Si el script llega hasta acá sin FALLO, las garantías de persistencia,
-- integridad y seguridad de EPT-10 quedan demostradas sin dejar datos.
