-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-109 (P3-HU9), carga de comprobantes de
-- transferencia
-- ============================================================
--
-- TARJETAS QUE CUBRE
--   EPT-147 bucket privado y políticas por padre (completa el uso seguro del de
--           EPT-101 y agrega el bucket temporal de carga).
--   EPT-149 validación de tipo y tamaño (bucket, CHECK, función de preparación;
--           el contenido binario lo valida la frontera de servidor).
--   EPT-150 registro de fecha, importe y número de operación.
--   EPT-151 asociación del comprobante al pago (varios por pago; las facturas se
--           relacionan por las imputaciones del pago).
--   (EPT-148 y EPT-152 son de la aplicación móvil y de las pruebas.)
--
-- POR QUÉ UN PROTOCOLO DE VARIOS PASOS
--   PostgreSQL y Storage no forman una transacción única, y el servidor Next
--   (Vercel) limita el cuerpo de una petición a 4,5 MB, menos que los 5 MiB
--   aprobados. El archivo no puede viajar por una función de Next ni validarse
--   dentro de SQL. El protocolo es:
--     1. PREPARAR (cliente, JWT del padre): `preparar_carga_comprobante` valida al
--        actor, el pago y los datos de la transferencia, y deja una fila PREPARADA
--        en `cargas_comprobante` con la ruta temporal canónica. No toca `pagos`.
--     2. SUBIR (cliente, JWT del padre): sube los bytes directamente a Storage, a
--        la ruta temporal registrada, en el bucket PRIVADO
--        `comprobantes-pago-temporal`. Solo existe política de INSERT y solo para
--        una carga PREPARADA propia: no hay UPDATE, DELETE ni upsert, así que el
--        objeto no se puede reemplazar ni borrar desde el cliente.
--     3. FINALIZAR (servidor, service_role, tras validar el token del padre): lee
--        los bytes, comprueba su estructura real, los publica en
--        `comprobantes-pago` desde la memoria validada y llama a
--        `confirmar_carga_comprobante`, que en UNA transacción SQL revalida todo,
--        registra fecha/importe/número (la primera vez) y el comprobante.
--   Un comprobante solo existe como fila de `comprobantes_pago` tras el paso 3.
--
-- QUÉ NO HACE
--   · No aprueba, rechaza ni libera (EPT-110/111). El pago sigue
--     PENDIENTE_VERIFICACION, los ítems EN_VERIFICACION y el saldo no cambia.
--   · No edita datos económicos ni reemplaza un comprobante: agregar un archivo o
--     repetir una solicitud nunca sobrescribe fecha, importe ni número.
--   · No limita la cantidad de archivos por pago (no hay máximo aprobado). Solo
--     hay un tope TÉCNICO de cargas sin completar por padre (10) para que una
--     cuenta no acumule objetos temporales de 5 MiB sin límite.
--   · No expira ni cancela pagos: la limpieza solo toca objetos temporales.
--   · No es un antivirus. La validación comprueba estructura y consistencia de
--     JPEG, PNG y PDF; no afirma que el archivo sea inocuo.
--
-- MATRIZ DE ACCESO
--   public.preparar_carga_comprobante    authenticated (padre habilitado)
--   public.consultar_carga_comprobante   authenticated (padre habilitado, propia)
--   public.obtener_carga_para_finalizar  service_role SOLAMENTE
--   public.confirmar_carga_comprobante   service_role SOLAMENTE
--   public.descartar_carga_comprobante   service_role SOLAMENTE
--   public.cargas_comprobante_a_conciliar / marcar_temporal_eliminado
--                                        service_role SOLAMENTE
--   Que `confirmar` no sea invocable por un cliente es la garantía de que ninguna
--   aplicación puede declarar «validado» un archivo: ni un booleano ni un hash
--   enviados por el cliente llegan a esa función. service_role es la frontera de
--   confianza (EPT-101): el servidor que la usa es quien autentica el token.
--
-- ORDEN DE BLOQUEOS (el de EPT-103/108, más el pago y la carga)
--     1. perfil del actor, FOR SHARE (guarda retenida hasta el fin);
--     2. consultivo de la carga (padre, clave);
--     3. vínculo (padre, hijo), FOR SHARE;
--     4. pago, FOR UPDATE (serializa quién informa fecha/importe/número);
--     5. carga, FOR UPDATE.
--
-- IDEMPOTENCIA
--   (padre_id, clave_carga) es único. Misma clave y mismos datos: el mismo
--   resultado (`repetido = true`). Misma clave con otro pago, otro archivo
--   declarado u otros datos: P6864, sin escribir.
--
-- CÓDIGOS SQLSTATE PROPIOS (P686x; P6850–P6857 son de EPT-108)
--   P6860  datos inválidos o ausentes (tipo, tamaño, fecha, importe, número).
--   P6861  el pago no existe o no está disponible para esta cuenta.
--   P6862  el pago ya no está pendiente de verificación.
--   P6863  el número de operación ya está registrado en otro pago.
--   P6864  la clave de carga ya se usó con otros datos.
--   P6865  los datos difieren de los ya informados para este pago.
--   P6866  la carga no existe, expiró o fue descartada.
--   P6868  demasiadas cargas sin completar.
--   42501  la identidad no es una familia habilitada.
--   P5505  no hay identidad autenticada.

-- ================================================================
-- 0. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.pagos') IS NULL
       OR pg_catalog.to_regclass('public.comprobantes_pago') IS NULL
       OR pg_catalog.to_regclass('public.padres_hijos') IS NULL
       OR pg_catalog.to_regprocedure('app_private.padre_para_pagos(boolean)') IS NULL THEN
        RAISE EXCEPTION 'EPT-109: faltan las tablas de EPT-100/101 o las funciones de EPT-108.';
    END IF;
    IF pg_catalog.to_regclass('public.cargas_comprobante') IS NOT NULL THEN
        RAISE EXCEPTION 'EPT-109: public.cargas_comprobante ya existe; revisá el estado de la base.';
    END IF;
END $$;


-- ================================================================
-- 1. BUCKET TEMPORAL (privado)
-- ================================================================
-- Mismo límite y tipos declarados que el final. El servicio comprueba el tipo
-- DECLARADO y el tamaño; el contenido real lo comprueba la frontera de servidor.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprobantes-pago-temporal', 'comprobantes-pago-temporal', FALSE, 5242880,
        ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
    SET public = FALSE,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];


