-- EPT-58, etapa 3 (B): cerrar la lectura global de perfiles para DOCENTE.
-- Aplicar solo después de publicar y verificar la aplicación de la etapa 2.
-- No modifica fichas, historial, permisos de escritura ni otras políticas.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Directores y docentes ven todos los perfiles'
          AND cmd = 'SELECT'
    ) THEN
        RAISE EXCEPTION 'EPT-58 B: falta la política amplia de 005; revisar deriva antes de aplicar.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Perfil propio' AND cmd = 'SELECT'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Padres ven perfiles de sus hijos' AND cmd = 'SELECT'
    ) THEN
        RAISE EXCEPTION 'EPT-58 B: faltan políticas de perfil propio o vínculo parental; no aplicar a ciegas.';
    END IF;
END $$;

DROP POLICY "Directores y docentes ven todos los perfiles" ON public.perfiles;

-- rol_actual() vive en app_private, es SECURITY DEFINER y no recibe un id
-- suministrado por el cliente: evita 42P17 al no consultar perfiles bajo RLS.
CREATE POLICY "Solo Dirección ve todos los perfiles" ON public.perfiles
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'DIRECTOR');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Directores y docentes ven todos los perfiles'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Solo Dirección ve todos los perfiles'
          AND cmd = 'SELECT'
          AND roles = ARRAY['authenticated']::name[]
    ) THEN
        RAISE EXCEPTION 'EPT-58 B: la política final no coincide con el contrato.';
    END IF;
END $$;

COMMIT;
