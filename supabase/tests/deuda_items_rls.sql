-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Historial de deuda por ítem (EPT-114, HU13)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable e identificada,
-- después de `supabase db reset`. Todo ocurre en una transacción con ROLLBACK.
--
--   docker cp supabase/tests/deuda_items_rls.sql supabase_db_ept114:/tmp/
--   docker exec supabase_db_ept114 psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/deuda_items_rls.sql
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. Los actores se
-- simulan con SET ROLE + JWT, igual que PostgREST; el rol administrativo solo
-- prepara datos. Los resultados esperados se calculan A MANO desde el fixture
-- (importes y estados escritos a la vista), nunca con la función bajo prueba.
--
--   A. alcance por actor: padre, copadre, estudiante, director, ajenos, bloqueo;
--   B. cálculo: importe, pagado, saldo, estados, subtotales, total adeudado;
--   C. etiquetas históricas: inscripción cancelada, catálogo inactivo;
--   D. filtro por período de factura: extremos, cambio de año, pagos fuera del rango;
--   E. historial grande: paginación completa, orden estable, total de alta precisión;
--   F. huella entre páginas y validación de parámetros;
--   G. consistencia con estado_cuotas_alumno (EPT-107) e inconsistencias declaradas;
--   H. solo lectura, ACL y superficie.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

CREATE TEMPORARY SEQUENCE ept114_n;

