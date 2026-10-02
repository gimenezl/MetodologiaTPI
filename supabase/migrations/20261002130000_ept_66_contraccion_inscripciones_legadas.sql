-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Inscripciones legadas: CONTRACCIÓN (EPT-66, 2 de 2)
-- ============================================================
-- Segunda y última migración de EPT-66 (decisión D1=A). Cierra lo que la
-- expansión (20261002120000) dejó abierto para que la aplicación anterior
-- siguiera funcionando durante el despliegue.
--
-- NO SE APLICA JUNTO CON LA EXPANSIÓN. Solo se aplica cuando la aplicación nueva
-- —que usa las funciones `*_legada` y ya no escribe ni lee `inscripciones` de
-- forma directa— está desplegada en producción y se verificó. Con la aplicación
-- anterior, esta migración rompe el autoservicio de talleres (a propósito).
--
-- QUÉ HACE
--
--   1. `inscripciones`: sin escritura directa para ningún rol de la aplicación.
--      Se retiran las ocho políticas (lectura global `USING (true)`, altas y bajas
--      de Staff, de Alumno y de Padre) y los privilegios INSERT, UPDATE, DELETE,
--      TRUNCATE, REFERENCES y TRIGGER. Todo alta, baja y reinscripción pasa por
--      las funciones de la expansión.
--   2. Lectura acotada: cada alumno ve solo lo suyo, el padre solo lo de sus hijos
--      actualmente vinculados y Dirección todo. DOCENTE y PERSONAL no ven
--      inscripciones de alumnos: no existe un contrato que defina «alumno a
--      cargo» (docs/evidence/EPT-9.md §18.2) y la lectura global de pares
--      alumno–actividad exponía a menores. Un anónimo no tiene ni el privilegio.
--      Los conteos de cupo siguen disponibles para todos mediante
--      `consultar_cupos_actividades_legadas()`, que no devuelve alumnos.
--   3. Sin DELETE físico, tampoco directo: un trigger rechaza el DELETE de una
--      fila para TODOS los roles, incluido el propietario (el borrado en cascada
--      que dispara la eliminación de un perfil o de una actividad no es un DELETE
--      de aplicación y se conserva), y rechaza TRUNCATE. La baja es lógica.
--   4. La fila histórica BAJA es inmutable, y de una fila ACTIVO solo puede
--      cambiar el estado (a BAJA): ni el alumno, ni la actividad, ni el
--      identificador, ni la fecha de inscripción. Una baja registra su fecha.
--      Reinscribirse crea una fila nueva (índice único parcial de la expansión).
--   5. Privilegios heredados de `galeria`, `menu_escolar` y `noticias`: sus
--      políticas RLS ya impedían escribir, pero los privilegios de tabla (incluido
--      TRUNCATE, que la RLS no alcanza) seguían abiertos para anon y authenticated.
--      Queda solo SELECT, que es lo que usan las páginas públicas.
--   6. Privilegios por defecto: las tablas, secuencias y funciones que cree en
--      `public` el rol que ejecuta las migraciones dejan de otorgarse
--      automáticamente a anon y authenticated. Cada migración debe conceder
--      explícitamente lo que necesita, como ya hacen las de EPT-55 en adelante.
--      El EXECUTE implícito de PUBLIC sobre funciones nuevas NO se retira acá:
--      no se puede acotar a un esquema y alcanzaría a las funciones de las
--      extensiones; sigue siendo obligatorio el `REVOKE … FROM PUBLIC` explícito
--      en cada función, como en todas las migraciones desde EPT-55. NO afecta a los objetos existentes: los INSERT
--      públicos deliberados de los formularios (solicitudes de inscripción,
--      postulaciones y opiniones pendientes) conservan sus privilegios. Los
--      privilegios por defecto del rol `supabase_admin` (objetos creados desde el
--      panel de Supabase) no son modificables desde una migración.
--
-- LO QUE NO TOCA
--   · La lógica deportiva de EPT-11/EPT-61 ni el trigger de cupo de la expansión.
--   · Las migraciones 001–027 ni la expansión.
--   · Ningún dato: la autoverificación comprueba que no cambió ningún conteo y
--     que las filas legadas siguen ahí.
--   · Las asistencias: la lectura y escritura de DOCENTE sobre cualquier menor
--     sigue pendiente de una decisión de Lucas (ver docs/evidence/EPT-66.md §7).
--
-- Reversión: Git no revierte PostgreSQL. Se compensa con una migración nueva que
-- vuelva a crear políticas y privilegios (no recomendado: reabre la lectura
-- global de menores). Ver docs/evidence/EPT-66/C-aplicacion-contraccion.md.
-- ============================================================

