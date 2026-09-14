import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real del legajo académico (EPT-9 / EPT-24, casos 17 a 20).
 *
 * Usa dos conexiones PostgreSQL simultáneas y coordina el orden con
 * `pg_blocking_pids`, no con esperas por tiempo: cada escenario comprueba que
 * la segunda transacción quedó efectivamente bloqueada por la primera antes de
 * confirmar, de modo que la carrera se produce siempre en el mismo orden.
 *
 * Ejecutar contra el stack local descartable después de `supabase db reset`.
 * Todos los datos son sintéticos; los DNI del rango 93.0xx.xxx no corresponden a
 * ninguna persona real.
 */

const DIRECTORA = '81111111-1111-4111-8111-111111111111'
const CLAIMS_DIRECTORA = `SELECT set_config('request.jwt.claims', '{"sub":"${DIRECTORA}"}', false);`

const MARCA = 'Concurrencia EPT-9'

async function prepararFixture(sesion) {
  await sesion.ejecutar(
    `BEGIN;
     DELETE FROM public.matriculas
       WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '930%');
     DELETE FROM public.alumnos
       WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '930%');
     DELETE FROM public.perfiles WHERE dni LIKE '930%';
     DELETE FROM public.cursos WHERE denominacion LIKE '${MARCA}%';
     COMMIT;

     INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni)
     VALUES ('${DIRECTORA}',
             (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),
             'Concurrencia', 'Directora', '93000900');

     INSERT INTO public.perfiles (rol_id, nombre, apellido, dni, legajo_nro)
     VALUES ((SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
             'Concurrencia', 'Alumna', '93000100', 'LEG-CONC-0001');

     INSERT INTO public.cursos (nivel_id, denominacion, division, activo)
     VALUES ((SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
             '${MARCA} A', 'A', TRUE),
            ((SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
             '${MARCA} B', 'B', TRUE);`,
    'preparar_fixture'
  )

  const alumno = await sesion.escalar(
    `(SELECT id FROM public.perfiles WHERE dni = '93000100')`,
    'alumno_id'
  )
  const cursoA = await sesion.escalar(
    `(SELECT id FROM public.cursos WHERE denominacion = '${MARCA} A')`,
    'curso_a'
  )
  const cursoB = await sesion.escalar(
    `(SELECT id FROM public.cursos WHERE denominacion = '${MARCA} B')`,
    'curso_b'
  )
  return { alumno, cursoA, cursoB }
}

/** Deja al alumno en el estado inicial que necesita cada escenario. */
async function reiniciarAlumno(sesion, alumno, cursoA, cursoB, estado) {
  // Una sola transacción: borrar la matrícula y dejar el estado en INACTIVO son
  // incoherentes por separado, y el trigger diferido evalúa cada `COMMIT`.
  await sesion.ejecutar(
    `BEGIN;
     UPDATE public.cursos SET activo = TRUE
       WHERE id IN ('${cursoA}', '${cursoB}');
     DELETE FROM public.matriculas WHERE alumno_id = '${alumno}';
     UPDATE public.alumnos SET estado = 'INACTIVO' WHERE perfil_id = '${alumno}';
     COMMIT;`,
    'reiniciar_alumno'
  )

  if (estado === 'ACTIVO') {
    await sesion.ejecutar(
      `${CLAIMS_DIRECTORA}
       SELECT public.reactivar_alumno('${alumno}', '${cursoA}');`,
      'activar_alumno'
    )
  }
}

/** Bloque que espera exactamente un SQLSTATE y falla si la operación pasa. */
function esperandoSqlstate(sql, sqlstate, descripcion) {
  return `DO $prueba$
     BEGIN
       BEGIN
         ${sql}
         RAISE EXCEPTION '${descripcion}';
       EXCEPTION WHEN SQLSTATE '${sqlstate}' THEN
         NULL;
       END;
     END
     $prueba$;`
}

async function afirmar(sesion, expresion, esperado, etiqueta, mensaje) {
  const valor = await sesion.escalar(expresion, etiqueta)
  if (valor !== esperado) {
    throw new Error(`${mensaje} (se esperaba ${esperado} y se obtuvo ${valor})`)
  }
}

