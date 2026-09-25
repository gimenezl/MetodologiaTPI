-- EPT-57. Ejecutar solo contra la base local descartable. ROLLBACK integral.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni)
SELECT v.id,v.id,r.id,'Prueba',v.apellido,v.dni FROM (VALUES
 ('f5700000-0000-4000-8000-000000000001'::uuid,'DIRECTOR','Dirección','95700001'),
 ('f5700000-0000-4000-8000-000000000002'::uuid,'DOCENTE','Docente','95700002'),
 ('f5700000-0000-4000-8000-000000000003'::uuid,'ESTUDIANTE','Estudiante','95700003'),
 ('f5700000-0000-4000-8000-000000000004'::uuid,'PADRE','Familia','95700004'),
 ('f5700000-0000-4000-8000-000000000005'::uuid,'PERSONAL','Personal','95700005')
) v(id,rol,apellido,dni) JOIN public.roles r ON r.nombre=v.rol;
INSERT INTO public.cursos(id,nivel_id,denominacion,division,activo)
VALUES('f5700000-0000-4000-8000-0000000000c1',
 (SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),'Curso EPT57','A',true);
INSERT INTO public.matriculas(alumno_id,curso_id)
VALUES('f5700000-0000-4000-8000-000000000003','f5700000-0000-4000-8000-0000000000c1');
UPDATE public.alumnos SET estado='ACTIVO' WHERE perfil_id='f5700000-0000-4000-8000-000000000003';
INSERT INTO public.grupos_deportivos(id,deporte_id,nivel_id,nombre,cupo,profesor_id)
VALUES
 ('f5700000-0000-4000-8000-0000000000d1','e0000000-0000-4000-8000-000000000101',
  (SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),'Grupo EPT57 A',10,'f5700000-0000-4000-8000-000000000002'),
 ('f5700000-0000-4000-8000-0000000000d2','e0000000-0000-4000-8000-000000000102',
  (SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),'Grupo EPT57 B',10,'f5700000-0000-4000-8000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f5700000-0000-4000-8000-000000000001"}',true);
SELECT (public.crear_materia('Matemática EPT57')).id AS materia_id \gset
SELECT (public.asignar_materia_curso(:materia_id,'f5700000-0000-4000-8000-0000000000c1',NULL)).id AS asignacion_id \gset
SELECT public.agregar_horario_grupo_deportivo('f5700000-0000-4000-8000-0000000000d1',1::smallint,'10:00','11:00');
SELECT public.agregar_horario_grupo_deportivo('f5700000-0000-4000-8000-0000000000d2',1::smallint,'09:00','10:00');
SELECT public.inscribir_alumno_en_grupo_deportivo('f5700000-0000-4000-8000-000000000003',
  'f5700000-0000-4000-8000-0000000000d1');
SELECT (public.configurar_horario_materia(:'asignacion_id',1::smallint,'09:00','10:00')).id AS franja_id \gset

