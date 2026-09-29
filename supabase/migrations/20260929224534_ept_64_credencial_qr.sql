-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Credencial digital QR por alumno (EPT-64, RF20)
-- ============================================================
-- Migración aditiva. No modifica ni renumera ninguna migración anterior y no
-- altera ninguna tabla, vista, función ni trigger existente.
--
-- ============================================================
-- CONTRATO APROBADO (resumen de lo que esta migración hace cumplir)
-- ============================================================
--   1. Cada alumno tiene COMO MÁXIMO una credencial ACTIVA (índice único
--      parcial). Cada emisión es una fila histórica propia.
--   2. Reponer revoca la vigente y emite otra en UNA sola transacción. Una
--      credencial revocada no vuelve a valer ni se borra: la tabla es
--      append-only (sin DELETE, TRUNCATE ni UPDATE arbitrario, ni siquiera
--      para el propietario) y la única mutación admitida es ACTIVA → REVOCADA.
--   3. Solo Dirección habilitada emite, repone, revoca y consulta el historial
--      completo. El alumno lee las suyas y el padre las de hijos actualmente
--      vinculados; docente, PERSONAL, anónimo, bloqueados, sin perfil y padres
--      no vinculados no leen nada.
--   4. La base NO guarda el payload del QR, ni su MAC, ni la clave de firma. Solo
--      guarda un identificador aleatorio y el identificador de la clave
--      (`clave_kid`) con la que el servidor firmó. Con lo que hay en la base es
--      imposible reconstruir un QR válido: falta la clave, que vive solo en la
--      configuración del servidor.
--   5. La validez efectiva es credencial ACTIVA + alumno ACTIVO + perfil del
--      alumno HABILITADO. Se calcula AL CONSULTAR; no hay ningún trigger sobre
--      alumnos, matrículas ni perfiles. Inactivar o bloquear invalida; reactivar
--      restaura la validez de la MISMA credencial si sigue ACTIVA.
--   6. Cambiar curso, DNI o legajo no toca esta tabla.
--
-- Fuera de alcance (EPT-65): escanear, registrar accesos, elegibilidad de
-- comedor o transporte. La función `consultar_validez_credencial_qr` es la
-- interfaz mínima para esa historia: hoy solo la ejecuta Dirección y el
-- servidor la invoca DESPUÉS de validar formato y firma HMAC. NO concede
-- permisos de escáner a PERSONAL ni a otro rol.
--
-- ============================================================
-- POR QUÉ LA FIRMA NO SE COMPRUEBA EN LA BASE
-- ============================================================
-- Una función que recibe solo un `id` no verifica un QR: cualquiera que conozca
-- o adivine un identificador la usaría como oráculo de existencia y estado. La
-- barrera criptográfica (formato, versión, kid, HMAC-SHA256 en tiempo constante)
-- está en el servidor, que es el único que tiene la clave. Para que la base no
-- sea un atajo, `consultar_validez_credencial_qr` exige Dirección habilitada, y
-- la lectura directa de la tabla solo entrega filas a quien ya podía leerlas.
--
-- ============================================================
-- ORDEN DE BLOQUEOS Y CARRERAS
-- ============================================================
-- Sigue el dominio de alumnos (008, 013, 014): PRIMERO la fila de `alumnos`,
-- después la de la credencial.
--   * emitir:  alumnos FOR NO KEY UPDATE → se comprueba que no haya ACTIVA → INSERT.
--   * reponer / revocar: se lee (sin bloquear) el alumno dueño de la credencial,
--     que es inmutable; alumnos FOR NO KEY UPDATE; credencial FOR UPDATE y se
--     relee su estado; UPDATE (revocar) e INSERT (reponer).
--
--   Dos emisiones simultáneas ..... la segunda espera el candado del alumno,
--                                   encuentra la ACTIVA de la primera y falla
--                                   con P5621. Nunca hay dos ACTIVAS (además lo
--                                   garantiza el índice único parcial).
--   Dos reposiciones simultáneas .. la segunda encuentra la credencial ya
--                                   revocada y falla con P5623: no reemplaza a
--                                   la credencial nueva de la primera.
--   Reposición frente a revocación  gana quien tome primero el candado del
--                                   alumno; el otro falla con P5623.
--   Cambio de estado del alumno ... inactivar_alumno / reactivar_alumno toman
--                                   alumnos FOR UPDATE, que conflictúa con FOR NO
--                                   KEY UPDATE: se serializan sin ciclos de
--                                   espera, porque las dos rutas toman
--                                   alumnos antes que cualquier otra fila.
--
-- ============================================================
-- CÓDIGOS DE ERROR (P562x, sin colisión con P5500–P5612, P5901–P5975, P6201–P6301)
-- ============================================================
--   P5505  sin identidad autenticada          42501  no es Dirección habilitada
--   P5620  el alumno no existe                P5621  el alumno ya tiene credencial activa
--   P5622  la credencial no existe            P5623  la credencial ya no está vigente
--   P5624  motivo inválido                    P5625  identificador de clave inválido
--   P5626  el historial es de solo agregado


