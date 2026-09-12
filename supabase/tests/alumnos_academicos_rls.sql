-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación del legajo académico (EPT-9 / EPT-24)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Cubre los casos 1 a 16 y 21 a 31 del alcance de EPT-24. La concurrencia real
-- (17 a 20) vive en `alumnos_academicos_concurrencia.mjs`, porque exige dos
-- conexiones simultáneas y no puede demostrarse dentro de una sola transacción.
--
-- Todos los datos son sintéticos. Los DNI pertenecen al rango 92.0xx.xxx y no
-- corresponden a ninguna persona real.

\set ON_ERROR_STOP on

BEGIN;

-- ================================================================
-- IDENTIDADES Y CATÁLOGO SINTÉTICOS
-- ================================================================
-- `auth.uid()` obtiene `sub` desde estos claims.
INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni, legajo_nro)
VALUES
    ('71111111-1111-4111-8111-111111111111',
     (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),   'Prueba', 'Directora',  '92000001', NULL),
    ('72222222-2222-4222-8222-222222222222',
     (SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),    'Prueba', 'Docente',    '92000002', NULL),
    ('73333333-3333-4333-8333-333333333333',
     (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Prueba', 'Estudiante', '92000003', 'LEG-SQL-0003'),
    ('74444444-4444-4444-8444-444444444444',
     (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Prueba', 'Ajeno',      '92000004', 'LEG-SQL-0004'),
    ('75555555-5555-4555-8555-555555555555',
     (SELECT id FROM public.roles WHERE nombre = 'PADRE'),      'Prueba', 'Padre',      '92000005', NULL),
    ('76666666-6666-4666-8666-666666666666',
     (SELECT id FROM public.roles WHERE nombre = 'PERSONAL'),   'Prueba', 'Personal',   '92000006', NULL);

INSERT INTO public.cursos (nivel_id, denominacion, division, activo)
VALUES
    ((SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Primero SQL',  'A', TRUE),
    ((SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Segundo SQL',  'B', TRUE),
    ((SELECT id FROM public.niveles WHERE nombre = 'INICIAL'),  'Sala SQL',     'C', FALSE);


-- ================================================================
-- 1. ESTRUCTURA, INTEGRIDAD Y PRIVILEGIOS
-- ================================================================
DO $$
DECLARE
    tipo_borrado "char";
    definicion   TEXT;
BEGIN
    -- 1. Las dos tablas existen con RLS habilitada.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.alumnos'::regclass) THEN
        RAISE EXCEPTION 'FALLO 1.1: alumnos no tiene RLS habilitada';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.matriculas'::regclass) THEN
        RAISE EXCEPTION 'FALLO 1.2: matriculas no tiene RLS habilitada';
    END IF;
    RAISE NOTICE 'OK 1: alumnos y matriculas existen con RLS habilitada';

    -- 2. El estado es un catálogo cerrado de exactamente dos valores.
    IF (SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
        FROM pg_enum WHERE enumtypid = 'public.estado_alumno'::regtype)
       IS DISTINCT FROM ARRAY['ACTIVO', 'INACTIVO'] THEN
        RAISE EXCEPTION 'FALLO 2: el catálogo de estados no es exactamente ACTIVO e INACTIVO';
    END IF;
    RAISE NOTICE 'OK 2: el estado académico admite exactamente ACTIVO e INACTIVO';

    -- 3. Índice único parcial: como máximo una matrícula activa por alumno.
    SELECT indexdef INTO definicion
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_matriculas_una_activa_por_alumno';

    IF definicion IS NULL
       OR definicion NOT ILIKE 'CREATE UNIQUE INDEX%'
       OR definicion NOT ILIKE '%WHERE (fecha_cierre IS NULL)%' THEN
        RAISE EXCEPTION 'FALLO 3: falta la unicidad parcial de la matrícula vigente: %', definicion;
    END IF;
    RAISE NOTICE 'OK 3: un índice único parcial garantiza una sola matrícula vigente por alumno';

    -- 4. Las claves foráneas del historial impiden borrados en cascada.
    SELECT confdeltype INTO tipo_borrado
    FROM pg_constraint
    WHERE conrelid = 'public.matriculas'::regclass
      AND confrelid = 'public.cursos'::regclass
      AND contype = 'f';
    IF tipo_borrado IS DISTINCT FROM 'r' THEN
        RAISE EXCEPTION 'FALLO 4.1: matriculas.curso_id no usa ON DELETE RESTRICT: %', tipo_borrado;
    END IF;

    SELECT confdeltype INTO tipo_borrado
    FROM pg_constraint
    WHERE conrelid = 'public.matriculas'::regclass
      AND confrelid = 'public.alumnos'::regclass
      AND contype = 'f';
    IF tipo_borrado IS DISTINCT FROM 'r' THEN
        RAISE EXCEPTION 'FALLO 4.2: matriculas.alumno_id no usa ON DELETE RESTRICT: %', tipo_borrado;
    END IF;

    SELECT confdeltype INTO tipo_borrado
    FROM pg_constraint
    WHERE conrelid = 'public.alumnos'::regclass
      AND confrelid = 'public.perfiles'::regclass
      AND contype = 'f';
    IF tipo_borrado IS DISTINCT FROM 'r' THEN
        RAISE EXCEPTION 'FALLO 4.3: alumnos.perfil_id no usa ON DELETE RESTRICT: %', tipo_borrado;
    END IF;
    RAISE NOTICE 'OK 4: las tres claves foráneas del legajo usan ON DELETE RESTRICT';

    -- 5. Toda clave foránea tiene índice de apoyo.
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_matriculas_alumno_historial'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_matriculas_curso'
    ) THEN
        RAISE EXCEPTION 'FALLO 5: falta un índice de clave foránea en matriculas';
    END IF;
    RAISE NOTICE 'OK 5: las claves foráneas de matriculas tienen índice';

    -- 6. El nivel no está copiado en ninguna tabla académica.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('alumnos', 'matriculas')
          AND column_name LIKE '%nivel%'
    ) THEN
        RAISE EXCEPTION 'FALLO 6: existe una copia persistida del nivel en el modelo académico';
    END IF;
    RAISE NOTICE 'OK 6: el nivel no se persiste; se deriva de cursos.nivel_id';

    -- 7. Privilegios mínimos: solo lectura para la aplicación, nada para anon.
    FOR definicion IN
        SELECT unnest(ARRAY['public.alumnos', 'public.matriculas'])
    LOOP
        IF has_table_privilege('authenticated', definicion, 'INSERT')
           OR has_table_privilege('authenticated', definicion, 'UPDATE')
           OR has_table_privilege('authenticated', definicion, 'DELETE')
           OR has_table_privilege('authenticated', definicion, 'TRUNCATE') THEN
            RAISE EXCEPTION 'FALLO 7.1: authenticated conserva privilegios de escritura sobre %', definicion;
        END IF;
        IF NOT has_table_privilege('authenticated', definicion, 'SELECT') THEN
            RAISE EXCEPTION 'FALLO 7.2: authenticated no puede leer %', definicion;
        END IF;
        IF has_table_privilege('anon', definicion, 'SELECT')
           OR has_table_privilege('anon', definicion, 'INSERT')
           OR has_table_privilege('anon', definicion, 'UPDATE')
           OR has_table_privilege('anon', definicion, 'DELETE')
           OR has_table_privilege('anon', definicion, 'TRUNCATE') THEN
            RAISE EXCEPTION 'FALLO 7.3: anon conserva privilegios sobre %', definicion;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK 7: alumnos y matriculas son de solo lectura para authenticated y opacas para anon';

    -- 8. No existe ninguna política de escritura.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('alumnos', 'matriculas')
          AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'FALLO 8: existe una política de escritura sobre el modelo académico';
    END IF;
    RAISE NOTICE 'OK 8: solo hay políticas de SELECT; RLS deniega toda escritura directa';

    -- 9. Las vistas respetan RLS.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'alumnos_academicos'
          AND c.reloptions @> ARRAY['security_invoker=true']
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'matriculas_historial'
          AND c.reloptions @> ARRAY['security_invoker=true']
    ) THEN
        RAISE EXCEPTION 'FALLO 9: alguna vista académica no usa security_invoker';
    END IF;
    RAISE NOTICE 'OK 9: las dos vistas académicas usan security_invoker y respetan RLS';

    -- 10. Toda función privilegiada fija search_path.
    -- PostgreSQL guarda el ajuste como `search_path=""`, con las comillas
    -- escapadas dentro del arreglo `proconfig`.
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app_private'
          AND p.prosecdef
          AND NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""'])
    ) THEN
        RAISE EXCEPTION 'FALLO 10: una función SECURITY DEFINER de app_private no fija search_path';
    END IF;
    RAISE NOTICE 'OK 10: toda función SECURITY DEFINER de app_private fija search_path vacío';

    -- 11. `perfiles` ya no admite borrado físico desde la aplicación.
    IF has_table_privilege('authenticated', 'public.perfiles', 'DELETE')
       OR has_table_privilege('authenticated', 'public.perfiles', 'TRUNCATE')
       OR has_table_privilege('anon', 'public.perfiles', 'DELETE')
       OR has_table_privilege('anon', 'public.perfiles', 'TRUNCATE') THEN
        RAISE EXCEPTION 'FALLO 11: perfiles conserva privilegios de borrado físico';
    END IF;
    RAISE NOTICE 'OK 11: perfiles no admite DELETE ni TRUNCATE desde los roles de aplicación';

    -- 12. El contrato del DNI vive en la base, no solo en la interfaz.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.perfiles'::regclass
          AND conname = 'perfiles_dni_valido'
          AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'FALLO 12: falta la restricción de DNI en perfiles';
    END IF;
    RAISE NOTICE 'OK 12: PostgreSQL exige el contrato de DNI de 7 u 8 dígitos';
END $$;


-- ================================================================
-- 2. DIRECTOR: ALTAS VÁLIDAS Y NIVEL DERIVADO
-- ================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
                  '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

DO $$
DECLARE
    curso_activo  UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Primero SQL');
    activo_id     UUID;
    inactivo_id   UUID;
    fila          public.alumnos_academicos;
    cantidad      BIGINT;
BEGIN
    -- 13. Alta ACTIVO válida.
    activo_id := public.crear_alumno(
        'Mariana', 'Bordón', '92100001', 'ACTIVO', 'LEG-SQL-1001', curso_activo
    );

    SELECT * INTO fila FROM public.alumnos_academicos WHERE id = activo_id;
    IF fila.estado <> 'ACTIVO' OR fila.curso_id IS DISTINCT FROM curso_activo THEN
        RAISE EXCEPTION 'FALLO 13.1: el alta ACTIVO no quedó matriculada: %', fila;
    END IF;
    IF fila.legajo_nro <> 'LEG-SQL-1001' OR fila.dni <> '92100001' THEN
        RAISE EXCEPTION 'FALLO 13.2: el alta ACTIVO no conservó DNI o legajo: %', fila;
    END IF;
    IF fila.tiene_cuenta THEN
        RAISE EXCEPTION 'FALLO 13.3: el alta creó una cuenta de acceso, y no debe';
    END IF;
    RAISE NOTICE 'OK 13: alta ACTIVO válida, con legajo y matrícula, y sin cuenta de acceso';

    -- 14. El nivel se deriva del curso, no de una copia.
    IF fila.nivel_nombre IS DISTINCT FROM 'PRIMARIO' THEN
        RAISE EXCEPTION 'FALLO 14: el nivel derivado es %, se esperaba PRIMARIO', fila.nivel_nombre;
    END IF;
    RAISE NOTICE 'OK 14: el nivel mostrado se deriva de cursos.nivel_id';

    -- 15. Alta INACTIVO válida, sin matrícula.
    inactivo_id := public.crear_alumno(
        'Joaquín', 'Villalba', '9210002', 'INACTIVO'
    );
    SELECT * INTO fila FROM public.alumnos_academicos WHERE id = inactivo_id;
    IF fila.estado <> 'INACTIVO' OR fila.matricula_id IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 15.1: el alta INACTIVO quedó con matrícula: %', fila;
    END IF;
    IF fila.nivel_nombre IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 15.2: un alumno sin matrícula no puede tener nivel';
    END IF;
    RAISE NOTICE 'OK 15: alta INACTIVO válida, sin matrícula y sin nivel, con DNI de 7 dígitos';

    -- 16. Exactamente una matrícula activa.
    SELECT count(*) INTO cantidad
    FROM public.matriculas WHERE alumno_id = activo_id AND fecha_cierre IS NULL;
    IF cantidad <> 1 THEN
        RAISE EXCEPTION 'FALLO 16: el alumno activo tiene % matrículas vigentes', cantidad;
    END IF;
    RAISE NOTICE 'OK 16: el alumno activo tiene exactamente una matrícula vigente';
END $$;


-- ================================================================
-- 3. RECHAZOS SIN PERSISTENCIA PARCIAL
-- ================================================================
DO $$
DECLARE
    curso_activo   UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Primero SQL');
    curso_inactivo UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Sala SQL');
    antes          BIGINT;
    despues        BIGINT;
    nuevo          UUID;
BEGIN
    SELECT count(*) INTO antes FROM public.perfiles;

    -- 17. Curso inexistente.
    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100010', 'ACTIVO', 'LEG-SQL-1010',
                                    '00000000-0000-4000-8000-000000000000');
        RAISE EXCEPTION 'FALLO 17: se aceptó un curso inexistente';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'OK 17: curso inexistente rechazado (23503)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 18. Curso inactivo.
    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100010', 'ACTIVO', 'LEG-SQL-1010',
                                    curso_inactivo);
        RAISE EXCEPTION 'FALLO 18: se aceptó un curso inactivo';
    EXCEPTION WHEN SQLSTATE 'P5504' THEN
        RAISE NOTICE 'OK 18: curso inactivo rechazado (P5504)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 19. DNI inválido: letras, longitud y dígitos no ASCII.
    FOR nuevo IN SELECT NULL::UUID LOOP END LOOP;
    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', 'T9210001', 'INACTIVO');
        RAISE EXCEPTION 'FALLO 19.1: se aceptó un DNI con letras';
    EXCEPTION WHEN SQLSTATE 'P5510' THEN
        RAISE NOTICE 'OK 19.1: DNI con letras rechazado (P5510)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '921000', 'INACTIVO');
        RAISE EXCEPTION 'FALLO 19.2: se aceptó un DNI de 6 dígitos';
    EXCEPTION WHEN SQLSTATE 'P5510' THEN
        RAISE NOTICE 'OK 19.2: DNI de 6 dígitos rechazado (P5510)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    BEGIN
        -- El último carácter es el dígito arábigo-índico ٨, no un 8 ASCII.
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '9210000' || chr(1640), 'INACTIVO');
        RAISE EXCEPTION 'FALLO 19.3: se aceptó un dígito no ASCII en el DNI';
    EXCEPTION WHEN SQLSTATE 'P5510' THEN
        RAISE NOTICE 'OK 19.3: dígito no ASCII en el DNI rechazado (P5510)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 20. DNI duplicado, incluso contra un alumno inactivo.
    BEGIN
        PERFORM public.crear_alumno('Otra', 'Persona', '9210002', 'INACTIVO');
        RAISE EXCEPTION 'FALLO 20: se aceptó un DNI ya reservado por un alumno inactivo';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 20: DNI duplicado rechazado (23505), incluso reservado por un inactivo';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 21. Legajo inválido.
    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100011', 'ACTIVO', ' LEG-SQL-1011 ',
                                    curso_activo);
        RAISE EXCEPTION 'FALLO 21: se aceptó un legajo con espacios laterales';
    EXCEPTION WHEN SQLSTATE 'P5515' THEN
        RAISE NOTICE 'OK 21: legajo con espacios laterales rechazado (P5515)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 22. Legajo duplicado, también con otra combinación de mayúsculas.
    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100011', 'ACTIVO', 'leg-sql-1001',
                                    curso_activo);
        RAISE EXCEPTION 'FALLO 22: se aceptó un legajo duplicado sin distinguir mayúsculas';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 22: legajo duplicado rechazado (23505), sin distinguir mayúsculas';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 23. Estado inválido.
    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100012', 'SUSPENDIDO');
        RAISE EXCEPTION 'FALLO 23: se aceptó un estado fuera del catálogo';
    EXCEPTION WHEN SQLSTATE 'P5516' THEN
        RAISE NOTICE 'OK 23: estado fuera del catálogo rechazado (P5516)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 24. ACTIVO sin curso y sin legajo; INACTIVO con curso.
    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100012', 'ACTIVO', 'LEG-SQL-1012');
        RAISE EXCEPTION 'FALLO 24.1: se aceptó un alumno activo sin curso';
    EXCEPTION WHEN SQLSTATE 'P5511' THEN
        RAISE NOTICE 'OK 24.1: alumno activo sin curso rechazado (P5511)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100012', 'ACTIVO', NULL, curso_activo);
        RAISE EXCEPTION 'FALLO 24.2: se aceptó un alumno activo sin legajo';
    EXCEPTION WHEN SQLSTATE 'P5512' THEN
        RAISE NOTICE 'OK 24.2: alumno activo sin legajo rechazado (P5512)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    BEGIN
        PERFORM public.crear_alumno('Sofía', 'Ledesma', '92100012', 'INACTIVO', 'LEG-SQL-1012',
                                    curso_activo);
        RAISE EXCEPTION 'FALLO 24.3: se aceptó un alumno inactivo con curso';
    EXCEPTION WHEN SQLSTATE 'P5513' THEN
        RAISE NOTICE 'OK 24.3: alumno inactivo con curso rechazado (P5513)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 25. Cero persistencia parcial: ningún rechazo dejó una persona a medias.
    SELECT count(*) INTO despues FROM public.perfiles;
    IF despues <> antes THEN
        RAISE EXCEPTION 'FALLO 25: los rechazos dejaron % perfiles persistidos', despues - antes;
    END IF;
    RAISE NOTICE 'OK 25: ninguno de los rechazos persistió una fila (cero persistencia parcial)';
