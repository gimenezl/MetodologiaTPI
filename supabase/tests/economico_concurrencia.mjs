import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real del esquema económico (EPT-100).
 *
 * Usa DOS conexiones PostgreSQL independientes: cada `SesionPsql` es un `psql`
 * propio, así que compiten de verdad por los bloqueos de fila y de índice. La
 * coordinación es determinista (`pg_blocking_pids`), nunca por tiempo.
 *
 * Demuestra que las garantías que EPT-100 delega en índices, restricciones de
 * exclusión y triggers de integridad se sostienen entre transacciones:
 *   1. Dos vigencias de tarifa que se solapan no confirman las dos (23P01), y si
 *      la primera revierte, la segunda sí entra.
 *   2. Dos pagos con el mismo número de operación no confirman los dos (23505),
 *      y si el primero revierte, el número queda libre.
 *   3. Un ítem no queda con dos imputaciones activas (23505).
 *   4. Una factura por alumno y período, aun con dos generaciones simultáneas.
 *   5. Una tarifa no cambia de referencia mientras otra transacción factura un
 *      ítem con ella: el trigger toma FOR SHARE y la guarda espera y luego ve el
 *      ítem (P6804). Sin ese bloqueo el cambio se colaría y dejaría el ítem
 *      incoherente con su tarifa.
 *
 * Corre contra la base local descartable e identificada; para el stack aislado
 * de la unidad: `EPT_SUPABASE_DB_CONTAINER=supabase_db_ept100`. Crea sus propios
 * datos sintéticos y los borra al final como propietario de las tablas; ese
 * borrado no representa ninguna operación disponible en la aplicación.
 */

const ID = (n) => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ALUMNO = ID(1)
const PADRE = ID(2)
const DIRECTOR = ID(3)
const CURSO = ID(11)
const MATRICULA = ID(21)
const DEPORTE = ID(31)
const TARIFA_A = ID(41) // CUOTA del nivel 1, vigente en 2050
const TARIFA_B = ID(42) // CUOTA del nivel 1, vigente desde 2051
const FACTURA_1 = ID(51)
const FACTURA_2 = ID(52)
const ITEM_1 = ID(61)
const PAGO_1 = ID(71)
const PAGO_2 = ID(72)
const MARCA_NIVEL_1 = 'NIVEL EPT100 CONC 1'
const MARCA_NIVEL_2 = 'NIVEL EPT100 CONC 2'

/** Ejecuta una sentencia y deja su desenlace (OK o SQLSTATE) en una variable de sesión. */
function tolerante(sentencia) {
  return `DO $prueba$
          BEGIN
            BEGIN
              ${sentencia};
              PERFORM pg_catalog.set_config('ept100.res', 'OK', false);
            EXCEPTION WHEN OTHERS THEN
              PERFORM pg_catalog.set_config('ept100.res', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

function resultadoDe(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept100.res', true)`, etiqueta)
}

async function exigir(sesion, etiqueta, esperado) {
  const obtenido = await resultadoDe(sesion, etiqueta)
  if (obtenido !== esperado) {
    throw new Error(`${etiqueta}: se esperaba ${esperado} y se obtuvo ${obtenido}`)
  }
}

const LIMPIEZA = `
  DELETE FROM public.imputaciones_pago WHERE pago_id IN ('${PAGO_1}', '${PAGO_2}');
  DELETE FROM public.pagos WHERE padre_id = '${PADRE}';
  DELETE FROM public.items_factura WHERE factura_id IN
    (SELECT id FROM public.facturas WHERE alumno_id = '${ALUMNO}');
  DELETE FROM public.facturas WHERE alumno_id = '${ALUMNO}';
  DELETE FROM public.tarifas
   WHERE id IN ('${TARIFA_A}', '${TARIFA_B}') OR deporte_id = '${DEPORTE}';
  DELETE FROM public.deportes WHERE id = '${DEPORTE}';
  DELETE FROM public.matriculas WHERE alumno_id = '${ALUMNO}';
  DELETE FROM public.alumnos WHERE perfil_id = '${ALUMNO}';
  DELETE FROM public.perfiles WHERE id IN ('${ALUMNO}', '${PADRE}', '${DIRECTOR}');
  DELETE FROM public.cursos WHERE id = '${CURSO}';
  DELETE FROM public.niveles WHERE nombre IN ('${MARCA_NIVEL_1}', '${MARCA_NIVEL_2}');`

