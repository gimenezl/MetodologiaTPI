-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Consulta de cuotas (EPT-107)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable e identificada,
-- después de `supabase db reset`. Todo ocurre en una transacción con ROLLBACK.
--
--   docker cp supabase/tests/cuotas_consulta_rls.sql supabase_db_ept107:/tmp/
--   docker exec supabase_db_ept107 psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/cuotas_consulta_rls.sql
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. Los actores se
-- simulan con SET ROLE + JWT, igual que PostgREST.
--
--   A. reglas puras: estado, borde día 10/11 y zona horaria;
--   B. estados y saldos sobre datos sintéticos (cuatro estados, cero,
--      parciales, pendientes, rechazados, imputaciones múltiples);
--   C. historia conservada tras cambiar una tarifa;
--   D. acceso por actor: padre, copadre, estudiante, bloqueado, sin vínculos,
--      personal, director, anónimo, vínculo revocado e identificador ajeno;
--   E. solo lectura y superficie de las vistas.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

CREATE TEMPORARY SEQUENCE ept107_n;

CREATE FUNCTION pg_temp.u(p_n INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_catalog.format('b1070000-0000-4000-8000-%s', pg_catalog.lpad(p_n::TEXT, 12, '0'))::UUID $$;

CREATE FUNCTION pg_temp.afirmar(p_condicion BOOLEAN, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := pg_catalog.nextval('ept107_n');
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

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- 1 DIRECTOR · 2 estudiante A · 3 estudiante B · 4 docente · 5 padre A
-- 6 copadre A · 7 padre C (familia B) · 8 personal · 9 padre bloqueado
-- 12 estudiante A2 (segundo hijo del padre 5) · 13 padre sin vínculos
WITH base_libre AS (
    SELECT base
    FROM generate_series(84000000, 89999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 14) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(n, rol, apellido, legajo) AS (
    VALUES
        (1, 'DIRECTOR',   'Directora',   NULL),
        (2, 'ESTUDIANTE', 'Alumna A',    'LEG-EPT107-0002'),
        (3, 'ESTUDIANTE', 'Alumno B',    'LEG-EPT107-0003'),
        (4, 'DOCENTE',    'Docente 1',   'LEG-EPT107-0004'),
        (5, 'PADRE',      'Padre A',     NULL),
        (6, 'PADRE',      'Copadre A',   NULL),
        (7, 'PADRE',      'Padre C',     NULL),
        (8, 'PERSONAL',   'Personal 1',  NULL),
        (9, 'PADRE',      'Padre bloqueado', NULL),
        (12, 'ESTUDIANTE', 'Alumno A2',  'LEG-EPT107-0012'),
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
        'Curso EPT-107', 'A', TRUE);

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
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Fútbol EPT-107', 20, pg_temp.u(4));
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
VALUES (1, '17:00', '18:00') ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT pg_temp.u(201), h.id FROM public.horarios h
WHERE h.dia_semana = 1 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00'
ON CONFLICT DO NOTHING;
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id)
VALUES (pg_temp.u(501), pg_temp.u(2), pg_temp.u(201));

-- Facturas de A, relativas al día de negocio del servidor:
--   F1 hoy+1 mes  · sin pagos                       → PENDIENTE
--   F2 hoy-2 mes  · cuota aprobada, deporte impago  → VENCIDA (no PAGO_PARCIAL)
--   F3 hoy+2 mes  · cuota aprobada, deporte impago  → PAGO_PARCIAL
--   F4 hoy-3 mes  · cuota aprobada                  → PAGADA
--   F5 hoy-4 mes  · total 0, sin ítems              → PAGADA (importe cero)
--   F6 hoy+3 mes  · pago pendiente de verificación  → PENDIENTE
--   F7 hoy+4 mes  · pago rechazado                  → PENDIENTE
--   F8 hoy-5 mes  · UN pago aprobado, DOS imputaciones → PAGADA (sin doble conteo)
-- Factura de A2 (hoy+1 mes) y de B (hoy+1 mes).
CREATE FUNCTION pg_temp.per(p_meses INTEGER) RETURNS DATE
LANGUAGE sql STABLE AS $$
    SELECT (pg_catalog.date_trunc('month',
        app_private.fecha_negocio(pg_catalog.now())::TIMESTAMP)
        + pg_catalog.make_interval(months => p_meses))::DATE
$$;

INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 (pg_temp.u(801), pg_temp.u(2),  pg_temp.per(1),  pg_temp.per(1) + 9, 58000.00),
 (pg_temp.u(802), pg_temp.u(2),  pg_temp.per(-2), pg_temp.per(-2) + 9, 58000.00),
 (pg_temp.u(803), pg_temp.u(2),  pg_temp.per(2),  pg_temp.per(2) + 9, 58000.00),
 (pg_temp.u(804), pg_temp.u(2),  pg_temp.per(-3), pg_temp.per(-3) + 9, 50000.00),
 (pg_temp.u(805), pg_temp.u(2),  pg_temp.per(-4), pg_temp.per(-4) + 9, 0.00),
 (pg_temp.u(806), pg_temp.u(2),  pg_temp.per(3),  pg_temp.per(3) + 9, 50000.00),
 (pg_temp.u(807), pg_temp.u(2),  pg_temp.per(4),  pg_temp.per(4) + 9, 50000.00),
 (pg_temp.u(808), pg_temp.u(2),  pg_temp.per(-5), pg_temp.per(-5) + 9, 58000.00),
 (pg_temp.u(811), pg_temp.u(12), pg_temp.per(1),  pg_temp.per(1) + 9, 50000.00),
 (pg_temp.u(821), pg_temp.u(3),  pg_temp.per(1),  pg_temp.per(1) + 9, 50000.00);

-- Ítems: la cuota (matrícula) y el deporte donde corresponde.
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id,
                                  inscripcion_deportiva_id, importe)
SELECT pg_temp.u(f.n * 10 + 1), pg_temp.u(f.n), pg_temp.u(2), 'CUOTA', pg_temp.u(401),
       pg_temp.u(701), NULL, 50000.00
FROM (VALUES (801), (802), (803), (804), (806), (807), (808)) AS f(n);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id,
                                  inscripcion_deportiva_id, importe)
