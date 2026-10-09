import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { sqlSuites, sqlRole, dbScripts, validateRegistry } from './suites.mjs'
import { withCleanup } from './cleanup.mjs'

// Checkout GitHub desechable; los arneses antiguos leen la config raíz.
if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux'
  || process.env.DOCKER_HOST || process.env.EPT_PSQL_CONEXION
  || existsSync('supabase/.temp/project-ref') || existsSync('.env.local')) {
  throw new Error('Se exige runner GitHub Linux sin enlace remoto ni credenciales locales')
}
const mode = process.env.CI_MODE
if (!['db', 'ui', 'full'].includes(mode)) throw new Error('Invalid local profile')
const config = 'supabase/config.toml', original = readFileSync(config, 'utf8')
if (!/^project_id\s*=\s*"[^"]+"/mu.test(original)) throw new Error('Missing local project_id')
validateRegistry(readdirSync('supabase/tests'))
const env = { ...process.env, EPT_SUPABASE_WORKDIR: process.cwd(),
  EPT_SUPABASE_DB_CONTAINER: 'supabase_db_ept104', EPT_TEST_SMTP_PORT: '54325',
  EPT_PUERTO_APP: '3101', EPT_BASE_URL: 'http://localhost:3101' }
const deadline = Date.now() + (mode === 'full' ? 25 : mode === 'db' ? 10 : 6) * 60_000
const results = []
function run(command, args, options = {}) {
  const started = Date.now(), remaining = deadline - started
  if (remaining <= 0) throw new Error('Presupuesto local agotado: comprobación incompleta')
  const result = spawnSync(command, args, { env, stdio: 'inherit', timeout: remaining, ...options })
  results.push({ command: command === 'docker' ? 'SQL' : args[0],
    durationMs: Date.now() - started, status: result.status, timedOut: result.error?.code === 'ETIMEDOUT' })
  writeFileSync('ci-database-result.json', JSON.stringify({ mode, sha: process.env.CI_HEAD_SHA, results }))
  if (result.error || result.status !== 0) throw new Error(`${command} failed (exit ${result.status})`, { cause: result.error })
}
const cli = args => run('npx', ['--no-install', 'supabase', ...args])
const suite = file => run('node', [path.join('supabase/tests', file)])
withCleanup(() => {
  writeFileSync(config, original.replace(/^project_id\s*=.*$/mu, 'project_id = "ept104"'))
  run('npx', ['--no-install', 'supabase', 'start'], { stdio: 'pipe' }) // No imprimir claves efímeras.
  cli(['db', 'reset', '--local', '--no-seed'])
  if (mode === 'db') {
    suite('tipos-generados.mjs')
    for (const file of sqlSuites) {
      console.log(`SQL: ${file}`)
      run('docker', ['exec', '-i', env.EPT_SUPABASE_DB_CONTAINER, 'psql', '-X', '-U',
        sqlRole(file), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      { input: readFileSync(path.join('supabase/tests', file)), stdio: ['pipe', 'inherit', 'inherit'] })
    }
    for (const file of dbScripts) { console.log(`Contrato real: ${file}`); suite(file) }
    if (process.env.CI_MUTATIONS === 'true') suite('facturacion-mutaciones.mjs')
    suite('tipos-generados.mjs')
  } else {
    const args = ['supabase/tests/correr-autenticadas.mjs', '--config=playwright.ci.config.ts',
      '--reporter=line,./scripts/ci/reporter.mjs', '--max-failures=1']
    run('node', [...args, '--list'], { env: { ...env, CI_LIST: '1' } })
    const listed = JSON.parse(readFileSync('ci-ui-result.json', 'utf8'))
    if (!listed.listed || listed.status !== 'passed' || listed.selected < 1) throw new Error('Selección UI vacía o inválida')
    rmSync('ci-ui-result.json')
    run('node', args)
    const tested = JSON.parse(readFileSync('ci-ui-result.json', 'utf8'))
    if (tested.listed || tested.status !== 'passed' || tested.completed !== listed.expected) throw new Error('Ejecución UI incompleta')
  }
}, [() => {
  const stopped = spawnSync('npx', ['--no-install', 'supabase', 'stop', '--project-id', 'ept104', '--no-backup'],
    { env, stdio: 'pipe', timeout: 30_000 })
  if (stopped.error || stopped.status !== 0) throw new Error('No se pudo retirar el stack propio del runner')
}, () => writeFileSync(config, original)])
