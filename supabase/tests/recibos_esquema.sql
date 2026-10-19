-- EPT-113. Contrato estructural real, sin datos productivos ni fixtures persistentes.
BEGIN;
DO $$
DECLARE firma TEXT;
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='app_private.recibos_fuente'::REGCLASS) THEN RAISE EXCEPTION 'Fuente privada sin RLS';END IF;
 IF pg_catalog.has_table_privilege('authenticated','app_private.recibos_fuente','SELECT') OR pg_catalog.has_table_privilege('anon','app_private.recibos_fuente','SELECT') THEN RAISE EXCEPTION 'Fuente expuesta';END IF;
 IF pg_catalog.has_sequence_privilege('authenticated','app_private.recibos_numero_seq','USAGE') OR pg_catalog.has_sequence_privilege('service_role','app_private.recibos_numero_seq','USAGE') THEN RAISE EXCEPTION 'Secuencia expuesta';END IF;
 IF pg_catalog.has_column_privilege('authenticated','public.recibos','archivo_path','SELECT') OR pg_catalog.has_table_privilege('authenticated','public.recibos','INSERT') THEN RAISE EXCEPTION 'Metadatos inseguros';END IF;
 FOREACH firma IN ARRAY ARRAY['public.consultar_recibo(uuid)','public.recuperar_recibo(uuid)'] LOOP
  IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid=firma::REGPROCEDURE) OR NOT pg_catalog.has_function_privilege('authenticated',firma::REGPROCEDURE,'EXECUTE') OR pg_catalog.has_function_privilege('anon',firma::REGPROCEDURE,'EXECUTE') OR pg_catalog.has_function_privilege('service_role',firma::REGPROCEDURE,'EXECUTE') THEN RAISE EXCEPTION 'ACL o wrapper inseguro: %',firma; END IF;
 END LOOP;
 IF pg_catalog.has_function_privilege('authenticated','app_private.emitir_recibo_bajo_bloqueo(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Auxiliar expuesto'; END IF;
 RAISE NOTICE 'EPT-113: RLS privada, privilegios mínimos, secuencia cerrada y wrappers invoker verificados';
END;
$$;
ROLLBACK;