-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE REFERENCIA
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
                   WHERE schemaname = 'public' AND indexname = 'idx_inscripciones_una_activa')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'inscripciones' AND column_name = 'fecha_baja')
       OR pg_catalog.to_regprocedure('public.inscribir_actividad_legada(uuid,integer)') IS NULL
       OR pg_catalog.to_regprocedure('public.dar_baja_inscripcion_legada(uuid)') IS NULL
       OR pg_catalog.to_regprocedure('public.listar_inscripciones_actividades_legadas(uuid,boolean)') IS NULL
       OR pg_catalog.to_regprocedure('public.listar_inscriptos_actividad_legada(integer)') IS NULL
       OR pg_catalog.to_regprocedure('public.consultar_cupos_actividades_legadas()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.verificar_cupo_bloqueando(integer,uuid)') IS NULL
    THEN
        RAISE EXCEPTION 'Precondición EPT-66: falta la migración de expansión 20261002120000.';
    END IF;

    -- Si existe el ledger de migraciones, la expansión debe figurar como aplicada.
    IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261002120000')
    THEN
        -- La CLI registra esta migración después de ejecutarla, así que la
        -- anterior ya debe estar registrada cuando esta corre.
        RAISE EXCEPTION 'Precondición EPT-66: la expansión 20261002120000 no figura en el ledger.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_066b_conteos (relacion TEXT PRIMARY KEY, cantidad BIGINT NOT NULL) ON COMMIT DROP;
INSERT INTO ept_066b_conteos
SELECT 'inscripciones', pg_catalog.count(*) FROM public.inscripciones
UNION ALL SELECT 'inscripciones_activas', pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'ACTIVO'
UNION ALL SELECT 'inscripciones_baja', pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'BAJA'
UNION ALL SELECT 'actividades', pg_catalog.count(*) FROM public.actividades
UNION ALL SELECT 'asistencias', pg_catalog.count(*) FROM public.asistencias
UNION ALL SELECT 'perfiles', pg_catalog.count(*) FROM public.perfiles
UNION ALL SELECT 'padres_hijos', pg_catalog.count(*) FROM public.padres_hijos
UNION ALL SELECT 'galeria', pg_catalog.count(*) FROM public.galeria
UNION ALL SELECT 'menu_escolar', pg_catalog.count(*) FROM public.menu_escolar
UNION ALL SELECT 'noticias', pg_catalog.count(*) FROM public.noticias;

CREATE TEMPORARY TABLE ept_066b_huella ON COMMIT DROP AS
SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
           pg_catalog.concat_ws(',', i.id, i.estudiante_id, i.actividad_id, i.estado, i.fecha_inscripcion, i.fecha_baja),
           ';' ORDER BY i.id), '')) AS huella
FROM public.inscripciones i;

-- ================================================================
-- 2. POLÍTICAS Y PRIVILEGIOS DE `inscripciones`
-- ================================================================
DROP POLICY IF EXISTS "Usuarios autenticados consultan inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "Staff crea inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "Staff modifica inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "Staff elimina inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "Alumno crea su propia inscripcion" ON public.inscripciones;
DROP POLICY IF EXISTS "Alumno elimina su propia inscripcion" ON public.inscripciones;
DROP POLICY IF EXISTS "Padre inscribe a sus hijos" ON public.inscripciones;
DROP POLICY IF EXISTS "Padre da de baja a sus hijos" ON public.inscripciones;

CREATE POLICY "Alumno consulta sus inscripciones" ON public.inscripciones
    FOR SELECT TO authenticated
    USING (estudiante_id = (SELECT app_private.perfil_actual()));

CREATE POLICY "Padre consulta las inscripciones de sus hijos" ON public.inscripciones
    FOR SELECT TO authenticated
    USING (
        (SELECT app_private.rol_actual()) = 'PADRE'
        AND estudiante_id IN (SELECT app_private.mis_hijos_ids())
    );

CREATE POLICY "Dirección consulta las inscripciones" ON public.inscripciones
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');

REVOKE ALL ON public.inscripciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.inscripciones TO authenticated, service_role;