CREATE FUNCTION pg_temp.u(p_n INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_catalog.format('b1140000-0000-4000-8000-%s', pg_catalog.lpad(p_n::TEXT, 12, '0'))::UUID $$;

CREATE FUNCTION pg_temp.afirmar(p_condicion BOOLEAN, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := pg_catalog.nextval('ept114_n');
BEGIN
    IF p_condicion IS TRUE THEN
        RAISE NOTICE 'OK %: % [%]', v_n, p_descripcion, pg_catalog.to_char(pg_catalog.clock_timestamp(), 'HH24:MI:SS');
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

-- SQL de la RPC pública (lo que ve PostgREST). `p_proy` es una expresión sobre el documento `d`.
CREATE FUNCTION pg_temp.q(p_alumno UUID, p_proy TEXT, p_desde TEXT DEFAULT NULL, p_hasta TEXT DEFAULT NULL,
                          p_pagina INTEGER DEFAULT 1, p_tamano INTEGER DEFAULT 50, p_huella TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT 'SELECT (' || p_proy || ')::TEXT FROM public.historial_deuda_items('
          || COALESCE('''' || p_alumno || '''::UUID', 'NULL') || ', '
          || COALESCE('''' || p_desde || '''::DATE', 'NULL') || ', '
          || COALESCE('''' || p_hasta || '''::DATE', 'NULL') || ', '
          || COALESCE(p_pagina::TEXT, 'NULL') || ', '
          || COALESCE(p_tamano::TEXT, 'NULL') || ', '
          || COALESCE('''' || p_huella || '''', 'NULL') || ') AS d' $$;

-- Proyecciones frecuentes.
CREATE FUNCTION pg_temp.total() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT '(d->>''total'')' $$;
CREATE FUNCTION pg_temp.adeudado() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT '(d->''totales''->>''adeudado_centavos'')' $$;
CREATE FUNCTION pg_temp.fila(p_item UUID, p_campo TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT '(SELECT e->>''' || p_campo || ''' FROM jsonb_array_elements(d->''filas'') e WHERE e->>''item_id'' = '''
          || p_item || ''')' $$;
CREATE FUNCTION pg_temp.grupo(p_clave TEXT, p_campo TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT '(SELECT g->>''' || p_campo || ''' FROM jsonb_array_elements(d->''grupos'') g WHERE g->>''clave'' = '''
          || p_clave || ''')' $$;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- 1 DIRECTOR · 2 estudiante A · 3 estudiante B · 4 docente · 5 padre A
-- 6 copadre A · 7 padre C (familia B) · 8 personal · 9 padre bloqueado
-- 12 estudiante A2 (historial grande) · 13 padre sin vínculos · 14 estudiante A3 (sin facturas)
WITH base_libre AS (
    SELECT base
    FROM generate_series(90000000, 94999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 15) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(n, rol, apellido, legajo) AS (
    VALUES
        (1, 'DIRECTOR',   'Directora',   NULL),
        (2, 'ESTUDIANTE', 'Alumna A',    'LEG-EPT114-0002'),
        (3, 'ESTUDIANTE', 'Alumno B',    'LEG-EPT114-0003'),
        (4, 'DOCENTE',    'Docente 1',   'LEG-EPT114-0004'),
        (5, 'PADRE',      'Padre A',     NULL),
        (6, 'PADRE',      'Copadre A',   NULL),
        (7, 'PADRE',      'Padre C',     NULL),
        (8, 'PERSONAL',   'Personal 1',  NULL),
        (9, 'PADRE',      'Padre bloqueado', NULL),
        (12, 'ESTUDIANTE', 'Alumno A2',  'LEG-EPT114-0012'),
        (13, 'PADRE',     'Padre sin vínculos', NULL),
        (14, 'ESTUDIANTE', 'Alumno A3',  'LEG-EPT114-0014')
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.u(i.n), pg_temp.u(i.n), r.id, 'Prueba', i.apellido,
       (b.base + i.n)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u(101), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'Curso EPT-114', 'A', TRUE);

INSERT INTO public.matriculas (id, alumno_id, curso_id)
VALUES (pg_temp.u(701), pg_temp.u(2), pg_temp.u(101)),
       (pg_temp.u(702), pg_temp.u(3), pg_temp.u(101)),
       (pg_temp.u(712), pg_temp.u(12), pg_temp.u(101)),
       (pg_temp.u(714), pg_temp.u(14), pg_temp.u(101));
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (pg_temp.u(2), pg_temp.u(3), pg_temp.u(12), pg_temp.u(14));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES (pg_temp.u(5), pg_temp.u(2)), (pg_temp.u(5), pg_temp.u(12)), (pg_temp.u(5), pg_temp.u(14)),
       (pg_temp.u(6), pg_temp.u(2)), (pg_temp.u(9), pg_temp.u(2)),
       (pg_temp.u(7), pg_temp.u(3));

-- Tarifas: una por concepto y referencia. Los importes reales de los ítems son los de cada fila.
INSERT INTO public.tarifas (id, concepto, nivel_id, deporte_id, servicio_id, importe, desde) VALUES
 (pg_temp.u(401), 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), NULL, NULL, 50000.00, '2025-01-01'),
 (pg_temp.u(402), 'DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000101', NULL, 8000.00, '2025-01-01'),
 (pg_temp.u(403), 'DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000102', NULL, 9000.00, '2025-01-01'),
 (pg_temp.u(404), 'TRANSPORTE', NULL, NULL, 'e0000000-0000-4000-8000-000000000021', 12000.00, '2025-01-01'),
 (pg_temp.u(405), 'TRANSPORTE', NULL, NULL, 'e0000000-0000-4000-8000-000000000020', 0.00, '2025-01-01'),
 (pg_temp.u(406), 'COMEDOR', NULL, NULL, 'e0000000-0000-4000-8000-000000000010', 7000.00, '2025-01-01');

-- Dos grupos de Primario: Fútbol (activo) y Natación (cuya inscripción se cancela y cuyo grupo se desactiva).
INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
VALUES (pg_temp.u(201), 'e0000000-0000-4000-8000-000000000101',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Fútbol EPT-114', 20, pg_temp.u(4)),
       (pg_temp.u(202), 'e0000000-0000-4000-8000-000000000102',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Natación EPT-114', 20, pg_temp.u(4));
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
VALUES (1, '17:00', '18:00'), (3, '17:00', '18:00')
ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT pg_temp.u(201), h.id FROM public.horarios h
WHERE h.dia_semana = 1 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00' ON CONFLICT DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT pg_temp.u(202), h.id FROM public.horarios h
WHERE h.dia_semana = 3 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00' ON CONFLICT DO NOTHING;

-- Alumna A: Fútbol activa (501), Natación cancelada con grupo luego inactivo (502), comedor (601),
-- recorrido Norte cancelado (602) y Sur activo (603).
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id)
VALUES (pg_temp.u(501), pg_temp.u(2), pg_temp.u(201)),
       (pg_temp.u(502), pg_temp.u(2), pg_temp.u(202));
INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id)
VALUES (pg_temp.u(601), pg_temp.u(2), 'e0000000-0000-4000-8000-000000000010'),
       (pg_temp.u(602), pg_temp.u(2), 'e0000000-0000-4000-8000-000000000020');
-- Un solo recorrido activo por alumno: el Norte se cancela antes de inscribir el Sur (los ítems se facturan después).
UPDATE public.inscripciones_servicios SET estado = 'CANCELADA' WHERE id = pg_temp.u(602);
INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id)
VALUES (pg_temp.u(603), pg_temp.u(2), 'e0000000-0000-4000-8000-000000000021');

-- Facturas de A (importes en pesos):
--   F1 2025-11  cuota 50000 · fútbol 8000 · natación 9000                 sin ningún pago aprobado
--   F2 2025-12  cuota 50000 · fútbol 8000 · transporte Sur 12000          cuota y fútbol pagados; Sur en verificación
--   F3 2026-01  cuota 50000 · comedor 7000 · transporte Norte 0           cuota pagada; comedor rechazado; Norte sin cargo
--   F4 2026-02  cuota 50000                                               pagada con transferencia fuera del período
--   F5 2099-01  cuota 50000 · fútbol 8000                                 futura, sin pagos, no vencida
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 (pg_temp.u(801), pg_temp.u(2), '2025-11-01', '2025-11-10', 67000.00),
 (pg_temp.u(802), pg_temp.u(2), '2025-12-01', '2025-12-10', 70000.00),
 (pg_temp.u(803), pg_temp.u(2), '2026-01-01', '2026-01-10', 57000.00),
 (pg_temp.u(804), pg_temp.u(2), '2026-02-01', '2026-02-10', 50000.00),
 (pg_temp.u(805), pg_temp.u(2), '2099-01-01', '2099-01-10', 58000.00),
 (pg_temp.u(821), pg_temp.u(3), '2025-12-01', '2025-12-10', 50000.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id,
        inscripcion_deportiva_id, inscripcion_servicio_id, importe) VALUES
 (pg_temp.u(8011), pg_temp.u(801), pg_temp.u(2), 'CUOTA',      pg_temp.u(401), pg_temp.u(701), NULL, NULL, 50000.00),
 (pg_temp.u(8012), pg_temp.u(801), pg_temp.u(2), 'DEPORTE',    pg_temp.u(402), NULL, pg_temp.u(501), NULL, 8000.00),
 (pg_temp.u(8013), pg_temp.u(801), pg_temp.u(2), 'DEPORTE',    pg_temp.u(403), NULL, pg_temp.u(502), NULL, 9000.00),
 (pg_temp.u(8021), pg_temp.u(802), pg_temp.u(2), 'CUOTA',      pg_temp.u(401), pg_temp.u(701), NULL, NULL, 50000.00),
 (pg_temp.u(8022), pg_temp.u(802), pg_temp.u(2), 'DEPORTE',    pg_temp.u(402), NULL, pg_temp.u(501), NULL, 8000.00),
 (pg_temp.u(8023), pg_temp.u(802), pg_temp.u(2), 'TRANSPORTE', pg_temp.u(404), NULL, NULL, pg_temp.u(603), 12000.00),
 (pg_temp.u(8031), pg_temp.u(803), pg_temp.u(2), 'CUOTA',      pg_temp.u(401), pg_temp.u(701), NULL, NULL, 50000.00),
 (pg_temp.u(8032), pg_temp.u(803), pg_temp.u(2), 'COMEDOR',    pg_temp.u(406), NULL, NULL, pg_temp.u(601), 7000.00),
 (pg_temp.u(8033), pg_temp.u(803), pg_temp.u(2), 'TRANSPORTE', pg_temp.u(405), NULL, NULL, pg_temp.u(602), 0.00),
 (pg_temp.u(8041), pg_temp.u(804), pg_temp.u(2), 'CUOTA',      pg_temp.u(401), pg_temp.u(701), NULL, NULL, 50000.00),
 (pg_temp.u(8051), pg_temp.u(805), pg_temp.u(2), 'CUOTA',      pg_temp.u(401), pg_temp.u(701), NULL, NULL, 50000.00),
 (pg_temp.u(8052), pg_temp.u(805), pg_temp.u(2), 'DEPORTE',    pg_temp.u(402), NULL, pg_temp.u(501), NULL, 8000.00),
 (pg_temp.u(8211), pg_temp.u(821), pg_temp.u(3), 'CUOTA',      pg_temp.u(401), pg_temp.u(702), NULL, NULL, 50000.00);

-- Con los ítems ya facturados: se cancelan inscripciones y se desactiva un grupo. La historia se conserva.
UPDATE public.inscripciones_deportivas SET estado = 'CANCELADA' WHERE id = pg_temp.u(502);
UPDATE public.grupos_deportivos SET activo = FALSE WHERE id = pg_temp.u(202);

-- Pagos:
--   P1 padre 5 · APROBADO · F2 cuota + F2 fútbol + F3 cuota = 108000 imputados, 100000 informados
--   P2 copadre 6 · PENDIENTE_VERIFICACION · F2 transporte Sur 12000 (reserva el ítem, no baja la deuda)
--   P3 padre 5 · APROBADO · F4 cuota 50000 imputados, 49000 informados, transferencia 2026-03-05 (fuera del período)
--   P4 padre 5 · RECHAZADO · F3 comedor 7000 (imputación inactiva: libera la reserva y mantiene la deuda)
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en)
VALUES
 (pg_temp.u(1001), pg_temp.u(5), pg_temp.u(2), 108000.00, 100000.00, '2026-01-05', 'OP-114-01',
  'APROBADO', pg_temp.u(1), now()),
 (pg_temp.u(1003), pg_temp.u(5), pg_temp.u(2), 50000.00, 49000.00, '2026-03-05', 'OP-114-03',
  'APROBADO', pg_temp.u(1), now());
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion)
VALUES (pg_temp.u(1002), pg_temp.u(6), pg_temp.u(2), 12000.00, 12000.00, '2026-02-01', 'OP-114-02');
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en, motivo_rechazo)
VALUES (pg_temp.u(1004), pg_temp.u(5), pg_temp.u(2), 7000.00, 7000.00, '2025-12-31', 'OP-114-04',
        'RECHAZADO', pg_temp.u(1), now(), 'Comprobante ilegible');
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa) VALUES
 (pg_temp.u(1001), pg_temp.u(8021), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1001), pg_temp.u(8022), pg_temp.u(2), 8000.00, TRUE),
 (pg_temp.u(1001), pg_temp.u(8031), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1002), pg_temp.u(8023), pg_temp.u(2), 12000.00, TRUE),
 (pg_temp.u(1003), pg_temp.u(8041), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1004), pg_temp.u(8032), pg_temp.u(2), 7000.00, FALSE);
UPDATE public.items_factura SET estado_pago = 'PAGADO'
WHERE id IN (pg_temp.u(8021), pg_temp.u(8022), pg_temp.u(8031), pg_temp.u(8041));
UPDATE public.items_factura SET estado_pago = 'EN_VERIFICACION' WHERE id = pg_temp.u(8023);

-- Alumno A2: historial grande y de alta precisión. 9.100 facturas mensuales (1266-01 a 2024-04) con una
-- cuota de 9.999.999.999,99 cada una, sin pagos: 9.100 × 999.999.999.999 centavos = 9.099.999.999.990.900,
-- mayor que 2^53 = 9.007.199.254.740.992.
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
SELECT pg_temp.u(100000 + m), pg_temp.u(12),
       (DATE '1266-01-01' + pg_catalog.make_interval(months => m))::DATE,
       (DATE '1266-01-01' + pg_catalog.make_interval(months => m))::DATE + 9,
       9999999999.99
FROM generate_series(0, 9099) AS g(m);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
SELECT pg_temp.u(200000 + m), pg_temp.u(100000 + m), pg_temp.u(12), 'CUOTA', pg_temp.u(401), pg_temp.u(712), 9999999999.99
FROM generate_series(0, 9099) AS g(m);

UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(9);

-- Estadísticas de las filas recién insertadas: sin ellas el planificador estima mal el historial grande, como
-- ocurre con una tabla que todavía no pasó por autovacuum, y la prueba tarda minutos en lugar de segundos.
ANALYZE public.facturas;
ANALYZE public.items_factura;
ANALYZE public.pagos;
ANALYZE public.imputaciones_pago;

-- ================================================================
-- A. ALCANCE POR ACTOR
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '12'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.adeudado())) = '14400000',
    'A1: el padre ve los 12 ítems de su hija y un total adeudado de ARS 144.000,00');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.adeudado())) = '14400000'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.adeudado())) = '14400000'
    AND pg_temp.como(pg_temp.u(1), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.adeudado())) = '14400000',
    'A2: copadre, estudiante propio y DIRECTOR obtienen el mismo total adeudado');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->>''huella'''))
    = pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->>''huella''')),
    'A3: la huella de contenido no depende del actor autorizado');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(3), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q(pg_temp.u(3), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q(pg_temp.u(12), pg_temp.total())) = '0',
    'A4: un alumno de otra familia o de otro estudiante devuelve cero ítems');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(9), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(13), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(8), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(4), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0',
    'A5: cuenta bloqueada, padre sin vínculos, PERSONAL y DOCENTE no ven deuda');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.q('b1140000-0000-4000-8000-00000000ffff'::UUID, pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(NULL, pg_temp.total())) = 'EP6870',
    'A6: un alumno inexistente es indistinguible de uno ajeno; el identificador nulo se rechaza igual para todos');
-- Un documento denegado es idéntico al de un alumno autorizado sin ítems (salvo el instante de lectura).
SELECT pg_temp.afirmar(
    (SELECT pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.q(pg_temp.u(14), '(d - ''leido_en'')::TEXT'))
     = pg_temp.como(pg_temp.u(7), 'authenticated',
        pg_temp.q(pg_temp.u(2), '(d - ''leido_en'')::TEXT')))
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(14), 'd->>''huella'''))
        = 'd41d8cd98f00b204e9800998ecf8427e',
    'A7: la respuesta denegada no revela si el alumno existe ni cuántos ítems tiene');
SELECT pg_temp.afirmar(
    pg_temp.como(NULL, 'anon', pg_temp.q(pg_temp.u(2), pg_temp.total())) = 'E42501',
    'A8: anon no puede ejecutar la consulta (42501)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones_servicios') = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones_deportivas') = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.grupos_deportivos') = '0',
    'A9: los nombres llegan por la RPC; las tablas de inscripción y grupos siguen cerradas para el padre');
UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(3);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.q(pg_temp.u(3), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q(pg_temp.u(3), pg_temp.total())) = '1',
    'A10: un estudiante bloqueado no consulta ni lo propio; su padre habilitado sí');
UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u(3);
UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(5);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0'
    AND pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '12',
    'A11: el padre bloqueado pierde la lectura de inmediato; el copadre habilitado la conserva');
UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u(5);
DELETE FROM public.padres_hijos WHERE padre_id = pg_temp.u(6) AND hijo_id = pg_temp.u(2);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total())) = '0',
    'A12: el vínculo revocado corta la lectura en la siguiente llamada');
INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES (pg_temp.u(6), pg_temp.u(2));
UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL') WHERE id = pg_temp.u(3);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.q(pg_temp.u(3), pg_temp.total())) = '0',
    'A13: quien perdió el rol ESTUDIANTE no consulta ni lo propio');
UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE') WHERE id = pg_temp.u(3);

-- ================================================================
-- B. CÁLCULO: IMPORTE, PAGADO, SALDO, ESTADOS Y SUBTOTALES
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->''totales''->>''importe_centavos''')) = '30200000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->''totales''->>''pagado_centavos''')) = '15800000',
    'B1: importe 302.000,00 − pagado 158.000,00 = adeudado 144.000,00 (solo imputaciones activas de pagos aprobados)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2),
        'd->''totales''->>''items_con_saldo'' || ''/'' || (d->''totales''->>''facturas'') || ''/'' || (d->''totales''->>''facturas_con_saldo'')'))
    = '7/5/4',
    'B2: 7 ítems con saldo; 5 facturas, 4 con saldo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.grupo('CUOTA', 'saldo_centavos'))) = '10000000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.q(pg_temp.u(2), pg_temp.grupo('DEPORTE:e0000000-0000-4000-8000-000000000101', 'saldo_centavos'))) = '1600000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.q(pg_temp.u(2), pg_temp.grupo('DEPORTE:e0000000-0000-4000-8000-000000000102', 'saldo_centavos'))) = '900000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.q(pg_temp.u(2), pg_temp.grupo('TRANSPORTE:e0000000-0000-4000-8000-000000000021', 'saldo_centavos'))) = '1200000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.q(pg_temp.u(2), pg_temp.grupo('TRANSPORTE:e0000000-0000-4000-8000-000000000020', 'saldo_centavos'))) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.grupo('COMEDOR:e0000000-0000-4000-8000-000000000010', 'saldo_centavos'))) = '700000',
    'B3: subtotales por agrupación: cuota, cada deporte por separado, cada recorrido por separado y comedor');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2),
        '(SELECT pg_catalog.string_agg(g->>''concepto'', '','' ORDER BY ord) FROM jsonb_array_elements(d->''grupos'') WITH ORDINALITY x(g, ord))'))
    = 'Cuota,Fútbol,Natación,Recorrido Norte (ficticio),Recorrido Sur (ficticio),Comedor escolar',
    'B4: seis agrupaciones en orden: cuota, deportes, recorridos y comedor; los deportes no se funden en un bloque');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2),
        pg_temp.fila(pg_temp.u(8011), 'estado') || ' || '','' || ' || pg_temp.fila(pg_temp.u(8021), 'estado')
        || ' || '','' || ' || pg_temp.fila(pg_temp.u(8023), 'estado') || ' || '','' || ' || pg_temp.fila(pg_temp.u(8032), 'estado')
        || ' || '','' || ' || pg_temp.fila(pg_temp.u(8033), 'estado') || ' || '','' || ' || pg_temp.fila(pg_temp.u(8051), 'estado')))
    = 'VENCIDO,PAGADO,EN_VERIFICACION,VENCIDO,SIN_CARGO,PENDIENTE',
    'B5: estados — sin pago vencido; pagado; en verificación; rechazado vuelve a vencido; ítem cero sin cargo; futuro pendiente');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'saldo_centavos'))) = '1200000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'pagado_centavos'))) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'en_verificacion'))) = 'true'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'vencido'))) = 'true',
    'B6: EN_VERIFICACION reserva el ítem pero no reduce su deuda');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8032), 'saldo_centavos'))) = '700000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8032), 'pagado_centavos'))) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8032), 'en_verificacion'))) = 'false',
    'B7: un pago rechazado conserva la historia, libera la reserva y mantiene la deuda');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8041), 'saldo_centavos'))) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8041), 'pagado_centavos'))) = '5000000',
    'B8: el importe informado (49.000,00) no cancela deuda ni cambia lo imputado (50.000,00)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8033), 'importe_centavos'))) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8033), 'saldo_centavos'))) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8033), 'pagado_centavos'))) = '0',
    'B9: un ítem sin cargo no inventa transferencia ni deuda');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2),
        'd->''filas''->0->>''concepto'' || ''/'' || (d->''filas''->0->>''periodo'')')) = 'Cuota/2099-01-01',
    'B10: dentro de cada agrupación, el período más reciente primero');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8052), 'vencido'))) = 'false'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8011), 'vencimiento'))) = '2025-11-10',
    'B11: el vencimiento histórico se informa; un período futuro no está vencido');

