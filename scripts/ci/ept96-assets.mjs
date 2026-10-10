// EPT-96 · Registro y análisis del paquete del prototipo navegable (docs/parte3/EPT-96/).
// El prototipo contiene HTML, CSS y JavaScript que se EJECUTAN (navegador y Node): no es documentación pasiva.
// Por eso cada ruta se registra de forma literal, cada tipo tiene su propio análisis y CI corre la navegación real
// (docs/parte3/EPT-96/pruebas/prototipo.mjs). Los escáneres son una lista negra de mejor esfuerzo sobre texto: la
// barrera real es que el contenido se ejecuta bajo CSP estricta, con red bloqueada y solo con datos ficticios.
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { secureRelative } from './ept95-assets.mjs'

const base = 'docs/parte3/EPT-96/'
const documentos = ['README.md', 'matriz-aceptacion.md', 'mapa-navegacion.md']
const modulosNavegador = ['app', 'datos', 'dinero', 'pantallas', 'reglas', 'vista'].map(n => `prototipo/js/${n}.mjs`)
const modulosNode = ['servidor/servidor.mjs', 'pruebas/prototipo.mjs']
export const capturas = [
  'N01-01-ingreso', 'N01-02-selector-hijo', 'N01-03-cuotas', 'N01-04-factura', 'N01-05-seleccion', 'N01-06-pago-registrado', 'N01-07-comprobante', 'N01-08-confirmacion', 'N01-09-periodo',
  'N02-01-sofia-cuotas', 'N02-02-mateo-sin-seleccion', 'N03-01-sin-seleccion', 'N03-02-seleccion-parcial', 'N04-01-banco-no-configurado', 'N04-02-escenario-simulado',
  'N05-01-validaciones', 'N05-02-archivos-y-duplicado', 'N05-03-confirmacion-conciliacion', 'N06-01-incierto', 'N06-02-recibido', 'N06-03-no-recibido',
  'N07-01-cuotas-estudiante', 'N07-02-factura-estudiante', 'N07-03-periodo-estudiante', 'N07-04-inscripciones-estudiante',
  'N08-01-estudiante-denegado', 'N08-02-padre-vinculado-denegado', 'N08-03-sin-sesion', 'N09-01-canal-web',
  'N10-01-validacion-login', 'N10-02-credenciales-invalidas', 'N10-03-cuenta-bloqueada', 'N10-04-sin-vinculos', 'N10-05-sesion-expirada',
  'N11-01-borrador-descartado', 'N11-02-reiniciado', 'N12-01-carga', 'N12-02-error-conexion', 'N12-03-pagadas', 'N12-04-vacio', 'N12-05-rango-invalido',
  'N14-01-texto-200', 'N15-01-deuda-por-item', 'N15-02-periodo-inclusivo', 'N16-01-original-quien-cargo', 'N16-02-otro-padre', 'N16-03-original-ajeno-denegado',
]
export const ept96Paths = new Set([...documentos, 'bitacora-academica.csv', 'receta-prototipo.json', 'prototipo/index.html', 'prototipo/estilos.css',
  ...modulosNavegador, ...modulosNode, ...capturas.map(n => `evidencia/${n}.png`)].map(f => base + f))

const pruebasRequeridas = ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06',
  'N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09', 'N10', 'N11', 'N12', 'N13', 'N13b', 'N14', 'N15', 'N16']
