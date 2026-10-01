import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real del registro de accesos con QR (EPT-65, RF21).
 *
 * Usa conexiones PostgreSQL independientes: cada `SesionPsql` es un proceso
 * `psql` propio, así que compiten de verdad por los candados de fila. Los casos
 * de a dos son DETERMINISTAS: una sesión mantiene su transacción abierta
 * (candados tomados), la otra se lanza, y `esperarBloqueo` comprueba con
 * `pg_blocking_pids` que está efectivamente esperando antes de confirmar. Nunca
 * se infiere el orden comparando `now()` de transacciones distintas.
 *
 * Para cada carrera se prueban los DOS órdenes:
 *   a) el escaneo confirma ANTES del cambio de estado: un REGISTRADO confirmado
 *      antes de, por ejemplo, revocar, es legítimo;
 *   b) el cambio de estado confirma ANTES de que el escaneo evalúe: el escaneo
 *      NO puede quedar REGISTRADO.
 *
 * Carreras cubiertas: revocación, reposición, inactivación del alumno, bloqueo
 * del perfil del alumno, bloqueo del operador, cancelación de la inscripción,
 * desactivación del servicio, cambio de recorrido, anulación, doble escaneo,
 * reintento idéntico (mismo operador, mismo intento) y el límite de intentos;
 * y un estrés acotado que mezcla escaneos con cambios de estado y verifica que
 * no haya deadlocks, escrituras parciales ni dos REGISTRADO vigentes.
 *
 * Corre contra la base local descartable. Crea sus propios datos sintéticos y
 * los borra al final como propietario; para vaciar el historial inmutable
 * desactiva EXPLÍCITAMENTE los triggers de usuario dentro de esa transacción de
 * limpieza. Ese borrado no representa ninguna operación disponible en la
 * aplicación.
 */

const hex = (n) => n.toString(16).padStart(2, '0')
const PREFIJO = 'ea650001-0000-4000-8000-'
const op = (sufijo) => `${PREFIJO}0000000000${sufijo}`
const alumnoId = (n) => `${PREFIJO}0000000001${hex(n)}`
const credId = (n) => `${PREFIJO}0000000002${hex(n)}`

const DIR = op('d1')
const P1 = op('d2')
const P2 = op('d3')
const CURSO = `${PREFIJO}0000000000c1`

const COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const NORTE = 'e0000000-0000-4000-8000-000000000020'
const SUR = 'e0000000-0000-4000-8000-000000000021'
const ESTE = 'e0000000-0000-4000-8000-000000000022'

// Cada carrera usa alumnos propios para no contaminar a las demás.
const A = {
  rev1: 1, rev2: 2, rep: 3, ina1: 4, ina2: 5, blq1: 6, blq2: 7,
  op1: 8, op2: 9, can1: 10, can2: 11, srv1: 12, srv2: 13, cam1: 14, cam2: 15,
  anu1: 16, anu2: 17, doble: 18, int1: 19, int2a: 20, int2b: 21,
  rafaga: 22,
}
const ESTRES = [30, 31, 32, 33, 34, 35, 36, 37]
const TODOS = [...Object.values(A), ...ESTRES]

const lista = (ids) => ids.map((id) => `'${id}'`).join(', ')
const TODOS_ALUMNOS = TODOS.map(alumnoId)
const TODAS_CRED = TODOS.map(credId)
const OPERADORES = [DIR, P1, P2]

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

// ---------------------------------------------------------------
// Roles y llamadas
// ---------------------------------------------------------------
const comoServidor = 'SET ROLE service_role;'
const comoServidorLocal = 'SET LOCAL ROLE service_role;'
const comoDirector = `SET ROLE authenticated;\nSELECT set_config('request.jwt.claims', '{"sub":"${DIR}"}', false);`
const comoDirectorLocal = `SET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '{"sub":"${DIR}"}', true);`
const comoEstudiante = (n) =>
  `SET ROLE authenticated;\nSELECT set_config('request.jwt.claims', '{"sub":"${alumnoId(n)}"}', false);`
const comoEstudianteLocal = (n) =>
  `SET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '{"sub":"${alumnoId(n)}"}', true);`

const uuid = () => crypto.randomUUID()

/** Envuelve una llamada y deja el resultado (código o SQLSTATE) en una variable de sesión. */
function tolerante(llamada) {
  // Acepta tanto una expresión como una sentencia `SELECT …;`.
  const expresion = llamada.replace(/^\s*SELECT\s+/iu, '').replace(/;\s*$/u, '')
  return `DO $x$
          BEGIN
            BEGIN
              PERFORM ${expresion};
              PERFORM pg_catalog.set_config('ept65.resultado', 'OK', false);
            EXCEPTION
              WHEN OTHERS THEN
                PERFORM pg_catalog.set_config('ept65.resultado', 'E:' || SQLSTATE, false);
            END;
          END
          $x$;`
}

/** Escaneo como el servidor: el código de resultado queda en `ept65.resultado`. */
function escanear(operador, intento, credencial, servicio, sentido = null) {
  return `DO $x$
          DECLARE v TEXT;
          BEGIN
            BEGIN
              SELECT codigo_resultado INTO v FROM public.registrar_acceso_servicio(
                '${operador}', '${intento}', '${credencial}', '${servicio}', ${sentido ? `'${sentido}'` : 'NULL'});
              PERFORM pg_catalog.set_config('ept65.resultado', COALESCE(v, '<NULL>'), false);
            EXCEPTION
              WHEN OTHERS THEN
                PERFORM pg_catalog.set_config('ept65.resultado', 'E:' || SQLSTATE, false);
            END;
          END
          $x$;`
}

const resultadoDe = (sesion, etiqueta) =>
  sesion.escalar(`pg_catalog.current_setting('ept65.resultado', true)`, etiqueta)

const n = (sesion, consulta, etiqueta) => sesion.escalar(`(${consulta})`, etiqueta)
const eventos = (sesion, alumno, resultado, etiqueta) =>
  n(
    sesion,
    `SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE alumno_id = '${alumno}'${
      resultado ? ` AND resultado = '${resultado}'` : ''
    }`,
    etiqueta
  )
