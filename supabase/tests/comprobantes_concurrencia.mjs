import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia de la carga de comprobantes (EPT-109) con conexiones PostgreSQL
 * reales.
 *
 * Contrato: `confirmar_carga_comprobante` toma, en este orden, (1) el perfil del
 * actor FOR SHARE, (2) el consultivo de la carga, (3) el vínculo padre-hijo FOR
 * SHARE, (4) el pago FOR UPDATE y (5) la carga FOR UPDATE. Una revocación del
 * permiso, un rechazo del pago o un número de operación repetido solo pueden
 * resolverse de dos modos seriales, y ninguno escribe con autorización vieja.
 *
 *   A, B   padres reales (rol `authenticated` + JWT) sobre el mismo hijo: preparan.
 *   S1,S2  el servidor (propietario): confirma, como service_role lo haría.
 *   R      propietario que revoca (UPDATE de perfil, DELETE de vínculo, rechazo).
 *   C      propietario: fixture, observador de esperas y verificador.
 *
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_ept109 \
 *       node supabase/tests/comprobantes_concurrencia.mjs
 *
 * Solo contra la base local descartable. Crea identidades propias y las borra al
 * final, también si falla. Nunca espera con tiempo: lanza, comprueba con
 * `pg_blocking_pids` quién espera a quién y libera en el orden correcto.
 */

const dockerHost = process.env.DOCKER_HOST ?? ''
if (dockerHost && !/^(npipe|unix):/iu.test(dockerHost)) {
  console.error('Se rechaza la ejecución: DOCKER_HOST apunta a un daemon remoto.')
  process.exit(1)
}

const ID = (n) => `c1091000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PADRE_A = ID(1)
const PADRE_B = ID(2)
const HIJO = ID(3)
const PAGO_A = ID(61)
const PAGO_B = ID(62)
const CARGA_A = ID(71)
const CARGA_B = ID(73)
const PERFILES = [PADRE_A, PADRE_B, HIJO]
const lista = (valores) => valores.map((v) => `'${v}'`).join(',')
const SHA = 'a'.repeat(64)
const TAMANO = 1234

const como = (id) =>
  `SET ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: 'authenticated' })}', false);`

const tolerante = (parametro, expresion) => `DO $prueba$
  DECLARE v TEXT;
  BEGIN
    BEGIN
      v := (${expresion});
      PERFORM pg_catalog.set_config('${parametro}', 'OK:' || COALESCE(v, ''), false);
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_catalog.set_config('${parametro}', SQLSTATE, false);
    END;
  END
  $prueba$;`

const confirmar = (usuario, carga, sha = SHA, tamano = TAMANO, tipo = 'image/jpeg') =>
  tolerante('ept109.res',
    `SELECT public.confirmar_carga_comprobante('${usuario}'::UUID, '${carga}'::UUID, '${sha}', ${tamano}::BIGINT, '${tipo}')::TEXT`)
const preparar = (clave, pago, numero) =>
  tolerante('ept109.res',
    `SELECT public.preparar_carga_comprobante('${clave}'::UUID, '${pago}'::UUID, '2026-10-14', '500.00', '${numero}', 'image/jpeg', ${TAMANO}::BIGINT)::TEXT`)

const sesiones = {
  a: new SesionPsql('A', 'EPT109'),
  b: new SesionPsql('B', 'EPT109'),
  s1: new SesionPsql('S1', 'EPT109'),
  s2: new SesionPsql('S2', 'EPT109'),
  r: new SesionPsql('R', 'EPT109'),
  c: new SesionPsql('C', 'EPT109'),
}
const { a, b, s1, s2, r, c } = sesiones
const pids = {}
let pendientes = []
const resultados = []

