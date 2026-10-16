-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-108 (P3-HU8), selección de ítems a pagar
-- Cotización sin efectos, registro atómico del pago pendiente de verificación
-- y consulta del resultado de un intento
-- ============================================================
--
-- TARJETAS QUE CUBRE
--   EPT-141 función que registra el pago y lo imputa en UNA transacción.
--   EPT-142 total calculado por el servidor para la selección.
--   EPT-143 datos bancarios institucionales (ficticios, fijos, precargados).
--   EPT-144 exclusión de ítems pagados o en verificación.
--   EPT-145 pago PENDIENTE_VERIFICACION con sus imputaciones y reserva.
--
-- QUÉ AGREGA
--   · public.pagos.clave_intento y public.pagos.huella_seleccion: identidad
--     durable del intento (por padre) y huella canónica de su selección. Son
--     NULL en los pagos históricos. No se crea ninguna tabla nueva: pagos,
--     imputaciones_pago e items_factura siguen siendo la única contabilidad.
--   · public.cotizar_pago(uuid[])          lectura sin efectos.
--   · public.registrar_pago(uuid, uuid[], bigint)   escritura atómica.
--   · public.consultar_intento_pago(uuid)  recuperación de un resultado incierto.
--   · public.datos_bancarios_transferencia()  datos ficticios, solo familias.
--   Los cuatro son envoltorios SECURITY INVOKER sobre cuerpos SECURITY DEFINER en
--   app_private, igual que EPT-103. Ningún rol de aplicación recibe escritura
--   directa sobre ninguna tabla.
--
-- QUÉ NO HACE (otras tarjetas)
--   · No informa fecha de transferencia, importe informado, número de operación
--     ni comprobante (EPT-109): esas columnas siguen NULL.
--   · No aprueba, rechaza, libera, emite recibos ni envía correos (EPT-110/111).
--   · No expira ni libera automáticamente un pago pendiente: no existe una regla
--     aprobada para hacerlo.
--   · No reduce el saldo: estado_cuotas_alumno (EPT-107) solo descuenta
--     imputaciones activas de pagos APROBADOS. Un pago pendiente deja el ítem
--     EN_VERIFICACION y el saldo intacto.
--
-- CONTRATO DE ENTRADA
--   La identidad sale de auth.uid() y del perfil VIGENTE; ningún argumento
--   transporta padre, rol, estado ni importe como autoridad. El total esperado
--   que envía el cliente es una PRECONDICIÓN de consentimiento (detecta una
--   cotización desactualizada), nunca el importe que se cobra: el importe se
--   recalcula siempre desde los importes históricos de items_factura.
--
-- DECISIONES SOBRE EL CONTRATO REAL
--   · Un ítem con importe 0 es «sin cargo» (EPT-107 lo presenta así y una factura
--     de total 0 es PAGADA): no es seleccionable, P6854.
--   · Una factura cuya suma de ítems no coincide con su total no se cobra ni se
--     «corrige»: se rechaza con P6855 para que la institución la revise.
--   · Una selección duplicada o con elementos nulos es un error del cliente
--     (P6850): no se normaliza en silencio. Máximo 100 ítems por pago.
--   · Un ítem inexistente, de otra familia o de un hijo cuyo vínculo ya no rige
--     devuelve el MISMO error (P6851): no se confirma la existencia de ítems
--     ajenos.
--
-- ORDEN DE BLOQUEOS (el mismo en toda operación; ver EPT-103)
--     1. perfil del actor, FOR SHARE (guarda de autorización, retenida hasta el
--        fin de la transacción: una revocación posterior ESPERA, una anterior
--        rechaza con 42501);
--     2. consultivo del intento (padre, clave): serializa reintentos idénticos;
--     3. vínculo (padre, hijo), FOR SHARE: un DELETE concurrente del vínculo
--        espera;
--     4. ítems seleccionados, FOR UPDATE ordenados por id: dos selecciones que se
--        solapan, aun en orden inverso, toman los bloqueos en el mismo orden y
--        no pueden formar un ciclo.
--   Solo hay dos órdenes seriales posibles entre un registro y la revocación del
--   permiso: la revocación confirma antes (el registro se rechaza y no escribe) o
--   el registro adquiere la guarda primero (la revocación espera a su COMMIT).
--   Tradeoff aceptado, igual que en EPT-103: la revocación puede esperar a un
--   registro que ya estaba autorizado.
--
-- IDEMPOTENCIA
--   (padre_id, clave_intento) es único. Mismo intento y misma selección devuelve
--   el mismo pago con `repetido = true`; la misma clave con otra selección es
--   P6856 y no escribe; claves distintas sobre un mismo ítem no pueden reservarlo
--   dos veces (índice único parcial de imputaciones activas + bloqueo de fila).
--   La clave NO es el futuro número de operación bancaria. No es un secreto: es
--   un UUID aleatorio del cliente, acotado al padre que la usó.
--
-- CÓDIGOS SQLSTATE PROPIOS (P685x; los P68xx anteriores pertenecen a EPT-100/103/104)
--   P6850  selección inválida (vacía, nula, duplicada, demasiado grande) o
--          argumentos obligatorios ausentes.
--   P6851  algún ítem no existe o no está disponible para esta cuenta.
--   P6852  los ítems pertenecen a hijos distintos.
--   P6853  algún ítem ya está pagado, en verificación o reservado.
--   P6854  algún ítem no tiene cargo (importe 0).
--   P6855  una factura de la selección tiene importes incoherentes.
--   P6856  la clave de intento ya se usó con otra selección.
--   P6857  el total cambió desde la cotización.
--   42501  la identidad no es una familia habilitada.
--   P5505  no hay identidad autenticada (mismo código que EPT-103).

