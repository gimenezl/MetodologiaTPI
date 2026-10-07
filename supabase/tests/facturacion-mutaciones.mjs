import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { entorno,sql } from './_facturacion-fixture.mjs'

entorno()
const captura=sql(`SELECT pg_get_functiondef('app_private.capturar_facturacion(uuid,date)'::regprocedure)`)
const historico=sql(`SELECT pg_get_functiondef('app_private.verificar_item_factura()'::regprocedure)`)
const ejecutar=()=>spawnSync(process.execPath,['supabase/tests/facturacion.mjs'],{encoding:'utf8',env:process.env})
const mutaciones=[
  ['congelamiento',()=>sql(captura.replace('IF FOUND THEN RETURN v_id; END IF;',
    'IF FOUND THEN RETURN pg_catalog.gen_random_uuid(); END IF;')),()=>sql(captura),/cancelaciones y cambio de nivel|strictEqual/u],
  ['unicidad',()=>sql('ALTER TABLE public.facturas DROP CONSTRAINT facturas_alumno_periodo_unico'),
    ()=>sql('ALTER TABLE public.facturas ADD CONSTRAINT facturas_alumno_periodo_unico UNIQUE(alumno_id,periodo)'),/Negativa: P0001, esperado 23505/u],
  ['validación histórica',()=>sql(`CREATE OR REPLACE FUNCTION app_private.verificar_item_factura() RETURNS TRIGGER
      LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NEW; END $$;`),()=>sql(historico),/esperado P6802|esperado P6803/u],
]
for(const [nombre,mutar,restaurar,marca] of mutaciones) {
  try {
    mutar();const r=ejecutar()
    assert.notEqual(r.status,0,`La mutación ${nombre} pasó inadvertida`)
    assert.match(r.stderr+r.stdout,marca,`La mutación ${nombre} falló por una causa no relacionada`)
    console.log(`OK MUTACIÓN ${nombre}: defecto detectado por suite de comportamiento.`)
  } finally {restaurar()}
}
const final=ejecutar()
assert.equal(final.status,0,final.stderr)
assert.equal(sql(`SELECT pg_get_functiondef('app_private.capturar_facturacion(uuid,date)'::regprocedure)`),captura)
assert.equal(sql(`SELECT pg_get_functiondef('app_private.verificar_item_factura()'::regprocedure)`),historico)
console.log('PASS 3 mutaciones, cuerpos restaurados byte a byte y suite final GREEN.')
