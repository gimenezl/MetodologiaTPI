import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * EPT-59 — Carreras reales sobre roles, acceso y vínculo de cuentas.
 *
 * Dos conexiones PostgreSQL independientes compiten por la misma decisión. El
 * arnés espera, con `pg_blocking_pids`, a que la segunda esté efectivamente
 * bloqueada por la primera antes de confirmar: nunca depende de esperas por
 * tiempo.
 *
 *   (a) Dos Directores, los únicos efectivos, intentan degradarse o
 *       bloquearse entre sí: exactamente uno lo logra. Variante con un tercer
 *       Director no efectivo que degrada a ambos: el candado consultivo evita
 *       el sesgo de escritura que dejaría cero Directores efectivos.
 *   (b) DOCENTE→PERSONAL contra reactivar la ficha y asignar una materia o
 *       crear un grupo: nunca queda un no DOCENTE a cargo de algo activo.
 *   (c) Bloqueo contra cambio de rol del mismo perfil: se serializan; un valor
 *       esperado obsoleto devuelve P5909.
 *   (d) Dos cambios de rol con el mismo valor esperado: uno gana, el otro P5909.
 *   (e) Dos Directores reservan el mismo perfil para D5: una sola reserva.
 *
 *     node supabase/tests/usuarios_permisos_concurrencia.mjs
 *
 * Solo contra la base local descartable (contenedor Docker local). Limpia su
 * fixture al terminar, también si falla.
 */

const dockerHost = process.env.DOCKER_HOST ?? ''
if (dockerHost && !/^(npipe|unix):/iu.test(dockerHost)) {
  console.error('Se rechaza la ejecución: DOCKER_HOST apunta a un daemon remoto.')
  process.exit(1)
}

const P = (n) => `f5910000-0000-4000-8000-0000000000${n}`
const ID = {
  da: P('01'),
  db: P('02'),
  dc: P('03'), // DIRECTOR habilitado sin cuenta efectiva (correo sin confirmar)
  p: P('04'), // objetivo de (c) y (d)
  q: P('05'), // objetivo de (e)
  docB1: P('06'),
  docB2: P('07'),
  docB3: P('08'),
  docB4: P('09'),
  curso: P('c1'),
}
const DOCENTES = [ID.docB1, ID.docB2, ID.docB3, ID.docB4]
const PERFILES = [ID.da, ID.db, ID.dc, ID.p, ID.q, ...DOCENTES]
const CUENTAS = [ID.da, ID.db, ID.dc]
const lista = (valores) => valores.map((v) => `'${v}'`).join(',')
const DEPORTE = 'e0000000-0000-4000-8000-000000000101'
const MATERIA = `(SELECT id FROM public.materias WHERE nombre = 'Materia concurrencia EPT59')`

const sesion = (id) =>
  `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',false);`
const probar = (sql) => `DO $prueba$ BEGIN
  BEGIN ${sql}; PERFORM set_config('ept59.resultado','OK',false);
  EXCEPTION WHEN OTHERS THEN PERFORM set_config('ept59.resultado',SQLSTATE,false); END;
END $prueba$;`
const rol = (perfil, esperado, nuevo) =>
  `PERFORM public.cambiar_rol_perfil('${perfil}', ${esperado === null ? 'NULL' : `'${esperado}'`}, '${nuevo}', 'Carrera de concurrencia EPT-59')`
const acceso = (perfil, esperado, nuevo) =>
  `PERFORM public.cambiar_acceso_perfil('${perfil}', '${esperado}', '${nuevo}', 'Carrera de concurrencia EPT-59')`

