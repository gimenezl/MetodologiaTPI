import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la compatibilidad horaria (EPT-12).
 *
 * Dos conexiones PostgreSQL independientes compiten de verdad por los
 * bloqueos. La coordinación es determinista (`pg_blocking_pids`), nunca por
 * tiempo: A abre su transacción y ejecuta; B lanza su operación, se comprueba
 * que quedó bloqueada por A y recién entonces A confirma.
 *
 * Demuestra que:
 *   1. Dos altas incompatibles del mismo alumno a la vez: confirma una; la otra
 *      recibe P5584.
 *   2. Dos altas compatibles del mismo alumno a la vez: confirman ambas y el
 *      alumno queda con dos deportes.
 *   3. Dos alumnos por la última plaza de un grupo con horario: confirma uno.
 *   4. Un alumno con un deporte intenta dos compatibles a la vez: solo uno más
 *      (P5577).
 *   5. La dirección agrega una franja mientras un alumno se inscribe en ese
 *      grupo: el alta ve la franja nueva y recibe P5584.
 *   6. Un alumno se inscribe mientras la dirección agrega una franja que le
 *      chocaría: la franja ve la inscripción y recibe P5589.
 *   7. Dos franjas nuevas en dos grupos que comparten un alumno, superpuestas
 *      entre sí: confirma una; la otra recibe P5589.
 *   8. Una baja y un alta que chocaba con ella, a la vez: la baja libera el
 *      horario y el alta confirma después.
 *   9. La dirección y el propio alumno inscriben a la vez en grupos
 *      incompatibles: misma regla, confirma uno (P5584).
 *
 * Al final comprueba el invariante —ningún alumno con dos actividades activas
 * superpuestas— y deja la base sin residuos. La limpieza corre al empezar y en
 * `finally`, así que un fallo a mitad de camino no deja datos sintéticos. El
 * borrado es del propietario y no representa ninguna operación de la
 * aplicación, que no tiene DELETE.
 */

const ID = {
  director: 'd1200000-0000-4000-8000-000000000001',
  docente: 'd1200000-0000-4000-8000-000000000002',
  x: 'd1200000-0000-4000-8000-000000000003',
  y: 'd1200000-0000-4000-8000-000000000004',
  z: 'd1200000-0000-4000-8000-000000000005',
  w: 'd1200000-0000-4000-8000-000000000006',
  v: 'd1200000-0000-4000-8000-000000000007',
  v2: 'd1200000-0000-4000-8000-000000000008',
  u: 'd1200000-0000-4000-8000-000000000009',
  t: 'd1200000-0000-4000-8000-00000000000a',
  s: 'd1200000-0000-4000-8000-00000000000b',
  curso: 'd1200000-0000-4000-8000-0000000000c1',
}
const ALUMNOS = [ID.x, ID.y, ID.z, ID.w, ID.v, ID.v2, ID.u, ID.t, ID.s]
const PERFILES = [ID.director, ID.docente, ...ALUMNOS]

const DEPORTE = {
  futbol: 'e0000000-0000-4000-8000-000000000101',
  natacion: 'e0000000-0000-4000-8000-000000000102',
  atletismo: 'e0000000-0000-4000-8000-000000000103',
  marciales: 'e0000000-0000-4000-8000-000000000104',
  voley: 'e0000000-0000-4000-8000-000000000105',
  basquet: 'e0000000-0000-4000-8000-000000000106',
}

/** Franjas del catálogo que usa este arnés; se borran al final si quedan huérfanas. */
const FRANJAS_USADAS = [
  [1, '10:00', '11:00'], [1, '10:30', '11:30'], [2, '10:00', '11:00'], [5, '10:00', '11:00'],
  [4, '10:00', '11:00'], [6, '10:00', '11:00'], [7, '10:00', '11:00'], [7, '12:00', '13:00'],
  [6, '10:30', '11:30'], [1, '14:00', '15:00'], [2, '14:00', '15:00'], [3, '16:00', '17:00'],
  [3, '16:30', '17:30'],
]

const lista = (ids) => ids.map((id) => `'${id}'`).join(', ')

function como(sub) {
  return `SET ROLE authenticated;
          SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`
}

