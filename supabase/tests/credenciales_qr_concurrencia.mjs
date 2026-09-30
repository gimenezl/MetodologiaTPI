import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la credencial QR (EPT-64).
 *
 * Usa conexiones PostgreSQL independientes: cada `SesionPsql` es un proceso
 * `psql` propio, así que compiten de verdad por el candado de la fila de
 * `alumnos` que toman emitir, reponer y revocar. La coordinación de los casos
 * de a dos es determinista (`pg_blocking_pids`), nunca por tiempo; los casos de
 * ráfaga lanzan varias conexiones a la vez y verifican el resultado agregado.
 *
 * Demuestra que:
 *   1. Dos emisiones simultáneas para el mismo alumno dejan UNA sola ACTIVA;
 *      la segunda falla con P5621.
 *   2. Dos reposiciones simultáneas de la misma credencial dejan UNA sola ACTIVA
 *      (la de la primera); la segunda falla con P5623 y no revoca a la nueva.
 *   3. Reposición frente a revocación, en los dos órdenes, tiene un desenlace
 *      definido y jamás deja dos ACTIVAS.
 *   4. Una emisión o reposición frente a la inactivación o reactivación del mismo
 *      alumno se serializa, sin deadlock: quien llega después de inactivar recibe
 *      P5627 y no deja filas ni toca la vigente; revocar sigue permitido. La
 *      credencial no se modifica por el cambio de estado del alumno (la validez
 *      se calcula al consultar).
 *   5. Una ráfaga de seis emisiones y de seis reposiciones simultáneas deja
 *      exactamente una ACTIVA y el resto rechazadas con el código previsto.
 *
 * Corre contra la base local descartable. Crea sus propios datos sintéticos y
 * los borra al final como propietario; para vaciar el historial inmutable
 * desactiva EXPLÍCITAMENTE los triggers de la tabla dentro de esa transacción
 * de limpieza. Ese borrado no representa ninguna operación disponible en la
 * aplicación.
 */

const DIRECTORA = 'ea640000-0000-4000-8000-0000000000d1'
const CURSO = 'ea640000-0000-4000-8000-0000000000c1'
const ALUMNOS = {
  emision: 'ea640000-0000-4000-8000-0000000000a1',
  reposicion: 'ea640000-0000-4000-8000-0000000000a2',
  cruce: 'ea640000-0000-4000-8000-0000000000a3',
  estado: 'ea640000-0000-4000-8000-0000000000a4',
  rafagaEmision: 'ea640000-0000-4000-8000-0000000000a5',
  rafagaReposicion: 'ea640000-0000-4000-8000-0000000000a6',
}
const TODOS = Object.values(ALUMNOS)
const MARCA = 'CONCURRENCIA EPT-64'
const KID = 'k1'

const comoDirectora = `SET ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"${DIRECTORA}"}', false);`

