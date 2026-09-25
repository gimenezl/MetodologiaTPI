import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * EPT-58 — Carreras reales entre el estado de un profesor y sus asignaciones.
 *
 * Dos transacciones independientes compiten por la misma ficha. El arnés
 * espera, con `pg_blocking_pids`, a que la segunda esté efectivamente
 * bloqueada por la primera antes de confirmar: nunca depende de esperas por
 * tiempo. En cada carrera solo puede confirmarse un resultado consistente y
 * nunca queda una asignación o un grupo vigente a cargo de un docente INACTIVO.
 *
 *     node supabase/tests/profesores_concurrencia.mjs
 *
 * Solo contra la base local descartable. Limpia su fixture al terminar.
 */

const P = (n) => `f5810000-0000-4000-8000-00000000000${n}`
const ID = {
  director: 'f5810000-0000-4000-8000-000000000001',
  // Un docente por carrera, para que ninguna contamine a otra.
  inactivarTrasAsignar: P(2),
  asignarTrasInactivar: P(3),
  asignarTrasReactivar: P(4),
  asignarTrasReactivacionRevertida: P(5),
  inactivarTrasReactivarGrupo: P(6),
  cambiarResponsableTrasInactivar: P(7),
  fichaYAsignacion: P(8),
  reemplazo: P(9),
  curso: 'f5810000-0000-4000-8000-0000000000c1',
  grupo: 'f5810000-0000-4000-8000-0000000000d1',
}
const DOCENTES = [P(2), P(3), P(4), P(5), P(6), P(7), P(8), P(9)]
const PERFILES = [ID.director, ...DOCENTES]
const lista = (valores) => valores.map((v) => `'${v}'`).join(',')

const sesion = (id) =>
  `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${id}"}',false);`
const probar = (sql) => `DO $prueba$ BEGIN
  BEGIN ${sql}; PERFORM set_config('ept58.resultado','OK',false);
  EXCEPTION WHEN OTHERS THEN PERFORM set_config('ept58.resultado',SQLSTATE,false); END;
END $prueba$;`
const materia = (n) => `(SELECT id FROM public.materias WHERE nombre = 'Materia concurrencia EPT58 ${n}')`
const asignacion = (n) =>
  `(SELECT mc.id FROM public.materias_cursos mc WHERE mc.materia_id = ${materia(n)} AND mc.curso_id = '${ID.curso}')`

async function limpiar() {
  const l = new SesionPsql('L', 'EPT58')
  try {
    // El historial es de solo agregado también para el propietario. Solo esta
    // limpieza local deshabilita su guarda, dentro de la misma transacción.
    await l.ejecutar(`RESET ROLE; BEGIN;
      ALTER TABLE public.profesores_estados_historial DISABLE TRIGGER impedir_modificar_historial_profesor;
      DELETE FROM public.profesores_estados_historial
        WHERE profesor_id IN (${lista(PERFILES)}) OR actor_id IN (${lista(PERFILES)});
      ALTER TABLE public.profesores_estados_historial ENABLE TRIGGER impedir_modificar_historial_profesor;
      DELETE FROM public.materias_cursos WHERE curso_id = '${ID.curso}';
      DELETE FROM public.grupos_deportivos WHERE id = '${ID.grupo}';
      DELETE FROM public.profesores WHERE perfil_id IN (${lista(PERFILES)});
      DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
      DELETE FROM public.cursos WHERE id = '${ID.curso}';
      DELETE FROM public.actividades WHERE nombre LIKE 'Materia concurrencia EPT58 %' AND tipo = 'CURRICULAR';
      COMMIT;`, 'limpieza')
  } finally {
    await l.cerrar()
  }
}

const a = new SesionPsql('A', 'EPT58')
const b = new SesionPsql('B', 'EPT58')

async function resultadoB(etiqueta) {
  return b.escalar(`current_setting('ept58.resultado', true)`, etiqueta)
}

