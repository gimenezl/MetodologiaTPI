// Etapa de integración real de EPT-114 (historial de deuda por ítem) sobre el stack descartable.
// TODAS las lecturas que acreditan acceso usan la sesión real del actor (GoTrue + PostgREST + RLS + RPC);
// service_role/SQL solo prepara fixtures sintéticos y verifica que nada se haya escrito. Los períodos son de
// 2030, fijos: la prueba no depende de la fecha del runner.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function sql(contenedor, texto) {
  return execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: texto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  }).trim()
}

const COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const TR_SUR = 'e0000000-0000-4000-8000-000000000021'
const FUTBOL = 'e0000000-0000-4000-8000-000000000101'

/**
 * ctx: { contenedor, restAdmin, rpc(actor, nombre, cuerpo) → {status, data}, anonima(ruta, metodo, cuerpo) → {status, data},
 *        escribir(actor, ruta, metodo, cuerpo), crearActor(rol, opciones), actores: { docente, personal, director } }
 *
 * Devuelve las credenciales de un padre con un hijo con deuda («Lola») y otro sin ítems («Vacío») y las del propio
 * estudiante, para el escenario de Maestro `deuda.yaml`.
 *
 * Hijo con deuda (importes en pesos, calculados a mano):
 *   2030-03  cuota 50.000 (pagada, pago aprobado)   · fútbol 8.000 (pendiente)
 *   2030-04  cuota 50.000 · recorrido Sur 12.000 · comedor 7.000       (todo pendiente, sin pagos)
 *   total adeudado 77.000,00 · filtrado a abril 69.000,00
 */
