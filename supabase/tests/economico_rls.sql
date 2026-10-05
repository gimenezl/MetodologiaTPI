-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Seguridad económica y comprobantes (EPT-101)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable e identificada,
-- después de `supabase db reset`. Todo ocurre dentro de una transacción con
-- ROLLBACK. Uso con el stack aislado de la unidad:
--
--   docker cp supabase/tests/economico_rls.sql supabase_db_ept101:/tmp/
--   docker exec supabase_db_ept101 psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/economico_rls.sql
--
-- Cada comprobación imprime `OK n` (aviso) o aborta con `FALLO n`. Una negativa
-- solo cuenta con el SQLSTATE esperado: fallar «por cualquier error» no
-- demuestra la regla. Los actores se simulan con SET ROLE + JWT, igual que
-- PostgREST; la identidad sale siempre de `auth.uid()` y del perfil vigente.
--
-- Cubre las nueve tablas (las ocho de EPT-100 y `comprobantes_pago`):
--   A. estructura de `comprobantes_pago` y de las exposiciones;
--   B. grants y políticas exactos, por rol, tabla y columna;
--   C. matriz de lectura por actor (tabla por tabla, filas exactas);
--   D. escrituras y TRUNCATE: ninguna vía directa para ningún rol;
--   E. restricciones del comprobante (ruta, MIME, tamaño, cargador, pago);
--   F. exposición saneada del registro del comprobante (RPC);
--   G. identidad: metadata del JWT, rol y vínculo vigentes, bloqueo, sin perfil;
--   H. funciones auxiliares: SECURITY DEFINER, search_path y EXECUTE;
--   I. políticas y configuración del bucket privado.
-- Las pruebas contra el servicio Storage real están en `economico_storage.mjs`.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- AYUDANTES
-- ================================================================
CREATE TEMPORARY SEQUENCE ept101_n;

