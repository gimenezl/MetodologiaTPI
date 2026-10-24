-- ================================================================
-- EPT-115 — Recordatorio mensual por correo (P3-HU15)
-- ================================================================
-- Forward. No edita migraciones integradas. No activa nada: la compuerta
-- `app_private.recordatorio_config.habilitada` nace en FALSE.
--
-- IDENTIDAD DEL EVENTO
--   (padre_id, tipo = RECORDATORIO_MENSUAL, fecha_programada = último día hábil
--   del mes M). `fecha_programada` NUNCA se reemplaza por la fecha de un
--   reintento: eso crearía identidades nuevas y duplicados. `periodo` es el mes
--   M+1 de las facturas que se adjuntan; el vencimiento es el día 10 de ese mes.
--
-- PRIMER ENVÍO FRENTE A REINTENTOS
--   Las filas del evento se programan SOLO cuando la fecha civil argentina es el
--   último día hábil de M. Después, una fila PENDIENTE o FALLIDA se retoma una
--   vez por día hasta el día 10 de M+1 inclusive. INCIERTO no se reintenta.
--
-- MÁQUINA DE ESTADOS (por fila)
--   PENDIENTE --reservar--> PENDIENTE(token, reserva_hasta)
--   PENDIENTE(token) --frontera--> PENDIENTE(token, frontera_smtp_en)  [cruce]
--   PENDIENTE(token) --resultado--> ENVIADO | FALLIDO | INCIERTO
--   PENDIENTE(frontera, reserva vencida) --barrido--> INCIERTO
--   PENDIENTE(sin frontera, reserva vencida) --reservar--> PENDIENTE(token nuevo)
--   FALLIDO(ultimo_intento_fecha < hoy, hoy <= periodo + 9) --reservar--> PENDIENTE
--   Solo quien posee el token vigente confirma; un intento viejo no confirma ni
--   libera el trabajo de otro. Nada garantiza exactly-once entre PostgreSQL y
--   SMTP: ante incertidumbre se prioriza no duplicar.
--
-- RELOJ
--   `recordatorio_hoy()` devuelve la fecha civil argentina. Existe una fila de
--   reloj simulado SOLO para pruebas locales: la crea el propietario de la base;
--   ningún rol de aplicación puede escribirla y producción no la tiene.

