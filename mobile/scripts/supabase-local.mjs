// Crea un proyecto Supabase efímero aislado para la integración móvil.
// Solo exporta la URL y la clave pública; la SERVICE_ROLE_KEY nunca abandona este proceso.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const raiz = resolve(import.meta.dirname, '../..')
const accion = process.argv[2]
const plataforma = process.argv[3]
const anfitrionesLocales = new Set(['127.0.0.1', 'localhost'])

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

function cli(argumentos, { timeout = 3_600_000 } = {}) {
  const resultado = spawnSync('npx', ['supabase', ...argumentos], {
    cwd: raiz, encoding: 'utf8', timeout, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (resultado.error || resultado.status !== 0) {
    // La salida del CLI puede contener claves locales. No la propagamos a logs ni artifacts.
    throw new Error(`Supabase CLI finalizó con código ${resultado.status ?? 'desconocido'} en ${argumentos[0]}.`)
  }
  return resultado.stdout
}

function entornoDeEstado() {
  const texto = cli(['status', '-o', 'env', '--workdir', process.env.EPT_MOBILE_SUPABASE_WORKDIR], { timeout: 30_000 })
  const valores = {}
  for (const linea of texto.split(/\r?\n/u)) {
    const coincidencia = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (coincidencia) valores[coincidencia[1]] = coincidencia[2]
  }
  return valores
}

function preparar(plataformaObjetivo) {
  exigir(plataformaObjetivo === 'android' || plataformaObjetivo === 'ios', 'Plataforma móvil desconocida.')
  const source = join(raiz, 'supabase')
  const workdir = mkdtempSync(join(tmpdir(), 'ept105-supabase-'))
  const destino = join(workdir, 'supabase')
  mkdirSync(destino, { recursive: true })
  cpSync(join(source, 'migrations'), join(destino, 'migrations'), { recursive: true })

  let config = readFileSync(join(source, 'config.toml'), 'utf8')
  config = config.replace(/^project_id\s*=\s*"[^"]+"/mu, `project_id = "ept105-${randomBytes(6).toString('hex')}"`)
  config = config.replace(/^jwt_expiry\s*=\s*\d+/mu, 'jwt_expiry = 120')
  config = config.replace(/^enabled\s*=\s*true(?=\s*\n\s*# Specifies an ordered list of seed files)/mu, 'enabled = false')
  config = config.replace(/^sql_paths\s*=\s*\["\.\/seed\.sql"\]/mu, 'sql_paths = []')
  writeFileSync(join(destino, 'config.toml'), config, { mode: 0o600 })

  // Registrar el workdir antes de arrancar servicios para que el step `always()` pueda
  // detener una startup parcial. El teardown valida el prefijo y el project_id antes de actuar.
  process.env.EPT_MOBILE_SUPABASE_WORKDIR = workdir
  const githubEnv = process.env.GITHUB_ENV
  exigir(githubEnv, 'La integración local solo puede preparar variables en un runner de GitHub Actions.')
  appendFileSync(githubEnv, `EPT_MOBILE_SUPABASE_WORKDIR=${workdir}\n`, { mode: 0o600 })

  const migrationNames = execFileSync('node', ['-e', "const fs=require('node:fs');process.stdout.write(String(fs.readdirSync(process.argv[1]).filter(f=>f.endsWith('.sql')).length))", join(destino, 'migrations')], { encoding: 'utf8' })
  exigir(Number(migrationNames) > 0, 'El stack efímero no tiene migraciones.')
  cli(['start', '--workdir', workdir, '--exclude', 'studio,logflare,vector,analytics,imgproxy,storage,realtime,edge-runtime'])

  const local = entornoDeEstado()
  const url = new URL(local.API_URL ?? '')
  exigir(url.protocol === 'http:' && anfitrionesLocales.has(url.hostname) && url.port === '54321' && url.pathname === '/', 'Supabase CLI no reportó el endpoint local esperado.')
  exigir(Boolean(local.ANON_KEY), 'Supabase CLI no reportó la clave pública local.')
  const hostPublico = plataformaObjetivo === 'android' ? '10.0.2.2' : '127.0.0.1'
  appendFileSync(githubEnv, [
    'EPT_MOBILE_AUTH_INTEGRATION=1',
    `EXPO_PUBLIC_SUPABASE_URL=http://${hostPublico}:54321`,
    `EXPO_PUBLIC_SUPABASE_ANON_KEY=${local.ANON_KEY}`,
  ].join('\n') + '\n', { mode: 0o600 })
  console.log(`Stack descartable Supabase preparado; plataforma=${plataformaObjetivo}; migraciones=${migrationNames}; JWT=120s.`)
}

try {
  if (accion === 'start') preparar(plataforma)
  else if (accion === 'stop') {
    const workdir = process.env.EPT_MOBILE_SUPABASE_WORKDIR
    const configPath = workdir ? join(workdir, 'supabase', 'config.toml') : ''
    const directorioPropio = Boolean(workdir) && resolve(workdir) === workdir &&
      resolve(workdir).startsWith(`${resolve(tmpdir())}${process.platform === 'win32' ? '\\' : '/'}`) &&
      workdir.split(/[\\/]/u).at(-1)?.startsWith('ept105-supabase-')
    const esProyectoPropio = directorioPropio && existsSync(configPath) &&
      /^project_id\s*=\s*"ept105-[a-f0-9]{12}"/mu.test(readFileSync(configPath, 'utf8'))
    if (esProyectoPropio) {
      cli(['stop', '--workdir', workdir, '--no-backup'], { timeout: 120_000 })
    }
    console.log('Stack descartable Supabase detenido.')
  } else if (accion === 'status') {
    const local = entornoDeEstado()
    const url = new URL(local.API_URL ?? '')
    exigir(url.protocol === 'http:' && anfitrionesLocales.has(url.hostname) && url.port === '54321', 'El entorno no apunta al servicio local esperado.')
    console.log('Supabase local listo en loopback; claves y tokens omitidos.')
  } else throw new Error('Acción desconocida para el stack local.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falló el stack Supabase descartable.')
  process.exitCode = 1
}