CREATE FUNCTION pg_temp.u(p_n INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_catalog.format('b1010000-0000-4000-8000-%s', pg_catalog.lpad(p_n::TEXT, 12, '0'))::UUID $$;

CREATE FUNCTION pg_temp.afirmar(p_condicion BOOLEAN, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := pg_catalog.nextval('ept101_n');
BEGIN
    IF p_condicion IS TRUE THEN
        RAISE NOTICE 'OK %: %', v_n, p_descripcion;
    ELSE
        RAISE EXCEPTION 'FALLO %: %', v_n, p_descripcion;
    END IF;
END;
$$;

-- Sentencia que DEBE fallar con el SQLSTATE esperado (como propietario).
CREATE FUNCTION pg_temp.negativa(p_sql TEXT, p_estado TEXT, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_n BIGINT := pg_catalog.nextval('ept101_n');
    v_estado TEXT;
    v_mensaje TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_mensaje = MESSAGE_TEXT;
        IF v_estado = p_estado THEN
            RAISE NOTICE 'OK %: % [%]', v_n, p_descripcion, v_estado;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FALLO %: % — esperaba % y falló con % (%)',
            v_n, p_descripcion, p_estado, v_estado, v_mensaje;
    END;
    RAISE EXCEPTION 'FALLO %: % — esperaba % y la sentencia tuvo éxito',
        v_n, p_descripcion, p_estado;
END;
$$;

CREATE FUNCTION pg_temp.positiva(p_sql TEXT, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_n BIGINT := pg_catalog.nextval('ept101_n');
    v_estado TEXT;
    v_mensaje TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_mensaje = MESSAGE_TEXT;
        RAISE EXCEPTION 'FALLO %: % — debía tener éxito y falló con % (%)',
            v_n, p_descripcion, v_estado, v_mensaje;
    END;
    RAISE NOTICE 'OK %: %', v_n, p_descripcion;
END;
$$;

-- Ejecuta una sentencia con el rol de aplicación y el JWT indicados y devuelve
--   · modo 'leer':    el valor escalar (un COUNT) como texto;
--   · modo 'escribir': las filas afectadas como texto;
--   · 'E' || SQLSTATE si la sentencia falla.
-- El rol y los claims se restauran siempre antes de volver.
CREATE FUNCTION pg_temp.como(p_sub UUID, p_rol TEXT, p_modo TEXT, p_sql TEXT,
                             p_claims JSONB DEFAULT '{}'::JSONB) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_resultado TEXT;
    v_n BIGINT;
    v_estado TEXT;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        (pg_catalog.jsonb_build_object('role', p_rol)
         || CASE WHEN p_sub IS NULL THEN '{}'::JSONB ELSE pg_catalog.jsonb_build_object('sub', p_sub) END
         || p_claims)::TEXT, TRUE);
    BEGIN
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        IF p_modo = 'leer' THEN
            EXECUTE p_sql INTO v_n;
        ELSE
            EXECUTE p_sql;
            GET DIAGNOSTICS v_n = ROW_COUNT;
        END IF;
        v_resultado := v_n::TEXT;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
        v_resultado := 'E' || v_estado;
    END;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
    RETURN v_resultado;
END;
$$;


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- Familia 1: hijo A (alumno 2) con DOS padres vinculados (5 y 6, copadres).
-- Familia 2: hijo B (alumno 3) con su padre C (7), ajeno a la familia 1.
-- 9: padre de la familia 1 que será BLOQUEADO.   10: sujeto con JWT válido sin perfil.
WITH base_libre AS (
    SELECT base
    FROM generate_series(83000000, 89999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 12) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(n, rol, apellido, legajo) AS (
    VALUES
        (1, 'DIRECTOR',   'Directora',   NULL),
        (2, 'ESTUDIANTE', 'Alumna A',    'LEG-EPT101-0002'),
        (3, 'ESTUDIANTE', 'Alumno B',    'LEG-EPT101-0003'),
        (4, 'DOCENTE',    'Docente 1',   'LEG-EPT101-0004'),
        (5, 'PADRE',      'Padre A',     NULL),
        (6, 'PADRE',      'Copadre A',   NULL),
        (7, 'PADRE',      'Padre C',     NULL),
        (8, 'PERSONAL',   'Personal 1',  NULL),
        (9, 'PADRE',      'Padre bloqueado', NULL)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.u(i.n), pg_temp.u(i.n), r.id, 'Prueba', i.apellido,
       (b.base + i.n)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u(101), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'Curso EPT-101', 'A', TRUE);

INSERT INTO public.matriculas (id, alumno_id, curso_id)
VALUES (pg_temp.u(701), pg_temp.u(2), pg_temp.u(101)),
       (pg_temp.u(702), pg_temp.u(3), pg_temp.u(101));
UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (pg_temp.u(2), pg_temp.u(3));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES (pg_temp.u(5), pg_temp.u(2)), (pg_temp.u(6), pg_temp.u(2)),
       (pg_temp.u(9), pg_temp.u(2)), (pg_temp.u(7), pg_temp.u(3));

INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
VALUES (pg_temp.u(401), 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 50000.00, '2026-01-01');
INSERT INTO public.tarifas (id, concepto, deporte_id, importe, desde)
VALUES (pg_temp.u(402), 'DEPORTE', 'e0000000-0000-4000-8000-000000000101', 8000.00, '2026-01-01');

INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
VALUES (pg_temp.u(801), pg_temp.u(2), '2026-11-01', '2026-11-10', 58000.00),
       (pg_temp.u(802), pg_temp.u(2), '2026-12-01', '2026-12-10', 0.00),
       (pg_temp.u(803), pg_temp.u(3), '2026-11-01', '2026-11-10', 50000.00);

INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
VALUES (pg_temp.u(901), pg_temp.u(801), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(701), 50000.00),
       (pg_temp.u(911), pg_temp.u(803), pg_temp.u(3), 'CUOTA', pg_temp.u(401), pg_temp.u(702), 50000.00);
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id)
SELECT pg_temp.u(501), pg_temp.u(2), g.id
FROM public.grupos_deportivos g
WHERE g.deporte_id = 'e0000000-0000-4000-8000-000000000101' LIMIT 1;
-- Si el catálogo no trae un grupo, el fixture usa uno propio.
INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
SELECT pg_temp.u(201), 'e0000000-0000-4000-8000-000000000101',
       (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Fútbol EPT-101', 20, pg_temp.u(4)
WHERE NOT EXISTS (SELECT 1 FROM public.inscripciones_deportivas WHERE id = pg_temp.u(501));
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
VALUES (1, '17:00', '18:00') ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT pg_temp.u(201), h.id FROM public.horarios h
WHERE h.dia_semana = 1 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00'
  AND EXISTS (SELECT 1 FROM public.grupos_deportivos WHERE id = pg_temp.u(201))
ON CONFLICT DO NOTHING;
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id)
SELECT pg_temp.u(501), pg_temp.u(2), pg_temp.u(201)
WHERE NOT EXISTS (SELECT 1 FROM public.inscripciones_deportivas WHERE id = pg_temp.u(501));
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, inscripcion_deportiva_id, importe)
VALUES (pg_temp.u(902), pg_temp.u(801), pg_temp.u(2), 'DEPORTE', pg_temp.u(402), pg_temp.u(501), 8000.00);

-- Pagos: P1 del padre A, P2 del copadre (mismo hijo A), P3 del padre C (hijo B).
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
VALUES (pg_temp.u(1001), pg_temp.u(5), pg_temp.u(2), 50000.00),
       (pg_temp.u(1002), pg_temp.u(6), pg_temp.u(2), 8000.00),
       (pg_temp.u(1003), pg_temp.u(7), pg_temp.u(3), 50000.00);
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
VALUES (pg_temp.u(1001), pg_temp.u(901), pg_temp.u(2), 50000.00),
       (pg_temp.u(1002), pg_temp.u(902), pg_temp.u(2), 8000.00),
       (pg_temp.u(1003), pg_temp.u(911), pg_temp.u(3), 50000.00);
INSERT INTO public.recibos (id, pago_id, numero, archivo_path)
VALUES (pg_temp.u(1101), pg_temp.u(1001), 9100001, 'recibos-futuros/secreto-1.pdf'),
       (pg_temp.u(1103), pg_temp.u(1003), 9100003, 'recibos-futuros/secreto-3.pdf');
INSERT INTO public.envios_correo (id, padre_id, tipo, fecha_programada, estado, intentos, ultimo_error)
VALUES (pg_temp.u(1201), pg_temp.u(5), 'AVISO_DEUDA', '2026-11-05', 'FALLIDO', 1, 'smtp interno: 550 buzón'),
       (pg_temp.u(1202), pg_temp.u(6), 'AVISO_DEUDA', '2026-11-05', 'PENDIENTE', 0, NULL),
       (pg_temp.u(1203), pg_temp.u(7), 'AVISO_DEUDA', '2026-11-05', 'PENDIENTE', 0, NULL);
INSERT INTO public.feriados (fecha, descripcion) VALUES ('2099-05-25', 'Feriado EPT-101');

-- Comprobantes: C1 y C2 (varios por pago) del padre A sobre P1; C3 del copadre
-- sobre P2; C4 del padre C sobre P3. La ruta es <pago>/<id>.<extensión>.
INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
VALUES
 (pg_temp.u(1301), pg_temp.u(1001), pg_temp.u(5),
  pg_temp.u(1001)::TEXT || '/' || pg_temp.u(1301)::TEXT || '.jpg', 'image/jpeg', 120000),
 (pg_temp.u(1302), pg_temp.u(1001), pg_temp.u(5),
  pg_temp.u(1001)::TEXT || '/' || pg_temp.u(1302)::TEXT || '.pdf', 'application/pdf', 5242880),
 (pg_temp.u(1303), pg_temp.u(1002), pg_temp.u(6),
  pg_temp.u(1002)::TEXT || '/' || pg_temp.u(1303)::TEXT || '.png', 'image/png', 4000),
 (pg_temp.u(1304), pg_temp.u(1003), pg_temp.u(7),
  pg_temp.u(1003)::TEXT || '/' || pg_temp.u(1304)::TEXT || '.jpg', 'image/jpeg', 99000);

UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(9);

SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM public.comprobantes_pago
     WHERE pago_id IN (pg_temp.u(1001), pg_temp.u(1002), pg_temp.u(1003))) = 4,
    'fixture: dos familias, tres pagos y cuatro comprobantes (dos en un mismo pago)');


