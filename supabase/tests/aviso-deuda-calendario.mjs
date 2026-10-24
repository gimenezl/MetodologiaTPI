import assert from 'node:assert/strict'
import { entorno, sql, sembrar, tarifas, facturar, limpieza, reloj, compuertaAviso, hijo2, id } from './_aviso-fixture.mjs'

/**
 * EPT-116 — calendario del aviso de deuda sobre PostgreSQL real, con reloj simulado local.
 * Día 20 calendario (sin ultimo_habil), ventana de reintentos hasta el último día del mes inclusive,
 * meses de 28/29/30/31 días, cambio de año y fecha civil argentina frente a UTC.
 */
entorno()
const PADRE = id(77)
const DNI = '94115770'
let n = 0
const ok = (t) => { n++; console.log(`OK ${n}: ${t}`) }
const plan = () => JSON.parse(sql(`SELECT app_private.aviso_deuda_plan();`))
const filas = () => Number(sql(`SELECT count(*) FROM public.envios_correo WHERE tipo='AVISO_DEUDA' AND padre_id='${PADRE}'`))
const candidato = () => plan().candidatos.some((c) => c.padre_id === PADRE)
/** Un fallo claro del intento del día `hoy` (usa las mismas funciones que el job). */
function fallar(fecha, hoy) {
  reloj(hoy)
  const r = JSON.parse(sql(`SELECT app_private.aviso_deuda_reservar('${PADRE}','${fecha}');`))
  assert.equal(r.reservado, true, `reserva el ${hoy}`)
  assert.equal(sql(`SELECT app_private.aviso_deuda_resultado('${PADRE}','${fecha}','${r.token}','FALLIDO','prueba');`), 't')
}
const limpiarAviso = () => sql(`DELETE FROM public.envios_correo_intentos WHERE envio_id IN (SELECT id FROM public.envios_correo WHERE padre_id='${PADRE}');
  DELETE FROM public.envios_correo WHERE padre_id='${PADRE}';`)

