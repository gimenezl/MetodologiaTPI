// EPT-96 · Servidor local del prototipo. Sirve ÚNICAMENTE una lista cerrada de archivos.
// Uso: node docs/parte3/EPT-96/servidor/servidor.mjs [--puerto 4196]
// No decodifica ni une rutas: la URL cruda debe coincidir exactamente con una entrada de RUTAS.
// Cualquier otra cosa (traversal, doble codificación, .env, directorios, query) responde 404.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const paquete = path.resolve(aqui, '..')
const prototipo = path.join(paquete, 'prototipo')
// Fuentes tipográficas y logo: se reutilizan de EPT-95 sin duplicar binarios ni modificar ese paquete.
const activosEpt95 = path.resolve(paquete, '..', 'EPT-95', 'fuentes')

const TIPOS = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', mjs: 'text/javascript; charset=utf-8', woff2: 'font/woff2', png: 'image/png' }
const entrada = (url, archivo) => [url, { archivo, tipo: TIPOS[archivo.split('.').pop()] }]

export const RUTAS = new Map([
  entrada('/', path.join(prototipo, 'index.html')),
  entrada('/index.html', path.join(prototipo, 'index.html')),
  entrada('/estilos.css', path.join(prototipo, 'estilos.css')),
  ...['app', 'datos', 'dinero', 'pantallas', 'reglas', 'vista'].map(n => entrada(`/js/${n}.mjs`, path.join(prototipo, 'js', `${n}.mjs`))),
  ...['400', '500', '600', '700'].map(p => entrada(`/activos/outfit-latin-${p}-normal.woff2`, path.join(activosEpt95, 'fuentes-tipograficas', `outfit-latin-${p}-normal.woff2`))),
  entrada('/activos/geist-mono-latin.woff2', path.join(activosEpt95, 'fuentes-tipograficas', 'geist-mono-latin.woff2')),
  entrada('/activos/logo-emblema.png', path.join(activosEpt95, 'imagenes', 'logo-emblema.png')),
])

const CABECERAS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
}
const ANFITRION_VALIDO = /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/u

function responder(res, estado, cuerpo = '', extra = {}) {
  const bytes = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo)
  res.writeHead(estado, { ...CABECERAS, 'Content-Length': bytes.length, ...extra })
  return bytes
}

export function iniciarServidor({ puerto = 0 } = {}) {
  const servidor = createServer(async (req, res) => {
    try {
      if (!ANFITRION_VALIDO.test(req.headers.host ?? '')) { res.end(responder(res, 403, 'Anfitrión no permitido', { 'Content-Type': 'text/plain; charset=utf-8' })); return }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.end(responder(res, 405, 'Método no permitido', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })); return }
      const destino = RUTAS.get(req.url ?? '')
      if (!destino) { res.end(responder(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' })); return }
      const bytes = responder(res, 200, await readFile(destino.archivo), { 'Content-Type': destino.tipo })
      res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch {
      if (!res.headersSent) res.end(responder(res, 500, 'Error interno', { 'Content-Type': 'text/plain; charset=utf-8' }))
      else res.destroy()
    }
  })
  servidor.requestTimeout = 10_000
  servidor.headersTimeout = 5_000
  return new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar)
    // Solo la interfaz local: el prototipo nunca queda expuesto en la red.
    servidor.listen(puerto, '127.0.0.1', () => {
      const { port } = servidor.address()
      resolver({ servidor, puerto: port, url: `http://127.0.0.1:${port}/`, cerrar: () => new Promise(r => { servidor.closeAllConnections(); servidor.close(() => r()) }) })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const indice = process.argv.indexOf('--puerto')
  const puerto = indice > 0 ? Number(process.argv[indice + 1]) : 4196
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) { console.error('Uso: servidor.mjs [--puerto N]'); process.exitCode = 2 } else {
    const { url, cerrar } = await iniciarServidor({ puerto })
    console.log(`Prototipo EPT-96 en ${url}\nCtrl+C para detenerlo. Solo escucha en 127.0.0.1.`)
    process.on('SIGINT', async () => { await cerrar(); process.exit(0) })
  }
}