/** Ejecuta y guarda en una variable de sesión 'OK' o el SQLSTATE del rechazo. */
function tolerante(sentencia) {
  return `DO $prueba$
          BEGIN
            BEGIN
              ${sentencia};
              PERFORM pg_catalog.set_config('ept12.resultado', 'OK', false);
            EXCEPTION WHEN OTHERS THEN
              PERFORM pg_catalog.set_config('ept12.resultado', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

const inscribir = (grupo) => `PERFORM public.inscribir_en_grupo_deportivo('${grupo}')`
const agregarFranja = (grupo, dia, inicio, fin) =>
  `PERFORM public.agregar_horario_grupo_deportivo('${grupo}', ${dia}::SMALLINT, '${inicio}', '${fin}')`

function resultado(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept12.resultado', true)`, etiqueta)
}

/** Cuenta como propietario: con la identidad de un alumno, RLS ocultaría filas. */
async function contar(sesion, sql, etiqueta) {
  await sesion.ejecutar('RESET ROLE;', `${etiqueta}_propietario`)
  return Number(await sesion.escalar(`(${sql})`, etiqueta))
}

const activasDe = (alumno) =>
  `SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA'`

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

/**
 * A abre transacción y ejecuta; B ejecuta la suya de forma tolerante y queda
 * bloqueada; se verifica el bloqueo; A confirma; B termina.
 */
async function carrera(sesiones, pids, { identidadA, sentenciaA, identidadB, sentenciaB, etiqueta }) {
  const [a, b] = sesiones
  await a.ejecutar(`${identidadA} BEGIN; ${sentenciaA};`, `${etiqueta}_a`)
  const pendiente = b.ejecutar(`${identidadB} ${tolerante(sentenciaB)}`, `${etiqueta}_b`)
  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', `${etiqueta}_commit`)
  await pendiente
  return resultado(b, `${etiqueta}_resultado`)
}

function sqlLimpieza() {
  const catalogo = FRANJAS_USADAS.map(
    ([dia, inicio, fin]) => `(${dia}, '${inicio}'::TIME, '${fin}'::TIME)`
  ).join(', ')
  return `RESET ROLE;
     BEGIN;
     DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.grupos_deportivos_horarios
       WHERE grupo_id IN (SELECT id FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}');
     DELETE FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}';
     DELETE FROM public.horarios h
       WHERE (h.dia_semana, h.hora_inicio, h.hora_fin) IN (VALUES ${catalogo})
         AND NOT EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios f WHERE f.horario_id = h.id);
     DELETE FROM public.matriculas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.alumnos WHERE perfil_id IN (${lista(ALUMNOS)});
     DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
     DELETE FROM public.cursos WHERE id = '${ID.curso}';
     COMMIT;`
}

/**
 * Limpieza con una conexión NUEVA: si una sesión quedó con una transacción
 * abortada o un bloqueo pendiente, no puede limpiar por sí misma.
 */
async function limpiarConSesionNueva() {
  const limpiadora = new SesionPsql('L', 'EPT12')
  try {
    await limpiadora.ejecutar(sqlLimpieza(), 'limpiar')
    const residuos = Number(
      await limpiadora.escalar(
        `(SELECT (SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)}))
               + (SELECT pg_catalog.count(*) FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}')
               + (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas WHERE alumno_id IN (${lista(ALUMNOS)})))`,
        'residuos'
      )
    )
    return residuos
  } finally {
    await limpiadora.cerrar()
  }
}

const sesionA = new SesionPsql('A', 'EPT12')
const sesionB = new SesionPsql('B', 'EPT12')
let exito = false