END $$;


-- ================================================================
-- 4. CICLO DE VIDA: CAMBIO DE CURSO, INACTIVACIÓN Y REACTIVACIÓN
-- ================================================================
DO $$
DECLARE
    curso_a   UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Primero SQL');
    curso_b   UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Segundo SQL');
    alumno    UUID := (SELECT id FROM public.alumnos_academicos WHERE dni = '92100001');
    fila      public.alumnos_academicos;
    tramos    BIGINT;
    cerrado   public.matriculas;
    id_previo UUID;
BEGIN
    id_previo := alumno;

    -- 26. Cambio de curso: cierra el tramo anterior y abre uno nuevo.
    PERFORM public.cambiar_curso_alumno(alumno, curso_b);

    SELECT count(*) INTO tramos FROM public.matriculas WHERE alumno_id = alumno;
    IF tramos <> 2 THEN
        RAISE EXCEPTION 'FALLO 26.1: se esperaban 2 tramos de historial y hay %', tramos;
    END IF;

    SELECT * INTO cerrado
    FROM public.matriculas
    WHERE alumno_id = alumno AND curso_id = curso_a;
    IF cerrado.fecha_cierre IS NULL OR cerrado.motivo_cierre <> 'CAMBIO_DE_CURSO' THEN
        RAISE EXCEPTION 'FALLO 26.2: el tramo anterior no se cerró con su motivo: %', cerrado;
    END IF;

    SELECT * INTO fila FROM public.alumnos_academicos WHERE id = alumno;
    IF fila.curso_id IS DISTINCT FROM curso_b OR fila.estado <> 'ACTIVO' THEN
        RAISE EXCEPTION 'FALLO 26.3: la matrícula nueva no quedó vigente: %', fila;
    END IF;
    RAISE NOTICE 'OK 26: el cambio de curso cierra el tramo anterior, abre otro y conserva la historia';

    -- 27. Inactivación: cierra la matrícula y conserva identidad e historial.
    PERFORM public.inactivar_alumno(alumno);

    SELECT * INTO fila FROM public.alumnos_academicos WHERE id = alumno;
    IF fila.estado <> 'INACTIVO' OR fila.matricula_id IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 27.1: la inactivación no cerró la matrícula: %', fila;
    END IF;
    IF fila.legajo_nro <> 'LEG-SQL-1001' OR fila.dni <> '92100001' OR fila.id <> id_previo THEN
        RAISE EXCEPTION 'FALLO 27.2: la inactivación alteró la identidad: %', fila;
    END IF;

    SELECT count(*) INTO tramos FROM public.matriculas WHERE alumno_id = alumno;
    IF tramos <> 2 THEN
        RAISE EXCEPTION 'FALLO 27.3: la inactivación borró historial: quedan % tramos', tramos;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.matriculas
        WHERE alumno_id = alumno AND curso_id = curso_b AND motivo_cierre = 'INACTIVACION'
    ) THEN
        RAISE EXCEPTION 'FALLO 27.4: el cierre por inactivación no quedó registrado';
    END IF;
    RAISE NOTICE 'OK 27: la inactivación cierra la matrícula y conserva identidad, legajo e historial';

    -- 28. Reactivación sin curso: rechazada.
    BEGIN
        PERFORM public.reactivar_alumno(alumno, NULL);
        RAISE EXCEPTION 'FALLO 28: se reactivó un alumno sin elegir curso';
    EXCEPTION WHEN SQLSTATE 'P5511' THEN
        RAISE NOTICE 'OK 28: la reactivación sin curso se rechaza (P5511)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 29. Reactivación contra un curso inactivo: rechazada.
    BEGIN
        PERFORM public.reactivar_alumno(
            alumno, (SELECT id FROM public.cursos WHERE denominacion = 'Sala SQL')
        );
        RAISE EXCEPTION 'FALLO 29: se reactivó contra un curso inactivo';
    EXCEPTION WHEN SQLSTATE 'P5504' THEN
        RAISE NOTICE 'OK 29: la reactivación contra un curso inactivo se rechaza (P5504)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 30. Reactivación válida.
    PERFORM public.reactivar_alumno(alumno, curso_a);
    SELECT * INTO fila FROM public.alumnos_academicos WHERE id = alumno;
    IF fila.estado <> 'ACTIVO' OR fila.curso_id IS DISTINCT FROM curso_a THEN
        RAISE EXCEPTION 'FALLO 30.1: la reactivación no dejó una matrícula vigente: %', fila;
    END IF;
    SELECT count(*) INTO tramos FROM public.matriculas WHERE alumno_id = alumno;
    IF tramos <> 3 THEN
        RAISE EXCEPTION 'FALLO 30.2: la reactivación no agregó un tramo nuevo: hay %', tramos;
    END IF;
    RAISE NOTICE 'OK 30: la reactivación exige un curso activo y agrega un tramo al historial';

    -- 31. Historial completo y legible.
    SELECT count(*) INTO tramos FROM public.matriculas_historial WHERE alumno_id = alumno;
    IF tramos <> 3 THEN
        RAISE EXCEPTION 'FALLO 31.1: el historial expone % tramos y deberían ser 3', tramos;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.matriculas_historial
        WHERE alumno_id = alumno AND nivel_nombre IS NULL
    ) THEN
        RAISE EXCEPTION 'FALLO 31.2: un tramo del historial no resuelve su nivel';
    END IF;
    RAISE NOTICE 'OK 31: el historial expone los tres tramos con su nivel derivado';

    -- 32. Corrección de DNI conservando identificador interno y relaciones.
    PERFORM public.corregir_identidad_alumno(alumno, '92100099', 'LEG-SQL-1001');
    SELECT * INTO fila FROM public.alumnos_academicos WHERE id = id_previo;
    IF fila.dni <> '92100099' THEN
        RAISE EXCEPTION 'FALLO 32.1: el DNI no se corrigió';
    END IF;
    SELECT count(*) INTO tramos FROM public.matriculas WHERE alumno_id = id_previo;
    IF tramos <> 3 THEN
        RAISE EXCEPTION 'FALLO 32.2: la corrección de DNI perdió relaciones del historial';
    END IF;
    RAISE NOTICE 'OK 32: el DIRECTOR corrige el DNI conservando el identificador interno y sus relaciones';

    -- 33. Corrección con un DNI ya usado por otra persona.
    BEGIN
        PERFORM public.corregir_identidad_alumno(alumno, '9210002', 'LEG-SQL-1001');
        RAISE EXCEPTION 'FALLO 33: se corrigió hacia un DNI ya registrado';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 33: la corrección hacia un DNI ya registrado se rechaza (23505)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 34. Quitarle el legajo a un alumno activo rompe la coherencia.
    BEGIN
        PERFORM public.corregir_identidad_alumno(alumno, '92100099', NULL);
        RAISE EXCEPTION 'FALLO 34: se dejó sin legajo a un alumno activo';
    EXCEPTION WHEN SQLSTATE 'P5512' THEN
        RAISE NOTICE 'OK 34: no se puede dejar sin legajo a un alumno activo (P5512)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);
