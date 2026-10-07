-- EPT-104. Captura durable separada de emisión; no agenda ni datos reales.
-- Composición aprobada el 06/10/2026: primer intento, incluso sin tarifas.
CREATE TABLE app_private.facturacion_config (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    habilitada BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO app_private.facturacion_config DEFAULT VALUES;

CREATE TABLE app_private.facturacion_composiciones (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    alumno_id UUID NOT NULL REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    periodo DATE NOT NULL CHECK (pg_catalog.isfinite(periodo) AND EXTRACT(DAY FROM periodo) = 1),
    capturada_en TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    -- Solo referencias, nivel y conceptos. Sin perfiles ni precios.
    origenes JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(origenes) = 'array'),
    UNIQUE (alumno_id, periodo)
);
CREATE TABLE app_private.facturacion_avisos (
    alumno_id UUID NOT NULL REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    periodo DATE NOT NULL,
    causas JSONB NOT NULL,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    resuelto_en TIMESTAMPTZ,
    PRIMARY KEY (alumno_id, periodo)
);
-- Progreso operativo, no estado económico. Sobrevive a un rollback de captura.
CREATE TABLE app_private.facturacion_intentos (
    alumno_id UUID NOT NULL REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    periodo DATE NOT NULL CHECK (pg_catalog.isfinite(periodo) AND EXTRACT(DAY FROM periodo) = 1),
    iniciado_en TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (alumno_id, periodo)
);
ALTER TABLE app_private.facturacion_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.facturacion_composiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.facturacion_avisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.facturacion_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.facturacion_config, app_private.facturacion_composiciones,
    app_private.facturacion_avisos, app_private.facturacion_intentos FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.composicion_inmutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P6840', MESSAGE = 'La composición mensual confirmada es inmutable.';
END $$;
CREATE TRIGGER composicion_inmutable BEFORE UPDATE OR DELETE
ON app_private.facturacion_composiciones FOR EACH ROW EXECUTE FUNCTION app_private.composicion_inmutable();

ALTER TABLE public.items_factura ADD COLUMN composicion_id UUID
    REFERENCES app_private.facturacion_composiciones(id) ON DELETE RESTRICT;
CREATE INDEX idx_items_factura_composicion ON public.items_factura(composicion_id)
    WHERE composicion_id IS NOT NULL;

-- Las transiciones de pago posteriores no cambian la identidad económica.
CREATE FUNCTION app_private.facturacion_historial_inmutable() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_TABLE_NAME='items_factura' THEN
        IF OLD.composicion_id IS NOT NULL AND
           (pg_catalog.to_jsonb(NEW)-'estado_pago') IS DISTINCT FROM
           (pg_catalog.to_jsonb(OLD)-'estado_pago') THEN
            RAISE EXCEPTION USING ERRCODE='P6840',MESSAGE='El ítem emitido conserva su composición e importe.';
        END IF;
    ELSE
        IF EXISTS(SELECT 1 FROM public.items_factura WHERE factura_id=OLD.id AND composicion_id IS NOT NULL)
           AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION USING ERRCODE='P6840',MESSAGE='La factura emitida es inmutable.';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER facturacion_historial_inmutable BEFORE UPDATE ON public.items_factura
FOR EACH ROW EXECUTE FUNCTION app_private.facturacion_historial_inmutable();
CREATE TRIGGER facturacion_historial_inmutable BEFORE UPDATE ON public.facturas
FOR EACH ROW EXECUTE FUNCTION app_private.facturacion_historial_inmutable();
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.facturas,public.items_factura FROM service_role;

CREATE FUNCTION app_private.ultimo_habil(p_mes DATE) RETURNS DATE
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_dia DATE := (pg_catalog.date_trunc('month', p_mes) + INTERVAL '1 month')::DATE - 1;
BEGIN
    IF p_mes IS NULL OR NOT pg_catalog.isfinite(p_mes) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6841', MESSAGE = 'Mes inválido.';
    END IF;
    WHILE EXTRACT(ISODOW FROM v_dia) IN (6,7)
       OR EXISTS (SELECT 1 FROM public.feriados WHERE fecha = v_dia) LOOP
        v_dia := v_dia - 1;
    END LOOP;
    RETURN v_dia;
