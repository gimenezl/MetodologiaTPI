-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación del esquema económico (EPT-100)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable e identificada,
-- después de `supabase db reset`. Todo ocurre dentro de una transacción con
-- ROLLBACK. Uso con el stack aislado de la unidad:
--
--   docker cp supabase/tests/economico_esquema.sql supabase_db_ept100:/tmp/
--   docker exec supabase_db_ept100 psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/economico_esquema.sql
--
-- Cada comprobación imprime `OK n` (aviso) o aborta con `FALLO n`. Una negativa
-- solo cuenta si falla con el SQLSTATE esperado: fallar «por cualquier error» no
-- demuestra la regla.
--
-- Cubre las ocho entidades de EPT-100 (tarifas, facturas, items_factura, pagos,
-- imputaciones_pago, recibos, feriados, envios_correo):
--   A. objetos, tipos exactos, claves, defaults, FK y restricciones de borrado;
--   B. privilegios: acceso cerrado a anon y authenticated, con y sin JWT; sin
--      políticas permisivas, solo la RESTRICTIVE de bloqueo de EPT-59;
--   C. tarifas: referencias, servicio coherente, importes, vigencias;
--   D. facturas: período, vencimiento, unicidad, ausencia de estado;
--   E. ítems: origen, mismo hijo, tarifa correcta, historial;
--   F. pagos: nulabilidad por etapa, verificación, operación única;
--   G. imputaciones: mismo hijo, una activa por ítem;
--   H. recibos, feriados y envíos de correo;
--   I. límites conocidos: coerción de escala de NUMERIC(12,2);
--   J. coherencia al facturar: un cambio académico posterior (nivel de un curso,
--      por el camino autorizado del DIRECTOR) es legítimo y el ítem conserva
--      alumno, tarifa e importe. Contrato de un ítem aislado; la consistencia de
--      un lote mensual de facturación es de EPT-104.
--
-- Fechas finitas: las 7 columnas DATE y las 6 TIMESTAMPTZ de las ocho tablas
-- rechazan `infinity` y `-infinity` (secciones C3b/C3c, D2b/D2c, F2b/F4b, H1b,
-- H2b, H3/H3b y el control de catálogo A12). `DEFAULT NOW()` no sustituye la
-- restricción.
--
-- NO verifica (corresponde a EPT-101 y siguientes): CRUD por actor, archivos,
-- aprobación, reserva/liberación, numeración, totales ni vistas de saldo.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- AYUDANTES
-- ================================================================
CREATE TEMPORARY SEQUENCE ept100_n;