SELECT pg_temp.u(f.n * 10 + 2), pg_temp.u(f.n), pg_temp.u(2), 'DEPORTE', pg_temp.u(402),
       NULL, pg_temp.u(501), 8000.00
FROM (VALUES (801), (802), (803), (808)) AS f(n);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
VALUES (pg_temp.u(8111), pg_temp.u(811), pg_temp.u(12), 'CUOTA', pg_temp.u(401), pg_temp.u(712), 50000.00),
       (pg_temp.u(8211), pg_temp.u(821), pg_temp.u(3),  'CUOTA', pg_temp.u(401), pg_temp.u(702), 50000.00);

-- Pagos aprobados (con rastro completo), uno pendiente y uno rechazado.
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en)
VALUES
 (pg_temp.u(1002), pg_temp.u(5), pg_temp.u(2), 50000.00, 50000.00, CURRENT_DATE, 'OP-107-02', 'APROBADO', pg_temp.u(1), now()),
 (pg_temp.u(1003), pg_temp.u(5), pg_temp.u(2), 50000.00, 50000.00, CURRENT_DATE, 'OP-107-03', 'APROBADO', pg_temp.u(1), now()),
 (pg_temp.u(1004), pg_temp.u(5), pg_temp.u(2), 50000.00, 50000.00, CURRENT_DATE, 'OP-107-04', 'APROBADO', pg_temp.u(1), now()),
 (pg_temp.u(1008), pg_temp.u(5), pg_temp.u(2), 58000.00, 58000.00, CURRENT_DATE, 'OP-107-08', 'APROBADO', pg_temp.u(1), now());
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
VALUES (pg_temp.u(1006), pg_temp.u(5), pg_temp.u(2), 50000.00);
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en, motivo_rechazo)
VALUES (pg_temp.u(1007), pg_temp.u(5), pg_temp.u(2), 50000.00, 50000.00, CURRENT_DATE,
        'OP-107-07', 'RECHAZADO', pg_temp.u(1), now(), 'Comprobante ilegible');

INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa) VALUES
 (pg_temp.u(1002), pg_temp.u(8021), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1003), pg_temp.u(8031), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1004), pg_temp.u(8041), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1006), pg_temp.u(8061), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1007), pg_temp.u(8071), pg_temp.u(2), 50000.00, FALSE),
 (pg_temp.u(1008), pg_temp.u(8081), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1008), pg_temp.u(8082), pg_temp.u(2),  8000.00, TRUE);
UPDATE public.items_factura SET estado_pago = 'PAGADO'
WHERE id IN (pg_temp.u(8021), pg_temp.u(8031), pg_temp.u(8041), pg_temp.u(8081), pg_temp.u(8082));
UPDATE public.items_factura SET estado_pago = 'EN_VERIFICACION' WHERE id = pg_temp.u(8061);

UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(9);

-- ================================================================
-- A. REGLAS PURAS
-- ================================================================
SELECT pg_temp.afirmar(app_private.estado_cuota(100, 0, '2026-11-10', '2026-11-10') = 'PENDIENTE',
    'A1: el día 10 (vencimiento) todavía no está vencida');
SELECT pg_temp.afirmar(app_private.estado_cuota(100, 0, '2026-11-10', '2026-11-11') = 'VENCIDA',
    'A2: el día 11 está vencida');
SELECT pg_temp.afirmar(app_private.estado_cuota(100, 40, '2026-11-10', '2026-11-11') = 'VENCIDA',
    'A3: con saldo posterior al vencimiento prevalece VENCIDA sobre PAGO_PARCIAL');
SELECT pg_temp.afirmar(app_private.estado_cuota(100, 40, '2026-11-10', '2026-11-09') = 'PAGO_PARCIAL',
    'A4: PAGO_PARCIAL solo antes del vencimiento');
SELECT pg_temp.afirmar(app_private.estado_cuota(100, 100, '2026-11-10', '2026-12-01') = 'PAGADA',
    'A5: saldada es PAGADA aunque haya pasado el vencimiento');
SELECT pg_temp.afirmar(app_private.estado_cuota(0, 0, '2026-11-10', '2026-12-01') = 'PAGADA',
    'A6: importe cero es PAGADA');
SELECT pg_temp.afirmar(
    app_private.fecha_negocio('2026-11-11 02:30:00+00') = DATE '2026-11-10'
    AND app_private.fecha_negocio('2026-11-11 03:00:00+00') = DATE '2026-11-11',
    'A7: la fecha de corte usa America/Argentina/Buenos_Aires (UTC−3)');

-- ================================================================
-- B. ESTADOS Y SALDOS
-- ================================================================
CREATE FUNCTION pg_temp.fila(p_factura INTEGER, OUT estado TEXT, OUT total BIGINT,
                             OUT pagado BIGINT, OUT saldo BIGINT, OUT inconsistente BOOLEAN,
                             OUT en_verificacion INTEGER)
LANGUAGE sql AS $$
    SELECT v.estado, v.total_centavos, v.pagado_centavos, v.saldo_centavos,
           v.inconsistente, v.items_en_verificacion
    FROM public.estado_cuotas_alumno v WHERE v.factura_id = pg_temp.u(p_factura)
$$;

SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(801)) = 'PENDIENTE'
    AND (SELECT saldo FROM pg_temp.fila(801)) = 5800000,
    'B1: sin pagos → PENDIENTE con saldo íntegro en centavos');
SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(802)) = 'VENCIDA'
    AND (SELECT saldo FROM pg_temp.fila(802)) = 800000
    AND (SELECT pagado FROM pg_temp.fila(802)) = 5000000,
    'B2: pago parcial + vencimiento pasado → VENCIDA');
SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(803)) = 'PAGO_PARCIAL'
    AND (SELECT saldo FROM pg_temp.fila(803)) = 800000,
    'B3: pago parcial antes del vencimiento → PAGO_PARCIAL');
SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(804)) = 'PAGADA'
    AND (SELECT saldo FROM pg_temp.fila(804)) = 0,
    'B4: saldada → PAGADA');
SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(805)) = 'PAGADA'
    AND (SELECT total FROM pg_temp.fila(805)) = 0
    AND NOT (SELECT inconsistente FROM pg_temp.fila(805)),
    'B5: factura de importe cero → PAGADA, coherente');
SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(806)) = 'PENDIENTE'
    AND (SELECT saldo FROM pg_temp.fila(806)) = 5000000
    AND (SELECT en_verificacion FROM pg_temp.fila(806)) = 1,
    'B6: un pago pendiente de verificación NO reduce el saldo y se informa');
SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(807)) = 'PENDIENTE'
    AND (SELECT saldo FROM pg_temp.fila(807)) = 5000000,
    'B7: un pago rechazado NO reduce el saldo');
SELECT pg_temp.afirmar((SELECT estado FROM pg_temp.fila(808)) = 'PAGADA'
    AND (SELECT pagado FROM pg_temp.fila(808)) = 5800000
    AND (SELECT saldo FROM pg_temp.fila(808)) = 0
    AND NOT (SELECT inconsistente FROM pg_temp.fila(808)),
    'B8: un pago con varias imputaciones suma cada ítem una vez (sin doble conteo)');
SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM public.estado_cuotas_alumno
     WHERE factura_id::TEXT LIKE 'b1070000-%' AND inconsistente) = 0,
    'B9: ninguna factura sintética coherente se marca inconsistente');
SELECT pg_temp.afirmar(
    (SELECT fecha_corte FROM public.estado_cuotas_alumno LIMIT 1)
        = app_private.fecha_negocio(pg_catalog.now()),
    'B10: la fecha de corte es la del servidor');
SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM public.detalle_cuotas_items
     WHERE factura_id = pg_temp.u(808)) = 2
    AND (SELECT pg_catalog.sum(pagado_centavos) FROM public.detalle_cuotas_items
         WHERE factura_id = pg_temp.u(808)) = 5800000,
    'B11: el detalle muestra cuota y deporte con lo imputado');

-- Inconsistencias que NO se ocultan: una imputación parcial del ítem.
UPDATE public.imputaciones_pago SET importe = 30000.00
WHERE pago_id = pg_temp.u(1002) AND item_factura_id = pg_temp.u(8021);
SELECT pg_temp.afirmar((SELECT inconsistente FROM pg_temp.fila(802))
    AND (SELECT saldo FROM pg_temp.fila(802)) = 2800000,
    'B12: una imputación distinta del importe del ítem se declara inconsistente, sin normalizar');
UPDATE public.imputaciones_pago SET importe = 50000.00
WHERE pago_id = pg_temp.u(1002) AND item_factura_id = pg_temp.u(8021);

-- ================================================================
-- C. HISTORIA CONSERVADA
-- ================================================================
UPDATE public.tarifas SET importe = 99999.99 WHERE id = pg_temp.u(401);
SELECT pg_temp.afirmar((SELECT total FROM pg_temp.fila(802)) = 5800000
    AND (SELECT importe_centavos FROM public.detalle_cuotas_items
         WHERE item_id = pg_temp.u(8021)) = 5000000,
    'C1: cambiar la tarifa no recalcula ítems ni totales históricos');

