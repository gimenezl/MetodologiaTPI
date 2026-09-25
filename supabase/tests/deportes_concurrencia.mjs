import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la inscripción deportiva (EPT-11, EPT-35, EPT-36).
 *
 * Usa DOS conexiones PostgreSQL independientes: cada `SesionPsql` es un `psql`
 * propio, así que compiten de verdad por los bloqueos de fila. La coordinación
 * es determinista (`pg_blocking_pids`), nunca por tiempo: la sesión A abre su
 * transacción y ejecuta su operación; la sesión B lanza la suya y se comprueba
 * que quedó bloqueada por A antes de que A confirme.
 *
 * Demuestra que:
 *   1. Dos alumnos por la última plaza: confirma exactamente uno.
 *   2. Un alumno con un deporte que intenta dos nuevos a la vez: como máximo
 *      uno adicional.
 *   3. El mismo alumno, el mismo grupo dos veces a la vez: una sola fila.
 *   4. El mismo alumno, dos grupos del mismo deporte a la vez: uno solo.
 *   5. Baja y alta simultáneas sobre un grupo lleno: la plaza liberada se
 *      reutiliza una vez y el conteo final es exacto.
 *   6. Doble baja simultánea: una confirma, la otra recibe P5579 y la plaza se
 *      libera una sola vez.
 *   7. Reducción de cupo y alta simultáneas, en los dos órdenes: nunca queda
 *      más ocupación que cupo.
 *   8. Cambio de curso del alumno y alta simultáneos: el nivel que decide el
 *      alta es el vigente al confirmar.
 *
 * Corre contra la base local descartable. Crea sus propios datos sintéticos y
 * los borra al final como propietario; ese borrado no representa ninguna
 * operación disponible en la aplicación, que no tiene DELETE.
 */

const ID = {
  director: 'b1000000-0000-4000-8000-000000000001',
  docente: 'b1000000-0000-4000-8000-000000000002',
  x: 'b1000000-0000-4000-8000-000000000003',
  y: 'b1000000-0000-4000-8000-000000000004',
  z: 'b1000000-0000-4000-8000-000000000005',
  w: 'b1000000-0000-4000-8000-000000000006',
  cursoPrimario: 'b1000000-0000-4000-8000-0000000000c1',
  cursoInicial: 'b1000000-0000-4000-8000-0000000000c2',
}
const ALUMNOS = [ID.x, ID.y, ID.z, ID.w]
const PERFILES = [ID.director, ID.docente, ...ALUMNOS]

const DEPORTE = {
  futbol: 'e0000000-0000-4000-8000-000000000101',
  natacion: 'e0000000-0000-4000-8000-000000000102',
  atletismo: 'e0000000-0000-4000-8000-000000000103',
  voley: 'e0000000-0000-4000-8000-000000000105',
  basquet: 'e0000000-0000-4000-8000-000000000106',
}

const lista = (ids) => ids.map((id) => `'${id}'`).join(', ')

function como(sub) {
  return `SET ROLE authenticated;
          SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`
}

/**
 * Ejecuta una sentencia y guarda su desenlace en una variable de sesión: 'OK'
 * o el SQLSTATE del rechazo. Los avisos de `psql` van a la salida de error, que
 * el arnés captura aparte; una variable de sesión es legible desde el flujo.
 */
function tolerante(sentencia) {
  return `DO $prueba$
          BEGIN
            BEGIN
              ${sentencia};
              PERFORM pg_catalog.set_config('ept11.resultado', 'OK', false);
            EXCEPTION WHEN OTHERS THEN
              PERFORM pg_catalog.set_config('ept11.resultado', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

const inscribir = (grupo) => `PERFORM public.inscribir_en_grupo_deportivo('${grupo}')`
const cancelar = (inscripcion) =>
  `PERFORM public.cancelar_inscripcion_deportiva('${inscripcion}')`

function resultado(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept11.resultado', true)`, etiqueta)
}