-- ================================================================
-- C. ETIQUETAS HISTÓRICAS
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8013), 'concepto'))) = 'Natación'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8013), 'origen_estado'))) = 'CANCELADA'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8013), 'catalogo_activo'))) = 'false',
    'C1: una inscripción cancelada con grupo inactivo conserva su ítem, su nombre y se marca');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8033), 'concepto'))) = 'Recorrido Norte (ficticio)'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'concepto'))) = 'Recorrido Sur (ficticio)'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'origen_estado'))) = 'ACTIVA',
    'C2: cada ítem de transporte conserva el recorrido que lo originó; el recorrido actual no lo sustituye');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8022), 'detalle'))) = 'Fútbol EPT-114'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8022), 'concepto'))) = 'Fútbol',
    'C3: el deporte informa su nombre y el grupo');
-- El catálogo cambia después: la etiqueta es la actual, el importe histórico no se mueve.
UPDATE public.tarifas SET importe = 99999.00 WHERE id = pg_temp.u(401);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.adeudado())) = '14400000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8051), 'importe_centavos'))) = '5000000',
    'C4: una tarifa actual distinta no recalcula importes históricos');

-- ================================================================
-- D. FILTRO POR PERÍODO DE FACTURA
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total() || ' || ''/'' || ' || pg_temp.adeudado(),
        '2025-12-15', '2026-01-02')) = '6/1900000',
    'D1: el filtro es por mes calendario: 15/12 incluye diciembre y 02/01 incluye enero (6 ítems, 19.000,00)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total() || ' || ''/'' || ' || pg_temp.adeudado(),
        '2025-12-01', '2025-12-31')) = '3/1200000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(),
        '2025-12-31', '2026-01-01')) = '6'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(),
        '2025-11-30', '2025-11-30')) = '3',
    'D2: extremos inclusivos, un solo día y cambio de año');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total() || ' || ''/'' || ' || pg_temp.adeudado(),
        '2026-02-01', '2026-02-28')) = '1/0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8041), 'pagado_centavos'),
        '2026-02-01', '2026-02-28')) = '5000000',
    'D3: el pago aprobado con transferencia en marzo cubre la cuota de febrero: el saldo es el vigente, no el del intervalo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total() || ' || ''/'' || ' || pg_temp.adeudado(),
        '2025-11-30', '2025-11-30')) = '3/6700000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total() || ' || ''/'' || ' || pg_temp.adeudado(),
        '2099-01-31', '2099-12-31')) = '2/5800000',
    'D4: facturas sin ningún pago aprobado se incluyen (noviembre 2025 y enero 2099)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total() || ' || ''/'' || ' || pg_temp.adeudado() || ' || ''/'' || (d->>''filas'')',
        '2024-01-01', '2024-12-31')) = '0/0/[]',
    'D5: un rango sin facturas devuelve un conjunto vacío con total cero');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), '2026-02-01', '2026-01-01')) = 'EP6871'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), '2026-01-01', NULL)) = 'EP6870'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, '2026-01-01')) = 'EP6870'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), 'infinity', '2026-01-01')) = 'EP6870'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), '2026-02-01', '2026-01-01')) = 'EP6871',
    'D6: rango invertido, un solo extremo o fecha infinita se rechazan, también para un alumno ajeno');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->>''periodo_desde'' || ''/'' || (d->>''periodo_hasta'')',
        '2025-12-15', '2026-01-02')) = '2025-12-01/2026-01-01',
    'D7: el servidor informa el mes calendario efectivamente aplicado a cada extremo');
