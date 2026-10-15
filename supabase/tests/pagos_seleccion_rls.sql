-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Selección y registro de pago (EPT-108)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable e identificada,
-- después de `supabase db reset`. Todo ocurre en una transacción con ROLLBACK.
--
--   docker exec -i supabase_db_ept108 psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/pagos_seleccion_rls.sql
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. Los actores operan
-- con SET ROLE + JWT, igual que PostgREST: los privilegios del propietario solo
-- preparan fixtures y leen el estado resultante.
--
--   A. cotización: totales, varias facturas, importes históricos y selecciones
--      inválidas (vacía, nula, duplicada, inexistente, ajena, mixta);
--   B. exclusión de ítems pagados, en verificación, sin cargo e incoherentes;
--   C. registro: pago pendiente, imputaciones, reserva y saldo intacto;
--   D. idempotencia: reintento, clave con otro contenido, claves por padre;
--   E. consulta del resultado de un intento;
--   F. atomicidad ante un fallo intermedio;
--   G. actores: estudiante, docente, personal, director, bloqueado, anónimo,
--      padre sin vínculo y vínculo revocado;
--   H. superficie: sin escritura directa y sin actor como argumento.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

CREATE TEMPORARY SEQUENCE ept108_n;

CREATE FUNCTION pg_temp.u(p_n INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_catalog.format('b1080000-0000-4000-8000-%s', pg_catalog.lpad(p_n::TEXT, 12, '0'))::UUID $$;

CREATE FUNCTION pg_temp.afirmar(p_condicion BOOLEAN, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := pg_catalog.nextval('ept108_n');
BEGIN
    IF p_condicion IS TRUE THEN
        RAISE NOTICE 'OK %: %', v_n, p_descripcion;
    ELSE
        RAISE EXCEPTION 'FALLO %: %', v_n, p_descripcion;
    END IF;
END;
$$;

-- Ejecuta una consulta escalar con el rol y el JWT indicados; devuelve el valor
-- como texto o 'E' || SQLSTATE. Restaura siempre rol y claims.
CREATE FUNCTION pg_temp.como(p_sub UUID, p_rol TEXT, p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_resultado TEXT;
    v_estado TEXT;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        (pg_catalog.jsonb_build_object('role', p_rol)
         || CASE WHEN p_sub IS NULL THEN '{}'::JSONB
                 ELSE pg_catalog.jsonb_build_object('sub', p_sub) END)::TEXT, TRUE);
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

CREATE TEMPORARY TABLE ept108_valores (k TEXT PRIMARY KEY, v TEXT);
CREATE FUNCTION pg_temp.guardar(p_k TEXT, p_v TEXT) RETURNS TEXT
LANGUAGE sql AS $$
    INSERT INTO ept108_valores VALUES (p_k, p_v)
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v
$$;
CREATE FUNCTION pg_temp.val(p_k TEXT) RETURNS TEXT
LANGUAGE sql AS $$ SELECT v FROM ept108_valores WHERE k = p_k $$;

-- Atajos de llamada. `arr` arma un uuid[] literal con los ítems indicados.
CREATE FUNCTION pg_temp.arr(VARIADIC p_n INTEGER[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT 'ARRAY[' || COALESCE((SELECT pg_catalog.string_agg(
        '''' || pg_temp.u(x)::TEXT || '''', ',') FROM pg_catalog.unnest(p_n) AS x), '') || ']::UUID[]'
$$;
CREATE FUNCTION pg_temp.cotizar(p_arr TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT 'SELECT public.cotizar_pago(' || p_arr || ')::TEXT' $$;
CREATE FUNCTION pg_temp.registrar(p_clave UUID, p_arr TEXT, p_total BIGINT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT 'SELECT public.registrar_pago(''' || p_clave || '''::UUID,' || p_arr || ',' ||
           COALESCE(p_total::TEXT, 'NULL') || '::BIGINT)::TEXT'
$$;
CREATE FUNCTION pg_temp.campo(p_json TEXT, p_campo TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT (p_json::JSONB) ->> p_campo $$;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- 1 DIRECTOR · 2 estudiante A · 3 estudiante B · 4 docente · 5 padre A
-- 6 copadre A · 7 padre C (familia B) · 8 personal · 9 padre bloqueado
-- 12 estudiante A2 (segundo hijo del padre 5) · 13 padre sin vínculos
WITH base_libre AS (
    SELECT base
    FROM generate_series(74000000, 79999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 14) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(n, rol, apellido, legajo) AS (
    VALUES
        (1, 'DIRECTOR',   'Directora',   NULL),
        (2, 'ESTUDIANTE', 'Alumna A',    'LEG-EPT108-0002'),
        (3, 'ESTUDIANTE', 'Alumno B',    'LEG-EPT108-0003'),
        (4, 'DOCENTE',    'Docente 1',   'LEG-EPT108-0004'),
        (5, 'PADRE',      'Padre A',     NULL),
        (6, 'PADRE',      'Copadre A',   NULL),
        (7, 'PADRE',      'Padre C',     NULL),
        (8, 'PERSONAL',   'Personal 1',  NULL),
        (9, 'PADRE',      'Padre bloqueado', NULL),
        (12, 'ESTUDIANTE', 'Alumno A2',  'LEG-EPT108-0012'),
        (13, 'PADRE',     'Padre sin vínculos', NULL)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.u(i.n), pg_temp.u(i.n), r.id, 'Prueba', i.apellido,
       (b.base + i.n)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u(101), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'Curso EPT-108', 'A', TRUE);

INSERT INTO public.matriculas (id, alumno_id, curso_id)
VALUES (pg_temp.u(701), pg_temp.u(2), pg_temp.u(101)),
       (pg_temp.u(702), pg_temp.u(3), pg_temp.u(101)),
       (pg_temp.u(712), pg_temp.u(12), pg_temp.u(101));
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (pg_temp.u(2), pg_temp.u(3), pg_temp.u(12));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES (pg_temp.u(5), pg_temp.u(2)), (pg_temp.u(5), pg_temp.u(12)),
       (pg_temp.u(6), pg_temp.u(2)), (pg_temp.u(9), pg_temp.u(2)),
       (pg_temp.u(7), pg_temp.u(3));

INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
VALUES (pg_temp.u(401), 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        50000.00, '2026-01-01');
INSERT INTO public.tarifas (id, concepto, deporte_id, importe, desde)
VALUES (pg_temp.u(402), 'DEPORTE', 'e0000000-0000-4000-8000-000000000101', 8000.00, '2026-01-01');

INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
VALUES (pg_temp.u(201), 'e0000000-0000-4000-8000-000000000101',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Fútbol EPT-108', 20, pg_temp.u(4));
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
VALUES (1, '17:00', '18:00') ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT pg_temp.u(201), h.id FROM public.horarios h
WHERE h.dia_semana = 1 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00'
ON CONFLICT DO NOTHING;
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id)
VALUES (pg_temp.u(501), pg_temp.u(2), pg_temp.u(201));

CREATE FUNCTION pg_temp.per(p_meses INTEGER) RETURNS DATE
LANGUAGE sql STABLE AS $$
    SELECT (pg_catalog.date_trunc('month',
        app_private.fecha_negocio(pg_catalog.now())::TIMESTAMP)
        + pg_catalog.make_interval(months => p_meses))::DATE
$$;

--   801 A: cuota 8011 (50000) + deporte 8012 (8000)         total 58000
--   802 A: cuota 8021 (50000)
--   803 A: cuota 8031 PAGADA por pago aprobado
--   804 A: cuota 8041 EN_VERIFICACION por un pago pendiente del copadre
--   805 A: total 0, ítem 8051 sin cargo
--   806 A: total 60000 pero la suma de ítems es 50000 (8061): incoherente
--   811 A2: cuota 8111 · 821 B: cuota 8211
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 (pg_temp.u(801), pg_temp.u(2),  pg_temp.per(1),  pg_temp.per(1) + 9, 58000.00),
 (pg_temp.u(802), pg_temp.u(2),  pg_temp.per(2),  pg_temp.per(2) + 9, 50000.00),
 (pg_temp.u(803), pg_temp.u(2),  pg_temp.per(-1), pg_temp.per(-1) + 9, 50000.00),
 (pg_temp.u(804), pg_temp.u(2),  pg_temp.per(-2), pg_temp.per(-2) + 9, 50000.00),
 (pg_temp.u(805), pg_temp.u(2),  pg_temp.per(3),  pg_temp.per(3) + 9, 0.00),
 (pg_temp.u(806), pg_temp.u(2),  pg_temp.per(4),  pg_temp.per(4) + 9, 60000.00),
 (pg_temp.u(811), pg_temp.u(12), pg_temp.per(1),  pg_temp.per(1) + 9, 50000.00),
 (pg_temp.u(821), pg_temp.u(3),  pg_temp.per(1),  pg_temp.per(1) + 9, 50000.00);

INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id,
                                  inscripcion_deportiva_id, importe) VALUES
 (pg_temp.u(8011), pg_temp.u(801), pg_temp.u(2), 'CUOTA',   pg_temp.u(401), pg_temp.u(701), NULL, 50000.00),
 (pg_temp.u(8012), pg_temp.u(801), pg_temp.u(2), 'DEPORTE', pg_temp.u(402), NULL, pg_temp.u(501), 8000.00),
 (pg_temp.u(8021), pg_temp.u(802), pg_temp.u(2), 'CUOTA',   pg_temp.u(401), pg_temp.u(701), NULL, 50000.00),
 (pg_temp.u(8031), pg_temp.u(803), pg_temp.u(2), 'CUOTA',   pg_temp.u(401), pg_temp.u(701), NULL, 50000.00),
 (pg_temp.u(8041), pg_temp.u(804), pg_temp.u(2), 'CUOTA',   pg_temp.u(401), pg_temp.u(701), NULL, 50000.00),
 (pg_temp.u(8051), pg_temp.u(805), pg_temp.u(2), 'CUOTA',   pg_temp.u(401), pg_temp.u(701), NULL, 0.00),
 (pg_temp.u(8061), pg_temp.u(806), pg_temp.u(2), 'CUOTA',   pg_temp.u(401), pg_temp.u(701), NULL, 50000.00),
 (pg_temp.u(8111), pg_temp.u(811), pg_temp.u(12), 'CUOTA',  pg_temp.u(401), pg_temp.u(712), NULL, 50000.00),
 (pg_temp.u(8211), pg_temp.u(821), pg_temp.u(3), 'CUOTA',   pg_temp.u(401), pg_temp.u(702), NULL, 50000.00);

INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en)
VALUES (pg_temp.u(1003), pg_temp.u(5), pg_temp.u(2), 50000.00, 50000.00, CURRENT_DATE,
        'OP-108-03', 'APROBADO', pg_temp.u(1), now());
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
VALUES (pg_temp.u(1004), pg_temp.u(6), pg_temp.u(2), 50000.00);
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe) VALUES
 (pg_temp.u(1003), pg_temp.u(8031), pg_temp.u(2), 50000.00),
 (pg_temp.u(1004), pg_temp.u(8041), pg_temp.u(2), 50000.00);
UPDATE public.items_factura SET estado_pago = 'PAGADO' WHERE id = pg_temp.u(8031);
UPDATE public.items_factura SET estado_pago = 'EN_VERIFICACION' WHERE id = pg_temp.u(8041);

UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(9);

CREATE FUNCTION pg_temp.n_pagos() RETURNS BIGINT LANGUAGE sql AS
$$ SELECT pg_catalog.count(*) FROM public.pagos $$;
CREATE FUNCTION pg_temp.n_imputaciones() RETURNS BIGINT LANGUAGE sql AS
$$ SELECT pg_catalog.count(*) FROM public.imputaciones_pago $$;
CREATE FUNCTION pg_temp.estado_item(p_n INTEGER) RETURNS TEXT LANGUAGE sql AS
$$ SELECT estado_pago::TEXT FROM public.items_factura WHERE id = pg_temp.u(p_n) $$;

-- ================================================================
-- A. COTIZACIÓN
-- ================================================================
SELECT pg_temp.guardar('pagos_antes', pg_temp.n_pagos()::TEXT);
SELECT pg_temp.guardar('imp_antes', pg_temp.n_imputaciones()::TEXT);

SELECT pg_temp.guardar('a1', pg_temp.como(pg_temp.u(5), 'authenticated',
    pg_temp.cotizar(pg_temp.arr(8011, 8012))));
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.val('a1'), 'total_centavos') = '5800000'
    AND pg_temp.campo(pg_temp.val('a1'), 'alumno_id') = pg_temp.u(2)::TEXT
    AND (pg_temp.val('a1')::JSONB -> 'items') @> '[{"tipo": "CUOTA", "importe_centavos": 5000000}]'
    AND (pg_temp.val('a1')::JSONB -> 'items') @> '[{"tipo": "DEPORTE", "importe_centavos": 800000}]',
    'A1: el padre cotiza cuota y deporte de un hijo; total exacto en centavos');
SELECT pg_temp.afirmar(
    (pg_temp.val('a1')::JSONB #>> '{banco,ficticio}') = 'true'
    AND (pg_temp.val('a1')::JSONB #>> '{banco,cbu}') ~ '^0{22}$'
    AND (pg_temp.val('a1')::JSONB #>> '{banco,aviso}') ~* 'ficticios',
    'A2: los datos bancarios son ficticios, fijos y se declaran como tales');
SELECT pg_temp.afirmar(
    pg_temp.n_pagos() = pg_temp.val('pagos_antes')::BIGINT
    AND pg_temp.n_imputaciones() = pg_temp.val('imp_antes')::BIGINT
    AND pg_temp.estado_item(8011) = 'PENDIENTE' AND pg_temp.estado_item(8012) = 'PENDIENTE',
    'A3: cotizar no escribe ni reserva');
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.cotizar(pg_temp.arr(8011, 8021))), 'total_centavos') = '10000000',
    'A4: un pago puede incluir ítems de varias facturas del mismo hijo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8011, 8111))) = 'EP6852',
    'A5: no se mezclan hijos de un mismo padre (P6852)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8211))) = 'EP6851'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8011, 8211))) = 'EP6851',
    'A6: un ítem de otra familia devuelve el mismo error, también mezclado con propios (P6851)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.cotizar('ARRAY[''b1080000-0000-4000-8000-0000000fffff'']::UUID[]')) = 'EP6851',
    'A7: un ítem inexistente es indistinguible de uno ajeno (P6851)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', 'SELECT public.cotizar_pago(ARRAY[]::UUID[])::TEXT') = 'EP6850'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', 'SELECT public.cotizar_pago(NULL)::TEXT') = 'EP6850'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT public.cotizar_pago(ARRAY[''' || pg_temp.u(8011) || ''', NULL]::UUID[])::TEXT') = 'EP6850'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8011, 8011))) = 'EP6850',
    'A8: selección vacía, nula, con elemento nulo o duplicada → P6850');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT public.cotizar_pago((SELECT pg_catalog.array_agg(gen_random_uuid()) FROM generate_series(1, 101)))::TEXT') = 'EP6850',
    'A9: más de 100 ítems → P6850');

-- Importes históricos: cambiar la tarifa vigente no cambia lo que se cotiza.
UPDATE public.tarifas SET importe = 99999.99 WHERE id = pg_temp.u(401);
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.cotizar(pg_temp.arr(8021))), 'total_centavos') = '5000000',
    'A10: el total usa el importe histórico del ítem, no la tarifa actual');

-- ================================================================
-- B. ÍTEMS NO SELECCIONABLES
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8031))) = 'EP6853',
    'B1: un ítem PAGADO no se selecciona (P6853)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8041))) = 'EP6853',
    'B2: un ítem EN_VERIFICACION (pago del copadre) no se selecciona (P6853)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8011, 8031))) = 'EP6853',
    'B3: un ítem no disponible invalida toda la selección, sin cobrar solo el resto');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8051))) = 'EP6854',
    'B4: un ítem sin cargo (importe 0) no es seleccionable (P6854)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8061))) = 'EP6855',
    'B5: una factura con importes incoherentes se rechaza sin corregirla (P6855)');

-- ================================================================
-- C. REGISTRO
-- ================================================================
-- Un total manipulado o desactualizado no escribe nada.
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9101), pg_temp.arr(8021), 1)) = 'EP6857'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9102), pg_temp.arr(8021), 99999999)) = 'EP6857'
    AND pg_temp.n_pagos() = pg_temp.val('pagos_antes')::BIGINT
    AND pg_temp.estado_item(8021) = 'PENDIENTE',
    'C1: un total distinto del calculado por el servidor se rechaza sin escribir (P6857)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9103), pg_temp.arr(8021), NULL)) = 'EP6850',
    'C2: falta el total cotizado → P6850');

SELECT pg_temp.guardar('r1', pg_temp.como(pg_temp.u(5), 'authenticated',
    pg_temp.registrar(pg_temp.u(9001), pg_temp.arr(8011, 8012), 5800000)));
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.val('r1'), 'estado') = 'PENDIENTE_VERIFICACION'
    AND pg_temp.campo(pg_temp.val('r1'), 'total_centavos') = '5800000'
    AND pg_temp.campo(pg_temp.val('r1'), 'repetido') = 'false'
    AND pg_temp.campo(pg_temp.val('r1'), 'pago_id') IS NOT NULL,
    'C3: el registro devuelve un pago PENDIENTE_VERIFICACION con identidad durable');
SELECT pg_temp.afirmar(
    (SELECT p.estado = 'PENDIENTE_VERIFICACION' AND p.padre_id = pg_temp.u(5)
            AND p.alumno_id = pg_temp.u(2) AND p.total_calculado = 58000.00
            AND p.numero_operacion IS NULL AND p.importe_informado IS NULL
            AND p.fecha_transferencia IS NULL AND p.verificado_por IS NULL
     FROM public.pagos p WHERE p.id = pg_temp.campo(pg_temp.val('r1'), 'pago_id')::UUID),
    'C4: el pago es del padre autenticado y deja sin informar fecha, importe y operación (EPT-109)');
SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM public.imputaciones_pago ip
     WHERE ip.pago_id = pg_temp.campo(pg_temp.val('r1'), 'pago_id')::UUID
       AND ip.activa AND ip.alumno_id = pg_temp.u(2)) = 2
    AND (SELECT pg_catalog.sum(ip.importe) FROM public.imputaciones_pago ip
         WHERE ip.pago_id = pg_temp.campo(pg_temp.val('r1'), 'pago_id')::UUID) = 58000.00
    AND pg_temp.estado_item(8011) = 'EN_VERIFICACION'
    AND pg_temp.estado_item(8012) = 'EN_VERIFICACION',
    'C5: dos imputaciones activas por el importe del ítem y reserva EN_VERIFICACION');
SELECT pg_temp.afirmar(
    (SELECT e.saldo_centavos = 5800000 AND e.pagado_centavos = 0
            AND e.estado = 'PENDIENTE' AND e.items_en_verificacion = 2
     FROM public.estado_cuotas_alumno e WHERE e.factura_id = pg_temp.u(801)),
    'C6: el saldo NO baja y la factura no se considera pagada mientras está pendiente');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.cotizar(pg_temp.arr(8011))) = 'EP6853'
    AND pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.cotizar(pg_temp.arr(8012))) = 'EP6853',
    'C7: los ítems reservados dejan de ser seleccionables, también para el copadre');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated',
        pg_temp.registrar(pg_temp.u(9002), pg_temp.arr(8011), 5000000)) = 'EP6853'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9003), pg_temp.arr(8012, 8021), 5800000)) = 'EP6853',
    'C8: claves distintas no reservan dos veces un mismo ítem (P6853)');
SELECT pg_temp.afirmar(
    pg_temp.estado_item(8021) = 'PENDIENTE'
    AND (SELECT pg_catalog.count(*) FROM public.imputaciones_pago
         WHERE item_factura_id = pg_temp.u(8021)) = 0,
    'C9: la selección rechazada no deja reservas parciales');

-- ================================================================
-- D. IDEMPOTENCIA
-- ================================================================
SELECT pg_temp.guardar('r1b', pg_temp.como(pg_temp.u(5), 'authenticated',
    pg_temp.registrar(pg_temp.u(9001), pg_temp.arr(8012, 8011), 5800000)));
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.val('r1b'), 'pago_id') = pg_temp.campo(pg_temp.val('r1'), 'pago_id')
    AND pg_temp.campo(pg_temp.val('r1b'), 'repetido') = 'true'
    AND (SELECT pg_catalog.count(*) FROM public.pagos
         WHERE clave_intento = pg_temp.u(9001)) = 1,
    'D1: el mismo intento y la misma selección (en otro orden) devuelven el mismo pago');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9001), pg_temp.arr(8021), 5000000)) = 'EP6856'
    AND pg_temp.estado_item(8021) = 'PENDIENTE',
    'D2: la misma clave con otro contenido es un conflicto explícito (P6856) y no escribe');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9001), pg_temp.arr(8011), 5000000)) = 'EP6856',
    'D3: un subconjunto de la selección original tampoco reutiliza la clave');

-- La clave está acotada al padre: el copadre puede usar el mismo UUID en su espacio.
SELECT pg_temp.guardar('r2', pg_temp.como(pg_temp.u(6), 'authenticated',
    pg_temp.registrar(pg_temp.u(9001), pg_temp.arr(8021), 5000000)));
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.val('r2'), 'pago_id') <> pg_temp.campo(pg_temp.val('r1'), 'pago_id')
    AND pg_temp.campo(pg_temp.val('r2'), 'repetido') = 'false'
    AND (SELECT padre_id FROM public.pagos
         WHERE id = pg_temp.campo(pg_temp.val('r2'), 'pago_id')::UUID) = pg_temp.u(6),
    'D4: la clave es por padre; el pago queda a nombre de quien lo registró');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9004), pg_temp.arr(8021), 5000000)) = 'EP6853',
    'D5: el padre no puede registrar lo que ya reservó el copadre');

-- ================================================================
-- E. CONSULTA DEL RESULTADO DE UN INTENTO
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT public.consultar_intento_pago(''' || pg_temp.u(9001) || ''')::TEXT'), 'registrado') = 'true'
    AND pg_temp.campo(pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT public.consultar_intento_pago(''' || pg_temp.u(9001) || ''')::TEXT'), 'pago_id')
        = pg_temp.campo(pg_temp.val('r1'), 'pago_id'),
    'E1: un intento confirmado se recupera consultándolo');
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT public.consultar_intento_pago(''' || pg_temp.u(9777) || ''')::TEXT'), 'registrado') = 'false',
    'E2: un intento que nunca llegó se informa como no registrado');
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.como(pg_temp.u(7), 'authenticated',
        'SELECT public.consultar_intento_pago(''' || pg_temp.u(9001) || ''')::TEXT'), 'registrado') = 'false',
    'E3: no se consulta el intento de otro padre');
SELECT pg_temp.afirmar(
    pg_temp.n_pagos() = pg_temp.val('pagos_antes')::BIGINT + 2,
    'E4: consultar no escribe (solo los dos registros de C3 y D4 agregaron pagos)');

-- ================================================================
-- F. ATOMICIDAD
-- ================================================================
CREATE FUNCTION public.zz_ept108_falla() RETURNS TRIGGER LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION USING ERRCODE = 'XX108', MESSAGE = 'fallo intermedio de prueba'; END $$;

CREATE TRIGGER zz_ept108_falla_items BEFORE UPDATE OF estado_pago ON public.items_factura
    FOR EACH ROW EXECUTE FUNCTION public.zz_ept108_falla();
SELECT pg_temp.guardar('pagos_f', pg_temp.n_pagos()::TEXT);
SELECT pg_temp.guardar('imp_f', pg_temp.n_imputaciones()::TEXT);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9201), pg_temp.arr(8111), 5000000)) = 'EXX108'
    AND pg_temp.n_pagos() = pg_temp.val('pagos_f')::BIGINT
    AND pg_temp.n_imputaciones() = pg_temp.val('imp_f')::BIGINT
    AND pg_temp.estado_item(8111) = 'PENDIENTE',
    'F1: un fallo al reservar el ítem no deja pago ni imputaciones huérfanos');
DROP TRIGGER zz_ept108_falla_items ON public.items_factura;

CREATE TRIGGER zz_ept108_falla_imp BEFORE INSERT ON public.imputaciones_pago
    FOR EACH ROW EXECUTE FUNCTION public.zz_ept108_falla();
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9202), pg_temp.arr(8111), 5000000)) = 'EXX108'
    AND pg_temp.n_pagos() = pg_temp.val('pagos_f')::BIGINT
    AND pg_temp.n_imputaciones() = pg_temp.val('imp_f')::BIGINT
    AND pg_temp.estado_item(8111) = 'PENDIENTE',
    'F2: un fallo al imputar no deja un pago sin imputaciones');
DROP TRIGGER zz_ept108_falla_imp ON public.imputaciones_pago;
DROP FUNCTION public.zz_ept108_falla();

SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9201), pg_temp.arr(8111), 5000000)), 'estado') = 'PENDIENTE_VERIFICACION',
    'F3: tras el fallo, el mismo intento puede completarse (no quedó reservado)');

-- ================================================================
-- G. ACTORES
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.cotizar(pg_temp.arr(8021))) = 'E42501'
    AND pg_temp.como(pg_temp.u(2), 'authenticated',
        pg_temp.registrar(pg_temp.u(9301), pg_temp.arr(8021), 5000000)) = 'E42501',
    'G1: el estudiante no cotiza ni registra, ni siquiera sus propios ítems (42501)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(4), 'authenticated', pg_temp.cotizar(pg_temp.arr(8021))) = 'E42501'
    AND pg_temp.como(pg_temp.u(8), 'authenticated',
        pg_temp.registrar(pg_temp.u(9302), pg_temp.arr(8021), 5000000)) = 'E42501'
    AND pg_temp.como(pg_temp.u(1), 'authenticated',
        pg_temp.registrar(pg_temp.u(9303), pg_temp.arr(8021), 5000000)) = 'E42501',
    'G2: docente, personal y director no registran pagos (42501)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(9), 'authenticated', pg_temp.cotizar(pg_temp.arr(8021))) = 'E42501'
    AND pg_temp.como(pg_temp.u(9), 'authenticated',
        pg_temp.registrar(pg_temp.u(9304), pg_temp.arr(8021), 5000000)) = 'E42501',
    'G3: un padre con la cuenta bloqueada no opera aunque conserve el vínculo (42501)');
SELECT pg_temp.afirmar(
    pg_temp.como(NULL, 'anon', pg_temp.cotizar(pg_temp.arr(8021))) = 'E42501'
    AND pg_temp.como(NULL, 'anon', pg_temp.registrar(pg_temp.u(9305), pg_temp.arr(8021), 5000000)) = 'E42501'
    AND pg_temp.como(NULL, 'anon',
        'SELECT public.consultar_intento_pago(''' || pg_temp.u(9001) || ''')::TEXT') = 'E42501',
    'G4: anon no tiene EXECUTE sobre las operaciones (42501)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(13), 'authenticated', pg_temp.cotizar(pg_temp.arr(8021))) = 'EP6851'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.cotizar(pg_temp.arr(8021))) = 'EP6851',
    'G5: un padre sin vínculo con el hijo recibe el error genérico (P6851)');
SELECT pg_temp.afirmar(
    pg_temp.como(NULL, 'authenticated', pg_temp.cotizar(pg_temp.arr(8021))) = 'EP5505',
    'G6: un JWT sin sub se rechaza (P5505)');
SELECT pg_temp.afirmar(
    (pg_temp.como(pg_temp.u(5), 'authenticated', 'SELECT public.datos_bancarios_transferencia()::TEXT')::JSONB ->> 'ficticio') = 'true'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', 'SELECT public.datos_bancarios_transferencia()::TEXT') = 'E42501'
    AND pg_temp.como(pg_temp.u(9), 'authenticated', 'SELECT public.datos_bancarios_transferencia()::TEXT') = 'E42501'
    AND pg_temp.como(NULL, 'anon', 'SELECT public.datos_bancarios_transferencia()::TEXT') = 'E42501',
    'G6b: los datos bancarios ficticios solo los lee una familia habilitada');

-- Vínculo revocado: el siguiente registro se rechaza y no escribe.
DELETE FROM public.padres_hijos WHERE padre_id = pg_temp.u(5) AND hijo_id = pg_temp.u(12);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.registrar(pg_temp.u(9306), pg_temp.arr(8111), 5000000)) = 'EP6851'
    AND pg_temp.estado_item(8111) = 'EN_VERIFICACION',
    'G7: con el vínculo revocado no se registra (P6851); lo ya reservado no se libera');
-- Un pago ya confirmado no se re-expone a quien perdió el vínculo con ese hijo.
SELECT pg_temp.afirmar(
    pg_temp.campo(pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT public.consultar_intento_pago(''' || pg_temp.u(9201) || ''')::TEXT'), 'registrado') = 'true',
    'G8: el intento sigue consultable por el padre que lo hizo');

-- Cuenta que pasa a BLOQUEADA tras un intento: no opera más.
UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(6);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated',
        pg_temp.registrar(pg_temp.u(9001), pg_temp.arr(8021), 5000000)) = 'E42501',
    'G9: el reintento de una cuenta bloqueada no devuelve el resultado anterior (42501)');
UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u(6);

-- ================================================================
-- H. SUPERFICIE
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'INSERT INTO public.pagos (padre_id, alumno_id, total_calculado) VALUES (''' ||
        pg_temp.u(5) || ''',''' || pg_temp.u(2) || ''', 1) RETURNING id::TEXT') = 'E42501'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'UPDATE public.items_factura SET estado_pago = ''PAGADO'' RETURNING id::TEXT') = 'E42501'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe) VALUES (''' ||
        pg_temp.u(1003) || ''',''' || pg_temp.u(8021) || ''',''' || pg_temp.u(2) || ''', 1) RETURNING 1::TEXT') = 'E42501',
    'H1: ningún cliente escribe pagos, imputaciones ni estados por la vía directa');
SELECT pg_temp.afirmar(
    NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS a(nombre)
        WHERE p.pronamespace IN ('public'::REGNAMESPACE, 'app_private'::REGNAMESPACE)
          AND p.proname IN ('cotizar_pago', 'registrar_pago', 'consultar_intento_pago')
          AND a.nombre ~* '(padre|rol|actor|perfil|usuario|estado|alumno|hijo)'),
    'H2: ninguna operación acepta padre, rol, estado ni alumno como argumento');
SELECT pg_temp.afirmar(
    NOT pg_catalog.has_function_privilege('authenticated',
        'app_private.analizar_seleccion_pago(uuid,uuid[],boolean)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated',
        'app_private.padre_para_pagos(boolean)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role',
        'public.registrar_pago(uuid,uuid[],bigint)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon',
        'public.cotizar_pago(uuid[])', 'EXECUTE'),
    'H3: los auxiliares privados no se exponen y service_role/anon no ejecutan las operaciones');
SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM public.pagos p
     WHERE p.clave_intento IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.imputaciones_pago ip WHERE ip.pago_id = p.id)) = 0
    AND (SELECT pg_catalog.count(*) FROM public.imputaciones_pago ip
         JOIN public.items_factura i ON i.id = ip.item_factura_id
         WHERE ip.activa AND i.estado_pago = 'PENDIENTE') = 0,
    'H4: ningún pago nuevo carece de imputaciones y ningún ítem imputado quedó PENDIENTE');

ROLLBACK;
