-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-101 (P3-WU-SEC1)
-- Seguridad del módulo económico: RLS por actor, `comprobantes_pago` y
-- bucket privado de Storage
-- ============================================================
--
-- QUÉ AGREGA
--   · Lectura por actor sobre las ocho tablas de EPT-100. Ninguna escritura
--     directa: EPT-100 dejó las ocho tablas cerradas y esta migración solo abre
--     SELECT, según la matriz de abajo.
--   · public.comprobantes_pago: metadatos de los archivos de comprobante (varios
--     por pago). Aprobada por el usuario el 05/10/2026 dentro de EPT-101.
--   · public.resumen_comprobantes_pago(uuid): exposición mínima y saneada del
--     «registro del comprobante» (EPT-98, RF12), sin ruta ni MIME ni cargador.
--   · Bucket privado `comprobantes-pago` con restricción de MIME y tamaño en
--     Storage, y las dos políticas de `storage.objects` estrictamente necesarias.
--
-- MATRIZ DE LECTURA (la identidad sale de auth.uid() y del perfil VIGENTE en la
-- base: nunca de user_metadata, de un rol enviado por el cliente ni de un
-- prefijo de ruta)
--   Tabla                | DIRECTOR | PADRE (hijo vinculado hoy)  | ESTUDIANTE (propio)
--   facturas             | todas    | las de sus hijos            | las propias
--   items_factura        | todos    | los de sus hijos            | los propios
--   pagos                | todos    | los de sus hijos, también   | los propios
--                        |          | los hechos por un copadre   |
--   imputaciones_pago    | todas    | las de sus hijos            | las propias
--   recibos              | todos    | los de sus hijos            | los propios
--   comprobantes_pago    | todos    | SOLO los que cargó él       | ninguno
--   tarifas, feriados,   | todos    | ninguno                     | ninguno
--   envios_correo        |          |                             |
--   DOCENTE, PERSONAL, anon, desconocido y bloqueado: ninguna lectura.
--   Un copadre ve el historial económico del hijo (el pago del otro padre) pero
--   NO el archivo que el otro cargó: por eso los pagos no se filtran por
--   `pagos.padre_id`, y `comprobantes_pago` sí por `subido_por`.
--
-- EXPOSICIÓN MÍNIMA DE CATÁLOGOS Y AUDITORÍA
--   `tarifas`, `feriados` y `envios_correo` solo las lee el DIRECTOR: PADRE y
--   ESTUDIANTE ven el importe y el tipo de cada ítem copiado en `items_factura`,
--   no el catálogo vigente, y `envios_correo.ultimo_error` y los estados internos
--   de entrega no son información de las familias. No existe un portal de
--   administración de correo en esta unidad.
--
-- GRANT Y POLÍTICA SON BARRERAS DISTINTAS
--   · Solo SELECT (y por columna en `recibos`) para `authenticated`; nada para
--     `anon`; sin INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ni
--     secuencias. Las escrituras llegarán con las RPC de negocio de EPT-102 en
--     adelante, que validan actor, importes previos al cast y atomicidad.
--   · `recibos.archivo_path` queda fuera del GRANT para todo rol de aplicación:
--     es la ruta de un PDF en un bucket que no existe todavía y EPT-110 definirá
--     cómo se expone (URL firmada bajo RLS). Hasta entonces no se filtra la ruta.
--   · `pagos.verificado_por` (id del perfil del DIRECTOR que decidió) y
--     `numero_operacion` se leen en el historial del hijo: son datos de la propia
--     familia. `perfiles` sigue protegida por sus propias políticas.
--   · RLS no limita al propietario ni a `service_role` (bypass): esos roles
--     privilegiados conservan acceso completo y son la frontera de confianza de
--     las RPC y de los procesos de servidor. Esta matriz protege a los roles de
--     cliente (`anon`, `authenticated`), no a ellos.
--
-- COMPROBANTES: CORRESPONDENCIA CON EL MER (EPT-91/98)
--   `comprobantes_pago` usa exactamente los nombres del MER: `id`, `pago_id`,
--   `ruta_archivo`, `tipo_mime`, `tamano_bytes`, `subido_por` (+ `creado_en`).
--   La ruta del objeto dentro del bucket es `<pago_id>/<id>.<ext>` y un CHECK la
--   ata al pago, al id del comprobante y al tipo MIME: no se puede registrar el
--   archivo de un pago bajo la carpeta de otro, ni usar `..` ni nombres libres.
--   Límite: 5 MiB = 5 * 1024 * 1024 = 5242880 bytes, igual en el CHECK y en el
--   bucket. Tipos: image/jpeg, image/png y application/pdf.
--   No hay máximo de archivos por pago (aprobado: varios por pago).
--
-- CONTRATO PARA EPT-109 (registro y carga; NO implementado aquí)
--   · Los clientes no insertan metadatos ni suben objetos: no existe GRANT de
--     INSERT sobre `comprobantes_pago` ni política de INSERT/UPDATE/DELETE en
--     `storage.objects`. La RPC `adjuntar_comprobante` (SECURITY DEFINER) será
--     quien cree el id, valide que el actor es el padre del pago (auth.uid() +
--     perfil vigente) y registre la fila con la ruta canónica.
--   · La carga del binario la hace el servidor con credenciales de servidor
--     sobre esa ruta canónica, o EPT-109 habilita una política de INSERT acotada
--     a una ruta ya registrada; en ambos casos concuerdan bucket, ruta y fila.
--   · El MIME declarado y el tamaño no prueban el contenido: la validación real
--     del binario (firma de archivo) es de EPT-109.
--   · Sin upsert, reemplazo, borrado ni cambio de propietario sin autorización
--     de negocio.
--
-- URLs FIRMADAS
--   Se emiten con las credenciales del usuario (no con la clave de servicio) y
--   exigen la política de SELECT de abajo. Es una capacidad temporal: una URL ya
--   emitida sigue sirviendo hasta que vence aunque la cuenta se bloquee o el
--   vínculo cambie después; Storage nativo no ofrece revocación instantánea. El
--   bloqueo impide NUEVAS lecturas y NUEVAS firmas. TTL recomendado: 60 segundos;
--   máximo admitido por el contrato: 300 segundos. No se agrega un proxy.
--
-- ANTI-RECURSIÓN
--   Los helpers son SECURITY DEFINER con search_path vacío y leen `perfiles`,
--   `roles` y `padres_hijos` como propietario (sin RLS): evaluarlos desde una
--   política no recurre. Las políticas de `comprobantes_pago` y de
--   `storage.objects` consultan `pagos`/`comprobantes_pago` bajo RLS del
--   invocador; ninguna política de esas tablas consulta a quien las consulta.

