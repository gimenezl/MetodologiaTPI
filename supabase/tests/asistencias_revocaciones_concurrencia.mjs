import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la revocación de vínculos y el registro de asistencias
 * (EPT-66, unidad D).
 *
 * Usa conexiones PostgreSQL independientes: cada `SesionPsql` es un `psql`
 * propio, así que las transacciones compiten de verdad por los bloqueos de
 * fila. La coordinación es determinista (`pg_blocking_pids`): la sesión que
 * debe esperar se lanza y se comprueba que quedó bloqueada por la otra ANTES
 * de que ésta confirme. Nunca se espera por tiempo.
 *
 * Contrato que se demuestra (el vínculo vigente decide, el registro se atribuye
 * al actor real y los dos órdenes son coherentes):
 *
 *   1. Revocación primero → el registro posterior espera, relee el estado
 *      confirmado y se deniega (P6610); no queda ninguna asistencia.
 *   2. Registro primero → la revocación espera a que el registro confirme; la
 *      asistencia queda atribuida al docente real y todo registro posterior se
 *      deniega (P6610).
 *   3. Con un vínculo alternativo vigente, la revocación del otro no impide el
 *      registro: espera y luego procede.
 *   4. Revocado ya uno, la revocación concurrente del último vínculo deniega el
 *      registro que esperaba.
 *   5. La escritura directa por la API de tablas (política RLS) sigue la misma
 *      regla en ambos órdenes (42501 tras la revocación).
 *   6. Dos docentes con vínculo que registran al mismo alumno y día a la vez: se
 *      ordenan; queda una sola fila, atribuida al primero, con el estado del
 *      segundo (corrección coherente).
 *   7. Cambio de profesor de la asignación y registro del docente saliente.
 *   8. Cambio de curso (cierra la matrícula) y registro, en ambos órdenes.
 *
 * Corre contra la base descartable (stack local por `docker exec`, o
 * `EPT_PSQL_CONEXION`). Crea datos sintéticos propios, usa las RPC reales de la
 * Dirección para la estructura y los retira al final como propietario; ese
 * borrado no representa ninguna operación disponible en la aplicación.
 */

