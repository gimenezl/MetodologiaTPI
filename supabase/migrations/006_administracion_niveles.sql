-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Administración de niveles (EPT-55)
-- ============================================================
-- Migración aditiva. Mantiene `public.niveles` como catálogo de solo lectura
-- para la aplicación y concentra las escrituras autorizadas en funciones
-- privadas SECURITY DEFINER, invocadas mediante wrappers públicos mínimos.

-- ================================================================
-- 1. ESTADO, ORDEN Y PROTECCIÓN INSTITUCIONAL
-- ================================================================
ALTER TABLE public.niveles
    ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN orden INTEGER,
    ADD COLUMN es_institucional BOOLEAN NOT NULL DEFAULT FALSE;

-- La restricción de nombre se agrega solo después de verificar los datos
-- existentes. La migración falla sin modificar nombres si encuentra un valor
-- que exigiría una decisión destructiva o una normalización silenciosa.
DO $$
DECLARE
    nombres_invalidos TEXT;
BEGIN
    SELECT string_agg(quote_nullable(n.nombre), ', ' ORDER BY n.id)
    INTO nombres_invalidos
    FROM public.niveles n
    WHERE n.nombre IS NULL
       OR n.nombre <> pg_catalog.btrim(n.nombre)
       OR pg_catalog.char_length(n.nombre) NOT BETWEEN 1 AND 50;

    IF nombres_invalidos IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede aplicar la integridad de niveles: existen nombres inválidos (%). Corregilos explícitamente antes de aplicar la migración.',
            nombres_invalidos;
    END IF;
END $$;

-- La propiedad estable `es_institucional` protege los tres registros iniciales
-- sin depender del texto que presente la interfaz ni de identificadores.
UPDATE public.niveles
SET es_institucional = TRUE,
    orden = CASE pg_catalog.upper(pg_catalog.btrim(nombre))
        WHEN 'INICIAL' THEN 10
        WHEN 'PRIMARIO' THEN 20
        WHEN 'SECUNDARIO' THEN 30
    END
WHERE pg_catalog.upper(pg_catalog.btrim(nombre))
      IN ('INICIAL', 'PRIMARIO', 'SECUNDARIO');

DO $$
BEGIN
    IF (SELECT pg_catalog.count(*)
        FROM public.niveles
        WHERE es_institucional) <> 3 THEN
        RAISE EXCEPTION
            'No se puede proteger el catálogo institucional: deben existir exactamente INICIAL, PRIMARIO y SECUNDARIO.';
    END IF;
END $$;

-- Los registros adicionales preexistentes quedan después de los institucionales
-- en un orden determinista por nombre normalizado, nunca por identificador.
WITH adicionales AS (
    SELECT id,
           30 + 10 * pg_catalog.row_number() OVER (
               ORDER BY pg_catalog.upper(pg_catalog.btrim(nombre))
           ) AS orden_asignado
    FROM public.niveles
    WHERE NOT es_institucional
)
UPDATE public.niveles n
SET orden = adicionales.orden_asignado
FROM adicionales
WHERE adicionales.id = n.id;

ALTER TABLE public.niveles
    ALTER COLUMN orden SET NOT NULL,
    ADD CONSTRAINT niveles_nombre_valido
        CHECK (
            nombre = pg_catalog.btrim(nombre)
            AND pg_catalog.char_length(nombre) BETWEEN 1 AND 50
        ),
    ADD CONSTRAINT niveles_orden_positivo CHECK (orden > 0);

CREATE UNIQUE INDEX idx_niveles_orden ON public.niveles (orden);

-- `idx_niveles_nombre_normalizado`, creado por 003, continúa siendo la única
-- autoridad para la unicidad sin distinguir mayúsculas/minúsculas.

-- Secuencia independiente del id: reserva posiciones en saltos de diez y hace
-- que dos altas concurrentes nunca calculen el mismo orden.
CREATE SEQUENCE app_private.niveles_orden_seq
    AS INTEGER
    INCREMENT BY 10
    MINVALUE 10
    START WITH 10;

SELECT pg_catalog.setval(
    'app_private.niveles_orden_seq'::pg_catalog.regclass,
    (SELECT pg_catalog.max(orden) FROM public.niveles),
    TRUE
);

