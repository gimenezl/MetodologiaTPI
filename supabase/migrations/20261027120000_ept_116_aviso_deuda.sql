-- ================================================================
-- EPT-116 — Aviso de deuda del día 20 (P3-T29, RF16)
-- ================================================================
-- Forward. No edita migraciones integradas. No activa nada: la compuerta
-- `app_private.aviso_deuda_config.habilitada` nace en FALSE y es independiente de la del
-- recordatorio mensual (EPT-115): ninguna ejecución de un evento consume, duplica o altera
-- las filas del otro (el aviso solo toca `tipo = 'AVISO_DEUDA'`).
--
-- IDENTIDAD DEL EVENTO
--   (padre_id, tipo = AVISO_DEUDA, fecha_programada = día 20 ORIGINAL del mes M). Un reintento
--   del 21, 25 o 31 conserva esa identidad. `periodo` guarda el primer día de M y solo sirve
--   para calcular la ventana de reintentos. El mes siguiente es otro evento.
--
-- PRIMER EVENTO FRENTE A REINTENTOS
--   Las filas del evento se programan SOLO cuando la fecha civil argentina es el día 20
--   (día CALENDARIO: sábado, domingo o feriado incluidos; sin `ultimo_habil`). No hay
--   catch-up: si nadie ejecuta el día 20 no nace el evento. Después, una fila PENDIENTE o
--   FALLIDA se retoma una vez por día hasta el último día de M inclusive. INCIERTO no se
--   reintenta. El día 1 de M+1 un evento vencido ya no se retoma.
--
-- DEUDA (fuente única: `app_private.aviso_deuda_composicion`)
--   saldo del ítem = importe histórico − Σ imputaciones ACTIVAS de pagos APROBADOS
--   (EPT-107/EPT-114). EN_VERIFICACION conserva su deuda (se informa aparte para no inducir
--   un pago duplicado). RECHAZADO e imputaciones inactivas no reducen saldo. El importe
--   informado de un pago nunca cancela deuda. Universo: facturas de TODOS los períodos de
--   los hijos ACTIVOS vinculados al padre cuyo saldo neto (Σ saldos de sus ítems) es > 0,
--   con o sin pagos. Fecha de corte: la fecha civil argentina del intento. Una factura
--   inconsistente (suma de ítems ≠ total, pagado > total o ítem parcialmente pagado) no se
--   corrige ni se oculta: impide el envío y queda registrada.
--
-- MÁQUINA DE ESTADOS (por fila) — igual que EPT-115, más el cierre por saldo cero
--   PENDIENTE --reservar--> PENDIENTE(token, reserva_hasta)
--   PENDIENTE(token) --frontera--> PENDIENTE(token, frontera_smtp_en)  [cruce]
--   PENDIENTE(token) --resultado--> ENVIADO | FALLIDO | INCIERTO
--   PENDIENTE(token, sin frontera) --omitir--> FALLIDO + omitido_motivo   [saldo cero]
--   PENDIENTE(frontera, reserva vencida) --barrido--> INCIERTO
--   FALLIDO(ultimo_intento_fecha < hoy, sin omitido_motivo, hoy <= fin de M) --reservar--> PENDIENTE
--   Una omisión conserva `ultimo_error` anterior y cada intento queda en
--   `envios_correo_intentos` (historia append-only para Dirección). Solo quien posee el
--   token vigente confirma. Nada garantiza exactly-once entre PostgreSQL y SMTP.
--
-- RELOJ
--   Se reutiliza `app_private.recordatorio_hoy()` (fecha civil argentina; la fila de reloj
--   simulado es solo de pruebas locales, la crea el propietario de la base y no existe en
--   producción).

DO $$
BEGIN
    IF pg_catalog.to_regprocedure('app_private.recordatorio_hoy()') IS NULL
       OR pg_catalog.to_regclass('public.envios_correo_facturas') IS NULL THEN
        RAISE EXCEPTION 'EPT-116: falta la infraestructura de EPT-115.';
    END IF;
END $$;

