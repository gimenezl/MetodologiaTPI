-- EPT-59: inspección productiva de solo lectura antes de publicar la migración.
-- Ejecutar con un rol autorizado para consultar auth.users y el historial.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT current_database() AS base,
       current_user AS actor,
       current_setting('server_version') AS postgres_version;

SELECT version
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 4;

SELECT has_table_privilege('postgres', 'auth.users', 'SELECT') AS postgres_lee_auth_users,
       ARRAY['deleted_at', 'banned_until', 'email_confirmed_at', 'is_anonymous']
         <@ ARRAY(
           SELECT column_name::text
           FROM information_schema.columns
           WHERE table_schema = 'auth' AND table_name = 'users'
         ) AS columnas_auth_presentes;

SELECT to_regclass('public.perfiles') IS NOT NULL AS perfiles,
       to_regclass('public.profesores') IS NOT NULL AS profesores,
       to_regclass('public.materias_cursos') IS NOT NULL AS materias_cursos,
       to_regclass('public.grupos_deportivos') IS NOT NULL AS grupos_deportivos,
       to_regprocedure('app_private.es_director()') IS NOT NULL AS es_director,
       to_regprocedure('app_private.normalizar_especialidad(text)') IS NOT NULL AS especialidad,
       to_regprocedure('extensions.crypt(text,text)') IS NOT NULL AS crypt,
       to_regtype('public.estado_acceso') IS NULL AS ept59_sin_aplicar;

SELECT policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'perfiles'
  AND policyname IN ('Solo Dirección ve todos los perfiles',
                     'Solo directores insertan perfiles')
ORDER BY policyname;

SELECT count(*) FILTER (WHERE r.nombre = 'DIRECTOR'
                         AND u.id IS NOT NULL
                         AND u.deleted_at IS NULL
                         AND (u.banned_until IS NULL OR u.banned_until <= now())
                         AND u.email_confirmed_at IS NOT NULL
                         AND coalesce(u.is_anonymous, false) = false) AS directores_efectivos,
       count(*) FILTER (WHERE p.user_id IS NOT NULL AND u.id IS NULL) AS perfiles_huerfanos,
       count(*) FILTER (WHERE p.rol_id IS NULL) AS perfiles_sin_rol
FROM public.perfiles p
LEFT JOIN public.roles r ON r.id = p.rol_id
LEFT JOIN auth.users u ON u.id = p.user_id;

COMMIT;
