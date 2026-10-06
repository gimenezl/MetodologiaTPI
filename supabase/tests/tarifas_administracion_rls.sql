-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Administración de tarifas (EPT-103)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable e identificada,
-- después de `supabase db reset`. Todo ocurre dentro de una transacción con
-- ROLLBACK. Uso con el stack aislado de la unidad:
--
--   docker cp supabase/tests/tarifas_administracion_rls.sql supabase_db_ept103:/tmp/
--   docker exec supabase_db_ept103 psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/tarifas_administracion_rls.sql
--
-- Cada comprobación imprime `OK n` (aviso) o aborta con `FALLO n`. Una negativa
-- solo cuenta con el SQLSTATE esperado: fallar «por cualquier error» no demuestra
-- la regla. Los actores se simulan con SET ROLE + JWT, igual que PostgREST; la
-- identidad sale siempre de `auth.uid()` y del perfil vigente.
--
--   A. estructura y privilegios exactos de las operaciones, los auxiliares y la guarda transaccional;
--   B. contrato monetario: cero, límites, negativos, precisión, formatos;
--   C. referencias: concepto, nivel, deporte, los cuatro recorridos y el comedor;
--   D. vigencias: extremos inclusivos, fin abierto, fechas no finitas, adyacencia;
--   E. sucesión atómica (`cambiar_tarifa`) y su reversión completa;
--   F. edición con control de conflicto (`actualizar_tarifa`);
--   G. histórico económico: facturas, ítems y pagos no cambian;
--   H. autoridad: matriz de actores y escritura directa cerrada;
--   I. sesión: JWT previo al bloqueo o al cambio de rol, metadata falsificada;
--   J. reversión no destructiva de la migración (solo mecánica: no es una reversión segura de la
--      autorización transaccional, ver 20261006175926).
-- La concurrencia con dos conexiones reales está en `tarifas_administracion_concurrencia.mjs`.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- AYUDANTES
-- ================================================================
CREATE TEMPORARY SEQUENCE ept103_n;

