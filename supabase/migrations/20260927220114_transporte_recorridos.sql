-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Transporte y sus cuatro recorridos (EPT-60)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 014, ni la de EPT-57,
-- EPT-58 ni EPT-59 (20260926190000_ept_59_usuarios_permisos.sql).
--
-- ============================================================
-- CONTRATO FICTICIO — DECISIÓN EXPRESA DEL USUARIO
-- ============================================================
-- Los cuatro recorridos y sus paradas son datos de referencia FICTICIOS del
-- proyecto, no un servicio de transporte real. No se inventan direcciones,
-- coordenadas, horarios, vehículos, tarifas ni capacidades operativas.
--
--   TR-NORTE: Escuela → Plaza del Norte → Los Álamos.
--   TR-SUR:   Escuela → Parque del Sur → El Molino.
--   TR-ESTE:  Escuela → Centro Este → La Ribera.
--   TR-OESTE: Escuela → Polideportivo Oeste → Los Aromos.
--
-- ============================================================
-- POR QUÉ SE REUTILIZA 013 Y NO SE CREA UN MODELO PARALELO
-- ============================================================
-- La migración 013 (EPT-10) ya deja el catálogo `public.servicios_escolares`
-- y la inscripción `public.inscripciones_servicios` preparados exactamente
-- para esto: `tipo_servicio_escolar` ya incluye 'TRANSPORTE' y su propio
-- comentario dice explícitamente que incorporar los cuatro recorridos es
-- «agregar filas al catálogo, no crear tablas». Por eso EPT-60 no crea una
-- segunda inscripción paralela: siembra filas en el catálogo existente y
-- reutiliza sus RPC, su vista y sus políticas tal cual.
--
-- Lo único que 013 no modela es el orden de las paradas de un recorrido, que
-- es un atributo propio del transporte y no del comedor. Por eso esta
-- migración agrega una tabla de EXTENSIÓN normalizada,
-- `public.paradas_recorrido`, en vez de columnas nuevas en `servicios_
-- escolares` o `inscripciones_servicios`.
--
-- ============================================================
-- LO QUE 013 DEJABA ABIERTO Y QUE ESTA MIGRACIÓN RESUELVE
-- ============================================================
--   1. «Un solo recorrido de transporte activo por alumno»: el índice único
--      parcial de 013 solo evita repetir el MISMO servicio; no evita tener
--      dos recorridos distintos activos a la vez, porque cada recorrido es
--      una fila distinta del catálogo. Postgres no admite una subconsulta
--      como predicado de un índice parcial, así que la regla se garantiza
--      con un trigger (mismo patrón que el límite de dos deportes de 014),
--      extendiendo `app_private.validar_inscripcion_servicio()` con
--      `CREATE OR REPLACE` en esta migración —no se edita el archivo 013—.
--
--   2. «Cambio atómico, nunca sin transporte si el destino falla»: comedor y
--      deportes cambian de inscripción con DOS llamadas RPC separadas
--      (cancelar + inscribir) desde el cliente, que no garantizan nada si la
--      segunda falla. Esta migración agrega
--      `app_private.establecer_recorrido_transporte(uuid)`, una sola RPC que
--      hace cancelar-el-viejo + insertar-el-nuevo dentro de la misma
--      función: si el INSERT falla, PostgreSQL revierte toda la función
--      (no hay COMMIT parcial posible dentro de una función) y la
--      inscripción anterior queda intacta. La misma RPC sirve para
--      inscribirse por primera vez (no hay nada que cancelar) y para
--      cambiar de recorrido, y es idempotente si se «cambia» al recorrido
--      que ya está activo (devuelve la fila existente sin tocar nada).
--
--   3. Para que el chequeo de unicidad sea exacto ante concurrencia, el
--      bloqueo de la fila de `alumnos` en `validar_inscripcion_servicio()`
--      pasa de `FOR SHARE` a `FOR NO KEY UPDATE`: dos altas concurrentes del
--      mismo alumno ahora se serializan (antes, dos bloqueos compartidos
--      podían coexistir y las dos verificaciones podían no ver la fila del
--      otro). Para comedor esto es una serialización más fuerte pero no
--      cambia ningún resultado observable: sigue sin existir una regla
--      cruzada entre servicios de comedor, así que el comportamiento y las
--      pruebas de EPT-10 no cambian.
--
-- ============================================================
-- MODELO
-- ============================================================
--   1. Cuatro filas nuevas en `public.servicios_escolares` con
--      `tipo = 'TRANSPORTE'`, códigos estables TR-NORTE/TR-SUR/TR-ESTE/
--      TR-OESTE e identificador fijo, reproducibles ante un `db reset`.
--
--   2. `public.paradas_recorrido`: paradas ordenadas de un recorrido de
--      transporte. `servicio_id` + `orden` es único; un trigger impide que
--      una parada cuelgue de un servicio que no sea de tipo TRANSPORTE.
--      Es solo lectura para la aplicación: se siembra en esta migración y
--      no hay ninguna RPC que la escriba. Los nombres y paradas son
--      ficticios, tal como documenta el bloque anterior.
--
--   3. Dirección mantiene la información descriptiva (nombre, activo) con
--      `app_private.actualizar_recorrido(uuid, text, boolean)`. El código y
--      el tipo del servicio siguen siendo inmutables por el trigger
--      `proteger_identidad_servicio` de 013 en cuanto el recorrido tiene
--      alguna inscripción.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                              | Garantía                          |
-- |----------------------------------------------------------|-----------------------------------|
-- | Los cuatro códigos de recorrido existen y son estables    | semilla con id e código fijos     |
-- | Una parada pertenece a un servicio de tipo TRANSPORTE      | trigger BEFORE INSERT + FOR SHARE |
-- | Paradas de un recorrido con orden único                   | índice único (servicio_id, orden) |
-- | Un solo recorrido de transporte ACTIVA por alumno          | trigger + alumno FOR NO KEY UPDATE|
-- | Cambio de recorrido atómico, sin perder el anterior        | una sola función, sin COMMIT parcial |
-- | Cambio al mismo recorrido es idempotente                   | función: detecta y devuelve igual |
-- | Solo ESTUDIANTE se inscribe o cambia de recorrido           | RPC + rol derivado en la base      |
-- | El alumno de la operación es el de la sesión                | RPC deriva de auth.uid()           |
-- | Solo DIRECTOR edita nombre/activo de un recorrido            | RPC + es_director()               |
-- | Código y tipo de un recorrido con inscripciones, inmutables  | trigger de 013 (reutilizado)      |
-- | Comedor no puede tener paradas                              | trigger BEFORE INSERT             |
-- | Sin borrado físico de recorridos, paradas ni inscripciones   | sin GRANT, política ni RPC        |
-- | Bloqueo de cuenta (EPT-59) también cubre `paradas_recorrido` | política RESTRICTIVE agregada acá |
--
-- ============================================================
-- ORDEN DE BLOQUEOS
-- ============================================================
--     alumnos  →  servicios_escolares  →  inscripciones_servicios
--
-- Es el mismo orden que ya usa 013. `establecer_recorrido_transporte` toma
-- `alumnos FOR NO KEY UPDATE` primero, valida el servicio destino con
-- `FOR SHARE` y recién then bloquea `FOR UPDATE` la inscripción activa
-- propia (si existe) antes de cancelarla e insertar la nueva. El trigger de
-- validación repite el mismo orden y los mismos bloqueos, así que no hay
-- ciclos ni con las operaciones académicas de 008/009 (que también empiezan
-- por `alumnos FOR UPDATE`).
--
-- Para `public.paradas_recorrido` el único bloqueo es
-- `servicios_escolares FOR SHARE`, tomado por el trigger de la sección 4; no
-- depende de `alumnos` ni de `inscripciones_servicios`, así que no puede
-- crear un ciclo con el orden anterior.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P596x, sin colisión con 006–014 (P550x–P558x) ni con EPT-57,
-- EPT-58 ni EPT-59 (P590x–P594x, más P5520/P5521 reutilizados).
-- Reutilizados de 013: P5505, 42501, P5550, P5551, P5552, P5553, P5554,
-- P5555, P5556, P5557, P5558.
--   P5960  la operación es exclusiva de recorridos de transporte
--   P5961  ya existe un recorrido de transporte activo distinto
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE PRESERVACIÓN
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.servicios_escolares') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NULL
       OR pg_catalog.to_regclass('public.alumnos') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-60: faltan tablas base; la base no corresponde a 001–014.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('public.es_director_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.validar_inscripcion_servicio()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.texto_servicio_valido(text,integer)') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-60: faltan las funciones de identidad o de servicios escolares; la base no corresponde a 001–014.';
    END IF;

    IF pg_catalog.to_regclass('public.paradas_recorrido') IS NOT NULL THEN
        RAISE EXCEPTION
            'Migración EPT-60: ya existen objetos de transporte; revisá el estado de la base antes de continuar.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.servicios_escolares WHERE tipo = 'TRANSPORTE') THEN
        RAISE EXCEPTION
            'Migración EPT-60: ya existen servicios de transporte; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_060_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_060_conteos_iniciales (relacion, cantidad)
