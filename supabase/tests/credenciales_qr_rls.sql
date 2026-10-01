-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de la credencial QR (EPT-64, RF20)
-- ============================================================
-- Verifica la migración 20260929224534_ept_64_credencial_qr.sql.
--
-- Ejecutar exclusivamente contra la base local descartable. Todo ocurre dentro
-- de una transacción con ROLLBACK: no deja datos residuales.
--
--     docker cp supabase/tests/credenciales_qr_rls.sql \
--       supabase_db_ept64:/tmp/
--     docker exec supabase_db_ept64 \
--       psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f /tmp/credenciales_qr_rls.sql
--
-- (En Git Bash exportar MSYS_NO_PATHCONV=1 antes de docker cp/exec.)
--
-- Cada comprobación imprime `OK <código>` o aborta con `FALLO <código>`.
--
--   Mapa de secciones
--     A. estructura: privilegios de tabla, de columna y de función; RLS; bloqueo
--     B. emisión: Dirección habilitada sí; el resto no; una sola ACTIVA
--     C. lectura por actor y por fila (propio, hijo vinculado y desvinculado)
--     D. escritura directa: ningún rol de aplicación ni el propietario
--     E. reposición y revocación: atomicidad, historial, credencial obsoleta
--     F. validez efectiva: inactivar, reactivar, bloquear, revocar
--     G. historial y datos internos
--     H. cambio de curso, DNI y legajo no toca las credenciales
--     R. reversión documentada
--
-- Todos los datos son sintéticos: DNI en un rango libre elegido en tiempo de
-- ejecución, sin correspondencia con ninguna persona real.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- 0. HERRAMIENTAS
-- ================================================================
CREATE FUNCTION pg_temp.u(p_sufijo TEXT)
RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('ea640000-0000-4000-8000-0000000000' || p_sufijo)::UUID;
$$;

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
        RESET ROLE;
        PERFORM pg_catalog.set_config('request.jwt.claims', '{}', true);
        v := 'E:' || SQLSTATE;
    END;
    RETURN v;
END;
$$;

