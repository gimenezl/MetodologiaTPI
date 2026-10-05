-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-100 (P3-WU-DB1), parte 2 de 3
-- Módulo económico central: facturas e items_factura
-- ============================================================
--
-- QUÉ AGREGA
--   · public.facturas: una por alumno y período, sin estado persistido.
--   · public.items_factura: cada ítem apunta al origen real (matrícula,
--     inscripción deportiva o inscripción a servicio) y a su tarifa. Las
--     inscripciones se REFERENCIAN, nunca se copian.
--   · Dos triggers mínimos de integridad (app_private), sin lógica de negocio.
--
-- POR QUÉ HAY TRIGGERS Y NO SOLO FK
--   Una FK de existencia no prueba que el hijo de la factura sea el hijo de la
--   matrícula o inscripción de origen, ni que la tarifa sea del concepto y de la
--   referencia correctos. Una FK compuesta resolvería la igualdad de alumno, pero
--   exigiría agregar UNIQUE (id, alumno_id) a matriculas, inscripciones_deportivas
--   e inscripciones_servicios: tablas compartidas que esta unidad no posee. Se
--   documenta como alternativa para una unidad con autorización sobre ellas; hasta
--   entonces la igualdad la verifica un trigger que lee el origen con FOR SHARE.
--
-- LO QUE ESTAS TABLAS NO HACEN (unidades posteriores)
--   · No verifican que `total` sea la suma de los ítems ni que `importe` sea el
--     valor de la tarifa vigente el primer día del período: el cálculo es de
--     EPT-104.
--   · No exigen que la inscripción de origen siga activa: una factura pasada
--     conserva su historial aunque la inscripción se haya cancelado después.
--   · No gobiernan las transiciones de `estado_pago` de los ítems.
--   · No fijan el límite de ítems por factura ni su generación.
--
-- CÓDIGOS SQLSTATE PROPIOS
--   P6802  el origen del ítem pertenece a otro alumno que la factura.
--   P6803  la tarifa no corresponde al concepto o a la referencia del origen.
--   P6804  una tarifa ya facturada no puede cambiar de concepto ni de referencia.

-- ================================================================
-- 1. FACTURAS
-- ================================================================
CREATE TABLE public.facturas (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    alumno_id UUID NOT NULL
        REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    -- Primer día del mes calendario.
    periodo DATE NOT NULL,
    -- Día 10 del período (EPT-83).
    vencimiento DATE NOT NULL,
    generada_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Suma de los ítems, que calcula y almacena el servidor (EPT-104). No tiene
    -- valor por defecto: una factura sin total conocido no debe nacer en cero.
    total NUMERIC(12,2) NOT NULL,
    -- No existe columna de estado: Pendiente, Pago parcial, Pagada y Vencida se
    -- derivan de los ítems y del vencimiento (EPT-83). Con saldo posterior al
    -- vencimiento prevalece «Vencida» sobre «Pago parcial».
    CONSTRAINT facturas_alumno_periodo_unico UNIQUE (alumno_id, periodo),
    -- Pareja (id, alumno_id) que referencian items_factura y, en la parte 3,
    -- imputaciones_pago: pago e ítem no pueden mezclar alumnos.
    CONSTRAINT facturas_id_alumno_unico UNIQUE (id, alumno_id),
    CONSTRAINT facturas_periodo_primer_dia
        CHECK (pg_catalog.date_part('day', periodo) = 1),
    CONSTRAINT facturas_vencimiento_dia_diez
        CHECK (vencimiento = periodo + 9),
    CONSTRAINT facturas_total_valido
        CHECK (total <> 'NaN'::NUMERIC AND total >= 0)
);

COMMENT ON TABLE public.facturas IS
    'Factura mensual de un alumno: una por (alumno, período). Período = primer día del mes; vencimiento = día 10. El estado (Pendiente, Pago parcial, Pagada, Vencida) NO se persiste: lo derivará una vista (EPT-107).';