-- ================================================================
-- A. ESTRUCTURA DE comprobantes_pago
-- ================================================================
DO $$
DECLARE v_n INTEGER;
BEGIN
    PERFORM pg_temp.afirmar(pg_catalog.to_regclass('public.comprobantes_pago') IS NOT NULL,
        'A1: existe public.comprobantes_pago');
    PERFORM pg_temp.afirmar(pg_catalog.to_regclass('public.envios_correo_facturas') IS NULL,
        'A1: envios_correo_facturas sigue sin crearse (pendiente de decisión)');

    SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES
        ('id','uuid','NO'), ('pago_id','uuid','NO'), ('subido_por','uuid','NO'),
        ('ruta_archivo','text','NO'), ('tipo_mime','text','NO'),
        ('tamano_bytes','bigint','NO'), ('creado_en','timestamp with time zone','NO')
    ) AS e(columna, tipo, nulable)
    JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = 'comprobantes_pago'
     AND c.column_name = e.columna AND c.data_type = e.tipo AND c.is_nullable = e.nulable;
    PERFORM pg_temp.afirmar(v_n = 7, 'A2: siete columnas con tipo y nulabilidad exactos');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = 'comprobantes_pago') = 7,
        'A2: ninguna columna adicional');

    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint k
         WHERE k.conrelid = 'public.comprobantes_pago'::REGCLASS AND k.contype = 'p') = 1
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint k
             WHERE k.conrelid = 'public.comprobantes_pago'::REGCLASS AND k.contype = 'f') >= 1
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
             WHERE k.conrelid = 'public.comprobantes_pago'::REGCLASS AND k.contype = 'f'
               AND k.confdeltype <> 'r'),
        'A3: clave primaria y claves foráneas con ON DELETE RESTRICT');
    PERFORM pg_temp.afirmar(
        EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i
                WHERE i.schemaname = 'public' AND i.tablename = 'comprobantes_pago'
                  AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(ruta_archivo)%'),
        'A4: la ruta del archivo es única');
    PERFORM pg_temp.afirmar(
        pg_catalog.pg_get_constraintdef((SELECT k.oid FROM pg_catalog.pg_constraint k
            WHERE k.conrelid = 'public.comprobantes_pago'::REGCLASS AND k.contype = 'f'
              AND k.confrelid = 'public.pagos'::REGCLASS)) LIKE '%(pago_id, subido_por)%(id, padre_id)%',
        'A5: la FK compuesta ata el cargador al padre del pago (pagos.id, pagos.padre_id)');
END;
$$;


-- ================================================================
-- B. GRANTS Y POLÍTICAS EXACTOS
-- ================================================================
DO $$
DECLARE
    v_tablas TEXT[] := ARRAY['tarifas', 'facturas', 'items_factura', 'pagos',
        'imputaciones_pago', 'recibos', 'feriados', 'envios_correo', 'comprobantes_pago'];
    v_tabla TEXT;
    v_rol TEXT;
    v_privilegio TEXT;
    v_n INTEGER;
BEGIN
    FOREACH v_tabla IN ARRAY v_tablas LOOP
        PERFORM pg_temp.afirmar(
            (SELECT c.relrowsecurity AND NOT c.relforcerowsecurity
             FROM pg_catalog.pg_class c WHERE c.oid = pg_catalog.to_regclass('public.' || v_tabla)),
            'B1: RLS habilitada en ' || v_tabla);
        -- Una restrictiva de bloqueo y, a lo sumo, una permisiva de lectura (SELECT).
        PERFORM pg_temp.afirmar(
            EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = v_tabla
                      AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL'
                      AND p.policyname = 'Bloqueo de acceso sin datos protegidos'
                      AND p.roles = ARRAY['authenticated']::NAME[]),
            'B2: ' || v_tabla || ' conserva la política RESTRICTIVE de bloqueo');
        SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = v_tabla AND p.permissive = 'PERMISSIVE';
        PERFORM pg_temp.afirmar(v_n >= 1, 'B2: ' || v_tabla || ' tiene política permisiva de lectura');
        PERFORM pg_temp.afirmar(
            NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                        WHERE p.schemaname = 'public' AND p.tablename = v_tabla
                          AND p.permissive = 'PERMISSIVE'
                          AND (p.cmd <> 'SELECT' OR p.roles <> ARRAY['authenticated']::NAME[])),
            'B2: las permisivas de ' || v_tabla || ' son solo SELECT para authenticated');

        -- anon: nada. authenticated: solo SELECT.
        FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                            'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            PERFORM pg_temp.afirmar(
                NOT pg_catalog.has_table_privilege('anon', 'public.' || v_tabla, v_privilegio),
                'B3: anon sin ' || v_privilegio || ' sobre ' || v_tabla);
            IF v_privilegio <> 'SELECT' THEN
                PERFORM pg_temp.afirmar(
                    NOT pg_catalog.has_table_privilege('authenticated', 'public.' || v_tabla, v_privilegio),
                    'B3: authenticated sin ' || v_privilegio || ' sobre ' || v_tabla);
            END IF;
        END LOOP;
        FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
            PERFORM pg_temp.afirmar(
                NOT pg_catalog.has_any_column_privilege('anon', 'public.' || v_tabla, v_privilegio),
                'B3: anon sin ' || v_privilegio || ' por columna en ' || v_tabla);
            IF v_privilegio NOT IN ('SELECT') THEN
                PERFORM pg_temp.afirmar(
                    NOT pg_catalog.has_any_column_privilege('authenticated', 'public.' || v_tabla, v_privilegio),
                    'B3: authenticated sin ' || v_privilegio || ' por columna en ' || v_tabla);
            END IF;
        END LOOP;
        PERFORM pg_temp.afirmar(
            (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c,
                    LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
             WHERE c.oid = pg_catalog.to_regclass('public.' || v_tabla) AND a.grantee = 0) = 0,
            'B3: PUBLIC sin privilegios sobre ' || v_tabla);
    END LOOP;

    -- Lectura de tabla completa para authenticated, salvo `recibos` (sin `archivo_path`).
    FOREACH v_tabla IN ARRAY ARRAY['tarifas', 'facturas', 'items_factura', 'pagos',
            'imputaciones_pago', 'feriados', 'envios_correo', 'comprobantes_pago'] LOOP
        PERFORM pg_temp.afirmar(
            pg_catalog.has_table_privilege('authenticated', 'public.' || v_tabla, 'SELECT'),
            'B4: authenticated tiene SELECT de tabla en ' || v_tabla);
    END LOOP;
    PERFORM pg_temp.afirmar(
        NOT pg_catalog.has_table_privilege('authenticated', 'public.recibos', 'SELECT')
        AND NOT pg_catalog.has_column_privilege('authenticated', 'public.recibos', 'archivo_path', 'SELECT')
        AND pg_catalog.has_column_privilege('authenticated', 'public.recibos', 'id', 'SELECT')
        AND pg_catalog.has_column_privilege('authenticated', 'public.recibos', 'pago_id', 'SELECT')
        AND pg_catalog.has_column_privilege('authenticated', 'public.recibos', 'numero', 'SELECT')
        AND pg_catalog.has_column_privilege('authenticated', 'public.recibos', 'emitido_en', 'SELECT'),
        'B4: recibos se lee por columna y sin `archivo_path`');

    -- Secuencias: las nueve tablas no tienen ninguna (claves UUID), así que no hay
    -- secuencia cuyo USAGE conceder.
    PERFORM pg_temp.afirmar(
        NOT EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = ANY (v_tablas)
                      AND (c.column_default LIKE 'nextval%' OR c.is_identity = 'YES')),
        'B5: ninguna de las nueve tablas usa secuencias ni columnas identidad');