-- ----------------------------------------------------------------
-- 1. Compuerta propia
-- ----------------------------------------------------------------
CREATE TABLE app_private.aviso_deuda_config (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    habilitada BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO app_private.aviso_deuda_config DEFAULT VALUES;
ALTER TABLE app_private.aviso_deuda_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.aviso_deuda_config FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 2. Columnas del aviso y restricciones
-- ----------------------------------------------------------------
ALTER TABLE public.envios_correo
    ADD COLUMN corte_fecha DATE,
    ADD COLUMN total_adeudado NUMERIC(12,2),
    ADD COLUMN omitido_motivo TEXT;

ALTER TABLE public.envios_correo
    ADD CONSTRAINT envios_correo_corte_finito
        CHECK (corte_fecha IS NULL OR pg_catalog.isfinite(corte_fecha)),
    ADD CONSTRAINT envios_correo_total_adeudado_valido
        CHECK (total_adeudado IS NULL OR (total_adeudado <> 'NaN'::NUMERIC AND total_adeudado >= 0)),
    ADD CONSTRAINT envios_correo_omitido_coherente
        CHECK (omitido_motivo IS NULL
               OR (estado = 'FALLIDO' AND pg_catalog.btrim(omitido_motivo, E' \t\r\n') <> '')),
    -- Un aviso programado por el job (siempre con `periodo`) no se confirma sin haber cruzado la
    -- frontera registrada. Las filas sin `periodo` son de contratos anteriores a EPT-116.
    ADD CONSTRAINT envios_correo_aviso_enviado_cruzo_frontera
        CHECK (tipo <> 'AVISO_DEUDA' OR estado <> 'ENVIADO' OR periodo IS NULL OR frontera_smtp_en IS NOT NULL);

COMMENT ON COLUMN public.envios_correo.corte_fecha IS
    'AVISO_DEUDA: fecha civil argentina del último intento cuya composición se leyó.';
COMMENT ON COLUMN public.envios_correo.total_adeudado IS
    'AVISO_DEUDA: total adeudado de la composición del último intento (incluye lo EN_VERIFICACION).';
COMMENT ON COLUMN public.envios_correo.omitido_motivo IS
    'AVISO_DEUDA: el evento se cerró sin enviar (p. ej. saldo cero en un reintento). Siempre con estado FALLIDO; el último error previo se conserva.';

-- ----------------------------------------------------------------
-- 3. Historia de intentos (append-only; solo Dirección lee)
-- ----------------------------------------------------------------
CREATE TABLE public.envios_correo_intentos (
    envio_id UUID NOT NULL REFERENCES public.envios_correo(id) ON DELETE RESTRICT,
    intento INTEGER NOT NULL CHECK (intento >= 1),
    resultado TEXT NOT NULL CHECK (resultado IN ('ENVIADO', 'FALLIDO', 'INCIERTO', 'OMITIDO')),
    corte_fecha DATE CHECK (corte_fecha IS NULL OR pg_catalog.isfinite(corte_fecha)),
    total_adeudado NUMERIC(12,2) CHECK (total_adeudado IS NULL OR (total_adeudado <> 'NaN'::NUMERIC AND total_adeudado >= 0)),
    detalle TEXT CHECK (detalle IS NULL OR pg_catalog.length(detalle) <= 300),
    registrado_en TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp() CHECK (pg_catalog.isfinite(registrado_en)),
    PRIMARY KEY (envio_id, intento)
);
COMMENT ON TABLE public.envios_correo_intentos IS
    'Resultado de cada intento de un aviso programado, con su fecha de corte y total. Auditoría interna: solo DIRECTOR; la escriben únicamente las funciones definidoras.';

ALTER TABLE public.envios_correo_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.envios_correo_intentos FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "Lectura económica de Dirección" ON public.envios_correo_intentos
    FOR SELECT TO authenticated
    USING ((SELECT app_private.es_director()));
CREATE POLICY "Bloqueo de acceso sin datos protegidos" ON public.envios_correo_intentos
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));
GRANT SELECT ON public.envios_correo_intentos TO authenticated;