END $$;


-- ================================================================
-- 4bis. EL TRIGGER DIFERIDO ES LA GARANTÍA, NO LA VALIDACIÓN DE LA FUNCIÓN
-- ================================================================
-- Las comprobaciones anticipadas de las funciones existen para dar un mensaje
-- preciso. La garantía real es el trigger de restricción diferido, que se evalúa
-- al confirmar la transacción. Acá se lo fuerza con `SET CONSTRAINTS ALL
-- IMMEDIATE` y se escribe sin pasar por las funciones, para demostrar que la
-- incoherencia se rechaza igual aunque alguien evadiera la capa de aplicación.
RESET ROLE;

DO $$
DECLARE
    alumno UUID := (SELECT id FROM public.alumnos_academicos WHERE dni = '92100099');
BEGIN
    -- 34bis.1 Un alumno activo al que se le quita el legajo.
    BEGIN
        UPDATE public.perfiles SET legajo_nro = NULL WHERE id = alumno;
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'FALLO 34bis.1: el trigger diferido aceptó un activo sin legajo';
    EXCEPTION WHEN SQLSTATE 'P5512' THEN
        RAISE NOTICE 'OK 34bis.1: el trigger diferido rechaza un alumno activo sin legajo (P5512)';
    END;

    -- 34bis.2 Un alumno activo al que se le cierra la matrícula sin cambiar su
    -- estado.
    BEGIN
        UPDATE public.matriculas
        SET fecha_cierre = NOW(), motivo_cierre = 'INACTIVACION'
        WHERE alumno_id = alumno AND fecha_cierre IS NULL;
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'FALLO 34bis.2: el trigger diferido aceptó un activo sin matrícula';
    EXCEPTION WHEN SQLSTATE 'P5511' THEN
        RAISE NOTICE 'OK 34bis.2: el trigger diferido rechaza un alumno activo sin matrícula (P5511)';
    END;

    -- 34bis.3 Un alumno inactivo con una matrícula vigente.
    BEGIN
        INSERT INTO public.matriculas (alumno_id, curso_id)
        SELECT a.perfil_id, (SELECT id FROM public.cursos WHERE denominacion = 'Primero SQL')
        FROM public.alumnos a
        WHERE a.estado = 'INACTIVO'
          AND NOT EXISTS (
              SELECT 1 FROM public.matriculas m
              WHERE m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL
          )
        LIMIT 1;
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'FALLO 34bis.3: el trigger diferido aceptó un inactivo con matrícula';
    EXCEPTION WHEN SQLSTATE 'P5513' THEN
        RAISE NOTICE 'OK 34bis.3: el trigger diferido rechaza un alumno inactivo con matrícula (P5513)';
    END;

    -- 34bis.4 Dos matrículas vigentes para el mismo alumno.
    BEGIN
        INSERT INTO public.matriculas (alumno_id, curso_id)
        VALUES (alumno, (SELECT id FROM public.cursos WHERE denominacion = 'Segundo SQL'));
        RAISE EXCEPTION 'FALLO 34bis.4: se abrió una segunda matrícula vigente';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK 34bis.4: el índice único parcial impide una segunda matrícula vigente (23505)';
    END;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
                  '{"sub":"71111111-1111-4111-8111-111111111111"}', true);


