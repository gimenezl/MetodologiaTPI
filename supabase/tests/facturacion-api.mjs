import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { entorno,sql,sembrar,limpieza,tarifas,capturar,alumno,alumno2,id } from './_facturacion-fixture.mjs'
import { crearServidorNext,crearCuentaConPerfil,exigirSesion,cookieDe,rpc,rest,limpiarFixture,crearIntermediario } from './_arnes-ept59.mjs'
import { programarFacturacion } from '../../scripts/facturacion-local.mjs'

const local=entorno()
const servidor=crearServidorNext(31404)
const intermediario=crearIntermediario(local.API_URL)
const secreto=randomBytes(32).toString('hex')
const password=randomBytes(20).toString('hex')
const cuentas=[]
let tarea
let n=0
function ok(nombre) { n++; console.log(`OK ${n}: ${nombre}`) }
async function llamar(ruta,{token,method='GET',cookie,body}={}) {
  return fetch(`${servidor.url}${ruta}`,{method,headers:{
    ...(token?{authorization:`Bearer ${token}`} : {}),...(cookie?{cookie}:{}),
    ...(body?{'content-type':'application/json',origin:servidor.url}:{}),
  },body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30_000)})
}
try {
  sql(limpieza); sembrar(); tarifas()
  const mes=sql(`SELECT (date_trunc('month',clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')+INTERVAL '1 month')::DATE`)
  // Reloj explícito SOLO en setup propietario local, no query/env del caller HTTP.
  sql(`UPDATE public.tarifas SET desde='2020-01-01',hasta=NULL WHERE nivel_id IN
    (SELECT id FROM public.niveles WHERE nombre LIKE 'Nivel EPT104%') OR servicio_id IN ('${id(41)}','${id(42)}') OR deporte_id IN ('${id(31)}','${id(32)}')`)
  capturar(alumno,mes)
  for(const [rol,dni] of [['DIRECTOR','94104901'],['PADRE','94104902']]) {
    const email=`ept104-${dni}@ept104.test`
    const cuenta=await crearCuentaConPerfil(local,{email,password,perfil:{nombre:'Prueba',apellido:'EPT104 API',dni,
      rol_id:Number(sql(`SELECT id FROM public.roles WHERE nombre='${rol}'`))}})
    cuentas.push(cuenta)
  }
  const sesionDir=await exigirSesion(local,'ept104-94104901@ept104.test',password)
  const sesionPadre=await exigirSesion(local,'ept104-94104902@ept104.test',password)
  await intermediario.escuchar(31504)
  const variables={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:31504',NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,CRON_SECRET:secreto,EPT_FACTURACION_HABILITADA:'habilitada'}
  await servidor.iniciar(variables)
  assert.equal((await llamar('/api/cron/facturacion')).status,401)
  assert.equal((await llamar('/api/cron/facturacion',{token:sesionDir.access_token})).status,401)
  assert.equal((await llamar('/api/cron/facturacion?periodo=2050-01-01',{token:secreto})).status,400)
  assert.equal((await llamar('/api/cron/facturacion',{token:secreto,method:'POST'})).status,405)
  ok('cron real rechaza anónimo, sesión humana, parámetros de reloj y método incorrecto')
  const apagado=await (await llamar('/api/cron/facturacion',{token:secreto})).json()
  assert.equal(apagado.habilitada,false)
  assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumno}'`),'0')
  assert.equal(programarFacturacion({url:servidor.url+'/api/cron/facturacion',secreto}).activo,false)
  ok('gates por defecto inactivos no producen facturas ni peticiones automáticas')
  sql(`UPDATE app_private.facturacion_config SET habilitada=true`)
  let resolver,rechazar
  const dosTicks=new Promise((r,j)=>{resolver=r;rechazar=j})
  const resultados=[]
  const timeout=setTimeout(()=>rechazar(new Error('El scheduler no produjo dos ejecuciones reales.')),60_000)
  tarea=programarFacturacion({url:servidor.url+'/api/cron/facturacion',secreto,habilitada:true,intervaloMs:30,
    alResultado:r=>{resultados.push(r);if(resultados.length===2){tarea.detener();resolver()}},
    alError:r=>rechazar(new Error(`Scheduler: ${r.estado}`))})
  try { await dosTicks } finally {clearTimeout(timeout);tarea.detener()}
  assert.equal(resultados[0].emitidas,1)
  assert.equal(resultados[1].emitidas,0)
  assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumno}' AND periodo='${mes}'`),'1')
  ok('scheduler con temporizadores reales llama Next/PostgREST/DB, emite y reejecuta sin duplicar')
  for(const token of [null,sesionPadre.access_token,sesionDir.access_token]) {
    for(const nombre of ['facturacion_capturar_job','facturacion_iniciar_job']) {
      const r=await rpc(local,token,nombre,{p_alumno:alumno,p_periodo:mes})
      assert.ok([401,403].includes(r.estado))
    }
  }
  const snapshotDirecto=await rest(local,sesionDir.access_token,'facturacion_composiciones')
  assert.equal(snapshotDirecto.estado,404)
  assert.equal((await rest(local,sesionDir.access_token,'facturacion_intentos')).estado,404)
  const forjar=await rest(local,sesionPadre.access_token,'items_factura',{method:'POST',body:{composicion_id:id(999)}})
  assert.ok([401,403].includes(forjar.estado))
  ok('frontera PostgREST: generación solo credencial servidor, snapshot fuera API, no DML económico cliente')
  assert.equal((await llamar('/api/facturacion/avisos')).status,401)
  assert.equal((await llamar('/api/facturacion/avisos',{cookie:cookieDe(sesionPadre)})).status,403)
  assert.equal((await llamar('/api/facturacion/avisos',{cookie:cookieDe(sesionDir)})).status,200)
  const privado=await rpc(local,sesionPadre.access_token,'facturacion_avisos_director')
  assert.equal(privado.estado,403)
  ok('avisos de Dirección consultables con getUser real, padre/anónimo rechazados también en DB')
  const manual=await llamar('/api/facturacion/reintentar',{method:'POST',cookie:cookieDe(sesionDir),body:{alumno_id:alumno,periodo:mes}})
  assert.equal(manual.status,200);assert.equal((await manual.json()).resultado,'existente')
  assert.equal((await llamar('/api/facturacion/reintentar',{method:'POST',cookie:cookieDe(sesionPadre),body:{alumno_id:alumno,periodo:mes}})).status,403)
  assert.equal((await llamar('/api/facturacion/reintentar',{method:'POST',cookie:cookieDe(sesionDir),body:{alumno_id:alumno,periodo:mes,total:'1'}})).status,400)
  ok('reintento manual autorizado conserva factura; padre y precio cliente rechazados')
  capturar(alumno2,mes)
  const inicio=intermediario.registro.length
  intermediario.planear('perder-respuesta',p=>p.ruta==='/rest/v1/rpc/facturacion_emitir_job')
  const incierto=await llamar('/api/cron/facturacion',{token:secreto})
  assert.equal(incierto.status,200)
  assert.equal((await incierto.json()).existentes,1)
  const trafico=intermediario.registro.slice(inicio)
  assert.equal(trafico.filter(p=>p.endsWith('/facturacion_emitir_job')).length,1)
  assert.ok(trafico.findIndex(p=>p.endsWith('/facturacion_estado_job'))>trafico.findIndex(p=>p.endsWith('/facturacion_emitir_job')))
  assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${alumno2}' AND periodo='${mes}'`),'1')
  ok('respuesta de emisión perdida: lee estado por clave antes de repetir, descubre COMMIT sin escritura duplicada')
  intermediario.planear('fallar',p=>p.ruta==='/rest/v1/rpc/facturacion_plan_job')
  const falla=await llamar('/api/cron/facturacion',{token:secreto})
  assert.equal(falla.status,503);assert.match((await falla.json()).error,/No se pudo verificar/u)
  ok('fallo real de red devuelve 503 seguro, nunca éxito inventado')
  await servidor.detener()
  await servidor.iniciar({...variables,EPT_FACTURACION_HABILITADA:'deshabilitada'})
  assert.equal((await (await llamar('/api/cron/facturacion',{token:secreto})).json()).habilitada,false)
  ok('gate de entorno desactivado prevalece aunque la base esté activa')
  assert.ok(!servidor.registro.includes(secreto)&&!servidor.registro.includes(local.SERVICE_ROLE_KEY))
  ok('secreto y service_role ausentes de logs de aplicación')
  console.log(`PASS ${n} escenarios API/scheduler reales.`)
} finally {
  tarea?.detener()
  await servidor.detener()
  await intermediario.cerrar()
  sql(limpieza)
  limpiarFixture({prefijoDni:'941049',prefijoCorreo:'ept104-',dominio:'ept104.test'})
  sql(`UPDATE app_private.facturacion_config SET habilitada=false`)
}
