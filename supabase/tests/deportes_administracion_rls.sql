-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de la administración de deportes (EPT-61)
-- ============================================================
-- Verifica la migración 20260928155706_ept_61_administracion_deportes.sql.
--
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
--     docker cp supabase/tests/deportes_administracion_rls.sql \
--       supabase_db_educar-para-transformar:/tmp/
--     docker exec supabase_db_educar-para-transformar \
--       psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f /tmp/deportes_administracion_rls.sql
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. Una recursión de
-- políticas (42P17) cuenta como fallo aunque llegue como «denegación».
--
-- Cubre (decisiones 1 a 8 de EPT-61):
--   A. objetos, privilegios, RLS, política de bloqueo de cuenta y sin triggers nuevos;
--   B. alta de deportes (válidos, inválidos, duplicados normalizados, más de 6);
--   C. datos de la matriz: grupos e inscripciones sintéticos;
--   D. renombrar deportes (con y sin grupos; identidad protegida de 014);
--   E. inactivar y reactivar deportes (grupos activos e inactivos);
--   F. editar grupos (nombre, cupo, profesor; identidad inmutable);
--   G. inactivar y reactivar grupos (inscripciones activas, canceladas y
--      reactivación con deporte, nivel o profesor inválidos);
--   H. denegaciones por rol: DOCENTE, ESTUDIANTE, PADRE, PERSONAL, sin
--      perfil, DIRECTOR bloqueado, sesión sin identidad y anon;
--   I. inscripciones e historial intactos; sin DELETE ni escritura directa;
--   K. la administración de datos del propietario no cambia (contrato de EPT-57);
--   J. reversión no destructiva: soltar las funciones nuevas no toca datos.
--
-- Todos los datos son sintéticos: DNI en un rango libre elegido en tiempo de
-- ejecución, sin correspondencia con ninguna persona real.

\set ON_ERROR_STOP on
-- Solo interesan los avisos OK/FALLO: las consultas no imprimen filas.
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- 0. HERRAMIENTAS
-- ================================================================
CREATE FUNCTION pg_temp.u(p_sufijo TEXT)
RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('a6100000-0000-4000-8000-0000000000' || p_sufijo)::UUID;
$$;

-- Ejecuta como el actor y CONSERVA los efectos si no hay error. Devuelve
-- `OK:<valor>` o `E:<SQLSTATE>`. Con `p_sub` NULL la sesión no tiene `sub`.
CREATE FUNCTION pg_temp.ejecutar(p_rol TEXT, p_sub UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            CASE WHEN p_sub IS NULL THEN pg_catalog.json_build_object('role', p_rol)::TEXT
                 ELSE pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT END,
            true);
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql INTO v;
        RESET ROLE;
        PERFORM pg_catalog.set_config('request.jwt.claims', '{}', true);
        v := 'OK:' || COALESCE(v, '<NULL>');
    EXCEPTION WHEN OTHERS THEN
        v := 'E:' || SQLSTATE;
    END;
    RETURN v;
END;
$$;

-- Igual, pero devuelve además el DETAIL del error (para las comprobaciones
-- que lo exponen a la pantalla).
CREATE FUNCTION pg_temp.detalle_de(p_rol TEXT, p_sub UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT, true);
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql INTO v;
        RESET ROLE;
        RETURN 'OK:' || COALESCE(v, '<NULL>');
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v = PG_EXCEPTION_DETAIL;
        RETURN COALESCE(v, '');
    END;
END;
$$;

CREATE FUNCTION pg_temp.dir(p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u('01'), p_sql);
$$;

CREATE FUNCTION pg_temp.est(p_sufijo TEXT, p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u(p_sufijo), p_sql);
$$;

