-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-103 (corrección)
-- Autorización transaccional de las operaciones de tarifas
-- ============================================================
--
-- DEFECTO QUE CORRIGE
--   `crear_tarifa`, `cambiar_tarifa` y `actualizar_tarifa` (migración
--   20261006002724) leían el rol del actor con `app_private.es_director()`, que es
--   una lectura SIN bloqueo sobre `public.perfiles`, y después podían esperar: el
--   bloqueo consultivo de la referencia, el `FOR UPDATE` de la fila de la tarifa o,
--   en el alta, la clave foránea o la exclusión de vigencia. Una revocación (bloqueo
--   de la cuenta o cambio de rol) que se confirmaba DURANTE esa espera no se veía:
--   la operación escribía con una autorización leída antes. Reproducido en local
--   con las tres operaciones sobre la base de `origin/main` a6c4527: bloqueo y
--   degradación a PERSONAL, 4 de 4 escrituras indebidas en `cambiar` y
--   `actualizar`. La relectura que la migración original ponía después del
--   consultivo tampoco cubría la espera de la fila ni la del alta.
--
-- CONTRATO (decisión aprobada por el usuario el 06/10/2026)
--   Cada operación toma `FOR SHARE` sobre la fila del perfil del actor ANTES de
--   cualquier otra lectura o espera, valida ahí el rol y el acceso con el estado
--   fresco y conserva ese bloqueo hasta COMMIT o ROLLBACK de la transacción que la
--   invocó. Por eso solo hay dos órdenes seriales posibles:
--
--     1. La revocación confirma antes de que la operación adquiera la guarda: la
--        operación se rechaza con 42501 y no escribe nada.
--     2. La operación adquiere la guarda primero: el UPDATE de la revocación
--        ESPERA hasta el fin de esa transacción. La operación puede terminar
--        mientras seguía autorizada y la revocación confirma después.
--
--   No existe un tercer orden: no hay confirmación de una revocación seguida de
--   una escritura autorizada por una lectura vieja.
--
--   Tradeoff aceptado: una revocación concurrente puede esperar a que termine una
--   operación que ya estaba autorizada. No se promete un corte instantáneo que
--   anule transacciones en curso.
--
--   Consecuencia de esa espera, también aceptada: `cambiar_rol_perfil` y
--   `cambiar_acceso_perfil` (EPT-59) toman el consultivo global 59001 ANTES del
--   FOR UPDATE del perfil. Una revocación que espera la guarda de una operación de
--   tarifas retiene 59001 durante la espera, y mientras tanto todo cambio de rol o de
--   acceso de CUALQUIER persona queda encolado detrás. La duración está acotada por
--   la de esa operación, que a su vez puede esperar el consultivo de la referencia o
--   una fila de tarifa. No hay ciclo; EPT-59 no se modifica.
--   Además, cualquier UPDATE de columnas no clave del perfil de un DIRECTOR (por
--   ejemplo el nombre) se serializa del mismo modo con sus operaciones de tarifas.
--
-- QUÉ PROTEGE EL BLOQUEO
--   `FOR SHARE` entra en conflicto con el UPDATE ordinario (FOR NO KEY UPDATE) de
--   los campos que no son clave: `rol_id` y `estado_acceso`, que son los que
--   deciden la autorización. `FOR KEY SHARE` NO sirve: es compatible con ese
--   UPDATE y dejaría pasar la revocación. Dos transacciones del mismo DIRECTOR
--   comparten la guarda (FOR SHARE es compatible con FOR SHARE): no hay una
--   serialización global, solo la que ya existía por referencia de tarifa.
--   El nombre del rol se lee de `public.roles` después de bloquear el perfil. Esa
--   tabla es de solo lectura para clientes (migración 004); se asume inmutable
--   para la aplicación y no se bloquea: bloquearla sería serializar todo el
--   catálogo por un dato que no cambia. Tampoco hay protección frente al
--   propietario de las tablas ni a `service_role`, que omiten RLS por diseño.
--   `auth.users` no interviene: `es_director()` tampoco la consultaba.
--
-- ORDEN DE BLOQUEOS
--     perfil del actor (FOR SHARE)
--       -> bloqueo consultivo de la referencia de tarifa
--       -> filas de tarifa / FK / exclusión
--   Se revisaron los caminos reales: `cambiar_acceso_perfil` y `cambiar_rol_perfil`
--   (EPT-59) toman consultivo 59001 -> ficha de profesor -> perfil FOR UPDATE; no
--   toman ningún bloqueo de tarifas ni se esperan desde ellas, así que no forman
--   ciclo. La inserción de un ítem de factura solo toma FOR SHARE sobre la fila de
--   la tarifa (EPT-100) y no toca el perfil del actor. El autocambio (un DIRECTOR
--   sobre su propio perfil) lo rechazan esas RPC. No se mezcla con 59001.
--
-- ALCANCE
--   Reemplaza únicamente los TRES cuerpos privados y agrega UN auxiliar privado.
--   No cambia firmas, propietarios, EXECUTE, envoltorios públicos, auxiliares
--   existentes, reglas de importe/vigencia/conflicto/exclusión/sucesión, tablas,
--   columnas, triggers ni datos. La migración original no se edita.
--
-- REVERSIÓN
--   No existe una reversión segura automática: los cuerpos de la migración
--   20261006002724 reintroducen la carrera descrita arriba. Una reversión futura
--   exige evaluación y revisión explícitas; no la apliques como si fuera inocua.
--   El auxiliar nuevo no guarda datos y puede soltarse solo después de reemplazar
--   los tres cuerpos que lo invocan:
--     DROP FUNCTION app_private.exigir_director_tarifas();
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y FOTO DE PRIVILEGIOS
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regprocedure('app_private.crear_tarifa(text,integer,uuid,uuid,text,date,date)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.cambiar_tarifa(text,integer,uuid,uuid,text,date,date)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.actualizar_tarifa(uuid,text,date,date,text,date,date)') IS NULL
       OR pg_catalog.to_regprocedure('public.crear_tarifa(text,integer,uuid,uuid,text,date,date)') IS NULL
       OR pg_catalog.to_regprocedure('public.cambiar_tarifa(text,integer,uuid,uuid,text,date,date)') IS NULL
       OR pg_catalog.to_regprocedure('public.actualizar_tarifa(uuid,text,date,date,text,date,date)') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-103 (autorización): faltan las operaciones de tarifas de la migración 20261006002724.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.exigir_director_tarifas()') IS NOT NULL THEN
        RAISE EXCEPTION
            'Migración EPT-103 (autorización): ya existe app_private.exigir_director_tarifas(); revisá el estado de la base.';
    END IF;

    IF pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
       OR pg_catalog.to_regclass('public.tarifas') IS NULL
    THEN
        RAISE EXCEPTION 'Migración EPT-103 (autorización): faltan tablas base.';
    END IF;