END $$;

-- 03:00 ART diario. Primer intento siete días antes del último hábil;
-- margen para corrección y reintentos diarios antes del productor RF15.
CREATE FUNCTION app_private.facturacion_plan(p_ahora TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_hoy DATE := (p_ahora AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;
    v_periodo DATE := (pg_catalog.date_trunc('month', v_hoy) + INTERVAL '1 month')::DATE;
    v_pendientes JSONB;
BEGIN
    IF NOT (SELECT habilitada FROM app_private.facturacion_config WHERE id) THEN
        RETURN pg_catalog.jsonb_build_object('habilitada', FALSE, 'candidatos', '[]'::JSONB);
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('alumno_id', q.alumno_id,
                       'periodo', q.periodo) ORDER BY i.iniciado_en NULLS FIRST,
                       (c.id IS NULL AND q.periodo=v_periodo) DESC, q.periodo, q.alumno_id), '[]'::JSONB)
    INTO v_pendientes FROM (
        SELECT a.perfil_id AS alumno_id, v_periodo AS periodo FROM public.alumnos a
        WHERE a.estado = 'ACTIVO' AND v_hoy >= app_private.ultimo_habil(v_hoy) - 7
          AND v_hoy < app_private.ultimo_habil(v_hoy)
          AND NOT EXISTS (SELECT 1 FROM public.facturas f WHERE f.alumno_id=a.perfil_id AND f.periodo=v_periodo)
        UNION
        SELECT c.alumno_id, c.periodo FROM app_private.facturacion_composiciones c
        WHERE NOT EXISTS (SELECT 1 FROM public.facturas f
                          WHERE f.alumno_id = c.alumno_id AND f.periodo = c.periodo)
    ) q LEFT JOIN app_private.facturacion_intentos i
        ON i.alumno_id=q.alumno_id AND i.periodo=q.periodo
    LEFT JOIN app_private.facturacion_composiciones c
        ON c.alumno_id=q.alumno_id AND c.periodo=q.periodo;
    RETURN pg_catalog.jsonb_build_object('habilitada', TRUE, 'candidatos', v_pendientes);
END $$;

CREATE FUNCTION app_private.bloquear_facturacion(p_alumno UUID, p_periodo DATE) RETURNS VOID
LANGUAGE sql VOLATILE SET search_path = '' AS $$
    SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ept104_facturacion'),
        pg_catalog.hashtext(p_alumno::TEXT || ':' || p_periodo::TEXT));
$$;