-- ----------------------------------------------------------------
-- 1. Compuerta y reloj de pruebas
-- ----------------------------------------------------------------
CREATE TABLE app_private.recordatorio_config (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    habilitada BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO app_private.recordatorio_config DEFAULT VALUES;

CREATE TABLE app_private.recordatorio_reloj (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    hoy DATE NOT NULL CHECK (pg_catalog.isfinite(hoy))
);
ALTER TABLE app_private.recordatorio_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.recordatorio_reloj ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.recordatorio_config, app_private.recordatorio_reloj
    FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 2. Columnas de reserva y de frontera SMTP
-- ----------------------------------------------------------------
ALTER TABLE public.envios_correo
    ADD COLUMN periodo DATE,
    ADD COLUMN reserva_token UUID,
    ADD COLUMN reserva_hasta TIMESTAMPTZ,
    ADD COLUMN frontera_smtp_en TIMESTAMPTZ,
    ADD COLUMN ultimo_intento_fecha DATE;

ALTER TABLE public.envios_correo
    ADD CONSTRAINT envios_correo_periodo_primer_dia
        CHECK (periodo IS NULL OR (pg_catalog.isfinite(periodo) AND pg_catalog.date_part('day', periodo) = 1)),
    ADD CONSTRAINT envios_correo_reserva_completa
        CHECK ((reserva_token IS NULL) = (reserva_hasta IS NULL)),
    ADD CONSTRAINT envios_correo_frontera_finita
        CHECK (frontera_smtp_en IS NULL OR pg_catalog.isfinite(frontera_smtp_en)),
    ADD CONSTRAINT envios_correo_reserva_hasta_finita
        CHECK (reserva_hasta IS NULL OR pg_catalog.isfinite(reserva_hasta)),
    ADD CONSTRAINT envios_correo_ultimo_intento_fecha_finita
        CHECK (ultimo_intento_fecha IS NULL OR pg_catalog.isfinite(ultimo_intento_fecha)),
    -- Un recordatorio no se confirma sin haber cruzado la frontera registrada.
    ADD CONSTRAINT envios_correo_recordatorio_enviado_cruzo_frontera
        CHECK (tipo <> 'RECORDATORIO_MENSUAL' OR estado <> 'ENVIADO' OR frontera_smtp_en IS NOT NULL);

COMMENT ON COLUMN public.envios_correo.periodo IS
    'Mes (primer día) de las facturas adjuntas; el vencimiento es su día 10. fecha_programada sigue siendo la del evento original.';
COMMENT ON COLUMN public.envios_correo.frontera_smtp_en IS
    'Instante en que el intento cruzó la frontera de posible aceptación SMTP. Con reserva vencida y sin resultado, el barrido marca INCIERTO.';

-- ----------------------------------------------------------------
-- 3. Facturas adjuntas a cada envío
-- ----------------------------------------------------------------
CREATE TABLE public.envios_correo_facturas (
    envio_id UUID NOT NULL REFERENCES public.envios_correo(id) ON DELETE RESTRICT,
    factura_id UUID NOT NULL REFERENCES public.facturas(id) ON DELETE RESTRICT,
    total NUMERIC(12,2) NOT NULL CHECK (total <> 'NaN'::NUMERIC AND total >= 0),
    PRIMARY KEY (envio_id, factura_id)
);
CREATE INDEX idx_envios_correo_facturas_factura ON public.envios_correo_facturas(factura_id);
COMMENT ON TABLE public.envios_correo_facturas IS
    'Facturas incluidas (cuerpo y adjuntos) en un envío de correo. Auditoría interna: solo DIRECTOR.';

ALTER TABLE public.envios_correo_facturas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.envios_correo_facturas FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "Lectura económica de Dirección" ON public.envios_correo_facturas
    FOR SELECT TO authenticated
    USING ((SELECT app_private.es_director()));
-- Una cuenta bloqueada se trata como «sin perfil»: tampoco ve esta auditoría.
CREATE POLICY "Bloqueo de acceso sin datos protegidos" ON public.envios_correo_facturas
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));
GRANT SELECT ON public.envios_correo_facturas TO authenticated;

-- Solo las funciones definidoras escriben el registro: la credencial de servidor no tiene
-- DML directo (una fila ENVIADO/INCIERTO no puede volver a PENDIENTE por fuera de la máquina de estados).
REVOKE ALL ON public.envios_correo FROM service_role;

