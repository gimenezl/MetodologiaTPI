-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Quitar la recursión de las políticas de perfiles
-- ============================================================
-- Migración correctiva aditiva. No modifica 001, 002, 003 ni 004.
--
-- ============================================================
-- QUÉ PROBLEMA CIERRA
-- ============================================================
-- La política `"Directores y docentes ven todos los perfiles"` de la migración
-- 001 es una política SOBRE `perfiles` que consulta `perfiles`:
--
--     CREATE POLICY "Directores y docentes ven todos los perfiles" ON perfiles
--         FOR SELECT USING (
--             EXISTS (SELECT 1 FROM perfiles p JOIN roles r ON p.rol_id = r.id
--                     WHERE p.user_id = auth.uid() AND r.nombre IN (...))
--         );
--
-- PostgreSQL detecta la recursión y aborta. Verificado sobre una base local
-- reconstruida desde cero con la cadena 001→004:
--
--     SELECT 1 FROM public.perfiles LIMIT 1;
--     -- ERROR 42P17: infinite recursion detected in policy for relation "perfiles"
--
-- El efecto no es teórico. `src/context/AuthContext.tsx` hace exactamente esa
-- lectura para resolver el rol del usuario en cada carga del panel, así que
-- sobre una base construida desde las migraciones del repositorio **ningún
-- usuario autenticado puede cargar su perfil**: `rol` queda en null y todo el
-- panel responde «Acceso restringido». La misma recursión alcanza a las
-- políticas de `asistencias`, `solicitudes_inscripcion` y `postulaciones`, que
-- también consultan `perfiles`.
--
-- ============================================================
-- POR QUÉ SE ARREGLA ACÁ
-- ============================================================
-- Esta corrección está en el camino crítico de EPT-8: sin ella, la pantalla
-- `/dashboard/cursos` es inalcanzable para un director real y el criterio de
-- aceptación 5 no se puede demostrar en un navegador. No es una mejora
-- oportunista: es lo mínimo para que la historia sea usable y verificable.
--
-- El alcance está deliberadamente acotado. **No** se rediseña el modelo de
-- roles ni de perfiles, no se agregan políticas nuevas de UPDATE o DELETE, y no
-- se cambia quién puede ver qué. Se reemplaza la expresión recursiva por una
-- llamada a una función SECURITY DEFINER, conservando exactamente el mismo
-- criterio: el propio perfil siempre, y todos los perfiles para DIRECTOR y
-- DOCENTE. Que esto también destrabe `asistencias`, `solicitudes_inscripcion` y
-- `postulaciones` es una consecuencia inevitable de quitar la recursión, no una
-- ampliación de alcance.
--
-- La revisión del modelo de roles y del resto de la deriva sigue siendo de
-- EPT-66.
-- ============================================================

-- ================================================================
-- 1. ROL DEL USUARIO ACTUAL, SIN ACTIVAR RLS DE PERFILES
-- ================================================================
-- Vive en `app_private`, que la Data API no expone, igual que
-- `app_private.es_director()` de la migración 003. No recibe parámetros: quien
-- llama no puede elegir qué usuario se inspecciona.
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
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_private.rol_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.rol_actual() TO authenticated;

-- ================================================================
-- 2. POLÍTICAS DE PERFILES EQUIVALENTES, PERO SIN RECURSIÓN
-- ================================================================
-- Mismo criterio que 001, otra implementación.
DROP POLICY IF EXISTS "Directores y docentes ven todos los perfiles" ON public.perfiles;
CREATE POLICY "Directores y docentes ven todos los perfiles" ON public.perfiles
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) IN ('DIRECTOR', 'DOCENTE'));

DROP POLICY IF EXISTS "Solo directores insertan perfiles" ON public.perfiles;
CREATE POLICY "Solo directores insertan perfiles" ON public.perfiles
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT app_private.rol_actual()) = 'DIRECTOR');

-- La política "Perfil propio" de 001 no se toca: `auth.uid() = user_id` nunca
-- fue recursiva y sigue siendo la que permite a cada usuario ver su legajo.

-- ================================================================
-- 3. LO QUE SIGUE SIN EXISTIR, A PROPÓSITO
-- ================================================================
-- `perfiles` continúa sin políticas de UPDATE ni de DELETE, así que RLS sigue
-- denegando que un usuario se reasigne el rol o borre legajos, exactamente como
-- antes de esta migración. Definir esas políticas es trabajo de EPT-59.