-- Los totales del filtro son del conjunto completo, también con página parcial.
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2),
        'jsonb_array_length(d->''filas'') || ''/'' || (d->>''total'') || ''/'' || (d->''totales''->>''adeudado_centavos'')',
        NULL, NULL, 1, 25)) = '12/12/14400000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2),
        'jsonb_array_length(d->''filas'') || ''/'' || (d->>''total'')', NULL, NULL, 2, 25)) = '0/12',
    'D8: una página fuera del final queda vacía pero conserva el total global');

-- ================================================================
-- E. HISTORIAL GRANDE: PAGINACIÓN COMPLETA Y TOTAL DE ALTA PRECISIÓN
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12), pg_temp.total())) = '9100'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12), pg_temp.adeudado())) = '9099999999990900'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12), pg_temp.grupo('CUOTA', 'saldo_centavos'))) = '9099999999990900'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12),
        '((d->''totales''->>''adeudado_centavos'')::NUMERIC > 9007199254740991)')) = 'true',
    'E1: 9.100 ítems; el total adeudado (9.099.999.999.990.900 centavos) supera la precisión segura de JavaScript y llega exacto');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12),
        'jsonb_array_length(d->''filas'') || ''/'' || (d->>''total'')')) = '50/9100'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12),
        'jsonb_array_length(d->''filas'')', NULL, NULL, 182)) = '50'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12),
        'jsonb_array_length(d->''filas'')', NULL, NULL, 183)) = '0',
    'E2: 182 páginas completas de 50 y la 183 vacía; el total global no depende de la página');