-- Ejecuta como el propietario (postgres) y devuelve OK:<valor> o E:<SQLSTATE>.
CREATE FUNCTION pg_temp.propietario(p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql INTO v;
        v := 'OK:' || COALESCE(v, '<NULL>');
    EXCEPTION WHEN OTHERS THEN
        v := 'E:' || SQLSTATE;
    END;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.esperar(p_resultado TEXT, p_esperado TEXT, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado = 'E:42P17' THEN
        RAISE EXCEPTION 'FALLO % → recursión de políticas (42P17)', p_mensaje;
    END IF;
    IF (p_esperado = 'OK' AND p_resultado NOT LIKE 'OK%')
       OR (p_esperado <> 'OK' AND p_resultado IS DISTINCT FROM 'E:' || p_esperado) THEN
        RAISE EXCEPTION 'FALLO % → se obtuvo %, se esperaba %', p_mensaje, p_resultado, p_esperado;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

CREATE FUNCTION pg_temp.exigir(p_condicion BOOLEAN, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_condicion IS NOT TRUE THEN
        RAISE EXCEPTION 'FALLO %', p_mensaje;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

CREATE FUNCTION pg_temp.valor(p_resultado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado NOT LIKE 'OK:%' THEN
        RAISE EXCEPTION 'FALLO se esperaba éxito y se obtuvo %', p_resultado;
    END IF;
    RETURN pg_catalog.substr(p_resultado, 4);
END;
$$;

CREATE FUNCTION pg_temp.esperar_valor(p_resultado TEXT, p_esperado TEXT, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado IS DISTINCT FROM 'OK:' || p_esperado THEN
        RAISE EXCEPTION 'FALLO % → se obtuvo %, se esperaba OK:%', p_mensaje, p_resultado, p_esperado;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

CREATE TEMPORARY TABLE fx (clave TEXT PRIMARY KEY, valor TEXT NOT NULL) ON COMMIT DROP;

CREATE FUNCTION pg_temp.fx(p_clave TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT valor FROM fx WHERE clave = p_clave;
$$;

CREATE FUNCTION pg_temp.guardar(p_clave TEXT, p_valor TEXT)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO fx (clave, valor) VALUES (p_clave, p_valor)
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
$$;

CREATE FUNCTION pg_temp.dir(p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u('01'), p_sql);
$$;

CREATE FUNCTION pg_temp.como(p_sufijo TEXT, p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u(p_sufijo), p_sql);
$$;

-- Recuento de filas de credenciales visibles para una identidad.
CREATE FUNCTION pg_temp.visibles(p_sufijo TEXT, p_alumno UUID)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.como(p_sufijo, pg_catalog.format(
        'SELECT pg_catalog.count(*)::TEXT FROM public.credenciales_qr WHERE alumno_id = %L', p_alumno));
$$;

-- Cantidad de credenciales ACTIVAS de un alumno, vistas como propietario.
CREATE FUNCTION pg_temp.activas(p_alumno UUID)
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = p_alumno AND estado = 'ACTIVA';
$$;

CREATE FUNCTION pg_temp.validez(p_credencial UUID)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.dir(pg_catalog.format(
        'SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', p_credencial));
$$;


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
WITH base_libre AS (
    SELECT base
    FROM generate_series(94000000, 94999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 20) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(sufijo, rol, nombre, apellido, legajo, desplazamiento, estado_acceso) AS (
    VALUES
        ('01', 'DIRECTOR',   'Directora', 'Emisora Uno',      NULL,             1, 'HABILITADO'),
        ('02', 'DIRECTOR',   'Directora', 'Bloqueada',        NULL,             2, 'BLOQUEADO'),
        ('03', 'DOCENTE',    'Ana',       'Docente',          NULL,             3, 'HABILITADO'),
        ('04', 'PADRE',      'Pablo',     'Padre Vinculado',  NULL,             4, 'HABILITADO'),
        ('05', 'PADRE',      'Perla',     'Padre Ajeno',      NULL,             5, 'HABILITADO'),
        ('06', 'PERSONAL',   'Paula',     'Personal',         NULL,             6, 'HABILITADO'),
        ('07', 'ESTUDIANTE', 'Uno',       'Alumna A',         'LEG-EPT64-0007', 7, 'HABILITADO'),
        ('08', 'ESTUDIANTE', 'Dos',       'Alumno B',         'LEG-EPT64-0008', 8, 'HABILITADO'),
        ('09', 'ESTUDIANTE', 'Tres',      'Alumno Bloqueado', 'LEG-EPT64-0009', 9, 'BLOQUEADO'),
        ('0a', 'ESTUDIANTE', 'Cuatro',    'Alumna Inactiva',  'LEG-EPT64-000A', 10, 'HABILITADO'),
        ('0b', 'PADRE',      'Pedro',     'Padre Bloqueado',  NULL,             11, 'BLOQUEADO'),
        ('0e', 'ESTUDIANTE', 'Seis',      'Alumna Ciclo',     'LEG-EPT64-000E', 12, 'HABILITADO')
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro, estado_acceso)
SELECT pg_temp.u(i.sufijo), pg_temp.u(i.sufijo), r.id, i.nombre, i.apellido,
       (b.base + i.desplazamiento)::TEXT, i.legajo, i.estado_acceso::public.estado_acceso
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- La cuenta autenticada sin perfil es `…0c`: no tiene fila en perfiles.

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u('c1'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT64 A', 'A', TRUE),
       (pg_temp.u('c2'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT64 B', 'B', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES (pg_temp.u('07'), pg_temp.u('c1')),
       (pg_temp.u('08'), pg_temp.u('c1')),
       (pg_temp.u('09'), pg_temp.u('c1')),
       (pg_temp.u('0e'), pg_temp.u('c1'));

-- La alumna 0a queda INACTIVA (sin matrícula), como nace.
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (pg_temp.u('07'), pg_temp.u('08'), pg_temp.u('09'), pg_temp.u('0e'));

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Vínculos familiares: Pablo (04) y Pedro bloqueado (0b) son padres de la alumna 07.
INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES (pg_temp.u('04'), pg_temp.u('07')),
       (pg_temp.u('0b'), pg_temp.u('07'));


-- ================================================================
-- A. ESTRUCTURA
-- ================================================================
SELECT pg_temp.exigir(
    (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
     WHERE c.oid = 'public.credenciales_qr'::pg_catalog.regclass),
    '[A1] RLS activa en credenciales_qr');

SELECT pg_temp.exigir(
    NOT pg_catalog.has_table_privilege('anon', 'public.credenciales_qr', 'SELECT')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.credenciales_qr', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.credenciales_qr', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.credenciales_qr', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.credenciales_qr', 'TRUNCATE'),
    '[A2] anon no tiene ningún privilegio de tabla');

SELECT pg_temp.exigir(
    NOT pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'TRUNCATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'REFERENCES')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'TRIGGER'),
    '[A3] authenticated no escribe la tabla');

SELECT pg_temp.exigir(
    NOT pg_catalog.has_table_privilege('service_role', 'public.credenciales_qr', 'SELECT')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.credenciales_qr', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.credenciales_qr', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.credenciales_qr', 'DELETE'),
    '[A4] service_role tampoco tiene atajo hacia la tabla');

SELECT pg_temp.exigir(
    NOT pg_catalog.has_column_privilege('authenticated', 'public.credenciales_qr', 'emitida_por', 'SELECT')
    AND NOT pg_catalog.has_column_privilege('authenticated', 'public.credenciales_qr', 'revocada_por', 'SELECT')
    AND NOT pg_catalog.has_column_privilege('authenticated', 'public.credenciales_qr', 'motivo_revocacion', 'SELECT')
    AND NOT pg_catalog.has_column_privilege('authenticated', 'public.credenciales_qr', 'reemplaza_a', 'SELECT')
    AND pg_catalog.has_column_privilege('authenticated', 'public.credenciales_qr', 'estado', 'SELECT'),
    '[A5] los datos internos no son legibles por columna');

SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename = 'credenciales_qr'
       AND policyname = 'Bloqueo de acceso sin datos protegidos' AND permissive = 'RESTRICTIVE') = 1
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                    WHERE schemaname = 'public' AND tablename = 'credenciales_qr'
                      AND cmd <> 'SELECT' AND permissive = 'PERMISSIVE'),
    '[A6] política RESTRICTIVE de bloqueo de cuenta y ninguna política permisiva de escritura');

SELECT pg_temp.exigir(
    NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.credenciales_qr'::pg_catalog.regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attname IN ('mac', 'payload', 'firma', 'secreto', 'token', 'clave', 'nombre', 'apellido', 'dni', 'legajo')),
    '[A7] la tabla no guarda MAC, payload, clave ni datos personales del alumno');

SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_indexes
     WHERE schemaname = 'public' AND tablename = 'credenciales_qr'
       AND indexname = 'idx_credenciales_qr_una_activa_por_alumno'
       AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%ACTIVA%') = 1,
    '[A8] índice único parcial: una sola ACTIVA por alumno');

DO $$
DECLARE
    v_firma pg_catalog.regprocedure;
BEGIN
    FOREACH v_firma IN ARRAY ARRAY[
        'public.emitir_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'public.reponer_credencial_qr(uuid,text,text)'::pg_catalog.regprocedure,
        'public.revocar_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'public.historial_credenciales_qr(uuid)'::pg_catalog.regprocedure,
        'public.consultar_validez_credencial_qr(uuid)'::pg_catalog.regprocedure,
        'app_private.emitir_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'app_private.reponer_credencial_qr(uuid,text,text)'::pg_catalog.regprocedure,
        'app_private.revocar_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'app_private.historial_credenciales_qr(uuid)'::pg_catalog.regprocedure,
        'app_private.consultar_validez_credencial_qr(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO [A9] privilegios de ejecución inesperados en %', v_firma;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK [A9] cinco operaciones: authenticated sí; anon y service_role no';
END $$;


-- ================================================================
-- B. EMISIÓN
-- ================================================================
-- B1. Quien no es Dirección habilitada no emite; el resto de datos ni se mira.
SELECT pg_temp.esperar(pg_temp.como('02', pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    '42501', '[B1] Dirección BLOQUEADA no emite');
SELECT pg_temp.esperar(pg_temp.como('03', pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    '42501', '[B2] docente no emite');
SELECT pg_temp.esperar(pg_temp.como('06', pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    '42501', '[B3] PERSONAL no emite');
SELECT pg_temp.esperar(pg_temp.como('04', pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    '42501', '[B4] padre vinculado no emite');
SELECT pg_temp.esperar(pg_temp.como('07', pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    '42501', '[B5] el propio alumno no se emite su credencial');
SELECT pg_temp.esperar(pg_temp.como('0c', pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    '42501', '[B6] cuenta sin perfil no emite');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    '42501', '[B7] anónimo no puede ni ejecutar la función');
SELECT pg_temp.esperar(pg_temp.ejecutar('authenticated', NULL, pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    'P5505', '[B8] sin identidad en el token → P5505');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('07')) = 0, '[B9] las denegaciones no crearon nada');

-- B10. Dirección habilitada emite; la fila queda con el actor de la sesión.
SELECT pg_temp.guardar('cred_07_a', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.emitir_credencial_qr(%L, ''k1'')).id::TEXT', pg_temp.u('07')))));
SELECT pg_temp.exigir(
    (SELECT c.estado = 'ACTIVA' AND c.emitida_por = pg_temp.u('01') AND c.clave_kid = 'k1'
            AND c.revocada_en IS NULL AND c.motivo_revocacion IS NULL AND c.reemplaza_a IS NULL
     FROM public.credenciales_qr c WHERE c.id = pg_temp.fx('cred_07_a')::UUID),
    '[B10] emisión: ACTIVA, emitida por la Dirección de la sesión, sin datos de revocación');

-- B11. Segunda emisión: rechazada, sigue habiendo una sola ACTIVA.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('07'))),
    'P5621', '[B11] segunda emisión → P5621');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('07')) = 1, '[B12] sigue habiendo exactamente una ACTIVA');

-- B13. Validaciones.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, NULL)', pg_temp.u('08'))),
    'P5625', '[B13] kid ausente');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''K1'')', pg_temp.u('08'))),
    'P5625', '[B14] kid en mayúsculas');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k.1'')', pg_temp.u('08'))),
    'P5625', '[B15] kid con separador');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, %L)', pg_temp.u('08'), repeat('a', 17))),
    'P5625', '[B16] kid demasiado largo');