-- ================================================================
-- 2. CARGAS DE COMPROBANTE (intento durable)
-- ================================================================
CREATE TABLE public.cargas_comprobante (
    -- Es también el id del comprobante publicado: la ruta final deriva de él.
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    padre_id UUID NOT NULL,
    pago_id UUID NOT NULL,
    -- UUID generado por el cliente para el intento; único por padre.
    clave_carga UUID NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PREPARADA',
    -- Datos de la transferencia de ESTA carga. Si el pago ya los tenía, son los
    -- del pago (una carga adicional no los modifica).
    fecha_transferencia DATE NOT NULL,
    importe_informado NUMERIC(12,2) NOT NULL,
    numero_operacion TEXT NOT NULL,
    tipo_mime_declarado TEXT NOT NULL,
    tamano_declarado BIGINT NOT NULL,
    -- SHA-256 de la solicitud canónica; distingue un reintento idéntico de la
    -- misma clave con otro contenido.
    huella_solicitud TEXT NOT NULL,
    ruta_temporal TEXT NOT NULL,
    -- SHA-256 de los bytes validados y publicados (lo calcula el servidor).
    sha256_contenido TEXT,
    motivo_descarte TEXT,
    creado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resuelto_en TIMESTAMP WITH TIME ZONE,
    -- Verdadero cuando ya se intentó borrar (o no existía) el objeto temporal.
    temporal_eliminado_en TIMESTAMP WITH TIME ZONE,
    CONSTRAINT cargas_comprobante_pago_padre_fk
        FOREIGN KEY (pago_id, padre_id)
        REFERENCES public.pagos (id, padre_id) ON DELETE RESTRICT,
    CONSTRAINT cargas_comprobante_clave_unica UNIQUE (padre_id, clave_carga),
    CONSTRAINT cargas_comprobante_ruta_unica UNIQUE (ruta_temporal),
    CONSTRAINT cargas_comprobante_estado_valido
        CHECK (estado IN ('PREPARADA', 'CONFIRMADA', 'DESCARTADA', 'EXPIRADA')),
    CONSTRAINT cargas_comprobante_tipo_valido
        CHECK (tipo_mime_declarado IN ('image/jpeg', 'image/png', 'application/pdf')),
    CONSTRAINT cargas_comprobante_tamano_valido
        CHECK (tamano_declarado > 0 AND tamano_declarado <= 5242880),
    CONSTRAINT cargas_comprobante_importe_valido
        CHECK (importe_informado <> 'NaN'::NUMERIC AND importe_informado >= 0),
    CONSTRAINT cargas_comprobante_fecha_finita
        CHECK (pg_catalog.isfinite(fecha_transferencia)),
    CONSTRAINT cargas_comprobante_numero_no_vacio
        CHECK (pg_catalog.btrim(numero_operacion, E' \t\r\n') <> ''),
    CONSTRAINT cargas_comprobante_huella_formato
        CHECK (huella_solicitud ~ '^[0-9a-f]{64}$'),
    CONSTRAINT cargas_comprobante_sha_formato
        CHECK (sha256_contenido IS NULL OR sha256_contenido ~ '^[0-9a-f]{64}$'),
    CONSTRAINT cargas_comprobante_ruta_coherente
        CHECK (ruta_temporal = pago_id::TEXT || '/' || id::TEXT),
    CONSTRAINT cargas_comprobante_fechas_finitas
        CHECK (pg_catalog.isfinite(creado_en)
               AND (resuelto_en IS NULL OR pg_catalog.isfinite(resuelto_en))
               AND (temporal_eliminado_en IS NULL OR pg_catalog.isfinite(temporal_eliminado_en))),
    CONSTRAINT cargas_comprobante_motivo_valido
        CHECK (motivo_descarte IS NULL OR motivo_descarte IN (
            'ARCHIVO_INVALIDO', 'CONTENIDO_NO_COINCIDE', 'ARCHIVO_AUSENTE',
            'PAGO_NO_PENDIENTE', 'OPERACION_DUPLICADA', 'DATOS_DIFERENTES',
            'VINCULO_REVOCADO', 'CUENTA_NO_HABILITADA', 'EXPIRADA', 'ABANDONADA')),
    -- Coherencia del estado con sus campos de cierre.
    CONSTRAINT cargas_comprobante_cierre_segun_estado CHECK (
        (estado = 'PREPARADA'
            AND sha256_contenido IS NULL AND motivo_descarte IS NULL AND resuelto_en IS NULL)
        OR (estado = 'CONFIRMADA'
            AND sha256_contenido IS NOT NULL AND motivo_descarte IS NULL AND resuelto_en IS NOT NULL)
        OR (estado IN ('DESCARTADA', 'EXPIRADA')
            AND sha256_contenido IS NULL AND motivo_descarte IS NOT NULL AND resuelto_en IS NOT NULL)
    )
);

COMMENT ON TABLE public.cargas_comprobante IS
    'EPT-109. Intento durable de cargar un comprobante: la fila existe antes del archivo y sobrevive a un corte. Solo CONFIRMADA corresponde a una fila de comprobantes_pago. Cerrada: ningún rol de aplicación la lee ni la escribe; se opera por funciones.';
COMMENT ON COLUMN public.cargas_comprobante.sha256_contenido IS
    'SHA-256 de los bytes que el servidor leyó, validó y publicó; el comprobante comparte el id de la carga. Nunca lo informa el cliente. Vive acá y no en comprobantes_pago para no cambiar la tabla de EPT-101.';
COMMENT ON COLUMN public.cargas_comprobante.temporal_eliminado_en IS
    'Cuándo se intentó borrar el objeto temporal. NULL: el objeto puede seguir existiendo.';

CREATE INDEX idx_cargas_comprobante_pago ON public.cargas_comprobante (pago_id, padre_id);
CREATE INDEX idx_cargas_comprobante_preparadas
    ON public.cargas_comprobante (padre_id) WHERE estado = 'PREPARADA';
CREATE INDEX idx_cargas_comprobante_limpieza
    ON public.cargas_comprobante (creado_en) WHERE temporal_eliminado_en IS NULL;

ALTER TABLE public.cargas_comprobante ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cargas_comprobante FROM PUBLIC, anon, authenticated;

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.cargas_comprobante
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