-- `p_esperado` es 'OK' o un SQLSTATE. Nunca acepta 42P17.
CREATE FUNCTION pg_temp.esperar(p_resultado TEXT, p_esperado TEXT, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado = 'E:42P17' THEN
        RAISE EXCEPTION 'FALLO % → recursión de políticas (42P17)', p_mensaje;
    END IF;
    IF (p_esperado = 'OK' AND p_resultado NOT LIKE 'OK:%')
       OR (p_esperado <> 'OK' AND p_resultado IS DISTINCT FROM 'E:' || p_esperado) THEN
        RAISE EXCEPTION 'FALLO % → se obtuvo %, se esperaba %', p_mensaje, p_resultado, p_esperado;
    END IF;
END;
$$;

CREATE FUNCTION pg_temp.exigir(p_condicion BOOLEAN, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_condicion IS NOT TRUE THEN
        RAISE EXCEPTION 'FALLO %', p_mensaje;
    END IF;
END;
$$;

CREATE FUNCTION pg_temp.ok(p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

-- Valor devuelto por una operación ejecutada con éxito (`OK:<valor>`).
CREATE FUNCTION pg_temp.valor(p_resultado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado NOT LIKE 'OK:%' THEN
        RAISE EXCEPTION 'FALLO se esperaba éxito y se obtuvo %', p_resultado;
    END IF;
    RETURN pg_catalog.substr(p_resultado, 4);
END;
$$;

CREATE TEMPORARY TABLE fx (clave TEXT PRIMARY KEY, valor TEXT NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.fx(p_clave TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT valor FROM fx WHERE clave = p_clave;
$$;

-- Huella del contenido completo de las tres tablas deportivas.
CREATE FUNCTION pg_temp.huella(p_tabla TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    EXECUTE pg_catalog.format(
        'SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(t::TEXT, %L ORDER BY t.id), %L)) FROM public.%I t',
        ';', '', p_tabla) INTO v;
    RETURN v;
END;
$$;


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
WITH base_libre AS (
    SELECT base
    FROM generate_series(93000000, 99999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 16) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(sufijo, rol, apellido, legajo, desplazamiento, estado_acceso) AS (
    VALUES
        ('01', 'DIRECTOR',   'Directora',        NULL,             1, 'HABILITADO'),
        ('02', 'DIRECTOR',   'Directora bloqueada', NULL,          2, 'BLOQUEADO'),
        ('03', 'DOCENTE',    'Docente A',        NULL,             3, 'HABILITADO'),
        ('04', 'DOCENTE',    'Docente B',        NULL,             4, 'HABILITADO'),
        ('05', 'DOCENTE',    'Docente C inactivo', NULL,           5, 'HABILITADO'),
        ('06', 'DOCENTE',    'Docente D',        NULL,             6, 'HABILITADO'),
        ('07', 'DOCENTE',    'Docente E',        NULL,             7, 'HABILITADO'),
        ('08', 'ESTUDIANTE', 'Alumna uno',       'LEG-EPT61-0008', 8, 'HABILITADO'),
        ('09', 'ESTUDIANTE', 'Alumno dos',       'LEG-EPT61-0009', 9, 'HABILITADO'),
        ('0a', 'PADRE',      'Padre',            NULL,            10, 'HABILITADO'),
        ('0b', 'PERSONAL',   'Personal',         NULL,            11, 'HABILITADO')
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro, estado_acceso)
SELECT pg_temp.u(i.sufijo), pg_temp.u(i.sufijo), r.id, 'Prueba', i.apellido,
       (b.base + i.desplazamiento)::TEXT, i.legajo, i.estado_acceso::public.estado_acceso
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- Cuenta autenticada sin perfil: `…0c` no tiene fila.

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u('c1'),
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'Curso deportes EPT-61', 'A', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES (pg_temp.u('08'), pg_temp.u('c1')),
       (pg_temp.u('09'), pg_temp.u('c1'));

UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (pg_temp.u('08'), pg_temp.u('09'));

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- El docente C queda INACTIVO (sin grupos a cargo, como exige EPT-58).
UPDATE public.profesores SET estado = 'INACTIVO' WHERE perfil_id = pg_temp.u('05');

-- Nivel adicional para la reactivación con nivel inactivo.
INSERT INTO public.niveles (nombre, activo, orden) VALUES ('NIVEL EPT61', TRUE, 961);


-- ================================================================
-- A. OBJETOS, PRIVILEGIOS, RLS Y BLOQUEO DE CUENTA
-- ================================================================
DO $$
DECLARE
    v_nombre TEXT;
    v_firma  regprocedure;
    v_rol    TEXT;
    v_tabla  TEXT;
    v_priv   TEXT;
BEGIN
    -- A1. Las cinco operaciones privadas y sus envoltorios existen con la firma prevista.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.crear_deporte(text)'::regprocedure,
        'app_private.renombrar_deporte(uuid,text)'::regprocedure,
        'app_private.cambiar_estado_deporte(uuid,boolean)'::regprocedure,
        'app_private.editar_grupo_deportivo(uuid,text,integer,uuid)'::regprocedure,
        'app_private.cambiar_estado_grupo_deportivo(uuid,boolean)'::regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE')
           OR has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO A1: % no es DEFINER con search_path vacío o sus privilegios no son los previstos', v_firma;
        END IF;
    END LOOP;
    FOREACH v_firma IN ARRAY ARRAY[
        'public.crear_deporte(text)'::regprocedure,
        'public.renombrar_deporte(uuid,text)'::regprocedure,
        'public.cambiar_estado_deporte(uuid,boolean)'::regprocedure,
        'public.editar_grupo_deportivo(uuid,text,integer,uuid)'::regprocedure,
        'public.cambiar_estado_grupo_deportivo(uuid,boolean)'::regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""']
           OR has_function_privilege('anon', v_firma, 'EXECUTE')
           OR has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO A1: el envoltorio % no es INVOKER mínimo', v_firma;
        END IF;
    END LOOP;
    PERFORM pg_temp.ok('A1: cinco operaciones DEFINER en app_private con search_path vacío y cinco envoltorios INVOKER; EXECUTE solo para authenticated');

    -- A2. Ninguna función nueva es SECURITY DEFINER en el esquema expuesto `public`.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('crear_deporte', 'renombrar_deporte', 'cambiar_estado_deporte',
                            'editar_grupo_deportivo', 'cambiar_estado_grupo_deportivo')
          AND p.prosecdef
    ) THEN
        RAISE EXCEPTION 'FALLO A2: un envoltorio público es SECURITY DEFINER';
    END IF;
    PERFORM pg_temp.ok('A2: ningún envoltorio de public es SECURITY DEFINER');

    -- A3. Las operaciones del catálogo no reciben profesor; la edición de grupos
    -- no recibe deporte ni nivel; ninguna recibe identidad, rol ni actor.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_deporte', 'renombrar_deporte', 'cambiar_estado_deporte')
          AND EXISTS (SELECT 1 FROM unnest(p.proargnames) AS a WHERE a ILIKE '%profesor%')
    ) OR EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private') AND p.proname = 'editar_grupo_deportivo'
          AND (p.proargnames <> ARRAY['p_grupo_id', 'p_nombre', 'p_cupo', 'p_profesor_id']::TEXT[])
    ) OR EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_deporte', 'renombrar_deporte', 'cambiar_estado_deporte',
                            'editar_grupo_deportivo', 'cambiar_estado_grupo_deportivo')
          AND EXISTS (SELECT 1 FROM unnest(p.proargnames) AS a
                      WHERE a ILIKE '%user%' OR a ILIKE '%rol%' OR a ILIKE '%actor%' OR a ILIKE '%perfil%')
    ) THEN
        RAISE EXCEPTION 'FALLO A3: una operación recibe parámetros que no le corresponden';
    END IF;
    PERFORM pg_temp.ok('A3: el catálogo no recibe profesor; la edición de grupos solo recibe grupo, nombre, cupo y profesor');

    -- A4. Sin privilegios de escritura sobre las tres tablas y sin DELETE de nadie.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.deportes', 'public.grupos_deportivos',
                                        'public.inscripciones_deportivas'] LOOP
            FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                          'REFERENCES', 'TRIGGER'] LOOP
                IF has_table_privilege(v_rol, v_tabla, v_priv) THEN
                    RAISE EXCEPTION 'FALLO A4: % conserva % sobre %', v_rol, v_priv, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    PERFORM pg_temp.ok('A4: ningún rol de aplicación tiene INSERT, UPDATE, DELETE ni TRUNCATE sobre deportes, grupos ni inscripciones');

    -- A5. Sin políticas permisivas de escritura y con la restrictiva de bloqueo de cuenta.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('deportes', 'grupos_deportivos', 'inscripciones_deportivas')
          AND cmd <> 'SELECT' AND permissive = 'PERMISSIVE'
    ) THEN
        RAISE EXCEPTION 'FALLO A5: existe una política permisiva de escritura deportiva';
    END IF;
    FOREACH v_tabla IN ARRAY ARRAY['deportes', 'grupos_deportivos', 'inscripciones_deportivas'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = v_tabla
              AND policyname = 'Bloqueo de acceso sin datos protegidos'
              AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'
        ) THEN
            RAISE EXCEPTION 'FALLO A5: falta el bloqueo de cuenta de EPT-59 en %', v_tabla;
        END IF;
    END LOOP;
    PERFORM pg_temp.ok('A5: sin políticas permisivas de escritura; política RESTRICTIVE de bloqueo de cuenta en las tres tablas');

    -- A6. La migración no agrega triggers: los conjuntos de deportes y grupos son los de 014, EPT-57 y EPT-58.
    IF (SELECT array_agg(t.tgname::TEXT ORDER BY t.tgname) FROM pg_trigger t
        WHERE t.tgrelid = 'public.grupos_deportivos'::regclass AND NOT t.tgisinternal)
       IS DISTINCT FROM ARRAY['a_exigir_profesor_activo', 'validar_grupo_deportivo_antes_de_escribir',
                              'validar_reactivacion_grupo_con_academia']::TEXT[]
       OR (SELECT array_agg(t.tgname::TEXT ORDER BY t.tgname) FROM pg_trigger t
           WHERE t.tgrelid = 'public.deportes'::regclass AND NOT t.tgisinternal)
          IS DISTINCT FROM ARRAY['proteger_identidad_deporte_antes_de_actualizar']::TEXT[] THEN
        RAISE EXCEPTION 'FALLO A6: cambió el conjunto de triggers de deportes o de grupos';
    END IF;
    PERFORM pg_temp.ok('A6: sin triggers nuevos: los de deportes y grupos son exactamente los de 014, EPT-57 y EPT-58');
END $$;


-- ================================================================
-- B. ALTA DE DEPORTES
-- ================================================================
DO $$
DECLARE
    v TEXT;
    v_antes BIGINT := (SELECT count(*) FROM public.deportes);
BEGIN
    -- B1. Alta válida; nace activo, con nombre y fechas.
    v := pg_temp.dir($q$SELECT (public.crear_deporte('Tenis')).id::TEXT$q$);
    PERFORM pg_temp.esperar(v, 'OK', 'B1 alta válida');
    INSERT INTO fx VALUES ('tenis', pg_temp.valor(v));
    IF NOT EXISTS (SELECT 1 FROM public.deportes
                   WHERE id = pg_temp.fx('tenis')::UUID AND nombre = 'Tenis' AND activo) THEN
        RAISE EXCEPTION 'FALLO B1: el deporte creado no es el esperado';
    END IF;
    PERFORM pg_temp.ok('B1: el DIRECTOR crea un deporte nuevo, activo, con el nombre pedido');

    -- B2. Nombres inválidos.
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte(''))::TEXT$q$), 'P5970', 'B2 vacío');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('   '))::TEXT$q$), 'P5970', 'B2 espacios');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte(' Tenis'))::TEXT$q$), 'P5970', 'B2 espacio inicial');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('Squash '))::TEXT$q$), 'P5970', 'B2 espacio final');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('Squash' || chr(10)))::TEXT$q$), 'P5970', 'B2 salto de línea');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte(NULL))::TEXT$q$), 'P5970', 'B2 NULL');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte(repeat('x', 101)))::TEXT$q$), 'P5970', 'B2 más de 100');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte(repeat('x', 100)))::TEXT$q$), 'OK', 'B2 justo 100');
    PERFORM pg_temp.ok('B2: vacío, solo espacios, espacios laterales, salto de línea, NULL y más de 100 caracteres → P5970; 100 exactos es válido');

    -- B3. Duplicados por nombre normalizado (mayúsculas), incluido un sembrado.
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('Tenis'))::TEXT$q$), 'P5971', 'B3 exacto');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('TENIS'))::TEXT$q$), 'P5971', 'B3 mayúsculas');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('tenis'))::TEXT$q$), 'P5971', 'B3 minúsculas');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('fútbol'))::TEXT$q$), 'P5971', 'B3 sembrado en minúsculas');
    PERFORM pg_temp.esperar(pg_temp.dir($q$SELECT (public.crear_deporte('FÚTBOL'))::TEXT$q$), 'P5971', 'B3 sembrado en mayúsculas');
    PERFORM pg_temp.ok('B3: un nombre repetido, sin importar mayúsculas, se rechaza con P5971 (también contra los seis sembrados)');

    -- B4. El catálogo se amplía más allá de los seis sembrados.
    v := pg_temp.dir($q$SELECT (public.crear_deporte('Hockey')).id::TEXT$q$);
    PERFORM pg_temp.esperar(v, 'OK', 'B4 segundo alta');
    INSERT INTO fx VALUES ('hockey', pg_temp.valor(v));
    IF (SELECT count(*) FROM public.deportes) <> v_antes + 3
       OR (SELECT count(*) FROM public.deportes WHERE activo) < 9 THEN
        RAISE EXCEPTION 'FALLO B4: el catálogo no creció como se esperaba (% → %)',
            v_antes, (SELECT count(*) FROM public.deportes);
    END IF;
    PERFORM pg_temp.ok('B4: el catálogo supera los seis deportes sembrados (Tenis, Hockey y uno de 100 caracteres)');

    -- B5. Un nombre rechazado no deja ninguna fila.
    IF (SELECT count(*) FROM public.deportes) <> v_antes + 3 THEN
        RAISE EXCEPTION 'FALLO B5: un alta rechazada dejó filas';
    END IF;
    PERFORM pg_temp.ok('B5: los rechazos no dejan filas parciales');