SELECT pg_temp.esperar(pg_temp.dir('SELECT public.emitir_credencial_qr(''00000000-0000-4000-8000-000000000000'', ''k1'')'),
    'P5620', '[B17] alumno inexistente');
SELECT pg_temp.esperar(pg_temp.dir('SELECT public.emitir_credencial_qr(NULL, ''k1'')'),
    'P5620', '[B18] alumno nulo');
-- Un perfil que no es alumno (docente) tampoco tiene fila en alumnos.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('03'))),
    'P5620', '[B19] un perfil que no es alumno no recibe credencial');

-- B20. Se emiten las demás credenciales del escenario (incluida la de un alumno
-- con acceso bloqueado, que sí es emisible: el bloqueo se evalúa al verificar).
SELECT pg_temp.guardar('cred_08', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.emitir_credencial_qr(%L, ''k1'')).id::TEXT', pg_temp.u('08')))));
SELECT pg_temp.guardar('cred_09', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.emitir_credencial_qr(%L, ''k1'')).id::TEXT', pg_temp.u('09')))));
SELECT pg_temp.guardar('cred_0e', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.emitir_credencial_qr(%L, ''k1'')).id::TEXT', pg_temp.u('0e')))));
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('08')) = 1 AND pg_temp.activas(pg_temp.u('09')) = 1
                      AND pg_temp.activas(pg_temp.u('0e')) = 1,
    '[B20] emisión para alumnos activos con legajo (incluye uno con acceso bloqueado)');

-- B21. Contrato: no se emite a un alumno INACTIVO (la alumna 0a nace inactiva).
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('0a'))),
    'P5627', '[B21] un alumno inactivo no recibe credencial (P5627)');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('0a')) = 0
    AND (SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = pg_temp.u('0a')) = 0,
    '[B22] el rechazo no dejó ninguna fila');


-- ================================================================
-- C. LECTURA POR ACTOR Y POR FILA
-- ================================================================
SELECT pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
    'SELECT pg_catalog.count(*)::TEXT FROM public.credenciales_qr WHERE alumno_id = %L', pg_temp.u('07'))),
    '1', '[C1] Dirección habilitada lee las credenciales');