-- ================================================================
-- 3. GUARDA DE AUTORIZACIÓN
-- ================================================================
-- Igual que `padre_para_pagos` (EPT-108), pero con el usuario explícito: las
-- operaciones del servidor reciben el id ya autenticado del token. Con
-- p_bloquear toma FOR SHARE sobre el perfil ANTES de cualquier otra espera.
CREATE FUNCTION app_private.padre_para_comprobantes(p_usuario UUID, p_bloquear BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil UUID;
    v_rol_id INTEGER;
    v_acceso public.estado_acceso;
    v_rol    TEXT;
BEGIN
    IF p_usuario IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF p_bloquear THEN
        SELECT p.id, p.rol_id, p.estado_acceso
        INTO v_perfil, v_rol_id, v_acceso
        FROM public.perfiles p
        WHERE p.user_id = p_usuario
        FOR SHARE OF p;
    ELSE
        SELECT p.id, p.rol_id, p.estado_acceso
        INTO v_perfil, v_rol_id, v_acceso
        FROM public.perfiles p
        WHERE p.user_id = p_usuario;
    END IF;

    IF NOT FOUND OR v_acceso IS DISTINCT FROM 'HABILITADO' THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Solo una familia habilitada puede cargar comprobantes.';
    END IF;

    SELECT r.nombre INTO v_rol FROM public.roles r WHERE r.id = v_rol_id;
    IF v_rol IS DISTINCT FROM 'PADRE' THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Solo una familia habilitada puede cargar comprobantes.';
    END IF;

    RETURN v_perfil;
END;
$$;

REVOKE ALL ON FUNCTION app_private.padre_para_comprobantes(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 4. VALIDACIÓN DE LOS DATOS DE LA TRANSFERENCIA (antes de cualquier cast)
-- ================================================================
-- El importe llega como TEXTO decimal y se valida ANTES de convertirlo: un valor
-- con más de dos decimales se rechaza, no se redondea en silencio. Contrato
-- monetario existente: NUMERIC(12,2) no negativo (10 dígitos enteros). La fecha
-- es una fecha civil finita; no se prohíbe una fecha futura porque no es una
-- regla aprobada. El número conserva la normalización de EPT-100 (recorte de
-- espacios, tabulaciones y saltos de línea; sin cambiar mayúsculas) y solo tiene
-- un tope TÉCNICO de longitud: el índice único es un B-tree cuyas entradas no
-- pueden superar ~2700 bytes.
CREATE FUNCTION app_private.normalizar_datos_transferencia(
    p_fecha TEXT, p_importe TEXT, p_numero TEXT)
RETURNS TABLE (fecha DATE, importe NUMERIC, numero TEXT)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_fecha  DATE;
    v_numero TEXT;
BEGIN
    IF p_fecha IS NULL OR p_fecha !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'La fecha de la transferencia no es válida. Usá el formato AAAA-MM-DD.';
    END IF;
    BEGIN
        v_fecha := p_fecha::DATE;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'La fecha de la transferencia no existe.';
    END;
    IF NOT pg_catalog.isfinite(v_fecha) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'La fecha de la transferencia no es válida.';
    END IF;

    IF p_importe IS NULL OR p_importe !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'El importe debe ser un número no negativo con hasta dos decimales.';
    END IF;

    v_numero := pg_catalog.btrim(p_numero, E' \t\r\n');
    IF v_numero IS NULL OR v_numero = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'Ingresá el número de operación.';
    END IF;
    IF pg_catalog.octet_length(v_numero) > 2000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'El número de operación es demasiado largo.';
    END IF;

    RETURN QUERY SELECT v_fecha, p_importe::NUMERIC(12,2), v_numero;
END;
$$;

REVOKE ALL ON FUNCTION app_private.normalizar_datos_transferencia(TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 5. RESULTADO DURABLE DE UNA CARGA (formato que consume la aplicación)
-- ================================================================
-- No incluye la huella ni el SHA-256 ni la ruta final.
CREATE FUNCTION app_private.carga_a_json(p_carga_id UUID, p_repetido BOOLEAN)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'carga_id', c.id,
        'clave_carga', c.clave_carga,
        'pago_id', c.pago_id,
        'estado', c.estado,
        'motivo_descarte', c.motivo_descarte,
        'bucket_temporal', 'comprobantes-pago-temporal',
        'ruta_temporal', c.ruta_temporal,
        'tipo_mime', c.tipo_mime_declarado,
        'tamano_bytes', c.tamano_declarado,
        'fecha_transferencia', c.fecha_transferencia,
        'importe_centavos', pg_catalog.round(c.importe_informado * 100)::BIGINT,
        'numero_operacion', c.numero_operacion,
        'comprobante_id', CASE WHEN c.estado = 'CONFIRMADA' THEN c.id END,
        'cantidad_archivos', (SELECT pg_catalog.count(*)::INTEGER
                              FROM public.comprobantes_pago x WHERE x.pago_id = c.pago_id),
        'estado_pago', p.estado,
        'creado_en', c.creado_en,
        'resuelto_en', c.resuelto_en,
        'repetido', p_repetido)
    FROM public.cargas_comprobante c
    JOIN public.pagos p ON p.id = c.pago_id
    WHERE c.id = p_carga_id;
$$;

REVOKE ALL ON FUNCTION app_private.carga_a_json(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

-- Cierra una carga PREPARADA (sin efectos si ya estaba cerrada). Lo usan las
-- operaciones de abajo, siempre bajo el bloqueo de la fila.
CREATE FUNCTION app_private.cerrar_carga(p_carga_id UUID, p_estado TEXT, p_motivo TEXT)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.cargas_comprobante
    SET estado = p_estado, motivo_descarte = p_motivo, resuelto_en = NOW()
    WHERE id = p_carga_id AND estado = 'PREPARADA';
$$;

REVOKE ALL ON FUNCTION app_private.cerrar_carga(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 6. PREPARAR (authenticated)
-- ================================================================
CREATE FUNCTION app_private.preparar_carga_comprobante(
    p_clave_carga UUID, p_pago_id UUID, p_fecha TEXT, p_importe TEXT,
    p_numero TEXT, p_tipo_mime TEXT, p_tamano BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre   UUID;
    v_pago    public.pagos;
    v_previa  public.cargas_comprobante;
    v_informa BOOLEAN;
    v_fecha   DATE;
    v_importe NUMERIC;
    v_numero  TEXT;
    v_id      UUID;
    v_huella  TEXT;
BEGIN
    -- 1. Guarda de autorización, ANTES de cualquier espera.
    v_padre := app_private.padre_para_comprobantes((SELECT auth.uid()), TRUE);

    IF p_clave_carga IS NULL OR p_pago_id IS NULL OR p_tipo_mime IS NULL OR p_tamano IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'Faltan la clave de la carga, el pago o los datos del archivo.';
    END IF;
    IF p_tipo_mime NOT IN ('image/jpeg', 'image/png', 'application/pdf') THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'El tipo de archivo no está permitido. Elegí una imagen JPG o PNG, o un PDF.';
    END IF;
    IF p_tamano <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860', MESSAGE = 'El archivo está vacío.';
    END IF;
    IF p_tamano > 5242880 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'El archivo supera el máximo de 5 MB.';
    END IF;

    -- Los tres datos juntos o ninguno (ninguno: el pago ya los tiene).
    v_informa := p_fecha IS NOT NULL OR p_importe IS NOT NULL OR p_numero IS NOT NULL;
    IF v_informa THEN
        IF p_fecha IS NULL OR p_importe IS NULL OR p_numero IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P6860',
                MESSAGE = 'Informá la fecha, el importe y el número de operación juntos.';
        END IF;
        SELECT n.fecha, n.importe, n.numero
        INTO v_fecha, v_importe, v_numero
        FROM app_private.normalizar_datos_transferencia(p_fecha, p_importe, p_numero) n;
    END IF;

    -- 2. Serializa los reintentos del mismo intento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('ept109_carga'),
        pg_catalog.hashtext(v_padre::TEXT || ':' || p_clave_carga::TEXT));

    -- 3. Reintento: se reconoce ANTES de mirar el estado actual del pago, así un
    --    reintento tras aprobarse el pago sigue devolviendo el mismo resultado.
    SELECT c.* INTO v_previa
    FROM public.cargas_comprobante c
    WHERE c.padre_id = v_padre AND c.clave_carga = p_clave_carga;

    IF FOUND THEN
        IF v_previa.pago_id <> p_pago_id
           OR v_previa.tipo_mime_declarado <> p_tipo_mime
           OR v_previa.tamano_declarado <> p_tamano
           OR (v_informa AND (v_previa.fecha_transferencia <> v_fecha
                              OR v_previa.importe_informado <> v_importe
                              OR v_previa.numero_operacion <> v_numero)) THEN
            RAISE EXCEPTION USING ERRCODE = 'P6864',
                MESSAGE = 'Esta carga ya se registró con otros datos. Generá una carga nueva.';
        END IF;
        RETURN app_private.carga_a_json(v_previa.id, TRUE);
    END IF;

    -- 4. Pago propio, de un hijo vinculado hoy y pendiente. Ajeno e inexistente
    --    devuelven el MISMO error.
    SELECT p.* INTO v_pago
    FROM public.pagos p
    WHERE p.id = p_pago_id
      AND p.padre_id = v_padre
      AND EXISTS (SELECT 1 FROM public.padres_hijos ph
                  WHERE ph.padre_id = v_padre AND ph.hijo_id = p.alumno_id);
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6861',
            MESSAGE = 'El pago no existe o no está disponible para tu cuenta.';
    END IF;
    IF v_pago.estado <> 'PENDIENTE_VERIFICACION' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6862',
            MESSAGE = 'El pago ya no está pendiente de verificación.';
    END IF;

    -- 5. Datos de la transferencia: primer registro o carga adicional.
    IF v_pago.numero_operacion IS NOT NULL
       OR v_pago.fecha_transferencia IS NOT NULL
       OR v_pago.importe_informado IS NOT NULL THEN
        IF v_pago.numero_operacion IS NULL
           OR v_pago.fecha_transferencia IS NULL
           OR v_pago.importe_informado IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P6865',
                MESSAGE = 'Los datos de la transferencia de este pago están incompletos. Consultá con la institución.';
        END IF;
        IF v_informa AND (v_pago.fecha_transferencia <> v_fecha
                          OR v_pago.importe_informado <> v_importe
                          OR pg_catalog.btrim(v_pago.numero_operacion, E' \t\r\n') <> v_numero) THEN
            RAISE EXCEPTION USING ERRCODE = 'P6865',
                MESSAGE = 'Los datos difieren de los ya informados para este pago. No se modifican.';
        END IF;
        v_fecha := v_pago.fecha_transferencia;
        v_importe := v_pago.importe_informado;
        v_numero := pg_catalog.btrim(v_pago.numero_operacion, E' \t\r\n');
    ELSE
        IF NOT v_informa THEN
            RAISE EXCEPTION USING ERRCODE = 'P6860',
                MESSAGE = 'Informá la fecha, el importe y el número de operación de la transferencia.';
        END IF;
        -- Aviso temprano. La autoridad es el índice único parcial al confirmar.
        IF EXISTS (SELECT 1 FROM public.pagos o
                   WHERE o.id <> v_pago.id
                     AND o.estado <> 'RECHAZADO'
                     AND o.numero_operacion IS NOT NULL
                     AND pg_catalog.btrim(o.numero_operacion, E' \t\r\n') = v_numero) THEN
            RAISE EXCEPTION USING ERRCODE = 'P6863',
                MESSAGE = 'Ese número de operación ya está registrado en otro pago.';
        END IF;
    END IF;

    -- 6. Tope técnico de cargas sin completar por padre. El conteo se serializa por padre (sin esto, N
    --    preparaciones paralelas con claves distintas lo superarían). Si se alcanza, las cargas PROPIAS
    --    abandonadas hace más de una hora se vencen en el acto: una app cerrada o un archivo cambiado dejan
    --    cargas sin finalizar y el padre no puede quedar bloqueado hasta que alguien corra la conciliación.
    --    El objeto temporal de una carga vencida lo retira la conciliación.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('ept109_cuota'), pg_catalog.hashtext(v_padre::TEXT));
    IF (SELECT pg_catalog.count(*) FROM public.cargas_comprobante c
        WHERE c.padre_id = v_padre AND c.estado = 'PREPARADA') >= 10 THEN
        UPDATE public.cargas_comprobante c
        SET estado = 'EXPIRADA', motivo_descarte = 'EXPIRADA', resuelto_en = NOW()
        WHERE c.padre_id = v_padre AND c.estado = 'PREPARADA'
          AND c.creado_en < NOW() - INTERVAL '1 hour';
        IF (SELECT pg_catalog.count(*) FROM public.cargas_comprobante c
            WHERE c.padre_id = v_padre AND c.estado = 'PREPARADA') >= 10 THEN
            RAISE EXCEPTION USING ERRCODE = 'P6868',
                MESSAGE = 'Tenés demasiadas cargas sin completar. Terminalas o volvé a intentar en una hora.';
        END IF;
    END IF;

    v_id := pg_catalog.gen_random_uuid();
    v_huella := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.concat_ws('|', 'v1', p_pago_id::TEXT, v_fecha::TEXT,
                             v_importe::TEXT, v_numero, p_tipo_mime, p_tamano::TEXT),
        'UTF8')), 'hex');

    INSERT INTO public.cargas_comprobante
        (id, padre_id, pago_id, clave_carga, fecha_transferencia, importe_informado,
         numero_operacion, tipo_mime_declarado, tamano_declarado, huella_solicitud,
         ruta_temporal)
    VALUES
        (v_id, v_padre, p_pago_id, p_clave_carga, v_fecha, v_importe,
         v_numero, p_tipo_mime, p_tamano, v_huella,
         p_pago_id::TEXT || '/' || v_id::TEXT);

    RETURN app_private.carga_a_json(v_id, FALSE);
