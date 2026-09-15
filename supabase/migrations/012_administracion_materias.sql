-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Administración de materias (EPT-56)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 011.
--
-- ============================================================
-- MODELO
-- ============================================================
--   1. `public.actividades` sigue siendo la única tabla de actividades. Una
--      materia es una fila con `tipo = 'CURRICULAR'`. Deportes y talleres no se
--      tocan: no se fusionan, no se renombran y no reciben permisos nuevos.
--
--   2. `actividades.activo` es la baja lógica. Se agrega con DEFAULT TRUE, de
--      modo que todas las filas existentes conservan su comportamiento. Solo las
--      operaciones de materias lo modifican.
--
--   3. La identidad funcional de una materia es su nombre normalizado
--      (`UPPER(BTRIM(nombre))`). Un índice único parcial la garantiza solo para
--      `CURRICULAR`; los duplicados históricos de deportes y talleres que
--      conserva 011 quedan fuera del índice.
--
--   4. `public.materias_cursos` es la relación muchos-a-muchos Curso–Materia.
--      Cada fila es una asignación con profesor responsable opcional y su propio
--      estado lógico. Es la entidad a la que EPT-57 asociará horarios.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                        | Garantía                  |
-- |---------------------------------------------------|---------------------------|
-- | Nombre de materia recortado y de 1 a 100 car.     | CHECK + validación en RPC |
-- | Sin duplicados normalizados de materias           | índice único parcial      |
-- | Una asignación por combinación Curso–Materia      | UNIQUE (materia, curso)   |
-- | Solo materias CURRICULAR en asignaciones          | trigger BEFORE            |
-- | Materia y curso activos en asignaciones nuevas    | trigger BEFORE + FOR SHARE|
-- | Profesor responsable con rol real DOCENTE         | trigger BEFORE + FOR SHARE|
-- | Materia y curso de una asignación inmutables      | trigger BEFORE            |
-- | Sin borrado físico de materias ni asignaciones    | sin GRANT, política ni RPC|
-- | Historial conservado al inactivar                 | FK ON DELETE RESTRICT     |
--
-- ============================================================
-- ORDEN DE BLOQUEOS
-- ============================================================
--     actividades  →  cursos  →  perfiles  →  materias_cursos
--
-- El trigger de asignación toma FOR SHARE en ese orden. Inactivar una materia
-- solo actualiza `actividades`; inactivar un curso solo actualiza `cursos`.
-- Ninguna operación sube en sentido contrario, de modo que no hay ciclos. Una
-- asignación nueva y la inactivación concurrente de su materia o curso quedan
-- serializadas: gana la primera que bloquea la fila.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P553x/P554x, sin colisión con 006–010.
--   P5505  se requiere una identidad autenticada          (reutilizado)
--   42501  el rol de la sesión no está autorizado         (reutilizado)
--   23505  duplicado de materia o de asignación           (restricción)
--   P5530  el nombre de la materia no es válido
--   P5531  la materia no existe
--   P5532  el curso no existe
--   P5533  el profesor no existe
--   P5534  la asignación no existe
--   P5535  el perfil elegido no tiene el rol DOCENTE
--   P5536  la materia está inactiva
--   P5537  el curso está inactivo
--   P5538  la asignación está inactiva
--   P5539  el estado solicitado no es válido
--   P5540  la operación alteraría la identidad de una asignación o materia
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE PRESERVACIÓN
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.actividades') IS NULL
       OR pg_catalog.to_regclass('public.cursos') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
       OR pg_catalog.to_regclass('public.niveles') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración 012: faltan tablas base; la base no corresponde a 001–011.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.es_director()') IS NULL THEN
        RAISE EXCEPTION
            'Migración 012: falta app_private.es_director(); la base no corresponde a 001–011.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'actividades'
          AND column_name = 'activo'
    ) THEN
        RAISE EXCEPTION
            'Migración 012: actividades.activo ya existe; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_012_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_012_conteos_iniciales (relacion, cantidad)
VALUES
    ('actividades', (SELECT pg_catalog.count(*) FROM public.actividades)),
    ('actividades_curriculares',
        (SELECT pg_catalog.count(*) FROM public.actividades WHERE tipo = 'CURRICULAR')),
    ('actividades_no_curriculares',
        (SELECT pg_catalog.count(*) FROM public.actividades
         WHERE tipo IS DISTINCT FROM 'CURRICULAR')),
    ('inscripciones', (SELECT pg_catalog.count(*) FROM public.inscripciones)),
    ('cursos', (SELECT pg_catalog.count(*) FROM public.cursos)),
    ('perfiles', (SELECT pg_catalog.count(*) FROM public.perfiles));