-- ================================================================
-- 1. AUXILIARES DE AUTORIZACIÓN (app_private; no expuesto por PostgREST)
-- ================================================================
-- ¿El llamante, HOY, puede ver la economía de este alumno?
--   DIRECTOR habilitado: sí.
--   PADRE habilitado con vínculo vigente en padres_hijos: sí.
--   ESTUDIANTE habilitado, solo si el alumno es su propio perfil: sí.
--   Cualquier otro rol, perfil bloqueado o sin perfil: no.
CREATE OR REPLACE FUNCTION app_private.alumno_economico_visible(p_alumno_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        JOIN public.roles r ON r.id = p.rol_id
        WHERE p.user_id = (SELECT auth.uid())
          AND p.estado_acceso = 'HABILITADO'
          AND (
              r.nombre = 'DIRECTOR'
              OR (r.nombre = 'PADRE' AND EXISTS (
                      SELECT 1 FROM public.padres_hijos ph
                      WHERE ph.padre_id = p.id AND ph.hijo_id = p_alumno_id))
              OR (r.nombre = 'ESTUDIANTE' AND p.id = p_alumno_id)
          )
    );
$$;

-- Perfil del llamante si es un PADRE habilitado; NULL en cualquier otro caso.
CREATE OR REPLACE FUNCTION app_private.perfil_padre_actual()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id
    FROM public.perfiles p
    JOIN public.roles r ON r.id = p.rol_id
    WHERE p.user_id = (SELECT auth.uid())
      AND p.estado_acceso = 'HABILITADO'
      AND r.nombre = 'PADRE'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_private.alumno_economico_visible(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.perfil_padre_actual()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.alumno_economico_visible(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.perfil_padre_actual() TO authenticated;

COMMENT ON FUNCTION app_private.alumno_economico_visible(UUID) IS
    'EPT-101. Verdadero si el llamante (auth.uid(), perfil vigente) es DIRECTOR, PADRE vinculado hoy al alumno o el propio ESTUDIANTE. Un perfil bloqueado o con otro rol recibe falso. Solo informa sobre el propio llamante.';
COMMENT ON FUNCTION app_private.perfil_padre_actual() IS
    'EPT-101. Perfil del llamante si es PADRE habilitado; NULL en otro caso.';


-- ================================================================
-- 2. PAGOS: pareja (id, padre_id) e índices de las políticas
-- ================================================================
-- Soporte de la FK compuesta de `comprobantes_pago`: el cargador de un archivo
-- es el padre del pago, por construcción. `id` ya es único: la restricción solo
-- agrega la pareja como destino de clave foránea y no cambia ninguna regla.
ALTER TABLE public.pagos
    ADD CONSTRAINT pagos_id_padre_unico UNIQUE (id, padre_id);

-- Las políticas filtran por `alumno_id`: `facturas` e `pagos` ya lo indexan por
-- prefijo (UNIQUE y idx_pagos_alumno). Los otros dos lo necesitan.
CREATE INDEX idx_items_factura_alumno
    ON public.items_factura (alumno_id);
CREATE INDEX idx_imputaciones_pago_alumno
    ON public.imputaciones_pago (alumno_id);


-- ================================================================
-- 3. COMPROBANTES DE PAGO
-- ================================================================
CREATE TABLE public.comprobantes_pago (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    pago_id UUID NOT NULL,
    -- Padre que cargó el archivo: es el padre del pago (FK compuesta).
    subido_por UUID NOT NULL,
    -- Ruta del objeto dentro del bucket `comprobantes-pago`: <pago_id>/<id>.<ext>.
    ruta_archivo TEXT NOT NULL,
    tipo_mime TEXT NOT NULL,
    -- Bytes. Máximo 5 MiB = 5 * 1024 * 1024 = 5242880, igual que el bucket.
    tamano_bytes BIGINT NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT comprobantes_pago_pago_padre_fk
        FOREIGN KEY (pago_id, subido_por)
        REFERENCES public.pagos (id, padre_id) ON DELETE RESTRICT,
    CONSTRAINT comprobantes_pago_ruta_unica UNIQUE (ruta_archivo),
    CONSTRAINT comprobantes_pago_tipo_mime_valido
        CHECK (tipo_mime IN ('image/jpeg', 'image/png', 'application/pdf')),
    CONSTRAINT comprobantes_pago_tamano_valido
        CHECK (tamano_bytes > 0 AND tamano_bytes <= 5242880),
    -- Ata la ruta al pago, al id del comprobante y al tipo: sin traversal, sin
    -- carpetas ajenas y sin nombres libres.
    CONSTRAINT comprobantes_pago_ruta_coherente CHECK (
        ruta_archivo = pago_id::TEXT || '/' || id::TEXT || '.' ||
            CASE tipo_mime
                WHEN 'image/jpeg' THEN 'jpg'
                WHEN 'image/png' THEN 'png'
                WHEN 'application/pdf' THEN 'pdf'
            END),
    -- `infinity` es un TIMESTAMPTZ válido y `DEFAULT NOW()` no lo impide.
    CONSTRAINT comprobantes_pago_creado_en_finito CHECK (pg_catalog.isfinite(creado_en))
);

COMMENT ON TABLE public.comprobantes_pago IS
    'Metadatos de los archivos de comprobante de un pago (varios por pago, sin máximo). El archivo vive en el bucket privado `comprobantes-pago`; solo lo lee quien lo cargó y el DIRECTOR. Esta tabla no prueba el contenido binario: el MIME declarado y la validación real del archivo son fronteras distintas (EPT-109).';
COMMENT ON COLUMN public.comprobantes_pago.ruta_archivo IS
    'Ruta del objeto en el bucket `comprobantes-pago`: <pago_id>/<id>.<jpg|png|pdf>, forzada por CHECK. Dato sensible: no se expone por joins, vistas ni RPC.';
COMMENT ON COLUMN public.comprobantes_pago.tamano_bytes IS
    'Bytes del archivo, entre 1 y 5242880 (5 MiB = 5 * 1024 * 1024), la misma conversión que `file_size_limit` del bucket.';
COMMENT ON COLUMN public.comprobantes_pago.subido_por IS
    'Perfil del padre que cargó el archivo; la FK compuesta con pago_id exige que sea el padre del pago.';

-- Soporte de la FK compuesta y de las lecturas por cargador. La ruta ya tiene el
-- índice de su UNIQUE (lo usa la política de Storage).
CREATE INDEX idx_comprobantes_pago_pago_subido
    ON public.comprobantes_pago (pago_id, subido_por);
CREATE INDEX idx_comprobantes_pago_subido_por
    ON public.comprobantes_pago (subido_por);

ALTER TABLE public.comprobantes_pago ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comprobantes_pago FROM PUBLIC, anon, authenticated;

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.comprobantes_pago
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));


