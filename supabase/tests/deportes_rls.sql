-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de deportes (EPT-11)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`.
--
-- Cubre (EPT-32, EPT-33, EPT-35, EPT-36):
--   A. objetos, semilla, privilegios, RLS y funciones privilegiadas;
--   B. alta mínima de grupos por DIRECTOR y todos sus rechazos;
--   C. matriz del alumno: primero, segundo, duplicado de grupo, mismo deporte,
--      tercero, nivel ajeno, grupo inactivo, cupo agotado, baja, doble baja,
--      nueva disponibilidad y reingreso con historial;
--   D. denegaciones por rol (DIRECTOR, DOCENTE, PADRE, PERSONAL, sin perfil,
--      anon) sobre API de base y tablas;
--   E. cambios administrativos: cupo por debajo de la ocupación, identidad
--      protegida, profesor que deja de ser DOCENTE;
--   F. vía legada: DEPORTE de solo lectura, TALLER operativo;
--   G. sin regresiones sobre actividades, inscripciones y el modelo académico.

\set ON_ERROR_STOP on
-- Solo interesan los avisos OK/FALLO: los cambios de identidad no imprimen filas.
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- `auth.uid()` toma `sub` desde request.jwt.claims. Los DNI se eligen en un
-- rango libre y no corresponden a ninguna persona real.
WITH base_libre AS (
    SELECT base
    FROM generate_series(93000000, 99999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 12) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(id, rol, apellido, legajo, desplazamiento) AS (
    VALUES
        ('a1000000-0000-4000-8000-000000000001'::UUID, 'DIRECTOR',   'Directora',  NULL,             1),
        ('a1000000-0000-4000-8000-000000000002'::UUID, 'ESTUDIANTE', 'Alumna A',   'LEG-EPT11-0002', 2),
        ('a1000000-0000-4000-8000-000000000003'::UUID, 'ESTUDIANTE', 'Alumno B',   'LEG-EPT11-0003', 3),
        ('a1000000-0000-4000-8000-000000000004'::UUID, 'ESTUDIANTE', 'Inicial C',  'LEG-EPT11-0004', 4),
        ('a1000000-0000-4000-8000-000000000005'::UUID, 'ESTUDIANTE', 'Alumna D',   'LEG-EPT11-0005', 5),
        ('a1000000-0000-4000-8000-000000000006'::UUID, 'ESTUDIANTE', 'Inactivo',   NULL,             6),
        ('a1000000-0000-4000-8000-000000000007'::UUID, 'DOCENTE',    'Docente 1',  NULL,             7),
        ('a1000000-0000-4000-8000-000000000008'::UUID, 'DOCENTE',    'Docente 2',  NULL,             8),
        ('a1000000-0000-4000-8000-000000000009'::UUID, 'PADRE',      'Padre',      NULL,             9),
        ('a1000000-0000-4000-8000-00000000000a'::UUID, 'PERSONAL',   'Personal',   NULL,            10)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT i.id, i.id, r.id, 'Prueba', i.apellido, (b.base + i.desplazamiento)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- Cuenta autenticada sin perfil: `a1000000-…-00000000000b` no tiene fila.

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES
    ('a1000000-0000-4000-8000-0000000000c1',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
     'Curso deportes EPT-11', 'A', TRUE),
    ('a1000000-0000-4000-8000-0000000000c2',
     (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'),
     'Sala deportes EPT-11', 'A', TRUE);

-- El trigger de 008 creó una fila INACTIVA en `alumnos` para cada ESTUDIANTE.
-- A, B y D quedan en PRIMARIO; C en INICIAL; el sexto queda INACTIVO.
INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES
    ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-0000000000c1'),
    ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-0000000000c1'),
    ('a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-0000000000c1'),
    ('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-0000000000c2');

UPDATE public.alumnos
SET estado = 'ACTIVO'
WHERE perfil_id IN (
    'a1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000005'
);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Vínculo familiar para las pruebas legadas de TALLER.
INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES ('a1000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000002');

-- Nivel y deporte inactivos para los rechazos de alta de grupos.
INSERT INTO public.niveles (nombre, activo, orden)
VALUES ('NIVEL EPT11 INACTIVO', FALSE, 911);
INSERT INTO public.deportes (id, nombre, activo)
VALUES ('a1000000-0000-4000-8000-0000000000d1', 'Deporte inactivo EPT-11', FALSE);

-- Inscripción deportiva LEGADA de la alumna A. El trigger de 014 impide crearla
-- por cualquier vía, así que se desactiva solo para sembrar el histórico que
-- en producción ya existe, y se reactiva en la misma sentencia de preparación.
ALTER TABLE public.inscripciones DISABLE TRIGGER bloquear_inscripcion_deportiva_legada;
INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado)
VALUES ('a1000000-0000-4000-8000-0000000000e1',
        'a1000000-0000-4000-8000-000000000002',
        (SELECT id FROM public.actividades WHERE tipo = 'DEPORTE' AND nombre = 'Fútbol' ORDER BY id LIMIT 1),
        'ACTIVO');
ALTER TABLE public.inscripciones ENABLE TRIGGER bloquear_inscripcion_deportiva_legada;

-- Identificadores de grupos creados durante la prueba.
CREATE TEMPORARY TABLE ept11_grupos (clave TEXT PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
GRANT ALL ON ept11_grupos TO authenticated;
CREATE TEMPORARY TABLE ept11_inscripciones (clave TEXT PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
GRANT ALL ON ept11_inscripciones TO authenticated;

-- Huella de `actividades` antes de operar: EPT-11 no la modifica.
CREATE TEMPORARY TABLE ept11_huella_actividades ON COMMIT DROP AS
SELECT pg_catalog.count(*) AS cantidad,
       pg_catalog.md5(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, nombre, tipo, cupo_maximo, nivel_id, activo),
           ';' ORDER BY id)) AS huella
FROM public.actividades;


-- ================================================================
-- A. OBJETOS, SEMILLA, PRIVILEGIOS, RLS Y FUNCIONES
-- ================================================================
DO $$
DECLARE
    v_rol TEXT;
    v_tabla TEXT;
    v_privilegio TEXT;
    v_firma regprocedure;
BEGIN
    -- A1. Objetos esperados.
    IF to_regclass('public.deportes') IS NULL
       OR to_regclass('public.grupos_deportivos') IS NULL
       OR to_regclass('public.inscripciones_deportivas') IS NULL
       OR to_regclass('public.inscripciones_deportivas_detalle') IS NULL THEN
        RAISE EXCEPTION 'FALLO A1: falta algún objeto deportivo';
    END IF;
    RAISE NOTICE 'OK A1: deportes, grupos_deportivos, inscripciones_deportivas y su vista existen';

    -- A2. Semilla reproducible: seis deportes de 001 con identificador fijo.
    IF (SELECT array_agg(nombre::TEXT ORDER BY nombre) FROM public.deportes
        WHERE id::TEXT LIKE 'e0000000-0000-4000-8000-0000000001%')
       IS DISTINCT FROM ARRAY['Artes Marciales', 'Atletismo', 'Básquet', 'Fútbol', 'Natación', 'Vóley'] THEN
        RAISE EXCEPTION 'FALLO A2: la semilla de deportes no es la esperada';
    END IF;
    RAISE NOTICE 'OK A2: el catálogo trae los seis deportes versionados en 001 con identificador fijo';

    -- A3. RLS habilitado en las tres tablas.
    IF EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid IN ('public.deportes'::regclass, 'public.grupos_deportivos'::regclass,
                      'public.inscripciones_deportivas'::regclass)
          AND NOT relrowsecurity
    ) THEN
        RAISE EXCEPTION 'FALLO A3: una tabla deportiva no tiene RLS';
    END IF;
    RAISE NOTICE 'OK A3: RLS habilitado en las tres tablas deportivas';

    -- A4. Privilegios exactos: solo SELECT para authenticated; nada para anon.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.deportes', 'public.grupos_deportivos',
                                        'public.inscripciones_deportivas'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                                'REFERENCES', 'TRIGGER'] LOOP
                IF has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'FALLO A4: % conserva % sobre %', v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
            IF v_rol = 'anon' AND has_table_privilege('anon', v_tabla, 'SELECT') THEN
                RAISE EXCEPTION 'FALLO A4: anon lee %', v_tabla;
            END IF;
            IF v_rol = 'authenticated' AND NOT has_table_privilege('authenticated', v_tabla, 'SELECT') THEN
                RAISE EXCEPTION 'FALLO A4: authenticated no lee %', v_tabla;
            END IF;
        END LOOP;
    END LOOP;
    IF has_table_privilege('anon', 'public.inscripciones_deportivas_detalle', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO A4: anon lee la vista de inscripciones deportivas';
    END IF;
    RAISE NOTICE 'OK A4: solo SELECT para authenticated; ningún privilegio para anon; sin INSERT/UPDATE/DELETE/TRUNCATE';

    -- A5. Sin políticas de escritura.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('deportes', 'grupos_deportivos', 'inscripciones_deportivas')
          AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'FALLO A5: existe una política de escritura deportiva';
    END IF;
    RAISE NOTICE 'OK A5: ninguna política INSERT, UPDATE ni DELETE en tablas deportivas';

    -- A6. Funciones privilegiadas en app_private, DEFINER y search_path vacío.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.listar_grupos_deportivos()'::regprocedure,
        'app_private.crear_grupo_deportivo(uuid,integer,text,integer,uuid)'::regprocedure,
        'app_private.inscribir_en_grupo_deportivo(uuid)'::regprocedure,
        'app_private.cancelar_inscripcion_deportiva(uuid)'::regprocedure,
        'app_private.validar_inscripcion_deportiva()'::regprocedure,
        'app_private.validar_grupo_deportivo()'::regprocedure,
        'app_private.bloquear_inscripcion_deportiva_legada()'::regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO A6: % no es DEFINER con search_path vacío o anon la ejecuta', v_firma;
        END IF;
    END LOOP;
    FOREACH v_firma IN ARRAY ARRAY[
        'public.listar_grupos_deportivos()'::regprocedure,
        'public.crear_grupo_deportivo(uuid,integer,text,integer,uuid)'::regprocedure,
        'public.inscribir_en_grupo_deportivo(uuid)'::regprocedure,
        'public.cancelar_inscripcion_deportiva(uuid)'::regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO A6: el envoltorio % no es INVOKER mínimo', v_firma;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK A6: operaciones en app_private con SECURITY DEFINER y search_path vacío; envoltorios públicos INVOKER, sin anon';

    -- A7. Unicidad parcial por alumno y deporte, y FK compuesta grupo–deporte.
    IF (SELECT indexdef FROM pg_indexes
        WHERE indexname = 'idx_inscripciones_deportivas_una_por_deporte')
       NOT ILIKE '%UNIQUE%(alumno_id, deporte_id)%WHERE%ACTIVA%' THEN
        RAISE EXCEPTION 'FALLO A7: la unicidad por alumno y deporte no es parcial sobre ACTIVA';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inscripciones_deportivas_grupo_deporte_fk'
          AND contype = 'f' AND array_length(conkey, 1) = 2
    ) THEN
        RAISE EXCEPTION 'FALLO A7: falta la FK compuesta (grupo, deporte)';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid IN ('public.grupos_deportivos'::regclass,
                           'public.inscripciones_deportivas'::regclass)
          AND contype = 'f' AND confdeltype <> 'r'
    ) THEN
        RAISE EXCEPTION 'FALLO A7: una FK deportiva no es ON DELETE RESTRICT';
    END IF;
    RAISE NOTICE 'OK A7: índice único parcial (alumno, deporte) WHERE ACTIVA, FK compuesta grupo–deporte y FK RESTRICT';

    -- A8. Ninguna RPC del alumno recibe identidad, rol, nivel o cupo.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('inscribir_en_grupo_deportivo', 'cancelar_inscripcion_deportiva')
          AND p.pronargs <> 1
    ) OR EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname = 'listar_grupos_deportivos' AND p.pronargs <> 0
    ) THEN
        RAISE EXCEPTION 'FALLO A8: una RPC del alumno recibe parámetros de más';
    END IF;
    RAISE NOTICE 'OK A8: las RPC del alumno solo reciben el grupo o la inscripción; nunca alumno, rol, nivel ni cupo';

    -- A9. anon no tiene USAGE sobre app_private.
    IF has_schema_privilege('anon', 'app_private', 'USAGE') THEN
        RAISE EXCEPTION 'FALLO A9: anon tiene USAGE sobre app_private';
    END IF;
    RAISE NOTICE 'OK A9: anon no alcanza el esquema app_private';
END $$;


-- ================================================================
-- B. ALTA MÍNIMA DE GRUPOS POR DIRECTOR
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001"}', true);

DO $$
DECLARE
    v_primario INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO');
    v_inicial  INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'INICIAL');
    v_inactivo INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'NIVEL EPT11 INACTIVO');
    v_doc1     UUID := 'a1000000-0000-4000-8000-000000000007';
    v_doc2     UUID := 'a1000000-0000-4000-8000-000000000008';
    v_futbol   UUID := 'e0000000-0000-4000-8000-000000000101';
    v_natacion UUID := 'e0000000-0000-4000-8000-000000000102';
    v_atletismo UUID := 'e0000000-0000-4000-8000-000000000103';
    v_marciales UUID := 'e0000000-0000-4000-8000-000000000104';
    v_voley    UUID := 'e0000000-0000-4000-8000-000000000105';
    v_basquet  UUID := 'e0000000-0000-4000-8000-000000000106';
    v_grupo    public.grupos_deportivos;
BEGIN
    -- B1. Alta válida con deporte, nivel, cupo y profesor DOCENTE.
    v_grupo := public.crear_grupo_deportivo(v_futbol, v_primario, 'Fútbol Primario A', 2, v_doc1);
    IF v_grupo.deporte_id <> v_futbol OR v_grupo.nivel_id <> v_primario
       OR v_grupo.cupo <> 2 OR v_grupo.profesor_id <> v_doc1 OR NOT v_grupo.activo THEN
        RAISE EXCEPTION 'FALLO B1: el grupo creado no es el esperado: %', v_grupo;
    END IF;
    INSERT INTO ept11_grupos VALUES ('FUTBOL_A', v_grupo.id);
    RAISE NOTICE 'OK B1: el DIRECTOR crea un grupo con deporte, nivel, cupo y profesor DOCENTE';

    INSERT INTO ept11_grupos VALUES
        ('NATACION', (public.crear_grupo_deportivo(v_natacion, v_primario, 'Natación Primario', 5, v_doc1)).id),
        ('ATLETISMO', (public.crear_grupo_deportivo(v_atletismo, v_primario, 'Atletismo Primario', 5, v_doc2)).id),
        ('FUTBOL_B', (public.crear_grupo_deportivo(v_futbol, v_primario, 'Fútbol Primario B', 5, v_doc2)).id),
        ('VOLEY_INICIAL', (public.crear_grupo_deportivo(v_voley, v_inicial, 'Vóley Inicial', 5, v_doc1)).id),
        ('BASQUET_UNO', (public.crear_grupo_deportivo(v_basquet, v_primario, 'Básquet Primario', 1, v_doc2)).id),
        ('MARCIALES', (public.crear_grupo_deportivo(v_marciales, v_primario, 'Artes Marciales Primario', 5, v_doc1)).id);
    RAISE NOTICE 'OK B1bis: el DIRECTOR crea los siete grupos de la matriz';

    -- B2. Profesor sin rol DOCENTE (un PADRE y una ESTUDIANTE).
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, 'Vóley con padre', 5,
                                             'a1000000-0000-4000-8000-000000000009');
        RAISE EXCEPTION 'FALLO B2: se aceptó un profesor PADRE';
    EXCEPTION WHEN SQLSTATE 'P5565' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, 'Vóley con alumna', 5,
                                             'a1000000-0000-4000-8000-000000000002');
        RAISE EXCEPTION 'FALLO B2: se aceptó una ESTUDIANTE como profesora';
    EXCEPTION WHEN SQLSTATE 'P5565' THEN NULL;
    END;
    RAISE NOTICE 'OK B2: un perfil existente sin rol DOCENTE no puede ser profesor responsable (P5565)';

    -- B3. Profesor inexistente.
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, 'Vóley fantasma', 5,
                                             'a1000000-0000-4000-8000-0000000000ff');
        RAISE EXCEPTION 'FALLO B3: se aceptó un profesor inexistente';
    EXCEPTION WHEN SQLSTATE 'P5564' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, 'Vóley sin profesor', 5, NULL);
        RAISE EXCEPTION 'FALLO B3: se aceptó un grupo sin profesor';
    EXCEPTION WHEN SQLSTATE 'P5564' THEN NULL;
    END;
    RAISE NOTICE 'OK B3: un profesor inexistente o ausente se rechaza (P5564)';

    -- B4. Cupo inválido.
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, 'Vóley cupo cero', 0, v_doc1);
        RAISE EXCEPTION 'FALLO B4: se aceptó cupo 0';
    EXCEPTION WHEN SQLSTATE 'P5566' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, 'Vóley cupo excesivo', 101, v_doc1);
        RAISE EXCEPTION 'FALLO B4: se aceptó cupo 101';
    EXCEPTION WHEN SQLSTATE 'P5566' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, 'Vóley cupo nulo', NULL, v_doc1);
        RAISE EXCEPTION 'FALLO B4: se aceptó cupo nulo';
    EXCEPTION WHEN SQLSTATE 'P5566' THEN NULL;
    END;
    RAISE NOTICE 'OK B4: cupo 0, 101 o nulo se rechaza (P5566)';

    -- B5. Nombre inválido.
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, ' Vóley ', 5, v_doc1);
        RAISE EXCEPTION 'FALLO B5: se aceptó un nombre con espacios laterales';
    EXCEPTION WHEN SQLSTATE 'P5567' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_primario, '', 5, v_doc1);
        RAISE EXCEPTION 'FALLO B5: se aceptó un nombre vacío';
    EXCEPTION WHEN SQLSTATE 'P5567' THEN NULL;
    END;
    RAISE NOTICE 'OK B5: nombre vacío o con espacios laterales se rechaza (P5567)';

    -- B6. Nivel inexistente o inactivo; deporte inexistente o inactivo.
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, 999999, 'Vóley nivel fantasma', 5, v_doc1);
        RAISE EXCEPTION 'FALLO B6: se aceptó un nivel inexistente';
    EXCEPTION WHEN SQLSTATE 'P5562' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_voley, v_inactivo, 'Vóley nivel inactivo', 5, v_doc1);
        RAISE EXCEPTION 'FALLO B6: se aceptó un nivel inactivo';
    EXCEPTION WHEN SQLSTATE 'P5563' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo('a1000000-0000-4000-8000-0000000000fe', v_primario,
                                             'Deporte fantasma', 5, v_doc1);
        RAISE EXCEPTION 'FALLO B6: se aceptó un deporte inexistente';
    EXCEPTION WHEN SQLSTATE 'P5560' THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo('a1000000-0000-4000-8000-0000000000d1', v_primario,
                                             'Deporte inactivo', 5, v_doc1);
        RAISE EXCEPTION 'FALLO B6: se aceptó un deporte inactivo';
    EXCEPTION WHEN SQLSTATE 'P5561' THEN NULL;
    END;
    RAISE NOTICE 'OK B6: nivel inexistente (P5562) o inactivo (P5563) y deporte inexistente (P5560) o inactivo (P5561) se rechazan';

    -- B7. Grupo duplicado por deporte, nivel y nombre normalizado.
    BEGIN
        PERFORM public.crear_grupo_deportivo(v_futbol, v_primario, 'FÚTBOL PRIMARIO A', 9, v_doc2);
        RAISE EXCEPTION 'FALLO B7: se aceptó un grupo duplicado';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    RAISE NOTICE 'OK B7: el mismo nombre normalizado para el mismo deporte y nivel se rechaza (23505)';

    -- B8. La escritura directa sobre la tabla está cerrada también para el DIRECTOR.
    BEGIN
        INSERT INTO public.grupos_deportivos (deporte_id, nivel_id, nombre, cupo, profesor_id)
        VALUES (v_voley, v_primario, 'Directo', 5, v_doc1);
        RAISE EXCEPTION 'FALLO B8: el DIRECTOR insertó directamente';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.grupos_deportivos SET cupo = 50;
        RAISE EXCEPTION 'FALLO B8: el DIRECTOR actualizó directamente';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.grupos_deportivos;
        RAISE EXCEPTION 'FALLO B8: el DIRECTOR borró directamente';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK B8: INSERT, UPDATE y DELETE directos sobre grupos se rechazan también para el DIRECTOR';
END $$;

-- El grupo de Artes Marciales se inactiva como propietario: EPT-11 no expone
-- la inactivación (EPT-61), pero el alta debe rechazar grupos inactivos.
RESET ROLE;
UPDATE public.grupos_deportivos SET activo = FALSE
WHERE id = (SELECT id FROM ept11_grupos WHERE clave = 'MARCIALES');

-- Desde EPT-12 (migración 015) un grupo sin horario no admite inscripciones.
-- Cada grupo de la matriz recibe una franja en un día DISTINTO, de modo que
-- ninguna combinación de esta suite se superpone y cada regla de EPT-11 sigue
-- decidiendo exactamente lo mismo que antes. Las reglas horarias se prueban
-- en `horarios_rls.sql`.
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
SELECT d, '18:00', '19:00' FROM generate_series(1, 7) AS d
ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT g.id, h.id
FROM ept11_grupos g
JOIN (VALUES ('FUTBOL_A', 1), ('NATACION', 2), ('ATLETISMO', 3), ('FUTBOL_B', 4),
             ('VOLEY_INICIAL', 5), ('BASQUET_UNO', 6), ('MARCIALES', 7)) AS dia(clave, numero)
  ON dia.clave = g.clave
JOIN public.horarios h
  ON h.dia_semana = dia.numero AND h.hora_inicio = '18:00' AND h.hora_fin = '19:00';


-- ================================================================
-- C. MATRIZ DEL ALUMNO
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002"}', true);

DO $$
DECLARE
    v_futbol_a  UUID := (SELECT id FROM ept11_grupos WHERE clave = 'FUTBOL_A');
    v_futbol_b  UUID := (SELECT id FROM ept11_grupos WHERE clave = 'FUTBOL_B');
    v_natacion  UUID := (SELECT id FROM ept11_grupos WHERE clave = 'NATACION');
    v_atletismo UUID := (SELECT id FROM ept11_grupos WHERE clave = 'ATLETISMO');
    v_voley_ini UUID := (SELECT id FROM ept11_grupos WHERE clave = 'VOLEY_INICIAL');
    v_marciales UUID := (SELECT id FROM ept11_grupos WHERE clave = 'MARCIALES');
    v_listado   TEXT[];
    v_alta      public.inscripciones_deportivas;
    v_baja      public.inscripciones_deportivas;
    v_ocupados  INTEGER;
BEGIN
    -- C1. Listado filtrado por el nivel derivado: solo grupos activos de PRIMARIO.
    SELECT array_agg(grupo_nombre ORDER BY grupo_nombre) INTO v_listado
    FROM public.listar_grupos_deportivos();
    IF v_listado IS DISTINCT FROM ARRAY['Atletismo Primario', 'Básquet Primario',
                                        'Fútbol Primario A', 'Fútbol Primario B',
                                        'Natación Primario'] THEN
        RAISE EXCEPTION 'FALLO C1: el listado del alumno no es el de su nivel: %', v_listado;
    END IF;
    IF EXISTS (SELECT 1 FROM public.listar_grupos_deportivos() WHERE profesor_id IS NOT NULL) THEN
        RAISE EXCEPTION 'FALLO C1: el listado expone el identificador del profesor al alumno';
    END IF;
    IF (SELECT count(*) FROM public.grupos_deportivos) <> 5 THEN
        RAISE EXCEPTION 'FALLO C1: la tabla muestra al alumno grupos fuera de su nivel';
    END IF;
    RAISE NOTICE 'OK C1: el alumno ve solo los cinco grupos activos de su nivel derivado, sin el id del profesor';

    -- C2. Primer deporte.
    v_alta := public.inscribir_en_grupo_deportivo(v_futbol_a);
    IF v_alta.estado <> 'ACTIVA'
       OR v_alta.alumno_id <> 'a1000000-0000-4000-8000-000000000002'
       OR v_alta.deporte_id <> 'e0000000-0000-4000-8000-000000000101' THEN
        RAISE EXCEPTION 'FALLO C2: primer alta inválida: %', v_alta;
    END IF;
    INSERT INTO ept11_inscripciones VALUES ('A_FUTBOL', v_alta.id);
    SELECT ocupados INTO v_ocupados FROM public.listar_grupos_deportivos() WHERE grupo_id = v_futbol_a;
    IF v_ocupados <> 1 THEN
        RAISE EXCEPTION 'FALLO C2: la ocupación no subió a 1 (quedó %)', v_ocupados;
    END IF;
    RAISE NOTICE 'OK C2: primer deporte aceptado; ocupa una plaza y el deporte se deriva del grupo';

    -- C3. Duplicado del mismo grupo.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo(v_futbol_a);
        RAISE EXCEPTION 'FALLO C3: se duplicó el mismo grupo';
    EXCEPTION WHEN SQLSTATE 'P5575' THEN NULL;
    END;
    RAISE NOTICE 'OK C3: el mismo grupo no se duplica (P5575)';

    -- C4. Segundo grupo del mismo deporte.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo(v_futbol_b);
        RAISE EXCEPTION 'FALLO C4: se aceptó un segundo grupo del mismo deporte';
    EXCEPTION WHEN SQLSTATE 'P5576' THEN NULL;
    END;
    RAISE NOTICE 'OK C4: un segundo grupo del mismo deporte se rechaza (P5576)';

    -- C5. Segundo deporte distinto.
    v_alta := public.inscribir_en_grupo_deportivo(v_natacion);
    INSERT INTO ept11_inscripciones VALUES ('A_NATACION', v_alta.id);
    IF (SELECT count(*) FROM public.inscripciones_deportivas WHERE estado = 'ACTIVA') <> 2 THEN
        RAISE EXCEPTION 'FALLO C5: el alumno no quedó con dos deportes activos';
    END IF;
    RAISE NOTICE 'OK C5: un segundo deporte distinto se acepta';

    -- C6. Tercer deporte.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo(v_atletismo);
        RAISE EXCEPTION 'FALLO C6: se aceptó un tercer deporte';
    EXCEPTION WHEN SQLSTATE 'P5577' THEN NULL;
    END;
    RAISE NOTICE 'OK C6: el tercer deporte se rechaza (P5577)';

    -- C7. Grupo de otro nivel, grupo inactivo y grupo inexistente.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo(v_voley_ini);
        RAISE EXCEPTION 'FALLO C7: se aceptó un grupo de otro nivel';
    EXCEPTION WHEN SQLSTATE 'P5573' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo(v_marciales);
        RAISE EXCEPTION 'FALLO C7: se aceptó un grupo inactivo';
    EXCEPTION WHEN SQLSTATE 'P5569' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo('a1000000-0000-4000-8000-0000000000fd');
        RAISE EXCEPTION 'FALLO C7: se aceptó un grupo inexistente';
    EXCEPTION WHEN SQLSTATE 'P5568' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo(NULL);
        RAISE EXCEPTION 'FALLO C7: se aceptó un grupo nulo';
    EXCEPTION WHEN SQLSTATE 'P5568' THEN NULL;
    END;
    RAISE NOTICE 'OK C7: nivel ajeno (P5573), grupo inactivo (P5569) e inexistente o nulo (P5568) se rechazan';

    -- C8. Baja lógica: libera la plaza y conserva la fila.
    SELECT ocupados INTO v_ocupados FROM public.listar_grupos_deportivos() WHERE grupo_id = v_natacion;
    v_baja := public.cancelar_inscripcion_deportiva((SELECT id FROM ept11_inscripciones WHERE clave = 'A_NATACION'));
    IF v_baja.estado <> 'CANCELADA' OR v_baja.fecha_cancelacion IS NULL THEN
        RAISE EXCEPTION 'FALLO C8: la baja no es lógica: %', v_baja;
    END IF;
    IF (SELECT ocupados FROM public.listar_grupos_deportivos() WHERE grupo_id = v_natacion) <> v_ocupados - 1 THEN
        RAISE EXCEPTION 'FALLO C8: la baja no liberó la plaza';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inscripciones_deportivas WHERE id = v_baja.id) THEN
        RAISE EXCEPTION 'FALLO C8: la baja borró la fila';
    END IF;
    RAISE NOTICE 'OK C8: la baja es lógica, sella la fecha, conserva la fila y libera la plaza';

    -- C9. Doble baja: no libera dos veces.
    BEGIN
        PERFORM public.cancelar_inscripcion_deportiva(v_baja.id);
        RAISE EXCEPTION 'FALLO C9: se canceló dos veces';
    EXCEPTION WHEN SQLSTATE 'P5579' THEN NULL;
    END;
    IF (SELECT ocupados FROM public.listar_grupos_deportivos() WHERE grupo_id = v_natacion) <> v_ocupados - 1 THEN
        RAISE EXCEPTION 'FALLO C9: la doble baja alteró la ocupación';
    END IF;
    RAISE NOTICE 'OK C9: un reintento de baja se rechaza (P5579) y no libera la plaza dos veces';

    -- C10. La baja libera disponibilidad para OTRA actividad (criterio 5).
    v_alta := public.inscribir_en_grupo_deportivo(v_atletismo);
    INSERT INTO ept11_inscripciones VALUES ('A_ATLETISMO', v_alta.id);
    RAISE NOTICE 'OK C10: tras la baja, el alumno se inscribe en otro deporte que antes era el tercero';

    -- C11. Reingreso en el grupo cancelado: fila nueva, historial conservado.
    PERFORM public.cancelar_inscripcion_deportiva(v_alta.id);
    v_alta := public.inscribir_en_grupo_deportivo(v_natacion);
    IF (SELECT count(*) FROM public.inscripciones_deportivas WHERE grupo_id = v_natacion) <> 2
       OR (SELECT count(*) FROM public.inscripciones_deportivas
           WHERE grupo_id = v_natacion AND estado = 'ACTIVA') <> 1 THEN
        RAISE EXCEPTION 'FALLO C11: el reingreso no creó un ciclo nuevo';
    END IF;
    RAISE NOTICE 'OK C11: el reingreso crea una fila nueva y conserva el ciclo anterior';

    -- C12. La vista resuelve el legajo y los nombres propios.
    IF NOT EXISTS (
        SELECT 1 FROM public.inscripciones_deportivas_detalle
        WHERE id = v_alta.id AND legajo_nro = 'LEG-EPT11-0002'
          AND deporte_nombre = 'Natación' AND nivel_nombre = 'PRIMARIO'
          AND grupo_nombre = 'Natación Primario'
    ) THEN
        RAISE EXCEPTION 'FALLO C12: la vista no resuelve legajo, deporte, grupo y nivel';
    END IF;
    RAISE NOTICE 'OK C12: la vista de detalle resuelve legajo, deporte, grupo y nivel del alumno';

    -- C13. Escritura directa denegada al alumno.
    BEGIN
        INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id, deporte_id)
        VALUES ('a1000000-0000-4000-8000-000000000002', v_futbol_b, 'e0000000-0000-4000-8000-000000000101');
        RAISE EXCEPTION 'FALLO C13: el alumno insertó directamente';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.inscripciones_deportivas SET estado = 'CANCELADA';
        RAISE EXCEPTION 'FALLO C13: el alumno actualizó directamente';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.inscripciones_deportivas;
        RAISE EXCEPTION 'FALLO C13: el alumno borró directamente';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        TRUNCATE public.inscripciones_deportivas;
        RAISE EXCEPTION 'FALLO C13: el alumno vació la tabla';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK C13: INSERT, UPDATE, DELETE y TRUNCATE directos se rechazan para el alumno';

    -- C14. Los grupos propios fuera del listado siguen legibles para su historial.
    IF (SELECT count(*) FROM public.inscripciones_deportivas_detalle) <> 4 THEN
        RAISE EXCEPTION 'FALLO C14: el alumno no lee su historial completo (% filas)',
            (SELECT count(*) FROM public.inscripciones_deportivas_detalle);
    END IF;
    RAISE NOTICE 'OK C14: el alumno lee sus cuatro ciclos (activos y cancelados)';
END $$;

-- Segundo alumno del mismo nivel.
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000003"}', true);

DO $$
DECLARE
    v_basquet UUID := (SELECT id FROM ept11_grupos WHERE clave = 'BASQUET_UNO');
    v_futbol_a UUID := (SELECT id FROM ept11_grupos WHERE clave = 'FUTBOL_A');
    v_alta public.inscripciones_deportivas;
BEGIN
    -- C15. Aislamiento: B no ve inscripciones de A.
    IF EXISTS (SELECT 1 FROM public.inscripciones_deportivas)
       OR EXISTS (SELECT 1 FROM public.inscripciones_deportivas_detalle) THEN
        RAISE EXCEPTION 'FALLO C15: un alumno ve inscripciones ajenas';
    END IF;
    RAISE NOTICE 'OK C15: un alumno no ve inscripciones de otro, ni en la tabla ni en la vista';

    -- C16. No puede cancelar una inscripción ajena; responde igual que inexistente.
    BEGIN
        PERFORM public.cancelar_inscripcion_deportiva((SELECT id FROM ept11_inscripciones WHERE clave = 'A_FUTBOL'));
        RAISE EXCEPTION 'FALLO C16: se canceló una inscripción ajena';
    EXCEPTION WHEN SQLSTATE 'P5578' THEN NULL;
    END;
    BEGIN
        PERFORM public.cancelar_inscripcion_deportiva('a1000000-0000-4000-8000-0000000000fc');
        RAISE EXCEPTION 'FALLO C16: se canceló una inscripción inexistente';
    EXCEPTION WHEN SQLSTATE 'P5578' THEN NULL;
    END;
    RAISE NOTICE 'OK C16: una inscripción ajena o inexistente devuelve el mismo rechazo (P5578)';

    -- C17. B ocupa la única plaza de Básquet y la última plaza de Fútbol A.
    v_alta := public.inscribir_en_grupo_deportivo(v_basquet);
    INSERT INTO ept11_inscripciones VALUES ('B_BASQUET', v_alta.id);
    v_alta := public.inscribir_en_grupo_deportivo(v_futbol_a);
    INSERT INTO ept11_inscripciones VALUES ('B_FUTBOL', v_alta.id);
    IF (SELECT disponibles FROM public.listar_grupos_deportivos() WHERE grupo_id = v_basquet) <> 0
       OR (SELECT disponibles FROM public.listar_grupos_deportivos() WHERE grupo_id = v_futbol_a) <> 0 THEN
        RAISE EXCEPTION 'FALLO C17: la disponibilidad no llegó a cero';
    END IF;
    RAISE NOTICE 'OK C17: otro alumno ocupa las últimas plazas y la disponibilidad llega a cero';
END $$;

-- Tercer alumno del mismo nivel: cupo agotado y recuperado.
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000005"}', true);

DO $$
DECLARE
    v_basquet UUID := (SELECT id FROM ept11_grupos WHERE clave = 'BASQUET_UNO');
BEGIN
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo(v_basquet);
        RAISE EXCEPTION 'FALLO C18: se sobreocupó un grupo lleno';
    EXCEPTION WHEN SQLSTATE 'P5574' THEN NULL;
    END;
    RAISE NOTICE 'OK C18: un grupo sin plazas rechaza el alta (P5574)';
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000003"}', true);
SELECT public.cancelar_inscripcion_deportiva((SELECT id FROM ept11_inscripciones WHERE clave = 'B_BASQUET')) IS NOT NULL AS baja_b;

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000005"}', true);

DO $$
DECLARE
    v_basquet UUID := (SELECT id FROM ept11_grupos WHERE clave = 'BASQUET_UNO');
    v_alta public.inscripciones_deportivas;
BEGIN
    v_alta := public.inscribir_en_grupo_deportivo(v_basquet);
    IF v_alta.id IS NULL
       OR (SELECT ocupados FROM public.listar_grupos_deportivos() WHERE grupo_id = v_basquet) <> 1 THEN
        RAISE EXCEPTION 'FALLO C19: la plaza liberada no quedó disponible';
    END IF;
    RAISE NOTICE 'OK C19: la baja de otro alumno libera la plaza y el cupo final es exacto (1 de 1)';
END $$;

-- Alumno de otro nivel.
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004"}', true);

DO $$
DECLARE
    v_listado TEXT[];
BEGIN
    SELECT array_agg(grupo_nombre ORDER BY grupo_nombre) INTO v_listado
    FROM public.listar_grupos_deportivos();
    IF v_listado IS DISTINCT FROM ARRAY['Vóley Inicial'] THEN
        RAISE EXCEPTION 'FALLO C20: el alumno de INICIAL ve %', v_listado;
    END IF;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept11_grupos WHERE clave = 'NATACION'));
        RAISE EXCEPTION 'FALLO C20: un alumno de INICIAL se inscribió en PRIMARIO';
    EXCEPTION WHEN SQLSTATE 'P5573' THEN NULL;
    END;
    RAISE NOTICE 'OK C20: el alumno de INICIAL ve solo su grupo y no puede inscribirse en PRIMARIO (P5573)';
END $$;

-- Alumno INACTIVO (sin matrícula vigente).
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000006"}', true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.listar_grupos_deportivos()) THEN
        RAISE EXCEPTION 'FALLO C21: un alumno sin curso vigente ve grupos';
    END IF;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept11_grupos WHERE clave = 'NATACION'));
        RAISE EXCEPTION 'FALLO C21: un alumno INACTIVO se inscribió';
    EXCEPTION WHEN SQLSTATE 'P5571' THEN NULL;
    END;
    RAISE NOTICE 'OK C21: un alumno INACTIVO no ve grupos y su alta se rechaza (P5571)';
END $$;

-- Alumno ACTIVO sin matrícula vigente. La invariante diferida de 008 impide
-- que ese estado se confirme; dentro de la transacción se puede fabricar para
-- probar la defensa en profundidad y se deshace con un savepoint.
RESET ROLE;
SAVEPOINT sin_matricula;
UPDATE public.matriculas SET fecha_cierre = NOW(), motivo_cierre = 'INACTIVACION'
WHERE alumno_id = 'a1000000-0000-4000-8000-000000000005' AND fecha_cierre IS NULL;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000005"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept11_grupos WHERE clave = 'NATACION'));
        RAISE EXCEPTION 'FALLO C22: se inscribió un alumno sin curso vigente';
    EXCEPTION WHEN SQLSTATE 'P5572' THEN NULL;
    END;
    RAISE NOTICE 'OK C22: sin curso vigente no hay nivel derivable y el alta se rechaza (P5572)';
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT sin_matricula;


-- ================================================================
-- D. DENEGACIONES POR ROL
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001"}', true);

DO $$
BEGIN
    -- D1. El DIRECTOR consulta todo.
    IF (SELECT count(*) FROM public.listar_grupos_deportivos()) <> 7 THEN
        RAISE EXCEPTION 'FALLO D1: el DIRECTOR no ve los siete grupos';
    END IF;
    IF (SELECT count(*) FROM public.inscripciones_deportivas_detalle) <> 7 THEN
        RAISE EXCEPTION 'FALLO D1: el DIRECTOR no ve las siete inscripciones (%)',
            (SELECT count(*) FROM public.inscripciones_deportivas_detalle);
    END IF;
    IF (SELECT ocupados FROM public.listar_grupos_deportivos()
        WHERE grupo_id = (SELECT id FROM ept11_grupos WHERE clave = 'FUTBOL_A')) <> 2 THEN
        RAISE EXCEPTION 'FALLO D1: la ocupación de Fútbol A no es 2';
    END IF;
    RAISE NOTICE 'OK D1: el DIRECTOR consulta los siete grupos, su ocupación y las siete inscripciones';

    -- D2. El DIRECTOR no inscribe ni cancela en nombre del alumno.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept11_grupos WHERE clave = 'NATACION'));
        RAISE EXCEPTION 'FALLO D2: el DIRECTOR se inscribió';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.cancelar_inscripcion_deportiva((SELECT id FROM ept11_inscripciones WHERE clave = 'A_FUTBOL'));
        RAISE EXCEPTION 'FALLO D2: el DIRECTOR canceló una inscripción ajena';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    IF (SELECT estado FROM public.inscripciones_deportivas
        WHERE id = (SELECT id FROM ept11_inscripciones WHERE clave = 'A_FUTBOL')) <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO D2: la inscripción de la alumna cambió';
    END IF;
    RAISE NOTICE 'OK D2: el DIRECTOR no inscribe ni cancela en nombre del alumno (42501)';
END $$;

-- D3. DOCENTE, PADRE, PERSONAL y cuenta sin perfil.
DO $$
DECLARE
    v_actor RECORD;
BEGIN
    FOR v_actor IN
        SELECT * FROM (VALUES
            ('a1000000-0000-4000-8000-000000000007', 'DOCENTE'),
            ('a1000000-0000-4000-8000-000000000009', 'PADRE'),
            ('a1000000-0000-4000-8000-00000000000a', 'PERSONAL'),
            ('a1000000-0000-4000-8000-00000000000b', 'SIN PERFIL')
        ) AS a(sub, etiqueta)
    LOOP
        PERFORM set_config('request.jwt.claims', pg_catalog.format('{"sub":"%s"}', v_actor.sub), true);

        BEGIN
            PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept11_grupos WHERE clave = 'NATACION'));
            RAISE EXCEPTION 'FALLO D3: % se inscribió', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        BEGIN
            PERFORM public.cancelar_inscripcion_deportiva((SELECT id FROM ept11_inscripciones WHERE clave = 'A_FUTBOL'));
            RAISE EXCEPTION 'FALLO D3: % canceló', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        BEGIN
            PERFORM public.crear_grupo_deportivo('e0000000-0000-4000-8000-000000000105',
                (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
                'Grupo ' || v_actor.etiqueta, 5, 'a1000000-0000-4000-8000-000000000007');
            RAISE EXCEPTION 'FALLO D3: % creó un grupo', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        BEGIN
            PERFORM * FROM public.listar_grupos_deportivos();
            RAISE EXCEPTION 'FALLO D3: % consultó el listado de grupos', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        IF EXISTS (SELECT 1 FROM public.grupos_deportivos)
           OR EXISTS (SELECT 1 FROM public.inscripciones_deportivas)
           OR EXISTS (SELECT 1 FROM public.inscripciones_deportivas_detalle) THEN
            RAISE EXCEPTION 'FALLO D3: % lee grupos o inscripciones', v_actor.etiqueta;
        END IF;
        IF (SELECT count(*) FROM public.deportes) < 6 THEN
            RAISE EXCEPTION 'FALLO D3: % no lee el catálogo de deportes', v_actor.etiqueta;
        END IF;
        BEGIN
            INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id, deporte_id)
            VALUES ('a1000000-0000-4000-8000-000000000002',
                    (SELECT id FROM ept11_grupos WHERE clave = 'ATLETISMO'),
                    'e0000000-0000-4000-8000-000000000103');
            RAISE EXCEPTION 'FALLO D3: % insertó directamente', v_actor.etiqueta;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
    END LOOP;
    RAISE NOTICE 'OK D3: DOCENTE, PADRE, PERSONAL y sin perfil no inscriben, no cancelan, no crean grupos, no listan ni leen grupos o inscripciones; sí leen el catálogo';
END $$;

-- D4. anon: sin privilegios de tabla ni de ejecución.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM public.grupos_deportivos;
        RAISE EXCEPTION 'FALLO D4: anon lee grupos';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM 1 FROM public.inscripciones_deportivas_detalle;
        RAISE EXCEPTION 'FALLO D4: anon lee inscripciones';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo('a1000000-0000-4000-8000-0000000000fd');
        RAISE EXCEPTION 'FALLO D4: anon ejecutó el alta';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.crear_grupo_deportivo('e0000000-0000-4000-8000-000000000105', 1,
                                             'Anon', 5, 'a1000000-0000-4000-8000-000000000007');
        RAISE EXCEPTION 'FALLO D4: anon creó un grupo';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM * FROM public.listar_grupos_deportivos();
        RAISE EXCEPTION 'FALLO D4: anon ejecutó el listado';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK D4: anon no lee tablas ni vistas deportivas y no ejecuta sus funciones';
END $$;


-- ================================================================
-- E. CAMBIOS ADMINISTRATIVOS (PROPIETARIO)
-- ================================================================
RESET ROLE;

DO $$
DECLARE
    v_futbol_a UUID := (SELECT id FROM ept11_grupos WHERE clave = 'FUTBOL_A');
    v_insc UUID := (SELECT id FROM ept11_inscripciones WHERE clave = 'A_FUTBOL');
    v_nuevo public.grupos_deportivos;
BEGIN
    -- E1. El cupo no puede quedar por debajo de la ocupación (2 activas).
    BEGIN
        UPDATE public.grupos_deportivos SET cupo = 1 WHERE id = v_futbol_a;
        RAISE EXCEPTION 'FALLO E1: el cupo bajó por debajo de la ocupación';
    EXCEPTION WHEN SQLSTATE 'P5581' THEN NULL;
    END;
    UPDATE public.grupos_deportivos SET cupo = 3 WHERE id = v_futbol_a;
    UPDATE public.grupos_deportivos SET cupo = 2 WHERE id = v_futbol_a;
    RAISE NOTICE 'OK E1: el cupo no baja de las inscripciones activas (P5581) pero puede subir y volver al mínimo exacto';

    -- E2. Identidad del grupo con inscripciones.
    BEGIN
        UPDATE public.grupos_deportivos
        SET deporte_id = 'e0000000-0000-4000-8000-000000000105' WHERE id = v_futbol_a;
        RAISE EXCEPTION 'FALLO E2: un grupo con inscripciones cambió de deporte';
    EXCEPTION WHEN SQLSTATE 'P5580' THEN NULL;
    END;
    BEGIN
        UPDATE public.grupos_deportivos
        SET nivel_id = (SELECT id FROM public.niveles WHERE nombre = 'INICIAL') WHERE id = v_futbol_a;
        RAISE EXCEPTION 'FALLO E2: un grupo con inscripciones cambió de nivel';
    EXCEPTION WHEN SQLSTATE 'P5580' THEN NULL;
    END;
    RAISE NOTICE 'OK E2: un grupo con inscripciones no cambia de deporte ni de nivel (P5580)';

    -- E3. Identidad y transiciones de la inscripción.
    BEGIN
        UPDATE public.inscripciones_deportivas
        SET alumno_id = 'a1000000-0000-4000-8000-000000000003' WHERE id = v_insc;
        RAISE EXCEPTION 'FALLO E3: cambió el alumno de una inscripción';
    EXCEPTION WHEN SQLSTATE 'P5580' THEN NULL;
    END;
    BEGIN
        UPDATE public.inscripciones_deportivas
        SET estado = 'ACTIVA', fecha_cancelacion = NULL
        WHERE id = (SELECT id FROM ept11_inscripciones WHERE clave = 'A_NATACION');
        RAISE EXCEPTION 'FALLO E3: se reactivó una inscripción cancelada';
    EXCEPTION WHEN SQLSTATE 'P5580' THEN NULL;
    END;
    BEGIN
        INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id, estado, fecha_cancelacion)
        VALUES ('a1000000-0000-4000-8000-000000000004',
                (SELECT id FROM ept11_grupos WHERE clave = 'VOLEY_INICIAL'), 'CANCELADA', NOW());
        RAISE EXCEPTION 'FALLO E3: se creó una inscripción cancelada';
    EXCEPTION WHEN SQLSTATE 'P5580' THEN NULL;
    END;
    RAISE NOTICE 'OK E3: alumno, grupo y alta inmutables; sin reactivación ni altas canceladas (P5580)';

    -- E4. Aun fuera de las RPC, el trigger aplica las reglas y deriva el deporte.
    BEGIN
        INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id, deporte_id)
        VALUES ('a1000000-0000-4000-8000-000000000002',
                (SELECT id FROM ept11_grupos WHERE clave = 'ATLETISMO'),
                'e0000000-0000-4000-8000-000000000105');
        RAISE EXCEPTION 'FALLO E4: una escritura directa superó el límite de dos';
    EXCEPTION WHEN SQLSTATE 'P5577' THEN NULL;
    END;
    RAISE NOTICE 'OK E4: una escritura directa del propietario sigue sujeta al límite de dos (P5577)';

    -- E5. Un profesor que deja de ser DOCENTE: el grupo histórico se conserva y
    -- no puede asignarse a un grupo nuevo.
    UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
    WHERE id = 'a1000000-0000-4000-8000-000000000008';
    IF NOT EXISTS (SELECT 1 FROM public.grupos_deportivos
                   WHERE profesor_id = 'a1000000-0000-4000-8000-000000000008') THEN
        RAISE EXCEPTION 'FALLO E5: se perdió un grupo histórico';
    END IF;
    BEGIN
        INSERT INTO public.grupos_deportivos (deporte_id, nivel_id, nombre, cupo, profesor_id)
        VALUES ('e0000000-0000-4000-8000-000000000105',
                (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
                'Vóley ex docente', 5, 'a1000000-0000-4000-8000-000000000008');
        RAISE EXCEPTION 'FALLO E5: se asignó un ex DOCENTE a un grupo nuevo';
    EXCEPTION WHEN SQLSTATE 'P5565' THEN NULL;
    END;
    RAISE NOTICE 'OK E5: quien deja de ser DOCENTE conserva sus grupos históricos pero no recibe grupos nuevos (P5565)';

    -- E6. No existe ninguna función de borrado deportivo.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname ILIKE '%eliminar%deport%' OR p.proname ILIKE '%borrar%deport%'
               OR p.proname ILIKE '%eliminar%grupo%' OR p.proname ILIKE '%delete%deport%')
    ) THEN
        RAISE EXCEPTION 'FALLO E6: existe una función de borrado deportivo';
    END IF;
    RAISE NOTICE 'OK E6: no existe ninguna función de borrado de grupos ni de inscripciones deportivas';
END $$;


-- ================================================================
-- F. VÍA LEGADA: DEPORTE DE SOLO LECTURA, TALLER OPERATIVO
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002"}', true);

DO $$
DECLARE
    v_deporte INTEGER := (SELECT id FROM public.actividades WHERE tipo = 'DEPORTE' AND nombre = 'Natación' ORDER BY id LIMIT 1);
    v_taller  INTEGER := (SELECT id FROM public.actividades WHERE tipo = 'TALLER' AND nombre = 'Danza' ORDER BY id LIMIT 1);
BEGIN
    -- F1. El histórico DEPORTE sigue visible.
    IF NOT EXISTS (SELECT 1 FROM public.inscripciones WHERE id = 'a1000000-0000-4000-8000-0000000000e1') THEN
        RAISE EXCEPTION 'FALLO F1: el histórico DEPORTE dejó de ser visible';
    END IF;
    RAISE NOTICE 'OK F1: la inscripción deportiva legada sigue visible';

    -- F2. El alumno no crea DEPORTE por la vía legada.
    BEGIN
        INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado)
        VALUES ('a1000000-0000-4000-8000-000000000002', v_deporte, 'ACTIVO');
        RAISE EXCEPTION 'FALLO F2: el alumno creó una inscripción DEPORTE legada';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    -- F3. Ni borra su histórico DEPORTE.
    BEGIN
        DELETE FROM public.inscripciones WHERE id = 'a1000000-0000-4000-8000-0000000000e1';
        RAISE EXCEPTION 'FALLO F3: el alumno borró su histórico DEPORTE';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    RAISE NOTICE 'OK F2-F3: el alumno no crea ni borra inscripciones DEPORTE legadas (P5582)';

    -- F4. TALLER sigue operativo para el alumno: alta y baja propias.
    INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado)
    VALUES ('a1000000-0000-4000-8000-000000000002', v_taller, 'ACTIVO');
    DELETE FROM public.inscripciones
    WHERE estudiante_id = 'a1000000-0000-4000-8000-000000000002' AND actividad_id = v_taller;
    IF EXISTS (SELECT 1 FROM public.inscripciones
               WHERE estudiante_id = 'a1000000-0000-4000-8000-000000000002' AND actividad_id = v_taller) THEN
        RAISE EXCEPTION 'FALLO F4: la baja del taller no se aplicó';
    END IF;
    RAISE NOTICE 'OK F4: el alumno sigue inscribiéndose y dándose de baja en un TALLER';
END $$;

-- F5. El PADRE conserva TALLER para su hijo, pero no DEPORTE.
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000009"}', true);

DO $$
DECLARE
    v_deporte INTEGER := (SELECT id FROM public.actividades WHERE tipo = 'DEPORTE' AND nombre = 'Vóley' ORDER BY id LIMIT 1);
    v_taller  INTEGER := (SELECT id FROM public.actividades WHERE tipo = 'TALLER' AND nombre = 'Ajedrez' ORDER BY id LIMIT 1);
BEGIN
    INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado)
    VALUES ('a1000000-0000-4000-8000-000000000002', v_taller, 'ACTIVO');
    BEGIN
        INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado)
        VALUES ('a1000000-0000-4000-8000-000000000002', v_deporte, 'ACTIVO');
        RAISE EXCEPTION 'FALLO F5: el PADRE inscribió a su hijo en DEPORTE legado';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    DELETE FROM public.inscripciones
    WHERE estudiante_id = 'a1000000-0000-4000-8000-000000000002' AND actividad_id = v_taller;
    RAISE NOTICE 'OK F5: el PADRE sigue gestionando TALLER de su hijo y no recibe poder deportivo (P5582)';
END $$;

-- F6. El staff conserva TALLER y no toca DEPORTE.
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000007"}', true);

DO $$
DECLARE
    v_deporte INTEGER := (SELECT id FROM public.actividades WHERE tipo = 'DEPORTE' AND nombre = 'Atletismo' ORDER BY id LIMIT 1);
    v_taller  INTEGER := (SELECT id FROM public.actividades WHERE tipo = 'TALLER' AND nombre = 'Danza' ORDER BY id LIMIT 1);
    v_id      UUID;
BEGIN
    INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado)
    VALUES ('a1000000-0000-4000-8000-000000000003', v_taller, 'ACTIVO')
    RETURNING id INTO v_id;
    UPDATE public.inscripciones SET estado = 'BAJA' WHERE id = v_id;
    IF (SELECT estado FROM public.inscripciones WHERE id = v_id) <> 'BAJA' THEN
        RAISE EXCEPTION 'FALLO F6: el DOCENTE no pudo dar de baja un TALLER';
    END IF;
    -- Cambiar un TALLER a una actividad DEPORTE también se rechaza.
    BEGIN
        UPDATE public.inscripciones SET actividad_id = v_deporte WHERE id = v_id;
        RAISE EXCEPTION 'FALLO F6: un TALLER se convirtió en DEPORTE legado';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    BEGIN
        INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado)
        VALUES ('a1000000-0000-4000-8000-000000000003', v_deporte, 'ACTIVO');
        RAISE EXCEPTION 'FALLO F6: el DOCENTE creó DEPORTE legado';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    BEGIN
        UPDATE public.inscripciones SET estado = 'BAJA' WHERE id = 'a1000000-0000-4000-8000-0000000000e1';
        RAISE EXCEPTION 'FALLO F6: el DOCENTE modificó el histórico DEPORTE';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    DELETE FROM public.inscripciones WHERE id = v_id;
    RAISE NOTICE 'OK F6: DOCENTE conserva alta, baja y borrado de TALLER; DEPORTE legado rechazado (P5582)';
END $$;

-- F7. Ni el propietario reescribe el histórico DEPORTE.
RESET ROLE;
DO $$
BEGIN
    BEGIN
        UPDATE public.inscripciones SET estado = 'BAJA' WHERE id = 'a1000000-0000-4000-8000-0000000000e1';
        RAISE EXCEPTION 'FALLO F7: el propietario modificó el histórico DEPORTE';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    BEGIN
        DELETE FROM public.inscripciones WHERE id = 'a1000000-0000-4000-8000-0000000000e1';
        RAISE EXCEPTION 'FALLO F7: el propietario borró el histórico DEPORTE';
    EXCEPTION WHEN SQLSTATE 'P5582' THEN NULL;
    END;
    RAISE NOTICE 'OK F7: el histórico DEPORTE es de solo lectura incluso para el propietario (P5582)';
END $$;


-- ================================================================
-- G. SIN REGRESIONES
-- ================================================================
DO $$
DECLARE
    v_inicial RECORD;
    v_actual  RECORD;
BEGIN
    SELECT * INTO v_inicial FROM ept11_huella_actividades;
    SELECT pg_catalog.count(*) AS cantidad,
           pg_catalog.md5(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, nombre, tipo, cupo_maximo, nivel_id, activo),
               ';' ORDER BY id)) AS huella
    INTO v_actual FROM public.actividades;
    IF v_actual.cantidad <> v_inicial.cantidad OR v_actual.huella <> v_inicial.huella THEN
        RAISE EXCEPTION 'FALLO G1: cambió public.actividades';
    END IF;

    IF (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'actividades')
       IS DISTINCT FROM ARRAY['Actividades visibles para todos', 'Directores y docentes actualizan cupos'] THEN
        RAISE EXCEPTION 'FALLO G1: cambiaron las políticas de actividades';
    END IF;
    IF (SELECT array_agg(attname::TEXT ORDER BY attname) FROM pg_attribute
        WHERE attrelid = 'public.actividades'::regclass AND attnum > 0 AND NOT attisdropped
          AND has_column_privilege('authenticated', attrelid, attnum, 'UPDATE'))
       IS DISTINCT FROM ARRAY['cupo_maximo'] THEN
        RAISE EXCEPTION 'FALLO G1: cambió el UPDATE directo sobre actividades';
    END IF;
    RAISE NOTICE 'OK G1: actividades conserva filas, políticas y el UPDATE de cupo de 011';

    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inscripciones') <> 8 THEN
        RAISE EXCEPTION 'FALLO G2: cambiaron las políticas de inscripciones';
    END IF;
    IF has_table_privilege('anon', 'public.inscripciones', 'INSERT')
       OR has_table_privilege('authenticated', 'public.inscripciones', 'TRUNCATE') THEN
        RAISE EXCEPTION 'FALLO G2: se ampliaron los privilegios de inscripciones';
    END IF;
    RAISE NOTICE 'OK G2: inscripciones conserva sus ocho políticas de 011; el bloqueo deportivo es un trigger, no un cambio de ACL';

    IF has_table_privilege('authenticated', 'public.alumnos', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.matriculas', 'INSERT')
       OR has_table_privilege('authenticated', 'public.inscripciones_servicios', 'INSERT') THEN
        RAISE EXCEPTION 'FALLO G3: se ampliaron privilegios académicos o del comedor';
    END IF;
    RAISE NOTICE 'OK G3: modelo académico y comedor sin privilegios nuevos';
END $$;

ROLLBACK;

-- Si el script llega hasta acá sin FALLO, las garantías de persistencia,
-- integridad y seguridad de EPT-11 quedan demostradas sin dejar datos.