-- ================================================================
-- 3. SIN DELETE FÍSICO Y FILA BAJA INMUTABLE
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.impedir_borrado_inscripcion_legada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6608',
            MESSAGE = 'Las inscripciones no se vacían: se conservan como historia.';
    END IF;

    -- `pg_trigger_depth() > 1` es el borrado en cascada que dispara la eliminación
    -- de un perfil o de una actividad: no es un DELETE de la aplicación.
    IF pg_catalog.pg_trigger_depth() = 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6608',
            MESSAGE = 'Las inscripciones no se borran: se dan de baja y la fila se conserva como historia.';
    END IF;

    RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.proteger_inscripcion_legada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF OLD.estado = 'BAJA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6609',
            MESSAGE = 'Una inscripción dada de baja es histórica y no se modifica: para volver a inscribirse se crea una nueva.';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.estudiante_id IS DISTINCT FROM OLD.estudiante_id
       OR NEW.actividad_id IS DISTINCT FROM OLD.actividad_id
       OR NEW.fecha_inscripcion IS DISTINCT FROM OLD.fecha_inscripcion
    THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6609',
            MESSAGE = 'Un alumno, una actividad y la fecha de una inscripción no se cambian: se da de baja y se crea otra.';
    END IF;

    IF NEW.estado = 'BAJA' AND NEW.fecha_baja IS NULL THEN
        NEW.fecha_baja := pg_catalog.now();
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.impedir_borrado_inscripcion_legada()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.proteger_inscripcion_legada()
    FROM PUBLIC, anon, authenticated, service_role;

-- Los nombres ordenan estos triggers después de `bloquear_inscripcion_deportiva_legada`
-- (EPT-11, que se ejecuta primero para las actividades DEPORTE) y, el de
-- protección, antes de `trigger_verificar_cupo`.
DROP TRIGGER IF EXISTS impedir_borrado_inscripcion_legada ON public.inscripciones;
CREATE TRIGGER impedir_borrado_inscripcion_legada
    BEFORE DELETE ON public.inscripciones
    FOR EACH ROW EXECUTE FUNCTION app_private.impedir_borrado_inscripcion_legada();

DROP TRIGGER IF EXISTS impedir_vaciado_inscripciones_legadas ON public.inscripciones;
CREATE TRIGGER impedir_vaciado_inscripciones_legadas
    BEFORE TRUNCATE ON public.inscripciones
    FOR EACH STATEMENT EXECUTE FUNCTION app_private.impedir_borrado_inscripcion_legada();

DROP TRIGGER IF EXISTS proteger_inscripcion_legada ON public.inscripciones;
CREATE TRIGGER proteger_inscripcion_legada
    BEFORE UPDATE ON public.inscripciones
    FOR EACH ROW EXECUTE FUNCTION app_private.proteger_inscripcion_legada();

-- ================================================================
-- 4. PRIVILEGIOS HEREDADOS DE galeria, menu_escolar Y noticias
-- ================================================================
-- Sus políticas RLS solo dejan leer, pero los privilegios de tabla de 001
-- (todos para anon y authenticated, TRUNCATE incluido, que la RLS no alcanza)
-- seguían vigentes. Las páginas públicas solo leen.
REVOKE ALL ON public.galeria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.menu_escolar FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.noticias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.galeria TO anon, authenticated;
GRANT SELECT ON public.menu_escolar TO anon, authenticated;
GRANT SELECT ON public.noticias TO anon, authenticated;

-- ================================================================
-- 5. PRIVILEGIOS POR DEFECTO PARA OBJETOS FUTUROS
-- ================================================================
-- Hasta ahora toda tabla, secuencia o función nueva en `public` quedaba abierta a
-- anon y authenticated (y toda función, a PUBLIC) hasta que alguien la cerrara.
-- A partir de ahora el alta es cerrada para esos dos roles y cada migración
-- concede lo que necesita.
-- Solo cambia el futuro: los objetos existentes no se tocan.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ================================================================
-- 6. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion TEXT;
    v_antes    BIGINT;
    v_ahora    BIGINT;
    v_huella   TEXT;
    v_politicas TEXT[];
