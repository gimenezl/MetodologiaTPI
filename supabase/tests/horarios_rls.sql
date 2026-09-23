-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de compatibilidad horaria (EPT-12)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`.
--
-- Cubre (EPT-38, EPT-39, EPT-40, EPT-41, EPT-42):
--   A. estructura: tablas, CHECK, FK RESTRICT, índices, RLS, privilegios,
--      funciones privilegiadas y ausencia de DELETE;
--   B. la función única de intervalos contra la matriz de casos límite;
--   C. franjas del DIRECTOR: alta, catálogo reutilizado, día y rango
--      inválidos, duplicado, superposición interna, contigüidad, baja lógica,
--      reasignación e identidad protegida;
--   D. matriz del alumno: sin actividades previas, días distintos, igualdad,
--      solapamiento por izquierda y por derecha, contenido en ambos sentidos,
--      contigüidad en ambos sentidos, varias franjas por grupo, grupo sin
--      horario, cancelación ignorada y horario liberado;
--   E. la misma decisión para el alumno y para el DIRECTOR, con idéntico
--      código, mensaje y detalle;
--   F. una franja nueva no puede generar conflictos a los inscriptos;
--   G. regresión de EPT-11 con horarios cargados: máximo de dos, duplicados,
--      mismo deporte, nivel, cupo y estado;
--   H. denegaciones: ESTUDIANTE, DOCENTE, PADRE, PERSONAL, sin perfil y anon;
--   I. visibilidad por RLS y ausencia de datos de otros alumnos;
--   J. invariante final: ningún alumno con dos actividades superpuestas.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- Prefijo `c1200000-` y DNI en el rango 91 000 000: no colisionan con las
-- suites de EPT-11 (a1…/b1…, 93 000 000) ni con el setup de Playwright.
WITH base_libre AS (
    SELECT base
    FROM generate_series(91000000, 91999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 12) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(id, rol, apellido, legajo, desplazamiento) AS (
    VALUES
        ('c1200000-0000-4000-8000-000000000001'::UUID, 'DIRECTOR',   'Directora H',  NULL,             1),
        ('c1200000-0000-4000-8000-000000000002'::UUID, 'ESTUDIANTE', 'Alumna Ana',   'LEG-EPT12-0002', 2),
        ('c1200000-0000-4000-8000-000000000003'::UUID, 'ESTUDIANTE', 'Alumno Bruno', 'LEG-EPT12-0003', 3),
        ('c1200000-0000-4000-8000-000000000004'::UUID, 'ESTUDIANTE', 'Alumna Carla', 'LEG-EPT12-0004', 4),
        ('c1200000-0000-4000-8000-000000000005'::UUID, 'ESTUDIANTE', 'Inactivo',     'LEG-EPT12-0005', 5),
        ('c1200000-0000-4000-8000-000000000006'::UUID, 'ESTUDIANTE', 'Inicial Dani', 'LEG-EPT12-0006', 6),
        ('c1200000-0000-4000-8000-000000000007'::UUID, 'DOCENTE',    'Docente H',    NULL,             7),
        ('c1200000-0000-4000-8000-000000000008'::UUID, 'PADRE',      'Padre H',      NULL,             8),
        ('c1200000-0000-4000-8000-000000000009'::UUID, 'PERSONAL',   'Personal H',   NULL,             9)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT i.id, i.id, r.id, 'Prueba', i.apellido, (b.base + i.desplazamiento)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- Cuenta autenticada sin perfil: `c1200000-…-00000000000b` no tiene fila.

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES
    ('c1200000-0000-4000-8000-0000000000c1',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
     'Curso horarios EPT-12', 'A', TRUE),
    ('c1200000-0000-4000-8000-0000000000c2',
     (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'),
     'Sala horarios EPT-12', 'A', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES
    ('c1200000-0000-4000-8000-000000000002', 'c1200000-0000-4000-8000-0000000000c1'),
    ('c1200000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-0000000000c1'),
    ('c1200000-0000-4000-8000-000000000004', 'c1200000-0000-4000-8000-0000000000c1'),
    ('c1200000-0000-4000-8000-000000000006', 'c1200000-0000-4000-8000-0000000000c2');

-- El trigger de 008 creó una fila INACTIVA en `alumnos` por cada ESTUDIANTE.
-- Todos quedan ACTIVOS salvo el quinto, que tampoco tiene matrícula (008 lo exige).
UPDATE public.alumnos
SET estado = 'ACTIVO'
WHERE perfil_id IN (
    'c1200000-0000-4000-8000-000000000002',
    'c1200000-0000-4000-8000-000000000003',
    'c1200000-0000-4000-8000-000000000004',
    'c1200000-0000-4000-8000-000000000006'
);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

CREATE TEMPORARY TABLE ept12_grupos (clave TEXT PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
GRANT ALL ON ept12_grupos TO authenticated;
CREATE TEMPORARY TABLE ept12_valores (clave TEXT PRIMARY KEY, valor TEXT) ON COMMIT DROP;
GRANT ALL ON ept12_valores TO authenticated;


-- ================================================================
-- A. ESTRUCTURA, RLS Y PRIVILEGIOS
-- ================================================================
DO $$
DECLARE
    v_rol        TEXT;
    v_tabla      TEXT;
    v_privilegio TEXT;
BEGIN
    -- A1. Tablas y restricciones declaradas.
    IF pg_catalog.to_regclass('public.horarios') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos_horarios') IS NULL THEN
        RAISE EXCEPTION 'FALLO A1: faltan las tablas de horarios';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horarios_dia_semana_valido'
                   AND pg_get_constraintdef(oid) LIKE '%dia_semana >= 1%dia_semana <= 7%')
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horarios_rango_valido'
                      AND pg_get_constraintdef(oid) LIKE '%hora_inicio < hora_fin%')
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horarios_horas_representables')
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horarios_franja_unica' AND contype = 'u') THEN
        RAISE EXCEPTION 'FALLO A1: faltan los CHECK o la unicidad del catálogo';
    END IF;
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'horarios' AND column_name = 'hora_inicio')
       <> 'time without time zone' THEN
        RAISE EXCEPTION 'FALLO A1: las horas no son TIME sin zona horaria';
    END IF;
    RAISE NOTICE 'OK A1: horarios con CHECK de día 1–7, inicio < fin, unicidad y TIME sin zona';

    -- A2. Claves foráneas restrictivas.
    IF (SELECT count(*) FROM pg_constraint
        WHERE conrelid = 'public.grupos_deportivos_horarios'::regclass AND contype = 'f'
          AND confdeltype = 'r' AND confupdtype = 'r') <> 2 THEN
        RAISE EXCEPTION 'FALLO A2: las dos FK de franjas no son RESTRICT';
    END IF;
    RAISE NOTICE 'OK A2: franja → grupo y franja → horario con ON DELETE/UPDATE RESTRICT';

    -- A3. Índices: unicidad parcial, FK cubiertas y la FK compuesta de 014.
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_grupos_deportivos_horarios_unica_activa'
                   AND indexdef LIKE '%UNIQUE%WHERE activo%')
       OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_grupos_deportivos_horarios_grupo')
       OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_grupos_deportivos_horarios_horario')
       OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_inscripciones_deportivas_grupo_deporte'
                      AND indexdef LIKE '%(grupo_id, deporte_id)%') THEN
        RAISE EXCEPTION 'FALLO A3: falta un índice de horarios o el de la FK compuesta';
    END IF;
    RAISE NOTICE 'OK A3: índice único parcial, FK indexadas y FK compuesta (grupo_id, deporte_id) cubierta';

    -- A4. RLS y ninguna política de escritura.
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.horarios'::regclass,
               'public.grupos_deportivos_horarios'::regclass) AND NOT relrowsecurity) THEN
        RAISE EXCEPTION 'FALLO A4: una tabla de horarios no tiene RLS';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND tablename IN ('horarios', 'grupos_deportivos_horarios') AND cmd <> 'SELECT') THEN
        RAISE EXCEPTION 'FALLO A4: existe una política de escritura';
    END IF;
    RAISE NOTICE 'OK A4: RLS activa y solo políticas SELECT';

    -- A5. Ningún privilegio de escritura, borrado ni TRUNCATE; anon sin lectura.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.horarios', 'public.grupos_deportivos_horarios'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
                IF has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'FALLO A5: % tiene % sobre %', v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    IF has_table_privilege('anon', 'public.horarios', 'SELECT')
       OR has_table_privilege('anon', 'public.grupos_deportivos_horarios', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO A5: anon puede leer horarios';
    END IF;
    RAISE NOTICE 'OK A5: sin INSERT/UPDATE/DELETE/TRUNCATE para anon ni authenticated; anon sin lectura';

    -- A6. Funciones privilegiadas: SECURITY DEFINER, search_path vacío, sin anon.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app_private'
          AND p.proname IN ('agregar_horario_grupo_deportivo', 'dar_de_baja_horario_grupo_deportivo',
                            'inscribir_alumno_en_grupo_deportivo', 'consultar_compatibilidad_horaria',
                            'consultar_compatibilidad_horaria_alumno', 'primer_conflicto_horario',
                            'compatibilidad_grupos_de_alumno', 'validar_franja_grupo_deportivo',
                            'validar_inscripcion_deportiva')
          AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
               OR has_function_privilege('anon', p.oid, 'EXECUTE'))
    ) THEN
        RAISE EXCEPTION 'FALLO A6: una función privilegiada no es SECURITY DEFINER con search_path vacío';
    END IF;
    IF has_function_privilege('authenticated',
           'app_private.intervalos_se_superponen(smallint,time,time,smallint,time,time)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'app_private.primer_conflicto_horario(uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'app_private.compatibilidad_grupos_de_alumno(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALLO A6: una función interna es ejecutable por authenticated';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('agregar_horario_grupo_deportivo', 'dar_de_baja_horario_grupo_deportivo',
                            'inscribir_alumno_en_grupo_deportivo', 'consultar_compatibilidad_horaria',
                            'consultar_compatibilidad_horaria_alumno')
          AND (p.prosecdef OR has_function_privilege('anon', p.oid, 'EXECUTE')
               OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    ) THEN
        RAISE EXCEPTION 'FALLO A6: un envoltorio público no es SECURITY INVOKER mínimo';
    END IF;
    RAISE NOTICE 'OK A6: operaciones en app_private (DEFINER, search_path vacío) y envoltorios INVOKER sin anon';

    -- A7. La consulta del estudiante no recibe identidad; no hay funciones de borrado.
    IF (SELECT pronargs FROM pg_proc WHERE oid = 'public.consultar_compatibilidad_horaria()'::regprocedure) <> 0 THEN
        RAISE EXCEPTION 'FALLO A7: la consulta del estudiante recibe parámetros';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname ILIKE '%eliminar%horario%' OR p.proname ILIKE '%borrar%horario%'
               OR p.proname ILIKE '%delete%horario%' OR p.proname ILIKE '%eliminar%franja%')
    ) THEN
        RAISE EXCEPTION 'FALLO A7: existe una función de borrado de horarios';
    END IF;
    RAISE NOTICE 'OK A7: la consulta propia no acepta identidad y no existe borrado de horarios';
END $$;


-- ================================================================
-- B. LA FUNCIÓN ÚNICA DE INTERVALOS
-- ================================================================
DO $$
DECLARE
    v_caso RECORD;
BEGIN
    FOR v_caso IN
        SELECT * FROM (VALUES
            ('igualdad exacta',              1, '10:00', '11:00', 1, '10:00', '11:00', TRUE),
            ('solapamiento por izquierda',   1, '10:00', '11:00', 1, '09:30', '10:30', TRUE),
            ('solapamiento por derecha',     1, '10:00', '11:00', 1, '10:30', '11:30', TRUE),
            ('nuevo contenido',              1, '10:00', '11:00', 1, '10:15', '10:45', TRUE),
            ('nuevo contiene',               1, '10:00', '11:00', 1, '09:00', '12:00', TRUE),
            ('mismo inicio, fin menor',      1, '10:00', '11:00', 1, '10:00', '10:01', TRUE),
            ('mismo fin, inicio mayor',      1, '10:00', '11:00', 1, '10:59', '11:00', TRUE),
            ('un minuto de intersección',    1, '10:00', '11:00', 1, '10:59', '12:00', TRUE),
            ('contiguo después',             1, '10:00', '11:00', 1, '11:00', '12:00', FALSE),
            ('contiguo antes',               1, '10:00', '11:00', 1, '09:00', '10:00', FALSE),
            ('separados',                    1, '10:00', '11:00', 1, '12:00', '13:00', FALSE),
            ('día distinto, mismo rango',    1, '10:00', '11:00', 2, '10:00', '11:00', FALSE),
            ('domingo contra lunes',         7, '10:00', '11:00', 1, '10:00', '11:00', FALSE),
            ('borde de medianoche',          1, '00:00', '00:30', 1, '23:30', '23:59', FALSE)
        ) AS c(nombre, dia_a, ini_a, fin_a, dia_b, ini_b, fin_b, esperado)
    LOOP
        IF app_private.intervalos_se_superponen(v_caso.dia_a::SMALLINT, v_caso.ini_a::TIME, v_caso.fin_a::TIME,
                                                v_caso.dia_b::SMALLINT, v_caso.ini_b::TIME, v_caso.fin_b::TIME)
               IS DISTINCT FROM v_caso.esperado
           -- La relación es simétrica: el orden de los argumentos no cambia la decisión.
           OR app_private.intervalos_se_superponen(v_caso.dia_b::SMALLINT, v_caso.ini_b::TIME, v_caso.fin_b::TIME,
                                                   v_caso.dia_a::SMALLINT, v_caso.ini_a::TIME, v_caso.fin_a::TIME)
               IS DISTINCT FROM v_caso.esperado THEN
            RAISE EXCEPTION 'FALLO B1: caso «%» no devuelve %', v_caso.nombre, v_caso.esperado;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK B1: la función única decide los 14 casos límite en ambos sentidos (semiabierto [inicio, fin))';
END $$;


-- ================================================================
-- C. FRANJAS DEL DIRECTOR
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000001"}', true);

DO $$
DECLARE
    v_primario INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO');
    v_inicial  INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'INICIAL');
    v_doc      UUID := 'c1200000-0000-4000-8000-000000000007';
    v_futbol   UUID := 'e0000000-0000-4000-8000-000000000101';
    v_natacion UUID := 'e0000000-0000-4000-8000-000000000102';
    v_atletismo UUID := 'e0000000-0000-4000-8000-000000000103';
    v_marciales UUID := 'e0000000-0000-4000-8000-000000000104';
    v_voley    UUID := 'e0000000-0000-4000-8000-000000000105';
    v_basquet  UUID := 'e0000000-0000-4000-8000-000000000106';
    v_franja   public.grupos_deportivos_horarios;
    v_otra     public.grupos_deportivos_horarios;
    v_grupo    UUID;
BEGIN
    -- Grupos de la matriz. El nombre describe la relación con Fútbol H (lunes
    -- 10:00–11:00 y miércoles 10:00–11:00).
    INSERT INTO ept12_grupos VALUES
        ('FUTBOL',        (public.crear_grupo_deportivo(v_futbol,    v_primario, 'Fútbol H',               5, v_doc)).id),
        ('IGUAL',         (public.crear_grupo_deportivo(v_natacion,  v_primario, 'Natación H igual',       5, v_doc)).id),
        ('IZQUIERDA',     (public.crear_grupo_deportivo(v_atletismo, v_primario, 'Atletismo H izquierda',  5, v_doc)).id),
        ('DERECHA',       (public.crear_grupo_deportivo(v_voley,     v_primario, 'Vóley H derecha',        5, v_doc)).id),
        ('CONTENIDO',     (public.crear_grupo_deportivo(v_basquet,   v_primario, 'Básquet H contenido',    5, v_doc)).id),
        ('CONTIENE',      (public.crear_grupo_deportivo(v_marciales, v_primario, 'Marciales H contiene',   5, v_doc)).id),
        ('CONTIGUO_DESP', (public.crear_grupo_deportivo(v_natacion,  v_primario, 'Natación H contigua',    5, v_doc)).id),
        ('CONTIGUO_ANT',  (public.crear_grupo_deportivo(v_atletismo, v_primario, 'Atletismo H contiguo',   5, v_doc)).id),
        ('OTRO_DIA',      (public.crear_grupo_deportivo(v_voley,     v_primario, 'Vóley H martes',         5, v_doc)).id),
        ('MIERCOLES',     (public.crear_grupo_deportivo(v_basquet,   v_primario, 'Básquet H miércoles',    5, v_doc)).id),
        ('SIN_HORARIO',   (public.crear_grupo_deportivo(v_marciales, v_primario, 'Marciales H sin horario',5, v_doc)).id),
        ('CUPO_UNO',      (public.crear_grupo_deportivo(v_voley,     v_primario, 'Vóley H última plaza',   1, v_doc)).id),
        ('INICIAL',       (public.crear_grupo_deportivo(v_voley,     v_inicial,  'Vóley H inicial',        5, v_doc)).id);

    -- C1. Alta válida y varias franjas por grupo.
    v_franja := public.agregar_horario_grupo_deportivo(
        (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'), 1::SMALLINT, '10:00', '11:00');
    IF NOT v_franja.activo OR v_franja.fecha_baja IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO C1: la franja no nació activa: %', v_franja;
    END IF;
    PERFORM public.agregar_horario_grupo_deportivo(
        (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'), 3::SMALLINT, '10:00', '11:00');
    IF (SELECT count(*) FROM public.grupos_deportivos_horarios
        WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL') AND activo) <> 2 THEN
        RAISE EXCEPTION 'FALLO C1: el grupo no quedó con dos franjas';
    END IF;
    RAISE NOTICE 'OK C1: el DIRECTOR asigna franjas y un grupo admite varias (lunes y miércoles)';

    -- C2. El catálogo se reutiliza: la misma terna no se duplica.
    v_otra := public.agregar_horario_grupo_deportivo(
        (SELECT id FROM ept12_grupos WHERE clave = 'IGUAL'), 1::SMALLINT, '10:00', '11:00');
    IF v_otra.horario_id <> v_franja.horario_id
       OR (SELECT count(*) FROM public.horarios WHERE dia_semana = 1 AND hora_inicio = '10:00' AND hora_fin = '11:00') <> 1 THEN
        RAISE EXCEPTION 'FALLO C2: la misma franja creó dos filas de catálogo';
    END IF;
    RAISE NOTICE 'OK C2: dos grupos con la misma franja comparten una sola fila del catálogo';

    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'IZQUIERDA'),     1::SMALLINT, '09:30', '10:30');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'DERECHA'),       1::SMALLINT, '10:30', '11:30');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CONTENIDO'),     1::SMALLINT, '10:15', '10:45');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CONTIENE'),      1::SMALLINT, '09:00', '12:00');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_DESP'), 1::SMALLINT, '11:00', '12:00');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_ANT'),  1::SMALLINT, '09:00', '10:00');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'),      2::SMALLINT, '10:00', '11:00');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'MIERCOLES'),     3::SMALLINT, '10:30', '11:00');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CUPO_UNO'),      5::SMALLINT, '15:00', '16:00');
    PERFORM public.agregar_horario_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'INICIAL'),       4::SMALLINT, '15:00', '16:00');

    -- C3. Día fuera de 1–7.
    v_grupo := (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA');
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 0::SMALLINT, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO C3: se aceptó el día 0';
    EXCEPTION WHEN SQLSTATE 'P5585' THEN NULL;
    END;
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 8::SMALLINT, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO C3: se aceptó el día 8';
    EXCEPTION WHEN SQLSTATE 'P5585' THEN NULL;
    END;
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, NULL, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO C3: se aceptó un día nulo';
    EXCEPTION WHEN SQLSTATE 'P5585' THEN NULL;
    END;
    -- 1 (lunes) y 7 (domingo) son válidos.
    PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 7::SMALLINT, '08:00', '09:00');
    RAISE NOTICE 'OK C3: el día 0, el 8 y el nulo se rechazan (P5585); 1 y 7 son válidos';

    -- C4. Inicio anterior al fin.
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 4::SMALLINT, '09:00', '09:00');
        RAISE EXCEPTION 'FALLO C4: se aceptó un rango vacío';
    EXCEPTION WHEN SQLSTATE 'P5586' THEN NULL;
    END;
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 4::SMALLINT, '10:00', '09:00');
        RAISE EXCEPTION 'FALLO C4: se aceptó un rango invertido';
    EXCEPTION WHEN SQLSTATE 'P5586' THEN NULL;
    END;
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 4::SMALLINT, NULL, '09:00');
        RAISE EXCEPTION 'FALLO C4: se aceptó un inicio nulo';
    EXCEPTION WHEN SQLSTATE 'P5586' THEN NULL;
    END;
    -- 24:00 y las fracciones de segundo son TIME válidos, pero la aplicación no
    -- puede representarlos: se rechazan en la RPC y en el catálogo.
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 4::SMALLINT, '23:00', '24:00');
        RAISE EXCEPTION 'FALLO C4: se aceptó 24:00';
    EXCEPTION WHEN SQLSTATE 'P5586' THEN NULL;
    END;
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 4::SMALLINT, '10:00:30.5', '11:00');
        RAISE EXCEPTION 'FALLO C4: se aceptó una fracción de segundo';
    EXCEPTION WHEN SQLSTATE 'P5586' THEN NULL;
    END;
    -- 00:00–23:59:59 es el máximo representable y se acepta.
    PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 4::SMALLINT, '00:00', '09:00:59');
    RAISE NOTICE 'OK C4: rango vacío, invertido, nulo, 24:00 o con fracciones se rechaza (P5586)';

    -- C5. La misma franja dos veces activa en un grupo.
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 2::SMALLINT, '10:00', '11:00');
        RAISE EXCEPTION 'FALLO C5: se duplicó una franja activa';
    EXCEPTION WHEN SQLSTATE 'P5587' THEN NULL;
    END;
    RAISE NOTICE 'OK C5: una franja activa no se asigna dos veces al mismo grupo (P5587)';

    -- C6. Superposición interna y contigüidad interna.
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 2::SMALLINT, '10:30', '11:30');
        RAISE EXCEPTION 'FALLO C6: se aceptó una franja superpuesta del mismo grupo';
    EXCEPTION WHEN SQLSTATE 'P5588' THEN
        IF SQLERRM <> 'La franja se superpone con otra franja del grupo: martes de 10:00 a 11:00.' THEN
            RAISE EXCEPTION 'FALLO C6: mensaje inesperado: %', SQLERRM;
        END IF;
    END;
    PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 2::SMALLINT, '11:00', '12:00');
    RAISE NOTICE 'OK C6: dos franjas superpuestas del mismo grupo se rechazan (P5588) y las contiguas se aceptan';

    -- C7. Baja lógica, doble baja, franja ajena o inexistente y reasignación.
    v_otra := public.dar_de_baja_horario_grupo_deportivo(
        v_grupo,
        (SELECT f.id FROM public.grupos_deportivos_horarios f JOIN public.horarios h ON h.id = f.horario_id
         WHERE f.grupo_id = v_grupo AND h.dia_semana = 7 AND f.activo));
    IF v_otra.activo OR v_otra.fecha_baja IS NULL THEN
        RAISE EXCEPTION 'FALLO C7: la baja no quedó registrada: %', v_otra;
    END IF;
    BEGIN
        PERFORM public.dar_de_baja_horario_grupo_deportivo(v_grupo, v_otra.id);
        RAISE EXCEPTION 'FALLO C7: se dio de baja dos veces';
    EXCEPTION WHEN SQLSTATE 'P5591' THEN NULL;
    END;
    BEGIN
        PERFORM public.dar_de_baja_horario_grupo_deportivo(
            (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'), v_otra.id);
        RAISE EXCEPTION 'FALLO C7: se dio de baja una franja de otro grupo';
    EXCEPTION WHEN SQLSTATE 'P5590' THEN NULL;
    END;
    BEGIN
        PERFORM public.dar_de_baja_horario_grupo_deportivo(v_grupo, 'c1200000-0000-4000-8000-0000000000ff');
        RAISE EXCEPTION 'FALLO C7: se dio de baja una franja inexistente';
    EXCEPTION WHEN SQLSTATE 'P5590' THEN NULL;
    END;
    PERFORM public.agregar_horario_grupo_deportivo(v_grupo, 7::SMALLINT, '08:00', '09:00');
    IF (SELECT count(*) FROM public.grupos_deportivos_horarios f JOIN public.horarios h ON h.id = f.horario_id
        WHERE f.grupo_id = v_grupo AND h.dia_semana = 7) <> 2 THEN
        RAISE EXCEPTION 'FALLO C7: la reasignación no conservó el historial';
    END IF;
    RAISE NOTICE 'OK C7: baja lógica con fecha, doble baja P5591, ajena/inexistente P5590, reasignación con historial';

    -- C8. Grupo inexistente o nulo.
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo('c1200000-0000-4000-8000-0000000000fe', 1::SMALLINT, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO C8: se asignó una franja a un grupo inexistente';
    EXCEPTION WHEN SQLSTATE 'P5568' THEN NULL;
    END;
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(NULL, 1::SMALLINT, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO C8: se aceptó un grupo nulo';
    EXCEPTION WHEN SQLSTATE 'P5568' THEN NULL;
    END;
    RAISE NOTICE 'OK C8: grupo inexistente o nulo se rechaza (P5568)';

    -- C9. Escrituras directas rechazadas también para el DIRECTOR.
    BEGIN
        INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (6, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO C9: el DIRECTOR insertó en horarios';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.grupos_deportivos_horarios SET activo = FALSE;
        RAISE EXCEPTION 'FALLO C9: el DIRECTOR actualizó franjas';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.grupos_deportivos_horarios;
        RAISE EXCEPTION 'FALLO C9: el DIRECTOR borró franjas';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.horarios;
        RAISE EXCEPTION 'FALLO C9: el DIRECTOR borró horarios';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK C9: INSERT, UPDATE y DELETE directos se rechazan también para el DIRECTOR';
END $$;

-- C10. Identidad protegida aun para el propietario.
RESET ROLE;
DO $$
BEGIN
    BEGIN
        UPDATE public.horarios SET hora_fin = '11:30'
        WHERE dia_semana = 1 AND hora_inicio = '10:00' AND hora_fin = '11:00';
        RAISE EXCEPTION 'FALLO C10: se modificó un horario del catálogo';
    EXCEPTION WHEN SQLSTATE 'P5592' THEN NULL;
    END;
    BEGIN
        UPDATE public.grupos_deportivos_horarios
        SET grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA')
        WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL');
        RAISE EXCEPTION 'FALLO C10: se movió una franja de grupo';
    EXCEPTION WHEN SQLSTATE 'P5592' THEN NULL;
    END;
    BEGIN
        UPDATE public.grupos_deportivos_horarios SET activo = TRUE, fecha_baja = NULL WHERE NOT activo;
        RAISE EXCEPTION 'FALLO C10: se reactivó una franja dada de baja';
    EXCEPTION WHEN SQLSTATE 'P5592' THEN NULL;
    END;
    BEGIN
        INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id, activo, fecha_baja)
        VALUES ((SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'),
                (SELECT id FROM public.horarios LIMIT 1), FALSE, NOW());
        RAISE EXCEPTION 'FALLO C10: se creó una franja dada de baja';
    EXCEPTION WHEN SQLSTATE 'P5592' THEN NULL;
    END;
    BEGIN
        INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (1, '12:00', '11:00');
        RAISE EXCEPTION 'FALLO C10: el CHECK de rango no actuó';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (9, '10:00', '11:00');
        RAISE EXCEPTION 'FALLO C10: el CHECK de día no actuó';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (1, '23:00', '24:00');
        RAISE EXCEPTION 'FALLO C10: el catálogo aceptó 24:00';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (1, '10:00:00.25', '11:00');
        RAISE EXCEPTION 'FALLO C10: el catálogo aceptó una fracción de segundo';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        DELETE FROM public.grupos_deportivos WHERE id = (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL');
        RAISE EXCEPTION 'FALLO C10: se borró un grupo con franjas';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    RAISE NOTICE 'OK C10: catálogo inmutable, franja sin cambio de identidad ni reactivación, CHECK y FK RESTRICT activos';
END $$;


-- ================================================================
-- D. MATRIZ DEL ALUMNO
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000002"}', true);

DO $$
DECLARE
    v_alta      public.inscripciones_deportivas;
    v_caso      RECORD;
    v_mensaje   TEXT;
    v_detalle   TEXT;
    v_compat    RECORD;
BEGIN
    -- D1. Sin actividades previas, la inscripción continúa.
    v_alta := public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'));
    IF v_alta.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO D1: el primer alta no quedó ACTIVA';
    END IF;
    INSERT INTO ept12_valores VALUES ('A_FUTBOL', v_alta.id::TEXT);
    RAISE NOTICE 'OK D1: sin actividades previas, la inscripción continúa';

    -- D2. Cada forma de intersección del mismo día se rechaza con deporte, día y rango.
    FOR v_caso IN
        SELECT * FROM (VALUES
            ('IGUAL',     'igualdad exacta'),
            ('IZQUIERDA', 'solapamiento por izquierda'),
            ('DERECHA',   'solapamiento por derecha'),
            ('CONTENIDO', 'intervalo contenido'),
            ('CONTIENE',  'intervalo que contiene al existente')
        ) AS c(clave, nombre)
    LOOP
        BEGIN
            PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = v_caso.clave));
            RAISE EXCEPTION 'FALLO D2: se aceptó %', v_caso.nombre;
        EXCEPTION WHEN SQLSTATE 'P5584' THEN
            GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT, v_detalle = PG_EXCEPTION_DETAIL;
            IF v_mensaje <> 'Conflicto de horario con Fútbol (Fútbol H): lunes de 10:00 a 11:00.' THEN
                RAISE EXCEPTION 'FALLO D2: mensaje inesperado para %: %', v_caso.nombre, v_mensaje;
            END IF;
            IF v_detalle::JSONB <> '{"deporte":"Fútbol","grupo":"Fútbol H","dia_semana":1,"hora_inicio":"10:00","hora_fin":"11:00"}'::JSONB THEN
                RAISE EXCEPTION 'FALLO D2: detalle inesperado para %: %', v_caso.nombre, v_detalle;
            END IF;
        END;
    END LOOP;
    RAISE NOTICE 'OK D2: igualdad, izquierda, derecha, contenido y continente se rechazan (P5584) con deporte, día y rango';

    -- D3. Varias franjas por grupo: el conflicto con la SEGUNDA franja también se detecta.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'MIERCOLES'));
        RAISE EXCEPTION 'FALLO D3: se aceptó el choque con la franja del miércoles';
    EXCEPTION WHEN SQLSTATE 'P5584' THEN
        IF SQLERRM <> 'Conflicto de horario con Fútbol (Fútbol H): miércoles de 10:00 a 11:00.' THEN
            RAISE EXCEPTION 'FALLO D3: mensaje inesperado: %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'OK D3: con varias franjas por grupo, el conflicto informa la franja que choca (miércoles)';

    -- D4. Consulta de compatibilidad: coincide con lo que decide el alta.
    SELECT * INTO v_compat FROM public.consultar_compatibilidad_horaria()
    WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'CONTIENE');
    IF v_compat.conflicto_deporte <> 'Fútbol' OR v_compat.conflicto_dia_semana <> 1
       OR v_compat.conflicto_hora_inicio <> '10:00' OR v_compat.conflicto_hora_fin <> '11:00'
       OR NOT v_compat.tiene_horario THEN
        RAISE EXCEPTION 'FALLO D4: la consulta no anticipa el conflicto: %', v_compat;
    END IF;
    SELECT * INTO v_compat FROM public.consultar_compatibilidad_horaria()
    WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA');
    IF v_compat.conflicto_deporte IS NOT NULL OR NOT v_compat.tiene_horario THEN
        RAISE EXCEPTION 'FALLO D4: la consulta marca conflicto en otro día: %', v_compat;
    END IF;
    SELECT * INTO v_compat FROM public.consultar_compatibilidad_horaria()
    WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'SIN_HORARIO');
    IF v_compat.tiene_horario THEN
        RAISE EXCEPTION 'FALLO D4: la consulta no marca el grupo sin horario';
    END IF;
    IF EXISTS (SELECT 1 FROM public.consultar_compatibilidad_horaria()
               WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'INICIAL')) THEN
        RAISE EXCEPTION 'FALLO D4: la consulta incluye un grupo de otro nivel';
    END IF;
    RAISE NOTICE 'OK D4: la consulta propia anticipa conflicto, compatibilidad y falta de horario, solo en su nivel';

    -- D5. Grupo sin horario: se rechaza con un mensaje claro.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'SIN_HORARIO'));
        RAISE EXCEPTION 'FALLO D5: se aceptó un grupo sin horario';
    EXCEPTION WHEN SQLSTATE 'P5583' THEN
        IF SQLERRM <> 'Este grupo todavía no tiene horarios cargados, así que no admite inscripciones.' THEN
            RAISE EXCEPTION 'FALLO D5: mensaje inesperado: %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'OK D5: un grupo sin horarios cargados no admite inscripciones (P5583)';

    -- D6. Contigüidad posterior permitida.
    v_alta := public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_DESP'));
    PERFORM public.cancelar_inscripcion_deportiva(v_alta.id);
    RAISE NOTICE 'OK D6: lunes 11:00–12:00 después de lunes 10:00–11:00 se acepta (contiguo posterior)';

    -- D7. Contigüidad anterior permitida.
    v_alta := public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_ANT'));
    PERFORM public.cancelar_inscripcion_deportiva(v_alta.id);
    RAISE NOTICE 'OK D7: lunes 09:00–10:00 antes de lunes 10:00–11:00 se acepta (contiguo anterior)';

    -- D8. Días distintos, mismo rango: permitido.
    v_alta := public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'));
    INSERT INTO ept12_valores VALUES ('A_OTRO_DIA', v_alta.id::TEXT);
    RAISE NOTICE 'OK D8: martes 10:00–11:00 con lunes 10:00–11:00 se acepta (días distintos)';

    -- D9. Una inscripción cancelada no participa y su baja libera el horario.
    PERFORM public.cancelar_inscripcion_deportiva((SELECT valor::UUID FROM ept12_valores WHERE clave = 'A_FUTBOL'));
    v_alta := public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'IGUAL'));
    IF v_alta.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO D9: la baja no liberó el horario';
    END IF;
    RAISE NOTICE 'OK D9: tras cancelar Fútbol, el mismo lunes 10:00–11:00 queda libre (la cancelada no participa)';

    -- D10. Ana tiene ahora Natación (lunes 10–11) y Vóley martes: volver a
    -- Fútbol chocaría con Natación, pero el máximo de dos se evalúa antes.
    -- Las reglas de EPT-11 conservan su prioridad y su código.
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'));
        RAISE EXCEPTION 'FALLO D10: se aceptó un tercer deporte';
    EXCEPTION WHEN SQLSTATE 'P5577' THEN NULL;
    END;
    RAISE NOTICE 'OK D10: el máximo de dos conserva su prioridad sobre la regla horaria (orden de EPT-11 intacto)';
END $$;


-- ================================================================
-- E. MISMA DECISIÓN PARA EL ALUMNO Y PARA EL DIRECTOR
-- ================================================================
-- Bruno se inscribe solo en Fútbol; después intenta Natación igual. Carla
-- recibe exactamente lo mismo, pero por el DIRECTOR. Se comparan código,
-- mensaje y detalle.
SELECT set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000003"}', true);
DO $$
DECLARE
    v_mensaje TEXT;
    v_detalle TEXT;
BEGIN
    PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'));
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'IGUAL'));
        RAISE EXCEPTION 'FALLO E1: el alumno superó el conflicto';
    EXCEPTION WHEN SQLSTATE 'P5584' THEN
        GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT, v_detalle = PG_EXCEPTION_DETAIL;
        INSERT INTO ept12_valores VALUES ('ALUMNO_MENSAJE', v_mensaje), ('ALUMNO_DETALLE', v_detalle);
    END;
    RAISE NOTICE 'OK E1: el alumno recibe el conflicto por su propia inscripción';
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000001"}', true);
DO $$
DECLARE
    v_alta    public.inscripciones_deportivas;
    v_mensaje TEXT;
    v_detalle TEXT;
    v_compat  RECORD;
BEGIN
    -- E2. El DIRECTOR inscribe a Carla: sin actividades previas, continúa.
    v_alta := public.inscribir_alumno_en_grupo_deportivo(
        'c1200000-0000-4000-8000-000000000004', (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'));
    IF v_alta.alumno_id <> 'c1200000-0000-4000-8000-000000000004' OR v_alta.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO E2: el alta administrativa no quedó a nombre del alumno: %', v_alta;
    END IF;
    INSERT INTO ept12_valores VALUES ('C_FUTBOL', v_alta.id::TEXT);
    RAISE NOTICE 'OK E2: el DIRECTOR inscribe a un alumno sin actividades previas';

    -- E3. La consulta del DIRECTOR sobre Carla anticipa lo mismo que la del alumno.
    SELECT * INTO v_compat FROM public.consultar_compatibilidad_horaria_alumno('c1200000-0000-4000-8000-000000000004')
    WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'IGUAL');
    IF v_compat.conflicto_deporte <> 'Fútbol' OR v_compat.conflicto_dia_semana <> 1 THEN
        RAISE EXCEPTION 'FALLO E3: la consulta administrativa no anticipa el conflicto: %', v_compat;
    END IF;
    RAISE NOTICE 'OK E3: la consulta administrativa anticipa el mismo conflicto';

    -- E4. Mismo conflicto, misma respuesta.
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000004', (SELECT id FROM ept12_grupos WHERE clave = 'IGUAL'));
        RAISE EXCEPTION 'FALLO E4: el DIRECTOR superó el conflicto horario';
    EXCEPTION WHEN SQLSTATE 'P5584' THEN
        GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT, v_detalle = PG_EXCEPTION_DETAIL;
        IF v_mensaje <> (SELECT valor FROM ept12_valores WHERE clave = 'ALUMNO_MENSAJE')
           OR v_detalle::JSONB <> (SELECT valor FROM ept12_valores WHERE clave = 'ALUMNO_DETALLE')::JSONB THEN
            RAISE EXCEPTION 'FALLO E4: el DIRECTOR recibe otra respuesta: % / %', v_mensaje, v_detalle;
        END IF;
    END;
    RAISE NOTICE 'OK E4: alumno y DIRECTOR reciben el mismo código, mensaje y detalle ante el mismo conflicto';

    -- E5. Contiguo y sin horario, igual que el alumno.
    v_alta := public.inscribir_alumno_en_grupo_deportivo(
        'c1200000-0000-4000-8000-000000000004', (SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_DESP'));
    INSERT INTO ept12_valores VALUES ('C_CONTIGUO', v_alta.id::TEXT);
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000003', (SELECT id FROM ept12_grupos WHERE clave = 'SIN_HORARIO'));
        RAISE EXCEPTION 'FALLO E5: el DIRECTOR inscribió en un grupo sin horario';
    EXCEPTION WHEN SQLSTATE 'P5583' THEN NULL;
    END;
    RAISE NOTICE 'OK E5: el DIRECTOR también puede inscribir en contiguo y tampoco en un grupo sin horario';
END $$;


-- ================================================================
-- F. UNA FRANJA NUEVA NO CREA CONFLICTOS A LOS INSCRIPTOS
-- ================================================================
DO $$
BEGIN
    -- Carla está en Fútbol H (lunes/miércoles 10–11) y en Natación H contigua
    -- (lunes 11–12). Agregar a la contigua el miércoles 10:30–11:30 la haría
    -- chocar con Fútbol el miércoles.
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(
            (SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_DESP'), 3::SMALLINT, '10:30', '11:30');
        RAISE EXCEPTION 'FALLO F1: la franja nueva creó un conflicto a un inscripto';
    EXCEPTION WHEN SQLSTATE 'P5589' THEN
        IF SQLERRM <> 'La franja se superpone con Fútbol (Fútbol H): miércoles de 10:00 a 11:00, donde participa 1 alumno de este grupo.' THEN
            RAISE EXCEPTION 'FALLO F1: mensaje inesperado: %', SQLERRM;
        END IF;
        IF SQLERRM ILIKE '%Carla%' OR SQLERRM ILIKE '%LEG-EPT12%' THEN
            RAISE EXCEPTION 'FALLO F1: el mensaje expone la identidad del alumno';
        END IF;
    END;
    -- El miércoles 11:00–12:00 es contiguo a Fútbol: se acepta.
    PERFORM public.agregar_horario_grupo_deportivo(
        (SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_DESP'), 3::SMALLINT, '11:00', '12:00');
    RAISE NOTICE 'OK F1: la franja que chocaría con otra actividad de un inscripto se rechaza (P5589) sin identificarlo; la contigua se acepta';

    -- F2. Una inscripción cancelada no bloquea franjas. Ana canceló Fútbol H
    -- y sigue ACTIVA en Vóley H martes (10:00–11:00). Los inscriptos activos de
    -- Fútbol (Bruno y Carla) no tienen nada el martes, así que agregar a Fútbol
    -- el martes 10:30–11:00 solo chocaría si la baja de Ana contara.
    PERFORM public.agregar_horario_grupo_deportivo(
        (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'), 2::SMALLINT, '10:30', '11:00');
    RAISE NOTICE 'OK F2: la regla de franjas considera solo inscripciones ACTIVAS (la cancelada de Ana no bloquea el martes)';
END $$;


-- ================================================================
-- G. REGRESIÓN DE EPT-11 CON HORARIOS CARGADOS
-- ================================================================
-- Estado al entrar: Ana ACTIVA en Natación H igual y Vóley H martes; Bruno
-- en Fútbol H; Carla en Fútbol H y Natación H contigua. Sesión: DIRECTOR.
DO $$
BEGIN
    -- G1. Máximo de dos, con el mensaje en tercera persona para la dirección.
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000004', (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'));
        RAISE EXCEPTION 'FALLO G1: se superó el máximo de dos';
    EXCEPTION WHEN SQLSTATE 'P5577' THEN
        IF SQLERRM <> 'El alumno ya tiene dos deportes activos, que es el máximo permitido.' THEN
            RAISE EXCEPTION 'FALLO G1: la dirección recibe el mensaje en segunda persona: %', SQLERRM;
        END IF;
    END;

    -- G2. Mismo grupo (P5575) y mismo deporte en otro grupo (P5576).
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000004', (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'));
        RAISE EXCEPTION 'FALLO G2: se duplicó el grupo';
    EXCEPTION WHEN SQLSTATE 'P5575' THEN
        IF SQLERRM <> 'El alumno ya está inscripto en este grupo.' THEN
            RAISE EXCEPTION 'FALLO G2: mensaje inesperado: %', SQLERRM;
        END IF;
    END;
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000004', (SELECT id FROM ept12_grupos WHERE clave = 'IGUAL'));
        RAISE EXCEPTION 'FALLO G2: se duplicó el deporte';
    EXCEPTION WHEN SQLSTATE 'P5576' THEN
        IF SQLERRM <> 'El alumno ya está inscripto en otro grupo de este deporte.' THEN
            RAISE EXCEPTION 'FALLO G2: mensaje inesperado: %', SQLERRM;
        END IF;
    END;

    -- G3. Nivel ajeno.
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000003', (SELECT id FROM ept12_grupos WHERE clave = 'INICIAL'));
        RAISE EXCEPTION 'FALLO G3: se inscribió en un nivel ajeno';
    EXCEPTION WHEN SQLSTATE 'P5573' THEN NULL;
    END;

    -- G4. Alumno inactivo, persona sin legajo y parámetros nulos.
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000005', (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'));
        RAISE EXCEPTION 'FALLO G4: se inscribió a un alumno inactivo';
    EXCEPTION WHEN SQLSTATE 'P5571' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000007', (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'));
        RAISE EXCEPTION 'FALLO G4: se inscribió a un docente';
    EXCEPTION WHEN SQLSTATE 'P5570' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(NULL, (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'));
        RAISE EXCEPTION 'FALLO G4: se aceptó un alumno nulo';
    EXCEPTION WHEN SQLSTATE 'P5570' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo('c1200000-0000-4000-8000-000000000003', NULL);
        RAISE EXCEPTION 'FALLO G4: se aceptó un grupo nulo';
    EXCEPTION WHEN SQLSTATE 'P5568' THEN NULL;
    END;
    RAISE NOTICE 'OK G1–G4: máximo de dos, duplicado, mismo deporte, nivel ajeno, inactivo y sin legajo se mantienen para el DIRECTOR';
END $$;

-- G5. Cupo con horarios, por las dos vías. Ana deja Vóley martes y toma la
-- única plaza de Vóley H última plaza (viernes); después la dirección intenta
-- sumar a Bruno, que tiene un solo deporte y ningún viernes: solo el cupo lo
-- impide.
SELECT set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000002"}', true);
DO $$
BEGIN
    PERFORM public.cancelar_inscripcion_deportiva((SELECT valor::UUID FROM ept12_valores WHERE clave = 'A_OTRO_DIA'));
    PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CUPO_UNO'));

    -- G6. La vía del alumno conserva también sus rechazos de EPT-11.
    BEGIN
        -- Atletismo, un tercer deporte sin conflicto: solo el máximo lo impide.
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'CONTIGUO_ANT'));
        RAISE EXCEPTION 'FALLO G6: el alumno superó el máximo de dos';
    EXCEPTION WHEN SQLSTATE 'P5577' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'IGUAL'));
        RAISE EXCEPTION 'FALLO G6: el alumno duplicó el grupo';
    EXCEPTION WHEN SQLSTATE 'P5575' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_en_grupo_deportivo((SELECT id FROM ept12_grupos WHERE clave = 'INICIAL'));
        RAISE EXCEPTION 'FALLO G6: el alumno entró a un nivel ajeno';
    EXCEPTION WHEN SQLSTATE 'P5573' THEN NULL;
    END;
    RAISE NOTICE 'OK G6: la vía del alumno conserva máximo de dos, duplicado y nivel con horarios cargados';
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000001"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000003', (SELECT id FROM ept12_grupos WHERE clave = 'CUPO_UNO'));
        RAISE EXCEPTION 'FALLO G5: se superó el cupo';
    EXCEPTION WHEN SQLSTATE 'P5574' THEN NULL;
    END;
    RAISE NOTICE 'OK G5: el cupo se respeta con horarios cargados, por la vía del alumno y la del DIRECTOR (P5574)';
END $$;


-- ================================================================
-- H. DENEGACIONES POR ROL
-- ================================================================
DO $$
DECLARE
    v_actor RECORD;
BEGIN
    FOR v_actor IN
        SELECT * FROM (VALUES
            ('c1200000-0000-4000-8000-000000000002', 'ESTUDIANTE'),
            ('c1200000-0000-4000-8000-000000000007', 'DOCENTE'),
            ('c1200000-0000-4000-8000-000000000008', 'PADRE'),
            ('c1200000-0000-4000-8000-000000000009', 'PERSONAL'),
            ('c1200000-0000-4000-8000-00000000000b', 'SIN PERFIL')
        ) AS a(sub, etiqueta)
    LOOP
        PERFORM set_config('request.jwt.claims', pg_catalog.format('{"sub":"%s"}', v_actor.sub), true);
        BEGIN
            PERFORM public.agregar_horario_grupo_deportivo(
                (SELECT id FROM ept12_grupos WHERE clave = 'SIN_HORARIO'), 6::SMALLINT, '08:00', '09:00');
            RAISE EXCEPTION 'FALLO H1: % asignó una franja', v_actor.etiqueta;
        EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
        END;
        BEGIN
            PERFORM public.dar_de_baja_horario_grupo_deportivo(
                (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL'),
                (SELECT id FROM public.grupos_deportivos_horarios
                 WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL') AND activo LIMIT 1));
            RAISE EXCEPTION 'FALLO H1: % dio de baja una franja', v_actor.etiqueta;
        EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
        END;
        BEGIN
            PERFORM public.inscribir_alumno_en_grupo_deportivo(
                'c1200000-0000-4000-8000-000000000003', (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'));
            RAISE EXCEPTION 'FALLO H1: % inscribió administrativamente', v_actor.etiqueta;
        EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
        END;
        BEGIN
            PERFORM public.consultar_compatibilidad_horaria_alumno('c1200000-0000-4000-8000-000000000003');
            RAISE EXCEPTION 'FALLO H1: % consultó la compatibilidad de otro alumno', v_actor.etiqueta;
        EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
        END;
        IF v_actor.etiqueta <> 'ESTUDIANTE' THEN
            BEGIN
                PERFORM public.consultar_compatibilidad_horaria();
                RAISE EXCEPTION 'FALLO H1: % usó la consulta del estudiante', v_actor.etiqueta;
            EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
            END;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK H1: ESTUDIANTE, DOCENTE, PADRE, PERSONAL y sin perfil no configuran franjas, no inscriben a terceros ni consultan a otro alumno (42501)';

    -- H2. El DIRECTOR no usa la consulta del estudiante.
    PERFORM set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000001"}', true);
    BEGIN
        PERFORM public.consultar_compatibilidad_horaria();
        RAISE EXCEPTION 'FALLO H2: el DIRECTOR usó la consulta del estudiante';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
        PERFORM public.consultar_compatibilidad_horaria_alumno('c1200000-0000-4000-8000-000000000007');
        RAISE EXCEPTION 'FALLO H2: se consultó a una persona sin legajo';
    EXCEPTION WHEN SQLSTATE 'P5570' THEN NULL;
    END;
    RAISE NOTICE 'OK H2: el DIRECTOR consulta solo a través de la operación administrativa y solo sobre alumnos';
END $$;

-- H3. Sin identidad autenticada.
SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(
            (SELECT id FROM ept12_grupos WHERE clave = 'SIN_HORARIO'), 6::SMALLINT, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO H3: se asignó una franja sin identidad';
    EXCEPTION WHEN SQLSTATE 'P5505' THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000003', (SELECT id FROM ept12_grupos WHERE clave = 'OTRO_DIA'));
        RAISE EXCEPTION 'FALLO H3: se inscribió sin identidad';
    EXCEPTION WHEN SQLSTATE 'P5505' THEN NULL;
    END;
    RAISE NOTICE 'OK H3: sin identidad autenticada las operaciones se rechazan (P5505)';
END $$;

-- H4. anon no ejecuta ni lee nada de horarios.
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
    BEGIN
        PERFORM public.agregar_horario_grupo_deportivo(
            'c1200000-0000-4000-8000-0000000000fe', 1::SMALLINT, '08:00', '09:00');
        RAISE EXCEPTION 'FALLO H4: anon ejecutó la asignación';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.consultar_compatibilidad_horaria();
        RAISE EXCEPTION 'FALLO H4: anon ejecutó la consulta';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.inscribir_alumno_en_grupo_deportivo(
            'c1200000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-0000000000fe');
        RAISE EXCEPTION 'FALLO H4: anon ejecutó el alta administrativa';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM 1 FROM public.horarios;
        RAISE EXCEPTION 'FALLO H4: anon leyó horarios';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM 1 FROM public.grupos_deportivos_horarios;
        RAISE EXCEPTION 'FALLO H4: anon leyó franjas';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK H4: anon no ejecuta ninguna operación de horarios ni lee sus tablas';
END $$;
RESET ROLE;


-- ================================================================
-- I. VISIBILIDAD POR RLS
-- ================================================================
-- El total de referencia se cuenta como propietario: con una identidad
-- cualquiera, RLS lo recortaría y la comparación no probaría nada.
INSERT INTO ept12_valores
SELECT 'TOTAL_FRANJAS', count(*)::TEXT FROM public.grupos_deportivos_horarios f
WHERE f.grupo_id IN (SELECT id FROM ept12_grupos);

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_total BIGINT := (SELECT valor::BIGINT FROM ept12_valores WHERE clave = 'TOTAL_FRANJAS');
BEGIN
    IF v_total < 15 THEN
        RAISE EXCEPTION 'FALLO I1: el total de referencia es sospechosamente bajo: %', v_total;
    END IF;

    -- I1. El DIRECTOR ve todas las franjas.
    PERFORM set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000001"}', true);
    IF (SELECT count(*) FROM public.grupos_deportivos_horarios f
        WHERE f.grupo_id IN (SELECT id FROM ept12_grupos)) <> v_total THEN
        RAISE EXCEPTION 'FALLO I1: el DIRECTOR no ve todas las franjas';
    END IF;

    -- I2. El estudiante ve las de su nivel y no las del grupo INICIAL.
    PERFORM set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000002"}', true);
    IF EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios
               WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'INICIAL'))
       OR NOT EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios
                      WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'FUTBOL')) THEN
        RAISE EXCEPTION 'FALLO I2: el estudiante no ve exactamente las franjas de su nivel';
    END IF;
    -- Y la consulta propia no revela las inscripciones de otros alumnos:
    -- Bruno está en Fútbol, pero Ana (que lo canceló) no ve conflicto con él.
    IF EXISTS (SELECT 1 FROM public.consultar_compatibilidad_horaria()
               WHERE grupo_id = (SELECT id FROM ept12_grupos WHERE clave = 'CONTENIDO')
                 AND conflicto_grupo = 'Fútbol H') THEN
        RAISE EXCEPTION 'FALLO I2: la consulta usó actividades de otro alumno';
    END IF;

    -- I3. DOCENTE, PADRE, PERSONAL y sin perfil no ven franjas.
    PERFORM set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000007"}', true);
    IF EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios) THEN
        RAISE EXCEPTION 'FALLO I3: el DOCENTE ve franjas';
    END IF;
    PERFORM set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000008"}', true);
    IF EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios) THEN
        RAISE EXCEPTION 'FALLO I3: el PADRE ve franjas';
    END IF;
    PERFORM set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-000000000009"}', true);
    IF EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios) THEN
        RAISE EXCEPTION 'FALLO I3: PERSONAL ve franjas';
    END IF;
    PERFORM set_config('request.jwt.claims', '{"sub":"c1200000-0000-4000-8000-00000000000b"}', true);
    IF EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios) THEN
        RAISE EXCEPTION 'FALLO I3: una sesión sin perfil ve franjas';
    END IF;
    RAISE NOTICE 'OK I1–I3: el DIRECTOR ve todas las franjas, el estudiante las de su nivel y el resto ninguna';
END $$;
RESET ROLE;


-- ================================================================
-- J. INVARIANTE FINAL
-- ================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.inscripciones_deportivas a
        JOIN public.inscripciones_deportivas b
          ON b.alumno_id = a.alumno_id AND b.id > a.id AND b.estado = 'ACTIVA'
        JOIN public.grupos_deportivos_horarios fa ON fa.grupo_id = a.grupo_id AND fa.activo
        JOIN public.horarios ha ON ha.id = fa.horario_id
        JOIN public.grupos_deportivos_horarios fb ON fb.grupo_id = b.grupo_id AND fb.activo
        JOIN public.horarios hb ON hb.id = fb.horario_id
        WHERE a.estado = 'ACTIVA'
          AND app_private.intervalos_se_superponen(ha.dia_semana, ha.hora_inicio, ha.hora_fin,
                                                   hb.dia_semana, hb.hora_inicio, hb.hora_fin)
    ) THEN
        RAISE EXCEPTION 'FALLO J1: quedó un alumno con dos actividades superpuestas';
    END IF;
    IF (SELECT count(*) FROM public.inscripciones_deportivas
        WHERE alumno_id::TEXT LIKE 'c1200000-%' AND estado = 'CANCELADA') < 4 THEN
        RAISE EXCEPTION 'FALLO J1: las bajas no quedaron como historial';
    END IF;
    RAISE NOTICE 'OK J1: ningún alumno quedó con dos actividades activas superpuestas y las bajas se conservan';
END $$;

\o
\echo 'EPT-12: todas las comprobaciones de horarios pasaron; se revierte la transacción.'
ROLLBACK;