-- ================================================================
-- 0. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.pagos') IS NULL
       OR pg_catalog.to_regclass('public.imputaciones_pago') IS NULL
       OR pg_catalog.to_regclass('public.items_factura') IS NULL
       OR pg_catalog.to_regclass('public.padres_hijos') IS NULL
       OR pg_catalog.to_regclass('public.estado_cuotas_alumno') IS NULL THEN
        RAISE EXCEPTION 'EPT-108: faltan las tablas económicas o las vistas de EPT-107.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = 'public' AND c.table_name = 'pagos'
                 AND c.column_name IN ('clave_intento', 'huella_seleccion')) THEN
        RAISE EXCEPTION 'EPT-108: public.pagos ya tiene columnas de intento; revisá el estado de la base.';
    END IF;
END $$;


-- ================================================================
-- 1. IDENTIDAD DURABLE DEL INTENTO
-- ================================================================
-- ADD COLUMN sin valor por defecto: no reescribe la tabla.
ALTER TABLE public.pagos
    ADD COLUMN clave_intento UUID,
    ADD COLUMN huella_seleccion TEXT;

ALTER TABLE public.pagos
    ADD CONSTRAINT pagos_intento_coherente
        CHECK ((clave_intento IS NULL) = (huella_seleccion IS NULL)),
    ADD CONSTRAINT pagos_huella_formato
        CHECK (huella_seleccion IS NULL OR huella_seleccion ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.pagos.clave_intento IS
    'EPT-108. UUID generado por el cliente para un intento de pago; único por padre. NULL en pagos históricos. No es un secreto ni el número de operación bancaria.';
COMMENT ON COLUMN public.pagos.huella_seleccion IS
    'EPT-108. SHA-256 hexadecimal de la selección canónica (ids de ítems ordenados). Permite distinguir un reintento idéntico de la misma clave con otro contenido.';

-- Autoridad de «un pago por intento y padre» ante concurrencia.
CREATE UNIQUE INDEX idx_pagos_intento_por_padre
    ON public.pagos (padre_id, clave_intento)
    WHERE clave_intento IS NOT NULL;


-- ================================================================
-- 2. DATOS BANCARIOS (ficticios, fijos, precargados — EPT-84 punto 8)
-- ================================================================
-- Fuente única y reproducible: viaja con la migración. Dirección no la edita
-- (no hay tabla de configuración). Los valores son deliberadamente inválidos
-- para una transferencia real: el CBU es de ceros (no cumple los dígitos
-- verificadores) y el aviso lo declara.
CREATE FUNCTION app_private.datos_bancarios_institucion()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'ficticio', TRUE,
        'banco', 'Banco de Prueba Institucional',
        'titular', 'Educar para Transformar (datos de prueba)',
        'cuit', '00-00000000-0',
        'tipo_cuenta', 'Cuenta corriente en pesos',
        'cbu', '0000000000000000000000',
        'alias', 'EPT.DATOS.FICTICIOS',
        'aviso', 'Datos ficticios de prueba. No son una cuenta real y no deben usarse para transferir dinero.'
    );