-- ----------------------------------------------------------------
-- 4. Composición de la deuda de un padre (una sola consulta, una sola instantánea)
-- ----------------------------------------------------------------
CREATE FUNCTION app_private.aviso_deuda_composicion(p_padre UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH hijos AS (
        SELECT ph.hijo_id
          FROM public.padres_hijos ph
          JOIN public.alumnos a ON a.perfil_id = ph.hijo_id AND a.estado = 'ACTIVO'
         WHERE ph.padre_id = p_padre
    ), pagado AS (
        -- Una fila por ítem, antes de unir catálogos: nada multiplica este importe.
        SELECT ip.item_factura_id, pg_catalog.sum(ip.importe) AS pagado
          FROM public.imputaciones_pago ip
          JOIN public.pagos p ON p.id = ip.pago_id AND p.alumno_id = ip.alumno_id
         WHERE ip.alumno_id IN (SELECT hijo_id FROM hijos) AND ip.activa AND p.estado = 'APROBADO'
         GROUP BY ip.item_factura_id
    ), items AS (
        SELECT i.id AS item_id, i.factura_id, i.alumno_id, i.tipo, i.tarifa_id, i.importe,
               i.estado_pago, COALESCE(pg.pagado, 0) AS pagado,
               f.periodo, f.vencimiento, f.total AS total_factura
          FROM public.items_factura i
          JOIN public.facturas f ON f.id = i.factura_id AND f.alumno_id = i.alumno_id
          LEFT JOIN pagado pg ON pg.item_factura_id = i.id
         WHERE i.alumno_id IN (SELECT hijo_id FROM hijos)
    ), con_factura AS (
        SELECT it.*, (it.importe - it.pagado) AS saldo,
               pg_catalog.sum(it.importe) OVER w AS suma_importes,
               pg_catalog.sum(it.pagado) OVER w AS suma_pagado,
               pg_catalog.sum(it.importe - it.pagado) OVER w AS saldo_factura,
               pg_catalog.bool_or(it.pagado <> 0 AND it.pagado <> it.importe) OVER w AS parcial,
               pg_catalog.bool_or(it.importe - it.pagado > 0) OVER w AS hay_saldo_item
          FROM items it
        WINDOW w AS (PARTITION BY it.factura_id)
    ), marcadas AS (
        SELECT c.*, (c.suma_importes <> c.total_factura OR c.suma_pagado > c.total_factura OR c.parcial)
                    AS inconsistente
          FROM con_factura c
    ), universo AS (
        -- Una factura inconsistente con algún ítem impago entra aunque su saldo neto sea <= 0:
        -- la inconsistencia se declara, no oculta la deuda.
        SELECT m.* FROM marcadas m
         WHERE m.saldo_factura > 0 OR (m.inconsistente AND m.hay_saldo_item)
    ), lineas AS (
        SELECT u.*, h.apellido || ', ' || h.nombre AS alumno,
               COALESCE(d.nombre, sv.nombre, n.nombre, u.tipo::TEXT) AS detalle
          FROM universo u
          JOIN public.perfiles h ON h.id = u.alumno_id
          JOIN public.tarifas t ON t.id = u.tarifa_id
          LEFT JOIN public.deportes d ON d.id = t.deporte_id
          LEFT JOIN public.servicios_escolares sv ON sv.id = t.servicio_id
          LEFT JOIN public.niveles n ON n.id = t.nivel_id
         WHERE u.saldo > 0
    ), por_factura AS (
        SELECT l.alumno_id, l.alumno, l.factura_id, l.periodo, l.vencimiento,
               pg_catalog.sum(l.saldo) AS subtotal,
               COALESCE(pg_catalog.sum(l.saldo) FILTER (WHERE l.estado_pago = 'EN_VERIFICACION'), 0) AS en_verificacion,
               pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'item_id', l.item_id, 'concepto', l.tipo, 'detalle', l.detalle,
                   'pendiente', l.saldo::NUMERIC(12,2)::TEXT,
                   'en_verificacion', (l.estado_pago = 'EN_VERIFICACION'))
                   ORDER BY l.tipo, l.detalle, l.item_id) AS items
          FROM lineas l
         GROUP BY l.alumno_id, l.alumno, l.factura_id, l.periodo, l.vencimiento
    ), por_alumno AS (
        SELECT pf.alumno_id, pf.alumno,
               pg_catalog.sum(pf.subtotal) AS subtotal,
               pg_catalog.sum(pf.en_verificacion) AS en_verificacion,
               pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'factura_id', pf.factura_id, 'periodo', pf.periodo, 'vencimiento', pf.vencimiento,
                   'subtotal', pf.subtotal::NUMERIC(12,2)::TEXT,
                   'en_verificacion', pf.en_verificacion::NUMERIC(12,2)::TEXT,
                   'items', pf.items) ORDER BY pf.periodo, pf.factura_id) AS facturas
          FROM por_factura pf
         GROUP BY pf.alumno_id, pf.alumno
    )
    SELECT pg_catalog.jsonb_build_object(
        'hijos', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'alumno_id', pa.alumno_id, 'alumno', pa.alumno,
                       'subtotal', pa.subtotal::NUMERIC(12,2)::TEXT,
                       'en_verificacion', pa.en_verificacion::NUMERIC(12,2)::TEXT,
                       'facturas', pa.facturas) ORDER BY pa.alumno, pa.alumno_id)
                   FROM por_alumno pa), '[]'::JSONB),
        'total', COALESCE((SELECT pg_catalog.sum(pa.subtotal) FROM por_alumno pa), 0)::NUMERIC(12,2)::TEXT,
        'total_en_verificacion', COALESCE((SELECT pg_catalog.sum(pa.en_verificacion) FROM por_alumno pa), 0)::NUMERIC(12,2)::TEXT,
        'inconsistente', COALESCE((SELECT pg_catalog.bool_or(u.inconsistente) FROM universo u), FALSE));