END;
$$;


-- ================================================================
-- C. MATRIZ DE LECTURA POR ACTOR (filas exactas)
-- ================================================================
-- Orden de columnas esperadas: facturas, items_factura, pagos, imputaciones_pago,
-- recibos, comprobantes_pago, tarifas, feriados, envios_correo.
DO $$
DECLARE
    v_tablas TEXT[] := ARRAY['facturas', 'items_factura', 'pagos', 'imputaciones_pago',
        'recibos', 'comprobantes_pago', 'tarifas', 'feriados', 'envios_correo'];
    v_filtros TEXT[];
    v_a RECORD;
    v_i INTEGER;
    v_obtenido TEXT;
    v_alumnos TEXT := pg_catalog.format('%L, %L', pg_temp.u(2), pg_temp.u(3));
BEGIN
    v_filtros := ARRAY[
        pg_catalog.format('alumno_id IN (%s)', v_alumnos),
        pg_catalog.format('alumno_id IN (%s)', v_alumnos),
        pg_catalog.format('alumno_id IN (%s)', v_alumnos),
        pg_catalog.format('alumno_id IN (%s)', v_alumnos),
        pg_catalog.format('pago_id IN (%L, %L, %L)', pg_temp.u(1001), pg_temp.u(1002), pg_temp.u(1003)),
        pg_catalog.format('pago_id IN (%L, %L, %L)', pg_temp.u(1001), pg_temp.u(1002), pg_temp.u(1003)),
        pg_catalog.format('id IN (%L, %L)', pg_temp.u(401), pg_temp.u(402)),
        'fecha = ''2099-05-25''',
        pg_catalog.format('padre_id IN (%L, %L, %L)', pg_temp.u(5), pg_temp.u(6), pg_temp.u(7))];

    FOR v_a IN
        SELECT * FROM (VALUES
            ('DIRECTOR',              1,  'authenticated', ARRAY[3,3,3,3,2,4,2,1,3]),
            ('PADRE A (hijo A)',      5,  'authenticated', ARRAY[2,2,2,2,1,2,0,0,0]),
            ('COPADRE (hijo A)',      6,  'authenticated', ARRAY[2,2,2,2,1,1,0,0,0]),
            ('PADRE C (hijo B)',      7,  'authenticated', ARRAY[1,1,1,1,1,1,0,0,0]),
            ('ESTUDIANTE A',          2,  'authenticated', ARRAY[2,2,2,2,1,0,0,0,0]),
            ('ESTUDIANTE B',          3,  'authenticated', ARRAY[1,1,1,1,1,0,0,0,0]),
            ('DOCENTE',               4,  'authenticated', ARRAY[0,0,0,0,0,0,0,0,0]),
            ('PERSONAL',              8,  'authenticated', ARRAY[0,0,0,0,0,0,0,0,0]),
            ('PADRE BLOQUEADO',       9,  'authenticated', ARRAY[0,0,0,0,0,0,0,0,0]),
            ('sin perfil (JWT válido)', 10, 'authenticated', ARRAY[0,0,0,0,0,0,0,0,0])
        ) AS t(actor, n, rol, esperado)
    LOOP
        FOR v_i IN 1..9 LOOP
            v_obtenido := pg_temp.como(pg_temp.u(v_a.n), v_a.rol, 'leer',
                pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I WHERE %s',
                                  v_tablas[v_i], v_filtros[v_i]));
            PERFORM pg_temp.afirmar(v_obtenido = v_a.esperado[v_i]::TEXT,
                pg_catalog.format('C1: %s lee %s fila(s) de %s (obtuvo %s)',
                                  v_a.actor, v_a.esperado[v_i], v_tablas[v_i], v_obtenido));
        END LOOP;
    END LOOP;

    -- anon: sin ningún grant, 42501 en las nueve tablas.
    FOR v_i IN 1..9 LOOP
        v_obtenido := pg_temp.como(NULL, 'anon', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', v_tablas[v_i]));
        PERFORM pg_temp.afirmar(v_obtenido = 'E42501',
            'C2: anon recibe 42501 al leer ' || v_tablas[v_i] || ' (obtuvo ' || v_obtenido || ')');
    END LOOP;

    -- C3. Historial legítimo del hijo: el pago del copadre es visible para el padre A.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(*) FROM public.pagos WHERE id = %L', pg_temp.u(1002))) = '1',
        'C3: el padre A ve el pago del copadre sobre el mismo hijo (no se filtra por pagos.padre_id)');
    -- C4. ... pero no el archivo del copadre.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(*) FROM public.comprobantes_pago WHERE id = %L', pg_temp.u(1303))) = '0',
        'C4: el padre A NO ve el comprobante que cargó el copadre');
    -- C5. Joins y embeds: la ruta no se filtra por ninguna relación.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(6), 'authenticated', 'leer',
            pg_catalog.format($q$SELECT pg_catalog.count(*) FROM public.pagos p
                JOIN public.comprobantes_pago c ON c.pago_id = p.id
                WHERE p.id = %L$q$, pg_temp.u(1001))) = '0',
        'C5: un JOIN pagos → comprobantes_pago no devuelve los archivos del otro padre');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format($q$SELECT pg_catalog.count(*) FROM public.recibos r
                JOIN public.pagos p ON p.id = r.pago_id
                WHERE p.id = %L$q$, pg_temp.u(1001))) = '1',
        'C5: el padre A lee el recibo de su pago por JOIN');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(archivo_path) FROM public.recibos WHERE id = %L', pg_temp.u(1101))) = 'E42501',
        'C5: pedir `recibos.archivo_path` da 42501 aun siendo el padre del pago');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(archivo_path) FROM public.recibos WHERE id = %L', pg_temp.u(1101))) = 'E42501',
        'C5: ni el DIRECTOR lee `recibos.archivo_path` hasta que EPT-110 defina su exposición');