END $$;


-- ================================================================
-- C. GRUPOS E INSCRIPCIONES DE LA MATRIZ
-- ================================================================
DO $$
DECLARE
    v_primario INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO');
    v_nivel61  INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'NIVEL EPT61');
    v TEXT;
BEGIN
    -- Alta de grupos con la RPC de 014 (sin cambios): se reutiliza tal cual.
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 3, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000101', v_primario, 'Fútbol Primario A', pg_temp.u('03')));
    PERFORM pg_temp.esperar(v, 'OK', 'C1 G1'); INSERT INTO fx VALUES ('g1', pg_temp.valor(v));

    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 5, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000101', v_primario, 'Fútbol Primario B', pg_temp.u('03')));
    PERFORM pg_temp.esperar(v, 'OK', 'C1 G2'); INSERT INTO fx VALUES ('g2', pg_temp.valor(v));

    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 5, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000102', v_primario, 'Natación Primario', pg_temp.u('04')));
    PERFORM pg_temp.esperar(v, 'OK', 'C1 G3'); INSERT INTO fx VALUES ('g3', pg_temp.valor(v));

    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 5, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000105', v_primario, 'Vóley Primario', pg_temp.u('03')));
    PERFORM pg_temp.esperar(v, 'OK', 'C1 G4'); INSERT INTO fx VALUES ('g4', pg_temp.valor(v));

    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 5, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000103', v_nivel61, 'Atletismo Nivel EPT61', pg_temp.u('04')));
    PERFORM pg_temp.esperar(v, 'OK', 'C1 G5'); INSERT INTO fx VALUES ('g5', pg_temp.valor(v));

    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 5, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000104', v_primario, 'Marciales Primario', pg_temp.u('06')));
    PERFORM pg_temp.esperar(v, 'OK', 'C1 G6'); INSERT INTO fx VALUES ('g6', pg_temp.valor(v));

    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 5, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000106', v_primario, 'Básquet Primario', pg_temp.u('07')));
    PERFORM pg_temp.esperar(v, 'OK', 'C1 G7'); INSERT INTO fx VALUES ('g7', pg_temp.valor(v));

    -- Horarios (EPT-12): sin franja activa un grupo no admite inscripciones (P5583).
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.agregar_horario_grupo_deportivo(%L, 1::smallint, %L, %L)).id::TEXT',
        pg_temp.fx('g1'), '08:00', '09:00')), 'OK', 'C2 franja G1');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.agregar_horario_grupo_deportivo(%L, 2::smallint, %L, %L)).id::TEXT',
        pg_temp.fx('g3'), '08:00', '09:00')), 'OK', 'C2 franja G3');

    -- Inscripciones de la matriz: dos alumnos activos en G1; una alumna pasa por G3 y cancela.
    v := pg_temp.est('08', pg_catalog.format('SELECT (public.inscribir_en_grupo_deportivo(%L)).id::TEXT', pg_temp.fx('g1')));
    PERFORM pg_temp.esperar(v, 'OK', 'C3 alta S1 G1'); INSERT INTO fx VALUES ('i1', pg_temp.valor(v));
    v := pg_temp.est('09', pg_catalog.format('SELECT (public.inscribir_en_grupo_deportivo(%L)).id::TEXT', pg_temp.fx('g1')));
    PERFORM pg_temp.esperar(v, 'OK', 'C3 alta S2 G1'); INSERT INTO fx VALUES ('i2', pg_temp.valor(v));
    v := pg_temp.est('08', pg_catalog.format('SELECT (public.inscribir_en_grupo_deportivo(%L)).id::TEXT', pg_temp.fx('g3')));
    PERFORM pg_temp.esperar(v, 'OK', 'C3 alta S1 G3'); INSERT INTO fx VALUES ('i3', pg_temp.valor(v));
    v := pg_temp.est('08', pg_catalog.format('SELECT (public.cancelar_inscripcion_deportiva(%L)).id::TEXT', pg_temp.fx('i3')));
    PERFORM pg_temp.esperar(v, 'OK', 'C3 baja S1 G3');

    IF (SELECT count(*) FROM public.inscripciones_deportivas WHERE estado = 'ACTIVA') <> 2
       OR (SELECT count(*) FROM public.inscripciones_deportivas WHERE estado = 'CANCELADA') <> 1 THEN
        RAISE EXCEPTION 'FALLO C3: la matriz de inscripciones no quedó como se esperaba';
    END IF;

    -- Huella de las inscripciones antes de cualquier operación administrativa.
    INSERT INTO fx VALUES ('huella_inscripciones', pg_temp.huella('inscripciones_deportivas'));
    INSERT INTO fx VALUES ('huella_i1', (SELECT t::TEXT FROM public.inscripciones_deportivas t WHERE id = pg_temp.fx('i1')::UUID));
    INSERT INTO fx VALUES ('huella_i3', (SELECT t::TEXT FROM public.inscripciones_deportivas t WHERE id = pg_temp.fx('i3')::UUID));
    PERFORM pg_temp.ok('C: siete grupos, dos inscripciones activas en Fútbol A y una cancelada en Natación creados con las RPC vigentes');
END $$;


-- ================================================================
-- D. RENOMBRAR DEPORTES
-- ================================================================
DO $$
DECLARE
    v TEXT;
    v_futbol CONSTANT UUID := 'e0000000-0000-4000-8000-000000000101';
    v_ctid TEXT;
