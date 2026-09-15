-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de materias (EPT-56)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. La numeración sigue
-- la lista de verificaciones obligatorias de EPT-56 (1–28); los casos
-- complementarios usan sufijos.

\set ON_ERROR_STOP on

-- nextval no es transaccional. Se guarda el estado para restaurarlo al final.
SELECT last_value AS actividades_id_last_value,
       is_called  AS actividades_id_is_called
FROM public.actividades_id_seq
\gset estado_inicial_

BEGIN;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- Identidades de prueba. `auth.uid()` toma `sub` desde request.jwt.claims.
WITH base_libre AS (
    SELECT base
    FROM generate_series(94000000, 99999990, 10) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni = ANY (ARRAY[
            (base + 1)::TEXT, (base + 2)::TEXT, (base + 3)::TEXT,
            (base + 4)::TEXT, (base + 5)::TEXT, (base + 6)::TEXT
        ])
    )
    ORDER BY base
    LIMIT 1
), identidades(id, rol, apellido, desplazamiento) AS (
    VALUES
        ('b1111111-1111-4111-8111-111111111111'::UUID, 'DIRECTOR',   'Directora', 1),
        ('b2222222-2222-4222-8222-222222222222'::UUID, 'DOCENTE',    'Docente',   2),
        ('b2222222-2222-4222-8222-333333333333'::UUID, 'DOCENTE',    'Suplente',  3),
        ('b3333333-3333-4333-8333-333333333333'::UUID, 'ESTUDIANTE', 'Estudiante',4),
        ('b4444444-4444-4444-8444-444444444444'::UUID, 'PADRE',      'Padre',     5),
        ('b5555555-5555-4555-8555-555555555555'::UUID, 'PERSONAL',   'Personal',  6)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
SELECT i.id, i.id, r.id, 'Prueba', i.apellido, (b.base + i.desplazamiento)::TEXT
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- Cursos de soporte, creados como propietario.
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES
    ('c1111111-1111-4111-8111-111111111111',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso materias EPT-56', 'A', TRUE),
    ('c2222222-2222-4222-8222-222222222222',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso materias EPT-56', 'B', TRUE),
    ('c3333333-3333-4333-8333-333333333333',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso materias EPT-56', 'Z', FALSE);

-- Huella de deportes y talleres antes de cualquier operación de materias (28).
CREATE TEMPORARY TABLE ept56_huella_no_curricular ON COMMIT DROP AS
SELECT pg_catalog.count(*) AS cantidad,
       pg_catalog.md5(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, nombre, tipo, cupo_maximo, nivel_id, activo),
           ';' ORDER BY id
       )) AS huella
FROM public.actividades
WHERE tipo IS DISTINCT FROM 'CURRICULAR';

GRANT SELECT ON ept56_huella_no_curricular TO authenticated;

-- ================================================================
-- 1–8. CATÁLOGO DE MATERIAS COMO DIRECTOR
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    v_materia public.materias;
    v_otra    public.materias;
    v_caso    TEXT;
BEGIN
    v_materia := public.crear_materia('Matematica EPT56');
    IF v_materia.nombre <> 'Matematica EPT56' OR NOT v_materia.activo THEN
        RAISE EXCEPTION 'FALLO 1: alta inválida: %', v_materia;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.actividades
        WHERE id = v_materia.id AND tipo = 'CURRICULAR' AND activo AND nivel_id IS NULL
    ) THEN
        RAISE EXCEPTION 'FALLO 1: la materia no quedó como actividad CURRICULAR activa';
    END IF;
    RAISE NOTICE 'OK 1: un DIRECTOR crea una materia CURRICULAR activa (id %)', v_materia.id;

    BEGIN
        PERFORM public.crear_materia('');
        RAISE EXCEPTION 'FALLO 2: se aceptó un nombre vacío';
    EXCEPTION WHEN SQLSTATE 'P5530' THEN
        RAISE NOTICE 'OK 2: se rechaza el nombre vacío (P5530)';
    END;

    BEGIN
        PERFORM public.crear_materia(NULL);
        RAISE EXCEPTION 'FALLO 2bis: se aceptó un nombre nulo';
    EXCEPTION WHEN SQLSTATE 'P5530' THEN
        RAISE NOTICE 'OK 2bis: se rechaza el nombre nulo (P5530)';
    END;

    BEGIN
        PERFORM public.crear_materia(pg_catalog.repeat('x', 101));
        RAISE EXCEPTION 'FALLO 2ter: se aceptó un nombre de 101 caracteres';
    EXCEPTION WHEN SQLSTATE 'P5530' THEN
        RAISE NOTICE 'OK 2ter: se rechaza un nombre de más de 100 caracteres (P5530)';
    END;

    -- Contrato: la API recorta; la base rechaza lo que llegue sin recortar.
    FOREACH v_caso IN ARRAY ARRAY[
        ' Historia EPT56 ',
        E'\tHistoria EPT56',
        E'Historia EPT56\n',
        pg_catalog.chr(160) || 'Historia EPT56' || pg_catalog.chr(160)
    ] LOOP
        BEGIN
            PERFORM public.crear_materia(v_caso);
            RAISE EXCEPTION 'FALLO 3: se aceptó un nombre con espacios laterales: %', pg_catalog.quote_literal(v_caso);
        EXCEPTION WHEN SQLSTATE 'P5530' THEN
            NULL;
        END;
    END LOOP;
    RAISE NOTICE 'OK 3: la base rechaza espacios, tabulaciones, saltos y NBSP laterales (P5530); la API recorta antes';

    BEGIN
        PERFORM public.crear_materia('MATEMATICA ept56');
        RAISE EXCEPTION 'FALLO 4: se aceptó un duplicado por mayúsculas';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 4: se rechaza un duplicado que solo difiere en mayúsculas (23505)';
    END;

    PERFORM public.crear_materia('Lengua y Literatura');
    BEGIN
        PERFORM public.crear_materia('LENGUA Y LITERATURA');
        RAISE EXCEPTION 'FALLO 4bis: se aceptó un duplicado con acentos y mayúsculas';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
    PERFORM public.crear_materia('Educación Física');
    BEGIN
        PERFORM public.crear_materia('EDUCACIÓN FÍSICA');
        RAISE EXCEPTION 'FALLO 4bis: se aceptó un duplicado con vocales acentuadas';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 4bis: la comparación normalizada también cubre vocales acentuadas (23505)';
    END;

    -- Un duplicado con espacios nunca llega a compararse sin recortar: la base
    -- lo rechaza por contrato y, recortado por la API, es un duplicado exacto.
    BEGIN
        PERFORM public.crear_materia(' Matematica EPT56 ');
        RAISE EXCEPTION 'FALLO 5: se aceptó un duplicado con espacios';
    EXCEPTION WHEN SQLSTATE 'P5530' THEN
        NULL;
    END;
    BEGIN
        PERFORM public.crear_materia(pg_catalog.btrim(' matematica ept56 '));
        RAISE EXCEPTION 'FALLO 5: se aceptó el duplicado ya recortado';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 5: un duplicado por espacios se rechaza como inválido sin recortar (P5530) y como duplicado una vez recortado (23505)';
    END;

    -- El renombrado aplica el mismo contrato de nombre y de unicidad.
    v_otra := public.crear_materia('Geografia EPT56');
    BEGIN
        PERFORM public.renombrar_materia(v_otra.id, 'matematica EPT56');
        RAISE EXCEPTION 'FALLO 5bis: el renombrado aceptó un duplicado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
    v_otra := public.renombrar_materia(v_otra.id, 'Geografía EPT56');
    IF v_otra.nombre <> 'Geografía EPT56' THEN
        RAISE EXCEPTION 'FALLO 5bis: no se renombró la materia';
    END IF;
    -- Cambiar solo mayúsculas de la propia materia no es un duplicado de otra.
    v_otra := public.renombrar_materia(v_otra.id, 'GEOGRAFÍA EPT56');
    RAISE NOTICE 'OK 5bis: el renombrado conserva el id, rechaza duplicados y admite corregir mayúsculas propias';

    BEGIN
        PERFORM public.renombrar_materia(2147483647, 'Inexistente');
        RAISE EXCEPTION 'FALLO 5ter: se renombró una materia inexistente';
    EXCEPTION WHEN SQLSTATE 'P5531' THEN
        NULL;
    END;
    BEGIN
        PERFORM public.renombrar_materia(
            (SELECT id FROM public.actividades WHERE tipo = 'DEPORTE' ORDER BY id LIMIT 1),
            'Deporte renombrado');
        RAISE EXCEPTION 'FALLO 5ter: se renombró un deporte mediante la RPC de materias';
    EXCEPTION WHEN SQLSTATE 'P5531' THEN
        RAISE NOTICE 'OK 5ter: la RPC no alcanza materias inexistentes ni deportes o talleres (P5531)';
    END;

    PERFORM public.cambiar_estado_materia(v_otra.id, FALSE);
    IF NOT EXISTS (SELECT 1 FROM public.actividades WHERE id = v_otra.id AND NOT activo) THEN
        RAISE EXCEPTION 'FALLO 6: la materia no quedó inactiva o perdió su fila';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.materias WHERE id = v_otra.id AND NOT activo) THEN
        RAISE EXCEPTION 'FALLO 6: el catálogo dejó de listar la materia inactiva';
    END IF;
    RAISE NOTICE 'OK 6: la inactivación es lógica y la fila sigue en el catálogo';

    v_otra := public.cambiar_estado_materia(v_otra.id, TRUE);
    IF NOT v_otra.activo THEN
        RAISE EXCEPTION 'FALLO 7: la materia no se reactivó';
    END IF;
    RAISE NOTICE 'OK 7: un DIRECTOR reactiva la materia';

    BEGIN
        PERFORM public.cambiar_estado_materia(v_otra.id, NULL);
        RAISE EXCEPTION 'FALLO 7bis: se aceptó un estado nulo';
    EXCEPTION WHEN SQLSTATE 'P5539' THEN
        RAISE NOTICE 'OK 7bis: se rechaza un estado nulo (P5539)';
    END;

    BEGIN
        DELETE FROM public.actividades WHERE id = v_materia.id;
        RAISE EXCEPTION 'FALLO 8: DIRECTOR borró físicamente una materia';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname ILIKE '%eliminar%materia%' OR p.proname ILIKE '%borrar%materia%'
               OR p.proname ILIKE '%eliminar%asignacion%' OR p.proname ILIKE '%borrar%asignacion%')
    ) THEN
        RAISE EXCEPTION 'FALLO 8: existe una RPC de eliminación';
    END IF;
    RAISE NOTICE 'OK 8: no existe DELETE directo (42501) ni RPC de eliminación';