const motivoDe = (sesion, alumno, etiqueta) =>
  n(
    sesion,
    `SELECT motivo_denegacion FROM public.accesos_servicios WHERE alumno_id = '${alumno}' AND resultado = 'DENEGADO' ORDER BY registrado_en DESC LIMIT 1`,
    etiqueta
  )

const credActiva = (sesion, alumno, etiqueta) =>
  n(sesion, `SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA'`, etiqueta)

// ---------------------------------------------------------------
// Orquestación de los dos órdenes
// ---------------------------------------------------------------
/**
 * El escaneo mantiene sus candados (transacción abierta) y la operación `otra`
 * se lanza y queda esperando. Se confirma el escaneo y se espera a la otra.
 */
async function escaneoPrimero(sesionEscaneo, sesionOtra, pids, sqlEscaneo, sqlOtra, etiqueta) {
  await sesionEscaneo.ejecutar(`BEGIN;\n${comoServidorLocal}\n${sqlEscaneo}`, `${etiqueta}_escaneo_retiene`)
  const otra = sesionOtra.ejecutar(sqlOtra, `${etiqueta}_otra_espera`)
  await esperarBloqueo(sesionEscaneo, pids.escaneo, pids.otra)
  await sesionEscaneo.ejecutar('COMMIT;\nRESET ROLE;', `${etiqueta}_confirmar_escaneo`)
  await otra
}

/** La operación `otra` mantiene sus candados; el escaneo se lanza y espera. */
async function otraPrimero(sesionEscaneo, sesionOtra, pids, sqlOtraRetenida, sqlEscaneo, etiqueta) {
  await sesionOtra.ejecutar(`BEGIN;\n${sqlOtraRetenida}`, `${etiqueta}_otra_retiene`)
  const escaneo = sesionEscaneo.ejecutar(`${comoServidor}\n${sqlEscaneo}`, `${etiqueta}_escaneo_espera`)
  await esperarBloqueo(sesionOtra, pids.otra, pids.escaneo)
  await sesionOtra.ejecutar('COMMIT;\nRESET ROLE;', `${etiqueta}_confirmar_otra`)
  await escaneo
  await sesionEscaneo.ejecutar('RESET ROLE;', `${etiqueta}_reset_escaneo`)
}

const llamadas = {
  revocar: (n_) => `SELECT public.revocar_credencial_qr('${credId(n_)}', 'Revocación concurrente');`,
  reponer: (id) => `SELECT public.reponer_credencial_qr('${id}', 'k1', 'Reposición concurrente');`,
  inactivar: (n_) => `SELECT public.inactivar_alumno('${alumnoId(n_)}');`,
  bloquear: (n_) =>
    `SELECT public.cambiar_acceso_perfil('${alumnoId(n_)}', 'HABILITADO', 'BLOQUEADO', 'Bloqueo concurrente');`,
  bloquearOperador: (id) =>
    `SELECT public.cambiar_acceso_perfil('${id}', 'HABILITADO', 'BLOQUEADO', 'Bloqueo concurrente');`,
  cancelar: (n_) =>
    `SELECT public.cancelar_inscripcion_servicio_administrativa((SELECT id FROM public.inscripciones_servicios WHERE alumno_id = '${alumnoId(n_)}' AND servicio_id = '${COMEDOR}' AND estado = 'ACTIVA'), 'COMEDOR');`,
  desactivar: (servicio, nombre) => `SELECT public.actualizar_recorrido('${servicio}', '${nombre}', false);`,
  cambiarRecorrido: (servicio) => `SELECT public.establecer_recorrido_transporte('${servicio}');`,
  anular: (id) => `SELECT public.anular_acceso_servicio('${id}', 'Anulación concurrente');`,
}

// ---------------------------------------------------------------
// Fixture y limpieza
// ---------------------------------------------------------------
const limpiar = `RESET ROLE;
  BEGIN;
  ALTER TABLE public.accesos_servicios DISABLE TRIGGER USER;
  ALTER TABLE public.anulaciones_accesos_servicios DISABLE TRIGGER USER;
  DELETE FROM public.anulaciones_accesos_servicios
   WHERE acceso_id IN (SELECT id FROM public.accesos_servicios
                        WHERE alumno_id IN (${lista(TODOS_ALUMNOS)}) OR operador_perfil_id IN (${lista(OPERADORES)}));
  DELETE FROM public.accesos_servicios
   WHERE alumno_id IN (${lista(TODOS_ALUMNOS)}) OR operador_perfil_id IN (${lista(OPERADORES)});
  ALTER TABLE public.anulaciones_accesos_servicios ENABLE TRIGGER USER;
  ALTER TABLE public.accesos_servicios ENABLE TRIGGER USER;
  DELETE FROM app_private.contadores_escaneo WHERE operador_perfil_id IN (${lista(OPERADORES)});
  ALTER TABLE public.credenciales_qr DISABLE TRIGGER USER;
  DELETE FROM public.credenciales_qr WHERE alumno_id IN (${lista(TODOS_ALUMNOS)});
  ALTER TABLE public.credenciales_qr ENABLE TRIGGER USER;
  ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
  DELETE FROM public.perfiles_historial
   WHERE perfil_id IN (${lista([...TODOS_ALUMNOS, ...OPERADORES])})
      OR actor_perfil_id IN (${lista([...TODOS_ALUMNOS, ...OPERADORES])});
  ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
  DELETE FROM public.inscripciones_servicios WHERE alumno_id IN (${lista(TODOS_ALUMNOS)});
  DELETE FROM public.matriculas WHERE alumno_id IN (${lista(TODOS_ALUMNOS)});
  DELETE FROM public.alumnos WHERE perfil_id IN (${lista(TODOS_ALUMNOS)});
  DELETE FROM public.perfiles WHERE id IN (${lista([...TODOS_ALUMNOS, ...OPERADORES])});
  DELETE FROM public.cursos WHERE id = '${CURSO}';
  UPDATE public.servicios_escolares SET activo = TRUE
   WHERE id IN ('${COMEDOR}', '${NORTE}', '${SUR}', '${ESTE}') AND NOT activo;
  COMMIT;`