-- ================================================================
-- 5. INACTIVACIÓN DE UN CURSO CON MATRÍCULAS VIGENTES
-- ================================================================
DO $$
DECLARE
    curso_a UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Primero SQL');
    curso_b UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Segundo SQL');
BEGIN
    -- 35. Con un alumno matriculado, el curso no se puede inactivar.
    BEGIN
        UPDATE public.cursos SET activo = FALSE WHERE id = curso_a;
        RAISE EXCEPTION 'FALLO 35: se inactivó un curso con matrículas vigentes';
    EXCEPTION WHEN SQLSTATE 'P5514' THEN
        RAISE NOTICE 'OK 35: un curso con matrículas vigentes no se puede inactivar (P5514)';
    END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 36. Sin matrículas vigentes, la baja lógica del curso sigue funcionando.
    UPDATE public.cursos SET activo = FALSE WHERE id = curso_b;
    IF (SELECT activo FROM public.cursos WHERE id = curso_b) THEN
        RAISE EXCEPTION 'FALLO 36: no se pudo inactivar un curso sin matrículas vigentes';
    END IF;
    RAISE NOTICE 'OK 36: un curso sin matrículas vigentes conserva su baja lógica';

    -- 37. El tramo histórico contra ese curso ya inactivo se conserva y se lee.
    IF NOT EXISTS (
        SELECT 1 FROM public.matriculas_historial
        WHERE curso_id = curso_b AND NOT curso_activo
    ) THEN
        RAISE EXCEPTION 'FALLO 37: el historial perdió el tramo de un curso inactivo';
    END IF;
    RAISE NOTICE 'OK 37: el historial conserva y muestra los tramos de cursos hoy inactivos';

    UPDATE public.cursos SET activo = TRUE WHERE id = curso_b;