-- ================================================================
-- 2. CONTRATO DEL NOMBRE DE MATERIA
-- ================================================================
-- Mismo conjunto de espacios en blanco laterales que `nombre_nivel_valido`
-- (007), con el largo de `actividades.nombre` (VARCHAR(100)). La interfaz y la
-- API recortan el texto antes de enviarlo; la base rechaza cualquier valor que
-- llegue sin recortar, en lugar de corregirlo en silencio.
CREATE OR REPLACE FUNCTION app_private.nombre_materia_valido(p_nombre TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_nombre IS NOT NULL
       AND pg_catalog.char_length(p_nombre) BETWEEN 1 AND 100
       AND p_nombre = pg_catalog.btrim(
           p_nombre,
           pg_catalog.concat(
               pg_catalog.chr(9),     -- tabulación
               pg_catalog.chr(10),    -- salto de línea
               pg_catalog.chr(11),    -- tabulación vertical
               pg_catalog.chr(12),    -- avance de página
               pg_catalog.chr(13),    -- retorno de carro
               pg_catalog.chr(32),    -- espacio ASCII
               pg_catalog.chr(133),   -- next line
               pg_catalog.chr(160),   -- espacio no separable
               pg_catalog.chr(5760),  -- ogham space mark
               pg_catalog.chr(8192),  -- en quad
               pg_catalog.chr(8193),  -- em quad
               pg_catalog.chr(8194),  -- en space
               pg_catalog.chr(8195),  -- em space
               pg_catalog.chr(8196),  -- three-per-em space
               pg_catalog.chr(8197),  -- four-per-em space
               pg_catalog.chr(8198),  -- six-per-em space
               pg_catalog.chr(8199),  -- figure space
               pg_catalog.chr(8200),  -- punctuation space
               pg_catalog.chr(8201),  -- thin space
               pg_catalog.chr(8202),  -- hair space
               pg_catalog.chr(8232),  -- line separator
               pg_catalog.chr(8233),  -- paragraph separator
               pg_catalog.chr(8239),  -- narrow no-break space
               pg_catalog.chr(8287),  -- medium mathematical space
               pg_catalog.chr(12288), -- ideographic space
               pg_catalog.chr(65279)  -- zero width no-break space / BOM
           )
       );
$$;

-- PostgreSQL evalúa el CHECK de actividades en cada UPDATE de la fila, incluido
-- el UPDATE de `cupo_maximo` que 011 conserva para DIRECTOR y DOCENTE. Por eso
-- `authenticated` necesita EXECUTE sobre esta función pura: sin él, ajustar el
-- cupo de una materia existente fallaría por permisos. `service_role` lo
-- necesita por la misma razón en el entorno local de pruebas.
REVOKE ALL ON FUNCTION app_private.nombre_materia_valido(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nombre_materia_valido(TEXT)
    TO authenticated, service_role;


-- ================================================================
-- 3. VERIFICACIÓN PREVIA DE LAS MATERIAS EXISTENTES
-- ================================================================
-- La migración falla sin modificar ninguna fila si encuentra un dato que
-- exigiría una decisión funcional: fusionar o renombrar materias existentes
-- está fuera de la autoridad de esta migración. Los mensajes informan
-- identificadores internos, no datos personales.
DO $$
DECLARE
    v_grupos_duplicados TEXT;
    v_nombres_invalidos TEXT;
BEGIN
    SELECT pg_catalog.string_agg(d.ids, '; ')
    INTO v_grupos_duplicados
    FROM (
        SELECT pg_catalog.string_agg(a.id::TEXT, ', ' ORDER BY a.id) AS ids
        FROM public.actividades a
        WHERE a.tipo = 'CURRICULAR'
        GROUP BY pg_catalog.upper(pg_catalog.btrim(a.nombre))
        HAVING pg_catalog.count(*) > 1
    ) AS d;

    IF v_grupos_duplicados IS NOT NULL THEN
        RAISE EXCEPTION
            'Migración 012: existen materias CURRICULAR duplicadas por nombre normalizado (ids: %). Resolvelas con una decisión funcional explícita antes de aplicar la migración; 012 nunca fusiona ni elimina datos.',
            v_grupos_duplicados;
    END IF;

    SELECT pg_catalog.string_agg(a.id::TEXT, ', ' ORDER BY a.id)
    INTO v_nombres_invalidos
    FROM public.actividades a
    WHERE a.tipo = 'CURRICULAR'
      AND NOT app_private.nombre_materia_valido(a.nombre);

    IF v_nombres_invalidos IS NOT NULL THEN
        RAISE EXCEPTION
            'Migración 012: existen materias CURRICULAR con nombre vacío o con espacios en blanco laterales (ids: %). Corregilas explícitamente antes de aplicar la migración.',
            v_nombres_invalidos;
    END IF;
END $$;


-- ================================================================
-- 4. ESTADO LÓGICO, INTEGRIDAD DE NOMBRE Y UNICIDAD
-- ================================================================
ALTER TABLE public.actividades
    ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.actividades.activo IS
    'Baja lógica. Hoy solo la administran las operaciones de materias (tipo CURRICULAR).';

ALTER TABLE public.actividades
    ADD CONSTRAINT actividades_nombre_materia_valido
        CHECK (
            tipo IS DISTINCT FROM 'CURRICULAR'
            OR app_private.nombre_materia_valido(nombre) IS TRUE
        );

-- Autoridad única de la identidad funcional ante concurrencia: dos altas o
-- renombrados simultáneos con el mismo nombre normalizado no pueden confirmar
-- los dos, y el perdedor recibe SQLSTATE 23505.
CREATE UNIQUE INDEX idx_materias_nombre_normalizado
    ON public.actividades (pg_catalog.upper(pg_catalog.btrim(nombre)))
    WHERE tipo = 'CURRICULAR';


-- ================================================================
-- 5. RELACIÓN CURSO–MATERIA
-- ================================================================
CREATE TABLE public.materias_cursos (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    -- ON DELETE RESTRICT en las tres referencias: el historial de asignaciones
    -- nunca desaparece por el borrado de una fila relacionada.
    materia_id INTEGER NOT NULL
        REFERENCES public.actividades(id) ON DELETE RESTRICT,
    curso_id UUID NOT NULL
        REFERENCES public.cursos(id) ON DELETE RESTRICT,
    profesor_id UUID
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Una sola asignación por combinación, activa o inactiva. Reasignar una
    -- materia a un curso es reactivar la asignación existente, no duplicarla.
    -- Al comenzar por materia_id también indexa esa clave foránea.
    CONSTRAINT materias_cursos_materia_curso_unica UNIQUE (materia_id, curso_id)
);

COMMENT ON TABLE public.materias_cursos IS
    'Asignación de una materia (actividad CURRICULAR) a un curso, con profesor responsable DOCENTE opcional y baja lógica. Nunca se elimina.';

-- Índices de las otras dos claves foráneas.
CREATE INDEX idx_materias_cursos_curso
    ON public.materias_cursos (curso_id);

CREATE INDEX idx_materias_cursos_profesor
    ON public.materias_cursos (profesor_id)
    WHERE profesor_id IS NOT NULL;


-- ================================================================
-- 6. INVARIANTES DE ASIGNACIÓN
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.validar_asignacion_materia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tipo            TEXT;
    v_materia_activa  BOOLEAN;
    v_curso_activo    BOOLEAN;
    v_rol_id          INTEGER;
    v_rol_nombre      TEXT;
    v_asignacion_nueva BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- La identidad de una asignación es su par materia–curso. Cambiarlo
        -- reescribiría la historia y desligaría los horarios futuros de EPT-57.
        IF NEW.materia_id IS DISTINCT FROM OLD.materia_id
           OR NEW.curso_id IS DISTINCT FROM OLD.curso_id THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5540',
                MESSAGE = 'La materia y el curso de una asignación no pueden modificarse.';
        END IF;

        NEW.fecha_creacion := OLD.fecha_creacion;
        NEW.fecha_actualizacion := NOW();
    END IF;

    -- Es una asignación nueva el alta y la reactivación. Conservar o inactivar
    -- una asignación existente nunca exige que materia y curso sigan activos.
    v_asignacion_nueva := TG_OP = 'INSERT'
        OR (NOT OLD.activo AND NEW.activo);

    IF v_asignacion_nueva THEN
        SELECT a.tipo, a.activo
        INTO v_tipo, v_materia_activa
        FROM public.actividades a
        WHERE a.id = NEW.materia_id
        FOR SHARE;

        IF NOT FOUND OR v_tipo IS DISTINCT FROM 'CURRICULAR' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5531',
                MESSAGE = 'La materia solicitada no existe.';
        END IF;

        IF NOT v_materia_activa THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5536',
                MESSAGE = 'La materia está inactiva y no admite nuevas asignaciones.';
        END IF;

        SELECT c.activo
        INTO v_curso_activo
        FROM public.cursos c
        WHERE c.id = NEW.curso_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5532',
                MESSAGE = 'El curso solicitado no existe.';
        END IF;

        IF NOT v_curso_activo THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5537',
                MESSAGE = 'El curso está inactivo y no admite nuevas asignaciones.';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.profesor_id IS DISTINCT FROM OLD.profesor_id
       AND NOT NEW.activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5538',
            MESSAGE = 'La asignación está inactiva. Reactivala antes de cambiar el profesor responsable.';
    END IF;

    -- El rol se valida solo cuando el profesor se elige o cambia. Si más adelante
    -- el perfil deja de ser DOCENTE, la asignación histórica se conserva.
    IF NEW.profesor_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.profesor_id IS DISTINCT FROM OLD.profesor_id) THEN
        SELECT p.rol_id
        INTO v_rol_id
        FROM public.perfiles p
        WHERE p.id = NEW.profesor_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5533',
                MESSAGE = 'El profesor solicitado no existe.';
        END IF;

        SELECT r.nombre
        INTO v_rol_nombre
        FROM public.roles r
        WHERE r.id = v_rol_id;

        IF v_rol_nombre IS DISTINCT FROM 'DOCENTE' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5535',
                MESSAGE = 'La persona seleccionada no tiene el rol DOCENTE.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_asignacion_materia()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validar_asignacion_materia_antes_de_escribir
    BEFORE INSERT OR UPDATE ON public.materias_cursos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_asignacion_materia();

-- Una materia con asignaciones no puede dejar de ser CURRICULAR: la relación
-- quedaría apuntando a un deporte o taller.
CREATE OR REPLACE FUNCTION app_private.proteger_tipo_materia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.tipo = 'CURRICULAR'
       AND NEW.tipo IS DISTINCT FROM OLD.tipo
       AND EXISTS (
           SELECT 1 FROM public.materias_cursos mc WHERE mc.materia_id = OLD.id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5540',
            MESSAGE = 'Una materia con asignaciones no puede cambiar de tipo.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_tipo_materia()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_tipo_materia_antes_de_actualizar
    BEFORE UPDATE OF tipo ON public.actividades
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_tipo_materia();


-- ================================================================
-- 7. VISTAS DE LECTURA
-- ================================================================
-- `security_invoker = true`: cada vista respeta las políticas RLS y los
-- privilegios de quien consulta, nunca los del propietario.
CREATE VIEW public.materias
WITH (security_invoker = true) AS
SELECT
    a.id,
    a.nombre,
    a.activo
FROM public.actividades a
WHERE a.tipo = 'CURRICULAR';

COMMENT ON VIEW public.materias IS
    'Catálogo de materias: actividades CURRICULAR con su estado lógico. Respeta RLS mediante security_invoker.';

CREATE VIEW public.materias_cursos_detalle
WITH (security_invoker = true) AS
SELECT
    mc.id,
    mc.materia_id,
    a.nombre        AS materia_nombre,
    a.activo        AS materia_activa,
    mc.curso_id,
    c.denominacion  AS curso_denominacion,
    c.division      AS curso_division,
    c.activo        AS curso_activo,
    n.nombre        AS nivel_nombre,
    mc.profesor_id,
    p.nombre        AS profesor_nombre,
    p.apellido      AS profesor_apellido,
    mc.activo,
    mc.fecha_creacion,
    mc.fecha_actualizacion
FROM public.materias_cursos mc
JOIN public.actividades a ON a.id = mc.materia_id
JOIN public.cursos c ON c.id = mc.curso_id
JOIN public.niveles n ON n.id = c.nivel_id
LEFT JOIN public.perfiles p ON p.id = mc.profesor_id;

COMMENT ON VIEW public.materias_cursos_detalle IS
    'Asignaciones Curso–Materia con materia, curso, nivel y profesor resueltos, incluidas las históricas. Respeta RLS mediante security_invoker.';


-- ================================================================
-- 8. OPERACIONES PRIVILEGIADAS
-- ================================================================
-- Todas viven en `app_private`, que la Data API no expone. Todas verifican
-- `auth.uid()` y el rol DIRECTOR internamente; ninguna recibe usuario, rol ni
-- actor como parámetro. No existe ninguna operación de eliminación.

-- ----------------------------------------------------------------
-- 8.1 Catálogo de materias
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.crear_materia(p_nombre TEXT)
RETURNS public.materias
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id      INTEGER;
    v_materia public.materias;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar materias.';
    END IF;

    IF NOT app_private.nombre_materia_valido(p_nombre) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5530', MESSAGE = 'El nombre de la materia no es válido.';
    END IF;

    INSERT INTO public.actividades (nombre, tipo, activo)
    VALUES (p_nombre, 'CURRICULAR', TRUE)
    RETURNING id INTO v_id;

    SELECT m.* INTO v_materia FROM public.materias m WHERE m.id = v_id;
    RETURN v_materia;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.renombrar_materia(
    p_materia_id INTEGER,
    p_nombre     TEXT
)
RETURNS public.materias
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id      INTEGER;
    v_materia public.materias;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar materias.';
    END IF;

    IF NOT app_private.nombre_materia_valido(p_nombre) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5530', MESSAGE = 'El nombre de la materia no es válido.';
    END IF;

    -- El filtro por tipo impide renombrar un deporte o un taller por esta vía.
    UPDATE public.actividades
    SET nombre = p_nombre
    WHERE id = p_materia_id
      AND tipo = 'CURRICULAR'
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5531', MESSAGE = 'La materia solicitada no existe.';
    END IF;

    SELECT m.* INTO v_materia FROM public.materias m WHERE m.id = v_id;
    RETURN v_materia;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.cambiar_estado_materia(
    p_materia_id INTEGER,
    p_activo     BOOLEAN
)
RETURNS public.materias
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id      INTEGER;
    v_materia public.materias;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar materias.';
    END IF;

    IF p_activo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5539', MESSAGE = 'El estado de la materia no es válido.';
    END IF;

    -- Inactivar no toca `materias_cursos`: las asignaciones y su profesor
    -- quedan intactos como historial.
    UPDATE public.actividades
    SET activo = p_activo
    WHERE id = p_materia_id
      AND tipo = 'CURRICULAR'
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5531', MESSAGE = 'La materia solicitada no existe.';
    END IF;

    SELECT m.* INTO v_materia FROM public.materias m WHERE m.id = v_id;
    RETURN v_materia;
END;
$$;

-- ----------------------------------------------------------------
-- 8.2 Asignaciones Curso–Materia
-- ----------------------------------------------------------------
-- La existencia, el tipo, el estado y el rol del profesor los valida el trigger
-- de la sección 6, que es la autoridad única también ante concurrencia.
CREATE OR REPLACE FUNCTION app_private.asignar_materia_curso(
    p_materia_id  INTEGER,
    p_curso_id    UUID,
    p_profesor_id UUID DEFAULT NULL
)
RETURNS public.materias_cursos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asignacion public.materias_cursos;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar materias.';
    END IF;

    IF p_materia_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5531', MESSAGE = 'La materia solicitada no existe.';
    END IF;

    IF p_curso_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5532', MESSAGE = 'El curso solicitado no existe.';
    END IF;

    INSERT INTO public.materias_cursos (materia_id, curso_id, profesor_id, activo)
    VALUES (p_materia_id, p_curso_id, p_profesor_id, TRUE)
    RETURNING * INTO v_asignacion;

    RETURN v_asignacion;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.cambiar_profesor_asignacion(
    p_asignacion_id UUID,
    p_profesor_id   UUID
)
RETURNS public.materias_cursos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asignacion public.materias_cursos;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar materias.';
    END IF;

    -- `p_profesor_id` NULL deja la asignación sin profesor responsable.
    UPDATE public.materias_cursos
    SET profesor_id = p_profesor_id
    WHERE id = p_asignacion_id
    RETURNING * INTO v_asignacion;

    IF v_asignacion.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5534', MESSAGE = 'La asignación solicitada no existe.';
    END IF;

    RETURN v_asignacion;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.cambiar_estado_asignacion(
    p_asignacion_id UUID,
    p_activo        BOOLEAN
)
RETURNS public.materias_cursos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_asignacion public.materias_cursos;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar materias.';
    END IF;

    IF p_activo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5539', MESSAGE = 'El estado de la asignación no es válido.';
    END IF;

    UPDATE public.materias_cursos
    SET activo = p_activo
    WHERE id = p_asignacion_id
    RETURNING * INTO v_asignacion;

    IF v_asignacion.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5534', MESSAGE = 'La asignación solicitada no existe.';
    END IF;

    RETURN v_asignacion;
END;
$$;

REVOKE ALL ON FUNCTION app_private.crear_materia(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.renombrar_materia(INTEGER, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_estado_materia(INTEGER, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.asignar_materia_curso(INTEGER, UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_profesor_asignacion(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_estado_asignacion(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

-- Los wrappers SECURITY INVOKER necesitan ejecutar la operación privada. Cada
-- una vuelve a validar auth.uid() y el rol DIRECTOR.
GRANT EXECUTE ON FUNCTION app_private.crear_materia(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.renombrar_materia(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_estado_materia(INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.asignar_materia_curso(INTEGER, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_profesor_asignacion(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_estado_asignacion(UUID, BOOLEAN) TO authenticated;


-- ================================================================
-- 9. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
CREATE OR REPLACE FUNCTION public.crear_materia(p_nombre TEXT)
RETURNS public.materias
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.crear_materia(p_nombre);
$$;

CREATE OR REPLACE FUNCTION public.renombrar_materia(p_materia_id INTEGER, p_nombre TEXT)
RETURNS public.materias
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.renombrar_materia(p_materia_id, p_nombre);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_materia(p_materia_id INTEGER, p_activo BOOLEAN)
RETURNS public.materias
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_estado_materia(p_materia_id, p_activo);
$$;

CREATE OR REPLACE FUNCTION public.asignar_materia_curso(
    p_materia_id  INTEGER,
    p_curso_id    UUID,
    p_profesor_id UUID DEFAULT NULL
)
RETURNS public.materias_cursos
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.asignar_materia_curso(p_materia_id, p_curso_id, p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_profesor_asignacion(
    p_asignacion_id UUID,
    p_profesor_id   UUID
)
RETURNS public.materias_cursos
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_profesor_asignacion(p_asignacion_id, p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_asignacion(
    p_asignacion_id UUID,
    p_activo        BOOLEAN
)
RETURNS public.materias_cursos
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_estado_asignacion(p_asignacion_id, p_activo);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon; se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.crear_materia(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renombrar_materia(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cambiar_estado_materia(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asignar_materia_curso(INTEGER, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cambiar_profesor_asignacion(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cambiar_estado_asignacion(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_materia(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renombrar_materia(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_materia(INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asignar_materia_curso(INTEGER, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_profesor_asignacion(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_asignacion(UUID, BOOLEAN) TO authenticated;


-- ================================================================
-- 10. PRIVILEGIOS MÍNIMOS Y RLS
-- ================================================================
-- ACTIVIDADES: se conserva exactamente el contrato de 011. La nueva columna
-- `activo` no recibe privilegio de UPDATE directo para ningún rol de aplicación.
-- No se agrega ninguna política ni privilegio sobre deportes o talleres.

-- MATERIAS_CURSOS: solo lectura directa, y solo para DIRECTOR. DOCENTE no
-- obtiene lectura nueva: el modelo existente no le asigna materias todavía.
ALTER TABLE public.materias_cursos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.materias_cursos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.materias_cursos TO authenticated;

CREATE POLICY "El director consulta las asignaciones de materias" ON public.materias_cursos
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

-- No se crea ninguna política INSERT, UPDATE ni DELETE. Aunque alguien otorgara
-- el privilegio por error, RLS seguiría rechazando la escritura directa.

REVOKE ALL ON public.materias FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.materias_cursos_detalle FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.materias TO authenticated;
GRANT SELECT ON public.materias_cursos_detalle TO authenticated;


-- ================================================================
-- 11. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion   TEXT;
    v_antes      BIGINT;
    v_despues    BIGINT;
    v_privilegio TEXT;
    v_rol        TEXT;
BEGIN
    FOREACH v_relacion IN ARRAY ARRAY[
        'actividades', 'actividades_curriculares', 'actividades_no_curriculares',
        'inscripciones', 'cursos', 'perfiles'
    ] LOOP
        SELECT cantidad INTO v_antes
        FROM ept_012_conteos_iniciales WHERE relacion = v_relacion;

        v_despues := CASE v_relacion
            WHEN 'actividades' THEN (SELECT pg_catalog.count(*) FROM public.actividades)
            WHEN 'actividades_curriculares' THEN
                (SELECT pg_catalog.count(*) FROM public.actividades WHERE tipo = 'CURRICULAR')
            WHEN 'actividades_no_curriculares' THEN
                (SELECT pg_catalog.count(*) FROM public.actividades
                 WHERE tipo IS DISTINCT FROM 'CURRICULAR')
            WHEN 'inscripciones' THEN (SELECT pg_catalog.count(*) FROM public.inscripciones)
            WHEN 'cursos' THEN (SELECT pg_catalog.count(*) FROM public.cursos)
            WHEN 'perfiles' THEN (SELECT pg_catalog.count(*) FROM public.perfiles)
        END;

        IF v_despues <> v_antes THEN
            RAISE EXCEPTION 'Autoverificación 012: % cambió de % a % filas.',
                v_relacion, v_antes, v_despues;
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM public.actividades WHERE NOT activo) THEN
        RAISE EXCEPTION 'Autoverificación 012: una actividad existente no quedó activa.';
    END IF;

    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_privilegio IN ARRAY ARRAY[
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF pg_catalog.has_table_privilege(v_rol, 'public.materias_cursos', v_privilegio) THEN
                RAISE EXCEPTION 'Autoverificación 012: % conserva % sobre materias_cursos.',
                    v_rol, v_privilegio;
            END IF;
        END LOOP;

        FOREACH v_privilegio IN ARRAY ARRAY['INSERT', 'DELETE', 'TRUNCATE'] LOOP
            IF pg_catalog.has_table_privilege(v_rol, 'public.actividades', v_privilegio) THEN
                RAISE EXCEPTION 'Autoverificación 012: % conserva % sobre actividades.',
                    v_rol, v_privilegio;
            END IF;
        END LOOP;

        IF pg_catalog.has_column_privilege(v_rol, 'public.actividades', 'activo', 'UPDATE')
           OR pg_catalog.has_column_privilege(v_rol, 'public.actividades', 'nombre', 'UPDATE') THEN
            RAISE EXCEPTION 'Autoverificación 012: % puede cambiar nombre o estado de actividades directamente.',
                v_rol;
        END IF;
    END LOOP;

    IF pg_catalog.has_table_privilege('anon', 'public.materias_cursos', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.materias', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.materias_cursos_detalle', 'SELECT') THEN
        RAISE EXCEPTION 'Autoverificación 012: anon puede leer objetos de materias.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN (
            'crear_materia', 'renombrar_materia', 'cambiar_estado_materia',
            'asignar_materia_curso', 'cambiar_profesor_asignacion',
            'cambiar_estado_asignacion', 'validar_asignacion_materia',
            'proteger_tipo_materia', 'nombre_materia_valido'
        )
          AND n.nspname IN ('public', 'app_private')
          AND (
              p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
              OR (n.nspname = 'public' AND p.prosecdef)
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          )
    ) THEN
        RAISE EXCEPTION
            'Autoverificación 012: una función de materias no fija search_path vacío, es SECURITY DEFINER en public o es ejecutable por anon.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('materias_cursos', 'actividades')
          AND cmd IN ('DELETE', 'ALL')
    ) THEN
        RAISE EXCEPTION 'Autoverificación 012: existe una política DELETE o ALL sobre materias.';
    END IF;

    RAISE NOTICE
        'Migración 012: % materia(s) CURRICULAR preservada(s) y activa(s); % actividad(es) no curricular(es) sin cambios.',
        (SELECT pg_catalog.count(*) FROM public.actividades WHERE tipo = 'CURRICULAR'),
        (SELECT pg_catalog.count(*) FROM public.actividades WHERE tipo IS DISTINCT FROM 'CURRICULAR');
END $$;
