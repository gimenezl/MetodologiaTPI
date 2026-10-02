-- ============================================================
-- EDUCAR PARA TRANSFORMAR — EPT-66, unidad D
-- Asistencias docentes por vínculo vigente (migración 30)
-- ============================================================
--
-- DECISIÓN APROBADA (D2)
--   Un DOCENTE puede consultar y registrar la asistencia de un alumno SOLO si
--   existe al menos uno de estos dos vínculos VIGENTES:
--     (a) académico: matrícula vigente del alumno (fecha_cierre IS NULL) en un
--         curso donde ese docente tiene una asignación ACTIVA (materias_cursos
--         .profesor_id = docente, activo) de una materia CURRICULAR ACTIVA;
--     (b) deportivo: inscripción deportiva ACTIVA del alumno en un grupo ACTIVO
--         cuyo profesor_id es ese docente.
--   Si se revoca uno y el otro sigue vigente, el acceso se mantiene. Revocados
--   ambos, no hay acceso de lectura ni de escritura. No se agrega ninguna otra
--   exigencia (nivel, deporte, ficha de profesor, legajo…).
--
-- QUÉ CAMBIA
--   · Las tres políticas «Staff» globales de `asistencias` (DIRECTOR y DOCENTE
--     veían y escribían TODO) se reemplazan: Dirección conserva el acceso
--     global; el DOCENTE queda acotado a sus alumnos vinculados. Las políticas
--     del alumno propio y del padre vinculado, y la política RESTRICTIVE de
--     bloqueo (EPT-59), no se tocan.
--   · UN solo predicado, privado y compartido: `app_private.vinculos_docente_
--     alumno(docente, alumno)`. Lo usan la política de lectura, la guarda de
--     escritura (política INSERT/UPDATE y función de registro) y el listado de
--     gestión. Nadie más lo reescribe.
--   · El registrante (`docente_id`) se deriva de la sesión: la política de alta
--     exige `docente_id = perfil de la sesión` y la función de registro no lo
--     recibe. Un trigger impide reasignarlo y mover una asistencia de alumno o
--     de fecha; `authenticated` además solo conserva UPDATE de la columna
--     `estado`.
--   · `registrar_asistencia(alumno, fecha, estado)` (RPC): alta, o corrección del
--     estado si ya existe la asistencia de ese alumno y fecha. Nunca cambia al
--     registrante original. Una modificación que no alcanza ninguna fila ya no
--     parece éxito: la función responde un error explícito.
--   · `listar_estudiantes_para_gestion()`: dejaba a DOCENTE ver a TODOS los
--     alumnos. Ahora un DOCENTE recibe solo sus alumnos vinculados (mismas
--     cuatro columnas); Dirección sigue viendo a todos.
--
-- BLOQUEOS (concurrencia revocación ↔ registro)
--   La guarda `puede_registrar_asistencia_de` toma `FOR SHARE` sobre las filas
--   que sostienen cada vínculo —inscripción deportiva, grupo, matrícula,
--   materia y asignación, en ese orden— y VUELVE a evaluar el predicado con los
--   bloqueos tomados. Una revocación es un UPDATE de alguna de esas filas
--   (FOR NO KEY UPDATE), que entra en conflicto con FOR SHARE:
--     · revocación primero → el registro espera, relee el estado confirmado y se
--       deniega (P6610);
--     · registro primero → la revocación espera a que el registro confirme, que
--       queda atribuido al actor real; todo registro posterior ya se deniega.
--   El orden elegido empieza por la fila de inscripción y no toma `alumnos`: es
--   el orden fila → grupo que ya siguen la baja propia y la administrativa
--   (EPT-61/62), de modo que no se agregan ciclos de espera. Ninguna operación
--   existente actualiza a la vez dos tablas de vínculo.
--
-- CÓDIGOS SQLSTATE
--   P5505  se requiere una identidad autenticada            (reutilizado)
--   42501  rol sin competencia, cuenta bloqueada o sin perfil (reutilizado)
--   P6610  el alumno no está disponible para este actor (inexistente, no es
--          estudiante o sin vínculo vigente). Un mismo mensaje para todos: no
--          revela si el alumno existe.
--   P6611  datos inválidos (alumno, fecha o estado)
--   P6612  se intentó modificar la identidad de una asistencia (trigger)
--
-- LO QUE NO TOCA
--   · Ningún dato: la autoverificación final comprueba que el conteo de
--     `asistencias` no cambió.
--   · Las migraciones 001–029 ni la lógica académica o deportiva.
--   · `calcular_porcentaje_asistencia` (SECURITY INVOKER): conserva la RLS, así
--     que un docente solo calcula el porcentaje de sus alumnos vinculados.
--
-- Reversión: Git no revierte PostgreSQL. Se compensa con una migración nueva
-- que reponga las políticas «Staff» globales (no recomendado: reabre la lectura
-- y la escritura de DOCENTE sobre la asistencia de cualquier menor).
-- ============================================================

