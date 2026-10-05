-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-100 (P3-WU-DB1), parte 3 de 3
-- Módulo económico central: pagos, imputaciones, recibos y envíos de correo
-- ============================================================
--
-- QUÉ AGREGA
--   · public.pagos: un pago de un padre sobre ítems de UN solo hijo.
--   · public.imputaciones_pago: qué ítems cubre cada pago, con FK compuestas que
--     impiden mezclar alumnos entre pago e ítem.
--   · public.recibos: a lo sumo uno por pago.
--   · public.envios_correo: registro idempotente de avisos por padre, tipo y fecha.
--   Cierra la cadena de tres migraciones y verifica el acceso cerrado de las
--   ocho entidades (RLS, ningún grant, ninguna política permisiva).
--
-- NULABILIDAD POR ETAPA (contrato de integración EPT-98)
--   El pago se crea ANTES de informar la transferencia: `registrar_pago(ids)`
--   reserva los ítems y devuelve `pago_id` y `total_calculado`; después
--   `adjuntar_comprobante(...)` informa fecha, importe y número de operación.
--   Por eso `fecha_transferencia`, `importe_informado` y `numero_operacion` son
--   NULL mientras el pago está PENDIENTE_VERIFICACION. Un número informado nunca
--   es vacío, y un pago APROBADO exige los tres: sin número de operación no hay
--   conciliación ni vale la unicidad global entre pagos no rechazados.
--
-- LO QUE ESTAS TABLAS NO HACEN (unidades posteriores)
--   · No aprueban, rechazan ni reservan: la transición de estados, la reserva y
--     liberación de ítems, el bajado de saldo y su atomicidad funcional son de
--     EPT-101 en adelante. Estas tablas NO afirman cumplir esa atomicidad.
--   · No verifican que `total_calculado` sea la suma de las imputaciones, que
--     `imputaciones_pago.activa` refleje el estado del pago, ni que un recibo
--     exista solo para un pago APROBADO.
--   · No verifican que `padre_id` sea padre vinculado al alumno: un vínculo
--     (padres_hijos) puede cambiar y atar el historial económico a esa tabla
--     afectaría su administración. Lo comprueba la función de registro.
--   · No numeran recibos: `numero` es único y positivo, pero lo asigna la lógica
--     de emisión. No se genera ningún PDF.
--   · NO existen `comprobantes_pago` ni `envios_correo_facturas`: el MER y el
--     comentario de cierre de EPT-91 las dejan «a confirmar». Quedan pendientes
--     de decisión para EPT-101/109/115.
--
-- CÓDIGOS SQLSTATE
--   Todas las garantías de esta parte usan SQLSTATE estándar (23502, 23503,
--   23505, 23514); no hay códigos propios.

-- ================================================================
-- 1. PAGOS
-- ================================================================
CREATE TABLE public.pagos (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    padre_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    alumno_id UUID NOT NULL
        REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    -- Lo calcula el servidor al reservar los ítems.
    total_calculado NUMERIC(12,2) NOT NULL,
    -- Datos de conciliación que informa el padre después; pueden diferir del
    -- total calculado (EPT-84).
    importe_informado NUMERIC(12,2),
    fecha_transferencia DATE,
    numero_operacion TEXT,
    estado public.estado_pago NOT NULL DEFAULT 'PENDIENTE_VERIFICACION',
    verificado_por UUID
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    verificado_en TIMESTAMP WITH TIME ZONE,
    motivo_rechazo TEXT,
    creado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Pareja (id, alumno_id) que referencia imputaciones_pago.
    CONSTRAINT pagos_id_alumno_unico UNIQUE (id, alumno_id),
    CONSTRAINT pagos_total_calculado_valido
        CHECK (total_calculado <> 'NaN'::NUMERIC AND total_calculado >= 0),
    CONSTRAINT pagos_importe_informado_valido
        CHECK (importe_informado IS NULL
               OR (importe_informado <> 'NaN'::NUMERIC AND importe_informado >= 0)),
    CONSTRAINT pagos_numero_operacion_no_vacio
        CHECK (numero_operacion IS NULL OR pg_catalog.btrim(numero_operacion, E' \t\r\n') <> ''),
    -- La decisión de Dirección deja rastro completo y coherente con el estado.
    CONSTRAINT pagos_verificacion_segun_estado CHECK (
        (estado = 'PENDIENTE_VERIFICACION'
            AND verificado_por IS NULL AND verificado_en IS NULL
            AND motivo_rechazo IS NULL)
        OR (estado = 'APROBADO'
            AND verificado_por IS NOT NULL AND verificado_en IS NOT NULL
            AND motivo_rechazo IS NULL)
        OR (estado = 'RECHAZADO'
            AND verificado_por IS NOT NULL AND verificado_en IS NOT NULL
            AND motivo_rechazo IS NOT NULL
            AND pg_catalog.btrim(motivo_rechazo, E' \t\r\n') <> '')
    ),
    -- Un pago aprobado tiene su transferencia completamente informada.
    CONSTRAINT pagos_aprobado_con_transferencia CHECK (
        estado <> 'APROBADO'
        OR (fecha_transferencia IS NOT NULL
            AND importe_informado IS NOT NULL
            AND numero_operacion IS NOT NULL)
    )
);