const activos = ['outfit-latin-400-normal', 'outfit-latin-500-normal', 'outfit-latin-600-normal', 'outfit-latin-700-normal', 'geist-mono-latin'].map(n => `/activos/${n}.woff2`)
const cabecerasCsv = ['fecha_art', 'actividad', 'herramienta', 'insumo', 'comprension_y_adaptacion', 'prueba_o_limite', 'resultado', 'origen']
const secreto = /-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b|(?:password|passwd|service_role_key|api_key|access_token)\s*[:=]\s*["']?[A-Za-z0-9_/+=-]{8,}/iu

function exigir(condicion, mensaje, codigo = 'E_EPT96_CONTRACT') {
  if (!condicion) { const error = new Error(`EPT-96: ${mensaje}`); error.code = codigo; throw error }
}
function leerSeguro(root, relativa, max) {
  secureRelative(relativa)
  let actual = root
  exigir(!lstatSync(actual).isSymbolicLink(), 'raíz enlazada')
  for (const parte of relativa.split('/')) { actual = path.join(actual, parte); exigir(!lstatSync(actual).isSymbolicLink(), 'archivo o ancestro enlazado') }
  const estado = lstatSync(actual)
  exigir(estado.isFile() && estado.size > 0 && estado.size <= max, `tipo o tamaño inválido: ${relativa}`, 'E_FILE_SIZE')
  exigir(process.platform === 'win32' || !(estado.mode & 0o111), `archivo ejecutable: ${relativa}`)
  return readFileSync(actual)
}
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

// ---------- HTML: lista cerrada de etiquetas y atributos con valor acotado ----------
const etiquetas = new Set(['html', 'head', 'meta', 'title', 'link', 'body', 'p', 'div', 'details', 'noscript', 'script'])
const vacias = new Set(['meta', 'link'])
const atributos = {
  '*': { class: /^[A-Za-z0-9_ -]*$/u, id: /^(?:app|anuncios|simulacion)$/u, role: /^(?:note|status)$/u, 'aria-live': /^(?:off|polite)$/u },
  html: { lang: /^es$/u },
  meta: { charset: /^utf-8$/u, name: /^viewport$/u, content: /^width=device-width, initial-scale=1$/u },
  link: { rel: /^(?:stylesheet|icon)$/u, href: /^\/(?:estilos\.css|activos\/logo-emblema\.png)$/u, type: /^image\/png$/u },
  script: { type: /^module$/u, src: /^\/js\/app\.mjs$/u },
}
export function scanHtml96(fuente) {
  const falla = mensaje => exigir(false, mensaje, 'E_ACTIVE_HTML')
  exigir(fuente.startsWith('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">'), 'documento HTML local esperado', 'E_ACTIVE_HTML')
  const resto = fuente.slice('<!doctype html>\n'.length)
  const etiqueta = /<(\/?)([a-z][a-z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*="[^"<>]*")*)\s*(\/?)>/uy
  const pila = []
  let indice = 0, scripts = 0, enlaces = 0, dentroScript = false
  while (indice < resto.length) {
    const siguiente = resto.indexOf('<', indice)
    const texto = resto.slice(indice, siguiente < 0 ? resto.length : siguiente)
    if (!/^(?:[^<>&\\]|&(?:amp|lt|gt);)*$/u.test(texto)) falla('texto o entidad no permitida')
    if (dentroScript && texto.trim() !== '') falla('script en línea no permitido')
    if (siguiente < 0) break
    etiqueta.lastIndex = siguiente
    const m = etiqueta.exec(resto)
    if (!m) falla('etiqueta HTML malformada o no permitida')
    const [completa, cierre, nombre, attrs, autocierre] = m
    if (!etiquetas.has(nombre)) falla(`etiqueta no permitida: ${nombre}`)
    if (cierre) {
      if (attrs || autocierre || pila.pop() !== nombre) falla('anidación HTML inválida')
      if (nombre === 'script') dentroScript = false
    } else {
      const vistos = new Set()
      for (const a of attrs.matchAll(/\s+([a-zA-Z][a-zA-Z0-9-]*)="([^"<>]*)"/gu)) {
        const [, clave, valor] = a
        if (vistos.has(clave)) falla(`atributo duplicado: ${clave}`)
        vistos.add(clave)
        const regla = (Object.hasOwn(atributos, nombre) && Object.hasOwn(atributos[nombre], clave) ? atributos[nombre][clave] : null)
          ?? (Object.hasOwn(atributos['*'], clave) ? atributos['*'][clave] : null)
        if (!regla || !regla.test(valor)) falla(`atributo no permitido: ${nombre}[${clave}]`)
      }
      if (autocierre) falla('autocierre no permitido')
      if (nombre === 'script') { scripts++; dentroScript = true; if (!vistos.has('src') || !vistos.has('type')) falla('script sin origen registrado') }
      if (nombre === 'link') { enlaces++; if (!vistos.has('rel') || !vistos.has('href')) falla('link incompleto') }
      if (!vacias.has(nombre)) pila.push(nombre)
    }
    indice = siguiente + completa.length
  }
  exigir(pila.length === 0 && scripts === 1 && enlaces === 2, 'documento HTML incompleto o con recursos no registrados', 'E_ACTIVE_HTML')
  exigir(!secreto.test(fuente), 'secreto en HTML', 'E_ACTIVE_HTML')
}

// ---------- CSS ----------
export function scanCss96(fuente) {
  const limpio = fuente.replace(/\/\*[\s\S]*?\*\//gu, '')
  exigir(!/\\|<|\/\//u.test(limpio) && !/@(?!font-face\b|media\s*\(prefers-reduced-motion: reduce\))/iu.test(limpio)
    && !/expression|behavior|javascript|image-set|cross-fade|-moz-binding|https?:|@import|element\(|paint\(/iu.test(limpio), 'CSS con importación, escape o referencia externa', 'E_ACTIVE_CSS')
  const urls = [...limpio.matchAll(/url\(([^)]*)\)/giu)].map(m => m[1].trim())
  const registradas = activos.map(a => `'${a}'`)
  exigir(urls.every(u => registradas.includes(u)) && (limpio.match(/url/giu) ?? []).length === urls.length, 'url() no registrada', 'E_ACTIVE_CSS')
  exigir(!secreto.test(fuente), 'secreto en CSS', 'E_ACTIVE_CSS')
}

// ---------- JavaScript ----------
function importaciones(fuente) {
  const sinDinamicos = fuente.replaceAll("import('playwright')", '').replaceAll('import(pathToFileURL(process.env.EPT96_PLAYWRIGHT).href)', '').replaceAll('import.meta', '')
  const plano = sinDinamicos.replace(/\/\*[\s\S]*?\*\//gu, ' ')
  const conFrom = [...plano.matchAll(/^[ \t]*import[ \t]*[\w*{}\s,$]*?\s*from\s*(['"`])([^'"`]+)\1/gmu)].map(m => m[2])
  const lateral = [...plano.matchAll(/^[ \t]*import[ \t]*(['"`])([^'"`]+)\1/gmu)].map(m => m[2])
  const reexporta = [...plano.matchAll(/^[ \t]*export[ \t]*[\w*{}\s,$]*?\s*from\s*(['"`])([^'"`]+)\1/gmu)].map(m => m[2])
  const cuentaImport = (sinDinamicos.match(/\bimport\b/gu) ?? []).length
  const cuentaFrom = (sinDinamicos.match(/\bfrom\s*['"`]/gu) ?? []).length
  // Cualquier otra aparición de `import` o de `from '…'` (comentarios, import dinámico, otra sentencia) bloquea.
  return { sentencias: [...conFrom, ...lateral, ...reexporta], coherente: cuentaImport === conFrom.length + lateral.length && cuentaFrom === conFrom.length + reexporta.length }
}
// Ofuscación léxica: escapes de identificador, acceso por corchetes con literal (`obj['x']`) y concatenación dentro de corchetes.
// Un literal de arreglo tras una palabra clave (`of [...]`, `return [...]`) no es acceso por corchetes.
const PALABRAS_CLAVE = new Set(['of', 'in', 'return', 'case', 'typeof', 'else', 'yield', 'await', 'void', 'delete', 'throw', 'new', 'default', 'do'])
const accesoPorCorchetes = fuente => [...fuente.matchAll(/([\w$]+|[)\]])\s*\[\s*['"`]/gu)].some(m => !PALABRAS_CLAVE.has(m[1]))
const ofuscacion = fuente => /\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]{2}/u.test(fuente) || accesoPorCorchetes(fuente)
  || /\[\s*['"`][^'"`\n]*['"`]\s*\+|\+\s*['"`][^'"`\n]*['"`]\s*\]/u.test(fuente)

export function scanBrowserModule(fuente, nombre) {
  const falla = mensaje => exigir(false, `${nombre}: ${mensaje}`, 'E_ACTIVE_BROWSER')
  const permitidas = modulosNavegador.map(m => `./${m.split('/').pop()}`)
  const { sentencias, coherente } = importaciones(fuente)
  if (!sentencias.every(s => permitidas.includes(s))) falla('importación no permitida')
  if (!coherente) falla('importación, reexportación o import dinámico no reconocido')
  const sinNamespace = fuente.replaceAll("'http://www.w3.org/2000/svg'", "''").replaceAll('`<svg xmlns="${SVG}">', '').replaceAll('xmlns="${SVG}"', '')
  if (/https?:\/\//u.test(sinNamespace)) falla('URL externa')
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval|Function|constructor|importScripts|Worker|SharedWorker|serviceWorker|ServiceWorker|globalThis|Reflect|Proxy|require)\b/u.test(fuente)) falla('capacidad de red o ejecución dinámica no permitida')
  if (/\b(?:localStorage|sessionStorage|indexedDB|caches|cookie|FileReader|showOpenFilePicker|createObjectURL|postMessage|navigator|clipboard|geolocation)\b/u.test(fuente)) falla('API de almacenamiento, archivos o dispositivo no permitida')
  if (/\b(?:innerHTML|outerHTML|insertAdjacentHTML|srcdoc|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe)\b|document\.writ/u.test(fuente)) falla('el DOM no puede construirse desde texto HTML')
  if (/createElement\(\s*['"`](?:script|iframe|object|embed|form|input|a|link|base|meta)\b/u.test(fuente)) falla('elemento activo no permitido')
  if (/\.click\s*\(|\bopen\s*\(|\batob\b|\bbtoa\b|['"`]\/\/|\bwss?:/u.test(fuente)) falla('navegación, decodificación o URL relativa al protocolo no permitidas')
  if (/\bwindow\.open\b|\blocation\s*=|\blocation\.(?:href|assign|replace|reload)\b|\bimport\s*\(/u.test(fuente)) falla('navegación fuera del ruteo por hash')
  if (/setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/u.test(fuente)) falla('temporizador con texto')
  if (/type\s*[:=]\s*['"]file['"]|type="file"/u.test(fuente)) falla('el prototipo no admite carga de archivos reales')
  if (/\bstyle\s*:/u.test(fuente) || /setAttribute\(\s*['"]style['"]/u.test(fuente)) falla('estilos en línea no permitidos')
  if (ofuscacion(fuente)) falla('ofuscación léxica no permitida')
  if (secreto.test(fuente)) falla('secreto en módulo')
}

const NODE_PERMITIDOS = {
  'servidor/servidor.mjs': ['node:http', 'node:fs/promises', 'node:path', 'node:url'],
  'pruebas/prototipo.mjs': ['node:assert/strict', 'node:http', 'node:fs', 'node:os', 'node:path', 'node:url', '../servidor/servidor.mjs',
    '../prototipo/js/datos.mjs', '../prototipo/js/dinero.mjs', '../prototipo/js/reglas.mjs'],
}
export function scanNodeModule(fuente, relativa) {
  const falla = mensaje => exigir(false, `${relativa}: ${mensaje}`, 'E_ACTIVE_NODE')
  const { sentencias, coherente } = importaciones(fuente)
  if (!sentencias.every(s => NODE_PERMITIDOS[relativa].includes(s))) falla('importación no permitida')
  if (!coherente) falla('importación, reexportación o import dinámico no reconocido')
  if (/\b(?:child_process|worker_threads|cluster|vm|net|dgram|dns|tls|https|http2|inspector|repl|eval|Function|constructor|globalThis|Reflect|Proxy|require|fetch|XMLHttpRequest|WebSocket)\b/u.test(fuente.replace(/\bnode:http\b/gu, ''))) falla('capacidad de ejecución o red no permitida')
  if (/\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|writeFile|writeFileSync|appendFile|appendFileSync|copyFile|copyFileSync|cpSync|symlink|symlinkSync|linkSync|cp|createWriteStream|writeSync|chmod|chmodSync|chown|chownSync|truncate|truncateSync)\b/u.test(fuente)) falla('escritura o borrado de archivos no permitido')
  if (/https?:\/\/(?!127\.0\.0\.1)/u.test(fuente)) falla('URL no local')
  if (/\bprocess\b/u.test(fuente.replace(/process\.(?:argv|exitCode|exit|on|env\.EPT96_PLAYWRIGHT)\b/gu, ''))) falla('acceso a proceso o entorno no permitido')
  if (ofuscacion(fuente)) falla('ofuscación léxica no permitida')
  if (secreto.test(fuente)) falla('secreto en módulo')
  if (relativa === 'servidor/servidor.mjs') {
    // La URL cruda se busca en una tabla cerrada; nunca se decodifica ni se une a una ruta del disco.
    exigir(/RUTAS\.get\(req\.url/u.test(fuente) && !/path\.(?:join|resolve|normalize)\([^)]*\breq\b/u.test(fuente) && !/decodeURI|unescape|\bnew URL\(/u.test(fuente), `${relativa}: el servidor debe resolver solo por tabla cerrada`, 'E_ACTIVE_NODE')
    exigir(/listen\(puerto, '127\.0\.0\.1'/u.test(fuente) && /ANFITRION_VALIDO\.test\(req\.headers/u.test(fuente) && !/true\s*\|\|\s*ANFITRION/u.test(fuente) && /default-src 'none'/u.test(fuente)
      && /import \{ createServer \} from 'node:http'/u.test(fuente), `${relativa}: faltan restricciones de escucha, Host o CSP`, 'E_ACTIVE_NODE')
  } else {
    // Los comentarios no cuentan: una prueba retirada y dejada en un comentario sigue siendo una negativa retirada.
    const sinComentarios = fuente.replace(/^[ \t]*\/\*[\s\S]*?\*\//gmu, '').replace(/(^|[ \t])\/\/.*$/gmu, '$1')
    const faltan = pruebasRequeridas.filter(id => !new RegExp(`prueba\\('${id}'`, 'u').test(sinComentarios))
    exigir(/aserciones\+\+/u.test(fuente) && /REQUERIDAS/u.test(fuente), `${relativa}: el runner debe contar aserciones y verificar las pruebas ejecutadas`, 'E_ACTIVE_NODE')
    exigir(faltan.length === 0, `${relativa}: faltan pruebas obligatorias ${faltan.join(', ')}`, 'E_ACTIVE_NODE')
    exigir(/LIMITE_TOTAL_MS/u.test(fuente) && /finally\s*\{[^}]*cerrar/u.test(fuente) && /browser\.close\(\)/u.test(fuente), `${relativa}: faltan límite de tiempo o cierre en finally`, 'E_ACTIVE_NODE')
  }
}

// ---------- PNG de evidencia (390 px de ancho, factor 1) ----------
function crc32(bytes) {
  let crc = 0xffffffff
  for (const v of bytes) { crc ^= v; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
export function validarPng96(bytes, nombre) {
  const falla = (mensaje, codigo = 'E_PNG') => exigir(false, `${nombre}: ${mensaje}`, codigo)
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) falla('firma PNG inválida', 'E_PNG_SIGNATURE')
  let offset = 8, ancho = 0, alto = 0, canales = 0, fin = false
  const idat = []
  while (offset < bytes.length) {
    if (bytes.length - offset < 12 || fin) falla('PNG truncado o con datos finales', 'E_PNG_BOUNDS')
    const tamano = bytes.readUInt32BE(offset), tipo = bytes.toString('ascii', offset + 4, offset + 8)
    if (tamano > bytes.length - offset - 12) falla('chunk inválido', 'E_PNG_BOUNDS')
    const datos = bytes.subarray(offset + 8, offset + 8 + tamano)
    if (crc32(bytes.subarray(offset + 4, offset + 8 + tamano)) !== bytes.readUInt32BE(offset + 8 + tamano)) falla('CRC inválido', 'E_PNG_CRC')
    if (tipo === 'IHDR') {
      if (offset !== 8 || tamano !== 13) falla('IHDR inválido')
      ancho = datos.readUInt32BE(0); alto = datos.readUInt32BE(4); canales = datos[9] === 2 ? 3 : datos[9] === 6 ? 4 : 0
      if (datos[8] !== 8 || !canales || datos[10] !== 0 || datos[11] !== 0 || datos[12] !== 0) falla('formato PNG fuera de contrato')
    } else if (tipo === 'IDAT') idat.push(datos)
    else if (tipo === 'IEND') { if (tamano !== 0 || offset + 12 !== bytes.length) falla('IEND inválido'); fin = true }
    else if (!['sRGB', 'gAMA', 'cHRM', 'pHYs', 'sBIT'].includes(tipo)) falla(`chunk no permitido: ${tipo}`, 'E_PNG_METADATA')
    offset += tamano + 12
  }
  if (!fin || idat.length === 0) falla('PNG incompleto')
  if (ancho !== 390 || alto < 300 || alto > 12000) falla(`lienzo fuera de contrato (${ancho}×${alto}); se esperaba 390 px de ancho`, 'E_PNG_CANVAS')
  const esperado = (ancho * canales + 1) * alto
  let inflado
  try { inflado = inflateSync(Buffer.concat(idat), { maxOutputLength: esperado }) } catch { falla('zlib inválido o límite excedido', 'E_PNG_INFLATE') }
  if (inflado.length !== esperado) falla('scanlines inválidas', 'E_PNG_SCANLINES')
  return { ancho, alto }
}

function filasCsv(valor) {
  const filas = []; let fila = [], celda = '', comillas = false, cerrada = false
  const cerrarCelda = () => { exigir(celda.length <= 4096, 'celda CSV demasiado larga'); fila.push(celda); celda = ''; cerrada = false }
  for (let i = 0; i < valor.length; i++) {
    const c = valor[i]
    if (comillas) { if (c === '"') { if (valor[i + 1] === '"') { celda += '"'; i++ } else { comillas = false; cerrada = true } } else celda += c; continue }
    if (c === '"') { exigir(celda === '' && !cerrada, 'comillas CSV inválidas'); comillas = true }
    else if (c === ',') cerrarCelda()
    else if (c === '\n' || c === '\r') { if (c === '\r' && valor[i + 1] === '\n') i++; cerrarCelda(); filas.push(fila); fila = [] }
    else { exigir(!cerrada, 'contenido tras comillas CSV'); celda += c }
  }
  exigir(!comillas, 'CSV sin cierre'); if (celda || fila.length || cerrada) { cerrarCelda(); filas.push(fila) }
  exigir(filas.length >= 2 && filas.length <= 200 && JSON.stringify(filas[0]) === JSON.stringify(cabecerasCsv), 'cabecera o filas CSV inválidas')
  for (const f of filas.slice(1)) {
    exigir(f.length === 8 && /^\d{4}-\d{2}-\d{2}$/u.test(f[0]), 'CSV requiere ocho columnas y fecha ISO')
    for (const c of f) exigir(c.length > 0 && !secreto.test(c) && !/<\s*script\b|javascript\s*:/iu.test(c) && !/^[\s]*[=+@-]/u.test(c), 'celda CSV no permitida')
  }
}

function modosGit(root) {
  let raiz
  try { raiz = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return }
  exigir(path.resolve(raiz) === root, 'raíz no coincide con checkout Git')
  const registros = execFileSync('git', ['-C', root, 'ls-files', '--stage', '-z', '--', base], { encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const registro of registros) { const [meta, archivo] = registro.split('\t'); exigir(/^100644 [a-f0-9]{40,64} 0$/u.test(meta) && ept96Paths.has(archivo), 'modo Git o ruta del candidato no permitida') }
}

export function validateEpt96Assets(root = process.cwd()) {
  root = path.resolve(root); modosGit(root)
  const hijos = new Map([['', ['prototipo', 'servidor', 'pruebas', 'evidencia']], ['prototipo', ['js']]])
  const hallados = new Set()
  function inventario(relativa) {
    exigir(!lstatSync(path.join(root, relativa)).isSymbolicLink(), 'directorio enlazado')
    const clave = relativa.slice(base.length).replace(/\/$/u, '')
    for (const entrada of readdirSync(path.join(root, relativa), { withFileTypes: true })) {
      const archivo = relativa + entrada.name
      exigir(!entrada.isSymbolicLink(), 'enlace en paquete')
      if (entrada.isDirectory()) { exigir((hijos.get(clave) ?? []).includes(entrada.name), `directorio desconocido: ${archivo}`, 'E_UNKNOWN_RESOURCE'); inventario(`${archivo}/`) }
      else { exigir(entrada.isFile() && ept96Paths.has(archivo), `archivo extra o tipo no permitido: ${archivo}`, 'E_UNKNOWN_RESOURCE'); hallados.add(archivo) }
    }
  }
  leerSeguro(root, `${base}README.md`, 128 * 1024)
  inventario(base)
  exigir([...ept96Paths].every(f => hallados.has(f)), `paquete incompleto: ${[...ept96Paths].filter(f => !hallados.has(f)).join(', ')}`, 'E_PACKAGE')
  const leer = (relativa, max) => leerSeguro(root, base + relativa, max)

  scanHtml96(utf8(leer('prototipo/index.html', 16 * 1024)).replace(/\r\n/gu, '\n'))
  scanCss96(utf8(leer('prototipo/estilos.css', 64 * 1024)))
  for (const m of modulosNavegador) scanBrowserModule(utf8(leer(m, 128 * 1024)), m)
  for (const m of modulosNode) scanNodeModule(utf8(leer(m, 128 * 1024)).replace(/\r\n/gu, '\n'), m)
  for (const n of capturas) validarPng96(leer(`evidencia/${n}.png`, 2 * 1024 * 1024), `evidencia/${n}.png`)
  for (const d of documentos) { const t = utf8(leer(d, 128 * 1024)); exigir(!secreto.test(t) && !/<\s*script\b|javascript\s*:/iu.test(t), `texto no pasivo o secreto: ${d}`, 'E_TEXT') }
  filasCsv(utf8(leer('bitacora-academica.csv', 128 * 1024)))
  const receta = JSON.parse(utf8(leer('receta-prototipo.json', 16 * 1024)))
  exigir(receta !== null && typeof receta === 'object' && /^[a-f0-9]{40}$/u.test(receta.baseline) && Array.isArray(receta.comandos) && receta.comandos.length > 0
    && receta.comandos.every(c => /^node docs\/parte3\/EPT-96\/(?:servidor\/servidor\.mjs(?: --puerto \d{2,5})?|pruebas\/prototipo\.mjs(?: --capturas docs\/parte3\/EPT-96\/evidencia)?)$/u.test(c))
    && !secreto.test(JSON.stringify(receta)), 'receta de arranque inválida', 'E_RECIPE')
  return { archivos: hallados.size, capturas: capturas.length }
}
