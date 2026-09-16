import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la inscripción al comedor (EPT-10, EPT-30).
 *
 * Usa DOS conexiones PostgreSQL independientes, no dos promesas del mismo
 * proceso: cada `SesionPsql` es un `psql` propio, así que compiten de verdad
 * por los bloqueos de fila y de índice. La coordinación es determinista
 * (`pg_blocking_pids`), nunca por tiempo.
 *
 * Demuestra que:
 *   1. Dos altas simultáneas del mismo alumno y servicio dejan exactamente una
 *      inscripción activa; una confirma y la otra recibe 23505.
 *   2. Cancelar y volver a inscribirse bajo concurrencia tampoco produce dos
 *      inscripciones activas ni pierde el ciclo anterior.
 *   3. Un alumno INACTIVO no consigue inscribirse ni siquiera compitiendo con
 *      otra transacción, y no deja ninguna fila.
 *
 * Corre contra la base local descartable. Crea sus propios datos sintéticos y
 * los borra al final como propietario de las tablas; ese borrado no representa
 * ninguna operación disponible en la aplicación, que no tiene DELETE.
 */

const COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const ACTIVO = 'f1111111-1111-4111-8111-111111111111'
const INACTIVO = 'f2222222-2222-4222-8222-222222222222'
const CURSO = 'f3333333-3333-4333-8333-333333333333'
const MARCA = 'CONCURRENCIA EPT-10'

function comoAlumno(sub) {
  return `SET ROLE authenticated;
          SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`
}

/**
 * Alta envuelta para poder distinguir el éxito del rechazo por duplicado.
 *
 * El desenlace se guarda en una variable de sesión y no en un `RAISE NOTICE`:
 * `psql` manda los avisos a la salida de error, que el arnés captura aparte, de
 * modo que no serían legibles desde el flujo de resultados.
 */
function altaTolerante() {
  return `DO $prueba$
          BEGIN
            BEGIN
              PERFORM public.inscribir_en_servicio('${COMEDOR}');
              PERFORM pg_catalog.set_config('ept10.resultado', 'ALTA', false);
            EXCEPTION
              WHEN unique_violation THEN
                PERFORM pg_catalog.set_config('ept10.resultado', 'DUPLICADO', false);
              WHEN SQLSTATE 'P5553' THEN
                PERFORM pg_catalog.set_config('ept10.resultado', 'ALUMNO_INACTIVO', false);
            END;
          END
          $prueba$;`
}

/** Lee en la propia sesión el desenlace que dejó `altaTolerante`. */
function resultadoDe(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept10.resultado', true)`, etiqueta)
}

async function contarActivas(sesion, alumno, etiqueta) {
  return sesion.escalar(
    `(SELECT pg_catalog.count(*) FROM public.inscripciones_servicios
      WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA')`,
    etiqueta
  )
}

async function contarTodas(sesion, alumno, etiqueta) {
  return sesion.escalar(
    `(SELECT pg_catalog.count(*) FROM public.inscripciones_servicios
      WHERE alumno_id = '${alumno}')`,
    etiqueta
  )
}

/**
 * 1. Dos altas simultáneas del mismo alumno y servicio.
 *
 * A abre transacción e inserta; B intenta lo mismo y queda bloqueada en el
 * índice único parcial. Cuando A confirma, B recibe 23505.
 */
async function probarAltaSimultanea(sesionA, sesionB, pids) {
  await sesionA.ejecutar(
    `${comoAlumno(ACTIVO)}
     BEGIN;
     SELECT public.inscribir_en_servicio('${COMEDOR}');`,
    'alta_a_pendiente'
  )

  const altaB = sesionB.ejecutar(
    `${comoAlumno(ACTIVO)}
     ${altaTolerante()}`,
    'alta_b_pendiente'
  )

  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', 'confirmar_alta_a')
  await altaB

  if ((await resultadoDe(sesionB, 'resultado_alta_b')) !== 'DUPLICADO') {
    throw new Error('La segunda alta simultánea no fue rechazada como duplicado')
  }

  const activas = await contarActivas(sesionA, ACTIVO, 'activas_tras_carrera')
  const todas = await contarTodas(sesionA, ACTIVO, 'todas_tras_carrera')
  if (activas !== '1' || todas !== '1') {
    throw new Error(
      `Tras la carrera quedaron ${activas} activa(s) y ${todas} fila(s); se esperaba 1 y 1`
    )
  }

  console.log('OK CONCURRENCIA 1: dos altas simultáneas dejan exactamente una inscripción activa (la otra, 23505)')
}

/**
 * 2. Cancelación y reingreso bajo concurrencia.
 *
 * A cancela dentro de una transacción; B intenta inscribirse al mismo tiempo y
 * queda bloqueada. Al confirmar A, la inscripción de B procede porque la fila
 * cancelada ya no pertenece al índice parcial. El resultado sigue siendo una
 * sola activa, y el ciclo cancelado se conserva.
 */