-- ================================================================
-- 1. TIPO Y TABLA
-- ================================================================
CREATE TYPE public.estado_credencial_qr AS ENUM ('ACTIVA', 'REVOCADA');

CREATE TABLE public.credenciales_qr (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alumno_id         UUID NOT NULL
                      REFERENCES public.alumnos (perfil_id) ON DELETE RESTRICT,
    estado            public.estado_credencial_qr NOT NULL DEFAULT 'ACTIVA',
    clave_kid         TEXT NOT NULL,
    emitida_en        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    emitida_por       UUID NOT NULL
                      REFERENCES public.perfiles (id) ON DELETE RESTRICT,
    reemplaza_a       UUID REFERENCES public.credenciales_qr (id) ON DELETE RESTRICT,
    revocada_en       TIMESTAMP WITH TIME ZONE,
    revocada_por      UUID REFERENCES public.perfiles (id) ON DELETE RESTRICT,
    motivo_revocacion TEXT,

    CONSTRAINT credenciales_qr_kid_valido CHECK (clave_kid ~ '^[a-z0-9]{1,16}$'),
    CONSTRAINT credenciales_qr_no_se_reemplaza_a_si_misma CHECK (reemplaza_a IS DISTINCT FROM id),
    CONSTRAINT credenciales_qr_motivo_valido CHECK (
        motivo_revocacion IS NULL
        OR (pg_catalog.char_length(motivo_revocacion) BETWEEN 3 AND 200
            AND motivo_revocacion = pg_catalog.btrim(motivo_revocacion))
    ),
    -- Coherencia de estado: una ACTIVA no lleva datos de revocación y una
    -- REVOCADA los lleva completos.
    CONSTRAINT credenciales_qr_estado_coherente CHECK (
        (estado = 'ACTIVA'
            AND revocada_en IS NULL AND revocada_por IS NULL AND motivo_revocacion IS NULL)
        OR (estado = 'REVOCADA'
            AND revocada_en IS NOT NULL AND revocada_por IS NOT NULL
            AND motivo_revocacion IS NOT NULL AND revocada_en >= emitida_en)
    )
);

COMMENT ON TABLE public.credenciales_qr IS
    'Credenciales digitales QR de los alumnos (RF20). Append-only: cada emisión es una fila; la única mutación admitida es ACTIVA → REVOCADA, por una operación autorizada. No guarda el payload, el MAC ni la clave de firma: el QR solo se reconstruye en el servidor con la clave. Máximo una ACTIVA por alumno.';
COMMENT ON COLUMN public.credenciales_qr.id IS
    'Identificador aleatorio (UUID v4) que viaja en el QR junto con la versión, el kid y la firma. No es un secreto: la firma HMAC lo es.';
COMMENT ON COLUMN public.credenciales_qr.clave_kid IS
    'Identificador de la clave de servidor con la que se firmó. Permite rotar la clave sin invalidar las credenciales vigentes. No es la clave.';
COMMENT ON COLUMN public.credenciales_qr.emitida_por IS
    'Perfil de Dirección que emitió. Dato interno: ningún rol de aplicación lo lee por la tabla (privilegios por columna).';
COMMENT ON COLUMN public.credenciales_qr.motivo_revocacion IS
    'Motivo escrito por Dirección. Dato interno: ningún rol de aplicación lo lee por la tabla (privilegios por columna).';

-- Como máximo UNA credencial ACTIVA por alumno. Es la autoridad final de la
-- unicidad ante cualquier carrera; también cubre la clave foránea a alumnos.
CREATE UNIQUE INDEX idx_credenciales_qr_una_activa_por_alumno
    ON public.credenciales_qr (alumno_id)
    WHERE estado = 'ACTIVA';