-- ----------------------------------------------------------------
-- 4. Calendario
-- ----------------------------------------------------------------
-- Fecha civil argentina de un instante (el día no cambia a las 00:00 UTC sino a las 03:00 UTC).
CREATE FUNCTION app_private.recordatorio_fecha_civil(p_instante TIMESTAMPTZ) RETURNS DATE
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT (p_instante AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;
$$;

CREATE FUNCTION app_private.recordatorio_hoy() RETURNS DATE
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE((SELECT hoy FROM app_private.recordatorio_reloj WHERE id),
        app_private.recordatorio_fecha_civil(pg_catalog.clock_timestamp()));
$$;

-- ----------------------------------------------------------------
-- 5. Plan: barrido de inciertos, programación del evento y candidatos
-- ----------------------------------------------------------------
CREATE FUNCTION app_private.recordatorio_plan() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_hoy DATE := app_private.recordatorio_hoy();
    v_mes DATE := pg_catalog.date_trunc('month', v_hoy)::DATE;
    v_candidatos JSONB;
BEGIN
    IF NOT (SELECT habilitada FROM app_private.recordatorio_config WHERE id) THEN
        RETURN pg_catalog.jsonb_build_object('habilitada', FALSE, 'candidatos', '[]'::JSONB);
    END IF;

    -- Reserva vencida tras cruzar la frontera: posible aceptación sin resultado.
    UPDATE public.envios_correo
       SET estado = 'INCIERTO',
           ultimo_error = 'Posible aceptación SMTP sin resultado confirmado; requiere revisión de Dirección.',
           reserva_token = NULL, reserva_hasta = NULL
     WHERE tipo = 'RECORDATORIO_MENSUAL' AND estado = 'PENDIENTE'
       AND frontera_smtp_en IS NOT NULL AND reserva_hasta < pg_catalog.clock_timestamp();

    -- Venció la ventana (día 10 inclusive) sin enviarse y sin cruzar la frontera: queda FALLIDO.
    UPDATE public.envios_correo
       SET estado = 'FALLIDO', ultimo_error = 'Venció el plazo del día 10 sin poder enviarse.',
           reserva_token = NULL, reserva_hasta = NULL
     WHERE tipo = 'RECORDATORIO_MENSUAL' AND estado = 'PENDIENTE' AND periodo IS NOT NULL
       AND frontera_smtp_en IS NULL AND v_hoy > periodo + 9
       AND (reserva_hasta IS NULL OR reserva_hasta < pg_catalog.clock_timestamp());

    -- Primer envío: solo el último día hábil del mes. Progreso durable de todo el lote.
    IF v_hoy = app_private.ultimo_habil(v_mes) THEN
        INSERT INTO public.envios_correo(padre_id, tipo, fecha_programada, periodo)
        SELECT DISTINCT ph.padre_id, 'RECORDATORIO_MENSUAL'::public.tipo_envio_correo, v_hoy, (v_mes + INTERVAL '1 month')::DATE
          FROM public.padres_hijos ph
          JOIN public.perfiles p ON p.id = ph.padre_id AND p.estado_acceso = 'HABILITADO'
          JOIN public.roles r ON r.id = p.rol_id AND r.nombre = 'PADRE'
          JOIN public.alumnos a ON a.perfil_id = ph.hijo_id AND a.estado = 'ACTIVO'
        ON CONFLICT (padre_id, tipo, fecha_programada) DO NOTHING;
    END IF;

    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'padre_id', q.padre_id, 'fecha_programada', q.fecha_programada)), '[]'::JSONB)
      INTO v_candidatos
      FROM (
        SELECT e.padre_id, e.fecha_programada
          FROM public.envios_correo e
         WHERE e.tipo = 'RECORDATORIO_MENSUAL' AND e.periodo IS NOT NULL
           AND v_hoy <= e.periodo + 9
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
CREATE FUNCTION app_private.recordatorio_reservar(p_padre UUID, p_fecha DATE) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_hoy DATE := app_private.recordatorio_hoy();
    v_e public.envios_correo;
    v_token UUID := pg_catalog.gen_random_uuid();
BEGIN
    IF NOT (SELECT habilitada FROM app_private.recordatorio_config WHERE id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6851', MESSAGE = 'El recordatorio mensual está deshabilitado.';
    END IF;
    SELECT * INTO v_e FROM public.envios_correo
     WHERE padre_id = p_padre AND tipo = 'RECORDATORIO_MENSUAL' AND fecha_programada = p_fecha FOR UPDATE;
    IF NOT FOUND OR v_e.periodo IS NULL OR v_hoy > v_e.periodo + 9 THEN
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
CREATE FUNCTION app_private.recordatorio_datos(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_e public.envios_correo;
    v_padre RECORD;
    v_hijos JSONB;
    v_sin_factura INTEGER;
    v_incoherentes INTEGER;
    v_total NUMERIC(12,2);
    v_pagado NUMERIC(12,2);
    v_verif NUMERIC(12,2);
    v_pend NUMERIC(12,2);
BEGIN
    SELECT * INTO v_e FROM public.envios_correo
     WHERE padre_id = p_padre AND tipo = 'RECORDATORIO_MENSUAL' AND fecha_programada = p_fecha FOR UPDATE;
    IF NOT FOUND OR v_e.reserva_token IS DISTINCT FROM p_token OR v_e.estado <> 'PENDIENTE'
       OR v_e.frontera_smtp_en IS NOT NULL OR v_e.reserva_hasta < pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION USING ERRCODE = 'P6852', MESSAGE = 'La reserva del envío no está vigente.';
    END IF;

    SELECT p.user_id, p.nombre, p.apellido INTO v_padre
      FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
     WHERE p.id = p_padre AND r.nombre = 'PADRE' AND p.estado_acceso = 'HABILITADO';
    IF NOT FOUND OR v_padre.user_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('impedimento', 'La cuenta del destinatario no está habilitada como padre.');
    END IF;

    SELECT COUNT(*) FILTER (WHERE f.id IS NULL) INTO v_sin_factura
      FROM public.padres_hijos ph JOIN public.alumnos a ON a.perfil_id = ph.hijo_id AND a.estado = 'ACTIVO'
      LEFT JOIN public.facturas f ON f.alumno_id = ph.hijo_id AND f.periodo = v_e.periodo
     WHERE ph.padre_id = p_padre;
    IF NOT EXISTS (SELECT 1 FROM public.padres_hijos ph
                    JOIN public.alumnos a ON a.perfil_id = ph.hijo_id AND a.estado = 'ACTIVO'
                   WHERE ph.padre_id = p_padre) THEN
        RETURN pg_catalog.jsonb_build_object('impedimento', 'El padre no tiene hijos vinculados activos.');
    END IF;
    IF v_sin_factura > 0 THEN
        RETURN pg_catalog.jsonb_build_object('impedimento',
            pg_catalog.format('Falta la factura del período para %s hijo(s) vinculado(s).', v_sin_factura));
    END IF;

    SELECT COUNT(*) INTO v_incoherentes
      FROM public.padres_hijos ph JOIN public.alumnos a ON a.perfil_id = ph.hijo_id AND a.estado = 'ACTIVO'
      JOIN public.facturas f ON f.alumno_id = ph.hijo_id AND f.periodo = v_e.periodo
     WHERE ph.padre_id = p_padre
       AND f.total IS DISTINCT FROM (SELECT COALESCE(SUM(i.importe), 0) FROM public.items_factura i WHERE i.factura_id = f.id);
    IF v_incoherentes > 0 THEN
        RETURN pg_catalog.jsonb_build_object('impedimento', 'El total de una factura no coincide con sus ítems.');
    END IF;

    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'factura_id', f.id, 'alumno_id', f.alumno_id,
               'alumno', h.apellido || ', ' || h.nombre,
               'periodo', f.periodo, 'vencimiento', f.vencimiento, 'generada_en', f.generada_en,
               'total', f.total::TEXT,
               'pagado', COALESCE(s.pagado, 0)::TEXT,
               'en_verificacion', COALESCE(s.verif, 0)::TEXT,
               'pendiente', COALESCE(s.pend, 0)::TEXT,
               'items', COALESCE(it.items, '[]'::JSONB)) ORDER BY h.apellido, h.nombre, f.id),
           COALESCE(SUM(f.total), 0), COALESCE(SUM(s.pagado), 0), COALESCE(SUM(s.verif), 0), COALESCE(SUM(s.pend), 0)
      INTO v_hijos, v_total, v_pagado, v_verif, v_pend
      FROM public.padres_hijos ph
      JOIN public.alumnos a ON a.perfil_id = ph.hijo_id AND a.estado = 'ACTIVO'
      JOIN public.perfiles h ON h.id = ph.hijo_id
      JOIN public.facturas f ON f.alumno_id = ph.hijo_id AND f.periodo = v_e.periodo
      LEFT JOIN LATERAL (
          SELECT SUM(i.importe) FILTER (WHERE i.estado_pago = 'PAGADO') AS pagado,
                 SUM(i.importe) FILTER (WHERE i.estado_pago = 'EN_VERIFICACION') AS verif,
                 SUM(i.importe) FILTER (WHERE i.estado_pago = 'PENDIENTE') AS pend
            FROM public.items_factura i WHERE i.factura_id = f.id) s ON TRUE
      LEFT JOIN LATERAL (
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                     'item_id', i.id, 'concepto', i.tipo,
                     'detalle', COALESCE(d.nombre, sv.nombre, n.nombre, i.tipo::TEXT),
                     'importe', i.importe::TEXT, 'estado_pago', i.estado_pago)
                     ORDER BY i.tipo, COALESCE(d.nombre, sv.nombre, n.nombre, ''), i.id) AS items
            FROM public.items_factura i
            JOIN public.tarifas t ON t.id = i.tarifa_id
            LEFT JOIN public.deportes d ON d.id = t.deporte_id
            LEFT JOIN public.servicios_escolares sv ON sv.id = t.servicio_id
            LEFT JOIN public.niveles n ON n.id = t.nivel_id
           WHERE i.factura_id = f.id) it ON TRUE
     WHERE ph.padre_id = p_padre;

    -- Las facturas del cuerpo son las mismas que los adjuntos que se registran.
    DELETE FROM public.envios_correo_facturas WHERE envio_id = v_e.id;
    INSERT INTO public.envios_correo_facturas(envio_id, factura_id, total)
    SELECT v_e.id, (x ->> 'factura_id')::UUID, (x ->> 'total')::NUMERIC
      FROM pg_catalog.jsonb_array_elements(v_hijos) x;

    RETURN pg_catalog.jsonb_build_object(
        'user_id', v_padre.user_id, 'padre', v_padre.apellido || ', ' || v_padre.nombre,
        'periodo', v_e.periodo, 'fecha_programada', v_e.fecha_programada,
        'hijos', v_hijos, 'total_facturado', v_total::TEXT, 'pagado', v_pagado::TEXT,
        'en_verificacion', v_verif::TEXT, 'saldo_por_abonar', v_pend::TEXT);
