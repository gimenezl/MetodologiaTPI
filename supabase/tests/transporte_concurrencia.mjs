import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real del transporte (EPT-60).
 *
 * Usa DOS conexiones PostgreSQL independientes: cada `SesionPsql` es un
 * proceso `psql` propio, así que compiten de verdad por el bloqueo de la fila
 * de `alumnos` que toma `establecer_recorrido_transporte`. La coordinación es
 * determinista (`pg_blocking_pids`), nunca por tiempo.
 *
 * Demuestra que:
 *   1. Dos cambios simultáneos del mismo alumno a DOS recorridos distintos
 *      dejan exactamente un recorrido activo (el de quien confirma después),
 *      sin perder el historial de los recorridos anteriores.
 *   2. Dos altas simultáneas al MISMO recorrido, sin ninguno activo antes,
 *      no duplican la fila: la segunda es idempotente incluso bajo carrera.
 *   3. Un alumno INACTIVO no consigue establecer un recorrido ni compitiendo
 *      con otra transacción, y no deja ninguna fila.
 *
 * Corre contra la base local descartable. Crea sus propios datos sintéticos y
 * los borra al final como propietario de las tablas; ese borrado no
 * representa ninguna operación disponible en la aplicación, que no tiene
 * DELETE.
 */

const TR_NORTE = 'e0000000-0000-4000-8000-000000000020'
const TR_SUR = 'e0000000-0000-4000-8000-000000000021'
const TR_ESTE = 'e0000000-0000-4000-8000-000000000022'
const ACTIVO = 'ca111111-1111-4111-8111-111111111111'
const INACTIVO = 'ca222222-2222-4222-8222-222222222222'
const CURSO = 'ca333333-3333-4333-8333-333333333333'
const MARCA = 'CONCURRENCIA EPT-60'

function comoAlumno(sub) {
  return `SET ROLE authenticated;
          SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`
}

/**
 * Cambio de recorrido envuelto para poder distinguir el éxito del rechazo.
 * El desenlace se guarda en una variable de sesión y no en un `RAISE NOTICE`,
 * que `psql` manda a la salida de error, no legible desde el flujo de
 * resultados que lee el arnés.
 */
function cambioTolerante(destino) {
  return `DO $prueba$
          BEGIN
            BEGIN
              PERFORM public.establecer_recorrido_transporte('${destino}');
              PERFORM pg_catalog.set_config('ept60.resultado', 'OK', false);
            EXCEPTION
              WHEN SQLSTATE 'P5553' THEN
                PERFORM pg_catalog.set_config('ept60.resultado', 'ALUMNO_INACTIVO', false);
            END;
          END
          $prueba$;`
}

function resultadoDe(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept60.resultado', true)`, etiqueta)
}

async function contarActivasTransporte(sesion, alumno, etiqueta) {
  return sesion.escalar(
    `(SELECT pg_catalog.count(*) FROM public.inscripciones_servicios i
      JOIN public.servicios_escolares s ON s.id = i.servicio_id
      WHERE i.alumno_id = '${alumno}' AND i.estado = 'ACTIVA' AND s.tipo = 'TRANSPORTE')`,
    etiqueta
  )
}

async function contarFilasDelRecorrido(sesion, alumno, recorrido, etiqueta) {
  return sesion.escalar(
    `(SELECT pg_catalog.count(*) FROM public.inscripciones_servicios
      WHERE alumno_id = '${alumno}' AND servicio_id = '${recorrido}')`,
    etiqueta
  )
}

async function recorridoActivo(sesion, alumno, etiqueta) {
  return sesion.escalar(
    `(SELECT s.codigo FROM public.inscripciones_servicios i
      JOIN public.servicios_escolares s ON s.id = i.servicio_id
      WHERE i.alumno_id = '${alumno}' AND i.estado = 'ACTIVA' AND s.tipo = 'TRANSPORTE')`,
    etiqueta
  )
}