BEGIN
    -- D1. Sin grupos: cualquier nombre válido.
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', pg_temp.fx('tenis'), 'Tenis de mesa'));
    IF v <> 'OK:Tenis de mesa' OR (SELECT nombre FROM public.deportes WHERE id = pg_temp.fx('tenis')::UUID) <> 'Tenis de mesa' THEN
        RAISE EXCEPTION 'FALLO D1: el renombrado no se aplicó';
    END IF;
    PERFORM pg_temp.ok('D1: un deporte sin grupos se renombra libremente');

    -- D2. Colisión con otro deporte, nombre inválido, inexistente.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', pg_temp.fx('tenis'), 'vóley')), 'P5971', 'D2 duplicado');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', pg_temp.fx('tenis'), ' Tenis')), 'P5970', 'D2 inválido');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, NULL)).nombre', pg_temp.fx('tenis'))), 'P5970', 'D2 NULL');
    PERFORM pg_temp.esperar(pg_temp.dir(
        'SELECT (public.renombrar_deporte(gen_random_uuid(), ''Algo'')).nombre'), 'P5560', 'D2 inexistente');
    PERFORM pg_temp.esperar(pg_temp.dir(
        'SELECT (public.renombrar_deporte(NULL, ''Algo'')).nombre'), 'P5560', 'D2 id NULL');
    PERFORM pg_temp.ok('D2: nombre duplicado P5971, nombre inválido o NULL P5970, deporte inexistente o NULL P5560');

    -- D3. Con grupos: solo el cambio de mayúsculas conserva la identidad normalizada (014).
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', v_futbol, 'Fútbol 5')), 'P5580', 'D3 nombre distinto');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', v_futbol, 'Futbol')), 'P5580', 'D3 sin tilde');
    IF (SELECT nombre FROM public.deportes WHERE id = v_futbol) <> 'Fútbol' THEN
        RAISE EXCEPTION 'FALLO D3: un renombrado rechazado cambió el nombre';
    END IF;
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', v_futbol, 'FÚTBOL'));
    IF v <> 'OK:FÚTBOL' THEN
        RAISE EXCEPTION 'FALLO D3: el cambio solo de mayúsculas debería permitirse (%)', v;
    END IF;
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', v_futbol, 'Fútbol'));
    IF v <> 'OK:Fútbol' THEN
        RAISE EXCEPTION 'FALLO D3: no se pudo volver al nombre original (%)', v;
    END IF;
    PERFORM pg_temp.ok('D3: un deporte con grupos rechaza cualquier cambio de nombre normalizado (P5580) y admite solo el cambio de mayúsculas');

    -- D4. Idempotencia: el mismo nombre no toca la fila.
    v_ctid := (SELECT ctid::TEXT FROM public.deportes WHERE id = v_futbol);
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.renombrar_deporte(%L, %L)).nombre', v_futbol, 'Fútbol'));
    IF v <> 'OK:Fútbol' OR v_ctid <> (SELECT ctid::TEXT FROM public.deportes WHERE id = v_futbol) THEN
        RAISE EXCEPTION 'FALLO D4: repetir el mismo nombre debería ser un no-op (%)', v;
    END IF;
    PERFORM pg_temp.ok('D4: renombrar al mismo nombre es idempotente y no reescribe la fila');
END $$;


-- ================================================================
-- E. INACTIVAR Y REACTIVAR DEPORTES
-- ================================================================
DO $$
DECLARE
    v TEXT;
    v_futbol CONSTANT UUID := 'e0000000-0000-4000-8000-000000000101';
    v_voley  CONSTANT UUID := 'e0000000-0000-4000-8000-000000000105';
    v_ctid TEXT;
    v_detalle TEXT;
BEGIN
    -- E1. Sin grupos: se inactiva; la repetición es idempotente.
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_deporte(%L, false)).activo::TEXT', pg_temp.fx('hockey')));
    IF v <> 'OK:false' OR (SELECT activo FROM public.deportes WHERE id = pg_temp.fx('hockey')::UUID) THEN
        RAISE EXCEPTION 'FALLO E1: no se inactivó el deporte sin grupos (%)', v;
    END IF;
    v_ctid := (SELECT ctid::TEXT FROM public.deportes WHERE id = pg_temp.fx('hockey')::UUID);
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_deporte(%L, false)).activo::TEXT', pg_temp.fx('hockey')));
    IF v <> 'OK:false' OR v_ctid <> (SELECT ctid::TEXT FROM public.deportes WHERE id = pg_temp.fx('hockey')::UUID) THEN
        RAISE EXCEPTION 'FALLO E1: repetir la inactivación debería ser un no-op (%)', v;
    END IF;
    PERFORM pg_temp.ok('E1: un deporte sin grupos se inactiva; repetir el estado devuelve la fila sin tocarla');

    -- E2. Reactivar; y un deporte inactivo no admite grupos nuevos (014).
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_deporte(%L, true)).activo::TEXT', pg_temp.fx('hockey')));
    IF v <> 'OK:true' THEN
        RAISE EXCEPTION 'FALLO E2: no se reactivó el deporte (%)', v;
    END IF;
    PERFORM pg_temp.ok('E2: un deporte inactivo se reactiva');

    -- E3. Con grupos ACTIVOS no se inactiva; el rechazo no cambia nada y describe los grupos.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_deporte(%L, false)).activo::TEXT', v_futbol)), 'P5974', 'E3 con grupos activos');
    IF NOT (SELECT activo FROM public.deportes WHERE id = v_futbol) THEN
        RAISE EXCEPTION 'FALLO E3: un rechazo inactivó el deporte';
    END IF;
    v_detalle := pg_temp.detalle_de('authenticated', pg_temp.u('01'), pg_catalog.format(
        'SELECT (public.cambiar_estado_deporte(%L, false)).activo::TEXT', v_futbol));
    IF v_detalle NOT LIKE '%Fútbol Primario A%' OR v_detalle NOT LIKE '%Fútbol Primario B%' THEN
        RAISE EXCEPTION 'FALLO E3: el DETAIL no lista los grupos activos (%)', v_detalle;
    END IF;
    PERFORM pg_temp.ok('E3: un deporte con grupos activos no se inactiva (P5974) y el detalle nombra los grupos');

    -- E4. Estado inválido e inexistente.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_deporte(%L, NULL)).activo::TEXT', v_futbol)), 'P5972', 'E4 NULL');
    PERFORM pg_temp.esperar(pg_temp.dir(
        'SELECT (public.cambiar_estado_deporte(gen_random_uuid(), false)).activo::TEXT'), 'P5560', 'E4 inexistente');
    PERFORM pg_temp.esperar(pg_temp.dir(
        'SELECT (public.cambiar_estado_deporte(NULL, false)).activo::TEXT'), 'P5560', 'E4 id NULL');
    PERFORM pg_temp.ok('E4: estado NULL P5972; deporte inexistente o NULL P5560');

    -- E5. Con grupos solo INACTIVOS sí se inactiva; los grupos y su historial se conservan;
    -- al reactivar el deporte los grupos siguen inactivos.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', pg_temp.fx('g4'))), 'OK', 'E5 inactivar grupo');
    v := pg_temp.dir(pg_catalog.format('SELECT (public.cambiar_estado_deporte(%L, false)).activo::TEXT', v_voley));
    IF v <> 'OK:false' OR (SELECT activo FROM public.deportes WHERE id = v_voley) THEN
        RAISE EXCEPTION 'FALLO E5: un deporte con solo grupos inactivos debería inactivarse (%)', v;
    END IF;
    IF (SELECT activo FROM public.grupos_deportivos WHERE id = pg_temp.fx('g4')::UUID) THEN
        RAISE EXCEPTION 'FALLO E5: inactivar el deporte reactivó un grupo';
    END IF;
    PERFORM pg_temp.ok('E5: un deporte con grupos solo inactivos se inactiva y sus grupos se conservan inactivos');

    -- E6. Un deporte inactivo no admite grupos nuevos (P5561) ni reactivar un grupo suyo.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 5, %L)).id::TEXT', v_voley,
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Vóley nuevo', pg_temp.u('03'))), 'P5561', 'E6 alta en deporte inactivo');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', pg_temp.fx('g4'))), 'P5561', 'E6 reactivar con deporte inactivo');
    IF (SELECT activo FROM public.grupos_deportivos WHERE id = pg_temp.fx('g4')::UUID) THEN
        RAISE EXCEPTION 'FALLO E6: un rechazo reactivó el grupo';
    END IF;
    PERFORM pg_temp.ok('E6: con el deporte inactivo no se crean grupos ni se reactiva uno existente (P5561)');

    -- E7. Reactivar el deporte y luego el grupo.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_deporte(%L, true)).activo::TEXT', v_voley)), 'OK', 'E7 reactivar deporte');
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', pg_temp.fx('g4')));
    IF v <> 'OK:true' THEN
        RAISE EXCEPTION 'FALLO E7: con todo válido el grupo debería reactivarse (%)', v;
    END IF;
    PERFORM pg_temp.ok('E7: reactivado el deporte, su grupo se reactiva');
