import assert from 'node:assert/strict'
import { SesionPsql, esperarBloqueo } from './_sesion-psql.mjs'
import { actoresFijos as A, ID, PAGO, ITEMS, CARGA, SHA, perfilesFixture, economiaFixture, pagoFixture, cargaFixture, limpiarEconomia } from './_verificacion-fixture.mjs'

if (process.env.DOCKER_HOST && !/^(npipe|unix):/iu.test(process.env.DOCKER_HOST)) throw new Error('Se exige Docker local.')
const sesiones = Object.fromEntries(['a', 'b', 'r', 'c'].map(k => [k, new SesionPsql(k, 'EPT111')]))
const { a, b, r, c } = sesiones
const pids = {}
const pendientes = []
let casos = 0
const como = (actor, rol = 'authenticated') => `RESET ROLE; SET ROLE ${rol}; SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: actor, role: rol })}',false);`
const llamada = decision => `SELECT public.verificar_pago('${PAGO}','${decision}',${decision === 'RECHAZADO' ? "'Motivo original'" : 'NULL'})::TEXT`
const tolerante = sql => `DO $$ BEGIN
  BEGIN PERFORM set_config('ept111.res',( ${sql} ),false);
  EXCEPTION WHEN OTHERS THEN PERFORM set_config('ept111.res',SQLSTATE,false); END; END $$;`
const resultado = s => s.escalar("current_setting('ept111.res',true)", 'resultado')
const seguir = p => { p.catch(() => {}); pendientes.push(p); return p }
const esperar = (bloqueador, bloqueado) => esperarBloqueo(c, pids[bloqueador], pids[bloqueado])

async function restaurar() {
  await Promise.all([a, b, r].map(s => s.ejecutar('ROLLBACK; RESET ROLE;', 'restaurar')))
  await Promise.allSettled(pendientes.splice(0))
  await c.ejecutar(`BEGIN;
    DELETE FROM public.recibos WHERE pago_id IN(SELECT id FROM public.pagos WHERE alumno_id='${A.alumno}');
    DELETE FROM public.comprobantes_pago WHERE pago_id IN(SELECT id FROM public.pagos WHERE alumno_id='${A.alumno}');
    DELETE FROM public.cargas_comprobante WHERE pago_id IN(SELECT id FROM public.pagos WHERE alumno_id='${A.alumno}');
    DELETE FROM public.imputaciones_pago WHERE alumno_id='${A.alumno}';
    DELETE FROM public.pagos WHERE alumno_id='${A.alumno}';
    UPDATE public.items_factura SET estado_pago='PENDIENTE' WHERE alumno_id='${A.alumno}';
    UPDATE public.perfiles SET rol_id=(SELECT id FROM public.roles WHERE nombre='DIRECTOR'),estado_acceso='HABILITADO'
      WHERE id IN('${A.director}','${A.segundo}');
    ${pagoFixture()} COMMIT;`, 'restaurar_datos')
  await a.ejecutar(como(A.director), 'actor_a')
  await b.ejecutar(como(A.segundo), 'actor_b')
}

async function caso(nombre, fn) {
  await restaurar()
  await fn()
  casos++
  console.log(`OK ${casos}: ${nombre}`)
}

async function decisiones(primera, segunda) {
  await a.ejecutar(`BEGIN; ${tolerante(llamada(primera))}`, 'primera')
  const uno = JSON.parse(await resultado(a))
  await b.ejecutar('BEGIN;', 'segunda_begin')
  const dos = seguir(b.ejecutar(tolerante(llamada(segunda)), 'segunda'))
  await esperar('a', 'b')
  await a.ejecutar('COMMIT;', 'primera_commit')
  await dos
  const recibido = await resultado(b)
  if (primera === segunda) {
    const json = JSON.parse(recibido)
    assert.equal(json.repetido, true)
    assert.equal(json.verificado_por, uno.verificado_por)
    assert.equal(json.verificado_en, uno.verificado_en)
  } else assert.equal(recibido, 'P6882')
  await b.ejecutar('COMMIT;', 'segunda_commit')
  assert.equal(await c.escalar(`(SELECT estado::TEXT FROM public.pagos WHERE id='${PAGO}')`, 'estado'), primera)
}