// ================================================================
// 17. Dos matrículas concurrentes para el mismo estudiante
// ================================================================
async function dobleMatriculaConcurrente(a, b, pids, ctx) {
  await reiniciarAlumno(a, ctx.alumno, ctx.cursoA, ctx.cursoB, 'INACTIVO')

  await a.ejecutar(
    `${CLAIMS_DIRECTORA}
     BEGIN;
     SELECT public.reactivar_alumno('${ctx.alumno}', '${ctx.cursoA}');`,
    'matricula_a_pendiente'
  )

  const perdedora = b.ejecutar(
    `${CLAIMS_DIRECTORA}
     ${esperandoSqlstate(
       `PERFORM public.reactivar_alumno('${ctx.alumno}', '${ctx.cursoB}');`,
       'P5516',
       'La segunda matrícula concurrente debía rechazarse'
     )}`,
    'matricula_b_pendiente'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_matricula_a')
  await perdedora

  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.matriculas
      WHERE alumno_id = '${ctx.alumno}' AND fecha_cierre IS NULL)`,
    '1',
    'verificar_una_matricula',
    'Quedó más de una matrícula vigente tras dos altas concurrentes'
  )
  await afirmar(
    a,
    `(SELECT curso_id FROM public.matriculas
      WHERE alumno_id = '${ctx.alumno}' AND fecha_cierre IS NULL)`,
    ctx.cursoA,
    'verificar_curso_ganador',
    'La matrícula vigente no es la de la transacción que confirmó primero'
  )
  console.log('OK CONCURRENCIA 17: dos matrículas simultáneas dejan una sola vigente')
}

// ================================================================
// 17bis. El índice único parcial es la garantía, sin pasar por las funciones
// ================================================================
async function dobleMatriculaDirecta(a, b, pids, ctx) {
  await reiniciarAlumno(a, ctx.alumno, ctx.cursoA, ctx.cursoB, 'INACTIVO')

  // La transacción ganadora deja un estado coherente (ACTIVO con una matrícula),
  // porque el trigger diferido también evalúa esta escritura directa.
  await a.ejecutar(
    `BEGIN;
     INSERT INTO public.matriculas (alumno_id, curso_id)
     VALUES ('${ctx.alumno}', '${ctx.cursoA}');
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${ctx.alumno}';`,
    'insercion_directa_a'
  )

  const perdedora = b.ejecutar(
    esperandoSqlstate(
      `INSERT INTO public.matriculas (alumno_id, curso_id)
       VALUES ('${ctx.alumno}', '${ctx.cursoB}');`,
      '23505',
      'La segunda inserción directa concurrente debía rechazarse'
    ),
    'insercion_directa_b'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_insercion_directa_a')
  await perdedora

  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.matriculas
      WHERE alumno_id = '${ctx.alumno}' AND fecha_cierre IS NULL)`,
    '1',
    'verificar_indice_unico',
    'El índice único parcial permitió dos matrículas vigentes'
  )
  console.log(
    'OK CONCURRENCIA 17bis: el índice único parcial rechaza la segunda inserción directa (23505)'
  )
}

// ================================================================
// 18. Dos altas concurrentes con el mismo DNI
// ================================================================
async function dniConcurrente(a, b, pids) {
  await a.ejecutar(
    `BEGIN;
     DELETE FROM public.matriculas
       WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni = '93000200');
     DELETE FROM public.alumnos
       WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni = '93000200');
     DELETE FROM public.perfiles WHERE dni = '93000200';
     COMMIT;`,
    'limpiar_dni'
  )

  await a.ejecutar(
    `${CLAIMS_DIRECTORA}
     BEGIN;
     SELECT public.crear_alumno('Primera', 'Concurrente', '93000200', 'INACTIVO');`,
    'alta_dni_a'
  )

  const perdedora = b.ejecutar(
    `${CLAIMS_DIRECTORA}
     ${esperandoSqlstate(
       `PERFORM public.crear_alumno('Segunda', 'Concurrente', '93000200', 'INACTIVO');`,
       '23505',
       'El segundo alta con el mismo DNI debía rechazarse'
     )}`,
    'alta_dni_b'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_alta_dni_a')
  await perdedora

  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE dni = '93000200')`,
    '1',
    'verificar_dni_unico',
    'Dos altas concurrentes con el mismo DNI confirmaron las dos'
  )
  await afirmar(
    a,
    `(SELECT p.nombre FROM public.perfiles p WHERE p.dni = '93000200')`,
    'Primera',
    'verificar_dni_ganador',
    'El DNI quedó asignado a la transacción que no confirmó primero'
  )
  console.log('OK CONCURRENCIA 18: dos altas simultáneas con el mismo DNI dejan una sola (23505)')
}

