import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la administración de tarifas (EPT-103).
 *
 * Usa TRES conexiones PostgreSQL independientes (un `psql` por sesión), de modo que
 * compiten de verdad por los bloqueos. La coordinación es determinista
 * (`pg_blocking_pids`), nunca por tiempo.
 *
 *   A y B  actúan como el DIRECTOR por la vía real de la aplicación: rol
 *          `authenticated` + JWT, llamando a las operaciones públicas.
 *   C      es el propietario de las tablas (proceso privilegiado o de
 *          mantenimiento): escribe sin pasar por las operaciones, para demostrar
 *          que la restricción de exclusión de EPT-100 sigue siendo la barrera final.
 *
 * Demuestra:
 *   1. Dos altas solapadas: gana una, la otra recibe P6830; si la primera revierte,
 *      la segunda entra. Nunca confirman las dos.
 *   2. Dos ediciones de la misma tarifa sobre el mismo valor previo: la segunda
 *      recibe P6831 y NO sobrescribe el valor de la primera.
 *   3. Una edición que extiende una vigencia contra un alta que la invade:
 *      resultado consistente, sin dos vigencias superpuestas.
 *   4. Dos sucesiones («cambiar precio») concurrentes: en fechas distintas
 *      encadenan sin huecos ni solapamientos; el mismo día, una sola gana (P6830).
 *   5. Una sucesión multirregistro (cerrar la anterior + abrir la nueva) que falla
 *      a mitad de camino contra una escritura privilegiada concurrente revierte
 *      ENTERA: la anterior conserva su fin.
 *   6. Una edición de precio concurrente con la factura de un ítem que usa esa
 *      tarifa: espera, procede, y el ítem conserva lo facturado.
 *   7. Autorización transaccional: una cuenta bloqueada ANTES de tomar la guarda se
 *      rechaza (42501); si la operación tomó primero la guarda (FOR SHARE sobre el perfil)
 *      y espera el bloqueo de la referencia, el bloqueo de la cuenta espera y la operación
 *      termina autorizada. La matriz completa está en `tarifas_autorizacion_concurrencia.mjs`.
 *
 * Corre contra la base local descartable e identificada; para el stack aislado
 * de la unidad: `EPT_SUPABASE_DB_CONTAINER=supabase_db_ept103`. Crea sus propios
 * datos sintéticos y los borra al final como propietario de las tablas; ese
 * borrado no representa ninguna operación disponible en la aplicación.
 */

