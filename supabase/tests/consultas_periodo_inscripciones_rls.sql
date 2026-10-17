-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Consulta de inscripciones y de facturas y
-- comprobantes por período (EPT-110)
-- ============================================================
-- Ejecutar exclusivamente contra la base local descartable e identificada,
-- después de `supabase db reset`. Todo ocurre en una transacción con ROLLBACK.
--
--   docker cp supabase/tests/consultas_periodo_inscripciones_rls.sql supabase_db_ept110:/tmp/
--   docker exec supabase_db_ept110 psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/consultas_periodo_inscripciones_rls.sql
--
-- Cada comprobación imprime `OK n` o aborta con `FALLO n`. Los actores se
-- simulan con SET ROLE + JWT, igual que PostgREST: las operaciones de
-- aceptación las ejecutan actores reales; el rol administrativo solo prepara datos.
--
--   A. inscripciones: alcance por actor, estados, catálogo inactivo, cambio de nivel;
--   B. facturas por período: bordes de mes y de año, rango inválido, sin doble conteo;
--   C. registro de comprobantes: período de factura frente a fecha de transferencia,
--      pago multifactura con varios archivos, registro saneado;
--   D. comprobantes: el original sigue restringido, sin rutas en las lecturas;
--   E. solo lectura, ACL y superficie.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

CREATE TEMPORARY SEQUENCE ept110_n;