END;
$$;


-- ================================================================
-- D. ESCRITURAS Y TRUNCATE: NINGUNA VÍA DIRECTA
-- ================================================================
DO $$
DECLARE
    v_tablas TEXT[] := ARRAY['tarifas', 'facturas', 'items_factura', 'pagos',
        'imputaciones_pago', 'recibos', 'feriados', 'envios_correo', 'comprobantes_pago'];
    v_actores INTEGER[] := ARRAY[1, 5, 6, 2, 4, 8, 9];
    v_actor INTEGER;
    v_tabla TEXT;
    v_col TEXT;
    v_r TEXT;
BEGIN
    FOREACH v_actor IN ARRAY v_actores LOOP
        FOREACH v_tabla IN ARRAY v_tablas LOOP
            v_col := CASE v_tabla WHEN 'feriados' THEN 'descripcion'
                                  WHEN 'imputaciones_pago' THEN 'activa'
                                  WHEN 'comprobantes_pago' THEN 'tamano_bytes'
                                  ELSE 'id' END;
            v_r := pg_temp.como(pg_temp.u(v_actor), 'authenticated', 'escribir',
                pg_catalog.format('INSERT INTO public.%I DEFAULT VALUES', v_tabla));
            PERFORM pg_temp.afirmar(v_r = 'E42501',
                pg_catalog.format('D1: actor %s no puede INSERT en %s (%s)', v_actor, v_tabla, v_r));
            v_r := pg_temp.como(pg_temp.u(v_actor), 'authenticated', 'escribir',
                pg_catalog.format('UPDATE public.%I SET %I = %I', v_tabla, v_col, v_col));
            PERFORM pg_temp.afirmar(v_r = 'E42501',
                pg_catalog.format('D1: actor %s no puede UPDATE en %s (%s)', v_actor, v_tabla, v_r));
            v_r := pg_temp.como(pg_temp.u(v_actor), 'authenticated', 'escribir',
                pg_catalog.format('DELETE FROM public.%I', v_tabla));
            PERFORM pg_temp.afirmar(v_r = 'E42501',
                pg_catalog.format('D1: actor %s no puede DELETE en %s (%s)', v_actor, v_tabla, v_r));
            v_r := pg_temp.como(pg_temp.u(v_actor), 'authenticated', 'escribir',
                pg_catalog.format('TRUNCATE public.%I', v_tabla));
            PERFORM pg_temp.afirmar(v_r = 'E42501',
                pg_catalog.format('D1: actor %s no puede TRUNCATE %s (%s)', v_actor, v_tabla, v_r));
        END LOOP;
    END LOOP;

    FOREACH v_tabla IN ARRAY v_tablas LOOP
        v_r := pg_temp.como(NULL, 'anon', 'escribir',
            pg_catalog.format('INSERT INTO public.%I DEFAULT VALUES', v_tabla));
        PERFORM pg_temp.afirmar(v_r = 'E42501', 'D2: anon no puede INSERT en ' || v_tabla || ' (' || v_r || ')');
        v_r := pg_temp.como(NULL, 'anon', 'escribir', pg_catalog.format('TRUNCATE public.%I', v_tabla));
        PERFORM pg_temp.afirmar(v_r = 'E42501', 'D2: anon no puede TRUNCATE ' || v_tabla || ' (' || v_r || ')');
    END LOOP;

    -- D3. Modificar importe, propietario, pago o estado: nada cambió.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'escribir',
            pg_catalog.format('UPDATE public.pagos SET total_calculado = 1 WHERE id = %L', pg_temp.u(1001))) = 'E42501',
        'D3: el padre no puede cambiar el importe de su pago');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated', 'escribir',
            pg_catalog.format('UPDATE public.pagos SET estado = ''APROBADO'' WHERE id = %L', pg_temp.u(1001))) = 'E42501',
        'D3: ni el DIRECTOR aprueba por UPDATE directo (la aprobación es una RPC futura)');
    PERFORM pg_temp.afirmar(
        (SELECT p.total_calculado = 50000.00 AND p.estado = 'PENDIENTE_VERIFICACION'
                AND p.padre_id = pg_temp.u(5)
         FROM public.pagos p WHERE p.id = pg_temp.u(1001)),
        'D3: el pago conserva importe, estado y propietario');
