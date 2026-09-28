import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la administración de deportes y grupos (EPT-61).
 *
 * Usa DOS conexiones PostgreSQL independientes: cada `SesionPsql` es un
 * proceso `psql` propio, así que compiten de verdad por los bloqueos de fila.
 * La coordinación es determinista (`pg_blocking_pids`), nunca por tiempo: la
 * sesión A abre su transacción y ejecuta su operación; la sesión B lanza la
 * suya y se comprueba que quedó bloqueada por A antes de que A confirme.
 *
 * Demuestra que:
 *   1. Inscripción e inactivación del mismo grupo a la vez, en los DOS
 *      órdenes: nunca queda un grupo inactivo con una inscripción activa.
 *   2. Alta de un grupo e inactivación de su deporte a la vez, en los DOS
 *      órdenes: nunca queda un deporte inactivo con un grupo activo. También
 *      con la REACTIVACIÓN de un grupo.
 *   3. Reducción de cupo e inscripción a la vez, en los DOS órdenes: nunca
 *      queda un cupo menor que la ocupación.
 *   4. Dos cambios de estado simultáneos del mismo grupo (inactivar dos veces
 *      e inactivar-reactivar): el resultado es el de una ejecución en serie.
 *   5. Alta de un grupo y renombrado de su deporte a la vez: el renombrado
 *      ve el grupo confirmado y respeta la identidad protegida (P5580).
 *   6. Dos altas simultáneas del mismo nombre de deporte: una sola fila y el
 *      segundo recibe P5971.
 *   7. Reactivar un grupo mientras otra transacción configura sus franjas
 *      (bloqueo consultivo de EPT-57) no forma ciclos de espera (40P01): ni con
 *      la carga real de una franja ni con la ventana que un orden inverso
 *      abriría.
 *
 * Corre contra la base local descartable. Crea sus propios datos sintéticos y
 * los borra al final como propietario; ese borrado no representa ninguna
 * operación disponible en la aplicación, que no tiene DELETE. Los conteos se
 * hacen como propietario: con la identidad de un alumno, RLS ocultaría filas
 * ajenas y el conteo mentiría a favor de la prueba.
 */

const ID = {
  director: 'b6100000-0000-4000-8000-000000000001',
  docente: 'b6100000-0000-4000-8000-000000000002',
  s1: 'b6100000-0000-4000-8000-000000000003',
  s2: 'b6100000-0000-4000-8000-000000000004',
  s3: 'b6100000-0000-4000-8000-000000000005',
  s4: 'b6100000-0000-4000-8000-000000000006',
  s5: 'b6100000-0000-4000-8000-000000000007',
  curso: 'b6100000-0000-4000-8000-0000000000c1',
}
const ALUMNOS = [ID.s1, ID.s2, ID.s3, ID.s4, ID.s5]
const PERFILES = [ID.director, ID.docente, ...ALUMNOS]