CREATE FUNCTION pg_temp.u(p_n INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_catalog.format('b1100000-0000-4000-8000-%s', pg_catalog.lpad(p_n::TEXT, 12, '0'))::UUID $$;

CREATE FUNCTION pg_temp.afirmar(p_condicion BOOLEAN, p_descripcion TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := pg_catalog.nextval('ept110_n');
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

-- Atajos de las tres consultas, siempre sobre las RPC públicas (lo que ve PostgREST).
CREATE FUNCTION pg_temp.q_insc(p_alumno UUID, p_proyeccion TEXT DEFAULT 'pg_catalog.count(*)')
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT 'SELECT ' || p_proyeccion || '::TEXT FROM public.consultar_inscripciones_alumno('
          || COALESCE('''' || p_alumno || '''::UUID', 'NULL') || ')' $$;
CREATE FUNCTION pg_temp.q_fact(p_alumno UUID, p_desde TEXT, p_hasta TEXT,
                               p_proyeccion TEXT DEFAULT 'pg_catalog.count(*)')
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT 'SELECT ' || p_proyeccion || '::TEXT FROM public.consultar_facturas_periodo('
          || COALESCE('''' || p_alumno || '''::UUID', 'NULL') || ', '
          || COALESCE('''' || p_desde || '''::DATE', 'NULL') || ', '
          || COALESCE('''' || p_hasta || '''::DATE', 'NULL') || ')' $$;
CREATE FUNCTION pg_temp.q_reg(p_alumno UUID, p_criterio TEXT, p_desde TEXT, p_hasta TEXT,
                              p_proyeccion TEXT DEFAULT 'pg_catalog.count(*)')
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT 'SELECT ' || p_proyeccion || '::TEXT FROM public.consultar_registro_comprobantes('
          || COALESCE('''' || p_alumno || '''::UUID', 'NULL') || ', '
          || COALESCE('''' || p_criterio || '''', 'NULL') || ', '
          || COALESCE('''' || p_desde || '''::DATE', 'NULL') || ', '
          || COALESCE('''' || p_hasta || '''::DATE', 'NULL') || ')' $$;

-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
-- 1 DIRECTOR · 2 estudiante A · 3 estudiante B · 4 docente · 5 padre A
-- 6 copadre A · 7 padre C (familia B) · 8 personal · 9 padre bloqueado
-- 12 estudiante A2 (segundo hijo del padre 5, sin inscripciones) · 13 padre sin vínculos
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
        (2, 'ESTUDIANTE', 'Alumna A',    'LEG-EPT110-0002'),
        (3, 'ESTUDIANTE', 'Alumno B',    'LEG-EPT110-0003'),
        (4, 'DOCENTE',    'Docente 1',   'LEG-EPT110-0004'),
        (5, 'PADRE',      'Padre A',     NULL),
        (6, 'PADRE',      'Copadre A',   NULL),
        (7, 'PADRE',      'Padre C',     NULL),
        (8, 'PERSONAL',   'Personal 1',  NULL),
        (9, 'PADRE',      'Padre bloqueado', NULL),
        (12, 'ESTUDIANTE', 'Alumno A2',  'LEG-EPT110-0012'),
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
        'Curso EPT-110', 'A', TRUE);

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
        50000.00, '2025-01-01');

-- Dos grupos de Primario: Fútbol (activo) y Natación (que se cancela y se desactiva).
INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
VALUES (pg_temp.u(201), 'e0000000-0000-4000-8000-000000000101',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Fútbol EPT-110', 20, pg_temp.u(4)),
       (pg_temp.u(202), 'e0000000-0000-4000-8000-000000000102',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Natación EPT-110', 20, pg_temp.u(4));
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
VALUES (1, '17:00', '18:00'), (3, '17:00', '18:00')
ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT pg_temp.u(201), h.id FROM public.horarios h
WHERE h.dia_semana = 1 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00'
ON CONFLICT DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT pg_temp.u(202), h.id FROM public.horarios h
WHERE h.dia_semana = 3 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00'
ON CONFLICT DO NOTHING;

-- Alumna A (hechos):
--   deportes: Fútbol ACTIVA (501) · Natación CANCELADA con grupo luego desactivado (502)
--   comedor ACTIVA (601) · transporte: TR-NORTE CANCELADA (602) y TR-SUR ACTIVA (603)
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id)
VALUES (pg_temp.u(501), pg_temp.u(2), pg_temp.u(201)),
       (pg_temp.u(502), pg_temp.u(2), pg_temp.u(202));
UPDATE public.inscripciones_deportivas SET estado = 'CANCELADA' WHERE id = pg_temp.u(502);
UPDATE public.grupos_deportivos SET activo = FALSE WHERE id = pg_temp.u(202);

INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id)
VALUES (pg_temp.u(601), pg_temp.u(2), 'e0000000-0000-4000-8000-000000000010'),
       (pg_temp.u(602), pg_temp.u(2), 'e0000000-0000-4000-8000-000000000020');
UPDATE public.inscripciones_servicios SET estado = 'CANCELADA' WHERE id = pg_temp.u(602);
INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id)
VALUES (pg_temp.u(603), pg_temp.u(2), 'e0000000-0000-4000-8000-000000000021');
-- Alumno B (otra familia): un comedor activo.
INSERT INTO public.inscripciones_servicios (id, alumno_id, servicio_id)
VALUES (pg_temp.u(611), pg_temp.u(3), 'e0000000-0000-4000-8000-000000000010');

-- Facturas de A en fechas absolutas, para cubrir el cambio de año:
--   N 2025-11 · D 2025-12 · E 2026-01 · F 2026-02. Una de A2 y una de B.
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 (pg_temp.u(801), pg_temp.u(2),  '2025-11-01', '2025-11-10', 50000.00),
 (pg_temp.u(802), pg_temp.u(2),  '2025-12-01', '2025-12-10', 50000.00),
 (pg_temp.u(803), pg_temp.u(2),  '2026-01-01', '2026-01-10', 50000.00),
 (pg_temp.u(804), pg_temp.u(2),  '2026-02-01', '2026-02-10', 50000.00),
 (pg_temp.u(811), pg_temp.u(12), '2025-12-01', '2025-12-10', 50000.00),
 (pg_temp.u(821), pg_temp.u(3),  '2025-12-01', '2025-12-10', 50000.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
VALUES (pg_temp.u(8011), pg_temp.u(801), pg_temp.u(2),  'CUOTA', pg_temp.u(401), pg_temp.u(701), 50000.00),
       (pg_temp.u(8021), pg_temp.u(802), pg_temp.u(2),  'CUOTA', pg_temp.u(401), pg_temp.u(701), 50000.00),
       (pg_temp.u(8031), pg_temp.u(803), pg_temp.u(2),  'CUOTA', pg_temp.u(401), pg_temp.u(701), 50000.00),
       (pg_temp.u(8041), pg_temp.u(804), pg_temp.u(2),  'CUOTA', pg_temp.u(401), pg_temp.u(701), 50000.00),
       (pg_temp.u(8111), pg_temp.u(811), pg_temp.u(12), 'CUOTA', pg_temp.u(401), pg_temp.u(712), 50000.00),
       (pg_temp.u(8211), pg_temp.u(821), pg_temp.u(3),  'CUOTA', pg_temp.u(401), pg_temp.u(702), 50000.00);

-- Pagos:
--   P1 padre 5 · APROBADO · cubre las cuotas de 2025-12 y 2026-01 (multifactura) ·
--      transferencia 2026-01-05 · DOS archivos
--   P2 copadre 6 · PENDIENTE_VERIFICACION · cubre 2026-02 · transferencia 2026-02-01
--      (borde) · UN archivo cargado por el copadre
--   P3 padre 5 · PENDIENTE_VERIFICACION · cubre 2025-11 · SIN datos ni archivo
--   P4 padre 5 · RECHAZADO · cuota de 2025-11 (imputación inactiva) · transferencia
--      2025-12-31 (borde de año) · UN archivo
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en)
VALUES
 (pg_temp.u(1001), pg_temp.u(5), pg_temp.u(2), 100000.00, 100000.00, '2026-01-05', 'OP-110-01',
  'APROBADO', pg_temp.u(1), now());
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion)
VALUES (pg_temp.u(1002), pg_temp.u(6), pg_temp.u(2), 50000.00, 50000.00, '2026-02-01', 'OP-110-02');
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
VALUES (pg_temp.u(1003), pg_temp.u(5), pg_temp.u(2), 50000.00);
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado,
        fecha_transferencia, numero_operacion, estado, verificado_por, verificado_en, motivo_rechazo)
VALUES (pg_temp.u(1004), pg_temp.u(5), pg_temp.u(2), 50000.00, 50000.00, '2025-12-31', 'OP-110-04',
        'RECHAZADO', pg_temp.u(1), now(), 'Comprobante ilegible');

INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa) VALUES
 (pg_temp.u(1001), pg_temp.u(8021), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1001), pg_temp.u(8031), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1002), pg_temp.u(8041), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1003), pg_temp.u(8011), pg_temp.u(2), 50000.00, TRUE),
 (pg_temp.u(1004), pg_temp.u(8011), pg_temp.u(2), 50000.00, FALSE);