VALUES
    ('inscripciones_servicios', (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios)),
    ('servicios_escolares', (SELECT pg_catalog.count(*) FROM public.servicios_escolares)),
    ('alumnos', (SELECT pg_catalog.count(*) FROM public.alumnos)),
    ('perfiles', (SELECT pg_catalog.count(*) FROM public.perfiles));


-- ================================================================
-- 2. SIEMBRA DE LOS CUATRO RECORRIDOS
-- ================================================================
-- Identificadores fijos, igual que el comedor de 013 y los deportes de 014:
-- un `db reset` vuelve a producir exactamente las mismas cuatro filas.
-- Nombres y paradas son ficticios; no representan un servicio real.
INSERT INTO public.servicios_escolares (id, tipo, codigo, nombre, activo)
VALUES
    ('e0000000-0000-4000-8000-000000000020', 'TRANSPORTE', 'TR-NORTE', 'Recorrido Norte (ficticio)', TRUE),
    ('e0000000-0000-4000-8000-000000000021', 'TRANSPORTE', 'TR-SUR',   'Recorrido Sur (ficticio)',   TRUE),
    ('e0000000-0000-4000-8000-000000000022', 'TRANSPORTE', 'TR-ESTE',  'Recorrido Este (ficticio)',  TRUE),
    ('e0000000-0000-4000-8000-000000000023', 'TRANSPORTE', 'TR-OESTE', 'Recorrido Oeste (ficticio)', TRUE);