-- Recorre TODAS las páginas y compara con un orden calculado directamente desde las tablas.
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.md5(pg_catalog.string_agg(e.value->>''item_id'', '','' ORDER BY p.n, e.ord)) || ''/'' || pg_catalog.count(DISTINCT e.value->>''item_id'') '
        || 'FROM generate_series(1, 183) p(n) CROSS JOIN LATERAL jsonb_array_elements('
        || 'public.historial_deuda_items(''' || pg_temp.u(12) || '''::UUID, NULL, NULL, p.n, 50, NULL)->''filas'') WITH ORDINALITY e(value, ord)')
    = (SELECT pg_catalog.md5(pg_catalog.string_agg(i.id::TEXT, ',' ORDER BY f.periodo DESC, i.id)) || '/' || pg_catalog.count(*)
       FROM public.items_factura i JOIN public.facturas f ON f.id = i.factura_id WHERE i.alumno_id = pg_temp.u(12)),
    'E3: las 183 páginas reunidas contienen los 9.100 ítems exactamente una vez, en el orden estable período descendente + identidad');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.md5(pg_catalog.string_agg(e.value->>''item_id'', '','' ORDER BY p.n, e.ord)) '
        || 'FROM generate_series(1, 92) p(n) CROSS JOIN LATERAL jsonb_array_elements('
        || 'public.historial_deuda_items(''' || pg_temp.u(12) || '''::UUID, NULL, NULL, p.n, 100, NULL)->''filas'') WITH ORDINALITY e(value, ord)')
    = (SELECT pg_catalog.md5(pg_catalog.string_agg(i.id::TEXT, ',' ORDER BY f.periodo DESC, i.id))
       FROM public.items_factura i JOIN public.facturas f ON f.id = i.factura_id WHERE i.alumno_id = pg_temp.u(12)),
    'E4: el recorrido completo con páginas de 100 produce la misma secuencia');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12), pg_temp.total() || ' || ''/'' || ' || pg_temp.adeudado(),
        '1999-01-01', '1999-12-31')) = '12/11999999999988',
    'E5: un filtro anual sobre el historial grande suma 12 ítems exactos');

-- ================================================================
-- F. HUELLA Y VALIDACIÓN DE PARÁMETROS
-- ================================================================
CREATE TEMPORARY TABLE huella_a AS
SELECT pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->>''huella''')) AS h;
SELECT pg_temp.afirmar(
    (SELECT h FROM huella_a) ~ '^[a-f0-9]{32}$'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 1, 50,
        (SELECT h FROM huella_a))) = '12'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->>''actualizado''', NULL, NULL, 2, 25,
        'ffffffffffffffffffffffffffffffff')) = 'true'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), '(d ? ''filas'')::TEXT', NULL, NULL, 1, 50,
        'ffffffffffffffffffffffffffffffff')) = 'false',
    'F1: con la huella vigente se entrega la página; con otra, solo la señal de actualización y ninguna fila');
-- Una aprobación concurrente cambia el contenido: la huella cambia y el total adeudado baja.
UPDATE public.pagos SET estado = 'APROBADO', verificado_por = pg_temp.u(1), verificado_en = now()
WHERE id = pg_temp.u(1002);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->>''actualizado''', NULL, NULL, 2, 50,
        (SELECT h FROM huella_a))) = 'true'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.adeudado())) = '13200000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'estado'))) = 'PAGADO',
    'F2: aprobar el pago en verificación cambia la huella y baja la deuda en 12.000,00');
