import assert from 'node:assert/strict'
import { entorno,sql,sembrar,limpieza,tarifas,capturar,emitir,negativa,alumno,alumno2,id,director } from './_facturacion-fixture.mjs'

entorno()
assert.equal(sql("SELECT pg_catalog.to_regprocedure('app_private.capturar_facturacion(uuid,date)') IS NOT NULL"),'t',
  'RED: falta captura mensual durable EPT-104 en baseline')
let pruebas=0
const padre = id(201)
const padreAjeno = id(202)

// EPT-117: ciclo de pago con centavos. Los valores esperados están escritos a mano en centavos.
// Factura: cuota 100.10 + deporte 0.00 + deporte 20.20 + transporte 30.30 + comedor 40.40 = 191.00 (19100 centavos).
// Los actores operan con SET ROLE + JWT (como PostgREST); el propietario solo prepara fixtures y lee estado.
/** Ejecuta una consulta escalar como `sub` (o anon) con COMMIT propio; devuelve `OK|valor` o `E<SQLSTATE>`. */
function como(sub, consulta, conMensaje = false) {
  const rol = sub ? 'authenticated' : 'anon'
  const claims = sub ? `{"sub":"${sub}","role":"authenticated"}` : '{"role":"anon"}'
  return sql(`DO $d$ DECLARE v TEXT; BEGIN
      PERFORM pg_catalog.set_config('request.jwt.claims', '${claims}', true);
      EXECUTE 'SET LOCAL ROLE ${rol}';
      EXECUTE $c$${consulta}$c$ INTO v;
      EXECUTE 'RESET ROLE';
      PERFORM pg_catalog.set_config('ept117.res', 'OK|' || COALESCE(v, ''), false);
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_catalog.set_config('ept117.res', 'E' || SQLSTATE || CASE WHEN ${conMensaje} THEN '|' || SQLERRM ELSE '' END, false);
    END $d$;
    SELECT pg_catalog.current_setting('ept117.res');`)
}
const json = (res) => { assert.ok(res.startsWith('OK|'), `se esperaba éxito y llegó ${res}`); return JSON.parse(res.slice(3)) }
const arr = (...ids) => `ARRAY[${ids.map((i) => `'${i}'`).join(',')}]::UUID[]`
const cotizar = (sub, ...ids) => como(sub, `SELECT public.cotizar_pago(${arr(...ids)})::TEXT`)
const registrar = (sub, clave, total, ...ids) =>
  como(sub, `SELECT public.registrar_pago('${clave}'::UUID,${arr(...ids)},${total}::BIGINT)::TEXT`)
const verificar = (sub, pago, decision, motivo = null, conMensaje = false) =>
  como(sub, `SELECT public.verificar_pago('${pago}'::UUID,'${decision}',${motivo ? `'${motivo}'` : 'NULL'})::TEXT`, conMensaje)
/** Saldo de la factura leído como el padre (RLS real): `saldo|pagado|estado|enVerificacion|inconsistente`. */
const saldo = (factura) => como(padre, `SELECT saldo_centavos||'|'||pagado_centavos||'|'||estado||'|'||items_en_verificacion||'|'||inconsistente
  FROM public.estado_cuotas_alumno WHERE factura_id='${factura}'`).slice(3)
