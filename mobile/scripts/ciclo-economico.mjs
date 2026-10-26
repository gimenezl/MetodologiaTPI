// Ciclo económico conectado app nativa <-> web (EPT-119) sobre los MISMOS registros.
//
//   preparar <plataforma>   Crea el padre, su hijo, Dirección y tres ítems con importes exactos e independientes.
//   decidir  <plataforma>   Espera los dos pagos registrados DESDE LA APP; Dirección aprueba uno y rechaza el otro
//                           desde la interfaz web real (Chromium + cookie de sesión de Dirección).
//   verificar <plataforma>  Concilia saldos, reservas, recibo e informes con los importes esperados de la fixture.
//   simular-app <plataforma>  SOLO diagnóstico local: reproduce con HTTP lo que hace la app. No es evidencia nativa.
//
// service_role solo prepara fixtures y lee lo persistido; toda decisión, lectura de acceso y descarga usa la sesión
// real del actor. Los datos son sintéticos. Los importes esperados se fijan aquí, nunca se leen del importe
// informado ni del resultado que se está verificando.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { contenedorDb } from './integracion-cuotas.mjs'
import { PNG } from './integracion-comprobantes.mjs'
import { DEUDA_FINAL_CENTAVOS, ESPERADO, MOTIVO_RECHAZO, crearIdentidades, entornoMaestro } from './ciclo-identidades.mjs'

const [accion, plataforma, ...resto] = process.argv.slice(2)
const PLATAFORMAS = ['android', 'ios']
const TIEMPO_ESPERA_APP_MS = Number(process.env.EPT_CICLO_ESPERA_APP_MS ?? 15 * 60_000)

// Fecha de transferencia que escribe el padre en la app (los flujos Maestro tipean 14/10/2026).
const FECHA_TRANSFERENCIA = '2026-10-14'

const exigir = (condicion, mensaje) => assert.ok(condicion, mensaje)
const log = mensaje => console.log(`[ciclo ${plataforma}] ${mensaje}`)
const esperar = ms => new Promise(r => setTimeout(r, ms))

// ---- identidades y entorno -----------------------------------------------------------------------------------
const { hmac, uuidDe, credencialDe } = crearIdentidades(plataforma)

function estadoLocal() {
  if (process.env.EPT_CICLO_API_URL) {
    return {
      api: process.env.EPT_CICLO_API_URL, anon: process.env.EPT_CICLO_ANON_KEY, service: process.env.EPT_CICLO_SERVICE_ROLE_KEY,
      contenedor: process.env.EPT_CICLO_DB_CONTAINER,
    }
  }
  const workdir = process.env.EPT_MOBILE_SUPABASE_WORKDIR
  exigir(workdir && process.env.EPT_SUPABASE_CLI_ENTRY, 'Falta el stack efímero (EPT_MOBILE_SUPABASE_WORKDIR / EPT_SUPABASE_CLI_ENTRY).')
  const r = spawnSync(process.execPath, [process.env.EPT_SUPABASE_CLI_ENTRY, 'status', '-o', 'env', '--workdir', workdir], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
  })
  exigir(r.status === 0, 'No se pudo consultar el stack efímero.')
  const v = Object.fromEntries(r.stdout.split(/\r?\n/u).map(l => /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]))
  return { api: v.API_URL, anon: v.ANON_KEY, service: v.SERVICE_ROLE_KEY, contenedor: contenedorDb(workdir) }
}
// `entorno` corre en el job macOS, que no tiene backend: el stack local solo se resuelve para las demás acciones.
let local, urlWeb
function resolverBackend() {
  local = estadoLocal()
  exigir(['127.0.0.1', 'localhost'].includes(new URL(local.api).hostname), 'El ciclo solo opera sobre el Supabase local del runner.')
  urlWeb = process.env.EPT_CICLO_WEB_URL ?? process.env.EPT_MOBILE_WEB_URL ?? 'http://127.0.0.1:3000'
  exigir(['127.0.0.1', 'localhost'].includes(new URL(urlWeb).hostname), 'La web de Dirección se maneja por loopback, no por el túnel.')
}

const sql = texto => execFileSync('docker', ['exec', '-i', local.contenedor, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: texto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
}).trim()