// ================================================================
// 18bis. Dos correcciones concurrentes hacia el mismo DNI normalizado
// ================================================================
/**
 * Dos estudiantes distintos, dos sesiones distintas, el mismo DNI de destino.
 *
 * Es una carrera diferente de la del escenario 18. Acá las dos transacciones
 * corrigen filas distintas de `alumnos`, así que el `FOR UPDATE` del principio
 * de `corregir_identidad_alumno` no las pone en fila: cada una toma su propia
 * fila sin esperar a la otra. Lo único que impide que las dos confirmen es el
 * índice único sobre el DNI, y de eso trata este escenario.
 *
 * La segunda sesión queda bloqueada en la inserción del índice, no por un
 * bloqueo de fila; `pg_blocking_pids` lo detecta igual, y por eso la
 * coordinación sigue siendo determinista y no depende de esperas por tiempo.
 */
async function correccionDniConcurrente(a, b, pids) {
  const DNI_UNO = '93000301'
  const DNI_DOS = '93000302'
  const DNI_DESTINO = '93000399'

  await a.ejecutar(
    `BEGIN;
     DELETE FROM public.alumnos
       WHERE perfil_id IN (SELECT id FROM public.perfiles
                           WHERE dni IN ('${DNI_UNO}', '${DNI_DOS}', '${DNI_DESTINO}'));
     DELETE FROM public.perfiles
       WHERE dni IN ('${DNI_UNO}', '${DNI_DOS}', '${DNI_DESTINO}');
     COMMIT;

     ${CLAIMS_DIRECTORA}
     SELECT public.crear_alumno('Correccion', 'Uno', '${DNI_UNO}', 'INACTIVO');
     SELECT public.crear_alumno('Correccion', 'Dos', '${DNI_DOS}', 'INACTIVO');`,
    'preparar_correccion_dni'
  )

  const alumnoUno = await a.escalar(
    `(SELECT id FROM public.perfiles WHERE dni = '${DNI_UNO}')`,
    'alumno_correccion_uno'
  )
  const alumnoDos = await a.escalar(
    `(SELECT id FROM public.perfiles WHERE dni = '${DNI_DOS}')`,
    'alumno_correccion_dos'
  )

  await a.ejecutar(
    `${CLAIMS_DIRECTORA}
     BEGIN;
     SELECT public.corregir_identidad_alumno('${alumnoUno}', '${DNI_DESTINO}');`,
    'correccion_a_pendiente'
  )

  const perdedora = b.ejecutar(
    `${CLAIMS_DIRECTORA}
     ${esperandoSqlstate(
       `PERFORM public.corregir_identidad_alumno('${alumnoDos}', '${DNI_DESTINO}');`,
       '23505',
       'La segunda corrección concurrente hacia el mismo DNI debía rechazarse'
     )}`,
    'correccion_b_pendiente'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_correccion_a')
  await perdedora

  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE dni = '${DNI_DESTINO}')`,
    '1',
    'verificar_correccion_dni_unico',
    'Dos correcciones concurrentes dejaron el mismo DNI en dos perfiles'
  )
  await afirmar(
    a,
    `(SELECT apellido FROM public.perfiles WHERE dni = '${DNI_DESTINO}')`,
    'Uno',
    'verificar_correccion_ganadora',
    'El DNI corregido no quedó en la transacción que confirmó primero'
  )
  // La perdedora conserva su DNI anterior: el rechazo no dejó a nadie a medias.
  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE dni = '${DNI_DOS}')`,
    '1',
    'verificar_perdedora_intacta',
    'La corrección rechazada dejó al segundo estudiante sin su DNI original'
  )
  console.log(
    'OK CONCURRENCIA 18bis: dos correcciones simultáneas hacia el mismo DNI dejan una sola (23505)'
  )
}