/** Envuelve una llamada para distinguir éxito y rechazo sin abortar la sesión. */
function tolerante(llamada) {
  return `DO $prueba$
          BEGIN
            BEGIN
              PERFORM ${llamada};
              PERFORM pg_catalog.set_config('ept64.resultado', 'OK', false);
            EXCEPTION
              WHEN OTHERS THEN
                PERFORM pg_catalog.set_config('ept64.resultado', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

const emitir = (alumno) => `public.emitir_credencial_qr('${alumno}', '${KID}')`
const reponer = (id) => `public.reponer_credencial_qr('${id}', '${KID}', 'Reposición concurrente')`
const revocar = (id) => `public.revocar_credencial_qr('${id}', 'Revocación concurrente')`

const resultadoDe = (sesion, etiqueta) =>
  sesion.escalar(`pg_catalog.current_setting('ept64.resultado', true)`, etiqueta)

const activas = (sesion, alumno, etiqueta) =>
  sesion.escalar(
    `(SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA')`,
    etiqueta
  )

const filas = (sesion, alumno, etiqueta) =>
  sesion.escalar(
    `(SELECT pg_catalog.count(*) FROM public.credenciales_qr WHERE alumno_id = '${alumno}')`,
    etiqueta
  )

const idActiva = (sesion, alumno, etiqueta) =>
  sesion.escalar(
    `(SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA')`,
    etiqueta
  )

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

/** Emite una credencial como Dirección y devuelve su identificador. */
async function emitirYConfirmar(sesion, alumno, etiqueta) {
  await sesion.ejecutar(
    `${comoDirectora}
     ${tolerante(emitir(alumno))}
     RESET ROLE;`,
    `emitir_${etiqueta}`
  )
  exigir((await resultadoDe(sesion, `resultado_${etiqueta}`)) === 'OK', `No se pudo emitir para ${etiqueta}`)
  return idActiva(sesion, alumno, `id_${etiqueta}`)
}

/** 1. Dos emisiones simultáneas del mismo alumno. */
async function probarDobleEmision(a, b, pids) {
  await a.ejecutar(
    `${comoDirectora}
     BEGIN;
     SELECT ${emitir(ALUMNOS.emision)};`,
    'emision_a_pendiente'
  )
  const emisionB = b.ejecutar(`${comoDirectora}\n${tolerante(emitir(ALUMNOS.emision))}`, 'emision_b_pendiente')

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'confirmar_emision_a')
  await emisionB

  const resultado = await resultadoDe(b, 'resultado_emision_b')
  exigir(resultado === 'P5621', `La segunda emisión debía fallar con P5621 y dio ${resultado}`)
  const n = await activas(a, ALUMNOS.emision, 'activas_doble_emision')
  exigir(n === '1', `Tras la doble emisión hay ${n} ACTIVA(s); se esperaba 1`)
  exigir((await filas(a, ALUMNOS.emision, 'filas_doble_emision')) === '1', 'La segunda emisión dejó una fila')
  console.log('OK CONCURRENCIA 1: dos emisiones simultáneas dejan una sola ACTIVA; la segunda falla con P5621')
}

/** 2. Dos reposiciones simultáneas de la misma credencial. */
async function probarDobleReposicion(a, b, pids) {
  const original = await emitirYConfirmar(a, ALUMNOS.reposicion, 'reposicion')
  await a.ejecutar(
    `${comoDirectora}
     BEGIN;
     SELECT ${reponer(original)};`,
    'reposicion_a_pendiente'
  )
  const reposicionB = b.ejecutar(`${comoDirectora}\n${tolerante(reponer(original))}`, 'reposicion_b_pendiente')

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'confirmar_reposicion_a')
  await reposicionB

  const resultado = await resultadoDe(b, 'resultado_reposicion_b')
  exigir(resultado === 'P5623', `La segunda reposición debía fallar con P5623 y dio ${resultado}`)
  const n = await activas(a, ALUMNOS.reposicion, 'activas_doble_reposicion')
  const total = await filas(a, ALUMNOS.reposicion, 'filas_doble_reposicion')
  const vigente = await idActiva(a, ALUMNOS.reposicion, 'vigente_doble_reposicion')
  exigir(n === '1' && total === '2', `Tras la doble reposición hay ${n} ACTIVA(s) y ${total} fila(s); se esperaba 1 y 2`)
  exigir(vigente !== original, 'La reposición perdedora revocó a la credencial nueva de la ganadora')
  console.log('OK CONCURRENCIA 2: dos reposiciones simultáneas dejan una sola ACTIVA y la segunda no revoca a la nueva (P5623)')
}

/** 3. Reposición frente a revocación, en los dos órdenes. */
async function probarReposicionContraRevocacion(a, b, pids) {
  const original = await emitirYConfirmar(a, ALUMNOS.cruce, 'cruce')

  // 3a. Gana la reposición; la revocación de la credencial vieja llega tarde.
  await a.ejecutar(`${comoDirectora}\nBEGIN;\nSELECT ${reponer(original)};`, 'cruce_reponer_a')
  const revocacionB = b.ejecutar(`${comoDirectora}\n${tolerante(revocar(original))}`, 'cruce_revocar_b')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'cruce_confirmar_a')
  await revocacionB
  const resultado3a = await resultadoDe(b, 'resultado_cruce_b')
  exigir(resultado3a === 'P5623', `Revocar tras reponer debía fallar con P5623 y dio ${resultado3a}`)
  exigir((await activas(a, ALUMNOS.cruce, 'activas_cruce_a')) === '1', 'Tras reponer y revocar tarde no quedó una ACTIVA')
  const nueva = await idActiva(a, ALUMNOS.cruce, 'vigente_cruce_a')
  exigir(nueva !== original, 'La credencial vigente debía ser la nueva')

  // 3b. Gana la revocación de la vigente; la reposición llega tarde.
  await a.ejecutar(`${comoDirectora}\nBEGIN;\nSELECT ${revocar(nueva)};`, 'cruce_revocar_a')
  const reposicionB = b.ejecutar(`${comoDirectora}\n${tolerante(reponer(nueva))}`, 'cruce_reponer_b')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'cruce_confirmar_revocacion_a')
  await reposicionB
  const resultado3b = await resultadoDe(b, 'resultado_cruce_reponer_b')
  exigir(resultado3b === 'P5623', `Reponer tras revocar debía fallar con P5623 y dio ${resultado3b}`)
  exigir((await activas(a, ALUMNOS.cruce, 'activas_cruce_b')) === '0', 'Tras revocar y reponer tarde quedó una ACTIVA')
  exigir((await filas(a, ALUMNOS.cruce, 'filas_cruce_b')) === '2', 'El cruce no conservó exactamente las dos filas')
  console.log('OK CONCURRENCIA 3: reposición y revocación compiten con desenlace definido en ambos órdenes y sin dos ACTIVAS')
}