SELECT pg_temp.esperar_valor(pg_temp.visibles('07', pg_temp.u('07')), '1', '[C2] el alumno lee la propia');
SELECT pg_temp.esperar_valor(pg_temp.visibles('07', pg_temp.u('08')), '0', '[C3] el alumno no lee la de otro alumno');
SELECT pg_temp.esperar_valor(pg_temp.visibles('08', pg_temp.u('07')), '0', '[C4] otro alumno no lee la ajena');
SELECT pg_temp.esperar_valor(pg_temp.visibles('04', pg_temp.u('07')), '1', '[C5] el padre vinculado lee la del hijo');
SELECT pg_temp.esperar_valor(pg_temp.visibles('04', pg_temp.u('08')), '0', '[C6] el padre no lee la de un no hijo');
SELECT pg_temp.esperar_valor(pg_temp.visibles('05', pg_temp.u('07')), '0', '[C7] el padre NO vinculado no lee nada');
SELECT pg_temp.esperar_valor(pg_temp.visibles('03', pg_temp.u('07')), '0', '[C8] el docente no lee nada');
SELECT pg_temp.esperar_valor(pg_temp.visibles('06', pg_temp.u('07')), '0', '[C9] PERSONAL no lee nada');
SELECT pg_temp.esperar_valor(pg_temp.visibles('0c', pg_temp.u('07')), '0', '[C10] cuenta sin perfil no lee nada');
SELECT pg_temp.esperar_valor(pg_temp.visibles('02', pg_temp.u('07')), '0', '[C11] Dirección BLOQUEADA no lee nada');
SELECT pg_temp.esperar_valor(pg_temp.visibles('09', pg_temp.u('09')), '0', '[C12] el alumno BLOQUEADO no lee ni la propia');
SELECT pg_temp.esperar_valor(pg_temp.visibles('0b', pg_temp.u('07')), '0', '[C13] el padre BLOQUEADO vinculado no lee nada');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, 'SELECT pg_catalog.count(*)::TEXT FROM public.credenciales_qr'),
    '42501', '[C14] anónimo no tiene ni el privilegio de leer');

-- C15. Desvincular quita el acceso del padre de inmediato; revincular lo devuelve.
DELETE FROM public.padres_hijos WHERE padre_id = pg_temp.u('04') AND hijo_id = pg_temp.u('07');
SELECT pg_temp.esperar_valor(pg_temp.visibles('04', pg_temp.u('07')), '0', '[C15] padre DESVINCULADO deja de leer');
INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES (pg_temp.u('04'), pg_temp.u('07'));
SELECT pg_temp.esperar_valor(pg_temp.visibles('04', pg_temp.u('07')), '1', '[C16] al revincular vuelve a leer');

-- C17. Los datos internos no se leen por la tabla ni siquiera con Dirección.
SELECT pg_temp.esperar(pg_temp.dir('SELECT motivo_revocacion FROM public.credenciales_qr LIMIT 1'),
    '42501', '[C17] Dirección no lee motivo_revocacion por la tabla');
SELECT pg_temp.esperar(pg_temp.dir('SELECT emitida_por FROM public.credenciales_qr LIMIT 1'),
    '42501', '[C18] Dirección no lee emitida_por por la tabla');
SELECT pg_temp.esperar(pg_temp.como('07', 'SELECT revocada_por FROM public.credenciales_qr LIMIT 1'),
    '42501', '[C19] el alumno no lee revocada_por');
SELECT pg_temp.esperar(pg_temp.como('07', 'SELECT * FROM public.credenciales_qr LIMIT 1'),
    '42501', '[C20] un select * falla: las lecturas nombran sus columnas');
SELECT pg_temp.esperar(pg_temp.como('07', 'SELECT id, alumno_id, estado, clave_kid, emitida_en, revocada_en FROM public.credenciales_qr LIMIT 1'),
    'OK', '[C21] las columnas públicas sí se leen');


-- ================================================================
-- D. ESCRITURA DIRECTA
-- ================================================================
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por) VALUES (%L, ''k1'', %L)',
    pg_temp.u('08'), pg_temp.u('01'))), '42501', '[D1] Dirección no inserta por la tabla');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'UPDATE public.credenciales_qr SET estado = ''REVOCADA'' WHERE id = %L', pg_temp.fx('cred_08'))),
    '42501', '[D2] Dirección no revoca con UPDATE directo');
SELECT pg_temp.esperar(pg_temp.dir('DELETE FROM public.credenciales_qr'), '42501', '[D3] Dirección no borra');
SELECT pg_temp.esperar(pg_temp.dir('TRUNCATE public.credenciales_qr'), '42501', '[D4] Dirección no trunca');
SELECT pg_temp.esperar(pg_temp.como('07', pg_catalog.format(
    'UPDATE public.credenciales_qr SET estado = ''REVOCADA'' WHERE id = %L', pg_temp.fx('cred_07_a'))),
    '42501', '[D5] el alumno no se revoca la propia');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, 'DELETE FROM public.credenciales_qr'),
    '42501', '[D6] anónimo no borra');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, 'TRUNCATE public.credenciales_qr'),
    '42501', '[D7] anónimo no trunca');
SELECT pg_temp.esperar(pg_temp.ejecutar('service_role', NULL, 'DELETE FROM public.credenciales_qr'),
    '42501', '[D8] service_role no borra');

-- D9..D16. Ni el propietario puede alterar el historial fuera de ACTIVA → REVOCADA.
SELECT pg_temp.esperar(pg_temp.propietario('DELETE FROM public.credenciales_qr'),
    'P5626', '[D9] el propietario tampoco borra');
-- Desde EPT-65 `accesos_servicios` referencia a `credenciales_qr`: un TRUNCATE sin
-- CASCADE ya lo rechaza PostgreSQL por la clave foránea (0A000) ANTES de llegar al
-- trigger. La guarda de EPT-64 se sigue probando con CASCADE, que sí la dispara.
SELECT pg_temp.esperar(pg_temp.propietario('TRUNCATE public.credenciales_qr'),
    '0A000', '[D10a] el propietario no trunca la tabla referenciada por los accesos (clave foránea)');