END;
$$;


-- ================================================================
-- E. RESTRICCIONES DEL COMPROBANTE (como propietario)
-- ================================================================
DO $$
BEGIN
    -- Ruta fuera de convención, traversal y nombres ajenos al id.
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, '../%s/x.jpg', 'image/jpeg', 10)$s$, pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001)),
        '23514', 'E1: traversal en la ruta');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, '%s/cualquiera.jpg', 'image/jpeg', 10)$s$, pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001)),
        '23514', 'E1: el nombre del objeto no es el id del comprobante');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 10)$s$,
        pg_temp.u(1310), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1002), pg_temp.u(1310)),
        '23514', 'E1: la ruta apunta al pago de otro (carpeta distinta de pago_id)');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.png', 'image/jpeg', 10)$s$,
        pg_temp.u(1311), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1311)),
        '23514', 'E1: la extensión no corresponde al tipo MIME');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '', 'image/jpeg', 10)$s$,
        pg_temp.u(1312), pg_temp.u(1001), pg_temp.u(5)),
        '23514', 'E1: ruta vacía');

    -- MIME y tamaño.
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.gif', 'image/gif', 10)$s$,
        pg_temp.u(1313), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1313)),
        '23514', 'E2: image/gif no es un tipo aprobado');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'IMAGE/JPEG', 10)$s$,
        pg_temp.u(1314), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1314)),
        '23514', 'E2: el tipo MIME distingue mayúsculas (valor exacto)');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 0)$s$,
        pg_temp.u(1315), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1315)),
        '23514', 'E3: tamaño cero');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 5242881)$s$,
        pg_temp.u(1316), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1316)),
        '23514', 'E3: 5242881 bytes supera el máximo (5 MiB = 5242880 bytes)');
    PERFORM pg_temp.afirmar(
        (SELECT c.tamano_bytes FROM public.comprobantes_pago c WHERE c.id = pg_temp.u(1302)) = 5242880,
        'E3: exactamente 5242880 bytes (5 MiB) es aceptado');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', NULL)$s$,
        pg_temp.u(1317), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1317)),
        '23502', 'E3: el tamaño es obligatorio');

    -- Cargador y pago.
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 10)$s$,
        pg_temp.u(1318), pg_temp.u(1001), pg_temp.u(6), pg_temp.u(1001), pg_temp.u(1318)),
        '23503', 'E4: el copadre no puede figurar como cargador del pago del padre A');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 10)$s$,
        pg_temp.u(1319), pg_temp.u(1003), pg_temp.u(5), pg_temp.u(1003), pg_temp.u(1319)),
        '23503', 'E4: un padre ajeno no puede atribuir un archivo al pago de otra familia');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 10)$s$,
        pg_temp.u(1320), pg_temp.u(1999), pg_temp.u(5), pg_temp.u(1999), pg_temp.u(1320)),
        '23503', 'E4: el pago debe existir');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        DELETE FROM public.pagos WHERE id = %L$s$, pg_temp.u(1001)),
        '23503', 'E4: un pago con comprobantes no se borra (ON DELETE RESTRICT)');
    -- Un pago cuya ÚNICA dependencia es un comprobante (sin imputaciones ni recibo):
    -- aísla la FK de comprobantes_pago de las FK RESTRICT de EPT-100.
    INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
    VALUES (pg_temp.u(1005), pg_temp.u(5), pg_temp.u(2), 1.00);
    INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
    VALUES (pg_temp.u(1305), pg_temp.u(1005), pg_temp.u(5),
            pg_temp.u(1005)::TEXT || '/' || pg_temp.u(1305)::TEXT || '.pdf', 'application/pdf', 10);
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        DELETE FROM public.pagos WHERE id = %L$s$, pg_temp.u(1005)),
        '23503', 'E4: un pago cuya única dependencia es un comprobante tampoco se borra (aísla la FK de comprobantes_pago)');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        UPDATE public.pagos SET padre_id = %L WHERE id = %L$s$, pg_temp.u(6), pg_temp.u(1001)),
        '23503', 'E4: no se puede cambiar el padre del pago bajo los comprobantes del anterior');

    -- Unicidad de ruta y varios archivos por pago.
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 10)$s$,
        pg_temp.u(1301), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1301)),
        '23505', 'E5: la misma ruta/id no se registra dos veces');
    PERFORM pg_temp.positiva(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
        SELECT g, %L, %L, %L || '/' || g::TEXT || '.png', 'image/png', 10
        FROM (SELECT pg_catalog.format('b1010000-0000-4000-8000-%%s', pg_catalog.lpad((1400 + n)::TEXT, 12, '0'))::UUID AS g
              FROM pg_catalog.generate_series(1, 25) AS n) s$s$,
        pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001)),
        'E5: un pago admite muchos archivos (se registran 25 más: sin máximo inventado)');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.comprobantes_pago WHERE pago_id = pg_temp.u(1001)) = 27,
        'E5: el pago P1 acumula 27 comprobantes');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes, creado_en)
        VALUES (%L, %L, %L, '%s/%s.jpg', 'image/jpeg', 10, 'infinity')$s$,
        pg_temp.u(1321), pg_temp.u(1001), pg_temp.u(5), pg_temp.u(1001), pg_temp.u(1321)),
        '23514', 'E6: creado_en no admite infinity');
END;
$$;


-- ================================================================
-- F. EXPOSICIÓN SANEADA DEL REGISTRO DEL COMPROBANTE
-- ================================================================
DO $$
DECLARE
    v_r TEXT;
    v_q TEXT := 'SELECT pg_catalog.count(*) FROM public.resumen_comprobantes_pago(%L)';