async function http(ruta, { key = local.anon, token, method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(`${local.api}${ruta}`, {
    method, signal: AbortSignal.timeout(30_000),
    headers: { apikey: key, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const texto = await r.text()
  let data = null
  try { data = texto ? JSON.parse(texto) : null } catch { /* el cuerpo nunca se imprime */ }
  return { status: r.status, data }
}
const admin = (ruta, opciones = {}) => http(ruta, { ...opciones, key: local.service, token: local.service })
const sesion = async actor => {
  const r = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: actor.email, password: actor.password } })
  exigir(r.status === 200 && r.data?.access_token, 'No se pudo iniciar sesión con una cuenta sintética del ciclo.')
  return r.data
}

async function crearActor(rol, apellido, legajo = false) {
  const cred = credencialDe(apellido)
  const roles = await admin(`/rest/v1/roles?select=id&nombre=eq.${rol}`)
  exigir(roles.data?.length === 1, `No existe exactamente un rol ${rol}.`)
  const alta = { nombre: 'Prueba', apellido: `CICLO-${plataforma}-${apellido}`, dni: String(10_000_000 + (parseInt(hmac(`dni:${apellido}`).slice(0, 7), 16) % 80_000_000)),
    rol_id: roles.data[0].id, telefono: null, direccion: null, legajo_nro: legajo ? `C119-${hmac(`leg:${apellido}`).slice(0, 8).toUpperCase()}` : null }
  const alta_ = await admin('/auth/v1/admin/users', { method: 'POST', body: {
    email: cred.email, password: cred.password, email_confirm: true,
    app_metadata: { ept_alta: alta }, user_metadata: { role: rol, estado_acceso: 'HABILITADO', display_role: rol },
  } })
  exigir([200, 201].includes(alta_.status) && alta_.data?.id, `No se pudo crear la cuenta sintética ${apellido}.`)
  const perfil = await admin(`/rest/v1/perfiles?select=id&user_id=eq.${alta_.data.id}`)
  exigir(perfil.data?.length === 1, 'El perfil transaccional no se creó.')
  return { ...cred, rol, userId: alta_.data.id, perfilId: perfil.data[0].id }
}

const rutaEstado = () => join(process.env.EPT_CICLO_DIR ?? resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? '.', 'ciclo'), `estado-${plataforma}.json`)
const leerEstado = () => JSON.parse(readFileSync(rutaEstado(), 'utf8'))

// ---- preparar ------------------------------------------------------------------------------------------------
async function preparar() {
  const padre = await crearActor('PADRE', 'padre')
  const hijo = await crearActor('ESTUDIANTE', 'hijo', true)
  const director = await crearActor('DIRECTOR', 'director')
  const r = await admin('/rest/v1/padres_hijos', { method: 'POST', body: [{ padre_id: padre.perfilId, hijo_id: hijo.perfilId }], headers: { prefer: 'return=minimal' } })
  exigir([200, 201, 204].includes(r.status), 'No se pudo vincular al hijo sintético.')

  const id = Object.fromEntries(['curso', 'mat', 'tarifa', 'fA', 'fB', 'fC', 'iA', 'iB', 'iC'].map(k => [k, uuidDe(k)]))
  const nivel = `Nivel ciclo ${plataforma} ${hmac('nivel').slice(0, 8)}`
  // `niveles.orden` es único: se deriva de la clave para poder repetir la fixture en un stack local reutilizado.
  const orden = 1_000_000 + (parseInt(hmac('orden').slice(0, 6), 16) % 8_000_000)
  const periodo = n => `(date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date + make_interval(months => ${n}))::date`
  sql(`
BEGIN;
INSERT INTO public.niveles (nombre, activo, orden) VALUES ('${nivel}', TRUE, ${orden});
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES ('${id.curso}', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), 'Curso ciclo ${plataforma}', 'A', TRUE);
INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES ('${id.mat}', '${hijo.perfilId}', '${id.curso}');
UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${hijo.perfilId}';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
VALUES ('${id.tarifa}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = '${nivel}'), ${ESPERADO.itemControl.importe}, '2020-01-01');
INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
 ('${id.fA}', '${hijo.perfilId}', ${periodo(1)}, ${periodo(1)} + 9, ${ESPERADO.itemAprobado.importe}),
 ('${id.fB}', '${hijo.perfilId}', ${periodo(2)}, ${periodo(2)} + 9, ${ESPERADO.itemRechazado.importe}),
 ('${id.fC}', '${hijo.perfilId}', ${periodo(3)}, ${periodo(3)} + 9, ${ESPERADO.itemControl.importe});
INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe) VALUES
 ('${id.iA}', '${id.fA}', '${hijo.perfilId}', 'CUOTA', '${id.tarifa}', '${id.mat}', ${ESPERADO.itemAprobado.importe}),
 ('${id.iB}', '${id.fB}', '${hijo.perfilId}', 'CUOTA', '${id.tarifa}', '${id.mat}', ${ESPERADO.itemRechazado.importe}),
 ('${id.iC}', '${id.fC}', '${hijo.perfilId}', 'CUOTA', '${id.tarifa}', '${id.mat}', ${ESPERADO.itemControl.importe});
COMMIT;`)
  const desde = sql(`SELECT ${periodo(1)};`), hasta = sql(`SELECT (${periodo(4)} - 1);`)
  mkdirSync(join(rutaEstado(), '..'), { recursive: true })
  writeFileSync(rutaEstado(), JSON.stringify({ plataforma, id, padre: { ...padre }, hijo: { perfilId: hijo.perfilId }, director: { ...director }, desde, hasta }), { mode: 0o600 })
  exportarEntorno({ desde, hasta })
  log('Fixture preparada: padre, hijo autorizado, Dirección y tres ítems con importes exactos.')
}

