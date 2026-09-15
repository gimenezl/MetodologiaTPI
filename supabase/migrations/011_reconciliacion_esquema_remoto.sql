-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Reconciliación del esquema remoto
-- ============================================================
--
-- Esta migración incorpora al historial canónico dos cambios funcionales que
-- existen en producción pero no estaban representados por 001–010:
--
--   * la moderación de testimonios mediante `opiniones.aprobado`;
--   * la relación muchos-a-muchos `padres_hijos`.
--
-- Además elimina políticas y privilegios amplios observados en producción. Es
-- deliberadamente compatible con ambos puntos de partida comprobados:
--
--   a) una base limpia reconstruida con 001–010;
--   b) el esquema remoto histórico, después de aplicar 003–010.
--
-- No borra ni combina datos. En particular, los nombres repetidos de
-- `actividades` se conservan: sin una regla funcional que identifique cuál fila
-- representa a cuál actividad, fusionarlos sería pérdida semántica. EPT-56
-- deberá resolver los duplicados curriculares antes de imponer su unicidad.

-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE PRESERVACIÓN
-- ================================================================
DO $$
DECLARE
    v_tabla TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY[
        'roles', 'perfiles', 'niveles', 'actividades', 'inscripciones',
        'asistencias', 'solicitudes_inscripcion', 'opiniones', 'postulaciones'
    ] LOOP
        IF pg_catalog.to_regclass('public.' || v_tabla) IS NULL THEN
            RAISE EXCEPTION
                'Reconciliación 011: falta public.%; la base no corresponde a 001–010.',
                v_tabla;
        END IF;
    END LOOP;

    IF pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
    THEN
        RAISE EXCEPTION
            'Reconciliación 011: faltan las funciones de identidad de 005/008.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'opiniones'
          AND column_name = 'aprobado'
          AND (
              data_type <> 'boolean'
              OR is_nullable <> 'NO'
          )
    ) THEN
        RAISE EXCEPTION
            'Reconciliación 011: opiniones.aprobado existe con un contrato incompatible.';
    END IF;

    IF pg_catalog.to_regclass('public.padres_hijos') IS NOT NULL
       AND EXISTS (
           SELECT esperado.columna
           FROM (VALUES
               ('padre_id', 'uuid', 'NO'),
               ('hijo_id', 'uuid', 'NO'),
               ('fecha_creacion', 'timestamp with time zone', 'NO')
           ) AS esperado(columna, tipo, nulable)
           LEFT JOIN information_schema.columns c
             ON c.table_schema = 'public'
            AND c.table_name = 'padres_hijos'
            AND c.column_name = esperado.columna
           WHERE c.column_name IS NULL
              OR c.data_type <> esperado.tipo
              OR c.is_nullable <> esperado.nulable
       )
    THEN
        RAISE EXCEPTION
            'Reconciliación 011: public.padres_hijos existe con columnas incompatibles.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_011_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_011_conteos_iniciales (relacion, cantidad)
VALUES
    ('actividades', (SELECT COUNT(*) FROM public.actividades)),
    ('opiniones', (SELECT COUNT(*) FROM public.opiniones)),
    ('perfiles', (SELECT COUNT(*) FROM public.perfiles)),
    ('inscripciones', (SELECT COUNT(*) FROM public.inscripciones)),
    ('asistencias', (SELECT COUNT(*) FROM public.asistencias));

DO $$
DECLARE
    v_cantidad BIGINT := 0;
BEGIN
    IF pg_catalog.to_regclass('public.padres_hijos') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM public.padres_hijos' INTO v_cantidad;
    END IF;

    INSERT INTO ept_011_conteos_iniciales (relacion, cantidad)
    VALUES ('padres_hijos', v_cantidad);
END $$;