COMMENT ON TABLE public.pagos IS
    'Pago de un padre sobre ítems de un solo hijo, de una o varias facturas. Se crea antes de informar la transferencia (fecha, importe y número son NULL hasta adjuntar el comprobante). El historial se conserva: un rechazo no borra el pago. Las transiciones de estado y la reserva de ítems no las gobierna esta tabla.';
COMMENT ON COLUMN public.pagos.numero_operacion IS
    'Número de operación informado, nunca vacío. Único entre pagos no rechazados comparando el texto sin espacios, tabulaciones ni saltos de línea en los extremos; no se normalizan mayúsculas.';
COMMENT ON COLUMN public.pagos.importe_informado IS
    'ARS NUMERIC(12,2) >= 0. Dato de conciliación; puede diferir del total calculado. PostgreSQL redondea los excesos de escala: la validación previa al cast es de la escritura futura.';

-- Autoridad de «un número de operación por pago no rechazado» ante concurrencia:
-- dos transacciones que informen el mismo número no pueden confirmar las dos y
-- la perdedora recibe 23505. Al rechazar un pago el índice lo deja de contar y el
-- número queda libre para otro pago.
CREATE UNIQUE INDEX idx_pagos_operacion_no_rechazada
    ON public.pagos ((pg_catalog.btrim(numero_operacion, E' \t\r\n')))
    WHERE estado <> 'RECHAZADO' AND numero_operacion IS NOT NULL;

-- Índices de las FK de lectura frecuente (historial del padre y del hijo) y de
-- la FK hacia quien verifica.
CREATE INDEX idx_pagos_padre ON public.pagos (padre_id, creado_en DESC);
CREATE INDEX idx_pagos_alumno ON public.pagos (alumno_id, creado_en DESC);
CREATE INDEX idx_pagos_verificado_por
    ON public.pagos (verificado_por) WHERE verificado_por IS NOT NULL;


-- ================================================================
-- 2. IMPUTACIONES DE PAGO
-- ================================================================
CREATE TABLE public.imputaciones_pago (
    pago_id UUID NOT NULL,
    item_factura_id UUID NOT NULL,
    alumno_id UUID NOT NULL,
    -- Igual al importe del ítem: un ítem se paga siempre completo. La igualdad
    -- con el ítem es regla de la lógica de reserva, no de esta tabla.
    importe NUMERIC(12,2) NOT NULL,
    -- Verdadera mientras el pago no está rechazado.
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    -- Identidad reproducible de la fila: un ítem aparece una vez por pago, así
    -- que (pago, ítem) la determina sin un UUID aleatorio.
    CONSTRAINT imputaciones_pago_pk PRIMARY KEY (pago_id, item_factura_id),
    -- Mismo alumno en el pago y en el ítem, por construcción.
    CONSTRAINT imputaciones_pago_pago_alumno_fk
        FOREIGN KEY (pago_id, alumno_id)
        REFERENCES public.pagos (id, alumno_id) ON DELETE RESTRICT,
    CONSTRAINT imputaciones_pago_item_alumno_fk
        FOREIGN KEY (item_factura_id, alumno_id)
        REFERENCES public.items_factura (id, alumno_id) ON DELETE RESTRICT,
    CONSTRAINT imputaciones_pago_importe_valido
        CHECK (importe <> 'NaN'::NUMERIC AND importe >= 0)
);

COMMENT ON TABLE public.imputaciones_pago IS
    'Ítems que cubre cada pago. Pago e ítem comparten alumno por FK compuesta. Un ítem tiene como máximo una imputación activa. Se crea al registrar el pago; el saldo baja recién al aprobar. Esta tabla no sincroniza `activa` con el estado del pago.';

-- Un ítem no puede estar en dos pagos vigentes. Es la autoridad concurrente de
-- la reserva: la transacción perdedora recibe 23505.
CREATE UNIQUE INDEX idx_imputaciones_pago_item_activa
    ON public.imputaciones_pago (item_factura_id) WHERE activa;

-- Soporte de la FK (item_factura_id, alumno_id) y del historial del ítem. La
-- clave primaria ya empieza en pago_id y cubre la FK hacia pagos.
CREATE INDEX idx_imputaciones_pago_item
    ON public.imputaciones_pago (item_factura_id, alumno_id);