/** Escribe las variables de Maestro en GITHUB_ENV (credenciales enmascaradas). Sin GITHUB_ENV no hace nada. */
function exportarEntorno({ desde, hasta }) {
  const salida = entornoMaestro(plataforma, crearIdentidades(plataforma), { desde, hasta })
  const githubEnv = process.env.GITHUB_ENV
  if (!githubEnv) return
  for (const [k, v] of Object.entries(salida)) {
    if (/EMAIL|PASSWORD/u.test(k)) console.log(`::add-mask::${v}`)
    appendFileSync(githubEnv, `${k}=${v}\n`, { mode: 0o600 })
  }
}

/** Job macOS: sin backend local, deriva lo mismo que el job Linux a partir de la clave común y del apretón de manos. */
function entorno() {
  const { desde, hasta } = JSON.parse(readFileSync(resto[0], 'utf8'))
  exigir(/^\d{4}-\d{2}-\d{2}$/u.test(desde) && /^\d{4}-\d{2}-\d{2}$/u.test(hasta), 'El apretón de manos no trae el rango de períodos.')
  exportarEntorno({ desde, hasta })
  log('Variables de Maestro derivadas de la clave común del run.')
}

/** Publica solo lo no sensible (URL de los túneles, clave anónima y rango de períodos) para el job macOS. */
function publicar() {
  const [urls, salida] = resto
  const { desde, hasta } = leerEstado()
  const publico = JSON.parse(readFileSync(urls, 'utf8'))
  writeFileSync(salida, JSON.stringify({ supabase: publico.supabase, api: publico.api, anon: publico.anon, desde, hasta }), { mode: 0o600 })
  log('Apretón de manos publicado (sin claves privilegiadas ni contraseñas).')
}

// ---- helpers de datos ----------------------------------------------------------------------------------------
const pagoDeItem = item => sql(`SELECT pago_id FROM public.imputaciones_pago WHERE item_factura_id = '${item}' ORDER BY pago_id LIMIT 1;`)
const datosPago = pago => {
  const f = sql(`SELECT estado || '|' || total_calculado::text || '|' || COALESCE(importe_informado::text,'') || '|' || COALESCE(motivo_rechazo,'') || '|' || COALESCE(verificado_por::text,'')
    FROM public.pagos WHERE id = '${pago}';`).split('|')
  return { estado: f[0], total: f[1], informado: f[2], motivo: f[3], verificadoPor: f[4] }
}
const comprobantes = pago => Number(sql(`SELECT count(*) FROM public.comprobantes_pago WHERE pago_id = '${pago}';`))

