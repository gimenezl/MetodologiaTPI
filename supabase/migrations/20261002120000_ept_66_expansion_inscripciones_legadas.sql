-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Inscripciones legadas: EXPANSIÓN (EPT-66, 1 de 2)
-- ============================================================
-- Decisión D1=A (Lucas): los talleres y las actividades legadas NO se
-- incorporan a la administración de inscripciones de RF16/EPT-62 ni a su
-- historial. Conservan el autoservicio que ya existe (alta, baja y
-- reinscripción del alumno propio y del padre de un hijo vinculado), pero con
-- baja LÓGICA, funciones seguras, cupo serializado y sin DELETE físico.
--
-- ESTA ES LA PRIMERA DE DOS MIGRACIONES Y ES COMPATIBLE HACIA ATRÁS.
--
--   1. EXPANSIÓN (este archivo): agrega lo que la aplicación nueva necesita
--      (columna, índice, funciones RPC, serialización del cupo) SIN retirar
--      ningún permiso ni política. La aplicación anterior sigue funcionando
--      íntegra contra la base ya migrada: sus altas, bajas (UPDATE a BAJA) y
--      reinscripciones (DELETE + INSERT) continúan operando.
--   2. CONTRACCIÓN (migración siguiente): revoca la escritura directa y el
--      DELETE, acota la lectura y fija los privilegios. Solo se aplica cuando
--      la aplicación nueva, que usa estas funciones, ya está desplegada.
--
-- Nunca se aplican las dos juntas: entre ambas hay un despliegue de aplicación.
--
-- QUÉ AGREGA
--
--   a. `inscripciones.fecha_baja`: cuándo se dio de baja la inscripción.
--   b. Tratamiento de la fila histórica BAJA. Como en 013 (servicios), la
--      unicidad pasa a ser sobre la inscripción ACTIVA: un índice único
--      parcial reemplaza a UNIQUE(estudiante_id, actividad_id). La
--      reinscripción CREA una fila nueva y la fila BAJA queda intacta como
--      historia: nunca se recicla ni se reactiva. (La contracción hace que una
--      fila BAJA sea inmutable.) Se retira la restricción única completa
--      porque con ella una segunda inscripción es imposible sin borrar o
--      reactivar la fila anterior.
--   c. Cupo serializado en PostgreSQL. El trigger de cupo (001) contaba sin
--      bloquear: dos altas simultáneas de la última plaza veían ambas un lugar
--      libre. Ahora toma un bloqueo de fila sobre la actividad antes de
--      contar, de modo que las altas y los cambios de estado de una misma
--      actividad se ejecutan en fila, sea cual sea el camino (función o SQL
--      directo). Un cambio de estado a ACTIVO o de actividad también se valida.
--      El bloqueo y el conteo viven en una función privada SECURITY DEFINER;
--      la función del trigger sigue en `public` como SECURITY INVOKER.
--   d. Funciones RPC (SECURITY DEFINER en `app_private`, envoltorio público
--      SECURITY INVOKER, el patrón de 013/016):
--        inscribir_actividad_legada, dar_baja_inscripcion_legada,
--        listar_inscripciones_actividades_legadas,
--        listar_inscriptos_actividad_legada,
--        consultar_cupos_actividades_legadas.
--      Autorización: el alumno sobre sí mismo, el padre sobre un hijo
--      actualmente vinculado y Dirección. DOCENTE y PERSONAL quedan fuera:
--      no existe un contrato que defina qué alumnos están a cargo de un
--      DOCENTE (docs/evidence/EPT-9.md §18.2), y no se conserva por inercia su
--      escritura sobre cualquier alumno. Un alumno o hijo ajeno recibe el mismo
--      error que uno inexistente, para no revelar su existencia.
--   e. Endurecimiento de `calcular_porcentaje_asistencia` (search_path fijo y
--      EXECUTE solo para sesiones autenticadas) y de `verificar_cupo_actividad`
--      (search_path fijo y sin EXECUTE para ningún rol de la aplicación: solo
--      la invoca el trigger).
--
-- LO QUE NO TOCA
--   · La lógica deportiva de EPT-11/EPT-61: `bloquear_inscripcion_deportiva_legada`
--     sigue intacta y se ejecuta ANTES del trigger de cupo.
--   · Ninguna política RLS, ningún GRANT sobre tablas y ningún dato: la
--     autoverificación final comprueba que no cambió ningún conteo.
--   · Las tres filas legadas de producción: no se modifican ni se mueven.
--
-- Reversión: Git no revierte PostgreSQL. Esta migración se compensa hacia
-- adelante con otra (devolver el índice a la restricción única solo es posible
-- mientras no existan dos filas del mismo par; las funciones se pueden retirar
-- con DROP FUNCTION). Ver docs/evidence/EPT-66.md.
-- ============================================================

