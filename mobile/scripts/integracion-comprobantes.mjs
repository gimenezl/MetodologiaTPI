// Etapa de integración real de EPT-109 (carga de comprobantes) sobre el stack descartable, con el servidor
// Next real (`servidor-web-local.mjs`). Toda operación que acredita acceso usa la sesión real del actor (JWT
// + RLS + RPC + Bearer); service_role solo prepara fixtures y verifica lo persistido. Las facturas e ítems
// entran por SQL (service_role no tiene INSERT sobre ellas desde EPT-104). Archivos sintéticos, sin datos
// personales.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'

function sql(contenedor, texto) {
  return execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: texto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  }).trim()
}

const periodo = meses =>
  `(date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date + make_interval(months => ${meses}))::date`

const sha = buffer => createHash('sha256').update(buffer).digest('hex')

// PNG 1×1 y PDF mínimos, válidos (estructura real): lo que valida el servidor no es un simulacro.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export function pdfMinimo(marca = '') {
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ]
  let s = `%PDF-1.4\n%${marca}\n`
  const offsets = []
  objetos.forEach((o, i) => {
    offsets.push(s.length)
    s += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = s.length
  s += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) s += `${String(o).padStart(10, '0')} 00000 n \n`
  s += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(s, 'latin1')
}

/**
 * ctx: { contenedor, urlWeb, urlApi, claveServicio, restAdmin, rpc(actor, nombre, cuerpo) → {status, data},
 *        token(actor) → access token vigente de la etapa, crearActor(rol, opciones),
 *        actores: { director, docente, personal } }
 *
 * Devuelve las credenciales del padre cuyo pago pendiente (sin comprobante) usa el flujo de Maestro.
 */