BEGIN
    -- Ningún dato cambió.
    FOR v_relacion, v_antes IN SELECT c.relacion, c.cantidad FROM ept_066b_conteos c LOOP
        v_ahora := CASE v_relacion
            WHEN 'inscripciones'         THEN (SELECT pg_catalog.count(*) FROM public.inscripciones)
            WHEN 'inscripciones_activas' THEN (SELECT pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'ACTIVO')
            WHEN 'inscripciones_baja'    THEN (SELECT pg_catalog.count(*) FROM public.inscripciones WHERE estado = 'BAJA')
            WHEN 'actividades'           THEN (SELECT pg_catalog.count(*) FROM public.actividades)
            WHEN 'asistencias'           THEN (SELECT pg_catalog.count(*) FROM public.asistencias)
            WHEN 'perfiles'              THEN (SELECT pg_catalog.count(*) FROM public.perfiles)
            WHEN 'padres_hijos'          THEN (SELECT pg_catalog.count(*) FROM public.padres_hijos)
            WHEN 'galeria'               THEN (SELECT pg_catalog.count(*) FROM public.galeria)
            WHEN 'menu_escolar'          THEN (SELECT pg_catalog.count(*) FROM public.menu_escolar)
            WHEN 'noticias'              THEN (SELECT pg_catalog.count(*) FROM public.noticias)
        END;
        IF v_ahora IS DISTINCT FROM v_antes THEN
            RAISE EXCEPTION 'Autoverificación EPT-66: cambió el conteo de % (antes %, ahora %).',
                v_relacion, v_antes, v_ahora;
        END IF;
    END LOOP;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws(',', i.id, i.estudiante_id, i.actividad_id, i.estado, i.fecha_inscripcion, i.fecha_baja),
               ';' ORDER BY i.id), ''))
    INTO v_huella FROM public.inscripciones i;
    IF v_huella IS DISTINCT FROM (SELECT h.huella FROM ept_066b_huella h) THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: cambió el contenido de public.inscripciones.';
    END IF;

    -- Políticas exactas: solo tres de lectura y la restrictiva de bloqueo.
    SELECT pg_catalog.array_agg(p.polname::TEXT ORDER BY p.polname)
    INTO v_politicas
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.inscripciones'::pg_catalog.regclass;
    IF v_politicas IS DISTINCT FROM ARRAY[
        'Alumno consulta sus inscripciones',
        'Bloqueo de acceso sin datos protegidos',
        'Dirección consulta las inscripciones',
        'Padre consulta las inscripciones de sus hijos'
    ] THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: las políticas de inscripciones son %', v_politicas;
    END IF;

    -- Privilegios de tabla: solo lectura, y solo para sesiones autenticadas.
    IF pg_catalog.has_table_privilege('anon', 'public.inscripciones', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.inscripciones', 'INSERT')
       OR pg_catalog.has_table_privilege('anon', 'public.inscripciones', 'DELETE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'DELETE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'TRUNCATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.inscripciones', 'DELETE')
       OR NOT pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', 'SELECT')
    THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: privilegios de public.inscripciones fuera de lo esperado.';
    END IF;

    -- Triggers presentes, habilitados y en el orden esperado.
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.inscripciones'::pg_catalog.regclass
          AND NOT t.tgisinternal AND t.tgenabled = 'O'
          AND t.tgname IN ('bloquear_inscripcion_deportiva_legada', 'impedir_borrado_inscripcion_legada',
                           'impedir_vaciado_inscripciones_legadas', 'proteger_inscripcion_legada',
                           'trigger_verificar_cupo')) <> 5 THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: faltan triggers de inscripciones o están deshabilitados.';
    END IF;

    -- Tablas públicas: solo lectura.
    IF pg_catalog.has_table_privilege('anon', 'public.galeria', 'INSERT')
       OR pg_catalog.has_table_privilege('anon', 'public.galeria', 'TRUNCATE')
       OR pg_catalog.has_table_privilege('anon', 'public.menu_escolar', 'DELETE')
       OR pg_catalog.has_table_privilege('anon', 'public.menu_escolar', 'TRUNCATE')
       OR pg_catalog.has_table_privilege('anon', 'public.noticias', 'UPDATE')
       OR pg_catalog.has_table_privilege('anon', 'public.noticias', 'TRUNCATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.noticias', 'TRUNCATE')
       OR NOT pg_catalog.has_table_privilege('anon', 'public.galeria', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('anon', 'public.menu_escolar', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('anon', 'public.noticias', 'SELECT')
    THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: privilegios de galeria, menu_escolar o noticias fuera de lo esperado.';
    END IF;

    -- Los INSERT públicos deliberados de los formularios siguen en pie.
    -- (`opiniones` lo concede por columna, así que se mira cualquier columna.)
    IF NOT pg_catalog.has_any_column_privilege('anon', 'public.solicitudes_inscripcion', 'INSERT')
       OR NOT pg_catalog.has_any_column_privilege('anon', 'public.postulaciones', 'INSERT')
       OR NOT pg_catalog.has_any_column_privilege('anon', 'public.opiniones', 'INSERT')
    THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: se perdió un INSERT público deliberado de los formularios.';
    END IF;

    -- Privilegios por defecto: ya no hay entradas para anon ni authenticated.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_default_acl d
        CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
        WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
          AND d.defaclnamespace = 'public'::pg_catalog.regnamespace
          AND a.grantee IN ('anon'::pg_catalog.regrole, 'authenticated'::pg_catalog.regrole)
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-66: siguen privilegios por defecto para anon o authenticated.';
    END IF;
END $$;