-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE REFERENCIA
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.inscripciones') IS NULL
       OR pg_catalog.to_regclass('public.actividades') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.padres_hijos') IS NULL
       OR pg_catalog.to_regclass('public.asistencias') IS NULL
    THEN
        RAISE EXCEPTION 'Precondición EPT-66: faltan tablas base (001/011).';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.mis_hijos_ids()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.bloquear_inscripcion_deportiva_legada()') IS NULL
       OR pg_catalog.to_regprocedure('public.verificar_cupo_actividad()') IS NULL
       OR pg_catalog.to_regprocedure('public.calcular_porcentaje_asistencia(uuid)') IS NULL
    THEN
        RAISE EXCEPTION 'Precondición EPT-66: faltan funciones de identidad o de cupo (005/008/011/014).';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.inscripciones'::pg_catalog.regclass
          AND conname = 'inscripciones_estudiante_id_actividad_id_key'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_inscripciones_una_activa'
    ) THEN
        RAISE EXCEPTION 'Precondición EPT-66: no existe la restricción única de inscripciones ni su reemplazo.';
    END IF;

    -- Un par con dos filas ACTIVO impediría el índice único parcial.
    IF EXISTS (
        SELECT 1 FROM public.inscripciones
        WHERE estado = 'ACTIVO'
        GROUP BY estudiante_id, actividad_id HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Precondición EPT-66: hay inscripciones ACTIVO duplicadas; resolver antes de migrar.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_066a_conteos (relacion TEXT PRIMARY KEY, cantidad BIGINT NOT NULL) ON COMMIT DROP;
INSERT INTO ept_066a_conteos
SELECT 'inscripciones', pg_catalog.count(*) FROM public.inscripciones
UNION ALL SELECT 'inscripciones_activas', pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'ACTIVO'
UNION ALL SELECT 'inscripciones_baja', pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'BAJA'
UNION ALL SELECT 'actividades', pg_catalog.count(*) FROM public.actividades
UNION ALL SELECT 'asistencias', pg_catalog.count(*) FROM public.asistencias
UNION ALL SELECT 'perfiles', pg_catalog.count(*) FROM public.perfiles
UNION ALL SELECT 'padres_hijos', pg_catalog.count(*) FROM public.padres_hijos;

-- ================================================================
-- 2. ESTRUCTURA: BAJA LÓGICA Y UNICIDAD DE LA INSCRIPCIÓN ACTIVA
-- ================================================================
ALTER TABLE public.inscripciones
    ADD COLUMN IF NOT EXISTS fecha_baja TIMESTAMPTZ;

COMMENT ON COLUMN public.inscripciones.fecha_baja IS
    'Momento de la baja lógica. NULL en inscripciones ACTIVO y en las bajas anteriores a EPT-66, que no lo registraron.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.inscripciones'::pg_catalog.regclass
          AND conname = 'inscripciones_fecha_baja_coherente'
    ) THEN
        ALTER TABLE public.inscripciones
            ADD CONSTRAINT inscripciones_fecha_baja_coherente
            CHECK (fecha_baja IS NULL OR estado = 'BAJA');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inscripciones_una_activa
    ON public.inscripciones (estudiante_id, actividad_id)
    WHERE estado = 'ACTIVO';

-- Con el índice parcial vigente, la restricción única completa ya no hace falta
-- y sobra: impediría conservar la fila BAJA y crear la reinscripción.
ALTER TABLE public.inscripciones
    DROP CONSTRAINT IF EXISTS inscripciones_estudiante_id_actividad_id_key;