END $$;

RESET ROLE;

-- ================================================================
-- 9–17. ASIGNACIONES CURSO–MATERIA COMO DIRECTOR
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    v_materia     INTEGER := (SELECT id FROM public.materias WHERE nombre = 'Matematica EPT56');
    v_inactiva    public.materias;
    v_asignacion  public.materias_cursos;
    v_segunda     public.materias_cursos;
    v_creacion    TIMESTAMPTZ;
BEGIN
    v_asignacion := public.asignar_materia_curso(v_materia, 'c1111111-1111-4111-8111-111111111111');
    IF v_asignacion.materia_id <> v_materia
       OR v_asignacion.curso_id <> 'c1111111-1111-4111-8111-111111111111'
       OR v_asignacion.profesor_id IS NOT NULL
       OR NOT v_asignacion.activo THEN
        RAISE EXCEPTION 'FALLO 9: asignación inválida: %', v_asignacion;
    END IF;
    RAISE NOTICE 'OK 9: un DIRECTOR asigna una materia a un curso activo sin profesor';

    -- Muchos a muchos: la misma materia en otro curso, otra materia en el mismo curso.
    v_segunda := public.asignar_materia_curso(v_materia, 'c2222222-2222-4222-8222-222222222222',
                                              'b2222222-2222-4222-8222-222222222222');
    PERFORM public.asignar_materia_curso(
        (SELECT id FROM public.materias WHERE nombre = 'Lengua y Literatura'),
        'c1111111-1111-4111-8111-111111111111');
    IF (SELECT pg_catalog.count(*) FROM public.materias_cursos WHERE materia_id = v_materia) <> 2
       OR (SELECT pg_catalog.count(*) FROM public.materias_cursos
           WHERE curso_id = 'c1111111-1111-4111-8111-111111111111') <> 2 THEN
        RAISE EXCEPTION 'FALLO 9bis: la relación no es muchos a muchos';
    END IF;
    RAISE NOTICE 'OK 9bis: una materia admite varios cursos y un curso admite varias materias';

    BEGIN
        PERFORM public.asignar_materia_curso(v_materia, 'cfffffff-ffff-4fff-8fff-ffffffffffff');
        RAISE EXCEPTION 'FALLO 10: se asignó un curso inexistente';
    EXCEPTION WHEN SQLSTATE 'P5532' THEN
        RAISE NOTICE 'OK 10: se rechaza un curso inexistente (P5532)';
    END;

    BEGIN
        PERFORM public.asignar_materia_curso(v_materia, 'c3333333-3333-4333-8333-333333333333');
        RAISE EXCEPTION 'FALLO 11: se asignó un curso inactivo';
    EXCEPTION WHEN SQLSTATE 'P5537' THEN
        RAISE NOTICE 'OK 11: se rechaza un curso inactivo (P5537)';
    END;

    BEGIN
        PERFORM public.asignar_materia_curso(v_materia, 'c1111111-1111-4111-8111-111111111111');
        RAISE EXCEPTION 'FALLO 12: se duplicó la asignación';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 12: se rechaza la combinación Curso–Materia duplicada (23505)';
    END;

    v_creacion := v_asignacion.fecha_creacion;
    v_asignacion := public.cambiar_profesor_asignacion(v_asignacion.id, 'b2222222-2222-4222-8222-222222222222');
    IF v_asignacion.profesor_id <> 'b2222222-2222-4222-8222-222222222222' THEN
        RAISE EXCEPTION 'FALLO 13: no se asignó el profesor DOCENTE';
    END IF;
    v_asignacion := public.cambiar_profesor_asignacion(v_asignacion.id, 'b2222222-2222-4222-8222-333333333333');
    IF v_asignacion.profesor_id <> 'b2222222-2222-4222-8222-333333333333'
       OR v_asignacion.fecha_creacion <> v_creacion THEN
        RAISE EXCEPTION 'FALLO 13: no se reemplazó el profesor o cambió la fecha de creación';
    END IF;
    v_asignacion := public.cambiar_profesor_asignacion(v_asignacion.id, NULL);
    IF v_asignacion.profesor_id IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 13: no se pudo quitar el profesor responsable';
    END IF;
    v_asignacion := public.cambiar_profesor_asignacion(v_asignacion.id, 'b2222222-2222-4222-8222-222222222222');
    IF v_segunda.profesor_id <> 'b2222222-2222-4222-8222-222222222222' THEN
        RAISE EXCEPTION 'FALLO 13: el alta con profesor DOCENTE no lo conservó';
    END IF;
    RAISE NOTICE 'OK 13: un profesor DOCENTE se asigna en el alta, se reemplaza y se quita conservando la asignación';

    BEGIN
        PERFORM public.cambiar_profesor_asignacion(v_asignacion.id, 'b3333333-3333-4333-8333-333333333333');
        RAISE EXCEPTION 'FALLO 14: se aceptó un ESTUDIANTE como profesor';
    EXCEPTION WHEN SQLSTATE 'P5535' THEN
        NULL;
    END;
    BEGIN
        PERFORM public.asignar_materia_curso(
            (SELECT id FROM public.materias WHERE nombre = 'Educación Física'),
            'c1111111-1111-4111-8111-111111111111',
            'b1111111-1111-4111-8111-111111111111');
        RAISE EXCEPTION 'FALLO 14: se aceptó una DIRECTORA como profesora';
    EXCEPTION WHEN SQLSTATE 'P5535' THEN
        NULL;
    END;
    IF (SELECT profesor_id FROM public.materias_cursos WHERE id = v_asignacion.id)
       <> 'b2222222-2222-4222-8222-222222222222' THEN
        RAISE EXCEPTION 'FALLO 14: el rechazo alteró el profesor vigente';
    END IF;
    RAISE NOTICE 'OK 14: se rechaza un perfil con rol distinto de DOCENTE en alta y en cambio (P5535)';

    BEGIN
        PERFORM public.cambiar_profesor_asignacion(v_asignacion.id, 'bfffffff-ffff-4fff-8fff-ffffffffffff');
        RAISE EXCEPTION 'FALLO 15: se aceptó un profesor inexistente';
    EXCEPTION WHEN SQLSTATE 'P5533' THEN
        RAISE NOTICE 'OK 15: se rechaza un profesor inexistente (P5533)';
    END;

    BEGIN
        PERFORM public.cambiar_profesor_asignacion('afffffff-ffff-4fff-8fff-ffffffffffff', NULL);
        RAISE EXCEPTION 'FALLO 15bis: se modificó una asignación inexistente';
    EXCEPTION WHEN SQLSTATE 'P5534' THEN
        RAISE NOTICE 'OK 15bis: se rechaza una asignación inexistente (P5534)';
    END;

    v_inactiva := public.crear_materia('Materia inactiva EPT56');
    PERFORM public.cambiar_estado_materia(v_inactiva.id, FALSE);
    BEGIN
        PERFORM public.asignar_materia_curso(v_inactiva.id, 'c1111111-1111-4111-8111-111111111111');
        RAISE EXCEPTION 'FALLO 16: una materia inactiva admitió una asignación nueva';
    EXCEPTION WHEN SQLSTATE 'P5536' THEN
        RAISE NOTICE 'OK 16: una materia inactiva no admite nuevas asignaciones (P5536)';
    END;

    BEGIN
        PERFORM public.asignar_materia_curso(
            (SELECT id FROM public.actividades WHERE tipo = 'TALLER' ORDER BY id LIMIT 1),
            'c1111111-1111-4111-8111-111111111111');
        RAISE EXCEPTION 'FALLO 16bis: se asignó un taller como materia';
    EXCEPTION WHEN SQLSTATE 'P5531' THEN
        RAISE NOTICE 'OK 16bis: solo actividades CURRICULAR pueden asignarse como materia (P5531)';
    END;

    -- 17. Inactivar la materia, el curso y el perfil del profesor no borra la
    -- asignación, no cambia su profesor y la vista histórica la sigue mostrando.
    PERFORM public.cambiar_estado_materia(v_materia, FALSE);
    IF (SELECT pg_catalog.count(*) FROM public.materias_cursos_detalle
        WHERE materia_id = v_materia AND NOT materia_activa AND activo
          AND profesor_id IS NOT NULL) <> 2 THEN
        RAISE EXCEPTION 'FALLO 17: se perdió o alteró la relación histórica al inactivar la materia';
    END IF;

    -- Inactivar una asignación está permitido aunque la materia esté inactiva.
    PERFORM public.cambiar_estado_asignacion(v_asignacion.id, FALSE);
    BEGIN
        PERFORM public.cambiar_estado_asignacion(v_asignacion.id, TRUE);
        RAISE EXCEPTION 'FALLO 17: se reactivó la asignación de una materia inactiva';
    EXCEPTION WHEN SQLSTATE 'P5536' THEN
        NULL;
    END;
    IF (SELECT activo FROM public.materias_cursos WHERE id = v_asignacion.id) IS NOT FALSE THEN
        RAISE EXCEPTION 'FALLO 17: la reactivación rechazada dejó la asignación activa';
    END IF;

    BEGIN
        PERFORM public.cambiar_profesor_asignacion(v_asignacion.id, 'b2222222-2222-4222-8222-333333333333');
        RAISE EXCEPTION 'FALLO 17: se cambió el profesor de una asignación inactiva';
    EXCEPTION WHEN SQLSTATE 'P5538' THEN
        NULL;
    END;
    RAISE NOTICE 'OK 17: inactivar la materia conserva sus asignaciones y profesores; una asignación inactiva no se reactiva ni cambia de profesor mientras la materia está inactiva (P5536, P5538)';
