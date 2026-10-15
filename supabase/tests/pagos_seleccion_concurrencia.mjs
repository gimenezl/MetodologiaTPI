import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia del registro de pagos (EPT-108) con conexiones PostgreSQL reales.
 *
 * Contrato: `registrar_pago` toma, en este orden, (1) el perfil del actor FOR SHARE,
 * (2) el consultivo del intento, (3) el vínculo padre-hijo FOR SHARE y (4) los ítems
 * FOR UPDATE ordenados por id. Solo existen dos órdenes seriales entre un registro y
 * la revocación del permiso, y ninguna pareja de selecciones puede formar un ciclo.
 *
 *   A, B  padres reales (rol `authenticated` + JWT) sobre el mismo hijo.
 *   R     propietario que revoca (UPDATE de perfil o DELETE del vínculo).
 *   C     propietario: fixture, bloqueadores y observador de esperas.
 *
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_ept108 \
 *       node supabase/tests/pagos_seleccion_concurrencia.mjs
 *
 * Solo contra la base local descartable. Crea identidades propias y las borra al
 * final, también si falla. Nunca espera una revocación antes de liberar la fila que
 * retiene la guarda: lanza, comprueba con `pg_blocking_pids` quién espera a quién y
 * libera en el orden correcto.
 */

const dockerHost = process.env.DOCKER_HOST ?? ''
if (dockerHost && !/^(npipe|unix):/iu.test(dockerHost)) {
  console.error('Se rechaza la ejecución: DOCKER_HOST apunta a un daemon remoto.')
  process.exit(1)
}

const ID = (n) => `c1081000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PADRE_A = ID(1)
const PADRE_B = ID(2)
const HIJO = ID(3)
const NIVEL = 'Nivel EPT108 concurrencia'
const CURSO = ID(11)
const MATRICULA = ID(21)
const TARIFA = ID(31)
const FACTURAS = [ID(41), ID(42), ID(43), ID(44)]
const ITEMS = [ID(51), ID(52), ID(53), ID(54)]
const [I1, I2, I3, I4] = ITEMS
const PERFILES = [PADRE_A, PADRE_B, HIJO]
const lista = (valores) => valores.map((v) => `'${v}'`).join(',')
const CLAVE = (n) => ID(9000 + n)
const CENTAVOS_ITEM = 10000 // ARS 100,00 por ítem

const como = (id) =>
  `SET ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: 'authenticated' })}', false);`

/** Ejecuta una expresión de texto y deja su desenlace (OK:<valor> o SQLSTATE) en un parámetro de sesión. */
const tolerante = (parametro, expresion) => `DO $prueba$
  DECLARE v TEXT;
  BEGIN
    BEGIN
      v := (${expresion});
      PERFORM pg_catalog.set_config('${parametro}', 'OK:' || COALESCE(v, ''), false);
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_catalog.set_config('${parametro}', SQLSTATE, false);
      PERFORM pg_catalog.set_config('${parametro}_msg', SQLERRM, false);
    END;
  END
  $prueba$;`

const arr = (ids) => `ARRAY[${ids.map((i) => `'${i}'`).join(',')}]::UUID[]`
const registrar = (clave, ids, total) =>
  tolerante('ept108.res', `SELECT public.registrar_pago('${clave}'::UUID, ${arr(ids)}, ${total}::BIGINT)::TEXT`)
const cotizar = (ids) => tolerante('ept108.res', `SELECT public.cotizar_pago(${arr(ids)})::TEXT`)
const consultar = (clave) =>
  tolerante('ept108.res', `SELECT public.consultar_intento_pago('${clave}'::UUID)::TEXT`)

const sesiones = {
  a: new SesionPsql('A', 'EPT108'),
  b: new SesionPsql('B', 'EPT108'),
  r: new SesionPsql('R', 'EPT108'),
  c: new SesionPsql('C', 'EPT108'),
}
const { a, b, r, c } = sesiones
const pids = {}
let pendientes = []

