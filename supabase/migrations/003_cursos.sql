-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Administración de cursos (EPT-8 / EPT-14 / EPT-17)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 ni 002.
--
-- Reglas de negocio implementadas en la base:
--   * Un curso se identifica por denominación + división dentro de un nivel.
--     La combinación es única después de normalizar (mayúsculas + recorte de
--     espacios laterales), por lo que ni el uso de mayúsculas/minúsculas ni los
--     espacios al inicio o al final permiten evadir la restricción.
--   * El nivel referenciado se protege con ON DELETE RESTRICT: no se puede
--     borrar un nivel que tenga cursos.
--   * La baja de un curso es lógica (columna `activo`). No existe ninguna
--     operación DELETE habilitada para los roles de aplicación, de modo que las
--     filas y sus relaciones se conservan.
--   * Solo el DIRECTOR puede crear o modificar cursos. Se verifica en RLS,
--     además del control del lado del servidor.
-- ============================================================

-- ================================================================
-- 1. ESQUEMA PRIVADO PARA LÓGICA DE AUTORIZACIÓN
-- ================================================================
-- El esquema `app_private` no se expone en la Data API. Alojar aquí la función
-- SECURITY DEFINER evita dos problemas:
--   a) La recursión infinita de RLS: `perfiles` tiene una política que consulta
--      `perfiles`, por lo que cualquier política que lea esa tabla en forma
--      directa fallaría con SQLSTATE 42P17. La función SECURITY DEFINER lee
--      `perfiles` sin activar sus políticas.
--   b) El costo por fila: la función se evalúa una sola vez cuando se envuelve
--      en un SELECT dentro de la política.
CREATE SCHEMA IF NOT EXISTS app_private;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;

-- Devuelve true solo si el usuario de la sesión actual tiene el rol DIRECTOR.
-- No recibe parámetros: el llamador no puede influir en el resultado.
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
    );
$$;

REVOKE ALL ON FUNCTION app_private.es_director() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.es_director() TO authenticated;

-- Punto de entrada único para la aplicación y para las políticas RLS.
-- Es SECURITY INVOKER: la lógica privilegiada queda contenida en app_private.
CREATE OR REPLACE FUNCTION public.es_director_actual()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.es_director();
$$;

REVOKE ALL ON FUNCTION public.es_director_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.es_director_actual() TO authenticated;

-- ================================================================
-- 2. ENDURECIMIENTO MÍNIMO DE NIVELES
-- ================================================================
-- Alcance deliberadamente acotado: unicidad normalizada, referencias seguras
-- desde cursos, lectura para la interfaz y compatibilidad con RLS.
-- La administración completa de niveles es una tarea aparte (EPT-55).

-- La migración 001 sembró niveles con `ON CONFLICT DO NOTHING` sin ninguna
-- restricción única, por lo que una base ya poblada podría tener duplicados.
-- Se falla con un mensaje accionable antes de intentar crear el índice.
DO $$
DECLARE
    duplicados TEXT;
BEGIN
    SELECT string_agg(nombre_normalizado, ', ')
    INTO duplicados
    FROM (
        SELECT UPPER(BTRIM(nombre)) AS nombre_normalizado
        FROM public.niveles
        GROUP BY UPPER(BTRIM(nombre))
        HAVING COUNT(*) > 1
    ) AS d;

    IF duplicados IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede aplicar la unicidad de niveles: existen nombres duplicados (%). Unificá esos niveles y volvé a aplicar la migración.',
            duplicados;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_niveles_nombre_normalizado
    ON public.niveles (UPPER(BTRIM(nombre)));

ALTER TABLE public.niveles ENABLE ROW LEVEL SECURITY;

-- La interfaz de cursos necesita listar los niveles para el selector.
DROP POLICY IF EXISTS "Niveles visibles para usuarios autenticados" ON public.niveles;
CREATE POLICY "Niveles visibles para usuarios autenticados" ON public.niveles
    FOR SELECT TO authenticated USING (true);