END $$;

RESET ROLE;

-- El curso y el perfil docente se modifican como propietario: la
-- administración de cursos y de roles no pertenece a EPT-56.
UPDATE public.cursos SET activo = FALSE WHERE id = 'c2222222-2222-4222-8222-222222222222';
UPDATE public.perfiles
SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
WHERE id = 'b2222222-2222-4222-8222-222222222222';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    v_materia INTEGER := (SELECT id FROM public.materias WHERE nombre = 'Matematica EPT56');
    v_fila    public.materias_cursos_detalle;
BEGIN
    SELECT * INTO v_fila FROM public.materias_cursos_detalle
    WHERE materia_id = v_materia AND curso_id = 'c2222222-2222-4222-8222-222222222222';

    IF v_fila.id IS NULL
       OR v_fila.curso_activo
       OR v_fila.profesor_id <> 'b2222222-2222-4222-8222-222222222222'
       OR v_fila.profesor_apellido <> 'Docente' THEN
        RAISE EXCEPTION 'FALLO 17bis: la asignación histórica no sobrevivió a la inactivación del curso o al cambio de rol del profesor: %', v_fila;
    END IF;
    RAISE NOTICE 'OK 17bis: la asignación histórica sobrevive al curso inactivo y al profesor que dejó de ser DOCENTE';

    PERFORM public.cambiar_estado_materia(v_materia, TRUE);
    PERFORM public.cambiar_estado_asignacion(v_fila.id, FALSE);
    BEGIN
        PERFORM public.cambiar_estado_asignacion(v_fila.id, TRUE);
        RAISE EXCEPTION 'FALLO 17ter: se reactivó una asignación de un curso inactivo';
    EXCEPTION WHEN SQLSTATE 'P5537' THEN
        RAISE NOTICE 'OK 17ter: una asignación de curso inactivo no se reactiva (P5537)';
    END;

    PERFORM public.cambiar_estado_asignacion(
        (SELECT id FROM public.materias_cursos
         WHERE materia_id = v_materia AND curso_id = 'c1111111-1111-4111-8111-111111111111'),
        TRUE);
    RAISE NOTICE 'OK 17quater: con materia y curso activos la asignación se reactiva';