$$;

-- Solo la invocan las operaciones DEFINER de abajo (como propietario): ningún rol de aplicación
-- necesita ni conserva EXECUTE (el privilegio por defecto de PUBLIC no aplica).
REVOKE ALL ON FUNCTION app_private.datos_bancarios_institucion()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION app_private.datos_bancarios_institucion() IS
    'EPT-143. Datos bancarios institucionales FICTICIOS, fijos y precargados (EPT-84, punto 8). Sin edición desde la web.';


-- ================================================================
-- 3. GUARDA DE AUTORIZACIÓN
-- ================================================================
-- Devuelve el perfil del padre habilitado. Con p_bloquear toma FOR SHARE sobre
-- su fila ANTES de cualquier otra lectura o espera y la conserva hasta COMMIT o
-- ROLLBACK: `rol_id` y `estado_acceso` no pueden cambiar bajo la operación. FOR
-- KEY SHARE no sirve: es compatible con el UPDATE de esas columnas (EPT-103).
CREATE FUNCTION app_private.padre_para_pagos(p_bloquear BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_usuario UUID := (SELECT auth.uid());
    v_perfil  UUID;
    v_rol_id  INTEGER;
    v_acceso  public.estado_acceso;
    v_rol     TEXT;
BEGIN
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF p_bloquear THEN
        SELECT p.id, p.rol_id, p.estado_acceso
        INTO v_perfil, v_rol_id, v_acceso
        FROM public.perfiles p
        WHERE p.user_id = v_usuario
        FOR SHARE OF p;
    ELSE
        SELECT p.id, p.rol_id, p.estado_acceso
        INTO v_perfil, v_rol_id, v_acceso
        FROM public.perfiles p
        WHERE p.user_id = v_usuario;
    END IF;

    IF NOT FOUND OR v_acceso IS DISTINCT FROM 'HABILITADO' THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Solo una familia habilitada puede registrar pagos.';
    END IF;

    -- El rol se resuelve DESPUÉS de bloquear el perfil, con el `rol_id` fresco.
    SELECT r.nombre INTO v_rol FROM public.roles r WHERE r.id = v_rol_id;
    IF v_rol IS DISTINCT FROM 'PADRE' THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Solo una familia habilitada puede registrar pagos.';
    END IF;

    RETURN v_perfil;
END;
$$;

REVOKE ALL ON FUNCTION app_private.padre_para_pagos(BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 4. ANÁLISIS CANÓNICO DE UNA SELECCIÓN
-- ================================================================
-- Normaliza y valida la selección y calcula el total desde los importes
-- históricos. Con p_bloquear toma el vínculo y los ítems en el orden documentado
-- y revalida BAJO los bloqueos (la lectura previa es solo para decidir qué
-- bloquear). Sin p_bloquear no toma ningún bloqueo (cotización).
CREATE FUNCTION app_private.analizar_seleccion_pago(
    p_padre UUID, p_item_ids UUID[], p_bloquear BOOLEAN)
RETURNS TABLE (alumno_id UUID, total NUMERIC, huella TEXT, items JSONB)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cantidad INTEGER;
    v_alumnos  UUID[];
    v_alumno   UUID;
    v_filas    INTEGER;
BEGIN
    IF p_item_ids IS NULL OR pg_catalog.cardinality(p_item_ids) = 0
       OR pg_catalog.array_ndims(p_item_ids) <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6850', MESSAGE = 'Elegí al menos un ítem para pagar.';
    END IF;
    v_cantidad := pg_catalog.cardinality(p_item_ids);
    IF v_cantidad > 100 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6850', MESSAGE = 'La selección supera el máximo de 100 ítems por pago.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_item_ids) AS x(id) WHERE x.id IS NULL)
       OR (SELECT pg_catalog.count(DISTINCT x.id) FROM pg_catalog.unnest(p_item_ids) AS x(id)) <> v_cantidad THEN
        RAISE EXCEPTION USING ERRCODE = 'P6850', MESSAGE = 'La selección tiene ítems repetidos o vacíos.';
    END IF;

    -- Lectura previa sin bloqueo: decide a qué hijo pertenece la selección.
    SELECT pg_catalog.array_agg(DISTINCT i.alumno_id), pg_catalog.count(*)
    INTO v_alumnos, v_filas
    FROM public.items_factura i
    WHERE i.id = ANY (p_item_ids);

    IF v_filas <> v_cantidad
       OR EXISTS (
           SELECT 1 FROM pg_catalog.unnest(v_alumnos) AS a(id)
           WHERE NOT EXISTS (SELECT 1 FROM public.padres_hijos ph
                             WHERE ph.padre_id = p_padre AND ph.hijo_id = a.id)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6851',
            MESSAGE = 'Algún ítem no existe o no está disponible para tu cuenta.';
    END IF;
    IF pg_catalog.cardinality(v_alumnos) <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6852',
            MESSAGE = 'Un pago solo puede incluir ítems de un mismo hijo.';
    END IF;
    v_alumno := v_alumnos[1];

    IF p_bloquear THEN
        -- Vínculo vigente retenido: su DELETE concurrente espera a este COMMIT.
        PERFORM 1 FROM public.padres_hijos ph
        WHERE ph.padre_id = p_padre AND ph.hijo_id = v_alumno
        FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P6851',
                MESSAGE = 'Algún ítem no existe o no está disponible para tu cuenta.';
        END IF;
        -- Ítems por id ascendente: orden único para todo registro.
        PERFORM 1 FROM public.items_factura i
        WHERE i.id = ANY (p_item_ids)
        ORDER BY i.id
        FOR UPDATE OF i;
    END IF;

    -- Estado bajo bloqueo (READ COMMITTED: instantánea nueva por sentencia).
    PERFORM 1 FROM public.items_factura i
    WHERE i.id = ANY (p_item_ids) AND i.alumno_id = v_alumno
    HAVING pg_catalog.count(*) = v_cantidad;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6851',
            MESSAGE = 'Algún ítem no existe o no está disponible para tu cuenta.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.items_factura i
        WHERE i.id = ANY (p_item_ids)
          AND (i.estado_pago <> 'PENDIENTE'
               OR EXISTS (SELECT 1 FROM public.imputaciones_pago ip
                          WHERE ip.item_factura_id = i.id AND ip.activa))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6853',
            MESSAGE = 'Algún ítem ya está pagado o tiene un pago en verificación.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.items_factura i
               WHERE i.id = ANY (p_item_ids) AND i.importe = 0) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6854',
            MESSAGE = 'Un ítem sin cargo no se paga.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.facturas f
        WHERE f.id IN (SELECT i.factura_id FROM public.items_factura i WHERE i.id = ANY (p_item_ids))
          AND f.total IS DISTINCT FROM (SELECT pg_catalog.sum(x.importe)
                                        FROM public.items_factura x WHERE x.factura_id = f.id)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6855',
            MESSAGE = 'Una factura tiene importes que no coinciden. Consultá con la institución.';
    END IF;

    RETURN QUERY
    SELECT v_alumno,
           (SELECT pg_catalog.sum(i.importe) FROM public.items_factura i WHERE i.id = ANY (p_item_ids)),
           pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
               (SELECT pg_catalog.string_agg(x.id::TEXT, ',' ORDER BY x.id)
                FROM pg_catalog.unnest(p_item_ids) AS x(id)), 'UTF8')), 'hex'),
           (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'item_id', i.id,
                       'factura_id', i.factura_id,
                       'periodo', f.periodo,
                       'tipo', i.tipo,
                       'importe_centavos', pg_catalog.round(i.importe * 100)::BIGINT)
                   ORDER BY f.periodo, i.tipo, i.id)
            FROM public.items_factura i
            JOIN public.facturas f ON f.id = i.factura_id
            WHERE i.id = ANY (p_item_ids));
