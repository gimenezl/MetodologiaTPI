// Etapa de integración real de EPT-110 (consulta de inscripciones y de facturas y comprobantes por período)
// sobre el stack descartable. TODAS las lecturas que acreditan acceso usan la sesión real del actor
// (GoTrue + PostgREST + RLS + RPC); service_role/SQL solo prepara fixtures sintéticos y verifica que nada
// se haya escrito. Los períodos son de 2030, fijos: la prueba no depende de la fecha del runner.
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
const TR_NORTE = 'e0000000-0000-4000-8000-000000000020'
const TR_SUR = 'e0000000-0000-4000-8000-000000000021'
const FUTBOL = 'e0000000-0000-4000-8000-000000000101'
const NATACION = 'e0000000-0000-4000-8000-000000000102'

/**
 * ctx: { contenedor, restAdmin, rpc(actor, nombre, cuerpo) → {status, data}, leer(actor, ruta) → {status, data},
 *        escribir(actor, ruta, metodo, cuerpo) → {status, data}, anonima(ruta, metodo, cuerpo) → {status, data},
 *        crearActor(rol, opciones), actores: { docente, personal, director } }
 *
 * Devuelve las credenciales del padre (con un hijo con datos y otro sin inscripciones) y del propio estudiante
 * con datos, para los escenarios de Maestro (`consultas.yaml` y `consultas-estudiante.yaml`).
 */