END $$;


-- ================================================================
-- 6. LECTURA POR ACTOR
-- ================================================================
DO $$
DECLARE
    actor        RECORD;
    propio       UUID;
    ajeno        UUID;
    visibles     BIGINT;
    total        BIGINT;
BEGIN
    propio := (SELECT id FROM public.perfiles WHERE dni = '92000003');
    ajeno  := (SELECT id FROM public.perfiles WHERE dni = '92000004');

    -- El estudiante propio necesita una matrícula para probar el historial.
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);
    PERFORM public.reactivar_alumno(
        propio, (SELECT id FROM public.cursos WHERE denominacion = 'Primero SQL')
    );

    -- 38. El DIRECTOR ve todos los legajos.
    SELECT count(*) INTO visibles FROM public.alumnos_academicos;
    SELECT count(*) INTO total FROM public.alumnos;
    IF visibles <> total THEN
        RAISE EXCEPTION 'FALLO 38: el director ve % de % legajos', visibles, total;
    END IF;
    RAISE NOTICE 'OK 38: el DIRECTOR consulta los % legajos académicos', total;

    -- 39. El ESTUDIANTE ve exclusivamente el propio.
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"73333333-3333-4333-8333-333333333333"}', true);

    SELECT count(*) INTO visibles FROM public.alumnos_academicos;
    IF visibles <> 1 THEN
        RAISE EXCEPTION 'FALLO 39.1: el estudiante ve % legajos y debería ver 1', visibles;
    END IF;
    IF (SELECT id FROM public.alumnos_academicos) <> propio THEN
        RAISE EXCEPTION 'FALLO 39.2: el estudiante ve un legajo que no es el suyo';
    END IF;
    RAISE NOTICE 'OK 39: el ESTUDIANTE consulta exclusivamente su propio legajo';

    -- 40. Un legajo ajeno no devuelve error: devuelve cero filas, para no
    -- revelar que existe.
    SELECT count(*) INTO visibles
    FROM public.alumnos_academicos WHERE id = ajeno;
    IF visibles <> 0 THEN
        RAISE EXCEPTION 'FALLO 40.1: el estudiante alcanzó el legajo de otra persona';
    END IF;
    SELECT count(*) INTO visibles
    FROM public.matriculas_historial WHERE alumno_id = ajeno;
    IF visibles <> 0 THEN
        RAISE EXCEPTION 'FALLO 40.2: el estudiante alcanzó el historial de otra persona';
    END IF;
    RAISE NOTICE 'OK 40: un legajo ajeno devuelve cero filas y no delata su existencia';

    -- 41. El ESTUDIANTE sí ve su propio historial.
    SELECT count(*) INTO visibles
    FROM public.matriculas_historial WHERE alumno_id = propio;
    IF visibles < 1 THEN
        RAISE EXCEPTION 'FALLO 41: el estudiante no puede ver su propio historial';
    END IF;
    RAISE NOTICE 'OK 41: el ESTUDIANTE consulta su propio historial de cursos';

    -- 42. DOCENTE, PADRE, PERSONAL y usuario sin perfil no ven nada.
    FOR actor IN
        SELECT * FROM (VALUES
            ('DOCENTE',    '72222222-2222-4222-8222-222222222222'),
            ('PADRE',      '75555555-5555-4555-8555-555555555555'),
            ('PERSONAL',   '76666666-6666-4666-8666-666666666666'),
            ('SIN PERFIL', '79999999-9999-4999-8999-999999999999')
        ) AS t(rol, uid)
    LOOP
        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', actor.uid)::text, true);

        SELECT count(*) INTO visibles FROM public.alumnos_academicos;
        IF visibles <> 0 THEN
            RAISE EXCEPTION 'FALLO 42.1: % alcanzó % legajos académicos', actor.rol, visibles;
        END IF;

        SELECT count(*) INTO visibles FROM public.matriculas_historial;
        IF visibles <> 0 THEN
            RAISE EXCEPTION 'FALLO 42.2: % alcanzó % tramos de historial', actor.rol, visibles;
        END IF;

        SELECT count(*) INTO visibles FROM public.alumnos;
        IF visibles <> 0 THEN
            RAISE EXCEPTION 'FALLO 42.3: % alcanzó la tabla alumnos', actor.rol;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK 42: DOCENTE, PADRE, PERSONAL y un usuario sin perfil no acceden a datos académicos';