-- ================================================================
-- 4. LECTURA POR ACTOR
-- ================================================================
-- Facturas, ítems, pagos e imputaciones: DIRECTOR, PADRE vinculado hoy y
-- ESTUDIANTE propio, por `alumno_id`.
CREATE POLICY "Lectura económica por actor" ON public.facturas
    FOR SELECT TO authenticated
    USING ((SELECT app_private.alumno_economico_visible(alumno_id)));
CREATE POLICY "Lectura económica por actor" ON public.items_factura
    FOR SELECT TO authenticated
    USING ((SELECT app_private.alumno_economico_visible(alumno_id)));
CREATE POLICY "Lectura económica por actor" ON public.pagos
    FOR SELECT TO authenticated
    USING ((SELECT app_private.alumno_economico_visible(alumno_id)));
CREATE POLICY "Lectura económica por actor" ON public.imputaciones_pago
    FOR SELECT TO authenticated
    USING ((SELECT app_private.alumno_economico_visible(alumno_id)));

-- Recibos: quien ve el pago ve su recibo (la política de `pagos` se aplica a la
-- subconsulta con las credenciales del invocador).
CREATE POLICY "Lectura económica por actor" ON public.recibos
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.pagos p WHERE p.id = recibos.pago_id));

-- Catálogo, feriados y auditoría de correo: solo DIRECTOR.
CREATE POLICY "Lectura económica de Dirección" ON public.tarifas
    FOR SELECT TO authenticated
    USING ((SELECT app_private.es_director()));
