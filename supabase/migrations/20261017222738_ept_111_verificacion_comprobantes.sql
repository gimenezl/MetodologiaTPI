-- EPT-111. Decisión económica única por pago, no por archivo.
-- Orden: perfil del actor FOR SHARE -> pago -> ítems por UUID.
-- EPT-108 solo bloquea ítems antes de insertar un pago NUEVO; no espera pagos
-- existentes. EPT-109 bloquea pago -> carga, nunca ítems. Esta operación no
-- espera vínculos, cargas ni consultivos: no agrega una arista de regreso.
-- Los saldos y estados de factura siguen derivados por EPT-107.

CREATE FUNCTION app_private.director_para_verificar_pago()
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor UUID;
    v_rol INTEGER;
    v_acceso public.estado_acceso;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;
    SELECT p.id, p.rol_id, p.estado_acceso INTO v_actor, v_rol, v_acceso
    FROM public.perfiles p WHERE p.user_id = (SELECT auth.uid()) FOR SHARE OF p;
    IF v_actor IS NULL OR v_acceso IS DISTINCT FROM 'HABILITADO'
       OR (SELECT r.nombre FROM public.roles r WHERE r.id = v_rol) IS DISTINCT FROM 'DIRECTOR' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo Dirección habilitada puede verificar pagos.';
    END IF;
    RETURN v_actor;
END;
$$;

CREATE FUNCTION app_private.verificacion_pago_a_json(p_pago UUID, p_repetido BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT pg_catalog.jsonb_build_object(
        'pago_id', p.id, 'estado', p.estado, 'verificado_por', p.verificado_por,
        'verificado_en', p.verificado_en, 'motivo_rechazo', p.motivo_rechazo,
        'repetido', p_repetido)
    FROM public.pagos p WHERE p.id = p_pago;
$$;

CREATE FUNCTION app_private.consultar_verificacion_pago(p_pago_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM app_private.director_para_verificar_pago();
    IF p_pago_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6880', MESSAGE = 'Falta el pago.';
    END IF;
    -- Espera una decisión en vuelo antes de afirmar que sigue pendiente.
    PERFORM 1 FROM public.pagos p WHERE p.id = p_pago_id FOR SHARE OF p;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6881', MESSAGE = 'El pago no está disponible.';
    END IF;
    RETURN app_private.verificacion_pago_a_json(p_pago_id, FALSE);
END;
$$;

CREATE FUNCTION app_private.verificar_pago(p_pago_id UUID, p_decision TEXT, p_motivo TEXT)
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
    RETURN app_private.verificacion_pago_a_json(p_pago_id, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION app_private.director_para_verificar_pago(), app_private.verificacion_pago_a_json(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.verificar_pago(UUID, TEXT, TEXT), app_private.consultar_verificacion_pago(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.verificar_pago(UUID, TEXT, TEXT), app_private.consultar_verificacion_pago(UUID) TO authenticated;

CREATE FUNCTION public.verificar_pago(p_pago_id UUID, p_decision TEXT, p_motivo TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT app_private.verificar_pago(p_pago_id, p_decision, p_motivo);
$$;
CREATE FUNCTION public.consultar_verificacion_pago(p_pago_id UUID)
RETURNS JSONB LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT app_private.consultar_verificacion_pago(p_pago_id);
$$;
REVOKE ALL ON FUNCTION public.verificar_pago(UUID, TEXT, TEXT), public.consultar_verificacion_pago(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verificar_pago(UUID, TEXT, TEXT), public.consultar_verificacion_pago(UUID) TO authenticated;

COMMENT ON FUNCTION public.verificar_pago(UUID, TEXT, TEXT) IS
    'EPT-111. DIRECTOR habilitado decide una vez por pago. Aprobar paga ítems completos; rechazar libera reservas y operación sin borrar historial. Idempotente, sin ajustes, recibos ni correos.';
COMMENT ON FUNCTION public.consultar_verificacion_pago(UUID) IS
    'EPT-111. Recupera el resultado durable, esperando decisiones en vuelo, solo para DIRECTOR habilitado.';

DO $$
DECLARE v_firma pg_catalog.regprocedure;
BEGIN
    FOREACH v_firma IN ARRAY ARRAY['public.verificar_pago(uuid,text,text)'::pg_catalog.regprocedure,
        'public.consultar_verificacion_pago(uuid)'::pg_catalog.regprocedure] LOOP
        IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_firma)
           OR pg_catalog.has_function_privilege('anon',v_firma,'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role',v_firma,'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated',v_firma,'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-111: ACL o ejecución insegura en %',v_firma;
        END IF;
    END LOOP;
    FOREACH v_firma IN ARRAY ARRAY['app_private.director_para_verificar_pago()'::pg_catalog.regprocedure,
        'app_private.verificacion_pago_a_json(uuid,boolean)'::pg_catalog.regprocedure] LOOP
        IF pg_catalog.has_function_privilege('anon',v_firma,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_firma,'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role',v_firma,'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-111: auxiliar expuesto %',v_firma;
        END IF;
    END LOOP;
    IF pg_catalog.has_table_privilege('authenticated','public.pagos','UPDATE')
       OR pg_catalog.has_table_privilege('authenticated','public.items_factura','UPDATE')
       OR pg_catalog.has_table_privilege('authenticated','public.imputaciones_pago','UPDATE') THEN
        RAISE EXCEPTION 'EPT-111: no se permite escritura directa económica.';
    END IF;
END;
$$;