CREATE FUNCTION pg_temp.u(p_n INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_catalog.format('b1030000-0000-4000-8000-%s', pg_catalog.lpad(p_n::TEXT, 12, '0'))::UUID $$;

CREATE FUNCTION pg_temp.afirmar(p_condicion BOOLEAN, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := pg_catalog.nextval('ept103_n');
BEGIN
    IF p_condicion IS TRUE THEN
        RAISE NOTICE 'OK %: %', v_n, p_descripcion;
    ELSE
        RAISE EXCEPTION 'FALLO %: %', v_n, p_descripcion;
    END IF;
END;
$$;

-- Ejecuta una sentencia con el rol de aplicación y el JWT indicados. Devuelve el
-- valor escalar (texto) o 'E' || SQLSTATE si falla. Rol y claims se restauran.
CREATE FUNCTION pg_temp.como(p_sub UUID, p_rol TEXT, p_sql TEXT,
                             p_claims JSONB DEFAULT '{}'::JSONB) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_resultado TEXT;
    v_estado TEXT;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        (pg_catalog.jsonb_build_object('role', p_rol)
         || CASE WHEN p_sub IS NULL THEN '{}'::JSONB ELSE pg_catalog.jsonb_build_object('sub', p_sub) END
         || p_claims)::TEXT, TRUE);
    BEGIN
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql INTO v_resultado;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
        v_resultado := 'E' || v_estado;
    END;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
    RETURN v_resultado;
END;
$$;

-- Atajos del DIRECTOR habilitado (identidad 1) sobre las tres operaciones públicas.
CREATE FUNCTION pg_temp.crear(p_concepto TEXT, p_nivel INTEGER, p_deporte UUID, p_servicio UUID,
                              p_importe TEXT, p_desde TEXT, p_hasta TEXT) RETURNS TEXT
LANGUAGE sql AS $$
    SELECT pg_temp.como(pg_temp.u(1), 'authenticated',
        pg_catalog.format('SELECT public.crear_tarifa(%L, %L::INTEGER, %L::UUID, %L::UUID, %L, %L::DATE, %L::DATE)::TEXT',
            p_concepto, p_nivel, p_deporte, p_servicio, p_importe, p_desde, p_hasta));
$$;

CREATE FUNCTION pg_temp.cambiar(p_concepto TEXT, p_nivel INTEGER, p_deporte UUID, p_servicio UUID,
                                p_importe TEXT, p_desde TEXT, p_hasta TEXT) RETURNS TEXT
LANGUAGE sql AS $$
    SELECT pg_temp.como(pg_temp.u(1), 'authenticated',
        pg_catalog.format('SELECT public.cambiar_tarifa(%L, %L::INTEGER, %L::UUID, %L::UUID, %L, %L::DATE, %L::DATE)::TEXT',
            p_concepto, p_nivel, p_deporte, p_servicio, p_importe, p_desde, p_hasta));
$$;

CREATE FUNCTION pg_temp.actualizar(p_id UUID, p_importe TEXT, p_desde TEXT, p_hasta TEXT,
                                   p_importe_previo TEXT, p_desde_previo TEXT, p_hasta_previo TEXT)
RETURNS TEXT
LANGUAGE sql AS $$
    SELECT pg_temp.como(pg_temp.u(1), 'authenticated',
        pg_catalog.format('SELECT public.actualizar_tarifa(%L::UUID, %L, %L::DATE, %L::DATE, %L, %L::DATE, %L::DATE)::TEXT',
            p_id, p_importe, p_desde, p_hasta, p_importe_previo, p_desde_previo, p_hasta_previo));
$$;

-- Texto -> JSONB tolerante: un resultado 'E…' no es JSON y no debe romper la lectura.
CREATE FUNCTION pg_temp.j(p_texto TEXT) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p_texto LIKE '{%' THEN p_texto::JSONB ELSE NULL END $$;

-- Cuenta de tarifas de una referencia (como propietario, sin RLS).
CREATE FUNCTION pg_temp.n_nivel(p_nivel INTEGER) RETURNS BIGINT
LANGUAGE sql AS $$ SELECT pg_catalog.count(*) FROM public.tarifas WHERE nivel_id = p_nivel $$;


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- 1 DIRECTOR habilitado · 2 ESTUDIANTE · 4 DOCENTE · 5 PADRE · 8 PERSONAL ·
-- 11 DIRECTOR que será BLOQUEADO · 12 DIRECTOR cuyo rol cambiará.
-- 10: sujeto con JWT válido y sin perfil (no se inserta).
WITH base_libre AS (
    SELECT base
    FROM generate_series(84000000, 89999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 12) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(n, rol, apellido, legajo) AS (
    VALUES
        (1,  'DIRECTOR',   'Directora',        NULL),
        (2,  'ESTUDIANTE', 'Alumna A',         'LEG-EPT103-0002'),
        (4,  'DOCENTE',    'Docente 1',        'LEG-EPT103-0004'),
        (5,  'PADRE',      'Padre A',          NULL),
        (8,  'PERSONAL',   'Personal 1',       NULL),
        (11, 'DIRECTOR',   'Directora bloqueada', NULL),
        (12, 'DIRECTOR',   'Directora degradada', NULL)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.u(i.n), pg_temp.u(i.n), r.id, 'Prueba', i.apellido,
       (b.base + i.n)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u(101), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'Curso EPT-103', 'A', TRUE);
INSERT INTO public.matriculas (id, alumno_id, curso_id)
VALUES (pg_temp.u(701), pg_temp.u(2), pg_temp.u(101));
UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = pg_temp.u(2);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES (pg_temp.u(5), pg_temp.u(2));


-- ================================================================
-- A. ESTRUCTURA Y PRIVILEGIOS
-- ================================================================
DO $$
DECLARE
    v_f TEXT;
    v_rol TEXT;
    v_n BIGINT;
BEGIN
    -- A1. Existen las tres operaciones públicas y sus tres implementaciones privadas.
    FOREACH v_f IN ARRAY ARRAY[
        'public.crear_tarifa(text,integer,uuid,uuid,text,date,date)',
        'public.cambiar_tarifa(text,integer,uuid,uuid,text,date,date)',
        'public.actualizar_tarifa(uuid,text,date,date,text,date,date)',
        'app_private.crear_tarifa(text,integer,uuid,uuid,text,date,date)',
        'app_private.cambiar_tarifa(text,integer,uuid,uuid,text,date,date)',
        'app_private.actualizar_tarifa(uuid,text,date,date,text,date,date)'] LOOP
        PERFORM pg_temp.afirmar(pg_catalog.to_regprocedure(v_f) IS NOT NULL, 'A1: existe ' || v_f);
        PERFORM pg_temp.afirmar(
            (SELECT p.prosecdef = (v_f LIKE 'app_private.%')
                    AND 'search_path=""' = ANY (p.proconfig)
             FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_f)),
            'A2: ' || v_f || ' usa search_path vacío y es DEFINER solo en app_private (el envoltorio público es INVOKER)');
        FOREACH v_rol IN ARRAY ARRAY['anon', 'service_role'] LOOP
            PERFORM pg_temp.afirmar(
                NOT pg_catalog.has_function_privilege(v_rol, v_f, 'EXECUTE'),
                'A3: ' || v_rol || ' sin EXECUTE sobre ' || v_f);
        END LOOP;
        PERFORM pg_temp.afirmar(
            pg_catalog.has_function_privilege('authenticated', v_f, 'EXECUTE'),
            'A3: authenticated con EXECUTE sobre ' || v_f);
        SELECT pg_catalog.count(*) INTO v_n
        FROM pg_catalog.pg_proc p,
             LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE p.oid = pg_catalog.to_regprocedure(v_f) AND a.grantee = 0;
        PERFORM pg_temp.afirmar(v_n = 0, 'A3: PUBLIC sin EXECUTE sobre ' || v_f);
    END LOOP;

    -- A4. Los auxiliares no tienen EXECUTE para ningún rol de aplicación.
    FOREACH v_f IN ARRAY ARRAY[
        'app_private.importe_tarifa_valido(text)',
        'app_private.vigencia_tarifa_valida(date,date)',
        'app_private.referencia_tarifa_valida(text,integer,uuid,uuid)',
        'app_private.bloquear_referencia_tarifa(public.concepto_economico,integer,uuid,uuid)',
        'app_private.tarifa_a_json(public.tarifas)'] LOOP
        PERFORM pg_temp.afirmar(pg_catalog.to_regprocedure(v_f) IS NOT NULL, 'A4: existe ' || v_f);
        FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            PERFORM pg_temp.afirmar(
                NOT pg_catalog.has_function_privilege(v_rol, v_f, 'EXECUTE'),
                'A4: ' || v_rol || ' sin EXECUTE sobre el auxiliar ' || v_f);
        END LOOP;
    END LOOP;

    -- A5. Accesibilidad real: el auxiliar no se invoca desde la API (42501) pero la
    -- operación pública, que lo usa por dentro como propietario, sí funciona.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated',
            'SELECT app_private.importe_tarifa_valido(''10'')::TEXT') = 'E42501',
        'A5: ni el DIRECTOR ejecuta el auxiliar de importe directamente (42501)');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated',
            'SELECT app_private.tarifa_a_json(t)::TEXT FROM public.tarifas t LIMIT 1') = 'E42501',
        'A5: ni el serializador de filas');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000101', NULL,
                      '1500', '2027-01-01', '2027-12-31') LIKE '{%',
        'A5: el DIRECTOR sí crea una tarifa por la operación pública (el helper privado es alcanzable por dentro)');

    -- A6. Escritura directa cerrada: ningún rol de aplicación escribe la tabla.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        PERFORM pg_temp.afirmar(
            NOT pg_catalog.has_table_privilege(v_rol, 'public.tarifas', 'INSERT')
            AND NOT pg_catalog.has_table_privilege(v_rol, 'public.tarifas', 'UPDATE')
            AND NOT pg_catalog.has_table_privilege(v_rol, 'public.tarifas', 'DELETE')
            AND NOT pg_catalog.has_table_privilege(v_rol, 'public.tarifas', 'TRUNCATE')
            AND NOT pg_catalog.has_any_column_privilege(v_rol, 'public.tarifas', 'INSERT')
            AND NOT pg_catalog.has_any_column_privilege(v_rol, 'public.tarifas', 'UPDATE'),
            'A6: ' || v_rol || ' sin INSERT/UPDATE/DELETE/TRUNCATE ni grants por columna sobre tarifas');
    END LOOP;
    PERFORM pg_temp.afirmar(
        NOT pg_catalog.has_table_privilege('anon', 'public.tarifas', 'SELECT')
        AND pg_catalog.has_table_privilege('authenticated', 'public.tarifas', 'SELECT'),
        'A6: SELECT solo para authenticated (la política limita a DIRECTOR; EPT-101 intacto)');

    -- A7. Ninguna operación acepta actor, rol, usuario ni perfil.
    PERFORM pg_temp.afirmar(NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa')
          AND EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proargnames) AS a
                      WHERE a ILIKE '%user%' OR a ILIKE '%rol%' OR a ILIKE '%actor%' OR a ILIKE '%perfil%')),
        'A7: ninguna operación recibe actor, rol, usuario ni perfil');

    -- A8. Los triggers de EPT-100 sobre tarifas siguen siendo exactamente esos dos.
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
         FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.tarifas'::pg_catalog.regclass AND NOT t.tgisinternal)
        = ARRAY['proteger_tarifa_facturada_antes_de_actualizar',
                'verificar_tarifa_servicio_antes_de_escribir']::TEXT[],
        'A8: no hay triggers nuevos sobre tarifas');

    -- A9. Guarda de autorización transaccional (corrección de EPT-103): sin parámetros, DEFINER,
    -- VOLATILE, search_path vacío, sin EXECUTE para nadie y con FOR SHARE (no la variante de clave).
    -- La prueba de comportamiento está en `tarifas_autorizacion_concurrencia.mjs`.
    v_f := 'app_private.exigir_director_tarifas()';
    PERFORM pg_temp.afirmar(pg_catalog.to_regprocedure(v_f) IS NOT NULL, 'A9: existe ' || v_f);
    PERFORM pg_temp.afirmar(
        (SELECT p.prosecdef AND p.provolatile = 'v' AND p.pronargs = 0
                AND p.proconfig = ARRAY['search_path=""']
                AND p.prosrc ~ 'FOR SHARE OF p' AND p.prosrc !~* 'KEY SHARE'
         FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_f)),
        'A9: la guarda es DEFINER VOLATILE, sin parámetros, con search_path vacío y FOR SHARE sobre el perfil');
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        PERFORM pg_temp.afirmar(
            NOT pg_catalog.has_function_privilege(v_rol, v_f, 'EXECUTE'),
            'A9: ' || v_rol || ' sin EXECUTE sobre la guarda');
    END LOOP;
    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = pg_catalog.to_regprocedure(v_f) AND a.grantee = 0;
    PERFORM pg_temp.afirmar(v_n = 0, 'A9: PUBLIC sin EXECUTE sobre la guarda');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated', 'SELECT app_private.exigir_director_tarifas()::TEXT') = 'E42501',
        'A9: ni el DIRECTOR ejecuta la guarda directamente (42501)');
    -- Las tres operaciones privadas invocan la guarda antes que cualquier espera y ya no leen el rol sin bloqueo.
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.bool_and(p.prosrc ~ 'PERFORM app_private\.exigir_director_tarifas\(\)'
                                    AND p.prosrc !~* 'es_director'
                                    AND pg_catalog.strpos(p.prosrc, 'exigir_director_tarifas')
                                        < pg_catalog.strpos(p.prosrc, 'bloquear_referencia_tarifa'))
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app_private'
           AND p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa')),
        'A9: las tres operaciones privadas toman la guarda antes del bloqueo de la referencia y sin es_director()');
END;
$$;


-- ================================================================
-- B. CONTRATO MONETARIO (validación del texto ANTES del cast con escala)
-- ================================================================
DO $$
DECLARE
    v_caso RECORD;
    v_obtenido TEXT;
    v_estado TEXT;
