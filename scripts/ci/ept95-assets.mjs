import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

const base = 'docs/parte3/EPT-95/'
const areas = ['login', 'selector-hijo', 'cuotas', 'factura', 'transferencia', 'comprobantes', 'periodo', 'deuda-item', 'inscripciones']
const baseSlugs = ['login', 'selector-hijo', 'cuotas', 'factura', 'seleccion-y-pago', 'comprobantes', 'periodo', 'deuda-item', 'inscripciones']
const variantSlugs = ['login-validacion', 'login-credenciales-invalidas', 'login-cuenta-bloqueada', 'login-sesion-expirada', 'login-canal-web',
  'selector-sin-vinculos', 'cuotas-estudiante', 'cuotas-pagadas', 'cuotas-pendiente', 'cuotas-carga', 'cuotas-vacio', 'cuotas-error-conexion',
  'estados-de-cuota', 'factura-estudiante', 'seleccion-validacion', 'pago-registrado', 'comprobante-validacion', 'comprobante-confirmacion',
  'comprobante-error-incierto', 'comprobantes-otro-padre', 'comprobantes-estudiante', 'periodo-estudiante', 'deuda-estudiante',
  'inscripciones-estudiante', 'comprobante-teclado', 'cuotas-texto-200']
const pad = n => String(n).padStart(2, '0')
// Registro fijo: nunca aceptar nombres obtenidos del manifest del candidato.
export const designs = [
  ...baseSlugs.map((slug, i) => ({ id: 'W' + pad(i + 1), tipo: 'wireframe', area: areas[i], slug, dir: 'wireframes' })),
  ...baseSlugs.map((slug, i) => ({ id: 'M' + pad(i + 1), tipo: 'mockup', area: areas[i], slug, dir: 'mockups' })),
  ...variantSlugs.map((slug, i) => ({ id: 'V' + pad(i + 1), tipo: 'variante', area: 'variantes', slug, dir: 'variantes' })),
].map(d => ({ ...d, archivo: `disenos/${d.dir}/${d.id}-${d.slug}.png`, fuente: `fuentes/html/${d.id}-${d.slug}.html` }))
const historicNames = [...['wireframes', 'mockups'].flatMap(dir => ['01-login', '02-selector-hijo', '03-cuotas', '04-factura', '05-transferencia', '06-comprobantes', '07-periodo', '08-deuda-item', '09-inscripciones'].map(n => `${dir}/${n}.png`)),
  ...Array.from({ length: 15 }, (_, i) => `mockups/v${i + 1}-variante.png`)].map(f => 'historico-stitch/' + f)
const sources = {
  html: designs.map(d => d.fuente),
  styles: ['fuentes/estilos.css'],
  modules: ['fuentes/pantallas.mjs', 'fuentes/render.mjs'],
  fonts: ['fuentes/fuentes-tipograficas/outfit-latin-400-normal.woff2', 'fuentes/fuentes-tipograficas/outfit-latin-500-normal.woff2',
    'fuentes/fuentes-tipograficas/outfit-latin-600-normal.woff2', 'fuentes/fuentes-tipograficas/outfit-latin-700-normal.woff2',
    'fuentes/fuentes-tipograficas/geist-mono-latin.woff2'],
  logo: ['fuentes/imagenes/logo-emblema.png'],
  data: ['receta-render.json'],
  text: ['fuentes/LICENCIAS.md', 'fuentes/fuentes-tipograficas/LICENCIA-Outfit-OFL-1.1.txt'],
}
const documents = ['README.md', 'estados-y-roles.md', 'matriz-cobertura.md', 'historico-stitch/recuperacion-acotada.md', ...sources.text]
export const ept95Paths = new Set([...designs.map(d => d.archivo), ...historicNames,
  ...sources.html, ...sources.styles, ...sources.modules, ...sources.fonts, ...sources.logo, ...sources.data, ...documents,
  'manifest.json', 'historico-stitch/manifest.json', 'bitacora-academica.csv'].map(f => base + f))
const sourcePaths = [...sources.html, ...sources.styles, ...sources.modules, ...sources.fonts, ...sources.logo, ...sources.data, ...sources.text]
const project = 'projects/6277945596504536494'
const roles = new Set(['PADRE', 'ESTUDIANTE', 'PADRE_CARGADOR', 'PADRE_VINCULADO_NO_CARGADOR', 'DIRECTOR', 'DOCENTE', 'PERSONAL'])
const states = new Set(['Normal', 'Pendiente', 'Pago parcial', 'Pagada', 'Vencida', 'Selección', 'En verificación', 'Pendiente de verificación', 'Datos bancarios no configurados',
  'Carga', 'Consulta', 'Consulta propia', 'Original no autorizado', 'Canal web', 'Sin vínculo', 'Cuenta bloqueada', 'Sesión expirada', 'Vacío', 'Error', 'Error incierto',
  'Validación', 'Confirmación', 'Teclado', 'Texto 200%'])
