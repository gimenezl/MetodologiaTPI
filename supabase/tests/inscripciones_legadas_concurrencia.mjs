import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de las inscripciones legadas (EPT-66).
 *
 * Usa conexiones PostgreSQL independientes: cada `SesionPsql` es un `psql`
 * propio, de modo que las transacciones compiten de verdad por los bloqueos.
 * La coordinación es determinista (`pg_blocking_pids`), nunca por tiempo.
 *
 * Demuestra que, sin importar el orden ni el camino (función RPC o SQL
 * directo), la última plaza de una actividad nunca se ocupa dos veces:
 *
 *   1. Dos altas simultáneas de la última plaza (alumno vs alumno): una
 *      confirma y la otra recibe cupo completo (23514).
 *   2. Lo mismo con el orden inverso y con el padre inscribiendo a un hijo.
 *   3. Alta por función vs reactivación directa de una fila BAJA (cambio de
 *      estado): se ordenan y solo una ocupa la plaza.
 *   4. Dos altas simultáneas del mismo alumno y la misma actividad: una
 *      confirma y la otra recibe duplicado (23505).
 *   5. Una baja sin confirmar no libera todavía la plaza (la alta ve el cupo
 *      lleno) y, una vez confirmada, la alta procede.
 *
 * Funciona igual con la expansión sola y con expansión + contracción: las
 * escrituras de la prueba usan siempre las funciones RPC y, para el cambio de
 * estado directo, el propietario de las tablas.
 *
 * Corre contra la base descartable (stack local de Supabase por `docker exec`,
 * o `EPT_PSQL_CONEXION` para una base directa). Crea datos sintéticos propios y
 * los retira al final como propietario de las tablas; ese borrado no representa
 * ninguna operación de la aplicación.
 */

const ACT_UNA_PLAZA = 96611
const ACT_DOS_PLAZAS = 96612
const ACT_ORDEN_INVERSO = 96613
const ACT_ESTADO = 96614
const ACT_BAJA = 96615
const ACTIVIDADES = [ACT_UNA_PLAZA, ACT_DOS_PLAZAS, ACT_ORDEN_INVERSO, ACT_ESTADO, ACT_BAJA]

const DIRECTOR = 'c6600000-0000-4000-8000-000000000001'
const ALUMNO_A = 'c6600000-0000-4000-8000-000000000002'
const ALUMNO_B = 'c6600000-0000-4000-8000-000000000003'
const ALUMNO_C = 'c6600000-0000-4000-8000-000000000004'
const PADRE = 'c6600000-0000-4000-8000-000000000005'
const PERFILES = [DIRECTOR, ALUMNO_A, ALUMNO_B, ALUMNO_C, PADRE]

function comoUsuario(sub) {
  return `SET ROLE authenticated;
          SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`
}

/** Alta por función; el desenlace queda en una variable de sesión (no en un NOTICE). */
function altaTolerante(estudiante, actividad) {
  return `DO $prueba$
          BEGIN
            BEGIN
              PERFORM public.inscribir_actividad_legada('${estudiante}', ${actividad});
              PERFORM pg_catalog.set_config('ept66.resultado', 'ALTA', false);
            EXCEPTION
              WHEN SQLSTATE '23514' THEN
                PERFORM pg_catalog.set_config('ept66.resultado', 'CUPO', false);
              WHEN unique_violation THEN
                PERFORM pg_catalog.set_config('ept66.resultado', 'DUPLICADO', false);
              WHEN OTHERS THEN
                PERFORM pg_catalog.set_config('ept66.resultado', 'ERROR_' || SQLSTATE, false);
            END;
          END
          $prueba$;`
}

/** Reactivación directa (SQL) de una fila BAJA; también deja su desenlace en una variable. */
function reactivacionTolerante(inscripcionId) {
  return `DO $prueba$
          BEGIN
            BEGIN
              UPDATE public.inscripciones
              SET estado = 'ACTIVO', fecha_baja = NULL
              WHERE id = '${inscripcionId}';
              PERFORM pg_catalog.set_config('ept66.resultado', 'REACTIVADA', false);
            EXCEPTION
              WHEN SQLSTATE '23514' THEN
                PERFORM pg_catalog.set_config('ept66.resultado', 'CUPO', false);
              WHEN OTHERS THEN
                PERFORM pg_catalog.set_config('ept66.resultado', 'ERROR_' || SQLSTATE, false);
            END;
          END
          $prueba$;`
}