-- ================================================================
-- 1. PRECONDICIONES Y CONTEO DE REFERENCIA
-- ================================================================
CREATE TEMPORARY TABLE ept66d_conteos_previos ON COMMIT DROP AS
SELECT pg_catalog.count(*) AS asistencias FROM public.asistencias;

DO $$
BEGIN
    IF pg_catalog.to_regclass('public.matriculas') IS NULL
       OR pg_catalog.to_regclass('public.materias_cursos') IS NULL
       OR pg_catalog.to_regclass('public.actividades') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_deportivas') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.listar_estudiantes_para_gestion()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                      WHERE schemaname = 'public' AND tablename = 'asistencias'
                        AND policyname = 'Staff consulta asistencias') THEN
        RAISE EXCEPTION 'Migración 30: faltan objetos de las migraciones anteriores o ya se aplicó. Se esperaba el esquema 29.';
    END IF;
END $$;


-- ================================================================
-- 2. EL PREDICADO ÚNICO DE VÍNCULO VIGENTE
-- ================================================================
-- Una fila por cada vínculo vigente entre el docente y el alumno (o con TODOS
-- sus alumnos cuando `p_alumno_id` es NULL). Devuelve los identificadores de las
-- filas que sostienen el vínculo: la guarda de escritura los bloquea.
-- Uso interno: ningún cliente lo ejecuta (SECURITY DEFINER para leer sin RLS).
CREATE OR REPLACE FUNCTION app_private.vinculos_docente_alumno(
    p_docente_id UUID,
    p_alumno_id  UUID DEFAULT NULL
)
RETURNS TABLE (
    alumno_id      UUID,
    origen         TEXT,
    matricula_id   UUID,
    asignacion_id  UUID,
    materia_id     INTEGER,
    inscripcion_id UUID,
    grupo_id       UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH docente AS (
        SELECT p.id
        FROM public.perfiles p
        JOIN public.roles r ON r.id = p.rol_id
        WHERE p.id = p_docente_id
          AND r.nombre = 'DOCENTE'
          AND p.estado_acceso = 'HABILITADO'
    )
    -- (a) académico
    SELECT m.alumno_id, 'ACADEMICO'::TEXT, m.id, mc.id, mc.materia_id, NULL::UUID, NULL::UUID
    FROM docente d
    JOIN public.materias_cursos mc ON mc.profesor_id = d.id AND mc.activo
    JOIN public.actividades a ON a.id = mc.materia_id AND a.tipo = 'CURRICULAR' AND a.activo
    JOIN public.matriculas m ON m.curso_id = mc.curso_id AND m.fecha_cierre IS NULL
    WHERE p_alumno_id IS NULL OR m.alumno_id = p_alumno_id
    UNION ALL
    -- (b) deportivo
    SELECT i.alumno_id, 'DEPORTIVO'::TEXT, NULL::UUID, NULL::UUID, NULL::INTEGER, i.id, g.id
    FROM docente d
    JOIN public.grupos_deportivos g ON g.profesor_id = d.id AND g.activo
    JOIN public.inscripciones_deportivas i ON i.grupo_id = g.id AND i.estado = 'ACTIVA'
    WHERE p_alumno_id IS NULL OR i.alumno_id = p_alumno_id;
$$;

-- Alumnos con vínculo vigente con el docente de la sesión. Vacío para cualquier
-- otro rol y para una cuenta bloqueada o sin perfil (`perfil_actual` es NULL).
-- Es lo que evalúan la política de lectura y el listado de gestión.
CREATE OR REPLACE FUNCTION app_private.alumnos_vinculados_al_docente_actual()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT DISTINCT v.alumno_id
    FROM app_private.vinculos_docente_alumno((SELECT app_private.perfil_actual()), NULL) v
    WHERE (SELECT app_private.rol_actual()) = 'DOCENTE';
$$;


-- ================================================================
-- 3. GUARDA DE ESCRITURA CON BLOQUEO Y REVALIDACIÓN
-- ================================================================
-- ¿Puede la sesión actual registrar o corregir la asistencia de este alumno?
--   · DIRECTOR habilitado: sí, para cualquier perfil ESTUDIANTE (acceso global).
--   · DOCENTE habilitado: solo con un vínculo vigente que quedó FIRME: sus filas
--     están bloqueadas FOR SHARE y el predicado se evaluó DESPUÉS de bloquear.
--   · Cualquier otro caso (PERSONAL, ESTUDIANTE, PADRE, sin perfil, bloqueado,
--     sin sesión): false. Nunca lanza por falta de permisos: la política y la
--     función de registro deciden el SQLSTATE.
-- VOLATILE a propósito: toma bloqueos de fila. La usan la política de alta, la
-- de corrección y `registrar_asistencia`.
CREATE OR REPLACE FUNCTION app_private.puede_registrar_asistencia_de(p_estudiante_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rol    TEXT;
    v_actor  UUID;
    v_firme  BOOLEAN;
    v_i      UUID[];
    v_g      UUID[];
    v_m      UUID[];
    v_x      INTEGER[];
    v_a      UUID[];
    -- Filas ya bloqueadas en esta llamada.
    b_i      UUID[] := ARRAY[]::UUID[];
    b_g      UUID[] := ARRAY[]::UUID[];
    b_m      UUID[] := ARRAY[]::UUID[];
    b_x      INTEGER[] := ARRAY[]::INTEGER[];
    b_a      UUID[] := ARRAY[]::UUID[];
BEGIN
    IF p_estudiante_id IS NULL THEN
        RETURN FALSE;
    END IF;

    v_rol := app_private.rol_actual();
    v_actor := app_private.perfil_actual();
    IF v_rol IS NULL OR v_actor IS NULL THEN
        RETURN FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.perfiles pe
        JOIN public.roles r ON r.id = pe.rol_id
        WHERE pe.id = p_estudiante_id AND r.nombre = 'ESTUDIANTE'
    ) THEN
        RETURN FALSE;
    END IF;

    IF v_rol = 'DIRECTOR' THEN
        RETURN TRUE;
    END IF;
    IF v_rol <> 'DOCENTE' THEN
        RETURN FALSE;
    END IF;

    -- Hasta cuatro vueltas: cada una bloquea lo que el predicado devuelve y lo
    -- revalida. Más de una vuelta solo ocurre si, mientras esperábamos un
    -- bloqueo, aparecieron vínculos nuevos; si no converge, se deniega.
    FOR v_vuelta IN 1..4 LOOP
        SELECT
            COALESCE(pg_catalog.array_agg(DISTINCT v.inscripcion_id) FILTER (WHERE v.inscripcion_id IS NOT NULL), ARRAY[]::UUID[]),
            COALESCE(pg_catalog.array_agg(DISTINCT v.grupo_id)       FILTER (WHERE v.grupo_id IS NOT NULL),       ARRAY[]::UUID[]),
            COALESCE(pg_catalog.array_agg(DISTINCT v.matricula_id)   FILTER (WHERE v.matricula_id IS NOT NULL),   ARRAY[]::UUID[]),
            COALESCE(pg_catalog.array_agg(DISTINCT v.materia_id)     FILTER (WHERE v.materia_id IS NOT NULL),     ARRAY[]::INTEGER[]),
            COALESCE(pg_catalog.array_agg(DISTINCT v.asignacion_id)  FILTER (WHERE v.asignacion_id IS NOT NULL),  ARRAY[]::UUID[])
        INTO v_i, v_g, v_m, v_x, v_a
        FROM app_private.vinculos_docente_alumno(v_actor, p_estudiante_id) v;

        IF pg_catalog.cardinality(v_i) + pg_catalog.cardinality(v_m) = 0 THEN
            RETURN FALSE;
        END IF;

        -- Orden de bloqueo: inscripción → grupo → matrícula → materia → asignación.
        PERFORM 1 FROM public.inscripciones_deportivas t
        WHERE t.id = ANY (v_i) AND NOT (t.id = ANY (b_i)) ORDER BY t.id FOR SHARE;
        PERFORM 1 FROM public.grupos_deportivos t
        WHERE t.id = ANY (v_g) AND NOT (t.id = ANY (b_g)) ORDER BY t.id FOR SHARE;
        PERFORM 1 FROM public.matriculas t
        WHERE t.id = ANY (v_m) AND NOT (t.id = ANY (b_m)) ORDER BY t.id FOR SHARE;
        PERFORM 1 FROM public.actividades t
        WHERE t.id = ANY (v_x) AND NOT (t.id = ANY (b_x)) ORDER BY t.id FOR SHARE;
        PERFORM 1 FROM public.materias_cursos t
        WHERE t.id = ANY (v_a) AND NOT (t.id = ANY (b_a)) ORDER BY t.id FOR SHARE;

        b_i := b_i || v_i;
        b_g := b_g || v_g;
        b_m := b_m || v_m;
        b_x := b_x || v_x;
        b_a := b_a || v_a;

        -- Revalidación con los bloqueos tomados: ¿queda algún vínculo cuyas
        -- filas están TODAS bloqueadas por nosotros? Entonces es firme.
        SELECT EXISTS (
            SELECT 1
            FROM app_private.vinculos_docente_alumno(v_actor, p_estudiante_id) v
            WHERE (v.origen = 'DEPORTIVO' AND v.inscripcion_id = ANY (b_i) AND v.grupo_id = ANY (b_g))
               OR (v.origen = 'ACADEMICO' AND v.matricula_id = ANY (b_m)
                   AND v.materia_id = ANY (b_x) AND v.asignacion_id = ANY (b_a))
        ) INTO v_firme;

        IF v_firme THEN
            RETURN TRUE;
        END IF;
    END LOOP;

    RETURN FALSE;
END;
$$;


-- ================================================================
-- 4. REGISTRO DE ASISTENCIA (ALTA O CORRECCIÓN) CON REGISTRANTE DE LA SESIÓN
-- ================================================================
-- Devuelve la fila resultante y `resultado`: CREADA, ACTUALIZADA (cambió el
-- estado de una asistencia existente) o SIN_CAMBIOS (ya tenía ese estado). El
-- registrante original NUNCA se reemplaza: una corrección de otro docente o de
-- Dirección cambia el estado, no la autoría de la primera carga.
CREATE OR REPLACE FUNCTION app_private.registrar_asistencia(
    p_estudiante_id UUID,
    p_fecha         DATE,
    p_estado        TEXT
)
RETURNS TABLE (
    id            UUID,
    estudiante_id UUID,
    fecha         DATE,
    estado        TEXT,
    docente_id    UUID,
    resultado     TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_rol       TEXT;
    v_actor     UUID;
    v_id        UUID;
    v_estado    TEXT;
    v_resultado TEXT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_rol := app_private.rol_actual();
    v_actor := app_private.perfil_actual();
    IF v_actor IS NULL OR v_rol IS NULL OR v_rol NOT IN ('DIRECTOR', 'DOCENTE') THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección o un docente pueden registrar asistencias.';
    END IF;

    IF p_estudiante_id IS NULL OR p_fecha IS NULL
       OR p_estado IS NULL OR p_estado NOT IN ('PRESENTE', 'AUSENTE', 'JUSTIFICADO') THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6611',
            MESSAGE = 'Indicá el alumno, la fecha y un estado válido (presente, ausente o justificado).';
    END IF;

    -- Mismo mensaje y código para alumno inexistente, que no es estudiante o sin
    -- vínculo vigente: no se revela cuál de los casos es.
    IF NOT app_private.puede_registrar_asistencia_de(p_estudiante_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6610',
            MESSAGE = 'El alumno no está disponible para registrar su asistencia.';
    END IF;

    LOOP
        -- La fila existente (de otro registrante, por ejemplo) se bloquea: dos
        -- docentes que cargan al mismo alumno y día se ordenan acá.
        SELECT a.id, a.estado INTO v_id, v_estado
        FROM public.asistencias a
        WHERE a.estudiante_id = p_estudiante_id AND a.fecha = p_fecha
        FOR NO KEY UPDATE;

        IF FOUND THEN
            IF v_estado = p_estado THEN
                v_resultado := 'SIN_CAMBIOS';
            ELSE
                UPDATE public.asistencias a SET estado = p_estado WHERE a.id = v_id;
                v_resultado := 'ACTUALIZADA';
            END IF;
            EXIT;
        END IF;

        INSERT INTO public.asistencias (estudiante_id, fecha, estado, docente_id)
        VALUES (p_estudiante_id, p_fecha, p_estado, v_actor)
        ON CONFLICT (estudiante_id, fecha) DO NOTHING
        RETURNING public.asistencias.id INTO v_id;

        IF FOUND THEN
            v_resultado := 'CREADA';
            EXIT;
        END IF;
        -- Otra transacción la creó entre la lectura y el alta: se vuelve a leer.
    END LOOP;

    RETURN QUERY
    SELECT a.id, a.estudiante_id, a.fecha, a.estado::TEXT, a.docente_id, v_resultado
    FROM public.asistencias a
    WHERE a.id = v_id;
END;
$$;


-- ================================================================
-- 5. LISTADO DE GESTIÓN ACOTADO
-- ================================================================
-- Misma firma, mismas cuatro columnas y mismos ACL (CREATE OR REPLACE). Cambia
-- el conjunto: Dirección ve a todos los alumnos; un DOCENTE, solo a los que
-- tienen vínculo vigente con él (el mismo predicado que la lectura).
CREATE OR REPLACE FUNCTION app_private.listar_estudiantes_para_gestion()
RETURNS TABLE (
    id         UUID,
    nombre     TEXT,
    apellido   TEXT,
    legajo_nro TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rol TEXT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_rol := app_private.rol_actual();
    IF v_rol IS DISTINCT FROM 'DIRECTOR' AND v_rol IS DISTINCT FROM 'DOCENTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección o un docente pueden consultar el listado de estudiantes.';
    END IF;

    RETURN QUERY
    SELECT p.id, p.nombre::TEXT, p.apellido::TEXT, p.legajo_nro::TEXT
    FROM public.perfiles p
    JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'ESTUDIANTE'
      AND (v_rol = 'DIRECTOR'
           OR p.id IN (SELECT app_private.alumnos_vinculados_al_docente_actual()))
    ORDER BY p.apellido, p.nombre, p.id;
END;
$$;


-- ================================================================
-- 6. IDENTIDAD INMUTABLE DE UNA ASISTENCIA
-- ================================================================
-- El alumno, la fecha y el registrante no se reasignan. El registrante solo
-- puede quedar en NULL: es lo que hace `ON DELETE SET NULL` de la clave foránea
-- cuando se elimina el perfil que registró.
CREATE OR REPLACE FUNCTION app_private.proteger_atributos_asistencia()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.estudiante_id IS DISTINCT FROM OLD.estudiante_id
       OR NEW.fecha IS DISTINCT FROM OLD.fecha
       OR NEW.id IS DISTINCT FROM OLD.id
       OR (NEW.docente_id IS DISTINCT FROM OLD.docente_id AND NEW.docente_id IS NOT NULL) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6612',
            MESSAGE = 'El alumno, la fecha y el registrante de una asistencia no se pueden modificar.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proteger_atributos_asistencia ON public.asistencias;
CREATE TRIGGER proteger_atributos_asistencia
    BEFORE UPDATE ON public.asistencias
    FOR EACH ROW EXECUTE FUNCTION app_private.proteger_atributos_asistencia();


-- ================================================================
-- 7. POLÍTICAS Y PRIVILEGIOS DE `asistencias`
-- ================================================================
DROP POLICY "Staff consulta asistencias" ON public.asistencias;
DROP POLICY "Staff registra asistencias" ON public.asistencias;
DROP POLICY "Staff modifica asistencias" ON public.asistencias;

CREATE POLICY "Dirección consulta asistencias" ON public.asistencias
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');

CREATE POLICY "Docentes consultan asistencias de sus alumnos" ON public.asistencias
    FOR SELECT TO authenticated
    USING (
        (SELECT app_private.rol_actual()) = 'DOCENTE'
        AND estudiante_id IN (SELECT app_private.alumnos_vinculados_al_docente_actual())
    );

-- El alta exige el registrante real y la guarda (que bloquea y revalida).
CREATE POLICY "Registro de asistencias con vínculo vigente" ON public.asistencias
    FOR INSERT TO authenticated
    WITH CHECK (
        docente_id = (SELECT app_private.perfil_actual())
        AND app_private.puede_registrar_asistencia_de(estudiante_id)
    );

-- La corrección toca solo `estado` (privilegio de columna y trigger). Una fila
-- sin vínculo no es visible para el UPDATE: afecta 0 filas.
CREATE POLICY "Corrección de asistencias con vínculo vigente" ON public.asistencias
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_private.rol_actual()) = 'DIRECTOR'
        OR ((SELECT app_private.rol_actual()) = 'DOCENTE'
            AND estudiante_id IN (SELECT app_private.alumnos_vinculados_al_docente_actual()))
    )
    WITH CHECK (app_private.puede_registrar_asistencia_de(estudiante_id));

REVOKE UPDATE ON public.asistencias FROM authenticated;
GRANT UPDATE (estado) ON public.asistencias TO authenticated;


-- ================================================================
-- 8. ENVOLTORIO PÚBLICO Y PRIVILEGIOS DE EJECUCIÓN
-- ================================================================
CREATE OR REPLACE FUNCTION public.registrar_asistencia(
    p_estudiante_id UUID,
    p_fecha         DATE,
    p_estado        TEXT
)
RETURNS TABLE (
    id            UUID,
    estudiante_id UUID,
    fecha         DATE,
    estado        TEXT,
    docente_id    UUID,
    resultado     TEXT
)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.registrar_asistencia(p_estudiante_id, p_fecha, p_estado);
$$;

REVOKE ALL ON FUNCTION app_private.vinculos_docente_alumno(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.alumnos_vinculados_al_docente_actual()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.puede_registrar_asistencia_de(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.registrar_asistencia(UUID, DATE, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.proteger_atributos_asistencia()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.registrar_asistencia(UUID, DATE, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

-- Los evalúa la sesión `authenticated` (políticas y envoltorio INVOKER).
GRANT EXECUTE ON FUNCTION app_private.alumnos_vinculados_al_docente_actual() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.puede_registrar_asistencia_de(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.registrar_asistencia(UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_asistencia(UUID, DATE, TEXT) TO authenticated;

COMMENT ON FUNCTION app_private.vinculos_docente_alumno(UUID, UUID) IS
    'Predicado único de vínculo vigente docente-alumno (EPT-66 D): matrícula vigente + asignación activa de materia CURRICULAR activa, o inscripción deportiva ACTIVA en grupo ACTIVO del docente. Uso interno.';
COMMENT ON FUNCTION app_private.puede_registrar_asistencia_de(UUID) IS
    'Guarda de escritura de asistencias: Dirección global; DOCENTE solo con vínculo firme (filas bloqueadas FOR SHARE y predicado revalidado).';
COMMENT ON FUNCTION public.registrar_asistencia(UUID, DATE, TEXT) IS
    'Alta o corrección de estado de una asistencia. El registrante se deriva de la sesión; nunca se recibe.';


-- ================================================================
-- 9. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_antes   BIGINT;
    v_despues BIGINT;
BEGIN
    SELECT asistencias INTO v_antes FROM ept66d_conteos_previos;
    SELECT pg_catalog.count(*) INTO v_despues FROM public.asistencias;
    IF v_antes IS DISTINCT FROM v_despues THEN
        RAISE EXCEPTION 'Migración 30: el conteo de asistencias cambió (% → %).', v_antes, v_despues;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
               WHERE schemaname = 'public' AND tablename = 'asistencias' AND policyname LIKE 'Staff%') THEN
        RAISE EXCEPTION 'Migración 30: subsiste una política «Staff» global sobre asistencias.';
    END IF;

    IF pg_catalog.has_function_privilege('anon', 'public.registrar_asistencia(uuid,date,text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'app_private.puede_registrar_asistencia_de(uuid)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', 'app_private.vinculos_docente_alumno(uuid,uuid)', 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', 'public.registrar_asistencia(uuid,date,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Migración 30: privilegios de ejecución inesperados.';
    END IF;

    IF pg_catalog.has_column_privilege('authenticated', 'public.asistencias', 'docente_id', 'UPDATE')
       OR NOT pg_catalog.has_column_privilege('authenticated', 'public.asistencias', 'estado', 'UPDATE') THEN
        RAISE EXCEPTION 'Migración 30: el UPDATE de asistencias no quedó limitado a la columna estado.';
    END IF;
END $$;