-- ================================================================
-- 3. CUPO SERIALIZADO
-- ================================================================
-- El bloqueo de fila sobre `actividades` y el conteo de las inscripciones
-- activas no pueden hacerlos los roles de la aplicación: el primero exige un
-- privilegio que no tienen y el segundo pasaría por su RLS (que la contracción
-- acota). Los hace una función SECURITY DEFINER de `app_private`; la función
-- del trigger, en `public`, sigue siendo SECURITY INVOKER (la convención del
-- proyecto prohíbe SECURITY DEFINER en `public`) y solo decide cuándo llamarla.
CREATE OR REPLACE FUNCTION app_private.verificar_cupo_bloqueando(
    p_actividad_id  INTEGER,
    p_inscripcion_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inscriptos INTEGER;
    v_cupo       INTEGER;
BEGIN
    -- Bloqueo de fila sobre la actividad: serializa toda alta o cambio de estado
    -- de la misma actividad. Sin él, dos transacciones ven a la vez un lugar
    -- libre y ambas lo ocupan. NO KEY UPDATE no estorba a las comprobaciones de
    -- clave foránea de otras filas.
    SELECT a.cupo_maximo
    INTO v_cupo
    FROM public.actividades a
    WHERE a.id = p_actividad_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        -- La clave foránea rechaza la actividad inexistente con su propio error.
        RETURN;
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_inscriptos
    FROM public.inscripciones i
    WHERE i.actividad_id = p_actividad_id
      AND i.estado = 'ACTIVO'
      AND i.id IS DISTINCT FROM p_inscripcion_id;

    IF v_inscriptos >= v_cupo THEN
        RAISE EXCEPTION 'Cupo máximo alcanzado para la actividad. No se puede inscribir al alumno.'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_private.verificar_cupo_bloqueando(INTEGER, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
-- La invoca el trigger con los privilegios de quien escribe en `inscripciones`.
GRANT EXECUTE ON FUNCTION app_private.verificar_cupo_bloqueando(INTEGER, UUID)
    TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verificar_cupo_actividad()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    -- Una baja no ocupa lugar, y un UPDATE que no cambia ni el estado ni la
    -- actividad de una fila ya ACTIVO no cambia la ocupación.
    IF NEW.estado IS DISTINCT FROM 'ACTIVO' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.estado = 'ACTIVO'
       AND OLD.actividad_id IS NOT DISTINCT FROM NEW.actividad_id THEN
        RETURN NEW;
    END IF;

    PERFORM app_private.verificar_cupo_bloqueando(NEW.actividad_id, NEW.id);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.verificar_cupo_actividad()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_verificar_cupo ON public.inscripciones;
CREATE TRIGGER trigger_verificar_cupo
    BEFORE INSERT OR UPDATE OF estado, actividad_id ON public.inscripciones
    FOR EACH ROW EXECUTE FUNCTION public.verificar_cupo_actividad();

-- ================================================================
-- 4. ENDURECIMIENTO DE calcular_porcentaje_asistencia
-- ================================================================
-- Misma lógica y mismo resultado; solo se fija el search_path (la función
-- quedaba expuesta a la resolución de nombres de quien la llama) y se limita
-- EXECUTE a sesiones autenticadas. Sigue siendo SECURITY INVOKER: la RLS de
-- `asistencias` rige quién ve qué.
CREATE OR REPLACE FUNCTION public.calcular_porcentaje_asistencia(p_estudiante_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_total     INTEGER;
    v_presentes INTEGER;
BEGIN
    SELECT pg_catalog.count(*)
    INTO v_total
    FROM public.asistencias a
    WHERE a.estudiante_id = p_estudiante_id;

    SELECT pg_catalog.count(*)
    INTO v_presentes
    FROM public.asistencias a
    WHERE a.estudiante_id = p_estudiante_id
      AND a.estado IN ('PRESENTE', 'JUSTIFICADO');

    IF v_total = 0 THEN
        RETURN 0;
    END IF;

    RETURN pg_catalog.round((v_presentes::NUMERIC / v_total) * 100, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_porcentaje_asistencia(UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_porcentaje_asistencia(UUID)
    TO authenticated, service_role;

-- ================================================================
-- 5. AUTORIZACIÓN COMÚN DE LAS FUNCIONES DE INSCRIPCIONES LEGADAS
-- ================================================================
-- Devuelve el id de perfil del actor. Lanza:
--   P5505  sin identidad autenticada
--   42501  rol sin competencia (DOCENTE, PERSONAL, sin perfil o cuenta bloqueada)
--   P6602  el alumno no está disponible para este actor (inexistente, ajeno o
--          no es estudiante). Un mismo mensaje para todos los casos.
CREATE OR REPLACE FUNCTION app_private.autorizar_inscripcion_legada(p_estudiante_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rol    TEXT;
    v_actor  UUID;
    v_permitido BOOLEAN;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_rol := app_private.rol_actual();
    v_actor := app_private.perfil_actual();

    -- `rol_actual` y `perfil_actual` solo devuelven datos para cuentas
    -- HABILITADAS: una cuenta bloqueada o sin perfil termina acá.
    IF v_actor IS NULL OR v_rol IS NULL OR v_rol NOT IN ('DIRECTOR', 'ESTUDIANTE', 'PADRE') THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Tu rol no puede gestionar inscripciones a actividades.';
    END IF;

    v_permitido := CASE v_rol
        WHEN 'DIRECTOR'   THEN TRUE
        WHEN 'ESTUDIANTE' THEN p_estudiante_id IS NOT DISTINCT FROM v_actor
        WHEN 'PADRE'      THEN p_estudiante_id IN (SELECT app_private.mis_hijos_ids())
        ELSE FALSE
    END;

    IF NOT COALESCE(v_permitido, FALSE) OR NOT EXISTS (
        SELECT 1
        FROM public.perfiles pe
        JOIN public.roles r ON r.id = pe.rol_id
        WHERE pe.id = p_estudiante_id AND r.nombre = 'ESTUDIANTE'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P6602', MESSAGE = 'El alumno solicitado no está disponible.';
    END IF;

    RETURN v_actor;
END;
$$;

-- ================================================================
-- 6. ALTA (Y REINSCRIPCIÓN)
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.inscribir_actividad_legada(
    p_estudiante_id UUID,
    p_actividad_id  INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actividad public.actividades;
    v_id        UUID;
BEGIN
    PERFORM app_private.autorizar_inscripcion_legada(p_estudiante_id);

    -- El bloqueo de la actividad se toma ANTES de mirar si ya hay una
    -- inscripción activa o de contar: lo que se lee queda estable hasta el
    -- final de la transacción. Dos altas de la última plaza se ordenan acá.
    SELECT a.* INTO v_actividad
    FROM public.actividades a
    WHERE a.id = p_actividad_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6603', MESSAGE = 'La actividad solicitada no existe.';
    END IF;

    -- La inscripción deportiva se hace por grupo (EPT-11/EPT-61): misma
    -- respuesta que da el trigger de 014 por la vía legada.
    IF v_actividad.tipo = 'DEPORTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5582',
            MESSAGE = 'La inscripción a deportes se realiza por grupo deportivo desde la sección Deportes.';
    END IF;

    IF NOT v_actividad.activo THEN
        RAISE EXCEPTION USING ERRCODE = 'P6604', MESSAGE = 'La actividad no está disponible para inscribirse.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.inscripciones i
        WHERE i.estudiante_id = p_estudiante_id
          AND i.actividad_id = p_actividad_id
          AND i.estado = 'ACTIVO'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Este alumno ya está inscripto en esta actividad.';
    END IF;

    -- Una fila BAJA anterior no se toca: la reinscripción es una fila nueva.
    -- El trigger de cupo vuelve a validar bajo el mismo bloqueo.
    INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado)
    VALUES (p_estudiante_id, p_actividad_id, 'ACTIVO')
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- ================================================================
-- 7. BAJA LÓGICA
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.dar_baja_inscripcion_legada(p_inscripcion_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inscripcion public.inscripciones;
    v_rol         TEXT;
BEGIN
    -- La competencia del rol se comprueba primero y por sí sola, de modo que
    -- una inscripción ajena y una inexistente produzcan el mismo error.
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;
    v_rol := app_private.rol_actual();
    IF v_rol IS NULL OR v_rol NOT IN ('DIRECTOR', 'ESTUDIANTE', 'PADRE') THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Tu rol no puede gestionar inscripciones a actividades.';
    END IF;

    SELECT i.* INTO v_inscripcion
    FROM public.inscripciones i
    WHERE i.id = p_inscripcion_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6602', MESSAGE = 'La inscripción solicitada no está disponible.';
    END IF;

    BEGIN
        PERFORM app_private.autorizar_inscripcion_legada(v_inscripcion.estudiante_id);
    EXCEPTION
        WHEN SQLSTATE 'P6602' THEN
            RAISE EXCEPTION USING ERRCODE = 'P6602', MESSAGE = 'La inscripción solicitada no está disponible.';
    END;

    IF v_inscripcion.estado <> 'ACTIVO' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6607', MESSAGE = 'La inscripción ya está dada de baja.';
    END IF;

    -- Las bajas de actividades DEPORTE las rechaza el trigger de 014 (P5582).
    UPDATE public.inscripciones
    SET estado = 'BAJA',
        fecha_baja = pg_catalog.now()
    WHERE id = v_inscripcion.id;

    RETURN v_inscripcion.id;
END;
$$;

-- ================================================================
-- 8. LECTURAS ACOTADAS
-- ================================================================
-- Inscripciones de UN alumno (propio, hijo vinculado o, para Dirección,
-- cualquiera). Por defecto solo las ACTIVO; con p_incluir_bajas también el
-- historial de bajas.
CREATE OR REPLACE FUNCTION app_private.listar_inscripciones_actividades_legadas(
    p_estudiante_id UUID,
    p_incluir_bajas BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id                UUID,
    estudiante_id     UUID,
    actividad_id      INTEGER,
    estado            TEXT,
    fecha_inscripcion TIMESTAMPTZ,
    fecha_baja        TIMESTAMPTZ,
    actividad_nombre  TEXT,
    actividad_tipo    TEXT,
    cupo_maximo       INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM app_private.autorizar_inscripcion_legada(p_estudiante_id);

    RETURN QUERY
    SELECT i.id,
           i.estudiante_id,
           i.actividad_id,
           i.estado::TEXT,
           i.fecha_inscripcion,
           i.fecha_baja,
           a.nombre::TEXT,
           a.tipo::TEXT,
           a.cupo_maximo
    FROM public.inscripciones i
    JOIN public.actividades a ON a.id = i.actividad_id
    WHERE i.estudiante_id = p_estudiante_id
      AND (COALESCE(p_incluir_bajas, FALSE) OR i.estado = 'ACTIVO')
    ORDER BY i.fecha_inscripcion DESC, i.id;
END;
$$;

-- Inscriptos ACTIVO de una actividad: solo Dirección. Devuelve identificadores;
-- los nombres los resuelve la propia pantalla con la lista de estudiantes que
-- Dirección ya consulta.
CREATE OR REPLACE FUNCTION app_private.listar_inscriptos_actividad_legada(p_actividad_id INTEGER)
RETURNS TABLE (
    inscripcion_id    UUID,
    estudiante_id     UUID,
    fecha_inscripcion TIMESTAMPTZ
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
    IF app_private.rol_actual() IS DISTINCT FROM 'DIRECTOR' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo Dirección puede consultar los inscriptos de una actividad.';
    END IF;

    RETURN QUERY
    SELECT i.id, i.estudiante_id, i.fecha_inscripcion
    FROM public.inscripciones i
    WHERE i.actividad_id = p_actividad_id
      AND i.estado = 'ACTIVO'
    ORDER BY i.fecha_inscripcion, i.id;
END;
$$;

-- Ocupación por actividad: solo conteos, ningún par alumno–actividad. La puede
-- ver cualquier cuenta habilitada, porque el cupo disponible es información
-- pública de la actividad.
CREATE OR REPLACE FUNCTION app_private.consultar_cupos_actividades_legadas()
RETURNS TABLE (
    actividad_id INTEGER,
    inscriptos   INTEGER
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
    IF app_private.rol_actual() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Tu cuenta no tiene acceso a esta información.';
    END IF;

    RETURN QUERY
    SELECT i.actividad_id, pg_catalog.count(*)::INTEGER
    FROM public.inscripciones i
    WHERE i.estado = 'ACTIVO'
    GROUP BY i.actividad_id;
END;
$$;

-- ================================================================
-- 9. PRIVILEGIOS DE LAS FUNCIONES PRIVADAS Y ENVOLTORIOS PÚBLICOS
-- ================================================================
REVOKE ALL ON FUNCTION app_private.autorizar_inscripcion_legada(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.inscribir_actividad_legada(UUID, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.dar_baja_inscripcion_legada(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_inscripciones_actividades_legadas(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_inscriptos_actividad_legada(INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_cupos_actividades_legadas()
    FROM PUBLIC, anon, authenticated, service_role;

-- `autorizar_inscripcion_legada` solo la llaman las funciones privadas (que son
-- SECURITY DEFINER del mismo propietario): no necesita EXECUTE para nadie más.
GRANT EXECUTE ON FUNCTION app_private.inscribir_actividad_legada(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.dar_baja_inscripcion_legada(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_inscripciones_actividades_legadas(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_inscriptos_actividad_legada(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_cupos_actividades_legadas() TO authenticated;

CREATE OR REPLACE FUNCTION public.inscribir_actividad_legada(p_estudiante_id UUID, p_actividad_id INTEGER)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.inscribir_actividad_legada(p_estudiante_id, p_actividad_id);
$$;

CREATE OR REPLACE FUNCTION public.dar_baja_inscripcion_legada(p_inscripcion_id UUID)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.dar_baja_inscripcion_legada(p_inscripcion_id);
$$;

CREATE OR REPLACE FUNCTION public.listar_inscripciones_actividades_legadas(
    p_estudiante_id UUID,
    p_incluir_bajas BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id                UUID,
    estudiante_id     UUID,
    actividad_id      INTEGER,
    estado            TEXT,
    fecha_inscripcion TIMESTAMPTZ,
    fecha_baja        TIMESTAMPTZ,
    actividad_nombre  TEXT,
    actividad_tipo    TEXT,
    cupo_maximo       INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_inscripciones_actividades_legadas(p_estudiante_id, p_incluir_bajas);
$$;

CREATE OR REPLACE FUNCTION public.listar_inscriptos_actividad_legada(p_actividad_id INTEGER)
RETURNS TABLE (
    inscripcion_id    UUID,
    estudiante_id     UUID,
    fecha_inscripcion TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_inscriptos_actividad_legada(p_actividad_id);
$$;

CREATE OR REPLACE FUNCTION public.consultar_cupos_actividades_legadas()
RETURNS TABLE (
    actividad_id INTEGER,
    inscriptos   INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consultar_cupos_actividades_legadas();
$$;

REVOKE ALL ON FUNCTION public.inscribir_actividad_legada(UUID, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.dar_baja_inscripcion_legada(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_inscripciones_actividades_legadas(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_inscriptos_actividad_legada(INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_cupos_actividades_legadas()
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.inscribir_actividad_legada(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dar_baja_inscripcion_legada(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_inscripciones_actividades_legadas(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_inscriptos_actividad_legada(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_cupos_actividades_legadas() TO authenticated;

-- ================================================================
-- 10. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion TEXT;
    v_antes    BIGINT;
    v_ahora    BIGINT;
BEGIN
    -- Ningún dato cambió.
    FOR v_relacion, v_antes IN SELECT c.relacion, c.cantidad FROM ept_066a_conteos c LOOP
        v_ahora := CASE v_relacion
            WHEN 'inscripciones'         THEN (SELECT pg_catalog.count(*) FROM public.inscripciones)
            WHEN 'inscripciones_activas' THEN (SELECT pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'ACTIVO')
            WHEN 'inscripciones_baja'    THEN (SELECT pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'BAJA')
            WHEN 'actividades'           THEN (SELECT pg_catalog.count(*) FROM public.actividades)
            WHEN 'asistencias'           THEN (SELECT pg_catalog.count(*) FROM public.asistencias)
            WHEN 'perfiles'              THEN (SELECT pg_catalog.count(*) FROM public.perfiles)
            WHEN 'padres_hijos'          THEN (SELECT pg_catalog.count(*) FROM public.padres_hijos)
        END;
        IF v_ahora IS DISTINCT FROM v_antes THEN
            RAISE EXCEPTION 'Autoverificación EPT-66: cambió el conteo de % (antes %, ahora %).',
                v_relacion, v_antes, v_ahora;
        END IF;
    END LOOP;

    -- Estructura.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
                   WHERE schemaname = 'public' AND indexname = 'idx_inscripciones_una_activa') THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: falta el índice único de la inscripción activa.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
               WHERE conrelid = 'public.inscripciones'::pg_catalog.regclass
                 AND conname = 'inscripciones_estudiante_id_actividad_id_key') THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: sigue la restricción única completa.';
    END IF;

    -- El trigger deportivo de 014 sigue y corre antes que el de cupo.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                   WHERE tgrelid = 'public.inscripciones'::pg_catalog.regclass
                     AND tgname = 'bloquear_inscripcion_deportiva_legada' AND NOT tgisinternal)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                   WHERE tgrelid = 'public.inscripciones'::pg_catalog.regclass
                     AND tgname = 'trigger_verificar_cupo' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: faltan los triggers de inscripciones.';
    END IF;
    IF 'bloquear_inscripcion_deportiva_legada' > 'trigger_verificar_cupo' THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: el orden alfabético de los triggers cambió.';
    END IF;

    -- Funciones: search_path fijo y privilegios.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid IN (
            'public.verificar_cupo_actividad()'::pg_catalog.regprocedure,
            'public.calcular_porcentaje_asistencia(uuid)'::pg_catalog.regprocedure,
            'public.inscribir_actividad_legada(uuid,integer)'::pg_catalog.regprocedure,
            'public.dar_baja_inscripcion_legada(uuid)'::pg_catalog.regprocedure,
            'public.listar_inscripciones_actividades_legadas(uuid,boolean)'::pg_catalog.regprocedure,
            'public.listar_inscriptos_actividad_legada(integer)'::pg_catalog.regprocedure,
            'public.consultar_cupos_actividades_legadas()'::pg_catalog.regprocedure,
            'app_private.inscribir_actividad_legada(uuid,integer)'::pg_catalog.regprocedure,
            'app_private.dar_baja_inscripcion_legada(uuid)'::pg_catalog.regprocedure,
            'app_private.autorizar_inscripcion_legada(uuid)'::pg_catalog.regprocedure,
            'app_private.verificar_cupo_bloqueando(integer,uuid)'::pg_catalog.regprocedure
        )
        AND NOT (p.proconfig @> ARRAY['search_path=""']::TEXT[])
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: una función no fija search_path.';
    END IF;

    IF pg_catalog.has_function_privilege('anon', 'public.calcular_porcentaje_asistencia(uuid)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.inscribir_actividad_legada(uuid,integer)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.dar_baja_inscripcion_legada(uuid)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.consultar_cupos_actividades_legadas()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', 'public.verificar_cupo_actividad()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.verificar_cupo_actividad()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', 'app_private.autorizar_inscripcion_legada(uuid)', 'EXECUTE')
    THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: un rol tiene EXECUTE de más.';
    END IF;

    IF NOT pg_catalog.has_function_privilege('authenticated', 'public.inscribir_actividad_legada(uuid,integer)', 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', 'public.calcular_porcentaje_asistencia(uuid)', 'EXECUTE')
    THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: authenticated no puede ejecutar las funciones esperadas.';
    END IF;

    -- Compatibilidad con la aplicación anterior: no se retiró ningún permiso.
    IF NOT pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'DELETE')
       OR NOT pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'INSERT')
       OR NOT pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'UPDATE') THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: la expansión no debe retirar permisos de inscripciones.';
    END IF;
END $$;
