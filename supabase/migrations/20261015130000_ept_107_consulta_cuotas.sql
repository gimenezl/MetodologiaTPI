-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-107 (P3-HU6), consulta de cuotas
-- Contrato de lectura de saldo y estado por factura
-- ============================================================
--
-- QUÉ AGREGA
--   · public.estado_cuotas_alumno: una fila por factura emitida, con total,
--     pagado y saldo calculados por el servidor y el estado derivado
--     (PENDIENTE, PAGO_PARCIAL, PAGADA, VENCIDA).
--   · public.detalle_cuotas_items: los ítems de cada factura con su concepto,
--     su importe y lo imputado por pagos aprobados.
--   No agrega tablas ni columnas: facturas, items_factura, pagos e
--   imputaciones_pago siguen siendo la única fuente económica.
--
-- SEGURIDAD
--   Ambas vistas son `security_invoker = true`: se evalúan con los privilegios
--   y la RLS de quien consulta. Las políticas «Lectura económica por actor»
--   (EPT-101) acotan a DIRECTOR, PADRE vinculado hoy y ESTUDIANTE propio, y la
--   política restrictiva de bloqueo de cuenta sigue aplicando. Ninguna función
--   SECURITY DEFINER interviene, de modo que ninguna agregación corre con los
--   permisos del propietario. `anon` no recibe ningún privilegio.
--
-- REGLAS ECONÓMICAS (EPT-83, EPT-84)
--   · Solo reduce el saldo una imputación ACTIVA de un pago APROBADO. Los pagos
--     PENDIENTE_VERIFICACION y RECHAZADO no lo reducen.
--   · El importe pagado de un ítem se agrega UNA vez por ítem antes de sumar por
--     factura: un pago con varias imputaciones no repite su total.
--   · saldo = facturas.total − pagado. No se recorta ni se normaliza: si el
--     histórico es incoherente, la fila lo declara en `inconsistente`.
--   · Vencida prevalece sobre Pago parcial cuando queda saldo después del
--     vencimiento; el día de vencimiento todavía no está vencida.
--   · La fecha de corte es la fecha de Buenos Aires del SERVIDOR, no la del
--     teléfono.
--   · Los importes se entregan en CENTAVOS enteros (NUMERIC(12,2) × 100), sin
--     coma flotante en el recorrido hasta el dispositivo.
--   · Una factura solo existe en public.facturas cuando EPT-104 la emitió con sus
--     ítems en la misma transacción: la composición mensual pendiente vive en
--     app_private y no se expone aquí como deuda.

