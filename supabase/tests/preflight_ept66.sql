-- EPT-66: inspección productiva de SOLO LECTURA antes de aplicar cada migración
-- (expansión 20261002120000 y contracción 20261002130000).
--
--     psql "$CONEXION" -v ON_ERROR_STOP=1 -f supabase/tests/preflight_ept66.sql
--
-- Solo devuelve AGREGADOS y nombres de objetos: ninguna identidad, ningún dato
-- personal. La transacción es de solo lectura. Ejecutar con un rol que pueda leer
-- el historial de migraciones y los catálogos.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT current_database() AS base,
       current_user AS actor,
       current_setting('server_version') AS postgres_version;

-- 1. Historial: antes de la expansión deben figurar 27 migraciones hasta
--    20261001165229; antes de la contracción, 28 hasta 20261002120000.
SELECT count(*) AS migraciones_aplicadas,
       max(version) AS ultima_version
FROM supabase_migrations.schema_migrations;

SELECT version
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 3;

-- 2. En qué fase está la base.
SELECT EXISTS (SELECT 1 FROM pg_indexes
               WHERE schemaname = 'public' AND indexname = 'idx_inscripciones_una_activa') AS indice_unico_parcial,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'inscripciones'
                 AND column_name = 'fecha_baja') AS columna_fecha_baja,
       to_regprocedure('public.inscribir_actividad_legada(uuid,integer)') IS NOT NULL AS funciones_expansion,
       EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = 'inscripciones'
                 AND policyname = 'Dirección consulta las inscripciones') AS contraccion_aplicada;

-- 3. Datos de `inscripciones`: conteos por estado (agregados) y duplicados que
--    impedirían el índice único parcial (debe ser 0).
SELECT count(*) AS filas,
       count(*) FILTER (WHERE estado = 'ACTIVO') AS activas,
       count(*) FILTER (WHERE estado = 'BAJA') AS bajas
FROM public.inscripciones;

SELECT count(*) AS pares_activos_duplicados
FROM (SELECT estudiante_id, actividad_id
      FROM public.inscripciones
      WHERE estado = 'ACTIVO'
      GROUP BY estudiante_id, actividad_id
      HAVING count(*) > 1) d;

-- Relaciones íntegras (cada fila apunta a un perfil y a una actividad existentes).
SELECT count(*) AS filas_con_relaciones_integras
FROM public.inscripciones i
JOIN public.perfiles p ON p.id = i.estudiante_id
JOIN public.actividades a ON a.id = i.actividad_id;

-- 4. Restricciones, políticas y triggers actuales de `inscripciones`.
SELECT conname AS restriccion
FROM pg_constraint
WHERE conrelid = 'public.inscripciones'::regclass
ORDER BY conname;

SELECT policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'inscripciones'
ORDER BY policyname;

SELECT tgname AS trigger, tgenabled AS habilitado
FROM pg_trigger
WHERE tgrelid = 'public.inscripciones'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- 5. Privilegios de tabla (solo los que importan a EPT-66).
SELECT t.tabla, r.rol,
       string_agg(p.privilegio, ',' ORDER BY p.privilegio) AS privilegios
FROM (VALUES ('public.inscripciones'), ('public.galeria'),
             ('public.menu_escolar'), ('public.noticias')) AS t(tabla)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rol)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilegio)
WHERE has_table_privilege(r.rol, t.tabla, p.privilegio)
GROUP BY t.tabla, r.rol
ORDER BY t.tabla, r.rol;

-- 6. Privilegios por defecto del rol que ejecuta las migraciones.
SELECT d.defaclobjtype AS tipo,
       a.grantee::regrole AS destinatario,
       string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privilegios
FROM pg_default_acl d
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclnamespace = 'public'::regnamespace
GROUP BY d.defaclobjtype, a.grantee
ORDER BY d.defaclobjtype, destinatario;

-- 7. Funciones endurecidas por EPT-66: search_path y EXECUTE.
SELECT p.oid::regprocedure AS funcion,
       coalesce(p.proconfig::text, '(sin search_path)') AS configuracion,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_ejecuta
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('calcular_porcentaje_asistencia', 'verificar_cupo_actividad')
ORDER BY 1;

COMMIT;