async function limpiar() {
  const l = new SesionPsql('L', 'EPT59')
  try {
    // Historial y reservas son de solo agregado también para el propietario.
    // Solo esta limpieza local deshabilita sus guardas, dentro de la misma
    // transacción.
    await l.ejecutar(`RESET ROLE; BEGIN;
      ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
      DELETE FROM public.perfiles_historial
        WHERE perfil_id IN (${lista(PERFILES)}) OR actor_perfil_id IN (${lista(PERFILES)});
      ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
      ALTER TABLE app_private.vinculos_cuenta DISABLE TRIGGER impedir_borrar_vinculos_cuenta;
      DELETE FROM app_private.vinculos_cuenta
        WHERE perfil_id IN (${lista(PERFILES)}) OR director_perfil_id IN (${lista(PERFILES)});
      ALTER TABLE app_private.vinculos_cuenta ENABLE TRIGGER impedir_borrar_vinculos_cuenta;
      ALTER TABLE public.profesores_estados_historial DISABLE TRIGGER impedir_modificar_historial_profesor;
      DELETE FROM public.profesores_estados_historial
        WHERE profesor_id IN (${lista(PERFILES)}) OR actor_id IN (${lista(PERFILES)});
      ALTER TABLE public.profesores_estados_historial ENABLE TRIGGER impedir_modificar_historial_profesor;
      DELETE FROM public.materias_cursos WHERE curso_id = '${ID.curso}';
      DELETE FROM public.grupos_deportivos WHERE profesor_id IN (${lista(PERFILES)});
      DELETE FROM public.profesores WHERE perfil_id IN (${lista(PERFILES)});
      DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
      DELETE FROM public.cursos WHERE id = '${ID.curso}';
      DELETE FROM public.actividades WHERE nombre = 'Materia concurrencia EPT59' AND tipo = 'CURRICULAR';
      DELETE FROM auth.users WHERE id IN (${lista(CUENTAS)});
      COMMIT;`, 'limpieza')
  } finally {
    await l.cerrar()
  }
}

const a = new SesionPsql('A', 'EPT59')
const b = new SesionPsql('B', 'EPT59')
const tabla = []

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

async function resultado(s, etiqueta) {
  return s.escalar(`current_setting('ept59.resultado', true)`, etiqueta)
}

async function propietario(expresion, etiqueta) {
  await a.ejecutar('RESET ROLE;', `propietario_${etiqueta}`)
  return a.escalar(expresion, etiqueta)
}

/**
 * Corre una carrera: la sesión A abre la transacción y ejecuta `primera`;
 * la sesión B ejecuta `segunda` y queda bloqueada; A confirma; se leen ambos
 * resultados.
 */
async function carrera(etiqueta, actorA, primera, actorB, segunda, pidA, pidB) {
  await a.ejecutar(`${sesion(actorA)} BEGIN; ${probar(primera)}`, `${etiqueta}_a`)
  const ra = await resultado(a, `${etiqueta}_ra`)
  exigir(ra === 'OK', `${etiqueta}: la primera operación falló con ${ra}`)
  const pendiente = b.ejecutar(`${sesion(actorB)} ${probar(segunda)}`, `${etiqueta}_b`)
  await esperarBloqueo(a, pidA, pidB)
  await a.ejecutar('COMMIT;', `${etiqueta}_commit`)
  await pendiente
  const rb = await resultado(b, `${etiqueta}_rb`)
  await b.ejecutar('RESET ROLE;', `${etiqueta}_reset_b`)
  return { ra, rb }
}

