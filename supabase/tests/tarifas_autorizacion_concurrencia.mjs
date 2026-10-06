import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Autorización transaccional de las operaciones de tarifas (EPT-103, corrección).
 *
 * Contrato aprobado el 06/10/2026: `crear_tarifa`, `cambiar_tarifa` y
 * `actualizar_tarifa` toman `FOR SHARE` sobre la fila del perfil del actor, validan
 * ahí su rol y su acceso con el estado fresco y conservan el bloqueo hasta
 * COMMIT/ROLLBACK. Solo existen dos órdenes seriales posibles:
 *
 *   1. La revocación (cambio de rol o de acceso) confirma ANTES de que la operación
 *      adquiera la guarda: la operación se rechaza con 42501 y no escribe.
 *   2. La operación adquiere la guarda primero: la revocación ESPERA a que la
 *      transacción de la operación termine. Nunca se confirma una revocación y
 *      después se escribe con una autorización leída antes.
 *
 * Tradeoff aceptado: una revocación concurrente puede esperar a que termine una
 * operación que ya estaba autorizada.
 *
 * Esta prueba NO reproduce el orden antiguo («esperar la revocación antes de liberar
 * la fila»): con la guarda nueva esa espera no termina. La revocación se lanza SIN
 * esperarla, se comprueba con `pg_blocking_pids` quién espera a quién, se libera
 * primero lo que retiene la fila y recién después se confirma la operación.
 *
 *   A, B  el DIRECTOR por la vía real (rol `authenticated` + JWT).
 *   R     otro DIRECTOR que revoca por las RPC públicas de administración.
 *   O     propietario que revoca con UPDATE directo.
 *   C     propietario: fixture, bloqueadores y observador de esperas.
 *
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_ept103 \
 *       node supabase/tests/tarifas_autorizacion_concurrencia.mjs
 *
 * Solo contra la base local descartable. Crea identidades propias y las borra al
 * final, también si falla. Termina con código 1 si algún caso falla, e imprime todos.
 */

const dockerHost = process.env.DOCKER_HOST ?? ''
if (dockerHost && !/^(npipe|unix):/iu.test(dockerHost)) {
  console.error('Se rechaza la ejecución: DOCKER_HOST apunta a un daemon remoto.')
  process.exit(1)
}

const ID = (n) => `c1031000-0000-4000-8000-${String(n).padStart(12, '0')}`
const DIR_A = ID(1)
const DIR_B = ID(2)
const PERSONAL = ID(3)
const PADRE = ID(4)
const DESCONOCIDO = ID(9)
const DEPORTE_1 = ID(31)
const DEPORTE_2 = ID(32)
const T1 = ID(41)
const PERFILES = [DIR_A, DIR_B, PERSONAL, PADRE]
const lista = (valores) => valores.map((v) => `'${v}'`).join(',')
const MOTIVO = 'Prueba de autorización EPT-103'

const como = (claims) =>
  `SET ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claims', '${JSON.stringify(claims)}', false);`
const comoUsuario = (id) => como({ sub: id, role: 'authenticated' })

/** Ejecuta una expresión de texto y deja su desenlace (OK:<valor> o SQLSTATE) en un parámetro de sesión. */
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

const fecha = (valor) => (valor ? `'${valor}'::DATE` : 'NULL')
const crearD = (deporte, importe, desde, hasta) =>
  tolerante(
    'ept103.res',
    `SELECT public.crear_tarifa('DEPORTE', NULL, '${deporte}'::UUID, NULL, '${importe}', ${fecha(desde)}, ${fecha(hasta)})::TEXT`
  )
const cambiarD = (deporte, importe, desde, hasta) =>
  tolerante(
    'ept103.res',
    `SELECT public.cambiar_tarifa('DEPORTE', NULL, '${deporte}'::UUID, NULL, '${importe}', ${fecha(desde)}, ${fecha(hasta)})::TEXT`
  )
const actualizarT = (id, importe, desde, hasta, previo) =>
  tolerante(
    'ept103.res',
    `SELECT public.actualizar_tarifa('${id}'::UUID, '${importe}', ${fecha(desde)}, ${fecha(hasta)}, '${previo.importe}', ${fecha(previo.desde)}, ${fecha(previo.hasta)})::TEXT`
  )

