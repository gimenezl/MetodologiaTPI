// EPT-96 · Runner funcional del prototipo navegable.
// Uso (desde la raíz del repositorio, con `npm ci` hecho y Chromium instalado):
//   node docs/parte3/EPT-96/pruebas/prototipo.mjs [--capturas <directorio>] [--rapido]
// Fases: U (reglas puras) · S (aislamiento del servidor) · N (navegador real, Chromium vía Playwright).
// Sale con código 1 ante cualquier fallo; tiene un límite total de tiempo y cierra navegador y servidor en finally.
import assertBase from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { iniciarServidor, RUTAS } from '../servidor/servidor.mjs'
import { crearBase, REFERENCIA, TARIFAS } from '../prototipo/js/datos.mjs'
import { formatoArs, formatoFecha, formatoNumero, parsearFecha, parsearImporte } from '../prototipo/js/dinero.mjs'
import {
  deudaPorItem, deudaTotal, estadoFactura, facturasSinPagosEnRango, guardarComprobante, pagosEnRango, puedeOperar, puedeVerHijo, puedeVerOriginal,
  registrarPago, saldoFactura, totalPago, totalSeleccion, totalesPeriodo, validarArchivo,
} from '../prototipo/js/reglas.mjs'

const LIMITE_TOTAL_MS = 4 * 60_000
const argumentos = process.argv.slice(2)
const valorDe = nombre => { const i = argumentos.indexOf(nombre); return i >= 0 ? argumentos[i + 1] : null }
const dirCapturas = valorDe('--capturas') ? path.resolve(valorDe('--capturas')) : mkdtempSync(path.join(tmpdir(), 'ept96-capturas-'))
mkdirSync(dirCapturas, { recursive: true })

// ---------- infraestructura mínima de pruebas ----------
// Cada aserción se cuenta: una prueba que no afirma nada no es una prueba.
let aserciones = 0
const assert = Object.fromEntries(['equal', 'notEqual', 'deepEqual', 'ok', 'match', 'throws', 'fail'].map(nombre => [nombre, (...argumentos) => { aserciones++; return assertBase[nombre](...argumentos) }]))
const REQUERIDAS = ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06',
  'N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09', 'N10', 'N11', 'N12', 'N13', 'N13b', 'N14', 'N15', 'N16']
const resultados = []
const inicioGlobal = Date.now()
const solo = valorDe('--solo')?.split(',') ?? null // depuración: ejecutar solo ciertas pruebas (p. ej. --solo N03,N12)
async function prueba(id, titulo, fn) {
  if (solo && !solo.includes(id)) return
  const inicio = Date.now()
  aserciones = 0
  try { await fn(); assertBase.ok(aserciones > 0, 'la prueba no ejecutó ninguna aserción'); resultados.push({ id, titulo, ok: true, ms: Date.now() - inicio }); console.log(`  PASS ${id} ${titulo} (${Date.now() - inicio} ms)`) } catch (error) {
    resultados.push({ id, titulo, ok: false, ms: Date.now() - inicio, error: String(error?.message ?? error).split('\n').slice(0, 6).join(' | ') })
    console.log(`  FAIL ${id} ${titulo}\n       ${String(error?.message ?? error).split('\n').slice(0, 8).join('\n       ')}`)
  }
}
const cents = (...v) => v.reduce((a, b) => a + b, 0)
const NBSP = String.fromCharCode(160)

// =====================================================================================
// U · reglas puras
// =====================================================================================
async function fasePura() {
  console.log('Fase U · reglas puras')
  await prueba('U01', 'importes en centavos y formato ARS con dos decimales', () => {
    assert.equal(formatoNumero(10249660), '102.496,60')
    assert.equal(formatoNumero(5), '0,05')
    assert.equal(formatoArs(6360665), `ARS${NBSP}63.606,65`)
    assert.equal(cents(...Object.values(TARIFAS)), 10249660)
    const db = crearBase()
    assert.equal(deudaTotal(db, 'mateo'), 8253210)
    assert.equal(deudaTotal(db, 'sofia'), 7109095)
    assert.equal(saldoFactura(db.facturas.find(f => f.id === 'mateo-sep')), 4126605)
    assert.equal(saldoFactura(db.facturas.find(f => f.id === 'mateo-oct')), 4126605)
    assert.equal(totalSeleccion(db, 'mateo', ['mateo-sep-comedor', 'mateo-oct-transporte', 'mateo-oct-comedor']).total, 6360665)
    assert.equal(parsearImporte('63.606,65'), 6360665)
    assert.equal(parsearImporte('63606,6'), 6360660)
    assert.equal(parsearImporte('63606'), 6360600)
    for (const malo of ['', '0', '-5', '1e3', '12,345', '1.2', 'abc', '1..000,00']) assert.equal(parsearImporte(malo), null, malo)
    assert.equal(parsearFecha('09/10/2026'), '2026-10-09')
    assert.equal(parsearFecha('31/02/2026'), null)
    assert.equal(formatoFecha('2026-10-09'), '09/10/2026')
  })
  await prueba('U02', 'estados de factura con referencia 09/10/2026 y precedencia de Vencida', () => {
    const db = crearBase(), estado = id => estadoFactura(db.facturas.find(f => f.id === id))
    assert.equal(REFERENCIA, '2026-10-09')
    assert.equal(estado('mateo-sep'), 'vencida') // con ítems pagados y saldo después del día 10
    assert.equal(estado('mateo-oct'), 'parcial')
    assert.equal(estado('mateo-ago'), 'pagada')
    assert.equal(estado('sofia-oct'), 'pendiente')
    // El día del vencimiento todavía no es Vencida; el día siguiente sí.
    const f = db.facturas.find(x => x.id === 'mateo-oct')
    assert.equal(estadoFactura(f, '2026-10-10'), 'parcial')
    assert.equal(estadoFactura(f, '2026-10-11'), 'vencida')
  })
  await prueba('U03', 'selección: solo pendientes, mismo hijo, sin duplicados, total del sistema', () => {
    const db = crearBase()
    for (const mal of [['mateo-sep-cuota'], ['mateo-sep-transporte'], ['sofia-oct-cuota'], ['inexistente'], [], ['mateo-oct-comedor', 'mateo-oct-comedor']]) {
      assert.ok(totalSeleccion(db, 'mateo', mal).error, JSON.stringify(mal))
    }
    assert.equal(totalSeleccion(db, 'sofia', ['sofia-oct-cuota', 'sofia-oct-comedor']).total, 7109095)
    assert.ok(totalSeleccion(db, 'sofia', ['mateo-oct-comedor']).error) // no se mezclan hijos
  })
  await prueba('U04', 'registrar pago deja ítems en verificación y no cambia saldo ni estado', () => {
    const db = crearBase(); db.banco.simulado = true
    const laura = { correo: 'laura.ejemplo@ejemplo.test', rol: 'PADRE', hijos: ['mateo', 'sofia'] }
    const antes = { saldo: deudaTotal(db, 'mateo'), estado: db.facturas.map(f => estadoFactura(f)) }
    const r = registrarPago(db, laura, 'mateo', ['mateo-oct-comedor'])
    assert.equal(r.pago.estado, 'pendiente')
    assert.equal(db.facturas.find(f => f.id === 'mateo-oct').items.find(i => i.concepto === 'comedor').estado, 'verificacion')
    assert.equal(deudaTotal(db, 'mateo'), antes.saldo)
    assert.deepEqual(db.facturas.map(f => estadoFactura(f)), antes.estado)
    assert.ok(registrarPago(db, laura, 'mateo', ['mateo-oct-comedor']).error) // ya no seleccionable
    const sinBanco = crearBase()
    assert.match(registrarPago(sinBanco, laura, 'mateo', ['mateo-oct-comedor']).error, /no están configurados/u)
    assert.equal(sinBanco.pagos.length, 4)
  })
  await prueba('U05', 'número de operación único entre no rechazados; importe distinto aceptado', () => {
    const db = crearBase(); db.banco.simulado = true
    const laura = { correo: 'laura.ejemplo@ejemplo.test', rol: 'PADRE', hijos: ['mateo', 'sofia'] }
    const { pago } = registrarPago(db, laura, 'mateo', ['mateo-oct-comedor'])
    const archivo = [{ id: 'jpg', nombre: 'a.jpg', tipo: 'image/jpeg', bytes: 1000 }]
    const duplicado = guardarComprobante(db, laura, pago.id, { archivos: archivo, fecha: '09/10/2026', importe: '1.000,00', operacion: '00012345' })
    assert.match(duplicado.errores.operacion, /ya está registrado/u)
    db.pagos.find(p => p.operacion === '00012345').estado = 'rechazado' // un rechazo libera el número
    const ok = guardarComprobante(db, laura, pago.id, { archivos: archivo, fecha: '09/10/2026', importe: '1.000,00', operacion: '00012345' })
    assert.equal(ok.pago.importeInformado, 100000)
    assert.notEqual(ok.pago.importeInformado, totalPago(db, ok.pago)) // distinto del total: se acepta como dato de conciliación
    assert.equal(ok.pago.estado, 'pendiente')
  })
  await prueba('U06', 'validación de archivos: JPG/PNG/PDF y 5 MB por archivo', () => {
    assert.equal(validarArchivo({ tipo: 'image/jpeg', bytes: 1 }), null)
    assert.equal(validarArchivo({ tipo: 'image/png', bytes: 5 * 1024 * 1024 }), null)
    assert.equal(validarArchivo({ tipo: 'application/pdf', bytes: 5 * 1024 * 1024 + 1 }), 'Supera el máximo de 5 MB por archivo.')
    assert.match(validarArchivo({ tipo: 'image/heic', bytes: 1 }), /Tipo no permitido/u)
  })
  await prueba('U07', 'período con extremos inclusive; facturas sin pagos por vencimiento', () => {
    const db = crearBase()
    assert.deepEqual(pagosEnRango(db, 'mateo', '2026-09-05', '2026-10-03').map(p => p.id), ['p1', 'p2'])
    assert.deepEqual(pagosEnRango(db, 'mateo', '2026-09-06', '2026-10-06').map(p => p.id), ['p2'])
    assert.deepEqual(facturasSinPagosEnRango(db, 'sofia', '2026-09-01', '2026-10-09'), [])
    assert.deepEqual(facturasSinPagosEnRango(db, 'sofia', '2026-09-01', '2026-10-10').map(f => f.id), ['sofia-oct'])
    assert.deepEqual(totalesPeriodo(db, 'mateo', '2026-09-01', '2026-10-09'), { aprobados: 12246110, verificacion: 1892545 })
    // Un pago registrado sin comprobante aún no tiene fecha de transferencia: su factura sigue figurando por vencimiento.
    const db2 = crearBase(); db2.banco.simulado = true
    registrarPago(db2, { correo: 'laura.ejemplo@ejemplo.test', rol: 'PADRE', hijos: ['mateo', 'sofia'] }, 'sofia', ['sofia-oct-cuota'])
    assert.deepEqual(facturasSinPagosEnRango(db2, 'sofia', '2026-09-01', '2026-10-10').map(f => f.id), ['sofia-oct'])
    const { grupos, total } = deudaPorItem(db, 'mateo', '2026-09-01', '2026-10-31')
    assert.equal(total, 8253210)
    assert.deepEqual(grupos.map(g => g.concepto), ['transporte', 'comedor', 'cuota', 'deporte'])
    assert.equal(deudaPorItem(db, 'mateo', '2026-10-01', '2026-10-31').total, 4126605)
  })
  await prueba('U08', 'permisos por rol, vínculo y cargador', () => {
    const db = crearBase()
    const laura = { correo: 'laura.ejemplo@ejemplo.test', rol: 'PADRE', hijos: ['mateo', 'sofia'] }
    const diego = { correo: 'diego.ejemplo@ejemplo.test', rol: 'PADRE', hijos: ['mateo'] }
    const mateo = { correo: 'mateo.ejemplo@ejemplo.test', rol: 'ESTUDIANTE', hijo: 'mateo' }
    const director = { correo: 'direccion@ejemplo.test', rol: 'DIRECTOR' }
    const bloqueada = { ...laura, bloqueada: true }
    const p3 = db.pagos.find(p => p.id === 'p3')
    assert.ok(puedeVerHijo(laura, 'sofia') && !puedeVerHijo(diego, 'sofia') && puedeVerHijo(mateo, 'mateo') && !puedeVerHijo(mateo, 'sofia'))
    assert.ok(!puedeVerHijo(director, 'mateo') && !puedeVerHijo(bloqueada, 'mateo'))
    assert.ok(puedeOperar(laura, 'mateo') && puedeOperar(diego, 'mateo') && !puedeOperar(mateo, 'mateo') && !puedeOperar(director, 'mateo'))
    assert.ok(puedeVerOriginal(laura, p3) && !puedeVerOriginal(diego, p3) && !puedeVerOriginal(mateo, p3) && !puedeVerOriginal(bloqueada, p3))
  })
}