-- ================================================================
-- 3. PARADAS DE LOS RECORRIDOS
-- ================================================================
CREATE TABLE public.paradas_recorrido (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    -- ON DELETE RESTRICT, igual que el resto del modelo de 013: el catálogo
    -- no se borra físicamente, así que esta referencia nunca se ejerce, pero
    -- deja explícito que las paradas no pueden quedar huérfanas.
    servicio_id UUID NOT NULL
        REFERENCES public.servicios_escolares(id) ON DELETE RESTRICT,
    orden SMALLINT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT paradas_recorrido_orden_valido CHECK (orden BETWEEN 1 AND 20),
    CONSTRAINT paradas_recorrido_orden_unico UNIQUE (servicio_id, orden),
    CONSTRAINT paradas_recorrido_nombre_valido
        CHECK (app_private.texto_servicio_valido(nombre, 100) IS TRUE)
);

COMMENT ON TABLE public.paradas_recorrido IS
    'Paradas ordenadas de un recorrido de transporte. Nombres ficticios, sembrados por esta migración; no hay RPC que los escriba.';

-- Índice de la clave foránea hacia el catálogo; el orden ya queda cubierto
-- por el índice único de la restricción anterior.
CREATE INDEX idx_paradas_recorrido_servicio
    ON public.paradas_recorrido (servicio_id);

