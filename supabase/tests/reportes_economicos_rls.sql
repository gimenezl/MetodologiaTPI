-- Contrato estructural real, exclusivamente después de reset local descartable.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE f REGPROCEDURE := 'public.reporte_economico(text,date,date,jsonb,integer,integer,text)'::REGPROCEDURE;
BEGIN
  IF (SELECT prosecdef OR provolatile<>'s' OR NOT proconfig @> ARRAY['search_path=""','plan_cache_mode=force_custom_plan'] FROM pg_proc WHERE oid=f) THEN
    RAISE EXCEPTION 'EPT112: la RPC debe ser STABLE, INVOKER y search_path vacío';
  END IF;
  IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('service_role',f,'EXECUTE')
     OR NOT has_function_privilege('authenticated',f,'EXECUTE') THEN
    RAISE EXCEPTION 'EPT112: ACL de la RPC incorrecta';
  END IF;
  IF (SELECT array_to_string(proargnames,',') FROM pg_proc WHERE oid=f) ~ '(actor|user|rol)' THEN
    RAISE EXCEPTION 'EPT112: ningún actor puede provenir del cliente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.estado_cuotas_alumno'::regclass
      AND reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION 'EPT112: fuente económica sin RLS';
  END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.reporte_economico('desconocido',NULL,NULL);
    RAISE EXCEPTION 'EPT112: identidad ausente no rechazada';
  EXCEPTION WHEN SQLSTATE 'P5505' THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK EPT112: ACL, INVOKER, STABLE, fuente RLS e identidad antes de parámetros';
END $$;
ROLLBACK;