const fixture = () => {
  const dnis = [...OPERADORES, ...TODOS_ALUMNOS].map((_, i) => `9893${String(i + 1).padStart(4, '0')}`)
  const perfilesOperadores = [
    [DIR, 'DIRECTOR', 'Directora', 'Concurrente'],
    [P1, 'PERSONAL', 'Personal', 'Uno Concurrente'],
    [P2, 'PERSONAL', 'Personal', 'Dos Concurrente'],
  ]
  return `BEGIN;
    INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
    VALUES ('${CURSO}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO' LIMIT 1), 'CONCURRENCIA EPT-65', 'A', TRUE);

    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
    VALUES ${perfilesOperadores
      .map(
        ([id, rol, nombre, apellido], i) =>
          `('${id}', '${id}', (SELECT id FROM public.roles WHERE nombre = '${rol}'), '${nombre}', '${apellido}', '${dnis[i]}')`
      )
      .join(',\n           ')};

    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
    VALUES ${TODOS_ALUMNOS.map(
      (id, i) =>
        `('${id}', '${id}', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Alumno', 'Concurrente ${i + 1}', '${dnis[i + 3]}', 'LEG-EPT65-C${i + 1}')`
    ).join(',\n           ')};

    INSERT INTO public.matriculas (alumno_id, curso_id)
    VALUES ${TODOS_ALUMNOS.map((id) => `('${id}', '${CURSO}')`).join(', ')};
    UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${lista(TODOS_ALUMNOS)});

    -- Credenciales sintéticas (las emite el propietario: la prueba no es de EPT-64).
    INSERT INTO public.credenciales_qr (id, alumno_id, clave_kid, emitida_por)
    VALUES ${TODOS.map((k) => `('${credId(k)}', '${alumnoId(k)}', 'k1', '${DIR}')`).join(',\n           ')};

    -- Inscripciones: comedor para todos; transporte (NORTE) para los de cambio de recorrido
    -- y el estrés; ESTE para los de la desactivación del servicio.
    INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
    VALUES ${[
      ...TODOS.map((k) => `('${alumnoId(k)}', '${COMEDOR}')`),
      ...[A.cam1, A.cam2, ...ESTRES].map((k) => `('${alumnoId(k)}', '${NORTE}')`),
      ...[A.srv1, A.srv2].map((k) => `('${alumnoId(k)}', '${ESTE}')`),
      ...[A.doble].map((k) => `('${alumnoId(k)}', '${NORTE}')`),
    ].join(',\n           ')};
    COMMIT;`
}

// ---------------------------------------------------------------
// 1. Revocación y reposición frente al escaneo
// ---------------------------------------------------------------
async function probarRevocacion(esc, otra, pids) {
  // 1a. El escaneo confirma ANTES de la revocación: es un REGISTRADO legítimo.
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.rev1), COMEDOR),
    `${comoDirector}\n${tolerante(llamadas.revocar(A.rev1).replace(/;$/u, ''))}`,
    'rev1'
  )
  await otra.ejecutar('RESET ROLE;', 'rev1_reset')
  exigir((await resultadoDe(esc, 'rev1_res_escaneo')) === 'REGISTRADO', 'Revocación 1a: el escaneo previo debía REGISTRAR')
  exigir((await resultadoDe(otra, 'rev1_res_otra')) === 'OK', 'Revocación 1a: la revocación debía completarse tras el escaneo')
  exigir((await eventos(esc, alumnoId(A.rev1), 'REGISTRADO', 'rev1_ev')) === '1', 'Revocación 1a: debía quedar un REGISTRADO')
  // Y a partir de ahora, ya revocada, no se registra.
  await esc.ejecutar(`${comoServidor}\n${escanear(P1, uuid(), credId(A.rev1), COMEDOR)}\nRESET ROLE;`, 'rev1_posterior')
  exigir((await resultadoDe(esc, 'rev1_res_post')) === 'NO_HABILITADO', 'Revocación 1a: tras revocar, el escaneo no debía registrar')
  exigir((await motivoDe(esc, alumnoId(A.rev1), 'rev1_motivo')) === 'CREDENCIAL_REVOCADA', 'Revocación 1a: motivo CREDENCIAL_REVOCADA')

  // 1b. La revocación confirma ANTES de que el escaneo evalúe: NO puede quedar REGISTRADO.
  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\n${llamadas.revocar(A.rev2)}`,
    escanear(P1, uuid(), credId(A.rev2), COMEDOR),
    'rev2'
  )
  exigir((await resultadoDe(esc, 'rev2_res')) === 'NO_HABILITADO', 'Revocación 1b: el escaneo iniciado antes de confirmar la revocación no puede quedar REGISTRADO')
  exigir((await eventos(esc, alumnoId(A.rev2), 'REGISTRADO', 'rev2_ev')) === '0', 'Revocación 1b: no debía haber REGISTRADO')
  exigir((await motivoDe(esc, alumnoId(A.rev2), 'rev2_motivo')) === 'CREDENCIAL_REVOCADA', 'Revocación 1b: motivo CREDENCIAL_REVOCADA')

  // 1c. Reposición: el escaneo con la credencial vieja espera y se deniega; con la nueva se registra.
  const vieja = credId(A.rep)
  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\n${llamadas.reponer(vieja)}`,
    escanear(P1, uuid(), vieja, COMEDOR),
    'rep'
  )
  exigir((await resultadoDe(esc, 'rep_res_vieja')) === 'NO_HABILITADO', 'Reposición: la credencial vieja no debía registrar')
  const nueva = await credActiva(esc, alumnoId(A.rep), 'rep_nueva')
  exigir(nueva !== vieja && /^[0-9a-f-]{36}$/u.test(nueva), 'Reposición: debía existir una credencial nueva ACTIVA')
  await esc.ejecutar(`${comoServidor}\n${escanear(P1, uuid(), nueva, COMEDOR)}\nRESET ROLE;`, 'rep_nueva_escaneo')
  exigir((await resultadoDe(esc, 'rep_res_nueva')) === 'REGISTRADO', 'Reposición: la credencial nueva debía registrar')
  console.log('OK CONCURRENCIA 1: revocación y reposición frente al escaneo, en los dos órdenes: un REGISTRADO previo es legítimo y uno posterior a la confirmación no existe')
}

// ---------------------------------------------------------------
// 2. Inactivación del alumno
// ---------------------------------------------------------------
async function probarInactivacion(esc, otra, pids) {
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.ina1), COMEDOR),
    `${comoDirector}\n${tolerante(llamadas.inactivar(A.ina1).replace(/;$/u, ''))}`,
    'ina1'
  )
  await otra.ejecutar('RESET ROLE;', 'ina1_reset')
  exigir((await resultadoDe(esc, 'ina1_res')) === 'REGISTRADO', 'Inactivación 2a: el escaneo previo debía REGISTRAR')
  exigir((await resultadoDe(otra, 'ina1_res_otra')) === 'OK', 'Inactivación 2a: la inactivación debía completarse después')

  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\n${llamadas.inactivar(A.ina2)}`,
    escanear(P1, uuid(), credId(A.ina2), COMEDOR),
    'ina2'
  )
  exigir((await resultadoDe(esc, 'ina2_res')) === 'NO_HABILITADO', 'Inactivación 2b: tras inactivar no puede REGISTRAR')
  exigir((await eventos(esc, alumnoId(A.ina2), 'REGISTRADO', 'ina2_ev')) === '0', 'Inactivación 2b: no debía haber REGISTRADO')
  exigir((await motivoDe(esc, alumnoId(A.ina2), 'ina2_motivo')) === 'ALUMNO_INACTIVO', 'Inactivación 2b: motivo ALUMNO_INACTIVO')
  console.log('OK CONCURRENCIA 2: inactivar el alumno se serializa con el escaneo en los dos órdenes, sin deadlock')
}