const ID = {
  director: 'a66d9000-0000-4000-8000-000000000001',
  docA: 'a66d9000-0000-4000-8000-000000000002',
  docB: 'a66d9000-0000-4000-8000-000000000003',
}
const alumno = (n) => `a66d9000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const curso = (n) => `a66d9000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`
const NUM_ALUMNOS = 10
const NUM_CURSOS = 9
const ALUMNOS = Array.from({ length: NUM_ALUMNOS }, (_, i) => alumno(i + 1))
const CURSOS = Array.from({ length: NUM_CURSOS }, (_, i) => curso(i + 1))
const PERFILES = [ID.director, ID.docA, ID.docB, ...ALUMNOS]
const PREFIJO_MATERIA = 'Concurrencia EPT66D'
const FUTBOL = 'e0000000-0000-4000-8000-000000000101'

const lista = (ids) => ids.map((id) => `'${id}'`).join(', ')

/** Cambia de identidad en la sesión: siempre desde propietario y con un JWT del actor. */
function como(sub) {
  return `RESET ROLE; SET ROLE authenticated;
          SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`
}

/** Ejecuta una sentencia y deja su desenlace en una variable de sesión: el valor o el SQLSTATE. */
function tolerante(sentencia) {
  return `DO $prueba$
          DECLARE v TEXT;
          BEGIN
            BEGIN
              ${sentencia}
              PERFORM pg_catalog.set_config('ept66d.resultado', COALESCE(v, 'OK'), false);
            EXCEPTION WHEN OTHERS THEN
              PERFORM pg_catalog.set_config('ept66d.resultado', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

const registrar = (al, fecha, estado = 'PRESENTE') =>
  tolerante(`SELECT r.resultado INTO v FROM public.registrar_asistencia('${al}', '${fecha}', '${estado}') r;`)

const insertarDirecto = (al, fecha, docente) =>
  tolerante(`INSERT INTO public.asistencias (estudiante_id, fecha, estado, docente_id)
             VALUES ('${al}', '${fecha}', 'PRESENTE', '${docente}');`)

const operacionDirector = (llamada) => tolerante(`PERFORM ${llamada};`)

function resultadoDe(sesion, etiqueta) {
  return sesion.escalar(`pg_catalog.current_setting('ept66d.resultado', true)`, etiqueta)
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

const A = new SesionPsql('A', 'EPT66D')
const B = new SesionPsql('B', 'EPT66D')
const OBS = new SesionPsql('OBS', 'EPT66D')

/** Filas de asistencias de un alumno y fecha, contadas como propietario (RLS no oculta nada). */
async function filas(al, fecha, etiqueta) {
  return Number(
    await OBS.escalar(
      `(SELECT pg_catalog.count(*) FROM public.asistencias WHERE estudiante_id = '${al}' AND fecha = '${fecha}')`,
      etiqueta
    )
  )
}

async function registrante(al, fecha, etiqueta) {
  return OBS.escalar(
    `(SELECT COALESCE(docente_id::TEXT, '-') FROM public.asistencias WHERE estudiante_id = '${al}' AND fecha = '${fecha}')`,
    etiqueta
  )
}

const ids = {}

/** Pasa por la RPC real de la Dirección y devuelve el identificador creado. */
async function comoDirector(sql, etiqueta) {
  await OBS.ejecutar(como(ID.director), `dir_${etiqueta}`)
  const valor = await OBS.escalar(sql, etiqueta)
  await OBS.ejecutar('RESET ROLE;', `fin_dir_${etiqueta}`)
  return valor
}

async function limpiar() {
  await OBS.ejecutar(
    `RESET ROLE;
     BEGIN;
     DELETE FROM public.asistencias WHERE estudiante_id IN (${lista(ALUMNOS)});
     DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.grupos_deportivos_horarios
       WHERE grupo_id IN (SELECT id FROM public.grupos_deportivos WHERE profesor_id IN ('${ID.docA}', '${ID.docB}'));
     DELETE FROM public.grupos_deportivos WHERE profesor_id IN ('${ID.docA}', '${ID.docB}');
     DELETE FROM public.horarios h
       WHERE h.hora_inicio = '18:09' AND h.hora_fin = '19:09'
         AND NOT EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios f WHERE f.horario_id = h.id);
     DELETE FROM public.materias_cursos WHERE curso_id IN (${lista(CURSOS)});
     DELETE FROM public.actividades WHERE tipo = 'CURRICULAR' AND nombre LIKE '${PREFIJO_MATERIA}%';
     DELETE FROM public.matriculas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.alumnos WHERE perfil_id IN (${lista(ALUMNOS)});
     DELETE FROM public.profesores WHERE perfil_id IN (${lista(PERFILES)});
     DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
     DELETE FROM public.cursos WHERE id IN (${lista(CURSOS)});
     COMMIT;`,
    'limpiar'
  )
}

/**
 * La sesión `esperante` queda bloqueada por `bloqueadora`; se confirma ésta y se
 * devuelve el desenlace de la primera.
 */
async function esperaYConfirma(pids, pendiente, etiqueta) {
  await esperarBloqueo(OBS, pids.bloqueadora, pids.esperante)
  await pids.sesionBloqueadora.ejecutar('COMMIT;', `${etiqueta}_confirmar`)
  await pendiente
  return resultadoDe(pids.sesionEsperante, `${etiqueta}_resultado`)
}

try {
  const pidDe = async (sesion, etiqueta) => Number(await sesion.escalar('pg_catalog.pg_backend_pid()', etiqueta))
  const pid = { A: await pidDe(A, 'pid_a'), B: await pidDe(B, 'pid_b') }
  const par = (bloqueadora, esperante) => ({
    bloqueadora: pid[bloqueadora.nombre],
    esperante: pid[esperante.nombre],
    sesionBloqueadora: bloqueadora,
    sesionEsperante: esperante,
  })

  // ------------------------------------------------------------------
  // Fixture sintético (DNI ficticios 9669xxxx y 96691xxx) en UNA transacción: la invariante
  // diferida de 008 exige matrícula y estado ACTIVO juntos.
  // ------------------------------------------------------------------
  await limpiar()
  await OBS.ejecutar(
    `BEGIN;
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
     SELECT c::UUID, (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'CONCURRENCIA EPT66D', 'K' || n, TRUE
     FROM unnest(ARRAY[${lista(CURSOS)}]::UUID[]) WITH ORDINALITY AS t(c, n);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::UUID, v.id::UUID, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${ID.director}', 'DIRECTOR', 'Directora D', '96690001', NULL),
       ('${ID.docA}',     'DOCENTE',  'Docente A D', '96690002', NULL),
       ('${ID.docB}',     'DOCENTE',  'Docente B D', '96690003', NULL)
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT a::UUID, a::UUID, (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Prueba',
            'Alumno D' || n, '96691' || pg_catalog.lpad(n::TEXT, 3, '0'), 'LEG-66D-C' || n
     FROM unnest(ARRAY[${lista(ALUMNOS)}]::UUID[]) WITH ORDINALITY AS t(a, n);
     COMMIT;`,
    'fixture_perfiles'
  )

  // Cursos: s1→k1, s2→k2, s3→k3, s4→k4, s5 y s6→k5, s7→k6, s8→k7, s9 y s10→k8; k9 es destino de cambios.
  const matricula = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 5, 7: 6, 8: 7, 9: 8, 10: 8 }
  await OBS.ejecutar(
    `BEGIN;
     INSERT INTO public.matriculas (alumno_id, curso_id) VALUES
       ${Object.entries(matricula).map(([a, c]) => `('${alumno(a)}', '${curso(c)}')`).join(',\n       ')};
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${lista(ALUMNOS)});
     COMMIT;`,
    'fixture_matriculas'
  )

  // Materias y asignaciones por las RPC reales de la Dirección.
  const asignaciones = {} // clave → id de asignación
  const asignar = async (clave, cursoN, docente) => {
    const materia = await comoDirector(
      `(SELECT (public.crear_materia('${PREFIJO_MATERIA} ${clave}')).id)`,
      `materia_${clave}`
    )
    asignaciones[clave] = await comoDirector(
      `(SELECT (public.asignar_materia_curso(${materia}, '${curso(cursoN)}', '${docente}')).id)`,
      `asig_${clave}`
    )
  }
  await asignar('m1', 1, ID.docA)
  await asignar('m2', 2, ID.docA)
  await asignar('m3', 3, ID.docA)
  await asignar('m4', 4, ID.docA)
  await asignar('m5', 5, ID.docA)
  await asignar('m6a', 6, ID.docA)
  await asignar('m6b', 6, ID.docB)
  await asignar('m7', 7, ID.docA)
  await asignar('m8', 8, ID.docA)

  // Grupo deportivo G1 (Fútbol) de A para los vínculos alternativos de s3 y s4.
  await OBS.ejecutar(como(ID.director), 'como_director_grupo')
  const grupo = await OBS.escalar(
    `(SELECT (public.crear_grupo_deportivo('${FUTBOL}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        '${PREFIJO_MATERIA} G1', 10, '${ID.docA}')).id)`,
    'grupo'
  )
  await OBS.escalar(
    `(SELECT (public.agregar_horario_grupo_deportivo('${grupo}', 1::SMALLINT, '18:09', '19:09')).id)`,
    'horario_grupo'
  )
  await OBS.ejecutar('RESET ROLE;', 'fin_director_grupo')
  const inscripciones = {}
  for (const n of [3, 4]) {
    await OBS.ejecutar(como(alumno(n)), `como_alumno_${n}`)
    inscripciones[n] = await OBS.escalar(`(SELECT (public.inscribir_en_grupo_deportivo('${grupo}')).id)`, `insc_${n}`)
    await OBS.ejecutar('RESET ROLE;', `fin_alumno_${n}`)
  }

  const revocarAsignacion = (clave) => `public.cambiar_estado_asignacion('${asignaciones[clave]}', FALSE)`
  const FECHA = '2031-10-10'

  // ------------------------------------------------------------------
  // 1. Revocación primero → el registro posterior se deniega.
  // ------------------------------------------------------------------
  {
    await A.ejecutar(`${como(ID.director)} BEGIN; SELECT ${revocarAsignacion('m1')};`, 'c1_revocacion_pendiente')
    const pendiente = B.ejecutar(`${como(ID.docA)} ${registrar(alumno(1), FECHA)}`, 'c1_registro_pendiente')
    const r = await esperaYConfirma(par(A, B), pendiente, 'c1')
    afirmar(r === 'P6610', `CONCURRENCIA 1: el registro tras la revocación terminó en ${r}, se esperaba P6610`)
    afirmar((await filas(alumno(1), FECHA, 'c1_filas')) === 0, 'CONCURRENCIA 1: quedó una asistencia de un vínculo ya revocado')
    console.log('OK CONCURRENCIA 1: revocación primero — el registro esperó el bloqueo, releyó el estado confirmado y se denegó (P6610); no quedó ninguna asistencia')
  }

  // ------------------------------------------------------------------
  // 2. Registro primero → la revocación espera; la asistencia queda atribuida al docente real.
  // ------------------------------------------------------------------
  {
    await A.ejecutar(`${como(ID.docA)} BEGIN; ${registrar(alumno(2), FECHA)}`, 'c2_registro_pendiente')
    afirmar((await resultadoDe(A, 'c2_resultado_registro')) === 'CREADA', 'CONCURRENCIA 2: el registro no se creó')
    const pendiente = B.ejecutar(`${como(ID.director)} ${operacionDirector(revocarAsignacion('m2'))}`, 'c2_revocacion_pendiente')
    await esperarBloqueo(OBS, pid.A, pid.B)
    await A.ejecutar('COMMIT;', 'c2_confirmar_registro')
    await pendiente
    afirmar((await resultadoDe(B, 'c2_resultado_revocacion')) === 'OK', 'CONCURRENCIA 2: la revocación no se aplicó tras confirmar el registro')
    afirmar((await filas(alumno(2), FECHA, 'c2_filas')) === 1, 'CONCURRENCIA 2: la asistencia confirmada no quedó')
    afirmar((await registrante(alumno(2), FECHA, 'c2_registrante')) === ID.docA, 'CONCURRENCIA 2: la asistencia no quedó atribuida al docente real')
    await A.ejecutar(`${como(ID.docA)} ${registrar(alumno(2), '2031-10-11')}`, 'c2_registro_posterior')
    const posterior = await resultadoDe(A, 'c2_resultado_posterior')
    afirmar(posterior === 'P6610', `CONCURRENCIA 2: el registro posterior a la revocación terminó en ${posterior}, se esperaba P6610`)
    console.log('OK CONCURRENCIA 2: registro primero — la revocación esperó al registro, la asistencia quedó atribuida al docente real y el registro posterior se denegó (P6610)')
  }

  // ------------------------------------------------------------------
  // 3. Vínculo alternativo: s3 (académico en k3 y deportivo en G1) pierde el académico.
  // ------------------------------------------------------------------
  {
    await A.ejecutar(`${como(ID.director)} BEGIN; SELECT ${revocarAsignacion('m3')};`, 'c3_revocacion_pendiente')
    const pendiente = B.ejecutar(`${como(ID.docA)} ${registrar(alumno(3), FECHA)}`, 'c3_registro_pendiente')
    const r = await esperaYConfirma(par(A, B), pendiente, 'c3')
    afirmar(r === 'CREADA', `CONCURRENCIA 3: con el vínculo deportivo vigente el registro terminó en ${r}, se esperaba CREADA`)
    afirmar((await registrante(alumno(3), FECHA, 'c3_registrante')) === ID.docA, 'CONCURRENCIA 3: registrante equivocado')
    console.log('OK CONCURRENCIA 3: con un vínculo alternativo vigente, la revocación del otro no impide el registro (esperó y procedió, atribuido al docente real)')
  }

  // ------------------------------------------------------------------
  // 4. Ya revocado el académico de s4, se revoca el último vínculo (deportivo) en vuelo.
  // ------------------------------------------------------------------
  {
    await OBS.ejecutar(`${como(ID.director)} SELECT ${revocarAsignacion('m4')};`, 'c4_revocar_academico')
    await OBS.ejecutar('RESET ROLE;', 'c4_fin_director')
    await A.ejecutar(
      `${como(alumno(4))} BEGIN; SELECT public.cancelar_inscripcion_deportiva('${inscripciones[4]}');`,
      'c4_cancelacion_pendiente'
    )
    const pendiente = B.ejecutar(`${como(ID.docA)} ${registrar(alumno(4), FECHA)}`, 'c4_registro_pendiente')
    const r = await esperaYConfirma(par(A, B), pendiente, 'c4')
    afirmar(r === 'P6610', `CONCURRENCIA 4: con ambos vínculos revocados el registro terminó en ${r}, se esperaba P6610`)
    afirmar((await filas(alumno(4), FECHA, 'c4_filas')) === 0, 'CONCURRENCIA 4: quedó una asistencia sin vínculos')
    console.log('OK CONCURRENCIA 4: revocado ya el académico, la cancelación deportiva en vuelo deniega el registro que esperaba (ambos vínculos revocados)')
  }

  // ------------------------------------------------------------------
  // 5. Escritura directa por la API de tablas (política RLS), en ambos órdenes (s5 y s6, k5).
  // ------------------------------------------------------------------
  {
    // 5a. Revocación primero.
    await A.ejecutar(`${como(ID.director)} BEGIN; SELECT ${revocarAsignacion('m5')};`, 'c5a_revocacion_pendiente')
    const pendiente = B.ejecutar(`${como(ID.docA)} ${insertarDirecto(alumno(5), FECHA, ID.docA)}`, 'c5a_insercion_pendiente')
    const r = await esperaYConfirma(par(A, B), pendiente, 'c5a')
    afirmar(r === '42501', `CONCURRENCIA 5a: el alta directa tras la revocación terminó en ${r}, se esperaba 42501`)
    afirmar((await filas(alumno(5), FECHA, 'c5a_filas')) === 0, 'CONCURRENCIA 5a: la política dejó pasar un alta sin vínculo')

    // Se restablece la asignación como propietario para probar el orden inverso.
    await OBS.ejecutar(
      `RESET ROLE; UPDATE public.materias_cursos SET activo = TRUE WHERE id = '${asignaciones.m5}';`,
      'c5_restablecer'
    )

    // 5b. Alta directa primero.
    await A.ejecutar(`${como(ID.docA)} BEGIN; ${insertarDirecto(alumno(6), FECHA, ID.docA)}`, 'c5b_insercion_pendiente')
    afirmar((await resultadoDe(A, 'c5b_resultado_insercion')) === 'OK', 'CONCURRENCIA 5b: el alta directa válida fue rechazada')
    const pendienteB = B.ejecutar(`${como(ID.director)} ${operacionDirector(revocarAsignacion('m5'))}`, 'c5b_revocacion_pendiente')
    await esperarBloqueo(OBS, pid.A, pid.B)
    await A.ejecutar('COMMIT;', 'c5b_confirmar')
    await pendienteB
    afirmar((await resultadoDe(B, 'c5b_resultado_revocacion')) === 'OK', 'CONCURRENCIA 5b: la revocación no se aplicó')
    afirmar((await registrante(alumno(6), FECHA, 'c5b_registrante')) === ID.docA, 'CONCURRENCIA 5b: la asistencia no quedó atribuida al docente real')
    await A.ejecutar(`${como(ID.docA)} ${insertarDirecto(alumno(6), '2031-10-11', ID.docA)}`, 'c5b_insercion_posterior')
    const posterior = await resultadoDe(A, 'c5b_resultado_posterior')
    afirmar(posterior === '42501', `CONCURRENCIA 5b: el alta directa posterior terminó en ${posterior}, se esperaba 42501`)
    console.log('OK CONCURRENCIA 5: la escritura directa sigue la misma regla que la función en ambos órdenes (42501 tras la revocación; atribución real si entró antes)')
  }

  // ------------------------------------------------------------------
  // 6. Dos docentes con vínculo registran a s7 el mismo día a la vez.
  // ------------------------------------------------------------------
  {
    await A.ejecutar(`${como(ID.docA)} BEGIN; ${registrar(alumno(7), FECHA, 'PRESENTE')}`, 'c6_registro_a')
    afirmar((await resultadoDe(A, 'c6_resultado_a')) === 'CREADA', 'CONCURRENCIA 6: A no creó la asistencia')
    const pendiente = B.ejecutar(`${como(ID.docB)} ${registrar(alumno(7), FECHA, 'AUSENTE')}`, 'c6_registro_b')
    const r = await esperaYConfirma(par(A, B), pendiente, 'c6')
    afirmar(r === 'ACTUALIZADA', `CONCURRENCIA 6: el segundo registro terminó en ${r}, se esperaba ACTUALIZADA`)
    afirmar((await filas(alumno(7), FECHA, 'c6_filas')) === 1, 'CONCURRENCIA 6: quedó más de una fila para el mismo alumno y día')
    afirmar((await registrante(alumno(7), FECHA, 'c6_registrante')) === ID.docA, 'CONCURRENCIA 6: el segundo docente suplantó al registrante original')
    const estado = await OBS.escalar(
      `(SELECT estado FROM public.asistencias WHERE estudiante_id = '${alumno(7)}' AND fecha = '${FECHA}')`, 'c6_estado')
    afirmar(estado === 'AUSENTE', `CONCURRENCIA 6: el estado final es ${estado}, se esperaba AUSENTE`)
    console.log('OK CONCURRENCIA 6: dos docentes con vínculo sobre el mismo alumno y día se ordenan — una fila, registrante original conservado, estado del segundo')
  }

  // ------------------------------------------------------------------
  // 7. Cambio de profesor de la asignación (A → B) y registro del docente saliente.
  // ------------------------------------------------------------------
  {
    await A.ejecutar(
      `${como(ID.director)} BEGIN; SELECT public.cambiar_profesor_asignacion('${asignaciones.m7}', '${ID.docB}');`,
      'c7_cambio_pendiente'
    )
    const pendiente = B.ejecutar(`${como(ID.docA)} ${registrar(alumno(8), FECHA)}`, 'c7_registro_saliente')
    const r = await esperaYConfirma(par(A, B), pendiente, 'c7')
    afirmar(r === 'P6610', `CONCURRENCIA 7: el docente saliente terminó en ${r}, se esperaba P6610`)
    await B.ejecutar(`${como(ID.docB)} ${registrar(alumno(8), FECHA)}`, 'c7_registro_entrante')
    const entrante = await resultadoDe(B, 'c7_resultado_entrante')
    afirmar(entrante === 'CREADA', `CONCURRENCIA 7: el docente entrante terminó en ${entrante}, se esperaba CREADA`)
    afirmar((await registrante(alumno(8), FECHA, 'c7_registrante')) === ID.docB, 'CONCURRENCIA 7: registrante equivocado')
    console.log('OK CONCURRENCIA 7: cambio de profesor y registro simultáneos — el saliente se deniega (P6610) y el entrante registra a su nombre')
  }

  // ------------------------------------------------------------------
  // 8. Cambio de curso (cierra la matrícula) y registro, en ambos órdenes (s9 y s10, k8).
  // ------------------------------------------------------------------
  {
    // 8a. Cambio de curso primero.
    await A.ejecutar(
      `${como(ID.director)} BEGIN; SELECT public.cambiar_curso_alumno('${alumno(9)}', '${curso(9)}');`,
      'c8a_cambio_pendiente'
    )
    const pendiente = B.ejecutar(`${como(ID.docA)} ${registrar(alumno(9), FECHA)}`, 'c8a_registro_pendiente')
    const r = await esperaYConfirma(par(A, B), pendiente, 'c8a')
    afirmar(r === 'P6610', `CONCURRENCIA 8a: el registro tras el cambio de curso terminó en ${r}, se esperaba P6610`)

    // 8b. Registro primero.
    await A.ejecutar(`${como(ID.docA)} BEGIN; ${registrar(alumno(10), FECHA)}`, 'c8b_registro_pendiente')
    afirmar((await resultadoDe(A, 'c8b_resultado_registro')) === 'CREADA', 'CONCURRENCIA 8b: el registro no se creó')
    const pendienteB = B.ejecutar(`${como(ID.director)} ${operacionDirector(`public.cambiar_curso_alumno('${alumno(10)}', '${curso(9)}')`)}`, 'c8b_cambio_pendiente')
    await esperarBloqueo(OBS, pid.A, pid.B)
    await A.ejecutar('COMMIT;', 'c8b_confirmar')
    await pendienteB
    afirmar((await resultadoDe(B, 'c8b_resultado_cambio')) === 'OK', 'CONCURRENCIA 8b: el cambio de curso no se aplicó')
    afirmar((await registrante(alumno(10), FECHA, 'c8b_registrante')) === ID.docA, 'CONCURRENCIA 8b: registrante equivocado')
    await A.ejecutar(`${como(ID.docA)} ${registrar(alumno(10), '2031-10-11')}`, 'c8b_registro_posterior')
    const posterior = await resultadoDe(A, 'c8b_resultado_posterior')
    afirmar(posterior === 'P6610', `CONCURRENCIA 8b: el registro posterior terminó en ${posterior}, se esperaba P6610`)
    console.log('OK CONCURRENCIA 8: cambio de curso y registro simultáneos, en ambos órdenes — la matrícula cerrada deniega el registro posterior (P6610) y el anterior queda atribuido')
  }

  // ------------------------------------------------------------------
  // Limpieza y comprobación de que no queda ningún trigger apagado ni bloqueo colgado.
  // ------------------------------------------------------------------
  await Promise.allSettled([A.ejecutar('ROLLBACK;', 'rollback_a'), B.ejecutar('ROLLBACK;', 'rollback_b')])
  await limpiar()
  const restos = await OBS.escalar(
    `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)}))`,
    'restos'
  )
  afirmar(restos === '0', `Quedaron ${restos} perfiles sintéticos`)
  const apagados = await OBS.escalar(
    `(SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.asistencias'::pg_catalog.regclass AND NOT tgisinternal AND tgenabled <> 'O')`,
    'triggers_apagados'
  )
  afirmar(apagados === '0', `Quedaron ${apagados} trigger(s) de asistencias deshabilitados`)
  console.log('OK: concurrencia de revocaciones y registro de asistencias (EPT-66 D) sin hallazgos; la base quedó limpia')
} catch (error) {
  console.error(`FALLO: ${error.message}`)
  process.exitCode = 1
  await Promise.allSettled([A.ejecutar('ROLLBACK;', 'rollback_a'), B.ejecutar('ROLLBACK;', 'rollback_b')])
  await limpiar().catch(() => {})
} finally {
  await Promise.allSettled([A.cerrar(), B.cerrar(), OBS.cerrar()])
}