// ================================================================
// 18ter. Dos correcciones concurrentes hacia el mismo legajo normalizado
// ================================================================
/**
 * El mismo legajo escrito con distinta caja es el mismo legajo.
 *
 * Dos sesiones asignan «LEG-CONC-9000» y «leg-conc-9000» al mismo tiempo a
 * estudiantes distintos. Si la unicidad dependiera de la cadena literal, las
 * dos confirmarían y el centro educativo tendría dos legajos que una persona
 * lee como uno solo.
 */
async function correccionLegajoConcurrente(a, b, pids) {
  const DNI_DOS = '93000302'
  const LEGAJO = 'LEG-CONC-9000'

  const alumnoUno = await a.escalar(
    `(SELECT id FROM public.perfiles WHERE dni = '93000399')`,
    'alumno_legajo_uno'
  )
  const alumnoDos = await a.escalar(
    `(SELECT id FROM public.perfiles WHERE dni = '${DNI_DOS}')`,
    'alumno_legajo_dos'
  )

  await a.ejecutar(
    `${CLAIMS_DIRECTORA}
     BEGIN;
     SELECT public.corregir_identidad_alumno('${alumnoUno}', '93000399', '${LEGAJO}');`,
    'legajo_a_pendiente'
  )

  const perdedora = b.ejecutar(
    `${CLAIMS_DIRECTORA}
     ${esperandoSqlstate(
       `PERFORM public.corregir_identidad_alumno('${alumnoDos}', '${DNI_DOS}', '${LEGAJO.toLowerCase()}');`,
       '23505',
       'El mismo legajo con otra caja debía rechazarse'
     )}`,
    'legajo_b_pendiente'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_legajo_a')
  await perdedora

  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.perfiles
      WHERE pg_catalog.lower(legajo_nro) = '${LEGAJO.toLowerCase()}')`,
    '1',
    'verificar_legajo_unico',
    'Dos correcciones concurrentes dejaron el mismo legajo normalizado dos veces'
  )
  console.log(
    'OK CONCURRENCIA 18ter: el mismo legajo con distinta caja no se duplica bajo concurrencia (23505)'
  )
}

// ================================================================
// 19. Asignación de curso frente a inactivación del estudiante
// ================================================================
async function asignacionContraInactivacionDelAlumno(a, b, pids, ctx) {
  await reiniciarAlumno(a, ctx.alumno, ctx.cursoA, ctx.cursoB, 'ACTIVO')

  await a.ejecutar(
    `${CLAIMS_DIRECTORA}
     BEGIN;
     SELECT public.inactivar_alumno('${ctx.alumno}');`,
    'inactivacion_alumno_pendiente'
  )

  const perdedora = b.ejecutar(
    `${CLAIMS_DIRECTORA}
     ${esperandoSqlstate(
       `PERFORM public.cambiar_curso_alumno('${ctx.alumno}', '${ctx.cursoB}');`,
       'P5513',
       'El cambio de curso sobre un estudiante recién inactivado debía rechazarse'
     )}`,
    'cambio_curso_pendiente'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_inactivacion_alumno')
  await perdedora

  await afirmar(
    a,
    `(SELECT estado::text FROM public.alumnos WHERE perfil_id = '${ctx.alumno}')`,
    'INACTIVO',
    'verificar_estado_inactivo',
    'El estudiante no quedó inactivo'
  )
  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.matriculas
      WHERE alumno_id = '${ctx.alumno}' AND fecha_cierre IS NULL)`,
    '0',
    'verificar_sin_matricula',
    'Un estudiante inactivo conservó una matrícula vigente'
  )
  console.log(
    'OK CONCURRENCIA 19: la asignación concurrente a un estudiante inactivado se rechaza (P5513)'
  )
}