CREATE FUNCTION pg_temp.u(p_n INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_catalog.format('b1000000-0000-4000-8000-%s', pg_catalog.lpad(p_n::TEXT, 12, '0'))::UUID $$;

CREATE FUNCTION pg_temp.afirmar(p_condicion BOOLEAN, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := pg_catalog.nextval('ept100_n');
BEGIN
    IF p_condicion IS TRUE THEN
        RAISE NOTICE 'OK %: %', v_n, p_descripcion;
    ELSE
        RAISE EXCEPTION 'FALLO %: %', v_n, p_descripcion;
    END IF;
END;
$$;

-- Ejecuta una sentencia que DEBE fallar con el SQLSTATE esperado.
CREATE FUNCTION pg_temp.negativa(p_sql TEXT, p_estado TEXT, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_n BIGINT := pg_catalog.nextval('ept100_n');
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

-- Ejecuta una sentencia que DEBE tener éxito.
CREATE FUNCTION pg_temp.positiva(p_sql TEXT, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_n BIGINT := pg_catalog.nextval('ept100_n');
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


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- Dos hijos con matrícula en niveles distintos (tarifas distintas), un docente,
-- un padre y un director. Los DNI se eligen en un rango libre; ninguno
-- corresponde a una persona real.
WITH base_libre AS (
    SELECT base
    FROM generate_series(81000000, 89999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 12) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(n, rol, apellido, legajo, desplazamiento) AS (
    VALUES
        (1, 'DIRECTOR',   'Directora',  NULL,             1),
        (2, 'ESTUDIANTE', 'Alumna A',   'LEG-EPT100-0002', 2),
        (3, 'ESTUDIANTE', 'Alumno B',   'LEG-EPT100-0003', 3),
        (4, 'DOCENTE',    'Docente 1',  NULL,             4),
        (5, 'PADRE',      'Padre',      NULL,             5),
        (6, 'PADRE',      'Padre dos',  NULL,             6)
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.u(i.n), pg_temp.u(i.n), r.id, 'Prueba', i.apellido,
       (b.base + i.desplazamiento)::TEXT, i.legajo
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES
    (pg_temp.u(101), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
     'Curso EPT-100 primario', 'A', TRUE),
    (pg_temp.u(102), (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'),
     'Sala EPT-100 inicial', 'A', TRUE);

INSERT INTO public.matriculas (id, alumno_id, curso_id)
VALUES
    (pg_temp.u(701), pg_temp.u(2), pg_temp.u(101)),
    (pg_temp.u(702), pg_temp.u(3), pg_temp.u(102));

UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (pg_temp.u(2), pg_temp.u(3));

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES (pg_temp.u(5), pg_temp.u(2)), (pg_temp.u(5), pg_temp.u(3));

-- Grupos deportivos del catálogo sembrado (Fútbol y Natación).
INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
VALUES
    (pg_temp.u(201), 'e0000000-0000-4000-8000-000000000101',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Fútbol EPT-100', 20, pg_temp.u(4)),
    (pg_temp.u(202), 'e0000000-0000-4000-8000-000000000102',
     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Natación EPT-100', 20, pg_temp.u(4)),
    (pg_temp.u(203), 'e0000000-0000-4000-8000-000000000101',
     (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'), 'Fútbol inicial EPT-100', 20, pg_temp.u(4));

-- Un grupo sin horarios no admite inscripciones (015): una franja por grupo, en
-- días distintos para que las dos inscripciones de A no se superpongan.
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
SELECT d, '18:00', '19:00' FROM generate_series(1, 3) AS d
ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT g.id, h.id
FROM (VALUES (pg_temp.u(201), 1), (pg_temp.u(202), 2), (pg_temp.u(203), 3)) AS g(id, dia)
JOIN public.horarios h
  ON h.dia_semana = g.dia AND h.hora_inicio = '18:00' AND h.hora_fin = '19:00';

INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id)
VALUES
    (pg_temp.u(501), pg_temp.u(2), pg_temp.u(201)),
    (pg_temp.u(502), pg_temp.u(2), pg_temp.u(202)),
    (pg_temp.u(503), pg_temp.u(3), pg_temp.u(203));

-- Dos recorridos de transporte como filas del catálogo de servicios.
INSERT INTO public.servicios_escolares (id, tipo, codigo, nombre)
VALUES
    (pg_temp.u(301), 'TRANSPORTE', 'T-EPT100-1', 'Recorrido uno EPT-100'),
    (pg_temp.u(302), 'TRANSPORTE', 'T-EPT100-2', 'Recorrido dos EPT-100');

INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id)
VALUES
    (pg_temp.u(601), pg_temp.u(2), 'e0000000-0000-4000-8000-000000000010'),
    (pg_temp.u(602), pg_temp.u(2), pg_temp.u(301)),
    (pg_temp.u(603), pg_temp.u(3), 'e0000000-0000-4000-8000-000000000010');

-- Inscripción cancelada de B al recorrido uno: el historial sigue facturable.
INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id)
VALUES (pg_temp.u(604), pg_temp.u(3), pg_temp.u(301));
UPDATE public.inscripciones_servicios
SET estado = 'CANCELADA', fecha_cancelacion = NOW() WHERE id = pg_temp.u(604);

-- Referencias propias para probar vigencias sin tocar las demás.
INSERT INTO public.niveles (nombre, activo, orden) VALUES ('NIVEL EPT100 VIGENCIAS', TRUE, 9100);
INSERT INTO public.deportes (id, nombre) VALUES (pg_temp.u(205), 'Deporte EPT-100 vigencias');

-- Tarifas del módulo, vigentes desde 2026-01-01 sin fin.
INSERT INTO public.tarifas (id, concepto, nivel_id, deporte_id, servicio_id, importe, desde)
VALUES
    (pg_temp.u(401), 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), NULL, NULL, 50000.00, '2026-01-01'),
    (pg_temp.u(402), 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'), NULL, NULL, 40000.00, '2026-01-01'),
    (pg_temp.u(403), 'DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000101', NULL, 8000.00, '2026-01-01'),
    (pg_temp.u(404), 'DEPORTE', NULL, 'e0000000-0000-4000-8000-000000000102', NULL, 9000.00, '2026-01-01'),
    (pg_temp.u(405), 'COMEDOR', NULL, NULL, 'e0000000-0000-4000-8000-000000000010', 12000.00, '2026-01-01'),
    (pg_temp.u(406), 'TRANSPORTE', NULL, NULL, pg_temp.u(301), 7000.00, '2026-01-01'),
    (pg_temp.u(407), 'TRANSPORTE', NULL, NULL, pg_temp.u(302), 6500.00, '2026-01-01');

-- Facturas de noviembre de 2026 para cada hijo y una de diciembre para A.
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
VALUES
    (pg_temp.u(801), pg_temp.u(2), '2026-11-01', '2026-11-10', 86000.00),
    (pg_temp.u(802), pg_temp.u(3), '2026-11-01', '2026-11-10', 52000.00),
    (pg_temp.u(803), pg_temp.u(2), '2026-12-01', '2026-12-10', 0.00);

INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id,
                                  matricula_id, inscripcion_deportiva_id,
                                  inscripcion_servicio_id, importe)
VALUES
    (pg_temp.u(901), pg_temp.u(801), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(701), NULL, NULL, 50000.00),
    (pg_temp.u(902), pg_temp.u(801), pg_temp.u(2), 'DEPORTE', pg_temp.u(403), NULL, pg_temp.u(501), NULL, 8000.00),
    (pg_temp.u(903), pg_temp.u(801), pg_temp.u(2), 'DEPORTE', pg_temp.u(404), NULL, pg_temp.u(502), NULL, 9000.00),
    (pg_temp.u(904), pg_temp.u(801), pg_temp.u(2), 'COMEDOR', pg_temp.u(405), NULL, NULL, pg_temp.u(601), 12000.00),
    (pg_temp.u(905), pg_temp.u(801), pg_temp.u(2), 'TRANSPORTE', pg_temp.u(406), NULL, NULL, pg_temp.u(602), 7000.00),
    (pg_temp.u(911), pg_temp.u(802), pg_temp.u(3), 'CUOTA', pg_temp.u(402), pg_temp.u(702), NULL, NULL, 40000.00),
    (pg_temp.u(912), pg_temp.u(802), pg_temp.u(3), 'COMEDOR', pg_temp.u(405), NULL, NULL, pg_temp.u(603), 12000.00);

SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM public.items_factura WHERE id = ANY (ARRAY[
        pg_temp.u(901), pg_temp.u(902), pg_temp.u(903), pg_temp.u(904), pg_temp.u(905),
        pg_temp.u(911), pg_temp.u(912)])) = 7,
    'fixture: dos hijos, tarifas distintas y siete ítems de origen real');


-- ================================================================
-- A. OBJETOS, TIPOS EXACTOS, CLAVES, DEFAULTS Y FK
-- ================================================================
DO $$
DECLARE
    v_esperadas TEXT[] := ARRAY['tarifas', 'facturas', 'items_factura', 'pagos',
        'imputaciones_pago', 'recibos', 'feriados', 'envios_correo'];
    v_tabla TEXT;
    v_n INTEGER;
BEGIN
    -- A1. Las ocho tablas existen y las dos tablas hijas pendientes NO existen.
    FOREACH v_tabla IN ARRAY v_esperadas LOOP
        PERFORM pg_temp.afirmar(pg_catalog.to_regclass('public.' || v_tabla) IS NOT NULL,
            'A1: existe public.' || v_tabla);
    END LOOP;
    PERFORM pg_temp.afirmar(
        pg_catalog.to_regclass('public.comprobantes_pago') IS NULL
        AND pg_catalog.to_regclass('public.envios_correo_facturas') IS NULL,
        'A1: no se crearon comprobantes_pago ni envios_correo_facturas (pendientes de aprobación)');

    -- A2. Ninguna columna monetaria usa FLOAT/REAL/MONEY, y toda columna de
    -- importe es NUMERIC(12,2).
    SELECT pg_catalog.count(*) INTO v_n
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = ANY (v_esperadas)
      AND c.data_type IN ('real', 'double precision', 'money');
    PERFORM pg_temp.afirmar(v_n = 0, 'A2: ninguna columna FLOAT, REAL ni MONEY');

    SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES
        ('tarifas', 'importe'), ('facturas', 'total'), ('items_factura', 'importe'),
        ('pagos', 'total_calculado'), ('pagos', 'importe_informado'),
        ('imputaciones_pago', 'importe')
    ) AS e(tabla, columna)
    JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = e.tabla AND c.column_name = e.columna
    WHERE c.data_type = 'numeric' AND c.numeric_precision = 12 AND c.numeric_scale = 2;
    PERFORM pg_temp.afirmar(v_n = 6, 'A2: las seis columnas de importe son NUMERIC(12,2)');

    -- A3. Tipos, nulabilidad y defaults exactos (tabla, columna, tipo, nulable).
    SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES
        ('tarifas','id','uuid','NO'), ('tarifas','concepto','USER-DEFINED','NO'),
        ('tarifas','nivel_id','integer','YES'), ('tarifas','deporte_id','uuid','YES'),
        ('tarifas','servicio_id','uuid','YES'), ('tarifas','importe','numeric','NO'),
        ('tarifas','desde','date','NO'), ('tarifas','hasta','date','YES'),
        ('facturas','id','uuid','NO'), ('facturas','alumno_id','uuid','NO'),
        ('facturas','periodo','date','NO'), ('facturas','vencimiento','date','NO'),
        ('facturas','generada_en','timestamp with time zone','NO'),
        ('facturas','total','numeric','NO'),
        ('items_factura','id','uuid','NO'), ('items_factura','factura_id','uuid','NO'),
        ('items_factura','alumno_id','uuid','NO'), ('items_factura','tipo','USER-DEFINED','NO'),
        ('items_factura','tarifa_id','uuid','NO'), ('items_factura','matricula_id','uuid','YES'),
        ('items_factura','inscripcion_deportiva_id','uuid','YES'),
        ('items_factura','inscripcion_servicio_id','uuid','YES'),
        ('items_factura','importe','numeric','NO'),
        ('items_factura','estado_pago','USER-DEFINED','NO'),
        ('pagos','id','uuid','NO'), ('pagos','padre_id','uuid','NO'),
        ('pagos','alumno_id','uuid','NO'), ('pagos','total_calculado','numeric','NO'),
        ('pagos','importe_informado','numeric','YES'),
        ('pagos','fecha_transferencia','date','YES'), ('pagos','numero_operacion','text','YES'),
        ('pagos','estado','USER-DEFINED','NO'), ('pagos','verificado_por','uuid','YES'),
        ('pagos','verificado_en','timestamp with time zone','YES'),
        ('pagos','motivo_rechazo','text','YES'),
        ('imputaciones_pago','pago_id','uuid','NO'),
        ('imputaciones_pago','item_factura_id','uuid','NO'),
        ('imputaciones_pago','alumno_id','uuid','NO'),
        ('imputaciones_pago','importe','numeric','NO'),
        ('imputaciones_pago','activa','boolean','NO'),
        ('recibos','id','uuid','NO'), ('recibos','pago_id','uuid','NO'),
        ('recibos','numero','bigint','NO'),
        ('recibos','emitido_en','timestamp with time zone','NO'),
        ('recibos','archivo_path','text','YES'),
        ('feriados','fecha','date','NO'), ('feriados','descripcion','text','NO'),
        ('envios_correo','id','uuid','NO'), ('envios_correo','padre_id','uuid','NO'),
        ('envios_correo','tipo','USER-DEFINED','NO'),
        ('envios_correo','fecha_programada','date','NO'),
        ('envios_correo','estado','USER-DEFINED','NO'), ('envios_correo','intentos','integer','NO'),
        ('envios_correo','ultimo_error','text','YES'),
        ('envios_correo','enviado_en','timestamp with time zone','YES')
    ) AS e(tabla, columna, tipo, nulable)
    JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = e.tabla AND c.column_name = e.columna
    WHERE c.data_type = e.tipo AND c.is_nullable = e.nulable;
    PERFORM pg_temp.afirmar(v_n = 55, 'A3: 55 columnas con tipo y nulabilidad exactos (got ' || v_n || ')');

    -- A4. Claves primarias.
    SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES
        ('tarifas', 'id'), ('facturas', 'id'), ('items_factura', 'id'), ('pagos', 'id'),
        ('imputaciones_pago', 'pago_id,item_factura_id'), ('recibos', 'id'),
        ('feriados', 'fecha'), ('envios_correo', 'id')
    ) AS e(tabla, columnas)
    WHERE (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY k.ord)
           FROM pg_catalog.pg_constraint c
           CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
           WHERE c.contype = 'p' AND c.conrelid = pg_catalog.to_regclass('public.' || e.tabla)) = e.columnas;
    PERFORM pg_temp.afirmar(v_n = 8, 'A4: claves primarias esperadas (UUID; compuesta en imputaciones_pago)');

    -- A5. Defaults: UUID generado, estados iniciales, contador en cero.
    SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES
        ('tarifas','id','gen_random_uuid()'), ('facturas','id','gen_random_uuid()'),
        ('items_factura','id','gen_random_uuid()'), ('pagos','id','gen_random_uuid()'),
        ('recibos','id','gen_random_uuid()'), ('envios_correo','id','gen_random_uuid()'),
        ('items_factura','estado_pago','''PENDIENTE''::estado_pago_item'),
        ('pagos','estado','''PENDIENTE_VERIFICACION''::estado_pago'),
        ('envios_correo','estado','''PENDIENTE''::estado_envio_correo'),
        ('envios_correo','intentos','0'),
        ('imputaciones_pago','activa','true')
    ) AS e(tabla, columna, valor)
    JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = e.tabla AND c.column_name = e.columna
    WHERE c.column_default = e.valor OR c.column_default = 'pg_catalog.' || e.valor;
    PERFORM pg_temp.afirmar(v_n = 11, 'A5: defaults esperados (got ' || v_n || ')');

    -- A6. La factura no persiste estado; ninguna tabla duplica identidad.
    PERFORM pg_temp.afirmar(NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = 'facturas'
          AND c.column_name IN ('estado', 'estado_pago', 'saldo')),
        'A6: facturas no persiste estado ni saldo (se deriva)');
    PERFORM pg_temp.afirmar(NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = ANY (v_esperadas)
          AND c.column_name IN ('nombre', 'apellido', 'dni', 'email', 'legajo_nro', 'curso_id', 'grupo_id')),
        'A6: ninguna tabla copia identidad ni inscripciones (solo FK a las fuentes reales)');

    -- A7. Toda FK conserva historial: ON DELETE y ON UPDATE nunca cascadean.
    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = ANY (ARRAY(SELECT pg_catalog.to_regclass('public.' || t) FROM pg_catalog.unnest(v_esperadas) AS t))
      AND (c.confdeltype <> 'r' OR c.confupdtype NOT IN ('a', 'r'));
    PERFORM pg_temp.afirmar(v_n = 0, 'A7: ninguna FK con ON DELETE/UPDATE en cascada, SET NULL o SET DEFAULT');

    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
    WHERE c.contype = 'f'
      AND c.conname = ANY (ARRAY[
        'tarifas_nivel_id_fkey', 'tarifas_deporte_id_fkey', 'tarifas_servicio_id_fkey',
        'facturas_alumno_id_fkey', 'items_factura_factura_alumno_fk',
        'items_factura_tarifa_tipo_fk', 'items_factura_matricula_id_fkey',
        'items_factura_inscripcion_deportiva_id_fkey',
        'items_factura_inscripcion_servicio_id_fkey', 'pagos_padre_id_fkey',
        'pagos_alumno_id_fkey', 'pagos_verificado_por_fkey',
        'imputaciones_pago_pago_alumno_fk', 'imputaciones_pago_item_alumno_fk',
        'recibos_pago_id_fkey', 'envios_correo_padre_id_fkey']);
    PERFORM pg_temp.afirmar(v_n = 16, 'A7: las 16 FK esperadas existen (got ' || v_n || ')');

    -- A8. Unicidades esperadas.
    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
    WHERE c.contype IN ('u', 'x')
      AND c.conname = ANY (ARRAY[
        'tarifas_id_concepto_unico', 'tarifas_sin_solapamiento_nivel',
        'tarifas_sin_solapamiento_deporte', 'tarifas_sin_solapamiento_servicio',
        'facturas_alumno_periodo_unico', 'facturas_id_alumno_unico',
        'items_factura_id_alumno_unico', 'items_factura_matricula_unica',
        'items_factura_inscripcion_deportiva_unica',
        'items_factura_inscripcion_servicio_unica', 'pagos_id_alumno_unico',
        'recibos_pago_unico', 'recibos_numero_unico',
        'envios_correo_unico_por_padre_tipo_fecha']);
    PERFORM pg_temp.afirmar(v_n = 14, 'A8: 14 UNIQUE/EXCLUDE esperados (got ' || v_n || ')');

    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.indexname IN ('idx_pagos_operacion_no_rechazada', 'idx_imputaciones_pago_item_activa')
      AND i.indexdef LIKE '%UNIQUE%' AND i.indexdef LIKE '%WHERE%';
    PERFORM pg_temp.afirmar(v_n = 2, 'A8: índices únicos parciales de operación y de imputación activa');

    -- A9. Sin índices duplicados: ningún par de índices de las ocho tablas
    -- comparte tabla, columnas, expresiones, predicado y clases de operador.
    SELECT pg_catalog.count(*) INTO v_n
    FROM (
        SELECT i.indrelid, i.indkey::TEXT, i.indclass::TEXT,
               COALESCE(pg_catalog.pg_get_expr(i.indexprs, i.indrelid), ''),
               COALESCE(pg_catalog.pg_get_expr(i.indpred, i.indrelid), '')
        FROM pg_catalog.pg_index i
        WHERE i.indrelid = ANY (ARRAY(SELECT pg_catalog.to_regclass('public.' || t) FROM pg_catalog.unnest(v_esperadas) AS t))
        GROUP BY 1, 2, 3, 4, 5
        HAVING pg_catalog.count(*) > 1
    ) d;
    PERFORM pg_temp.afirmar(v_n = 0, 'A9: ningún índice duplicado en las ocho tablas');

    -- A10. Toda columna de FK queda cubierta por el prefijo de algún índice
    -- (de otro modo un DELETE/UPDATE en la tabla referenciada recorre la tabla).
    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = ANY (ARRAY(SELECT pg_catalog.to_regclass('public.' || t) FROM pg_catalog.unnest(v_esperadas) AS t))
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indrelid = c.conrelid
          AND (i.indkey::SMALLINT[])[0] = c.conkey[1]
      );
    PERFORM pg_temp.afirmar(v_n = 0,
        'A10: la primera columna de toda FK encabeza algún índice (sin cobertura: ' || v_n || ')');

    -- A11. No se creó ninguna secuencia ni columna de identidad en las tablas.
    SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_class s ON s.oid = d.objid AND s.relkind = 'S'
    WHERE d.refobjid = ANY (ARRAY(SELECT pg_catalog.to_regclass('public.' || t) FROM pg_catalog.unnest(v_esperadas) AS t))
      AND d.deptype IN ('a', 'i');
    PERFORM pg_temp.afirmar(v_n = 0, 'A11: ninguna secuencia ni identidad asociada a las ocho tablas');

    -- A12. Toda columna temporal (DATE y TIMESTAMPTZ) de las ocho tablas tiene una
    -- restricción CHECK con isfinite. `DEFAULT NOW()` no sustituye la restricción.
    SELECT pg_catalog.count(*) INTO v_n
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = ANY (v_esperadas)
      AND c.data_type IN ('date', 'timestamp with time zone');
    PERFORM pg_temp.afirmar(v_n = 13, 'A12: 13 columnas temporales (7 DATE + 6 TIMESTAMPTZ) (got ' || v_n || ')');
    SELECT pg_catalog.count(*) INTO v_n
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = ANY (v_esperadas)
      AND c.data_type IN ('date', 'timestamp with time zone')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint k
        WHERE k.conrelid = pg_catalog.to_regclass('public.' || c.table_name)
          AND k.contype = 'c'
          AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%isfinite(' || c.column_name || ')%');
    PERFORM pg_temp.afirmar(v_n = 0,
        'A12: toda columna temporal tiene un CHECK con isfinite (sin restricción: ' || v_n || ')');
END;
$$;


-- ================================================================
-- B. PRIVILEGIOS: ACCESO CERRADO
-- ================================================================
DO $$
DECLARE
    v_tablas TEXT[] := ARRAY['tarifas', 'facturas', 'items_factura', 'pagos',
        'imputaciones_pago', 'recibos', 'feriados', 'envios_correo'];
    v_funciones TEXT[] := ARRAY[
        'app_private.verificar_tarifa_servicio()',
        'app_private.verificar_item_factura()',
        'app_private.proteger_tarifa_facturada()'];
    v_tabla TEXT;
    v_rol TEXT;
    v_privilegio TEXT;
    v_funcion TEXT;
    v_n INTEGER;
    v_estado TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY v_tablas LOOP
        -- B1. RLS habilitada y sin ninguna política (EPT-101 agrega el acceso).
        PERFORM pg_temp.afirmar(
            (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
             WHERE c.oid = pg_catalog.to_regclass('public.' || v_tabla)),
            'B1: RLS habilitada en ' || v_tabla);
        SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = v_tabla AND p.permissive = 'PERMISSIVE';
        PERFORM pg_temp.afirmar(v_n = 0, 'B1: ' || v_tabla || ' no tiene políticas permisivas');
        -- La única política es la RESTRICTIVE de bloqueo que EPT-59 exige a toda
        -- tabla nueva: no concede nada, solo restringe.
        SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = v_tabla;
        PERFORM pg_temp.afirmar(v_n = 1 AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = v_tabla
              AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL'
              AND p.policyname = 'Bloqueo de acceso sin datos protegidos'
              AND p.roles = ARRAY['authenticated']::NAME[]),
            'B1: ' || v_tabla || ' solo tiene la política RESTRICTIVE de bloqueo (EPT-59)');

        -- B2. Privilegio efectivo (incluye herencia de roles y PUBLIC) y por columna.
        FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                                'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
                PERFORM pg_temp.afirmar(
                    NOT pg_catalog.has_table_privilege(v_rol, 'public.' || v_tabla, v_privilegio),
                    'B2: ' || v_rol || ' sin ' || v_privilegio || ' sobre ' || v_tabla);
            END LOOP;
            FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
                PERFORM pg_temp.afirmar(
                    NOT pg_catalog.has_any_column_privilege(v_rol, 'public.' || v_tabla, v_privilegio),
                    'B2: ' || v_rol || ' sin ' || v_privilegio || ' por columna en ' || v_tabla);
            END LOOP;
        END LOOP;

        -- B3. PUBLIC (grantee 0) tampoco tiene ningún privilegio de tabla.
        SELECT pg_catalog.count(*) INTO v_n
        FROM pg_catalog.pg_class c,
             LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
        WHERE c.oid = pg_catalog.to_regclass('public.' || v_tabla) AND a.grantee = 0;
        PERFORM pg_temp.afirmar(v_n = 0, 'B3: PUBLIC sin privilegios sobre ' || v_tabla);

        -- B4. Sin herencia de tablas (un hijo podría exponer filas por otra vía).
        SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_inherits i
        WHERE i.inhrelid = pg_catalog.to_regclass('public.' || v_tabla)
           OR i.inhparent = pg_catalog.to_regclass('public.' || v_tabla);
        PERFORM pg_temp.afirmar(v_n = 0, 'B4: ' || v_tabla || ' sin herencia ni particiones');
    END LOOP;

    -- B5. Funciones auxiliares: sin EXECUTE para PUBLIC, anon, authenticated ni service_role.
    FOREACH v_funcion IN ARRAY v_funciones LOOP
        FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            PERFORM pg_temp.afirmar(
                NOT pg_catalog.has_function_privilege(v_rol, v_funcion, 'EXECUTE'),
                'B5: ' || v_rol || ' sin EXECUTE sobre ' || v_funcion);
        END LOOP;
        SELECT pg_catalog.count(*) INTO v_n
        FROM pg_catalog.pg_proc p,
             LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE p.oid = pg_catalog.to_regprocedure(v_funcion) AND a.grantee = 0;
        PERFORM pg_temp.afirmar(v_n = 0, 'B5: PUBLIC sin EXECUTE sobre ' || v_funcion);
        PERFORM pg_temp.afirmar(
            (SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig)
             FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_funcion)),
            'B5: ' || v_funcion || ' es SECURITY DEFINER con search_path vacío');
    END LOOP;

    -- B6. Intento real con cada rol, con y sin JWT de actor. La denegación debe
    -- ser 42501 (privilegio), no un error de otra naturaleza ni la recursión 42P17.
    PERFORM pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', pg_temp.u(1), 'role', 'authenticated')::TEXT, TRUE);
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', v_rol);
        FOREACH v_tabla IN ARRAY v_tablas LOOP
            FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
                v_estado := NULL;
                BEGIN
                    IF v_privilegio = 'SELECT' THEN
                        EXECUTE pg_catalog.format('SELECT 1 FROM public.%I', v_tabla);
                    ELSIF v_privilegio = 'INSERT' THEN
                        EXECUTE pg_catalog.format('INSERT INTO public.%I DEFAULT VALUES', v_tabla);
                    ELSIF v_privilegio = 'UPDATE' THEN
                        EXECUTE pg_catalog.format('UPDATE public.%I SET %I = %I', v_tabla,
                            CASE v_tabla WHEN 'feriados' THEN 'descripcion'
                                WHEN 'imputaciones_pago' THEN 'activa' ELSE 'id' END,
                            CASE v_tabla WHEN 'feriados' THEN 'descripcion'
                                WHEN 'imputaciones_pago' THEN 'activa' ELSE 'id' END);
                    ELSIF v_privilegio = 'DELETE' THEN
                        EXECUTE pg_catalog.format('DELETE FROM public.%I', v_tabla);
                    ELSE
                        EXECUTE pg_catalog.format('TRUNCATE public.%I', v_tabla);
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
                END;
                IF v_estado IS DISTINCT FROM '42501' THEN
                    RESET ROLE;
                    RAISE EXCEPTION 'FALLO B6: % con % sobre % devolvió % en vez de 42501',
                        v_rol, v_privilegio, v_tabla, COALESCE(v_estado, 'éxito');
                END IF;
            END LOOP;
        END LOOP;
        RESET ROLE;
        PERFORM pg_temp.afirmar(TRUE,
            'B6: ' || v_rol || ' (con JWT de director) recibe 42501 en SELECT/INSERT/UPDATE/DELETE/TRUNCATE de las ocho tablas');
    END LOOP;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
END;
$$;


-- ================================================================
-- C. TARIFAS
-- ================================================================
DO $$
DECLARE
    v_nivel_vig INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'NIVEL EPT100 VIGENCIAS');
    v_primario INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO');
BEGIN
    -- C1. Exactamente la referencia que corresponde al concepto.
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, deporte_id, importe, desde)
        VALUES ('CUOTA', %s, pg_temp.u(205), 1, '2040-01-01')$s$, v_nivel_vig),
        '23514', 'C1: CUOTA con nivel y deporte a la vez');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, importe, desde)
        VALUES ('DEPORTE', 1, '2040-01-01')$s$,
        '23514', 'C1: DEPORTE sin ninguna referencia');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde)
        VALUES ('DEPORTE', %s, 1, '2040-01-01')$s$, v_nivel_vig),
        '23514', 'C1: DEPORTE con referencia de nivel');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, servicio_id, importe, desde)
        VALUES ('COMEDOR', pg_temp.u(205), 'e0000000-0000-4000-8000-000000000010', 1, '2040-01-01')$s$,
        '23514', 'C1: COMEDOR con deporte y servicio a la vez');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('TRANSPORTE', pg_temp.u(205), 1, '2040-01-01')$s$,
        '23514', 'C1: TRANSPORTE con referencia de deporte');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde)
        VALUES ('CUOTA', 2147483000, 1, '2040-01-01')$s$,
        '23503', 'C1: CUOTA con nivel inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, servicio_id, importe, desde)
        VALUES ('COMEDOR', pg_catalog.gen_random_uuid(), 1, '2040-01-01')$s$,
        '23503', 'C1: COMEDOR con servicio inexistente');

    -- C2. El servicio de la tarifa es del tipo que su concepto dice.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, servicio_id, importe, desde)
        VALUES ('COMEDOR', pg_temp.u(301), 1, '2040-01-01')$s$,
        'P6801', 'C2: tarifa COMEDOR ligada a un recorrido de TRANSPORTE');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, servicio_id, importe, desde)
        VALUES ('TRANSPORTE', 'e0000000-0000-4000-8000-000000000010', 1, '2040-01-01')$s$,
        'P6801', 'C2: tarifa TRANSPORTE ligada al COMEDOR');
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET concepto = 'COMEDOR' WHERE id = pg_temp.u(407)$s$,
        'P6801', 'C2: UPDATE del concepto hacia uno que no es el del servicio');
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET servicio_id = 'e0000000-0000-4000-8000-000000000010'
        WHERE id = pg_temp.u(407)$s$,
        'P6801', 'C2: UPDATE del servicio hacia uno de otro tipo');

    -- C3. Importes: no negativos, finitos y dentro de la capacidad.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), -0.01, '2040-01-01')$s$,
        '23514', 'C3: importe negativo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), 'NaN'::NUMERIC, '2040-01-01')$s$,
        '23514', 'C3: NaN (que >= 0 aceptaría) queda excluido explícitamente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), 10000000000, '2040-01-01')$s$,
        '22003', 'C3: desborde de capacidad (10^10 no cabe en NUMERIC(12,2))');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), 'Infinity'::NUMERIC, '2040-01-01')$s$,
        '22003', 'C3: infinito rechazado con precisión declarada');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe)
        VALUES ('DEPORTE', pg_temp.u(205), 1)$s$,
        '23502', 'C3: la vigencia desde es obligatoria');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), NULL, '2040-01-01')$s$,
        '23502', 'C3: el importe es obligatorio');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', pg_temp.u(205), 0, '2026-12-31', '2026-12-31')$s$,
        'C3: importe cero y vigencia de un solo día [D, D] aceptados');

    -- C3b. Fechas finitas: `infinity` es un DATE válido para PostgreSQL pero no una
    -- vigencia; la ausencia de fin se expresa con `hasta` NULL.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), 1, 'infinity')$s$,
        '23514', 'C3b: vigencia desde = infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '-infinity')$s$,
        '23514', 'C3b: vigencia desde = -infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '2045-01-01', 'infinity')$s$,
        '23514', 'C3b: vigencia hasta = infinity (el fin ausente es NULL)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '2045-01-01', '-infinity')$s$,
        '23514', 'C3b: vigencia hasta = -infinity');
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET hasta = 'infinity' WHERE id = pg_temp.u(407)$s$,
        '23514', 'C3b: UPDATE de la vigencia hacia infinity');
    PERFORM pg_temp.positiva(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta)
        VALUES ('CUOTA', %s, 1, '2060-01-01', '2060-12-31'),
               ('CUOTA', %s, 1, '2061-01-01', NULL)$s$, v_nivel_vig, v_nivel_vig),
        'C3b: fechas finitas válidas y fin ausente expresado con NULL');

    -- C3c. TIMESTAMPTZ finito: `creada_en` tiene DEFAULT NOW(), pero un valor explícito
    -- `infinity` o `-infinity` es válido para PostgreSQL y el DEFAULT no lo impide.
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta, creada_en)
        VALUES ('CUOTA', %s, 1, '2059-01-01', '2059-12-31', 'infinity')$s$, v_nivel_vig),
        '23514', 'C3c: creada_en = infinity (INSERT)');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta, creada_en)
        VALUES ('CUOTA', %s, 1, '2059-01-01', '2059-12-31', '-infinity')$s$, v_nivel_vig),
        '23514', 'C3c: creada_en = -infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET creada_en = 'infinity' WHERE id = pg_temp.u(407)$s$,
        '23514', 'C3c: creada_en = infinity (UPDATE)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET creada_en = '-infinity' WHERE id = pg_temp.u(407)$s$,
        '23514', 'C3c: creada_en = -infinity (UPDATE)');
    PERFORM pg_temp.positiva(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta, creada_en)
        VALUES ('CUOTA', %s, 1, '2059-01-01', '2059-12-31', '2026-01-15 12:00:00+00')$s$, v_nivel_vig),
        'C3c: creada_en con un instante válido (INSERT)');
    PERFORM pg_temp.positiva($s$
        UPDATE public.tarifas SET creada_en = '2026-01-02 00:00:00+00' WHERE id = pg_temp.u(407)$s$,
        'C3c: creada_en con un instante válido (UPDATE)');

    -- C4. Vigencias: rango cerrado [desde, hasta], hasta NULL = sin fin.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '2027-02-01', '2027-01-31')$s$,
        '23514', 'C4: hasta anterior a desde');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.tarifas (id, concepto, deporte_id, importe, desde, hasta)
        VALUES (pg_temp.u(411), 'DEPORTE', pg_temp.u(205), 100, '2027-01-01', '2027-06-30')$s$,
        'C4: primera vigencia [2027-01-01, 2027-06-30]');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '2027-06-30', '2027-12-31')$s$,
        '23P01', 'C4: comparte el último día (hasta es inclusivo) → solapa');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '2027-03-01', '2027-03-31')$s$,
        '23P01', 'C4: vigencia contenida dentro de otra');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.tarifas (id, concepto, deporte_id, importe, desde)
        VALUES (pg_temp.u(412), 'DEPORTE', pg_temp.u(205), 120, '2027-07-01')$s$,
        'C4: vigencia contigua desde el día siguiente, sin fin (hasta NULL)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '2030-01-01')$s$,
        '23P01', 'C4: otra vigencia posterior a una que no tiene fin');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
        VALUES ('DEPORTE', pg_temp.u(205), 1, '2026-12-01', '2026-12-31')$s$,
        '23P01', 'C4: toca el día 2026-12-31 de la vigencia de un solo día');
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET hasta = '2027-07-15' WHERE id = pg_temp.u(411)$s$,
        '23P01', 'C4: UPDATE que extiende la vigencia sobre la siguiente');
    PERFORM pg_temp.positiva($s$
        UPDATE public.tarifas SET hasta = '2027-06-29' WHERE id = pg_temp.u(411)$s$,
        'C4: UPDATE que acorta la vigencia y deja un hueco de un día');
    PERFORM pg_temp.positiva($s$
        UPDATE public.tarifas SET hasta = '2027-06-30' WHERE id = pg_temp.u(411)$s$,
        'C4: y el hueco se vuelve a cerrar sin solapar');

    -- Mismas fechas en otra referencia (otro nivel, otro servicio): independientes.
    PERFORM pg_temp.positiva(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta)
        VALUES ('CUOTA', %s, 100, '2027-01-01', '2027-06-30')$s$, v_nivel_vig),
        'C4: mismas fechas en otro nivel conviven');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta)
        VALUES ('CUOTA', %s, 100, '2027-06-30', '2027-09-30')$s$, v_nivel_vig),
        '23P01', 'C4: el solapamiento por nivel también se excluye');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, servicio_id, importe, desde)
        VALUES ('TRANSPORTE', pg_temp.u(301), 1, '2026-06-01')$s$,
        '23P01', 'C4: el solapamiento por servicio también se excluye');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.tarifas (concepto, servicio_id, importe, desde)
        VALUES ('COMEDOR', 'e0000000-0000-4000-8000-000000000010', 1, '2040-01-01')$s$,
        '23P01', 'C4: el comedor ya tiene una vigencia sin fin que cubre 2040');
    PERFORM pg_temp.afirmar(v_primario IS NOT NULL, 'C4: fixture de nivel primario presente');
END;
$$;


-- ================================================================
-- D. FACTURAS
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2026-11-01', '2026-11-10', 1)$s$,
        '23505', 'D1: una sola factura por alumno y período');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-01-01', '2027-01-10', 0),
               (pg_temp.u(2), '2027-02-01', '2027-02-10', 0)$s$,
        'D1: períodos distintos del mismo alumno conviven (enero y febrero)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-15', '2027-03-24', 0)$s$,
        '23514', 'D2: el período debe ser el primer día del mes');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '2027-03-09', 0)$s$,
        '23514', 'D2: vencimiento el día 9');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '2027-03-11', 0)$s$,
        '23514', 'D2: vencimiento el día 11');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '2027-04-10', 0)$s$,
        '23514', 'D2: vencimiento el día 10 pero del mes siguiente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', NULL, 0)$s$,
        '23502', 'D2: el vencimiento es obligatorio');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '2027-03-10', -1)$s$,
        '23514', 'D3: total negativo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '2027-03-10', 'NaN'::NUMERIC)$s$,
        '23514', 'D3: total NaN');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '2027-03-10', 10000000000)$s$,
        '22003', 'D3: total fuera de capacidad');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '2027-03-10', NULL)$s$,
        '23502', 'D3: el total no tiene valor por defecto (no nace en cero)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_catalog.gen_random_uuid(), '2027-03-01', '2027-03-10', 0)$s$,
        '23503', 'D4: alumno inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(5), '2027-03-01', '2027-03-10', 0)$s$,
        '23503', 'D4: el titular debe ser un alumno (un padre no lo es)');
    -- D2b. Fechas finitas: `date_part('day', 'infinity')` es NULL y un CHECK con
    -- resultado NULL se da por cumplido; sin `isfinite` pasaban `infinity` y
    -- `-infinity` como período y como vencimiento.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), 'infinity', 'infinity', 0)$s$,
        '23514', 'D2b: período y vencimiento = infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '-infinity', '-infinity', 0)$s$,
        '23514', 'D2b: período y vencimiento = -infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), 'infinity', '2027-03-10', 0)$s$,
        '23514', 'D2b: período = infinity con vencimiento finito');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', 'infinity', 0)$s$,
        '23514', 'D2b: período finito con vencimiento = infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(2), '2027-03-01', '-infinity', 0)$s$,
        '23514', 'D2b: período finito con vencimiento = -infinity');
    PERFORM pg_temp.negativa($s$
        UPDATE public.facturas SET periodo = 'infinity' WHERE id = pg_temp.u(803)$s$,
        '23514', 'D2b: UPDATE del período a infinity');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(3), '2028-02-01', '2028-02-10', 0),
               (pg_temp.u(3), '2028-12-01', '2028-12-10', 0)$s$,
        'D2b: fechas finitas válidas (febrero y diciembre) siguen aceptadas');

    -- D2c. `generada_en` finito: DEFAULT NOW() no impide un valor explícito infinito.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total, generada_en)
        VALUES (pg_temp.u(3), '2029-03-01', '2029-03-10', 0, 'infinity')$s$,
        '23514', 'D2c: generada_en = infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total, generada_en)
        VALUES (pg_temp.u(3), '2029-03-01', '2029-03-10', 0, '-infinity')$s$,
        '23514', 'D2c: generada_en = -infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.facturas SET generada_en = 'infinity' WHERE id = pg_temp.u(803)$s$,
        '23514', 'D2c: generada_en = infinity (UPDATE)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.facturas SET generada_en = '-infinity' WHERE id = pg_temp.u(803)$s$,
        '23514', 'D2c: generada_en = -infinity (UPDATE)');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total, generada_en)
        VALUES (pg_temp.u(3), '2029-03-01', '2029-03-10', 0, '2029-02-20 09:00:00-03')$s$,
        'D2c: generada_en con un instante válido (INSERT)');
    PERFORM pg_temp.positiva($s$
        UPDATE public.facturas SET generada_en = '2026-11-25 09:00:00-03' WHERE id = pg_temp.u(803)$s$,
        'D2c: generada_en con un instante válido (UPDATE)');

    PERFORM pg_temp.negativa($s$
        UPDATE public.facturas SET periodo = '2026-11-02' WHERE id = pg_temp.u(801)$s$,
        '23514', 'D5: UPDATE del período a un día que no es el primero');
    PERFORM pg_temp.negativa($s$
        UPDATE public.facturas SET total = 'NaN'::NUMERIC WHERE id = pg_temp.u(801)$s$,
        '23514', 'D5: UPDATE del total a NaN');
    PERFORM pg_temp.negativa($s$
        UPDATE public.facturas
        SET alumno_id = pg_temp.u(3), periodo = '2027-05-01', vencimiento = '2027-05-10'
        WHERE id = pg_temp.u(801)$s$,
        '23503', 'D5: UPDATE de alumno con ítems de otro hijo (FK compuesta)');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.facturas WHERE id = pg_temp.u(801)$s$,
        '23503', 'D6: no se borra una factura con ítems (RESTRICT, sin cascada)');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.alumnos WHERE perfil_id = pg_temp.u(2)$s$,
        '23503', 'D6: no se borra un alumno con facturas, matrículas o inscripciones');
END;
$$;


-- ================================================================
-- E. ITEMS DE FACTURA
-- ================================================================
DO $$
BEGIN
    -- Factura limpia de A (abril de 2027) para las negativas que dependen de la
    -- FK: el UNIQUE por origen se evalúa antes que la FK y las taparía.
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
        VALUES (pg_temp.u(804), pg_temp.u(2), '2027-04-01', '2027-04-10', 0)$s$,
        'E0: factura limpia de A para negativas de FK');

    -- E1. El mismo origen no se factura dos veces dentro de una factura.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(801), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(701), 50000)$s$,
        '23505', 'E1: la matrícula ya está en la factura');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_deportiva_id, importe)
        VALUES (pg_temp.u(801), pg_temp.u(2), 'DEPORTE', pg_temp.u(403), pg_temp.u(501), 8000)$s$,
        '23505', 'E1: la inscripción deportiva ya está en la factura');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(801), pg_temp.u(2), 'COMEDOR', pg_temp.u(405), pg_temp.u(601), 12000)$s$,
        '23505', 'E1: la inscripción al servicio ya está en la factura');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(921), pg_temp.u(803), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(701), 50000)$s$,
        'E1: el mismo origen sí se factura en otro período (diciembre)');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(922), pg_temp.u(803), pg_temp.u(2), 'COMEDOR', pg_temp.u(405), pg_temp.u(601), 12000)$s$,
        'E1: y también el comedor del mismo alumno en diciembre');

    -- E2. Exactamente el origen que corresponde al tipo.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(602), 1)$s$,
        '23514', 'E2: CUOTA con origen de servicio');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'DEPORTE', pg_temp.u(403), pg_temp.u(701), 1)$s$,
        '23514', 'E2: DEPORTE con origen de matrícula');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id,
                                          inscripcion_deportiva_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(701), pg_temp.u(501), 1)$s$,
        '23514', 'E2: dos orígenes a la vez');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'TRANSPORTE', pg_temp.u(406), 1)$s$,
        '23514', 'E2: ningún origen');

    -- E3. Hijo correcto: el origen es del mismo alumno que la factura.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(802), pg_temp.u(3), 'CUOTA', pg_temp.u(401), pg_temp.u(701), 1)$s$,
        'P6802', 'E3: matrícula de otro hijo en la factura de B');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_deportiva_id, importe)
        VALUES (pg_temp.u(802), pg_temp.u(3), 'DEPORTE', pg_temp.u(403), pg_temp.u(501), 1)$s$,
        'P6802', 'E3: inscripción deportiva de otro hijo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(802), pg_temp.u(3), 'TRANSPORTE', pg_temp.u(406), pg_temp.u(602), 1)$s$,
        'P6802', 'E3: inscripción a servicio de otro hijo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(802), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(701), 1)$s$,
        '23503', 'E3: ítem de A dentro de la factura de B (FK compuesta factura/alumno)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET matricula_id = pg_temp.u(702) WHERE id = pg_temp.u(901)$s$,
        'P6802', 'E3: UPDATE del origen hacia la matrícula de otro hijo');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET inscripcion_servicio_id = pg_temp.u(603) WHERE id = pg_temp.u(904)$s$,
        'P6802', 'E3: UPDATE del origen hacia el comedor de otro hijo');

    -- E4. Tarifa correcta: concepto y referencia del origen.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'CUOTA', pg_temp.u(402), pg_temp.u(701), 1)$s$,
        'P6803', 'E4: cuota con la tarifa de otro nivel (inicial para un alumno primario)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_deportiva_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'DEPORTE', pg_temp.u(403), pg_temp.u(502), 1)$s$,
        'P6803', 'E4: natación facturada con la tarifa de fútbol');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'TRANSPORTE', pg_temp.u(407), pg_temp.u(602), 1)$s$,
        'P6803', 'E4: recorrido uno facturado con la tarifa del recorrido dos');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'COMEDOR', pg_temp.u(405), pg_temp.u(602), 1)$s$,
        'P6803', 'E4: ítem COMEDOR sobre una inscripción de TRANSPORTE');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(803), pg_temp.u(2), 'TRANSPORTE', pg_temp.u(406), pg_temp.u(601), 1)$s$,
        'P6803', 'E4: ítem TRANSPORTE sobre la inscripción del COMEDOR');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(804), pg_temp.u(2), 'COMEDOR', pg_temp.u(406), pg_temp.u(601), 1)$s$,
        '23503', 'E4: ítem COMEDOR con una tarifa de TRANSPORTE (FK tarifa/tipo)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(804), pg_temp.u(2), 'CUOTA', pg_temp.u(403), pg_temp.u(701), 1)$s$,
        '23503', 'E4: ítem CUOTA con una tarifa de DEPORTE (FK tarifa/tipo)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET tarifa_id = pg_temp.u(404) WHERE id = pg_temp.u(902)$s$,
        'P6803', 'E4: UPDATE de la tarifa hacia otro deporte del mismo concepto');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET tarifa_id = pg_temp.u(406) WHERE id = pg_temp.u(904)$s$,
        '23503', 'E4: UPDATE de la tarifa hacia otro concepto');

    -- E5. Existencia de las referencias.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(804), pg_temp.u(2), 'CUOTA', pg_catalog.gen_random_uuid(), pg_temp.u(701), 1)$s$,
        '23503', 'E5: tarifa inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_temp.u(804), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_catalog.gen_random_uuid(), 1)$s$,
        '23503', 'E5: matrícula inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_deportiva_id, importe)
        VALUES (pg_temp.u(804), pg_temp.u(2), 'DEPORTE', pg_temp.u(403), pg_catalog.gen_random_uuid(), 1)$s$,
        '23503', 'E5: inscripción deportiva inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(804), pg_temp.u(2), 'COMEDOR', pg_temp.u(405), pg_catalog.gen_random_uuid(), 1)$s$,
        '23503', 'E5: inscripción a servicio inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
        VALUES (pg_catalog.gen_random_uuid(), pg_temp.u(2), 'CUOTA', pg_temp.u(401), pg_temp.u(701), 1)$s$,
        '23503', 'E5: factura inexistente');

    -- E6. Importes y estado.
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET importe = -1 WHERE id = pg_temp.u(901)$s$,
        '23514', 'E6: importe de ítem negativo');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET importe = 'NaN'::NUMERIC WHERE id = pg_temp.u(901)$s$,
        '23514', 'E6: importe de ítem NaN');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET importe = 10000000000 WHERE id = pg_temp.u(901)$s$,
        '22003', 'E6: importe de ítem fuera de capacidad');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET estado_pago = 'PARCIAL' WHERE id = pg_temp.u(901)$s$,
        '22P02', 'E6: estado de ítem fuera del enumerado (no existe pago parcial de un ítem)');
    PERFORM pg_temp.afirmar(
        (SELECT estado_pago FROM public.items_factura WHERE id = pg_temp.u(901)) = 'PENDIENTE',
        'E6: el estado inicial del ítem es PENDIENTE');

    -- E7. El historial se conserva: una inscripción ya cancelada sigue siendo
    -- facturable en una factura pasada.
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, inscripcion_servicio_id, importe)
        VALUES (pg_temp.u(913), pg_temp.u(802), pg_temp.u(3), 'TRANSPORTE', pg_temp.u(406), pg_temp.u(604), 7000)$s$,
        'E7: ítem de una inscripción ya CANCELADA (no se exige que siga activa)');

    -- E8. Una tarifa ya facturada no cambia de referencia, pero su vigencia y su
    -- importe pueden corregirse sin reescribir el historial de los ítems.
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET servicio_id = pg_temp.u(302) WHERE id = pg_temp.u(406)$s$,
        'P6804', 'E8: tarifa facturada no cambia de servicio');
    PERFORM pg_temp.negativa($s$
        UPDATE public.tarifas SET concepto = 'COMEDOR' WHERE id = pg_temp.u(406)$s$,
        'P6804', 'E8: tarifa facturada no cambia de concepto');
    PERFORM pg_temp.positiva($s$
        UPDATE public.tarifas SET importe = 7100.00, hasta = '2027-12-31' WHERE id = pg_temp.u(406)$s$,
        'E8: sí puede cerrarse su vigencia y corregirse su importe');
    PERFORM pg_temp.afirmar(
        (SELECT importe FROM public.items_factura WHERE id = pg_temp.u(905)) = 7000.00,
        'E8: el ítem ya facturado conserva su importe histórico');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.tarifas WHERE id = pg_temp.u(401)$s$,
        '23503', 'E8: no se borra una tarifa con ítems');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.matriculas WHERE id = pg_temp.u(701)$s$,
        '23503', 'E8: no se borra una matrícula facturada');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.inscripciones_servicios WHERE id = pg_temp.u(601)$s$,
        '23503', 'E8: no se borra una inscripción a servicio facturada');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.inscripciones_deportivas WHERE id = pg_temp.u(501)$s$,
        '23503', 'E8: no se borra una inscripción deportiva facturada');
END;
$$;


-- ================================================================
-- F. PAGOS
-- ================================================================
DO $$
BEGIN
    -- F1. El pago nace antes de informar la transferencia (EPT-98).
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
        VALUES (pg_temp.u(1001), pg_temp.u(5), pg_temp.u(2), 86000.00)$s$,
        'F1: registrar_pago(ids) puede crear el pago sin fecha, importe ni número');
    PERFORM pg_temp.afirmar(
        (SELECT estado = 'PENDIENTE_VERIFICACION' AND fecha_transferencia IS NULL
                AND importe_informado IS NULL AND numero_operacion IS NULL
                AND verificado_por IS NULL
         FROM public.pagos WHERE id = pg_temp.u(1001)),
        'F1: estado inicial PENDIENTE_VERIFICACION con datos de conciliación nulos');
    PERFORM pg_temp.positiva($s$
        UPDATE public.pagos
        SET fecha_transferencia = '2026-11-03', importe_informado = 85999.50, numero_operacion = 'OP-100'
        WHERE id = pg_temp.u(1001)$s$,
        'F1: adjuntar_comprobante informa los tres datos y el importe puede diferir del calculado');

    -- F2. Número informado nunca vacío; importes válidos; referencias reales.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, '')$s$,
        '23514', 'F2: número de operación vacío');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, E'  \t ')$s$,
        '23514', 'F2: número de operación solo con espacios');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado)
        VALUES (pg_temp.u(5), pg_temp.u(2), -1)$s$,
        '23514', 'F2: total calculado negativo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado)
        VALUES (pg_temp.u(5), pg_temp.u(2), NULL)$s$,
        '23502', 'F2: el total calculado es obligatorio');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, importe_informado)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'NaN'::NUMERIC)$s$,
        '23514', 'F2: importe informado NaN');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, importe_informado)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, -5)$s$,
        '23514', 'F2: importe informado negativo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, importe_informado)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 10000000000)$s$,
        '22003', 'F2: importe informado fuera de capacidad');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado)
        VALUES (pg_catalog.gen_random_uuid(), pg_temp.u(2), 1)$s$,
        '23503', 'F2: padre inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado)
        VALUES (pg_temp.u(5), pg_temp.u(5), 1)$s$,
        '23503', 'F2: el hijo debe ser un alumno');

    -- F2b. La fecha de transferencia, si se informa, es finita.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, fecha_transferencia)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'infinity')$s$,
        '23514', 'F2b: fecha de transferencia = infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, fecha_transferencia)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, '-infinity')$s$,
        '23514', 'F2b: fecha de transferencia = -infinity');
    PERFORM pg_temp.negativa($s$
        UPDATE public.pagos SET fecha_transferencia = 'infinity' WHERE id = pg_temp.u(1001)$s$,
        '23514', 'F2b: UPDATE de la fecha de transferencia a infinity');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, fecha_transferencia)
        VALUES (pg_temp.u(5), pg_temp.u(3), 1, '2026-11-30')$s$,
        'F2b: fecha de transferencia finita válida');

    -- F3. La decisión de Dirección deja un rastro coherente con el estado.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'APROBADO')$s$,
        '23514', 'F3: APROBADO sin verificador');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado, verificado_por, verificado_en)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'APROBADO', pg_temp.u(1), NOW())$s$,
        '23514', 'F3: APROBADO sin la transferencia informada');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado, verificado_por,
                                  verificado_en, motivo_rechazo, fecha_transferencia,
                                  importe_informado, numero_operacion)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'APROBADO', pg_temp.u(1), NOW(), 'no corresponde',
                '2026-11-03', 1, 'OP-X')$s$,
        '23514', 'F3: APROBADO con motivo de rechazo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado, verificado_por, verificado_en)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'RECHAZADO', pg_temp.u(1), NOW())$s$,
        '23514', 'F3: RECHAZADO sin motivo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado, verificado_por,
                                  verificado_en, motivo_rechazo)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'RECHAZADO', pg_temp.u(1), NOW(), '   ')$s$,
        '23514', 'F3: RECHAZADO con motivo en blanco');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, verificado_por)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, pg_temp.u(1))$s$,
        '23514', 'F3: PENDIENTE con verificador');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado, verificado_por, verificado_en, motivo_rechazo)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'RECHAZADO', pg_catalog.gen_random_uuid(), NOW(), 'x')$s$,
        '23503', 'F3: verificador inexistente');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, estado, verificado_por,
                                  verificado_en, fecha_transferencia, importe_informado, numero_operacion)
        VALUES (pg_temp.u(1004), pg_temp.u(5), pg_temp.u(2), 12000, 'APROBADO', pg_temp.u(1), NOW(),
                '2026-11-04', 12000, 'OP-200')$s$,
        'F3: pago APROBADO con transferencia completa y verificador');

    -- F4. Número de operación único entre pagos no rechazados.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'OP-100')$s$,
        '23505', 'F4: operación duplicada entre pagos no rechazados');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(5), pg_temp.u(3), 1, '  OP-100 ')$s$,
        '23505', 'F4: la duplicada se detecta aunque cambien los espacios de los extremos (otro hijo)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(5), pg_temp.u(3), 1, E'\tOP-100\r\n')$s$,
        '23505', 'F4: ni con tabulaciones y saltos de línea en los extremos');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(1002), pg_temp.u(5), pg_temp.u(2), 1, 'op-100')$s$,
        'F4: límite conocido: no se normalizan mayúsculas ("op-100" ≠ "OP-100")');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
        VALUES (pg_temp.u(1005), pg_temp.u(5), pg_temp.u(2), 1), (pg_temp.u(1006), pg_temp.u(5), pg_temp.u(2), 1)$s$,
        'F4: varios pagos sin número informado conviven (NULL no colisiona)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.pagos SET numero_operacion = 'OP-100' WHERE id = pg_temp.u(1002)$s$,
        '23505', 'F4: UPDATE del número hacia uno ya usado por un pago vigente');
    PERFORM pg_temp.positiva($s$
        UPDATE public.pagos
        SET estado = 'RECHAZADO', verificado_por = pg_temp.u(1), verificado_en = NOW(),
            motivo_rechazo = 'No coincide con el extracto'
        WHERE id = pg_temp.u(1001)$s$,
        'F4: Dirección rechaza el pago 1001 y conserva su historial');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(1003), pg_temp.u(5), pg_temp.u(2), 86000, 'OP-100')$s$,
        'F4: tras el rechazo el número queda libre y otro pago puede usarlo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'OP-100')$s$,
        '23505', 'F4: y vuelve a estar ocupado mientras ese nuevo pago no se rechace');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.pagos
         WHERE id = pg_temp.u(1001) AND estado = 'RECHAZADO' AND numero_operacion = 'OP-100') = 1,
        'F4: el pago rechazado sigue en el historial con su número');

    -- F4b. `creado_en` y `verificado_en` finitos. Se prueban con el pago 1001, ya
    -- RECHAZADO (verificador y fecha informados), para que el único CHECK que falle
    -- sea el de isfinite y no el de coherencia con el estado.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, creado_en)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'infinity')$s$,
        '23514', 'F4b: creado_en = infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, creado_en)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, '-infinity')$s$,
        '23514', 'F4b: creado_en = -infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.pagos SET creado_en = 'infinity' WHERE id = pg_temp.u(1001)$s$,
        '23514', 'F4b: creado_en = infinity (UPDATE)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.pagos SET creado_en = '-infinity' WHERE id = pg_temp.u(1001)$s$,
        '23514', 'F4b: creado_en = -infinity (UPDATE)');
    PERFORM pg_temp.positiva($s$
        UPDATE public.pagos SET creado_en = '2026-11-02 10:00:00+00' WHERE id = pg_temp.u(1001)$s$,
        'F4b: creado_en con un instante válido (UPDATE)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado, verificado_por,
                                  verificado_en, motivo_rechazo)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'RECHAZADO', pg_temp.u(1), 'infinity', 'motivo')$s$,
        '23514', 'F4b: verificado_en = infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, estado, verificado_por,
                                  verificado_en, motivo_rechazo)
        VALUES (pg_temp.u(5), pg_temp.u(2), 1, 'RECHAZADO', pg_temp.u(1), '-infinity', 'motivo')$s$,
        '23514', 'F4b: verificado_en = -infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.pagos SET verificado_en = 'infinity' WHERE id = pg_temp.u(1001)$s$,
        '23514', 'F4b: verificado_en = infinity (UPDATE)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.pagos SET verificado_en = '-infinity' WHERE id = pg_temp.u(1001)$s$,
        '23514', 'F4b: verificado_en = -infinity (UPDATE)');
    PERFORM pg_temp.positiva($s$
        UPDATE public.pagos SET verificado_en = '2026-11-05 10:00:00+00' WHERE id = pg_temp.u(1001)$s$,
        'F4b: verificado_en con un instante válido (UPDATE)');
    -- Los NULL legítimos se conservan: un pago pendiente no tiene verificación.
    PERFORM pg_temp.afirmar(
        (SELECT verificado_en IS NULL FROM public.pagos WHERE id = pg_temp.u(1005)),
        'F4b: un pago pendiente conserva verificado_en NULL');
    PERFORM pg_temp.positiva($s$
        UPDATE public.pagos SET verificado_en = NULL WHERE id = pg_temp.u(1005)$s$,
        'F4b: verificado_en NULL sigue aceptado en un pago pendiente');

    -- F5. Sin borrado en cascada del historial de pagos.
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
        VALUES (pg_temp.u(1010), pg_temp.u(5), pg_temp.u(3), 52000)$s$,
        'F5: pago del segundo hijo (otro alumno, otro total)');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.perfiles WHERE id = pg_temp.u(5)$s$,
        '23503', 'F5: no se borra un perfil con pagos');
END;
$$;


-- ================================================================
-- G. IMPUTACIONES DE PAGO
-- ================================================================
DO $$
BEGIN
    -- G1. Un pago abarca ítems de una o varias facturas del mismo hijo.
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1003), pg_temp.u(901), pg_temp.u(2), 50000),
               (pg_temp.u(1003), pg_temp.u(902), pg_temp.u(2), 8000),
               (pg_temp.u(1003), pg_temp.u(921), pg_temp.u(2), 50000)$s$,
        'G1: un pago imputa ítems de dos facturas (noviembre y diciembre) del mismo hijo');
    PERFORM pg_temp.afirmar(
        (SELECT activa FROM public.imputaciones_pago
         WHERE pago_id = pg_temp.u(1003) AND item_factura_id = pg_temp.u(901)),
        'G1: la imputación nace activa');

    -- G2. Pago e ítem del mismo hijo (FK compuestas).
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1003), pg_temp.u(911), pg_temp.u(2), 40000)$s$,
        '23503', 'G2: ítem del hijo B dentro de un pago del hijo A (alumno_id = A)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1003), pg_temp.u(911), pg_temp.u(3), 40000)$s$,
        '23503', 'G2: mismo caso declarando alumno_id = B');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1010), pg_temp.u(903), pg_temp.u(2), 9000)$s$,
        '23503', 'G2: ítem de A dentro de un pago de B (alumno_id = A)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1010), pg_temp.u(903), pg_temp.u(3), 9000)$s$,
        '23503', 'G2: mismo caso declarando alumno_id = B');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1010), pg_temp.u(911), pg_temp.u(3), 40000),
               (pg_temp.u(1010), pg_temp.u(912), pg_temp.u(3), 12000)$s$,
        'G2: el pago de B imputa los ítems de B');

    -- G3. Identidad reproducible y unicidad de la imputación activa.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1003), pg_temp.u(901), pg_temp.u(2), 50000)$s$,
        '23505', 'G3: un ítem aparece una sola vez por pago (clave primaria compuesta)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1005), pg_temp.u(901), pg_temp.u(2), 50000)$s$,
        '23505', 'G3: un ítem no puede estar en dos pagos con imputación activa');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa)
        VALUES (pg_temp.u(1005), pg_temp.u(901), pg_temp.u(2), 50000, FALSE)$s$,
        'G3: sí puede haber imputaciones inactivas (historial de pagos rechazados)');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa)
        VALUES (pg_temp.u(1006), pg_temp.u(901), pg_temp.u(2), 50000, FALSE)$s$,
        'G3: y varias inactivas del mismo ítem conviven');
    PERFORM pg_temp.negativa($s$
        UPDATE public.imputaciones_pago SET activa = TRUE
        WHERE pago_id = pg_temp.u(1005) AND item_factura_id = pg_temp.u(901)$s$,
        '23505', 'G3: reactivar una imputación mientras otra está activa');
    PERFORM pg_temp.positiva($s$
        UPDATE public.imputaciones_pago SET activa = FALSE
        WHERE pago_id = pg_temp.u(1003) AND item_factura_id = pg_temp.u(901)$s$,
        'G3: la liberación (activa = FALSE) del pago original');
    PERFORM pg_temp.positiva($s$
        UPDATE public.imputaciones_pago SET activa = TRUE
        WHERE pago_id = pg_temp.u(1005) AND item_factura_id = pg_temp.u(901)$s$,
        'G3: tras liberar, el ítem se reserva en otro pago');
    PERFORM pg_temp.negativa($s$
        UPDATE public.imputaciones_pago SET activa = TRUE
        WHERE pago_id = pg_temp.u(1003) AND item_factura_id = pg_temp.u(901)$s$,
        '23505', 'G3: y el pago original ya no puede recuperarlo');

    -- G4. Importes, referencias y cascadas.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1003), pg_temp.u(903), pg_temp.u(2), -1)$s$,
        '23514', 'G4: importe imputado negativo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1003), pg_temp.u(903), pg_temp.u(2), 'NaN'::NUMERIC)$s$,
        '23514', 'G4: importe imputado NaN');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_catalog.gen_random_uuid(), pg_temp.u(903), pg_temp.u(2), 9000)$s$,
        '23503', 'G4: pago inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        VALUES (pg_temp.u(1003), pg_catalog.gen_random_uuid(), pg_temp.u(2), 9000)$s$,
        '23503', 'G4: ítem inexistente');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.pagos WHERE id = pg_temp.u(1003)$s$,
        '23503', 'G4: no se borra un pago con imputaciones');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.items_factura WHERE id = pg_temp.u(902)$s$,
        '23503', 'G4: no se borra un ítem imputado');
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET alumno_id = pg_temp.u(3) WHERE id = pg_temp.u(902)$s$,
        'P6802', 'G4: no se reasigna el alumno de un ítem: el origen es de otro hijo');
END;
$$;


-- ================================================================
-- H. RECIBOS, FERIADOS Y ENVIOS DE CORREO
-- ================================================================
DO $$
BEGIN
    -- H1. Recibos.
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.recibos (pago_id, numero, archivo_path)
        VALUES (pg_temp.u(1004), 1, 'recibos/2026/1.pdf')$s$,
        'H1: recibo de un pago, con ruta de archivo');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero) VALUES (pg_temp.u(1004), 2)$s$,
        '23505', 'H1: un solo recibo por pago');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero) VALUES (pg_temp.u(1003), 1)$s$,
        '23505', 'H1: número de recibo único');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero) VALUES (pg_temp.u(1003), 0)$s$,
        '23514', 'H1: el número debe ser positivo (cero)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero) VALUES (pg_temp.u(1003), -5)$s$,
        '23514', 'H1: el número debe ser positivo (negativo)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero, archivo_path) VALUES (pg_temp.u(1003), 2, '  ')$s$,
        '23514', 'H1: la ruta, si se informa, no es vacía');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero) VALUES (pg_catalog.gen_random_uuid(), 3)$s$,
        '23503', 'H1: pago inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero) VALUES (pg_temp.u(1003), NULL)$s$,
        '23502', 'H1: el número es obligatorio y no tiene default (no hay numeración funcional)');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.recibos (pago_id, numero) VALUES (pg_temp.u(1003), 2)$s$,
        'H1: la ruta puede faltar mientras no exista el PDF');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.pagos WHERE id = pg_temp.u(1004)$s$,
        '23503', 'H1: no se borra un pago con recibo');

    -- H1b. `emitido_en` finito (DEFAULT NOW() no impide un valor explícito infinito).
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero, emitido_en)
        VALUES (pg_temp.u(1010), 90, 'infinity')$s$,
        '23514', 'H1b: emitido_en = infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.recibos (pago_id, numero, emitido_en)
        VALUES (pg_temp.u(1010), 90, '-infinity')$s$,
        '23514', 'H1b: emitido_en = -infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.recibos SET emitido_en = 'infinity' WHERE numero = 1$s$,
        '23514', 'H1b: emitido_en = infinity (UPDATE)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.recibos SET emitido_en = '-infinity' WHERE numero = 1$s$,
        '23514', 'H1b: emitido_en = -infinity (UPDATE)');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.recibos (pago_id, numero, emitido_en)
        VALUES (pg_temp.u(1010), 90, '2026-11-06 10:00:00+00')$s$,
        'H1b: emitido_en con un instante válido (INSERT)');
    PERFORM pg_temp.positiva($s$
        UPDATE public.recibos SET emitido_en = '2026-11-07 10:00:00+00' WHERE numero = 90$s$,
        'H1b: emitido_en con un instante válido (UPDATE)');

    -- H2. Feriados.
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.feriados (fecha, descripcion) VALUES ('2026-12-25', 'Navidad')$s$,
        'H2: feriado nacional');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.feriados (fecha, descripcion) VALUES ('2026-12-25', 'Duplicado')$s$,
        '23505', 'H2: una sola fila por fecha');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.feriados (fecha, descripcion) VALUES ('2026-12-08', '  ')$s$,
        '23514', 'H2: descripción en blanco');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.feriados (fecha, descripcion) VALUES (NULL, 'Sin fecha')$s$,
        '23502', 'H2: la fecha es obligatoria');
    PERFORM pg_temp.afirmar(
        (SELECT pg_catalog.count(*) FROM public.feriados WHERE fecha <> '2026-12-25') = 0,
        'H2: la migración no cargó ningún calendario real');

    PERFORM pg_temp.negativa($s$
        INSERT INTO public.feriados (fecha, descripcion) VALUES ('infinity', 'Infinito')$s$,
        '23514', 'H2b: feriado con fecha infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.feriados (fecha, descripcion) VALUES ('-infinity', 'Menos infinito')$s$,
        '23514', 'H2b: feriado con fecha -infinity');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.feriados (fecha, descripcion) VALUES ('2027-05-25', 'Revolución de Mayo')$s$,
        'H2b: feriado con fecha finita válida');

    -- H3. Envíos de correo.
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_temp.u(5), 'RECORDATORIO_MENSUAL', '2026-11-05')$s$,
        'H3: envío programado');
    PERFORM pg_temp.afirmar(
        (SELECT estado = 'PENDIENTE' AND intentos = 0 AND enviado_en IS NULL
         FROM public.envios_correo WHERE padre_id = pg_temp.u(5)),
        'H3: nace PENDIENTE con cero intentos');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_temp.u(5), 'RECORDATORIO_MENSUAL', '2026-11-05')$s$,
        '23505', 'H3: un solo correo por padre, tipo y fecha');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_temp.u(5), 'AVISO_DEUDA', '2026-11-05'),
               (pg_temp.u(5), 'RECORDATORIO_MENSUAL', '2026-12-05'),
               (pg_temp.u(6), 'RECORDATORIO_MENSUAL', '2026-11-05')$s$,
        'H3: otro tipo, otra fecha u otro padre conviven');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', 'infinity')$s$,
        '23514', 'H3: fecha programada = infinity');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '-infinity')$s$,
        '23514', 'H3: fecha programada = -infinity');
    -- H3b. `enviado_en` finito. Con estado ENVIADO el instante es obligatorio, así que el
    -- único CHECK que falla con infinity es el de isfinite. Los NULL legítimos se conservan.
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, estado, enviado_en)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-12-20', 'ENVIADO', 'infinity')$s$,
        '23514', 'H3b: enviado_en = infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, estado, enviado_en)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-12-20', 'ENVIADO', '-infinity')$s$,
        '23514', 'H3b: enviado_en = -infinity (INSERT)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.envios_correo SET estado = 'ENVIADO', enviado_en = 'infinity'
        WHERE padre_id = pg_temp.u(5) AND tipo = 'AVISO_DEUDA'$s$,
        '23514', 'H3b: enviado_en = infinity (UPDATE)');
    PERFORM pg_temp.negativa($s$
        UPDATE public.envios_correo SET estado = 'ENVIADO', enviado_en = '-infinity'
        WHERE padre_id = pg_temp.u(5) AND tipo = 'AVISO_DEUDA'$s$,
        '23514', 'H3b: enviado_en = -infinity (UPDATE)');
    PERFORM pg_temp.positiva($s$
        UPDATE public.envios_correo SET estado = 'ENVIADO', enviado_en = '2026-11-05 08:00:00-03'
        WHERE padre_id = pg_temp.u(5) AND tipo = 'AVISO_DEUDA'$s$,
        'H3b: enviado_en con un instante válido (UPDATE)');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-12-21')$s$,
        'H3b: un envío pendiente conserva enviado_en NULL');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, estado)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-11-05', 'ENVIADO')$s$,
        '23514', 'H3: ENVIADO sin instante de envío');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, enviado_en)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-11-05', NOW())$s$,
        '23514', 'H3: PENDIENTE con instante de envío');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, estado, enviado_en, intentos)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-11-05', 'ENVIADO', NOW(), 1)$s$,
        'H3: ENVIADO con instante de envío');
    PERFORM pg_temp.positiva($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, estado, intentos, ultimo_error)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-11-06', 'INCIERTO', 1, 'Tiempo de espera agotado'),
               (pg_temp.u(6), 'AVISO_DEUDA', '2026-11-07', 'FALLIDO', 3, 'Buzón lleno')$s$,
        'H3: INCIERTO y FALLIDO conservan el error y no tienen instante de envío');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, intentos)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-11-08', -1)$s$,
        '23514', 'H3: intentos negativos');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, ultimo_error)
        VALUES (pg_temp.u(6), 'AVISO_DEUDA', '2026-11-08', '  ')$s$,
        '23514', 'H3: error en blanco');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_catalog.gen_random_uuid(), 'AVISO_DEUDA', '2026-11-08')$s$,
        '23503', 'H3: padre inexistente');
    PERFORM pg_temp.negativa($s$
        INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada)
        VALUES (pg_temp.u(6), 'NEWSLETTER', '2026-11-08')$s$,
        '22P02', 'H3: tipo fuera del enumerado');
    PERFORM pg_temp.negativa($s$
        DELETE FROM public.perfiles WHERE id = pg_temp.u(6)$s$,
        '23503', 'H3: no se borra un perfil con envíos registrados');
END;
$$;


-- ================================================================
-- I. LÍMITE CONOCIDO: COERCIÓN DE ESCALA DE NUMERIC(12,2)
-- ================================================================
-- PostgreSQL redondea al imponer la escala ANTES de evaluar cualquier CHECK. No
-- existe un CHECK posterior capaz de detectar el valor original; la validación
-- previa al cast es responsabilidad de las futuras escrituras de tarifa y de pago.
-- Esta sección documenta el comportamiento, no lo corrige.
DO $$
DECLARE
    v_nivel_vig INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'NIVEL EPT100 VIGENCIAS');
BEGIN
    PERFORM pg_temp.positiva(pg_catalog.format($s$
        INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde, hasta)
        VALUES (pg_temp.u(421), 'CUOTA', %s, 10.005, '2040-01-01', '2040-01-31'),
               (pg_temp.u(422), 'CUOTA', %s, 10.004, '2040-02-01', '2040-02-28'),
               (pg_temp.u(423), 'CUOTA', %s, 0.001, '2040-03-01', '2040-03-31')$s$,
        v_nivel_vig, v_nivel_vig, v_nivel_vig),
        'I1: entradas con tres decimales se aceptan (no hay rechazo de exceso de escala)');
    PERFORM pg_temp.afirmar(
        (SELECT importe FROM public.tarifas WHERE id = pg_temp.u(421)) = 10.01
        AND (SELECT importe FROM public.tarifas WHERE id = pg_temp.u(422)) = 10.00
        AND (SELECT importe FROM public.tarifas WHERE id = pg_temp.u(423)) = 0.00,
        'I1: se almacenan redondeadas a dos decimales (10.005→10.01, 10.004→10.00, 0.001→0.00)');
    PERFORM pg_temp.negativa(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta)
        VALUES ('CUOTA', %s, 9999999999.995, '2040-04-01', '2040-04-30')$s$, v_nivel_vig),
        '22003', 'I1: el redondeo que excede la capacidad sí falla (9999999999.995 → 10^10)');
    PERFORM pg_temp.positiva(pg_catalog.format($s$
        INSERT INTO public.tarifas (concepto, nivel_id, importe, desde, hasta)
        VALUES ('CUOTA', %s, 9999999999.99, '2040-04-01', '2040-04-30')$s$, v_nivel_vig),
        'I1: el máximo representable 9999999999.99 se acepta');
END;
$$;

-- ================================================================
-- J. COHERENCIA AL FACTURAR: LOS CAMBIOS ACADÉMICOS POSTERIORES SON LEGÍTIMOS
-- ================================================================
-- Contrato de un ítem AISLADO (no de un lote mensual: eso es de EPT-104). La
-- factura es un hecho histórico: conserva alumno, tarifa e importe aunque después
-- cambie el nivel del curso por el camino autorizado real.
DO $$
DECLARE
    v_inicial INTEGER := (SELECT id FROM public.niveles WHERE nombre = 'INICIAL');
    v_filas BIGINT;
BEGIN
    PERFORM pg_temp.afirmar(
        (SELECT i.importe = 50000.00 AND i.alumno_id = pg_temp.u(2) AND i.tarifa_id = pg_temp.u(401)
         FROM public.items_factura i WHERE i.id = pg_temp.u(901)),
        'J1: punto de partida: el ítem 901 factura la cuota de nivel PRIMARIO por 50000.00');

    -- El DIRECTOR cambia el nivel del curso (UPDATE cursos SET nivel_id), con rol
    -- authenticated y JWT, tal como lo hace la pantalla de cursos.
    PERFORM pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', pg_temp.u(1), 'role', 'authenticated')::TEXT, TRUE);
    SET LOCAL ROLE authenticated;
    UPDATE public.cursos SET nivel_id = v_inicial WHERE id = pg_temp.u(101);
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
    PERFORM pg_temp.afirmar(v_filas = 1,
        'J1: el cambio de nivel de un curso con matrícula YA FACTURADA se permite por el camino autorizado');

    PERFORM pg_temp.afirmar(
        (SELECT c.nivel_id = v_inicial FROM public.cursos c WHERE c.id = pg_temp.u(101)),
        'J1: el curso quedó en el nivel nuevo');
    PERFORM pg_temp.afirmar(
        (SELECT i.importe = 50000.00 AND i.alumno_id = pg_temp.u(2) AND i.tarifa_id = pg_temp.u(401)
                AND i.tipo = 'CUOTA' AND i.estado_pago = 'PENDIENTE'
                AND t.nivel_id = (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO')
         FROM public.items_factura i JOIN public.tarifas t ON t.id = i.tarifa_id
         WHERE i.id = pg_temp.u(901)),
        'J1: el ítem conserva alumno, tarifa, importe y el nivel facturado (por la tarifa), distinto del curso vivo');

    -- Las transiciones de pago no se ven afectadas por el cambio académico: el
    -- trigger de integridad no se dispara por estado_pago ni por importe.
    PERFORM pg_temp.positiva($s$
        UPDATE public.items_factura SET estado_pago = 'EN_VERIFICACION' WHERE id = pg_temp.u(901)$s$,
        'J2: el estado de pago del ítem sigue pudiendo cambiar tras el cambio de nivel');

    -- El importe histórico es el almacenado en el ítem, no el precio actual de la tarifa.
    PERFORM pg_temp.positiva($s$
        UPDATE public.tarifas SET importe = 55555.00 WHERE id = pg_temp.u(401)$s$,
        'J3: el importe de una tarifa ya facturada puede corregirse (solo su referencia es inmutable)');
    PERFORM pg_temp.afirmar(
        (SELECT i.importe = 50000.00 AND t.importe = 55555.00
         FROM public.items_factura i JOIN public.tarifas t ON t.id = i.tarifa_id
         WHERE i.id = pg_temp.u(901)),
        'J3: el ítem conserva su importe histórico 50000.00 aunque la tarifa valga ahora 55555.00');

    -- Comportamiento técnico CONSERVADO (decisión 4(a)): el trigger también se dispara
    -- en UPDATE del origen o de la tarifa y contrasta contra los datos vigentes. NO es
    -- un flujo de corrección ni autoriza editar o refacturar facturas emitidas.
    PERFORM pg_temp.negativa($s$
        UPDATE public.items_factura SET tarifa_id = pg_temp.u(401) WHERE id = pg_temp.u(901)$s$,
        'P6803', 'J4: se conserva la validación del trigger en UPDATE de tarifa_id (no autoriza refacturar)');
END;
$$;

SELECT pg_temp.afirmar(TRUE, 'EPT-100: todas las comprobaciones del esquema económico se cumplieron');

ROLLBACK;

