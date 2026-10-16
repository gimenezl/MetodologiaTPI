// Servidor web (Next) local y descartable para la integración móvil de comprobantes (EPT-109).
//
// La finalización de un comprobante vive en una ruta del servidor Next (valida el Bearer contra Auth,
// lee los bytes, los valida y confirma en la base). Para probarla de verdad desde el emulador y desde
// el script de integración se levanta el MISMO código con `next dev`, apuntando al stack Supabase
// efímero del runner. Las claves se obtienen en memoria de `supabase status` y viajan solo en el
// entorno del proceso hijo: nunca a disco ni al registro.
//
//   node mobile/scripts/servidor-web-local.mjs start
//   node mobile/scripts/servidor-web-local.mjs stop
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const raiz = resolve(import.meta.dirname, '../..')
const accion = process.argv[2]
const PUERTO = 3000
const workdir = process.env.EPT_MOBILE_SUPABASE_WORKDIR
const anfitrionesLocales = new Set(['127.0.0.1', 'localhost'])

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

function estadoSupabase() {
  exigir(process.env.EPT_SUPABASE_CLI_ENTRY && workdir, 'Falta la CLI Supabase aislada o el stack efímero.')
  const salida = execFileSync('python3', [
    join(raiz, 'scripts/ci/run-stage.py'), '--stage', 'web-status', '--seconds', '30', '--capture', '--',
    process.execPath, process.env.EPT_SUPABASE_CLI_ENTRY, 'status', '-o', 'env', '--workdir', workdir,
  ], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const valores = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (m) valores[m[1]] = m[2]
  }
  const url = new URL(valores.API_URL ?? '')
  exigir(url.protocol === 'http:' && anfitrionesLocales.has(url.hostname) && url.port === '54321',
    'El stack no reporta el endpoint local esperado.')
  exigir(valores.ANON_KEY && valores.SERVICE_ROLE_KEY, 'Faltan las claves locales.')
  return valores
}

async function esperar(url, limiteMs, proceso) {
  const fin = Date.now() + limiteMs
  while (Date.now() < fin) {
    if (proceso.exitCode !== null) throw new Error('El servidor web terminó antes de atender.')
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3_000) })
      if (r.status > 0) return
    } catch {
      // Todavía no atiende.
    }
    await new Promise(r => setTimeout(r, 1_000))
  }
  throw new Error('El servidor web no llegó a atender peticiones a tiempo.')
}

async function iniciar() {
  exigir(workdir && existsSync(workdir), 'Falta el stack efímero de integración.')
  const local = estadoSupabase()
  const registroDir = process.env.EPT_STAGE_LOG_DIR ?? join(workdir, 'logs')
  mkdirSync(registroDir, { recursive: true })
  const registro = openSync(join(registroDir, 'servidor-web-local.log'), 'a', 0o600)
  const cli = join(raiz, 'node_modules', 'next', 'dist', 'bin', 'next')
  exigir(existsSync(cli), 'Faltan las dependencias web (npm ci en la raíz).')

  const entorno = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    CRON_SECRET: `ci-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
  }
  const hijo = spawn(process.execPath, [cli, 'dev', '--port', String(PUERTO)], {
    cwd: raiz, env: entorno, stdio: ['ignore', registro, registro], detached: true, windowsHide: true,
  })
  hijo.unref()
  closeSync(registro)
  writeFileSync(join(workdir, 'servidor-web.pid'), String(hijo.pid), { mode: 0o600 })

  const base = `http://127.0.0.1:${PUERTO}`
  await esperar(`${base}/login`, 90_000, hijo)
  // Calienta (compila) la ruta de finalización: la primera petición de `next dev` es la lenta.
  const calentamiento = await fetch(`${base}/api/comprobantes/cargas/00000000-0000-4000-8000-000000000000/finalizacion`, {
    method: 'POST', signal: AbortSignal.timeout(90_000),
  })
  exigir(calentamiento.status === 401, 'La ruta de finalización no respondió 401 sin Bearer.')

  const githubEnv = process.env.GITHUB_ENV
  exigir(githubEnv, 'Solo se prepara dentro de un runner de GitHub Actions.')
  const hostEmulador = '10.0.2.2'
  appendFileSync(githubEnv, [
    `EPT_MOBILE_WEB_URL=${base}`,
    `EXPO_PUBLIC_API_BASE_URL=http://${hostEmulador}:${PUERTO}`,
  ].join('\n') + '\n', { mode: 0o600 })
  console.log('Servidor web local listo; la ruta de finalización exige Bearer.')
}

function detener() {
  const ruta = workdir ? join(workdir, 'servidor-web.pid') : ''
  if (!ruta || !existsSync(ruta)) {
    console.log('No hay servidor web local que detener.')
    return
  }
  const pid = Number(readFileSync(ruta, 'utf8'))
  rmSync(ruta, { force: true })
  if (Number.isInteger(pid) && pid > 1) {
    for (const objetivo of [-pid, pid]) {
      try {
        process.kill(objetivo, 'SIGTERM')
      } catch {
        // Ya terminó.
      }
    }
  }
  console.log('Servidor web local detenido.')
}

try {
  if (accion === 'start') await iniciar()
  else if (accion === 'stop') detener()
  else throw new Error('Acción desconocida para el servidor web local.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falló el servidor web local.')
  process.exitCode = 1
}