END $$;


-- ================================================================
-- F. EDITAR GRUPOS
-- ================================================================
DO $$
DECLARE
    v TEXT;
    v_antes public.grupos_deportivos;
    v_despues public.grupos_deportivos;
    v_ctid TEXT;
    g1 UUID := pg_temp.fx('g1')::UUID;
    g2 UUID := pg_temp.fx('g2')::UUID;
BEGIN
    SELECT * INTO v_antes FROM public.grupos_deportivos WHERE id = g1;

    -- F1. Cambiar solo el nombre: identidad, cupo, profesor y estado no cambian.
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, %s, %L)).nombre', g1, 'Fútbol Primario A (turno mañana)', 3, pg_temp.u('03')));
    IF v <> 'OK:Fútbol Primario A (turno mañana)' THEN
        RAISE EXCEPTION 'FALLO F1: no se cambió el nombre (%)', v;
    END IF;
    SELECT * INTO v_despues FROM public.grupos_deportivos WHERE id = g1;
    IF v_despues.deporte_id <> v_antes.deporte_id OR v_despues.nivel_id <> v_antes.nivel_id
       OR v_despues.cupo <> v_antes.cupo OR v_despues.profesor_id <> v_antes.profesor_id
       OR v_despues.activo <> v_antes.activo OR v_despues.fecha_creacion <> v_antes.fecha_creacion THEN
        RAISE EXCEPTION 'FALLO F1: la edición del nombre alteró otros datos del grupo';
    END IF;
    PERFORM pg_temp.ok('F1: el DIRECTOR edita el nombre; deporte, nivel, cupo, profesor, estado y fecha de alta no cambian');

    -- F2. Idempotencia: los mismos tres datos no reescriben la fila.
    v_ctid := (SELECT ctid::TEXT FROM public.grupos_deportivos WHERE id = g1);
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, %s, %L)).id::TEXT', g1, 'Fútbol Primario A (turno mañana)', 3, pg_temp.u('03')));
    IF v <> 'OK:' || g1 OR v_ctid <> (SELECT ctid::TEXT FROM public.grupos_deportivos WHERE id = g1) THEN
        RAISE EXCEPTION 'FALLO F2: repetir la edición debería ser un no-op (%)', v;
    END IF;
    PERFORM pg_temp.ok('F2: editar con los mismos datos devuelve el grupo sin tocar la fila');

    -- F3. Cupo: igual a la ocupación sí (2 de 3 → 2); por debajo no (P5581); rangos.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).cupo::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('03'))), 'OK', 'F3 cupo = ocupación');
    IF (SELECT cupo FROM public.grupos_deportivos WHERE id = g1) <> 2 THEN
        RAISE EXCEPTION 'FALLO F3: el cupo igual a la ocupación no se aplicó';
    END IF;
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 1, %L)).cupo::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('03'))), 'P5581', 'F3 cupo < ocupación');
    IF (SELECT cupo FROM public.grupos_deportivos WHERE id = g1) <> 2 THEN
        RAISE EXCEPTION 'FALLO F3: un rechazo por P5581 cambió el cupo';
    END IF;
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 0, %L)).cupo::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('03'))), 'P5566', 'F3 cupo 0');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 101, %L)).cupo::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('03'))), 'P5566', 'F3 cupo 101');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, NULL, %L)).cupo::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('03'))), 'P5566', 'F3 cupo NULL');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 100, %L)).cupo::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('03'))), 'OK', 'F3 cupo 100');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).cupo::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('03'))), 'OK', 'F3 volver a 2');
    PERFORM pg_temp.ok('F3: cupo igual a la ocupación permitido; por debajo P5581 (regla de 014 conservada); 0, 101 y NULL P5566; 100 permitido');

    -- F4. Nombre inválido y duplicado (normalizado) dentro del mismo deporte y nivel.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, '', pg_temp.u('03'))), 'P5567', 'F4 vacío');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, '   ', pg_temp.u('03'))), 'P5567', 'F4 espacios');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, NULL, 2, %L)).id::TEXT', g1, pg_temp.u('03'))), 'P5567', 'F4 NULL');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, repeat('x', 101), pg_temp.u('03'))), 'P5567', 'F4 101');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, 'FÚTBOL PRIMARIO B', pg_temp.u('03'))), 'P5973', 'F4 duplicado normalizado');
    -- El mismo nombre en otro deporte no es duplicado.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 5, %L)).id::TEXT', g2, 'Natación Primario', pg_temp.u('03'))), 'OK', 'F4 mismo nombre que un grupo de otro deporte');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 5, %L)).id::TEXT', g2, 'Fútbol Primario B', pg_temp.u('03'))), 'OK', 'F4 volver');
    PERFORM pg_temp.ok('F4: nombre vacío, solo espacios, NULL o de 101 caracteres P5567; duplicado por deporte+nivel+nombre normalizado P5973; el mismo nombre en otro deporte es válido');

    -- F5. Profesor: otro DOCENTE activo sí; INACTIVO P5605; sin rol DOCENTE P5565; inexistente P5564.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).profesor_id::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('04'))), 'OK', 'F5 otro docente activo');
    IF (SELECT profesor_id FROM public.grupos_deportivos WHERE id = g1) <> pg_temp.u('04') THEN
        RAISE EXCEPTION 'FALLO F5: el profesor no cambió';
    END IF;
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('05'))), 'P5605', 'F5 docente inactivo');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('08'))), 'P5565', 'F5 estudiante');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('0a'))), 'P5565', 'F5 padre');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, %L)).id::TEXT', g1, 'Fútbol Primario A (turno mañana)', pg_temp.u('0b'))), 'P5565', 'F5 personal');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, gen_random_uuid())).id::TEXT', g1, 'Fútbol Primario A (turno mañana)')), 'P5564', 'F5 inexistente');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 2, NULL)).id::TEXT', g1, 'Fútbol Primario A (turno mañana)')), 'P5564', 'F5 NULL');
    IF (SELECT profesor_id FROM public.grupos_deportivos WHERE id = g1) <> pg_temp.u('04') THEN
        RAISE EXCEPTION 'FALLO F5: un rechazo cambió el profesor';
    END IF;
    PERFORM pg_temp.ok('F5: cambio a docente activo permitido; docente inactivo P5605; estudiante, padre o personal P5565; inexistente o NULL P5564; el grupo nunca queda sin profesor');

    -- F6. Grupo inexistente o NULL.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(gen_random_uuid(), %L, 2, %L)).id::TEXT', 'X', pg_temp.u('03'))), 'P5568', 'F6 inexistente');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(NULL, %L, 2, %L)).id::TEXT', 'X', pg_temp.u('03'))), 'P5568', 'F6 NULL');
    PERFORM pg_temp.ok('F6: grupo inexistente o NULL P5568');

    -- F7. Deporte y nivel inmutables tras todas las ediciones; las inscripciones siguen ahí.
    SELECT * INTO v_despues FROM public.grupos_deportivos WHERE id = g1;
    IF v_despues.deporte_id <> 'e0000000-0000-4000-8000-000000000101'
       OR v_despues.nivel_id <> (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO')
       OR v_despues.fecha_creacion <> v_antes.fecha_creacion THEN
        RAISE EXCEPTION 'FALLO F7: cambió el deporte, el nivel o la fecha de alta del grupo';
    END IF;
    PERFORM pg_temp.ok('F7: tras todas las ediciones, deporte, nivel y fecha de alta del grupo siguen intactos');
END $$;


-- ================================================================
-- G. INACTIVAR Y REACTIVAR GRUPOS
-- ================================================================
DO $$
DECLARE
    v TEXT;
    v_ctid TEXT;
    v_detalle TEXT;
    g1 UUID := pg_temp.fx('g1')::UUID;
    g2 UUID := pg_temp.fx('g2')::UUID;
    g3 UUID := pg_temp.fx('g3')::UUID;
    g5 UUID := pg_temp.fx('g5')::UUID;
    g6 UUID := pg_temp.fx('g6')::UUID;
    g7 UUID := pg_temp.fx('g7')::UUID;
BEGIN
    -- G1. Con inscripciones activas no se inactiva; el mensaje cuenta cuántas.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g1)), 'P5975', 'G1 con inscripciones activas');
    IF NOT (SELECT activo FROM public.grupos_deportivos WHERE id = g1) THEN
        RAISE EXCEPTION 'FALLO G1: un rechazo inactivó el grupo';
    END IF;
    IF (SELECT count(*) FROM public.inscripciones_deportivas WHERE grupo_id = g1 AND estado = 'ACTIVA') <> 2 THEN
        RAISE EXCEPTION 'FALLO G1: cambiaron las inscripciones activas';
    END IF;
    PERFORM pg_temp.ok('G1: un grupo con dos inscripciones activas no se inactiva (P5975) y sus inscripciones no cambian');

    -- G2. Sin inscripciones: se inactiva; repetir es idempotente; se puede editar inactivo.
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g2));
    IF v <> 'OK:false' OR (SELECT activo FROM public.grupos_deportivos WHERE id = g2) THEN
        RAISE EXCEPTION 'FALLO G2: no se inactivó el grupo sin inscripciones (%)', v;
    END IF;
    v_ctid := (SELECT ctid::TEXT FROM public.grupos_deportivos WHERE id = g2);
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g2));
    IF v <> 'OK:false' OR v_ctid <> (SELECT ctid::TEXT FROM public.grupos_deportivos WHERE id = g2) THEN
        RAISE EXCEPTION 'FALLO G2: repetir la inactivación debería ser un no-op (%)', v;
    END IF;
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 4, %L)).cupo::TEXT', g2, 'Fútbol Primario B', pg_temp.u('03'))), 'OK', 'G2 editar inactivo');
    PERFORM pg_temp.ok('G2: un grupo sin inscripciones activas se inactiva; repetir el estado es idempotente; un grupo inactivo se puede editar');

    -- G3. Un grupo inactivo no admite inscripciones (014) — la plaza no se puede ocupar.
    PERFORM pg_temp.esperar(pg_temp.est('09', pg_catalog.format(
        'SELECT (public.inscribir_en_grupo_deportivo(%L)).id::TEXT', g2)), 'P5569', 'G3 alta en grupo inactivo');
    PERFORM pg_temp.ok('G3: un alumno no puede inscribirse en un grupo inactivo (P5569)');

    -- G4. Con inscripciones solo CANCELADAS sí se inactiva; el historial queda.
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g3));
    IF v <> 'OK:false' THEN
        RAISE EXCEPTION 'FALLO G4: un grupo con solo inscripciones canceladas debería inactivarse (%)', v;
    END IF;
    IF (SELECT t::TEXT FROM public.inscripciones_deportivas t WHERE id = pg_temp.fx('i3')::UUID) <> pg_temp.fx('huella_i3') THEN
        RAISE EXCEPTION 'FALLO G4: cambió la inscripción cancelada';
    END IF;
    PERFORM pg_temp.ok('G4: un grupo con solo inscripciones canceladas se inactiva y el historial queda idéntico');

    -- G5. Estado NULL e inexistente.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, NULL)).activo::TEXT', g1)), 'P5972', 'G5 NULL');
    PERFORM pg_temp.esperar(pg_temp.dir(
        'SELECT (public.cambiar_estado_grupo_deportivo(gen_random_uuid(), false)).activo::TEXT'), 'P5568', 'G5 inexistente');
    PERFORM pg_temp.esperar(pg_temp.dir(
        'SELECT (public.cambiar_estado_grupo_deportivo(NULL, false)).activo::TEXT'), 'P5568', 'G5 id NULL');
    PERFORM pg_temp.ok('G5: estado NULL P5972; grupo inexistente o NULL P5568');

    -- G6. Reactivar el grupo de la baja anterior (todo válido; con franja activa).
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g3));
    IF v <> 'OK:true' OR NOT (SELECT activo FROM public.grupos_deportivos WHERE id = g3) THEN
        RAISE EXCEPTION 'FALLO G6: con deporte, nivel y profesor válidos el grupo debería reactivarse (%)', v;
    END IF;
    v_ctid := (SELECT ctid::TEXT FROM public.grupos_deportivos WHERE id = g3);
    v := pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g3));
    IF v <> 'OK:true' OR v_ctid <> (SELECT ctid::TEXT FROM public.grupos_deportivos WHERE id = g3) THEN
        RAISE EXCEPTION 'FALLO G6: repetir la reactivación debería ser un no-op (%)', v;
    END IF;
    PERFORM pg_temp.ok('G6: un grupo con deporte, nivel y profesor válidos se reactiva; repetir el estado es idempotente');

    -- G7. Nivel inactivo (P5563).
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g5)), 'OK', 'G7 inactivar G5');
    UPDATE public.niveles SET activo = FALSE WHERE nombre = 'NIVEL EPT61';
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g5)), 'P5563', 'G7 nivel inactivo');
    IF (SELECT activo FROM public.grupos_deportivos WHERE id = g5) THEN
        RAISE EXCEPTION 'FALLO G7: un rechazo reactivó el grupo';
    END IF;
    UPDATE public.niveles SET activo = TRUE WHERE nombre = 'NIVEL EPT61';
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g5)), 'OK', 'G7 nivel reactivado');
    PERFORM pg_temp.ok('G7: no se reactiva un grupo cuyo nivel está inactivo (P5563); con el nivel activo sí');

    -- G8. Profesor INACTIVO (P5605): se corrige cambiando el profesor del grupo inactivo.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g7)), 'OK', 'G8 inactivar G7');
    UPDATE public.profesores SET estado = 'INACTIVO' WHERE perfil_id = pg_temp.u('07');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g7)), 'P5605', 'G8 profesor inactivo');
    IF (SELECT activo FROM public.grupos_deportivos WHERE id = g7) THEN
        RAISE EXCEPTION 'FALLO G8: un rechazo reactivó el grupo';
    END IF;
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 5, %L)).profesor_id::TEXT', g7, 'Básquet Primario', pg_temp.u('04'))), 'OK', 'G8 reasignar grupo inactivo');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g7)), 'OK', 'G8 reactivar con profesor nuevo');
    PERFORM pg_temp.ok('G8: no se reactiva con el profesor inactivo (P5605); reasignando el grupo inactivo a un docente activo sí se reactiva');

    -- G9. Profesor que dejó de ser DOCENTE (hueco de 014/EPT-58 cubierto por la RPC): P5565.
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g6)), 'OK', 'G9 inactivar G6');
    UPDATE public.perfiles
    SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
    WHERE id = pg_temp.u('06');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g6)), 'P5565', 'G9 profesor sin rol DOCENTE');
    IF (SELECT activo FROM public.grupos_deportivos WHERE id = g6) THEN
        RAISE EXCEPTION 'FALLO G9: un rechazo reactivó el grupo';
    END IF;
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.editar_grupo_deportivo(%L, %L, 5, %L)).profesor_id::TEXT', g6, 'Marciales Primario', pg_temp.u('03'))), 'OK', 'G9 reasignar');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, true)).activo::TEXT', g6)), 'OK', 'G9 reactivar');
    PERFORM pg_temp.ok('G9: un profesor que ya no es DOCENTE no permite reactivar (P5565); reasignando el grupo, sí');

    -- G10. Ningún cambio de estado tocó nada más: el resto de los grupos y las inscripciones.
    IF pg_temp.huella('inscripciones_deportivas') <> pg_temp.fx('huella_inscripciones') THEN
        RAISE EXCEPTION 'FALLO G10: cambiaron las inscripciones deportivas';
    END IF;
    PERFORM pg_temp.ok('G10: tras inactivar y reactivar grupos, las inscripciones deportivas son idénticas a las de la matriz');
