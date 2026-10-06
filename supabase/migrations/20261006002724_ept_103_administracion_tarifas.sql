-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-103 (P3-WU-FEE1)
-- Administración de tarifas mensuales por Dirección
-- ============================================================
--
-- QUÉ AGREGA
--   Tres operaciones de escritura sobre `public.tarifas`, ejecutables solo por un
--   DIRECTOR habilitado, y nada más: sin tablas, columnas, triggers ni datos
--   nuevos, sin tocar las 34 migraciones anteriores y sin ningún GRANT de
--   escritura sobre las tablas (EPT-101 dejó la lectura solo para DIRECTOR y la
--   escritura directa cerrada; eso se conserva).
--
--     crear_tarifa(concepto, nivel, deporte, servicio, importe, desde, hasta)
--         Alta de UNA versión de tarifa. Estricta: si se superpone con otra
--         versión de la misma referencia, se rechaza (P6830).
--     cambiar_tarifa(concepto, nivel, deporte, servicio, importe, desde, hasta)
--         Sucesión atómica: «el día D el precio pasa a X». Cierra la versión
--         vigente el día anterior (hasta = D-1) e inserta la nueva (desde = D)
--         dentro de la misma transacción. Un rechazo no deja nada persistido.
--     actualizar_tarifa(id, importe, desde, hasta, importe_previo, desde_previo,
--                       hasta_previo)
--         Corrige el importe y la vigencia de una versión existente. Concepto y
--         referencia no se reciben: son la identidad de la tarifa. Exige los
--         valores que quien edita vio (previos); si otra persona la cambió en
--         el medio, se rechaza (P6831) en lugar de sobrescribir en silencio.
--
-- AUTORIDAD
--   La identidad sale de `auth.uid()` y el rol y el bloqueo, del perfil VIGENTE en
--   la base (`app_private.es_director()`, que exige estado HABILITADO). Ninguna
--   operación recibe actor, rol ni usuario, y `user_metadata` no interviene. Un
--   JWT emitido antes de un bloqueo o de un cambio de rol queda sin efecto.
--   Patrón de 012/014/EPT-61: implementación `SECURITY DEFINER` en `app_private`
--   (esquema que la Data API no expone) con `search_path = ''`; envoltorio
--   `SECURITY INVOKER` en `public` que solo delega. `service_role` tampoco
--   ejecuta: estas operaciones dependen de la sesión de un DIRECTOR.
--
--   EXECUTE mínimo y comprobado:
--     · `app_private.crear_tarifa`, `.cambiar_tarifa` y `.actualizar_tarifa`: solo
--       `authenticated`, porque el envoltorio INVOKER las ejecuta con el rol de
--       quien llama. Cada una vuelve a validar identidad y rol por dentro.
--     · Los auxiliares (`importe_tarifa_valido`, `vigencia_tarifa_valida`,
--       `referencia_tarifa_valida`, `bloquear_referencia_tarifa`, `tarifa_a_json`)
--       NO tienen EXECUTE para nadie: los invoca el cuerpo de las operaciones
--       DEFINER, que corre como propietario. Conceder más sería superficie sin uso.
--     · `public.*`: solo `authenticated`.
--
-- CONTRATO MONETARIO (decisión técnica documentada)
--   La columna es NUMERIC(12,2) y PostgreSQL REDONDEA al imponer la escala:
--   `10.005::NUMERIC(12,2)` da 10.01 antes de que corra cualquier CHECK. Por eso el
--   importe llega como TEXTO canónico y se valida ANTES del cast. No se usa
--   NUMERIC sin typmod: PostgREST y los clientes JSON lo entregan como número de
--   doble precisión, y la validación exacta del dígito 3.er decimal ya no sería
--   posible. Formato aceptado, y solo ese:
--       ^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$
--   es decir, ASCII, punto decimal, hasta 10 dígitos enteros y hasta 2 decimales,
--   sin signo, sin separador de miles, sin espacios, sin exponente. Cero es válido
--   (el esquema aprobado permite importe >= 0). La normalización de la coma
--   decimal y los espacios ocurre en el servidor de la aplicación, no acá.
--   Máximo representable: 9999999999.99.
--
-- CONTRATO DE VIGENCIA
--   Cerrado e inclusivo [desde, hasta]; `hasta` NULL = sin fin. Fechas finitas
--   (`infinity`/`-infinity` se rechazan) y `hasta >= desde`. Dos versiones de la
--   misma referencia no comparten ningún día: lo garantizan las tres restricciones
--   de exclusión de EPT-100, que deciden también las carreras. Un cambio el día D
--   deja la anterior terminando en D-1 y la nueva empezando en D.
--
-- CONCURRENCIA
--   Cada operación toma primero un bloqueo consultivo transaccional por
--   (concepto, referencia): serializa las escrituras de una misma referencia, de
--   modo que `cambiar_tarifa` (leer la versión vigente, acortarla, insertar) decide
--   sobre un estado estable. Es un bloqueo por referencia, no global: referencias
--   distintas no se esperan. La restricción de exclusión sigue siendo la garantía
--   de fondo si algún proceso privilegiado escribiera sin este bloqueo. Orden de
--   bloqueos: consultivo -> fila de la tarifa. La inserción de un ítem de factura
--   (EPT-100) solo toma FOR SHARE sobre la fila de la tarifa, así que no forma
--   ciclo con estas operaciones.
--
-- ROLES PRIVILEGIADOS
--   Los privilegios por defecto de la plataforma dejan a `service_role` (y al
--   propietario) con escritura directa sobre `public.tarifas`: es un hecho de
--   plataforma, no una regresión, y ese rol omite RLS por diseño. La aplicación no
--   lo usa para tarifas. Las verificaciones de esta migración y sus pruebas cubren
--   `anon` y `authenticated`, que son los roles de cliente.
--
-- HISTÓRICO ECONÓMICO
--   Estas operaciones escriben únicamente `public.tarifas` y solo las columnas
--   `importe`, `desde` y `hasta` (más el alta). No tocan `items_factura`,
--   `facturas`, pagos ni imputaciones. `items_factura.importe` es lo facturado y no
--   se recalcula. El trigger P6804 de EPT-100 sigue impidiendo cambiar concepto y
--   referencia de una tarifa ya facturada; NO congela su importe ni su vigencia,
--   y esta migración no promete una regla de retroactividad más fuerte que esa.
--
-- CÓDIGOS SQLSTATE PROPIOS (bloque nuevo P681x–P683x; EPT-100 usa P6801–P6804)
--   P6810  importe ausente o con formato no soportado (NaN, Infinity, exponente,
--          coma, espacios, ceros a la izquierda, separadores de miles)
--   P6811  importe negativo
--   P6812  importe con más de dos decimales (no se redondea)
--   P6813  importe fuera de capacidad (más de 10 dígitos enteros)
--   P6820  falta la fecha de inicio
--   P6821  fecha no finita (infinity / -infinity) o fuera de los años 1900 a 9999
--   P6822  la fecha de fin es anterior a la de inicio
--   P6823  concepto inválido o referencia inconsistente con el concepto
--   P6824  la referencia (nivel, deporte o servicio) no existe
--   P6830  la vigencia se superpone con otra versión de la misma referencia
--   P6831  conflicto de edición: la tarifa cambió desde que se leyó
--   P6832  la tarifa no existe
--   P6833  el cambio dejaría un tramo de la versión anterior sin tarifa
--   Reutilizados: P5505 (identidad ausente), 42501 (no es DIRECTOR habilitado) y
--   P6801 (servicio de otro tipo que el concepto, trigger de EPT-100).
--
-- REVERSIÓN NO DESTRUCTIVA
--   No crea tablas, columnas ni triggers y no cambia datos: revertirla es soltar
--   sus funciones, sin tocar ninguna fila. Las tarifas ya cargadas con ellas son
--   datos legítimos y permanecen.
--
--     DROP FUNCTION public.crear_tarifa(text, integer, uuid, uuid, text, date, date);
--     DROP FUNCTION public.cambiar_tarifa(text, integer, uuid, uuid, text, date, date);
--     DROP FUNCTION public.actualizar_tarifa(uuid, text, date, date, text, date, date);
--     DROP FUNCTION app_private.crear_tarifa(text, integer, uuid, uuid, text, date, date);
--     DROP FUNCTION app_private.cambiar_tarifa(text, integer, uuid, uuid, text, date, date);
--     DROP FUNCTION app_private.actualizar_tarifa(uuid, text, date, date, text, date, date);
--     DROP FUNCTION app_private.tarifa_a_json(public.tarifas);
--     DROP FUNCTION app_private.bloquear_referencia_tarifa(public.concepto_economico, integer, uuid, uuid);
--     DROP FUNCTION app_private.referencia_tarifa_valida(text, integer, uuid, uuid);
--     DROP FUNCTION app_private.vigencia_tarifa_valida(date, date);
--     DROP FUNCTION app_private.importe_tarifa_valido(text);
--
--   Revertir cambios de contenido ya aplicados exige análisis y respaldo previo.
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.tarifas') IS NULL
       OR pg_catalog.to_regclass('public.items_factura') IS NULL
       OR pg_catalog.to_regclass('public.niveles') IS NULL
       OR pg_catalog.to_regclass('public.deportes') IS NULL
       OR pg_catalog.to_regclass('public.servicios_escolares') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-103: faltan tablas base; la base no corresponde a EPT-100 y EPT-101.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.es_director()') IS NULL THEN
        RAISE EXCEPTION 'Migración EPT-103: falta app_private.es_director().';
    END IF;

    -- Las tres exclusiones de vigencia son la garantía de fondo contra el solapamiento.
    IF (SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'public.tarifas'::pg_catalog.regclass
          AND c.conname IN ('tarifas_sin_solapamiento_nivel',
                            'tarifas_sin_solapamiento_deporte',
                            'tarifas_sin_solapamiento_servicio')) <> 3
    THEN
        RAISE EXCEPTION 'Migración EPT-103: faltan las exclusiones de vigencia de EPT-100.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa')
    ) THEN
        RAISE EXCEPTION
            'Migración EPT-103: ya existen operaciones de tarifas; revisá el estado de la base.';
    END IF;