const estadoItem = (item) => sql(`SELECT estado_pago::TEXT FROM public.items_factura WHERE id='${item}'`)
const itemDe = (factura, tipo, importe) => sql(`SELECT id FROM public.items_factura WHERE factura_id='${factura}' AND tipo='${tipo}' AND importe=${importe}`)
const cuenta = (tabla, filtro) => Number(sql(`SELECT count(*) FROM public.${tabla} WHERE ${filtro}`))
/** Completa los datos de transferencia y el comprobante, que en producción llegan por EPT-109 (aquí, fixture del propietario). */
function completarTransferencia(pago, informado, n) {
  sql(`UPDATE public.pagos SET fecha_transferencia='2026-10-17', importe_informado=${informado}, numero_operacion='OP-EPT117-${n}' WHERE id='${pago}';
    INSERT INTO public.comprobantes_pago(id,pago_id,subido_por,ruta_archivo,tipo_mime,tamano_bytes)
    VALUES('${id(300 + n)}','${pago}','${padre}','${pago}/${id(300 + n)}.png','image/png',1234);`)
}
const limpiarPagos = `BEGIN;
  DELETE FROM public.recibos WHERE pago_id IN (SELECT id FROM public.pagos WHERE alumno_id IN ('${alumno}','${alumno2}'));
  DELETE FROM public.comprobantes_pago WHERE pago_id IN (SELECT id FROM public.pagos WHERE alumno_id IN ('${alumno}','${alumno2}'));
  DELETE FROM public.imputaciones_pago WHERE alumno_id IN ('${alumno}','${alumno2}');
  DELETE FROM public.pagos WHERE alumno_id IN ('${alumno}','${alumno2}');
  DELETE FROM public.padres_hijos WHERE padre_id IN ('${padre}','${padreAjeno}');
  COMMIT;`