const PREFIJO = 'Concurrencia EPT-61'
/** El minuto 11 hace inconfundibles las filas del catálogo de horarios. */
const FRANJA = { inicio: '18:11', fin: '19:11' }
let diaSiguiente = 1

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
              PERFORM pg_catalog.set_config('ept61.resultado', 'OK', false);
            EXCEPTION WHEN OTHERS THEN
              PERFORM pg_catalog.set_config('ept61.resultado', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

function resultado(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept61.resultado', true)`, etiqueta)
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

/** Consulta como propietario. */
async function consultar(sesion, expresion, etiqueta) {
  await sesion.ejecutar('RESET ROLE;', `${etiqueta}_propietario`)
  return sesion.escalar(expresion, etiqueta)
}

const inscribir = (grupo) => `PERFORM public.inscribir_en_grupo_deportivo('${grupo}')`
const estadoGrupo = (grupo, activo) =>
  `PERFORM public.cambiar_estado_grupo_deportivo('${grupo}', ${activo})`
const estadoDeporte = (deporte, activo) =>
  `PERFORM public.cambiar_estado_deporte('${deporte}', ${activo})`
const editarGrupo = (grupo, nombre, cupo) =>
  `PERFORM public.editar_grupo_deportivo('${grupo}', '${nombre}', ${cupo}, '${ID.docente}')`

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

const sesionA = new SesionPsql('A', 'EPT61')
const sesionB = new SesionPsql('B', 'EPT61')

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
     DELETE FROM public.deportes WHERE nombre LIKE '${PREFIJO}%';
     DELETE FROM public.matriculas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.alumnos WHERE perfil_id IN (${lista(ALUMNOS)});
     -- Desde EPT-58 el perfil DOCENTE tiene ficha y la FK es RESTRICT.
     DELETE FROM public.profesores WHERE perfil_id IN (${lista(PERFILES)});
     DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
     DELETE FROM public.cursos WHERE id = '${ID.curso}';
     COMMIT;`,
    'limpiar'
  )
}

async function crearDeporte(sesion, clave) {
  await sesion.ejecutar(como(ID.director), `como_director_${clave}`)
  return sesion.escalar(
    `(SELECT (public.crear_deporte('${PREFIJO} ${clave}')).id)`,
    `deporte_${clave}`
  )
}

/** Crea un grupo (con franja propia en un día distinto si `franja`). */
async function crearGrupo(sesion, clave, deporte, cupo, { franja = false } = {}) {
  await sesion.ejecutar(como(ID.director), `como_director_${clave}`)
  const id = await sesion.escalar(
    `(SELECT (public.crear_grupo_deportivo('${deporte}',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        '${PREFIJO} ${clave}', ${cupo}, '${ID.docente}')).id)`,
    `grupo_${clave}`
  )
  if (franja) {
    await sesion.escalar(
      `(SELECT (public.agregar_horario_grupo_deportivo('${id}', ${diaSiguiente++}::SMALLINT,
          '${FRANJA.inicio}', '${FRANJA.fin}')).id)`,
      `franja_${clave}`
    )
  }
  return id
}

const contarActivas = async (sesion, grupo, etiqueta) =>
  Number(
    await consultar(
      sesion,
      `(SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas
        WHERE grupo_id = '${grupo}' AND estado = 'ACTIVA')`,
      etiqueta
    )
  )

const estadoActivo = (sesion, tabla, id, etiqueta) =>
  consultar(sesion, `(SELECT activo FROM public.${tabla} WHERE id = '${id}')`, etiqueta)

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
       ('${ID.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'CONCURRENCIA EPT-61', 'A', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::UUID, v.id::UUID, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${ID.director}', 'DIRECTOR',   'Directora', '99961001', NULL),
       ('${ID.docente}',  'DOCENTE',    'Docente',   '99961002', NULL),
       ('${ID.s1}',       'ESTUDIANTE', 'Uno',       '99961003', 'LEG-EPT61-C3'),
       ('${ID.s2}',       'ESTUDIANTE', 'Dos',       '99961004', 'LEG-EPT61-C4'),
       ('${ID.s3}',       'ESTUDIANTE', 'Tres',      '99961005', 'LEG-EPT61-C5'),
       ('${ID.s4}',       'ESTUDIANTE', 'Cuatro',    '99961006', 'LEG-EPT61-C6'),
       ('${ID.s5}',       'ESTUDIANTE', 'Cinco',     '99961007', 'LEG-EPT61-C7')
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;

     INSERT INTO public.matriculas (alumno_id, curso_id)
     SELECT a, '${ID.curso}' FROM unnest(ARRAY[${lista(ALUMNOS)}]::UUID[]) AS a;
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${lista(ALUMNOS)});
     COMMIT;`,
    'fixture'
  )

  await sesionA.ejecutar(como(ID.director), 'como_director')

  // ------------------------------------------------------------------
  // 1a. Inscripción primero, inactivación del grupo después.
  //     A (alumno S1) se inscribe y aún no confirma; B (dirección) intenta
  //     inactivar el mismo grupo: queda detrás de la alta, la cuenta y se
  //     rechaza (P5975). El grupo queda activo con una inscripción activa.
  // ------------------------------------------------------------------
  const d1 = await crearDeporte(sesionA, 'd1')
  const g1 = await crearGrupo(sesionA, 'g1', d1, 5, { franja: true })
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.s1),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${g1}')`,
      identidadB: como(ID.director),
      sentenciaB: estadoGrupo(g1, false),
      etiqueta: 'inscribir_y_inactivar',
    })
    afirmar(r === 'P5975', `La inactivación tras la alta terminó en ${r}, se esperaba P5975`)
    const activas = await contarActivas(sesionA, g1, 'g1_activas')
    const activo = await estadoActivo(sesionA, 'grupos_deportivos', g1, 'g1_activo')
    afirmar(activas === 1 && activo === 'true', `Quedó el grupo activo=${activo} con ${activas} inscripción(es)`)
    console.log('OK CONCURRENCIA 1a: alta primero e inactivación después — la inactivación cuenta la inscripción y recibe P5975; el grupo queda activo con 1 inscripción')
  }

  // ------------------------------------------------------------------
  // 1b. Inactivación primero, inscripción después.
  //     A (dirección) inactiva un grupo sin inscripciones y aún no confirma;
  //     B (alumno S2) intenta inscribirse: espera el bloqueo del grupo, relee
  //     el grupo ya inactivo y recibe P5569. No queda ninguna inscripción.
  // ------------------------------------------------------------------
  const d2 = await crearDeporte(sesionA, 'd2')
  const g2 = await crearGrupo(sesionA, 'g2', d2, 5, { franja: true })
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.cambiar_estado_grupo_deportivo('${g2}', false)`,
      identidadB: como(ID.s2),
      sentenciaB: inscribir(g2),
      etiqueta: 'inactivar_e_inscribir',
    })
    afirmar(r === 'P5569', `El alta tras la inactivación terminó en ${r}, se esperaba P5569`)
    const activas = await contarActivas(sesionA, g2, 'g2_activas')
    const activo = await estadoActivo(sesionA, 'grupos_deportivos', g2, 'g2_activo')
    afirmar(activas === 0 && activo === 'false', `Quedó el grupo activo=${activo} con ${activas} inscripción(es)`)
    console.log('OK CONCURRENCIA 1b: inactivación primero y alta después — el alta relee el grupo inactivo y recibe P5569; sin inscripciones')
  }

  // ------------------------------------------------------------------
  // 2a. Alta de un grupo primero, inactivación de su deporte después.
  //     A crea un grupo del deporte y aún no confirma; B intenta inactivar el
  //     deporte: espera el bloqueo del deporte, cuenta el grupo y recibe P5974.
  // ------------------------------------------------------------------
  const d3 = await crearDeporte(sesionA, 'd3')
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.crear_grupo_deportivo('${d3}',
                     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
                     '${PREFIJO} g3', 5, '${ID.docente}')`,
      identidadB: como(ID.director),
      sentenciaB: estadoDeporte(d3, false),
      etiqueta: 'crear_grupo_e_inactivar_deporte',
    })
    afirmar(r === 'P5974', `La inactivación del deporte tras el alta terminó en ${r}, se esperaba P5974`)
    const activo = await estadoActivo(sesionA, 'deportes', d3, 'd3_activo')
    const grupos = await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.grupos_deportivos WHERE deporte_id = '${d3}' AND activo)`,
      'd3_grupos'
    )
    afirmar(activo === 'true' && grupos === '1', `Quedó el deporte activo=${activo} con ${grupos} grupo(s) activo(s)`)
    console.log('OK CONCURRENCIA 2a: alta de grupo primero e inactivación del deporte después — cuenta el grupo y recibe P5974; el deporte queda activo con 1 grupo activo')
  }

  // ------------------------------------------------------------------
  // 2b. Inactivación del deporte primero, alta de un grupo después.
  //     B espera el bloqueo del deporte, lo relee inactivo y recibe P5561.
  // ------------------------------------------------------------------
  const d4 = await crearDeporte(sesionA, 'd4')
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.cambiar_estado_deporte('${d4}', false)`,
      identidadB: como(ID.director),
      sentenciaB: `PERFORM public.crear_grupo_deportivo('${d4}',
                     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
                     '${PREFIJO} g4', 5, '${ID.docente}')`,
      etiqueta: 'inactivar_deporte_y_crear_grupo',
    })
    afirmar(r === 'P5561', `El alta del grupo tras la inactivación terminó en ${r}, se esperaba P5561`)
    const activo = await estadoActivo(sesionA, 'deportes', d4, 'd4_activo')
    const grupos = await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.grupos_deportivos WHERE deporte_id = '${d4}')`,
      'd4_grupos'
    )
    afirmar(activo === 'false' && grupos === '0', `Quedó el deporte activo=${activo} con ${grupos} grupo(s)`)
    console.log('OK CONCURRENCIA 2b: inactivación del deporte primero y alta de grupo después — el alta relee el deporte inactivo y recibe P5561; sin grupos')
  }

  // ------------------------------------------------------------------
  // 2c. Reactivación de un grupo primero, inactivación de su deporte después.
  // ------------------------------------------------------------------
  const d5 = await crearDeporte(sesionA, 'd5')
  const g5 = await crearGrupo(sesionA, 'g5', d5, 5)
  await sesionA.ejecutar(`${como(ID.director)} SELECT public.cambiar_estado_grupo_deportivo('${g5}', false);`, 'g5_inactivo')
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.cambiar_estado_grupo_deportivo('${g5}', true)`,
      identidadB: como(ID.director),
      sentenciaB: estadoDeporte(d5, false),
      etiqueta: 'reactivar_grupo_e_inactivar_deporte',
    })
    afirmar(r === 'P5974', `La inactivación del deporte tras la reactivación terminó en ${r}, se esperaba P5974`)
    const grupoActivo = await estadoActivo(sesionA, 'grupos_deportivos', g5, 'g5_activo')
    const deporteActivo = await estadoActivo(sesionA, 'deportes', d5, 'd5_activo')
    afirmar(grupoActivo === 'true' && deporteActivo === 'true', `Quedó el grupo activo=${grupoActivo} y el deporte activo=${deporteActivo}`)
    console.log('OK CONCURRENCIA 2c: reactivar un grupo e inactivar su deporte a la vez — nunca queda un deporte inactivo con un grupo activo (P5974)')
  }

  // ------------------------------------------------------------------
  // 3a. Reducción de cupo primero, inscripción después.
  //     Grupo de cupo 2 con 1 activa (S2). A reduce el cupo a 1 (permitido) y
  //     aún no confirma; B (alumno S3) se inscribe: espera, ve el cupo nuevo y
  //     recibe P5574. Ocupación 1 de 1.
  // ------------------------------------------------------------------
  const d6 = await crearDeporte(sesionA, 'd6')
  const g6 = await crearGrupo(sesionA, 'g6', d6, 2, { franja: true })
  await sesionA.ejecutar(`${como(ID.s2)} SELECT public.inscribir_en_grupo_deportivo('${g6}');`, 'g6_s2')
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.editar_grupo_deportivo('${g6}', '${PREFIJO} g6', 1, '${ID.docente}')`,
      identidadB: como(ID.s3),
      sentenciaB: inscribir(g6),
      etiqueta: 'cupo_primero',
    })
    afirmar(r === 'P5574', `El alta tras reducir el cupo terminó en ${r}, se esperaba P5574`)
    const cupo = await consultar(sesionA, `(SELECT cupo FROM public.grupos_deportivos WHERE id = '${g6}')`, 'g6_cupo')
    const activas = await contarActivas(sesionA, g6, 'g6_activas')
    afirmar(cupo === '1' && activas === 1, `Quedó cupo ${cupo} con ${activas} inscripción(es)`)
    console.log('OK CONCURRENCIA 3a: reducir el cupo y dar un alta a la vez (cupo primero) — el alta ve el cupo nuevo y recibe P5574; ocupación 1 de 1')
  }

  // ------------------------------------------------------------------
  // 3b. Inscripción primero, reducción de cupo después.
  //     A (alumno S3) se inscribe en un grupo de cupo 2 con 1 activa (S2) y
  //     aún no confirma; B intenta reducir el cupo a 1: espera, cuenta las 2
  //     inscripciones y recibe P5581. Ocupación 2 de 2.
  // ------------------------------------------------------------------
  const d7 = await crearDeporte(sesionA, 'd7')
  const g7 = await crearGrupo(sesionA, 'g7', d7, 2, { franja: true })
  await sesionA.ejecutar(`${como(ID.s2)} SELECT public.inscribir_en_grupo_deportivo('${g7}');`, 'g7_s2')
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.s3),
      sentenciaA: `SELECT public.inscribir_en_grupo_deportivo('${g7}')`,
      identidadB: como(ID.director),
      sentenciaB: editarGrupo(g7, `${PREFIJO} g7`, 1),
      etiqueta: 'alta_primero',
    })
    afirmar(r === 'P5581', `La reducción tras el alta terminó en ${r}, se esperaba P5581`)
    const cupo = await consultar(sesionA, `(SELECT cupo FROM public.grupos_deportivos WHERE id = '${g7}')`, 'g7_cupo')
    const activas = await contarActivas(sesionA, g7, 'g7_activas')
    afirmar(cupo === '2' && activas === 2, `Quedó cupo ${cupo} con ${activas} inscripción(es)`)
    console.log('OK CONCURRENCIA 3b: alta primero y reducción de cupo después — la reducción ve la ocupación real y recibe P5581; ocupación 2 de 2')
  }

  // ------------------------------------------------------------------
  // 4a. Dos inactivaciones simultáneas del mismo grupo (sin inscripciones).
  //     La segunda espera, relee el grupo ya inactivo y es idempotente (OK).
  // ------------------------------------------------------------------
  const d8 = await crearDeporte(sesionA, 'd8')
  const g8 = await crearGrupo(sesionA, 'g8', d8, 5)
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.cambiar_estado_grupo_deportivo('${g8}', false)`,
      identidadB: como(ID.director),
      sentenciaB: estadoGrupo(g8, false),
      etiqueta: 'doble_inactivacion',
    })
    afirmar(r === 'OK', `La segunda inactivación terminó en ${r}, se esperaba OK (idempotente)`)
    const activo = await estadoActivo(sesionA, 'grupos_deportivos', g8, 'g8_activo')
    afirmar(activo === 'false', `El grupo quedó activo=${activo} tras dos inactivaciones`)
    console.log('OK CONCURRENCIA 4a: dos inactivaciones simultáneas del mismo grupo — la segunda es idempotente y el grupo queda inactivo')
  }

  // ------------------------------------------------------------------
  // 4b. Reactivar e inactivar a la vez (resultado de una ejecución en serie).
  //     A reactiva; B inactiva. B espera a A y aplica su decisión sobre lo que
  //     dejó A: el grupo termina inactivo y ninguna operación falla.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.cambiar_estado_grupo_deportivo('${g8}', true)`,
      identidadB: como(ID.director),
      sentenciaB: estadoGrupo(g8, false),
      etiqueta: 'reactivar_e_inactivar',
    })
    afirmar(r === 'OK', `La inactivación tras la reactivación terminó en ${r}, se esperaba OK`)
    const activo = await estadoActivo(sesionA, 'grupos_deportivos', g8, 'g8_activo_final')
    afirmar(activo === 'false', `El grupo quedó activo=${activo}; A reactivó y B inactivó en serie, debía quedar inactivo`)
    console.log('OK CONCURRENCIA 4b: reactivar e inactivar el mismo grupo a la vez equivale a una ejecución en serie (queda inactivo, sin errores)')
  }

  // ------------------------------------------------------------------
  // 5. Alta de un grupo primero, renombrado del deporte después.
  //     Con el grupo aún sin confirmar, el trigger de identidad no lo vería:
  //     el renombrado espera el bloqueo del deporte, ve el grupo confirmado y
  //     recibe P5580 (identidad protegida de 014).
  // ------------------------------------------------------------------
  const d9 = await crearDeporte(sesionA, 'd9')
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.crear_grupo_deportivo('${d9}',
                     (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
                     '${PREFIJO} g9', 5, '${ID.docente}')`,
      identidadB: como(ID.director),
      sentenciaB: `PERFORM public.renombrar_deporte('${d9}', '${PREFIJO} d9 renombrado')`,
      etiqueta: 'crear_grupo_y_renombrar',
    })
    afirmar(r === 'P5580', `El renombrado tras el alta del grupo terminó en ${r}, se esperaba P5580`)
    const nombre = await consultar(sesionA, `(SELECT nombre FROM public.deportes WHERE id = '${d9}')`, 'd9_nombre')
    afirmar(nombre === `${PREFIJO} d9`, `El deporte con grupo cambió de nombre: ${nombre}`)
    console.log('OK CONCURRENCIA 5: alta de un grupo y renombrado del deporte a la vez — el renombrado ve el grupo y recibe P5580; el nombre no cambia')
  }

  // ------------------------------------------------------------------
  // 6. Dos altas del mismo nombre de deporte a la vez.
  //     B espera al índice único, y al confirmar A recibe P5971. Una sola fila.
  // ------------------------------------------------------------------
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.crear_deporte('${PREFIJO} duplicado')`,
      identidadB: como(ID.director),
      sentenciaB: `PERFORM public.crear_deporte('${PREFIJO.toUpperCase()} DUPLICADO')`,
      etiqueta: 'doble_alta_deporte',
    })
    afirmar(r === 'P5971', `La segunda alta del mismo nombre terminó en ${r}, se esperaba P5971`)
    const filas = await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.deportes WHERE pg_catalog.upper(nombre) = pg_catalog.upper('${PREFIJO} duplicado'))`,
      'duplicado_filas'
    )
    afirmar(filas === '1', `Quedaron ${filas} filas del mismo deporte`)
    console.log('OK CONCURRENCIA 6: dos altas simultáneas del mismo nombre de deporte dejan una sola fila; la segunda recibe P5971')
  }

  // ------------------------------------------------------------------
  // 7a. Reactivar un grupo mientras otra transacción carga una franja real.
  //     A agrega la franja (bloqueo consultivo de EPT-57, luego el grupo); B
  //     reactiva el mismo grupo: espera detrás del bloqueo consultivo, que la
  //     reactivación toma PRIMERO. Sin ciclo: los dos terminan bien.
  // ------------------------------------------------------------------
  const d10 = await crearDeporte(sesionA, 'd10')
  const g10 = await crearGrupo(sesionA, 'g10', d10, 5)
  await sesionA.ejecutar(`${como(ID.director)} SELECT public.cambiar_estado_grupo_deportivo('${g10}', false);`, 'g10_inactivo')
  {
    const r = await carrera(sesiones, pids, {
      identidadA: como(ID.director),
      sentenciaA: `SELECT public.agregar_horario_grupo_deportivo('${g10}', ${diaSiguiente++}::SMALLINT,
                     '${FRANJA.inicio}', '${FRANJA.fin}')`,
      identidadB: como(ID.director),
      sentenciaB: estadoGrupo(g10, true),
      etiqueta: 'franja_y_reactivar',
    })
    afirmar(r === 'OK', `La reactivación concurrente con la carga de una franja terminó en ${r}, se esperaba OK`)
    const activo = await estadoActivo(sesionA, 'grupos_deportivos', g10, 'g10_activo')
    const franjas = await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.grupos_deportivos_horarios WHERE grupo_id = '${g10}' AND activo)`,
      'g10_franjas'
    )
    afirmar(activo === 'true' && franjas === '1', `Quedó el grupo activo=${activo} con ${franjas} franja(s)`)
    console.log('OK CONCURRENCIA 7a: reactivar un grupo mientras se le carga una franja termina bien en los dos lados (sin 40P01)')
  }

  // ------------------------------------------------------------------
  // 7b. La ventana que un orden inverso abriría.
  //     A reproduce el comienzo de la carga de una franja de EPT-57: toma el
  //     bloqueo consultivo `ept57_configuracion_horaria`. B reactiva el grupo:
  //     como la reactivación toma ese bloqueo ANTES que la fila del grupo,
  //     espera sin haber tomado el grupo. Entonces A toma el grupo (segundo
  //     paso de la carga de una franja): si B ya lo tuviera, A y B se
  //     esperarían mutuamente (40P01) y `psql` abortaría con código distinto de
  //     cero. Aquí A avanza, confirma y B termina bien.
  // ------------------------------------------------------------------
  const d11 = await crearDeporte(sesionA, 'd11')
  const g11 = await crearGrupo(sesionA, 'g11', d11, 5)
  await sesionA.ejecutar(`${como(ID.director)} SELECT public.cambiar_estado_grupo_deportivo('${g11}', false);`, 'g11_inactivo')
  {
    await sesionA.ejecutar(
      `RESET ROLE;
       BEGIN;
       SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ept57_configuracion_horaria'));`,
      'ventana_a_toma_bloqueo_consultivo'
    )
    const pendiente = sesionB.ejecutar(
      `${como(ID.director)} ${tolerante(estadoGrupo(g11, true))}`,
      'ventana_b_reactiva'
    )
    await esperarBloqueo(sesionA, pids.a, pids.b)
    // Segundo paso de la carga de una franja: bloquear el grupo. Con el orden
    // correcto B aún no lo tiene, y esta sentencia no espera.
    await sesionA.ejecutar(
      `SELECT 1 FROM public.grupos_deportivos WHERE id = '${g11}' FOR NO KEY UPDATE;
       COMMIT;`,
      'ventana_a_toma_grupo_y_confirma'
    )
    await pendiente
    const r = await resultado(sesionB, 'ventana_resultado')
    afirmar(r === 'OK', `La reactivación en la ventana de orden terminó en ${r}, se esperaba OK`)
    const activo = await estadoActivo(sesionA, 'grupos_deportivos', g11, 'g11_activo')
    afirmar(activo === 'true', `El grupo quedó activo=${activo} tras la reactivación`)
    console.log('OK CONCURRENCIA 7b: con el bloqueo consultivo tomado primero, la reactivación no cierra un ciclo con la carga de franjas')
  }

  await limpiar()
  const restos = await consultar(
    sesionA,
    `(SELECT (SELECT pg_catalog.count(*) FROM public.deportes WHERE nombre LIKE '${PREFIJO}%')
          + (SELECT pg_catalog.count(*) FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}')
          + (SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)})))`,
    'restos'
  )
  afirmar(restos === '0', `La limpieza dejó ${restos} fila(s) de prueba`)
  console.log('OK CONCURRENCIA: las carreras de administración de deportes quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