// ---------------------------------------------------------------
// 3. Bloqueo del perfil del alumno (EPT-59)
// ---------------------------------------------------------------
async function probarBloqueoDelAlumno(esc, otra, pids) {
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.blq1), COMEDOR),
    `${comoDirector}\n${tolerante(llamadas.bloquear(A.blq1).replace(/;$/u, ''))}`,
    'blq1'
  )
  await otra.ejecutar('RESET ROLE;', 'blq1_reset')
  exigir((await resultadoDe(esc, 'blq1_res')) === 'REGISTRADO', 'Bloqueo 3a: el escaneo previo debía REGISTRAR')
  exigir((await resultadoDe(otra, 'blq1_res_otra')) === 'OK', 'Bloqueo 3a: el bloqueo debía completarse después del escaneo')

  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\n${llamadas.bloquear(A.blq2)}`,
    escanear(P1, uuid(), credId(A.blq2), COMEDOR),
    'blq2'
  )
  exigir((await resultadoDe(esc, 'blq2_res')) === 'NO_HABILITADO', 'Bloqueo 3b: con el perfil ya bloqueado no puede REGISTRAR')
  exigir((await motivoDe(esc, alumnoId(A.blq2), 'blq2_motivo')) === 'ACCESO_BLOQUEADO', 'Bloqueo 3b: motivo ACCESO_BLOQUEADO')
  console.log('OK CONCURRENCIA 3: bloquear al alumno (EPT-59) y escanear se serializan en los dos órdenes, sin deadlock')
}

// ---------------------------------------------------------------
// 4. Bloqueo del OPERADOR
// ---------------------------------------------------------------
async function probarBloqueoDelOperador(esc, otra, pids) {
  // 4a. El escaneo del operador confirma antes de su bloqueo: es legítimo. Después, no puede operar.
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P2, uuid(), credId(A.op1), COMEDOR),
    `${comoDirector}\n${tolerante(llamadas.bloquearOperador(P2).replace(/;$/u, ''))}`,
    'op1'
  )
  await otra.ejecutar('RESET ROLE;', 'op1_reset')
  exigir((await resultadoDe(esc, 'op1_res')) === 'REGISTRADO', 'Operador 4a: el escaneo previo al bloqueo era legítimo')
  exigir((await resultadoDe(otra, 'op1_res_otra')) === 'OK', 'Operador 4a: el bloqueo debía completarse después')
  await esc.ejecutar(`${comoServidor}\n${escanear(P2, uuid(), credId(A.op2), COMEDOR)}\nRESET ROLE;`, 'op2_posterior')
  exigir((await resultadoDe(esc, 'op2_res_post')) === 'E:42501', 'Operador 4a: un operador bloqueado no registra')
  exigir((await eventos(esc, alumnoId(A.op2), null, 'op2_ev')) === '0', 'Operador 4a: el rechazo no dejó evento')
  // Se vuelve a habilitar para el estrés.
  await esc.ejecutar(
    `${comoDirector}\n${tolerante(`public.cambiar_acceso_perfil('${P2}', 'BLOQUEADO', 'HABILITADO', 'Rehabilitación de prueba')`)}\nRESET ROLE;`,
    'op1_rehabilitar'
  )
  exigir((await resultadoDe(esc, 'op1_res_rehab')) === 'OK', 'Operador: no se pudo rehabilitar al operador')

  // 4b. El bloqueo del operador confirma ANTES: el escaneo que esperaba NO registra y no deja evento.
  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\n${llamadas.bloquearOperador(P2)}`,
    escanear(P2, uuid(), credId(A.op2), COMEDOR),
    'op2'
  )
  exigir((await resultadoDe(esc, 'op2_res')) === 'E:42501', 'Operador 4b: bloqueado antes de evaluar, el escaneo es rechazado con 42501')
  exigir((await eventos(esc, alumnoId(A.op2), null, 'op2_ev_b')) === '0', 'Operador 4b: sin evento parcial')
  await esc.ejecutar(
    `${comoDirector}\n${tolerante(`public.cambiar_acceso_perfil('${P2}', 'BLOQUEADO', 'HABILITADO', 'Rehabilitación de prueba')`)}\nRESET ROLE;`,
    'op2_rehabilitar'
  )
  console.log('OK CONCURRENCIA 4: bloquear al operador y escanear se serializan; un escaneo posterior al bloqueo no registra ni deja evento')
}

