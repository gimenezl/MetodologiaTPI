// Etapa de integración real de EPT-107 (consulta de cuotas) sobre el stack descartable.
// Las facturas no se crean por PostgREST (service_role no tiene INSERT sobre ellas): la
// preparación sintética entra por SQL en el contenedor descartable; TODAS las lecturas que
// acreditan acceso usan la sesión real del actor (JWT + RLS), nunca service_role.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function contenedorDb(workdir) {
  const config = readFileSync(resolve(workdir, 'supabase/config.toml'), 'utf8')
  const proyecto = /^project_id\s*=\s*"([^"]+)"/mu.exec(config)?.[1]
  assert.ok(proyecto, 'No se pudo identificar el proyecto descartable.')
  return `supabase_db_${proyecto}`
}

function sql(contenedor, texto) {
  return execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: texto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  }).trim()
}

const periodo = meses =>
  `(date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date + make_interval(months => ${meses}))::date`

/**
 * ctx: { leer(actor, ruta) → {status,data}, escribir(actor, ruta, metodo, cuerpo) → {status,data},
 *        anonima(ruta) → {status,data}, restAdmin(ruta, metodo, cuerpo, prefer), contenedor,
 *        actores: { padreA, padreB, estudianteA, estudianteB, estudianteC, bloqueada, docente, personal, director } }
 */
