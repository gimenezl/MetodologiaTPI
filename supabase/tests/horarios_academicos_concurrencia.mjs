import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

// Dos carreras reales entre transacciones independientes; nunca dependen de
// sleep. El arnés espera pg_blocking_pids antes de confirmar la ganadora.
const ID = {
  director: 'f5710000-0000-4000-8000-000000000001',
  docente: 'f5710000-0000-4000-8000-000000000002',
  x: 'f5710000-0000-4000-8000-000000000003',
  y: 'f5710000-0000-4000-8000-000000000004',
  curso: 'f5710000-0000-4000-8000-0000000000c1',
  g1: 'f5710000-0000-4000-8000-0000000000d1',
  g2: 'f5710000-0000-4000-8000-0000000000d2',
}
const session = (id) => `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${id}"}',false);`
const probar = (sql) => `DO $prueba$ BEGIN
  BEGIN ${sql}; PERFORM set_config('ept57.resultado','OK',false);
  EXCEPTION WHEN OTHERS THEN PERFORM set_config('ept57.resultado',SQLSTATE,false); END;
END $prueba$;`
const a = new SesionPsql('A', 'EPT57')
const b = new SesionPsql('B', 'EPT57')

async function limpiar() {
  const l = new SesionPsql('L', 'EPT57')
  try {
    await l.ejecutar(`RESET ROLE; BEGIN;
      DELETE FROM public.materias_cursos_horarios_historial
        WHERE franja_id IN (SELECT f.id FROM public.materias_cursos_horarios f
          JOIN public.materias_cursos mc ON mc.id=f.asignacion_id WHERE mc.curso_id='${ID.curso}');
      DELETE FROM public.materias_cursos_horarios
        WHERE asignacion_id IN (SELECT id FROM public.materias_cursos WHERE curso_id='${ID.curso}');
      DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN ('${ID.x}','${ID.y}');
      DELETE FROM public.grupos_deportivos_horarios WHERE grupo_id IN ('${ID.g1}','${ID.g2}');
      DELETE FROM public.grupos_deportivos WHERE id IN ('${ID.g1}','${ID.g2}');
      DELETE FROM public.materias_cursos WHERE curso_id='${ID.curso}';
      DELETE FROM public.matriculas WHERE alumno_id IN ('${ID.x}','${ID.y}');
      DELETE FROM public.alumnos WHERE perfil_id IN ('${ID.x}','${ID.y}');
      -- Desde EPT-58 el perfil DOCENTE tiene ficha y la FK es RESTRICT.
      DELETE FROM public.profesores WHERE perfil_id = '${ID.docente}';
      DELETE FROM public.perfiles WHERE id IN ('${ID.director}','${ID.docente}','${ID.x}','${ID.y}');
      DELETE FROM public.cursos WHERE id='${ID.curso}';
      DELETE FROM public.actividades WHERE nombre='Materia concurrencia EPT57' AND tipo='CURRICULAR';
      COMMIT;`, 'limpieza')
  } finally { await l.cerrar() }
}