-- ================================================================
-- 2. OBJETOS FUNCIONALES RECUPERADOS
-- ================================================================
-- Al agregar la columna por primera vez se aprueban únicamente las opiniones
-- ya existentes. Si la columna ya existe, sus estados se conservan sin tocar:
-- los `false` pueden ser testimonios pendientes genuinos de producción.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'opiniones'
          AND column_name = 'aprobado'
    ) THEN
        ALTER TABLE public.opiniones
            ADD COLUMN aprobado BOOLEAN NOT NULL DEFAULT FALSE;
        UPDATE public.opiniones SET aprobado = TRUE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.padres_hijos (
    padre_id UUID NOT NULL,
    hijo_id UUID NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT padres_hijos_pkey PRIMARY KEY (padre_id, hijo_id),
    CONSTRAINT padres_hijos_padre_id_fkey
        FOREIGN KEY (padre_id) REFERENCES public.perfiles(id) ON DELETE CASCADE,
    CONSTRAINT padres_hijos_hijo_id_fkey
        FOREIGN KEY (hijo_id) REFERENCES public.perfiles(id) ON DELETE CASCADE,
    CONSTRAINT padres_hijos_distintos CHECK (padre_id <> hijo_id)
);

-- Una tabla histórica ya existente puede no tener todos los constraints. Se
-- agregan solo los que faltan; cualquier dato incompatible hace abortar la
-- migración en lugar de ser borrado o corregido silenciosamente.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.padres_hijos'::regclass
          AND contype = 'p'
          AND conkey = ARRAY[
              (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.padres_hijos'::regclass AND attname = 'padre_id'),
              (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.padres_hijos'::regclass AND attname = 'hijo_id')
          ]::SMALLINT[]
    ) THEN
        ALTER TABLE public.padres_hijos
            ADD CONSTRAINT padres_hijos_pkey PRIMARY KEY (padre_id, hijo_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.padres_hijos'::regclass
          AND conname = 'padres_hijos_padre_id_fkey'
    ) THEN
        ALTER TABLE public.padres_hijos
            ADD CONSTRAINT padres_hijos_padre_id_fkey
            FOREIGN KEY (padre_id) REFERENCES public.perfiles(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.padres_hijos'::regclass
          AND conname = 'padres_hijos_hijo_id_fkey'
    ) THEN
        ALTER TABLE public.padres_hijos
            ADD CONSTRAINT padres_hijos_hijo_id_fkey
            FOREIGN KEY (hijo_id) REFERENCES public.perfiles(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.padres_hijos'::regclass
          AND conname = 'padres_hijos_distintos'
    ) THEN
        ALTER TABLE public.padres_hijos
            ADD CONSTRAINT padres_hijos_distintos CHECK (padre_id <> hijo_id) NOT VALID;
        ALTER TABLE public.padres_hijos
            VALIDATE CONSTRAINT padres_hijos_distintos;
    END IF;
END $$;

-- La PK cubre las búsquedas que comienzan por padre_id. La lectura inversa
-- (hijos/estudiantes hacia sus vínculos) necesita su propio índice para que la
-- clave foránea y las políticas RLS no degraden al crecer el padrón.
CREATE INDEX IF NOT EXISTS idx_padres_hijos_hijo_id
    ON public.padres_hijos (hijo_id);

ALTER TABLE public.padres_hijos ENABLE ROW LEVEL SECURITY;

-- La función antigua estaba en `public`, un esquema expuesto por la Data API,
-- y fijaba `search_path = public`. La versión canónica vive en el esquema
-- privado, no acepta parámetros y califica todos los nombres.
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
    WHERE p.user_id = (SELECT auth.uid());
$$;

REVOKE ALL ON FUNCTION app_private.mis_hijos_ids()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.mis_hijos_ids() TO authenticated;

-- ================================================================
-- 3. RETIRO DE POLÍTICAS REMOTAS DUPLICADAS O PELIGROSAS
-- ================================================================
-- Actividades: las dos políticas ALL permitían a cualquier usuario autenticado
-- modificar y borrar cualquier actividad.
DROP POLICY IF EXISTS "actividades_all" ON public.actividades;
DROP POLICY IF EXISTS "actividades_select" ON public.actividades;
DROP POLICY IF EXISTS "Lectura pública de actividades" ON public.actividades;
DROP POLICY IF EXISTS "Usuarios autenticados pueden modificar actividades" ON public.actividades;

-- Perfiles: el ALL de staff reabría UPDATE/DELETE después del cierre de 005/008.
DROP POLICY IF EXISTS "Staff gestiona perfiles" ON public.perfiles;
DROP POLICY IF EXISTS "Director puede eliminar perfiles" ON public.perfiles;
DROP POLICY IF EXISTS "Padres ven perfiles de sus hijos" ON public.perfiles;

-- Las políticas recuperadas se recrean abajo sin consultas recursivas.
DROP POLICY IF EXISTS "Padres ven asistencias de sus hijos" ON public.asistencias;
DROP POLICY IF EXISTS "Docentes registran asistencias" ON public.asistencias;
DROP POLICY IF EXISTS "Alumnos y padres ven sus propias asistencias" ON public.asistencias;

DROP POLICY IF EXISTS "inscripciones_all" ON public.inscripciones;
DROP POLICY IF EXISTS "inscripciones_select" ON public.inscripciones;
DROP POLICY IF EXISTS "Staff gestiona inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "Alumno crea su propia inscripcion" ON public.inscripciones;
DROP POLICY IF EXISTS "Alumno elimina su propia inscripcion" ON public.inscripciones;
DROP POLICY IF EXISTS "Padre inscribe a sus hijos" ON public.inscripciones;
DROP POLICY IF EXISTS "Padre da de baja a sus hijos" ON public.inscripciones;

DROP POLICY IF EXISTS "Opiniones son públicas" ON public.opiniones;
DROP POLICY IF EXISTS "Opiniones aprobadas son publicas" ON public.opiniones;
DROP POLICY IF EXISTS "Solo directores aprueban opiniones" ON public.opiniones;
DROP POLICY IF EXISTS "Solo directores eliminan opiniones" ON public.opiniones;
DROP POLICY IF EXISTS "Cualquiera puede dejar una opinión" ON public.opiniones;

DROP POLICY IF EXISTS "padres_hijos visibles para involucrados" ON public.padres_hijos;
DROP POLICY IF EXISTS "Solo director vincula padres_hijos" ON public.padres_hijos;
DROP POLICY IF EXISTS "Solo director desvincula padres_hijos" ON public.padres_hijos;

DROP POLICY IF EXISTS "Roles públicos" ON public.roles;
DROP POLICY IF EXISTS "roles_select" ON public.roles;
DROP POLICY IF EXISTS "niveles_select" ON public.niveles;

-- Estas políticas remotas dependían de funciones SECURITY DEFINER expuestas.
DROP POLICY IF EXISTS "Solo directores ven solicitudes" ON public.solicitudes_inscripcion;
DROP POLICY IF EXISTS "Solo directores actualizan solicitudes" ON public.solicitudes_inscripcion;
DROP POLICY IF EXISTS "Solo directores ven postulaciones" ON public.postulaciones;
DROP POLICY IF EXISTS "Solo directores actualizan postulaciones" ON public.postulaciones;

DROP FUNCTION IF EXISTS public.mis_hijos_ids();
DROP FUNCTION IF EXISTS public.is_director();
DROP FUNCTION IF EXISTS public.is_director_or_docente();

-- ================================================================
-- 4. PRIVILEGIOS MÍNIMOS Y POLÍTICAS CANÓNICAS
-- ================================================================
-- ACTIVIDADES. La lectura pública se conserva. La única escritura directa que
-- sigue necesitando la pantalla actual es el cupo máximo, y queda limitada por
-- privilegio de columna y por rol. INSERT y DELETE quedan cerrados; EPT-56 usará
-- RPC seguras para materias desde la migración 012.
ALTER TABLE public.actividades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.actividades FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.actividades TO anon, authenticated;
GRANT UPDATE (cupo_maximo) ON public.actividades TO authenticated;
REVOKE ALL ON SEQUENCE public.actividades_id_seq FROM PUBLIC, anon, authenticated;

CREATE POLICY "Actividades visibles para todos" ON public.actividades
    FOR SELECT TO anon, authenticated
    USING (TRUE);

CREATE POLICY "Directores y docentes actualizan cupos" ON public.actividades
    FOR UPDATE TO authenticated
    USING ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'))
    WITH CHECK ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

-- OPINIONES. Dos políticas de lectura evitan invocar una función privada al
-- atender una sesión anónima. Los roles de aplicación no pueden cambiar otra
-- columna durante la moderación.
ALTER TABLE public.opiniones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opiniones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.opiniones TO anon, authenticated;
GRANT INSERT (nombre_usuario, comentario) ON public.opiniones TO anon, authenticated;
GRANT UPDATE (aprobado) ON public.opiniones TO authenticated;
GRANT DELETE ON public.opiniones TO authenticated;
REVOKE ALL ON SEQUENCE public.opiniones_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.opiniones_id_seq TO anon, authenticated;

CREATE POLICY "Visitantes leen opiniones aprobadas" ON public.opiniones
    FOR SELECT TO anon
    USING (aprobado);

CREATE POLICY "Usuarios leen opiniones permitidas" ON public.opiniones
    FOR SELECT TO authenticated
    USING (aprobado OR (SELECT app_private.rol_actual()) = 'DIRECTOR');

CREATE POLICY "Visitantes dejan opiniones pendientes" ON public.opiniones
    FOR INSERT TO anon, authenticated
    WITH CHECK (aprobado = FALSE);

CREATE POLICY "Solo directores aprueban opiniones" ON public.opiniones
    FOR UPDATE TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR')
    WITH CHECK ((SELECT app_private.rol_actual()) = 'DIRECTOR');

CREATE POLICY "Solo directores eliminan opiniones" ON public.opiniones
    FOR DELETE TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');

-- PADRES_HIJOS. Se conserva el contrato remoto: DIRECTOR vincula/desvincula;
-- cada involucrado puede leer sus relaciones. No hay UPDATE ni TRUNCATE.
REVOKE ALL ON public.padres_hijos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.padres_hijos TO authenticated;

CREATE POLICY "Vínculos familiares visibles para involucrados" ON public.padres_hijos
    FOR SELECT TO authenticated
    USING (
        (SELECT app_private.rol_actual()) = 'DIRECTOR'
        OR padre_id = (SELECT app_private.perfil_actual())
        OR hijo_id = (SELECT app_private.perfil_actual())
    );

CREATE POLICY "Solo directores vinculan familias" ON public.padres_hijos
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT app_private.rol_actual()) = 'DIRECTOR');