END;
$$;

REVOKE ALL ON FUNCTION app_private.analizar_seleccion_pago(UUID, UUID[], BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

-- Huella de una selección sin consultar tablas (reintentos y comparación).
CREATE FUNCTION app_private.huella_seleccion_pago(p_item_ids UUID[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        (SELECT pg_catalog.string_agg(x.id::TEXT, ',' ORDER BY x.id)
         FROM pg_catalog.unnest(p_item_ids) AS x(id)), 'UTF8')), 'hex');
$$;

REVOKE ALL ON FUNCTION app_private.huella_seleccion_pago(UUID[])
    FROM PUBLIC, anon, authenticated, service_role;

-- Resultado durable de un pago, en el formato que consume la aplicación.
CREATE FUNCTION app_private.pago_a_json(p_pago_id UUID, p_repetido BOOLEAN)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'pago_id', p.id,
        'estado', p.estado,
        'alumno_id', p.alumno_id,
        'total_centavos', pg_catalog.round(p.total_calculado * 100)::BIGINT,
        'creado_en', p.creado_en,
        'repetido', p_repetido,
        'items', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'item_id', i.id,
                       'factura_id', i.factura_id,
                       'periodo', f.periodo,
                       'tipo', i.tipo,
                       'importe_centavos', pg_catalog.round(ip.importe * 100)::BIGINT)
                   ORDER BY f.periodo, i.tipo, i.id)
            FROM public.imputaciones_pago ip
            JOIN public.items_factura i ON i.id = ip.item_factura_id
            JOIN public.facturas f ON f.id = i.factura_id
            WHERE ip.pago_id = p.id), '[]'::JSONB),
        'banco', app_private.datos_bancarios_institucion())
    FROM public.pagos p
    WHERE p.id = p_pago_id;