-- 001 otorgó `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated`, lo que
-- incluyó a niveles. Se reduce a solo lectura: así ningún rol de aplicación
-- puede borrar un nivel referenciado por un curso.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.niveles FROM authenticated;
GRANT SELECT ON public.niveles TO authenticated;

-- ================================================================
-- 3. CURSOS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.cursos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nivel_id INTEGER NOT NULL REFERENCES public.niveles(id) ON DELETE RESTRICT,
    denominacion VARCHAR(100) NOT NULL,
    division VARCHAR(20) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Las filas se guardan siempre recortadas y no vacías, de modo que el valor
    -- almacenado coincide con el que se normaliza para la unicidad.
    CONSTRAINT cursos_denominacion_valida
        CHECK (denominacion = BTRIM(denominacion) AND LENGTH(denominacion) > 0),
    CONSTRAINT cursos_division_valida
        CHECK (division = BTRIM(division) AND LENGTH(division) > 0)
);

-- Unicidad normalizada de denominación + división dentro del nivel.
-- Se aplica a todas las filas, activas e inactivas: el criterio de aceptación 4
-- no admite excepciones, y así un registro histórico nunca queda ambiguo.
-- `nivel_id` es la primera columna, por lo que este índice también sirve como
-- índice de la clave foránea hacia niveles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cursos_nivel_denominacion_division
    ON public.cursos (nivel_id, UPPER(BTRIM(denominacion)), UPPER(BTRIM(division)));

-- No se agregan más índices: el volumen es de decenas de filas y no hay otra
-- ruta de consulta demostrada. El listado ordena en memoria sobre ese conjunto.

-- ================================================================
-- 4. SEGURIDAD DE CURSOS: PRIVILEGIOS MÍNIMOS + RLS
-- ================================================================
ALTER TABLE public.cursos ENABLE ROW LEVEL SECURITY;

-- `GRANT ALL ON ALL TABLES` de 001 fue una instantánea: no alcanza a esta tabla
-- nueva. Se parte de cero y se otorga solo lo necesario.
REVOKE ALL ON public.cursos FROM PUBLIC;
REVOKE ALL ON public.cursos FROM anon;
REVOKE ALL ON public.cursos FROM authenticated;

-- Sin DELETE y sin TRUNCATE: la baja es lógica. `anon` no recibe ningún permiso.
GRANT SELECT, INSERT, UPDATE ON public.cursos TO authenticated;

-- Lectura: cualquier usuario autenticado ve el catálogo de cursos, igual que ya
-- ocurre con niveles y actividades. `anon` queda excluido por falta de GRANT y
-- por ausencia de política.
DROP POLICY IF EXISTS "Cursos visibles para usuarios autenticados" ON public.cursos;
CREATE POLICY "Cursos visibles para usuarios autenticados" ON public.cursos
    FOR SELECT TO authenticated USING (true);

-- Alta: solo DIRECTOR.
DROP POLICY IF EXISTS "Solo el director crea cursos" ON public.cursos;
CREATE POLICY "Solo el director crea cursos" ON public.cursos
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.es_director_actual()));

-- Modificación e inactivación: solo DIRECTOR. `USING` filtra las filas que puede
-- alcanzar y `WITH CHECK` valida el resultado, por lo que no puede escapar de su
-- propio permiso al actualizar.
DROP POLICY IF EXISTS "Solo el director modifica cursos" ON public.cursos;
CREATE POLICY "Solo el director modifica cursos" ON public.cursos
    FOR UPDATE TO authenticated
    USING ((SELECT public.es_director_actual()))
    WITH CHECK ((SELECT public.es_director_actual()));

-- No se crea ninguna política FOR DELETE. Incluso si en el futuro alguien
-- otorgara el privilegio por error, RLS seguiría rechazando el borrado.
