-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Usuarios, roles, bloqueo de acceso y vínculo
-- presencial de cuentas (EPT-59)
-- ============================================================
-- Migración aditiva. No modifica 001–016, EPT-57 ni las dos etapas de EPT-58.
--
-- ============================================================
-- QUÉ PROBLEMA CIERRA
-- ============================================================
-- 1. No existía una forma de impedir el acceso de una persona sin borrar su
--    cuenta. Borrar no es aceptable: el perfil sostiene matrículas,
--    asistencias, fichas y vínculos familiares. Además, se verificó sobre la
--    pila local (GoTrue v2.196.0) que, después de un `ban_duration`, el inicio
--    de sesión y la renovación fallan pero PostgREST sigue aceptando el JWT ya
--    emitido hasta que vence. La barrera primaria tiene que estar en
--    PostgreSQL, no en Auth.
-- 2. El cambio de rol era un UPDATE directo sin reglas: podía dejar a la
--    institución sin Dirección, dejar a un ex DOCENTE a cargo de materias, o
--    romper la invariante académica de un ESTUDIANTE.
-- 3. La dirección podía insertar un perfil DIRECTOR sin cuenta (un legajo que
--    nadie puede usar) o un perfil con `user_id` elegido a mano.
-- 4. `anon` y `authenticated` conservaban TRUNCATE sobre `noticias`, `galeria`
--    y `menu_escolar` por los privilegios por defecto del esquema `public`.
-- 5. Un perfil creado sin cuenta (legajo) no tenía un camino seguro para
--    recibir su cuenta: el correo autoconfirmado de `signInWithOtp` se
--    confirma al ENVIAR, así que no prueba que la persona controle el buzón.
--
-- ============================================================
-- DECISIONES
-- ============================================================
-- * `perfiles.estado_acceso` (HABILITADO | BLOQUEADO). Los cuatro auxiliares
--   de identidad (`es_director`, `rol_actual`, `perfil_actual`,
--   `mis_hijos_ids`) ignoran los perfiles BLOQUEADOS: para toda política y
--   toda RPC existente, un bloqueado es alguien sin perfil. Se copió el cuerpo
--   vigente de cada uno y solo se agregó el filtro.
-- * Además, cada tabla de `public` recibe una política RESTRICTIVE para
--   `authenticated`: aunque una política permisiva mirara `auth.uid()`
--   directamente (como «Perfil propio»), un bloqueado no ve ni escribe nada
--   protegido. Las superficies públicas conservan exactamente lo que ve y hace
--   `anon`. Las vistas son `security_invoker` y heredan.
-- * `mi_estado_acceso()` es la única consulta que un bloqueado puede hacer
--   sobre sí mismo: la aplicación la usa para redirigir a «Acceso bloqueado».
-- * Director efectivo = rol DIRECTOR, perfil HABILITADO y cuenta Auth
--   existente, no borrada, no baneada, con correo confirmado y no anónima. Una
--   operación nunca puede dejar cero Directores efectivos.
-- * Cambios de rol y de acceso: RPC con valor esperado (control optimista,
--   P5909), motivo obligatorio, historial de solo agregado y un candado
--   consultivo global (59001) que serializa la regla del último Director.
-- * Vínculo presencial (D5) en dos fases: la Dirección reserva con su JWT; el
--   servidor, con `service_role`, emite un desafío de 6 dígitos (solo se
--   guarda su hash bcrypt) y lo verifica. La cuenta nace únicamente dentro de
--   la transacción de GoTrue, con `app_metadata.ept_vinculo`, y un trigger la
--   enlaza al perfil existente sin cambiar su `id` ni sus relaciones.
--
-- ============================================================
-- ORDEN DE BLOQUEOS
-- ============================================================
--     candado consultivo 59001  →  ficha de profesor  →  perfil
--
-- La especificación proponía perfil → ficha. Se invirtió para respetar el
-- orden que ya usan EPT-58 y los triggers de 012/014 (`a_exigir_profesor_activo`
-- toma la ficha FOR SHARE y después `validar_*` toma el perfil FOR SHARE).
-- Con el orden inverso, un cambio de rol y una asignación simultáneos al mismo
-- docente podían formar un ciclo de espera (40P01). La ficha se bloquea antes
-- de saber el rol; si el perfil no es DOCENTE, el bloqueo no cambia nada.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS (P59xx)
-- ============================================================
--   P5901  motivo inválido (5 a 500 caracteres)          422
--   P5902  rol o estado nuevo inválido                   422
--   P5903  operación sobre la propia cuenta              403
--   P5904  perfil inexistente                            404
--   P5906  el perfil ya tiene ese rol o estado           422
--   P5907  el cambio involucra al rol ESTUDIANTE         422
--   P5908  el historial es de solo agregado              —
--   P5909  valor esperado obsoleto                       409
--   P5910  PADRE con hijos vinculados                    409
--   P5911  DOCENTE con ficha activa o a cargo            409
--   P5912  quedaría sin Director efectivo                409
--   P5913  DIRECTOR sin cuenta confirmada                409
--   P5914  cuenta nueva sobre un perfil huérfano         —  (dentro de GoTrue)
--   P5920  reserva: datos o constancia inválidos         422
--   P5921  operación reutilizada con otros datos         409
--   P5922  el perfil ya tiene otra reserva activa        409
--   P5923  la reserva venció                             409
--   P5924  el perfil ya tiene cuenta                     409
--   P5925  el perfil está bloqueado                      409
--   P5926  rol sin cuenta vinculable                     422
--   P5927  el DNI no coincide                            422
--   P5928  correo inválido                               422
--   P5929  la reserva ya tiene otro correo               409
--   P5930  reserva inexistente                           404
--   P5931  correo en uso                                 409
--   P5932  límite de envíos                              429
--   P5933  la reserva no admite la operación             409
--   P5935  la reserva pertenece a otro Director          409
--   P5936  no hay desafío vigente                        409
--   P5939  las reservas no se borran                     —
--   P5940–P5947  rechazos del enlace dentro de GoTrue (llegan como 500)
-- Reutilizados: P5505 (sin identidad), 42501 (no es Director habilitado).
--
-- ============================================================
-- LÍMITES QUE CONVIENE DECIR
-- ============================================================
-- * El bloqueo en la base es inmediato; el baneo en Auth lo aplica la API
--   después y puede quedar pendiente (se reintenta con `estado_acceso_de`).
--   Mientras tanto, un JWT previo solo alcanza superficies públicas.
-- * Una tabla nueva de `public` creada después de esta migración NO recibe la
--   política restrictiva automáticamente: su migración debe agregarla. La
--   autoverificación de esta migración solo cubre las tablas existentes.
-- * Una excepción revierte todo, incluso el marcado VENCIDA de una reserva
--   vencida en los caminos que responden con error (P5923, P5933). El estado
--   efectivo se deriva siempre de `vence_en`: una reserva PENDIENTE vencida se
--   informa como VENCIDA y los caminos sin error la marcan.
-- * `service_role` recibe USAGE sobre `app_private` para poder ejecutar las
--   cuatro operaciones del desafío D5; no recibe ningún otro privilegio nuevo.
-- ============================================================

BEGIN;

-- ================================================================
-- 0. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
       OR pg_catalog.to_regclass('public.padres_hijos') IS NULL
       OR pg_catalog.to_regclass('public.profesores') IS NULL
       OR pg_catalog.to_regclass('public.materias_cursos') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos') IS NULL
    THEN
        RAISE EXCEPTION 'Migración EPT-59: faltan tablas base; la base no corresponde a 001–016 + EPT-57 + EPT-58.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.mis_hijos_ids()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.normalizar_especialidad(text)') IS NULL
       OR pg_catalog.to_regprocedure('extensions.crypt(text, text)') IS NULL
       OR pg_catalog.to_regprocedure('extensions.gen_salt(text, integer)') IS NULL
       OR pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
    THEN
        RAISE EXCEPTION 'Migración EPT-59: faltan funciones de identidad, de EPT-58 o de pgcrypto en extensions.';
    END IF;

    -- EPT-58 B debe estar aplicada: esta migración reemplaza políticas de ese estado.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Solo Dirección ve todos los perfiles'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Solo directores insertan perfiles' AND cmd = 'INSERT'
    ) THEN
        RAISE EXCEPTION 'Migración EPT-59: las políticas de perfiles no coinciden con EPT-58 B; revisar deriva antes de aplicar.';
    END IF;

    IF pg_catalog.to_regtype('public.estado_acceso') IS NOT NULL
       OR pg_catalog.to_regclass('public.perfiles_historial') IS NOT NULL
       OR pg_catalog.to_regclass('app_private.vinculos_cuenta') IS NOT NULL
    THEN
        RAISE EXCEPTION 'Migración EPT-59: ya existen objetos de esta migración; revisá el estado de la base antes de continuar.';
    END IF;

END $$;


-- ================================================================
-- 1. DIAGNÓSTICO PREVIO (SOLO LECTURA)
-- ================================================================
-- No cambia ningún dato: deja constancia en el registro de la migración de lo
-- que la base trae antes de aplicar las reglas nuevas.
DO $$
DECLARE
    v_directores_efectivos BIGINT;
    v_huerfanos            BIGINT;
    v_sin_rol              BIGINT;
    v_fila                 RECORD;
BEGIN
    -- Definición de §4.1, sin el filtro de estado (todavía no existe).
    SELECT pg_catalog.count(*) INTO v_directores_efectivos
    FROM public.perfiles p
    JOIN public.roles r ON r.id = p.rol_id
    JOIN auth.users u ON u.id = p.user_id
    WHERE r.nombre = 'DIRECTOR'
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
      AND u.email_confirmed_at IS NOT NULL
      AND COALESCE(u.is_anonymous, FALSE) = FALSE;

    SELECT pg_catalog.count(*) INTO v_huerfanos
    FROM public.perfiles p
    WHERE p.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

    SELECT pg_catalog.count(*) INTO v_sin_rol
    FROM public.perfiles p
    WHERE p.rol_id IS NULL;

    RAISE NOTICE 'Diagnóstico EPT-59: % Director(es) efectivo(s).', v_directores_efectivos;
    RAISE NOTICE 'Diagnóstico EPT-59: % perfil(es) con user_id sin cuenta Auth (huérfanos).', v_huerfanos;
    RAISE NOTICE 'Diagnóstico EPT-59: % perfil(es) sin rol.', v_sin_rol;

    FOR v_fila IN
        SELECT COALESCE(r.nombre, '(sin rol)') AS rol,
               pg_catalog.count(*) AS cantidad,
               pg_catalog.count(p.user_id) AS con_cuenta
        FROM public.perfiles p
        LEFT JOIN public.roles r ON r.id = p.rol_id
        GROUP BY 1
        ORDER BY 1
    LOOP
        RAISE NOTICE 'Diagnóstico EPT-59: rol % → % perfil(es), % con cuenta.',
            v_fila.rol, v_fila.cantidad, v_fila.con_cuenta;
    END LOOP;

    IF v_directores_efectivos = 0 THEN
        RAISE NOTICE 'Diagnóstico EPT-59: no hay Director efectivo. Las reglas nuevas no lo crean; la regla del último Director protege solo a partir de que exista uno.';
    END IF;
END $$;

-- Huella de preservación: la migración no debe cambiar ninguna fila existente.
CREATE TEMPORARY TABLE ept_059_huellas_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_059_huellas_iniciales (relacion, cantidad, huella)
VALUES
    ('perfiles',
        (SELECT pg_catalog.count(*) FROM public.perfiles),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, user_id, rol_id, nombre, apellido, dni, direccion,
                                  telefono, legajo_nro, fecha_nacimiento, fecha_creacion),
             ';' ORDER BY id), ''))
         FROM public.perfiles)),
    ('padres_hijos',
        (SELECT pg_catalog.count(*) FROM public.padres_hijos),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', padre_id, hijo_id, fecha_creacion),
             ';' ORDER BY padre_id, hijo_id), ''))
         FROM public.padres_hijos)),
    ('profesores',
        (SELECT pg_catalog.count(*) FROM public.profesores),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion),
             ';' ORDER BY perfil_id), ''))
         FROM public.profesores)),
    ('alumnos',
        (SELECT pg_catalog.count(*) FROM public.alumnos),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', perfil_id, estado, fecha_alta, fecha_actualizacion),
             ';' ORDER BY perfil_id), ''))
         FROM public.alumnos)),
    ('matriculas',
        (SELECT pg_catalog.count(*) FROM public.matriculas),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre),
             ';' ORDER BY id), ''))
         FROM public.matriculas));


