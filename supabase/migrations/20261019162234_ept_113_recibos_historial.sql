-- EPT-113: identidad transaccional; renderizado posterior sin Storage ni cron.
CREATE SEQUENCE app_private.recibos_numero_seq AS BIGINT MINVALUE 1;
SELECT pg_catalog.setval('app_private.recibos_numero_seq',
    COALESCE((SELECT max(numero) FROM public.recibos), 0) + 1, false);
REVOKE ALL ON SEQUENCE app_private.recibos_numero_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE app_private.recibos_fuente (
    recibo_id UUID PRIMARY KEY REFERENCES public.recibos(id) ON DELETE CASCADE,
    contenido JSONB NOT NULL CHECK (jsonb_typeof(contenido) = 'object')
);
ALTER TABLE app_private.recibos_fuente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.recibos_fuente FROM PUBLIC, anon, authenticated, service_role;

-- El llamante privado ya mantiene el bloqueo del pago. No toma bloqueos de
-- vínculos ni de ítems: conserva perfil -> pago -> ítems de EPT-111.
CREATE FUNCTION app_private.emitir_recibo_bajo_bloqueo(p_pago_id UUID)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pago public.pagos; v_id UUID; v_items JSONB; v_total NUMERIC;
BEGIN
    SELECT id INTO v_id FROM public.recibos WHERE pago_id=p_pago_id;
    IF v_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM app_private.recibos_fuente WHERE recibo_id=v_id) THEN
            RAISE EXCEPTION USING ERRCODE='P6892', MESSAGE='El recibo existente requiere conciliación institucional.';
        END IF;
        RETURN v_id;
    END IF;
    SELECT * INTO v_pago FROM public.pagos WHERE id=p_pago_id;
    IF v_pago.estado IS DISTINCT FROM 'APROBADO' THEN
        RAISE EXCEPTION USING ERRCODE='P6891', MESSAGE='Solo un pago aprobado puede tener recibo.';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'factura_id', f.id,
        'periodo', f.periodo, 'concepto', i.tipo,
        'detalle', COALESCE(d.nombre, s.nombre, n.nombre, i.tipo::TEXT),
        'importe', x.importe::TEXT) ORDER BY f.periodo, f.id, i.id), sum(x.importe)
    INTO v_items, v_total
    FROM public.imputaciones_pago x
    JOIN public.items_factura i ON i.id=x.item_factura_id
    JOIN public.facturas f ON f.id=i.factura_id
    JOIN public.tarifas t ON t.id=i.tarifa_id
    LEFT JOIN public.deportes d ON d.id=t.deporte_id
    LEFT JOIN public.servicios_escolares s ON s.id=t.servicio_id
    LEFT JOIN public.niveles n ON n.id=t.nivel_id
    WHERE x.pago_id=p_pago_id AND x.activa;
    IF v_items IS NULL OR v_total IS DISTINCT FROM v_pago.total_calculado THEN
        RAISE EXCEPTION USING ERRCODE='P6892', MESSAGE='Las imputaciones aprobadas requieren conciliación institucional.';
    END IF;
    INSERT INTO public.recibos(pago_id,numero,emitido_en)
    VALUES(p_pago_id,nextval('app_private.recibos_numero_seq'),clock_timestamp()) RETURNING id INTO v_id;
    INSERT INTO app_private.recibos_fuente(recibo_id,contenido)
    SELECT v_id,jsonb_build_object('version',1, 'institucion','Educar para Transformar',
        'pago_id',v_pago.id,'alumno_id',v_pago.alumno_id,
        'alumno',p.apellido || ', ' || p.nombre,
        'transferencia',v_pago.fecha_transferencia,'aprobado_en',v_pago.verificado_en,
        'importe_informado',v_pago.importe_informado::TEXT,'importe_imputado',v_total::TEXT,
        'diferencia',(v_pago.importe_informado-v_total)::TEXT,'items',v_items,
        'nota','Datos descriptivos disponibles al emitir; no se reconstruyen nombres históricos anteriores. Recibo institucional, no comprobante fiscal.')
    FROM public.perfiles p WHERE p.id=v_pago.alumno_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.emitir_recibo_bajo_bloqueo(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.recuperar_recibo(p_pago_id UUID)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
    PERFORM app_private.director_para_verificar_pago();
    PERFORM 1 FROM public.pagos WHERE id=p_pago_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P6890', MESSAGE='Pago no disponible.'; END IF;
    RETURN app_private.emitir_recibo_bajo_bloqueo(p_pago_id);
END;
$$;
CREATE FUNCTION public.recuperar_recibo(p_pago_id UUID)
RETURNS UUID LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
    SELECT app_private.recuperar_recibo(p_pago_id);
$$;
REVOKE ALL ON FUNCTION app_private.recuperar_recibo(UUID),public.recuperar_recibo(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.recuperar_recibo(UUID),public.recuperar_recibo(UUID) TO authenticated;

-- Guarda vigente con bloqueos compartidos frente a revocación/bloqueo.
-- Se devuelve la fuente solo mediante esta operación autorizada, nunca SELECT.
CREATE FUNCTION app_private.consultar_recibo(p_recibo_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_alumno UUID; v_actor UUID; v_rol TEXT; v_acceso public.estado_acceso; v_resultado JSONB;
BEGIN
    SELECT p.id,r.nombre,p.estado_acceso INTO v_actor,v_rol,v_acceso
    FROM public.perfiles p JOIN public.roles r ON r.id=p.rol_id
    WHERE p.user_id=(SELECT auth.uid()) FOR SHARE OF p;
    IF v_actor IS NULL OR v_acceso IS DISTINCT FROM 'HABILITADO' OR v_rol NOT IN ('PADRE','ESTUDIANTE','DIRECTOR') THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Recibo no disponible para esta cuenta.';
    END IF;
    SELECT p.alumno_id INTO v_alumno FROM public.recibos r JOIN public.pagos p ON p.id=r.pago_id WHERE r.id=p_recibo_id;
    IF v_rol='PADRE' THEN
        PERFORM 1 FROM public.padres_hijos WHERE padre_id=v_actor AND hijo_id=v_alumno FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Recibo no disponible para esta cuenta.'; END IF;
    ELSIF v_rol='ESTUDIANTE' AND v_actor IS DISTINCT FROM v_alumno THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Recibo no disponible para esta cuenta.';
    END IF;
    IF NOT COALESCE(app_private.alumno_economico_visible(v_alumno),false) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Recibo no disponible para esta cuenta.';
    END IF;
    IF EXISTS(SELECT 1 FROM public.recibos r JOIN public.pagos p ON p.id=r.pago_id
              WHERE r.id=p_recibo_id AND p.estado='APROBADO'
                AND NOT EXISTS(SELECT 1 FROM app_private.recibos_fuente f WHERE f.recibo_id=r.id)) THEN
        RAISE EXCEPTION USING ERRCODE='P6892',MESSAGE='El recibo requiere conciliación institucional de su fuente.';
    END IF;
    SELECT f.contenido || jsonb_build_object('recibo_id',r.id,'numero',r.numero::TEXT,'emitido_en',r.emitido_en)
    INTO v_resultado FROM public.recibos r JOIN public.pagos p ON p.id=r.pago_id
    JOIN app_private.recibos_fuente f ON f.recibo_id=r.id
    WHERE r.id=p_recibo_id AND p.estado='APROBADO' FOR SHARE OF p;
    IF v_resultado IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Recibo no disponible para esta cuenta.'; END IF;
    RETURN v_resultado;
END;
$$;
CREATE FUNCTION public.consultar_recibo(p_recibo_id UUID)
RETURNS JSONB LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
    SELECT app_private.consultar_recibo(p_recibo_id);
$$;
REVOKE ALL ON FUNCTION app_private.consultar_recibo(UUID),public.consultar_recibo(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.consultar_recibo(UUID),public.consultar_recibo(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.verificar_pago(p_pago_id UUID, p_decision TEXT, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor UUID;
    v_pago public.pagos;
    v_items UUID[];
BEGIN
    -- Antes de cualquier espera. FOR KEY SHARE no protegería rol/acceso.
    v_actor := app_private.director_para_verificar_pago();
    IF p_pago_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('APROBADO', 'RECHAZADO')
       OR (p_decision = 'RECHAZADO' AND (p_motivo IS NULL OR pg_catalog.btrim(p_motivo, E' \t\r\n') = ''))
       OR (p_decision = 'APROBADO' AND p_motivo IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6880', MESSAGE = 'Decisión o motivo inválido.';
    END IF;
    SELECT p.* INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE OF p;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6881', MESSAGE = 'El pago no está disponible.';
    END IF;
    -- El primer verificador y motivo sobreviven a toda repetición, incluso si
    -- cambió el estado posterior de los ítems tras un rechazo y nueva reserva.
    IF v_pago.estado::TEXT = p_decision THEN
        IF p_decision = 'APROBADO' THEN PERFORM app_private.emitir_recibo_bajo_bloqueo(p_pago_id); END IF;
        RETURN app_private.verificacion_pago_a_json(p_pago_id, TRUE);
    END IF;
    IF v_pago.estado <> 'PENDIENTE_VERIFICACION' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6882', MESSAGE = 'Otro Director ya decidió sobre este pago.';
    END IF;
    SELECT pg_catalog.array_agg(x.item_factura_id ORDER BY x.item_factura_id) INTO v_items
    FROM public.imputaciones_pago x WHERE x.pago_id = p_pago_id;
    PERFORM 1 FROM public.items_factura i WHERE i.id = ANY(v_items) ORDER BY i.id FOR UPDATE OF i;

    IF v_items IS NULL OR v_pago.total_calculado <= 0
       OR v_pago.fecha_transferencia IS NULL OR v_pago.importe_informado IS NULL OR v_pago.numero_operacion IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.comprobantes_pago c WHERE c.pago_id = p_pago_id)
       OR EXISTS (SELECT 1 FROM public.comprobantes_pago c WHERE c.pago_id = p_pago_id AND c.subido_por <> v_pago.padre_id)
       OR EXISTS (
           SELECT 1 FROM public.imputaciones_pago x JOIN public.items_factura i ON i.id = x.item_factura_id
           WHERE x.pago_id = p_pago_id AND (NOT x.activa OR i.estado_pago <> 'EN_VERIFICACION'
               OR x.importe <> i.importe OR i.importe <= 0 OR i.alumno_id <> v_pago.alumno_id))
       OR (SELECT pg_catalog.sum(x.importe) FROM public.imputaciones_pago x WHERE x.pago_id = p_pago_id)
           IS DISTINCT FROM v_pago.total_calculado THEN
        RAISE EXCEPTION USING ERRCODE = 'P6883', MESSAGE = 'El pago no tiene comprobantes o reservas coherentes. Requiere revisión institucional.';
    END IF;

    UPDATE public.pagos SET estado = p_decision::public.estado_pago,
        verificado_por = v_actor, verificado_en = pg_catalog.clock_timestamp(),
        motivo_rechazo = CASE WHEN p_decision = 'RECHAZADO' THEN pg_catalog.btrim(p_motivo, E' \t\r\n') END
    WHERE id = p_pago_id;
    IF p_decision = 'RECHAZADO' THEN
        UPDATE public.imputaciones_pago SET activa = FALSE WHERE pago_id = p_pago_id;
    END IF;
    UPDATE public.items_factura
    SET estado_pago = CASE WHEN p_decision = 'APROBADO' THEN 'PAGADO'::public.estado_pago_item ELSE 'PENDIENTE'::public.estado_pago_item END
    WHERE id = ANY(v_items);
    IF p_decision = 'APROBADO' THEN PERFORM app_private.emitir_recibo_bajo_bloqueo(p_pago_id); END IF;
    RETURN app_private.verificacion_pago_a_json(p_pago_id, FALSE);
END;
$$;


DROP FUNCTION public.consultar_registro_comprobantes(UUID,TEXT,DATE,DATE);
DROP FUNCTION app_private.consultar_registro_comprobantes(UUID,TEXT,DATE,DATE);
CREATE FUNCTION app_private.consultar_registro_comprobantes(
    p_alumno_id UUID, p_criterio TEXT, p_desde DATE, p_hasta DATE)
RETURNS TABLE (
    pago_id UUID,
    estado TEXT,
    fecha_transferencia DATE,
    importe_informado_centavos BIGINT,
    total_calculado_centavos BIGINT,
    creado_en TIMESTAMP WITH TIME ZONE,
    cantidad_archivos INTEGER,
    ultima_carga_en TIMESTAMP WITH TIME ZONE,
    periodos DATE[], items JSONB, recibo_id UUID, verificado_en TIMESTAMP WITH TIME ZONE, motivo_rechazo TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF p_criterio IS NULL OR p_criterio NOT IN ('PERIODO_FACTURA', 'FECHA_TRANSFERENCIA') THEN
        RAISE EXCEPTION USING ERRCODE = 'P6870',
            MESSAGE = 'El criterio de búsqueda no es válido.';
    END IF;
    PERFORM app_private.validar_rango_fechas(p_desde, p_hasta);

    RETURN QUERY
    SELECT p.id,
           p.estado::TEXT,
           p.fecha_transferencia,
           pg_catalog.round(p.importe_informado * 100)::BIGINT,
           pg_catalog.round(p.total_calculado * 100)::BIGINT,
           p.creado_en,
           arch.cantidad,
           arch.ultima,
           per.periodos,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id',i.id,'factura_id',i.factura_id,
               'periodo',f.periodo,'concepto',i.tipo,'importe_centavos',(x.importe*100)::BIGINT::TEXT,
               'activa',x.activa) ORDER BY f.periodo,i.id),'[]'::JSONB)
            FROM public.imputaciones_pago x JOIN public.items_factura i ON i.id=x.item_factura_id
            JOIN public.facturas f ON f.id=i.factura_id WHERE x.pago_id=p.id),
           (SELECT r.id FROM public.recibos r WHERE r.pago_id=p.id AND p.estado='APROBADO' AND EXISTS(SELECT 1 FROM app_private.recibos_fuente rf WHERE rf.recibo_id=r.id)),
           p.verificado_en,p.motivo_rechazo
    FROM public.pagos p
    CROSS JOIN LATERAL (
        SELECT pg_catalog.count(c.id)::INTEGER AS cantidad,
               pg_catalog.max(c.creado_en) AS ultima
        FROM public.comprobantes_pago c
        WHERE c.pago_id = p.id
    ) arch
    CROSS JOIN LATERAL (
        SELECT COALESCE(pg_catalog.array_agg(DISTINCT f.periodo ORDER BY f.periodo), ARRAY[]::DATE[])
                   AS periodos
        FROM public.imputaciones_pago ip
        JOIN public.items_factura it ON it.id = ip.item_factura_id
        JOIN public.facturas f ON f.id = it.factura_id
        WHERE ip.pago_id = p.id
    ) per
    WHERE p.alumno_id = p_alumno_id
      AND (SELECT app_private.alumno_economico_visible(p_alumno_id))
      AND (
          (p_criterio = 'FECHA_TRANSFERENCIA'
              AND p.fecha_transferencia BETWEEN p_desde AND p_hasta)
          OR (p_criterio = 'PERIODO_FACTURA'
              AND EXISTS (
                  SELECT 1
                  FROM public.imputaciones_pago ip
                  JOIN public.items_factura it ON it.id = ip.item_factura_id
                  JOIN public.facturas f ON f.id = it.factura_id
                  WHERE ip.pago_id = p.id
                    AND f.periodo BETWEEN pg_catalog.date_trunc('month', p_desde::TIMESTAMP)::DATE
                                      AND pg_catalog.date_trunc('month', p_hasta::TIMESTAMP)::DATE))
      )
    ORDER BY COALESCE(p.fecha_transferencia, p.creado_en::DATE) DESC, p.creado_en DESC, p.id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.consultar_registro_comprobantes(UUID, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.consultar_registro_comprobantes(UUID, TEXT, DATE, DATE)
    TO authenticated;



CREATE FUNCTION public.consultar_registro_comprobantes(p_alumno_id UUID,p_criterio TEXT,p_desde DATE,p_hasta DATE)
RETURNS TABLE(pago_id UUID,estado TEXT,fecha_transferencia DATE,importe_informado_centavos BIGINT,
 total_calculado_centavos BIGINT,creado_en TIMESTAMPTZ,cantidad_archivos INTEGER,ultima_carga_en TIMESTAMPTZ,
 periodos DATE[],items JSONB,recibo_id UUID,verificado_en TIMESTAMPTZ,motivo_rechazo TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM app_private.consultar_registro_comprobantes(p_alumno_id,p_criterio,p_desde,p_hasta);
$$;
REVOKE ALL ON FUNCTION public.consultar_registro_comprobantes(UUID,TEXT,DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.consultar_registro_comprobantes(UUID,TEXT,DATE,DATE) TO authenticated;
COMMENT ON FUNCTION public.recuperar_recibo(UUID) IS 'EPT-113. Dirección emite identidad faltante de un aprobado sin reaprobar, sin backfill automático.';
COMMENT ON FUNCTION public.consultar_recibo(UUID) IS 'EPT-113. Fuente canónica con autorización vigente: Dirección, padre vinculado o estudiante propio. No entrega transferencia original.';

COMMENT ON FUNCTION public.verificar_pago(UUID,TEXT,TEXT) IS
 'EPT-113 amplía EPT-111: decisión única con imputación e identidad/fuente de recibo atómicas. Repetir aprobación recupera faltantes sin cambiar verificador ni fecha.';
COMMENT ON FUNCTION public.consultar_registro_comprobantes(UUID,TEXT,DATE,DATE) IS
 'EPT-113. Historial saneado por pago con ítems históricos, estado e identidad de recibo disponible. Conserva filtros distintos por período de factura y transferencia. Sin ruta ni original.';