SELECT pg_temp.esperar(pg_temp.propietario('TRUNCATE public.credenciales_qr CASCADE'),
    'P5626', '[D10] el propietario tampoco trunca (ni con CASCADE: lo detiene la guarda)');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.credenciales_qr SET alumno_id = %L WHERE id = %L', pg_temp.u('08'), pg_temp.fx('cred_07_a'))),
    'P5626', '[D11] el alumno de una credencial es inmutable');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.credenciales_qr SET clave_kid = ''k2'' WHERE id = %L', pg_temp.fx('cred_07_a'))),
    'P5626', '[D12] el kid es inmutable');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.credenciales_qr SET id = gen_random_uuid() WHERE id = %L', pg_temp.fx('cred_07_a'))),
    'P5626', '[D13] el identificador es inmutable');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.credenciales_qr SET emitida_en = now() - interval ''1 day'' WHERE id = %L', pg_temp.fx('cred_07_a'))),
    'P5626', '[D14] la fecha de emisión es inmutable');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'INSERT INTO public.credenciales_qr (alumno_id, estado, clave_kid, emitida_por, revocada_en, revocada_por, motivo_revocacion) VALUES (%L, ''REVOCADA'', ''k1'', %L, now(), %L, ''nace revocada'')',
    pg_temp.u('08'), pg_temp.u('01'), pg_temp.u('01'))),
    'P5626', '[D15] una credencial no puede nacer revocada');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por) VALUES (%L, ''k1'', %L)',
    pg_temp.u('08'), pg_temp.u('01'))),
    '23505', '[D16] el índice único parcial rechaza una segunda ACTIVA aun para el propietario');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.credenciales_qr SET estado = ''REVOCADA'' WHERE id = %L', pg_temp.fx('cred_08'))),
    '23514', '[D17] revocar sin datos de revocación viola el CHECK de coherencia');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.credenciales_qr SET clave_kid = ''Mal Kid'' WHERE id = %L', pg_temp.fx('cred_08'))),
    'P5626', '[D18] el trigger rechaza antes que el CHECK cualquier cambio de kid');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('08')) = 1, '[D19] ninguna escritura directa alteró el estado');


-- ================================================================
-- E. REPOSICIÓN Y REVOCACIÓN
-- ================================================================
-- E1. Los no autorizados no reponen ni revocan.
SELECT pg_temp.esperar(pg_temp.como('03', pg_catalog.format('SELECT public.reponer_credencial_qr(%L, ''k1'', ''Extravío'')', pg_temp.fx('cred_07_a'))),
    '42501', '[E1] docente no repone');
SELECT pg_temp.esperar(pg_temp.como('06', pg_catalog.format('SELECT public.revocar_credencial_qr(%L, ''Baja'')', pg_temp.fx('cred_07_a'))),
    '42501', '[E2] PERSONAL no revoca');
SELECT pg_temp.esperar(pg_temp.como('04', pg_catalog.format('SELECT public.revocar_credencial_qr(%L, ''Baja'')', pg_temp.fx('cred_07_a'))),
    '42501', '[E3] padre no revoca');
SELECT pg_temp.esperar(pg_temp.como('02', pg_catalog.format('SELECT public.reponer_credencial_qr(%L, ''k1'', ''Extravío'')', pg_temp.fx('cred_07_a'))),
    '42501', '[E4] Dirección bloqueada no repone');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, pg_catalog.format('SELECT public.revocar_credencial_qr(%L, ''Baja'')', pg_temp.fx('cred_07_a'))),
    '42501', '[E5] anónimo no revoca');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('07')) = 1
    AND (SELECT c.estado = 'ACTIVA' FROM public.credenciales_qr c WHERE c.id = pg_temp.fx('cred_07_a')::UUID),
    '[E6] las denegaciones dejaron la credencial intacta');

-- E7. Validaciones.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reponer_credencial_qr(%L, ''k1'', ''ab'')', pg_temp.fx('cred_07_a'))),
    'P5624', '[E7] motivo demasiado corto');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reponer_credencial_qr(%L, ''k1'', %L)', pg_temp.fx('cred_07_a'), repeat('x', 201))),
    'P5624', '[E8] motivo demasiado largo');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reponer_credencial_qr(%L, ''k1'', ''    '')', pg_temp.fx('cred_07_a'))),
    'P5624', '[E9] motivo en blanco');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reponer_credencial_qr(%L, NULL, ''Extravío'')', pg_temp.fx('cred_07_a'))),
    'P5625', '[E10] kid ausente al reponer');
SELECT pg_temp.esperar(pg_temp.dir('SELECT public.reponer_credencial_qr(''00000000-0000-4000-8000-000000000000'', ''k1'', ''Extravío'')'),
    'P5622', '[E11] reponer una credencial inexistente');
SELECT pg_temp.esperar(pg_temp.dir('SELECT public.revocar_credencial_qr(''00000000-0000-4000-8000-000000000000'', ''Baja'')'),
    'P5622', '[E12] revocar una credencial inexistente');
SELECT pg_temp.esperar(pg_temp.dir('SELECT public.revocar_credencial_qr(NULL, ''Baja'')'),
    'P5622', '[E13] revocar con identificador nulo');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.revocar_credencial_qr(%L, ''  x '')', pg_temp.fx('cred_07_a'))),
    'P5624', '[E14] motivo de revocación inválido');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('07')) = 1, '[E15] los rechazos por datos no alteraron nada');

