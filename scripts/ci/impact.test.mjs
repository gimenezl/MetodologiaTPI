import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changedPaths, profile, pureTests, unsupportedPackage } from './impact.mjs'
import { sqlSuites, sqlRole, dbScripts, fullScripts, supportFiles, excludedFiles, validateRegistry } from './suites.mjs'
import { families, uiFiles, validateUiRegistry, fullProjects } from './ui.mjs'
import { withCleanup } from './cleanup.mjs'
import Reporter from './reporter.mjs'
import { declaredOmission } from './omissions.mjs'

test('Git NUL preserves both rename paths, deletions and spaces; unknown origin blocks', () => {
  const paths = changedPaths('R100\0src/auth.ts\0docs/a b.md\0D\0old.sql\0')
  assert.deepEqual(paths, ['src/auth.ts', 'docs/a b.md', 'old.sql'])
  assert.throws(() => profile(paths), /sin contrato/u)
})
test('malformed records fail closed', () => {
  for (const raw of ['M\0a', 'R100\0a\0', 'Z\0a\0', 'M\0../a\0', 'M\0/a\0']) assert.throws(() => changedPaths(raw))
})
test('PR plans never select the full matrix, including shared auth and infrastructure', () => {
  for (const file of ['package-lock.json', '.github/workflows/ci.yml', 'src/proxy.ts', 'supabase/migrations/new.sql']) {
    assert.deepEqual(profile([file]), { db: true, mutations: false, ui: ['core'] })
  }
  assert.deepEqual(profile(['docs/plan.md', 'tests/tarifas-lib.spec.ts']), { db: false, mutations: false, ui: [] })
  assert.deepEqual(profile(['tests/redireccion-login.spec.ts']), { db: false, mutations: false, ui: [] })
  assert.throws(() => profile(['tests/responsive-regresion.spec.ts']), /sin contrato/u)
  assert.throws(() => profile(['package-lock.json', 'tests/responsive-regresion.spec.ts']), /sin contrato/u)
  assert.deepEqual(profile(['src/services/facturacion-job.ts']), { db: true, mutations: false, ui: [] })
  assert.deepEqual(profile(['src/app/dashboard/tarifas/page.tsx']), { db: true, mutations: false, ui: ['tarifas'] })
  for (const file of ['unknown', 'mobile/package.json', 'tests/new.spec.ts', 'src/app/api/new/route.ts']) assert.throws(() => profile([file]))
  assert.throws(() => profile(['scripts/ci/new.test.mjs']))
  assert.deepEqual(profile(['src/app/api/tarifas/route.ts', 'src/app/dashboard/cursos/page.tsx']),
    { db: true, mutations: false, ui: ['cursos', 'tarifas'] })
})
test('mobile cannot pass web-only checks', () => {
  for (const [file, deps] of [['mobile/package.json', {}], ['apps/app/package.json', { expo: '54' }], ['apps/app/package.json', { 'react-native': '0.81' }]]) {
    assert.equal(unsupportedPackage(file, { dependencies: deps }), true)
  }
  assert.equal(unsupportedPackage('packages/shared/package.json', { dependencies: { zod: '4' } }), false)
})
test('pure config and actual UI registry remain aligned, new tests block', () => {
  const config = readFileSync('playwright.pure.config.ts', 'utf8')
  for (const name of pureTests) assert.ok(config.includes(name))
  assert.ok(!config.includes('webServer'))
  validateUiRegistry(readdirSync('tests'), pureTests)
  assert.throws(() => validateUiRegistry(['new.spec.ts'], pureTests))
  for (const [family, files] of Object.entries(families)) {
    for (const file of files) {
      assert.ok(readdirSync('tests').includes(`${file}.spec.ts`))
      assert.ok(profile([`tests/${file}.spec.ts`]).ui.includes(family))
    }
    assert.ok(uiFiles([family]).length > 0)
  }
  assert.throws(() => uiFiles(['unregistered']))
  assert.equal(new Set(fullProjects).size, 17)
})
test('CLI validates SHAs and emits a bounded PR plan for initial publication', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ept-ci-'))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  try {
    for (const [base, db, ui] of [[head, false, []], ['0'.repeat(40), true, ['core']]]) {
      const output = path.join(directory, `plan-${db}`)
      execFileSync(process.execPath, ['scripts/ci/impact.mjs'], { env: { ...process.env,
        CI_BASE_SHA: base, CI_HEAD_SHA: head, GITHUB_OUTPUT: output } })
      assert.equal(readFileSync(output, 'utf8'), `db=${db}\nmutations=false\nui=${JSON.stringify(ui)}\n`)
    }
    assert.notEqual(spawnSync(process.execPath, ['scripts/ci/impact.mjs'], { env: { ...process.env, CI_HEAD_SHA: 'untrusted; command' } }).status, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('runner refuses local execution without touching config; UI failures stop early', () => {
  const runner = readFileSync('scripts/ci/database.mjs', 'utf8')
  assert.ok(runner.includes('http://localhost:3101'))
  assert.ok(runner.includes("'--max-failures=1'"))
  assert.ok(runner.includes("'--list'"))
  const before = readFileSync('supabase/config.toml', 'utf8')
  const result = spawnSync(process.execPath, ['scripts/ci/database.mjs'], { env: { ...process.env, GITHUB_ACTIONS: 'false' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Se exige runner GitHub/u)
  assert.equal(readFileSync('supabase/config.toml', 'utf8'), before)
})
test('every SQL/API script retains its runnable contract; mutations are explicitly selected', () => {
  const registered = [...sqlSuites, ...dbScripts, ...fullScripts, ...supportFiles, ...excludedFiles, 'tipos-generados.mjs']
  assert.deepEqual(registered.sort(), readdirSync('supabase/tests').filter(f => /\.(?:sql|mjs)$/u.test(f)).sort())
  for (const file of [...sqlSuites, ...dbScripts, ...fullScripts, ...supportFiles, 'tipos-generados.mjs']) {
    const plan = profile([`supabase/tests/${file}`]); assert.equal(plan.db, true)
    assert.equal(plan.mutations, file === 'facturacion-mutaciones.mjs')
  }
  for (const file of [...excludedFiles, 'new-suite.mjs', 'new-suite.sql']) assert.throws(() => profile([`supabase/tests/${file}`]))
  assert.throws(() => profile(['package-lock.json', 'supabase/tests/new-suite.mjs']))
  assert.throws(() => validateRegistry([...registered, 'new-suite.mjs']))
  validateRegistry(registered)
})
test('cleanup preserves original and cleanup errors, and always attempts restoration', () => {
  const original = new Error('original'), stop = new Error('stop'), restore = new Error('restore')
  let restored = false
  assert.throws(() => withCleanup(() => { throw original }, [() => { throw stop }, () => { restored = true; throw restore }]),
    error => error instanceof AggregateError && error.cause === original && error.errors[0] === original && error.errors[1] === stop && error.errors[2] === restore)
  assert.equal(restored, true)
  assert.throws(() => withCleanup(() => { throw original }, [() => {}]), error => error === original)
  assert.equal(withCleanup(() => 42, [() => {}]), 42)
})
test('SQL owner remains correct; synchronous EPT59 SQL has server and child budgets', () => {
  assert.equal(sqlRole('inscripciones_legadas_contraccion_rls.sql'), 'postgres')
  for (const file of ['usuarios_permisos_rls.sql', 'usuarios_alta_atomica.sql']) {
    assert.equal(sqlRole(file), 'supabase_admin')
    assert.match(readFileSync(`supabase/tests/${file}`, 'utf8'), /psql -X -U supabase_admin/u)
  }
  assert.throws(() => sqlRole('new-suite.sql'))
  const helper = readFileSync('tests/usuarios-permisos-auth.spec.ts', 'utf8')
  assert.ok(helper.includes('statement_timeout=15000 -c lock_timeout=5000'))
  assert.ok(helper.includes('timeout: 20_000'))
  assert.match(readFileSync('.github/workflows/local-tests.yml', 'utf8'), /fetch-depth: 0/u)
})
test('UI report rejects setup-only, missing core/file, skips and incomplete execution', () => {
  const previous = { CI_MODE: process.env.CI_MODE, CI_UI: process.env.CI_UI, CI_LIST: process.env.CI_LIST }
  const fake = (name, file) => ({ parent: { project: () => ({ name }) }, location: { file: `/tests/${file}` }, expectedStatus: 'passed' })
  try {
    process.env.CI_MODE = 'ui'; process.env.CI_UI = '["core"]'; delete process.env.CI_LIST
    const tests = ['chromium', 'chromium-directora', 'chromium-personal', 'chromium-director-bloqueado']
      .map(name => fake(`core-${name}`, name === 'chromium' ? 'niveles-ui.spec.ts' : 'usuarios-permisos-auth.spec.ts'))
    const check = (selected, completed, status = 'passed', skipped = false) => {
      const reporter = new Reporter(); reporter.onBegin({}, { allTests: () => selected })
      for (let i = 0; i < completed; i++) reporter.onTestEnd(selected[i], { status: skipped ? 'skipped' : 'passed' })
      return reporter.onEnd({ status }).status
    }
    assert.equal(check(tests, 4), 'passed')
    assert.equal(check([fake('setup', 'auth.setup.ts')], 1), 'failed')
    assert.equal(check(tests.slice(1), 3), 'failed')
    assert.equal(check(tests, 3), 'failed'); assert.equal(check(tests, 4, 'failed'), 'failed')
    assert.equal(check(tests, 4, 'passed', true), 'failed')
    process.env.CI_UI = '["tarifas"]'; assert.equal(check(tests, 4), 'failed')
    process.env.CI_UI = '["core"]'
    tests[0].expectedStatus = 'failed'; assert.equal(check(tests, 4), 'failed') // Unexpected pass.
    const reporter = new Reporter(); reporter.onBegin({}, { allTests: () => tests })
    tests.forEach(t => reporter.onTestEnd(t, { status: t.expectedStatus }))
    assert.equal(reporter.onEnd({ status: 'passed' }).status, 'passed')
    const skipped = { ...fake('chromium', 'tarifas-ui.spec.ts'), title: 'en móvil los controles tienen alto táctil de 44 px',
      annotations: [{ type: 'skip', description: 'Solo aplica a los perfiles móviles.' }] }
    assert.ok(declaredOmission(skipped))
    assert.equal(declaredOmission({ ...skipped, title: 'new skipped feature' }), undefined)
    assert.equal(declaredOmission({ ...skipped, parent: { project: () => ({ name: 'setup' }) } }), undefined)
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync('ci-ui-result.json', { force: true })
  }
})