CREATE FUNCTION app_private.capturar_facturacion(p_alumno UUID, p_periodo DATE) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID; v_origenes JSONB;
BEGIN
    IF p_periodo IS NULL OR NOT pg_catalog.isfinite(p_periodo) OR EXTRACT(DAY FROM p_periodo) <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6841', MESSAGE = 'Período inválido.';
    END IF;
    PERFORM app_private.bloquear_facturacion(p_alumno, p_periodo);
    SELECT id INTO v_id FROM app_private.facturacion_composiciones
    WHERE alumno_id = p_alumno AND periodo = p_periodo;
    IF FOUND THEN RETURN v_id; END IF;

    -- UNA sentencia MVCC: alumno, matrícula, curso, deportes y servicios ven
    -- exactamente la misma instantánea. No locks de origen en orden inverso.
    -- Ediciones concurrentes quedan enteramente antes/después de esa instantánea.
    WITH contexto AS (
        SELECT a.perfil_id, m.id AS matricula_id, c.nivel_id
        FROM public.alumnos a JOIN public.matriculas m ON m.alumno_id = a.perfil_id
        JOIN public.cursos c ON c.id = m.curso_id
        WHERE a.perfil_id = p_alumno AND a.estado = 'ACTIVO' AND m.fecha_cierre IS NULL
    ), origenes AS (
        SELECT pg_catalog.jsonb_build_object('tipo','CUOTA','matricula_id',x.matricula_id,
                   'nivel_id',x.nivel_id) AS origen FROM contexto x
        UNION ALL
        SELECT pg_catalog.jsonb_build_object('tipo','DEPORTE','inscripcion_deportiva_id',i.id,
                   'deporte_id',i.deporte_id)
        FROM contexto x JOIN public.inscripciones_deportivas i ON i.alumno_id = x.perfil_id
        WHERE i.estado = 'ACTIVA'
        UNION ALL
        SELECT pg_catalog.jsonb_build_object('tipo',s.tipo::TEXT,'inscripcion_servicio_id',i.id,
                   'servicio_id',i.servicio_id)
        FROM contexto x JOIN public.inscripciones_servicios i ON i.alumno_id = x.perfil_id
        JOIN public.servicios_escolares s ON s.id = i.servicio_id WHERE i.estado = 'ACTIVA'
    )
    SELECT pg_catalog.jsonb_agg(origen ORDER BY origen::TEXT) INTO v_origenes FROM origenes;
    IF v_origenes IS NULL OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_origenes) o
        WHERE o->>'tipo' = 'CUOTA') <> 1 OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_origenes) o
        WHERE o->>'tipo' = 'DEPORTE') > 2 THEN
        INSERT INTO app_private.facturacion_avisos(alumno_id,periodo,causas)
        VALUES(p_alumno,p_periodo,'[{"codigo":"CONTEXTO_INCONSISTENTE"}]')
        ON CONFLICT(alumno_id,periodo) DO UPDATE SET causas=EXCLUDED.causas,
            actualizado_en=pg_catalog.clock_timestamp(),resuelto_en=NULL;
        RETURN NULL;
    END IF;
    INSERT INTO app_private.facturacion_composiciones(alumno_id,periodo,origenes)
    VALUES(p_alumno,p_periodo,v_origenes) RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Conserva la guarda original para escrituras sin evidencia histórica.
ALTER FUNCTION app_private.verificar_item_factura() RENAME TO verificar_item_factura_actual;
CREATE FUNCTION app_private.verificar_item_factura() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_c app_private.facturacion_composiciones; v_t public.tarifas; v_periodo DATE; v_o JSONB;
BEGIN
    IF NEW.composicion_id IS NULL THEN
        -- Las funciones trigger no se pueden invocar como funciones ordinarias.
        -- El trigger original sigue instalado con su cuerpo original abajo.
        RETURN NEW;
    END IF;
    SELECT * INTO v_c FROM app_private.facturacion_composiciones WHERE id=NEW.composicion_id;
    SELECT periodo INTO v_periodo FROM public.facturas WHERE id=NEW.factura_id;
    IF v_c.id IS NULL OR v_c.alumno_id IS DISTINCT FROM NEW.alumno_id THEN
        RAISE EXCEPTION USING ERRCODE='P6802', MESSAGE='La composición no pertenece al alumno.';
    END IF;
    IF v_c.periodo IS DISTINCT FROM v_periodo THEN
        RAISE EXCEPTION USING ERRCODE='P6803', MESSAGE='La composición no pertenece al período.';
    END IF;
    SELECT * INTO v_t FROM public.tarifas WHERE id=NEW.tarifa_id FOR SHARE;
    SELECT o INTO v_o FROM pg_catalog.jsonb_array_elements(v_c.origenes) o
    WHERE o->>'tipo'=NEW.tipo::TEXT
      AND (o->>'matricula_id')::UUID IS NOT DISTINCT FROM NEW.matricula_id
      AND (o->>'inscripcion_deportiva_id')::UUID IS NOT DISTINCT FROM NEW.inscripcion_deportiva_id
      AND (o->>'inscripcion_servicio_id')::UUID IS NOT DISTINCT FROM NEW.inscripcion_servicio_id;
    IF v_o IS NULL OR v_t.concepto IS DISTINCT FROM NEW.tipo
       OR v_t.nivel_id IS DISTINCT FROM (v_o->>'nivel_id')::INTEGER
       OR v_t.deporte_id IS DISTINCT FROM (v_o->>'deporte_id')::UUID
       OR v_t.servicio_id IS DISTINCT FROM (v_o->>'servicio_id')::UUID
       OR v_t.desde > v_periodo OR (v_t.hasta IS NOT NULL AND v_t.hasta < v_periodo)
       OR NEW.importe IS DISTINCT FROM v_t.importe THEN
        RAISE EXCEPTION USING ERRCODE='P6803', MESSAGE='El ítem no coincide con la composición y tarifa vigentes.';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER verificar_item_factura_antes_de_escribir ON public.items_factura;