$$;

REVOKE ALL ON FUNCTION app_private.pago_a_json(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 5. OPERACIONES (DEFINER, en app_private)
-- ================================================================
-- 5.1 Cotización: sin efectos ni reserva. La lectura previa no garantiza que el
-- registro posterior prospere; el registro vuelve a validar todo bajo bloqueo.
CREATE FUNCTION app_private.cotizar_pago(p_item_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre UUID;
    v_a RECORD;
BEGIN
    v_padre := app_private.padre_para_pagos(FALSE);
    SELECT * INTO v_a FROM app_private.analizar_seleccion_pago(v_padre, p_item_ids, FALSE);
    RETURN pg_catalog.jsonb_build_object(
        'alumno_id', v_a.alumno_id,
        'moneda', 'ARS',
        'total_centavos', pg_catalog.round(v_a.total * 100)::BIGINT,
        'items', v_a.items,
        'banco', app_private.datos_bancarios_institucion());
END;
$$;

-- 5.2 Registro atómico: pago PENDIENTE_VERIFICACION + imputaciones + reserva.
CREATE FUNCTION app_private.registrar_pago(
    p_clave_intento UUID, p_item_ids UUID[], p_total_esperado_centavos BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre   UUID;
    v_previo  public.pagos;
    v_a       RECORD;
    v_pago_id UUID;
BEGIN
    -- 1. Guarda de autorización, ANTES de cualquier espera.
    v_padre := app_private.padre_para_pagos(TRUE);

    IF p_clave_intento IS NULL OR p_total_esperado_centavos IS NULL OR p_total_esperado_centavos < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6850',
            MESSAGE = 'Faltan la clave del intento o el total cotizado.';
    END IF;
    -- La selección se valida ANTES de reconocer un intento previo: un reintento con ids vacíos,
    -- nulos o duplicados es un error del cliente (P6850), no un conflicto de clave.
    IF p_item_ids IS NULL OR pg_catalog.cardinality(p_item_ids) = 0
       OR pg_catalog.array_ndims(p_item_ids) <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6850', MESSAGE = 'Elegí al menos un ítem para pagar.';
    END IF;
    IF pg_catalog.cardinality(p_item_ids) > 100
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_item_ids) AS x(id) WHERE x.id IS NULL)
       OR (SELECT pg_catalog.count(DISTINCT x.id) FROM pg_catalog.unnest(p_item_ids) AS x(id))
          <> pg_catalog.cardinality(p_item_ids) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6850', MESSAGE = 'La selección tiene ítems repetidos, vacíos o excede el máximo.';
    END IF;

    -- 2. Serializa los reintentos del mismo intento: el segundo espera y ve el
    --    pago ya confirmado.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('ept108_intento'),
        pg_catalog.hashtext(v_padre::TEXT || ':' || p_clave_intento::TEXT));

    SELECT p.* INTO v_previo
    FROM public.pagos p
    WHERE p.padre_id = v_padre AND p.clave_intento = p_clave_intento;

    IF FOUND THEN
        IF v_previo.huella_seleccion IS DISTINCT FROM app_private.huella_seleccion_pago(p_item_ids) THEN
            RAISE EXCEPTION USING ERRCODE = 'P6856',
                MESSAGE = 'Este intento ya se registró con otra selección. Generá un intento nuevo.';
        END IF;
        RETURN app_private.pago_a_json(v_previo.id, TRUE);
    END IF;

    -- 3. Selección, vínculo e ítems bajo bloqueo ordenado.
    SELECT * INTO v_a FROM app_private.analizar_seleccion_pago(v_padre, p_item_ids, TRUE);

    IF pg_catalog.round(v_a.total * 100)::BIGINT <> p_total_esperado_centavos THEN
        RAISE EXCEPTION USING ERRCODE = 'P6857',
            MESSAGE = 'El total cambió desde la cotización. Revisá la selección antes de confirmar.';
    END IF;

    -- 4. Pago, imputaciones y reserva: todo o nada.
    BEGIN
        INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, clave_intento, huella_seleccion)
        VALUES (v_padre, v_a.alumno_id, v_a.total, p_clave_intento, v_a.huella)
        RETURNING id INTO v_pago_id;

        INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
        SELECT v_pago_id, i.id, i.alumno_id, i.importe
        FROM public.items_factura i
        WHERE i.id = ANY (p_item_ids);

        UPDATE public.items_factura
        SET estado_pago = 'EN_VERIFICACION'
        WHERE id = ANY (p_item_ids);
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION USING ERRCODE = 'P6853',
                MESSAGE = 'Algún ítem ya está pagado o tiene un pago en verificación.';
    END;

    RETURN app_private.pago_a_json(v_pago_id, FALSE);