-- ================================================================
-- 3. RECIBOS
-- ================================================================
CREATE TABLE public.recibos (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    -- UNIQUE: un recibo por pago. Que el pago esté APROBADO es regla de la
    -- emisión, no de esta tabla.
    pago_id UUID NOT NULL
        REFERENCES public.pagos(id) ON DELETE RESTRICT,
    -- Numeración única; la asigna la lógica de emisión (sin secuencia aquí).
    numero BIGINT NOT NULL,
    emitido_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Ruta del PDF en Storage privado. Esta unidad no genera PDF, así que el
    -- campo admite NULL hasta que exista el archivo; si se informa, no es vacío.
    archivo_path TEXT,
    CONSTRAINT recibos_pago_unico UNIQUE (pago_id),
    CONSTRAINT recibos_numero_unico UNIQUE (numero),
    CONSTRAINT recibos_numero_positivo CHECK (numero > 0),
    CONSTRAINT recibos_archivo_path_no_vacio
        CHECK (archivo_path IS NULL OR pg_catalog.btrim(archivo_path, E' \t\r\n') <> '')
);

COMMENT ON TABLE public.recibos IS
    'Recibo de un pago: a lo sumo uno por pago, con número único. Sin PDF ni numeración funcional en esta unidad.';


-- ================================================================
-- 4. ENVÍOS DE CORREO
-- ================================================================
CREATE TABLE public.envios_correo (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    padre_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    tipo public.tipo_envio_correo NOT NULL,
    -- Fecha de programación en hora de Argentina.
    fecha_programada DATE NOT NULL,
    estado public.estado_envio_correo NOT NULL DEFAULT 'PENDIENTE',
    intentos INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    enviado_en TIMESTAMP WITH TIME ZONE,
    -- Un solo aviso por padre, tipo y fecha. Su índice empieza en padre_id y
    -- cubre la FK hacia perfiles.
    CONSTRAINT envios_correo_unico_por_padre_tipo_fecha
        UNIQUE (padre_id, tipo, fecha_programada),
    CONSTRAINT envios_correo_intentos_validos CHECK (intentos >= 0),
    -- Solo un envío confirmado tiene instante de envío. INCIERTO no lo tiene: no
    -- se sabe si salió, y por eso no se reintenta (EPT-85).
    CONSTRAINT envios_correo_enviado_coherente
        CHECK ((estado = 'ENVIADO') = (enviado_en IS NOT NULL)),
    CONSTRAINT envios_correo_error_no_vacio
        CHECK (ultimo_error IS NULL OR pg_catalog.btrim(ultimo_error, E' \t\r\n') <> '')
);

COMMENT ON TABLE public.envios_correo IS
    'Registro de avisos por correo a padres: único por (padre, tipo, fecha programada). INCIERTO no se reintenta y queda marcado para Dirección. El canal de envío y la política de reintento no se implementan aquí.';


-- ================================================================
-- 5. ACCESO CERRADO
-- ================================================================
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imputaciones_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recibos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envios_correo ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pagos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.imputaciones_pago FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.recibos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.envios_correo FROM PUBLIC, anon, authenticated;

-- Réplica de la política RESTRICTIVE de bloqueo de cuenta (EPT-59): esa migración
-- dice que una tabla nueva debe agregarla ella misma, y el control de
-- `usuarios_permisos_rls.sql` (2.5) lo exige para toda tabla de `public`.
-- Una política RESTRICTIVE solo RESTRINGE: sin ninguna política permisiva el
-- acceso sigue cerrado para todo rol de aplicación. EPT-101 agrega las
-- permisivas mínimas por actor; esta migración no concede nada.
CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.pagos
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.imputaciones_pago
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.recibos
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.envios_correo
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));


-- ================================================================
-- 6. AUTOVERIFICACIÓN DE LAS OCHO ENTIDADES
-- ================================================================
-- Si una migración futura o un default de plataforma abriera alguna tabla, esta
-- migración falla en lugar de dejarla abierta en silencio.
DO $$
DECLARE
    v_tabla TEXT;
    v_rol TEXT;
    v_privilegio TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY[
        'tarifas', 'facturas', 'items_factura', 'pagos',
        'imputaciones_pago', 'recibos', 'feriados', 'envios_correo'
    ] LOOP
        IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
                WHERE c.oid = pg_catalog.to_regclass('public.' || v_tabla)) THEN
            RAISE EXCEPTION 'EPT-100: la tabla % no tiene RLS habilitada.', v_tabla;
        END IF;

        IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                   WHERE p.schemaname = 'public' AND p.tablename = v_tabla
                     AND p.permissive = 'PERMISSIVE') THEN
            RAISE EXCEPTION 'EPT-100: la tabla % no debe tener políticas permisivas todavía.', v_tabla;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                       WHERE p.schemaname = 'public' AND p.tablename = v_tabla
                         AND p.permissive = 'RESTRICTIVE'
                         AND p.policyname = 'Bloqueo de acceso sin datos protegidos') THEN
            RAISE EXCEPTION 'EPT-100: la tabla % no tiene la política restrictiva de bloqueo.', v_tabla;
        END IF;

        FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'SELECT', 'INSERT', 'UPDATE', 'DELETE',
                'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF pg_catalog.has_table_privilege(
                       v_rol, 'public.' || v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'EPT-100: % tiene % sobre %.',
                        v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END;
$$;