BEGIN
    PERFORM pg_temp.afirmar(
        pg_catalog.to_regprocedure('public.resumen_comprobantes_pago(uuid)') IS NOT NULL,
        'F1: existe public.resumen_comprobantes_pago(uuid)');
    PERFORM pg_temp.afirmar(
        NOT pg_catalog.has_function_privilege('anon', 'public.resumen_comprobantes_pago(uuid)', 'EXECUTE')
        AND pg_catalog.has_function_privilege('authenticated', 'public.resumen_comprobantes_pago(uuid)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('service_role', 'public.resumen_comprobantes_pago(uuid)', 'EXECUTE'),
        'F1: EXECUTE solo para authenticated');
    -- La salida no tiene ruta, MIME, tamaño ni cargador.
    PERFORM pg_temp.afirmar(
        (SELECT p.proargnames FROM pg_catalog.pg_proc p
         WHERE p.oid = 'public.resumen_comprobantes_pago(uuid)'::REGPROCEDURE)
            = ARRAY['p_pago_id', 'pago_id', 'cantidad_archivos', 'ultima_carga_en']::TEXT[],
        'F1: la salida es solo (pago_id, cantidad_archivos, ultima_carga_en)');

    -- Padre A, copadre y estudiante A ven el registro de los pagos de su hijo (no el archivo).
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format('SELECT cantidad_archivos FROM public.resumen_comprobantes_pago(%L)', pg_temp.u(1001))) = '27',
        'F2: el padre A ve cuántos archivos tiene su pago (sin la ruta)');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format('SELECT cantidad_archivos FROM public.resumen_comprobantes_pago(%L)', pg_temp.u(1002))) = '1',
        'F2: el padre A ve que el pago del copadre sobre su hijo tiene comprobante, sin acceder al archivo');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(2), 'authenticated', 'leer',
            pg_catalog.format('SELECT cantidad_archivos FROM public.resumen_comprobantes_pago(%L)', pg_temp.u(1001))) = '27',
        'F2: el estudiante propio ve el registro de sus pagos');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated', 'leer',
            pg_catalog.format('SELECT cantidad_archivos FROM public.resumen_comprobantes_pago(%L)', pg_temp.u(1003))) = '1',
        'F2: el DIRECTOR ve el registro de cualquier pago');
    -- Un pago sin archivos aparece con cantidad 0 para quien lo ve.
    INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
    VALUES (pg_temp.u(1004), pg_temp.u(5), pg_temp.u(2), 1.00);
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format('SELECT cantidad_archivos FROM public.resumen_comprobantes_pago(%L)', pg_temp.u(1004))) = '0',
        'F3: un pago sin archivo devuelve cantidad 0 (registro sin archivo)');

    -- Denegaciones: cero filas, sin error que distinga inexistente de ajeno.
    FOREACH v_r IN ARRAY ARRAY['7', '3', '4', '8', '9', '10'] LOOP
        PERFORM pg_temp.afirmar(
            pg_temp.como(pg_temp.u(v_r::INTEGER), 'authenticated', 'leer',
                pg_catalog.format(v_q, pg_temp.u(1001))) = '0',
            'F4: el actor ' || v_r || ' (ajeno, docente, personal, bloqueado o sin perfil) no ve el registro de P1');
    END LOOP;
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(7), 'authenticated', 'leer',
            pg_catalog.format(v_q, pg_temp.u(9999))) = '0',
        'F4: un pago inexistente responde igual que uno ajeno (cero filas)');
    PERFORM pg_temp.afirmar(
        pg_temp.como(NULL, 'anon', 'leer', pg_catalog.format(v_q, pg_temp.u(1001))) = 'E42501',
        'F4: anon recibe 42501');
END;
$$;


-- ================================================================
-- G. IDENTIDAD: METADATA, ROL Y VÍNCULO VIGENTES, BLOQUEO
-- ================================================================
DO $$
DECLARE
    v_q TEXT := 'SELECT pg_catalog.count(*) FROM public.facturas WHERE alumno_id IN (%L, %L)';
    v_f TEXT := pg_catalog.format(v_q, pg_temp.u(2), pg_temp.u(3));
BEGIN
    -- G1. user_metadata / app_metadata del JWT no autorizan nada.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer', v_f,
            '{"user_metadata": {"rol": "DIRECTOR", "role": "DIRECTOR"}, "app_metadata": {"rol": "DIRECTOR"}}'::JSONB) = '2',
        'G1: metadata de JWT que dice DIRECTOR no amplía al padre (sigue viendo 2, no 3)');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(10), 'authenticated', 'leer', v_f,
            '{"user_metadata": {"rol": "DIRECTOR"}, "app_metadata": {"rol": "DIRECTOR", "role": "DIRECTOR"}}'::JSONB) = '0',
        'G1: un sujeto sin perfil con metadata DIRECTOR no ve nada');
    -- Claims que intentan reemplazar el rol de base de datos o la identidad.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer', v_f, '{"role": "service_role"}'::JSONB) = '2',
        'G1: un claim `role` distinto no cambia el rol efectivo ni el alcance');

    -- G2. Un padre cuyo ROL ya no es PADRE pierde el acceso aunque conserve el vínculo.
    UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
    WHERE id = pg_temp.u(6);
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(6), 'authenticated', 'leer', v_f) = '0',
        'G2: con el rol cambiado a PERSONAL (mismo JWT y vínculo intacto) ya no lee facturas');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(6), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(*) FROM public.comprobantes_pago WHERE id = %L', pg_temp.u(1303))) = '0',
        'G2: ni el archivo que cargó cuando era padre');
    UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PADRE')
    WHERE id = pg_temp.u(6);
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(6), 'authenticated', 'leer', v_f) = '2',
        'G2: restaurado el rol, vuelve a leer');

    -- G3. Un vínculo eliminado corta el acceso con el JWT ya emitido.
    DELETE FROM public.padres_hijos WHERE padre_id = pg_temp.u(6) AND hijo_id = pg_temp.u(2);
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(6), 'authenticated', 'leer', v_f) = '0',
        'G3: desvinculado del hijo, el copadre ya no ve su historial económico');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(6), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(*) FROM public.comprobantes_pago WHERE id = %L', pg_temp.u(1303))) = '0',
        'G3: y tampoco el archivo que cargó antes de desvincularse');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(6), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(*) FROM public.resumen_comprobantes_pago(%L)', pg_temp.u(1002))) = '0',
        'G3: ni el registro del comprobante');
    INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES (pg_temp.u(6), pg_temp.u(2));

    -- G4. Bloqueo posterior al JWT: el mismo JWT deja de ver todo.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer', v_f) = '2',
        'G4: antes del bloqueo el padre A lee sus facturas');
    UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(5);
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer', v_f) = '0',
        'G4: bloqueado, el mismo JWT lee 0 facturas');
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(5), 'authenticated', 'leer',
            pg_catalog.format('SELECT pg_catalog.count(*) FROM public.comprobantes_pago WHERE id = %L', pg_temp.u(1301))) = '0',
        'G4: bloqueado, no lee ni los comprobantes que cargó');
    UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u(5);

    -- G5. Un DIRECTOR bloqueado pierde la lectura completa.
    UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(1);
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(1), 'authenticated', 'leer', v_f) = '0'
        AND pg_temp.como(pg_temp.u(1), 'authenticated', 'leer',
            'SELECT pg_catalog.count(*) FROM public.tarifas') = '0',
        'G5: un DIRECTOR bloqueado no lee economía ni catálogo');
    UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u(1);