END;
$$;

-- 5.3 Resultado de un intento: no escribe. Solo ve los intentos del propio padre.
CREATE FUNCTION app_private.consultar_intento_pago(p_clave_intento UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre UUID;
    v_pago  UUID;
BEGIN
    v_padre := app_private.padre_para_pagos(FALSE);
    IF p_clave_intento IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6850', MESSAGE = 'Falta la clave del intento.';
    END IF;
    -- Si el mismo intento está registrándose en otra transacción, esta consulta espera su desenlace
    -- (mismo consultivo que `registrar_pago`): nunca afirma «no registrado» sobre un intento en vuelo
    -- que ya tomó la guarda. No retiene ninguna otra espera, así que no puede formar un ciclo.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('ept108_intento'),
        pg_catalog.hashtext(v_padre::TEXT || ':' || p_clave_intento::TEXT));
    SELECT p.id INTO v_pago
    FROM public.pagos p
    WHERE p.padre_id = v_padre AND p.clave_intento = p_clave_intento;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('registrado', FALSE);
    END IF;
    RETURN pg_catalog.jsonb_build_object('registrado', TRUE)
           || app_private.pago_a_json(v_pago, TRUE);
END;
$$;

-- 5.4 Datos bancarios para mostrar antes de elegir ítems (M05 los exhibe siempre).
-- Solo una familia habilitada; el resto recibe 42501, igual que las demás operaciones.
CREATE FUNCTION app_private.datos_bancarios_transferencia()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM app_private.padre_para_pagos(FALSE);
    RETURN app_private.datos_bancarios_institucion();
END;
$$;

