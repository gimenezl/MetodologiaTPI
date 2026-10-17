-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-110 (P3-T25), consulta de inscripciones y de
-- facturas y comprobantes por período (RF12, RF14)
-- ============================================================
--
-- QUÉ AGREGA (solo lecturas; ninguna tabla, columna ni privilegio de escritura)
--   · public.consultar_inscripciones_alumno(alumno)
--       Inscripciones EXISTENTES del alumno a deportes, transporte (recorrido) y
--       comedor, con su estado real (ACTIVA o CANCELADA).
--   · public.consultar_facturas_periodo(alumno, desde, hasta)
--       Facturas cuyo PERÍODO (mes calendario) cae en el rango, con el estado y el
--       saldo que ya calcula estado_cuotas_alumno (EPT-107) y la cantidad de pagos
--       y de archivos de comprobante relacionados con cada factura.
--   · public.consultar_registro_comprobantes(alumno, criterio, desde, hasta)
--       Registro SANEADO de los pagos con comprobante: una fila por pago, con la
--       cantidad de archivos y la fecha de la última carga. Nunca ruta, tipo,
--       tamaño, cargador ni contenido.
--
-- POR QUÉ UNA RPC Y NO MÁS POLÍTICAS RLS
--   La RLS de 013/014 permite leer una inscripción a DIRECTOR y al ESTUDIANTE
--   propio, pero no al PADRE vinculado. Abrirla exigiría además leer grupos,
--   perfiles y niveles de otras personas. En cambio, la RPC resuelve sola el
--   alcance (mismo criterio que EPT-101: DIRECTOR habilitado, PADRE habilitado con
--   vínculo vigente hoy, ESTUDIANTE habilitado solo sobre sí) y devuelve únicamente
--   las columnas necesarias de catálogo, sin abrir ninguna tabla. Tampoco el
--   registro de comprobantes puede leerse por RLS: comprobantes_pago es del
--   cargador y de Dirección (EPT-80), y el copadre y el estudiante no deben ver
--   siquiera cuántos archivos tienen sus metadatos individuales.
--
-- SEGURIDAD
--   · Patrón EPT-101/109: auxiliar app_private SECURITY DEFINER con search_path
--     vacío y envoltorio público SECURITY INVOKER. anon no recibe EXECUTE.
--   · La identidad sale de auth.uid(): ningún parámetro nombra al padre, al
--     usuario ni al rol. El único identificador es el del alumno consultado.
--   · Alumno ajeno, inexistente, cuenta bloqueada, rol sin acceso económico
--     (PERSONAL, DOCENTE) o vínculo revocado → CERO filas, indistinguibles entre
--     sí: la respuesta no revela si el alumno existe ni cuántas inscripciones tiene.
--   · No hay DML: STABLE. No se otorga ninguna facultad de alta, modificación ni
--     cancelación de inscripciones.
--
-- SEMÁNTICA TEMPORAL (EPT-83/EPT-86)
--   Tres fechas distintas que NO son equivalentes y nunca se intercambian:
--     · PERÍODO DE FACTURA: facturas.periodo (primer día de mes). Se filtra por
--       mes calendario, extremos inclusivos: desde = 2026-10-17 incluye el período
--       2026-10-01 y hasta = 2026-11-02 incluye 2026-11-01.
--     · FECHA DE TRANSFERENCIA: pagos.fecha_transferencia, la que informó el
--       padre. Extremos inclusivos. Un pago sin fecha informada no entra.
--     · FECHA DE CARGA: comprobantes_pago.creado_en, solo informativa.
--   No se usa vencimiento ni creado_en como sustituto de una fecha ausente.
--
-- SIN DOBLE CONTEO
--   Un pago puede cubrir varias facturas y tener varios archivos. Los conteos se
--   obtienen por subconsultas sobre el conjunto DISTINTO de pagos; ninguna suma de
--   importes pasa por un JOIN con comprobantes_pago o imputaciones_pago. Los
--   importes provienen del pago (centavos enteros) o de estado_cuotas_alumno.
--
-- LO QUE NO HACE
--   · No entrega el original del comprobante ni su ruta (EPT-80, EPT-101).
--   · No reconstruye el historial de inscripciones por período de factura, ni
--     conserva el nombre histórico de un grupo o recorrido: devuelve el estado
--     ACTUAL del catálogo. Una inscripción cancelada o un catálogo inactivo NO se
--     oculta; se marca.
--   · No recalcula importes con tarifas actuales.
--
-- CÓDIGOS SQLSTATE PROPIOS
--   P6870  parámetro ausente, criterio desconocido o fecha no finita.
--   P6871  el rango de fechas está invertido (desde posterior a hasta).