// =====================================================================================
// S · aislamiento del servidor
// =====================================================================================
const cabecera = (respuesta, nombre) => respuesta.cabeceras[nombre]
const CSP_ESPERADA = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'"
// Toda respuesta, también los errores, lleva las cabeceras de seguridad.
const seguras = (r, etiqueta) => {
  assert.equal(cabecera(r, 'x-content-type-options'), 'nosniff', etiqueta)
  assert.equal(cabecera(r, 'content-security-policy'), CSP_ESPERADA, etiqueta)
  assert.match(cabecera(r, 'content-type'), /^text\/plain/u, etiqueta)
}
function pedir(puerto, { ruta, metodo = 'GET', anfitrion = `127.0.0.1:${puerto}` }) {
  return new Promise((resolver, rechazar) => {
    const req = request({ host: '127.0.0.1', port: puerto, path: ruta, method: metodo, headers: { Host: anfitrion }, timeout: 5000 }, res => {
      const trozos = []
      res.on('data', t => trozos.push(t))
      res.on('end', () => resolver({ estado: res.statusCode, cabeceras: res.headers, cuerpo: Buffer.concat(trozos).toString('latin1') }))
    })
    req.on('timeout', () => req.destroy(new Error(`tiempo agotado: ${ruta}`)))
    req.on('error', rechazar)
    req.end()
  })
}

async function faseServidor(puerto) {
  console.log('Fase S · servidor')
  const esperadas = ['/', '/index.html', '/estilos.css', '/js/app.mjs', '/js/datos.mjs', '/js/dinero.mjs', '/js/pantallas.mjs', '/js/reglas.mjs', '/js/vista.mjs',
    '/activos/outfit-latin-400-normal.woff2', '/activos/outfit-latin-500-normal.woff2', '/activos/outfit-latin-600-normal.woff2', '/activos/outfit-latin-700-normal.woff2',
    '/activos/geist-mono-latin.woff2', '/activos/logo-emblema.png']
  await prueba('S01', 'la lista de rutas es cerrada y apunta solo a archivos del paquete', () => {
    assert.deepEqual([...RUTAS.keys()].sort(), [...esperadas].sort())
    const base = path.resolve(import.meta.dirname, '..', '..')
    for (const { archivo } of RUTAS.values()) {
      const relativa = path.relative(base, archivo).split(path.sep)
      assert.ok(!relativa.includes('..') && (relativa[0] === 'EPT-96' || relativa.slice(0, 2).join('/') === 'EPT-95/fuentes'), archivo)
      assert.ok(!path.basename(archivo).startsWith('.'), archivo)
    }
  })
  await prueba('S02', 'cada ruta permitida responde 200 con tipo, nosniff y CSP restrictiva', async () => {
    for (const ruta of esperadas) {
      const r = await pedir(puerto, { ruta })
      assert.equal(r.estado, 200, ruta)
      assert.equal(cabecera(r, 'x-content-type-options'), 'nosniff', ruta)
      assert.equal(cabecera(r, 'content-security-policy'), CSP_ESPERADA, ruta) // cadena exacta: una CSP aflojada no pasa
      assert.equal(cabecera(r, 'cache-control'), 'no-store', ruta)
    }
    const html = await pedir(puerto, { ruta: '/' })
    assert.match(cabecera(html, 'content-type'), /^text\/html/u)
    assert.ok(!/<script(?![^>]*src=)/u.test(html.cuerpo), 'sin scripts en línea')
  })
  await prueba('S03', 'traversal, doble codificación, .env y variantes responden 404', async () => {
    const malas = ['/.env', '/../.env', '/%2e%2e/.env', '/%2e%2e%2f.env', '/%252e%252e/.env', '/js/../../../../.env', '/js/..%2f..%2f..%2f.env', '/..%5c..%5c.env',
      '/activos/../../../../.env', '/js/', '/js', '/activos/', '/activos', '/servidor/servidor.mjs', '/pruebas/prototipo.mjs', '/package.json', '/docs/ci.md',
      '/JS/app.mjs', '/js/app.mjs/', '/js/app.mjs?x=1', '/js/app.mjs#x', '/js/app.mjs%00.png', '/js%5capp.mjs', '//etc/passwd', '/js//app.mjs', '/./js/app.mjs',
      '/activos/logo-emblema.png/..', '/activos/%2e%2e/%2e%2e/.env.local', '/estilos.css.map', '/favicon.ico', '/.git/config']
    for (const ruta of malas) {
      const r = await pedir(puerto, { ruta })
      assert.equal(r.estado, 404, `${ruta} → ${r.estado}`)
      seguras(r, ruta)
      assert.ok(!/SUPABASE|SERVICE_ROLE|password/iu.test(r.cuerpo), ruta)
    }
  })
  await prueba('S04', 'solo GET y HEAD; HEAD no devuelve cuerpo', async () => {
    for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE']) {
      const r = await pedir(puerto, { ruta: '/', metodo })
      assert.equal(r.estado, 405, metodo)
      seguras(r, metodo)
    }
    const head = await pedir(puerto, { ruta: '/estilos.css', metodo: 'HEAD' })
    assert.equal(head.estado, 200); assert.equal(head.cuerpo, '')
  })
  await prueba('S05', 'encabezado Host ajeno se rechaza (anti rebinding)', async () => {
    for (const anfitrion of ['evil.test', `127.0.0.1.evil.test:${puerto}`, 'localhost.evil.test', '10.0.0.5:4196']) {
      const r = await pedir(puerto, { ruta: '/', anfitrion })
      assert.equal(r.estado, 403, anfitrion)
      seguras(r, anfitrion)
    }
    assert.equal((await pedir(puerto, { ruta: '/', anfitrion: `localhost:${puerto}` })).estado, 200)
  })
  await prueba('S06', 'el servidor solo escucha en la interfaz local', async () => {
    const otro = await iniciarServidor({ puerto: 0 })
    try { assert.equal(otro.servidor.address().address, '127.0.0.1') } finally { await otro.cerrar() }
  })
}