END $$;

-- Esta migración no escribe ninguna fila: se compara al final por cantidad y huella.
CREATE TEMPORARY TABLE ept_103_tarifas_iniciales (
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_103_tarifas_iniciales (cantidad, huella)
SELECT pg_catalog.count(*),
       pg_catalog.md5(COALESCE(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, concepto, nivel_id, deporte_id, servicio_id,
                                importe, desde, hasta, creada_en),
           ';' ORDER BY id), ''))
FROM public.tarifas;


-- ================================================================
-- 2. AUXILIARES (sin EXECUTE para ningún rol de aplicación)
-- ================================================================

-- 2.1 Importe: valida el TEXTO antes del cast con escala.
CREATE OR REPLACE FUNCTION app_private.importe_tarifa_valido(p_importe TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_enteros  TEXT;
    v_decimales TEXT;
BEGIN
    IF p_importe IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6810', MESSAGE = 'Ingresá el importe de la tarifa.';
    END IF;

    -- Un signo menos delante de un número es un importe negativo, no un formato raro.
    IF p_importe ~ '^-[0-9]+([.][0-9]+)?$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6811', MESSAGE = 'El importe no puede ser negativo.';
    END IF;

    -- Solo dígitos ASCII con un punto decimal opcional entre dígitos. Todo lo demás
    -- (NaN, Infinity, 1e3, 1,5, espacios, +1, 1.) se rechaza sin coerción.
    IF p_importe !~ '^[0-9]+([.][0-9]+)?$' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6810',
            MESSAGE = 'El importe tiene un formato no soportado. Usá solo dígitos y, como máximo, dos decimales.';
    END IF;

    v_enteros := pg_catalog.split_part(p_importe, '.', 1);
    v_decimales := pg_catalog.split_part(p_importe, '.', 2);

    IF pg_catalog.length(v_enteros) > 10 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6813',
            MESSAGE = 'El importe supera el máximo permitido (9999999999,99).';
    END IF;

    IF pg_catalog.length(v_decimales) > 2 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6812',
            MESSAGE = 'El importe admite como máximo dos decimales.';
    END IF;

    IF pg_catalog.length(v_enteros) > 1 AND pg_catalog.left(v_enteros, 1) = '0' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6810',
            MESSAGE = 'El importe tiene un formato no soportado: no uses ceros a la izquierda.';
    END IF;

    -- Ya no puede redondear: a lo sumo dos decimales y diez enteros.
    RETURN p_importe::NUMERIC(12,2);
END;
$$;

-- 2.2 Vigencia: cerrada e inclusiva, fechas finitas.
CREATE OR REPLACE FUNCTION app_private.vigencia_tarifa_valida(p_desde DATE, p_hasta DATE)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF p_desde IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6820', MESSAGE = 'Indicá desde qué fecha rige la tarifa.';
    END IF;

    IF NOT pg_catalog.isfinite(p_desde)
       OR (p_hasta IS NOT NULL AND NOT pg_catalog.isfinite(p_hasta)) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6821',
            MESSAGE = 'Las fechas de vigencia deben ser fechas reales. Para una tarifa sin fin, dejá «hasta» vacío.';
    END IF;

    -- Mismo rango que acepta la aplicación (años 1900 a 9999): fuera de él la fila no
    -- se podría mostrar ni editar, y los extremos del tipo DATE desbordan el rango.
    IF p_desde < DATE '1900-01-01' OR p_desde > DATE '9999-12-31'
       OR (p_hasta IS NOT NULL AND (p_hasta < DATE '1900-01-01' OR p_hasta > DATE '9999-12-31')) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6821',
            MESSAGE = 'Las fechas de vigencia deben estar entre los años 1900 y 9999.';
    END IF;

    IF p_hasta IS NOT NULL AND p_hasta < p_desde THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6822',
            MESSAGE = 'La fecha de fin no puede ser anterior a la de inicio.';
    END IF;
END;
$$;

-- 2.3 Concepto y referencia: exactamente la que corresponde al concepto.
CREATE OR REPLACE FUNCTION app_private.referencia_tarifa_valida(
    p_concepto    TEXT,
    p_nivel_id    INTEGER,
    p_deporte_id  UUID,
    p_servicio_id UUID
)
RETURNS public.concepto_economico
LANGUAGE plpgsql
-- STABLE y no IMMUTABLE: el cast a un tipo enumerado lee el catálogo (`db lint` lo señala).
STABLE
SET search_path = ''
AS $$
BEGIN
    IF p_concepto IS NULL
       OR p_concepto NOT IN ('CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR') THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6823',
            MESSAGE = 'El concepto de la tarifa no es válido.';
    END IF;

    IF (p_concepto = 'CUOTA'
            AND p_nivel_id IS NOT NULL AND p_deporte_id IS NULL AND p_servicio_id IS NULL)
       OR (p_concepto = 'DEPORTE'
            AND p_deporte_id IS NOT NULL AND p_nivel_id IS NULL AND p_servicio_id IS NULL)
       OR (p_concepto IN ('TRANSPORTE', 'COMEDOR')
            AND p_servicio_id IS NOT NULL AND p_nivel_id IS NULL AND p_deporte_id IS NULL)
    THEN
        RETURN p_concepto::public.concepto_economico;
    END IF;

    RAISE EXCEPTION USING
        ERRCODE = 'P6823',
        MESSAGE = 'La referencia no corresponde al concepto: la cuota es por nivel, el deporte por deporte y el transporte y el comedor por servicio.';
END;
$$;

-- 2.4 Bloqueo consultivo por (concepto, referencia), de alcance transaccional.
CREATE OR REPLACE FUNCTION app_private.bloquear_referencia_tarifa(
    p_concepto    public.concepto_economico,
    p_nivel_id    INTEGER,
    p_deporte_id  UUID,
    p_servicio_id UUID
)
RETURNS VOID
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('ept103_tarifas'),
        pg_catalog.hashtext(
            p_concepto::TEXT || ':' ||
            COALESCE(p_nivel_id::TEXT, p_deporte_id::TEXT, p_servicio_id::TEXT)));