END $$;

-- ----------------------------------------------------------------
-- 8. Frontera, resultado y estado
-- ----------------------------------------------------------------
CREATE FUNCTION app_private.recordatorio_frontera(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n INTEGER;
BEGIN
    UPDATE public.envios_correo
       SET frontera_smtp_en = pg_catalog.clock_timestamp(),
           reserva_hasta = pg_catalog.clock_timestamp() + INTERVAL '120 seconds'
     WHERE padre_id = p_padre AND tipo = 'RECORDATORIO_MENSUAL' AND fecha_programada = p_fecha
       AND reserva_token = p_token AND estado = 'PENDIENTE'
       AND reserva_hasta >= pg_catalog.clock_timestamp() AND frontera_smtp_en IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n = 1;
END $$;

CREATE FUNCTION app_private.recordatorio_resultado(p_padre UUID, p_fecha DATE, p_token UUID,
    p_estado TEXT, p_error TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n INTEGER;
BEGIN
    IF p_estado NOT IN ('ENVIADO', 'FALLIDO', 'INCIERTO') THEN
        RAISE EXCEPTION USING ERRCODE = 'P6853', MESSAGE = 'Resultado de envío inválido.';
    END IF;
    UPDATE public.envios_correo
       SET estado = p_estado::public.estado_envio_correo,
           enviado_en = CASE WHEN p_estado = 'ENVIADO' THEN pg_catalog.clock_timestamp() END,
           ultimo_error = CASE WHEN p_estado = 'ENVIADO' THEN NULL
                               ELSE COALESCE(NULLIF(pg_catalog.left(pg_catalog.btrim(p_error, E' \t\r\n'), 300), ''), 'Error sin detalle.') END,
           reserva_token = NULL, reserva_hasta = NULL
     WHERE padre_id = p_padre AND tipo = 'RECORDATORIO_MENSUAL' AND fecha_programada = p_fecha
       AND reserva_token = p_token AND estado = 'PENDIENTE'
       AND (p_estado = 'FALLIDO' OR frontera_smtp_en IS NOT NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n = 1;
END $$;

CREATE FUNCTION app_private.recordatorio_estado(p_padre UUID, p_fecha DATE) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE((SELECT pg_catalog.jsonb_build_object('estado', e.estado, 'intentos', e.intentos)
        FROM public.envios_correo e
       WHERE e.padre_id = p_padre AND e.tipo = 'RECORDATORIO_MENSUAL' AND e.fecha_programada = p_fecha),
        pg_catalog.jsonb_build_object('estado', NULL, 'intentos', 0));
$$;

-- ----------------------------------------------------------------
-- 9. Envoltorios públicos (solo credencial de servidor)
-- ----------------------------------------------------------------
CREATE FUNCTION public.recordatorio_plan_job() RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.recordatorio_plan(); $$;
CREATE FUNCTION public.recordatorio_reservar_job(p_padre UUID, p_fecha DATE) RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.recordatorio_reservar(p_padre, p_fecha); $$;
CREATE FUNCTION public.recordatorio_datos_job(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.recordatorio_datos(p_padre, p_fecha, p_token); $$;
CREATE FUNCTION public.recordatorio_frontera_job(p_padre UUID, p_fecha DATE, p_token UUID) RETURNS BOOLEAN LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.recordatorio_frontera(p_padre, p_fecha, p_token); $$;
CREATE FUNCTION public.recordatorio_resultado_job(p_padre UUID, p_fecha DATE, p_token UUID, p_estado TEXT, p_error TEXT) RETURNS BOOLEAN LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.recordatorio_resultado(p_padre, p_fecha, p_token, p_estado, p_error); $$;
CREATE FUNCTION public.recordatorio_estado_job(p_padre UUID, p_fecha DATE) RETURNS JSONB LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT app_private.recordatorio_estado(p_padre, p_fecha); $$;

REVOKE ALL ON FUNCTION
    app_private.recordatorio_hoy(), app_private.recordatorio_fecha_civil(TIMESTAMPTZ), app_private.recordatorio_plan(),
    app_private.recordatorio_reservar(UUID, DATE), app_private.recordatorio_datos(UUID, DATE, UUID),
    app_private.recordatorio_frontera(UUID, DATE, UUID),
    app_private.recordatorio_resultado(UUID, DATE, UUID, TEXT, TEXT),
    app_private.recordatorio_estado(UUID, DATE),
    public.recordatorio_plan_job(), public.recordatorio_reservar_job(UUID, DATE),
    public.recordatorio_datos_job(UUID, DATE, UUID), public.recordatorio_frontera_job(UUID, DATE, UUID),
    public.recordatorio_resultado_job(UUID, DATE, UUID, TEXT, TEXT),
    public.recordatorio_estado_job(UUID, DATE)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    app_private.recordatorio_plan(), app_private.recordatorio_reservar(UUID, DATE),
    app_private.recordatorio_datos(UUID, DATE, UUID), app_private.recordatorio_frontera(UUID, DATE, UUID),
    app_private.recordatorio_resultado(UUID, DATE, UUID, TEXT, TEXT), app_private.recordatorio_estado(UUID, DATE),
    public.recordatorio_plan_job(), public.recordatorio_reservar_job(UUID, DATE),
    public.recordatorio_datos_job(UUID, DATE, UUID), public.recordatorio_frontera_job(UUID, DATE, UUID),
    public.recordatorio_resultado_job(UUID, DATE, UUID, TEXT, TEXT),
    public.recordatorio_estado_job(UUID, DATE)
    TO service_role;