END $$;

-- Foto de propietario, ACL, tipo de ejecución y configuración de las seis
-- operaciones y de los auxiliares: CREATE OR REPLACE debe conservarlas tal cual.
CREATE TEMPORARY TABLE ept_103_aut_funciones_iniciales (
    firma  TEXT NOT NULL,
    huella TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_103_aut_funciones_iniciales (firma, huella)
SELECT p.oid::pg_catalog.regprocedure::TEXT,
       pg_catalog.concat_ws('|', p.proowner::TEXT, p.proacl::TEXT, p.prosecdef::TEXT,
                            p.provolatile::TEXT, p.prolang::TEXT,
                            COALESCE(p.proconfig::TEXT, ''), p.prorettype::TEXT,
                            p.proargtypes::TEXT)
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'app_private')
  AND p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa',
                    'importe_tarifa_valido', 'vigencia_tarifa_valida',
                    'referencia_tarifa_valida', 'bloquear_referencia_tarifa',
                    'tarifa_a_json');

-- Esta migración no escribe ninguna fila: se compara al final por cantidad y huella.
CREATE TEMPORARY TABLE ept_103_aut_tarifas_iniciales (
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_103_aut_tarifas_iniciales (cantidad, huella)
SELECT pg_catalog.count(*),
       pg_catalog.md5(COALESCE(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, concepto, nivel_id, deporte_id, servicio_id,
                                importe, desde, hasta, creada_en),
           ';' ORDER BY id), ''))