END;
$$;


-- ================================================================
-- H. FUNCIONES AUXILIARES
-- ================================================================
DO $$
DECLARE
    v_f TEXT;
    v_rol TEXT;
BEGIN
    FOREACH v_f IN ARRAY ARRAY[
        'app_private.alumno_economico_visible(uuid)',
        'app_private.perfil_padre_actual()',
        'app_private.resumen_comprobantes_pago(uuid)',
        'public.resumen_comprobantes_pago(uuid)'] LOOP
        PERFORM pg_temp.afirmar(pg_catalog.to_regprocedure(v_f) IS NOT NULL, 'H1: existe ' || v_f);
        PERFORM pg_temp.afirmar(
            (SELECT p.prosecdef = (v_f NOT LIKE 'public.%')
                    AND ((v_f LIKE 'public.%') OR 'search_path=""' = ANY (p.proconfig))
                    AND p.provolatile = 's'
             FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_f)),
            'H2: ' || v_f || ' es STABLE y SECURITY DEFINER con search_path vacío (la envoltura pública es INVOKER)');
        PERFORM pg_temp.afirmar(
            (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p,
                    LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
             WHERE p.oid = pg_catalog.to_regprocedure(v_f) AND a.grantee = 0) = 0,
            'H3: PUBLIC sin EXECUTE sobre ' || v_f);
        FOREACH v_rol IN ARRAY ARRAY['anon', 'service_role'] LOOP
            PERFORM pg_temp.afirmar(
                NOT pg_catalog.has_function_privilege(v_rol, v_f, 'EXECUTE'),
                'H3: ' || v_rol || ' sin EXECUTE sobre ' || v_f);
        END LOOP;
        PERFORM pg_temp.afirmar(
            pg_catalog.has_function_privilege('authenticated', v_f, 'EXECUTE'),
            'H3: authenticated con EXECUTE sobre ' || v_f);
    END LOOP;
    -- El helper de visibilidad solo informa sobre el propio llamante.
    PERFORM pg_temp.afirmar(
        pg_temp.como(pg_temp.u(7), 'authenticated', 'leer',
            pg_catalog.format('SELECT (app_private.alumno_economico_visible(%L))::INTEGER', pg_temp.u(2))) = '0'
        AND pg_temp.como(pg_temp.u(7), 'authenticated', 'leer',
            pg_catalog.format('SELECT (app_private.alumno_economico_visible(%L))::INTEGER', pg_temp.u(3))) = '1',
        'H4: el helper responde según la identidad vigente de quien llama');
END;
$$;


-- ================================================================
-- I. POLÍTICAS Y CONFIGURACIÓN DEL BUCKET PRIVADO
-- ================================================================
DO $$
DECLARE v_n INTEGER;
BEGIN
    PERFORM pg_temp.afirmar(
        (SELECT b.public = FALSE AND b.file_size_limit = 5242880
                AND b.allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'application/pdf']::TEXT[]
                AND pg_catalog.cardinality(b.allowed_mime_types) = 3
         FROM storage.buckets b WHERE b.id = 'comprobantes-pago'),
        'I1: bucket comprobantes-pago privado, 5242880 bytes y exactamente JPEG, PNG y PDF');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM storage.buckets) = 1,
        'I1: es el único bucket (no se tocan otros)');

    SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects';
    PERFORM pg_temp.afirmar(v_n = 2, 'I2: storage.objects tiene exactamente dos políticas (' || v_n || ')');
    PERFORM pg_temp.afirmar(
        EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                  AND p.permissive = 'PERMISSIVE' AND p.cmd = 'SELECT'
                  AND p.roles = ARRAY['authenticated']::NAME[]
                  AND p.qual LIKE '%comprobantes-pago%' AND p.qual LIKE '%comprobantes_pago%'),
        'I2: una permisiva de SELECT para authenticated, limitada al bucket y atada a comprobantes_pago');
    PERFORM pg_temp.afirmar(
        EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                  AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL'
                  AND p.roles = ARRAY['authenticated']::NAME[]
                  AND p.qual LIKE '%acceso_bloqueado%' AND p.qual LIKE '%comprobantes-pago%'),
        'I2: una restrictiva de bloqueo limitada al bucket (no altera otros buckets)');
    PERFORM pg_temp.afirmar(
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                      AND p.permissive = 'PERMISSIVE' AND p.cmd <> 'SELECT'),
        'I2: ninguna política permisiva de INSERT, UPDATE ni DELETE (escritura de cliente cerrada)');
    PERFORM pg_temp.afirmar(
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                      AND 'anon' = ANY (p.roles::TEXT[])),
        'I2: ninguna política para anon');
END;
$$;

ROLLBACK;