/** iOS: el job macOS sube `ios-fin` al terminar; si ya lo hizo, seguir esperando pagos que nunca llegarán no sirve. */
async function simuladorTermino() {
  const token = process.env.GH_TOKEN, repositorio = process.env.GITHUB_REPOSITORY
  const run = process.env.GITHUB_RUN_ID, intento = process.env.GITHUB_RUN_ATTEMPT
  if (plataforma !== 'ios' || !token || !run) return false
  try {
    const r = await fetch(`https://api.github.com/repos/${repositorio}/actions/runs/${run}/artifacts?per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return false
    return (await r.json()).artifacts?.some(a => a.name === `ios-fin-${run}-${intento}`) ?? false
  } catch { return false }
}

async function esperarCondicion(descripcion, evaluar, limiteMs = TIEMPO_ESPERA_APP_MS) {
  const fin = Date.now() + limiteMs
  let sondeos = 0
  for (;;) {
    const r = evaluar()
    if (r) return r
    if (Date.now() > fin) throw new Error(`Se agotó la espera: ${descripcion}.`)
    if (++sondeos % 5 === 0 && await simuladorTermino()) throw new Error(`El simulador terminó sin completar: ${descripcion}.`)
    await esperar(2_000)
  }
}

// ---- decidir (Dirección en la web) ---------------------------------------------------------------------------
async function decidir() {
  const e = leerEstado()
  log('Esperando que la app registre los dos pagos con su comprobante…')
  // Qué dejó la app hasta ahora (sin datos sensibles): sirve para distinguir «no registró» de «registró sin comprobante».
  const resumenApp = () => ['iA', 'iB'].map(k => {
    const p = pagoDeItem(e.id[k])
    return `${k}: ${p ? `${datosPago(p).estado}, comprobantes=${comprobantes(p)}` : 'sin pago'}`
  }).join('; ')
  let pagos
  try {
    pagos = await esperarCondicion('los dos pagos pendientes con comprobante registrados por la app', () => {
      const a = pagoDeItem(e.id.iA), b = pagoDeItem(e.id.iB)
      if (!a || !b) return null
      return [a, b].every(p => datosPago(p).estado === 'PENDIENTE_VERIFICACION' && comprobantes(p) >= 1) ? { a, b } : null
    })
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : 'Falló la espera'} Estado observado — ${resumenApp()}.`)
  }
  // La app registró lo que corresponde: un pago por ítem, con el total calculado por el servidor.
  assert.equal(datosPago(pagos.a).total, ESPERADO.itemAprobado.importe, 'El total del pago A no es el calculado por el servidor.')
  assert.equal(datosPago(pagos.b).total, ESPERADO.itemRechazado.importe, 'El total del pago B no es el calculado por el servidor.')

  const dir = await sesion(e.director)
  const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(dir), 'utf8').toString('base64')}`
  const urlNavegador = urlWeb.replace('127.0.0.1', 'localhost')
  // Import diferido: el job macOS (acción `entorno`) no instala las dependencias web.
  // Playwright es dependencia de la web (raíz), no de `mobile/`: el especificador va en una variable para que el
  // lint del paquete móvil no intente resolverlo; en tiempo de ejecución sale de `node_modules` de la raíz.
  const paqueteNavegador = 'playwright'
  const { chromium } = await import(paqueteNavegador)
  const navegador = await chromium.launch({ headless: true })
  try {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } })
    await contexto.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: urlNavegador }])
    const pagina = await contexto.newPage()
    const errores = []
    pagina.on('pageerror', error => errores.push(error.message))

    const abrir = async pago => {
      await pagina.goto(`${urlNavegador}/dashboard/comprobantes?pago=${pago}`)
      await pagina.getByRole('button', { name: 'Aprobar pago', exact: true }).waitFor({ timeout: 90_000 }).catch(async () => {
        throw new Error(`La pantalla de Dirección no habilitó la decisión del pago: ${(await pagina.locator('body').innerText()).slice(-600)} ${errores.join('; ')}`)
      })
    }
    await abrir(pagos.a)
    await pagina.getByRole('button', { name: 'Aprobar pago', exact: true }).click()
    await pagina.getByRole('button', { name: 'Confirmar aprobación', exact: true }).click()
    await esperarCondicion('la aprobación del pago A', () => datosPago(pagos.a).estado === 'APROBADO', 60_000)
    log('Dirección aprobó el pago A desde la interfaz web.')

    await abrir(pagos.b)
    await pagina.getByRole('button', { name: 'Rechazar pago', exact: true }).click()
    await pagina.getByLabel('Motivo del rechazo').fill(MOTIVO_RECHAZO)
    await pagina.getByRole('button', { name: 'Confirmar rechazo', exact: true }).click()
    await esperarCondicion('el rechazo del pago B', () => datosPago(pagos.b).estado === 'RECHAZADO', 60_000)
    log('Dirección rechazó el pago B desde la interfaz web.')
  } finally {
    await navegador.close()
  }
  const t = { ...e, pagos }
  writeFileSync(rutaEstado(), JSON.stringify(t), { mode: 0o600 })
}

// ---- verificar -----------------------------------------------------------------------------------------------
async function verificar() {
  const e = leerEstado()
  const pagos = e.pagos ?? { a: pagoDeItem(e.id.iA), b: pagoDeItem(e.id.iB) }
  const a = datosPago(pagos.a), b = datosPago(pagos.b)
  assert.equal(a.estado, 'APROBADO'); assert.equal(a.total, ESPERADO.itemAprobado.importe)
  assert.equal(a.verificadoPor, e.director.perfilId, 'El pago A no lo verificó Dirección.')
  assert.equal(b.estado, 'RECHAZADO'); assert.equal(b.total, ESPERADO.itemRechazado.importe)
  assert.equal(b.motivo, MOTIVO_RECHAZO)

  // Saldo y reservas: se aprueba solo A; el rechazo libera B; C no se toca.
  const items = Object.fromEntries(sql(`SELECT item_id || '|' || estado_pago FROM public.detalle_cuotas_items WHERE item_id IN ('${e.id.iA}','${e.id.iB}','${e.id.iC}');`)
    .split('\n').map(l => l.split('|')))
  assert.deepEqual([items[e.id.iA], items[e.id.iB], items[e.id.iC]], ['PAGADO', 'PENDIENTE', 'PENDIENTE'], 'Estado de los ítems tras aprobar y rechazar.')
  const saldos = f => sql(`SELECT saldo_centavos || ':' || estado FROM public.estado_cuotas_alumno WHERE factura_id = '${f}';`)
  assert.equal(saldos(e.id.fA).split(':')[0], '0', 'La factura aprobada debe quedar sin saldo.')
  assert.equal(saldos(e.id.fB).split(':')[0], String(ESPERADO.itemRechazado.centavos), 'El rechazo no debe reducir el saldo.')
  assert.equal(saldos(e.id.fC).split(':')[0], String(ESPERADO.itemControl.centavos), 'El ítem de control no debe cambiar.')

  // Canal app (JWT del padre, lo mismo que lee la app) frente a canal web (Dirección): mismos registros e importes.
  const padre = await sesion(e.padre)
  const dir = await sesion(e.director)
  const vistaPadre = await http(`/rest/v1/estado_cuotas_alumno?select=factura_id,saldo_centavos&alumno_id=eq.${e.hijo.perfilId}`, { token: padre.access_token })
  exigir(vistaPadre.status === 200, 'El padre no pudo leer las cuotas de su hijo.')
  const porFactura = Object.fromEntries(vistaPadre.data.map(f => [f.factura_id, String(f.saldo_centavos)]))
  assert.deepEqual([porFactura[e.id.fA], porFactura[e.id.fB], porFactura[e.id.fC]], ['0', String(ESPERADO.itemRechazado.centavos), String(ESPERADO.itemControl.centavos)])
  assert.equal(Object.values(porFactura).reduce((s, v) => s + Number(v), 0), DEUDA_FINAL_CENTAVOS, 'La deuda total del padre no coincide con la esperada.')

  // Recibo: existe solo para el pago aprobado y es el que se descarga (Bearer del padre y cookie de Dirección).
  const reciboA = sql(`SELECT id FROM public.recibos WHERE pago_id = '${pagos.a}';`)
  exigir(reciboA, 'El pago aprobado no tiene recibo.')
  assert.equal(sql(`SELECT count(*) FROM public.recibos WHERE pago_id = '${pagos.b}';`), '0', 'El pago rechazado no debe tener recibo.')
  const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(dir), 'utf8').toString('base64')}`
  for (const [canal, cabeceras] of [['app (Bearer del padre)', { authorization: `Bearer ${padre.access_token}` }], ['web (cookie de Dirección)', { cookie }]]) {
    const r = await fetch(`${urlWeb}/api/recibos/${reciboA}/pdf`, { headers: cabeceras, signal: AbortSignal.timeout(90_000) })
    assert.equal(r.status, 200, `El recibo no se descargó por el canal ${canal}.`)
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-', `El recibo del canal ${canal} no es un PDF.`)
  }
  const reciboB = await fetch(`${urlWeb}/api/recibos/${pagos.b}/pdf`, { headers: { authorization: `Bearer ${padre.access_token}` }, signal: AbortSignal.timeout(60_000) })
  exigir(reciboB.status >= 400, 'Un pago rechazado no debe producir recibo.')

  // Informes web de Dirección: reconcilian con los mismos pagos.
  // El informe filtra por FECHA DE TRANSFERENCIA (la que tipeó el padre), no por período de factura ni por fecha de aprobación.
  const consultar = async (desde, hasta) => {
    const r = await fetch(`${urlWeb}/api/reportes/economicos/ingresos?desde=${desde}&hasta=${hasta}`, { headers: { cookie }, signal: AbortSignal.timeout(90_000) })
    exigir(r.status === 200, `El informe de ingresos no respondió 200 (HTTP ${r.status}).`)
    return r.json()
  }
  const sinTransferencias = await consultar(e.desde, e.hasta)
  assert.equal((sinTransferencias.filas ?? []).some(f => f.pago_id === pagos.a), false, 'El período de factura no debe confundirse con la fecha de transferencia.')
  const cuerpo = await consultar(FECHA_TRANSFERENCIA, FECHA_TRANSFERENCIA)
  const filaA = (cuerpo.filas ?? []).find(f => f.pago_id === pagos.a)
  exigir(filaA, 'El informe de ingresos no incluye el pago aprobado.')
  assert.equal((cuerpo.filas ?? []).some(f => f.pago_id === pagos.b), false, 'El informe de ingresos incluye el pago rechazado.')
  // Por fila (no por totales globales): el stack puede contener otros pagos con la misma fecha de transferencia.
  const esperadoCentavos = String(ESPERADO.itemAprobado.centavos)
  assert.deepEqual([filaA.alumno_id, filaA.informado_centavos, filaA.imputado_centavos, filaA.diferencia_centavos],
    [e.hijo.perfilId, esperadoCentavos, esperadoCentavos, '0'], 'El informe no reconcilia con el importe y el alumno esperados.')
  log('Estados, saldos, recibo e informes consistentes entre app y web.')
}