let bien = false
try {
  // La base debe ser la local de Supabase con EPT-59 aplicada.
  const origen = await a.escalar(
    `COALESCE(host(inet_server_addr()), 'socket-local')`,
    'origen'
  )
  exigir(
    ['socket-local', '127.0.0.1', '::1'].includes(origen),
    `Se rechaza la ejecución: la conexión no es local (${origen}).`
  )
  exigir(
    (await a.escalar(
      `EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260926190000')`,
      'migracion'
    )) === 'true',
    'La base local no tiene aplicada la migración EPT-59.'
  )

  await limpiar()

  // (a) exige que los dos Directores del fixture sean los únicos efectivos.
  const ajenos = await a.escalar(
    `(SELECT count(*) FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
      WHERE r.nombre = 'DIRECTOR' AND app_private.es_director_efectivo(p.id))`,
    'directores_ajenos'
  )
  exigir(
    ajenos === '0',
    `Hay ${ajenos} Director(es) efectivo(s) ajenos al fixture; ejecutar después de supabase db reset.`
  )

  const pidA = Number(await a.escalar('pg_backend_pid()', 'pid_a'))
  const pidB = Number(await b.escalar('pg_backend_pid()', 'pid_b'))

  await a.ejecutar(`RESET ROLE; BEGIN;
    INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                            raw_user_meta_data, created_at, updated_at)
    VALUES ('${ID.da}', 'authenticated', 'authenticated', 'conc.da@ept59.invalid', now(), '{}', '{}', now(), now()),
           ('${ID.db}', 'authenticated', 'authenticated', 'conc.db@ept59.invalid', now(), '{}', '{}', now(), now()),
           ('${ID.dc}', 'authenticated', 'authenticated', 'conc.dc@ept59.invalid', NULL,  '{}', '{}', now(), now());
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
    SELECT v.id::uuid, v.cuenta::uuid, r.id, 'Prueba', v.apellido, v.dni, v.legajo
    FROM (VALUES
      ('${ID.da}', '${ID.da}', 'DIRECTOR', 'Dirección A', '95910001', NULL),
      ('${ID.db}', '${ID.db}', 'DIRECTOR', 'Dirección B', '95910002', NULL),
      ('${ID.dc}', '${ID.dc}', 'DIRECTOR', 'Dirección C', '95910003', NULL),
      ('${ID.p}',  NULL, 'PERSONAL', 'Objetivo rol', '95910004', NULL),
      ('${ID.q}',  NULL, 'PERSONAL', 'Objetivo reserva', '95910005', NULL),
      ${DOCENTES.map((id, i) => `('${id}', NULL, 'DOCENTE', 'Docente ${i + 1}', '9591001${i}', 'LEG-EPT59-CONC-${i + 1}')`).join(',\n      ')}
    ) AS v(id, cuenta, rol, apellido, dni, legajo)
    JOIN public.roles r ON r.nombre = v.rol;
    -- Fichas completas e INACTIVO: la salida de DOCENTE es posible y la
    -- reactivación también, así las dos operaciones compiten de verdad.
    UPDATE public.profesores SET especialidad = 'Concurrencia', estado = 'INACTIVO'
      WHERE perfil_id IN (${lista(DOCENTES)});
    INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
    VALUES ('${ID.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Concurrencia EPT59', 'A', TRUE);
    COMMIT;`, 'fixture')
  await a.ejecutar(`${sesion(ID.da)} SELECT public.crear_materia('Materia concurrencia EPT59');`, 'materia')
  await a.ejecutar('RESET ROLE;', 'fixture_reset')

  const efectivos = () =>
    propietario(
      `(SELECT count(*) FROM public.perfiles p WHERE p.id IN (${lista([ID.da, ID.db, ID.dc])})
          AND app_private.es_director_efectivo(p.id))`,
      'efectivos'
    )
  const rolDe = (id, e) =>
    propietario(`(SELECT r.nombre FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id WHERE p.id = '${id}')`, e)
  const accesoDe = (id, e) => propietario(`(SELECT estado_acceso FROM public.perfiles WHERE id = '${id}')`, e)

  // ------------------------------------------------------------------
  // (a) DA degrada a DB mientras DB bloquea a DA.
  let r = await carrera('a1', ID.da, rol(ID.db, 'DIRECTOR', 'PERSONAL'), ID.db, acceso(ID.da, 'HABILITADO', 'BLOQUEADO'), pidA, pidB)
  exigir(r.rb === '42501', `(a1) se esperaba 42501 para la segunda y llegó ${r.rb}`)
  exigir((await rolDe(ID.db, 'a1_rol')) === 'PERSONAL' && (await accesoDe(ID.da, 'a1_acc')) === 'HABILITADO' && (await efectivos()) === '1',
    '(a1) estado final inconsistente')
  tabla.push({ carrera: '(a1) DA degrada a DB ∥ DB bloquea a DA', primera: r.ra, segunda: r.rb, final: 'DA DIRECTOR habilitado, DB PERSONAL, 1 efectivo' })
  await a.ejecutar(`${sesion(ID.da)} ${probar(rol(ID.db, 'PERSONAL', 'DIRECTOR'))}`, 'a1_restituir')
  exigir((await resultado(a, 'a1_restituir_r')) === 'OK', '(a1) no se pudo restituir DB')

  // (a2) Bloqueo cruzado.
  r = await carrera('a2', ID.da, acceso(ID.db, 'HABILITADO', 'BLOQUEADO'), ID.db, acceso(ID.da, 'HABILITADO', 'BLOQUEADO'), pidA, pidB)
  exigir(r.rb === '42501', `(a2) se esperaba 42501 y llegó ${r.rb}`)
  exigir((await accesoDe(ID.db, 'a2_db')) === 'BLOQUEADO' && (await accesoDe(ID.da, 'a2_da')) === 'HABILITADO' && (await efectivos()) === '1',
    '(a2) estado final inconsistente')
  tabla.push({ carrera: '(a2) DA bloquea a DB ∥ DB bloquea a DA', primera: r.ra, segunda: r.rb, final: 'solo DB bloqueado, 1 efectivo' })
  await a.ejecutar(`${sesion(ID.da)} ${probar(acceso(ID.db, 'BLOQUEADO', 'HABILITADO'))}`, 'a2_restituir')
  exigir((await resultado(a, 'a2_restituir_r')) === 'OK', '(a2) no se pudo reactivar DB')

  // (a3) Un tercer Director no efectivo degrada a los dos efectivos en
  //      paralelo. Sin serialización, ambos verían al otro y confirmarían.
  r = await carrera('a3', ID.dc, rol(ID.da, 'DIRECTOR', 'PERSONAL'), ID.dc, rol(ID.db, 'DIRECTOR', 'PERSONAL'), pidA, pidB)
  exigir(r.rb === 'P5912', `(a3) se esperaba P5912 y llegó ${r.rb}`)
  exigir((await rolDe(ID.da, 'a3_da')) === 'PERSONAL' && (await rolDe(ID.db, 'a3_db')) === 'DIRECTOR' && (await efectivos()) === '1',
    '(a3) estado final inconsistente')
  tabla.push({ carrera: '(a3) DC degrada a DA ∥ DC degrada a DB', primera: r.ra, segunda: r.rb, final: 'DB sigue siendo el Director efectivo' })
  await a.ejecutar(`${sesion(ID.db)} ${probar(rol(ID.da, 'PERSONAL', 'DIRECTOR'))}`, 'a3_restituir')
  exigir((await resultado(a, 'a3_restituir_r')) === 'OK', '(a3) no se pudo restituir DA')

  // ------------------------------------------------------------------
  // (b1) La salida de DOCENTE confirma primero; reactivar y asignar espera y
  //      rechaza P5611 (ya no tiene el rol).
  const reactivarYAsignar = (doc) =>
    `PERFORM public.cambiar_estado_profesor('${doc}', 'ACTIVO', NULL); PERFORM public.asignar_materia_curso(${MATERIA}, '${ID.curso}', '${doc}')`
  const reactivarYGrupo = (doc, n) =>
    `PERFORM public.cambiar_estado_profesor('${doc}', 'ACTIVO', NULL); PERFORM public.crear_grupo_deportivo('${DEPORTE}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo concurrencia EPT59 ${n}', 10, '${doc}')`
  const aCargo = (doc, e) =>
    propietario(`(SELECT (SELECT count(*) FROM public.materias_cursos WHERE profesor_id = '${doc}' AND activo)
                        + (SELECT count(*) FROM public.grupos_deportivos WHERE profesor_id = '${doc}' AND activo))`, e)

  r = await carrera('b1', ID.da, rol(ID.docB1, 'DOCENTE', 'PERSONAL'), ID.db, reactivarYAsignar(ID.docB1), pidA, pidB)
  exigir(r.rb === 'P5611', `(b1) se esperaba P5611 y llegó ${r.rb}`)
  exigir((await rolDe(ID.docB1, 'b1_rol')) === 'PERSONAL' && (await aCargo(ID.docB1, 'b1_cargo')) === '0',
    '(b1) un no DOCENTE quedó a cargo')
  tabla.push({ carrera: '(b1) DOCENTE→PERSONAL ∥ reactivar+asignar materia', primera: r.ra, segunda: r.rb, final: 'PERSONAL sin asignaciones' })

  // (b2) Reactivar y asignar confirma primero; la salida de DOCENTE espera la
  //      ficha y rechaza P5911.
  await b.ejecutar(`${sesion(ID.db)} BEGIN; ${probar(reactivarYAsignar(ID.docB2))}`, 'b2_b')
  exigir((await resultado(b, 'b2_rb')) === 'OK', '(b2) no se pudo reactivar y asignar')
  let pendiente = a.ejecutar(`${sesion(ID.da)} ${probar(rol(ID.docB2, 'DOCENTE', 'PERSONAL'))}`, 'b2_a')
  await esperarBloqueo(b, pidB, pidA)
  await b.ejecutar('COMMIT; RESET ROLE;', 'b2_commit')
  await pendiente
  let ra = await resultado(a, 'b2_ra')
  exigir(ra === 'P5911', `(b2) se esperaba P5911 y llegó ${ra}`)
  exigir((await rolDe(ID.docB2, 'b2_rol')) === 'DOCENTE' && (await aCargo(ID.docB2, 'b2_cargo')) === '1',
    '(b2) estado final inconsistente')
  tabla.push({ carrera: '(b2) reactivar+asignar materia ∥ DOCENTE→PERSONAL', primera: 'OK', segunda: ra, final: 'DOCENTE con 1 asignación' })

  // (b3) Lo mismo con un grupo deportivo.
  await b.ejecutar(`${sesion(ID.db)} BEGIN; ${probar(reactivarYGrupo(ID.docB3, 'b3'))}`, 'b3_b')
  exigir((await resultado(b, 'b3_rb')) === 'OK', '(b3) no se pudo reactivar y crear el grupo')
  pendiente = a.ejecutar(`${sesion(ID.da)} ${probar(rol(ID.docB3, 'DOCENTE', 'PERSONAL'))}`, 'b3_a')
  await esperarBloqueo(b, pidB, pidA)
  await b.ejecutar('COMMIT; RESET ROLE;', 'b3_commit')
  await pendiente
  ra = await resultado(a, 'b3_ra')
  exigir(ra === 'P5911', `(b3) se esperaba P5911 y llegó ${ra}`)
  exigir((await rolDe(ID.docB3, 'b3_rol')) === 'DOCENTE' && (await aCargo(ID.docB3, 'b3_cargo')) === '1',
    '(b3) estado final inconsistente')
  tabla.push({ carrera: '(b3) reactivar+crear grupo ∥ DOCENTE→PERSONAL', primera: 'OK', segunda: ra, final: 'DOCENTE con 1 grupo' })

  // (b4) La salida de DOCENTE primero; reactivar y crear grupo rechaza P5611.
  r = await carrera('b4', ID.da, rol(ID.docB4, 'DOCENTE', 'PERSONAL'), ID.db, reactivarYGrupo(ID.docB4, 'b4'), pidA, pidB)
  exigir(r.rb === 'P5611', `(b4) se esperaba P5611 y llegó ${r.rb}`)
  exigir((await rolDe(ID.docB4, 'b4_rol')) === 'PERSONAL' && (await aCargo(ID.docB4, 'b4_cargo')) === '0',
    '(b4) un no DOCENTE quedó a cargo')
  tabla.push({ carrera: '(b4) DOCENTE→PERSONAL ∥ reactivar+crear grupo', primera: r.ra, segunda: r.rb, final: 'PERSONAL sin grupos' })

  // ------------------------------------------------------------------
  // (c1) Bloqueo y cambio de rol del mismo perfil: se serializan y ambos
  //      confirman en orden.
  r = await carrera('c1', ID.da, acceso(ID.p, 'HABILITADO', 'BLOQUEADO'), ID.db, rol(ID.p, 'PERSONAL', 'PADRE'), pidA, pidB)
  exigir(r.rb === 'OK', `(c1) se esperaba OK y llegó ${r.rb}`)
  exigir((await rolDe(ID.p, 'c1_rol')) === 'PADRE' && (await accesoDe(ID.p, 'c1_acc')) === 'BLOQUEADO' &&
    (await propietario(`(SELECT string_agg(tipo, ',' ORDER BY id) FROM public.perfiles_historial WHERE perfil_id = '${ID.p}')`, 'c1_hist')) === 'ACCESO,ROL',
    '(c1) estado final o historial inconsistente')
  tabla.push({ carrera: '(c1) bloquear P ∥ cambiar rol de P', primera: r.ra, segunda: r.rb, final: 'BLOQUEADO y PADRE; historial ACCESO,ROL' })

  // (c2) Reactivar dos veces con el mismo valor esperado: el segundo P5909.
  r = await carrera('c2', ID.da, acceso(ID.p, 'BLOQUEADO', 'HABILITADO'), ID.db, acceso(ID.p, 'BLOQUEADO', 'HABILITADO'), pidA, pidB)
  exigir(r.rb === 'P5909', `(c2) se esperaba P5909 y llegó ${r.rb}`)
  exigir((await accesoDe(ID.p, 'c2_acc')) === 'HABILITADO' &&
    (await propietario(`(SELECT count(*) FROM public.perfiles_historial WHERE perfil_id = '${ID.p}' AND tipo = 'ACCESO')`, 'c2_hist')) === '2',
    '(c2) estado final o historial inconsistente')
  tabla.push({ carrera: '(c2) reactivar P ∥ reactivar P (mismo esperado)', primera: r.ra, segunda: r.rb, final: 'HABILITADO; un solo registro' })

  // (d) Dos cambios de rol con el mismo valor esperado.
  r = await carrera('d', ID.da, rol(ID.p, 'PADRE', 'PERSONAL'), ID.db, rol(ID.p, 'PADRE', 'DOCENTE'), pidA, pidB)
  exigir(r.rb === 'P5909', `(d) se esperaba P5909 y llegó ${r.rb}`)
  exigir((await rolDe(ID.p, 'd_rol')) === 'PERSONAL' &&
    (await propietario(`(SELECT count(*) FROM public.profesores WHERE perfil_id = '${ID.p}')`, 'd_ficha')) === '0' &&
    (await propietario(`(SELECT count(*) FROM public.perfiles_historial WHERE perfil_id = '${ID.p}' AND tipo = 'ROL')`, 'd_hist')) === '2',
    '(d) estado final inconsistente')
  tabla.push({ carrera: '(d) PADRE→PERSONAL ∥ PADRE→DOCENTE', primera: r.ra, segunda: r.rb, final: 'PERSONAL, sin ficha creada' })

  // ------------------------------------------------------------------
  // (e) Dos Directores reservan el mismo perfil para el vínculo D5.
  const reservar = (op) =>
    `PERFORM public.reservar_vinculo_cuenta('${op}', '${ID.q}', '95910005', 'TITULAR', NULL, true)`
  r = await carrera('e', ID.da, reservar(P('e1')), ID.db, reservar(P('e2')), pidA, pidB)
  exigir(r.rb === 'P5922', `(e) se esperaba P5922 y llegó ${r.rb}`)
  exigir((await propietario(`(SELECT count(*) FROM app_private.vinculos_cuenta WHERE perfil_id = '${ID.q}')`, 'e_reservas')) === '1',
    '(e) quedó más de una reserva')
  tabla.push({ carrera: '(e) DA reserva Q ∥ DB reserva Q', primera: r.ra, segunda: r.rb, final: '1 reserva PENDIENTE' })

  // Invariantes globales del fixture.
  exigir(
    (await propietario(`(SELECT count(*) FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
        WHERE p.id IN (${lista(PERFILES)}) AND r.nombre <> 'DOCENTE'
          AND (EXISTS (SELECT 1 FROM public.materias_cursos mc WHERE mc.profesor_id = p.id AND mc.activo)
            OR EXISTS (SELECT 1 FROM public.grupos_deportivos g WHERE g.profesor_id = p.id AND g.activo)))`, 'inv_docente')) === '0',
    'Invariante: un no DOCENTE quedó a cargo de una relación activa'
  )
  exigir((await efectivos()) !== '0', 'Invariante: el fixture quedó sin Director efectivo')

  console.table(tabla)
  console.log(`OK EPT59: ${tabla.length} carreras con resultado determinista; ningún no DOCENTE a cargo y siempre un Director efectivo`)
  bien = true
} finally {
  await Promise.allSettled([a.ejecutar('ROLLBACK;', 'rollback'), b.ejecutar('ROLLBACK;', 'rollback')])
  await Promise.allSettled([a.cerrar(), b.cerrar()])
  await limpiar()
  if (bien) console.log('OK EPT59: fixture eliminado sin residuos')
}