FROM public.tarifas;


-- ================================================================
-- 2. GUARDA DE AUTORIZACIÓN (sin EXECUTE para ningún rol de aplicación)
-- ================================================================
-- Sin parámetros: la identidad sale de `auth.uid()`, nunca del llamador. VOLATILE
-- porque toma un bloqueo de fila; ni STABLE ni IMMUTABLE. DEFINER con search_path
-- vacío y referencias calificadas; la invocan los cuerpos DEFINER, que corren como
-- propietario, por eso ningún rol de aplicación necesita EXECUTE.
CREATE OR REPLACE FUNCTION app_private.exigir_director_tarifas()
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_usuario UUID;
    v_rol_id  INTEGER;
    v_acceso  public.estado_acceso;
    v_rol     TEXT;
BEGIN
    v_usuario := (SELECT auth.uid());

    IF v_usuario IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    -- FOR SHARE y no su variante de clave: solo el primero choca con el UPDATE ordinario de
    -- `rol_id` y `estado_acceso`. Si una revocación está en curso, esta lectura espera
    -- a que confirme y devuelve el estado NUEVO; si confirmó antes, también.
    -- Si el actor no tiene perfil (incluido `user_id` NULL, que nunca coincide), no
    -- hay fila que bloquear y se rechaza.
    SELECT p.rol_id, p.estado_acceso
    INTO v_rol_id, v_acceso
    FROM public.perfiles p
    WHERE p.user_id = v_usuario
    FOR SHARE OF p;

    IF NOT FOUND OR v_acceso IS DISTINCT FROM 'HABILITADO' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;

    -- El rol se resuelve DESPUÉS del bloqueo, con el `rol_id` fresco.
    SELECT r.nombre INTO v_rol
    FROM public.roles r
    WHERE r.id = v_rol_id;

    IF v_rol IS DISTINCT FROM 'DIRECTOR' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_private.exigir_director_tarifas()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION app_private.exigir_director_tarifas() IS
    'EPT-103. Guarda de las operaciones de tarifas: toma FOR SHARE sobre el perfil del actor, valida DIRECTOR HABILITADO con el estado fresco y conserva el bloqueo hasta el fin de la transacción. Sin parámetros; la identidad sale de auth.uid().';


-- ================================================================
-- 3. OPERACIONES PRIVILEGIADAS (mismas firmas; solo cambia la autorización)
-- ================================================================