UPDATE public.items_factura SET estado_pago = 'PAGADO'
WHERE id IN (pg_temp.u(8021), pg_temp.u(8031));
UPDATE public.items_factura SET estado_pago = 'EN_VERIFICACION'
WHERE id IN (pg_temp.u(8041), pg_temp.u(8011));

INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes, creado_en)
VALUES
 (pg_temp.u(2001), pg_temp.u(1001), pg_temp.u(5),
  pg_temp.u(1001)::TEXT || '/' || pg_temp.u(2001)::TEXT || '.pdf', 'application/pdf', 1000, '2026-01-06 12:00+00'),
 (pg_temp.u(2002), pg_temp.u(1001), pg_temp.u(5),
  pg_temp.u(1001)::TEXT || '/' || pg_temp.u(2002)::TEXT || '.png', 'image/png', 2000, '2026-01-07 12:00+00'),
 (pg_temp.u(2003), pg_temp.u(1002), pg_temp.u(6),
  pg_temp.u(1002)::TEXT || '/' || pg_temp.u(2003)::TEXT || '.jpg', 'image/jpeg', 3000, '2026-02-02 12:00+00'),
 (pg_temp.u(2004), pg_temp.u(1004), pg_temp.u(5),
  pg_temp.u(1004)::TEXT || '/' || pg_temp.u(2004)::TEXT || '.jpg', 'image/jpeg', 4000, '2026-01-02 12:00+00');

UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(9);

-- Huella económica previa: las consultas no pueden modificarla.
CREATE TEMPORARY TABLE huella_previa AS
SELECT (SELECT pg_catalog.count(*) FROM public.pagos) AS pagos,
       (SELECT pg_catalog.count(*) FROM public.imputaciones_pago) AS imputaciones,
       (SELECT pg_catalog.count(*) FROM public.comprobantes_pago) AS comprobantes,
       (SELECT pg_catalog.count(*) FROM public.items_factura) AS items,
       (SELECT pg_catalog.count(*) FROM public.facturas) AS facturas,
       (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas) AS deportivas,
       (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios) AS servicios,
       (SELECT pg_catalog.sum(total) FROM public.facturas) AS suma_facturas,
       (SELECT pg_catalog.sum(total_calculado) FROM public.pagos) AS suma_pagos;

