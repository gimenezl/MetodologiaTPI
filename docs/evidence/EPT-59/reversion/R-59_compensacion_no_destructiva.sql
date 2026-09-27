-- ============================================================
-- EPT-59 — R-59: compensación NO destructiva de la migración de usuarios
-- ============================================================
-- BORRADOR REVISABLE. No está en `supabase/migrations` a propósito: solo se
-- convierte en una migración nueva (con marca de tiempo posterior a la última
-- aplicada) si, después de revisar el incidente, volver a la versión anterior
-- de la aplicación no alcanza y hay que apagar las funciones nuevas en la base.
--
-- Qué hace:
--   * Deja dormida la administración nueva: sin EXECUTE para `authenticated`
--     en cambio de rol, cambio de acceso, listados de Dirección y reservas D5,
--     ni para `service_role` en el desafío y el enlace.
--   * Retira el trigger de enlace D5 sobre `auth.users` (ninguna cuenta nueva
--     puede vincularse a un perfil existente mientras dure la reversión).
--   * Cierra las reservas PENDIENTES (estado CANCELADA, motivo registrado) y
--     anula sus desafíos. No borra ninguna fila.
--
-- Qué NO hace, por las condiciones aprobadas del contrato:
--   * NO reabre el acceso a identidades BLOQUEADAS: se conservan la columna
--     `estado_acceso`, los auxiliares que ignoran perfiles bloqueados y las
--     políticas RESTRICTIVE. Revertir eso devolvería datos a JWT previos.
--   * No borra historial ni reservas, no elimina tablas, columnas ni tipos, y
--     no restituye la política de INSERT anterior (seguiría permitiendo perfiles
--     con cuenta o con rol DIRECTOR). Tampoco devuelve TRUNCATE a nadie.
--   * No revierte la regla de 010 que impide adoptar perfiles huérfanos.
--   * No reescribe la migración, que queda aplicada en el historial.
--
-- Precondiciones:
--   1. La aplicación publicada es anterior a la administración de EPT-59
--      (por ejemplo, la frontera 1 `0e3f615`), probada contra la base con la
--      migración aplicada. Con la aplicación nueva publicada, apagar estas
--      funciones deja la pantalla de Usuarios sin datos.
--   2. Antes de revertir, Dirección reactiva a quien corresponda: durante la
--      reversión nadie puede reactivar desde la aplicación. Una reactivación de
--      emergencia exige una intervención de base registrada en
--      `perfiles_historial` (tipo ACCESO, con actor y motivo).
--   3. Respaldo previo fuera del repositorio, por ejemplo:
--        pg_dump --data-only --table=public.perfiles_historial \
--                --table=app_private.vinculos_cuenta > respaldo-ept59.sql
--
-- Volver a habilitar EPT-59 exige otra migración nueva que restituya los
-- GRANT y el trigger de enlace; el historial y las reservas se conservan.
-- ============================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.perfiles_historial') IS NULL
       OR to_regclass('app_private.vinculos_cuenta') IS NULL THEN
        RAISE EXCEPTION 'R-59: la migración de EPT-59 no está aplicada; no hay nada que compensar.';
    END IF;
END $$;

-- 1. Superficie administrativa dormida.
REVOKE EXECUTE ON FUNCTION public.cambiar_rol_perfil(UUID, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cambiar_acceso_perfil(UUID, public.estado_acceso, public.estado_acceso, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.estado_acceso_de(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.listar_usuarios(TEXT, INTEGER, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.consultar_usuario(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.listar_historial_usuario(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reservar_vinculo_cuenta(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.consultar_vinculo(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cancelar_vinculo(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.emitir_desafio_vinculo(UUID, UUID, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.anular_desafio_vinculo(UUID, UUID) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.verificar_desafio_vinculo(UUID, UUID, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.datos_para_enlace(UUID, UUID) FROM service_role;

-- 2. Sin enlace de cuentas nuevas a perfiles existentes.
DROP TRIGGER IF EXISTS enlazar_perfil_al_crear_cuenta ON auth.users;

-- 3. Reservas pendientes cerradas, sin borrar.
UPDATE app_private.vinculos_cuenta
SET estado = 'CANCELADA',
    desafio_hash = NULL,
    cerrada_motivo = 'Reversión R-59: vínculo de cuentas deshabilitado'
WHERE estado = 'PENDIENTE';

-- 4. Autoverificación: la reversión no reabrió nada.
DO $$
BEGIN
    IF has_function_privilege('authenticated', 'public.cambiar_acceso_perfil(uuid, public.estado_acceso, public.estado_acceso, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'R-59: authenticated conserva EXECUTE sobre cambiar_acceso_perfil.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
          AND policyname LIKE 'Bloqueo de acceso sin datos protegidos%'
    ) THEN
        RAISE EXCEPTION 'R-59: desaparecieron las políticas de bloqueo; la reversión no debe tocarlas.';
    END IF;
    IF pg_catalog.pg_get_functiondef('app_private.rol_actual()'::regprocedure) NOT LIKE '%estado_acceso%' THEN
        RAISE EXCEPTION 'R-59: rol_actual() dejó de ignorar perfiles bloqueados.';
    END IF;
    IF EXISTS (SELECT 1 FROM app_private.vinculos_cuenta WHERE estado = 'PENDIENTE') THEN
        RAISE EXCEPTION 'R-59: quedó una reserva pendiente.';
    END IF;
END $$;

COMMIT;