END $$;


-- ================================================================
-- H. DENEGACIONES POR ROL
-- ================================================================
DO $$
DECLARE
    v_actor RECORD;
    v_op    RECORD;
    v_res   TEXT;
    v_h_dep TEXT;
    v_h_gru TEXT;
BEGIN
    v_h_dep := pg_temp.huella('deportes');
    v_h_gru := pg_temp.huella('grupos_deportivos');

    FOR v_actor IN
        SELECT * FROM (VALUES
            ('DOCENTE',            'authenticated', pg_temp.u('03')),
            ('ESTUDIANTE',         'authenticated', pg_temp.u('08')),
            ('PADRE',              'authenticated', pg_temp.u('0a')),
            ('PERSONAL',           'authenticated', pg_temp.u('0b')),
            ('SIN PERFIL',         'authenticated', pg_temp.u('0c')),
            ('DIRECTOR BLOQUEADO', 'authenticated', pg_temp.u('02')),
            ('ANON',               'anon',          NULL::UUID)
        ) AS a(etiqueta, rol, sub)
    LOOP
        FOR v_op IN
            SELECT * FROM (VALUES
                ('crear_deporte',                  'SELECT (public.crear_deporte(''Deporte denegado'')).id::TEXT'),
                ('renombrar_deporte',              pg_catalog.format('SELECT (public.renombrar_deporte(%L, ''Nombre denegado'')).id::TEXT', pg_temp.fx('tenis'))),
                ('cambiar_estado_deporte',         pg_catalog.format('SELECT (public.cambiar_estado_deporte(%L, false)).id::TEXT', pg_temp.fx('tenis'))),
                ('editar_grupo_deportivo',         pg_catalog.format('SELECT (public.editar_grupo_deportivo(%L, ''Grupo denegado'', 4, %L)).id::TEXT', pg_temp.fx('g1'), pg_temp.u('03'))),
                ('cambiar_estado_grupo_deportivo', pg_catalog.format('SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).id::TEXT', pg_temp.fx('g7')))
            ) AS o(nombre, sql)
        LOOP
            v_res := pg_temp.ejecutar(v_actor.rol, v_actor.sub, v_op.sql);
            IF v_res = 'E:42P17' THEN
                RAISE EXCEPTION 'FALLO H1: % / % → recursión de políticas (42P17)', v_actor.etiqueta, v_op.nombre;
            END IF;
            IF v_res <> 'E:42501' THEN
                RAISE EXCEPTION 'FALLO H1: % / % → se obtuvo %, se esperaba E:42501', v_actor.etiqueta, v_op.nombre, v_res;
            END IF;
        END LOOP;
    END LOOP;
    PERFORM pg_temp.ok('H1: DOCENTE, ESTUDIANTE, PADRE, PERSONAL, sin perfil, DIRECTOR bloqueado y anon reciben 42501 en las cinco operaciones (sin 42P17)');

    -- Una sesión autenticada sin identidad (sin `sub`) recibe P5505.
    FOR v_op IN
        SELECT * FROM (VALUES
            ('crear_deporte',                  'SELECT (public.crear_deporte(''Sin sesión'')).id::TEXT'),
            ('renombrar_deporte',              pg_catalog.format('SELECT (public.renombrar_deporte(%L, ''Sin sesión'')).id::TEXT', pg_temp.fx('tenis'))),
            ('cambiar_estado_deporte',         pg_catalog.format('SELECT (public.cambiar_estado_deporte(%L, false)).id::TEXT', pg_temp.fx('tenis'))),
            ('editar_grupo_deportivo',         pg_catalog.format('SELECT (public.editar_grupo_deportivo(%L, ''Sin sesión'', 4, %L)).id::TEXT', pg_temp.fx('g1'), pg_temp.u('03'))),
            ('cambiar_estado_grupo_deportivo', pg_catalog.format('SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).id::TEXT', pg_temp.fx('g7')))
        ) AS o(nombre, sql)
    LOOP
        v_res := pg_temp.ejecutar('authenticated', NULL, v_op.sql);
        IF v_res <> 'E:P5505' THEN
            RAISE EXCEPTION 'FALLO H2: sin identidad / % → se obtuvo %, se esperaba E:P5505', v_op.nombre, v_res;
        END IF;
    END LOOP;
    PERFORM pg_temp.ok('H2: una sesión authenticated sin identidad recibe P5505 en las cinco operaciones');

    -- Ninguna denegación cambió datos.
    IF pg_temp.huella('deportes') <> v_h_dep OR pg_temp.huella('grupos_deportivos') <> v_h_gru THEN
        RAISE EXCEPTION 'FALLO H3: una denegación cambió deportes o grupos';
    END IF;
    PERFORM pg_temp.ok('H3: las denegaciones no cambian ninguna fila de deportes ni de grupos');

    -- El DIRECTOR bloqueado sigue sin ver las tablas por RLS y el habilitado sí.
    IF pg_temp.ejecutar('authenticated', pg_temp.u('02'), 'SELECT count(*)::TEXT FROM public.grupos_deportivos') <> 'OK:0'
       OR pg_temp.ejecutar('authenticated', pg_temp.u('02'), 'SELECT count(*)::TEXT FROM public.deportes') <> 'OK:0'
       OR pg_temp.ejecutar('authenticated', pg_temp.u('02'), 'SELECT count(*)::TEXT FROM public.inscripciones_deportivas') <> 'OK:0' THEN
        RAISE EXCEPTION 'FALLO H4: el DIRECTOR bloqueado lee filas deportivas';
    END IF;
    IF pg_temp.dir('SELECT (count(*) > 0)::TEXT FROM public.grupos_deportivos') <> 'OK:true' THEN
        RAISE EXCEPTION 'FALLO H4: el DIRECTOR habilitado no lee grupos';
    END IF;
    PERFORM pg_temp.ok('H4: el DIRECTOR bloqueado ve 0 filas en deportes, grupos e inscripciones (RESTRICTIVE de EPT-59); el habilitado las ve');