-- ================================================================
-- A. INSCRIPCIONES
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '5',
    'A1: el padre ve las 5 inscripciones existentes de su hijo (activas y canceladas)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2),
        'pg_catalog.string_agg(categoria || '':'' || estado, '','' ORDER BY categoria, estado)'))
    = 'COMEDOR:ACTIVA,DEPORTE:ACTIVA,DEPORTE:CANCELADA,TRANSPORTE:ACTIVA,TRANSPORTE:CANCELADA',
    'A2: deportes, comedor y transporte con su estado real, sin ocultar las canceladas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2),
        'pg_catalog.string_agg(nombre, '','' ORDER BY nombre) FILTER (WHERE estado = ''ACTIVA'')'))
    = 'Comedor escolar,Fútbol,Recorrido Sur (ficticio)',
    'A3: el nombre es el del catálogo (deporte, recorrido, comedor)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2),
        'pg_catalog.string_agg(grupo, '','') FILTER (WHERE categoria = ''DEPORTE'' AND estado = ''ACTIVA'')'))
    = 'Fútbol EPT-110',
    'A4: el deporte informa su grupo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2),
        'pg_catalog.bool_and(NOT catalogo_activo)') ) = 'false'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2),
        'pg_catalog.string_agg(nombre, '','') FILTER (WHERE NOT catalogo_activo)')) = 'Natación',
    'A5: un grupo desactivado no oculta su inscripción: se marca como catálogo inactivo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '5'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '5',
    'A6: el copadre vinculado y el propio estudiante ven las mismas 5 inscripciones');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(12))) = '0',
    'A7: un hijo vinculado sin inscripciones devuelve una lista vacía, sin error');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(3))) = '0'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '0'
    AND pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '0'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q_insc(pg_temp.u(3))) = '0'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q_insc(pg_temp.u(12))) = '0',
    'A8: un alumno de otra familia o de otro estudiante devuelve cero filas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        pg_temp.q_insc('b1100000-0000-4000-8000-00000000ffff'::UUID)) = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(NULL)) = '0',
    'A9: un identificador inexistente o nulo es indistinguible de uno ajeno (cero filas)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(9), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '0'
    AND pg_temp.como(pg_temp.u(13), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '0'
    AND pg_temp.como(pg_temp.u(8), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '0'
    AND pg_temp.como(pg_temp.u(4), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '0',
    'A10: cuenta bloqueada, padre sin vínculos, PERSONAL y DOCENTE no ven nada');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(1), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '5',
    'A11: DIRECTOR conserva su lectura');
SELECT pg_temp.afirmar(
    pg_temp.como(NULL, 'anon', pg_temp.q_insc(pg_temp.u(2))) = 'E42501',
    'A12: anon no puede ejecutar la consulta (42501)');
-- La RLS de las tablas NO se abrió: el padre sigue sin leerlas directamente.
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones_servicios') = '0'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones_deportivas') = '0',
    'A13: la lectura parental se hace solo por la RPC; las tablas siguen cerradas para el padre');
-- Cambio de nivel del alumno: pasa a Secundario y su inscripción a un grupo de Primario
-- sigue visible, con el nivel del grupo y no con el nivel actual del alumno.
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u(102), (SELECT id FROM public.niveles WHERE nombre = 'SECUNDARIO'),
        'Curso EPT-110 Sec', 'A', TRUE);
UPDATE public.matriculas SET curso_id = pg_temp.u(102) WHERE id = pg_temp.u(701);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2),
        'pg_catalog.string_agg(nivel, '','') FILTER (WHERE categoria = ''DEPORTE'' AND estado = ''ACTIVA'')'))
    = 'PRIMARIO'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '5',
    'A14: un cambio de nivel del alumno no oculta sus inscripciones; el grupo conserva su nivel');
-- Estudiante bloqueado: ya no consulta ni lo propio (la guarda exige cuenta habilitada).
UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u(3);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.q_insc(pg_temp.u(3))) = '0'
    AND pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.q_fact(pg_temp.u(3), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(3), 'authenticated',
        pg_temp.q_reg(pg_temp.u(3), 'PERIODO_FACTURA', '2025-01-01', '2026-12-31')) = '0',
    'A15b: un estudiante bloqueado no consulta ni inscripciones, ni facturas ni comprobantes propios');
UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = pg_temp.u(3);
-- Revocación del vínculo.
DELETE FROM public.padres_hijos WHERE padre_id = pg_temp.u(6) AND hijo_id = pg_temp.u(2);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.q_insc(pg_temp.u(2))) = '0',
    'A15: el vínculo revocado corta la lectura de inmediato');
-- Rol perdido: el estudiante deja de serlo.
UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
WHERE id = pg_temp.u(3);
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(3), 'authenticated', pg_temp.q_insc(pg_temp.u(3))) = '0',
    'A16: quien perdió el rol ESTUDIANTE no consulta ni lo propio');
UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE')
WHERE id = pg_temp.u(3);
INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES (pg_temp.u(6), pg_temp.u(2));

-- ================================================================
-- B. FACTURAS POR PERÍODO
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-11-01', '2026-02-28')) = '4'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(12), '2025-11-01', '2026-02-28')) = '1',
    'B1: cada hijo devuelve solo sus facturas (4 y 1), sin mezclar');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-15', '2026-01-02',
        'pg_catalog.string_agg(periodo::TEXT, '','' ORDER BY periodo)'))
    = '2025-12-01,2026-01-01',
    'B2: el filtro es por mes calendario: 15/12 incluye el período de diciembre y 02/01 el de enero');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-01', '2025-12-31')) = '1'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-31', '2026-01-01')) = '2'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2026-02-01', '2026-02-01')) = '1'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2026-03-01', '2026-12-31')) = '0',
    'B3: bordes inclusivos de mes y de año; un rango sin períodos devuelve cero filas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-01', '2026-01-31',
        'pg_catalog.string_agg(cantidad_pagos || ''/'' || cantidad_archivos, '','' ORDER BY periodo)'))
    = '1/2,1/2',
    'B4: el pago multifactura con dos archivos figura en cada factura sin multiplicar sus archivos');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-01', '2026-01-31',
        'pg_catalog.sum(total_centavos)')) = '10000000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-01', '2026-01-31',
        'pg_catalog.sum(pagado_centavos)')) = '10000000'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-01', '2026-01-31',
        'pg_catalog.sum(saldo_centavos)')) = '0',
    'B5: totales, pagado y saldo coinciden con la contabilidad existente (sin duplicar por pagos ni archivos)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-11-01', '2025-11-30',
        'pg_catalog.string_agg(cantidad_pagos || ''/'' || cantidad_archivos, '','')')) = '2/1',
    'B6: una factura relaciona todos sus pagos (pendiente y rechazado) y sus archivos');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2026-01-31', '2025-12-01')) = 'EP6871'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), NULL, '2025-12-01')) = 'EP6870'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-12-01', NULL)) = 'EP6870'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.consultar_facturas_periodo(''' || pg_temp.u(2)
        || '''::UUID, ''infinity''::DATE, ''2026-01-01''::DATE)') = 'EP6870',
    'B7: rango invertido (P6871), fechas ausentes o infinitas (P6870)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.consultar_facturas_periodo(''' || pg_temp.u(2)
        || '''::UUID, ''2026-02-30''::DATE, ''2026-03-01''::DATE)') = 'E22008',
    'B8: una fecha civil inexistente (30/02) se rechaza como fecha inválida');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_fact(pg_temp.u(3), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q_fact(pg_temp.u(3), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = '4'
    AND pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = '4',
    'B9: alumno ajeno → cero filas; el estudiante y el copadre ven las 4 facturas de A');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(9), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(13), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(8), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(4), 'authenticated', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = '0'
    AND pg_temp.como(NULL, 'anon', pg_temp.q_fact(pg_temp.u(2), '2025-01-01', '2026-12-31')) = 'E42501',
    'B10: bloqueado, sin vínculos, PERSONAL y DOCENTE → nada; anon → 42501');

-- ================================================================
-- C. REGISTRO DE COMPROBANTES
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'PERIODO_FACTURA',
        '2025-12-01', '2026-01-31', 'pg_catalog.string_agg(pago_id || '':'' || cantidad_archivos, '','')'))
    = pg_temp.u(1001)::TEXT || ':2',
    'C1: un pago multifactura aparece UNA vez con sus dos archivos al buscar por período de factura');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'PERIODO_FACTURA',
        '2025-12-01', '2025-12-31', 'pg_catalog.array_to_string(periodos, '','')'))
    = '2025-12-01,2026-01-01',
    'C2: los períodos del pago listan TODAS sus facturas aunque el filtro sea más estrecho');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2025-12-01', '2025-12-31', 'pg_catalog.string_agg(pago_id::TEXT, '','')'))
    = pg_temp.u(1004)::TEXT
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'PERIODO_FACTURA',
        '2025-12-01', '2025-12-31', 'pg_catalog.string_agg(pago_id::TEXT, '','')'))
    = pg_temp.u(1001)::TEXT,
    'C3: período de factura y fecha de transferencia dan resultados distintos para el mismo rango');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2026-02-01', '2026-02-01')) = '1'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2026-01-05', '2026-01-05')) = '1'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2026-01-06', '2026-02-28')) = '1'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2026-01-06', '2026-01-31')) = '0',
    'C4: la fecha de transferencia tiene extremos inclusivos (desde = hasta incluido)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '3'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31', 'pg_catalog.bool_or(pago_id = ''' || pg_temp.u(1003) || ''')')) = 'false',
    'C5: un pago sin fecha de transferencia informada no entra por fecha (no se sustituye por otra)');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'PERIODO_FACTURA',
        '2025-11-01', '2025-11-30', 'pg_catalog.string_agg(estado || '':'' || cantidad_archivos, '','' ORDER BY estado)'))
    = 'PENDIENTE_VERIFICACION:0,RECHAZADO:1',
    'C6: un pago aún sin archivo figura con cero archivos; el rechazado conserva el suyo');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'PERIODO_FACTURA',
        '2026-02-01', '2026-02-28', 'pg_catalog.string_agg(cantidad_archivos || '':'' || importe_informado_centavos, '','')'))
    = '1:5000000',
    'C7: el padre ve el registro saneado de un pago cargado por el copadre, con importe en centavos');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '3'
    AND pg_temp.como(pg_temp.u(6), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '3'
    AND pg_temp.como(pg_temp.u(1), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '3',
    'C8: estudiante, copadre y DIRECTOR reciben el mismo registro saneado');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(3), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(7), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(2), 'authenticated', pg_temp.q_reg(pg_temp.u(3), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(9), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(13), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(8), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '0'
    AND pg_temp.como(pg_temp.u(4), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA',
        '2000-01-01', '2100-12-31')) = '0',
    'C9: alumno ajeno, bloqueado, sin vínculos, PERSONAL y DOCENTE → cero filas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'OTRO', '2025-01-01', '2026-01-01')) = 'EP6870'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), NULL, '2025-01-01', '2026-01-01')) = 'EP6870'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA', '2026-02-01', '2026-01-01')) = 'EP6871'
    AND pg_temp.como(pg_temp.u(5), 'authenticated', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA', NULL, '2026-01-01')) = 'EP6870'
    AND pg_temp.como(NULL, 'anon', pg_temp.q_reg(pg_temp.u(2), 'FECHA_TRANSFERENCIA', '2026-01-01', '2026-02-01')) = 'E42501',
    'C10: criterio desconocido o ausente, rango invertido o incompleto y anon se rechazan');

-- ================================================================
-- D. EL ORIGINAL SIGUE RESTRINGIDO
-- ================================================================
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.comprobantes_pago') = '3'
    AND pg_temp.como(pg_temp.u(6), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.comprobantes_pago') = '1'
    AND pg_temp.como(pg_temp.u(2), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.comprobantes_pago') = '0'
    AND pg_temp.como(pg_temp.u(1), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.comprobantes_pago WHERE id::TEXT LIKE ''b1100000-%''') = '4',
    'D1: cada padre lee solo los archivos que cargó, el estudiante ninguno y DIRECTOR todos');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.comprobantes_pago WHERE pago_id = '''
        || pg_temp.u(1002) || '''') = '0'
    AND pg_temp.como(pg_temp.u(6), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.comprobantes_pago WHERE pago_id = '''
        || pg_temp.u(1001) || '''') = '0',
    'D2: el original del otro padre vinculado no se lee por llamada directa, ni en un sentido ni en el otro');