END $$;

RESET ROLE;

-- La integridad no depende de la RPC: se prueba el trigger como propietario.
DO $$
DECLARE
    v_materia INTEGER := (SELECT id FROM public.materias WHERE nombre = 'Matematica EPT56');
    v_id      UUID := (SELECT id FROM public.materias_cursos
                       WHERE materia_id = v_materia
                         AND curso_id = 'c1111111-1111-4111-8111-111111111111');
BEGIN
    BEGIN
        UPDATE public.materias_cursos
        SET curso_id = 'c2222222-2222-4222-8222-222222222222'
        WHERE id = v_id;
        RAISE EXCEPTION 'FALLO 17cinco: se cambió el curso de una asignación';
    EXCEPTION WHEN SQLSTATE 'P5540' THEN
        NULL;
    END;

    BEGIN
        UPDATE public.actividades SET tipo = 'TALLER' WHERE id = v_materia;
        RAISE EXCEPTION 'FALLO 17cinco: una materia con asignaciones cambió de tipo';
    EXCEPTION WHEN SQLSTATE 'P5540' THEN
        NULL;
    END;

    BEGIN
        INSERT INTO public.actividades (nombre, tipo) VALUES (' Directa EPT56 ', 'CURRICULAR');
        RAISE EXCEPTION 'FALLO 17cinco: la tabla aceptó una materia con espacios laterales';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        DELETE FROM public.actividades WHERE id = v_materia;
        RAISE EXCEPTION 'FALLO 17cinco: se borró una materia con asignaciones';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;
    RAISE NOTICE 'OK 17cinco: aun sin RPC, la base impide cambiar la identidad de una asignación (P5540), el tipo de una materia asignada (P5540), nombres sin recortar (23514) y el borrado con historial (23503)';