/** 4. Emisión y reposición frente a inactivar y reactivar el mismo alumno. */
async function probarCambioDeEstadoDelAlumno(a, b, pids) {
  const alumno = ALUMNOS.estado
  const estadoDelAlumno = (etiqueta) =>
    a.escalar(`(SELECT estado FROM public.alumnos WHERE perfil_id = '${alumno}')`, etiqueta)

  // 4a. Inactivar mantiene alumnos FOR UPDATE; la emisión espera y, al recibir el candado, ya
  // encuentra al alumno INACTIVO: se rechaza (P5627) y no queda ninguna fila.
  await a.ejecutar(
    `${comoDirectora}
     BEGIN;
     SELECT public.inactivar_alumno('${alumno}');`,
    'estado_inactivar_a'
  )
  const emisionB = b.ejecutar(`${comoDirectora}
${tolerante(emitir(alumno))}`, 'estado_emitir_b')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'estado_confirmar_inactivar')
  await emisionB
  const resultado4a = await resultadoDe(b, 'resultado_estado_emitir_b')
  exigir(resultado4a === 'P5627', `La emisión tras inactivar debía fallar con P5627 y dio ${resultado4a}`)
  exigir((await estadoDelAlumno('estado_alumno_a')) === 'INACTIVO', 'El alumno debía quedar INACTIVO')
  exigir((await filas(a, alumno, 'filas_estado_4a')) === '0', 'La emisión rechazada dejó una fila')

  // 4b. Se reactiva y se emite. Con la reposición SIN confirmar, la inactivación espera y el
  // resultado es coherente: la reposición ya estaba decidida y la inactivación va después.
  await a.ejecutar(`${comoDirectora}
${tolerante(`public.reactivar_alumno('${alumno}', '${CURSO}')`)}`, 'estado_reactivar')
  exigir((await resultadoDe(a, 'resultado_estado_reactivar')) === 'OK', 'No se pudo reactivar al alumno')
  const original = await emitirYConfirmar(a, alumno, 'estado')
  await a.ejecutar(`${comoDirectora}
BEGIN;
SELECT ${reponer(original)};`, 'estado_reponer_a')
  const inactivarB = b.ejecutar(`${comoDirectora}
${tolerante(`public.inactivar_alumno('${alumno}')`)}`, 'estado_inactivar_b')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'estado_confirmar_reponer')
  await inactivarB
  exigir(
    (await resultadoDe(b, 'resultado_estado_inactivar_b')) === 'OK',
    'La inactivación tras reponer debía completarse'
  )
  const vigente = await idActiva(a, alumno, 'estado_vigente_4b')
  exigir(
    (await activas(a, alumno, 'activas_estado_4b')) === '1' && (await filas(a, alumno, 'filas_estado_4b')) === '2',
    'Tras reponer e inactivar debía haber 1 ACTIVA y 2 filas'
  )
  exigir(vigente !== original, 'La vigente debía ser la nueva')
  exigir((await estadoDelAlumno('estado_alumno_4b')) === 'INACTIVO', 'El alumno debía quedar INACTIVO')

  // 4c. Con la inactivación SIN confirmar, una reposición espera y luego se rechaza (P5627):
  // la vigente NO se revoca y no se crea otra. Revocar, en cambio, sigue permitido.
  await a.ejecutar(`${comoDirectora}
BEGIN;
SELECT public.reactivar_alumno('${alumno}', '${CURSO}');`, 'estado_reactivar_a')
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'estado_confirmar_reactivar')
  await a.ejecutar(`${comoDirectora}
BEGIN;
SELECT public.inactivar_alumno('${alumno}');`, 'estado_inactivar_a2')
  const reposicionB = b.ejecutar(`${comoDirectora}
${tolerante(reponer(vigente))}`, 'estado_reponer_b')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;\nRESET ROLE;', 'estado_confirmar_inactivar_2')
  await reposicionB
  const resultado4c = await resultadoDe(b, 'resultado_estado_reponer_b')
  exigir(resultado4c === 'P5627', `La reposición tras inactivar debía fallar con P5627 y dio ${resultado4c}`)
  exigir(
    (await idActiva(a, alumno, 'estado_vigente_4c')) === vigente && (await filas(a, alumno, 'filas_estado_4c')) === '2',
    'La reposición rechazada tocó la credencial vigente o creó otra'
  )
  await a.ejecutar(`${comoDirectora}
${tolerante(revocar(vigente))}`, 'estado_revocar_inactivo')
  exigir((await resultadoDe(a, 'resultado_estado_revocar')) === 'OK', 'Revocar con el alumno inactivo debía poder')
  await a.ejecutar('RESET ROLE;', 'estado_reset_final')
  exigir((await activas(a, alumno, 'activas_estado_4c')) === '0', 'Tras revocar no debía quedar ninguna ACTIVA')
  console.log('OK CONCURRENCIA 4: emisión y reposición se serializan con inactivar/reactivar sin deadlock; con el alumno inactivo se rechazan (P5627) y revocar sigue permitido')
}