CREATE POLICY "Solo directores desvinculan familias" ON public.padres_hijos
    FOR DELETE TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');

-- PERFILES. 005 conserva la lectura propia y la lectura de staff; 008 conserva
-- las operaciones administrativas por RPC. Solo se agrega la lectura parental
-- recuperada, sin reabrir UPDATE ni DELETE.
REVOKE ALL ON public.perfiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.perfiles TO authenticated;
GRANT UPDATE (
    rol_id, nombre, apellido, dni, direccion, telefono, legajo_nro, fecha_nacimiento
) ON public.perfiles TO authenticated;

DROP POLICY IF EXISTS "Directores modifican perfiles" ON public.perfiles;
CREATE POLICY "Directores modifican perfiles" ON public.perfiles
    FOR UPDATE TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR')
    WITH CHECK ((SELECT app_private.rol_actual()) = 'DIRECTOR');

CREATE POLICY "Padres ven perfiles de sus hijos" ON public.perfiles
    FOR SELECT TO authenticated
    USING (id IN (SELECT app_private.mis_hijos_ids()));

-- ASISTENCIAS. Se reemplaza FOR ALL por comandos explícitos y se elimina
-- DELETE: la aplicación registra y corrige asistencias, no las borra.
ALTER TABLE public.asistencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asistencias FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.asistencias TO authenticated;

