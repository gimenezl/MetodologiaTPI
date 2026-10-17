/** EPT-111: Auth, Storage, RPC, cookies Next y consultas JWT móviles REALES.
 * Admin prepara/limpia; nunca decide por los actores. Solo stack local descartable.
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { sql, rpc, rest, crearCuentaConPerfil, exigirSesion, cookieDe, crearServidorNext, limpiarFixture } from './_arnes-ept59.mjs'
import { ID, ITEMS, roles, economiaFixture, limpiarEconomia } from './_verificacion-fixture.mjs'

const dir = process.env.EPT_SUPABASE_WORKDIR
const salida = execSync(`npx --yes supabase@${process.env.EPT_SUPABASE_CLI ?? '2.117.0'} status -o env${dir ? ` --workdir "${dir}"` : ''}`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
const local = Object.fromEntries(salida.split(/\r?\n/u).map(l => /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]))
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(local.API_URL).hostname), 'Se exige API local.')
if (process.env.DOCKER_HOST && !/^(npipe|unix):/iu.test(process.env.DOCKER_HOST)) throw new Error('Se exige Docker local.')
const modoUi = process.argv.includes('--ui')
const baseUi = modoUi ? process.env.EPT_VERIFICACION_UI_BASE_URL : undefined
if (baseUi) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUi).hostname), 'Se exige web local.')
// La familia UI ya tiene un Next propio del runner: no iniciar otro sobre el
// mismo .next/dev/lock ni detener el servidor prestado al terminar.
const servidor = baseUi ? { url: baseUi, iniciar: async () => {}, detener: async () => {} }
  : crearServidorNext(Number(process.env.EPT_PUERTO_NEXT ?? 3111))
const perfiles = {}, sesiones = {}, pagos = [], objetos = []
const CLAVE = 'prueba-ept111-sintetica'
let navegador, errorPrimario, afirmaciones = 0
const comprobar = (condicion, mensaje) => { assert.ok(condicion, mensaje); console.log(`OK ${++afirmaciones}: ${mensaje}`) }
const token = k => sesiones[k].access_token
const llamadaRpc = (k, nombre, args) => rpc(local, k ? token(k) : null, nombre, args)
const estadoSQL = pago => JSON.parse(sql(`SELECT json_build_object('estado',estado,'actor',verificado_por,'instante',verificado_en,'motivo',motivo_rechazo,'total',total_calculado::TEXT,'informado',importe_informado::TEXT) FROM public.pagos WHERE id='${pago}';`))
const ruta = pago => `/api/comprobantes/pagos/${pago}/verificacion`

async function web(k, pago, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(`${servidor.url}${ruta(pago)}`, { method, redirect: 'manual',
    headers: { ...(k ? { cookie: cookieDe(sesiones[k]) } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
  return { status: r.status, data: await r.json(), cache: r.headers.get('cache-control') }
}

async function cargar(pago, n, informado = '990.00', numero = `OP-EPT111-${pago}`) {
  const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#305080' } }).png().toBuffer()
  const r = await llamadaRpc('padre', 'preparar_carga_comprobante', {
    p_clave_carga: ID(900 + n), p_pago_id: pago, p_fecha: '2026-10-17', p_importe: informado,
    p_numero: numero, p_tipo_mime: 'image/png', p_tamano: png.length,
  })
  assert.equal(r.estado, 200)
  const carga = r.cuerpo
  objetos.push({ bucket: 'comprobantes-pago-temporal', ruta: carga.ruta_temporal })
  const subida = await fetch(`${local.API_URL}/storage/v1/object/comprobantes-pago-temporal/${carga.ruta_temporal}`, {
    method: 'POST', headers: { apikey: local.ANON_KEY, authorization: `Bearer ${token('padre')}`, 'content-type': 'image/png' }, body: png,
  })
  assert.equal(subida.status, 200)
  const final = await fetch(`${servidor.url}/api/comprobantes/cargas/${carga.carga_id}/finalizacion`, {
    method: 'POST', headers: { authorization: `Bearer ${token('padre')}` }, signal: AbortSignal.timeout(60_000),
  })
  assert.equal(final.status, 200)
  objetos.push({ bucket: 'comprobantes-pago', ruta: `${pago}/${carga.carga_id}.png` })
  return carga.carga_id
}

async function registrar(items, n, total) {
  const r = await llamadaRpc('padre', 'registrar_pago', { p_clave_intento: ID(n), p_item_ids: items, p_total_esperado_centavos: total })
  assert.equal(r.estado, 200)
  pagos.push(r.cuerpo.pago_id)
  return r.cuerpo.pago_id
}

async function refrescar(actor, pago, esperado) {
  const cuotas = await rest(local, token(actor), `estado_cuotas_alumno?alumno_id=eq.${perfiles.alumno}&order=periodo`)
  assert.equal(cuotas.estado, 200)
  assert.deepEqual(cuotas.cuerpo.map(x => [x.saldo_centavos, x.estado]), esperado)
  const historico = await rest(local, token(actor), `pagos?select=id,estado,total_calculado,importe_informado&id=eq.${pago}`)
  assert.equal(historico.cuerpo[0]?.estado, 'APROBADO')
  const items = await rest(local, token(actor), `detalle_cuotas_items?item_id=in.(${ITEMS.join(',')})`)
  assert.equal(items.cuerpo.length, 2)
  assert.ok(items.cuerpo.every(i => i.estado_pago === 'PAGADO'))
  const resumen = await llamadaRpc(actor, 'consultar_registro_comprobantes', { p_alumno_id: perfiles.alumno,
    p_criterio: 'FECHA_TRANSFERENCIA', p_desde: '2026-10-01', p_hasta: '2026-11-01' })
  assert.equal(resumen.estado, 200)
  assert.ok(resumen.cuerpo.length > 0)
  assert.doesNotMatch(JSON.stringify(resumen.cuerpo), /ruta_archivo|storage\/|https?:/u)
  comprobar(true, `${actor}: refresco JWT ve ítems, saldo parcial/pagado e historial saneado de varias facturas`)
}

try {
  for (const [i, [k, rol]] of Object.entries(roles).entries()) {
    const email = `ept111.${k}@ept.local`
    const usuario = await crearCuentaConPerfil(local, { email, password: CLAVE,
      perfil: { nombre: 'Prueba', apellido: `EPT111 ${k}`, dni: `97111${String(i + 1).padStart(3, '0')}`,
        rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='${rol}';`)),
        legajo_nro: ['ESTUDIANTE', 'DOCENTE'].includes(rol) ? `EPT111-${k}` : null } })
    perfiles[k] = sql(`SELECT id FROM public.perfiles WHERE user_id='${usuario}';`)
    sesiones[k] = await exigirSesion(local, email, CLAVE)
  }
  sql(`BEGIN; ${economiaFixture(perfiles)} UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${perfiles.bloqueado}'; COMMIT;`)
  await servidor.iniciar({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY })
  const pago = await registrar(ITEMS, 501, 100000)
  const archivo = await cargar(pago, 1)
  await cargar(pago, 2)
  comprobar(sql(`SELECT count(*) FROM public.comprobantes_pago WHERE pago_id='${pago}';`) === '2', 'registro y carga reales dejan varios archivos en un único pago')
  comprobar(sql(`SELECT sum(saldo_centavos) FROM public.estado_cuotas_alumno WHERE alumno_id='${perfiles.alumno}';`) === '130000', 'reservar y cargar no reducen la deuda')

  if (!modoUi) {
  for (const k of ['padre', 'alumno', 'copadre', 'otraFamilia', 'ajeno', 'personal', 'docente', 'bloqueado', null]) {
    const r = await web(k, pago, { method: 'POST', body: { decision: 'APROBADO' } })
    comprobar(r.status === (k ? 403 : 401), `${k ?? 'anónimo'}: API deniega decisión con sesión real`)
    const db = await llamadaRpc(k, 'verificar_pago', { p_pago_id: pago, p_decision: 'APROBADO', p_motivo: null })
    comprobar([401, 403].includes(db.estado), `${k ?? 'anónimo'}: base deniega invocación directa con JWT`)
    const consulta = await web(k, pago)
    comprobar(consulta.status === (k ? 403 : 401), `${k ?? 'anónimo'}: consulta de decisión denegada`)
  }
  for (const body of [{ decision: 'OTRO' }, { decision: 'RECHAZADO', motivo: '  ' }, { decision: 'APROBADO', actor: perfiles.director }, { decision: 'APROBADO', motivo: 'inventado' }]) {
    comprobar((await web('director', pago, { method: 'POST', body })).status === 400, 'entrada manipulada o inválida rechazada sin efectos')
  }
  comprobar((await web('director', 'no-uuid', { method: 'POST', body: { decision: 'APROBADO' } })).status === 400, 'identificador inválido rechazado')
  comprobar((await web('director', ID(99999), { method: 'POST', body: { decision: 'APROBADO' } })).status === 404, 'identificador inexistente no escribe')
  comprobar((await web('director', pago, { method: 'POST', body: { decision: 'APROBADO' }, headers: { origin: 'https://ajeno.invalid' } })).status === 403, 'origen ajeno rechazado')
  comprobar((await web('director', pago, { method: 'POST', body: { decision: 'APROBADO' }, headers: { 'content-type': 'text/plain' } })).status === 415, 'contenido no JSON rechazado')
  for (const k of ['alumno', 'copadre']) {
    const original = await fetch(`${servidor.url}/api/comprobantes/${archivo}/archivo`, { headers: { cookie: cookieDe(sesiones[k]) }, redirect: 'manual' })
    comprobar(original.status === 404, `${k}: original denegado incluso tras carga real`)
  }
  for (const [alterar, restaurar] of [
    [`UPDATE public.imputaciones_pago SET importe=499 WHERE pago_id='${pago}' AND item_factura_id='${ITEMS[0]}';`,
      `UPDATE public.imputaciones_pago SET importe=500 WHERE pago_id='${pago}' AND item_factura_id='${ITEMS[0]}';`],
    [`UPDATE public.imputaciones_pago SET activa=FALSE WHERE pago_id='${pago}' AND item_factura_id='${ITEMS[0]}';`,
      `UPDATE public.imputaciones_pago SET activa=TRUE WHERE pago_id='${pago}' AND item_factura_id='${ITEMS[0]}';`],
    [`UPDATE public.items_factura SET estado_pago='PAGADO' WHERE id='${ITEMS[0]}';`,
      `UPDATE public.items_factura SET estado_pago='EN_VERIFICACION' WHERE id='${ITEMS[0]}';`],
  ]) {
    sql(alterar)
    const incoherente = await web('director', pago, { method: 'POST', body: { decision: 'APROBADO' } })
    comprobar(incoherente.status === 409 && incoherente.data.codigo === 'PAGO_INCOHERENTE'
      && estadoSQL(pago).estado === 'PENDIENTE_VERIFICACION', 'reserva incoherente se deniega sin aplicar ni corregir importes')
    sql(restaurar)
  }
  const sinArchivo = await registrar([ID(8012)], 505, 30000)
  comprobar((await web('director', sinArchivo, { method: 'POST', body: { decision: 'APROBADO' } })).status === 409,
    'pago registrado sin transferencia ni comprobante no se aprueba')
  // Solo retira ese fixture incompleto antes del caso de rechazo funcional posterior.
  sql(`BEGIN; DELETE FROM public.imputaciones_pago WHERE pago_id='${sinArchivo}'; DELETE FROM public.pagos WHERE id='${sinArchivo}';
    UPDATE public.items_factura SET estado_pago='PENDIENTE' WHERE id='${ID(8012)}'; COMMIT;`)
  // Falla después de actualizar el pago y al alcanzar el segundo ítem: rollback completo.
  sql(`CREATE FUNCTION app_private.ept111_falla_prueba() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id='${ITEMS[1]}' AND NEW.estado_pago='PAGADO' THEN RAISE EXCEPTION 'falla sintética'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER ept111_falla BEFORE UPDATE ON public.items_factura FOR EACH ROW EXECUTE FUNCTION app_private.ept111_falla_prueba();`)
  const falla = await web('director', pago, { method: 'POST', body: { decision: 'APROBADO' } })
  comprobar(falla.status === 503, 'fallo intermedio informa resultado incierto sin filtrar SQL')
  assert.doesNotMatch(JSON.stringify(falla.data), /falla sintética|SQLSTATE|P\d{4}/u)
  comprobar(estadoSQL(pago).estado === 'PENDIENTE_VERIFICACION'
    && sql(`SELECT count(*) FROM public.items_factura WHERE id IN('${ITEMS.join("','")}') AND estado_pago='EN_VERIFICACION';`) === '2', 'falla intermedia revierte pago y todos los ítems de ambas facturas')
  sql('DROP TRIGGER ept111_falla ON public.items_factura; DROP FUNCTION app_private.ept111_falla_prueba();')
  comprobar((await web('director', pago)).data.resultado.estado === 'PENDIENTE_VERIFICACION', 'consultar después de una respuesta incierta confirma estado antes del reintento')
  }

  let pagina, contexto
  const urlNavegador = servidor.url.replace('127.0.0.1', 'localhost')
  if (modoUi) {
  navegador = await chromium.launch({ headless: true })
  contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } })
  const cookie = cookieDe(sesiones.director)
  await contexto.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: urlNavegador }])
  pagina = await contexto.newPage()
  const erroresPagina = []
  pagina.on('pageerror', error => erroresPagina.push(error.message))
  await pagina.goto(`${urlNavegador}/dashboard/comprobantes?pago=${pago}`)
  await pagina.getByRole('button', { name: 'Aprobar pago', exact: true }).waitFor({ timeout: 60_000 }).catch(async () => {
    throw new Error(`La pantalla sintética no habilitó la decisión: ${(await pagina.locator('body').innerText()).slice(-1800)}; ${erroresPagina.join('; ')}`)
  })
  await pagina.getByRole('button', { name: 'Aprobar pago', exact: true }).click()
  let liberarRespuesta, confirmarEnServidor
  const respuestaRetenida = new Promise(resolve => { liberarRespuesta = resolve })
  const confirmada = new Promise(resolve => { confirmarEnServidor = resolve })
  const patron = `**${ruta(pago)}`
  await pagina.route(patron, async interceptada => {
    if (interceptada.request().method() !== 'POST') return interceptada.continue()
    const respuesta = await interceptada.fetch()
    assert.equal(respuesta.status(), 200)
    confirmarEnServidor()
    await respuestaRetenida
    await interceptada.abort('failed')
  })
  await pagina.getByRole('button', { name: 'Confirmar aprobación', exact: true }).click()
  await confirmada
  comprobar(await pagina.getByRole('button', { name: 'Procesando decisión…', exact: true }).isDisabled(), 'doble envío deshabilitado mientras se registra una decisión real')
  liberarRespuesta()
  await pagina.getByText('Resultado incierto:', { exact: false }).waitFor()
  comprobar(await pagina.getByRole('button', { name: 'Confirmar aprobación', exact: true }).count() === 0, 'respuesta perdida real bloquea repetir la decisión')
  await pagina.unroute(patron)
  await pagina.getByRole('button', { name: 'Consultar resultado', exact: true }).click()
  await pagina.getByText('Resultado confirmado: aprobado.', { exact: false }).waitFor()
  comprobar(await pagina.getByRole('button', { name: 'Aprobar pago', exact: true }).count() === 0, 'web real confirma aprobación y elimina decisiones opuestas')
  comprobar(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'web de Dirección sin desborde a 390 px')
  } else {
    const aprobado = await web('director', pago, { method: 'POST', body: { decision: 'APROBADO' } })
    comprobar(aprobado.status === 200 && aprobado.data.resultado.estado === 'APROBADO', 'DIRECTOR aprueba mediante API web con cookies reales')
  }
  const antes = estadoSQL(pago)
  const repetido = await web('segundo', pago, { method: 'POST', body: { decision: 'APROBADO' } })
  comprobar(repetido.status === 200 && repetido.data.resultado.repetido, 'reintento por otro Director no vuelve a imputar')
  assert.deepEqual(estadoSQL(pago), antes)
  comprobar(antes.total === '1000.00' && antes.informado === '990.00', 'aprobación conserva total histórico e importe diferente sin ajuste')
  comprobar((await web('segundo', pago, { method: 'POST', body: { decision: 'RECHAZADO', motivo: 'opuesta' } })).status === 409, 'decisión opuesta sobre pago aprobado produce conflicto')
  for (const k of ['padre', 'alumno', 'copadre']) await refrescar(k, pago, [[30000, 'PAGO_PARCIAL'], [0, 'PAGADA']])
  for (const k of ['ajeno', 'otraFamilia']) {
    const q = await rest(local, token(k), `estado_cuotas_alumno?alumno_id=eq.${perfiles.alumno}`)
    comprobar(q.estado === 200 && q.cuerpo.length === 0, `${k}: JWT no accede a las cuotas de otra familia`)
  }
  const otro = await registrar([ID(8012)], 502, 30000)
  const archivoRechazo = await cargar(otro, 3, '300.00')
  if (modoUi) {
  await pagina.goto(`${urlNavegador}/dashboard/comprobantes?pago=${otro}`)
  await pagina.getByRole('button', { name: 'Rechazar pago', exact: true }).click()
  await pagina.getByLabel('Motivo del rechazo').fill('  Comprobante no corresponde  ')
  await pagina.getByRole('button', { name: 'Confirmar rechazo', exact: true }).click()
  await pagina.getByText('Resultado confirmado: rechazado.', { exact: false }).waitFor()
  } else {
    const rechazado = await web('director', otro, { method: 'POST', body: { decision: 'RECHAZADO', motivo: '  Comprobante no corresponde  ' } })
    comprobar(rechazado.status === 200 && rechazado.data.resultado.estado === 'RECHAZADO', 'DIRECTOR rechaza mediante API web con cookies reales')
  }
  const rechazoAntes = estadoSQL(otro)
  const rechazoRepetido = await web('segundo', otro, { method: 'POST', body: { decision: 'RECHAZADO', motivo: 'Otro motivo' } })
  comprobar(rechazoRepetido.status === 200 && rechazoRepetido.data.resultado.repetido, 'rechazo repetido conserva motivo y verificador originales')
  assert.deepEqual(estadoSQL(otro), rechazoAntes)
  comprobar(rechazoAntes.motivo === 'Comprobante no corresponde', 'motivo de rechazo obligatorio queda normalizado y durable')
  comprobar(sql(`SELECT activa FROM public.imputaciones_pago WHERE pago_id='${otro}';`) === 'f'
    && sql(`SELECT estado_pago::TEXT FROM public.items_factura WHERE id='${ID(8012)}';`) === 'PENDIENTE', 'rechazo desactiva imputación histórica y libera ítem sin borrar')
  comprobar(sql(`SELECT count(*) FROM public.comprobantes_pago WHERE id='${archivoRechazo}';`) === '1', 'rechazo conserva el comprobante histórico')
  for (const k of ['padre', 'alumno', 'copadre']) {
    const q = await rest(local, token(k), `estado_cuotas_alumno?factura_id=eq.${ID(801)}`)
    comprobar(q.cuerpo[0]?.saldo_centavos === 30000 && q.cuerpo[0]?.items_en_verificacion === 0, `${k}: refresco JWT conserva deuda y observa reserva liberada`)
    const h = await rest(local, token(k), `pagos?id=eq.${otro}&select=estado`)
    comprobar(h.cuerpo[0]?.estado === 'RECHAZADO', `${k}: historial JWT refleja rechazo`)
  }
  const nueva = await registrar([ID(8012)], 503, 30000)
  const reutilizar = await llamadaRpc('padre', 'preparar_carga_comprobante', { p_clave_carga: ID(999), p_pago_id: nueva,
    p_fecha: '2026-10-17', p_importe: '300.00', p_numero: `OP-EPT111-${otro}`, p_tipo_mime: 'image/png', p_tamano: 1234 })
  comprobar(reutilizar.estado === 200, 'nueva reserva reutiliza operación del pago rechazado')

  if (modoUi) {
    await cargar(nueva, 4, '300.00', `OP-EPT111-${otro}`)
    await pagina.goto(`${urlNavegador}/dashboard/comprobantes?pago=${nueva}`)
    await pagina.getByRole('button', { name: 'Aprobar pago', exact: true }).click()
    const remoto = await web('segundo', nueva, { method: 'POST', body: { decision: 'RECHAZADO', motivo: 'Decidido por otro Director' } })
    assert.equal(remoto.status, 200)
    await pagina.getByRole('button', { name: 'Confirmar aprobación', exact: true }).click()
    await pagina.getByText('Resultado confirmado: rechazado.', { exact: false }).waitFor()
    comprobar(await pagina.getByText('Motivo: Decidido por otro Director', { exact: false }).isVisible(), 'conflicto de otro Director consulta estado real y retira la decisión opuesta')
  }

  // Más de 200 pendientes: recorrido visible y búsqueda directa, no un corte silencioso.
  if (modoUi) {
  sql(`INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,creado_en)
    SELECT ('b1112000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID,'${perfiles.padre}','${perfiles.alumno}',1,'2026-10-17'::TIMESTAMPTZ + n*INTERVAL '1 second'
    FROM generate_series(1,205) n;`)
  await pagina.goto(`${urlNavegador}/dashboard/comprobantes`)
  await pagina.getByRole('link', { name: 'Pagos anteriores', exact: true }).click()
  await pagina.waitForURL(/pagina=2/u)
  await pagina.getByText('Página 2.', { exact: false }).waitFor()
  comprobar(true, 'los pendientes posteriores a 200 son accesibles por paginación')
  await pagina.getByLabel('Buscar un pago por identificador').fill(pago)
  await pagina.getByRole('button', { name: 'Buscar pago', exact: true }).click()
  await pagina.getByText('Pago aprobado.', { exact: false }).waitFor()
  comprobar(true, 'búsqueda directa recupera pago finalizado y muestra su resultado real')
  await contexto.close()
  }
  comprobar(sql(`SELECT count(*) FROM public.recibos WHERE pago_id IN('${pagos.join("','")}');`) === '0', 'ninguna decisión emite recibos ni numeración de EPT-113')
} catch (error) {
  errorPrimario = error
} finally {
  const fallasLimpieza = []
  for (const limpiar of [() => navegador?.close(), () => servidor.detener(), () => {
    sql('DROP TRIGGER IF EXISTS ept111_falla ON public.items_factura; DROP FUNCTION IF EXISTS app_private.ept111_falla_prueba();')
  }, async () => {
    for (const o of objetos) {
      const r = await fetch(`${local.API_URL}/storage/v1/object/${o.bucket}`, { method: 'DELETE',
        headers: { apikey: local.SERVICE_ROLE_KEY, authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [o.ruta] }) })
      assert.ok(r.ok, 'No se pudo limpiar un objeto propio de pruebas.')
    }
  }, () => {
    if (perfiles.alumno && perfiles.ajeno) sql(`BEGIN; ${limpiarEconomia(perfiles)} COMMIT;`)
  }, () => limpiarFixture({ prefijoDni: '97111', prefijoCorreo: 'ept111.', dominio: 'ept.local', curso: 'Curso EPT111' })]) {
    try { await limpiar() } catch (error) { fallasLimpieza.push(error) }
  }
  if (errorPrimario || fallasLimpieza.length) throw new AggregateError([errorPrimario, ...fallasLimpieza].filter(Boolean), 'Verificación incompleta; se conservan el error original y los de limpieza.')
}
console.log(`${afirmaciones} comprobaciones reales completadas. No acredita teléfono físico ni iOS con backend.`)