BEGIN
    FOR v_caso IN
        SELECT * FROM (VALUES
            -- Válidos: se almacenan exactamente, con dos decimales.
            ('0',               '0.00'),
            ('0.00',            '0.00'),
            ('0.5',             '0.50'),
            ('0.05',            '0.05'),
            ('10',              '10.00'),
            ('10.5',            '10.50'),
            ('10.50',           '10.50'),
            ('1234567.89',      '1234567.89'),
            ('9999999999.99',   '9999999999.99'),
            ('9999999999',      '9999999999.00'),
            -- Negativos.
            ('-1',              'P6811'),
            ('-0.01',           'P6811'),
            ('-0',              'P6811'),
            ('-9999999999.99',  'P6811'),
            -- Precisión extra: se rechaza, NO se redondea (10.005 no pasa a 10.01).
            ('10.005',          'P6812'),
            ('10.001',          'P6812'),
            ('10.999',          'P6812'),
            ('10.000',          'P6812'),
            ('0.001',           'P6812'),
            ('10.12345',        'P6812'),
            -- Fuera de capacidad de NUMERIC(12,2).
            ('10000000000',     'P6813'),
            ('10000000000.00',  'P6813'),
            ('99999999999999',  'P6813'),
            ('10000000000.999', 'P6813'),
            -- Formatos no soportados: ninguna coerción silenciosa.
            ('NaN',             'P6810'),
            ('nan',             'P6810'),
            ('Infinity',        'P6810'),
            ('-Infinity',       'P6810'),
            ('infinity',        'P6810'),
            ('1e3',             'P6810'),
            ('1E3',             'P6810'),
            ('1e-2',            'P6810'),
            ('0x10',            'P6810'),
            ('1,5',             'P6810'),
            ('1,50',            'P6810'),
            ('1.234,50',        'P6810'),
            ('1,234.50',        'P6810'),
            ('1.234.567',       'P6810'),
            ('1 000',           'P6810'),
            ('1_000',           'P6810'),
            (' 10',             'P6810'),
            ('10 ',             'P6810'),
            (E'10\n',           'P6810'),
            (E'\t10',           'P6810'),
            ('+10',             'P6810'),
            ('1.',              'P6810'),
            ('.5',              'P6810'),
            ('.',               'P6810'),
            ('',                'P6810'),
            ('abc',             'P6810'),
            ('$10',             'P6810'),
            ('10 ARS',          'P6810'),
            ('00',              'P6810'),
            ('01',              'P6810'),
            ('01.50',           'P6810'),
            ('007',             'P6810'),
            (E'１０',   'P6810'),
            ('1..5',            'P6810'),
            ('1.2.3',           'P6810'),
            ('--1',             'P6810'),
            ('1-',              'P6810'),
            (NULL,              'P6810')
        ) AS c(entrada, esperado)
    LOOP
        BEGIN
            EXECUTE 'SELECT app_private.importe_tarifa_valido($1)::TEXT' INTO v_obtenido USING v_caso.entrada;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
            v_obtenido := v_estado;
        END;
        PERFORM pg_temp.afirmar(v_obtenido IS NOT DISTINCT FROM v_caso.esperado,
            pg_catalog.format('B1: importe %L -> %s (esperado %s)',
                              v_caso.entrada, v_obtenido, v_caso.esperado));
    END LOOP;
END;
$$;

DO $$
DECLARE
    v_r TEXT;
    v_antes BIGINT;
BEGIN
    -- B2. Extremo a extremo por la operación pública: guardado y relectura exactos.
    v_r := pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000102', NULL,
                         '0', '2028-01-01', '2028-12-31');
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->>'importe' = '0.00',
        'B2: el cero se acepta y la respuesta lo devuelve como texto exacto (0.00)');
    PERFORM pg_temp.afirmar(
        (SELECT importe::TEXT FROM public.tarifas
         WHERE deporte_id = 'e0000000-0000-4000-8000-000000000102' AND desde = '2028-01-01') = '0.00',
        'B2: relectura de la tabla: 0.00 conservado, no reemplazado por un mínimo positivo');

    v_r := pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000103', NULL,
                         '9999999999.99', '2028-01-01', NULL);
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->>'importe' = '9999999999.99',
        'B2: el límite de capacidad se guarda exacto');

    v_r := pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000104', NULL,
                         '1234.5', '2028-01-01', NULL);
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->>'importe' = '1234.50',
        'B2: 1234.5 se guarda como 1234.50 (misma cantidad, escala fija, sin redondeo)');

    -- B3. 10.005 se rechaza y no deja ninguna fila: no se convierte en 10.01.
    SELECT pg_catalog.count(*) INTO v_antes FROM public.tarifas
    WHERE deporte_id = 'e0000000-0000-4000-8000-000000000105';
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL,
                      '10.005', '2028-01-01', NULL) = 'EP6812',
        'B3: 10.005 se rechaza con P6812');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.tarifas
         WHERE deporte_id = 'e0000000-0000-4000-8000-000000000105') = v_antes,
        'B3: el rechazo no dejó fila: 10.005 nunca se almacenó como 10.01');
    PERFORM pg_temp.afirmar(
        NOT EXISTS (SELECT 1 FROM public.tarifas WHERE importe = 10.01
                    AND deporte_id = 'e0000000-0000-4000-8000-000000000105'),
        'B3: ninguna tarifa 10.01 apareció por redondeo');

    -- B4. Los demás rechazos monetarios por la operación pública.
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL,
                      '-5', '2028-01-01', NULL) = 'EP6811',
        'B4: negativo -> P6811');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL,
                      'NaN', '2028-01-01', NULL) = 'EP6810',
        'B4: NaN -> P6810');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL,
                      'Infinity', '2028-01-01', NULL) = 'EP6810',
        'B4: Infinity -> P6810');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL,
                      '1e3', '2028-01-01', NULL) = 'EP6810',
        'B4: notación exponencial -> P6810');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL,
                      '10000000000', '2028-01-01', NULL) = 'EP6813',
        'B4: exceso de capacidad -> P6813');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL,
                      NULL, '2028-01-01', NULL) = 'EP6810',
        'B4: importe ausente -> P6810');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.tarifas
         WHERE deporte_id = 'e0000000-0000-4000-8000-000000000105') = v_antes,
        'B4: ningún rechazo dejó filas');

    -- B5. El CHECK de la tabla sigue siendo la última barrera (como propietario).
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.tarifas'::pg_catalog.regclass
           AND conname = 'tarifas_importe_valido') = 1,
        'B5: sigue el CHECK tarifas_importe_valido (NaN y negativos) de EPT-100');
END;
$$;


-- ================================================================
-- C. REFERENCIAS
-- ================================================================
DO $$
DECLARE
    v_r TEXT;
    v_servicio UUID;
    v_nivel INTEGER;
    -- Cantidad de niveles al empezar: otras suites pueden dejar niveles propios en una base reutilizada.
    v_niveles BIGINT := (SELECT pg_catalog.count(*) FROM public.niveles);
BEGIN
    -- C1. Cada nivel educativo tiene su cuota.
    FOR v_nivel IN SELECT id FROM public.niveles ORDER BY id LOOP
        v_r := pg_temp.crear('CUOTA', v_nivel, NULL, NULL, '30000.00', '2029-01-01', NULL);
        PERFORM pg_temp.afirmar(
            pg_temp.j(v_r)->>'concepto' = 'CUOTA' AND (pg_temp.j(v_r)->>'nivel_id')::INTEGER = v_nivel
            AND pg_temp.j(v_r)->'deporte_id' = 'null'::JSONB AND pg_temp.j(v_r)->'servicio_id' = 'null'::JSONB,
            pg_catalog.format('C1: CUOTA del nivel %s con su única referencia', v_nivel));
    END LOOP;

    -- C2. Los cuatro recorridos existentes tienen su tarifa de TRANSPORTE.
    FOR v_servicio IN SELECT id FROM public.servicios_escolares WHERE tipo = 'TRANSPORTE' ORDER BY codigo LOOP
        v_r := pg_temp.crear('TRANSPORTE', NULL, NULL, v_servicio, '12000.00', '2029-01-01', NULL);
        PERFORM pg_temp.afirmar(
            pg_temp.j(v_r)->>'concepto' = 'TRANSPORTE' AND (pg_temp.j(v_r)->>'servicio_id')::UUID = v_servicio,
            'C2: TRANSPORTE de un recorrido existente');
    END LOOP;
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.tarifas WHERE concepto = 'TRANSPORTE' AND desde = '2029-01-01') = 4,
        'C2: exactamente los cuatro recorridos tienen tarifa de transporte');

    -- C3. El comedor existente tiene su tarifa.
    SELECT id INTO v_servicio FROM public.servicios_escolares WHERE tipo = 'COMEDOR';
    v_r := pg_temp.crear('COMEDOR', NULL, NULL, v_servicio, '8000.00', '2029-01-01', NULL);
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->>'concepto' = 'COMEDOR', 'C3: COMEDOR del servicio de comedor');

    -- C4. Referencia incompatible con el concepto.
    PERFORM pg_temp.afirmar(
        pg_temp.crear('CUOTA', NULL, 'e0000000-0000-4000-8000-000000000101', NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: CUOTA con un deporte en lugar de nivel -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', 1, NULL, NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: DEPORTE con un nivel -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('TRANSPORTE', 1, NULL, NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: TRANSPORTE con un nivel -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('CUOTA', NULL, NULL, NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: sin ninguna referencia -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('CUOTA', 1, 'e0000000-0000-4000-8000-000000000101', NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: dos referencias a la vez -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('CUOTA', 1, NULL, 'e0000000-0000-4000-8000-000000000020', '1', '2030-01-01', NULL) = 'EP6823',
        'C4: nivel y servicio a la vez -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('MATRICULA', 1, NULL, NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: concepto inexistente (sin catálogos paralelos ni cargos adicionales) -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('cuota', 1, NULL, NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: el concepto distingue mayúsculas: «cuota» -> P6823');
    PERFORM pg_temp.afirmar(
        pg_temp.crear(NULL, 1, NULL, NULL, '1', '2030-01-01', NULL) = 'EP6823',
        'C4: concepto ausente -> P6823');

    -- C5. Servicio de otro tipo que el concepto: lo decide el trigger de EPT-100 (P6801).
    PERFORM pg_temp.afirmar(
        pg_temp.crear('TRANSPORTE', NULL, NULL, (SELECT id FROM public.servicios_escolares WHERE tipo = 'COMEDOR'),
                      '1', '2030-01-01', NULL) = 'EP6801',
        'C5: TRANSPORTE sobre el servicio de comedor -> P6801');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('COMEDOR', NULL, NULL, 'e0000000-0000-4000-8000-000000000020', '1', '2030-01-01', NULL) = 'EP6801',
        'C5: COMEDOR sobre un recorrido -> P6801');

    -- C6. Referencia inexistente.
    PERFORM pg_temp.afirmar(
        pg_temp.crear('CUOTA', 999, NULL, NULL, '1', '2030-01-01', NULL) = 'EP6824',
        'C6: nivel inexistente -> P6824');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, pg_temp.u(9999), NULL, '1', '2030-01-01', NULL) = 'EP6824',
        'C6: deporte inexistente -> P6824');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('TRANSPORTE', NULL, NULL, pg_temp.u(9999), '1', '2030-01-01', NULL) = 'EP6824',
        'C6: servicio inexistente -> P6824');

    -- C7. No se crearon catálogos duplicados ni recorridos nuevos.
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.servicios_escolares WHERE tipo = 'TRANSPORTE') = 4
        AND (SELECT pg_catalog.count(*) FROM public.niveles) = v_niveles,
        'C7: los catálogos de recorridos y niveles no cambiaron (' || v_niveles || ' niveles)');
