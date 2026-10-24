-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-114 (P3-HU13), historial de deuda por ítem
-- ============================================================
--
-- QUÉ AGREGA (solo lectura; ninguna tabla, columna ni privilegio de escritura)
--   · public.historial_deuda_items(alumno, desde, hasta, pagina, tamano, huella)
--       Un documento JSON por invocación con los ítems de factura de UN alumno
--       (cuota, cada deporte, cada recorrido de transporte y comedor): importe
--       histórico, importe efectivamente pagado, saldo vigente, estado, período y
--       vencimiento; los subtotales por agrupación y el TOTAL ADEUDADO del conjunto
--       filtrado completo (no solo de la página devuelta).
--
-- POR QUÉ UNA RPC Y NO MÁS VISTAS
--   `detalle_cuotas_items` (EPT-107) no trae período, saldo explícito ni el nombre
--   del deporte o del recorrido, y la RLS de inscripciones y grupos no admite al
--   PADRE vinculado (EPT-110). Abrir esas tablas expondría perfiles y catálogos
--   ajenos. Se repite el patrón de EPT-110: auxiliar privado SECURITY DEFINER con
--   guarda de actor y envoltorio público SECURITY INVOKER.
--
-- SEGURIDAD
--   · La identidad sale de auth.uid(): ningún parámetro nombra al padre, al usuario
--     ni al rol. El único identificador es el del alumno consultado.
--   · Alcance de `app_private.alumno_economico_visible` (EPT-101): DIRECTOR
--     habilitado, PADRE habilitado con vínculo vigente HOY y ESTUDIANTE habilitado
--     solo sobre sí. Alumno ajeno, inexistente, cuenta bloqueada, PERSONAL, DOCENTE
--     o vínculo revocado devuelven un documento vacío indistinguible del de un
--     alumno sin ítems: la respuesta no revela si el alumno existe.
--   · `anon` no recibe EXECUTE (42501). service_role tampoco.
--   · La guarda se resuelve antes de leer ninguna tabla económica o de catálogo.
--
-- REGLAS ECONÓMICAS (EPT-83, EPT-84, EPT-86)
--   · Cada ítem se paga completo; «pago parcial» es una FACTURA con algunos ítems
--     pagados y otros pendientes (refinamiento del criterio 3 de HU13).
--   · pagado del ítem = Σ imputaciones ACTIVAS de pagos APROBADOS, agregado UNA
--     vez por ítem antes de cualquier unión con catálogos. EN_VERIFICACION reserva
--     el ítem pero no reduce su deuda; un pago RECHAZADO conserva la historia,
--     libera la reserva y mantiene la deuda.
--   · saldo del ítem = importe histórico − pagado, sin recortar a cero. Total
--     adeudado = Σ saldos del conjunto filtrado. El importe informado de un pago
--     nunca cancela deuda.
--   · `facturas_con_saldo` clasifica por el saldo NETO de la factura (Σ saldos de sus
--     ítems > 0), igual que EPT-107 y RF19; `items_con_saldo` cuenta ítems con saldo
--     individual > 0. Solo difieren con un histórico incoherente (un ítem sobrepagado
--     junto a otro pendiente), caso que se declara con `hay_inconsistencias`.
--   · No se recalculan importes con tarifas actuales; no hay intereses, multas ni
--     prorrateos. Las inconsistencias del histórico se declaran, no se corrigen.
--   · Todo el cálculo monetario es NUMERIC en PostgreSQL. El JSON transporta
--     centavos como texto entero, incluso los totales, que pueden superar la
--     precisión segura de JavaScript.
--
-- SEMÁNTICA TEMPORAL
--   El filtro es por PERÍODO DE FACTURA (facturas.periodo, primer día de mes),
--   por mes calendario y con extremos inclusivos, igual que EPT-110: desde =
--   2026-10-17 incluye el período 2026-10-01 y hasta = 2026-11-02 incluye
--   2026-11-01. NO es la fecha de transferencia de RF19: el mismo rango literal
--   puede seleccionar otro universo. El saldo es VIGENTE (considera aprobaciones
--   de cualquier fecha), no una reconstrucción al final del intervalo. Sin rango
--   (ambos nulos) se devuelve todo el historial. La fecha de corte es la fecha
--   de Buenos Aires del servidor.
--
-- LECTURA COHERENTE Y PAGINACIÓN
--   Una función STABLE con una única consulta obtiene filas, subtotales, total y
--   huella bajo la misma instantánea de PostgreSQL, incluso durante una
--   aprobación o un rechazo concurrente. Orden total estable: agrupación, período
--   descendente e identidad del ítem. Páginas de 25, 50 o 100 filas; sin
--   truncamiento silencioso por el límite de filas de PostgREST. La huella MD5 del
--   contenido ordenado detecta cambios entre páginas: ante una huella diferente
--   se devuelve solo la señal de actualización. No es un informe inmutable
--   multipágina ni promete revocación retroactiva de lo ya entregado.
--
-- ETIQUETAS HISTÓRICAS
--   El deporte y el recorrido salen de la inscripción que originó el ítem
--   (items_factura.inscripcion_deportiva_id / inscripcion_servicio_id), también si
--   la inscripción fue cancelada o el catálogo quedó inactivo. El NOMBRE es el del
--   catálogo ACTUAL: el sistema no conserva snapshots de nombres.
--
-- CÓDIGOS SQLSTATE PROPIOS
--   P6870  alumno o fechas ausentes, una sola fecha, o fecha fuera de rango.
--   P6871  el rango de fechas está invertido (desde posterior a hasta).
--   P6872  paginación o huella no válidas.