const limpiarPadres = `DELETE FROM public.perfiles WHERE id IN ('${padre}','${padreAjeno}');`
function probar(nombre,fn) { fn(); pruebas++; console.log(`OK ${pruebas}: ${nombre}`) }
try {
  sql(limpiarPagos); sql(limpieza); sql(limpiarPadres)
  sembrar()
  const p='2050-12-01'
  let snapshot
  probar('primer intento sin tarifa persiste composición, no factura',()=>{
    snapshot=capturar(alumno,p)
    assert.equal(emitir(alumno,p).resultado,'bloqueada')
    assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumno}'`),'0')
    assert.equal(sql(`SELECT jsonb_array_length(origenes) FROM app_private.facturacion_composiciones WHERE id='${snapshot}'`),'5')
    assert.equal(sql(`SELECT jsonb_array_length(causas) FROM app_private.facturacion_avisos WHERE alumno_id='${alumno}'`),'5')
  })
  probar('snapshot inmutable, DML y reloj inaccesibles a clientes',()=>{
    negativa(`UPDATE app_private.facturacion_composiciones SET origenes='[]' WHERE id='${snapshot}'`,'P6840')
    negativa(`SET LOCAL ROLE authenticated; SELECT app_private.capturar_facturacion('${alumno}','${p}')`,'42501')
    negativa(`SET LOCAL ROLE service_role; UPDATE app_private.facturacion_config SET habilitada=true`,'42501')
    negativa(`SET LOCAL ROLE service_role; INSERT INTO public.facturas(alumno_id,periodo,vencimiento,total) VALUES('${alumno}','2055-01-01','2055-01-10',1)`,'42501')
    negativa(`SET LOCAL ROLE anon; SELECT public.facturacion_plan_job()`,'42501')
    negativa(`SET LOCAL ROLE authenticated; SELECT public.facturacion_iniciar_job('${alumno}','${p}')`,'42501')
    negativa(`SET LOCAL ROLE service_role; SELECT * FROM app_private.facturacion_intentos`,'42501')
    negativa(`SET LOCAL ROLE service_role; SELECT public.facturacion_iniciar_job('${alumno}','${p}')`,'P6842')
  })
  probar('cancelaciones y cambio de nivel no cambian primer contexto',()=>{
    sql(`UPDATE public.inscripciones_servicios SET estado='CANCELADA' WHERE alumno_id='${alumno}';
      UPDATE public.inscripciones_deportivas SET estado='CANCELADA' WHERE alumno_id='${alumno}';
      UPDATE public.cursos SET nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B') WHERE id='${id(11)}';`)
    assert.equal(capturar(alumno,p),snapshot)
    tarifas()
    // El último día incluido coincide exactamente con el día 1 del período.
    sql(`UPDATE public.tarifas SET hasta='${p}' WHERE nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A')`)
    const r=emitir(alumno,p)
    assert.equal(r.resultado,'emitida'); assert.equal(r.total,'191.00')
    assert.equal(sql(`SELECT count(*) FROM public.items_factura WHERE factura_id='${r.factura_id}'`),'5')
    assert.equal(sql(`SELECT count(*) FROM app_private.facturacion_avisos WHERE alumno_id='${alumno}' AND resuelto_en IS NULL`),'0')
    negativa(`INSERT INTO public.facturas(alumno_id,periodo,vencimiento,total) VALUES('${alumno}','${p}','2050-12-10',191.00)`,'23505')
    // EPT-117. Oráculo por ítem, escrito a mano (no calculado con la función evaluada): dos importes erróneos no se compensan.
    const esperados = [
      `CUOTA|${id(21)}|100.10`, `DEPORTE|${id(71)}|0.00`, `DEPORTE|${id(72)}|20.20`,
      `TRANSPORTE|${id(61)}|30.30`, `COMEDOR|${id(62)}|40.40`,
    ].sort()
    const reales = sql(`SELECT i.tipo::TEXT||'|'||COALESCE(i.matricula_id,i.inscripcion_deportiva_id,i.inscripcion_servicio_id)||'|'||i.importe::TEXT
      FROM public.items_factura i WHERE i.factura_id='${r.factura_id}'`).split('\n').sort()
    assert.deepEqual(reales, esperados)
    // Cada ítem usa la tarifa de su concepto y su importe es exactamente el de esa tarifa (sin redondeo ni cálculo en el cliente).
    assert.equal(sql(`SELECT count(*) FROM public.items_factura i JOIN public.tarifas t ON t.id=i.tarifa_id
      WHERE i.factura_id='${r.factura_id}' AND t.concepto=i.tipo AND t.importe=i.importe`), '5')
    assert.equal(sql(`SELECT f.total::TEXT||'|'||sum(i.importe)::TEXT FROM public.facturas f JOIN public.items_factura i ON i.factura_id=f.id
      WHERE f.id='${r.factura_id}' GROUP BY f.total`), '191.00|191.00')
  })
  let historico
  probar('replay no reescribe factura, precios ni estado de ítems',()=>{
    historico=sql(`SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.items_factura i WHERE alumno_id='${alumno}'`)
    sql(`UPDATE public.tarifas SET importe=importe+1 WHERE servicio_id='${id(41)}'`)
    assert.equal(emitir(alumno,p).resultado,'existente')
    assert.equal(sql(`SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.items_factura i WHERE alumno_id='${alumno}'`),historico)
    negativa(`UPDATE public.items_factura SET importe=1 WHERE alumno_id='${alumno}'`,'P6840')
    negativa(`UPDATE public.items_factura SET composicion_id=NULL WHERE alumno_id='${alumno}'`,'P6840')
    negativa(`UPDATE public.facturas SET total=1 WHERE alumno_id='${alumno}'`,'P6840')
  })
  probar('mes siguiente captura contexto nuevo con cero deportes/servicios',()=>{
    capturar(alumno,'2051-01-01')
    assert.equal(sql(`SELECT jsonb_array_length(origenes) FROM app_private.facturacion_composiciones WHERE alumno_id='${alumno}' AND periodo='2051-01-01'`),'1')
    const r=emitir(alumno,'2051-01-01'); assert.equal(r.total,'200.20')
  })
  probar('un deporte, servicio opcional y borde inclusivo día 1',()=>{
    sql(`INSERT INTO public.grupos_deportivos(id,deporte_id,nivel_id,nombre,cupo,profesor_id)
      VALUES('${id(53)}','${id(31)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B'),'Grupo EPT104 C',20,'${id(4)}');
      INSERT INTO public.grupos_deportivos_horarios(grupo_id,horario_id)
      SELECT '${id(53)}',id FROM public.horarios WHERE id='${id(91)}';
      INSERT INTO public.inscripciones_deportivas(alumno_id,grupo_id) VALUES('${alumno2}','${id(53)}');`)
    capturar(alumno2,'2050-01-01');const r=emitir(alumno2,'2050-01-01');assert.equal(r.total,'200.20')
    assert.equal(sql(`SELECT count(*) FROM public.items_factura WHERE factura_id='${r.factura_id}'`),'2')
  })
  probar('aislamiento: otro alumno válido emite aunque una tarifa falte',()=>{
    capturar(alumno2,p); assert.equal(emitir(alumno2,p).resultado,'emitida')
    capturar(alumno,'2049-01-01'); assert.equal(emitir(alumno,'2049-01-01').resultado,'bloqueada')
  })
  probar('vigencia de tarifa: límites inclusivos exactos en desde y hasta (día 1 del período)',()=>{
    const tarifaB=`nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B')`
    const cantidad=(per)=>sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumno2}' AND periodo='${per}'`)
    // desde un día después del período: no vigente; desde el propio día 1: vigente.
    capturar(alumno2,'2050-02-01')
    sql(`UPDATE public.tarifas SET desde='2050-02-02' WHERE ${tarifaB} AND concepto='CUOTA'`)
    assert.equal(emitir(alumno2,'2050-02-01').resultado,'bloqueada'); assert.equal(cantidad('2050-02-01'),'0')
    sql(`UPDATE public.tarifas SET desde='2050-02-01' WHERE ${tarifaB} AND concepto='CUOTA'`)
    const a=emitir(alumno2,'2050-02-01'); assert.equal(a.resultado,'emitida'); assert.equal(a.total,'200.20')
    // hasta el día anterior al período: no vigente; hasta el propio día 1: vigente.
    capturar(alumno2,'2050-04-01')
    sql(`UPDATE public.tarifas SET desde='2050-01-01', hasta='2050-03-31' WHERE ${tarifaB} AND concepto='CUOTA'`)
    assert.equal(emitir(alumno2,'2050-04-01').resultado,'bloqueada'); assert.equal(cantidad('2050-04-01'),'0')
    sql(`UPDATE public.tarifas SET hasta='2050-04-01' WHERE ${tarifaB} AND concepto='CUOTA'`)
    const b=emitir(alumno2,'2050-04-01'); assert.equal(b.resultado,'emitida'); assert.equal(b.total,'200.20')
    sql(`UPDATE public.tarifas SET hasta=NULL WHERE ${tarifaB} AND concepto='CUOTA'`)
  })
  probar('histórico: evidencia falsa alumno/período/nivel/origen rechazada, guarda normal P6802/P6803',()=>{
    const tarifa=sql(`SELECT id FROM public.tarifas WHERE nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B')`)
    const f=sql(`SELECT id FROM public.facturas WHERE alumno_id='${alumno2}' AND periodo='${p}'`)
    negativa(`INSERT INTO public.items_factura(factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe,composicion_id)
      VALUES('${f}','${alumno2}','CUOTA','${tarifa}','${id(21)}',200.20,'${snapshot}')`,'P6802')
    const f1=sql(`SELECT id FROM public.facturas WHERE alumno_id='${alumno}' AND periodo='2051-01-01'`)
    negativa(`INSERT INTO public.items_factura(factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe,composicion_id)
      VALUES('${f1}','${alumno}','CUOTA','${tarifa}','${id(21)}',200.20,'${snapshot}')`,'P6803')
    negativa(`INSERT INTO public.items_factura(factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe)
      VALUES('${f}','${alumno2}','CUOTA','${tarifa}','${id(21)}',200.20)`,'P6802')
    const cuotaA=sql(`SELECT id FROM public.tarifas WHERE nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A')`)
    negativa(`INSERT INTO public.items_factura(factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe)
      VALUES('${f1}','${alumno}','CUOTA','${cuotaA}','${id(21)}',100.10)`,'P6803')
    negativa(`INSERT INTO public.items_factura(factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe,composicion_id)
      VALUES('${f1}','${alumno}','CUOTA','${cuotaA}','${id(21)}',100.10,(SELECT id FROM app_private.facturacion_composiciones WHERE alumno_id='${alumno}' AND periodo='2051-01-01'))`,'P6803')
  })
  probar('escala inválida, NaN/infinito y overflow atómico',()=>{
    negativa(`SELECT app_private.importe_tarifa_valido('10.005')`,'P6812')
    for(const valor of ['NaN','Infinity','-Infinity']) negativa(`SELECT app_private.importe_tarifa_valido('${valor}')`,'P6810')
    // Volver a inscribir servicios mantiene el origen nuevo para el nuevo mes.
    sql(`INSERT INTO public.inscripciones_servicios(alumno_id,servicio_id) VALUES('${alumno}','${id(41)}');
      UPDATE public.tarifas SET importe=9999999999.99 WHERE nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B');`)
    capturar(alumno,'2051-02-01');const r=emitir(alumno,'2051-02-01')
    assert.equal(r.resultado,'bloqueada');assert.equal(r.causas[0].codigo,'TOTAL_FUERA_DE_RANGO')
    assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumno}' AND periodo='2051-02-01'`),'0')
  })
  probar('calendario bisiesto, fin de semana, año y feriado nacional',()=>{
    assert.equal(sql(`SELECT app_private.ultimo_habil('2024-02-01')`),'2024-02-29')
    assert.equal(sql(`SELECT app_private.ultimo_habil('2026-02-01')`),'2026-02-27')
    assert.equal(sql(`SELECT app_private.ultimo_habil('2028-12-01')`),'2028-12-29')
    assert.equal(sql(`BEGIN; INSERT INTO public.feriados(fecha,descripcion) VALUES('2024-02-29','Fixture EPT104');
      SELECT app_private.ultimo_habil('2024-02-01'); ROLLBACK;`),'2024-02-28')
    assert.equal(sql(`SELECT (TIMESTAMPTZ '2027-01-01 02:30Z' AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE`),'2026-12-31')
    assert.deepEqual(JSON.parse(sql(`SELECT app_private.facturacion_plan('2026-12-22 02:00Z')`)),{habilitada:false,candidatos:[]})
    sql(`UPDATE app_private.facturacion_config SET habilitada=true`)
    const antes=JSON.parse(sql(`SELECT app_private.facturacion_plan('2026-12-24 02:30Z')`))
    assert.ok(!antes.candidatos.some(c=>c.periodo==='2027-01-01'))
    const inicio=JSON.parse(sql(`SELECT app_private.facturacion_plan('2026-12-24 06:00Z')`))
    assert.ok(inicio.candidatos.some(c=>c.periodo==='2027-01-01'))
    const tardio=JSON.parse(sql(`SELECT app_private.facturacion_plan('2026-12-31 06:00Z')`))
    assert.ok(!tardio.candidatos.some(c=>c.periodo==='2027-01-01'))
    sql(`UPDATE app_private.facturacion_config SET habilitada=false`)
  })
  probar('avisos solo DIRECTOR habilitado y reintento sin historia arbitraria',()=>{
    negativa(`SET LOCAL ROLE authenticated; SELECT public.facturacion_avisos_director()`,'P5505')
    sql(`UPDATE app_private.facturacion_config SET habilitada=true`)
    const avisos=JSON.parse(sql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${director}","role":"authenticated"}',true);
      SELECT public.facturacion_avisos_director(); ROLLBACK;`).split('\n').at(-1))
    assert.ok(avisos.some(a=>a.periodo==='2051-02-01'))
    assert.equal(JSON.parse(sql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${director}","role":"authenticated"}',true);
      SELECT public.facturacion_reintentar('${alumno}','2060-01-01'); ROLLBACK;`).split('\n').at(-1)).codigo,'SIN_COMPOSICION')
    negativa(`SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims','{"sub":"${alumno2}","role":"authenticated"}',true); PERFORM public.facturacion_avisos_director()`,'42501')
  })
  // EPT-117. Ciclo de pago con centavos reales sobre la factura mensual ya emitida (191.00): actores con SET ROLE + JWT.
  sql(`INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni)
      SELECT x.id::UUID,x.id::UUID,r.id,'Prueba','EPT117',x.dni FROM (VALUES ('${padre}','94117001'),('${padreAjeno}','94117002')) x(id,dni)
      JOIN public.roles r ON r.nombre='PADRE';
    INSERT INTO public.padres_hijos(padre_id,hijo_id) VALUES ('${padre}','${alumno}'),('${padreAjeno}','${alumno2}');`)
  const factura = sql(`SELECT id FROM public.facturas WHERE alumno_id='${alumno}' AND periodo='${p}'`)
  assert.match(factura, /^[0-9a-f-]{36}$/u, 'precondición: la factura de 191.00 debe existir')
  probar('tipo exacto: ningún importe económico es float/real/money y los importes tienen escala 2', () => {
    assert.equal(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND column_name ~ '(importe|total|monto|saldo|precio)' AND data_type IN ('real','double precision','money')`), '0')
    assert.equal(sql(`SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||numeric_scale, ',' ORDER BY table_name, column_name)
      FROM information_schema.columns WHERE table_schema='public' AND (table_name, column_name) IN
      (('items_factura','importe'),('facturas','total'),('pagos','total_calculado'),('pagos','importe_informado'),('imputaciones_pago','importe'),('tarifas','importe'))`),
      'facturas.total:numeric:2,imputaciones_pago.importe:numeric:2,items_factura.importe:numeric:2,pagos.importe_informado:numeric:2,pagos.total_calculado:numeric:2,tarifas.importe:numeric:2')
    // La suma del servidor es NUMERIC exacta (el oráculo 191.00 está escrito a mano).
    assert.equal(sql(`SELECT sum(importe)::TEXT FROM public.items_factura WHERE factura_id='${factura}'`), '191.00')
  })

  const cuota = itemDe(factura, 'CUOTA', '100.10')
  const deporte = itemDe(factura, 'DEPORTE', '20.20')
  const transporte = itemDe(factura, 'TRANSPORTE', '30.30')
  const comedor = itemDe(factura, 'COMEDOR', '40.40')
  const gratis = itemDe(factura, 'DEPORTE', '0.00')
  for (const item of [cuota, deporte, transporte, comedor, gratis]) assert.match(item, /^[0-9a-f-]{36}$/u, 'precondición: ítem de la factura')
  let pago1

  probar('saldo inicial exacto y cotización parcial en centavos (cuota + comedor = 140.50)', () => {
    assert.equal(saldo(factura), '19100|0|PENDIENTE|0|false')
    const c = json(cotizar(padre, cuota, comedor))
    assert.equal(String(c.total_centavos), '14050')
    assert.deepEqual(c.items.map((i) => `${i.tipo}:${i.importe_centavos}`).sort(), ['COMEDOR:4040', 'CUOTA:10010'])
    // El ítem sin cargo no es seleccionable aunque exista; ninguna cotización escribe.
    assert.equal(cotizar(padre, gratis), 'EP6854')
    assert.equal(cuenta('pagos', `alumno_id='${alumno}'`), 0)
  })

  probar('total desactualizado, selección ajena y actores no habilitados no escriben', () => {
    for (const total of [14049, 14051, 1, 19100]) assert.equal(registrar(padre, id(900), total, cuota, comedor), 'EP6857')
    assert.equal(registrar(padreAjeno, id(901), 14050, cuota, comedor), 'EP6851')
    assert.equal(registrar(alumno, id(902), 14050, cuota, comedor), 'E42501')
    assert.equal(registrar(director, id(903), 14050, cuota, comedor), 'E42501')
    assert.equal(registrar(null, id(904), 14050, cuota, comedor), 'E42501')
    assert.equal(registrar(padre, id(905), 14050, cuota, cuota), 'EP6850')
    assert.equal(registrar(padre, id(906), 14050, cuota, transporte), 'EP6857') // mezcla válida pero otro total: sin efectos
    assert.equal(cuenta('pagos', `alumno_id='${alumno}'`), 0)
    assert.equal(cuenta('imputaciones_pago', `alumno_id='${alumno}'`), 0)
    assert.deepEqual([cuota, comedor, transporte, deporte].map(estadoItem), ['PENDIENTE', 'PENDIENTE', 'PENDIENTE', 'PENDIENTE'])
  })

  probar('registro parcial: reserva EN_VERIFICACION sin reducir la deuda y reintento sin duplicados', () => {
    const r = json(registrar(padre, id(910), 14050, cuota, comedor))
    pago1 = r.pago_id
    assert.equal(r.estado, 'PENDIENTE_VERIFICACION'); assert.equal(String(r.total_centavos), '14050'); assert.equal(r.repetido, false)
    assert.deepEqual([cuota, comedor, deporte, transporte].map(estadoItem), ['EN_VERIFICACION', 'EN_VERIFICACION', 'PENDIENTE', 'PENDIENTE'])
    assert.equal(saldo(factura), '19100|0|PENDIENTE|2|false') // la reserva NO descuenta
    const otra = json(registrar(padre, id(910), 14050, cuota, comedor)) // respuesta perdida y reintento
    assert.equal(otra.pago_id, pago1); assert.equal(otra.repetido, true)
    assert.equal(cuenta('pagos', `alumno_id='${alumno}'`), 1)
    assert.equal(cuenta('imputaciones_pago', `pago_id='${pago1}'`), 2)
    assert.equal(sql(`SELECT total_calculado::TEXT||'|'||sum(i.importe)::TEXT FROM public.pagos p JOIN public.imputaciones_pago i ON i.pago_id=p.id WHERE p.id='${pago1}' GROUP BY p.total_calculado`), '140.50|140.50')
    // Misma clave con otro contenido, y otra clave sobre los ítems ya reservados, se rechazan.
    assert.equal(registrar(padre, id(910), 4040, comedor), 'EP6856')
    assert.equal(registrar(padre, id(911), 14050, cuota, comedor), 'EP6853')
    assert.equal(cuenta('pagos', `alumno_id='${alumno}'`), 1)
  })

  probar('aprobar el pago parcial: saldo restante exacto 50.50; comportamiento actual: el importe informado distinto no sustituye el total', () => {
    completarTransferencia(pago1, '140.49', 1)
    // 42501 por la guarda de rol (mensaje propio), no por un GRANT faltante.
    assert.match(verificar(padre, pago1, 'APROBADO', null, true), /^E42501|Solo Dirección habilitada/u)
    assert.match(verificar(alumno, pago1, 'APROBADO', null, true), /^E42501|Solo Dirección habilitada/u)
    assert.equal(verificar(null, pago1, 'APROBADO'), 'E42501')
    assert.equal(saldo(factura), '19100|0|PENDIENTE|2|false') // las negativas no aplican nada
    const a = json(verificar(director, pago1, 'APROBADO'))
    assert.equal(a.estado, 'APROBADO'); assert.equal(a.repetido, false)
    assert.equal(saldo(factura), '5050|14050|PAGO_PARCIAL|0|false')
    assert.equal(sql(`SELECT total_calculado::TEXT||'|'||importe_informado::TEXT FROM public.pagos WHERE id='${pago1}'`), '140.50|140.49')
    assert.deepEqual([cuota, comedor, deporte, transporte].map(estadoItem), ['PAGADO', 'PAGADO', 'PENDIENTE', 'PENDIENTE'])
  })

  probar('aprobación repetida (otro intento del Director) no vuelve a imputar ni a descontar', () => {
    const b = json(verificar(director, pago1, 'APROBADO'))
    assert.equal(b.repetido, true)
    assert.equal(saldo(factura), '5050|14050|PAGO_PARCIAL|0|false')
    assert.equal(cuenta('imputaciones_pago', `pago_id='${pago1}' AND activa`), 2)
    assert.equal(sql(`SELECT sum(importe)::TEXT FROM public.imputaciones_pago WHERE pago_id='${pago1}' AND activa`), '140.50')
    assert.equal(verificar(director, pago1, 'RECHAZADO', 'opuesta'), 'EP6882')
    assert.equal(saldo(factura), '5050|14050|PAGO_PARCIAL|0|false')
  })

  let pago2
  probar('rechazo: no reduce la deuda, libera las reservas y conserva la historia', () => {
    const r = json(registrar(padre, id(920), 2020, deporte))
    pago2 = r.pago_id
    assert.equal(estadoItem(deporte), 'EN_VERIFICACION')
    assert.equal(saldo(factura), '5050|14050|PAGO_PARCIAL|1|false')
    completarTransferencia(pago2, '20.19', 2)
    const x = json(verificar(director, pago2, 'RECHAZADO', '  Comprobante ilegible  '))
    assert.equal(x.estado, 'RECHAZADO'); assert.equal(x.motivo_rechazo, 'Comprobante ilegible')
    assert.equal(saldo(factura), '5050|14050|PAGO_PARCIAL|0|false')
    assert.equal(estadoItem(deporte), 'PENDIENTE')
    assert.equal(sql(`SELECT activa::TEXT FROM public.imputaciones_pago WHERE pago_id='${pago2}'`), 'false')
    assert.equal(cuenta('comprobantes_pago', `pago_id='${pago2}'`), 1)
    assert.equal(json(verificar(director, pago2, 'RECHAZADO', 'otro motivo')).repetido, true)
  })

  probar('pago final (deporte + transporte = 50.50): saldo cero, PAGADA y conservación exacta', () => {
    const r = json(registrar(padre, id(930), 5050, deporte, transporte))
    completarTransferencia(r.pago_id, '50.50', 3)
    assert.equal(json(verificar(director, r.pago_id, 'APROBADO')).estado, 'APROBADO')
    assert.equal(saldo(factura), '0|19100|PAGADA|0|false')
    // Conservación: total facturado = imputaciones activas de pagos aprobados; el rechazado no cuenta; el ítem sin cargo no se imputa.
    assert.equal(sql(`SELECT f.total::TEXT||'|'||(SELECT sum(ip.importe) FROM public.imputaciones_pago ip JOIN public.pagos p ON p.id=ip.pago_id
      WHERE ip.activa AND p.estado='APROBADO' AND ip.alumno_id=f.alumno_id)::TEXT FROM public.facturas f WHERE f.id='${factura}'`), '191.00|191.00')
    assert.equal(cuenta('imputaciones_pago', `alumno_id='${alumno}' AND item_factura_id='${gratis}'`), 0)
    assert.equal(cuenta('imputaciones_pago', `alumno_id='${alumno}' AND item_factura_id IN ('${cuota}','${comedor}','${deporte}','${transporte}') AND activa`), 4)
    // Sin doble conteo por joins: la lectura por ítem concuerda con la lectura por factura (mismo universo, mismo padre).
    assert.equal(como(padre, `SELECT sum(pagado_centavos)||'|'||sum(importe_centavos) FROM public.detalle_cuotas_items WHERE factura_id='${factura}'`), 'OK|19100|19100')
    assert.equal(como(padre, `SELECT count(*) FROM public.detalle_cuotas_items WHERE factura_id='${factura}'`), 'OK|5')
  })

  probar('otra familia no ve esta factura (RLS) y no tiene escritura directa sobre ítems (sin GRANT)', () => {
    assert.equal(como(padreAjeno, `SELECT count(*) FROM public.estado_cuotas_alumno WHERE factura_id='${factura}'`), 'OK|0')
    assert.equal(como(padreAjeno, `SELECT count(*) FROM public.detalle_cuotas_items WHERE factura_id='${factura}'`), 'OK|0')
    assert.equal(como(padreAjeno, `SELECT count(*) FROM public.pagos WHERE alumno_id='${alumno}'`), 'OK|0')
    assert.equal(como(padreAjeno, `UPDATE public.items_factura SET estado_pago='PENDIENTE' WHERE id='${cuota}' RETURNING id::TEXT`), 'E42501')
  })
  console.log(`PASS ${pruebas} escenarios de facturación DB.`)
} finally {
  const fallas=[]
  for (const limpiar of [()=>sql(limpiarPagos),()=>sql(limpieza),()=>sql(limpiarPadres),()=>sql(`UPDATE app_private.facturacion_config SET habilitada=false`)]) {
    try { limpiar() } catch (error) { fallas.push(error) }
  }
  if (fallas.length) throw new AggregateError(fallas,'Limpieza incompleta del fixture.')
}