SELECT pg_temp.afirmar(
    NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.unnest(
            COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS a(nombre)
        WHERE p.pronamespace IN ('public'::REGNAMESPACE, 'app_private'::REGNAMESPACE)
          AND p.proname IN ('consultar_inscripciones_alumno', 'consultar_facturas_periodo',
                            'consultar_registro_comprobantes')
          AND a.nombre ~* '(ruta|path|archivo_|mime|tipo_mime|tamano|subido|cargador|storage|url|operacion)'),
    'D3: ninguna consulta nueva declara rutas, tipo, tamaño, cargador ni número de operación');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(2), 'authenticated',
        'SELECT pg_catalog.count(*)::TEXT FROM public.resumen_comprobantes_pago('''
        || pg_temp.u(1001) || ''')') = '1',
    'D4: el registro saneado existente (EPT-101) sigue disponible sin cambios para el estudiante');

-- ================================================================
-- E. SOLO LECTURA, ACL Y SUPERFICIE
-- ================================================================
SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
     WHERE p.pronamespace IN ('public'::REGNAMESPACE, 'app_private'::REGNAMESPACE)
       AND p.proname IN ('consultar_inscripciones_alumno', 'consultar_facturas_periodo',
                         'consultar_registro_comprobantes', 'validar_rango_fechas')
       AND p.provolatile IN ('s', 'i')) = 7,
    'E1: las siete funciones nuevas (3 públicas, 3 privadas, 1 de validación) son STABLE/IMMUTABLE');
SELECT pg_temp.afirmar(
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
     WHERE p.pronamespace = 'public'::REGNAMESPACE
       AND p.proname IN ('consultar_inscripciones_alumno', 'consultar_facturas_periodo',
                         'consultar_registro_comprobantes')
       AND NOT p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']) = 3
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'app_private'::REGNAMESPACE
           AND p.proname IN ('consultar_inscripciones_alumno', 'consultar_facturas_periodo',
                             'consultar_registro_comprobantes')
           AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) = 3,
    'E2: envoltorios públicos SECURITY INVOKER y auxiliares DEFINER, todos con search_path vacío');
SELECT pg_temp.afirmar(
    NOT pg_catalog.has_function_privilege('anon',
        'public.consultar_inscripciones_alumno(uuid)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon',
        'public.consultar_facturas_periodo(uuid,date,date)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon',
        'public.consultar_registro_comprobantes(uuid,text,date,date)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role',
        'public.consultar_registro_comprobantes(uuid,text,date,date)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon',
        'app_private.consultar_registro_comprobantes(uuid,text,date,date)', 'EXECUTE'),
    'E3: anon y service_role no reciben EXECUTE sobre las consultas');
SELECT pg_temp.afirmar(
    pg_temp.como(pg_temp.u(5), 'authenticated',
        'INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES ('''
        || pg_temp.u(2) || ''', ''e0000000-0000-4000-8000-000000000022'') RETURNING 1') = 'E42501'
    AND pg_temp.como(pg_temp.u(5), 'authenticated',
        'UPDATE public.inscripciones_deportivas SET estado = ''CANCELADA'' RETURNING 1') = 'E42501'
    AND pg_temp.como(pg_temp.u(2), 'authenticated',
        'DELETE FROM public.inscripciones_servicios RETURNING 1') = 'E42501'
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.inscripciones_servicios', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.inscripciones_deportivas', 'UPDATE'),
    'E4: no hay alta, modificación ni cancelación de inscripciones por escritura directa');
SELECT pg_temp.afirmar(
    (SELECT h.pagos FROM huella_previa h) = (SELECT pg_catalog.count(*) FROM public.pagos)
    AND (SELECT h.imputaciones FROM huella_previa h) = (SELECT pg_catalog.count(*) FROM public.imputaciones_pago)
    AND (SELECT h.comprobantes FROM huella_previa h) = (SELECT pg_catalog.count(*) FROM public.comprobantes_pago)
    AND (SELECT h.items FROM huella_previa h) = (SELECT pg_catalog.count(*) FROM public.items_factura)
    AND (SELECT h.facturas FROM huella_previa h) = (SELECT pg_catalog.count(*) FROM public.facturas)
    AND (SELECT h.deportivas FROM huella_previa h) = (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas)
    AND (SELECT h.servicios FROM huella_previa h) = (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios)
    AND (SELECT h.suma_facturas FROM huella_previa h) = (SELECT pg_catalog.sum(total) FROM public.facturas)
    AND (SELECT h.suma_pagos FROM huella_previa h) = (SELECT pg_catalog.sum(total_calculado) FROM public.pagos),
    'E5: las consultas no alteraron facturas, pagos, imputaciones, comprobantes ni inscripciones');

ROLLBACK;