// ---------------------------------------------------------------
// 5. Cancelación de la inscripción
// ---------------------------------------------------------------
async function probarCancelacion(esc, otra, pids) {
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.can1), COMEDOR),
    `${comoDirector}\n${tolerante(llamadas.cancelar(A.can1).replace(/;$/u, ''))}`,
    'can1'
  )
  await otra.ejecutar('RESET ROLE;', 'can1_reset')
  exigir((await resultadoDe(esc, 'can1_res')) === 'REGISTRADO', 'Cancelación 5a: el escaneo previo debía REGISTRAR')
  exigir((await resultadoDe(otra, 'can1_res_otra')) === 'OK', 'Cancelación 5a: la cancelación debía completarse después')

  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\n${llamadas.cancelar(A.can2)}`,
    escanear(P1, uuid(), credId(A.can2), COMEDOR),
    'can2'
  )
  exigir((await resultadoDe(esc, 'can2_res')) === 'NO_HABILITADO', 'Cancelación 5b: sin inscripción activa no puede REGISTRAR')
  exigir((await motivoDe(esc, alumnoId(A.can2), 'can2_motivo')) === 'SIN_INSCRIPCION', 'Cancelación 5b: motivo SIN_INSCRIPCION')
  console.log('OK CONCURRENCIA 5: cancelar la inscripción y escanear se resuelven sin deadlock en los dos órdenes')
}

// ---------------------------------------------------------------
// 6. Desactivación del servicio (recorrido)
// ---------------------------------------------------------------
async function probarServicio(esc, otra, pids) {
  // 6a. El escaneo (alumno srv1 en ESTE) confirma antes de desactivar el recorrido.
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.srv1), ESTE, 'IDA'),
    `${comoDirector}\n${tolerante(llamadas.desactivar(ESTE, 'Recorrido Este (ficticio)').replace(/;$/u, ''))}`,
    'srv1'
  )
  await otra.ejecutar('RESET ROLE;', 'srv1_reset')
  exigir((await resultadoDe(esc, 'srv1_res')) === 'REGISTRADO', 'Servicio 6a: el escaneo previo debía REGISTRAR')
  exigir((await resultadoDe(otra, 'srv1_res_otra')) === 'OK', 'Servicio 6a: la desactivación debía completarse después')

  // 6b. Con el recorrido ya desactivado (ESTE sigue inactivo), el otro alumno no registra.
  await esc.ejecutar(`${comoServidor}\n${escanear(P1, uuid(), credId(A.srv2), ESTE, 'IDA')}\nRESET ROLE;`, 'srv2_escaneo')
  exigir((await resultadoDe(esc, 'srv2_res')) === 'NO_HABILITADO', 'Servicio 6b: recorrido inactivo → no registra')
  exigir((await motivoDe(esc, alumnoId(A.srv2), 'srv2_motivo')) === 'SERVICIO_INACTIVO', 'Servicio 6b: motivo SERVICIO_INACTIVO')

  // 6c. Reactivar el recorrido mientras un escaneo espera: tras confirmar, REGISTRA.
  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\nSELECT public.actualizar_recorrido('${ESTE}', 'Recorrido Este (ficticio)', true);`,
    escanear(P1, uuid(), credId(A.srv2), ESTE, 'VUELTA'),
    'srv3'
  )
  exigir((await resultadoDe(esc, 'srv3_res')) === 'REGISTRADO', 'Servicio 6c: reactivado antes de evaluar, el escaneo sí registra')
  console.log('OK CONCURRENCIA 6: desactivar y reactivar el recorrido se serializan con el escaneo en ambos órdenes')
}

// ---------------------------------------------------------------
// 7. Cambio de recorrido
// ---------------------------------------------------------------
async function probarCambioDeRecorrido(esc, otra, pids) {
  // 7a. Escanea NORTE (su recorrido) y confirma antes de que el alumno cambie a SUR.
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.cam1), NORTE, 'IDA'),
    `${comoEstudiante(A.cam1)}\n${tolerante(llamadas.cambiarRecorrido(SUR).replace(/;$/u, ''))}`,
    'cam1'
  )
  await otra.ejecutar('RESET ROLE;', 'cam1_reset')
  exigir((await resultadoDe(esc, 'cam1_res')) === 'REGISTRADO', 'Recorrido 7a: el escaneo previo en NORTE debía REGISTRAR')
  exigir((await resultadoDe(otra, 'cam1_res_otra')) === 'OK', 'Recorrido 7a: el cambio debía completarse después')
  await esc.ejecutar(`${comoServidor}\n${escanear(P1, uuid(), credId(A.cam1), NORTE, 'VUELTA')}\nRESET ROLE;`, 'cam1_posterior')
  exigir((await resultadoDe(esc, 'cam1_res_post')) === 'NO_HABILITADO', 'Recorrido 7a: tras cambiar a SUR, NORTE se deniega')
  exigir((await motivoDe(esc, alumnoId(A.cam1), 'cam1_motivo')) === 'RECORRIDO_DISTINTO', 'Recorrido 7a: motivo RECORRIDO_DISTINTO')

  // 7b. El cambio confirma ANTES: el escaneo en NORTE se deniega y en SUR se registra.
  await otraPrimero(
    esc, otra, pids,
    `${comoEstudianteLocal(A.cam2)}\n${llamadas.cambiarRecorrido(SUR)}`,
    escanear(P1, uuid(), credId(A.cam2), NORTE, 'IDA'),
    'cam2'
  )
  exigir((await resultadoDe(esc, 'cam2_res')) === 'NO_HABILITADO', 'Recorrido 7b: tras cambiar, NORTE no registra')
  await esc.ejecutar(`${comoServidor}\n${escanear(P1, uuid(), credId(A.cam2), SUR, 'IDA')}\nRESET ROLE;`, 'cam2_sur')
  exigir((await resultadoDe(esc, 'cam2_res_sur')) === 'REGISTRADO', 'Recorrido 7b: en SUR sí registra')
  console.log('OK CONCURRENCIA 7: el cambio de recorrido se serializa con el escaneo; la discrepancia con el recorrido declarado se deniega')
}