/** 5. Ráfagas de seis conexiones simultáneas. */
async function probarRafagas() {
  const sesiones = Array.from({ length: 6 }, (_, i) => new SesionPsql(`R${i}`, 'EPT64R'))
  try {
    await Promise.all(sesiones.map((s) => s.ejecutar(comoDirectora, 'rol')))

    // 5a. Seis emisiones a la vez para el mismo alumno.
    await Promise.all(sesiones.map((s) => s.ejecutar(tolerante(emitir(ALUMNOS.rafagaEmision)), 'emitir')))
    const emisiones = await Promise.all(sesiones.map((s) => resultadoDe(s, 'resultado_emitir')))
    const exitosas = emisiones.filter((r) => r === 'OK').length
    const rechazadas = emisiones.filter((r) => r === 'P5621').length
    exigir(
      exitosas === 1 && rechazadas === 5,
      `Ráfaga de emisión: ${exitosas} éxito(s), ${rechazadas} P5621, resultados ${emisiones.join(',')}`
    )
    exigir((await activas(sesiones[0], ALUMNOS.rafagaEmision, 'activas_rafaga_emision')) === '1', 'Ráfaga de emisión: no hay una sola ACTIVA')
    exigir((await filas(sesiones[0], ALUMNOS.rafagaEmision, 'filas_rafaga_emision')) === '1', 'Ráfaga de emisión: hay filas de más')

    // 5b. Seis reposiciones a la vez de la misma credencial.
    await sesiones[0].ejecutar('RESET ROLE;', 'reset')
    const base = await emitirYConfirmar(sesiones[0], ALUMNOS.rafagaReposicion, 'rafaga_reposicion')
    await sesiones[0].ejecutar(comoDirectora, 'rol_de_nuevo')
    await Promise.all(sesiones.map((s) => s.ejecutar(tolerante(reponer(base)), 'reponer')))
    const reposiciones = await Promise.all(sesiones.map((s) => resultadoDe(s, 'resultado_reponer')))
    const ok = reposiciones.filter((r) => r === 'OK').length
    const obsoletas = reposiciones.filter((r) => r === 'P5623').length
    exigir(
      ok === 1 && obsoletas === 5,
      `Ráfaga de reposición: ${ok} éxito(s), ${obsoletas} P5623, resultados ${reposiciones.join(',')}`
    )
    exigir((await activas(sesiones[0], ALUMNOS.rafagaReposicion, 'activas_rafaga_reposicion')) === '1', 'Ráfaga de reposición: no hay una sola ACTIVA')
    exigir((await filas(sesiones[0], ALUMNOS.rafagaReposicion, 'filas_rafaga_reposicion')) === '2', 'Ráfaga de reposición: no hay exactamente 2 filas')
    console.log('OK CONCURRENCIA 5: ráfagas de 6 emisiones y 6 reposiciones simultáneas dejan exactamente una ACTIVA')
  } finally {
    await Promise.allSettled(sesiones.map((s) => s.ejecutar('RESET ROLE;\nROLLBACK;', 'limpieza')))
    await Promise.allSettled(sesiones.map((s) => s.cerrar()))
  }
}