END $$;

-- ================================================================
-- 18–23. DENEGACIÓN POR ACTOR
-- ================================================================
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    actor      RECORD;
    v_materia  INTEGER := (SELECT id FROM public.actividades
                           WHERE tipo = 'CURRICULAR' AND nombre = 'Matematica EPT56');
    v_afectadas BIGINT;
    v_numero   TEXT;
BEGIN
    FOR actor IN
        SELECT * FROM (VALUES
            ('18', 'ESTUDIANTE', 'b3333333-3333-4333-8333-333333333333'),
            ('19', 'DOCENTE',    'b2222222-2222-4222-8222-333333333333'),
            ('20', 'PADRE',      'b4444444-4444-4444-8444-444444444444'),
            ('21', 'PERSONAL',   'b5555555-5555-4555-8555-555555555555'),
            ('22', 'SIN PERFIL', 'b6666666-6666-4666-8666-666666666666')
        ) AS actores(numero, rol, user_id)
    LOOP
        v_numero := actor.numero;
        PERFORM set_config('request.jwt.claims', pg_catalog.format('{"sub":"%s"}', actor.user_id), true);

        BEGIN
            PERFORM public.crear_materia('Denegada ' || actor.rol);
            RAISE EXCEPTION 'FALLO %: % creó una materia', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            PERFORM public.renombrar_materia(v_materia, 'Renombrada por ' || actor.rol);
            RAISE EXCEPTION 'FALLO %: % renombró una materia', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            PERFORM public.cambiar_estado_materia(v_materia, FALSE);
            RAISE EXCEPTION 'FALLO %: % inactivó una materia', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            PERFORM public.asignar_materia_curso(
                (SELECT id FROM public.actividades WHERE nombre = 'Educación Física'),
                'c1111111-1111-4111-8111-111111111111');
            RAISE EXCEPTION 'FALLO %: % asignó una materia', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            PERFORM public.cambiar_profesor_asignacion('afffffff-ffff-4fff-8fff-ffffffffffff', NULL);
            RAISE EXCEPTION 'FALLO %: % cambió un profesor', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            PERFORM public.cambiar_estado_asignacion('afffffff-ffff-4fff-8fff-ffffffffffff', FALSE);
            RAISE EXCEPTION 'FALLO %: % cambió el estado de una asignación', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        -- Las funciones privadas revalidan el rol aunque se invoquen directo.
        BEGIN
            PERFORM app_private.crear_materia('Privada ' || actor.rol);
            RAISE EXCEPTION 'FALLO %: % creó por la función privada', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            INSERT INTO public.actividades (nombre, tipo) VALUES ('Directa ' || actor.rol, 'CURRICULAR');
            RAISE EXCEPTION 'FALLO %: % insertó una actividad', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            UPDATE public.actividades SET activo = FALSE WHERE id = v_materia;
            RAISE EXCEPTION 'FALLO %: % cambió activo directamente', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            INSERT INTO public.materias_cursos (materia_id, curso_id)
            VALUES (v_materia, 'c2222222-2222-4222-8222-222222222222');
            RAISE EXCEPTION 'FALLO %: % insertó una asignación', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            UPDATE public.materias_cursos SET profesor_id = NULL;
            RAISE EXCEPTION 'FALLO %: % actualizó asignaciones', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        BEGIN
            DELETE FROM public.materias_cursos;
            RAISE EXCEPTION 'FALLO %: % borró asignaciones', v_numero, actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        -- Ningún rol distinto de DIRECTOR lee las asignaciones: cero filas, sin error.
        IF EXISTS (SELECT 1 FROM public.materias_cursos)
           OR EXISTS (SELECT 1 FROM public.materias_cursos_detalle) THEN
            RAISE EXCEPTION 'FALLO %: % leyó asignaciones de materias', v_numero, actor.rol;
        END IF;

        RAISE NOTICE 'OK %: % no crea, renombra, inactiva ni asigna materias por RPC, función privada o escritura directa (42501) y no lee asignaciones', v_numero, actor.rol;
    END LOOP;

    -- La denegación no alteró nada.
    PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