// ---------------------------------------------------------------
// 8. Anulación frente al escaneo
// ---------------------------------------------------------------
async function probarAnulacion(esc, otra, pids) {
  // Un REGISTRADO inicial para cada alumno.
  for (const k of [A.anu1, A.anu2]) {
    await esc.ejecutar(`${comoServidor}\n${escanear(P1, uuid(), credId(k), COMEDOR)}\nRESET ROLE;`, `anu_inicial_${k}`)
    exigir((await resultadoDe(esc, `anu_inicial_res_${k}`)) === 'REGISTRADO', 'Anulación: el REGISTRADO inicial debía existir')
  }
  const idEvento = (k) =>
    n(esc, `SELECT id FROM public.accesos_servicios WHERE alumno_id = '${alumnoId(k)}' AND resultado = 'REGISTRADO'`, `anu_id_${k}`)

  // 8a. La anulación retiene sus candados; el escaneo (misma clave) espera y, al confirmar, REGISTRA
  // (el cupo quedó liberado).
  const e1 = await idEvento(A.anu1)
  await otraPrimero(
    esc, otra, pids,
    `${comoDirectorLocal}\n${llamadas.anular(e1)}`,
    escanear(P1, uuid(), credId(A.anu1), COMEDOR),
    'anu1'
  )
  exigir((await resultadoDe(esc, 'anu1_res')) === 'REGISTRADO', 'Anulación 8a: anulado el anterior, el escaneo en espera debía REGISTRAR')
  exigir((await eventos(esc, alumnoId(A.anu1), 'REGISTRADO', 'anu1_ev')) === '2', 'Anulación 8a: la historia conserva los dos REGISTRADO')

  // 8b. El escaneo retiene (YA_REGISTRADO); la anulación espera y se completa después.
  const e2 = await idEvento(A.anu2)
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.anu2), COMEDOR),
    `${comoDirector}\n${tolerante(llamadas.anular(e2).replace(/;$/u, ''))}`,
    'anu2'
  )
  await otra.ejecutar('RESET ROLE;', 'anu2_reset')
  exigir((await resultadoDe(esc, 'anu2_res')) === 'YA_REGISTRADO', 'Anulación 8b: el escaneo que llegó antes de anular ve el acceso vigente')
  exigir((await resultadoDe(otra, 'anu2_res_otra')) === 'OK', 'Anulación 8b: la anulación se completa después')
  await esc.ejecutar(`${comoServidor}\n${escanear(P1, uuid(), credId(A.anu2), COMEDOR)}\nRESET ROLE;`, 'anu2_despues')
  exigir((await resultadoDe(esc, 'anu2_res_despues')) === 'REGISTRADO', 'Anulación 8b: tras anular, un nuevo escaneo REGISTRA')
  console.log('OK CONCURRENCIA 8: anulación y escaneo se serializan en los dos órdenes; un acceso anulado libera el cupo')
}

// ---------------------------------------------------------------
// 9. Doble escaneo, reintentos y ráfagas
// ---------------------------------------------------------------
async function probarDobleEscaneo(esc, otra, pids) {
  // 9a. Dos escaneos del mismo alumno (distintos intentos): el segundo espera y es YA_REGISTRADO.
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, uuid(), credId(A.doble), COMEDOR),
    `${comoServidor}\n${escanear(P2, uuid(), credId(A.doble), COMEDOR)}`,
    'doble'
  )
  await otra.ejecutar('RESET ROLE;', 'doble_reset')
  exigir((await resultadoDe(esc, 'doble_res_a')) === 'REGISTRADO', 'Doble 9a: el primero REGISTRA')
  exigir((await resultadoDe(otra, 'doble_res_b')) === 'YA_REGISTRADO', 'Doble 9a: el segundo es YA_REGISTRADO')
  exigir((await eventos(esc, alumnoId(A.doble), 'REGISTRADO', 'doble_ev')) === '1', 'Doble 9a: un solo REGISTRADO')

  // 9b. Reintento IDÉNTICO (mismo operador, mismo intento, mismos argumentos): una sola fila.
  const intento = uuid()
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, intento, credId(A.int1), COMEDOR),
    `${comoServidor}\n${escanear(P1, intento, credId(A.int1), COMEDOR)}`,
    'int1'
  )
  await otra.ejecutar('RESET ROLE;', 'int1_reset')
  exigir((await resultadoDe(esc, 'int1_res_a')) === 'REGISTRADO', 'Reintento 9b: el original REGISTRA')
  exigir((await resultadoDe(otra, 'int1_res_b')) === 'REGISTRADO', 'Reintento 9b: el reintento concurrente devuelve el resultado previo')
  exigir(
    (await n(esc, `SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE intento_id = '${intento}'`, 'int1_filas')) === '1',
    'Reintento 9b: el reintento no duplicó el evento'
  )

  // 9c. MISMO intento con OTRA credencial (otro alumno, otro candado): el índice único decide.
  const compartido = uuid()
  await escaneoPrimero(
    esc, otra, pids,
    escanear(P1, compartido, credId(A.int2a), COMEDOR),
    `${comoServidor}\n${escanear(P1, compartido, credId(A.int2b), COMEDOR)}`,
    'int2'
  )
  await otra.ejecutar('RESET ROLE;', 'int2_reset')
  exigir((await resultadoDe(esc, 'int2_res_a')) === 'REGISTRADO', 'Intento reutilizado 9c: el primero REGISTRA')
  exigir((await resultadoDe(otra, 'int2_res_b')) === 'INTENTO_REUTILIZADO', 'Intento reutilizado 9c: el segundo recibe INTENTO_REUTILIZADO')
  exigir((await eventos(esc, alumnoId(A.int2b), null, 'int2_ev_b')) === '0', 'Intento reutilizado 9c: no quedó evento del segundo')
  exigir(
    (await n(esc, `SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE intento_id = '${compartido}'`, 'int2_filas')) === '1',
    'Intento reutilizado 9c: una sola fila para el intento'
  )
  console.log('OK CONCURRENCIA 9: doble escaneo, reintento idéntico y reuso del intento se resuelven con una sola fila')
}