-- ================================================================
-- 2. ESQUEMA
-- ================================================================
CREATE TYPE public.estado_acceso AS ENUM ('HABILITADO', 'BLOQUEADO');

-- No se agrega a ningún GRANT de columna: solo cambia por
-- `cambiar_acceso_perfil`. El INSERT directo de la dirección solo admite
-- HABILITADO (política de la sección 6).
ALTER TABLE public.perfiles
    ADD COLUMN estado_acceso public.estado_acceso NOT NULL DEFAULT 'HABILITADO';

COMMENT ON COLUMN public.perfiles.estado_acceso IS
    'HABILITADO o BLOQUEADO. Un perfil BLOQUEADO se trata como «sin perfil» en toda política y RPC, y solo ve las superficies públicas. Cambia únicamente por app_private.cambiar_acceso_perfil.';

-- ----------------------------------------------------------------
-- 2.1 Historial de solo agregado de rol, acceso y vínculo de cuenta
-- ----------------------------------------------------------------
CREATE TABLE public.perfiles_historial (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    perfil_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    tipo VARCHAR(10) NOT NULL
        CHECK (tipo IN ('ROL', 'ACCESO', 'VINCULO')),
    valor_anterior VARCHAR(40),
    valor_nuevo VARCHAR(40) NOT NULL,
    motivo VARCHAR(500) NOT NULL
        CHECK (pg_catalog.char_length(motivo) BETWEEN 5 AND 500),
    -- Perfil de quien hizo el cambio, derivado de la sesión (o, en el enlace
    -- D5, el Director que hizo la reserva).
    actor_perfil_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    -- Operación D5 que originó un VINCULO.
    operacion_id UUID,
    fecha TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.perfiles_historial IS
    'Historial de solo agregado de cambios de rol, de acceso y de vínculo de cuenta de cada perfil: actor, valores, motivo y fecha. No admite modificación ni borrado.';

CREATE INDEX idx_perfiles_historial_perfil
    ON public.perfiles_historial (perfil_id, fecha DESC);

CREATE INDEX idx_perfiles_historial_actor
    ON public.perfiles_historial (actor_perfil_id);

-- Mismo patrón que `impedir_cambios_historial_profesor` (EPT-58): la negación
-- por privilegios alcanza a los roles de aplicación y el trigger la extiende al
-- propietario.
CREATE OR REPLACE FUNCTION app_private.impedir_cambios_historial_perfiles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P5908',
        MESSAGE = 'El historial de usuarios es de solo agregado: no se modifica ni se elimina.';
END;
$$;

REVOKE ALL ON FUNCTION app_private.impedir_cambios_historial_perfiles()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER impedir_modificar_historial_perfiles
    BEFORE UPDATE OR DELETE ON public.perfiles_historial
    FOR EACH ROW
    EXECUTE FUNCTION app_private.impedir_cambios_historial_perfiles();

-- RLS no alcanza a TRUNCATE: se rechaza con un trigger de sentencia.
CREATE TRIGGER impedir_vaciar_historial_perfiles
    BEFORE TRUNCATE ON public.perfiles_historial
    FOR EACH STATEMENT
    EXECUTE FUNCTION app_private.impedir_cambios_historial_perfiles();

ALTER TABLE public.perfiles_historial ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.perfiles_historial FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.perfiles_historial_id_seq
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.perfiles_historial TO authenticated;

-- La política usa el envoltorio, que ya queda filtrado por estado (sección 3).
CREATE POLICY "Dirección ve el historial de usuarios"
    ON public.perfiles_historial
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

-- ----------------------------------------------------------------
-- 2.2 Reservas del vínculo presencial (D5), esquema privado
-- ----------------------------------------------------------------
CREATE TABLE app_private.vinculos_cuenta (
    operacion_id UUID PRIMARY KEY,
    perfil_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    director_perfil_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    -- Será el `id` de la cuenta Auth: la cuenta nace con este identificador.
    cuenta_id UUID NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
    modalidad VARCHAR(20) NOT NULL
        CHECK (modalidad IN ('TITULAR', 'REPRESENTANTE')),
    representante_dni VARCHAR(8)
        CHECK (representante_dni IS NULL OR representante_dni ~ '^[0-9]{7,8}$'),
    documento_verificado_en TIMESTAMP WITH TIME ZONE NOT NULL,
    estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'COMPLETADA', 'CANCELADA', 'VENCIDA')),
    creada_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    vence_en TIMESTAMP WITH TIME ZONE NOT NULL,
    correo VARCHAR(254),
    -- Solo el hash bcrypt del código; el código en claro nunca se guarda.
    desafio_hash TEXT,
    desafio_emitido_en TIMESTAMP WITH TIME ZONE,
    desafio_vence_en TIMESTAMP WITH TIME ZONE,
    desafio_intentos SMALLINT NOT NULL DEFAULT 0,
    desafios_emitidos SMALLINT NOT NULL DEFAULT 0,
    correo_verificado_en TIMESTAMP WITH TIME ZONE,
    completada_en TIMESTAMP WITH TIME ZONE,
    cerrada_motivo VARCHAR(200),
    CONSTRAINT vinculos_cuenta_representante_coherente
        CHECK ((modalidad = 'REPRESENTANTE') = (representante_dni IS NOT NULL))
);

COMMENT ON TABLE app_private.vinculos_cuenta IS
    'Reservas del vínculo presencial de una cuenta nueva con un perfil existente (EPT-59, D5). Nunca se borran; el código de verificación solo se guarda como hash.';

-- Una sola reserva activa por perfil.
CREATE UNIQUE INDEX idx_vinculos_cuenta_pendiente_por_perfil
    ON app_private.vinculos_cuenta (perfil_id)
    WHERE estado = 'PENDIENTE';

CREATE INDEX idx_vinculos_cuenta_director
    ON app_private.vinculos_cuenta (director_perfil_id);

-- Correo en uso y tope de envíos por correo.
CREATE INDEX idx_vinculos_cuenta_correo
    ON app_private.vinculos_cuenta (correo)
    WHERE correo IS NOT NULL;

CREATE OR REPLACE FUNCTION app_private.impedir_borrar_vinculos_cuenta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P5939',
        MESSAGE = 'Las reservas de vínculo de cuenta no se eliminan: se cancelan o vencen.';
END;
$$;

REVOKE ALL ON FUNCTION app_private.impedir_borrar_vinculos_cuenta()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER impedir_borrar_vinculos_cuenta
    BEFORE DELETE ON app_private.vinculos_cuenta
    FOR EACH ROW
    EXECUTE FUNCTION app_private.impedir_borrar_vinculos_cuenta();

CREATE TRIGGER impedir_vaciar_vinculos_cuenta
    BEFORE TRUNCATE ON app_private.vinculos_cuenta
    FOR EACH STATEMENT
    EXECUTE FUNCTION app_private.impedir_borrar_vinculos_cuenta();

ALTER TABLE app_private.vinculos_cuenta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.vinculos_cuenta FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 2.3 TRUNCATE cerrado para anon y authenticated (criterio 13)
-- ----------------------------------------------------------------
-- RLS no se aplica a TRUNCATE. No se toca ningún otro privilegio.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Las tablas que cree `postgres` en adelante tampoco lo heredan.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated;


-- ================================================================
-- 3. IDENTIDAD Y BLOQUEO (D4)
-- ================================================================
-- Cuerpos copiados de `pg_get_functiondef` (005, 003, 011). Única diferencia:
-- `AND p.estado_acceso = 'HABILITADO'`. Misma firma, lenguaje, volatilidad,
-- SECURITY DEFINER y search_path; CREATE OR REPLACE conserva los GRANT.
CREATE OR REPLACE FUNCTION app_private.es_director()
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
          AND r.nombre = 'DIRECTOR'
          AND p.estado_acceso = 'HABILITADO'
    );
$$;

CREATE OR REPLACE FUNCTION app_private.rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT r.nombre
    FROM public.perfiles p
    JOIN public.roles r ON r.id = p.rol_id
    WHERE p.user_id = (SELECT auth.uid())
      AND p.estado_acceso = 'HABILITADO'
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_private.perfil_actual()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id
    FROM public.perfiles p
    WHERE p.user_id = (SELECT auth.uid())
      AND p.estado_acceso = 'HABILITADO'
    LIMIT 1;
$$;

-- El padre debe estar HABILITADO; el estado de los hijos no cambia el vínculo.
CREATE OR REPLACE FUNCTION app_private.mis_hijos_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ph.hijo_id
    FROM public.padres_hijos ph
    JOIN public.perfiles p ON p.id = ph.padre_id
    WHERE p.user_id = (SELECT auth.uid())
      AND p.estado_acceso = 'HABILITADO';
$$;

-- ----------------------------------------------------------------
-- 3.1 Predicado de las políticas restrictivas
-- ----------------------------------------------------------------
-- Lee `perfiles` como propietario (sin RLS): no hay recursión (42P17) al
-- evaluarlo desde una política sobre la propia `perfiles`.
CREATE OR REPLACE FUNCTION app_private.acceso_bloqueado()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.user_id = (SELECT auth.uid())
          AND p.estado_acceso = 'BLOQUEADO'
    );
$$;

REVOKE ALL ON FUNCTION app_private.acceso_bloqueado()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.acceso_bloqueado() TO authenticated;

-- ----------------------------------------------------------------
-- 3.2 Estado de acceso propio (única consulta de un bloqueado sobre sí)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.mi_estado_acceso()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado public.estado_acceso;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RETURN 'SIN_SESION';
    END IF;

    SELECT p.estado_acceso INTO v_estado
    FROM public.perfiles p
    WHERE p.user_id = (SELECT auth.uid());

    IF NOT FOUND THEN
        RETURN 'SIN_PERFIL';
    END IF;

    RETURN v_estado::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION app_private.mi_estado_acceso()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.mi_estado_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.mi_estado_acceso()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.mi_estado_acceso();
$$;

REVOKE ALL ON FUNCTION public.mi_estado_acceso() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mi_estado_acceso() TO authenticated;

-- ----------------------------------------------------------------
-- 3.3 Políticas restrictivas en TODAS las tablas de `public`
-- ----------------------------------------------------------------
-- Superficies públicas: lo que `anon` ve o hace, un bloqueado también.
--   * actividades, galeria, menu_escolar, noticias: SELECT sin restricción.
--   * opiniones: SELECT solo aprobadas e INSERT solo pendientes.
--   * postulaciones, solicitudes_inscripcion: INSERT sin restricción.
-- Todas las demás tablas: una política FOR ALL. Se recorre `pg_class` para que
-- ninguna tabla existente quede afuera; la autoverificación lo comprueba.
DO $$
DECLARE
    v_tabla TEXT;
    v_cmd   TEXT;
BEGIN
    FOR v_tabla IN
        SELECT c.relname
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname
    LOOP
        IF v_tabla IN ('actividades', 'galeria', 'menu_escolar', 'noticias') THEN
            FOREACH v_cmd IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
                EXECUTE pg_catalog.format(
                    'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
                    'Bloqueo de acceso sin datos protegidos (' || v_cmd || ')',
                    v_tabla,
                    v_cmd,
                    CASE v_cmd
                        WHEN 'INSERT' THEN 'WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()))'
                        WHEN 'UPDATE' THEN 'USING (NOT (SELECT app_private.acceso_bloqueado())) WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()))'
                        ELSE 'USING (NOT (SELECT app_private.acceso_bloqueado()))'
                    END);
            END LOOP;
        ELSIF v_tabla = 'opiniones' THEN
            EXECUTE 'CREATE POLICY "Bloqueo de acceso sin datos protegidos (SELECT)" ON public.opiniones
                AS RESTRICTIVE FOR SELECT TO authenticated
                USING (NOT (SELECT app_private.acceso_bloqueado()) OR aprobado)';
            EXECUTE 'CREATE POLICY "Bloqueo de acceso sin datos protegidos (INSERT)" ON public.opiniones
                AS RESTRICTIVE FOR INSERT TO authenticated
                WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()) OR aprobado = FALSE)';
            EXECUTE 'CREATE POLICY "Bloqueo de acceso sin datos protegidos (UPDATE)" ON public.opiniones
                AS RESTRICTIVE FOR UPDATE TO authenticated
                USING (NOT (SELECT app_private.acceso_bloqueado()))
                WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()))';
            EXECUTE 'CREATE POLICY "Bloqueo de acceso sin datos protegidos (DELETE)" ON public.opiniones
                AS RESTRICTIVE FOR DELETE TO authenticated
                USING (NOT (SELECT app_private.acceso_bloqueado()))';
        ELSIF v_tabla IN ('postulaciones', 'solicitudes_inscripcion') THEN
            FOREACH v_cmd IN ARRAY ARRAY['SELECT', 'UPDATE', 'DELETE'] LOOP
                EXECUTE pg_catalog.format(
                    'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
                    'Bloqueo de acceso sin datos protegidos (' || v_cmd || ')',
                    v_tabla,
                    v_cmd,
                    CASE v_cmd
                        WHEN 'UPDATE' THEN 'USING (NOT (SELECT app_private.acceso_bloqueado())) WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()))'
                        ELSE 'USING (NOT (SELECT app_private.acceso_bloqueado()))'
                    END);
            END LOOP;
        ELSE
            EXECUTE pg_catalog.format(
                'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
                'USING (NOT (SELECT app_private.acceso_bloqueado())) '
                'WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()))',
                'Bloqueo de acceso sin datos protegidos',
                v_tabla);
        END IF;
    END LOOP;
