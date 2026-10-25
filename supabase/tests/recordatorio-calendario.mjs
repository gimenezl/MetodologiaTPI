import assert from 'node:assert/strict'
import { entorno, sql } from './_recordatorio-fixture.mjs'

/**
 * EPT-115 / EPT-158 — último día hábil y fecha civil argentina, sobre la MISMA
 * función de EPT-104 (`app_private.ultimo_habil`). Los feriados que se insertan
 * son de prueba y se retiran al terminar.
 */
entorno()
const FERIADOS = ['2026-09-30', '2026-09-29', '2026-12-31', '2026-12-30', '2028-02-29', '2027-01-29', '2027-01-28',
  '2026-10-31', '2026-10-30', '2026-10-29', '2026-10-15']
const habil = (mes) => sql(`SELECT app_private.ultimo_habil('${mes}')`)
/** SQLSTATE y mensaje con que la función rechaza una entrada (o NO_RECHAZADA si la acepta). */
const rechazo = (argumento) => sql(`DO $$ BEGIN BEGIN PERFORM app_private.ultimo_habil(${argumento}); RAISE EXCEPTION 'NO_RECHAZADA';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_catalog.set_config('ept117.resultado', SQLSTATE || '|' || SQLERRM, false); END; END $$;
  SELECT pg_catalog.current_setting('ept117.resultado');`)
const civil = (instante) => sql(`SELECT app_private.recordatorio_fecha_civil('${instante}')`)
let n = 0
const ok = (t) => { n++; console.log(`OK ${n}: ${t}`) }
const limpiar = () => sql(`DELETE FROM public.feriados WHERE fecha IN (${FERIADOS.map((f) => `'${f}'`).join(',')})`)

try {
  limpiar()
  assert.equal(habil('2026-09-01'), '2026-09-30') // el mes termina en miércoles hábil
  assert.equal(habil('2026-10-15'), '2026-10-30') // 31/10 es sábado
  assert.equal(habil('2027-01-10'), '2027-01-29') // 31/01/2027 es domingo
  ok('mes terminado en día hábil, sábado y domingo')

  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2026-09-30','Prueba'),('2026-09-29','Prueba')`)
  assert.equal(habil('2026-09-01'), '2026-09-28') // 30 y 29 feriados encadenados → lunes 28
  ok('feriados encadenados retroceden hasta el hábil anterior')

  assert.equal(habil('2024-02-01'), '2024-02-29') // bisiesto, jueves
  assert.equal(habil('2028-02-01'), '2028-02-29') // bisiesto, martes
  assert.equal(habil('2027-02-01'), '2027-02-26') // no bisiesto: 28/02/2027 es domingo
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2028-02-29','Prueba')`)
  assert.equal(habil('2028-02-01'), '2028-02-28')
  ok('febrero bisiesto y no bisiesto, con y sin feriado el 29')

  assert.equal(habil('2026-12-01'), '2026-12-31')
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2026-12-31','Prueba'),('2026-12-30','Prueba')`)
  assert.equal(habil('2026-12-01'), '2026-12-29')
  assert.equal(habil('2027-01-01'), '2027-01-29')
  ok('diciembre y enero (cambio de año), con feriados de fin de año')

  // EPT-117. Feriados SINTÉTICOS de prueba (no son fechas nacionales reales), insertados solo en el fixture local.
  // Enero de 2027 termina en domingo: viernes 29 feriado → jueves 28; con el 28 también feriado → miércoles 27.
  assert.equal(habil('2027-01-01'), '2027-01-29')
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2027-01-29','Prueba sintética EPT-117')`)
  assert.equal(habil('2027-01-01'), '2027-01-28')
  assert.equal(habil('2027-01-31'), '2027-01-28') // el día del mes elegido como argumento no cambia el resultado
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2027-01-28','Prueba sintética EPT-117')`)
  assert.equal(habil('2027-01-15'), '2027-01-27')
  ok('enero de 2027 (domingo) con feriado sintético el viernes 29 retrocede al jueves 28; con el 28 también, al miércoles 27')

  // Sábado 31/10/2026 + viernes feriado → jueves 29; un feriado en sábado o en otro mes no altera el resultado.
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2026-10-31','Prueba sintética EPT-117'),('2026-10-15','Prueba sintética EPT-117')`)
  assert.equal(habil('2026-10-01'), '2026-10-30')
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2026-10-30','Prueba sintética EPT-117')`)
  assert.equal(habil('2026-10-01'), '2026-10-29')
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES ('2026-10-29','Prueba sintética EPT-117')`)
  assert.equal(habil('2026-10-01'), '2026-10-28')
  assert.equal(habil('2026-11-01'), '2026-11-30') // los feriados de octubre no se filtran a noviembre
  ok('fin de semana más feriados previos: se retrocede día a día hasta el hábil; los feriados en sábado o de otro mes no influyen')

  // Contrato de entradas inválidas: P6841 con su mensaje, no otro fallo (p. ej. desbordamiento de fechas).
  for (const argumento of ['NULL::DATE', "'infinity'::DATE", "'-infinity'::DATE"]) {
    assert.equal(rechazo(argumento), 'P6841|Mes inválido.', `${argumento} debe rechazarse con P6841`)
  }
  ok('mes nulo o no finito se rechaza con SQLSTATE P6841 y mensaje propio')

  // El día argentino cambia a las 03:00 UTC, no a las 00:00 UTC.
  assert.equal(civil('2026-10-31 02:30+00'), '2026-10-30')
  assert.equal(civil('2026-10-31 03:00+00'), '2026-10-31')
  assert.equal(civil('2026-10-30 23:59+00'), '2026-10-30')
  assert.equal(civil('2026-12-31 02:59:59+00'), '2026-12-30')
  assert.equal(civil('2027-01-01 02:59+00'), '2026-12-31')
  ok('fecha civil argentina frente a UTC (22:30 del 30/10 en Buenos Aires es 01:30 UTC del 31/10)')

  // La función de recordatorio y la de facturación comparten el mismo calendario.
  assert.equal(sql(`SELECT pg_catalog.pg_get_functiondef('app_private.recordatorio_plan()'::regprocedure) LIKE '%app_private.ultimo_habil%'`), 't')
  assert.equal(sql(`SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app_private' AND p.proname LIKE '%ultimo_habil%'`), '1')
  ok('un solo calendario: el plan del recordatorio reutiliza app_private.ultimo_habil de EPT-104')
  console.log(`PASS ${n} escenarios de calendario.`)
} finally {
  limpiar()
}