function seguir(promesa) {
  const marca = { terminada: false }
  const envuelta = promesa.then(
    (valor) => { marca.terminada = true; return valor },
    (error) => { marca.terminada = true; throw error }
  )
  envuelta.catch(() => {})
  pendientes.push(envuelta)
  return { promesa: envuelta, marca }
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

const parametro = (sesion, etiqueta) =>
  sesion.escalar(`pg_catalog.current_setting('ept109.res', true)`, etiqueta)

async function resultadoJson(sesion, etiqueta) {
  const obtenido = await parametro(sesion, etiqueta)
  exigir(obtenido.startsWith('OK:'), `${etiqueta}: la operación falló (${obtenido})`)
  return JSON.parse(obtenido.slice(3))
}

async function exigirError(sesion, etiqueta, sqlstate) {
  const obtenido = await parametro(sesion, etiqueta)
  exigir(obtenido === sqlstate, `${etiqueta}: se esperaba ${sqlstate} y se obtuvo ${obtenido}`)
}

async function exigirBloqueo(bloqueador, bloqueado, etiqueta) {
  try {
    await esperarBloqueo(c, pids[bloqueador], pids[bloqueado])
  } catch {
    throw new Error(`${etiqueta}: ${bloqueado} no quedó esperando a ${bloqueador}`)
  }
}

const cuenta = (consulta) => c.escalar(`(SELECT pg_catalog.count(*) ${consulta})`, 'cuenta')
const comprobantes = (pago) => cuenta(`FROM public.comprobantes_pago WHERE pago_id = '${pago}'`)
const numeroPago = (pago) =>
  c.escalar(`(SELECT COALESCE(numero_operacion, '-') FROM public.pagos WHERE id = '${pago}')`, 'numero_pago')

/** Inserta una carga PREPARADA con datos propios (sin pasar por `preparar`). */
const carga = (id, pago, padre, numero) => `INSERT INTO public.cargas_comprobante
  (id, padre_id, pago_id, clave_carga, fecha_transferencia, importe_informado, numero_operacion,
   tipo_mime_declarado, tamano_declarado, huella_solicitud, ruta_temporal)
  VALUES ('${id}', '${padre}', '${pago}', '${id}', '2026-10-14', 500.00, '${numero}',
    'image/jpeg', ${TAMANO}, '${'b'.repeat(64)}', '${pago}/${id}');`

async function restaurar() {
  await Promise.allSettled([a, b, s1, s2, r].map((s) => s.ejecutar('ROLLBACK;', 'restaurar_rollback')))
  await c.ejecutar(
    `RESET ROLE; BEGIN;
     DELETE FROM public.comprobantes_pago WHERE pago_id IN ('${PAGO_A}', '${PAGO_B}');
     DELETE FROM public.cargas_comprobante WHERE pago_id IN ('${PAGO_A}', '${PAGO_B}');
     UPDATE public.pagos
        SET estado = 'PENDIENTE_VERIFICACION', verificado_por = NULL, verificado_en = NULL,
            motivo_rechazo = NULL, fecha_transferencia = NULL, importe_informado = NULL,
            numero_operacion = NULL
      WHERE id IN ('${PAGO_A}', '${PAGO_B}');
     UPDATE public.perfiles
        SET estado_acceso = 'HABILITADO',
            rol_id = (SELECT id FROM public.roles WHERE nombre = 'PADRE')
      WHERE id IN ('${PADRE_A}', '${PADRE_B}');
     INSERT INTO public.padres_hijos (padre_id, hijo_id)
       VALUES ('${PADRE_A}', '${HIJO}'), ('${PADRE_B}', '${HIJO}')
       ON CONFLICT DO NOTHING;
     COMMIT;`,
    'restaurar'
  )
  await a.ejecutar(`RESET ROLE; ${como(PADRE_A)}`, 'identidad_a')
  await b.ejecutar(`RESET ROLE; ${como(PADRE_A)}`, 'identidad_b')
}

async function recuperar() {
  await Promise.allSettled([c.ejecutar('ROLLBACK;', 'recuperar_c')])
  await Promise.allSettled([a, b, s1, s2, r].map((s) => s.ejecutar('ROLLBACK;', 'recuperar')))
  await Promise.allSettled(pendientes)
  pendientes = []
}

async function caso(nombre, funcion) {
  try {
    await recuperar()
    await funcion()
    resultados.push({ nombre, ok: true })
    console.log(`OK  ${nombre}`)
  } catch (error) {
    resultados.push({ nombre, ok: false })
    console.error(`FALLO  ${nombre}: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------------
// Preparar: el mismo intento en dos conexiones (doble toque).
// ---------------------------------------------------------------------------------
async function prepararMismoIntento() {
  await restaurar()
  const CLAVE = ID(900)
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(preparar(CLAVE, PAGO_A, 'OP-DOBLE'), 'a_preparar')
  const primero = await resultadoJson(a, 'A prepara')
  await b.ejecutar('BEGIN;', 'b_begin')
  const llamadaB = seguir(b.ejecutar(preparar(CLAVE, PAGO_A, 'OP-DOBLE'), 'b_preparar'))
  await exigirBloqueo('a', 'b', 'el reintento debía esperar al intento en curso')
  exigir(!llamadaB.marca.terminada, 'el reintento terminó antes del COMMIT')
  await a.ejecutar('COMMIT;', 'a_commit')
  await llamadaB.promesa
  const segundo = await resultadoJson(b, 'reintento')
  await b.ejecutar('COMMIT;', 'b_commit')
  exigir(primero.carga_id === segundo.carga_id, 'el reintento devolvió otra carga')
  exigir(primero.repetido === false && segundo.repetido === true, 'repetido mal informado')
  exigir((await cuenta(`FROM public.cargas_comprobante WHERE pago_id = '${PAGO_A}'`)) === '1', 'se duplicó la carga')
}

// ---------------------------------------------------------------------------------
// Confirmar la MISMA carga dos veces a la vez.
// ---------------------------------------------------------------------------------
async function confirmarMismaCarga() {
  await restaurar()
  await c.ejecutar(carga(CARGA_A, PAGO_A, PADRE_A, 'OP-MISMA'), 'carga')
  await s1.ejecutar('BEGIN;', 's1_begin')
  await s1.ejecutar(confirmar(PADRE_A, CARGA_A), 's1_confirma')
  const primero = await resultadoJson(s1, 'S1 confirma')
  await s2.ejecutar('BEGIN;', 's2_begin')
  const llamada = seguir(s2.ejecutar(confirmar(PADRE_A, CARGA_A), 's2_confirma'))
  await exigirBloqueo('s1', 's2', 'la segunda confirmación debía esperar a la primera')
  exigir(!llamada.marca.terminada, 'la segunda confirmación terminó antes del COMMIT')
  await s1.ejecutar('COMMIT;', 's1_commit')
  await llamada.promesa
  const segundo = await resultadoJson(s2, 'S2 repite')
  await s2.ejecutar('COMMIT;', 's2_commit')
  exigir(primero.estado === 'CONFIRMADA' && segundo.estado === 'CONFIRMADA', 'estados distintos de CONFIRMADA')
  exigir(primero.repetido === false && segundo.repetido === true, 'repetido mal informado')
  exigir((await comprobantes(PAGO_A)) === '1', 'se duplicó el comprobante')
}

async function confirmarMismaCargaOtroContenido() {
  await restaurar()
  await c.ejecutar(carga(CARGA_A, PAGO_A, PADRE_A, 'OP-OTRO'), 'carga')
  await s1.ejecutar(confirmar(PADRE_A, CARGA_A), 's1')
  await resultadoJson(s1, 'primera')
  await s2.ejecutar(confirmar(PADRE_A, CARGA_A, 'c'.repeat(64)), 's2')
  await exigirError(s2, 'otro hash sobre una carga confirmada', 'P6864')
  exigir((await comprobantes(PAGO_A)) === '1', 'cambió la cantidad de comprobantes')
}

// ---------------------------------------------------------------------------------
// Dos pagos, mismo número de operación: el índice único decide.
// ---------------------------------------------------------------------------------
async function mismoNumero(desenlace) {
  await restaurar()
  await c.ejecutar(`${carga(CARGA_A, PAGO_A, PADRE_A, 'OP-CARRERA')} ${carga(CARGA_B, PAGO_B, PADRE_B, 'OP-CARRERA')}`, 'cargas')
  await s1.ejecutar('BEGIN;', 's1_begin')
  await s1.ejecutar(confirmar(PADRE_A, CARGA_A), 's1_confirma')
  await resultadoJson(s1, 'S1 confirma')
  await s2.ejecutar('BEGIN;', 's2_begin')
  const llamada = seguir(s2.ejecutar(confirmar(PADRE_B, CARGA_B), 's2_confirma'))
  await exigirBloqueo('s1', 's2', 'el segundo pago debía esperar al índice único del primero')
  exigir(!llamada.marca.terminada, 'el segundo terminó antes del desenlace del primero')
  await s1.ejecutar(`${desenlace};`, 's1_cierra')
  await llamada.promesa
  const resultado = await resultadoJson(s2, 'S2 tras el desenlace')
  await s2.ejecutar('COMMIT;', 's2_commit')
  if (desenlace === 'COMMIT') {
    exigir(resultado.estado === 'DESCARTADA' && resultado.motivo_descarte === 'OPERACION_DUPLICADA',
      `el perdedor debía quedar descartado por duplicado (fue ${resultado.estado}/${resultado.motivo_descarte})`)
    exigir((await comprobantes(PAGO_B)) === '0' && (await numeroPago(PAGO_B)) === '-',
      'el perdedor dejó comprobante o número')
    exigir((await numeroPago(PAGO_A)) === 'OP-CARRERA', 'el ganador perdió su número')
  } else {
    exigir(resultado.estado === 'CONFIRMADA', 'tras ROLLBACK del primero el número queda libre para el segundo')
    exigir((await comprobantes(PAGO_A)) === '0', 'el rollback dejó un comprobante')
  }
}

// ---------------------------------------------------------------------------------
// Revocación del permiso durante la confirmación: dos órdenes seriales.
// ---------------------------------------------------------------------------------
const REVOCACIONES = {
  'bloqueo de la cuenta': {
    sql: `UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${PADRE_A}';`,
    rechazo: '42501',
  },
  'cambio de rol': {
    sql: `UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL') WHERE id = '${PADRE_A}';`,
    rechazo: '42501',
  },
  'vínculo revocado': {
    sql: `DELETE FROM public.padres_hijos WHERE padre_id = '${PADRE_A}' AND hijo_id = '${HIJO}';`,
    descarte: 'VINCULO_REVOCADO',
  },
  'pago rechazado': {
    sql: `UPDATE public.pagos SET estado = 'RECHAZADO', verificado_por = '${PADRE_B}', verificado_en = NOW(),
          motivo_rechazo = 'prueba' WHERE id = '${PAGO_A}';`,
    descarte: 'PAGO_NO_PENDIENTE',
  },
}

/** Orden 1: la revocación está en vuelo; la confirmación espera y luego no escribe. */
async function revocacionEnVuelo(nombre) {
  const rev = REVOCACIONES[nombre]
  await restaurar()
  await c.ejecutar(carga(CARGA_A, PAGO_A, PADRE_A, 'OP-REV'), 'carga')
  await r.ejecutar(`BEGIN; ${rev.sql}`, 'r_revoca')
  await s1.ejecutar('BEGIN;', 's1_begin')
  const llamada = seguir(s1.ejecutar(confirmar(PADRE_A, CARGA_A), 's1_confirma_espera'))
  await exigirBloqueo('r', 's1', `${nombre}: la confirmación debía esperar la revocación en vuelo`)
  exigir(!llamada.marca.terminada, `${nombre}: la confirmación no esperó`)
  await r.ejecutar('COMMIT;', 'r_commit')
  await llamada.promesa
  if (rev.rechazo) {
    await exigirError(s1, `${nombre}: confirmación tras la revocación`, rev.rechazo)
  } else {
    const j = await resultadoJson(s1, `${nombre}: confirmación tras la revocación`)
    exigir(j.estado === 'DESCARTADA' && j.motivo_descarte === rev.descarte,
      `${nombre}: se esperaba DESCARTADA/${rev.descarte} y se obtuvo ${j.estado}/${j.motivo_descarte}`)
  }
  await s1.ejecutar('COMMIT;', 's1_commit')
  exigir((await comprobantes(PAGO_A)) === '0', `${nombre}: quedó un comprobante con autorización vieja`)
  exigir((await numeroPago(PAGO_A)) === '-', `${nombre}: el pago recibió datos de transferencia`)
}

/** Orden 2: la confirmación toma la guarda primero; la revocación espera a su COMMIT. */
async function confirmacionPrimero(nombre, cierre) {
  const rev = REVOCACIONES[nombre]
  if (nombre === 'pago rechazado') return
  await restaurar()
  await c.ejecutar(carga(CARGA_A, PAGO_A, PADRE_A, 'OP-REV2'), 'carga')
  await s1.ejecutar('BEGIN;', 's1_begin')
  await s1.ejecutar(confirmar(PADRE_A, CARGA_A), 's1_confirma')
  await resultadoJson(s1, 'S1 confirma')
  await r.ejecutar('BEGIN;', 'r_begin')
  const llamada = seguir(r.ejecutar(rev.sql, 'r_revoca_espera'))
  await exigirBloqueo('s1', 'r', `${nombre}: la revocación debía esperar a la confirmación`)
  exigir(!llamada.marca.terminada, `${nombre}: la revocación no esperó`)
  await s1.ejecutar(`${cierre};`, 's1_cierra')
  await llamada.promesa
  await r.ejecutar('COMMIT;', 'r_commit')
  exigir((await comprobantes(PAGO_A)) === (cierre === 'COMMIT' ? '1' : '0'),
    `${nombre}: el comprobante no refleja el desenlace de la confirmación`)
}

/** El pago se rechaza DESPUÉS de confirmarse el comprobante: el comprobante queda (historial). */
async function rechazoPosterior() {
  await restaurar()
  await c.ejecutar(carga(CARGA_A, PAGO_A, PADRE_A, 'OP-POST'), 'carga')
  await s1.ejecutar(confirmar(PADRE_A, CARGA_A), 's1')
  await resultadoJson(s1, 'confirma')
  await r.ejecutar(REVOCACIONES['pago rechazado'].sql, 'r_rechaza')
  exigir((await comprobantes(PAGO_A)) === '1', 'el rechazo borró el comprobante del historial')
}

async function limpiarTodo() {
  await c.ejecutar(
    `RESET ROLE; BEGIN;
     DELETE FROM public.comprobantes_pago WHERE pago_id IN ('${PAGO_A}', '${PAGO_B}');
     DELETE FROM public.cargas_comprobante WHERE pago_id IN ('${PAGO_A}', '${PAGO_B}');
     DELETE FROM public.pagos WHERE id IN ('${PAGO_A}', '${PAGO_B}');
     DELETE FROM public.padres_hijos WHERE hijo_id = '${HIJO}';
     DELETE FROM public.alumnos WHERE perfil_id = '${HIJO}';
     ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
     DELETE FROM public.perfiles_historial
       WHERE perfil_id IN (${lista(PERFILES)}) OR actor_perfil_id IN (${lista(PERFILES)});
     ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
     DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
     COMMIT;`,
    'limpiar_todo'
  )
}

try {
  const origen = await c.escalar(`COALESCE(pg_catalog.host(pg_catalog.inet_server_addr()), 'socket-local')`, 'origen')
  exigir(['socket-local', '127.0.0.1', '::1'].includes(origen),
    `Se rechaza la ejecución: la conexión no es local (${origen}).`)
  exigir((await c.escalar(
    `EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proname = 'confirmar_carga_comprobante' AND p.pronamespace = 'public'::REGNAMESPACE)`,
    'migracion_109')) === 'true', 'La base local no tiene aplicada la migración EPT-109.')
  for (const [clave, sesion] of Object.entries(sesiones)) {
    pids[clave] = Number(await sesion.escalar('pg_catalog.pg_backend_pid()', `pid_${clave}`))
  }

  await limpiarTodo()
  await c.ejecutar(
    `BEGIN;
     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::UUID, v.id::UUID, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${PADRE_A}', 'PADRE', 'Padre A EPT109', '99109001', NULL),
       ('${PADRE_B}', 'PADRE', 'Padre B EPT109', '99109002', NULL),
       ('${HIJO}', 'ESTUDIANTE', 'Hijo EPT109', '99109003', 'EPT109-1')
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;
     INSERT INTO public.padres_hijos (padre_id, hijo_id)
       VALUES ('${PADRE_A}', '${HIJO}'), ('${PADRE_B}', '${HIJO}');
     INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado) VALUES
       ('${PAGO_A}', '${PADRE_A}', '${HIJO}', 500.00),
       ('${PAGO_B}', '${PADRE_B}', '${HIJO}', 500.00);
     COMMIT;`,
    'fixture'
  )

  await caso('preparar: el mismo intento en dos conexiones (doble toque) crea una sola carga', prepararMismoIntento)
  await caso('confirmar la misma carga a la vez: la segunda espera y ve el mismo resultado', confirmarMismaCarga)
  await caso('confirmar una carga ya confirmada con otro hash: conflicto explícito', confirmarMismaCargaOtroContenido)
  await caso('mismo número en dos pagos · el primero confirma: el segundo queda descartado, sin excepción', () => mismoNumero('COMMIT'))
  await caso('mismo número en dos pagos · el primero revierte: el número queda libre', () => mismoNumero('ROLLBACK'))

  for (const nombre of Object.keys(REVOCACIONES)) {
    await caso(`orden 1, revocación en vuelo (la confirmación espera) · ${nombre}`, () => revocacionEnVuelo(nombre))
    if (nombre !== 'pago rechazado') {
      await caso(`orden 2, la confirmación toma la guarda y la revocación espera · ${nombre} · COMMIT`, () => confirmacionPrimero(nombre, 'COMMIT'))
      await caso(`orden 2, la confirmación toma la guarda y la revocación espera · ${nombre} · ROLLBACK`, () => confirmacionPrimero(nombre, 'ROLLBACK'))
    }
  }
  await caso('un rechazo posterior del pago no borra el comprobante del historial', rechazoPosterior)
} finally {
  await recuperar()
  await limpiarTodo().catch((error) => console.error(`La limpieza falló: ${error.message}`))
  const restos = await c
    .escalar(
      `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)}))
       + (SELECT pg_catalog.count(*) FROM public.pagos WHERE alumno_id = '${HIJO}')
       + (SELECT pg_catalog.count(*) FROM public.cargas_comprobante WHERE pago_id IN ('${PAGO_A}', '${PAGO_B}'))`,
      'restos'
    )
    .catch(() => '?')
  console.log(`Restos de fixture: ${restos}`)
  await Promise.allSettled(Object.values(sesiones).map((s) => s.cerrar()))
}

const fallas = resultados.filter((x) => !x.ok)
console.log(`\n${resultados.length - fallas.length}/${resultados.length} casos correctos, ${fallas.length} con falla`)
if (fallas.length > 0) process.exit(1)