-- ----------------------------------------------------------------
-- Solo un servicio de tipo TRANSPORTE puede tener paradas
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.validar_parada_recorrido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tipo_servicio public.tipo_servicio_escolar;
BEGIN
    SELECT s.tipo INTO v_tipo_servicio
    FROM public.servicios_escolares s
    WHERE s.id = NEW.servicio_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5550', MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    IF v_tipo_servicio IS DISTINCT FROM 'TRANSPORTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5960',
            MESSAGE = 'Solo un recorrido de transporte puede tener paradas.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_parada_recorrido()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validar_parada_recorrido_antes_de_insertar
    BEFORE INSERT ON public.paradas_recorrido
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_parada_recorrido();

-- ----------------------------------------------------------------
-- Semilla reproducible de paradas (ficticias)
-- ----------------------------------------------------------------
INSERT INTO public.paradas_recorrido (id, servicio_id, orden, nombre) VALUES
    ('f0000000-0000-4000-8000-000000002001', 'e0000000-0000-4000-8000-000000000020', 1, 'Escuela'),
    ('f0000000-0000-4000-8000-000000002002', 'e0000000-0000-4000-8000-000000000020', 2, 'Plaza del Norte'),
    ('f0000000-0000-4000-8000-000000002003', 'e0000000-0000-4000-8000-000000000020', 3, 'Los Álamos'),

    ('f0000000-0000-4000-8000-000000002101', 'e0000000-0000-4000-8000-000000000021', 1, 'Escuela'),
    ('f0000000-0000-4000-8000-000000002102', 'e0000000-0000-4000-8000-000000000021', 2, 'Parque del Sur'),
    ('f0000000-0000-4000-8000-000000002103', 'e0000000-0000-4000-8000-000000000021', 3, 'El Molino'),

    ('f0000000-0000-4000-8000-000000002201', 'e0000000-0000-4000-8000-000000000022', 1, 'Escuela'),
    ('f0000000-0000-4000-8000-000000002202', 'e0000000-0000-4000-8000-000000000022', 2, 'Centro Este'),
    ('f0000000-0000-4000-8000-000000002203', 'e0000000-0000-4000-8000-000000000022', 3, 'La Ribera'),

    ('f0000000-0000-4000-8000-000000002301', 'e0000000-0000-4000-8000-000000000023', 1, 'Escuela'),
    ('f0000000-0000-4000-8000-000000002302', 'e0000000-0000-4000-8000-000000000023', 2, 'Polideportivo Oeste'),
    ('f0000000-0000-4000-8000-000000002303', 'e0000000-0000-4000-8000-000000000023', 3, 'Los Aromos');


