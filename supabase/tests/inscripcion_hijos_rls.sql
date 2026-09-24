-- Prueba transaccional sobre la base local descartable. Nunca confirma datos.
BEGIN;

INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT 'eeeeeeee-1300-4000-8000-000000000001', 'eeeeeeee-1300-4000-8000-000000000011', id, 'Padre', 'Primero', '99813001', NULL
FROM public.roles WHERE nombre = 'PADRE';
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT 'eeeeeeee-1300-4000-8000-000000000002', 'eeeeeeee-1300-4000-8000-000000000012', id, 'Padre', 'Segundo', '99813002', NULL
FROM public.roles WHERE nombre = 'PADRE';
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT 'eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000013', id, 'Hija', 'Vinculada', '99813003', 'LEG-EPT-13-1'
FROM public.roles WHERE nombre = 'ESTUDIANTE';
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT 'eeeeeeee-1300-4000-8000-000000000004', 'eeeeeeee-1300-4000-8000-000000000014', id, 'Hijo', 'Ajeno', '99813004', 'LEG-EPT-13-2'
FROM public.roles WHERE nombre = 'ESTUDIANTE';
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT 'eeeeeeee-1300-4000-8000-000000000007', 'eeeeeeee-1300-4000-8000-000000000017', id, 'Hija', 'SinLegajo', '99813007', NULL
FROM public.roles WHERE nombre = 'ESTUDIANTE';
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT 'eeeeeeee-1300-4000-8000-000000000008', 'eeeeeeee-1300-4000-8000-000000000018', id, 'Directora', 'Prueba', '99813008', NULL
FROM public.roles WHERE nombre = 'DIRECTOR';
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT 'eeeeeeee-1300-4000-8000-000000000009', 'eeeeeeee-1300-4000-8000-000000000020', id, 'Docente', 'Prueba', '99813009', NULL
FROM public.roles WHERE nombre = 'DOCENTE';
INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES
  ('eeeeeeee-1300-4000-8000-000000000001', 'eeeeeeee-1300-4000-8000-000000000003'),
  ('eeeeeeee-1300-4000-8000-000000000001', 'eeeeeeee-1300-4000-8000-000000000007'),
  ('eeeeeeee-1300-4000-8000-000000000002', 'eeeeeeee-1300-4000-8000-000000000004');
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
SELECT 'eeeeeeee-1300-4000-8000-000000000005', id, 'Curso de prueba EPT 13', 'A', true
FROM public.niveles WHERE nombre = 'PRIMARIO' LIMIT 1;

INSERT INTO public.materias_cursos (materia_id, curso_id, profesor_id)
SELECT id, 'eeeeeeee-1300-4000-8000-000000000005', 'eeeeeeee-1300-4000-8000-000000000009'
FROM public.actividades WHERE tipo = 'CURRICULAR' AND activo LIMIT 1;
INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
SELECT 'eeeeeeee-1300-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000101', id,
       'Grupo EPT 13', 10, 'eeeeeeee-1300-4000-8000-000000000009'
FROM public.niveles WHERE nombre = 'PRIMARIO' LIMIT 1;
INSERT INTO public.horarios (id, dia_semana, hora_inicio, hora_fin)
VALUES ('eeeeeeee-1300-4000-8000-000000000021', 3, '17:00', '18:00');
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
VALUES ('eeeeeeee-1300-4000-8000-000000000010', 'eeeeeeee-1300-4000-8000-000000000021');
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
SELECT 'eeeeeeee-1300-4000-8000-000000000006', id, 'Curso inactivo EPT 13', 'B', false
FROM public.niveles WHERE nombre = 'PRIMARIO' LIMIT 1;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000011', true);

DO $$
DECLARE
  v_id UUID;
  v_estado TEXT;