$$;

-- ----------------------------------------------------------------
-- 5. Plan: barrido, programación del evento y candidatos
-- ----------------------------------------------------------------
CREATE FUNCTION app_private.aviso_deuda_plan() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_hoy DATE := app_private.recordatorio_hoy();
    v_mes DATE := pg_catalog.date_trunc('month', v_hoy)::DATE;
    v_candidatos JSONB;
BEGIN
    IF NOT (SELECT habilitada FROM app_private.aviso_deuda_config WHERE id) THEN
        RETURN pg_catalog.jsonb_build_object('habilitada', FALSE, 'candidatos', '[]'::JSONB);
    END IF;

    -- Reserva vencida tras cruzar la frontera: posible aceptación sin resultado.
    WITH barrido AS (
        UPDATE public.envios_correo
           SET estado = 'INCIERTO',
               ultimo_error = 'Posible aceptación SMTP sin resultado confirmado; requiere revisión de Dirección.',
               reserva_token = NULL, reserva_hasta = NULL
         WHERE tipo = 'AVISO_DEUDA' AND estado = 'PENDIENTE'
           AND frontera_smtp_en IS NOT NULL AND reserva_hasta < pg_catalog.clock_timestamp()
        RETURNING id, intentos, corte_fecha, total_adeudado, ultimo_error)
    INSERT INTO public.envios_correo_intentos(envio_id, intento, resultado, corte_fecha, total_adeudado, detalle)
    SELECT b.id, b.intentos, 'INCIERTO', b.corte_fecha, b.total_adeudado, b.ultimo_error FROM barrido b
    ON CONFLICT (envio_id, intento) DO NOTHING;

    -- Venció la ventana (último día del mes inclusive) sin enviarse y sin cruzar la frontera.
    WITH barrido AS (
        UPDATE public.envios_correo
           SET estado = 'FALLIDO',
               ultimo_error = pg_catalog.left('Venció el plazo del último día del mes sin poder enviarse.'
                   || COALESCE(' Último error: ' || ultimo_error, ''), 300),
               reserva_token = NULL, reserva_hasta = NULL
         WHERE tipo = 'AVISO_DEUDA' AND estado = 'PENDIENTE' AND periodo IS NOT NULL
           AND frontera_smtp_en IS NULL AND v_hoy > (periodo + INTERVAL '1 month')::DATE - 1
           AND (reserva_hasta IS NULL OR reserva_hasta < pg_catalog.clock_timestamp())
        RETURNING id, intentos, corte_fecha, total_adeudado, ultimo_error)
    INSERT INTO public.envios_correo_intentos(envio_id, intento, resultado, corte_fecha, total_adeudado, detalle)
    SELECT b.id, GREATEST(b.intentos, 1), 'FALLIDO', b.corte_fecha, b.total_adeudado, b.ultimo_error FROM barrido b
    ON CONFLICT (envio_id, intento) DO NOTHING;

    -- Primer evento: solo el día 20 (día calendario). Progreso durable de todo el lote.
    IF pg_catalog.date_part('day', v_hoy) = 20 THEN
        INSERT INTO public.envios_correo(padre_id, tipo, fecha_programada, periodo)
        SELECT p.padre_id, 'AVISO_DEUDA'::public.tipo_envio_correo, v_hoy, v_mes
          FROM (
            SELECT DISTINCT ph.padre_id
              FROM public.padres_hijos ph
              JOIN public.perfiles pe ON pe.id = ph.padre_id AND pe.estado_acceso = 'HABILITADO'
              JOIN public.roles r ON r.id = pe.rol_id AND r.nombre = 'PADRE'
              JOIN public.alumnos a ON a.perfil_id = ph.hijo_id AND a.estado = 'ACTIVO') p
         CROSS JOIN LATERAL (SELECT app_private.aviso_deuda_composicion(p.padre_id) AS c) x
         WHERE (x.c ->> 'total')::NUMERIC > 0 OR (x.c ->> 'inconsistente')::BOOLEAN
        ON CONFLICT (padre_id, tipo, fecha_programada) DO NOTHING;
    END IF;

    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'padre_id', q.padre_id, 'fecha_programada', q.fecha_programada)), '[]'::JSONB)
      INTO v_candidatos
      FROM (
        SELECT e.padre_id, e.fecha_programada
          FROM public.envios_correo e
         WHERE e.tipo = 'AVISO_DEUDA' AND e.periodo IS NOT NULL
           AND e.omitido_motivo IS NULL
           AND v_hoy <= (e.periodo + INTERVAL '1 month')::DATE - 1
           AND ((e.estado = 'PENDIENTE' AND (e.reserva_hasta IS NULL
                   OR (e.reserva_hasta < pg_catalog.clock_timestamp() AND e.frontera_smtp_en IS NULL)))
             OR (e.estado = 'FALLIDO' AND e.ultimo_intento_fecha < v_hoy))
         ORDER BY e.ultimo_intento_fecha NULLS FIRST, e.intentos, e.padre_id
         LIMIT 200
      ) q;
    RETURN pg_catalog.jsonb_build_object('habilitada', TRUE, 'hoy', v_hoy, 'candidatos', v_candidatos);
