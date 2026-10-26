// Túnel efímero Linux -> macOS para el recorrido nativo de iOS (EPT-119).
//
// Los runners macOS ARM no tienen Docker: el backend de prueba (Supabase local + Next) corre en un job Linux y
// el simulador iOS lo alcanza por HTTPS a través de dos túneles rápidos de Cloudflare (URL aleatoria, sin
// cuenta ni configuración persistente). Controles:
//   - solo se publican el API de Supabase local (54321) y el servidor Next del runner (3000);
//   - las claves privilegiadas nunca viajan: este script no las lee y la app solo recibe la clave anónima;
//   - los datos son sintéticos y el stack se destruye al terminar el job (stop con if: always());
//   - los registros del proceso quedan fuera de los artefactos y el nombre de host se enmascara en el log.
//
//   EPT_CLOUDFLARED=<binario verificado> node mobile/scripts/tunel-efimero.mjs start <directorio-salida>
//   node mobile/scripts/tunel-efimero.mjs stop <directorio-salida>
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [accion, directorio] = process.argv.slice(2)
const PUERTOS = { supabase: 54321, api: 3000 }
const PATRON_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u

const exigir = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje) }
const esperar = ms => new Promise(r => setTimeout(r, ms))

async function iniciarTunel(nombre, puerto, privado) {
  const binario = process.env.EPT_CLOUDFLARED
  exigir(binario && existsSync(binario), 'Falta el binario de cloudflared verificado (EPT_CLOUDFLARED).')
  const registro = join(privado, `${nombre}.log`)
  const fd = openSync(registro, 'a', 0o600)
  const hijo = spawn(binario, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${puerto}`], {
    stdio: ['ignore', fd, fd], detached: true, env: { PATH: process.env.PATH, HOME: process.env.HOME },
  })
  hijo.unref()
  closeSync(fd)
  writeFileSync(join(privado, `${nombre}.pid`), String(hijo.pid), { mode: 0o600 })
  const fin = Date.now() + 60_000
  while (Date.now() < fin) {
    if (hijo.exitCode !== null) throw new Error(`El túnel ${nombre} terminó antes de publicar su URL.`)
    const url = PATRON_URL.exec(existsSync(registro) ? readFileSync(registro, 'utf8') : '')?.[0]
    if (url) return url
    await esperar(500)
  }
  throw new Error(`El túnel ${nombre} no publicó su URL a tiempo.`)
}

async function responde(url, ruta, cabeceras = {}) {
  const fin = Date.now() + 90_000
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${url}${ruta}`, { headers: cabeceras, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      if (r.status === 200) return
    } catch { /* el túnel aún propaga el DNS */ }
    await esperar(2_000)
  }
  throw new Error(`El túnel no atendió ${ruta} a tiempo.`)
}

async function iniciar() {
  exigir(directorio, 'Falta el directorio de salida.')
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  exigir(anon, 'Falta la clave anónima pública (EXPO_PUBLIC_SUPABASE_ANON_KEY).')
  const privado = join(directorio, '.privado')
  mkdirSync(privado, { recursive: true, mode: 0o700 })
  const urls = {}
  for (const [nombre, puerto] of Object.entries(PUERTOS)) {
    urls[nombre] = await iniciarTunel(nombre, puerto, privado)
    console.log(`::add-mask::${new URL(urls[nombre]).hostname}`)
  }
  await responde(urls.supabase, '/auth/v1/health', { apikey: anon })
  await responde(urls.api, '/login')
  // Solo URLs públicas y la clave anónima: nada que dé privilegios.
  writeFileSync(join(directorio, 'urls.json'), JSON.stringify({ ...urls, anon }), { mode: 0o600 })
  console.log('Túneles efímeros listos (Supabase y servidor web de prueba).')
}

function detener() {
  const privado = join(directorio ?? '', '.privado')
  for (const nombre of Object.keys(PUERTOS)) {
    const ruta = join(privado, `${nombre}.pid`)
    if (!existsSync(ruta)) continue
    const pid = Number(readFileSync(ruta, 'utf8'))
    rmSync(ruta, { force: true })
    if (Number.isInteger(pid) && pid > 1) {
      for (const objetivo of [-pid, pid]) {
        try { process.kill(objetivo, 'SIGTERM') } catch { /* ya terminó */ }
      }
    }
  }
  console.log('Túneles efímeros detenidos.')
}

/** Job macOS: vuelca el apretón de manos descargado en las variables públicas que incrusta el build de Expo. */
function entorno() {
  const githubEnv = process.env.GITHUB_ENV
  exigir(githubEnv && directorio, 'Falta GITHUB_ENV o la ruta del apretón de manos.')
  const h = JSON.parse(readFileSync(directorio, 'utf8'))
  for (const [clave, valor] of [['supabase', h.supabase], ['api', h.api]]) {
    exigir(PATRON_URL.test(valor) && new URL(valor).pathname === '/', `El apretón de manos trae una URL inesperada (${clave}).`)
  }
  exigir(typeof h.anon === 'string' && h.anon.split('.').length === 3, 'El apretón de manos no trae una clave anónima con forma de JWT.')
  const rol = JSON.parse(Buffer.from(h.anon.split('.')[1], 'base64url').toString('utf8')).role
  exigir(rol === 'anon', 'La clave del apretón de manos no es la clave anónima: se rechaza.')
  for (const valor of [h.supabase, h.api]) console.log(`::add-mask::${new URL(valor).hostname}`)
  appendFileSync(githubEnv, [
    `EXPO_PUBLIC_SUPABASE_URL=${h.supabase}`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=${h.anon}`, `EXPO_PUBLIC_API_BASE_URL=${h.api}`,
  ].join('\n') + '\n', { mode: 0o600 })
  console.log('Entorno público del build iOS derivado del apretón de manos.')
}

try {
  if (accion === 'start') await iniciar()
  else if (accion === 'stop') detener()
  else if (accion === 'entorno') entorno()
  else throw new Error('Acción desconocida para el túnel efímero.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falló el túnel efímero.')
  process.exitCode = 1
}
