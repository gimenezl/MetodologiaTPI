// Crea un proyecto Supabase efímero aislado para la integración móvil.
// Solo exporta la URL y la clave pública; la SERVICE_ROLE_KEY nunca abandona este proceso.
import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

function redactedCliOutput(resultado) {
  let salida = [resultado.stdout, resultado.stderr].filter((valor) => typeof valor === 'string' && valor.length > 0).join('\n')
  const nombresDeRuta = /^(?:HOME|USERPROFILE|RUNNER_TEMP|RUNNER_WORKSPACE|GITHUB_WORKSPACE|TMPDIR|TMP|TEMP|EPT_MOBILE_SUPABASE_WORKDIR)$/iu
  const valoresSensibles = Object.entries(process.env)
    .filter(([nombre, valor]) => valor && (nombresDeRuta.test(nombre) || /(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|EMAIL|AUTHORIZATION)(?:$|_)|_URL$/iu.test(nombre)))
    .map(([, valor]) => valor)
    .sort((a, b) => b.length - a.length)
  for (const valor of valoresSensibles) salida = salida.split(valor).join('[REDACTED]')

  // Keep diagnostics useful without retaining local endpoints, credentials, or runner paths.
  salida = salida
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/giu, '[REDACTED_URL]')
    .replace(/\bBearer\s+[^\s"'<>]+/giu, 'Bearer [REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/gu, '[REDACTED_TOKEN]')
    .replace(/\b[A-Za-z0-9_+/=-]{48,}\b/gu, '[REDACTED_OPAQUE_TOKEN]')
    .replace(/(?:[A-Za-z]:[\\/](?:Users|home|tmp|Temp|Windows[\\/]Temp)[\\/][^\s"'<>:,;]*|\/(?:Users|home|root|tmp|private\/tmp|private\/var\/folders|var\/folders|var\/tmp)\/[^\s"'<>:,;]*)/giu, '[REDACTED_PATH]')

  const etiquetaSensible = /(?:[A-Z0-9_-]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_-]*|(?:SERVICE[ _-]+ROLE|PUBLISHABLE|ANON(?:YMOUS)?|API|ACCESS|REFRESH|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|AUTH|TOKEN|KEY)(?:[ _-]+(?:ROLE|PUBLISHABLE|ANON|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|AUTH))?)\s*["']?\s*[:=]/iu
  return salida.split(/\r?\n/u).map((linea) => etiquetaSensible.test(linea) ? '[REDACTED_SENSITIVE_LINE]' : linea).join('\n').slice(-80_000)
}

function conservarDiagnosticoSeguro(ruta, resultado) {
  if (!ruta) return
  mkdirSync(join(ruta, '..'), { recursive: true })
  writeFileSync(ruta, `Supabase CLI start failed (exit=${resultado.status ?? 'unknown'}).\n${redactedCliOutput(resultado)}\n`, { mode: 0o600 })
  chmodSync(ruta, 0o600)
}

function cli(argumentos, { timeout = 240_000, diagnosticFile } = {}) {
  const entry = process.env.EPT_SUPABASE_CLI_ENTRY
  exigir(Boolean(entry), 'Falta la CLI Supabase aislada y fijada.')
  const resultado = spawnSync('python3', [join(raiz, 'scripts/ci/run-stage.py'), '--stage', argumentos[0] === 'stop' ? 'cleanup-supabase' : `supabase-${argumentos[0]}`, '--seconds', String(timeout / 1000), ...(argumentos[0] === 'status' ? ['--capture'] : []), '--', process.execPath, entry, ...argumentos], {
    cwd: raiz, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', argumentos[0] === 'status' ? 'pipe' : 'inherit'],
  })
  // Only status returns credentials to memory. Start/stop diagnostics are already redacted by the supervisor.
  if (resultado.error || resultado.status !== 0) {
    if (diagnosticFile) conservarDiagnosticoSeguro(diagnosticFile, resultado)
    // La salida completa se conserva solo en el artifact temporal después de redactarla.
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
  exigir(Boolean(process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT), 'Falta el propietario del run de integración.')
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
  // EPT-106: perfil de pruebas de recuperación de contraseña. Solo afecta a esta copia efímera (nunca a
  // supabase/config.toml ni a un proyecto remoto): el retorno de la app debe figurar en la lista de
  // redirecciones, el límite horario de correos del stack local (2) impediría las pruebas y
  // «secure_password_change» activa la reautenticación que la aplicación debe soportar.
  const aplicarConfig = (patron, reemplazo, nombre) => {
    exigir(patron.test(config), `La configuración base no contiene ${nombre}.`)
    config = config.replace(patron, reemplazo)
  }
  aplicarConfig(/^additional_redirect_urls\s*=\s*\["https:\/\/127\.0\.0\.1:3000"\]/mu, 'additional_redirect_urls = ["https://127.0.0.1:3000", "educarparatransformar://restablecer"]', 'additional_redirect_urls')
  aplicarConfig(/^email_sent\s*=\s*\d+/mu, 'email_sent = 100', 'email_sent')
  aplicarConfig(/^secure_password_change\s*=\s*false/mu, 'secure_password_change = true', 'secure_password_change')
  writeFileSync(join(destino, 'config.toml'), config, { mode: 0o600 })
  writeFileSync(join(workdir, 'owner.json'), JSON.stringify({ run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT }), { mode: 0o600 })

  // Registrar el workdir antes de arrancar servicios para que el step `always()` pueda
  // detener una startup parcial. El teardown valida el prefijo y el project_id antes de actuar.
  process.env.EPT_MOBILE_SUPABASE_WORKDIR = workdir
  const githubEnv = process.env.GITHUB_ENV
  exigir(githubEnv, 'La integración local solo puede preparar variables en un runner de GitHub Actions.')
  appendFileSync(githubEnv, `EPT_MOBILE_SUPABASE_WORKDIR=${workdir}\n`, { mode: 0o600 })

  const migrationNames = readdirSync(join(destino, 'migrations')).filter(file => file.endsWith('.sql')).length
  exigir(Number(migrationNames) > 0, 'El stack efímero no tiene migraciones.')
  // Mailpit solo en Android: ahí corre el backend real con el correo de recuperación (EPT-106). iOS no usa backend.
  const excluidos = ['studio', 'logflare', 'vector', 'imgproxy', 'realtime', 'edge-runtime', 'postgres-meta', ...(plataformaObjetivo === 'android' ? [] : ['mailpit']), 'supavisor']
  cli(['start', '--workdir', workdir, '--exclude', excluidos.join(',')], {
    timeout: 240_000,
    diagnosticFile: plataformaObjetivo === 'ios' ? process.env.EPT_MOBILE_SUPABASE_DIAGNOSTICS_FILE : undefined,
  })

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


/** El stack solo se toca si es el de ESTE run (directorio temporal propio, marca de propietario y project_id efímero). */
function proyectoPropio() {
  const workdir = process.env.EPT_MOBILE_SUPABASE_WORKDIR
  const configPath = workdir ? join(workdir, 'supabase', 'config.toml') : ''
  const directorioPropio = Boolean(workdir) && resolve(workdir) === workdir &&
    resolve(workdir).startsWith(`${resolve(tmpdir())}${process.platform === 'win32' ? '\\' : '/'}`) &&
    workdir.split(/[\\/]/u).at(-1)?.startsWith('ept105-supabase-')
  const marker = workdir ? join(workdir, 'owner.json') : ''
  const owner = directorioPropio && existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : {}
  const esProyectoPropio = directorioPropio && Boolean(process.env.GITHUB_RUN_ID) &&
    owner.run === process.env.GITHUB_RUN_ID && owner.attempt === process.env.GITHUB_RUN_ATTEMPT && existsSync(configPath) &&
    /^project_id\s*=\s*"ept105-[a-f0-9]{12}"/mu.test(readFileSync(configPath, 'utf8'))
  return { workdir, configPath, esProyectoPropio }
}

/**
 * EPT-119 (diagnóstico): resumen del log del servicio de autenticación del stack propio, sin cuerpos, cabeceras ni
 * credenciales. Por línea conserva solo hora, nivel, método, ruta, estado, duración y el mensaje de error, y pasa por
 * la misma redacción que el resto de los diagnósticos.
 */
function registrarAuth(destino) {
  const { configPath, esProyectoPropio } = proyectoPropio()
  exigir(esProyectoPropio, 'Solo se registra el stack propio de este run.')
  const proyecto = /^project_id\s*=\s*"(ept105-[a-f0-9]{12})"/mu.exec(readFileSync(configPath, 'utf8'))?.[1]
  const contenedor = `supabase_auth_${proyecto}`
  const r = spawnSync('docker', ['logs', '--since', '40m', contenedor], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 })
  const lineas = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/u).flatMap((linea) => {
    try {
      const j = JSON.parse(linea)
      const resumen = [j.time, j.level, j.method, j.path, j.status, j.duration, j.msg ?? j.error]
        .filter((v) => v !== undefined && v !== null && v !== '').map(String).join(' ')
      return resumen ? [resumen] : []
    } catch {
      return []
    }
  })
  const salida = redactedCliOutput({ stdout: lineas.slice(-1500).join('\n') })
  mkdirSync(join(destino, '..'), { recursive: true })
  writeFileSync(destino, `Log de autenticación resumido (exit=${r.status ?? 'sin estado'}; líneas=${lineas.length}).\n${salida}\n`, { mode: 0o600 })
}

try {
  if (accion === 'start') preparar(plataforma)
  else if (accion === 'stop') {
    const { workdir, esProyectoPropio } = proyectoPropio()
    if (esProyectoPropio) {
      cli(['stop', '--workdir', workdir, '--no-backup'], { timeout: 60_000 })
    }
    console.log('Stack descartable Supabase detenido.')
  } else if (accion === 'logs-auth') {
    registrarAuth(process.argv[3])
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