-- ================================================================
-- 0. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.estado_cuotas_alumno') IS NULL
       OR pg_catalog.to_regprocedure('app_private.alumno_economico_visible(uuid)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.validar_rango_fechas(date,date)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.fecha_negocio(timestamp with time zone)') IS NULL THEN
        RAISE EXCEPTION 'EPT-114: faltan las vistas de EPT-107 o los auxiliares de EPT-101/EPT-110.';
    END IF;
END $$;


-- ================================================================
-- 1. LECTURA PRIVADA CON GUARDA DE ACTOR
-- ================================================================
CREATE FUNCTION app_private.historial_deuda_items(
    p_alumno_id UUID, p_desde DATE, p_hasta DATE,
    p_pagina INTEGER, p_tamano INTEGER, p_huella TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
-- El tamaño del conjunto varía mucho entre alumnos y rangos: no reutilizar un plan
-- genérico elegido con otra cardinalidad en una conexión PostgREST preparada.
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
    v_visible BOOLEAN;
    v_resultado JSONB;
BEGIN
    -- Los parámetros se validan ANTES de la guarda: un parámetro inválido se rechaza
    -- igual para cualquier alumno y no revela nada sobre su existencia.
    IF p_alumno_id IS NULL OR (p_desde IS NULL) <> (p_hasta IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6870',
            MESSAGE = 'Indicá un estudiante y un rango de fechas completo o ninguno.';
    END IF;
    IF p_desde IS NOT NULL THEN
        PERFORM app_private.validar_rango_fechas(p_desde, p_hasta);
        IF p_desde < DATE '0001-01-01' OR p_hasta > DATE '9998-12-31' THEN
            RAISE EXCEPTION USING ERRCODE = 'P6870',
                MESSAGE = 'Las fechas están fuera del rango admitido.';
        END IF;
    END IF;
    IF p_pagina IS NULL OR p_pagina NOT BETWEEN 1 AND 1000000
       OR p_tamano IS NULL OR p_tamano NOT IN (25, 50, 100)
       OR (p_huella IS NOT NULL AND p_huella !~ '^[a-f0-9]{32}$') THEN
        RAISE EXCEPTION USING ERRCODE = 'P6872',
            MESSAGE = 'La paginación solicitada no es válida.';
    END IF;

    v_visible := app_private.alumno_economico_visible(p_alumno_id);

    WITH corte AS (
        SELECT app_private.fecha_negocio(pg_catalog.now()) AS hoy
    ), pagado_por_item AS (
        -- Una fila por ítem, antes de unir catálogos: ninguna relación académica,
        -- archivo ni recibo multiplica este importe.
        SELECT ip.item_factura_id, pg_catalog.sum(ip.importe) AS pagado
        FROM public.imputaciones_pago ip
        JOIN public.pagos p ON p.id = ip.pago_id AND p.alumno_id = ip.alumno_id
        WHERE v_visible AND ip.alumno_id = p_alumno_id
          AND ip.activa AND p.estado = 'APROBADO'
        GROUP BY ip.item_factura_id
    ), base AS MATERIALIZED (
        SELECT i.id AS item_id, i.factura_id, f.periodo, f.vencimiento, f.total AS total_factura,
               i.tipo::TEXT AS tipo, i.importe, COALESCE(pi.pagado, 0) AS pagado,
               i.estado_pago::TEXT AS estado_pago,
               i.inscripcion_deportiva_id, i.inscripcion_servicio_id
        FROM public.items_factura i
        JOIN public.facturas f ON f.id = i.factura_id AND f.alumno_id = i.alumno_id
        LEFT JOIN pagado_por_item pi ON pi.item_factura_id = i.id
        WHERE v_visible AND i.alumno_id = p_alumno_id
          AND (p_desde IS NULL
               OR f.periodo BETWEEN pg_catalog.date_trunc('month', p_desde::TIMESTAMP)::DATE
                                AND pg_catalog.date_trunc('month', p_hasta::TIMESTAMP)::DATE)
    ), con_factura AS (
        -- Reglas de consistencia de EPT-107, evaluadas sobre los ítems COMPLETOS de
        -- cada factura (el filtro es por período de factura: ninguna queda partida).
        SELECT b.*,
               (pg_catalog.sum(b.importe) OVER (PARTITION BY b.factura_id) <> b.total_factura
                OR pg_catalog.sum(b.pagado) OVER (PARTITION BY b.factura_id) > b.total_factura
                OR pg_catalog.bool_or(b.pagado <> 0 AND b.pagado <> b.importe)
                       OVER (PARTITION BY b.factura_id)) AS factura_inconsistente
        FROM base b
    ), etiquetado AS (
        SELECT c.*,
               (c.importe - c.pagado) AS saldo,
               CASE c.tipo WHEN 'CUOTA' THEN 'Cuota'
                           WHEN 'DEPORTE' THEN dep.nombre::TEXT
                           ELSE se.nombre::TEXT END AS concepto,
               CASE c.tipo WHEN 'CUOTA' THEN 'CUOTA'
                           WHEN 'DEPORTE' THEN 'DEPORTE:' || d.deporte_id::TEXT
                           WHEN 'TRANSPORTE' THEN 'TRANSPORTE:' || s.servicio_id::TEXT
                           ELSE 'COMEDOR:' || s.servicio_id::TEXT END AS grupo_clave,
               CASE c.tipo WHEN 'CUOTA' THEN 1 WHEN 'DEPORTE' THEN 2
                           WHEN 'TRANSPORTE' THEN 3 ELSE 4 END AS orden_tipo,
               CASE c.tipo WHEN 'DEPORTE' THEN g.nombre::TEXT ELSE NULL END AS detalle,
               CASE c.tipo WHEN 'DEPORTE' THEN d.estado::TEXT
                           WHEN 'CUOTA' THEN NULL ELSE s.estado::TEXT END AS origen_estado,
               CASE c.tipo WHEN 'DEPORTE' THEN (dep.activo AND g.activo)
                           WHEN 'CUOTA' THEN NULL ELSE se.activo END AS catalogo_activo
        FROM con_factura c
        LEFT JOIN public.inscripciones_deportivas d ON d.id = c.inscripcion_deportiva_id
        LEFT JOIN public.deportes dep ON dep.id = d.deporte_id
        LEFT JOIN public.grupos_deportivos g ON g.id = d.grupo_id
        LEFT JOIN public.inscripciones_servicios s ON s.id = c.inscripcion_servicio_id
        LEFT JOIN public.servicios_escolares se ON se.id = s.servicio_id
    ), filas AS MATERIALIZED (
        SELECT e.*,
               CASE WHEN e.importe = 0 AND e.pagado = 0 THEN 'SIN_CARGO'
                    WHEN e.saldo <= 0 THEN 'PAGADO'
                    WHEN e.estado_pago = 'EN_VERIFICACION' THEN 'EN_VERIFICACION'
                    WHEN k.hoy > e.vencimiento THEN 'VENCIDO'
                    ELSE 'PENDIENTE' END AS estado,
               (e.saldo > 0 AND k.hoy > e.vencimiento) AS vencido,
               (e.pagado <> 0 AND e.pagado <> e.importe) AS inconsistente
        FROM etiquetado e CROSS JOIN corte k
    ), documentos AS MATERIALIZED (
        SELECT f.item_id, f.orden_tipo, f.concepto, f.grupo_clave, f.periodo,
               pg_catalog.jsonb_build_object(
                   'item_id', f.item_id, 'factura_id', f.factura_id,
                   'periodo', f.periodo, 'vencimiento', f.vencimiento,
                   'tipo', f.tipo, 'grupo', f.grupo_clave, 'concepto', f.concepto,
                   'detalle', f.detalle,
                   'importe_centavos', pg_catalog.round(f.importe * 100)::TEXT,
                   'pagado_centavos', pg_catalog.round(f.pagado * 100)::TEXT,
                   'saldo_centavos', pg_catalog.round(f.saldo * 100)::TEXT,
                   'estado', f.estado,
                   'en_verificacion', (f.estado_pago = 'EN_VERIFICACION'),
                   'vencido', f.vencido,
                   'inconsistente', f.inconsistente,
                   'factura_inconsistente', f.factura_inconsistente,
                   'origen_estado', f.origen_estado,
                   'catalogo_activo', f.catalogo_activo) AS doc
        FROM filas f
    ), por_factura AS (
        SELECT f.factura_id, pg_catalog.sum(f.saldo) AS saldo
        FROM filas f GROUP BY f.factura_id
    ), grupos AS (
        SELECT f.grupo_clave AS clave, pg_catalog.min(f.tipo) AS tipo,
               pg_catalog.min(f.concepto) AS concepto, pg_catalog.min(f.orden_tipo) AS orden_tipo,
               pg_catalog.count(*) AS items,
               pg_catalog.count(*) FILTER (WHERE f.saldo > 0) AS items_con_saldo,
               pg_catalog.round(pg_catalog.sum(f.importe) * 100)::TEXT AS importe_centavos,
               pg_catalog.round(pg_catalog.sum(f.pagado) * 100)::TEXT AS pagado_centavos,
               pg_catalog.round(pg_catalog.sum(f.saldo) * 100)::TEXT AS saldo_centavos
        FROM filas f GROUP BY f.grupo_clave
    ), resumen AS (
        SELECT pg_catalog.count(*) AS items,
               pg_catalog.count(*) FILTER (WHERE f.saldo > 0) AS items_con_saldo,
               pg_catalog.round(COALESCE(pg_catalog.sum(f.importe), 0) * 100)::TEXT AS importe_centavos,
               pg_catalog.round(COALESCE(pg_catalog.sum(f.pagado), 0) * 100)::TEXT AS pagado_centavos,
               pg_catalog.round(COALESCE(pg_catalog.sum(f.saldo), 0) * 100)::TEXT AS adeudado_centavos,
               COALESCE(pg_catalog.bool_or(f.inconsistente OR f.factura_inconsistente), FALSE)
                   AS hay_inconsistencias
        FROM filas f
    )
    SELECT pg_catalog.jsonb_build_object(
        'filas', COALESCE((
            SELECT pg_catalog.jsonb_agg(x.doc ORDER BY x.orden_tipo, x.concepto, x.grupo_clave,
                                                      x.periodo DESC, x.item_id)
            FROM (SELECT d.* FROM documentos d
                  ORDER BY d.orden_tipo, d.concepto, d.grupo_clave, d.periodo DESC, d.item_id
                  LIMIT p_tamano OFFSET (p_pagina::BIGINT - 1) * p_tamano) x), '[]'::JSONB),
        'total', r.items,
        'pagina', p_pagina,
        'tamano', p_tamano,
        'totales', pg_catalog.jsonb_build_object(
            'items', r.items,
            'items_con_saldo', r.items_con_saldo,
            'importe_centavos', r.importe_centavos,
            'pagado_centavos', r.pagado_centavos,
            'adeudado_centavos', r.adeudado_centavos,
            'facturas', (SELECT pg_catalog.count(*) FROM por_factura),
            'facturas_con_saldo', (SELECT pg_catalog.count(*) FROM por_factura pf WHERE pf.saldo > 0),
            'hay_inconsistencias', r.hay_inconsistencias),
        'grupos', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'clave', g.clave, 'tipo', g.tipo, 'concepto', g.concepto,
                       'items', g.items, 'items_con_saldo', g.items_con_saldo,
                       'importe_centavos', g.importe_centavos,
                       'pagado_centavos', g.pagado_centavos,
                       'saldo_centavos', g.saldo_centavos)
                   ORDER BY g.orden_tipo, g.concepto, g.clave)
            FROM grupos g), '[]'::JSONB),
        'huella', pg_catalog.md5(COALESCE((
            SELECT pg_catalog.string_agg(d.doc::TEXT, ''
                       ORDER BY d.orden_tipo, d.concepto, d.grupo_clave, d.periodo DESC, d.item_id)
            FROM documentos d), '')),
        'leido_en', pg_catalog.statement_timestamp(),
        'fecha_corte', app_private.fecha_negocio(pg_catalog.now()),
        'periodo_desde', CASE WHEN p_desde IS NULL THEN NULL
                              ELSE pg_catalog.date_trunc('month', p_desde::TIMESTAMP)::DATE END,
        'periodo_hasta', CASE WHEN p_hasta IS NULL THEN NULL
                              ELSE pg_catalog.date_trunc('month', p_hasta::TIMESTAMP)::DATE END)
    INTO v_resultado
    FROM resumen r;

    -- Se comunica una versión nueva; no se publica una página mezclada con la anterior.
    IF p_huella IS NOT NULL AND p_huella <> v_resultado ->> 'huella' THEN
        RETURN pg_catalog.jsonb_build_object('actualizado', TRUE, 'huella', v_resultado ->> 'huella');
    END IF;
    RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION app_private.historial_deuda_items(UUID, DATE, DATE, INTEGER, INTEGER, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.historial_deuda_items(UUID, DATE, DATE, INTEGER, INTEGER, TEXT)
    TO authenticated;


-- ================================================================
-- 2. ENVOLTORIO PÚBLICO (SECURITY INVOKER)
-- ================================================================
CREATE FUNCTION public.historial_deuda_items(
    p_alumno_id UUID, p_desde DATE DEFAULT NULL, p_hasta DATE DEFAULT NULL,
    p_pagina INTEGER DEFAULT 1, p_tamano INTEGER DEFAULT 50, p_huella TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.historial_deuda_items(p_alumno_id, p_desde, p_hasta, p_pagina, p_tamano, p_huella);
$$;

REVOKE ALL ON FUNCTION public.historial_deuda_items(UUID, DATE, DATE, INTEGER, INTEGER, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.historial_deuda_items(UUID, DATE, DATE, INTEGER, INTEGER, TEXT)
    TO authenticated;

COMMENT ON FUNCTION public.historial_deuda_items(UUID, DATE, DATE, INTEGER, INTEGER, TEXT) IS
    'EPT-114 (HU13). Historial de deuda por ítem de UN alumno: importe, pagado y saldo vigente exactos (centavos como texto), subtotales por agrupación y total adeudado del filtro completo. Filtro por período de factura (mes calendario, extremos inclusivos). Alcance: DIRECTOR, PADRE vinculado hoy o ESTUDIANTE propio; otro caso devuelve un documento vacío. Una instantánea por lectura; huella de contenido entre páginas. Sin escrituras.';
COMMENT ON FUNCTION app_private.historial_deuda_items(UUID, DATE, DATE, INTEGER, INTEGER, TEXT) IS
    'EPT-114. Auxiliar SECURITY DEFINER de public.historial_deuda_items: resuelve la guarda de actor antes de leer ninguna tabla económica o de catálogo.';
