import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { suiteProfile, validateRegistry } from './suites.mjs'
import { ept95Paths, secureRelative, validateEpt95Assets } from './ept95-assets.mjs'
import { families, aliases, validateUiRegistry } from './ui.mjs'

export const pureTests = ['tarifas-lib', 'asistencias-lib', 'reportes-lib', 'paginacion',
  'paginacion-paralela', 'inscripciones-legadas-lib', 'accesos-qr-cripto',
  'credenciales-qr-cripto', 'semantica-estatica', 'accesos-qr-servicio', 'redireccion-login']
export function changedPaths(raw) {
  const tokens = raw.split('\0'), paths = []
  if (tokens.pop() !== '') throw new Error('Incomplete Git diff')
  while (tokens.length) {
    const status = tokens.shift()
    if (!/^(?:[ACDMUT]|[RC]\d+)$/u.test(status)) throw new Error('Invalid Git status')
    for (let i = 0, count = /^[RC]/u.test(status) ? 2 : 1; i < count; i++) {
      const file = tokens.shift()
      if (!file || file.startsWith('/') || file.split('/').includes('..')) throw new Error('Invalid path')
      paths.push(file)
    }
  }
  return paths
}
export function profile(paths, { root = process.cwd() } = {}) {
  for (const file of paths) { try { secureRelative(file) } catch (error) { error.message += `: ${JSON.stringify(file)}`; throw error } }
  if (paths.some(file => ept95Paths.has(file) || file === 'scripts/ci/ept95-assets.mjs')) validateEpt95Assets(root)
  let db = false, mutations = false
  const ui = new Set()
  const core = () => { db = true; ui.add('core') }
  for (const file of paths) {
    if (ept95Paths.has(file)) continue
    if (file.startsWith('docs/parte3/EPT-95/')) throw new Error(`Ruta EPT-95 sin contrato: ${file}`)
    if (/^scripts\/ci\/.*\.test\.mjs$/u.test(file) && file !== 'scripts/ci/impact.test.mjs') throw new Error(`Prueba CI sin contrato: ${file}`)
    if (/^(?:docs\/.*\.md|(?:README|AGENTS)\.md|\.github\/pull_request_template\.md)$/u.test(file)) continue
    if (pureTests.some(name => file === `tests/${name}.spec.ts`)) continue
    if (/^supabase\/tests\/[^/]+\.(?:sql|mjs)$/u.test(file)) {
      const name = file.split('/').pop()
      suiteProfile(name); db = true
      if (name === 'facturacion-mutaciones.mjs') mutations = true
      if (name === 'correr-autenticadas.mjs' || name.startsWith('_')) ui.add('core')
      continue
    }
    if (/^supabase\/(?:migrations\/[^/]+\.sql|config\.toml)$/u.test(file)) { core(); continue }
    if (/^(?:scripts\/ci\/|\.github\/workflows\/|\.github\/actions\/|playwright\.[^/]+\.ts$)/u.test(file)
      || ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'eslint.config.mjs', '.gitignore', 'postcss.config.mjs'].includes(file)
      || /^(?:src\/(?:proxy\.ts|context\/AuthContext\.tsx|types\/|components\/(?:ui|layout)\/)|src\/app\/(?:login\/|acceso-bloqueado\/|dashboard\/(?:_components\/|layout\.tsx$|page\.tsx$)|(?:layout|globals|error|global-error|not-found)\.(?:tsx|css)$))/u.test(file)
      || /^src\/services\/(?:autorizacion|supabase(?:\.admin|\.server)?|cuentas|perfiles|roles|estudiantes|correo\.server)\.(?:ts|tsx)$/u.test(file)
      || /^src\/lib\/(?:errores|utils|validations|metodos-http|paginacion|redireccion-login|vinculos)\.ts$/u.test(file)
      || /^tests\/(?:auth\.setup|_(?:captura|contraste|semantica|sin-detalle-tecnico))\.ts$/u.test(file)) { core(); continue }
    if (file === 'src/services/facturacion-job.ts' || /^src\/app\/api\/(?:cron\/facturacion|facturacion)\//u.test(file)) { db = true; continue }
    if (file.startsWith('tests/')) {
      const found = Object.entries(families).filter(([, names]) => names.some(n => file === `tests/${n}.spec.ts`))
      if (found.length) { db = true; found.forEach(([name]) => ui.add(name)); continue }
      if (file === 'tests/e2e.spec.ts') { core(); continue }
    }
    const match = /^src\/app\/(?:api|dashboard|pruebas-ui)\/([^/]+)\//u.exec(file)
      ?? /^src\/(?:services|lib|components)\/([^/.]+)/u.exec(file)
      ?? /^tests\/_([^/.]+)/u.exec(file)
    const name = aliases[match?.[1]] ?? match?.[1]
    if (families[name]) { db = true; ui.add(name); continue }
    throw new Error(`Ruta sin contrato de comprobación: ${file}; registrar cobertura antes de integrar`)
  }
  return { db, mutations, ui: [...ui].sort() }
}
export function unsupportedPackage(file, content) {
  const dependencies = { ...content.dependencies, ...content.devDependencies }
  return /(?:^|\/)(?:mobile|android|ios)\//u.test(file) || 'expo' in dependencies || 'react-native' in dependencies
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateRegistry(readdirSync('supabase/tests'))
  validateUiRegistry(readdirSync('tests'), pureTests)
  if (readdirSync('scripts/ci').some(f => f.endsWith('.test.mjs') && f !== 'impact.test.mjs')) throw new Error('Registrar las nuevas pruebas CI antes de integrar')
  const packages = execFileSync('git', ['ls-files', '-z', '--', 'package.json', '*/package.json'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  if (packages.some(file => unsupportedPackage(file, JSON.parse(readFileSync(file, 'utf8'))))) throw new Error('Mobile detectado: configurar sus comprobaciones reales antes de integrar; CI web insuficiente')
  const base = process.env.CI_BASE_SHA, head = process.env.CI_HEAD_SHA
  if (!/^[a-f0-9]{40}$/u.test(head ?? '')) throw new Error('Invalid HEAD SHA')
  const plan = !/^[a-f0-9]{40}$/u.test(base ?? '') || /^0+$/u.test(base) ? profile(['package.json'])
    : profile(changedPaths(execFileSync('git', ['diff', '--name-status', '-z', execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim(), head], { encoding: 'utf8' })))
  appendFileSync(process.env.GITHUB_OUTPUT, `db=${plan.db}\nmutations=${plan.mutations}\nui=${JSON.stringify(plan.ui)}\n`)
  console.log(`Plan de comprobación: ${JSON.stringify(plan)}; revisión: ${head}`)
}