RESET ROLE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.actividades
        WHERE nombre = 'Matematica EPT56' AND tipo = 'CURRICULAR' AND activo
    ) OR EXISTS (SELECT 1 FROM public.actividades WHERE nombre LIKE 'Denegada %'
                                                    OR nombre LIKE 'Privada %'
                                                    OR nombre LIKE 'Directa %') THEN
        RAISE EXCEPTION 'FALLO 22bis: una denegación dejó efectos persistidos';
    END IF;
    RAISE NOTICE 'OK 22bis: ninguna denegación dejó filas nuevas ni cambios de estado';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', NULL, true);

DO $$
BEGIN
    BEGIN
        PERFORM app_private.crear_materia('Sin identidad');
        RAISE EXCEPTION 'FALLO 22ter: authenticated sin auth.uid() creó una materia';
    EXCEPTION WHEN SQLSTATE 'P5505' THEN
        RAISE NOTICE 'OK 22ter: la operación privada exige auth.uid() real (P5505)';
    END;
END $$;

RESET ROLE;
SET LOCAL ROLE anon;

DO $$
BEGIN
    BEGIN
        PERFORM public.crear_materia('Anon');
        RAISE EXCEPTION 'FALLO 23: anon ejecutó crear_materia';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.asignar_materia_curso(1, 'c1111111-1111-4111-8111-111111111111');
        RAISE EXCEPTION 'FALLO 23: anon ejecutó asignar_materia_curso';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        INSERT INTO public.actividades (nombre, tipo) VALUES ('Anon directa', 'CURRICULAR');
        RAISE EXCEPTION 'FALLO 23: anon insertó una actividad';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM 1 FROM public.materias_cursos;
        RAISE EXCEPTION 'FALLO 23: anon leyó asignaciones';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM 1 FROM public.materias;
        RAISE EXCEPTION 'FALLO 23: anon leyó la vista de materias';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    RAISE NOTICE 'OK 23: anon no ejecuta RPC, no escribe y no lee objetos de materias (42501)';