/** Fila tal como la deja `foto()`: referencia, importe, inicio y fin. */
const fila = (deporte, importe, desde, hasta) =>
  `${deporte}:${importe}:${desde}:${hasta ?? 'abierta'}`
const T1_BASE = fila(DEPORTE_1, '100.00', '2070-01-01', '2070-12-31')
const PREVIO_T1 = { importe: '100.00', desde: '2070-01-01', hasta: '2070-12-31' }
const unir = (...filas) => filas.join(' | ')

/**
 * Cada operación: SQL para la sesión actora y estado esperado tras confirmar.
 * Parten de T1 (deporte 1, 2070) y sin tarifas del deporte 2.
 */
const OPERACIONES = {
  crear: {
    sql: crearD(DEPORTE_1, '10', '2071-01-01', '2071-01-31'),
    despues: unir(T1_BASE, fila(DEPORTE_1, '10.00', '2071-01-01', '2071-01-31')),
  },
  crear_deporte_2: {
    sql: crearD(DEPORTE_2, '10', '2071-01-01', '2071-01-31'),
    despues: unir(T1_BASE, fila(DEPORTE_2, '10.00', '2071-01-01', '2071-01-31')),
  },
  cambiar: {
    sql: cambiarD(DEPORTE_1, '555', '2070-06-01', null),
    despues: unir(
      fila(DEPORTE_1, '100.00', '2070-01-01', '2070-05-31'),
      fila(DEPORTE_1, '555.00', '2070-06-01', null)
    ),
  },
  actualizar: {
    sql: actualizarT(T1, '999', '2070-01-01', '2070-12-31', PREVIO_T1),
    despues: fila(DEPORTE_1, '999.00', '2070-01-01', '2070-12-31'),
  },
}

/** Lo que retiene el bloqueador C para que la operación espere DESPUÉS de tomar la guarda. */
const BLOQUEADORES = {
  referencia: (deporte) =>
    `BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtext('ept103_tarifas'),
       pg_catalog.hashtext('DEPORTE:${deporte}'));`,
  fila: () => `BEGIN; SELECT 1 FROM public.tarifas WHERE id = '${T1}' FOR SHARE;`,
  exclusion: () =>
    `BEGIN; INSERT INTO public.tarifas (concepto, deporte_id, importe, desde, hasta)
       VALUES ('DEPORTE', '${DEPORTE_1}', 7, '2071-01-15', '2071-02-15');`,
  fk: () => `BEGIN; DELETE FROM public.deportes WHERE id = '${DEPORTE_2}';`,
}

const sesiones = {
  a: new SesionPsql('A', 'EPT103A'),
  b: new SesionPsql('B', 'EPT103A'),
  r: new SesionPsql('R', 'EPT103A'),
  o: new SesionPsql('O', 'EPT103A'),
  c: new SesionPsql('C', 'EPT103A'),
}
const { a, b, r, o, c } = sesiones
const pids = {}
let pendientes = []

/** Registra una promesa de espera abierta para poder cerrarla si el caso falla. */
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

const resultadoDe = (sesion, parametro, etiqueta) =>
  sesion.escalar(`pg_catalog.current_setting('${parametro}', true)`, etiqueta)

async function exigirResultado(sesion, parametro, etiqueta, esperado) {
  const obtenido = await resultadoDe(sesion, parametro, etiqueta)
  const coincide = esperado === 'OK' ? obtenido.startsWith('OK:') : obtenido === esperado
  exigir(coincide, `${etiqueta}: se esperaba ${esperado} y se obtuvo ${obtenido}`)
}

const foto = () =>
  c.escalar(
    `(SELECT COALESCE(pg_catalog.string_agg(
        deporte_id || ':' || importe || ':' || desde || ':' || COALESCE(hasta::TEXT, 'abierta'),
        ' | ' ORDER BY deporte_id, desde), '')
      FROM public.tarifas WHERE deporte_id IN ('${DEPORTE_1}', '${DEPORTE_2}'))`,
    'foto'
  )

const estadoDe = (id, etiqueta) =>
  c.escalar(
    `(SELECT p.estado_acceso || '/' || r.nombre
      FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id WHERE p.id = '${id}')`,
    etiqueta
  )