CREATE TRIGGER verificar_item_factura_antes_de_escribir
BEFORE INSERT OR UPDATE OF alumno_id,tipo,tarifa_id,matricula_id,inscripcion_deportiva_id,inscripcion_servicio_id
ON public.items_factura FOR EACH ROW WHEN (NEW.composicion_id IS NULL)
EXECUTE FUNCTION app_private.verificar_item_factura_actual();
CREATE TRIGGER verificar_item_factura_historico
BEFORE INSERT OR UPDATE OF alumno_id,tipo,tarifa_id,matricula_id,inscripcion_deportiva_id,inscripcion_servicio_id,composicion_id,importe
ON public.items_factura FOR EACH ROW WHEN (NEW.composicion_id IS NOT NULL)
EXECUTE FUNCTION app_private.verificar_item_factura();

CREATE FUNCTION app_private.emitir_facturacion(p_alumno UUID,p_periodo DATE) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_c app_private.facturacion_composiciones; v_f UUID; v_o JSONB;
    v_t public.tarifas; v_items JSONB := '[]'::JSONB; v_causas JSONB := '[]'::JSONB; v_total NUMERIC := 0;
BEGIN
    PERFORM app_private.bloquear_facturacion(p_alumno,p_periodo);
    SELECT id INTO v_f FROM public.facturas WHERE alumno_id=p_alumno AND periodo=p_periodo;
    IF FOUND THEN RETURN pg_catalog.jsonb_build_object('resultado','existente','factura_id',v_f); END IF;
    SELECT * INTO v_c FROM app_private.facturacion_composiciones WHERE alumno_id=p_alumno AND periodo=p_periodo;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('resultado','bloqueada','codigo','SIN_COMPOSICION'); END IF;
    -- Todas las referencias consultivas en orden global, antes de filas de tarifa.
    -- Compatibles con EPT-103 (perfil -> referencia -> fila); no locks académicos.
    FOR v_o IN SELECT o FROM pg_catalog.jsonb_array_elements(v_c.origenes) o
               ORDER BY o->>'tipo',COALESCE(o->>'nivel_id',o->>'deporte_id',o->>'servicio_id') LOOP
        PERFORM app_private.bloquear_referencia_tarifa((v_o->>'tipo')::public.concepto_economico,
            (v_o->>'nivel_id')::INTEGER,(v_o->>'deporte_id')::UUID,(v_o->>'servicio_id')::UUID);
    END LOOP;
    FOR v_o IN SELECT o FROM pg_catalog.jsonb_array_elements(v_c.origenes) o ORDER BY o::TEXT LOOP
        SELECT * INTO v_t FROM public.tarifas t
        WHERE t.concepto::TEXT=v_o->>'tipo'
          AND t.nivel_id IS NOT DISTINCT FROM (v_o->>'nivel_id')::INTEGER
          AND t.deporte_id IS NOT DISTINCT FROM (v_o->>'deporte_id')::UUID
          AND t.servicio_id IS NOT DISTINCT FROM (v_o->>'servicio_id')::UUID
          AND t.desde <= p_periodo AND (t.hasta IS NULL OR t.hasta >= p_periodo) FOR SHARE;
        IF NOT FOUND THEN
            v_causas := v_causas || pg_catalog.jsonb_build_array(v_o || '{"codigo":"TARIFA_FALTANTE"}'::JSONB);
        ELSE
            v_total := v_total + v_t.importe;
            v_items := v_items || pg_catalog.jsonb_build_array(v_o || pg_catalog.jsonb_build_object(
                'tarifa_id',v_t.id,'importe',v_t.importe::TEXT));
        END IF;
    END LOOP;
    IF v_total > 9999999999.99 THEN
        v_causas := v_causas || '[{"codigo":"TOTAL_FUERA_DE_RANGO"}]'::JSONB;
    END IF;
    IF pg_catalog.jsonb_array_length(v_causas)>0 THEN
        INSERT INTO app_private.facturacion_avisos(alumno_id,periodo,causas)
        VALUES(p_alumno,p_periodo,v_causas) ON CONFLICT(alumno_id,periodo) DO UPDATE
        SET causas=EXCLUDED.causas,actualizado_en=pg_catalog.clock_timestamp(),resuelto_en=NULL;
        RETURN pg_catalog.jsonb_build_object('resultado','bloqueada','causas',v_causas);
    END IF;
    INSERT INTO public.facturas(alumno_id,periodo,vencimiento,total)
    VALUES(p_alumno,p_periodo,p_periodo+9,v_total) RETURNING id INTO v_f;
    FOR v_o IN SELECT o FROM pg_catalog.jsonb_array_elements(v_items) o LOOP
        INSERT INTO public.items_factura(factura_id,alumno_id,tipo,tarifa_id,matricula_id,
            inscripcion_deportiva_id,inscripcion_servicio_id,importe,composicion_id)
        VALUES(v_f,p_alumno,(v_o->>'tipo')::public.concepto_economico,(v_o->>'tarifa_id')::UUID,
            (v_o->>'matricula_id')::UUID,(v_o->>'inscripcion_deportiva_id')::UUID,
            (v_o->>'inscripcion_servicio_id')::UUID,(v_o->>'importe')::NUMERIC,v_c.id);
    END LOOP;
    UPDATE app_private.facturacion_avisos SET resuelto_en=pg_catalog.clock_timestamp()
    WHERE alumno_id=p_alumno AND periodo=p_periodo AND resuelto_en IS NULL;
    RETURN pg_catalog.jsonb_build_object('resultado','emitida','factura_id',v_f,'total',v_total::TEXT);