-- 3.1 Alta de una versión de tarifa.
CREATE OR REPLACE FUNCTION app_private.crear_tarifa(
    p_concepto    TEXT,
    p_nivel_id    INTEGER,
    p_deporte_id  UUID,
    p_servicio_id UUID,
    p_importe     TEXT,
    p_desde       DATE,
    p_hasta       DATE
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_concepto public.concepto_economico;
    v_importe  NUMERIC(12,2);
    v_tarifa   public.tarifas;
BEGIN
    -- Primero la guarda: identidad, rol y acceso bajo FOR SHARE del perfil, retenido
    -- hasta el fin de la transacción. Todo lo que puede esperar (consultivo, FK,
    -- exclusión) ocurre después, con la autorización ya protegida.
    PERFORM app_private.exigir_director_tarifas();

    v_concepto := app_private.referencia_tarifa_valida(
        p_concepto, p_nivel_id, p_deporte_id, p_servicio_id);
    v_importe := app_private.importe_tarifa_valido(p_importe);
    PERFORM app_private.vigencia_tarifa_valida(p_desde, p_hasta);

    PERFORM app_private.bloquear_referencia_tarifa(
        v_concepto, p_nivel_id, p_deporte_id, p_servicio_id);

    BEGIN
        INSERT INTO public.tarifas (concepto, nivel_id, deporte_id, servicio_id, importe, desde, hasta)
        VALUES (v_concepto, p_nivel_id, p_deporte_id, p_servicio_id, v_importe, p_desde, p_hasta)
        RETURNING * INTO v_tarifa;
    EXCEPTION
        WHEN exclusion_violation THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P6830',
                MESSAGE = 'La vigencia se superpone con otra tarifa de la misma referencia.';
        WHEN foreign_key_violation THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P6824',
                MESSAGE = 'La referencia de la tarifa no existe.';
    END;

    RETURN app_private.tarifa_a_json(v_tarifa);
END;
$$;

-- 3.2 Sucesión atómica de versiones: cierra la vigente el día anterior y abre la nueva.
CREATE OR REPLACE FUNCTION app_private.cambiar_tarifa(
    p_concepto    TEXT,
    p_nivel_id    INTEGER,
    p_deporte_id  UUID,
    p_servicio_id UUID,
    p_importe     TEXT,
    p_desde       DATE,
    p_hasta       DATE
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_concepto public.concepto_economico;
    v_importe  NUMERIC(12,2);
    v_anterior public.tarifas;
    v_nueva    public.tarifas;
BEGIN
    PERFORM app_private.exigir_director_tarifas();

    v_concepto := app_private.referencia_tarifa_valida(
        p_concepto, p_nivel_id, p_deporte_id, p_servicio_id);
    v_importe := app_private.importe_tarifa_valido(p_importe);
    PERFORM app_private.vigencia_tarifa_valida(p_desde, p_hasta);

    -- Desde acá la referencia está serializada: lo que se lee no cambia hasta el commit.
    -- La autorización no necesita releerse: el perfil del actor sigue bloqueado.
    PERFORM app_private.bloquear_referencia_tarifa(
        v_concepto, p_nivel_id, p_deporte_id, p_servicio_id);

    -- Versión que estaba vigente el día anterior al cambio. Si terminó antes,
    -- hay un hueco ya existente que esta operación no inventa ni rellena.
    SELECT t.* INTO v_anterior
    FROM public.tarifas t
    WHERE t.concepto = v_concepto
      AND t.nivel_id IS NOT DISTINCT FROM p_nivel_id
      AND t.deporte_id IS NOT DISTINCT FROM p_deporte_id
      AND t.servicio_id IS NOT DISTINCT FROM p_servicio_id
      AND t.desde < p_desde
      AND (t.hasta IS NULL OR t.hasta >= p_desde - 1)
    ORDER BY t.desde DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND (v_anterior.hasta IS NULL OR v_anterior.hasta >= p_desde) THEN
        -- La anterior sigue en vigor el día del cambio: se acorta a D-1. Si tenía
        -- un fin propio posterior, la nueva debe cubrirlo; si no, quedaría sin
        -- tarifa un tramo que hoy sí tiene.
        -- Anterior abierta (hasta NULL) y nueva con fin: el tramo posterior quedaría sin
        -- tarifa para siempre (la exclusión impide que exista otra versión después).
        IF p_hasta IS NOT NULL
           AND (v_anterior.hasta IS NULL OR p_hasta < v_anterior.hasta) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P6833',
                MESSAGE = 'El cambio dejaría sin tarifa un tramo que hoy está cubierto. Dejá «hasta» vacío o usá una fecha igual o posterior al fin de la tarifa vigente.';
        END IF;

        UPDATE public.tarifas
        SET hasta = p_desde - 1
        WHERE id = v_anterior.id
        RETURNING * INTO v_anterior;
    END IF;

    BEGIN
        INSERT INTO public.tarifas (concepto, nivel_id, deporte_id, servicio_id, importe, desde, hasta)
        VALUES (v_concepto, p_nivel_id, p_deporte_id, p_servicio_id, v_importe, p_desde, p_hasta)
        RETURNING * INTO v_nueva;
    EXCEPTION
        WHEN exclusion_violation THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P6830',
                MESSAGE = 'La vigencia se superpone con otra tarifa de la misma referencia.';
        WHEN foreign_key_violation THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P6824',
                MESSAGE = 'La referencia de la tarifa no existe.';
    END;

    RETURN pg_catalog.jsonb_build_object(
        'anterior', CASE WHEN v_anterior.id IS NULL THEN NULL
                         ELSE app_private.tarifa_a_json(v_anterior) END,
        'nueva', app_private.tarifa_a_json(v_nueva)
    );
END;
$$;

-- 3.3 Corrección de una versión existente, con control de edición concurrente.
CREATE OR REPLACE FUNCTION app_private.actualizar_tarifa(
    p_tarifa_id      UUID,
    p_importe        TEXT,
    p_desde          DATE,
    p_hasta          DATE,
    p_importe_previo TEXT,
    p_desde_previo   DATE,
    p_hasta_previo   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_importe          NUMERIC(12,2);
    v_importe_previo   NUMERIC(12,2);
    v_tarifa           public.tarifas;
BEGIN
    PERFORM app_private.exigir_director_tarifas();

    IF p_tarifa_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6832', MESSAGE = 'La tarifa solicitada no existe.';
    END IF;

    v_importe := app_private.importe_tarifa_valido(p_importe);
    v_importe_previo := app_private.importe_tarifa_valido(p_importe_previo);
    PERFORM app_private.vigencia_tarifa_valida(p_desde, p_hasta);

    -- Lectura sin bloqueo para conocer la referencia y poder serializarla.
    SELECT t.* INTO v_tarifa FROM public.tarifas t WHERE t.id = p_tarifa_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6832', MESSAGE = 'La tarifa solicitada no existe.';
    END IF;

    PERFORM app_private.bloquear_referencia_tarifa(
        v_tarifa.concepto, v_tarifa.nivel_id, v_tarifa.deporte_id, v_tarifa.servicio_id);

    -- Relectura ya bajo el bloqueo y con la fila tomada: es el estado que se compara.
    -- La espera de esta fila ya no puede perder la autorización: la guarda sigue viva.
    SELECT t.* INTO v_tarifa FROM public.tarifas t WHERE t.id = p_tarifa_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6832', MESSAGE = 'La tarifa solicitada no existe.';
    END IF;

    IF v_tarifa.importe IS DISTINCT FROM v_importe_previo
       OR v_tarifa.desde IS DISTINCT FROM p_desde_previo
       OR v_tarifa.hasta IS DISTINCT FROM p_hasta_previo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6831',
            MESSAGE = 'La tarifa fue modificada por otra persona. Recargá la pantalla y revisá los valores actuales antes de volver a guardar.';
    END IF;

    -- Sin cambios: se devuelve la fila tal cual, sin escribirla.
    IF v_tarifa.importe = v_importe
       AND v_tarifa.desde = p_desde
       AND v_tarifa.hasta IS NOT DISTINCT FROM p_hasta THEN
        RETURN app_private.tarifa_a_json(v_tarifa);
    END IF;

    BEGIN
        UPDATE public.tarifas
        SET importe = v_importe,
            desde = p_desde,
            hasta = p_hasta
        WHERE id = p_tarifa_id
        RETURNING * INTO v_tarifa;
    EXCEPTION
        WHEN exclusion_violation THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P6830',
                MESSAGE = 'La vigencia se superpone con otra tarifa de la misma referencia.';
    END;

    RETURN app_private.tarifa_a_json(v_tarifa);
END;
$$;


-- ================================================================
-- 4. AUTOVERIFICACIÓN
-- ================================================================
-- Si CREATE OR REPLACE hubiera alterado un privilegio, un propietario o una firma, o
-- un cuerpo hubiera quedado sin la guarda, la migración falla en lugar de dejarlo así.
DO $$
DECLARE
    v_firma    pg_catalog.regprocedure;
    v_huella   TEXT;
    v_cantidad BIGINT;
    v_inicial  RECORD;
    v_actual   TEXT;
    v_fuente   TEXT;
BEGIN
    -- 4.1 Ninguna fila cambió.
    SELECT pg_catalog.count(*),
           pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, concepto, nivel_id, deporte_id, servicio_id,
                                    importe, desde, hasta, creada_en),
               ';' ORDER BY id), ''))
    INTO v_cantidad, v_huella
    FROM public.tarifas;
    IF v_cantidad <> (SELECT cantidad FROM ept_103_aut_tarifas_iniciales)
       OR v_huella <> (SELECT huella FROM ept_103_aut_tarifas_iniciales) THEN
        RAISE EXCEPTION 'Autoverificación EPT-103 (autorización): cambió el contenido de public.tarifas.';
    END IF;

    -- 4.2 Propietario, ACL, tipo, volatilidad y configuración de las 11 funciones previas.
    FOR v_inicial IN SELECT firma, huella FROM ept_103_aut_funciones_iniciales LOOP
        SELECT pg_catalog.concat_ws('|', p.proowner::TEXT, p.proacl::TEXT, p.prosecdef::TEXT,
                                    p.provolatile::TEXT, p.prolang::TEXT,
                                    COALESCE(p.proconfig::TEXT, ''), p.prorettype::TEXT,
                                    p.proargtypes::TEXT)
        INTO v_actual
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_inicial.firma::pg_catalog.regprocedure;

        IF v_actual IS DISTINCT FROM v_inicial.huella THEN
            RAISE EXCEPTION 'Autoverificación EPT-103 (autorización): cambiaron privilegios, propietario o definición de %.', v_inicial.firma;
        END IF;
    END LOOP;

    IF (SELECT pg_catalog.count(*) FROM ept_103_aut_funciones_iniciales) <> 11 THEN
        RAISE EXCEPTION 'Autoverificación EPT-103 (autorización): se esperaban 11 funciones previas.';
    END IF;

    -- 4.3 Guarda: DEFINER, VOLATILE, search_path vacío, sin parámetros y sin EXECUTE para nadie.
    v_firma := 'app_private.exigir_director_tarifas()'::pg_catalog.regprocedure;
    IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
       OR (SELECT provolatile FROM pg_catalog.pg_proc WHERE oid = v_firma) <> 'v'
       OR (SELECT pronargs FROM pg_catalog.pg_proc WHERE oid = v_firma) <> 0
       OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
              IS DISTINCT FROM ARRAY['search_path=""']
       OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, ARRAY[]::pg_catalog.aclitem[])) a
            WHERE p.oid = v_firma AND a.grantee = 0)
    THEN
        RAISE EXCEPTION 'Autoverificación EPT-103 (autorización): la guarda no es DEFINER VOLATILE sin parámetros, con search_path vacío y sin EXECUTE de aplicación.';
    END IF;

    SELECT p.prosrc INTO v_fuente FROM pg_catalog.pg_proc p WHERE p.oid = v_firma;
    IF v_fuente !~ 'FOR SHARE OF p' OR v_fuente ~* 'KEY SHARE' THEN
        RAISE EXCEPTION 'Autoverificación EPT-103 (autorización): la guarda debe usar FOR SHARE (no FOR KEY SHARE) sobre el perfil.';
    END IF;

    -- 4.4 Cada operación privada invoca la guarda y ya no lee el rol sin bloqueo.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.crear_tarifa(text,integer,uuid,uuid,text,date,date)'::pg_catalog.regprocedure,
        'app_private.cambiar_tarifa(text,integer,uuid,uuid,text,date,date)'::pg_catalog.regprocedure,
        'app_private.actualizar_tarifa(uuid,text,date,date,text,date,date)'::pg_catalog.regprocedure
    ] LOOP
        SELECT p.prosrc INTO v_fuente FROM pg_catalog.pg_proc p WHERE p.oid = v_firma;
        IF v_fuente !~ 'PERFORM app_private\.exigir_director_tarifas\(\)'
           OR v_fuente ~* 'es_director'
           OR pg_catalog.strpos(v_fuente, 'exigir_director_tarifas')
              > pg_catalog.strpos(v_fuente, 'bloquear_referencia_tarifa')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
        THEN
            RAISE EXCEPTION 'Autoverificación EPT-103 (autorización): % no invoca la guarda antes de esperar, conserva es_director() o cambió su EXECUTE.', v_firma;
        END IF;
    END LOOP;

    RAISE NOTICE
        'Migración EPT-103 (autorización): guarda FOR SHARE instalada en 3 operaciones; % tarifa(s) preservadas sin cambios.',
        v_cantidad;
END $$;