const sesionA = new SesionPsql('A', 'EPT64')
const sesionB = new SesionPsql('B', 'EPT64')

const limpiar = `RESET ROLE;
  BEGIN;
  ALTER TABLE public.credenciales_qr DISABLE TRIGGER USER;
  DELETE FROM public.credenciales_qr
   WHERE alumno_id IN (${TODOS.map((id) => `'${id}'`).join(', ')});
  ALTER TABLE public.credenciales_qr ENABLE TRIGGER USER;
  DELETE FROM public.matriculas WHERE alumno_id IN (${TODOS.map((id) => `'${id}'`).join(', ')});
  DELETE FROM public.alumnos WHERE perfil_id IN (${TODOS.map((id) => `'${id}'`).join(', ')});
  DELETE FROM public.perfiles WHERE id IN (${[DIRECTORA, ...TODOS].map((id) => `'${id}'`).join(', ')});
  DELETE FROM public.cursos WHERE id = '${CURSO}';
  COMMIT;`

try {
  const pids = {
    a: Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid')),
    b: Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid')),
  }

  // Fixture sintético en UNA sola transacción (la invariante académica de 008
  // usa triggers diferidos que miran los dos lados de la relación).
  await sesionA.ejecutar(limpiar, 'limpiar_previa')
  const dnis = TODOS.map((_, i) => `9892${String(i + 1).padStart(4, '0')}`)
  await sesionA.ejecutar(
    `BEGIN;
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
     VALUES ('${CURSO}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO' LIMIT 1), '${MARCA}', 'A', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
     VALUES ('${DIRECTORA}', '${DIRECTORA}', (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),
             'Directora', 'Concurrente', '98929999');

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     VALUES ${TODOS.map(
       (id, i) =>
         `('${id}', '${id}', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Alumno', 'Concurrente ${i + 1}', '${dnis[i]}', 'LEG-EPT64-C${i + 1}')`
     ).join(',\n            ')};

     INSERT INTO public.matriculas (alumno_id, curso_id)
     VALUES ${TODOS.map((id) => `('${id}', '${CURSO}')`).join(', ')};
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${TODOS.map((id) => `'${id}'`).join(', ')});
     COMMIT;`,
    'preparar_fixture'
  )

  const listos = await sesionA.escalar(
    `(SELECT pg_catalog.count(*) FROM public.alumnos WHERE perfil_id IN (${TODOS.map((id) => `'${id}'`).join(', ')}) AND estado = 'ACTIVO')`,
    'verificar_fixture'
  )
  exigir(listos === String(TODOS.length), `El fixture dejó ${listos} alumnos ACTIVOS de ${TODOS.length}`)

  await probarDobleEmision(sesionA, sesionB, pids)
  await probarDobleReposicion(sesionA, sesionB, pids)
  await probarReposicionContraRevocacion(sesionA, sesionB, pids)
  await probarCambioDeEstadoDelAlumno(sesionA, sesionB, pids)
  await probarRafagas()

  // Invariante global sobre todo lo que creó la prueba.
  const duplicadas = await sesionA.escalar(
    `(SELECT pg_catalog.count(*) FROM (
        SELECT alumno_id FROM public.credenciales_qr WHERE estado = 'ACTIVA'
        GROUP BY alumno_id HAVING pg_catalog.count(*) > 1) d)`,
    'duplicadas_globales'
  )
  exigir(duplicadas === '0', `Hay ${duplicadas} alumno(s) con más de una ACTIVA`)

  await sesionA.ejecutar(limpiar, 'limpiar_final')
  console.log('OK CONCURRENCIA: las cinco carreras de la credencial QR quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
