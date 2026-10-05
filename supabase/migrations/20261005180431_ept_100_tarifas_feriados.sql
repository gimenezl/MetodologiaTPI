-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-100 (P3-WU-DB1), parte 1 de 3
-- Módulo económico central: tipos, tarifas y feriados
-- ============================================================
--
-- ALCANCE
--   Ocho entidades económicas, repartidas en tres migraciones aditivas:
--     1. (esta)   tarifas, feriados y los tipos enumerados compartidos;
--     2.          facturas e items_factura;
--     3.          pagos, imputaciones_pago, recibos y envios_correo.
--   Solo estructura e integridad. Las transiciones de aprobación, la reserva y
--   liberación de ítems, la numeración de recibos, el cálculo de totales, las
--   vistas de saldo y las funciones de negocio llegan en unidades posteriores
--   (EPT-101 en adelante). Nada de esto se afirma satisfecho por estas tablas.
--
-- ACCESO CERRADO POR DEFECTO
--   RLS habilitada, SIN ningún GRANT a PUBLIC, anon ni authenticated y SIN
--   políticas permisivas. Cada tabla lleva solo la política RESTRICTIVE de
--   bloqueo de cuenta que el repositorio exige a toda tabla nueva (EPT-59); no
--   concede acceso. EPT-101 agrega el acceso mínimo por actor. `service_role`
--   conserva los privilegios por defecto de la plataforma Supabase y omite RLS
--   por diseño.
--
-- IMPORTES
--   NUMERIC(12,2): ARS con dos decimales, sin FLOAT/REAL/MONEY. PostgreSQL
--   REDONDEA al imponer la escala (1.005 se almacena como 1.01) y esa coerción
--   ocurre antes de cualquier CHECK, de modo que ningún CHECK posterior puede
--   detectar el valor original. Esta migración NO promete «entrada sin
--   redondeo»: la validación del texto o número recibido es responsabilidad de
--   las futuras escrituras de tarifa y de pago, que deben hacerla antes del
--   cast. En cambio sí se rechazan NaN (que `>= 0` aceptaría, porque NaN es
--   mayor que todo número en PostgreSQL), los negativos, el desborde de
--   capacidad (22003) y el infinito (también 22003 con precisión declarada).
--
-- VIGENCIA DE TARIFAS (convención)
--   `desde` es el primer día en vigor y `hasta` el ÚLTIMO día en vigor, ambos
--   incluidos (rango cerrado `[desde, hasta]`); `hasta` NULL significa vigente
--   sin fecha de fin. Un cambio de precio el día D se expresa cerrando la
--   tarifa anterior en D-1 y abriendo la nueva en D. Dos vigencias de la misma
--   referencia no pueden compartir ningún día (restricción de exclusión).
--   Esto es solo la convención de almacenamiento: qué tarifa corresponde a un
--   período (la vigente el primer día del mes, EPT-83) es cálculo de EPT-104.
--
-- CÓDIGOS SQLSTATE PROPIOS
--   P6801  la tarifa referencia un servicio de otro tipo que su concepto.
--   (el resto de las garantías de esta unidad usa SQLSTATE estándar:
--    23502 not-null, 23503 FK, 23505 UNIQUE, 23514 CHECK, 23P01 exclusión)

-- ================================================================
-- 1. EXTENSIÓN PARA LA EXCLUSIÓN DE VIGENCIAS
-- ================================================================
-- Necesaria para combinar igualdad (nivel/deporte/servicio) con solapamiento de
-- rangos en un mismo índice GiST. Es una extensión contrib ya incluida en la
-- imagen de PostgreSQL de Supabase: no se instala ningún paquete nuevo.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;


-- ================================================================
-- 2. TIPOS ENUMERADOS COMPARTIDOS DEL MÓDULO
-- ================================================================
-- Un solo catálogo de conceptos para tarifas e ítems: la FK compuesta
-- (tarifa_id, tipo) de la migración 2 exige que ambos coincidan.
CREATE TYPE public.concepto_economico AS ENUM
    ('CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR');

CREATE TYPE public.estado_pago_item AS ENUM
    ('PENDIENTE', 'EN_VERIFICACION', 'PAGADO');

CREATE TYPE public.estado_pago AS ENUM
    ('PENDIENTE_VERIFICACION', 'APROBADO', 'RECHAZADO');

CREATE TYPE public.tipo_envio_correo AS ENUM
    ('RECORDATORIO_MENSUAL', 'AVISO_DEUDA');

CREATE TYPE public.estado_envio_correo AS ENUM
    ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'INCIERTO');