END $$;


-- ================================================================
-- I. HISTORIAL INTACTO Y SIN ESCRITURA DIRECTA NI DELETE
-- ================================================================
DO $$
BEGIN
    -- I1. Las inscripciones existentes son idénticas a las de la matriz, byte a byte.
    IF (SELECT t::TEXT FROM public.inscripciones_deportivas t WHERE id = pg_temp.fx('i1')::UUID) <> pg_temp.fx('huella_i1')
       OR (SELECT t::TEXT FROM public.inscripciones_deportivas t WHERE id = pg_temp.fx('i3')::UUID) <> pg_temp.fx('huella_i3')
       OR pg_temp.huella('inscripciones_deportivas') <> pg_temp.fx('huella_inscripciones') THEN
        RAISE EXCEPTION 'FALLO I1: cambió alguna inscripción deportiva';
    END IF;
    PERFORM pg_temp.ok('I1: tras todas las operaciones administrativas las tres inscripciones (dos activas y una cancelada) son idénticas');

    -- I2. Ningún alumno perdió su plaza: siguen ACTIVAS en el grupo original.
    IF (SELECT count(*) FROM public.inscripciones_deportivas
        WHERE grupo_id = pg_temp.fx('g1')::UUID AND estado = 'ACTIVA') <> 2 THEN
        RAISE EXCEPTION 'FALLO I2: Fútbol Primario A perdió inscripciones activas';
    END IF;
    PERFORM pg_temp.ok('I2: Fútbol Primario A conserva sus dos inscripciones activas');

    -- I3. Escritura directa y borrado, negados al DIRECTOR habilitado.
    PERFORM pg_temp.esperar(pg_temp.dir('WITH x AS (DELETE FROM public.grupos_deportivos RETURNING 1) SELECT count(*)::TEXT FROM x'), '42501', 'I3 DELETE grupos');
    PERFORM pg_temp.esperar(pg_temp.dir('WITH x AS (DELETE FROM public.deportes RETURNING 1) SELECT count(*)::TEXT FROM x'), '42501', 'I3 DELETE deportes');
    PERFORM pg_temp.esperar(pg_temp.dir('WITH x AS (DELETE FROM public.inscripciones_deportivas RETURNING 1) SELECT count(*)::TEXT FROM x'), '42501', 'I3 DELETE inscripciones');
    PERFORM pg_temp.esperar(pg_temp.dir('WITH x AS (UPDATE public.grupos_deportivos SET activo = false RETURNING 1) SELECT count(*)::TEXT FROM x'), '42501', 'I3 UPDATE directo');
    PERFORM pg_temp.esperar(pg_temp.dir($q$WITH x AS (INSERT INTO public.deportes (nombre) VALUES ('Directo') RETURNING 1) SELECT count(*)::TEXT FROM x$q$), '42501', 'I3 INSERT directo');
    PERFORM pg_temp.esperar(pg_temp.dir('TRUNCATE public.grupos_deportivos CASCADE'), '42501', 'I3 TRUNCATE');
    PERFORM pg_temp.ok('I3: el DIRECTOR no puede DELETE, UPDATE, INSERT ni TRUNCATE las tablas deportivas directamente (42501)');