async function exigirBloqueo(bloqueador, bloqueado, etiqueta) {
  try {
    await esperarBloqueo(c, pids[bloqueador], pids[bloqueado])
  } catch {
    throw new Error(`${etiqueta}: ${bloqueado} no quedó esperando a ${bloqueador}`)
  }
}

/** Las dos formas de revocar por una RPC pública y las dos de hacerlo con UPDATE directo. */
const REVOCACIONES = {
  'acceso por RPC pública': {
    sesion: 'r',
    sql: tolerante(
      'ept103.rev',
      `SELECT public.cambiar_acceso_perfil('${DIR_A}'::UUID, 'HABILITADO', 'BLOQUEADO', '${MOTIVO}')::TEXT`
    ),
    final: 'BLOQUEADO/DIRECTOR',
    rpc: true,
  },
  'rol por RPC pública': {
    sesion: 'r',
    sql: tolerante(
      'ept103.rev',
      `SELECT public.cambiar_rol_perfil('${DIR_A}'::UUID, 'DIRECTOR', 'PERSONAL', '${MOTIVO}')::TEXT`
    ),
    final: 'HABILITADO/PERSONAL',
    rpc: true,
  },
  'acceso por UPDATE directo': {
    sesion: 'o',
    sql: `UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${DIR_A}';`,
    final: 'BLOQUEADO/DIRECTOR',
    rpc: false,
  },
  'rol por UPDATE directo': {
    sesion: 'o',
    sql: `UPDATE public.perfiles
          SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
          WHERE id = '${DIR_A}';`,
    final: 'HABILITADO/PERSONAL',
    rpc: false,
  },
}
const RPC_PUBLICAS = ['acceso por RPC pública', 'rol por RPC pública']

const lanzarRevocacion = (nombre, dentroDeTransaccion = false) => {
  const rev = REVOCACIONES[nombre]
  return sesiones[rev.sesion].ejecutar(
    `${dentroDeTransaccion ? 'BEGIN; ' : ''}${rev.sql}`,
    `revocacion_${nombre}`
  )
}

async function exigirRevocacionAplicada(nombre, etiqueta) {
  const rev = REVOCACIONES[nombre]
  if (rev.rpc) await exigirResultado(sesiones[rev.sesion], 'ept103.rev', `${etiqueta} (revocación)`, 'OK')
  exigir((await estadoDe(DIR_A, `${etiqueta}_perfil`)) === rev.final, `${etiqueta}: la revocación no quedó aplicada`)
}

/** Deja el fixture en su estado inicial; se ejecuta con todas las transacciones cerradas. */
async function restaurar() {
  await c.ejecutar(
    `UPDATE public.perfiles
        SET estado_acceso = 'HABILITADO',
            rol_id = (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR')
      WHERE id = '${DIR_A}';
     DELETE FROM public.tarifas WHERE deporte_id IN ('${DEPORTE_1}', '${DEPORTE_2}');
     INSERT INTO public.tarifas (id, concepto, deporte_id, importe, desde, hasta)
     VALUES ('${T1}', 'DEPORTE', '${DEPORTE_1}', 100, '2070-01-01', '2070-12-31');`,
    'restaurar'
  )
  await a.ejecutar(`${comoUsuario(DIR_A)}`, 'identidad_a')
  await b.ejecutar(`${comoUsuario(DIR_A)}`, 'identidad_b')
}

async function recuperar() {
  await Promise.allSettled([c.ejecutar('ROLLBACK;', 'recuperar_c')])
  await Promise.allSettled(pendientes)
  pendientes = []
  await Promise.allSettled(
    [a, b, r, o].map((s) => s.ejecutar('ROLLBACK;', 'recuperar'))
  )
  await Promise.allSettled([c.ejecutar('ROLLBACK;', 'recuperar_c2')])
}