END $$;


-- ================================================================
-- 7. ESCRITURA DENEGADA PARA TODO ACTOR QUE NO SEA DIRECTOR
-- ================================================================
DO $$
DECLARE
    actor  RECORD;
    alumno UUID := (SELECT perfil_id FROM public.alumnos LIMIT 1);
    curso  UUID := (SELECT id FROM public.cursos WHERE denominacion = 'Primero SQL');
BEGIN
    FOR actor IN
        SELECT * FROM (VALUES
            ('ESTUDIANTE', '73333333-3333-4333-8333-333333333333'),
            ('DOCENTE',    '72222222-2222-4222-8222-222222222222'),
            ('PADRE',      '75555555-5555-4555-8555-555555555555'),
            ('PERSONAL',   '76666666-6666-4666-8666-666666666666'),
            ('SIN PERFIL', '79999999-9999-4999-8999-999999999999')
        ) AS t(rol, uid)
    LOOP
        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', actor.uid)::text, true);

        BEGIN
            PERFORM public.crear_alumno('Intruso', 'Denegado', '92900001', 'INACTIVO');
            RAISE EXCEPTION 'FALLO 43.1: % creó un legajo académico', actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', actor.uid)::text, true);
        BEGIN
            PERFORM public.cambiar_curso_alumno(alumno, curso);
            RAISE EXCEPTION 'FALLO 43.2: % cambió un curso', actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', actor.uid)::text, true);
        BEGIN
            PERFORM public.inactivar_alumno(alumno);
            RAISE EXCEPTION 'FALLO 43.3: % inactivó a un estudiante', actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', actor.uid)::text, true);
        BEGIN
            PERFORM public.reactivar_alumno(alumno, curso);
            RAISE EXCEPTION 'FALLO 43.4: % reactivó a un estudiante', actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', actor.uid)::text, true);
        BEGIN
            PERFORM public.corregir_identidad_alumno(alumno, '92900002', 'LEG-INTRUSO');
            RAISE EXCEPTION 'FALLO 43.5: % corrigió una identidad', actor.rol;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
    END LOOP;
    RAISE NOTICE 'OK 43: ningún actor distinto de DIRECTOR puede ejecutar operaciones académicas (42501)';