-- ================================================================
-- 3. TARIFAS
-- ================================================================
CREATE TABLE public.tarifas (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    concepto public.concepto_economico NOT NULL,
    -- Exactamente una referencia, la que corresponde al concepto. Las tres son
    -- FK a las entidades existentes: no se duplica ningún catálogo.
    nivel_id INTEGER
        REFERENCES public.niveles(id) ON DELETE RESTRICT,
    deporte_id UUID
        REFERENCES public.deportes(id) ON DELETE RESTRICT,
    servicio_id UUID
        REFERENCES public.servicios_escolares(id) ON DELETE RESTRICT,
    importe NUMERIC(12,2) NOT NULL,
    desde DATE NOT NULL,
    hasta DATE,
    -- Auditoría mínima de la fila; sin ella no se puede ordenar una corrección.
    creada_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Pareja (id, concepto) que referencia items_factura: así el ítem no puede
    -- declarar un tipo distinto del concepto de su tarifa.
    CONSTRAINT tarifas_id_concepto_unico UNIQUE (id, concepto),
    CONSTRAINT tarifas_referencia_segun_concepto CHECK (
        (concepto = 'CUOTA'
            AND nivel_id IS NOT NULL AND deporte_id IS NULL AND servicio_id IS NULL)
        OR (concepto = 'DEPORTE'
            AND deporte_id IS NOT NULL AND nivel_id IS NULL AND servicio_id IS NULL)
        OR (concepto IN ('TRANSPORTE', 'COMEDOR')
            AND servicio_id IS NOT NULL AND nivel_id IS NULL AND deporte_id IS NULL)
    ),
    -- `>= 0` por sí solo acepta NaN, que PostgreSQL ordena por encima de todo.
    CONSTRAINT tarifas_importe_valido
        CHECK (importe <> 'NaN'::NUMERIC AND importe >= 0),
    CONSTRAINT tarifas_vigencia_valida
        CHECK (hasta IS NULL OR hasta >= desde),
    -- Sin solapamiento por referencia, con la convención cerrada [desde, hasta].
    -- Tres exclusiones parciales: cada una cubre una referencia y su índice GiST
    -- sirve además a la FK correspondiente, de modo que no hace falta duplicarlo.
    CONSTRAINT tarifas_sin_solapamiento_nivel
        EXCLUDE USING gist (
            nivel_id WITH =,
            (pg_catalog.daterange(desde, hasta, '[]')) WITH &&
        ) WHERE (nivel_id IS NOT NULL),
    CONSTRAINT tarifas_sin_solapamiento_deporte
        EXCLUDE USING gist (
            deporte_id WITH =,
            (pg_catalog.daterange(desde, hasta, '[]')) WITH &&
        ) WHERE (deporte_id IS NOT NULL),
    CONSTRAINT tarifas_sin_solapamiento_servicio
        EXCLUDE USING gist (
            servicio_id WITH =,
            (pg_catalog.daterange(desde, hasta, '[]')) WITH &&
        ) WHERE (servicio_id IS NOT NULL)
);

COMMENT ON TABLE public.tarifas IS
    'Tarifa vigente por concepto y referencia (nivel, deporte o servicio). ARS con dos decimales. Vigencia cerrada [desde, hasta], hasta NULL = sin fin. Sin solapamiento por referencia. Escribe solo Dirección en unidades posteriores; hoy la tabla está cerrada a todo rol de aplicación.';
COMMENT ON COLUMN public.tarifas.importe IS
    'ARS, NUMERIC(12,2) >= 0. PostgreSQL redondea los excesos de escala al almacenar; la validación previa al cast es responsabilidad de la escritura futura.';
COMMENT ON COLUMN public.tarifas.desde IS
    'Primer día en vigor (incluido).';
COMMENT ON COLUMN public.tarifas.hasta IS
    'Último día en vigor (incluido). NULL: vigente sin fecha de fin.';

-- La exclusión garantiza la unicidad de vigencias, pero el servicio de una
-- tarifa de TRANSPORTE/COMEDOR debe además ser del tipo que su concepto dice.
-- Compararlo exige leer otra tabla, y una FK compuesta (id, tipo) obligaría a
-- agregar una restricción UNIQUE al catálogo compartido servicios_escolares, que
-- esta unidad no posee. Por eso es un trigger mínimo de integridad.
CREATE OR REPLACE FUNCTION app_private.verificar_tarifa_servicio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tipo public.tipo_servicio_escolar;
BEGIN
    IF NEW.servicio_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- FOR SHARE: un cambio concurrente del servicio espera a esta transacción.
    SELECT s.tipo INTO v_tipo
    FROM public.servicios_escolares s
    WHERE s.id = NEW.servicio_id
    FOR SHARE;

    -- Servicio inexistente: lo informa la FK con 23503, no este trigger.
    IF v_tipo IS NOT NULL AND v_tipo::TEXT IS DISTINCT FROM NEW.concepto::TEXT THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6801',
            MESSAGE = 'El servicio de la tarifa no corresponde a su concepto.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.verificar_tarifa_servicio()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER verificar_tarifa_servicio_antes_de_escribir
    BEFORE INSERT OR UPDATE OF concepto, servicio_id ON public.tarifas
    FOR EACH ROW
    EXECUTE FUNCTION app_private.verificar_tarifa_servicio();


-- ================================================================
-- 4. FERIADOS
-- ================================================================
-- Calendario de feriados nacionales de Argentina (EPT-85). La migración NO
-- carga ninguna fecha: el calendario real lo siembra la unidad que lo usa.
CREATE TABLE public.feriados (
    fecha DATE PRIMARY KEY,
    descripcion TEXT NOT NULL,
    CONSTRAINT feriados_descripcion_valida
        CHECK (pg_catalog.btrim(descripcion, E' \t\r\n') <> '')
);

COMMENT ON TABLE public.feriados IS
    'Feriados nacionales argentinos para calcular el último día hábil de generación y los plazos de avisos. Sin datos iniciales.';


-- ================================================================
-- 5. ACCESO CERRADO
-- ================================================================
-- Los privilegios por defecto de `postgres` ya revocan a anon y authenticated
-- (migración 20261002130000); se revoca igual de forma explícita para que la
-- migración sea correcta por sí sola aunque cambie ese default.
ALTER TABLE public.tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tarifas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.feriados FROM PUBLIC, anon, authenticated;

-- Réplica de la política RESTRICTIVE de bloqueo de cuenta (EPT-59): esa migración
-- dice que una tabla nueva debe agregarla ella misma, y el control de
-- `usuarios_permisos_rls.sql` (2.5) lo exige para toda tabla de `public`.
-- Una política RESTRICTIVE solo RESTRINGE: sin ninguna política permisiva el
-- acceso sigue cerrado para todo rol de aplicación. EPT-101 agrega las
-- permisivas mínimas por actor; esta migración no concede nada.
CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.tarifas
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.feriados
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));