const ID = (n) => `c1030000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ALUMNO = ID(1)
const DIRECTOR = ID(3)
const CURSO = ID(11)
const MATRICULA = ID(21)
const DEPORTE_1 = ID(31)
const DEPORTE_2 = ID(32)
const FACTURA = ID(51)
const ITEM = ID(61)
const NIVEL_1 = 'NIVEL EPT103 CONC 1'
const NIVEL_2 = 'NIVEL EPT103 CONC 2'

const NIVEL_1_ID = `(SELECT id FROM public.niveles WHERE nombre = '${NIVEL_1}')`
const NIVEL_2_ID = `(SELECT id FROM public.niveles WHERE nombre = '${NIVEL_2}')`

/** Ejecuta una expresión de texto y deja su desenlace (OK:<valor> o SQLSTATE) en una variable de sesión. */
function tolerante(expresion) {
  return `DO $prueba$
          DECLARE v TEXT;
          BEGIN
            BEGIN
              v := (${expresion});
              PERFORM pg_catalog.set_config('ept103.res', 'OK:' || COALESCE(v, ''), false);
            EXCEPTION WHEN OTHERS THEN
              PERFORM pg_catalog.set_config('ept103.res', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

const crear = (concepto, refNivel, refDeporte, importe, desde, hasta) =>
  tolerante(
    `SELECT public.crear_tarifa('${concepto}', ${refNivel}, ${refDeporte}, NULL, '${importe}', '${desde}'::DATE, ${hasta ? `'${hasta}'::DATE` : 'NULL'})::TEXT`
  )

const cambiar = (concepto, refNivel, refDeporte, importe, desde, hasta) =>
  tolerante(
    `SELECT public.cambiar_tarifa('${concepto}', ${refNivel}, ${refDeporte}, NULL, '${importe}', '${desde}'::DATE, ${hasta ? `'${hasta}'::DATE` : 'NULL'})::TEXT`
  )

const actualizar = (id, importe, desde, hasta, previo) =>
  tolerante(
    `SELECT public.actualizar_tarifa('${id}'::UUID, '${importe}', '${desde}'::DATE, ${hasta ? `'${hasta}'::DATE` : 'NULL'}, '${previo.importe}', '${previo.desde}'::DATE, ${previo.hasta ? `'${previo.hasta}'::DATE` : 'NULL'})::TEXT`
  )

const resultadoDe = (sesion, etiqueta) =>
  sesion.escalar(`pg_catalog.current_setting('ept103.res', true)`, etiqueta)

async function exigir(sesion, etiqueta, esperado) {
  const obtenido = await resultadoDe(sesion, etiqueta)
  const coincide = esperado === 'OK' ? obtenido.startsWith('OK:') : obtenido === esperado
  if (!coincide) {
    throw new Error(`${etiqueta}: se esperaba ${esperado} y se obtuvo ${obtenido}`)
  }
}

async function exigirValor(sesion, etiqueta, expresion, esperado) {
  const obtenido = await sesion.escalar(expresion, etiqueta)
  if (obtenido !== esperado) {
    throw new Error(`${etiqueta}: se esperaba ${esperado} y se obtuvo ${obtenido}`)
  }
}

/** Ninguna pareja de versiones de una referencia comparte un día. */
const sinSolapamientos = (filtro) =>
  `NOT EXISTS (
     SELECT 1 FROM public.tarifas a JOIN public.tarifas b
       ON a.id < b.id AND daterange(a.desde, a.hasta, '[]') && daterange(b.desde, b.hasta, '[]')
      AND a.concepto = b.concepto
      AND a.nivel_id IS NOT DISTINCT FROM b.nivel_id
      AND a.deporte_id IS NOT DISTINCT FROM b.deporte_id
     WHERE ${filtro.replaceAll('{t}', 'a')})`

const LIMPIEZA = `
  DELETE FROM public.items_factura WHERE factura_id = '${FACTURA}';
  DELETE FROM public.facturas WHERE alumno_id = '${ALUMNO}';
  DELETE FROM public.tarifas
   WHERE deporte_id IN ('${DEPORTE_1}', '${DEPORTE_2}')
      OR nivel_id IN (SELECT id FROM public.niveles WHERE nombre IN ('${NIVEL_1}', '${NIVEL_2}'));
  DELETE FROM public.deportes WHERE id IN ('${DEPORTE_1}', '${DEPORTE_2}');
  DELETE FROM public.matriculas WHERE alumno_id = '${ALUMNO}';
  DELETE FROM public.alumnos WHERE perfil_id = '${ALUMNO}';
  DELETE FROM public.perfiles WHERE id IN ('${ALUMNO}', '${DIRECTOR}');
  DELETE FROM public.cursos WHERE id = '${CURSO}';
  DELETE FROM public.niveles WHERE nombre IN ('${NIVEL_1}', '${NIVEL_2}');`

/** Pone a la sesión en el papel del DIRECTOR habilitado, como lo hace PostgREST. */
const COMO_DIRECTOR = `SET ROLE authenticated;
  SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"${DIRECTOR}","role":"authenticated"}', false);`

/** 1. Altas solapadas. */
async function probarAltasSolapadas(a, b, c, pids) {
  await a.ejecutar(`BEGIN; ${crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '100', '2060-01-01', '2060-06-30')}`, 'alta_a')
  await exigir(a, 'alta A', 'OK')
  const altaB = b.ejecutar(
    crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '200', '2060-06-30', '2060-12-31'),
    'alta_b_pendiente'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_alta_a')
  await altaB
  await exigir(b, 'alta B solapada tras confirmar A (comparte el 30/06)', 'P6830')

  // Si la primera revierte, la segunda no tiene con qué solaparse.
  await a.ejecutar(`BEGIN; ${crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '300', '2061-01-01', '2061-06-30')}`, 'alta_a_revertir')
  await exigir(a, 'alta A a revertir', 'OK')
  const altaB2 = b.ejecutar(
    crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '400', '2061-06-30', '2061-12-31'),
    'alta_b_tras_rollback'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('ROLLBACK;', 'revertir_alta_a')
  await altaB2
  await exigir(b, 'alta B tras el rollback de A', 'OK')

  await exigirValor(
    c,
    'versiones_finales_1',
    `(SELECT pg_catalog.count(*) FROM public.tarifas WHERE deporte_id = '${DEPORTE_1}')`,
    '2'
  )
  console.log('OK CONCURRENCIA 1: dos altas solapadas no confirman las dos (P6830); tras un rollback la segunda entra')
}

/** 2. Dos ediciones sobre el mismo valor previo. */
async function probarEdicionesConcurrentes(a, b, c, pids) {
  const id = await c.escalar(
    `(SELECT id FROM public.tarifas WHERE deporte_id = '${DEPORTE_1}' AND desde = '2060-01-01')`,
    'id_tarifa_2060'
  )
  const previo = { importe: '100.00', desde: '2060-01-01', hasta: '2060-06-30' }
  await a.ejecutar(`BEGIN; ${actualizar(id, '111', '2060-01-01', '2060-06-30', previo)}`, 'edicion_a')
  await exigir(a, 'edición A', 'OK')
  const edicionB = b.ejecutar(actualizar(id, '222', '2060-01-01', '2060-06-30', previo), 'edicion_b_pendiente')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_edicion_a')
  await edicionB
  await exigir(b, 'edición B sobre el valor previo ya cambiado', 'P6831')
  await exigirValor(
    c,
    'importe_tras_conflicto',
    `(SELECT importe FROM public.tarifas WHERE id = '${id}')`,
    '111.00'
  )
  console.log('OK CONCURRENCIA 2: la segunda edición recibe P6831 y no sobrescribe el valor de la primera (111.00)')
}

/** 3. Extender una vigencia contra un alta que la invade. */
async function probarEdicionContraAlta(a, b, c, pids) {
  const id = await c.escalar(
    `(SELECT id FROM public.tarifas WHERE deporte_id = '${DEPORTE_1}' AND desde = '2061-06-30')`,
    'id_tarifa_2061'
  )
  const previo = { importe: '400.00', desde: '2061-06-30', hasta: '2061-12-31' }
  await a.ejecutar(`BEGIN; ${actualizar(id, '400', '2061-03-01', '2061-12-31', previo)}`, 'extension_a')
  await exigir(a, 'extensión A', 'OK')
  const altaB = b.ejecutar(
    crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '500', '2061-01-01', '2061-04-30'),
    'alta_invasora_b'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_extension_a')
  await altaB
  await exigir(b, 'alta que invade la vigencia recién extendida', 'P6830')
  await exigirValor(
    c,
    'sin_solapamientos_3',
    sinSolapamientos(`a.deporte_id = '${DEPORTE_1}'`).replace(/^/, '(SELECT ') + ')',
    'true'
  )
  console.log('OK CONCURRENCIA 3: la extensión de una vigencia y un alta invasora no dejan dos vigencias superpuestas')
}

/** 4. Dos sucesiones de precio concurrentes. */
async function probarSucesionesConcurrentes(a, b, c, pids) {
  await c.ejecutar(
    `INSERT INTO public.tarifas (concepto, nivel_id, importe, desde)
     VALUES ('CUOTA', ${NIVEL_1_ID}, 100, '2062-01-01'), ('CUOTA', ${NIVEL_2_ID}, 100, '2062-01-01');`,
    'sembrar_cuotas'
  )

  // 4a. Fechas distintas: B espera a A y encadena sobre la versión que A acaba de abrir.
  await a.ejecutar(`BEGIN; ${cambiar('CUOTA', NIVEL_1_ID, 'NULL', '200', '2062-04-01', null)}`, 'sucesion_a')
  await exigir(a, 'sucesión A', 'OK')
  const sucesionB = b.ejecutar(cambiar('CUOTA', NIVEL_1_ID, 'NULL', '300', '2062-08-01', null), 'sucesion_b_pendiente')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_sucesion_a')
  await sucesionB
  await exigir(b, 'sucesión B en otra fecha', 'OK')
  await exigirValor(
    c,
    'cadena_4a',
    `(SELECT pg_catalog.string_agg(importe || ':' || desde || ':' || COALESCE(hasta::TEXT, 'abierta'), ' | ' ORDER BY desde)
      FROM public.tarifas WHERE nivel_id = ${NIVEL_1_ID})`,
    '100.00:2062-01-01:2062-03-31 | 200.00:2062-04-01:2062-07-31 | 300.00:2062-08-01:abierta'
  )
  await exigirValor(
    c,
    'sin_solapamientos_4a',
    sinSolapamientos(`a.nivel_id = ${NIVEL_1_ID}`).replace(/^/, '(SELECT ') + ')',
    'true'
  )

  // 4b. El mismo día: una gana, la otra P6830 y su cierre se revierte.
  await a.ejecutar(`BEGIN; ${cambiar('CUOTA', NIVEL_2_ID, 'NULL', '200', '2062-04-01', null)}`, 'mismo_dia_a')
  await exigir(a, 'sucesión A mismo día', 'OK')
  const mismoDiaB = b.ejecutar(cambiar('CUOTA', NIVEL_2_ID, 'NULL', '300', '2062-04-01', null), 'mismo_dia_b_pendiente')
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_mismo_dia_a')
  await mismoDiaB
  await exigir(b, 'sucesión B el mismo día', 'P6830')
  await exigirValor(
    c,
    'cadena_4b',
    `(SELECT pg_catalog.string_agg(importe || ':' || desde || ':' || COALESCE(hasta::TEXT, 'abierta'), ' | ' ORDER BY desde)
      FROM public.tarifas WHERE nivel_id = ${NIVEL_2_ID})`,
    '100.00:2062-01-01:2062-03-31 | 200.00:2062-04-01:abierta'
  )
  console.log('OK CONCURRENCIA 4: dos sucesiones encadenan sin huecos ni solapes en fechas distintas; el mismo día una sola gana (P6830)')
}

/** 5. La operación multirregistro revierte entera frente a una escritura privilegiada concurrente. */
async function probarMultirregistroRevierte(b, c, pids) {
  await c.ejecutar(
    `INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
     VALUES ('DEPORTE', '${DEPORTE_2}', 100, '2063-01-01', '2063-12-31');`,
    'sembrar_deporte_2'
  )
  // C (propietario) deja SIN CONFIRMAR una vigencia posterior que invade el cambio de B.
  await c.ejecutar(
    `BEGIN;
     INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
     VALUES ('DEPORTE', '${DEPORTE_2}', 999, '2064-01-01');`,
    'privilegiado_pendiente'
  )
  // B cierra la anterior (hasta = 31/05) y, al insertar la nueva abierta, queda esperando a C.
  const cambioB = b.ejecutar(
    cambiar('DEPORTE', 'NULL', `'${DEPORTE_2}'::UUID`, '150', '2063-06-01', null),
    'cambio_b_pendiente'
  )
  await esperarBloqueo(c, pids.c, pids.b)
  await c.ejecutar('COMMIT;', 'confirmar_privilegiado')
  await cambioB
  await exigir(b, 'cambio multirregistro contra la escritura privilegiada', 'P6830')
  await exigirValor(
    c,
    'anterior_intacta',
    `(SELECT hasta FROM public.tarifas WHERE deporte_id = '${DEPORTE_2}' AND desde = '2063-01-01')`,
    '2063-12-31'
  )
  await exigirValor(
    c,
    'sin_fila_nueva',
    `(SELECT pg_catalog.count(*) FROM public.tarifas WHERE deporte_id = '${DEPORTE_2}')`,
    '2'
  )
  console.log('OK CONCURRENCIA 5: el cierre de la anterior se revierte con el alta fallida: sin escrituras parciales; la exclusión de EPT-100 es la barrera final')
}

/** 6. Edición de precio contra la facturación de un ítem que usa esa tarifa. */
async function probarEdicionContraFactura(b, c, pids) {
  const id = await c.escalar(
    `(SELECT id FROM public.tarifas WHERE nivel_id = ${NIVEL_1_ID} AND desde = '2062-04-01')`,
    'id_tarifa_facturada'
  )
  // C factura un ítem con esa tarifa: el trigger toma FOR SHARE sobre la fila.
  await c.ejecutar(
    `BEGIN;
     INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
     VALUES ('${ITEM}', '${FACTURA}', '${ALUMNO}', 'CUOTA', '${id}', '${MATRICULA}', 200);`,
    'item_pendiente'
  )
  const previo = { importe: '200.00', desde: '2062-04-01', hasta: '2062-07-31' }
  const edicionB = b.ejecutar(actualizar(id, '250', '2062-04-01', '2062-07-31', previo), 'edicion_precio_pendiente')
  await esperarBloqueo(c, pids.c, pids.b)
  await c.ejecutar('COMMIT;', 'confirmar_item')
  await edicionB
  await exigir(b, 'edición de precio de una tarifa recién facturada', 'OK')
  await exigirValor(
    c,
    'item_y_tarifa',
    `(SELECT i.importe || ':' || t.importe || ':' || f.total || ':' || i.estado_pago
      FROM public.items_factura i
      JOIN public.tarifas t ON t.id = i.tarifa_id
      JOIN public.facturas f ON f.id = i.factura_id
      WHERE i.id = '${ITEM}')`,
    '200.00:250.00:200.00:PENDIENTE'
  )
  console.log('OK CONCURRENCIA 6: la edición espera al ítem recién facturado y procede; el ítem conserva lo facturado (200.00) y la tarifa dice 250.00')
}

/**
 * 7. Autorización transaccional (corrección de EPT-103). La operación toma FOR SHARE sobre el
 * perfil del actor y lo conserva hasta el fin de su transacción, así que una revocación y una
 * operación tienen solo dos órdenes seriales. Ver `tarifas_autorizacion_concurrencia.mjs` para
 * la matriz completa; acá se conserva la carrera histórica en sus dos órdenes.
 *
 * Ya NO se espera la revocación antes de liberar la espera de la operación: con la guarda
 * nueva esa revocación espera a la operación y esperarla sería colgar la prueba.
 */
async function probarAccesoRevocadoMientrasEspera(a, b, c, pids) {
  // 7a. Orden 1: la cuenta se bloquea y la revocación CONFIRMA antes de que B adquiera la guarda.
  await c.ejecutar(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${DIRECTOR}';`, 'bloquear_cuenta')
  await b.ejecutar(
    crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '20', '2065-03-01', '2065-03-31'),
    'alta_b_con_cuenta_bloqueada'
  )
  await exigir(b, 'alta B tras confirmarse el bloqueo de la cuenta', '42501')
  await c.ejecutar(`UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = '${DIRECTOR}';`, 'restituir_cuenta')
  await exigirValor(
    c,
    'sin_fila_de_b_7a',
    `(SELECT pg_catalog.count(*) FROM public.tarifas WHERE deporte_id = '${DEPORTE_1}' AND desde IN ('2065-01-01', '2065-03-01'))`,
    '0'
  )

  // 7b. Orden 2: B adquiere la guarda y espera el consultivo; el bloqueo de la cuenta ESPERA a
  // las transacciones de A y B, y B termina autorizada. El bloqueo confirma después.
  await a.ejecutar(
    `BEGIN; ${crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '10', '2065-01-01', '2065-01-31')}`,
    'alta_a_retiene_el_bloqueo_7b'
  )
  await exigir(a, 'alta A que retiene el bloqueo de la referencia (7b)', 'OK')
  const altaB = b.ejecutar(
    crear('DEPORTE', 'NULL', `'${DEPORTE_1}'::UUID`, '20', '2065-03-01', '2065-03-31'),
    'alta_b_espera_el_bloqueo'
  )
  await esperarBloqueo(a, pids.a, pids.b)
  // Sin await: la revocación espera a la guarda de A (y de B) hasta que terminen.
  const bloqueoCuenta = c.ejecutar(
    `UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${DIRECTOR}';`,
    'bloquear_cuenta_en_espera'
  )
  await esperarBloqueo(a, pids.a, pids.c)
  await a.ejecutar('COMMIT;', 'confirmar_alta_a_retenida')
  await altaB
  await exigir(b, 'alta B que ya había tomado la guarda antes de esperar', 'OK')
  await bloqueoCuenta
  await exigirValor(
    c,
    'fila_de_b_7b',
    `(SELECT pg_catalog.count(*) FROM public.tarifas WHERE deporte_id = '${DEPORTE_1}' AND desde = '2065-03-01')`,
    '1'
  )
  await exigirValor(
    c,
    'cuenta_bloqueada_tras_las_operaciones',
    `(SELECT estado_acceso FROM public.perfiles WHERE id = '${DIRECTOR}')`,
    'BLOQUEADO'
  )
  await c.ejecutar(`UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = '${DIRECTOR}';`, 'restituir_cuenta_7b')
  console.log('OK CONCURRENCIA 7: con la cuenta bloqueada antes de la guarda la alta recibe 42501; con la guarda tomada primero el bloqueo espera y la alta termina autorizada')
}

const sesionA = new SesionPsql('A', 'EPT103')
const sesionB = new SesionPsql('B', 'EPT103')
const sesionC = new SesionPsql('C', 'EPT103')

try {
  const pids = {
    a: Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid')),
    b: Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid')),
    c: Number(await sesionC.escalar('pg_catalog.pg_backend_pid()', 'pid')),
  }

  // Limpieza y siembra en UNA SOLA transacción: la invariante académica de 008 se
  // comprueba con triggers diferidos que miran los dos lados de la relación.
  await sesionC.ejecutar(
    `BEGIN;
     ${LIMPIEZA}

     INSERT INTO public.niveles (nombre, activo, orden)
     VALUES ('${NIVEL_1}', TRUE, 9301), ('${NIVEL_2}', TRUE, 9302);
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
     VALUES ('${CURSO}', ${NIVEL_1_ID}, 'Curso concurrencia EPT-103', 'A', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     VALUES
       ('${ALUMNO}', '${ALUMNO}', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
        'Prueba', 'Concurrente', '99930001', 'LEG-EPT103-C1'),
       ('${DIRECTOR}', '${DIRECTOR}', (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),
        'Prueba', 'Director concurrente', '99930003', NULL);

     INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES ('${MATRICULA}', '${ALUMNO}', '${CURSO}');
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${ALUMNO}';
     INSERT INTO public.deportes (id, nombre)
     VALUES ('${DEPORTE_1}', 'Deporte concurrencia EPT-103 A'), ('${DEPORTE_2}', 'Deporte concurrencia EPT-103 B');
     INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
     VALUES ('${FACTURA}', '${ALUMNO}', '2062-05-01', '2062-05-10', 200);
     COMMIT;`,
    'preparar_fixture'
  )

  // A y B actúan como el DIRECTOR por la vía de la aplicación; C sigue siendo el propietario.
  await sesionA.ejecutar(COMO_DIRECTOR, 'rol_a')
  await sesionB.ejecutar(COMO_DIRECTOR, 'rol_b')

  await probarAltasSolapadas(sesionA, sesionB, sesionC, pids)
  await probarEdicionesConcurrentes(sesionA, sesionB, sesionC, pids)
  await probarEdicionContraAlta(sesionA, sesionB, sesionC, pids)
  await probarSucesionesConcurrentes(sesionA, sesionB, sesionC, pids)
  await probarMultirregistroRevierte(sesionB, sesionC, pids)
  await probarEdicionContraFactura(sesionB, sesionC, pids)
  await probarAccesoRevocadoMientrasEspera(sesionA, sesionB, sesionC, pids)

  await sesionC.ejecutar(`BEGIN; ${LIMPIEZA} COMMIT;`, 'limpiar_fixture')
  const restos = await sesionC.escalar(
    `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN ('${ALUMNO}', '${DIRECTOR}'))
     + (SELECT pg_catalog.count(*) FROM public.tarifas
        WHERE deporte_id IN ('${DEPORTE_1}', '${DEPORTE_2}'))
     + (SELECT pg_catalog.count(*) FROM public.facturas WHERE alumno_id = '${ALUMNO}')`,
    'verificar_limpieza'
  )
  if (restos !== '0') throw new Error(`La limpieza dejó ${restos} fila(s) de prueba`)

  console.log('OK CONCURRENCIA: las siete pruebas de concurrencia quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
    sesionC.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar(), sesionC.cerrar()])
}