END $$;


-- ================================================================
-- 8. ESCRITURA DIRECTA Y BORRADO FÍSICO
-- ================================================================
DO $$
DECLARE
    alumno   UUID := (SELECT perfil_id FROM public.alumnos LIMIT 1);
    afectadas BIGINT;
BEGIN
    -- Incluso el DIRECTOR, que sí está autorizado por la aplicación, tiene la
    -- escritura directa cerrada: su único camino son las funciones.
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 44. INSERT directo denegado.
    BEGIN
        INSERT INTO public.alumnos (perfil_id, estado)
        VALUES ((SELECT id FROM public.perfiles WHERE dni = '92000005'), 'ACTIVO');
        RAISE EXCEPTION 'FALLO 44: se insertó directamente en alumnos';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 44: la escritura directa en alumnos está denegada (42501)';
    END;

    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 45. UPDATE directo denegado.
    BEGIN
        UPDATE public.alumnos SET estado = 'INACTIVO' WHERE perfil_id = alumno;
        RAISE EXCEPTION 'FALLO 45: se actualizó directamente alumnos';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK 45: la actualización directa de alumnos está denegada (42501)';
    END;

    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);

    -- 46. DELETE directo denegado sobre las tres tablas.
    BEGIN
        DELETE FROM public.matriculas WHERE alumno_id = alumno;
        RAISE EXCEPTION 'FALLO 46.1: se borraron matrículas';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);
    BEGIN
        DELETE FROM public.alumnos WHERE perfil_id = alumno;
        RAISE EXCEPTION 'FALLO 46.2: se borró un legajo académico';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);
    BEGIN
        DELETE FROM public.perfiles WHERE id = alumno;
        RAISE EXCEPTION 'FALLO 46.3: se borró un perfil';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK 46: no existe borrado físico de alumnos, matrículas ni perfiles (42501)';

    -- 47. TRUNCATE denegado. RLS no protege de TRUNCATE, solo el privilegio.
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"71111111-1111-4111-8111-111111111111"}', true);
    BEGIN
        TRUNCATE public.perfiles CASCADE;
        RAISE EXCEPTION 'FALLO 47.1: authenticated pudo truncar perfiles';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
        TRUNCATE public.perfiles CASCADE;
        RAISE EXCEPTION 'FALLO 47.2: anon pudo truncar perfiles';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
        TRUNCATE public.matriculas CASCADE;
        RAISE EXCEPTION 'FALLO 47.3: anon pudo truncar matriculas';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK 47: ni authenticated ni anon pueden truncar perfiles ni el historial académico';

    -- 48. Un anónimo no alcanza ningún dato académico.
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
        SELECT count(*) INTO afectadas FROM public.alumnos_academicos;
        RAISE EXCEPTION 'FALLO 48.1: un anónimo leyó la vista académica';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
        SELECT count(*) INTO afectadas FROM public.alumnos;
        RAISE EXCEPTION 'FALLO 48.2: un anónimo leyó la tabla alumnos';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
        PERFORM public.crear_alumno('Anonimo', 'Denegado', '92900003', 'INACTIVO');
        RAISE EXCEPTION 'FALLO 48.3: un anónimo ejecutó una operación académica';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'OK 48: un usuario anónimo no lee ni ejecuta nada del dominio académico';