-- ================================================================
-- 4. EXTENSIÓN DE LA INVARIANTE DE INSCRIPCIÓN: MÁXIMO UN TRANSPORTE ACTIVO
-- ================================================================
-- Reemplaza por completo la función de 013 (CREATE OR REPLACE sobre una
-- migración anterior, nunca se edita el archivo 013). El disparador
-- `validar_inscripcion_servicio_antes_de_escribir` ya existe y sigue
-- apuntando a esta función; no se crea un disparador nuevo.
--
-- Cambios respecto de 013:
--   a) El bloqueo de `alumnos` pasa de `FOR SHARE` a `FOR NO KEY UPDATE`,
--      para que el conteo de recorridos activos de la sección b) sea exacto
--      ante altas concurrentes del mismo alumno.
--   b) Si el servicio es de tipo TRANSPORTE, se rechaza la alta si el
--      alumno ya tiene otro recorrido de transporte activo (P5961).
-- El resto del cuerpo es idéntico al de 013.
CREATE OR REPLACE FUNCTION app_private.validar_inscripcion_servicio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado_alumno   public.estado_alumno;
    v_legajo          VARCHAR(50);
    v_tipo_servicio   public.tipo_servicio_escolar;
    v_servicio_activo BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.alumno_id IS DISTINCT FROM OLD.alumno_id
           OR NEW.servicio_id IS DISTINCT FROM OLD.servicio_id
           OR NEW.fecha_inscripcion IS DISTINCT FROM OLD.fecha_inscripcion THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5557',
                MESSAGE = 'El alumno, el servicio y la fecha de alta de una inscripción no pueden modificarse.';
        END IF;

        IF OLD.estado = 'CANCELADA' AND NEW.estado = 'ACTIVA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5558',
                MESSAGE = 'Una inscripción cancelada no se reactiva. Volvé a inscribirte para registrar un ciclo nuevo.';
        END IF;

        IF OLD.estado = 'CANCELADA' AND NEW.estado = 'CANCELADA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5556',
                MESSAGE = 'La inscripción ya está cancelada.';
        END IF;

        IF NEW.estado = 'CANCELADA' THEN
            NEW.fecha_cancelacion := NOW();
        END IF;

        RETURN NEW;
    END IF;

    -- A partir de acá, TG_OP = 'INSERT'.
    IF NEW.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5558',
            MESSAGE = 'Una inscripción nueva solo puede crearse en estado ACTIVA.';
    END IF;

    -- (a) Bloqueo exclusivo de la fila del alumno: serializa toda alta de
    -- servicios escolares del mismo alumno, no solo las de transporte.
    SELECT a.estado, p.legajo_nro
    INTO v_estado_alumno, v_legajo
    FROM public.alumnos a
    JOIN public.perfiles p ON p.id = a.perfil_id
    WHERE a.perfil_id = NEW.alumno_id
    FOR NO KEY UPDATE OF a
    FOR SHARE OF p;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5552',
            MESSAGE = 'La persona indicada no tiene legajo académico de alumno.';
    END IF;

    IF v_estado_alumno <> 'ACTIVO' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5553',
            MESSAGE = 'Solo un alumno con estado ACTIVO puede inscribirse a un servicio escolar.';
    END IF;

    IF v_legajo IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5554',
            MESSAGE = 'El alumno no tiene número de legajo y no puede inscribirse.';
    END IF;

    SELECT s.tipo, s.activo
    INTO v_tipo_servicio, v_servicio_activo
    FROM public.servicios_escolares s
    WHERE s.id = NEW.servicio_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5550',
            MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    IF NOT v_servicio_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5551',
            MESSAGE = 'El servicio está inactivo y no admite nuevas inscripciones.';
    END IF;

    -- (b) Máximo un recorrido de transporte activo. El alumno ya está
    -- bloqueado en modo exclusivo desde el paso (a), así que este conteo es
    -- exacto ante dos altas concurrentes del mismo alumno.
    IF v_tipo_servicio = 'TRANSPORTE' AND EXISTS (
        SELECT 1
        FROM public.inscripciones_servicios i
        JOIN public.servicios_escolares s2 ON s2.id = i.servicio_id
        WHERE i.alumno_id = NEW.alumno_id
          AND i.estado = 'ACTIVA'
          AND s2.tipo = 'TRANSPORTE'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5961',
            MESSAGE = 'Ya tenés un recorrido de transporte activo. Usá el cambio de recorrido en lugar de inscribirte a otro.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_inscripcion_servicio()
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 5. VISTA DE CATÁLOGO CON PARADAS
-- ================================================================
-- `security_invoker = true`: respeta RLS y privilegios de quien consulta.
-- Ambas tablas de origen ya son legibles por cualquier `authenticated` (013 y
-- la sección 6 de esta migración), así que la vista no necesita filtrar por
-- rol: sirve al alumno para ver los cuatro recorridos y a Dirección para
-- administrarlos.
CREATE VIEW public.recorridos_transporte
WITH (security_invoker = true) AS
SELECT
    s.id,
    s.codigo,
    s.nombre,
    s.activo,
    (
        SELECT pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object('orden', pr.orden, 'nombre', pr.nombre)
                   ORDER BY pr.orden
               )
        FROM public.paradas_recorrido pr
        WHERE pr.servicio_id = s.id
    ) AS paradas
FROM public.servicios_escolares s
WHERE s.tipo = 'TRANSPORTE';

COMMENT ON VIEW public.recorridos_transporte IS
    'Catálogo de recorridos de transporte con sus paradas ordenadas. Datos ficticios. Respeta RLS mediante security_invoker.';