function resultadoDe(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept66.resultado', true)`, etiqueta)
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

async function activas(observador, actividad, etiqueta) {
  return observador.escalar(
    `(SELECT pg_catalog.count(*) FROM public.inscripciones
      WHERE actividad_id = ${actividad} AND estado = 'ACTIVO')`,
    etiqueta
  )
}

async function limpiarEntreCasos(observador) {
  await observador.ejecutar(
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.inscripciones WHERE actividad_id IN (${ACTIVIDADES.join(', ')});
     COMMIT;`,
    'limpiar_inscripciones'
  )
}

/**
 * Patrón común: A abre una transacción y ocupa la plaza SIN confirmar; B intenta
 * lo mismo y queda bloqueada; A confirma; B recibe el desenlace de la carrera.
 */
async function carrera({ A, B, observador, pids, comoA, comoB, operacionA, operacionB, actividad, etiqueta }) {
  await A.ejecutar(`${comoA} BEGIN; ${operacionA}`, `${etiqueta}_a_pendiente`)
  const pendienteB = B.ejecutar(`${comoB} ${operacionB}`, `${etiqueta}_b_pendiente`)
  await esperarBloqueo(observador, pids.a, pids.b)
  await A.ejecutar('COMMIT;', `${etiqueta}_confirmar_a`)
  await pendienteB
  const resultadoA = await resultadoDe(A, `${etiqueta}_resultado_a`)
  const resultadoB = await resultadoDe(B, `${etiqueta}_resultado_b`)
  const ocupadas = await activas(observador, actividad, `${etiqueta}_activas`)
  return { resultadoA, resultadoB, ocupadas }
}

const A = new SesionPsql('A', 'EPT66')
const B = new SesionPsql('B', 'EPT66')
const observador = new SesionPsql('OBS', 'EPT66')

try {
  const pids = {
    a: Number(await A.escalar('pg_catalog.pg_backend_pid()', 'pid_a')),
    b: Number(await B.escalar('pg_catalog.pg_backend_pid()', 'pid_b')),
  }

  // ------------------------------------------------------------------
  // Fixture sintético en UNA transacción (DNI en el rango reservado 97…).
  // ------------------------------------------------------------------
  await observador.ejecutar(
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.inscripciones WHERE actividad_id IN (${ACTIVIDADES.join(', ')});
     DELETE FROM public.padres_hijos WHERE padre_id = '${PADRE}';
     DELETE FROM public.alumnos WHERE perfil_id IN ('${ALUMNO_A}', '${ALUMNO_B}', '${ALUMNO_C}');
     DELETE FROM public.perfiles WHERE id IN (${PERFILES.map((id) => `'${id}'`).join(', ')});
     DELETE FROM public.actividades WHERE id IN (${ACTIVIDADES.join(', ')});
     COMMIT;
     BEGIN;
     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id, v.id, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${DIRECTOR}'::uuid, 'DIRECTOR',   'Directora', '97661001', NULL),
       ('${ALUMNO_A}'::uuid, 'ESTUDIANTE', 'Carrera A', '97661002', 'LEG-66-C2'),
       ('${ALUMNO_B}'::uuid, 'ESTUDIANTE', 'Carrera B', '97661003', 'LEG-66-C3'),
       ('${ALUMNO_C}'::uuid, 'ESTUDIANTE', 'Carrera C', '97661004', 'LEG-66-C4'),
       ('${PADRE}'::uuid,    'PADRE',      'Carrera P', '97661005', NULL)
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;
     INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES ('${PADRE}', '${ALUMNO_A}');
     INSERT INTO public.actividades (id, nombre, tipo, cupo_maximo, activo) VALUES
       (${ACT_UNA_PLAZA}, 'Concurrencia EPT-66 de una plaza', 'TALLER', 1, TRUE),
       (${ACT_DOS_PLAZAS}, 'Concurrencia EPT-66 de dos plazas', 'TALLER', 2, TRUE),
       (${ACT_ORDEN_INVERSO}, 'Concurrencia EPT-66 orden inverso', 'TALLER', 1, TRUE),
       (${ACT_ESTADO}, 'Concurrencia EPT-66 cambio de estado', 'TALLER', 1, TRUE),
       (${ACT_BAJA}, 'Concurrencia EPT-66 baja y alta', 'TALLER', 1, TRUE);
     COMMIT;`,
    'preparar_fixture'
  )

  // ------------------------------------------------------------------
  // 1. Última plaza: alumno A vs alumno B.
  // ------------------------------------------------------------------
  let r = await carrera({
    A, B, observador, pids, actividad: ACT_UNA_PLAZA, etiqueta: 'c1',
    comoA: comoUsuario(ALUMNO_A), operacionA: altaTolerante(ALUMNO_A, ACT_UNA_PLAZA),
    comoB: comoUsuario(ALUMNO_B), operacionB: altaTolerante(ALUMNO_B, ACT_UNA_PLAZA),
  })
  exigir(r.resultadoA === 'ALTA' && r.resultadoB === 'CUPO' && r.ocupadas === '1',
    `CONCURRENCIA 1: A=${r.resultadoA} B=${r.resultadoB} ocupadas=${r.ocupadas}; se esperaba ALTA/CUPO/1`)
  console.log('OK CONCURRENCIA 1: dos altas simultáneas de la última plaza dejan una sola ocupada (la otra, cupo completo)')

  // ------------------------------------------------------------------
  // 2. Orden inverso, y el padre compite con el alumno por su hijo vs otro alumno.
  // ------------------------------------------------------------------
  r = await carrera({
    A, B, observador, pids, actividad: ACT_ORDEN_INVERSO, etiqueta: 'c2',
    comoA: comoUsuario(ALUMNO_B), operacionA: altaTolerante(ALUMNO_B, ACT_ORDEN_INVERSO),
    comoB: comoUsuario(PADRE), operacionB: altaTolerante(ALUMNO_A, ACT_ORDEN_INVERSO),
  })
  exigir(r.resultadoA === 'ALTA' && r.resultadoB === 'CUPO' && r.ocupadas === '1',
    `CONCURRENCIA 2: A=${r.resultadoA} B=${r.resultadoB} ocupadas=${r.ocupadas}; se esperaba ALTA/CUPO/1`)
  console.log('OK CONCURRENCIA 2: con el orden inverso y el padre como competidor, la plaza tampoco se ocupa dos veces')

  // ------------------------------------------------------------------
  // 3. Alta por función vs cambio de estado directo (reactivación de una BAJA).
  // ------------------------------------------------------------------
  const filaBaja = 'd6600000-0000-4000-8000-000000000001'
  await observador.ejecutar(
    `INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado, fecha_baja)
     VALUES ('${filaBaja}', '${ALUMNO_C}', ${ACT_ESTADO}, 'BAJA', pg_catalog.now());`,
    'sembrar_baja_historica'
  )
  // A reactiva (sin confirmar) y B intenta el alta por función de la misma plaza.
  r = await carrera({
    A, B, observador, pids, actividad: ACT_ESTADO, etiqueta: 'c3',
    comoA: 'RESET ROLE;', operacionA: reactivacionTolerante(filaBaja),
    comoB: comoUsuario(ALUMNO_B), operacionB: altaTolerante(ALUMNO_B, ACT_ESTADO),
  })
  exigir(r.resultadoA === 'REACTIVADA' && r.resultadoB === 'CUPO' && r.ocupadas === '1',
    `CONCURRENCIA 3: A=${r.resultadoA} B=${r.resultadoB} ocupadas=${r.ocupadas}; se esperaba REACTIVADA/CUPO/1`)
  const conservada = await observador.escalar(
    `(SELECT count(*) FROM public.inscripciones WHERE actividad_id = ${ACT_ESTADO})`, 'filas_c3')
  exigir(conservada === '1', `CONCURRENCIA 3: se esperaba 1 fila y hay ${conservada}`)
  // Y al revés: B (alta por función) confirma primero y la reactivación directa pierde.
  await observador.ejecutar(
    `UPDATE public.inscripciones SET estado = 'BAJA', fecha_baja = pg_catalog.now() WHERE id = '${filaBaja}';`,
    'devolver_a_baja')
  r = await carrera({
    A, B, observador, pids, actividad: ACT_ESTADO, etiqueta: 'c3b',
    comoA: comoUsuario(ALUMNO_B), operacionA: altaTolerante(ALUMNO_B, ACT_ESTADO),
    comoB: 'RESET ROLE;', operacionB: reactivacionTolerante(filaBaja),
  })
  exigir(r.resultadoA === 'ALTA' && r.resultadoB === 'CUPO' && r.ocupadas === '1',
    `CONCURRENCIA 3b: A=${r.resultadoA} B=${r.resultadoB} ocupadas=${r.ocupadas}; se esperaba ALTA/CUPO/1`)
  console.log('OK CONCURRENCIA 3: el alta por función y la reactivación directa de una BAJA se ordenan: solo una ocupa la plaza, en ambos órdenes')

  // ------------------------------------------------------------------
  // 4. Mismo alumno y misma actividad: alumno A vs su padre (misma persona inscripta).
  // ------------------------------------------------------------------
  r = await carrera({
    A, B, observador, pids, actividad: ACT_DOS_PLAZAS, etiqueta: 'c4',
    comoA: comoUsuario(ALUMNO_A), operacionA: altaTolerante(ALUMNO_A, ACT_DOS_PLAZAS),
    comoB: comoUsuario(PADRE), operacionB: altaTolerante(ALUMNO_A, ACT_DOS_PLAZAS),
  })
  exigir(r.resultadoA === 'ALTA' && r.resultadoB === 'DUPLICADO' && r.ocupadas === '1',
    `CONCURRENCIA 4: A=${r.resultadoA} B=${r.resultadoB} ocupadas=${r.ocupadas}; se esperaba ALTA/DUPLICADO/1`)
  console.log('OK CONCURRENCIA 4: alumno y padre inscribiendo a la misma persona a la vez dejan una sola inscripción activa (la otra, 23505)')

  // ------------------------------------------------------------------
  // 5. Una baja sin confirmar no libera la plaza; confirmada, la alta procede.
  // ------------------------------------------------------------------
  await observador.ejecutar(
    `INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado)
     VALUES ('d6600000-0000-4000-8000-000000000002', '${ALUMNO_C}', ${ACT_BAJA}, 'ACTIVO');`,
    'sembrar_titular')
  await A.ejecutar(
    `${comoUsuario(ALUMNO_C)} BEGIN;
     SELECT public.dar_baja_inscripcion_legada('d6600000-0000-4000-8000-000000000002');`,
    'c5_baja_pendiente')
  await B.ejecutar(`${comoUsuario(ALUMNO_B)} ${altaTolerante(ALUMNO_B, ACT_BAJA)}`, 'c5_alta_con_baja_pendiente')
  const durante = await resultadoDe(B, 'c5_resultado_durante')
  exigir(durante === 'CUPO', `CONCURRENCIA 5: con la baja sin confirmar se esperaba CUPO y fue ${durante}`)
  await A.ejecutar('COMMIT;', 'c5_confirmar_baja')
  await B.ejecutar(altaTolerante(ALUMNO_B, ACT_BAJA), 'c5_alta_tras_baja')
  const despues = await resultadoDe(B, 'c5_resultado_despues')
  const finales = await activas(observador, ACT_BAJA, 'c5_activas')
  exigir(despues === 'ALTA' && finales === '1',
    `CONCURRENCIA 5: tras confirmar la baja se esperaba ALTA y 1 activa; fue ${despues} y ${finales}`)
  console.log('OK CONCURRENCIA 5: la baja sin confirmar no libera la plaza y, confirmada, la alta procede; el titular anterior queda como BAJA')

  // Historia: ninguna fila BAJA se perdió en toda la prueba.
  const bajas = await observador.escalar(
    `(SELECT count(*) FROM public.inscripciones WHERE actividad_id IN (${ACTIVIDADES.join(', ')}) AND estado = 'BAJA')`,
    'bajas_conservadas')
  exigir(bajas === '2', `Se esperaban 2 filas BAJA conservadas y hay ${bajas}`)
  console.log('OK CONCURRENCIA 6: las filas BAJA se conservaron como historia durante todas las carreras')

  // ------------------------------------------------------------------
  // Limpieza
  // ------------------------------------------------------------------
  await limpiarEntreCasos(observador)
  await observador.ejecutar(
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.padres_hijos WHERE padre_id = '${PADRE}';
     DELETE FROM public.alumnos WHERE perfil_id IN ('${ALUMNO_A}', '${ALUMNO_B}', '${ALUMNO_C}');
     DELETE FROM public.perfiles WHERE id IN (${PERFILES.map((id) => `'${id}'`).join(', ')});
     DELETE FROM public.actividades WHERE id IN (${ACTIVIDADES.join(', ')});
     COMMIT;`,
    'limpiar_fixture'
  )
  console.log('OK: concurrencia de inscripciones legadas (EPT-66) sin hallazgos')
} catch (error) {
  console.error(`FALLO: ${error.message}`)
  process.exitCode = 1
} finally {
  await Promise.allSettled([A.cerrar(), B.cerrar(), observador.cerrar()])
}