export async function ejecutarCuotas(ctx) {
  const { actores: a, contenedor } = ctx
  const ids = {
    curso: randomUUID(), matA: randomUUID(), matB: randomUUID(), matC: randomUUID(), tarifa: randomUUID(),
    fVenc: randomUUID(), fPend: randomUUID(), fPag: randomUUID(), fB: randomUUID(), fC: randomUUID(),
    iVenc: randomUUID(), iPend: randomUUID(), iPag: randomUUID(), iB: randomUUID(), iC: randomUUID(), pago: randomUUID(),
  }
  const cuota = 5000000 // centavos: ARS 50.000,00
  sql(contenedor, `
BEGIN;
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES ('${ids.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT-107 CI', 'A', TRUE);
INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES
 ('${ids.matA}', '${a.estudianteA.profileId}', '${ids.curso}'),
 ('${ids.matB}', '${a.estudianteB.profileId}', '${ids.curso}'),
 ('${ids.matC}', '${a.estudianteC.profileId}', '${ids.curso}');
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN ('${a.estudianteA.profileId}', '${a.estudianteB.profileId}', '${a.estudianteC.profileId}');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
VALUES ('${ids.tarifa}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 50000.00, '2020-01-01');
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 ('${ids.fVenc}', '${a.estudianteA.profileId}', ${periodo(-2)}, ${periodo(-2)} + 9, 50000.00),
 ('${ids.fPend}', '${a.estudianteA.profileId}', ${periodo(1)},  ${periodo(1)} + 9, 50000.00),
 ('${ids.fPag}',  '${a.estudianteA.profileId}', ${periodo(-3)}, ${periodo(-3)} + 9, 50000.00),
 ('${ids.fB}',    '${a.estudianteB.profileId}', ${periodo(1)},  ${periodo(1)} + 9, 50000.00),
 ('${ids.fC}',    '${a.estudianteC.profileId}', ${periodo(1)},  ${periodo(1)} + 9, 50000.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe) VALUES
 ('${ids.iVenc}', '${ids.fVenc}', '${a.estudianteA.profileId}', 'CUOTA', '${ids.tarifa}', '${ids.matA}', 50000.00),
 ('${ids.iPend}', '${ids.fPend}', '${a.estudianteA.profileId}', 'CUOTA', '${ids.tarifa}', '${ids.matA}', 50000.00),
 ('${ids.iPag}',  '${ids.fPag}',  '${a.estudianteA.profileId}', 'CUOTA', '${ids.tarifa}', '${ids.matA}', 50000.00),
 ('${ids.iB}',    '${ids.fB}',    '${a.estudianteB.profileId}', 'CUOTA', '${ids.tarifa}', '${ids.matB}', 50000.00),
 ('${ids.iC}',    '${ids.fC}',    '${a.estudianteC.profileId}', 'CUOTA', '${ids.tarifa}', '${ids.matC}', 50000.00);
INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, importe_informado, fecha_transferencia,
                          numero_operacion, estado, verificado_por, verificado_en)
VALUES ('${ids.pago}', '${a.padreA.profileId}', '${a.estudianteA.profileId}', 50000.00, 50000.00, CURRENT_DATE,
        'OP-CI-107-${ids.pago.slice(0, 8)}', 'APROBADO', '${a.director.profileId}', now());
INSERT INTO public.imputaciones_pago (pago_id, item_factura_id, alumno_id, importe)
VALUES ('${ids.pago}', '${ids.iPag}', '${a.estudianteA.profileId}', 50000.00);
UPDATE public.items_factura SET estado_pago = 'PAGADO' WHERE id = '${ids.iPag}';
COMMIT;`)

  const filas = async (actor, tabla, filtro, columnas = '*') => {
    const r = await ctx.leer(actor, `/rest/v1/${tabla}?select=${columnas}${filtro ? `&${filtro}` : ''}`)
    assert.equal(r.status, 200, `Lectura ${tabla}: estado HTTP inesperado.`)
    return r.data
  }

  // 1. Padre con dos hijos: ve lo suyo, con importes en centavos exactos y estados del servidor.
  const deA = await filas(a.padreA, 'estado_cuotas_alumno', `alumno_id=eq.${a.estudianteA.profileId}`)
  assert.equal(deA.length, 3)
  const porFactura = Object.fromEntries(deA.map(f => [f.factura_id, f]))
  assert.equal(porFactura[ids.fVenc].estado, 'VENCIDA')
  assert.equal(porFactura[ids.fPend].estado, 'PENDIENTE')
  assert.equal(porFactura[ids.fPag].estado, 'PAGADA')
  assert.equal(porFactura[ids.fVenc].saldo_centavos, cuota)
  assert.equal(porFactura[ids.fPag].saldo_centavos, 0)
  for (const f of deA) {
    for (const campo of ['total_centavos', 'pagado_centavos', 'saldo_centavos']) {
      assert.ok(Number.isSafeInteger(f[campo]), 'El importe no llegó como centavos enteros.')
    }
    assert.equal(f.inconsistente, false)
  }
  const deC = await filas(a.padreA, 'estado_cuotas_alumno', `alumno_id=eq.${a.estudianteC.profileId}`)
  assert.deepEqual(deC.map(f => f.factura_id), [ids.fC], 'El hijo C no se mezcla con el hijo A.')
  const todas = await filas(a.padreA, 'estado_cuotas_alumno', '', 'alumno_id')
  assert.ok(todas.every(f => [a.estudianteA.profileId, a.estudianteC.profileId].includes(f.alumno_id)), 'El padre ve alumnos ajenos.')

  // 2. Detalle por identificador y negativas por identificador manipulado.
  const items = await filas(a.padreA, 'detalle_cuotas_items', `factura_id=eq.${ids.fPag}`)
  assert.deepEqual(items.map(i => [i.tipo, i.importe_centavos, i.pagado_centavos]), [['CUOTA', cuota, cuota]])
  for (const [tabla, filtro] of [
    ['estado_cuotas_alumno', `factura_id=eq.${ids.fB}`],
    ['estado_cuotas_alumno', `alumno_id=eq.${a.estudianteB.profileId}`],
    ['detalle_cuotas_items', `factura_id=eq.${ids.fB}`],
    ['detalle_cuotas_items', `item_id=eq.${ids.iB}`],
  ]) {
    assert.deepEqual(await filas(a.padreA, tabla, filtro), [], 'Un identificador de otra familia devolvió datos.')
  }

  // 3. Estudiante: solo lo propio.
  const propias = await filas(a.estudianteA, 'estado_cuotas_alumno', '', 'alumno_id')
  assert.equal(propias.length, 3)
  assert.ok(propias.every(f => f.alumno_id === a.estudianteA.profileId))
  assert.deepEqual(await filas(a.estudianteA, 'estado_cuotas_alumno', `alumno_id=eq.${a.estudianteB.profileId}`), [])
  assert.deepEqual(await filas(a.estudianteB, 'estado_cuotas_alumno', `factura_id=eq.${ids.fVenc}`), [])

  // 4. Roles no compatibles, cuenta bloqueada con vínculo vigente y anónimo.
  for (const actor of [a.docente, a.personal]) {
    assert.deepEqual(await filas(actor, 'estado_cuotas_alumno', '', 'factura_id'), [])
    assert.deepEqual(await filas(actor, 'detalle_cuotas_items', '', 'item_id'), [])
  }
  assert.deepEqual(await filas(a.bloqueada, 'estado_cuotas_alumno', '', 'factura_id'), [], 'La cuenta bloqueada leyó cuotas.')
  const anonimo = await ctx.anonima('/rest/v1/estado_cuotas_alumno?select=factura_id')
  assert.ok([401, 403].includes(anonimo.status), 'El anónimo no debe leer las cuotas.')

  // 5. Las vistas no admiten escritura.
  const escritura = await ctx.escribir(a.padreA, `/rest/v1/estado_cuotas_alumno?factura_id=eq.${ids.fVenc}`, 'PATCH', { total_centavos: 0 })
  assert.ok(escritura.status >= 400, 'Una vista de lectura aceptó una escritura.')
  assert.equal((await filas(a.padreA, 'estado_cuotas_alumno', `factura_id=eq.${ids.fVenc}`))[0].total_centavos, cuota)

  // 6. Vínculo revocado: el acceso se corta en la siguiente lectura.
  await ctx.restAdmin(`padres_hijos?padre_id=eq.${a.padreA.profileId}&hijo_id=eq.${a.estudianteC.profileId}`, 'DELETE', undefined, 'return=minimal')
  assert.deepEqual(await filas(a.padreA, 'estado_cuotas_alumno', `alumno_id=eq.${a.estudianteC.profileId}`), [], 'El vínculo revocado conserva acceso.')
  assert.equal((await filas(a.padreA, 'estado_cuotas_alumno', `alumno_id=eq.${a.estudianteA.profileId}`)).length, 3)

  return ids
}