/** 1. Vigencias solapadas: la perdedora recibe 23P01; si la ganadora revierte, entra. */
async function probarSolapamientoDeVigencias(a, b, pids) {
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
     VALUES ('DEPORTE', '${DEPORTE}', 100, '2050-01-01', '2050-06-30');`,
    'vigencia_a_pendiente'
  )
  const altaB = b.ejecutar(
    tolerante(`INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
               VALUES ('DEPORTE', '${DEPORTE}', 200, '2050-06-30', '2050-12-31')`),
    'vigencia_b_pendiente'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_vigencia_a')
  await altaB
  await exigir(b, 'vigencia solapada tras confirmar', '23P01')

  // Si la primera revierte, la segunda no tiene con qué solaparse.
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
     VALUES ('DEPORTE', '${DEPORTE}', 300, '2051-01-01', '2051-06-30');`,
    'vigencia_a_revertir'
  )
  const altaB2 = b.ejecutar(
    tolerante(`INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
               VALUES ('DEPORTE', '${DEPORTE}', 400, '2051-06-30', '2051-12-31')`),
    'vigencia_b_tras_rollback'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('ROLLBACK;', 'revertir_vigencia_a')
  await altaB2
  await exigir(b, 'vigencia tras rollback del competidor', 'OK')

  const filas = await a.escalar(
    `(SELECT pg_catalog.count(*) FROM public.tarifas WHERE deporte_id = '${DEPORTE}')`,
    'vigencias_finales'
  )
  if (filas !== '2') throw new Error(`Se esperaban 2 vigencias confirmadas y hay ${filas}`)
  console.log('OK CONCURRENCIA 1: vigencias solapadas no confirman las dos (23P01); tras un rollback la segunda entra')
}

/** 2. Número de operación único entre pagos no rechazados. */
async function probarOperacionUnica(a, b, pids) {
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, numero_operacion)
     VALUES ('${PAGO_1}', '${PADRE}', '${ALUMNO}', 100, 'CONC-OP-1');`,
    'pago_a_pendiente'
  )
  const pagoB = b.ejecutar(
    tolerante(`INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, numero_operacion)
               VALUES ('${PAGO_2}', '${PADRE}', '${ALUMNO}', 100, ' CONC-OP-1 ')`),
    'pago_b_pendiente'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_pago_a')
  await pagoB
  await exigir(b, 'número de operación repetido tras confirmar', '23505')

  // Si el primero revierte, el número queda libre para el segundo.
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
     VALUES ('${PADRE}', '${ALUMNO}', 100, 'CONC-OP-2');`,
    'pago_a_revertir'
  )
  const pagoB2 = b.ejecutar(
    tolerante(`INSERT INTO public.pagos (padre_id, alumno_id, total_calculado, numero_operacion)
               VALUES ('${PADRE}', '${ALUMNO}', 100, 'CONC-OP-2')`),
    'pago_b_tras_rollback'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('ROLLBACK;', 'revertir_pago_a')
  await pagoB2
  await exigir(b, 'número de operación tras rollback del competidor', 'OK')

  // Pago 2 todavía no existe (falló): se crea sin número para la prueba siguiente.
  await a.ejecutar(
    `INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
     VALUES ('${PAGO_2}', '${PADRE}', '${ALUMNO}', 100);`,
    'pago_2_sin_numero'
  )
  console.log('OK CONCURRENCIA 2: el mismo número de operación no confirma dos veces (23505); tras un rollback queda libre')
}

/** 3. Un ítem no tiene dos imputaciones activas. */
async function probarImputacionActivaUnica(a, b, pids) {
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
     VALUES ('${PAGO_1}', '${ITEM_1}', '${ALUMNO}', 100);`,
    'imputacion_a_pendiente'
  )
  const imputacionB = b.ejecutar(
    tolerante(`INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
               VALUES ('${PAGO_2}', '${ITEM_1}', '${ALUMNO}', 100)`),
    'imputacion_b_pendiente'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_imputacion_a')
  await imputacionB
  await exigir(b, 'segunda imputación activa del mismo ítem', '23505')

  const activas = await a.escalar(
    `(SELECT pg_catalog.count(*) FROM public.imputaciones_pago
      WHERE item_factura_id = '${ITEM_1}' AND activa)`,
    'imputaciones_activas'
  )
  if (activas !== '1') throw new Error(`Se esperaba 1 imputación activa y hay ${activas}`)
  console.log('OK CONCURRENCIA 3: un ítem queda con una sola imputación activa (la otra, 23505)')
}

/** 4. Una factura por alumno y período, aun con dos generaciones simultáneas. */
async function probarFacturaUnica(a, b, pids) {
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
     VALUES ('${ALUMNO}', '2052-01-01', '2052-01-10', 0);`,
    'factura_a_pendiente'
  )
  const facturaB = b.ejecutar(
    tolerante(`INSERT INTO public.facturas (alumno_id, periodo, vencimiento, total)
               VALUES ('${ALUMNO}', '2052-01-01', '2052-01-10', 0)`),
    'factura_b_pendiente'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_factura_a')
  await facturaB
  await exigir(b, 'factura duplicada del mismo período', '23505')
  console.log('OK CONCURRENCIA 4: dos generaciones simultáneas de la misma factura dejan una sola (23505)')
}

