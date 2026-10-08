import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { sqlSuites, sqlRole, dbScripts, fullScripts, validateRegistry } from './suites.mjs'
import { withCleanup } from './cleanup.mjs'

// Exclusivo del checkout desechable de GitHub: los arneses antiguos leen su config raíz.
if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux'
  || process.env.DOCKER_HOST || process.env.EPT_PSQL_CONEXION
  || existsSync('supabase/.temp/project-ref') || existsSync('.env.local')) {
  throw new Error('Se exige runner GitHub Linux sin enlace remoto ni credenciales locales')
}
const mode = process.env.CI_MODE
if (!['db', 'full'].includes(mode)) throw new Error('Invalid database profile')
const config = 'supabase/config.toml', original = readFileSync(config, 'utf8')
if (!/^project_id\s*=\s*"[^"]+"/mu.test(original)) throw new Error('Missing local project_id')
validateRegistry(readdirSync('supabase/tests'))
const env = { ...process.env, EPT_SUPABASE_WORKDIR: process.cwd(),
  EPT_SUPABASE_DB_CONTAINER: 'supabase_db_ept104', EPT_TEST_SMTP_PORT: '54325',
  EPT_PUERTO_APP: '3101', EPT_BASE_URL: 'http://127.0.0.1:3101' }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env, stdio: 'inherit', ...options })
  if (result.error || result.status !== 0) throw new Error(`${command} failed (exit ${result.status})`)
}
const cli = args => run('npx', ['--no-install', 'supabase', ...args])
let completed = 0
function suite(file) {
  console.log(`Comprobación real: ${file}`)
  run('node', [path.join('supabase/tests', file), ...(file === 'correr-autenticadas.mjs' ? ['--reporter=line'] : [])])
  completed++
}
withCleanup(() => {
  writeFileSync(config, original.replace(/^project_id\s*=.*$/mu, 'project_id = "ept104"'))
  run('npx', ['--no-install', 'supabase', 'start'], { stdio: 'pipe' }) // No imprimir claves efímeras.
  cli(['db', 'reset', '--local', '--no-seed'])
  suite('tipos-generados.mjs')
  for (const file of sqlSuites) {
    console.log(`SQL: ${file}`)
    run('docker', ['exec', '-i', env.EPT_SUPABASE_DB_CONTAINER, 'psql', '-X', '-U',
      sqlRole(file), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: readFileSync(path.join('supabase/tests', file)), stdio: ['pipe', 'inherit', 'inherit'] })
    completed++
  }
  for (const file of dbScripts) suite(file)
  if (mode === 'full') for (const file of fullScripts) suite(file)
  suite('tipos-generados.mjs')
  writeFileSync('ci-database-result.json', JSON.stringify({ mode, completed, sha: process.env.CI_HEAD_SHA }))
}, [() => {
  const stopped = spawnSync('npx', ['--no-install', 'supabase', 'stop', '--project-id', 'ept104', '--no-backup'],
    { env, stdio: 'pipe' })
  if (stopped.status !== 0) throw new Error('No se pudo retirar el stack propio del runner')
}, () => writeFileSync(config, original)])