END $$;

-- Núcleos con reloj explícito son privados y solo el propietario los prueba.
CREATE FUNCTION app_private.exigir_periodo_job(p_alumno UUID,p_periodo DATE) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan JSONB := app_private.facturacion_plan(pg_catalog.clock_timestamp());
BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_plan->'candidatos') c
        WHERE c->>'alumno_id'=p_alumno::TEXT AND c->>'periodo'=p_periodo::TEXT) THEN
        -- Replay emitido permitido únicamente si ya existía composición propia.
        IF NOT (v_plan->>'habilitada')::BOOLEAN OR NOT EXISTS(
            SELECT 1 FROM app_private.facturacion_composiciones WHERE alumno_id=p_alumno AND periodo=p_periodo) THEN
            RAISE EXCEPTION USING ERRCODE='P6842', MESSAGE='La facturación no está habilitada para esta clave.';
        END IF;
    END IF;
END $$;
-- Confirmar esta RPC antes de capturar: solo claves realmente iniciadas.
-- Orden por último inicio evita monopolio aun sin snapshot ni aviso confirmado.
CREATE FUNCTION app_private.facturacion_iniciar_job(p_alumno UUID,p_periodo DATE) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM app_private.exigir_periodo_job(p_alumno,p_periodo);
    INSERT INTO app_private.facturacion_intentos(alumno_id,periodo,iniciado_en)
    VALUES(p_alumno,p_periodo,pg_catalog.clock_timestamp())
    ON CONFLICT(alumno_id,periodo) DO UPDATE SET iniciado_en=pg_catalog.clock_timestamp();
END $$;
CREATE FUNCTION app_private.facturacion_capturar_job(p_alumno UUID,p_periodo DATE) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM app_private.exigir_periodo_job(p_alumno,p_periodo);
    RETURN app_private.capturar_facturacion(p_alumno,p_periodo);
END $$;
CREATE FUNCTION app_private.facturacion_emitir_job(p_alumno UUID,p_periodo DATE) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM app_private.exigir_periodo_job(p_alumno,p_periodo);
    RETURN app_private.emitir_facturacion(p_alumno,p_periodo);
END $$;
CREATE FUNCTION app_private.facturacion_estado(p_alumno UUID,p_periodo DATE) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT pg_catalog.jsonb_build_object('factura_id',f.id,'composicion_id',c.id,'causas',a.causas)
    FROM (SELECT 1) q LEFT JOIN public.facturas f ON f.alumno_id=p_alumno AND f.periodo=p_periodo
    LEFT JOIN app_private.facturacion_composiciones c ON c.alumno_id=p_alumno AND c.periodo=p_periodo
    LEFT JOIN app_private.facturacion_avisos a ON a.alumno_id=p_alumno AND a.periodo=p_periodo AND a.resuelto_en IS NULL;