CREATE POLICY "Staff consulta asistencias" ON public.asistencias
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

CREATE POLICY "Staff registra asistencias" ON public.asistencias
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

CREATE POLICY "Staff modifica asistencias" ON public.asistencias
    FOR UPDATE TO authenticated
    USING ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'))
    WITH CHECK ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

CREATE POLICY "Alumnos consultan sus asistencias" ON public.asistencias
    FOR SELECT TO authenticated
    USING (estudiante_id = (SELECT app_private.perfil_actual()));

CREATE POLICY "Padres ven asistencias de sus hijos" ON public.asistencias
    FOR SELECT TO authenticated
    USING (estudiante_id IN (SELECT app_private.mis_hijos_ids()));

-- INSCRIPCIONES. Se conserva la funcionalidad remota de staff, estudiante y
-- padre, pero sin una política ALL. La lectura autenticada global se mantiene
-- porque la pantalla calcula los cupos a partir de esas filas.
ALTER TABLE public.inscripciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inscripciones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inscripciones TO authenticated;

CREATE POLICY "Usuarios autenticados consultan inscripciones" ON public.inscripciones
    FOR SELECT TO authenticated
    USING (TRUE);

CREATE POLICY "Staff crea inscripciones" ON public.inscripciones
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

CREATE POLICY "Staff modifica inscripciones" ON public.inscripciones
    FOR UPDATE TO authenticated
    USING ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'))
    WITH CHECK ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