CREATE POLICY "Lectura económica de Dirección" ON public.feriados
    FOR SELECT TO authenticated
    USING ((SELECT app_private.es_director()));
CREATE POLICY "Lectura económica de Dirección" ON public.envios_correo
    FOR SELECT TO authenticated
    USING ((SELECT app_private.es_director()));

-- Comprobantes: DIRECTOR todos; PADRE solo los que cargó y mientras siga
-- vinculado al hijo del pago (la subconsulta a `pagos` aplica su política).
CREATE POLICY "Lectura de comprobantes del cargador y Dirección" ON public.comprobantes_pago
    FOR SELECT TO authenticated
    USING (
        (SELECT app_private.es_director())
        OR (
            subido_por = (SELECT app_private.perfil_padre_actual())
            AND EXISTS (SELECT 1 FROM public.pagos p WHERE p.id = comprobantes_pago.pago_id)
        )
    );

GRANT SELECT ON public.tarifas TO authenticated;
GRANT SELECT ON public.facturas TO authenticated;
GRANT SELECT ON public.items_factura TO authenticated;
GRANT SELECT ON public.pagos TO authenticated;
GRANT SELECT ON public.imputaciones_pago TO authenticated;
GRANT SELECT ON public.feriados TO authenticated;
GRANT SELECT ON public.envios_correo TO authenticated;
GRANT SELECT ON public.comprobantes_pago TO authenticated;
-- Sin `archivo_path`: ver el encabezado.
GRANT SELECT (id, pago_id, numero, emitido_en) ON public.recibos TO authenticated;