-- E16. Reponer: revoca la vigente y emite otra en la misma operación.
SELECT pg_temp.guardar('cred_07_b', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.reponer_credencial_qr(%L, ''k2'', ''  Extravío de la tarjeta  '')).id::TEXT', pg_temp.fx('cred_07_a')))));
SELECT pg_temp.exigir(
    pg_temp.activas(pg_temp.u('07')) = 1
    AND (SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = pg_temp.u('07')) = 2
    AND (SELECT c.estado = 'REVOCADA' AND c.motivo_revocacion = 'Extravío de la tarjeta'
                AND c.revocada_por = pg_temp.u('01') AND c.revocada_en IS NOT NULL
         FROM public.credenciales_qr c WHERE c.id = pg_temp.fx('cred_07_a')::UUID)
    AND (SELECT c.estado = 'ACTIVA' AND c.clave_kid = 'k2' AND c.reemplaza_a = pg_temp.fx('cred_07_a')::UUID
                AND c.emitida_por = pg_temp.u('01')
         FROM public.credenciales_qr c WHERE c.id = pg_temp.fx('cred_07_b')::UUID)
    AND pg_temp.fx('cred_07_a') <> pg_temp.fx('cred_07_b'),
    '[E16] reposición: la anterior queda revocada con su motivo, la nueva ACTIVA y enlazada, historial de 2 filas');

-- E17. Reponer con la credencial obsoleta NO revoca a la nueva.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reponer_credencial_qr(%L, ''k1'', ''Otra vez'')', pg_temp.fx('cred_07_a'))),
    'P5623', '[E17] reponer una credencial ya revocada → P5623');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.revocar_credencial_qr(%L, ''Otra vez'')', pg_temp.fx('cred_07_a'))),
    'P5623', '[E18] revocar una credencial ya revocada → P5623');
SELECT pg_temp.exigir(
    (SELECT c.estado = 'ACTIVA' FROM public.credenciales_qr c WHERE c.id = pg_temp.fx('cred_07_b')::UUID)
    AND pg_temp.activas(pg_temp.u('07')) = 1,
    '[E19] la credencial nueva quedó intacta y sigue habiendo una ACTIVA');

-- E20. Revocar: queda el historial; el alumno no tiene ACTIVA hasta una emisión nueva.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.revocar_credencial_qr(%L, ''Baja por egreso'')', pg_temp.fx('cred_07_b'))),
    'OK', '[E20] Dirección revoca la vigente');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('07')) = 0
    AND (SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = pg_temp.u('07')) = 2,
    '[E21] tras revocar no hay ACTIVA y el historial se conserva');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.revocar_credencial_qr(%L, ''Baja por egreso'')', pg_temp.fx('cred_07_b'))),
    'P5623', '[E22] revocar dos veces → P5623');

-- E23. Una revocada nunca vuelve a valer: no existe operación de restauración y
-- el UPDATE está cerrado.
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.credenciales_qr SET estado = ''ACTIVA'', revocada_en = NULL, revocada_por = NULL, motivo_revocacion = NULL WHERE id = %L',
    pg_temp.fx('cred_07_b'))), 'P5626', '[E23] una revocada no se restaura ni por el propietario');

-- E24. Tras revocar se puede emitir una NUEVA credencial (otra fila).
SELECT pg_temp.guardar('cred_07_c', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.emitir_credencial_qr(%L, ''k2'')).id::TEXT', pg_temp.u('07')))));
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('07')) = 1
    AND (SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = pg_temp.u('07')) = 3
    AND pg_temp.fx('cred_07_c') NOT IN (pg_temp.fx('cred_07_a'), pg_temp.fx('cred_07_b')),
    '[E24] tras revocar se emite una fila nueva; el historial crece a 3');

-- E25. El alumno ve su historial mínimo (estados) sin datos internos.
SELECT pg_temp.esperar_valor(pg_temp.visibles('07', pg_temp.u('07')), '3',
    '[E25] el alumno lee sus 3 filas (2 revocadas y 1 activa) sin datos internos');
SELECT pg_temp.esperar_valor(pg_temp.como('07',
    'SELECT pg_catalog.count(*)::TEXT FROM public.credenciales_qr WHERE estado = ''ACTIVA'''),
    '1', '[E26] el alumno distingue su credencial vigente');

-- E27. Tras la reposición del alumno 08, el padre vinculado a 07 no ve a 08.
SELECT pg_temp.guardar('cred_08_b', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.reponer_credencial_qr(%L, ''k1'', ''Reposición por deterioro'')).id::TEXT', pg_temp.fx('cred_08')))));
SELECT pg_temp.esperar_valor(pg_temp.visibles('04', pg_temp.u('08')), '0', '[E27] el padre sigue sin ver hijos ajenos');


-- ================================================================
-- F. VALIDEZ EFECTIVA
-- ================================================================
-- Quién puede consultarla: solo Dirección habilitada (la barrera criptográfica
-- está en el servidor; ver el encabezado de la migración).
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_c')::UUID), 'true',
    '[F1] ACTIVA + alumno ACTIVO + perfil HABILITADO → válida');

SELECT pg_temp.esperar(pg_temp.como('03', pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    '42501', '[F2] docente no consulta la validez');
SELECT pg_temp.esperar(pg_temp.como('06', pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    '42501', '[F3] PERSONAL no consulta la validez (sin permisos de escáner en EPT-64)');
SELECT pg_temp.esperar(pg_temp.como('07', pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    '42501', '[F4] el alumno no consulta la validez');
SELECT pg_temp.esperar(pg_temp.como('04', pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    '42501', '[F5] el padre no consulta la validez');
SELECT pg_temp.esperar(pg_temp.como('02', pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    '42501', '[F6] Dirección bloqueada no consulta la validez');
SELECT pg_temp.esperar(pg_temp.como('0c', pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    '42501', '[F7] cuenta sin perfil no consulta la validez');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    '42501', '[F8] anónimo no consulta la validez');
SELECT pg_temp.esperar(pg_temp.ejecutar('authenticated', NULL, pg_catalog.format('SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    'P5505', '[F9] sin identidad → P5505');
SELECT pg_temp.esperar_valor(pg_temp.dir(
    'SELECT pg_catalog.count(*)::TEXT FROM public.consultar_validez_credencial_qr(''00000000-0000-4000-8000-000000000000'')'),
    '0', '[F10] un identificador desconocido no devuelve filas');

-- F11. Inactivar invalida; reactivar restaura LA MISMA credencial.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.inactivar_alumno(%L)', pg_temp.u('07'))),
    'OK', '[F11] inactivar al alumno');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_c')::UUID), 'false',
    '[F12] alumno INACTIVO → la credencial no es válida');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('07')) = 1
    AND (SELECT c.estado = 'ACTIVA' FROM public.credenciales_qr c WHERE c.id = pg_temp.fx('cred_07_c')::UUID),
    '[F13] inactivar NO modificó la credencial (la validez se calcula al consultar)');
SELECT pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
    'SELECT estado_alumno::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    'INACTIVO', '[F14] la consulta informa el estado del alumno');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reactivar_alumno(%L, %L)', pg_temp.u('07'), pg_temp.u('c1'))),
    'OK', '[F15] reactivar al alumno');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_c')::UUID), 'true',
    '[F16] reactivar restaura la validez de la MISMA credencial ACTIVA');