/**
 * 1. Cambio simultáneo del mismo alumno a dos recorridos distintos.
 *
 * A abre transacción, bloquea la fila del alumno y cambia a TR-SUR; B intenta
 * cambiar a TR-ESTE al mismo tiempo y queda esperando el mismo bloqueo.
 * Cuando A confirma, B retoma con el estado ya actualizado: cancela TR-SUR (el
 * que dejó A) e instala TR-ESTE. El resultado es exactamente un recorrido
 * activo — el de quien confirmó al final — y ninguno de los tres ciclos se
 * pierde.
 */
async function probarCambioSimultaneoADestintosDistintos(sesionA, sesionB, pids) {
  await sesionA.ejecutar(
    `${comoAlumno(ACTIVO)}
     BEGIN;
     SELECT public.establecer_recorrido_transporte('${TR_SUR}');`,
    'cambio_a_pendiente'
  )

  const cambioB = sesionB.ejecutar(
    `${comoAlumno(ACTIVO)}
     ${cambioTolerante(TR_ESTE)}`,
    'cambio_b_pendiente'
  )

  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', 'confirmar_cambio_a')
  await cambioB

  if ((await resultadoDe(sesionB, 'resultado_cambio_b')) !== 'OK') {
    throw new Error('El segundo cambio de recorrido no se pudo confirmar tras la carrera')
  }

  const activas = await contarActivasTransporte(sesionA, ACTIVO, 'activas_tras_carrera_1')
  const activo = await recorridoActivo(sesionA, ACTIVO, 'recorrido_activo_tras_carrera_1')
  // TR-NORTE nunca formó parte de esta carrera: el alumno no tenía ningún
  // recorrido antes de que A lo inscribiera en TR-SUR como primer paso.
  const filasSur = await contarFilasDelRecorrido(sesionA, ACTIVO, TR_SUR, 'filas_sur')
  const filasEste = await contarFilasDelRecorrido(sesionA, ACTIVO, TR_ESTE, 'filas_este')

  if (activas !== '1' || activo !== 'TR-ESTE') {
    throw new Error(
      `Tras la carrera quedaron ${activas} recorrido(s) activo(s) (${activo}); se esperaba 1 (TR-ESTE)`
    )
  }
  if (filasSur !== '1' || filasEste !== '1') {
    throw new Error(
      `El historial de la carrera no conservó los dos ciclos (sur=${filasSur}, este=${filasEste})`
    )
  }

  console.log(
    'OK CONCURRENCIA 1: dos cambios simultáneos a recorridos distintos dejan exactamente uno activo (el de quien confirma después) y conservan los ciclos anteriores'
  )
}

/**
 * 2. Alta simultánea al MISMO recorrido, sin ninguno activo antes.
 *
 * A abre transacción, bloquea la fila del alumno e instala TR-NORTE; B pide
 * el mismo recorrido al mismo tiempo y queda esperando. Cuando A confirma, B
 * retoma y encuentra que TR-NORTE ya es el recorrido activo: la operación es
 * idempotente y no crea una segunda fila.
 */