async function probarBajaYReingreso(sesionA, sesionB, pids) {
  const activa = await sesionA.escalar(
    `(SELECT id FROM public.inscripciones_servicios
      WHERE alumno_id = '${ACTIVO}' AND estado = 'ACTIVA')`,
    'inscripcion_activa'
  )

  await sesionA.ejecutar(
    `BEGIN;
     SELECT public.cancelar_inscripcion_servicio('${activa}');`,
    'baja_a_pendiente'
  )

  const reingresoB = sesionB.ejecutar(altaTolerante(), 'reingreso_b_pendiente')

  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', 'confirmar_baja_a')
  await reingresoB

  if ((await resultadoDe(sesionB, 'resultado_reingreso')) !== 'ALTA') {
    throw new Error('El reingreso concurrente a la baja no se pudo confirmar')
  }

  const activas = await contarActivas(sesionA, ACTIVO, 'activas_tras_reingreso')
  const todas = await contarTodas(sesionA, ACTIVO, 'todas_tras_reingreso')
  if (activas !== '1' || todas !== '2') {
    throw new Error(
      `Tras el reingreso quedaron ${activas} activa(s) y ${todas} fila(s); se esperaba 1 y 2`
    )
  }

  console.log('OK CONCURRENCIA 2: baja y reingreso simultáneos dejan una sola activa y conservan el ciclo anterior')
}

/** 3. Un alumno INACTIVO no se inscribe ni compitiendo con otra transacción. */
async function probarAlumnoInactivo(sesionA, sesionB, pids) {
  // A bloquea la fila del alumno inactivo; B intenta inscribirse y espera.
  await sesionA.ejecutar(
    `RESET ROLE;
     BEGIN;
     SELECT estado FROM public.alumnos WHERE perfil_id = '${INACTIVO}' FOR UPDATE;`,
    'bloquear_alumno_inactivo'
  )

  const altaB = sesionB.ejecutar(
    `${comoAlumno(INACTIVO)}
     ${altaTolerante()}`,
    'alta_inactivo_pendiente'
  )

  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', 'liberar_alumno_inactivo')
  await altaB

  if ((await resultadoDe(sesionB, 'resultado_alta_inactivo')) !== 'ALUMNO_INACTIVO') {
    throw new Error('Un alumno INACTIVO consiguió inscribirse bajo concurrencia')
  }

  const todas = await contarTodas(sesionA, INACTIVO, 'todas_inactivo')
  if (todas !== '0') {
    throw new Error(`El alumno INACTIVO dejó ${todas} fila(s) de inscripción`)
  }

  console.log('OK CONCURRENCIA 3: un alumno INACTIVO no se inscribe bajo concurrencia y no deja ninguna fila')
}

const sesionA = new SesionPsql('A', 'EPT10')
const sesionB = new SesionPsql('B', 'EPT10')

try {
  const pidA = Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pidB = Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pids = { a: pidA, b: pidB }

  // ------------------------------------------------------------------
  // Fixture sintético. Los DNI viven en un rango ficticio por encima de
  // cualquier documento emitido y no corresponden a ninguna persona real.
  // ------------------------------------------------------------------
  // Limpieza y siembra en UNA SOLA transacción. La invariante académica de 008
  // se comprueba con triggers diferidos que miran los dos lados de la relación:
  // borrar las matrículas en una transacción propia dejaría, al confirmarla, un
  // alumno ACTIVO sin matrícula vigente y la limpieza fallaría por la misma
  // regla que protege los datos reales.
  await sesionA.ejecutar(
    `BEGIN;
     DELETE FROM public.inscripciones_servicios
      WHERE alumno_id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.matriculas WHERE alumno_id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.alumnos WHERE perfil_id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.perfiles WHERE id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.cursos WHERE id = '${CURSO}';

     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
     VALUES ('${CURSO}',
             (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO' LIMIT 1),
             '${MARCA}', 'A', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     VALUES
       ('${ACTIVO}', '${ACTIVO}',
        (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
        'Prueba', 'Concurrente', '99910001', 'LEG-EPT10-C1'),
       ('${INACTIVO}', '${INACTIVO}',
        (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
        'Prueba', 'Inactiva', '99910002', NULL);

     INSERT INTO public.matriculas (alumno_id, curso_id) VALUES ('${ACTIVO}', '${CURSO}');
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${ACTIVO}';
     COMMIT;`,
    'preparar_fixture'
  )

  const estadoActivo = await sesionA.escalar(
    `(SELECT estado FROM public.alumnos WHERE perfil_id = '${ACTIVO}')`,
    'verificar_fixture'
  )
  if (estadoActivo !== 'ACTIVO') {
    throw new Error(`El fixture no dejó al alumno ACTIVO (quedó ${estadoActivo})`)
  }

  await probarAltaSimultanea(sesionA, sesionB, pids)
  await probarBajaYReingreso(sesionA, sesionB, pids)
  await probarAlumnoInactivo(sesionA, sesionB, pids)

  await sesionA.ejecutar(
    `RESET ROLE;
     BEGIN;
     DELETE FROM public.inscripciones_servicios
      WHERE alumno_id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.matriculas WHERE alumno_id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.alumnos WHERE perfil_id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.perfiles WHERE id IN ('${ACTIVO}', '${INACTIVO}');
     DELETE FROM public.cursos WHERE id = '${CURSO}';
     COMMIT;`,
    'limpiar_fixture'
  )

  console.log('OK CONCURRENCIA: las tres carreras del comedor quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