DO $$
DECLARE v_codigo text; v_conteo integer;
BEGIN
  IF (SELECT count(*) FROM public.materias_cursos_horarios f
      JOIN public.materias_cursos mc ON mc.id=f.asignacion_id
      WHERE mc.curso_id='f5700000-0000-4000-8000-0000000000c1' AND f.activo) <> 1 THEN
    RAISE EXCEPTION 'FALLO: alta académica contigua'; END IF;
  BEGIN
    PERFORM public.configurar_horario_materia(
      (SELECT id FROM public.materias_cursos WHERE curso_id='f5700000-0000-4000-8000-0000000000c1'),
      1::smallint,'09:00','10:00');
  EXCEPTION WHEN unique_violation THEN v_codigo := SQLSTATE; END;
  IF v_codigo <> '23505' THEN RAISE EXCEPTION 'FALLO: duplicado %',v_codigo; END IF;
  v_codigo := NULL;
  BEGIN
    PERFORM public.configurar_horario_materia(
      (SELECT id FROM public.materias_cursos WHERE curso_id='f5700000-0000-4000-8000-0000000000c1'),
      1::smallint,'09:30','09:45');
  EXCEPTION WHEN SQLSTATE 'P5594' THEN v_codigo := SQLSTATE; END;
  IF v_codigo <> 'P5594' THEN RAISE EXCEPTION 'FALLO: superposición académica %',v_codigo; END IF;
  v_codigo := NULL;
  BEGIN
    PERFORM public.configurar_horario_materia(
      (SELECT id FROM public.materias_cursos WHERE curso_id='f5700000-0000-4000-8000-0000000000c1'),
      1::smallint,'10:00','11:00');
  EXCEPTION WHEN SQLSTATE 'P5595' THEN v_codigo := SQLSTATE; END;
  IF v_codigo <> 'P5595' THEN RAISE EXCEPTION 'FALLO: conflicto académico-deportivo %',v_codigo; END IF;
  v_codigo := NULL;
  BEGIN
    PERFORM public.inscribir_alumno_en_grupo_deportivo(
      'f5700000-0000-4000-8000-000000000003',
      'f5700000-0000-4000-8000-0000000000d2');
  EXCEPTION WHEN SQLSTATE 'P5595' THEN v_codigo := SQLSTATE; END;
  IF v_codigo <> 'P5595' THEN RAISE EXCEPTION 'FALLO: conflicto deportivo-académico %',v_codigo; END IF;
  SELECT count(*) INTO v_conteo FROM public.inscripciones_deportivas
  WHERE alumno_id='f5700000-0000-4000-8000-000000000003' AND estado='ACTIVA';
  IF v_conteo<>1 THEN RAISE EXCEPTION 'FALLO: inscripción parcial'; END IF;
  v_codigo := NULL;
  BEGIN
    PERFORM public.configurar_horario_materia(
      (SELECT id FROM public.materias_cursos WHERE curso_id='f5700000-0000-4000-8000-0000000000c1'),
      8::smallint,'12:00','13:00');
  EXCEPTION WHEN SQLSTATE 'P5585' THEN v_codigo := SQLSTATE; END;
  IF v_codigo <> 'P5585' THEN RAISE EXCEPTION 'FALLO: día inválido %',v_codigo; END IF;
  v_codigo := NULL;
  BEGIN
    PERFORM public.configurar_horario_materia(
      (SELECT id FROM public.materias_cursos WHERE curso_id='f5700000-0000-4000-8000-0000000000c1'),
      2::smallint,'13:00','12:00');
  EXCEPTION WHEN SQLSTATE 'P5586' THEN v_codigo := SQLSTATE; END;
  IF v_codigo <> 'P5586' THEN RAISE EXCEPTION 'FALLO: rango inválido %',v_codigo; END IF;
  PERFORM public.configurar_horario_materia(
    (SELECT id FROM public.materias_cursos WHERE curso_id='f5700000-0000-4000-8000-0000000000c1'),
    2::smallint,'09:00','10:00');
  IF (SELECT count(*) FROM public.materias_cursos_horarios f
      JOIN public.materias_cursos mc ON mc.id=f.asignacion_id
      WHERE mc.curso_id='f5700000-0000-4000-8000-0000000000c1' AND f.activo)<>2 THEN
    RAISE EXCEPTION 'FALLO: varias franjas o día diferente'; END IF;
  RAISE NOTICE 'OK: contigüidad, duplicado, solapamiento, bidireccionalidad y atomicidad';
END $$;

SELECT public.cambiar_estado_horario_materia(:'franja_id',false);
SELECT public.cambiar_estado_horario_materia(:'franja_id',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.materias_cursos_horarios_historial WHERE franja_id=
      (SELECT f.id FROM public.materias_cursos_horarios f
       JOIN public.materias_cursos mc ON mc.id=f.asignacion_id
       JOIN public.horarios h ON h.id=f.horario_id
       WHERE mc.curso_id='f5700000-0000-4000-8000-0000000000c1'
         AND h.dia_semana=1 LIMIT 1))<>2 THEN
    RAISE EXCEPTION 'FALLO: historial de baja y reactivación'; END IF;
  RAISE NOTICE 'OK: historial y reactivación';