// ---------------------------------------------------------------------------------
// Orden 1: la revocación confirma antes de que la operación adquiera la guarda.
// ---------------------------------------------------------------------------------
async function revocacionConfirmadaPrimero(op, nombreRevocacion) {
  await restaurar()
  const base = await foto()
  await lanzarRevocacion(nombreRevocacion)
  await exigirRevocacionAplicada(nombreRevocacion, 'revocación previa')
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(OPERACIONES[op].sql, 'a_llamada')
  await exigirResultado(a, 'ept103.res', `${op} con JWT anterior a la revocación`, '42501')
  await a.ejecutar('ROLLBACK;', 'a_rollback')
  exigir((await foto()) === base, `${op}: escribió pese a la revocación confirmada`)
}

/** La revocación está en vuelo (retiene la fila del perfil): la operación espera la guarda y luego es rechazada. */
async function revocacionEnVueloPrimero(op, nombreRevocacion) {
  await restaurar()
  const base = await foto()
  await lanzarRevocacion(nombreRevocacion, true)
  const rev = REVOCACIONES[nombreRevocacion]
  await a.ejecutar('BEGIN;', 'a_begin')
  const llamada = seguir(a.ejecutar(OPERACIONES[op].sql, 'a_llamada_espera'))
  await exigirBloqueo(rev.sesion, 'a', `${op}: la operación debía esperar el perfil`)
  exigir(!llamada.marca.terminada, `${op}: la operación no esperó la revocación en vuelo`)
  await sesiones[rev.sesion].ejecutar('COMMIT;', 'confirmar_revocacion')
  await llamada.promesa
  await exigirResultado(a, 'ept103.res', `${op} tras la revocación en vuelo`, '42501')
  await a.ejecutar('ROLLBACK;', 'a_rollback')
  exigir((await foto()) === base, `${op}: escribió tras confirmarse la revocación`)
  await exigirRevocacionAplicada(nombreRevocacion, 'revocación en vuelo')
}

// ---------------------------------------------------------------------------------
// Orden 2: la operación adquiere la guarda primero; la revocación espera.
// ---------------------------------------------------------------------------------
/**
 * @param bloqueo  null o clave de BLOQUEADORES: lo que hace esperar a la operación
 *                 DESPUÉS de haber tomado la guarda.
 * @param fin      'COMMIT' o 'ROLLBACK' de la transacción de la operación.
 */
async function operacionPrimero({ op, bloqueo, nombreRevocacion, fin = 'COMMIT', referencia = DEPORTE_1 }) {
  await restaurar()
  const base = await foto()
  const rev = REVOCACIONES[nombreRevocacion]

  if (bloqueo) {
    await c.ejecutar(BLOQUEADORES[bloqueo](referencia), 'c_bloquea')
    await a.ejecutar('BEGIN;', 'a_begin')
    const llamada = seguir(a.ejecutar(OPERACIONES[op].sql, 'a_llamada_bloqueada'))
    await exigirBloqueo('c', 'a', `${op}/${bloqueo}: la operación debía esperar al bloqueador`)
    const revocacion = seguir(lanzarRevocacion(nombreRevocacion))
    await exigirBloqueo('a', rev.sesion, `${op}/${bloqueo}: la revocación debía esperar a la operación`)
    exigir(!llamada.marca.terminada && !revocacion.marca.terminada, `${op}/${bloqueo}: algo terminó antes de liberar al bloqueador`)
    await c.ejecutar('ROLLBACK;', 'c_libera')
    await llamada.promesa
    await exigirResultado(a, 'ept103.res', `${op}/${bloqueo} liberada`, 'OK')
    await terminarOperacion(op, nombreRevocacion, revocacion, fin, base)
  } else {
    await a.ejecutar('BEGIN;', 'a_begin')
    await a.ejecutar(OPERACIONES[op].sql, 'a_llamada')
    await exigirResultado(a, 'ept103.res', `${op} sin espera`, 'OK')
    const revocacion = seguir(lanzarRevocacion(nombreRevocacion))
    await exigirBloqueo('a', rev.sesion, `${op}: la revocación debía esperar a la transacción de la operación`)
    await terminarOperacion(op, nombreRevocacion, revocacion, fin, base)
  }
}