COMMENT ON COLUMN public.facturas.total IS
    'ARS NUMERIC(12,2) >= 0. Lo calcula el servidor al generar la factura; esta tabla no verifica que coincida con la suma de los ítems (EPT-104).';
COMMENT ON COLUMN public.facturas.generada_en IS
    'Momento de generación (TIMESTAMPTZ). La zona de negocio es America/Argentina/Buenos_Aires; la regla de «antes del último día hábil del mes anterior» es de EPT-104.';


-- ================================================================
-- 2. ITEMS DE FACTURA
-- ================================================================
CREATE TABLE public.items_factura (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    factura_id UUID NOT NULL,
    alumno_id UUID NOT NULL,
    tipo public.concepto_economico NOT NULL,
    tarifa_id UUID NOT NULL,
    matricula_id UUID
        REFERENCES public.matriculas(id) ON DELETE RESTRICT,
    inscripcion_deportiva_id UUID
        REFERENCES public.inscripciones_deportivas(id) ON DELETE RESTRICT,
    inscripcion_servicio_id UUID
        REFERENCES public.inscripciones_servicios(id) ON DELETE RESTRICT,
    importe NUMERIC(12,2) NOT NULL,
    estado_pago public.estado_pago_item NOT NULL DEFAULT 'PENDIENTE',
    -- La factura y el ítem comparten alumno por construcción.
    CONSTRAINT items_factura_factura_alumno_fk
        FOREIGN KEY (factura_id, alumno_id)
        REFERENCES public.facturas (id, alumno_id) ON DELETE RESTRICT,
    -- El tipo del ítem es el concepto de su tarifa.
    CONSTRAINT items_factura_tarifa_tipo_fk
        FOREIGN KEY (tarifa_id, tipo)
        REFERENCES public.tarifas (id, concepto) ON DELETE RESTRICT,
    -- Pareja (id, alumno_id) que referenciará imputaciones_pago.
    CONSTRAINT items_factura_id_alumno_unico UNIQUE (id, alumno_id),
    -- Exactamente el origen que corresponde al tipo.
    CONSTRAINT items_factura_origen_segun_tipo CHECK (
        (tipo = 'CUOTA'
            AND matricula_id IS NOT NULL
            AND inscripcion_deportiva_id IS NULL
            AND inscripcion_servicio_id IS NULL)
        OR (tipo = 'DEPORTE'
            AND inscripcion_deportiva_id IS NOT NULL
            AND matricula_id IS NULL
            AND inscripcion_servicio_id IS NULL)
        OR (tipo IN ('TRANSPORTE', 'COMEDOR')
            AND inscripcion_servicio_id IS NOT NULL
            AND matricula_id IS NULL
            AND inscripcion_deportiva_id IS NULL)
    ),
    CONSTRAINT items_factura_importe_valido
        CHECK (importe <> 'NaN'::NUMERIC AND importe >= 0),
    -- El mismo origen no se factura dos veces dentro de una factura. Los NULL
    -- no colisionan entre sí, de modo que cada UNIQUE solo actúa sobre su origen.
    CONSTRAINT items_factura_matricula_unica
        UNIQUE (factura_id, matricula_id),
    CONSTRAINT items_factura_inscripcion_deportiva_unica
        UNIQUE (factura_id, inscripcion_deportiva_id),
    CONSTRAINT items_factura_inscripcion_servicio_unica
        UNIQUE (factura_id, inscripcion_servicio_id)
);

COMMENT ON TABLE public.items_factura IS
    'Ítem de una factura: un único origen (matrícula, inscripción deportiva o inscripción a servicio) y la tarifa aplicada. Las inscripciones se referencian, no se copian. El importe es el valor de la tarifa copiado al generar, sin prorrateo; esta tabla no recalcula ni verifica esa igualdad (EPT-104).';