async function probarRafaga() {
  const sesiones = Array.from({ length: 6 }, (_, i) => new SesionPsql(`R${i}`, 'EPT65R'))
  const lectora = new SesionPsql('RL', 'EPT65R')
  try {
    await Promise.all(sesiones.map((s) => s.ejecutar(comoServidor, 'rol')))
    // Seis escaneos simultáneos del mismo alumno.
    await Promise.all(
      sesiones.map((s, i) => s.ejecutar(escanear(i % 2 ? P1 : P2, uuid(), credId(A.rafaga), COMEDOR), 'escanear'))
    )
    const resultados = await Promise.all(sesiones.map((s) => resultadoDe(s, 'resultado')))
    const registrados = resultados.filter((r) => r === 'REGISTRADO').length
    const repetidos = resultados.filter((r) => r === 'YA_REGISTRADO').length
    exigir(registrados === 1 && repetidos === 5, `Ráfaga: ${registrados} REGISTRADO y ${repetidos} YA_REGISTRADO (${resultados.join(',')})`)
    exigir(
      (await eventos(lectora, alumnoId(A.rafaga), 'REGISTRADO', 'rafaga_registrados')) === '1' &&
        (await eventos(lectora, alumnoId(A.rafaga), 'DENEGADO', 'rafaga_denegados')) === '5',
      'Ráfaga: la base debía quedar con 1 REGISTRADO y 5 DENEGADO'
    )

    // Límite atómico: 90 solicitudes simultáneas del mismo operador (tope 60).
    await sesiones[0].ejecutar(`RESET ROLE;\nDELETE FROM app_private.contadores_escaneo WHERE operador_perfil_id = '${P1}';\n${comoServidor}`, 'limpiar_contadores')
    const consumir = `DO $x$ DECLARE v BOOLEAN; BEGIN
        SELECT permitido INTO v FROM public.consumir_cupo_escaneo('${P1}');
        PERFORM pg_catalog.set_config('ept65.acumulado',
          COALESCE(pg_catalog.current_setting('ept65.acumulado', true), '') || CASE WHEN v THEN 'S' ELSE 'N' END, false);
      END $x$;`
    await Promise.all(
      sesiones.map(async (s) => {
        await s.ejecutar("SELECT pg_catalog.set_config('ept65.acumulado', '', false);", 'acumulado_reset')
        for (let i = 0; i < 15; i += 1) await s.ejecutar(consumir, `consumir_${i}`)
      })
    )
    const acumulados = await Promise.all(sesiones.map((s) => s.escalar(`pg_catalog.current_setting('ept65.acumulado', true)`, 'acumulado')))
    const permitidas = acumulados.join('').split('').filter((c) => c === 'S').length
    exigir(permitidas === 60, `Límite: se permitieron ${permitidas} solicitudes de 90; el tope atómico es 60`)
    exigir(
      (await n(lectora, `SELECT pg_catalog.count(*) FROM app_private.contadores_escaneo WHERE operador_perfil_id = '${P1}' AND tipo = 'SOLICITUD'`, 'contadores_finales')) === '60',
      'Límite: debían quedar exactamente 60 solicitudes contadas'
    )
    console.log('OK CONCURRENCIA 10: ráfaga de 6 escaneos deja un solo REGISTRADO; 90 solicitudes simultáneas permiten exactamente 60')
  } finally {
    await Promise.allSettled(sesiones.map((s) => s.ejecutar('RESET ROLE;\nROLLBACK;', 'limpieza')))
    await Promise.allSettled([...sesiones, lectora].map((s) => s.cerrar()))
  }
}

