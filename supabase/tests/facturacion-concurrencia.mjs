import assert from 'node:assert/strict'
import { entorno,sql,sembrar,limpieza,tarifas,capturar,alumno,director,id } from './_facturacion-fixture.mjs'
import { SesionPsql,esperarBloqueo } from './_sesion-psql.mjs'

entorno()
const a=new SesionPsql('facturacion A'),b=new SesionPsql('facturacion B'),c=new SesionPsql('facturacion C')
let n=0
function ok(m) {console.log(`OK CARRERA ${++n}: ${m}`)}
const tolerar=s=>`DO $$ BEGIN BEGIN ${s}; PERFORM set_config('ept104.resultado','OK',false);
  EXCEPTION WHEN OTHERS THEN PERFORM set_config('ept104.resultado',SQLSTATE,false); END; END $$;`
try {
  sql(limpieza);sembrar();tarifas()
  const pa=Number(await a.escalar('pg_backend_pid()','pid A'))
  const pb=Number(await b.escalar('pg_backend_pid()','pid B'))
  const pc=Number(await c.escalar('pg_backend_pid()','pid C'))
  const mes=sql(`SELECT (date_trunc('month',clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')+INTERVAL '1 month')::DATE`)
  sql(`UPDATE public.tarifas SET desde='2020-01-01',hasta=NULL WHERE nivel_id IN
      (SELECT id FROM public.niveles WHERE nombre LIKE 'Nivel EPT104%') OR servicio_id IN ('${id(41)}','${id(42)}') OR deporte_id IN ('${id(31)}','${id(32)}');
      UPDATE app_private.facturacion_config SET habilitada=true;`)
  await a.ejecutar(`BEGIN; SELECT app_private.capturar_facturacion('${alumno}','${mes}');`,'captura A')
  const capturaB=b.escalar(`app_private.capturar_facturacion('${alumno}','${mes}')`,'captura B')
  await esperarBloqueo(c,pa,pb)
  await a.ejecutar('COMMIT;','commit captura A')
  const snapshotB=await capturaB
  assert.equal(sql(`SELECT count(*) FROM app_private.facturacion_composiciones WHERE alumno_id='${alumno}' AND periodo='${mes}'`),'1')
  assert.equal(sql(`SELECT id FROM app_private.facturacion_composiciones WHERE alumno_id='${alumno}' AND periodo='${mes}'`),snapshotB)
  ok('dos capturas simultáneas esperan advisory y devuelven única composición confirmada')

  const tarifa=sql(`SELECT id FROM public.tarifas WHERE nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A')`)
  await a.ejecutar(`BEGIN; UPDATE public.tarifas SET importe=101.11 WHERE id='${tarifa}';`,'precio A')
  const emisionB=b.escalar(`app_private.emitir_facturacion('${alumno}','${mes}')`,'emision precio B')
  await esperarBloqueo(c,pa,pb)
  await a.ejecutar('COMMIT;','precio confirmado')
  assert.equal(JSON.parse(await emisionB).total,'192.01')
  ok('precio concurrente: espera fila real, relee precio confirmado y suma NUMERIC exacta')

  const p='2052-02-01';capturar(alumno,p)
  await a.ejecutar(`BEGIN; SELECT app_private.bloquear_referencia_tarifa('CUOTA',
    (SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A'),NULL,NULL);
    UPDATE public.tarifas SET hasta='2051-12-31' WHERE id='${tarifa}';`,'vigencia A')
  const vigenciaB=b.escalar(`app_private.emitir_facturacion('${alumno}','${p}')`,'vigencia B')
  await esperarBloqueo(c,pa,pb)
  await a.ejecutar('COMMIT;','vigencia confirmada')
  assert.equal(JSON.parse(await vigenciaB).resultado,'bloqueada')
  assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumno}' AND periodo='${p}'`),'0')
  ok('vigencia: advisory EPT103 impide precio viejo tras espera; missing no deja factura parcial')
  sql(`UPDATE public.tarifas SET hasta=NULL WHERE id='${tarifa}'`)

  const p3='2053-03-01'
  await a.ejecutar(`BEGIN; SELECT app_private.bloquear_facturacion('${alumno}','${p3}');
    UPDATE public.cursos SET nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B') WHERE id='${id(11)}';
    UPDATE public.inscripciones_servicios SET estado='CANCELADA' WHERE id='${id(61)}';`,'contexto A')
  const contextoB=b.escalar(`app_private.capturar_facturacion('${alumno}','${p3}')`,'contexto B')
  await esperarBloqueo(c,pa,pb)
  await a.ejecutar('COMMIT;','contexto confirmado')
  const snap=await contextoB
  assert.equal(sql(`SELECT jsonb_array_length(origenes) FROM app_private.facturacion_composiciones WHERE id='${snap}'`),'4')
  assert.equal(sql(`SELECT origenes @> jsonb_build_array(jsonb_build_object('tipo','CUOTA','nivel_id',
    (SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B'))) FROM app_private.facturacion_composiciones WHERE id='${snap}'`),'t')
  ok('matrícula/curso/servicio cambiados antes de espera generan un solo contexto MVCC fresco, no mezcla')

  // Job y reintento real usan la misma serialización por clave. Se vuelve a
  // crear una clave pendiente del período actual sin tocar una factura emitida.
  const alumnoJob=id(2);capturar(alumnoJob,mes)
  await a.ejecutar(`BEGIN; SET LOCAL ROLE service_role; SELECT public.facturacion_emitir_job('${alumnoJob}','${mes}');`,'job A')
  await b.ejecutar(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims','{"sub":"${director}","role":"authenticated"}',true);`,'identidad manual B')
  const manualB=b.escalar(`public.facturacion_reintentar('${alumnoJob}','${mes}')`,'manual B')
  await esperarBloqueo(c,pa,pb)
  const revocacionC=c.ejecutar(`BEGIN; UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${director}';`,'revocacion C')
  await esperarBloqueo(a,pb,pc)
  await a.ejecutar('COMMIT;','job commit')
  assert.equal(JSON.parse(await manualB).resultado,'existente')
  await b.ejecutar('COMMIT;','manual commit')
  await revocacionC;await c.ejecutar('COMMIT;','revocacion commit')
  assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumnoJob}' AND periodo='${mes}'`),'1')
  ok('cron contra manual: una factura; revocación espera guarda DIRECTOR durante espera de clave')

  await b.ejecutar(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims','{"sub":"${director}","role":"authenticated"}',true);
    ${tolerar(`PERFORM public.facturacion_reintentar('${alumnoJob}','${mes}')`)}`,'manual tras revocar')
  assert.equal(await b.escalar(`current_setting('ept104.resultado')`,'resultado revocado'),'42501')
  await b.ejecutar('ROLLBACK;','fin manual revocado')
  ok('revocación confirmada primero rechaza reintento, incluso con JWT viejo')
  console.log(`PASS ${n} carreras con conexiones reales y pg_blocking_pids.`)
} finally {
  await Promise.all([a.ejecutar('ROLLBACK;','limpieza A').catch(()=>{}),b.ejecutar('ROLLBACK;','limpieza B').catch(()=>{}),c.ejecutar('ROLLBACK;','limpieza C').catch(()=>{})])
  a.cerrar();b.cerrar();c.cerrar()
  sql(limpieza);sql(`UPDATE app_private.facturacion_config SET habilitada=false`)
}