-- Historial del alumno, más reciente primero.
CREATE INDEX idx_credenciales_qr_alumno_emitida
    ON public.credenciales_qr (alumno_id, emitida_en DESC);

-- Índices de las claves foráneas restantes.
CREATE INDEX idx_credenciales_qr_emitida_por  ON public.credenciales_qr (emitida_por);
CREATE INDEX idx_credenciales_qr_revocada_por ON public.credenciales_qr (revocada_por)
    WHERE revocada_por IS NOT NULL;
CREATE INDEX idx_credenciales_qr_reemplaza_a  ON public.credenciales_qr (reemplaza_a)
    WHERE reemplaza_a IS NOT NULL;


-- ================================================================
-- 2. INVARIANTES DEL HISTORIAL
-- ================================================================
-- Defensa en profundidad: aunque el único camino de escritura sean las
-- funciones de la sección 3, la base rechaza por sí misma
--   * un alta que no nazca ACTIVA;
--   * borrar una credencial;
--   * cualquier UPDATE que no sea ACTIVA → REVOCADA con el resto de las
--     columnas idénticas.
-- La fecha de revocación y de emisión las sella la base, no quien escribe.
CREATE OR REPLACE FUNCTION app_private.proteger_credencial_qr()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5626',
            MESSAGE = 'El historial de credenciales es de solo agregado: no se elimina.';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.estado IS DISTINCT FROM 'ACTIVA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5626',
                MESSAGE = 'Una credencial siempre nace activa.';
        END IF;
        NEW.emitida_en := pg_catalog.now();
        RETURN NEW;
    END IF;

    -- TG_OP = 'UPDATE': solo se admite revocar una credencial vigente.
    IF OLD.estado IS DISTINCT FROM 'ACTIVA'
       OR NEW.estado IS DISTINCT FROM 'REVOCADA'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.alumno_id IS DISTINCT FROM OLD.alumno_id
       OR NEW.clave_kid IS DISTINCT FROM OLD.clave_kid
       OR NEW.emitida_en IS DISTINCT FROM OLD.emitida_en
       OR NEW.emitida_por IS DISTINCT FROM OLD.emitida_por
       OR NEW.reemplaza_a IS DISTINCT FROM OLD.reemplaza_a THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5626',
            MESSAGE = 'Una credencial revocada no se modifica ni se restaura: solo puede revocarse una credencial activa.';
    END IF;

    NEW.revocada_en := pg_catalog.now();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_credencial_qr()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_credencial_qr_antes_de_escribir
    BEFORE INSERT OR UPDATE OR DELETE ON public.credenciales_qr
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_credencial_qr();

-- TRUNCATE no dispara triggers de fila: ni el propietario vacía el historial
-- por accidente. Quien deba limpiar un entorno DESCARTABLE desactiva estos
-- triggers de forma explícita en su propia transacción.
CREATE OR REPLACE FUNCTION app_private.impedir_vaciar_credenciales_qr()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P5626',
        MESSAGE = 'El historial de credenciales es de solo agregado: no puede vaciarse.';
END;
$$;

REVOKE ALL ON FUNCTION app_private.impedir_vaciar_credenciales_qr()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER impedir_vaciar_credenciales_qr_antes_de_truncar
    BEFORE TRUNCATE ON public.credenciales_qr
    FOR EACH STATEMENT
    EXECUTE FUNCTION app_private.impedir_vaciar_credenciales_qr();


-- ================================================================
-- 3. OPERACIONES PRIVILEGIADAS
-- ================================================================
-- Viven en `app_private` (la Data API no las expone). Todas verifican
-- `auth.uid()` y el rol DIRECTOR habilitado dentro de la base, en ese orden y
-- ANTES de mirar cualquier otro dato, para no revelar la existencia de filas a
-- quien no administra. Ninguna recibe actor, rol ni usuario: el actor sale de
-- la sesión. Cada una es una transacción completa.