/** 5. Una tarifa no cambia de referencia mientras se factura un ítem con ella. */
async function probarTarifaContraItem(a, b, pids) {
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.items_factura (factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
     VALUES ('${FACTURA_2}', '${ALUMNO}', 'CUOTA', '${TARIFA_B}', '${MATRICULA}', 100);`,
    'item_a_pendiente'
  )
  const cambioB = b.ejecutar(
    tolerante(`UPDATE public.tarifas
               SET nivel_id = (SELECT id FROM public.niveles WHERE nombre = '${MARCA_NIVEL_2}')
               WHERE id = '${TARIFA_B}'`),
    'cambio_tarifa_b_pendiente'
  )
  // B queda detenida por el FOR SHARE que el trigger del ítem tomó sobre la tarifa.
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_item_a')
  await cambioB
  await exigir(b, 'cambio de referencia de una tarifa recién facturada', 'P6804')

  const coherente = await a.escalar(
    `(SELECT t.nivel_id = (SELECT id FROM public.niveles WHERE nombre = '${MARCA_NIVEL_1}')
      FROM public.tarifas t WHERE t.id = '${TARIFA_B}')`,
    'tarifa_sin_cambios'
  )
  if (coherente !== 'true') throw new Error('La tarifa cambió de nivel pese al ítem facturado')
  console.log('OK CONCURRENCIA 5: la tarifa espera al ítem que la usa y luego se rechaza el cambio (P6804)')
}

const sesionA = new SesionPsql('A', 'EPT100')
const sesionB = new SesionPsql('B', 'EPT100')

try {
  const pidA = Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pidB = Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pids = { a: pidA, b: pidB }

  // Limpieza y siembra en UNA SOLA transacción: la invariante académica de 008
  // se comprueba con triggers diferidos que miran los dos lados de la relación.
  await sesionA.ejecutar(
    `BEGIN;
     ${LIMPIEZA}

     INSERT INTO public.niveles (nombre, activo, orden)
     VALUES ('${MARCA_NIVEL_1}', TRUE, 9201), ('${MARCA_NIVEL_2}', TRUE, 9202);
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
     VALUES ('${CURSO}', (SELECT id FROM public.niveles WHERE nombre = '${MARCA_NIVEL_1}'),
             'Curso concurrencia EPT-100', 'A', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     VALUES
       ('${ALUMNO}', '${ALUMNO}', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
        'Prueba', 'Concurrente', '99920001', 'LEG-EPT100-C1'),
       ('${PADRE}', '${PADRE}', (SELECT id FROM public.roles WHERE nombre = 'PADRE'),
        'Prueba', 'Padre concurrente', '99920002', NULL),
       ('${DIRECTOR}', '${DIRECTOR}', (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),
        'Prueba', 'Director concurrente', '99920003', NULL);

     INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES ('${MATRICULA}', '${ALUMNO}', '${CURSO}');
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${ALUMNO}';

     INSERT INTO public.deportes (id, nombre) VALUES ('${DEPORTE}', 'Deporte concurrencia EPT-100');

     INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde, hasta)
     VALUES
       ('${TARIFA_A}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = '${MARCA_NIVEL_1}'),
        100, '2050-01-01', '2050-12-31'),
       ('${TARIFA_B}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = '${MARCA_NIVEL_1}'),
        100, '2051-01-01', NULL);

     INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
     VALUES ('${FACTURA_1}', '${ALUMNO}', '2050-02-01', '2050-02-10', 100),
            ('${FACTURA_2}', '${ALUMNO}', '2051-02-01', '2051-02-10', 100);
     INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
     VALUES ('${ITEM_1}', '${FACTURA_1}', '${ALUMNO}', 'CUOTA', '${TARIFA_A}', '${MATRICULA}', 100);
     COMMIT;`,
    'preparar_fixture'
  )

  const estadoActivo = await sesionA.escalar(
    `(SELECT estado FROM public.alumnos WHERE perfil_id = '${ALUMNO}')`,
    'verificar_fixture'
  )
  if (estadoActivo !== 'ACTIVO') {
    throw new Error(`El fixture no dejó al alumno ACTIVO (quedó ${estadoActivo})`)
  }

  await probarSolapamientoDeVigencias(sesionA, sesionB, pids)
  await probarOperacionUnica(sesionA, sesionB, pids)
  await probarImputacionActivaUnica(sesionA, sesionB, pids)
  await probarFacturaUnica(sesionA, sesionB, pids)
  await probarTarifaContraItem(sesionA, sesionB, pids)

  await sesionA.ejecutar(`BEGIN; ${LIMPIEZA} COMMIT;`, 'limpiar_fixture')
  const restos = await sesionA.escalar(
    `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN ('${ALUMNO}', '${PADRE}', '${DIRECTOR}'))
     + (SELECT pg_catalog.count(*) FROM public.facturas WHERE alumno_id = '${ALUMNO}')`,
    'verificar_limpieza'
  )
  if (restos !== '0') throw new Error(`La limpieza dejó ${restos} fila(s) de prueba`)

  console.log('OK CONCURRENCIA: las cinco carreras económicas quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