-- F17. Bloquear el acceso del perfil invalida; desbloquear restaura.
UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u('07');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_c')::UUID), 'false',
    '[F17] perfil BLOQUEADO → la credencial no es válida');
SELECT pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
    'SELECT acceso_alumno::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_07_c'))),
    'BLOQUEADO', '[F18] la consulta informa el bloqueo');
UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u('07');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_c')::UUID), 'true',
    '[F19] al habilitar de nuevo vuelve a ser válida');

-- F20. Una revocada nunca vuelve a valer, ni reactivando al alumno.
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_b')::UUID), 'false',
    '[F20] credencial revocada → no válida');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.inactivar_alumno(%L)', pg_temp.u('07'))), 'OK', '[F21] se inactiva otra vez');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reactivar_alumno(%L, %L)', pg_temp.u('07'), pg_temp.u('c1'))), 'OK', '[F22] se reactiva otra vez');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_b')::UUID), 'false',
    '[F23] la revocada sigue sin valer tras inactivar y reactivar');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_a')::UUID), 'false',
    '[F24] la primera revocada tampoco vale');

-- F25. Un alumno que se inactiva con la credencial ACTIVA: la credencial sobrevive pero no vale.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.inactivar_alumno(%L)', pg_temp.u('0e'))),
    'OK', '[F25a] se inactiva a la alumna del ciclo');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_0e')::UUID), 'false',
    '[F25] credencial de un alumno INACTIVO → no válida');

-- F28. Contrato: con el alumno inactivo NO se repone (y la vigente no se toca), pero SÍ se revoca.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'SELECT public.reponer_credencial_qr(%L, ''k1'', ''Reposición de prueba'')', pg_temp.fx('cred_0e'))),
    'P5627', '[F28] reponer con el alumno inactivo → P5627');
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('0e')) = 1
    AND (SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = pg_temp.u('0e')) = 1
    AND (SELECT c.estado = 'ACTIVA' FROM public.credenciales_qr c WHERE c.id = pg_temp.fx('cred_0e')::UUID),
    '[F29] el rechazo no revocó la vigente ni creó otra (transacción entera revertida)');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'SELECT public.revocar_credencial_qr(%L, ''Baja por inactivación'')', pg_temp.fx('cred_0e'))),
    'OK', '[F30] Dirección SÍ puede revocar la credencial de un alumno inactivo');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.emitir_credencial_qr(%L, ''k1'')', pg_temp.u('0e'))),
    'P5627', '[F31] sin ACTIVA y con el alumno inactivo, emitir → P5627');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.reactivar_alumno(%L, %L)', pg_temp.u('0e'), pg_temp.u('c1'))),
    'OK', '[F32] se reactiva a la alumna del ciclo');
SELECT pg_temp.guardar('cred_0e_b', pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.emitir_credencial_qr(%L, ''k1'')).id::TEXT', pg_temp.u('0e')))));
SELECT pg_temp.exigir(pg_temp.activas(pg_temp.u('0e')) = 1
    AND pg_temp.fx('cred_0e_b') <> pg_temp.fx('cred_0e'),
    '[F33] reactivado, se emite una credencial nueva; la revocada no revive');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_0e')::UUID), 'false',
    '[F34] la revocada sigue sin valer tras reactivar');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_09')::UUID), 'false',
    '[F26] credencial de un alumno con acceso BLOQUEADO → no válida');

-- F27. Eliminar el vínculo familiar no cambia la validez.
DELETE FROM public.padres_hijos WHERE hijo_id = pg_temp.u('07');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_c')::UUID), 'true',
    '[F27] desvincular a los padres no afecta la validez');
INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES (pg_temp.u('04'), pg_temp.u('07')), (pg_temp.u('0b'), pg_temp.u('07'));


-- ================================================================
-- G. HISTORIAL Y DATOS INTERNOS
-- ================================================================
SELECT pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
    'SELECT pg_catalog.count(*)::TEXT FROM public.historial_credenciales_qr(%L)', pg_temp.u('07'))),
    '3', '[G1] Dirección ve las 3 filas del historial');
SELECT pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
    'SELECT emitida_por_nombre || '' / '' || motivo_revocacion FROM public.historial_credenciales_qr(%L) WHERE id = %L',
    pg_temp.u('07'), pg_temp.fx('cred_07_a'))),
    'Directora Emisora Uno / Extravío de la tarjeta',
    '[G2] el historial trae quién emitió y el motivo, solo para Dirección');
SELECT pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
    'SELECT reemplaza_a::TEXT FROM public.historial_credenciales_qr(%L) WHERE id = %L',
    pg_temp.u('07'), pg_temp.fx('cred_07_b'))),
    pg_temp.fx('cred_07_a'), '[G3] la reposición queda enlazada con la credencial reemplazada');
