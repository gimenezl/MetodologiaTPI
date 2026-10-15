// Etapa de integración real de EPT-108 (selección y registro del pago) sobre el stack descartable.
// Las facturas e ítems entran por SQL en el contenedor descartable (service_role no tiene INSERT sobre
// ellas desde EPT-104); TODA operación que acredita acceso usa la sesión real del actor (JWT + RLS +
// RPC), nunca service_role. Se crean actores propios: los ítems del flujo de Maestro no se tocan.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

function sql(contenedor, texto) {
  return execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: texto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  }).trim()
}

const periodo = meses =>
  `(date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date + make_interval(months => ${meses}))::date`

const CENTAVOS = 5000000 // ARS 50.000,00 por ítem

/**
 * ctx: { contenedor, restAdmin, leer(actor, ruta), escribir(actor, ruta, metodo, cuerpo),
 *        rpc(actor, nombre, cuerpo) → {status, data}, anonima(ruta, metodo, cuerpo),
 *        crearActor(rol, opciones), actores: { estudianteA, bloqueada, docente, personal, director } }
 */
export async function ejecutarPagos(ctx) {
  const { contenedor, actores: a } = ctx
  const padreP = await ctx.crearActor('PADRE')
  const copadreP = await ctx.crearActor('PADRE')
  const padreOtro = await ctx.crearActor('PADRE')
  const hijoP = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  const hijoQ = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  const hijoOtro = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  await ctx.restAdmin('padres_hijos', 'POST', [
    { padre_id: padreP.profileId, hijo_id: hijoP.profileId },
    { padre_id: padreP.profileId, hijo_id: hijoQ.profileId },
    { padre_id: copadreP.profileId, hijo_id: hijoP.profileId },
    { padre_id: padreOtro.profileId, hijo_id: hijoOtro.profileId },
  ], 'return=minimal')

  const id = Object.fromEntries(
    ['curso', 'matP', 'matQ', 'matO', 'tarifa', 'fP1', 'fP2', 'fP3', 'fP4', 'fP5', 'fPag', 'fVer', 'fCero', 'fQ', 'fO',
      'iP1', 'iP2', 'iP3', 'iP4', 'iP5', 'iPag', 'iVer', 'iCero', 'iQ', 'iO', 'pagoAprobado', 'pagoPendiente'].map(k => [k, randomUUID()]),
  )
  sql(contenedor, `
BEGIN;
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES ('${id.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT-108 CI', 'A', TRUE);
INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES
 ('${id.matP}', '${hijoP.profileId}', '${id.curso}'),
 ('${id.matQ}', '${hijoQ.profileId}', '${id.curso}'),
 ('${id.matO}', '${hijoOtro.profileId}', '${id.curso}');
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN ('${hijoP.profileId}', '${hijoQ.profileId}', '${hijoOtro.profileId}');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
VALUES ('${id.tarifa}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 50000.00, '2020-01-01');
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 ('${id.fP1}', '${hijoP.profileId}', ${periodo(1)}, ${periodo(1)} + 9, 50000.00),
 ('${id.fP2}', '${hijoP.profileId}', ${periodo(2)}, ${periodo(2)} + 9, 50000.00),
 ('${id.fP3}', '${hijoP.profileId}', ${periodo(3)}, ${periodo(3)} + 9, 50000.00),
 ('${id.fP4}', '${hijoP.profileId}', ${periodo(4)}, ${periodo(4)} + 9, 50000.00),
 ('${id.fP5}', '${hijoP.profileId}', ${periodo(5)}, ${periodo(5)} + 9, 50000.00),
 ('${id.fPag}', '${hijoP.profileId}', ${periodo(-1)}, ${periodo(-1)} + 9, 50000.00),
 ('${id.fVer}', '${hijoP.profileId}', ${periodo(-2)}, ${periodo(-2)} + 9, 50000.00),
 ('${id.fCero}', '${hijoP.profileId}', ${periodo(6)}, ${periodo(6)} + 9, 0.00),
 ('${id.fQ}', '${hijoQ.profileId}', ${periodo(1)}, ${periodo(1)} + 9, 50000.00),
 ('${id.fO}', '${hijoOtro.profileId}', ${periodo(1)}, ${periodo(1)} + 9, 50000.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe) VALUES
 ('${id.iP1}', '${id.fP1}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 50000.00),
 ('${id.iP2}', '${id.fP2}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 50000.00),
 ('${id.iP3}', '${id.fP3}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 50000.00),
 ('${id.iP4}', '${id.fP4}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 50000.00),
 ('${id.iP5}', '${id.fP5}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 50000.00),
 ('${id.iPag}', '${id.fPag}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 50000.00),
 ('${id.iVer}', '${id.fVer}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 50000.00),
 ('${id.iCero}', '${id.fCero}', '${hijoP.profileId}', 'CUOTA', '${id.tarifa}', '${id.matP}', 0.00),
 ('${id.iQ}', '${id.fQ}', '${hijoQ.profileId}', 'CUOTA', '${id.tarifa}', '${id.matQ}', 50000.00),
 ('${id.iO}', '${id.fO}', '${hijoOtro.profileId}', 'CUOTA', '${id.tarifa}', '${id.matO}', 50000.00);
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado, fecha_transferencia,
                          numero_operacion, estado, verificado_por, verificado_en)
VALUES ('${id.pagoAprobado}', '${padreP.profileId}', '${hijoP.profileId}', 50000.00, 50000.00, CURRENT_DATE,
        'OP-CI-108-${id.pagoAprobado.slice(0, 8)}', 'APROBADO', '${a.director.profileId}', now());
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado)
VALUES ('${id.pagoPendiente}', '${copadreP.profileId}', '${hijoP.profileId}', 50000.00);
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe) VALUES
 ('${id.pagoAprobado}', '${id.iPag}', '${hijoP.profileId}', 50000.00),
 ('${id.pagoPendiente}', '${id.iVer}', '${hijoP.profileId}', 50000.00);
UPDATE public.items_factura SET estado_pago = 'PAGADO' WHERE id = '${id.iPag}';
UPDATE public.items_factura SET estado_pago = 'EN_VERIFICACION' WHERE id = '${id.iVer}';
COMMIT;`)

  const rpc = async (actor, nombre, cuerpo) => ctx.rpc(actor, nombre, cuerpo)
  const cotizar = (actor, ids) => rpc(actor, 'cotizar_pago', { p_item_ids: ids })
  const registrar = (actor, clave, ids, total) =>
    rpc(actor, 'registrar_pago', { p_clave_intento: clave, p_item_ids: ids, p_total_esperado_centavos: total })
  const filas = async (actor, ruta) => {
    const r = await ctx.leer(actor, `/rest/v1/${ruta}`)
    assert.equal(r.status, 200, `Lectura ${ruta}: estado HTTP inesperado.`)
    return r.data
  }
  const rechazo = (r, status, codigo, etiqueta) => {
    assert.equal(r.status, status, `${etiqueta}: estado HTTP ${r.status}, se esperaba ${status}.`)
    assert.equal(r.data?.code, codigo, `${etiqueta}: código ${r.data?.code}, se esperaba ${codigo}.`)
  }

  // 1. Cotización: total en centavos exactos del servidor y datos bancarios ficticios; sin efectos.
  const antes = (await filas(padreP, 'pagos?select=id')).length
  const c1 = await cotizar(padreP, [id.iP1, id.iP2])
  assert.equal(c1.status, 200)
  assert.equal(c1.data.total_centavos, CENTAVOS * 2)
  assert.ok(Number.isSafeInteger(c1.data.total_centavos))
  assert.equal(c1.data.alumno_id, hijoP.profileId)
  assert.deepEqual(c1.data.items.map(i => i.item_id).sort(), [id.iP1, id.iP2].sort())
  assert.equal(c1.data.banco.ficticio, true)
  assert.match(c1.data.banco.cbu, /^0{22}$/u)
  assert.equal((await filas(padreP, 'pagos?select=id')).length, antes, 'Cotizar escribió un pago.')
  const estadosAntes = await filas(padreP, `items_factura?select=estado_pago&id=in.(${id.iP1},${id.iP2})`)
  assert.deepEqual(estadosAntes.map(i => i.estado_pago), ['PENDIENTE', 'PENDIENTE'])

  // 2. Selecciones inválidas: errores explícitos y sin escritura.
  rechazo(await cotizar(padreP, [id.iP1, id.iQ]), 400, 'P6852', 'Mezcla de hijos')
  rechazo(await cotizar(padreP, [id.iO]), 400, 'P6851', 'Ítem de otra familia')
  rechazo(await cotizar(padreP, [id.iP1, id.iO]), 400, 'P6851', 'Propio mezclado con ajeno')
  rechazo(await cotizar(padreP, [randomUUID()]), 400, 'P6851', 'Ítem inexistente')
  rechazo(await cotizar(padreP, []), 400, 'P6850', 'Selección vacía')
  rechazo(await cotizar(padreP, [id.iP1, id.iP1]), 400, 'P6850', 'Selección duplicada')
  rechazo(await cotizar(padreP, [id.iPag]), 400, 'P6853', 'Ítem pagado')
  rechazo(await cotizar(padreP, [id.iVer]), 400, 'P6853', 'Ítem en verificación')
  rechazo(await cotizar(padreP, [id.iP1, id.iPag]), 400, 'P6853', 'Disponible mezclado con pagado')
  rechazo(await cotizar(padreP, [id.iCero]), 400, 'P6854', 'Ítem sin cargo')

  // 3. Roles y cuentas no autorizadas: 42501 por la vía real, aun con ítems propios.
  for (const [actor, etiqueta] of [
    [hijoP, 'estudiante propio'], [a.estudianteA, 'estudiante'], [a.docente, 'docente'],
    [a.personal, 'personal'], [a.director, 'director'], [a.bloqueada, 'cuenta bloqueada'],
  ]) {
    rechazo(await cotizar(actor, [id.iP1]), 403, '42501', `Cotizar como ${etiqueta}`)
    rechazo(await registrar(actor, randomUUID(), [id.iP1], CENTAVOS), 403, '42501', `Registrar como ${etiqueta}`)
    rechazo(await rpc(actor, 'consultar_intento_pago', { p_clave_intento: randomUUID() }), 403, '42501', `Consultar como ${etiqueta}`)
  }
  const anonima = await ctx.anonima('/rest/v1/rpc/registrar_pago', 'POST', {
    p_clave_intento: randomUUID(), p_item_ids: [id.iP1], p_total_esperado_centavos: CENTAVOS,
  })
  assert.ok([401, 403].includes(anonima.status), 'El anónimo ejecutó el registro.')
  rechazo(await cotizar(padreOtro, [id.iP1]), 400, 'P6851', 'Padre de otra familia')

  // 4. Total manipulado o desactualizado: nada se escribe.
  const K0 = randomUUID()
  rechazo(await registrar(padreP, K0, [id.iP1, id.iP2], 1), 400, 'P6857', 'Total manipulado a la baja')
  rechazo(await registrar(padreP, K0, [id.iP1, id.iP2], CENTAVOS * 10), 400, 'P6857', 'Total manipulado al alza')
  assert.equal((await filas(padreP, 'pagos?select=id')).length, antes, 'Un total rechazado dejó un pago.')

  // 5. Registro: pago pendiente, imputaciones, reserva y saldo intacto.
  const K1 = randomUUID()
  const r1 = await registrar(padreP, K1, [id.iP1, id.iP2], CENTAVOS * 2)
  assert.equal(r1.status, 200)
  assert.equal(r1.data.estado, 'PENDIENTE_VERIFICACION')
  assert.equal(r1.data.repetido, false)
  assert.equal(r1.data.total_centavos, CENTAVOS * 2)
  const pago = (await filas(padreP, `pagos?select=*&id=eq.${r1.data.pago_id}`))[0]
  assert.equal(pago.estado, 'PENDIENTE_VERIFICACION')
  assert.equal(pago.padre_id, padreP.profileId)
  assert.equal(pago.alumno_id, hijoP.profileId)
  assert.equal(Number(pago.total_calculado), 100000)
  assert.equal(pago.numero_operacion, null)
  assert.equal(pago.importe_informado, null)
  assert.equal(pago.fecha_transferencia, null)
  const imputaciones = await filas(padreP, `imputaciones_pago?select=item_factura_id,importe,activa&pago_id=eq.${r1.data.pago_id}`)
  assert.deepEqual(imputaciones.map(i => i.item_factura_id).sort(), [id.iP1, id.iP2].sort())
  assert.ok(imputaciones.every(i => i.activa === true && Number(i.importe) === 50000))
  const reservados = await filas(padreP, `items_factura?select=estado_pago&id=in.(${id.iP1},${id.iP2})`)
  assert.deepEqual(reservados.map(i => i.estado_pago), ['EN_VERIFICACION', 'EN_VERIFICACION'])
  const saldo = (await filas(padreP, `estado_cuotas_alumno?select=saldo_centavos,pagado_centavos,estado&factura_id=eq.${id.fP1}`))[0]
  assert.equal(saldo.saldo_centavos, CENTAVOS, 'Un pago pendiente redujo el saldo.')
  assert.equal(saldo.pagado_centavos, 0)
  assert.notEqual(saldo.estado, 'PAGADA')
  // El copadre y el estudiante propio ven el pago; la familia ajena, no.
  assert.equal((await filas(copadreP, `pagos?select=id&id=eq.${r1.data.pago_id}`)).length, 1)
  assert.equal((await filas(hijoP, `pagos?select=id&id=eq.${r1.data.pago_id}`)).length, 1)
  assert.equal((await filas(padreOtro, `pagos?select=id&id=eq.${r1.data.pago_id}`)).length, 0)

  // 6. Idempotencia y conflictos de clave.
  const r1b = await registrar(padreP, K1, [id.iP2, id.iP1], CENTAVOS * 2)
  assert.equal(r1b.status, 200)
  assert.equal(r1b.data.pago_id, r1.data.pago_id)
  assert.equal(r1b.data.repetido, true)
  rechazo(await registrar(padreP, K1, [id.iP3], CENTAVOS), 400, 'P6856', 'Misma clave con otra selección')
  rechazo(await registrar(padreP, randomUUID(), [id.iP1], CENTAVOS), 400, 'P6853', 'Ítem ya reservado con otra clave')
  rechazo(await cotizar(copadreP, [id.iP2]), 400, 'P6853', 'Ítem reservado visto por el copadre')

  // 7. Consulta del resultado de un intento.
  const q1 = await rpc(padreP, 'consultar_intento_pago', { p_clave_intento: K1 })
  assert.equal(q1.status, 200)
  assert.equal(q1.data.registrado, true)
  assert.equal(q1.data.pago_id, r1.data.pago_id)
  assert.equal((await rpc(padreP, 'consultar_intento_pago', { p_clave_intento: randomUUID() })).data.registrado, false)
  assert.equal((await rpc(copadreP, 'consultar_intento_pago', { p_clave_intento: K1 })).data.registrado, false,
    'Un padre consultó el intento de otro.')

  // 8. Dos actores reales sobre el mismo ítem, con claves distintas: exactamente uno gana.
  const [g1, g2] = await Promise.all([
    registrar(padreP, randomUUID(), [id.iP3], CENTAVOS),
    registrar(copadreP, randomUUID(), [id.iP3], CENTAVOS),
  ])
  assert.deepEqual([g1.status, g2.status].sort(), [200, 400], 'Dos registros concurrentes sobre un mismo ítem no se excluyeron.')
  rechazo(g1.status === 400 ? g1 : g2, 400, 'P6853', 'Perdedor de la reserva')
  const reservasP3 = await filas(padreP, `imputaciones_pago?select=pago_id&item_factura_id=eq.${id.iP3}&activa=eq.true`)
  assert.equal(reservasP3.length, 1, 'El ítem quedó reservado más de una vez.')

  // 9. El mismo intento enviado dos veces a la vez (doble toque): un solo pago.
  const K4 = randomUUID()
  const [d1, d2] = await Promise.all([
    registrar(padreP, K4, [id.iP4], CENTAVOS),
    registrar(padreP, K4, [id.iP4], CENTAVOS),
  ])
  assert.equal(d1.status, 200)
  assert.equal(d2.status, 200)
  assert.equal(d1.data.pago_id, d2.data.pago_id)
  assert.deepEqual([d1.data.repetido, d2.data.repetido].sort(), [false, true])
  const pagosK4 = await filas(padreP, `pagos?select=id&clave_intento=eq.${K4}`)
  assert.equal(pagosK4.length, 1)

  // 10. Ninguna escritura directa por la API de tablas.
  const alta = await ctx.escribir(padreP, '/rest/v1/pagos', 'POST', {
    padre_id: padreP.profileId, alumno_id: hijoP.profileId, total_calculado: 1,
  })
  assert.ok(alta.status === 401 || alta.status === 403, 'Un padre insertó un pago por la API de tablas.')
  const modifica = await ctx.escribir(padreP, `/rest/v1/items_factura?id=eq.${id.iP5}`, 'PATCH', { estado_pago: 'PAGADO' })
  assert.ok(modifica.status === 401 || modifica.status === 403, 'Un padre modificó un ítem por la API de tablas.')
  assert.equal((await filas(padreP, `items_factura?select=estado_pago&id=eq.${id.iP5}`))[0].estado_pago, 'PENDIENTE')

  // 11. Vínculo revocado: el siguiente registro se rechaza y no escribe.
  await ctx.restAdmin(`padres_hijos?padre_id=eq.${padreP.profileId}&hijo_id=eq.${hijoQ.profileId}`, 'DELETE', undefined, 'return=minimal')
  rechazo(await registrar(padreP, randomUUID(), [id.iQ], CENTAVOS), 400, 'P6851', 'Vínculo revocado')
  assert.equal((await ctx.restAdmin(`items_factura?select=estado_pago&id=eq.${id.iQ}`, 'GET'))[0].estado_pago, 'PENDIENTE')

  return id
}