END $$;

RESET ROLE;

-- ================================================================
-- 24–27. ACL, SECUENCIAS, FUNCIONES Y SUPERFICIE SOBRE DEPORTES
-- ================================================================
DO $$
DECLARE
    v_rol        TEXT;
    v_privilegio TEXT;
    v_firma      REGPROCEDURE;
BEGIN
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_privilegio IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF has_table_privilege(v_rol, 'public.materias_cursos', v_privilegio)
               OR has_table_privilege(v_rol, 'public.materias', v_privilegio)
               OR has_table_privilege(v_rol, 'public.materias_cursos_detalle', v_privilegio) THEN
                RAISE EXCEPTION 'FALLO 24: % conserva % sobre un objeto de materias', v_rol, v_privilegio;
            END IF;
        END LOOP;
        FOREACH v_privilegio IN ARRAY ARRAY['INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF has_table_privilege(v_rol, 'public.actividades', v_privilegio) THEN
                RAISE EXCEPTION 'FALLO 24: % conserva % sobre actividades', v_rol, v_privilegio;
            END IF;
        END LOOP;
        FOREACH v_privilegio IN ARRAY ARRAY['nombre', 'tipo', 'activo', 'nivel_id', 'id'] LOOP
            IF has_column_privilege(v_rol, 'public.actividades', v_privilegio, 'UPDATE') THEN
                RAISE EXCEPTION 'FALLO 24: % puede actualizar actividades.%', v_rol, v_privilegio;
            END IF;
        END LOOP;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'public.materias_cursos', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.materias', 'SELECT')
       OR has_table_privilege('anon', 'public.materias_cursos', 'SELECT')
       OR has_table_privilege('anon', 'public.materias', 'SELECT')
       OR has_table_privilege('anon', 'public.materias_cursos_detalle', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO 24: la lectura no quedó limitada a authenticated';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.materias_cursos'::regclass)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.actividades'::regclass) THEN
        RAISE EXCEPTION 'FALLO 24: una tabla de materias no tiene RLS';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = 'materias_cursos' AND cmd <> 'SELECT') THEN
        RAISE EXCEPTION 'FALLO 24: materias_cursos tiene una política de escritura';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class c
        WHERE c.oid IN ('public.materias'::regclass, 'public.materias_cursos_detalle'::regclass)
          AND NOT ('security_invoker=true' = ANY (COALESCE(c.reloptions, ARRAY[]::TEXT[])))
    ) THEN
        RAISE EXCEPTION 'FALLO 24: una vista de materias no es security_invoker';
    END IF;
    RAISE NOTICE 'OK 24: sin grants residuales de escritura, lectura solo autenticada, RLS activo, sin políticas de escritura y vistas security_invoker';

    IF has_sequence_privilege('anon', 'public.actividades_id_seq', 'USAGE')
       OR has_sequence_privilege('authenticated', 'public.actividades_id_seq', 'USAGE')
       OR has_sequence_privilege('authenticated', 'public.actividades_id_seq', 'UPDATE') THEN
        RAISE EXCEPTION 'FALLO 25: la secuencia de actividades quedó expuesta';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.materias_cursos'::regclass
          AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%nextval%'
    ) THEN
        RAISE EXCEPTION 'FALLO 25: materias_cursos depende de una secuencia';
    END IF;
    RAISE NOTICE 'OK 25: ninguna secuencia de materias es utilizable por anon o authenticated';

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.crear_materia(text)'::regprocedure,
        'app_private.renombrar_materia(integer,text)'::regprocedure,
        'app_private.cambiar_estado_materia(integer,boolean)'::regprocedure,
        'app_private.asignar_materia_curso(integer,uuid,uuid)'::regprocedure,
        'app_private.cambiar_profesor_asignacion(uuid,uuid)'::regprocedure,
        'app_private.cambiar_estado_asignacion(uuid,boolean)'::regprocedure,
        'app_private.validar_asignacion_materia()'::regprocedure,
        'app_private.proteger_tipo_materia()'::regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO 26: % no es SECURITY DEFINER con search_path vacío o es ejecutable por anon', v_firma;
        END IF;
    END LOOP;
    FOREACH v_firma IN ARRAY ARRAY[
        'public.crear_materia(text)'::regprocedure,
        'public.renombrar_materia(integer,text)'::regprocedure,
        'public.cambiar_estado_materia(integer,boolean)'::regprocedure,
        'public.asignar_materia_curso(integer,uuid,uuid)'::regprocedure,
        'public.cambiar_profesor_asignacion(uuid,uuid)'::regprocedure,
        'public.cambiar_estado_asignacion(uuid,boolean)'::regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO 26: el wrapper % no es SECURITY INVOKER mínimo', v_firma;
        END IF;
    END LOOP;
    IF has_function_privilege('authenticated', 'app_private.validar_asignacion_materia()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'app_private.proteger_tipo_materia()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALLO 26: authenticated puede ejecutar una función de trigger';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_materia', 'renombrar_materia', 'cambiar_estado_materia',
                            'asignar_materia_curso', 'cambiar_profesor_asignacion', 'cambiar_estado_asignacion')
          AND EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%' OR nombre ILIKE '%actor%'
          )
    ) THEN
        RAISE EXCEPTION 'FALLO 26: una RPC acepta identidad o rol del llamador';
    END IF;
    IF has_schema_privilege('anon', 'app_private', 'USAGE') THEN
        RAISE EXCEPTION 'FALLO 26: anon tiene USAGE sobre app_private';
    END IF;
    RAISE NOTICE 'OK 26: funciones privilegiadas en app_private con SECURITY DEFINER y search_path vacío; wrappers INVOKER; ninguna acepta actor ni rol';

    -- 27. La superficie nueva no amplía permisos sobre deportes y talleres.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'actividades'
          AND policyname NOT IN ('Actividades visibles para todos', 'Directores y docentes actualizan cupos')
    ) THEN
        RAISE EXCEPTION 'FALLO 27: se agregó una política sobre actividades';
    END IF;
    IF (SELECT pg_catalog.array_agg(attname::TEXT ORDER BY attname)
        FROM pg_attribute
        WHERE attrelid = 'public.actividades'::regclass AND attnum > 0 AND NOT attisdropped
          AND has_column_privilege('authenticated', attrelid, attnum, 'UPDATE'))
       IS DISTINCT FROM ARRAY['cupo_maximo'] THEN
        RAISE EXCEPTION 'FALLO 27: el UPDATE directo de actividades dejó de limitarse a cupo_maximo';
    END IF;
    RAISE NOTICE 'OK 27: actividades conserva exactamente las dos políticas y el UPDATE de cupo de 011';