let bien = false
try {
  await limpiar()
  const pidA = Number(await a.escalar('pg_backend_pid()', 'pid_a'))
  const pidB = Number(await b.escalar('pg_backend_pid()', 'pid_b'))
  await a.ejecutar(`RESET ROLE; BEGIN;
    INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni,legajo_nro)
    SELECT v.id::uuid,v.id::uuid,r.id,'Prueba',v.apellido,v.dni,v.legajo
    FROM (VALUES
      ('${ID.director}','DIRECTOR','Dirección','95710001',NULL),
      ('${ID.docente}','DOCENTE','Docente','95710002',NULL),
      ('${ID.x}','ESTUDIANTE','Alumno X','95710003','LEG-EPT57-X'),
      ('${ID.y}','ESTUDIANTE','Alumno Y','95710004','LEG-EPT57-Y')) v(id,rol,apellido,dni,legajo)
    JOIN public.roles r ON r.nombre=v.rol;
    INSERT INTO public.cursos(id,nivel_id,denominacion,division,activo)
    VALUES('${ID.curso}',(SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),
      'Concurrencia EPT57','A',true);
    INSERT INTO public.matriculas(alumno_id,curso_id)
    VALUES('${ID.x}','${ID.curso}'),('${ID.y}','${ID.curso}');
    UPDATE public.alumnos SET estado='ACTIVO' WHERE perfil_id IN ('${ID.x}','${ID.y}');
    INSERT INTO public.grupos_deportivos(id,deporte_id,nivel_id,nombre,cupo,profesor_id)
    VALUES
      ('${ID.g1}','e0000000-0000-4000-8000-000000000101',
       (SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),'Concurrencia EPT57 A',10,'${ID.docente}'),
      ('${ID.g2}','e0000000-0000-4000-8000-000000000102',
       (SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),'Concurrencia EPT57 B',10,'${ID.docente}');
    COMMIT;`, 'fixture')
  await a.ejecutar(session(ID.director), 'director')
  const materia = Number(await a.escalar(`(SELECT (public.crear_materia('Materia concurrencia EPT57')).id)`, 'materia'))
  const asignacion = await a.escalar(`(SELECT (public.asignar_materia_curso(${materia},'${ID.curso}',NULL)).id)`, 'asignacion')
  await a.ejecutar(`SELECT public.agregar_horario_grupo_deportivo('${ID.g1}',1::smallint,'10:00','11:00');
    SELECT public.agregar_horario_grupo_deportivo('${ID.g2}',2::smallint,'12:00','13:00');`, 'grupos_horarios')

  // A configura la materia y retiene el bloqueo del alumno. B, al inscribirse,
  // debe esperar y ver el horario recién confirmado.
  await a.ejecutar(`BEGIN; SELECT public.configurar_horario_materia('${asignacion}',1::smallint,'10:00','11:00');`, 'academia_primero')
  const pendienteB = b.ejecutar(`${session(ID.x)} ${probar(`PERFORM public.inscribir_en_grupo_deportivo('${ID.g1}')`)}`, 'deporte_despues')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'confirmar_academia')
  await pendienteB
  const r1 = await b.escalar(`current_setting('ept57.resultado',true)`, 'resultado_1')
  if (r1 !== 'P5595') throw new Error(`Academia → deporte: se esperaba P5595, llegó ${r1}`)
  console.log('OK EPT57 1: academia confirma primero; inscripción deportiva concurrente espera y rechaza P5595')

  // A inscribe al otro alumno. B intenta agregar una franja que lo afectaría;
  // el bloqueo del alumno obliga a B a evaluar el estado final y rechazar.
  await a.ejecutar(`${session(ID.y)} BEGIN; SELECT public.inscribir_en_grupo_deportivo('${ID.g2}');`, 'deporte_primero')
  const pendienteA = b.ejecutar(`${session(ID.director)} ${probar(`PERFORM public.configurar_horario_materia('${asignacion}',2::smallint,'12:00','13:00')`)}`, 'academia_despues')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'confirmar_deporte')
  await pendienteA
  const r2 = await b.escalar(`current_setting('ept57.resultado',true)`, 'resultado_2')
  if (r2 !== 'P5595') throw new Error(`Deporte → academia: se esperaba P5595, llegó ${r2}`)
  await a.ejecutar('RESET ROLE;', 'propietario')
  const franjas = Number(await a.escalar(`(SELECT count(*) FROM public.materias_cursos_horarios WHERE asignacion_id='${asignacion}' AND activo)`, 'franjas'))
  const inscripciones = Number(await a.escalar(`(SELECT count(*) FROM public.inscripciones_deportivas WHERE alumno_id IN ('${ID.x}','${ID.y}') AND estado='ACTIVA')`, 'inscripciones'))
  if (franjas !== 1 || inscripciones !== 1) throw new Error(`Estado parcial: ${franjas} franjas, ${inscripciones} inscripciones`)
  console.log('OK EPT57 2: deporte confirma primero; franja académica concurrente espera y rechaza P5595')
  console.log('OK EPT57: estado final atómico, una franja y una inscripción')
  bien = true
} finally {
  await Promise.allSettled([a.ejecutar('ROLLBACK;', 'rollback'), b.ejecutar('ROLLBACK;', 'rollback')])
  await Promise.allSettled([a.cerrar(), b.cerrar()])
  await limpiar()
  if (bien) console.log('OK EPT57: fixture eliminada sin residuos')
}