END $$;

RESET ROLE;


-- ================================================================
-- 9. INCORPORACIÓN DE PERFILES ESTUDIANTE PREEXISTENTES
-- ================================================================
DO $$
DECLARE
    sin_legajo UUID;
    fila       public.alumnos;
BEGIN
    -- 49. Un perfil ESTUDIANTE nuevo nace con legajo académico INACTIVO y sin
    -- datos inventados.
    INSERT INTO public.perfiles (rol_id, nombre, apellido, dni)
    VALUES ((SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
            'Preexistente', 'Sin Datos', '92800001')
    RETURNING id INTO sin_legajo;

    SELECT * INTO fila FROM public.alumnos WHERE perfil_id = sin_legajo;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FALLO 49.1: un perfil ESTUDIANTE quedó sin legajo académico';
    END IF;
    IF fila.estado <> 'INACTIVO' THEN
        RAISE EXCEPTION 'FALLO 49.2: el legajo incorporado no quedó INACTIVO: %', fila.estado;
    END IF;
    IF EXISTS (SELECT 1 FROM public.matriculas WHERE alumno_id = sin_legajo) THEN
        RAISE EXCEPTION 'FALLO 49.3: se inventó una matrícula para un perfil sin datos';
    END IF;
    IF (SELECT legajo_nro FROM public.perfiles WHERE id = sin_legajo) IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 49.4: se inventó un número de legajo';
    END IF;
    RAISE NOTICE 'OK 49: un perfil ESTUDIANTE sin datos suficientes queda INACTIVO, sin curso ni legajo inventados';

    -- 50. Un perfil que no es ESTUDIANTE no recibe legajo académico.
    IF EXISTS (
        SELECT 1 FROM public.alumnos a
        JOIN public.perfiles p ON p.id = a.perfil_id
        JOIN public.roles r ON r.id = p.rol_id
        WHERE r.nombre <> 'ESTUDIANTE'
    ) THEN
        RAISE EXCEPTION 'FALLO 50: un perfil que no es ESTUDIANTE recibió legajo académico';
    END IF;
    RAISE NOTICE 'OK 50: solo los perfiles ESTUDIANTE tienen legajo académico';
END $$;

ROLLBACK;
