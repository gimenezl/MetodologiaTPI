-- ============================================================
-- EPT-58 — R-A: compensación NO destructiva de la migración A
-- ============================================================
-- BORRADOR REVISABLE. No está en `supabase/migrations` a propósito: solo se
-- convierte en una migración nueva (con marca de tiempo posterior a la última
-- aplicada) si, después de revisar el incidente, revertir la aplicación y la
-- política no alcanza y hay que neutralizar el comportamiento de A.
--
-- Qué hace:
--   * Retira los triggers de A que cambian el comportamiento de escrituras
--     existentes: la guarda de profesor activo en asignaciones y grupos y el
--     alta automática de fichas.
--   * Deja dormida la superficie pública de A (sin EXECUTE para authenticated).
--
-- Qué NO hace, por la condición aprobada del contrato:
--   * No borra fichas ni historial, no elimina tablas ni columnas y no cambia
--     ninguna fila. Tampoco quita la FK RESTRICT ni la guarda de solo agregado
--     del historial: son las que protegen esos datos.
--   * No reescribe la migración A, que queda aplicada en el historial.
--
-- Precondiciones:
--   1. B no está aplicada (la política amplia de perfiles existe). Con B
--      aplicada, primero se compensa B (R-B).
--   2. La aplicación publicada no usa las funciones de A (versión anterior a
--      la etapa 2). Retirar A con la aplicación de etapa 2 publicada la rompe.
--   3. Respaldo previo fuera del repositorio, por ejemplo:
--        pg_dump --data-only --table=public.profesores \
--                --table=public.profesores_estados_historial > respaldo-ept58.sql
--
-- Volver a habilitar A más tarde exige otra migración nueva que recree los
-- triggers y haga el backfill de los DOCENTE creados mientras tanto
-- (INSERT … ON CONFLICT DO NOTHING); las fichas conservadas no se tocan.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Directores y docentes ven todos los perfiles'
    ) THEN
        RAISE EXCEPTION 'R-A: la migración B sigue aplicada. Compensá B (R-B) antes de tratar A.';
    END IF;

    IF pg_catalog.to_regclass('public.profesores') IS NULL
       OR pg_catalog.to_regclass('public.profesores_estados_historial') IS NULL THEN
        RAISE EXCEPTION 'R-A: la migración A no está aplicada; no hay nada que compensar.';
    END IF;
END $$;

-- Huella completa de los datos que deben sobrevivir.
CREATE TEMPORARY TABLE ept58_ra_huellas (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept58_ra_huellas (relacion, cantidad, huella)
VALUES
    ('profesores',
        (SELECT pg_catalog.count(*) FROM public.profesores),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion),
             ';' ORDER BY perfil_id), ''))
         FROM public.profesores)),
    ('profesores_estados_historial',
        (SELECT pg_catalog.count(*) FROM public.profesores_estados_historial),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, profesor_id, estado_anterior, estado_nuevo, motivo, actor_id, fecha),
             ';' ORDER BY id), ''))
         FROM public.profesores_estados_historial));

-- 1. Comportamiento retirado.
DROP TRIGGER IF EXISTS a_exigir_profesor_activo ON public.materias_cursos;
DROP TRIGGER IF EXISTS a_exigir_profesor_activo ON public.grupos_deportivos;
DROP TRIGGER IF EXISTS registrar_profesor_al_crear_perfil ON public.perfiles;

-- 2. Superficie pública dormida. Las funciones se conservan para poder
--    rehabilitarlas sin reescribirlas.
REVOKE EXECUTE ON FUNCTION public.listar_profesores() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.consultar_ficha_profesor(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.listar_asignaciones_profesor(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.listar_horarios_profesor(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.listar_historial_estados_profesor(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.listar_estudiantes_para_gestion() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.actualizar_ficha_profesor(UUID, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cambiar_estado_profesor(UUID, TEXT, TEXT) FROM authenticated;

-- 3. Autoverificación: los datos quedan idénticos y protegidos.
DO $$
DECLARE
    v_fila RECORD;
    v_cantidad BIGINT;
    v_huella TEXT;
BEGIN
    SELECT pg_catalog.count(*),
           pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion),
               ';' ORDER BY perfil_id), ''))
    INTO v_cantidad, v_huella
    FROM public.profesores;
    SELECT * INTO v_fila FROM ept58_ra_huellas WHERE relacion = 'profesores';
    IF v_cantidad <> v_fila.cantidad OR v_huella <> v_fila.huella THEN
        RAISE EXCEPTION 'R-A: cambiaron las fichas de profesores.';
    END IF;

    SELECT pg_catalog.count(*),
           pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, profesor_id, estado_anterior, estado_nuevo, motivo, actor_id, fecha),
               ';' ORDER BY id), ''))
    INTO v_cantidad, v_huella
    FROM public.profesores_estados_historial;
    SELECT * INTO v_fila FROM ept58_ra_huellas WHERE relacion = 'profesores_estados_historial';
    IF v_cantidad <> v_fila.cantidad OR v_huella <> v_fila.huella THEN
        RAISE EXCEPTION 'R-A: cambió el historial de estados.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'profesores_perfil_id_fkey' AND confdeltype = 'r'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.profesores_estados_historial'::regclass
          AND tgname = 'impedir_modificar_historial_profesor'
    ) THEN
        RAISE EXCEPTION 'R-A: se perdió una protección de los datos conservados.';
    END IF;

    RAISE NOTICE 'R-A: % ficha(s) y % fila(s) de historial conservadas sin cambios.',
        (SELECT cantidad FROM ept58_ra_huellas WHERE relacion = 'profesores'),
        (SELECT cantidad FROM ept58_ra_huellas WHERE relacion = 'profesores_estados_historial');
END $$;
