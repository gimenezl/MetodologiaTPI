import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changedPaths, profile, pureTests, unsupportedPackage } from './impact.mjs'
import { sqlSuites, sqlRole, dbScripts, fullScripts, supportFiles, excludedFiles, validateRegistry } from './suites.mjs'
import { withCleanup } from './cleanup.mjs'

test('Git NUL records preserve both rename paths, deletions and spaces', () => {
  assert.deepEqual(changedPaths('R100\0src/auth.ts\0docs/a b.md\0D\0old.sql\0'),
    ['src/auth.ts', 'docs/a b.md', 'old.sql'])
  assert.equal(profile(changedPaths('R100\0src/auth.ts\0docs/a.md\0')), 'full')
})
test('malformed records fail closed', () => {
  for (const raw of ['M\0a', 'R100\0a\0', 'Z\0a\0', 'M\0../a\0', 'M\0/a\0']) {
    assert.throws(() => changedPaths(raw))
  }
})
test('profiles select real backend checks and conservative shared checks', () => {
  const cases = [
    [[], 'fast'], [['docs/plan.md', 'README.md'], 'fast'],
    [['tests/tarifas-lib.spec.ts'], 'fast'], [['src/services/facturacion-job.ts'], 'db'],
    [['supabase/tests/economico_rls.sql'], 'db'], [['supabase/tests/_arnes-ept59.mjs'], 'full'],
    [['supabase/migrations/new.sql'], 'full'], [['src/lib/supabase/server.ts'], 'full'],
    [['src/proxy.ts'], 'full'], [['package-lock.json'], 'full'],
    [['.github/workflows/ci.yml'], 'full'], [['mobile/package.json'], 'full'],
    [['src/app/dashboard/tarifas/page.tsx'], 'full'], [['unknown'], 'full'],
    [['docs/plan.md', 'src/lib/auth.ts'], 'full'],
  ]
  for (const [paths, expected] of cases) assert.equal(profile(paths), expected)
})
test('mobile packages cannot pass with only web checks', () => {
  assert.equal(unsupportedPackage('mobile/package.json', {}), true)
  assert.equal(unsupportedPackage('apps/app/package.json', { dependencies: { expo: '54' } }), true)
  assert.equal(unsupportedPackage('apps/app/package.json', { devDependencies: { 'react-native': '0.81' } }), true)
  assert.equal(unsupportedPackage('packages/shared/package.json', { dependencies: { zod: '4' } }), false)
})
test('pure config and impact allowlist stay aligned', () => {
  const config = readFileSync('playwright.pure.config.ts', 'utf8')
  for (const name of pureTests) assert.ok(config.includes(name))
  assert.ok(!config.includes('webServer'))
})
test('CLI validates SHAs and forces full for schedule/manual/initial push', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ept-ci-'))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  try {
    for (const [event, base, expected] of [
      ['schedule', head, 'full'], ['workflow_dispatch', head, 'full'],
      ['push', '0'.repeat(40), 'full'], ['pull_request', head, 'fast'],
    ]) {
      const output = path.join(directory, `${event}-${expected}`)
      execFileSync(process.execPath, ['scripts/ci/impact.mjs'], { env: { ...process.env,
        CI_EVENT: event, CI_BASE_SHA: base, CI_HEAD_SHA: head, GITHUB_OUTPUT: output } })
      assert.equal(readFileSync(output, 'utf8'), `mode=${expected}\n`)
    }
    assert.notEqual(spawnSync(process.execPath, ['scripts/ci/impact.mjs'],
      { env: { ...process.env, CI_HEAD_SHA: 'untrusted; command' } }).status, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('database runner refuses local execution before changing config', () => {
  const runner = readFileSync('scripts/ci/database.mjs', 'utf8')
  assert.match(runner, /playwright \? \{ \.\.\.env, EPT_BASE_URL: `http:\/\/localhost:/u)
  assert.ok(runner.includes("'--max-failures=1'"))
  const before = readFileSync('supabase/config.toml', 'utf8')
  const result = spawnSync(process.execPath, ['scripts/ci/database.mjs'],
    { env: { ...process.env, GITHUB_ACTIONS: 'false' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Se exige runner GitHub/u)
  assert.equal(readFileSync('supabase/config.toml', 'utf8'), before)
})
test('shared manifest covers every existing file and its execution profile', () => {
  const registered = [...sqlSuites, ...dbScripts, ...fullScripts, ...supportFiles, ...excludedFiles, 'tipos-generados.mjs']
  assert.deepEqual(registered.sort(), readdirSync('supabase/tests').filter(f => /\.(?:sql|mjs)$/u.test(f)).sort())
  for (const file of [...sqlSuites, ...dbScripts, 'tipos-generados.mjs']) assert.equal(profile([`supabase/tests/${file}`]), 'db')
  for (const file of [...fullScripts, ...supportFiles]) assert.equal(profile([`supabase/tests/${file}`]), 'full')
  for (const file of [...excludedFiles, 'new-suite.mjs', 'new-suite.sql']) assert.throws(() => profile([`supabase/tests/${file}`]))
  assert.throws(() => profile(['package-lock.json', 'supabase/tests/new-suite.mjs']))
  assert.throws(() => validateRegistry([...registered, 'new-suite.mjs']))
  assert.doesNotThrow(() => validateRegistry(registered))
})
test('cleanup preserves the operation error and still attempts restoration', () => {
  const original = new Error('original'), stop = new Error('stop'), restore = new Error('restore')
  let restored = false
  assert.throws(() => withCleanup(() => { throw original }, [
    () => { throw stop }, () => { restored = true; throw restore },
  ]), error => error instanceof AggregateError && error.cause === original
    && error.errors[0] === original && error.errors[1] === stop && error.errors[2] === restore)
  assert.equal(restored, true)
  assert.throws(() => withCleanup(() => { throw original }, [() => {}]), error => error === original)
  assert.equal(withCleanup(() => 42, [() => {}]), 42)
})
test('SQL uses postgres defaults except the documented GoTrue simulations', () => {
  assert.equal(sqlRole('inscripciones_legadas_contraccion_rls.sql'), 'postgres')
  for (const file of ['usuarios_permisos_rls.sql', 'usuarios_alta_atomica.sql']) {
    assert.equal(sqlRole(file), 'supabase_admin')
    assert.match(readFileSync(`supabase/tests/${file}`, 'utf8'), /psql -X -U supabase_admin/u)
  }
  assert.throws(() => sqlRole('new-suite.sql'))
})