END;
$$;

-- Resultado de una carga del propio padre: no escribe. Si el mismo intento se
-- está preparando en otra transacción, espera su desenlace.
CREATE FUNCTION app_private.consultar_carga_comprobante(p_clave_carga UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre UUID;
    v_carga UUID;
BEGIN
    v_padre := app_private.padre_para_comprobantes((SELECT auth.uid()), FALSE);
    IF p_clave_carga IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860', MESSAGE = 'Falta la clave de la carga.';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('ept109_carga'),
        pg_catalog.hashtext(v_padre::TEXT || ':' || p_clave_carga::TEXT));
    SELECT c.id INTO v_carga
    FROM public.cargas_comprobante c
    WHERE c.padre_id = v_padre AND c.clave_carga = p_clave_carga;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('registrada', FALSE);
    END IF;
    RETURN pg_catalog.jsonb_build_object('registrada', TRUE)
           || app_private.carga_a_json(v_carga, TRUE);
END;
$$;


-- ================================================================
-- 7. OPERACIONES DEL SERVIDOR (service_role)
-- ================================================================
-- 7.1 Lo que el servidor necesita saber para finalizar. Revalida identidad y
-- propiedad; no devuelve nada de otra cuenta.
CREATE FUNCTION app_private.obtener_carga_para_finalizar(p_usuario_id UUID, p_carga_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre UUID;
    v_carga public.cargas_comprobante;
BEGIN
    v_padre := app_private.padre_para_comprobantes(p_usuario_id, FALSE);
    IF p_carga_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860', MESSAGE = 'Falta la carga.';
    END IF;
    SELECT c.* INTO v_carga
    FROM public.cargas_comprobante c
    WHERE c.id = p_carga_id AND c.padre_id = v_padre;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6866',
            MESSAGE = 'La carga no existe o no está disponible para tu cuenta.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'estado', v_carga.estado,
        'pago_id', v_carga.pago_id,
        'ruta_temporal', v_carga.ruta_temporal,
        'ruta_final', v_carga.pago_id::TEXT || '/' || v_carga.id::TEXT || '.' ||
            CASE v_carga.tipo_mime_declarado
                WHEN 'image/jpeg' THEN 'jpg'
                WHEN 'image/png' THEN 'png'
                WHEN 'application/pdf' THEN 'pdf'
            END,
        'tipo_mime', v_carga.tipo_mime_declarado,
        'tamano_bytes', v_carga.tamano_declarado,
        'resultado', app_private.carga_a_json(v_carga.id, TRUE));