END $$;

-- ----------------------------------------------------------------
-- 6. Reserva con propiedad del intento
-- ----------------------------------------------------------------
CREATE FUNCTION app_private.aviso_deuda_reservar(p_padre UUID, p_fecha DATE) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_hoy DATE := app_private.recordatorio_hoy();
    v_e public.envios_correo;
    v_token UUID := pg_catalog.gen_random_uuid();
BEGIN
    IF NOT (SELECT habilitada FROM app_private.aviso_deuda_config WHERE id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6861', MESSAGE = 'El aviso de deuda está deshabilitado.';
    END IF;
    SELECT * INTO v_e FROM public.envios_correo
     WHERE padre_id = p_padre AND tipo = 'AVISO_DEUDA' AND fecha_programada = p_fecha FOR UPDATE;
    IF NOT FOUND OR v_e.periodo IS NULL OR v_e.omitido_motivo IS NOT NULL
       OR v_hoy > (v_e.periodo + INTERVAL '1 month')::DATE - 1 THEN
        RETURN pg_catalog.jsonb_build_object('reservado', FALSE, 'motivo', 'fuera_de_plan');
    END IF;
    IF NOT ((v_e.estado = 'PENDIENTE' AND (v_e.reserva_hasta IS NULL
               OR (v_e.reserva_hasta < pg_catalog.clock_timestamp() AND v_e.frontera_smtp_en IS NULL)))
         OR (v_e.estado = 'FALLIDO' AND v_e.ultimo_intento_fecha < v_hoy)) THEN
        RETURN pg_catalog.jsonb_build_object('reservado', FALSE, 'motivo', 'no_disponible', 'estado', v_e.estado);
    END IF;
    UPDATE public.envios_correo
       SET estado = 'PENDIENTE', reserva_token = v_token,
           reserva_hasta = pg_catalog.clock_timestamp() + INTERVAL '120 seconds',
           frontera_smtp_en = NULL, intentos = intentos + 1, ultimo_intento_fecha = v_hoy
     WHERE id = v_e.id;
    RETURN pg_catalog.jsonb_build_object('reservado', TRUE, 'token', v_token, 'intento', v_e.intentos + 1);
END $$;

-- ----------------------------------------------------------------
-- 7. Datos del destinatario revalidados bajo la reserva
-- ----------------------------------------------------------------
-- Corte de lectura: la composición se calcula aquí, en una sola consulta; el cuerpo y el total
-- salen de ese mismo conjunto. Un pago aprobado después de esta lectura no cancela un correo
-- cuya frontera SMTP se cruce a continuación.
CREATE FUNCTION app_private.aviso_deuda_datos(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_hoy DATE := app_private.recordatorio_hoy();
    v_e public.envios_correo;
    v_padre RECORD;
    v_c JSONB;
BEGIN
    SELECT * INTO v_e FROM public.envios_correo
     WHERE padre_id = p_padre AND tipo = 'AVISO_DEUDA' AND fecha_programada = p_fecha FOR UPDATE;
    IF NOT FOUND OR v_e.reserva_token IS DISTINCT FROM p_token OR v_e.estado <> 'PENDIENTE'
       OR v_e.frontera_smtp_en IS NOT NULL OR v_e.reserva_hasta < pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION USING ERRCODE = 'P6862', MESSAGE = 'La reserva del envío no está vigente.';
    END IF;

    SELECT p.user_id, p.nombre, p.apellido INTO v_padre
      FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
     WHERE p.id = p_padre AND r.nombre = 'PADRE' AND p.estado_acceso = 'HABILITADO';
    IF NOT FOUND OR v_padre.user_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('impedimento', 'La cuenta del destinatario no está habilitada como padre.');
    END IF;

    v_c := app_private.aviso_deuda_composicion(p_padre);
    UPDATE public.envios_correo
       SET corte_fecha = v_hoy, total_adeudado = (v_c ->> 'total')::NUMERIC
     WHERE id = v_e.id;
    IF (v_c ->> 'inconsistente')::BOOLEAN THEN
        RETURN pg_catalog.jsonb_build_object('impedimento',
            'Una factura con saldo tiene un historial económico inconsistente; requiere revisión de Dirección.');
    END IF;

    IF (v_c ->> 'total')::NUMERIC = 0 THEN
        RETURN pg_catalog.jsonb_build_object('saldo_cero', TRUE, 'corte', v_hoy);
    END IF;
    RETURN v_c || pg_catalog.jsonb_build_object(
        'user_id', v_padre.user_id, 'padre', v_padre.apellido || ', ' || v_padre.nombre,
        'corte', v_hoy, 'fecha_programada', v_e.fecha_programada);
END $$;

-- ----------------------------------------------------------------
-- 8. Frontera, resultado, omisión y estado
-- ----------------------------------------------------------------
CREATE FUNCTION app_private.aviso_deuda_frontera(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n INTEGER;
BEGIN
    UPDATE public.envios_correo
       SET frontera_smtp_en = pg_catalog.clock_timestamp(),
           reserva_hasta = pg_catalog.clock_timestamp() + INTERVAL '120 seconds'
     WHERE padre_id = p_padre AND tipo = 'AVISO_DEUDA' AND fecha_programada = p_fecha
       AND reserva_token = p_token AND estado = 'PENDIENTE'
       AND reserva_hasta >= pg_catalog.clock_timestamp() AND frontera_smtp_en IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n = 1;
END $$;

CREATE FUNCTION app_private.aviso_deuda_resultado(p_padre UUID, p_fecha DATE, p_token UUID,
    p_estado TEXT, p_error TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fila RECORD;
BEGIN
    IF p_estado NOT IN ('ENVIADO', 'FALLIDO', 'INCIERTO') THEN
        RAISE EXCEPTION USING ERRCODE = 'P6863', MESSAGE = 'Resultado de envío inválido.';
    END IF;
    UPDATE public.envios_correo
       SET estado = p_estado::public.estado_envio_correo,
           enviado_en = CASE WHEN p_estado = 'ENVIADO' THEN pg_catalog.clock_timestamp() END,
           ultimo_error = CASE WHEN p_estado = 'ENVIADO' THEN NULL
                               ELSE COALESCE(NULLIF(pg_catalog.left(pg_catalog.btrim(p_error, E' \t\r\n'), 300), ''), 'Error sin detalle.') END,
           reserva_token = NULL, reserva_hasta = NULL
     WHERE padre_id = p_padre AND tipo = 'AVISO_DEUDA' AND fecha_programada = p_fecha
       AND reserva_token = p_token AND estado = 'PENDIENTE'
       AND (p_estado = 'FALLIDO' OR frontera_smtp_en IS NOT NULL)
    RETURNING id, intentos, corte_fecha, total_adeudado, ultimo_error INTO v_fila;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    INSERT INTO public.envios_correo_intentos(envio_id, intento, resultado, corte_fecha, total_adeudado, detalle)
    VALUES (v_fila.id, v_fila.intentos, p_estado, v_fila.corte_fecha, v_fila.total_adeudado, v_fila.ultimo_error)
    ON CONFLICT (envio_id, intento) DO NOTHING;
    RETURN TRUE;
END $$;

-- Cierra el evento sin enviar (saldo cero al revalidar). Solo con la reserva vigente y antes de la frontera.
CREATE FUNCTION app_private.aviso_deuda_omitir(p_padre UUID, p_fecha DATE, p_token UUID, p_motivo TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fila RECORD;
BEGIN
    UPDATE public.envios_correo
       SET estado = 'FALLIDO',
           omitido_motivo = COALESCE(NULLIF(pg_catalog.left(pg_catalog.btrim(p_motivo, E' \t\r\n'), 300), ''), 'Omitido sin detalle.'),
           reserva_token = NULL, reserva_hasta = NULL
     WHERE padre_id = p_padre AND tipo = 'AVISO_DEUDA' AND fecha_programada = p_fecha
       AND reserva_token = p_token AND estado = 'PENDIENTE' AND frontera_smtp_en IS NULL
       AND reserva_hasta >= pg_catalog.clock_timestamp()
    RETURNING id, intentos, corte_fecha, total_adeudado, omitido_motivo INTO v_fila;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    INSERT INTO public.envios_correo_intentos(envio_id, intento, resultado, corte_fecha, total_adeudado, detalle)
    VALUES (v_fila.id, v_fila.intentos, 'OMITIDO', v_fila.corte_fecha, v_fila.total_adeudado, v_fila.omitido_motivo)
    ON CONFLICT (envio_id, intento) DO NOTHING;
    RETURN TRUE;
END $$;

CREATE FUNCTION app_private.aviso_deuda_estado(p_padre UUID, p_fecha DATE) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE((SELECT pg_catalog.jsonb_build_object('estado', e.estado, 'intentos', e.intentos,
                            'omitido', e.omitido_motivo IS NOT NULL)
        FROM public.envios_correo e
       WHERE e.padre_id = p_padre AND e.tipo = 'AVISO_DEUDA' AND e.fecha_programada = p_fecha),
        pg_catalog.jsonb_build_object('estado', NULL, 'intentos', 0, 'omitido', FALSE));
$$;

-- ----------------------------------------------------------------
-- 9. Envoltorios públicos (solo credencial de servidor)
-- ----------------------------------------------------------------
CREATE FUNCTION public.aviso_deuda_plan_job() RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.aviso_deuda_plan(); $$;
CREATE FUNCTION public.aviso_deuda_reservar_job(p_padre UUID, p_fecha DATE) RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.aviso_deuda_reservar(p_padre, p_fecha); $$;
CREATE FUNCTION public.aviso_deuda_datos_job(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.aviso_deuda_datos(p_padre, p_fecha, p_token); $$;
CREATE FUNCTION public.aviso_deuda_frontera_job(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS BOOLEAN LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.aviso_deuda_frontera(p_padre, p_fecha, p_token); $$;
CREATE FUNCTION public.aviso_deuda_resultado_job(p_padre UUID, p_fecha DATE, p_token UUID, p_estado TEXT, p_error TEXT) RETURNS BOOLEAN LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.aviso_deuda_resultado(p_padre, p_fecha, p_token, p_estado, p_error); $$;
CREATE FUNCTION public.aviso_deuda_omitir_job(p_padre UUID, p_fecha DATE, p_token UUID, p_motivo TEXT) RETURNS BOOLEAN LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.aviso_deuda_omitir(p_padre, p_fecha, p_token, p_motivo); $$;
CREATE FUNCTION public.aviso_deuda_estado_job(p_padre UUID, p_fecha DATE) RETURNS JSONB LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT app_private.aviso_deuda_estado(p_padre, p_fecha); $$;

REVOKE ALL ON FUNCTION
    app_private.aviso_deuda_composicion(UUID), app_private.aviso_deuda_plan(),
    app_private.aviso_deuda_reservar(UUID, DATE), app_private.aviso_deuda_datos(UUID, DATE, UUID),
    app_private.aviso_deuda_frontera(UUID, DATE, UUID),
    app_private.aviso_deuda_resultado(UUID, DATE, UUID, TEXT, TEXT),
    app_private.aviso_deuda_omitir(UUID, DATE, UUID, TEXT),
    app_private.aviso_deuda_estado(UUID, DATE),
    public.aviso_deuda_plan_job(), public.aviso_deuda_reservar_job(UUID, DATE),
    public.aviso_deuda_datos_job(UUID, DATE, UUID), public.aviso_deuda_frontera_job(UUID, DATE, UUID),
    public.aviso_deuda_resultado_job(UUID, DATE, UUID, TEXT, TEXT),
    public.aviso_deuda_omitir_job(UUID, DATE, UUID, TEXT),
    public.aviso_deuda_estado_job(UUID, DATE)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    app_private.aviso_deuda_plan(), app_private.aviso_deuda_reservar(UUID, DATE),
    app_private.aviso_deuda_datos(UUID, DATE, UUID), app_private.aviso_deuda_frontera(UUID, DATE, UUID),
    app_private.aviso_deuda_resultado(UUID, DATE, UUID, TEXT, TEXT),
    app_private.aviso_deuda_omitir(UUID, DATE, UUID, TEXT), app_private.aviso_deuda_estado(UUID, DATE),
    public.aviso_deuda_plan_job(), public.aviso_deuda_reservar_job(UUID, DATE),
    public.aviso_deuda_datos_job(UUID, DATE, UUID), public.aviso_deuda_frontera_job(UUID, DATE, UUID),
    public.aviso_deuda_resultado_job(UUID, DATE, UUID, TEXT, TEXT),
    public.aviso_deuda_omitir_job(UUID, DATE, UUID, TEXT), public.aviso_deuda_estado_job(UUID, DATE)
    TO service_role;