BEGIN
  IF (SELECT count(*) FROM public.alumnos) <> 2 THEN
    RAISE EXCEPTION 'El padre debe ver exactamente dos hijos vinculados';
  END IF;
  IF (SELECT count(*) FROM public.matriculas) <> 0 THEN
    RAISE EXCEPTION 'No debe ver matrículas ajenas';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.alumnos', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.alumnos', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.matriculas', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.matriculas', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.matriculas', 'DELETE') THEN
    RAISE EXCEPTION 'Quedaron escrituras directas disponibles';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid IN ('public.alumnos'::regclass, 'public.matriculas'::regclass)
      AND NOT relrowsecurity
  ) THEN RAISE EXCEPTION 'RLS no está habilitado'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.matriculas', 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', 'public.matriculas', 'TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', 'public.matriculas', 'TRUNCATE')
     OR pg_catalog.has_function_privilege('anon', 'public.matricular_hijo(uuid,uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.matricular_hijo(uuid,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.consultar_detalle_hijo(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.consultar_detalle_hijo(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Hay privilegios residuales peligrosos';
  END IF;
  BEGIN
    INSERT INTO public.matriculas (alumno_id, curso_id)
    VALUES ('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Se aceptó escritura directa';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.matriculas WHERE alumno_id = 'eeeeeeee-1300-4000-8000-000000000003';
    RAISE EXCEPTION 'Se aceptó borrado directo';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    UPDATE public.matriculas SET fecha_cierre = pg_catalog.now()
    WHERE alumno_id = 'eeeeeeee-1300-4000-8000-000000000003';
    RAISE EXCEPTION 'Se aceptó cerrar una matrícula directamente';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.cambiar_curso_alumno('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'El padre cambió el curso por RPC administrativa';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000007', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Se aceptó un alumno sin legajo';
  EXCEPTION WHEN SQLSTATE 'P5521' THEN NULL;
  END;
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000004', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Se aceptó un hijo ajeno';
  EXCEPTION WHEN SQLSTATE 'P5520' THEN NULL;
  END;
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000006');
    RAISE EXCEPTION 'Se aceptó curso inactivo';
  EXCEPTION WHEN SQLSTATE 'P5504' THEN NULL;
  END;
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000099');
    RAISE EXCEPTION 'Se aceptó curso inexistente';
  EXCEPTION WHEN SQLSTATE '23503' THEN NULL;
  END;
  IF (SELECT estado FROM public.alumnos WHERE perfil_id = 'eeeeeeee-1300-4000-8000-000000000003') <> 'INACTIVO' THEN
    RAISE EXCEPTION 'El rechazo modificó el estado';
  END IF;
  SELECT public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005') INTO v_id;
  IF v_id IS NULL OR (SELECT count(*) FROM public.matriculas WHERE alumno_id = 'eeeeeeee-1300-4000-8000-000000000003') <> 1 THEN
    RAISE EXCEPTION 'La matrícula válida no quedó visible';
  END IF;
  SELECT estado::TEXT INTO v_estado FROM public.alumnos WHERE perfil_id = 'eeeeeeee-1300-4000-8000-000000000003';
  IF v_estado <> 'ACTIVO' THEN RAISE EXCEPTION 'El alumno no quedó activo'; END IF;
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Se aceptó una segunda matrícula';
  EXCEPTION WHEN SQLSTATE 'P5522' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.matriculas WHERE alumno_id = 'eeeeeeee-1300-4000-8000-000000000003') <> 1 THEN
    RAISE EXCEPTION 'Se duplicó la matrícula';
  END IF;
END $$;

RESET ROLE;
INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id, deporte_id)
VALUES ('eeeeeeee-1300-4000-8000-000000000003',
        'eeeeeeee-1300-4000-8000-000000000010',
        'e0000000-0000-4000-8000-000000000101');
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000011', true);
DO $$
DECLARE v_detalle JSONB;
BEGIN
  SELECT public.consultar_detalle_hijo('eeeeeeee-1300-4000-8000-000000000003') INTO v_detalle;
  IF pg_catalog.jsonb_array_length(v_detalle->'materias') <> 1
     OR v_detalle->'materias'->0->>'docente' <> 'Docente Prueba'
     OR pg_catalog.jsonb_array_length(v_detalle->'deportes') <> 1
     OR v_detalle->'deportes'->0->>'deporte' <> 'Fútbol' THEN
    RAISE EXCEPTION 'El detalle autorizado de materias o deportes no coincide';
  END IF;
  BEGIN
    PERFORM public.consultar_detalle_hijo('eeeeeeee-1300-4000-8000-000000000004');
    RAISE EXCEPTION 'El detalle de un hijo ajeno quedó expuesto';
  EXCEPTION WHEN SQLSTATE 'P5520' THEN NULL;
  END;
END $$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000013', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'El estudiante invocó la matrícula parental';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000019', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Un usuario sin perfil invocó la matrícula parental';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000012', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.matriculas) <> 0 THEN
    RAISE EXCEPTION 'El segundo padre ve la matrícula ajena';
  END IF;
  IF pg_catalog.jsonb_array_length(public.consultar_detalle_hijo('eeeeeeee-1300-4000-8000-000000000004')->'materias') <> 0
     OR pg_catalog.jsonb_array_length(public.consultar_detalle_hijo('eeeeeeee-1300-4000-8000-000000000004')->'deportes') <> 0 THEN
    RAISE EXCEPTION 'El segundo padre recibió datos académicos ajenos';
  END IF;
  BEGIN
    PERFORM public.consultar_detalle_hijo('eeeeeeee-1300-4000-8000-000000000003');
    RAISE EXCEPTION 'El segundo padre consultó detalle del primer hijo';
  EXCEPTION WHEN SQLSTATE 'P5520' THEN NULL;
  END;
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'El segundo padre inscribió un hijo ajeno';
  EXCEPTION WHEN SQLSTATE 'P5520' THEN NULL;
  END;
END $$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000018', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.matriculas WHERE alumno_id = 'eeeeeeee-1300-4000-8000-000000000003') <> 1 THEN
    RAISE EXCEPTION 'La Directora no ve la matrícula parental';
  END IF;
END $$;

RESET ROLE;
-- Estados imposibles en datos confirmados, fabricados únicamente dentro de
-- esta transacción para comprobar las dos defensas independientes de la RPC.
UPDATE public.alumnos SET estado = 'INACTIVO'
WHERE perfil_id = 'eeeeeeee-1300-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000011', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Se aceptó una matrícula vigente con estado inconsistente';
  EXCEPTION WHEN SQLSTATE 'P5523' THEN NULL;
  END;
END $$;
RESET ROLE;
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id = 'eeeeeeee-1300-4000-8000-000000000003';
DELETE FROM public.matriculas
WHERE alumno_id = 'eeeeeeee-1300-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'eeeeeeee-1300-4000-8000-000000000011', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Se aceptó un alumno activo sin matrícula vigente';
  EXCEPTION WHEN SQLSTATE 'P5522' THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.matricular_hijo('eeeeeeee-1300-4000-8000-000000000003', 'eeeeeeee-1300-4000-8000-000000000005');
    RAISE EXCEPTION 'Un anónimo invocó la matrícula parental';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