REVOKE ALL ON FUNCTION app_private.cotizar_pago(UUID[])
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.registrar_pago(UUID, UUID[], BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_intento_pago(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.datos_bancarios_transferencia()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.cotizar_pago(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.registrar_pago(UUID, UUID[], BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_intento_pago(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.datos_bancarios_transferencia() TO authenticated;


-- ================================================================
-- 6. ENVOLTORIOS PÚBLICOS (SECURITY INVOKER)
-- ================================================================
CREATE FUNCTION public.cotizar_pago(p_item_ids UUID[])
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT app_private.cotizar_pago(p_item_ids); $$;

CREATE FUNCTION public.registrar_pago(
    p_clave_intento UUID, p_item_ids UUID[], p_total_esperado_centavos BIGINT)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT app_private.registrar_pago(p_clave_intento, p_item_ids, p_total_esperado_centavos); $$;

CREATE FUNCTION public.consultar_intento_pago(p_clave_intento UUID)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT app_private.consultar_intento_pago(p_clave_intento); $$;

CREATE FUNCTION public.datos_bancarios_transferencia()
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT app_private.datos_bancarios_transferencia(); $$;

REVOKE ALL ON FUNCTION public.cotizar_pago(UUID[])
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.registrar_pago(UUID, UUID[], BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_intento_pago(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.datos_bancarios_transferencia()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cotizar_pago(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago(UUID, UUID[], BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_intento_pago(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.datos_bancarios_transferencia() TO authenticated;

COMMENT ON FUNCTION public.cotizar_pago(UUID[]) IS
    'EPT-108. Cotiza la selección de ítems de UN hijo vinculado: total en centavos calculado por el servidor y datos bancarios ficticios. Sin efectos ni reserva.';
COMMENT ON FUNCTION public.registrar_pago(UUID, UUID[], BIGINT) IS
    'EPT-108. Registra de forma atómica un pago PENDIENTE_VERIFICACION con sus imputaciones y reserva los ítems (EN_VERIFICACION). Idempotente por (padre, clave de intento). El saldo no baja hasta la aprobación.';
COMMENT ON FUNCTION public.datos_bancarios_transferencia() IS
    'EPT-143. Datos bancarios institucionales FICTICIOS para la transferencia, solo para una familia habilitada.';
COMMENT ON FUNCTION public.consultar_intento_pago(UUID) IS
    'EPT-108. Resultado durable de un intento del propio padre; no escribe. Resuelve una respuesta perdida después del COMMIT.';


-- ================================================================
-- 7. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_firma  pg_catalog.regprocedure;
    v_fuente TEXT;
BEGIN
    FOREACH v_firma IN ARRAY ARRAY[
        'public.cotizar_pago(uuid[])'::pg_catalog.regprocedure,
        'public.registrar_pago(uuid,uuid[],bigint)'::pg_catalog.regprocedure,
        'public.consultar_intento_pago(uuid)'::pg_catalog.regprocedure,
        'public.datos_bancarios_transferencia()'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-108: el envoltorio % no es SECURITY INVOKER solo para authenticated.', v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.padre_para_pagos(boolean)'::pg_catalog.regprocedure,
        'app_private.analizar_seleccion_pago(uuid,uuid[],boolean)'::pg_catalog.regprocedure,
        'app_private.huella_seleccion_pago(uuid[])'::pg_catalog.regprocedure,
        'app_private.pago_a_json(uuid,boolean)'::pg_catalog.regprocedure,
        'app_private.datos_bancarios_institucion()'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-108: el auxiliar % no debe tener EXECUTE para roles de aplicación.', v_firma;
        END IF;
    END LOOP;

    SELECT p.prosrc INTO v_fuente FROM pg_catalog.pg_proc p
    WHERE p.oid = 'app_private.padre_para_pagos(boolean)'::pg_catalog.regprocedure;
    IF v_fuente !~ 'FOR SHARE OF p' OR v_fuente ~* 'KEY SHARE' THEN
        RAISE EXCEPTION 'EPT-108: la guarda debe usar FOR SHARE (no FOR KEY SHARE) sobre el perfil.';
    END IF;

    SELECT p.prosrc INTO v_fuente FROM pg_catalog.pg_proc p
    WHERE p.oid = 'app_private.registrar_pago(uuid,uuid[],bigint)'::pg_catalog.regprocedure;
    IF pg_catalog.strpos(v_fuente, 'padre_para_pagos(TRUE)') = 0
       OR pg_catalog.strpos(v_fuente, 'padre_para_pagos(TRUE)') > pg_catalog.strpos(v_fuente, 'pg_advisory_xact_lock')
       OR pg_catalog.strpos(v_fuente, 'pg_advisory_xact_lock') > pg_catalog.strpos(v_fuente, 'analizar_seleccion_pago') THEN
        RAISE EXCEPTION 'EPT-108: registrar_pago debe tomar la guarda antes de cualquier espera.';
    END IF;

    IF pg_catalog.has_table_privilege('anon', 'public.pagos', 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.pagos', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.pagos', 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.imputaciones_pago', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.items_factura', 'UPDATE') THEN
        RAISE EXCEPTION 'EPT-108: un rol de aplicación obtuvo escritura directa sobre el módulo económico.';
    END IF;
END $$;