END $$;


-- ================================================================
-- K. LA ADMINISTRACIÓN DE DATOS DEL PROPIETARIO NO CAMBIA
-- ================================================================
-- Las reglas 3 y 4 viven en las RPC (la única escritura de las aplicaciones).
-- EPT-57 documenta que la administración de datos puede dar de baja un grupo
-- que conserva inscripciones ACTIVAS (`horarios_academicos_rls.sql` lo
-- ejercita): esta migración no cambia esa capacidad del propietario, y la RPC
-- sigue negando lo mismo a la dirección.
DO $$
DECLARE
    g1 UUID := pg_temp.fx('g1')::UUID;
BEGIN
    UPDATE public.grupos_deportivos SET activo = FALSE WHERE id = g1;
    IF (SELECT activo FROM public.grupos_deportivos WHERE id = g1)
       OR (SELECT count(*) FROM public.inscripciones_deportivas
           WHERE grupo_id = g1 AND estado = 'ACTIVA') <> 2 THEN
        RAISE EXCEPTION 'FALLO K1: el UPDATE del propietario no dejó el grupo inactivo con sus inscripciones';
    END IF;
    -- La dirección, en cambio, no puede reproducir ese estado por la RPC.
    UPDATE public.grupos_deportivos SET activo = TRUE WHERE id = g1;
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.cambiar_estado_grupo_deportivo(%L, false)).activo::TEXT', g1)), 'P5975', 'K1 RPC sigue negándolo');
    PERFORM pg_temp.ok('K1: el propietario conserva la administración de datos de EPT-57 (grupo inactivo con inscripciones activas); la RPC de la dirección sigue negándolo (P5975)');
END $$;


-- ================================================================
-- J. REVERSIÓN NO DESTRUCTIVA
-- ================================================================
-- Soltar las cinco operaciones y sus cinco envoltorios no toca ninguna fila ni
-- los objetos de 014, EPT-57 y EPT-58.
CREATE TEMPORARY TABLE reversion_antes ON COMMIT DROP AS
SELECT pg_temp.huella('deportes') AS deportes,
       pg_temp.huella('grupos_deportivos') AS grupos,
       pg_temp.huella('inscripciones_deportivas') AS inscripciones;

SAVEPOINT reversion;

DROP FUNCTION public.crear_deporte(text);
DROP FUNCTION public.renombrar_deporte(uuid, text);
DROP FUNCTION public.cambiar_estado_deporte(uuid, boolean);
DROP FUNCTION public.editar_grupo_deportivo(uuid, text, integer, uuid);
DROP FUNCTION public.cambiar_estado_grupo_deportivo(uuid, boolean);
DROP FUNCTION app_private.crear_deporte(text);
DROP FUNCTION app_private.renombrar_deporte(uuid, text);
DROP FUNCTION app_private.cambiar_estado_deporte(uuid, boolean);
DROP FUNCTION app_private.editar_grupo_deportivo(uuid, text, integer, uuid);
DROP FUNCTION app_private.cambiar_estado_grupo_deportivo(uuid, boolean);

DO $$
BEGIN
    IF pg_temp.huella('deportes') <> (SELECT deportes FROM reversion_antes)
       OR pg_temp.huella('grupos_deportivos') <> (SELECT grupos FROM reversion_antes)
       OR pg_temp.huella('inscripciones_deportivas') <> (SELECT inscripciones FROM reversion_antes) THEN
        RAISE EXCEPTION 'FALLO J1: soltar las funciones nuevas cambió datos';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_deporte', 'renombrar_deporte', 'cambiar_estado_deporte',
                            'editar_grupo_deportivo', 'cambiar_estado_grupo_deportivo')
    ) THEN
        RAISE EXCEPTION 'FALLO J1: quedaron objetos nuevos después de la reversión';
    END IF;
    -- Lo de 014, EPT-57 y EPT-58 sigue en pie.
    IF (SELECT count(*) FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN ('validar_grupo_deportivo_antes_de_escribir', 'a_exigir_profesor_activo',
                         'proteger_identidad_deporte_antes_de_actualizar',
                         'validar_reactivacion_grupo_con_academia')) <> 5
       OR to_regprocedure('public.crear_grupo_deportivo(uuid,integer,text,integer,uuid)') IS NULL THEN
        RAISE EXCEPTION 'FALLO J1: la reversión tocó objetos de 014, EPT-57 o EPT-58';
    END IF;
    PERFORM pg_temp.ok('J1: soltar las 10 funciones nuevas no cambia ninguna fila y deja intactos los triggers y objetos de 014, EPT-57 y EPT-58');
END $$;

ROLLBACK TO SAVEPOINT reversion;

DO $$
BEGIN
    IF to_regprocedure('public.editar_grupo_deportivo(uuid,text,integer,uuid)') IS NULL THEN
        RAISE EXCEPTION 'FALLO J2: el ROLLBACK TO SAVEPOINT no restauró las funciones';
    END IF;
    PERFORM pg_temp.ok('J2: el savepoint devuelve las funciones al estado de la migración');
END $$;

ROLLBACK;