END $$;

-- Una reactivación no reutiliza la comprobación antigua: ve el nuevo deporte.
SELECT public.cambiar_estado_horario_materia(:'franja_id',false);
SELECT public.inscribir_alumno_en_grupo_deportivo(
  'f5700000-0000-4000-8000-000000000003',
  'f5700000-0000-4000-8000-0000000000d2');
DO $$ DECLARE v_codigo text; BEGIN
  BEGIN
    PERFORM public.cambiar_estado_horario_materia(
      (SELECT f.id FROM public.materias_cursos_horarios f
       JOIN public.horarios h ON h.id=f.horario_id
       JOIN public.materias_cursos mc ON mc.id=f.asignacion_id
       WHERE mc.curso_id='f5700000-0000-4000-8000-0000000000c1'
         AND h.dia_semana=1 LIMIT 1),true);
  EXCEPTION WHEN SQLSTATE 'P5595' THEN v_codigo:=SQLSTATE; END;
  IF v_codigo<>'P5595' THEN RAISE EXCEPTION 'FALLO: reactivación con conflicto %',v_codigo; END IF;
  RAISE NOTICE 'OK: la reactivación vuelve a verificar deportes vigentes';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f5700000-0000-4000-8000-000000000002"}',true);
DO $$ DECLARE v_codigo text; BEGIN
  IF EXISTS(SELECT 1 FROM public.materias_cursos_horarios) OR
     EXISTS(SELECT 1 FROM public.materias_cursos_horarios_historial) THEN
    RAISE EXCEPTION 'FALLO: docente puede leer horarios académicos'; END IF;
  BEGIN
    PERFORM public.cambiar_estado_horario_materia(
      (SELECT id FROM public.materias_cursos_horarios LIMIT 1),false);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_codigo:=SQLSTATE; END;
  IF v_codigo<>'42501' THEN RAISE EXCEPTION 'FALLO: docente puede mutar %',v_codigo; END IF;
  RAISE NOTICE 'OK: RLS y RPC deniegan a docente';
END $$;
DO $$ DECLARE v_rol text; v_identidad uuid; BEGIN
  FOR v_rol,v_identidad IN SELECT * FROM (VALUES
      ('ESTUDIANTE','f5700000-0000-4000-8000-000000000003'::uuid),
      ('PADRE','f5700000-0000-4000-8000-000000000004'::uuid),
      ('PERSONAL','f5700000-0000-4000-8000-000000000005'::uuid),
      ('SIN PERFIL','f5700000-0000-4000-8000-000000000099'::uuid)
    ) AS p(rol,identidad)
  LOOP
    PERFORM set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub',v_identidad)::text,true);
    IF EXISTS(SELECT 1 FROM public.materias_cursos_horarios) OR
       EXISTS(SELECT 1 FROM public.materias_cursos_horarios_historial) THEN
      RAISE EXCEPTION 'FALLO: % lee franjas académicas',v_rol;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('anon','public.materias_cursos_horarios','SELECT') OR
     pg_catalog.has_table_privilege('anon','public.materias_cursos_horarios_historial','SELECT') OR
     pg_catalog.has_table_privilege('authenticated','public.materias_cursos_horarios','INSERT') OR
     pg_catalog.has_table_privilege('authenticated','public.materias_cursos_horarios','UPDATE') OR
     pg_catalog.has_table_privilege('authenticated','public.materias_cursos_horarios','DELETE') THEN
    RAISE EXCEPTION 'FALLO: privilegios de tablas académicas';
  END IF;
  RAISE NOTICE 'OK: estudiante, sin perfil y anon no leen; escritura directa denegada';
END $$;
ROLLBACK;