export async function ejecutarConsultas(ctx) {
  const { contenedor, actores: a } = ctx
  const padre = await ctx.crearActor('PADRE')
  const copadre = await ctx.crearActor('PADRE')
  const otraFamilia = await ctx.crearActor('PADRE')
  const bloqueada = await ctx.crearActor('PADRE')
  const hijo = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  const hijoVacio = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  const hijoOtro = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  const padreMaestro = await ctx.crearActor('PADRE')
  const hijoMaestro = await ctx.crearActor('ESTUDIANTE', { legajo: true, nombre: 'Marina' })
  const hijoMaestroVacio = await ctx.crearActor('ESTUDIANTE', { legajo: true, nombre: 'Vacío' })
  await ctx.restAdmin('padres_hijos', 'POST', [
    { padre_id: padre.profileId, hijo_id: hijo.profileId },
    { padre_id: padre.profileId, hijo_id: hijoVacio.profileId },
    { padre_id: copadre.profileId, hijo_id: hijo.profileId },
    { padre_id: otraFamilia.profileId, hijo_id: hijoOtro.profileId },
    { padre_id: bloqueada.profileId, hijo_id: hijo.profileId },
    { padre_id: padreMaestro.profileId, hijo_id: hijoMaestro.profileId },
    { padre_id: padreMaestro.profileId, hijo_id: hijoMaestroVacio.profileId },
  ], 'return=minimal')
  await ctx.restAdmin(`perfiles?id=eq.${bloqueada.profileId}`, 'PATCH', { estado_acceso: 'BLOQUEADO' }, 'return=minimal')

  const nivel = `Nivel EPT-110 CI ${randomUUID().slice(0, 8)}`
  const id = Object.fromEntries(
    ['curso', 'tarifa', 'grupoF', 'grupoN', 'matH', 'matV', 'matO', 'matM', 'matMV', 'ctF', 'ctN',
     'f1', 'f2', 'f3', 'fO', 'fM1', 'fM2', 'i1', 'i2', 'i3', 'iO', 'iM1', 'iM2',
     'p1', 'p2', 'p3', 'pO', 'pM1', 'pM2', 'c1', 'c2', 'c3', 'c4', 'cO', 'cM1']
      .map(k => [k, randomUUID()]),
  )
  const alumnos = [hijo, hijoVacio, hijoOtro, hijoMaestro, hijoMaestroVacio].map(x => `'${x.profileId}'`).join(', ')
  sql(contenedor, `
BEGIN;
INSERT INTO public.niveles (nombre, activo, orden) VALUES ('${nivel}', TRUE, 9110);
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES ('${id.curso}', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 'Curso EPT-110 CI', 'A', TRUE);
INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES
 ('${id.matH}', '${hijo.profileId}', '${id.curso}'),
 ('${id.matV}', '${hijoVacio.profileId}', '${id.curso}'),
 ('${id.matO}', '${hijoOtro.profileId}', '${id.curso}'),
 ('${id.matM}', '${hijoMaestro.profileId}', '${id.curso}'),
 ('${id.matMV}', '${hijoMaestroVacio.profileId}', '${id.curso}');
UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${alumnos});
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
VALUES ('${id.tarifa}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 50000.00, '2020-01-01');

INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id) VALUES
 ('${id.grupoF}', '${FUTBOL}', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 'Fútbol CI110', 30, '${a.docente.profileId}'),
 ('${id.grupoN}', '${NATACION}', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 'Natación CI110', 30, '${a.docente.profileId}');
INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (1, '17:00', '18:00'), (3, '17:00', '18:00')
ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT '${id.grupoF}', h.id FROM public.horarios h WHERE h.dia_semana = 1 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00';
INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
SELECT '${id.grupoN}', h.id FROM public.horarios h WHERE h.dia_semana = 3 AND h.hora_inicio = '17:00' AND h.hora_fin = '18:00';

-- Hijo con datos: fútbol ACTIVA, natación CANCELADA, comedor ACTIVA, TR-NORTE CANCELADA y TR-SUR ACTIVA.
INSERT INTO public.inscripciones_deportivas (id, alumno_id, grupo_id) VALUES
 ('${id.ctF}', '${hijo.profileId}', '${id.grupoF}'), ('${id.ctN}', '${hijo.profileId}', '${id.grupoN}');
UPDATE public.inscripciones_deportivas SET estado = 'CANCELADA' WHERE id = '${id.ctN}';
INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES
 ('${hijo.profileId}', '${COMEDOR}'), ('${hijo.profileId}', '${TR_NORTE}');
UPDATE public.inscripciones_servicios SET estado = 'CANCELADA'
WHERE alumno_id = '${hijo.profileId}' AND servicio_id = '${TR_NORTE}';
INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES ('${hijo.profileId}', '${TR_SUR}');
-- Otra familia y el hijo del flujo de Maestro (un deporte activo y el comedor).
INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES
 ('${hijoOtro.profileId}', '${COMEDOR}'), ('${hijoMaestro.profileId}', '${COMEDOR}');
INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id) VALUES ('${hijoMaestro.profileId}', '${id.grupoF}');

-- Facturas de 2030 (fijas): 2030-11, 2030-12, 2031-01. Una de otra familia y dos del hijo de Maestro.
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 ('${id.f1}', '${hijo.profileId}', '2030-11-01', '2030-11-10', 50000.00),
 ('${id.f2}', '${hijo.profileId}', '2030-12-01', '2030-12-10', 50000.00),
 ('${id.f3}', '${hijo.profileId}', '2031-01-01', '2031-01-10', 50000.00),
 ('${id.fO}', '${hijoOtro.profileId}', '2030-12-01', '2030-12-10', 50000.00),
 ('${id.fM1}', '${hijoMaestro.profileId}', '2030-03-01', '2030-03-10', 50000.00),
 ('${id.fM2}', '${hijoMaestro.profileId}', '2030-04-01', '2030-04-10', 50000.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe) VALUES
 ('${id.i1}', '${id.f1}', '${hijo.profileId}', 'CUOTA', '${id.tarifa}', '${id.matH}', 50000.00),
 ('${id.i2}', '${id.f2}', '${hijo.profileId}', 'CUOTA', '${id.tarifa}', '${id.matH}', 50000.00),
 ('${id.i3}', '${id.f3}', '${hijo.profileId}', 'CUOTA', '${id.tarifa}', '${id.matH}', 50000.00),
 ('${id.iO}', '${id.fO}', '${hijoOtro.profileId}', 'CUOTA', '${id.tarifa}', '${id.matO}', 50000.00),
 ('${id.iM1}', '${id.fM1}', '${hijoMaestro.profileId}', 'CUOTA', '${id.tarifa}', '${id.matM}', 50000.00),
 ('${id.iM2}', '${id.fM2}', '${hijoMaestro.profileId}', 'CUOTA', '${id.tarifa}', '${id.matM}', 50000.00);

-- Pagos:
--   p1 (padre) multifactura 2030-12 y 2031-01, APROBADO, transferencia 2031-01-05, dos archivos
--   p2 (copadre) 2030-11, PENDIENTE, transferencia 2030-11-30 (borde de mes), un archivo del copadre
--   p3 (padre) sin datos ni archivo
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado, fecha_transferencia,
                          numero_operacion, estado, verificado_por, verificado_en) VALUES
 ('${id.p1}', '${padre.profileId}', '${hijo.profileId}', 100000.00, 100000.00, '2031-01-05',
  'OP-CI-110-${id.p1.slice(0, 8)}', 'APROBADO', '${a.director.profileId}', now());
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado, fecha_transferencia, numero_operacion)
VALUES ('${id.p2}', '${copadre.profileId}', '${hijo.profileId}', 50000.00, 50000.00, '2030-11-30',
        'OP-CI-110-${id.p2.slice(0, 8)}');
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado) VALUES ('${id.p3}', '${padre.profileId}', '${hijo.profileId}', 50000.00);
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado, fecha_transferencia, numero_operacion)
VALUES ('${id.pO}', '${otraFamilia.profileId}', '${hijoOtro.profileId}', 50000.00, 50000.00, '2030-12-02',
        'OP-CI-110-${id.pO.slice(0, 8)}');
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado, fecha_transferencia, numero_operacion)
VALUES ('${id.pM1}', '${padreMaestro.profileId}', '${hijoMaestro.profileId}', 50000.00, 50000.00, '2030-03-20',
        'OP-CI-110-${id.pM1.slice(0, 8)}');
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe, activa) VALUES
 ('${id.p1}', '${id.i2}', '${hijo.profileId}', 50000.00, TRUE), ('${id.p1}', '${id.i3}', '${hijo.profileId}', 50000.00, TRUE),
 ('${id.p2}', '${id.i1}', '${hijo.profileId}', 50000.00, TRUE),
 -- p3 quedó fuera de vigencia sobre el mismo ítem (un ítem solo admite una imputación activa).
 ('${id.p3}', '${id.i1}', '${hijo.profileId}', 50000.00, FALSE),
 ('${id.pO}', '${id.iO}', '${hijoOtro.profileId}', 50000.00, TRUE), ('${id.pM1}', '${id.iM1}', '${hijoMaestro.profileId}', 50000.00, TRUE);
UPDATE public.items_factura SET estado_pago = 'PAGADO' WHERE id IN ('${id.i2}', '${id.i3}');
UPDATE public.items_factura SET estado_pago = 'EN_VERIFICACION' WHERE id IN ('${id.i1}', '${id.iO}', '${id.iM1}');
INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes) VALUES
 ('${id.c1}', '${id.p1}', '${padre.profileId}', '${id.p1}/${id.c1}.pdf', 'application/pdf', 1000),
 ('${id.c2}', '${id.p1}', '${padre.profileId}', '${id.p1}/${id.c2}.png', 'image/png', 2000),
 ('${id.c3}', '${id.p2}', '${copadre.profileId}', '${id.p2}/${id.c3}.jpg', 'image/jpeg', 3000),
 ('${id.cO}', '${id.pO}', '${otraFamilia.profileId}', '${id.pO}/${id.cO}.pdf', 'application/pdf', 1000),
 ('${id.cM1}', '${id.pM1}', '${padreMaestro.profileId}', '${id.pM1}/${id.cM1}.pdf', 'application/pdf', 1000);
COMMIT;`)

  const huella = () => sql(contenedor, `SELECT
    (SELECT count(*) FROM public.pagos) || ':' || (SELECT count(*) FROM public.imputaciones_pago) || ':' ||
    (SELECT count(*) FROM public.comprobantes_pago) || ':' || (SELECT count(*) FROM public.inscripciones_deportivas) || ':' ||
    (SELECT count(*) FROM public.inscripciones_servicios) || ':' || (SELECT count(*) FROM public.facturas) || ':' ||
    (SELECT coalesce(sum(total), 0) FROM public.facturas) || ':' ||
    (SELECT string_agg(id::text || estado::text, ',' ORDER BY id) FROM public.pagos) || ':' ||
    (SELECT string_agg(id::text || estado::text, ',' ORDER BY id) FROM public.inscripciones_servicios);`)
  const antes = huella()

  const q = async (actor, nombre, cuerpo) => {
    const r = await ctx.rpc(actor, nombre, cuerpo)
    assert.equal(r.status, 200, `${nombre}: estado HTTP inesperado (${r.status}).`)
    return r.data
  }
  const insc = (actor, alumno) => q(actor, 'consultar_inscripciones_alumno', { p_alumno_id: alumno.profileId })
  const fact = (actor, alumno, d, h) => q(actor, 'consultar_facturas_periodo', { p_alumno_id: alumno.profileId, p_desde: d, p_hasta: h })
  const reg = (actor, alumno, c, d, h) => q(actor, 'consultar_registro_comprobantes',
    { p_alumno_id: alumno.profileId, p_criterio: c, p_desde: d, p_hasta: h })

  const registroPendienteMovil = await reg(padreMaestro, hijoMaestro, 'PERIODO_FACTURA', '2030-01-01', '2030-12-31')

  // 1. Inscripciones: padre, copadre y estudiante propio ven lo mismo; el hijo sin inscripciones, vacío.
  const deHijo = await insc(padre, hijo)
  assert.deepEqual(deHijo.map(i => `${i.categoria}:${i.estado}`).sort(),
    ['COMEDOR:ACTIVA', 'DEPORTE:ACTIVA', 'DEPORTE:CANCELADA', 'TRANSPORTE:ACTIVA', 'TRANSPORTE:CANCELADA'])
  assert.ok(deHijo.filter(i => i.estado === 'CANCELADA').every(i => i.fecha_cancelacion), 'Una cancelada no informa su fecha.')
  assert.ok(deHijo.every(i => !Object.keys(i).some(k => /ruta|path|profesor|user|email/iu.test(k))), 'La respuesta expone campos sensibles.')
  assert.equal((await insc(copadre, hijo)).length, 5)
  assert.equal((await insc(hijo, hijo)).length, 5)
  assert.deepEqual(await insc(padre, hijoVacio), [])

  // 2. Negativas: identificadores manipulados, otra familia, cuenta bloqueada, roles no autorizados y anónimo.
  assert.deepEqual(await insc(padre, hijoOtro), [], 'El padre leyó inscripciones de otra familia.')
  assert.deepEqual(await insc(otraFamilia, hijo), [])
  assert.deepEqual(await insc(hijo, hijoOtro), [], 'Un estudiante leyó inscripciones de otro estudiante.')
  assert.deepEqual(await insc(hijo, hijoVacio), [], 'Un estudiante leyó las de un hermano no propio.')
  assert.deepEqual(await insc(bloqueada, hijo), [], 'La cuenta bloqueada leyó inscripciones.')
  for (const actor of [a.docente, a.personal]) assert.deepEqual(await insc(actor, hijo), [])
  assert.equal((await insc(a.director, hijo)).length, 5)
  assert.deepEqual(await q(padre, 'consultar_inscripciones_alumno', { p_alumno_id: randomUUID() }), [])
  const anonimo = await ctx.anonima('/rest/v1/rpc/consultar_inscripciones_alumno', 'POST', { p_alumno_id: hijo.profileId })
  assert.ok([401, 403].includes(anonimo.status), 'El anónimo ejecutó la consulta de inscripciones.')
  // La RLS de las tablas no se abrió al padre.
  for (const tabla of ['inscripciones_servicios', 'inscripciones_deportivas']) {
    const r = await ctx.leer(padre, `/rest/v1/${tabla}?select=id`)
    assert.equal(r.status, 200)
    assert.deepEqual(r.data, [], `El padre lee ${tabla} directamente.`)
  }

  // 3. Sin altas, modificaciones ni cancelaciones por escritura directa.
  for (const [tabla, metodo, cuerpo] of [
    ['inscripciones_servicios', 'POST', { alumno_id: hijo.profileId, servicio_id: TR_SUR }],
    ['inscripciones_servicios', 'PATCH', { estado: 'CANCELADA' }],
    ['inscripciones_deportivas', 'POST', { alumno_id: hijo.profileId, grupo_id: id.grupoF }],
    ['inscripciones_deportivas', 'DELETE', undefined],
  ]) {
    for (const actor of [padre, hijo]) {
      const r = await ctx.escribir(actor, `/rest/v1/${tabla}?alumno_id=eq.${hijo.profileId}`, metodo, cuerpo)
      assert.ok(r.status >= 400, `${actor.rol} escribió ${tabla} con ${metodo}.`)
    }
  }

  // 4. Facturas por período: mes calendario, bordes de mes/año y sin mezclar hijos.
  const todas = await fact(padre, hijo, '2030-01-01', '2031-12-31')
  assert.deepEqual(todas.map(f => f.periodo), ['2031-01-01', '2030-12-01', '2030-11-01'])
  assert.ok(todas.every(f => f.alumno_id === hijo.profileId))
  for (const f of todas) {
    for (const campo of ['total_centavos', 'pagado_centavos', 'saldo_centavos']) assert.ok(Number.isSafeInteger(f[campo]))
  }
  assert.deepEqual((await fact(padre, hijo, '2030-12-15', '2031-01-02')).map(f => f.periodo), ['2031-01-01', '2030-12-01'],
    'El filtro por período no incluye los meses completos de los extremos.')
  assert.deepEqual((await fact(padre, hijo, '2030-12-31', '2030-12-31')).map(f => f.periodo), ['2030-12-01'])
  assert.deepEqual(await fact(padre, hijo, '2032-01-01', '2032-12-31'), [])
  const porPeriodo = Object.fromEntries(todas.map(f => [f.periodo, f]))
  assert.deepEqual([porPeriodo['2030-12-01'].cantidad_pagos, porPeriodo['2030-12-01'].cantidad_archivos], [1, 2],
    'El pago multifactura con dos archivos no se contó bien en diciembre.')
  assert.deepEqual([porPeriodo['2031-01-01'].cantidad_pagos, porPeriodo['2031-01-01'].cantidad_archivos], [1, 2])
  assert.deepEqual([porPeriodo['2030-11-01'].cantidad_pagos, porPeriodo['2030-11-01'].cantidad_archivos], [2, 1])
  assert.equal(todas.reduce((s, f) => s + f.total_centavos, 0), 3 * 5_000_000, 'Los importes se duplicaron por los JOIN.')
  assert.deepEqual(await fact(padre, hijoOtro, '2030-01-01', '2031-12-31'), [])
  assert.deepEqual(await fact(hijo, hijoOtro, '2030-01-01', '2031-12-31'), [])
  assert.equal((await fact(hijo, hijo, '2030-01-01', '2031-12-31')).length, 3)
  assert.deepEqual(await fact(bloqueada, hijo, '2030-01-01', '2031-12-31'), [])
  for (const actor of [a.docente, a.personal]) assert.deepEqual(await fact(actor, hijo, '2030-01-01', '2031-12-31'), [])

  // 5. Rangos inválidos: error de validación, no un resultado vacío.
  for (const [d, h, codigo] of [['2031-01-01', '2030-01-01', 'P6871'], [null, '2030-01-01', 'P6870'], ['2030-01-01', null, 'P6870']]) {
    const r = await ctx.rpc(padre, 'consultar_facturas_periodo', { p_alumno_id: hijo.profileId, p_desde: d, p_hasta: h })
    assert.equal(r.status, 400, 'Un rango inválido no fue rechazado.')
    assert.equal(r.data?.code, codigo)
  }
  const inexistente = await ctx.rpc(padre, 'consultar_facturas_periodo', { p_alumno_id: hijo.profileId, p_desde: '2030-02-30', p_hasta: '2030-03-01' })
  assert.equal(inexistente.status, 400, 'Una fecha civil inexistente no fue rechazada.')

  // 6. Registro de comprobantes: período de factura frente a fecha de transferencia.
  const porFactura = await reg(padre, hijo, 'PERIODO_FACTURA', '2030-12-01', '2031-01-31')
  assert.deepEqual(porFactura.map(r => r.pago_id), [id.p1], 'El pago multifactura debe aparecer una sola vez.')
  assert.equal(porFactura[0].cantidad_archivos, 2)
  assert.deepEqual(porFactura[0].periodos, ['2030-12-01', '2031-01-01'])
  assert.equal(porFactura[0].importe_informado_centavos, 10_000_000)
  const porFecha = await reg(padre, hijo, 'FECHA_TRANSFERENCIA', '2030-12-01', '2030-12-31')
  assert.deepEqual(porFecha, [], 'La fecha de transferencia no debe confundirse con el período de factura.')
  assert.deepEqual((await reg(padre, hijo, 'FECHA_TRANSFERENCIA', '2031-01-05', '2031-01-05')).map(r => r.pago_id), [id.p1])
  assert.deepEqual((await reg(padre, hijo, 'FECHA_TRANSFERENCIA', '2030-11-30', '2030-11-30')).map(r => r.pago_id), [id.p2],
    'El extremo inclusivo de la fecha de transferencia no funcionó.')
  const sinFecha = await reg(padre, hijo, 'PERIODO_FACTURA', '2030-11-01', '2030-11-30')
  assert.deepEqual(sinFecha.map(r => r.pago_id).sort(), [id.p2, id.p3].sort())
  const p3 = sinFecha.find(r => r.pago_id === id.p3)
  assert.deepEqual([p3.cantidad_archivos, p3.fecha_transferencia, p3.importe_informado_centavos, p3.ultima_carga_en], [0, null, null, null])
  const todoPorFecha = await reg(padre, hijo, 'FECHA_TRANSFERENCIA', '2000-01-01', '2100-12-31')
  assert.ok(!todoPorFecha.some(r => r.pago_id === id.p3), 'Un pago sin fecha entró por fecha de transferencia.')
  // Registro saneado: ningún campo de archivo, y el mismo para estudiante, copadre y Dirección.
  for (const fila of [...porFactura, ...sinFecha]) {
    assert.deepEqual(Object.keys(fila).sort(), [
      'cantidad_archivos', 'creado_en', 'estado', 'fecha_transferencia', 'importe_informado_centavos',
      'pago_id', 'periodos', 'total_calculado_centavos', 'ultima_carga_en', 'items','recibo_id','verificado_en','motivo_rechazo',
    ].sort())
  }
  for (const actor of [copadre, hijo, a.director]) {
    assert.deepEqual((await reg(actor, hijo, 'PERIODO_FACTURA', '2030-12-01', '2031-01-31')).map(r => r.pago_id), [id.p1])
  }
  // Un pago cargado por el copadre se ve saneado para el padre.
  assert.equal(sinFecha.find(r => r.pago_id === id.p2).cantidad_archivos, 1)

  // 7. Registro: negativas por actor, criterio y rango.
  assert.deepEqual(await reg(padre, hijoOtro, 'PERIODO_FACTURA', '2030-01-01', '2031-12-31'), [])
  assert.deepEqual(await reg(hijo, hijoOtro, 'PERIODO_FACTURA', '2030-01-01', '2031-12-31'), [])
  assert.deepEqual(await reg(otraFamilia, hijo, 'PERIODO_FACTURA', '2030-01-01', '2031-12-31'), [])
  assert.deepEqual(await reg(bloqueada, hijo, 'PERIODO_FACTURA', '2030-01-01', '2031-12-31'), [])
  for (const actor of [a.docente, a.personal]) assert.deepEqual(await reg(actor, hijo, 'PERIODO_FACTURA', '2030-01-01', '2031-12-31'), [])
  for (const cuerpo of [
    { p_alumno_id: hijo.profileId, p_criterio: 'OTRO', p_desde: '2030-01-01', p_hasta: '2030-02-01' },
    { p_alumno_id: hijo.profileId, p_criterio: null, p_desde: '2030-01-01', p_hasta: '2030-02-01' },
    { p_alumno_id: hijo.profileId, p_criterio: 'PERIODO_FACTURA', p_desde: '2030-02-01', p_hasta: '2030-01-01' },
  ]) {
    const r = await ctx.rpc(padre, 'consultar_registro_comprobantes', cuerpo)
    assert.equal(r.status, 400)
    assert.match(r.data?.code ?? '', /^P687[01]$/u)
  }
  const anonimoReg = await ctx.anonima('/rest/v1/rpc/consultar_registro_comprobantes', 'POST',
    { p_alumno_id: hijo.profileId, p_criterio: 'PERIODO_FACTURA', p_desde: '2030-01-01', p_hasta: '2030-12-31' })
  assert.ok([401, 403].includes(anonimoReg.status), 'El anónimo ejecutó el registro de comprobantes.')

  // 8. El original sigue restringido: la tabla con rutas solo la lee quien cargó el archivo.
  const filasComp = async actor => {
    const r = await ctx.leer(actor, '/rest/v1/comprobantes_pago?select=id,ruta_archivo')
    assert.equal(r.status, 200)
    return r.data.map(x => x.id).sort()
  }
  assert.deepEqual(await filasComp(padre), [id.c1, id.c2].sort(), 'El padre solo lee los archivos que cargó.')
  assert.deepEqual(await filasComp(copadre), [id.c3], 'El copadre solo lee el archivo que cargó.')
  assert.deepEqual(await filasComp(hijo), [], 'El estudiante leyó metadatos de archivos.')
  assert.deepEqual(await filasComp(bloqueada), [])

  // 9. Reanudación: vínculo revocado corta el acceso en la siguiente lectura.
  await ctx.restAdmin(`padres_hijos?padre_id=eq.${padre.profileId}&hijo_id=eq.${hijoVacio.profileId}`, 'DELETE', undefined, 'return=minimal')
  assert.deepEqual(await insc(padre, hijoVacio), [])
  await ctx.restAdmin(`padres_hijos?padre_id=eq.${copadre.profileId}&hijo_id=eq.${hijo.profileId}`, 'DELETE', undefined, 'return=minimal')
  assert.deepEqual(await insc(copadre, hijo), [], 'El vínculo revocado conserva acceso a inscripciones.')
  assert.deepEqual(await fact(copadre, hijo, '2030-01-01', '2031-12-31'), [])
  assert.deepEqual(await reg(copadre, hijo, 'PERIODO_FACTURA', '2030-01-01', '2031-12-31'), [])
  assert.equal((await insc(padre, hijo)).length, 5)

  // 10. Nada económico ni de inscripción cambió por consultar.
  assert.equal(huella(), antes, 'Las consultas modificaron datos económicos o inscripciones.')

  // EPT-113. La aceptación la ejecuta Dirección real: aprobación -> identidad única -> lectura del padre/estudiante.
  const aprobacion=await ctx.rpc(a.director,'verificar_pago',{p_pago_id:id.pM1,p_decision:'APROBADO',p_motivo:null})
  assert.equal(aprobacion.status,200,JSON.stringify(aprobacion.data))
  const recibos=await ctx.leer(padreMaestro,`/rest/v1/recibos?select=id,pago_id&pago_id=eq.${id.pM1}`)
  assert.equal(recibos.status,200);assert.equal(recibos.data.length,1)
  for(const actor of [padreMaestro,hijoMaestro]) {
    const fuente=await ctx.rpc(actor,'consultar_recibo',{p_recibo_id:recibos.data[0].id})
    assert.equal(fuente.status,200);assert.equal(fuente.data.importe_imputado,'50000.00')
  }
  // Caso rechazado real, conservando sus ítems inactivos; solo IDs aleatorios de este fixture.
  sql(contenedor, `BEGIN;
    INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion)
    VALUES('${id.pM2}','${padreMaestro.profileId}','${hijoMaestro.profileId}',50000,50000,'2030-04-21','OP-CI-113-${id.pM2.slice(0,8)}');
    INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe,activa)
    VALUES('${id.pM2}','${id.iM2}','${hijoMaestro.profileId}',50000,TRUE);
    UPDATE public.items_factura SET estado_pago='EN_VERIFICACION' WHERE id='${id.iM2}';
    INSERT INTO public.comprobantes_pago(id,pago_id,subido_por,ruta_archivo,tipo_mime,tamano_bytes)
    VALUES('${id.pM2}','${id.pM2}','${padreMaestro.profileId}','${id.pM2}/${id.pM2}.pdf','application/pdf',1000); COMMIT;`)
  const rechazo = await ctx.rpc(a.director, 'verificar_pago', { p_pago_id: id.pM2, p_decision: 'RECHAZADO', p_motivo: 'Prueba sintética de contrato móvil' })
  assert.equal(rechazo.status, 200, JSON.stringify(rechazo.data))
  const registroFinalMovil = await reg(padreMaestro, hijoMaestro, 'PERIODO_FACTURA', '2030-01-01', '2030-12-31')
  verificarParserMovilReal([...registroPendienteMovil, ...registroFinalMovil])
  return { padre: padreMaestro, estudiante: hijoMaestro }
}


/** Ejecuta el parser de producción, no una copia JS ni un mock de la RPC. */
function verificarParserMovilReal(filas) {
  const carpeta = mkdtempSync(join(tmpdir(), 'ept113-rpc-movil-'))
  const archivo = join(carpeta, 'registro.json')
  const mobile = resolve(import.meta.dirname, '..')
  try {
    writeFileSync(archivo, JSON.stringify(filas), { encoding: 'utf8', mode: 0o600 })
    execFileSync(process.execPath, [join(mobile, 'node_modules/jest/bin/jest.js'), '--ci', '--runInBand', '__tests__/consultas-rpc-real.test.ts'], {
      cwd: mobile, env: { ...process.env, EPT_CONSULTAS_RPC_FIXTURE: archivo }, stdio: 'inherit', windowsHide: true, timeout: 30000,
    })
  } finally { rmSync(carpeta, { recursive: true, force: true }) }
}