-- ================================================================
-- 5. REGISTRO DEL COMPROBANTE SIN LA RUTA (RPC mínima)
-- ================================================================
-- Responde «¿este pago tiene comprobante y cuántos?» a quien ve el pago (DIRECTOR,
-- PADRE vinculado, ESTUDIANTE propio), SIN ruta, tipo, tamaño ni cargador. No es
-- una vista de facturación: una fila por pago consultado. Un pago inexistente,
-- ajeno o consultado por un bloqueado devuelve cero filas, sin distinguirlos.
CREATE OR REPLACE FUNCTION app_private.resumen_comprobantes_pago(p_pago_id UUID)
RETURNS TABLE (pago_id UUID, cantidad_archivos INTEGER, ultima_carga_en TIMESTAMP WITH TIME ZONE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id,
           pg_catalog.count(c.id)::INTEGER,
           pg_catalog.max(c.creado_en)
    FROM public.pagos p
    LEFT JOIN public.comprobantes_pago c ON c.pago_id = p.id
    WHERE p.id = p_pago_id
      AND (SELECT app_private.alumno_economico_visible(p.alumno_id))
    GROUP BY p.id;
$$;

REVOKE ALL ON FUNCTION app_private.resumen_comprobantes_pago(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.resumen_comprobantes_pago(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.resumen_comprobantes_pago(p_pago_id UUID)
RETURNS TABLE (pago_id UUID, cantidad_archivos INTEGER, ultima_carga_en TIMESTAMP WITH TIME ZONE)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT r.pago_id, r.cantidad_archivos, r.ultima_carga_en
    FROM app_private.resumen_comprobantes_pago(p_pago_id) r;
$$;

REVOKE ALL ON FUNCTION public.resumen_comprobantes_pago(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resumen_comprobantes_pago(UUID) TO authenticated;

COMMENT ON FUNCTION public.resumen_comprobantes_pago(UUID) IS
    'EPT-101. Registro saneado del comprobante de un pago visible para el llamante: pago_id, cantidad de archivos y fecha de la última carga. Sin ruta, MIME, tamaño ni cargador. Cero filas si el pago no existe o no es visible.';


-- ================================================================
-- 6. BUCKET PRIVADO Y POLÍTICAS DE STORAGE
-- ================================================================
-- El bucket restringe MIME y tamaño en el servicio (no solo en SQL). Re-ejecutar
-- la migración sobre un bucket existente restablece estos valores.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprobantes-pago', 'comprobantes-pago', FALSE, 5242880,
        ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
    SET public = FALSE,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

-- Bloqueo de cuenta, limitado a este bucket: no altera la política de otros.
CREATE POLICY "Comprobantes de pago: bloqueo de acceso"
    ON storage.objects
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (bucket_id <> 'comprobantes-pago' OR NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (bucket_id <> 'comprobantes-pago' OR NOT (SELECT app_private.acceso_bloqueado()));

-- Lectura (descarga, listado y firma de URL): únicamente de objetos que tienen un
-- registro en `comprobantes_pago` visible para el llamante. La autoridad es el
-- registro (cargador o DIRECTOR vigentes), no el prefijo de la ruta. No hay
-- política de INSERT, UPDATE ni DELETE: la escritura de clientes queda cerrada
-- hasta EPT-109.
CREATE POLICY "Comprobantes de pago: lectura por cargador y Dirección"
    ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'comprobantes-pago'
        AND EXISTS (
            SELECT 1 FROM public.comprobantes_pago c
            WHERE c.ruta_archivo = objects.name
        )
    );


-- ================================================================
-- 7. AUTOVERIFICACIÓN
-- ================================================================
-- Si una migración futura o un default de plataforma abriera más de lo aprobado,
-- esta migración falla en lugar de dejarlo abierto en silencio.
DO $$
DECLARE
    v_tabla TEXT;
    v_privilegio TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY[
        'tarifas', 'facturas', 'items_factura', 'pagos', 'imputaciones_pago',
        'recibos', 'feriados', 'envios_correo', 'comprobantes_pago'
    ] LOOP
        IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
                WHERE c.oid = pg_catalog.to_regclass('public.' || v_tabla)) THEN
            RAISE EXCEPTION 'EPT-101: la tabla % no tiene RLS habilitada.', v_tabla;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                   WHERE p.schemaname = 'public' AND p.tablename = v_tabla
                     AND p.permissive = 'PERMISSIVE'
                     AND (p.cmd <> 'SELECT' OR p.roles <> ARRAY['authenticated']::NAME[])) THEN
            RAISE EXCEPTION 'EPT-101: la tabla % tiene una política permisiva que no es SELECT para authenticated.', v_tabla;
        END IF;
        FOREACH v_privilegio IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF pg_catalog.has_table_privilege('anon', 'public.' || v_tabla, v_privilegio) THEN
                RAISE EXCEPTION 'EPT-101: anon tiene % sobre %.', v_privilegio, v_tabla;
            END IF;
            IF v_privilegio <> 'SELECT'
               AND pg_catalog.has_table_privilege('authenticated', 'public.' || v_tabla, v_privilegio) THEN
                RAISE EXCEPTION 'EPT-101: authenticated tiene % sobre %.', v_privilegio, v_tabla;
            END IF;
        END LOOP;
        IF pg_catalog.has_any_column_privilege('authenticated', 'public.' || v_tabla, 'INSERT')
           OR pg_catalog.has_any_column_privilege('authenticated', 'public.' || v_tabla, 'UPDATE')
           OR pg_catalog.has_any_column_privilege('authenticated', 'public.' || v_tabla, 'REFERENCES') THEN
            RAISE EXCEPTION 'EPT-101: authenticated tiene un grant por columna de escritura sobre %.', v_tabla;
        END IF;
    END LOOP;

    IF pg_catalog.has_column_privilege('authenticated', 'public.recibos', 'archivo_path', 'SELECT') THEN
        RAISE EXCEPTION 'EPT-101: recibos.archivo_path no debe leerse por authenticated.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.buckets b
                   WHERE b.id = 'comprobantes-pago' AND b.public = FALSE
                     AND b.file_size_limit = 5242880) THEN
        RAISE EXCEPTION 'EPT-101: el bucket comprobantes-pago no quedó privado y limitado a 5 MiB.';
    END IF;
END;
$$;