async function terminarOperacion(op, nombreRevocacion, revocacion, fin, base) {
  const rev = REVOCACIONES[nombreRevocacion]
  // La guarda sobrevive al retorno de la RPC: la revocación sigue esperando hasta COMMIT/ROLLBACK.
  await exigirBloqueo('a', rev.sesion, `${op}: la guarda se perdió al retornar la RPC`)
  exigir(!revocacion.marca.terminada, `${op}: la revocación avanzó antes del fin de la transacción`)
  await a.ejecutar(`${fin};`, `a_${fin}`)
  await revocacion.promesa
  await exigirRevocacionAplicada(nombreRevocacion, `${op}/${fin}`)
  const esperado = fin === 'COMMIT' ? OPERACIONES[op].despues : base
  const obtenido = await foto()
  exigir(obtenido === esperado, `${op}/${fin}: estado final distinto (${obtenido})`)
}

// ---------------------------------------------------------------------------------
// Mismo DIRECTOR en varias transacciones: comparten la guarda y no hay ciclos.
// ---------------------------------------------------------------------------------
async function directorCompartidoSinCiclos(nombreRevocacion) {
  await restaurar()
  const rev = REVOCACIONES[nombreRevocacion]
  await a.ejecutar('BEGIN;', 'a_begin')
  await a.ejecutar(crearD(DEPORTE_1, '10', '2071-01-01', '2071-01-31'), 'a_alta_1')
  await exigirResultado(a, 'ept103.res', 'A: alta en el deporte 1', 'OK')

  // B es el mismo DIRECTOR en otra transacción y OTRA referencia: no espera a A.
  await b.ejecutar('BEGIN;', 'b_begin')
  await b.ejecutar(crearD(DEPORTE_2, '20', '2071-01-01', '2071-01-31'), 'b_alta_2')
  await exigirResultado(b, 'ept103.res', 'B: alta en otra referencia sin esperar a A', 'OK')

  const revocacion = seguir(lanzarRevocacion(nombreRevocacion))
  // PostgreSQL espera a los miembros de un bloqueo compartido de a uno: `pg_blocking_pids`
  // muestra primero a A. B se comprueba cuando A termina.
  await exigirBloqueo('a', rev.sesion, 'compartido: la revocación debía esperar a A')

  // B ahora toca la referencia que retiene A: espera en el consultivo (guarda ya tomada y compartida).
  const altaB = seguir(b.ejecutar(crearD(DEPORTE_1, '30', '2072-01-01', '2072-01-31'), 'b_alta_1'))
  await exigirBloqueo('a', 'b', 'compartido: B debía esperar la referencia de A')
  exigir(!revocacion.marca.terminada, 'compartido: la revocación avanzó con dos guardas vivas')

  await a.ejecutar('COMMIT;', 'a_commit')
  await altaB.promesa
  await exigirResultado(b, 'ept103.res', 'B: alta serializada tras A', 'OK')
  await exigirBloqueo('b', rev.sesion, 'compartido: la revocación debía seguir esperando a B tras terminar A')
  exigir(!revocacion.marca.terminada, 'compartido: la revocación avanzó con la guarda de B viva')
  await b.ejecutar('COMMIT;', 'b_commit')
  await revocacion.promesa
  await exigirRevocacionAplicada(nombreRevocacion, 'compartido')
  const esperado = unir(
    T1_BASE,
    fila(DEPORTE_1, '10.00', '2071-01-01', '2071-01-31'),
    fila(DEPORTE_1, '30.00', '2072-01-01', '2072-01-31'),
    fila(DEPORTE_2, '20.00', '2071-01-01', '2071-01-31')
  )
  const obtenido = await foto()
  exigir(obtenido === esperado, `compartido: estado final distinto (${obtenido})`)
}