// ---------------------------------------------------------------
// 11. Estrés acotado: escaneos mezclados con cambios de estado
// ---------------------------------------------------------------
async function probarEstres() {
  const ESCANEADORES = 6
  const ITERACIONES = 12
  const MUTADORES = 3
  const MUTACIONES = 10
  const escaneadores = Array.from({ length: ESCANEADORES }, (_, i) => new SesionPsql(`S${i}`, 'EPT65S'))
  const mutadores = Array.from({ length: MUTADORES }, (_, i) => new SesionPsql(`M${i}`, 'EPT65M'))
  const objetivos = [
    [COMEDOR, null],
    [NORTE, 'IDA'],
    [NORTE, 'VUELTA'],
  ]
  const azar = (max) => Math.floor(Math.random() * max)
  const resultadosEscaneo = []
  const resultadosMutacion = []

  try {
    await Promise.all(escaneadores.map((s) => s.ejecutar(comoServidor, 'rol_escaneador')))
    await Promise.all(mutadores.map((s) => s.ejecutar(comoDirector, 'rol_mutador')))

    const trabajoEscaneador = async (s, indice) => {
      for (let i = 0; i < ITERACIONES; i += 1) {
        const alumno = ESTRES[azar(ESTRES.length)]
        const [servicio, sentido] = objetivos[azar(objetivos.length)]
        const operador = (indice + i) % 2 ? P1 : P2
        await s.ejecutar(escanear(operador, uuid(), credId(alumno), servicio, sentido), `escaneo_${i}`)
        resultadosEscaneo.push(await resultadoDe(s, `resultado_escaneo_${i}`))
      }
    }

    const trabajoMutador = async (s) => {
      for (let i = 0; i < MUTACIONES; i += 1) {
        const alumno = ESTRES[azar(ESTRES.length)]
        const tipo = azar(6)
        const llamada = [
          () => `public.reponer_credencial_qr((SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumnoId(alumno)}' AND estado = 'ACTIVA'), 'k1', 'Reposición del estrés')`,
          () => `public.inactivar_alumno('${alumnoId(alumno)}')`,
          () => `public.reactivar_alumno('${alumnoId(alumno)}', '${CURSO}')`,
          () => `public.cambiar_acceso_perfil('${alumnoId(alumno)}', 'HABILITADO', 'BLOQUEADO', 'Bloqueo del estrés')`,
          () => `public.cambiar_acceso_perfil('${alumnoId(alumno)}', 'BLOQUEADO', 'HABILITADO', 'Desbloqueo del estrés')`,
          () => `public.anular_acceso_servicio((SELECT id FROM public.accesos_servicios e WHERE e.alumno_id = '${alumnoId(alumno)}' AND e.resultado = 'REGISTRADO' AND NOT EXISTS (SELECT 1 FROM public.anulaciones_accesos_servicios n WHERE n.acceso_id = e.id) LIMIT 1), 'Anulación del estrés')`,
        ][tipo]()
        await s.ejecutar(tolerante(llamada), `mutacion_${i}`)
        resultadosMutacion.push(await resultadoDe(s, `resultado_mutacion_${i}`))
      }
    }

    await Promise.all([
      ...escaneadores.map((s, i) => trabajoEscaneador(s, i)),
      ...mutadores.map((s) => trabajoMutador(s)),
    ])

    // Sin deadlocks ni errores técnicos en los escaneos: SOLO los cuatro códigos cerrados.
    const permitidos = new Set(['REGISTRADO', 'YA_REGISTRADO', 'NO_HABILITADO'])
    const raros = resultadosEscaneo.filter((r) => !permitidos.has(r))
    exigir(raros.length === 0, `Estrés: respuestas de escaneo fuera del conjunto previsto: ${[...new Set(raros)].join(',')}`)
    const graves = resultadosMutacion.filter((r) => ['E:40P01', 'E:40001', 'E:XX000', 'E:57014', 'E:55P03'].includes(r))
    exigir(graves.length === 0, `Estrés: errores técnicos en cambios de estado: ${[...new Set(graves)].join(',')}`)

    // Sin escrituras parciales: cada respuesta quedó persistida exactamente una vez.
    const lectora = escaneadores[0]
    await lectora.ejecutar('RESET ROLE;', 'reset_lectora')
    const filtro = `alumno_id IN (${lista(ESTRES.map(alumnoId))})`
    const registrados = await n(lectora, `SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE ${filtro} AND resultado = 'REGISTRADO'`, 'filas_registradas')
    const yaRegistrados = await n(lectora, `SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE ${filtro} AND motivo_denegacion = 'YA_REGISTRADO'`, 'filas_ya')
    const otrosDenegados = await n(lectora, `SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE ${filtro} AND resultado = 'DENEGADO' AND motivo_denegacion <> 'YA_REGISTRADO'`, 'filas_otras')
    const cuenta = (c) => resultadosEscaneo.filter((r) => r === c).length
    exigir(
      Number(registrados) === cuenta('REGISTRADO') &&
        Number(yaRegistrados) === cuenta('YA_REGISTRADO') &&
        Number(otrosDenegados) === cuenta('NO_HABILITADO'),
      `Estrés: respuestas (${cuenta('REGISTRADO')}/${cuenta('YA_REGISTRADO')}/${cuenta('NO_HABILITADO')}) distintas de las filas (${registrados}/${yaRegistrados}/${otrosDenegados})`
    )

    // Invariante: ningún alumno tiene dos REGISTRADO vigentes para la misma clave y día.
    const duplicados = await n(
      lectora,
      `SELECT pg_catalog.count(*) FROM (
         SELECT e.alumno_id, e.servicio_id, e.sentido, e.dia_servicio
         FROM public.accesos_servicios e
         WHERE e.resultado = 'REGISTRADO'
           AND NOT EXISTS (SELECT 1 FROM public.anulaciones_accesos_servicios a WHERE a.acceso_id = e.id)
         GROUP BY 1, 2, 3, 4 HAVING pg_catalog.count(*) > 1) d`,
      'duplicados_vigentes'
    )
    exigir(duplicados === '0', `Estrés: ${duplicados} grupos con más de un REGISTRADO vigente`)
    exigir(
      (await n(lectora, `SELECT pg_catalog.count(DISTINCT intento_id) - pg_catalog.count(*) FROM public.accesos_servicios WHERE ${filtro}`, 'intentos_unicos')) === '0',
      'Estrés: hay intentos repetidos'
    )
    console.log(
      `OK CONCURRENCIA 11: estrés acotado (${ESCANEADORES}×${ITERACIONES} escaneos + ${MUTADORES}×${MUTACIONES} cambios de estado): ` +
        `${cuenta('REGISTRADO')} REGISTRADO, ${cuenta('YA_REGISTRADO')} YA_REGISTRADO, ${cuenta('NO_HABILITADO')} NO_HABILITADO; sin deadlocks ni escrituras parciales ni duplicados vigentes`
    )
  } finally {
    await Promise.allSettled([...escaneadores, ...mutadores].map((s) => s.ejecutar('RESET ROLE;\nROLLBACK;', 'limpieza')))
    await Promise.allSettled([...escaneadores, ...mutadores].map((s) => s.cerrar()))
  }
}

// ---------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------
const sesionA = new SesionPsql('A', 'EPT65')
const sesionB = new SesionPsql('B', 'EPT65')

try {
  const pids = {
    a: Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid_a')),
    b: Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid_b')),
  }
  // `escaneo` es siempre la sesión A y `otra` la B.
  const parejas = { escaneo: pids.a, otra: pids.b }

  await sesionA.ejecutar(limpiar, 'limpiar_previa')
  await sesionA.ejecutar(fixture(), 'preparar_fixture')
  const listos = await sesionA.escalar(
    `(SELECT pg_catalog.count(*) FROM public.alumnos WHERE perfil_id IN (${lista(TODOS_ALUMNOS)}) AND estado = 'ACTIVO')`,
    'verificar_fixture'
  )
  exigir(listos === String(TODOS.length), `El fixture dejó ${listos} alumnos ACTIVOS de ${TODOS.length}`)

  await probarRevocacion(sesionA, sesionB, parejas)
  await probarInactivacion(sesionA, sesionB, parejas)
  await probarBloqueoDelAlumno(sesionA, sesionB, parejas)
  await probarBloqueoDelOperador(sesionA, sesionB, parejas)
  await probarCancelacion(sesionA, sesionB, parejas)
  await probarServicio(sesionA, sesionB, parejas)
  await probarCambioDeRecorrido(sesionA, sesionB, parejas)
  await probarAnulacion(sesionA, sesionB, parejas)
  await probarDobleEscaneo(sesionA, sesionB, parejas)
  await probarRafaga()
  await probarEstres()

  await sesionA.ejecutar(limpiar, 'limpiar_final')
  const restos = await sesionA.escalar(
    `(SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE operador_perfil_id IN (${lista(OPERADORES)}))`,
    'restos'
  )
  exigir(restos === '0', 'La base debía quedar limpia')
  console.log('OK CONCURRENCIA: las carreras del registro de accesos quedan demostradas y la base queda limpia')
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('RESET ROLE;\nROLLBACK;', 'rollback'),
    sesionB.ejecutar('RESET ROLE;\nROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