END $$;

-- 27bis. El CHECK de materias no rompe el ajuste de cupos existente: DOCENTE
-- conserva la gestión de cupos de 011 también sobre una materia.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b2222222-2222-4222-8222-333333333333"}', true);

DO $$
DECLARE
    v_id    INTEGER := (SELECT id FROM public.actividades WHERE nombre = 'Lengua y Literatura');
    v_antes INTEGER := (SELECT cupo_maximo FROM public.actividades WHERE nombre = 'Lengua y Literatura');
    v_deporte INTEGER := (SELECT id FROM public.actividades WHERE tipo = 'DEPORTE' ORDER BY id LIMIT 1);
BEGIN
    UPDATE public.actividades SET cupo_maximo = v_antes + 1 WHERE id = v_id;
    UPDATE public.actividades SET cupo_maximo = cupo_maximo + 1 WHERE id = v_deporte;
    IF (SELECT cupo_maximo FROM public.actividades WHERE id = v_id) <> v_antes + 1 THEN
        RAISE EXCEPTION 'FALLO 27bis: DOCENTE perdió la gestión de cupos sobre una materia';
    END IF;
    UPDATE public.actividades SET cupo_maximo = cupo_maximo - 1 WHERE id = v_deporte;
    RAISE NOTICE 'OK 27bis: DOCENTE conserva la gestión de cupos de 011 sobre materias y deportes';
END $$;

RESET ROLE;

-- ================================================================
-- 28. DEPORTES Y TALLERES SIN CAMBIOS
-- ================================================================
DO $$
DECLARE
    v_actual RECORD;
    v_inicial RECORD;
BEGIN
    SELECT * INTO v_inicial FROM ept56_huella_no_curricular;
    SELECT pg_catalog.count(*) AS cantidad,
           pg_catalog.md5(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, nombre, tipo, cupo_maximo, nivel_id, activo),
               ';' ORDER BY id
           )) AS huella
    INTO v_actual
    FROM public.actividades
    WHERE tipo IS DISTINCT FROM 'CURRICULAR';

    IF v_actual.cantidad <> v_inicial.cantidad OR v_actual.huella <> v_inicial.huella THEN
        RAISE EXCEPTION 'FALLO 28: cambiaron deportes o talleres (% → %)', v_inicial, v_actual;
    END IF;

    IF EXISTS (SELECT 1 FROM public.actividades WHERE tipo IS DISTINCT FROM 'CURRICULAR' AND NOT activo) THEN
        RAISE EXCEPTION 'FALLO 28: un deporte o taller quedó inactivo';
    END IF;

    IF (SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_materias_nombre_normalizado')
       NOT ILIKE '%WHERE%CURRICULAR%' THEN
        RAISE EXCEPTION 'FALLO 28: la unicidad de materias alcanza a deportes o talleres';
    END IF;

    RAISE NOTICE 'OK 28: % deporte(s) y taller(es) conservan cantidad, contenido y estado; la unicidad es parcial a CURRICULAR', v_actual.cantidad;
END $$;

ROLLBACK;

SELECT pg_catalog.setval(
    'public.actividades_id_seq'::pg_catalog.regclass,
    :'estado_inicial_actividades_id_last_value'::BIGINT,
    :'estado_inicial_actividades_id_is_called'::BOOLEAN
);

-- Si el script llega hasta acá sin FALLO, las garantías de persistencia,
-- integridad y seguridad de EPT-56 quedan demostradas sin dejar datos.