try {
  assert.equal(await c.escalar("COALESCE(host(inet_server_addr()),'socket-local')", 'local'), 'socket-local')
  for (const [k, s] of Object.entries(sesiones)) pids[k] = Number(await s.escalar('pg_backend_pid()', 'pid'))
  await c.ejecutar(`BEGIN; ${perfilesFixture()} ${economiaFixture()} COMMIT;`, 'fixture')
  for (const [uno, dos] of [['APROBADO', 'APROBADO'], ['APROBADO', 'RECHAZADO'], ['RECHAZADO', 'RECHAZADO'], ['RECHAZADO', 'APROBADO']]) {
    await caso(`${uno}/${dos}: espera real, una decisión e identidad original`, () => decisiones(uno, dos))
  }
  for (const cambio of ["rol_id=(SELECT id FROM public.roles WHERE nombre='PERSONAL')", "estado_acceso='BLOQUEADO'"]) {
    for (const decision of ['APROBADO', 'RECHAZADO']) {
      await caso(`revocación primero (${cambio.split('=')[0]}) / ${decision}`, async () => {
        await r.ejecutar(`BEGIN; UPDATE public.perfiles SET ${cambio} WHERE id='${A.director}';`, 'revocar')
        const op = seguir(a.ejecutar(tolerante(llamada(decision)), 'operacion'))
        await esperar('r', 'a')
        await r.ejecutar('COMMIT;', 'revocar_commit')
        await op
        assert.equal(await resultado(a), '42501')
        assert.equal(await c.escalar(`(SELECT estado::TEXT FROM public.pagos WHERE id='${PAGO}')`, 'sin_efectos'), 'PENDIENTE_VERIFICACION')
      })
      await caso(`${decision} primero / revocación (${cambio.split('=')[0]})`, async () => {
        await a.ejecutar(`BEGIN; ${tolerante(llamada(decision))}`, 'op_autorizada')
        assert.equal(JSON.parse(await resultado(a)).estado, decision)
        const revocacion = seguir(r.ejecutar(`BEGIN; UPDATE public.perfiles SET ${cambio} WHERE id='${A.director}'; COMMIT;`, 'revocar'))
        await esperar('a', 'r')
        await a.ejecutar('COMMIT;', 'autorizar_commit')
        await revocacion
        assert.equal(await c.escalar(`(SELECT estado::TEXT FROM public.pagos WHERE id='${PAGO}')`, 'estado'), decision)
      })
    }
  }
  for (const decision of ['APROBADO', 'RECHAZADO']) {
    for (const cargaPrimero of [true, false]) {
      await caso(`finalización / ${decision}, primero ${cargaPrimero ? 'carga' : 'decisión'}`, async () => {
        await c.ejecutar(cargaFixture(), 'carga')
        await b.ejecutar('RESET ROLE; SET ROLE service_role;', 'finalizador')
        const confirmar = `SELECT public.confirmar_carga_comprobante('${A.padre}','${CARGA}','${SHA}',1234,'image/png')::TEXT`
        const primero = cargaPrimero ? b : a
        const despues = cargaPrimero ? a : b
        await primero.ejecutar(`BEGIN; ${tolerante(cargaPrimero ? confirmar : llamada(decision))}`, 'primera')
        const segunda = seguir(despues.ejecutar(tolerante(cargaPrimero ? llamada(decision) : confirmar), 'despues'))
        await esperar(cargaPrimero ? 'b' : 'a', cargaPrimero ? 'a' : 'b')
        await primero.ejecutar('COMMIT;', 'primera_commit')
        await segunda
        const cargaEstado = await c.escalar(`(SELECT estado FROM public.cargas_comprobante WHERE id='${CARGA}')`, 'carga_estado')
        assert.equal(cargaEstado, cargaPrimero ? 'CONFIRMADA' : 'DESCARTADA')
        assert.equal(await c.escalar(`(SELECT estado::TEXT FROM public.pagos WHERE id='${PAGO}')`, 'pago_estado'), decision)
      })
    }
  }
  await caso('consulta de resultado espera a una decisión en vuelo (respuesta perdida)', async () => {
    await a.ejecutar(`BEGIN; ${tolerante(llamada('APROBADO'))}`, 'aprobar')
    const consulta = seguir(b.ejecutar(`SELECT public.consultar_verificacion_pago('${PAGO}');`, 'consultar'))
    await esperar('a', 'b')
    await a.ejecutar('COMMIT;', 'commit')
    assert.match(await consulta, /APROBADO/u)
  })
  await caso('rechazo y nueva reserva concurrente liberan ítems y operación sin ciclo', async () => {
    await a.ejecutar(`BEGIN; ${tolerante(llamada('RECHAZADO'))}`, 'rechazar')
    await b.ejecutar(como(A.padre), 'padre')
    const reserva = seguir(b.ejecutar(`SELECT public.registrar_pago('${ID(901)}',ARRAY['${ITEMS[0]}','${ITEMS[1]}']::UUID[],100000);`, 'reservar'))
    await esperar('a', 'b')
    await a.ejecutar('COMMIT;', 'rechazo_commit')
    await reserva
    const nuevo = await c.escalar(`(SELECT id FROM public.pagos WHERE clave_intento='${ID(901)}')`, 'nuevo')
    await b.ejecutar(`SELECT public.preparar_carga_comprobante('${ID(902)}','${nuevo}','2026-10-17','990','OP-EPT111','image/png',1234);`, 'operacion_liberada')
    assert.equal(await c.escalar(`(SELECT count(*) FROM public.imputaciones_pago WHERE activa AND alumno_id='${A.alumno}')`, 'activas'), '2')
    const repetido = JSON.parse(await a.escalar(`public.verificar_pago('${PAGO}','RECHAZADO','No debe sobrescribir')`, 'repetir'))
    assert.equal(repetido.motivo_rechazo, 'Motivo original')
    assert.equal(await c.escalar(`(SELECT count(*) FROM public.items_factura WHERE id IN('${ITEMS.join("','")}') AND estado_pago='EN_VERIFICACION')`, 'nueva_reserva'), '2')
  })
} finally {
  await Promise.allSettled([a, b, r].map(s => s.ejecutar('ROLLBACK; RESET ROLE;', 'fin')))
  await Promise.allSettled(pendientes)
  await c.ejecutar(`BEGIN; ${limpiarEconomia()}
    ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.perfiles_historial WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '98111%')
      OR actor_perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '98111%');
    ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.alumnos WHERE perfil_id IN('${A.alumno}','${A.ajeno}');
    DELETE FROM public.profesores WHERE perfil_id='${A.docente}';
    DELETE FROM public.perfiles WHERE dni LIKE '98111%'; COMMIT;`, 'limpiar').catch(e => { console.error(e.message); process.exitCode = 1 })
  await Promise.allSettled(Object.values(sesiones).map(s => s.cerrar()))
}
console.log(`${casos} carreras reales completadas; esperas demostradas mediante pg_blocking_pids.`)