async function propietario(expresion, etiqueta) {
  await a.ejecutar('RESET ROLE;', `propietario_${etiqueta}`)
  return a.escalar(expresion, etiqueta)
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

let bien = false
try {
  await limpiar()
  const pidA = Number(await a.escalar('pg_backend_pid()', 'pid_a'))
  const pidB = Number(await b.escalar('pg_backend_pid()', 'pid_b'))

  // Fixture: una dirección, ocho docentes con ficha completa, un curso, ocho
  // materias y un grupo inactivo.
  await a.ejecutar(`RESET ROLE; BEGIN;
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
    SELECT v.id::uuid, v.id::uuid, r.id, 'Prueba', v.apellido, v.dni, v.legajo
    FROM (VALUES
      ('${ID.director}', 'DIRECTOR', 'Dirección', '95810001', NULL),
      ${DOCENTES.map((id, i) => `('${id}', 'DOCENTE', 'Docente ${i + 2}', '9581000${i + 2}', 'LEG-EPT58-CONC-${i + 2}')`).join(',\n      ')}
    ) AS v(id, rol, apellido, dni, legajo)
    JOIN public.roles r ON r.nombre = v.rol;
    UPDATE public.profesores SET especialidad = 'Concurrencia' WHERE perfil_id IN (${lista(DOCENTES)});
    INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
    VALUES ('${ID.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Concurrencia EPT58', 'A', TRUE);
    INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
    VALUES ('${ID.grupo}', 'e0000000-0000-4000-8000-000000000101',
            (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Concurrencia EPT58', 10,
            '${ID.inactivarTrasReactivarGrupo}');
    UPDATE public.grupos_deportivos SET activo = FALSE WHERE id = '${ID.grupo}';
    COMMIT;`, 'fixture')
  await a.ejecutar(sesion(ID.director), 'director')
  for (let n = 1; n <= 8; n += 1) {
    await a.ejecutar(`SELECT public.crear_materia('Materia concurrencia EPT58 ${n}');`, `materia_${n}`)
  }
  // Dos docentes empiezan INACTIVO (para las carreras de reactivación) y la
  // carrera 6 necesita una asignación vigente a cargo de otro docente.
  await a.ejecutar(`
    SELECT public.cambiar_estado_profesor('${ID.asignarTrasReactivar}', 'INACTIVO');
    SELECT public.cambiar_estado_profesor('${ID.asignarTrasReactivacionRevertida}', 'INACTIVO');
    SELECT public.asignar_materia_curso(${materia(6)}, '${ID.curso}', '${ID.reemplazo}');`, 'estado_inicial')

  // 1. Asignar primero → inactivar espera y rechaza P5610.
  await a.ejecutar(`BEGIN; SELECT public.asignar_materia_curso(${materia(1)}, '${ID.curso}', '${ID.inactivarTrasAsignar}');`, 'r1_asignar')
  let pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.cambiar_estado_profesor('${ID.inactivarTrasAsignar}', 'INACTIVO')`)}`, 'r1_inactivar')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'r1_commit')
  await pendiente
  let r = await resultadoB('r1_resultado')
  exigir(r === 'P5610', `Carrera 1: se esperaba P5610 y llegó ${r}`)
  exigir(
    (await propietario(`(SELECT estado FROM public.profesores WHERE perfil_id = '${ID.inactivarTrasAsignar}')`, 'r1_estado')) === 'ACTIVO' &&
      (await a.escalar(`(SELECT count(*) FROM public.materias_cursos WHERE profesor_id = '${ID.inactivarTrasAsignar}' AND activo)`, 'r1_asig')) === '1' &&
      (await a.escalar(`(SELECT count(*) FROM public.profesores_estados_historial WHERE profesor_id = '${ID.inactivarTrasAsignar}')`, 'r1_hist')) === '0',
    'Carrera 1: estado final inconsistente'
  )
  console.log('OK EPT58 1: la asignación confirma primero; la inactivación concurrente espera y rechaza P5610 sin historial')
  await a.ejecutar(sesion(ID.director), 'r1_director')

  // 2. Inactivar primero → asignar espera y rechaza P5605.
  await a.ejecutar(`BEGIN; SELECT public.cambiar_estado_profesor('${ID.asignarTrasInactivar}', 'INACTIVO');`, 'r2_inactivar')
  pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.asignar_materia_curso(${materia(2)}, '${ID.curso}', '${ID.asignarTrasInactivar}')`)}`, 'r2_asignar')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'r2_commit')
  await pendiente
  r = await resultadoB('r2_resultado')
  exigir(r === 'P5605', `Carrera 2: se esperaba P5605 y llegó ${r}`)
  exigir(
    (await propietario(`(SELECT estado FROM public.profesores WHERE perfil_id = '${ID.asignarTrasInactivar}')`, 'r2_estado')) === 'INACTIVO' &&
      (await a.escalar(`(SELECT count(*) FROM public.materias_cursos WHERE profesor_id = '${ID.asignarTrasInactivar}')`, 'r2_asig')) === '0' &&
      (await a.escalar(`(SELECT count(*) FROM public.profesores_estados_historial WHERE profesor_id = '${ID.asignarTrasInactivar}')`, 'r2_hist')) === '1',
    'Carrera 2: estado final inconsistente'
  )
  console.log('OK EPT58 2: la inactivación confirma primero; la asignación concurrente espera y rechaza P5605')
  await a.ejecutar(sesion(ID.director), 'r2_director')

  // 3. Reactivar primero y confirmar → asignar espera y se confirma.
  await a.ejecutar(`BEGIN; SELECT public.cambiar_estado_profesor('${ID.asignarTrasReactivar}', 'ACTIVO');`, 'r3_reactivar')
  pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.asignar_materia_curso(${materia(3)}, '${ID.curso}', '${ID.asignarTrasReactivar}')`)}`, 'r3_asignar')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'r3_commit')
  await pendiente
  r = await resultadoB('r3_resultado')
  exigir(r === 'OK', `Carrera 3: se esperaba OK y llegó ${r}`)
  exigir(
    (await propietario(`(SELECT estado FROM public.profesores WHERE perfil_id = '${ID.asignarTrasReactivar}')`, 'r3_estado')) === 'ACTIVO' &&
      (await a.escalar(`(SELECT count(*) FROM public.materias_cursos WHERE profesor_id = '${ID.asignarTrasReactivar}' AND activo)`, 'r3_asig')) === '1',
    'Carrera 3: estado final inconsistente'
  )
  console.log('OK EPT58 3: la reactivación confirma primero; la asignación concurrente espera y se confirma sobre un docente ACTIVO')
  await a.ejecutar(sesion(ID.director), 'r3_director')

  // 4. Reactivar primero y revertir → asignar espera y rechaza P5605.
  await a.ejecutar(`BEGIN; SELECT public.cambiar_estado_profesor('${ID.asignarTrasReactivacionRevertida}', 'ACTIVO');`, 'r4_reactivar')
  pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.asignar_materia_curso(${materia(4)}, '${ID.curso}', '${ID.asignarTrasReactivacionRevertida}')`)}`, 'r4_asignar')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('ROLLBACK;', 'r4_rollback')
  await pendiente
  r = await resultadoB('r4_resultado')
  exigir(r === 'P5605', `Carrera 4: se esperaba P5605 y llegó ${r}`)
  exigir(
    (await propietario(`(SELECT estado FROM public.profesores WHERE perfil_id = '${ID.asignarTrasReactivacionRevertida}')`, 'r4_estado')) === 'INACTIVO' &&
      (await a.escalar(`(SELECT count(*) FROM public.materias_cursos WHERE profesor_id = '${ID.asignarTrasReactivacionRevertida}')`, 'r4_asig')) === '0' &&
      (await a.escalar(`(SELECT count(*) FROM public.profesores_estados_historial WHERE profesor_id = '${ID.asignarTrasReactivacionRevertida}')`, 'r4_hist')) === '1',
    'Carrera 4: la reactivación revertida dejó rastros'
  )
  console.log('OK EPT58 4: la reactivación se revierte; la asignación concurrente ve la ficha INACTIVO y rechaza P5605')
  await a.ejecutar(sesion(ID.director), 'r4_director')

  // 5. Reactivar un grupo (escritura directa del propietario) primero →
  //    inactivar su profesor espera y rechaza P5610.
  await a.ejecutar(`RESET ROLE; BEGIN; UPDATE public.grupos_deportivos SET activo = TRUE WHERE id = '${ID.grupo}';`, 'r5_grupo')
  pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.cambiar_estado_profesor('${ID.inactivarTrasReactivarGrupo}', 'INACTIVO')`)}`, 'r5_inactivar')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'r5_commit')
  await pendiente
  r = await resultadoB('r5_resultado')
  exigir(r === 'P5610', `Carrera 5: se esperaba P5610 y llegó ${r}`)
  exigir(
    (await propietario(`(SELECT estado FROM public.profesores WHERE perfil_id = '${ID.inactivarTrasReactivarGrupo}')`, 'r5_estado')) === 'ACTIVO' &&
      // `escalar` convierte a texto: un booleano llega como 'true'.
      (await a.escalar(`(SELECT activo FROM public.grupos_deportivos WHERE id = '${ID.grupo}')`, 'r5_grupo_activo')) === 'true',
    'Carrera 5: estado final inconsistente'
  )
  console.log('OK EPT58 5: la reactivación del grupo confirma primero; la inactivación del profesor espera y rechaza P5610')
  await a.ejecutar(sesion(ID.director), 'r5_director')

  // 6. Inactivar primero → cambiar el responsable a ese docente espera y
  //    rechaza P5605; la asignación conserva su responsable anterior.
  await a.ejecutar(`BEGIN; SELECT public.cambiar_estado_profesor('${ID.cambiarResponsableTrasInactivar}', 'INACTIVO');`, 'r6_inactivar')
  pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.cambiar_profesor_asignacion(${asignacion(6)}, '${ID.cambiarResponsableTrasInactivar}')`)}`, 'r6_cambiar')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'r6_commit')
  await pendiente
  r = await resultadoB('r6_resultado')
  exigir(r === 'P5605', `Carrera 6: se esperaba P5605 y llegó ${r}`)
  exigir(
    (await propietario(`(SELECT profesor_id FROM public.materias_cursos WHERE id = ${asignacion(6)})`, 'r6_responsable')) === ID.reemplazo,
    'Carrera 6: la asignación cambió de responsable'
  )
  console.log('OK EPT58 6: la inactivación confirma primero; el cambio de responsable concurrente espera y rechaza P5605')
  await a.ejecutar(sesion(ID.director), 'r6_director')

  // 7. Orden de bloqueos: asignar y editar la ficha del mismo docente en los
  //    dos órdenes. Ninguno forma un ciclo (40P01): la segunda espera y se
  //    confirma.
  await a.ejecutar(`BEGIN; SELECT public.asignar_materia_curso(${materia(7)}, '${ID.curso}', '${ID.fichaYAsignacion}');`, 'r7_asignar')
  pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.actualizar_ficha_profesor('${ID.fichaYAsignacion}', 'LEG-EPT58-CONC-EDITADO', 'Historia')`)}`, 'r7_ficha')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'r7_commit')
  await pendiente
  r = await resultadoB('r7_resultado')
  exigir(r === 'OK', `Carrera 7a: se esperaba OK y llegó ${r}`)

  await a.ejecutar(`BEGIN; SELECT public.actualizar_ficha_profesor('${ID.fichaYAsignacion}', 'LEG-EPT58-CONC-OTRO', 'Geografía');`, 'r7_ficha_primero')
  pendiente = b.ejecutar(`${sesion(ID.director)} ${probar(`PERFORM public.asignar_materia_curso(${materia(8)}, '${ID.curso}', '${ID.fichaYAsignacion}')`)}`, 'r7_asignar_despues')
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', 'r7_commit_2')
  await pendiente
  r = await resultadoB('r7_resultado_2')
  exigir(r === 'OK', `Carrera 7b: se esperaba OK y llegó ${r}`)
  exigir(
    (await propietario(`(SELECT legajo_nro FROM public.perfiles WHERE id = '${ID.fichaYAsignacion}')`, 'r7_legajo')) === 'LEG-EPT58-CONC-OTRO' &&
      (await a.escalar(`(SELECT especialidad FROM public.profesores WHERE perfil_id = '${ID.fichaYAsignacion}')`, 'r7_especialidad')) === 'Geografía' &&
      (await a.escalar(`(SELECT count(*) FROM public.materias_cursos WHERE profesor_id = '${ID.fichaYAsignacion}' AND activo)`, 'r7_asig')) === '2',
    'Carrera 7: estado final inconsistente'
  )
  console.log('OK EPT58 7: editar la ficha y asignar en ambos órdenes se serializa sin interbloqueo')

  // Invariante global al final de todas las carreras.
  exigir(
    (await a.escalar(`(SELECT count(*) FROM public.profesores pr
       WHERE pr.estado = 'INACTIVO'
         AND (EXISTS (SELECT 1 FROM public.materias_cursos mc WHERE mc.profesor_id = pr.perfil_id AND mc.activo)
           OR EXISTS (SELECT 1 FROM public.grupos_deportivos g WHERE g.profesor_id = pr.perfil_id AND g.activo)))`, 'invariante')) === '0',
    'Invariante: existe un docente INACTIVO a cargo de una relación vigente'
  )
  console.log('OK EPT58: ningún docente INACTIVO quedó a cargo de una asignación o un grupo vigente')
  bien = true
} finally {
  await Promise.allSettled([a.ejecutar('ROLLBACK;', 'rollback'), b.ejecutar('ROLLBACK;', 'rollback')])
  await Promise.allSettled([a.cerrar(), b.cerrar()])
  await limpiar()
  if (bien) console.log('OK EPT58: fixture eliminado sin residuos')
}
