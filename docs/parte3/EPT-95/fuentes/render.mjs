// EPT-95 · Generador reproducible de HTML estático, PNG y manifest (sin red).
// Uso (desde la raíz del repositorio):
//   node docs/parte3/EPT-95/fuentes/render.mjs html        # escribe fuentes/html/*.html
//   node docs/parte3/EPT-95/fuentes/render.mjs png         # renderiza disenos/**/*.png con Playwright
//   node docs/parte3/EPT-95/fuentes/render.mjs verificar   # layout, contraste y objetivos táctiles medidos
//   node docs/parte3/EPT-95/fuentes/render.mjs manifest    # recalcula hashes y escribe manifest.json
// Playwright se resuelve con `import('playwright')` o con EPT95_PLAYWRIGHT (ruta absoluta a index.mjs).
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pantallas, htmlDe, datos, cifras, arsTexto, REFERENCIA } from './pantallas.mjs'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const paquete = path.resolve(aqui, '..')
export const VIEWPORT = { width: 390, height: 844 }, ESCALA = 2
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const shaFuente = (relativa, bytes) => sha(relativa.endsWith('.html') ? Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n')) : bytes)

function escribirHtml() {
  mkdirSync(path.join(aqui, 'html'), { recursive: true })
  for (const p of pantallas) writeFileSync(path.join(aqui, 'html', `${p.archivo}.html`), htmlDe(p), 'utf8')
  console.log(`HTML: ${pantallas.length} archivos`)
}
async function playwright() {
  try { return await import('playwright') } catch (error) {
    if (!process.env.EPT95_PLAYWRIGHT) throw error
    return import(pathToFileURL(process.env.EPT95_PLAYWRIGHT).href)
  }
}
async function conNavegador(fn) {
  const { chromium } = await playwright()
  const browser = await chromium.launch()
  try { return await fn(browser, { chromium: browser.version() }) } finally { await browser.close() }
}
// Bloquea cualquier solicitud que no sea file: para demostrar que el render no usa red.
async function abrir(browser, p, ancho = VIEWPORT.width, escala = ESCALA) {
  const context = await browser.newContext({ viewport: { width: ancho, height: VIEWPORT.height }, deviceScaleFactor: escala, colorScheme: 'light', reducedMotion: 'reduce', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', javaScriptEnabled: true })
  const bloqueadas = []
  await context.route('**/*', route => { if (route.request().url().startsWith('file:')) return route.continue(); bloqueadas.push(route.request().url()); return route.abort() })
  const page = await context.newPage()
  await page.goto(pathToFileURL(path.join(aqui, 'html', `${p.archivo}.html`)).href)
  const fuentes = await page.evaluate(async () => { await Promise.all([document.fonts.load('400 16px Outfit'), document.fonts.load('600 16px Outfit'), document.fonts.load('500 16px "Geist Mono"')]); await document.fonts.ready; return { outfit: document.fonts.check('600 16px Outfit'), mono: document.fonts.check('500 16px "Geist Mono"') } })
  if (!fuentes.outfit || !fuentes.mono) throw new Error(`${p.id}: fuentes locales no cargadas`)
  if (bloqueadas.length) throw new Error(`${p.id}: solicitudes de red bloqueadas: ${bloqueadas.join(', ')}`)
  return { page, context }
}
async function renderizar() {
  escribirHtml()
  const recibo = []
  await conNavegador(async (browser, info) => {
    for (const p of pantallas) {
      const { page, context } = await abrir(browser, p)
      const destino = path.join(paquete, 'disenos', p.dir, `${p.archivo}.png`)
      mkdirSync(path.dirname(destino), { recursive: true })
      await page.screenshot({ path: destino, fullPage: true, type: 'png', animations: 'disabled' })
      recibo.push({ id: p.id, archivo: `${p.dir}/${p.archivo}.png` })
      await context.close()
    }
    console.log(`PNG: ${recibo.length} archivos; Chromium ${info.chromium}; viewport ${VIEWPORT.width}x${VIEWPORT.height} @${ESCALA}x`)
  })
}
// Mediciones en el navegador: desbordes, objetivos táctiles y contraste sobre fondo efectivo.
function medir() {
  const rgba = s => { const m = /rgba?\(([^)]+)\)/u.exec(s); const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 } }
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const fondo = el => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage !== 'none') return null; const c = rgba(s.backgroundColor); if (c.a > 0) return c } return { r: 255, g: 255, b: 255, a: 1 } }
  const problemas = [], ancho = document.documentElement.clientWidth
  if (document.documentElement.scrollWidth > ancho) problemas.push(`scroll horizontal: ${document.documentElement.scrollWidth} > ${ancho}`)
  let minimo = Infinity, textos = 0
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > ancho + 0.5 || r.left < -0.5)) problemas.push(`fuera de pantalla: <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(r.left)}..${Math.round(r.right)}`)
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') problemas.push(`texto recortado: ${el.className}`)
    const propio = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (propio) {
      textos++
      const s = getComputedStyle(el), bg = fondo(el), fg = rgba(s.color)
      if (!bg) { problemas.push(`fondo con imagen: ${el.className}`); continue }
      const [a, b] = [lum(fg), lum(bg)], ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const px = parseFloat(s.fontSize), grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700)
      if (ratio < (grande ? 3 : 4.5)) problemas.push(`contraste ${ratio.toFixed(2)}:1 en "${el.textContent.trim().slice(0, 30)}"`)
      minimo = Math.min(minimo, ratio)
    }
  }
  for (const el of document.querySelectorAll('.btn, .tab, .link, .input, .nav > div')) {
    const r = el.getBoundingClientRect()
    if (r.height < 47.5) problemas.push(`objetivo táctil ${Math.round(r.height)} px: ${el.className}`)
  }
  return { problemas, minimo: Number.isFinite(minimo) ? Math.round(minimo * 100) / 100 : null, textos }
}
async function verificar() {
  escribirHtml()
  let fallos = 0, minimo = Infinity
  await conNavegador(async browser => {
    for (const p of pantallas) {
      const anchos = p.escala ? [390] : [320, 360, 390]
      for (const ancho of anchos) {
        const { page, context } = await abrir(browser, p, ancho, 1)
        const r = await page.evaluate(medir)
        if (r.problemas.length) { fallos += r.problemas.length; console.log(`✗ ${p.id} @${ancho}: ${r.problemas.slice(0, 6).join(' | ')}`) }
        if (r.minimo !== null) minimo = Math.min(minimo, r.minimo)
        await context.close()
      }
    }
  })
  console.log(`Verificación: ${pantallas.length} pantallas; contraste mínimo medido ${minimo.toFixed(2)}:1; problemas ${fallos}`)
  if (fallos) process.exitCode = 1
}
function dimensionesPng(bytes) { return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] }
function archivosFuente(directorio, prefijo) {
  const salida = []
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const ruta = path.join(directorio, entrada.name), relativa = `${prefijo}/${entrada.name}`
    if (entrada.isDirectory()) salida.push(...archivosFuente(ruta, relativa))
    else salida.push(relativa)
  }
  return salida
}
function manifest() {
  const fuentesHash = {}
  for (const relativa of [...archivosFuente(aqui, 'fuentes'), 'receta-render.json'].sort()) fuentesHash[relativa] = shaFuente(relativa, readFileSync(path.join(paquete, relativa)))
  const salida = pantallas.map(p => {
    const png = readFileSync(path.join(paquete, 'disenos', p.dir, `${p.archivo}.png`))
    const html = readFileSync(path.join(aqui, 'html', `${p.archivo}.html`))
    return { pantalla: p.id, tipo: p.tipo, area: p.area, titulo: p.titulo, roles: p.roles, estados: p.estados, requisitos: p.requisitos,
      archivo: `disenos/${p.dir}/${p.archivo}.png`, pixeles: dimensionesPng(png), sha256: sha(png),
      origen: { tipo: 'diseno-local', fuente: `fuentes/html/${p.archivo}.html`, fuente_sha256: shaFuente('x.html', html), escala_texto: p.escala ?? 1 } }
  })
  const registro = JSON.parse(readFileSync(path.join(paquete, 'receta-render.json'), 'utf8'))
  const objeto = { version: 5, tarea: 'EPT-95', estado: 'Diseños estáticos locales (wireframes, mockups y variantes) regenerables desde fuentes; no es una app implementada ni aprobación humana',
    baseline: registro.baseline, metodo: 'diseno-local', receta: registro, fuentes: fuentesHash,
    datos: { referencia: REFERENCIA, hijos: [datos.mateo.nombre, datos.sofia.nombre], deuda_mateo: arsTexto(cifras.deudaMateo), deuda_sofia: arsTexto(cifras.deudaSofia), seleccion: arsTexto(cifras.seleccion) },
    pantallas: salida }
  writeFileSync(path.join(paquete, 'manifest.json'), `${JSON.stringify(objeto, null, 1)}
`, 'utf8')
  console.log(`Manifest: ${salida.length} pantallas; ${Object.keys(fuentesHash).length} fuentes con hash`)
}
const comando = process.argv[2]
if (comando === 'html') escribirHtml()
else if (comando === 'png') await renderizar()
else if (comando === 'verificar') await verificar()
else if (comando === 'manifest') manifest()
else { console.error('Uso: render.mjs html|png|verificar|manifest'); process.exitCode = 2 }