// ================================================================
// 20a. Asignación primero, inactivación del curso después
// ================================================================
async function asignacionAntesQueInactivacionDelCurso(a, b, pids, ctx) {
  await reiniciarAlumno(a, ctx.alumno, ctx.cursoA, ctx.cursoB, 'INACTIVO')

  await a.ejecutar(
    `${CLAIMS_DIRECTORA}
     BEGIN;
     SELECT public.reactivar_alumno('${ctx.alumno}', '${ctx.cursoA}');`,
    'asignacion_pendiente'
  )

  const perdedora = b.ejecutar(
    esperandoSqlstate(
      `UPDATE public.cursos SET activo = FALSE WHERE id = '${ctx.cursoA}';`,
      'P5514',
      'La inactivación del curso con una matrícula recién confirmada debía rechazarse'
    ),
    'inactivacion_curso_pendiente'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_asignacion')
  await perdedora

  await afirmar(
    a,
    `(SELECT activo FROM public.cursos WHERE id = '${ctx.cursoA}')`,
    'true',
    'verificar_curso_activo',
    'El curso quedó inactivo pese a tener una matrícula vigente'
  )
  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.matriculas
      WHERE alumno_id = '${ctx.alumno}' AND fecha_cierre IS NULL)`,
    '1',
    'verificar_matricula_persistida',
    'La matrícula ganadora no persistió'
  )
  console.log(
    'OK CONCURRENCIA 20a: asignación primero impide inactivar el curso (P5514)'
  )
}

// ================================================================
// 20b. Inactivación del curso primero, asignación después
// ================================================================
async function inactivacionDelCursoAntesQueAsignacion(a, b, pids, ctx) {
  await reiniciarAlumno(a, ctx.alumno, ctx.cursoA, ctx.cursoB, 'INACTIVO')

  await a.ejecutar(
    `BEGIN;
     UPDATE public.cursos SET activo = FALSE WHERE id = '${ctx.cursoA}';`,
    'inactivacion_curso_primero'
  )

  const perdedora = b.ejecutar(
    `${CLAIMS_DIRECTORA}
     ${esperandoSqlstate(
       `PERFORM public.reactivar_alumno('${ctx.alumno}', '${ctx.cursoA}');`,
       'P5504',
       'La asignación a un curso recién inactivado debía rechazarse'
     )}`,
    'asignacion_tardia'
  )

  await esperarBloqueo(a, pids.a, pids.b)
  await a.ejecutar('COMMIT;', 'confirmar_inactivacion_curso')
  await perdedora

  await afirmar(
    a,
    `(SELECT activo FROM public.cursos WHERE id = '${ctx.cursoA}')`,
    'false',
    'verificar_curso_inactivo',
    'El curso no quedó inactivo'
  )
  await afirmar(
    a,
    `(SELECT pg_catalog.count(*) FROM public.matriculas
      WHERE alumno_id = '${ctx.alumno}' AND fecha_cierre IS NULL)`,
    '0',
    'verificar_sin_matricula_tardia',
    'Se persistió una matrícula contra un curso ya inactivo'
  )
  console.log(
    'OK CONCURRENCIA 20b: inactivación primero rechaza la asignación tardía (P5504)'
  )
}

const sesionA = new SesionPsql('A', 'EPT9')
const sesionB = new SesionPsql('B', 'EPT9')

try {
  const pidA = Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pidB = Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pids = { a: pidA, b: pidB }

  const ctx = await prepararFixture(sesionA)

  await dobleMatriculaConcurrente(sesionA, sesionB, pids, ctx)
  await dobleMatriculaDirecta(sesionA, sesionB, pids, ctx)
  await dniConcurrente(sesionA, sesionB, pids)
  await correccionDniConcurrente(sesionA, sesionB, pids)
  await correccionLegajoConcurrente(sesionA, sesionB, pids)
  await asignacionContraInactivacionDelAlumno(sesionA, sesionB, pids, ctx)
  await asignacionAntesQueInactivacionDelCurso(sesionA, sesionB, pids, ctx)
  await inactivacionDelCursoAntesQueAsignacion(sesionA, sesionB, pids, ctx)

  await sesionA.ejecutar(
    `BEGIN;
     DELETE FROM public.matriculas
       WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '930%');
     DELETE FROM public.alumnos
       WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '930%');
     DELETE FROM public.perfiles WHERE dni LIKE '930%';
     DELETE FROM public.cursos WHERE denominacion LIKE '${MARCA}%';
     COMMIT;`,
    'limpiar_fixture'
  )
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