SELECT pg_temp.esperar(pg_temp.como('07', pg_catalog.format('SELECT * FROM public.historial_credenciales_qr(%L)', pg_temp.u('07'))),
    '42501', '[G4] el alumno no ve el historial interno');
SELECT pg_temp.esperar(pg_temp.como('04', pg_catalog.format('SELECT * FROM public.historial_credenciales_qr(%L)', pg_temp.u('07'))),
    '42501', '[G5] el padre no ve el historial interno');
SELECT pg_temp.esperar(pg_temp.como('06', pg_catalog.format('SELECT * FROM public.historial_credenciales_qr(%L)', pg_temp.u('07'))),
    '42501', '[G6] PERSONAL no ve el historial interno');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, pg_catalog.format('SELECT * FROM public.historial_credenciales_qr(%L)', pg_temp.u('07'))),
    '42501', '[G7] anónimo no ve el historial interno');


-- ================================================================
-- H. CURSO, DNI Y LEGAJO NO TOCAN LAS CREDENCIALES
-- ================================================================
CREATE TEMPORARY TABLE antes_h ON COMMIT DROP AS
SELECT c.id, c.alumno_id, c.estado, c.clave_kid, c.emitida_en, c.revocada_en
FROM public.credenciales_qr c;

SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT public.cambiar_curso_alumno(%L, %L)', pg_temp.u('07'), pg_temp.u('c2'))),
    'OK', '[H1] cambio de curso');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'SELECT public.corregir_identidad_alumno(%L, %L, %L)', pg_temp.u('07'), '94999999', 'LEG-EPT64-NUEVO')),
    'OK', '[H2] corrección de DNI y legajo');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.exigir(
    NOT EXISTS (
        SELECT 1 FROM antes_h a
        FULL JOIN (SELECT c.id, c.alumno_id, c.estado, c.clave_kid, c.emitida_en, c.revocada_en
                   FROM public.credenciales_qr c) d USING (id)
        WHERE a.id IS NULL OR d.id IS NULL
           OR a.alumno_id IS DISTINCT FROM d.alumno_id OR a.estado IS DISTINCT FROM d.estado
           OR a.clave_kid IS DISTINCT FROM d.clave_kid OR a.emitida_en IS DISTINCT FROM d.emitida_en
           OR a.revocada_en IS DISTINCT FROM d.revocada_en),
    '[H3] curso, DNI y legajo cambiaron y las credenciales quedaron idénticas (sin reemisión)');
SELECT pg_temp.esperar_valor(pg_temp.validez(pg_temp.fx('cred_07_c')::UUID), 'true',
    '[H4] la misma credencial sigue siendo válida tras esos cambios');


SELECT pg_temp.exigir(
    (SELECT p.dni = $$94999999$$ AND p.legajo_nro = $$LEG-EPT64-NUEVO$$ FROM public.perfiles p WHERE p.id = pg_temp.u($$07$$))
    AND (SELECT m.curso_id = pg_temp.u($$c2$$) FROM public.matriculas m WHERE m.alumno_id = pg_temp.u($$07$$) AND m.fecha_cierre IS NULL),
    $$[H5] el DNI, el legajo y el curso efectivamente cambiaron$$);
DROP TABLE antes_h;

-- ================================================================
-- R. REVERSIÓN DOCUMENTADA
-- ================================================================
-- Solo es válida en un entorno SIN credenciales emitidas de verdad: DROP TABLE
-- destruye el historial. Se prueba dentro de esta transacción y se descarta.
--
-- Desde EPT-65 `accesos_servicios` tiene una clave foránea hacia `credenciales_qr`:
-- la reversión de EPT-64 exige revertir ANTES la de EPT-65 (ver su migración y
-- docs/evidence/EPT-65.md). Aquí solo se sueltan las dos tablas que la referencian.
DROP TABLE public.anulaciones_accesos_servicios CASCADE;
DROP TABLE public.accesos_servicios CASCADE;
DROP FUNCTION public.emitir_credencial_qr(UUID, TEXT);
DROP FUNCTION public.reponer_credencial_qr(UUID, TEXT, TEXT);
DROP FUNCTION public.revocar_credencial_qr(UUID, TEXT);
DROP FUNCTION public.historial_credenciales_qr(UUID);
DROP FUNCTION public.consultar_validez_credencial_qr(UUID);
DROP FUNCTION app_private.emitir_credencial_qr(UUID, TEXT);
DROP FUNCTION app_private.reponer_credencial_qr(UUID, TEXT, TEXT);
DROP FUNCTION app_private.revocar_credencial_qr(UUID, TEXT);
DROP FUNCTION app_private.historial_credenciales_qr(UUID);
DROP FUNCTION app_private.consultar_validez_credencial_qr(UUID);
DROP TABLE public.credenciales_qr;
DROP FUNCTION app_private.proteger_credencial_qr();
DROP FUNCTION app_private.impedir_vaciar_credenciales_qr();
DROP FUNCTION app_private.validar_datos_credencial_qr(TEXT, TEXT, BOOLEAN);
DROP TYPE public.estado_credencial_qr;

SELECT pg_temp.exigir(
    pg_catalog.to_regclass('public.credenciales_qr') IS NULL
    AND pg_catalog.to_regtype('public.estado_credencial_qr') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname IN ('public', 'app_private') AND p.proname LIKE '%credencial%qr%'),
    '[R1] la reversión documentada suelta solo lo que creó esta migración');
SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM public.alumnos WHERE perfil_id IN (pg_temp.u('07'), pg_temp.u('08')))= 2
    AND pg_catalog.to_regprocedure('public.inactivar_alumno(uuid)') IS NOT NULL
    AND pg_catalog.to_regclass('public.padres_hijos') IS NOT NULL,
    '[R2] alumnos, padres_hijos y las funciones de alumnos siguen intactos');

ROLLBACK;