try {
  sql(limpieza); sembrar(); tarifas()
  facturar(hijo2, '2026-11-01')
  sql(`INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni) SELECT '${PADRE}','${PADRE}',r.id,'Padre','Calendario','${DNI}' FROM public.roles r WHERE r.nombre='PADRE';
       INSERT INTO public.padres_hijos(padre_id,hijo_id) VALUES('${PADRE}','${hijo2}');`)
  compuertaAviso(true)

  // Día 19 sin evento; día 20 (también sábado, domingo o lunes feriado) sí.
  for (const [fecha, dia] of [['2026-11-19', 'jueves'], ['2026-11-21', 'sábado sin evento previo']]) {
    reloj(fecha); plan(); assert.equal(filas(), 0, `${fecha} (${dia}) no programa`)
  }
  const casos = [['2026-11-20', 'viernes'], ['2026-12-20', 'domingo'], ['2027-02-20', 'sábado'], ['2027-03-20', 'sábado'], ['2026-09-20', 'domingo'], ['2028-02-20', 'domingo']]
  for (const [fecha, dia] of casos) {
    limpiarAviso(); reloj(fecha); plan()
    assert.equal(filas(), 1, `${fecha} (${dia}) programa el evento`)
    assert.equal(sql(`SELECT fecha_programada||'|'||periodo FROM public.envios_correo WHERE padre_id='${PADRE}' AND tipo='AVISO_DEUDA'`), `${fecha}|${fecha.slice(0, 8)}01`)
  }
  ok('día 19 y día 21 sin evento previo no programan; el día 20 sí, sea cual sea el día de la semana (sin ultimo_habil)')

  // Feriado el día 20: es día calendario y no desplaza el aviso.
  limpiarAviso()
  sql(`INSERT INTO public.feriados(fecha,descripcion) VALUES('2026-11-20','Prueba EPT-116') ON CONFLICT DO NOTHING`)
  reloj('2026-11-20'); plan(); assert.equal(filas(), 1)
  sql(`DELETE FROM public.feriados WHERE descripcion='Prueba EPT-116'`)
  ok('un feriado el día 20 no desplaza ni suprime el aviso')

  // Ventana: último día del mes inclusive; el primer día del mes siguiente ya no se retoma.
  const ventanas = [
    ['2026-11-20', '2026-11-30', '2026-12-01', 'mes de 30 días'],
    ['2026-12-20', '2026-12-31', '2027-01-01', 'diciembre → enero'],
    ['2027-02-20', '2027-02-28', '2027-03-01', 'febrero de 28 días'],
    ['2028-02-20', '2028-02-29', '2028-03-01', 'febrero de 29 días'],
    ['2026-10-20', '2026-10-31', '2026-11-01', 'mes de 31 días'],
  ]
  for (const [evento, ultimo, siguiente, etiqueta] of ventanas) {
    limpiarAviso(); reloj(evento); plan()
    fallar(evento, evento)
    assert.equal(candidato(), false, `${etiqueta}: el mismo día no se reintenta`)
    reloj(evento.slice(0, 8) + '21'); assert.equal(candidato(), true, `${etiqueta}: día 21`)
    reloj(ultimo); assert.equal(candidato(), true, `${etiqueta}: último día (${ultimo}) inclusive`)
    reloj(siguiente); assert.equal(candidato(), false, `${etiqueta}: ${siguiente} no se retoma`)
    assert.equal(JSON.parse(sql(`SELECT app_private.aviso_deuda_reservar('${PADRE}','${evento}');`)).reservado, false)
    assert.equal(filas(), 1, `${etiqueta}: una sola identidad`)
  }
  ok('ventana de reintentos hasta el último día del mes inclusive (28, 29, 30 y 31 días, diciembre/enero) y ninguno el día 1')

  // Un PENDIENTE sin frontera que ya venció la ventana queda FALLIDO; con frontera, INCIERTO.
  limpiarAviso(); reloj('2026-11-20'); plan()
  reloj('2026-12-01'); plan()
  assert.equal(sql(`SELECT estado||'|'||ultimo_error FROM public.envios_correo WHERE padre_id='${PADRE}' AND tipo='AVISO_DEUDA'`), 'FALLIDO|Venció el plazo del último día del mes sin poder enviarse.')
  assert.equal(sql(`SELECT resultado FROM public.envios_correo_intentos i JOIN public.envios_correo e ON e.id=i.envio_id WHERE e.padre_id='${PADRE}'`), 'FALLIDO')
  ok('vencida la ventana, una fila PENDIENTE sin frontera queda FALLIDO con historia')

  // Fecha civil argentina frente a UTC: a las 02:30 UTC del 21 todavía es 20 en Buenos Aires.
  const civil = (i) => sql(`SELECT app_private.recordatorio_fecha_civil('${i}')`)
  assert.equal(civil('2026-11-21 02:59:59+00'), '2026-11-20')
  assert.equal(civil('2026-11-21 03:00:00+00'), '2026-11-21')
  assert.equal(civil('2026-11-20 03:00:00+00'), '2026-11-20')
  assert.equal(civil('2026-11-20 02:59:59+00'), '2026-11-19')
  ok('fecha civil argentina frente a UTC (el día 20 empieza a las 03:00 UTC y termina a las 02:59:59 UTC del 21)')

  // El plan del aviso usa el mismo reloj que el resto y nunca aplica ultimo_habil.
  assert.equal(sql(`SELECT pg_catalog.pg_get_functiondef('app_private.aviso_deuda_plan()'::regprocedure) LIKE '%ultimo_habil%'`), 'f')
  ok('el plan del aviso no usa ultimo_habil')
  console.log(`PASS ${n} escenarios de calendario del aviso.`)
} finally {
  limpiarAviso()
  sql(`DELETE FROM public.padres_hijos WHERE padre_id='${PADRE}'; DELETE FROM public.perfiles WHERE id='${PADRE}';`)
  sql(`DELETE FROM public.feriados WHERE descripcion='Prueba EPT-116'`)
  sql(limpieza)
}