/**
 * Cuenta como propietario. Si contara con la identidad de un alumno, RLS le
 * ocultaría las filas ajenas y el conteo mentiría a favor de la prueba.
 */
async function contar(sesion, condicion, etiqueta) {
  await sesion.ejecutar('RESET ROLE;', `${etiqueta}_propietario`)
  return Number(
    await sesion.escalar(
      `(SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas WHERE ${condicion})`,
      etiqueta
    )
  )
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

/**
 * Franja propia de este arnés. Desde EPT-12 (migración 015) un grupo sin
 * horario no admite inscripciones, así que cada grupo recibe una franja en un
 * día DISTINTO: ninguna carrera de esta suite depende de la regla horaria, que
 * se prueba en `horarios_concurrencia.mjs`. El minuto 07 hace que las filas del
 * catálogo sean inconfundibles al limpiar.
 */
const FRANJA = { inicio: '18:07', fin: '19:07' }
let diaSiguiente = 1

async function crearGrupo(sesion, clave, deporte, nivel, cupo) {
  const id = await sesion.escalar(
    `(SELECT (public.crear_grupo_deportivo('${deporte}',
        (SELECT id FROM public.niveles WHERE nombre = '${nivel}'),
        'Concurrencia EPT-11 ${clave}', ${cupo}, '${ID.docente}')).id)`,
    `grupo_${clave}`
  )
  await sesion.escalar(
    `(SELECT (public.agregar_horario_grupo_deportivo('${id}', ${diaSiguiente++}::SMALLINT,
        '${FRANJA.inicio}', '${FRANJA.fin}')).id)`,
    `franja_${clave}`
  )
  return id
}

/**
 * Patrón común: A abre transacción y ejecuta; B ejecuta su operación tolerante
 * y queda bloqueada; se verifica el bloqueo; A confirma; B termina.
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

const sesionA = new SesionPsql('A', 'EPT11')
const sesionB = new SesionPsql('B', 'EPT11')

async function limpiar() {
  await sesionA.ejecutar(
    `RESET ROLE;
     BEGIN;
     DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.grupos_deportivos_horarios
       WHERE grupo_id IN (SELECT id FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}');
     DELETE FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}';
     DELETE FROM public.horarios h
       WHERE h.hora_inicio = '${FRANJA.inicio}' AND h.hora_fin = '${FRANJA.fin}'
         AND NOT EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios f WHERE f.horario_id = h.id);
     DELETE FROM public.matriculas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.alumnos WHERE perfil_id IN (${lista(ALUMNOS)});
     -- Desde EPT-58 el perfil DOCENTE tiene ficha y la FK es RESTRICT.
     DELETE FROM public.profesores WHERE perfil_id IN (${lista(PERFILES)});
     DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
     DELETE FROM public.cursos WHERE id IN ('${ID.cursoPrimario}', '${ID.cursoInicial}');
     COMMIT;`,
    'limpiar'
  )
}

try {
  const pids = {
    a: Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid')),
    b: Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid')),
  }
  const sesiones = [sesionA, sesionB]

  // ------------------------------------------------------------------
  // Fixture sintético en UNA transacción (invariante diferida de 008).
  // Los DNI están en un rango ficticio y no corresponden a personas reales.
  // ------------------------------------------------------------------
  await limpiar()
  await sesionA.ejecutar(
    `BEGIN;
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo) VALUES
       ('${ID.cursoPrimario}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'CONCURRENCIA EPT-11', 'A', TRUE),
       ('${ID.cursoInicial}', (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'),
        'CONCURRENCIA EPT-11', 'B', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::UUID, v.id::UUID, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${ID.director}', 'DIRECTOR',   'Directora',  '99911001', NULL),
       ('${ID.docente}',  'DOCENTE',    'Docente',    '99911002', NULL),
       ('${ID.x}',        'ESTUDIANTE', 'Equis',      '99911003', 'LEG-EPT11-C3'),
       ('${ID.y}',        'ESTUDIANTE', 'Ye',         '99911004', 'LEG-EPT11-C4'),
       ('${ID.z}',        'ESTUDIANTE', 'Zeta',       '99911005', 'LEG-EPT11-C5'),
       ('${ID.w}',        'ESTUDIANTE', 'Doble',      '99911006', 'LEG-EPT11-C6')
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;

     INSERT INTO public.matriculas (alumno_id, curso_id)
     SELECT a, '${ID.cursoPrimario}' FROM unnest(ARRAY[${lista(ALUMNOS)}]::UUID[]) AS a;
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${lista(ALUMNOS)});
     COMMIT;`,
    'fixture'
  )

  await sesionA.ejecutar(como(ID.director), 'como_director')
  const grupo = {
    ultimaPlaza: await crearGrupo(sesionA, 'ultima', DEPORTE.basquet, 'PRIMARIO', 1),
    futbolA: await crearGrupo(sesionA, 'futbol-a', DEPORTE.futbol, 'PRIMARIO', 10),
    futbolB: await crearGrupo(sesionA, 'futbol-b', DEPORTE.futbol, 'PRIMARIO', 10),
    natacion: await crearGrupo(sesionA, 'natacion', DEPORTE.natacion, 'PRIMARIO', 10),
    atletismo: await crearGrupo(sesionA, 'atletismo', DEPORTE.atletismo, 'PRIMARIO', 10),
    voley: await crearGrupo(sesionA, 'voley', DEPORTE.voley, 'PRIMARIO', 2),
  }

  // ------------------------------------------------------------------
  // 1. Dos alumnos por la última plaza.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.x),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.ultimaPlaza}')`,
      identidadB: como(ID.y),
      sentenciaB: inscribir(grupo.ultimaPlaza),
      etiqueta: 'ultima_plaza',
    })
    afirmar(r === 'P5574', `La segunda alta por la última plaza terminó en ${r}, se esperaba P5574`)
    const activas = await contar(sesionA, `grupo_id = '${grupo.ultimaPlaza}' AND estado = 'ACTIVA'`, 'ultima_activas')
    afirmar(activas === 1, `Quedaron ${activas} inscripciones en un grupo de cupo 1`)
    console.log('OK CONCURRENCIA 1: dos alumnos por la última plaza — confirma exactamente uno; el otro recibe P5574 y el cupo final es 1 de 1')
  }

  // ------------------------------------------------------------------
  // 2. X ya tiene un deporte (Básquet); intenta dos nuevos a la vez.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.x),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.natacion}')`,
      identidadB: como(ID.x),
      sentenciaB: inscribir(grupo.atletismo),
      etiqueta: 'dos_nuevos',
    })
    afirmar(r === 'P5577', `El tercer deporte simultáneo terminó en ${r}, se esperaba P5577`)
    const activas = await contar(sesionA, `alumno_id = '${ID.x}' AND estado = 'ACTIVA'`, 'x_activas')
    afirmar(activas === 2, `X quedó con ${activas} deportes activos`)
    console.log('OK CONCURRENCIA 2: con un deporte previo, dos altas simultáneas dejan solo una adicional (2 activos); la otra recibe P5577')
  }

  // ------------------------------------------------------------------
  // 3. Z, el mismo grupo dos veces a la vez.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.z),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.futbolA}')`,
      identidadB: como(ID.z),
      sentenciaB: inscribir(grupo.futbolA),
      etiqueta: 'mismo_grupo',
    })
    afirmar(r === 'P5575', `El duplicado simultáneo terminó en ${r}, se esperaba P5575`)
    const filas = await contar(sesionA, `alumno_id = '${ID.z}' AND grupo_id = '${grupo.futbolA}'`, 'z_filas')
    afirmar(filas === 1, `Z quedó con ${filas} filas en el mismo grupo`)
    console.log('OK CONCURRENCIA 3: el mismo grupo pedido dos veces a la vez deja una sola fila; el duplicado recibe P5575')
  }

  // ------------------------------------------------------------------
  // 4. W, dos grupos del mismo deporte a la vez.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.w),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.futbolA}')`,
      identidadB: como(ID.w),
      sentenciaB: inscribir(grupo.futbolB),
      etiqueta: 'mismo_deporte',
    })
    afirmar(r === 'P5576', `El mismo deporte simultáneo terminó en ${r}, se esperaba P5576`)
    const futbol = await contar(
      sesionA,
      `alumno_id = '${ID.w}' AND deporte_id = '${DEPORTE.futbol}' AND estado = 'ACTIVA'`,
      'w_futbol'
    )
    afirmar(futbol === 1, `W quedó con ${futbol} grupos activos de fútbol`)
    console.log('OK CONCURRENCIA 4: dos grupos del mismo deporte pedidos a la vez dejan uno solo; el otro recibe P5576')
  }

  // ------------------------------------------------------------------
  // 5. Grupo lleno (X ocupa la única plaza): X cancela y Y se inscribe a la vez.
  // ------------------------------------------------------------------
  {
    await sesionA.ejecutar('RESET ROLE;', 'reset_5')
    const inscripcionX = await sesionA.escalar(
      `(SELECT id FROM public.inscripciones_deportivas
        WHERE alumno_id = '${ID.x}' AND grupo_id = '${grupo.ultimaPlaza}' AND estado = 'ACTIVA')`,
      'insc_x'
    )
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.x),
      sentenciaA: `SELECT public.cancelar_inscripcion_deportiva('${inscripcionX}')`,
      identidadB: como(ID.y),
      sentenciaB: inscribir(grupo.ultimaPlaza),
      etiqueta: 'baja_y_alta',
    })
    afirmar(r === 'OK', `El alta concurrente con la baja terminó en ${r}, se esperaba OK`)
    const activas = await contar(sesionA, `grupo_id = '${grupo.ultimaPlaza}' AND estado = 'ACTIVA'`, 'ultima_tras_baja')
    const deY = await contar(
      sesionA,
      `grupo_id = '${grupo.ultimaPlaza}' AND estado = 'ACTIVA' AND alumno_id = '${ID.y}'`,
      'ultima_de_y'
    )
    afirmar(activas === 1 && deY === 1, `Tras baja y alta quedaron ${activas} activas (${deY} de Y)`)
    console.log('OK CONCURRENCIA 5: baja y alta simultáneas en un grupo lleno — la plaza liberada la toma el otro alumno y el conteo final es exacto (1 de 1)')
  }

  // ------------------------------------------------------------------
  // 6. Doble baja simultánea de la misma inscripción.
  // ------------------------------------------------------------------
  {
    await sesionA.ejecutar('RESET ROLE;', 'reset_6')
    const inscripcionZ = await sesionA.escalar(
      `(SELECT id FROM public.inscripciones_deportivas
        WHERE alumno_id = '${ID.z}' AND grupo_id = '${grupo.futbolA}' AND estado = 'ACTIVA')`,
      'insc_z'
    )
    const antes = await contar(sesionA, `grupo_id = '${grupo.futbolA}' AND estado = 'ACTIVA'`, 'futbol_antes')
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.z),
      sentenciaA: `SELECT public.cancelar_inscripcion_deportiva('${inscripcionZ}')`,
      identidadB: como(ID.z),
      sentenciaB: cancelar(inscripcionZ),
      etiqueta: 'doble_baja',
    })
    afirmar(r === 'P5579', `La segunda baja simultánea terminó en ${r}, se esperaba P5579`)
    const despues = await contar(sesionA, `grupo_id = '${grupo.futbolA}' AND estado = 'ACTIVA'`, 'futbol_despues')
    afirmar(despues === antes - 1, `La doble baja dejó ${despues} activas (antes ${antes})`)
    console.log('OK CONCURRENCIA 6: doble baja simultánea — confirma una, la otra recibe P5579 y la plaza se libera una sola vez')
  }

  // ------------------------------------------------------------------
  // 7a. Reducción de cupo primero, alta después: Vóley (cupo 2) con 1 activa.
  // ------------------------------------------------------------------
  {
    await sesionA.ejecutar(`${como(ID.z)} SELECT public.inscribir_en_grupo_deportivo('${grupo.voley}');`, 'voley_z')
    const r = await carrera(sesiones, pids, {
      identidadA: 'RESET ROLE;',
      sentenciaA: `UPDATE public.grupos_deportivos SET cupo = 1 WHERE id = '${grupo.voley}'`,
      identidadB: como(ID.y),
      sentenciaB: inscribir(grupo.voley),
      etiqueta: 'cupo_primero',
    })
    afirmar(r === 'P5574', `El alta tras reducir el cupo terminó en ${r}, se esperaba P5574`)
    const activas = await contar(sesionA, `grupo_id = '${grupo.voley}' AND estado = 'ACTIVA'`, 'voley_7a')
    afirmar(activas === 1, `Vóley quedó con ${activas} activas y cupo 1`)
    console.log('OK CONCURRENCIA 7a: reducir el cupo y dar un alta a la vez (cupo primero) — el alta ve el cupo nuevo y recibe P5574; ocupación 1 de 1')
  }

  // 7b. Alta primero, reducción de cupo después.
  {
    await sesionA.ejecutar(`RESET ROLE; UPDATE public.grupos_deportivos SET cupo = 2 WHERE id = '${grupo.voley}';`, 'voley_cupo_2')
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.w),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${grupo.voley}')`,
      identidadB: 'RESET ROLE;',
      sentenciaB: `UPDATE public.grupos_deportivos SET cupo = 1 WHERE id = '${grupo.voley}'`,
      etiqueta: 'alta_primero',
    })
    afirmar(r === 'P5581', `La reducción tras el alta terminó en ${r}, se esperaba P5581`)
    await sesionA.ejecutar('RESET ROLE;', 'reset_7b')
    const cupo = Number(await sesionA.escalar(`(SELECT cupo FROM public.grupos_deportivos WHERE id = '${grupo.voley}')`, 'cupo_7b'))
    const activas = await contar(sesionA, `grupo_id = '${grupo.voley}' AND estado = 'ACTIVA'`, 'voley_7b')
    afirmar(cupo === 2 && activas === 2, `Vóley quedó con cupo ${cupo} y ${activas} activas`)
    console.log('OK CONCURRENCIA 7b: alta primero y reducción después — la reducción ve la ocupación real y recibe P5581; ocupación 2 de 2')
  }

  // ------------------------------------------------------------------
  // 8. Cambio de curso (a INICIAL) y alta en PRIMARIO a la vez.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.cambiar_curso_alumno('${ID.y}', '${ID.cursoInicial}')`,
      identidadB: como(ID.y),
      sentenciaB: inscribir(grupo.natacion),
      etiqueta: 'cambio_de_curso',
    })
    afirmar(r === 'P5573', `El alta concurrente al cambio de curso terminó en ${r}, se esperaba P5573`)
    const natacionY = await contar(sesionA, `alumno_id = '${ID.y}' AND grupo_id = '${grupo.natacion}'`, 'natacion_y')
    afirmar(natacionY === 0, 'Y quedó inscripto en un grupo de otro nivel')
    console.log('OK CONCURRENCIA 8: cambio de curso y alta simultáneos — el alta se serializa detrás del cambio y usa el nivel nuevo (P5573)')
  }

  await limpiar()
  console.log('OK CONCURRENCIA: las ocho carreras deportivas quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