export async function ejecutarDeuda(ctx) {
  const { contenedor, actores: a } = ctx
  const padre = await ctx.crearActor('PADRE')
  const copadre = await ctx.crearActor('PADRE')
  const otraFamilia = await ctx.crearActor('PADRE')
  const bloqueada = await ctx.crearActor('PADRE')
  const hijo = await ctx.crearActor('ESTUDIANTE', { legajo: true, nombre: 'Lola' })
  const hijoVacio = await ctx.crearActor('ESTUDIANTE', { legajo: true, nombre: 'Vacío' })
  const hijoOtro = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  await ctx.restAdmin('padres_hijos', 'POST', [
    { padre_id: padre.profileId, hijo_id: hijo.profileId },
    { padre_id: padre.profileId, hijo_id: hijoVacio.profileId },
    { padre_id: copadre.profileId, hijo_id: hijo.profileId },
    { padre_id: otraFamilia.profileId, hijo_id: hijoOtro.profileId },
    { padre_id: bloqueada.profileId, hijo_id: hijo.profileId },
  ], 'return=minimal')
  await ctx.restAdmin(`perfiles?id=eq.${bloqueada.profileId}`, 'PATCH', { estado_acceso: 'BLOQUEADO' }, 'return=minimal')

  const nivel = `Nivel EPT-114 CI ${randomUUID().slice(0, 8)}`
  const id = Object.fromEntries(
    ['curso', 'tCuota', 'tDeporte', 'tTransporte', 'tComedor', 'grupo', 'matH', 'matV', 'matO',
     'f1', 'f2', 'fO', 'i1', 'i2', 'i3', 'i4', 'i5', 'iO', 'p1'].map(k => [k, randomUUID()]),
  )
  const alumnos = [hijo, hijoVacio, hijoOtro].map(x => `'${x.profileId}'`).join(', ')
  sql(contenedor, `
BEGIN;
INSERT INTO public.niveles (nombre, activo, orden) VALUES ('${nivel}', TRUE, 9114);
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES ('${id.curso}', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 'Curso EPT-114 CI', 'A', TRUE);
INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES
 ('${id.matH}', '${hijo.profileId}', '${id.curso}'),
 ('${id.matV}', '${hijoVacio.profileId}', '${id.curso}'),
 ('${id.matO}', '${hijoOtro.profileId}', '${id.curso}');
UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${alumnos});
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.tarifas (id, concepto, nivel_id, deporte_id, servicio_id, importe, desde) VALUES
 ('${id.tCuota}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), NULL, NULL, 50000.00, '2020-01-01'),
 ('${id.tDeporte}', 'DEPORTE', NULL, '${FUTBOL}', NULL, 8000.00, '2020-01-01'),
 ('${id.tTransporte}', 'TRANSPORTE', NULL, NULL, '${TR_SUR}', 12000.00, '2020-01-01'),
 ('${id.tComedor}', 'COMEDOR', NULL, NULL, '${COMEDOR}', 7000.00, '2020-01-01');
INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
VALUES ('${id.grupo}', '${FUTBOL}', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 'Fútbol CI114', 30, '${a.docente.profileId}');
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (2, '18:00', '19:00')
ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT '${id.grupo}', h.id FROM public.horarios h WHERE h.dia_semana = 2 AND h.hora_inicio = '18:00' AND h.hora_fin = '19:00';

INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES
 ('${hijo.profileId}', '${COMEDOR}'), ('${hijo.profileId}', '${TR_SUR}');
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id) VALUES ('${id.i1}', '${hijo.profileId}', '${id.grupo}');

INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 ('${id.f1}', '${hijo.profileId}', '2030-03-01', '2030-03-10', 58000.00),
 ('${id.f2}', '${hijo.profileId}', '2030-04-01', '2030-04-10', 69000.00),
 ('${id.fO}', '${hijoOtro.profileId}', '2030-04-01', '2030-04-10', 50000.00);
COMMIT;`)
  // Los ítems de servicio y deporte referencian la inscripción real del alumno.
  const insDep = id.i1
  const insCom = sql(contenedor, `SELECT id FROM public.inscripciones_servicios WHERE alumno_id='${hijo.profileId}' AND servicio_id='${COMEDOR}';`)
  const insSur = sql(contenedor, `SELECT id FROM public.inscripciones_servicios WHERE alumno_id='${hijo.profileId}' AND servicio_id='${TR_SUR}';`)
  sql(contenedor, `
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, inscripcion_deportiva_id, inscripcion_servicio_id, importe) VALUES
 ('${id.i2}', '${id.f1}', '${hijo.profileId}', 'CUOTA', '${id.tCuota}', '${id.matH}', NULL, NULL, 50000.00),
 ('${id.i3}', '${id.f1}', '${hijo.profileId}', 'DEPORTE', '${id.tDeporte}', NULL, '${insDep}', NULL, 8000.00),
 ('${id.i4}', '${id.f2}', '${hijo.profileId}', 'CUOTA', '${id.tCuota}', '${id.matH}', NULL, NULL, 50000.00),
 ('${id.i5}', '${id.f2}', '${hijo.profileId}', 'TRANSPORTE', '${id.tTransporte}', NULL, NULL, '${insSur}', 12000.00),
 ('${id.iO}', '${id.fO}', '${hijoOtro.profileId}', 'CUOTA', '${id.tCuota}', '${id.matO}', NULL, NULL, 50000.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, inscripcion_deportiva_id, inscripcion_servicio_id, importe)
VALUES ('${randomUUID()}', '${id.f2}', '${hijo.profileId}', 'COMEDOR', '${id.tComedor}', NULL, NULL, '${insCom}', 7000.00);
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado, fecha_transferencia,
                          numero_operacion, estado, verificado_por, verificado_en)
VALUES ('${id.p1}', '${padre.profileId}', '${hijo.profileId}', 50000.00, 49000.00, '2030-03-20',
        'OP-CI-114-${id.p1.slice(0, 8)}', 'APROBADO', '${a.director.profileId}', now());
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa)
VALUES ('${id.p1}', '${id.i2}', '${hijo.profileId}', 50000.00, TRUE);
UPDATE public.items_factura SET estado_pago = 'PAGADO' WHERE id = '${id.i2}';
COMMIT;`)

  const huella = () => sql(contenedor, `SELECT md5(concat(
    (SELECT string_agg(row_to_json(p)::text, '' ORDER BY id) FROM public.pagos p),
    (SELECT string_agg(row_to_json(i)::text, '' ORDER BY id) FROM public.items_factura i),
    (SELECT string_agg(row_to_json(ip)::text, '' ORDER BY pago_id, item_factura_id) FROM public.imputaciones_pago ip),
    (SELECT string_agg(row_to_json(f)::text, '' ORDER BY id) FROM public.facturas f)));`)
  const antes = huella()

  const q = async (actor, alumno, extra = {}) => {
    const r = await ctx.rpc(actor, 'historial_deuda_items', { p_alumno_id: alumno.profileId, ...extra })
    assert.equal(r.status, 200, `historial_deuda_items: estado HTTP inesperado (${r.status}).`)
    return r.data
  }
  const saldos = d => d.filas.reduce((n, f) => n + BigInt(f.saldo_centavos), 0n)

  // 1. Padre, copadre y estudiante propio ven el mismo historial, con la deuda calculada a mano.
  const deHijo = await q(padre, hijo)
  assert.equal(deHijo.total, 5)
  assert.equal(deHijo.totales.adeudado_centavos, '7700000', 'La deuda total no es 77.000,00.')
  assert.equal(saldos(deHijo), 7700000n)
  assert.deepEqual(deHijo.grupos.map(g => [g.tipo, g.saldo_centavos]), [
    ['CUOTA', '5000000'], ['DEPORTE', '800000'], ['TRANSPORTE', '1200000'], ['COMEDOR', '700000']])
  assert.ok(deHijo.filas.every(f => typeof f.saldo_centavos === 'string'), 'Los importes no viajan como texto.')
  const cuotaPagada = deHijo.filas.find(f => f.item_id === id.i2)
  assert.equal(cuotaPagada.estado, 'PAGADO')
  assert.equal(cuotaPagada.pagado_centavos, '5000000', 'El importe informado (49.000,00) alteró lo imputado.')
  for (const actor of [copadre, hijo]) {
    const d = await q(actor, hijo)
    assert.equal(d.totales.adeudado_centavos, '7700000')
    assert.equal(d.huella, deHijo.huella, 'La huella depende del actor.')
  }
  assert.equal((await q(a.director, hijo)).totales.adeudado_centavos, '7700000')
  assert.equal((await q(padre, hijoVacio)).total, 0)

  // 2. Filtro por período de factura: abril incluye las tres facturas de ese mes y excluye la de marzo.
  const abril = await q(padre, hijo, { p_desde: '2030-04-15', p_hasta: '2030-04-30' })
  assert.equal(abril.total, 3)
  assert.equal(abril.totales.adeudado_centavos, '6900000')
  assert.equal(abril.periodo_desde, '2030-04-01')
  const marzo = await q(padre, hijo, { p_desde: '2030-03-01', p_hasta: '2030-03-31' })
  assert.equal(marzo.totales.adeudado_centavos, '800000', 'El pago aprobado de marzo no cubrió la cuota de ese período.')

  // 3. Negativas: identificadores manipulados, otra familia, bloqueo, roles no autorizados y anónimo.
  const vacio = d => d.total === 0 && d.filas.length === 0 && d.totales.adeudado_centavos === '0'
  assert.ok(vacio(await q(padre, hijoOtro)), 'El padre leyó la deuda de otra familia.')
  assert.ok(vacio(await q(otraFamilia, hijo)), 'Otra familia leyó la deuda del hijo.')
  assert.ok(vacio(await q(hijo, hijoVacio)), 'Un estudiante leyó la deuda de un hermano no propio.')
  assert.ok(vacio(await q(hijo, hijoOtro)), 'Un estudiante leyó la deuda de otro estudiante.')
  assert.ok(vacio(await q(bloqueada, hijo)), 'La cuenta bloqueada leyó deuda.')
  for (const actor of [a.docente, a.personal]) assert.ok(vacio(await q(actor, hijo)), 'Un rol sin acceso económico leyó deuda.')
  assert.ok(vacio(await ctx.rpc(padre, 'historial_deuda_items', { p_alumno_id: randomUUID() }).then(r => r.data)))
  const anonimo = await ctx.anonima('/rest/v1/rpc/historial_deuda_items', 'POST', { p_alumno_id: hijo.profileId })
  assert.ok([401, 403].includes(anonimo.status), 'El anónimo ejecutó la consulta de deuda.')
  const invalido = await ctx.rpc(padre, 'historial_deuda_items', { p_alumno_id: hijo.profileId, p_tamano: 7 })
  assert.equal(invalido.data?.code, 'P6872', 'Un tamaño de página inválido no se rechazó.')
  const invertido = await ctx.rpc(padre, 'historial_deuda_items', { p_alumno_id: hijo.profileId, p_desde: '2030-05-01', p_hasta: '2030-04-01' })
  assert.equal(invertido.data?.code, 'P6871', 'Un rango invertido no se rechazó.')
  // Las tablas económicas no se abrieron: el padre sigue sin escribir importes.
  const escritura = await ctx.escribir(padre, `/rest/v1/items_factura?id=eq.${id.i4}`, 'PATCH', { importe: 1 })
  assert.ok([401, 403].includes(escritura.status) || (Array.isArray(escritura.data) && escritura.data.length === 0), 'El padre escribió un importe.')

  // 4. Vínculo revocado: la siguiente lectura ya no entrega nada.
  await ctx.restAdmin(`padres_hijos?padre_id=eq.${copadre.profileId}&hijo_id=eq.${hijo.profileId}`, 'DELETE', undefined, 'return=minimal')
  assert.ok(vacio(await q(copadre, hijo)), 'El vínculo revocado conserva acceso a la deuda.')

  // 5. Consultar no modifica nada.
  assert.equal(huella(), antes, 'Las consultas modificaron datos económicos.')

  // 6. El analizador de producción valida la respuesta real (paginada, filtrada y sin ítems).
  verificarParserMovilReal([deHijo, abril, await q(padre, hijoVacio)])
  return { padre, estudiante: hijo }
}

/** Ejecuta el parser de producción, no una copia JS ni un mock de la RPC. */
function verificarParserMovilReal(documentos) {
  const carpeta = mkdtempSync(join(tmpdir(), 'ept114-rpc-movil-'))
  const archivo = join(carpeta, 'deuda.json')
  const mobile = resolve(import.meta.dirname, '..')
  try {
    writeFileSync(archivo, JSON.stringify(documentos), { encoding: 'utf8', mode: 0o600 })
    execFileSync(process.execPath, [join(mobile, 'node_modules/jest/bin/jest.js'), '--ci', '--runInBand', '__tests__/deuda-rpc-real.test.ts'], {
      cwd: mobile, env: { ...process.env, EPT_DEUDA_RPC_FIXTURE: archivo }, stdio: 'inherit', windowsHide: true, timeout: 30000,
    })
  } finally { rmSync(carpeta, { recursive: true, force: true }) }
}