-- Validación común del identificador de clave y del motivo.
CREATE OR REPLACE FUNCTION app_private.validar_datos_credencial_qr(
    p_clave_kid TEXT,
    p_motivo    TEXT,
    p_exige_motivo BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_motivo TEXT;
BEGIN
    IF p_clave_kid IS NULL OR p_clave_kid !~ '^[a-z0-9]{1,16}$' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5625',
            MESSAGE = 'El identificador de la clave de firma no es válido.';
    END IF;

    v_motivo := pg_catalog.btrim(p_motivo);
    IF p_exige_motivo AND (v_motivo IS NULL OR pg_catalog.char_length(v_motivo) NOT BETWEEN 3 AND 200) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5624',
            MESSAGE = 'El motivo debe tener entre 3 y 200 caracteres.';
    END IF;

    RETURN v_motivo;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_datos_credencial_qr(TEXT, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 3.1 Emitir
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.emitir_credencial_qr(
    p_alumno_id UUID,
    p_clave_kid TEXT
)
RETURNS public.credenciales_qr
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_credencial public.credenciales_qr;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede emitir credenciales.';
    END IF;

    PERFORM app_private.validar_datos_credencial_qr(p_clave_kid, NULL, FALSE);

    IF p_alumno_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5620', MESSAGE = 'El alumno solicitado no existe.';
    END IF;

    -- Primero el alumno (orden del dominio). Serializa con otra emisión, con una
    -- reposición y con la inactivación o reactivación del mismo alumno.
    PERFORM 1
    FROM public.alumnos a
    WHERE a.perfil_id = p_alumno_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5620', MESSAGE = 'El alumno solicitado no existe.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.credenciales_qr c
        WHERE c.alumno_id = p_alumno_id AND c.estado = 'ACTIVA'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5621',
            MESSAGE = 'El alumno ya tiene una credencial activa. Para cambiarla, reponela o revocala.';
    END IF;

    INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por)
    VALUES (p_alumno_id, p_clave_kid, app_private.perfil_actual())
    RETURNING * INTO v_credencial;

    RETURN v_credencial;
END;
$$;

-- ----------------------------------------------------------------
-- 3.2 Reponer: revoca la credencial indicada y emite otra, atómicamente
-- ----------------------------------------------------------------
-- Recibe la credencial que Dirección VE como vigente. Si mientras tanto otra
-- operación ya la revocó o repuso, falla con P5623 en lugar de reemplazar por
-- error a la credencial nueva.
CREATE OR REPLACE FUNCTION app_private.reponer_credencial_qr(
    p_credencial_id UUID,
    p_clave_kid     TEXT,
    p_motivo        TEXT
)
RETURNS public.credenciales_qr
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_alumno_id  UUID;
    v_estado     public.estado_credencial_qr;
    v_motivo     TEXT;
    v_nueva      public.credenciales_qr;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede reponer credenciales.';
    END IF;

    v_motivo := app_private.validar_datos_credencial_qr(p_clave_kid, p_motivo, TRUE);

    IF p_credencial_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5622', MESSAGE = 'La credencial solicitada no existe.';
    END IF;

    -- `alumno_id` es inmutable (lo garantiza el trigger), así que leerlo sin
    -- bloquear para decidir qué alumno bloquear primero es seguro.
    SELECT c.alumno_id INTO v_alumno_id
    FROM public.credenciales_qr c
    WHERE c.id = p_credencial_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5622', MESSAGE = 'La credencial solicitada no existe.';
    END IF;

    PERFORM 1 FROM public.alumnos a WHERE a.perfil_id = v_alumno_id FOR NO KEY UPDATE;

    -- El estado se lee DESPUÉS de esperar: refleja una revocación o reposición
    -- que confirmó mientras tanto.
    SELECT c.estado INTO v_estado
    FROM public.credenciales_qr c
    WHERE c.id = p_credencial_id
    FOR UPDATE;

    IF v_estado IS DISTINCT FROM 'ACTIVA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5623',
            MESSAGE = 'La credencial ya no está vigente: actualizá la pantalla para ver su estado actual.';
    END IF;

    UPDATE public.credenciales_qr
    SET estado = 'REVOCADA',
        revocada_por = app_private.perfil_actual(),
        motivo_revocacion = v_motivo,
        revocada_en = pg_catalog.now()
    WHERE id = p_credencial_id;

    INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por, reemplaza_a)
    VALUES (v_alumno_id, p_clave_kid, app_private.perfil_actual(), p_credencial_id)
    RETURNING * INTO v_nueva;

    RETURN v_nueva;
END;
$$;