END;
$$;


-- ================================================================
-- D. VIGENCIAS (cerradas e inclusivas)
-- ================================================================
DO $$
DECLARE
    v_ref INTEGER := 1;   -- nivel INICIAL, libre de tarifas hasta 2029 (C1 usó 2029-01-01 abierta)
    v_d UUID := 'e0000000-0000-4000-8000-000000000106';   -- Básquet, sin tarifas todavía
    v_r TEXT;
BEGIN
    -- D1. Extremos incluidos: una vigencia de un solo día es válida.
    v_r := pg_temp.crear('DEPORTE', NULL, v_d, NULL, '100', '2030-03-15', '2030-03-15');
    PERFORM pg_temp.afirmar(pg_temp.j(v_r) IS NOT NULL, 'D1: desde = hasta (un solo día) es una vigencia válida');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, v_d, NULL, '100', '2030-03-15', '2030-03-15') = 'EP6830',
        'D1: repetir ese mismo día -> P6830');

    -- D2. Un día compartido entre dos vigencias se rechaza (ambos extremos cuentan).
    v_r := pg_temp.crear('DEPORTE', NULL, v_d, NULL, '110', '2030-04-01', '2030-04-30');
    PERFORM pg_temp.afirmar(pg_temp.j(v_r) IS NOT NULL, 'D2: [2030-04-01, 2030-04-30] se crea');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, v_d, NULL, '120', '2030-04-30', '2030-05-31') = 'EP6830',
        'D2: la nueva empieza el último día de la anterior (30/04 compartido) -> P6830');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, v_d, NULL, '120', '2030-03-20', '2030-04-01') = 'EP6830',
        'D2: la nueva termina el primer día de la anterior (01/04 compartido) -> P6830');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, v_d, NULL, '120', '2030-04-10', '2030-04-12') = 'EP6830',
        'D2: contenida dentro de la anterior -> P6830');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, v_d, NULL, '120', '2030-03-01', '2030-06-30') = 'EP6830',
        'D2: que contiene a la anterior -> P6830');

    -- D3. Adyacencia D-1 / D: aceptada.
    v_r := pg_temp.crear('DEPORTE', NULL, v_d, NULL, '120', '2030-05-01', '2030-05-31');
    PERFORM pg_temp.afirmar(pg_temp.j(v_r) IS NOT NULL, 'D3: 01/05 empieza el día después de que termina la de abril (D-1 / D)');
    v_r := pg_temp.crear('DEPORTE', NULL, v_d, NULL, '90', '2030-03-16', '2030-03-31');
    PERFORM pg_temp.afirmar(pg_temp.j(v_r) IS NOT NULL, 'D3: y la adyacente por delante (16/03 tras el 15/03 y antes del 01/04)');

    -- D4. Fin abierto: NULL = sin fin; después de él no cabe nada más.
    v_r := pg_temp.crear('DEPORTE', NULL, v_d, NULL, '130', '2030-06-01', NULL);
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->'hasta' = 'null'::JSONB, 'D4: hasta NULL = sin fin');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, v_d, NULL, '140', '2099-01-01', '2099-12-31') = 'EP6830',
        'D4: una vigencia muy posterior se superpone con la de fin abierto -> P6830');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, v_d, NULL, '140', '2031-01-01', NULL) = 'EP6830',
        'D4: otra de fin abierto también');

    -- D5. Fechas inválidas.
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', NULL, NULL) = 'EP6820',
        'D5: sin fecha de inicio -> P6820');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', 'infinity', NULL) = 'EP6821',
        'D5: desde infinity -> P6821');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', '-infinity', NULL) = 'EP6821',
        'D5: desde -infinity -> P6821');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', '2040-01-01', 'infinity') = 'EP6821',
        'D5: hasta infinity (el fin abierto es NULL, no infinito) -> P6821');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', '2040-01-01', '-infinity') = 'EP6821',
        'D5: hasta -infinity -> P6821');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', '2040-01-02', '2040-01-01') = 'EP6822',
        'D5: hasta anterior a desde -> P6822');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', '2040-02-30', NULL) = 'E22008',
        'D5: una fecha que no existe (30 de febrero) no llega a la función: 22008');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000105', NULL, '1', 'mañana', NULL) = 'E22007',
        'D5: una fecha ilegible: 22007');

    INSERT INTO public.deportes (id, nombre) VALUES (pg_temp.u(2002), 'Deporte D5b EPT-103');
    -- D5b. Rango de años igual al de la aplicación (1900 a 9999).
    FOREACH v_r IN ARRAY ARRAY['1899-12-31', '0001-01-01', '4713-11-24 BC'] LOOP
        PERFORM pg_temp.afirmar(
            pg_temp.crear('DEPORTE', NULL, pg_temp.u(2002), NULL, '1', v_r, NULL) = 'EP6821',
            'D5b: desde ' || v_r || ' -> P6821');
    END LOOP;
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, pg_temp.u(2002), NULL, '1', '2040-01-01', '9999-12-31') LIKE '{%',
        'D5b: hasta 9999-12-31 es el máximo aceptado');
    PERFORM pg_temp.afirmar(
        pg_temp.crear('DEPORTE', NULL, pg_temp.u(2002), NULL, '1', '9999-12-31', '9999-12-31') = 'EP6830',
        'D5b: y el día 9999-12-31 ya está cubierto por esa versión (sin desborde del rango)');

    -- D6. La restricción de exclusión de EPT-100 sigue siendo la garantía de fondo
    -- (escritura del propietario, sin pasar por las operaciones).
    BEGIN
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', v_d, 1, '2030-04-15', '2030-04-16');
        RAISE EXCEPTION 'FALLO D6: el propietario pudo solapar vigencias';
    EXCEPTION WHEN exclusion_violation THEN
        PERFORM pg_temp.afirmar(TRUE, 'D6: el propietario tampoco solapa: 23P01 de la exclusión de EPT-100');
    END;
END;
$$;


-- ================================================================
-- E. SUCESIÓN ATÓMICA (cambiar_tarifa)
-- ================================================================
-- Estado de partida (secciones B a D): nivel 1 INICIAL, 2 PRIMARIO y 3 SECUNDARIO
-- tienen una cuota abierta desde 2029-01-01 (30000.00); el deporte 101 tiene
-- [2027-01-01, 2027-12-31]; el 102 tiene [2028-01-01, 2028-12-31] a 0.00.
CREATE TEMPORARY TABLE ept103_estado (clave TEXT PRIMARY KEY, valor TEXT);

