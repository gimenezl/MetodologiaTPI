-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Correcciones de integridad de niveles (EPT-55)
-- ============================================================
-- Migración aditiva: refuerza el contrato de nombres y serializa las nuevas
-- asignaciones de Cursos y Actividades contra cambios concurrentes de estado.

-- ================================================================
-- 1. CONTRATO EXPLÍCITO DE CARACTERES EN BLANCO LATERALES
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.nombre_nivel_valido(p_nombre TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_nombre IS NOT NULL
       AND pg_catalog.char_length(p_nombre) BETWEEN 1 AND 50
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

REVOKE ALL ON FUNCTION app_private.nombre_nivel_valido(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.nombre_nivel_valido(TEXT) TO service_role;

DO $$
DECLARE
    nombres_invalidos TEXT;
BEGIN
    SELECT pg_catalog.string_agg(
        pg_catalog.quote_nullable(n.nombre),
        ', ' ORDER BY n.id
    )
    INTO nombres_invalidos
    FROM public.niveles AS n
    WHERE NOT app_private.nombre_nivel_valido(n.nombre);

    IF nombres_invalidos IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede reforzar la integridad de niveles: existen nombres con caracteres en blanco laterales (%). Corregilos explícitamente antes de aplicar la migración.',
            nombres_invalidos;
    END IF;
END $$;

ALTER TABLE public.niveles
    DROP CONSTRAINT niveles_nombre_valido,
    ADD CONSTRAINT niveles_nombre_valido
        CHECK (app_private.nombre_nivel_valido(nombre) IS TRUE);

CREATE OR REPLACE FUNCTION app_private.crear_nivel(p_nombre TEXT)
RETURNS public.niveles
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    nivel_creado public.niveles;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede crear niveles.';
    END IF;

    IF NOT app_private.nombre_nivel_valido(p_nombre) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5501', MESSAGE = 'El nombre del nivel no es válido.';
    END IF;

    INSERT INTO public.niveles (nombre, activo, orden, es_institucional)
    VALUES (
        p_nombre,
        TRUE,
        pg_catalog.nextval('app_private.niveles_orden_seq'::pg_catalog.regclass),
        FALSE
    )
    RETURNING * INTO nivel_creado;

    RETURN nivel_creado;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.renombrar_nivel(
    p_nivel_id INTEGER,
    p_nombre TEXT
)
RETURNS public.niveles
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    nivel_actual public.niveles;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede renombrar niveles.';
    END IF;

    IF NOT app_private.nombre_nivel_valido(p_nombre) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5501', MESSAGE = 'El nombre del nivel no es válido.';
    END IF;

    SELECT *
    INTO nivel_actual
    FROM public.niveles
    WHERE id = p_nivel_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El nivel solicitado no existe.';
    END IF;

    IF nivel_actual.es_institucional THEN
        RAISE EXCEPTION USING ERRCODE = 'P5502', MESSAGE = 'Los niveles institucionales no pueden renombrarse.';
    END IF;

    UPDATE public.niveles
    SET nombre = p_nombre
    WHERE id = p_nivel_id
    RETURNING * INTO nivel_actual;

    RETURN nivel_actual;
END;
$$;

-- CREATE OR REPLACE conserva los grants mínimos definidos por la migración 006.

-- ================================================================
-- 2. SERIALIZACIÓN DE NUEVAS ASIGNACIONES
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.validar_nivel_activo_curso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    nivel_activo BOOLEAN;
BEGIN
    -- Conservar la relación existente no constituye una asignación nueva.
    IF TG_OP = 'UPDATE' AND NEW.nivel_id IS NOT DISTINCT FROM OLD.nivel_id THEN
        RETURN NEW;
    END IF;

    -- FOR SHARE entra en conflicto con el UPDATE de activo. La asignación y
    -- la inactivación quedan ordenadas por la primera transacción que bloquea
    -- la fila, sin bloquear entre sí asignaciones concurrentes.
    SELECT n.activo
    INTO nivel_activo
    FROM public.niveles AS n
    WHERE n.id = NEW.nivel_id
    FOR SHARE;

    IF FOUND AND NOT nivel_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5504',
            MESSAGE = 'Solo pueden asignarse niveles activos a cursos nuevos.';
    END IF;

    -- La clave foránea conserva 23503 cuando el nivel no existe.
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.validar_nivel_activo_actividad()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    nivel_activo BOOLEAN;
BEGIN
    -- NULL sigue representando una actividad sin nivel específico.
    IF NEW.nivel_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Una actividad histórica puede cambiar otros datos conservando su nivel.
    IF TG_OP = 'UPDATE' AND NEW.nivel_id IS NOT DISTINCT FROM OLD.nivel_id THEN
        RETURN NEW;
    END IF;

    SELECT n.activo
    INTO nivel_activo
    FROM public.niveles AS n
    WHERE n.id = NEW.nivel_id
    FOR SHARE;

    IF FOUND AND NOT nivel_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5504',
            MESSAGE = 'Solo pueden asignarse niveles activos a actividades nuevas.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_nivel_activo_actividad()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validar_nivel_activo_en_actividad
    BEFORE INSERT OR UPDATE OF nivel_id ON public.actividades
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_nivel_activo_actividad();

-- No se modifican la FK ON DELETE SET NULL, los grants ni el estado RLS general
-- de Actividades. Esa autorización integral permanece fuera del alcance EPT-55.