-- ----------------------------------------------------------------
-- 3.3 Revocar
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.revocar_credencial_qr(
    p_credencial_id UUID,
    p_motivo        TEXT
)
RETURNS public.credenciales_qr
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_alumno_id  UUID;
    v_estado     public.estado_credencial_qr;
    v_motivo     TEXT;
    v_credencial public.credenciales_qr;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede revocar credenciales.';
    END IF;

    v_motivo := app_private.validar_datos_credencial_qr('k', p_motivo, TRUE);

    IF p_credencial_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5622', MESSAGE = 'La credencial solicitada no existe.';
    END IF;

    SELECT c.alumno_id INTO v_alumno_id
    FROM public.credenciales_qr c
    WHERE c.id = p_credencial_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5622', MESSAGE = 'La credencial solicitada no existe.';
    END IF;

    PERFORM 1 FROM public.alumnos a WHERE a.perfil_id = v_alumno_id FOR NO KEY UPDATE;

    SELECT c.estado INTO v_estado
    FROM public.credenciales_qr c
    WHERE c.id = p_credencial_id
    FOR UPDATE;

    IF v_estado IS DISTINCT FROM 'ACTIVA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5623',
            MESSAGE = 'La credencial ya no está vigente: actualizá la pantalla para ver su estado actual.';
    END IF;

    UPDATE public.credenciales_qr
    SET estado = 'REVOCADA',
        revocada_por = app_private.perfil_actual(),
        motivo_revocacion = v_motivo,
        revocada_en = pg_catalog.now()
    WHERE id = p_credencial_id
    RETURNING * INTO v_credencial;

    RETURN v_credencial;
END;
$$;