CREATE POLICY "Staff elimina inscripciones" ON public.inscripciones
    FOR DELETE TO authenticated
    USING ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

CREATE POLICY "Alumno crea su propia inscripcion" ON public.inscripciones
    FOR INSERT TO authenticated
    WITH CHECK (estudiante_id = (SELECT app_private.perfil_actual()));

CREATE POLICY "Alumno elimina su propia inscripcion" ON public.inscripciones
    FOR DELETE TO authenticated
    USING (estudiante_id = (SELECT app_private.perfil_actual()));

CREATE POLICY "Padre inscribe a sus hijos" ON public.inscripciones
    FOR INSERT TO authenticated
    WITH CHECK (estudiante_id IN (SELECT app_private.mis_hijos_ids()));

CREATE POLICY "Padre da de baja a sus hijos" ON public.inscripciones
    FOR DELETE TO authenticated
    USING (estudiante_id IN (SELECT app_private.mis_hijos_ids()));

-- SOLICITUDES Y POSTULACIONES. Mismo acceso funcional de 001/002, sin repetir
-- consultas a perfiles ni depender de funciones privilegiadas expuestas.
REVOKE ALL ON public.solicitudes_inscripcion FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.solicitudes_inscripcion TO anon;
GRANT SELECT, UPDATE ON public.solicitudes_inscripcion TO authenticated;

CREATE POLICY "Solo directores ven solicitudes" ON public.solicitudes_inscripcion
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');

CREATE POLICY "Solo directores actualizan solicitudes" ON public.solicitudes_inscripcion
    FOR UPDATE TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR')
    WITH CHECK ((SELECT app_private.rol_actual()) = 'DIRECTOR');

REVOKE ALL ON public.postulaciones FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.postulaciones TO anon;
GRANT SELECT, UPDATE ON public.postulaciones TO authenticated;

CREATE POLICY "Solo directores ven postulaciones" ON public.postulaciones
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');

CREATE POLICY "Solo directores actualizan postulaciones" ON public.postulaciones
    FOR UPDATE TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR')
    WITH CHECK ((SELECT app_private.rol_actual()) = 'DIRECTOR');

-- ================================================================
-- 5. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_config TEXT[];
    v_repetidos BIGINT;
    v_relacion TEXT;
    v_privilegio TEXT;
    v_antes BIGINT;
    v_despues BIGINT;