-- Huella del contenido de una referencia, para comprobar «no cambió nada».
CREATE FUNCTION pg_temp.huella(p_filtro TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_h TEXT;
BEGIN
    EXECUTE pg_catalog.format(
        'SELECT COALESCE(pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(''|'', id, importe, desde, hasta), '';'' ORDER BY id)), ''vacio'') FROM public.tarifas WHERE %s',
        p_filtro) INTO v_h;
    RETURN v_h;
END;
$$;

DO $$
DECLARE
    v_r TEXT;
    v_antes TEXT;
    v_json JSONB;
    v_previa UUID;
BEGIN
    -- E1. Sucesión: el 1/7 el precio cambia. La anterior termina el 30/6 y la nueva empieza el 1/7.
    v_r := pg_temp.cambiar('CUOTA', 1, NULL, NULL, '35000.5', '2029-07-01', NULL);
    v_json := pg_temp.j(v_r);
    PERFORM pg_temp.afirmar(v_json IS NOT NULL, 'E1: cambiar_tarifa tuvo éxito (' || v_r || ')');
    PERFORM pg_temp.afirmar(
        v_json->'anterior'->>'hasta' = '2029-06-30' AND v_json->'anterior'->>'desde' = '2029-01-01'
        AND v_json->'anterior'->>'importe' = '30000.00',
        'E1: la anterior termina D-1 (30/06) y conserva su importe');
    PERFORM pg_temp.afirmar(
        v_json->'nueva'->>'desde' = '2029-07-01' AND v_json->'nueva'->'hasta' = 'null'::JSONB
        AND v_json->'nueva'->>'importe' = '35000.50',
        'E1: la nueva empieza D (01/07), sin fin, con importe exacto 35000.50');
    PERFORM pg_temp.afirmar(pg_temp.n_nivel(1) = 2, 'E1: quedan exactamente dos versiones, sin borrar historial');
    PERFORM pg_temp.afirmar(
        pg_temp.j(v_r)->'anterior'->>'id' = (SELECT id::TEXT FROM public.tarifas WHERE nivel_id = 1 AND desde = '2029-01-01'),
        'E1: la anterior es la misma fila (se acorta, no se reemplaza)');
    INSERT INTO ept103_estado VALUES ('nueva_nivel_1', v_json->'nueva'->>'id');

    -- E2. Repetir el mismo cambio se rechaza y no persiste NADA (ni el cierre, ni la fila).
    v_antes := pg_temp.huella('nivel_id = 1');
    PERFORM pg_temp.afirmar(
        pg_temp.cambiar('CUOTA', 1, NULL, NULL, '40000', '2029-07-01', NULL) = 'EP6830',
        'E2: un segundo cambio el mismo día -> P6830');
    PERFORM pg_temp.afirmar(pg_temp.huella('nivel_id = 1') = v_antes,
        'E2: la operación multirregistro revirtió entera: la referencia quedó idéntica');

    -- E3. Adyacente: la anterior ya termina D-1, no se toca y solo se inserta la nueva.
    v_antes := pg_temp.huella('deporte_id = ''e0000000-0000-4000-8000-000000000101''');
    v_r := pg_temp.cambiar('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000101', NULL, '2000', '2028-01-01', NULL);
    v_json := pg_temp.j(v_r);
    PERFORM pg_temp.afirmar(v_json IS NOT NULL AND v_json->'anterior'->>'hasta' = '2027-12-31',
        'E3: con la anterior ya terminando el 31/12, la sucesión solo agrega la nueva (anterior sin tocar)');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.tarifas
         WHERE deporte_id = 'e0000000-0000-4000-8000-000000000101' AND desde = '2027-01-01' AND hasta = '2027-12-31') = 1,
        'E3: la versión anterior conserva exactamente su vigencia');

    -- E4. Hueco previo: la anterior terminó mucho antes; no se rellena ni se inventa.
    v_antes := pg_temp.huella('deporte_id = ''e0000000-0000-4000-8000-000000000102''');
    v_r := pg_temp.cambiar('DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000102', NULL, '2500', '2030-01-01', NULL);
    v_json := pg_temp.j(v_r);
    PERFORM pg_temp.afirmar(v_json IS NOT NULL AND v_json->'anterior' = 'null'::JSONB,
        'E4: sin versión vigente el día anterior, no hay «anterior» y no se inventa un cierre');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.tarifas
         WHERE deporte_id = 'e0000000-0000-4000-8000-000000000102' AND hasta = '2028-12-31' AND importe = 0) = 1,
        'E4: la versión vieja (a 0.00) quedó intacta');

    -- E5/E6/E7: nivel 3 con una anterior de fin propio y otra futura.
    v_previa := (SELECT id FROM public.tarifas WHERE nivel_id = 3 AND desde = '2029-01-01');
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.actualizar(v_previa, '30000', '2029-01-01', '2029-12-31', '30000.00', '2029-01-01', NULL)) IS NOT NULL,
        'E5: preparación: la cuota del nivel 3 pasa a terminar el 31/12/2029');
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.crear('CUOTA', 3, NULL, NULL, '60000', '2031-01-01', NULL)) IS NOT NULL,
        'E5: preparación: otra versión futura desde 2031');
    v_antes := pg_temp.huella('nivel_id = 3');

    PERFORM pg_temp.afirmar(
        pg_temp.cambiar('CUOTA', 3, NULL, NULL, '33000', '2029-06-01', NULL) = 'EP6830',
        'E5: el cambio choca con la versión futura abierta -> P6830');
    PERFORM pg_temp.afirmar(pg_temp.huella('nivel_id = 3') = v_antes,
        'E5: el cierre de la anterior (hasta = D-1) también se revirtió: sin escrituras parciales');

    PERFORM pg_temp.afirmar(
        pg_temp.cambiar('CUOTA', 3, NULL, NULL, '33000', '2029-06-01', '2029-08-31') = 'EP6833',
        'E6: un «hasta» menor que el fin de la anterior dejaría el tramo sep–dic sin tarifa -> P6833');
    PERFORM pg_temp.afirmar(pg_temp.huella('nivel_id = 3') = v_antes, 'E6: sin cambios persistidos');

    v_r := pg_temp.cambiar('CUOTA', 3, NULL, NULL, '33000', '2029-06-01', '2030-12-31');
    v_json := pg_temp.j(v_r);
    PERFORM pg_temp.afirmar(
        v_json IS NOT NULL AND v_json->'anterior'->>'hasta' = '2029-05-31'
        AND v_json->'nueva'->>'desde' = '2029-06-01' AND v_json->'nueva'->>'hasta' = '2030-12-31',
        'E7: con una anterior de fin propio, la nueva que lo cubre la acorta a D-1');
    PERFORM pg_temp.afirmar(pg_temp.n_nivel(3) = 3,
        'E7: el nivel 3 tiene tres versiones: nada se borró');

    INSERT INTO public.deportes (id, nombre) VALUES (pg_temp.u(2001), 'Deporte E7b EPT-103');
    -- E7b. Anterior ABIERTA y nueva con fin: el tramo posterior quedaría sin tarifa para siempre.
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.crear('DEPORTE', NULL, pg_temp.u(2001), NULL, '100', '2024-01-01', NULL)) IS NOT NULL,
        'E7b: preparación: una versión abierta desde 2024-01-01');
    v_antes := pg_temp.huella('deporte_id = ''' || pg_temp.u(2001) || '''');
    PERFORM pg_temp.afirmar(
        pg_temp.cambiar('DEPORTE', NULL, pg_temp.u(2001), NULL, '200', '2024-06-01', '2024-12-31') = 'EP6833',
        'E7b: cambiar con fin sobre una versión abierta -> P6833 (no deja el tramo posterior sin tarifa)');
    PERFORM pg_temp.afirmar(pg_temp.huella('deporte_id = ''' || pg_temp.u(2001) || '''') = v_antes,
        'E7b: sin escrituras parciales');
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.cambiar('DEPORTE', NULL, pg_temp.u(2001), NULL, '200', '2024-06-01', NULL)) IS NOT NULL,
        'E7b: sin fin, el mismo cambio sí se acepta');

    -- E8. Validaciones de entrada: nada persiste.
    v_antes := pg_temp.huella('nivel_id = 2');
    PERFORM pg_temp.afirmar(pg_temp.cambiar('CUOTA', 2, NULL, NULL, '10.005', '2029-09-01', NULL) = 'EP6812',
        'E8: importe con tres decimales en un cambio -> P6812');
    PERFORM pg_temp.afirmar(pg_temp.cambiar('CUOTA', 2, NULL, NULL, '10', 'infinity', NULL) = 'EP6821',
        'E8: fecha infinita en un cambio -> P6821');
    PERFORM pg_temp.afirmar(pg_temp.cambiar('CUOTA', 2, NULL, NULL, '10', '2029-09-01', '2029-08-01') = 'EP6822',
        'E8: hasta anterior a desde en un cambio -> P6822');
    PERFORM pg_temp.afirmar(pg_temp.cambiar('DEPORTE', 2, NULL, NULL, '10', '2029-09-01', NULL) = 'EP6823',
        'E8: referencia incompatible en un cambio -> P6823');
    PERFORM pg_temp.afirmar(pg_temp.huella('nivel_id = 2') = v_antes, 'E8: ningún rechazo persistió nada');
END;
$$;


-- ================================================================
-- F. EDICIÓN CON CONTROL DE CONFLICTO (actualizar_tarifa)
-- ================================================================
DO $$
DECLARE
    v_t UUID := (SELECT valor::UUID FROM ept103_estado WHERE clave = 'nueva_nivel_1');
    v_inicial UUID := (SELECT id FROM public.tarifas WHERE nivel_id = 1 AND desde = '2029-01-01');
    v_r TEXT;
    v_antes TEXT;
BEGIN
    -- F1. Valores previos desactualizados: P6831, sin sobrescribir.
    v_antes := pg_temp.huella('id = ''' || v_t || '''');
    PERFORM pg_temp.afirmar(
        pg_temp.actualizar(v_t, '99999', '2029-07-01', NULL, '1.00', '2029-07-01', NULL) = 'EP6831',
        'F1: otro importe previo -> P6831');
    PERFORM pg_temp.afirmar(
        pg_temp.actualizar(v_t, '99999', '2029-07-01', NULL, '35000.50', '2029-07-02', NULL) = 'EP6831',
        'F1: otra fecha de inicio previa -> P6831');
    PERFORM pg_temp.afirmar(
        pg_temp.actualizar(v_t, '99999', '2029-07-01', NULL, '35000.50', '2029-07-01', '2030-01-01') = 'EP6831',
        'F1: otro fin previo (la tarifa estaba abierta) -> P6831');
    PERFORM pg_temp.afirmar(
        pg_temp.actualizar(v_t, '99999', '2029-07-01', NULL, '35000.50', NULL, NULL) = 'EP6831',
        'F1: inicio previo ausente -> P6831');
    PERFORM pg_temp.afirmar(pg_temp.huella('id = ''' || v_t || '''') = v_antes,
        'F1: ningún conflicto sobrescribió la fila');

    -- F2. Con los valores que vio quien edita: se aplica el importe nuevo.
    v_r := pg_temp.actualizar(v_t, '36000', '2029-07-01', NULL, '35000.50', '2029-07-01', NULL);
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->>'importe' = '36000.00' AND pg_temp.j(v_r)->>'desde' = '2029-07-01',
        'F2: la corrección se aplica y devuelve el importe exacto (' || v_r || ')');
    PERFORM pg_temp.afirmar(
        (SELECT concepto::TEXT || nivel_id::TEXT FROM public.tarifas WHERE id = v_t) = 'CUOTA1',
        'F2: concepto y referencia no cambian (no son parámetros)');

    -- F3. Segunda persona con el valor viejo: conflicto, no sobrescritura silenciosa.
    PERFORM pg_temp.afirmar(
        pg_temp.actualizar(v_t, '41000', '2029-07-01', NULL, '35000.50', '2029-07-01', NULL) = 'EP6831',
        'F3: quien editó sobre el valor viejo recibe P6831');
    PERFORM pg_temp.afirmar((SELECT importe FROM public.tarifas WHERE id = v_t) = 36000.00,
        'F3: el valor de la primera persona se conserva');

    -- F4. Sin cambios: idempotente, sin escribir.
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.actualizar(v_t, '36000.00', '2029-07-01', NULL, '36000', '2029-07-01', NULL)) IS NOT NULL,
        'F4: repetir los mismos valores devuelve la fila sin error');

    -- F5. Solapamiento al editar la vigencia: la inicial (a 30/06) no puede extenderse a 15/07.
    v_antes := pg_temp.huella('nivel_id = 1');
    PERFORM pg_temp.afirmar(
        pg_temp.actualizar(v_inicial, '30000', '2029-01-01', '2029-07-15', '30000', '2029-01-01', '2029-06-30') = 'EP6830',
        'F5: extender la vigencia sobre otra versión -> P6830');
    PERFORM pg_temp.afirmar(pg_temp.huella('nivel_id = 1') = v_antes, 'F5: nada cambió');
    PERFORM pg_temp.afirmar(
        pg_temp.actualizar(v_inicial, '30000', '2029-01-01', '2029-07-01', '30000', '2029-01-01', '2029-06-30') = 'EP6830',
        'F5: compartir un solo día (01/07) también se rechaza');
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.actualizar(v_inicial, '30000', '2028-12-01', '2029-06-30', '30000', '2029-01-01', '2029-06-30')) IS NOT NULL,
        'F5: adelantar el inicio sin tocar otra versión sí se permite');

    -- F6. Validaciones de entrada.
    PERFORM pg_temp.afirmar(pg_temp.actualizar(v_t, '10.005', '2029-07-01', NULL, '36000', '2029-07-01', NULL) = 'EP6812',
        'F6: importe nuevo con tres decimales -> P6812');
    PERFORM pg_temp.afirmar(pg_temp.actualizar(v_t, '-1', '2029-07-01', NULL, '36000', '2029-07-01', NULL) = 'EP6811',
        'F6: importe nuevo negativo -> P6811');
    PERFORM pg_temp.afirmar(pg_temp.actualizar(v_t, '10', '2029-07-01', NULL, 'NaN', '2029-07-01', NULL) = 'EP6810',
        'F6: importe previo ilegible -> P6810');
    PERFORM pg_temp.afirmar(pg_temp.actualizar(v_t, '10', '2029-08-01', '2029-07-01', '36000', '2029-07-01', NULL) = 'EP6822',
        'F6: hasta anterior a desde -> P6822');
    PERFORM pg_temp.afirmar(pg_temp.actualizar(v_t, '10', '2029-07-01', 'infinity', '36000', '2029-07-01', NULL) = 'EP6821',
        'F6: hasta infinito -> P6821');
    PERFORM pg_temp.afirmar(pg_temp.actualizar(NULL, '10', '2029-07-01', NULL, '36000', '2029-07-01', NULL) = 'EP6832',
        'F6: sin identificador -> P6832');
    PERFORM pg_temp.afirmar(pg_temp.actualizar(pg_temp.u(9999), '10', '2029-07-01', NULL, '36000', '2029-07-01', NULL) = 'EP6832',
        'F6: tarifa inexistente -> P6832');

    -- F7. Cerrar y reabrir el fin: «hasta» se puede fijar y volver a vaciar.
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.actualizar(v_t, '36000', '2029-07-01', '2029-12-31', '36000', '2029-07-01', NULL))->>'hasta' = '2029-12-31',
        'F7: se fija el fin de la versión');
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.actualizar(v_t, '36000', '2029-07-01', NULL, '36000', '2029-07-01', '2029-12-31'))->'hasta' = 'null'::JSONB,
        'F7: y se vuelve a dejar abierta');
END;
$$;


-- ================================================================
-- G. HISTÓRICO ECONÓMICO
-- ================================================================
-- Huella de TODO el histórico económico: facturas, ítems, pagos, imputaciones y recibos.
CREATE FUNCTION pg_temp.huella_historico() RETURNS TEXT
LANGUAGE sql AS $$
    SELECT pg_catalog.md5(
        COALESCE((SELECT pg_catalog.string_agg(pg_catalog.to_jsonb(f)::TEXT, ';' ORDER BY f.id) FROM public.facturas f), '')
        || '#' || COALESCE((SELECT pg_catalog.string_agg(pg_catalog.to_jsonb(i)::TEXT, ';' ORDER BY i.id) FROM public.items_factura i), '')
        || '#' || COALESCE((SELECT pg_catalog.string_agg(pg_catalog.to_jsonb(p)::TEXT, ';' ORDER BY p.id) FROM public.pagos p), '')
        || '#' || COALESCE((SELECT pg_catalog.string_agg(pg_catalog.to_jsonb(m)::TEXT, ';' ORDER BY pg_catalog.to_jsonb(m)::TEXT) FROM public.imputaciones_pago m), '')
        || '#' || COALESCE((SELECT pg_catalog.string_agg(pg_catalog.to_jsonb(r)::TEXT, ';' ORDER BY r.id) FROM public.recibos r), ''));
$$;

DO $$
DECLARE
    v_t UUID := (SELECT id FROM public.tarifas WHERE nivel_id = 2 AND desde = '2029-01-01');
    v_antes TEXT;
    v_r TEXT;
BEGIN
    -- Factura emitida con esa tarifa (como propietario: los roles de aplicación no escriben).
    INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
    VALUES (pg_temp.u(801), pg_temp.u(2), '2029-03-01', '2029-03-10', 30000.00);
    INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
    VALUES (pg_temp.u(901), pg_temp.u(801), pg_temp.u(2), 'CUOTA', v_t, pg_temp.u(701), 30000.00);
    INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
    VALUES (pg_temp.u(1001), pg_temp.u(5), pg_temp.u(2), 30000.00);
    INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
    VALUES (pg_temp.u(1001), pg_temp.u(901), pg_temp.u(2), 30000.00);

    v_antes := pg_temp.huella_historico();
    INSERT INTO ept103_estado VALUES ('huella_historico', v_antes);

    -- G1. Cambiar precio y vigencia de la tarifa YA USADA está permitido para Dirección...
    v_r := pg_temp.actualizar(v_t, '45000', '2029-01-01', NULL, '30000.00', '2029-01-01', NULL);
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->>'importe' = '45000.00',
        'G1: Dirección corrige el importe de una tarifa ya facturada (' || v_r || ')');
    v_r := pg_temp.cambiar('CUOTA', 2, NULL, NULL, '50000', '2029-09-01', NULL);
    PERFORM pg_temp.afirmar(pg_temp.j(v_r)->'anterior'->>'hasta' = '2029-08-31',
        'G1: y abre una sucesión que cierra su vigencia el 31/08');

    -- G2. ...pero lo facturado no cambia: ítem, total, estado, pago e imputación.
    PERFORM pg_temp.afirmar(
        pg_temp.huella_historico()
        = (SELECT valor FROM ept103_estado WHERE clave = 'huella_historico'),
        'G2: facturas, ítems, pagos e imputaciones quedaron byte a byte idénticos tras editar y suceder la tarifa');
    PERFORM pg_temp.afirmar(
        (SELECT i.importe FROM public.items_factura i WHERE i.id = pg_temp.u(901)) = 30000.00
        AND (SELECT f.total FROM public.facturas f WHERE f.id = pg_temp.u(801)) = 30000.00
        AND (SELECT i.estado_pago::TEXT FROM public.items_factura i WHERE i.id = pg_temp.u(901)) = 'PENDIENTE',
        'G2: el ítem sigue en 30000.00 (lo facturado) aunque la tarifa hoy diga 45000.00; total y estado intactos');
    PERFORM pg_temp.afirmar((SELECT importe FROM public.tarifas WHERE id = v_t) = 45000.00,
        'G2: y la tarifa sí refleja el nuevo precio');

    -- G3. La identidad económica referenciada sigue protegida (P6804): ni el propietario la cambia.
    BEGIN
        UPDATE public.tarifas SET nivel_id = 1 WHERE id = v_t;
        RAISE EXCEPTION 'FALLO G3: se cambió la referencia de una tarifa facturada';
    EXCEPTION WHEN SQLSTATE 'P6804' THEN
        PERFORM pg_temp.afirmar(TRUE, 'G3: cambiar la referencia de una tarifa facturada -> P6804');
    END;
    BEGIN
        UPDATE public.tarifas SET concepto = 'DEPORTE' WHERE id = v_t;
        RAISE EXCEPTION 'FALLO G3: se cambió el concepto de una tarifa facturada';
    EXCEPTION WHEN SQLSTATE 'P6804' THEN
        PERFORM pg_temp.afirmar(TRUE, 'G3: cambiar el concepto de una tarifa facturada -> P6804');
    WHEN check_violation THEN
        PERFORM pg_temp.afirmar(TRUE, 'G3: cambiar el concepto también es rechazado (CHECK de coherencia)');
    END;

    -- G4. Ni siquiera el DIRECTOR toca facturas ni ítems por la API: no hay escritura directa.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated',
            'WITH x AS (UPDATE public.items_factura SET importe = 1 RETURNING 1) SELECT count(*)::TEXT FROM x') = 'E42501',
        'G4: el DIRECTOR no actualiza ítems por escritura directa (42501)');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated',
            'WITH x AS (UPDATE public.facturas SET total = 1 RETURNING 1) SELECT count(*)::TEXT FROM x') = 'E42501',
        'G4: ni facturas');
END;
$$;


-- ================================================================
-- H. AUTORIDAD: MATRIZ DE ACTORES
-- ================================================================
CREATE FUNCTION pg_temp.operar(p_sub UUID, p_rol TEXT, p_op TEXT, p_claims JSONB DEFAULT '{}'::JSONB,
                               p_fecha TEXT DEFAULT '2090-01-01')
RETURNS TEXT
LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sub, p_rol,
        CASE p_op
            WHEN 'crear' THEN
                pg_catalog.format('SELECT public.crear_tarifa(''DEPORTE'', NULL, ''e0000000-0000-4000-8000-000000000105''::UUID, NULL, ''1'', %L::DATE, %L::DATE)::TEXT', p_fecha, p_fecha)
            WHEN 'cambiar' THEN
                pg_catalog.format('SELECT public.cambiar_tarifa(''DEPORTE'', NULL, ''e0000000-0000-4000-8000-000000000105''::UUID, NULL, ''1'', %L::DATE, NULL)::TEXT', p_fecha)
            ELSE
                pg_catalog.format('SELECT public.actualizar_tarifa(%L::UUID, ''7'', ''2029-07-01''::DATE, NULL, ''36000'', ''2029-07-01''::DATE, NULL)::TEXT',
                    (SELECT valor FROM ept103_estado WHERE clave = 'nueva_nivel_1'))
        END, p_claims);
$$;

DO $$
DECLARE
    v_op TEXT;
    v_actor RECORD;
    v_antes TEXT := pg_temp.huella('TRUE');
BEGIN
    FOREACH v_op IN ARRAY ARRAY['crear', 'cambiar', 'actualizar'] LOOP
        FOR v_actor IN
            SELECT * FROM (VALUES
                ('PADRE',            pg_temp.u(5),    'authenticated', 'E42501'),
                ('ESTUDIANTE',       pg_temp.u(2),    'authenticated', 'E42501'),
                ('DOCENTE',          pg_temp.u(4),    'authenticated', 'E42501'),
                ('PERSONAL',         pg_temp.u(8),    'authenticated', 'E42501'),
                ('sin perfil',       pg_temp.u(10),   'authenticated', 'E42501'),
                ('sub desconocido',  pg_temp.u(7777), 'authenticated', 'E42501'),
                ('sin identidad',    NULL::UUID,      'authenticated', 'EP5505'),
                ('anon',             NULL::UUID,      'anon',          'E42501'),
                ('anon con sub',     pg_temp.u(1),    'anon',          'E42501'),
                ('service_role',     pg_temp.u(1),    'service_role',  'E42501')
            ) AS a(etiqueta, sub, rol, esperado)
        LOOP
            PERFORM pg_temp.afirmar(pg_temp.operar(v_actor.sub, v_actor.rol, v_op) = v_actor.esperado,
                pg_catalog.format('H1: %s por %s -> %s', v_actor.etiqueta, v_op, v_actor.esperado));
        END LOOP;
    END LOOP;

    PERFORM pg_temp.afirmar(pg_temp.huella('TRUE') = v_antes,
        'H2: ninguna denegación dejó rastro en tarifas');

    -- H3. La contraparte: el DIRECTOR habilitado sí puede (la matriz no es «todos fallan»).
    PERFORM pg_temp.afirmar(pg_temp.j(pg_temp.operar(pg_temp.u(1), 'authenticated', 'crear')) IS NOT NULL,
        'H3: el DIRECTOR habilitado crea');
    PERFORM pg_temp.afirmar(pg_temp.j(pg_temp.operar(pg_temp.u(1), 'authenticated', 'actualizar')) IS NOT NULL,
        'H3: el DIRECTOR habilitado actualiza (valores previos correctos)');

    -- H4. Escritura directa cerrada para todos, también para el DIRECTOR.
    FOR v_actor IN
        SELECT * FROM (VALUES
            ('DIRECTOR', pg_temp.u(1), 'authenticated'),
            ('PADRE',    pg_temp.u(5), 'authenticated'),
            ('anon',     NULL::UUID,   'anon')
        ) AS a(etiqueta, sub, rol)
    LOOP
        PERFORM pg_temp.afirmar(
            pg_temp.como(v_actor.sub, v_actor.rol,
                'WITH x AS (INSERT INTO public.tarifas (concepto, nivel_id, importe, desde) VALUES (''CUOTA'', 1, 1, ''2095-01-01'') RETURNING 1) SELECT count(*)::TEXT FROM x') = 'E42501',
            'H4: ' || v_actor.etiqueta || ' no inserta directo en tarifas (42501)');
        PERFORM pg_temp.afirmar(
            pg_temp.como(v_actor.sub, v_actor.rol,
                'WITH x AS (UPDATE public.tarifas SET importe = 1 RETURNING 1) SELECT count(*)::TEXT FROM x') = 'E42501',
            'H4: ' || v_actor.etiqueta || ' no actualiza directo (42501)');
        PERFORM pg_temp.afirmar(
            pg_temp.como(v_actor.sub, v_actor.rol,
                'WITH x AS (DELETE FROM public.tarifas RETURNING 1) SELECT count(*)::TEXT FROM x') = 'E42501',
            'H4: ' || v_actor.etiqueta || ' no borra directo (42501)');
        PERFORM pg_temp.afirmar(
            pg_temp.como(v_actor.sub, v_actor.rol, 'TRUNCATE public.tarifas') = 'E42501',
            'H4: ' || v_actor.etiqueta || ' no hace TRUNCATE (42501)');
    END LOOP;

    -- H5. Las implementaciones privadas tampoco son una puerta lateral para anon.
    PERFORM pg_temp.afirmar(
        pg_temp.como(NULL, 'anon',
            'SELECT app_private.crear_tarifa(''DEPORTE'', NULL, ''e0000000-0000-4000-8000-000000000101''::UUID, NULL, ''1'', ''2091-01-01''::DATE, NULL)::TEXT') = 'E42501',
        'H5: anon no ejecuta app_private.crear_tarifa (42501)');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated',
            'SELECT app_private.crear_tarifa(''DEPORTE'', NULL, ''e0000000-0000-4000-8000-000000000101''::UUID, NULL, ''1'', ''2091-01-01''::DATE, NULL)::TEXT') = 'E42501',
        'H5: y un PADRE que la invocara directo recibe la denegación de la propia función (42501)');

    -- H6. Lectura: solo el DIRECTOR ve el catálogo de tarifas (EPT-101 intacto).
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'SELECT pg_catalog.count(*)::TEXT FROM public.tarifas') = '0'
        AND pg_temp.como(pg_temp.u(1), 'authenticated', 'SELECT pg_catalog.count(*)::TEXT FROM public.tarifas')::BIGINT > 0,
        'H6: el PADRE lee 0 tarifas; el DIRECTOR lee todas');
END;
$$;


-- ================================================================
-- I. SESIÓN: JWT PREVIO AL BLOQUEO O AL CAMBIO DE ROL, METADATA FALSIFICADA
-- ================================================================
DO $$
DECLARE
    v_op TEXT;
    v_antes TEXT;
BEGIN
    -- I1. El mismo JWT del DIRECTOR (identidad 11) funciona antes del bloqueo...
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.operar(pg_temp.u(11), 'authenticated', 'crear', '{}'::JSONB, '2090-02-01')) IS NOT NULL,
        'I1: antes del bloqueo, el DIRECTOR 11 crea con su JWT');
    -- ...y deja de funcionar apenas el perfil se bloquea, sin renovar el JWT.
    UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(11);
    v_antes := pg_temp.huella('TRUE');
    FOREACH v_op IN ARRAY ARRAY['crear', 'cambiar', 'actualizar'] LOOP
        PERFORM pg_temp.afirmar(pg_temp.operar(pg_temp.u(11), 'authenticated', v_op) = 'E42501',
            'I1: con el MISMO JWT y el perfil bloqueado, ' || v_op || ' -> 42501');
    END LOOP;
    PERFORM pg_temp.afirmar(pg_temp.huella('TRUE') = v_antes, 'I1: el bloqueado no escribió nada');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(11), 'authenticated', 'SELECT pg_catalog.count(*)::TEXT FROM public.tarifas') = '0',
        'I1: ni siquiera lee las tarifas');
    UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u(11);

    -- I2. Cambio de rol posterior al JWT (identidad 12): el rol vigente en la base manda.
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.operar(pg_temp.u(12), 'authenticated', 'crear', '{}'::JSONB, '2090-03-01')) IS NOT NULL,
        'I2: antes del cambio de rol, la identidad 12 (DIRECTOR) crea');
    UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
    WHERE id = pg_temp.u(12);
    FOREACH v_op IN ARRAY ARRAY['crear', 'cambiar', 'actualizar'] LOOP
        PERFORM pg_temp.afirmar(pg_temp.operar(pg_temp.u(12), 'authenticated', v_op) = 'E42501',
            'I2: con el rol cambiado a PERSONAL (mismo JWT), ' || v_op || ' -> 42501');
    END LOOP;
    UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR')
    WHERE id = pg_temp.u(12);
    PERFORM pg_temp.afirmar(
        pg_temp.j(pg_temp.operar(pg_temp.u(12), 'authenticated', 'crear', '{}'::JSONB, '2090-04-01')) IS NOT NULL,
        'I2: restituido el rol, vuelve a poder (la denegación venía del rol vigente, no del JWT)');

    -- I3. Metadata falsificada en el JWT: ni user_metadata ni app_metadata dan autoridad.
    FOREACH v_op IN ARRAY ARRAY['crear', 'cambiar', 'actualizar'] LOOP
        PERFORM pg_temp.afirmar(
            pg_temp.operar(pg_temp.u(5), 'authenticated', v_op,
                '{"user_metadata": {"rol": "DIRECTOR", "role": "DIRECTOR"}, "app_metadata": {"rol": "DIRECTOR", "role": "DIRECTOR"}}'::JSONB) = 'E42501',
            'I3: un PADRE con metadata DIRECTOR no puede ' || v_op);
        PERFORM pg_temp.afirmar(
            pg_temp.operar(pg_temp.u(10), 'authenticated', v_op,
                '{"user_metadata": {"rol": "DIRECTOR"}, "app_metadata": {"rol": "DIRECTOR"}}'::JSONB) = 'E42501',
            'I3: un sujeto sin perfil con metadata DIRECTOR no puede ' || v_op);
        PERFORM pg_temp.afirmar(
            pg_temp.operar(pg_temp.u(5), 'authenticated', v_op, '{"role": "service_role"}'::JSONB) = 'E42501',
            'I3: un claim role=service_role no cambia el rol efectivo: ' || v_op);
    END LOOP;

    -- I4. La identidad no viaja en los parámetros: ninguna operación tiene un parámetro de actor.
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.bool_and(p.pronargs = 7)
         FROM pg_catalog.pg_proc p
         WHERE p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa')),
        'I4: las firmas son exactamente las documentadas (siete parámetros de negocio, ninguno de identidad)');
END;
$$;


-- ================================================================
-- J. REVERSIÓN NO DESTRUCTIVA
-- ================================================================
DO $$
DECLARE
    v_antes TEXT := pg_temp.huella('TRUE');
    v_policies TEXT := (SELECT pg_catalog.string_agg(policyname || cmd, ',' ORDER BY policyname)
                        FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'tarifas');
    v_n BIGINT;
BEGIN
    DROP FUNCTION public.crear_tarifa(text, integer, uuid, uuid, text, date, date);
    DROP FUNCTION public.cambiar_tarifa(text, integer, uuid, uuid, text, date, date);
    DROP FUNCTION public.actualizar_tarifa(uuid, text, date, date, text, date, date);
    DROP FUNCTION app_private.crear_tarifa(text, integer, uuid, uuid, text, date, date);
    DROP FUNCTION app_private.cambiar_tarifa(text, integer, uuid, uuid, text, date, date);
    DROP FUNCTION app_private.actualizar_tarifa(uuid, text, date, date, text, date, date);
    DROP FUNCTION app_private.tarifa_a_json(public.tarifas);
    DROP FUNCTION app_private.bloquear_referencia_tarifa(public.concepto_economico, integer, uuid, uuid);
    DROP FUNCTION app_private.referencia_tarifa_valida(text, integer, uuid, uuid);
    DROP FUNCTION app_private.vigencia_tarifa_valida(date, date);
    DROP FUNCTION app_private.importe_tarifa_valido(text);
    DROP FUNCTION app_private.exigir_director_tarifas();

    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa', 'tarifa_a_json',
                        'bloquear_referencia_tarifa', 'referencia_tarifa_valida',
                        'vigencia_tarifa_valida', 'importe_tarifa_valido',
                        'exigir_director_tarifas');
    PERFORM pg_temp.afirmar(v_n = 0, 'J1: las doce funciones se sueltan y no queda ninguna');
    PERFORM pg_temp.afirmar(pg_temp.huella('TRUE') = v_antes, 'J1: ninguna fila de tarifas cambió al revertir');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.tarifas'::pg_catalog.regclass AND NOT t.tgisinternal) = 2
        AND (SELECT pg_catalog.string_agg(policyname || cmd, ',' ORDER BY policyname)
             FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'tarifas') = v_policies,
        'J1: triggers y políticas de tarifas intactos; la tabla sigue cerrada a la escritura directa');
END;
$$;

\o
ROLLBACK;
