import assert from 'node:assert/strict'
import { entorno,sql,sembrar,limpieza,tarifas,capturar,emitir,negativa,alumno,alumno2,id,director } from './_facturacion-fixture.mjs'

entorno()
assert.equal(sql("SELECT pg_catalog.to_regprocedure('app_private.capturar_facturacion(uuid,date)') IS NOT NULL"),'t',
  'RED: falta captura mensual durable EPT-104 en baseline')
let pruebas=0
function probar(nombre,fn) { fn(); pruebas++; console.log(`OK ${pruebas}: ${nombre}`) }
try {
  sql(limpieza)
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
  console.log(`PASS ${pruebas} escenarios de facturación DB.`)
} finally { sql(limpieza); sql(`UPDATE app_private.facturacion_config SET habilitada=false`); }