function seguir(promesa) {
  const marca = { terminada: false }
  const envuelta = promesa.then(
    (valor) => {
      marca.terminada = true
      return valor
    },
    (error) => {
      marca.terminada = true
      throw error
    }
  )
  envuelta.catch(() => {})
  pendientes.push(envuelta)
  return { promesa: envuelta, marca }
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

const parametro = (sesion, nombre, etiqueta) =>
  sesion.escalar(`pg_catalog.current_setting('${nombre}', true)`, etiqueta)

async function exigirResultado(sesion, etiqueta, esperado) {
  const obtenido = await parametro(sesion, 'ept108.res', etiqueta)
  const coincide = esperado === 'OK' ? obtenido.startsWith('OK:') : obtenido === esperado
  exigir(coincide, `${etiqueta}: se esperaba ${esperado} y se obtuvo ${obtenido}`)
}

async function resultadoJson(sesion, etiqueta) {
  const obtenido = await parametro(sesion, 'ept108.res', etiqueta)
  exigir(obtenido.startsWith('OK:'), `${etiqueta}: la operación falló (${obtenido})`)
  return JSON.parse(obtenido.slice(3))
}

async function exigirBloqueo(bloqueador, bloqueado, etiqueta) {
  try {
    await esperarBloqueo(c, pids[bloqueador], pids[bloqueado])
  } catch {
    throw new Error(`${etiqueta}: ${bloqueado} no quedó esperando a ${bloqueador}`)
  }
}

const cuentaPagos = () =>
  c.escalar(`(SELECT pg_catalog.count(*) FROM public.pagos WHERE alumno_id = '${HIJO}')`, 'pagos')
const cuentaImputaciones = () =>
  c.escalar(`(SELECT pg_catalog.count(*) FROM public.imputaciones_pago WHERE alumno_id = '${HIJO}')`, 'imputaciones')
const estadoItems = () =>
  c.escalar(
    `(SELECT pg_catalog.string_agg(estado_pago::TEXT, ',' ORDER BY id) FROM public.items_factura WHERE alumno_id = '${HIJO}')`,
    'estado_items'
  )
const estadoPerfil = (id) =>
  c.escalar(
    `(SELECT p.estado_acceso || '/' || r.nombre FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id WHERE p.id = '${id}')`,
    'perfil'
  )
const vinculo = (id) =>
  c.escalar(
    `(SELECT pg_catalog.count(*) FROM public.padres_hijos WHERE padre_id = '${id}' AND hijo_id = '${HIJO}')`,
    'vinculo'
  )

/** Deja el fixture en su estado inicial; se ejecuta con todas las transacciones cerradas. */
async function restaurar() {
  await c.ejecutar(
    `RESET ROLE; BEGIN;
     DELETE FROM public.imputaciones_pago WHERE alumno_id = '${HIJO}';
     DELETE FROM public.pagos WHERE alumno_id = '${HIJO}';
     UPDATE public.items_factura SET estado_pago = 'PENDIENTE' WHERE alumno_id = '${HIJO}';
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
  await b.ejecutar(`RESET ROLE; ${como(PADRE_B)}`, 'identidad_b')
}

async function recuperar() {
  await Promise.allSettled([c.ejecutar('ROLLBACK;', 'recuperar_c')])
  await Promise.allSettled([a, b, r].map((s) => s.ejecutar('ROLLBACK;', 'recuperar')))
  await Promise.allSettled(pendientes)
  pendientes = []
  await Promise.allSettled([c.ejecutar('ROLLBACK;', 'recuperar_c2')])
}

// ---------------------------------------------------------------------------------
// Reserva: el segundo registro espera al primero y pierde con un error explícito.
// ---------------------------------------------------------------------------------
async function dosRegistros({ itemsA, itemsB, claveB = CLAVE(2), totalA, totalB, esperadoB, pagosFinal, estadoFinal }) {
  await restaurar()
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(registrar(CLAVE(1), itemsA, totalA), 'a_registrar')
  await exigirResultado(a, 'A registra', 'OK')
  await b.ejecutar('BEGIN;', 'b_begin')
  const llamadaB = seguir(b.ejecutar(registrar(claveB, itemsB, totalB), 'b_registrar'))
  await exigirBloqueo('a', 'b', 'B debía esperar los ítems que retiene A')
  exigir(!llamadaB.marca.terminada, 'B terminó antes de que A confirmara')
  await a.ejecutar('COMMIT;', 'a_commit')
  await llamadaB.promesa
  await exigirResultado(b, 'B tras el COMMIT de A', esperadoB)
  await b.ejecutar('ROLLBACK;', 'b_rollback')
  exigir((await cuentaPagos()) === String(pagosFinal), `pagos finales distintos de ${pagosFinal}`)
  exigir((await estadoItems()) === estadoFinal, `estado de ítems distinto de ${estadoFinal}`)
}

async function sinSolape() {
  await restaurar()
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_registrar')
  await exigirResultado(a, 'A registra [i1]', 'OK')
  await b.ejecutar('BEGIN;', 'b_begin')
  // B no debe esperar: la llamada vuelve aunque A no haya confirmado.
  await b.ejecutar(registrar(CLAVE(2), [I2], CENTAVOS_ITEM), 'b_registrar')
  await exigirResultado(b, 'B registra [i2] sin esperar', 'OK')
  await a.ejecutar('COMMIT;', 'a_commit')
  await b.ejecutar('COMMIT;', 'b_commit')
  exigir((await cuentaPagos()) === '2', 'se esperaban 2 pagos')
  exigir((await estadoItems()) === 'EN_VERIFICACION,EN_VERIFICACION,PENDIENTE,PENDIENTE', 'estado inesperado')
}

// ---------------------------------------------------------------------------------
// Idempotencia ante concurrencia y pérdida de respuesta.
// ---------------------------------------------------------------------------------
async function mismoIntentoConcurrente() {
  await restaurar()
  // B es el mismo padre en otra conexión (doble clic, reintento del cliente).
  await b.ejecutar(`RESET ROLE; ${como(PADRE_A)}`, 'b_como_a')
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(registrar(CLAVE(1), [I1, I2], CENTAVOS_ITEM * 2), 'a_registrar')
  const primero = await resultadoJson(a, 'A registra')
  await b.ejecutar('BEGIN;', 'b_begin')
  const llamadaB = seguir(b.ejecutar(registrar(CLAVE(1), [I2, I1], CENTAVOS_ITEM * 2), 'b_registrar'))
  await exigirBloqueo('a', 'b', 'el reintento debía esperar al intento en curso')
  exigir(!llamadaB.marca.terminada, 'el reintento terminó antes del COMMIT')
  await a.ejecutar('COMMIT;', 'a_commit')
  await llamadaB.promesa
  const segundo = await resultadoJson(b, 'reintento')
  await b.ejecutar('COMMIT;', 'b_commit')
  exigir(primero.pago_id === segundo.pago_id, 'el reintento devolvió otro pago')
  exigir(primero.repetido === false && segundo.repetido === true, 'repetido mal informado')
  exigir((await cuentaPagos()) === '1' && (await cuentaImputaciones()) === '2', 'se duplicó el pago o sus imputaciones')
  await b.ejecutar(`RESET ROLE; ${como(PADRE_B)}`, 'b_restituido')
}

async function respuestaPerdidaTrasCommit() {
  await restaurar()
  await a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_registrar_autocommit')
  const original = await resultadoJson(a, 'registro confirmado')
  // El cliente perdió la respuesta: consulta el intento por una conexión nueva.
  await a.ejecutar(consultar(CLAVE(1)), 'a_consultar')
  const consulta = await resultadoJson(a, 'consulta')
  exigir(consulta.registrado === true && consulta.pago_id === original.pago_id, 'la consulta no recuperó el pago')
  await a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_reintento')
  const reintento = await resultadoJson(a, 'reintento')
  exigir(reintento.repetido === true && reintento.pago_id === original.pago_id, 'el reintento no fue idempotente')
  exigir((await cuentaPagos()) === '1', 'se duplicó el pago')
}

async function respuestaPerdidaAntesDelCommit() {
  await restaurar()
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_registrar')
  await exigirResultado(a, 'A registra', 'OK')
  await a.ejecutar('ROLLBACK;', 'a_rollback') // la transacción no llegó a confirmarse
  await a.ejecutar(consultar(CLAVE(1)), 'a_consultar')
  const consulta = await resultadoJson(a, 'consulta')
  exigir(consulta.registrado === false, 'un intento no confirmado figura como registrado')
  exigir((await estadoItems()) === 'PENDIENTE,PENDIENTE,PENDIENTE,PENDIENTE', 'quedó una reserva sin pago')
  await a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_reintento')
  await exigirResultado(a, 'reintento posterior', 'OK')
}

/**
 * La consulta de un intento que todavía se está registrando espera su desenlace: nunca afirma
 * «no registrado» sobre un intento en vuelo (un 504 del gateway deja al cliente en esa situación).
 */
async function consultaEsperaAlRegistroEnCurso() {
  await restaurar()
  // B es el mismo padre en otra conexión: consulta lo que A está registrando.
  await b.ejecutar(`RESET ROLE; ${como(PADRE_A)}`, 'b_como_a')
  await c.ejecutar(`BEGIN; SELECT 1 FROM public.items_factura WHERE id = '${I1}' FOR UPDATE;`, 'c_retiene_item')
  const registro = seguir(a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_registrar_en_curso'))
  await exigirBloqueo('c', 'a', 'el registro debía esperar el ítem retenido')
  const consulta = seguir(b.ejecutar(consultar(CLAVE(1)), 'b_consulta'))
  await exigirBloqueo('a', 'b', 'la consulta debía esperar al registro en curso')
  exigir(!consulta.marca.terminada && !registro.marca.terminada, 'algo terminó antes de liberar al bloqueador')
  await c.ejecutar('ROLLBACK;', 'c_libera')
  await registro.promesa
  await exigirResultado(a, 'registro liberado', 'OK')
  await consulta.promesa
  const visto = await resultadoJson(b, 'consulta tras el registro')
  exigir(visto.registrado === true, 'la consulta afirmó «no registrado» sobre un intento que terminó registrándose')
  exigir((await cuentaPagos()) === '1', 'pagos distintos de 1')
  await b.ejecutar(`RESET ROLE; ${como(PADRE_B)}`, 'b_restituido')
}

async function cotizacionDesactualizada() {
  await restaurar()
  await a.ejecutar(cotizar([I1, I2]), 'a_cotizar')
  const cotizacion = await resultadoJson(a, 'cotización')
  exigir(cotizacion.total_centavos === CENTAVOS_ITEM * 2, 'total cotizado inesperado')
  await b.ejecutar(registrar(CLAVE(2), [I2], CENTAVOS_ITEM), 'b_registra_i2')
  await exigirResultado(b, 'B reserva i2 antes que A', 'OK')
  await a.ejecutar(registrar(CLAVE(1), [I1, I2], cotizacion.total_centavos), 'a_registrar')
  await exigirResultado(a, 'A con la cotización vieja', 'P6853')
  exigir((await estadoItems()) === 'PENDIENTE,EN_VERIFICACION,PENDIENTE,PENDIENTE', 'A reservó parte de la selección')
  exigir((await cuentaPagos()) === '1', 'se registró un pago de más')
}

// ---------------------------------------------------------------------------------
// Revocación del permiso: dos órdenes seriales, sin escritura con autorización vieja.
// ---------------------------------------------------------------------------------
const REVOCACIONES = {
  'bloqueo de la cuenta': {
    sql: `UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${PADRE_A}';`,
    final: async () => (await estadoPerfil(PADRE_A)) === 'BLOQUEADO/PADRE',
    rechazo: '42501',
  },
  'cambio de rol': {
    sql: `UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL') WHERE id = '${PADRE_A}';`,
    final: async () => (await estadoPerfil(PADRE_A)) === 'HABILITADO/PERSONAL',
    rechazo: '42501',
  },
  'vínculo revocado': {
    sql: `DELETE FROM public.padres_hijos WHERE padre_id = '${PADRE_A}' AND hijo_id = '${HIJO}';`,
    final: async () => (await vinculo(PADRE_A)) === '0',
    rechazo: 'P6851',
  },
}

/** Orden 1: la revocación está en vuelo; el registro espera y luego es rechazado sin escribir. */
async function revocacionEnVuelo(nombre) {
  const rev = REVOCACIONES[nombre]
  await restaurar()
  await r.ejecutar(`BEGIN; ${rev.sql}`, 'r_revoca')
  await a.ejecutar('BEGIN;', 'a_begin')
  const llamada = seguir(a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_registrar_espera'))
  await exigirBloqueo('r', 'a', `${nombre}: el registro debía esperar la revocación en vuelo`)
  exigir(!llamada.marca.terminada, `${nombre}: el registro no esperó`)
  await r.ejecutar('COMMIT;', 'r_commit')
  await llamada.promesa
  await exigirResultado(a, `${nombre}: registro tras la revocación`, rev.rechazo)
  await a.ejecutar('ROLLBACK;', 'a_rollback')
  exigir((await cuentaPagos()) === '0' && (await cuentaImputaciones()) === '0', `${nombre}: escribió tras la revocación`)
  exigir((await estadoItems()) === 'PENDIENTE,PENDIENTE,PENDIENTE,PENDIENTE', `${nombre}: reservó tras la revocación`)
  exigir(await rev.final(), `${nombre}: la revocación no quedó aplicada`)
}

/** Orden 1 (variante): la revocación ya confirmó antes de llamar. */
async function revocacionConfirmadaAntes(nombre) {
  const rev = REVOCACIONES[nombre]
  await restaurar()
  await r.ejecutar(rev.sql, 'r_revoca')
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_registrar')
  await exigirResultado(a, `${nombre}: registro posterior`, rev.rechazo)
  await a.ejecutar('ROLLBACK;', 'a_rollback')
  exigir((await cuentaPagos()) === '0', `${nombre}: escribió tras la revocación`)
}

/**
 * Orden 2: el registro adquiere la guarda primero y luego espera (los ítems los retiene C).
 * La revocación espera al registro; nunca se confirma una revocación seguida de una
 * escritura autorizada por una lectura vieja.
 */
async function registroPrimero(nombre, fin = 'COMMIT') {
  const rev = REVOCACIONES[nombre]
  await restaurar()
  await c.ejecutar(`BEGIN; SELECT 1 FROM public.items_factura WHERE id = '${I1}' FOR UPDATE;`, 'c_retiene_item')
  await a.ejecutar('BEGIN;', 'a_begin')
  const llamada = seguir(a.ejecutar(registrar(CLAVE(1), [I1], CENTAVOS_ITEM), 'a_registrar_bloqueado'))
  await exigirBloqueo('c', 'a', `${nombre}: el registro debía esperar el ítem retenido`)
  const revocacion = seguir(r.ejecutar(rev.sql, 'r_revoca'))
  await exigirBloqueo('a', 'r', `${nombre}: la revocación debía esperar al registro`)
  exigir(!llamada.marca.terminada && !revocacion.marca.terminada, `${nombre}: algo terminó antes de liberar al bloqueador`)
  await c.ejecutar('ROLLBACK;', 'c_libera')
  await llamada.promesa
  await exigirResultado(a, `${nombre}: registro liberado`, 'OK')
  // La guarda sobrevive al retorno de la RPC: la revocación sigue esperando hasta COMMIT/ROLLBACK.
  await exigirBloqueo('a', 'r', `${nombre}: la guarda se perdió al retornar la RPC`)
  exigir(!revocacion.marca.terminada, `${nombre}: la revocación avanzó antes del fin de la transacción`)
  await a.ejecutar(`${fin};`, `a_${fin}`)
  await revocacion.promesa
  exigir(await rev.final(), `${nombre}: la revocación no quedó aplicada`)
  const esperado = fin === 'COMMIT' ? '1' : '0'
  exigir((await cuentaPagos()) === esperado, `${nombre}/${fin}: pagos distintos de ${esperado}`)
  exigir(
    (await estadoItems()) ===
      (fin === 'COMMIT' ? 'EN_VERIFICACION,PENDIENTE,PENDIENTE,PENDIENTE' : 'PENDIENTE,PENDIENTE,PENDIENTE,PENDIENTE'),
    `${nombre}/${fin}: estado de ítems inesperado`
  )
}

// ---------------------------------------------------------------------------------
const resultados = []
async function caso(nombre, funcion) {
  try {
    await funcion()
    resultados.push({ nombre, ok: true })
    console.log(`OK    ${nombre}`)
  } catch (error) {
    resultados.push({ nombre, ok: false, detalle: error.message })
    console.log(`FALLA ${nombre}\n        ${error.message.split('\n')[0]}`)
    await recuperar()
  }
}

async function limpiarTodo() {
  await c.ejecutar(
    `RESET ROLE; BEGIN;
     DELETE FROM public.imputaciones_pago WHERE alumno_id = '${HIJO}';
     DELETE FROM public.pagos WHERE alumno_id = '${HIJO}';
     DELETE FROM public.items_factura WHERE alumno_id = '${HIJO}';
     DELETE FROM public.facturas WHERE alumno_id = '${HIJO}';
     DELETE FROM public.tarifas WHERE id = '${TARIFA}';
     DELETE FROM public.padres_hijos WHERE hijo_id = '${HIJO}';
     DELETE FROM public.matriculas WHERE alumno_id = '${HIJO}';
     DELETE FROM public.cursos WHERE id = '${CURSO}';
     DELETE FROM public.niveles WHERE nombre = '${NIVEL}';
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

const huellaAjena = () =>
  c.escalar(
    `(SELECT pg_catalog.md5(
        (SELECT COALESCE(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, user_id, rol_id, estado_acceso), ';' ORDER BY id), '')
           FROM public.perfiles WHERE id NOT IN (${lista(PERFILES)}))
        || (SELECT COALESCE(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, alumno_id, estado_pago, importe), ';' ORDER BY id), '')
              FROM public.items_factura WHERE alumno_id <> '${HIJO}')
        || (SELECT COALESCE(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, alumno_id, estado), ';' ORDER BY id), '')
              FROM public.pagos WHERE alumno_id <> '${HIJO}')))`,
    'huella_ajena'
  )

try {
  const origen = await c.escalar(`COALESCE(pg_catalog.host(pg_catalog.inet_server_addr()), 'socket-local')`, 'origen')
  exigir(
    ['socket-local', '127.0.0.1', '::1'].includes(origen),
    `Se rechaza la ejecución: la conexión no es local (${origen}).`
  )
  exigir(
    (await c.escalar(
      `EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proname = 'registrar_pago' AND p.pronamespace = 'public'::REGNAMESPACE)`,
      'migracion_108'
    )) === 'true',
    'La base local no tiene aplicada la migración EPT-108.'
  )
  for (const [clave, sesion] of Object.entries(sesiones)) {
    pids[clave] = Number(await sesion.escalar('pg_catalog.pg_backend_pid()', `pid_${clave}`))
  }

  await limpiarTodo()
  await c.ejecutar(
    `BEGIN;
     INSERT INTO public.niveles (nombre, activo, orden) VALUES ('${NIVEL}', true, 9108);
     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::UUID, v.id::UUID, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${PADRE_A}', 'PADRE', 'Padre A EPT108', '99108001', NULL),
       ('${PADRE_B}', 'PADRE', 'Copadre EPT108', '99108002', NULL),
       ('${HIJO}', 'ESTUDIANTE', 'Hijo EPT108', '99108003', 'EPT108-1')
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
     VALUES ('${CURSO}', (SELECT id FROM public.niveles WHERE nombre = '${NIVEL}'), 'Curso EPT108', 'A', true);
     INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES ('${MATRICULA}', '${HIJO}', '${CURSO}');
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${HIJO}';
     INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
     VALUES ('${TARIFA}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = '${NIVEL}'), 100.00, '2050-01-01');
     INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
     SELECT f.id::UUID, '${HIJO}', f.periodo::DATE, f.periodo::DATE + 9, 100.00
     FROM (VALUES ('${FACTURAS[0]}', '2090-01-01'), ('${FACTURAS[1]}', '2090-02-01'),
                  ('${FACTURAS[2]}', '2090-03-01'), ('${FACTURAS[3]}', '2090-04-01')) AS f(id, periodo);
     INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
     SELECT i.item::UUID, i.factura::UUID, '${HIJO}', 'CUOTA', '${TARIFA}', '${MATRICULA}', 100.00
     FROM (VALUES ('${I1}', '${FACTURAS[0]}'), ('${I2}', '${FACTURAS[1]}'),
                  ('${I3}', '${FACTURAS[2]}'), ('${I4}', '${FACTURAS[3]}')) AS i(item, factura);
     INSERT INTO public.padres_hijos (padre_id, hijo_id)
       VALUES ('${PADRE_A}', '${HIJO}'), ('${PADRE_B}', '${HIJO}');
     COMMIT;`,
    'fixture'
  )
  await a.ejecutar(como(PADRE_A), 'identidad_a')
  await b.ejecutar(como(PADRE_B), 'identidad_b')
  const huellaInicial = await huellaAjena()

  await caso('mismo ítem, dos padres: el segundo espera y pierde con P6853', () =>
    dosRegistros({
      itemsA: [I1], itemsB: [I1], totalA: CENTAVOS_ITEM, totalB: CENTAVOS_ITEM,
      esperadoB: 'P6853', pagosFinal: 1,
      estadoFinal: 'EN_VERIFICACION,PENDIENTE,PENDIENTE,PENDIENTE',
    }))
  await caso('selecciones solapadas en orden inverso: sin interbloqueo', () =>
    dosRegistros({
      itemsA: [I1, I2], itemsB: [I2, I1], totalA: CENTAVOS_ITEM * 2, totalB: CENTAVOS_ITEM * 2,
      esperadoB: 'P6853', pagosFinal: 1,
      estadoFinal: 'EN_VERIFICACION,EN_VERIFICACION,PENDIENTE,PENDIENTE',
    }))
  await caso('selecciones parcialmente solapadas: la perdedora no reserva el resto', () =>
    dosRegistros({
      itemsA: [I1, I2], itemsB: [I3, I2], totalA: CENTAVOS_ITEM * 2, totalB: CENTAVOS_ITEM * 2,
      esperadoB: 'P6853', pagosFinal: 1,
      estadoFinal: 'EN_VERIFICACION,EN_VERIFICACION,PENDIENTE,PENDIENTE',
    }))
  await caso('selecciones disjuntas: no se esperan y ambas confirman', sinSolape)
  await caso('mismo intento concurrente (doble clic): un solo pago', mismoIntentoConcurrente)
  await caso('respuesta perdida DESPUÉS del COMMIT: la consulta y el reintento recuperan el pago', respuestaPerdidaTrasCommit)
  await caso('respuesta perdida ANTES del COMMIT: el intento no existe y puede reintentarse', respuestaPerdidaAntesDelCommit)
  await caso('consulta del intento durante un registro en curso: espera y ve el resultado', consultaEsperaAlRegistroEnCurso)
  await caso('cotización desactualizada: otro padre reservó parte de la selección', cotizacionDesactualizada)

  for (const nombre of Object.keys(REVOCACIONES)) {
    await caso(`orden 1, revocación confirmada antes · ${nombre}`, () => revocacionConfirmadaAntes(nombre))
    await caso(`orden 1, revocación en vuelo (el registro espera) · ${nombre}`, () => revocacionEnVuelo(nombre))
    await caso(`orden 2, el registro toma la guarda y la revocación espera · ${nombre} · COMMIT`, () => registroPrimero(nombre, 'COMMIT'))
    await caso(`orden 2, el registro toma la guarda y la revocación espera · ${nombre} · ROLLBACK`, () => registroPrimero(nombre, 'ROLLBACK'))
  }

  await caso('datos ajenos al fixture intactos', async () => {
    exigir((await huellaAjena()) === huellaInicial, 'cambió un perfil, ítem o pago ajenos al fixture')
  })
} finally {
  await recuperar()
  await limpiarTodo().catch((error) => console.error(`La limpieza falló: ${error.message}`))
  const restos = await c
    .escalar(
      `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)}))
       + (SELECT pg_catalog.count(*) FROM public.pagos WHERE alumno_id = '${HIJO}')
       + (SELECT pg_catalog.count(*) FROM public.niveles WHERE nombre = '${NIVEL}')`,
      'restos'
    )
    .catch(() => '?')
  console.log(`Restos de fixture: ${restos}`)
  await Promise.allSettled(Object.values(sesiones).map((s) => s.cerrar()))
}

const fallas = resultados.filter((x) => !x.ok)
console.log(`\n${resultados.length - fallas.length}/${resultados.length} casos correctos, ${fallas.length} con falla`)
if (fallas.length > 0) process.exit(1)