BEGIN
    SELECT p.proconfig INTO v_config
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname = 'mis_hijos_ids';

    IF v_config IS DISTINCT FROM ARRAY['search_path=""'] THEN
        RAISE EXCEPTION
            'Autoverificación 011: app_private.mis_hijos_ids debe fijar search_path vacío y fija %.',
            v_config;
    END IF;

    IF pg_catalog.to_regprocedure('public.mis_hijos_ids()') IS NOT NULL
       OR pg_catalog.to_regprocedure('public.is_director()') IS NOT NULL
       OR pg_catalog.to_regprocedure('public.is_director_or_docente()') IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Autoverificación 011: quedó una función SECURITY DEFINER histórica en public.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('actividades', 'asistencias', 'inscripciones', 'perfiles')
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION
            'Autoverificación 011: subsiste una política ALL en una tabla reconciliada.';
    END IF;

    FOREACH v_privilegio IN ARRAY ARRAY[
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
        IF pg_catalog.has_table_privilege('anon', 'public.actividades', v_privilegio) THEN
            RAISE EXCEPTION
                'Autoverificación 011: anon conserva % sobre actividades.',
                v_privilegio;
        END IF;
    END LOOP;

    FOREACH v_privilegio IN ARRAY ARRAY[
        'INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
        IF pg_catalog.has_table_privilege('authenticated', 'public.actividades', v_privilegio) THEN
            RAISE EXCEPTION
                'Autoverificación 011: authenticated conserva % sobre actividades.',
                v_privilegio;
        END IF;
    END LOOP;

    IF pg_catalog.has_sequence_privilege('anon', 'public.actividades_id_seq', 'USAGE')
       OR pg_catalog.has_sequence_privilege('authenticated', 'public.actividades_id_seq', 'USAGE')
    THEN
        RAISE EXCEPTION
            'Autoverificación 011: actividades conserva privilegios amplios.';
    END IF;

    IF NOT pg_catalog.has_column_privilege('authenticated', 'public.actividades', 'cupo_maximo', 'UPDATE')
       OR pg_catalog.has_column_privilege('authenticated', 'public.actividades', 'nombre', 'UPDATE')
    THEN
        RAISE EXCEPTION
            'Autoverificación 011: el UPDATE de actividades no quedó limitado a cupo_maximo.';
    END IF;

    IF NOT pg_catalog.has_column_privilege('anon', 'public.opiniones', 'comentario', 'INSERT')
       OR pg_catalog.has_column_privilege('anon', 'public.opiniones', 'id', 'INSERT')
       OR pg_catalog.has_column_privilege('anon', 'public.opiniones', 'aprobado', 'INSERT')
    THEN
        RAISE EXCEPTION
            'Autoverificación 011: el alta pública de opiniones no quedó limitada al contenido.';
    END IF;

    IF NOT pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'nombre', 'UPDATE')
       OR pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'id', 'UPDATE')
       OR pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'user_id', 'UPDATE')
    THEN
        RAISE EXCEPTION
            'Autoverificación 011: el UPDATE de perfiles no quedó limitado a datos editables.';
    END IF;

    FOREACH v_relacion IN ARRAY ARRAY[
        'actividades', 'opiniones', 'perfiles', 'inscripciones', 'asistencias', 'padres_hijos'
    ] LOOP
        SELECT cantidad INTO v_antes
        FROM ept_011_conteos_iniciales WHERE relacion = v_relacion;

        EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I', v_relacion)
        INTO v_despues;

        IF v_despues <> v_antes THEN
            RAISE EXCEPTION
                'Autoverificación 011: % cambió de % a % filas.',
                v_relacion, v_antes, v_despues;
        END IF;
    END LOOP;

    SELECT COUNT(*) INTO v_repetidos
    FROM (
        SELECT tipo, nivel_id, UPPER(BTRIM(nombre))
        FROM public.actividades
        GROUP BY tipo, nivel_id, UPPER(BTRIM(nombre))
        HAVING COUNT(*) > 1
    ) d;

    RAISE NOTICE
        'Reconciliación 011: % grupo(s) duplicado(s) de actividades se preservaron sin fusionar.',
        v_repetidos;
END $$;