-- ----------------------------------------------------------------
-- 3.4 Historial completo de un alumno (solo Dirección)
-- ----------------------------------------------------------------
-- Los datos internos (quién emitió o revocó y por qué) no se leen por la tabla:
-- se entregan solo por esta operación.
CREATE OR REPLACE FUNCTION app_private.historial_credenciales_qr(p_alumno_id UUID)
RETURNS TABLE (
    id                  UUID,
    estado              public.estado_credencial_qr,
    emitida_en          TIMESTAMP WITH TIME ZONE,
    emitida_por_nombre  TEXT,
    revocada_en         TIMESTAMP WITH TIME ZONE,
    revocada_por_nombre TEXT,
    motivo_revocacion   TEXT,
    reemplaza_a         UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede consultar el historial de credenciales.';
    END IF;

    RETURN QUERY
    SELECT c.id, c.estado, c.emitida_en,
           pg_catalog.concat_ws(' ', pe.nombre, pe.apellido),
           c.revocada_en,
           pg_catalog.concat_ws(' ', pr.nombre, pr.apellido),
           c.motivo_revocacion,
           c.reemplaza_a
    FROM public.credenciales_qr c
    JOIN public.perfiles pe ON pe.id = c.emitida_por
    LEFT JOIN public.perfiles pr ON pr.id = c.revocada_por
    WHERE c.alumno_id = p_alumno_id
    ORDER BY c.emitida_en DESC, c.id;
END;
$$;

-- ----------------------------------------------------------------
-- 3.5 Validez efectiva (interfaz mínima para EPT-65)
-- ----------------------------------------------------------------
-- NO verifica un QR: recibe un identificador que el servidor ya extrajo de un
-- payload con formato, versión, kid y firma HMAC válidos. Sin identidad
-- autenticada de Dirección devuelve error, y para un identificador inexistente
-- devuelve cero filas. Hoy no la ejecuta ningún otro rol.
CREATE OR REPLACE FUNCTION app_private.consultar_validez_credencial_qr(p_credencial_id UUID)
RETURNS TABLE (
    credencial_id      UUID,
    estado_credencial  public.estado_credencial_qr,
    estado_alumno      public.estado_alumno,
    acceso_alumno      public.estado_acceso,
    valida             BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede consultar la validez de una credencial.';
    END IF;

    RETURN QUERY
    SELECT c.id, c.estado, a.estado, p.estado_acceso,
           (c.estado = 'ACTIVA' AND a.estado = 'ACTIVO' AND p.estado_acceso = 'HABILITADO')
    FROM public.credenciales_qr c
    JOIN public.alumnos a ON a.perfil_id = c.alumno_id
    JOIN public.perfiles p ON p.id = a.perfil_id
    WHERE c.id = p_credencial_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.emitir_credencial_qr(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.reponer_credencial_qr(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.revocar_credencial_qr(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.historial_credenciales_qr(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_validez_credencial_qr(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION app_private.emitir_credencial_qr(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.reponer_credencial_qr(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.revocar_credencial_qr(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.historial_credenciales_qr(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_validez_credencial_qr(UUID) TO authenticated;


-- ================================================================
-- 4. ENVOLTORIOS PÚBLICOS (SECURITY INVOKER)
-- ================================================================
CREATE OR REPLACE FUNCTION public.emitir_credencial_qr(p_alumno_id UUID, p_clave_kid TEXT)
RETURNS public.credenciales_qr
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.emitir_credencial_qr(p_alumno_id, p_clave_kid);
$$;

CREATE OR REPLACE FUNCTION public.reponer_credencial_qr(
    p_credencial_id UUID, p_clave_kid TEXT, p_motivo TEXT
)
RETURNS public.credenciales_qr
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.reponer_credencial_qr(p_credencial_id, p_clave_kid, p_motivo);
$$;

CREATE OR REPLACE FUNCTION public.revocar_credencial_qr(p_credencial_id UUID, p_motivo TEXT)
RETURNS public.credenciales_qr
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.revocar_credencial_qr(p_credencial_id, p_motivo);
$$;

CREATE OR REPLACE FUNCTION public.historial_credenciales_qr(p_alumno_id UUID)
RETURNS TABLE (
    id                  UUID,
    estado              public.estado_credencial_qr,
    emitida_en          TIMESTAMP WITH TIME ZONE,
    emitida_por_nombre  TEXT,
    revocada_en         TIMESTAMP WITH TIME ZONE,
    revocada_por_nombre TEXT,
    motivo_revocacion   TEXT,
    reemplaza_a         UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.historial_credenciales_qr(p_alumno_id);
$$;

CREATE OR REPLACE FUNCTION public.consultar_validez_credencial_qr(p_credencial_id UUID)
RETURNS TABLE (
    credencial_id      UUID,
    estado_credencial  public.estado_credencial_qr,
    estado_alumno      public.estado_alumno,
    acceso_alumno      public.estado_acceso,
    valida             BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consultar_validez_credencial_qr(p_credencial_id);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon; se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.emitir_credencial_qr(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reponer_credencial_qr(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revocar_credencial_qr(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.historial_credenciales_qr(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_validez_credencial_qr(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.emitir_credencial_qr(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reponer_credencial_qr(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revocar_credencial_qr(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.historial_credenciales_qr(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_validez_credencial_qr(UUID) TO authenticated;


-- ================================================================
-- 5. PRIVILEGIOS MÍNIMOS Y RLS
-- ================================================================
ALTER TABLE public.credenciales_qr ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.credenciales_qr FROM PUBLIC, anon, authenticated, service_role;

-- Privilegio POR COLUMNA: los datos internos (quién emitió, quién revocó, por
-- qué y qué reemplazó) no salen por la tabla hacia ningún rol de aplicación,
-- ni siquiera hacia Dirección; Dirección los lee por `historial_credenciales_qr`.
-- Consecuencia buscada: un `select *` sobre la tabla falla, y las lecturas
-- deben nombrar sus columnas.
GRANT SELECT (id, alumno_id, estado, clave_kid, emitida_en, revocada_en)
    ON public.credenciales_qr TO authenticated;

-- Dirección habilitada lee todas.
CREATE POLICY "La dirección consulta las credenciales QR"
    ON public.credenciales_qr
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

-- El alumno lee solo las suyas.
CREATE POLICY "El alumno consulta sus credenciales QR"
    ON public.credenciales_qr
    FOR SELECT TO authenticated
    USING (
        alumno_id = (SELECT app_private.perfil_actual())
        AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE'
    );

-- El padre lee solo las de hijos actualmente vinculados: desvincular quita el
-- acceso de inmediato, porque el vínculo vigente es la propia fila de
-- `padres_hijos`.
CREATE POLICY "El padre consulta las credenciales QR de sus hijos"
    ON public.credenciales_qr
    FOR SELECT TO authenticated
    USING (
        (SELECT app_private.rol_actual()) = 'PADRE'
        AND alumno_id IN (SELECT app_private.mis_hijos_ids())
    );

-- Réplica de la política RESTRICTIVE de bloqueo de cuenta (EPT-59): esa
-- migración solo cubrió las tablas que existían entonces. Mismo predicado,
-- mismo nombre, mismo alcance FOR ALL.
CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.credenciales_qr
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

-- No se crea ninguna política INSERT, UPDATE ni DELETE permisiva y no hay
-- privilegio de escritura para ningún rol de aplicación.


-- ================================================================
-- 6. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_firma pg_catalog.regprocedure;
    v_col   TEXT;
BEGIN
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
            WHERE c.oid = 'public.credenciales_qr'::pg_catalog.regclass) THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: la tabla no tiene RLS.';
    END IF;

    IF pg_catalog.has_table_privilege('anon', 'public.credenciales_qr', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.credenciales_qr', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'DELETE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.credenciales_qr', 'TRUNCATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.credenciales_qr', 'SELECT')
       OR pg_catalog.has_table_privilege('service_role', 'public.credenciales_qr', 'INSERT') THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: la tabla concede privilegios de más.';
    END IF;

    -- Los datos internos no son legibles por columna.
    FOREACH v_col IN ARRAY ARRAY['emitida_por', 'reemplaza_a', 'revocada_por', 'motivo_revocacion'] LOOP
        IF pg_catalog.has_column_privilege('authenticated', 'public.credenciales_qr', v_col, 'SELECT') THEN
            RAISE EXCEPTION 'Autoverificación EPT-64: la columna % es legible por authenticated.', v_col;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'credenciales_qr'
          AND cmd <> 'SELECT' AND permissive = 'PERMISSIVE'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: existe una política permisiva de escritura.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'credenciales_qr'
          AND policyname = 'Bloqueo de acceso sin datos protegidos'
          AND permissive = 'RESTRICTIVE'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: falta la política RESTRICTIVE de bloqueo de cuenta.';
    END IF;

    -- Nada que permita reconstruir un QR: ninguna columna guarda payload, MAC ni clave.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.credenciales_qr'::pg_catalog.regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND (a.attname ILIKE '%mac%' OR a.attname ILIKE '%payload%'
               OR a.attname ILIKE '%secret%' OR a.attname ILIKE '%firma%'
               OR a.attname ILIKE '%token%' OR a.attname ILIKE '%clave' )
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: una columna parece guardar material de firma.';
    END IF;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.emitir_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'app_private.reponer_credencial_qr(uuid,text,text)'::pg_catalog.regprocedure,
        'app_private.revocar_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'app_private.historial_credenciales_qr(uuid)'::pg_catalog.regprocedure,
        'app_private.consultar_validez_credencial_qr(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación EPT-64: % no es SECURITY DEFINER con search_path vacío o sus privilegios de ejecución no son los previstos.',
                v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'public.emitir_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'public.reponer_credencial_qr(uuid,text,text)'::pg_catalog.regprocedure,
        'public.revocar_credencial_qr(uuid,text)'::pg_catalog.regprocedure,
        'public.historial_credenciales_qr(uuid)'::pg_catalog.regprocedure,
        'public.consultar_validez_credencial_qr(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-64: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.proteger_credencial_qr()'::pg_catalog.regprocedure,
        'app_private.impedir_vaciar_credenciales_qr()'::pg_catalog.regprocedure,
        'app_private.validar_datos_credencial_qr(text,text,boolean)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-64: % es ejecutable por un rol de aplicación.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna operación recibe identidad, rol ni actor del llamador.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('emitir_credencial_qr', 'reponer_credencial_qr',
                            'revocar_credencial_qr', 'historial_credenciales_qr',
                            'consultar_validez_credencial_qr')
          AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                 OR nombre ILIKE '%actor%' OR nombre ILIKE '%director%'
                 OR nombre ILIKE '%perfil%'
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: una operación acepta identidad, rol o actor del llamador.';
    END IF;

    IF (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.credenciales_qr'::pg_catalog.regclass
          AND NOT t.tgisinternal AND t.tgenabled = 'O')
       IS DISTINCT FROM ARRAY['impedir_vaciar_credenciales_qr_antes_de_truncar',
                              'proteger_credencial_qr_antes_de_escribir']::TEXT[] THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: el conjunto de triggers de la tabla no es el previsto.';
    END IF;

    -- Sin acoplamiento con el flujo del alumno: ni alumnos, ni matrículas, ni
    -- perfiles ganan un trigger por esta migración.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND p.proname ILIKE '%credencial_qr%'
          AND t.tgrelid <> 'public.credenciales_qr'::pg_catalog.regclass
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-64: hay un trigger de credenciales acoplado a otra tabla.';
    END IF;

    RAISE NOTICE 'Migración EPT-64: tabla credenciales_qr y 5 operaciones instaladas.';
END $$;