REVOKE ALL ON SEQUENCE app_private.niveles_orden_seq
    FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 2. INVARIANTES DE ACTUALIZACIÓN
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.proteger_nivel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.es_institucional IS DISTINCT FROM OLD.es_institucional THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5502',
            MESSAGE = 'No se puede modificar la protección institucional del nivel.';
    END IF;

    IF NEW.orden IS DISTINCT FROM OLD.orden THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5502',
            MESSAGE = 'No se puede modificar el orden asignado al nivel.';
    END IF;

    IF OLD.es_institucional AND NEW.nombre IS DISTINCT FROM OLD.nombre THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5502',
            MESSAGE = 'Los niveles institucionales no pueden renombrarse.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_nivel() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER proteger_nivel_antes_de_actualizar
    BEFORE UPDATE ON public.niveles
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_nivel();

-- ================================================================
-- 3. OPERACIONES PRIVADAS
-- ================================================================
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

    IF p_nombre IS NULL
       OR p_nombre <> pg_catalog.btrim(p_nombre)
       OR pg_catalog.char_length(p_nombre) NOT BETWEEN 1 AND 50 THEN
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

    IF p_nombre IS NULL
       OR p_nombre <> pg_catalog.btrim(p_nombre)
       OR pg_catalog.char_length(p_nombre) NOT BETWEEN 1 AND 50 THEN
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

CREATE OR REPLACE FUNCTION app_private.cambiar_estado_nivel(
    p_nivel_id INTEGER,
    p_activo BOOLEAN
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
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede cambiar el estado de niveles.';
    END IF;

    IF p_activo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5501', MESSAGE = 'El estado del nivel no es válido.';
    END IF;

    UPDATE public.niveles
    SET activo = p_activo
    WHERE id = p_nivel_id
    RETURNING * INTO nivel_actual;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El nivel solicitado no existe.';
    END IF;

    RETURN nivel_actual;
END;
$$;

-- El wrapper SECURITY INVOKER necesita poder entrar al esquema privado y
-- ejecutar únicamente estas operaciones; app_private no está expuesto por la
-- Data API. Cada función vuelve a validar auth.uid() y el rol DIRECTOR.
REVOKE ALL ON FUNCTION app_private.crear_nivel(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.renombrar_nivel(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.cambiar_estado_nivel(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app_private.crear_nivel(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.renombrar_nivel(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_estado_nivel(INTEGER, BOOLEAN) TO authenticated;

-- ================================================================
-- 4. WRAPPERS PÚBLICOS PARA POSTGREST
-- ================================================================
CREATE OR REPLACE FUNCTION public.crear_nivel(p_nombre TEXT)
RETURNS public.niveles
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.crear_nivel(p_nombre);
$$;

CREATE OR REPLACE FUNCTION public.renombrar_nivel(
    p_nivel_id INTEGER,
    p_nombre TEXT
)
RETURNS public.niveles
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.renombrar_nivel(p_nivel_id, p_nombre);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_nivel(
    p_nivel_id INTEGER,
    p_activo BOOLEAN
)
RETURNS public.niveles
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_estado_nivel(p_nivel_id, p_activo);
$$;

REVOKE ALL ON FUNCTION public.crear_nivel(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renombrar_nivel(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cambiar_estado_nivel(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_nivel(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renombrar_nivel(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_nivel(INTEGER, BOOLEAN) TO authenticated;

-- ================================================================
-- 5. SOLO NIVELES ACTIVOS EN NUEVAS ASIGNACIONES DE CURSOS
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
    -- Una actualización histórica que conserva el nivel no crea una asignación
    -- nueva y debe seguir siendo válida aunque ese nivel esté inactivo.
    IF TG_OP = 'UPDATE' AND NEW.nivel_id IS NOT DISTINCT FROM OLD.nivel_id THEN
        RETURN NEW;
    END IF;

    SELECT activo
    INTO nivel_activo
    FROM public.niveles
    WHERE id = NEW.nivel_id;

    IF FOUND AND NOT nivel_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5504',
            MESSAGE = 'Solo pueden asignarse niveles activos a cursos nuevos.';
    END IF;

    -- Si el id no existe, la clave foránea conserva su SQLSTATE 23503.
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_nivel_activo_curso()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validar_nivel_activo_en_curso
    BEFORE INSERT OR UPDATE OF nivel_id ON public.cursos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_nivel_activo_curso();

-- ================================================================
-- 6. PRIVILEGIOS Y RLS PRESERVADOS
-- ================================================================
ALTER TABLE public.niveles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.niveles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.niveles TO authenticated;

REVOKE ALL ON SEQUENCE public.niveles_id_seq FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Niveles visibles para usuarios autenticados" ON public.niveles;
CREATE POLICY "Niveles visibles para usuarios autenticados" ON public.niveles
    FOR SELECT TO authenticated USING (TRUE);

-- No se crea función, grant ni política DELETE. Las escrituras directas sobre
-- niveles continúan cerradas para todos los roles de aplicación.