REVOKE ALL ON public.recorridos_transporte FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.recorridos_transporte TO authenticated;


-- ================================================================
-- 6. PRIVILEGIOS MÍNIMOS Y RLS DE `paradas_recorrido`
-- ================================================================
ALTER TABLE public.paradas_recorrido ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.paradas_recorrido FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.paradas_recorrido TO authenticated;

CREATE POLICY "Las paradas de los recorridos son visibles para las sesiones autenticadas"
    ON public.paradas_recorrido
    FOR SELECT TO authenticated
    USING (TRUE);

-- Réplica manual de la política RESTRICTIVE de bloqueo de cuenta (EPT-59):
-- esa migración solo la agregó a las tablas que existían en ese momento y
-- dice explícitamente que una tabla nueva debe agregarla ella misma. Mismo
-- predicado, mismo nombre de política, mismo alcance FOR ALL.
CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.paradas_recorrido
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

-- Ninguna política INSERT, UPDATE ni DELETE permisiva: la tabla se siembra
-- en esta migración y no hay ninguna RPC que la escriba.


-- ================================================================
-- 7. OPERACIONES PRIVILEGIADAS DE TRANSPORTE
-- ================================================================
-- Viven en `app_private`. Ninguna recibe alumno, perfil, legajo ni rol como
-- parámetro: el alumno es siempre el de `auth.uid()`.

-- ----------------------------------------------------------------
-- Alta o cambio atómico del recorrido del alumno de la sesión
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.establecer_recorrido_transporte(p_servicio_id UUID)
RETURNS public.inscripciones_servicios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil_id      UUID;
    v_rol            TEXT;
    v_tipo_servicio  public.tipo_servicio_escolar;
    v_servicio_activo BOOLEAN;
    v_activa_actual  public.inscripciones_servicios;
    v_resultado      public.inscripciones_servicios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF p_servicio_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5550', MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    v_perfil_id := app_private.perfil_actual();
    v_rol := app_private.rol_actual();

    IF v_perfil_id IS NULL OR v_rol IS DISTINCT FROM 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo un estudiante puede inscribirse o cambiar de recorrido de transporte.';
    END IF;

    -- Orden de bloqueos: alumno primero, igual que el resto del modelo.
    PERFORM 1 FROM public.alumnos a
    WHERE a.perfil_id = v_perfil_id
    FOR NO KEY UPDATE;

    -- El destino se valida ANTES de tocar la inscripción vigente: si el
    -- destino no es válido, la función termina acá y no se cancela nada.
    SELECT s.tipo, s.activo
    INTO v_tipo_servicio, v_servicio_activo
    FROM public.servicios_escolares s
    WHERE s.id = p_servicio_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5550', MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    IF v_tipo_servicio IS DISTINCT FROM 'TRANSPORTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5960',
            MESSAGE = 'Esta operación es exclusiva de recorridos de transporte.';
    END IF;

    IF NOT v_servicio_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5551',
            MESSAGE = 'El recorrido está inactivo y no admite nuevas inscripciones.';
    END IF;

    -- Recorrido de transporte activo del alumno, si tiene uno.
    SELECT i.* INTO v_activa_actual
    FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id
    WHERE i.alumno_id = v_perfil_id
      AND i.estado = 'ACTIVA'
      AND s.tipo = 'TRANSPORTE'
    FOR UPDATE OF i;

    IF FOUND THEN
        -- Semántica idempotente y explícita: «cambiar» al recorrido que ya
        -- está activo no crea una fila nueva ni cancela nada, y devuelve la
        -- inscripción existente sin cambios.
        IF v_activa_actual.servicio_id = p_servicio_id THEN
            RETURN v_activa_actual;
        END IF;

        -- Cancelación del recorrido anterior. Si el INSERT de abajo falla
        -- por cualquier motivo, PostgreSQL revierte esta función entera (no
        -- hay COMMIT parcial dentro de una función), así que esta fila nunca
        -- queda cancelada sin una nueva activa.
        UPDATE public.inscripciones_servicios
        SET estado = 'CANCELADA'
        WHERE id = v_activa_actual.id;
    END IF;

    INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
    VALUES (v_perfil_id, p_servicio_id)
    RETURNING * INTO v_resultado;

    RETURN v_resultado;