$$;
CREATE FUNCTION app_private.facturacion_avisos_director() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_resultado JSONB;
BEGIN
    PERFORM app_private.exigir_director_tarifas();
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('alumno_id',alumno_id,
        'periodo',periodo,'causas',causas,'actualizado_en',actualizado_en) ORDER BY periodo,alumno_id),'[]'::JSONB)
    INTO v_resultado FROM app_private.facturacion_avisos WHERE resuelto_en IS NULL;
    RETURN v_resultado;
END $$;
-- Reintento controlado: solo instantáneas pendientes, nunca crea historia nueva.
CREATE FUNCTION app_private.facturacion_reintentar(p_alumno UUID,p_periodo DATE) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM app_private.exigir_director_tarifas();
    IF NOT (SELECT habilitada FROM app_private.facturacion_config WHERE id) THEN
        RAISE EXCEPTION USING ERRCODE='P6842',MESSAGE='La facturación está deshabilitada.';
    END IF;
    RETURN app_private.emitir_facturacion(p_alumno,p_periodo);
END $$;

CREATE FUNCTION public.facturacion_plan_job() RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.facturacion_plan(pg_catalog.clock_timestamp()); $$;
CREATE FUNCTION public.facturacion_iniciar_job(p_alumno UUID,p_periodo DATE) RETURNS VOID LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.facturacion_iniciar_job(p_alumno,p_periodo); $$;
CREATE FUNCTION public.facturacion_capturar_job(p_alumno UUID,p_periodo DATE) RETURNS UUID LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.facturacion_capturar_job(p_alumno,p_periodo); $$;
CREATE FUNCTION public.facturacion_emitir_job(p_alumno UUID,p_periodo DATE) RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.facturacion_emitir_job(p_alumno,p_periodo); $$;
CREATE FUNCTION public.facturacion_estado_job(p_alumno UUID,p_periodo DATE) RETURNS JSONB LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT app_private.facturacion_estado(p_alumno,p_periodo); $$;
CREATE FUNCTION public.facturacion_avisos_director() RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.facturacion_avisos_director(); $$;
CREATE FUNCTION public.facturacion_reintentar(p_alumno UUID,p_periodo DATE) RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT app_private.facturacion_reintentar(p_alumno,p_periodo); $$;

-- Grants por firma, sin EXECUTE por defecto ni DML nuevo.
DO $$ DECLARE v_f RECORD;
BEGIN
    FOR v_f IN SELECT p.oid::pg_catalog.regprocedure AS firma FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='app_private' AND (p.proname LIKE 'facturacion_%' OR p.proname IN (
            'composicion_inmutable','ultimo_habil','bloquear_facturacion','capturar_facturacion','emitir_facturacion','exigir_periodo_job','verificar_item_factura')) LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_f.firma);
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.facturacion_plan_job(),public.facturacion_capturar_job(UUID,DATE),
    public.facturacion_iniciar_job(UUID,DATE),
    public.facturacion_emitir_job(UUID,DATE),public.facturacion_estado_job(UUID,DATE),
    public.facturacion_avisos_director(),public.facturacion_reintentar(UUID,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.facturacion_plan_job(),public.facturacion_capturar_job(UUID,DATE),
    public.facturacion_iniciar_job(UUID,DATE),app_private.facturacion_iniciar_job(UUID,DATE),
    public.facturacion_emitir_job(UUID,DATE),public.facturacion_estado_job(UUID,DATE),
    app_private.facturacion_plan(TIMESTAMPTZ),app_private.facturacion_capturar_job(UUID,DATE),
    app_private.facturacion_emitir_job(UUID,DATE),app_private.facturacion_estado(UUID,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.facturacion_avisos_director(),public.facturacion_reintentar(UUID,DATE),
    app_private.facturacion_avisos_director(),app_private.facturacion_reintentar(UUID,DATE) TO authenticated;