-- ================================================================
-- 0. REGLAS PURAS (sin acceso a tablas)
-- ================================================================
-- Fecha de negocio: el calendario de Buenos Aires, no el del dispositivo.
CREATE FUNCTION app_private.fecha_negocio(p_instante TIMESTAMP WITH TIME ZONE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT (pg_catalog.timezone('America/Argentina/Buenos_Aires', p_instante))::DATE;
$$;

-- Estado de una cuota (EPT-83). Con saldo posterior al vencimiento prevalece
-- VENCIDA sobre PAGO_PARCIAL; el día de vencimiento todavía no está vencida.
CREATE FUNCTION app_private.estado_cuota(
    p_total NUMERIC, p_pagado NUMERIC, p_vencimiento DATE, p_hoy DATE)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_total - p_pagado <= 0 THEN 'PAGADA'
        WHEN p_hoy > p_vencimiento THEN 'VENCIDA'
        WHEN p_pagado > 0 THEN 'PAGO_PARCIAL'
        ELSE 'PENDIENTE'
    END;
$$;

REVOKE ALL ON FUNCTION app_private.fecha_negocio(TIMESTAMP WITH TIME ZONE)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.estado_cuota(NUMERIC, NUMERIC, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.fecha_negocio(TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.estado_cuota(NUMERIC, NUMERIC, DATE, DATE) TO authenticated;


-- ================================================================
-- 1. ESTADO DE CUOTAS POR FACTURA
-- ================================================================
CREATE VIEW public.estado_cuotas_alumno
WITH (security_invoker = true) AS
WITH corte AS (
    SELECT app_private.fecha_negocio(pg_catalog.now()) AS hoy
), pagado_por_item AS (
    -- Una fila por ítem: la clave única parcial de imputaciones_pago admite una
    -- sola imputación activa por ítem, y se agrega de todos modos para no
    -- depender de ello.
    SELECT ip.item_factura_id,
           pg_catalog.sum(ip.importe) AS pagado
    FROM public.imputaciones_pago ip
    JOIN public.pagos p
      ON p.id = ip.pago_id AND p.alumno_id = ip.alumno_id
    WHERE ip.activa AND p.estado = 'APROBADO'
    GROUP BY ip.item_factura_id
), por_factura AS (
    SELECT i.factura_id,
           pg_catalog.count(*) AS cantidad_items,
           pg_catalog.sum(i.importe) AS suma_items,
           pg_catalog.sum(COALESCE(pi.pagado, 0)) AS pagado,
           pg_catalog.count(*) FILTER (WHERE i.estado_pago = 'EN_VERIFICACION')
               AS items_en_verificacion,
           pg_catalog.bool_or(COALESCE(pi.pagado, 0) <> 0
                              AND COALESCE(pi.pagado, 0) <> i.importe) AS imputacion_parcial
    FROM public.items_factura i
    LEFT JOIN pagado_por_item pi ON pi.item_factura_id = i.id
    GROUP BY i.factura_id
)
SELECT
    f.id AS factura_id,
    f.alumno_id,
    f.periodo,
    f.vencimiento,
    f.generada_en,
    pg_catalog.round(f.total * 100)::BIGINT AS total_centavos,
    pg_catalog.round(COALESCE(x.pagado, 0) * 100)::BIGINT AS pagado_centavos,
    pg_catalog.round((f.total - COALESCE(x.pagado, 0)) * 100)::BIGINT AS saldo_centavos,
    app_private.estado_cuota(f.total, COALESCE(x.pagado, 0), f.vencimiento, c.hoy) AS estado,
    COALESCE(x.cantidad_items, 0)::INTEGER AS cantidad_items,
    COALESCE(x.items_en_verificacion, 0)::INTEGER AS items_en_verificacion,
    (COALESCE(x.suma_items, 0) <> f.total
     OR COALESCE(x.pagado, 0) > f.total
     OR COALESCE(x.imputacion_parcial, FALSE)) AS inconsistente,
    c.hoy AS fecha_corte
FROM public.facturas f
CROSS JOIN corte c
LEFT JOIN por_factura x ON x.factura_id = f.id;

COMMENT ON VIEW public.estado_cuotas_alumno IS
    'EPT-107. Estado y saldo por factura emitida, calculados por el servidor con importes en centavos. Solo reducen el saldo las imputaciones activas de pagos APROBADOS. Respeta RLS (security_invoker): el padre ve a sus hijos vinculados y el estudiante, lo propio.';
COMMENT ON COLUMN public.estado_cuotas_alumno.saldo_centavos IS
    'total − pagado en centavos, sin recortar. Un valor negativo o `inconsistente` = TRUE indica un histórico incoherente que no se oculta.';
COMMENT ON COLUMN public.estado_cuotas_alumno.fecha_corte IS
    'Fecha de Buenos Aires del servidor con la que se evaluó el vencimiento.';


-- ================================================================
-- 2. DETALLE DE ÍTEMS
-- ================================================================
CREATE VIEW public.detalle_cuotas_items
WITH (security_invoker = true) AS
SELECT
    i.id AS item_id,
    i.factura_id,
    i.alumno_id,
    i.tipo,
    pg_catalog.round(i.importe * 100)::BIGINT AS importe_centavos,
    pg_catalog.round(COALESCE(pi.pagado, 0) * 100)::BIGINT AS pagado_centavos,
    i.estado_pago
FROM public.items_factura i
LEFT JOIN (
    SELECT ip.item_factura_id, pg_catalog.sum(ip.importe) AS pagado
    FROM public.imputaciones_pago ip
    JOIN public.pagos p
      ON p.id = ip.pago_id AND p.alumno_id = ip.alumno_id
    WHERE ip.activa AND p.estado = 'APROBADO'
    GROUP BY ip.item_factura_id
) pi ON pi.item_factura_id = i.id;

COMMENT ON VIEW public.detalle_cuotas_items IS
    'EPT-107. Ítems de cada factura (cuota, deporte, transporte, comedor) con su importe histórico y lo imputado por pagos aprobados, en centavos. Respeta RLS (security_invoker).';


-- ================================================================
-- 3. PRIVILEGIOS MÍNIMOS
-- ================================================================
-- Solo `authenticated` lee, con la RLS de su sesión. service_role no recibe nada: la
-- lectura económica de servidor usa las tablas, no estas vistas del actor.
REVOKE ALL ON public.estado_cuotas_alumno FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.detalle_cuotas_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.estado_cuotas_alumno TO authenticated;
GRANT SELECT ON public.detalle_cuotas_items TO authenticated;

DO $$
DECLARE
    v_vista TEXT;
BEGIN
    FOREACH v_vista IN ARRAY ARRAY['estado_cuotas_alumno', 'detalle_cuotas_items'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class c
            WHERE c.oid = pg_catalog.to_regclass('public.' || v_vista)
              AND c.reloptions @> ARRAY['security_invoker=true']
        ) THEN
            RAISE EXCEPTION 'EPT-107: la vista % debe ser security_invoker.', v_vista;
        END IF;
        IF pg_catalog.has_table_privilege('anon', 'public.' || v_vista, 'SELECT') THEN
            RAISE EXCEPTION 'EPT-107: anon no debe leer %.', v_vista;
        END IF;
    END LOOP;
END;
$$;