const requiredStates = ['Pendiente', 'Pago parcial', 'Pagada', 'Vencida', 'Carga', 'Vacío', 'Error', 'Error incierto', 'Validación', 'Confirmación', 'Consulta propia',
  'Original no autorizado', 'Canal web', 'Sin vínculo', 'Cuenta bloqueada', 'Sesión expirada', 'Teclado', 'Texto 200%', 'En verificación', 'Datos bancarios no configurados']
const requiredRoles = ['PADRE', 'ESTUDIANTE', 'PADRE_VINCULADO_NO_CARGADOR', 'DIRECTOR', 'DOCENTE', 'PERSONAL']
const requirements = new Set(['EPT-95/login', 'EPT-95/selector-hijo', 'EPT-95/cuotas', 'EPT-95/factura-items', 'EPT-95/seleccion-transferencia', 'EPT-95/comprobantes', 'EPT-95/periodo', 'EPT-95/deuda-item', 'EPT-95/inscripciones', 'EPT-95/roles-y-estados', 'EPT-98/contrato-movil', 'EPT-98/privacidad'])
const headers = ['fecha_art', 'actividad', 'herramienta', 'insumo', 'comprension_y_adaptacion', 'prueba_o_limite', 'resultado', 'origen']
const secret = /-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b|(?:password|passwd|service_role_key|api_key|access_token)\s*[:=]\s*["']?[A-Za-z0-9_/+=-]{8,}/iu
const executable = /<\s*script\b|javascript\s*:|^#!|\b(?:eval|Function)\s*\(/imu
function requireValue(condition, message, code = 'E_EPT95_CONTRACT') { if (!condition) { const error = new Error(`EPT-95: ${message}`); error.code = code; throw error } }
export function secureRelative(file) {
  requireValue(typeof file === 'string' && file.length > 0 && file.length <= 240
    && !/[\\:\0]/u.test(file) && !file.startsWith('/')
    && file.split('/').every(p => p && p !== '.' && p !== '..'), 'ruta relativa POSIX inválida')
  return file
}
function shape(object, keys) {
  requireValue(object !== null && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).length === keys.length && keys.every(k => Object.hasOwn(object, k)), 'esquema cerrado inválido')
}
function text(value, max = 4096) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\0-\x08\x0b\x0c\x0e-\x1f]/u.test(value) && !secret.test(value) && !executable.test(value), 'texto no pasivo o secreto')
}
function list(values, allowed) {
  requireValue(Array.isArray(values) && values.length > 0 && values.length <= 10
    && new Set(values).size === values.length && values.every(v => allowed.has(v)), 'enum de contrato inválido')
}
function date(value, timestamp = false) {
  const re = timestamp ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|\+00:00)$/u : /^\d{4}-\d{2}-\d{2}$/u
  requireValue(typeof value === 'string' && re.test(value), 'fecha ISO inválida')
  const d = new Date(value); requireValue(Number.isFinite(d.getTime()) && d.toISOString().startsWith(value.slice(0, 19))
    && d.getUTCFullYear() >= 2020 && d.getUTCFullYear() <= 2100, 'fecha fuera del contrato')
}
function safeFile(root, relative, max) {
  secureRelative(relative)
  let current = root
  requireValue(!lstatSync(current).isSymbolicLink(), 'raíz enlazada')
  for (const part of relative.split('/')) { current = path.join(current, part); requireValue(!lstatSync(current).isSymbolicLink(), 'archivo o ancestro enlazado') }
  const stat = lstatSync(current)
  requireValue(stat.isFile() && stat.size > 0 && stat.size <= max, 'tipo o tamaño de archivo inválido', 'E_FILE_SIZE')
  requireValue(process.platform === 'win32' || !(stat.mode & 0o111), 'archivo ejecutable')
  return readFileSync(current)
}
function utf8(bytes) {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); text(value, 128 * 1024); return value
}
function crc32(bytes) {
  let crc = 0xffffffff
  for (const v of bytes) { crc ^= v; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function boundedInflate(source, max, code) {
  try { return inflateSync(source, { maxOutputLength: max, info: true }) }
  catch { requireValue(false, 'zlib inválido o límite excedido', code) }
}
function stitchProfile(data, removal = false) {
  const keyword = Buffer.from('Raw profile type APP1\0', 'latin1')
  requireValue(data.length > keyword.length + 1 && data.subarray(0, keyword.length).equals(keyword) && data[keyword.length] === 0, 'keyword o compresión zTXt no admitida', 'E_ZTXT_HEADER')
  const source = data.subarray(keyword.length + 1), result = boundedInflate(source, 64 * 1024, 'E_ZTXT_INFLATE')
  requireValue(result.engine.bytesWritten === source.length, 'datos adicionales zTXt', 'E_ZTXT_TRAILING')
  requireValue([...result.buffer].every(n => n === 10 || n === 13 || (n >= 32 && n <= 126)), 'perfil textual no ASCII', 'E_ZTXT_PROFILE')
  const value = result.buffer.toString('ascii')
  requireValue(!secret.test(value) && !executable.test(value), 'perfil sensible o ejecutable', 'E_ZTXT_SENSITIVE')
  const match = /^\n(?:generic profile|exif|APP1)\n[ ]*(\d{1,5})\n([a-fA-F0-9\r\n]+)\n?$/u.exec(value)
  requireValue(match !== null, 'cabecera de perfil desconocida', 'E_ZTXT_PROFILE')
  const hex = match[2].replace(/[\r\n]/gu, '')
  requireValue(hex.length % 2 === 0 && hex.length / 2 === Number(match[1]) && Number(match[1]) <= 32768, 'longitud hexadecimal inconsistente', 'E_ZTXT_LENGTH')
  if (removal) return
  // No aceptar TIFF/thumbnail opacos: esta transacción no certifica su semántica.
  requireValue(false, 'contenido TIFF/thumbnail no verificado; perfil bloqueado sin inferir peligro', 'E_TIFF_UNVERIFIED')
}
function rgbaDigest(scanlines, width, height, channels) {
  const stride = width * channels + 1, hash = createHash('sha256'), rgba = Buffer.alloc(width * 4)
  for (let row = 0; row < height; row++) {
    const start = row * stride + 1, filter = scanlines[start - 1]
    for (let x = 0; x < width * channels; x++) {
      const a = x >= channels ? scanlines[start + x - channels] : 0
      const b = row ? scanlines[start + x - stride] : 0, c = row && x >= channels ? scanlines[start + x - stride - channels] : 0
      let add = 0
      if (filter === 1) add = a
      if (filter === 2) add = b
      if (filter === 3) add = Math.floor((a + b) / 2)
      if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      scanlines[start + x] = (scanlines[start + x] + add) & 255
    }
    for (let x = 0; x < width; x++) {
      const from = start + x * channels, to = x * 4
      rgba[to] = scanlines[from]; rgba[to + 1] = scanlines[from + 1]; rgba[to + 2] = scanlines[from + 2]; rgba[to + 3] = channels === 4 ? scanlines[from + 3] : 255
    }
    hash.update(rgba)
  }
  return hash.digest('hex')
}
function png(bytes, { original = false, wide = original, digest = true, minimum = 320 } = {}) {
  requireValue(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'firma PNG inválida', 'E_PNG_SIGNATURE')
  let offset = 8, width, height, channels, ended = false, idatState = 0
  const compressed = [], ancillary = new Set()
  while (offset < bytes.length) {
    requireValue(bytes.length - offset >= 12 && !ended, 'PNG truncado o con datos finales', 'E_PNG_BOUNDS')
    const size = bytes.readUInt32BE(offset), typeBytes = bytes.subarray(offset + 4, offset + 8)
    requireValue([...typeBytes].every(v => (v >= 65 && v <= 90) || (v >= 97 && v <= 122)) && typeBytes[2] >= 65 && typeBytes[2] <= 90, 'tipo PNG ASCII o bit reservado inválido', 'E_PNG_TYPE')
    const type = typeBytes.toString('ascii')
    requireValue(size <= bytes.length - offset - 12, 'chunk PNG inválido', 'E_PNG_BOUNDS')
    const data = bytes.subarray(offset + 8, offset + 8 + size)
    requireValue(crc32(bytes.subarray(offset + 4, offset + 8 + size)) === bytes.readUInt32BE(offset + 8 + size), 'CRC PNG inválido', 'E_PNG_CRC')
    if (type === 'IHDR') {
      requireValue(offset === 8 && !width && size === 13, 'IHDR duplicado o fuera de orden')
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0
      requireValue(width >= minimum && width <= (wide ? 4096 : 1440) && height >= (wide ? 320 : width) && height <= 12000 && width * height <= 12000000
        && data[8] === 8 && channels && data[10] === 0 && data[11] === 0 && data[12] === 0, 'dimensiones o formato PNG fuera de contrato', 'E_PNG_FORMAT')
    } else if (type === 'IDAT') {
      requireValue(width && idatState !== 2 && size > 0, 'IDAT no consecutivo o vacío'); idatState = 1; compressed.push(data)
    } else if (type === 'IEND') {
      requireValue(width && idatState && size === 0 && offset + 12 === bytes.length, 'IEND inválido', 'E_PNG_END'); ended = true
    } else {
      if (idatState === 1) idatState = 2
      requireValue(width && idatState === 0 && !ancillary.has(type) && ['sRGB', 'gAMA', 'cHRM', 'pHYs', 'sBIT', 'zTXt'].includes(type), 'metadatos PNG no permitidos (incluye texto/APNG)', 'E_PNG_METADATA')
      ancillary.add(type)
      if (type === 'zTXt') { stitchProfile(data, original) } else requireValue((type === 'sBIT' && size === channels && [...data].every(n => n >= 1 && n <= 8)) || (type === 'sRGB' && size === 1 && data[0] <= 3) || (type === 'gAMA' && size === 4 && data.readUInt32BE(0) > 0 && data.readUInt32BE(0) <= 1000000)
        || (type === 'cHRM' && size === 32 && Array.from({ length: 4 }, (_, i) => data.readUInt32BE(i * 8) + data.readUInt32BE(i * 8 + 4)).every(n => n <= 100000)) || (type === 'pHYs' && size === 9 && data[8] <= 1 && data.readUInt32BE(0) <= 1000000 && data.readUInt32BE(4) <= 1000000), 'chunk auxiliar inválido', 'E_PNG_AUX')
    }
    offset += size + 12
  }
  requireValue(ended && compressed.length > 0, 'PNG incompleto')
  const stride = width * channels + 1, expected = stride * height
  const source = Buffer.concat(compressed), inflated = boundedInflate(source, expected, 'E_PNG_INFLATE')
  requireValue(inflated.engine.bytesWritten === source.length, 'datos extra tras zlib', 'E_PNG_ZLIB_TRAILING')
  const pixels = inflated.buffer
  requireValue(pixels.length === expected, 'scanlines PNG inválidas', 'E_PNG_SCANLINES')
  for (let row = 0; row < height; row++) requireValue(pixels[row * stride] <= 4, 'filtro PNG inválido', 'E_PNG_FILTER')
  return { dimensions: [width, height], pixelsHash: digest ? rgbaDigest(pixels, width, height, channels) : null }
}
function csvRows(value) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false
  const pushCell = () => { requireValue(cell.length <= 4096, 'celda CSV demasiado larga'); row.push(cell); cell = ''; closed = false }
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (quoted) { if (c === '"') { if (value[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } } else cell += c; continue }
    if (c === '"') { requireValue(cell === '' && !closed, 'comillas CSV inválidas'); quoted = true }
    else if (c === ',') pushCell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && value[i + 1] === '\n') i++; pushCell(); rows.push(row); row = [] }
    else { requireValue(!closed, 'contenido tras comillas CSV'); cell += c }
  }
  requireValue(!quoted, 'CSV sin cierre'); if (cell || row.length || closed) { pushCell(); rows.push(row) }
  requireValue(rows.length >= 2 && rows.length <= 200 && JSON.stringify(rows[0]) === JSON.stringify(headers), 'cabecera o filas CSV inválidas')
  for (const row of rows.slice(1)) {
    requireValue(row.length === 8, 'CSV requiere ocho columnas'); date(row[0])
    for (const cell of row) { text(cell); requireValue(!/^[\s]*[=+@-]/u.test(cell), 'fórmula CSV no permitida') }
  }
}
function gitModes(root) {
  let top
  try { top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return }
  requireValue(path.resolve(top) === root, 'raíz no coincide con checkout Git')
  const records = execFileSync('git', ['-C', root, 'ls-files', '--stage', '-z', '--', base], { encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const record of records) { const [meta, file] = record.split('\t'); requireValue(/^100644 [a-f0-9]{40,64} 0$/u.test(meta) && ept95Paths.has(file), 'modo Git o ruta del candidato no permitida') }
}
// Transformación autorizada sobre copias; no interpreta el TIFF ni modifica input.
export function deriveEpt95Png(original) {
  requireValue(Buffer.isBuffer(original) && original.length <= 8 * 1024 * 1024, 'original fuera de límite', 'E_FILE_SIZE')
  const before = png(original, { original: true }), kept = [original.subarray(0, 8)]
  let offset = 8, removed = 0
  while (offset < original.length) {
    const size = original.readUInt32BE(offset), type = original.toString('ascii', offset + 4, offset + 8)
    if (type === 'zTXt') removed++
    else kept.push(original.subarray(offset, offset + size + 12))
    offset += size + 12
  }
  requireValue(removed === 1, 'se requiere un único chunk autorizado', 'E_DERIVATION_CHUNK')
  const derived = Buffer.concat(kept), after = png(derived, { wide: true })
  requireValue(JSON.stringify(before.dimensions) === JSON.stringify(after.dimensions) && before.pixelsHash === after.pixelsHash,
    'la derivación alteró dimensiones o píxeles', 'E_DERIVATION_PIXELS')
  return { bytes: derived, dimensions: after.dimensions, pixelsHash: after.pixelsHash,
    originalHash: createHash('sha256').update(original).digest('hex'), derivedHash: createHash('sha256').update(derived).digest('hex') }
}
export function validateEpt95Derivative(bytes, provenance, { wide = false } = {}) {
  shape(provenance, ['tipo', 'original_sha256', 'derivado_sha256', 'pixeles_rgba_sha256', 'chunk_retirado', 'verificado_utc'])
  requireValue(provenance.tipo === 'PNG derivado' && provenance.chunk_retirado === 'zTXt:Raw profile type APP1', 'procedencia no admitida', 'E_DERIVATION_KIND')
  for (const key of ['original_sha256', 'derivado_sha256', 'pixeles_rgba_sha256']) requireValue(typeof provenance[key] === 'string' && /^[a-f0-9]{64}$/u.test(provenance[key]), 'hash procedencia inválido', 'E_DERIVATION_HASH')
  date(provenance.verificado_utc, true)
  requireValue(provenance.original_sha256 !== provenance.derivado_sha256 && createHash('sha256').update(bytes).digest('hex') === provenance.derivado_sha256, 'derivado inconsistente', 'E_DERIVATION_HASH')
  const { dimensions, pixelsHash } = png(bytes, { wide })
  requireValue(pixelsHash === provenance.pixeles_rgba_sha256, 'píxeles de derivado inconsistentes', 'E_DERIVATION_PIXELS')
  return { pixeles: dimensions, pixeles_rgba_sha256: pixelsHash }
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
// Los HTML se normalizan a LF antes del hash: un checkout con core.autocrlf no debe invalidar el manifest.
const sourceSha = (file, bytes) => sha(file.endsWith('.html') ? Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n')) : bytes)
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
// Contenido activo o mixto: HTML/CSS/módulos de render no son documentación pasiva; cada tipo tiene su análisis.
// HTML: lista cerrada de etiquetas y atributos con valores acotados (no una lista negra de patrones).
const htmlTags = new Set(['html', 'head', 'meta', 'title', 'link', 'style', 'body', 'div', 'span', 'main', 'header', 'nav', 'h2', 'h3', 'p', 'strong', 'br', 'label', 'img', 'svg', 'path', 'circle', 'rect'])
const htmlVoid = new Set(['meta', 'link', 'img', 'br'])
const htmlSelfClosing = new Set(['path', 'circle', 'rect'])
const plainValue = /^[^"<>&\\]*$/u
const htmlAttrs = {
  class: /^[A-Za-z0-9_ -]*$/u, lang: /^es$/u, charset: /^utf-8$/u, name: /^viewport$/u, content: /^width=device-width, initial-scale=1$/u, rel: /^stylesheet$/u,
  alt: plainValue, 'aria-label': plainValue, 'aria-hidden': /^true$/u, role: /^status$/u, width: /^\d{1,3}$/u, height: /^\d{1,3}$/u, viewBox: /^0 0 24 24$/u,
  fill: /^(?:none|currentColor)$/u, stroke: /^(?:currentColor|#fff)$/u, 'stroke-width': /^\d(?:\.\d)?$/u, 'stroke-linecap': /^round$/u, 'stroke-linejoin': /^round$/u,
  d: /^[A-Za-z0-9 ,.-]*$/u, cx: /^\d{1,3}$/u, cy: /^\d{1,3}$/u, r: /^\d{1,3}$/u, x: /^\d{1,3}$/u, y: /^\d{1,3}$/u, rx: /^\d{1,3}$/u,
  style: /^[a-z0-9:;.%(), #-]*$/iu, xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/u,
}
export function scanHtml(source, id = null) {
  const fail = message => requireValue(false, message, 'E_ACTIVE_HTML')
  const head = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">'
  requireValue(source.startsWith(head), 'documento HTML local esperado', 'E_ACTIVE_HTML')
  const rest = source.slice('<!doctype html>\n'.length)
  const tag = /<(\/?)([a-z][a-z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*="[^"<>]*")*)\s*(\/?)>/uy
  const stack = []
  let index = 0, links = 0, title = null, escala = 1, styleOpen = false, titleOpen = false
  while (index < rest.length) {
    const next = rest.indexOf('<', index)
    const textEnd = next < 0 ? rest.length : next
    const text = rest.slice(index, textEnd)
    if (!/^(?:[^<>&\\]|&(?:amp|lt|gt);)*$/u.test(text)) fail('texto o entidad no permitida')
    if (styleOpen) {
      const match = /^\s*:root \{ --escala: ([1-3]); \}\s*$/u.exec(text)
      if (!match) fail('estilo embebido no permitido')
      escala = Number(match[1])
    }
    if (titleOpen) title = text
    if (next < 0) break
    tag.lastIndex = next
    const m = tag.exec(rest)
    if (!m) fail('etiqueta HTML malformada o no permitida')
    const [whole, closing, name, attrs, selfClose] = m
    if (!htmlTags.has(name)) fail(`etiqueta no permitida: ${name}`)
    if (closing) {
      if (attrs || selfClose || stack.pop() !== name) fail('anidación HTML inválida')
      if (name === 'style') styleOpen = false
      if (name === 'title') titleOpen = false
    } else {
      const seen = new Set()
      for (const a of attrs.matchAll(/\s+([a-zA-Z][a-zA-Z0-9-]*)="([^"<>]*)"/gu)) {
        const [, key, value] = a
        if (seen.has(key)) fail(`atributo duplicado: ${key}`)
        seen.add(key)
        const allowed = key === 'href' ? (name === 'link' && value === '../estilos.css')
          : key === 'src' ? (name === 'img' && value === '../imagenes/logo-emblema.png')
            : htmlAttrs[key]?.test(value) && !/url\(|expression/iu.test(value)
        if (!allowed) fail(`atributo no permitido: ${key}`)
      }
      if (name === 'link') { links++; if (!seen.has('href') || !seen.has('rel')) fail('link incompleto') }
      if (name === 'img' && !seen.has('src')) fail('imagen sin origen registrado')
      if (selfClose && !htmlSelfClosing.has(name)) fail('autocierre no permitido')
      if (!htmlVoid.has(name) && !selfClose) stack.push(name)
      if (name === 'style') styleOpen = true
      if (name === 'title') titleOpen = true
    }
    index = next + whole.length
  }
  requireValue(stack.length === 0 && links === 1 && title !== null, 'documento HTML incompleto', 'E_ACTIVE_HTML')
  requireValue(!secret.test(source), 'secreto en HTML', 'E_ACTIVE_HTML')
  if (id) requireValue(title.startsWith(id + ' · '), 'el título no corresponde a la pantalla registrada', 'E_ACTIVE_HTML')
  return { escala }
}
export function scanCss(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//gu, '')
  requireValue(!/\\|<|\/\//u.test(clean) && !/@(?!font-face\b)/iu.test(clean)
    && !/expression|behavior|javascript|image-set|cross-fade|-moz-binding|https?:|@s*import|element\(|paint\(/iu.test(clean), 'CSS con importación, escape o referencia externa', 'E_ACTIVE_CSS')
  const urls = [...clean.matchAll(/url\(([^)]*)\)/giu)].map(m => m[1].trim())
  const registered = sources.fonts.map(f => `'${f.slice('fuentes/'.length)}'`)
  requireValue(urls.every(u => registered.includes(u)) && (clean.match(/url/giu) ?? []).length === urls.length, 'url() no registrada', 'E_ACTIVE_CSS')
  requireValue(!secret.test(source), 'secreto en CSS', 'E_ACTIVE_CSS')
}
// Módulos: lista negra de mejor esfuerzo sobre texto. La ejecución es manual y el contenido queda atado por hash al manifest.
export function scanModule(source, name) {
  const allowed = name === 'render' ? ['node:crypto', 'node:fs', 'node:path', 'node:url', './pantallas.mjs'] : []
  // Solo se aceptan sentencias import/export estáticas al inicio de línea y las dos importaciones dinámicas conocidas;
  // cualquier otra aparición de la palabra import o de «from '...'» (comentarios, otra sentencia en la línea) bloquea.
  const stripped = source.replaceAll("import('playwright')", '').replaceAll('import(pathToFileURL(process.env.EPT95_PLAYWRIGHT).href)', '').replaceAll('import.meta', '')
  const flat = stripped.replace(/\/\*[\s\S]*?\*\//gu, ' ')
  const statements = [
    ...[...flat.matchAll(/^[ \t]*import[ \t]*[\w*{}\s,$]*?\s*from\s*(['"`])([^'"`]+)\1/gmu)].map(m => ['import', m[2]]),
    ...[...flat.matchAll(/^[ \t]*import[ \t]*(['"`])([^'"`]+)\1/gmu)].map(m => ['import', m[2]]),
    ...[...flat.matchAll(/^[ \t]*export[ \t]*[\w*{}\s,$]*?\s*from\s*(['"`])([^'"`]+)\1/gmu)].map(m => ['export', m[2]]),
  ]
  requireValue(statements.every(([, specifier]) => allowed.includes(specifier)), 'importación o reexportación no permitida', 'E_ACTIVE_MODULE')
  requireValue((stripped.match(/\bimport\b/gu) ?? []).length === statements.filter(([kind]) => kind === 'import').length
    && (stripped.match(/\bfrom\s*['"`]/gu) ?? []).length === statements.length, 'importación, reexportación o import dinámico no reconocido', 'E_ACTIVE_MODULE')
  requireValue(!/\b(?:child_process|worker_threads|eval|Function|constructor|globalThis|global|Reflect|Proxy|XMLHttpRequest|WebSocket|require|fetch|rm|rmSync|rmdirSync|unlink|unlinkSync|rename|renameSync|cpSync|copyFileSync|symlinkSync|linkSync|chmodSync|chownSync|execSync|execFileSync|execFile|dlopen|binding)\b|\bspawn\w*\b/u.test(source), 'capacidad de ejecución, red o borrado no permitida', 'E_ACTIVE_MODULE')
  // Ofuscación léxica: escapes de identificador, acceso por corchetes con literal y concatenación dentro de corchetes.
  requireValue(!/\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]{2}/u.test(source) && !/[\w)\]]\s*\[\s*['"`]/u.test(source)
    && !/\[\s*['"`][^'"`\n]*['"`]\s*\+|\+\s*['"`][^'"`\n]*['"`]\s*\]/u.test(source), 'ofuscación léxica no permitida', 'E_ACTIVE_MODULE')
  requireValue(!/\bnode:(?!(?:crypto|fs|path|url)['"])/u.test(source)
    && !/\bprocess\b/u.test(source.replace(/process\.(?:env\.EPT95_PLAYWRIGHT|exitCode|argv)\b/gu, '')), 'acceso a proceso o módulo no permitido', 'E_ACTIVE_MODULE')
  requireValue(!secret.test(source), 'secreto en módulo', 'E_ACTIVE_MODULE')
}
export function validateEpt95Assets(root = process.cwd()) {
  root = path.resolve(root); gitModes(root)
  const found = new Set()
  const children = new Map([['', ['disenos', 'fuentes', 'historico-stitch']], ['disenos', ['wireframes', 'mockups', 'variantes']],
    ['fuentes', ['html', 'fuentes-tipograficas', 'imagenes']], ['historico-stitch', ['wireframes', 'mockups']]])
  function inventory(relative) {
    requireValue(!lstatSync(path.join(root, relative)).isSymbolicLink(), 'directorio enlazado')
    const key = relative.slice(base.length).replace(/\/$/u, '')
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = relative + entry.name
      requireValue(!entry.isSymbolicLink(), 'enlace en paquete')
      if (entry.isDirectory()) { requireValue((children.get(key) ?? []).includes(entry.name), 'directorio desconocido', 'E_UNKNOWN_RESOURCE'); inventory(file + '/') }
      else { requireValue(entry.isFile() && ept95Paths.has(file), 'archivo extra o tipo no permitido', 'E_UNKNOWN_RESOURCE'); found.add(file) }
    }
  }
  // Verifica ancestros antes del recorrido y de cualquier lectura.
  safeFile(root, base + 'manifest.json', 128 * 1024); inventory(base)
  requireValue(sourcePaths.every(f => found.has(base + f)), 'fuente editable ausente: el diseño no es reproducible', 'E_SOURCE_MISSING')
  requireValue([...ept95Paths].every(f => found.has(f)), 'paquete incompleto', 'E_PACKAGE')
  const read = (file, max) => safeFile(root, base + file, max)

  // ---- fuentes activas y recursos locales ----
  const scale = new Map(designs.map(d => [d.id, scanHtml(decode(read(d.fuente, 64 * 1024)).replace(/\r\n/gu, '\n'), d.id).escala]))
  for (const f of sources.styles) scanCss(decode(read(f, 64 * 1024)))
  for (const f of sources.modules) scanModule(decode(read(f, 128 * 1024)), f.endsWith('render.mjs') ? 'render' : 'data')
  for (const f of sources.fonts) { const font = read(f, 128 * 1024); requireValue(font.subarray(0, 4).toString('latin1') === 'wOF2' && font.length >= 48 && font.readUInt32BE(8) === font.length, 'fuente woff2 inválida', 'E_FONT') }
  png(read(sources.logo[0], 512 * 1024), { digest: false, minimum: 100 })
  const recipe = JSON.parse(decode(read('receta-render.json', 16 * 1024)))
  requireValue(JSON.stringify(recipe.viewport_css) === '[390,844]' && recipe.factor_escala_dispositivo === 2 && /^[a-f0-9]{40}$/u.test(recipe.baseline)
    && typeof recipe.renderizador === 'string' && /^Playwright \d+\.\d+\.\d+ \+ Chromium \d+(?:\.\d+)*/u.test(recipe.renderizador) && Array.isArray(recipe.comandos) && recipe.comandos.every(c => /^node docs\/parte3\/EPT-95\/fuentes\/render\.mjs (?:html|verificar|png|manifest)$/u.test(c)), 'receta de render inválida', 'E_RECIPE')
  for (const f of sources.text) utf8(read(f, 64 * 1024))

  // ---- manifest v5: diseños locales ----
  const manifest = JSON.parse(utf8(read('manifest.json', 128 * 1024)))
  shape(manifest, ['version', 'tarea', 'estado', 'baseline', 'metodo', 'receta', 'fuentes', 'datos', 'pantallas'])
  requireValue(manifest.version === 5 && manifest.tarea === 'EPT-95' && /^[a-f0-9]{40}$/u.test(manifest.baseline) && manifest.baseline === recipe.baseline
    && manifest.metodo === 'diseno-local' && JSON.stringify(manifest.receta) === JSON.stringify(recipe), 'identidad de manifest inválida', 'E_MANIFEST')
  text(manifest.estado)
  requireValue(manifest.datos !== null && typeof manifest.datos === 'object' && !Array.isArray(manifest.datos), 'datos de ejemplo inválidos', 'E_MANIFEST')
  requireValue(manifest.fuentes !== null && typeof manifest.fuentes === 'object' && !Array.isArray(manifest.fuentes)
    && Object.keys(manifest.fuentes).sort().join('\n') === [...sourcePaths].sort().join('\n'), 'hashes de fuentes incompletos o desconocidos', 'E_SOURCE_HASH')
  for (const f of sourcePaths) requireValue(manifest.fuentes[f] === sourceSha(f, read(f, 512 * 1024)), `hash de fuente no coincide: ${f}`, 'E_SOURCE_HASH')
  requireValue(Array.isArray(manifest.pantallas) && manifest.pantallas.length === designs.length, `inventario manifest debe tener ${designs.length} diseños`, 'E_PACKAGE')
  const seen = new Set()
  for (const [index, s] of manifest.pantallas.entries()) {
    shape(s, ['pantalla', 'tipo', 'area', 'titulo', 'roles', 'estados', 'requisitos', 'archivo', 'pixeles', 'sha256', 'origen'])
    const d = designs[index]
    requireValue(s.pantalla === d.id && s.tipo === d.tipo && s.area === d.area && s.archivo === d.archivo && !seen.has(s.archivo), 'correspondencia pantalla/archivo inválida', 'E_MANIFEST')
    seen.add(s.archivo)
    list(s.roles, roles); list(s.estados, states); list(s.requisitos, requirements); text(s.titulo, 512)
    shape(s.origen, ['tipo', 'fuente', 'fuente_sha256', 'escala_texto'])
    requireValue(s.origen.tipo === 'diseno-local', 'origen no admitido: solo diseño local verificable', 'E_ORIGIN')
    requireValue(s.origen.fuente === d.fuente && s.origen.fuente_sha256 === manifest.fuentes[d.fuente] && [1, 2].includes(s.origen.escala_texto), 'fuente editable no coincide', 'E_SOURCE_HASH')
    requireValue(s.origen.escala_texto === scale.get(d.id) && s.estados.includes('Texto 200%') === (s.origen.escala_texto === 2), 'escala de texto declarada no coincide con la fuente', 'E_MANIFEST')
    const bytes = read(d.archivo, 8 * 1024 * 1024)
    const { dimensions } = png(bytes, { digest: false })
    requireValue(Array.isArray(s.pixeles) && s.pixeles.length === 2 && s.pixeles.every(Number.isSafeInteger) && s.pixeles[0] === dimensions[0] && s.pixeles[1] === dimensions[1], 'dimensiones declaradas no coinciden', 'E_DIMENSIONS')
    requireValue(dimensions[0] === recipe.viewport_css[0] * recipe.factor_escala_dispositivo && dimensions[1] >= recipe.viewport_css[1] * recipe.factor_escala_dispositivo, 'lienzo no móvil', 'E_MOBILE_CANVAS')
    requireValue(sha(bytes) === s.sha256, 'SHA-256 del PNG no coincide', 'E_SHA')
  }
  // Cobertura: nueve áreas con wireframe y mockup, estados y actores.
  for (const area of areas) for (const tipo of ['wireframe', 'mockup']) requireValue(manifest.pantallas.some(s => s.area === area && s.tipo === tipo), `falta ${tipo} del área ${area}`, 'E_AREA_COVERAGE')
  const allStates = new Set(manifest.pantallas.flatMap(s => s.estados)), allRoles = new Set(manifest.pantallas.flatMap(s => s.roles))
  requireValue(requiredStates.every(s => allStates.has(s)), 'faltan estados obligatorios', 'E_STATES_COVERAGE')
  requireValue(requiredRoles.every(r => allRoles.has(r)), 'faltan actores obligatorios', 'E_ROLES_COVERAGE')

  // ---- histórico Stitch: integridad y procedencia, nunca aceptación ----
  const historic = JSON.parse(utf8(read('historico-stitch/manifest.json', 128 * 1024)))
  shape(historic, ['version', 'tarea', 'estado', 'baseline', 'stitch_proyecto', 'stitch_enlace', 'exportacion', 'ronda_correccion', 'pantallas'])
  requireValue(historic.version === 4 && historic.tarea === 'EPT-95' && /^[a-f0-9]{40}$/u.test(historic.baseline) && historic.stitch_proyecto === project
    && historic.stitch_enlace === 'https://stitch.withgoogle.com/' + project && /^Hist[óo]rico rechazado/u.test(historic.estado), 'identidad histórica inválida', 'E_HISTORIC')
  for (const key of ['estado', 'exportacion', 'ronda_correccion']) text(historic[key])
  requireValue(Array.isArray(historic.pantallas) && historic.pantallas.length === 33, 'inventario histórico debe tener 33 PNG', 'E_HISTORIC')
  const ids = new Set(), historicFiles = new Set()
  for (const s of historic.pantallas) {
    shape(s, ['pantalla', 'area', 'roles', 'estados', 'requisitos', 'stitch_id', 'stitch_resource', 'archivo', 'device_type', 'revision', 'sha256', 'pixeles', 'exportado_utc', 'titulo_stitch', 'titulo_local', 'derivacion'])
    secureRelative(s.archivo)
    const file = 'historico-stitch/' + s.archivo
    requireValue(historicNames.includes(file) && !historicFiles.has(file), 'archivo histórico no registrado', 'E_HISTORIC')
    requireValue(typeof s.stitch_id === 'string' && /^[a-f0-9]{32}$/u.test(s.stitch_id) && !ids.has(s.stitch_id)
      && s.stitch_resource === project + '/screens/' + s.stitch_id && ['MOBILE', 'DESKTOP'].includes(s.device_type), 'ID Stitch inválido', 'E_STITCH_ID')
    for (const key of ['revision', 'titulo_stitch', 'titulo_local']) text(s[key], 2048)
    date(s.exportado_utc, true)
    const bytes = read(file, 8 * 1024 * 1024), { pixeles } = validateEpt95Derivative(bytes, s.derivacion, { wide: true })
    requireValue(Array.isArray(s.pixeles) && s.pixeles[0] === pixeles[0] && s.pixeles[1] === pixeles[1] && sha(bytes) === s.sha256, 'hash o dimensiones históricas no coinciden', 'E_SHA')
    requireValue((s.device_type === 'MOBILE') === (pixeles[0] <= 1440), 'dispositivo histórico incoherente con el lienzo exportado', 'E_HISTORIC')
    historicFiles.add(file); ids.add(s.stitch_id)
  }
  csvRows(utf8(read('bitacora-academica.csv', 128 * 1024)))
  for (const file of documents.filter(f => !sources.text.includes(f))) utf8(read(file, 128 * 1024))
  return { disenos: designs.length, historicos: historicFiles.size }
}