-- ================================================================
-- 0. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.estado_cuotas_alumno') IS NULL
       OR pg_catalog.to_regclass('public.comprobantes_pago') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_deportivas') IS NULL
       OR pg_catalog.to_regprocedure('app_private.alumno_economico_visible(uuid)') IS NULL THEN
        RAISE EXCEPTION 'EPT-110: faltan las vistas de EPT-107 o el auxiliar de EPT-101.';
    END IF;
END $$;


-- ================================================================
-- 1. INSCRIPCIONES DEL ALUMNO
-- ================================================================
-- Una fila por inscripción (activa o cancelada). `categoria` es DEPORTE, COMEDOR
-- o TRANSPORTE. Para un deporte, `nombre` es el deporte, `grupo` el grupo y
-- `nivel` el nivel del grupo; para un servicio, `nombre` es el servicio (el
-- recorrido, en transporte) y `grupo`/`nivel` son NULL.
CREATE FUNCTION app_private.consultar_inscripciones_alumno(p_alumno_id UUID)
RETURNS TABLE (
    categoria TEXT,
    inscripcion_id UUID,
    estado TEXT,
    nombre TEXT,
    grupo TEXT,
    nivel TEXT,
    catalogo_activo BOOLEAN,
    fecha_inscripcion TIMESTAMP WITH TIME ZONE,
    fecha_cancelacion TIMESTAMP WITH TIME ZONE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT x.categoria, x.inscripcion_id, x.estado, x.nombre, x.grupo, x.nivel,
           x.catalogo_activo, x.fecha_inscripcion, x.fecha_cancelacion
    FROM (
        SELECT 'DEPORTE'::TEXT AS categoria,
               i.id AS inscripcion_id,
               i.estado::TEXT AS estado,
               d.nombre::TEXT AS nombre,
               g.nombre::TEXT AS grupo,
               n.nombre::TEXT AS nivel,
               (d.activo AND g.activo) AS catalogo_activo,
               i.fecha_inscripcion,
               i.fecha_cancelacion
        FROM public.inscripciones_deportivas i
        JOIN public.grupos_deportivos g ON g.id = i.grupo_id
        JOIN public.deportes d ON d.id = i.deporte_id
        JOIN public.niveles n ON n.id = g.nivel_id
        WHERE i.alumno_id = p_alumno_id
        UNION ALL
        SELECT s.tipo::TEXT,
               i.id,
               i.estado::TEXT,
               s.nombre::TEXT,
               NULL::TEXT,
               NULL::TEXT,
               s.activo,
               i.fecha_inscripcion,
               i.fecha_cancelacion
        FROM public.inscripciones_servicios i
        JOIN public.servicios_escolares s ON s.id = i.servicio_id
        WHERE i.alumno_id = p_alumno_id
    ) x
    -- La guarda se evalúa una vez por llamada; si falla no hay ninguna fila.
    WHERE (SELECT app_private.alumno_economico_visible(p_alumno_id))
    ORDER BY x.categoria,
             (x.estado = 'ACTIVA') DESC,
             x.fecha_inscripcion DESC,
             x.inscripcion_id;
$$;

REVOKE ALL ON FUNCTION app_private.consultar_inscripciones_alumno(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.consultar_inscripciones_alumno(UUID) TO authenticated;


-- ================================================================
-- 2. FACTURAS POR PERÍODO
-- ================================================================
-- Validación de los parámetros del rango: se ejecuta ANTES de la guarda de
-- alcance, de modo que un rango inválido se rechaza igual para cualquier alumno
-- (no revela nada sobre su existencia).
CREATE FUNCTION app_private.validar_rango_fechas(p_desde DATE, p_hasta DATE)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF p_desde IS NULL OR p_hasta IS NULL
       OR NOT pg_catalog.isfinite(p_desde) OR NOT pg_catalog.isfinite(p_hasta) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6870',
            MESSAGE = 'Indicá una fecha desde y una fecha hasta válidas.';
    END IF;
    IF p_desde > p_hasta THEN
        RAISE EXCEPTION USING ERRCODE = 'P6871',
            MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_rango_fechas(DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.validar_rango_fechas(DATE, DATE) TO authenticated;

CREATE FUNCTION app_private.consultar_facturas_periodo(
    p_alumno_id UUID, p_desde DATE, p_hasta DATE)
RETURNS TABLE (
    factura_id UUID,
    alumno_id UUID,
    periodo DATE,
    vencimiento DATE,
    total_centavos BIGINT,
    pagado_centavos BIGINT,
    saldo_centavos BIGINT,
    estado TEXT,
    inconsistente BOOLEAN,
    fecha_corte DATE,
    cantidad_pagos INTEGER,
    cantidad_archivos INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM app_private.validar_rango_fechas(p_desde, p_hasta);

    RETURN QUERY
    SELECT e.factura_id, e.alumno_id, e.periodo, e.vencimiento,
           e.total_centavos, e.pagado_centavos, e.saldo_centavos,
           e.estado, e.inconsistente, e.fecha_corte,
           rel.cantidad_pagos, rel.cantidad_archivos
    FROM public.estado_cuotas_alumno e
    -- Pagos DISTINTOS que tocan algún ítem de la factura (un pago multifactura
    -- aparece en cada una de sus facturas) y los archivos de esos pagos. Los
    -- conteos no multiplican importes: el saldo viene de la vista, no de este JOIN.
    CROSS JOIN LATERAL (
        SELECT pg_catalog.count(*)::INTEGER AS cantidad_pagos,
               COALESCE(pg_catalog.sum(a.n), 0)::INTEGER AS cantidad_archivos
        FROM (
            SELECT DISTINCT ip.pago_id
            FROM public.imputaciones_pago ip
            JOIN public.items_factura it ON it.id = ip.item_factura_id
            WHERE it.factura_id = e.factura_id
        ) pf
        CROSS JOIN LATERAL (
            SELECT pg_catalog.count(*) AS n
            FROM public.comprobantes_pago c
            WHERE c.pago_id = pf.pago_id
        ) a
    ) rel
    WHERE e.alumno_id = p_alumno_id
      AND e.periodo BETWEEN pg_catalog.date_trunc('month', p_desde::TIMESTAMP)::DATE
                        AND pg_catalog.date_trunc('month', p_hasta::TIMESTAMP)::DATE
      AND (SELECT app_private.alumno_economico_visible(p_alumno_id))
    ORDER BY e.periodo DESC, e.factura_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.consultar_facturas_periodo(UUID, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.consultar_facturas_periodo(UUID, DATE, DATE) TO authenticated;


-- ================================================================
-- 3. REGISTRO SANEADO DE COMPROBANTES
-- ================================================================
-- Criterios (nunca se mezclan):
--   PERIODO_FACTURA     pagos con algún ítem cuya factura tiene el período en el rango.
--   FECHA_TRANSFERENCIA pagos cuya fecha de transferencia informada está en el rango.
-- `periodos` lista TODOS los períodos que toca el pago (no solo los del rango): la
-- relación con las facturas no se pierde por filtrar. Se devuelven todos los pagos
-- del criterio, con cantidad_archivos = 0 cuando todavía no hay comprobante, para
-- no ocultar un pago que aún espera su archivo.
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
    periodos DATE[])
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
           per.periodos
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


-- ================================================================
-- 4. ENVOLTORIOS PÚBLICOS (SECURITY INVOKER)
-- ================================================================
CREATE FUNCTION public.consultar_inscripciones_alumno(p_alumno_id UUID)
RETURNS TABLE (
    categoria TEXT, inscripcion_id UUID, estado TEXT, nombre TEXT, grupo TEXT, nivel TEXT,
    catalogo_activo BOOLEAN, fecha_inscripcion TIMESTAMP WITH TIME ZONE,
    fecha_cancelacion TIMESTAMP WITH TIME ZONE)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
    SELECT r.categoria, r.inscripcion_id, r.estado, r.nombre, r.grupo, r.nivel,
           r.catalogo_activo, r.fecha_inscripcion, r.fecha_cancelacion
    FROM app_private.consultar_inscripciones_alumno(p_alumno_id) r;
$$;

CREATE FUNCTION public.consultar_facturas_periodo(
    p_alumno_id UUID, p_desde DATE, p_hasta DATE)
RETURNS TABLE (
    factura_id UUID, alumno_id UUID, periodo DATE, vencimiento DATE,
    total_centavos BIGINT, pagado_centavos BIGINT, saldo_centavos BIGINT,
    estado TEXT, inconsistente BOOLEAN, fecha_corte DATE,
    cantidad_pagos INTEGER, cantidad_archivos INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
    SELECT r.factura_id, r.alumno_id, r.periodo, r.vencimiento, r.total_centavos,
           r.pagado_centavos, r.saldo_centavos, r.estado, r.inconsistente, r.fecha_corte,
           r.cantidad_pagos, r.cantidad_archivos
    FROM app_private.consultar_facturas_periodo(p_alumno_id, p_desde, p_hasta) r;
$$;

CREATE FUNCTION public.consultar_registro_comprobantes(
    p_alumno_id UUID, p_criterio TEXT, p_desde DATE, p_hasta DATE)
RETURNS TABLE (
    pago_id UUID, estado TEXT, fecha_transferencia DATE,
    importe_informado_centavos BIGINT, total_calculado_centavos BIGINT,
    creado_en TIMESTAMP WITH TIME ZONE, cantidad_archivos INTEGER,
    ultima_carga_en TIMESTAMP WITH TIME ZONE, periodos DATE[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
    SELECT r.pago_id, r.estado, r.fecha_transferencia, r.importe_informado_centavos,
           r.total_calculado_centavos, r.creado_en, r.cantidad_archivos, r.ultima_carga_en,
           r.periodos
    FROM app_private.consultar_registro_comprobantes(p_alumno_id, p_criterio, p_desde, p_hasta) r;
$$;

REVOKE ALL ON FUNCTION public.consultar_inscripciones_alumno(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_facturas_periodo(UUID, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_registro_comprobantes(UUID, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consultar_inscripciones_alumno(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_facturas_periodo(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_registro_comprobantes(UUID, TEXT, DATE, DATE)
    TO authenticated;

COMMENT ON FUNCTION public.consultar_inscripciones_alumno(UUID) IS
    'EPT-110. Inscripciones existentes (activas y canceladas) del alumno a deportes, transporte y comedor, con el estado ACTUAL del catálogo. Solo lectura. Cero filas si el alumno no es visible para el llamante (ajeno, inexistente, bloqueado o sin vínculo vigente).';
COMMENT ON FUNCTION public.consultar_facturas_periodo(UUID, DATE, DATE) IS
    'EPT-110. Facturas del alumno cuyo PERÍODO (mes calendario, extremos inclusivos) cae en el rango, con estado y saldo de estado_cuotas_alumno y los conteos de pagos y archivos relacionados. No filtra por fecha de transferencia ni de carga.';
COMMENT ON FUNCTION public.consultar_registro_comprobantes(UUID, TEXT, DATE, DATE) IS
    'EPT-110. Registro saneado de pagos con comprobante, por PERIODO_FACTURA o por FECHA_TRANSFERENCIA (criterios distintos). Devuelve cantidad de archivos y última carga; nunca ruta, tipo, tamaño ni cargador. Cero filas si el alumno no es visible.';

-- ================================================================
-- 5. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_firma TEXT;
BEGIN
    FOREACH v_firma IN ARRAY ARRAY[
        'public.consultar_inscripciones_alumno(uuid)',
        'public.consultar_facturas_periodo(uuid,date,date)',
        'public.consultar_registro_comprobantes(uuid,text,date,date)'] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma::REGPROCEDURE, 'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-110: anon no debe ejecutar %.', v_firma;
        END IF;
        IF NOT pg_catalog.has_function_privilege('authenticated', v_firma::REGPROCEDURE, 'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-110: authenticated debe ejecutar %.', v_firma;
        END IF;
        IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_firma::REGPROCEDURE) THEN
            RAISE EXCEPTION 'EPT-110: el envoltorio % debe ser SECURITY INVOKER.', v_firma;
        END IF;
    END LOOP;
END
$$;