END;
$$;

-- ----------------------------------------------------------------
-- Mantenimiento de la información descriptiva (DIRECTOR)
-- ----------------------------------------------------------------
-- Solo nombre y estado activo/inactivo. El código y el tipo son inmutables
-- por el trigger `proteger_identidad_servicio` de 013 en cuanto el recorrido
-- tenga alguna inscripción; esta función no intenta tocarlos.
CREATE OR REPLACE FUNCTION app_private.actualizar_recorrido(
    p_servicio_id UUID,
    p_nombre      TEXT,
    p_activo      BOOLEAN
)
RETURNS public.servicios_escolares
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tipo_servicio public.tipo_servicio_escolar;
    v_resultado     public.servicios_escolares;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede editar un recorrido de transporte.';
    END IF;

    IF p_servicio_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5550', MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    IF p_nombre IS NULL OR p_activo IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5960',
            MESSAGE = 'El nombre y el estado activo del recorrido son obligatorios.';
    END IF;

    SELECT s.tipo INTO v_tipo_servicio
    FROM public.servicios_escolares s
    WHERE s.id = p_servicio_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5550', MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    IF v_tipo_servicio IS DISTINCT FROM 'TRANSPORTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5960',
            MESSAGE = 'Esta operación es exclusiva de recorridos de transporte.';
    END IF;

    UPDATE public.servicios_escolares
    SET nombre = p_nombre,
        activo = p_activo
    WHERE id = p_servicio_id
    RETURNING * INTO v_resultado;

    RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION app_private.establecer_recorrido_transporte(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.actualizar_recorrido(UUID, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION app_private.establecer_recorrido_transporte(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.actualizar_recorrido(UUID, TEXT, BOOLEAN) TO authenticated;


-- ================================================================
-- 8. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
CREATE OR REPLACE FUNCTION public.establecer_recorrido_transporte(p_servicio_id UUID)
RETURNS public.inscripciones_servicios
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.establecer_recorrido_transporte(p_servicio_id);
$$;

CREATE OR REPLACE FUNCTION public.actualizar_recorrido(
    p_servicio_id UUID,
    p_nombre      TEXT,
    p_activo      BOOLEAN
)
RETURNS public.servicios_escolares
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.actualizar_recorrido(p_servicio_id, p_nombre, p_activo);
$$;

REVOKE ALL ON FUNCTION public.establecer_recorrido_transporte(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_recorrido(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.establecer_recorrido_transporte(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_recorrido(UUID, TEXT, BOOLEAN) TO authenticated;


-- ================================================================
-- 9. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion   TEXT;
    v_antes      BIGINT;
    v_despues    BIGINT;
    v_privilegio TEXT;
    v_rol        TEXT;
    v_tabla      TEXT;
    v_firma      pg_catalog.regprocedure;
BEGIN
    FOREACH v_relacion IN ARRAY ARRAY['alumnos', 'perfiles'] LOOP
        SELECT cantidad INTO v_antes FROM ept_060_conteos_iniciales WHERE relacion = v_relacion;
        v_despues := CASE v_relacion
            WHEN 'alumnos' THEN (SELECT pg_catalog.count(*) FROM public.alumnos)
            WHEN 'perfiles' THEN (SELECT pg_catalog.count(*) FROM public.perfiles)
        END;
        IF v_despues <> v_antes THEN
            RAISE EXCEPTION 'Autoverificación EPT-60: % cambió de % a % filas.', v_relacion, v_antes, v_despues;
        END IF;
    END LOOP;

    SELECT cantidad INTO v_antes FROM ept_060_conteos_iniciales WHERE relacion = 'inscripciones_servicios';
    IF (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios) <> v_antes THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: la migración creó o alteró inscripciones_servicios.';
    END IF;

    SELECT cantidad INTO v_antes FROM ept_060_conteos_iniciales WHERE relacion = 'servicios_escolares';
    IF (SELECT pg_catalog.count(*) FROM public.servicios_escolares) <> v_antes + 4 THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: no se sembraron exactamente cuatro recorridos.';
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.servicios_escolares
        WHERE tipo = 'TRANSPORTE' AND activo
          AND codigo IN ('TR-NORTE', 'TR-SUR', 'TR-ESTE', 'TR-OESTE')) <> 4 THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: los cuatro códigos de recorrido no quedaron sembrados y activos.';
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.paradas_recorrido) <> 12 THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: no se sembraron exactamente doce paradas (tres por recorrido).';
    END IF;

    IF EXISTS (
        SELECT servicio_id FROM public.paradas_recorrido
        GROUP BY servicio_id
        HAVING pg_catalog.count(*) <> 3 OR pg_catalog.count(DISTINCT orden) <> 3
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: algún recorrido no tiene exactamente tres paradas con orden único.';
    END IF;

    -- Ningún privilegio de escritura ni de borrado para los roles de aplicación.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.paradas_recorrido'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'Autoverificación EPT-60: % conserva % sobre %.', v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF pg_catalog.has_table_privilege('anon', 'public.paradas_recorrido', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.recorridos_transporte', 'SELECT') THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: anon puede leer objetos de transporte.';
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.paradas_recorrido'::pg_catalog.regclass) THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: paradas_recorrido no tiene RLS.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'paradas_recorrido'
          AND policyname = 'Bloqueo de acceso sin datos protegidos'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: falta la política RESTRICTIVE de bloqueo de cuenta en paradas_recorrido.';
    END IF;

    -- La política RESTRICTIVE de bloqueo de cuenta es FOR ALL a propósito
    -- (cmd = 'ALL'); lo que no debe existir es una PERMISSIVE de escritura.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'paradas_recorrido'
          AND cmd <> 'SELECT' AND permissive = 'PERMISSIVE'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: existe una política PERMISSIVE de escritura sobre paradas_recorrido.';
    END IF;

    IF NOT ('security_invoker=true' = ANY (
        COALESCE((SELECT reloptions FROM pg_catalog.pg_class
                  WHERE oid = 'public.recorridos_transporte'::pg_catalog.regclass),
                 ARRAY[]::TEXT[])
    )) THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: la vista de recorridos no es security_invoker.';
    END IF;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.establecer_recorrido_transporte(uuid)'::pg_catalog.regprocedure,
        'app_private.actualizar_recorrido(uuid,text,boolean)'::pg_catalog.regprocedure,
        'app_private.validar_inscripcion_servicio()'::pg_catalog.regprocedure,
        'app_private.validar_parada_recorrido()'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación EPT-60: % no es SECURITY DEFINER con search_path vacío o es ejecutable por anon.',
                v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'public.establecer_recorrido_transporte(uuid)'::pg_catalog.regprocedure,
        'public.actualizar_recorrido(uuid,text,boolean)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-60: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna RPC de transporte acepta identidad, rol ni legajo del llamador.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname = 'establecer_recorrido_transporte'
          AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                 OR nombre ILIKE '%actor%' OR nombre ILIKE '%alumno%'
                 OR nombre ILIKE '%perfil%' OR nombre ILIKE '%legajo%'
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: establecer_recorrido_transporte acepta identidad, rol o legajo del llamador.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.paradas_recorrido'::pg_catalog.regclass
          AND contype = 'f'
          AND confdeltype <> 'r'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-60: la clave foránea de paradas_recorrido no es ON DELETE RESTRICT.';
    END IF;

    RAISE NOTICE
        'Migración EPT-60: % recorridos de transporte sembrados con % paradas en total; % inscripciones a servicios escolares preservadas sin cambios.',
        (SELECT pg_catalog.count(*) FROM public.servicios_escolares WHERE tipo = 'TRANSPORTE'),
        (SELECT pg_catalog.count(*) FROM public.paradas_recorrido),
        (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios);
END $$;