// ---------------------------------------------------------------------------------
// Identidades que nunca deben poder operar, sin ninguna revocación en curso.
// ---------------------------------------------------------------------------------
async function identidadesNoAutorizadas() {
  await restaurar()
  const base = await foto()
  const casos = [
    ['PERSONAL', { sub: PERSONAL, role: 'authenticated' }, '42501'],
    ['PADRE', { sub: PADRE, role: 'authenticated' }, '42501'],
    ['identidad sin perfil', { sub: DESCONOCIDO, role: 'authenticated' }, '42501'],
    ['sin identidad', { role: 'authenticated' }, 'P5505'],
    [
      'metadatos falsificados de DIRECTOR',
      {
        sub: PERSONAL,
        role: 'authenticated',
        user_metadata: { rol: 'DIRECTOR' },
        app_metadata: { rol: 'DIRECTOR', role: 'DIRECTOR' },
      },
      '42501',
    ],
  ]
  for (const [nombre, claims, esperado] of casos) {
    await b.ejecutar(`RESET ROLE; ${como(claims)}`, `identidad_${nombre}`)
    for (const op of ['crear', 'cambiar', 'actualizar']) {
      await b.ejecutar(OPERACIONES[op].sql, `${nombre}_${op}`)
      await exigirResultado(b, 'ept103.res', `${nombre} / ${op}`, esperado)
    }
  }
  await b.ejecutar(`RESET ROLE; ${comoUsuario(DIR_A)}`, 'identidad_b_restituida')
  exigir((await foto()) === base, 'una identidad no autorizada escribió una tarifa')
  // Ninguna operación acepta actor, rol, perfil ni usuario como argumento.
  const argumentos = await c.escalar(
    `(SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'app_private')
        AND p.proname IN ('crear_tarifa', 'cambiar_tarifa', 'actualizar_tarifa')
        AND EXISTS (SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS x(nombre)
                    WHERE nombre ~* '(user|rol|actor|perfil)'))`,
    'argumentos_de_actor'
  )
  exigir(argumentos === '0', 'una operación de tarifas recibe actor, rol, perfil o usuario')
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
     ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
     DELETE FROM public.perfiles_historial
       WHERE perfil_id IN (${lista(PERFILES)}) OR actor_perfil_id IN (${lista(PERFILES)});
     ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
     DELETE FROM public.tarifas WHERE deporte_id IN ('${DEPORTE_1}', '${DEPORTE_2}');
     DELETE FROM public.deportes WHERE id IN ('${DEPORTE_1}', '${DEPORTE_2}');
     DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
     DELETE FROM auth.users WHERE id IN (${lista([DIR_A, DIR_B, PERSONAL, PADRE])});
     COMMIT;`,
    'limpiar_todo'
  )
}

const huellaAjena = () =>
  c.escalar(
    `(SELECT pg_catalog.md5(
        (SELECT COALESCE(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, user_id, rol_id, estado_acceso, nombre, apellido, dni), ';' ORDER BY id), '')
           FROM public.perfiles WHERE id NOT IN (${lista(PERFILES)}))
        || (SELECT COALESCE(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, factura_id, tarifa_id, importe), ';' ORDER BY id), '')
              FROM public.items_factura)
        || (SELECT COALESCE(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, total), ';' ORDER BY id), '')
              FROM public.facturas)
        || (SELECT COALESCE(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, importe, desde, hasta), ';' ORDER BY id), '')
              FROM public.tarifas WHERE deporte_id IS DISTINCT FROM '${DEPORTE_1}' AND deporte_id IS DISTINCT FROM '${DEPORTE_2}')))`,
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
      `EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006002724')`,
      'migracion_103'
    )) === 'true',
    'La base local no tiene aplicada la migración EPT-103.'
  )
  for (const [clave, sesion] of Object.entries(sesiones)) {
    pids[clave] = Number(await sesion.escalar('pg_catalog.pg_backend_pid()', `pid_${clave}`))
  }

  await limpiarTodo()
  await c.ejecutar(
    `BEGIN;
     INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                             raw_user_meta_data, created_at, updated_at)
     VALUES ${[DIR_A, DIR_B, PERSONAL, PADRE]
       .map((id, i) => `('${id}', 'authenticated', 'authenticated', 'aut${i}@ept103.invalid', now(), '{}', '{}', now(), now())`)
       .join(',\n            ')};
     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::uuid, v.id::uuid, r.id, 'Prueba', v.apellido, v.dni, NULL
     FROM (VALUES
       ('${DIR_A}', 'DIRECTOR', 'Dirección actora', '99931001'),
       ('${DIR_B}', 'DIRECTOR', 'Dirección revocadora', '99931002'),
       ('${PERSONAL}', 'PERSONAL', 'Personal sin tarifas', '99931003'),
       ('${PADRE}', 'PADRE', 'Padre sin tarifas', '99931004')
     ) AS v(id, rol, apellido, dni)
     JOIN public.roles r ON r.nombre = v.rol;
     INSERT INTO public.deportes (id, nombre)
     VALUES ('${DEPORTE_1}', 'Deporte autorización EPT-103 A'), ('${DEPORTE_2}', 'Deporte autorización EPT-103 B');
     COMMIT;`,
    'fixture'
  )
  await r.ejecutar(comoUsuario(DIR_B), 'identidad_r')
  const huellaInicial = await huellaAjena()

  for (const op of ['crear', 'cambiar', 'actualizar']) {
    for (const rev of RPC_PUBLICAS) {
      await caso(`orden 1, revocación confirmada antes · ${op} · ${rev}`, () => revocacionConfirmadaPrimero(op, rev))
      await caso(`orden 1, revocación en vuelo (la operación espera el perfil) · ${op} · ${rev}`, () => revocacionEnVueloPrimero(op, rev))
    }
  }
  await caso('orden 1, revocación confirmada antes · crear · rol por UPDATE directo', () => revocacionConfirmadaPrimero('crear', 'rol por UPDATE directo'))

  const matriz = [
    { op: 'crear', bloqueo: 'referencia' },
    { op: 'crear', bloqueo: 'exclusion' },
    { op: 'crear_deporte_2', bloqueo: 'fk', referencia: DEPORTE_2 },
    { op: 'cambiar', bloqueo: 'referencia' },
    { op: 'cambiar', bloqueo: 'fila' },
    { op: 'actualizar', bloqueo: 'referencia' },
    { op: 'actualizar', bloqueo: 'fila' },
  ]
  for (const parametros of matriz) {
    for (const rev of RPC_PUBLICAS) {
      await caso(
        `orden 2, la operación espera «${parametros.bloqueo}» con la guarda tomada · ${parametros.op} · ${rev}`,
        () => operacionPrimero({ ...parametros, nombreRevocacion: rev })
      )
    }
  }
  for (const rev of ['acceso por UPDATE directo', 'rol por UPDATE directo']) {
    for (const parametros of [
      { op: 'crear', bloqueo: 'exclusion' },
      { op: 'cambiar', bloqueo: 'fila' },
      { op: 'actualizar', bloqueo: 'fila' },
    ]) {
      await caso(
        `orden 2, revocación por UPDATE directo · ${parametros.op}/${parametros.bloqueo} · ${rev}`,
        () => operacionPrimero({ ...parametros, nombreRevocacion: rev })
      )
    }
  }

  for (const op of ['crear', 'cambiar', 'actualizar']) {
    for (const fin of ['COMMIT', 'ROLLBACK']) {
      await caso(`guarda hasta ${fin} tras retornar la RPC · ${op}`, () =>
        operacionPrimero({ op, bloqueo: null, nombreRevocacion: 'acceso por RPC pública', fin })
      )
    }
  }

  for (const rev of RPC_PUBLICAS) {
    await caso(`mismo DIRECTOR en dos transacciones comparte la guarda y no hay ciclos · ${rev}`, () => directorCompartidoSinCiclos(rev))
  }
  await caso('identidades no autorizadas, sin revocación en curso', identidadesNoAutorizadas)

  await caso('perfiles, facturas e ítems ajenos intactos', async () => {
    exigir((await huellaAjena()) === huellaInicial, 'cambió un perfil, factura, ítem o tarifa ajenos al fixture')
  })
} finally {
  await recuperar()
  await limpiarTodo().catch((error) => console.error(`La limpieza falló: ${error.message}`))
  const restos = await c
    .escalar(
      `(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)}))
       + (SELECT pg_catalog.count(*) FROM public.tarifas WHERE deporte_id IN ('${DEPORTE_1}', '${DEPORTE_2}'))`,
      'restos'
    )
    .catch(() => '?')
  console.log(`Restos de fixture: ${restos}`)
  await Promise.allSettled(Object.values(sesiones).map((s) => s.cerrar()))
}

const fallas = resultados.filter((x) => !x.ok)
console.log(`\n${resultados.length - fallas.length}/${resultados.length} casos correctos, ${fallas.length} con falla`)
if (fallas.length > 0) process.exit(1)
