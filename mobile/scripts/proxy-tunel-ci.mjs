// Loopback-only capability gateway for disposable CI services. A tunnel must
// target this gateway, never the local Supabase or Next ports directly.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createServer, request } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function capacidad(seed, nombre) {
  if (!/^[a-f0-9]{64}$/u.test(seed ?? '') || !['supabase', 'api'].includes(nombre)) throw new Error('Invalid CI gateway configuration.')
  return createHmac('sha256', seed).update(`ept-ci-gateway/v1:${nombre}`).digest('hex')
}

export function crearProxy({ seed, nombre, targetPort }) {
  const expected = Buffer.from(capacidad(seed, nombre), 'hex')
  return createServer({ maxHeaderSize: 16_384 }, (req, res) => {
    const match = /^\/ci\/([a-f0-9]{64})(\/[^#]*)?$/u.exec(req.url ?? '')
    const supplied = Buffer.from(match?.[1] ?? '', 'hex')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || !match?.[2]) {
      res.writeHead(403, { 'cache-control': 'no-store', 'content-length': '0' })
      res.end()
      return
    }
    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` }
    for (const name of ['connection', 'proxy-authorization', 'proxy-connection', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for']) delete headers[name]
    const upstream = request({ hostname: '127.0.0.1', port: targetPort, method: req.method, path: match[2], headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.on('error', () => upstream.destroy())
    req.pipe(upstream)
  })
}

function ejecutar() {
  const seed = process.env.EPT_CICLO_CLAVE
  const servers = [
    crearProxy({ seed, nombre: 'supabase', targetPort: 54321 }).listen(15432, '127.0.0.1'),
    crearProxy({ seed, nombre: 'api', targetPort: 3000 }).listen(13000, '127.0.0.1'),
  ]
  for (const server of servers) server.on('error', () => { console.error('CI gateway failed to listen.'); process.exit(1) })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { ejecutar() } catch { console.error('CI gateway failed.'); process.exitCode = 1 }
}