try {
  const pids = {
    a: Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid')),
    b: Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid')),
  }
  const sesiones = [sesionA, sesionB]

  afirmar((await limpiarConSesionNueva()) === 0, 'No se pudo partir de una base sin residuos')

  // Fixture sintético en UNA transacción (invariante diferida de 008). DNI en
  // un rango ficticio que no corresponde a personas reales.
  await sesionA.ejecutar(
    `BEGIN;
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo) VALUES
       ('${ID.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'CONCURRENCIA EPT-12', 'A', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::UUID, v.id::UUID, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${ID.director}', 'DIRECTOR',   'Directora', '99912001', NULL),
       ('${ID.docente}',  'DOCENTE',    'Docente',   '99912002', NULL),
       ('${ID.x}',  'ESTUDIANTE', 'Equis',  '99912003', 'LEG-EPT12-C3'),
       ('${ID.y}',  'ESTUDIANTE', 'Ye',     '99912004', 'LEG-EPT12-C4'),
       ('${ID.z}',  'ESTUDIANTE', 'Zeta',   '99912005', 'LEG-EPT12-C5'),
       ('${ID.w}',  'ESTUDIANTE', 'Doble',  '99912006', 'LEG-EPT12-C6'),
       ('${ID.v}',  'ESTUDIANTE', 'Uve',    '99912007', 'LEG-EPT12-C7'),
       ('${ID.v2}', 'ESTUDIANTE', 'Uve2',   '99912008', 'LEG-EPT12-C8'),
       ('${ID.u}',  'ESTUDIANTE', 'U',      '99912009', 'LEG-EPT12-C9'),
       ('${ID.t}',  'ESTUDIANTE', 'Te',     '99912010', 'LEG-EPT12-CA'),
       ('${ID.s}',  'ESTUDIANTE', 'Ese',    '99912011', 'LEG-EPT12-CB')
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;

     INSERT INTO public.matriculas (alumno_id, curso_id)
     SELECT a, '${ID.curso}' FROM unnest(ARRAY[${lista(ALUMNOS)}]::UUID[]) AS a;
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${lista(ALUMNOS)});
     COMMIT;`,
    'fixture'
  )

  await sesionA.ejecutar(como(ID.director), 'como_director')
  async function crearGrupo(clave, deporte, cupo, franjas) {
    const id = await sesionA.escalar(
      `(SELECT (public.crear_grupo_deportivo('${deporte}',
          (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
          'Concurrencia EPT-12 ${clave}', ${cupo}, '${ID.docente}')).id)`,
      `grupo_${clave}`
    )
    for (const [dia, inicio, fin] of franjas) {
      await sesionA.escalar(
        `(SELECT (public.agregar_horario_grupo_deportivo('${id}', ${dia}::SMALLINT, '${inicio}', '${fin}')).id)`,
        `franja_${clave}_${dia}`
      )
    }
    return id
  }

  const grupo = {
    lunes10: await crearGrupo('lunes10', DEPORTE.futbol, 10, [[1, '10:00', '11:00']]),
    lunes1030: await crearGrupo('lunes1030', DEPORTE.natacion, 10, [[1, '10:30', '11:30']]),
    martes: await crearGrupo('martes', DEPORTE.atletismo, 10, [[2, '10:00', '11:00']]),
    viernes: await crearGrupo('viernes', DEPORTE.voley, 10, [[5, '10:00', '11:00']]),
    cupoUno: await crearGrupo('cupo-uno', DEPORTE.basquet, 1, [[4, '10:00', '11:00']]),
    sabado: await crearGrupo('sabado', DEPORTE.marciales, 10, [[6, '10:00', '11:00']]),
    franjaA: await crearGrupo('franja-a', DEPORTE.voley, 10, [[7, '10:00', '11:00']]),
    franjaB: await crearGrupo('franja-b', DEPORTE.atletismo, 10, [[7, '12:00', '13:00']]),
    p: await crearGrupo('p', DEPORTE.natacion, 10, [[1, '14:00', '15:00']]),
    q: await crearGrupo('q', DEPORTE.basquet, 10, [[2, '14:00', '15:00']]),
  }

  // ------------------------------------------------------------------
  // 1. Mismo alumno, dos grupos incompatibles a la vez.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.x),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.lunes10}')`,
      identidadB: como(ID.x),
      sentenciaB: inscribir(grupo.lunes1030),
      etiqueta: 'incompatibles',
    })
    afirmar(r === 'P5584', `El alta incompatible simultánea terminó en ${r}, se esperaba P5584`)
    const activas = await contar(sesionA, activasDe(ID.x), 'x_activas')
    afirmar(activas === 1, `X quedó con ${activas} inscripciones activas`)
    console.log('OK HORARIOS 1: dos altas incompatibles simultáneas del mismo alumno — confirma una; la otra recibe P5584')
  }

  // ------------------------------------------------------------------
  // 2. Mismo alumno, dos grupos compatibles a la vez.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.y),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.lunes10}')`,
      identidadB: como(ID.y),
      sentenciaB: inscribir(grupo.martes),
      etiqueta: 'compatibles',
    })
    afirmar(r === 'OK', `El alta compatible simultánea terminó en ${r}, se esperaba OK`)
    const activas = await contar(sesionA, activasDe(ID.y), 'y_activas')
    afirmar(activas === 2, `Y quedó con ${activas} inscripciones activas`)
    console.log('OK HORARIOS 2: dos altas compatibles simultáneas del mismo alumno — confirman ambas (2 activas, dentro del máximo)')
  }

  // ------------------------------------------------------------------
  // 3. Dos alumnos por la última plaza de un grupo con horario.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.z),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.cupoUno}')`,
      identidadB: como(ID.w),
      sentenciaB: inscribir(grupo.cupoUno),
      etiqueta: 'ultima_plaza',
    })
    afirmar(r === 'P5574', `La segunda alta por la última plaza terminó en ${r}, se esperaba P5574`)
    const ocupadas = await contar(
      sesionA,
      `SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas WHERE grupo_id = '${grupo.cupoUno}' AND estado = 'ACTIVA'`,
      'cupo_uno'
    )
    afirmar(ocupadas === 1, `Quedaron ${ocupadas} inscripciones en un grupo de cupo 1`)
    console.log('OK HORARIOS 3: dos alumnos por la última plaza — confirma uno; el otro recibe P5574 (1 de 1)')
  }

  // ------------------------------------------------------------------
  // 4. X ya tiene Fútbol (carrera 1); intenta dos compatibles a la vez.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.x),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.martes}')`,
      identidadB: como(ID.x),
      sentenciaB: inscribir(grupo.viernes),
      etiqueta: 'maximo_dos',
    })
    afirmar(r === 'P5577', `El tercer deporte simultáneo terminó en ${r}, se esperaba P5577`)
    const activas = await contar(sesionA, activasDe(ID.x), 'x_maximo')
    afirmar(activas === 2, `X quedó con ${activas} deportes activos`)
    console.log('OK HORARIOS 4: con un deporte previo, dos altas compatibles simultáneas dejan una sola adicional (P5577)')
  }

  // ------------------------------------------------------------------
  // 5. Franja nueva primero, alta después, sobre el mismo grupo.
  // ------------------------------------------------------------------
  {
    await sesionA.ejecutar(`${como(ID.v)} SELECT public.inscribir_en_grupo_deportivo('${grupo.sabado}');`, 'v_sabado')
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.agregar_horario_grupo_deportivo('${grupo.franjaA}', 6::SMALLINT, '10:30', '11:30')`,
      identidadB: como(ID.v),
      sentenciaB: inscribir(grupo.franjaA),
      etiqueta: 'franja_luego_alta',
    })
    afirmar(r === 'P5584', `El alta posterior a la franja nueva terminó en ${r}, se esperaba P5584`)
    const activas = await contar(sesionA, activasDe(ID.v), 'v_activas')
    afirmar(activas === 1, `V quedó con ${activas} inscripciones activas`)
    console.log('OK HORARIOS 5: la dirección agrega una franja y un alumno se inscribe a la vez — el alta ve la franja nueva (P5584)')
  }

  // ------------------------------------------------------------------
  // 6. Alta primero, franja nueva después, sobre el mismo grupo.
  // ------------------------------------------------------------------
  {
    await sesionA.ejecutar(`${como(ID.v2)} SELECT public.inscribir_en_grupo_deportivo('${grupo.sabado}');`, 'v2_sabado')
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.v2),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.franjaB}')`,
      identidadB: como(ID.director),
      sentenciaB: agregarFranja(grupo.franjaB, 6, '10:30', '11:30'),
      etiqueta: 'alta_luego_franja',
    })
    afirmar(r === 'P5589', `La franja posterior al alta terminó en ${r}, se esperaba P5589`)
    const franjas = await contar(
      sesionA,
      `SELECT pg_catalog.count(*) FROM public.grupos_deportivos_horarios WHERE grupo_id = '${grupo.franjaB}' AND activo`,
      'franjas_b'
    )
    afirmar(franjas === 1, `El grupo quedó con ${franjas} franjas activas`)
    console.log('OK HORARIOS 6: un alumno se inscribe y la dirección agrega a la vez una franja que le chocaría — la franja se rechaza (P5589)')
  }

  // ------------------------------------------------------------------
  // 7. Dos franjas nuevas, en dos grupos que comparten un alumno.
  // ------------------------------------------------------------------
  {
    await sesionA.ejecutar(
      `${como(ID.u)} SELECT public.inscribir_en_grupo_deportivo('${grupo.p}');
       SELECT public.inscribir_en_grupo_deportivo('${grupo.q}');`,
      'u_p_q'
    )
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.agregar_horario_grupo_deportivo('${grupo.p}', 3::SMALLINT, '16:00', '17:00')`,
      identidadB: como(ID.director),
      sentenciaB: agregarFranja(grupo.q, 3, '16:30', '17:30'),
      etiqueta: 'dos_franjas',
    })
    afirmar(r === 'P5589', `La segunda franja simultánea terminó en ${r}, se esperaba P5589`)
    console.log('OK HORARIOS 7: dos franjas superpuestas en grupos que comparten un alumno, a la vez — confirma una; la otra recibe P5589')
  }

  // ------------------------------------------------------------------
  // 8. Baja y alta que chocaba con ella, a la vez.
  // ------------------------------------------------------------------
  {
    await sesionA.ejecutar(como(ID.t), 'como_t')
    const inscripcion = await sesionA.escalar(
      `(SELECT (public.inscribir_en_grupo_deportivo('${grupo.lunes10}')).id)`,
      't_lunes10'
    )
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.t),
      sentenciaA: `SELECT public.cancelar_inscripcion_deportiva('${inscripcion}')`,
      identidadB: como(ID.t),
      sentenciaB: inscribir(grupo.lunes1030),
      etiqueta: 'baja_libera',
    })
    afirmar(r === 'OK', `El alta posterior a la baja terminó en ${r}, se esperaba OK`)
    const activas = await contar(sesionA, activasDe(ID.t), 't_activas')
    afirmar(activas === 1, `T quedó con ${activas} inscripciones activas`)
    console.log('OK HORARIOS 8: una baja y un alta que chocaba con ella, a la vez — la baja libera el horario y el alta confirma')
  }

  // ------------------------------------------------------------------
  // 9. La dirección y el alumno inscriben a la vez en grupos incompatibles.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.inscribir_alumno_en_grupo_deportivo('${ID.s}', '${grupo.lunes10}')`,
      identidadB: como(ID.s),
      sentenciaB: inscribir(grupo.lunes1030),
      etiqueta: 'direccion_y_alumno',
    })
    afirmar(r === 'P5584', `El alta del alumno contra la administrativa terminó en ${r}, se esperaba P5584`)
    const activas = await contar(sesionA, activasDe(ID.s), 's_activas')
    afirmar(activas === 1, `S quedó con ${activas} inscripciones activas`)
    console.log('OK HORARIOS 9: la dirección y el alumno inscriben a la vez en grupos incompatibles — misma regla, confirma uno (P5584)')
  }

  // ------------------------------------------------------------------
  // Invariante final sobre todos los alumnos del arnés.
  // ------------------------------------------------------------------
  {
    const superpuestas = await contar(
      sesionA,
      `SELECT pg_catalog.count(*)
       FROM public.inscripciones_deportivas a
       JOIN public.inscripciones_deportivas b
         ON b.alumno_id = a.alumno_id AND b.id > a.id AND b.estado = 'ACTIVA'
       JOIN public.grupos_deportivos_horarios fa ON fa.grupo_id = a.grupo_id AND fa.activo
       JOIN public.horarios ha ON ha.id = fa.horario_id
       JOIN public.grupos_deportivos_horarios fb ON fb.grupo_id = b.grupo_id AND fb.activo
       JOIN public.horarios hb ON hb.id = fb.horario_id
       WHERE a.estado = 'ACTIVA' AND a.alumno_id IN (${lista(ALUMNOS)})
         AND app_private.intervalos_se_superponen(ha.dia_semana, ha.hora_inicio, ha.hora_fin,
                                                  hb.dia_semana, hb.hora_inicio, hb.hora_fin)`,
      'invariante'
    )
    afirmar(superpuestas === 0, `Quedaron ${superpuestas} pares de actividades superpuestas`)
    const maximo = await contar(
      sesionA,
      `SELECT COALESCE(max(n), 0) FROM (
         SELECT pg_catalog.count(*) AS n FROM public.inscripciones_deportivas
         WHERE alumno_id IN (${lista(ALUMNOS)}) AND estado = 'ACTIVA' GROUP BY alumno_id) c`,
      'maximo'
    )
    afirmar(maximo <= 2, `Un alumno quedó con ${maximo} deportes activos`)
    console.log('OK HORARIOS: invariante final — ningún alumno con actividades superpuestas ni con más de dos deportes')
  }

  exito = true
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
  const residuos = await limpiarConSesionNueva()
  if (residuos !== 0) {
    console.error(`FALLO  quedaron ${residuos} filas sintéticas después de limpiar`)
    process.exitCode = 1
  } else if (exito) {
    console.log('OK HORARIOS: las nueve carreras quedan demostradas y la base queda sin residuos')
  } else {
    console.log('La base quedó sin residuos pese al fallo.')
  }
}