END;
$$;

-- 7.2 Descarta una carga PREPARADA por una causa comprobada fuera de SQL (archivo
-- inválido, contenido que no coincide, objeto ausente) o porque la cuenta dejó
-- de estar habilitada. Idempotente. No exige que la cuenta siga habilitada: solo
-- que la carga sea de ese usuario; no escribe nada económico.
CREATE FUNCTION app_private.descartar_carga_comprobante(
    p_usuario_id UUID, p_carga_id UUID, p_motivo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_carga public.cargas_comprobante;
BEGIN
    IF p_usuario_id IS NULL OR p_carga_id IS NULL
       OR p_motivo IS NULL OR p_motivo NOT IN (
           'ARCHIVO_INVALIDO', 'CONTENIDO_NO_COINCIDE', 'ARCHIVO_AUSENTE',
           'CUENTA_NO_HABILITADA', 'ABANDONADA') THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860', MESSAGE = 'Faltan datos para descartar la carga.';
    END IF;
    SELECT c.* INTO v_carga
    FROM public.cargas_comprobante c
    JOIN public.perfiles p ON p.id = c.padre_id
    WHERE c.id = p_carga_id AND p.user_id = p_usuario_id
    FOR UPDATE OF c;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6866',
            MESSAGE = 'La carga no existe o no está disponible para tu cuenta.';
    END IF;
    PERFORM app_private.cerrar_carga(p_carga_id, 'DESCARTADA', p_motivo);
    RETURN app_private.carga_a_json(p_carga_id, TRUE);
END;
$$;

-- 7.3 Confirma la carga: registra, en UNA transacción, los datos de la
-- transferencia (solo si el pago aún no los tenía) y el comprobante.
-- Los resultados de negocio (archivo que no coincide, pago ya no pendiente,
-- número duplicado, vínculo revocado) se devuelven como JSON con la carga ya
-- cerrada: lanzar una excepción deshacería ese cierre. Solo la identidad y los
-- argumentos mal formados lanzan.
CREATE FUNCTION app_private.confirmar_carga_comprobante(
    p_usuario_id UUID, p_carga_id UUID, p_sha256 TEXT, p_tamano BIGINT, p_tipo_mime TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre  UUID;
    v_clave  UUID;
    v_pago_id UUID;
    v_alumno UUID;
    v_carga  public.cargas_comprobante;
    v_pago   public.pagos;
BEGIN
    -- 1. Guarda: identidad, rol y cuenta VIGENTES, retenidos hasta el fin.
    v_padre := app_private.padre_para_comprobantes(p_usuario_id, TRUE);

    IF p_carga_id IS NULL OR p_tamano IS NULL OR p_tipo_mime IS NULL
       OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860', MESSAGE = 'Faltan datos para confirmar la carga.';
    END IF;

    SELECT c.clave_carga, c.pago_id INTO v_clave, v_pago_id
    FROM public.cargas_comprobante c
    WHERE c.id = p_carga_id AND c.padre_id = v_padre;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6866',
            MESSAGE = 'La carga no existe o no está disponible para tu cuenta.';
    END IF;

    -- 2. Serializa con el intento (mismo consultivo que preparar y consultar).
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('ept109_carga'),
        pg_catalog.hashtext(v_padre::TEXT || ':' || v_clave::TEXT));

    -- 3. Vínculo vigente, FOR SHARE: un DELETE concurrente espera a este COMMIT.
    SELECT p.alumno_id INTO v_alumno FROM public.pagos p WHERE p.id = v_pago_id;
    PERFORM 1 FROM public.padres_hijos ph
    WHERE ph.padre_id = v_padre AND ph.hijo_id = v_alumno
    FOR SHARE;
    IF NOT FOUND THEN
        PERFORM app_private.cerrar_carga(p_carga_id, 'DESCARTADA', 'VINCULO_REVOCADO');
        RETURN app_private.carga_a_json(p_carga_id, FALSE);
    END IF;

    -- 4. Pago y carga bajo bloqueo, en el orden documentado.
    SELECT p.* INTO v_pago FROM public.pagos p WHERE p.id = v_pago_id FOR UPDATE;
    SELECT c.* INTO v_carga FROM public.cargas_comprobante c WHERE c.id = p_carga_id FOR UPDATE;

    IF v_carga.estado = 'CONFIRMADA' THEN
        IF v_carga.sha256_contenido IS DISTINCT FROM p_sha256 THEN
            RAISE EXCEPTION USING ERRCODE = 'P6864',
                MESSAGE = 'Esta carga ya se confirmó con otro contenido.';
        END IF;
        RETURN app_private.carga_a_json(p_carga_id, TRUE);
    END IF;
    IF v_carga.estado <> 'PREPARADA' THEN
        RETURN app_private.carga_a_json(p_carga_id, TRUE);
    END IF;

    -- 5. Lo que el servidor leyó debe ser lo que la carga declaró.
    IF p_tipo_mime <> v_carga.tipo_mime_declarado OR p_tamano <> v_carga.tamano_declarado THEN
        PERFORM app_private.cerrar_carga(p_carga_id, 'DESCARTADA', 'CONTENIDO_NO_COINCIDE');
        RETURN app_private.carga_a_json(p_carga_id, FALSE);
    END IF;

    IF v_pago.estado <> 'PENDIENTE_VERIFICACION' THEN
        PERFORM app_private.cerrar_carga(p_carga_id, 'DESCARTADA', 'PAGO_NO_PENDIENTE');
        RETURN app_private.carga_a_json(p_carga_id, FALSE);
    END IF;

    -- 6. Datos de la transferencia: la primera carga los establece; las demás no
    --    los modifican (si difieren, se descartan, nunca se sobrescriben).
    IF v_pago.numero_operacion IS NULL
       AND v_pago.fecha_transferencia IS NULL
       AND v_pago.importe_informado IS NULL THEN
        BEGIN
            UPDATE public.pagos
            SET fecha_transferencia = v_carga.fecha_transferencia,
                importe_informado = v_carga.importe_informado,
                numero_operacion = v_carga.numero_operacion
            WHERE id = v_pago.id;
        EXCEPTION WHEN unique_violation THEN
            PERFORM app_private.cerrar_carga(p_carga_id, 'DESCARTADA', 'OPERACION_DUPLICADA');
            RETURN app_private.carga_a_json(p_carga_id, FALSE);
        END;
    ELSIF v_pago.fecha_transferencia IS DISTINCT FROM v_carga.fecha_transferencia
          OR v_pago.importe_informado IS DISTINCT FROM v_carga.importe_informado
          OR pg_catalog.btrim(v_pago.numero_operacion, E' \t\r\n')
             IS DISTINCT FROM v_carga.numero_operacion THEN
        PERFORM app_private.cerrar_carga(p_carga_id, 'DESCARTADA', 'DATOS_DIFERENTES');
        RETURN app_private.carga_a_json(p_carga_id, FALSE);
    END IF;

    -- 7. Comprobante + cierre de la carga, en la misma transacción.
    INSERT INTO public.comprobantes_pago
        (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
    VALUES
        (v_carga.id, v_carga.pago_id, v_padre,
         v_carga.pago_id::TEXT || '/' || v_carga.id::TEXT || '.' ||
             CASE v_carga.tipo_mime_declarado
                 WHEN 'image/jpeg' THEN 'jpg'
                 WHEN 'image/png' THEN 'png'
                 WHEN 'application/pdf' THEN 'pdf'
             END,
         v_carga.tipo_mime_declarado, p_tamano);

    UPDATE public.cargas_comprobante
    SET estado = 'CONFIRMADA', sha256_contenido = p_sha256, resuelto_en = NOW()
    WHERE id = v_carga.id;

    RETURN app_private.carga_a_json(v_carga.id, FALSE);
END;
$$;

-- 7.4 Conciliación: cierra por vencimiento las cargas PREPARADA antiguas y lista
-- las cargas cuyo objeto temporal (y, si no se confirmaron, el final huérfano)
-- puede seguir existiendo. NUNCA lista el objeto final de una carga CONFIRMADA ni
-- de una con fila en comprobantes_pago. No cancela pagos ni libera ítems.
CREATE FUNCTION app_private.cargas_comprobante_a_conciliar(p_antiguedad INTERVAL, p_limite INTEGER)
RETURNS TABLE (carga_id UUID, estado TEXT, ruta_temporal TEXT, ruta_final_huerfana TEXT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_antiguedad IS NULL OR p_antiguedad < INTERVAL '1 hour'
       OR p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
        RAISE EXCEPTION USING ERRCODE = 'P6860',
            MESSAGE = 'La antigüedad mínima es de una hora y el límite va de 1 a 500.';
    END IF;

    -- Vence el intento que nadie finalizó. El objeto temporal queda para borrar.
    UPDATE public.cargas_comprobante c
    SET estado = 'EXPIRADA', motivo_descarte = 'EXPIRADA', resuelto_en = NOW()
    WHERE c.estado = 'PREPARADA' AND c.creado_en < NOW() - p_antiguedad;

    RETURN QUERY
    SELECT c.id,
           c.estado,
           c.ruta_temporal,
           CASE WHEN c.estado IN ('DESCARTADA', 'EXPIRADA')
                     AND NOT EXISTS (SELECT 1 FROM public.comprobantes_pago x WHERE x.id = c.id)
                THEN c.pago_id::TEXT || '/' || c.id::TEXT || '.' ||
                     CASE c.tipo_mime_declarado
                         WHEN 'image/jpeg' THEN 'jpg'
                         WHEN 'image/png' THEN 'png'
                         WHEN 'application/pdf' THEN 'pdf'
                     END
           END
    FROM public.cargas_comprobante c
    -- Además de lo pendiente, se re-barre lo cerrado en los últimos 3 días: un token de subida firmado
    -- antes del cierre puede escribir el objeto después de marcarlo como retirado.
    WHERE c.estado <> 'PREPARADA'
      AND (c.temporal_eliminado_en IS NULL OR c.resuelto_en > NOW() - INTERVAL '3 days')
    ORDER BY c.temporal_eliminado_en NULLS FIRST, c.resuelto_en
    LIMIT p_limite;
END;
$$;

CREATE FUNCTION app_private.marcar_temporal_eliminado(p_carga_id UUID)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.cargas_comprobante
    SET temporal_eliminado_en = NOW()
    WHERE id = p_carga_id AND estado <> 'PREPARADA';
$$;

-- Privilegios de las operaciones DEFINER.
REVOKE ALL ON FUNCTION app_private.preparar_carga_comprobante(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_carga_comprobante(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.obtener_carga_para_finalizar(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.descartar_carga_comprobante(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.confirmar_carga_comprobante(UUID, UUID, TEXT, BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cargas_comprobante_a_conciliar(INTERVAL, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.marcar_temporal_eliminado(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION app_private.preparar_carga_comprobante(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_carga_comprobante(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.obtener_carga_para_finalizar(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.descartar_carga_comprobante(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.confirmar_carga_comprobante(UUID, UUID, TEXT, BIGINT, TEXT)
    TO service_role;
GRANT EXECUTE ON FUNCTION app_private.cargas_comprobante_a_conciliar(INTERVAL, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.marcar_temporal_eliminado(UUID) TO service_role;


-- ================================================================
-- 8. ENVOLTORIOS PÚBLICOS (SECURITY INVOKER)
-- ================================================================
CREATE FUNCTION public.preparar_carga_comprobante(
    p_clave_carga UUID, p_pago_id UUID, p_fecha TEXT, p_importe TEXT,
    p_numero TEXT, p_tipo_mime TEXT, p_tamano BIGINT)
RETURNS JSONB
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT app_private.preparar_carga_comprobante(
        p_clave_carga, p_pago_id, p_fecha, p_importe, p_numero, p_tipo_mime, p_tamano); $$;

CREATE FUNCTION public.consultar_carga_comprobante(p_clave_carga UUID)
RETURNS JSONB
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT app_private.consultar_carga_comprobante(p_clave_carga); $$;

CREATE FUNCTION public.obtener_carga_para_finalizar(p_usuario_id UUID, p_carga_id UUID)
RETURNS JSONB
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT app_private.obtener_carga_para_finalizar(p_usuario_id, p_carga_id); $$;

CREATE FUNCTION public.descartar_carga_comprobante(
    p_usuario_id UUID, p_carga_id UUID, p_motivo TEXT)
RETURNS JSONB
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT app_private.descartar_carga_comprobante(p_usuario_id, p_carga_id, p_motivo); $$;

CREATE FUNCTION public.confirmar_carga_comprobante(
    p_usuario_id UUID, p_carga_id UUID, p_sha256 TEXT, p_tamano BIGINT, p_tipo_mime TEXT)
RETURNS JSONB
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT app_private.confirmar_carga_comprobante(
        p_usuario_id, p_carga_id, p_sha256, p_tamano, p_tipo_mime); $$;

CREATE FUNCTION public.cargas_comprobante_a_conciliar(p_antiguedad INTERVAL, p_limite INTEGER)
RETURNS TABLE (carga_id UUID, estado TEXT, ruta_temporal TEXT, ruta_final_huerfana TEXT)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT r.carga_id, r.estado, r.ruta_temporal, r.ruta_final_huerfana
      FROM app_private.cargas_comprobante_a_conciliar(p_antiguedad, p_limite) r; $$;

CREATE FUNCTION public.marcar_temporal_eliminado(p_carga_id UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT app_private.marcar_temporal_eliminado(p_carga_id); $$;

REVOKE ALL ON FUNCTION public.preparar_carga_comprobante(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_carga_comprobante(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.obtener_carga_para_finalizar(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.descartar_carga_comprobante(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirmar_carga_comprobante(UUID, UUID, TEXT, BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cargas_comprobante_a_conciliar(INTERVAL, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.marcar_temporal_eliminado(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.preparar_carga_comprobante(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_carga_comprobante(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_carga_para_finalizar(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.descartar_carga_comprobante(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_carga_comprobante(UUID, UUID, TEXT, BIGINT, TEXT)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.cargas_comprobante_a_conciliar(INTERVAL, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.marcar_temporal_eliminado(UUID) TO service_role;

COMMENT ON FUNCTION public.preparar_carga_comprobante(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) IS
    'EPT-109. Registra el intento de cargar un comprobante del propio pago pendiente: valida actor, pago, tipo, tamaño y datos de la transferencia (importe antes del cast) y devuelve la ruta temporal. Idempotente por (padre, clave). No toca el pago.';
COMMENT ON FUNCTION public.consultar_carga_comprobante(UUID) IS
    'EPT-109. Resultado durable de una carga del propio padre; no escribe. Resuelve una respuesta perdida.';
COMMENT ON FUNCTION public.confirmar_carga_comprobante(UUID, UUID, TEXT, BIGINT, TEXT) IS
    'EPT-109. SOLO service_role. Registra datos de la transferencia y comprobante tras validar los bytes en el servidor. El cliente no puede invocarla.';


-- ================================================================
-- 9. POLÍTICAS DE STORAGE DEL BUCKET TEMPORAL
-- ================================================================
-- ¿Puede el llamante, HOY, subir un objeto a esta ruta temporal? Solo si es una
-- carga PREPARADA propia de un pago pendiente de un hijo vinculado. Lee las
-- tablas como propietario: la política no recurre sobre sí misma.
CREATE FUNCTION app_private.carga_subible(p_ruta TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.cargas_comprobante c
        JOIN public.pagos p ON p.id = c.pago_id
        WHERE c.ruta_temporal = p_ruta
          AND c.estado = 'PREPARADA'
          AND p.estado = 'PENDIENTE_VERIFICACION'
          AND c.padre_id = (SELECT app_private.perfil_padre_actual())
          AND EXISTS (SELECT 1 FROM public.padres_hijos ph
                      WHERE ph.padre_id = c.padre_id AND ph.hijo_id = p.alumno_id)
    );
$$;

REVOKE ALL ON FUNCTION app_private.carga_subible(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.carga_subible(TEXT) TO authenticated;

-- Bloqueo de cuenta, limitado a este bucket.
CREATE POLICY "Comprobantes temporales: bloqueo de acceso"
    ON storage.objects
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (bucket_id <> 'comprobantes-pago-temporal' OR NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (bucket_id <> 'comprobantes-pago-temporal' OR NOT (SELECT app_private.acceso_bloqueado()));

-- Solo INSERT. Ni lectura, ni UPDATE, ni DELETE: nadie reemplaza ni borra el
-- objeto desde un cliente, y los temporales no se pueden leer ni listar. La
-- lectura del bucket FINAL (EPT-101) exige una fila de comprobantes_pago, que un
-- temporal nunca tiene.
-- LÍMITE: la política se evalúa cuando se escribe. Un token de subida firmado
-- (`createSignedUploadUrl`) emitido mientras la carga estaba PREPARADA puede usarse
-- después de cerrarla y dejar un objeto temporal que nadie referencia: nunca se
-- publica (finalizar exige PREPARADA) y la conciliación lo retira.
CREATE POLICY "Comprobantes temporales: carga del padre autorizado"
    ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'comprobantes-pago-temporal'
        AND (SELECT app_private.carga_subible(name))
    );


-- ================================================================
-- 10. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_firma  pg_catalog.regprocedure;
    v_priv   TEXT;
BEGIN
    -- Operaciones del padre: solo authenticated.
    FOREACH v_firma IN ARRAY ARRAY[
        'public.preparar_carga_comprobante(uuid,uuid,text,text,text,text,bigint)'::pg_catalog.regprocedure,
        'public.consultar_carga_comprobante(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-109: % no es SECURITY INVOKER solo para authenticated.', v_firma;
        END IF;
    END LOOP;

    -- Operaciones del servidor: solo service_role. Un cliente nunca declara
    -- «validado» un archivo.
    FOREACH v_firma IN ARRAY ARRAY[
        'public.obtener_carga_para_finalizar(uuid,uuid)'::pg_catalog.regprocedure,
        'public.descartar_carga_comprobante(uuid,uuid,text)'::pg_catalog.regprocedure,
        'public.confirmar_carga_comprobante(uuid,uuid,text,bigint,text)'::pg_catalog.regprocedure,
        'public.cargas_comprobante_a_conciliar(interval,integer)'::pg_catalog.regprocedure,
        'public.marcar_temporal_eliminado(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-109: % debe ser invocable solo por service_role.', v_firma;
        END IF;
    END LOOP;

    -- Auxiliares: ningún rol de aplicación.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.padre_para_comprobantes(uuid,boolean)'::pg_catalog.regprocedure,
        'app_private.normalizar_datos_transferencia(text,text,text)'::pg_catalog.regprocedure,
        'app_private.carga_a_json(uuid,boolean)'::pg_catalog.regprocedure,
        'app_private.cerrar_carga(uuid,text,text)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'EPT-109: el auxiliar % no debe tener EXECUTE para roles de aplicación.', v_firma;
        END IF;
    END LOOP;

    -- cargas_comprobante: cerrada.
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
            WHERE c.oid = 'public.cargas_comprobante'::pg_catalog.regclass) THEN
        RAISE EXCEPTION 'EPT-109: cargas_comprobante no tiene RLS habilitada.';
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                  'REFERENCES', 'TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege('anon', 'public.cargas_comprobante', v_priv)
           OR pg_catalog.has_table_privilege('authenticated', 'public.cargas_comprobante', v_priv) THEN
            RAISE EXCEPTION 'EPT-109: un rol de aplicación tiene % sobre cargas_comprobante.', v_priv;
        END IF;
    END LOOP;

    -- Un cliente sigue sin poder escribir comprobantes ni leer temporales.
    IF pg_catalog.has_table_privilege('authenticated', 'public.comprobantes_pago', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.comprobantes_pago', 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.pagos', 'UPDATE') THEN
        RAISE EXCEPTION 'EPT-109: un rol de aplicación obtuvo escritura directa sobre pagos o comprobantes.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
               WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                 AND p.permissive = 'PERMISSIVE'
                 AND p.cmd IN ('UPDATE', 'DELETE', 'ALL')
                 AND (p.qual ~ 'comprobantes-pago' OR p.with_check ~ 'comprobantes-pago')) THEN
        RAISE EXCEPTION 'EPT-109: hay una política permisiva de UPDATE/DELETE sobre los buckets de comprobantes.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
               WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                 AND p.permissive = 'PERMISSIVE' AND p.cmd = 'SELECT'
                 AND p.qual ~ 'comprobantes-pago-temporal') THEN
        RAISE EXCEPTION 'EPT-109: el bucket temporal no debe tener política de lectura.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM storage.buckets b
                   WHERE b.id = 'comprobantes-pago-temporal' AND b.public = FALSE
                     AND b.file_size_limit = 5242880) THEN
        RAISE EXCEPTION 'EPT-109: el bucket temporal no quedó privado y limitado a 5 MiB.';
    END IF;
END $$;