UPDATE public.pagos SET estado = 'RECHAZADO', motivo_rechazo = 'Prueba de rechazo'
WHERE id = pg_temp.u(1002);
UPDATE public.imputaciones_pago SET activa = FALSE WHERE pago_id = pg_temp.u(1002);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.adeudado())) = '14400000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.fila(pg_temp.u(8023), 'saldo_centavos'))) = '1200000',
    'F3: rechazar el pago devuelve la deuda y conserva la historia');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 0)) = 'EP6872'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 1000001)) = 'EP6872'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 1, 10)) = 'EP6872'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 1, NULL)) = 'EP6872'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 1, 50, 'XYZ')) = 'EP6872'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 1, 10)) = 'EP6872'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), NULL, NULL, 1, 100)) = '12',
    'F4: página, tamaño y huella inválidos se rechazan igual para cualquier alumno; 25, 50 y 100 son válidos');

-- ================================================================
-- G. CONSISTENCIA CON EPT-107 E INCONSISTENCIAS DECLARADAS
-- ================================================================
-- Saldo de cada factura = Σ saldos de sus ítems (agregado por factura única) = estado_cuotas_alumno.saldo_centavos.
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.bool_and(v.saldo = e.saldo_centavos)::TEXT || ''/'' || pg_catalog.count(*) FROM ('
        || 'SELECT (f->>''factura_id'')::UUID AS id, pg_catalog.sum((f->>''saldo_centavos'')::BIGINT) AS saldo '
        || 'FROM public.historial_deuda_items(''' || pg_temp.u(2) || '''::UUID, NULL, NULL, 1, 50, NULL) AS d, '
        || 'jsonb_array_elements(d->''filas'') f GROUP BY 1) v '
        || 'JOIN public.estado_cuotas_alumno e ON e.factura_id = v.id') = 'true/5',
    'G1: el saldo por factura (ítems agregados por factura única) coincide con estado_cuotas_alumno en las 5 facturas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT (pg_catalog.sum(e.saldo_centavos))::TEXT FROM public.estado_cuotas_alumno e WHERE e.alumno_id = '''
        || pg_temp.u(2) || '''::UUID') = '14400000',
    'G2: la suma de saldos de EPT-107 para la alumna es la misma deuda total');
-- Inconsistencia declarada: factura 100,00 con un ítem de 60,00 y una imputación parcial de 30,00.
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
VALUES (pg_temp.u(901), pg_temp.u(14), '2025-06-01', '2025-06-10', 100.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
VALUES (pg_temp.u(9011), pg_temp.u(901), pg_temp.u(14), 'CUOTA', pg_temp.u(401), pg_temp.u(714), 60.00);
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en)
VALUES (pg_temp.u(1901), pg_temp.u(5), pg_temp.u(14), 30.00, 30.00, '2025-06-05', 'OP-114-19',
        'APROBADO', pg_temp.u(1), now());
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa)
VALUES (pg_temp.u(1901), pg_temp.u(9011), pg_temp.u(14), 30.00, TRUE);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(14),
        pg_temp.fila(pg_temp.u(9011), 'saldo_centavos') || ' || ''/'' || ' || pg_temp.fila(pg_temp.u(9011), 'inconsistente')
        || ' || ''/'' || ' || pg_temp.fila(pg_temp.u(9011), 'factura_inconsistente')
        || ' || ''/'' || (d->''totales''->>''hay_inconsistencias'')')) = '3000/true/true/true'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), 'd->''totales''->>''hay_inconsistencias''')) = 'false',
    'G3: una imputación parcial y una factura que no cierra se declaran, sin recortar ni ocultar el saldo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT e.inconsistente::TEXT FROM public.estado_cuotas_alumno e WHERE e.factura_id = ''' || pg_temp.u(901) || '''::UUID') = 'true',
    'G4: la vista de EPT-107 clasifica la misma factura como inconsistente');

-- ================================================================
-- H. SOLO LECTURA, ACL Y SUPERFICIE
-- ================================================================
-- Huella económica: leer la deuda (con distintos actores, rangos y páginas) no puede modificarla.
CREATE TEMPORARY TABLE huella_lectura AS
SELECT pg_catalog.md5(pg_catalog.concat(
    (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(p)::TEXT, '' ORDER BY p.id) FROM public.pagos p),
    (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(i)::TEXT, '' ORDER BY i.id) FROM public.items_factura i),
    (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(ip)::TEXT, '' ORDER BY ip.pago_id, ip.item_factura_id) FROM public.imputaciones_pago ip),
    (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(f)::TEXT, '' ORDER BY f.id) FROM public.facturas f))) AS h;
SELECT pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total()));
SELECT pg_temp.como(pg_temp.u(1), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total(), '2025-11-01', '2026-02-28'));
SELECT pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q(pg_temp.u(12), pg_temp.total(), NULL, NULL, 3, 100));
SELECT pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q(pg_temp.u(2), pg_temp.total()));
SELECT pg_temp.afirmar(
    (SELECT h FROM huella_lectura) = (SELECT pg_catalog.md5(pg_catalog.concat(
        (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(p)::TEXT, '' ORDER BY p.id) FROM public.pagos p),
        (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(i)::TEXT, '' ORDER BY i.id) FROM public.items_factura i),
        (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(ip)::TEXT, '' ORDER BY ip.pago_id, ip.item_factura_id) FROM public.imputaciones_pago ip),
        (SELECT pg_catalog.string_agg(pg_catalog.row_to_json(f)::TEXT, '' ORDER BY f.id) FROM public.facturas f)))),
    'H1: leer la deuda no modifica pagos, ítems, imputaciones ni facturas');
SELECT pg_temp.afirmar(
    pg_catalog.has_function_privilege('authenticated', 'public.historial_deuda_items(uuid,date,date,integer,integer,text)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', 'public.historial_deuda_items(uuid,date,date,integer,integer,text)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', 'public.historial_deuda_items(uuid,date,date,integer,integer,text)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', 'app_private.historial_deuda_items(uuid,date,date,integer,integer,text)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', 'app_private.historial_deuda_items(uuid,date,date,integer,integer,text)', 'EXECUTE'),
    'H2: solo authenticated ejecuta la RPC; anon y service_role no');
SELECT pg_temp.afirmar(
    (SELECT NOT p.prosecdef AND p.provolatile = 's' AND p.proconfig @> ARRAY['search_path=""']
       FROM pg_catalog.pg_proc p WHERE p.oid = 'public.historial_deuda_items(uuid,date,date,integer,integer,text)'::regprocedure)
    AND (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig @> ARRAY['search_path=""']
         FROM pg_catalog.pg_proc p WHERE p.oid = 'app_private.historial_deuda_items(uuid,date,date,integer,integer,text)'::regprocedure),
    'H3: el envoltorio es INVOKER y STABLE; el auxiliar es DEFINER, STABLE y con search_path vacío');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', 'UPDATE public.items_factura SET importe = 1') = 'E42501'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', 'DELETE FROM public.imputaciones_pago') = 'E42501',
    'H4: la lectura no abre ninguna escritura económica al padre');

ROLLBACK;