END $$;


-- ================================================================
-- 4. DIRECTOR EFECTIVO Y TEXTO DEL MOTIVO
-- ================================================================
-- Uso interno: ningún rol de aplicación los ejecuta.
CREATE OR REPLACE FUNCTION app_private.es_director_efectivo(p_perfil_id UUID)
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
        JOIN auth.users u ON u.id = p.user_id
        WHERE p.id = p_perfil_id
          AND r.nombre = 'DIRECTOR'
          AND p.estado_acceso = 'HABILITADO'
          AND p.user_id IS NOT NULL
          AND u.deleted_at IS NULL
          AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
          AND u.email_confirmed_at IS NOT NULL
          AND COALESCE(u.is_anonymous, FALSE) = FALSE
    );
$$;

CREATE OR REPLACE FUNCTION app_private.contar_directores_efectivos(p_excluir UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.count(*)::INTEGER
    FROM public.perfiles p
    JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'DIRECTOR'
      AND p.id IS DISTINCT FROM p_excluir
      AND app_private.es_director_efectivo(p.id);
$$;

-- Motivo: espacios colapsados y extremos recortados con la misma clase de
-- espacios en blanco de `normalizar_especialidad` (EPT-58).
CREATE OR REPLACE FUNCTION app_private.normalizar_motivo_cambio(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.normalizar_especialidad(p_texto);
$$;

-- Correo enmascarado: primera letra, *** y el dominio.
CREATE OR REPLACE FUNCTION app_private.enmascarar_correo(p_correo TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_correo IS NULL OR pg_catalog.strpos(p_correo, '@') < 2 THEN NULL
        ELSE pg_catalog.left(p_correo, 1) || '***@' || pg_catalog.split_part(p_correo, '@', 2)
    END;
$$;

REVOKE ALL ON FUNCTION app_private.es_director_efectivo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.contar_directores_efectivos(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.normalizar_motivo_cambio(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.enmascarar_correo(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 5. TRANSICIONES DE ROL Y DE ACCESO
-- ================================================================
-- ----------------------------------------------------------------
-- 5.1 Cambio de rol
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.cambiar_rol_perfil(
    p_perfil_id    UUID,
    p_rol_esperado TEXT,
    p_rol_nuevo    TEXT,
    p_motivo       TEXT
)
RETURNS TABLE (
    perfil_id    UUID,
    rol          TEXT,
    historial_id BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_motivo       TEXT;
    v_rol_nuevo    TEXT;
    v_rol_nuevo_id INTEGER;
    v_user_id      UUID;
    v_rol_actual   TEXT;
    v_ficha_estado public.estado_profesor;
    v_ficha        BOOLEAN;
    v_actor        UUID;
    v_historial    BIGINT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede cambiar el rol de una persona.';
    END IF;

    v_motivo := app_private.normalizar_motivo_cambio(p_motivo);
    IF v_motivo IS NULL OR pg_catalog.char_length(v_motivo) NOT BETWEEN 5 AND 500 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5901',
            MESSAGE = 'El motivo es obligatorio y debe tener entre 5 y 500 caracteres.';
    END IF;

    v_rol_nuevo := NULLIF(pg_catalog.btrim(p_rol_nuevo), '');

    SELECT r.id INTO v_rol_nuevo_id
    FROM public.roles r
    WHERE r.nombre = v_rol_nuevo;

    IF v_rol_nuevo_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5902', MESSAGE = 'El rol nuevo no existe.';
    END IF;

    -- Serializa todos los cambios de rol y de acceso: la regla del último
    -- Director no admite dos decisiones simultáneas.
    PERFORM pg_catalog.pg_advisory_xact_lock(59001);

    -- Quien llama pudo haber perdido su rol o su acceso mientras esperaba.
    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede cambiar el rol de una persona.';
    END IF;

    -- Orden de bloqueos de EPT-58: ficha antes que perfil.
    PERFORM 1 FROM public.profesores pr
    WHERE pr.perfil_id = p_perfil_id
    FOR NO KEY UPDATE;

    SELECT p.user_id, r.nombre
    INTO v_user_id, v_rol_actual
    FROM public.perfiles p
    LEFT JOIN public.roles r ON r.id = p.rol_id
    WHERE p.id = p_perfil_id
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5904', MESSAGE = 'La persona solicitada no existe.';
    END IF;

    IF v_user_id IS NOT NULL AND v_user_id = (SELECT auth.uid()) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5903',
            MESSAGE = 'No podés cambiar el rol de tu propia cuenta.';
    END IF;

    IF v_rol_actual IS DISTINCT FROM p_rol_esperado THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5909',
            MESSAGE = 'El rol de la persona cambió desde que lo consultaste. Volvé a cargar los datos.';
    END IF;

    IF v_rol_actual IS NOT DISTINCT FROM v_rol_nuevo THEN
        RAISE EXCEPTION USING ERRCODE = 'P5906', MESSAGE = 'La persona ya tiene ese rol.';
    END IF;

    IF v_rol_actual = 'ESTUDIANTE' OR v_rol_nuevo = 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5907',
            MESSAGE = 'El rol ESTUDIANTE no se asigna ni se quita con un cambio de rol: se gestiona desde el legajo académico.';
    END IF;

    IF v_rol_actual = 'PADRE' AND EXISTS (
        SELECT 1 FROM public.padres_hijos ph WHERE ph.padre_id = p_perfil_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5910',
            MESSAGE = 'La persona tiene hijos vinculados. Quitá los vínculos familiares antes de cambiar su rol.';
    END IF;

    IF v_rol_actual = 'DOCENTE' THEN
        SELECT pr.estado INTO v_ficha_estado
        FROM public.profesores pr
        WHERE pr.perfil_id = p_perfil_id;
        v_ficha := FOUND;

        IF NOT v_ficha OR v_ficha_estado <> 'INACTIVO' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5911',
                MESSAGE = 'Para quitar el rol DOCENTE, primero inactivá su ficha de profesor.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.materias_cursos mc
            WHERE mc.profesor_id = p_perfil_id AND mc.activo
        ) OR EXISTS (
            SELECT 1 FROM public.grupos_deportivos g
            WHERE g.profesor_id = p_perfil_id AND g.activo
        ) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5911',
                MESSAGE = 'La persona sigue a cargo de materias o grupos deportivos activos. Reasignalos antes de quitar el rol DOCENTE.';
        END IF;
    END IF;

    IF v_rol_actual = 'DIRECTOR'
       AND app_private.contar_directores_efectivos(p_perfil_id) < 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5912',
            MESSAGE = 'La institución quedaría sin un Director con acceso efectivo.';
    END IF;

    -- Auditoría EPT-59 (hallazgo 4): un DIRECTOR sin cuenta real no podría
    -- vincularse nunca (D5 excluye DIRECTOR) y reabriría por RPC lo que el
    -- INSERT directo ya cierra. Se exige una cuenta Auth existente, no borrada,
    -- con correo confirmado y no anónima.
    IF v_rol_nuevo = 'DIRECTOR' AND NOT EXISTS (
        SELECT 1
        FROM auth.users u
        WHERE u.id = v_user_id
          AND u.deleted_at IS NULL
          AND u.email_confirmed_at IS NOT NULL
          AND COALESCE(u.is_anonymous, FALSE) = FALSE
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5913',
            MESSAGE = 'Solo una persona con cuenta confirmada puede recibir el rol DIRECTOR.';
    END IF;

    UPDATE public.perfiles
    SET rol_id = v_rol_nuevo_id
    WHERE id = p_perfil_id;

    -- Igual que el alta (EPT-58): todo DOCENTE tiene ficha. Una ficha
    -- existente (por ejemplo, INACTIVO de una etapa anterior) se conserva.
    IF v_rol_nuevo = 'DOCENTE' THEN
        INSERT INTO public.profesores (perfil_id)
        VALUES (p_perfil_id)
        ON CONFLICT (perfil_id) DO NOTHING;
    END IF;

    v_actor := app_private.perfil_actual();

    INSERT INTO public.perfiles_historial (
        perfil_id, tipo, valor_anterior, valor_nuevo, motivo, actor_perfil_id
    )
    VALUES (p_perfil_id, 'ROL', v_rol_actual, v_rol_nuevo, v_motivo, v_actor)
    RETURNING id INTO v_historial;

    RETURN QUERY SELECT p_perfil_id, v_rol_nuevo, v_historial;
END;
$$;

-- ----------------------------------------------------------------
-- 5.2 Bloqueo y reactivación
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.cambiar_acceso_perfil(
    p_perfil_id       UUID,
    p_estado_esperado public.estado_acceso,
    p_estado_nuevo    public.estado_acceso,
    p_motivo          TEXT
)
RETURNS TABLE (
    perfil_id     UUID,
    estado_acceso public.estado_acceso,
    user_id       UUID,
    historial_id  BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_motivo    TEXT;
    v_user_id   UUID;
    v_estado    public.estado_acceso;
    v_rol       TEXT;
    v_actor     UUID;
    v_historial BIGINT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede cambiar el acceso de una persona.';
    END IF;

    v_motivo := app_private.normalizar_motivo_cambio(p_motivo);
    IF v_motivo IS NULL OR pg_catalog.char_length(v_motivo) NOT BETWEEN 5 AND 500 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5901',
            MESSAGE = 'El motivo es obligatorio y debe tener entre 5 y 500 caracteres.';
    END IF;

    IF p_estado_nuevo IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5902',
            MESSAGE = 'El estado de acceso nuevo debe ser HABILITADO o BLOQUEADO.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(59001);

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede cambiar el acceso de una persona.';
    END IF;

    SELECT p.user_id, p.estado_acceso, r.nombre
    INTO v_user_id, v_estado, v_rol
    FROM public.perfiles p
    LEFT JOIN public.roles r ON r.id = p.rol_id
    WHERE p.id = p_perfil_id
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5904', MESSAGE = 'La persona solicitada no existe.';
    END IF;

    IF v_user_id IS NOT NULL AND v_user_id = (SELECT auth.uid()) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5903',
            MESSAGE = 'No podés cambiar el acceso de tu propia cuenta.';
    END IF;

    IF v_estado IS DISTINCT FROM p_estado_esperado THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5909',
            MESSAGE = 'El acceso de la persona cambió desde que lo consultaste. Volvé a cargar los datos.';
    END IF;

    IF v_estado = p_estado_nuevo THEN
        RAISE EXCEPTION USING ERRCODE = 'P5906', MESSAGE = 'La persona ya tiene ese estado de acceso.';
    END IF;

    IF p_estado_nuevo = 'BLOQUEADO'
       AND v_rol = 'DIRECTOR'
       AND app_private.contar_directores_efectivos(p_perfil_id) < 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5912',
            MESSAGE = 'La institución quedaría sin un Director con acceso efectivo.';
    END IF;

    UPDATE public.perfiles
    SET estado_acceso = p_estado_nuevo
    WHERE id = p_perfil_id;

    v_actor := app_private.perfil_actual();

    INSERT INTO public.perfiles_historial (
        perfil_id, tipo, valor_anterior, valor_nuevo, motivo, actor_perfil_id
    )
    VALUES (p_perfil_id, 'ACCESO', v_estado::TEXT, p_estado_nuevo::TEXT, v_motivo, v_actor)
    RETURNING id INTO v_historial;

    RETURN QUERY SELECT p_perfil_id, p_estado_nuevo, v_user_id, v_historial;
END;
$$;

-- ----------------------------------------------------------------
-- 5.3 Estado para sincronizar Auth con la base
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.estado_acceso_de(p_perfil_id UUID)
RETURNS TABLE (
    estado_acceso public.estado_acceso,
    user_id       UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede consultar el acceso de una persona.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.perfiles p WHERE p.id = p_perfil_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5904', MESSAGE = 'La persona solicitada no existe.';
    END IF;

    RETURN QUERY
    SELECT p.estado_acceso, p.user_id
    FROM public.perfiles p
    WHERE p.id = p_perfil_id;
END;
$$;

-- ----------------------------------------------------------------
-- 5.4 Consultas de la Dirección
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.listar_usuarios(
    p_busqueda       TEXT DEFAULT NULL,
    p_limite         INTEGER DEFAULT 50,
    p_desplazamiento INTEGER DEFAULT 0
)
RETURNS TABLE (
    id                   UUID,
    nombre               TEXT,
    apellido             TEXT,
    dni                  TEXT,
    legajo_nro           TEXT,
    rol                  TEXT,
    estado_acceso        public.estado_acceso,
    tiene_cuenta         BOOLEAN,
    cuenta_existente     BOOLEAN,
    correo_confirmado    BOOLEAN,
    bloqueo_auth         BOOLEAN,
    es_director_efectivo BOOLEAN,
    correo_enmascarado   TEXT,
    total                BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_busqueda TEXT;
    v_patron   TEXT;
    v_limite   INTEGER;
    v_desde    INTEGER;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede consultar los usuarios.';
    END IF;

    v_busqueda := NULLIF(app_private.normalizar_motivo_cambio(p_busqueda), '');
    -- Los comodines que escribe la persona se buscan literalmente.
    v_patron := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
                    v_busqueda, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_limite := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 100);
    v_desde := GREATEST(COALESCE(p_desplazamiento, 0), 0);

    RETURN QUERY
    SELECT p.id,
           p.nombre::TEXT,
           p.apellido::TEXT,
           p.dni::TEXT,
           p.legajo_nro::TEXT,
           r.nombre::TEXT,
           p.estado_acceso,
           (p.user_id IS NOT NULL),
           (u.id IS NOT NULL),
           (u.email_confirmed_at IS NOT NULL),
           (u.banned_until IS NOT NULL AND u.banned_until > pg_catalog.now()),
           app_private.es_director_efectivo(p.id),
           app_private.enmascarar_correo(u.email::TEXT),
           pg_catalog.count(*) OVER ()
    FROM public.perfiles p
    LEFT JOIN public.roles r ON r.id = p.rol_id
    LEFT JOIN auth.users u ON u.id = p.user_id
    WHERE v_busqueda IS NULL
       OR p.nombre ILIKE v_patron ESCAPE '\'
       OR p.apellido ILIKE v_patron ESCAPE '\'
       OR p.dni ILIKE v_patron ESCAPE '\'
       OR p.legajo_nro ILIKE v_patron ESCAPE '\'
    ORDER BY p.apellido, p.nombre, p.id
    LIMIT v_limite OFFSET v_desde;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.consultar_usuario(p_perfil_id UUID)
RETURNS TABLE (
    id                          UUID,
    nombre                      TEXT,
    apellido                    TEXT,
    dni                         TEXT,
    legajo_nro                  TEXT,
    rol                         TEXT,
    estado_acceso               public.estado_acceso,
    tiene_cuenta                BOOLEAN,
    cuenta_existente            BOOLEAN,
    correo_confirmado           BOOLEAN,
    bloqueo_auth                BOOLEAN,
    es_director_efectivo        BOOLEAN,
    correo_enmascarado          TEXT,
    telefono                    TEXT,
    direccion                   TEXT,
    fecha_nacimiento            DATE,
    fecha_creacion              TIMESTAMP WITH TIME ZONE,
    ultimo_ingreso              TIMESTAMP WITH TIME ZONE,
    vinculo_pendiente_operacion UUID,
    vinculo_pendiente_vence_en  TIMESTAMP WITH TIME ZONE,
    puede_vincular              BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede consultar los usuarios.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.perfiles p WHERE p.id = p_perfil_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5904', MESSAGE = 'La persona solicitada no existe.';
    END IF;

    RETURN QUERY
    SELECT p.id,
           p.nombre::TEXT,
           p.apellido::TEXT,
           p.dni::TEXT,
           p.legajo_nro::TEXT,
           r.nombre::TEXT,
           p.estado_acceso,
           (p.user_id IS NOT NULL),
           (u.id IS NOT NULL),
           (u.email_confirmed_at IS NOT NULL),
           (u.banned_until IS NOT NULL AND u.banned_until > pg_catalog.now()),
           app_private.es_director_efectivo(p.id),
           app_private.enmascarar_correo(u.email::TEXT),
           p.telefono::TEXT,
           p.direccion,
           p.fecha_nacimiento,
           p.fecha_creacion,
           u.last_sign_in_at,
           v.operacion_id,
           v.vence_en,
           (p.user_id IS NULL
            AND p.estado_acceso = 'HABILITADO'
            AND r.nombre IS NOT NULL
            AND r.nombre <> 'DIRECTOR')
    FROM public.perfiles p
    LEFT JOIN public.roles r ON r.id = p.rol_id
    LEFT JOIN auth.users u ON u.id = p.user_id
    LEFT JOIN app_private.vinculos_cuenta v
        ON v.perfil_id = p.id
       AND v.estado = 'PENDIENTE'
       AND v.vence_en > pg_catalog.now()
    WHERE p.id = p_perfil_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.listar_historial_usuario(p_perfil_id UUID)
RETURNS TABLE (
    id              BIGINT,
    tipo            TEXT,
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    motivo          TEXT,
    fecha           TIMESTAMP WITH TIME ZONE,
    actor_perfil_id UUID,
    actor_nombre    TEXT,
    actor_apellido  TEXT,
    operacion_id    UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede consultar el historial de un usuario.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.perfiles p WHERE p.id = p_perfil_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5904', MESSAGE = 'La persona solicitada no existe.';
    END IF;

    RETURN QUERY
    SELECT h.id, h.tipo::TEXT, h.valor_anterior::TEXT, h.valor_nuevo::TEXT, h.motivo::TEXT,
           h.fecha, h.actor_perfil_id, a.nombre::TEXT, a.apellido::TEXT, h.operacion_id
    FROM public.perfiles_historial h
    JOIN public.perfiles a ON a.id = h.actor_perfil_id
    WHERE h.perfil_id = p_perfil_id
    ORDER BY h.fecha DESC, h.id DESC;
END;
$$;


-- ================================================================
-- 6. ALTA DIRECTA DE LEGAJOS SIN CUENTA
-- ================================================================
-- La dirección solo crea legajos sin cuenta, habilitados, con rol y nunca
-- DIRECTOR. El alta con cuenta (trigger de 010) y la de alumnos (`crear_alumno`)
-- corren como propietario y no pasan por esta política.
DROP POLICY "Solo directores insertan perfiles" ON public.perfiles;

CREATE POLICY "Dirección crea legajos sin cuenta" ON public.perfiles
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_private.rol_actual()) = 'DIRECTOR'
        AND user_id IS NULL
        AND rol_id IS NOT NULL
        AND estado_acceso = 'HABILITADO'
        AND rol_id <> (SELECT r.id FROM public.roles r WHERE r.nombre = 'DIRECTOR')
    );


-- ================================================================
-- 7. VÍNCULO PRESENCIAL DE CUENTA (D5)
-- ================================================================
-- Salida segura de una reserva: nunca incluye el hash ni `cuenta_id`. El
-- estado es el efectivo: una PENDIENTE vencida se informa como VENCIDA.
CREATE OR REPLACE FUNCTION app_private.describir_vinculo(p_operacion_id UUID)
RETURNS TABLE (
    operacion_id       UUID,
    perfil_id          UUID,
    estado             TEXT,
    vence_en           TIMESTAMP WITH TIME ZONE,
    correo_enmascarado TEXT,
    desafio_emitido    BOOLEAN,
    correo_verificado  BOOLEAN,
    intentos_restantes INTEGER,
    vinculado          BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT v.operacion_id,
           v.perfil_id,
           CASE
               WHEN v.estado = 'PENDIENTE' AND v.vence_en <= pg_catalog.now() THEN 'VENCIDA'
               ELSE v.estado::TEXT
           END,
           v.vence_en,
           app_private.enmascarar_correo(v.correo::TEXT),
           (v.desafio_hash IS NOT NULL),
           (v.correo_verificado_en IS NOT NULL),
           GREATEST(5 - v.desafio_intentos, 0)::INTEGER,
           (p.user_id IS NOT DISTINCT FROM v.cuenta_id)
    FROM app_private.vinculos_cuenta v
    JOIN public.perfiles p ON p.id = v.perfil_id
    WHERE v.operacion_id = p_operacion_id;
$$;

-- El Director que firma la reserva debe seguir siendo DIRECTOR habilitado.
CREATE OR REPLACE FUNCTION app_private.director_habilitado(p_perfil_id UUID)
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
        WHERE p.id = p_perfil_id
          AND r.nombre = 'DIRECTOR'
          AND p.estado_acceso = 'HABILITADO'
    );
$$;

REVOKE ALL ON FUNCTION app_private.describir_vinculo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.director_habilitado(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 7.1 Reserva (Dirección, con su JWT)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.reservar_vinculo_cuenta(
    p_operacion_id         UUID,
    p_perfil_id            UUID,
    p_dni                  TEXT,
    p_modalidad            TEXT,
    p_representante_dni    TEXT,
    p_documento_verificado BOOLEAN
)
RETURNS TABLE (
    operacion_id       UUID,
    perfil_id          UUID,
    estado             TEXT,
    vence_en           TIMESTAMP WITH TIME ZONE,
    correo_enmascarado TEXT,
    desafio_emitido    BOOLEAN,
    correo_verificado  BOOLEAN,
    intentos_restantes INTEGER
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_director   UUID;
    v_rep_dni    TEXT;
    v_existente  app_private.vinculos_cuenta%ROWTYPE;
    v_user_id    UUID;
    v_estado     public.estado_acceso;
    v_rol        TEXT;
    v_dni        TEXT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede vincular cuentas.';
    END IF;

    IF p_documento_verificado IS NOT TRUE THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5920',
            MESSAGE = 'Confirmá que verificaste presencialmente el documento.';
    END IF;

    v_rep_dni := NULLIF(pg_catalog.btrim(p_representante_dni), '');

    IF p_operacion_id IS NULL
       OR p_modalidad IS NULL
       OR p_modalidad NOT IN ('TITULAR', 'REPRESENTANTE')
       OR (p_modalidad = 'TITULAR' AND v_rep_dni IS NOT NULL)
       OR (p_modalidad = 'REPRESENTANTE' AND (v_rep_dni IS NULL OR v_rep_dni !~ '^[0-9]{7,8}$'))
    THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5920',
            MESSAGE = 'La modalidad o el DNI del representante no son válidos.';
    END IF;

    v_director := app_private.perfil_actual();

    -- El perfil se bloquea antes de mirar la operación: dos reservas del mismo
    -- perfil (o dos reintentos de la misma operación) quedan serializadas.
    SELECT p.user_id, p.estado_acceso, r.nombre, p.dni
    INTO v_user_id, v_estado, v_rol, v_dni
    FROM public.perfiles p
    LEFT JOIN public.roles r ON r.id = p.rol_id
    WHERE p.id = p_perfil_id
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5904', MESSAGE = 'La persona solicitada no existe.';
    END IF;

    -- Idempotencia por operación.
    SELECT * INTO v_existente
    FROM app_private.vinculos_cuenta v
    WHERE v.operacion_id = p_operacion_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existente.director_perfil_id IS DISTINCT FROM v_director
           OR v_existente.perfil_id IS DISTINCT FROM p_perfil_id
           OR v_existente.modalidad IS DISTINCT FROM p_modalidad
           OR v_existente.representante_dni IS DISTINCT FROM v_rep_dni
        THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5921',
                MESSAGE = 'La operación ya se usó con otros datos. Iniciá una operación nueva.';
        END IF;

        IF v_existente.estado = 'PENDIENTE' AND v_existente.vence_en <= pg_catalog.now() THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5923',
                MESSAGE = 'La reserva venció. Iniciá una operación nueva.';
        END IF;

        RETURN QUERY
        SELECT d.operacion_id, d.perfil_id, d.estado, d.vence_en, d.correo_enmascarado,
               d.desafio_emitido, d.correo_verificado, d.intentos_restantes
        FROM app_private.describir_vinculo(p_operacion_id) d;
        RETURN;
    END IF;

    IF v_user_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5924', MESSAGE = 'La persona ya tiene una cuenta.';
    END IF;

    IF v_estado = 'BLOQUEADO' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5925',
            MESSAGE = 'La persona tiene el acceso bloqueado. Reactivala antes de vincular una cuenta.';
    END IF;

    IF v_rol IS NULL OR v_rol = 'DIRECTOR' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5926',
            MESSAGE = 'El vínculo presencial requiere un rol asignado distinto de DIRECTOR.';
    END IF;

    IF p_dni IS NULL OR pg_catalog.btrim(p_dni) IS DISTINCT FROM v_dni THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5927',
            MESSAGE = 'El DNI ingresado no coincide con el del legajo.';
    END IF;

    UPDATE app_private.vinculos_cuenta v
    SET estado = 'VENCIDA',
        desafio_hash = NULL,
        cerrada_motivo = 'Venció sin completarse.'
    WHERE v.perfil_id = p_perfil_id
      AND v.estado = 'PENDIENTE'
      AND v.vence_en <= pg_catalog.now();

    IF EXISTS (
        SELECT 1 FROM app_private.vinculos_cuenta v
        WHERE v.perfil_id = p_perfil_id AND v.estado = 'PENDIENTE'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5922',
            MESSAGE = 'La persona ya tiene un vínculo de cuenta en curso.';
    END IF;

    INSERT INTO app_private.vinculos_cuenta (
        operacion_id, perfil_id, director_perfil_id, modalidad, representante_dni,
        documento_verificado_en, vence_en
    )
    VALUES (
        p_operacion_id, p_perfil_id, v_director, p_modalidad, v_rep_dni,
        pg_catalog.now(), pg_catalog.now() + INTERVAL '15 minutes'
    );

    RETURN QUERY
    SELECT d.operacion_id, d.perfil_id, d.estado, d.vence_en, d.correo_enmascarado,
           d.desafio_emitido, d.correo_verificado, d.intentos_restantes
    FROM app_private.describir_vinculo(p_operacion_id) d;
END;
$$;

-- ----------------------------------------------------------------
-- 7.2 Bloqueo de la reserva para el servidor (service_role)
-- ----------------------------------------------------------------
-- Aplica las comprobaciones comunes de las operaciones del desafío y
-- devuelve la reserva bloqueada. Uso interno.
CREATE OR REPLACE FUNCTION app_private.reserva_para_servidor(
    p_operacion_id       UUID,
    p_director_perfil_id UUID
)
RETURNS app_private.vinculos_cuenta
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reserva app_private.vinculos_cuenta%ROWTYPE;
BEGIN
    SELECT * INTO v_reserva
    FROM app_private.vinculos_cuenta v
    WHERE v.operacion_id = p_operacion_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5930', MESSAGE = 'La reserva de vínculo no existe.';
    END IF;

    IF v_reserva.director_perfil_id IS DISTINCT FROM p_director_perfil_id
       OR NOT app_private.director_habilitado(p_director_perfil_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5935',
            MESSAGE = 'La reserva pertenece a otro Director o quien la inició ya no es Director habilitado.';
    END IF;

    RETURN v_reserva;
END;
$$;

REVOKE ALL ON FUNCTION app_private.reserva_para_servidor(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 7.3 Emisión del desafío (service_role)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.emitir_desafio_vinculo(
    p_operacion_id       UUID,
    p_director_perfil_id UUID,
    p_correo             TEXT
)
RETURNS TABLE (
    codigo           TEXT,
    correo           TEXT,
    desafio_vence_en TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_reserva app_private.vinculos_cuenta%ROWTYPE;
    v_correo  TEXT;
    v_numero  BIGINT;
    v_codigo  TEXT;
    v_vence   TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT * INTO v_reserva
    FROM app_private.reserva_para_servidor(p_operacion_id, p_director_perfil_id);

    IF v_reserva.estado <> 'PENDIENTE' OR v_reserva.vence_en <= pg_catalog.now() THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5933',
            MESSAGE = 'La reserva no está vigente. Iniciá una operación nueva.';
    END IF;

    v_correo := pg_catalog.lower(pg_catalog.btrim(p_correo));

    IF v_correo IS NULL
       OR pg_catalog.char_length(v_correo) > 254
       OR v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5928', MESSAGE = 'El correo no tiene un formato válido.';
    END IF;

    IF v_reserva.correo IS NOT NULL AND v_reserva.correo <> v_correo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5929',
            MESSAGE = 'La reserva ya tiene otro correo. Cancelala e iniciá una operación nueva.';
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users u WHERE pg_catalog.lower(u.email) = v_correo)
       OR EXISTS (
           SELECT 1 FROM app_private.vinculos_cuenta v
           WHERE v.correo = v_correo
             AND v.operacion_id <> p_operacion_id
             AND v.estado = 'PENDIENTE'
             AND v.vence_en > pg_catalog.now()
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5931', MESSAGE = 'El correo ya está en uso.';
    END IF;

    IF v_reserva.desafios_emitidos >= 5 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5932',
            MESSAGE = 'Se alcanzó el límite de envíos de código para esta operación.';
    END IF;

    -- Auditoría EPT-59 (hallazgo 6 y ronda 2, A4): cancelar y reservar de
    -- nuevo no debe permitir inundar un buzón ni usar el SMTP institucional sin
    -- tope. Ventana de una hora: hasta 10 envíos a un mismo correo y hasta 60
    -- envíos por Director, sumando operaciones. Los candados serializan los
    -- envíos concurrentes de distintas operaciones (siempre en el mismo orden:
    -- Director y después correo) para que ninguno supere el tope ni la
    -- comprobación de correo en uso. Los alias de un proveedor (a+b@, a.b@)
    -- cuentan como correos distintos: no hay una normalización general segura.
    PERFORM pg_catalog.pg_advisory_xact_lock(59002, pg_catalog.hashtext(p_director_perfil_id::TEXT));
    PERFORM pg_catalog.pg_advisory_xact_lock(59003, pg_catalog.hashtext(v_correo));

    IF EXISTS (
        SELECT 1 FROM app_private.vinculos_cuenta v
        WHERE v.correo = v_correo
          AND v.operacion_id <> p_operacion_id
          AND v.estado = 'PENDIENTE'
          AND v.vence_en > pg_catalog.now()
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5931', MESSAGE = 'El correo ya está en uso.';
    END IF;

    IF (SELECT COALESCE(SUM(v.desafios_emitidos), 0)
        FROM app_private.vinculos_cuenta v
        WHERE v.correo = v_correo
          AND v.desafio_emitido_en > pg_catalog.now() - INTERVAL '1 hour') >= 10
       OR (SELECT COALESCE(SUM(v.desafios_emitidos), 0)
           FROM app_private.vinculos_cuenta v
           WHERE v.director_perfil_id = p_director_perfil_id
             AND v.desafio_emitido_en > pg_catalog.now() - INTERVAL '1 hour') >= 60 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5932',
            MESSAGE = 'Se alcanzó el límite de envíos de código. Esperá una hora e intentá de nuevo.';
    END IF;

    -- Entero sin signo de 32 bits, módulo un millón, con ceros a la izquierda.
    v_numero := (('x' || pg_catalog.encode(extensions.gen_random_bytes(4), 'hex'))::BIT(32))::BIGINT;
    v_codigo := pg_catalog.lpad((v_numero % 1000000)::TEXT, 6, '0');
    v_vence := LEAST(pg_catalog.now() + INTERVAL '10 minutes', v_reserva.vence_en);

    UPDATE app_private.vinculos_cuenta v
    SET desafio_hash = extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)),
        desafio_emitido_en = pg_catalog.now(),
        desafio_vence_en = v_vence,
        desafio_intentos = 0,
        desafios_emitidos = v.desafios_emitidos + 1,
        correo_verificado_en = NULL,
        correo = v_correo
    WHERE v.operacion_id = p_operacion_id;

    RETURN QUERY SELECT v_codigo, v_correo, v_vence;
END;
$$;

-- ----------------------------------------------------------------
-- 7.4 Anulación por fallo de transporte (service_role)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.anular_desafio_vinculo(
    p_operacion_id       UUID,
    p_director_perfil_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM app_private.reserva_para_servidor(p_operacion_id, p_director_perfil_id);

    UPDATE app_private.vinculos_cuenta v
    SET desafio_hash = NULL
    WHERE v.operacion_id = p_operacion_id;
END;
$$;

-- ----------------------------------------------------------------
-- 7.5 Verificación del código (service_role)
-- ----------------------------------------------------------------
-- Un código incorrecto NO lanza excepción: se perdería el incremento de
-- intentos. Devuelve VERIFICADO, INCORRECTO, VENCIDO o SIN_INTENTOS.
CREATE OR REPLACE FUNCTION app_private.verificar_desafio_vinculo(
    p_operacion_id       UUID,
    p_director_perfil_id UUID,
    p_codigo             TEXT
)
RETURNS TABLE (
    resultado          TEXT,
    intentos_restantes INTEGER
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_reserva  app_private.vinculos_cuenta%ROWTYPE;
    v_intentos INTEGER;
    v_correcto BOOLEAN;
BEGIN
    SELECT * INTO v_reserva
    FROM app_private.reserva_para_servidor(p_operacion_id, p_director_perfil_id);

    IF v_reserva.estado <> 'PENDIENTE' OR v_reserva.vence_en <= pg_catalog.now() THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5933',
            MESSAGE = 'La reserva no está vigente. Iniciá una operación nueva.';
    END IF;

    IF v_reserva.correo_verificado_en IS NOT NULL THEN
        RETURN QUERY SELECT 'VERIFICADO'::TEXT, GREATEST(5 - v_reserva.desafio_intentos, 0)::INTEGER;
        RETURN;
    END IF;

    IF v_reserva.desafio_hash IS NULL THEN
        IF v_reserva.desafio_intentos >= 5 THEN
            RETURN QUERY SELECT 'SIN_INTENTOS'::TEXT, 0;
            RETURN;
        END IF;
        RAISE EXCEPTION USING
            ERRCODE = 'P5936',
            MESSAGE = 'No hay un código vigente. Enviá un código nuevo.';
    END IF;

    IF v_reserva.desafio_vence_en <= pg_catalog.now() THEN
        UPDATE app_private.vinculos_cuenta v
        SET desafio_hash = NULL
        WHERE v.operacion_id = p_operacion_id;
        RETURN QUERY SELECT 'VENCIDO'::TEXT, 0;
        RETURN;
    END IF;

    IF v_reserva.desafio_intentos >= 5 THEN
        UPDATE app_private.vinculos_cuenta v
        SET desafio_hash = NULL
        WHERE v.operacion_id = p_operacion_id;
        RETURN QUERY SELECT 'SIN_INTENTOS'::TEXT, 0;
        RETURN;
    END IF;

    v_intentos := v_reserva.desafio_intentos + 1;
    v_correcto := p_codigo IS NOT NULL
        AND p_codigo ~ '^[0-9]{6}$'
        AND extensions.crypt(p_codigo, v_reserva.desafio_hash) = v_reserva.desafio_hash;

    IF v_correcto THEN
        UPDATE app_private.vinculos_cuenta v
        SET desafio_intentos = v_intentos,
            desafio_hash = NULL,
            correo_verificado_en = pg_catalog.now()
        WHERE v.operacion_id = p_operacion_id;
        RETURN QUERY SELECT 'VERIFICADO'::TEXT, (5 - v_intentos)::INTEGER;
        RETURN;
    END IF;

    UPDATE app_private.vinculos_cuenta v
    SET desafio_intentos = v_intentos,
        desafio_hash = CASE WHEN v_intentos >= 5 THEN NULL ELSE v.desafio_hash END
    WHERE v.operacion_id = p_operacion_id;

    RETURN QUERY SELECT 'INCORRECTO'::TEXT, GREATEST(5 - v_intentos, 0)::INTEGER;
END;
$$;

-- ----------------------------------------------------------------
-- 7.6 Datos para crear la cuenta y reconciliar (service_role)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.datos_para_enlace(
    p_operacion_id       UUID,
    p_director_perfil_id UUID
)
RETURNS TABLE (
    cuenta_id UUID,
    correo    TEXT,
    perfil_id UUID,
    estado    TEXT,
    vinculado BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_reserva app_private.vinculos_cuenta%ROWTYPE;
    v_estado  TEXT;
BEGIN
    SELECT * INTO v_reserva
    FROM app_private.vinculos_cuenta v
    WHERE v.operacion_id = p_operacion_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5930', MESSAGE = 'La reserva de vínculo no existe.';
    END IF;

    IF v_reserva.director_perfil_id IS DISTINCT FROM p_director_perfil_id
       OR NOT app_private.director_habilitado(p_director_perfil_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5935',
            MESSAGE = 'La reserva pertenece a otro Director o quien la inició ya no es Director habilitado.';
    END IF;

    v_estado := CASE
        WHEN v_reserva.estado = 'PENDIENTE' AND v_reserva.vence_en <= pg_catalog.now() THEN 'VENCIDA'
        ELSE v_reserva.estado::TEXT
    END;

    IF v_estado = 'PENDIENTE' AND v_reserva.correo_verificado_en IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5944',
            MESSAGE = 'El correo todavía no fue verificado.';
    END IF;

    RETURN QUERY
    SELECT v_reserva.cuenta_id,
           v_reserva.correo::TEXT,
           v_reserva.perfil_id,
           v_estado,
           (p.user_id IS NOT DISTINCT FROM v_reserva.cuenta_id)
    FROM public.perfiles p
    WHERE p.id = v_reserva.perfil_id;
END;
$$;

-- ----------------------------------------------------------------
-- 7.7 Consulta y cancelación (Dirección, con su JWT)
-- ----------------------------------------------------------------
-- Cualquier Director habilitado puede consultar o cancelar: la reserva no
-- expone secretos y una reserva abandonada no debe bloquear a otro Director
-- más allá de su vencimiento.
CREATE OR REPLACE FUNCTION app_private.consultar_vinculo(p_operacion_id UUID)
RETURNS TABLE (
    operacion_id       UUID,
    perfil_id          UUID,
    estado             TEXT,
    vence_en           TIMESTAMP WITH TIME ZONE,
    correo_enmascarado TEXT,
    desafio_emitido    BOOLEAN,
    correo_verificado  BOOLEAN,
    intentos_restantes INTEGER,
    vinculado          BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede consultar vínculos de cuenta.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM app_private.vinculos_cuenta v WHERE v.operacion_id = p_operacion_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5930', MESSAGE = 'La reserva de vínculo no existe.';
    END IF;

    RETURN QUERY SELECT * FROM app_private.describir_vinculo(p_operacion_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.cancelar_vinculo(p_operacion_id UUID)
RETURNS TABLE (
    operacion_id       UUID,
    perfil_id          UUID,
    estado             TEXT,
    vence_en           TIMESTAMP WITH TIME ZONE,
    correo_enmascarado TEXT,
    desafio_emitido    BOOLEAN,
    correo_verificado  BOOLEAN,
    intentos_restantes INTEGER,
    vinculado          BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_reserva app_private.vinculos_cuenta%ROWTYPE;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección habilitada puede cancelar vínculos de cuenta.';
    END IF;

    SELECT * INTO v_reserva
    FROM app_private.vinculos_cuenta v
    WHERE v.operacion_id = p_operacion_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5930', MESSAGE = 'La reserva de vínculo no existe.';
    END IF;

    IF v_reserva.estado = 'COMPLETADA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5933',
            MESSAGE = 'La cuenta ya quedó vinculada; la operación no se puede cancelar.';
    END IF;

    IF v_reserva.estado = 'PENDIENTE' THEN
        UPDATE app_private.vinculos_cuenta v
        SET estado = CASE WHEN v.vence_en <= pg_catalog.now() THEN 'VENCIDA' ELSE 'CANCELADA' END,
            desafio_hash = NULL,
            cerrada_motivo = CASE
                WHEN v.vence_en <= pg_catalog.now() THEN 'Venció sin completarse.'
                ELSE 'Cancelada por la dirección.'
            END
        WHERE v.operacion_id = p_operacion_id;
    END IF;

    -- CANCELADA o VENCIDA: la cancelación es idempotente.
    RETURN QUERY SELECT * FROM app_private.describir_vinculo(p_operacion_id);
END;
$$;

-- ----------------------------------------------------------------
-- 7.8 El alta atómica (010) ya no adopta perfiles huérfanos
-- ----------------------------------------------------------------
-- Auditoría EPT-59 (hallazgo 1). `perfiles.user_id` no tiene clave foránea a
-- `auth.users`: si una cuenta se borra fuera de la aplicación, su perfil queda
-- con un `user_id` huérfano. La rama idempotente de 010 aceptaba entonces una
-- cuenta NUEVA con ese mismo `id` y los mismos datos, y se la entregaba sin
-- constancia presencial ni prueba de buzón: un atajo alrededor de D5.
--
-- Regla agregada: la rama idempotente solo vale para un perfil creado en esta
-- misma transacción (el alta que vuelve a pasar por el trigger). Un perfil que
-- ya existía antes (`fecha_creacion` anterior al comienzo de la transacción, o
-- desconocida) no se entrega a ninguna cuenta por esta vía: P5914. Ningún rol
-- de aplicación puede fijar `fecha_creacion`: no tiene GRANT de UPDATE sobre
-- esa columna y, al insertar, el trigger `fijar_fecha_creacion_perfil` (abajo)
-- la reemplaza por el instante de la transacción. El resto del cuerpo es
-- idéntico a 010.
CREATE OR REPLACE FUNCTION app_private.registrar_perfil_de_alta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_alta      JSONB;
    v_clave     TEXT;
    v_rol_id    INTEGER;
    v_existente RECORD;
BEGIN
    v_alta := NEW.raw_app_meta_data -> 'ept_alta';

    NEW.raw_app_meta_data := NEW.raw_app_meta_data - 'ept_alta';

    IF pg_catalog.jsonb_typeof(v_alta) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5520',
            MESSAGE = 'El pedido de alta no trae un perfil con el formato esperado.';
    END IF;

    FOR v_clave IN SELECT pg_catalog.jsonb_object_keys(v_alta) LOOP
        IF v_clave <> ALL (ARRAY[
            'nombre', 'apellido', 'dni', 'rol_id', 'telefono', 'direccion', 'legajo_nro'
        ]) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5520',
                MESSAGE = 'El pedido de alta trae un dato que el perfil no admite.';
        END IF;
    END LOOP;

    IF pg_catalog.jsonb_typeof(v_alta -> 'nombre') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_alta -> 'apellido') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_alta -> 'dni') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_alta -> 'rol_id') IS DISTINCT FROM 'number'
       OR COALESCE(pg_catalog.jsonb_typeof(v_alta -> 'telefono'), 'null') NOT IN ('string', 'null')
       OR COALESCE(pg_catalog.jsonb_typeof(v_alta -> 'direccion'), 'null') NOT IN ('string', 'null')
       OR COALESCE(pg_catalog.jsonb_typeof(v_alta -> 'legajo_nro'), 'null') NOT IN ('string', 'null')
    THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5520',
            MESSAGE = 'El pedido de alta trae un dato con un tipo que el perfil no admite.';
    END IF;

    v_rol_id := (v_alta ->> 'rol_id')::INTEGER;

    SELECT p.nombre, p.apellido, p.dni, p.rol_id, p.telefono, p.direccion, p.legajo_nro,
           p.fecha_creacion
    INTO v_existente
    FROM public.perfiles p
    WHERE p.user_id = NEW.id;

    IF FOUND THEN
        IF v_existente.fecha_creacion IS NULL
           OR v_existente.fecha_creacion < pg_catalog.transaction_timestamp() THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5914',
                MESSAGE = 'El perfil pertenecía a una cuenta que ya no existe; vincularlo exige el trámite presencial.';
        END IF;

        IF v_existente.nombre = v_alta ->> 'nombre'
           AND v_existente.apellido = v_alta ->> 'apellido'
           AND v_existente.dni = v_alta ->> 'dni'
           AND v_existente.rol_id IS NOT DISTINCT FROM v_rol_id
           AND v_existente.telefono IS NOT DISTINCT FROM NULLIF(v_alta ->> 'telefono', '')
           AND v_existente.direccion IS NOT DISTINCT FROM NULLIF(v_alta ->> 'direccion', '')
           AND v_existente.legajo_nro IS NOT DISTINCT FROM NULLIF(v_alta ->> 'legajo_nro', '')
        THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION USING
            ERRCODE = 'P5521',
            MESSAGE = 'La cuenta ya tiene un perfil registrado con otros datos.';
    END IF;

    INSERT INTO public.perfiles (
        user_id, nombre, apellido, dni, rol_id, telefono, direccion, legajo_nro
    )
    VALUES (
        NEW.id,
        v_alta ->> 'nombre',
        v_alta ->> 'apellido',
        v_alta ->> 'dni',
        v_rol_id,
        NULLIF(v_alta ->> 'telefono', ''),
        NULLIF(v_alta ->> 'direccion', ''),
        NULLIF(v_alta ->> 'legajo_nro', '')
    );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.registrar_perfil_de_alta()
    FROM PUBLIC, anon, authenticated, service_role;

-- Auditoría EPT-59, ronda 2 (A1): el GRANT de INSERT sobre `perfiles` es de
-- tabla, así que un Director podía enviar una `fecha_creacion` futura y
-- desarmar la regla P5914 si ese legajo después quedaba huérfano. Para los
-- roles de aplicación, la fecha la pone la base. Las cargas del propietario
-- (migraciones, pruebas, GoTrue vía 010) conservan su valor.
CREATE OR REPLACE FUNCTION app_private.fijar_fecha_creacion_perfil()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF CURRENT_USER IN ('anon', 'authenticated') THEN
        NEW.fecha_creacion := pg_catalog.transaction_timestamp();
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.fijar_fecha_creacion_perfil()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS fijar_fecha_creacion_perfil ON public.perfiles;

CREATE TRIGGER fijar_fecha_creacion_perfil
    BEFORE INSERT ON public.perfiles
    FOR EACH ROW
    EXECUTE FUNCTION app_private.fijar_fecha_creacion_perfil();

-- ----------------------------------------------------------------
-- 7.9 Enlace dentro de la transacción de GoTrue
-- ----------------------------------------------------------------
-- Mismo mecanismo que 010: `raw_app_meta_data` solo lo escribe la API
-- administrativa de GoTrue con `service_role`; `raw_user_meta_data` lo escribe
-- cualquiera y nunca se lee. Un rechazo revierte la cuenta entera.
CREATE OR REPLACE FUNCTION app_private.vincular_cuenta_de_alta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pedido     JSONB;
    v_clave      TEXT;
    v_texto      TEXT;
    v_operacion  UUID;
    v_reserva    app_private.vinculos_cuenta%ROWTYPE;
    v_user_id    UUID;
    v_estado     public.estado_acceso;
    v_rol        TEXT;
BEGIN
    v_pedido := NEW.raw_app_meta_data -> 'ept_vinculo';

    -- Primero se retira la clave, pase lo que pase después.
    NEW.raw_app_meta_data := NEW.raw_app_meta_data - 'ept_vinculo';

    IF NEW.raw_app_meta_data ? 'ept_alta' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5940',
            MESSAGE = 'Un alta no puede crear un perfil y vincular uno existente a la vez.';
    END IF;

    IF pg_catalog.jsonb_typeof(v_pedido) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5940',
            MESSAGE = 'El pedido de vínculo no tiene el formato esperado.';
    END IF;

    FOR v_clave IN SELECT pg_catalog.jsonb_object_keys(v_pedido) LOOP
        IF v_clave <> 'operacion_id' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5940',
                MESSAGE = 'El pedido de vínculo trae un dato que no admite.';
        END IF;
    END LOOP;

    v_texto := v_pedido ->> 'operacion_id';
    IF pg_catalog.jsonb_typeof(v_pedido -> 'operacion_id') IS DISTINCT FROM 'string'
       OR v_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5940',
            MESSAGE = 'El pedido de vínculo no trae una operación válida.';
    END IF;
    v_operacion := v_texto::UUID;

    SELECT * INTO v_reserva
    FROM app_private.vinculos_cuenta v
    WHERE v.operacion_id = v_operacion
    FOR UPDATE;

    IF NOT FOUND OR NEW.id IS DISTINCT FROM v_reserva.cuenta_id THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5941',
            MESSAGE = 'La cuenta no corresponde a ninguna reserva de vínculo.';
    END IF;

    IF pg_catalog.lower(NEW.email) IS DISTINCT FROM v_reserva.correo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5942',
            MESSAGE = 'El correo de la cuenta no es el verificado en la reserva.';
    END IF;

    -- Reintento del mismo enlace: ya está hecho, no hay nada que cambiar.
    IF v_reserva.estado = 'COMPLETADA' AND EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.id = v_reserva.perfil_id AND p.user_id = NEW.id
    ) THEN
        RETURN NEW;
    END IF;

    IF v_reserva.estado <> 'PENDIENTE' OR v_reserva.vence_en <= pg_catalog.now() THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5943',
            MESSAGE = 'La reserva de vínculo no está vigente.';
    END IF;

    IF v_reserva.correo_verificado_en IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5944',
            MESSAGE = 'El correo todavía no fue verificado.';
    END IF;

    IF NOT app_private.director_habilitado(v_reserva.director_perfil_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5945',
            MESSAGE = 'Quien inició la reserva ya no es Director habilitado.';
    END IF;

    SELECT p.user_id, p.estado_acceso, r.nombre
    INTO v_user_id, v_estado, v_rol
    FROM public.perfiles p
    LEFT JOIN public.roles r ON r.id = p.rol_id
    WHERE p.id = v_reserva.perfil_id
    FOR UPDATE OF p;

    IF v_user_id IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5946',
            MESSAGE = 'El perfil ya tiene una cuenta vinculada.';
    END IF;

    IF v_estado = 'BLOQUEADO' OR v_rol IS NULL OR v_rol = 'DIRECTOR' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5947',
            MESSAGE = 'El perfil ya no admite un vínculo de cuenta.';
    END IF;

    UPDATE public.perfiles
    SET user_id = NEW.id
    WHERE id = v_reserva.perfil_id;

    UPDATE app_private.vinculos_cuenta v
    SET estado = 'COMPLETADA',
        completada_en = pg_catalog.now(),
        desafio_hash = NULL
    WHERE v.operacion_id = v_operacion;

    INSERT INTO public.perfiles_historial (
        perfil_id, tipo, valor_anterior, valor_nuevo, motivo, actor_perfil_id, operacion_id
    )
    VALUES (
        v_reserva.perfil_id, 'VINCULO', 'SIN_CUENTA', 'CUENTA_VINCULADA',
        'Vinculación presencial con verificación de correo',
        v_reserva.director_perfil_id, v_operacion
    );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.vincular_cuenta_de_alta()
    FROM PUBLIC, anon, authenticated, service_role;

-- El nombre ordena este trigger ANTES que `registrar_perfil_al_crear_cuenta`
-- (010): si un alta trajera las dos claves, se rechaza aquí antes de que 010
-- cree un perfil.
DROP TRIGGER IF EXISTS enlazar_perfil_al_crear_cuenta ON auth.users;

CREATE TRIGGER enlazar_perfil_al_crear_cuenta
    BEFORE INSERT OR UPDATE OF raw_app_meta_data ON auth.users
    FOR EACH ROW
    WHEN (NEW.raw_app_meta_data ? 'ept_vinculo')
    EXECUTE FUNCTION app_private.vincular_cuenta_de_alta();


-- ================================================================
-- 8. PRIVILEGIOS DE LAS OPERACIONES Y ENVOLTORIOS PÚBLICOS
-- ================================================================
REVOKE ALL ON FUNCTION app_private.cambiar_rol_perfil(UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_acceso_perfil(UUID, public.estado_acceso, public.estado_acceso, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.estado_acceso_de(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_usuarios(TEXT, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_usuario(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_historial_usuario(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.reservar_vinculo_cuenta(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_vinculo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cancelar_vinculo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.emitir_desafio_vinculo(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.anular_desafio_vinculo(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.verificar_desafio_vinculo(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.datos_para_enlace(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION app_private.cambiar_rol_perfil(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_acceso_perfil(UUID, public.estado_acceso, public.estado_acceso, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.estado_acceso_de(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_usuarios(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_historial_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.reservar_vinculo_cuenta(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_vinculo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cancelar_vinculo(UUID) TO authenticated;

-- El desafío es del servidor: la dirección no puede leer ni fijar el código.
GRANT USAGE ON SCHEMA app_private TO service_role;
GRANT EXECUTE ON FUNCTION app_private.emitir_desafio_vinculo(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.anular_desafio_vinculo(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.verificar_desafio_vinculo(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.datos_para_enlace(UUID, UUID) TO service_role;

-- Envoltorios SECURITY INVOKER para PostgREST.
CREATE OR REPLACE FUNCTION public.cambiar_rol_perfil(
    p_perfil_id    UUID,
    p_rol_esperado TEXT,
    p_rol_nuevo    TEXT,
    p_motivo       TEXT
)
RETURNS TABLE (perfil_id UUID, rol TEXT, historial_id BIGINT)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.cambiar_rol_perfil(p_perfil_id, p_rol_esperado, p_rol_nuevo, p_motivo);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_acceso_perfil(
    p_perfil_id       UUID,
    p_estado_esperado public.estado_acceso,
    p_estado_nuevo    public.estado_acceso,
    p_motivo          TEXT
)
RETURNS TABLE (perfil_id UUID, estado_acceso public.estado_acceso, user_id UUID, historial_id BIGINT)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.cambiar_acceso_perfil(p_perfil_id, p_estado_esperado, p_estado_nuevo, p_motivo);
$$;

CREATE OR REPLACE FUNCTION public.estado_acceso_de(p_perfil_id UUID)
RETURNS TABLE (estado_acceso public.estado_acceso, user_id UUID)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.estado_acceso_de(p_perfil_id);
$$;

CREATE OR REPLACE FUNCTION public.listar_usuarios(
    p_busqueda       TEXT DEFAULT NULL,
    p_limite         INTEGER DEFAULT 50,
    p_desplazamiento INTEGER DEFAULT 0
)
RETURNS TABLE (
    id                   UUID,
    nombre               TEXT,
    apellido             TEXT,
    dni                  TEXT,
    legajo_nro           TEXT,
    rol                  TEXT,
    estado_acceso        public.estado_acceso,
    tiene_cuenta         BOOLEAN,
    cuenta_existente     BOOLEAN,
    correo_confirmado    BOOLEAN,
    bloqueo_auth         BOOLEAN,
    es_director_efectivo BOOLEAN,
    correo_enmascarado   TEXT,
    total                BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_usuarios(p_busqueda, p_limite, p_desplazamiento);
$$;

CREATE OR REPLACE FUNCTION public.consultar_usuario(p_perfil_id UUID)
RETURNS TABLE (
    id                          UUID,
    nombre                      TEXT,
    apellido                    TEXT,
    dni                         TEXT,
    legajo_nro                  TEXT,
    rol                         TEXT,
    estado_acceso               public.estado_acceso,
    tiene_cuenta                BOOLEAN,
    cuenta_existente            BOOLEAN,
    correo_confirmado           BOOLEAN,
    bloqueo_auth                BOOLEAN,
    es_director_efectivo        BOOLEAN,
    correo_enmascarado          TEXT,
    telefono                    TEXT,
    direccion                   TEXT,
    fecha_nacimiento            DATE,
    fecha_creacion              TIMESTAMP WITH TIME ZONE,
    ultimo_ingreso              TIMESTAMP WITH TIME ZONE,
    vinculo_pendiente_operacion UUID,
    vinculo_pendiente_vence_en  TIMESTAMP WITH TIME ZONE,
    puede_vincular              BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consultar_usuario(p_perfil_id);
$$;

CREATE OR REPLACE FUNCTION public.listar_historial_usuario(p_perfil_id UUID)
RETURNS TABLE (
    id              BIGINT,
    tipo            TEXT,
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    motivo          TEXT,
    fecha           TIMESTAMP WITH TIME ZONE,
    actor_perfil_id UUID,
    actor_nombre    TEXT,
    actor_apellido  TEXT,
    operacion_id    UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_historial_usuario(p_perfil_id);
$$;

CREATE OR REPLACE FUNCTION public.reservar_vinculo_cuenta(
    p_operacion_id         UUID,
    p_perfil_id            UUID,
    p_dni                  TEXT,
    p_modalidad            TEXT,
    p_representante_dni    TEXT,
    p_documento_verificado BOOLEAN
)
RETURNS TABLE (
    operacion_id       UUID,
    perfil_id          UUID,
    estado             TEXT,
    vence_en           TIMESTAMP WITH TIME ZONE,
    correo_enmascarado TEXT,
    desafio_emitido    BOOLEAN,
    correo_verificado  BOOLEAN,
    intentos_restantes INTEGER
)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.reservar_vinculo_cuenta(
        p_operacion_id, p_perfil_id, p_dni, p_modalidad, p_representante_dni, p_documento_verificado);
$$;

CREATE OR REPLACE FUNCTION public.consultar_vinculo(p_operacion_id UUID)
RETURNS TABLE (
    operacion_id       UUID,
    perfil_id          UUID,
    estado             TEXT,
    vence_en           TIMESTAMP WITH TIME ZONE,
    correo_enmascarado TEXT,
    desafio_emitido    BOOLEAN,
    correo_verificado  BOOLEAN,
    intentos_restantes INTEGER,
    vinculado          BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consultar_vinculo(p_operacion_id);
$$;

CREATE OR REPLACE FUNCTION public.cancelar_vinculo(p_operacion_id UUID)
RETURNS TABLE (
    operacion_id       UUID,
    perfil_id          UUID,
    estado             TEXT,
    vence_en           TIMESTAMP WITH TIME ZONE,
    correo_enmascarado TEXT,
    desafio_emitido    BOOLEAN,
    correo_verificado  BOOLEAN,
    intentos_restantes INTEGER,
    vinculado          BOOLEAN
)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.cancelar_vinculo(p_operacion_id);
$$;

CREATE OR REPLACE FUNCTION public.emitir_desafio_vinculo(
    p_operacion_id       UUID,
    p_director_perfil_id UUID,
    p_correo             TEXT
)
RETURNS TABLE (codigo TEXT, correo TEXT, desafio_vence_en TIMESTAMP WITH TIME ZONE)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.emitir_desafio_vinculo(p_operacion_id, p_director_perfil_id, p_correo);
$$;

CREATE OR REPLACE FUNCTION public.anular_desafio_vinculo(
    p_operacion_id       UUID,
    p_director_perfil_id UUID
)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.anular_desafio_vinculo(p_operacion_id, p_director_perfil_id);
$$;

CREATE OR REPLACE FUNCTION public.verificar_desafio_vinculo(
    p_operacion_id       UUID,
    p_director_perfil_id UUID,
    p_codigo             TEXT
)
RETURNS TABLE (resultado TEXT, intentos_restantes INTEGER)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.verificar_desafio_vinculo(p_operacion_id, p_director_perfil_id, p_codigo);
$$;

CREATE OR REPLACE FUNCTION public.datos_para_enlace(
    p_operacion_id       UUID,
    p_director_perfil_id UUID
)
RETURNS TABLE (cuenta_id UUID, correo TEXT, perfil_id UUID, estado TEXT, vinculado BOOLEAN)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.datos_para_enlace(p_operacion_id, p_director_perfil_id);
$$;

REVOKE ALL ON FUNCTION public.cambiar_rol_perfil(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cambiar_acceso_perfil(UUID, public.estado_acceso, public.estado_acceso, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.estado_acceso_de(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_usuarios(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_usuario(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_historial_usuario(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reservar_vinculo_cuenta(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_vinculo(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancelar_vinculo(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.emitir_desafio_vinculo(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anular_desafio_vinculo(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verificar_desafio_vinculo(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.datos_para_enlace(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.cambiar_rol_perfil(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_acceso_perfil(UUID, public.estado_acceso, public.estado_acceso, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_acceso_de(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_usuarios(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_historial_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_vinculo_cuenta(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_vinculo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_vinculo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.emitir_desafio_vinculo(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.anular_desafio_vinculo(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.verificar_desafio_vinculo(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.datos_para_enlace(UUID, UUID) TO service_role;


-- ================================================================
-- 9. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion   TEXT;
    v_antes      RECORD;
    v_despues    BIGINT;
    v_huella     TEXT;
    v_faltantes  TEXT[];
    v_esperados  TEXT[] := ARRAY[
        'actividades:SELECT', 'galeria:SELECT', 'menu_escolar:SELECT', 'noticias:SELECT',
        'postulaciones:INSERT', 'solicitudes_inscripcion:INSERT'
    ];
    v_tablas     INTEGER;
    v_rol        TEXT;
    v_columna    TEXT;
    v_funcion    RECORD;
    v_nuevas     TEXT[] := ARRAY[
        'impedir_cambios_historial_perfiles', 'impedir_borrar_vinculos_cuenta',
        'acceso_bloqueado', 'mi_estado_acceso', 'es_director_efectivo',
        'contar_directores_efectivos', 'normalizar_motivo_cambio', 'enmascarar_correo',
        'cambiar_rol_perfil', 'cambiar_acceso_perfil', 'estado_acceso_de', 'listar_usuarios',
        'consultar_usuario', 'listar_historial_usuario', 'describir_vinculo',
        'director_habilitado', 'reservar_vinculo_cuenta', 'reserva_para_servidor',
        'emitir_desafio_vinculo', 'anular_desafio_vinculo', 'verificar_desafio_vinculo',
        'datos_para_enlace', 'consultar_vinculo', 'cancelar_vinculo', 'vincular_cuenta_de_alta',
        'es_director', 'rol_actual', 'perfil_actual', 'mis_hijos_ids'
    ];
    v_solo_servidor TEXT[] := ARRAY[
        'emitir_desafio_vinculo', 'anular_desafio_vinculo', 'verificar_desafio_vinculo',
        'datos_para_enlace'
    ];
    v_de_direccion TEXT[] := ARRAY[
        'mi_estado_acceso', 'cambiar_rol_perfil', 'cambiar_acceso_perfil', 'estado_acceso_de',
        'listar_usuarios', 'consultar_usuario', 'listar_historial_usuario',
        'reservar_vinculo_cuenta', 'consultar_vinculo', 'cancelar_vinculo'
    ];
BEGIN
    -- 9.1 Ninguna fila existente cambió.
    FOREACH v_relacion IN ARRAY ARRAY['perfiles', 'padres_hijos', 'profesores', 'alumnos', 'matriculas'] LOOP
        SELECT cantidad, huella INTO v_antes
        FROM ept_059_huellas_iniciales WHERE relacion = v_relacion;

        EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', v_relacion)
        INTO v_despues;

        IF v_despues <> v_antes.cantidad THEN
            RAISE EXCEPTION 'Autoverificación EPT-59: % cambió de % a % filas.',
                v_relacion, v_antes.cantidad, v_despues;
        END IF;
    END LOOP;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, user_id, rol_id, nombre, apellido, dni, direccion,
                                    telefono, legajo_nro, fecha_nacimiento, fecha_creacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.perfiles;
    IF v_huella <> (SELECT huella FROM ept_059_huellas_iniciales WHERE relacion = 'perfiles') THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: cambió el contenido de public.perfiles.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', padre_id, hijo_id, fecha_creacion),
               ';' ORDER BY padre_id, hijo_id), ''))
    INTO v_huella FROM public.padres_hijos;
    IF v_huella <> (SELECT huella FROM ept_059_huellas_iniciales WHERE relacion = 'padres_hijos') THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: cambió el contenido de public.padres_hijos.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion),
               ';' ORDER BY perfil_id), ''))
    INTO v_huella FROM public.profesores;
    IF v_huella <> (SELECT huella FROM ept_059_huellas_iniciales WHERE relacion = 'profesores') THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: cambió el contenido de public.profesores.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', perfil_id, estado, fecha_alta, fecha_actualizacion),
               ';' ORDER BY perfil_id), ''))
    INTO v_huella FROM public.alumnos;
    IF v_huella <> (SELECT huella FROM ept_059_huellas_iniciales WHERE relacion = 'alumnos') THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: cambió el contenido de public.alumnos.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.matriculas;
    IF v_huella <> (SELECT huella FROM ept_059_huellas_iniciales WHERE relacion = 'matriculas') THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: cambió el contenido de public.matriculas.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.perfiles WHERE estado_acceso <> 'HABILITADO') THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: la migración no debe bloquear a nadie.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.perfiles_historial)
       OR EXISTS (SELECT 1 FROM app_private.vinculos_cuenta) THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: la migración no debe escribir historial ni reservas.';
    END IF;

    -- 9.2 Toda tabla de `public` tiene RLS y cobertura restrictiva para
    --     authenticated en los cuatro comandos, salvo exactamente las
    --     superficies públicas.
    SELECT pg_catalog.count(*) INTO v_tablas
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r';

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: hay una tabla de public sin RLS.';
    END IF;

    SELECT COALESCE(pg_catalog.array_agg(t.relname || ':' || k.cmd ORDER BY t.relname, k.cmd), ARRAY[]::TEXT[])
    INTO v_faltantes
    FROM (
        SELECT c.relname
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
    ) AS t
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS k(cmd)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = t.relname
          AND p.permissive = 'RESTRICTIVE'
          AND (p.cmd = k.cmd OR p.cmd = 'ALL')
          AND p.roles && ARRAY['authenticated', 'public']::name[]
          AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%app_private.acceso_bloqueado()%'
          AND (k.cmd = 'INSERT' OR p.qual LIKE '%app_private.acceso_bloqueado()%')
          AND (k.cmd IN ('SELECT', 'DELETE') OR p.with_check LIKE '%app_private.acceso_bloqueado()%')
    );

    IF NOT (v_faltantes @> v_esperados AND v_esperados @> v_faltantes
            AND pg_catalog.cardinality(v_faltantes) = pg_catalog.cardinality(v_esperados)) THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: la cobertura restrictiva no coincide. Sin cubrir: %; esperado: %.',
            v_faltantes, v_esperados;
    END IF;

    -- 9.3 Ningún anon/authenticated conserva TRUNCATE en public.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rol)
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND pg_catalog.has_table_privilege(r.rol, c.oid, 'TRUNCATE')
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: anon o authenticated conserva TRUNCATE en public.';
    END IF;

    -- 9.4 Columnas de identidad y acceso: ningún rol de aplicación las
    --     actualiza directamente.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_columna IN ARRAY ARRAY['rol_id', 'user_id', 'estado_acceso'] LOOP
            IF pg_catalog.has_column_privilege(v_rol, 'public.perfiles', v_columna, 'UPDATE') THEN
                RAISE EXCEPTION 'Autoverificación EPT-59: % puede actualizar perfiles.%.', v_rol, v_columna;
            END IF;
        END LOOP;
        IF pg_catalog.has_table_privilege(v_rol, 'public.perfiles', 'DELETE')
           OR pg_catalog.has_table_privilege(v_rol, 'public.perfiles_historial', 'INSERT')
           OR pg_catalog.has_table_privilege(v_rol, 'public.perfiles_historial', 'UPDATE')
           OR pg_catalog.has_table_privilege(v_rol, 'public.perfiles_historial', 'DELETE')
           OR pg_catalog.has_table_privilege(v_rol, 'app_private.vinculos_cuenta', 'SELECT')
        THEN
            RAISE EXCEPTION 'Autoverificación EPT-59: % conserva escritura directa sobre perfiles, historial o reservas.', v_rol;
        END IF;
    END LOOP;

    IF pg_catalog.has_table_privilege('service_role', 'app_private.vinculos_cuenta', 'SELECT')
       OR pg_catalog.has_table_privilege('service_role', 'public.perfiles_historial', 'INSERT')
       OR pg_catalog.has_table_privilege('service_role', 'public.perfiles_historial', 'SELECT')
    THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: service_role accede directamente a historial o reservas.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid = 'public.perfiles_historial'::pg_catalog.regclass AND relrowsecurity
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid = 'app_private.vinculos_cuenta'::pg_catalog.regclass AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: una tabla nueva no tiene RLS.';
    END IF;

    -- 9.5 Políticas de alta de perfiles.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Solo directores insertan perfiles'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Dirección crea legajos sin cuenta'
          AND cmd = 'INSERT' AND permissive = 'PERMISSIVE'
          AND with_check LIKE '%user_id IS NULL%'
          AND with_check LIKE '%estado_acceso%'
    ) OR (
        SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND cmd = 'INSERT' AND permissive = 'PERMISSIVE'
    ) <> 1 THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: la política de alta de perfiles no coincide con el contrato.';
    END IF;

    -- 9.6 Funciones: search_path vacío; DEFINER solo en app_private; los
    --     envoltorios públicos son INVOKER; nada ejecutable por anon; las cuatro
    --     del desafío solo por service_role; las internas por nadie.
    FOR v_funcion IN
        SELECT n.nspname, p.proname, p.oid, p.prosecdef, p.proconfig
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname = ANY (v_nuevas)
          -- `public.rol_actual()` (005) es un envoltorio previo, fuera del alcance.
          AND NOT (n.nspname = 'public'
                   AND p.proname IN ('es_director', 'rol_actual', 'perfil_actual', 'mis_hijos_ids'))
    LOOP
        IF v_funcion.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
            RAISE EXCEPTION 'Autoverificación EPT-59: %.% no fija search_path vacío.', v_funcion.nspname, v_funcion.proname;
        END IF;
        IF v_funcion.nspname = 'public' AND v_funcion.prosecdef THEN
            RAISE EXCEPTION 'Autoverificación EPT-59: public.% es SECURITY DEFINER.', v_funcion.proname;
        END IF;
        IF pg_catalog.has_function_privilege('anon', v_funcion.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-59: anon puede ejecutar %.%.', v_funcion.nspname, v_funcion.proname;
        END IF;

        IF v_funcion.proname = ANY (v_solo_servidor) THEN
            IF pg_catalog.has_function_privilege('authenticated', v_funcion.oid, 'EXECUTE')
               OR NOT pg_catalog.has_function_privilege('service_role', v_funcion.oid, 'EXECUTE') THEN
                RAISE EXCEPTION 'Autoverificación EPT-59: %.% debe ejecutarse solo con service_role.', v_funcion.nspname, v_funcion.proname;
            END IF;
        ELSIF v_funcion.proname = ANY (v_de_direccion) THEN
            IF NOT pg_catalog.has_function_privilege('authenticated', v_funcion.oid, 'EXECUTE')
               OR pg_catalog.has_function_privilege('service_role', v_funcion.oid, 'EXECUTE') THEN
                RAISE EXCEPTION 'Autoverificación EPT-59: %.% debe ejecutarse solo con authenticated.', v_funcion.nspname, v_funcion.proname;
            END IF;
        ELSIF v_funcion.proname IN ('acceso_bloqueado', 'es_director', 'rol_actual', 'perfil_actual', 'mis_hijos_ids') THEN
            IF v_funcion.nspname = 'app_private'
               AND (NOT pg_catalog.has_function_privilege('authenticated', v_funcion.oid, 'EXECUTE')
                    OR pg_catalog.has_function_privilege('service_role', v_funcion.oid, 'EXECUTE')) THEN
                RAISE EXCEPTION 'Autoverificación EPT-59: app_private.% perdió o amplió sus privilegios.', v_funcion.proname;
            END IF;
        ELSE
            IF pg_catalog.has_function_privilege('authenticated', v_funcion.oid, 'EXECUTE')
               OR pg_catalog.has_function_privilege('service_role', v_funcion.oid, 'EXECUTE') THEN
                RAISE EXCEPTION 'Autoverificación EPT-59: la función interna %.% es ejecutable por un rol de aplicación.', v_funcion.nspname, v_funcion.proname;
            END IF;
        END IF;
    END LOOP;

    -- 9.7 Los auxiliares de identidad filtran por estado de acceso.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app_private'
          AND p.proname IN ('es_director', 'rol_actual', 'perfil_actual', 'mis_hijos_ids')
          AND (p.prosrc NOT LIKE '%estado_acceso = ''HABILITADO''%' OR NOT p.prosecdef)
    ) OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app_private'
          AND p.proname IN ('es_director', 'rol_actual', 'perfil_actual', 'mis_hijos_ids')
    ) <> 4 THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: un auxiliar de identidad no ignora a los perfiles bloqueados.';
    END IF;

    -- 9.8 Triggers habilitados.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'auth.users'::pg_catalog.regclass
          AND t.tgname = 'enlazar_perfil_al_crear_cuenta'
          AND NOT t.tgisinternal AND t.tgenabled = 'O'
    ) OR (
        SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.perfiles_historial'::pg_catalog.regclass
          AND t.tgname IN ('impedir_modificar_historial_perfiles', 'impedir_vaciar_historial_perfiles')
          AND NOT t.tgisinternal AND t.tgenabled = 'O'
    ) <> 2 OR (
        SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'app_private.vinculos_cuenta'::pg_catalog.regclass
          AND t.tgname IN ('impedir_borrar_vinculos_cuenta', 'impedir_vaciar_vinculos_cuenta')
          AND NOT t.tgisinternal AND t.tgenabled = 'O'
    ) <> 2 THEN
        RAISE EXCEPTION 'Autoverificación EPT-59: faltan triggers de historial, reservas o enlace.';
    END IF;

    RAISE NOTICE 'Migración EPT-59: % tablas de public con bloqueo restrictivo; % perfiles preservados sin cambios.',
        v_tablas, (SELECT cantidad FROM ept_059_huellas_iniciales WHERE relacion = 'perfiles');
END $$;

COMMIT;