// ---- simular-app (solo diagnóstico local) --------------------------------------------------------------------
async function simularApp() {
  const e = leerEstado()
  const padre = await sesion(e.padre)
  for (const [item, centavos, numero] of [[e.id.iA, ESPERADO.itemAprobado.centavos, 'A'], [e.id.iB, ESPERADO.itemRechazado.centavos, 'B']]) {
    const p = await http('/rest/v1/rpc/registrar_pago', { method: 'POST', token: padre.access_token, body: { p_clave_intento: crypto.randomUUID(), p_item_ids: [item], p_total_esperado_centavos: centavos } })
    exigir(p.status === 200, 'registrar_pago falló en la simulación.')
    const prep = await http('/rest/v1/rpc/preparar_carga_comprobante', { method: 'POST', token: padre.access_token, body: {
      p_clave_carga: crypto.randomUUID(), p_pago_id: p.data.pago_id, p_fecha: FECHA_TRANSFERENCIA, p_importe: (centavos / 100).toFixed(2),
      p_numero: `OP-SIM-${numero}-${hmac('sim').slice(0, 6)}`, p_tipo_mime: 'image/png', p_tamano: PNG.length } })
    exigir(prep.status === 200, 'preparar_carga_comprobante falló en la simulación.')
    const s = await fetch(`${local.api}/storage/v1/object/${prep.data.bucket_temporal}/${prep.data.ruta_temporal}`, {
      method: 'POST', headers: { apikey: local.anon, authorization: `Bearer ${padre.access_token}`, 'content-type': 'image/png', 'x-upsert': 'false' }, body: PNG })
    exigir(s.status === 200, 'La subida simulada falló.')
    const f = await fetch(`${urlWeb}/api/comprobantes/cargas/${prep.data.carga_id}/finalizacion`, { method: 'POST', headers: { authorization: `Bearer ${padre.access_token}` }, signal: AbortSignal.timeout(90_000) })
    exigir(f.status === 200, 'La finalización simulada falló.')
  }
  log('Simulación local (NO es evidencia nativa): dos pagos con comprobante registrados.')
}

const acciones = { preparar, decidir, verificar, 'simular-app': simularApp, entorno, publicar }
try {
  exigir(PLATAFORMAS.includes(plataforma), 'Plataforma desconocida (android | ios).')
  exigir(acciones[accion], 'Acción desconocida.')
  if (accion !== 'entorno') resolverBackend()
  await acciones[accion]()
} catch (error) {
  // Nunca se imprimen objetos de proveedor: podrían incluir credenciales o JWT.
  console.error(`El ciclo económico falló en «${accion}»: ${error instanceof Error ? error.message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/gu, '[JWT]') : 'error desconocido'}`)
  process.exitCode = 1
}