COMMENT ON COLUMN public.items_factura.estado_pago IS
    'PENDIENTE, EN_VERIFICACION o PAGADO. Un ítem se paga siempre completo. Las transiciones las gobernará la lógica de pagos (EPT-101 y siguientes), no esta tabla.';

-- Índices de soporte de las FK que ningún UNIQUE cubre por prefijo. La FK
-- (factura_id, alumno_id) queda cubierta por los UNIQUE que empiezan en
-- factura_id; (id, alumno_id) por su propia restricción.
CREATE INDEX idx_items_factura_tarifa
    ON public.items_factura (tarifa_id, tipo);
CREATE INDEX idx_items_factura_matricula
    ON public.items_factura (matricula_id) WHERE matricula_id IS NOT NULL;
CREATE INDEX idx_items_factura_inscripcion_deportiva
    ON public.items_factura (inscripcion_deportiva_id)
    WHERE inscripcion_deportiva_id IS NOT NULL;
CREATE INDEX idx_items_factura_inscripcion_servicio
    ON public.items_factura (inscripcion_servicio_id)
    WHERE inscripcion_servicio_id IS NOT NULL;


-- ================================================================
-- 3. INTEGRIDAD ENTRE TABLAS (trigger mínimo, sin lógica de negocio)
-- ================================================================
-- Verifica que el origen sea del mismo alumno que el ítem y que la tarifa sea la
-- del concepto y de la referencia del origen:
--   CUOTA      → nivel de la tarifa = nivel del curso de la matrícula
--   DEPORTE    → deporte de la tarifa = deporte de la inscripción
--   TRANSPORTE → servicio de la tarifa = servicio de la inscripción
--   COMEDOR    → ídem; la tarifa ya es del tipo de servicio correcto (parte 1)
-- Toma FOR SHARE sobre la tarifa y sobre el origen: un cambio concurrente de
-- cualquiera de ellos espera a esta transacción y no puede dejar un ítem
-- incoherente. El trigger es SECURITY DEFINER para leer las tablas de origen
-- con independencia del rol que escriba (hoy ninguno lo hace directamente).
CREATE OR REPLACE FUNCTION app_private.verificar_item_factura()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_concepto public.concepto_economico;
    v_t_nivel INTEGER;
    v_t_deporte UUID;
    v_t_servicio UUID;
    v_o_alumno UUID;
    v_o_nivel INTEGER;
    v_o_deporte UUID;
    v_o_servicio UUID;
    v_encontrado BOOLEAN := FALSE;