$$;

-- 2.5 Fila de tarifa como JSON: el importe viaja como texto, nunca como número de
-- doble precisión.
CREATE OR REPLACE FUNCTION app_private.tarifa_a_json(p_tarifa public.tarifas)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'id', p_tarifa.id,
        'concepto', p_tarifa.concepto,
        'nivel_id', p_tarifa.nivel_id,
        'deporte_id', p_tarifa.deporte_id,
        'servicio_id', p_tarifa.servicio_id,
        'importe', p_tarifa.importe::TEXT,
        'desde', p_tarifa.desde,
        'hasta', p_tarifa.hasta,
        'creada_en', p_tarifa.creada_en
    );
$$;

REVOKE ALL ON FUNCTION app_private.importe_tarifa_valido(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.vigencia_tarifa_valida(DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.referencia_tarifa_valida(TEXT, INTEGER, UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.bloquear_referencia_tarifa(
        public.concepto_economico, INTEGER, UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.tarifa_a_json(public.tarifas)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 3. OPERACIONES PRIVILEGIADAS
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
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;

    v_concepto := app_private.referencia_tarifa_valida(
        p_concepto, p_nivel_id, p_deporte_id, p_servicio_id);
    v_importe := app_private.importe_tarifa_valido(p_importe);
    PERFORM app_private.vigencia_tarifa_valida(p_desde, p_hasta);

    PERFORM app_private.bloquear_referencia_tarifa(
        v_concepto, p_nivel_id, p_deporte_id, p_servicio_id);

    -- La espera del bloqueo puede durar: el rol y el bloqueo de cuenta se vuelven a
    -- comprobar con el estado vigente al despertar, antes de leer o escribir nada.
    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;

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
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;

    v_concepto := app_private.referencia_tarifa_valida(
        p_concepto, p_nivel_id, p_deporte_id, p_servicio_id);
    v_importe := app_private.importe_tarifa_valido(p_importe);
    PERFORM app_private.vigencia_tarifa_valida(p_desde, p_hasta);

    -- Desde acá la referencia está serializada: lo que se lee no cambia hasta el commit.
    PERFORM app_private.bloquear_referencia_tarifa(
        v_concepto, p_nivel_id, p_deporte_id, p_servicio_id);

    -- La espera del bloqueo puede durar: el rol y el bloqueo de cuenta se vuelven a
    -- comprobar con el estado vigente al despertar, antes de leer o escribir nada.
    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;

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
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;

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

    -- La espera del bloqueo puede durar: el rol y el bloqueo de cuenta se vuelven a
    -- comprobar con el estado vigente al despertar, antes de leer o escribir nada.
    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar las tarifas.';
    END IF;

    -- Relectura ya bajo el bloqueo y con la fila tomada: es el estado que se compara.
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

REVOKE ALL ON FUNCTION app_private.crear_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.actualizar_tarifa(UUID, TEXT, DATE, DATE, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;

-- El envoltorio SECURITY INVOKER las ejecuta con el rol de quien llama.
GRANT EXECUTE ON FUNCTION app_private.crear_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.actualizar_tarifa(UUID, TEXT, DATE, DATE, TEXT, DATE, DATE)
    TO authenticated;


-- ================================================================
-- 4. ENVOLTORIOS PÚBLICOS (SECURITY INVOKER)
-- ================================================================
CREATE OR REPLACE FUNCTION public.crear_tarifa(
    p_concepto    TEXT,
    p_nivel_id    INTEGER,
    p_deporte_id  UUID,
    p_servicio_id UUID,
    p_importe     TEXT,
    p_desde       DATE,
    p_hasta       DATE
)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.crear_tarifa(
        p_concepto, p_nivel_id, p_deporte_id, p_servicio_id, p_importe, p_desde, p_hasta);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_tarifa(
    p_concepto    TEXT,
    p_nivel_id    INTEGER,
    p_deporte_id  UUID,
    p_servicio_id UUID,
    p_importe     TEXT,
    p_desde       DATE,
    p_hasta       DATE
)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_tarifa(
        p_concepto, p_nivel_id, p_deporte_id, p_servicio_id, p_importe, p_desde, p_hasta);
$$;

CREATE OR REPLACE FUNCTION public.actualizar_tarifa(
    p_tarifa_id      UUID,
    p_importe        TEXT,
    p_desde          DATE,
    p_hasta          DATE,
    p_importe_previo TEXT,
    p_desde_previo   DATE,
    p_hasta_previo   DATE
)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.actualizar_tarifa(
        p_tarifa_id, p_importe, p_desde, p_hasta, p_importe_previo, p_desde_previo, p_hasta_previo);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones nuevas
-- de `public` a anon: se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.crear_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cambiar_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.actualizar_tarifa(UUID, TEXT, DATE, DATE, TEXT, DATE, DATE)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.crear_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_tarifa(UUID, TEXT, DATE, DATE, TEXT, DATE, DATE)
    TO authenticated;

COMMENT ON FUNCTION public.crear_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE) IS
    'EPT-103. Alta de una versión de tarifa por DIRECTOR habilitado. Importe como texto canónico validado antes del cast (NUMERIC(12,2), >= 0). Vigencia cerrada [desde, hasta]. Rechaza solapamientos (P6830).';
COMMENT ON FUNCTION public.cambiar_tarifa(TEXT, INTEGER, UUID, UUID, TEXT, DATE, DATE) IS
    'EPT-103. Sucesión atómica: cierra la versión vigente en desde-1 e inserta la nueva desde `desde`. Un rechazo no deja nada persistido.';
COMMENT ON FUNCTION public.actualizar_tarifa(UUID, TEXT, DATE, DATE, TEXT, DATE, DATE) IS
    'EPT-103. Corrige importe y vigencia de una versión. Exige los valores previos que vio quien edita; si cambiaron, rechaza (P6831) en vez de sobrescribir. No toca facturas ni ítems.';


-- ================================================================
-- 5. AUTOVERIFICACIÓN
-- ================================================================
-- Si un default de plataforma abriera más de lo aprobado, la migración falla en
-- lugar de dejarlo abierto. No vigila migraciones futuras: eso lo hacen las
-- suites de `supabase/tests`.
DO $$
DECLARE
    v_firma      pg_catalog.regprocedure;
    v_privilegio TEXT;
    v_rol        TEXT;
    v_huella     TEXT;
    v_cantidad   BIGINT;
BEGIN
    -- Ninguna fila cambió.
    SELECT pg_catalog.count(*),
           pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, concepto, nivel_id, deporte_id, servicio_id,
                                    importe, desde, hasta, creada_en),
               ';' ORDER BY id), ''))
    INTO v_cantidad, v_huella
    FROM public.tarifas;
    IF v_cantidad <> (SELECT cantidad FROM ept_103_tarifas_iniciales)
       OR v_huella <> (SELECT huella FROM ept_103_tarifas_iniciales) THEN
        RAISE EXCEPTION 'Autoverificación EPT-103: cambió el contenido de public.tarifas.';
    END IF;

    -- Los roles de aplicación siguen sin escritura directa sobre las tarifas.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_privilegio IN ARRAY ARRAY[
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF pg_catalog.has_table_privilege(v_rol, 'public.tarifas', v_privilegio) THEN
                RAISE EXCEPTION 'Autoverificación EPT-103: % tiene % sobre public.tarifas.',
                    v_rol, v_privilegio;
            END IF;
        END LOOP;
        IF pg_catalog.has_any_column_privilege(v_rol, 'public.tarifas', 'INSERT')
           OR pg_catalog.has_any_column_privilege(v_rol, 'public.tarifas', 'UPDATE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-103: % tiene un grant por columna de escritura sobre public.tarifas.', v_rol;
        END IF;
    END LOOP;

    -- Operaciones privadas: DEFINER con search_path vacío, solo `authenticated`.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.crear_tarifa(text,integer,uuid,uuid,text,date,date)'::pg_catalog.regprocedure,
        'app_private.cambiar_tarifa(text,integer,uuid,uuid,text,date,date)'::pg_catalog.regprocedure,
        'app_private.actualizar_tarifa(uuid,text,date,date,text,date,date)'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación EPT-103: % no es SECURITY DEFINER con search_path vacío o sus privilegios no son los previstos.',
                v_firma;
        END IF;
    END LOOP;

    -- Auxiliares: sin EXECUTE para ningún rol de aplicación.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.importe_tarifa_valido(text)'::pg_catalog.regprocedure,
        'app_private.vigencia_tarifa_valida(date,date)'::pg_catalog.regprocedure,
        'app_private.referencia_tarifa_valida(text,integer,uuid,uuid)'::pg_catalog.regprocedure,
        'app_private.bloquear_referencia_tarifa(public.concepto_economico,integer,uuid,uuid)'::pg_catalog.regprocedure,
        'app_private.tarifa_a_json(public.tarifas)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-103: el auxiliar % tiene EXECUTE para un rol de aplicación o no fija search_path.', v_firma;
        END IF;
    END LOOP;

    -- Envoltorios: SECURITY INVOKER mínimo; ningún SECURITY DEFINER en `public`.
    FOREACH v_firma IN ARRAY ARRAY[
        'public.crear_tarifa(text,integer,uuid,uuid,text,date,date)'::pg_catalog.regprocedure,
        'public.cambiar_tarifa(text,integer,uuid,uuid,text,date,date)'::pg_catalog.regprocedure,
        'public.actualizar_tarifa(uuid,text,date,date,text,date,date)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-103: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna operación acepta identidad, rol ni actor del llamador.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa')
          AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                 OR nombre ILIKE '%actor%' OR nombre ILIKE '%perfil%'
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-103: una operación acepta identidad, rol, perfil o actor del llamador.';
    END IF;

    -- Los triggers de integridad de EPT-100 sobre tarifas siguen siendo exactamente esos.
    IF (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.tarifas'::pg_catalog.regclass
          AND NOT t.tgisinternal AND t.tgenabled = 'O')
       IS DISTINCT FROM ARRAY['proteger_tarifa_facturada_antes_de_actualizar',
                              'verificar_tarifa_servicio_antes_de_escribir']::TEXT[] THEN
        RAISE EXCEPTION 'Autoverificación EPT-103: cambió el conjunto de triggers de public.tarifas.';
    END IF;

    RAISE NOTICE
        'Migración EPT-103: 3 operaciones de administración de tarifas instaladas (sin triggers ni grants de tabla nuevos); % tarifa(s) preservadas sin cambios.',
        v_cantidad;
END $$;