export async function ejecutarComprobantes(ctx) {
  const { contenedor, urlWeb, urlApi } = ctx
  assert.ok(urlWeb, 'Falta el servidor web local (servidor-web-local.mjs start).')

  const padre = await ctx.crearActor('PADRE')
  const copadre = await ctx.crearActor('PADRE')
  const otraFamilia = await ctx.crearActor('PADRE')
  const hijo = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  const hijoOtro = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  const padreMaestro = await ctx.crearActor('PADRE')
  const hijoMaestro = await ctx.crearActor('ESTUDIANTE', { legajo: true })
  await ctx.restAdmin('padres_hijos', 'POST', [
    { padre_id: padre.profileId, hijo_id: hijo.profileId },
    { padre_id: copadre.profileId, hijo_id: hijo.profileId },
    { padre_id: otraFamilia.profileId, hijo_id: hijoOtro.profileId },
    { padre_id: padreMaestro.profileId, hijo_id: hijoMaestro.profileId },
  ], 'return=minimal')

  const nivel = `Nivel EPT-109 CI ${randomUUID().slice(0, 8)}`
  const id = Object.fromEntries(
    ['curso', 'matH', 'matO', 'matM', 'tarifa', 'f1', 'f2', 'f3', 'fO', 'fM', 'i1', 'i2', 'i3', 'iO', 'iM']
      .map(k => [k, randomUUID()]),
  )
  sql(contenedor, `
BEGIN;
INSERT INTO public.niveles (nombre, activo, orden) VALUES ('${nivel}', TRUE, 9109);
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES ('${id.curso}', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 'Curso EPT-109 CI', 'A', TRUE);
INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES
 ('${id.matH}', '${hijo.profileId}', '${id.curso}'),
 ('${id.matO}', '${hijoOtro.profileId}', '${id.curso}'),
 ('${id.matM}', '${hijoMaestro.profileId}', '${id.curso}');
UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN ('${hijo.profileId}', '${hijoOtro.profileId}', '${hijoMaestro.profileId}');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
VALUES ('${id.tarifa}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 50000.00, '2020-01-01');
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 ('${id.f1}', '${hijo.profileId}', ${periodo(1)}, ${periodo(1)} + 9, 50000.00),
 ('${id.f2}', '${hijo.profileId}', ${periodo(2)}, ${periodo(2)} + 9, 50000.00),
 ('${id.f3}', '${hijo.profileId}', ${periodo(3)}, ${periodo(3)} + 9, 50000.00),
 ('${id.fO}', '${hijoOtro.profileId}', ${periodo(1)}, ${periodo(1)} + 9, 50000.00),
 ('${id.fM}', '${hijoMaestro.profileId}', ${periodo(1)}, ${periodo(1)} + 9, 50000.00);
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe) VALUES
 ('${id.i1}', '${id.f1}', '${hijo.profileId}', 'CUOTA', '${id.tarifa}', '${id.matH}', 50000.00),
 ('${id.i2}', '${id.f2}', '${hijo.profileId}', 'CUOTA', '${id.tarifa}', '${id.matH}', 50000.00),
 ('${id.i3}', '${id.f3}', '${hijo.profileId}', 'CUOTA', '${id.tarifa}', '${id.matH}', 50000.00),
 ('${id.iO}', '${id.fO}', '${hijoOtro.profileId}', 'CUOTA', '${id.tarifa}', '${id.matO}', 50000.00),
 ('${id.iM}', '${id.fM}', '${hijoMaestro.profileId}', 'CUOTA', '${id.tarifa}', '${id.matM}', 50000.00);
COMMIT;`)

  const registrar = async (actor, ids) => {
    const r = await ctx.rpc(actor, 'registrar_pago', {
      p_clave_intento: randomUUID(), p_item_ids: ids, p_total_esperado_centavos: ids.length * 5_000_000,
    })
    assert.equal(r.status, 200, 'registrar_pago de la fixture: estado HTTP inesperado.')
    return r.data.pago_id
  }
  const pagoA = await registrar(padre, [id.i1, id.i2]) // un pago con DOS facturas
  const pagoB = await registrar(padre, [id.i3])
  const pagoMaestro = await registrar(padreMaestro, [id.iM])
  const pagoOtro = await registrar(otraFamilia, [id.iO])

  const filaSql = consulta => sql(contenedor, consulta)
  const contar = consulta => Number(filaSql(`SELECT count(*) ${consulta};`))
  const saldoAntes = filaSql(`SELECT string_agg(factura_id || ':' || saldo_centavos || ':' || estado, ',' ORDER BY factura_id)
    FROM public.estado_cuotas_alumno WHERE alumno_id = '${hijo.profileId}';`)

  // ---- helpers HTTP -----------------------------------------------------------------------------------
  const preparar = (actor, o) => ctx.rpc(actor, 'preparar_carga_comprobante', {
    p_clave_carga: o.clave ?? randomUUID(), p_pago_id: o.pago,
    p_fecha: 'fecha' in o ? o.fecha : '2026-10-14',
    p_importe: 'importe' in o ? o.importe : '50000.00',
    p_numero: 'numero' in o ? o.numero : `OP-CI-${randomUUID().slice(0, 8)}`,
    p_tipo_mime: o.tipo ?? 'image/png', p_tamano: o.tamano ?? PNG.length,
  })
  const subir = async (actor, bucket, ruta, buffer, tipo, extra = {}) => {
    const r = await fetch(`${urlApi}/storage/v1/object/${bucket}/${ruta}`, {
      method: 'POST',
      headers: {
        apikey: ctx.claveAnon, authorization: `Bearer ${await ctx.token(actor)}`,
        'content-type': tipo, 'x-upsert': 'false', ...extra,
      },
      body: buffer, signal: AbortSignal.timeout(30_000),
    })
    return r.status
  }
  const existeComoServidor = async (bucket, ruta) => {
    const r = await fetch(`${urlApi}/storage/v1/object/${bucket}/${ruta}`, {
      headers: { apikey: ctx.claveServicio, authorization: `Bearer ${ctx.claveServicio}` },
      signal: AbortSignal.timeout(30_000),
    })
    return { estado: r.status, bytes: Buffer.from(await r.arrayBuffer()) }
  }
  const finalizar = async (actor, cargaId, token) => {
    const cabeceras = {}
    const t = token === undefined ? await ctx.token(actor) : token
    if (t) cabeceras.authorization = `Bearer ${t}`
    const r = await fetch(`${urlWeb}/api/comprobantes/cargas/${cargaId}/finalizacion`, {
      method: 'POST', headers: cabeceras, signal: AbortSignal.timeout(90_000),
    })
    let cuerpo = null
    try { cuerpo = await r.json() } catch { /* sin cuerpo */ }
    return { status: r.status, cuerpo }
  }
  const cargar = async (actor, pago, buffer, tipo, o = {}) => {
    const prep = await preparar(actor, { pago, tipo, tamano: buffer.length, ...o })
    assert.equal(prep.status, 200, `Preparar una carga: estado HTTP ${prep.status}.`)
    const estadoSubida = await subir(actor, prep.data.bucket_temporal, prep.data.ruta_temporal, buffer, tipo)
    assert.equal(estadoSubida, 200, `Subida al bucket temporal: estado HTTP ${estadoSubida}.`)
    return prep.data
  }

  // 1. Autoridad de la preparación: solo el padre del pago; datos inválidos no escriben nada.
  const operacionA = `OP-CI-A-${randomUUID().slice(0, 8)}`
  for (const [actor, etiqueta] of [[copadre, 'el copadre'], [otraFamilia, 'otra familia']]) {
    const r = await preparar(actor, { pago: pagoA })
    assert.ok(r.status >= 400 && r.data?.code === 'P6861', `${etiqueta} no prepara cargas de un pago ajeno.`)
  }
  for (const actor of [ctx.actores.docente, ctx.actores.personal, ctx.actores.director, hijo]) {
    const r = await preparar(actor, { pago: pagoA })
    assert.ok(r.status >= 400, 'Un rol que no es padre no prepara cargas.')
  }
  for (const [o, codigo] of [
    [{ importe: '1500.505' }, 'P6860'], [{ importe: '-5' }, 'P6860'], [{ fecha: '2026-02-30' }, 'P6860'],
    [{ tipo: 'image/svg+xml' }, 'P6860'], [{ tamano: 5242881 }, 'P6860'], [{ tamano: 0 }, 'P6860'],
    [{ numero: '   ' }, 'P6860'],
  ]) {
    const r = await preparar(padre, { pago: pagoA, ...o })
    assert.ok(r.status >= 400 && r.data?.code === codigo, `Dato inválido ${JSON.stringify(o)} sin rechazo ${codigo}.`)
  }
  assert.equal(contar(`FROM public.cargas_comprobante WHERE pago_id = '${pagoA}'`), 0, 'Un rechazo dejó una carga.')

  // 2. Primer archivo: preparar → subir (sin reemplazo) → finalizar con Bearer.
  const c1 = await cargar(padre, pagoA, PNG, 'image/png', { numero: operacionA })
  assert.equal(c1.estado, 'PREPARADA')
  assert.notEqual(await subir(padre, c1.bucket_temporal, c1.ruta_temporal, PNG, 'image/png'), 200, 'El objeto temporal se pudo reemplazar.')
  assert.notEqual(await subir(copadre, c1.bucket_temporal, c1.ruta_temporal, PNG, 'image/png'), 200, 'Otro padre subió a una carga ajena.')
  assert.notEqual(
    await subir(padre, 'comprobantes-pago', `${pagoA}/${randomUUID()}.png`, PNG, 'image/png'), 200,
    'Un cliente subió al bucket final.',
  )
  const sinToken = await finalizar(padre, c1.carga_id, null)
  assert.equal(sinToken.status, 401, 'La finalización sin Bearer no respondió 401.')
  const ajeno = await finalizar(copadre, c1.carga_id)
  assert.equal(ajeno.status, 404, 'Otro padre pudo finalizar la carga.')
  const f1 = await finalizar(padre, c1.carga_id)
  assert.equal(f1.status, 200, `La finalización devolvió ${f1.status}.`)
  assert.equal(f1.cuerpo?.carga?.estado, 'CONFIRMADA')
  const publicado = await existeComoServidor('comprobantes-pago', `${pagoA}/${c1.carga_id}.png`)
  assert.equal(publicado.estado, 200, 'El objeto final no existe.')
  assert.equal(sha(publicado.bytes), sha(PNG), 'El objeto final no tiene los bytes subidos.')
  assert.equal((await existeComoServidor('comprobantes-pago-temporal', c1.ruta_temporal)).estado === 200, false, 'El temporal no se retiró.')
  assert.equal(
    filaSql(`SELECT estado || '|' || numero_operacion || '|' || importe_informado::text FROM public.pagos WHERE id = '${pagoA}';`),
    `PENDIENTE_VERIFICACION|${operacionA}|50000.00`,
    'El pago no quedó pendiente con los datos informados.',
  )
  assert.equal((await finalizar(padre, c1.carga_id)).status, 200, 'La repetición no fue idempotente.')
  assert.equal(contar(`FROM public.comprobantes_pago WHERE pago_id = '${pagoA}'`), 1, 'Se duplicó el comprobante.')

  // 3. Segundo archivo del mismo pago: no se reenvían ni se sobrescriben los datos.
  const pdf = pdfMinimo('ci')
  const c2 = await cargar(padre, pagoA, pdf, 'application/pdf', { fecha: null, importe: null, numero: null })
  assert.equal(c2.numero_operacion, operacionA, 'La carga adicional no heredó el número.')
  assert.equal((await finalizar(padre, c2.carga_id)).status, 200)
  assert.equal(contar(`FROM public.comprobantes_pago WHERE pago_id = '${pagoA}'`), 2, 'El pago debía tener dos comprobantes.')
  const distinto = await preparar(padre, { pago: pagoA, numero: 'OTRO-NUMERO' })
  assert.equal(distinto.data?.code, 'P6865', 'Un número distinto sobre un pago ya informado debía ser un conflicto.')

  // 4. Saldo, reservas y total histórico intactos: un comprobante no paga la factura.
  assert.equal(
    filaSql(`SELECT string_agg(factura_id || ':' || saldo_centavos || ':' || estado, ',' ORDER BY factura_id)
      FROM public.estado_cuotas_alumno WHERE alumno_id = '${hijo.profileId}';`),
    saldoAntes, 'El saldo cambió al adjuntar comprobantes.',
  )
  assert.equal(contar(`FROM public.imputaciones_pago WHERE pago_id = '${pagoA}'`), 2, 'El pago perdió una de sus facturas.')

  // 5. Número de operación global: otro pago no repite el de un pago no rechazado.
  const dup = await preparar(padre, { pago: pagoB, numero: operacionA })
  assert.equal(dup.data?.code, 'P6863', 'Un número duplicado debía rechazarse.')

  // 6. Contenido: lo que el servidor lee decide, no el tipo declarado.
  const html = Buffer.from('<html><script>alert(1)</script></html>')
  const cHtml = await cargar(padre, pagoB, html, 'image/png', { numero: `OP-CI-B-${randomUUID().slice(0, 8)}` })
  const rHtml = await finalizar(padre, cHtml.carga_id)
  assert.equal(rHtml.status, 422, 'HTML declarado como PNG debía rechazarse.')
  assert.equal(contar(`FROM public.comprobantes_pago WHERE pago_id = '${pagoB}'`), 0, 'Un archivo inválido dejó comprobante.')
  assert.equal(
    filaSql(`SELECT numero_operacion IS NULL FROM public.pagos WHERE id = '${pagoB}';`), 't',
    'Un archivo inválido dejó datos de transferencia en el pago.',
  )

  // 7. Lectura: el original lo ven quien lo cargó y Dirección; el copadre y el estudiante, nunca.
  const filasDe = async (actor, ruta) => {
    const r = await ctx.leer(actor, `/rest/v1/${ruta}`)
    assert.equal(r.status, 200, `Lectura ${ruta}: estado HTTP inesperado.`)
    return r.data
  }
  assert.equal((await filasDe(padre, `comprobantes_pago?select=id&pago_id=eq.${pagoA}`)).length, 2)
  assert.equal((await filasDe(ctx.actores.director, `comprobantes_pago?select=id&pago_id=eq.${pagoA}`)).length, 2)
  for (const actor of [copadre, hijo, otraFamilia, ctx.actores.docente, ctx.actores.personal]) {
    assert.deepEqual(await filasDe(actor, `comprobantes_pago?select=id&pago_id=eq.${pagoA}`), [], 'Un rol sin acceso vio comprobantes.')
  }
  const leer = async (actor) => (await fetch(
    `${urlApi}/storage/v1/object/authenticated/comprobantes-pago/${pagoA}/${c1.carga_id}.png`,
    { headers: { apikey: ctx.claveAnon, authorization: `Bearer ${await ctx.token(actor)}` } },
  )).status
  assert.equal(await leer(padre), 200, 'El cargador no pudo leer su original.')
  assert.equal(await leer(ctx.actores.director), 200, 'Dirección no pudo leer el original.')
  for (const actor of [copadre, hijo, otraFamilia, ctx.actores.docente, ctx.actores.personal]) {
    assert.notEqual(await leer(actor), 200, 'Un rol sin acceso descargó el original.')
  }
  // Registro saneado para quien ve el pago pero no el archivo.
  const resumen = await ctx.rpc(copadre, 'resumen_comprobantes_pago', { p_pago_id: pagoA })
  assert.equal(resumen.status, 200)
  assert.equal(resumen.data?.[0]?.cantidad_archivos, 2, 'El copadre no ve la cantidad de archivos del pago.')
  assert.equal('ruta_archivo' in (resumen.data?.[0] ?? {}), false, 'El registro saneado expone la ruta.')

  // 8. Escrituras directas y operaciones de servidor cerradas a los clientes.
  const directa = await ctx.escribir(padre, '/rest/v1/comprobantes_pago', 'POST', {
    pago_id: pagoB, subido_por: padre.profileId, ruta_archivo: `${pagoB}/${randomUUID()}.png`, tipo_mime: 'image/png', tamano_bytes: 1,
  })
  assert.ok(directa.status >= 400, 'Un cliente escribió comprobantes_pago directamente.')
  const confirmar = await ctx.rpc(padre, 'confirmar_carga_comprobante', {
    p_usuario_id: padre.id, p_carga_id: cHtml.carga_id, p_sha256: sha(html), p_tamano: html.length, p_tipo_mime: 'image/png',
  })
  assert.ok(confirmar.status >= 400, 'Un cliente invocó confirmar_carga_comprobante.')

  // 9. Pago ajeno: ninguna etapa del protocolo lo alcanza.
  const intruso = await preparar(padre, { pago: pagoOtro })
  assert.equal(intruso.data?.code, 'P6861', 'Se preparó una carga sobre un pago de otra familia.')

  // 10. Fixture del flujo de Maestro: pago pendiente SIN datos ni comprobantes.
  assert.equal(contar(`FROM public.comprobantes_pago WHERE pago_id = '${pagoMaestro}'`), 0)
  return { email: padreMaestro.email, password: padreMaestro.password, pagoMaestro }
}