// =====================================================================================
// N · navegador real
// =====================================================================================
async function cargarPlaywright() {
  try { return await import('playwright') } catch (error) {
    if (!process.env.EPT96_PLAYWRIGHT) throw error
    return import(pathToFileURL(process.env.EPT96_PLAYWRIGHT).href)
  }
}

const recoleccion = { consola: [], paginaErrores: [], fallidas: [], externas: [], noOk: [], csp: [], recursos: new Set() }

async function faseNavegador(url, servidorOrigen) {
  console.log('Fase N · navegador real (Chromium)')
  const { chromium } = await cargarPlaywright()
  const browser = await chromium.launch()
  const contextos = []
  try {
    // ---- utilidades ----
    async function abrir({ ancho = 390, alto = 844 } = {}) {
      const context = await browser.newContext({ viewport: { width: ancho, height: alto }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
        reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false, permissions: [] })
      contextos.push(context)
      await context.route('**/*', ruta => {
        const destino = ruta.request().url()
        if (destino.startsWith(servidorOrigen) || destino.startsWith('about:') || destino.startsWith('data:')) return ruta.continue()
        recoleccion.externas.push(destino); return ruta.abort()
      })
      await context.addInitScript(() => {
        window.__violaciones = []
        document.addEventListener('securitypolicyviolation', e => window.__violaciones.push(`${e.violatedDirective} ${e.blockedURI}`))
      })
      const page = await context.newPage()
      page.on('console', m => { if (['error', 'warning'].includes(m.type())) recoleccion.consola.push(`${m.type()}: ${m.text()}`) })
      page.on('pageerror', e => recoleccion.paginaErrores.push(String(e)))
      page.on('requestfailed', r => recoleccion.fallidas.push(`${r.url()} ${r.failure()?.errorText}`))
      page.on('response', r => { recoleccion.recursos.add(new URL(r.url()).pathname); if (r.status() !== 200) recoleccion.noOk.push(`${r.status()} ${r.url()}`) })
      page.on('dialog', d => { recoleccion.paginaErrores.push(`diálogo inesperado: ${d.message()}`); d.dismiss() })
      await page.goto(url)
      await pantalla(page, 'ingreso')
      return { page, context }
    }
    const pantalla = (page, nombre) => page.locator(`#app[data-pantalla="${nombre}"]`).waitFor({ timeout: 8000 })
    const textoApp = page => page.locator('#app').innerText()
    const hashActual = page => page.evaluate(() => location.hash)
    const ir = async (page, hash, esperada) => { await page.evaluate(h => { location.hash = h }, hash); if (esperada) await pantalla(page, esperada) }
    const cuenta = (page, nombre) => page.getByRole('button', { name: new RegExp(`^${nombre} ·`, 'u') }).click()
    const abrirPanel = page => page.evaluate(() => { document.getElementById('simulacion').open = true })
    const habilitarBanco = async page => { await abrirPanel(page); await page.locator('#sim-banco').check() }
    // En capturas de página completa la barra inferior pasa a flujo normal y se oculta el panel de simulación (no es parte de la app).
    const captura = async (page, nombre) => {
      await page.evaluate(() => { document.querySelectorAll('.nav').forEach(n => { n.style.position = 'static' }); document.getElementById('simulacion').style.display = 'none' })
      await page.screenshot({ path: path.join(dirCapturas, `${nombre}.png`), fullPage: true })
      await page.evaluate(() => { document.querySelectorAll('.nav').forEach(n => { n.style.position = '' }); document.getElementById('simulacion').style.display = '' })
    }
    const cuotasListas = async page => { await pantalla(page, 'cuotas'); await page.getByText('Saldo total adeudado').first().waitFor({ timeout: 8000 }) }
    // Espera (hasta 4 s) a que el texto aparezca: las acciones simuladas resuelven de forma asíncrona.
    const verContiene = async (page, ...cadenas) => {
      let t = ''
      for (let intento = 0; intento < 80; intento++) {
        t = await textoApp(page)
        if (cadenas.every(c => t.includes(c))) return
        await page.waitForTimeout(50)
      }
      const faltan = cadenas.filter(c => !t.includes(c))
      await page.screenshot({ path: path.join(dirCapturas, `fallo-${Date.now()}.png`), fullPage: true })
      assert.fail(`Falta ${faltan.map(c => `«${c}»`).join(', ')} en:\n${t.slice(0, 900)}`)
    }
    const verNoContiene = async (page, ...cadenas) => { const t = await textoApp(page); for (const c of cadenas) assert.ok(!t.includes(c), `Sobra «${c}» en:\n${t.slice(0, 700)}`) }
    const ars = c => formatoArs(c)
    const total = page => page.locator('#total-seleccion').innerText()
    const marcar = async (page, ...ids) => { for (const id of ids) await page.locator(`[data-item="${id}"]`).check() }
    async function datosTransferencia(page, { archivo = 'transferencia-1\\.jpg', operacion, importe = null, fecha = null }) {
      await page.getByRole('button', { name: new RegExp(`Agregar ejemplo: ${archivo}`, 'u') }).click()
      if (fecha !== null) await page.locator('#fecha').fill(fecha)
      if (importe !== null) await page.locator('#importe').fill(importe)
      if (operacion !== null) await page.locator('#operacion').fill(operacion)
    }
    // Registra un pago (con el escenario simulado) y devuelve el id del pago.
    async function registrarPagoUi(page, items, hijo = 'mateo') {
      await habilitarBanco(page)
      await ir(page, `#/h/${hijo}/pagar`, 'pagar')
      await marcar(page, ...items)
      await page.locator('#registrar-pago').click()
      await pantalla(page, 'pago')
      return (await hashActual(page)).split('/').at(-1)
    }

    // ---------------- N01 ----------------
    await prueba('N01', 'recorrido PADRE completo: ingreso → hijo → cuotas → factura → selección → pago → comprobante → confirmación', async () => {
      const { page } = await abrir()
      await verContiene(page, 'Ingresá a tu cuenta', 'CUENTAS DE EJEMPLO')
      assert.equal(await page.locator('.aviso-prototipo').innerText(), 'Prototipo — datos y operaciones simulados')
      assert.equal(await page.locator('#clave').isDisabled(), true) // sin contraseñas
      await captura(page, 'N01-01-ingreso')
      await cuenta(page, 'Laura Ejemplo')
      await pantalla(page, 'hijos')
      await verContiene(page, 'Mateo Ejemplo', 'Sofía Ejemplo', ars(8253210), ars(7109095))
      await captura(page, 'N01-02-selector-hijo')
      await page.getByRole('link', { name: /Mateo Ejemplo/u }).click()
      await cuotasListas(page)
      await verContiene(page, 'Septiembre 2026', 'Vencida', 'Octubre 2026', 'Pago parcial', ars(8253210))
      assert.ok((await textoApp(page)).indexOf('Septiembre 2026') < (await textoApp(page)).indexOf('Octubre 2026')) // Vencida primero
      await captura(page, 'N01-03-cuotas')
      await page.getByRole('link', { name: /Septiembre 2026/u }).click()
      await pantalla(page, 'factura')
      await verContiene(page, 'En verificación', 'Pendiente', ars(10249660), ars(6123055), ars(4126605))
      await captura(page, 'N01-04-factura')
      await page.getByRole('link', { name: 'Seleccionar ítems para pagar' }).click()
      await pantalla(page, 'pagar')
      await verContiene(page, 'Datos bancarios: no configurados.')
      await habilitarBanco(page)
      await marcar(page, 'mateo-sep-comedor', 'mateo-oct-transporte', 'mateo-oct-comedor')
      assert.equal(await total(page), ars(6360665))
      await verContiene(page, '3 ítems seleccionados · calculado por el sistema', 'Escenario simulado.')
      await captura(page, 'N01-05-seleccion')
      await page.locator('#registrar-pago').click()
      await pantalla(page, 'pago')
      await verContiene(page, 'Pago registrado: pendiente de verificación.', 'el saldo no cambia hasta que Dirección apruebe el pago', ars(6360665), 'Escenario simulado: no hubo transferencia real')
      await verNoContiene(page, 'aprobado')
      await captura(page, 'N01-06-pago-registrado')
      await page.getByRole('link', { name: 'Cargar comprobante' }).click()
      await pantalla(page, 'pago-comprobante')
      assert.equal(await page.locator('#importe').inputValue(), '63.606,65')
      await datosTransferencia(page, { operacion: '00098765' })
      await captura(page, 'N01-07-comprobante')
      await page.locator('#enviar-comprobante').click()
      await pantalla(page, 'pago-enviado')
      await verContiene(page, 'Recibimos tu comprobante.', 'Esto no confirma el pago', 'Pendiente de verificación', '00098765', 'transferencia-1.jpg')
      await captura(page, 'N01-08-confirmacion')
      await page.getByRole('link', { name: 'Ver pagos del período' }).click()
      await pantalla(page, 'periodo')
      await verContiene(page, '09/10/2026', ars(12246110), ars(1892545 + 6360665))
      await captura(page, 'N01-09-periodo')
      await page.getByRole('link', { name: 'Deuda' }).click()
      await pantalla(page, 'deuda')
      assert.equal(await page.locator('#total-deuda').innerText(), ars(8253210)) // el pago registrado no reduce la deuda
    })

    // ---------------- N02 ----------------
    await prueba('N02', 'dos hijos sin fuga de contexto ni mezcla de importes o registros', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await page.getByRole('link', { name: /Mateo Ejemplo/u }).click(); await cuotasListas(page)
      await page.getByRole('link', { name: 'Pagar ítems' }).click(); await pantalla(page, 'pagar')
      await marcar(page, 'mateo-sep-comedor')
      assert.equal(await total(page), ars(2234060))
      await page.getByRole('link', { name: 'Cambiar hijo' }).click(); await pantalla(page, 'hijos')
      await page.getByRole('link', { name: /Sofía Ejemplo/u }).click(); await cuotasListas(page)
      await verContiene(page, 'Sofía Ejemplo', 'Octubre 2026', 'Pendiente', ars(7109095))
      await verNoContiene(page, 'Septiembre 2026', ars(8253210), 'Mateo')
      await captura(page, 'N02-01-sofia-cuotas')
      await page.getByRole('link', { name: 'Pagar ítems' }).click(); await pantalla(page, 'pagar')
      assert.equal(await total(page), ars(0)) // la selección de Mateo no pasó a Sofía
      assert.equal(await page.locator('input[data-item]').count(), 2)
      assert.equal(await page.locator('[data-item^="mateo"]').count(), 0)
      await ir(page, '#/h/sofia/comprobantes', 'comprobantes')
      await verContiene(page, 'Todavía no hay pagos registrados')
      await ir(page, '#/h/sofia/factura/mateo-sep', 'sin-permiso') // factura de otro hijo
      await verNoContiene(page, 'ARS')
      await ir(page, '#/h/mateo/pagar', 'pagar')
      assert.equal(await total(page), ars(0)) // al volver a Mateo la selección no se conserva
      await captura(page, 'N02-02-mateo-sin-seleccion')
    })

    // ---------------- N03 ----------------
    await prueba('N03', 'selección: ítems completos, restricciones, totales y teclado', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await habilitarBanco(page)
      await ir(page, '#/h/mateo/pagar', 'pagar')
      for (const id of ['mateo-sep-cuota', 'mateo-sep-deporte', 'mateo-sep-transporte', 'mateo-oct-cuota', 'mateo-oct-deporte']) {
        assert.equal(await page.locator(`[data-item="${id}"]`).isDisabled(), true, `${id} no debe ser seleccionable`)
      }
      for (const id of ['mateo-sep-comedor', 'mateo-oct-transporte', 'mateo-oct-comedor']) assert.equal(await page.locator(`[data-item="${id}"]`).isEnabled(), true, id)
      await verContiene(page, 'Los pagados o en verificación no se pueden seleccionar')
      await page.locator('#registrar-pago').click() // sin selección
      await verContiene(page, 'Seleccioná al menos un ítem para continuar.')
      assert.equal(await page.locator('#app').getAttribute('data-pantalla'), 'pagar')
      await captura(page, 'N03-01-sin-seleccion')
      await marcar(page, 'mateo-sep-comedor')
      assert.equal(await total(page), ars(TARIFAS.comedor))
      await marcar(page, 'mateo-oct-transporte')
      assert.equal(await total(page), ars(TARIFAS.comedor + TARIFAS.transporte))
      await page.locator('[data-item="mateo-sep-comedor"]').uncheck()
      assert.equal(await total(page), ars(TARIFAS.transporte))
      await page.locator('[data-item="mateo-oct-comedor"]').focus()
      await page.keyboard.press('Space') // teclado
      assert.equal(await total(page), ars(TARIFAS.transporte + TARIFAS.comedor))
      await verContiene(page, '2 ítems seleccionados')
      await captura(page, 'N03-02-seleccion-parcial')
    })

    // ---------------- N04 ----------------
    await prueba('N04', 'banco no configurado bloquea la acción operativa; escenario simulado inequívoco', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await ir(page, '#/h/mateo/pagar', 'pagar')
      await marcar(page, 'mateo-oct-comedor')
      assert.equal(await page.locator('#registrar-pago').getAttribute('aria-disabled'), 'true')
      await page.locator('#registrar-pago').click({ force: true })
      await page.waitForTimeout(150)
      assert.equal(await page.locator('#app').getAttribute('data-pantalla'), 'pagar') // no avanzó
      await verContiene(page, 'Datos bancarios: no configurados.', 'No se acepta pago en efectivo.', 'habilitá el escenario simulado')
      const texto = await textoApp(page)
      assert.ok(!/\bCBU\b\s*:?\s*\d|\balias\s*:|\btitular\s*:/iu.test(texto), 'no se inventan datos bancarios')
      await captura(page, 'N04-01-banco-no-configurado')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      assert.equal(await page.locator('article.pago').count(), 4) // no se creó ningún pago
      await habilitarBanco(page)
      await ir(page, '#/h/mateo/pagar', 'pagar')
      await verContiene(page, 'Escenario simulado.', 'no hay CBU, alias ni titular', 'No se realiza ninguna transferencia real')
      assert.equal(await page.locator('#registrar-pago').getAttribute('aria-disabled'), null)
      await captura(page, 'N04-02-escenario-simulado')
    })

    // ---------------- N05 ----------------
    await prueba('N05', 'validaciones y confirmación simuladas; el comprobante no aprueba ni reduce saldo', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      const pago = await registrarPagoUi(page, ['mateo-sep-comedor'])
      await page.getByRole('link', { name: 'Cargar comprobante' }).click(); await pantalla(page, 'pago-comprobante')
      await page.locator('#fecha').fill('')
      await page.locator('#importe').fill('abc')
      await page.locator('#enviar-comprobante').click()
      await verContiene(page, 'Revisá los datos marcados para continuar.', 'Agregá al menos un archivo.', 'Ingresá la fecha de transferencia con el formato dd/mm/aaaa.',
        'Ingresá un importe válido', 'Ingresá el número de operación')
      assert.equal(await page.locator('#fecha').getAttribute('aria-invalid'), 'true')
      assert.match(await page.locator('#fecha').getAttribute('aria-describedby'), /fecha-error/u)
      await captura(page, 'N05-01-validaciones')
      await page.locator('#fecha').fill('09/10/2026'); await page.locator('#importe').fill('22.340,60')
      await page.getByRole('button', { name: /Agregar ejemplo: foto-recibo\.heic/u }).click()
      await page.getByRole('button', { name: /Agregar ejemplo: resumen-banco\.pdf/u }).click()
      await verContiene(page, 'Tipo no permitido. Usá un archivo JPG, PNG o PDF.', 'Supera el máximo de 5 MB por archivo.')
      await page.locator('#operacion').fill('00012345')
      await page.locator('#enviar-comprobante').click()
      await verContiene(page, 'Quitá los archivos con errores para continuar.', 'Ese número de operación ya está registrado en otro pago. Revisalo.')
      await captura(page, 'N05-02-archivos-y-duplicado')
      await page.getByRole('button', { name: 'Quitar foto-recibo.heic' }).click()
      await page.getByRole('button', { name: 'Quitar resumen-banco.pdf' }).click()
      await page.getByRole('button', { name: /Agregar ejemplo: comprobante-banco\.pdf/u }).click()
      await page.locator('#importe').fill('1.000,00')
      await verContiene(page, 'El importe informado difiere del total calculado')
      await page.locator('#operacion').fill('00099001')
      await page.locator('#enviar-comprobante').click()
      await pantalla(page, 'pago-enviado')
      await verContiene(page, 'dato de conciliación', ars(100000), ars(2234060), 'comprobante-banco.pdf')
      await captura(page, 'N05-03-confirmacion-conciliacion')
      await ir(page, '#/h/mateo/cuotas', 'cuotas'); await cuotasListas(page)
      await verContiene(page, ars(8253210)) // el saldo no cambia
      assert.match(await page.getByRole('link', { name: /Septiembre 2026/u }).innerText(), /Vencida/u)
      await ir(page, `#/h/mateo/factura/mateo-sep`, 'factura')
      assert.match(await page.locator('.item', { hasText: 'Comedor' }).innerText(), /En verificación/u)
      await ir(page, `#/h/mateo/pago/${pago}/comprobante`, 'pago-comprobante')
      await verContiene(page, 'Ya informaste estos datos para este pago.', '00099001')
      await page.getByRole('button', { name: /Agregar ejemplo: transferencia-1\.jpg/u }).click()
      await page.locator('#enviar-comprobante').click(); await pantalla(page, 'pago-enviado')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      await verContiene(page, '2 comprobantes registrados')
    })

    // ---------------- N06 ----------------
    await prueba('N06', 'resultado incierto: releer el estado antes de reintentar, sin duplicados', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      // Caso 1: el sistema sí guardó.
      const p1 = await registrarPagoUi(page, ['mateo-sep-comedor'])
      await ir(page, `#/h/mateo/pago/${p1}/comprobante`, 'pago-comprobante')
      await abrirPanel(page); await page.locator('#sim-envio').selectOption('incierto-guardo')
      await datosTransferencia(page, { operacion: '00077001' })
      await page.locator('#enviar-comprobante').click(); await pantalla(page, 'pago-incierto')
      await verContiene(page, 'No pudimos confirmar si se guardó tu comprobante.', 'Antes de reintentar, revisá el estado para no duplicarlo.')
      assert.equal(await page.getByRole('button', { name: 'Reintentar envío' }).count(), 0) // no se ofrece reintento sin revisar
      await captura(page, 'N06-01-incierto')
      await page.getByRole('button', { name: 'Revisar estado' }).click()
      await page.locator('#app').getByText('El comprobante figura como recibido.').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Reintentar envío' }).count(), 0)
      await captura(page, 'N06-02-recibido')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      assert.match(await page.locator('article.pago', { hasText: 'Comedor' }).first().innerText(), /1 comprobante registrado/u)
      // Caso 2: el sistema no guardó; el reintento ocurre una sola vez.
      const p2 = await registrarPagoUi(page, ['mateo-oct-transporte'])
      await ir(page, `#/h/mateo/pago/${p2}/comprobante`, 'pago-comprobante')
      await abrirPanel(page); await page.locator('#sim-envio').selectOption('incierto-no-guardo')
      await datosTransferencia(page, { operacion: '00077002' })
      await page.locator('#enviar-comprobante').click(); await pantalla(page, 'pago-incierto')
      await page.getByRole('button', { name: 'Revisar estado' }).click()
      await page.locator('#app').getByText('El comprobante no figura como recibido.').waitFor()
      await captura(page, 'N06-03-no-recibido')
      await page.getByRole('button', { name: 'Reintentar envío' }).click(); await pantalla(page, 'pago-enviado')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      assert.match(await page.locator('article.pago', { hasText: 'Transporte' }).first().innerText(), /1 comprobante registrado/u)
      assert.equal(await page.locator('article.pago').count(), 6)
      // Doble clic en «Enviar comprobante»: un solo comprobante.
      const p3 = await registrarPagoUi(page, ['mateo-oct-comedor'])
      await ir(page, `#/h/mateo/pago/${p3}/comprobante`, 'pago-comprobante')
      await datosTransferencia(page, { operacion: '00077003' })
      await page.locator('#enviar-comprobante').dblclick()
      await pantalla(page, 'pago-enviado'); await page.waitForTimeout(200)
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      assert.match(await page.locator('article.pago', { hasText: '00077003' }).innerText(), /1 comprobante registrado/u)
      // «Atrás» tras un resultado incierto no reabre el formulario antes de revisar el estado.
      const p4 = await registrarPagoUi(page, ['sofia-oct-comedor'], 'sofia')
      await ir(page, `#/h/sofia/pago/${p4}/comprobante`, 'pago-comprobante')
      await abrirPanel(page); await page.locator('#sim-envio').selectOption('incierto-guardo')
      await datosTransferencia(page, { operacion: '00077004' })
      await page.locator('#enviar-comprobante').click(); await pantalla(page, 'pago-incierto')
      await page.goBack(); await pantalla(page, 'pago-incierto')
      assert.equal(await page.locator('#enviar-comprobante').count(), 0)
      await ir(page, `#/h/sofia/pago/${p4}/comprobante`, 'pago-incierto') // tampoco por enlace directo
      // La pantalla de resultado incierto no se mezcla entre pagos.
      await ir(page, `#/h/mateo/pago/${p1}/incierto`, 'comprobantes')
      await ir(page, '#/h/mateo/pago/p3/incierto', 'comprobantes')
      // Tras un envío exitoso, «Cargar otro comprobante» y «Atrás» abren el formulario (no un resultado incierto).
      const p5 = await registrarPagoUi(page, ['sofia-oct-cuota'], 'sofia')
      await ir(page, `#/h/sofia/pago/${p5}/comprobante`, 'pago-comprobante')
      await datosTransferencia(page, { operacion: '00077005' })
      await page.locator('#enviar-comprobante').click(); await pantalla(page, 'pago-enviado')
      await page.getByRole('link', { name: 'Cargar otro comprobante' }).click(); await pantalla(page, 'pago-comprobante')
      await verContiene(page, 'Ya informaste estos datos para este pago.')
      await page.goBack(); await pantalla(page, 'pago-enviado')
      await page.goBack(); await pantalla(page, 'pago-comprobante')
    })

    // ---------------- N07 ----------------
    await prueba('N07', 'recorrido ESTUDIANTE: información propia sin selector, pago, selección ni original', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Mateo Ejemplo'); await cuotasListas(page)
      assert.equal(await hashActual(page), '#/h/mateo/cuotas') // entra directo, sin selector
      await verContiene(page, 'Información propia', ars(8253210), 'Septiembre 2026')
      assert.equal(await page.getByRole('link', { name: 'Cambiar hijo' }).count(), 0)
      assert.equal(await page.getByRole('link', { name: 'Pagar ítems' }).count(), 0)
      await captura(page, 'N07-01-cuotas-estudiante')
      await page.getByRole('link', { name: /Septiembre 2026/u }).click(); await pantalla(page, 'factura')
      await verContiene(page, 'Solo consulta.', 'En verificación')
      assert.equal(await page.getByRole('link', { name: 'Seleccionar ítems para pagar' }).count(), 0)
      await captura(page, 'N07-02-factura-estudiante')
      await page.getByRole('link', { name: 'Período' }).click(); await pantalla(page, 'periodo')
      await verContiene(page, 'El archivo no está disponible para estudiantes.', ars(12246110))
      assert.equal(await page.getByRole('link', { name: /Ver archivo/u }).count(), 0)
      await captura(page, 'N07-03-periodo-estudiante')
      await page.getByRole('link', { name: 'Deuda' }).click(); await pantalla(page, 'deuda')
      await verContiene(page, ars(8253210), 'Transporte', 'Comedor')
      await page.getByRole('link', { name: 'Inscripciones' }).click(); await pantalla(page, 'inscripciones')
      await verContiene(page, 'Fútbol · Grupo A (ejemplo)', 'Martes y jueves, 17:00 a 18:30', 'Recorrido Norte (ejemplo)', 'Inscripto', 'Solo consulta.')
      await captura(page, 'N07-04-inscripciones-estudiante')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      await verContiene(page, 'Solo consulta.', 'Ves el registro de los comprobantes, no el archivo.')
      assert.equal(await page.getByRole('link', { name: /Cargar comprobante|Ver archivo/u }).count(), 0)
    })

    // ---------------- N08 ----------------
    await prueba('N08', 'navegación directa no permitida: estudiante, otro padre, sin sesión y canal web', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Mateo Ejemplo'); await cuotasListas(page)
      for (const destino of ['#/hijos', '#/h/mateo/pagar', '#/h/mateo/pago/p3', '#/h/mateo/pago/p3/comprobante', '#/h/mateo/pago/p3/enviado', '#/h/mateo/archivo/p3',
        '#/h/sofia/cuotas', '#/h/sofia/inscripciones', '#/h/sofia/pagar']) {
        await ir(page, destino, 'sin-permiso')
        assert.equal(await hashActual(page), '#/sin-permiso', destino)
        await verContiene(page, 'Esta sección no está disponible para tu cuenta')
        await verNoContiene(page, 'ARS', 'transferencia-transporte.jpg')
      }
      await captura(page, 'N08-01-estudiante-denegado')
      await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await pantalla(page, 'ingreso')
      await page.goBack() // el historial no reabre datos económicos
      await pantalla(page, 'ingreso'); await verNoContiene(page, 'ARS')
      // Otro padre vinculado.
      await cuenta(page, 'Diego Ejemplo'); await pantalla(page, 'hijos')
      await verNoContiene(page, 'Sofía')
      for (const destino of ['#/h/sofia/cuotas', '#/h/mateo/archivo/p3', '#/h/mateo/pago/p3/comprobante']) { await ir(page, destino, 'sin-permiso'); await verNoContiene(page, 'ARS') }
      for (const destino of ['#/h/mateo/pago/p3', '#/h/mateo/pago/p3/enviado', '#/h/mateo/pago/p3/incierto']) { await ir(page, destino, 'sin-permiso'); await verNoContiene(page, 'ARS') }
      await captura(page, 'N08-02-padre-vinculado-denegado')
      // Sin sesión: enlace directo.
      const sin = await abrir()
      await ir(sin.page, '#/h/mateo/cuotas', 'ingreso')
      await verContiene(sin.page, 'Iniciá sesión para continuar.'); await verNoContiene(sin.page, 'ARS')
      assert.equal(await hashActual(sin.page), '#/ingreso')
      await captura(sin.page, 'N08-03-sin-sesion')
    })

    // ---------------- N09 ----------------
    await prueba('N09', 'DIRECTOR, DOCENTE y PERSONAL: orientación al canal web sin información económica', async () => {
      for (const [indice, nombre] of ['Dirección Ejemplo', 'Docente Ejemplo', 'Personal Ejemplo'].entries()) {
        const { page } = await abrir()
        await cuenta(page, nombre); await pantalla(page, 'canal-web')
        await verContiene(page, 'Esta aplicación es para padres, madres y estudiantes', 'Ingresá desde la versión web del sistema.')
        await verNoContiene(page, 'ARS', 'Cuotas', 'Deuda')
        assert.equal(await page.locator('nav.nav').count(), 0)
        for (const destino of ['#/h/mateo/cuotas', '#/hijos', '#/h/mateo/pagar']) { await ir(page, destino); await pantalla(page, 'canal-web') }
        if (indice === 0) await captura(page, 'N09-01-canal-web')
      }
    })

    // ---------------- N10 ----------------
    await prueba('N10', 'credenciales, validaciones, cuenta bloqueada, sesión expirada y sin vínculos', async () => {
      const { page } = await abrir()
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await verContiene(page, 'Ingresá tu correo electrónico.')
      await page.locator('#correo').fill('laura.ejemplo')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await verContiene(page, 'Ingresá un correo con formato válido, por ejemplo nombre@correo.com.')
      await captura(page, 'N10-01-validacion-login')
      await page.locator('#correo').fill('desconocida@ejemplo.test'); await page.getByRole('button', { name: 'Ingresar' }).click()
      const mensajeA = await page.locator('[role="alert"]').innerText()
      await page.locator('#correo').fill('otra.persona@ejemplo.test'); await page.getByRole('button', { name: 'Ingresar' }).click()
      assert.equal(await page.locator('[role="alert"]').innerText(), mensajeA) // mensaje genérico idéntico
      assert.match(mensajeA, /No pudimos iniciar sesión\./u)
      await captura(page, 'N10-02-credenciales-invalidas')
      await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click(); await pantalla(page, 'recuperar')
      await verContiene(page, 'no envía nada'); await page.getByRole('link', { name: 'Volver al ingreso' }).click(); await pantalla(page, 'ingreso')
      await cuenta(page, 'Cuenta Bloqueada'); await pantalla(page, 'bloqueada')
      await verContiene(page, 'Tu cuenta está bloqueada', 'No podés ver información económica.'); await verNoContiene(page, 'ARS')
      await captura(page, 'N10-03-cuenta-bloqueada')
      await ir(page, '#/h/mateo/cuotas', 'ingreso'); await verNoContiene(page, 'ARS')
      await cuenta(page, 'Ana Ejemplo'); await pantalla(page, 'hijos')
      await verContiene(page, 'Todavía no tenés estudiantes asociados', 'Comunicate con Dirección'); await verNoContiene(page, 'ARS', 'Mateo')
      await captura(page, 'N10-04-sin-vinculos')
      await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await pantalla(page, 'ingreso')
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await ir(page, '#/ingreso', 'ingreso') // llegar al ingreso cierra la sesión vigente
      await verNoContiene(page, 'Sesión simulada'); await ir(page, '#/h/mateo/cuotas', 'ingreso'); await verNoContiene(page, 'ARS')
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await page.getByRole('link', { name: /Mateo Ejemplo/u }).click(); await cuotasListas(page)
      await abrirPanel(page); await page.locator('#sim-expirar').click(); await pantalla(page, 'sesion-expirada')
      await verContiene(page, 'Tu sesión expiró.', 'ingresá nuevamente'); await verNoContiene(page, 'ARS', 'Septiembre 2026')
      await captura(page, 'N10-05-sesion-expirada')
      await ir(page, '#/h/mateo/cuotas', 'ingreso'); await verNoContiene(page, 'ARS')
    })

    // ---------------- N11 ----------------
    await prueba('N11', 'volver, cancelar, cambiar hijo y reiniciar limpian el contexto incompatible', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await habilitarBanco(page)
      await ir(page, '#/h/mateo/pagar', 'pagar')
      await marcar(page, 'mateo-oct-comedor')
      await page.getByRole('button', { name: 'Cancelar' }).click(); await cuotasListas(page)
      await page.getByRole('link', { name: 'Pagar ítems' }).click(); await pantalla(page, 'pagar')
      assert.equal(await total(page), ars(0)) // Cancelar descartó la selección
      await marcar(page, 'mateo-oct-comedor')
      await page.getByRole('link', { name: 'Volver a cuotas' }).click(); await cuotasListas(page)
      await page.getByRole('link', { name: 'Pagar ítems' }).click(); await pantalla(page, 'pagar')
      assert.equal(await total(page), ars(0)) // Volver también
      await marcar(page, 'mateo-oct-comedor')
      await page.locator('#registrar-pago').click(); await pantalla(page, 'pago')
      const pago = (await hashActual(page)).split('/').at(-1)
      await page.goBack(); await pantalla(page, 'pagar') // el historial del navegador respeta las guardas
      assert.equal(await total(page), ars(0))
      assert.equal(await page.locator('[data-item="mateo-oct-comedor"]').isDisabled(), true) // ya está en verificación
      await ir(page, `#/h/mateo/pago/${pago}/enviado`, 'pago') // sin comprobante no hay confirmación que mostrar
      await ir(page, '#/h/mateo/pago/p1', 'comprobantes') // un pago aprobado no se presenta como registrado ni admite carga
      await ir(page, '#/h/mateo/pago/p1/comprobante', 'comprobantes')
      await ir(page, `#/h/mateo/pago/${pago}/comprobante`, 'pago-comprobante')
      await datosTransferencia(page, { operacion: '00055001' })
      await page.getByRole('button', { name: 'Cancelar' }).click(); await pantalla(page, 'comprobantes')
      await verContiene(page, 'Pago registrado sin comprobante', '0 comprobantes registrados')
      await ir(page, `#/h/mateo/pago/${pago}/comprobante`, 'pago-comprobante')
      assert.equal(await page.locator('#operacion').inputValue(), '') // el borrador no sobrevive
      assert.equal(await page.locator('.archivo').count(), 0)
      await captura(page, 'N11-01-borrador-descartado')
      await abrirPanel(page); await page.locator('#sim-reiniciar').click(); await pantalla(page, 'ingreso')
      assert.equal(await page.locator('#sim-banco').isChecked(), false)
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      assert.equal(await page.locator('article.pago').count(), 4) // base restaurada
      await ir(page, '#/h/mateo/cuotas', 'cuotas'); await cuotasListas(page)
      await verContiene(page, ars(8253210))
      await captura(page, 'N11-02-reiniciado')
    })

    // ---------------- N12 ----------------
    await prueba('N12', 'carga, vacío, error y reintento, filtros y validación de rango', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await abrirPanel(page); await page.locator('#sim-carga').check()
      await page.getByRole('link', { name: /Mateo Ejemplo/u }).click(); await pantalla(page, 'cuotas')
      await page.locator('#app').getByText('Cargando cuotas…').waitFor()
      await verNoContiene(page, 'Septiembre 2026', 'ARS')
      await captura(page, 'N12-01-carga')
      await page.locator('#sim-carga').uncheck(); await cuotasListas(page)
      await verContiene(page, 'Septiembre 2026')
      await page.locator('#sim-fallar').click()
      await page.getByRole('link', { name: 'Cambiar hijo' }).click(); await pantalla(page, 'hijos')
      await page.getByRole('link', { name: /Mateo Ejemplo/u }).click()
      await page.locator('#app').getByText('No pudimos cargar las cuotas.').waitFor()
      await verNoContiene(page, 'Septiembre 2026')
      await captura(page, 'N12-02-error-conexion')
      await page.getByRole('button', { name: 'Reintentar' }).click(); await cuotasListas(page)
      await verContiene(page, 'Septiembre 2026', 'Octubre 2026')
      await page.getByRole('link', { name: 'Pagadas' }).click()
      await verContiene(page, 'Agosto 2026', 'Pagada', ars(0))
      await captura(page, 'N12-03-pagadas')
      await page.getByRole('link', { name: 'Cambiar hijo' }).click(); await pantalla(page, 'hijos')
      await page.getByRole('link', { name: /Sofía Ejemplo/u }).click(); await cuotasListas(page)
      await page.getByRole('link', { name: 'Pagadas' }).click()
      await verContiene(page, 'Todavía no hay cuotas pagadas', 'Cuando Dirección apruebe un pago, la cuota aparecerá acá.')
      await captura(page, 'N12-04-vacio')
      await ir(page, '#/h/sofia/periodo', 'periodo')
      await verContiene(page, 'No hay pagos informados en este rango.', 'Ninguna factura sin pagos vence en este período.')
      await page.locator('#periodo-hasta').fill('10/10/2026'); await page.locator('#periodo-aplicar').click()
      await verContiene(page, 'Octubre 2026', ars(7109095)) // el extremo se incluye
      await page.locator('#periodo-desde').fill('15/10/2026'); await page.locator('#periodo-aplicar').click()
      await verContiene(page, 'La fecha final no puede ser anterior a la inicial.')
      await page.locator('#periodo-desde').fill('32/13/2026'); await page.locator('#periodo-aplicar').click()
      await verContiene(page, 'Ingresá una fecha válida con el formato dd/mm/aaaa.')
      await captura(page, 'N12-05-rango-invalido')
    })

    // ---------------- N15 ----------------
    await prueba('N15', 'coherencia de sumas, conceptos, períodos, hijos y saldos entre pantallas', async () => {
      const { page } = await abrir()
      const monto = async selector => parsearImporte((await page.locator(selector).innerText()).replace(/^ARS\s*/u, ''))
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await page.getByRole('link', { name: /Mateo Ejemplo/u }).click(); await cuotasListas(page)
      const saldos = (await page.locator('a.cuota').allInnerTexts()).map(t => parsearImporte(/Saldo\s*ARS\s*([\d.,]+)/u.exec(t.replaceAll(NBSP, ' '))[1]))
      assert.deepEqual(saldos, [4126605, 4126605])
      await page.getByRole('link', { name: 'Deuda' }).click(); await pantalla(page, 'deuda')
      assert.equal(await monto('#total-deuda'), 8253210)
      const porGrupo = await page.locator('section.card[aria-label]').evaluateAll(els => els.map(e => ({ nombre: e.getAttribute('aria-label'), texto: e.innerText })))
      assert.deepEqual(porGrupo.map(g => g.nombre), ['Transporte', 'Comedor', 'Cuota', 'Deporte · Fútbol'])
      const centavosDe = texto => Number(texto.replace(/\./gu, '').replace(',', ''))
      const saldoGrupo = g => centavosDe(/Saldo\s*ARS\s*([\d.,]+)/u.exec(g.texto.replaceAll(NBSP, ' '))[1])
      // Transporte: septiembre en verificación + octubre pendiente (ambos conservan saldo); comedor: ambos pendientes; cuota y deporte pagados.
      assert.deepEqual(porGrupo.map(saldoGrupo), [TARIFAS.transporte * 2, TARIFAS.comedor * 2, 0, 0])
      assert.equal(porGrupo.map(saldoGrupo).reduce((a, b) => a + b, 0), 8253210)
      await captura(page, 'N15-01-deuda-por-item')
      await page.getByRole('link', { name: 'Período' }).click(); await pantalla(page, 'periodo')
      assert.equal(await page.locator('article.pago').count(), 3)
      await verContiene(page, '05/09/2026', '03/10/2026', '07/10/2026', ars(12246110), ars(1892545))
      await page.locator('#periodo-hasta').fill('06/10/2026'); await page.locator('#periodo-aplicar').click()
      assert.equal(await page.locator('article.pago').count(), 2) // 07/10 queda fuera
      await page.locator('#periodo-hasta').fill('07/10/2026'); await page.locator('#periodo-aplicar').click()
      assert.equal(await page.locator('article.pago').count(), 3) // el extremo inclusive vuelve a incluirlo
      await captura(page, 'N15-02-periodo-inclusivo')
      await verContiene(page, 'Mateo Ejemplo'); await verNoContiene(page, 'Sofía Ejemplo')
      // Tras registrar un pago, la deuda no cambia pero crece lo pendiente de verificación.
      await registrarPagoUi(page, ['mateo-oct-comedor'])
      await ir(page, '#/h/mateo/deuda', 'deuda')
      assert.equal(await monto('#total-deuda'), 8253210)
    })

    // ---------------- N16 ----------------
    await prueba('N16', 'otro padre vinculado ve el registro pero no el original; solo quien cargó lo abre', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      await verContiene(page, 'Comprobante cargado por vos.')
      await page.getByRole('link', { name: 'Ver archivo (simulado)' }).first().click(); await pantalla(page, 'archivo')
      await verContiene(page, 'Vista simulada del comprobante', 'No hay un archivo real')
      await captura(page, 'N16-01-original-quien-cargo')
      await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await pantalla(page, 'ingreso')
      await cuenta(page, 'Diego Ejemplo'); await pantalla(page, 'hijos')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      await verContiene(page, 'Archivo no disponible.', 'Archivo restringido a quien lo cargó y a Dirección.', '07/10/2026', ars(1892545))
      assert.equal(await page.getByRole('link', { name: /Ver archivo/u }).count(), 0)
      await captura(page, 'N16-02-otro-padre')
      // Diego registra su propio pago y carga su comprobante; Laura no puede abrir ese original.
      const suyo = await registrarPagoUi(page, ['mateo-oct-transporte'])
      await ir(page, `#/h/mateo/pago/${suyo}/comprobante`, 'pago-comprobante')
      await datosTransferencia(page, { operacion: '00066001' })
      await page.locator('#enviar-comprobante').click(); await pantalla(page, 'pago-enviado')
      await ir(page, `#/h/mateo/archivo/${suyo}`, 'archivo')
      await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await pantalla(page, 'ingreso')
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      await ir(page, '#/h/mateo/comprobantes', 'comprobantes')
      assert.ok((await page.getByRole('link', { name: /Ver archivo/u }).count()) >= 1)
      await ir(page, `#/h/mateo/archivo/${suyo}`, 'sin-permiso')
      await verNoContiene(page, 'transferencia-1.jpg')
      await ir(page, `#/h/mateo/pago/${suyo}/comprobante`, 'sin-permiso')
      await captura(page, 'N16-03-original-ajeno-denegado')
    })

    // ---------------- N14 ----------------
    await prueba('N14', 'accesibilidad: foco, teclado, contraste, objetivos táctiles, anchos 320/360/390 y texto ampliado', async () => {
      const { page } = await abrir()
      // Teclado: el formulario de ingreso se opera sin ratón.
      await page.locator('#correo').focus()
      await page.keyboard.type('laura.ejemplo@ejemplo.test')
      await page.keyboard.press('Enter')
      await pantalla(page, 'hijos')
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1') // el foco llega al título de la pantalla
      assert.equal(await page.locator('h1').count(), 1)
      // Todo elemento interactivo recibe foco visible y tiene nombre accesible.
      const foco = await page.evaluate(() => {
        const problemas = []
        for (const el of document.querySelectorAll('a[href], button, input:not([disabled]), select, summary')) {
          const nombre = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() || (el.labels?.[0]?.textContent ?? '').trim()
          if (!nombre) problemas.push(`sin nombre: <${el.tagName.toLowerCase()}> ${el.className}`)
          el.focus()
          const s = getComputedStyle(el)
          if (document.activeElement === el && el.matches(':focus-visible') && (s.outlineStyle === 'none' || parseFloat(s.outlineWidth) < 2)) problemas.push(`sin foco visible: ${nombre}`)
        }
        return problemas
      })
      assert.deepEqual(foco, [])
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'es')

      const medir = () => {
        const rgba = s => { const m = /rgba?\(([^)]+)\)/u.exec(s); const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 } }
        const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
        const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
        const fondo = el => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); const c = rgba(s.backgroundColor); if (c.a > 0) return c } return { r: 255, g: 255, b: 255, a: 1 } }
        const problemas = [], ancho = document.documentElement.clientWidth
        if (document.documentElement.scrollWidth > ancho) problemas.push(`scroll horizontal: ${document.documentElement.scrollWidth} > ${ancho}`)
        let minimo = Infinity
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && el.closest('.solo-lectores') === null && (r.right > ancho + 0.5 || r.left < -0.5)) problemas.push(`fuera de pantalla: <${el.tagName.toLowerCase()}> ${el.className}`)
          if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && el.closest('.solo-lectores') === null) {
            const s = getComputedStyle(el), fg = rgba(s.color), bg = fondo(el)
            const [a, b] = [lum(fg), lum(bg)], ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
            const px = parseFloat(s.fontSize), grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700)
            const deshabilitado = el.closest('[disabled]') !== null
            if (!deshabilitado && ratio < (grande ? 3 : 4.5)) problemas.push(`contraste ${ratio.toFixed(2)}:1 en «${el.textContent.trim().slice(0, 30)}»`)
            if (!deshabilitado) minimo = Math.min(minimo, ratio)
          }
        }
        const unidad = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16
        for (const el of document.querySelectorAll('a[href], button, select, summary, label.item.seleccion, .sim-fila label, input:not([type=checkbox]):not([disabled])')) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height < 47.5) problemas.push(`objetivo táctil ${Math.round(r.height)} px (${unidad}x): ${el.textContent.trim().slice(0, 24) || el.id}`)
        }
        return { problemas, minimo: Number.isFinite(minimo) ? Math.round(minimo * 100) / 100 : null }
      }
      const recorrido = [
        ['hijos', '#/hijos'], ['cuotas', '#/h/mateo/cuotas'], ['factura', '#/h/mateo/factura/mateo-sep'], ['pagar', '#/h/mateo/pagar'], ['comprobantes', '#/h/mateo/comprobantes'],
        ['periodo', '#/h/mateo/periodo'], ['deuda', '#/h/mateo/deuda'], ['inscripciones', '#/h/mateo/inscripciones'],
      ]
      const pagoMedido = await registrarPagoUi(page, ['mateo-oct-comedor']) // habilita el escenario simulado y deja un pago para el formulario
      const pendientes = ['mateo-sep-comedor', 'mateo-oct-transporte']
      let minimoGlobal = Infinity
      for (const ancho of [320, 360, 390]) {
        await page.setViewportSize({ width: ancho, height: 844 })
        for (const [nombre, destino] of recorrido) {
          await ir(page, destino, nombre)
          if (nombre === 'cuotas') await cuotasListas(page)
          if (nombre === 'pagar') await marcar(page, ...pendientes)
          const r = await page.evaluate(medir)
          assert.deepEqual(r.problemas, [], `${nombre} @${ancho}`)
          if (r.minimo !== null) minimoGlobal = Math.min(minimoGlobal, r.minimo)
        }
        // Formulario de comprobante con errores y pantalla de acceso denegado.
        await ir(page, `#/h/mateo/pago/${pagoMedido}/comprobante`, 'pago-comprobante')
        await page.locator('#enviar-comprobante').click()
        await page.getByRole('button', { name: /Agregar ejemplo: foto-recibo\.heic/u }).click()
        const rc = await page.evaluate(medir)
        assert.deepEqual(rc.problemas, [], `comprobante @${ancho}`)
        minimoGlobal = Math.min(minimoGlobal, rc.minimo ?? Infinity)
        await ir(page, '#/sin-permiso', 'sin-permiso')
        assert.deepEqual((await page.evaluate(medir)).problemas, [], `sin-permiso @${ancho}`)
      }
      // Texto ampliado al 200 %.
      for (const ancho of [320, 360, 390]) {
        await page.setViewportSize({ width: ancho, height: 844 })
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
        for (const [nombre, destino] of recorrido.filter(([n]) => ['cuotas', 'factura', 'pagar', 'comprobantes', 'deuda'].includes(n))) {
          await ir(page, destino, nombre)
          if (nombre === 'pagar') await marcar(page, ...pendientes)
          const r = await page.evaluate(medir)
          assert.deepEqual(r.problemas, [], `${nombre} @${ancho} 200%`)
        }
        if (ancho === 390) await captura(page, 'N14-01-texto-200')
        await page.evaluate(() => { document.documentElement.style.fontSize = '' })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      assert.ok(minimoGlobal >= 4.5, `contraste mínimo ${minimoGlobal}`)
      console.log(`       contraste mínimo medido ${minimoGlobal.toFixed(2)}:1`)
    })

    // ---------------- N13 ----------------
    await prueba('N13', 'recursos, enlaces, consola y solicitudes externas', async () => {
      const { page } = await abrir()
      await cuenta(page, 'Laura Ejemplo'); await pantalla(page, 'hijos')
      const hrefs = new Set()
      const recolectar = async () => { for (const h of await page.locator('#app a[href]').evaluateAll(as => as.map(a => a.getAttribute('href')))) hrefs.add(h) }
      await recolectar()
      for (const destino of ['#/h/mateo/cuotas', '#/h/mateo/cuotas/pagadas', '#/h/mateo/factura/mateo-oct', '#/h/mateo/pagar', '#/h/mateo/comprobantes', '#/h/mateo/periodo', '#/h/mateo/deuda', '#/h/mateo/inscripciones']) {
        await ir(page, destino); await page.waitForTimeout(120); await recolectar()
      }
      for (const h of hrefs) {
        assert.match(h, /^#\//u, `enlace no interno: ${h}`)
        await ir(page, h); await page.waitForTimeout(80)
        const nombre = await page.locator('#app').getAttribute('data-pantalla')
        assert.ok(nombre && !['sin-permiso', 'ingreso'].includes(nombre), `enlace roto o denegado: ${h} → ${nombre}`)
      }
      assert.ok(hrefs.size >= 12, `enlaces recorridos: ${hrefs.size}`)
      // Solo se piden recursos de la lista cerrada.
      const permitidas = new Set([...RUTAS.keys()])
      for (const ruta of recoleccion.recursos) assert.ok(permitidas.has(ruta), `recurso fuera de la lista: ${ruta}`)
      for (const css of ['/estilos.css', '/js/app.mjs', '/activos/logo-emblema.png', '/activos/outfit-latin-600-normal.woff2', '/activos/geist-mono-latin.woff2']) {
        assert.ok(recoleccion.recursos.has(css), `no se cargó ${css}`)
      }
      assert.deepEqual(await page.evaluate(() => window.__violaciones), [])
      assert.equal(await page.evaluate(() => document.fonts.check('600 16px Outfit')), true)
    })

    // Verificación transversal acumulada de todas las pruebas de navegador.
    await prueba('N13b', 'sin errores de consola, de página ni de CSP; cero solicitudes externas; todas las respuestas 200', async () => {
      for (const context of contextos) for (const page of context.pages()) {
        const violaciones = await page.evaluate(() => window.__violaciones ?? [])
        assert.deepEqual(violaciones, [], 'violaciones de CSP')
      }
      assert.deepEqual(recoleccion.consola, [], 'consola')
      assert.deepEqual(recoleccion.paginaErrores, [], 'errores de página')
      assert.deepEqual(recoleccion.externas, [], 'solicitudes externas')
      assert.deepEqual(recoleccion.fallidas, [], 'solicitudes fallidas')
      assert.deepEqual(recoleccion.noOk, [], 'respuestas distintas de 200')
    })
  } finally {
    for (const context of contextos) await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

// =====================================================================================
let servidor = null
const vigilante = setTimeout(async () => {
  console.error(`Límite total de ${LIMITE_TOTAL_MS / 1000} s excedido; cerrando.`)
  await servidor?.cerrar().catch(() => {})
  process.exit(1)
}, LIMITE_TOTAL_MS)
vigilante.unref()

try {
  await fasePura()
  servidor = await iniciarServidor({ puerto: 0 })
  await faseServidor(servidor.puerto)
  if (!argumentos.includes('--sin-navegador')) await faseNavegador(servidor.url, `http://127.0.0.1:${servidor.puerto}/`)
} catch (error) {
  resultados.push({ id: 'RUNNER', titulo: 'ejecución', ok: false, ms: 0, error: String(error?.stack ?? error).split('\n').slice(0, 8).join(' | ') })
  console.error(error)
} finally {
  await servidor?.cerrar().catch(() => {})
}

// Autoverificación: toda prueba obligatoria debe haberse ejecutado (salvo en una corrida parcial declarada).
if (!solo && !argumentos.includes('--sin-navegador')) {
  const ejecutadas = new Set(resultados.map(r => r.id))
  const faltan = REQUERIDAS.filter(id => !ejecutadas.has(id))
  if (faltan.length) resultados.push({ id: 'RUNNER', titulo: 'pruebas obligatorias', ok: false, ms: 0, error: `no se ejecutaron: ${faltan.join(', ')}` })
}
if (solo) console.log(`ADVERTENCIA: ejecución parcial (--solo ${solo.join(',')}); no equivale a la verificación completa`)
const fallos = resultados.filter(r => !r.ok)
const duracion = Date.now() - inicioGlobal
console.log(`\nResumen EPT-96: ${resultados.length - fallos.length} PASS, ${fallos.length} FAIL, ${(duracion / 1000).toFixed(1)} s`)
console.log(`Capturas: ${dirCapturas}`)
if (fallos.length) { for (const f of fallos) console.log(` - ${f.id}: ${f.error}`); process.exitCode = 1 }
