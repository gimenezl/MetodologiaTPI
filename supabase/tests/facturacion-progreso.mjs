import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { entorno,sql,sembrar,limpieza,tarifas,id,negativa } from './_facturacion-fixture.mjs'
import { crearServidorNext,crearIntermediario } from './_arnes-ept59.mjs'

const local=entorno()
const servidor=crearServidorNext(31404)
const intermediario=crearIntermediario(local.API_URL)
const secreto=randomBytes(32).toString('hex')
const original=sql(`SELECT pg_get_functiondef('app_private.facturacion_plan(timestamptz)'::regprocedure)`)
const rango=`SELECT ('b1040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1001,1101) n`
const limpiarLote=`BEGIN;
DELETE FROM public.items_factura WHERE alumno_id IN (${rango});
DELETE FROM public.facturas WHERE alumno_id IN (${rango});
DELETE FROM app_private.facturacion_avisos WHERE alumno_id IN (${rango});
DO $$ BEGIN IF to_regclass('app_private.facturacion_intentos') IS NOT NULL THEN
  DELETE FROM app_private.facturacion_intentos WHERE alumno_id IN (${rango}); END IF; END $$;
ALTER TABLE app_private.facturacion_composiciones DISABLE TRIGGER composicion_inmutable;
DELETE FROM app_private.facturacion_composiciones WHERE alumno_id IN (${rango});
ALTER TABLE app_private.facturacion_composiciones ENABLE TRIGGER composicion_inmutable;
DELETE FROM public.matriculas WHERE alumno_id IN (${rango});
DELETE FROM public.alumnos WHERE perfil_id IN (${rango});
DELETE FROM public.perfiles WHERE id IN (${rango}); COMMIT;`
function preparar(caso) {
  sql(limpiarLote);sql(limpieza);sembrar();tarifas()
  sql(`BEGIN;
    INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni,legajo_nro)
    SELECT ('b1040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('b1040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      (SELECT id FROM public.roles WHERE nombre='ESTUDIANTE'),'Prueba','EPT104 progreso',
      (94105000+n)::text,'EPT104-P-'||n FROM generate_series(1001,1101) n;
    -- Solo propietario local sintetiza contexto inconsistente; las guardas
    -- productivas permanecen intactas y el ajuste muere con esta transacción.
    COMMIT; BEGIN; SET LOCAL session_replication_role='replica';
    UPDATE public.alumnos SET estado='INACTIVO' WHERE perfil_id IN ('${id(1)}','${id(2)}');
    UPDATE public.alumnos SET estado='ACTIVO' WHERE perfil_id IN (${rango});
    INSERT INTO public.matriculas(id,alumno_id,curso_id)
    SELECT ('b1040000-0000-4000-8000-'||lpad((n+1000)::text,12,'0'))::uuid,
      ('b1040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      CASE WHEN n=1101 THEN '${id(12)}'::uuid ELSE '${id(11)}'::uuid END
    FROM generate_series(${caso==='contextos'?1101:1001},1101) n;
    UPDATE app_private.facturacion_config SET habilitada=true; COMMIT;`)
  if(caso==='tarifas')sql(`DELETE FROM public.tarifas WHERE nivel_id=(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A')`)
}
async function ejecutar() {
  const r=await fetch(servidor.url+'/api/cron/facturacion',{headers:{authorization:`Bearer ${secreto}`},signal:AbortSignal.timeout(65_000)})
  return {estado:r.status,datos:await r.json()}
}
let liberar
try {
  // Reloj de prueba exclusivamente propietario en stack descartable; se restaura
  // el cuerpo exacto. El endpoint y las RPC conservan sus firmas sin reloj público.
  sql(original.replace("(p_ahora AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE",
      "(app_private.ultimo_habil(DATE '2050-01-01') - 1)"))
  await intermediario.escuchar(31504)
  await servidor.iniciar({NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:31504',NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,CRON_SECRET:secreto,EPT_FACTURACION_HABILITADA:'habilitada'})
  const casos=process.env.EPT_PROGRESO_ESCENARIO?[process.env.EPT_PROGRESO_ESCENARIO]:['tarifas','contextos','incierto','inicio-incierto','presupuesto']
  for(const caso of casos) {
    preparar(caso)
    if(caso==='incierto')for(let n=0;n<100;n++)intermediario.planear('fallar',p=>p.ruta.endsWith('/facturacion_capturar_job'))
    if(caso==='inicio-incierto')for(let n=0;n<100;n++)intermediario.planear('perder-respuesta',p=>p.ruta.endsWith('/facturacion_iniciar_job'))
    if(caso==='presupuesto') {
      const hasta=new Promise(r=>{liberar=r})
      for(let n=0;n<20;n++)intermediario.planear('retener',p=>p.ruta.endsWith('/facturacion_capturar_job'),{hasta})
    }
    const primero=await ejecutar()
    if(caso==='presupuesto') {
      const iniciados=Number(sql(`SELECT count(*) FROM app_private.facturacion_intentos WHERE alumno_id IN (${rango})`))
      assert.ok(iniciados>0&&iniciados<100,'El presupuesto solo marca claves realmente iniciadas.')
      assert.equal(sql(`SELECT count(*) FROM app_private.facturacion_composiciones WHERE alumno_id IN (${rango})`),'0')
      intermediario.descartarPlanes();liberar();liberar=null
      // Las peticiones tardías pueden confirmar capturas; esperar antes de reset
      // no altera la tentativa ya confirmada ni permite retener conexiones ajenas.
      await new Promise(r=>setTimeout(r,500))
    } else {
      assert.equal(primero.datos.emitidas,0)
      if(['incierto','inicio-incierto'].includes(caso)) {
        assert.ok(primero.datos.inciertas>0&&primero.datos.inciertas<=100)
        assert.equal(sql(`SELECT count(*) FROM app_private.facturacion_composiciones WHERE alumno_id IN (${rango})`),'0')
        assert.equal(sql(`SELECT count(*) FROM app_private.facturacion_avisos WHERE alumno_id IN (${rango})`),'0')
        assert.equal(Number(sql(`SELECT count(*) FROM app_private.facturacion_intentos WHERE alumno_id IN (${rango})`)),primero.datos.inciertas)
        intermediario.descartarPlanes()
      }
    }
    await ejecutar()
    assert.equal(sql(`SELECT count(*) FROM public.facturas WHERE alumno_id='${id(1101)}' AND periodo='2050-02-01'`),'1',
      `${caso}: alumno101 debe progresar en la segunda llamada, sin repetir prefijo.`)
    console.log(`OK progreso ${caso}: alumno101 emitido; lote y reloj de producción conservados.`)
  }
  // Fuera de ventana nunca se ofrece una clave nueva, aunque exista una tentativa.
  preparar('contextos')
  sql(original)
  sql(`INSERT INTO app_private.facturacion_intentos(alumno_id,periodo,iniciado_en)
    VALUES('${id(1101)}','2050-02-01',clock_timestamp())`)
  const plan=JSON.parse(sql(`SELECT app_private.facturacion_plan('2050-02-01 12:00Z')`))
  assert.equal(plan.candidatos.length,0)
  negativa(`SET LOCAL ROLE service_role; SELECT public.facturacion_iniciar_job('${id(1101)}','2050-02-01')`,'P6842')
  assert.equal(sql(`SELECT count(*) FROM app_private.facturacion_composiciones WHERE alumno_id IN (${rango})`),'0')
  console.log(`PASS ${casos.length} escenarios de progreso y frontera de ventana.`)
} finally {
  intermediario.descartarPlanes();liberar?.()
  await servidor.detener();await intermediario.cerrar()
  sql(original);sql(limpiarLote);sql(limpieza)
  sql(`UPDATE app_private.facturacion_config SET habilitada=false`)
  assert.equal(sql(`SELECT pg_get_functiondef('app_private.facturacion_plan(timestamptz)'::regprocedure)`),original)
}