async function probarAltaSimultaneaAlMismoRecorrido(sesionA, sesionB, pids) {
  // Sin ningún recorrido activo antes de la carrera: se cancela el que dejó
  // la prueba anterior (TR-ESTE) con la RPC genérica de servicios, que no
  // distingue tipo.
  const activaAnterior = await sesionA.escalar(
    `(SELECT i.id FROM public.inscripciones_servicios i
      JOIN public.servicios_escolares s ON s.id = i.servicio_id
      WHERE i.alumno_id = '${ACTIVO}' AND i.estado = 'ACTIVA' AND s.tipo = 'TRANSPORTE')`,
    'activa_previa'
  )
  await sesionA.ejecutar(
    `${comoAlumno(ACTIVO)}
     SELECT public.cancelar_inscripcion_servicio('${activaAnterior}');`,
    'cancelar_previa'
  )

  await sesionA.ejecutar(
    `${comoAlumno(ACTIVO)}
     BEGIN;
     SELECT public.establecer_recorrido_transporte('${TR_NORTE}');`,
    'alta_a_pendiente'
  )

  const altaB = sesionB.ejecutar(
    `${comoAlumno(ACTIVO)}
     ${cambioTolerante(TR_NORTE)}`,
    'alta_b_pendiente'
  )

  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', 'confirmar_alta_a')
  await altaB

  if ((await resultadoDe(sesionB, 'resultado_alta_b')) !== 'OK') {
    throw new Error('La segunda alta al mismo recorrido no se resolvió de forma idempotente')
  }

  const activas = await contarActivasTransporte(sesionA, ACTIVO, 'activas_tras_carrera_2')
  const filasNorte = await contarFilasDelRecorrido(sesionA, ACTIVO, TR_NORTE, 'filas_norte_tras_carrera_2')

  if (activas !== '1' || filasNorte !== '1') {
    throw new Error(
      `Tras la carrera de altas al mismo recorrido quedaron ${activas} activa(s) y ${filasNorte} fila(s) de TR-NORTE; se esperaba 1 y 1`
    )
  }

  console.log(
    'OK CONCURRENCIA 2: dos altas simultáneas al mismo recorrido no duplican la fila; la segunda es idempotente también bajo carrera'
  )
}

/** 3. Un alumno INACTIVO no establece un recorrido ni compitiendo con otra transacción. */
async function probarAlumnoInactivo(sesionA, sesionB, pids) {
  await sesionA.ejecutar(
    `RESET ROLE;
     BEGIN;
     SELECT estado FROM public.alumnos WHERE perfil_id = '${INACTIVO}' FOR UPDATE;`,
    'bloquear_alumno_inactivo'
  )

  const altaB = sesionB.ejecutar(
    `${comoAlumno(INACTIVO)}
     ${cambioTolerante(TR_NORTE)}`,
    'alta_inactivo_pendiente'
  )

  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', 'liberar_alumno_inactivo')
  await altaB

  if ((await resultadoDe(sesionB, 'resultado_alta_inactivo')) !== 'ALUMNO_INACTIVO') {
    throw new Error('Un alumno INACTIVO consiguió establecer un recorrido bajo concurrencia')
  }

  const todas = await sesionA.escalar(
    `(SELECT pg_catalog.count(*) FROM public.inscripciones_servicios WHERE alumno_id = '${INACTIVO}')`,
    'todas_inactivo'
  )
  if (todas !== '0') {
    throw new Error(`El alumno INACTIVO dejó ${todas} fila(s) de inscripción`)
  }

  console.log('OK CONCURRENCIA 3: un alumno INACTIVO no establece un recorrido bajo concurrencia y no deja ninguna fila')
}

const sesionA = new SesionPsql('A', 'EPT60')
const sesionB = new SesionPsql('B', 'EPT60')

try {
  const pidA = Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pidB = Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pids = { a: pidA, b: pidB }

  // ------------------------------------------------------------------
  // Fixture sintético. Los DNI viven en un rango ficticio por encima de
  // cualquier documento emitido y no corresponden a ninguna persona real.
  // Limpieza y siembra en UNA SOLA transacción: la invariante académica de
  // 008 usa triggers diferidos que miran los dos lados de la relación, así
  // que un DELETE suelto de matriculas/alumnos deja un estado inconsistente
  // a mitad de camino.
  // ------------------------------------------------------------------
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
        'Prueba', 'Concurrente', '98910001', 'LEG-EPT60-C1'),
       ('${INACTIVO}', '${INACTIVO}',
        (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
        'Prueba', 'Inactiva', '98910002', NULL);

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

  await probarCambioSimultaneoADestintosDistintos(sesionA, sesionB, pids)
  await probarAltaSimultaneaAlMismoRecorrido(sesionA, sesionB, pids)
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

  console.log('OK CONCURRENCIA: las tres carreras del transporte quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