-- ================================================================
-- D. ACCESO POR ACTOR
-- ================================================================
CREATE FUNCTION pg_temp.n_estado(p_where TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT 'SELECT pg_catalog.count(*)::TEXT FROM public.estado_cuotas_alumno WHERE ' || p_where $$;
CREATE FUNCTION pg_temp.n_detalle(p_where TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT 'SELECT pg_catalog.count(*)::TEXT FROM public.detalle_cuotas_items WHERE ' || p_where $$;

-- Predicado de los datos sintéticos de esta prueba.
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.n_estado('alumno_id IN (''' || pg_temp.u(2) || ''',''' || pg_temp.u(12) || ''')')) = '9',
    'D1: el padre con dos hijos ve las 9 facturas de ambos y ninguna ajena');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.n_estado('alumno_id = ''' || pg_temp.u(3) || '''')) = '0',
    'D2: el padre no ve facturas de un alumno que no es su hijo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.n_estado('factura_id = ''' || pg_temp.u(821) || '''')) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.n_detalle('factura_id = ''' || pg_temp.u(821) || '''')) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.n_detalle('item_id = ''' || pg_temp.u(8211) || '''')) = '0',
    'D3: un identificador de otra familia (factura o ítem) no devuelve nada');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.n_estado('alumno_id = ''' || pg_temp.u(12) || '''')) = '1'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.n_estado('alumno_id = ''' || pg_temp.u(2) || '''')) = '8',
    'D4: la consulta por hijo no mezcla datos entre hijos (8 y 1)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.n_estado('TRUE')) = '8'
    AND pg_temp.como(pg_temp.u(2), 'authenticated',
        pg_temp.n_estado('alumno_id <> ''' || pg_temp.u(2) || '''')) = '0',
    'D5: el estudiante ve solo sus propias facturas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.n_estado('TRUE')) = '1',
    'D6: el estudiante de otra familia ve solo la suya');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(9), 'authenticated', pg_temp.n_estado('TRUE')) = '0'
    AND pg_temp.como(pg_temp.u(9), 'authenticated', pg_temp.n_detalle('TRUE')) = '0',
    'D7: la cuenta bloqueada no ve nada aunque conserve el vínculo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(13), 'authenticated', pg_temp.n_estado('TRUE')) = '0',
    'D8: un padre sin vínculos no ve ninguna factura');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(8), 'authenticated', pg_temp.n_estado('TRUE')) = '0'
    AND pg_temp.como(pg_temp.u(4), 'authenticated', pg_temp.n_estado('TRUE')) = '0',
    'D9: PERSONAL y DOCENTE no ven cuotas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(1), 'authenticated', pg_temp.n_estado('factura_id::TEXT LIKE ''b1070000-%''')) = '10',
    'D10: DIRECTOR ve todas las facturas sintéticas');
SELECT pg_temp.afirmar(
    pg_temp.como(NULL, 'anon', pg_temp.n_estado('TRUE')) = 'E42501'
    AND pg_temp.como(NULL, 'anon', pg_temp.n_detalle('TRUE')) = 'E42501',
    'D11: anon no puede leer las vistas (42501)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated',
        pg_temp.n_estado('alumno_id = ''' || pg_temp.u(2) || '''')) = '8',
    'D12: el copadre vinculado ve al hijo');
DELETE FROM public.padres_hijos WHERE padre_id = pg_temp.u(6) AND hijo_id = pg_temp.u(2);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.n_estado('TRUE')) = '0'
    AND pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.n_detalle('TRUE')) = '0',
    'D13: el vínculo revocado corta el acceso de inmediato');

-- ================================================================
-- E. SOLO LECTURA Y SUPERFICIE
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'UPDATE public.estado_cuotas_alumno SET total_centavos = 0 RETURNING 1')
        IN ('E42501', 'E55000')
    AND pg_temp.como(pg_temp.u(1), 'authenticated',
        'DELETE FROM public.detalle_cuotas_items RETURNING 1') IN ('E42501', 'E55000')
    AND pg_temp.como(pg_temp.u(1), 'authenticated',
        'INSERT INTO public.detalle_cuotas_items (item_id) VALUES (NULL) RETURNING 1')
        IN ('E42501', 'E55000')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.estado_cuotas_alumno', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.detalle_cuotas_items', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.estado_cuotas_alumno', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.estado_cuotas_alumno', 'SELECT'),
    'E1: ningún rol de aplicación ni service_role escribe a través de las vistas');
SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
     WHERE c.oid IN ('public.estado_cuotas_alumno'::REGCLASS, 'public.detalle_cuotas_items'::REGCLASS)
       AND c.reloptions @> ARRAY['security_invoker=true']) = 2,
    'E2: ambas vistas son security_invoker (RLS del invocador)');
SELECT pg_temp.afirmar(
    NOT EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND c.table_name IN ('estado_cuotas_alumno', 'detalle_cuotas_items')
                  AND c.column_name ~* '(ruta|archivo|comprobante|operacion|path)'),
    'E3: las vistas no exponen rutas, comprobantes ni números de operación');
SELECT pg_temp.afirmar(
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                WHERE p.pronamespace = 'app_private'::REGNAMESPACE
                  AND p.proname IN ('fecha_negocio', 'estado_cuota') AND p.prosecdef),
    'E4: las reglas puras no son SECURITY DEFINER');

ROLLBACK;