BEGIN
    SELECT t.concepto, t.nivel_id, t.deporte_id, t.servicio_id
    INTO v_concepto, v_t_nivel, v_t_deporte, v_t_servicio
    FROM public.tarifas t
    WHERE t.id = NEW.tarifa_id
    FOR SHARE;

    -- Tarifa inexistente o de otro concepto: lo informa la FK compuesta
    -- (tarifa_id, tipo) con 23503. Aquí no hay nada más que comprobar.
    IF NOT FOUND OR v_concepto IS DISTINCT FROM NEW.tipo THEN
        RETURN NEW;
    END IF;

    IF NEW.tipo = 'CUOTA' THEN
        SELECT m.alumno_id, c.nivel_id
        INTO v_o_alumno, v_o_nivel
        FROM public.matriculas m
        JOIN public.cursos c ON c.id = m.curso_id
        WHERE m.id = NEW.matricula_id
        FOR SHARE OF m;
        v_encontrado := FOUND;
    ELSIF NEW.tipo = 'DEPORTE' THEN
        SELECT i.alumno_id, i.deporte_id
        INTO v_o_alumno, v_o_deporte
        FROM public.inscripciones_deportivas i
        WHERE i.id = NEW.inscripcion_deportiva_id
        FOR SHARE;
        v_encontrado := FOUND;
    ELSE
        SELECT i.alumno_id, i.servicio_id
        INTO v_o_alumno, v_o_servicio
        FROM public.inscripciones_servicios i
        WHERE i.id = NEW.inscripcion_servicio_id
        FOR SHARE;
        v_encontrado := FOUND;
    END IF;

    -- Origen inexistente: lo informa la FK (23503), que se evalúa después de
    -- este trigger. Aquí no hay nada más que comprobar.
    IF NOT v_encontrado THEN
        RETURN NEW;
    END IF;

    IF v_o_alumno IS DISTINCT FROM NEW.alumno_id THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6802',
            MESSAGE = 'El origen del ítem pertenece a otro alumno que la factura.';
    END IF;

    IF (NEW.tipo = 'CUOTA' AND v_t_nivel IS DISTINCT FROM v_o_nivel)
       OR (NEW.tipo = 'DEPORTE' AND v_t_deporte IS DISTINCT FROM v_o_deporte)
       OR (NEW.tipo IN ('TRANSPORTE', 'COMEDOR')
           AND v_t_servicio IS DISTINCT FROM v_o_servicio) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6803',
            MESSAGE = 'La tarifa no corresponde a la referencia del origen del ítem.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.verificar_item_factura()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER verificar_item_factura_antes_de_escribir
    BEFORE INSERT OR UPDATE OF
        alumno_id, tipo, tarifa_id,
        matricula_id, inscripcion_deportiva_id, inscripcion_servicio_id
    ON public.items_factura
    FOR EACH ROW
    EXECUTE FUNCTION app_private.verificar_item_factura();

-- Una tarifa ya facturada conserva su concepto y su referencia: cambiarlos
-- reatribuiría el historial de los ítems que la usan. El cambio de precio se
-- expresa cerrando la vigencia y abriendo otra tarifa, no mutando esta.
-- Concurrencia: para un UPDATE, PostgreSQL bloquea la fila de la tarifa ANTES de
-- ejecutar un trigger BEFORE ROW. Si otra transacción está insertando un ítem
-- (el trigger del ítem tomó FOR SHARE sobre la tarifa), este UPDATE espera a que
-- confirme y recién entonces corre la guarda, cuya consulta —con instantánea
-- nueva en READ COMMITTED— ya ve el ítem. `economico_concurrencia.mjs` lo prueba.
CREATE OR REPLACE FUNCTION app_private.proteger_tarifa_facturada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.concepto IS DISTINCT FROM OLD.concepto
       OR NEW.nivel_id IS DISTINCT FROM OLD.nivel_id
       OR NEW.deporte_id IS DISTINCT FROM OLD.deporte_id
       OR NEW.servicio_id IS DISTINCT FROM OLD.servicio_id THEN
        IF EXISTS (
            SELECT 1 FROM public.items_factura i WHERE i.tarifa_id = OLD.id
        ) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P6804',
                MESSAGE = 'Una tarifa ya facturada no puede cambiar de concepto ni de referencia.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_tarifa_facturada()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_tarifa_facturada_antes_de_actualizar
    BEFORE UPDATE OF concepto, nivel_id, deporte_id, servicio_id
    ON public.tarifas
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_tarifa_facturada();


-- ================================================================
-- 4. ACCESO CERRADO
-- ================================================================
ALTER TABLE public.facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items_factura ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.facturas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.items_factura FROM PUBLIC, anon, authenticated;

-- Réplica de la política RESTRICTIVE de bloqueo de cuenta (EPT-59): esa migración
-- dice que una tabla nueva debe agregarla ella misma, y el control de
-- `usuarios_permisos_rls.sql` (2.5) lo exige para toda tabla de `public`.
-- Una política RESTRICTIVE solo RESTRINGE: sin ninguna política permisiva el
-- acceso sigue cerrado para todo rol de aplicación. EPT-101 agrega las
-- permisivas mínimas por actor; esta migración no concede nada.
CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.facturas
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.items_factura
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));
